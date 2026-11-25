#!/usr/bin/env node
// MUSICFY command line: one file, no dependencies. It only orchestrates the service,
// the environment file and the host tools; the app itself still reads core/paths.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(APP, 'core', 'core.js');
const DEFAULT_ROOT = process.env.MUSICFY_HOME || path.join(os.homedir(), '.musicfy');
const argv = process.argv.slice(2);
const command = argv[0] || 'help';
const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
if (argv.includes('-f')) flags.add('-f');
const options = Object.fromEntries(argv.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => {
  const i = a.indexOf('=');
  return [a.slice(2, i), a.slice(i + 1)];
}));
// words that are not flags or flag values, in order (command first)
const positionals = (() => {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { if (!a.includes('=') && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1; continue; }
    if (a.startsWith('-')) continue;
    out.push(a);
  }
  return out;
})();

const valueOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const rootDir = path.resolve(options.root || valueOf('root', DEFAULT_ROOT));
const envFile = path.join(rootDir, 'musicfy.env');
const pidFile = path.join(rootDir, 'musicfy.pid');
const logDir = path.join(rootDir, 'logs');
const logFile = path.join(logDir, 'musicfy.log');

function readEnv(file = envFile) {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function writeEnv(values) {
  const current = readEnv();
  const merged = { ...current, ...values };
  const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, body, { mode: 0o600 });
}

function runtimeEnv() {
  const file = readEnv();
  const env = { ...file, ...process.env };
  env.MUSICFY_HOME = rootDir;
  env.MUSICFY_PORT = String(options.port || valueOf('port', env.MUSICFY_PORT || 8710));
  env.MUSICFY_BIND = options.bind || valueOf('bind', env.MUSICFY_BIND || '0.0.0.0');
  env.MUSICFY_OWNED = env.MUSICFY_OWNED || path.join(rootDir, 'owned');
  env.MUSICFY_DATA = env.MUSICFY_DATA || path.join(rootDir, 'data');
  env.MUSICFY_BACKUP_DIR = env.MUSICFY_BACKUP_DIR || path.join(rootDir, 'backups');
  return env;
}

