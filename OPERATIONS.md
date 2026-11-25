# Operations runbook

Generic runbook. Hostnames, IPs, disks and the proxy domain are kept in the private
deployment repository, not here.

## Layout

| What | Default |
|---|---|
| Code | `/opt/musicfy/{core,web}` |
| Service | `musicfy-core`, port 8710 |
| Data | `/opt/musicfy/data` (sqlite, covers, caches, settings) |
| Audio | your library root, e.g. `/srv/music/owned` |
| Backups | a second disk, e.g. `/srv/music/backups` |

## Install and run (new host)

```sh
curl -fsSL https://raw.githubusercontent.com/theh4v0c/musicfy/main/install.sh | sh
musicfy doctor
musicfy service install        # systemd or launchd; otherwise: musicfy start
```

`musicfy setup --root DIR --owned DIR --token` is the same setup without the clone.
`musicfy.env` under the data root holds the paths and the token; keep it mode 600.

## Deploy

```sh
rsync -az --delete core/ HOST:/opt/musicfy/core/
rsync -az --delete web/  HOST:/opt/musicfy/web/
ssh HOST 'sudo systemctl restart musicfy-core'
./bin/smoke.sh
```

Bump `?v=` in `web/index.html` on any web change, or devices keep the old bundle.

## Backups

Source plus docs before a change:

```sh
STAMP=$(date +%Y%m%d-%H%M)
tar -czf "backups/musicfy-src-$STAMP.tar.gz" DOCS.md README.md OPERATIONS.md core web bin
shasum -a 256 "backups/musicfy-src-$STAMP.tar.gz" > "backups/musicfy-src-$STAMP.sha256"
```

Database snapshot (`VACUUM INTO`, no downtime):

```sh
node core/backup-db.js
```

Audio mirror: rsync the library root to a second disk. Refuse to run when the source mount
is missing, and treat exit 24 (source files vanished mid-run) as success.

## Restore

```sh
sudo systemctl stop musicfy-core
tar -xzf backups/musicfy-src-STAMP.tar.gz -C /opt/musicfy
sudo systemctl start musicfy-core
```

Database: `musicfy backup` writes a verified `VACUUM INTO` snapshot;
`musicfy restore backups/musicfy-YYYY-MM-DD.db` replaces the database (stop first) and
keeps the previous file beside it. The same commands work on any host.

## Diagnose

| Symptom | Check |
|---|---|
| Nothing loads | `systemctl is-active musicfy-core`, `journalctl -u musicfy-core -n 50` |
| Files shown missing | is the audio mount up? `verifyFiles` refuses to prune when >20% vanish |
| Downloads fail | `journalctl -u musicfy-core \| grep -i ytdlp`; update yt-dlp |
| Mirror stale | check the audio-backup unit and its script path |
| Slow first load | the greeting and catalogue lookups are cached; check outbound network |
