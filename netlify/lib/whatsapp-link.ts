import { loadChannelSecrets } from "./channel-secrets.ts";

type GraphError = { error?: { message?: string; code?: number } };
type PhoneRow = { id?: string; display_phone_number?: string };
type WabaRow = { id?: string };
type FoundPhone = { id: string; wabaId: string; tail: string };

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

function pushPhone(phones: FoundPhone[], id: string, display: string, wabaId = "") {
  const key = tail(display);
  if (!id) return;
  if (key) {
    if (!phones.some((phone) => phone.id === id || phone.tail === key)) phones.push({ id, wabaId, tail: key });
    return;
  }
  if (!phones.some((phone) => phone.id === id)) phones.push({ id, wabaId, tail: "" });
}

export async function linkWhatsAppDesks(supabaseUrl: string, serviceKey: string) {
  const meta = await loadChannelSecrets(supabaseUrl, serviceKey, "meta");
  const whatsapp = await loadChannelSecrets(supabaseUrl, serviceKey, "whatsapp");
  const account = meta.find((row) => row.ad_account_id && row.access_token) ?? meta.find((row) => row.access_token);
  const app = meta.find((row) => row.app_id && row.app_secret && row.verify_token);
  if (!account?.access_token || !app) return { linked: 0, phones: 0, webhook: "", reason: "meta_not_connected" };

  const desks = await loadDeskPhones(supabaseUrl, serviceKey, whatsapp.map((row) => row.workspace_id));
  const token = account.access_token;
  const accountId = (account.ad_account_id || "").replace(/^act_/i, "");
  const phones: FoundPhone[] = [];
  const notes: string[] = [];

  if (accountId) {
    const business = await graph<{ business?: { id?: string } }>(`act_${accountId}?fields=business`, token);
    const businessId = business.body.business?.id ?? "";
    if (businessId) {
      const discovered = await phonesFromBusiness(token, businessId);
      phones.push(...discovered.phones);
      if (discovered.reason) notes.push(discovered.reason);
    } else {
      notes.push(business.ok ? "no_business" : reason(business.body));
    }
    const fromAds = await phonesFromAds(token, accountId);
    for (const phone of fromAds.phones) {
      if (!phones.some((item) => item.id === phone.id || (phone.tail && item.tail === phone.tail))) phones.push(phone);
    }
    if (fromAds.reason) notes.push(fromAds.reason);
  }

  for (const desk of meta.filter((row) => row.page_id && row.access_token)) {
    const fromPage = await phonesFromPage(desk.access_token, desk.page_id);
    for (const phone of fromPage.phones) {
      if (!phones.some((item) => item.id === phone.id || (phone.tail && item.tail === phone.tail))) phones.push(phone);
    }
    if (fromPage.reason) notes.push(fromPage.reason);
  }

  let linked = 0;
  const openDesks = desks.filter((desk) => {
    const row = whatsapp.find((item) => item.workspace_id === desk.workspaceId);
    return row && !row.phone_number_id;
  });

  for (const desk of desks) {
    const row = whatsapp.find((item) => item.workspace_id === desk.workspaceId);
    if (!row) continue;
    let match = phones.filter((phone) => phone.tail && phone.tail === desk.tail);
    if (match.length !== 1 && !row.phone_number_id && openDesks.length === 1 && phones.length === 1 && openDesks[0].workspaceId === desk.workspaceId) {
      match = phones;
    }
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
        ...(match[0].tail && !row.display_phone ? { display_phone: `+91${match[0].tail}` } : {}),
        app_id: app.app_id,
        ...(app.app_secret ? { app_secret: app.app_secret } : {}),
        ...(app.verify_token ? { verify_token: app.verify_token } : {}),
        status: "connected",
        detail: "Linked from Meta ads / WhatsApp discovery.",
        updated_at: new Date().toISOString(),
      }),
    });
    if (!saved.ok) continue;
    linked += 1;
    if (match[0].wabaId) await graph(`${match[0].wabaId}/subscribed_apps`, token, "POST", {});
  }

  const webhook = await ensureWhatsAppWebhook(app.app_id, app.app_secret, app.verify_token);
  const lookup = phones.length ? "" : notes.filter(Boolean)[0] || "no_whatsapp_numbers";
  return { linked, phones: phones.length, webhook, reason: lookup };
}

