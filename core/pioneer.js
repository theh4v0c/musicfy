'use strict';
/* Pioneer device export: the files a CDJ/XDJ actually reads from a USB drive.
 *
 *   /PIONEER/rekordbox/export.pdb        row-based "DeviceSQL" database
 *   /Contents/<set>/<file>               the audio
 *
 * The format is reverse engineered by Henry Betts, Fabian Lesniak and the
 * Deep Symmetry project (djl-analysis.deepsymmetry.org), and the row layouts below
 * follow the Kaitai definition crate-digger ships (rekordbox_pdb.ksy). It is a set of
 * 4096-byte pages; page 0 is the header with one table pointer per table, every table
 * is a linked list of pages, rows live in a heap that grows forward from the page
 * header while the row index grows backward from the end of the page.
 *
 * Strings are DeviceSQL: a one-byte kind/length for short ASCII, or a header plus a
 * two-byte length for long ASCII.
 */

const PAGE = 4096;
const HEAD = 0x28;               // file/page header is 40 bytes
const T = { TRACK: 0x00, GENRE: 0x01, ARTIST: 0x02, ALBUM: 0x03, LABEL: 0x04, KEY: 0x05, COLOR: 0x06, PLAYLIST: 0x07, ENTRY: 0x08, ARTWORK: 0x0d };

/* ---------------- DeviceSQL strings ---------------- */

function dsql(str) {
  const s = String(str ?? '');
  const ascii = /^[\x20-\x7e]*$/.test(s);
  const data = Buffer.from(ascii ? s : s, ascii ? 'ascii' : 'utf16le');
  if (ascii && data.length + 1 <= 126) {
    return Buffer.concat([Buffer.from([((data.length + 1) << 1) | 1]), data]);
  }
  if (ascii) {
    const head = Buffer.alloc(4);
    head[0] = 0x40;                       // long ASCII
    head.writeUInt16LE(4 + data.length, 1);
    head[3] = 0;
    return Buffer.concat([head, data]);
  }
  const head = Buffer.alloc(4);
  head[0] = 0x90;                         // long UTF-16LE
  head.writeUInt16LE(4 + data.length, 1);
  head[3] = 0;
  return Buffer.concat([head, data]);
}

/* A row is a fixed struct followed by its strings; the struct carries offsets to each
   string measured from the start of the row. */
function rowWithStrings(fixed, parts) {
  const head = Buffer.from(fixed);
  let at = head.length;
  const blobs = [];
  for (const p of parts) {
    const b = p === null ? null : dsql(p);
    if (!b) continue;
    const off = at;
    blobs.push({ off, b });
    at += b.length;
  }
  return { head, blobs, size: at, offsets: blobs.map((x) => x.off) };
}

function assemble(headBuffers, blobs) {
  const headLen = headBuffers.reduce((n, h) => n + h.length, 0);
  const out = Buffer.alloc(headLen + blobs.reduce((n, x) => n + x.b.length, 0));
  let at = 0;
  for (const h of headBuffers) { h.copy(out, at); at += h.length; }
  for (const x of blobs) { x.b.copy(out, at); at += x.b.length; }
  return out;
}

/* ---------------- tables ---------------- */

