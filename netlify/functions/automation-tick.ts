function required(name: string) {
  return process.env[name]?.trim() || "";
}

function json(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default async (request: Request) => {
  const secret = required("AUTOMATION_SECRET");
  if (!secret || request.headers.get("x-automation-secret") !== secret) return json(401, { status: "unauthorized" });
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(503, { status: "configuration_required" });

  const decision = required("WHATSAPP_TOKEN") ? "send" : "configuration_required";
  if (decision !== "send") return json(503, { status: decision });

  return json(200, { status: "ready" });
};
