'use strict';
const paths = require('./paths');
const nodePath = require('node:path');
// Queue and run the Python analyser, one process per batch, a couple in parallel.
// Results land in the tracks table so the UI can show BPM and key.
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const PY = paths.ESSENTIA_PY;
const SCRIPT = nodePath.join(__dirname, 'analyze.py');

/* What a "current" analysis contains. Bump this whenever the analyser starts writing
   something new that exports depend on: 1 = bpm/key/beat grid, 2 = sections + energy10.
   Rows analysed by an older version keep their numbers but are marked outdated, so the
   interface can say which tracks have the cue data and which do not. */
const ANALYSIS_VERSION = 2;

function ensureColumns(db) {
  for (const col of ['bpm REAL', 'key TEXT', 'key_scale TEXT', 'key_confidence REAL', 'loudness REAL', 'energy REAL', 'analyzed_at INTEGER', 'analysis_version INTEGER DEFAULT 0', 'beat_grid TEXT', 'sections TEXT', 'energy10 REAL']) {
    try { db.exec(`ALTER TABLE tracks ADD COLUMN ${col}`); } catch {}
  }
}

const running = { active: 0, done: 0, failed: 0, startedAt: null, lastError: null };

function analyseBatch(items) {
  return new Promise((resolve) => {
    const child = spawn(PY, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err = (err + c).slice(-600); });
    child.on('error', (e) => {
      running.lastError = e.code === 'ENOENT'
        ? `analyser interpreter not found: ${PY} — create the venv or set MUSICFY_PYTHON`
        : `analyser could not start: ${e.message}`;
      resolve([]);
    });
    child.on('close', (code) => {
      if (!out.trim() && code) running.lastError = `analyser exited ${code}${err.trim() ? `: ${err.trim().split('\n').slice(-1)[0]}` : ''}`;
      const rows = out.split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      resolve(rows);
    });
    child.stdin.end(JSON.stringify(items));
  });
}

async function run(db, { limit = 50, workers = 2, batch = 4, scope = 'never' } = {}) {
  ensureColumns(db);
  // a missing interpreter is a configuration error, not a slow analysis: say so once
  // instead of returning zeroes that make the retry loop run forever
  if (!fs.existsSync(PY)) {
    return { analysed: 0, failed: 0, remaining: null, error: `analyser interpreter not found: ${PY} — create the venv or set MUSICFY_PYTHON` };
  }
  // "never" fills what has no analysis; "outdated" redoes rows from an older analyser
  const where = scope === 'outdated'
    ? `t.analyzed_at IS NOT NULL AND COALESCE(t.analysis_version,0) < ${ANALYSIS_VERSION}`
    : 't.analyzed_at IS NULL';
  const files = db.prepare(`SELECT t.id, f.path FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
    WHERE ${where} ORDER BY t.id LIMIT ?`).all(limit);
  if (!files.length) return { analysed: 0, remaining: 0 };

  running.startedAt = running.startedAt || Date.now();
  running.lastError = null;
  const startDone = running.done;
  const startFailed = running.failed;
  const queue = files.filter((f) => fs.existsSync(f.path));
  const queuedCount = queue.length;
  const upd = db.prepare(`UPDATE tracks SET bpm=?, key=?, key_scale=?, key_confidence=?, loudness=?, energy=?, beat_grid=?, sections=?, energy10=?, analyzed_at=?, analysis_version=?
    WHERE id=?`);

  const worker = async () => {
    for (;;) {
      const slice = queue.splice(0, batch);
      if (!slice.length) return;
      running.active += 1;
      const rows = await analyseBatch(slice.map((f) => ({ id: f.id, path: f.path })));
      for (const r of rows) {
        if (!r || !r.id) continue;
        if (r.error) { running.failed += 1; continue; }
        upd.run(r.bpm || null, r.key || null, r.key_scale || null, r.key_confidence || null,
          r.loudness || null, r.energy || null, JSON.stringify(r.beat_grid || []),
          r.sections && r.sections.length ? JSON.stringify(r.sections) : null,
          r.energy10 != null ? r.energy10 : null,
          Math.floor(Date.now() / 1000), ANALYSIS_VERSION, r.id);
        running.done += 1;
      }
      running.active -= 1;
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, 3)) }, worker));
  const remaining = db.prepare("SELECT COUNT(*) c FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned' WHERE t.analyzed_at IS NULL").get().c;
  const progressed = running.done - startDone;
  const failed = running.failed - startFailed;
  // nothing moved and something was wrong: report the reason, do not present it as work
  if (!progressed && queuedCount && running.lastError) {
    return { analysed: 0, failed: queuedCount, remaining, error: running.lastError };
  }
  return { analysed: progressed, failed, remaining };
}

function status(db) {
  ensureColumns(db);
  const V = ANALYSIS_VERSION;
  const base = "FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'";
  const one = (cond) => db.prepare(`SELECT COUNT(*) c ${base} ${cond ? `WHERE ${cond}` : ''}`).get().c;
  const total = one('');
  const current = one(`t.analyzed_at IS NOT NULL AND COALESCE(t.analysis_version,0) >= ${V}`);
  const outdated = one(`t.analyzed_at IS NOT NULL AND COALESCE(t.analysis_version,0) < ${V}`);
  const never = one('t.analyzed_at IS NULL');
  const prepped = one(`t.analyzed_at IS NOT NULL AND COALESCE(t.analysis_version,0) >= ${V} AND t.beat_grid IS NOT NULL AND t.beat_grid != ''`);
  const sections = one("t.sections IS NOT NULL AND t.sections != ''");
  return {
    version: V, total,
    analysed: current + outdated,   // any analysis at all
    current, outdated, never,
    prepped, sections,
    remaining: never,               // what the never-analysed pass still has to do
    active: running.active,
  };
}

// analyse one track on demand: only set tracks need BPM/key, not the whole library
async function runOne(db, trackId) {
  ensureColumns(db);
  const f = db.prepare(`SELECT t.id, f.path FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
    WHERE t.id=? LIMIT 1`).get(trackId);
  if (!f) return { error: 'no owned audio for this track' };
  if (!fs.existsSync(f.path)) return { error: 'audio file is missing' };
  const rows = await analyseBatch([{ id: f.id, path: f.path }]);
  const r = rows.find((x) => x && x.id === f.id) || rows[0];
  if (!r) return { error: running.lastError || 'analysis failed' };
  if (r.error) return { error: String(r.error).slice(0, 160) };
  db.prepare(`UPDATE tracks SET bpm=?, key=?, key_scale=?, key_confidence=?, loudness=?, energy=?, beat_grid=?, sections=?, energy10=?, analyzed_at=?, analysis_version=?
    WHERE id=?`).run(r.bpm || null, r.key || null, r.key_scale || null, r.key_confidence || null,
    r.loudness || null, r.energy || null, JSON.stringify(r.beat_grid || []),
    r.sections && r.sections.length ? JSON.stringify(r.sections) : null,
    r.energy10 != null ? r.energy10 : null,
    Math.floor(Date.now() / 1000), ANALYSIS_VERSION, f.id);
  return { id: f.id, bpm: r.bpm, key: r.key, key_scale: r.key_scale, cues: (r.beat_grid || []).length };
}

module.exports = { run, status, ensureColumns, runOne, ANALYSIS_VERSION };
