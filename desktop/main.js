'use strict';
/* MUSICFY desktop shell.
 *
 * The window is a BrowserWindow. The engine is the same core/core.js the server runs,
 * spawned as a child Node process with a data root of its own, so a friend who has never
 * opened a terminal gets a working library: no service file, no Python, no PATH.
 *
 * What lives where:
 *   ~/Library/Application Support/MUSICFY   database, covers, logs, the yt-dlp wrapper
 *   ~/Music/MUSICFY                         downloads and anything the app writes
 *   <their own folders>                     scanned in place, never copied
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, Notification, powerSaveBlocker } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');

const APP_ROOT = path.resolve(__dirname, '..');
const CORE = path.join(APP_ROOT, 'core', 'core.js');
const HOME = path.join(app.getPath('appData'), 'MUSICFY');
const DATA = path.join(HOME, 'data');
const MUSIC = path.join(os.homedir(), 'Music', 'MUSICFY');
const LOGS = path.join(HOME, 'logs');
const LOG = path.join(LOGS, 'desktop.log');
const BIN = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(APP_ROOT, 'desktop', 'vendor', 'bin');
const PT = String(app.getLocale() || '').toLowerCase().startsWith('pt');
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
})();

app.setName('MUSICFY');
app.setPath('userData', path.join(HOME, 'electron'));
if (!app.isPackaged && process.env.MUSICFY_DEVTOOLS_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.MUSICFY_DEVTOOLS_PORT));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  boot();
}

let win = null;
let child = null;
let port = 0;
let base = '';
let quitting = false;
let stopping = false;
let blocker = 0;

const say = (pt, en) => (PT ? pt : en);

function ensureDirs() {
  for (const dir of [HOME, DATA, MUSIC, LOGS, path.join(HOME, 'backups'), path.join(HOME, 'bin')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function rotateLog() {
  try { if (fs.statSync(LOG).size > 3 * 1024 * 1024) fs.renameSync(LOG, `${LOG}.1`); } catch { /* first run */ }
}

function tailLog(lines = 20) {
  try { return fs.readFileSync(LOG, 'utf8').trim().split(/\r?\n/).slice(-lines).join('\n'); }
  catch { return ''; }
}

/* yt-dlp needs a JavaScript runtime for YouTube signatures. The Electron binary is one,
 * behind ELECTRON_RUN_AS_NODE, so the app ships no second runtime just for this. */
function ytdlpWrapper() {
  const real = path.join(BIN, 'yt-dlp');
  if (!fs.existsSync(real)) return null;
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const shim = path.join(HOME, 'bin', 'node');
  const wrapper = path.join(HOME, 'bin', 'yt-dlp');
  try {
    fs.writeFileSync(shim, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${q(process.execPath)} "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${q(real)} --js-runtimes node:${q(shim)} --remote-components ejs:github "$@"\n`, { mode: 0o755 });
    return wrapper;
  } catch { return null; }
}

function coreEnv() {
  const env = {
    ...process.env,
    MUSICFY_HOME: HOME,
    MUSICFY_DATA: DATA,
    MUSICFY_OWNED: MUSIC,
    MUSICFY_BACKUP_DIR: path.join(HOME, 'backups'),
    MUSICFY_BIND: '127.0.0.1',
    MUSICFY_PORT: String(port),
    MUSICFY_MUSIC_ROOTS: [path.join(os.homedir(), 'Music'), MUSIC].join(path.delimiter),
    MUSICFY_DOWNLOAD_CONCURRENCY: process.env.MUSICFY_DOWNLOAD_CONCURRENCY || '4',
    PATH: [BIN, process.env.PATH || ''].join(path.delimiter),
    ELECTRON_RUN_AS_NODE: '1',
  };
  for (const [key, file] of [['MUSICFY_FFMPEG', 'ffmpeg'], ['MUSICFY_FFPROBE', 'ffprobe']]) {
    const full = path.join(BIN, file);
    if (fs.existsSync(full)) env[key] = full;
  }
  const yt = ytdlpWrapper();
  if (yt) env.MUSICFY_YTDLP = yt;
  return env;
}

function freePort(start = 8790) {
  const tryOne = (p) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(p, '127.0.0.1');
  });
  return (async () => {
    for (let p = start; p < start + 20; p += 1) if (await tryOne(p)) return p;
    return 0;
  })();
}

