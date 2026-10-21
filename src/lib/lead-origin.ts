export type LeadOrigin = "all" | "excel" | "live" | "latest";

export const LEAD_ORIGINS: Array<{ value: LeadOrigin; label: string }> = [
  { value: "live", label: "Live" },
  { value: "all", label: "All leads" },
  { value: "excel", label: "Excel sheet" },
  { value: "latest", label: "Latest leads" },
];

export function isExcelLead(source: string, sourcePlatform = "") {
  return sourcePlatform === "excel" || (source === "whatsapp" && sourcePlatform === "");
}

export function leadOriginLabel(status: string, source: string, sourcePlatform = "") {
  if (status === "excel" || isExcelLead(source, sourcePlatform)) return "Excel sheet";
  if (source === "meta_ads") return "Meta";
  if (source === "whatsapp_click") return "WhatsApp";
  return "Added in CRM";
}
