-- MUSICFY core schema, SQLite (WAL). Zero external deps, node:sqlite.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY,          -- spotify id when known, else wnl-<folderkey>
  name        TEXT NOT NULL,
  source      TEXT NOT NULL,             -- wnl-dl | spotify | manual
  spotify_id  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT UNIQUE NOT NULL,      -- normalized artist|album|title
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL DEFAULT '',
  album       TEXT DEFAULT '',
  year        TEXT,                      -- null until verified enrichment
  genre       TEXT,
  duration    REAL,
  format      TEXT,
  spotify_id  TEXT,
  isrc        TEXT,
  bpm         REAL,                      -- essentia, null until analysis
  key_sig     TEXT,
  mood        TEXT,
  has_art     INTEGER DEFAULT 0,
  added_at    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  path        TEXT UNIQUE NOT NULL,
  tier        TEXT NOT NULL,             -- owned | cache | source
  bitrate     INTEGER,
  size        INTEGER,
  mtime       INTEGER,
  added_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS listens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at   INTEGER NOT NULL,
  ms_played   INTEGER DEFAULT 0,
  source      TEXT,                      -- which ladder rung served it
  scrobbled   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_listens_track ON listens(track_id, played_at);

CREATE TABLE IF NOT EXISTS resolutions (
  track_id    INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  rung        TEXT,                      -- local | soulseek | deezer | youtube | soundcloud | bandcamp | jamendo
  quality     TEXT,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS likes (
  track_id    INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  payload     TEXT,
  state       TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | error
  detail      TEXT,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);