function trackRow(t) {
  const fixed = Buffer.alloc(94);
  fixed.writeUInt16LE(0x24, 0);          // subtype: 16-bit string offsets
  fixed.writeUInt16LE(0, 2);             // index shift
  fixed.writeUInt32LE(0, 4);             // bitmask
  fixed.writeUInt32LE(t.sampleRate || 44100, 8);
  fixed.writeUInt32LE(0, 12);            // composer id
  fixed.writeUInt32LE(t.size || 0, 16);
  fixed.writeUInt32LE(0, 20);
  fixed.writeUInt16LE(19048, 24);
  fixed.writeUInt16LE(30967, 26);
  fixed.writeUInt32LE(0, 28);            // artwork id
  fixed.writeUInt32LE(t.keyId || 0, 32);
  fixed.writeUInt32LE(0, 36);            // original artist
  fixed.writeUInt32LE(0, 40);            // label
  fixed.writeUInt32LE(0, 44);            // remixer
  fixed.writeUInt32LE(t.bitrate || 320000, 48);
  fixed.writeUInt32LE(t.trackNo || 0, 52);
  fixed.writeUInt32LE(Math.round((Number(t.bpm) || 0) * 100), 56);
  fixed.writeUInt32LE(t.genreId || 0, 60);
  fixed.writeUInt32LE(t.albumId || 0, 64);
  fixed.writeUInt32LE(t.artistId || 0, 68);
  fixed.writeUInt32LE(t.id, 72);
  fixed.writeUInt16LE(0, 76);            // disc
  fixed.writeUInt16LE(0, 78);            // play count
  fixed.writeUInt16LE(Number(t.year) || 0, 80);
  fixed.writeUInt16LE(16, 82);           // sample depth
  fixed.writeUInt16LE(Math.round(Number(t.duration) || 0), 84);
  fixed.writeUInt16LE(41, 86);
  fixed[88] = 0;                         // colour
  fixed[89] = 0;                         // rating
  fixed.writeUInt16LE(1, 90);
  fixed.writeUInt16LE(2, 92);
  // the 21 string offsets are part of the fixed struct: the row head is 94 + 42 bytes
  // and every string starts after it, measured from the start of the row
  const parts = new Array(21).fill('');
  parts[10] = t.dateAdded || '';     // date added
  parts[14] = t.analyzePath || '';   // path to the ANLZ analysis file
  parts[17] = t.title || '';
  parts[19] = t.fileName || '';
  parts[20] = t.filePath || '';
  const head = Buffer.alloc(94 + 42);
  fixed.copy(head, 0);
  const row = rowWithStrings(head, parts);
  // rowWithStrings appended nothing to head; it just measured from head.length
  for (let i = 0; i < 21; i += 1) head.writeUInt16LE(row.offsets[i] ?? 0, 94 + i * 2);
  return assemble([head], row.blobs);
}

function artistRow(a) {
  const near = Buffer.alloc(10);
  near.writeUInt16LE(0x60, 0);
  near.writeUInt16LE(0, 2);
  near.writeUInt32LE(a.id, 4);
  near[8] = 3;
  const row = rowWithStrings(near, [a.name]);
  row.head[9] = row.offsets[0];
  return assemble([row.head], row.blobs);
}

function albumRow(al) {
  const near = Buffer.alloc(22);
  near.writeUInt16LE(0x80, 0);
  near.writeUInt16LE(0, 2);
  near.writeUInt32LE(0, 4);
  near.writeUInt32LE(al.artistId || 0, 8);
  near.writeUInt32LE(al.id, 12);
  near.writeUInt32LE(0, 16);
  near[20] = 3;
  const row = rowWithStrings(near, [al.name]);
  row.head[21] = row.offsets[0];
  return assemble([row.head], row.blobs);
}

function nameRow(id, name, table) {
  const fixed = table === T.KEY ? Buffer.alloc(8) : Buffer.alloc(4);
  fixed.writeUInt32LE(id, 0);
  if (table === T.KEY) fixed.writeUInt32LE(id, 4);
  const row = rowWithStrings(fixed, [name]);
  return assemble([row.head], row.blobs);
}

function playlistRow(p) {
  const fixed = Buffer.alloc(20);
  fixed.writeUInt32LE(p.parentId || 0, 0);
  fixed.writeUInt32LE(0, 4);
  fixed.writeUInt32LE(p.sort || 0, 8);
  fixed.writeUInt32LE(p.id, 12);
  fixed.writeUInt32LE(p.isFolder ? 1 : 0, 16);
  const row = rowWithStrings(fixed, [p.name]);
  return assemble([row.head], row.blobs);
}

function entryRow(e) {
  const b = Buffer.alloc(12);
  b.writeUInt32LE(e.index, 0);
  b.writeUInt32LE(e.trackId, 4);
  b.writeUInt32LE(e.playlistId, 8);
  return b;
}

/* ---------------- pages ---------------- */