function urlFor(env = runtimeEnv()) {
  const host = env.MUSICFY_BIND === '0.0.0.0' || env.MUSICFY_BIND === '::' ? 'localhost' : env.MUSICFY_BIND;
  return `http://${host}:${env.MUSICFY_PORT}`;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  return r.status === 0;
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

function which(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim().split(/\r?\n/)[0] : '';
}

function pid() {
  try { return Number(fs.readFileSync(pidFile, 'utf8').trim()) || 0; } catch { return 0; }
}

function alive(p) {
  if (!p) return false;
  try {
    process.kill(p, 0);
    const cmd = capture('ps', ['-p', String(p), '-o', 'command=']);
    return !cmd || cmd.includes('core.js');
  } catch { return false; }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function ensureDirs() {
  for (const d of [rootDir, logDir, path.join(rootDir, 'data'), path.join(rootDir, 'backups'), path.join(rootDir, 'owned')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function health(env = runtimeEnv()) {
  const headers = env.MUSICFY_TOKEN ? { authorization: `Bearer ${env.MUSICFY_TOKEN}` } : {};
  return fetch(`${urlFor(env)}/health`, { headers, signal: AbortSignal.timeout(1200) });
}

function printToken(url, token) {
  console.log(`\nMUSICFY is at ${url}`);
  if (token) console.log(`First visit: ${url}/?token=${token}`);
}

function help() {
  console.log(`MUSICFY ${version()}

Usage: musicfy <command> [options]

  setup [--root DIR] [--port N] [--bind ADDR] [--owned DIR] [--token] [--skip-deps]
        Create directories, musicfy.env and the two Python venvs; print the URL.
  serve                     Run the server in the foreground (what systemd runs).
  start | stop | restart    Run it in the background, with a PID file and logs.
  status                    Is it running, on which URL, and how big is the DB.
  logs [-f]                 Last 100 lines of logs/musicfy.log, or follow it.
  doctor                    Node, ffmpeg, yt-dlp, Python, database, port and disk.
  backup [--keep N]         Database snapshot plus settings/covers archive.
  restore <snapshot.db>     Replace the database; stop the service first.
  token [--rotate]          Create or rotate MUSICFY_TOKEN in musicfy.env.
  update                    git pull in a git install, then restart if running.
  service install|uninstall systemd (Linux) or launchd (macOS) unit.
  open                      Open the URL in the default browser.

Data root: ${rootDir}
Code root: ${APP}`);
}

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}

async function setup() {
  ensureDirs();
  const port = String(options.port || valueOf('port', readEnv().MUSICFY_PORT || '8710'));
  const bind = options.bind || valueOf('bind', readEnv().MUSICFY_BIND || '0.0.0.0');
  const ownedArg = options.owned || valueOf('owned', readEnv().MUSICFY_OWNED || path.join(rootDir, 'owned'));
  const owned = path.resolve(ownedArg);
  fs.mkdirSync(owned, { recursive: true });
  const current = readEnv();
  let token = current.MUSICFY_TOKEN || '';
  if (flags.has('--token') && !token) {
    token = crypto.randomBytes(32).toString('base64url');
    console.log('Created a shared token for this install.');
  }
  writeEnv({ MUSICFY_HOME: rootDir, MUSICFY_PORT: port, MUSICFY_BIND: bind, MUSICFY_OWNED: owned, ...(token ? { MUSICFY_TOKEN: token } : {}) });

  const nodeOk = Number(process.versions.node.split('.')[0]) > 22
    || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) >= 13);
  console.log(`Node       ${process.version}${nodeOk ? '' : '  (need 22.13+)'}`);
  for (const bin of ['ffmpeg', 'ffprobe', 'python3']) {
    const p = which(bin);
    console.log(`${bin.padEnd(10)} ${p || 'MISSING'}`);
  }

  if (!flags.has('--skip-deps')) {
    const py = which('python3');
    if (py) {
      const ytVenv = path.join(rootDir, 'ytdlp-venv');
      const anVenv = path.join(rootDir, 'essentia-venv');
      if (!fs.existsSync(path.join(ytVenv, 'bin', 'yt-dlp'))) {
        console.log('\nCreating the yt-dlp venv…');
        if (run(py, ['-m', 'venv', ytVenv])) {
          run(path.join(ytVenv, 'bin', 'pip'), ['install', '-q', '-U', 'pip', 'yt-dlp']);
        }
      }
      if (!fs.existsSync(path.join(anVenv, 'bin', 'python'))) {
        console.log('\nCreating the analyser venv (librosa; this can take a few minutes)…');
        if (run(py, ['-m', 'venv', anVenv])) {
          run(path.join(anVenv, 'bin', 'pip'), ['install', '-q', '-U', 'pip', 'librosa', 'numpy', 'scipy']);
        }
      }
    } else {
      console.log('\npython3 is missing: install it, then rerun setup (or pass --skip-deps).');
    }
  }

  const yt = process.env.MUSICFY_YTDLP || path.join(rootDir, 'ytdlp-venv', 'bin', 'yt-dlp');
  const an = process.env.MUSICFY_PYTHON || path.join(rootDir, 'essentia-venv', 'bin', 'python');
  console.log(`yt-dlp     ${fs.existsSync(yt) ? yt : (which('yt-dlp') || 'not installed yet')}`);
  console.log(`analyser   ${fs.existsSync(an) ? an : 'not installed yet'}`);
  console.log(`\nConfig     ${envFile}`);
  console.log(`Audio      ${owned}`);
  console.log(`Database   ${path.join(rootDir, 'data', 'musicfy.db')}`);
  printToken(`http://localhost:${port}`, token);
  console.log(`\nNext: musicfy start      (or: musicfy service install)`);
}

function serve() {
  ensureDirs();
  const env = runtimeEnv();
  const child = spawn(process.execPath, ['--no-warnings', CORE], { stdio: 'inherit', env });
  child.on('exit', (code, signal) => process.exit(code == null ? (signal ? 1 : 0) : code));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { child.kill(sig); } catch {} });
}

