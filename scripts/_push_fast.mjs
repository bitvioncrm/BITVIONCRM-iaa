#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, "scripts", "_push_fast.txt");
const MSG =
  "Show Settings & Backups in admin nav so Premium Backups is visible on live.";

const FILES = [
  "src/App.tsx",
  "src/components/layout/nav.ts",
  "src/components/layout/MobileNav.tsx",
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
    timeout: 180000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    code: r.status ?? 1,
    out: `${r.stdout || ""}${r.stderr || ""}`.trimEnd(),
    signal: r.signal,
    error: r.error?.message,
  };
}

function fileHasChanges(rel) {
  const porcelain = git(["status", "--porcelain", "--", rel]);
  return porcelain.out.trim().length > 0;
}

const log = [];
const add = (t, b) => log.push(`=== ${t} ===\n${b}\n`);

add("run", `node scripts/_push_fast.mjs\nroot: ${ROOT}\ntime: ${new Date().toISOString()}`);
add("remotes", git(["remote", "-v"]).out);
add("branch", git(["branch", "--show-current"]).out);
add("status before", git(["status", "-sb"]).out);
add("log -3", git(["log", "-3", "--oneline"]).out);

const staged = [];
const skipped = [];
for (const f of FILES) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) {
    skipped.push(`${f} (missing)`);
    continue;
  }
  if (fileHasChanges(f)) {
    const r = git(["add", "--", f]);
    if (r.code !== 0) add(`git add failed: ${f}`, `exit ${r.code}\n${r.out}`);
    else staged.push(f);
  } else {
    skipped.push(`${f} (unchanged)`);
  }
}

add("staged files", staged.join("\n") || "(none)");
add("skipped", skipped.join("\n") || "(none)");
add("cached names", git(["diff", "--cached", "--name-only"]).out || "(empty)");

const commit = git(["commit", "-m", MSG]);
add("commit", `exit ${commit.code}\n${commit.out}`);

const hash = git(["rev-parse", "HEAD"]);
add("commit hash", hash.out);

let pushOrigin = { code: 1, out: "not run" };
let pushPrev = { code: 1, out: "not run" };

const noCommitNeeded = /nothing to commit|no changes added to commit/i.test(
  commit.out,
);
const shouldPush = commit.code === 0 || noCommitNeeded;
if (shouldPush) {
  pushOrigin = git(["push", "origin", "HEAD"]);
  add(
    "push origin HEAD",
    `exit ${pushOrigin.code}\n${pushOrigin.out}${pushOrigin.signal ? `\nsignal ${pushOrigin.signal}` : ""}${pushOrigin.error ? `\nerror ${pushOrigin.error}` : ""}`,
  );

  pushPrev = git(["push", "previous", "HEAD:main"]);
  add(
    "push previous HEAD:main",
    `exit ${pushPrev.code}\n${pushPrev.out}${pushPrev.signal ? `\nsignal ${pushPrev.signal}` : ""}${pushPrev.error ? `\nerror ${pushPrev.error}` : ""}`,
  );
} else {
  add("push", "skipped (commit failed)");
}

add("status after", git(["status", "-sb"]).out);

const summary = {
  commitHash: hash.out.trim(),
  commitExit: commit.code,
  pushOriginExit: pushOrigin.code,
  pushPreviousExit: pushPrev.code,
  message: MSG,
};
add("SUMMARY", JSON.stringify(summary, null, 2));

fs.writeFileSync(REPORT, log.join("\n"), "utf8");

const ok =
  (commit.code === 0 || noCommitNeeded) &&
  pushOrigin.code === 0 &&
  pushPrev.code === 0;
process.exit(ok ? 0 : 1);
