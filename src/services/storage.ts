import { DATA_VERSION } from "@/data/catalog";
import { buildSeed } from "@/data/seed";
import type { CrmState } from "@/types";

export const STORAGE_KEY = "bitvion.crm.v7";

export function loadCrm(): CrmState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CrmState;
      if (parsed.version === DATA_VERSION && Array.isArray(parsed.leads) && parsed.leads.length > 0 && parsed.settings && Array.isArray(parsed.calls)) {
        return parsed;
      }
    }
  } catch {
    /* Reseed when stored data cannot be read. */
  }
  return buildSeed();
}

export function saveCrm(state: CrmState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function idleCrm(): CrmState {
  return {
    version: DATA_VERSION,
    users: [],
    leads: [],
    activities: [],
    followUps: [],
    tasks: [],
    conversations: [],
    messages: [],
    templates: [],
    campaigns: [],
    notifications: [],
    jobs: [],
    calls: [],
    automation: { id: "production", name: "Production", enabled: false, runOnNewLeads: false, nodes: [] },
    settings: {
      companyName: "BITVION",
      companyEmail: "",
      companyPhone: "",
      website: "",
      address: "",
      timezone: "Asia/Kolkata",
      whatsapp: { accountName: "", phoneNumber: "", businessId: "", apiStatus: "demo" },
      meta: { connected: false, accountName: "", adAccountId: "", pageName: "", status: "demo" },
      notifications: { followUps: true, replies: true, campaigns: true, overdue: true },
    },
  };
}

export function freshCrm() {
  localStorage.removeItem(STORAGE_KEY);
  const next = buildSeed();
  saveCrm(next);
  return next;
}
