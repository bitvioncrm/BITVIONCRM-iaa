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

  const whatsappRows = channel === "whatsapp" ? rows : await loadChannelSecrets(supabaseUrl, serviceKey, "whatsapp");
  const metaRows = channel === "meta" ? rows : await loadChannelSecrets(supabaseUrl, serviceKey, "meta");
  const line = channel === "whatsapp" ? sendingLine(whatsappRows) : secret;
  const target = channel === "meta" ? secret?.page_id : line?.phone_number_id;
  if (!target) return json(400, { status: "invalid", detail: channel === "meta" ? "Page ID is required." : "Phone number ID is required." });
  const tokens = channel === "whatsapp" ? tokenCandidates(line, metaRows) : uniqueFrom(secret?.access_token);
  if (!tokens.length) return json(503, { status: "configuration_required", detail: "Save an access token for this desk first." });
  const fields = channel === "meta" ? "id,name" : "id,display_phone_number,verified_name";
  let ok = false;
  let detail = "Meta rejected the credentials.";
  let working = "";
  let display = "";
  for (const token of tokens) {
    const graph = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(target)}?fields=${fields}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = (await graph.json()) as { name?: string; display_phone_number?: string; verified_name?: string; error?: { message?: string; code?: number } };
    if (graph.ok && !payload.error) {
      ok = true;
      working = token;
      display = payload.display_phone_number || payload.name || "";
      detail = channel === "meta"
        ? `Meta page connected${payload.name ? `: ${payload.name}` : ""}.`
        : `WhatsApp number connected${payload.display_phone_number ? `: ${payload.display_phone_number}` : ""}.`;
      break;
    }
    detail = (payload.error?.message || "Meta rejected the credentials.").replace(/access_token=[^&\s]+/g, "").slice(0, 180);
    if (payload.error?.code !== 190) break;
  }

  if (ok && channel === "whatsapp" && line && working && working !== line.access_token) {
    await rememberWhatsAppToken(supabaseUrl, serviceKey, line.workspace_id, working, detail);
  } else {
    await fetch(`${supabaseUrl}/rest/v1/workspace_channel_secrets?workspace_id=eq.${(channel === "whatsapp" ? line?.workspace_id : secret?.workspace_id) || body.workspaceId}&channel=eq.${channel}`, {
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
  }

  return json(ok ? 200 : 502, { status: ok ? "connected" : "error", detail, display });
};

function uniqueFrom(value?: string) {
  return value?.trim() ? [value.trim()] : [];
}
