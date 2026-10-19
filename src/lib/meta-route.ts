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

export function normalizeAdAccountId(value: string) {
  return value.trim().replace(/^act_/i, "");
}

export function resolveLeadDesk(input: {
  formId: string;
  pageId: string;
  adAccountId: string;
  mappings: FormMapping[];
  accounts: AdAccountDesk[];
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
  return { workspaceId: match.workspaceId, organizationId: match.organizationId, reason: "ad_account" as const };
}
