'use strict';
// Write DJ metadata into the audio file itself: Traktor's PRIV "TRAKTOR4" frame
// (BPM, key, rating, cues, loops, grid) plus standard ID3 TBPM/TKEY.
// Format from hellricer.github.io/2021/05/05/decoding-traktor4-field.html and
// willwillems/traktor-metadata (MIT). MP3 (ID3v2) only; never touches audio bytes.
const fs = require('node:fs');

// ---------- Traktor binary tree ----------
function stringData(s) {
  const b = Buffer.alloc(4 + s.length * 2);
  b.writeUInt32LE(s.length, 0);
  for (let i = 0; i < s.length; i++) { b[4 + i * 2] = s.charCodeAt(i) & 0xff; b[5 + i * 2] = 0; }
  return b;
}
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(Number(v) || 0, 0); return b; };
const f64 = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(Number(v) || 0, 0); return b; };
const dateData = (d) => { const b = Buffer.alloc(4); b.writeUInt8(d.getDate(), 0); b.writeUInt8(d.getMonth(), 1); b.writeUInt16LE(d.getFullYear(), 2); return b; };
function cueData(cues) {
  const parts = [u32(cues.length)];
  for (const c of cues) {
    parts.push(u32(0)); // unknown, 1 in observations
    parts.push(u32(c.name.length));
    const nb = Buffer.alloc(c.name.length * 2);
    for (let i = 0; i < c.name.length; i++) { nb[i * 2] = c.name.charCodeAt(i) & 0xff; nb[i * 2 + 1] = 0; }
    parts.push(nb);
    parts.push(u32(c.index));
    parts.push(u32(c.type));
    parts.push(f64(c.start));
    parts.push(f64(c.length));
    const rep = Buffer.alloc(4); rep.writeInt32LE(c.repeats, 0); parts.push(rep);
    parts.push(u32(c.hotcue));
  }
  return Buffer.concat(parts);
}
function element(id, data, children) {
  const kids = children && children.length ? children : [];
  const body = kids.length ? Buffer.concat(kids) : (data || Buffer.alloc(0));
  const h = Buffer.alloc(12);
  for (let i = 0; i < 4; i++) h[i] = id.charCodeAt(3 - i) & 0xff;
  h.writeUInt32LE(body.length, 4);
  h.writeUInt32LE(kids.length, 8);
  return Buffer.concat([h, body]);
}

function buildTraktorBinary(meta) {
  const data = [];
  const S = (id, v) => { if (v !== undefined && v !== null && v !== '') data.push(element(id, stringData(String(v)))); };
  const F = (id, v) => { if (v !== undefined && v !== null) data.push(element(id, f32(v))); };
  const I = (id, v) => { if (v !== undefined && v !== null) data.push(element(id, u32(v))); };
  S('TIT2', meta.title); S('TPE1', meta.artist); S('TALB', meta.album); S('TCON', meta.genre);
  S('LABL', meta.label); S('COMM', meta.comment); S('TKEY', meta.key);
  if (meta.bpm !== undefined) { F('BPMT', meta.bpm); F('HBPM', meta.bpm); }
  I('TRCK', meta.trackNumber); I('PCNT', meta.playCount); I('RANK', meta.rating);
  I('TLEN', meta.lengthMs); I('BITR', meta.bitrate);
  if (meta.cuePoints && meta.cuePoints.length) data.push(element('CUEP', cueData(meta.cuePoints)));

  const hdr = element(' HDR', null, [
    element('CHKS', u32(0)),                 // placeholder, patched after build
    element('FMOD', dateData(meta.fileModified || new Date())),
    element('VRSN', u32(meta.formatVersion || 7)),
  ]);
  const root = element('TRMD', null, [hdr, element('DATA', null, data)]);

  // CHKS data sits at offset 36 (root header 12 + HDR header 12 + CHKS header 12)
  const sum = 608 + root.subarray(40).reduce((a, b) => a + b, 0);
  root.writeUInt32LE(sum >>> 0, 36);
  return root;
}

