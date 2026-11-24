#!/usr/bin/env node
// Ingest Spotify Extended Streaming History into musicfy.db.
// Usage: node import-history.js <dir-with-json> [--reset]
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const paths = require('./paths');

const DB = paths.DB;
const dir = process.argv[2];
const reset = process.argv.includes('--reset');
if (!dir || !fs.existsSync(dir)) { console.error('usage: import-history.js <dir> [--reset]'); process.exit(1); }

const db = new DatabaseSync(DB);
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS spotify_plays (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  ms_played INTEGER DEFAULT 0,
  track_name TEXT,
  artist_name TEXT,
  album_name TEXT,
  track_uri TEXT,
  platform TEXT,
  reason_start TEXT,
  reason_end TEXT,
  skipped INTEGER DEFAULT 0,
  shuffle INTEGER DEFAULT 0,
  offline INTEGER DEFAULT 0,
  conn_country TEXT
);
CREATE TABLE IF NOT EXISTS history_files (
  name TEXT PRIMARY KEY, bytes INTEGER, rows INTEGER, music_plays INTEGER, imported_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sp_ts ON spotify_plays(ts);
CREATE INDEX IF NOT EXISTS idx_sp_uri ON spotify_plays(track_uri);
CREATE INDEX IF NOT EXISTS idx_sp_artist ON spotify_plays(artist_name);
CREATE TABLE IF NOT EXISTS taste_tracks (
  uri TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
  plays INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, skips INTEGER DEFAULT 0, last_ts TEXT
);
CREATE TABLE IF NOT EXISTS taste_artists (
  artist TEXT PRIMARY KEY, plays INTEGER DEFAULT 0, ms INTEGER DEFAULT 0, last_ts TEXT
);
CREATE TABLE IF NOT EXISTS play_edges (
  a TEXT NOT NULL, b TEXT NOT NULL, w INTEGER DEFAULT 0, PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS idx_edges_a ON play_edges(a);
`);

// collapse any duplicate plays left by the first import, then enforce uniqueness
const dupGroups = db.prepare(`SELECT COUNT(*) c FROM (
  SELECT 1 FROM spotify_plays GROUP BY ts, track_uri, ms_played HAVING COUNT(*) > 1)`).get().c;
if (dupGroups) {
  db.exec(`DELETE FROM spotify_plays WHERE id NOT IN (
    SELECT MIN(id) FROM spotify_plays GROUP BY ts, track_uri, ms_played)`);
  console.log('deduped play groups:', dupGroups);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_sp_play ON spotify_plays(ts, track_uri, ms_played)');

if (reset) {
  db.exec('DELETE FROM spotify_plays; DELETE FROM taste_tracks; DELETE FROM taste_artists; DELETE FROM play_edges;');
  console.log('cleared existing history');
}
const already = db.prepare('SELECT COUNT(*) c FROM spotify_plays').get().c;
if (already > 0 && !reset) console.log(`existing plays: ${already}, importing only new rows`);

const clean = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return (s === '' || s === 'None' || s === 'null') ? null : s;
};
const bool = (v) => (String(v).toLowerCase() === 'true' ? 1 : 0);

const files = fs.readdirSync(dir).filter((f) => /\.json$/i.test(f) && /History_Audio|StreamingHistory|Streaming_History/i.test(f));
console.log('files:', files.length);
const ins = db.prepare(`INSERT OR IGNORE INTO spotify_plays
  (ts, ms_played, track_name, artist_name, album_name, track_uri, platform, reason_start, reason_end, skipped, shuffle, offline, conn_country)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

let total = 0, music = 0, newRows = 0;
const ledger = db.prepare('SELECT bytes FROM history_files WHERE name=?');
const stamp = db.prepare('INSERT INTO history_files (name,bytes,rows,music_plays,imported_at) VALUES (?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET bytes=excluded.bytes, rows=excluded.rows, music_plays=excluded.music_plays, imported_at=excluded.imported_at');
for (const f of files) {
  const fp = path.join(dir, f);
  const size = fs.statSync(fp).size;
  const known = ledger.get(f);
  if (known && known.bytes === size && !reset) { console.log('  ', f, 'unchanged, skipped'); continue; }
  const rows = JSON.parse(fs.readFileSync(fp, 'utf8'));
  db.exec('BEGIN');
  for (const r of rows) {
    total++;
    const uri = clean(r.spotify_track_uri);
    const title = clean(r.master_metadata_track_name);
    if (!uri || !title) continue; // podcasts and empty rows
    const res = ins.run(
      clean(r.ts) || '', Number(r.ms_played) || 0, title,
      clean(r.master_metadata_album_artist_name), clean(r.master_metadata_album_album_name),
      uri, clean(r.platform), clean(r.reason_start), clean(r.reason_end),
      bool(r.skipped), bool(r.shuffle), bool(r.offline), clean(r.conn_country)
    );
    music++;
    newRows += res.changes || 0;
  }
  db.exec('COMMIT');
  stamp.run(f, size, rows.length, music, new Date().toISOString());
  console.log('  ', f, rows.length, 'rows,', rows.length ? 'new plays added' : '');
}

// aggregates
db.exec(`
DELETE FROM taste_tracks; DELETE FROM taste_artists; DELETE FROM play_edges;
INSERT INTO taste_tracks (uri, title, artist, album, plays, ms, skips, last_ts)
SELECT track_uri, MAX(track_name), MAX(artist_name), MAX(album_name), COUNT(*), SUM(ms_played), SUM(skipped), MAX(ts)
FROM spotify_plays WHERE track_uri IS NOT NULL GROUP BY track_uri;
CREATE INDEX IF NOT EXISTS idx_tt_norm ON taste_tracks(lower(title), lower(artist));
CREATE INDEX IF NOT EXISTS idx_ta_plays ON taste_artists(plays DESC);

INSERT INTO taste_artists (artist, plays, ms, last_ts)
SELECT artist_name, COUNT(*), SUM(ms_played), MAX(ts)
FROM spotify_plays WHERE artist_name IS NOT NULL GROUP BY artist_name;
`);

// co-listening edges between consecutive tracks in a session (gap <= 30 min)
const plays = db.prepare(`SELECT artist_name a, ts FROM spotify_plays
  WHERE artist_name IS NOT NULL ORDER BY ts`).all();
const edge = db.prepare('INSERT INTO play_edges (a,b,w) VALUES (?,?,1) ON CONFLICT(a,b) DO UPDATE SET w=w+1');
let prev = null, prevAt = 0, edges = 0, skippedGap = 0;
db.exec('BEGIN');
for (const p of plays) {
  const at = Date.parse(p.ts) || 0;
  if (prev && p.a !== prev && at - prevAt > 0 && at - prevAt <= 30 * 60 * 1000) {
    const [x, y] = [prev, p.a].sort();
    edge.run(x, y); edges++;
  } else if (prev && at - prevAt > 30 * 60 * 1000) skippedGap++;
  prev = p.a; prevAt = at;
}
db.exec('COMMIT');

const stat = {
  rows_read: total,
  new_plays: newRows,
  music_plays: db.prepare('SELECT COUNT(*) c FROM spotify_plays').get().c,
  unique_tracks: db.prepare('SELECT COUNT(*) c FROM taste_tracks').get().c,
  unique_artists: db.prepare('SELECT COUNT(*) c FROM taste_artists').get().c,
  edges: db.prepare('SELECT COUNT(*) c FROM play_edges').get().c,
  first: db.prepare('SELECT MIN(ts) m FROM spotify_plays').get().m,
  last: db.prepare('SELECT MAX(ts) m FROM spotify_plays').get().m,
  hours: Math.round((db.prepare('SELECT SUM(ms_played) s FROM spotify_plays').get().s || 0) / 3600000),
  gap_sessions: skippedGap,
};
console.log(JSON.stringify(stat, null, 1));
