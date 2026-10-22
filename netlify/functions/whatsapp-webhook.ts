import { createHmac, timingSafeEqual } from "node:crypto";
import { instituteDeskForCampaign } from "../../src/lib/meta-route.ts";
import { loadChannelSecrets, uniqueSecrets, type ChannelSecret } from "../lib/channel-secrets.ts";
import { messageBody, phoneLookup, whatsappLeadFields } from "../lib/whatsapp-inbound.ts";

function required(name: string) {
  return process.env[name]?.trim() || "";
}

function json(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function serviceHeaders(serviceKey: string, prefer = "return=minimal") {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
    prefer,
  };
}

type InboundMessage = {
  id?: string;
  from?: string;
  text?: { body?: string };
  referral?: { headline?: string; source_id?: string };
};

type WebhookValue = {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: InboundMessage[];
  statuses?: Array<{ id?: string; status?: string }>;
};

async function findLeadId(supabaseUrl: string, serviceKey: string, workspaceId: string, from: string) {
  const phone = phoneLookup(from);
  if (!phone.full) return "";
  const match = phone.tail
    ? `or=(phone_digits.eq.${phone.full},phone_digits.eq.${phone.tail},phone_digits.like.*${phone.tail})`
    : `phone_digits=eq.${phone.full}`;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/leads?workspace_id=eq.${workspaceId}&deleted_at=is.null&select=id&limit=1&${match}`,
    { headers: serviceHeaders(serviceKey) },
  );
  if (!response.ok) return "";
  const rows = (await response.json()) as Array<{ id?: string }>;
  return rows[0]?.id ?? "";
}

async function createLead(supabaseUrl: string, serviceKey: string, desk: ChannelSecret, message: InboundMessage, name: string) {
  const fields = whatsappLeadFields({
    name,
    from: message.from ?? "",
    headline: message.referral?.headline,
    sourceId: message.referral?.source_id,
  });
  if (!fields.phone) return "";
  const response = await fetch(`${supabaseUrl}/rest/v1/leads`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify({
      organization_id: desk.organization_id,
      workspace_id: desk.workspace_id,
      ...fields,
      imported_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) return "";
  const rows = (await response.json()) as Array<{ id?: string }>;
  const leadId = rows[0]?.id ?? "";
  if (leadId) {
    await fetch(`${supabaseUrl}/rest/v1/lead_status_history`, {
      method: "POST",
      headers: serviceHeaders(serviceKey),
      body: JSON.stringify({
        organization_id: desk.organization_id,
        workspace_id: desk.workspace_id,
        lead_id: leadId,
        from_status: null,
        to_status: "new",
      }),
    });
  }
  return leadId;
}

async function bindClickDesk(supabaseUrl: string, serviceKey: string, rows: ChannelSecret[], phoneNumberId: string, headline: string) {
  const known = rows.find((row) => row.phone_number_id === phoneNumberId);
  if (known) return known;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/workspaces?select=id,organization_id,name,workspace_type&deleted_at=is.null&workspace_type=in.(clinic,institute)`,
    { headers: serviceHeaders(serviceKey) },
  );
  if (!response.ok) return undefined;
  const loaded = ((await response.json()) as Array<{ id: string; organization_id: string; name: string; workspace_type: string }>).map((desk) => ({
    workspaceId: desk.id,
    organizationId: desk.organization_id,
    workspaceType: desk.workspace_type,
    name: desk.name ?? "",
  }));
  const institute = headline.trim() ? instituteDeskForCampaign(headline, loaded[0]?.organizationId ?? "", loaded) : undefined;
  const clinic = loaded.find((desk) => desk.workspaceType === "clinic");
  const openRows = rows.filter((item) => !item.phone_number_id);
  const preferredId = institute?.workspaceId ?? clinic?.workspaceId ?? openRows[0]?.workspace_id ?? "";
  const row = rows.find((item) => item.workspace_id === preferredId && (!item.phone_number_id || item.phone_number_id === phoneNumberId))
    ?? openRows[0];
  if (!row || (row.phone_number_id && row.phone_number_id !== phoneNumberId)) return undefined;
  if (!row.phone_number_id) {
    await fetch(`${supabaseUrl}/rest/v1/workspace_channel_secrets?workspace_id=eq.${row.workspace_id}&channel=eq.whatsapp`, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey),
      body: JSON.stringify({ phone_number_id: phoneNumberId, status: "connected", updated_at: new Date().toISOString() }),
    });
    row.phone_number_id = phoneNumberId;
  }
  return row;
}

