# Milestones

Two kinds of entry: **Delivered** is a dated log of what shipped (with the commit that
carries it), **Planned** is what has not been started. `DOCS.md` explains how things
work; this file records what changed and why.

## Delivered

### 2026-11-24 · Prep says what it does, not what version it is (`v482`)

- The hero was three sentences of implementation detail ("analyser v2, which adds
  sections"). It now reads: "The playlists you play out — BPM, key, beat grid and cue
  points ready to export. Listening playlists stay off this page." Kicker is EXPORT, not
  the redundant SET PREPARATION.
- "Without sections" became "without cue points" everywhere the person sees it; the
  analyser version is no longer in the meter or Settings. Counts use thousands separators.
- Tooltips lost "current analyser"; Re-analyse is "Analyse every track again, including
  cue points".

### 2026-11-24 · Metadata repair updates the row, not the page (`v480`)

"Fix metadata" changed the data correctly, then called `refreshView()`: the whole view was
rebuilt, the scroll jumped and the page flashed. The repair is a few fields on one track.

- `patchTrackEverywhere(id, fields)` updates the in-memory track (`_rows`, `_currentList`,
  queue, now playing), the visible row title/artist/album and any track card, removes only
  the `/api/tracks` cache entry, and calls `paintNowPlaying()` if that track is playing.
  The single-track repair uses it and no longer re-renders.
- The crate/album job now returns `changes: [{id, ...fields}]`; the watcher applies each
  through the same function. A fallback keeps the scroll position if an older server
  returns counts without changes.
- Cards got `data-id` so a card can be patched without a selector by index.

Verified in the browser: patching a row changed its title/artist/album in place with
`#view.scrollTop` unchanged. Repair job shape now includes `changes`.

### 2026-11-24 · A new playlist is for listening (`v479`)

- `POST /api/playlists` defaults `kind` to `listen`; `dj` is only set when asked for.
  All other creators (A&R commit, weekly recommendations, Spotify import, history mirror,
  WNL import, ask-playlist) write `listen` explicitly, so the SQLite column default on an
  existing database cannot quietly make them DJ sets.
- Both "New playlist" entry points send `kind: 'listen'` and say so: "Listening playlist
  created — switch it to DJ set when you want it prepped."
- Schema default changed for fresh installs. Existing playlists keep the role they have;
  the test suite now asserts the default.
### 2026-11-24 · The cover is square on every phone; the heart does not open it (`v478`)

- The now-playing cover is a `div` with a background image, sized by max-width/max-height.
  On a short phone the width stayed at `min(80vw,300px)` while the height was capped by
  the available space, so the square artwork was rendered 300×296 and `cover` cropped its
  edges. It is now `height: min(100%, var(--np-art-max))` with `width: auto` and
  `aspect-ratio: 1`; the phone override sets the variable instead of the width.
  Measured square at 390×844, 390×667, 360×640, 375×812, 428×926.
- Clicking the player-bar heart opened the now-playing page on desktop. `toggleLike()`
  repaints the heart with `innerHTML` during the click, which detaches the event target;
  by the time the click bubbled to `.pb-left`, `closest('button')` was false and the
  container opened the cover. The heart now stops propagation, and `.pb-left` checks the
  `composedPath()` captured at dispatch. The mini and full-player hearts stop it too.

Verification: like leaves `#np` hidden on desktop, cover square across five phone sizes,
design-check 37/37, unit 10/10, test 51/51, smoke green.

### 2026-11-24 · Home stops showing empty rows (`v477`)

Two empty areas came from the data and the lazy loader, not the layout:

- `/api/radio/:id` returned only the seed when a track had one same-family neighbour and
  no shared-playlist neighbours. The fallback that fills the queue ran only when the list
  was **completely** empty, so "Your rotation" was one card in a full-width rail.
  The radio now fills to 15 from the same family, then from the owned library, skipping
  taught exclusions; a seed with one neighbour returns 15 instead of one.
- `#home-lazy:not([data-filled]) { display:none }` hid the recents and the playlist grid
  for six seconds, because `data-filled` is only set when the discovery rail loads. The
  header comment claimed those two paint at once. Only `#discover-home` is hidden while
  it is empty now; recents and playlists appear immediately, discovery joins them.

Measured at 1162×936: rotation 1 -> 12 cards; Recently played visible at 3 s instead of a
blank half-page. Tests 50 -> 51 (`/api/radio` returns a queue).

### 2026-11-24 · UI/UX correctness pass: readable, operable, content first (`v476`)

Response to the external audit. Correctness and the first screen; no redesign.

**M1 — correct**
- `--on-acc` (`#140a07`, 6.36:1) is the ink on every accent fill: primary buttons, the
  active filter, card play discs, Flow, crate analyse, export hovers. White on `#ff5c39`
  was 3.07:1. `.mode-tab.on` lost the white-overlay gradient that made it 2.5:1.
- The two progress bars are real sliders: `role="slider"`, focusable, `aria-valuemin/max/
  now/valuetext`, ←/→ ±5 s, Shift ±30 s, Home/End. Verified: ArrowRight moved 2→7 s,
  End to 4:35 with ARIA updated.
- Hover reveals now also open on focus: `.pcard:focus-within`, `.trow:focus-within` for
  like/more; focus on a card play button makes it visible.
- Coarse pointers: icon controls take `--h-touch` (44px); row discs, like/more and chips
  get a 44px hit area from a pseudo-element without changing their visible shape.
- `aria-current="page"` on the active sidebar and phone-bar item.
- `user-select` is scoped: controls and drag surfaces are not selectable; titles and
  metadata are copyable again.
- The topbar pill reads `1,594 TRACKS · 18.9 GB` (DESIGN §10), and it is only on Library
  and Settings, not on Home.

**M2 — first screen**
- On-deck picks and the quick counters moved below the first rail. The masthead is
  greeting + note + Flow only.
- Measured: desktop 329→173px, phone 325→192px. First card 487→331 and 467→334.
  Music starts at 37% / 40% of the viewport instead of 54% / 55%.

**M3 — contract**
- `design/tokens.json`: `color.on-acc` and `control.touch`; DESIGN.md records both, the
  slider and selection rules, the 12-key hue exception, and the corrected home layout.
- `design-check` now computes on-accent contrast and fails below 4.5:1.
- Removed the duplicated `.cat-card` block, the duplicated `.genrechip:hover` and
  `.mast-resume b`, the two conflicting `.plhead-actions` declarations and the dead
  gradient `.mode-tab` block.
- DESIGN.md's duplicate `.mast` container row and its stale "34 API tests" are fixed.

Not in this pass (recorded in Planned): the 25 literal font sizes, 30 off-palette hex
values, style-layer refactor, display typeface, and motion cuts.

Verification: design-check 37/37 + `--dom` all roles, unit 10/10, `bin/test.mjs` 50/50,
smoke green, screenshots at 1440×900 and 390×844 with no horizontal scroll.

### 2026-11-24 · audit pass 3: the filter that did not filter, and the follow-up that swallowed a new request (`v474`)

The audit was right on the three P1s, including one that was my own previous "fix":

- **The brief filter never filtered.** `briefWords()` returns an array, but `briefFill()`
  tested `.size`; undefined meant "no words", so every catalogue result for a theme
  passed. The comment claiming the Fast Car failure was fixed was false. The filter is one
  exported predicate (`briefMatches`), it reads `.length`, it tolerates a plural
  ("robots" / "The Robot Song"), and a unit test asserts MGMT's *Kids* is rejected on a
  unicorn brief.
- **A new subject was treated as a follow-up.** `isFollowUp()` accepted any sentence of
  five words or fewer without a genre word, so "10 aphex twin" inherited the previous
  plan's genres and query. A follow-up must now be an instruction (`more`, `darker`,
  `the same but slower`, `two more`) or a modifier-only sentence. "10 aphex twin" is a
  new request, and a leading count without a noun is now understood as a request for that
  many tracks.
