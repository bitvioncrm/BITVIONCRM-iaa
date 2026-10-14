import { digits } from "./utils";

export function phoneTel(phone: string) {
  const raw = digits(phone);
  if (raw.length < 10 || raw.length > 15) return "";
  if (raw.length === 10) return `tel:+91${raw}`;
  return `tel:+${raw}`;
}
