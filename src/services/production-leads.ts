import { stageFromText } from "@/data/catalog";
import type { LeadOrigin } from "@/lib/lead-origin";
import { chunk, duplicateKind, normalizeEmail, normalizePhone, phoneKey, sanitizeSearch, type DuplicateKind } from "@/lib/lead-normalize";
import { deskCallerRoles } from "@/lib/production-access";
import { supabase } from "@/lib/supabase";
import type { LeadStatus } from "@/types";

export const PAGE_SIZE = 20;
const IMPORT_BATCH = 200;

export interface ProductionLead {
  id: string;
  organizationId: string;
  workspaceId: string;
  fullName: string;
  phone: string;
  email: string;
  location: string;
  position: string;
  source: string;
  sourcePlatform: string;
  priority: string;
  status: LeadStatus;
  assignedTo: string | null;
  createdAt: string;
  nextFollowUpAt: string | null;
}

export interface WorkspaceOption {
  id: string;
  organizationId: string;
  name: string;
  workspaceType: string;
}

export interface MemberOption {
  userId: string;
  name: string;
  role: string;
  workspaceId: string;
}

interface LeadRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  full_name: string;
  phone: string;
  email: string;
  location: string;
  position: string;
  source: string;
  source_platform: string | null;
  priority: string;
  status: LeadStatus;
  assigned_to: string | null;
  created_at: string;
  next_follow_up_at: string | null;
}

function mapLead(row: LeadRow): ProductionLead {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    location: row.location,
    position: row.position,
    source: row.source,
    sourcePlatform: row.source_platform ?? "",
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    nextFollowUpAt: row.next_follow_up_at,
  };
}

function client() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

export async function currentUserId() {
  const { data, error } = await client().auth.getUser();
  if (error || !data.user) throw new Error(error?.message ?? "Configuration Required");
  return data.user.id;
}

export async function primaryRoleKey() {
  const userId = await currentUserId();
  const { data, error } = await client().from("user_roles").select("roles(key)").eq("user_id", userId).limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0] as { roles: { key: string } | { key: string }[] | null } | undefined;
  const roles = row?.roles;
  if (Array.isArray(roles)) return roles[0]?.key ?? "institute_user";
  return roles?.key ?? "institute_user";
}

let workspaceCache: { at: number; rows: WorkspaceOption[] } | null = null;

export async function listWorkspaces() {
  if (workspaceCache && Date.now() - workspaceCache.at < 60_000) return workspaceCache.rows;
  const { data, error } = await client().from("workspaces").select("id, organization_id, name, workspace_type").is("deleted_at", null).order("name");
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((row) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    name: row.name as string,
    workspaceType: row.workspace_type as string,
  })) satisfies WorkspaceOption[];
  workspaceCache = { at: Date.now(), rows };
  return rows;
}

export async function listAssignableMembers(workspaceId: string, workspaceType?: string) {
  let desk = workspaceType;
  if (!desk) {
    const workspace = await client().from("workspaces").select("workspace_type").eq("id", workspaceId).maybeSingle();
    if (workspace.error) throw new Error(workspace.error.message);
    desk = (workspace.data?.workspace_type as string | undefined) ?? "";
  }
  const allowed = new Set(deskCallerRoles(desk));
  const { data, error } = await client()
    .from("user_roles")
    .select("user_id, workspace_id, roles(key), profiles(full_name)")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const roles = row.roles as { key: string } | { key: string }[] | null;
    const role = Array.isArray(roles) ? roles[0]?.key : roles?.key;
    if (!role || !allowed.has(role)) return [];
    const profiles = row.profiles as { full_name: string } | { full_name: string }[] | null;
    const name = Array.isArray(profiles) ? profiles[0]?.full_name : profiles?.full_name;
    return [{ userId: row.user_id as string, name: name ?? "Telecaller", role, workspaceId: row.workspace_id as string }];
  }) satisfies MemberOption[];
}

export async function listDoctors(workspaceId: string) {
  const { data, error } = await client()
    .from("user_roles")
    .select("user_id, roles(key), profiles(full_name)")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const roles = row.roles as { key: string } | { key: string }[] | null;
    const role = Array.isArray(roles) ? roles[0]?.key : roles?.key;
    if (role !== "doctor" && role !== "duty_doctor") return [];
    const profiles = row.profiles as { full_name: string } | { full_name: string }[] | null;
    const name = Array.isArray(profiles) ? profiles[0]?.full_name : profiles?.full_name;
    const label = role === "duty_doctor" ? "Duty doctor" : "Main doctor";
    return [{ userId: row.user_id as string, name: `${name ?? "Doctor"} · ${label}` }];
  });
}