- **An empty library lost the outside half of the suggestions.** No artists, families or
  keys meant no discovery prompt. A static fallback ("10 ambient tracks I don't have",
  "10 electronic tracks I don't have") keeps the promise on a fresh install; verified with
  an empty `MUSICFY_HOME`.

P2s, all correct:
- `backup-db.js` no longer calls a schema-less database corrupt: missing DB and zero tables
  both print `{snapshot:null, skipped:…}` and exit 0 without creating a file. The
  missing-DB case was not in the report and failed the same way.
- The three inline `onerror=` cover fallbacks are gone; a capture listener on `document`
  handles `data-cover-hide` / `data-cover-initial`, so the CSP can stay strict. No console
  CSP violations on load.
- `/api/listen` validates the id (400 "no such track") instead of echoing a foreign-key
  error.
- The SoundCloud stream cache is under `os.tmpdir()` and pruned (7 days, 2 GB); no
  hardcoded `/tmp` remains outside `paths.js`.
- `INSTALL.md` has one environment table, and Node is 22.13+ everywhere (that is where
  `node:sqlite` loses the flag).
- `cancelledJobs` is trimmed in the 60 s interval when the job is neither running nor
  queued.
- A `kind='listen'` playlist refuses `/analyze` even when called directly.
- `savedBlobs` refreshes its LRU on a hit; warm URLs are capped at four, so the map cannot
  grow past the keep size in practice.
