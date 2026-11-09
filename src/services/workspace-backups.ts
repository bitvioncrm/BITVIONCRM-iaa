import { supabase } from "@/lib/supabase";

export type BackupKind = "instant" | "rolling" | "alternate";
export type BackupDesk = "clinic" | "institute";

export type WorkspaceBackup = {
  id: string;
  organizationId: string;
  workspaceId: string;
  workspaceType: BackupDesk;
  kind: BackupKind;
  label: string;
  status: "pending" | "running" | "ready" | "failed";
  storagePath: string;
  byteSize: number;
  tableCount: number;
  rowCount: number;
  detail: string;
  createdAt: string;
  finishedAt: string | null;
};

export type BackupProgress = {
  phase: "prepare" | "collect" | "pack" | "upload" | "finish" | "done" | "error";
  table: string;
  tableIndex: number;
  tableTotal: number;
  rows: number;
  percent: number;
  message: string;
};

type WorkspaceRef = {
  id: string;
  organizationId: string;
  name: string;
  workspaceType: BackupDesk;
};

const SHARED_TABLES = [
  "leads",
  "lead_notes",
  "lead_assignments",
  "lead_status_history",
  "followups",
  "tasks",
  "messages",
  "call_time_sessions",
  "documents",
  "invoices",
  "invoice_items",
  "payments",
  "refunds",
  "automation_rules",
  "automation_runs",
  "meta_form_mappings",
  "meta_import_events",
  "whatsapp_campaigns",
  "whatsapp_campaign_sends",
  "workspace_channel_secrets",
] as const;

const CLINIC_TABLES = [
  ...SHARED_TABLES,
  "patients",
  "appointments",
  "consultations",
  "prescriptions",
  "patient_procedures",
  "patient_procedure_items",
  "inventory_products",
  "inventory_transactions",
  "clinic_ledger",
] as const;

const INSTITUTE_TABLES = [
  ...SHARED_TABLES,
  "students",
  "admissions",
  "courses",
  "batches",
  "exams",
  "marks",
  "certificates",
] as const;

const KEEP = { rolling: 7, alternate: 5, instant: 14 } as const;

function client() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

function tablesFor(desk: BackupDesk) {
  return desk === "clinic" ? [...CLINIC_TABLES] : [...INSTITUTE_TABLES];
}

function redactSecrets(table: string, rows: Record<string, unknown>[]) {
  if (table !== "workspace_channel_secrets") return rows;
  return rows.map((row) => ({
    ...row,
    access_token: row.access_token ? "[redacted]" : "",
    app_secret: row.app_secret ? "[redacted]" : "",
    verify_token: row.verify_token ? "[redacted]" : "",
  }));
}

async function fetchWorkspace(workspaceId: string): Promise<WorkspaceRef> {
  const { data, error } = await client()
    .from("workspaces")
    .select("id, organization_id, name, workspace_type")
    .eq("id", workspaceId)
    .is("deleted_at", null)
    .single();
  if (error) throw new Error(error.message);
  const type = String(data.workspace_type || "");
  if (type !== "clinic" && type !== "institute") throw new Error("Backup is only available for clinic and institute.");
  return {
    id: String(data.id),
    organizationId: String(data.organization_id),
    name: String(data.name || type),
    workspaceType: type,
  };
}

