'use strict';
/* Read an existing music folder, and the playlists already in it.
 *
 * Nothing here copies, moves or writes a file. It answers two questions for the
 * importer in core.js:
 *   walk(root)          which audio files and playlist files are there
 *   readPlaylist(file)  which playlists that file describes, and in what order
 *
 * Supported playlist files: Traktor NML, rekordbox XML, M3U/M3U8, PLS.
 * Pure functions only: no database, no network, no probing.
 */
const fs = require('node:fs');
const path = require('node:path');

const AUDIO = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aif', '.aiff']);
const SKIP_DIR = /^(?:\.|#recycle|@eaDir|lost\+found|node_modules|System Volume Information)$/i;

/* ---------- small helpers ---------- */

function decode(s) {
  try { return decodeURIComponent(String(s || '')); } catch { return String(s || ''); }
}

function entity(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attrMap(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g)) out[m[1].toUpperCase()] = entity(m[2]);
  for (const m of String(text || '').matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*'([^']*)'/g)) if (!(m[1].toUpperCase() in out)) out[m[1].toUpperCase()] = entity(m[2]);
  return out;
}

/* XML tags, without a dependency. Good enough for the three formats above: no CDATA,
   no namespaces in the parts we read, and every value we need is an attribute. */
function tokens(xml) {
  const out = [];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    out.push({ close: m[1] === '/', name: m[2].toUpperCase(), attrs: m[3] ? attrMap(m[3]) : {}, self: m[4] === '/' });
  }
  return out;
}

/* Playlist references are URIs or Traktor's colon paths. Both become a local path. */
function uriToPath(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (/^file:\/\//i.test(s)) {
    let p = s.replace(/^file:\/\/(?:localhost)?/i, '');
    p = decode(p);
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);          // file:///C:/... on Windows
    return path.normalize(p);
  }
  if (path.isAbsolute(s)) return path.normalize(decode(s));
  return null;
}

/* Traktor stores DIR="/:Users/:me/:Music/:" (a colon before every segment) and a
   URL-encoded FILE name. */
