import { readFileSync } from "node:fs";
import { syncMetaLeads } from "../netlify/lib/meta-sync.ts";

const file = process.argv[2];
if (!file) throw new Error("env file required");
const values = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
for (const [key, value] of Object.entries(values)) process.env[key] = value;
const result = await syncMetaLeads();
console.log(JSON.stringify({ status: result.status, stored: result.stored, duplicate: result.duplicate, failed: result.failed, forms: result.forms, reason: result.reason, webhook: result.webhook }));