async function pageTable(table: string, workspaceId: string) {
  if (table === "invoice_items") {
    const invoices = await client().from("invoices").select("id").eq("workspace_id", workspaceId).limit(5000);
    if (invoices.error) throw new Error(invoices.error.message);
    const ids = (invoices.data ?? []).map((row) => String(row.id));
    if (!ids.length) return [];
    const chunk: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const items = await client().from("invoice_items").select("*").in("invoice_id", slice);
      if (items.error) throw new Error(items.error.message);
      chunk.push(...((items.data ?? []) as Record<string, unknown>[]));
    }
    return redactSecrets(table, chunk);
  }
  if (table === "patient_procedure_items") {
    const procedures = await client().from("patient_procedures").select("id").eq("workspace_id", workspaceId).limit(5000);
    if (procedures.error) throw new Error(procedures.error.message);
    const ids = (procedures.data ?? []).map((row) => String(row.id));
    if (!ids.length) return [];
    const items = await client().from("patient_procedure_items").select("*").in("procedure_id", ids);
    if (items.error) throw new Error(items.error.message);
    return redactSecrets(table, (items.data ?? []) as Record<string, unknown>[]);
  }
  if (table === "lead_notes" || table === "lead_assignments" || table === "lead_status_history") {
    const leads = await client().from("leads").select("id").eq("workspace_id", workspaceId).is("deleted_at", null).limit(20000);
    if (leads.error) throw new Error(leads.error.message);
    const ids = (leads.data ?? []).map((row) => String(row.id));
    if (!ids.length) return [];
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const batch = await client().from(table).select("*").in("lead_id", slice);
      if (batch.error) throw new Error(batch.error.message);
      out.push(...((batch.data ?? []) as Record<string, unknown>[]));
    }
    return redactSecrets(table, out);
  }

  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let query = client().from(table).select("*").eq("workspace_id", workspaceId).range(from, to);
    if (table === "leads" || table === "patients" || table === "students" || table === "tasks" || table === "documents" || table === "whatsapp_campaigns") {
      query = query.is("deleted_at", null);
    }
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return redactSecrets(table, rows);
}

async function pruneBackups(workspaceId: string, kind: BackupKind) {
  const keep = KEEP[kind];
  const { data, error } = await client()
    .from("workspace_backups")
    .select("id, storage_path")
    .eq("workspace_id", workspaceId)
    .eq("kind", kind)
    .eq("status", "ready")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const extra = (data ?? []).slice(keep);
  for (const row of extra) {
    if (row.storage_path) await client().storage.from("workspace-backups").remove([String(row.storage_path)]);
    await client().from("workspace_backups").delete().eq("id", row.id);
  }
}

function simpleChecksum(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export async function listWorkspaceBackups(workspaceId?: string) {
  let query = client()
    .from("workspace_backups")
    .select("id, organization_id, workspace_id, workspace_type, kind, label, status, storage_path, byte_size, table_count, row_count, detail, created_at, finished_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    workspaceId: String(row.workspace_id),
    workspaceType: row.workspace_type as BackupDesk,
    kind: row.kind as BackupKind,
    label: String(row.label || ""),
    status: row.status as WorkspaceBackup["status"],
    storagePath: String(row.storage_path || ""),
    byteSize: Number(row.byte_size ?? 0),
    tableCount: Number(row.table_count ?? 0),
    rowCount: Number(row.row_count ?? 0),
    detail: String(row.detail || ""),
    createdAt: String(row.created_at || ""),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  })) satisfies WorkspaceBackup[];
}

