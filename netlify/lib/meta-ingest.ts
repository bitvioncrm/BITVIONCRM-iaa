import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveFormMapping, type FormMapping } from "../../src/lib/meta-route.ts";

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

function json(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function signatureOk(raw: string, header: string, secret: string) {
  if (!header || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}

function serviceHeaders(serviceKey: string, prefer = "") {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
  if (prefer) headers.prefer = prefer;
  return headers;
}

interface GraphLead {
  field_data?: Array<{ name: string; values?: string[] }>;
  created_time?: string;
  form_id?: string;
  campaign_name?: string;
  campaign_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  platform?: string;
}

function fieldValue(lead: GraphLead, ...names: string[]) {
  for (const name of names) {
    const value = lead.field_data?.find((item) => item.name === name)?.values?.[0]?.trim() ?? "";
    if (value) return value;
  }
  return "";
}

async function saveEvent(input: {
  supabaseUrl: string;
  serviceKey: string;
  organizationId: string;
  leadgenId: string;
  pageId: string;
  formId: string;
  workspaceId?: string;
  leadId?: string;
  status: "stored" | "duplicate" | "unmapped" | "failed" | "invalid";
  errorCode?: string;
}) {
  if (!input.organizationId) return;
  await fetch(`${input.supabaseUrl}/rest/v1/meta_import_events?on_conflict=leadgen_id`, {
    method: "POST",
    headers: serviceHeaders(input.serviceKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({
      organization_id: input.organizationId,
      leadgen_id: input.leadgenId,
      page_id: input.pageId,
      form_id: input.formId,
      workspace_id: input.workspaceId ?? null,
      lead_id: input.leadId ?? null,
      status: input.status,
      error_code: input.errorCode ?? "",
      updated_at: new Date().toISOString(),
    }),
  });
}

async function touchIntegration(supabaseUrl: string, serviceKey: string, organizationId: string, status: string, detail: string, success: boolean) {
  if (!organizationId) return;
  const now = new Date().toISOString();
  await fetch(`${supabaseUrl}/rest/v1/integration_status?on_conflict=organization_id,provider`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({
      organization_id: organizationId,
      provider: "meta",
      status,
      detail,
      updated_at: now,
      last_event_at: now,
      ...(success ? { last_success_at: now } : {}),
    }),
  });
}

async function loadMappings(supabaseUrl: string, serviceKey: string, formId: string) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/meta_form_mappings?form_id=eq.${encodeURIComponent(formId)}&active=eq.true&select=organization_id,workspace_id,page_id,form_id,active`,
    { headers: serviceHeaders(serviceKey) },
  );
  if (!response.ok) return { rows: [] as FormMapping[], missing: response.status === 404 || response.status === 400 };
  const rows = (await response.json()) as Array<{ organization_id: string; workspace_id: string; page_id: string; form_id: string; active: boolean }>;
  return {
    missing: false,
    rows: rows.map((row) => ({
      formId: row.form_id,
      pageId: row.page_id ?? "",
      workspaceId: row.workspace_id,
      organizationId: row.organization_id,
      active: row.active,
    })),
  };
}

export async function processLeadgen(input: {
  leadgenId: string;
  formId: string;
  pageId: string;
  adId: string;
}) {
  const secretReady = env("META_APP_SECRET") && env("META_PAGE_TOKEN") && env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const token = env("META_PAGE_TOKEN");
  const fallbackOrg = env("META_ORGANIZATION_ID");
  if (!secretReady) return json(503, { status: "configuration_required" });
  if (!/^\d{5,32}$/.test(input.leadgenId)) return json(400, { status: "invalid" });

  const existing = await fetch(
    `${supabaseUrl}/rest/v1/leads?meta_leadgen_id=eq.${encodeURIComponent(input.leadgenId)}&select=id&limit=1`,
    { headers: serviceHeaders(serviceKey) },
  );
  if (!existing.ok) return json(503, { status: "schema_required" });
  const existingRows = (await existing.json()) as Array<{ id: string }>;
  if (existingRows[0]?.id) return json(200, { status: "duplicate" });

  const graph = await fetch(
    `https://graph.facebook.com/v21.0/${input.leadgenId}?fields=${encodeURIComponent("created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform")}&access_token=${encodeURIComponent(token)}`,
  );
  if (!graph.ok) {
    await saveEvent({
      supabaseUrl,
      serviceKey,
      organizationId: fallbackOrg,
      leadgenId: input.leadgenId,
      pageId: input.pageId,
      formId: input.formId,
      status: "failed",
      errorCode: "graph_failed",
    });
    await touchIntegration(supabaseUrl, serviceKey, fallbackOrg, "error", "Lead retrieval failed", false);
    return json(502, { status: "graph_failed" });
  }
  const lead = (await graph.json()) as GraphLead;
  const formId = lead.form_id || input.formId;
  const pageId = input.pageId;
  const mappings = await loadMappings(supabaseUrl, serviceKey, formId);
  if (mappings.missing) return json(503, { status: "schema_required" });
  const mapping = resolveFormMapping(formId, pageId, mappings.rows);
  const organizationId = mapping?.organizationId || fallbackOrg;
  if (!mapping) {
    await saveEvent({
      supabaseUrl,
      serviceKey,
      organizationId,
      leadgenId: input.leadgenId,
      pageId,
      formId,
      status: "unmapped",
      errorCode: mappings.rows.length > 1 ? "ambiguous_mapping" : "unmapped_form",
    });
    await touchIntegration(supabaseUrl, serviceKey, organizationId, "error", "A lead form is not mapped to a desk", false);
    return json(200, { status: "unmapped" });
  }

  const createdAt = lead.created_time ? new Date(lead.created_time) : null;
  const sourceCreated = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : null;
  const inserted = await fetch(`${supabaseUrl}/rest/v1/leads`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify({
      organization_id: mapping.organizationId,
      workspace_id: mapping.workspaceId,
      full_name: fieldValue(lead, "full_name", "name") || "Unnamed lead",
      phone: fieldValue(lead, "phone_number", "phone"),
      email: fieldValue(lead, "email"),
      source: "meta_ads",
      source_platform: "meta",
      source_campaign: lead.campaign_name || "",
      source_form: formId,
      meta_page_id: pageId,
      meta_form_id: formId,
      meta_adset_name: lead.adset_name || "",
      meta_ad_id: lead.ad_id || input.adId || "",
      meta_leadgen_id: input.leadgenId,
      imported_at: new Date().toISOString(),
      source_created_at: sourceCreated,
      created_at: sourceCreated ?? new Date().toISOString(),
      status: "new",
    }),
  });
  if (inserted.status === 409) return json(200, { status: "duplicate" });
  if (!inserted.ok) {
    await saveEvent({
      supabaseUrl,
      serviceKey,
      organizationId: mapping.organizationId,
      leadgenId: input.leadgenId,
      pageId,
      formId,
      workspaceId: mapping.workspaceId,
      status: "failed",
      errorCode: "lead_insert_failed",
    });
    await touchIntegration(supabaseUrl, serviceKey, mapping.organizationId, "error", "Lead insert failed", false);
    return json(502, { status: "lead_insert_failed" });
  }
  const created = (await inserted.json()) as Array<{ id: string }>;
  const leadId = created[0]?.id ?? "";
  if (leadId) {
    await fetch(`${supabaseUrl}/rest/v1/lead_status_history`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({
        organization_id: mapping.organizationId,
        workspace_id: mapping.workspaceId,
        lead_id: leadId,
        from_status: null,
        to_status: "new",
      }),
    });
    await fetch(`${supabaseUrl}/rest/v1/audit_logs`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({
        organization_id: mapping.organizationId,
        workspace_id: mapping.workspaceId,
        action: "meta_lead_imported",
        entity: "leads",
        entity_id: leadId,
        metadata: { form_id: formId, page_id: pageId, campaign: lead.campaign_name || "" },
      }),
    });
  }
  await saveEvent({
    supabaseUrl,
    serviceKey,
    organizationId: mapping.organizationId,
    leadgenId: input.leadgenId,
    pageId,
    formId,
    workspaceId: mapping.workspaceId,
    leadId,
    status: "stored",
  });
  await fetch(`${supabaseUrl}/rest/v1/processed_events`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=minimal,resolution=ignore-duplicates"),
    body: JSON.stringify({ provider: "meta", external_event_id: input.leadgenId }),
  });
  await touchIntegration(supabaseUrl, serviceKey, mapping.organizationId, "connected", "Last lead stored", true);
  return json(200, { status: "stored" });
}