export interface LeadQuery {
  page: number;
  workspaceId?: string;
  status?: string;
  search?: string;
  assignedTo?: string;
  unassigned?: boolean;
  source?: string;
  origin?: LeadOrigin;
  createdFrom?: string;
  createdTo?: string;
  counted?: boolean;
}

const LEAD_LIST_COLUMNS = "id, organization_id, workspace_id, full_name, phone, email, location, position, source, source_platform, priority, status, assigned_to, created_at, next_follow_up_at";

interface LeadFilter {
  is(column: string, value: null): LeadFilter;
  eq(column: string, value: string): LeadFilter;
  neq(column: string, value: string): LeadFilter;
  or(filters: string): LeadFilter;
  gte(column: string, value: string): LeadFilter;
  lt(column: string, value: string): LeadFilter;
}

function leadFilter(request: LeadFilter, query: LeadQuery) {
  let next = request.is("deleted_at", null);
  if (query.workspaceId) next = next.eq("workspace_id", query.workspaceId);
  if (query.status) next = next.eq("status", query.status);
  if (query.unassigned) next = next.is("assigned_to", null);
  else if (query.assignedTo) next = next.eq("assigned_to", query.assignedTo);
  if (query.source) next = next.eq("source", query.source);
  if (query.origin === "excel") next = next.or("source.eq.whatsapp,source_platform.eq.excel,status.eq.excel");
  // Live includes Meta forms and WhatsApp clicks; Excel queue (source=whatsapp / platform=excel) stays out.
  if (query.origin === "live") next = next.neq("source", "whatsapp").neq("source_platform", "excel").neq("status", "excel");
  if (query.origin === "latest") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = start.toISOString().replace(/\.\d{3}Z$/, "Z");
    next = next.or(`created_at.gte.${today},imported_at.gte.${today}`);
  } else {
    if (query.createdFrom) next = next.gte("created_at", query.createdFrom);
    if (query.createdTo) next = next.lt("created_at", query.createdTo);
  }
  const search = sanitizeSearch(query.search ?? "");
  if (search) {
    const phone = normalizePhone(search);
    const parts = [`full_name.ilike.%${search}%`, `email_normalized.ilike.%${search.toLowerCase()}%`, `position.ilike.%${search}%`];
    if (phone) parts.push(`phone_digits.ilike.%${phone}%`);
    next = next.or(parts.join(","));
  }
  return next;
}

export function loadLeadList(query: LeadQuery) {
  const from = Math.max(0, query.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const rows = leadFilter(client().from("leads").select(LEAD_LIST_COLUMNS) as unknown as LeadFilter, query) as unknown as {
    order: (column: string, options: { ascending: boolean }) => { range: (from: number, to: number) => Promise<{ data: LeadRow[] | null; error: { message: string } | null }> };
  };
  const count = query.counted === false ? null : leadFilter(client().from("leads").select("id", { count: "exact", head: true }) as unknown as LeadFilter, query) as unknown as PromiseLike<{ count: number | null; error: { message: string } | null }>;
  return {
    leads: rows.order("created_at", { ascending: false }).range(from, to).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return ((data ?? []) as LeadRow[]).map(mapLead);
    }),
    total: count
      ? count.then(({ count: total, error }) => {
          if (error) throw new Error(error.message);
          return total ?? 0;
        })
      : Promise.resolve(0),
  };
}

export async function listLeads(query: LeadQuery) {
  const pending = loadLeadList(query);
  const [leads, total] = await Promise.all([pending.leads, pending.total]);
  return { leads, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), pageSize: PAGE_SIZE };
}

export interface LeadDayCount {
  key: string;
  label: string;
  total: number;
  clinic: number;
  institute: number;
}

