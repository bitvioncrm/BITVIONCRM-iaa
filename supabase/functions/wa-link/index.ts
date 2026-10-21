import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { linkWhatsAppDesks } from "./whatsapp-link.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ status: "rejected" }), { status: 405 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = request.headers.get("x-hook-token") ?? "";
  const secrets = await fetch(`${supabaseUrl}/rest/v1/workspace_channel_secrets?channel=eq.meta&select=verify_token`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  const rows = secrets.ok ? ((await secrets.json()) as Array<{ verify_token?: string }>) : [];
  if (!provided || !rows.some((row) => row.verify_token && row.verify_token === provided)) {
    return new Response(JSON.stringify({ status: "rejected" }), { status: 401 });
  }
  const result = await linkWhatsAppDesks(supabaseUrl, serviceKey);
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
});
