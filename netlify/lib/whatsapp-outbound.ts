export function whatsappTo(raw: string) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

export function sanitizeTemplateVar(value: string, fallback = "there") {
  const cleaned = value.replace(/[\t\r]/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return (cleaned || fallback).slice(0, 900);
}

type GraphError = { code?: number; message?: string; error_data?: { details?: string } };
type TemplateRow = { name: string; language: string; status: string; category?: string };

const PREFERRED = ["diwali_membership_2026", "crm_campaign_update", "crm_desk_notice"];
const IMAGE_HEADER_TEMPLATES = new Set(["diwali_membership_2026"]);
const TWO_BODY_TEMPLATES = new Set(["crm_desk_notice", "crm_campaign_update"]);

export function templateNeedsImageHeader(name: string) {
  return IMAGE_HEADER_TEMPLATES.has(name);
}

export function templateBodyParams(name: string, nameOrGreeting: string, text: string) {
  if (IMAGE_HEADER_TEMPLATES.has(name)) return [] as string[];
  if (TWO_BODY_TEMPLATES.has(name)) {
    return [sanitizeTemplateVar(nameOrGreeting || "there"), sanitizeTemplateVar(text || "Update from Dr. K Aesthetic Clinic.")];
  }
  return [sanitizeTemplateVar(text || "Update from Dr. K Aesthetic Clinic.")];
}

export async function listApprovedTemplates(wabaId: string, token: string) {
  if (!wabaId || !token) return [] as TemplateRow[];
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=50&fields=name,status,language,category`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return [] as TemplateRow[];
  const body = (await response.json()) as { data?: TemplateRow[] };
  return (body.data ?? []).filter((row) => String(row.status).toUpperCase() === "APPROVED");
}

export function pickOutboundTemplate(rows: TemplateRow[]) {
  // Never use Meta sample templates — hello_world only works on public test numbers and 502s on the live line.
  const usable = rows.filter((row) => !/^hello_world$/i.test(row.name));
  for (const name of PREFERRED) {
    const hit = usable.find((row) => row.name === name);
    if (hit) return hit;
  }
  return usable.find((row) => /^crm_/i.test(row.name)) || null;
}

export function graphErrorDetail(error?: GraphError, fromPhone = "WhatsApp") {
  const raw = (error?.message || error?.error_data?.details || "WhatsApp rejected the message.").replace(/access_token=[^&\s]+/g, "").slice(0, 180);
  if (error?.code === 190 || /session has expired|authentication error/i.test(raw)) {
    return `The WhatsApp token for ${fromPhone} expired. In Meta, generate a token that does not expire and paste it under Settings, WhatsApp.`;
  }
  if (error?.code === 131042 || error?.code === 141006 || /payment method|business eligibility payment/i.test(raw)) {
    return PAYMENT_BLOCK_DETAIL;
  }
  if (error?.code === 131047 || /re-engagement|24 hour|customer care window/i.test(raw)) {
    return "Outside the 24-hour chat window WhatsApp only delivers approved templates. Fix the Meta payment method first, then wait for diwali_membership_2026 to show Approved.";
  }
  if (error?.code === 131026 || /undeliverable/i.test(raw)) {
    return "WhatsApp could not deliver to that number (undeliverable). Confirm the number is on WhatsApp.";
  }
  return raw;
}

export const PAYMENT_BLOCK_DETAIL =
  "Meta has blocked business-initiated WhatsApp sends (error 141006): the WhatsApp payment method is missing or failed. In Meta Business Suite open WhatsApp Manager → Account tools → Payment methods, add a working card for Dr Kukku / +91 95624 29928, then retry. Replies inside 24 hours still work; campaigns and templates do not until billing is fixed.";

export const VERIFY_BLOCK_DETAIL =
  "Meta limited this WhatsApp account because business verification is incomplete. Finish verification in Meta Business Suite → Business settings → Security centre, then retry campaigns.";

type HealthEntity = {
  entity_type?: string;
  can_send_message?: string;
  errors?: Array<{ error_code?: number; error_description?: string; possible_solution?: string }>;
};

export async function checkWabaSendHealth(wabaId: string, token: string) {
  if (!wabaId || !token) {
    return { ok: false as const, code: 0, detail: "WhatsApp Business Account ID or token is missing." };
  }
  const response = await fetch(`https://graph.facebook.com/v21.0/${wabaId}?fields=health_status,business_verification_status,account_review_status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as {
    business_verification_status?: string;
    health_status?: { can_send_message?: string; entities?: HealthEntity[] };
    error?: GraphError;
  };
  if (!response.ok) {
    return { ok: false as const, code: body.error?.code || response.status, detail: graphErrorDetail(body.error) };
  }

  const entities = body.health_status?.entities ?? [];
  const blocked = entities.find((entity) => String(entity.can_send_message).toUpperCase() === "BLOCKED");
  const payment = entities
    .flatMap((entity) => entity.errors ?? [])
    .find((error) => error.error_code === 141006 || /payment method/i.test(error.error_description || ""));
  if (payment || (blocked && /payment/i.test(JSON.stringify(blocked.errors || [])))) {
    return { ok: false as const, code: 141006, detail: PAYMENT_BLOCK_DETAIL };
  }
  if (String(body.health_status?.can_send_message).toUpperCase() === "BLOCKED") {
    const first = blocked?.errors?.[0];
    return {
      ok: false as const,
      code: first?.error_code || 0,
      detail: first?.possible_solution || first?.error_description || PAYMENT_BLOCK_DETAIL,
    };
  }
  if (String(body.business_verification_status || "").toLowerCase() === "not_verified") {
    // Verification limits the account but payment block is the hard stop for campaigns.
    return { ok: true as const, code: 141010, detail: VERIFY_BLOCK_DETAIL, limited: true as const };
  }
  return { ok: true as const, code: 0, detail: "", limited: false as const };
}

