'use strict';
// Queue and run the Python analyser, one process per batch, a couple in parallel.
// Results land in the tracks table so the UI can show BPM and key.
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const PY = '/opt/musicfy/essentia-venv/bin/python';
const SCRIPT = '/opt/musicfy/core/analyze.py';

function ensureColumns(db) {
  for (const col of ['bpm REAL', 'key TEXT', 'key_scale TEXT', 'key_confidence REAL', 'loudness REAL', 'energy REAL', 'analyzed_at INTEGER', 'beat_grid TEXT']) {
    try { db.exec(`ALTER TABLE tracks ADD COLUMN ${col}`); } catch {}
  }
}

const running = { active: 0, done: 0, failed: 0, startedAt: null };

function analyseBatch(items) {
  return new Promise((resolve) => {
    const child = spawn(PY, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', () => {});
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const rows = out.split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      resolve(rows);
    });
    child.stdin.end(JSON.stringify(items));
  });
}

async function run(db, { limit = 50, workers = 2, batch = 4 } = {}) {
  ensureColumns(db);
  const files = db.prepare(`SELECT t.id, f.path FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'
    WHERE t.analyzed_at IS NULL ORDER BY t.id LIMIT ?`).all(limit);
  if (!files.length) return { analysed: 0, remaining: 0 };

  running.startedAt = running.startedAt || Date.now();
  const queue = files.filter((f) => fs.existsSync(f.path));
  const upd = db.prepare(`UPDATE tracks SET bpm=?, key=?, key_scale=?, key_confidence=?, loudness=?, energy=?, beat_grid=?, analyzed_at=?
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
          r.loudness || null, r.energy || null, JSON.stringify(r.beat_grid || []), Math.floor(Date.now() / 1000), r.id);
        running.done += 1;
      }
      running.active -= 1;
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, 3)) }, worker));
  const remaining = db.prepare("SELECT COUNT(*) c FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned' WHERE t.analyzed_at IS NULL").get().c;
  return { analysed: running.done, failed: running.failed, remaining };
}

function status(db) {
  ensureColumns(db);
  const total = db.prepare("SELECT COUNT(*) c FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned'").get().c;
  const done = db.prepare("SELECT COUNT(*) c FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned' WHERE t.analyzed_at IS NOT NULL").get().c;
  const prepped = db.prepare("SELECT COUNT(*) c FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned' WHERE t.analyzed_at IS NOT NULL AND t.beat_grid IS NOT NULL AND t.beat_grid != ''").get().c;
  return { total, analysed: done, prepped, remaining: total - done, active: running.active };
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
  if (!r) return { error: 'analysis failed' };
  if (r.error) return { error: String(r.error).slice(0, 160) };
  db.prepare(`UPDATE tracks SET bpm=?, key=?, key_scale=?, key_confidence=?, loudness=?, energy=?, beat_grid=?, analyzed_at=?
    WHERE id=?`).run(r.bpm || null, r.key || null, r.key_scale || null, r.key_confidence || null,
    r.loudness || null, r.energy || null, JSON.stringify(r.beat_grid || []), Math.floor(Date.now() / 1000), f.id);
  return { id: f.id, bpm: r.bpm, key: r.key, key_scale: r.key_scale, cues: (r.beat_grid || []).length };
}

module.exports = { run, status, ensureColumns, runOne };
