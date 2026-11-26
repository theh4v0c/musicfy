'use strict';
/* Release-bundle updates.
 *
 * An install made with `install.sh --local` or from a downloaded archive has no .git, and
 * `musicfy update` used to stop at "not a git checkout". It now takes the latest published
 * release from GitHub, verifies it, backs up the current code and swaps it in. Data,
 * backups and musicfy.env live outside these paths and are not touched.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO = process.env.MUSICFY_REPO_SLUG || 'theh4v0c/musicfy';
// only code and docs are replaced; anything the owner put next to them is left alone
const CODE = ['core', 'web', 'bin', 'design', 'docs'];
const FILES = [
  'install.sh', 'package.json', 'README.md', 'INSTALL.md', 'OPERATIONS.md', 'DOCS.md',
  'DESIGN.md', 'MILESTONES.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE',
  'CONTRIBUTING.md', 'THIRD_PARTY.md', 'AGENT_INSTALL.md', 'DOMAIN.md',
];

function versionParts(v) {
  return String(v || '0').replace(/^v/i, '').split(/[.\-+]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}
// 1 when a is newer than b, -1 when older, 0 when equal
function compare(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1;
    return String(x) > String(y) ? 1 : -1;
  }
  return 0;
}

async function latest() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'user-agent': 'musicfy-updater', accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  const body = await res.json();
  const version = String(body.tag_name || '').replace(/^v/i, '');
  if (!version || !body.tarball_url) throw new Error('the release has no tag or tarball');
  // the release job publishes the archive and its sha256; the auto-generated tarball is a
  // different artifact and carries no checksum
  const assets = (body.assets || []).map((a) => ({
    name: String(a.name || ''), url: String(a.browser_download_url || ''), size: Number(a.size) || 0,
  })).filter((a) => a.name && a.url);
  return { version, tarball: body.tarball_url, assets, page: body.html_url || '', published: body.published_at || null };
}

function readVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || ''; } catch { return ''; }
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': 'musicfy-updater' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf;
}

const sha256 = (buf) => require('node:crypto').createHash('sha256').update(buf).digest('hex');

async function apply(appRoot) {
  const rel = await latest();
  const from = readVersion(appRoot) || '0.0.0';
  if (compare(rel.version, from) <= 0) return { from, to: from, upToDate: true };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musicfy-rel-'));
  try {
    const tgz = path.join(tmp, 'release.tgz');
    // Prefer the archive the release job built: it has a published sha256 next to it.
    const wanted = [`musicfy-v${rel.version}.tar.gz`, `musicfy-${rel.version}.tar.gz`];
    const asset = (rel.assets || []).find((a) => wanted.includes(a.name));
    let verified = false;
    if (asset) {
      const buf = await download(asset.url, tgz);
      const sumAsset = (rel.assets || []).find((a) => a.name === `${asset.name}.sha256`);
      if (!sumAsset) throw new Error('the release archive has no checksum');
      const sumRes = await fetch(sumAsset.url, { headers: { 'user-agent': 'musicfy-updater' }, redirect: 'follow' });
      if (!sumRes.ok) throw new Error(`checksum download ${sumRes.status}`);
      const want = String(await sumRes.text()).trim().split(/\s+/)[0].toLowerCase();
      const got = sha256(buf);
      if (!/^[0-9a-f]{64}$/.test(want) || want !== got) {
        throw new Error(`checksum mismatch: the release says ${want.slice(0, 12)}, the download is ${got.slice(0, 12)}`);
      }
      verified = true;
    } else {
      // an older release without the built archive: the generated tarball has no checksum
      await download(rel.tarball, tgz);
    }
    execFileSync('tar', ['-xzf', tgz, '-C', tmp], { timeout: 120000 });

    // the archive holds one directory; find it by its package.json rather than by name
    const root = fs.readdirSync(tmp, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(tmp, e.name))
      .find((d) => fs.existsSync(path.join(d, 'package.json')));
    if (!root) throw new Error('the archive has no package.json');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'musicfy') throw new Error(`unexpected package: ${pkg.name}`);
    if (compare(String(pkg.version || '0'), rel.version) !== 0) {
      throw new Error(`archive is ${pkg.version}, release says ${rel.version}`);
    }

    // keep the old code next to the data so a broken release can be put back by hand
    const backupRoot = path.join(path.dirname(appRoot), 'backups', `code-${from}-${Date.now().toString(36)}`);
    fs.mkdirSync(backupRoot, { recursive: true });
    for (const entry of [...CODE, ...FILES]) {
      const src = path.join(appRoot, entry);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(backupRoot, entry), { recursive: true });
    }

    for (const entry of [...CODE, ...FILES]) {
      const src = path.join(root, entry);
      if (!fs.existsSync(src)) continue;
      fs.cpSync(src, path.join(appRoot, entry), { recursive: true, force: true });
    }
    return { from, to: rel.version, upToDate: false, backup: backupRoot, verified };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { latest, apply, compare, REPO };