function headerPage(pageCount, tables) {
  const p = Buffer.alloc(PAGE);
  p.writeUInt32LE(0, 0);
  p.writeUInt32LE(PAGE, 4);
  p.writeUInt32LE(tables.length, 8);
  p.writeUInt32LE(pageCount, 12);
  p.writeUInt32LE(0, 16);
  p.writeUInt32LE(1, 20);               // sequence
  p.writeUInt32LE(0, 24);
  let at = 0x1c;
  for (const t of tables) {
    p.writeUInt32LE(t.type, at);
    p.writeUInt32LE(0, at + 4);
    p.writeUInt32LE(t.first, at + 8);
    p.writeUInt32LE(t.last, at + 12);
    at += 16;
  }
  return p;
}

/* index pages are the first page of a table. The players skip them; the layout is
   copied from a real export so a strict reader does not trip over it. */
function indexPage(index, type, next) {
  const p = Buffer.alloc(PAGE);
  writeCommon(p, index, type, next, 0, 0, 0x64);
  const at = HEAD;
  p.writeUInt16LE(0x1fff, at);
  p.writeUInt16LE(0x1fff, at + 2);
  p.writeUInt16LE(0x03ec, at + 4);
  p.writeUInt16LE(0, at + 6);
  p.writeUInt32LE(index, at + 8);
  p.writeUInt32LE(next, at + 12);
  p.writeUInt32LE(0x03ffffff, at + 16);
  p.writeUInt32LE(0, at + 20);
  p.writeUInt16LE(0, at + 24);
  p.writeUInt16LE(0x1fff, at + 26);
  return p;
}

function writeCommon(p, index, type, next, numOffsets, numRows, flags) {
  p.writeUInt32LE(0, 0);
  p.writeUInt32LE(index, 4);
  p.writeUInt32LE(type, 8);
  p.writeUInt32LE(next, 12);
  p.writeUInt32LE(1, 16);               // sequence
  p.writeUInt32LE(0, 20);
  // 13 bits of row-offset count then 11 bits of row count, little-endian bit order
  const packed = (numOffsets & 0x1fff) | ((numRows & 0x7ff) << 13);
  p[24] = packed & 0xff;
  p[25] = (packed >> 8) & 0xff;
  p[26] = (packed >> 16) & 0xff;
  p[27] = flags;
  // transaction fields are written by the caller for a data page
}

function dataPage(index, type, next, rows) {
  const p = Buffer.alloc(PAGE);
  let heap = HEAD;
  const offsets = [];
  for (const r of rows) {
    r.copy(p, heap);
    offsets.push(heap - HEAD);
    heap += r.length;
  }
  const used = heap - HEAD;
  const groups = Math.ceil(Math.max(rows.length, 1) / 16);
  const indexBytes = groups * 0x24;
  const free = PAGE - HEAD - used - indexBytes;
  if (free < 0) throw new Error('pdb page overflow');

  writeCommon(p, index, type, next, rows.length, rows.length, 0x24);
  p.writeUInt16LE(free, 28);
  p.writeUInt16LE(used, 30);
  p.writeUInt16LE(0, 32);               // transaction row count
  p.writeUInt16LE(0x1fff, 34);          // transaction row index
  p.writeUInt16LE(0, 36);
  p.writeUInt16LE(0, 38);

  // row index: offsets and the presence bitmap, built backwards from the page end
  for (let g = 0; g < groups; g += 1) {
    const base = PAGE - g * 0x24;
    let present = 0;
    for (let i = 0; i < 16; i += 1) {
      const rowIdx = g * 16 + i;
      const off = offsets[rowIdx];
      p.writeUInt16LE(off === undefined ? 0 : off, base - 6 - i * 2);
      if (off !== undefined) present |= (1 << i);
    }
    p.writeUInt16LE(present, base - 4);
    p.writeUInt16LE(0, base - 2);
  }
  return p;
}

/* A page holds rows plus the row index, which grows backwards in 0x24-byte groups of
   sixteen. Both have to fit, so the cap is computed per candidate row count, not chosen
   once: a fixed reserve overflowed at about 150 tracks. */