function traktorPath(dir, file) {
  let d = String(dir || '');
  if (!d) return null;
  d = d.replace(/\/:/g, '/');
  if (d.startsWith('/:')) d = d.slice(1);
  const name = decode(String(file || ''));
  if (/^[A-Za-z]:\//.test(d)) return path.win32.normalize(d + name);
  if (!d.startsWith('/')) return null;
  return path.normalize(path.posix.join(d, name));
}

function realish(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

/* A key written into a file (TKEY) or a Traktor collection (MUSICAL_KEY) is either
   Camelot ("8A") or a name ("Am", "F#"). Turn both into the two columns the app uses,
   with the wheel harmonic.js already owns: one definition, one meaning. */
const harmonic = require('./harmonic');

const fromWheel = (n, minor) => {
  const table = minor ? harmonic.MINOR_A : harmonic.MAJOR_B;
  const hit = Object.entries(table).find(([, value]) => value === n);
  return hit ? { key: hit[0], scale: minor ? 'minor' : 'major' } : null;
};

function keyParts(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const camel = raw.match(/^(\d{1,2})\s*([AB])$/i);
  if (camel) {
    const n = Number(camel[1]);
    if (n < 1 || n > 12) return null;
    return fromWheel(n, camel[2].toUpperCase() === 'A');
  }
  const named = raw.match(/^([A-G][#b]?)(?:\s*(m|min|minor|maj|major))?$/i);
  if (!named) return null;
  const scale = /^(m|min|minor)$/i.test(named[2] || '') ? 'minor' : 'major';
  const wheel = harmonic.camelotOf(named[1], scale);
  return wheel ? fromWheel(wheel.n, scale === 'minor') : null;
}

const number = (v) => {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ---------- walk ---------- */

function walk(root, { maxDepth = 8, maxFiles = 20000 } = {}) {
  const audio = [];
  const playlists = [];
  let truncated = false;
  const visit = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (audio.length + playlists.length >= maxFiles) { truncated = true; return; }
      const p = path.join(dir, e.name);
      let isFile = e.isFile();
      if (!isFile && e.isSymbolicLink()) { try { isFile = fs.statSync(p).isFile(); } catch { isFile = false; } }
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIR.test(e.name)) visit(p, depth + 1);
        continue;
      }
      if (!isFile) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (AUDIO.has(ext)) audio.push(p);
      else if (ext === '.nml' || ext === '.m3u' || ext === '.m3u8' || ext === '.pls' || ext === '.xml') playlists.push(p);
    }
  };
  visit(root, 0);
  audio.sort();
  playlists.sort();
  return { audio, playlists, truncated };
}

/* ---------- Traktor NML ---------- */

function parseTraktorNml(xml, sourceName) {
  const files = new Map();
  const playlists = [];
  let inCollection = false;
  const stack = [];

  const finishNode = (node) => {
    if (!node || node.type !== 'PLAYLIST' || !node.entries.length) return;
    playlists.push({ name: node.name || sourceName || 'Traktor playlist', entries: node.entries, kind: 'dj' });
  };

  for (const t of tokens(xml)) {
    if (t.close) {
      const i = stack.map((x) => x.name).lastIndexOf(t.name);
      if (i >= 0) {
        const [closed] = stack.splice(i, 1);
        if (t.name === 'NODE') finishNode(closed && closed.node);
        if (t.name === 'COLLECTION') inCollection = false;
      }
      continue;
    }
    if (t.name === 'COLLECTION') { inCollection = true; continue; }
    if (t.name === 'NODE') {
      const node = { type: t.attrs.TYPE, name: t.attrs.NAME, entries: [] };
      stack.push({ name: 'NODE', node });
      if (t.self) { stack.pop(); finishNode(node); }
      continue;
    }
    if (t.name === 'PRIMARYKEY' && t.attrs.TYPE === 'TRACK') {
      const frame = [...stack].reverse().find((x) => x.node);
      const p = uriToPath(t.attrs.KEY);
      if (frame && p) frame.node.entries.push(p);
    }
    if (inCollection && t.name === 'LOCATION') {
      const p = traktorPath(t.attrs.DIR, t.attrs.FILE);
      if (!p) continue;
      const entry = [...stack].reverse().find((x) => x.entry)?.entry;
      const meta = {
        title: entry && entry.TITLE ? entry.TITLE : path.basename(p).replace(/\.[^.]+$/, ''),
        artist: (entry && entry.ARTIST) || '',
        album: (entry && entry.ALBUM) || '',
        bpm: number(entry && entry.BPM),
        duration: number(entry && entry.PLAYTIME),
        key: null,
        scale: null,
      };
      const kp = keyParts(entry && (entry.MUSICAL_KEY || entry.KEY));
      if (kp) { meta.key = kp.key; meta.scale = kp.scale; }
      files.set(path.normalize(p), meta);
    }
    if (inCollection && t.name === 'ENTRY') {
      stack.push({ name: 'ENTRY', entry: t.attrs });
      if (t.self) stack.pop();
      continue;
    }
    if (!t.self) stack.push({ name: t.name });
    else if (t.name === 'ENTRY') stack.pop();
  }
  return { files, playlists, source: 'traktor' };
}

/* ---------- rekordbox XML ---------- */

function parseRekordboxXml(xml, sourceName) {
  const files = new Map();
  const byId = new Map();
  const playlists = [];
  const stack = [];
  for (const t of tokens(xml)) {
    if (t.close) {
      const i = stack.map((x) => x.name).lastIndexOf(t.name);
      if (i >= 0) {
        const [closed] = stack.splice(i, 1);
        if (t.name === 'NODE') {
          const node = closed && closed.node;
          if (node && node.type === 'PLAYLIST' && node.entries.length) {
            playlists.push({ name: node.name || sourceName || 'rekordbox playlist', entries: node.entries, kind: 'dj' });
          }
        }
      }
      continue;
    }
    if (t.name === 'TRACK') {
      const location = uriToPath(t.attrs.LOCATION);
      const trackId = t.attrs.TRACKID || t.attrs.ID;
      const node = [...stack].reverse().find((x) => x.node)?.node;
      if (node) {
        if (trackId) node.entries.push(trackId);
        else if (t.attrs.KEY) node.entries.push(t.attrs.KEY);
      }
      if (location) {
        const meta = {
          title: t.attrs.NAME || path.basename(location).replace(/\.[^.]+$/, ''),
          artist: t.attrs.ARTIST || '',
          album: t.attrs.ALBUM || '',
          bpm: number(t.attrs.AVERAGEBPM || t.attrs.BPM),
          duration: number(t.attrs.TOTALTIME),
          key: null,
          scale: null,
        };
        const kp = keyParts(t.attrs.TONALITY || t.attrs.KEY);
        if (kp) { meta.key = kp.key; meta.scale = kp.scale; }
        files.set(path.normalize(location), meta);
        if (trackId) byId.set(String(trackId), path.normalize(location));
      }
      if (!t.self) stack.push({ name: 'TRACK' });
      continue;
    }
    if (t.name === 'NODE') {
      const node = { type: t.attrs.TYPE === '1' || /playlist/i.test(t.attrs.TYPE || '') ? 'PLAYLIST' : 'FOLDER', name: t.attrs.NAME, entries: [] };
      stack.push({ name: 'NODE', node });
      continue;
    }
    if (!t.self) stack.push({ name: t.name });
  }
  for (const p of playlists) {
    p.entries = p.entries.map((k) => byId.get(String(k)) || uriToPath(k)).filter(Boolean);
  }
  return { files, playlists, source: 'rekordbox' };
}

/* ---------- M3U / PLS ---------- */

function parseM3u(text, file) {
  const baseDir = path.dirname(file);
  const entries = [];
  let lastLine = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) { lastLine = (line.match(/^#EXTINF:[^,]*,(.+)$/) || [])[1] || null; continue; }
    if (line.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) continue;         // a stream, not a file
    const p = path.isAbsolute(line) ? line : path.resolve(baseDir, line);
    entries.push(path.normalize(decode(p)));
    lastLine = null;
  }
  const name = path.basename(file).replace(/\.m3u8?$/i, '');
  return { files: new Map(), playlists: entries.length ? [{ name, entries, kind: 'listen' }] : [], source: 'm3u' };
}

function parsePls(text, file) {
  const baseDir = path.dirname(file);
  const entries = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*File\d*\s*=\s*(.+)$/i);
    if (!m) continue;
    const v = m[1].trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) continue;
    entries.push(path.normalize(path.isAbsolute(v) ? v : path.resolve(baseDir, decode(v))));
  }
  const name = path.basename(file).replace(/\.pls$/i, '');
  return { files: new Map(), playlists: entries.length ? [{ name, entries, kind: 'listen' }] : [], source: 'pls' };
}

/* One entry point: what does this file contain, if anything we understand. */
function readPlaylist(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  if (ext === '.nml') return parseTraktorNml(text, path.basename(file, ext));
  if (ext === '.m3u' || ext === '.m3u8') return parseM3u(text, file);
  if (ext === '.pls') return parsePls(text, file);
  if (ext === '.xml' && /<DJ_PLAYLISTS/i.test(text)) return parseRekordboxXml(text, base);
  return null;
}

module.exports = {
  AUDIO, keyParts,
  walk, readPlaylist, parseTraktorNml, parseRekordboxXml, parseM3u, parsePls,
  uriToPath, traktorPath, realish,
};
