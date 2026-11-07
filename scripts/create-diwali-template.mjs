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
const { data: secret } = await sb
  .from("workspace_channel_secrets")
  .select("app_id,access_token,waba_id,phone_number_id")
  .eq("channel", "whatsapp")
  .eq("phone_number_id", "1347562095115257")
  .limit(1)
  .single();

const token = secret.access_token;
const appId = secret.app_id;
const waba = secret.waba_id;
const filePath = "C:/Users/akhil/.cursor/projects/d-Bitvion-Techzz-BITVION-CRM/assets/image-04c2b311-45cd-4bec-b814-f00586740b02.jpg";
const bytes = readFileSync(filePath);
const bodyText =
  "Celebrate Diwali with Dr. K's Aesthetics! Enjoy 20% OFF on eligible treatments with our exclusive 6-month membership offer. Offer valid from October 26 to November 26. Don't miss out!";

const start = await fetch(
  `https://graph.facebook.com/v21.0/${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent("image/jpeg")}&file_name=${encodeURIComponent("diwali-membership-offer.jpg")}`,
  { method: "POST", headers: { authorization: `Bearer ${token}` } },
);
const startBody = await start.json();
if (!start.ok || !startBody.id) {
  console.log(JSON.stringify({ step: "upload_session", http: start.status, body: startBody }, null, 2));
  process.exit(1);
}

const upload = await fetch(`https://graph.facebook.com/v21.0/${startBody.id}`, {
  method: "POST",
  headers: {
    authorization: `OAuth ${token}`,
    file_offset: "0",
    "content-type": "application/octet-stream",
  },
  body: bytes,
});
const uploadBody = await upload.json();
if (!upload.ok || !uploadBody.h) {
  console.log(JSON.stringify({ step: "upload_bytes", http: upload.status, body: uploadBody }, null, 2));
  process.exit(1);
}

const create = await fetch(`https://graph.facebook.com/v21.0/${waba}/message_templates`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    name: "diwali_membership_2026",
    language: "en",
    category: "MARKETING",
    components: [
      {
        type: "HEADER",
        format: "IMAGE",
        example: { header_handle: [uploadBody.h] },
      },
      { type: "BODY", text: bodyText },
      { type: "FOOTER", text: "Dr. K's Aesthetics · Perumbavoor | Thodupuzha" },
    ],
  }),
});
const createBody = await create.json();
console.log(JSON.stringify({ step: "create_template", http: create.status, body: createBody, handle: String(uploadBody.h).slice(0, 24) + "…" }, null, 2));

const list = await fetch(
  `https://graph.facebook.com/v21.0/${waba}/message_templates?name=diwali_membership_2026&fields=name,status,language,rejected_reason,category`,
  { headers: { authorization: `Bearer ${token}` } },
);
console.log("status", JSON.stringify(await list.json(), null, 2));
