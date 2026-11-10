#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync("git", ["push", "previous", "HEAD:main"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  timeout: 180000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
});
process.stdout.write(`${r.stdout || ""}${r.stderr || ""}`);
process.exit(r.status ?? 1);
