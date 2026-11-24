# Milestones

Two kinds of entry: **Delivered** is a dated log of what shipped (with the commit that
carries it), **Planned** is what has not been started. `DOCS.md` explains how things
work; this file records what changed and why.

## Delivered

### 2026-11-24 · audit pass 2: the fixes that were claimed, and the ones that were real (`v452`)

An external audit was re-run against the bundle rather than the changelog. It found that
the paths refactor broke two scripts, that a second wrong Camelot wheel had survived, and
that four new user-facing defects came with the interface round. Everything below is the
answer to a measured finding, not a claim.

**Broken by the paths refactor, now fixed**
- `backup-db.js` and `import-history.js` used `paths` without requiring it: the nightly
  snapshot had not run and the Spotify history import was dead (and with it `taste_*`,
  `play_edges`, `/api/history/stats`). Both proved against a DB copy.
- Backup now snapshots to a temporary file, runs `PRAGMA integrity_check`, and only then
  rotates: a failed vacuum no longer leaves the day with no backup.
- `Search` example chips called `navAandR`, deleted with the bridge. They now carry the
  question to A&R.
- `pioneer.js` `packTable` reserved a fixed 0x120 bytes while the row index grows per 16
  rows, so a 150-track USB export threw "pdb page overflow". The cap is computed per row
  count; 60/150/300-track PDBS verify with `rekordcrate`.
- `recommend.js` carried its own CAMELOT table that scored A minor vs C major as 0. It
  now imports `camelotOf`/`harmonicScore` from `harmonic.js`; `bin/unit.mjs` fails if a
  second wheel appears anywhere in `core/`.
- A&R answered "10 ambient tracks I don't have" with a library count, because a counted
  noun was not recognised as a request for tracks. "20 dark techno at 130" too.
- A catalogue hit unrelated to the request is no longer accepted: a result must share a
  word with the query or its genre family, and a brief is not padded with whatever the
  catalogue returned. "5 tracks by zzqqxxv" now answers "Nothing by zzqqxxv" with no
  confirm button, instead of five unrelated Brazilian indie songs.
- `ffprobe`/`ffmpeg` were four absolute paths, so previews and "Make playable" silently
  no-oped off Debian. `paths.FFMPEG`/`FFPROBE` resolve through PATH, and boot prints both.
- A fresh install followed `INSTALL.md` into `venv/` while the code looked for
  `essentia-venv/`. Docs, defaults and the boot check now agree, and the analyser path is
  printed; a missing interpreter is reported instead of returning zeroes forever.

**The open queue, closed**
- Download queue: `finish()` has a once-guard and every child (`error` + `close`) settles
  once, so a retry cannot advance the chain twice or make the concurrency count negative.
- Duplicate routes removed: the second `/api/settings` (unbounded `setSetting`) and the
  duplicate `/api/likes` POST/DELETE.
- Settings that lied are gone: `download_root`, `crossfade_ms`, `show_stream_rows` and the
  fade control, which was stored and never applied (and cannot work on iOS).
- Playlist create validates its name and uses a millisecond id: `{"name":5}` answers 400,
  and two playlists in one second no longer collide.
- `llm.js` speaks http for a local model (Ollama) and https for a remote one; metadata
  addresses are refused; the response is size-capped; the endpoint is validated when saved.
- 5xx responses no longer echo SQLite, ffmpeg or node paths; the real reason is logged.
- Rate limiting is per client (`ip|route`), `httpGet` has a timeout and size cap, and the
  preview/stream caches have ceilings.
- ZIP exports go through one `streamZip` that deletes the staging tree on close, error and
  abandoned download; `/tmp` spelling is `os.tmpdir()`.
- CSP added (`default-src 'self'`, no inline script, no framing) and the auth cookie gets
  `Secure` only when the request arrived over TLS.
- `tagwrite.js` refuses a corrupt ID3 header instead of treating the whole file as an
  empty payload, refuses to write a file with no audio, and writes UTF-16 for non-Latin
  metadata. Verified with ffprobe on `Ünïcode 東京`.