function readChanges(payload: unknown) {
  const entry = payload as { entry?: Array<{ changes?: Array<{ value?: { leadgen_id?: string; form_id?: string; page_id?: string; ad_id?: string } }> }> };
  const changes = entry.entry?.flatMap((item) => item.changes ?? []) ?? [];
  return changes
    .map((change) => change.value)
    .filter((value): value is { leadgen_id: string; form_id?: string; page_id?: string; ad_id?: string } => Boolean(value?.leadgen_id))
    .map((value) => ({
      leadgenId: value.leadgen_id,
      formId: value.form_id ?? "",
      pageId: value.page_id ?? "",
      adId: value.ad_id ?? "",
    }));
}

export async function handleMetaRequest(request: Request) {
  const verify = env("META_VERIFY_TOKEN");
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (!verify) return json(503, { status: "configuration_required" });
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verify) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return json(403, { status: "rejected" });
  }
  if (request.method !== "POST") return json(405, { status: "rejected" });
  const secret = env("META_APP_SECRET");
  if (!secret || !env("META_PAGE_TOKEN") || !env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) {
    return json(503, { status: "configuration_required" });
  }
  const raw = await request.text();
  if (!signatureOk(raw, request.headers.get("x-hub-signature-256") ?? "", secret)) return json(401, { status: "invalid_signature" });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { status: "invalid" });
  }
  const changes = readChanges(payload);
  if (!changes.length) return json(200, { status: "ignored" });
  let last = json(200, { status: "ignored" });
  for (const change of changes) last = await processLeadgen(change);
  return last;
}

