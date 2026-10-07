function required(name: string) {
  return process.env[name]?.trim() || "";
}

function json(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default async (request: Request) => {
  if (request.method !== "POST") return json(405, { status: "method_not_allowed" });
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const anon = required("SUPABASE_ANON_KEY");
  const token = required("WHATSAPP_TOKEN");
  const phoneId = required("WHATSAPP_PHONE_NUMBER_ID");
  if (!supabaseUrl || !serviceKey || !anon || !token || !phoneId) return json(503, { status: "configuration_required" });

  const jwt = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { status: "unauthorized" });
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } });
  if (!userResponse.ok) return json(401, { status: "unauthorized" });
  const user = (await userResponse.json()) as { id?: string };
  if (!user.id) return json(401, { status: "unauthorized" });
  const roleResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user.id}&select=roles(key)`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  const roles = (await roleResponse.json()) as Array<{ roles: { key: string } | { key: string }[] | null }>;
  const keys = roles.flatMap((row) => {
    const value = row.roles;
    if (Array.isArray(value)) return value.map((item) => item.key);
    return value?.key ? [value.key] : [];
  });
  if (!keys.includes("admin") && !keys.includes("super_admin")) return json(403, { status: "admin_only" });
  const body = (await request.json()) as { leadId?: string; to?: string; template?: string };
  if (!body.leadId || !body.to || !body.template) return json(400, { status: "invalid" });

  const leadResponse = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${body.leadId}&select=id,assigned_to,organization_id,workspace_id`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  const leads = (await leadResponse.json()) as Array<{ id: string; assigned_to: string | null; organization_id: string; workspace_id: string }>;
  const lead = leads[0];
  if (!lead) return json(403, { status: "forbidden" });

  const sent = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: body.to,
      type: "template",
      template: { name: body.template, language: { code: "en" } },
    }),
  });
  if (!sent.ok) return json(502, { status: "provider_rejected" });
  const provider = (await sent.json()) as { messages?: Array<{ id: string }> };
  await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: "POST",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      organization_id: lead.organization_id,
      workspace_id: lead.workspace_id,
      lead_id: lead.id,
      channel: "whatsapp",
      direction: "outbound",
      body: body.template,
      provider_message_id: provider.messages?.[0]?.id ?? "",
      status: "sent",
    }),
  });
  return json(200, { status: "sent" });
};
