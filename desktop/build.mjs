#!/usr/bin/env node
/* Build MUSICFY.app and a DMG.
 *
 *   node desktop/build.mjs            fetch binaries if missing, bundle, sign, make the DMG
 *   node desktop/build.mjs --vendor   only fetch/refresh the binaries in desktop/vendor/bin
 *
 * The app is the Electron runtime plus this repository: core/ is the engine, web/ is the
 * interface. The bundled binaries are ffmpeg, ffprobe and yt-dlp, so downloads and
 * artwork work on a Mac with no Homebrew. The analyser (Python + librosa) is not bundled.
 *
 * The build is arm64 or x64 depending on the host; Electron ships one architecture per
 * install. Run it on the architecture you are shipping to.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const VENDOR = path.join(HERE, 'vendor');
const BIN = path.join(VENDOR, 'bin');
const DIST = path.join(APP, 'dist');
const STAGE = path.join(DIST, 'stage');
const BUNDLE = path.join(STAGE, 'MUSICFY.app');
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const ARCH = process.arch;
const YTDLP = {
  version: '2026.11.23',
  url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.23/yt-dlp_macos',
  sha256: '57654854886d0398a798895aadf5173e2749fbb5e249b9f3728022ab376e11fb',
};

const say = (...a) => console.log(...a);
const fail = (msg) => { console.error(`build: ${msg}`); process.exit(1); };
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function copyExecutable(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.chmodSync(to, 0o755);
}

/* ---------- 1. binaries ---------- */

function vendor() {
  fs.mkdirSync(BIN, { recursive: true });

  const ffmpeg = require('ffmpeg-static');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    fail('ffmpeg-static is not installed: run `npm install` first');
  }
  const ffprobe = require('@ffprobe-installer/ffprobe').path;
  if (!ffprobe || !fs.existsSync(ffprobe)) {
    fail('@ffprobe-installer/ffprobe has no binary for this architecture');
  }

  copyExecutable(ffmpeg, path.join(BIN, 'ffmpeg'));
  copyExecutable(ffprobe, path.join(BIN, 'ffprobe'));

  const cached = path.join(VENDOR, `yt-dlp-${YTDLP.version}`);
  if (!fs.existsSync(cached)) {
    say(`  fetching yt-dlp ${YTDLP.version}`);
    execFileSync('curl', ['-fL', '--retry', '3', '-o', `${cached}.part`, YTDLP.url], { stdio: 'inherit' });
    const got = sha256(`${cached}.part`);
    if (got !== YTDLP.sha256) fail(`yt-dlp checksum mismatch: ${got}`);
    fs.renameSync(`${cached}.part`, cached);
  }
  if (sha256(cached) !== YTDLP.sha256) fail('the cached yt-dlp does not match its checksum');
  copyExecutable(cached, path.join(BIN, 'yt-dlp'));

  for (const name of ['ffmpeg', 'ffprobe', 'yt-dlp']) {
    const size = (fs.statSync(path.join(BIN, name)).size / 1e6).toFixed(1);
    say(`  ${name.padEnd(8)} ${size} MB`);
  }
  return BIN;
}

/* ---------- 2. icon ---------- */

function icon() {
  const out = path.join(DIST, 'icon.icns');
  if (fs.existsSync(out)) return out;
  const iconset = path.join(DIST, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });

  // The SVG is the source of truth; Quick Look renders it at 1024 with alpha.
  let source = path.join(APP, 'web', 'icon-512.png');
  const rendered = path.join(DIST, 'icon-1024.png');
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-icon-'));
    execFileSync('qlmanage', ['-t', '-s', '1024', '-o', tmp, path.join(APP, 'web', 'icon.svg')], { stdio: 'ignore' });
    const png = path.join(tmp, 'icon.svg.png');
    if (fs.existsSync(png)) { fs.copyFileSync(png, rendered); source = rendered; }
  } catch { /* fall back to the PNG the web app already ships */ }

  const sizes = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of sizes) {
    execFileSync('sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, name)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', out], { stdio: 'inherit' });
  fs.rmSync(iconset, { recursive: true, force: true });
  return out;
}

/* ---------- 3. bundle ---------- */

function plist(key, value) {
  const file = path.join(BUNDLE, 'Contents', 'Info.plist');
  try { execFileSync('plutil', ['-remove', key, file], { stdio: 'ignore' }); } catch { /* not there */ }
  execFileSync('plutil', ['-insert', key, '-string', value, file]);
}