export async function sendWhatsAppGraph(input: {
  phoneNumberId: string;
  token: string;
  to: string;
  text: string;
  imageUrl?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}) {
  const to = whatsappTo(input.to);
  if (to.length < 11 || to.length > 15) {
    return { ok: false as const, status: 400, detail: "Enter a valid WhatsApp number with country code.", providerMessageId: "", to };
  }

  let payload: Record<string, unknown>;
  if (input.templateName) {
    const params = (input.templateParams ?? []).map((value) => sanitizeTemplateVar(value));
    const components: Array<Record<string, unknown>> = [];
    if (templateNeedsImageHeader(input.templateName) && input.imageUrl) {
      components.push({
        type: "header",
        parameters: [{ type: "image", image: { link: input.imageUrl } }],
      });
    }
    if (params.length) {
      components.push({
        type: "body",
        parameters: params.map((text) => ({ type: "text", text })),
      });
    }
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.templateLanguage || "en" },
        ...(components.length ? { components } : {}),
      },
    };
  } else if (input.imageUrl) {
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: input.imageUrl, caption: input.text || undefined },
    };
  } else {
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: input.text },
    };
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${input.phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: GraphError;
  };
  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      detail: graphErrorDetail(body.error),
      providerMessageId: "",
      to,
      code: body.error?.code,
    };
  }
  return {
    ok: true as const,
    status: response.status,
    detail: "",
    providerMessageId: body.messages?.[0]?.id ?? "",
    to,
  };
}

export async function waitForDelivery(
  supabaseUrl: string,
  serviceKey: string,
  providerMessageId: string,
  ms = 10000,
) {
  if (!providerMessageId) return { status: "unknown", error: "" };
  const started = Date.now();
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  while (Date.now() - started < ms) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/messages?provider_message_id=eq.${encodeURIComponent(providerMessageId)}&select=status,provider_error&limit=1`,
      { headers },
    );
    if (response.ok) {
      const rows = (await response.json()) as Array<{ status?: string; provider_error?: string | null }>;
      const status = String(rows[0]?.status || "");
      const error = String(rows[0]?.provider_error || "");
      if (status === "failed" || status === "delivered" || status === "read") {
        return { status, error };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return { status: "sent", error: "" };
}

export function deliveryFailureMessage(status: string, error: string, to: string) {
  if (status === "failed") {
    return error || `WhatsApp accepted the send to ${to} but delivery failed. Outside the 24-hour window use an approved template.`;
  }
  return "";
}
