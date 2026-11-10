#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, "scripts", "_git_push_report.txt");
const MSG =
  "Show Rimisha, Siji, and Bhama by name in reception booking and polish admin backups.";

const INCLUDE = [
  "src/components/dashboard/BusinessBoard.tsx",
  "src/components/layout/MobileNav.tsx",
  "src/components/layout/Sidebar.tsx",
  "src/components/layout/nav.ts",
  "src/components/settings/PremiumBackups.tsx",
  "src/pages/production/ProductionDashboard.tsx",
  "src/pages/production/ProductionModule.tsx",
  "src/pages/production/ProductionOpsPages.tsx",
  "src/pages/production/SchedulePages.tsx",
  "src/services/production-leads.ts",
  "src/services/production-ops.ts",
  "supabase/migrations/20261110140000_clinic_doctor_display_names.sql",
];

function git(args) {
  const r = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    code: r.status ?? 1,
    out: `${r.stdout || ""}${r.stderr || ""}`.trimEnd(),
    error: r.error?.message,
  };
}

const log = [];
const add = (title, body) => log.push(`=== ${title} ===\n${body}\n`);

add("status before", git(["status", "-sb"]).out);
add("log -5", git(["log", "-5", "--oneline"]).out);

for (const file of INCLUDE) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    add(`missing ${file}`, "skipped");
    continue;
  }
  const added = git(["add", "--", file]);
  if (added.code !== 0) add(`add failed ${file}`, `${added.out}\n${added.error || ""}`);
}

add("staged", git(["diff", "--cached", "--name-only"]).out || "(empty)");

const commit = git(["commit", "-m", MSG]);
add("commit", `exit ${commit.code}\n${commit.out}${commit.error ? `\n${commit.error}` : ""}`);

let push = { code: 1, out: "not run" };
if (commit.code === 0 || /nothing to commit/i.test(commit.out)) {
  push = git(["push", "origin", "HEAD"]);
  if (push.code !== 0) {
    const previous = git(["push", "previous", "HEAD:main"]);
    add("push previous", `exit ${previous.code}\n${previous.out}${previous.error ? `\n${previous.error}` : ""}`);
  }
}
add("push origin", `exit ${push.code}\n${push.out}${push.error ? `\n${push.error}` : ""}`);
add("hash", git(["rev-parse", "HEAD"]).out);
add("status after", git(["status", "-sb"]).out);

fs.writeFileSync(REPORT, log.join("\n"), "utf8");
process.exit(push.code === 0 ? 0 : 1);