async function status() {
  const p = pid();
  if (!alive(p)) {
    if (p) { try { fs.rmSync(pidFile); } catch {} }
    console.log(`MUSICFY is not running  (${rootDir})`);
    return 1;
  }
  const env = runtimeEnv();
  const db = path.join(env.MUSICFY_DATA, 'musicfy.db');
  let size = '';
  try { size = ` · ${(fs.statSync(db).size / 1e6).toFixed(1)} MB db`; } catch {}
  console.log(`MUSICFY is running  pid ${p} · ${urlFor(env)}${size}`);
  try {
    const r = await health(env);
    if (r.ok) console.log('health    ok');
    else console.log(`health    ${r.status}`);
  } catch { console.log('health    no answer'); }
  return 0;
}

async function start() {
  ensureDirs();
  const p = pid();
  if (alive(p)) { console.log(`Already running (pid ${p}) · ${urlFor()}`); return 0; }
  if (p) { try { fs.rmSync(pidFile); } catch {} }
  const env = runtimeEnv();
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--no-warnings', CORE], {
    detached: true, stdio: ['ignore', out, out], env, cwd: rootDir,
  });
  fs.writeFileSync(pidFile, String(child.pid));
  child.unref();
  await wait(700);
  if (!alive(child.pid)) {
    console.error(`Failed to start; see ${logFile}`);
    return 1;
  }
  console.log(`Started  pid ${child.pid} · ${urlFor(env)}`);
  console.log(`Logs     ${logFile}`);
  return 0;
}

async function stop() {
  const p = pid();
  if (!alive(p)) {
    if (p) { try { fs.rmSync(pidFile); } catch {} }
    console.log('Not running.');
    return 0;
  }
  try { process.kill(p, 'SIGTERM'); } catch {}
  for (let i = 0; i < 50; i += 1) {
    if (!alive(p)) break;
    await wait(100);
  }
  if (alive(p)) { try { process.kill(p, 'SIGKILL'); } catch {} }
  try { fs.rmSync(pidFile); } catch {}
  console.log(`Stopped  pid ${p}`);
  return 0;
}

async function restart() {
  await stop();
  return start();
}

function logs() {
  if (flags.has('-f')) {
    const child = spawn('tail', ['-n', '100', '-f', logFile], { stdio: 'inherit' });
    child.on('exit', (c) => process.exit(c || 0));
    return;
  }
  let text = '';
  try { text = fs.readFileSync(logFile, 'utf8'); } catch { console.log(`No log yet: ${logFile}`); return; }
  console.log(text.split(/\r?\n/).slice(-100).join('\n'));
}

async function doctor() {
  let bad = 0;
  const say = (ok, label, detail = '') => {
    if (!ok) bad += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  };
  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  say(major > 22 || (major === 22 && minor >= 13), 'node', process.version);
  for (const bin of ['ffmpeg', 'ffprobe']) say(!!which(bin), bin, which(bin));
  const env = runtimeEnv();
  const ytPath = env.MUSICFY_YTDLP || '';
  const ytFound = (ytPath && fs.existsSync(ytPath)) ? ytPath : which('yt-dlp');
  say(!!ytFound, 'yt-dlp', ytFound || `${ytPath || 'not found'} or PATH`);
  const anPath = env.MUSICFY_PYTHON || path.join(rootDir, 'essentia-venv', 'bin', 'python');
  say(fs.existsSync(anPath), 'analyser python', anPath);
  try {
    const db = path.join(env.MUSICFY_DATA, 'musicfy.db');
    if (fs.existsSync(db)) {
      const { DatabaseSync } = await import('node:sqlite');
      const d = new DatabaseSync(db, { readOnly: true });
      const verdict = Object.values(d.prepare('PRAGMA integrity_check').get() || {})[0];
      const tracks = d.prepare('SELECT COUNT(*) c FROM tracks').get().c;
      d.close();
      say(verdict === 'ok', 'database', `${tracks} tracks · integrity ${verdict}`);
    } else say(false, 'database', `not created yet (${db})`);
    const free = fs.statfsSync(env.MUSICFY_DATA || rootDir);
    const gb = (free.bavail * free.bsize) / 1e9;
    say(gb > 0.2, 'disk', `${gb.toFixed(1)} GB free`);
  } catch (e) { say(false, 'database', e.message); }
  try {
    const r = await health(env);
    say(r.ok, 'http', `${urlFor(env)} ${r.status}`);
  } catch { say(false, 'http', `${urlFor(env)} no answer`); }
  if ((env.MUSICFY_BIND === '0.0.0.0' || env.MUSICFY_BIND === '::') && !env.MUSICFY_TOKEN) {
    console.log('warn  no MUSICFY_TOKEN while listening on every interface');
  }
  console.log(`\n${bad ? `${bad} problem${bad === 1 ? '' : 's'}` : 'No problems found.'}`);
  return bad ? 1 : 0;
}

