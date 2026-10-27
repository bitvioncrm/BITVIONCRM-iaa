import { loadChannelSecrets, rememberWhatsAppToken, sendingLine, tokenCandidates } from "../lib/channel-secrets.ts";

function required(name: string) {
  return process.env[name]?.trim() || "";
}

function json(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function roleKey(value: { key: string } | { key: string }[] | null) {
  if (Array.isArray(value)) return value[0]?.key ?? "";
  return value?.key ?? "";
}

const CLINIC_ROLES = ["clinic_telecaller", "clinic_bde"];
const INSTITUTE_ROLES = ["institute_telecaller", "institute_bde", "institute_user"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (request: Request) => {
  if (request.method !== "POST") return json(405, { status: "method_not_allowed" });
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const anon = required("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anon) return json(503, { status: "configuration_required" });

  const jwt = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { status: "unauthorized" });
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } });
  if (!userResponse.ok) return json(401, { status: "unauthorized" });
  const user = (await userResponse.json()) as { id?: string };
  if (!user.id || !UUID.test(user.id)) return json(401, { status: "unauthorized" });

  const roleResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user.id}&select=workspace_id,roles(key)`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  const roles = (await roleResponse.json()) as Array<{ workspace_id: string | null; roles: { key: string } | { key: string }[] | null }>;
  const keys = roles.map((row) => roleKey(row.roles)).filter(Boolean);
  const isAdmin = keys.includes("admin") || keys.includes("super_admin");

  const body = (await request.json()) as { leadId?: string; to?: string; text?: string; template?: string; bulkSize?: number; imageUrl?: string };
  const bulkSize = Number(body.bulkSize ?? 1);
  if (!isAdmin && bulkSize > 50) return json(403, { status: "bulk_admin_only" });
  if (!body.leadId || !UUID.test(body.leadId) || !body.to) return json(400, { status: "invalid" });
  const text = body.text?.trim() ?? "";
  const template = body.template?.trim() ?? "";
  const imageUrl = body.imageUrl?.trim() ?? "";
  if ((!text && !template && !imageUrl) || text.length > 1000) return json(400, { status: "invalid" });
  const phone = body.to.replace(/\D/g, "");
  if (phone.length < 10 || phone.length > 15) return json(400, { status: "invalid_phone" });

  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const leadResponse = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${body.leadId}&select=id,assigned_to,organization_id,workspace_id`, { headers });
  const leads = (await leadResponse.json()) as Array<{ id: string; assigned_to: string | null; organization_id: string; workspace_id: string }>;
  const lead = leads[0];
  if (!lead) return json(403, { status: "forbidden" });
  const workspaceResponse = await fetch(`${supabaseUrl}/rest/v1/workspaces?id=eq.${lead.workspace_id}&select=workspace_type`, { headers });
  const workspaces = (await workspaceResponse.json()) as Array<{ workspace_type: string }>;
  const desk = workspaces[0]?.workspace_type ?? "";
  const onDesk = roles.some((row) => row.workspace_id === lead.workspace_id && (desk === "clinic" ? CLINIC_ROLES : INSTITUTE_ROLES).includes(roleKey(row.roles)));
  if (!isAdmin && !onDesk) return json(403, { status: "forbidden" });

  const whatsappRows = await loadChannelSecrets(supabaseUrl, serviceKey, "whatsapp");
  const metaRows = await loadChannelSecrets(supabaseUrl, serviceKey, "meta");
  const line = sendingLine(whatsappRows);
  const phoneId = line?.phone_number_id || (desk === "institute"
    ? required("WHATSAPP_INSTITUTE_PHONE_NUMBER_ID")
    : required("WHATSAPP_CLINIC_PHONE_NUMBER_ID") || required("WHATSAPP_PHONE_NUMBER_ID"));
  const tokens = tokenCandidates(line, metaRows);
  const envToken = desk === "institute" ? required("WHATSAPP_INSTITUTE_TOKEN") || required("WHATSAPP_TOKEN") : required("WHATSAPP_CLINIC_TOKEN") || required("WHATSAPP_TOKEN");
  if (envToken && !tokens.includes(envToken)) tokens.push(envToken);
  if (!phoneId || !tokens.length) return json(503, { status: "configuration_required", detail: "Save a WhatsApp access token for +91 95624 29928." });

  const payload = template
    ? { messaging_product: "whatsapp", to: phone, type: "template", template: { name: template, language: { code: "en" } } }
    : imageUrl
      ? { messaging_product: "whatsapp", to: phone, type: "image", image: { link: imageUrl, caption: text } }
      : { messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } };
  let sent: Response | null = null;
  let working = "";
  let detail = "WhatsApp rejected the message.";
  for (const token of tokens) {
    const attempt = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (attempt.ok) {
      sent = attempt;
      working = token;
      break;
    }
    const errorBody = (await attempt.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    detail = (errorBody.error?.message || "WhatsApp rejected the message.").replace(/access_token=[^&\s]+/g, "").slice(0, 180);
    if (errorBody.error?.code !== 190) break;
  }
  if (!sent || !working) return json(502, { status: "provider_rejected", detail });
  if (line && working !== line.access_token) await rememberWhatsAppToken(supabaseUrl, serviceKey, line.workspace_id, working, "WhatsApp connected: +91 95624 29928.");
  const provider = (await sent.json()) as { messages?: Array<{ id: string }> };
  await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      organization_id: lead.organization_id,
      workspace_id: lead.workspace_id,
      lead_id: lead.id,
      channel: "whatsapp",
      direction: "outbound",
      body: [text, imageUrl ? "Poster attached" : "", template].filter(Boolean).join("\n") || template,
      provider_message_id: provider.messages?.[0]?.id ?? "",
      status: "sent",
    }),
  });
  return json(200, { status: "sent" });
};
