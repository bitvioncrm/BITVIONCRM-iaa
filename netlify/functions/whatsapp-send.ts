import { loadChannelSecrets, sendingLine } from "../lib/channel-secrets.ts";
import {
  deliveryFailureMessage,
  checkWabaSendHealth,
  listApprovedTemplates,
  pickOutboundTemplate,
  sendWhatsAppGraph,
  templateBodyParams,
  templateNeedsImageHeader,
  waitForDelivery,
  whatsappTo,
} from "../lib/whatsapp-outbound.ts";

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

  const body = (await request.json()) as {
    leadId?: string;
    to?: string;
    text?: string;
    template?: string;
    bulkSize?: number;
    imageUrl?: string;
    workspaceId?: string;
    test?: boolean;
  };
  const bulkSize = Number(body.bulkSize ?? 1);
  if (!isAdmin && bulkSize > 50) return json(403, { status: "bulk_admin_only" });
  const text = body.text?.trim() ?? "";
  const template = body.template?.trim() ?? "";
  const imageUrl = body.imageUrl?.trim() ?? "";
  if ((!text && !template && !imageUrl) || text.length > 1000) return json(400, { status: "invalid", detail: "Add a message or a poster." });
  if (!body.to) return json(400, { status: "invalid", detail: "Enter a WhatsApp number." });
  const phone = whatsappTo(body.to);
  if (phone.length < 11 || phone.length > 15) return json(400, { status: "invalid_phone", detail: "Enter a valid WhatsApp number." });

  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  let organizationId = "";
  let workspaceId = body.workspaceId && UUID.test(body.workspaceId) ? body.workspaceId : "";
  let leadId: string | null = body.leadId && UUID.test(body.leadId) ? body.leadId : null;

  if (body.test) {
    if (!isAdmin) return json(403, { status: "forbidden", detail: "Only Admin can send a test message." });
    if (!workspaceId) return json(400, { status: "invalid", detail: "Choose a desk before sending a test." });
    const workspaceResponse = await fetch(`${supabaseUrl}/rest/v1/workspaces?id=eq.${workspaceId}&select=id,organization_id`, { headers });
    const workspaces = (await workspaceResponse.json()) as Array<{ id: string; organization_id: string }>;
    if (!workspaces[0]) return json(400, { status: "invalid", detail: "Desk not found." });
    organizationId = workspaces[0].organization_id;
  } else {
    if (!leadId) return json(400, { status: "invalid", detail: "Choose a chat before sending." });
    const leadResponse = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=id,assigned_to,organization_id,workspace_id`, { headers });
    const leads = (await leadResponse.json()) as Array<{ id: string; assigned_to: string | null; organization_id: string; workspace_id: string }>;
    const lead = leads[0];
    if (!lead) return json(403, { status: "forbidden" });
    organizationId = lead.organization_id;
    workspaceId = lead.workspace_id;
    const workspaceResponse = await fetch(`${supabaseUrl}/rest/v1/workspaces?id=eq.${lead.workspace_id}&select=workspace_type`, { headers });
    const workspaces = (await workspaceResponse.json()) as Array<{ workspace_type: string }>;
    const desk = workspaces[0]?.workspace_type ?? "";
    const onDesk = roles.some((row) => row.workspace_id === lead.workspace_id && (desk === "clinic" ? CLINIC_ROLES : INSTITUTE_ROLES).includes(roleKey(row.roles)));
    if (!isAdmin && !onDesk) return json(403, { status: "forbidden" });
  }

  const line = sendingLine(await loadChannelSecrets(supabaseUrl, serviceKey, "whatsapp"), workspaceId);
  const fromPhone = line?.display_phone || "this desk";
  const phoneId = line?.phone_number_id || "";
  const accessToken = line?.access_token || "";
  const wabaId = line?.waba_id || "";
  if (!phoneId || !accessToken) return json(503, { status: "configuration_required", detail: `Save a WhatsApp access token for ${fromPhone}.` });

  if (body.test || template) {
    const health = await checkWabaSendHealth(wabaId, accessToken);
    if (!health.ok) return json(503, { status: "provider_blocked", detail: health.detail });
  }

  const coldOutreach = Boolean(body.test);
  let templateName = template && !/^hello_world$/i.test(template) ? template : "";
  let templateLanguage = "en";
  let templateParams: string[] | undefined;
  if (coldOutreach || templateName) {
    const approved = await listApprovedTemplates(wabaId, accessToken);
    const chosen = templateName
      ? approved.find((row) => row.name === templateName && !/^hello_world$/i.test(row.name)) || null
      : pickOutboundTemplate(approved);
    if (chosen) {
      templateName = chosen.name;
      templateLanguage = chosen.language || "en";
      templateParams = templateBodyParams(chosen.name, "there", text);
    } else {
      templateName = "";
    }
  }

  const graph = await sendWhatsAppGraph({
    phoneNumberId: phoneId,
    token: accessToken,
    to: phone,
    text,
    imageUrl: templateName && !templateNeedsImageHeader(templateName) ? undefined : imageUrl || undefined,
    templateName: templateName || undefined,
    templateLanguage,
    templateParams,
  });
  if (!graph.ok) return json(502, { status: "provider_rejected", detail: graph.detail });

  await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      organization_id: organizationId,
      workspace_id: workspaceId,
      lead_id: leadId,
      channel: "whatsapp",
      direction: "outbound",
      body: [body.test ? "Test message" : "", text, imageUrl && !templateName ? "Poster attached" : "", templateName ? `Template: ${templateName}` : ""].filter(Boolean).join("\n") || templateName,
      provider_message_id: graph.providerMessageId,
      status: "sent",
    }),
  });

  if (body.test) {
    const delivery = await waitForDelivery(supabaseUrl, serviceKey, graph.providerMessageId, 12000);
    const failed = deliveryFailureMessage(delivery.status, delivery.error, graph.to);
    if (failed) {
      const hint = templateName
        ? failed
        : `${failed} Tip: if ${graph.to} messaged ${fromPhone} in the last 24 hours it will deliver as free-form; otherwise wait for Meta to approve crm_desk_notice / crm_campaign_update.`;
      return json(502, { status: "delivery_failed", detail: hint.slice(0, 280) });
    }
    if (delivery.status === "delivered" || delivery.status === "read") {
      return json(200, { status: "sent", detail: `Test delivered to ${graph.to} from ${fromPhone}.` });
    }
    return json(200, {
      status: "sent",
      detail: templateName
        ? `Test submitted to ${graph.to} via template ${templateName}. Delivery not confirmed yet — check the phone.`
        : `Test submitted to ${graph.to} from ${fromPhone}. Check the phone; cold numbers need an approved template.`,
    });
  }

  return json(200, { status: "sent", detail: "sent" });
};
