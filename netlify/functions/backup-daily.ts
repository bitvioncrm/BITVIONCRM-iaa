import { CLINIC_TABLES, INSTITUTE_TABLES, redactSecrets } from "../lib/workspace-backup-core.ts";

function required(name: string) {
  return process.env[name]?.trim() || "";
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function rest<T>(url: string, serviceKey: string, path: string, init?: RequestInit) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: init?.method === "POST" ? "return=representation" : "return=minimal",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
  }
  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function fetchPaged(url: string, serviceKey: string, table: string, workspaceId: string) {
  if (table === "invoice_items") {
    const invoices = await rest<Array<{ id: string }>>(url, serviceKey, `invoices?workspace_id=eq.${workspaceId}&select=id&limit=5000`);
    const ids = (invoices ?? []).map((row) => row.id);
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100).join(",");
      if (!slice) continue;
      const batch = await rest<Record<string, unknown>[]>(url, serviceKey, `invoice_items?invoice_id=in.(${slice})&select=*`);
      rows.push(...(batch ?? []));
    }
    return redactSecrets(table, rows);
  }
  if (table === "prescriptions") {
    const consultations = await rest<Array<{ id: string }>>(url, serviceKey, `consultations?workspace_id=eq.${workspaceId}&select=id&limit=5000`);
    const ids = (consultations ?? []).map((row) => row.id);
    if (!ids.length) return [];
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100).join(",");
      const batch = await rest<Record<string, unknown>[]>(url, serviceKey, `prescriptions?consultation_id=in.(${slice})&select=*`);
      rows.push(...(batch ?? []));
    }
    return redactSecrets(table, rows);
  }
  if (table === "patient_procedure_items") {
    const procedures = await rest<Array<{ id: string }>>(url, serviceKey, `patient_procedures?workspace_id=eq.${workspaceId}&select=id&limit=5000`);
    const ids = (procedures ?? []).map((row) => row.id);
    if (!ids.length) return [];
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100).join(",");
      const batch = await rest<Record<string, unknown>[]>(url, serviceKey, `patient_procedure_items?procedure_id=in.(${slice})&select=*`);
      rows.push(...(batch ?? []));
    }
    return redactSecrets(table, rows);
  }
  if (table === "lead_notes" || table === "lead_assignments" || table === "lead_status_history") {
    const leads = await rest<Array<{ id: string }>>(url, serviceKey, `leads?workspace_id=eq.${workspaceId}&deleted_at=is.null&select=id&limit=20000`);
    const ids = (leads ?? []).map((row) => row.id);
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 80) {
      const slice = ids.slice(i, i + 80).join(",");
      if (!slice) continue;
      const batch = await rest<Record<string, unknown>[]>(url, serviceKey, `${table}?lead_id=in.(${slice})&select=*`);
      rows.push(...(batch ?? []));
    }
    return redactSecrets(table, rows);
  }
  if (table === "whatsapp_campaign_sends") {
    const camps = await rest<Array<{ id: string }>>(url, serviceKey, `whatsapp_campaigns?workspace_id=eq.${workspaceId}&select=id&limit=500`);
    const ids = (camps ?? []).map((row) => row.id);
    if (!ids.length) return [];
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const slice = ids.slice(i, i + 50).join(",");
      const batch = await rest<Record<string, unknown>[]>(url, serviceKey, `whatsapp_campaign_sends?campaign_id=in.(${slice})&select=*&limit=20000`);
      rows.push(...(batch ?? []));
    }
    return redactSecrets(table, rows);
  }

  const soft = ["leads", "patients", "students", "tasks", "documents", "whatsapp_campaigns"].includes(table);
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const to = from + 999;
    const filter = soft ? `&deleted_at=is.null` : "";
    const batch = await rest<Record<string, unknown>[]>(
      url,
      serviceKey,
      `${table}?workspace_id=eq.${workspaceId}${filter}&select=*&order=created_at.asc&offset=${from}&limit=1000`,
      { headers: { range: `${from}-${to}` } },
    );
    const page = batch ?? [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return redactSecrets(table, rows);
}