- The auth cookie sets `Secure` on `X-Forwarded-Proto: https` from any proxy; a client can
  only affect its own cookie by lying.

Acceptance: unit 10/10 (two new: follow-up classification, brief filter), `bin/test.mjs`
50/50 (listen validation, listening guard), design-check and smoke green.

### 2026-11-24 · A&R keeps the last draft; exclusions reach the catalogue (`v473`)

Two gaps in "memory":

- the server already merged a short follow-up into the previous plan, but the client never
  sent one, so "make it darker" was a new text search. The page now keeps the last plan
  for the session and sends it; the server answers `follow-up`/`follow-up+llm` and the
  draft keeps its count and subject ("Techno darker").
- taught exclusions filtered the library through mood, but not the catalogue fill, so a
  banned artist or genre could return as a new download. A&R filters both local and online
  results with `taste_avoid`, unless the request itself names the term.

`DOCS.md` now states what is remembered and where: model stateless; exclusions, taste,
history and playlists in the app's data; the last plan only for the session; drafts 15
minutes; no transcript. That is also why a different model or provider cannot erase it.

### 2026-11-24 · uploads refuse duplicates instead of stacking them (`v472`)

Uploading the same track twice used to give one track row and **two owned files**. The
uploader said "Added 1 track" both times, and the duplicate only surfaced later in
*Remove duplicate files*.

- The upload route hashes the stream (SHA-256) and refuses bytes it already owns; that
  catches `track.mp3` and `track (2).mp3`, and untagged WAVs where the title is just the
  filename. A second check uses the app's identity key (artist + title) for a different
  encode of the same song.
- A genuinely better copy (codec/bitrate, same `fileQuality` rule as the downloader)
  replaces the old file: old bytes and their file row go, the track, plays and analysis
  stay. Otherwise the uploaded bytes are deleted and the server answers
  `409 {duplicate:true, title, artist, existing}`.
- The uploader reports duplicates separately from failures: "2 already in your library
  (Artist — Title)" and a hint that *Find higher quality* is how to replace a copy. The
  progress line says duplicates are skipped before it starts.
- `files.sha256` (migration 5) and an index; downloads stay unhashed and are caught by
  metadata when uploaded back.

Verified on the live server: same file twice -> 409 and one file row; a 320k copy of the
same track replacing a 128k one -> `replaced:true`, one row, old file deleted. Tests
46 -> 48 (a generated WAV uploads once, the same bytes are refused).

### 2026-11-24 · "Albums by X" is answered by the catalogue (`v470`)

**The report:** asking "Albums by fear factory" returned three local tracks and nothing
from the catalogue. It was not caused by the children's brief work; the path never had an
album intent. Two gaps lined up:

- the client sends a sentence to the agent only when it matches a verb list. "album" was
  not in it, so the request went to the library filter, which can only see local rows.
- the agent had `download_album` (one album) and `search_tracks` (text), but no way to
  list an artist's albums, so even the agent answered `report_library` with "3 tracks
  match text albums fear factory".

**Fixed**
- `artist_albums` intent: "albums by X", "X's discography", "what albums does X have",
  "X albums". Planned locally, and added to the model prompt so the model cannot file it
  as a search.
