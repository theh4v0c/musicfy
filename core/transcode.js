'use strict';
// Some containers never open in rekordbox or Traktor (webm, ogg, opus, wma) and an .m4a
// can still be ALAC, which rekordbox refuses. Everything else in the library is already
// something both apps read, so this only ever touches what cannot be played.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

// what Pioneer (rekordbox + CDJ from the 850/2000 on) and Traktor both open natively
const PLAYABLE = new Set(['.mp3', '.m4a', '.wav', '.aiff', '.aif', '.flac']);

function probe(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,bit_rate:format=bit_rate', '-of', 'json', file,
    ], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const j = JSON.parse(stdout || '{}');
        const st = (j.streams || [])[0] || {};
        resolve({
          codec: String(st.codec_name || '').toLowerCase(),
          bitrate: Number(st.bit_rate || (j.format && j.format.bit_rate) || 0) || 0,
        });
      } catch { resolve(null); }
    });
  });
}

const extOf = (p) => path.extname(String(p || '')).toLowerCase();

// a cheap answer for the list. ALAC is caught during the run, where a probe is already
// being paid for; scanning every .m4a on a page load would take longer than the page.
function needsConvert(file) {
  return !PLAYABLE.has(extOf(file));
}

async function isAlac(file) {
  if (extOf(file) !== '.m4a') return false;
  const p = await probe(file);
  return !!p && p.codec === 'alac';
}

function freeName(dir, base, ext) {
  let name = `${base}${ext}`;
  let n = 1;
  while (fs.existsSync(path.join(dir, name))) {
    name = `${base} (compat${n > 1 ? ` ${n}` : ''})${ext}`;
    n += 1;
  }
  return path.join(dir, name);
}

/**
 * Convert one file into something both DJ apps play.
 * AAC from an mp4/m4a container is copied, never re-encoded; lossy sources are only
 * ever re-encoded once, at 256k AAC or 320k MP3.
 */
async function toPlayable(file, opts = {}) {
  if (!file || !fs.existsSync(file)) return null;
  const format = opts.format === 'mp3' ? 'mp3' : 'm4a';
  const ext = extOf(file);
  if (PLAYABLE.has(ext) && !(await isAlac(file))) return null;

  const info = await probe(file);
  if (!info || !info.codec) return null;

  const base = path.basename(file, path.extname(file));
  const outPath = freeName(path.dirname(file), base, format === 'mp3' ? '.mp3' : '.m4a');
  const copy = format === 'm4a' && (info.codec === 'aac' || info.codec === 'mp3');

  // never inflate: a 143k source re-encoded at 256k is a bigger file with no more music
  const srcK = Math.round((info.bitrate || 0) / 1000);
  const lossless = srcK >= 900 || !srcK;
  const aacK = lossless || srcK >= 200 ? 256 : Math.max(128, Math.min(192, srcK));
  const mp3K = lossless || srcK >= 200 ? 320 : Math.max(160, Math.min(256, srcK));

  const args = ['-v', 'error', '-y', '-i', file, '-vn', '-map', '0:a:0'];
  if (copy) args.push('-c:a', 'copy');
  else if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', `${mp3K}k`);
  else args.push('-c:a', 'aac', '-b:a', `${aacK}k`);
  if (format === 'm4a') args.push('-movflags', '+faststart');
  args.push(outPath);

  await new Promise((resolve, reject) => {
    execFile(paths.FFMPEG, args, { timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
      (err) => (err ? reject(err) : resolve()));
  }).catch(() => null);

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10000) {
    try { fs.rmSync(outPath, { force: true }); } catch {}
    return null;
  }
  const after = await probe(outPath);
  return {
    path: outPath,
    bitrate: (after && after.bitrate) || info.bitrate || 0,
    size: fs.statSync(outPath).size,
    from: info.codec,
    ext: path.extname(outPath).toLowerCase(),
  };
}

/* An m4a with the moov atom at the end has to be fetched from the tail before the player
   knows what it is: two extra round trips and a partial download before a single note.
   Rebuilding the container with -movflags +faststart puts the index first and costs one
   copy of the file, no re-encode. */
function hasFaststart(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    let off = 0;
    for (let i = 0; i < 12 && off + 8 <= n; i += 1) {
      const size = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (size < 8) return false;
      off += size;
    }
    return false;
  } catch { return true; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

async function toFaststart(file) {
  if (!file || !fs.existsSync(file) || hasFaststart(file)) return false;
  const dir = path.dirname(file);
  const base = path.basename(file);
  const tmp = path.join(dir, `.fs-${process.pid}-${base}`);
  const run = (args) => new Promise((resolve) => {
    execFile(paths.FFMPEG, args, { timeout: 20 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }, (err) => resolve(!err));
  });
  // keep artwork and tags when the muxer accepts them, fall back to plain audio if not
  let ok = await run(['-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy', '-map_metadata', '0', '-movflags', '+faststart', tmp]);
  if (!ok || !fs.existsSync(tmp) || fs.statSync(tmp).size < 10000) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    ok = await run(['-v', 'error', '-y', '-i', file, '-map', '0:a', '-c', 'copy', '-map_metadata', '0', '-movflags', '+faststart', tmp]);
  }
  if (!ok || !fs.existsSync(tmp) || fs.statSync(tmp).size < 10000 || !hasFaststart(tmp)) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    return false;
  }
  try {
    fs.renameSync(tmp, file);           // same directory: atomic swap, no half file ever visible
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    return false;
  }
}

module.exports = { PLAYABLE, needsConvert, isAlac, probe, toPlayable, hasFaststart, toFaststart };
