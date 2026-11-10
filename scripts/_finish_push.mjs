#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, "scripts", "_push_backups_visible.txt");

function git(args) {
  const r = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    code: r.status ?? 1,
    out: `${r.stdout || ""}${r.stderr || ""}`.trimEnd(),
    signal: r.signal,
    error: r.error?.message,
  };
}

const log = [];
const add = (t, b) => log.push(`=== ${t} ===\n${b}\n`);

add("note", "Push completion run (commits already on main).");
add("hash", git(["rev-parse", "HEAD"]).out);
add("log -2", git(["log", "-2", "--oneline"]).out);

const pushOrigin = git(["push", "origin", "HEAD"]);
add(
  "push origin",
  `exit ${pushOrigin.code}\n${pushOrigin.out}${pushOrigin.signal ? `\nsignal ${pushOrigin.signal}` : ""}${pushOrigin.error ? `\nerror ${pushOrigin.error}` : ""}`,
);

const pushPrev = git(["push", "previous", "HEAD:main"]);
add(
  "push previous",
  `exit ${pushPrev.code}\n${pushPrev.out}${pushPrev.signal ? `\nsignal ${pushPrev.signal}` : ""}${pushPrev.error ? `\nerror ${pushPrev.error}` : ""}`,
);

add("status after", git(["status", "-sb"]).out);
fs.writeFileSync(REPORT, log.join("\n"), "utf8");
process.exit(pushOrigin.code === 0 && pushPrev.code === 0 ? 0 : 1);
