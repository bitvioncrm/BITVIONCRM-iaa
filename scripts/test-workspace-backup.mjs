/**
 * Service-role smoke test for premium workspace backups.
 * Usage: node scripts/test-workspace-backup.mjs
 * (clinic smoke subset — workspace 8d5ecf49-2ebc-4500-8b9e-65ae411bcf7b)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

const root = resolve("D:/Bitvion Techzz/BITVION CRM");
const env = {
  ...loadEnv(resolve(root, ".env")),
  ...loadEnv(resolve(root, "WHATSAPP_AUTOMATION/.env")),
};
const skipSsl =
  env.SUPABASE_SKIP_SSL_VERIFY === "1" ||
  env.SUPABASE_SKIP_SSL_VERIFY === "true" ||
  process.env.SUPABASE_SKIP_SSL_VERIFY === "1" ||
  process.env.SUPABASE_SKIP_SSL_VERIFY === "true";
if (skipSsl) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE URL / SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = {
  apikey: key,
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, prefer: init.method === "POST" ? "return=representation" : "return=minimal", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const workspaceId = "8d5ecf49-2ebc-4500-8b9e-65ae411bcf7b"; // clinic
const orgId = (
  await rest(`workspaces?id=eq.${workspaceId}&select=organization_id,name,workspace_type`)
)[0];

console.log("workspace", orgId);

const tables = ["patients", "appointments", "invoices", "payments", "clinic_ledger", "leads"];
const softDeleteTables = new Set(["leads", "patients", "students"]);
const payload = {
  version: 1,
  kind: "instant",
  workspace: { id: workspaceId, organizationId: orgId.organization_id, name: orgId.name, type: orgId.workspace_type },
  createdAt: new Date().toISOString(),
  tables: {},
};
let rows = 0;
for (const table of tables) {
  const soft = softDeleteTables.has(table) ? "&deleted_at=is.null" : "";
  const data = await rest(`${table}?workspace_id=eq.${workspaceId}${soft}&select=*&limit=5000`);
  payload.tables[table] = data ?? [];
  rows += (data ?? []).length;
  console.log(`  ${table}: ${(data ?? []).length}`);
}

const created = await rest("workspace_backups", {
  method: "POST",
  body: JSON.stringify({
    organization_id: orgId.organization_id,
    workspace_id: workspaceId,
    workspace_type: orgId.workspace_type,
    kind: "instant",
    label: "Automated test instant backup",
    status: "running",
  }),
});
const backupId = created[0].id;
const body = JSON.stringify(payload);
const storagePath = `${orgId.organization_id}/${workspaceId}/instant/${backupId}.json`;

const up = await fetch(`${url}/storage/v1/object/workspace-backups/${storagePath}`, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json", "x-upsert": "true" },
  body,
});
if (!up.ok) {
  const detail = await up.text();
  await rest(`workspace_backups?id=eq.${backupId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "failed", detail, finished_at: new Date().toISOString() }),
  });
  throw new Error(`upload failed: ${detail}`);
}

await rest(`workspace_backups?id=eq.${backupId}`, {
  method: "PATCH",
  body: JSON.stringify({
    status: "ready",
    storage_path: storagePath,
    byte_size: Buffer.byteLength(body),
    table_count: tables.length,
    row_count: rows,
    detail: `test · ${tables.length} tables · ${rows} rows`,
    finished_at: new Date().toISOString(),
  }),
});

const listed = await rest(
  `workspace_backups?id=eq.${backupId}&select=id,status,byte_size,row_count,table_count,storage_path,label`,
);
console.log("READY", listed[0]);

const dl = await fetch(`${url}/storage/v1/object/workspace-backups/${storagePath}`, {
  headers: { apikey: key, authorization: `Bearer ${key}` },
});
console.log("DOWNLOAD", dl.status, dl.headers.get("content-length") || "ok");
if (!dl.ok) throw new Error(await dl.text());
const parsed = JSON.parse(await dl.text());
console.log("PAYLOAD tables", Object.keys(parsed.tables || {}).join(", "));
console.log("TEST_OK");
writeFileSync(
  resolve(root, "scripts/.last-backup-smoke.json"),
  JSON.stringify({ ...listed[0], downloadStatus: dl.status, workspaceId }, null, 2),
);