function api(method, pathname, body, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method, timeout,
      headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
    }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(text); } catch { data = text; }
        if (res.statusCode >= 400) reject(new Error((data && data.error) || `HTTP ${res.statusCode}`));
        else resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function startCore() {
  rotateLog();
  const out = fs.openSync(LOG, 'a');
  child = spawn(process.execPath, ['--no-warnings', CORE], {
    env: coreEnv(), stdio: ['ignore', out, out], cwd: HOME,
  });
  fs.closeSync(out);
  child.on('exit', (code) => {
    child = null;
    if (quitting) return;
    engineDown(code);
  });
}

function engineDown(code) {
  const buttons = [say('Reiniciar', 'Restart'), say('Sair', 'Quit'), say('Mostrar log', 'Show log')];
  dialog.showMessageBox({
    type: 'error',
    message: say('O MUSICFY parou.', 'MUSICFY stopped.'),
    detail: `${say('Código', 'Exit code')} ${code == null ? '?' : code}\n\n${tailLog(12) || say('Sem log.', 'No log yet.')}`,
    buttons,
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) {
      startCore();
      if (win) win.webContents.reload();
    } else if (response === 2) {
      shell.openPath(LOG);
    } else {
      app.quit();
    }
  }).catch(() => app.quit());
}

function waitHealthy(ms = 30000) {
  const until = Date.now() + ms;
  return (async () => {
    while (Date.now() < until) {
      if (!child) return false;
      try { await api('GET', '/health', undefined, 1500); return true; } catch { /* keep waiting */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  })();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'MUSICFY',
    backgroundColor: '#0b0b0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(base)) { event.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.on('closed', () => { win = null; });
  win.loadURL(base);
}

async function scanFolder(folder) {
  await api('POST', '/api/library/scan', { path: folder });
  notify(say('Lendo a pasta', 'Reading the folder'), folder);
  const until = Date.now() + 40 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    let st = null;
    try { st = await api('GET', '/api/library/scan'); } catch { continue; }
    if (st && st.running) continue;
    const bits = [];
    if (st && st.added) bits.push(`${st.added} ${say('novas', 'new')}`);
    if (st && st.linked) bits.push(`${st.linked} ${say('já na biblioteca', 'already here')}`);
    if (st && st.playlists) bits.push(`${st.playlists} ${say('listas', 'playlists')}`);
    notify(
      say('Pasta adicionada', 'Folder added'),
      st && st.error ? st.error : (bits.join(' · ') || say('nada novo', 'nothing new')),
    );
    if (win) win.webContents.reload();
    return;
  }
}

function notify(title, body) {
  try { new Notification({ title, body: String(body).slice(0, 200) }).show(); } catch { /* notifications are optional */ }
}

async function addMusicFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win || undefined, {
    title: say('Escolha uma pasta de músicas', 'Choose a music folder'),
    buttonLabel: say('Adicionar', 'Add'),
    properties: ['openDirectory', 'multiSelections'],
  });
  if (canceled || !filePaths.length) return;
  for (const folder of filePaths) await scanFolder(folder).catch((e) => notify('MUSICFY', e.message));
}

