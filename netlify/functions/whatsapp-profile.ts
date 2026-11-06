import { loadChannelSecrets, sendingLine } from "../lib/channel-secrets.ts";

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

async function requireAdmin(request: Request) {
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const anon = required("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anon) return { error: json(503, { status: "configuration_required" }) };
  const jwt = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return { error: json(401, { status: "unauthorized" }) };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } });
  if (!userResponse.ok) return { error: json(401, { status: "unauthorized" }) };
  const user = (await userResponse.json()) as { id?: string };
  if (!user.id) return { error: json(401, { status: "unauthorized" }) };
  const roleResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user.id}&select=roles(key)`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  const roles = (await roleResponse.json()) as Array<{ roles: { key: string } | { key: string }[] | null }>;
  const admin = roles.some((row) => ["admin", "super_admin"].includes(roleKey(row.roles)));
  if (!admin) return { error: json(403, { status: "forbidden" }) };
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const line = sendingLine(await loadChannelSecrets(supabaseUrl, serviceKey, "whatsapp"), workspaceId);
  if (!line?.access_token || !line.phone_number_id) return { error: json(503, { status: "configuration_required", detail: "Save the WhatsApp token first." }) };
  return { line };
}

async function profileFields(line: { access_token: string; phone_number_id: string; display_phone: string }) {
  const profile = await fetch(
    `https://graph.facebook.com/v21.0/${line.phone_number_id}/whatsapp_business_profile?fields=about,description,profile_picture_url`,
    { headers: { authorization: `Bearer ${line.access_token}` } },
  );
  const body = (await profile.json()) as { data?: Array<{ profile_picture_url?: string; about?: string; description?: string }>; error?: { message?: string } };
  const row = body.data?.[0];
  return {
    status: profile.ok ? "connected" : "profile_unavailable",
    phone: line.display_phone || "",
    name: row?.about || row?.description || "WhatsApp",
    pictureUrl: row?.profile_picture_url || "",
    detail: body.error?.message || "",
  };
}

export default async (request: Request) => {
  if (request.method !== "GET" && request.method !== "POST") return json(405, { status: "method_not_allowed" });
  const auth = await requireAdmin(request);
  if (auth.error || !auth.line) return auth.error ?? json(401, { status: "unauthorized" });
  const line = auth.line;

  if (request.method === "POST") {
    if (!line.app_id) return json(503, { status: "configuration_required", detail: "Save the WhatsApp app ID before setting the profile photo." });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json(400, { status: "invalid", detail: "Choose a profile photo." });
    if (file.size < 1 || file.size > 5 * 1024 * 1024) return json(400, { status: "invalid", detail: "Use a JPG or PNG under 5 MB." });
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const session = await fetch(
      `https://graph.facebook.com/v21.0/${line.app_id}/uploads?file_name=${encodeURIComponent(file.name || "profile.jpg")}&file_length=${bytes.byteLength}&file_type=${encodeURIComponent(type)}`,
      { method: "POST", headers: { authorization: `Bearer ${line.access_token}` } },
    );
    const sessionBody = (await session.json()) as { id?: string; error?: { message?: string } };
    if (!session.ok || !sessionBody.id) return json(502, { status: "error", detail: sessionBody.error?.message || "WhatsApp did not start the photo upload." });
    const uploaded = await fetch(`https://graph.facebook.com/v21.0/${sessionBody.id}`, {
      method: "POST",
      headers: { authorization: `OAuth ${line.access_token}`, file_offset: "0", "content-type": "application/octet-stream" },
      body: bytes,
    });
    const uploadedBody = (await uploaded.json()) as { h?: string; error?: { message?: string } };
    if (!uploaded.ok || !uploadedBody.h) return json(502, { status: "error", detail: uploadedBody.error?.message || "WhatsApp did not accept the photo." });
    const saved = await fetch(`https://graph.facebook.com/v21.0/${line.phone_number_id}/whatsapp_business_profile`, {
      method: "POST",
      headers: { authorization: `Bearer ${line.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", profile_picture_handle: uploadedBody.h }),
    });
    const savedBody = (await saved.json()) as { success?: boolean; error?: { message?: string } };
    if (!saved.ok) return json(502, { status: "error", detail: savedBody.error?.message || "WhatsApp did not update the profile photo." });
  }

  return json(200, await profileFields(line));
};
