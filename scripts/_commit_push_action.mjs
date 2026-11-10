#!/usr/bin/env node
/**
 * Selective commit + push per product file list. Logs to scripts/_commit_push_action.txt
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'scripts', '_commit_push_action.txt');

const COMMIT_MSG =
  'Add premium backups, local day-long admin sessions, and reception delete fixes.';

const INCLUDE = [
  '.gitignore',
  'src/lib/supabase.ts',
  'src/context/AuthContext.tsx',
  'src/pages/LoginPage.tsx',
  'src/components/settings/PremiumBackups.tsx',
  'src/services/workspace-backups.ts',
  'src/services/production-ops.ts',
  'src/pages/production/ProductionDashboard.tsx',
  'src/pages/production/ProductionModule.tsx',
  'src/pages/production/ProductionOpsPages.tsx',
  'src/pages/production/ProductionWhatsApp.tsx',
  'netlify.toml',
  'netlify/functions/backup-daily.ts',
  'netlify/lib/workspace-backup-core.ts',
  'supabase/migrations/20261109143000_soft_delete_patient.sql',
  'supabase/migrations/20261109150000_workspace_backups.sql',
  'scripts/local-backup-daemon.mjs',
  'scripts/start-local-backup-daemon.bat',
  'scripts/install-local-backup-task.bat',
  'scripts/test-workspace-backup.mjs',
  'WHATSAPP_AUTOMATION/FREE_LOCAL_SEND.md',
  'WHATSAPP_AUTOMATION/posters/diwali-membership-offer.jpg',
  'WHATSAPP_AUTOMATION/scripts/seed_diwali_campaign.py',
  'WHATSAPP_AUTOMATION/scripts/test_and_start_diwali.py',
  'WHATSAPP_AUTOMATION/scripts/watch_qr_then_bulk.py',
  'WHATSAPP_AUTOMATION/scripts/update_diwali_and_go.py',
  'WHATSAPP_AUTOMATION/app/main.py',
  'WHATSAPP_AUTOMATION/app/waha_client.py',
  'WHATSAPP_AUTOMATION/data/accounts.json',
  'WHATSAPP_AUTOMATION/data/projects.json',
];

const EXCLUDE = new Set([
  'scripts/_commit_push_action.txt',
  'scripts/_commit_push_action.mjs',
  'scripts/_git_push_now.mjs',
  'scripts/git-push-all-now.bat',
]);

const lines = [];

function log(section, body = '') {
  lines.push(`=== ${section} ===`);
  if (body) lines.push(body);
  lines.push('');
}

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

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

log('RUN', `node scripts/_commit_push_action.mjs\nroot: ${ROOT}\nbranch target: main`);

log('git status -sb', git(['status', '-sb']).out);
log('git branch --show-current', git(['branch', '--show-current']).out);
log('git diff --stat (unstaged)', git(['diff', '--stat']).out);
log('git log -3 --oneline', git(['log', '-3', '--oneline']).out);

const present = [];
const missing = [];
for (const rel of INCLUDE) {
  if (EXCLUDE.has(rel.replace(/\\/g, '/'))) continue;
  if (exists(rel)) present.push(rel);
  else missing.push(rel);
}

log('include present on disk', present.join('\n') || '(none)');
log('include missing (skipped)', missing.join('\n') || '(none)');

for (const f of present) {
  const add = git(['add', '--', f]);
  if (add.code !== 0) log(`git add FAILED: ${f}`, add.out);
}

log('staged files', git(['diff', '--cached', '--name-only']).out || '(empty)');

const commit = git(['commit', '-m', COMMIT_MSG]);
log('git commit', `exit ${commit.code}\n${commit.out}`);

let push = { code: 1, out: 'not run' };
if (commit.code === 0) {
  push = git(['push', '-u', 'origin', 'HEAD']);
  log('git push -u origin HEAD', `exit ${push.code}\n${push.out}`);
} else if (/nothing to commit/i.test(commit.out)) {
  push = git(['push', '-u', 'origin', 'HEAD']);
  log('git push (nothing to commit)', `exit ${push.code}\n${push.out}`);
} else {
  log('git push -u origin HEAD', 'skipped (commit failed)');
}

const hash = git(['rev-parse', 'HEAD']);
log('commit hash', hash.out.trim());

log('git status --short', git(['status', '--short']).out);
log('git status -sb (final)', git(['status', '-sb']).out);

const summary = {
  commitHash: hash.out.trim(),
  commitExit: commit.code,
  pushExit: push.code,
  commitMessage: COMMIT_MSG,
  stagedCount: present.length,
};

log('SUMMARY', JSON.stringify(summary, null, 2));

fs.writeFileSync(LOG, lines.join('\n'), 'utf8');
process.exit(commit.code === 0 && push.code === 0 ? 0 : push.code !== 0 ? push.code : commit.code);