export default async (request: Request) => {
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const stored = supabaseUrl && serviceKey ? await loadChannelSecrets(supabaseUrl, serviceKey) : [];
  const whatsappRows = stored.filter((row) => row.channel === "whatsapp");

  if (request.method === "GET") {
    const url = new URL(request.url);
    const verifyTokens = uniqueSecrets([required("WHATSAPP_VERIFY_TOKEN"), ...whatsappRows.map((row) => row.verify_token), ...stored.filter((row) => row.channel === "meta").map((row) => row.verify_token)]);
    if (!verifyTokens.length) return json(503, { status: "configuration_required" });
    const provided = url.searchParams.get("hub.verify_token") ?? "";
    if (url.searchParams.get("hub.mode") === "subscribe" && verifyTokens.includes(provided)) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return json(403, { status: "rejected" });
  }

  if (!supabaseUrl || !serviceKey) return json(503, { status: "configuration_required" });

  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const secrets = uniqueSecrets([required("META_APP_SECRET"), ...stored.map((row) => row.app_secret)]);
  if (!secrets.length) return json(503, { status: "configuration_required" });
  const signed = secrets.some((secret) => {
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    const left = Buffer.from(expected);
    const right = Buffer.from(signature);
    return left.length === right.length && timingSafeEqual(left, right);
  });
  if (!signed) return json(401, { status: "invalid_signature" });

  const payload = JSON.parse(raw) as { entry?: Array<{ changes?: Array<{ value?: WebhookValue }> }> };
  const values = (payload.entry ?? []).flatMap((entry) => entry.changes ?? []).map((change) => change.value).filter((value): value is WebhookValue => Boolean(value));
  let storedCount = 0;
  let unmapped = 0;

  for (const value of values) {
    const phoneNumberId = value.metadata?.phone_number_id ?? "";
    const desk = whatsappRows.find((row) => row.phone_number_id && row.phone_number_id === phoneNumberId);
    for (const status of value.statuses ?? []) {
      if (!status.id) continue;
      await fetch(`${supabaseUrl}/rest/v1/messages?provider_message_id=eq.${encodeURIComponent(status.id)}`, {
        method: "PATCH",
        headers: serviceHeaders(serviceKey),
        body: JSON.stringify({ status: status.status ?? "" }),
      });
    }
    for (const message of value.messages ?? []) {
      if (!message.id || !message.from) continue;
      let matched = desk;
      if (!matched && phoneNumberId) {
        matched = await bindClickDesk(supabaseUrl, serviceKey, whatsappRows, phoneNumberId, message.referral?.headline ?? "");
      }
      if (!matched) {
        unmapped += 1;
        continue;
      }
      const seen = await fetch(
        `${supabaseUrl}/rest/v1/processed_events?provider=eq.whatsapp&external_event_id=eq.${encodeURIComponent(message.id)}&select=id&limit=1`,
        { headers: serviceHeaders(serviceKey) },
      );
      const seenRows = seen.ok ? ((await seen.json()) as unknown[]) : [];
      if (Array.isArray(seenRows) && seenRows.length > 0) continue;

      const contact = value.contacts?.find((item) => item.wa_id === message.from);
      const name = contact?.profile?.name ?? "";
      let leadId = await findLeadId(supabaseUrl, serviceKey, matched.workspace_id, message.from);
      if (!leadId) leadId = await createLead(supabaseUrl, serviceKey, matched, message, name);
      if (!leadId) return json(502, { status: "lead_insert_failed" });

      const storedMessage = await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: "POST",
        headers: serviceHeaders(serviceKey),
        body: JSON.stringify({
          organization_id: matched.organization_id,
          workspace_id: matched.workspace_id,
          lead_id: leadId,
          channel: "whatsapp",
          direction: "inbound",
          body: messageBody(message.text?.body ?? "", message.referral?.headline ?? ""),
          provider_message_id: message.id,
          status: "received",
        }),
      });
      if (!storedMessage.ok) return json(502, { status: "message_insert_failed" });
      await fetch(`${supabaseUrl}/rest/v1/processed_events`, {
        method: "POST",
        headers: serviceHeaders(serviceKey, "return=minimal,resolution=ignore-duplicates"),
        body: JSON.stringify({ provider: "whatsapp", external_event_id: message.id }),
      });
      storedCount += 1;
    }
  }

  if (storedCount > 0) return json(200, { status: "stored" });
  if (unmapped > 0) return json(200, { status: "unmapped_number" });
  return json(200, { status: "ignored" });
};
