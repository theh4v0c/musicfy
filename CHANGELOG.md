# Changelog

## 0.1.36 — 2026-11-25

- The track and playlist context menus are translated: Play next, Add to queue, Change
  cover, Use this cover for a playlist, Let catalogue fix metadata, the playlist exports
  (M3U, Rekordbox, Traktor, CDJ USB), Delete playlist and the rest.
- The cover pickers, "Add N to playlist", "Cover of X goes to" and "Add X to" titles are
  translated.
- Native prompt and confirm dialogs receive translated text: create/rename playlist, delete
  playlist, merge duplicates, replace covers, update MUSICFY, analyze. "runs on the Pi"
  now reads "runs on this machine".

## 0.1.35 — 2026-11-25

- A message the server composes from several sentences is translated sentence by sentence,
  so "Downtempo: under 115 BPM. 4 of 5 you already play. Nothing new turned up." no longer
  stays English as a whole.
- A&R result fragments are translated: rotation, brief, catalogue, child-safety and the
  artist-specific lines.

## 0.1.34 — 2026-11-25

- A&R suggestion chips no longer fill the box with English. The visible label follows the
  interface language, the request behind it stays canonical, so a chip works whatever
  language the model is good at.
- Portuguese reaches the rules planner: list/create/download/count words, "entre 120 e
  130 bpm", "nunca tocou", "não baixadas", "em Dm", "álbuns de X". Portuguese filler words
  no longer become search terms.
- The model prompt says the request may be written in Portuguese.
- A&R result lines are translated: the catalogue summary, the per-track reason and the
  draft card ("Nothing is saved until you pick one", "+N more", the buttons).

## 0.1.33 — 2026-11-25

- The download format note is accurate: when the source already serves AAC, m4a is a
  container fix and no re-encode happens. It converts only across codecs.

## 0.1.32 — 2026-11-25

- The queue takes one job per track at a time. Two jobs for the same track raced in ingest:
  one installed the file, the other saw the row, treated it as the worse copy and removed
  it. A queued duplicate is now skipped with "duplicate of job N".
- Ingest never renames over a file that has no row. An orphan from a rejected job used to be
  overwritten silently, which lost the track that owned that name.

## 0.1.31 — 2026-11-25

- The Downloads drawer is translated: summary, running/queued counts, missing list, every
  button and every state label, including the singular "1 de 1 faixa tem áudio".
- Settings explains itself: what the name, time zone and language drive; one line per
  maintenance action; what the model endpoint does, what it never does and what happens
  without it; what target level and buffer mean. The Email field is gone: nothing read it.
- `musicfy netcheck [--apply]` probes YouTube and SoundCloud from this address, checks
  whether IPv4 is faster and writes the settings that fit.
- `musicfy setup` writes 2 downloads at once on a virtual machine and 4 on a home machine.
- `DOMAIN.md` rewritten as a full guide: DNS (including Hostinger and the AAAA trap),
  Cloudflare mode, firewall, Caddy, the shared password, verification, updates, an SSH
  tunnel alternative and a troubleshooting table. `INSTALL.md` documents netcheck and the
  source limits; `README.md` points at both.

## 0.1.30 — 2026-11-25

- A `files` row whose file no longer exists is dropped before the "better copy" comparison.
  Comparing against a missing row deleted the download that had just landed, which is how
  four tracks ended up with no audio after a queue of duplicate jobs.

## 0.1.29 — 2026-11-25

- A track download request for a track that already has audio returns `already` instead of
  queueing another job, and one in-flight request per track is reused. A player retrying
  playback used to queue a job every twelve seconds, each with its own catalogue search.
- The upgrade action sends `{ upgrade: true }`, so asking for a better copy still works.
- Job lookups match `"trackId":1` exactly; the old `LIKE` also matched track 10.

## 0.1.28 — 2026-11-25

- Selection and ingest use the same 60% duration rule. The 80% ingest floor rejected a
  legitimate 232s master of a track listed as 294s, so SoundCloud had the track and the
  shelf still stayed empty.

## 0.1.27 — 2026-11-25

- When an update changes `bin/musicfy.mjs`, `musicfy update` re-runs itself with the new
  code before restarting, so an old updater never finishes the job with old logic.

## 0.1.26 — 2026-11-25

- `musicfy update` no longer dies with `The "code" argument must be of type number` after
  restarting a running app: it awaited `restart()` but the dispatcher did not await `update()`.
- Search rejects a hit shorter than 60% of the known track length at selection time, so a
  30 second SoundCloud preview no longer wins and gets thrown away; yt-dlp moves to the
  next result.
- INSTALL.md documents `MUSICFY_YTDLP_COOKIES` for the YouTube bot check.

## 0.1.25 — 2026-11-25

