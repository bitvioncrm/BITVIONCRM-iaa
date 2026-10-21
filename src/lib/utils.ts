import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function digits(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidPhone(value: string) {
  const d = digits(value);
  return d.length >= 10 && d.length <= 15;
}

export function formatPhone(phone: string) {
  const d = digits(phone);
  if (d.startsWith("91") && d.length === 12) {
    return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  }
  return phone;
}

export function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

const AVATAR = ["#1f3b5b", "#3d4c5c", "#1f5c45", "#6b5428", "#3f3a55", "#1e4d6b"];

export function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash + name.charCodeAt(i) * (i + 1)) % AVATAR.length;
  return AVATAR[hash] ?? AVATAR[0];
}

export function percent(value: number, digitsCount = 1) {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(digitsCount)}%`;
}

export function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const controlClass =
  "h-11 w-full rounded-md border border-line bg-white px-3 text-base text-ink outline-none transition placeholder:text-slate-400 focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 sm:h-9 sm:text-sm";

export function formatTalk(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
