# MUSICFY handoff

Self-hosted music platform. Own catalogue, own metadata, no third party account in the playback chain.

**Status: in development (pre-1.0).** Interfaces, endpoints and the schema can change between
releases. The store deployment tracks a tagged release; check `musicfy version`.

- Host: one 64-bit Linux or macOS machine, LAN `http://<host>:8710`, optionally behind an authenticated reverse proxy
- Code `/opt/musicfy/{core,web}` on the host
- Data `/opt/musicfy/data` (sqlite + covers + history), audio `<library root>/{web,upload,playlist-*}`

Read this file first, then `core/core.js` sections in this order: schema, upsertTrack, ladder search, resolveBest, download queue, stream routes.

## State of the build

Working: catalogue with 600+ tracks, playlist CRUD, Spotify playlist and single track mirroring from public links, listening history ingest with taste tables and co-listening edges, search across YouTube Music / SoundCloud / Internet Archive, a download queue with retries, cancels and live progress, device download of single files and whole playlists as zip, cover art lookup, duplicate merge, playback with queue persistence, prebuffering of the next tracks, Media Session for car and lock screen, auto skip on unplayable tracks.

## Deploy

```
rsync -az --delete core/ HOST:/opt/musicfy/core/
rsync -az web/ HOST:/opt/musicfy/web/
ssh HOST 'sudo systemctl restart musicfy-core'
ssh HOST 'journalctl -u musicfy-core -n 50'
curl -s localhost:8710/api/health/rungs
```

Web assets are versioned with `?v=N` in `web/index.html`. Bump it on every deploy or browsers keep the old bundle.

## Data model

- `tracks`: one row per artist and title. `dup_key = normalise(artist)|normalise(title)` with a UNIQUE index. Album, case, `feat` blocks, bracketed suffixes and hyphenated `- Remastered`/`- Single Version`/`- Radio Edit` suffixes are stripped before hashing; a parenthetical edition such as `(Remastered 2006)` stays part of the title, so an original and a remaster remain separate records.
- `files`: one row per owned file, tier `owned`. One file per track is enforced in the download ingest: the better copy wins, ranked by codec first then bitrate (`fileQuality()`), so a 254k mp3 transcoded from 160k AAC loses to the original AAC.
- `playlists`, `playlist_tracks` (ordered, position), `listens`, `likes`, `resolutions` (which rung served a track and at what quality), `jobs` (download queue: state, progress, detail), `settings` (`auto_download_plays`).
- History: `spotify_plays`, `taste_tracks`, `taste_artists`, `play_edges`, `history_files` ledger.
- Stream only rows carry `src_kind`, `src_id`, `src_url` and no file.

## Source rungs

`yt-dlp` (`MUSICFY_YTDLP`, default `$MUSICFY_HOME/ytdlp-venv/bin/yt-dlp`) resolves YouTube and acts as the generic extractor. YouTube Music catalogue is the primary music source; the plain YouTube video sweep was removed deliberately because it produced random uploaders. SoundCloud and Internet Archive follow. Bandcamp is implemented but disabled, its search answers with a bot challenge from this network.

Filters reject lyrics videos, interviews, documentaries, podcasts, reactions, mixes, full albums, emoji titles, clips under 45 seconds, and for artist queries anything where the artist does not lead the title or own the uploader. Label channels (`- Topic`, VEVO) get a scoring bonus.

`resolveBest()` asks MusicBrainz for the canonical duration, rejects candidates more than 8 seconds away, prefers the closest duration, and carries an ISRC when MusicBrainz returns one.

### SoundCloud specifics

- Streaming: the route `/api/ladder/stream/soundcloud?u=<track url>` downloads the whole track once into ``<os.tmpdir()>/musicfy-sc/<key>.mp3`` and serves it with range support. Fetching the HLS segment url directly is what truncated playback to about 29 seconds, so do not go back to that.
- First play of an uncached SoundCloud track waits for the full fetch (tens of seconds on a long track). Later plays are instant. If latency matters, prewarm on search results.
- Downloads use `-f hls_aac_160k/hls_aac_96k/hls_mp3_128/bestaudio -x --audio-format m4a`, keeping the native 160k AAC instead of re-encoding, and a probe step refuses clips that are only 30 second previews (SoundCloud serves those for tracks that require a paid plan).
- Free SoundCloud tops out at 96k/160k AAC or 128k mp3. 128k files are the ceiling for some uploads, not a bug.

### SoundCloud, no paid tier

`core/soundcloud.js` is modeled on `scdl-org/scdl`: it reuses the public client id that
yt-dlp keeps in `~/.cache/yt-dlp/soundcloud/client_id.json` (scraping the site no longer
works), resolves permalinks through `/resolve`, and reads the public API at
`api-v2.soundcloud.com`.

What is free and what is not, measured on this box:

- Progressive mp3 transcoding, when a track has one: redirected straight to the browser.
- HLS AAC at 96k or 160k: the best SoundCloud gives free accounts. `128k` files are
  uploads that were made at 128k, not a defect.
- The artist's original file (WAV/FLAC): only for tracks with downloads enabled, and the
  `/tracks/{id}/download` endpoint answers 401 without an OAuth token. A token from a free
  SoundCloud session is enough and can be set with:

```
curl -X POST localhost:8710/api/soundcloud/token -H 'content-type: application/json' \
  -d '{"token":"OAuth token from a logged in SoundCloud session"}'
```

Stored at `/opt/musicfy/data/soundcloud.json` (mode 600). Without it, downloads fall back
to the 160k AAC path, which is what most tracks will use.

No paid source is wired in. Beatport was implemented, required a streaming plan, and was
removed on request: this project does not depend on paid services.

## Correcting metadata by hand

A track's context menu has **Edit metadata** (title, artist, album, year). For a group —
the usual case when YouTube files land in the wrong album — select the rows and press
**Edit album** in the selection bar, or open an album and press **Edit album** to move
every track on it at once: tick *Set album* (and optionally *Set year*), type the value,
save. Clearing the album field removes the album. `POST /api/tracks/edit
{ids, album?, year?, genre?}` does the update.

