#!/usr/bin/env node
// MUSICFY core, v1. Zero-dependency Node 22: node:http, node:sqlite, node:fs.
'use strict';
const http = require('node:http');
const zlib = require('node:zlib');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, timingSafeEqual, randomBytes, scryptSync } = require('node:crypto');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { normalize, scoreCandidate, titleForVersion, QUALITY_RANK, blockedByAddress, searchPlan,
  durationFits, durationCeiling, durationTooLong, artistInCandidate } = require('./ladder');
const ytdlp = require('./ytdlp');
const bandcamp = require('./bandcamp');
const mb = require('./mb');
const covers = require('./covers');
const soundcloud = require('./soundcloud');
const analyser = require('./analyze');
const queryEngine = require('./query');
const llm = require('./llm');
const release = require('./release');
const { fold, foldLower } = require('./text');
const storefront = require('./storefront');
const genre = require('./genre');
const repair = require('./repair');
const agent = require('./agent');
const recommend = require('./recommend');
const identity = require('./identity');
const albumOrder = require('./album-order');
const deezer = require('./deezer');
const archive = require('./archive');
const spotify = require('./spotify');
const exporter = require('./export');
const pioneer = require('./pioneer');
const exclude = require('./exclude');
const tagwrite = require('./tagwrite');
const transcode = require('./transcode');
const folderLib = require('./folder');
const { gitUpdate } = require('./git-update');
const { DatabaseSync } = require('node:sqlite');

// every path comes from ./paths, which reads what the installation set
const paths = require('./paths');
const ROOT = paths.ROOT;
// the audio library can live on another mount; never assume it is under ROOT
const OWNED = paths.OWNED;
const DB_PATH = paths.DB;
const PORT = paths.PORT;
const BIND = paths.BIND;
const SETTINGS_FILE = path.join(paths.DATA, 'settings.json');
const WNL = process.env.WNL_URL || '';
const WEB = path.join(__dirname, '..', 'web');
const APP_ROOT = path.join(__dirname, '..');
let APP_VERSION = '0.0.0';
try { APP_VERSION = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version || APP_VERSION; } catch {}
let updateCache = { at: 0, data: null };
function execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => execFile(cmd, args, opts, (err, stdout, stderr) => {
    if (!err) return resolve(String(stdout || ''));
    // the reason a git command failed is on stderr, and the message alone is just
    // "Command failed": carry the last lines so the interface can say what happened
    const detail = String(stderr || err.stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' ');
    if (detail && !String(err.message || '').includes(detail)) err.message = `${err.message}: ${detail}`;
    err.stderr = err.stderr || stderr;
    reject(err);
  }));
}
function diskVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version || APP_VERSION; } catch { return APP_VERSION; }
}

// One capability answer for both boxes. The agent used to send "what can you do" to the
// planner, which filed it as a search for the word "do".
function helpPayload(lang) {
  const pt = String(lang || '').toLowerCase().startsWith('pt');
  return {
    answer: pt
      ? 'Eu procuro na sua biblioteca e monto coisas a partir dela. Encontro faixas por tonalidade, tempo, ano, gênero, número de reproduções ou se o áudio está baixado; busco por título, artista ou álbum; crio uma lista com qualquer um desses filtros; informo a cobertura da biblioteca; e baixo um álbum ou o áudio que falta. Não navego na web nem respondo perguntas gerais.'
      : 'I search your library and build things from it. I can find tracks by key, tempo, year, genre, play count or whether the audio is downloaded; find by title, artist or album; create a playlist from any of those filters; report library coverage; and download a missing album or missing audio. I do not browse the web or answer general questions.',
    examples: pt
      ? ['faixas em Dm entre 120 e 130 bpm', 'techno que nunca toquei', 'criar uma lista com 20 faixas ambient', 'quanto da minha biblioteca tem áudio', 'baixar o álbum Random Access Memories']
      : ['tracks in Dm between 120 and 130 bpm', 'techno I never played', 'create a playlist of 20 ambient tracks', 'how much of my library has audio', 'download the album Random Access Memories'],
  };
}

async function updateInfo(check = false) {
  const onDisk = diskVersion();
  const out = {
    version: APP_VERSION, disk: onDisk, git: false, behind: 0, branch: '', error: null,
    restart: 'musicfy restart',
    // files replaced but the process still runs the old code: say it, do not compare
    // the running version with the release and claim there is nothing to do
    pending_restart: release.compare(onDisk, APP_VERSION) > 0,
  };
  try {
    out.git = execFileSync('git', ['-C', APP_ROOT, 'rev-parse', '--is-inside-work-tree'], { timeout: 5000 }).toString().trim() === 'true';
  } catch {}
  if (!out.git) {
    // a bundle install still has releases to compare against
    out.bundle = true;
    if (!check) return out;
    if (updateCache.data && Date.now() - updateCache.at < 5 * 60 * 1000) {
      // the release answer is cached, the disk state is not: a file update can happen
      // between two checks and the user must see that a restart is pending
      return { ...updateCache.data, version: APP_VERSION, disk: onDisk,
        pending_restart: release.compare(onDisk, APP_VERSION) > 0 };
    }
    try {
      const rel = await release.latest();
      out.latest = rel.version;
      out.behind = release.compare(rel.version, onDisk) > 0 ? 1 : 0;
      out.page = rel.page;
    } catch (e) {
      out.error = String(e.message || e).split('\n')[0].slice(0, 160);
    }
    out.at = Date.now();
    updateCache = { at: out.at, data: out };
    return out;
  }
  try {
    const head = execFileSync('git', ['-C', APP_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 }).toString().trim();
    // install.sh used to leave a shallow clone on a detached HEAD; compare with the remote
    // branch rather than the local upstream in that case
    out.branch = head === 'HEAD' ? 'main' : head;
    const svc = process.platform === 'linux' && (() => { try { execFileSync('systemctl', ['is-active', '--quiet', 'musicfy'], { timeout: 3000 }); return true; } catch { return false; } })();
    if (svc) out.restart = 'sudo systemctl restart musicfy';
  } catch {}
  if (!check) return out;
  if (updateCache.data && Date.now() - updateCache.at < 5 * 60 * 1000) return { ...updateCache.data, version: APP_VERSION };
  try {
    await execFileP('git', ['-C', APP_ROOT, 'fetch', '--quiet', '--depth', '1', 'origin', out.branch], { timeout: 15000 });
    const target = `origin/${out.branch}`;
    let n;
    try {
      n = Number((await execFileP('git', ['-C', APP_ROOT, 'rev-list', '--count', `HEAD..${target}`], { timeout: 5000 })).trim());
    } catch {
      n = Number((await execFileP('git', ['-C', APP_ROOT, 'rev-list', '--count', 'HEAD..FETCH_HEAD'], { timeout: 5000 })).trim());
    }
    out.behind = Number.isFinite(n) ? n : 0;
  } catch (e) {
    out.error = String(e.message || e).split('\n')[0].slice(0, 160);
  }
  out.at = Date.now();
  updateCache = { at: out.at, data: out };
  return out;
}

const COVER_DIR = path.join(paths.DATA, 'covers');
fs.mkdirSync(COVER_DIR, { recursive: true });
fs.mkdirSync(paths.DATA, { recursive: true });
fs.mkdirSync(paths.LOGS, { recursive: true });

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
// SQLite's lower()/LIKE are ASCII-only; this gives SQL the same folding the JS side uses
try { db.function('mf_fold', { deterministic: true }, (v) => foldLower(v)); } catch {}
// analysis, downloads and a maintenance script can write at once: wait for the lock
db.exec('PRAGMA busy_timeout=5000');
try { db.exec('PRAGMA journal_mode=WAL'); } catch {}
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
try { db.exec('ALTER TABLE jobs ADD COLUMN progress REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN updated_at INTEGER'); } catch {}
// repair: millisecond timestamps written into seconds columns (rendered as year 58853)
try { db.prepare('UPDATE tracks SET added_at=CAST(added_at/1000 AS INTEGER) WHERE added_at > 100000000000').run(); } catch {}
try { db.prepare('UPDATE tracks SET updated_at=CAST(updated_at/1000 AS INTEGER) WHERE updated_at > 100000000000').run(); } catch {}
// a restart should not kill a queue: park running jobs, then requeue their tracks
const interrupted = db.prepare("SELECT payload FROM jobs WHERE state IN ('running','queued')").all();
db.prepare("UPDATE jobs SET state='skipped', detail='interrupted by restart, requeued', finished_at=? WHERE state IN ('running','queued')").run(Math.floor(Date.now() / 1000));
db.prepare("UPDATE jobs SET state='skipped' WHERE state='error' AND detail IN ('requeued','already owned','retried')").run();
// a failure that a later copy superseded is history, not a standing alarm
try {
  for (const j of db.prepare("SELECT id,payload FROM jobs WHERE state IN ('unavailable','error') AND payload LIKE '%\"trackId\"%'").all()) {
    try {
      const tid = JSON.parse(j.payload || '{}').trackId;
      if (!tid) continue;
      if (db.prepare("SELECT 1 FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(tid))
        db.prepare("UPDATE jobs SET state='dismissed', detail='superseded: the track is owned now' WHERE id=?").run(j.id);
    } catch {}
  }
} catch {}
setTimeout(() => {
  const seen = new Set();
  for (const j of interrupted) {
    try {
      const p = JSON.parse(j.payload || '{}');
      if (!p.trackId || seen.has(p.trackId)) continue;
      seen.add(p.trackId);
      const t = db.prepare('SELECT id,title,artist,duration FROM tracks WHERE id=?').get(p.trackId);
      if (!t) continue;
      const owned = db.prepare("SELECT id FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(t.id);
      if (!owned) enqueueTrackDownload(t);
    } catch {}
  }
  if (seen.size) console.log('[downloads] requeued', seen.size, 'interrupted job(s)');
}, 5000);

// one row per artist + title: album differences must not create twins
try { db.exec('ALTER TABLE tracks ADD COLUMN dup_key TEXT'); } catch {}
function dupKeyOf(artist, title) {
  const norm = (s) => foldLower(s)
    .replace(/\((?:feat\.?|ft\.?|with)[^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+-\s+(?:remaster(?:ed)?|remastered \d+|single version|album version|radio edit)\b.*$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${norm(artist)}|${norm(title)}`;
}
function backfillDupKeys() {
  const rows = db.prepare('SELECT id, title, artist, dup_key FROM tracks').all();
  const upd = db.prepare('UPDATE tracks SET dup_key=? WHERE id=?');
  for (const r of rows) {
    const k = dupKeyOf(r.artist, r.title);
    if (r.dup_key === k) continue;
    try {
      upd.run(k, r.id);
    } catch (e) {
      // another row already owns this identity: keep this one addressable instead of crashing
      try { upd.run(`${k}#${r.id}`, r.id); } catch {}
      console.error('[dupkey] collision for', r.id, k.slice(0, 60));
    }
  }
  // merge rows that now share a key, keeping the one with playlists and files
  const groups = db.prepare(`SELECT dup_key k, COUNT(*) c FROM tracks WHERE dup_key IS NOT NULL GROUP BY dup_key HAVING c > 1`).all();
  for (const g of groups) {
    const rows2 = db.prepare(`SELECT t.id, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.track_id=t.id) np,
      (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id) nf
      FROM tracks t WHERE t.dup_key=? ORDER BY np DESC, nf DESC, t.id ASC`).all(g.k);
    const keep = rows2[0];
    if (!keep) continue;
    for (const dupe of rows2.slice(1)) {
      db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
      db.prepare('DELETE FROM playlist_tracks WHERE track_id=?').run(dupe.id);
      db.prepare('UPDATE OR IGNORE files SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
      db.prepare('DELETE FROM files WHERE track_id=?').run(dupe.id);
      db.prepare('UPDATE OR IGNORE likes SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
      db.prepare('DELETE FROM likes WHERE track_id=?').run(dupe.id);
      db.prepare('UPDATE listens SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
      db.prepare('UPDATE OR IGNORE resolutions SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
      db.prepare('DELETE FROM resolutions WHERE track_id=?').run(dupe.id);
      db.prepare('DELETE FROM tracks WHERE id=?').run(dupe.id);
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_tracks_dup ON tracks(dup_key)');
}
backfillDupKeys();

// columns for playlist entries that stream from a source instead of a local file
for (const col of ['src_kind TEXT', 'src_id TEXT', 'src_url TEXT', 'isrc TEXT', 'beat_grid TEXT', 'track_no INTEGER', 'disc_no INTEGER']) {
  try { db.exec(`ALTER TABLE tracks ADD COLUMN ${col}`); } catch {}
}

const now = () => Math.floor(Date.now() / 1000);

// the Camelot wheel lives in core/harmonic.js: one definition, unit-tested
const { camelotOf, harmonicScore, harmonicOrder } = require('./harmonic');

function weatherWord(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return 'clear';
  if (c === 0) return 'clear';
  if (c <= 3) return 'cloudy';
  if (c <= 48) return 'foggy';
  if (c <= 67) return 'rainy';
  if (c <= 77) return 'snowy';
  if (c <= 82) return 'showery';
  if (c <= 86) return 'snowy';
  return 'stormy';
}
// one weather call per 10 minutes, not one per home screen load
let weatherCache = { at: 0, key: '', data: null };
let picksCache = { at: 0, data: null };
// state of the MusicBrainz genre pass, so the Settings button can report progress
const genreJob = { running: false, startedAt: null, finishedAt: null, passes: 0, checked: 0, tagged: 0, families: 0, last: null, error: null };
// live progress for a crate prep, so the card can say what is happening
const crateJobs = new Map();
// crate metadata repair is a catalogue lookup per track: it takes minutes, so it is a
// job with visible progress and a result, not a fire-and-forget log line
const repairJobs = new Map();
/* One repair job for a set of tracks, shared by a playlist and an album. It returns
   counts and field totals so the caller can say what changed, not that it started. */
function startRepairJob(key, ids) {
  const current = repairJobs.get(key);
  if (current && current.running) return { started: false, job: current };
  const job = { running: true, total: ids.length, done: 0, fixed: 0, same: 0, failed: 0, fields: {}, changes: [], at: Date.now(), finishedAt: 0 };
  repairJobs.set(key, job);
  (async () => {
    for (const id of ids) {
      try {
        const p = await repair.propose(db, id);
        if (p && p.changed) {
          const r = repair.apply(db, id, p.after);
          if (r && r.error) job.failed += 1;
          else if (r && r.changed) {
            job.fixed += 1;
            for (const k of Object.keys(p.after)) job.fields[k] = (job.fields[k] || 0) + 1;
            job.changes.push({ id, ...p.after });
          } else job.same += 1;
        } else job.same += 1;
      } catch { job.failed += 1; }
      job.done += 1;
    }
    job.running = false; job.finishedAt = Date.now();
    console.log('[repair]', key, JSON.stringify({ checked: job.done, fixed: job.fixed, same: job.same, failed: job.failed }));
  })();
  return { started: true, job };
}

// metadata to write into a track's file: Traktor PRIV + standard ID3. MP3 only.
function trackTagMeta(db, tid) {
  const t = db.prepare('SELECT id,title,artist,album,genre,year,bpm,key,key_scale,duration,beat_grid FROM tracks WHERE id=?').get(tid);
  if (!t) return { error: 'no track' };
  const f = db.prepare("SELECT path, bitrate FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(tid);
  if (!f || !fs.existsSync(f.path)) return { error: 'no owned audio' };
  if (path.extname(f.path).toLowerCase() !== '.mp3') return { error: 'tags are written to MP3 only', path: f.path };
  let grid = [];
  try { grid = JSON.parse(t.beat_grid || '[]'); } catch {}
  const cues = [];
  if (grid.length) {
    cues.push({ name: 'Grid', index: 0, type: 4, start: grid[0] * 1000, length: 0, repeats: -1, hotcue: 0 });
    for (let i = 0; i < Math.min(8, grid.length); i++) {
      cues.push({ name: `Cue ${i + 1}`, index: i + 1, type: 0, start: grid[i] * 1000, length: 0, repeats: -1, hotcue: i + 1 });
    }
  }
  const plays = db.prepare('SELECT COUNT(*) c FROM listens WHERE track_id=?').get(tid).c;
  return { path: f.path, meta: {
    title: t.title, artist: t.artist, album: t.album, genre: t.genre, year: Number(t.year) || undefined,
    bpm: t.bpm || undefined, key: t.key ? `${t.key}${t.key_scale === 'minor' ? 'm' : ''}` : undefined,
    lengthMs: Math.round((t.duration || 0) * 1000), bitrate: f.bitrate ? Math.round(Number(f.bitrate)) : undefined,
    playCount: plays, cuePoints: cues,
  } };
}
const uidOf = (a, al, t) =>
  `${foldLower(a).trim()}|${foldLower(al).trim()}|${foldLower(t).trim()}`
    .replace(/\s+/g, ' ');

// ---------- helpers ----------
function upsertTrack({ title, artist, album, year, duration, format, spotify_id, track_no, disc_no }) {
  const dupKey = dupKeyOf(artist, title);
  const existing = db.prepare('SELECT id FROM tracks WHERE dup_key=?').get(dupKey);
  if (existing) {
    // fill in blanks on the row we already have instead of creating a second one
    db.prepare(`UPDATE tracks SET album=COALESCE(NULLIF(album,''), ?), year=COALESCE(year, ?),
      duration=COALESCE(duration, ?), spotify_id=COALESCE(spotify_id, ?), track_no=COALESCE(track_no, ?), disc_no=COALESCE(disc_no, ?), updated_at=? WHERE id=?`)
      .run(album || '', year || null, duration || null, spotify_id || null, track_no || null, disc_no || null, now(), existing.id);
    return existing.id;
  }
  const uid = uidOf(artist, album, title);
  const t = now();
  const r = db.prepare(`INSERT INTO tracks (uid,dup_key,title,artist,album,year,duration,format,spotify_id,track_no,disc_no,added_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid, dupKey, title, artist || '', album || '', year || null, duration || null, format || null, spotify_id || null, track_no || null, disc_no || null, t, t);
  return Number(r.lastInsertRowid);
}

function lockMeta(db, id, keys) {
  const wanted = (keys || []).filter(Boolean);
  if (!wanted.length) return;
  const row = db.prepare('SELECT meta_locked FROM tracks WHERE id=?').get(id);
  if (!row) return;
  const set = new Set(String(row.meta_locked || '').split(',').map((x) => x.trim()).filter(Boolean));
  for (const k of wanted) set.add(k);
  db.prepare('UPDATE tracks SET meta_locked=? WHERE id=?').run([...set].join(','), id);
}

/* One rule for both edit paths. The old single PATCH accepted year "nope" and an empty
   title reached SQLite as a NOT NULL error. */
function metaValidation(b) {
  if (b.title !== undefined && !String(b.title || '').trim()) return 'a track needs a title';
  if (b.year !== undefined && b.year !== '' && b.year !== null) {
    const y = Number(b.year);
    const max = new Date().getFullYear() + 1;
    if (!Number.isInteger(y) || y < 1900 || y > max) return `year must be between 1900 and ${max}`;
  }
  if (b.genre_family !== undefined && b.genre_family) {
    const known = genre.FAMILIES.map(([n]) => n).concat(['pop', 'rock', 'metal', 'electronic', 'hip hop', 'latin', 'jazz', 'classical', 'folk', 'soul', 'reggae', 'blues', 'country', 'children', 'soundtrack', 'gospel']);
    if (!known.includes(String(b.genre_family).toLowerCase())) return 'unknown genre family';
  }
  return null;
}

function upsertFile({ track_id, path: p, tier, bitrate, size, mtime, external }) {
  const row = db.prepare('SELECT id, track_id FROM files WHERE path=?').get(p);
  if (row) {
    // the same path can only describe one file; if a different track is registered for
    // it now, point the row at that track instead of leaving the old one attached
    if (row.track_id !== track_id) db.prepare('UPDATE files SET track_id=? WHERE id=?').run(track_id, row.id);
    db.prepare('UPDATE files SET tier=?, bitrate=COALESCE(?,bitrate), size=COALESCE(?,size), mtime=COALESCE(?,mtime), external=COALESCE(?,external) WHERE id=?')
      .run(tier, bitrate || null, size || null, mtime || null, external == null ? null : (external ? 1 : 0), row.id);
    return row.id;
  }
  const r = db.prepare(`INSERT INTO files (track_id,path,tier,bitrate,size,mtime,external,added_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(track_id, p, tier, bitrate || null, size || null, mtime || null, external ? 1 : 0, now());
  return Number(r.lastInsertRowid);
}

// ---------- WNL-DL ingest ----------
async function ingestWnlFolder(folder, name) {
  if (!WNL) throw new Error('WNL_URL is not configured');
  const list = JSON.parse(await httpGet(`${WNL}/api/library/tracks/${encodeURIComponent(folder)}`));
  const playlistId = `wnl-${folder.replace(/^playlist-/, '')}`;
  db.prepare(`INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`)
    .run(playlistId, name || folder, 'wnl-dl', 'listen', now(), now());

  let ok = 0, fail = 0;
  for (const item of list) {
    try {
      const url = `${WNL}/api/file/folder/${encodeURIComponent(folder)}/${encodeURIComponent(item.filename)}`;
      const dest = path.join(OWNED, folder);
      fs.mkdirSync(dest, { recursive: true });
      const safe = item.filename.replace(/[/\\]/g, '_');
      const filePath = path.join(dest, safe);
      if (!fs.existsSync(filePath)) await download(url, filePath);

      const meta = await probe(filePath);
      const tid = upsertTrack({
        title: meta.title || item.title || safe.replace(/\.mp3$/i, ''),
        artist: meta.artist || '',
        album: meta.album || '',
        year: null,
        duration: meta.duration,
        format: 'mp3',
      });
      upsertFile({ track_id: tid, path: filePath, tier: 'owned', bitrate: meta.bitrate, size: meta.size, mtime: meta.mtime });
      db.prepare('INSERT OR REPLACE INTO resolutions (track_id,rung,quality,resolved_at) VALUES (?,?,?,?)')
        .run(tid, 'local', `${Math.round((meta.bitrate || 0) / 1000)}k`, now());
      db.prepare(`INSERT INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)
        ON CONFLICT(playlist_id,track_id) DO NOTHING`).run(playlistId, tid, ok + fail, now());
      ok++;
    } catch (e) {
      fail++;
      log('job', `ingest ${folder}/${item.filename}: ${e.message}`);
    }
  }
  return { ok, fail };
}

function httpGet(url, { timeout = 15000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    let settled = false;
    const fail = (e) => { if (settled) return; settled = true; reject(e); };
    const req = mod.get(url, { timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return fail(new Error(`HTTP ${res.statusCode} ${url}`)); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); return fail(new Error('response too large')); }
        chunks.push(c);
      });
      res.on('end', () => { if (settled) return; settled = true; resolve(Buffer.concat(chunks).toString('utf8')); });
      res.on('error', fail);
    });
    req.on('timeout', () => { req.destroy(); fail(new Error('timeout')); });
    req.on('error', fail);
  });
}
// external lookups must never hold a request open indefinitely
function httpGetTimed(url, ms = 6000) {
  return Promise.race([
    httpGet(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// block links to the LAN, loopback and cloud metadata; the generic streamer/download
// otherwise lets any caller make the Pi fetch arbitrary internal URLs (SSRF)
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const p = h.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
  }
  return false;
}
function safeRemoteUrl(u) {
  try {
    const url = new URL(String(u));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (isPrivateHost(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest + '.part');
    http.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} ${url}`)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        fs.renameSync(dest + '.part', dest); resolve();
      }));
    }).on('error', (e) => { try { fs.unlinkSync(dest + '.part'); } catch {} reject(e); });
  });
}

function probe(file) {
  return new Promise((resolve) => {
    const { spawn } = require('node:child_process');
    const ff = spawn('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration,bit_rate,size:format_tags',
      '-of', 'json', file]);
    let out = '';
    ff.stdout.on('data', d => out += d);
    ff.on('close', () => {
      try {
        const f = JSON.parse(out).format || {};
        const tg = f.tags || {};
        const trk = String(tg.track || '').match(/^\d+/);
        const dsc = String(tg.disc || '').match(/^\d+/);
        // ffprobe keeps the case of a non-standard ID3 frame: TBPM is not "tbpm"
        const tag = (name) => { const hit = Object.entries(tg).find(([k]) => k.toLowerCase() === name); return hit ? hit[1] : null; };
        resolve({
          title: tg.title, artist: tg.artist, album: tg.album, year: (tg.date || '').match(/^\d{4}/) ? tg.date.slice(0, 4) : null,
          bpm: Number(tag('tbpm')) > 0 ? Number(tag('tbpm')) : null,
          keyTag: tag('tkey') || null,
          trackNumber: trk ? Number(trk[0]) : null,
          discNumber: dsc ? Number(dsc[0]) : null,
          duration: f.duration ? Number(f.duration) : null,
          bitrate: f.bit_rate ? Number(f.bit_rate) : null,
          size: f.size ? Number(f.size) : null,
          mtime: fs.statSync(file).mtimeMs / 1000,
        });
      } catch { resolve({ mtime: fs.statSync(file).mtimeMs / 1000 }); }
    });
    ff.on('error', () => resolve({}));
  });
}

function log(kind, msg) {
  fs.appendFileSync(path.join(ROOT, 'logs', 'core.log'), `${new Date().toISOString()} ${kind} ${msg}\n`);
}

// ---------- resolved stream url cache ----------
const scStreamJobs = new Map();     // key -> promise, avoids duplicate fetches
const streamUrlCache = new Map();   // trackId -> { url, exp }
const STREAM_TTL = 4 * 60 * 60 * 1000;

// read the real length of a remote stream so a 30 second preview cannot be mistaken for a track
function probeStreamDuration(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(paths.FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', url], { timeout: 15000 });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', reject);
    child.on('close', () => {
      const n = Number(String(out).trim());
      if (Number.isFinite(n) && n > 0) resolve(n); else reject(new Error('no duration'));
    });
  });
}

async function resolveStreamUrl(t) {
  const hit = streamUrlCache.get(t.id);
  if (hit && hit.exp > Date.now()) return hit.url;
  let loc = t.src_kind === 'soundcloud'
    ? await ytdlp.streamUrlFor(t.src_url || t.src_id, { format: 'http_mp3_128/bestaudio[protocol=http]/bestaudio' })
    : (t.src_kind === 'bandcamp' || t.src_kind === 'archive')
      ? await ytdlp.streamUrlFor(t.src_url || t.src_id)
      : await ytdlp.streamUrl(t.src_id);

  // SoundCloud without an account hands out a 30 second preview. If the row claims to be
  // longer than that, the preview is useless: stream the full track from YouTube instead.
  if (t.src_kind === 'soundcloud' && (t.duration || 0) > 90) {
    const probed = await probeStreamDuration(loc).catch(() => null);
    if (probed && probed < 60) {
      const alt = await ytdlp.searchYoutube({ title: t.title, artist: t.artist }, { limit: 5 }).catch(() => []);
      const want = t.duration || 0;
      const best = alt
        .filter((c) => c.id && c.duration && Math.abs(c.duration - want) <= Math.max(12, want * 0.15))
        .sort((a, b) => Math.abs(a.duration - want) - Math.abs(b.duration - want))[0];
      if (best) loc = await ytdlp.streamUrl(best.id);
    }
  }
  streamUrlCache.set(t.id, { url: loc, exp: Date.now() + STREAM_TTL });
  if (streamUrlCache.size > 400) {
    const now2 = Date.now();
    for (const [id, v] of streamUrlCache) if (v.exp <= now2 || streamUrlCache.size > 400) streamUrlCache.delete(id);
  }
  return loc;
}

// ---------- resume work left queued by a restart ----------
async function resumeQueuedDownloads() {
  const rows = db.prepare("SELECT payload FROM jobs WHERE state='queued' LIMIT 300").all();
  const work = rows.map((r) => { try { return JSON.parse(r.payload); } catch { return null; } }).filter((p) => p && p.jobId && p.trackId);
  if (!work.length) return;
  let cursor = 0;
  const worker = async () => {
    while (cursor < work.length) {
      const p = work[cursor++];
      const t = db.prepare('SELECT id,title,artist FROM tracks WHERE id=?').get(p.trackId);
      if (!t) continue;
      try {
        const best = await resolveBest({ title: t.title, artist: t.artist, duration: null }, 1800, { download: true });
        if (!best) {
          db.prepare("UPDATE jobs SET state='error', detail='no source', finished_at=? WHERE payload LIKE ?").run(now(), `%${p.jobId}%`);
          continue;
        }
        enqueueDownload(p.jobId, { trackId: t.id, rung: best.rung, id: best.id, url: best.url, thumb: best.thumb, file: best.handle?.file || best.file, title: t.title, artist: t.artist });
      } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
setTimeout(() => { try { verifyFiles({ requeue: false }); } catch {} }, 12000);
setTimeout(() => { resumeQueuedDownloads().catch(() => {}); }, 7000);

// keep the analysis and genre passes running on their own: new audio is useless unanalysed
setInterval(() => {
  try {
    const st = analyze.status(db);
    if (!st.active && st.never > 0) {
      analyze.run(db, { scope: 'never', limit: Math.min(25, st.never), workers: 2 })
        .then((r) => {
          if (r && r.error) { console.error('[analyze] cannot progress:', r.error); return; }
          console.log('[analyze] auto', JSON.stringify(r).slice(0, 120));
        })
        .catch((e) => console.error('[analyze] auto fail', e.message));
    }
  } catch {}
}, 120000);
setInterval(() => {
  try { genre.fillTracks(db, { limit: 25 }).then((r) => console.log('[genre] auto', JSON.stringify(r))).catch(() => {}); } catch {}
}, 300000);
try {
  db.prepare("DELETE FROM jobs WHERE state='dismissed' AND finished_at < ?").run(Math.floor(Date.now() / 1000) - 30 * 86400);
} catch {}


// aac 160 or 128 mp3 transcode, and refuse the 30 second previews
// SoundCloud now serves many tracks as DRM protected. Fall through to YouTube
// instead of leaving the job failed; the search rung already trusted this source.
function searchDownloadFallback(b, dir, finish, ingestDownloaded) {
  const query = [b.artist, b.title].filter(Boolean).join(' ');
  const args = ['--no-warnings', '-f', 'bestaudio/best', '-x', '--audio-format', 'm4a',
    '--max-downloads', '1', '--match-filter', 'duration > 2',
    '--extractor-args', 'youtube:player_client=android',
    '-o', path.join(dir, '%(title)s.%(ext)s'), `ytsearch3:${query}`];
  execFile(paths.YTDLP, args,
    { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return ingestDownloaded();
      const tail = String(stderr || '').split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300);
      finish('error', `soundcloud DRM; youtube failed: ${tail || err.message}`.slice(0, 600));
    });
}

function soundcloudFallbackDownload(b, dir, finish, ingestDownloaded, setProgress) {
  const run = (url) => {
    setProgress(5);
    execFile(paths.YTDLP,
      ['--no-warnings', '--print', '%(duration)s', '-f', 'bestaudio/best', url],
      { timeout: 90000, maxBuffer: 1024 * 1024 }, (probeErr, probeOut) => {
        const probed = Number(String(probeOut || '').trim().split('\n')[0]) || 0;
        const expected = Number(b.duration) || 0;
        if (probed && expected && probed < expected * 0.6 && probed < 60) {
          return finish('error', `soundcloud preview only (${Math.round(probed)}s)`);
        }
        execFile(paths.YTDLP,
          ['--no-warnings', '-f', 'hls_aac_160k/hls_aac_96k/hls_mp3_128/bestaudio',
            '-x', '--audio-format', 'm4a',
            '-o', path.join(dir, '%(title)s.%(ext)s'), url],
          { timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
            if (!err) return ingestDownloaded();
            execFile(paths.YTDLP,
              ['--no-warnings', '-f', 'bestaudio/best', '-x', '--audio-format', 'm4a',
                '-o', path.join(dir, '%(title)s.%(ext)s'), url],
              { timeout: 30 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err2) => {
                if (err2) return searchDownloadFallback(b, dir, finish, ingestDownloaded);
                ingestDownloaded();
              });
          });
      });
  };
  const candidate = String(b.url || '');
  if (/^https:\/\/soundcloud\.com\/[^/]+\/[^/]+/.test(candidate)) return run(candidate);
  // an api URL or an artist page: ask the API for the real track permalink first
  const m = String(b.id || '').match(/(\d+)/);
  if (!m) return finish('error', 'soundcloud candidate is not a track');
  soundcloud.trackInfo(`https://api.soundcloud.com/tracks/${m[1]}`)
    .then((t) => (t && t.permalink_url ? run(t.permalink_url) : finish('error', 'soundcloud track has no permalink')))
    .catch((e) => finish('error', `soundcloud resolve: ${String(e.message).slice(0, 120)}`));
}

// the free-text "keep out of picks" field, parsed once per call into real terms
function tasteAvoid() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return exclude.parse(s.taste_avoid || '');
  } catch { return []; }
}
/* Children's music is usually played for someone else. Off by default: those plays stay
   in history, but they do not move the top family, tempo, key, picks or greeting facts. */
function tasteIncludeChildren() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return s.taste_include_children === true;
  } catch { return false; }
}

// ---------- rung health ----------
const rungHealth = { checkedAt: null, rungs: {} };
async function probeRungs() {
  const out = {};
  const t0 = Date.now();
  try {
    await ytdlp.streamUrl('8k_f2QK77ew');
    out['yt-dlp'] = { ok: true, ms: Date.now() - t0 };
  } catch (e) { out['yt-dlp'] = { ok: false, error: String(e.message).slice(0, 120) }; }
  const t1 = Date.now();
  try {
    const sc = await ytdlp.searchSoundcloud({ title: 'archangel', artist: 'burial' }, { limit: 1 });
    out.soundcloud = { ok: sc.length > 0, ms: Date.now() - t1 };
  } catch (e) { out.soundcloud = { ok: false, error: String(e.message).slice(0, 120) }; }
  const t2 = Date.now();
  try {
    const ia = await archive.searchArchive({ title: 'burial', artist: '' }, { limit: 1 });
    out.archive = { ok: ia.length > 0, ms: Date.now() - t2 };
  } catch (e) { out.archive = { ok: false, error: String(e.message).slice(0, 120) }; }

  rungHealth.checkedAt = now();
  rungHealth.rungs = out;
  return out;
}
setTimeout(() => { probeRungs().catch(() => {}); }, 20000);
setInterval(() => { probeRungs().catch(() => {}); }, 15 * 60 * 1000);

// ---------- static asset serving ----------
const gzipCache = new Map();
// keyed by content hash, never by length: a rename that keeps the byte count identical
// used to serve the previous build to every gzip client until the process restarted
function gzipBody(key, body) {
  let hit = gzipCache.get(key);
  if (!hit) {
    if (gzipCache.size > 40) gzipCache.clear();
    hit = zlib.gzipSync(body, { level: 6 });
    gzipCache.set(key, hit);
  }
  return hit;
}
function sendStatic(req, res, body, type) {
  // revalidate every load (ETag): a year-long "immutable" cache is how a stale app.js
  // shadows a deploy for every client, which is exactly what kept happening.
  const etag = '"' + require('node:crypto').createHash('md5').update(body).digest('hex') + '"';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': 'no-cache' });
    return res.end();
  }
  const acceptsGzip = /gzip/.test(req.headers['accept-encoding'] || '');
  const headers = { 'content-type': type, 'cache-control': 'no-cache', etag, vary: 'Accept-Encoding' };
  if (acceptsGzip) {
    const gz = gzipBody(etag, body);
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = gz.length;
    res.writeHead(200, headers);
    return res.end(gz);
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  return res.end(body);
}

// ---------- harmonic / tempo matching ----------
// Camelot numbers, so "what follows this" is a musical answer, not a similarity score
function sessionSummary(hours = 12) {
  try {
    const rows = db.prepare(`SELECT l.played_at, t.id, t.title, t.bpm, t.artist FROM listens l JOIN tracks t ON t.id=l.track_id
      WHERE l.played_at >= ? ORDER BY l.played_at DESC`).all(now() - hours * 3600);
    const run = [];
    let prev = null;
    for (const r of rows) {
      if (prev != null && prev - r.played_at > 90 * 60) break;
      run.push(r);
      prev = r.played_at;
    }
    if (run.length < 2) return null;
    const bpms = run.filter((r) => r.bpm).map((r) => Math.round(r.bpm)).reverse();
    return {
      minutes: Math.max(1, Math.round((run[0].played_at - run[run.length - 1].played_at) / 60)),
      tracks: run.length,
      artists: new Set(run.map((r) => r.artist).filter(Boolean)).size,
      avgBpm: bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null,
      startedAt: run[run.length - 1].played_at,
    };
  } catch { return null; }
}

/* the seed for 'what follows': the last track you played, when it has a tempo. If it
   does not, the session's average tempo stands in and the key is left out — better than
   naming a track that is not the last one you played. */
// 1,105 of 1,415 tracks have no genre, so 'unknown' has to mean 'allowed'. A track that
// says it is metal next to a house record is a different thing, not a candidate.
function sameFamily(a, b) {
  if (!a || !b) return true;
  return a === b;
}

function mixSeed() {
  try {
    const last = db.prepare(`SELECT t.id, t.title, t.artist, t.bpm, t.key, t.key_scale, t.genre_family
      FROM listens l JOIN tracks t ON t.id=l.track_id
      ${tasteIncludeChildren() ? '' : "WHERE COALESCE(t.genre_family,'') != 'children'"}
      ORDER BY l.played_at DESC LIMIT 1`).get();
    if (last && last.bpm) return { ...last, exact: true };
    const s = sessionSummary();
    if (s && s.avgBpm) return { id: last ? last.id : 0, title: null, artist: null, bpm: s.avgBpm, key: null, key_scale: null, exact: false };
    return null;
  } catch { return null; }
}
function mixCandidates(seed, limit = 25, excludeIds = []) {
  if (!seed || !Number(seed.bpm)) return [];
  const skip = new Set(excludeIds.map(Number));
  const seedC = camelotOf(seed.key, seed.key_scale);
  const near = (pct) => db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.bpm, t.key, t.key_scale, t.genre_family, t.duration, t.has_art,
      (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned
    FROM tracks t WHERE t.bpm BETWEEN ? AND ? AND t.id <> ?`)
    .all(Number(seed.bpm) * (1 - pct), Number(seed.bpm) * (1 + pct), seed.id)
    .filter((r) => r.owned && !skip.has(r.id) && sameFamily(seed.genre_family, r.genre_family));
  // known-same-family first, then closest tempo: a 118 BPM track that says it is house beats
  // an unanalysed 118 BPM one, and both beat anything the genre column calls something else
  const famRank = (r) => (seed.genre_family && r.genre_family === seed.genre_family ? 0 : 1);
  const byTempo = (a, b) => famRank(a) - famRank(b)
    || Math.abs(a.bpm - seed.bpm) - Math.abs(b.bpm - seed.bpm)
    || String(a.title).localeCompare(String(b.title));

  // three tiers, filled in order: same or adjacent key at the same tempo, then anything at
  // the same tempo, then a wider tempo window. With 357 of 1415 tracks analysed a strict
  // harmonic filter answers with one track or none, which is not a set anybody plays.
  const atTempo = near(0.04).sort(byTempo);
  const harmonic = seedC
    ? atTempo.filter((r) => {
        const c = camelotOf(r.key, r.key_scale);
        if (!c) return false;
        const d = Math.min((c.n - seedC.n + 12) % 12, (seedC.n - c.n + 12) % 12);
        return c.n === seedC.n || (d === 1 && c.minor === seedC.minor);
      })
    : atTempo;
  const out = [];
  const seen = new Set();
  const add = (rows, tier) => {
    for (const r of rows) {
      if (out.length >= limit) return;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ ...r, tier });
    }
  };
  add(harmonic, 'key');
  add(atTempo, 'tempo');
  add(near(0.08).sort(byTempo), 'near');
  return out;
}

// ---------- transcoding queue ----------
// one at a time: ffmpeg on a Pi competes with streaming and analysis, and a wrong file
// is worse than a slow one
const transcodeQueue = [];
let transcodeBusy = false;
let faststartScan = { at: 0, rows: [] };
function faststartCandidates() {
  if (Date.now() - faststartScan.at < 10 * 60 * 1000) return faststartScan.rows;
  const rows = db.prepare("SELECT id, track_id, path FROM files WHERE tier='owned' AND COALESCE(external,0)=0 AND path LIKE '%.m4a'").all()
    .filter((r) => !transcode.hasFaststart(r.path));
  faststartScan = { at: Date.now(), rows };
  return rows;
}
async function pumpTranscode() {
  if (transcodeBusy) return;
  transcodeBusy = true;
  let done = 0;
  while (transcodeQueue.length) {
    const row = transcodeQueue.shift();
    try {
      if (row.external) continue;
      if (!fs.existsSync(row.path)) continue;
      if (row.kind === 'faststart') {
        const ok = await transcode.toFaststart(row.path);
        if (ok) { done += 1; if (done % 25 === 0) console.log('[faststart]', done, 'done'); }
        continue;
      }
      const out = await transcode.toPlayable(row.path, { format: setting('transcode_format', 'm4a') });
      if (!out) { console.log('[transcode] skipped', path.basename(row.path)); continue; }
      upsertFile({ track_id: row.track_id, path: out.path, tier: 'owned', bitrate: out.bitrate, size: out.size, mtime: now() });
      db.prepare('DELETE FROM files WHERE id=?').run(row.id);
      try { fs.rmSync(row.path, { force: true }); } catch {}
      done += 1;
      console.log('[transcode]', row.track_id, path.basename(row.path), '->', path.basename(out.path));
    } catch (e) {
      console.log('[transcode] failed', path.basename(row.path), String(e.message || e).slice(0, 120));
    }
  }
  transcodeBusy = false;
  faststartScan = { at: 0, rows: [] };   // the scan that ran mid-flight is stale now
  if (done) console.log('[queue] processed', done, 'file(s)');
}

// ---------- uploads and cover helpers ----------
const MAX_BODY_BYTES = Number(process.env.MUSICFY_MAX_BODY || 64 * 1024 * 1024);
/* ---------- adopt an existing music folder ----------
 * Point MUSICFY at a folder (or one playlist file) and it registers the audio where it
 * already is: nothing is copied, moved or renamed. Playlists written by Traktor,
 * rekordbox or another player become playlists here, with their order and, when the
 * file records it, the BPM and key the DJ already analysed. */

const adoptState = {
  running: false, target: null, startedAt: null, finishedAt: null,
  total: 0, done: 0, added: 0, linked: 0, skipped: 0, missing: 0,
  playlists: 0, playlist_tracks: 0, truncated: false, error: null,
};

function localRequest(req) {
  const a = String(req.socket.remoteAddress || '');
  const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  // behind Caddy the peer is loopback; a forwarded header means the caller is not
  return loop && !req.headers['x-forwarded-for'];
}
function musicRoots() {
  return String(process.env.MUSICFY_MUSIC_ROOTS || '')
    .split(path.delimiter).map((r) => r.trim()).filter(Boolean)
    .map((r) => folderLib.realish(r));
}
function withinMusicRoots(target) {
  const real = folderLib.realish(target);
  const roots = musicRoots();
  return { real, roots, ok: roots.some((r) => real === r || real.startsWith(r + path.sep)) };
}

/* Places the Settings picker can offer without a dialog. A remote browser gets the
 * configured roots only, so a page cannot ask what is in the home directory. */
function folderChoices(local) {
  const seen = new Set();
  const out = [];
  const add = (dir) => {
    if (!dir) return;
    let real;
    try { real = folderLib.realish(dir); } catch { return; }
    if (seen.has(real)) return;
    try { if (!fs.statSync(real).isDirectory()) return; } catch { return; }
    seen.add(real);
    out.push(real);
  };
  const roots = musicRoots();
  add(OWNED);
  for (const root of roots) add(root);
  const music = path.join(os.homedir(), 'Music');
  if (local) add(music);
  // one level under each *root*: "Music/Albums" is the usual case. The download folder is
  // offered whole and not expanded — inside it MUSICFY writes track-*, youtube-* and
  // playlist-* working directories, which are not collections to scan.
  for (const base of [...roots, ...(local ? [music] : [])]) {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    let n = 0;
    for (const entry of entries) {
      if (n >= 120) break;
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      // the app's own buckets are not a music collection to pick: playlist-*, upload, web
      if (/^(playlist|upload|web)(-|$)/i.test(entry.name)) continue;
      add(path.join(base, entry.name));
      n += 1;
    }
  }
  const home = os.homedir();
  return out.map((p) => ({ path: p, label: p.startsWith(home) ? `~${p.slice(home.length)}` : p }));
}

function rememberPath(map, file, trackId) {
  map.set(path.normalize(file), trackId);
  map.set(path.resolve(file), trackId);
  map.set(folderLib.realish(file), trackId);
}

function applyAdoptHint(tid, hint) {
  if (!tid || !hint) return;
  const bpm = Number(hint.bpm);
  if (bpm > 0) db.prepare('UPDATE tracks SET bpm=COALESCE(bpm,?) WHERE id=?').run(bpm, tid);
  if (hint.key) db.prepare('UPDATE tracks SET key=COALESCE(key,?), key_scale=COALESCE(key_scale,?) WHERE id=?')
    .run(hint.key, hint.scale || 'major', tid);
}

async function adoptOneFile(file, hint) {
  const abs = folderLib.realish(file);
  if (!fs.existsSync(abs)) return { status: 'missing' };
  const known = db.prepare('SELECT track_id FROM files WHERE path=?').get(abs)
    || db.prepare('SELECT track_id FROM files WHERE path=?').get(path.normalize(file))
    || db.prepare('SELECT track_id FROM files WHERE path=?').get(path.resolve(file));
  if (known) {
    // the file may already be here from a download; its playlist still knows the BPM and
    // key, and throwing that away made an analysed collection look unanalysed
    applyAdoptHint(known.track_id, hint);
    return { track: known.track_id, status: 'skipped' };
  }

  let st;
  try { st = fs.statSync(abs); } catch { return { status: 'missing' }; }
  const meta = await probe(abs);
  const ext = path.extname(abs).toLowerCase();
  const title = String((hint && hint.title) || meta.title || path.basename(abs).replace(/\.[^.]+$/, '')).trim();
  if (!title) return { status: 'missing' };
  const artist = String((hint && hint.artist) || meta.artist || '').trim();
  let bpm = Number((hint && hint.bpm) || meta.bpm) || null;
  let key = (hint && hint.key) || null;
  let scale = (hint && hint.scale) || null;
  if (!key && meta.keyTag) {
    const kp = folderLib.keyParts(meta.keyTag);
    if (kp) { key = kp.key; scale = kp.scale; }
  }

  let tid;
  try {
    tid = upsertTrack({
      title, artist,
      album: String((hint && hint.album) || meta.album || '').trim(),
      year: meta.year || null,
      duration: meta.duration || (hint && hint.duration) || null,
      format: ext.replace('.', ''),
      track_no: meta.trackNumber || null,
      disc_no: meta.discNumber || null,
    });
  } catch (e) {
    log('folder', `adopt ${abs}: ${e.message}`);
    return { status: 'missing' };
  }

  const quality = fileQuality(ext, meta.bitrate);
  const owned = db.prepare(`SELECT f.path, f.bitrate FROM files f JOIN tracks t ON t.id=f.track_id
    WHERE t.dup_key=? AND f.tier='owned'`).all(dupKeyOf(artist, title))
    .sort((a, b) => fileQuality(path.extname(b.path), b.bitrate) - fileQuality(path.extname(a.path), a.bitrate));
  applyAdoptHint(tid, { bpm, key, scale });

  // a better or equal copy already here: the playlist points at that track, and the
  // owner's file is not registered a second time
  if (owned.length && fileQuality(path.extname(owned[0].path), owned[0].bitrate) >= quality) {
    return { track: tid, status: 'linked' };
  }

  upsertFile({
    track_id: tid, path: abs, tier: 'owned', bitrate: meta.bitrate,
    size: st.size, mtime: st.mtimeMs / 1000, external: 1,
  });
  db.prepare('INSERT OR REPLACE INTO resolutions (track_id,rung,quality,resolved_at) VALUES (?,?,?,?)')
    .run(tid, 'folder', meta.bitrate ? `${Math.round(meta.bitrate / 1000)}k` : null, now());
  const art = await extractCover(tid, abs).catch(() => false);
  if (art) db.prepare('UPDATE tracks SET has_art=1 WHERE id=?').run(tid);
  return { track: tid, status: 'added' };
}

async function runFolderAdopt(target, { local }) {
  Object.assign(adoptState, {
    running: true, target, startedAt: Date.now(), finishedAt: null,
    total: 0, done: 0, added: 0, linked: 0, skipped: 0, missing: 0,
    playlists: 0, playlist_tracks: 0, truncated: false, error: null,
  });
  const allowed = (p) => local || withinMusicRoots(p).ok;
  try {
    const stat = fs.statSync(target);
    const defs = [];
    const hints = new Map();
    let audio = [];
    if (stat.isFile()) {
      if (folderLib.AUDIO.has(path.extname(target).toLowerCase())) {
        audio = [target];
      } else {
        const parsed = folderLib.readPlaylist(target);
        if (!parsed) throw new Error('not an audio file, or not a playlist this reads (NML, rekordbox XML, M3U, PLS)');
        defs.push(...parsed.playlists);
        for (const [p, meta] of parsed.files) {
          hints.set(path.normalize(p), meta);
          hints.set(folderLib.realish(p), meta);
        }
        audio = parsed.playlists.flatMap((d) => d.entries);
      }
    } else if (stat.isDirectory()) {
      const found = folderLib.walk(target);
      adoptState.truncated = found.truncated;
      audio = found.audio.slice();
      for (const file of found.playlists) {
        if (!allowed(file)) continue;
        const parsed = folderLib.readPlaylist(file);
        if (!parsed) continue;
        defs.push(...parsed.playlists);
        for (const [p, meta] of parsed.files) {
          if (!hints.has(path.normalize(p))) hints.set(path.normalize(p), meta);
          if (!hints.has(folderLib.realish(p))) hints.set(folderLib.realish(p), meta);
        }
      }
      for (const d of defs) audio.push(...d.entries);
    } else {
      throw new Error('that path is not a file or a folder');
    }

    audio = [...new Set(audio.map((p) => path.normalize(p)))]
      .filter((p) => folderLib.AUDIO.has(path.extname(p).toLowerCase()) && allowed(p));
    adoptState.total = audio.length;

    const map = new Map();
    const queue = audio.slice();
    const worker = async () => {
      while (queue.length) {
        const file = queue.shift();
        let r;
        try { r = await adoptOneFile(file, hints.get(path.normalize(file)) || hints.get(folderLib.realish(file)) || null); }
        catch (e) { r = { status: 'missing' }; log('folder', `adopt ${file}: ${e.message}`); }
        adoptState.done += 1;
        adoptState[r.status] = (adoptState[r.status] || 0) + 1;
        if (r.track) rememberPath(map, file, r.track);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    const created = new Set();
    for (const def of defs) {
      const ids = [];
      for (const p of def.entries) {
        const tid = map.get(path.normalize(p)) || map.get(path.resolve(p)) || map.get(folderLib.realish(p));
        if (tid && !ids.includes(tid)) ids.push(tid);
      }
      if (!ids.length) continue;
      // the source file is part of the identity: A/playlist.m3u and B/playlist.m3u are
      // two playlists with one name, not one playlist written twice
      const id = 'fold-' + createHash('sha1').update(`${target}|${def.file || ''}|${def.name}`).digest('hex').slice(0, 12);
      const t = now();
      db.prepare(`INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, updated_at=excluded.updated_at`)
        .run(id, def.name, 'folder', def.kind === 'dj' ? 'dj' : 'listen', t, t);
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=?').run(id);
      ids.forEach((tid, i) => db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)')
        .run(id, tid, i, t));
      created.add(id);
      adoptState.playlists = created.size;
      adoptState.playlist_tracks += ids.length;
    }
  } catch (e) {
    adoptState.error = String(e.message || e);
  } finally {
    adoptState.running = false;
    adoptState.finishedAt = Date.now();
    log('folder', `adopt ${target}: added ${adoptState.added}, linked ${adoptState.linked}, skipped ${adoptState.skipped}, playlists ${adoptState.playlists}${adoptState.error ? `, error ${adoptState.error}` : ''}`);
  }
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (msg) => {
      if (done) return;
      done = true;
      req.destroy();
      reject(new Error(msg));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) return fail(`body too large: ${Math.round(size / 1048576)}MB`);
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => fail(e.message));
  });
}

// 2. cheap token bucket for the expensive routes only
const RATE = { window: 60000, max: 40 };
const buckets = new Map();
function clientOf(req) {
  // a reverse proxy on this machine is the only thing allowed to speak for a client
  const forwarded = req.headers['x-forwarded-for'];
  const remote = (req.socket && req.socket.remoteAddress) || 'local';
  const loopback = /^(::1|127\.|::ffff:127\.)/.test(remote);
  return loopback && forwarded ? String(forwarded).split(',')[0].trim() : remote;
}
function allow(req, route) {
  const key = `${clientOf(req)}|${route}`;
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < RATE.window);
  if (list.length >= RATE.max) { buckets.set(key, list); return false; }
  list.push(now);
  buckets.set(key, list);
  return true;
}
// proposals wait here until the user confirms; nothing is created or queued before that
const previewCache = new Map();
const pendingActions = new Map();
const ACTION_TTL = 15 * 60 * 1000;
function stashAction(proposal) {
  const id = crypto.randomUUID();
  pendingActions.set(id, { proposal, at: Date.now() });
  return id;
}
function takeAction(id) {
  const a = pendingActions.get(id);
  if (!a) return null;
  pendingActions.delete(id);
  if (Date.now() - a.at > ACTION_TTL) return null;
  return a;
}
setInterval(() => {
  const now = Date.now();
  for (const [id, a] of pendingActions) if (now - a.at > ACTION_TTL) pendingActions.delete(id);
  for (const [k, v] of buckets) {
    const kept = v.filter((t) => now - t < RATE.window);
    if (kept.length) buckets.set(k, kept); else buckets.delete(k);
  }
  // a cancelled download that is neither running nor queued needs no tombstone
  try {
    const queued = new Set(downloadQueue.map((i) => i.jobId));
    for (const id of cancelledJobs) if (!runningChildren.has(id) && !queued.has(id)) cancelledJobs.delete(id);
  } catch {}
}, 60000);

/* A staged ZIP has one owner: this function. The temp tree is removed when the response
   closes (finished or abandoned), when the read fails, and when the headers cannot be
   written. It used to be removed only on stream.close, so a failed zip left gigabytes in /tmp. */
function streamZip(res, tmpDir, zipPath, headers) {
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  let size = 0;
  try { size = fs.statSync(zipPath).size; } catch (e) { cleanup(); return serverError(res, e, 'zip'); }
  res.writeHead(200, { ...headers, 'content-length': size });
  const stream = fs.createReadStream(zipPath);
  stream.on('error', (e) => { cleanup(); console.error('[zip] read failed:', e.message); try { res.destroy(); } catch {} });
  res.on('close', cleanup);
  stream.pipe(res);
}

// 3. ladder results are expensive and rarely change inside a few minutes
const LADDER_TTL = Number(process.env.MUSICFY_LADDER_TTL || 5 * 60 * 1000);
const ladderCache = new Map();

// 4. schema version, so column changes stop being invisible
const SCHEMA_VERSION = 9;
function currentVersion() {
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key=?').get('schema_version');
    return row ? Number(row.value) : 0;
  } catch { return 0; }
}
function setVersion(v) {
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('schema_version', String(v));
}
function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const at = currentVersion();
  if (at >= SCHEMA_VERSION) return at;
  const steps = [
    [1, () => {
      // tracked columns that used to be added with bare try/catch ALTER
      for (const sql of [
        'ALTER TABLE tracks ADD COLUMN genre_family TEXT',
        'ALTER TABLE tracks ADD COLUMN src_kind TEXT',
        'ALTER TABLE tracks ADD COLUMN src_id TEXT',
        'ALTER TABLE tracks ADD COLUMN src_url TEXT',
        'ALTER TABLE tracks ADD COLUMN loudness REAL',
        'ALTER TABLE tracks ADD COLUMN energy REAL',
      ]) { try { db.exec(sql); } catch {} }
    }],
    [2, () => {
      // search goes through FTS5: a leading wildcard LIKE cannot use a B-tree
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(title, artist, album, content='tracks', content_rowid='id')");
      db.exec("INSERT INTO tracks_fts(rowid, title, artist, album) SELECT id, title, COALESCE(artist,''), COALESCE(album,'') FROM tracks WHERE id NOT IN (SELECT rowid FROM tracks_fts)");
      db.exec(`CREATE TRIGGER IF NOT EXISTS tracks_fts_ai AFTER INSERT ON tracks BEGIN
        INSERT INTO tracks_fts(rowid, title, artist, album) VALUES (new.id, new.title, COALESCE(new.artist,''), COALESCE(new.album,''));
      END`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS tracks_fts_ad AFTER DELETE ON tracks BEGIN
        INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) VALUES ('delete', old.id, old.title, COALESCE(old.artist,''), COALESCE(old.album,''));
      END`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS tracks_fts_au AFTER UPDATE ON tracks BEGIN
        INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) VALUES ('delete', old.id, old.title, COALESCE(old.artist,''), COALESCE(old.album,''));
        INSERT INTO tracks_fts(rowid, title, artist, album) VALUES (new.id, new.title, COALESCE(new.artist,''), COALESCE(new.album,''));
      END`);
    }],
    [3, () => {
      // analysis columns belong to the schema, not to the Python analyser's first touch.
      // Without this a fresh install answers 500 on /api/tracks until something happens
      // to call /api/analyze/status. Idempotent: a DB that has them is untouched.
      for (const sql of [
        'ALTER TABLE tracks ADD COLUMN key TEXT',
        'ALTER TABLE tracks ADD COLUMN key_scale TEXT',
        'ALTER TABLE tracks ADD COLUMN key_confidence REAL',
        'ALTER TABLE tracks ADD COLUMN beat_grid TEXT',
        'ALTER TABLE tracks ADD COLUMN analyzed_at INTEGER',
        'ALTER TABLE tracks ADD COLUMN sections TEXT',
        'ALTER TABLE tracks ADD COLUMN energy10 REAL',
        'ALTER TABLE tracks ADD COLUMN track_no INTEGER',
        'ALTER TABLE tracks ADD COLUMN dup_key TEXT',
      ]) { try { db.exec(sql); } catch {} }
      try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS tracks_dup_key ON tracks(dup_key)'); } catch {}
      try { db.exec('ALTER TABLE tracks DROP COLUMN key_sig'); } catch {}
    }],
    [4, () => {
      // analysis has a version now, because "analysed" stopped meaning "has cue data".
      // Playlists have a role too: a listening set does not need to be prepped.
      try { db.exec('ALTER TABLE tracks ADD COLUMN analysis_version INTEGER DEFAULT 0'); } catch {}
      try { db.exec("ALTER TABLE playlists ADD COLUMN kind TEXT NOT NULL DEFAULT 'listen'"); } catch {}
      // label what the old analyser produced so "outdated" is a fact, not a guess
      db.exec("UPDATE tracks SET analysis_version=2 WHERE analysis_version=0 AND sections IS NOT NULL AND sections != ''");
      db.exec("UPDATE tracks SET analysis_version=1 WHERE analysis_version=0 AND analyzed_at IS NOT NULL");
    }],
    [5, () => {
      // an upload with no tags still has bytes: the hash is what makes two identical files
      // one file, even when the names differ
      try { db.exec('ALTER TABLE files ADD COLUMN sha256 TEXT'); } catch {}
      try { db.exec('CREATE INDEX IF NOT EXISTS idx_files_sha ON files(sha256)'); } catch {}
    }],
    [6, () => {
      // hand-edited metadata is authoritative; catalogue repair must not overwrite it
      try { db.exec('ALTER TABLE tracks ADD COLUMN meta_locked TEXT'); } catch {}
    }],
    [7, () => {
      // these were created only by import-history.js, so a clone with no Spotify export
      // had no play_edges: radio, recommendations and Flow answered 500
      db.exec(`
        CREATE TABLE IF NOT EXISTS spotify_plays (
          id INTEGER PRIMARY KEY, ts TEXT NOT NULL, ms_played INTEGER DEFAULT 0,
          track_name TEXT, artist_name TEXT, album_name TEXT, track_uri TEXT, platform TEXT,
          reason_start TEXT, reason_end TEXT, skipped INTEGER DEFAULT 0, shuffle INTEGER DEFAULT 0,
          offline INTEGER DEFAULT 0, conn_country TEXT);
        CREATE TABLE IF NOT EXISTS history_files (
          name TEXT PRIMARY KEY, bytes INTEGER, rows INTEGER, music_plays INTEGER, imported_at TEXT);
        CREATE INDEX IF NOT EXISTS idx_sp_ts ON spotify_plays(ts);
        CREATE INDEX IF NOT EXISTS idx_sp_uri ON spotify_plays(track_uri);
        CREATE INDEX IF NOT EXISTS idx_sp_artist ON spotify_plays(artist_name);
        CREATE TABLE IF NOT EXISTS taste_tracks (
          uri TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
          plays INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, skips INTEGER DEFAULT 0, last_ts TEXT);
        CREATE TABLE IF NOT EXISTS taste_artists (
          artist TEXT PRIMARY KEY, plays INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, last_ts TEXT);
        CREATE TABLE IF NOT EXISTS play_edges (
          a TEXT NOT NULL, b TEXT NOT NULL, w INTEGER DEFAULT 0, PRIMARY KEY (a, b));
        CREATE INDEX IF NOT EXISTS idx_edges_a ON play_edges(a);
      `);
    }],
    [8, () => {
      // a file adopted from a folder stays where it is, and deleting the track must
      // never unlink the owner's original. external=1 means "registered, not ours".
      try { db.exec('ALTER TABLE files ADD COLUMN external INTEGER DEFAULT 0'); } catch {}
      try { db.exec('CREATE INDEX IF NOT EXISTS idx_files_external ON files(external)'); } catch {}
    }],
    [9, () => {
      // Kids mode records plays in their own table, not in `listens`. Every taste query
      // reads `listens`, so a kid's listening cannot reach it by construction: there is no
      // filter to forget. The playlist flag is the unit of curation.
      try { db.exec('ALTER TABLE playlists ADD COLUMN kids INTEGER DEFAULT 0'); } catch {}
      db.exec(`CREATE TABLE IF NOT EXISTS kids_listens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        played_at INTEGER NOT NULL,
        ms_played INTEGER DEFAULT 0
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_kids_listens ON kids_listens(track_id, played_at)');
    }],
  ];
  for (const [version, run] of steps) {
    if (at >= version) continue;
    try { run(); setVersion(version); console.log('[migrate] applied', version); }
    catch (e) { console.error('[migrate] failed at', version, e.message); break; }
  }
  return currentVersion();
}

/* SoundCloud stream cache: one place, in the OS temp dir, pruned on use. It used to be
   /tmp/musicfy-sc with no ceiling. */
function scCacheDir() {
  const dir = path.join(os.tmpdir(), 'musicfy-sc');
  fs.mkdirSync(dir, { recursive: true });
  try {
    const now = Date.now();
    const files = fs.readdirSync(dir).map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { p, size: st.size, at: st.mtimeMs };
    });
    for (const f of files) if (now - f.at > 7 * 86400 * 1000) { try { fs.rmSync(f.p, { force: true }); } catch {} }
    const kept = files.filter((f) => now - f.at <= 7 * 86400 * 1000).sort((a, b) => b.at - a.at);
    let total = kept.reduce((n, f) => n + f.size, 0);
    const CAP = 2 * 1024 * 1024 * 1024;
    for (let i = kept.length - 1; i >= 0 && total > CAP; i -= 1) {
      try { fs.rmSync(kept[i].p, { force: true }); total -= kept[i].size; } catch {}
    }
  } catch {}
  return dir;
}

// 5. dependencies must fail loudly at boot, not silently mid download
function checkDependencies() {
  const onPath = (name) => String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .some((d) => { try { return fs.existsSync(path.join(d, name)); } catch { return false; } });
  const bins = [[paths.FFPROBE, 'ffprobe', 'MUSICFY_FFPROBE'], [paths.FFMPEG, 'ffmpeg', 'MUSICFY_FFMPEG'], [paths.YTDLP, 'yt-dlp', 'MUSICFY_YTDLP']];
  for (const [full, name, env] of bins) {
    const ok = path.isAbsolute(full) ? fs.existsSync(full) : onPath(name);
    if (!ok) console.error(`[deps] MISSING ${name} (looked for ${full}) — install it, or set ${env} or PATH`);
    else if (path.isAbsolute(full)) console.log(`[deps] ${name} ${full}`);
  }
  // the analyser is the one dependency that fails silently: it spawns per batch, so a
  // missing interpreter looks like "nothing to analyse" forever
  const py = paths.ESSENTIA_PY;
  if (!fs.existsSync(py)) {
    const venv = /\/bin\/python[0-9.]*$/.test(py) ? path.dirname(path.dirname(py)) : null;
    console.error(`[deps] MISSING analyser interpreter ${py} — ${venv ? `create it (python3 -m venv ${venv} && ${venv}/bin/pip install librosa numpy), or` : ''} set MUSICFY_PYTHON`);
  } else console.log('[deps] analyser', py);
}

function plCoverFile(pid) {
  // allow only safe characters: decodeURIComponent + path.join otherwise allows ../ traversal
  const safe = String(pid).replace(/^sp-/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'unknown';
  return path.join(COVER_DIR, `pl-${safe}.jpg`);
}

// normalise any uploaded image to a 600px jpeg in the cover cache
function saveImageCover(buf, destJpg) {
  return new Promise((resolve, reject) => {
    if (!buf || !buf.length) return reject(new Error('empty image'));
    const tmp = path.join(os.tmpdir(), `mfimg-${crypto.randomUUID()}`);
    fs.writeFileSync(tmp, buf);
    execFile('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-vf', 'scale=600:-1', '-q:v', '3', destJpg],
      { timeout: 30000 }, (err) => {
        try { fs.unlinkSync(tmp); } catch {}
        err ? reject(err) : resolve(true);
      });
  });
}

function fetchBuffer(url, timeout = 20000, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const req = https.get(url, { headers: { 'user-agent': 'Mozilla/5.0' }, timeout }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      const chunks = [];
      let size = 0;
      r.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); return resolve(null); }
        chunks.push(c);
      });
      r.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('timeout', () => { req.destroy(); resolve(null); }).on('error', () => resolve(null));
  });
}

