'use strict';
/* Loudness normalisation on the file itself.
 *
 * The player can only lower audio.volume, and iOS ignores that property entirely, so a
 * "normalize" switch that works on a laptop does nothing in a car on an iPhone. The only
 * version of this that works everywhere is the file: measure with ffmpeg's EBU R128
 * meter, then rewrite it to the target with a two-pass loudnorm. Files already within a
 * decibel are left alone, because re-encoding a lossy file for nothing is a loss.
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const state = { running: false, total: 0, done: 0, failed: 0, skipped: 0, startedAt: null, last: null, target: -12 };

function ffmpeg(args, timeout = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).split('\n').slice(-2).join(' ').slice(0, 200)));
      else resolve({ stdout, stderr });
    });
  });
}

function codecFor(file) {
  const e = path.extname(file).toLowerCase();
  if (e === '.mp3') return ['-c:a', 'libmp3lame', '-b:a', '320k'];
  if (e === '.m4a' || e === '.aac') return ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'];
  if (e === '.flac') return ['-c:a', 'flac'];
  if (e === '.wav') return ['-c:a', 'pcm_s24le'];
  if (e === '.aiff' || e === '.aif') return ['-c:a', 'pcm_s24be'];
  if (e === '.ogg' || e === '.opus') return ['-c:a', 'libopus', '-b:a', '192k'];
  return null;
}

/* EBU R128 measurement of the file as it is now */
async function measure(file) {
  const { stderr } = await ffmpeg(['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=I=-12:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
  const m = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      input_i: Number(j.input_i), input_tp: Number(j.input_tp), input_lra: Number(j.input_lra),
      input_thresh: Number(j.input_thresh), target_offset: Number(j.target_offset),
    };
  } catch { return null; }
}

/* rewrite one file to the target, in the same codec, in place */
async function normalizeFile(file, target = -12, { tolerance = 1.0 } = {}) {
  const codec = codecFor(file);
  if (!codec) return { skipped: true, why: 'unsupported format' };
  const before = await measure(file);
  if (!before || !Number.isFinite(before.input_i)) return { skipped: true, why: 'could not measure' };
  if (Math.abs(before.input_i - target) <= tolerance) return { skipped: true, why: 'already on target', before: before.input_i };
  const ext = path.extname(file);
  const tmp = path.join(path.dirname(file), `.mf-norm-${Date.now()}${ext}`);
  const filter = [
    `loudnorm=I=${target}:TP=-1.5:LRA=11`,
    `measured_I=${before.input_i}`, `measured_TP=${before.input_tp}`,
    `measured_LRA=${before.input_lra}`, `measured_thresh=${before.input_thresh}`,
    `offset=${before.target_offset}`, 'linear=true', 'print_format=summary',
  ].join(':');
  try {
    await ffmpeg(['-hide_banner', '-nostats', '-y', '-i', file, '-af', filter, ...codec, tmp]);
    const size = fs.statSync(tmp).size;
    if (!size) throw new Error('empty output');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  return { ok: true, before: before.input_i, after: target };
}

/* run over a set of owned files, one at a time, reporting progress */
async function run(db, { ids = null, playlistId = null, target = -12, limit = 500 } = {}) {
  if (state.running) return { error: 'already running' };
  let rows;
  if (Array.isArray(ids) && ids.length) {
    const ph = ids.map(() => '?').join(',');
    rows = db.prepare(`SELECT t.id, t.title, f.path FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned' WHERE t.id IN (${ph}) LIMIT ?`).all(...ids, limit);
  } else if (playlistId) {
    rows = db.prepare(`SELECT t.id, t.title, f.path FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
      JOIN files f ON f.track_id=t.id AND f.tier='owned' WHERE pt.playlist_id=? LIMIT ?`).all(playlistId, limit);
  } else {
    rows = db.prepare(`SELECT t.id, t.title, f.path FROM tracks t JOIN files f ON f.track_id=t.id AND f.tier='owned' LIMIT ?`).all(limit);
  }
  rows = rows.filter((r) => r.path && fs.existsSync(r.path));
  Object.assign(state, { running: true, total: rows.length, done: 0, failed: 0, skipped: 0, startedAt: Date.now(), last: null, target });
  const upd = db.prepare('UPDATE tracks SET loudness=?, updated_at=? WHERE id=?');
  (async () => {
    for (const r of rows) {
      try {
        const out = await normalizeFile(r.path, target);
        if (out.ok) {
          state.done += 1;
          state.last = { title: r.title, from: out.before };
          // re-measure from the file so the player stops applying a stale gain
          const m = await measure(r.path).catch(() => null);
          upd.run(m && Number.isFinite(m.input_i) ? m.input_i : target, Math.floor(Date.now() / 1000), r.id);
        } else {
          state.skipped += 1;
          if (out.before != null) upd.run(out.before, Math.floor(Date.now() / 1000), r.id);
        }
      } catch (e) {
        state.failed += 1;
        state.last = { title: r.title, error: String(e.message).slice(0, 120) };
      }
    }
    state.running = false;
  })().catch(() => { state.running = false; });
  return { started: rows.length };
}

module.exports = { run, normalizeFile, measure, state };
