'use strict';
// Export a playlist for DJ software: rekordbox (DJ_PLAYLISTS XML) and Traktor (NML).
// Cues come from the analyser's beat grid (downbeats), spaced to phrase boundaries, so the
// USB set is navigable without hand-placing every marker.
const path = require('node:path');

// rekordbox and Traktor both use hand-rolled XML readers. They accept the five
// entity forms below and reject &apos;, so apostrophes stay literal inside a
// double-quoted attribute. Control bytes are stripped: they make rekordbox answer
// "unknown error" on an otherwise valid file.
const xmlEsc = (s) => String(s ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function fileUri(p) {
  const abs = path.resolve(p).split(path.sep)
    .map((seg) => (seg === '' ? '' : encodeURIComponent(seg)))
    .join('/');
  return 'file://localhost' + abs;
}

function rowsFor(db, playlistId) {
  return db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.genre, t.bpm, t.key, t.key_scale,
      t.duration, t.beat_grid, t.sections, t.year, t.track_no, t.disc_no, f.path, f.size, f.bitrate
    FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
    LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
    WHERE pt.playlist_id=? ORDER BY pt.position`).all(playlistId);
}

function tonality(key, scale) {
  if (!key) return '';
  return `${key}${scale === 'minor' ? 'm' : ''}`;
}

/* Cue points at musical section boundaries, the way Mixed In Key lays them out:
   the start of the track, then the places where the part changes. Falls back to the
   beat grid when a track has no section analysis. */
function cues(beatGrid, sectionsJson) {
  let sections = [];
  try { sections = JSON.parse(sectionsJson || '[]'); } catch {}
  if (Array.isArray(sections) && sections.length) {
    const starts = sections.map((s) => ({ t: Number(s.start), type: s.type, e: Number(s.energy) || 0 }));
    const head = starts[0] ? [{ t: starts[0].t, type: 'intro', e: 99 }] : [];
    // a boundary earns a cue when the part changes, not when the label repeats
    const changes = [];
    for (let i = 1; i < starts.length; i += 1) {
      if (starts[i].type !== starts[i - 1].type) changes.push({ ...starts[i], from: starts[i - 1].type });
    }
    // the drop or chorus that lifts the track beats a verse-to-verse boundary
    const weight = (c) => (c.type === 'chorus' ? 3 : c.type === 'build' ? 2.5 : c.type === 'breakdown' ? 2 : c.type === 'outro' ? 1.5 : 1) + c.e / 10;
    changes.sort((a, b) => weight(b) - weight(a));
    const picked = [...head, ...changes.slice(0, 7)].map((c) => c.t).filter((t) => Number.isFinite(t));
    return [...new Set(picked)].sort((a, b) => a - b).slice(0, 8);
  }
  let db = [];
  try { db = JSON.parse(beatGrid || '[]'); } catch {}
  if (!Array.isArray(db) || !db.length) return [];
  const out = [];
  for (let i = 0; i < db.length && out.length < 8; i += 16) out.push(Number(db[i]));
  return out;
}

const fmtBpm = (b) => (b ? Number(b).toFixed(2) : '0.00');
const kindOf = (p) => {
  const e = path.extname(p || '').toLowerCase();
  if (e === '.flac') return 'FLAC File';
  if (e === '.wav') return 'WAV File';
  if (e === '.m4a' || e === '.aac') return 'M4A File';
  return 'MP3 File';
};

function rekordboxXml(db, playlistId, opts) {
  const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(playlistId) || { name: 'Playlist' };
  const tracks = rowsFor(db, playlistId).filter((r) => r.path);
  const pathFor = (opts && opts.pathFor) || ((t) => fileUri(t.path));
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push('<DJ_PLAYLISTS Version="1.0.0">');
  L.push('  <PRODUCT Name="MUSICFY" Version="1.0" Company="MUSICFY"/>');
  L.push(`  <COLLECTION Entries="${tracks.length}">`);
  tracks.forEach((t, i) => {
    const id = i + 1;
    // every attribute rekordbox writes itself. Missing optional ones are tolerated,
    // but an empty Location or an unknown Kind is a hard error, so both are explicit.
    const attrs = [
      `TrackID="${id}"`, `Name="${xmlEsc(t.title)}"`, `Artist="${xmlEsc(t.artist || '')}"`,
      `Composer=""`, `Album="${xmlEsc(t.album || '')}"`, `Grouping=""`,
      `Genre="${xmlEsc(t.genre || '')}"`, `Kind="${kindOf(t.path)}"`,
      `Size="${Number(t.size) || 0}"`, `TotalTime="${Math.round(Number(t.duration) || 0)}"`,
      `DiscNumber="${Number(t.disc_no) || 0}"`, `TrackNumber="${Number(t.track_no) || 0}"`,
      `Year="${Number(t.year) || 0}"`, `AverageBpm="${fmtBpm(t.bpm)}"`,
      'DateAdded="2026-01-01"',
      `BitRate="${t.bitrate ? Math.round(Number(t.bitrate) / 1000) : 320}"`,
      'SampleRate="44100"', 'Comments=""', 'PlayCount="0"', 'Rating="0"',
      `Location="${xmlEsc(pathFor(t))}"`, 'Remixer=""',
      // rekordbox reads Tonality as the musical key ("F#m"); it drives harmonic mixing
      `Tonality="${xmlEsc(tonality(t.key, t.key_scale))}"`,
      'Label=""', 'Mix=""',
    ].join(' ');
    L.push(`    <TRACK ${attrs}>`);
    // one TEMPO node is correct for a constant grid (rekordbox emits more only on BPM changes)
    L.push(`      <TEMPO Inizio="0.000" Bpm="${fmtBpm(t.bpm)}" Metro="4/4" Battito="1"/>`);
    // auto-generated cues become hot cues A-H (Num 0..7), which CDJs can jump to
    cues(t.beat_grid, t.sections).forEach((start, k) => {
      L.push(`      <POSITION_MARK Name="" Type="0" Start="${Number(start).toFixed(3)}" Num="${k}"/>`);
    });
    L.push('    </TRACK>');
  });
  L.push('  </COLLECTION>');
  L.push('  <PLAYLISTS>');
  L.push('    <NODE Type="0" Name="ROOT" Count="1">');
  L.push(`      <NODE Name="${xmlEsc(pl.name)}" Type="1" KeyType="0" Entries="${tracks.length}">`);
  tracks.forEach((_, i) => L.push(`        <TRACK Key="${i + 1}"/>`));
  L.push('      </NODE>');
  L.push('    </NODE>');
  L.push('  </PLAYLISTS>');
  L.push('</DJ_PLAYLISTS>');
  return L.join('\n');
}

/* Traktor's NML: DIR is colon-prefixed per path segment (/:Users/:me/:Music/:set/),
   and a playlist only survives an import when it is wrapped in NODE > SUBNODES >
   NODE > PLAYLIST with a UUID. Without that nesting Traktor imports the collection
   and silently drops the playlist, which is exactly what "it asks to import a
   collection" looked like. */
function dirOf(p) {
  const parts = path.dirname(p).split(path.sep).filter(Boolean);
  return '/' + parts.map((s) => ':' + s).join('/') + '/';
}

function traktorNml(db, playlistId, opts) {
  const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(playlistId) || { name: 'Playlist' };
  const tracks = rowsFor(db, playlistId).filter((r) => r.path);
  const dirFor = (opts && opts.dirFor) || ((t) => dirOf(t.path));
  const fileFor = (opts && opts.fileFor) || ((t) => path.basename(t.path));
  const stamp = new Date();
  const date = `${stamp.getFullYear()}/${stamp.getMonth() + 1}/${stamp.getDate()}`;
  const time = stamp.getHours() * 3600 + stamp.getMinutes() * 60 + stamp.getSeconds();
  const uuid = 'MUSICFY' + String(playlistId).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  L.push('<NML VERSION="19">');
  L.push('  <HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"/>');
  L.push('  <MUSICFOLDERS/>');
  L.push(`  <COLLECTION ENTRIES="${tracks.length}">`);
  tracks.forEach((t) => {
    L.push(`    <ENTRY MODIFIED_DATE="${date}" MODIFIED_TIME="${time}" TITLE="${xmlEsc(t.title)}" ARTIST="${xmlEsc(t.artist || '')}">`);
    L.push(`      <LOCATION DIR="${xmlEsc(dirFor(t))}" FILE="${xmlEsc(fileFor(t))}" VOLUME=":" VOLUMEID=""/>`);
    L.push(`      <ALBUM TRACK="${Number(t.track_no) || 0}">${xmlEsc(t.album || '')}</ALBUM>`);
    L.push(`      <INFO BITRATE="${t.bitrate ? Math.round(Number(t.bitrate)) : 320000}" GENRE="${xmlEsc(t.genre || '')}" KEY="${xmlEsc(tonality(t.key, t.key_scale))}"/>`);
    L.push(`      <TEMPO BPM="${Number(t.bpm || 0).toFixed(6)}" BPM_QUALITY="100"/>`);
    // a grid marker first, then hot cues: Traktor needs TYPE 4 to keep the beat grid
    L.push(`      <CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="0.000" LEN="0.000" REPEATS="-1" HOTCUE="-1"/>`);
    cues(t.beat_grid, t.sections).forEach((start, k) => {
      L.push(`      <CUE_V2 NAME="Auto ${k + 1}" DISPL_ORDER="0" TYPE="0" START="${Number(start).toFixed(3)}" LEN="0.000" REPEATS="-1" HOTCUE="${k}"/>`);
    });
    L.push('    </ENTRY>');
  });
  L.push('  </COLLECTION>');
  L.push('  <PLAYLISTS>');
  L.push('    <NODE TYPE="0" NAME="ROOT" COUNT="1">');
  L.push('      <SUBNODES COUNT="1">');
  L.push(`        <NODE TYPE="1" NAME="${xmlEsc(pl.name)}" COUNT="1">`);
  L.push(`          <PLAYLIST ENTRIES="${tracks.length}" TYPE="LIST" UUID="${uuid}">`);
  tracks.forEach((_, i) => L.push(`            <ENTRY><PRIMARYKEY TYPE="0" KEY="${i + 1}"/></ENTRY>`));
  L.push('          </PLAYLIST>');
  L.push('        </NODE>');
  L.push('      </SUBNODES>');
  L.push('    </NODE>');
  L.push('  </PLAYLISTS>');
  L.push('  <INDEXING/>');
  L.push('</NML>');
  return L.join('\n');
}

module.exports = { rekordboxXml, traktorNml };
