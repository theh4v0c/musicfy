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
const https = require('node:https');
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
const CONFIG = path.join(HOME, 'desktop.json');
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
let switching = false;
let blocker = 0;

const say = (pt, en) => (PT ? pt : en);

function config() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}
function saveConfig(patch) {
  const next = { ...config(), ...patch };
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2), { mode: 0o600 });
}
function privateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /\.local$/.test(h)
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^fc|^fd/.test(h);
}

function remoteUrl() {
  const u = String(config().remoteUrl || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(u) ? u : '';
}
// the port a MUSICFY server listens on; this app's own engine takes 8790 and up
const SERVER_PORT = 8710;

function probe(url, ms = 4000) {
  return new Promise((resolve) => {
    let mod = http;
    try { mod = new URL(url).protocol === 'https:' ? https : http; } catch { return resolve(false); }
    const req = mod.get(`${url}/health`, { timeout: ms }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
async function waitRemote(url, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await probe(url, 3000)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

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

async function stopCore() {
  const dying = child;
  child = null;
  if (!dying) return;
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 2500);
    dying.once('exit', () => { clearTimeout(t); resolve(); });
    try { dying.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
  });
  try { dying.kill('SIGKILL'); } catch { /* gone */ }
}

async function openLocal() {
  port = await freePort();
  if (!port) throw new Error(say('Nenhuma porta livre entre 8790 e 8809.', 'No free port between 8790 and 8809.'));
  base = `http://127.0.0.1:${port}`;
  startCore();
  if (!(await waitHealthy())) throw new Error(say('O motor local não iniciou.', 'The local engine did not start.'));
}

/* Swap the window between this Mac and a remote library without relaunching: a relaunch
   raced the single-instance lock and the new process quit against the old one. */
async function switchMode(remote) {
  switching = true;
  const old = win;
  win = null;
  if (old) { try { old.destroy(); } catch { /* already gone */ } }
  if (child) await stopCore();
  try {
    if (remote) {
      base = remote;
      if (!(await waitRemote(base))) throw new Error(say('Não consegui alcançar essa biblioteca.', 'Could not reach that library.'));
      createWindow(false);
    } else {
      await openLocal();
      createWindow(true);
    }
    buildMenu();
  } catch (e) {
    // never leave the user without a window: fall back to the local library
    saveConfig({ remoteUrl: '' });
    try {
      await openLocal();
      createWindow(true);
      buildMenu();
    } catch { /* reported below */ }
    dialog.showErrorBox('MUSICFY', String(e.message || e));
  } finally {
    switching = false;
    if (!win) app.quit();
  }
}

function remoteFailed(url) {
  dialog.showMessageBox({
    type: 'error',
    message: say('Não consegui alcançar essa biblioteca.', 'Could not reach that library.'),
    detail: `${url}\n\n${say('O servidor está ligado e na mesma rede?', 'Is the server running and on the same network?')}`,
    buttons: [
      say('Tentar de novo', 'Try again'),
      say('Usar a biblioteca deste Mac', 'Use this Mac\'s library'),
      say('Abrir no navegador', 'Open in browser'),
      say('Sair', 'Quit'),
    ],
    defaultId: 0,
    cancelId: 3,
  }).then(({ response }) => {
    if (response === 0) boot();
    else if (response === 1) { saveConfig({ remoteUrl: '' }); setTimeout(() => { switchMode('').catch(() => {}); }, 150); }
    else if (response === 2) shell.openExternal(url);
    else app.quit();
  }).catch(() => app.quit());
}

function createWindow(withBridge = true) {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'MUSICFY',
    backgroundColor: '#0b0b0d',
    webPreferences: {
      ...(withBridge ? { preload: path.join(__dirname, 'preload.js') } : {}),
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
    // startsWith() let https://music.example.com.evil.com pass as the library
    let origin = '';
    try { origin = new URL(url).origin; } catch { origin = ''; }
    let baseOrigin = '';
    try { baseOrigin = new URL(base).origin; } catch { baseOrigin = base; }
    if (origin !== baseOrigin) { event.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
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
        ...(remoteUrl()
          ? [
            { label: say('Usar a biblioteca deste Mac', 'Use this Mac\'s library'), click: () => { saveConfig({ remoteUrl: '' }); setTimeout(() => { switchMode('').catch(() => {}); }, 150); } },
            { label: say('Abrir esta biblioteca no navegador', 'Open this library in a browser'), click: () => shell.openExternal(remoteUrl()) },
            { type: 'separator' },
          ]
          : [
            {
              label: say('Conectar a uma biblioteca…', 'Connect to a library…'),
              click: () => {
                if (!win) return;
                win.webContents.executeJavaScript("nav('settings'); setTimeout(() => document.getElementById('set-app')?.scrollIntoView({ block: 'center' }), 700)").catch(() => {});
              },
            },
            { type: 'separator' },
          ]),
        ...(remoteUrl() ? [] : [
        { label: say('Adicionar pasta de músicas…', 'Add music folder…'), accelerator: 'CmdOrCtrl+O', click: addMusicFolder },
        { label: say('Abrir pasta de músicas', 'Open music folder'), click: openMusic },
        { label: say('Abrir pasta de dados', 'Open data folder'), click: openData },
        { type: 'separator' },
        { label: say('Reiniciar o motor', 'Restart engine'), click: restartEngine },
        ]),
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
  const remote = remoteUrl();
  if (remote) {
    base = remote;
    if (!(await waitRemote(base))) return remoteFailed(base);
    createWindow(false);
    buildMenu();
    app.setAboutPanelOptions({
      applicationName: 'MUSICFY',
      applicationVersion: VERSION,
      version: VERSION,
      copyright: 'AGPL-3.0-or-later',
      credits: base,
    });
    return;
  }
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

ipcMain.handle('musicfy:info', () => ({ home: HOME, music: MUSIC, version: VERSION }));

ipcMain.handle('musicfy:mode', () => ({ remote: remoteUrl() }));

ipcMain.handle('musicfy:connect', async (_e, url) => {
  const target = String(url || '').trim().replace(/\/+$/, '');
  let parsed = null;
  try { parsed = new URL(target); } catch { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    return { ok: false, error: say('O endereço precisa começar com http:// ou https://', 'The address must start with http:// or https://') };
  }
  if (parsed.protocol === 'http:' && !privateHost(parsed.hostname)) {
    return { ok: false, error: say('Fora da sua rede, use https://: http envia a senha em claro.', 'Outside your network use https://; http sends the password in the clear.') };
  }
  if (!(await probe(target, 5000))) {
    // The port is the usual mistake: this app runs its own engine on 8790, while a MUSICFY
    // server answers on 8710. Ask the same host on 8710 before giving up, and say the
    // address instead of "unreachable".
    const shownPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (parsed.port !== String(SERVER_PORT)) {
      const alt = new URL(parsed.toString());
      alt.port = String(SERVER_PORT);
      const guess = alt.toString().replace(/\/+$/, '');
      if (guess !== target && (await probe(guess, 4000))) {
        return { ok: false, suggest: guess, error: say(
          `Nada respondeu na porta ${shownPort} de ${parsed.hostname}. O MUSICFY daquele computador responde na porta ${SERVER_PORT} — use ${guess}`,
          `Nothing answered on ${parsed.hostname}:${shownPort}. MUSICFY on that machine answers on port ${SERVER_PORT} — use ${guess}`) };
      }
    }
    return { ok: false, error: say('Não consegui alcançar esse endereço. O MUSICFY está rodando naquele computador?', 'Could not reach that address. Is MUSICFY running on that computer?') };
  }
  saveConfig({ remoteUrl: target });
  setTimeout(() => { switchMode(target).catch(() => {}); }, 150);
  return { ok: true };
});

ipcMain.handle('musicfy:disconnect', () => {
  saveConfig({ remoteUrl: '' });
  setTimeout(() => { switchMode('').catch(() => {}); }, 150);
  return { ok: true };
});

ipcMain.on('musicfy:playing', (_e, playing) => {
  if (playing && !blocker) blocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (!playing && blocker) { try { powerSaveBlocker.stop(blocker); } catch { /* already stopped */ } blocker = 0; }
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('activate', () => { if (!win && base) createWindow(!remoteUrl()); });

app.on('window-all-closed', () => { if (!switching) app.quit(); });

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
