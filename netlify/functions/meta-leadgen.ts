import { createHmac, timingSafeEqual } from "node:crypto";

function required(name: string) {
  const value = process.env[name]?.trim();
  return value || "";
}

function json(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function signatureOk(raw: string, header: string, secret: string) {
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async (request: Request) => {
  const verify = required("META_VERIFY_TOKEN");
  const secret = required("META_APP_SECRET");
  const token = required("META_PAGE_TOKEN");
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const organizationId = required("META_ORGANIZATION_ID");
  const workspaceId = required("META_WORKSPACE_ID");

  if (request.method === "GET") {
    const url = new URL(request.url);
    if (!verify) return json(503, { status: "configuration_required" });
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verify) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return json(403, { status: "rejected" });
  }

  if (!secret || !token || !supabaseUrl || !serviceKey || !organizationId || !workspaceId) {
    return json(503, { status: "configuration_required" });
  }

  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!signatureOk(raw, signature, secret)) return json(401, { status: "invalid_signature" });

  const payload = JSON.parse(raw) as {
    entry?: Array<{ changes?: Array<{ value?: { leadgen_id?: string; form_id?: string; page_id?: string; ad_id?: string } }> }>;
  };
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  const leadgenId = value?.leadgen_id;
  if (!leadgenId) return json(200, { status: "ignored" });

  const seen = await fetch(`${supabaseUrl}/rest/v1/processed_events`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify({ provider: "meta", external_event_id: leadgenId }),
  });
  if (!seen.ok) return json(502, { status: "event_store_failed" });
  const storedEvents = (await seen.json()) as unknown[];
  if (!Array.isArray(storedEvents) || storedEvents.length === 0) return json(200, { status: "duplicate" });

  const graph = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?access_token=${encodeURIComponent(token)}`);
  if (!graph.ok) return json(502, { status: "graph_failed" });
  const lead = (await graph.json()) as { field_data?: Array<{ name: string; values: string[] }>; campaign_name?: string; form_id?: string };
  const field = (name: string) => lead.field_data?.find((item) => item.name === name)?.values?.[0] ?? "";
  const inserted = await fetch(`${supabaseUrl}/rest/v1/leads`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({
      organization_id: organizationId,
      workspace_id: workspaceId,
      full_name: field("full_name") || field("name") || "Meta lead",
      phone: field("phone_number") || field("phone"),
      email: field("email"),
      source: "meta_ads",
      source_platform: "meta",
      source_campaign: lead.campaign_name ?? value?.ad_id ?? "",
      source_form: lead.form_id ?? value?.form_id ?? "",
      status: "new",
    }),
  });
  if (!inserted.ok) return json(502, { status: "lead_insert_failed" });
  const created = (await inserted.json()) as Array<{ id: string }>;
  const leadId = created[0]?.id;
  if (leadId && required("META_ASSIGNMENT") === "round_robin") {
    const assignee = await fetch(`${supabaseUrl}/rest/v1/rpc/next_bde`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ws: workspaceId }),
    });
    const userId = assignee.ok ? ((await assignee.json()) as string | null) : null;
    if (userId) {
      await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
        method: "PATCH",
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        body: JSON.stringify({ assigned_to: userId, assigned_at: new Date().toISOString() }),
      });
    }
  }
  return json(200, { status: "stored" });
};
