import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { createHash, randomUUID } from "crypto";

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
const filePath = "C:/Users/akhil/.cursor/projects/d-Bitvion-Techzz-BITVION-CRM/assets/image-04c2b311-45cd-4bec-b814-f00586740b02.jpg";
const body =
  "✨ Celebrate Diwali with Dr. K’s Aesthetics! 🪔 Enjoy 20% OFF on eligible treatments with our exclusive 6-month membership offer. 💛 Offer valid from October 26 to November 26. Don't miss out! ✨";

const bytes = readFileSync(filePath);
const checksum = createHash("sha256").update(bytes).digest("hex");
const safeName = "diwali-membership-offer.jpg";
const storagePath = `${orgId}/${workspaceId}/whatsapp_poster/${randomUUID()}-${safeName}`;

const existing = await sb.from("documents").select("id, storage_path").eq("organization_id", orgId).eq("checksum", checksum).limit(1);
let posterId = existing.data?.[0]?.id || "";
let storage = existing.data?.[0]?.storage_path || "";

if (!posterId) {
  const up = await sb.storage.from("documents").upload(storagePath, bytes, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  storage = storagePath;
  const { data: doc, error: docErr } = await sb
    .from("documents")
    .insert({
      organization_id: orgId,
      workspace_id: workspaceId,
      entity_type: "whatsapp_poster",
      entity_id: workspaceId,
      filename: safeName,
      storage_path: storagePath,
      mime_type: "image/jpeg",
      original_size: bytes.length,
      optimized_size: bytes.length,
      checksum,
      category: "marketing",
      processing_status: "ready",
      verification_status: "verified",
    })
    .select("id")
    .single();
  if (docErr) throw new Error(`doc: ${docErr.message}`);
  posterId = doc.id;
} else {
  const { data: linked } = await sb
    .from("documents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("entity_type", "whatsapp_poster")
    .eq("checksum", checksum)
    .limit(1)
    .maybeSingle();
  if (!linked?.id) {
    const { data: doc, error: docErr } = await sb
      .from("documents")
      .insert({
        organization_id: orgId,
        workspace_id: workspaceId,
        entity_type: "whatsapp_poster",
        entity_id: workspaceId,
        filename: safeName,
        storage_path: storage,
        mime_type: "image/jpeg",
        original_size: bytes.length,
        optimized_size: bytes.length,
        checksum,
        category: "marketing",
        processing_status: "ready",
        verification_status: "verified",
      })
      .select("id")
      .single();
    if (docErr) throw new Error(`doc link: ${docErr.message}`);
    posterId = doc.id;
  } else {
    posterId = linked.id;
  }
}

const signed = await sb.storage.from("documents").createSignedUrl(storage, 60 * 60 * 24 * 7);
const imageUrl = signed.data?.signedUrl || "";
if (!imageUrl) throw new Error("Could not sign poster URL");

const { count } = await sb
  .from("leads")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", workspaceId)
  .is("deleted_at", null)
  .neq("phone", "");

const { data: existingCamp } = await sb
  .from("whatsapp_campaigns")
  .select("id")
  .eq("workspace_id", workspaceId)
  .eq("name", "Diwali Membership Offer")
  .is("deleted_at", null)
  .limit(1)
  .maybeSingle();

let campaignId = existingCamp?.id || "";
if (campaignId) {
  const { error } = await sb
    .from("whatsapp_campaigns")
    .update({
      body,
      poster_path: posterId,
      status: "draft",
      total_count: count || 0,
      cursor_offset: 0,
      sent_count: 0,
      failed_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
  if (error) throw new Error(`camp update: ${error.message}`);
} else {
  const { data: camp, error: campErr } = await sb
    .from("whatsapp_campaigns")
    .insert({
      organization_id: orgId,
      workspace_id: workspaceId,
      name: "Diwali Membership Offer",
      body,
      poster_path: posterId,
      status: "draft",
      sent_count: 0,
      failed_count: 0,
      total_count: count || 0,
      cursor_offset: 0,
    })
    .select("id")
    .single();
  if (campErr) throw new Error(`camp: ${campErr.message}`);
  campaignId = camp.id;
}

const { data: secret } = await sb
  .from("workspace_channel_secrets")
  .select("access_token,phone_number_id,display_phone,waba_id")
  .eq("channel", "whatsapp")
  .eq("phone_number_id", "1347562095115257")
  .limit(1)
  .single();

const templates = await fetch(
  `https://graph.facebook.com/v21.0/${secret.waba_id}/message_templates?limit=30&fields=name,status,language`,
  { headers: { authorization: `Bearer ${secret.access_token}` } },
).then((r) => r.json());
const approved = (templates.data || []).filter((t) => String(t.status).toUpperCase() === "APPROVED" && t.name !== "hello_world");
const chosen = approved.find((t) => t.name === "crm_campaign_update") || approved.find((t) => t.name === "crm_desk_notice") || null;

let sendPayload;
if (chosen) {
  sendPayload = {
    messaging_product: "whatsapp",
    to: "918137864105",
    type: "template",
    template: {
      name: chosen.name,
      language: { code: chosen.language || "en" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "there" },
            { type: "text", text: body.slice(0, 900) },
          ],
        },
      ],
    },
  };
} else {
  sendPayload = {
    messaging_product: "whatsapp",
    to: "918137864105",
    type: "image",
    image: { link: imageUrl, caption: body },
  };
}

const send = await fetch(`https://graph.facebook.com/v21.0/${secret.phone_number_id}/messages`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret.access_token}`, "content-type": "application/json" },
  body: JSON.stringify(sendPayload),
});
const sj = await send.json();
const wamid = sj.messages?.[0]?.id || "";
if (wamid) {
  await sb.from("messages").insert({
    organization_id: orgId,
    workspace_id: workspaceId,
    channel: "whatsapp",
    direction: "outbound",
    body: `Test message\n${body}\nPoster attached`,
    provider_message_id: wamid,
    status: "sent",
  });
  await new Promise((r) => setTimeout(r, 12000));
}
const { data: row } = wamid
  ? await sb.from("messages").select("status,provider_error").eq("provider_message_id", wamid).maybeSingle()
  : { data: null };

console.log(
  JSON.stringify(
    {
      campaignId,
      posterId,
      recipients: count,
      from: secret.display_phone,
      mode: chosen ? `template:${chosen.name}` : "image+caption",
      graphHttp: send.status,
      graph: sj,
      delivery: row,
      imageUrlReady: Boolean(imageUrl),
    },
    null,
    2,
  ),
);