function saveThumb(thumb, trackId) {
  return new Promise((resolve) => {
    if (!thumb) return resolve(false);
    https.get(thumb, { headers: { 'user-agent': 'Mozilla/5.0' }, timeout: 20000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return resolve(false); }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', async () => {
        try {
          await saveImageCover(Buffer.concat(chunks), coverFile(trackId));
          db.prepare('UPDATE tracks SET has_art=1 WHERE id=?').run(trackId);
          resolve(true);
        } catch (e) { try { log('cover', `save failed for track ${trackId}: ${e.message}`); } catch {} resolve(false); }
      });
    }).on('error', (e) => { try { log('cover', `download failed for track ${trackId}: ${e.message}`); } catch {} resolve(false); });
  });
}

// ---------- covers ----------
// extract embedded art to data/covers/<track_id>_<size>.jpg (ffmpeg extracts full res once, then we serve that)
function coverFile(tid) { return path.join(COVER_DIR, `${tid}.jpg`); }

function extractCover(tid, filePath) {
  return new Promise((resolve) => {
    const out = coverFile(tid);
    if (fs.existsSync(out)) return resolve(true);
    execFile('ffmpeg', ['-y', '-i', filePath, '-an', '-map', '0:v', '-c:v', 'copy', '-frames:v', '1', out],
      { timeout: 15000 }, (err) => {
        if (!err && fs.existsSync(out) && fs.statSync(out).size > 500) return resolve(true);
        try { fs.unlinkSync(out); } catch {}
        resolve(false);
      });
  });
}

async function warmCovers() {
  const rows = db.prepare(`SELECT f.track_id, f.path FROM files f WHERE f.tier='owned' AND f.track_id NOT IN
    (SELECT track_id FROM tracks WHERE has_art=1)`).all();
  const have = db.prepare('SELECT id, has_art FROM tracks').all();
  const artMap = new Map(have.map(r => [r.id, r.has_art]));
  let done = 0;
  for (const r of rows) {
    if (artMap.get(r.track_id)) continue;
    const ok = await extractCover(r.track_id, r.path);
    db.prepare('UPDATE tracks SET has_art=? WHERE id=?').run(ok ? 1 : 0, r.track_id);
    artMap.set(r.track_id, ok ? 1 : 0);
    done++;
    if (done % 50 === 0) log('cover', `warmed ${done}/${rows.length}`);
  }
  log('cover', `cover warm complete: ${done} processed`);
}

// ---------- listens ----------
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
function setting(key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

function recordListen({ track_id, ms_played, source, kids }) {
  // Kids plays live in their own table. Not filtering `listens` is the point: every taste,
  // rotation and A&R query already reads `listens`, so none of them can pick this up.
  if (kids) {
    db.prepare('INSERT INTO kids_listens (track_id,played_at,ms_played) VALUES (?,?,?)')
      .run(track_id, now(), ms_played || 0);
    return;
  }
  db.prepare('INSERT INTO listens (track_id,played_at,ms_played,source,scrobbled) VALUES (?,?,?,?,0)')
    .run(track_id, now(), ms_played || 0, source || 'local');
  maybeAutoDownload(track_id);
}

/* ---------- kids mode ---------- */
/* One profile, one cookie, one PIN. The PIN is a speed bump for a child, not a security
   boundary, and the copy says so. */
function kidsOn(req) {
  return /(?:^|;\s*)mf_kids=1(?:;|$)/.test(String(req.headers.cookie || ''));
}
function kidsCookie(on) {
  return `mf_kids=${on ? '1' : ''}; SameSite=Lax; Path=/; Max-Age=${on ? 31536000 : 0}`;
}
function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(String(pin), salt, 32).toString('hex')}`;
}
const kidsFails = new Map();
function kidsBlocked(ip) {
  const r = kidsFails.get(ip);
  return !!r && r.until > Date.now();
}
function kidsFail(ip) {
  const r = kidsFails.get(ip) || { n: 0, until: 0 };
  r.n += 1;
  if (r.n >= 10) { r.until = Date.now() + 10 * 60 * 1000; r.n = 0; }
  kidsFails.set(ip, r);
}

function pinOk(pin, stored) {
  const [salt, want] = String(stored || '').split(':');
  if (!salt || !want) return false;
  try {
    const got = scryptSync(String(pin || ''), salt, 32).toString('hex');
    return timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(got, 'hex'));
  } catch { return false; }
}

// stream something twice and it lands in the library by itself
function maybeAutoDownload(trackId) {
  const threshold = Number(setting('auto_download_plays', '2')) || 0;
  if (!threshold) return;
  const owned = db.prepare("SELECT id FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(trackId);
  if (owned) return;
  const plays = db.prepare('SELECT COUNT(*) c FROM listens WHERE track_id=?').get(trackId).c;
  if (plays < threshold) return;
  const like = trackIdLike(trackId);
  const pending = db.prepare("SELECT id FROM jobs WHERE kind='track-download' AND state='running' AND (payload LIKE ? OR payload LIKE ?)").get(like.a, like.b);
  if (pending) return;
  const jobId = crypto.randomUUID();
  db.prepare('INSERT INTO jobs (kind,payload,state,created_at) VALUES (?,?,?,?)')
    .run('track-download', JSON.stringify({ jobId, trackId, auto: true }), 'running', now());
  const t = db.prepare('SELECT title, artist, duration FROM tracks WHERE id=?').get(trackId);
  resolveBest({ title: t.title, artist: t.artist, duration: t.duration }, 1800, { download: true })
    .then((best) => {
      if (!best) throw new Error('no source found');
      enqueueDownload(jobId, { trackId, rung: best.rung, id: best.id, url: best.url, thumb: best.thumb, file: best.handle?.file || best.file, title: t.title, artist: t.artist });
    })
    .catch(() => db.prepare('UPDATE jobs SET state=?,detail=?,finished_at=? WHERE payload LIKE ?')
      .run('error', 'auto download: no source', now(), `%${jobId}%`));
}

// ---------- likes ----------
function toggleLike(track_id, on) {
  if (on) db.prepare('INSERT OR IGNORE INTO likes (track_id, created_at) VALUES (?,?)').run(track_id, now());
  else db.prepare('DELETE FROM likes WHERE track_id=?').run(track_id);
}

// "%\"trackId\":1%" also matches track 10, so a busy track ten could block track one
const trackIdLike = (id) => ({ a: `%\"trackId\":${Number(id)},%`, b: `%\"trackId\":${Number(id)}}%` });

// shared: queue one track download from a plain row
function enqueueTrackDownload(t) {
  if (!t || !t.id) return false;
  const like = trackIdLike(t.id);
  const busy = db.prepare("SELECT id FROM jobs WHERE (state='queued' OR state='running') AND (payload LIKE ? OR payload LIKE ?)").get(like.a, like.b);
  if (busy) return false;
  const jobId = crypto.randomUUID();
  db.prepare('INSERT INTO jobs (kind,payload,state,progress,created_at) VALUES (?,?,?,0,?)')
    .run('track-download', JSON.stringify({ jobId, trackId: t.id, title: t.title, artist: t.artist }), 'queued', now());
  resolveBest({ title: t.title, artist: t.artist, duration: t.duration || null }, 1800, { download: true })
    .then((best) => {
      const payload = best
        ? { trackId: t.id, rung: best.rung, id: best.id, url: best.url, thumb: best.thumb, isrc: best.isrc,
            file: best.handle?.file || best.file, title: t.title, artist: t.artist, duration: t.duration }
        : { trackId: t.id, rung: 'search', title: t.title, artist: t.artist, duration: t.duration };
      enqueueDownload(jobId, payload);
    })
    .catch(() => {});
  return true;
}

// ---------- file consistency ----------
function verifyFiles({ requeue = true } = {}) {
  const all = db.prepare("SELECT id, track_id, path, COALESCE(external,0) external FROM files WHERE tier='owned'").all();
  // an adopted file belongs to the owner's folder: a USB drive that is not mounted is
  // not a lost file, and it must never be pruned or downloaded over
  const rows = all.filter((f) => !f.external);
  const external = all.length - rows.length;
  const missing = [];
  for (const f of rows) {
    if (!fs.existsSync(f.path)) missing.push(f);
  }
  // audio lives on a removable mount; if it is not up, every path "misses" and the old
  // code deleted the whole library. Refuse to act when the loss looks like a mount, not files.
  if (rows.length >= 10 && missing.length > rows.length * 0.2) {
    console.error('[files] refusing to prune: mount looks offline', `${missing.length}/${rows.length} missing`);
    return { checked: rows.length, missing: missing.length, queued: 0, tracks: [], external_skipped: external, aborted: 'mount offline' };
  }
  for (const f of missing) db.prepare('DELETE FROM files WHERE id=?').run(f.id);
  let queued = 0;
  if (requeue) {
    for (const f of missing) {
      const t = db.prepare('SELECT id, title, artist, duration FROM tracks WHERE id=?').get(f.track_id);
      if (t && enqueueTrackDownload(t)) queued += 1;
    }
  }
  if (missing.length) console.error('[files] cleared', missing.length, 'missing file rows, requeued', queued);
  return { checked: rows.length, missing: missing.length, queued, external_skipped: external, tracks: missing.map((f) => f.track_id) };
}

// ---------- download queue ----------
// What the phone actually asked for while the screen was off. A car failure leaves no
// trace on the device, so the server keeps the last few media requests with timings.
const mediaLog = [];
function logMedia(entry) {
  mediaLog.push(entry);
  while (mediaLog.length > 120) mediaLog.shift();
}

const downloadQueue = [];
let activeDownloads = 0;
const MAX_DOWNLOADS = Number(process.env.MUSICFY_DOWNLOAD_CONCURRENCY || 4);
// a datacenter IP often gets a slower route over IPv6 than over IPv4; -4 is one flag
const YTDLP_IPV4 = /^(1|true|yes)$/i.test(String(process.env.MUSICFY_YTDLP_IPV4 || ''));
// SoundCloud is far more forgiving of a server address than YouTube
const PREFER_SOUNDCLOUD = /^(1|true|yes)$/i.test(String(process.env.MUSICFY_PREFER_SOUNDCLOUD || ''));
// a flagged address needs a logged-in session for YouTube; yt-dlp takes a cookies.txt
const YTDLP_COOKIES = String(process.env.MUSICFY_YTDLP_COOKIES || '');
const cookieArgs = () => (YTDLP_COOKIES && fs.existsSync(YTDLP_COOKIES) ? ['--cookies', YTDLP_COOKIES] : []);
const netArgs = () => (YTDLP_IPV4 ? ['--force-ipv4'] : []);
// failures are reported for this run of the service only, not for all time
const BOOTED_AT = Math.floor(Date.now() / 1000);