async function callerIsAdmin(supabaseUrl: string, serviceKey: string, authorization: string) {
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, authorization },
  });
  if (!userResponse.ok) return false;
  const user = (await userResponse.json()) as { id?: string };
  if (!user.id) return false;
  const roles = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user.id}&select=roles(key)`, {
    headers: serviceHeaders(serviceKey),
  });
  if (!roles.ok) return false;
  const rows = (await roles.json()) as Array<{ roles: { key: string } | Array<{ key: string }> | null }>;
  return rows.some((row) => {
    const value = row.roles;
    const key = Array.isArray(value) ? value[0]?.key : value?.key;
    return key === "admin" || key === "super_admin";
  });
}

export async function handleMetaRetry(request: Request) {
  if (request.method !== "POST") return json(405, { status: "rejected" });
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey || !env("META_PAGE_TOKEN")) return json(503, { status: "configuration_required" });
  const authorization = request.headers.get("authorization") ?? "";
  if (!(await callerIsAdmin(supabaseUrl, serviceKey, authorization))) return json(403, { status: "rejected" });
  let body: { leadgenId?: string };
  try {
    body = (await request.json()) as { leadgenId?: string };
  } catch {
    return json(400, { status: "invalid" });
  }
  const leadgenId = body.leadgenId?.trim() ?? "";
  if (!/^\d{5,32}$/.test(leadgenId)) return json(400, { status: "invalid" });
  const eventResponse = await fetch(
    `${supabaseUrl}/rest/v1/meta_import_events?leadgen_id=eq.${encodeURIComponent(leadgenId)}&select=page_id,form_id,status&limit=1`,
    { headers: serviceHeaders(serviceKey) },
  );
  const events = eventResponse.ok ? ((await eventResponse.json()) as Array<{ page_id: string; form_id: string; status: string }>) : [];
  const event = events[0];
  if (event?.status === "stored") return json(200, { status: "duplicate" });
  return processLeadgen({
    leadgenId,
    formId: event?.form_id ?? "",
    pageId: event?.page_id ?? "",
    adId: "",
  });
}
