#!/usr/bin/env node
/**
 * One-shot: inspect, stage (excluding secrets), commit, push, report.
 * Run: node scripts/_do_git_commit.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = path.join(ROOT, '_git_commit_report.json');

const EXCLUDE = new Set([
  '.env',
  'WHATSAPP_AUTOMATION/qr-diwali.png',
  'scripts/.last-backup-smoke.json',
  'scripts/.local-backup-daemon.json',
  'WHATSAPP_AUTOMATION/scripts/_patch_create_patient.py',
]);

function git(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...opts,
  });
  return {
    code: r.status ?? 1,
    out: (r.stdout || '') + (r.stderr || ''),
  };
}

function campaignsJsonHuge() {
  const p = path.join(ROOT, 'WHATSAPP_AUTOMATION/data/campaigns.json');
  if (!fs.existsSync(p)) return false;
  const st = fs.statSync(p);
  if (st.size > 500_000) return true;
  const diff = git(['diff', '--numstat', '--', 'WHATSAPP_AUTOMATION/data/campaigns.json']);
  const m = diff.out.trim().match(/^(\d+)\t(\d+)/m);
  if (m) {
    const added = Number(m[1]);
    const removed = Number(m[2]);
    if (added + removed > 200) return true;
  }
  return false;
}

const porcelain = git(['status', '--porcelain=v1', '-uall']);
const lines = porcelain.out.split(/\r?\n/).filter(Boolean);

const toStage = [];
for (const line of lines) {
  const entry = line.slice(3);
  const file = entry.includes(' -> ') ? entry.split(' -> ').pop() : entry;
  const norm = file.replace(/\\/g, '/');
  if (EXCLUDE.has(norm) || norm.endsWith('/.env') || norm === '.env') continue;
  if (norm === 'WHATSAPP_AUTOMATION/data/campaigns.json' && campaignsJsonHuge()) continue;
  if (norm === 'scripts/_git_commit_helper.mjs' || norm === 'scripts/_do_git_commit.mjs') continue;
  if (norm === '_shell_test.txt' || norm === '_git_commit_report.json') continue;
  toStage.push(file);
}

const stagedBefore = git(['diff', '--cached', '--name-only']);
for (const f of toStage) {
  git(['add', '--', f]);
}

const commitMsg =
  'Add premium clinic/institute backups with local all-day daemon and day-long admin sessions.';

const commit = git(['commit', '-m', commitMsg]);
let push = { code: 0, out: 'skipped' };
if (commit.code === 0) {
  push = git(['push', '-u', 'origin', 'HEAD']);
}

const report = {
  root: ROOT,
  excludeCampaignsJson: campaignsJsonHuge(),
  stagedFiles: git(['diff', '--cached', '--name-only']).out.trim().split(/\r?\n/).filter(Boolean),
  commit: { code: commit.code, out: commit.out },
  push: { code: push.code, out: push.out },
  hash: git(['rev-parse', 'HEAD']).out.trim(),
  status: git(['status', '-sb']).out,
  stat: git(['diff', '--stat']).out,
  log: git(['log', '-5', '--oneline']).out,
  porcelain: porcelain.out,
  attemptedStage: toStage,
};

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
process.stdout.write(JSON.stringify({ ok: commit.code === 0 && push.code === 0, report: REPORT }));
