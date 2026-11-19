'use strict';
// Export a playlist for DJ software: rekordbox (DJ_PLAYLISTS XML) and Traktor (NML).
// Cues come from the analyser's beat grid (downbeats), spaced to phrase boundaries, so the
// USB set is navigable without hand-placing every marker.
const path = require('node:path');

const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function fileUri(p) {
  const abs = path.resolve(p).split(path.sep)
    .map((seg) => (seg === '' ? '' : encodeURIComponent(seg)))
    .join('/');
  return 'file://localhost' + abs;
}

function rowsFor(db, playlistId) {
  return db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.genre, t.bpm, t.key, t.key_scale,
      t.duration, t.beat_grid, t.year, f.path, f.size, f.bitrate
    FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
    LEFT JOIN files f ON f.id=(SELECT id FROM files WHERE track_id=t.id AND tier='owned' LIMIT 1)
    WHERE pt.playlist_id=? ORDER BY pt.position`).all(playlistId);
}

function tonality(key, scale) {
  if (!key) return '';
  return `${key}${scale === 'minor' ? 'm' : ''}`;
}

// downbeats every 16 bars, capped at 8 memory cues
function cues(beatGrid) {
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
    const attrs = [
      `TrackID="${id}"`, `Name="${xmlEsc(t.title)}"`, `Artist="${xmlEsc(t.artist)}"`,
      `Album="${xmlEsc(t.album)}"`, `Genre="${xmlEsc(t.genre || '')}"`, `Kind="${kindOf(t.path)}"`,
      `Size="${Number(t.size) || 0}"`, `TotalTime="${Math.round(Number(t.duration) || 0)}"`,
      `AverageBpm="${fmtBpm(t.bpm)}"`, `BitRate="${t.bitrate ? Math.round(Number(t.bitrate) / 1000) : 320}"`,
      'SampleRate="44100"', 'DateAdded="2026-11-19"',
      // rekordbox reads Tonality as the musical key ("F#m"); it drives harmonic mixing
      `Tonality="${xmlEsc(tonality(t.key, t.key_scale))}"`,
      `Year="${Number(t.year) || 0}"`,
      `Location="${xmlEsc(pathFor(t))}"`,
    ].join(' ');
    L.push(`    <TRACK ${attrs}>`);
    // one TEMPO node is correct for a constant grid (rekordbox emits more only on BPM changes)
    L.push(`      <TEMPO Inizio="0.000" Bpm="${fmtBpm(t.bpm)}" Metro="4/4" Battito="1"/>`);
    // auto-generated cues become hot cues A-H (Num 0..7), which CDJs can jump to
    cues(t.beat_grid).forEach((start, k) => {
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

function traktorNml(db, playlistId, opts) {
  const pl = db.prepare('SELECT name FROM playlists WHERE id=?').get(playlistId) || { name: 'Playlist' };
  const tracks = rowsFor(db, playlistId).filter((r) => r.path);
  const dirFor = (opts && opts.dirFor) || ((t) => '/:' + path.dirname(t.path).split(path.sep).join('/'));
  const fileFor = (opts && opts.fileFor) || ((t) => path.basename(t.path));
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  L.push('<NML VERSION="19">');
  L.push('  <HEAD COMPANY="MUSICFY" PROGRAM="MUSICFY"/>');
  L.push('  <MUSICFOLDERS/>');
  L.push(`  <COLLECTION ENTRIES="${tracks.length}">`);
  tracks.forEach((t, i) => {
    const dir = path.dirname(t.path).split(path.sep).join('/');
    const file = path.basename(t.path);
    L.push(`    <ENTRY TITLE="${xmlEsc(t.title)}" ARTIST="${xmlEsc(t.artist)}">`);
    L.push(`      <LOCATION DIR="${xmlEsc(dirFor(t))}" FILE="${xmlEsc(fileFor(t))}" VOLUME=":" VOLUMEID="macintosh"/>`);
    L.push(`      <ALBUM>${xmlEsc(t.album || '')}</ALBUM>`);
    L.push(`      <INFO BITRATE="${t.bitrate ? Math.round(Number(t.bitrate)) : 320000}" GENRE="${xmlEsc(t.genre || '')}"/>`);
    L.push(`      <TEMPO BPM="${Number(t.bpm || 0).toFixed(6)}" BPM_QUALITY="100"/>`);
    cues(t.beat_grid).forEach((start, k) => {
      L.push(`      <CUE_V2 NAME="Auto ${k + 1}" DISPL_ORDER="0" TYPE="0" START="${Number(start).toFixed(3)}" LEN="0" REPEATS="-1" HOTCUE="${k}"/>`);
    });
    L.push('    </ENTRY>');
  });
  L.push('  </COLLECTION>');
  L.push('  <PLAYLISTS>');
  L.push('    <NODE TYPE="0" NAME="ROOT">');
  L.push(`      <NODE TYPE="1" NAME="${xmlEsc(pl.name)}">`);
  tracks.forEach((_, i) => L.push(`        <ENTRY><PRIMARYKEY TYPE="0" KEY="${i + 1}"/></ENTRY>`));
  L.push('      </NODE>');
  L.push('    </NODE>');
  L.push('  </PLAYLISTS>');
  L.push('</NML>');
  return L.join('\n');
}

module.exports = { rekordboxXml, traktorNml };
