# MUSICFY handoff

Self hosted music platform on a Raspberry Pi 5. Own catalogue, own metadata, no third party account in the playback chain.

- Host: one Raspberry Pi 5 class machine (Debian 12, aarch64), LAN `http://<host>:8710`, public behind a reverse proxy with SSO
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

- `tracks`: one row per artist and title. `dup_key = normalise(artist)|normalise(title)` with a UNIQUE index, so duplicates cannot be inserted. Album, case, feat blocks, remaster and deluxe suffixes are stripped before hashing.
- `files`: one row per owned file, tier `owned`. One file per track is enforced in the download ingest: the better copy wins, ranked by codec first then bitrate (`fileQuality()`), so a 254k mp3 transcoded from 160k AAC loses to the original AAC.
- `playlists`, `playlist_tracks` (ordered, position), `listens`, `likes`, `resolutions` (which rung served a track and at what quality), `jobs` (download queue: state, progress, detail), `settings` (`auto_download_plays`).
- History: `spotify_plays`, `taste_tracks`, `taste_artists`, `play_edges`, `history_files` ledger.
- Stream only rows carry `src_kind`, `src_id`, `src_url` and no file.

## Source rungs

`yt-dlp` (pinned at `/opt/musicfy/ytdlp-venv/bin/yt-dlp`) resolves YouTube and acts as the generic extractor. YouTube Music catalogue is the primary music source; the plain YouTube video sweep was removed deliberately because it produced random uploaders. SoundCloud and Internet Archive follow. Bandcamp is implemented but disabled, its search answers with a bot challenge from this network.

Filters reject lyrics videos, interviews, documentaries, podcasts, reactions, mixes, full albums, emoji titles, clips under 45 seconds, and for artist queries anything where the artist does not lead the title or own the uploader. Label channels (`- Topic`, VEVO) get a scoring bonus.

`resolveBest()` asks MusicBrainz for the canonical duration, rejects candidates more than 8 seconds away, prefers the closest duration, and carries an ISRC when MusicBrainz returns one.

### SoundCloud specifics

- Streaming: the route `/api/ladder/stream/soundcloud?u=<track url>` downloads the whole track once into `/tmp/musicfy-sc/<key>.mp3` and serves it with range support. Fetching the HLS segment url directly is what truncated playback to about 29 seconds, so do not go back to that.
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

## Playback

`/api/stream/:id` serves owned files with ranges and a private one day cache, and 302 redirects stream rows to the resolved source, cached four hours (`resolveStreamUrl`). The client prefetches the next two tracks with hidden media elements, publishes Media Session metadata for car displays, and skips automatically to the next track when audio errors, after four consecutive failures.

## Endpoints

Library: `GET/POST /api/playlists`, `GET/PATCH/DELETE /api/playlists/:id`, `POST /api/playlists/:id/tracks`, `DELETE /api/playlists/:id/tracks/:trackId`, `GET /api/playlists/:id/export.m3u`, `GET /api/playlists/:id/zip`, `POST /api/playlists/:id/download`, `GET/POST/DELETE /api/tracks`, `POST /api/tracks/:id/download`, `GET /api/tracks/:id/file`, `POST /api/tracks/:id/cover`, `GET /api/cover/:id`, `GET /api/group/:type/:name`.

Discovery: `GET /api/search/ladder?q=`, `GET /api/ladder/stream/{youtube,soundcloud,generic}`, `GET /api/prewarm/:id`, `POST /api/ladder/download`, `GET /api/jobs/:id`, `GET /api/downloads`, `POST /api/downloads/:id/retry`, `POST /api/downloads/:id/cancel`, `POST /api/downloads/retry-failed`, `POST /api/downloads/cancel-all`, `POST /api/downloads/clear-failed`, `GET /api/health/rungs`.

Maintenance: `POST /api/mirror/spotify`, `POST /api/mirror/track`, `POST /api/history/scan`, `POST /api/history/materialize`, `POST /api/maintenance/repair`, `POST /api/maintenance/merge-duplicates`, `POST /api/maintenance/dedupe`, `POST /api/covers/fill`, `GET/POST /api/settings`, `GET/POST /api/soundcloud/token`, `GET /api/docs` (generated list), `GET /api/stats`.

## Web app notes

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
working design is file based: fetch once into `/tmp/musicfy-sc/<key>.mp3` and stream that file
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

## Asking the library questions

`core/query.js` turns a sentence into SQL. It is deterministic, offline and instant, and it is
the primary path: key, scale, BPM range, year or decade, genre, owned, play count, ordering and
free text. `POST /api/ask {q, create, name}` returns the filters it understood (as `notes`), the
matching tracks, and, when `create` is true, a new playlist built from them.

`core/llm.js` can refine that for free form wishes ("a playlist for kids", "trending hard
techno"). It posts the sentence to the WNL endpoint at `/opt/musicfy/data/llm.json`
(`base_url`, `api_key`, `model`) and expects JSON filters back. The model never sees the
library. Its result is raced against a 4 second timer, and when it loses the local parser
answers instead, so a slow provider costs at most 4 seconds and never correctness.

Verified: "tracks in Dm between 120 and 130 bpm" answered in 4.08 s with 15 tracks,
"what tracks do I have in Dm" with 22, and creating a playlist from F#m produced one with 47
tracks. The WNL endpoint itself was answering in 1 to 2 seconds earlier in the session and
timing out at 60 during testing, which is why the local parser leads.

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

Endpoints: `POST /api/analyze/run?limit=&workers=` (batch) and `GET /api/analyze/status`.
`POST /api/analyze/track/:id` analyses a single track on demand, so only the tracks you actually
play live (electronic) need BPM and key, and only those feed a Rekordbox export. The row context
menu has an "Analyze BPM & key" action for this.

Essentia itself does not install here: there is no aarch64 wheel for Python 3.11 and the
source build fails after six minutes. librosa covers BPM, key, loudness and energy without
compilation, which is why it was chosen. Genre tags are not produced; they would need a
model, and Essentia on another machine.

To spread the work across the Macs, the missing piece is a small worker that accepts a file
path and returns the same JSON. The analyser already talks JSON lines, so a worker is a thin
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
- Internet exposure only through Pangolin.
- No paid services, and no paid source rung. Only free sources and optional free-account tokens.
- Always take a source and database backup before modifying code.
- No emojis in the UI, no em dashes in anything user facing, no marketing copy in the interface.