Both editors are a modal `<dialog>`: a dimmed backdrop, native focus trap and Escape,
fields in one column, and one accent-filled **Save**. A server refusal ("a track needs a
title") appears inside the dialog, not as a toast, so the value can be corrected without
reopening it.

`None` is not treated as a placeholder: it is the title of Meshuggah's 1994 EP. The
repair pass clears `Web`, `Unknown`, `NA`, `N/A`, `YouTube` and `Untitled`, and leaves a
real one-word title alone.

An album change is not an identity change. `repair.apply()` only checks the
artist+title duplicate key when the title or artist actually changed, so a row with a
duplicate elsewhere can still be moved to the correct album (previously any edit on such
a row failed with "another track already has that title and artist").

Both edit paths share one validator. A title may not be empty; a year must be between 1900
and next year; `genre_family` must be a family the classifier knows. A rejected write
answers 400 with a sentence ("a track needs a title"), never SQLite's constraint text.

### Hand edits win over the catalogue

Every field whose value actually changed through **Edit metadata** or **Edit album** is
recorded in `tracks.meta_locked`; a save that changes nothing locks nothing. `repair.propose()`
skips locked fields, so **Fix metadata** can fill what is missing but cannot revert a field a
person set. The catalogue is a suggestion, not an override.

The lock is not permanent: a track whose menu offers **Fix metadata** also offers **Let
catalogue fix metadata** when fields are locked. It calls `POST /api/tracks/:id/unlock`,
clears the lock, and returns the track to automatic repair.

## Album order

An album is a sequence, not a bag of tracks. `tracks.track_no` and `tracks.disc_no` hold
the running order; the album page sorts by disc, then track, then row id. `GET
/api/group/album/:name` also asks the catalogue for the release tracklist and writes any
**missing** number back to the row. iTunes is asked first; when it rate limits or does not
carry an edition, Deezer supplies the same track/disc positions. A number already on the track is never overwritten: a
tag or a person's correction wins.

Matching is by normalized title first, then by a unique duration within five seconds (for
titles the catalogue spells differently, e.g. `C**k/ver10`). A release that shares fewer
than two titles with a four-track-or-longer album is treated as a different album with the
same name and is ignored. Because the numbers are written to the database, the order
survives a restart, an offline start and an export; Traktor and Rekordbox XML both receive
the track number (and Rekordbox the disc).

The catalogue tracklist is cached for 30 days. A failed lookup is cached for six hours and
never replaces a list that was already known.

`node bin/fill-album-order.mjs [--dry-run] [--limit=N] [--album="Name"]` does the same for
the whole library instead of only the albums as they are opened. It is safe to rerun: it
fills blanks and reports how many numbers it added.

## Versions: original vs remaster

`ladder.titleForVersion()` keeps the version the person asked for. A request without
"remaster"/"re-release"/"reissue" searches the plain title even when the catalogue's
canonical match is the remaster; candidates that carry a version marker are scored down.
A request that names the remaster keeps the marker and prefers the remaster. This matters
because a remaster is a different recording, not a cleaner file: Meshuggah's *Nothing*
2006 re-recorded guitars and triggered drums. The library's own duration is used as the
length expectation first, so a 6:33 original is not rejected because a 7:06 remaster
matched the catalogue.

## Track length rules

Absolute floors were rejecting legitimate short material: grindcore and death metal tracks,
interludes and skits can be three or four seconds. The rules are now proportional or minimal:

| Place | Rule |
|---|---|
| Search results | reject only under 3 seconds |
| Ingest guard | reject only under 3 seconds |
| Duration tolerance when the catalogue length is known | under 30 s: `max(3, 50%)`; under 180 s: `max(20, 60%)`; otherwise 8 s |
| search fallbacks | `--match-filter duration > 2` |
| Preview detection | still ratio based, a 30 s clip against a declared long track |

Verified: Napalm Death "You Suffer" resolved at 5 s verified against a 6 s catalogue entry, and
downloaded end to end as a 71 KB file.

## Download resolution, and why kids tracks failed

Four separate causes were found and fixed:

1. Catalogue rows posted to `/api/ladder/download` with a title and artist but no video id,
   which hit "unknown rung". The route now resolves first when it has no id or url.
2. Archive results are whole collections with no duration and were winning the match. They are
   excluded from download resolution and kept for search display only.
3. Some videos only answer to a specific YouTube client. Downloads now walk
   `android`, `ios`, `web_safari`, `tv` before giving up, which is what unblocked the Pinkfong
   catalogue (a plain fetch reported "this video is not available").
4. When nothing resolves at all, the job falls back to a `search` rung: `scsearch3` on
   SoundCloud, then `ytsearch3` on YouTube, taking the first download that succeeds.

Also: short tracks (under three minutes) get a wider duration gate, because album and video
cuts of kids songs differ a lot, and the identity resolver now tries "title artist" word order
as well as "artist title", plus title-only scoring when no artist was given.

Result: the Pinkfong playlist went from 1 of 11 tracks with audio to 11 of 11.

## Download queue

Four parallel downloads, three parallel resolvers, progress parsed from yt-dlp percentages into `jobs.progress`. `GET /api/downloads` feeds the Downloads panel: per row Retry and Cancel, plus Retry all failed, Cancel all and Dismiss failed. Cancel kills the child process. Failed rows are marked `dismissed` rather than deleted and are pruned after 30 days. Jobs left queued by a restart resume seven seconds after boot; jobs that were running are marked interrupted.

A track played twice downloads itself (`settings.auto_download_plays`, 0 disables).

## Design truth

`DESIGN.md` + `design/tokens.json` are the interface contract: colour, radius scale,
the three control roles, the type scale, containers, layout, motion, content rules and
the list of forbidden patterns. `bin/design-check.mjs` enforces it (tokens ↔ CSS, then
the built pages at 1440, 390 and 360) and exits non-zero on drift. Run it before and after
any visual change.

## Keys: one wheel, two notations

`core/harmonic.js` is the only definition of the Camelot wheel, and `bin/unit.mjs` tests
it: twelve minors, twelve majors, flats equal to sharps, and the four compatibility rules
(same key 1.0, relative major/minor 0.90, one along 0.85, two along 0.40, energy boost
0.45, everything else 0).

`harmonicOrder` is a greedy walk that always takes the best available move and, when
nothing is compatible, the shortest jump on the wheel. The home rotation, `/api/mix/next`
and the crate's Harmonic button all use it — previously a duplicate, major-only
definition won by hoisting and scored every key as `undefined`, which made a minor and
its parallel major identical.

**Display**: Settings → Playback → *Key names* switches the interface between `Am` and
`8A`. It is a display preference only; every export writes musical notation, which is
what Rekordbox (`Tonality`) and Traktor (`KEY`) read.

## Offline playback

A saved track plays from the device, **always** — the blob from Cache Storage, not the
stream. `navigator.onLine` is not a reliable signal in a car: the Pi is behind a tunnel,
a dead hotspot or a locked screen while the flag still says online. The stream is the
fallback when no copy exists. Three blobs are kept in memory; older object URLs are
released.

## Recommendations are one per artist, mostly

`core/recommend.js` sorts by score, then walks the list keeping **one track per artist
for the first ten**, and at most two after that; the first credited name is what counts, so
"Minilogue" and "Minilogue, Dominik Eulberg" are one act. The home picks apply the same
rule: three picks, three artists. Without it a fifteen-track recommendation was four
artists, which reads as a discography rather than a recommendation.

### Children's music is not evidence of taste

`genre_family = 'children'` is excluded from the taste profile by default: recent-listening
seeds, top family, average BPM, key, candidates, home picks, rotation seed, greeting facts,
A&R suggestion artists and outside-discovery seeds. The plays stay in history and recently
played; explicit requests ("children's songs for my daughter") still search and play them.
Settings → Taste has the switch, `taste_include_children`, off by default. Turning it on
puts those plays back into the profile.

## What A&R remembers

The model is **stateless**. Every request sends the sentence and the JSON schema; no chat
history, no library rows, no profile. Nothing is fine-tuned, and no provider-side memory is
used. That is deliberate: the model only decides what kind of request it is, and the app
executes it deterministically.

What persists, and where:

| memory | where | survives a model/provider switch |
|---|---|---|
| "never play X" exclusions | `data/settings.json` → `taste_avoid`, written by a teaching sentence | yes |
| taste fields (genres, artists, context), name, city, timezone, key format | `data/settings.json` | yes |
| listening history, likes, playlists, analysis | `data/musicfy.db` | yes |
| the last A&R plan ("make it darker") | the page, in memory | only for the session |
| a draft (playlist proposal) | server memory, 15 minutes | no |

Exclusions are applied after planning, by `core/exclude.js`, to picks, Flow, radio, the
mix, recommendations, mood selection and now also to catalogue fills — a taught term
cannot come back as a new download unless the request itself names the term. The model is
never told your preferences, so changing model or provider cannot drop them; only the
quality of parsing a complicated sentence changes. Basic verbs are planned by the local
rules regardless of the provider.

What is **not** stored: the sentences you type, any free-text fact ("remember that I
like…"), and conversations. The only durable way to teach a preference is an exclusion
("no Imagine Dragons") or the Taste fields in Settings.

`data/settings.json` is not inside the nightly database snapshot; a full backup is the
`data/` directory, not only `musicfy.db`.

## The A&R

One destination (`askai`, labelled A&R in the sidebar and the phone bar). It answers,
builds and acts.

- **Answers** come from `/api/agent` for instructions and `/api/ask` for plain library
  questions; the reply names the intent and whether it was planned locally or by the model.
- **Outside the library is a first-class outcome.** A request that names an artist, or says
  "I don't have" / "not in my library" / "outside", is answered from the catalogue
  (iTunes, no key needed), and comes back as a draft titled *Outside your library* with
  *Create + download N*. Confirming creates the playlist and queues the audio. When the
  catalogue is down the answer says so; it never substitutes the most-played artists from
  the library and calls them a found result (that was the bug behind "ambient I don't
  have" returning metal).
- **Play N / Queue N** on any answer. Both act at once — playback is cheap and reversible
  — and a queue can be taken back with Undo on the same card.
- **Children's briefs are a different audience, not a genre.** A request that names an
  age under 13, kids/children/toddler, or "my daughter/son" is built from the catalogue
  only, and every catalogue track is checked against iTunes' explicit flag. Library files
  carry no explicit flag, so none are used; the reason says so. If the request explicitly
  says "from my library", the tracks are used with a warning instead of being silently
  mixed in. Before this, a children's brief filled nine slots from the dark-techno
  rotation because a brief that matched nothing fell back to "what you play now".
- **"Albums by X" is a discography request.** It is its own intent (`artist_albums`), not
  a library text search: the list comes from the catalogue, albums already in the library
  are merged in first (so an old album the catalogue's relevance list skips can still be
  opened), and each row carries how many tracks are here with *Open* or *Download*. The
  client used to send this sentence to the library filter because "album" was not in its
  verb list, which is why it answered with the three local rows and nothing else.
- **The suggestion chips go both ways.** Half are library questions ("tracks in Fm I
  have not played", "tracks around 121 bpm"); half are discovery ("10 tracks by your top
  artist I don't have", "10 electronic tracks I don't have"). They used to be library
  queries only, which taught that A&R is a filter for your own shelf. A "by X" request
  also filters the catalogue result to artists whose name matches X, so a song *called*
  "Meshuggah" by someone else is not returned as a track by Meshuggah.
- **Teaching**: a message that starts with no / don't play / never play / avoid is not a
  search. It writes one term into `taste_avoid`, shows the term as a chip and offers Undo.
  The same value is what Settings edits, and what picks, Flow, the rotation and the
  harmonic queue already obey.
- Proposals (a crate, a download) still require an explicit confirm; nothing destructive
  happens from a sentence.
- **Search no longer asks.** The Search|Ask switch is gone: that page finds tracks, artists
  and albums. A sentence that reads as a question still gets a single bridge line above
  the results — `Ask A&R: "…"` — which opens A&R with the text already answered. One
  destination for asking, and no second place with the same job.

## Exclusions ("keep out of picks")

Settings stores one free-text field, `taste_avoid`. `core/exclude.js` turns it into
terms: it splits on commas, semicolons, newlines and "and", strips instruction prefixes
("no", "non", "avoid", "keep out of picks"), normalises accents, and expands a small
synonym table once (latin -> reggaeton, dembow, bachata, cumbia…; edm -> big room,
electro house, dance pop…).

A track is excluded when a term appears in **artist, album, title, genre or genre
family**. Terms of three characters or fewer match whole words only, so `pop` does not
bite `populate`.

Every surface that picks music filters through it: home picks (ON DECK), `/api/recommend`,
`/api/flow`, `/api/radio` (the home rotation), `/api/mix/next`, and `mood.select` for
briefs. Saving settings invalidates the picks cache, so the change is immediate.

## Playlist artwork

A playlist cover can come from three places: a generated tile, an uploaded image
(`POST /api/playlists/:id/cover`), or **a track's artwork**
(`POST /api/playlists/:id/cover-from-track` `{trackId}`). The last one is a file copy —
both are already 600px JPEGs — so it is instant and lossless.

Two ways in: the track's row menu ("Use this cover for a playlist", then pick the
playlist) and the playlist menu ("Use a track's cover", then pick from its tracks, shown
with thumbnails). The client bumps `state.artV` so the header image URL changes with
`?v=` and the browser does not serve the old cover from cache.

## Loudness

One mechanism only: **runtime gain**. With `normalize_loudness` on, the player sets
`audio.volume` per track from the LUFS measured during analysis, towards
`target_loudness` (default -12). It only ever attenuates — never boosts, never touches a
file, and therefore cannot change a track's dynamics.

iOS ignores `audio.volume` completely, so this is a desktop and Android feature. There is
deliberately **no file-rewriting path**: re-encoding a track to hit a loudness number
compresses its peaks, and that is not something a library should do behind your back.

## Uploads and duplicates

An upload is refused when the track is already here. Two checks, in this order:

1. **Same bytes** — a SHA-256 is computed while the file streams in; an owned file with
   the same digest is the same file, whatever it is called (`track.mp3` and
   `track (2).mp3` included). This is the check that works for untagged WAVs.
2. **Same artist and title** — the identity key the rest of the app uses. A different
   encode of the same song is caught here.

If the incoming copy is genuinely better (codec/bitrate, the same `fileQuality` rule the
downloader uses), it replaces the old file: the old bytes and their `files` row are
removed, the track, plays and analysis are kept. Otherwise the upload is deleted and the
server answers `409 {duplicate:true, title, artist, existing}`. The uploader counts those
and reports "2 already in your library (Artist — Title)" instead of "failed", with a hint
that *Find higher quality* is the way to replace a copy. The whole batch is never blocked:
the new tracks upload, the duplicates are skipped.

## Duplicates and deleting records

**Remove duplicates** is deliberately conservative. A duplicate is the same artist and
title after case and punctuation folding, the same album (or a blank album on one side),
and a length within three seconds. The best copy (owned, bitrate, then playlist use) wins,
and playlist entries, likes and plays move to it.

Versions are never merged: an original, a remaster, a live take and a remix have different
titles or lengths, so they stay as separate records. That is a hard rule: merging
*Closed Eye Visuals* with *Closed Eye Visuals (Remastered 2006)* would destroy one of the
two releases. The button previews what it found (`GET /api/maintenance/duplicates`) and
only then applies it (`POST /api/maintenance/dedupe`); with no exact duplicates it says so
instead of removing something else.

An album page also has **Delete album**: one confirmation names the track count and how
many files leave the disk, then the album's rows are removed with their playlist entries,
likes, plays and analysis.

## Maintenance buttons

Each button in Settings → Maintenance writes its result into the card, with numbers. A
toast that vanishes is not an answer.

| button | what it does | reports |
|---|---|---|
| Repair metadata | `2010.0` years, impossible years, placeholder albums (`Web`, `Unknown`, `NA`), media labels in titles (`(Official Audio)`), whitespace, missing durations | years normalised · albums cleared · labels removed · titles trimmed · durations filled · how many still have no artist |
| Fill genres | MusicBrainz artist tags, one artist every 1.5 s, split across collaborators | artists checked · newly tagged · tracks with a genre, **live** |
| Fix covers | official album art for tracks with none; iTunes first, Deezer fallback | tried · found · could not be saved · no match · still without art · titles tried |
| Remove duplicates | exact duplicate tracks (same artist/title after case/punctuation folding, same album or one blank, length within 3 s) and extra files on one track; best copy wins, playlists/likes/plays move to it, files are deleted | duplicate tracks merged · files removed · a preview with sample titles before anything is deleted |
| Delete album (album page) | removes every track on that album, its playlist entries, likes, plays, analysis and audio files | tracks removed |
| Clear cache | localStorage + Cache Storage | page cache size |

Crate and album actions report the same way. **Fix metadata (crate)** and the album page's
**Fix metadata** run a catalogue lookup per track; each is a job with progress (`Fixing
metadata 3/13`) and a result, e.g. "Metadata: 13 checked — 4 changed (album 3 · year 1), 9
already correct". Both used to print one "started" toast and log the outcome to the server,
so an action that changed nothing and an action that failed looked identical from outside.

Genre pass specifics: a tag string like "Oxia, Robag Wruhme" is not an artist, so it is
split and each name is tried until one answers. A lookup that fails is not cached as a
missing answer any more. Progress is per artist, not per batch, because a batch of 200 is
eight minutes and a counter that sits at zero is indistinguishable from a dead button.

## Genres

One family list, in `core/genre.js`: metal, electronic, hip hop, latin, children,
soundtrack, jazz, classical, blues, country, folk, rock, soul, reggae, gospel, pop.
`identity.js` imports it instead of keeping a second copy, which is how children's music
and latin used to exist in the library but on no card.

- **Role words are not genres.** iTunes returns "Composer" or "Actress" in the genre
  field for odd releases; `genreOf()` refuses them, so they never become a family and
  never appear as a chip.
- **Families are derived twice**: from the genre text (`classify`) and, where that cannot
  decide, from the artist tags already in `genre-cache.json` (`restoreFromCache`). Both
  run at boot, are idempotent, and only fill a gap — a genre the classifier does not
  recognise never erases a family that came from the artist.
- **The numbers reconcile.** The Genres view builds cards from the data with no whitelist,
  shows every family, and adds a **no family** card for the rest. The header reads
  `10 families · 435 of 1461 tracks`, and the cards add up to exactly that.

## Mixed In Key interop, and what we took from it

Mixed in Key 10.2.1 (`com.mixedinkey.application`) is a native app with separate
frameworks for analysis, tags, data and "danceability". Its collection is SQLite at
`~/Library/Application Support/Mixedinkey/Collection10.mikdb`:

| table | what it holds |
|---|---|
| `ZSONG` | `ZKEY` in **Camelot** ("2A"), `ZTAGKEY` in **musical** notation ("D#m"), `ZSECONDKEY`, `ZTEMPO`, `ZENERGY` 1–10, `ZTAGENERGY`, `ZPITCH`, `ZVOLUME` (dB), `ZCLIPPEDPEAKCOUNT`, `ZBEATS` (NSKeyedArchiver beat times) |
| `ZENERGYSEGMENT` | energy over time in **8-bar blocks** (`ZSTARTTIME`, `ZLENGTH`, `ZENERGY` 1–10) |
| `ZKEYSEGMENT` | key changes inside a track, with confidence |
| `ZCUEPOINT` | cue points with an energy level, at section boundaries |
| `ZWAVEFORM` | stored waveform |

Its tag convention, from the binary's own format string `%@ - Energy %ld`: the comment
reads **"8A - Energy 7"**, alongside `INITIALKEY`, the iTunes freeform frames
`----:com.apple.iTunes:energylevel` and `----:com.mixedinkey.mixedinkey:energy`, and the
Vorbis comments `ENERGYLEVEL` / `INITIALKEY`. It exports Rekordbox XML (memory cues with
`Num="-1"` **and** hot cues `Num=0..6`), Serato crates, Traktor NML, and it can write
straight into the Rekordbox 6 database.

### What MUSICFY took

**Section cues.** Cues used to sit on every 16th downbeat, which is a grid, not music.
`core/analyze.py` now finds sections the way the open-source reimplementation does
(Paradox-455M/MixedInKey): beat-synchronous chroma, recurrence matrix, checkerboard
novelty, gaussian smoothing, peak picking, **boundaries snapped to downbeats**, then
labels from each section's RMS (intro / verse / chorus / build / breakdown / outro).
The analyser is librosa, already in the analyser venv.

Stored on the track as `sections` (JSON) and `energy10`. `core/export.js` builds cue
points from the boundaries where the *part changes*, weighted towards chorus and build,
capped at eight, with the beat grid as the fallback for unanalysed tracks.

Measured on ROSALÍA — SAOKO: 13 sections, and the Rekordbox XML now carries cues at
0.95 / 29.93 / 34.74 / 46.81 / 53.92 / 101.94 / 111.83 / 131.03 instead of an even grid.

Not taken: rewriting files (removed on request), Serato crate export, importing MIK's
own database (its rows identify files by security-scoped bookmark, so matching needs a
bookmark-resolution step).

## DJ export

Three artefacts come out of a crate. The formats were checked against real parsers, not
against a hunch.

**Rekordbox XML** (`/api/playlists/:id/export/rekordbox.xml`) — `DJ_PLAYLISTS` with the
full attribute set rekordbox writes, `Tonality` for harmonic mixing, `<TEMPO>` and memory
cues from the beat grid, and the playlist under `PLAYLISTS > NODE > NODE`. Escaping is
deliberately conservative: no `&apos;`, control bytes stripped — rekordbox's parser is
hand-rolled and answers "unknown error" otherwise. Round-trip checked with `pyrekordbox`
(RekordboxXml): 13 tracks, one playlist, 13 keys.

**Traktor NML** (`/api/playlists/:id/export/traktor.nml`) — `LOCATION DIR` is
colon-prefixed per segment (`/:Users/:me/:Music/:set/`), and the playlist is wrapped in
`NODE > SUBNODES > NODE > PLAYLIST` with a UUID. Without that nesting Traktor imports the
collection and silently drops the playlist, which is what "it asks to import a collection"
was.

**Pioneer USB** (`/api/playlists/:id/export/pioneer.zip`) — a real device tree:

```
PIONEER/rekordbox/export.pdb                  the database the player reads
PIONEER/USBANLZ/P###/########/ANLZ0000.DAT    beat grid per track
Contents/<set>/<Artist - Title>.<ext>         the audio
```

`core/pioneer.js` writes both binary formats from scratch:

- export.pdb is the paginated DeviceSQL relational file: 4096-byte pages, a header page
  with one table pointer per table, per-table index + data pages, a heap that grows
  forward and a row index that grows backward, and DeviceSQL strings (short ASCII or
  long ASCII/UTF-16). Tables written: tracks, artists, albums, genres, keys,
  playlist_tree, playlist_entries.
- ANLZ is big-endian: `PMAI` header then tagged sections; `PQTZ` carries the beat grid
  (beat in bar, BPM×100, time in ms). Written only when the track has a real beat grid.

Verified with `rekordcrate` (the Rust parser Mixxx uses, `cargo install rekordcrate`):
`dump-pdb` reads every table, every title, every `file_path`, the playlist tree and its
entries without error. ANLZ verified with `pyrekordbox.anlz`: 193 beats at 129.2 BPM with
the right times.

Known gap: no `.EXT`/`.2EX` waveform files yet (grid and BPM work, waveform art does not),
and no OneLibrary `exportLibrary.db` for the newest players. Both are additive.

## Playback

`/api/stream/:id` serves owned files with ranges and a private one day cache, and 302 redirects stream rows to the resolved source, cached four hours (`resolveStreamUrl`). The client prefetches one track ahead, and only after the current one has played a while with buffer of its own: two prefetches over one slow uplink starve the track that is playing, which is what a car on mobile data actually hears.

Saved tracks are read from Cache Storage **by the page** and handed to the element as a
blob URL. Nothing about audio passes through the service worker: a response the worker owns
dies with it when iOS locks the screen. The page reads the copy early, while music is still
playing, and keeps the blob URL warm for the next tracks (`warmSrc`); non-saved tracks are
just their stream path.

That warming is the difference between a queue and one track in a car. The end of a track
is the one moment iOS may suspend the page, so the advance must not await anything there:
the `timeupdate` end-guard and the `ended` handler both call `advanceAtEnd()`, which reads
an already-resolved source and starts it in the same task. The queue is extended two tracks
before its end while audio is still playing, because asking `/api/radio` at the boundary
needs a network request the lock screen does not grant. If the element refuses the new
source (`NotAllowedError`), the rejection is logged and the unlock handler retries it
rather than failing silently.

Settings → Playback shows the last six player events (`start`, `ended`, `end-guard`,
`advance`, `error`, `lock`, `unlock`, `play-blocked`) with track ids and whether the source
was a blob or a stream. That is the only way to diagnose a failure that happens with the
screen off.

Media Session metadata goes to car displays, and `previoustrack` restarts the current track first (past three seconds), then steps back on a second press.

Library JSON is gzipped (`/api/tracks` is 870 KB raw, 142 KB compressed). On a phone that is the difference between a usable app and a slow one.

## Home masthead and micro-interactions

The greeting is a session report: day and time, city, a one-line greeting with the name
inline (late hours get "Still up,"), the last track as a sentence with its BPM and key as
chips, Flow as a transport key and Resume when a queue survived. Below it, picks come from
`GET /api/home/picks`: artist of the week, more from the last artist, same key, same
tempo, worn out, never heard. The reason is the point; a pick with no argument is a
billboard. The phone keeps the first pick as a full-width row (two clipped tiles said
nothing); the three library counters that used to sit under it are gone — the sidebar
pill and Settings already carry those numbers.

Motion is small and purposeful: a light runs the top edge of the Flow key on hover
(`.beam`), a lens ring opens from the pointer on every press (`.ripple`), the assistant's
thinking state is a three colour orb, and context menus arrive through a short goo blur.
All of it is off under `prefers-reduced-motion`.

## Mobile start time

Three things made a phone wait before the first note, and all three were measured with
the network throttled to 400 kbps and 150 ms.

- **The moov atom was at the end of 583 of 725 m4a files.** The player has to fetch the
  tail of the file before it knows what it is holding: an extra round trip and a partial
  download per track. `transcode.toFaststart` rebuilds the container with the index first
  (`-c copy`, no re-encode) and every file has been through it. New downloads get
  `--postprocessor-args ffmpeg:-movflags +faststart`, and the transcoder writes it too.
- **The home page competed with playback.** Ninety requests, mostly covers, were in
  flight when a thumb hit play. The rails below the fold now wait for a scroll or six
  quiet seconds, and a `playing` event cancels the timer; the playlist grid shows twelve
  plus a link instead of forty-one.
- **The prefetch gate was too strict.** It wanted twelve seconds of slack before warming
  the next track, which never happens on a thin link, so every change was a cold start.
  Six seconds is enough.

Measured on the same throttle: first play 7.9 s -> 3.4 s, and the tail request is gone.

At 390×844 the first record starts at 334px (40% of the screen); at 360×640 a shorter
mast keeps it at 300px (47%), down from 353px (55%). The design gate now runs that size
too, so a phone regression cannot pass by being smaller than the phone it was tested on.

There is no empty transport on first load: until something is queued the desktop player
row collapses, instead of showing a grey bar with `…` and `0:00`.

## Format compatibility

Rekordbox and Traktor both open `.mp3`, `.m4a` (AAC), `.wav`, `.aiff` and `.flac`, so the exporter passes them through untouched. Anything else — webm, ogg, opus, wma, an mp4 container — is unplayable in both and is converted by `core/transcode.js`: AAC 256k in an m4a by default (`transcode_format` setting), MP3 320k on request, and AAC that only needs a new container is copied, never re-encoded. A lossy source is never inflated past its own bitrate. The original file is replaced and the row is repointed, so the library, the playlists and the export all see the same track.

`GET /api/maintenance/transcode` reports the count, `POST` runs them one at a time in the background (ffmpeg competes with streaming and analysis on a Pi). Prep shows a "Make N playable" button whenever the count is above zero.

## Endpoints

Web: `GET/POST /login` (shared-secret login page, when `MUSICFY_TOKEN` is set).

Library: `GET/POST /api/playlists`, `GET/PATCH/DELETE /api/playlists/:id`, `POST /api/playlists/:id/tracks`, `DELETE /api/playlists/:id/tracks/:trackId`, `GET /api/playlists/:id/export.m3u`, `GET /api/playlists/:id/zip`, `POST /api/playlists/:id/download`, `GET/POST/DELETE /api/tracks`, `POST /api/tracks/:id/download`, `GET /api/tracks/:id/file`, `POST /api/tracks/:id/cover`, `GET /api/cover/:id`, `GET /api/group/:type/:name`.

Discovery: `GET /api/search/ladder?q=`, `GET /api/ladder/stream/{youtube,soundcloud,generic}`, `GET /api/prewarm/:id`, `POST /api/ladder/download`, `GET /api/jobs/:id`, `GET /api/downloads`, `POST /api/downloads/:id/retry`, `POST /api/downloads/:id/cancel`, `POST /api/downloads/retry-failed`, `POST /api/downloads/cancel-all`, `POST /api/downloads/clear-failed`, `GET /api/health/rungs`.

Maintenance: `POST /api/mirror/spotify`, `POST /api/mirror/track`, `POST /api/history/scan`, `POST /api/history/materialize`, `POST /api/maintenance/repair`, `GET /api/maintenance/duplicates`, `POST /api/maintenance/dedupe`, `POST /api/maintenance/dedupe-files`, `POST /api/tracks/:id/unlock`, `POST /api/covers/fill`, `GET/POST /api/settings`, `GET /api/llm/status`, `GET /api/update/status`, `POST /api/update`,  `GET/POST /api/soundcloud/token`, `GET /api/docs` (generated list), `GET /api/stats`.

## Web app notes

The interface is English and Brazilian Portuguese. `web/i18n.js` translates exact
interface strings after each render and through a MutationObserver; it never walks the
track title, artist, album or playlist-name nodes. The browser language selects Portuguese
automatically, and Settings → You → Language stores an explicit choice. `GET/POST /login`
is the shared-password page used when `MUSICFY_TOKEN` is set; it sets the same HttpOnly
cookie as the query-token route.

`web/app.js` is a single file: `api()` wrapper with a read cache (`nocache: true` bypasses it, call `bustCache()`/`afterWrite()` after mutations or the UI shows stale data), `state` object, one `render*` per view, `playAt`/`playList` for playback, `refreshView()` which must know every view, `openCtx` for the track menu, `openPlaylistMenu` for playlists, `renderDownloads` for the queue panel.

Delete a track: the row is removed from the DOM immediately, the API deletes row and file, `refreshView` rebuilds the view. Playback is untouched by refresh because the audio element lives outside the rendered views; deleting the playing track keeps it playing and fixes the queue index.

## Typography

The interface ships **no web font**. `body` and the label token use the native stack:

```
system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

Reasons, in order:

- Safari Lockdown Mode blocks web fonts. A bundled font silently falls back to the system
  face there, so the app looked different per browser and for no visible reason.
- A font is one more asset to version, cache and debug. The service worker once held an
  old font response, which made every heading render at the Light default.
- Native faces are better hinted and read correctly at 10 px labels.

Weights stay at 600/700/800, so every OS picks a real face instead of synthesising one.

If a brand font is ever required, add **static** 400/600/800 files (not a variable subset),
version every URL (`?v=N`), and let the service worker's stale-while-revalidate path handle
`/fonts/` as well. Do not reintroduce an unversioned `@font-face` source.

## Guided actions

`/api/agent` never mutates on the first turn. A mutation intent (playlist, album, missing
audio) returns a proposal and an action id; the client shows the tracks and reasons, then
calls `POST /api/agent/action/:id` with `{confirm:true}` or `{cancel:true}`. Proposals expire
after 15 minutes. Read-only intents (`report_library`, `search_tracks`) still answer directly.

Playlist proposals come from `core/mood.js`, not from the catalogue: rows are scored on
style family and BPM, mood (key/scale/BPM/energy), reference artist profile, then your plays,
likes and playlist presence, with a small bonus for unplayed tracks. A style with a tempo
range filters the pool; a reference artist with a known family stays in that family even if
the result is short. The proposal says why and says when it is short.

## Timers

`musicfy-core` always on, `musicfy-history-scan.timer` daily at midnight, `musicfy-backup.timer` daily at 03:30 writing `VACUUM INTO` snapshots to the backup disk with seven day retention, and `musicfy-audio-backup.timer` daily at 04:15 mirroring the owned audio to a second disk. Audio was not backed up before the incident above, which is why the loss mattered.

## Search, and why it was bad

The plain YouTube Music search returned only ids and titles. There was a second
`searchYouTubeMusic` further down `core/ytdlp.js` that shadowed the improving one, so every
candidate arrived with no artist and no duration. Scoring and the artist gate then had nothing
to work with, which is why results never came from the actual artist.

Fixed:

- One definition only. The flat listing is followed by real per-video extraction
  (`--print artist/duration/channel/album`) for the entries whose titles best match the query,
  six to eight of them, in parallel. A search now costs about 6 seconds and returns artist,
  duration and channel per hit.
- Artist agreement is scored: +12 per overlapping word, -22 when the candidate knows its artist
  and shares nothing with the query. When at least three candidates match the artist, others are
  dropped unless they score 45 or more.
- Remixes, bootlegs, edits, flips, VIPs and covers get -30 unless the query asks for one.
- The top three results are verified against MusicBrainz and carry `isrc`, `duration_delta` and
  `verified` (delta of 4 seconds or less) through to the client.

Verified: `burial archangel` now returns the YouTube Music hit with artist Burial, duration 238,
ISRC GBLZC0700013, verified true, delta 0. `djrum blue violet` returns the Djrum upload at 519 s.

Remaining gap: MusicBrainz has no ISRC for some releases (Floating Points Kuiper returned
nothing), so ISRC is present when the release is catalogued there and absent otherwise.

## Search layout

Search now answers in three sections, like a music app rather than a scrape:

- **Artists** and **Albums** from the catalogue (iTunes), clickable to refine the query
- **Songs**: up to 40 catalogue tracks with real duration, album and family, each with a
  download arrow that resolves audio through the ladder by title and artist
- **Ladder**: open web sources that match, with the catalogue line and VERIFIED badges

The sections render even when the ladder has nothing, because the catalogue is the useful part
for obscure or foreign releases. Verified with `pinkfong`: 6 artists, 12 albums, 40 songs,
starting Baby Shark, Head Shoulders Knees and Toes, Baby T-Rex.

## Streaming (SoundCloud)

Piping yt-dlp into ffmpeg and straight to the browser does not work inside the service: it
produced zero bytes and, before the crash guards existed, killed the process mid request. The
working design is file based: fetch once into ``<os.tmpdir()>/musicfy-sc/<key>.mp3`` and stream that file
while it grows, reading in 256 KB chunks and ending when the fetch finishes and the reader
catches up. A second play serves the cache with range support.

Measured: first play delivers the first byte in 20 ms and the full 7.5 MB / 281 s track, second
play is instant. Cache files under 100 KB are ignored so a truncated fetch cannot be served.

Also added: `process.on('uncaughtException')` and `unhandledRejection` handlers, and error
listeners on every stream in the chain. A broken pipe used to take the whole service down,
which is what made streaming look broken and made downloads stop without explanation.

## Identity: what a query actually is

`core/identity.js` resolves artist and title to one canonical record using the iTunes search
API: exact duration, album, year, and a coarse genre. Free, no key, about 300 to 600 ms per
lookup, cached on disk for 30 days.

Why iTunes rather than MusicBrainz: MusicBrainz is the ISRC source but rate limits hard and
answers 503 to bare multi word queries and to bursts. Tested directly: `query=burial archangel`
returned 503 while `query=recording:"Archangel" AND artist:"Burial"` returned 200 until the IP
was throttled, after which everything returned 503 for minutes. iTunes answered every query in
half a second, so it is the primary oracle and MusicBrainz stays optional for ISRC.

What it changes: search asks for the canonical record first, then marks every candidate whose
length is within four seconds as `verified`, and the UI shows a catalogue line (artist, title,
album, duration, family) above the results plus a VERIFIED badge per row.

Verified on `burial archangel`: catalogue line `Burial - Archangel, Untrue, 3:58, electronic`,
four rows marked VERIFIED with a delta of 0 to 2 seconds.

`POST /api/identity/fill?limit=` backfills genre, album, year and duration for tracks missing
them. `GET /api/identity/canon?artist=&title=` returns the record for one lookup.

## Genre tagging

`core/genre.js` asks MusicBrainz for the artist's tags, caches them on disk
(`/opt/musicfy/data/genre-cache.json`), and writes `tracks.genre` (the most used tag, e.g.
"future garage") plus `tracks.genre_family` (one of metal, electronic, hip hop, jazz,
classical, rock, folk, soul, reggae, pop). One request per artist, 1.5 s apart, with backoff
on 503 and no permanent cache entry for throttled failures.

`POST /api/genre/run?limit=&all=1` fills in the background and loops until every artist is
done; `GET /api/genre/status` reports coverage and the family histogram. The Songs view shows
a genre chip per row, a Genres browse card, and a "Fill genres" action.

Family is used by the query engine, so "electronic tracks between 120 and 130 bpm" works.

Known state: coverage grows at roughly one artist per 2 seconds because of MusicBrainz rate
limits, and the library is overwhelmingly electronic, so the histogram is dominated by that
family until more varied material is added.

## Agent scope

`/api/agent` handles four intents: `search_tracks` (find songs in the whole library, not only
what is in playlists, plus catalogue matches), `build_playlist`, `download_missing` and
`report_library`. The Ask tab routes verbs (create, find, show, download, how many) to the
agent and plain questions to the query engine. Verified: "find techno tracks I never played"
returned 7 library tracks and 10 catalogue matches, rendered as rows in the UI.

## Mobile layout

Filter pills wrapped badly on phones because `.mode-tabs` was a single unwrapped flex row, so
six sort options ran past the screen edge. `.mode-tabs` now wraps with row gaps, chips shrink to
half width under 760 px, and `.mode-tab` never wraps its own label. Measured at 360 px across
Library, Songs and Search: page scroll width equals viewport, zero overflowing rows.

Genre cards now apply a real filter through a shared `renderGenreView`, with a Clear button, and
the filter is cleared when leaving Songs so it cannot leak into Search.

## Interface hierarchy

One accent fill per view: the primary action. Filters, sort controls and segmented tabs are an
elevated neutral surface (`--bg-elev2` with `--fg`), and card play discs are neutral on touch.
The top bar names the page. Library and Search start with their toolbar; Playlists, Settings
and A&R open with a one-line `.page-hero`, never a kicker or a second title. Library is four ways in (Artists, Albums, Genres, For you) plus a Tools menu for import,
upload, recent downloads and the BPM sort; the first track row is at 247px on a 1440x900
desktop and 342px on an iPhone 13 (about half the visible height), down from 467 and 578. The player bar stays hidden until
the first track starts, and A&R opens with three steps instead of an empty canvas.

## AI features (all four, working)

**1. Metadata repair.** `core/repair.js` compares a track against the catalogue and proposes
title, artist, album, year and genre fixes with reasons. `GET /api/repair/:id` previews,
`POST /api/repair/:id/apply` writes. It refuses when the corrected title and artist would
collide with another row, and it keeps `dup_key` in step. Verified: Archangel had album
"Burial", proposed "Untrue", one field corrected.

**2. Conversational follow-up.** `/api/ask` accepts `previous` filters. A short message is
treated as a delta: filters carry over, only what the new words change is replaced, and
"make it 5", "more", "fewer" adjust the limit. Verified: "tracks in Dm" returned 22 with
limit 50, then "make it 5" returned 5 with the D minor filter intact, source `followup`.

**3. Multi-step agent.** `core/agent.js` executes three intents: `build_playlist`
(query, count, download), `download_missing`, `report_library`. The model only picks the
intent and its arguments, it never touches the database or runs code, and a local planner
takes over if the endpoint is slow. Verified: "create a playlist of 10 pinkfong songs" built
one with 10 catalogue tracks; "how much of my library has audio" answered with counts and
families.

**4. Recommendations from current listening.** `core/recommend.js` scores the library by
co-listening edges from the historical graph, genre family match against what is played in the
window, tempo proximity to the current average, harmonic key compatibility, and "never played"
bonuses. Tracks played twice in the window are excluded so it does not just repeat the rotation.
`GET /api/recommend` returns the profile and picks with reasons, `POST /api/recommend/create`
writes a playlist. Verified profile: 518 plays, electronic, 124 BPM, picks scoring 54.

Plays are only counted after 30 seconds or half the track, so the recency input is honest.

UI: "Fix metadata" in the track context menu, "For you" in Songs builds the playlist from
what is being played now, and the Ask tab keeps context between questions.

## Ask: three outcomes, not one

Ask is one box with three kinds of answer, and the difference matters:

- **A question** ("how much of my library has audio") gets a sentence and, when it is about tracks, the rows behind it.
- **A build** ("create a playlist of 10 ambient tracks") gets a draft under the sentence: the mix of tracks you already own and tracks from outside, each tagged LOCAL or NEW, with **Create + download N** / **Playlist only** / **Cancel**. Nothing is saved until you pick one.
- **A discovery** ("find 8 tracks like Burial that I don't have") gets a draft of tracks from outside the library, tagged NEW, with **Download N**. "Like Burial" is resolved as the *artist* through iTunes (`identity.artistSongs`), not as the word in a title.

**Briefs go to the model.** A request that names a person, an age, an occasion or several
likes ("a playlist for my 5yo daughter, she likes unicorns, robots and Imagine Dragons") is
read by the model into `{artists, themes, allowExternal}`, because the rules planner only
hears verbs. `themes` are search phrases a catalogue can use ("unicorn song for kids"), not
the words from the sentence. If the model is unreachable the rules plan still runs; the call
is capped at 9 seconds and only fires for briefs or coverage questions, so a simple command
never waits on it.

**Follow-ups work on the draft.** A short instruction after a draft ("make it 30 tracks",
"no Imagine Dragons", "only from my library", "darker") is applied to the previous plan
instead of being parsed as a new request: the browser sends the last `{question, plan}`, and
`mergePlan` handles count, scope and exclusions deterministically. Anything about mood goes
to the model with the old plan in the prompt. A brief that says "don't limit yourself" keeps
at most 60% of the slots for the library, so "20 local, 0 new" cannot happen again.

`briefFill` then splits the outside slots between the named artists and the themes, taking
them in turn so a two-subject brief gets both, and keeps only theme results that actually
mention the theme. The draft is named after the brief ("Unicorn, robot · Imagine Dragons"),
not after the sentence.

A genre the library does not use no longer empties the result: ask for "ambient" in a library tagged electronic and the style decides, keeping the tempo filter only where BPM is known. Instructions ("include some I don't have") are stripped before anything is used as a name.

## Asking the library questions

`core/query.js` turns a sentence into SQL. It is deterministic, offline and instant, and it is
the primary path: key, scale, BPM range, year or decade, genre, owned, play count, ordering and
free text. `POST /api/ask {q, create, name}` returns the filters it understood (as `notes`), the
matching tracks, and, when `create` is true, a new playlist built from them.

### Language model: with and without

A&R is the only feature that can use a model. Everything else works without one: playback,
playlists, downloads, covers, metadata, Prep, exports and statistics.

**With an OpenAI-compatible endpoint** (`data/llm.json`, or Settings -> Model endpoint):

- `core/llm.js` posts the sentence to `/v1/chat/completions` and expects JSON. The model
  sees the sentence and nothing else: not the library, not the files, not the history.
- `core/agent.js` builds the plan prompt (schema, rules and examples in the request
  language), asks for `response_format: json_object` and retries twice inside a 45 s budget.
  The answer is `{intent,args}`: `build_playlist`, `search_tracks`, `artist_albums`,
  `download_album`, `download_missing`, `report_library`.
- The server executes the plan. A mutation is a proposal until a human confirms
  (`POST /api/agent/action/:id`). The model cannot write to the library.
- What it adds: briefs by person, age or occasion ("birthday for a 7 year old who loves
  dinosaurs"), vague mood follow-ups ("something darker"), and Portuguese phrasing that is
  not a command.
- Settings probes it with a tiny completion and shows a green, red or grey dot. `http://` is
  accepted only for a localhost/LAN model; a remote endpoint must be `https://`.

**Without an endpoint:** the local planner (`core/agent.js` `planLocally`, with
`core/query.js` normalising Portuguese) reads explicit requests and returns the same
`{intent,args}` shape:

- counts and coverage, genre or family, key ("em Dm"), BPM ranges, years, play counts,
  "never played", "not downloaded", "by X", "based on X", "in the style of X", albums,
  downloads;
- no network call, deterministic and fast;
- it will not invent a theme for an occasion, read a long brief, or follow "make it darker"
  without the previous request.

Capability questions ("what can you do") and audio coverage are answered before the planner,
deterministically, with or without a model.

**When the model fails** (timeout, empty completion, unusable JSON) the rules answer and the
UI labels the result `local`; the request is not lost. The acceptance check is
`npm run ar:check`: five real sentences, must return tracks.

UI: Search has an Ask tab. It shows the understood filters as pills, marks whether the answer
came from the model or locally, warns when a filter was dropped, and offers "Create playlist
from these N".

## Listening capture (feeds recommendations)

A play is recorded only after it actually played: 30 seconds, or half the track if shorter,
with the real milliseconds played. Before this the client logged a full-length play the moment
playback started, which inflated history and would have poisoned any recommender.

`GET /api/listens/recent?days=30` returns per track play counts with genre family, BPM and key,
which is the current-taste input. The long history tables (`spotify_plays`, `taste_tracks`,
`play_edges`, 175k plays to 2023) are the historical input. A recommender should blend both:
recent listens weighted far above old ones, so recommendations follow what is being played now
rather than what was played in 2019.

## Audio analysis (BPM, key, loudness, energy)

`core/analyze.py` runs on the Pi with librosa. `core/analyze.js` batches it, two or three
processes at a time, and writes `bpm`, `key`, `key_scale`, `key_confidence`, `loudness`
(dBFS) and `energy` into `tracks`.

Measured on this box: 36 seconds per track for 10 to 11 minute club tracks, which is about
3.6x slower than real time. A 335 track library therefore costs roughly 3 hours single
threaded, or about an hour with three workers. Memory is small, one process peaks around
300 MB. The song list shows BPM and key once analysed.

Endpoints: `POST /api/analyze/run?limit=&workers=&mode=never|outdated` (batch) and
`GET /api/analyze/status`. `POST /api/analyze/track/:id` analyses a single track on demand,
so only the tracks you actually play live need BPM and key, and only those feed a Rekordbox
export. The row context menu has an "Analyze BPM & key" action for this.

### Freshness: what "analysed" means

The analyser writes a version with every result (`ANALYSIS_VERSION`, currently 2: BPM, key,
beat grid, sections and energy10). Bumping it is how a new kind of data becomes visible
without pretending the old rows have it:

| state | meaning |
|---|---|
| current | analysed by v2, sections included — this is what "up to date" means |
| outdated | analysed by v1: BPM and key are valid, but there are no sections, so cues are missing |
| never | no analysis at all |

`GET /api/analyze/status` returns `version`, `total`, `current`, `outdated`, `never`,
`prepped` and `sections`; the three states always add up to the total. Prep only counts
**current** tracks as prepared, so a playlist analysed last month shows "13 without
sections" and an *Update 13* button instead of a false "ready". Re-analysing is per
playlist: the normal Prep run selects never-analysed, outdated and grid-less rows; the
Re-analyse button (`force=1`) redoes every owned track.

### Playlist role: DJ set or listening

`playlists.kind` is `listen` (the default for every new playlist) or `dj`. Prep is a DJ page: it lists only `dj`
playlists, and a listening playlist is never analysed, never shows a prep control or an
export button. The switch lives in the playlist header; the Playlists index marks the
listening ones with a `· listening` note. `PATCH /api/playlists/:id` accepts `{kind}`.
An installation that only wants to play music can mark everything listening and Prep
stops asking for work that will never be needed.

Essentia itself does not install here: there is no wheel for this Python version and the
source build is slow. librosa covers BPM, key, loudness and energy without compilation,
which is why it was chosen. Genre tags are not produced; they would need a model, and
Essentia on another machine.

To spread the work across several machines, the missing piece is a small worker that accepts
a file path and returns the same JSON. The analyser already talks JSON lines, so a worker is a thin
wrapper, and `analyze.js` would post to it when configured and fall back to local otherwise.

## DJ export (Rekordbox, Traktor)

`GET /api/playlists/:id/export.zip?format=rekordbox|traktor` builds a self-contained set:
a folder `MUSICFY <playlist>/` with `audio/` (the actual files, copied), the `rekordbox.xml`
or `traktor.nml`, `playlist.m3u8`, and a `README.txt`. The XML `Location` points into
`audio/`, so after extracting the user relocates to that folder in one action (Rekordbox:
Import Collection → Relocate). Cues are hot cues (rekordbox `Num` 0–7) taken from the
analyser's downbeats, every 16 bars. `Tonality` carries the key for harmonic mixing.

There is also a bare `.../export/rekordbox.xml` and `.../export/traktor.nml` for scripting.

## Bandcamp, verified blocked from this network

- `bandcamp.com/search` is unsupported by yt-dlp, by design
- track and album pages answer with a 3 KB challenge page instead of real HTML from this
  network, both from the Pi and from the Mac, so `tralbum` data is never present and
  yt-dlp fails with "unable to extract tralbum data"
- the module is kept but disabled. If a URL ever resolves from outside this network, the
  generic yt-dlp rung can download it

## Album covers

`/api/cover-album/:name` serves the first track's cover on that album, extracting it from
the file if needed, then a generated letter tile.

Lookup is exact: `covers.artworkForAlbum()` asks Deezer's album search first (it returns
the artist with the title, which a one-word album like *Green* needs), then iTunes, and
requires both the album title and the artist to match. It no longer falls back to
"whatever the search returned first" — that is how a Forbidden album got another
record's cover.

`covers.artworkFor()` is the per-track fill used by **Fix covers**: it tries iTunes, then
Deezer, and accepts the first result whose title matches. A catalogue hit that cannot be
downloaded or converted is reported as **could not be saved**, separately from **no match**,
so a missing ffmpeg or a read-only data folder is not blamed on the catalogue.

The album page has **Choose cover**: `/api/albums/:name/cover-options?artist=` returns the
matching Deezer scans, and `POST /api/albums/:name/cover {url}` applies the chosen image to
every track on the album (same 600px JPEG on disk, `has_art=1`). Only catalogue image hosts
are accepted, and `fetchBuffer` caps a remote image at 15 MB.

## Playlist covers

`/api/cover-playlist/:id` walks the playlist in order, takes the first track artwork it can
produce, whether or not that track still has a local file, then falls back to the art saved
at mirror time, and finally generates an SVG letter tile so a card is never blank.

## Incident log

**2026-11-19, dead download queue and year 58853.** The transcode ingest did `fs.statSync(dest).size` unguarded; when ffmpeg produced no file the throw landed inside the `execFile` callback, so `finish()` (and the concurrency-slot release) never ran. Three jobs froze at 99% for 6.4 hours with no child process, and 49 sat behind them. The recovery watchdog was dead code: it queried `jobs.updated_at`, a column that never existed, and the `catch {}` swallowed the error every 60 seconds. Separately, the WNL playlist import wrote `Date.now()` (milliseconds) into the seconds-column `added_at`/`updated_at`, so 182 rows rendered as `Aug 16, 58853`.

Fixed: the `execFile` callback is wrapped so a throw always calls `finish('error')`; a real `jobs.updated_at` column is written on every progress tick and the watchdog reaps stuck jobs and releases their slot; the import uses `now()`; a boot migration divides any `>1e12` timestamp back to seconds.

**2026-11-12, self-inflicted library loss.** A new repair endpoint used `execFileSync` without
importing it. Every ffprobe attempt threw, the code read that as "unreadable", classified all
335 owned files as broken and deleted them along with their file rows. 331 downloads were
queued with an empty artist field, so most failed to match.

Recovered: 4 files from `/opt/musicfy/pilot.zip`, then a further 64 from the WNL-DL library,
which is intact at `~/Music/wnl-dl` and served live by WNL-DL at
`http://<wnl-host>:8742` (`GET /api/library`, `/api/library/tracks/{folder}`,
`/api/file/folder/{folder}/{filename}`). That source should always be checked first after any
library damage: 301 files, 3.6 GB, tags intact. The rest were re-downloaded through the free rungs,
which means most are now 160k AAC or mp3 rather than the originals.

Guards added so this cannot repeat:

- `execFileSync` is imported, and the repair pass skips any file whose duration cannot be read.
  An unknown reading is never treated as damage.
- The pass aborts with 409 when more than 20 percent of the library looks broken, on the theory
  that the check itself is at fault.
- Every download now refuses truncated audio at ingest: if the finished file is shorter than
  60 percent of the declared duration it is discarded and the job errors out.
- `POST /api/maintenance/repair-duration` is the supported way to sweep broken files.
- `verifyFiles()` (boot + `POST /api/maintenance/verify-files`) now aborts when more than 20% of
  file rows are missing, so a down removable mount can never be read as "every file is gone".

## Backups

Source archive `backups/musicfy-src-<stamp>.tar.gz` on the Mac and in the Pi backup directory with matching sha256, plus the nightly database snapshot. Verify a restore by extracting into a scratch directory and running `node --check` on `core/core.js` and `web/app.js`.

## Known issues, next steps

1. Search page still reads poorly: four sections (artists, albums, songs, web sources) with no
   clear statement of what each does. Ranking is unchanged underneath the new layout.
2. Two monoliths: `core/core.js` about 2,700 lines and `web/app.js` about 3,000. Duplicate
   route paths and duplicated markup exist, and have caused real bugs. Module split is the
   highest value refactor.
3. Import is Spotify-only and single track. Playlist import with platform auto-detection is
   not built.
4. The Ask view understands five intents and cannot chain them. Custom system prompt is not
   editable in Settings.
5. Streaming: SoundCloud previews are detected and swapped for the full YouTube track, but a
   true crossfade and gapless playback are not implemented.
6. Analysis is automated but basic: no downbeat, no beat grid, no ReplayGain tags written into
   files, so other players will not match the levels set here.
7. ISRC coverage is partial; MusicBrainz rate limits the per recording lookup.
8. Lyrics, scrobbling, queue drag reorder and offline pins are not built.
9. Library has a small number of tracks without audio; `GET /api/downloads` reports the count.

## Rules that must not be broken

- Spotify is metadata only. There is no playback path through Spotify and none may be added.
- Internet exposure only through an authenticated reverse proxy or VPN.
- No paid services, and no paid source rung. Only free sources and optional free-account tokens.
- The LLM endpoint is optional and free to omit; A&R's rules planner is the baseline, not a fallback bolted on.
- Always take a source and database backup before modifying code.
- No emojis in the UI, no em dashes in anything user facing, no marketing copy in the interface.
