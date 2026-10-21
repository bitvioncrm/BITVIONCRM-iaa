export function digits(value: string) {
  return value.replace(/\D/g, "");
}

export function phoneLookup(from: string) {
  const full = digits(from);
  const tail = full.length >= 10 ? full.slice(-10) : "";
  return { full, tail, display: full ? `+${full}` : "" };
}

export function whatsappLeadFields(input: { name: string; from: string; headline?: string; sourceId?: string }) {
  const phone = phoneLookup(input.from);
  return {
    full_name: input.name.trim() || "WhatsApp lead",
    phone: phone.display,
    whatsapp: phone.display,
    source: "whatsapp_click",
    source_platform: "whatsapp",
    source_campaign: (input.headline || input.sourceId || "").trim(),
    status: "new",
  };
}

export function messageBody(text: string, headline = "") {
  const note = headline.trim() ? `Ad: ${headline.trim()}` : "";
  return [text.trim(), note].filter(Boolean).join("\n");
}
