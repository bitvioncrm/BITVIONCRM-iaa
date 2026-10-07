export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

export function phoneKey(value: string) {
  const digits = normalizePhone(value);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 10) return digits;
  return digits;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export interface Identity {
  name: string;
  phone: string;
  email: string;
}

export type DuplicateKind = "phone" | "email" | "phone_name" | "email_name";

export function duplicateKind(existing: Identity, incoming: Identity): DuplicateKind | null {
  const phone = phoneKey(incoming.phone);
  const email = normalizeEmail(incoming.email);
  const samePhone = phone.length >= 10 && phone === phoneKey(existing.phone);
  const sameEmail = email.length > 0 && email === normalizeEmail(existing.email);
  const sameName = incoming.name.trim().toLowerCase() !== "" && incoming.name.trim().toLowerCase() === existing.name.trim().toLowerCase();
  if (samePhone && sameName) return "phone_name";
  if (sameEmail && sameName) return "email_name";
  if (samePhone) return "phone";
  if (sameEmail) return "email";
  return null;
}

export function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

export function sanitizeSearch(value: string) {
  return value.replace(/[%_,.()"'\\]/g, " ").trim();
}