function packTable(type, rows) {
  const perPage = [];
  let current = [];
  let used = 0;
  const cap = PAGE - HEAD;
  const indexBytes = (n) => Math.ceil(Math.max(n, 1) / 16) * 0x24;
  for (const r of rows) {
    const nextCount = current.length + 1;
    if (current.length && used + r.length + indexBytes(nextCount) > cap) {
      perPage.push(current);
      current = [];
      used = 0;
    }
    current.push(r);
    used += r.length;
  }
  perPage.push(current);
  return perPage;
}

/* ---------------- the database ---------------- */

function buildPdb({ tracks, playlists }) {
  const tables = [];
  const pages = [null];                 // page 0 reserved for the header

  const pushTable = (type, rows) => {
    const chunks = packTable(type, rows);
    const first = pages.length;
    const nextAfter = first + chunks.length + 1;
    pages.push(indexPage(first, type, chunks.length ? first + 1 : first));
    chunks.forEach((chunk, i) => {
      const idx = first + 1 + i;
      const next = i + 1 < chunks.length ? idx + 1 : nextAfter;
      pages.push(dataPage(idx, type, next, chunk));
    });
    tables.push({ type, first, last: first + chunks.length });
  };

  pushTable(T.GENRE, tracks.genres.map((g) => nameRow(g.id, g.name, T.GENRE)));
  pushTable(T.ARTIST, tracks.artists.map((a) => artistRow(a)));
  pushTable(T.ALBUM, tracks.albums.map((a) => albumRow(a)));
  pushTable(T.KEY, tracks.keys.map((k) => nameRow(k.id, k.name, T.KEY)));
  pushTable(T.PLAYLIST, playlists.nodes.map(playlistRow));
  pushTable(T.ENTRY, playlists.entries.map(entryRow));
  pushTable(T.TRACK, tracks.rows.map(trackRow));

  const total = pages.length;
  pages[0] = headerPage(total, tables);
  return Buffer.concat(pages.map((p) => p || Buffer.alloc(PAGE)));
}

module.exports = { buildPdb, trackRow, PAGE, T };

/* ---------------- analysis files (ANLZ) ---------------- */

/* ANLZ numbers are big-endian, unlike export.pdb. A .DAT file is PMAI + a tagged
   section list; PQTZ is the beat grid: fourcc, header length 18, tag length, two
   unknowns, a beat count, then (beat in bar, bpm x100, time in ms) per beat. */
function anlzDat(t) {
  let beats = [];
  try { beats = JSON.parse(t.beatGrid || '[]'); } catch {}
  if (!Array.isArray(beats) || beats.length < 8 || !Number(t.bpm)) return null;
  const n = beats.length;
  const tagLen = 0x18 + n * 8;
  const header = Buffer.alloc(0x1c);
  header.write('PMAI', 0, 'ascii');
  header.writeUInt32BE(0x1c, 4);
  header.writeUInt32BE(0x1c + tagLen, 8);
  const tag = Buffer.alloc(tagLen);
  tag.write('PQTZ', 0, 'ascii');
  tag.writeUInt32BE(0x18, 4);
  tag.writeUInt32BE(tagLen, 8);
  tag.writeUInt32BE(0, 0x0c);
  tag.writeUInt32BE(0x00080000, 0x10);
  tag.writeUInt32BE(n, 0x14);
  const bpm100 = Math.round(Number(t.bpm) * 100);
  for (let i = 0; i < n; i += 1) {
    const at = 0x18 + i * 8;
    tag.writeUInt16BE((i % 4) + 1, at);
    tag.writeUInt16BE(bpm100, at + 2);
    tag.writeUInt32BE(Math.max(0, Math.round(Number(beats[i]) * 1000)), at + 4);
  }
  return Buffer.concat([header, tag]);
}

/* ---------------- the USB tree ---------------- */

const fs = require('node:fs');
const path = require('node:path');

