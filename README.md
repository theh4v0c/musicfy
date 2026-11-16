# MUSICFY

Self hosted music platform. One Node service, one SQLite database, a browser player, and a
library you own. No account sits in the playback path, and no paid service is used anywhere.

Runs on a Raspberry Pi 5 (Debian 12, aarch64) at `http://LAN_IP:8710`, exposed publicly
only through Pangolin SSO at `https://musicfy.wnlab.com`.

## What it does

- **Library** of tracks, albums, artists and playlists, stored in `node:sqlite`.
- **One track, many sources.** A track row is metadata plus a ladder: owned file first, then
  free web sources, resolved on demand and verified against the catalogue before playing.
- **Search** that resolves what a track actually is (canonical artist, title, length) and shows
  the catalogue before any web scraping.
- **Downloads** with a queue, retries, client fallbacks, and truncation guards so a 30 second
  preview never replaces a real track.
- **Analysis** of BPM, key, loudness and energy with librosa, self-running in the background.
- **Genre** from the catalogue plus MusicBrainz artist tags.
- **Listening history** capture, and a weekly "For you" playlist built from what is played now.
- **Ask** view: plain language queries over the library, plus playlist building and album
  downloads through a small set of deterministic intents.

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
  analyze.py     librosa analysis worker
web/             vanilla JS single page app
  app.js         views, playback, queue, context menus
  app.css        styling, mobile layout
  index.html     shell; the ?v= number busts asset cache
bin/smoke.sh     eleven endpoint health checks
DOCS.md          full handoff: data model, endpoints, rungs, incident log, rules
OPERATIONS.md    runbook: deploy, backup, restore, diagnose
```

## Requirements

- Node 22 or newer (`node:sqlite` is built in, so there are no npm dependencies at all).
- `yt-dlp` and `ffmpeg`/`ffprobe` for downloads and streaming.
- Python 3 with librosa in a venv for analysis.

Install paths used in production: `/opt/musicfy/ytdlp-venv/bin/yt-dlp` and
`/opt/musicfy/essentia-venv/bin/python`.

## Running it

```sh
node core/core.js          # listens on 0.0.0.0:8710
./bin/smoke.sh             # checks every critical endpoint
```

Secrets and settings live in `/opt/musicfy/data` and are never committed: `settings.json`,
`llm.json`, `soundcloud.json`.

## Ground rules

1. Metadata may come from anywhere. Playback never goes through a paid service.
2. Internet exposure only through Pangolin.
3. No paid APIs, no subscriptions, no registrations that can expire.
4. Back up source and database before changing code.
5. No emojis, no em dashes, no marketing copy in the interface.

See `DOCS.md` for the data model and every endpoint, and `OPERATIONS.md` for the runbook.
