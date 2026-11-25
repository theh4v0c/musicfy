# Changelog

## 0.1.2 — 2026-11-25

- Installation guide rewritten for someone who has never used a terminal: one numbered step
  at a time, the commands for macOS and Linux, a Docker route for Windows, expected output,
  and a troubleshooting table.
- README quick start now includes the prerequisite command for each OS instead of assuming
  Node and ffmpeg are already installed.
- Explicit platform table: macOS and 64-bit Linux are supported; Windows through Docker
  Desktop or WSL2; NAS through Linux containers; phones are clients only.
- Removed the remaining Raspberry Pi positioning, keyword and deploy references; the
  project is described as self-hosted and 64-bit Linux/macOS.
- Documentation audit: removed the remaining hostname/proxy/personal references, corrected
  the stale duplicate-key and endpoint descriptions and the test count, and added demo
  screenshots to the README.

## 0.1.1 — 2026-11-25

Licensing and distribution notices.

- README: license section, SPDX identifier, and the separation between the code license
  and the music / third-party services.
- CONTRIBUTING.md: DCO sign-off and the limits of a DCO for future dual licensing.
- THIRD_PARTY.md: ffmpeg, yt-dlp, Node, Python and catalogue-data obligations; the Docker
  image keeps Debian's ffmpeg copyright and points at its corresponding source.
- Dockerfile: OCI license/source labels and the notices copied into the image.

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
