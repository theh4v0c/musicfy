# Changelog

## 0.1.0 — 2026-11-25

First installable release.

### Library
- SQLite library of tracks, albums, artists and playlists; no npm dependencies.
- Owned audio with a source ladder, download queue, retries and truncation guards.
- Uploads deduplicated by SHA-256 and by artist/title, with a better copy replacing a
  worse one.
- Metadata editing for one track or a whole album; hand edits win over catalogue repair.
- Album running order stored as `track_no`/`disc_no`, filled from iTunes or Deezer when
  missing and never overwriting an existing number.
- Album covers, cover picker, genre families and children's-music classification.

### Playback
- Browser player with queue, Flow, radio, likes and play history.
- Offline playback through a service worker on HTTPS, including iOS lock-screen resume.
- Loudness attenuation, key display in musical or Camelot notation.

### DJ prep and export
- Prep bench with analysis state per playlist, BPM/key/loudness and cue points.
- Rekordbox XML, Traktor NML and Pioneer CDJ USB export, plus a playlist ZIP.
- Harmonic ordering and Camelot wheel compatibility.

### Discovery
- Catalogue-backed search and A&R with outside-library downloads.
- Weekly recommendations, artist diversity, mood/style crates.
- Optional OpenAI-compatible model endpoint for parsing requests.

### Operations
- `musicfy` CLI: setup, serve, start/stop/status, logs, doctor, backup, restore, token,
  update, service install, open.
- `install.sh` for a zero-dependency clone into `~/.musicfy`.
- systemd and launchd units, Dockerfile, CI for unit/design/boot smoke.
- Environment-driven paths; no hardcoded `/opt` or `/media`.
- Database snapshots with `VACUUM INTO`, integrity verification and retention.

### Known limitations
- Single user; one shared token, no accounts or first-run password.
- No scanner for an existing folder yet; audio enters by download or upload.
- Analysis needs Python with librosa; the Docker image is larger than the Node service.
- Windows is not tested.
