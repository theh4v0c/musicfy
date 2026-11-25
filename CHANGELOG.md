# Changelog

## 0.1.12 — 2026-11-25

- Listener keeps A&R and Settings → Model endpoint. A&R is how playlists are requested in
  natural language; hiding it made the listener mode a dead end. Only Prep, harmonic tools,
  BPM/key chips and DJ exports remain hidden.

## 0.1.11 — 2026-11-25

- Listener keeps library maintenance: Fix covers, Fix metadata, Edit album and Choose
  cover remain available. Only Prep, A&R, harmonic tools, BPM/key chips and DJ exports are
  hidden.
- Cover repair falls back from a track search to an album search when a title does not
  match, and reports save/download failures separately from no match.
- `musicfy doctor` lists the covers folder so a VPS permission problem is visible.

## 0.1.10 — 2026-11-25

- Fix update checks on installs left on a detached HEAD by an older `install.sh`. The check
  compares against `origin/<branch>` and can repair a detached checkout; update now also
  reattaches to `main` instead of failing on `git pull`.
- `install.sh` updates stay on a local branch with an upstream.

## 0.1.9 — 2026-11-25

- Settings puts the Listener/DJ mode in a full-width band, so the three columns below start
  on one line instead of a tiny card staggering the first column.
- Settings shows the MUSICFY version, checks for updates, and can pull a new version with
  **Update now**. A restart is still required and the exact command is shown.
- Updates report whether the install is a git checkout, how many commits behind it is, and
  the on/off systemd restart command.
- `GET /api/update/status`, `POST /api/update`.

## 0.1.8 — 2026-11-25

- Settings → Mode: **Listener** and **DJ**.
  - Listener hides Prep, A&R, harmonic ordering, BPM/key chips, DJ set switches and every
    Rekordbox/Traktor/USB export. Tracks, uploads and playlists stay available.
  - DJ is the existing full bench.
- The mode is stored on the server, so every browser pointed at the same library follows it.
- Settings → Model endpoint shows a live green/red dot and a **Test connection** button. The
  card says the model is used by A&R/Ask only; covers, search, downloads and playback do not
  use it.
- Cover repair falls back to Deezer for tracks iTunes cannot match, and reports **could not
  be saved** separately from **no match**. `musicfy doctor` checks the covers folder.

## 0.1.7 — 2026-11-25

- Login page for the shared secret. It sets an HttpOnly cookie, keeps the password out of
  the URL, and rate-limits repeated failures.
- Portuguese (Brazil) interface, detected from the browser or chosen in Settings. The login
  page follows the browser language as well. Track, artist and album names are never
  translated.
- DOMAIN.md: a domain with automatic HTTPS through Caddy, with MUSICFY kept on
  `127.0.0.1` and the login in front of it.
- The installer binds to `127.0.0.1` by default; LAN and VPS access are deliberate.
- `musicfy status/start/stop/update` recognise an installed systemd service, so they do
  not report "not running" while systemd owns the process.

## 0.1.6 — 2026-11-25

- Agent install prompt for open-source terminal coding agents such as OpenCode and Hermes.
  It checks the machine, installs on localhost and verifies the health endpoint without
  opening a network port.

## 0.1.5 — 2026-11-25

- Fresh installs listen on `127.0.0.1` by default. Use `--bind=0.0.0.0` for access from a
  phone or another computer on the LAN, together with `musicfy token --rotate`.
- `install.sh` accepts `--root`, `--bind`, `--port` and `--token`, with or without `=`.
- The systemd unit runs as the user who invoked the installer, not as root.

## 0.1.2 — 2026-11-25

- Installation guide rewritten for someone who has never used a terminal: one numbered step
  at a time, the commands for macOS and Linux, a Docker route for Windows, expected output,
  and a troubleshooting table.
- README quick start now includes the prerequisite command for each OS instead of assuming
  Node and ffmpeg are already installed.
- Explicit platform table: macOS and 64-bit Linux are supported; Windows through Docker
  Desktop or WSL2; NAS through Linux containers; phones are clients only.
- README now includes demo screenshots and a platform table.

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