// 'best' keeps whatever the source serves instead of transcoding to a lossy copy
function downloadFormat() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return s.preferred_format || 'best';
  } catch { return 'best'; }
}
function audioArgs() {
  const fmt = downloadFormat();
  // an mp4 container written without faststart needs its index fetched from the end
  // before a phone can start playing it: two round trips before the first note
  const fast = ['--postprocessor-args', 'ffmpeg:-movflags +faststart'];
  if (fmt === 'best') return ['-f', 'bestaudio/best', ...fast];
  return ['-x', '--audio-format', fmt, '--audio-quality', '0', ...(fmt === 'm4a' ? fast : [])];
}

function enqueueDownload(jobId, payload) {
  downloadQueue.push({ jobId, payload });
  pumpDownloads();
}

const cancelledJobs = new Set();
const runningChildren = new Map();   // jobId -> child process

function cancelDownload(jobId) {
  if (!jobId) return;
  cancelledJobs.add(jobId);
  const child = runningChildren.get(jobId);
  if (child) { try { child.kill('SIGKILL'); } catch {} }
}

function pumpDownloads() {
  while (activeDownloads < MAX_DOWNLOADS && downloadQueue.length) {
    const item = downloadQueue.shift();
    if (cancelledJobs.has(item.jobId)) {
      db.prepare("UPDATE jobs SET state='cancelled', finished_at=? WHERE payload LIKE ?").run(now(), `%${item.jobId}%`);
      continue;
    }
    // Two ingests for one track race on the same file: one installs it, the other finds
    // the row and deletes it as the "worse" copy. A queued duplicate waits its turn.
    const trackId = Number(item.payload && item.payload.trackId);
    if (trackId) {
      const like = trackIdLike(trackId);
      const runningTwin = db.prepare("SELECT id FROM jobs WHERE kind='track-download' AND state='running' AND (payload LIKE ? OR payload LIKE ?) LIMIT 1")
        .get(like.a, like.b);
      if (runningTwin) {
        db.prepare("UPDATE jobs SET state='skipped', detail=?, finished_at=?, progress=0 WHERE payload LIKE ?")
          .run(`duplicate of job ${runningTwin.id}`, now(), `%${item.jobId}%`);
        continue;
      }
    }
    activeDownloads += 1;
    db.prepare("UPDATE jobs SET state='running', updated_at=? WHERE payload LIKE ?").run(now(), `%${item.jobId}%`);
    try {
      startLadderDownload(item.jobId, item.payload, () => { activeDownloads -= 1; pumpDownloads(); });
    } catch (e) {
      activeDownloads -= 1;
      db.prepare("UPDATE jobs SET state='error', detail=?, finished_at=? WHERE payload LIKE ?")
        .run(String(e.message).slice(0, 160), now(), `%${item.jobId}%`);
    }
  }
}

// "DANGER ZONE - Radio Edit" is the same recording as "DANGER ZONE"; suffixes break matching
function cleanTitle(title) {
  return String(title || '')
    .replace(/\s*[-–—]\s*(?:radio edit|extended mix|original mix|club mix|dub mix|vocal mix|instrumental|remix|remaster(?:ed)?(?: \d{4})?|mix cut|mixed|edit|version|rework|bootleg|flip|vip)\b.*$/i, '')
    .replace(/\s*\((?:radio edit|extended mix|original mix|club mix|remix|remaster(?:ed)?|instrumental|edit|version)\)\s*$/i, '')
    .trim() || String(title || '');
}

// files are compared by codec first, then bitrate: a 254k mp3 made from 160k AAC is not better
function fileQuality(ext, bitrate) {
  const e = String(ext || '').toLowerCase();
  const br = Number(bitrate || 0) / 1000;
  if (e === '.flac' || e === '.wav') return 3000 + br;
  if (e === '.m4a' || e === '.aac' || e === '.opus' || e === '.ogg') return 2000 + br;
  return 1000 + br;
}

