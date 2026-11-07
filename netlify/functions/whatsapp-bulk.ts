import { loadChannelSecrets, sendingLine } from "../lib/channel-secrets.ts";

function required(name: string) {
  return process.env[name]?.trim() || "";
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function roleKey(value: { key: string } | { key: string }[] | null) {
  if (Array.isArray(value)) return value[0]?.key ?? "";
  return value?.key ?? "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 5;

type SendRow = {
  leadId: string;
  phone: string;
  name: string;
  status: "sent" | "failed" | "skipped";
  detail: string;
};

export default async (request: Request) => {
  try {
    if (request.method !== "POST") return json(405, { status: "method_not_allowed", detail: "Use POST." });
    const supabaseUrl = required("SUPABASE_URL");
    const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
    const anon = required("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anon) return json(503, { status: "configuration_required", detail: "Server keys are missing." });

    const jwt = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { status: "unauthorized", detail: "Sign in again before sending." });
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } });
    if (!userResponse.ok) return json(401, { status: "unauthorized", detail: "Sign in again before sending." });
    const user = (await userResponse.json()) as { id?: string };
    if (!user.id) return json(401, { status: "unauthorized", detail: "Sign in again before sending." });
    const roleResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user.id}&select=workspace_id,roles(key)`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    });
    const roles = (await roleResponse.json()) as Array<{ workspace_id: string | null; roles: { key: string } | { key: string }[] | null }>;
    const admin = roles.some((row) => ["admin", "super_admin"].includes(roleKey(row.roles)));

    const body = (await request.json()) as { text?: string; imageUrl?: string; workspaceId?: string; offset?: number; campaignId?: string };
    const text = body.text?.trim() ?? "";
    const imageUrl = body.imageUrl?.trim() ?? "";
    if ((!text && !imageUrl) || text.length > 1000) return json(400, { status: "invalid", detail: "Add a message or a poster." });
    const offset = Math.max(0, Number(body.offset ?? 0));
    const workspaceId = body.workspaceId && UUID.test(body.workspaceId) ? body.workspaceId : "";
    const campaignId = body.campaignId && UUID.test(body.campaignId) ? body.campaignId : "";
    if (!admin) return json(403, { status: "forbidden", detail: "Bulk messaging is limited to Admin." });

    const secret = sendingLine(await loadChannelSecrets(supabaseUrl, serviceKey, "whatsapp"), workspaceId);
    const fromPhone = secret?.display_phone || "this desk";
    if (!secret?.access_token || !secret.phone_number_id) {
      return json(503, { status: "configuration_required", detail: `Save a WhatsApp access token for ${fromPhone}.` });
    }

    const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
    const filter = workspaceId ? `&workspace_id=eq.${workspaceId}` : "";
    const list = await fetch(
      `${supabaseUrl}/rest/v1/leads?select=id,phone,full_name,organization_id,workspace_id&deleted_at=is.null&phone=neq.${filter}&order=created_at.desc`,
      { headers: { ...headers, Range: `${offset}-${offset + BATCH - 1}`, Prefer: "count=exact" } },
    );
    if (!list.ok) {
      return json(502, { status: "error", detail: "Could not load leads for this send.", sent: 0, failed: 0, next: offset, total: 0, capped: 0, results: [] });
    }
    const total = Number((list.headers.get("content-range") ?? "").split("/")[1] || 0);
    const leads = (await list.json()) as Array<{ id: string; phone: string; full_name?: string; organization_id: string; workspace_id: string }>;
    let sent = 0;
    let failed = 0;
    let detail = "";
    let providerFailed = 0;
    const results: SendRow[] = [];
    const persist: Array<Record<string, string>> = [];

    for (const lead of Array.isArray(leads) ? leads : []) {
      const phone = String(lead.phone || "").replace(/\D/g, "");
      const name = String(lead.full_name || "").trim() || "Lead";
      const displayPhone = String(lead.phone || phone || "");
      if (phone.length < 10 || phone.length > 15) {
        failed += 1;
        results.push({ leadId: lead.id, phone: displayPhone, name, status: "skipped", detail: "Invalid phone number" });
        if (campaignId) {
          persist.push({
            organization_id: lead.organization_id,
            workspace_id: lead.workspace_id,
            campaign_id: campaignId,
            lead_id: lead.id,
            phone: displayPhone,
            lead_name: name,
            status: "skipped",
            detail: "Invalid phone number",
          });
        }
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
        const errorBody = (await graph.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
        const raw = (errorBody.error?.message || "WhatsApp rejected the message").replace(/access_token=[^&\s]+/g, "").slice(0, 160);
        const expired = errorBody.error?.code === 190 || /session has expired|authentication error/i.test(raw);
        if (!detail) {
          detail = expired
            ? `The WhatsApp token for ${fromPhone} has expired. In Settings, open WhatsApp and paste a token that does not expire.`
            : raw;
        }
        results.push({ leadId: lead.id, phone: displayPhone, name, status: "failed", detail: raw });
        if (campaignId) {
          persist.push({
            organization_id: lead.organization_id,
            workspace_id: lead.workspace_id,
            campaign_id: campaignId,
            lead_id: lead.id,
            phone: displayPhone,
            lead_name: name,
            status: "failed",
            detail: raw,
          });
        }
        if (expired) break;
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
      results.push({ leadId: lead.id, phone: displayPhone, name, status: "sent", detail: "" });
      if (campaignId) {
        persist.push({
          organization_id: lead.organization_id,
          workspace_id: lead.workspace_id,
          campaign_id: campaignId,
          lead_id: lead.id,
          phone: displayPhone,
          lead_name: name,
          status: "sent",
          detail: "",
        });
      }
    }

    if (persist.length) {
      await fetch(`${supabaseUrl}/rest/v1/whatsapp_campaign_sends`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify(persist),
      });
    }

    const next = offset + (Array.isArray(leads) ? leads.length : 0);
    return json(sent === 0 && failed > 0 ? 502 : 200, {
      status: sent > 0 ? "sent" : "error",
      sent,
      failed,
      next,
      total,
      capped: 0,
      detail,
      results,
    });
  } catch (reason: unknown) {
    const detail = reason instanceof Error ? reason.message.slice(0, 180) : "Bulk send failed.";
    return json(500, { status: "error", detail, sent: 0, failed: 0, next: 0, total: 0, capped: 0, results: [] });
  }
};