function istDayKey(iso: string) {
  const shifted = new Date(new Date(iso).getTime() + (5 * 60 + 30) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export async function listRecentLeadDays(workspaces: Array<{ id: string; workspaceType: string }>) {
  const start = new Date();
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  const from = start.toISOString();
  const { data, error } = await client()
    .from("leads")
    .select("created_at, source_created_at, workspace_id, source, source_platform, status")
    .is("deleted_at", null)
    .or(`created_at.gte.${from},source_created_at.gte.${from}`)
    .limit(2000);
  if (error) throw new Error(error.message);
  const desk = new Map(workspaces.map((item) => [item.id, item.workspaceType]));
  const buckets = new Map<string, { clinic: number; institute: number }>();
  for (let offset = 0; offset < 5; offset += 1) {
    const day = new Date();
    day.setDate(day.getDate() - (4 - offset));
    buckets.set(istDayKey(day.toISOString()), { clinic: 0, institute: 0 });
  }
  const today = istDayKey(new Date().toISOString());
  for (const row of data ?? []) {
    const source = String(row.source ?? "");
    const platform = String(row.source_platform ?? "");
    const status = String(row.status ?? "");
    if (status === "excel" || platform === "excel" || (source === "whatsapp" && platform === "")) continue;
    const when = String(row.source_created_at || row.created_at || "");
    if (!when) continue;
    const key = istDayKey(when);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const type = desk.get(String(row.workspace_id));
    if (type === "clinic") bucket.clinic += 1;
    if (type === "institute") bucket.institute += 1;
  }
  return [...buckets.entries()].map(([key, value]) => {
    const [year, month, day] = key.split("-").map(Number);
    const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    return { key, label: key === today ? `${label} · today` : label, total: value.clinic + value.institute, clinic: value.clinic, institute: value.institute } satisfies LeadDayCount;
  });
}

export async function getLead(id: string) {
  const { data, error } = await client().from("leads").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapLead(data as LeadRow) : null;
}

export interface LeadWrite {
  organizationId: string;
  workspaceId: string;
  fullName: string;
  phone: string;
  email: string;
  location: string;
  position: string;
  source: string;
  priority: string;
  status: string;
  assignedTo: string | null;
}

export async function createLead(input: LeadWrite) {
  const userId = await currentUserId();
  const { data, error } = await client()
    .from("leads")
    .insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId,
      full_name: input.fullName.trim(),
      phone: input.phone.trim(),
      email: normalizeEmail(input.email),
      location: input.location.trim(),
      position: input.position.trim(),
      source: input.source,
      priority: input.priority,
      status: stageFromText(input.status),
      assigned_to: input.assignedTo,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await client().from("audit_logs").insert({ user_id: userId, organization_id: input.organizationId, workspace_id: input.workspaceId, action: "lead_created", entity: "leads", entity_id: data.id });
  return mapLead(data as LeadRow);
}

export async function updateLeadStatus(lead: ProductionLead, status: LeadStatus) {
  const userId = await currentUserId();
  const { error } = await client()
    .from("leads")
    .update({
      status,
      updated_by: userId,
      updated_at: new Date().toISOString(),
      converted_at: status === "converted" ? new Date().toISOString() : null,
    })
    .eq("id", lead.id);
  if (error) throw new Error(error.message);
  const { error: historyError } = await client().from("lead_status_history").insert({
    organization_id: lead.organizationId,
    workspace_id: lead.workspaceId,
    lead_id: lead.id,
    from_status: lead.status,
    to_status: status,
    changed_by: userId,
  });
  if (historyError) throw new Error(historyError.message);
}

export async function assignUnassignedLeads(workspaceId: string, assigneeId: string) {
  const { data, error } = await client().rpc("assign_unassigned_leads", { p_workspace_id: workspaceId, p_assignee_id: assigneeId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export type AssignmentTotals = {
  unassigned: number;
  desks: Record<string, number>;
  assigned: Record<string, number>;
};

export async function leadAssignmentTotals(): Promise<AssignmentTotals> {
  const { data, error } = await client().rpc("lead_assignment_totals");
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as { unassigned?: number; desks?: Record<string, number>; assigned?: Record<string, number> };
  const desks = Object.fromEntries(Object.entries(payload.desks ?? {}).map(([id, count]) => [id, Number(count)]));
  return {
    unassigned: Number(payload.unassigned ?? 0),
    desks,
    assigned: payload.assigned ?? {},
  };
}

export async function assignLeadCount(assigneeId: string, limit: number) {
  const { data, error } = await client().rpc("assign_lead_count", { p_assignee_id: assigneeId, p_limit: limit });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

async function assertDeskTelecaller(workspaceId: string, assignedTo: string) {
  const workspace = await client().from("workspaces").select("workspace_type").eq("id", workspaceId).maybeSingle();
  if (workspace.error) throw new Error(workspace.error.message);
  const desk = String(workspace.data?.workspace_type ?? "");
  const allowed = deskCallerRoles(desk);
  if (!allowed.length) throw new Error("This lead is not on the clinic or institute desk.");
  const members = await client().from("user_roles").select("roles(key)").eq("workspace_id", workspaceId).eq("user_id", assignedTo);
  if (members.error) throw new Error(members.error.message);
  const match = (members.data ?? []).some((row) => {
    const roles = row.roles as { key: string } | { key: string }[] | null;
    const role = Array.isArray(roles) ? roles[0]?.key : roles?.key;
    return Boolean(role && allowed.includes(role));
  });
  if (!match) {
    throw new Error(desk === "institute" ? "Assign institute leads only to an institute telecaller." : "Assign clinic leads only to a clinic telecaller.");
  }
}

export async function assignLead(lead: Pick<ProductionLead, "id" | "organizationId" | "workspaceId">, assignedTo: string) {
  await assertDeskTelecaller(lead.workspaceId, assignedTo);
  const userId = await currentUserId();
  const now = new Date().toISOString();
  const { error } = await client().from("leads").update({ assigned_to: assignedTo, assigned_at: now, updated_by: userId, updated_at: now }).eq("id", lead.id);
  if (error) throw new Error(error.message);
  const { error: assignmentError } = await client().from("lead_assignments").insert({
    organization_id: lead.organizationId,
    workspace_id: lead.workspaceId,
    lead_id: lead.id,
    assigned_to: assignedTo,
    assigned_by: userId,
  });
  if (assignmentError) throw new Error(assignmentError.message);
  await client().from("audit_logs").insert({ user_id: userId, organization_id: lead.organizationId, workspace_id: lead.workspaceId, action: "lead_assigned", entity: "leads", entity_id: lead.id });
}

export async function clearLeadAssignment(lead: Pick<ProductionLead, "id" | "organizationId" | "workspaceId">) {
  const userId = await currentUserId();
  const now = new Date().toISOString();
  const { error } = await client().from("leads").update({ assigned_to: null, assigned_at: null, updated_by: userId, updated_at: now }).eq("id", lead.id);
  if (error) throw new Error(error.message);
  const { error: assignmentError } = await client().from("lead_assignments").insert({
    organization_id: lead.organizationId,
    workspace_id: lead.workspaceId,
    lead_id: lead.id,
    assigned_to: null,
    assigned_by: userId,
  });
  if (assignmentError) throw new Error(assignmentError.message);
  await client().from("audit_logs").insert({ user_id: userId, organization_id: lead.organizationId, workspace_id: lead.workspaceId, action: "lead_unassigned", entity: "leads", entity_id: lead.id });
}

export async function clearAssignedLeads(assigneeId: string) {
  const { data, error } = await client().rpc("clear_assigned_leads", { p_assignee_id: assigneeId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function deleteLead(lead: ProductionLead) {
  const userId = await currentUserId();
  const { error } = await client().from("leads").update({ deleted_at: new Date().toISOString(), deleted_by: userId, updated_by: userId }).eq("id", lead.id);
  if (error) throw new Error(error.message);
  await client().from("audit_logs").insert({ user_id: userId, organization_id: lead.organizationId, workspace_id: lead.workspaceId, action: "lead_deleted", entity: "leads", entity_id: lead.id });
}

export async function addLeadNote(lead: ProductionLead, body: string) {
  const userId = await currentUserId();
  const { error } = await client().from("lead_notes").insert({
    organization_id: lead.organizationId,
    workspace_id: lead.workspaceId,
    lead_id: lead.id,
    body: body.trim(),
    created_by: userId,
  });
  if (error) throw new Error(error.message);
}

export async function addFollowUp(lead: ProductionLead, dueAt: string, notes: string) {
  const userId = await currentUserId();
  const { error } = await client().from("followups").insert({
    organization_id: lead.organizationId,
    workspace_id: lead.workspaceId,
    lead_id: lead.id,
    assigned_to: lead.assignedTo ?? userId,
    follow_type: "general",
    due_at: dueAt,
    notes,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
  const { error: leadError } = await client().from("leads").update({ next_follow_up_at: dueAt, updated_by: userId }).eq("id", lead.id);
  if (leadError) throw new Error(leadError.message);
}

export async function listNotes(leadId: string) {
  const { data, error } = await client().from("lead_notes").select("id, body, created_at").eq("lead_id", leadId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; body: string; created_at: string }[];
}

export async function listFollowUps(leadId: string) {
  const { data, error } = await client().from("followups").select("id, due_at, notes, status").eq("lead_id", leadId).order("due_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; due_at: string; notes: string; status: string }[];
}

export async function findDuplicate(workspaceId: string, phone: string, email: string, name: string) {
  const phoneDigits = normalizePhone(phone);
  const emailNormalized = normalizeEmail(email);
  const filters: string[] = [];
  if (phoneDigits) filters.push(`phone_digits.eq.${phoneDigits}`);
  if (emailNormalized) filters.push(`email_normalized.eq.${emailNormalized}`);
  if (!filters.length) return null;
  const { data, error } = await client()
    .from("leads")
    .select("id, full_name, phone, email")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .or(filters.join(","))
    .limit(5);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const kind = duplicateKind(
      { name: row.full_name as string, phone: row.phone as string, email: row.email as string },
      { name, phone, email },
    );
    if (kind) return { id: row.id as string, kind, name: row.full_name as string };
  }
  return null;
}

export interface ImportRow {
  fullName: string;
  phone: string;
  email: string;
  location: string;
  position: string;
  source: string;
  status: string;
}

export type DuplicateAction = "skip" | "separate" | "merge";

export interface ImportReport {
  created: number;
  skipped: number;
  merged: number;
  separate: number;
  invalid: { row: number; reason: string }[];
  duplicates: { row: number; kind: DuplicateKind; existingName: string; action: DuplicateAction }[];
}

async function existingInBatch(workspaceId: string, rows: ImportRow[]) {
  const phones = [...new Set(rows.flatMap((row) => {
    const digits = normalizePhone(row.phone);
    const key = phoneKey(row.phone);
    if (key.length < 10) return [];
    return [digits, key, `91${key}`];
  }))];
  const emails = [...new Set(rows.map((row) => normalizeEmail(row.email)).filter(Boolean))];
  const found: { id: string; full_name: string; phone: string; email: string }[] = [];
  for (const phoneBatch of chunk(phones, 100)) {
    const { data, error } = await client().from("leads").select("id, full_name, phone, email").eq("workspace_id", workspaceId).is("deleted_at", null).in("phone_digits", phoneBatch);
    if (error) throw new Error(error.message);
    found.push(...((data ?? []) as typeof found));
  }
  for (const emailBatch of chunk(emails, 100)) {
    const { data, error } = await client().from("leads").select("id, full_name, phone, email").eq("workspace_id", workspaceId).is("deleted_at", null).in("email_normalized", emailBatch);
    if (error) throw new Error(error.message);
    found.push(...((data ?? []) as typeof found));
  }
  return found;
}

export async function importLeadBatches(workspace: WorkspaceOption, rows: ImportRow[], assignedTo: string | null, duplicateAction: DuplicateAction) {
  const report: ImportReport = { created: 0, skipped: 0, merged: 0, separate: 0, invalid: [], duplicates: [] };
  const userId = await currentUserId();
  let offset = 0;
  for (const batch of chunk(rows, IMPORT_BATCH)) {
    const existing = await existingInBatch(workspace.id, batch);
    const ready: Record<string, unknown>[] = [];
    for (const [index, row] of batch.entries()) {
      const rowNumber = offset + index + 2;
      if (row.fullName.trim().length < 2) {
        report.invalid.push({ row: rowNumber, reason: "Name missing" });
        continue;
      }
      if (normalizePhone(row.phone).length < 10) {
        report.invalid.push({ row: rowNumber, reason: "Invalid phone" });
        continue;
      }
      const match = existing
        .map((item) => ({ item, kind: duplicateKind({ name: item.full_name, phone: item.phone, email: item.email }, { name: row.fullName, phone: row.phone, email: row.email }) }))
        .find((item) => item.kind);
      if (match?.kind && duplicateAction === "skip") {
        report.skipped += 1;
        report.duplicates.push({ row: rowNumber, kind: match.kind, existingName: match.item.full_name, action: "skip" });
        continue;
      }
      if (match?.kind && duplicateAction === "merge") {
        const { error } = await client().from("lead_notes").insert({
          organization_id: workspace.organizationId,
          workspace_id: workspace.id,
          lead_id: match.item.id,
          body: `Imported note for ${row.fullName}. ${row.position}`.trim(),
          created_by: userId,
        });
        if (error) report.invalid.push({ row: rowNumber, reason: error.message });
        else {
          report.merged += 1;
          report.duplicates.push({ row: rowNumber, kind: match.kind, existingName: match.item.full_name, action: "merge" });
        }
        continue;
      }
      if (match?.kind) {
        report.separate += 1;
        report.duplicates.push({ row: rowNumber, kind: match.kind, existingName: match.item.full_name, action: "separate" });
      }
      ready.push({
        organization_id: workspace.organizationId,
        workspace_id: workspace.id,
        full_name: row.fullName.trim(),
        phone: row.phone.trim(),
        email: normalizeEmail(row.email),
        location: row.location.trim(),
        position: row.position.trim(),
        source: row.source || "other",
        source_platform: "excel",
        status: row.status.trim() ? stageFromText(row.status) : "excel",
        assigned_to: assignedTo,
        created_by: userId,
        updated_by: userId,
      });
    }
    if (ready.length) {
      const { error } = await client().from("leads").insert(ready);
      if (error) report.invalid.push({ row: offset + 2, reason: error.message });
      else report.created += ready.length;
    }
    offset += batch.length;
  }
  return report;
}

export async function downloadWorkspaceCsv(workspaceId: string, range?: { from?: string; to?: string }) {
  const header = "Full name,Phone,Email,Location,Position,Source,Stage,Created";
  const lines = [header];
  const size = 500;
  let from = 0;
  let total = Number.POSITIVE_INFINITY;
  while (from < total) {
    const { data, error, count } = await client()
      .from("leads")
      .select("full_name, phone, email, location, position, source, status, created_at", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .gte("created_at", range?.from ?? "1970-01-01")
      .lt("created_at", range?.to ?? "2999-12-31")
      .order("created_at", { ascending: false })
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    total = count ?? 0;
    for (const row of data ?? []) {
      lines.push([row.full_name, row.phone, row.email, row.location, row.position, row.source, row.status, String(row.created_at).slice(0, 10)].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","));
    }
    if (!(data ?? []).length) break;
    from += size;
  }
  return lines.join("\n");
}

export interface DirectoryHit {
  id: string;
  title: string;
  meta: string;
  href: string;
}

export async function searchDirectory(query: string) {
  const search = sanitizeSearch(query);
  if (search.length < 2) return { leads: [] as DirectoryHit[], patients: [] as DirectoryHit[], students: [] as DirectoryHit[], courses: [] as DirectoryHit[] };
  const phone = normalizePhone(search);
  const leadParts = [`full_name.ilike.%${search}%`, `email_normalized.ilike.%${search.toLowerCase()}%`];
  if (phone) leadParts.push(`phone_digits.ilike.%${phone}%`);
  const [leads, patients, students, courses] = await Promise.all([
    client().from("leads").select("id, full_name, phone").is("deleted_at", null).or(leadParts.join(",")).limit(6),
    client().from("patients").select("id, full_name, patient_code, mobile").is("deleted_at", null).or(`full_name.ilike.%${search}%,patient_code.ilike.%${search}%,mobile.ilike.%${search}%`).limit(5),
    client().from("students").select("id, full_name, student_code, mobile").is("deleted_at", null).or(`full_name.ilike.%${search}%,student_code.ilike.%${search}%,mobile.ilike.%${search}%`).limit(5),
    client().from("courses").select("id, name").ilike("name", `%${search}%`).limit(5),
  ]);
  return {
    leads: leads.error ? [] : (leads.data ?? []).map((row) => ({ id: String(row.id), title: String(row.full_name), meta: String(row.phone || "Lead"), href: `/leads/${row.id}` })),
    patients: patients.error ? [] : (patients.data ?? []).map((row) => ({ id: String(row.id), title: String(row.full_name), meta: String(row.patient_code || row.mobile || "Patient"), href: "/clinic" })),
    students: students.error ? [] : (students.data ?? []).map((row) => ({ id: String(row.id), title: String(row.full_name), meta: String(row.student_code || row.mobile || "Student"), href: "/institute" })),
    courses: courses.error ? [] : (courses.data ?? []).map((row) => ({ id: String(row.id), title: String(row.name), meta: "Course", href: "/institute" })),
  };
}
