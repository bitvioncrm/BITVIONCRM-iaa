import { loadChannelSecrets } from "../lib/channel-secrets.ts";

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

function plain(message: string) {
  const text = message.replace(/access_token=[^&\s]+/g, "").slice(0, 180);
  if (/session has expired/i.test(text)) {
    return "The WhatsApp token expired. In Meta, generate a token that does not expire and paste it under Settings, WhatsApp, on the clinic number +91 95624 29928.";
  }
  return text;
}

export default async (request: Request) => {
  if (request.method !== "POST") return json(405, { status: "method_not_allowed" });
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const anon = required("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anon) return json(503, { status: "configuration_required", detail: "Server Supabase keys are missing." });

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
  const admin = roles.some((row) => ["admin", "super_admin"].includes(roleKey(row.roles)));
  if (!admin) return json(403, { status: "forbidden" });

  const body = (await request.json()) as { workspaceId?: string; channel?: string };
  const channel = body.channel === "whatsapp" ? "whatsapp" : body.channel === "meta" ? "meta" : "";
  if (!body.workspaceId || !channel) return json(400, { status: "invalid" });

  const rows = await loadChannelSecrets(supabaseUrl, serviceKey, channel);
  const secret = rows.find((row) => row.workspace_id === body.workspaceId);
  if (!secret?.access_token) return json(503, { status: "configuration_required", detail: "Save an access token for this desk first." });

  const target = channel === "meta" ? secret.page_id : secret.phone_number_id;
  if (!target) return json(400, { status: "invalid", detail: channel === "meta" ? "Page ID is required." : "Phone number ID is required." });
  const fields = channel === "meta" ? "id,name" : "id,display_phone_number,verified_name";
  const graph = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(target)}?fields=${fields}`, {
    headers: { authorization: `Bearer ${secret.access_token}` },
  });
  const payload = (await graph.json()) as { name?: string; display_phone_number?: string; error?: { message?: string } };
  const ok = graph.ok && !payload.error;
  const detail = ok
    ? (channel === "meta"
      ? `Meta page connected${payload.name ? `: ${payload.name}` : ""}.`
      : `WhatsApp number connected${payload.display_phone_number ? `: ${payload.display_phone_number}` : ""}.`)
    : plain(payload.error?.message || "Meta rejected the credentials.");

  await fetch(`${supabaseUrl}/rest/v1/workspace_channel_secrets?workspace_id=eq.${body.workspaceId}&channel=eq.${channel}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      status: ok ? "connected" : "error",
      detail,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  return json(ok ? 200 : 502, { status: ok ? "connected" : "error", detail });
};
