# MUSICFY

Self-hosted music library with a browser player, a DJ prep bench, and a library you own.
One Node service, one SQLite database, no npm dependencies, no account in the playback path.

Developed on a Raspberry Pi 5 (Debian 12, aarch64). Any Node 22.13+ host with ffmpeg works.

## What it does

- **Library** of tracks, albums, artists and playlists in `node:sqlite`.
- **One track, many sources.** A track row is metadata plus a ladder: owned file first, then
  free web sources, resolved on demand and verified against the catalogue before playing.
- **Search** that resolves what a track actually is (canonical artist, title, length) and shows
  the catalogue before any web scraping.
- **Downloads** with a queue, retries, client fallbacks, and truncation guards so a 30 second
  preview never replaces a real track. Partial albums are completed from the real tracklist.
- **Analysis** of BPM, key, loudness and energy with librosa, self-running in the background.
- **DJ prep**: harmonic ordering, Camelot keys, and exports for Rekordbox (XML), Traktor (NML),
  a CDJ USB folder, plus a ZIP with the audio for moving a set to another machine.
- **Genre** from the catalogue plus MusicBrainz artist tags.
- **Listening history** capture, and a weekly "For you" playlist built from what is played now.
- **Guided Ask**: plain language queries, playlist building and album downloads are
  proposals first; nothing is created or queued until you confirm.
- **Mood and style crates**: local-first selection scored by your plays, likes and
  playlists, with presets for dance, house, techno, indie dance, downtempo and Burning
  Man, plus a reference artist ("like Burial").
- **Offline** playback on a phone through a service worker, once served over HTTPS.

## Layout

```
core/            Node service, no dependencies
  core.js        HTTP server, routes, library, downloads, streaming
  query.js       plain language to SQL
  agent.js       intents: search, build playlist, download album, download missing
  recommend.js   weekly picks from current listening
  identity.js    catalogue identity (iTunes), cached
  genre.js       artist tags (MusicBrainz)
  mb.js          ISRC and duration from MusicBrainz
  llm.js         optional model endpoint
  ytdlp.js       YouTube and SoundCloud resolution
  export.js      rekordbox / Traktor / CDJ exports
  tagwrite.js    Traktor PRIV + standard ID3 writer
  analyze.py     librosa analysis worker
web/             vanilla JS single page app
  app.js         views, playback, queue, context menus
  app.css        styling, mobile layout
  index.html     shell; the ?v= number busts asset cache
  sw.js          service worker for offline shell and audio
bin/smoke.sh     endpoint health checks
bin/test.mjs     API assertions (playlists, resolver, search cache, guards, intents)
DOCS.md          data model, endpoints, rungs, incident log
OPERATIONS.md    deploy, backup, restore, diagnose (generic)
```

## Requirements

- Node 22.13 or newer (`node:sqlite` is unflagged there, and there are no npm dependencies).
- `yt-dlp` and `ffmpeg`/`ffprobe` for downloads and streaming.
- Python 3 with librosa for analysis (see `INSTALL.md`).

Every path comes from the environment (`MUSICFY_HOME`, `MUSICFY_OWNED`, `MUSICFY_PYTHON`,
…); `/opt/musicfy` is only this machine's default. See `INSTALL.md` for the table.

## Running it

```sh
node core/core.js          # listens on 0.0.0.0:8710
./bin/smoke.sh             # checks every critical endpoint
node bin/test.mjs          # asserts real behaviour, 51 checks
```

Settings and secrets (`settings.json`, `llm.json`, `soundcloud.json`) live in the data
directory and are never committed.

## Deploy notes

- Serve it behind HTTPS. The service worker, and therefore offline playback, requires a
  secure context; plain LAN HTTP cannot register it.
- Audio uses range requests, so a reverse proxy must pass `Range` and `206` through.
- Set `MUSICFY_TOKEN` to add a shared-secret gate; the app also checks the Origin header on
  state-changing requests.

## Design rules

1. Metadata may come from anywhere. Playback never goes through a paid service.
2. No paid APIs, no subscriptions, no registrations that can expire.
3. Back up source and database before changing code.
4. Keep the interface plain: no emojis, no em dashes, no marketing copy.

See `DOCS.md` for the data model and every endpoint, and `OPERATIONS.md` for the runbook.