function backup() {
  ensureDirs();
  const env = runtimeEnv();
  const keep = String(options.keep || valueOf('keep', env.MUSICFY_BACKUP_KEEP || '7'));
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(APP, 'core', 'backup-db.js')], {
    env: { ...env, MUSICFY_BACKUP_KEEP: keep }, encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`Database backup failed: ${String(r.stderr || '').trim() || 'unknown error'}`);
    return 1;
  }
  let info = {};
  try { info = JSON.parse(String(r.stdout || '{}').split(/\r?\n/).filter(Boolean).pop() || '{}'); } catch {}
  console.log(info.snapshot ? `Database  ${info.snapshot} (${(info.bytes / 1e6).toFixed(1)} MB)` : `Database  ${info.skipped || 'nothing to snapshot'}`);

  const files = [];
  for (const rel of ['settings.json', 'llm.json', 'covers']) {
    const p = path.join(env.MUSICFY_DATA, rel);
    if (fs.existsSync(p)) files.push(p);
  }
  if (files.length) {
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(env.MUSICFY_BACKUP_DIR, `musicfy-files-${stamp}.tar.gz`);
    const tar = spawnSync('tar', ['-czf', dest, '-C', env.MUSICFY_DATA, ...files.map((p) => path.relative(env.MUSICFY_DATA, p))], { encoding: 'utf8' });
    if (tar.status === 0) console.log(`Files     ${dest}`);
    else console.log(`Files     could not archive: ${String(tar.stderr || '').trim()}`);
  }
  return 0;
}

async function restore() {
  const source = positionals[1];
  if (!source || source.startsWith('--')) { console.error('Usage: musicfy restore <snapshot.db>'); return 1; }
  if (alive(pid())) { console.error('Stop MUSICFY first: musicfy stop'); return 1; }
  if (!fs.existsSync(source)) { console.error(`No such snapshot: ${source}`); return 1; }
  const env = runtimeEnv();
  const db = path.join(env.MUSICFY_DATA, 'musicfy.db');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  const current = `${db}.before-restore-${Date.now()}`;
  if (fs.existsSync(db)) fs.copyFileSync(db, current);
  const stamp = path.join(env.MUSICFY_BACKUP_DIR, `musicfy-before-restore-${new Date().toISOString().slice(0, 10)}.db`);
  fs.mkdirSync(env.MUSICFY_BACKUP_DIR, { recursive: true });
  fs.copyFileSync(source, stamp);
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const check = new DatabaseSync(stamp, { readOnly: true });
    const verdict = Object.values(check.prepare('PRAGMA integrity_check').get() || {})[0];
    check.close();
    if (verdict !== 'ok') throw new Error(`snapshot failed integrity_check: ${verdict}`);
  } catch (e) {
    console.error(`Refusing to restore: ${e.message}`);
    return 1;
  }
  fs.copyFileSync(stamp, db);
  console.log(`Restored  ${source}`);
  console.log(`Previous  ${current}`);
  console.log('Start with: musicfy start');
  return 0;
}

function token() {
  const current = readEnv();
  if (flags.has('--rotate')) {
    const next = crypto.randomBytes(32).toString('base64url');
    writeEnv({ MUSICFY_TOKEN: next });
    console.log('Rotated MUSICFY_TOKEN in musicfy.env. Restart the service.');
    printToken(`http://localhost:${current.MUSICFY_PORT || 8710}`, next);
    return 0;
  }
  if (!current.MUSICFY_TOKEN) {
    console.log('No token. Create one with: musicfy token --rotate');
    return 0;
  }
  console.log('MUSICFY_TOKEN is set in musicfy.env (run --rotate to replace it).');
  return 0;
}

