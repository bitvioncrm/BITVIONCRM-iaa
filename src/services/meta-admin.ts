import { deskCallerRoles } from "@/lib/production-access";
import { supabase } from "@/lib/supabase";
import { assignLead, type WorkspaceOption } from "@/services/production-leads";

function db() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

export interface MetaMapping {
  id: string;
  pageId: string;
  formId: string;
  formName: string;
  workspaceId: string;
  active: boolean;
}

export interface MetaEvent {
  id: string;
  leadgenId: string;
  pageId: string;
  formId: string;
  status: string;
  errorCode: string;
  updatedAt: string;
}

export interface DeskCaller {
  userId: string;
  name: string;
  role: string;
  workspaceId: string;
  desk: "clinic" | "institute";
}

export interface MetaLeadRow {
  id: string;
  name: string;
  status: string;
  campaign: string;
  form: string;
  createdAt: string;
  workspaceId: string;
  assignedTo: string | null;
}

export interface MetaCentre {
  status: string;
  detail: string;
  lastSuccessAt: string | null;
  lastEventAt: string | null;
  failed: number;
  mappings: MetaMapping[];
  events: MetaEvent[];
  clinic: Record<string, number | null>;
  institute: Record<string, number | null>;
  leads: MetaLeadRow[];
  schemaReady: boolean;
}

type RowQuery = {
  eq: (column: string, value: string) => RowQuery;
  is: (column: string, value: null) => RowQuery;
  not: (column: string, operator: string, value: null) => RowQuery;
  then: Promise<{ count: number | null; error: { message: string } | null }>["then"];
};

async function metaCount(workspaceIds: string[], from: string, to: string, apply?: (query: RowQuery) => RowQuery) {
  if (!workspaceIds.length) return 0;
  let query = db().from("leads").select("id", { count: "exact", head: true }).in("workspace_id", workspaceIds).is("deleted_at", null).or("source.eq.meta_ads,source_platform.eq.meta").gte("created_at", from).lt("created_at", to) as unknown as RowQuery;
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadMetaCentre(workspaces: WorkspaceOption[], workspaceIds: string[], from: string, to: string, filters: { campaign?: string; form?: string; status?: string; assignedTo?: string }) {
  const organizationId = workspaces[0]?.organizationId ?? "";
  const clinicIds = workspaces.filter((item) => item.workspaceType === "clinic" && workspaceIds.includes(item.id)).map((item) => item.id);
  const instituteIds = workspaces.filter((item) => item.workspaceType === "institute" && workspaceIds.includes(item.id)).map((item) => item.id);
  const emptyCounts = { leads: null, fresh: null, today: null, unassigned: null, assigned: null, contacted: null, converted: null };
  const centre: MetaCentre = {
    status: "configuration_required",
    detail: "Meta integration is not configured.",
    lastSuccessAt: null,
    lastEventAt: null,
    failed: 0,
    mappings: [],
    events: [],
    clinic: { ...emptyCounts },
    institute: { ...emptyCounts },
    leads: [],
    schemaReady: true,
  };
  if (!organizationId) return centre;

  const status = await db().from("integration_status").select("status, detail, last_success_at, last_event_at").eq("organization_id", organizationId).eq("provider", "meta").maybeSingle();
  if (!status.error && status.data) {
    centre.status = String(status.data.status || "configuration_required");
    centre.detail = String(status.data.detail || "");
    centre.lastSuccessAt = status.data.last_success_at ? String(status.data.last_success_at) : null;
    centre.lastEventAt = status.data.last_event_at ? String(status.data.last_event_at) : null;
  } else if (status.error && !String(status.error.message).includes("last_success_at")) {
    centre.detail = status.error.message;
  }

  const mappings = await db().from("meta_form_mappings").select("id, page_id, form_id, form_name, workspace_id, active").eq("organization_id", organizationId).order("form_name");
  if (mappings.error) {
    centre.schemaReady = false;
    centre.detail = "Meta routing tables are not available until the latest database migration is applied.";
  } else {
  centre.mappings = (mappings.data ?? []).map((row) => ({
    id: String(row.id),
    pageId: String(row.page_id ?? ""),
    formId: String(row.form_id),
    formName: String(row.form_name ?? ""),
    workspaceId: String(row.workspace_id),
    active: Boolean(row.active),
  }));

  const events = await db().from("meta_import_events").select("id, leadgen_id, page_id, form_id, status, error_code, updated_at").eq("organization_id", organizationId).in("status", ["failed", "unmapped"]).order("updated_at", { ascending: false }).limit(40);
  if (!events.error) {
    centre.events = (events.data ?? []).map((row) => ({
      id: String(row.id),
      leadgenId: String(row.leadgen_id),
      pageId: String(row.page_id ?? ""),
      formId: String(row.form_id ?? ""),
      status: String(row.status),
      errorCode: String(row.error_code ?? ""),
      updatedAt: String(row.updated_at),
    }));
    centre.failed = centre.events.length;
  }
  }

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
  const pack = async (ids: string[]) => ({
    leads: await metaCount(ids, from, to),
    fresh: await metaCount(ids, from, to, (query) => query.eq("status", "new")),
    today: await metaCount(ids, start, end),
    unassigned: await metaCount(ids, from, to, (query) => query.is("assigned_to", null)),
    assigned: await metaCount(ids, from, to, (query) => query.not("assigned_to", "is", null)),
    contacted: await metaCount(ids, from, to, (query) => query.eq("status", "contacted")),
    converted: await metaCount(ids, from, to, (query) => query.eq("status", "converted")),
  });
  const zeros = { leads: 0, fresh: 0, today: 0, unassigned: 0, assigned: 0, contacted: 0, converted: 0 };
  centre.clinic = clinicIds.length ? await pack(clinicIds) : zeros;
  centre.institute = instituteIds.length ? await pack(instituteIds) : zeros;

  let request = db()
    .from("leads")
    .select("id, full_name, status, source_campaign, source_form, created_at, workspace_id, assigned_to")
    .in("workspace_id", workspaceIds.length ? workspaceIds : ["00000000-0000-0000-0000-000000000000"])
    .is("deleted_at", null)
    .or("source.eq.meta_ads,source_platform.eq.meta")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false })
    .limit(40);
  if (filters.status) request = request.eq("status", filters.status);
  if (filters.campaign) request = request.ilike("source_campaign", `%${filters.campaign.replace(/[%_]/g, "")}%`);
  if (filters.form) request = request.ilike("source_form", `%${filters.form.replace(/[%_]/g, "")}%`);
  if (filters.assignedTo === "unassigned") request = request.is("assigned_to", null);
  else if (filters.assignedTo) request = request.eq("assigned_to", filters.assignedTo);
  const leads = await request;
  if (leads.error) throw new Error(leads.error.message);
  centre.leads = (leads.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.full_name),
    status: String(row.status),
    campaign: String(row.source_campaign || ""),
    form: String(row.source_form || ""),
    createdAt: String(row.created_at),
    workspaceId: String(row.workspace_id),
    assignedTo: (row.assigned_to as string | null) ?? null,
  }));
  return centre;
}

