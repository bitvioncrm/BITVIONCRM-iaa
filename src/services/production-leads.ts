import { stageFromText } from "@/data/catalog";
import { chunk, duplicateKind, normalizeEmail, normalizePhone, phoneKey, sanitizeSearch, type DuplicateKind } from "@/lib/lead-normalize";
import { supabase } from "@/lib/supabase";
import type { LeadStatus } from "@/types";

const PAGE_SIZE = 20;
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

export async function listWorkspaces() {
  const { data, error } = await client().from("workspaces").select("id, organization_id, name, workspace_type").is("deleted_at", null).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    name: row.name as string,
    workspaceType: row.workspace_type as string,
  })) satisfies WorkspaceOption[];
}

export async function listAssignableMembers(workspaceId: string) {
  const { data, error } = await client()
    .from("user_roles")
    .select("user_id, workspace_id, roles(key), profiles(full_name)")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const roles = row.roles as { key: string } | { key: string }[] | null;
    const role = Array.isArray(roles) ? roles[0]?.key : roles?.key;
    if (role !== "clinic_bde" && role !== "institute_bde") return [];
    const profiles = row.profiles as { full_name: string } | { full_name: string }[] | null;
    const name = Array.isArray(profiles) ? profiles[0]?.full_name : profiles?.full_name;
    return [{ userId: row.user_id as string, name: name ?? "BDE", role: role ?? "", workspaceId: row.workspace_id as string }];
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
    if (role !== "doctor") return [];
    const profiles = row.profiles as { full_name: string } | { full_name: string }[] | null;
    const name = Array.isArray(profiles) ? profiles[0]?.full_name : profiles?.full_name;
    return [{ userId: row.user_id as string, name: name ?? "Doctor" }];
  });
}

export interface LeadQuery {
  page: number;
  workspaceId?: string;
  status?: string;
  search?: string;
  assignedTo?: string;
}

export async function listLeads(query: LeadQuery) {
  const from = Math.max(0, query.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let request = client().from("leads").select("*", { count: "exact" }).is("deleted_at", null);
  if (query.workspaceId) request = request.eq("workspace_id", query.workspaceId);
  if (query.status) request = request.eq("status", query.status);
  if (query.assignedTo) request = request.eq("assigned_to", query.assignedTo);
  const search = sanitizeSearch(query.search ?? "");
  if (search) {
    const phone = normalizePhone(search);
    const parts = [`full_name.ilike.%${search}%`, `email_normalized.ilike.%${search.toLowerCase()}%`, `position.ilike.%${search}%`];
    if (phone) parts.push(`phone_digits.ilike.%${phone}%`);
    request = request.or(parts.join(","));
  }
  const { data, error, count } = await request.order("created_at", { ascending: false }).range(from, to);
  if (error) throw new Error(error.message);
  const total = count ?? 0;
  return { leads: ((data ?? []) as LeadRow[]).map(mapLead), total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), pageSize: PAGE_SIZE };
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

export async function assignLead(lead: ProductionLead, assignedTo: string) {
  const userId = await currentUserId();
  const { error } = await client().from("leads").update({ assigned_to: assignedTo, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", lead.id);
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
        status: stageFromText(row.status),
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

export async function downloadWorkspaceCsv(workspaceId: string) {
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
