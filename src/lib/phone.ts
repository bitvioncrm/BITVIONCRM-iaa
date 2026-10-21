import { digits } from "./utils";

export function phoneTel(phone: string) {
  const raw = digits(phone);
  if (raw.length < 10 || raw.length > 15) return "";
  if (raw.length === 10) return `tel:+91${raw}`;
  return `tel:+${raw}`;
}

export function whatsAppHref(phone: string, text = "") {
  const raw = digits(phone);
  if (raw.length < 10 || raw.length > 15) return "";
  const number = raw.length === 10 ? `91${raw}` : raw;
  const note = text.trim();
  return note ? `https://wa.me/${number}?text=${encodeURIComponent(note)}` : `https://wa.me/${number}`;
}
