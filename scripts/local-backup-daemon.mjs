/**
 * Local all-day automatic backups for clinic + institute.
 * Runs rolling backups on an interval during work hours (default 09:00–21:00 local).
 *
 *   node scripts/local-backup-daemon.mjs
 *   BACKUP_INTERVAL_MIN=180 node scripts/local-backup-daemon.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
  return out;
}

const env = { ...loadEnv(resolve(root, ".env")), ...loadEnv(resolve(root, "WHATSAPP_AUTOMATION/.env")) };
if (env.SUPABASE_SKIP_SSL_VERIFY === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[backup-daemon] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const INTERVAL_MS = Math.max(30, Number(env.BACKUP_INTERVAL_MIN || 180)) * 60 * 1000;
const START_HOUR = Number(env.BACKUP_START_HOUR || 9);
const END_HOUR = Number(env.BACKUP_END_HOUR || 21);
const KEEP_ROLLING = 7;
const statePath = resolve(root, "scripts/.local-backup-daemon.json");

const headers = {
  apikey: key,
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
};

const CLINIC_TABLES = [
  "patients", "appointments", "consultations", "prescriptions", "patient_procedures", "patient_procedure_items",
  "inventory_products", "inventory_transactions", "clinic_ledger",
  "invoices", "invoice_items", "payments", "refunds",
  "leads", "followups", "messages", "documents", "whatsapp_campaigns", "workspace_channel_secrets",
];
const INSTITUTE_TABLES = [
  "students", "admissions", "courses", "batches", "exams", "marks", "certificates",
  "invoices", "invoice_items", "payments", "refunds",
  "leads", "followups", "messages", "documents", "whatsapp_campaigns", "workspace_channel_secrets",
];

function log(msg) {
  console.log(`[backup-daemon ${new Date().toLocaleString("en-IN")}] ${msg}`);
}

function withinHours() {
  const h = new Date().getHours();
  return h >= START_HOUR && h < END_HOUR;
}

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...headers,
      prefer: init.method === "POST" ? "return=representation" : "return=minimal",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function redact(table, rows) {
  if (table !== "workspace_channel_secrets") return rows;
  return rows.map((row) => ({
    ...row,
    access_token: row.access_token ? "[redacted]" : "",
    app_secret: row.app_secret ? "[redacted]" : "",
    verify_token: row.verify_token ? "[redacted]" : "",
  }));
}

async function fetchTable(table, workspaceId) {
  if (table === "invoice_items") {
    const invoices = await rest(`invoices?workspace_id=eq.${workspaceId}&select=id&limit=5000`);
    const ids = (invoices ?? []).map((r) => r.id);
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100).join(",");
      if (!slice) continue;
      const batch = await rest(`invoice_items?invoice_id=in.(${slice})&select=*`);
      out.push(...(batch ?? []));
    }
    return redact(table, out);
  }
  if (table === "patient_procedure_items") {
    const procedures = await rest(`patient_procedures?workspace_id=eq.${workspaceId}&select=id&limit=5000`);
    const ids = (procedures ?? []).map((r) => r.id);
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100).join(",");
      const batch = await rest(`patient_procedure_items?procedure_id=in.(${slice})&select=*`);
      out.push(...(batch ?? []));
    }
    return redact(table, out);
  }
  if (table === "prescriptions") {
    return redact(table, (await rest(`prescriptions?workspace_id=eq.${workspaceId}&select=*&limit=5000`)) ?? []);
  }
  const soft = ["leads", "patients", "students", "documents", "whatsapp_campaigns"].includes(table);
  const filter = soft ? "&deleted_at=is.null" : "";
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const batch = await rest(`${table}?workspace_id=eq.${workspaceId}${filter}&select=*&limit=1000&offset=${from}`);
    const page = batch ?? [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return redact(table, rows);
}

async function prune(workspaceId) {
  const ready = await rest(
    `workspace_backups?workspace_id=eq.${workspaceId}&kind=eq.rolling&status=eq.ready&select=id,storage_path&order=created_at.desc`,
  );
  for (const row of (ready ?? []).slice(KEEP_ROLLING)) {
    if (row.storage_path) {
      await fetch(`${url}/storage/v1/object/workspace-backups/${row.storage_path}`, {
        method: "DELETE",
        headers: { apikey: key, authorization: `Bearer ${key}` },
      });
    }
    await rest(`workspace_backups?id=eq.${row.id}`, { method: "DELETE" });
  }
}

async function backupWorkspace(ws) {
  const type = ws.workspace_type === "institute" ? "institute" : "clinic";
  const tables = type === "institute" ? INSTITUTE_TABLES : CLINIC_TABLES;
  const created = await rest("workspace_backups", {
    method: "POST",
    body: JSON.stringify({
      organization_id: ws.organization_id,
      workspace_id: ws.id,
      workspace_type: type,
      kind: "rolling",
      label: "Local automatic all-day backup",
      status: "running",
    }),
  });
  const backupId = created?.[0]?.id;
  if (!backupId) throw new Error("Could not create backup row");

  try {
    const payload = {
      version: 1,
      kind: "rolling",
      source: "local-daemon",
      workspace: { id: ws.id, organizationId: ws.organization_id, name: ws.name, type },
      createdAt: new Date().toISOString(),
      tables: {},
    };
    let rowCount = 0;
    for (const table of tables) {
      try {
        const rows = await fetchTable(table, ws.id);
        payload.tables[table] = rows;
        rowCount += rows.length;
        log(`${ws.name}: ${table} (${rows.length})`);
      } catch (err) {
        payload.tables[table] = [];
        payload[`skip:${table}`] = err instanceof Error ? err.message : "skip";
      }
    }
    const body = JSON.stringify(payload);
    const storagePath = `${ws.organization_id}/${ws.id}/rolling/${backupId}.json`;
    const up = await fetch(`${url}/storage/v1/object/workspace-backups/${storagePath}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "x-upsert": "true" },
      body,
    });
    if (!up.ok) throw new Error(await up.text());
    await rest(`workspace_backups?id=eq.${backupId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "ready",
        storage_path: storagePath,
        byte_size: Buffer.byteLength(body),
        table_count: tables.length,
        row_count: rowCount,
        detail: `local daemon · ${tables.length} tables · ${rowCount} rows`,
        finished_at: new Date().toISOString(),
      }),
    });
    await prune(ws.id);
    return { workspaceId: ws.id, backupId, rowCount, bytes: Buffer.byteLength(body) };
  } catch (err) {
    await rest(`workspace_backups?id=eq.${backupId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "failed",
        detail: err instanceof Error ? err.message : "failed",
        finished_at: new Date().toISOString(),
      }),
    });
    throw err;
  }
}

async function cycle() {
  if (!withinHours()) {
    log(`Outside ${START_HOUR}:00–${END_HOUR}:00 — skipping this tick`);
    return;
  }
  const workspaces = await rest(
    "workspaces?workspace_type=in.(clinic,institute)&deleted_at=is.null&select=id,organization_id,name,workspace_type",
  );
  const results = [];
  for (const ws of workspaces ?? []) {
    log(`Starting ${ws.name}…`);
    results.push(await backupWorkspace(ws));
  }
  const state = { lastRunAt: new Date().toISOString(), results };
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  log(`Cycle done: ${results.map((r) => `${r.workspaceId.slice(0, 8)}=${r.rowCount}`).join(", ")}`);
}

log(`Local all-day backup daemon started (every ${INTERVAL_MS / 60000} min, ${START_HOUR}:00–${END_HOUR}:00)`);
void cycle().catch((err) => log(`First cycle error: ${err instanceof Error ? err.message : err}`));
setInterval(() => {
  void cycle().catch((err) => log(`Cycle error: ${err instanceof Error ? err.message : err}`));
}, INTERVAL_MS);