function buildMenu() {
  const openData = () => shell.openPath(HOME);
  const openMusic = () => { fs.mkdirSync(MUSIC, { recursive: true }); shell.openPath(MUSIC); };
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: 'MUSICFY',
      submenu: [
        { role: 'about', label: say('Sobre o MUSICFY', 'About MUSICFY') },
        { type: 'separator' },
        { role: 'hide', label: say('Ocultar', 'Hide MUSICFY') },
        { role: 'hideOthers', label: say('Ocultar outros', 'Hide Others') },
        { role: 'unhide', label: say('Mostrar tudo', 'Show All') },
        { type: 'separator' },
        { role: 'quit', label: say('Sair do MUSICFY', 'Quit MUSICFY') },
      ],
    }] : []),
    {
      label: say('Arquivo', 'File'),
      submenu: [
        { label: say('Adicionar pasta de músicas…', 'Add music folder…'), accelerator: 'CmdOrCtrl+O', click: addMusicFolder },
        { label: say('Abrir pasta de músicas', 'Open music folder'), click: openMusic },
        { label: say('Abrir pasta de dados', 'Open data folder'), click: openData },
        { type: 'separator' },
        { label: say('Reiniciar o motor', 'Restart engine'), click: restartEngine },
        ...(process.platform === 'darwin' ? [] : [{ role: 'quit' }]),
      ],
    },
    { role: 'editMenu', label: say('Editar', 'Edit') },
    {
      label: say('Visualizar', 'View'),
      submenu: [
        { role: 'reload', label: say('Recarregar', 'Reload') },
        { role: 'togglefullscreen', label: say('Tela cheia', 'Toggle Full Screen') },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu', label: say('Janela', 'Window') },
    {
      role: 'help',
      label: say('Ajuda', 'Help'),
      submenu: [
        { label: say('Site do projeto', 'Project page'), click: () => shell.openExternal('https://github.com/theh4v0c/musicfy') },
        { label: say('Mostrar log', 'Show log'), click: () => shell.openPath(LOG) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function restartEngine() {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((r) => { const t = setTimeout(r, 3000); child && child.once('exit', () => { clearTimeout(t); r(); }); });
  if (child) { try { child.kill('SIGKILL'); } catch { /* already gone */ } child = null; }
  startCore();
  if (win) win.webContents.reload();
}

async function boot() {
  ensureDirs();
  port = await freePort();
  if (!port) {
    dialog.showErrorBox('MUSICFY', say('Nenhuma porta livre entre 8790 e 8809.', 'No free port between 8790 and 8809.'));
    app.quit();
    return;
  }
  base = `http://127.0.0.1:${port}`;
  startCore();
  const up = await waitHealthy();
  if (!up) {
    dialog.showMessageBox({
      type: 'error',
      message: say('O MUSICFY não iniciou.', 'MUSICFY did not start.'),
      detail: tailLog(20) || say('Sem log.', 'No log yet.'),
      buttons: [say('Tentar de novo', 'Try again'), say('Sair', 'Quit'), say('Mostrar log', 'Show log')],
      defaultId: 0, cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) boot();
      else if (response === 2) shell.openPath(LOG);
      else app.quit();
    });
    return;
  }
  createWindow();
  buildMenu();

  app.setAboutPanelOptions({
    applicationName: 'MUSICFY',
    applicationVersion: VERSION,
    version: VERSION,
    copyright: 'AGPL-3.0-or-later',
    credits: 'github.com/theh4v0c/musicfy',
  });
}

ipcMain.handle('musicfy:pick-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win || undefined, {
    title: say('Escolha uma pasta de músicas', 'Choose a music folder'),
    buttonLabel: say('Escolher', 'Choose'),
    properties: ['openDirectory'],
  });
  return canceled || !filePaths.length ? null : filePaths[0];
});

ipcMain.handle('musicfy:reveal', (_e, which) => shell.openPath(which === 'music' ? MUSIC : HOME));

ipcMain.on('musicfy:playing', (_e, playing) => {
  if (playing && !blocker) blocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (!playing && blocker) { try { powerSaveBlocker.stop(blocker); } catch { /* already stopped */ } blocker = 0; }
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('activate', () => { if (!win && base) createWindow(); });

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  quitting = true;
  if (stopping || !child) return;
  event.preventDefault();
  stopping = true;
  const dying = child;
  const timer = setTimeout(() => { try { dying.kill('SIGKILL'); } catch { /* gone */ } app.quit(); }, 2500);
  dying.once('exit', () => { clearTimeout(timer); app.quit(); });
  try { dying.kill('SIGTERM'); } catch { app.quit(); }
});