const safe = (s, max = 120) => String(s ?? '').replace(/[/\\:*?"<>|\u0000-\u001f]+/g, '_').slice(0, max).trim();

/* Build a device tree rekordbox players can open: PIONEER/rekordbox/export.pdb plus
   the audio under Contents. Returns { dir, tracks, playlists, bytes }. */
function buildUsbTree(db, playlistId, destDir) {
  const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(playlistId) || { name: 'playlist' };
  const set = safe(pl.name, 60) || 'set';
  const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.genre, t.bpm, t.key, t.key_scale,
      t.duration, t.year, t.track_no, t.beat_grid, f.path, f.size, f.bitrate
    FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
    LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
    WHERE pt.playlist_id=? ORDER BY pt.position`).all(playlistId);

  const audioDir = path.join(destDir, 'Contents', set);
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(path.join(destDir, 'PIONEER', 'rekordbox'), { recursive: true });

  const artists = new Map(); const albums = new Map(); const genres = new Map(); const keys = new Map();
  const idOf = (map, name, make) => {
    const key = String(name || '').trim();
    if (!key) return 0;
    if (!map.has(key)) map.set(key, make(key, map.size + 1));
    return map.get(key).id;
  };

  const used = new Set();
  const trackRows = [];
  let n = 0;
  for (const r of rows) {
    if (!r.path || !fs.existsSync(r.path)) continue;
    const ext = path.extname(r.path).toLowerCase() || '.mp3';
    const base = safe(`${r.artist ? r.artist + ' - ' : ''}${r.title}`) || `track-${r.id}`;
    let name = base + ext;
    let i = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${i += 1})${ext}`;
    used.add(name.toLowerCase());
    fs.copyFileSync(r.path, path.join(audioDir, name));
    n += 1;
    trackRows.push({
      id: n,
      title: r.title || base,
      artistId: idOf(artists, r.artist, (name, id) => ({ id, name })),
      albumId: idOf(albums, r.album, (name, id) => ({ id, name, artistId: 0 })),
      genreId: idOf(genres, r.genre, (name, id) => ({ id, name })),
      keyId: r.key ? idOf(keys, `${r.key}${r.key_scale === 'minor' ? 'm' : ''}`, (name, id) => ({ id, name })) : 0,
      bpm: r.bpm, duration: r.duration, year: r.year, trackNo: r.track_no,
      size: r.size || fs.statSync(path.join(audioDir, name)).size,
      bitrate: r.bitrate, sampleRate: 44100,
      fileName: name,
      filePath: `/Contents/${set}/${name}`,
      analyzePath: '',
      dateAdded: new Date().toISOString().slice(0, 10),
      beatGrid: r.beat_grid,
    });
  }

  // one analysis file per track that has a beat grid, in a folder named after its id
  let anlz = 0;
  for (const t of trackRows) {
    const dat = anlzDat(t);
    if (!dat) continue;
    const folder = anlzDir(t.id);
    const dir = path.join(destDir, 'PIONEER', 'USBANLZ', folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ANLZ0000.DAT'), dat);
    t.analyzePath = `/PIONEER/USBANLZ/${folder}/ANLZ0000.DAT`;
    anlz += 1;
  }

  const buf = buildPdb({
    tracks: {
      rows: trackRows,
      artists: [...artists.values()],
      albums: [...albums.values()],
      genres: [...genres.values()],
      keys: [...keys.values()],
    },
    playlists: {
      nodes: [{ id: 1, parentId: 0, name: set, isFolder: false, sort: 0 }],
      entries: trackRows.map((t, i) => ({ index: i, trackId: t.id, playlistId: 1 })),
    },
  });
  fs.writeFileSync(path.join(destDir, 'PIONEER', 'rekordbox', 'export.pdb'), buf);
  return { dir: destDir, tracks: trackRows.length, playlists: 1, bytes: buf.length, set, anlz };
}

const anlzDir = (id) => `P${String(id % 1000).padStart(3, '0')}/${String(id).padStart(8, '0')}`;

module.exports = { buildPdb, buildUsbTree, anlzDat, trackRow, PAGE, T };
