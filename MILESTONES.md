# Milestones

Two kinds of entry: **Delivered** is a dated log of what shipped (with the commit that
carries it), **Planned** is what has not been started. `DOCS.md` explains how things
work; this file records what changed and why.

## Delivered

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

**Interface**
- The app says its name where the sidebar cannot: a 11px letterspaced wordmark replaces
  "Home" on a phone and on a collapsed rail, and the collapsed rail carries an "MF"
  monogram.
- A crate has the same list / grid / compact switch as every other list
  (`mf-view-playlist`), so a set can be read by cover.

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
