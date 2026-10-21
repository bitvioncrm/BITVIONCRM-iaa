export interface FormMapping {
  formId: string;
  pageId: string;
  workspaceId: string;
  organizationId: string;
  active: boolean;
}

export function resolveFormMapping(formId: string, pageId: string, mappings: FormMapping[]) {
  const form = formId.trim();
  if (!form) return null;
  const matches = mappings.filter((item) => {
    if (!item.active || item.formId.trim() !== form) return false;
    if (item.pageId.trim() && item.pageId.trim() !== pageId.trim()) return false;
    return Boolean(item.workspaceId && item.organizationId);
  });
  if (matches.length !== 1) return null;
  return matches[0] ?? null;
}

export interface AdAccountDesk {
  adAccountId: string;
  workspaceId: string;
  organizationId: string;
}

export interface WorkspaceDesk {
  workspaceId: string;
  organizationId: string;
  workspaceType: string;
  name: string;
}

export interface PageDesk {
  pageId: string;
  workspaceId: string;
  organizationId: string;
}

function tokenPattern(token: string) {
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

export function instituteDeskForCampaign(campaignName: string, organizationId: string, desks: WorkspaceDesk[]) {
  const name = campaignName.trim();
  if (!name || !organizationId) return null;
  const hits = desks.filter((desk) => {
    if (desk.organizationId !== organizationId || desk.workspaceType !== "institute") return false;
    const tokens = desk.name.split(/[^A-Za-z0-9]+/).filter((token) => token.length >= 3);
    return tokens.some((token) => tokenPattern(token).test(name));
  });
  return hits.length === 1 ? hits[0] : null;
}

export function normalizeAdAccountId(value: string) {
  return value.trim().replace(/^act_/i, "");
}

export function resolveLeadDesk(input: {
  formId: string;
  pageId: string;
  adAccountId: string;
  campaignName?: string;
  mappings: FormMapping[];
  accounts: AdAccountDesk[];
  desks?: WorkspaceDesk[];
  pages?: PageDesk[];
}) {
  const form = input.formId.trim();
  const formMatches = form
    ? input.mappings.filter((item) => {
      if (!item.active || item.formId.trim() !== form) return false;
      if (item.pageId.trim() && item.pageId.trim() !== input.pageId.trim()) return false;
      return Boolean(item.workspaceId && item.organizationId);
    })
    : [];
  if (formMatches.length > 1) return null;
  if (formMatches.length === 1) {
    const match = formMatches[0];
    return { workspaceId: match.workspaceId, organizationId: match.organizationId, reason: "form" as const };
  }

  const pageHits = new Map<string, PageDesk>();
  for (const page of input.pages ?? []) {
    if (page.pageId.trim() !== input.pageId.trim() || !page.workspaceId || !page.organizationId) continue;
    pageHits.set(page.workspaceId, page);
  }
  if (pageHits.size > 1) return null;
  if (pageHits.size === 1) {
    const page = [...pageHits.values()][0];
    const pageDesk = (input.desks ?? []).find((desk) => desk.workspaceId === page.workspaceId);
    if (pageDesk?.workspaceType !== "institute") {
      const campaignDesk = instituteDeskForCampaign(input.campaignName ?? "", page.organizationId, input.desks ?? []);
      if (campaignDesk) return { workspaceId: campaignDesk.workspaceId, organizationId: campaignDesk.organizationId, reason: "campaign" as const };
    }
    return { workspaceId: page.workspaceId, organizationId: page.organizationId, reason: "page" as const };
  }

  const account = normalizeAdAccountId(input.adAccountId);
  if (!account) return null;
  const desks = new Map<string, AdAccountDesk>();
  for (const item of input.accounts) {
    if (normalizeAdAccountId(item.adAccountId) !== account) continue;
    if (!item.workspaceId || !item.organizationId) continue;
    desks.set(item.workspaceId, item);
  }
  if (desks.size !== 1) return null;
  const match = [...desks.values()][0];
  const campaignDesk = instituteDeskForCampaign(input.campaignName ?? "", match.organizationId, input.desks ?? []);
  if (campaignDesk) {
    return { workspaceId: campaignDesk.workspaceId, organizationId: campaignDesk.organizationId, reason: "campaign" as const };
  }
  return { workspaceId: match.workspaceId, organizationId: match.organizationId, reason: "ad_account" as const };
}
