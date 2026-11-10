import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.join(root, '_git_commit_report.json');

function run(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '') + `\nEXIT:${e.status}\n`;
  }
}

const report = {
  status: run(['status', '--porcelain=v1', '-b']),
  stat: run(['diff', '--stat']),
  log: run(['log', '-5', '--oneline']),
};
fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
console.log('wrote', out);
