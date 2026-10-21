import { loadChannelSecrets } from "./channel-secrets.ts";
import { processLeadgen } from "./meta-ingest.ts";

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

type GraphError = { error?: { message?: string; code?: number } };

async function graphGet(path: string, token: string) {
  const response = await fetch(`https://graph.facebook.com/v21.0/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  const body = (await response.json()) as GraphError & { data?: Array<Record<string, string>> };
  return { ok: response.ok, body };
}

export async function syncMetaLeads() {
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return { status: "configuration_required", stored: 0, duplicate: 0, failed: 0, forms: 0, reason: "", webhook: "" };
  const desks = (await loadChannelSecrets(supabaseUrl, serviceKey, "meta")).filter((row) => row.page_id && row.access_token);
  const webhook = await ensureLeadWebhook(desks);
  let stored = 0;
  let duplicate = 0;
  let failed = 0;
  let forms = 0;
  let reason = "";
  const seenPages = new Set<string>();

  for (const desk of desks) {
    if (seenPages.has(desk.page_id)) continue;
    seenPages.add(desk.page_id);
    await fetch(`https://graph.facebook.com/v21.0/${desk.page_id}/subscribed_apps`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ subscribed_fields: "leadgen", access_token: desk.access_token }),
    });
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
        const result = await processLeadgen({ leadgenId: leadId, formId: form.id, pageId: desk.page_id, adId: "" });
        const payload = (await result.json()) as { status?: string };
        if (payload.status === "stored") stored += 1;
        else if (payload.status === "duplicate") duplicate += 1;
        else {
          failed += 1;
          if (!reason) reason = payload.status ?? "failed";
        }
      }
    }
  }

  return { status: stored > 0 ? "stored" : failed > 0 ? "partial" : "current", stored, duplicate, failed, forms, reason, webhook };
}

const LEAD_WEBHOOK = "https://bitvioncrm-drks.netlify.app/.netlify/functions/meta-leadgen";

async function ensureLeadWebhook(desks: Awaited<ReturnType<typeof loadChannelSecrets>>) {
  const desk = desks.find((row) => row.app_id && row.app_secret && row.verify_token);
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

function graphReason(body: GraphError) {
  return (body.error?.message ?? "graph_failed").replace(/access_token=[^&\s]+/g, "").slice(0, 160);
}

async function missingLeadIds(supabaseUrl: string, serviceKey: string, ids: string[]) {
  if (!ids.length) return [];
  const list = ids.map((id) => encodeURIComponent(id)).join(",");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/leads?select=meta_leadgen_id&meta_leadgen_id=in.(${list})`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } },
  );
  if (!response.ok) return ids;
  const rows = (await response.json()) as Array<{ meta_leadgen_id?: string }>;
  const have = new Set(rows.map((row) => row.meta_leadgen_id).filter(Boolean));
  return ids.filter((id) => !have.has(id));
}
