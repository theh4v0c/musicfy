#!/usr/bin/env node
// MUSICFY core, v1. Zero-dependency Node 22: node:http, node:sqlite, node:fs.
'use strict';
const http = require('node:http');
const zlib = require('node:zlib');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { normalize, scoreCandidate, QUALITY_RANK } = require('./ladder');
const ytdlp = require('./ytdlp');
const bandcamp = require('./bandcamp');
const mb = require('./mb');
const covers = require('./covers');
const soundcloud = require('./soundcloud');
const analyser = require('./analyze');
const queryEngine = require('./query');
const llm = require('./llm');
const genre = require('./genre');
const repair = require('./repair');
const agent = require('./agent');
const recommend = require('./recommend');
const identity = require('./identity');
const archive = require('./archive');
const spotify = require('./spotify');
const { DatabaseSync } = require('node:sqlite');

const ROOT = '/opt/musicfy';
const OWNED = 'EXTERNAL_MOUNT/owned';
const DB_PATH = process.env.MUSICFY_DB || path.join(ROOT, 'data', 'musicfy.db');
const PORT = Number(process.env.MUSICFY_PORT || 8710);
const WNL = process.env.WNL_URL || 'http://192.168.1.39:8742';
const WEB = path.join(__dirname, '..', 'web');
const COVER_DIR = path.join(ROOT, 'data', 'covers');
fs.mkdirSync(COVER_DIR, { recursive: true });

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
try { db.exec('ALTER TABLE jobs ADD COLUMN progress REAL DEFAULT 0'); } catch {}
db.prepare("UPDATE jobs SET state='error', detail='interrupted by restart', finished_at=? WHERE state='running'").run(Math.floor(Date.now() / 1000));
db.prepare("UPDATE jobs SET state='skipped' WHERE state='error' AND detail IN ('requeued','already owned','retried')").run();