// ---------- ladder downloads ----------
function startLadderDownload(jobId, b, onDone) {
  // hash the full id: retry ids append '-r' and would otherwise share a directory
  const dir = path.join(OWNED, 'web', createHash('sha1').update(String(jobId)).digest('hex').slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  // a child can emit 'error' and then 'close', and a retry can call finish while the
  // cover fetch is still in flight: one attempt gets one completion, or the queue
  // advances twice and the concurrency counter goes negative
  let finished = false;
  let lastYtError = '';
  const finish = (state, detail) => {
    if (finished) return;
    finished = true;
    runningChildren.delete(jobId);
    if (cancelledJobs.has(jobId)) { state = 'cancelled'; detail = ''; }
    if (state === 'error' && lastYtError) detail = `${detail || 'download failed'} · ${lastYtError}`.slice(0, 260);
    db.prepare('UPDATE jobs SET state=?, detail=?, progress=?, finished_at=? WHERE payload LIKE ?')
      .run(state, detail || '', state === 'done' ? 100 : 0, now(), `%${jobId}%`);
    fs.rmSync(dir, { recursive: true, force: true });
    if (typeof onDone === 'function') { try { onDone(); } catch {} }
  };
  const setProgress = (pct) => {
    db.prepare('UPDATE jobs SET progress=?, updated_at=? WHERE payload LIKE ?').run(Math.max(0, Math.min(99, pct)), now(), `%${jobId}%`);
  };
  const watch = (child) => {
    const onChunk = (buf) => {
      const text = String(buf);
      const m = text.match(/(\d+(?:\.\d+)?)%/);
      if (m) setProgress(Number(m[1]));
      // keep the real extractor reason: "Sign in to confirm you're not a bot" is a
      // different problem from a missing format, and both used to say the same thing
      if (/(ERROR|Sign in|not a bot|unavailable|blocked|429|403)/i.test(text)) {
        lastYtError = text.trim().split('\n').filter(Boolean).slice(-1)[0].slice(0, 180);
      }
    };
    if (child.stdout) child.stdout.on('data', onChunk);
    if (child.stderr) child.stderr.on('data', onChunk);
  };
  let ingested = false;
  const ingestFrom = async (from) => {
    if (ingested) return;   // a retry path may call this after the file already landed
    ingested = true;
    // largest finished audio file: yt-dlp can still be renaming or deleting a
    // container while the process exits, so never trust a name read earlier
    const AUDIO = /\.(mp3|m4a|aac|opus|ogg|flac|wav|webm|mp4|m4b|mkv|aiff?)$/i;
    const pickAudio = () => {
      let names = [];
      // the work dir can be gone when a restart requeued this track mid-flight
      try { names = fs.readdirSync(from); } catch { return null; }
      return names
        .filter((f) => !f.startsWith('.') && !/\.part$/i.test(f) && AUDIO.test(f))
        .map((f) => { let size = 0; try { size = fs.statSync(path.join(from, f)).size; } catch {} return { f, size }; })
        .sort((x, y) => y.size - x.size)[0]?.f;
    };
    let name = pickAudio();
    if (!name) { ingested = false; return finish('error', 'no audio file produced'); }
    let fp = path.join(from, name);
    // Safari cannot play webm: convert the container before it enters the library
    if (['webm', 'mkv', 'ogg', 'opus', 'mp4', 'm4b', 'aac', 'wma'].includes((name.split('.').pop() || '').toLowerCase())) {
      const conv = fp.replace(/\.[^.]+$/, '') + '.m4a';
      try {
        await new Promise((resolve, reject) => {
          execFile(paths.FFMPEG, ['-v', 'error', '-y', '-i', fp, '-vn', '-c:a', 'aac', '-b:a', '256k', conv],
            { timeout: 900000, maxBuffer: 8 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()));
        });
        if (fs.existsSync(conv) && fs.statSync(conv).size > 10000) { try { fs.unlinkSync(fp); } catch {} fp = conv; name = path.basename(conv); }
      } catch {}
    }
    // the container may have been rotated under us mid-flight: re-read once
    if (!fs.existsSync(fp)) {
      name = pickAudio();
      if (!name) { ingested = false; return finish('error', 'audio file vanished before ingest'); }
      fp = path.join(from, name);
    }
    spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate:format_tags=title,artist', '-of', 'json', fp]).on('exit', () => {});
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate:format_tags=title,artist', '-of', 'json', fp], { timeout: 20000 }, (err, stdout) => {
      // never let a throw here strand the job in 'running' and leak a concurrency slot
      try {
      let dur = null, br = null, t = b.title || name, a = b.artist || '';
      try { const f = JSON.parse(stdout).format; dur = Number(f.duration); br = Number(f.bit_rate); t = f.tags?.title || t; a = f.tags?.artist || a; } catch {}
      let dest = path.join(OWNED, 'web', name.replace(/[/\\]/g, '_'));
      let tid = b.trackId;
      if (!tid) {
        // an existing row for the same track wins: prefer the one that already has playlists
        const match = db.prepare(`SELECT t.id, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.track_id=t.id) np
          FROM tracks t WHERE lower(t.title)=lower(?) AND lower(COALESCE(t.artist,''))=lower(?)
          ORDER BY np DESC, t.id ASC LIMIT 1`).get(t, a || '');
        if (match) {
          tid = match.id;
          db.prepare('UPDATE tracks SET src_kind=NULL, src_id=NULL, src_url=NULL WHERE id=?').run(tid);
        }
      }
      const ext = (name.split('.').pop() || 'mp3').toLowerCase();
      tid = tid || upsertTrack({ title: t, artist: a, album: b.artist || 'Web', duration: dur, format: ext });
      // Two sources can carry the same file name: never overwrite another track's audio.
      // A file with no row is an orphan from a rejected or interrupted job, and renaming
      // over it silently destroyed the track that owned the name.
      const owner = db.prepare('SELECT track_id FROM files WHERE path=? LIMIT 1').get(dest);
      if ((owner && owner.track_id !== tid) || (!owner && fs.existsSync(dest))) {
        dest = dest.replace(/(\.[^.]+)$/, ` [${tid}]$1`);
      }
      fs.renameSync(fp, dest);
      // refuse truncated audio: a 30 second preview must never replace a real track
      const declared = Number(b.duration) || Number(db.prepare('SELECT duration FROM tracks WHERE id=?').get(tid)?.duration) || 0;
      // two classes: a cover or a lesson is never the recording, while an official video or
      // a live upload is the same song in a video container, so it is only rejected once
      const sourceName = String(name || '');
      const hardBad = /\b(?:full|guitar|bass|drum|piano|acoustic|instrumental|metal|orchestral|sax|violin)\s+cover\b|\bcover\s+(?:by|version|of|song)\b|\(cover\)|\[cover\]|\(tabs?\)|\bkaraoke\b|\btutorial\b|\bbacking track\b/i.test(sourceName);
      const softBad = /\b(?:official (?:video|music video)|lyric video|visuali[sz]er|live|promo|teaser|trailer|interview|reaction)\b|\(mixed\)/i.test(sourceName);
      // one retry, same job row: the old '<id>-r' jobs had no row of their own, so the
      // original stayed at 'unavailable' and the UI never moved no matter the outcome
      const retryBySearch = (detail) => {
        try { fs.rmSync(dest, { force: true }); } catch {}
        finish('unavailable', detail);
        if (cancelledJobs.has(jobId)) return;
        try {
          db.prepare("UPDATE jobs SET state='queued', detail='retrying by search', progress=0, updated_at=? WHERE payload LIKE ?")
            .run(now(), `%${jobId}%`);
          enqueueDownload(jobId, { trackId: b.trackId, rung: 'search', title: b.title, artist: b.artist, duration: declared, retried: true });
        } catch {}
      };
      if (hardBad) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        return finish('unavailable', `not the recording: ${sourceName.slice(0, 44)}`);
      }
      if (softBad && b.trackId && !b.retried) {
        return retryBySearch(`video/promo source rejected (${sourceName.slice(0, 40)}), retrying by search`);
      }
      // One rule for selection and ingest: under 60% of the known length is a preview or a
      // clip, not the recording. An 80% floor rejected a legitimate 232s master of a track
      // listed as 294s and left the shelf empty, which is worse than a shorter version.
      if (dur && declared && dur < declared * 0.6) {
        // the source was a clip: try a plain search for the full version once
        if (!b.retried) return retryBySearch(`truncated audio: ${Math.round(dur)}s of ${Math.round(declared)}s, retrying by search`);
        try { fs.rmSync(dest, { force: true }); } catch {}
        return finish('unavailable', `truncated audio: ${Math.round(dur)}s of ${Math.round(declared)}s`);
      }
      // The floor had no ceiling: a 3 hour DJ set was a valid "version" of a 4 minute track.
      if (durationTooLong(declared, dur)) {
        if (!b.retried) return retryBySearch(`too long: ${Math.round(dur)}s of ${Math.round(declared)}s, retrying by search`);
        try { fs.rmSync(dest, { force: true }); } catch {}
        return finish('unavailable', `too long: ${Math.round(dur)}s of ${Math.round(declared)}s`);
      }
      if (dur && dur < 3) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        return finish('error', `clip too short: ${Math.round(dur)}s`);
      }

      // One file per track, and the better copy wins. A row can outlive its file (a prune
      // that ran before its mount was up, a rejected concurrent download), and comparing
      // against a missing "better" copy deleted the download that had just landed.
      const existingFiles = db.prepare("SELECT id, path, bitrate, COALESCE(external,0) external FROM files WHERE track_id=? AND tier='owned'").all(tid)
        .filter((f) => {
          if (fs.existsSync(f.path)) return true;
          db.prepare('DELETE FROM files WHERE id=?').run(f.id);
          return false;
        })
        .sort((a, b) => fileQuality(path.extname(b.path), b.bitrate) - fileQuality(path.extname(a.path), a.bitrate));
      const current = existingFiles[0];
      if (current && fileQuality(path.extname(current.path), current.bitrate) >= fileQuality(path.extname(dest), br)) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        finish('done', 'kept the higher quality copy that was already stored');
        return;
      }
      for (const f of existingFiles) {
        db.prepare('DELETE FROM files WHERE id=?').run(f.id);
        // the same source re-downloaded writes the same name: deleting it here
        // removed the copy that had just landed and left a row for a missing file
        if (path.resolve(f.path) === path.resolve(dest)) continue;
        // an adopted file is the owner's: forget the row, leave the bytes
        if (f.external) continue;
        try { fs.rmSync(f.path, { force: true }); } catch {}
      }
      upsertFile({ track_id: tid, path: dest, tier: 'owned', bitrate: br, size: fs.statSync(dest).size, mtime: now() });
      db.prepare('INSERT OR REPLACE INTO resolutions (track_id,rung,quality,resolved_at) VALUES (?,?,?,?)')
        .run(tid, b.rung || 'yt-dlp', br ? `${Math.round(br / 1000)}k` : '320k', now());
      if (b.isrc) db.prepare('UPDATE tracks SET isrc=? WHERE id=?').run(b.isrc, tid);
      const done = () => finish('done', `track ${tid}`);
      // prefer the album art embedded in the file over the source's video thumbnail
      if (fs.existsSync(coverFile(tid))) return done();
      (async () => {
        if (await extractCover(tid, dest)) return done();
        const albumRow = db.prepare('SELECT album FROM tracks WHERE id=?').get(tid);
        const album = (albumRow && albumRow.album) || b.album || '';
        let art = album ? await covers.artworkForAlbum(album, a || b.artist || '').catch(() => null) : null;
        if (!art) art = await covers.artworkFor(a || b.artist || '', t || b.title || '').catch(() => null);
        if (art && await saveThumb(art, tid)) return done();
        if (b.thumb && await saveThumb(b.thumb, tid)) return done();
        done();
      })().catch(done);
      } catch (e) {
        finish('error', String((e && e.message) || e).slice(0, 160));
      }
    });
  };
  const ingestDownloaded = () => ingestFrom(dir).catch((e) => finish('error', `ingest: ${String(e && e.message || e).slice(0, 160)}`));

  // a search hit that is a 30 second preview or a clip is not the recording. When the
  // queue knows the real length, reject anything under 60% of it at selection time, so
  // yt-dlp moves on to the next result instead of downloading a preview we then discard.
  const durationFloor = () => {
    const declared = Number(b.duration) || 0;
    return declared > 30 ? Math.floor(declared * 0.6) : 2;
  };
  // function scope: both the search path and the last-resort query use it
  const downloadCeiling = durationCeiling(Number(b.duration) || 0);
  if (b.rung === 'search') {
    const query = [b.artist, b.title].filter(Boolean).join(' ');
    // yt-dlp exits 101 when --max-downloads stops after the first hit, even though that
    // track downloaded fine. A finished audio file is the success signal, not the code.
    const gotAudio = () => fs.readdirSync(dir)
      .some((f) => !f.startsWith('.') && /\.(mp3|m4a|aac|opus|ogg|flac|wav)$/i.test(f) && !/\.part$/i.test(f));
    // skip covers and lessons while searching: the first hit for a track is often a
    // cover, and downloading it only to reject it left the track without audio
    // do not download past the ceiling in the first place: a 3 hour set for a 4 minute
    // track wasted the bandwidth and then failed the ingest check
    const NO_COVER = `duration > ${durationFloor()}${Number.isFinite(downloadCeiling) ? ` & duration < ${Math.floor(downloadCeiling)}` : ''} & title !~= "(?i)(cover|karaoke|tutorial|lesson|backing track|\\btabs?\\b)"`;
    const trySource = (source, next) => {
      const child = spawn(paths.YTDLP, [
        '--no-warnings', '--newline', ...audioArgs(), ...netArgs(), ...cookieArgs(),
        '--concurrent-fragments', '8', '--retries', '3', '--fragment-retries', '3',
        '--max-downloads', '1', '--match-filter', NO_COVER,
        '-o', path.join(dir, '%(title)s.%(ext)s'), source,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      watch(child);
      runningChildren.set(jobId, child);
      let settled = false;
      const settle = (fn) => { if (settled) return; settled = true; fn(); };
      child.on('error', () => settle(next));
      child.on('close', () => settle(() => (gotAudio() ? ingestDownloaded() : next())));
    };
    // five candidates each, filtered by title, first survivor wins. On a server address
    // YouTube answers with 429 long before it answers with audio, so SoundCloud can go first.
    const sources = PREFER_SOUNDCLOUD
      ? [`scsearch5:${query}`, `ytsearch5:${query}`]
      : [`ytsearch5:${query}`, `scsearch5:${query}`];
    const trySourceAt = (i) => {
      if (i >= sources.length) return finish('error', 'no source in search');
      trySource(sources[i], () => trySourceAt(i + 1));
    };
    trySourceAt(0);
    return;
  }

  if ((b.rung === 'yt-dlp' || b.rung === 'ytmusic' || b.rung === 'ytmusic-album') && b.id) {
    const yt = String(b.url || '').includes('watch')
      ? b.url
      : `https://www.youtube.com/watch?v=${b.id}`;
    const child = spawn(paths.YTDLP, [
      '--no-warnings', '--newline', ...audioArgs(), ...netArgs(), ...cookieArgs(),
      '--concurrent-fragments', '8', '--retries', '3', '--fragment-retries', '3',
      '-o', path.join(dir, '%(title)s.%(ext)s'), yt,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    watch(child);
    runningChildren.set(jobId, child);
    let settled = false;
    const settle = (fn) => { if (settled) return; settled = true; fn(); };
    child.on('error', (e) => settle(() => finish('error', String(e.message).slice(0, 200))));
    child.on('close', (code) => {
      if (code === 0) return settle(ingestDownloaded);
      settle(() => {
      // several YouTube videos only answer to a specific client, so walk the list
      const clients = ['android', 'ios', 'web_safari', 'tv'];
      const tryClient = (index) => {
        if (index >= clients.length) {
          // Last resort: search. This used to prefix an already prefixed query, so the
          // downloader was asked for "scsearch1:ytsearch1:Artist Title" and could never
          // find anything; the failure then reported the stale YouTube error.
          const base = [b.artist, b.title].filter(Boolean).join(' ').trim();
          let sawBotCheck = false;
          const tryQuery = (source, next) => {
            lastYtError = '';
            const retry = spawn(paths.YTDLP, [
              '--no-warnings', '--newline', ...audioArgs(), ...netArgs(), ...cookieArgs(),
              '--concurrent-fragments', '8', '--retries', '2', '--fragment-retries', '2',
              '--max-downloads', '1', '--match-filter', `duration > ${durationFloor()}${Number.isFinite(downloadCeiling) ? ` & duration < ${Math.floor(downloadCeiling)}` : ''}`,
              '-o', path.join(dir, '%(title)s.%(ext)s'), source,
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            watch(retry);
            runningChildren.set(jobId, retry);
            let retrySettled = false;
            const settleRetry = (fn) => { if (retrySettled) return; retrySettled = true; fn(); };
            retry.on('error', () => settleRetry(next));
            retry.on('close', () => settleRetry(() => {
              // same 101 quirk: judge by the file on disk, not the exit code
              const got = fs.readdirSync(dir).some((f) => /\.(mp3|m4a|aac|opus|ogg|flac|wav|webm|mp4)$/i.test(f) && !/\.part$/i.test(f));
              if (!got) {
                // a sign-in request is temporary: it is not the same as "no such track"
                if (/Sign in to confirm|not a bot/i.test(lastYtError)) sawBotCheck = true;
                return next();
              }
              ingestDownloaded();
            }));
          };
          // SoundCloud first: it answers a server address that YouTube wants a login for,
          // and its search handles the accented titles. YouTube is the last attempt.
          const plan = searchPlan(b.artist, b.title);
          const step = (i) => {
            if (i < plan.length) return tryQuery(plan[i], () => step(i + 1));
            // Every source failed. If YouTube asked for a sign-in, retry later instead of
            // marking the track permanently broken: the check clears, and a batch that
            // keeps hammering only makes it worse.
            const attemptNo = Number(b.ytRetry || 0);
            if (sawBotCheck && attemptNo < 2) {
              const minutes = 10 * (attemptNo + 1);
              finish('queued', `YouTube asked for a sign-in; retrying in ${minutes} min`);
              setTimeout(() => enqueueDownload(jobId, { ...b, ytRetry: attemptNo + 1 }), minutes * 60000);
              return;
            }
            finish('error', `yt-dlp exit ${code}, no source for "${base}"`);
          };
          step(0);
          return;
        }
        // the ladder used to transcode to mp3 whatever the owner had chosen
        lastYtError = '';
        const attempt = spawn(paths.YTDLP, [
          '--no-warnings', '--newline', ...audioArgs(), ...netArgs(), ...cookieArgs(),
          '--extractor-args', `youtube:player_client=${clients[index]}`,
          '-o', path.join(dir, '%(title)s.%(ext)s'), yt,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        watch(attempt);
        runningChildren.set(jobId, attempt);
        let attemptSettled = false;
        const settleAttempt = (fn) => { if (attemptSettled) return; attemptSettled = true; fn(); };
        attempt.on('error', () => settleAttempt(() => tryClient(index + 1)));
        attempt.on('close', (c) => settleAttempt(() => {
          if (c === 0) return ingestDownloaded();
          if (blockedByAddress(lastYtError)) return tryClient(clients.length);
          tryClient(index + 1);
        }));
      };
      tryClient(0);
      });
    });
  } else if (b.rung === 'soundcloud' && b.url) {
    setProgress(5);
    // the artist's own upload first (wav or flac, free and full quality), then aac 160
    soundcloud.originalUrl(b.url).then((orig) => {
      if (!orig) return null;
      return new Promise((resolve) => {
        https.get(orig, { headers: { 'user-agent': 'MUSICFY/1.0', ...soundcloud.authHeaders() }, timeout: 60000 }, (r) => {
          if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
            r.resume();
            return https.get(new URL(r.headers.location, orig).toString(), { timeout: 120000, headers: { 'user-agent': 'MUSICFY/1.0' } }, (r2) => {
              if (r2.statusCode !== 200) { r2.resume(); return resolve(false); }
              const ct = String(r2.headers['content-type'] || '');
              const ext = /flac/.test(ct) ? '.flac' : /wav/.test(ct) ? '.wav' : /aiff/.test(ct) ? '.aiff' : '.mp3';
              const fp = path.join(dir, `soundcloud-original${ext}`);
              const out = fs.createWriteStream(fp);
              r2.pipe(out);
              out.on('finish', () => { out.close(); resolve(true); });
              out.on('error', () => resolve(false));
            }).on('error', () => resolve(false));
          }
          if (r.statusCode !== 200) { r.resume(); return resolve(false); }
          const ct = String(r.headers['content-type'] || '');
          const ext = /flac/.test(ct) ? '.flac' : /wav/.test(ct) ? '.wav' : /aiff/.test(ct) ? '.aiff' : '.mp3';
          const fp = path.join(dir, `soundcloud-original${ext}`);
          const out = fs.createWriteStream(fp);
          r.pipe(out);
          out.on('finish', () => { out.close(); resolve(true); });
          out.on('error', () => resolve(false));
        }).on('error', () => resolve(false));
      });
    }).then((gotOriginal) => {
      if (gotOriginal) { setProgress(80); return ingestDownloaded(); }
      return soundcloudFallbackDownload(b, dir, finish, ingestDownloaded, setProgress);
    }).catch(() => soundcloudFallbackDownload(b, dir, finish, ingestDownloaded, setProgress));
  } else if ((b.rung === 'bandcamp' || b.rung === 'generic') && (b.url || b.id)) {
    execFile(paths.YTDLP,
      ['--no-warnings', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '-o', path.join(dir, '%(title)s.%(ext)s'), b.url || b.id],
      { timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
        if (err) return finish('error', String(err.message).slice(0, 200));
        ingestDownloaded();
      });
  } else if (b.rung === 'archive' && b.file) {
    const dest = path.join(dir, path.basename(b.file));
    const to = fs.createWriteStream(dest);
    https.get(b.file, (r) => { r.pipe(to); to.on('finish', () => to.close(ingestDownloaded)); }).on('error', (e) => finish('error', e.message));
  } else {
    finish('error', 'unknown rung');
  }
}

// best ladder candidate for a seed: shared by per-track and playlist downloads
async function resolveBest(seed, cap = 1800, opts = {}) {
  // ask the catalogue who this is first: exact title, artist and length make every
  // later filter meaningful. iTunes answers in half a second, MusicBrainz does not.
  let canon = null;
  const baseTitle = cleanTitle(seed.title);
  try { canon = await identity.canon(seed.artist || '', baseTitle); } catch {}
  const wantsRemaster = /\bremaster(ed)?\b/i.test(String(seed.title || ''));
  const searchSeed = {
    ...seed,
    artist: (canon && canon.artist) || seed.artist,
    title: titleForVersion(seed.title, baseTitle, canon && canon.title),
    wantsRemaster,
  };

  const [yt, sc, ia] = await Promise.all([
    ytdlp.searchYoutube(searchSeed, { limit: 6 }).catch(() => []),
    ytdlp.searchSoundcloud(searchSeed, { limit: 5 }).catch(() => []),
    archive.searchArchive(searchSeed, { limit: 4 }).catch(() => []),
  ]);
  let canonical = null;
  try { canonical = await mb.lookup(searchSeed.artist, searchSeed.title); } catch {}
  // the library's own duration is the version the person asked for; a canonical remaster
  // can be several seconds longer (Nebulous: 6:33 vs 7:06)
  const expected = seed.duration || (canon && canon.duration) || (canonical && canonical.duration) || null;

  const scored = [...yt, ...sc, ...ia]
    .map((c) => {
      if (c.rung === 'yt-dlp' && c.id) c.thumb = `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`;
      if (c.rung === 'archive' && c.id) c.thumb = `https://archive.org/services/img/${c.id}`;
      return { ...c, ...scoreCandidate(c, searchSeed) };
    })
    .filter((c) => c.score > 0 && (!cap || !c.duration || c.duration <= cap))
    // downloads skip SoundCloud: most tracks are DRM protected now and stall the job
    .filter((c) => !opts.download || c.rung !== 'soundcloud')
    .filter((c) => !(c.rung === 'archive' && !c.duration))   // whole collections, not tracks
    // one rule, shared with the ingest guard and the rescue sweep
    .filter((c) => durationFits(expected, c.duration))
    .map((c) => ({ ...c, isrc: (canonical && canonical.isrc) || null, verified: !!(expected && c.duration && Math.abs(c.duration - expected) <= 4) }))
    .sort((a, b) => {
      const near = (x) => (expected && x.duration ? Math.abs(x.duration - expected) : 9999);
      // SoundCloud now DRMs a large share of tracks. Use it only when nothing else
      // matched, so a download does not start with a source that will fail.
      const src = (x) => (x.rung === 'soundcloud' ? -1 : 0);
      return src(b) - src(a) || b.score - a.score || near(a) - near(b) || QUALITY_RANK(b) - QUALITY_RANK(a);
    });
  if (scored.length) return scored[0];

  // nothing matched with the artist attached: sweep by title and judge on length alone
  try {
    const loose = await ytdlp.searchYoutube({ title: searchSeed.title, artist: '' }, { limit: 8 }).catch(() => []);
    const want = expected || seed.duration || null;
    const viable = loose
      // the artist is not in the query any more, so require it in the result
      .filter((c) => artistInCandidate(searchSeed.artist, c))
      .filter((c) => c.duration && durationFits(want, c.duration))
      .sort((a, b) => Math.abs((a.duration || 0) - (want || a.duration || 0)) - Math.abs((b.duration || 0) - (want || b.duration || 0)));
    if (viable[0]) return { ...viable[0], score: 30, verified: !!want };
  } catch {}

  return null;
}

// ---------- HTTP ----------
// library JSON is ~900 KB raw: gzip takes it to ~70 KB, which is the difference between
// a usable and an unusable phone on a mobile link
const jsonGzip = new Map();
function compressJson(body) {
  const key = body.length + ':' + require('node:crypto').createHash('md5').update(body).digest('hex');
  if (jsonGzip.has(key)) return jsonGzip.get(key);
  const gz = zlib.gzipSync(body, { level: 5 });
  if (jsonGzip.size > 8) jsonGzip.clear();
  jsonGzip.set(key, gz);
  return gz;
}

// A 5xx is our problem, not the client's: log the real reason, return a sentence. An
// SQLite message or a full node path in a response is an information leak, not a service.
const serverError = (res, e, where) => {
  console.error(`[error] ${where}:`, (e && e.message) || e);
  if (res.headersSent || res.writableEnded) { try { res.destroy(); } catch {} return res; }
  return json(res, 500, { error: 'the server could not complete that request' });
};

/* A body handler is a promise the HTTP layer never awaits. An exception inside one used
   to reject silently: the process logged it and the request hung until the client gave up.
   Every handler now goes through this, so a failure is an answer. */
function onEnd(req, res, fn) {
  req.on('end', () => {
    Promise.resolve().then(fn).catch((err) => {
      try { serverError(res, err, req.url); } catch {}
    });
  });
}
const upstreamError = (res, e, where) => {
  console.error(`[upstream] ${where}:`, (e && e.message) || e);
  return json(res, 502, { error: 'the external service did not answer' });
};

const json = (res, code, obj) => {
  if (res.headersSent || res.writableEnded) return res;
  const body = Buffer.from(JSON.stringify(obj));
  const ae = String((res.req && res.req.headers['accept-encoding']) || '');
  const wantGzip = body.length > 1024 && /\bgzip\b/.test(ae);
  const out = wantGzip ? compressJson(body) : body;
  const headers = { 'content-type': 'application/json', 'content-length': out.length, vary: 'Accept-Encoding', 'cache-control': 'no-store' };
  if (wantGzip) headers['content-encoding'] = 'gzip';
  res.writeHead(code, headers);
  res.end(out);
};

const AUTH_TOKEN = String(process.env.MUSICFY_TOKEN || '');
const ALLOWED_ORIGINS = String(process.env.MUSICFY_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// one definition of "the tracks in this playlist, in order", shared by both read routes
function playlistRows(pid) {
  return db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, pt.added_at date_added, f.bitrate, r.rung, r.quality
    FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
    LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
    LEFT JOIN resolutions r ON r.track_id=t.id
    WHERE pt.playlist_id=? ORDER BY pt.position`).all(pid);
}

function dupFold(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// What counts as the same recording: identical artist and title, the same album (or a
// blank one on either side), and a length within three seconds. Versions differ in the
// title ("... (Remastered 2006)") or the length and are left alone on purpose.
function duplicatePlan() {
  const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.duration,
      (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned,
      (SELECT MAX(f.bitrate) FROM files f WHERE f.track_id=t.id AND f.tier='owned') bitrate,
      (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.track_id=t.id) used
    FROM tracks t`).all();
  const byKey = new Map();
  for (const r of rows) {
    if (!dupFold(r.title)) continue;                 // "(untitled)" rows are not all one song
    const k = `${dupFold(r.artist)}|${dupFold(r.title)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const groups = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (b.owned - a.owned) || ((b.bitrate || 0) - (a.bitrate || 0)) || (b.used - a.used) || (a.id - b.id));
    const keep = list[0];
    const merge = [];
    for (const d of list.slice(1)) {
      const aa = dupFold(keep.album);
      const ab = dupFold(d.album);
      if (aa && ab && aa !== ab) continue;                 // single vs album is not a duplicate
      const ka = Number(keep.duration) || 0;
      const kb = Number(d.duration) || 0;
      if (ka && kb && Math.abs(ka - kb) > 3) continue;     // a different recording
      merge.push(d);
    }
    if (merge.length) groups.push({ keep, merge, title: keep.title, artist: keep.artist, album: keep.album });
  }
  // how many same-name families are versions rather than duplicates: reported, never
  // touched, so "nothing removed" has an explanation
  const base = (x) => dupFold(String(x || '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+-\s+.*$/, ' '));
  const families = new Map();
  for (const r of rows) {
    if (!base(r.title)) continue;
    const k = `${dupFold(r.artist)}|${base(r.title)}`;
    if (!families.has(k)) families.set(k, new Set());
    families.get(k).add(dupFold(r.title));
  }
  const versions = [...families.values()].filter((set) => set.size > 1).length;

  const extra = [];
  const files = db.prepare("SELECT id, track_id, path, bitrate, COALESCE(external,0) external FROM files WHERE tier='owned'").all();
  const perTrack = new Map();
  for (const f of files) {
    if (!perTrack.has(f.track_id)) perTrack.set(f.track_id, []);
    perTrack.get(f.track_id).push(f);
  }
  for (const [trackId, list] of perTrack) {
    if (list.length < 2) continue;
    list.sort((a, b) => fileQuality(path.extname(b.path), b.bitrate) - fileQuality(path.extname(a.path), a.bitrate));
    for (const f of list.slice(1)) extra.push({ ...f, track_id: trackId });
  }
  return { groups, extra, versions };
}

function applyDuplicatePlan(plan) {
  const paths = [];
  let removed = 0, filesRemoved = 0;
  db.exec('BEGIN');
  try {
    for (const g of plan.groups) {
      const keep = g.keep;
      for (const dupe of g.merge) {
        const dupeFiles = db.prepare('SELECT id, path, COALESCE(external,0) external FROM files WHERE track_id=?').all(dupe.id);
        db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
        db.prepare('DELETE FROM playlist_tracks WHERE track_id=?').run(dupe.id);
        db.prepare('UPDATE OR IGNORE likes SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
        db.prepare('DELETE FROM likes WHERE track_id=?').run(dupe.id);
        db.prepare('UPDATE listens SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
        db.prepare('UPDATE OR IGNORE resolutions SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
        db.prepare('DELETE FROM resolutions WHERE track_id=?').run(dupe.id);
        db.prepare('DELETE FROM files WHERE track_id=?').run(dupe.id);
        db.prepare('DELETE FROM tracks WHERE id=?').run(dupe.id);
        for (const f of dupeFiles) if (!f.external) paths.push(f.path);
        removed += 1;
      }
    }
    for (const f of plan.extra) {
      db.prepare('DELETE FROM files WHERE id=?').run(f.id);
      if (!f.external) paths.push(f.path);
      filesRemoved += 1;
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
  for (const p of paths) { try { fs.unlinkSync(p); } catch {} }
  return { groups: plan.groups.length, removed, files: filesRemoved };
}

const loginAttempts = new Map();
function loginKey(req) { return String(req.socket.remoteAddress || 'unknown'); }
function loginBlocked(req) {
  const row = loginAttempts.get(loginKey(req));
  if (!row) return false;
  if (Date.now() > row.reset) { loginAttempts.delete(loginKey(req)); return false; }
  return row.count >= 10;
}
function loginFailed(req) {
  const k = loginKey(req);
  const row = loginAttempts.get(k) || { count: 0, reset: Date.now() + 10 * 60 * 1000 };
  row.count += 1;
  loginAttempts.set(k, row);
}
function loginClear(req) { loginAttempts.delete(loginKey(req)); }
function tokenEqual(a, b) {
  const x = createHash('sha256').update(String(a || '')).digest();
  const y = createHash('sha256').update(String(b || '')).digest();
  return timingSafeEqual(x, y);
}
function safeNext(value) {
  const n = String(value || '/');
  return n.startsWith('/') && !n.startsWith('//') ? n : '/';
}
function htmlEscape(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function loginLang(req, u) {
  const q = String(u.searchParams.get('lang') || '').toLowerCase();
  if (q.startsWith('pt')) return 'pt-BR';
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  return al.startsWith('pt') ? 'pt-BR' : 'en';
}
function loginPage(error = '', next = '/', lang = 'en') {
  const L = lang === 'pt-BR' ? {
    title: 'Entrar no MUSICFY', heading: 'Entrar', intro: 'Digite a senha da loja para abrir a biblioteca.',
    password: 'Senha', button: 'Abrir MUSICFY', wrong: 'Senha incorreta.',
    tooMany: 'Muitas tentativas. Tente novamente em alguns minutos.',
  } : {
    title: 'MUSICFY login', heading: 'Sign in', intro: 'Enter the store password to open the library.',
    password: 'Password', button: 'Open MUSICFY', wrong: 'Wrong password.',
    tooMany: 'Too many attempts. Try again in a few minutes.',
  };
  const shown = error === 'wrong' ? L.wrong : error === 'too-many' ? L.tooMany : error;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${L.title}</title>
<style>
  :root { color-scheme: dark; --bg:#0a0a0b; --card:#121214; --line:rgba(255,255,255,.08); --fg:#f5f4f0; --soft:rgba(245,244,240,.62); --mute:rgba(245,244,240,.5); --acc:#ff5c39; --on:#140a07; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:20px; background:radial-gradient(60% 50% at 20% 0%, rgba(255,92,57,.12), transparent 70%), var(--bg); color:var(--fg); font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { width:min(100%,380px); background:var(--card); border:1px solid var(--line); border-radius:16px; padding:24px; box-shadow:0 24px 70px rgba(0,0,0,.55); }
  .brand { font-weight:700; letter-spacing:-.04em; font-size:26px; margin-bottom:22px; }
  .brand span { color:var(--acc); }
  h1 { font-size:18px; margin:0 0 6px; letter-spacing:-.01em; }
  p { margin:0 0 18px; color:var(--soft); font-size:13px; }
  label { display:block; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--mute); }
  input { width:100%; min-height:44px; margin-top:6px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:#0a0a0b; color:var(--fg); font:inherit; }
  input:focus { outline:none; border-color:var(--acc); box-shadow:0 0 0 3px rgba(255,92,57,.14); }
  button { width:100%; min-height:44px; margin-top:16px; border:0; border-radius:99px; background:var(--acc); color:var(--on); font:600 14px/1 inherit; cursor:pointer; }
  button:hover { filter:brightness(1.08); }
  .err { margin:14px 0 0; color:#ff9a86; font-size:13px; }
</style></head><body><main>
  <div class="brand">MUSIC<span>FY</span></div>
  <h1>${L.heading}</h1>
  <p>${L.intro}</p>
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${htmlEscape(next)}">
    <label>${L.password}<input name="password" type="password" autocomplete="current-password" autofocus required></label>
    <button type="submit">${L.button}</button>
  </form>
  ${shown ? `<p class="err">${htmlEscape(shown)}</p>` : ''}
</main></body></html>`;
}
function sendLogin(res, error = '', next = '/', status = 200, lang = 'en') {
  const body = loginPage(error, next, lang);
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
  res.end(body);
}
function readFormBody(req, limit = 4096) {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { try { req.destroy(); } catch {} resolve(''); return; }
      body += c;
    });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(''));
  });
}
function authCookie(token, secure) {
  return `mf_auth=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure ? '; Secure' : ''}`;
}
function isSecure(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.socket.encrypted) || proto === 'https';
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'geolocation=(), camera=(), microphone=()');
  // no inline scripts, no third-party script, no framing. Styles may be inline because the
  // client draws with style attributes; nothing else is relaxed.
  res.setHeader('content-security-policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https:",
    "font-src 'self' data:",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  // a throw inside a req.on('end') callback escapes the async try below and strands the
  // socket with no response. Wrap every 'end' listener so a bad body answers 400, never hangs.
  const _on = req.on.bind(req);
  req.on = (ev, fn) => _on(ev, ev === 'end'
    ? (...a) => { try { return fn(...a); } catch (e) { try { if (!res.headersSent) json(res, 400, { error: String((e && e.message) || e) }); else res.end(); } catch {} } }
    : fn);

  // --- optional shared-secret auth (inert unless MUSICFY_TOKEN is set) ---
  if (AUTH_TOKEN) {
    const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)mf_auth=([^;]+)/);
    let cookieToken = '';
    try { cookieToken = cookie ? decodeURIComponent(cookie[1]) : ''; } catch { cookieToken = cookie ? cookie[1] : ''; }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const qtoken = u.searchParams.get('token') || '';
    const next = safeNext(u.searchParams.get('next') || (req.method === 'GET' ? u.pathname : '/'));
    const authed = (cookieToken && tokenEqual(cookieToken, AUTH_TOKEN)) || tokenEqual(bearer, AUTH_TOKEN) || tokenEqual(qtoken, AUTH_TOKEN);

    if (u.pathname === '/login') {
      if (req.method === 'GET') {
        if (authed) {
          const headers = { location: '/', 'cache-control': 'no-store' };
          if (qtoken && tokenEqual(qtoken, AUTH_TOKEN)) headers['set-cookie'] = authCookie(AUTH_TOKEN, isSecure(req));
          res.writeHead(302, headers);
          return res.end();
        }
        return sendLogin(res, '', next, 200, loginLang(req, u));
      }
      if (req.method === 'POST') {
        if (loginBlocked(req)) return sendLogin(res, 'too-many', next, 429, loginLang(req, u));
        const form = new URLSearchParams(await readFormBody(req));
        const want = safeNext(form.get('next') || '/');
        if (tokenEqual(form.get('password') || '', AUTH_TOKEN)) {
          loginClear(req);
          res.writeHead(302, { 'set-cookie': authCookie(AUTH_TOKEN, isSecure(req)), location: want, 'cache-control': 'no-store' });
          return res.end();
        }
        loginFailed(req);
        return sendLogin(res, 'wrong', want, 401, loginLang(req, u));
      }
      res.writeHead(405, { allow: 'GET, POST' }); return res.end();
    }

    if (!authed) {
      if (u.pathname.startsWith('/api/')) return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
        const back = safeNext(u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : ''));
        res.writeHead(302, { location: `/login?next=${encodeURIComponent(back)}`, 'cache-control': 'no-store' });
        return res.end();
      }
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('unauthorized');
    }
    if (qtoken && tokenEqual(qtoken, AUTH_TOKEN)) {
      u.searchParams.delete('token');
      const clean = u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
      res.writeHead(302, { 'set-cookie': authCookie(AUTH_TOKEN, isSecure(req)), location: clean });
      return res.end();
    }
  }

  // --- CSRF: cross-site form POSTs carry an Origin that does not match this host ---
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      let oh = '';
      try { oh = new URL(origin).hostname.toLowerCase(); } catch { oh = ''; }
      const hosts = [req.headers.host, req.headers['x-forwarded-host']]
        .filter(Boolean).map((s) => String(s).split(':')[0].toLowerCase());
      if (!oh || (!hosts.includes(oh) && !ALLOWED_ORIGINS.includes(origin))) {
        return json(res, 403, { error: 'cross-origin request blocked' });
      }
    }
  }

  // --- body cap: an upload is streamed to disk and is not capped. Every other write is. ---
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const isUpload = u.pathname === '/api/upload/track' || /\/cover$/.test(u.pathname);
    const cap = isUpload ? Infinity : 4 * 1024 * 1024;
    let bytes = 0;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > cap) {
        try { if (!res.headersSent) json(res, 413, { error: 'body too large' }); } catch {}
        try { req.destroy(); } catch {}
      }
    });
  }

  try {
    if (u.pathname === '/health') return json(res, 200, { ok: true, uptime: process.uptime() });

    // static player (never cached: single-user dev flow, bust by content)
    // the shell's asset URLs carry the running version, so a new release is a new cache
    // key: a service worker cannot keep serving the previous bundle after an update
    if (u.pathname === '/' || u.pathname === '/index.html') {
      // one writeHead: setting a header after writeHead threw inside the route and the
      // error path could not answer, so the home page hung while every API answered
      const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
        .replace(/\?v=[\w.]+/g, `?v=${encodeURIComponent(APP_VERSION)}`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(html);
    }
    if (u.pathname === '/app.css') {
      const body = fs.readFileSync(path.join(WEB, 'app.css'));
      return sendStatic(req, res, body, 'text/css; charset=utf-8');
    }
    if (u.pathname === '/app.js') {
      const body = fs.readFileSync(path.join(WEB, 'app.js'));
      return sendStatic(req, res, body, 'text/javascript; charset=utf-8');
    }
    if (u.pathname === '/i18n.js') {
      const body = fs.readFileSync(path.join(WEB, 'i18n.js'));
      return sendStatic(req, res, body, 'text/javascript; charset=utf-8');
    }
    if (u.pathname === '/sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/' });
      return res.end(fs.readFileSync(path.join(WEB, 'sw.js')));
    }
    if (u.pathname === '/manifest.webmanifest') {
      res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(WEB, 'manifest.webmanifest')));
    }
    if (u.pathname === '/icon.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
      return res.end(fs.readFileSync(path.join(WEB, 'icon.svg')));
    }

    if ((u.pathname === '/api/search/ladder' || u.pathname === '/api/ask' || u.pathname === '/api/agent') && !allow(req, u.pathname)) {
      return json(res, 429, { error: 'slow down', retry_after: 60 });
    }
    if (u.pathname === '/api/search/ladder') {
      const q = (u.searchParams.get('q') || '').trim();
      if (q.length < 2) return json(res, 400, { error: 'query too short' });
      const cacheKey = `${q}|${u.searchParams.get('limit') || ''}|${u.searchParams.get('durCap') || ''}|${u.searchParams.get('seedDur') || ''}`;
      const cachedLadder = ladderCache.get(cacheKey);
      if (cachedLadder && cachedLadder.exp > Date.now()) {
        return json(res, 200, { ...cachedLadder.payload, cached: true });
      }
      let artist = '', title = q;
      const m = q.match(/^(.+?)\s+-\s+(.+)$/);
      if (m) { artist = m[1]; title = m[2]; } else { artist = q; }
      const seed = { title, artist, duration: Number(u.searchParams.get('seedDur')) || null };
      const cap = Number(u.searchParams.get('durCap')) || 0;

      // sovereign rungs only: yt-dlp (YouTube) + SoundCloud + Internet Archive. No accounts anywhere.
      const artistOnly = !/\s+-\s+/.test(q);
      const lim = artistOnly ? { ytm: 60, sc: 25, ia: 20 } : { ytm: 40, sc: 16, ia: 14 };
      // ask the catalogue who this actually is before ranking anything
      let canonical = null;
      try {
        const qa = q.match(/^(.+?)\s+-\s+(.+)$/);
        canonical = qa ? await identity.canon(qa[1], qa[2]) : await identity.canonQuery(q);
      } catch {}
      if (canonical && canonical.duration) {
        seed.duration = seed.duration || canonical.duration;
        for (const c of []) { /* noop */ }
      }

      // your own library knows the artist, duration and often the ISRC already
      const qn = normalize(q);
      const libraryHits = db.prepare(`SELECT id, title, artist, album, duration, isrc, bpm, key,
        (SELECT COUNT(*) FROM files f WHERE f.track_id=tracks.id AND f.tier='owned') has_file
        FROM tracks
        WHERE lower(title) LIKE ? OR lower(COALESCE(artist,'')) LIKE ?
        ORDER BY (lower(title) = ?) DESC, (lower(COALESCE(artist,'')) = ?) DESC, length(title) ASC
        LIMIT 8`).all(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, q.toLowerCase(), q.toLowerCase());

      // if the query names something we own, trust those rows as the canonical answer
      const ownedCanonical = libraryHits.find((t) => t.duration) || null;
      if (ownedCanonical) {
        seed.artist = ownedCanonical.artist || seed.artist;
        seed.duration = ownedCanonical.duration || seed.duration;
      }

      const [yt, sc, ia] = await Promise.all([
        ytdlp.searchYouTubeMusic(q, { limit: lim.ytm }).catch(() => []),
        ytdlp.searchSoundcloud(seed, { limit: lim.sc }).catch(() => []),
        archive.searchArchive(seed, { limit: lim.ia }).catch(() => []),
      ]);

      // only the music.youtube.com catalogue: the plain youtube sweep was the source of random uploads
      for (const c of yt) {
        const up = String(c.artist || c.uploader || '');
        c.official = /-\s*Topic$/i.test(up) || /vevo$/i.test(up);
      }
      const all = [...yt, ...sc, ...ia]
        .map((c) => {
          // thumbnails: youtube mqdefault, archive item image
          if (c.rung === 'yt-dlp' && c.id) c.thumb = `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`;
          if (c.rung === 'archive' && c.id) c.thumb = `https://archive.org/services/img/${c.id}`;
          if (c.rung === 'ytmusic' && c.id) c.thumb = `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`;
          const scored = scoreCandidate(c, seed);
          const words = String(c.title || '').split(/\s+/).length;
          if (c.official && words <= 8) scored.score += 18;   // label audio and a track length title

          // a remix or bootleg is not the track that was asked for
          const qLow = normalize(q);
          const tLow = normalize(c.title || '');
          const wantsEdit = /remix|edit|flip|bootleg|vip|mashup|cover|refix|rework/.test(qLow);
          const isEdit = /remix|edit|flip|bootleg|vip|mashup|cover|refix|rework/.test(tLow);
          if (isEdit && !wantsEdit) scored.score -= 30;

          // the candidate now knows its own artist, so reward agreement with the query
          const qWords = new Set(qLow.split(' ').filter((w) => w.length > 2));
          const aWords = new Set(normalize(c.artist || c.channel || '').split(' ').filter((w) => w.length > 2));
          let overlap = 0;
          for (const w of aWords) if (qWords.has(w)) overlap += 1;
          if (aWords.size) {
            scored.score += Math.min(overlap, 3) * 12;
            if (!overlap) scored.score -= 22;
            scored.artist_match = overlap > 0;
          }
          return { ...c, ...scored };
        })
        .filter((c) => c.score > 0)
        .filter((c) => {
          if (c.rung === 'archive') return true;
          const title = String(c.title || c.filename || '');
          const low = title.toLowerCase();
          // things that are videos about music rather than music
          if (/\b(lyrics?|lyric video|official video|video|interview|news|documentary|reaction|tutorial|podcast|episode|radio show|tribute|karaoke|unboxing|review|breakdown|behind the scenes|the making of|making of|story of|explained|sessions?|live at|concert|full album|mixtape|compilation|mix)\b/.test(low)) return false;
          if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(title)) return false;
          if (title.length > 90 && title === title.toUpperCase()) return false;
          // 30 second previews and stingers are not the track
          if (c.duration && c.duration < 3) return false;
          // an artist query should match the start of the title, not appear anywhere
          if (artistOnly && (c.rung === 'yt-dlp' || c.rung === 'ytmusic') && !c.official) {
            // random uploads only pass if the artist literally leads the title
            const n0 = normalize(c._rawTitle || title);
            const a0 = normalize(q);
            if (a0 && !n0.startsWith(a0) && !n0.startsWith('the ' + a0)) return false;
          }
          if (artistOnly) {
            const n = normalize(c._rawTitle || title);
            const a = normalize(q);
            const byUploader = normalize(c.artist || c.uploader || '');
            // the artist must lead the title, or be the uploader; "someone else - artist" is not their track
            if (a && !(n.startsWith(a) || n.startsWith('the ' + a) || byUploader.startsWith(a))) return false;
          }
          return true;
        })
        .map((c) => {
          if (!c.artist || c.artist === 'NA') {
            const dash = String(c.title || '').match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
            const comma = String(c.title || '').match(/^(.{2,40}?)\s*,\s*(.{2,})$/);
            if (dash) { c.artist = dash[1].trim(); c.title = dash[2].trim(); }
            else if (comma) { c.artist = comma[1].trim(); c.title = comma[2].trim(); }
            else c.artist = '';
          }
          return c;
        })
        .sort((a, b) => b.score - a.score || QUALITY_RANK(b) - QUALITY_RANK(a))
        .slice(0, 40);

      // when the query names an artist and several candidates carry that artist,
      // drop the ones by other people entirely
      const strong = all.filter((c) => c.artist_match);
      let relevant = strong.length >= 3 ? all.filter((c) => c.artist_match || !c.artist || c.score >= 45) : all;
      // never hand back a thin list: if the strict pass leaves too little, show everything again
      if (relevant.length < 8) relevant = all.slice();

      const filtered = cap ? relevant.filter((c) => !c.duration || c.duration <= cap) : relevant;
      // dedupe: same normalized title and near-identical duration across rungs collapses to the best-scored copy
      const seen = new Set();
      const deduped = [];
      for (const c of filtered) {
        const key = `${normalize(c.title || c.filename || '')}|${Math.round((c.duration || 0) / 5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(c);
      }
      // albums you own, plus archive collections (they hold whole track lists)
      const albums = db.prepare(`SELECT album AS name, artist, COUNT(*) n FROM tracks
        WHERE album IS NOT NULL AND album != '' AND lower(album) LIKE ?
        GROUP BY album ORDER BY n DESC LIMIT 8`).all(`%${q.toLowerCase()}%`);
      const archiveAlbums = deduped.filter((c) => c.rung === 'archive').slice(0, 8)
        .map((c) => ({ name: c.title, artist: c.artist, id: c.id, kind: 'archive' }));
      // mark candidates whose length agrees with the catalogue
      if (canonical && canonical.duration) {
        for (const c of deduped) {
          if (!c.duration) continue;
          const delta = Math.abs(c.duration - canonical.duration);
          c.duration_delta = Math.round(delta);
          c.verified = delta <= 4;
        }
      }

      // verify the top candidates against MusicBrainz and carry the ISRC to the UI
      await Promise.all(deduped.slice(0, 3).map(async (c) => {
        if (!c.artist || !c.title) return;
        try {
          const mbd = await mb.lookup(c.artist, c.title);
          if (!mbd) return;
          if (mbd.isrc) c.isrc = mbd.isrc;
          if (mbd.duration && c.duration) {
            c.duration_delta = Math.round(Math.abs(mbd.duration - c.duration));
            c.verified = c.duration_delta <= 4;
          }
        } catch {}
      }));

      // the catalogue section: what a music app would show, independent of what the web has
      let catalogue = { songs: [], albums: [], artists: [] };
      try { catalogue = await identity.catalog(q, { songs: 40, albums: 12, artists: 6 }); } catch {}

      const payload = {
        query: q, normalized: normalize(q), results: deduped.slice(0, 80), artistOnly,
        catalogue,
        canonical: canonical ? { title: canonical.title, artist: canonical.artist, album: canonical.album,
          duration: canonical.duration, genre: canonical.genre, family: canonical.family, year: canonical.year,
          confidence: Math.round((canonical.score || 0) * 100) } : null,
        library: libraryHits.map((t) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album,
          duration: t.duration, isrc: t.isrc, bpm: t.bpm, key: t.key, has_file: !!t.has_file })),
        albums: [...albums.map((a) => ({ ...a, kind: 'library' })), ...archiveAlbums],
        rungs: ['ytmusic', 'soundcloud', 'bandcamp', 'archive'], connected: true,
      };
      ladderCache.set(cacheKey, { exp: Date.now() + LADDER_TTL, payload });
      if (ladderCache.size > 200) ladderCache.delete(ladderCache.keys().next().value);
      return json(res, 200, payload);
    }

    // spotify track/playlist id or url -> exact metadata, then ladder with duration-strict seed
    const mSp = u.pathname.match(/^\/api\/ladder\/spotify\/(.+)$/);
    if (mSp) {
      try {
        const info = await spotify.resolve(decodeURIComponent(mSp[1]));
        if (!info) return json(res, 404, { error: 'not found on spotify' });
        if (info.kind === 'playlist') return json(res, 200, info);
        const seed = { title: info.title, artist: info.artists.join(', '), duration: info.durationMs ? info.durationMs / 1000 : null };
        const [yt, sc, ia] = await Promise.all([
          ytdlp.searchYoutube(seed, { limit: 6 }).catch(() => []),
          ytdlp.searchSoundcloud(seed, { limit: 5 }).catch(() => []),
          archive.searchArchive(seed, { limit: 6 }).catch(() => []),
        ]);
        // strict duration gate + studio-preference for ID-based resolution
        const nt = normalize(info.title);
        const bad = /\b(live|remix|mix|cover|bootleg|karaoke|instrumental|version|edit|sped up|slowed)\b/;
        const all = [...yt, ...sc, ...ia]
          .map((c) => {
            if (c.rung === 'yt-dlp' && c.id) c.thumb = `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`;
            const s = scoreCandidate(c, seed);
            // exact-normalized title match boosts; live/remix junk penalized unless the seed title says so
            if (normalize(c.title || c.filename || '') === nt) s.score += 20;
            const ct = normalize(c.title || c.filename || '');
            if (bad.test(ct) && !bad.test(nt)) s.score -= 25;
            return { ...c, ...s };
          })
          .filter((c) => c.score > 0)
          .sort((a, b) => b.score - a.score || QUALITY_RANK(b) - QUALITY_RANK(a))
          .slice(0, 20);
        return json(res, 200, { track: info, results: all, rungs: ['yt-dlp', 'soundcloud', 'archive'], best: all[0] || null });
      } catch (e) { return upstreamError(res, e, ''); }
    }

    if (u.pathname === '/api/ladder/state') {
      return json(res, 200, { connected: true, rungs: [{ name: 'yt-dlp', ready: true, sovereign: true }, { name: 'archive', ready: true, sovereign: true }] });
    }

    // resolve a youtube result to a direct stream url (browser plays this directly)
    const mStreamYt = u.pathname.match(/^\/api\/ladder\/stream\/youtube\/([\w-]+)$/);
    if (mStreamYt) {
      try {
        const url = await ytdlp.streamUrl(mStreamYt[1]);
        res.writeHead(302, { location: url });
        return res.end();
      } catch (e) { return upstreamError(res, e, ''); }
    }

    // soundcloud: download once into a cache file, then stream that file as it grows.
    // A direct pipe from yt-dlp into ffmpeg stalls inside the service, so the file is the
    // source of truth: playback starts as soon as the first chunk exists.
    if (u.pathname === '/api/ladder/stream/soundcloud') {
      const target = u.searchParams.get('u') || '';
      if (!/^https:\/\/(www\.)?(api\.)?soundcloud\.com\//.test(target)) return json(res, 400, { error: 'non-soundcloud url' });
      const dir = scCacheDir();
      const key = 'sc-' + target.replace(/[^a-zA-Z0-9]+/g, '').slice(-40);
      const file = path.join(dir, key + '.mp3');

      const ready = fs.existsSync(file) && fs.statSync(file).size > 102400;

      if (ready) {
        const st = fs.statSync(file);
        const head = { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
        const range = req.headers.range;
        if (range) {
          const r = range.match(/bytes=(\d*)-(\d*)/);
          let s = r && r[1] ? Number(r[1]) : 0;
          let e = r && r[2] ? Number(r[2]) : st.size - 1;
          // "bytes=-100" is the last hundred bytes, not the first hundred: players probe
          // the tail of a file for ID3v1/Xing headers
          if (r && !r[1] && r[2]) { s = Math.max(0, st.size - Number(r[2])); e = st.size - 1; }
          e = Math.min(e, st.size - 1);
          res.writeHead(206, { ...head, 'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1 });
          return fs.createReadStream(file, { start: s, end: e }).pipe(res);
        }
        res.writeHead(200, { ...head, 'content-length': st.size });
        return fs.createReadStream(file).pipe(res);
      }

      // start (or join) the fetch, then feed the client from the growing file
      if (!scStreamJobs.has(key)) {
        const tpl = path.join(dir, key + '.%(ext)s');
        const child = spawn(paths.YTDLP,
          ['--no-warnings', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', tpl, target],
          { stdio: ['ignore', 'ignore', 'ignore'] });
        const job = new Promise((resolve) => child.on('close', resolve));
        scStreamJobs.set(key, job);
        job.finally(() => scStreamJobs.delete(key));
      }

      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
      if (res.flushHeaders) res.flushHeaders();

      let closed = false;
      const stop = () => { closed = true; };
      res.on('close', stop);
      res.on('error', stop);

      const pump = async () => {
        let offset = 0;
        const deadline = Date.now() + 120000;
        while (!closed && Date.now() < deadline) {
          if (!fs.existsSync(file)) { await new Promise((r) => setTimeout(r, 250)); continue; }
          const size = fs.statSync(file).size;
          if (size > offset) {
            const want = Math.min(size - offset, 256 * 1024);
            const ok = await new Promise((resolve) => {
              const rs = fs.createReadStream(file, { start: offset, end: offset + want - 1 });
              rs.on('data', (chunk) => { if (!closed && !res.write(chunk)) { rs.pause(); res.once('drain', () => rs.resume()); } });
              rs.on('end', () => resolve(true));
              rs.on('error', () => resolve(false));
            });
            offset += want;
            if (!ok) break;
            continue;
          }
          if (!scStreamJobs.has(key)) break;   // fetch finished and we caught up
          await new Promise((r) => setTimeout(r, 400));
        }
        try { res.end(); } catch {}
      };
      pump().catch(() => { try { res.end(); } catch {} });
      return;
    }

    // generic resolver for bandcamp and other yt-dlp supported pages
    if (u.pathname === '/api/ladder/stream/generic') {
      const target = safeRemoteUrl(u.searchParams.get('u') || '');
      if (!target) return json(res, 400, { error: 'absolute public https url required' });
      try {
        const loc = await ytdlp.streamUrlFor(target);
        res.writeHead(302, { location: loc });
        return res.end();
      } catch (e) { return upstreamError(res, e, '/api/ladder/stream/generic'); }
    }


    // generic resolver for bandcamp and other yt-dlp supported pages




    // generic resolver for bandcamp and other yt-dlp supported pages


    // generic resolver for bandcamp and other yt-dlp supported pages




    // generic resolver for bandcamp and other yt-dlp supported pages




    // generic resolver for bandcamp and other yt-dlp supported pages




    // archive item: list playable files
    const mIaFiles = u.pathname.match(/^\/api\/ladder\/archive\/([^/]+)\/files$/);
    if (mIaFiles) {
      const files = await archive.itemFiles(decodeURIComponent(mIaFiles[1])).catch(() => []);
      return json(res, 200, { identifier: decodeURIComponent(mIaFiles[1]), files });
    }

    // download a ladder result into the owned tier (async job)
    if (u.pathname === '/api/ladder/download' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => body += c);
      onEnd(req, res, async () => {
        try {
          const b = JSON.parse(body);
          const rawUrl = b.url || b.file || '';
          if (/^https?:\/\//i.test(rawUrl) && !safeRemoteUrl(rawUrl)) return json(res, 400, { error: 'blocked url' });
          const jobId = crypto.randomUUID();
          db.prepare('INSERT INTO jobs (kind,payload,state,created_at) VALUES (?,?,?,?)')
            .run('ladder-download', JSON.stringify({ jobId, ...b }), 'running', now());
          // catalogue rows arrive with only a title and artist: resolve them first
          let payload = b;
          if (!payload.id && !payload.url) {
            const best = await resolveBest({ title: payload.title, artist: payload.artist, duration: payload.duration || null }, 1800, { download: true });
            if (!best) return json(res, 200, { error: 'no source' });
            payload = { ...payload, ...best, rung: best.rung, id: best.id, url: best.url };
          }
          enqueueDownload(jobId, payload);
          json(res, 200, { job: jobId });
        } catch (e) { serverError(res, e, 'download start'); }
      });
      return;
    }

    const mJob = u.pathname.match(/^\/api\/jobs\/([\w-]+)$/);
    if (mJob) {
      const target = db.prepare('SELECT id,kind,payload,state,detail,created_at,finished_at FROM jobs WHERE payload LIKE ? ORDER BY id DESC LIMIT 1')
        .get(`%${mJob[1]}%`);
      if (!target) return json(res, 404, { error: 'unknown job' });
      return json(res, 200, { id: mJob[1], kind: target.kind, state: target.state, detail: target.detail });
    }

    // mirror a spotify playlist: metadata only, nothing downloaded
    if (u.pathname === '/api/mirror/spotify' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        try {
          const b = JSON.parse(body || '{}');
          let target = String(b.url || b.id || '').trim();
          // accept open.spotify.com/intl-pt/playlist/<id>?si=... and bare ids
          const kindMatch = target.match(/(playlist|album)[/:]([A-Za-z0-9]{16,30})/);
          if (kindMatch) target = `https://open.spotify.com/${kindMatch[1]}/${kindMatch[2]}`;
          else {
            const bare = target.match(/^([A-Za-z0-9]{16,30})$/);
            if (bare) target = `https://open.spotify.com/playlist/${bare[1]}`;
          }
          // a bare id is ambiguous; for mirroring treat it as a playlist id
          if (/^[A-Za-z0-9]{16,30}$/.test(target)) target = `https://open.spotify.com/playlist/${target}`;
          const info = await spotify.resolve(target);
          if (!info) return json(res, 404, { error: 'Spotify did not return that playlist. It may be private, or the link is not a playlist.' });
          if (info.kind === 'track') return json(res, 400, { error: 'That is a single track. Use its download button instead.' });
          // albums are imported as a playlist with the album name
          const pid = `sp-${info.id}`;
          db.prepare(`INSERT INTO playlists (id,name,source,spotify_id,kind,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`)
            .run(pid, info.title || 'Spotify playlist', 'spotify', info.id, 'listen', now(), now());
          let pos = 0, added = 0;
          for (const tr of (info.tracks || [])) {
            if (!tr.title) continue;
            const tid = upsertTrack({
              title: tr.title,
              artist: (tr.artists || []).join(', '),
              duration: tr.durationMs ? tr.durationMs / 1000 : null,
              spotify_id: tr.id,
            });
            const r = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)')
              .run(pid, tid, pos++, now());
            added += r.changes || 0;
          }
          if (info.cover) {
            const dest = plCoverFile(info.id);
            https.get(info.cover, (r) => { if (r.statusCode === 200) { const w = fs.createWriteStream(dest); r.pipe(w); } else { r.resume(); } }).on('error', () => {});
          }
          json(res, 200, { playlist: pid, name: info.title, tracks: pos, added });
        } catch (e) { upstreamError(res, e, '/api/mirror/spotify'); }
      });
      return;
    }

    // download one catalog track that has no file yet (mirrored rows)
    const mTdl = u.pathname.match(/^\/api\/tracks\/(\d+)\/download$/);
    if (mTdl && req.method === 'POST') {
      const tid = Number(mTdl[1]);
      const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(tid);
      if (!t) return json(res, 404, { error: 'no such track' });
      let wantUpgrade = false;
      try { const raw = await readBody(req); wantUpgrade = !!(raw && JSON.parse(raw).upgrade); } catch {}
      // a retrying player or a double click used to queue a job every few seconds, each
      // one running its own catalogue search. One job per track, and no job when the
      // track already has audio unless the caller asked for a better copy.
      const like = trackIdLike(tid);
      const busyJob = db.prepare("SELECT payload FROM jobs WHERE kind='track-download' AND state IN ('queued','running') AND (payload LIKE ? OR payload LIKE ?) ORDER BY id LIMIT 1")
        .get(like.a, like.b);
      if (busyJob) {
        try { return json(res, 200, { job: JSON.parse(busyJob.payload).jobId, joined: true, track: tid }); } catch {}
      }
      if (!wantUpgrade && db.prepare("SELECT 1 FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(tid)) {
        return json(res, 200, { already: true, track: tid });
      }
      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO jobs (kind,payload,state,created_at) VALUES (?,?,?,?)')
        .run('track-download', JSON.stringify({ jobId, trackId: tid }), 'queued', now());
      resolveBest({ title: t.title, artist: t.artist, duration: t.duration }, 1800, { download: true })
        .then((best) => {
          if (!best) {
            db.prepare('UPDATE jobs SET state=?,detail=?,finished_at=? WHERE payload LIKE ?')
              .run('error', 'no source found', now(), `%${jobId}%`);
            return;
          }
          enqueueDownload(jobId, {
            trackId: tid, rung: best.rung, id: best.id, url: best.url, thumb: best.thumb, isrc: best.isrc,
            file: best.handle?.file || best.file, title: t.title, artist: t.artist,
          });
        })
        .catch((e) => db.prepare('UPDATE jobs SET state=?,detail=?,finished_at=? WHERE payload LIKE ?')
          .run('error', String(e.message).slice(0, 200), now(), `%${jobId}%`));
      return json(res, 200, { job: jobId, track: tid });
    }

    // upload a local audio file into the owned tier
    if (u.pathname === '/api/upload/track' && req.method === 'POST') {
      const raw = String(u.searchParams.get('name') || 'upload.mp3');
      const name = raw.replace(/[^\w.\- ()\[\]]+/g, '_').slice(-160);
      if (!/\.(mp3|flac|m4a|ogg|opus|wav|aiff?)$/i.test(name)) return json(res, 400, { error: 'unsupported file type' });
      const dir = path.join(OWNED, 'upload');
      fs.mkdirSync(dir, { recursive: true });
      // reserve a free name: two files called "track.mp3" are two tracks, not one
      const ext = path.extname(name) || '.mp3';
      const stem = name.slice(0, name.length - ext.length);
      let dest = path.join(dir, name);
      for (let i = 2; fs.existsSync(dest) || fs.existsSync(`${dest}.part`); i += 1) {
        dest = path.join(dir, `${stem} (${i})${ext}`);
      }
      const part = `${dest}.part`;
      // streamed, not buffered: a 60MB wav used to be 60MB of RAM on a small server
      const sha = createHash('sha256');
      const written = await new Promise((resolve, reject) => {
        let n = 0;
        const out = fs.createWriteStream(part);
        req.on('data', (c) => { n += c.length; sha.update(c); });
        req.on('aborted', () => reject(new Error('upload aborted')));
        req.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve(n));
        req.pipe(out);
      });
      if (!written) { try { fs.unlinkSync(part); } catch {} return json(res, 400, { error: 'empty upload' }); }
      fs.renameSync(part, dest);
      const meta = await probe(dest);
      /* A file that is already here is not a second track. The row is found by the same
         identity the rest of the app uses (artist + title); if the copy on disk is at
         least as good, the upload is refused and the bytes are deleted. A genuinely
         better copy replaces the old file, the way a download upgrade does. */
      const digest = sha.digest('hex');
      // the same bytes are the same file, whatever the tag or the name says
      const sameBytes = db.prepare(`SELECT t.id, t.title, t.artist, f.path FROM files f
        JOIN tracks t ON t.id=f.track_id WHERE f.tier='owned' AND f.sha256=? LIMIT 1`).get(digest);
      if (sameBytes) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        // no `track` field: a 409 is not a created track, and callers that treat
        // `track` as "the new row" ended up deleting the one that already existed
        return json(res, 409, {
          duplicate: true, reason: 'identical file', existing_id: sameBytes.id,
          title: sameBytes.title, artist: sameBytes.artist || '', existing: path.basename(sameBytes.path),
        });
      }
      const incomingQuality = fileQuality(path.extname(dest), meta.bitrate);
      const dupKey = dupKeyOf(meta.artist || '', meta.title || name.replace(/\.[^.]+$/, ''));
      const existing = db.prepare(`SELECT t.id, t.title, t.artist, f.id file_id, f.path, f.bitrate
        FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
        WHERE t.dup_key=? ORDER BY f.bitrate DESC LIMIT 1`).get(dupKey);
      let replaced = false;
      if (existing && existing.path) {
        const currentQuality = fileQuality(path.extname(existing.path), existing.bitrate);
        if (incomingQuality <= currentQuality) {
          try { fs.rmSync(dest, { force: true }); } catch {}
          return json(res, 409, {
            duplicate: true, track: existing.id,
            title: existing.title || meta.title, artist: existing.artist || meta.artist || '',
            existing: path.basename(existing.path),
          });
        }
        // better copy: remove the file it supersedes, not the track or its history
        try { fs.rmSync(existing.path, { force: true }); } catch {}
        db.prepare('DELETE FROM files WHERE id=?').run(existing.file_id);
        replaced = true;
      }
      const tid = upsertTrack({
        title: meta.title || name.replace(/\.[^.]+$/, ''),
        artist: meta.artist || '',
        album: meta.album || '',
        year: meta.year || null,
        duration: meta.duration,
        track_no: meta.trackNumber || null,
        disc_no: meta.discNumber || null,
        format: (name.split('.').pop() || 'mp3').toLowerCase(),
      });
      upsertFile({ track_id: tid, path: dest, tier: 'owned', bitrate: meta.bitrate, size: meta.size, mtime: meta.mtime });
      db.prepare('UPDATE files SET sha256=? WHERE path=?').run(digest, dest);
      db.prepare('INSERT OR REPLACE INTO resolutions (track_id,rung,quality,resolved_at) VALUES (?,?,?,?)')
        .run(tid, 'upload', meta.bitrate ? `${Math.round(meta.bitrate / 1000)}k` : null, now());
      const art = await extractCover(tid, dest).catch(() => false);
      db.prepare('UPDATE tracks SET has_art=? WHERE id=?').run(art ? 1 : 0, tid);
      return json(res, 200, { track: tid, title: meta.title || name, has_art: !!art, replaced });
    }

    // replace the cover of one owned track
    const mTrackCover = u.pathname.match(/^\/api\/tracks\/(\d+)\/cover$/);
    if (mTrackCover && req.method === 'POST') {
      const tid = Number(mTrackCover[1]);
      if (!db.prepare('SELECT id FROM tracks WHERE id=?').get(tid)) return json(res, 404, { error: 'no such track' });
      const buf = await readBody(req);
      try {
        await saveImageCover(buf, coverFile(tid));
        db.prepare('UPDATE tracks SET has_art=1 WHERE id=?').run(tid);
        return json(res, 200, { ok: true });
      } catch (e) {
        console.error('[cover] track', tid, (e && e.message) || e);
        return json(res, 400, { error: 'that image could not be read' });
      }
    }

    // replace the artwork of one playlist
    // a playlist takes a track's artwork: both are already 600px jpgs on disk, so this
    // is a copy, not a re-encode
    const mPlCoverT = u.pathname.match(/^\/api\/playlists\/([^/]+)\/cover-from-track$/);
    if (mPlCoverT && req.method === 'POST') {
      const pid = decodeURIComponent(mPlCoverT[1]);
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let tid = 0;
        try { tid = Number(JSON.parse(body || '{}').trackId) || 0; } catch {}
        if (!tid) return json(res, 400, { error: 'trackId required' });
        if (!db.prepare('SELECT id FROM playlists WHERE id=?').get(pid)) return json(res, 404, { error: 'no such playlist' });
        const src = coverFile(tid);
        if (!fs.existsSync(src)) return json(res, 404, { error: 'that track has no cover' });
        try {
          fs.copyFileSync(src, plCoverFile(pid));
          return json(res, 200, { ok: true, track: tid });
        } catch (e) { return serverError(res, e, ''); }
      });
      return;
    }

    const mPlCover = u.pathname.match(/^\/api\/playlists\/([^/]+)\/cover$/);
    if (mPlCover && req.method === 'POST') {
      const pid = decodeURIComponent(mPlCover[1]);
      const buf = await readBody(req);
      try {
        await saveImageCover(buf, plCoverFile(pid));
        return json(res, 200, { ok: true });
      } catch (e) {
        console.error('[cover] playlist', pid, (e && e.message) || e);
        return json(res, 400, { error: 'that image could not be read' });
      }
    }


    // rescan the history folder for newly delivered exports
    if (u.pathname === '/api/history/scan' && req.method === 'POST') {
      const HISTORY_DIR = path.join(paths.DATA, 'history');
      try {
        const out = await new Promise((resolve, reject) => {
          execFile(process.execPath, [path.join(__dirname, 'import-history.js'), HISTORY_DIR],
            { timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout) => (err && !stdout ? reject(new Error(String(err.message).slice(0, 200))) : resolve(stdout || '')));
        });
        const m = out.match(/\{[\s\S]*\}\s*$/);
        const stats = m ? JSON.parse(m[0]) : null;
        return json(res, 200, { ok: true, stats, log: out.split('\n').slice(-6).join('\n') });
      } catch (e) { return serverError(res, e, '/api/history/scan'); }
    }

    // what the history ingest learned
    if (u.pathname === '/api/history/stats') {
      const g = (q) => db.prepare(q).get();
      const topArtists = db.prepare('SELECT artist, plays, ms, last_ts FROM taste_artists ORDER BY plays DESC LIMIT 24').all();
      const topTracks = db.prepare('SELECT uri, title, artist, plays FROM taste_tracks ORDER BY plays DESC LIMIT 24').all();
      const inCatalog = db.prepare(`SELECT COUNT(*) c FROM tracks t WHERE EXISTS
        (SELECT 1 FROM taste_tracks tt WHERE lower(tt.title)=lower(t.title) AND lower(tt.artist)=lower(t.artist))`).get().c;
      return json(res, 200, {
        plays: g('SELECT COUNT(*) c FROM spotify_plays').c,
        tracks: g('SELECT COUNT(*) c FROM taste_tracks').c,
        artists: g('SELECT COUNT(*) c FROM taste_artists').c,
        edges: g('SELECT COUNT(*) c FROM play_edges').c,
        hours: Math.round((g('SELECT SUM(ms_played) s FROM spotify_plays').s || 0) / 3600000),
        first: g('SELECT MIN(ts) m FROM spotify_plays').m,
        last: g('SELECT MAX(ts) m FROM spotify_plays').m,
        tracks_in_catalog: inCatalog,
        top_artists: topArtists,
        top_tracks: topTracks,
      });
    }

    // import one spotify track as a metadata row, no audio yet
    if (u.pathname === '/api/mirror/track' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        try {
          const b = JSON.parse(body || '{}');
          let target = String(b.url || b.id || '').trim();
          if (/^[A-Za-z0-9]{16,30}$/.test(target)) target = `https://open.spotify.com/track/${target}`;
          const info = await spotify.resolve(target);
          if (!info || info.kind !== 'track') return json(res, 404, { error: 'not a spotify track' });
          const before = db.prepare('SELECT id FROM tracks WHERE spotify_id=?').get(info.id);
          const tid = upsertTrack({
            title: info.title, artist: (info.artists || []).join(', '),
            album: info.album || '', duration: info.durationMs ? info.durationMs / 1000 : null,
            spotify_id: info.id,
          });
          const pid = b.playlist ? String(b.playlist) : null;
          if (pid) {
            const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM playlist_tracks WHERE playlist_id=?').get(pid).p;
            db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)').run(pid, tid, pos, now());
          }
          return json(res, 200, { track: tid, title: info.title, playlist: pid, added: !!pid, existing: !!before });
        } catch (e) { return upstreamError(res, e, '/api/mirror/track'); }
      });
      return;
    }

    // build a playlist from your listening history (import path that is not the ladder)
    if (u.pathname === '/api/history/materialize' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        try {
          const b = JSON.parse(body || '{}');
          const name = String(b.name || 'From your history').slice(0, 80);
          const limit = Math.min(Number(b.limit || 100), 400);
          const minPlays = Math.max(Number(b.minPlays || 3), 1);
          const rows = db.prepare(`SELECT tt.uri, tt.title, tt.artist, tt.album, tt.plays
            FROM taste_tracks tt
            WHERE tt.plays >= ?
            AND NOT EXISTS (SELECT 1 FROM tracks t WHERE lower(t.title)=lower(tt.title) AND lower(COALESCE(t.artist,''))=lower(COALESCE(tt.artist,'')))
            ORDER BY tt.plays DESC LIMIT ?`).all(minPlays, limit);
          if (!rows.length) return json(res, 200, { playlist: null, added: 0, note: 'nothing new to import' });
          const pid = `hist-${Date.now().toString(36)}`;
          db.prepare('INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)')
            .run(pid, name, 'history', 'listen', now(), now());
          let pos = 0;
          for (const r of rows) {
            const tid = upsertTrack({ title: r.title, artist: r.artist, album: r.album || '', duration: null, format: 'mirror', spotify_id: (r.uri || '').split(':').pop() });
            db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)').run(pid, tid, pos++, now());
          }
          json(res, 200, { playlist: pid, name, added: pos });
        } catch (e) { serverError(res, e, 'history mirror'); }
      });
      return;
    }

    // duplicate finding is deliberately conservative: same artist and title after
    // case/punctuation folding, same album (or one blank), length within three seconds.
    // An original and a remaster have different titles, so they can never be merged.
    if ((u.pathname === '/api/maintenance/duplicates' || u.pathname === '/api/maintenance/dedupe') && (req.method === 'GET' || req.method === 'POST')) {
      const plan = duplicatePlan();
      if (req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          groups: plan.groups.length,
          tracks: plan.groups.reduce((n, g) => n + g.merge.length, 0),
          extra_files: plan.extra.length,
          versions: plan.versions,
          sample: plan.groups.slice(0, 6).map((g) => ({ title: g.title, artist: g.artist, album: g.album, count: g.merge.length + 1 })),
        });
      }
      try {
        const out = applyDuplicatePlan(plan);
        return json(res, 200, { ok: true, ...out });
      } catch (e) {
        return serverError(res, e, u.pathname);
      }
    }

    // ---------- format compatibility (rekordbox / Traktor) ----------
    // files neither app can open are converted in place: same track, playable container
    if (u.pathname === '/api/maintenance/transcode' && req.method === 'GET') {
      const rows = db.prepare("SELECT id, track_id, path FROM files WHERE tier='owned' AND COALESCE(external,0)=0").all()
        .filter((r) => transcode.needsConvert(r.path));
      return json(res, 200, { count: rows.length, files: rows.slice(0, 40).map((r) => ({ id: r.id, track_id: r.track_id, name: path.basename(r.path) })) });
    }
    // put the index at the front of every m4a: the single biggest win for a phone
    if (u.pathname === '/api/maintenance/faststart' && req.method === 'GET') {
      return json(res, 200, { count: faststartCandidates().length });
    }
    if (u.pathname === '/api/maintenance/faststart' && req.method === 'POST') {
      const rows = faststartCandidates();
      for (const r of rows) transcodeQueue.push({ ...r, kind: 'faststart' });
      faststartScan = { at: 0, rows: [] };
      pumpTranscode();
      return json(res, 202, { started: rows.length > 0, count: rows.length });
    }
    if (u.pathname === '/api/maintenance/transcode' && req.method === 'POST') {
      const rows = db.prepare("SELECT id, track_id, path FROM files WHERE tier='owned' AND COALESCE(external,0)=0").all()
        .filter((r) => transcode.needsConvert(r.path));
      for (const r of rows) transcodeQueue.push(r);
      pumpTranscode();
      return json(res, 202, { started: rows.length > 0, count: rows.length });
    }

    // metadata repair: normalise years, collapse placeholder albums, strip media noise,
    // trim whitespace. Reports every kind of change; a button that only says "0" on a
    // library full of `2010.0` years looks dead.
    if (u.pathname === '/api/maintenance/repair' && req.method === 'POST') {
      const thisYear = new Date().getFullYear();
      let fixedYear = 0, fixedAlbum = 0, trimmed = 0, cleanedTitles = 0;
      const rows = db.prepare("SELECT id, title, artist, album, year FROM tracks").all();
      const upd = db.prepare('UPDATE tracks SET title=?, artist=?, album=?, year=? WHERE id=?');
      const PLACEHOLDER = new Set(['web', 'unknown', 'youtube', 'youtube music', 'na', 'n/a', 'untitled']);
      for (const t of rows) {
        let title = (t.title || '').replace(/\s+/g, ' ').trim();
        let artist = (t.artist || '').replace(/\s+/g, ' ').trim();
        let album = (t.album || '').replace(/\s+/g, ' ').trim();
        let changed = false;
        if (title !== t.title || artist !== t.artist) trimmed++;

        // 2010.0 -> 2010, impossible years -> empty
        const rawYear = t.year == null || String(t.year).trim() === '' ? null : Number(t.year);
        let year = rawYear !== null && Number.isFinite(rawYear) ? Math.trunc(rawYear) : null;
        if (year !== null && (year < 1900 || year > thisYear + 1)) year = null;
        if (String(t.year ?? '') !== String(year ?? '')) { fixedYear += 1; changed = true; }

        if (album && (PLACEHOLDER.has(album.toLowerCase()) || album === title)) { album = ''; fixedAlbum += 1; changed = true; }
        // YouTube titles keep their media label; it is not part of the song
        const clean = title.replace(/\s*[\[(]\s*(official\s*(audio|video|music\s*video)|lyric[s]?\s*video|visuali[sz]er|audio)\s*[\])]\s*$/i, '').trim();
        if (clean && clean !== title) { title = clean; cleanedTitles += 1; changed = true; }
        artist = artist.replace(/\s*-\s*topic$/i, '').trim();
        if (title !== t.title || artist !== t.artist) changed = true;
        // the column is TEXT: bind the number as a string, or SQLite writes 2010.0 again
        if (changed) upd.run(title, artist, album, year === null ? null : String(year), t.id);
      }
      const unknownArtists = db.prepare("SELECT COUNT(*) c FROM tracks WHERE lower(COALESCE(artist,'')) IN ('', 'unknown', 'unknown artist')").get().c;
      json(res, 200, {
        ok: true, fixed_year: fixedYear, cleared_placeholder_album: fixedAlbum,
        trimmed, cleaned_titles: cleanedTitles, unknown_artists: unknownArtists,
      });
      return;
    }

    // backfill missing durations for owned files (imports can leave duration null)
    if (u.pathname === '/api/maintenance/fill-durations' && req.method === 'POST') {
      const rows = db.prepare(`SELECT t.id, f.path FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
        WHERE t.duration IS NULL OR t.duration = 0 LIMIT 1000`).all();
      let fixed = 0;
      for (const r of rows) {
        if (!fs.existsSync(r.path)) continue;
        try {
          const m = await probe(r.path);
          if (m && m.duration) { db.prepare('UPDATE tracks SET duration=? WHERE id=?').run(m.duration, r.id); fixed += 1; }
        } catch {}
      }
      return json(res, 200, { fixed, checked: rows.length });
    }

    // backfill album track numbers from the files (needed for album ordering)
    if (u.pathname === '/api/maintenance/fill-tracknos' && req.method === 'POST') {
      const rows = db.prepare(`SELECT t.id, f.path FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
        WHERE t.track_no IS NULL OR t.disc_no IS NULL LIMIT 2000`).all();
      let fixed = 0;
      for (const r of rows) {
        if (!fs.existsSync(r.path)) continue;
        try {
          const m = await probe(r.path);
          if (m && m.trackNumber) { db.prepare('UPDATE tracks SET track_no=? WHERE id=?').run(m.trackNumber, r.id); fixed += 1; }
          if (m && m.discNumber) db.prepare('UPDATE tracks SET disc_no=? WHERE id=?').run(m.discNumber, r.id);
        } catch {}
      }
      return json(res, 200, { fixed, checked: rows.length });
    }

    // write standard ID3 + Traktor tags from DB metadata into owned MP3s that lack a title tag
    if (u.pathname === '/api/maintenance/write-tags' && req.method === 'POST') {
      const limit = Math.min(Number(u.searchParams.get('limit') || 300), 2000);
      const rows = db.prepare(`SELECT t.id FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
        WHERE lower(f.path) LIKE '%.mp3' AND COALESCE(f.external,0)=0 ORDER BY t.id LIMIT ?`).all(limit);
      let written = 0, skipped = 0;
      for (const { id } of rows) {
        const plan = trackTagMeta(db, id);
        if (plan.error) { skipped += 1; continue; }
        try {
          const id3 = tagwrite.readId3(fs.readFileSync(plan.path));
          if (id3.frames.some((f) => f.id === 'TIT2')) { skipped += 1; continue; }
          tagwrite.writeTags(plan.path, plan.meta, {});
          written += 1;
        } catch { skipped += 1; }
      }
      return json(res, 200, { written, skipped, checked: rows.length });
    }

    // one file per track: keep the best-quality owned file, delete the rest
    if (u.pathname === '/api/maintenance/dedupe-files' && req.method === 'POST') {
      const groups = db.prepare(`SELECT track_id, COUNT(*) c FROM files WHERE tier='owned' GROUP BY track_id HAVING c > 1`).all();
      let removed = 0;
      for (const g of groups) {
        const list = db.prepare("SELECT id, path, bitrate, COALESCE(external,0) external FROM files WHERE track_id=? AND tier='owned'").all(g.track_id)
          .sort((a, b) => fileQuality(path.extname(b.path), b.bitrate) - fileQuality(path.extname(a.path), a.bitrate));
        for (const keep of list.slice(1)) {
          db.prepare('DELETE FROM files WHERE id=?').run(keep.id);
          if (!keep.external) { try { fs.rmSync(keep.path, { force: true }); } catch {} }
          removed += 1;
        }
      }
      return json(res, 200, { tracks: groups.length, removed });
    }

    // stop everything that is queued or running
    if (u.pathname === '/api/downloads/cancel-all' && req.method === 'POST') {
      const live = db.prepare("SELECT id, payload FROM jobs WHERE state IN ('queued','running') AND kind='track-download'").all();
      let cancelled = 0;
      for (const job of live) {
        let p = {};
        try { p = JSON.parse(job.payload); } catch {}
        cancelDownload(p.jobId);
        db.prepare("UPDATE jobs SET state='cancelled', progress=0, finished_at=? WHERE id=?").run(now(), job.id);
        cancelled += 1;
      }
      return json(res, 200, { cancelled });
    }

    // find and clear truncated or missing files, then queue them again
    if (u.pathname === '/api/maintenance/repair-duration' && req.method === 'POST') {
      const files = db.prepare("SELECT f.id, f.track_id, f.path, t.title, t.artist, t.duration FROM files f JOIN tracks t ON t.id=f.track_id WHERE f.tier='owned'").all();
      const broken = [];
      for (const f of files) {
        let actual = 0;
        if (!fs.existsSync(f.path)) { broken.push({ ...f, actual: 0, why: 'missing' }); continue; }
        try {
          const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f.path], { timeout: 15000 }).toString().trim();
          actual = Number(out) || 0;
        } catch { actual = 0; }
        const declared = Number(f.duration) || 0;
        if (!actual) broken.push({ ...f, actual, why: 'unreadable' });
        else if (actual < 30) broken.push({ ...f, actual, why: 'too short' });
        else if (declared && actual < declared * 0.6) broken.push({ ...f, actual, why: 'truncated' });
      }
      const withoutReading = broken.filter((b) => b.why === 'unreadable').length;
      if (files.length > 5 && broken.length > Math.max(5, Math.floor(files.length * 0.2))) {
        return json(res, 409, {
          error: 'refusing to act: that many broken files means the check itself failed',
          checked: files.length, broken: broken.length, unreadable: withoutReading,
        });
      }
      for (const b of broken) {
        if (b.why === 'unreadable') continue;   // unknown is not the same as broken
        db.prepare('DELETE FROM files WHERE id=?').run(b.id);
        try { fs.rmSync(b.path, { force: true }); } catch {}
      }
      // queue a fresh attempt for everything we just cleared
      let queued = 0;
      for (const b of broken) {
        const already = db.prepare("SELECT id FROM jobs WHERE (state='queued' OR state='running') AND payload LIKE ?").get(`%"trackId":${b.track_id}%`);
        if (already) continue;
        const jobId = crypto.randomUUID();
        db.prepare('INSERT INTO jobs (kind,payload,state,progress,created_at) VALUES (?,?,?,0,?)')
          .run('track-download', JSON.stringify({ jobId, trackId: b.track_id, title: b.title }), 'queued', now());
        resolveBest({ title: b.title, artist: b.artist || '', duration: b.duration || null }).then((best) => {
          if (!best) { db.prepare("UPDATE jobs SET state='error', detail='no source', finished_at=? WHERE payload LIKE ?").run(now(), `%${jobId}%`); return; }
          enqueueDownload(jobId, { trackId: b.track_id, rung: best.rung, id: best.id, url: best.url, thumb: best.thumb, isrc: best.isrc, file: best.handle?.file || best.file, title: b.title, artist: '', duration: b.duration });
        }).catch(() => {});
        queued += 1;
      }
      return json(res, 200, { checked: files.length, broken: broken.length, removed: broken.length, queued, items: broken.slice(0, 20).map((b) => ({ id: b.track_id, title: b.title, actual: Math.round(b.actual), why: b.why })) });
    }

    if (u.pathname === '/api/debug/resolve') {
      const title = u.searchParams.get('title') || '';
      const artist = u.searchParams.get('artist') || '';
      const best = await resolveBest({ title, artist, duration: Number(u.searchParams.get('duration')) || null });
      return json(res, 200, {
        asked: { title, artist },
        cleaned: cleanTitle(title),
        chosen: best ? { rung: best.rung, title: best.title, duration: best.duration, score: best.score, verified: !!best.verified } : null,
      });
    }

    // fill genre, album, year and duration from the iTunes catalogue
    if (u.pathname === '/api/identity/fill' && req.method === 'POST') {
      const limit = Math.min(Number(u.searchParams.get('limit') || 200), 1000);
      (async () => {
        const rows = db.prepare(`SELECT id, title, artist FROM tracks
          WHERE (genre IS NULL OR genre='' OR album IS NULL OR album='' OR year IS NULL)
          AND title IS NOT NULL AND title != '' LIMIT ?`).all(limit);
        let done = 0, tagged = 0;
        for (const t of rows) {
          const c = await identity.canon(t.artist || '', t.title).catch(() => null);
          done += 1;
          if (!c) continue;
          db.prepare(`UPDATE tracks SET genre=COALESCE(NULLIF(genre,''), ?),
              genre_family=COALESCE(genre_family, ?), album=COALESCE(NULLIF(album,''), ?),
              year=COALESCE(year, ?), duration=COALESCE(duration, ?) WHERE id=?`)
            .run(c.genre || null, c.family || null, c.album || null, c.year || null, c.duration || null, t.id);
          tagged += 1;
        }
        console.log('[identity]', JSON.stringify({ checked: done, tagged }));
      })().catch((e) => console.error('[identity]', e.message));
      return json(res, 202, { started: true, limit });
    }
    if (u.pathname === '/api/identity/canon') {
      const artist = u.searchParams.get('artist') || '';
      const title = u.searchParams.get('title') || '';
      const c = await identity.canon(artist, title).catch(() => null);
      return json(res, 200, c || {});
    }

    // edit a track's metadata in place
    const mEdit = u.pathname.match(/^\/api\/tracks\/(\d+)$/);
    if (mEdit && (req.method === 'PATCH' || req.method === 'PUT')) {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const id = Number(mEdit[1]);
        const cur = db.prepare('SELECT title, artist, album, year, genre, genre_family FROM tracks WHERE id=?').get(id);
        if (!cur) return json(res, 404, { error: 'no such track' });
        const bad = metaValidation(b);
        if (bad) return json(res, 400, { error: bad });
        const fields = {};
        for (const k of ['title', 'artist', 'album', 'year', 'genre', 'genre_family']) {
          if (b[k] !== undefined) fields[k] = String(b[k] || '').trim() || null;
        }
        if (!Object.keys(fields).length) return json(res, 400, { error: 'nothing to change' });
        const r = repair.apply(db, id, fields);
        if (r.error) return json(res, 409, r);
        const changed = Object.keys(fields).filter((k) => String(cur[k] ?? '') !== String(fields[k] ?? ''));
        lockMeta(db, id, changed);
        return json(res, 200, { ok: true, ...r });
      });
      return;
    }

    // release a hand lock so catalogue repair may correct the track again
    const mUnlock = u.pathname.match(/^\/api\/tracks\/(\d+)\/unlock$/);
    if (mUnlock && req.method === 'POST') {
      db.prepare('UPDATE tracks SET meta_locked=NULL WHERE id=?').run(Number(mUnlock[1]));
      return json(res, 200, { ok: true });
    }

    // bulk metadata edit: move many tracks to the right album (or set year/genre)
    if (u.pathname === '/api/tracks/edit' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let b = null;
        try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad request body' }); }
        const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite).slice(0, 1000) : [];
        if (!ids.length) return json(res, 400, { error: 'ids required' });
        const bad = metaValidation(b);
        if (bad) return json(res, 400, { error: bad });
        const sets = [];
        const params = [];
        if (b.album !== undefined) { sets.push('album=?'); params.push(String(b.album || '').trim().slice(0, 200) || null); }
        if (b.year !== undefined) {
          const y = b.year === '' || b.year === null ? null : Math.trunc(Number(b.year));
          sets.push('year=?'); params.push(y && y >= 1900 && y <= new Date().getFullYear() + 1 ? String(y) : null);
        }
        if (b.genre !== undefined) { sets.push('genre=?'); params.push(String(b.genre || '').trim() || null); }
        if (b.genre_family !== undefined) { sets.push('genre_family=?'); params.push(String(b.genre_family || '').trim() || null); }
        if (!sets.length) return json(res, 400, { error: 'nothing to change' });
        const upd = db.prepare(`UPDATE tracks SET ${sets.join(', ')}, updated_at=? WHERE id=?`);
        let updated = 0;
        const candidates = [];
        if (b.album !== undefined) candidates.push('album');
        if (b.year !== undefined) candidates.push('year');
        if (b.genre !== undefined) candidates.push('genre');
        if (b.genre_family !== undefined) candidates.push('genre_family');
        const cur = db.prepare(`SELECT album, year, genre, genre_family FROM tracks WHERE id=?`);
        for (const id of ids) {
          try {
            const before = cur.get(id);
            const r = upd.run(...params, now(), id);
            if (!r.changes) continue;
            updated += 1;
            const changed = candidates.filter((k) => String((before && before[k]) ?? '') !== String((b[k] ?? '') || ''));
            lockMeta(db, id, changed);
          } catch {}
        }
        return json(res, 200, { ok: true, updated, checked: ids.length });
      });
      return;
    }

    // find rows whose file vanished, clear them and optionally requeue
    if (u.pathname === '/api/maintenance/verify-files' && req.method === 'POST') {
      const requeue = u.searchParams.get('requeue') !== '0';
      return json(res, 200, verifyFiles({ requeue }));
    }

    // settings: model endpoint, keys, profile
    if (u.pathname === '/api/llm/status' && req.method === 'GET') {
      return json(res, 200, await llm.probe());
    }
    if (u.pathname === '/api/llm/models' && req.method === 'GET') {
      return json(res, 200, await llm.listModels());
    }

    if (u.pathname === '/api/update/status' && req.method === 'GET') {
      return json(res, 200, await updateInfo(u.searchParams.get('check') === '1'));
    }
    if (u.pathname === '/api/restart' && req.method === 'POST') {
      const systemd = fs.existsSync('/run/systemd/system');
      json(res, 200, { ok: true, restarting: !systemd });
      setTimeout(() => {
        try {
          if (systemd) {
            const child = spawn('systemctl', ['restart', 'musicfy'], { detached: true, stdio: 'ignore' });
            child.unref();
          } else {
            // the CLI stops the pid it knows and starts a fresh process; without a pid file
            // it starts one, which is exactly what a manually started install needs
            const cli = path.join(APP_ROOT, 'bin', 'musicfy.mjs');
            const child = spawn(process.execPath, [cli, 'restart'], { detached: true, stdio: 'ignore' });
            child.unref();
          }
        } catch {}
      }, 800);
      return;
    }

    if (u.pathname === '/api/update' && req.method === 'POST') {
      const info = await updateInfo(true);
      if (!info.git) {
        // release bundle: download, verify, swap the code, then restart from the new copy
        if (info.error) return json(res, 502, { error: info.error });
        try {
          const r = await release.apply(APP_ROOT);
          updateCache = { at: 0, data: null };
          const systemd = fs.existsSync('/run/systemd/system');
          json(res, 200, { ok: true, from: r.from, to: r.to, upToDate: !!r.upToDate, verified: !!r.verified,
            restart: systemd ? 'sudo systemctl restart musicfy' : 'musicfy restart', restarting: !systemd && !r.upToDate });
          if (!systemd && !r.upToDate) {
            // answer first: the restart replaces this process
            setTimeout(() => {
              try {
                const cli = path.join(APP_ROOT, 'bin', 'musicfy.mjs');
                const child = spawn(process.execPath, [cli, 'restart'], { detached: true, stdio: 'ignore' });
                child.unref();
              } catch {}
            }, 1200);
          }
          return;
        } catch (e) {
          return json(res, 500, { error: String(e.message || e).split('\n')[0].slice(0, 180) });
        }
      }
      if (info.error) return json(res, 502, { error: info.error });
      try {
        const updated = await gitUpdate(APP_ROOT, info.branch || 'main');
        updateCache = { at: 0, data: null };
        return json(res, 200, {
          ok: true, from: APP_VERSION, to: diskVersion(), mode: updated.mode, head: updated.head, backup: updated.backup,
          output: updated.output.slice(-1200), restart: (await updateInfo(false)).restart,
        });
      } catch (e) {
        return json(res, 500, { error: String(e.message || e).split('\n')[0].slice(0, 240) });
      }
    }

    if (u.pathname === '/api/settings') {
      const file = SETTINGS_FILE;
      if (req.method === 'GET') {
        let s = {};
        try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
        const cfg = llm.config() || {};
        return json(res, 200, {
          settings: { ...s, ui_tier: s.ui_tier === 'listener' ? 'listener' : 'dj',
            // a fresh install has no choice yet; the client asks once instead of guessing
            ui_tier_set: s.ui_tier === 'listener' || s.ui_tier === 'dj',
            // an install that already chose a mode before onboarding existed is onboarded:
            // replaying the first-run flow for it would ask a question it has answered
            onboarding_done: s.onboarding_done === true
              || (s.onboarding_done === undefined && (s.ui_tier === 'listener' || s.ui_tier === 'dj')),
            onboarding_step: Math.min(9, Math.max(0, Number(s.onboarding_step) || 0)),
            auto_download_plays: Number(setting('auto_download_plays', '2')) },
          version: APP_VERSION,
          storefront: storefront.current(),
          storefront_country: s.storefront_country || '',
          llm: { configured: !!llm.config(), base_url: cfg.base_url || '', model: cfg.model || '', has_key: !!cfg.api_key },
        });
      }
      if (req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        onEnd(req, res, async () => {
          let b = {};
          try { b = JSON.parse(body || '{}'); } catch {}
          // the endpoint is a URL a person typed: refuse one we cannot call, now, instead
          // of storing it and failing silently on the first question
          if (typeof b.llm_base_url === 'string' && b.llm_base_url.trim()) {
            try { llm.endpoint(b.llm_base_url); }
            catch (e) { return json(res, 400, { error: e.message }); }
          }
          let s = {};
          try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
          picksCache = { at: 0, data: null };
          for (const k of ['display_name', 'email', 'country', 'llm_base_url', 'llm_model', 'llm_api_key',
            'preferred_format', 'key_format', 'autoplay_next',
            'normalize_loudness', 'target_loudness', 'prefetch_ahead', 'ui_tier',
            'taste_genres', 'taste_artists', 'taste_context', 'taste_avoid', 'taste_include_children',
            'storefront_country', 'onboarding_done', 'onboarding_step', 'kids_name', 'kids_age']) {
            if (b[k] !== undefined) s[k] = b[k];
          }
          // setup state: a boolean, and the step reached, so an interrupted first run
          // resumes instead of starting over
          if (b.onboarding_done !== undefined) s.onboarding_done = b.onboarding_done === true;
          if (b.onboarding_step !== undefined) s.onboarding_step = Math.min(9, Math.max(0, Number(b.onboarding_step) || 0));
          // a storefront is two letters or empty (empty follows the geocoded country)
          if (b.storefront_country !== undefined) {            const cc = storefront.code(b.storefront_country);
            if (!cc) delete s.storefront_country;
            else s.storefront_country = cc;
          }
          // a time zone must be a real IANA name or the greeting silently falls back to UTC
          if (b.timezone !== undefined) {
            const tz = String(b.timezone).trim();
            if (!tz) delete s.timezone;
            else {
              try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); s.timezone = tz; }
              catch { /* keep the previous, valid zone */ }
            }
          }
          // a city is resolved to coordinates and time zone, so the greeting and weather are local
          if (b.city !== undefined) {
            const q = String(b.city).trim();
            if (!q) { delete s.city; delete s.latitude; delete s.longitude; }
            else {
              s.city = q;
              try {
                const g = JSON.parse(await httpGetTimed(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`));
                const hit = (g.results || [])[0];
                if (hit) {
                  s.city = hit.name || q;
                  s.country = hit.country_code || s.country || '';
                  s.latitude = hit.latitude;
                  s.longitude = hit.longitude;
                  if (hit.timezone) s.timezone = hit.timezone;
                }
              } catch {}
            }
          }
          if (s.ui_tier !== undefined) s.ui_tier = s.ui_tier === 'listener' ? 'listener' : 'dj';
          fs.mkdirSync(paths.DATA, { recursive: true });
          fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
          // auto-download threshold lives in the DB settings table, not settings.json
          if (b.auto_download_plays !== undefined) setSetting('auto_download_plays', Math.max(0, Math.min(50, Number(b.auto_download_plays) || 0)));
          // a model change takes effect immediately
          if (b.llm_base_url !== undefined || b.llm_model !== undefined || b.llm_api_key !== undefined) {
            try {
              const cur = llm.config() || {};
              const baseChanged = b.llm_base_url !== undefined && b.llm_base_url !== cur.base_url;
              llm.saveConfig({
                base_url: b.llm_base_url !== undefined ? b.llm_base_url : cur.base_url,
                model: b.llm_model !== undefined ? b.llm_model : cur.model,
                // changing the endpoint without a new key must not reuse the old key
                api_key: b.llm_api_key !== undefined ? b.llm_api_key : (baseChanged ? '' : cur.api_key),
              });
            } catch {}
          }
          return json(res, 200, { ok: true, settings: s });
        });
        return;
      }
    }

    // three tracks worth putting under the greeting, each with the reason it is there.
    // the reason is the whole point: a pick with no argument is a billboard.
    if (u.pathname === '/api/home/picks') {
      res.setHeader('cache-control', 'no-store');
      const nowTs = Math.floor(Date.now() / 1000);
      const fresh = u.searchParams.get('fresh') === '1';
      if (!fresh && picksCache.at && Date.now() - picksCache.at < 45000) return json(res, 200, picksCache.data);
      const includeChildren = tasteIncludeChildren();
      const child = includeChildren ? '' : "AND COALESCE(t.genre_family,'') != 'children'";
      const last = db.prepare(`SELECT t.id, t.artist, t.title, t.bpm, t.key, t.key_scale
        FROM listens l JOIN tracks t ON t.id=l.track_id WHERE 1=1 ${child} ORDER BY l.played_at DESC LIMIT 1`).get();
      const owned = `JOIN files f ON f.track_id=t.id AND f.tier='owned'`;
      const banned = tasteAvoid();
      const picks = [];
      const seen = new Set();
      const artistKey = (a) => String(a || '').split(/\s*(?:,|;|&|\bfeat\.?\b|\bft\.?\b|\bvs\.?\b|\bx\b)\s*/i)[0]
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const add = (row, reason) => {
        if (!row || seen.has(row.id) || picks.length >= 3) return;
        if (exclude.matches(banned, row)) return;   // what "keep out of picks" means
        if (!includeChildren && row.genre_family === 'children') return;
        // three picks by one artist is not a recommendation, it is a discography
        const a = artistKey(row.artist);
        if (a && picks.some((p) => artistKey(p.artist) === a)) return;
        seen.add(row.id);
        picks.push({
          id: row.id, title: row.title, artist: row.artist, has_art: !!row.has_art,
          bpm: row.bpm ? Math.round(row.bpm) : null, key: row.key || null, key_scale: row.key_scale || null,
          reason,
        });
      };
      // the artist you actually played most this week beats a guess
      const weekArtist = db.prepare(`SELECT t.artist a, COUNT(*) n FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE l.played_at >= ? AND t.artist IS NOT NULL AND t.artist != ''
        AND (${includeChildren ? '1=1' : "COALESCE(t.genre_family,'') != 'children'"})
        GROUP BY t.artist ORDER BY n DESC LIMIT 1`).get(nowTs - 7 * 86400);
      const addAny = (rows, reason) => { for (const r of rows) { if (!exclude.matches(banned, r)) { add(r, reason); return; } } };
      if (weekArtist && weekArtist.a && /[a-z]/i.test(weekArtist.a)) {
        addAny(db.prepare(`SELECT t.id,t.title,t.artist,t.album,t.genre,t.genre_family,t.has_art,t.bpm,t.key,t.key_scale FROM tracks t ${owned}
          WHERE t.artist=? AND NOT EXISTS (SELECT 1 FROM listens l WHERE l.track_id=t.id AND l.played_at > ?)
          ORDER BY RANDOM() LIMIT 12`).all(weekArtist.a, nowTs - 14 * 86400),
          `your artist of the week, unheard lately`);
      }
      if (last && last.artist && /[a-z]/i.test(last.artist)) {
        addAny(db.prepare(`SELECT t.id,t.title,t.artist,t.album,t.genre,t.genre_family,t.has_art,t.bpm,t.key,t.key_scale FROM tracks t ${owned}
          WHERE t.artist=? AND t.id<>? ORDER BY RANDOM() LIMIT 12`).all(last.artist, last.id),
          `more from ${last.artist}`);
      }
      if (last && last.key) {
        addAny(db.prepare(`SELECT t.id,t.title,t.artist,t.album,t.genre,t.genre_family,t.has_art,t.bpm,t.key,t.key_scale FROM tracks t ${owned}
          WHERE t.key=? AND t.id<>? AND NOT EXISTS (SELECT 1 FROM listens l WHERE l.track_id=t.id AND l.played_at > ?)
          ORDER BY RANDOM() LIMIT 12`).all(last.key, last.id, nowTs - 30 * 86400),
          `same key as “${String(last.title).slice(0, 22)}”`);
      }
      if (last && last.bpm) {
        addAny(db.prepare(`SELECT t.id,t.title,t.artist,t.album,t.genre,t.genre_family,t.has_art,t.bpm,t.key,t.key_scale FROM tracks t ${owned}
          WHERE t.bpm BETWEEN ? AND ? AND t.id<>? AND NOT EXISTS (SELECT 1 FROM listens l WHERE l.track_id=t.id)
          ORDER BY RANDOM() LIMIT 12`).all(last.bpm - 3, last.bpm + 3, last.id),
          `${Math.round(last.bpm)} BPM, never played`);
      }
      addAny(db.prepare(`SELECT t.id,t.title,t.artist,t.album,t.genre,t.genre_family,t.has_art,t.bpm,t.key,t.key_scale FROM tracks t ${owned}
        WHERE NOT EXISTS (SELECT 1 FROM listens l WHERE l.track_id=t.id) ORDER BY RANDOM() LIMIT 12`).all(),
        'in the library, never heard');
      addAny(db.prepare(`SELECT t.id,t.title,t.artist,t.album,t.genre,t.genre_family,t.has_art,t.bpm,t.key,t.key_scale, COUNT(l.track_id) n, MAX(l.played_at) last
        FROM tracks t ${owned} LEFT JOIN listens l ON l.track_id=t.id
        GROUP BY t.id HAVING n >= 3 AND last < ? ORDER BY n DESC LIMIT 12`).all(nowTs - 21 * 86400),
        'you wore this one out, then forgot it');
      // never hand back two when three were asked for, and never with a shrug twice
      const pickOne = (where, args) => db.prepare(`SELECT t.id,t.title,t.artist,t.album,t.genre,t.genre_family,t.has_art,t.bpm,t.key,t.key_scale
        FROM tracks t ${owned} WHERE t.id NOT IN (${[...seen].map(() => '?').join(',') || 'NULL'}) ${where}
        ORDER BY RANDOM() LIMIT 12`).all(...[...seen], ...args);
      if (picks.length < 3) {
        addAny(pickOne('AND NOT EXISTS (SELECT 1 FROM listens l WHERE l.track_id=t.id AND l.played_at > ?)', [nowTs - 60 * 86400]),
          'untouched for two months');
      }
      if (picks.length < 3) {
        addAny(pickOne('AND NOT EXISTS (SELECT 1 FROM listens l WHERE l.track_id=t.id)', []), 'in the library, never heard');
      }
      addAny(pickOne('', []), 'no reason, it just slaps');
      picksCache = { at: Date.now(), data: { picks } };
      return json(res, 200, { picks });
    }

    // personalised greeting: name from settings, time of day, live weather
    if (u.pathname === '/api/greeting') {
      let s = {};
      try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
      const rawName = String(s.display_name || '').trim().split(/\s+/)[0] || '';
      const name = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase() : '';
      const tz = s.timezone || 'UTC';
      let hour = new Date().getHours();
      try { hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date())); } catch {}
      if (hour === 24) hour = 0;
      const part = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
      const lat = Number(s.latitude);
      const lon = Number(s.longitude);
      const city = String(s.city || '');
      let weather = null;
      if (city && Number.isFinite(lat) && Number.isFinite(lon)) {
        const wkey = `${lat},${lon}`;
        if (weatherCache.key === wkey && Date.now() - weatherCache.at < 10 * 60 * 1000) {
          weather = weatherCache.data;
        } else {
          try {
            const w = await httpGetTimed(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
            const cur = (JSON.parse(w) || {}).current || {};
            weather = { temp: Math.round(Number(cur.temperature_2m)), word: weatherWord(cur.weather_code) };
            weatherCache = { at: Date.now(), key: wkey, data: weather };
          } catch {}
        }
      }
      const weatherLine = weather
        ? `${weather.temp}°C, ${weather.word}${city ? ` in ${city}` : ''}.`
        : (city ? `${city}.` : '');

      // one concrete observation about this listener, not a dashboard stat
      const nowTs = Math.floor(Date.now() / 1000);
      const includeChildren = tasteIncludeChildren();
      const child = includeChildren ? '' : "AND COALESCE(t.genre_family,'') != 'children'";
      const last = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.bpm, t.key, t.key_scale, t.has_art, l.played_at
        FROM listens l JOIN tracks t ON t.id=l.track_id ORDER BY l.played_at DESC LIMIT 1`).get();
      const weekArtist = db.prepare(`SELECT t.artist, COUNT(*) n FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE l.played_at >= ? AND t.artist IS NOT NULL AND t.artist != '' ${child}
        GROUP BY t.artist ORDER BY n DESC LIMIT 1`).get(nowTs - 7 * 86400);
      const weekTrack = db.prepare(`SELECT t.title, COUNT(*) n FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE l.played_at >= ? ${child} GROUP BY l.track_id ORDER BY n DESC LIMIT 1`).get(nowTs - 7 * 86400);
      // SQLite's 'localtime' is the server's timezone. A UTC VPS and a Sao Paulo listener
      // disagreed by three hours, so compute the listener's hour in JS from settings.timezone.
      const localHour = (ts) => {
        try {
          return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date(Number(ts) * 1000))) % 24;
        } catch { return new Date(Number(ts) * 1000).getHours(); }
      };
      const hourCounts = new Map();
      const hourRows = db.prepare(`SELECT l.played_at ts, t.genre_family f FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE l.played_at >= ? AND t.genre_family IS NOT NULL AND t.genre_family != '' ${child}`).all(nowTs - 120 * 86400);
      for (const r of hourRows) {
        const h = localHour(r.ts);
        const near = Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour)) <= 1;
        if (near) hourCounts.set(r.f, (hourCounts.get(r.f) || 0) + 1);
      }
      let hourFamily = null;
      for (const [f, n] of hourCounts) if (!hourFamily || n > hourFamily.n) hourFamily = { f, n };
      const tempo = db.prepare(`SELECT ROUND(AVG(t.bpm)) b, COUNT(*) n FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE l.played_at >= ? AND t.bpm IS NOT NULL AND t.bpm > 0 ${child}`).get(nowTs - 7 * 86400);
      const weekNew = db.prepare(`SELECT COUNT(*) c FROM tracks WHERE added_at >= ?`).get(nowTs - 7 * 86400).c;
      const weekNewUnheard = db.prepare(`SELECT COUNT(*) c FROM tracks t WHERE t.added_at >= ? AND NOT EXISTS
        (SELECT 1 FROM listens l WHERE l.track_id=t.id)`).get(nowTs - 7 * 86400).c;
      const staleAlbum = db.prepare(`SELECT t.album a, COUNT(*) n, MAX(l.played_at) last FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE t.album IS NOT NULL AND t.album != '' ${child} GROUP BY t.album HAVING n >= 4 AND last IS NOT NULL AND last < ?
        ORDER BY n DESC LIMIT 1`).get(nowTs - 21 * 86400);
      const topCounts = new Map();
      for (const r of db.prepare('SELECT played_at ts FROM listens').all()) {
        const h = localHour(r.ts);
        topCounts.set(h, (topCounts.get(h) || 0) + 1);
      }
      let topHour = null;
      for (const [h, n] of topCounts) if (!topHour || n > topHour.n) topHour = { h, n };

      const hhmm = (ts) => {
        try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(ts * 1000)); }
        catch { return ''; }
      };
      const candidates = [];
      if (last && nowTs - last.played_at < 8 * 3600) {
        candidates.push(`You left off on “${last.title}”${hhmm(last.played_at) ? ` at ${hhmm(last.played_at)}` : ''}.`);
      }
      if (weekTrack && weekTrack.n >= 4) candidates.push(`“${weekTrack.title}”, ${weekTrack.n} times this week.`);
      if (weekArtist && weekArtist.n >= 3) candidates.push(`${weekArtist.artist}, ${weekArtist.n} plays this week.`);
      if (weekNew) candidates.push(`${weekNew} new track${weekNew === 1 ? '' : 's'} this week${weekNewUnheard ? `; ${weekNewUnheard} still unheard` : ''}.`);
      if (hourFamily && hourFamily.n >= 4) candidates.push(`At this hour you usually reach for ${hourFamily.f}.`);
      if (staleAlbum) candidates.push(`“${staleAlbum.a}” hasn't been on in ${Math.floor((nowTs - staleAlbum.last) / 86400)} days.`);
      if (tempo && tempo.n >= 10 && tempo.b) candidates.push(`${tempo.b} BPM, more or less all week.`);
      if (topHour && topHour.n >= 20) candidates.push(`${String(topHour.h).padStart(2, '0')}:00 is your hour.`);

      const day = Math.floor(nowTs / 86400);
      const seed = Math.abs(hour * 7 + day) % Math.max(1, candidates.length);
      // a track that just played is the most alive thing we know, so it wins
      const fresh = last && nowTs - last.played_at < 3 * 3600 ? candidates[0] : null;
      const music = fresh || candidates[seed] || (topHour ? `${String(topHour.h).padStart(2, '0')}:00 is your hour.` : '');
      const sub = [music, weatherLine].filter(Boolean).join(' · ');
      const line = weatherLine;
      const fact = music;
      const plays = db.prepare('SELECT COUNT(*) c FROM listens').get().c;
      const tracks = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
      const artists = db.prepare("SELECT COUNT(DISTINCT artist) c FROM tracks WHERE artist IS NOT NULL AND artist != ''").get().c;
      const addedWeek = weekNew;
      const session = sessionSummary();

      let compatible = null;
      try {
        const seed = mixSeed();
        if (seed && seed.bpm) {
          const recent = db.prepare(`SELECT track_id FROM listens WHERE played_at >= ?`).all(nowTs - 60 * 60).map((r) => r.track_id);
          const list = mixCandidates(seed, 25, recent);
          // the count is not shown anywhere: what matters is that there is a set at all
          compatible = { ok: list.length > 0, bpm: Math.round(seed.bpm), key: seed.key || null, key_scale: seed.key_scale || null,
            seed: { id: seed.id, title: seed.title, artist: seed.artist }, exact: !!seed.exact };
        }
      } catch {}

      const lastOut = last ? {
        id: last.id, title: last.title, artist: last.artist, album: last.album,
        bpm: last.bpm ? Math.round(last.bpm) : null, key: last.key || null,
        key_scale: last.key_scale || null, has_art: !!last.has_art, at: last.played_at,
      } : null;
      return json(res, 200, {
        name, part, hour, weather, city, sub, line, fact, last: lastOut,
        // what this listener usually reaches for at this hour: useful, not decorative
        hourFamily: hourFamily ? { family: hourFamily.f, count: hourFamily.n } : null,
        session, compatible,
        stats: { plays, tracks, artists, addedWeek },
      });
    }

    // dynamic Ask suggestions from what you actually play this week
    if (u.pathname === '/api/ask/suggest') {
      res.setHeader('cache-control', 'no-store');
      const week = now() - 7 * 86400;
      const includeChildren = tasteIncludeChildren();
      const child = includeChildren ? '' : "AND COALESCE(t.genre_family,'') != 'children'";
      const topArtists = db.prepare(`SELECT t.artist, COUNT(*) n FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE l.played_at>=? AND t.artist IS NOT NULL AND t.artist!='' ${child} GROUP BY t.artist ORDER BY n DESC LIMIT 5`).all(week).map((r) => r.artist);
      const keys = db.prepare(`SELECT t.key k, t.key_scale s, COUNT(*) n FROM tracks t
        JOIN files f ON f.track_id=t.id AND f.tier='owned'
        WHERE t.key IS NOT NULL AND t.key!='' GROUP BY t.key, t.key_scale ORDER BY n DESC LIMIT 3`).all();
      const fams = db.prepare(`SELECT genre_family f, COUNT(*) n FROM tracks WHERE genre_family IS NOT NULL AND genre_family!=''
        ${includeChildren ? '' : "AND genre_family != 'children'"}
        GROUP BY genre_family ORDER BY n DESC LIMIT 3`).all().map((r) => r.f);
      const bpmRow = db.prepare(`SELECT AVG(bpm) a FROM tracks WHERE bpm IS NOT NULL AND bpm>0`).get();
      const recent = db.prepare(`SELECT t.artist FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE l.played_at>=? AND t.artist IS NOT NULL AND t.artist!='' ${child} GROUP BY l.track_id ORDER BY MAX(l.played_at) DESC LIMIT 4`).all(week).map((r) => r.artist);
      // a tag can be bars or dashes rather than a name: "more from ||||||||" is not a prompt
      const named = (a) => /[a-z]/i.test(String(a || ''));
      /* Half the suggestions go outside the library. They used to be library queries
         only ("tracks in Gm I have not played"), so pressing one taught the user that
         A&R is a filter for their own shelf — the opposite of what it does. */
      const discovery = [];
      const lead = topArtists.filter(named)[0] || recent.filter(named)[0];
      if (lead) discovery.push(`10 tracks by ${lead} I don't have`);
      if (fams[0]) discovery.push(`10 ${fams[0]} tracks I don't have`);
      else if (keys[0]) discovery.push(`10 tracks in ${keys[0].k}${keys[0].s === 'minor' ? 'm' : ''} I don't have`);
      if (discovery.length < 2 && topArtists.filter(named)[1]) discovery.push(`10 tracks by ${topArtists.filter(named)[1]} I don't have`);
      // a fresh or empty library has no artist/family to derive from; the outside half
      // must still exist, or a new install only ever sees the library prompts
      if (!discovery.length) discovery.push("10 ambient tracks I don't have", "10 electronic tracks I don't have");

      const local = [];
      for (const k of keys.slice(0, 2)) local.push(`tracks in ${k.k}${k.s === 'minor' ? 'm' : ''} I have not played`);
      for (const f of fams.slice(0, 2)) local.push(`${f} I never played`);
      if (bpmRow && bpmRow.a) { const b = Math.round(bpmRow.a); local.push(`tracks around ${b} bpm`); }
      local.push('tracks I have not played in months', 'tracks added this week', 'tracks under 3 minutes');
      // shuffle each half, then alternate: discovery first, but never four of one kind
      const mix = (arr) => { const a = [...new Set(arr)]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      const d = mix(discovery).slice(0, 2);
      const l = mix(local).slice(0, 2);
      return json(res, 200, { prompts: [d[0], l[0], d[1], l[1]].filter(Boolean) });
    }

    // the tracks the library count is missing, so the drawer can show them
    if (u.pathname === '/api/downloads/missing' && req.method === 'GET') {
      const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album FROM tracks t
        WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')
          AND COALESCE(t.format,'') != 'catalogue'
        ORDER BY t.artist, t.title LIMIT 200`).all();
      return json(res, 200, { count: rows.length, tracks: rows });
    }

    // the queue that follows what you last played
    if (u.pathname === '/api/mix/next') {
      const seed = mixSeed();
      if (!seed) return json(res, 200, { seed: null, tracks: [] });
      const recent = db.prepare(`SELECT track_id FROM listens WHERE played_at >= ?`).all(now() - 3600).map((r) => r.track_id);
      const bannedMix = tasteAvoid();
      const tracks = mixCandidates(seed, Math.min(Number(u.searchParams.get('limit')) || 25, 100), recent)
        .filter((t) => !bannedMix.length || !exclude.matches(bannedMix, t))
        .map((t) => ({ ...t, owned: 1, rung: 'local' }));
      return json(res, 200, { seed: { id: seed.id, title: seed.title, bpm: Math.round(seed.bpm), key: seed.key, key_scale: seed.key_scale }, tracks });
    }

    // what arrived most recently, newest first
    if (u.pathname === '/api/library/recent-downloads') {
      const rows = db.prepare(`SELECT t.*, 1 AS owned, f.bitrate, r.rung, r.quality, f.mtime
        FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
        LEFT JOIN resolutions r ON r.track_id=t.id
        ORDER BY COALESCE(f.mtime, 0) DESC LIMIT 60`).all();
      return json(res, 200, rows);
    }

    // metadata repair: propose, then apply on request
    const mRepair = u.pathname.match(/^\/api\/repair\/(\d+)$/);
    if (mRepair) {
      const proposal = await repair.propose(db, Number(mRepair[1]));
      if (!proposal) return json(res, 404, { error: 'no such track' });
      return json(res, 200, proposal);
    }
    const mRepairApply = u.pathname.match(/^\/api\/repair\/(\d+)\/apply$/);
    if (mRepairApply && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let fields = {};
        try { fields = JSON.parse(body || '{}'); } catch {}
        const r = repair.apply(db, Number(mRepairApply[1]), fields);
        return json(res, r.error ? 409 : 200, r);
      });
      return;
    }

    // agent: one sentence, up to three intents, executed deterministically
    if (u.pathname === '/api/agent' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        // the interface language travels with the request; the agent answers in it rather
        // than the page translating the answer afterwards
        const lang = String(b.lang || req.headers['x-mf-lang'] || 'en').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
        const q = agent.cleanQuery(String(b.q || '')).trim();
        if (!q) return json(res, 400, { error: 'q required' });
        const ql0 = q.toLowerCase().replace(/[?.!]+$/, '').trim();
        // These two have one correct answer. A planner that reads "what can you do" as a
        // search for the word "do" is not helping anybody; answer them here.
        if (/^(help|capabilities|what can you do|what do you do|what can you help with|how can you help|who are you|what is this|ajuda|o que (?:voc[eê]|vc) (?:pode|faz|sabe)(?: fazer)?|quem (?:é|e) (?:voc[eê]|vc))$/.test(ql0)) {
          const help = helpPayload(lang);
          return json(res, 200, { question: q, source: 'help', lang, count: 0, results: [], filters: null, answer: help.answer, examples: help.examples });
        }
        if (/(?:how much of my library has audio|how many tracks have audio|quanta da minha biblioteca tem [aá]udio|quantas faixas (?:da|na) (?:minha )?biblioteca t[eê]m [aá]udio)/i.test(q)) {
          const result = await agent.execute(db, { intent: 'report_library', args: { query: '' } }, { enqueueTrackDownload }, lang);
          if (result && result.spoken) result.spoken = agent.localizeReason(result.spoken, lang);
          return json(res, 200, { question: q, plan: { intent: 'report_library', args: { query: '' } }, source: 'rules', lang, ...result });
        }
        // a short "make it darker" points at the previous draft, not at the library
        const previous = (b.previous && b.previous.plan) ? b.previous : null;
        const followUp = !!previous && agent.isFollowUp(q);
        // the local planner covers the clear verbs instantly; only an ambiguous request
        // pays the model round trip, so a 5 second provider cannot slow a simple command
        let plan = followUp ? agent.mergePlan(previous, q) : agent.planLocally(q);
        let source = followUp ? 'follow-up' : 'rules';
        // A&R is a natural-language request: when a model is configured it reads every
        // sentence, not only the ones a regex guesses are hard. The rules planner stays as
        // the fallback for a timeout, an empty completion or no model at all.
        const richBrief = /\b(for my|for a|for the|she likes|he likes|they like|who likes|likes|don'?t limit|birthday|wedding|party for|kids?|children|story time|year old|\d+\s*yo|about (unicorns?|robots?|dinosaurs?|space|animals?))\b/i.test(q);
        if (llm.available()) {
          try {
            // the plan has one 45s budget and owns it: a race left the losing request
            // running after the answer, and the model kept billing for nothing
            const modelPlan = await agent.planWithModel(llm, q, previous, lang, 45000);
            if (modelPlan && modelPlan.intent) {
              // the model's plan wins what it answered; the rules fill only what is missing
              modelPlan.args = { ...(plan.args || {}), ...(modelPlan.args || {}) };
              modelPlan.args.query = modelPlan.args.query || plan.args.query || q;
              if (richBrief) modelPlan.args.brief = true;
              plan = modelPlan;
              source = followUp ? 'follow-up+llm' : 'llm';
            }
          } catch (e) { console.log('[agent] model plan failed:', String(e.message || e).slice(0, 160)); }
        }
        if (plan.intent === 'artist_albums') {
          const r = await agent.artistAlbums(db, plan.args.artist || plan.args.query);
          return json(res, 200, { question: q, plan, source, lang, ...r, action: r });
        }
        /* "I don't have" is a request for music that is not here. The model sometimes
           files it as a library search; that answer is the opposite of the question. */
        const outsideAsk = /\b(?:not in (?:my|the) library|outside (?:my|the) library|don'?t have|do not have|i don'?t own|unheard|new to me|discover)\b/i.test(q);
        if (outsideAsk && (plan.intent === 'search_tracks' || plan.intent === 'report_library')) {
          const a = plan.args || {};
          plan = { intent: 'build_playlist', args: { ...a, query: q, count: Number(a.count) || Number(a.limit) || 20, download: false } };
          source = `${source}+outside`;
        }
        // read-only intents answer now; mutations become a proposal until confirmed
        if (plan.intent === 'report_library' || plan.intent === 'search_tracks') {
          const result = await agent.execute(db, plan, { enqueueTrackDownload }, lang);
          if (result && result.spoken) result.spoken = agent.localizeReason(result.spoken, lang);
          // a discovery draft needs the same one-time id a playlist draft gets, or the
          // confirm button has nothing to confirm
          if (result && result.action) result.action = { ...result.action, id: stashAction(result.action) };
          return json(res, 200, { question: q, plan, source, lang, ...result });
        }
        const proposal = await agent.propose(db, plan, lang);
        if (!proposal) {
          if (plan.intent === 'build_playlist') {
            return json(res, 200, { question: q, plan, source, spoken: 'I could not find tracks for that, in the library or online.', data: {} });
          }
          const result = await agent.execute(db, plan, { enqueueTrackDownload }, lang);
          return json(res, 200, { question: q, plan, source, lang, ...result });
        }
        // a proposal that turned out to need nothing: answer, do not offer a draft
        if (proposal.kind === 'none') {
          return json(res, 200, { question: q, plan, source, spoken: proposal.reason, data: {} });
        }
        const id = stashAction(proposal);
        return json(res, 200, { question: q, plan, source, spoken: proposal.reason, lang, action: { id, ...proposal } });
      });
      return;
    }

    const mAgentAction = u.pathname.match(/^\/api\/agent\/action\/([\w-]+)$/);
    if (mAgentAction && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const a = takeAction(mAgentAction[1]);
        if (!a) return json(res, 410, { error: 'this proposal expired; ask again' });
        if (b.cancel) return json(res, 200, { ok: true, cancelled: true });
        // the client may choose "playlist only" or "create and download" at confirm time
        if (b.download === true) a.proposal.download = true;
        const lang = String(req.headers['x-mf-lang'] || 'en').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
        const result = agent.commit(db, a.proposal, { enqueueTrackDownload }, lang);
        return json(res, 200, { ok: true, ...result });
      });
      return;
    }

    // name an auto-playlist from what it actually contains, not a week number
    function recommendName(profile, picks) {
      const fam = profile && profile.topFamily ? String(profile.topFamily).replace(/_/g, ' ') : null;
      const bpm = profile && profile.avgBpm ? `${profile.avgBpm} BPM` : null;
      const keyCount = {};
      for (const p of picks || []) {
        if (!p.key) continue;
        const k = `${p.key}${p.key_scale === 'minor' ? 'm' : ''}`;
        keyCount[k] = (keyCount[k] || 0) + 1;
      }
      const key = Object.entries(keyCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const parts = [fam, key, bpm].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'Your rotation';
    }

    // recommendations driven by current listening
    if (u.pathname === '/api/recommend') {
      const days = Math.min(Number(u.searchParams.get('days') || 30), 365);
      const limit = Math.min(Number(u.searchParams.get('limit') || 40), 100);
      return json(res, 200, recommend.build(db, { days, limit, avoid: tasteAvoid(), includeChildren: tasteIncludeChildren() }));
    }
    // Flow: one-tap infinite mix. discovery=0 (safe rotation) .. 100 (all unheard), genre optional.
    if (u.pathname === '/api/flow') {
      const genre = (u.searchParams.get('genre') || '').trim().toLowerCase();
      const discovery = Math.max(0, Math.min(100, Number(u.searchParams.get('discovery') || 30)));
      const out = recommend.build(db, { days: 30, limit: 200, avoid: tasteAvoid(), includeChildren: tasteIncludeChildren() });
      let picks = out.picks;
      if (genre) picks = picks.filter((p) => `${p.genre_family || ''} ${p.genre || ''}`.toLowerCase().includes(genre));
      if (!picks.length) return json(res, 200, { count: 0, tracks: [], profile: out.profile });
      const unheard = picks.filter((p) => !p.plays);
      const known = picks.filter((p) => p.plays);
      const nNew = Math.round(picks.length * discovery / 100);
      const mix = [...unheard.slice(0, nNew), ...known.slice(0, Math.max(0, picks.length - nNew))];
      // interleave so the mix does not run all-new then all-known
      const order = mix.sort(() => Math.random() - 0.5).slice(0, 50);
      const ids = order.map((p) => p.id);
      if (!ids.length) return json(res, 200, { count: 0, tracks: [], profile: out.profile });
      const ph = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT t.*, 1 AS owned, f.bitrate, r.rung, r.quality
        FROM tracks t
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id
        WHERE t.id IN (${ph})`).all(...ids);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const tracks = ids.map((id) => byId.get(id)).filter(Boolean);
      return json(res, 200, { count: tracks.length, tracks, profile: out.profile, discovery, genre: genre || null });
    }
    // one playlist per week, excluding anything already in a playlist
    if (u.pathname === '/api/recommend/weekly' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const now2 = new Date();
        const jan1 = new Date(Date.UTC(now2.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((now2 - jan1) / 86400000) + jan1.getUTCDay() + 1) / 7);
        const days = Math.min(Number(b.days || 30), 365);
        const out = recommend.build(db, { days, limit: Math.min(Number(b.limit || 25), 100), excludePlaylisted: true, avoid: tasteAvoid(), includeChildren: tasteIncludeChildren() });
        const inAnyPlaylist = new Set(db.prepare('SELECT DISTINCT track_id id FROM playlist_tracks').all().map((r) => r.id));
        const picks = out.picks.filter((p) => !inAnyPlaylist.has(p.id));
        const name = `${recommendName(out.profile, picks)} · W${String(week).padStart(2, '0')}`;
        const existing = db.prepare('SELECT id FROM playlists WHERE name=?').get(name);
        if (existing) {
          const n = db.prepare('SELECT COUNT(*) c FROM playlist_tracks WHERE playlist_id=?').get(existing.id).c;
          return json(res, 200, { created: null, existing: { id: existing.id, name, tracks: n }, reason: 'this week already has a list' });
        }
        if (!picks.length) return json(res, 200, { created: null, reason: 'nothing new to add this week' });
        const pid = `rec-${Date.now().toString(36)}`;
        db.prepare('INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(pid, name, 'recommend', 'listen', now(), now());
        let pos = 0;
        for (const p of picks) db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)').run(pid, p.id, pos++, now());
        return json(res, 200, { created: { id: pid, name, tracks: pos }, profile: out.profile });
      });
      return;
    }

    if (u.pathname === '/api/recommend/create' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const days = Math.min(Number(b.days || 30), 365);
        const limit = Math.min(Number(b.limit || 25), 100);
        const out = recommend.build(db, { days, limit, avoid: tasteAvoid(), includeChildren: tasteIncludeChildren() });
        if (!out.picks.length) return json(res, 200, { created: null, reason: 'not enough listening history yet' });
        const name = String(b.name || `${recommendName(out.profile, out.picks)} · ${new Date().toISOString().slice(0, 10)}`).slice(0, 80);
        const pid = `rec-${Date.now().toString(36)}`;
        db.prepare('INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)')
          .run(pid, name, 'recommend', 'listen', now(), now());
        let pos = 0;
        for (const p of out.picks) {
          db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)').run(pid, p.id, pos++, now());
        }
        return json(res, 200, { created: { id: pid, name, tracks: pos }, profile: out.profile });
      });
      return;
    }

    // what has actually been played recently, for the recommender
    if (u.pathname === '/api/listens/recent') {
      const days = Math.min(Number(u.searchParams.get('days') || 30), 365);
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const rows = db.prepare(`SELECT l.track_id, COUNT(*) plays, MAX(l.played_at) last,
          t.title, t.artist, t.genre_family, t.bpm, t.key
        FROM listens l JOIN tracks t ON t.id = l.track_id
        WHERE l.played_at >= ? GROUP BY l.track_id ORDER BY plays DESC, last DESC LIMIT 200`).all(since);
      return json(res, 200, { days, tracks: rows });
    }

    // fill genre tags from MusicBrainz artist metadata
    if (u.pathname === '/api/genre/run' && req.method === 'POST') {
      if (genreJob.running) return json(res, 409, { started: false, running: true, ...genreJob });
      const limit = Math.min(Number(u.searchParams.get('limit') || 120), 600);
      const loop = u.searchParams.get('all') === '1';
      Object.assign(genreJob, { running: true, startedAt: Date.now(), passes: 0, last: null, checked: 0, tagged: 0, families: 0, error: null });
      (async () => {
        let guard = 0;
        for (;;) {
          // live counters: a batch of 200 artists is eight minutes, and a status that
          // sits at 0 until the end is indistinguishable from a dead button
          const base = { checked: genreJob.checked, tagged: genreJob.tagged, families: genreJob.families };
          const r = await genre.fillTracks(db, {
            limit,
            onProgress: (p) => { genreJob.checked = base.checked + p.checked; genreJob.tagged = base.tagged + p.tagged; },
          });
          Object.assign(genreJob, { passes: genreJob.passes + 1, last: r, checked: base.checked + (r.artistsChecked || 0), tagged: base.tagged + (r.tagged || 0), families: base.families + (r.families || 0) });
          console.log('[genre]', JSON.stringify(r));
          guard += 1;
          if (!loop || !r.remainingArtists || guard > 40) break;
          await new Promise((res2) => setTimeout(res2, 2000));
        }
      })().catch((e) => { genreJob.error = String(e.message || e).slice(0, 140); console.error('[genre]', e.message); })
        .finally(() => { genreJob.running = false; genreJob.finishedAt = Date.now(); });
      return json(res, 202, { started: true, limit, loop, running: true });
    }
    if (u.pathname === '/api/genre/status') {
      const total = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
      const tagged = db.prepare("SELECT COUNT(*) c FROM tracks WHERE genre IS NOT NULL AND genre != ''").get().c;
      const families = db.prepare("SELECT genre_family g, COUNT(*) c FROM tracks WHERE genre_family IS NOT NULL GROUP BY g ORDER BY c DESC").all();
      return json(res, 200, { total, tagged, untagged: total - tagged, families, job: genreJob });
    }

    // ask the library a question in plain language, optionally creating a playlist
    // short preview for any result, including catalogue rows without an iTunes preview
    if (u.pathname === '/api/preview') {
      const title = String(u.searchParams.get('title') || '').trim();
      const artist = String(u.searchParams.get('artist') || '').trim();
      const duration = Number(u.searchParams.get('duration')) || null;
      if (!title) return json(res, 400, { error: 'title required' });
      const key = `${artist}|${title}`.toLowerCase();
      const hit = previewCache.get(key);
      if (hit && Date.now() - hit.at < 30 * 60 * 1000) return json(res, 200, hit.data);
      try {
        const best = await resolveBest({ title, artist, duration }, 1800);
        if (!best) return json(res, 404, { error: 'no preview source' });
        let url = null;
        if (best.rung === 'yt-dlp' || best.rung === 'ytmusic' || best.rung === 'ytmusic-album') url = `/api/ladder/stream/youtube/${best.id}`;
        else if (best.rung === 'soundcloud') url = `/api/ladder/stream/soundcloud?u=${encodeURIComponent(best.url)}`;
        else if (best.url) url = `/api/ladder/stream/generic?u=${encodeURIComponent(best.url)}`;
        if (!url) return json(res, 404, { error: 'no preview source' });
        const data = { url, rung: best.rung, title: best.title, artist: best.artist };
        previewCache.set(key, { at: Date.now(), data });
        if (previewCache.size > 200) previewCache.delete(previewCache.keys().next().value);
        return json(res, 200, data);
      } catch (e) { return upstreamError(res, e, '/api/preview'); }
    }

    if (u.pathname === '/api/ask' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const question = agent.cleanQuery(String(b.q || '')).trim();
        if (!question) return json(res, 400, { error: 'q required' });

        // capability questions are answered directly: they are not a library search,
        // and letting the text parser turn "can you assist" into keywords is nonsense
        const ql = question.toLowerCase().replace(/[?.!]+$/, '').trim();
        const askLang = String(req.headers['x-mf-lang'] || b.lang || 'en').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
        const wantsHelp = /^(help|capabilities|what can you do|what do you do|what can you (?:assist|help)(?: me)? with|how can you help|who are you|what is this|what are you)$/.test(ql)
          || /^what can you (?:do|assist|help)\b/.test(ql)
          // Portuguese capability questions reached the text parser and answered with a search
          || /^(ajuda|socorro|o que (?:voc[eê]|vc) (?:pode|faz|sabe)(?: fazer)?|quem (?:é|e) (?:voc[eê]|vc)|para que serve|como (?:voc[eê]|vc) (?:ajuda|funciona))$/.test(ql);
        if (wantsHelp) {
          const help = helpPayload(askLang);
          return json(res, 200, {
            question, source: 'help', lang: askLang, count: 0, results: [], filters: null,
            answer: help.answer, examples: help.examples,
          });
        }

        // follow-ups: carry the previous filters and apply only what the new words change
        const prev = b.previous && typeof b.previous === 'object' ? b.previous : null;
        let filters = null;
        let source = 'rules';
        if (prev) {
          const delta = queryEngine.parse(question, db);
          const merged = { ...prev };
          for (const k of ['key', 'scale', 'bpm', 'year', 'genre', 'genreLike', 'family', 'owned', 'plays', 'order', 'text']) {
            if (delta[k] !== undefined) merged[k] = delta[k];
          }
          if (/\b(make it|give me|only|just)\b.*\d/.test(question.toLowerCase())) merged.limit = delta.limit;
          if (/\bmore\b/.test(question.toLowerCase()) && !/\d/.test(question)) merged.limit = Math.min((prev.limit || 50) * 2, 200);
          if (/\b(fewer|less)\b/.test(question.toLowerCase())) merged.limit = Math.max(Math.floor((prev.limit || 50) / 2), 5);
          filters = merged;
          source = 'followup';
        }
        if (!filters) {
          const local = queryEngine.parse(question, db);
          const meaningful = local.key || local.bpm || local.year || local.genre || local.family
            || local.owned !== undefined || local.plays || (local.order && local.order !== 'relevance');
          if (meaningful || !llm.available()) filters = local;
          else {
            try {
              // only fuzzy phrasing pays the model round trip
              const out = await Promise.race([
                llm.ask(question),
                new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
              ]);
              if (out && out.filters) { filters = out.filters; source = 'llm'; }
              if (out && out.title) b.title = b.title || out.title;
            } catch (e) { /* fall back to the deterministic parser */ }
            if (!filters) filters = local;
          }
        }
        filters.limit = Math.min(Number(filters.limit) || 50, 200);

        let rows = queryEngine.run(db, filters);
        let relaxed = null;
        // a genre the library does not carry must not empty the answer
        if (!rows.length && (filters.genre || filters.genreLike)) {
          relaxed = { ...filters };
          delete relaxed.genre;
          delete relaxed.genreLike;
          rows = queryEngine.run(db, relaxed);
          if (rows.length) relaxed = 'genre filter dropped: nothing tagged that way yet';
        }

        let playlist = null;
        if (b.create && rows.length) {
          const name = String(b.name || b.title || question).slice(0, 80);
          const pid = `ask-${Date.now().toString(36)}`;
          db.prepare('INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)')
            .run(pid, name, 'ask', 'listen', now(), now());
          let pos = 0;
          for (const t of rows) {
            db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)')
              .run(pid, t.id, pos++, now());
          }
          playlist = { id: pid, name, tracks: rows.length };
        }

        return json(res, 200, {
          question, source, filters, relaxed,
          count: rows.length,
          results: rows.slice(0, 60),
          playlist,
        });
      });
      return;
    }

    // audio analysis: bpm, key, loudness, energy
    if (u.pathname === '/api/analyze/run' && req.method === 'POST') {
      const limit = Math.min(Number(u.searchParams.get('limit') || 200), 2000);
      const workers = Math.min(Number(u.searchParams.get('workers') || 2), 3);
      const scope = u.searchParams.get('mode') === 'outdated' ? 'outdated' : 'never';
      analyser.run(db, { limit, workers, scope }).then((r) => console.log('[analyze]', JSON.stringify(r))).catch((e) => console.error('[analyze]', e.message));
      return json(res, 202, { started: true, limit, workers, scope, status: analyser.status(db) });
    }
    if (u.pathname === '/api/analyze/status') {
      return json(res, 200, analyser.status(db));
    }
    // analyse a single track on demand (only the ones you play live need BPM/key)
    const mAnalyzeOne = u.pathname.match(/^\/api\/analyze\/track\/(\d+)$/);
    if (mAnalyzeOne && req.method === 'POST') {
      const tid = Number(mAnalyzeOne[1]);
      try {
        const r = await analyser.runOne(db, tid);
        return json(res, r.error ? 400 : 200, r);
      } catch (e) { return serverError(res, e, ''); }
    }
    // ---------- bulk crate/album maintenance ----------
    function playlistTrackIds(pid) {
      return db.prepare(`SELECT t.id FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        WHERE pt.playlist_id=? ORDER BY pt.position`).all(pid).map((r) => r.id);
    }
    function albumTrackIds(name) {
      return db.prepare('SELECT id FROM tracks WHERE lower(COALESCE(album,\'\'))=lower(?) ORDER BY id').all(name).map((r) => r.id);
    }
    async function coverTracks(ids) {
      const rows = db.prepare(`SELECT t.id, t.album, t.artist, t.title FROM tracks t WHERE t.id IN (${ids.map(() => '?').join(',') || 'NULL'})`).all(...ids);
      const groups = new Map();
      for (const r of rows) {
        const key = String(r.album || `single:${r.id}`).toLowerCase();
        if (!groups.has(key)) groups.set(key, { album: r.album || '', artist: r.artist || '', ids: [] });
        groups.get(key).ids.push(r.id);
      }
      let albums = 0, tracks = 0;
      for (const g of groups.values()) {
        let url = g.album ? await covers.artworkForAlbum(g.album, g.artist).catch(() => null) : null;
        if (!url) url = await covers.artworkFor(g.artist, g.album || '').catch(() => null);
        if (!url) continue;
        const buf = await fetchBuffer(url);
        if (!buf || !buf.length) continue;
        for (const id of g.ids) {
          try { await saveImageCover(buf, coverFile(id)); db.prepare('UPDATE tracks SET has_art=1 WHERE id=?').run(id); tracks += 1; } catch {}
        }
        albums += 1;
      }
      return { albums, tracks };
    }
    function upgradeTracks(ids) {
      let queued = 0, checked = 0;
      for (const id of ids) {
        const t = db.prepare(`SELECT t.id,t.title,t.artist,t.duration,f.bitrate FROM tracks t
          LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1) WHERE t.id=?`).get(id);
        if (!t) continue;
        checked += 1;
        if (Number(t.bitrate || 0) > 0 && Number(t.bitrate) >= 180000) continue;
        if (enqueueTrackDownload(t)) queued += 1;
      }
      return { checked, queued };
    }

    const mPlRepair = u.pathname.match(/^\/api\/playlists\/([^/]+)\/repair$/);
    if (mPlRepair && req.method === 'GET') {
      const j = repairJobs.get(decodeURIComponent(mPlRepair[1]));
      return json(res, 200, j || { running: false, total: 0, done: 0, fixed: 0, same: 0, failed: 0, fields: {}, changes: [] });
    }
    if (mPlRepair && req.method === 'POST') {
      const pid = decodeURIComponent(mPlRepair[1]);
      const ids = playlistTrackIds(pid);
      if (!ids.length) return json(res, 200, { started: false, count: 0, note: 'this playlist is empty' });
      const r = startRepairJob(pid, ids);
      return json(res, 202, { started: r.started, count: ids.length, job: r.job,
        note: r.started ? undefined : 'this playlist is already being repaired' });
    }
    const mPlCovers = u.pathname.match(/^\/api\/playlists\/([^/]+)\/covers$/);
    if (mPlCovers && req.method === 'POST') {
      const ids = playlistTrackIds(decodeURIComponent(mPlCovers[1]));
      (async () => { const r = await coverTracks(ids); console.log('[crate covers]', r); })();
      return json(res, 202, { started: true, count: ids.length });
    }
    const mPlUpgrade = u.pathname.match(/^\/api\/playlists\/([^/]+)\/upgrade$/);
    if (mPlUpgrade && req.method === 'POST') {
      const r = upgradeTracks(playlistTrackIds(decodeURIComponent(mPlUpgrade[1])));
      return json(res, 202, { started: true, ...r });
    }
    // album cover candidates: a one-word title needs the artist attached, and the
    // person decides which scan is the right one
    const mAlCoverOpts = u.pathname.match(/^\/api\/albums\/([^/]+)\/cover-options$/);
    if (mAlCoverOpts && req.method === 'GET') {
      const album = decodeURIComponent(mAlCoverOpts[1]);
      let artist = String(u.searchParams.get('artist') || '').trim();
      if (!artist) {
        const row = db.prepare(`SELECT artist FROM tracks WHERE lower(COALESCE(album,''))=lower(?) AND artist IS NOT NULL AND artist != ''
          GROUP BY artist ORDER BY COUNT(*) DESC LIMIT 1`).get(album);
        artist = row ? row.artist : '';
      }
      const want = album.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const who = artist.toLowerCase().split(/[,&]/)[0].trim();
      let hits = [];
      try { hits = await deezer.searchAlbums(`${artist} ${album}`.trim(), 20); } catch {}
      const seen = new Set();
      const options = hits.filter((x) => {
        const name = String(x.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (name !== want || !x.cover) return false;
        if (who && !String(x.artist || '').toLowerCase().includes(who)) return false;
        if (seen.has(x.cover)) return false;
        seen.add(x.cover);
        return true;
      }).map((x) => ({ name: x.name, artist: x.artist, cover: x.cover, tracks: x.tracks }));
      return json(res, 200, { album, artist, options });
    }
    // apply one chosen cover to every track on the album
    const mAlCover = u.pathname.match(/^\/api\/albums\/([^/]+)\/cover$/);
    if (mAlCover && req.method === 'POST') {
      const album = decodeURIComponent(mAlCover[1]);
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        let url = '';
        try { url = String(JSON.parse(body || '{}').url || ''); } catch { return json(res, 400, { error: 'bad request body' }); }
        if (!/^https:\/\/(cdn-images\.dzcdn\.net|is\d-ssl\.mzstatic\.com)\//.test(url)) {
          return json(res, 400, { error: 'only a catalogue image can be used here' });
        }
        const ids = db.prepare(`SELECT id FROM tracks WHERE lower(COALESCE(album,''))=lower(?)`).all(album).map((r) => r.id);
        if (!ids.length) return json(res, 404, { error: 'no such album' });
        const buf = await fetchBuffer(url, 20000, 15 * 1024 * 1024);
        if (!buf || !buf.length) return json(res, 502, { error: 'that image could not be fetched' });
        let done = 0;
        for (const id of ids) {
          try { await saveImageCover(buf, coverFile(id)); db.prepare('UPDATE tracks SET has_art=1 WHERE id=?').run(id); done += 1; }
          catch {}
        }
        return json(res, 200, { ok: true, count: done });
      });
      return;
    }

    const mAlRepair = u.pathname.match(/^\/api\/albums\/([^/]+)\/repair$/);
    if (mAlRepair && req.method === 'GET') {
      const j = repairJobs.get('album:' + decodeURIComponent(mAlRepair[1]));
      return json(res, 200, j || { running: false, total: 0, done: 0, fixed: 0, same: 0, failed: 0, fields: {}, changes: [] });
    }
    if (mAlRepair && req.method === 'POST') {
      const name = decodeURIComponent(mAlRepair[1]);
      const ids = albumTrackIds(name);
      if (!ids.length) return json(res, 200, { started: false, count: 0, note: 'this album has no tracks here' });
      const r = startRepairJob('album:' + name, ids);
      return json(res, 202, { started: r.started, count: ids.length, job: r.job,
        note: r.started ? undefined : 'this album is already being repaired' });
    }
    const mAlCovers = u.pathname.match(/^\/api\/albums\/([^/]+)\/covers$/);
    if (mAlCovers && req.method === 'POST') {
      const ids = albumTrackIds(decodeURIComponent(mAlCovers[1]));
      (async () => { const r = await coverTracks(ids); console.log('[album covers]', r); })();
      return json(res, 202, { started: true, count: ids.length });
    }
    const mAlUpgrade = u.pathname.match(/^\/api\/albums\/([^/]+)\/upgrade$/);
    if (mAlUpgrade && req.method === 'POST') {
      const r = upgradeTracks(albumTrackIds(decodeURIComponent(mAlUpgrade[1])));
      return json(res, 202, { started: true, ...r });
    }

    // analyse only the unanalyzed tracks in one playlist (a crate), in the background
    const mCrateAnalyze = u.pathname.match(/^\/api\/playlists\/([^/]+)\/analyze$/);
    // what the card needs to show: how many of how many, and whether it is still going
    if (mCrateAnalyze && req.method === 'GET') {
      const pid = decodeURIComponent(mCrateAnalyze[1]);
      const j = crateJobs.get(pid);
      if (!j) return json(res, 200, { running: false, total: 0, done: 0, failed: 0 });
      return json(res, 200, { running: !j.finishedAt, total: j.total, done: j.done, active: j.active || 0, failed: j.failed, at: j.at });
    }
    if (mCrateAnalyze && req.method === 'POST') {
      const pid = decodeURIComponent(mCrateAnalyze[1]);
      const plKind = db.prepare('SELECT kind FROM playlists WHERE id=?').get(pid);
      if (plKind && plKind.kind === 'listen') {
        return json(res, 200, { started: false, count: 0, note: 'this playlist is marked listening' });
      }
      if (crateJobs.has(pid) && !crateJobs.get(pid).finishedAt) {
        const j = crateJobs.get(pid);
        return json(res, 200, { started: false, count: j.total - j.done, note: 'this crate is already prepping' });
      }
      const force = u.searchParams.get('force') === '1';
      const V = analyser.ANALYSIS_VERSION;
      // A normal prep does the work the playlist actually needs: tracks never analysed,
      // tracks from an older analyser, and rows whose beat grid is missing. A forced pass
      // redoes every owned track, which is only for "analyse it again from scratch".
      const ids = (force
        ? db.prepare(`SELECT t.id FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
            JOIN files f ON f.track_id=t.id AND f.tier='owned'
            WHERE pt.playlist_id=?`)
        : db.prepare(`SELECT t.id FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
            JOIN files f ON f.track_id=t.id AND f.tier='owned'
            WHERE pt.playlist_id=? AND (t.analyzed_at IS NULL OR COALESCE(t.analysis_version,0) < ${V}
              OR t.beat_grid IS NULL OR t.beat_grid = '')`)
      ).all(pid).map((r) => r.id);
      if (!ids.length) return json(res, 200, { started: false, count: 0, note: 'this playlist is up to date with the current analyser' });
      crateJobs.set(pid, { total: ids.length, done: 0, failed: 0, at: Date.now(), finishedAt: 0 });
      (async () => {
        // two at a time: the analyser is one process per track, and a crate of forty
        // would otherwise keep the card counting for five minutes
        const queue = [...ids];
        const worker = async () => {
          for (;;) {
            const id = queue.shift();
            if (id == null) return;
            const j = crateJobs.get(pid);
            if (!j) return;
            j.active = (j.active || 0) + 1;
            try {
              const r = await analyser.runOne(db, id);
              if (r && r.error) j.failed += 1; else j.done += 1;
            } catch { j.failed += 1; }
            finally { j.active = Math.max(0, (j.active || 1) - 1); }
          }
        };
        await Promise.all([worker(), worker()]);
        const j = crateJobs.get(pid);
        if (j) { j.finishedAt = Date.now(); j.last = db.prepare(`SELECT COUNT(*) c FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
          JOIN files f ON f.track_id=t.id AND f.tier='owned'
          WHERE pt.playlist_id=? AND COALESCE(t.analysis_version,0) >= ${analyser.ANALYSIS_VERSION} AND t.beat_grid IS NOT NULL AND t.beat_grid != ''`).get(pid).c; }
        console.log('[crate analyze]', pid, `${j ? j.done : 0}/${ids.length}`, j && j.failed ? `${j.failed} failed` : '');
      })();
      return json(res, 202, { started: true, count: ids.length });
    }

    // write DJ tags into the file (Traktor PRIV + TBPM/TKEY). dryRun=1 previews, no write.
    const mTagOne = u.pathname.match(/^\/api\/tracks\/(\d+)\/tags$/);
    if (mTagOne && req.method === 'POST') {
      const tid = Number(mTagOne[1]);
      const dryRun = u.searchParams.get('dryRun') === '1';
      const plan = trackTagMeta(db, tid);
      if (plan.error) return json(res, 400, plan);
      try { return json(res, 200, tagwrite.writeTags(plan.path, plan.meta, { dryRun })); }
      catch (e) { return serverError(res, e, ''); }
    }
    const mTagPl = u.pathname.match(/^\/api\/playlists\/([^/]+)\/tags$/);
    if (mTagPl && req.method === 'POST') {
      const pid = decodeURIComponent(mTagPl[1]);
      const dryRun = u.searchParams.get('dryRun') === '1';
      const rows = db.prepare(`SELECT t.id FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id WHERE pt.playlist_id=? ORDER BY pt.position`).all(pid);
      const out = [];
      for (const { id } of rows) {
        const plan = trackTagMeta(db, id);
        if (plan.error) { out.push({ id, skipped: plan.error }); continue; }
        try { out.push({ id, ...tagwrite.writeTags(plan.path, plan.meta, { dryRun }) }); }
        catch (e) { out.push({ id, error: e.message }); }
      }
      return json(res, 200, { dryRun, count: out.length, results: out });
    }

    // re-download every track that lost its file, using the metadata we kept
    if (u.pathname === '/api/maintenance/redownload-missing' && req.method === 'POST') {
      const limit = Math.min(Number(u.searchParams.get('limit') || 500), 2000);
      const missing = db.prepare(`SELECT t.id, t.title, t.artist, t.duration FROM tracks t
        WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')
        AND t.title IS NOT NULL AND t.title != ''
        ORDER BY t.id LIMIT ?`).all(limit);
      const jobs = [];
      for (const t of missing) {
        const already = db.prepare("SELECT id FROM jobs WHERE (state='queued' OR state='running') AND payload LIKE ?").get(`%"trackId":${t.id}%`);
        if (already) continue;
        const jobId = crypto.randomUUID();
        db.prepare('INSERT INTO jobs (kind,payload,state,progress,created_at) VALUES (?,?,?,0,?)')
          .run('track-download', JSON.stringify({ jobId, trackId: t.id, title: t.title, artist: t.artist }), 'queued', now());
        jobs.push({ jobId, t });
      }
      (async () => {
        let cursor = 0;
        const worker = async () => {
          while (cursor < jobs.length) {
            const { jobId, t } = jobs[cursor++];
            try {
              const best = await resolveBest({ title: t.title, artist: t.artist, duration: t.duration }, 1800, { download: true });
              if (!best) {
                db.prepare("UPDATE jobs SET state='error', detail='no source', finished_at=? WHERE payload LIKE ?").run(now(), `%${jobId}%`);
                continue;
              }
              enqueueDownload(jobId, { trackId: t.id, rung: best.rung, id: best.id, url: best.url, thumb: best.thumb, isrc: best.isrc, file: best.handle?.file || best.file, title: t.title, artist: t.artist, duration: t.duration });
            } catch {}
          }
        };
        await Promise.all([worker(), worker(), worker()]);
      })();
      return json(res, 200, { missing: missing.length, queued: jobs.length });
    }

    // hide failed jobs from the queue view; the rows stay for audit
    if (u.pathname === '/api/downloads/clear-failed' && req.method === 'POST') {
      const r = db.prepare(`UPDATE jobs SET state='dismissed', finished_at=?
        WHERE state IN ('error','unavailable','cancelled','skipped') AND kind IN ('track-download','ladder-download')`).run(now());
      return json(res, 200, { cleared: r.changes || 0 });
    }

    // retry everything that failed
    if (u.pathname === '/api/downloads/retry-failed' && req.method === 'POST') {
      // 'unavailable' means the source was rejected or missing: that is a failure too,
      // and it used to be impossible to retry in bulk
      const failed = db.prepare("SELECT id, payload FROM jobs WHERE state IN ('error','unavailable') AND kind IN ('track-download','ladder-download') ORDER BY id DESC LIMIT 200").all();
      let queued = 0;
      const done = new Set();
      for (const job of failed) {
        let p = {};
        try { p = JSON.parse(job.payload); } catch {}
        if (!p.trackId || done.has(p.trackId)) continue;
        done.add(p.trackId);
        const t = db.prepare('SELECT id,title,artist,format FROM tracks WHERE id=?').get(p.trackId);
        if (!t || t.format === 'catalogue') continue;
        const owned = db.prepare("SELECT id FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(t.id);
        if (owned) { db.prepare("UPDATE jobs SET state='skipped', detail='already owned' WHERE id=?").run(job.id); continue; }
        const jobId = crypto.randomUUID();
        db.prepare('INSERT INTO jobs (kind,payload,state,progress,created_at) VALUES (?,?,?,0,?)')
          .run('track-download', JSON.stringify({ jobId, trackId: t.id, title: t.title, artist: t.artist }), 'queued', now());
        resolveBest({ title: t.title, artist: t.artist, duration: null }, 1800, { download: true })
          .then((best) => enqueueDownload(jobId, best
            ? { trackId: t.id, rung: best.rung, id: best.id, url: best.url, thumb: best.thumb, isrc: best.isrc, file: best.handle?.file || best.file, title: t.title, artist: t.artist }
            : { trackId: t.id, rung: 'search', title: t.title, artist: t.artist }))
          .catch(() => {});
        db.prepare("UPDATE jobs SET state='skipped', detail='requeued', finished_at=? WHERE id=?").run(now(), job.id);
        queued += 1;
      }
      return json(res, 200, { queued });
    }

    // retry one failed download
    const mRetry = u.pathname.match(/^\/api\/downloads\/(\d+)\/retry$/);
    if (mRetry && req.method === 'POST') {
      const id = Number(mRetry[1]);
      const job = db.prepare('SELECT payload FROM jobs WHERE id=?').get(id);
      if (!job) return json(res, 404, { error: 'no such job' });
      let p = {};
      try { p = JSON.parse(job.payload); } catch {}
      if (!p.trackId) return json(res, 400, { error: 'job has no track' });
      const t = db.prepare('SELECT id,title,artist FROM tracks WHERE id=?').get(p.trackId);
      if (!t) return json(res, 404, { error: 'track gone' });
      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO jobs (kind,payload,state,progress,created_at) VALUES (?,?,?,0,?)')
        .run('track-download', JSON.stringify({ jobId, trackId: t.id, title: t.title, artist: t.artist }), 'queued', now());
      resolveBest({ title: t.title, artist: t.artist, duration: null }, 1800, { download: true })
        .then((best) => {
          if (!best) { db.prepare("UPDATE jobs SET state='error', detail='no source', finished_at=? WHERE payload LIKE ?").run(now(), `%${jobId}%`); return; }
          enqueueDownload(jobId, { trackId: t.id, rung: best.rung, id: best.id, url: best.url, thumb: best.thumb, isrc: best.isrc, file: best.handle?.file || best.file, title: t.title, artist: t.artist });
        })
        .catch(() => {});
      db.prepare("UPDATE jobs SET state='skipped', detail='retried', finished_at=? WHERE id=?").run(now(), id);
      return json(res, 200, { job: jobId });
    }

    // cancel a queued or running download
    const mCancel = u.pathname.match(/^\/api\/downloads\/(\d+)\/cancel$/);
    if (mCancel && req.method === 'POST') {
      const id = Number(mCancel[1]);
      const job = db.prepare('SELECT payload, state FROM jobs WHERE id=?').get(id);
      if (!job) return json(res, 404, { error: 'no such job' });
      let p = {};
      try { p = JSON.parse(job.payload); } catch {}
      cancelDownload(p.jobId);
      db.prepare("UPDATE jobs SET state='cancelled', progress=0, finished_at=? WHERE id=?").run(now(), id);
      return json(res, 200, { ok: true });
    }

    // live download queue for the UI
    // what the device asked the server for, to explain a stop that left no trace on the phone
    if (u.pathname === '/api/diag/media' && req.method === 'GET') {
      return json(res, 200, {
        now: new Date().toISOString(), uptime_s: Math.round(process.uptime()),
        keepalive_ms: server.keepAliveTimeout, items: mediaLog.slice(-80),
      });
    }

    if (u.pathname === '/api/downloads') {
      const counts = db.prepare(`SELECT state, COUNT(*) c FROM jobs
        WHERE (kind='track-download' OR kind='ladder-download') AND state != 'dismissed'
          AND (state != 'error' OR created_at >= ?) GROUP BY state`).all(BOOTED_AT);
      const rows = db.prepare(`SELECT id, state, detail, COALESCE(progress,0) progress, payload, created_at
        FROM jobs WHERE (kind='track-download' OR kind='ladder-download') AND state NOT IN ('dismissed','cancelled','skipped')
          AND (state != 'error' OR created_at >= ?)
        ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'error' THEN 2 WHEN 'unavailable' THEN 3 ELSE 4 END, id DESC LIMIT 60`).all(BOOTED_AT);
      const items = rows.map((r) => {
        let p = {};
        try { p = JSON.parse(r.payload); } catch {}
        let title = p.title || '';
        if (!title && p.trackId) {
          const t = db.prepare('SELECT title, artist FROM tracks WHERE id=?').get(p.trackId);
          if (t) title = `${t.artist ? t.artist + ' - ' : ''}${t.title}`;
        }
        return { id: r.id, state: r.state, detail: r.detail, progress: Math.round(r.progress || 0), title: title || 'track', track_id: p.trackId || null, at: r.created_at };
      }).filter((() => {
        // one row per track for failures: the history of the same failed track is
        // not a queue and only buries what is actually running
        const seen = new Set();
        return (it) => {
          if (it.state !== 'error' && it.state !== 'unavailable') return true;
          const k = it.track_id || it.id;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        };
      })());
      const get = (s) => (counts.find((c) => c.state === s) || { c: 0 }).c;
      const total = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
      const withAudio = db.prepare("SELECT COUNT(DISTINCT track_id) c FROM files WHERE tier='owned'").get().c;
      // catalogue-only rows are metadata imports that were never meant to be downloaded:
      // counting them as "missing audio" made the Downloads panel alarm forever.
      const catalogue = db.prepare(`SELECT COUNT(*) c FROM tracks t WHERE t.format='catalogue'
        AND NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')`).get().c;
      return json(res, 200, {
        active: get('running'), queued: get('queued'), done: get('done'),
        // one count per track still without audio: job history can hold many rows
        // for the same track, and an alarm per row is noise
        failed: db.prepare(`SELECT COUNT(DISTINCT t.id) c FROM tracks t
          WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')
            AND COALESCE(t.format,'') != 'catalogue'
            AND EXISTS (SELECT 1 FROM jobs j WHERE j.state IN ('error','unavailable')
              AND (j.payload LIKE '%"trackId":' || t.id || ',%' OR j.payload LIKE '%"trackId":' || t.id || '}%'))`).get().c,
        cancelled: get('cancelled'), skipped: get('skipped'),
        library: { total, with_audio: withAudio, missing: Math.max(0, total - withAudio - catalogue), catalogue },
        items,
      });
    }

    // import a playlist from a pasted list, or a link we can name tracks from
    if (u.pathname === '/api/import/list' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const name = String(b.name || 'Imported playlist').slice(0, 80);
        const lines = String(b.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const rows = [];
        for (const line of lines) {
          const m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
          if (m) rows.push({ artist: m[1].trim(), title: m[2].trim() });
          else if (/spotify\.com|apple\.com|deezer\.com|youtube\.com|youtu\.be|bandcamp\.com|soundcloud\.com/.test(line) && !b.text.trim().includes('\n')) {
            return json(res, 200, { needs_tracks: true, platform: (line.match(/spotify|apple|deezer|youtube|bandcamp|soundcloud/) || ['unknown'])[0], url: line });
          } else rows.push({ artist: '', title: line });
        }
        if (!rows.length) return json(res, 400, { error: 'nothing to import' });
        const existing = b.playlist_id ? db.prepare('SELECT id FROM playlists WHERE id=?').get(String(b.playlist_id)) : null;
        const pid = existing ? existing.id : `imp-${Date.now().toString(36)}`;
        if (!existing) {
          db.prepare('INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(pid, name, 'import', 'listen', now(), now());
        }
        let added = 0, queued = 0;
        let pos = (db.prepare('SELECT COALESCE(MAX(position),-1) m FROM playlist_tracks WHERE playlist_id=?').get(pid).m || -1) + 1;
        for (const r of rows) {
          const key = `${(r.artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
          let row = db.prepare('SELECT id FROM tracks WHERE dup_key=?').get(key);
          if (!row) {
            const t2 = now();
            const ins = db.prepare(`INSERT INTO tracks (uid,dup_key,title,artist,album,format,added_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?)`).run(key, key, r.title, r.artist || '', '', 'import', t2, t2);
            row = { id: Number(ins.lastInsertRowid) };
          }
          db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)').run(pid, row.id, pos++, now());
          added += 1;
          const owned = db.prepare("SELECT 1 FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(row.id);
          if (!owned && enqueueTrackDownload({ id: row.id, title: r.title, artist: r.artist })) queued += 1;
        }
        return json(res, 200, { playlist: { id: pid, name, tracks: added, appended: !!existing }, queued });
      });
      return;
    }

    // adopt a folder, or a playlist file, without copying anything
    if (u.pathname === '/api/library/folders' && req.method === 'GET') {
      const local = localRequest(req);
      return json(res, 200, { local, roots: musicRoots(), folders: folderChoices(local) });
    }
    if (u.pathname === '/api/library/scan') {
      if (req.method === 'GET') return json(res, 200, { ...adoptState, local: localRequest(req), roots: musicRoots() });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      let b = {};
      try { b = JSON.parse(await readBody(req) || '{}'); } catch {}
      const target = String(b.path || '').trim();
      if (!target) return json(res, 400, { error: 'path required' });
      if (adoptState.running) return json(res, 409, { error: 'a scan is already running', state: adoptState });
      const abs = path.resolve(target);
      const local = localRequest(req);
      if (!local && !withinMusicRoots(abs).ok) {
        return json(res, 403, { error: 'a remote scan is limited to MUSICFY_MUSIC_ROOTS', roots: musicRoots() });
      }
      runFolderAdopt(abs, { local }).catch(() => {});
      return json(res, 202, { started: true, target: abs });
    }

    // queue a whole album, or only the tracks that are missing audio
    if (u.pathname === '/api/albums/download' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      onEnd(req, res, async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const name = String(b.name || '').trim();
        if (!name) return json(res, 400, { error: 'album name required' });
        // tracks already known for this album but without audio
        const tracks = db.prepare(`SELECT t.id, t.title, t.artist, t.duration FROM tracks t
          WHERE lower(COALESCE(t.album,''))=lower(?)
          AND NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')`).all(name);
        let queued = 0;
        for (const t of tracks) if (enqueueTrackDownload(t)) queued += 1;

        // an album in the library is usually partial: the rows for the tracks you never
        // got are not in the database at all, so ask the catalogue for the full tracklist
        // and queue whatever is missing instead of claiming the album is complete
        let total = db.prepare(`SELECT COUNT(*) c FROM tracks WHERE lower(COALESCE(album,''))=lower(?)`).get(name).c;
        let found = 0;
        const nt = (v) => String(v || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
        try {
          const artistRow = db.prepare(`SELECT artist FROM tracks WHERE lower(COALESCE(album,''))=lower(?)
            AND artist IS NOT NULL AND artist != '' GROUP BY artist ORDER BY COUNT(*) DESC LIMIT 1`).get(name);
          const artist = artistRow ? artistRow.artist : '';
          const list = await identity.albumTracklist(name, artist);
          if (list && list.length) {
            total = Math.max(total, list.length);
            const have = new Set(db.prepare(`SELECT title FROM tracks WHERE lower(COALESCE(album,''))=lower(?)`).all(name).map((r) => nt(r.title)));
            for (const s of list) {
              const key = nt(s.title);
              if (!key || have.has(key)) continue;
              have.add(key);
              const tid = upsertTrack({ title: s.title, artist: s.artist || artist, album: name, duration: s.duration || null, format: 'catalogue' });
              if (db.prepare("SELECT 1 FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(tid)) continue;
              const row = db.prepare('SELECT id, title, artist, duration FROM tracks WHERE id=?').get(tid);
              if (row && enqueueTrackDownload(row)) { queued += 1; found += 1; }
            }
          }
        } catch {}
        return json(res, 200, { queued, total, found });
      });
      return;
    }

    // queue a whole playlist
    const mBulk = u.pathname.match(/^\/api\/playlists\/([^/]+)\/download$/);
    if (mBulk && req.method === 'POST') {
      const pid = decodeURIComponent(mBulk[1]);
      const tracks = db.prepare(`SELECT t.id, t.title, t.artist, t.duration FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
        WHERE pt.playlist_id=? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')`).all(pid);
      let queued = 0;
      for (const t of tracks) { if (enqueueTrackDownload(t)) queued += 1; }
      return json(res, 200, { queued, total: tracks.length });
    }

    // resolve a track ahead of playback
    const mWarm = u.pathname.match(/^\/api\/prewarm\/(\d+)$/);
    if (mWarm) {
      const tid = Number(mWarm[1]);
      const t = db.prepare('SELECT id, src_kind, src_id, src_url FROM tracks WHERE id=?').get(tid);
      if (!t) return json(res, 404, { error: 'no track' });
      const owned = db.prepare("SELECT id FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(tid);
      if (owned || !t.src_id) return json(res, 200, { ok: true, local: true });

      if (t.src_kind === 'soundcloud' && (t.src_url || t.src_id)) {
        const target = t.src_url || t.src_id;
        const key = 'sc-' + String(target).replace(/[^a-zA-Z0-9]+/g, '').slice(-40);
        const dir = scCacheDir();
        const file = path.join(dir, key + '.mp3');
        if (!fs.existsSync(file) && !scStreamJobs.has(key)) {
          const job = new Promise((resolve, reject) => {
            const tpl = path.join(dir, key + '.%(ext)s');
            const child = spawn(paths.YTDLP, [
              '--no-warnings', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', tpl, target,
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            child.stderr.on('data', () => {});
            child.on('close', () => (fs.existsSync(file) ? resolve() : reject(new Error('no file'))));
            child.on('error', reject);
          });
          scStreamJobs.set(key, job);
          job.catch(() => {}).finally(() => scStreamJobs.delete(key));
        }
        return json(res, 200, { ok: true, warming: true });
      }
      try {
        await resolveStreamUrl(t);
        return json(res, 200, { ok: true, ready: true });
      } catch (e) { return upstreamError(res, e, ''); }
    }

    // fill missing cover art from the public iTunes catalogue
    if (u.pathname === '/api/covers/fill' && req.method === 'POST') {
      const limit = Math.min(Number((u.searchParams.get('limit') || 40)), 200);
      const rows = db.prepare(`SELECT id, title, artist, album FROM tracks WHERE COALESCE(has_art,0)=0 ORDER BY id LIMIT ?`).all(limit);
      let found = 0, tried = 0, noMatch = 0, failed = 0;
      const worker = async (queue) => {
        while (queue.length) {
          const t = queue.shift();
          tried += 1;
          try {
            let url = await covers.artworkFor(t.artist, t.title);
            // an album search is often the only way to match a title with punctuation or
            // a single whose track name differs from the catalogue's version
            if (!url && t.album) url = await covers.artworkForAlbum(t.album, t.artist);
            if (!url) { noMatch += 1; continue; }
            const ok = await saveThumb(url, t.id);
            if (ok) found += 1; else failed += 1;
          } catch { failed += 1; }
        }
      };
      const q = rows.slice();
      await Promise.all([worker(q), worker(q), worker(q)]);
      const remaining = db.prepare('SELECT COUNT(*) c FROM tracks WHERE COALESCE(has_art,0)=0').get().c;
      const missingTitles = db.prepare(`SELECT title, artist FROM tracks WHERE COALESCE(has_art,0)=0 ORDER BY id LIMIT 8`).all()
        .map((r) => `${r.title}${r.artist ? ' - ' + r.artist : ''}`);
      return json(res, 200, { ok: true, tried, found, no_match: noMatch, failed, remaining, missing_titles: missingTitles });
    }

    // official album artwork applied to every song in that album. This is what makes
    // an album page and its rows share one cover instead of a video thumbnail per track.
    if (u.pathname === '/api/covers/albums' && req.method === 'POST') {
      const limit = Math.min(Number(u.searchParams.get('limit') || 20), 100);
      const offset = Math.max(0, Number(u.searchParams.get('offset') || 0));
      const force = u.searchParams.get('force') === '1';
      const rows = db.prepare(`SELECT id, album, artist, COALESCE(has_art,0) has_art FROM tracks
        WHERE album IS NOT NULL AND album != '' ORDER BY id`).all();
      const groups = new Map();
      for (const r of rows) {
        const key = String(r.album).toLowerCase();
        let g = groups.get(key);
        if (!g) { g = { album: r.album, artist: '', ids: [], missing: [] }; groups.set(key, g); }
        if (!g.artist && r.artist && r.artist !== '||||||||||||||||||||') g.artist = r.artist;
        g.ids.push(r.id);
        if (!r.has_art) g.missing.push(r.id);
      }
      const allWork = [...groups.values()]
        .filter((g) => g.ids.length > 1)
        .sort((a, b) => b.missing.length - a.missing.length || b.ids.length - a.ids.length);
      const work = allWork.slice(offset, offset + limit);
      let albums = 0, tracks = 0;
      for (const g of work) {
        const targets = force ? g.ids : g.missing;
        if (!targets.length) continue;
        const url = await covers.artworkForAlbum(g.album, g.artist).catch(() => null);
        if (!url) continue;
        const buf = await fetchBuffer(url);
        if (!buf || !buf.length) continue;
        for (const id of targets) {
          try {
            await saveImageCover(buf, coverFile(id));
            db.prepare('UPDATE tracks SET has_art=1 WHERE id=?').run(id);
            tracks += 1;
          } catch {}
        }
        albums += 1;
      }
      const nextOffset = allWork.length > offset + work.length ? offset + work.length : null;
      return json(res, 200, { ok: true, albums, tracks, offset, next_offset: nextOffset, remaining: db.prepare('SELECT COUNT(*) c FROM tracks WHERE COALESCE(has_art,0)=0').get().c });
    }

    // rung health: what is actually working right now
    if (u.pathname === '/api/health/rungs') {
      return json(res, 200, { checked_at: rungHealth.checkedAt, rungs: rungHealth.rungs });
    }

    if (u.pathname === '/api/soundcloud/token' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let b = null;
        try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad request body' }); }
        if (!b.token) return json(res, 400, { error: 'token required' });
        const f = path.join(paths.DATA, 'soundcloud.json');
        try { fs.writeFileSync(f, JSON.stringify({ token: b.token }, null, 2), { mode: 0o600 }); }
        catch (e) { return serverError(res, e, 'soundcloud token save'); }
        return json(res, 200, { ok: true });
      });
      return;
    }
    if (u.pathname === '/api/soundcloud/token') {
      return json(res, 200, { configured: soundcloud.hasToken() });
    }

    if (u.pathname === '/api/stats') {
      const tracks = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
      const owned = db.prepare(`SELECT COALESCE(SUM(size),0) s FROM files WHERE tier='owned'`).get().s;
      const listens = db.prepare('SELECT COUNT(*) c FROM listens').get().c;
      return json(res, 200, { tracks, owned_bytes: owned, listens });
    }

    if (u.pathname === '/api/tracks') {
      // explicit columns: t.* dragged beat_grid, key_confidence, dup_key and uid along with
      // it, and the client reads none of them. This is the payload every phone loads.
      const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.year, t.genre, t.genre_family,
          t.duration, t.bpm, t.key, t.key_scale, t.loudness, t.has_art, t.format, t.track_no,
          t.added_at, t.updated_at, t.meta_locked,
          (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable,
          f.bitrate, r.rung, r.quality
        FROM tracks t
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id
        ORDER BY t.title`).all();
      return json(res, 200, rows);
    }

    // ---------- factory reset ----------
    // Clears the index and the settings. It never deletes audio: the files are the owner's
    // and a reset is about the app not knowing them any more.
    if (u.pathname === '/api/factory-reset' && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse(await readBody(req) || '{}'); } catch {}
      if (b.confirm !== 'RESET') return json(res, 400, { error: 'send { "confirm": "RESET" }' });
      const tables = ['playlist_tracks', 'playlists', 'listens', 'kids_listens', 'likes', 'jobs',
        'files', 'resolutions', 'taste_tracks', 'taste_artists', 'play_edges', 'spotify_plays',
        'history_files', 'tracks'];
      db.exec('BEGIN');
      try {
        for (const t of tables) { try { db.exec(`DELETE FROM ${t}`); } catch {} }
        db.exec('DELETE FROM settings');
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch {}
        return json(res, 500, { error: String(e.message || e) });
      }
      try { fs.writeFileSync(SETTINGS_FILE, '{}'); } catch {}
      try { for (const f of fs.readdirSync(COVER_DIR)) fs.rmSync(path.join(COVER_DIR, f), { force: true }); } catch {}
      picksCache = { at: 0, data: null };
      return json(res, 200, { ok: true });
    }

    // ---------- kids mode ----------
    // The catalog is the playlists marked kids. A track can be in both worlds; the play
    // context decides where the listen is recorded.
    if (u.pathname === '/api/kids' && req.method === 'GET') {
      const playlists = db.prepare(`SELECT p.id, p.name,
          (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id=p.id) n_tracks
        FROM playlists p WHERE COALESCE(p.kids,0)=1 ORDER BY lower(p.name)`).all();
      // up to four album names per list, for the collage cover the adult crates already use
      const albumRows = db.prepare(`SELECT pt.playlist_id pid, t.album
        FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id JOIN playlists p ON p.id=pt.playlist_id
        WHERE COALESCE(p.kids,0)=1 AND COALESCE(t.album,'')!=''
        ORDER BY pt.playlist_id, pt.position`).all();
      const albumsBy = new Map();
      for (const r of albumRows) {
        const list = albumsBy.get(r.pid) || [];
        if (list.length < 4 && !list.includes(r.album)) list.push(r.album);
        albumsBy.set(r.pid, list);
      }
      for (const p of playlists) p.albums = albumsBy.get(p.id) || [];
      const recent = db.prepare(`SELECT t.id, t.title, t.artist, MAX(k.played_at) last
        FROM kids_listens k JOIN tracks t ON t.id=k.track_id
        GROUP BY t.id ORDER BY last DESC LIMIT 12`).all();
      // the whole kids catalog: small by nature, and it lets the kids page search, list
      // albums and play a song without a second round trip per screen
      const tracks = db.prepare(`SELECT DISTINCT t.id, t.title, t.artist, t.album, t.duration, t.year,
          t.has_art, t.src_id, t.src_kind, (f.id IS NOT NULL) AS owned
        FROM tracks t
        JOIN playlist_tracks pt ON pt.track_id=t.id
        JOIN playlists p ON p.id=pt.playlist_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        WHERE COALESCE(p.kids,0)=1 ORDER BY lower(t.artist), lower(t.album), t.track_no, lower(t.title)`).all();
      // the name and the age band come from the settings file (the same object the settings
      // page edits); the PIN is a separate secret and lives in the settings table
      let sfile = {};
      try { sfile = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
      return json(res, 200, {
        kids: kidsOn(req),
        pin_set: !!setting('kids_pin', ''),
        name: sfile.kids_name || '',
        age: sfile.kids_age || '',
        playlists,
        recent,
        tracks,
      });
    }
    if (u.pathname === '/api/kids/enter' && req.method === 'POST') {
      res.setHeader('set-cookie', kidsCookie(true));
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/kids/exit' && req.method === 'POST') {
      const ip = String(req.socket.remoteAddress || '');
      if (kidsBlocked(ip)) return json(res, 429, { error: 'too many tries, wait ten minutes' });
      let b = {};
      try { b = JSON.parse(await readBody(req) || '{}'); } catch {}
      const stored = setting('kids_pin', '');
      if (stored && !pinOk(b.pin, stored)) {
        kidsFail(ip);
        return json(res, 403, { error: 'wrong pin' });
      }
      kidsFails.delete(ip);
      res.setHeader('set-cookie', kidsCookie(false));
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/kids/pin' && req.method === 'POST') {
      // the PIN guards the way out: it cannot be changed or removed from inside the room it
      // guards, and replacing it requires the current one
      if (kidsOn(req)) return json(res, 403, { error: 'not available in Kids mode' });
      let b = {};
      try { b = JSON.parse(await readBody(req) || '{}'); } catch {}
      const stored = setting('kids_pin', '');
      if (stored && !pinOk(b.current, stored)) return json(res, 403, { error: 'current pin required' });
      const pin = String(b.pin || '').trim();
      if (!pin) { setSetting('kids_pin', ''); return json(res, 200, { ok: true, pin_set: false }); }
      if (!/^\d{4,8}$/.test(pin)) return json(res, 400, { error: 'four to eight digits' });
      setSetting('kids_pin', hashPin(pin));
      return json(res, 200, { ok: true, pin_set: true });
    }

    if (u.pathname === '/api/listen' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        let b = null;
        try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad request body' }); }
        const tid = Number(b.track_id);
        if (!Number.isInteger(tid) || !db.prepare('SELECT 1 FROM tracks WHERE id=?').get(tid)) {
          return json(res, 400, { error: 'no such track' });
        }
        try { recordListen({ ...b, track_id: tid, kids: kidsOn(req) }); json(res, 200, { ok: true }); }
        catch (e) { serverError(res, e, '/api/listen'); }
      });
      return;
    }

    if (u.pathname === '/api/recent') {
      const limit = Math.min(Number(u.searchParams.get('limit') || 20), 100);
      const rows = db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, MAX(l.played_at) last_played, f.bitrate, r.rung, r.quality
        FROM listens l JOIN tracks t ON t.id=l.track_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id
        GROUP BY t.id ORDER BY last_played DESC LIMIT ?`).all(limit);
      return json(res, 200, rows);
    }

    // discovery: real signals, not "never played = new". A bulk import would fool that.
    if (u.pathname === '/api/discover') {
      const owned = `EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')`;
      const sel = `SELECT t.*, 1 AS owned, f.bitrate, r.rung, r.quality
        FROM tracks t
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id`;
      // "fresh" is when the audio arrived, not when the catalogue row was created. A
      // re-download or an upgrade writes a new file row for an old track, and the rail
      // used to keep showing the original batch forever.
      const freshAt = `COALESCE((SELECT MAX(f2.added_at) FROM files f2 WHERE f2.track_id=t.id AND f2.tier='owned'), t.added_at)`;
      const recent = db.prepare(`${sel} WHERE ${owned} ORDER BY ${freshAt} DESC, t.id DESC LIMIT 12`).all();
      // more from artists you actually play: their owned tracks you have not heard yet
      const deeper = db.prepare(`${sel} WHERE ${owned}
        AND t.artist IN (SELECT t2.artist FROM listens l JOIN tracks t2 ON t2.id=l.track_id
                         WHERE t2.artist IS NOT NULL AND t2.artist != ''
                           ${tasteIncludeChildren() ? '' : "AND COALESCE(t2.genre_family,'') != 'children'"} GROUP BY t2.artist)
        AND NOT EXISTS (SELECT 1 FROM listens l WHERE l.track_id=t.id)
        ORDER BY (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) ASC, ${freshAt} DESC, t.id DESC LIMIT 40`).all();
      // owned but in no playlist: the part of the library you have not filed anywhere
      const unplaylisted = db.prepare(`${sel} WHERE ${owned}
        AND t.id NOT IN (SELECT track_id FROM playlist_tracks)
        ORDER BY ${freshAt} DESC, t.id DESC LIMIT 40`).all();
      return json(res, 200, { recent, deeper, unplaylisted });
    }

    // discovery outside the library: several genre shelves, none of it already owned
    if (u.pathname === '/api/discover/outside') {
      res.setHeader('cache-control', 'no-store');
      // seeds = artists you actually play, not a genre keyword. Then Deezer's related
      // artists, excluding anyone already in the library, so this is genuinely new.
      let seeds = db.prepare(`SELECT t.artist, COUNT(*) n FROM listens l JOIN tracks t ON t.id=l.track_id
        WHERE t.artist IS NOT NULL AND t.artist != '' AND l.played_at >= ?
          AND EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')
          ${tasteIncludeChildren() ? '' : "AND COALESCE(t.genre_family,'') != 'children'"}
        GROUP BY t.artist ORDER BY n DESC LIMIT 12`).all(now() - 120 * 86400);
      if (!seeds.length) {
        seeds = db.prepare(`SELECT artist, COUNT(*) n FROM tracks WHERE artist IS NOT NULL AND artist != ''
          GROUP BY artist ORDER BY n DESC LIMIT 12`).all();
      }
      // rotate which of your top artists seeds the shelves so results are not frozen
      for (let i = seeds.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [seeds[i], seeds[j]] = [seeds[j], seeds[i]]; }
      seeds = seeds.slice(0, 2);
      const normKey = (a, t) => `${String(a).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      const inLib = new Set(db.prepare('SELECT dup_key FROM tracks').all().map((r) => r.dup_key));
      const libArtists = new Set(db.prepare("SELECT lower(artist) a FROM tracks WHERE artist IS NOT NULL AND artist != '' GROUP BY lower(artist)").all().map((r) => String(r.a).trim()));
      const seen = new Set();
      const groups = [];
      for (const seed of seeds) {
        const a = await deezer.artistSearch(seed.artist);
        if (!a) continue;
        const rel = await deezer.relatedArtists(a.id);
        const relList = (rel.data || []).slice();
        for (let i = relList.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [relList[i], relList[j]] = [relList[j], relList[i]]; }
        const out = [];
        for (const r of relList.slice(0, 5)) {
          const rn = String(r.name || '').toLowerCase().trim();
          if (!rn || libArtists.has(rn)) continue; // already in your library: skip
          const top = await deezer.artistTop(r.id, 2);
          for (const t of (top.data || [])) {
            if (!t.title || !t.artist) continue;
            const k = normKey(t.artist.name, t.title);
            if (inLib.has(k) || seen.has(k)) continue;
            seen.add(k);
            out.push({ title: t.title, artist: t.artist.name, album: (t.album && t.album.title) || '', duration: t.duration || null, preview: t.preview || null, cover: (t.album && t.album.cover_medium) || null });
            if (out.length >= 12) break;
          }
          if (out.length >= 12) break;
        }
        if (out.length) groups.push({ label: seed.artist, songs: out });
        if (groups.length >= 2) break;
      }
      return json(res, 200, { groups });
    }

    // track cover: embedded art served from cover cache
    const mCover = u.pathname.match(/^\/api\/cover\/(\d+)$/);
    if (mCover) {
      const f = coverFile(Number(mCover[1]));
      // a cover file can be replaced (album picker); never serve the previous one for a day
      if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f)); }
      res.writeHead(204); return res.end();
    }

    if (u.pathname === '/api/cover-liked') {
      const row = db.prepare(`SELECT f.track_id, f.path FROM likes l JOIN files f ON f.track_id=l.track_id AND f.tier='owned'
        ORDER BY l.created_at DESC LIMIT 1`).get();
      if (row) {
        const cf = coverFile(row.track_id);
        if (!fs.existsSync(cf)) await extractCover(row.track_id, row.path);
        if (fs.existsSync(cf)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(cf)); }
      }
      // no playlist context here: nothing to fall back to
      res.writeHead(204); return res.end();
    }

    if (u.pathname === '/api/likes' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => { const b = JSON.parse(body); toggleLike(b.track_id, true); json(res, 200, { ok: true }); });
      return;
    }
    if (u.pathname === '/api/likes' && req.method === 'DELETE') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => { const b = JSON.parse(body); toggleLike(b.track_id, false); json(res, 200, { ok: true }); });
      return;
    }
    if (u.pathname === '/api/likes') {
      return json(res, 200, db.prepare('SELECT track_id FROM likes ORDER BY created_at DESC').all());
    }
    if (u.pathname === '/api/likes/full') {
      const rows = db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality FROM likes l
        JOIN tracks t ON t.id=l.track_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id
        ORDER BY l.created_at DESC`).all();
      return json(res, 200, rows);
    }

    // radio: same-artist first, then shared-playlist neighbors, all owned
    const mRadio = u.pathname.match(/^\/api\/radio\/(\d+)$/);
    if (mRadio) {
      const tid = Number(mRadio[1]);
      const seed = db.prepare('SELECT artist, title, genre_family FROM tracks WHERE id=?').get(tid);
      const fam = seed && seed.genre_family;
      const out = [];
      const have0 = new Set();
      // 1. history neighbours: artists you actually played next to this artist, weighted
      if (seed && seed.artist) {
        const related = db.prepare(`SELECT CASE WHEN a=? THEN b ELSE a END rel, w FROM play_edges
          WHERE a=? OR b=? ORDER BY w DESC LIMIT 40`).all(seed.artist, seed.artist, seed.artist);
        for (const r of related) {
          if (out.length >= 14) break;
          const rows = db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality FROM tracks t
            LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
            LEFT JOIN resolutions r ON r.track_id=t.id
            WHERE t.id != ? AND lower(t.artist)=lower(?) LIMIT 3`).all(tid, r.rel);
          for (const row of rows) {
            if (have0.has(row.id) || !sameFamily(fam, row.genre_family)) continue;
            out.push(row); have0.add(row.id);
          }
        }
      }
      // 2. same artist from your catalog
      if (seed && seed.artist) {
        out.push(...db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality FROM tracks t
          LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
          LEFT JOIN resolutions r ON r.track_id=t.id
          WHERE t.id != ? AND t.artist = ? LIMIT 12`).all(tid, seed.artist)
          .filter((r) => sameFamily(fam, r.genre_family)));
        for (const row of out) have0.add(row.id);
        if (out.length > 24) out.length = 24;
      }
      const shared = db.prepare(`SELECT DISTINCT t2.id FROM playlist_tracks pt1
        JOIN playlist_tracks pt2 ON pt2.playlist_id=pt1.playlist_id AND pt2.track_id != pt1.track_id
        JOIN tracks t2 ON t2.id=pt2.track_id WHERE pt1.track_id=? LIMIT ?`).all(tid, 30 - out.length);
      const have = new Set(out.map(t => t.id)); have.add(tid);
      for (const s of shared) {
        if (have.has(s.id)) continue;
        const row = db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality FROM tracks t
          LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
          LEFT JOIN resolutions r ON r.track_id=t.id WHERE t.id=?`).get(s.id);
        if (row && sameFamily(fam, row.genre_family)) { out.push(row); have.add(s.id); }
      }
      if (!out.length) {
        out.push(...db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality FROM tracks t
          LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
          LEFT JOIN resolutions r ON r.track_id=t.id
          WHERE t.id != ? ORDER BY RANDOM() LIMIT 15`).all(tid));
      }
      // A seed with one family neighbour produced a radio of one, and the home row was a
      // single card in an empty page. A radio is a queue: fill it to a usable length from
      // the same family, then from the rest of the owned library.
      const bannedRadio = tasteAvoid();
      const kept = bannedRadio.length ? out.filter((t) => !exclude.matches(bannedRadio, t)) : out.slice();
      const RADIO_TARGET = 15;
      const take = (rows) => {
        for (const r of rows) {
          if (kept.length >= RADIO_TARGET) break;
          if (!r || have.has(r.id)) continue;
          if (bannedRadio.length && exclude.matches(bannedRadio, r)) continue;
          kept.push(r); have.add(r.id);
        }
      };
      if (kept.length < RADIO_TARGET && fam) {
        take(db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality
          FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
          LEFT JOIN resolutions r ON r.track_id=t.id
          WHERE t.id != ? AND t.genre_family = ? ORDER BY RANDOM() LIMIT 60`).all(tid, fam));
      }
      if (kept.length < RADIO_TARGET) {
        take(db.prepare(`SELECT t.*, 1 AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality
          FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
          LEFT JOIN resolutions r ON r.track_id=t.id
          WHERE t.id != ? ORDER BY RANDOM() LIMIT 60`).all(tid));
      }
      // known family first. 'Tim Green' the house producer and 'Tim Green' the Death guitarist
      // are one string, so the genre column is the only thing that separates their neighbours
      if (fam) kept.sort((a, b) => (a.genre_family === fam ? 0 : 1) - (b.genre_family === fam ? 0 : 1));
      return json(res, 200, kept);
    }

    // playlist management
    if (u.pathname === '/api/playlists' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        // a name is text, and the id is not derived from a clock with one-second resolution:
        // two playlists made in the same second used to collide on the primary key
        let b = null;
        try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad request body' }); }
        const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
        if (!name) return json(res, 400, { error: 'a playlist needs a name' });
        const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'playlist';
        let id = `own-${slug}-${Date.now().toString(36)}`;
        let n = 1;
        while (db.prepare('SELECT 1 FROM playlists WHERE id=?').get(id)) id = `own-${slug}-${Date.now().toString(36)}-${n++}`;
        // a new playlist is for listening; a DJ set is a deliberate choice
        const kind = b.kind === 'dj' ? 'dj' : 'listen';
        db.prepare('INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, name, 'manual', kind, now(), now());
        json(res, 200, { id, name });
      });
      return;
    }
    const mPlTrack = u.pathname.match(/^\/api\/playlists\/([^/]+)\/tracks$/);
    if (mPlTrack && req.method === 'GET') {
      return json(res, 200, playlistRows(decodeURIComponent(mPlTrack[1])));
    }
    if (mPlTrack && req.method === 'POST') {
      const pid = decodeURIComponent(mPlTrack[1]);
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        const b = JSON.parse(body);
        let trackId = b.track_id;
        if (!trackId && b.stream && b.stream.title) {
          const s = b.stream;
          trackId = upsertTrack({ title: s.title, artist: s.artist || '', album: s.album || '', duration: s.duration || null, format: 'stream' });
          db.prepare('UPDATE tracks SET src_kind=?, src_id=?, src_url=? WHERE id=?')
            .run(s.rung || s.kind || 'ytmusic', String(s.id || ''), s.url || '', trackId);
          db.prepare('INSERT OR REPLACE INTO resolutions (track_id,rung,quality,resolved_at) VALUES (?,?,?,?)')
            .run(trackId, s.rung || 'ytmusic', null, now());
        }
        if (!trackId) return json(res, 400, { error: 'track_id or stream required' });
        const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM playlist_tracks WHERE playlist_id=?').get(pid).p;
        db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)').run(pid, trackId, pos, now());
        db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(now(), pid);
        json(res, 200, { ok: true });
      });
      return;
    }

    // playlist cover: first track in playlist with art
    // album art comes from whichever track on the album already has a cover
    const mCoverAl = u.pathname.match(/^\/api\/cover-album\/(.+)$/);
    if (mCoverAl) {
      const album = decodeURIComponent(mCoverAl[1]);
      const rows = db.prepare(`SELECT t.id, f.path FROM tracks t
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        WHERE lower(COALESCE(t.album,''))=lower(?) ORDER BY t.id`).all(album);
      for (const r of rows) {
        const cf = coverFile(r.id);
        if (!fs.existsSync(cf) && r.path) { try { await extractCover(r.id, r.path); } catch {} }
        if (fs.existsSync(cf)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(cf)); }
      }
      const letter = String(album || '?').trim().charAt(0).toUpperCase() || '?';
      const hue = [...String(album)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},30%,22%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},28%,13%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><text x="150" y="150" font-family="Helvetica,Arial,sans-serif" font-size="120" font-weight="700" fill="rgba(255,255,255,.8)" text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`;
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
      return res.end(svg);
    }

    const mCoverPl = u.pathname.match(/^\/api\/cover-playlist\/([^/]+)$/);
    if (mCoverPl) {
      const pid = decodeURIComponent(mCoverPl[1]);
      const custom = plCoverFile(pid);
      if (fs.existsSync(custom)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); return res.end(fs.readFileSync(custom)); }
      // walk the playlist in order and take the first artwork we can actually produce,
      // whether or not that track still has a local file
      const members = db.prepare(`SELECT t.id, f.path FROM playlist_tracks pt
        JOIN tracks t ON t.id=pt.track_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        WHERE pt.playlist_id=? ORDER BY pt.position`).all(pid);
      for (const m of members) {
        const cf = coverFile(m.id);
        if (!fs.existsSync(cf) && m.path) { try { await extractCover(m.id, m.path); } catch {} }
        if (fs.existsSync(cf)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(cf)); }
      }
      // mirrored playlists have no audio yet: use the playlist art saved at import time
      const plArt = plCoverFile(pid);
      if (fs.existsSync(plArt)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' }); return res.end(fs.readFileSync(plArt)); }
      // nothing to derive from: return a generated tile so the card is never blank
      const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(pid);
      const letter = String((pl && pl.name) || '?').trim().charAt(0).toUpperCase() || '?';
      const hue = [...String(pid)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},32%,22%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},30%,13%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><text x="150" y="150" font-family="Helvetica,Arial,sans-serif" font-size="120" font-weight="700" fill="rgba(255,255,255,.82)" text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`;
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
      return res.end(svg);
    }

    if (u.pathname === '/api/playlists') {
      const V = analyser.ANALYSIS_VERSION;
      const rows = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id=p.id) n_tracks,
        (SELECT COUNT(*) FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
           JOIN files f ON f.track_id=t.id AND f.tier='owned'
           WHERE pt.playlist_id=p.id AND t.analyzed_at IS NOT NULL) analyzed,
        (SELECT COUNT(*) FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
           JOIN files f ON f.track_id=t.id AND f.tier='owned'
           WHERE pt.playlist_id=p.id AND t.analyzed_at IS NOT NULL AND COALESCE(t.analysis_version,0) >= ${V}
             AND t.beat_grid IS NOT NULL AND t.beat_grid != '') prepped,
        (SELECT COUNT(*) FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
           JOIN files f ON f.track_id=t.id AND f.tier='owned'
           WHERE pt.playlist_id=p.id AND t.analyzed_at IS NOT NULL AND COALESCE(t.analysis_version,0) < ${V}) outdated,
        (SELECT COUNT(*) FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
           JOIN files f ON f.track_id=t.id AND f.tier='owned'
           WHERE pt.playlist_id=p.id AND t.analyzed_at IS NULL) never,
        (SELECT COUNT(*) FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
           JOIN files f ON f.track_id=t.id AND f.tier='owned'
           WHERE pt.playlist_id=p.id) owned
        FROM playlists p ORDER BY p.name`).all();
      for (const r of rows) r.analysis_version = V;
      return json(res, 200, rows);
    }

    // download one owned track to the device
    const mFile = u.pathname.match(/^\/api\/tracks\/(\d+)\/file$/);
    if (mFile) {
      const tid = Number(mFile[1]);
      const f = db.prepare("SELECT path FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(tid);
      if (!f || !fs.existsSync(f.path)) return json(res, 404, { error: 'no file for this track' });
      const t = db.prepare('SELECT title, artist FROM tracks WHERE id=?').get(tid);
      const name = `${t && t.artist ? t.artist + ' - ' : ''}${(t && t.title) || 'track'}`.replace(/[\/:*?"<>|]+/g, '_').slice(0, 120);
      const ext = path.extname(f.path) || '.mp3';
      // header values must be latin-1; non-ASCII titles (Ōsé, Erdoğan) 500'd before
      const asciiName = `${name}${ext}`.replace(/[^\x20-\x7E]+/g, '_');
      const utf8Name = encodeURIComponent(`${name}${ext}`);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        'content-length': fs.statSync(f.path).size,
      });
      return fs.createReadStream(f.path).pipe(res);
    }

    // download a whole playlist as a zip of the owned files plus an M3U
    const mZip = u.pathname.match(/^\/api\/playlists\/([^/]+)\/zip$/);
    if (mZip) {
      const pid = decodeURIComponent(mZip[1]);
      const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(pid);
      const rows = db.prepare(`SELECT t.title, t.artist, t.duration, f.path FROM playlist_tracks pt
        JOIN tracks t ON t.id=pt.track_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        WHERE pt.playlist_id=? ORDER BY pt.position`).all(pid);
      const files = rows.filter((r) => r.path && fs.existsSync(r.path));
      if (!files.length) return json(res, 404, { error: 'nothing downloaded in this playlist yet' });
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfzip-'));
      const stage = path.join(tmpDir, 'set');
      fs.mkdirSync(stage, { recursive: true });
      const lines = ['#EXTM3U', '#EXTENC:UTF-8'];
      let n = 0;
      for (const r of files) {
        n += 1;
        const base = `${String(n).padStart(2, '0')} ${r.artist ? r.artist + ' - ' : ''}${r.title || 'track'}`.replace(/[\/:*?"<>|]+/g, '_').slice(0, 140) + path.extname(r.path);
        try { fs.copyFileSync(r.path, path.join(stage, base)); } catch { continue; }
        lines.push(`#EXTINF:${Math.round(r.duration || 0)},${r.artist || ''} - ${r.title || ''}`);
        lines.push(base);
      }
      fs.writeFileSync(path.join(stage, 'playlist.m3u'), lines.join('\n'));
      const zipPath = path.join(tmpDir, 'set.zip');
      await new Promise((resolve, reject) => {
        execFile('zip', ['-r', '-q', zipPath, 'set'], { cwd: tmpDir, timeout: 120000 }, (err) => err ? reject(err) : resolve());
      });
      const name = ((pl && pl.name) || 'playlist').replace(/[\/:*?"<>|]+/g, '_').slice(0, 80);
      streamZip(res, tmpDir, zipPath, {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${name}.zip"`,
      });
      return;
    }

    // export a playlist as M3U for other players
    const mM3u = u.pathname.match(/^\/api\/playlists\/([^/]+)\/export\.m3u$/);
    if (mM3u) {
      const pid = decodeURIComponent(mM3u[1]);
      const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(pid);
      const rows = db.prepare(`SELECT t.title, t.artist, t.duration, f.path FROM playlist_tracks pt
        JOIN tracks t ON t.id=pt.track_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        WHERE pt.playlist_id=? ORDER BY pt.position`).all(pid);
      const lines = ['#EXTM3U', '#EXTENC:UTF-8'];
      for (const r of rows) {
        lines.push(`#EXTINF:${Math.round(r.duration || 0)},${r.artist || 'Unknown'} - ${r.title || ''}`);
        lines.push(r.path || `# missing: ${r.artist || ''} - ${r.title || ''}`);
      }
      const name = (pl ? pl.name : 'playlist').replace(/[^\w. -]+/g, '_');
      res.writeHead(200, {
        'content-type': 'audio/x-mpegurl; charset=utf-8',
        'content-disposition': `attachment; filename="${name}.m3u"`,
        'cache-control': 'no-store',
      });
      return res.end(lines.join('\n'));
    }

    // export a playlist for DJ software (rekordbox XML / Traktor NML), cues from the beat grid
    const mRb = u.pathname.match(/^\/api\/playlists\/([^/]+)\/export\/rekordbox\.xml$/);
    if (mRb) {
      const pid = decodeURIComponent(mRb[1]);
      const body = exporter.rekordboxXml(db, pid);
      const name = ((db.prepare('SELECT name FROM playlists WHERE id=?').get(pid) || {}).name || 'playlist').replace(/[^\w. -]+/g, '_').slice(0, 80);
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `attachment; filename="${name}.xml"`, 'cache-control': 'no-store' });
      return res.end(body);
    }
    const mTr = u.pathname.match(/^\/api\/playlists\/([^/]+)\/export\/traktor\.nml$/);
    if (mTr) {
      const pid = decodeURIComponent(mTr[1]);
      const body = exporter.traktorNml(db, pid);
      const name = ((db.prepare('SELECT name FROM playlists WHERE id=?').get(pid) || {}).name || 'playlist').replace(/[^\w. -]+/g, '_').slice(0, 80);
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `attachment; filename="${name}.nml"`, 'cache-control': 'no-store' });
      return res.end(body);
    }

    // CDJ USB: a real Pioneer device tree — PIONEER/rekordbox/export.pdb (the database the
    // player reads), PIONEER/USBANLZ analysis files, and the audio under Contents/<set>/
    const mUsb = u.pathname.match(/^\/api\/playlists\/([^/]+)\/export\/pioneer\.zip$/);
    if (mUsb) {
      const pid = decodeURIComponent(mUsb[1]);
      const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(pid) || { name: 'playlist' };
      const safe = (String(pl.name).replace(/[/\\:*?"<>|]+/g, '_').slice(0, 60) || 'playlist').trim();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfusb-'));
      try {
        const built = pioneer.buildUsbTree(db, pid, tmpDir);
        if (!built.tracks) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return json(res, 404, { error: 'nothing downloaded in this playlist yet' });
        }
        fs.writeFileSync(path.join(tmpDir, 'MUSICFY-USB.txt'),
          'MUSICFY — CDJ / XDJ USB export\n\n' +
          'Extract the CONTENTS OF THIS ZIP to the ROOT of a FAT32 or exFAT USB drive.\n' +
          'You should end up with PIONEER/ and Contents/ at the top level of the drive.\n\n' +
          `Playlist: ${safe}\nTracks: ${built.tracks}\nAnalysis files: ${built.anlz}\n\n` +
          'On a CDJ/XDJ: insert the drive, press USB, browse to rekordbox > PLAYLISTS > ' + safe + '.\n' +
          'If the player shows the drive but no library, the drive is not FAT32/exFAT or the\n' +
          'extraction put PIONEER/ inside another folder.\n');
        const zipPath = path.join(tmpDir, 'usb.zip');
        await new Promise((resolve, reject) => {
          execFile('zip', ['-r', '-q', zipPath, 'PIONEER', 'Contents', 'MUSICFY-USB.txt'], { cwd: tmpDir, timeout: 600000 }, (err) => err ? reject(err) : resolve());
        });
        streamZip(res, tmpDir, zipPath, {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${safe} (CDJ USB).zip"`,
          'cache-control': 'no-store',
        });
        return;
      } catch (e) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        return serverError(res, e, 'usb export');
      }
    }

    // portable set: ZIP with the actual audio + the XML/NML so the right tracks travel with the set
    const mDjZip = u.pathname.match(/^\/api\/playlists\/([^/]+)\/export\.zip$/);
    if (mDjZip) {
      const pid = decodeURIComponent(mDjZip[1]);
      const fmt = u.searchParams.get('format') === 'traktor' ? 'traktor' : 'rekordbox';
      const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(pid) || { name: 'playlist' };
      const safe = (String(pl.name).replace(/[\/:*?"<>|]+/g, '_').slice(0, 60) || 'playlist').trim();
      const root = `MUSICFY ${safe}`;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfdj-'));
      const stage = path.join(tmpDir, root);
      const audioDir = path.join(stage, 'audio');
      fs.mkdirSync(audioDir, { recursive: true });
      const rows = db.prepare(`SELECT t.id, t.title, t.artist, f.path FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        WHERE pt.playlist_id=? ORDER BY pt.position`).all(pid);
      const used = new Set();
      const names = new Map();
      let copied = 0;
      for (const r of rows) {
        if (!r.path || !fs.existsSync(r.path)) continue;
        const ext = path.extname(r.path) || '.mp3';
        const base = (`${r.artist ? r.artist + ' - ' : ''}${r.title}`.replace(/[\/:*?"<>|]+/g, '_').slice(0, 120) || ('track-' + r.id));
        let name = base + ext;
        let i = 2;
        while (used.has(name.toLowerCase())) name = `${base} (${i++})${ext}`;
        used.add(name.toLowerCase());
        fs.copyFileSync(r.path, path.join(audioDir, name));
        names.set(r.id, name);
        copied += 1;
      }
      if (!copied) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return json(res, 404, { error: 'nothing downloaded in this playlist yet' });
      }
      const body = fmt === 'traktor'
        ? exporter.traktorNml(db, pid, { dirFor: () => '/:audio', fileFor: (t) => names.get(t.id) || path.basename(t.path) })
        : exporter.rekordboxXml(db, pid, { pathFor: (t) => 'file://localhost/audio/' + encodeURIComponent(names.get(t.id) || path.basename(t.path)) });
      fs.writeFileSync(path.join(stage, fmt === 'traktor' ? 'traktor.nml' : 'rekordbox.xml'), body);
      fs.writeFileSync(path.join(stage, 'playlist.m3u8'), ['#EXTM3U', '#EXTENC:UTF-8', ...rows.filter((r) => names.has(r.id)).map((r) => names.get(r.id))].join('\n'));
      fs.writeFileSync(path.join(stage, 'README.txt'),
        `MUSICFY set export — ${pl.name} (${fmt})\n\n` +
        `Contents\n  audio/        the actual audio files (this IS the set)\n` +
        `  ${fmt === 'traktor' ? 'traktor.nml' : 'rekordbox.xml'}\n  playlist.m3u8\n\n` +
        (fmt === 'traktor'
          ? `Traktor\n  1. Right-click your Collection > Import Collection > choose traktor.nml\n  2. If tracks are missing: select them > Relocate > choose the audio/ folder\n`
          : `Rekordbox\n  1. File > Import > Import Collection (rekordbox xml) > choose rekordbox.xml\n  2. If tracks are missing: select the playlist > Relocate > choose the audio/ folder\n`) +
        `\nThe audio/ folder is the source of truth: whatever plays from it is exactly what you exported.\n`);
      const zipPath = path.join(tmpDir, 'set.zip');
      await new Promise((resolve, reject) => {
        execFile('zip', ['-r', '-q', zipPath, root], { cwd: tmpDir, timeout: 180000 }, (err) => err ? reject(err) : resolve());
      });
      streamZip(res, tmpDir, zipPath, {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${safe} (${fmt}).zip"`,
        'cache-control': 'no-store',
      });
      return;
    }
    if (u.pathname === '/api/docs') {
      return json(res, 200, {
        core: 'musicfy',
        endpoints: [
          'GET  /api/playlists', 'POST /api/playlists', 'GET|PATCH|DELETE /api/playlists/:id',
          'GET  /api/playlists/:id/export.m3u', 'POST /api/playlists/:id/tracks', 'DELETE /api/playlists/:id/tracks/:trackId',
          'GET  /api/tracks', 'DELETE /api/tracks/:id', 'POST /api/tracks/:id/download', 'POST /api/tracks/:id/cover',
          'GET  /api/group/artist/:name', 'GET /api/group/album/:name',
          'GET  /api/radio/:id', 'GET /api/recent', 'GET|POST|DELETE /api/likes', 'GET /api/likes/full',
          'GET  /api/search/ladder?q=&durCap=', 'POST /api/ladder/download', 'GET /api/jobs/:id',
          'GET  /api/ladder/stream/youtube/:id', 'GET /api/ladder/stream/soundcloud?u=',
          'POST /api/mirror/spotify', 'GET /api/history/stats', 'POST /api/history/scan',
          'GET  /api/stats', 'GET /api/cover/:id', 'GET /api/cover-playlist/:id', 'GET /api/stream/:id',
          'POST /api/upload/track', 'GET|POST /api/library/scan', 'POST /api/playlists/:id/cover', 'POST /api/listen',
        ],
        auth: 'none at the app layer by default; set MUSICFY_TOKEN or put an authenticated proxy in front',
      });
    }

    const m = u.pathname.match(/^\/api\/playlists\/([^/]+)$/);
    if (m && req.method === 'GET') {
      return json(res, 200, playlistRows(decodeURIComponent(m[1])));
    }
    if (m && req.method === 'PATCH') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let b = null;
        try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad request body' }); }
        const id = decodeURIComponent(m[1]);
        const cur = db.prepare('SELECT id FROM playlists WHERE id=?').get(id);
        if (!cur) return json(res, 404, { error: 'no such playlist' });
        if (b.name !== undefined) {
          const name = String(b.name).trim().slice(0, 120);
          if (!name) return json(res, 400, { error: 'a playlist needs a name' });
          db.prepare('UPDATE playlists SET name=?, updated_at=? WHERE id=?').run(name, now(), id);
        }
        // dj = prepped for export; listen = playback only, and Prep leaves it alone
        if (b.kind !== undefined) {
          // a new playlist is for listening; a DJ set is a deliberate choice
        const kind = b.kind === 'dj' ? 'dj' : 'listen';
          db.prepare('UPDATE playlists SET kind=?, updated_at=? WHERE id=?').run(kind, now(), id);
        }
        if (b.kids !== undefined) {
          db.prepare('UPDATE playlists SET kids=?, updated_at=? WHERE id=?').run(b.kids ? 1 : 0, now(), id);
        }
        json(res, 200, { ok: true });
      });
      return;
    }
    if (m && req.method === 'DELETE') {
      db.prepare('DELETE FROM playlists WHERE id=?').run(decodeURIComponent(m[1]));
      json(res, 200, { ok: true });
      return;
    }
    const mPlT2 = u.pathname.match(/^\/api\/playlists\/([^/]+)\/tracks\/(\d+)$/);
    if (mPlT2 && req.method === 'DELETE') {
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?').run(decodeURIComponent(mPlT2[1]), Number(mPlT2[2]));
      db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(now(), decodeURIComponent(mPlT2[1]));
      json(res, 200, { ok: true });
      return;
    }
    // reorder a playlist (drag and drop): order = [trackId, ...]
    const mReorder = u.pathname.match(/^\/api\/playlists\/([^/]+)\/reorder$/);
    if (mReorder && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        const pid = decodeURIComponent(mReorder[1]);
        let ids = [];
        try { ids = (JSON.parse(body || '{}').order) || []; } catch {}
        if (!Array.isArray(ids) || !ids.length) return json(res, 400, { error: 'order required' });
        const upd = db.prepare('UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?');
        ids.forEach((id, i) => upd.run(i, pid, Number(id)));
        db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(now(), pid);
        return json(res, 200, { ok: true, count: ids.length });
      });
      return;
    }
    // order a playlist harmonically (Camelot progression)
    const mHarm = u.pathname.match(/^\/api\/playlists\/([^/]+)\/harmonic$/);
    if (mHarm && req.method === 'POST') {
      const pid = decodeURIComponent(mHarm[1]);
      const rows = db.prepare(`SELECT t.id, t.key, t.key_scale FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
        WHERE pt.playlist_id=? ORDER BY pt.position`).all(pid);
      const ordered = harmonicOrder(rows);
      const upd = db.prepare('UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_id=?');
      ordered.forEach((t, i) => upd.run(i, pid, t.id));
      db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(now(), pid);
      return json(res, 200, { ok: true, count: ordered.length });
    }
    // delete a whole selection in one request: the row menu and the selection bar both
    // end up here, so "delete 40 tracks" is one round trip, not forty
    if (u.pathname === '/api/tracks/delete' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let ids = [];
        try { ids = (JSON.parse(body || '{}').ids || []).map(Number).filter((n) => Number.isFinite(n)); } catch {}
        if (!ids.length) return json(res, 400, { error: 'ids required' });
        const del = db.prepare('DELETE FROM tracks WHERE id=?');
        const filesOf = db.prepare('SELECT path, COALESCE(external,0) external FROM files WHERE track_id=?');
        let deleted = 0;
        const freed = [];
        db.exec('BEGIN');
        try {
          for (const id of ids) {
            const files = filesOf.all(id);
            // foreign keys are not enabled in SQLite by default: clear the rows that
            // point at this track, or deleting one leaves orphan playlist entries
            db.prepare('DELETE FROM playlist_tracks WHERE track_id=?').run(id);
            db.prepare('DELETE FROM likes WHERE track_id=?').run(id);
            db.prepare('DELETE FROM listens WHERE track_id=?').run(id);
            db.prepare('DELETE FROM resolutions WHERE track_id=?').run(id);
            db.prepare('DELETE FROM files WHERE track_id=?').run(id);
            const r = del.run(id);
            if (r.changes) deleted += 1;
            for (const f of files) if (!f.external) freed.push(f.path);
          }
          db.exec('COMMIT');
        } catch (e) {
          try { db.exec('ROLLBACK'); } catch {}
          return serverError(res, e, '/api/tracks/delete');
        }
        for (const p of freed) { try { fs.unlinkSync(p); } catch {} }
        return json(res, 200, { ok: true, deleted, files: freed.length });
      });
      return;
    }

    const mTrk = u.pathname.match(/^\/api\/tracks\/(\d+)$/);
    if (mTrk && req.method === 'DELETE') {
      const tid = Number(mTrk[1]);
      const files = db.prepare('SELECT path, COALESCE(external,0) external FROM files WHERE track_id=?').all(tid);
      db.prepare('DELETE FROM tracks WHERE id=?').run(tid);
      for (const f of files) { if (f.external) continue; try { fs.unlinkSync(f.path); } catch {} }
      json(res, 200, { ok: true });
      return;
    }
    const mGroup = u.pathname.match(/^\/api\/group\/(artist|album)\/(.+)$/);
    if (mGroup) {
      const col = mGroup[1];
      const gname = decodeURIComponent(mGroup[2]);
      let rows = db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality
        FROM tracks t
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id
        WHERE lower(${col})=lower(?) ORDER BY COALESCE(t.disc_no, 1), COALESCE(t.track_no, 9999), t.id`).all(gname);
      // album pages: the catalogue supplies the running order, and any number it
      // supplies is written to the track so the order survives offline and in exports
      if (col === 'album' && rows.length > 1) {
        try {
          const names = new Set(rows.map((r) => String(r.artist || '').trim()).filter(Boolean));
          const artist = names.size === 1 ? [...names][0] : '';
          const list = await identity.albumTracklist(gname, artist);
          if (list && list.length) rows = albumOrder.apply(db, rows, list);
        } catch {}
      }
      return json(res, 200, rows);
    }

    // /offline-audio is the service worker's path for a saved copy; without a worker
    // (plain http on the LAN) the same bytes still have to come from here
    const m2 = u.pathname.match(/^\/(?:api\/stream|offline-audio)\/(\d+)$/);
    if (m2) {
      const tid = Number(m2[1]);
      const f = db.prepare(`SELECT path FROM files WHERE track_id=? AND tier='owned' LIMIT 1`).get(tid);
      if (!f || !fs.existsSync(f.path)) {
        const t = db.prepare('SELECT id, src_kind, src_id, src_url FROM tracks WHERE id=?').get(tid);
        if (t && t.src_id) {
          try {
            const loc = await resolveStreamUrl(t);
            res.writeHead(302, { location: loc });
            return res.end();
          } catch (e) { return upstreamError(res, e, ''); }
        }
        return json(res, 404, { error: 'no file' });
      }
      const st = fs.statSync(f.path);
      const startedAt = Date.now();
      const range = req.headers.range;
      // files never change: let the device keep them, which is what makes a second play instant
      const ext = path.extname(f.path).toLowerCase();
      const mime = ext === '.m4a' ? 'audio/mp4'
        : (ext === '.ogg' || ext === '.opus') ? 'audio/ogg'
        : ext === '.flac' ? 'audio/flac'
        : ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
      // A validator is what lets a phone resume a range after the car loses signal. Without
      // one, Safari re-requests from the start or gives up and stays paused until unlock.
      const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      const lastModified = st.mtime.toUTCString();
      const head = {
        'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400, no-transform',
        etag, 'last-modified': lastModified,
      };
      const ua = String(req.headers['user-agent'] || '').slice(0, 120);
      const logIt = (status, bytes) => logMedia({
        at: new Date().toISOString().slice(11, 19), id: tid, range: range || 'full',
        status, bytes, ms: Date.now() - startedAt, ua,
      });
      if (req.method === 'HEAD') {
        logIt(200, 0);
        res.writeHead(200, { ...head, 'content-length': st.size });
        return res.end();
      }
      // If-Range with a validator that no longer matches means "send the whole file again"
      const ifRange = req.headers['if-range'];
      const rangeUsable = !ifRange || ifRange === etag || ifRange === lastModified;
      if (range && rangeUsable) {
        const r = range.match(/bytes=(\d*)-(\d*)/);
        let start = r && r[1] ? Number(r[1]) : 0;
        let end = r && r[2] ? Number(r[2]) : st.size - 1;
        if (r && !r[1] && r[2]) { start = Math.max(0, st.size - Number(r[2])); end = st.size - 1; }
        // a bad range must not produce a negative content-length and wedge the socket
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= st.size) {
          res.writeHead(416, { ...head, 'content-range': `bytes */${st.size}` });
          return res.end();
        }
        end = Math.min(end, st.size - 1);
        res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
        logIt(206, end - start + 1);
        fs.createReadStream(f.path, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...head, 'content-length': st.size });
        logIt(200, st.size);
        fs.createReadStream(f.path).pipe(res);
      }
      return;
    }

    const m3 = u.pathname.match(/^\/api\/ingest-wnl\/([^/]+)$/);
    if (m3) {
      if (!WNL) return json(res, 400, { error: 'WNL_URL is not configured' });
      const folder = decodeURIComponent(m3[1]);
      const libs = JSON.parse(await httpGet(`${WNL}/api/library`));
      const entry = libs.find(l => l.folder === folder);
      const r = await ingestWnlFolder(folder, entry ? entry.name : folder);
      return json(res, 200, { folder, ...r });
    }

    if (u.pathname === '/api/ingest-wnl-all') {
      if (!WNL) return json(res, 400, { error: 'WNL_URL is not configured' });
      const libs = JSON.parse(await httpGet(`${WNL}/api/library`));
      const results = [];
      for (const l of libs) results.push({ name: l.name, ...await ingestWnlFolder(l.folder, l.name) });
      return json(res, 200, results);
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    log('error', `${u.pathname}: ${e.message}`);
    return serverError(res, e, u.pathname);
  }
});

process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e && e.message, (e && e.stack || '').split('\n')[1] || '');
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && e.message ? e.message : String(e));
});

try { migrate(); } catch (e) { console.error('[migrate]', e.message); }
// families are derived from the genre text already stored; keep them honest without a
// network round trip. Cheap (one pass), idempotent, and only touches rows that differ.
try {
  const fixed = genre.reclassify(db);
  const restored = genre.restoreFromCache(db);
  if (fixed || restored) console.log('[genre] families: reclassified', fixed, '· restored', restored);
} catch (e) { console.error('[genre] reclassify failed:', e.message); }
checkDependencies();

// a download that stops reporting progress is dead weight: reap it and free its slot
const STUCK_MS = Number(process.env.MUSICFY_STUCK_MS || 45 * 60 * 1000);
setInterval(() => {
  try {
    const rows = db.prepare("SELECT id, COALESCE(updated_at, created_at, 0) u FROM jobs WHERE state='running'").all();
    let reaped = 0;
    for (const r of rows) {
      const seen = Number(r.u) * (Number(r.u) > 1e12 ? 1 : 1000);
      if (Date.now() - seen < STUCK_MS) continue;
      // mark failed AND release the concurrency slot, otherwise 3 zombies starve the queue
      db.prepare("UPDATE jobs SET state='error', detail='stuck, no progress', finished_at=? WHERE id=?").run(now(), r.id);
      reaped += 1;
      console.error('[jobs] reaped stuck job', r.id);
    }
    if (reaped) { activeDownloads = Math.max(0, activeDownloads - reaped); pumpDownloads(); }
  } catch (e) { console.error('[jobs] reaper failed:', e.message); }
}, 60000);

// A locked phone stops reading for tens of seconds and then asks for the next range on
// the socket it was holding. Node closes idle keep-alive sockets after five seconds, and
// that close is what a car hears as "the track stopped until I picked up the phone".
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;

server.listen(PORT, BIND, () => {
  log('boot', `core listening on ${BIND}:${PORT}`);
  const open = BIND === '0.0.0.0' || BIND === '::';
  if (open && !process.env.MUSICFY_TOKEN) {
    console.error('[auth] open bind with no MUSICFY_TOKEN — anyone on this network can read and change the library');
  }
});
console.log(`MUSICFY core on :${PORT}`);
warmCovers().catch(e => log('error', `cover warm: ${e.message}`));