// ---------- ID3v2 ----------
const syncsafe = (n) => (((n >> 21) & 0x7f) << 24) | (((n >> 14) & 0x7f) << 16) | (((n >> 7) & 0x7f) << 8) | (n & 0x7f);
const unsyncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function readId3(buf) {
  if (buf.length < 10 || buf.toString('ascii', 0, 3) !== 'ID3') return { frames: [], audioOffset: 0, version: 4 };
  const ver = buf[3];
  const size = unsyncsafe(buf, 6);
  const end = Math.min(10 + size, buf.length);
  const frames = [];
  let o = 10;
  while (o + 10 <= end) {
    const id = buf.toString('ascii', o, o + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fsz = ver === 4 ? unsyncsafe(buf, o + 4) : buf.readUInt32BE(o + 4);
    if (!fsz || o + 10 + fsz > end) break;
    frames.push({ id, data: buf.subarray(o + 10, o + 10 + fsz) });
    o += 10 + fsz;
  }
  return { frames, audioOffset: 10 + size, version: ver };
}

function buildId3v24(frames) {
  const parts = [];
  for (const f of frames) {
    const h = Buffer.alloc(10);
    h.write(f.id, 0, 'ascii');
    h.writeUInt32BE(syncsafe(f.data.length), 4);
    h.writeUInt16BE(0, 8);
    parts.push(h, f.data);
  }
  const body = Buffer.concat(parts);
  const pad = 1024;
  const h = Buffer.alloc(10);
  h.write('ID3', 0, 'ascii'); h[3] = 4; h[4] = 0; h[5] = 0;
  h.writeUInt32BE(syncsafe(body.length + pad), 6);
  return Buffer.concat([h, body, Buffer.alloc(pad)]);
}

const textFrame = (id, t) => ({ id, data: Buffer.concat([Buffer.from([0]), Buffer.from(String(t), 'latin1'), Buffer.from([0])]) });
const isTraktorPriv = (f) => f.id === 'PRIV' && f.data.length >= 8 && f.data.toString('latin1', 0, 8) === 'TRAKTOR4';

function writeTags(filePath, meta, opts = {}) {
  const buf = fs.readFileSync(filePath);
  const id3 = readId3(buf);
  const audio = buf.subarray(id3.audioOffset);
  // preserve existing frames, replacing the ones we own
  let frames = id3.frames.filter((f) => !isTraktorPriv(f) && f.id !== 'TBPM' && f.id !== 'TKEY');
  if (meta.bpm) frames.push(textFrame('TBPM', String(Math.round(meta.bpm))));
  if (meta.key) frames.push(textFrame('TKEY', String(meta.key)));
  const trak = buildTraktorBinary(meta);
  frames.push({ id: 'PRIV', data: Buffer.concat([Buffer.from('TRAKTOR4\0', 'latin1'), trak]) });
  const tag = buildId3v24(frames);
  const out = Buffer.concat([tag, audio]);
  const report = { file: filePath, bytesIn: buf.length, bytesOut: out.length, frames: frames.map((f) => f.id), traktorBytes: trak.length, audioOffsetIn: id3.audioOffset };
  if (opts.dryRun) return report;
  const bak = filePath + '.mf.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(filePath, bak); // one-time safety copy
  const tmp = filePath + '.mf.tmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, filePath);
  return { ...report, written: true, backup: bak };
}

// read back the Traktor tree from a written file, to verify checksum + fields
function verifyTraktor(filePath) {
  const buf = fs.readFileSync(filePath);
  const id3 = readId3(buf);
  const priv = id3.frames.find(isTraktorPriv);
  if (!priv) return { ok: false, error: 'no TRAKTOR4 frame' };
  const tree = priv.data.subarray(9);
  const sum = 608 + tree.subarray(40).reduce((a, b) => a + b, 0);
  const stored = tree.readUInt32LE(36);
  const fields = [];
  let o = 0;
  const readEl = (off) => {
    const id = String.fromCharCode(tree[off + 3], tree[off + 2], tree[off + 1], tree[off]);
    const len = tree.readUInt32LE(off + 4);
    const kids = tree.readUInt32LE(off + 8);
    return { id, len, kids, off };
  };
  const root = readEl(0);
  fields.push(root.id);
  return { ok: sum >>> 0 === stored >>> 0, checksum: sum >>> 0, stored, bytes: tree.length, root: root.id };
}

module.exports = { buildTraktorBinary, writeTags, verifyTraktor, readId3 };
