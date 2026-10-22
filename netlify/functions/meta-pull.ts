import { syncMetaLeads } from "../lib/meta-sync.ts";

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
  if (!user.id) return json(401, { status: "unauthorized" });

  const roleResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user.id}&select=roles(key)`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  const roles = (await roleResponse.json()) as Array<{ roles: { key: string } | { key: string }[] | null }>;
  const admin = roles.some((row) => ["admin", "super_admin"].includes(roleKey(row.roles)));
  if (!admin) return json(403, { status: "forbidden" });

  const result = await syncMetaLeads();
  return json(200, result);
};