- `query.js` no longer reads the first number in a sentence as a limit ("between 120 and
  130 bpm" set limit=120). Genre misses expire after 90 days. Dead harmonic exports gone.
- Test tooling defaults to `localhost:8710`, not the live Pi: a DOM gate that measured
  production passed a build it had never seen.

Acceptance: 24 JS files parse, `node --test bin/unit.mjs` 8/8, `design-check --dom` passes,
`bin/test.mjs` 34/34 against the deployed instance, `bin/smoke.sh` ALL GREEN, sandbox boot
on an empty `MUSICFY_HOME` serves `/api/tracks` on first call.

### 2026-11-24 · interface contract, exports, playback (`v434`, `61de3fa`)

**Playback**
- Audio never passes through the service worker. Saved tracks played from
  `/offline-audio`, whose synthesised 206 died when iOS locked the screen — the car
  stopped mid-track. Offline copies are read as blobs by the page; streams always come
  from `/api/stream` (`e63de25`).
- iOS prefetch is a 64 KB ranged fetch, not a second hidden `<audio>` competing for the
  single audio session (`e63de25`).
- Server `keepAliveTimeout` 75 s (was Node's 5 s), so a locked phone does not find its
  socket closed (`e63de25`).
- A preview and the main player are mutually exclusive in both directions (`61de3fa`).

**Deploys**
- Gzip cache keyed by content hash, not byte length. A rename that kept the file size
  identical used to serve the previous build to every browser (`838ee00`).

**Library behaviour**
- Cards play when clicked; they had no click handler, only a desktop hover button.
- Artist and album are links in cards, rows and the now-playing sheet; the sheet closes
  so the page you asked for is not hidden behind it (`bb4eea5`, `c5e0357`).
- Bulk delete: selection bar, "Delete N selected" in the row menu, Delete/Backspace, one
  confirm, one request, queue and files handled (`2a90939`).

**Downloads and imports**
- Downloads report where they started: `Downloading “X” · 42%` → `Downloaded`, instead
  of opening the Downloads tab. Only the Downloads button opens it (`2cdde96`).
- A Spotify playlist import opens the playlist it built (`2cdde96`).
- A Spotify track import is findable: cache busted, Songs filtered to the title, row
  flashed, audio download started (`435d64e`).

**Recommendations**
- "Keep out of picks" is obeyed everywhere: home picks never read the list, the matcher
  ignored the genre column and the queries did not select it. `core/exclude.js` parses
  "non pop" → `pop`, expands edm/latin/emo, and filters picks, recommend, Flow, rotation,
  harmonic queue and briefs. Measured: 15 picks / 30 rotation / 50 flow, zero violations
  (`5cd1d28`).

**DJ export**
- Traktor NML: `NODE > SUBNODES > NODE > PLAYLIST` plus colon-prefixed `LOCATION DIR`,
  so playlists import instead of being dropped (`d21eda3`).
- Rekordbox XML: no `&apos;`, control bytes stripped, full attribute set — the
  "unknown error" was the escaping (`d21eda3`).
- Pioneer USB: `core/pioneer.js` writes `export.pdb` (paginated DeviceSQL) and ANLZ
  `PQTZ` beat grids from scratch, plus `Contents/`. Validated with `rekordcrate` (the
  parser Mixxx uses) and `pyrekordbox` (`d21eda3`).

**Design**
- `DESIGN.md` + `design/tokens.json` + `bin/design-check.mjs`: one value per role, and a
  check that fails when two views disagree. Binding rule in `AGENTS.md` (`1c3e6ff`,
  `d299a7b`).
- Settings: tone dot per card, exclusions echoed as chips, save message reports only what
  changed (`5cd1d28`, `a672a4a`).
- A playlist cover can come from a track's artwork, from either side (`455c544`).

**Upload**
- The 64 MB cap is gone and uploads stream to disk; "Upload track" reports progress,
  failures and a refresh (`f9bf015`, `6fb8238`).

**Ask**
- The local planner understands build / make / curate / give me / I need / I want, so
  "build me 20 tracks of dark techno" builds instead of reporting (`6fb8238`).

**Removed on request**
- File-level loudness normalisation (`loudnorm` re-encode) deleted entirely; the runtime
  gain stays, and it only attenuates (`5b41bee`).
- The earlier design churn (session card, mix headline, "where you left off" masthead,
  Play/Flow pills, mobile restyle) was reverted to `426851c` (`7062d85`).

### 2026-11-24 · Mixed In Key research, section cues, branding, crate grid (`v436`)

**From Mixed In Key** (REA + its SQLite collection + framework strings; open-source
reference Paradox-455M/MixedInKey)
- Cue points now come from **musical sections**, not every 16th downbeat. The analyser
  finds boundaries with chroma + recurrence novelty, snaps them to downbeats, labels the
  parts from RMS, and stores `sections` + `energy10` (`core/analyze.py`).
- Rekordbox XML and Traktor NML use those boundaries, weighted to the parts that change,
  capped at eight (`core/export.js`). SAOKO measured: cues at 0.95 / 29.93 / 34.74 /
  46.81 / 53.92 / 101.94 / 111.83 / 131.03.
- MIK's own format documented in `DOCS.md`: Camelot in the DB, musical key in tags,
  comment "8A - Energy 7", 8-bar energy segments, cue at every section boundary.

**A&R** (the assistant, decided with you: the name, its own destination, act-now with
undo, teaching that is permanent, visible and deletable)
- a sidebar and bottom-bar destination, `askai` renamed to A&R
- every answer with tracks carries **Play N / Queue N**; the queue can be taken back with
  Undo on the same card
- "no Imagine Dragons" is read as an instruction: it writes one exclusion, shows what it
  wrote as a chip, and offers Undo. Settings holds the same value.
- the Search|Ask switch is gone. Search finds; a sentence that is a question shows one
  `Ask A&R: "…"` line that opens A&R with it answered.

**Interface**
- The app says its name where the sidebar cannot: a 11px letterspaced wordmark replaces
  "Home" on a phone and on a collapsed rail, and the collapsed rail carries an "MF"
  monogram.
- A crate has the same list / grid / compact switch as every other list
  (`mf-view-playlist`), so a set can be read by cover.

### 2026-11-24 · the app is installable, the wheel is right, a saved track plays (`v442`)

- **Fresh installs work.** Migration step 3 creates the analysis columns; `logs/` is
  created at boot; `/api/tracks` answers 200 on an empty `MUSICFY_HOME` on the first call.
- **No path is written in code.** `core/paths.js` derives ROOT, DATA, OWNED, DB, BIN,
  YTDLP, PYTHON, LOGS, BACKUPS, PORT and BIND from the environment. All 34
  `/opt/musicfy` literals removed; INSTALL.md documents every variable.
- **`MUSICFY_BIND` exists**, and the server warns at boot when it is exposed without a
  token.
- **The Camelot wheel has one definition** (`core/harmonic.js`); `recommend.js` imports it, and eight unit tests fail if a second wheel appears. (Before this round `recommend.js` carried its own wrong table, so this claim was false when first written.)
  The duplicate major-only function that won by hoisting is gone; relative major/minor is
  0.90, not 1.0.
- **Key display switches**: `Am` or `8A`, in Settings → Playback. Exports stay musical.
- **A saved track plays from the device**, not only when the OS reports offline.
- `node --test bin/unit.mjs` is the start of a real test suite.

## Planned

### v0.2 Guided Ask — delivered

Goal: the Ask/agent surface never creates a playlist or queues a download on the first
turn. Every mutation is a proposal with a visible track list, counts and a reason, and
runs only after an explicit confirm.

Scope:
- preview and confirm for playlist creation, album download and missing-audio download
- local-first playlist proposals, scored by taste (plays, likes, playlists) instead of
  the catalogue's generic top results
- style presets: dance, house, techno, indie dance, downtempo, Burning Man
- mood heuristics from key, scale, BPM and energy: euphoric, melancholic, unsettling
- reference artist ("like Burial"): follow its BPM, key and genre family
- same behaviour with no model configured; the model only fills the same plan slots

Out of scope for v0.2:
- free-form conversation and memory beyond one pending proposal
- discovery of new artists outside the library (catalogue fill is deliberately off)
- multi-user identity and per-user taste profiles

### v0.3 Library building — open

- opt-in catalogue/discovery fill, with source quality shown before download
- reference artist that is not in the library (via catalogue similarity)
- deeper psychological tags once the analysis worker stores more than BPM/key/energy
- per-user taste profiles and shared crates

### Open decisions

- **Assistant**: researched and specified (Selector as a destination, six capabilities,
  one taste model shared with Flow and rotation, propose → confirm → undo). Waiting on
  four answers: the name, where it lives, whether play/queue act immediately, and whether
  "no X" writes a permanent rule.
- **USB**: no `.EXT` / `.2EX` waveform files and no OneLibrary `exportLibrary.db` for
  CDJ-3000-era players. Beat grid and playback work today.
- **Library**: 1,105 of the tracks still have no genre, 278 analysed tracks lack a beat
  grid. Recommendations get sharper as that fills in.