function bundle(binDir, icns) {
  const electronApp = path.join(APP, 'node_modules', 'electron', 'dist', 'Electron.app');
  if (!fs.existsSync(electronApp)) fail('electron is not installed: run `npm install` first');

  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  say('  copying the Electron runtime');
  fs.cpSync(electronApp, BUNDLE, { recursive: true, verbatimSymlinks: true });
  fs.renameSync(path.join(BUNDLE, 'Contents', 'MacOS', 'Electron'), path.join(BUNDLE, 'Contents', 'MacOS', 'MUSICFY'));

  const res = path.join(BUNDLE, 'Contents', 'Resources');
  fs.rmSync(path.join(res, 'default_app.asar'), { force: true });
  fs.copyFileSync(icns, path.join(res, 'icon.icns'));

  const appDir = path.join(res, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const dir of ['core', 'web', 'design']) {
    fs.cpSync(path.join(APP, dir), path.join(appDir, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(appDir, 'desktop'), { recursive: true });
  for (const file of ['main.js', 'preload.js']) {
    fs.copyFileSync(path.join(HERE, file), path.join(appDir, 'desktop', file));
  }
  for (const file of ['package.json', 'LICENSE', 'THIRD_PARTY.md', 'README.md']) {
    fs.copyFileSync(path.join(APP, file), path.join(appDir, file));
  }
  fs.cpSync(binDir, path.join(res, 'bin'), { recursive: true });
  for (const name of fs.readdirSync(path.join(res, 'bin'))) {
    fs.chmodSync(path.join(res, 'bin', name), 0o755);
  }

  plist('CFBundleExecutable', 'MUSICFY');
  plist('CFBundleName', 'MUSICFY');
  plist('CFBundleDisplayName', 'MUSICFY');
  plist('CFBundleIdentifier', 'com.musicfy.desktop');
  plist('CFBundleShortVersionString', pkg.version);
  plist('CFBundleVersion', pkg.version);
  plist('CFBundleIconFile', 'icon.icns');
  plist('CFBundleGetInfoString', `MUSICFY ${pkg.version}`);
  plist('LSApplicationCategoryType', 'public.app-category.music');
  plist('LSMinimumSystemVersion', '13.0');
  plist('NSHumanReadableCopyright', 'AGPL-3.0-or-later');
  plist('NSDocumentsFolderUsageDescription', 'MUSICFY reads the music folders you choose. Nothing is uploaded.');
  plist('NSDownloadsFolderUsageDescription', 'MUSICFY can scan a folder you keep in Downloads. Nothing is uploaded.');
  plist('NSDesktopFolderUsageDescription', 'MUSICFY can scan a folder you keep on the Desktop. Nothing is uploaded.');
  plist('NSRemovableVolumesUsageDescription', 'MUSICFY can play a library kept on an external drive.');
  plist('NSAppleMusicUsageDescription', 'MUSICFY reads the music files you point it at, and never writes to your Apple Music library.');

  // ad-hoc: the bundle is internally consistent, but no Gatekeeper identity is claimed
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', BUNDLE], { stdio: 'inherit' });
  try { execFileSync('codesign', ['--verify', '--deep', '--strict', BUNDLE], { stdio: 'inherit' }); }
  catch { fail('codesign --verify failed'); }
  return BUNDLE;
}

/* ---------- 4. dmg ---------- */

function dmg() {
  const name = `MUSICFY-${pkg.version}-${ARCH}.dmg`;
  const out = path.join(DIST, name);
  fs.rmSync(out, { force: true });
  const link = path.join(STAGE, 'Applications');
  try { fs.rmSync(link, { force: true }); } catch { /* none */ }
  fs.symlinkSync('/Applications', link);
  execFileSync('hdiutil', [
    'create', '-volname', 'MUSICFY', '-srcfolder', STAGE,
    '-ov', '-format', 'UDZO', '-quiet', out,
  ], { stdio: 'inherit' });
  return out;
}

/* ---------- run ---------- */

if (process.platform !== 'darwin') fail('the desktop build is macOS only');

say(`MUSICFY ${pkg.version} · ${ARCH}`);
say('binaries');
const binDir = vendor();
if (process.argv.includes('--vendor')) process.exit(0);

say('icon');
const icns = icon();
say('app');
bundle(binDir, icns);
say('dmg');
const out = dmg();

const appSize = execFileSync('du', ['-sh', BUNDLE], { encoding: 'utf8' }).split('\t')[0];
const dmgSize = (fs.statSync(out).size / 1e6).toFixed(0);
say(`\n${out}`);
say(`  ${appSize.trim()} installed · ${dmgSize} MB download`);
say('  unsigned: first launch needs System Settings → Privacy & Security → Open Anyway.');
