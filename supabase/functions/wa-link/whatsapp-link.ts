import { loadChannelSecrets } from "./channel-secrets.ts";

type GraphError = { error?: { message?: string; code?: number } };
type PhoneRow = { id?: string; display_phone_number?: string };
type WabaRow = { id?: string };

const WHATSAPP_WEBHOOK = "https://bitvioncrm-drks.netlify.app/.netlify/functions/whatsapp-webhook";

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function tail(value: string) {
  const clean = digits(value);
  return clean.length >= 10 ? clean.slice(-10) : "";
}

function reason(body: GraphError) {
  return (body.error?.message ?? "graph_failed").replace(/access_token=[^&\s]+/g, "").slice(0, 160);
}

async function graph<T>(path: string, token: string, method = "GET", form?: Record<string, string>) {
  const url = method === "GET"
    ? `https://graph.facebook.com/v21.0/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`
    : `https://graph.facebook.com/v21.0/${path}`;
  const response = await fetch(url, method === "GET" ? undefined : {
    method,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, access_token: token }),
  });
  const body = (await response.json()) as GraphError & T;
  return { ok: response.ok, body };
}

export async function linkWhatsAppDesks(supabaseUrl: string, serviceKey: string) {
  const meta = await loadChannelSecrets(supabaseUrl, serviceKey, "meta");
  const whatsapp = await loadChannelSecrets(supabaseUrl, serviceKey, "whatsapp");
  const account = meta.find((row) => row.ad_account_id && row.access_token);
  const app = meta.find((row) => row.app_id && row.app_secret && row.verify_token);
  if (!account || !app) return { linked: 0, phones: 0, webhook: "", reason: "meta_not_connected" };

  const desks = await loadDeskPhones(supabaseUrl, serviceKey, whatsapp.map((row) => row.workspace_id));
  const token = account.access_token;
  const accountId = account.ad_account_id.replace(/^act_/i, "");
  const business = await graph<{ business?: { id?: string } }>(`act_${accountId}?fields=business`, token);
  const businessId = business.body.business?.id ?? "";
  const discovered = businessId ? await phonesFromBusiness(token, businessId) : { phones: [], reason: business.ok ? "no_business" : reason(business.body) };
  const fromAds = discovered.phones.length ? { phones: [], reason: "" } : await phonesFromAds(token, accountId);
  const phones = discovered.phones.length ? discovered.phones : fromAds.phones;

  let linked = 0;
  for (const desk of desks) {
    const match = phones.filter((phone) => phone.tail === desk.tail);
    if (match.length !== 1) continue;
    const saved = await fetch(`${supabaseUrl}/rest/v1/workspace_channel_secrets?workspace_id=eq.${desk.workspaceId}&channel=eq.whatsapp`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        phone_number_id: match[0].id,
        ...(match[0].wabaId ? { waba_id: match[0].wabaId } : {}),
        app_id: app.app_id,
        status: "connected",
        updated_at: new Date().toISOString(),
      }),
    });
    if (!saved.ok) continue;
    linked += 1;
    if (match[0].wabaId) await graph(`${match[0].wabaId}/subscribed_apps`, token, "POST", {});
  }

  const webhook = await ensureWhatsAppWebhook(app.app_id, app.app_secret, app.verify_token);
  const lookup = phones.length ? "" : discovered.reason || fromAds.reason || "no_whatsapp_numbers";
  return { linked, phones: phones.length, webhook, reason: lookup };
}

async function phonesFromBusiness(token: string, businessId: string) {
  const owned = await graph<{ data?: WabaRow[] }>(`${businessId}/owned_whatsapp_business_accounts?fields=id&limit=50`, token);
  const client = await graph<{ data?: WabaRow[] }>(`${businessId}/client_whatsapp_business_accounts?fields=id&limit=50`, token);
  const wabaIds = [...new Set([...(owned.body.data ?? []), ...(client.body.data ?? [])].map((row) => row.id).filter(Boolean))] as string[];
  const phones: Array<{ id: string; wabaId: string; tail: string }> = [];
  for (const wabaId of wabaIds) {
    const listed = await graph<{ data?: PhoneRow[] }>(`${wabaId}/phone_numbers?fields=id,display_phone_number&limit=50`, token);
    if (!listed.ok) continue;
    for (const phone of listed.body.data ?? []) {
      const key = tail(phone.display_phone_number ?? "");
      if (phone.id && key) phones.push({ id: phone.id, wabaId, tail: key });
    }
  }
  const lookup = phones.length ? "" : !owned.ok ? reason(owned.body) : !client.ok ? reason(client.body) : "no_whatsapp_numbers";
  return { phones, reason: lookup };
}

async function phonesFromAds(token: string, accountId: string) {
  const listed = await graph<{ data?: Array<{ promoted_object?: Record<string, string> }> }>(`act_${accountId}/adsets?fields=destination_type,promoted_object&limit=100`, token);
  if (!listed.ok) return { phones: [] as Array<{ id: string; wabaId: string; tail: string }>, reason: reason(listed.body) };
  const phones: Array<{ id: string; wabaId: string; tail: string }> = [];
  const keys = new Set<string>();
  for (const row of listed.body.data ?? []) {
    const object = row.promoted_object ?? {};
    for (const key of Object.keys(object)) keys.add(key);
    const id = object.whatsapp_phone_number_id || object.phone_number_id || "";
    const display = object.whatsapp_phone_number || object.whats_app_number || "";
    const key = tail(display);
    if (id && key) phones.push({ id, wabaId: "", tail: key });
  }
  return { phones, reason: phones.length ? "" : `ad_keys:${[...keys].join(",") || "none"}` };
}

async function ensureWhatsAppWebhook(appId: string, appSecret: string, verifyToken: string) {
  const token = `${appId}|${appSecret}`;
  const listed = await graph<{ data?: Array<{ object?: string; callback_url?: string; active?: boolean; fields?: Array<{ name?: string }> }> }>(`${appId}/subscriptions`, token);
  if (!listed.ok) return reason(listed.body);
  const current = (listed.body.data ?? []).find((item) => item.object === "whatsapp_business_account");
  const fields = (current?.fields ?? []).map((field) => field.name);
  if (current?.callback_url === WHATSAPP_WEBHOOK && current.active !== false && fields.includes("messages")) return "messages";
  const save = await graph(`${appId}/subscriptions`, token, "POST", {
    object: "whatsapp_business_account",
    callback_url: WHATSAPP_WEBHOOK,
    verify_token: verifyToken,
    fields: "messages",
  });
  return save.ok ? "messages_set" : reason(save.body);
}

async function loadDeskPhones(supabaseUrl: string, serviceKey: string, workspaceIds: string[]) {
  if (!workspaceIds.length) return [];
  const list = workspaceIds.map((id) => encodeURIComponent(id)).join(",");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/workspace_channel_secrets?channel=eq.whatsapp&workspace_id=in.(${list})&select=workspace_id,display_phone`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } },
  );
  if (!response.ok) return [];
  const rows = (await response.json()) as Array<{ workspace_id: string; display_phone: string }>;
  return rows
    .map((row) => ({ workspaceId: row.workspace_id, tail: tail(row.display_phone ?? "") }))
    .filter((row) => row.tail);
}