function roleKey(value: { key: string } | { key: string }[] | null) {
  return Array.isArray(value) ? value[0]?.key : value?.key;
}

function profileName(value: { full_name: string } | { full_name: string }[] | null) {
  const name = Array.isArray(value) ? value[0]?.full_name : value?.full_name;
  return name?.trim() || "Telecaller";
}

export async function listDeskTelecallers(workspaces: WorkspaceOption[]) {
  const ids = workspaces.map((item) => item.id);
  if (!ids.length) return [];
  const { data, error } = await db().from("user_roles").select("user_id, workspace_id, roles(key), profiles(full_name)").in("workspace_id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const workspace = workspaces.find((item) => item.id === row.workspace_id);
    const desk = workspace?.workspaceType === "clinic" || workspace?.workspaceType === "institute" ? workspace.workspaceType : null;
    const role = roleKey(row.roles as { key: string } | { key: string }[] | null);
    if (!desk || !role || !deskCallerRoles(desk).includes(role)) return [];
    return [{
      userId: String(row.user_id),
      name: profileName(row.profiles as { full_name: string } | { full_name: string }[] | null),
      role,
      workspaceId: String(row.workspace_id),
      desk,
    }] satisfies DeskCaller[];
  });
}

export async function assignMetaLead(input: { leadId: string; organizationId: string; workspaceId: string; workspaceType: string; assignedTo: string }) {
  const allowed = deskCallerRoles(input.workspaceType);
  if (!allowed.length) throw new Error("This lead is not on the clinic or institute desk.");
  const members = await db().from("user_roles").select("roles(key)").eq("workspace_id", input.workspaceId).eq("user_id", input.assignedTo);
  if (members.error) throw new Error(members.error.message);
  const match = (members.data ?? []).some((row) => {
    const role = roleKey(row.roles as { key: string } | { key: string }[] | null);
    return Boolean(role && allowed.includes(role));
  });
  if (!match) {
    throw new Error(input.workspaceType === "clinic" ? "Assign clinic leads only to a clinic telecaller." : "Assign institute leads only to an institute telecaller.");
  }
  await assignLead({ id: input.leadId, organizationId: input.organizationId, workspaceId: input.workspaceId }, input.assignedTo);
}

export async function saveFormMapping(input: { organizationId: string; workspaceId: string; pageId: string; formId: string; formName: string }) {
  const { error } = await db().from("meta_form_mappings").insert({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    page_id: input.pageId.trim(),
    form_id: input.formId.trim(),
    form_name: input.formName.trim(),
    active: true,
  });
  if (error) throw new Error(error.message);
}

export async function setMappingActive(id: string, active: boolean) {
  const { error } = await db().from("meta_form_mappings").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function retryMetaImport(leadgenId: string) {
  const session = await db().auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("Sign in again before retrying an import.");
  const response = await fetch("/.netlify/functions/meta-retry", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ leadgenId }),
  });
  const body = (await response.json().catch(() => ({ status: "failed" }))) as { status?: string };
  if (!response.ok) throw new Error(body.status === "configuration_required" ? "Meta integration is not configured." : "The import could not be retried.");
  return body.status ?? "stored";
}