- Fix the last-resort search: it prefixed an already prefixed query, so it asked for
  `scsearch1:ytsearch1:Artist Title` and could never find anything. This is why every
  failed download ended in "clients and search failed" even when SoundCloud had the track.
- The fallback tries SoundCloud first with the full query and the title alone, takes one
  hit per query, and reports the real reason instead of the stale YouTube error.
- `MUSICFY_YTDLP_COOKIES=/path/cookies.txt` passes `--cookies` to yt-dlp, for an address
  YouTube requires a login on.
- Unit tests for the search plan and the blocked-address rule.

## 0.1.24 — 2026-11-25

- A YouTube 429, bot check or 403 stops the client ladder: the downloader goes to
  SoundCloud instead of spending minutes on clients that meet the same wall.
- Downloads use eight parallel fragments on the search path too, not only on a direct link.
- The client ladder honours the chosen download format instead of always transcoding to mp3.
- `MUSICFY_YTDLP_IPV4=1` adds `--force-ipv4` for a VPS with a slow IPv6 route, and
  `MUSICFY_PREFER_SOUNDCLOUD=1` asks SoundCloud first. Both are documented in INSTALL.md
  with concurrency guidance.

## 0.1.23 — 2026-11-25

- Home pick reason "your artist of the week, unheard lately" and the "Show all 2289"
  button, large TRACKS counts, the model-test "No answer: empty response" line and the
  "not a git checkout" note are translated.
- The Prep row no longer ends in a bare "never": it reads "22 never analysed".

## 0.1.22 — 2026-11-25

- Portuguese covers the pop-up messages: toasts now translate where they are created, so
  download, queue, cover, import and failure messages are no longer English.
- Server error messages and the A&R spoken lines have translations, and stats fragments
  split by bold markup ("1 track · 2 GB on disk") are translated as a whole.
- Specific sentence rules now run before generic word rules, so "10 tracks by X I don't
  have" is no longer half Portuguese; the "nunca played" patch patterns are gone.
- Track, artist, playlist and greeting names are left alone: data is not translated.
- Dates, times and sorting follow the selected language instead of the browser locale.
- The greeting uses the listener's timezone instead of the server's local time.
- New `bin/i18n-check.mjs` gate (`npm run i18n`) fails on duplicate keys, untranslated
  toasts and patch-style patterns.

## 0.1.21 — 2026-11-25

- Translate the remaining Home pick reasons: untouched for two months, more from an artist,
  same key, BPM/never played, worn out, and the fallback reason.

## 0.1.20 — 2026-11-25

- `musicfy setup` creates a `yt-dlp-musicfy` wrapper that uses the installed Node runtime
  and yt-dlp's open-source EJS challenge solver. New installs no longer need the manual
  wrapper procedure for YouTube signature/JS challenges.
- `musicfy update` creates/updates the wrapper for an existing install; an older build can
  run `musicfy setup --skip-deps` once.

## 0.1.19 — 2026-11-25

- Download errors now include the last yt-dlp reason instead of only "clients and search
  failed".
- If every YouTube client fails, the download retries a SoundCloud search before giving up;
  a VPS IP that YouTube blocks can still reach another free source.
- version 0.1.19.

## 0.1.18 — 2026-11-25

- Home mast: the greeting aligns to the top of the Flow/Resume stack instead of floating
  in the vertical middle of the card. It keeps the one-line greeting and removes the
  awkward empty band above it.
- The mast session sentence is translated: "new track this week" and the "at 12:12" time
  in "Você parou em …".

## 0.1.17 — 2026-11-25

- Portuguese covers the Prep page (EXPORTAR, PRONTAS PARA EXPORTAR, Prepare/Update counts,
  cue-point summaries, ready/Re-analyse, listening toggle), the search Include label, the
  playlist filter and Name sort, Upload as **Subir**, Liked Songs, Settings notes, and the
  A&R suggestion prompts.
- Singular counts read "1 faixa" instead of "1 faixas".

## 0.1.16 — 2026-11-25

- Settings uses two columns at up to 1100px, with equal-height rows, instead of one 880px
  column that left the right half of a desktop empty. One column on a phone.

## 0.1.15 — 2026-11-25

- Greeting is one line with the name inline, instead of a forced two-line break.
- Settings is one 880px column with the mode band across the top, so every card shares the
  same edges. The masonry columns are gone.

## 0.1.14 — 2026-11-25

- `musicfy doctor` now checks the default `ytdlp-venv/bin/yt-dlp`, not only `PATH`.
  A working install was being reported as missing because the venv is deliberately not on
  PATH.

## 0.1.13 — 2026-11-25

- Translate the remaining "Fresh in your library" rail and the small "NEWEST FIRST" label
  inside section headings.

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
