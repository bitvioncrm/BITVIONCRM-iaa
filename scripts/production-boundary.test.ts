import { readFileSync } from "node:fs";

const auth = readFileSync(new URL("../src/context/AuthContext.tsx", import.meta.url), "utf8");
if (auth.includes("DEMO_ACCOUNTS") || auth.includes("admin123") || auth.includes("staff123")) {
  throw new Error("demo passwords are still accepted");
}
if (auth.includes("recruitflow.session") && auth.includes("setItem(SESSION_KEY")) {
  throw new Error("browser session is still used as login");
}

const storage = readFileSync(new URL("../src/services/storage.ts", import.meta.url), "utf8");
if (!storage.includes("bitvion.crm.v7")) throw new Error("demo key missing from the legacy store");
const idle = storage.split("export function idleCrm")[1]?.split("export function freshCrm")[0] ?? "";
if (idle.includes("buildSeed")) throw new Error("production shell still builds demo leads");

const crm = readFileSync(new URL("../src/context/CrmContext.tsx", import.meta.url), "utf8");
if (!crm.includes("if (productionUser) return")) throw new Error("production sessions still persist demo data");

console.log("production boundary ok");
