import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
const orgId = "60584727-8073-4d7e-8a80-51828db08381";
const workspaceId = "8d5ecf49-2ebc-4500-8b9e-65ae411bcf7b";
const { data: secret } = await sb
  .from("workspace_channel_secrets")
  .select("access_token,phone_number_id,waba_id,display_phone")
  .eq("channel", "whatsapp")
  .eq("phone_number_id", "1347562095115257")
  .limit(1)
  .single();

const { data: camp } = await sb
  .from("whatsapp_campaigns")
  .select("id,poster_path,body")
  .eq("id", "dcd8546f-39d2-4395-92cb-a029fdabae39")
  .single();
const { data: poster } = await sb.from("documents").select("storage_path").eq("id", camp.poster_path).single();
const signed = await sb.storage.from("documents").createSignedUrl(poster.storage_path, 60 * 60 * 24);
const imageUrl = signed.data?.signedUrl || "";

async function templateStatus() {
  const list = await fetch(
    `https://graph.facebook.com/v21.0/${secret.waba_id}/message_templates?name=diwali_membership_2026&fields=name,status,language,rejected_reason`,
    { headers: { authorization: `Bearer ${secret.access_token}` } },
  );
  const body = await list.json();
  return body.data?.[0] || null;
}

let row = await templateStatus();
console.log("start", row?.status, row?.rejected_reason);
for (let i = 0; i < 24 && row && String(row.status).toUpperCase() === "PENDING"; i += 1) {
  await new Promise((r) => setTimeout(r, 15000));
  row = await templateStatus();
  console.log("poll", i + 1, row?.status, row?.rejected_reason || "");
}

if (!row || String(row.status).toUpperCase() !== "APPROVED") {
  console.log(JSON.stringify({ ready: false, template: row }, null, 2));
  process.exit(0);
}

const send = await fetch(`https://graph.facebook.com/v21.0/${secret.phone_number_id}/messages`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret.access_token}`, "content-type": "application/json" },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to: "918137864105",
    type: "template",
    template: {
      name: "diwali_membership_2026",
      language: { code: row.language || "en" },
      components: [
        {
          type: "header",
          parameters: [{ type: "image", image: { link: imageUrl } }],
        },
      ],
    },
  }),
});
const sj = await send.json();
const wamid = sj.messages?.[0]?.id || "";
if (wamid) {
  await sb.from("messages").insert({
    organization_id: orgId,
    workspace_id: workspaceId,
    channel: "whatsapp",
    direction: "outbound",
    body: `Test message\n${camp.body}\nTemplate: diwali_membership_2026\nPoster attached`,
    provider_message_id: wamid,
    status: "sent",
  });
  await new Promise((r) => setTimeout(r, 12000));
}
const { data: delivery } = wamid
  ? await sb.from("messages").select("status,provider_error").eq("provider_message_id", wamid).maybeSingle()
  : { data: null };

if (delivery?.status === "delivered" || delivery?.status === "read") {
  await sb
    .from("whatsapp_campaigns")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("id", camp.id);
}

console.log(
  JSON.stringify(
    {
      ready: true,
      from: secret.display_phone,
      graphHttp: send.status,
      graph: sj,
      delivery,
      campaignId: camp.id,
    },
    null,
    2,
  ),
);
