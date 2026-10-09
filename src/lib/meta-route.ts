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