function update() {
  if (fs.existsSync(path.join(APP, '.git'))) {
    if (!run('git', ['-C', APP, 'pull', '--ff-only'])) return 1;
  } else {
    console.log('This is not a git checkout. Update with your package manager, then run: musicfy restart');
    return 0;
  }
  if (alive(pid())) return restart();
  console.log('Updated. Start with: musicfy start');
  return 0;
}

function service() {
  const action = positionals[1] || 'install';
  if (process.platform === 'darwin') return launchd(action);
  return systemd(action);
}

function systemd(action) {
  const unitPath = '/etc/systemd/system/musicfy.service';
  if (action === 'uninstall') {
    if (fs.existsSync(unitPath) && process.getuid?.() === 0) run('systemctl', ['disable', '--now', 'musicfy']);
    console.log(`Remove ${unitPath} and run: sudo systemctl daemon-reload`);
    return 0;
  }
  if (action !== 'install') { console.error('Usage: musicfy service install|uninstall'); return 1; }
  const local = path.join(rootDir, 'musicfy.service');
  const body = `[Unit]
Description=MUSICFY
After=network-online.target

[Service]
WorkingDirectory=${APP}
EnvironmentFile=${envFile}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=${process.execPath} --no-warnings ${CORE}
Restart=always
RestartSec=3
User=${process.env.USER || os.userInfo().username}

[Install]
WantedBy=multi-user.target
`;
  fs.writeFileSync(local, body);
  if (process.getuid?.() === 0) {
    fs.writeFileSync(unitPath, body);
    run('systemctl', ['daemon-reload']);
    run('systemctl', ['enable', '--now', 'musicfy']);
    console.log('Installed and started musicfy.service');
    return 0;
  }
  console.log(`Wrote ${local}. Install it with:\n\n  sudo cp ${local} ${unitPath}\n  sudo systemctl daemon-reload\n  sudo systemctl enable --now musicfy\n`);
  return 0;
}

function launchd(action) {
  const label = 'com.musicfy.core';
  const dest = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  if (action === 'uninstall') {
    if (fs.existsSync(dest)) {
      spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, dest], { stdio: 'inherit' });
      try { fs.rmSync(dest); } catch {}
    }
    console.log('Removed the launchd job.');
    return 0;
  }
  if (action !== 'install') { console.error('Usage: musicfy service install|uninstall'); return 1; }
  const env = runtimeEnv();
  const vars = Object.entries({ PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', ...env }).filter(([k]) => k.startsWith('MUSICFY_') || k === 'PATH')
    .map(([k, v]) => `    <key>${k}</key><string>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>--no-warnings</string><string>${CORE}</string></array>
  <key>WorkingDirectory</key><string>${APP}</string>
  <key>EnvironmentVariables</key><dict>
${vars}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logFile}</string>
  <key>StandardErrorPath</key><string>${logFile}</string>
</dict></plist>
`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body, { mode: 0o600 });
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, dest], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, dest], { encoding: 'utf8' });
  if (r.status !== 0) console.log(`Wrote ${dest}; load it with: launchctl bootstrap gui/${process.getuid()} ${dest}`);
  else console.log(`Installed and started ${label}`);
  return 0;
}

function open() {
  const url = urlFor();
  console.log(url);
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch {}
  return 0;
}

try {
  let code = 0;
  switch (command) {
    case 'setup': await setup(); break;
    case 'serve': serve(); break;
    case 'start': code = await start(); break;
    case 'stop': code = await stop(); break;
    case 'restart': code = await restart(); break;
    case 'status': code = await status(); break;
    case 'logs': logs(); break;
    case 'doctor': code = await doctor(); break;
    case 'backup': code = backup(); break;
    case 'restore': code = await restore(); break;
    case 'token': code = token(); break;
    case 'update': code = update(); break;
    case 'service': code = service(); break;
    case 'open': code = open(); break;
    case 'version': case '--version': console.log(version()); break;
    case 'help': case '--help': case '-h': help(); break;
    default:
      console.error(`Unknown command: ${command}\n`);
      help();
      code = 1;
  }
  process.exitCode = code;
} catch (e) {
  console.error(`musicfy: ${e.message || e}`);
  process.exitCode = 1;
}
