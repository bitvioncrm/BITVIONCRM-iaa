import { createHmac, timingSafeEqual } from "node:crypto";

function required(name: string) {
  return process.env[name]?.trim() || "";
}

function json(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default async (request: Request) => {
  const verify = required("WHATSAPP_VERIFY_TOKEN");
  const secret = required("META_APP_SECRET");
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const organizationId = required("WHATSAPP_ORGANIZATION_ID");
  const workspaceId = required("WHATSAPP_WORKSPACE_ID");

  if (request.method === "GET") {
    const url = new URL(request.url);
    if (!verify) return json(503, { status: "configuration_required" });
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verify) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return json(403, { status: "rejected" });
  }

  if (!secret || !supabaseUrl || !serviceKey || !organizationId || !workspaceId) {
    return json(503, { status: "configuration_required" });
  }

  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return json(401, { status: "invalid_signature" });

  const payload = JSON.parse(raw) as {
    entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ id: string; from: string; text?: { body?: string } }>; statuses?: Array<{ id: string; status: string }> } }> }>;
  };
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  const status = value?.statuses?.[0];
  const externalId = message?.id ?? status?.id;
  if (!externalId) return json(200, { status: "ignored" });

  const seen = await fetch(`${supabaseUrl}/rest/v1/processed_events`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify({ provider: "whatsapp", external_event_id: externalId }),
  });
  if (!seen.ok) return json(502, { status: "event_store_failed" });
  const storedEvents = (await seen.json()) as unknown[];
  if (!Array.isArray(storedEvents) || storedEvents.length === 0) return json(200, { status: "duplicate" });

  if (message) {
    const stored = await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        organization_id: organizationId,
        workspace_id: workspaceId,
        channel: "whatsapp",
        direction: "inbound",
        body: message.text?.body ?? "",
        provider_message_id: message.id,
        status: "received",
      }),
    });
    if (!stored.ok) return json(502, { status: "message_insert_failed" });
  }

  if (status) {
    await fetch(`${supabaseUrl}/rest/v1/messages?provider_message_id=eq.${encodeURIComponent(status.id)}`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: status.status }),
    });
  }

  return json(200, { status: "stored" });
};