export async function createWorkspaceBackup(
  workspaceId: string,
  kind: BackupKind,
  options?: { label?: string; onProgress?: (progress: BackupProgress) => void },
) {
  const notify = options?.onProgress;
  const workspace = await fetchWorkspace(workspaceId);
  const tables = tablesFor(workspace.workspaceType);
  const user = await client().auth.getUser();
  const createdBy = user.data.user?.id ?? null;

  notify?.({ phase: "prepare", table: "", tableIndex: 0, tableTotal: tables.length, rows: 0, percent: 2, message: `Preparing ${workspace.name} backup…` });

  const insert = await client()
    .from("workspace_backups")
    .insert({
      organization_id: workspace.organizationId,
      workspace_id: workspace.id,
      workspace_type: workspace.workspaceType,
      kind,
      label: (options?.label || (kind === "instant" ? "Instant full backup" : kind === "rolling" ? "7-day rolling backup" : "Alternate safe copy")).trim(),
      status: "running",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (insert.error) throw new Error(insert.error.message);
  const backupId = String(insert.data.id);

  try {
    const payload: Record<string, unknown> = {
      version: 1,
      kind,
      workspace: {
        id: workspace.id,
        organizationId: workspace.organizationId,
        name: workspace.name,
        type: workspace.workspaceType,
      },
      createdAt: new Date().toISOString(),
      tables: {} as Record<string, unknown[]>,
    };
    let rowCount = 0;
    for (let index = 0; index < tables.length; index += 1) {
      const table = tables[index];
      notify?.({
        phase: "collect",
        table,
        tableIndex: index + 1,
        tableTotal: tables.length,
        rows: rowCount,
        percent: Math.round(5 + (index / tables.length) * 70),
        message: `Collecting ${table.replaceAll("_", " ")}…`,
      });
      try {
        const rows = await pageTable(table, workspace.id);
        (payload.tables as Record<string, unknown[]>)[table] = rows;
        rowCount += rows.length;
      } catch (reason) {
        // Skip tables the role cannot read; keep backup useful.
        (payload.tables as Record<string, unknown[]>)[table] = [];
        payload[`skip:${table}`] = reason instanceof Error ? reason.message : "skipped";
      }
    }

    notify?.({ phase: "pack", table: "", tableIndex: tables.length, tableTotal: tables.length, rows: rowCount, percent: 78, message: "Packing encrypted JSON snapshot…" });
    const text = JSON.stringify(payload);
    const bytes = new Blob([text], { type: "application/json" });
    const checksum = simpleChecksum(text);
    const storagePath = `${workspace.organizationId}/${workspace.id}/${kind}/${backupId}.json`;

    notify?.({ phase: "upload", table: "", tableIndex: tables.length, tableTotal: tables.length, rows: rowCount, percent: 88, message: "Uploading to secure backup vault…" });
    const uploaded = await client().storage.from("workspace-backups").upload(storagePath, bytes, { contentType: "application/json", upsert: true });
    if (uploaded.error) throw new Error(uploaded.error.message);

    notify?.({ phase: "finish", table: "", tableIndex: tables.length, tableTotal: tables.length, rows: rowCount, percent: 96, message: "Finalizing vault record…" });
    const updated = await client()
      .from("workspace_backups")
      .update({
        status: "ready",
        storage_path: storagePath,
        byte_size: bytes.size,
        table_count: tables.length,
        row_count: rowCount,
        checksum,
        detail: `${tables.length} tables · ${rowCount.toLocaleString("en-IN")} rows`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", backupId);
    if (updated.error) throw new Error(updated.error.message);

    await pruneBackups(workspace.id, kind);
    notify?.({ phase: "done", table: "", tableIndex: tables.length, tableTotal: tables.length, rows: rowCount, percent: 100, message: "Backup ready" });
    return backupId;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Backup failed";
    await client().from("workspace_backups").update({ status: "failed", detail: message, finished_at: new Date().toISOString() }).eq("id", backupId);
    notify?.({ phase: "error", table: "", tableIndex: 0, tableTotal: tables.length, rows: 0, percent: 100, message });
    throw reason instanceof Error ? reason : new Error(message);
  }
}

export async function downloadWorkspaceBackup(backup: WorkspaceBackup) {
  if (!backup.storagePath) throw new Error("This backup has no file yet.");
  const { data, error } = await client().storage.from("workspace-backups").download(backup.storagePath);
  if (error) throw new Error(error.message);
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${backup.workspaceType}-${backup.kind}-${backup.createdAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function removeWorkspaceBackup(backup: WorkspaceBackup) {
  if (backup.storagePath) await client().storage.from("workspace-backups").remove([backup.storagePath]);
  const { error } = await client().from("workspace_backups").delete().eq("id", backup.id);
  if (error) throw new Error(error.message);
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
