#!/usr/bin/env node
/* One-time bootstrap updater for an install without .git.
 *
 * Installs before 0.1.46 have no release updater, so they cannot fetch one. Run this file
 * once with node; it takes the latest release, verifies it, backs up the current code and
 * swaps it in. After that, `musicfy update` handles it.
 *
 *   curl -fsSL https://raw.githubusercontent.com/theh4v0c/musicfy/main/bin/update-bundle.mjs -o /tmp/musicfy-update.mjs
 *   node /tmp/musicfy-update.mjs ~/.musicfy/app
 *   musicfy restart
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.env.MUSICFY_REPO_SLUG || 'theh4v0c/musicfy';
const CODE = ['core', 'web', 'bin', 'design', 'docs'];
const FILES = [
  'install.sh', 'package.json', 'README.md', 'INSTALL.md', 'OPERATIONS.md', 'DOCS.md',
  'DESIGN.md', 'MILESTONES.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE',
  'CONTRIBUTING.md', 'THIRD_PARTY.md', 'AGENT_INSTALL.md', 'DOMAIN.md',
];
const target = path.resolve(process.argv[2] || process.env.MUSICFY_APP || path.join(process.env.MUSICFY_HOME || path.join(os.homedir(), '.musicfy'), 'app'));

const versionOf = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return null; }
};
const cmp = (a, b) => {
  const pa = String(a).replace(/^v/i, '').split(/[.\-+]/);
  const pb = String(b).replace(/^v/i, '').split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    if (x === y) continue;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) > Number(y) ? 1 : -1;
    return x > y ? 1 : -1;
  }
  return 0;
};

const here = versionOf(target);
if (!here) {
  console.error(`No MUSICFY install at ${target} (no package.json).`);
  console.error('Pass the code folder: node update-bundle.mjs /path/to/app');
  process.exit(1);
}

const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
  headers: { 'user-agent': 'musicfy-updater', accept: 'application/vnd.github+json' },
});
if (!res.ok) { console.error(`GitHub answered ${res.status}`); process.exit(1); }
const rel = await res.json();
const to = String(rel.tag_name || '').replace(/^v/i, '');
if (!to || !rel.tarball_url) { console.error('The release has no tag or tarball'); process.exit(1); }
if (cmp(to, here) <= 0) { console.log(`Already on ${here}; latest release is ${to}. Nothing to do.`); process.exit(0); }

console.log(`${target}: ${here} -> ${to}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musicfy-boot-'));
try {
  const tgz = path.join(tmp, 'release.tgz');
  const dl = await fetch(rel.tarball_url, { headers: { 'user-agent': 'musicfy-updater' }, redirect: 'follow' });
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  fs.writeFileSync(tgz, Buffer.from(await dl.arrayBuffer()));
  execFileSync('tar', ['-xzf', tgz, '-C', tmp], { timeout: 120000 });
  const root = fs.readdirSync(tmp, { withFileTypes: true }).filter((e) => e.isDirectory())
    .map((e) => path.join(tmp, e.name)).find((d) => fs.existsSync(path.join(d, 'package.json')));
  if (!root) throw new Error('archive has no package.json');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'musicfy' || cmp(String(pkg.version), to) !== 0) {
    throw new Error(`archive is ${pkg.version}, release says ${to}`);
  }
  const backup = path.join(path.dirname(target), 'backups', `code-${here}-${Date.now().toString(36)}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const entry of [...CODE, ...FILES]) {
    const src = path.join(target, entry);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(backup, entry), { recursive: true });
  }
  for (const entry of [...CODE, ...FILES]) {
    const src = path.join(root, entry);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(target, entry), { recursive: true, force: true });
  }
  console.log(`Updated to ${versionOf(target)}. Previous code: ${backup}`);
  console.log('Restart: musicfy restart');
} catch (e) {
  console.error('Update failed:', e.message);
  process.exit(1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
