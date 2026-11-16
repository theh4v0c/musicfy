# Operations runbook

## Host

| What | Where |
|---|---|
| Service | `systemctl status musicfy-core`, port 8710 |
| Code | `/opt/musicfy/{core,web}` |
| Working copy | `/Users/macmini/MUSICFY` (git, private remote) |
| Data | `/opt/musicfy/data` (sqlite, covers, caches, settings) |
| Audio | `EXTERNAL_MOUNT/owned/{web,upload}` |
| Audio mirror | `/media/rlima/AI_LAB/musicfy/audio-backup`, daily 04:15 |

## Deploy

```sh
rsync -az --delete core/ plm:/opt/musicfy/core/
rsync -az web/ plm:/opt/musicfy/web/
ssh plm 'sudo systemctl restart musicfy-core'
./bin/smoke.sh
```

Bump `?v=` in `web/index.html` on any web change, or devices keep the old bundle.

## Backups

Source plus docs, every time before a change:

```sh
STAMP=$(date +%Y%m%d-%H%M)
tar -czf "backups/musicfy-src-$STAMP.tar.gz" DOCS.md README.md OPERATIONS.md core web bin
shasum -a 256 "backups/musicfy-src-$STAMP.tar.gz" > "backups/musicfy-src-$STAMP.sha256"
scp backups/musicfy-src-$STAMP.* plm:/media/rlima/AI_LAB/musicfy/backups/
```

Database: `sqlite3 /opt/musicfy/data/musicfy.db ".backup /media/rlima/AI_LAB/musicfy/backups/db-$(date +%F).db"`

## Restore

```sh
ssh plm 'sudo systemctl stop musicfy-core'
ssh plm 'tar -xzf /media/rlima/AI_LAB/musicfy/backups/musicfy-src-STAMP.tar.gz -C /opt/musicfy'
ssh plm 'sudo systemctl start musicfy-core'
```

## Diagnose

| Symptom | Check |
|---|---|
| Nothing loads | `systemctl is-active musicfy-core`, `journalctl -u musicfy-core -n 50` |
| Track says downloaded but will not play | `POST /api/maintenance/verify-files`, it clears file rows whose file vanished |
| Downloads all fail | `GET /api/downloads` for details; `no source`, `no audio file produced`, `yt-dlp exit N` |
| Analysis stalled | `GET /api/analyze/status`; self-runs a batch every 2 minutes |
| Genre empty | `GET /api/genre/status`; self-runs 25 artists every 5 minutes |
| Streaming stops quickly | a 30 second SoundCloud preview; the stream route swaps to YouTube when it detects one |

## Health checks

`./bin/smoke.sh` covers the eleven endpoints that must answer. Add a check here whenever a route
is added, so a regression is caught before it reaches the browser.

## Scheduled work inside the service

| Task | Interval |
|---|---|
| Analysis batch | 2 minutes |
| Genre fill | 5 minutes |
| File consistency check | once, 12 s after boot |
| Resume queued downloads | once, 7 s after boot |

## Known gaps

Crossfade, gapless, ReplayGain tags in files, beat grids, Spotify-general playlist import,
custom system prompt editing, and a search page that reads clearly. See `DOCS.md`.
