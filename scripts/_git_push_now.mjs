#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = path.join(ROOT, 'scripts', '_git_push_report.txt');

const EXCLUDE = new Set([
  '.env',
  'WHATSAPP_AUTOMATION/qr-diwali.png',
  'scripts/.last-backup-smoke.json',
  'scripts/.local-backup-daemon.json',
  'WHATSAPP_AUTOMATION/scripts/_patch_create_patient.py',
  'scripts/_git_push_now.mjs',
  'scripts/git-push-all-now.bat',
  'scripts/_git_push_report.txt',
]);

const COMMIT_MSG =
  'Add premium backups, local all-day daemon, day-long admin sessions, and reception delete fixes.';

function git(args) {
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trimEnd();
  return { code: r.status ?? 1, out };
}

function isSecretOrExcluded(norm) {
  if (EXCLUDE.has(norm)) return true;
  const base = path.basename(norm);
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (norm.includes('/.env') || norm.endsWith('.env')) return true;
  if (/credentials/i.test(norm)) return true;
  return false;
}

const sections = [];
function section(title, body) {
  sections.push(`=== ${title} ===\n${body}\n`);
}

const statusSb = git(['status', '-sb']);
const stat = git(['diff', '--stat']);
const log = git(['log', '-5', '--oneline']);

section('git status -sb', statusSb.out);
section('git diff --stat', stat.out);
section('git log -5 --oneline', log.out);

const porcelain = git(['status', '--porcelain=v1', '-uall']);
const toStage = [];
for (const line of porcelain.out.split(/\r?\n/).filter(Boolean)) {
  const entry = line.slice(3).trim();
  const file = entry.includes(' -> ') ? entry.split(' -> ').pop().trim() : entry;
  const norm = file.replace(/\\/g, '/');
  if (isSecretOrExcluded(norm)) continue;
  toStage.push(file);
}

section('files to stage', toStage.join('\n') || '(none)');

for (const f of toStage) {
  const add = git(['add', '--', f]);
  if (add.code !== 0) section(`git add failed: ${f}`, add.out);
}

const staged = git(['diff', '--cached', '--name-only']);
section('staged after add', staged.out || '(empty)');

const commit = git(['commit', '-m', COMMIT_MSG]);
section('git commit', `exit ${commit.code}\n${commit.out}`);

let push = { code: 0, out: 'skipped (commit failed or nothing to commit)' };
if (commit.code === 0) {
  push = git(['push', 'origin', 'HEAD']);
  if (push.code !== 0) {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
    if (branch === 'main' || branch === 'master') {
      push = git(['push', 'origin', branch]);
    }
  }
  section('git push', `exit ${push.code}\n${push.out}`);
} else if (/nothing to commit/i.test(commit.out)) {
  push = git(['push', 'origin', 'HEAD']);
  section('git push (no new commit)', `exit ${push.code}\n${push.out}`);
}

section('push remote URL', git(['remote', 'get-url', 'origin']).out);

const hash = git(['rev-parse', 'HEAD']);
section('commit hash', hash.out);

const final = git(['status', '--short']);
section('git status --short', final.out);

const summary = {
  commitHash: hash.out.trim(),
  commitExit: commit.code,
  pushExit: push.code,
  pushOutput: push.out,
};

sections.push(`=== SUMMARY (JSON) ===\n${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(REPORT, sections.join('\n'), 'utf8');
process.exit(push.code === 0 || commit.code === 0 ? 0 : 1);
