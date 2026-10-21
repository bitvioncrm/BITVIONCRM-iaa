export type LeadOrigin = "all" | "excel" | "live" | "latest";

export const LEAD_ORIGINS: Array<{ value: LeadOrigin; label: string }> = [
  { value: "all", label: "All leads" },
  { value: "excel", label: "Excel sheet" },
  { value: "live", label: "Without Excel" },
  { value: "latest", label: "Latest leads" },
];

export function isExcelLead(source: string, sourcePlatform = "") {
  return sourcePlatform === "excel" || (source === "whatsapp" && sourcePlatform === "");
}
