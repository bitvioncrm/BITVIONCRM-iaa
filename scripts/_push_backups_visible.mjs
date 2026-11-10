#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, "scripts", "_push_backups_visible.txt");
const MSG = "Show Settings & Backups in admin nav and redeploy Premium Backups UI.";

const FILES = [
  "src/App.tsx",
  "src/components/layout/nav.ts",
  "src/lib/production-access.ts",
  "src/pages/production/ProductionOpsPages.tsx",
  "src/components/settings/PremiumBackups.tsx",
  "src/services/workspace-backups.ts",
];

function git(args) {
  const r = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { code: r.status ?? 1, out: `${r.stdout || ""}${r.stderr || ""}`.trimEnd() };
}

const log = [];
const add = (t, b) => log.push(`=== ${t} ===\n${b}\n`);

add("status before", git(["status", "-sb"]).out);
for (const f of FILES) {
  if (fs.existsSync(path.join(ROOT, f))) git(["add", "--", f]);
}
add("staged", git(["diff", "--cached", "--name-only"]).out);
const commit = git(["commit", "-m", MSG]);
add("commit", `exit ${commit.code}\n${commit.out}`);
const pushOrigin = git(["push", "origin", "HEAD"]);
add("push origin", `exit ${pushOrigin.code}\n${pushOrigin.out}`);
const pushPrev = git(["push", "previous", "HEAD:main"]);
add("push previous", `exit ${pushPrev.code}\n${pushPrev.out}`);
add("hash", git(["rev-parse", "HEAD"]).out);
add("status after", git(["status", "-sb"]).out);
fs.writeFileSync(REPORT, log.join("\n"), "utf8");
process.exit(pushOrigin.code === 0 ? 0 : 1);
