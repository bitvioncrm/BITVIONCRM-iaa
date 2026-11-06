import { loadChannelSecrets, sendingLine } from "../lib/channel-secrets.ts";

function required(name: string) {
  return process.env[name]?.trim() || "";
}

function json(status: number, body: Record<string, string | number>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function roleKey(value: { key: string } | { key: string }[] | null) {
  if (Array.isArray(value)) return value[0]?.key ?? "";
  return value?.key ?? "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 20;
const DAILY_CAP = 250;

function indiaDayStart() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

export default async (request: Request) => {
  if (request.method !== "POST") return json(405, { status: "method_not_allowed" });
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const anon = required("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anon) return json(503, { status: "configuration_required", detail: "Server keys are missing." });

  const jwt = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { status: "unauthorized" });
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } });
  if (!userResponse.ok) return json(401, { status: "unauthorized" });
  const user = (await userResponse.json()) as { id?: string };
  if (!user.id) return json(401, { status: "unauthorized" });
  const roleResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user.id}&select=workspace_id,roles(key)`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  const roles = (await roleResponse.json()) as Array<{ workspace_id: string | null; roles: { key: string } | { key: string }[] | null }>;
  const admin = roles.some((row) => ["admin", "super_admin"].includes(roleKey(row.roles)));

  const body = (await request.json()) as { text?: string; imageUrl?: string; workspaceId?: string; offset?: number };
  const text = body.text?.trim() ?? "";
  const imageUrl = body.imageUrl?.trim() ?? "";
  if ((!text && !imageUrl) || text.length > 1000) return json(400, { status: "invalid", detail: "Add a message or a poster." });
  const offset = Math.max(0, Number(body.offset ?? 0));
  const workspaceId = body.workspaceId && UUID.test(body.workspaceId) ? body.workspaceId : "";
  if (!admin) return json(403, { status: "forbidden", detail: "Bulk messaging is limited to Admin." });

  const secret = sendingLine(await loadChannelSecrets(supabaseUrl, serviceKey, "whatsapp"), workspaceId);
  const fromPhone = secret?.display_phone || "this desk";
  if (!secret?.access_token || !secret.phone_number_id) return json(503, { status: "configuration_required", detail: `Save a WhatsApp access token for ${fromPhone}.` });

  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const dayFilter = workspaceId ? `&workspace_id=eq.${workspaceId}` : "";
  const usedResponse = await fetch(
    `${supabaseUrl}/rest/v1/messages?select=id&channel=eq.whatsapp&direction=eq.outbound&created_at=gte.${encodeURIComponent(indiaDayStart())}${dayFilter}`,
    { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } },
  );
  const used = Number((usedResponse.headers.get("content-range") ?? "0/0").split("/")[1] || 0);
  const remaining = Math.max(0, DAILY_CAP - used);
  if (remaining < 1) {
    return json(200, {
      status: "capped",
      sent: 0,
      failed: 0,
      next: offset,
      total: 0,
      capped: 1,
      detail: "Today's 250-message balance is used. This campaign continues tomorrow.",
    });
  }
  const take = Math.min(BATCH, remaining);
  const filter = workspaceId ? `&workspace_id=eq.${workspaceId}` : "";
  const list = await fetch(
    `${supabaseUrl}/rest/v1/leads?select=id,phone,organization_id,workspace_id&deleted_at=is.null&phone=neq.${filter}&order=created_at.desc`,
    { headers: { ...headers, Range: `${offset}-${offset + take - 1}`, Prefer: "count=exact" } },
  );
  const total = Number((list.headers.get("content-range") ?? "").split("/")[1] || 0);
  const leads = (await list.json()) as Array<{ id: string; phone: string; organization_id: string; workspace_id: string }>;
  let sent = 0;
  let failed = 0;
  let detail = "";
  let providerFailed = 0;
  for (const lead of Array.isArray(leads) ? leads : []) {
    const phone = String(lead.phone || "").replace(/\D/g, "");
    if (phone.length < 10 || phone.length > 15) {
      failed += 1;
      continue;
    }
    const payload = imageUrl
      ? { messaging_product: "whatsapp", to: phone, type: "image", image: { link: imageUrl, caption: text } }
      : { messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } };
    const graph = await fetch(`https://graph.facebook.com/v21.0/${secret.phone_number_id}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret.access_token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!graph.ok) {
      failed += 1;
      providerFailed += 1;
      if (!detail) {
        const errorBody = (await graph.json()) as { error?: { code?: number; message?: string } };
        const raw = (errorBody.error?.message || "WhatsApp rejected the message").replace(/access_token=[^&\s]+/g, "").slice(0, 160);
        const expired = errorBody.error?.code === 190 || /session has expired|authentication error/i.test(raw);
        detail = expired
          ? `The WhatsApp token for ${fromPhone} has expired. In Settings, open WhatsApp and paste a token that does not expire.`
          : raw;
        if (expired) break;
      }
      if (sent === 0 && providerFailed >= 3) break;
      continue;
    }
    const provider = (await graph.json()) as { messages?: Array<{ id: string }> };
    await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({
        organization_id: lead.organization_id,
        workspace_id: lead.workspace_id,
        lead_id: lead.id,
        channel: "whatsapp",
        direction: "outbound",
        body: [text, imageUrl ? "Poster attached" : ""].filter(Boolean).join("\n"),
        provider_message_id: provider.messages?.[0]?.id ?? "",
        status: "sent",
      }),
    });
    sent += 1;
  }
  const next = offset + (Array.isArray(leads) ? leads.length : 0);
  const capped = sent + failed >= remaining && next < total ? 1 : 0;
  return json(sent === 0 && failed > 0 ? 502 : 200, {
    status: capped ? "capped" : sent > 0 ? "sent" : "error",
    sent,
    failed,
    next,
    total,
    capped,
    detail: capped ? "Today's balance is used. Continue this campaign tomorrow." : detail,
  });
};
