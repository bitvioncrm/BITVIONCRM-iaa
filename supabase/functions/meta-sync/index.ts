import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { resolveLeadDesk, type FormMapping, type WorkspaceDesk } from "./meta-route.ts";

type GraphError = { error?: { message?: string; code?: number } };
type GraphLead = {
  field_data?: Array<{ name: string; values?: string[] }>;
  created_time?: string;
  form_id?: string;
  campaign_name?: string;
  campaign_id?: string;
  adset_name?: string;
  ad_id?: string;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { status: "rejected" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json(503, { status: "configuration_required" });
  const provided = request.headers.get("x-hook-token") ?? "";
  const secrets = await loadSecrets(supabaseUrl, serviceKey);
  if (!provided || !secrets.some((row) => row.verify_token && row.verify_token === provided)) return json(401, { status: "rejected" });
  const result = await sync(supabaseUrl, serviceKey, secrets);
  return json(200, result);
});

function json(status: number, body: Record<string, string | number>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sync(supabaseUrl: string, serviceKey: string, secrets: SecretRow[]) {
  const desks = await loadDesks(supabaseUrl, serviceKey);
  const webhook = await ensureLeadWebhook(secrets);
  let stored = 0;
  let failed = 0;
  let forms = 0;
  let reason = "";
  const seen = new Set<string>();
  for (const desk of secrets) {
    if (!desk.page_id || !desk.access_token || seen.has(desk.page_id)) continue;
    seen.add(desk.page_id);
    const subscribed = await fetch(`https://graph.facebook.com/v21.0/${desk.page_id}/subscribed_apps`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ subscribed_fields: "leadgen", access_token: desk.access_token }),
    });
    if (!subscribed.ok && !reason) reason = "page_subscribe_failed";
    const formList = await graphGet(`${desk.page_id}/leadgen_forms?fields=id&limit=100`, desk.access_token);
    if (!formList.ok) {
      failed += 1;
      reason = graphReason(formList.body);
      continue;
    }
    for (const form of formList.body.data ?? []) {
      if (!form.id) continue;
      forms += 1;
      const leads = await graphGet(`${form.id}/leads?fields=id&limit=25`, desk.access_token);
      if (!leads.ok) {
        failed += 1;
        reason = graphReason(leads.body);
        continue;
      }
      const ids = (leads.body.data ?? []).map((lead) => lead.id).filter(Boolean);
      const fresh = await missingLeadIds(supabaseUrl, serviceKey, ids);
      for (const leadId of fresh) {
        const outcome = await storeLead(supabaseUrl, serviceKey, secrets, desks, desk, form.id, leadId);
        if (outcome === "stored") stored += 1;
        else if (outcome !== "duplicate") {
          failed += 1;
          if (!reason) reason = outcome;
        }
      }
    }
  }
  return { status: stored > 0 ? "stored" : failed > 0 ? "partial" : "current", stored, failed, forms, reason, webhook };
}

const LEAD_WEBHOOK = "https://bitvioncrm-drks.netlify.app/.netlify/functions/meta-leadgen";