- `agent.artistAlbums` reads the catalogue's album list, merges albums already in the
  library first (an owned album the catalogue's relevance list skips must still be
  openable), and reports `owned / total` per album. Deduplicated by name and year.
- A&R renders an album card: cover, year, track count, "N here", and **Open** for what
  you have or **Download** for what you do not. Download queues through the existing
  `/api/albums/download`, which fills the missing tracks of a partial album.
- Artist casing is preserved from the sentence ("Albums by Fear Factory").

Verified against the live catalogue: Fear Factory returns 10 albums, `Digimortal` first
with 1 track here and an Open action; the rest offer Download. Tests 43 -> 46.

### 2026-11-24 · variety in recommendations, discovery in the A&R chips (`v467`)

**Recommendations were a discography**
- `recommend.js` now takes one track per artist for the first ten, at most two after that,
  and counts the first credited name ("Minilogue" and "Minilogue, Dominik Eulberg" are
  the same act). Home picks reject a second track by an artist already in the three.
- Measured: a 15-track recommendation is 15 artists (one repeat at position 13, allowed
  after ten); home picks are three different artists instead of the artist of the week
  twice.

**The A&R suggestion chips only looked inward**
- `/api/ask/suggest` returned library filters only ("tracks in Gm I have not played",
  "tracks around 121 bpm"), so pressing a chip taught the user that A&R is a library
  filter. It now alternates discovery and library: "10 tracks by <your top artist> I
  don't have", "10 <family> tracks I don't have", plus one library prompt each.
- A "by X" request no longer returns X's own shelf rows when the sentence also says "I
  don't have" — the branches used to let the artist match override the outside request,
  producing 83 local tracks with the reason "none of these are in your library". The
  catalogue result is also filtered to artists matching X, so a song titled "Meshuggah"
  by another band is not accepted as Meshuggah.

Verified: suggestion row alternates outside/inside; "10 tracks by Meshuggah I do not
have" -> 0 local, 7 catalogue, reason names Meshuggah. Tests 43/43.

### 2026-11-24 · a crate action that reports what it did (`v465`)

**Fix metadata (crate) was a fire-and-forget job**
- The menu item posted, toasted "Fixing metadata for N tracks in the background", and the
  server logged the outcome. A run that changed nothing and a run that failed both looked
  like nothing happening, which is exactly how it was reported.
- The route is now a job: `POST /api/playlists/:id/repair` starts it, `GET` returns
  `{running, total, done, fixed, same, failed, fields}`. The work is a catalogue lookup
  per track, so it can take a minute on a forty-track set.
- The client polls it with the progress pill ("Fixing metadata 3/13") and ends with a
  sentence: "Metadata: 13 checked — 4 changed (album 3 · year 1), 9 already correct", or
  "13 checked — 13 already correct" when there was nothing to fix. A failed request shows
  its status instead of a generic message.
- A second click while it is running says so ("this playlist is already being repaired")
  and polls the same job.
- The album page's **Fix metadata** shares the runner (`album:<name>` key), so it reports
  the same sentence instead of its own "started" toast.

Verified in the browser against a real set: the pill moved and the final toast read
"Metadata: 13 checked — 13 already correct" (the catalogue had nothing to add). Tests
40 -> 41 with the job-shape assertions.

### 2026-11-24 · "analysed" was not a yes/no, and not every playlist is a crate (`v463`)

**Analysis has a version, so "latest" is answerable**
- `tracks.analysis_version` and `ANALYSIS_VERSION = 2` (1 = BPM/key/grid, 2 = sections and
  energy10). Migration 4 labels existing rows: 2 where sections exist, 1 where there is
  only BPM/key, 0 where nothing was analysed.
- `GET /api/analyze/status` reports `current / outdated / never / prepped / sections` and
  the version; the three states add up to the total. Prep's meter counts only current as
  prepared, and the hero reads "17/1461 up to date · 840 without sections · 604 never
  analysed · analyser v2" instead of a single misleading "612 prepped".
- A playlist says which state it is in: "13 without sections", "4/31 up to date · 4
  without sections · 23 never", and its button says *Update N* or *Prep N* rather than
  "ready". Re-analyse is the explicit full redo, and the normal Prep pass now includes
  outdated rows (it used to select only missing beat grids).