// one row per artist + title: album differences must not create twins
try { db.exec('ALTER TABLE tracks ADD COLUMN dup_key TEXT'); } catch {}
function dupKeyOf(artist, title) {
  const norm = (s) => String(s || '').toLowerCase()
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
    if (r.dup_key !== k) upd.run(k, r.id);
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
for (const col of ['src_kind TEXT', 'src_id TEXT', 'src_url TEXT', 'isrc TEXT']) {
  try { db.exec(`ALTER TABLE tracks ADD COLUMN ${col}`); } catch {}
}

const now = () => Math.floor(Date.now() / 1000);
const uidOf = (a, al, t) =>
  `${(a || '').toLowerCase().trim()}|${(al || '').toLowerCase().trim()}|${(t || '').toLowerCase().trim()}`
    .replace(/\s+/g, ' ');

// ---------- helpers ----------
function upsertTrack({ title, artist, album, year, duration, format, spotify_id }) {
  const dupKey = dupKeyOf(artist, title);
  const existing = db.prepare('SELECT id FROM tracks WHERE dup_key=?').get(dupKey);
  if (existing) {
    // fill in blanks on the row we already have instead of creating a second one
    db.prepare(`UPDATE tracks SET album=COALESCE(NULLIF(album,''), ?), year=COALESCE(year, ?),
      duration=COALESCE(duration, ?), spotify_id=COALESCE(spotify_id, ?), updated_at=? WHERE id=?`)
      .run(album || '', year || null, duration || null, spotify_id || null, now(), existing.id);
    return existing.id;
  }
  const uid = uidOf(artist, album, title);
  const t = now();
  const r = db.prepare(`INSERT INTO tracks (uid,dup_key,title,artist,album,year,duration,format,spotify_id,added_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid, dupKey, title, artist || '', album || '', year || null, duration || null, format || null, spotify_id || null, t, t);
  return Number(r.lastInsertRowid);
}

function upsertFile({ track_id, path: p, tier, bitrate, size, mtime }) {
  let row = db.prepare('SELECT id FROM files WHERE path=?').get(p);
  if (row) return row.id;
  const r = db.prepare(`INSERT INTO files (track_id,path,tier,bitrate,size,mtime,added_at) VALUES (?,?,?,?,?,?,?)`)
    .run(track_id, p, tier, bitrate || null, size || null, mtime || null, now());
  return Number(r.lastInsertRowid);
}

// ---------- WNL-DL ingest ----------
async function ingestWnlFolder(folder, name) {
  const list = JSON.parse(await httpGet(`${WNL}/api/library/tracks/${encodeURIComponent(folder)}`));
  const playlistId = `wnl-${folder.replace(/^playlist-/, '')}`;
  db.prepare(`INSERT INTO playlists (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`)
    .run(playlistId, name || folder, 'wnl-dl', now(), now());

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

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} ${url}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
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
      'format=duration,bit_rate,size:format_tags=title,artist,album,date',
      '-of', 'json', file]);
    let out = '';
    ff.stdout.on('data', d => out += d);
    ff.on('close', () => {
      try {
        const f = JSON.parse(out).format || {};
        const tg = f.tags || {};
        resolve({
          title: tg.title, artist: tg.artist, album: tg.album, year: (tg.date || '').match(/^\d{4}/) ? tg.date.slice(0, 4) : null,
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
    const child = spawn('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', url], { timeout: 15000 });
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
        const best = await resolveBest({ title: t.title, artist: t.artist, duration: null });
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
    if (!st.active && st.remaining > 0) {
      analyze.run(db, { limit: Math.min(25, st.remaining), workers: 2 })
        .then((r) => console.log('[analyze] auto', JSON.stringify(r).slice(0, 120)))
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
function soundcloudFallbackDownload(b, dir, finish, ingestDownloaded, setProgress) {
  setProgress(5);
  execFile('/opt/musicfy/ytdlp-venv/bin/yt-dlp',
    ['--no-warnings', '--print', '%(duration)s', '-f', 'bestaudio/best', b.url],
    { timeout: 90000, maxBuffer: 1024 * 1024 }, (probeErr, probeOut) => {
      const probed = Number(String(probeOut || '').trim().split('\n')[0]) || 0;
      const expected = Number(b.duration) || 0;
      if (probed && expected && probed < expected * 0.6 && probed < 60) {
        return finish('error', `soundcloud preview only (${Math.round(probed)}s)`);
      }
      execFile('/opt/musicfy/ytdlp-venv/bin/yt-dlp',
        ['--no-warnings', '-f', 'hls_aac_160k/hls_aac_96k/hls_mp3_128/bestaudio',
          '-x', '--audio-format', 'm4a',
          '-o', path.join(dir, '%(title)s.%(ext)s'), b.url],
        { timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
          if (!err) return ingestDownloaded();
          // the 160k selector is missing on some tracks: retry with the default choice
          execFile('/opt/musicfy/ytdlp-venv/bin/yt-dlp',
            ['--no-warnings', '-f', 'bestaudio/best', '-x', '--audio-format', 'm4a',
              '-o', path.join(dir, '%(title)s.%(ext)s'), b.url],
            { timeout: 12 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err2) => {
              if (err2) return finish('error', String(err2.message).slice(0, 200));
              ingestDownloaded();
            });
        });
    });
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
function gzipBody(file, body) {
  const key = `${file}:${body.length}`;
  if (!gzipCache.has(key)) gzipCache.set(key, zlib.gzipSync(body, { level: 6 }));
  return gzipCache.get(key);
}
function sendStatic(req, res, body, type) {
  const acceptsGzip = /gzip/.test(req.headers['accept-encoding'] || '');
  const headers = { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', vary: 'Accept-Encoding' };
  if (acceptsGzip) {
    const gz = gzipBody(type + body.length, body);
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = gz.length;
    res.writeHead(200, headers);
    return res.end(gz);
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  return res.end(body);
}

// ---------- uploads and cover helpers ----------
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function plCoverFile(pid) {
  return path.join(COVER_DIR, `pl-${String(pid).replace(/^sp-/, '')}.jpg`);
}

// normalise any uploaded image to a 600px jpeg in the cover cache
function saveImageCover(buf, destJpg) {
  return new Promise((resolve, reject) => {
    if (!buf || !buf.length) return reject(new Error('empty image'));
    const tmp = path.join('/tmp', `mfimg-${crypto.randomUUID()}`);
    fs.writeFileSync(tmp, buf);
    execFile('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-vf', 'scale=600:-1', '-q:v', '3', destJpg],
      { timeout: 30000 }, (err) => {
        try { fs.unlinkSync(tmp); } catch {}
        err ? reject(err) : resolve(true);
      });
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
        } catch { resolve(false); }
      });
    }).on('error', () => resolve(false));
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

function recordListen({ track_id, ms_played, source }) {
  db.prepare('INSERT INTO listens (track_id,played_at,ms_played,source,scrobbled) VALUES (?,?,?,?,0)')
    .run(track_id, now(), ms_played || 0, source || 'local');
  maybeAutoDownload(track_id);
}

// stream something twice and it lands in the library by itself
function maybeAutoDownload(trackId) {
  const threshold = Number(setting('auto_download_plays', '2')) || 0;
  if (!threshold) return;
  const owned = db.prepare("SELECT id FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(trackId);
  if (owned) return;
  const plays = db.prepare('SELECT COUNT(*) c FROM listens WHERE track_id=?').get(trackId).c;
  if (plays < threshold) return;
  const pending = db.prepare("SELECT id FROM jobs WHERE kind='track-download' AND state='running' AND payload LIKE ?").get(`%\"trackId\":${trackId}%`);
  if (pending) return;
  const jobId = crypto.randomUUID();
  db.prepare('INSERT INTO jobs (kind,payload,state,created_at) VALUES (?,?,?,?)')
    .run('track-download', JSON.stringify({ jobId, trackId, auto: true }), 'running', now());
  const t = db.prepare('SELECT title, artist, duration FROM tracks WHERE id=?').get(trackId);
  resolveBest({ title: t.title, artist: t.artist, duration: t.duration })
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

// shared: queue one track download from a plain row
function enqueueTrackDownload(t) {
  if (!t || !t.id) return false;
  const busy = db.prepare("SELECT id FROM jobs WHERE (state='queued' OR state='running') AND payload LIKE ?").get(`%\"trackId\":${t.id}%`);
  if (busy) return false;
  const jobId = crypto.randomUUID();
  db.prepare('INSERT INTO jobs (kind,payload,state,progress,created_at) VALUES (?,?,?,0,?)')
    .run('track-download', JSON.stringify({ jobId, trackId: t.id, title: t.title, artist: t.artist }), 'queued', now());
  resolveBest({ title: t.title, artist: t.artist, duration: t.duration || null })
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
  const rows = db.prepare("SELECT id, track_id, path FROM files WHERE tier='owned'").all();
  const missing = [];
  for (const f of rows) {
    if (!fs.existsSync(f.path)) missing.push(f);
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
  return { checked: rows.length, missing: missing.length, queued, tracks: missing.map((f) => f.track_id) };
}

// ---------- download queue ----------
const downloadQueue = [];
let activeDownloads = 0;
const MAX_DOWNLOADS = Number(process.env.MUSICFY_DOWNLOAD_CONCURRENCY || 4);

// 'best' keeps whatever the source serves instead of transcoding to a lossy copy
function downloadFormat() {
  try {
    const s = JSON.parse(fs.readFileSync('/opt/musicfy/data/settings.json', 'utf8'));
    return s.preferred_format || 'best';
  } catch { return 'best'; }
}
function audioArgs() {
  const fmt = downloadFormat();
  return fmt === 'best' ? ['-f', 'bestaudio/best'] : ['-x', '--audio-format', fmt, '--audio-quality', '0'];
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
    activeDownloads += 1;
    db.prepare("UPDATE jobs SET state='running' WHERE payload LIKE ?").run(`%${item.jobId}%`);
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
  const dir = path.join(OWNED, 'web', String(jobId).slice(0, 8));
  fs.mkdirSync(dir, { recursive: true });
  const finish = (state, detail) => {
    runningChildren.delete(jobId);
    if (cancelledJobs.has(jobId)) { state = 'cancelled'; detail = ''; }
    db.prepare('UPDATE jobs SET state=?, detail=?, progress=?, finished_at=? WHERE payload LIKE ?')
      .run(state, detail || '', state === 'done' ? 100 : 0, now(), `%${jobId}%`);
    fs.rmSync(dir, { recursive: true, force: true });
    if (typeof onDone === 'function') { try { onDone(); } catch {} }
  };
  const setProgress = (pct) => {
    db.prepare('UPDATE jobs SET progress=? WHERE payload LIKE ?').run(Math.max(0, Math.min(99, pct)), `%${jobId}%`);
  };
  const watch = (child) => {
    const onChunk = (buf) => {
      const m = String(buf).match(/(\d+(?:\.\d+)?)%/);
      if (m) setProgress(Number(m[1]));
    };
    if (child.stdout) child.stdout.on('data', onChunk);
    if (child.stderr) child.stderr.on('data', onChunk);
  };
  const ingestDownloaded = () => {
    const files = fs.readdirSync(dir)
      .filter((f) => !f.startsWith('.') && /\.(mp3|m4a|aac|opus|ogg|flac|wav|webm|mp4|m4b|mkv|aiff?)$/i.test(f))
      // yt-dlp writes a .part file while it works; never treat that as a result
      .filter((f) => !/\.part$/i.test(f));
    if (!files.length) return finish('error', 'no audio file produced');
    const fp = path.join(dir, files[0]);
    spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate:format_tags=title,artist', '-of', 'json', fp]).on('exit', () => {});
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate:format_tags=title,artist', '-of', 'json', fp], { timeout: 20000 }, (err, stdout) => {
      let dur = null, br = null, t = b.title || files[0], a = b.artist || '';
      try { const f = JSON.parse(stdout).format; dur = Number(f.duration); br = Number(f.bit_rate); t = f.tags?.title || t; a = f.tags?.artist || a; } catch {}
      const dest = path.join(OWNED, 'web', files[0].replace(/[/\\]/g, '_'));
      fs.renameSync(fp, dest);
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
      const ext = (files[0].split('.').pop() || 'mp3').toLowerCase();
      tid = tid || upsertTrack({ title: t, artist: a, album: b.artist || 'Web', duration: dur, format: ext });
      // refuse truncated audio: a 30 second preview must never replace a real track
      const declared = Number(b.duration) || Number(db.prepare('SELECT duration FROM tracks WHERE id=?').get(tid)?.duration) || 0;
      if (dur && declared && dur < declared * 0.6) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        return finish('unavailable', `truncated audio: ${Math.round(dur)}s of ${Math.round(declared)}s`);
      }
      if (dur && dur < 3) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        return finish('error', `clip too short: ${Math.round(dur)}s`);
      }

      // one file per track, and the better copy wins
      const existingFiles = db.prepare("SELECT id, path, bitrate FROM files WHERE track_id=? AND tier='owned'").all(tid)
        .sort((a, b) => fileQuality(path.extname(b.path), b.bitrate) - fileQuality(path.extname(a.path), a.bitrate));
      const current = existingFiles[0];
      if (current && fileQuality(path.extname(current.path), current.bitrate) >= fileQuality(path.extname(dest), br)) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        finish('done', 'kept the higher quality copy that was already stored');
        return;
      }
      for (const f of existingFiles) {
        db.prepare('DELETE FROM files WHERE id=?').run(f.id);
        try { fs.rmSync(f.path, { force: true }); } catch {}
      }
      upsertFile({ track_id: tid, path: dest, tier: 'owned', bitrate: br, size: fs.statSync(dest).size, mtime: now() });
      db.prepare('INSERT OR REPLACE INTO resolutions (track_id,rung,quality,resolved_at) VALUES (?,?,?,?)')
        .run(tid, b.rung || 'yt-dlp', br ? `${Math.round(br / 1000)}k` : '320k', now());
      if (b.isrc) db.prepare('UPDATE tracks SET isrc=? WHERE id=?').run(b.isrc, tid);
      const haveArt = fs.existsSync(coverFile(tid));
      const done = () => finish('done', `track ${tid}`);
      if (!haveArt && b.thumb) saveThumb(b.thumb, tid).then(done).catch(done);
      else done();
    });
  };

  if (b.rung === 'search') {
    const query = [b.artist, b.title].filter(Boolean).join(' ');
    const trySource = (source, next) => {
      const child = spawn('/opt/musicfy/ytdlp-venv/bin/yt-dlp', [
        '--no-warnings', '--newline', ...audioArgs(),
        '--max-downloads', '1', '--match-filter', 'duration > 2',
        '-o', path.join(dir, '%(title)s.%(ext)s'), source,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      watch(child);
      runningChildren.set(jobId, child);
      child.on('error', next);
      child.on('close', (code) => { if (code === 0 && fs.readdirSync(dir).some((f) => /\.(mp3|m4a)$/i.test(f))) return ingestDownloaded(); next(); });
    };
    trySource(`scsearch3:${query}`, () => trySource(`ytsearch3:${query}`, () => finish('error', 'no source in search')));
    return;
  }

  if ((b.rung === 'yt-dlp' || b.rung === 'ytmusic' || b.rung === 'ytmusic-album') && b.id) {
    const yt = String(b.url || '').includes('watch')
      ? b.url
      : `https://www.youtube.com/watch?v=${b.id}`;
    const child = spawn('/opt/musicfy/ytdlp-venv/bin/yt-dlp', [
      '--no-warnings', '--newline', ...audioArgs(),
      '--concurrent-fragments', '4', '--retries', '3', '--fragment-retries', '3',
      '-o', path.join(dir, '%(title)s.%(ext)s'), yt,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    watch(child);
    runningChildren.set(jobId, child);
    child.on('error', (e) => finish('error', String(e.message).slice(0, 200)));
    child.on('close', (code) => {
      if (code === 0) return ingestDownloaded();
      // several YouTube videos only answer to a specific client, so walk the list
      const clients = ['android', 'ios', 'web_safari', 'tv'];
      const tryClient = (index) => {
        if (index >= clients.length) {
          // last resort: let yt-dlp search and take the first that works
          const query = `ytsearch3:${[b.artist, b.title].filter(Boolean).join(' ')}`;
          const retry = spawn('/opt/musicfy/ytdlp-venv/bin/yt-dlp', [
            '--no-warnings', '--newline', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
            '--max-downloads', '1', '--match-filter', 'duration > 2',
            '--extractor-args', 'youtube:player_client=android',
            '-o', path.join(dir, '%(title)s.%(ext)s'), query,
          ], { stdio: ['ignore', 'pipe', 'pipe'] });
          watch(retry);
          runningChildren.set(jobId, retry);
          retry.on('error', (e) => finish('error', String(e.message).slice(0, 160)));
          retry.on('close', (code2) => {
            if (code2 !== 0) return finish('error', `yt-dlp exit ${code}, clients and search failed`);
            ingestDownloaded();
          });
          return;
        }
        const attempt = spawn('/opt/musicfy/ytdlp-venv/bin/yt-dlp', [
          '--no-warnings', '--newline', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
          '--extractor-args', `youtube:player_client=${clients[index]}`,
          '-o', path.join(dir, '%(title)s.%(ext)s'), yt,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        watch(attempt);
        runningChildren.set(jobId, attempt);
        attempt.on('error', () => tryClient(index + 1));
        attempt.on('close', (c) => {
          if (c === 0) return ingestDownloaded();
          tryClient(index + 1);
        });
      };
      tryClient(0);
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
    execFile('/opt/musicfy/ytdlp-venv/bin/yt-dlp',
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
async function resolveBest(seed, cap = 1800) {
  // ask the catalogue who this is first: exact title, artist and length make every
  // later filter meaningful. iTunes answers in half a second, MusicBrainz does not.
  let canon = null;
  const baseTitle = cleanTitle(seed.title);
  try { canon = await identity.canon(seed.artist || '', baseTitle); } catch {}
  const searchSeed = canon
    ? { ...seed, artist: canon.artist || seed.artist, title: canon.title || baseTitle }
    : { ...seed, title: baseTitle };

  const [yt, sc, ia] = await Promise.all([
    ytdlp.searchYoutube(searchSeed, { limit: 6 }).catch(() => []),
    ytdlp.searchSoundcloud(searchSeed, { limit: 5 }).catch(() => []),
    archive.searchArchive(searchSeed, { limit: 4 }).catch(() => []),
  ]);
  let canonical = null;
  try { canonical = await mb.lookup(searchSeed.artist, searchSeed.title); } catch {}
  const expected = (canon && canon.duration) || (canonical && canonical.duration) || seed.duration || null;

  const scored = [...yt, ...sc, ...ia]
    .map((c) => {
      if (c.rung === 'yt-dlp' && c.id) c.thumb = `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`;
      if (c.rung === 'archive' && c.id) c.thumb = `https://archive.org/services/img/${c.id}`;
      return { ...c, ...scoreCandidate(c, searchSeed) };
    })
    .filter((c) => c.score > 0 && (!cap || !c.duration || c.duration <= cap))
    .filter((c) => !(c.rung === 'archive' && !c.duration))   // whole collections, not tracks
    .filter((c) => {
      if (!expected || !c.duration) return true;
      // kids songs and interludes differ between album and video cuts, so allow more slack there
      const tol = expected < 30 ? Math.max(3, expected * 0.5)
        : expected < 180 ? Math.max(20, expected * 0.6) : 8;
      return Math.abs(c.duration - expected) <= tol;
    })
    .map((c) => ({ ...c, isrc: (canonical && canonical.isrc) || null, verified: !!(expected && c.duration && Math.abs(c.duration - expected) <= 4) }))
    .sort((a, b) => {
      const near = (x) => (expected && x.duration ? Math.abs(x.duration - expected) : 9999);
      return b.score - a.score || near(a) - near(b) || QUALITY_RANK(b) - QUALITY_RANK(a);
    });
  if (scored.length) return scored[0];

  // nothing matched with the artist attached: sweep by title and judge on length alone
  try {
    const loose = await ytdlp.searchYoutube({ title: searchSeed.title, artist: '' }, { limit: 8 }).catch(() => []);
    const want = expected || seed.duration || null;
    const looseTol = !want ? 8
      : want < 30 ? Math.max(3, want * 0.5)
      : want < 180 ? Math.max(20, want * 0.6) : 8;
    const viable = loose
      .filter((c) => c.duration && (!want || Math.abs(c.duration - want) <= looseTol))
      .sort((a, b) => Math.abs((a.duration || 0) - (want || a.duration || 0)) - Math.abs((b.duration || 0) - (want || b.duration || 0)));
    if (viable[0]) return { ...viable[0], score: 30, verified: !!want };
  } catch {}

  return null;
}

// ---------- HTTP ----------
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/health') return json(res, 200, { ok: true, uptime: process.uptime() });

    // static player (never cached: single-user dev flow, bust by content)
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(path.join(WEB, 'index.html')));
    }
    if (u.pathname === '/app.css') {
      const body = fs.readFileSync(path.join(WEB, 'app.css'));
      return sendStatic(req, res, body, 'text/css; charset=utf-8');
    }
    if (u.pathname === '/app.js') {
      const body = fs.readFileSync(path.join(WEB, 'app.js'));
      return sendStatic(req, res, body, 'text/javascript; charset=utf-8');
    }

    if (u.pathname === '/api/search/ladder') {
      const q = (u.searchParams.get('q') || '').trim();
      if (q.length < 2) return json(res, 400, { error: 'query too short' });
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

      return json(res, 200, {
        query: q, normalized: normalize(q), results: deduped.slice(0, 80), artistOnly,
        catalogue,
        canonical: canonical ? { title: canonical.title, artist: canonical.artist, album: canonical.album,
          duration: canonical.duration, genre: canonical.genre, family: canonical.family, year: canonical.year,
          confidence: Math.round((canonical.score || 0) * 100) } : null,
        library: libraryHits.map((t) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album,
          duration: t.duration, isrc: t.isrc, bpm: t.bpm, key: t.key, has_file: !!t.has_file })),
        albums: [...albums.map((a) => ({ ...a, kind: 'library' })), ...archiveAlbums],
        rungs: ['ytmusic', 'soundcloud', 'bandcamp', 'archive'], connected: true,
      });
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
      } catch (e) { return json(res, 502, { error: e.message }); }
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
      } catch (e) { return json(res, 502, { error: e.message }); }
    }

    // soundcloud: download once into a cache file, then stream that file as it grows.
    // A direct pipe from yt-dlp into ffmpeg stalls inside the service, so the file is the
    // source of truth: playback starts as soon as the first chunk exists.
    if (u.pathname === '/api/ladder/stream/soundcloud') {
      const target = u.searchParams.get('u') || '';
      if (!/^https:\/\/(www\.)?(api\.)?soundcloud\.com\//.test(target)) return json(res, 400, { error: 'non-soundcloud url' });
      const dir = '/tmp/musicfy-sc';
      fs.mkdirSync(dir, { recursive: true });
      const key = 'sc-' + target.replace(/[^a-zA-Z0-9]+/g, '').slice(-40);
      const file = path.join(dir, key + '.mp3');

      const ready = fs.existsSync(file) && fs.statSync(file).size > 102400;

      if (ready) {
        const st = fs.statSync(file);
        const head = { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
        const range = req.headers.range;
        if (range) {
          const r = range.match(/bytes=(\d*)-(\d*)/);
          const s = r && r[1] ? Number(r[1]) : 0;
          let e = r && r[2] ? Number(r[2]) : st.size - 1;
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
        const child = spawn('/opt/musicfy/ytdlp-venv/bin/yt-dlp',
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
      const target = u.searchParams.get('u') || '';
      if (!/^https:\/\//.test(target)) return json(res, 400, { error: 'absolute https url required' });
      try {
        const loc = await ytdlp.streamUrlFor(target);
        res.writeHead(302, { location: loc });
        return res.end();
      } catch (e) { return json(res, 502, { error: e.message }); }
    }


    // generic resolver for bandcamp and other yt-dlp supported pages
    if (u.pathname === '/api/ladder/stream/generic') {
      const target = u.searchParams.get('u') || '';
      if (!/^https:\/\//.test(target)) return json(res, 400, { error: 'absolute https url required' });
      try {
        const loc = await ytdlp.streamUrlFor(target);
        res.writeHead(302, { location: loc });
        return res.end();
      } catch (e) { return json(res, 502, { error: e.message }); }
    }



    // generic resolver for bandcamp and other yt-dlp supported pages
    if (u.pathname === '/api/ladder/stream/generic') {
      const target = u.searchParams.get('u') || '';
      if (!/^https:\/\//.test(target)) return json(res, 400, { error: 'absolute https url required' });
      try {
        const loc = await ytdlp.streamUrlFor(target);
        res.writeHead(302, { location: loc });
        return res.end();
      } catch (e) { return json(res, 502, { error: e.message }); }
    }

    // generic resolver for bandcamp and other yt-dlp supported pages
    if (u.pathname === '/api/ladder/stream/generic') {
      const target = u.searchParams.get('u') || '';
      if (!/^https:\/\//.test(target)) return json(res, 400, { error: 'absolute https url required' });
      try {
        const loc = await ytdlp.streamUrlFor(target);
        res.writeHead(302, { location: loc });
        return res.end();
      } catch (e) { return json(res, 502, { error: e.message }); }
    }



    // generic resolver for bandcamp and other yt-dlp supported pages
    if (u.pathname === '/api/ladder/stream/generic') {
      const target = u.searchParams.get('u') || '';
      if (!/^https:\/\//.test(target)) return json(res, 400, { error: 'absolute https url required' });
      try {
        const loc = await ytdlp.streamUrlFor(target);
        res.writeHead(302, { location: loc });
        return res.end();
      } catch (e) { return json(res, 502, { error: e.message }); }
    }



    // generic resolver for bandcamp and other yt-dlp supported pages
    if (u.pathname === '/api/ladder/stream/generic') {
      const target = u.searchParams.get('u') || '';
      if (!/^https:\/\//.test(target)) return json(res, 400, { error: 'absolute https url required' });
      try {
        const loc = await ytdlp.streamUrlFor(target);
        res.writeHead(302, { location: loc });
        return res.end();
      } catch (e) { return json(res, 502, { error: e.message }); }
    }



    // archive item: list playable files
    const mIaFiles = u.pathname.match(/^\/api\/ladder\/archive\/([^/]+)\/files$/);
    if (mIaFiles) {
      const files = await archive.itemFiles(decodeURIComponent(mIaFiles[1])).catch(() => []);
      return json(res, 200, { identifier: decodeURIComponent(mIaFiles[1]), files });
    }

    // download a ladder result into the owned tier (async job)
    if (u.pathname === '/api/ladder/download' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => body += c);
      req.on('end', async () => {
        try {
          const b = JSON.parse(body);
          const jobId = crypto.randomUUID();
          db.prepare('INSERT INTO jobs (kind,payload,state,created_at) VALUES (?,?,?,?)')
            .run('ladder-download', JSON.stringify({ jobId, ...b }), 'running', now());
          // catalogue rows arrive with only a title and artist: resolve them first
          let payload = b;
          if (!payload.id && !payload.url) {
            const best = await resolveBest({ title: payload.title, artist: payload.artist, duration: payload.duration || null });
            if (!best) return json(res, 200, { error: 'no source' });
            payload = { ...payload, ...best, rung: best.rung, id: best.id, url: best.url };
          }
          enqueueDownload(jobId, payload);
          json(res, 200, { job: jobId });
        } catch (e) { json(res, 400, { error: e.message }); }
      });
      return;
    }

    const mJob = u.pathname.match(/^\/api\/jobs\/([\w-]+)$/);
    if (mJob) {
      const j = db.prepare('SELECT * FROM jobs WHERE payload LIKE ? OR created_at>? LIMIT 1').get(`%${mJob[1]}%`, 0);
      const row = db.prepare('SELECT id,kind,payload,state,detail,created_at,finished_at FROM jobs ORDER BY id DESC LIMIT 50').all();
      const target = row.find((r) => (JSON.parse(r.payload || '{}').jobId === mJob[1]));
      if (!target) return json(res, 404, { error: 'unknown job' });
      return json(res, 200, { id: mJob[1], kind: target.kind, state: target.state, detail: target.detail });
    }

    // mirror a spotify playlist: metadata only, nothing downloaded
    if (u.pathname === '/api/mirror/spotify' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const b = JSON.parse(body || '{}');
          let target = String(b.url || b.id || '').trim();
          // a bare id is ambiguous; for mirroring treat it as a playlist id
          if (/^[A-Za-z0-9]{16,30}$/.test(target)) target = `https://open.spotify.com/playlist/${target}`;
          const info = await spotify.resolve(target);
          if (!info) return json(res, 404, { error: 'not found on spotify' });
          if (info.kind !== 'playlist') return json(res, 400, { error: 'that is a single track, use its download button' });
          const pid = `sp-${info.id}`;
          db.prepare(`INSERT INTO playlists (id,name,source,spotify_id,created_at,updated_at) VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`)
            .run(pid, info.title || 'Spotify playlist', 'spotify', info.id, now(), now());
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
            const dest = path.join(COVER_DIR, `pl-${info.id}.jpg`);
            https.get(info.cover, (r) => { if (r.statusCode === 200) { const w = fs.createWriteStream(dest); r.pipe(w); } else { r.resume(); } }).on('error', () => {});
          }
          json(res, 200, { playlist: pid, name: info.title, tracks: pos, added });
        } catch (e) { json(res, 502, { error: e.message }); }
      });
      return;
    }

    // download one catalog track that has no file yet (mirrored rows)
    const mTdl = u.pathname.match(/^\/api\/tracks\/(\d+)\/download$/);
    if (mTdl && req.method === 'POST') {
      const tid = Number(mTdl[1]);
      const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(tid);
      if (!t) return json(res, 404, { error: 'no such track' });
      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO jobs (kind,payload,state,created_at) VALUES (?,?,?,?)')
        .run('track-download', JSON.stringify({ jobId, trackId: tid }), 'queued', now());
      resolveBest({ title: t.title, artist: t.artist, duration: t.duration })
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
      const buf = await readBody(req);
      if (!buf.length) return json(res, 400, { error: 'empty upload' });
      const dir = path.join(OWNED, 'upload');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, name);
      fs.writeFileSync(dest, buf);
      const meta = await probe(dest);
      const tid = upsertTrack({
        title: meta.title || name.replace(/\.[^.]+$/, ''),
        artist: meta.artist || '',
        album: meta.album || '',
        year: meta.year || null,
        duration: meta.duration,
        format: (name.split('.').pop() || 'mp3').toLowerCase(),
      });
      upsertFile({ track_id: tid, path: dest, tier: 'owned', bitrate: meta.bitrate, size: meta.size, mtime: meta.mtime });
      db.prepare('INSERT OR REPLACE INTO resolutions (track_id,rung,quality,resolved_at) VALUES (?,?,?,?)')
        .run(tid, 'upload', meta.bitrate ? `${Math.round(meta.bitrate / 1000)}k` : null, now());
      const art = await extractCover(tid, dest).catch(() => false);
      db.prepare('UPDATE tracks SET has_art=? WHERE id=?').run(art ? 1 : 0, tid);
      return json(res, 200, { track: tid, title: meta.title || name, has_art: !!art });
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
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // replace the artwork of one playlist
    const mPlCover = u.pathname.match(/^\/api\/playlists\/([^/]+)\/cover$/);
    if (mPlCover && req.method === 'POST') {
      const pid = decodeURIComponent(mPlCover[1]);
      const buf = await readBody(req);
      try {
        await saveImageCover(buf, plCoverFile(pid));
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // self hosted font assets
    if (u.pathname === '/fonts.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(path.join(WEB, 'fonts.css')));
    }
    if (u.pathname.startsWith('/fonts/')) {
      const rel = path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, '');
      const fp = path.join(WEB, rel);
      if (fp.startsWith(WEB) && fs.existsSync(fp) && /\.woff2?$/.test(fp)) {
        res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000' });
        return res.end(fs.readFileSync(fp));
      }
      res.writeHead(404); return res.end();
    }

    // rescan the history folder for newly delivered exports
    if (u.pathname === '/api/history/scan' && req.method === 'POST') {
      const HISTORY_DIR = '/opt/musicfy/data/history';
      try {
        const out = await new Promise((resolve, reject) => {
          execFile(process.execPath, [path.join(__dirname, 'import-history.js'), HISTORY_DIR],
            { timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout) => (err && !stdout ? reject(new Error(String(err.message).slice(0, 200))) : resolve(stdout || '')));
        });
        const m = out.match(/\{[\s\S]*\}\s*$/);
        const stats = m ? JSON.parse(m[0]) : null;
        return json(res, 200, { ok: true, stats, log: out.split('\n').slice(-6).join('\n') });
      } catch (e) { return json(res, 500, { error: e.message }); }
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
      req.on('end', async () => {
        try {
          const b = JSON.parse(body || '{}');
          let target = String(b.url || b.id || '').trim();
          if (/^[A-Za-z0-9]{16,30}$/.test(target)) target = `https://open.spotify.com/track/${target}`;
          const info = await spotify.resolve(target);
          if (!info || info.kind !== 'track') return json(res, 404, { error: 'not a spotify track' });
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
          return json(res, 200, { track: tid, title: info.title, playlist: pid, added: !!pid });
        } catch (e) { return json(res, 502, { error: e.message }); }
      });
      return;
    }

    // build a playlist from your listening history (import path that is not the ladder)
    if (u.pathname === '/api/history/materialize' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', async () => {
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
          db.prepare('INSERT INTO playlists (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)')
            .run(pid, name, 'history', now(), now());
          let pos = 0;
          for (const r of rows) {
            const tid = upsertTrack({ title: r.title, artist: r.artist, album: r.album || '', duration: null, format: 'mirror', spotify_id: (r.uri || '').split(':').pop() });
            db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)').run(pid, tid, pos++, now());
          }
          json(res, 200, { playlist: pid, name, added: pos });
        } catch (e) { json(res, 400, { error: e.message }); }
      });
      return;
    }

    // merge duplicate rows that already exist
    if (u.pathname === '/api/maintenance/merge-duplicates' && req.method === 'POST') {
      const groups = db.prepare(`SELECT lower(title) t, lower(COALESCE(artist,'')) a, COUNT(*) c
        FROM tracks GROUP BY t, a HAVING c > 1`).all();
      let merged = 0;
      for (const g of groups) {
        const rows = db.prepare(`SELECT t.id, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.track_id=t.id) np,
          (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id) nf
          FROM tracks t WHERE lower(t.title)=? AND lower(COALESCE(t.artist,''))=? ORDER BY np DESC, nf DESC, t.id ASC`).all(g.t, g.a);
        const keep = rows[0];
        if (!keep) continue;
        for (const dupe of rows.slice(1)) {
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
          merged++;
        }
        db.prepare('UPDATE tracks SET has_art=1 WHERE id=? AND EXISTS (SELECT 1 FROM files f WHERE f.track_id=? AND f.tier=? )').run(keep.id, keep.id, 'owned');
      }
      return json(res, 200, { ok: true, groups: groups.length, merged });
    }

    // merge near duplicate tracks, keeping the highest quality copy
    if (u.pathname === '/api/maintenance/dedupe' && req.method === 'POST') {
      const keyOf = (artist, title) => {
        const norm = (s) => String(s || '').toLowerCase()
          .replace(/\((?:feat\.?|ft\.?|with|remaster[^)]*|deluxe[^)]*|bonus[^)]*)[^)]*\)/g, ' ')
          .replace(/\[[^\]]*\]/g, ' ')
          .replace(/\s+-\s+(?:remaster(?:ed)?|single version|album version|radio edit|explicit|clean).*$/g, ' ')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        return `${norm(artist)}|${norm(title)}`;
      };
      const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.dup_key,
        (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.track_id=t.id) plays_in,
        (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned,
        (SELECT MAX(f.bitrate) FROM files f WHERE f.track_id=t.id AND f.tier='owned') bitrate
        FROM tracks t`).all();

      const groups = new Map();
      for (const r of rows) {
        const k = keyOf(r.artist, r.title);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }

      let removed = 0, mergedGroups = 0;
      for (const [k, list] of groups) {
        if (list.length < 2) continue;
        // best quality first: has a file, then the highest bitrate, then the oldest row
        list.sort((a, b) => (b.owned - a.owned) || ((b.bitrate || 0) - (a.bitrate || 0)) || (a.id - b.id));
        const keep = list[0];
        if (!keep) continue;
        mergedGroups += 1;
        for (const dupe of list.slice(1)) {
          if (dupe.id === keep.id) continue;
          db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
          db.prepare('DELETE FROM playlist_tracks WHERE track_id=?').run(dupe.id);
          if (!keep.owned) {
            db.prepare('UPDATE OR IGNORE files SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
          }
          db.prepare('DELETE FROM files WHERE track_id=?').run(dupe.id);
          db.prepare('UPDATE OR IGNORE likes SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
          db.prepare('DELETE FROM likes WHERE track_id=?').run(dupe.id);
          db.prepare('UPDATE listens SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
          db.prepare('UPDATE OR IGNORE resolutions SET track_id=? WHERE track_id=?').run(keep.id, dupe.id);
          db.prepare('DELETE FROM resolutions WHERE track_id=?').run(dupe.id);
          db.prepare('DELETE FROM tracks WHERE id=?').run(dupe.id);
          removed += 1;
        }
      }
      return json(res, 200, { ok: true, groups: mergedGroups, removed });
    }

    // metadata repair: clear impossible years, collapse placeholder albums, trim whitespace
    if (u.pathname === '/api/maintenance/repair' && req.method === 'POST') {
      const thisYear = new Date().getFullYear();
      let fixedYear = 0, fixedAlbum = 0, trimmed = 0;
      const rows = db.prepare("SELECT id, title, artist, album, year FROM tracks").all();
      const upd = db.prepare('UPDATE tracks SET title=?, artist=?, album=?, year=? WHERE id=?');
      for (const t of rows) {
        const title = (t.title || '').replace(/\s+/g, ' ').trim();
        const artist = (t.artist || '').replace(/\s+/g, ' ').trim();
        let album = (t.album || '').replace(/\s+/g, ' ').trim();
        let year = Number(t.year) || null;
        let changed = false;
        if (year !== null && (year < 1900 || year > thisYear + 1)) { year = null; fixedYear++; changed = true; }
        if (album && (album.toLowerCase() === 'web' || album.toLowerCase() === 'unknown' || album === title)) { album = ''; fixedAlbum++; changed = true; }
        if (title !== t.title || artist !== t.artist) trimmed++;
        if (changed || title !== t.title || artist !== t.artist) upd.run(title, artist, album, year, t.id);
      }
      json(res, 200, { ok: true, fixed_year: fixedYear, cleared_placeholder_album: fixedAlbum, trimmed });
      return;
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
        const cur = db.prepare('SELECT title, artist FROM tracks WHERE id=?').get(id);
        if (!cur) return json(res, 404, { error: 'no such track' });
        const fields = {};
        for (const k of ['title', 'artist', 'album', 'year', 'genre', 'genre_family']) {
          if (b[k] !== undefined) fields[k] = String(b[k] || '').trim() || null;
        }
        if (!Object.keys(fields).length) return json(res, 400, { error: 'nothing to change' });
        const r = repair.apply(db, id, fields);
        if (r.error) return json(res, 409, r);
        return json(res, 200, { ok: true, ...r });
      });
      return;
    }

    // find rows whose file vanished, clear them and optionally requeue
    if (u.pathname === '/api/maintenance/verify-files' && req.method === 'POST') {
      const requeue = u.searchParams.get('requeue') !== '0';
      return json(res, 200, verifyFiles({ requeue }));
    }

    // settings: model endpoint, keys, profile
    if (u.pathname === '/api/settings') {
      const file = '/opt/musicfy/data/settings.json';
      if (req.method === 'GET') {
        let s = {};
        try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
        const cfg = llm.config() || {};
        return json(res, 200, {
          settings: s,
          llm: { configured: !!llm.config(), base_url: cfg.base_url || '', model: cfg.model || '', has_key: !!cfg.api_key },
        });
      }
      if (req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', () => {
          let b = {};
          try { b = JSON.parse(body || '{}'); } catch {}
          let s = {};
          try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
          for (const k of ['display_name', 'email', 'country', 'timezone', 'llm_base_url', 'llm_model', 'llm_api_key',
            'download_root', 'preferred_format', 'autoplay_next', 'show_stream_rows',
            'normalize_loudness', 'target_loudness', 'crossfade_ms', 'fade_on_play']) {
            if (b[k] !== undefined) s[k] = b[k];
          }
          fs.mkdirSync('/opt/musicfy/data', { recursive: true });
          fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
          // a model change takes effect immediately
          if (b.llm_base_url || b.llm_model || b.llm_api_key) {
            try {
              llm.saveConfig({ base_url: b.llm_base_url || (llm.config() || {}).base_url,
                model: b.llm_model || (llm.config() || {}).model,
                api_key: b.llm_api_key || (llm.config() || {}).api_key });
            } catch {}
          }
          return json(res, 200, { ok: true, settings: s });
        });
        return;
      }
    }

    // what arrived most recently, newest first
    if (u.pathname === '/api/library/recent-downloads') {
      const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.genre_family, f.mtime
        FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
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
      req.on('end', async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const q = String(b.q || '').trim();
        if (!q) return json(res, 400, { error: 'q required' });
        let plan = null;
        let source = 'rules';
        if (llm.available()) {
          try {
            plan = await Promise.race([agent.planWithModel(llm, q), new Promise((r) => setTimeout(() => r(null), 5000))]);
            if (plan) source = 'llm';
          } catch {}
        }
        if (!plan) plan = agent.planLocally(q);
        const result = await agent.execute(db, plan, { enqueueTrackDownload });
        return json(res, 200, { question: q, plan, source, ...result });
      });
      return;
    }

    // recommendations driven by current listening
    if (u.pathname === '/api/recommend') {
      const days = Math.min(Number(u.searchParams.get('days') || 30), 365);
      const limit = Math.min(Number(u.searchParams.get('limit') || 40), 100);
      return json(res, 200, recommend.build(db, { days, limit }));
    }
    // one playlist per week, excluding anything already in a playlist
    if (u.pathname === '/api/recommend/weekly' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const now2 = new Date();
        const jan1 = new Date(Date.UTC(now2.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((now2 - jan1) / 86400000) + jan1.getUTCDay() + 1) / 7);
        const name = `For you W${String(week).padStart(2, '0')}`;
        const existing = db.prepare('SELECT id FROM playlists WHERE name=?').get(name);
        if (existing) {
          const n = db.prepare('SELECT COUNT(*) c FROM playlist_tracks WHERE playlist_id=?').get(existing.id).c;
          return json(res, 200, { created: null, existing: { id: existing.id, name, tracks: n }, reason: 'this week already has a list' });
        }
        const days = Math.min(Number(b.days || 30), 365);
        const out = recommend.build(db, { days, limit: Math.min(Number(b.limit || 25), 100), excludePlaylisted: true });
        const inAnyPlaylist = new Set(db.prepare('SELECT DISTINCT track_id id FROM playlist_tracks').all().map((r) => r.id));
        const picks = out.picks.filter((p) => !inAnyPlaylist.has(p.id));
        if (!picks.length) return json(res, 200, { created: null, reason: 'nothing new to add this week' });
        const pid = `rec-${Date.now().toString(36)}`;
        db.prepare('INSERT INTO playlists (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)').run(pid, name, 'recommend', now(), now());
        let pos = 0;
        for (const p of picks) db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)').run(pid, p.id, pos++, now());
        return json(res, 200, { created: { id: pid, name, tracks: pos }, profile: out.profile });
      });
      return;
    }

    if (u.pathname === '/api/recommend/create' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const days = Math.min(Number(b.days || 30), 365);
        const limit = Math.min(Number(b.limit || 25), 100);
        const out = recommend.build(db, { days, limit });
        if (!out.picks.length) return json(res, 200, { created: null, reason: 'not enough listening history yet' });
        const name = String(b.name || `For you ${new Date().toISOString().slice(0, 10)}`).slice(0, 80);
        const pid = `rec-${Date.now().toString(36)}`;
        db.prepare('INSERT INTO playlists (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)')
          .run(pid, name, 'recommend', now(), now());
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
      const limit = Math.min(Number(u.searchParams.get('limit') || 120), 600);
      const loop = u.searchParams.get('all') === '1';
      (async () => {
        let guard = 0;
        for (;;) {
          const r = await genre.fillTracks(db, { limit });
          console.log('[genre]', JSON.stringify(r));
          guard += 1;
          if (!loop || !r.remainingArtists || guard > 40) break;
          await new Promise((res2) => setTimeout(res2, 2000));
        }
      })().catch((e) => console.error('[genre]', e.message));
      return json(res, 202, { started: true, limit, loop });
    }
    if (u.pathname === '/api/genre/status') {
      const total = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
      const tagged = db.prepare("SELECT COUNT(*) c FROM tracks WHERE genre IS NOT NULL AND genre != ''").get().c;
      const families = db.prepare("SELECT genre_family g, COUNT(*) c FROM tracks WHERE genre_family IS NOT NULL GROUP BY g ORDER BY c DESC").all();
      return json(res, 200, { total, tagged, untagged: total - tagged, families });
    }

    // ask the library a question in plain language, optionally creating a playlist
    if (u.pathname === '/api/ask' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', async () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const question = String(b.q || '').trim();
        if (!question) return json(res, 400, { error: 'q required' });

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
        if (!filters && llm.available()) {
          try {
            // a slow provider must never hold the answer hostage: drop to the local parser fast
            const out = await Promise.race([
              llm.ask(question),
              new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
            ]);
            if (out && out.filters) { filters = out.filters; source = 'llm'; }
            if (out && out.title) b.title = b.title || out.title;
          } catch (e) { /* fall back to the deterministic parser */ }
        }
        if (!filters) filters = queryEngine.parse(question, db);
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
          db.prepare('INSERT INTO playlists (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)')
            .run(pid, name, 'ask', now(), now());
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
      analyser.run(db, { limit, workers }).then((r) => console.log('[analyze]', JSON.stringify(r))).catch((e) => console.error('[analyze]', e.message));
      return json(res, 202, { started: true, limit, workers, status: analyser.status(db) });
    }
    if (u.pathname === '/api/analyze/status') {
      return json(res, 200, analyser.status(db));
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
              const best = await resolveBest({ title: t.title, artist: t.artist, duration: t.duration });
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
        WHERE state IN ('error','cancelled','skipped') AND kind IN ('track-download','ladder-download')`).run(now());
      return json(res, 200, { cleared: r.changes || 0 });
    }

    // retry everything that failed
    if (u.pathname === '/api/downloads/retry-failed' && req.method === 'POST') {
      const failed = db.prepare("SELECT id, payload FROM jobs WHERE state='error' AND kind IN ('track-download','ladder-download') ORDER BY id DESC LIMIT 200").all();
      let queued = 0;
      for (const job of failed) {
        let p = {};
        try { p = JSON.parse(job.payload); } catch {}
        if (!p.trackId) continue;
        const t = db.prepare('SELECT id,title,artist FROM tracks WHERE id=?').get(p.trackId);
        if (!t) continue;
        const owned = db.prepare("SELECT id FROM files WHERE track_id=? AND tier='owned' LIMIT 1").get(t.id);
        if (owned) { db.prepare("UPDATE jobs SET state='skipped', detail='already owned' WHERE id=?").run(job.id); continue; }
        const jobId = crypto.randomUUID();
        db.prepare('INSERT INTO jobs (kind,payload,state,progress,created_at) VALUES (?,?,?,0,?)')
          .run('track-download', JSON.stringify({ jobId, trackId: t.id, title: t.title, artist: t.artist }), 'queued', now());
        resolveBest({ title: t.title, artist: t.artist, duration: null })
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
      resolveBest({ title: t.title, artist: t.artist, duration: null })
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
    if (u.pathname === '/api/downloads') {
      const counts = db.prepare(`SELECT state, COUNT(*) c FROM jobs
        WHERE (kind='track-download' OR kind='ladder-download') AND state != 'dismissed' GROUP BY state`).all();
      const rows = db.prepare(`SELECT id, state, detail, COALESCE(progress,0) progress, payload, created_at
        FROM jobs WHERE (kind='track-download' OR kind='ladder-download') AND state NOT IN ('dismissed','cancelled','skipped')
        ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, id DESC LIMIT 60`).all();
      const items = rows.map((r) => {
        let p = {};
        try { p = JSON.parse(r.payload); } catch {}
        let title = p.title || '';
        if (!title && p.trackId) {
          const t = db.prepare('SELECT title, artist FROM tracks WHERE id=?').get(p.trackId);
          if (t) title = `${t.artist ? t.artist + ' - ' : ''}${t.title}`;
        }
        return { id: r.id, state: r.state, detail: r.detail, progress: Math.round(r.progress || 0), title: title || 'track', track_id: p.trackId || null, at: r.created_at };
      });
      const get = (s) => (counts.find((c) => c.state === s) || { c: 0 }).c;
      const total = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
      const withAudio = db.prepare("SELECT COUNT(DISTINCT track_id) c FROM files WHERE tier='owned'").get().c;
      return json(res, 200, {
        active: get('running'), queued: get('queued'), done: get('done'),
        failed: get('error'), cancelled: get('cancelled'), skipped: get('skipped'),
        library: { total, with_audio: withAudio, missing: total - withAudio },
        items,
      });
    }

    // queue a whole album, or only the tracks that are missing audio
    if (u.pathname === '/api/albums/download' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch {}
        const name = String(b.name || '').trim();
        if (!name) return json(res, 400, { error: 'album name required' });
        const tracks = db.prepare(`SELECT t.id, t.title, t.artist, t.duration FROM tracks t
          WHERE lower(COALESCE(t.album,''))=lower(?)
          AND NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')`).all(name);
        let queued = 0;
        for (const t of tracks) if (enqueueTrackDownload(t)) queued += 1;
        return json(res, 200, { queued, total: tracks.length });
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
        const file = path.join('/tmp/musicfy-sc', key + '.mp3');
        if (!fs.existsSync(file) && !scStreamJobs.has(key)) {
          fs.mkdirSync('/tmp/musicfy-sc', { recursive: true });
          const job = new Promise((resolve, reject) => {
            const tpl = path.join('/tmp/musicfy-sc', key + '.%(ext)s');
            const child = spawn('/opt/musicfy/ytdlp-venv/bin/yt-dlp', [
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
      } catch (e) { return json(res, 502, { error: e.message }); }
    }

    // fill missing cover art from the public iTunes catalogue
    if (u.pathname === '/api/covers/fill' && req.method === 'POST') {
      const limit = Math.min(Number((u.searchParams.get('limit') || 40)), 200);
      const rows = db.prepare(`SELECT id, title, artist FROM tracks WHERE COALESCE(has_art,0)=0 ORDER BY id LIMIT ?`).all(limit);
      let found = 0, tried = 0;
      const worker = async (queue) => {
        while (queue.length) {
          const t = queue.shift();
          tried += 1;
          try {
            const url = await covers.artworkFor(t.artist, t.title);
            if (!url) continue;
            const ok = await saveThumb(url, t.id);
            if (ok) found += 1;
          } catch {}
        }
      };
      const q = rows.slice();
      await Promise.all([worker(q), worker(q), worker(q)]);
      return json(res, 200, { ok: true, tried, found, remaining: db.prepare('SELECT COUNT(*) c FROM tracks WHERE COALESCE(has_art,0)=0').get().c });
    }

    // rung health: what is actually working right now
    if (u.pathname === '/api/health/rungs') {
      return json(res, 200, { checked_at: rungHealth.checkedAt, rungs: rungHealth.rungs });
    }

    if (u.pathname === '/api/soundcloud/token' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const b = JSON.parse(body || '{}');
          if (!b.token) return json(res, 400, { error: 'token required' });
          const f = '/opt/musicfy/data/soundcloud.json';
          fs.writeFileSync(f, JSON.stringify({ token: b.token }, null, 2), { mode: 0o600 });
          return json(res, 200, { ok: true });
        } catch (e) { return json(res, 400, { error: e.message }); }
      });
      return;
    }
    if (u.pathname === '/api/soundcloud/token') {
      return json(res, 200, { configured: soundcloud.hasToken() });
    }

    if (u.pathname === '/api/settings') {
      if (req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const b = JSON.parse(body || '{}');
            for (const [k, v] of Object.entries(b)) setSetting(k, v);
            json(res, 200, { ok: true, settings: { auto_download_plays: setting('auto_download_plays', '2') } });
          } catch (e) { json(res, 400, { error: e.message }); }
        });
        return;
      }
      return json(res, 200, { auto_download_plays: setting('auto_download_plays', '2') });
    }

    if (u.pathname === '/api/stats') {
      const tracks = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
      const owned = db.prepare(`SELECT COALESCE(SUM(size),0) s FROM files WHERE tier='owned'`).get().s;
      const listens = db.prepare('SELECT COUNT(*) c FROM listens').get().c;
      return json(res, 200, { tracks, owned_bytes: owned, listens });
    }

    if (u.pathname === '/api/tracks') {
      const rows = db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality,
        (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) plays,
        (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.track_id=t.id) n_playlists
        FROM tracks t
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id
        ORDER BY t.title`).all();
      return json(res, 200, rows);
    }

    if (u.pathname === '/api/listen' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { recordListen(JSON.parse(body)); json(res, 200, { ok: true }); }
        catch (e) { json(res, 400, { error: e.message }); }
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

    // track cover: embedded art served from cover cache
    const mCover = u.pathname.match(/^\/api\/cover\/(\d+)$/);
    if (mCover) {
      const f = coverFile(Number(mCover[1]));
      if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' }); return res.end(fs.readFileSync(f)); }
      res.writeHead(204); return res.end();
    }

    if (u.pathname === '/api/cover-liked') {
      const row = db.prepare(`SELECT f.track_id, f.path FROM likes l JOIN files f ON f.track_id=l.track_id AND f.tier='owned'
        ORDER BY l.created_at DESC LIMIT 1`).get();
      if (row) {
        const cf = coverFile(row.track_id);
        if (!fs.existsSync(cf)) await extractCover(row.track_id, row.path);
        if (fs.existsSync(cf)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' }); return res.end(fs.readFileSync(cf)); }
      }
      // mirrored playlists have no audio yet: fall back to the playlist art saved at import time
      const plArt = path.join(COVER_DIR, `pl-${pid.replace(/^sp-/, '')}.jpg`);
      if (fs.existsSync(plArt)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' }); return res.end(fs.readFileSync(plArt)); }
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

    // radio: same-artist first, then shared-playlist neighbors, all owned
    const mRadio = u.pathname.match(/^\/api\/radio\/(\d+)$/);
    if (mRadio) {
      const tid = Number(mRadio[1]);
      const seed = db.prepare('SELECT artist, title FROM tracks WHERE id=?').get(tid);
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
          for (const row of rows) { if (!have0.has(row.id)) { out.push(row); have0.add(row.id); } }
        }
      }
      // 2. same artist from your catalog
      if (seed && seed.artist) {
        out.push(...db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality FROM tracks t
          LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
          LEFT JOIN resolutions r ON r.track_id=t.id
          WHERE t.id != ? AND t.artist = ? LIMIT 12`).all(tid, seed.artist));
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
        if (row) { out.push(row); have.add(s.id); }
      }
      if (!out.length) {
        out.push(...db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality FROM tracks t
          LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
          LEFT JOIN resolutions r ON r.track_id=t.id
          WHERE t.id != ? ORDER BY RANDOM() LIMIT 15`).all(tid));
      }
      return json(res, 200, out);
    }

    // playlist management
    if (u.pathname === '/api/playlists' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        const b = JSON.parse(body);
        const id = 'own-' + b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + now();
        db.prepare('INSERT INTO playlists (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, b.name, 'manual', now(), now());
        json(res, 200, { id, name: b.name });
      });
      return;
    }
    const mPlTrack = u.pathname.match(/^\/api\/playlists\/([^/]+)\/tracks$/);
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
        if (fs.existsSync(cf)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' }); return res.end(fs.readFileSync(cf)); }
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
        if (fs.existsSync(cf)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' }); return res.end(fs.readFileSync(cf)); }
      }
      // mirrored playlists have no audio yet: use the playlist art saved at import time
      const plArt = path.join(COVER_DIR, `pl-${pid.replace(/^sp-/, '')}.jpg`);
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
      const rows = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id=p.id) n_tracks
        FROM playlists p ORDER BY p.name`).all();
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
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${name}${ext}"`,
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
      const tmpDir = fs.mkdtempSync(path.join('/tmp', 'mfzip-'));
      const stage = path.join(tmpDir, 'set');
      fs.mkdirSync(stage, { recursive: true });
      const lines = ['#EXTM3U'];
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
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${name}.zip"`,
        'content-length': fs.statSync(zipPath).size,
      });
      const stream = fs.createReadStream(zipPath);
      stream.pipe(res);
      stream.on('close', () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
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
      const lines = ['#EXTM3U'];
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

    // endpoint index, useful for scripting
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
          'POST /api/upload/track', 'POST /api/playlists/:id/cover', 'POST /api/listen',
        ],
        auth: 'none at the app layer; exposure is gated by Pangolin SSO at musicfy.wnlab.com',
      });
    }

    const m = u.pathname.match(/^\/api\/playlists\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const rows = db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, pt.added_at date_added, f.bitrate, r.rung, r.quality
        FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id
        WHERE pt.playlist_id=? ORDER BY pt.position`).all(decodeURIComponent(m[1]));
      return json(res, 200, rows);
    }
    if (m && req.method === 'PATCH') {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        const b = JSON.parse(body);
        db.prepare('UPDATE playlists SET name=?, updated_at=? WHERE id=?').run(String(b.name).slice(0, 120), now(), decodeURIComponent(m[1]));
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
    const mTrk = u.pathname.match(/^\/api\/tracks\/(\d+)$/);
    if (mTrk && req.method === 'DELETE') {
      const tid = Number(mTrk[1]);
      const files = db.prepare('SELECT path FROM files WHERE track_id=?').all(tid);
      db.prepare('DELETE FROM tracks WHERE id=?').run(tid);
      for (const f of files) { try { fs.unlinkSync(f.path); } catch {} }
      json(res, 200, { ok: true });
      return;
    }
    const mGroup = u.pathname.match(/^\/api\/group\/(artist|album)\/(.+)$/);
    if (mGroup) {
      const col = mGroup[1];
      const rows = db.prepare(`SELECT t.*, (f.id IS NOT NULL) AS owned, (t.src_id IS NOT NULL AND t.src_id != '') AS streamable, f.bitrate, r.rung, r.quality
        FROM tracks t
        LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
        LEFT JOIN resolutions r ON r.track_id=t.id
        WHERE lower(${col})=lower(?) ORDER BY t.title`).all(decodeURIComponent(mGroup[2]));
      return json(res, 200, rows);
    }

    const m2 = u.pathname.match(/^\/api\/stream\/(\d+)$/);
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
          } catch (e) { return json(res, 502, { error: e.message }); }
        }
        return json(res, 404, { error: 'no file' });
      }
      const st = fs.statSync(f.path);
      const range = req.headers.range;
      // files never change: let the device keep them, which is what makes a second play instant
      const ext = path.extname(f.path).toLowerCase();
      const mime = ext === '.m4a' ? 'audio/mp4'
        : (ext === '.ogg' || ext === '.opus') ? 'audio/ogg'
        : ext === '.flac' ? 'audio/flac'
        : ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
      const head = { 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400' };
      if (range) {
        const r = range.match(/bytes=(\d*)-(\d*)/);
        let start = r && r[1] ? Number(r[1]) : 0;
        let end = r && r[2] ? Number(r[2]) : st.size - 1;
        end = Math.min(end, st.size - 1);
        res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
        fs.createReadStream(f.path, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...head, 'content-length': st.size });
        fs.createReadStream(f.path).pipe(res);
      }
      return;
    }

    const m3 = u.pathname.match(/^\/api\/ingest-wnl\/([^/]+)$/);
    if (m3) {
      const folder = decodeURIComponent(m3[1]);
      const libs = JSON.parse(await httpGet(`${WNL}/api/library`));
      const entry = libs.find(l => l.folder === folder);
      const r = await ingestWnlFolder(folder, entry ? entry.name : folder);
      return json(res, 200, { folder, ...r });
    }

    if (u.pathname === '/api/ingest-wnl-all') {
      const libs = JSON.parse(await httpGet(`${WNL}/api/library`));
      const results = [];
      for (const l of libs) results.push({ name: l.name, ...await ingestWnlFolder(l.folder, l.name) });
      return json(res, 200, results);
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    log('error', `${u.pathname}: ${e.message}`);
    return json(res, 500, { error: e.message });
  }
});

process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e && e.message, (e && e.stack || '').split('\n')[1] || '');
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && e.message ? e.message : String(e));
});

server.listen(PORT, '0.0.0.0', () => log('boot', `core listening on ${PORT}`));
console.log(`MUSICFY core on :${PORT}`);
warmCovers().catch(e => log('error', `cover warm: ${e.message}`));