async function ensureLeadWebhook(secrets: SecretRow[]) {
  const desk = secrets.find((row) => row.app_id && row.app_secret && row.verify_token);
  if (!desk) return "missing_app";
  const token = `${desk.app_id}|${desk.app_secret}`;
  const listed = await fetch(`https://graph.facebook.com/v21.0/${desk.app_id}/subscriptions?access_token=${encodeURIComponent(token)}`);
  const body = (await listed.json()) as GraphError & { data?: Array<{ object?: string; callback_url?: string; active?: boolean; fields?: Array<{ name?: string }> }> };
  if (!listed.ok) return graphReason(body);
  const page = (body.data ?? []).find((item) => item.object === "page");
  const fields = (page?.fields ?? []).map((field) => field.name).filter((name): name is string => Boolean(name));
  if (page?.callback_url === LEAD_WEBHOOK && page.active !== false && fields.includes("leadgen")) return "leadgen";
  const save = await fetch(`https://graph.facebook.com/v21.0/${desk.app_id}/subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      object: "page",
      callback_url: LEAD_WEBHOOK,
      verify_token: desk.verify_token,
      fields: "leadgen",
      access_token: token,
    }),
  });
  if (!save.ok) return graphReason((await save.json()) as GraphError);
  return "leadgen_set";
}

async function storeLead(supabaseUrl: string, serviceKey: string, secrets: SecretRow[], desks: WorkspaceDesk[], desk: SecretRow, formId: string, leadgenId: string) {
  const graph = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?fields=${encodeURIComponent("created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform")}&access_token=${encodeURIComponent(desk.access_token)}`);
  if (!graph.ok) return "graph_failed";
  const lead = (await graph.json()) as GraphLead;
  const resolvedForm = lead.form_id || formId;
  let adAccountId = desk.ad_account_id;
  if (lead.campaign_id) {
    const campaign = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(lead.campaign_id)}?fields=account_id&access_token=${encodeURIComponent(desk.access_token)}`);
    if (campaign.ok) adAccountId = ((await campaign.json()) as { account_id?: string }).account_id ?? adAccountId;
  }
  const mappings = await loadMappings(supabaseUrl, serviceKey, resolvedForm);
  const mapping = resolveLeadDesk({
    formId: resolvedForm,
    pageId: desk.page_id,
    adAccountId,
    campaignName: lead.campaign_name ?? "",
    mappings,
    accounts: secrets.filter((row) => row.ad_account_id).map((row) => ({ adAccountId: row.ad_account_id, workspaceId: row.workspace_id, organizationId: row.organization_id })),
    desks,
    pages: secrets.filter((row) => row.page_id).map((row) => ({ pageId: row.page_id, workspaceId: row.workspace_id, organizationId: row.organization_id })),
  });
  if (!mapping) return "unmapped";
  const createdAt = lead.created_time ? new Date(lead.created_time) : null;
  const sourceCreated = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : null;
  const inserted = await fetch(`${supabaseUrl}/rest/v1/leads`, {
    method: "POST",
    headers: headers(serviceKey, "return=representation"),
    body: JSON.stringify({
      organization_id: mapping.organizationId,
      workspace_id: mapping.workspaceId,
      full_name: fieldValue(lead, "full_name", "name") || "Unnamed lead",
      phone: fieldValue(lead, "phone_number", "phone"),
      email: fieldValue(lead, "email"),
      source: "meta_ads",
      source_platform: "meta",
      source_campaign: lead.campaign_name || "",
      source_form: resolvedForm,
      meta_page_id: desk.page_id,
      meta_form_id: resolvedForm,
      meta_adset_name: lead.adset_name || "",
      meta_ad_id: lead.ad_id || "",
      meta_leadgen_id: leadgenId,
      imported_at: new Date().toISOString(),
      source_created_at: sourceCreated,
      created_at: sourceCreated ?? new Date().toISOString(),
      status: "new",
    }),
  });
  if (inserted.status === 409) return "duplicate";
  if (!inserted.ok) return "lead_insert_failed";
  const created = (await inserted.json()) as Array<{ id: string }>;
  const leadId = created[0]?.id ?? "";
  if (leadId) {
    await fetch(`${supabaseUrl}/rest/v1/lead_status_history`, {
      method: "POST",
      headers: headers(serviceKey, "return=minimal"),
      body: JSON.stringify({ organization_id: mapping.organizationId, workspace_id: mapping.workspaceId, lead_id: leadId, from_status: null, to_status: "new" }),
    });
  }
  await fetch(`${supabaseUrl}/rest/v1/meta_import_events?on_conflict=leadgen_id`, {
    method: "POST",
    headers: headers(serviceKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({
      organization_id: mapping.organizationId,
      leadgen_id: leadgenId,
      page_id: desk.page_id,
      form_id: resolvedForm,
      workspace_id: mapping.workspaceId,
      lead_id: leadId || null,
      status: "stored",
      error_code: "",
      updated_at: new Date().toISOString(),
    }),
  });
  await fetch(`${supabaseUrl}/rest/v1/integration_status?on_conflict=organization_id,provider`, {
    method: "POST",
    headers: headers(serviceKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({
      organization_id: mapping.organizationId,
      provider: "meta",
      status: "connected",
      detail: "Last lead stored",
      updated_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
    }),
  });
  return "stored";
}

function fieldValue(lead: GraphLead, ...names: string[]) {
  for (const name of names) {
    const value = lead.field_data?.find((item) => item.name === name)?.values?.[0]?.trim() ?? "";
    if (value) return value;
  }
  return "";
}

function graphReason(body: GraphError) {
  return (body.error?.message ?? "graph_failed").replace(/access_token=[^&\s]+/g, "").slice(0, 160);
}

async function graphGet(path: string, token: string) {
  const response = await fetch(`https://graph.facebook.com/v21.0/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  const body = (await response.json()) as GraphError & { data?: Array<Record<string, string>> };
  return { ok: response.ok, body };
}

type SecretRow = {
  organization_id: string;
  workspace_id: string;
  page_id: string;
  access_token: string;
  verify_token: string;
  ad_account_id: string;
  app_id: string;
  app_secret: string;
};

function headers(serviceKey: string, prefer = "") {
  const value: Record<string, string> = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
  if (prefer) value.prefer = prefer;
  return value;
}

async function loadSecrets(supabaseUrl: string, serviceKey: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/workspace_channel_secrets?channel=eq.meta&select=organization_id,workspace_id,page_id,access_token,verify_token,ad_account_id,app_id,app_secret`, { headers: headers(serviceKey) });
  if (!response.ok) return [];
  return (await response.json()) as SecretRow[];
}

async function loadDesks(supabaseUrl: string, serviceKey: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/workspaces?select=id,organization_id,name,workspace_type&deleted_at=is.null&workspace_type=in.(clinic,institute)`, { headers: headers(serviceKey) });
  if (!response.ok) return [] as WorkspaceDesk[];
  const rows = (await response.json()) as Array<{ id: string; organization_id: string; name: string; workspace_type: string }>;
  return rows.map((row) => ({ workspaceId: row.id, organizationId: row.organization_id, workspaceType: row.workspace_type, name: row.name ?? "" }));
}

async function loadMappings(supabaseUrl: string, serviceKey: string, formId: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/meta_form_mappings?form_id=eq.${encodeURIComponent(formId)}&active=eq.true&select=organization_id,workspace_id,page_id,form_id,active`, { headers: headers(serviceKey) });
  if (!response.ok) return [] as FormMapping[];
  const rows = (await response.json()) as Array<{ organization_id: string; workspace_id: string; page_id: string; form_id: string; active: boolean }>;
  return rows.map((row) => ({ formId: row.form_id, pageId: row.page_id ?? "", workspaceId: row.workspace_id, organizationId: row.organization_id, active: row.active }));
}

async function missingLeadIds(supabaseUrl: string, serviceKey: string, ids: string[]) {
  if (!ids.length) return [];
  const list = ids.map((id) => encodeURIComponent(id)).join(",");
  const response = await fetch(`${supabaseUrl}/rest/v1/leads?select=meta_leadgen_id&meta_leadgen_id=in.(${list})`, { headers: headers(serviceKey) });
  if (!response.ok) return ids;
  const rows = (await response.json()) as Array<{ meta_leadgen_id?: string }>;
  const have = new Set(rows.map((row) => row.meta_leadgen_id).filter(Boolean));
  return ids.filter((id) => !have.has(id));
}