- The playlist header carries the same verdict next to its length, and Settings → Library
  says how many tracks are current.

**A listening playlist is not a DJ crate**
- `playlists.kind` = `dj` (default) or `listen`, switched with two chips in the playlist
  header; `PATCH /api/playlists/:id` accepts `{kind}`.
- Prep lists DJ sets only. Listening playlists are hidden behind "Show listening (N)" and,
  when shown, carry no prep control and no export trio: there is no work to do and no
  export to build.
- The Playlists index marks them with "· listening", so the distinction is visible before
  opening one.
- Existing playlists migrate as `dj`; nothing disappears from Prep on upgrade, and a
  listening-only installation can mark its sets and stop seeing prep work entirely.

Acceptance: migration 4 applied on the live DB; 39/39 API tests (5 new: analysis
accounting, kind round-trip), unit 8/8, design-check --dom OK, smoke green.

### 2026-11-24 · a queue that survives the lock screen, and a children's brief that is safe (`v455`)

**Playback: the advance no longer awaits anything**
- The end-of-track path called `nextTrack()` → `playAt()`, which awaited a Cache Storage
  read to build the offline blob. On a locked iPhone that read is suspended, so the queue
  stopped exactly at the boundary. Sources are now resolved while the current track is
  still playing (`warmSrc`), and `advanceAtEnd()` hands the next source to the element in
  the same task, from both the `ended` event and the `timeupdate` end-guard.
- The queue is extended two tracks before it ends, while audio is playing, instead of
  asking `/api/radio` at the moment the lock screen forbids a request.
- A `NotAllowedError` from `play()` is recorded and retried on unlock. It used to be
  swallowed by an empty `.catch`.
- Settings → Playback shows the last six player events with track ids and blob/stream, so
  a failure with the screen off leaves evidence.
- Verified in the browser: seeking to the last second advances to the next track through
  `end-guard → advance → start`, with the next source already in `warmSrc`.

**A&R: a seven-year-old is a different audience**
- Child detection (age under 13, kids/children/toddler, my daughter/son; "play Baby by…"
  is not a child brief) routes the request through a safety rule: catalogue only, and
  only tracks whose iTunes explicit flag is clean. Library rows are excluded and the
  reason says why, because a file carries no explicit flag.
- A brief that matches nothing in the library no longer falls back to the current
  rotation — the bug that put dark techno in a children's playlist.
- Brief matching requires a phrase or two words, not one shared word; the catalogue
  filter reads a Set's `.size` (it read `.length`, which was always undefined, so it never
  filtered) and accepts the Children's Music genre without a title match.
- Measured: "15 track upbeat playlist for a 7 year old girl who loves to dance" → 15
  catalogue tracks, 0 explicit, 0 from the library. "unicorns and robots for a five year
  old who likes Imagine Dragons" → Imagine Dragons plus kids' unicorn/robot songs.
- The local planner recognises a child brief without the model ("five year old" as words)
  and no longer classifies a song called *Baby* as a children's request.

**Prep: the Re-analyse pill was a stretched bar (`v460`)**
- `.crate-btn` carried `flex: 1 1 30%` for the three export buttons; the Re-analyse pill
  used the same class, so as a direct flex child of the row it grew to 514px and read as a
  progress bar. The flex rule is scoped to `.crate-acts` now.
- Re-analyse is an outlined pill at the row's control height (`--h-tab`), with `ready` in
  the same `crate-row-state` group; Prep got its accent back by dropping the neutral
  `.crate-btn` base.
- Export pills and both maintenance controls share one height and one type size in the row.
- On a phone the state and the export buttons get their own right-aligned lines instead of
  squeezing the title; in a 190px card the count takes one line, the action the next.

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

### v0.4 UI/UX correctness pass — delivered (v476)

Source: external audit of 2026-11-24. Scope is correctness and the first screen, not a
redesign.

- **M1 correct**: done (v475).
- **M2 first screen**: done; mast 173/192px, first card 331/334.
- **M3 contract**: done for the new tokens, contrast and the duplicate blocks. Font-size/
  colour enforcement remains a later cleanup — the 25 sizes and 30 off-palette hexes are
  untouched.

Restore point: tag `restore-pre-ux-20261124-1707`.

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