async function uploadJson(url: string, serviceKey: string, path: string, body: string) {
  const response = await fetch(`${url}/storage/v1/object/workspace-backups/${path}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      "x-upsert": "true",
    },
    body,
  });
  if (!response.ok) throw new Error(await response.text());
}

async function backupWorkspace(url: string, serviceKey: string, workspace: { id: string; organization_id: string; name: string; workspace_type: string }) {
  const type = workspace.workspace_type === "institute" ? "institute" : "clinic";
  const tables = type === "institute" ? INSTITUTE_TABLES : CLINIC_TABLES;
  const created = await rest<Array<{ id: string }>>(url, serviceKey, "workspace_backups", {
    method: "POST",
    body: JSON.stringify({
      organization_id: workspace.organization_id,
      workspace_id: workspace.id,
      workspace_type: type,
      kind: "rolling",
      label: "Automatic 7-day rolling backup",
      status: "running",
    }),
  });
  const backupId = created?.[0]?.id;
  if (!backupId) throw new Error("Could not create backup row");

  try {
    const payload: Record<string, unknown> = {
      version: 1,
      kind: "rolling",
      workspace: { id: workspace.id, organizationId: workspace.organization_id, name: workspace.name, type },
      createdAt: new Date().toISOString(),
      tables: {} as Record<string, unknown[]>,
    };
    let rowCount = 0;
    for (const table of tables) {
      try {
        const rows = await fetchPaged(url, serviceKey, table, workspace.id);
        (payload.tables as Record<string, unknown[]>)[table] = rows;
        rowCount += rows.length;
      } catch {
        (payload.tables as Record<string, unknown[]>)[table] = [];
      }
    }
    const text = JSON.stringify(payload);
    const storagePath = `${workspace.organization_id}/${workspace.id}/rolling/${backupId}.json`;
    await uploadJson(url, serviceKey, storagePath, text);
    await rest(url, serviceKey, `workspace_backups?id=eq.${backupId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "ready",
        storage_path: storagePath,
        byte_size: new TextEncoder().encode(text).length,
        table_count: tables.length,
        row_count: rowCount,
        detail: `${tables.length} tables · ${rowCount} rows · daily`,
        finished_at: new Date().toISOString(),
      }),
      headers: { prefer: "return=minimal" },
    });

    const ready = await rest<Array<{ id: string; storage_path: string }>>(
      url,
      serviceKey,
      `workspace_backups?workspace_id=eq.${workspace.id}&kind=eq.rolling&status=eq.ready&select=id,storage_path&order=created_at.desc`,
    );
    for (const row of (ready ?? []).slice(7)) {
      if (row.storage_path) {
        await fetch(`${url}/storage/v1/object/workspace-backups/${row.storage_path}`, {
          method: "DELETE",
          headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
        });
      }
      await rest(url, serviceKey, `workspace_backups?id=eq.${row.id}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    }
    return { workspaceId: workspace.id, backupId, rowCount };
  } catch (reason) {
    await rest(url, serviceKey, `workspace_backups?id=eq.${backupId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", detail: reason instanceof Error ? reason.message : "failed", finished_at: new Date().toISOString() }),
      headers: { prefer: "return=minimal" },
    });
    throw reason;
  }
}

export default async () => {
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(503, { status: "configuration_required" });

  try {
    const workspaces = await rest<Array<{ id: string; organization_id: string; name: string; workspace_type: string }>>(
      supabaseUrl,
      serviceKey,
      "workspaces?workspace_type=in.(clinic,institute)&deleted_at=is.null&select=id,organization_id,name,workspace_type",
    );
    const results = [];
    for (const workspace of workspaces ?? []) {
      results.push(await backupWorkspace(supabaseUrl, serviceKey, workspace));
    }
    return json(200, { status: "ok", results });
  } catch (reason) {
    return json(500, { status: "error", detail: reason instanceof Error ? reason.message : "backup failed" });
  }
};