async function phonesFromBusiness(token: string, businessId: string) {
  const owned = await graph<{ data?: WabaRow[] }>(`${businessId}/owned_whatsapp_business_accounts?fields=id&limit=50`, token);
  const client = await graph<{ data?: WabaRow[] }>(`${businessId}/client_whatsapp_business_accounts?fields=id&limit=50`, token);
  const wabaIds = [...new Set([...(owned.body.data ?? []), ...(client.body.data ?? [])].map((row) => row.id).filter(Boolean))] as string[];
  const phones: FoundPhone[] = [];
  for (const wabaId of wabaIds) {
    const listed = await graph<{ data?: PhoneRow[] }>(`${wabaId}/phone_numbers?fields=id,display_phone_number&limit=50`, token);
    if (!listed.ok) continue;
    for (const phone of listed.body.data ?? []) {
      pushPhone(phones, phone.id ?? "", phone.display_phone_number ?? "", wabaId);
    }
  }
  const lookup = phones.length ? "" : !owned.ok ? reason(owned.body) : !client.ok ? reason(client.body) : "no_whatsapp_numbers";
  return { phones, reason: lookup };
}

async function phonesFromAds(token: string, accountId: string) {
  const phones: FoundPhone[] = [];
  const keys = new Set<string>();
  const adsets = await graph<{ data?: Array<{ destination_type?: string; promoted_object?: Record<string, string> }> }>(
    `act_${accountId}/adsets?fields=destination_type,promoted_object&limit=200`,
    token,
  );
  if (adsets.ok) {
    for (const row of adsets.body.data ?? []) {
      const object = row.promoted_object ?? {};
      for (const key of Object.keys(object)) keys.add(key);
      pushPhone(
        phones,
        object.whatsapp_phone_number_id || object.phone_number_id || "",
        object.whatsapp_phone_number || object.whats_app_number || object.phone_number || "",
      );
    }
  }
  const ads = await graph<{ data?: Array<{ creative?: { object_story_spec?: { link_data?: { call_to_action?: { value?: Record<string, string> } } }; call_to_action_type?: string }; asset_feed_spec?: { call_to_actions?: Array<{ value?: Record<string, string> }> } }> }>(
    `act_${accountId}/ads?fields=creative{call_to_action_type,object_story_spec,asset_feed_spec}&limit=100`,
    token,
  );
  if (ads.ok) {
    for (const row of ads.body.data ?? []) {
      const values = [
        row.creative?.object_story_spec?.link_data?.call_to_action?.value,
        ...(row.creative?.asset_feed_spec?.call_to_actions?.map((item) => item.value) ?? []),
      ].filter(Boolean) as Array<Record<string, string>>;
      for (const value of values) {
        for (const key of Object.keys(value)) keys.add(`creative.${key}`);
        pushPhone(
          phones,
          value.whatsapp_phone_number_id || value.phone_number_id || "",
          value.whatsapp_number || value.phone_number || value.whatsapp_phone_number || "",
        );
      }
    }
  }
  if (!adsets.ok && !ads.ok) return { phones, reason: reason(adsets.body) };
  return { phones, reason: phones.length ? "" : `ad_keys:${[...keys].join(",") || "none"}` };
}

async function phonesFromPage(token: string, pageId: string) {
  const phones: FoundPhone[] = [];
  const page = await graph<{ whatsapp_number?: string; call_to_actions?: { data?: Array<{ type?: string; value?: Record<string, string> }> } }>(
    `${pageId}?fields=whatsapp_number,call_to_actions{type,value}`,
    token,
  );
  if (!page.ok) return { phones, reason: reason(page.body) };
  if (page.body.whatsapp_number) pushPhone(phones, "", page.body.whatsapp_number);
  for (const action of page.body.call_to_actions?.data ?? []) {
    const value = action.value ?? {};
    pushPhone(phones, value.whatsapp_phone_number_id || value.phone_number_id || "", value.whatsapp_number || value.phone_number || "");
  }
  return { phones, reason: phones.length ? "" : "page_no_whatsapp" };
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
