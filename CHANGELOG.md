# Changelog

## 0.8.1 — 2026-11-27

- **Covers are covers again.** On a touch screen the play disc is removed from album,
  playlist, track and kids cards instead of being pinned to the artwork. It stays a hover
  and focus affordance on a pointer. A track card plays when pressed; a playlist or album
  card opens.
- **In a list on touch, one control in the gutter**: the row's play button takes the index
  column, and the floating disc that sat over the artwork in ladder rows is gone. The
  numbers are hidden on touch, where they were never the point.
- **A hidden control no longer takes a tap.** The cover discs had `opacity: 0` but stayed
  clickable, so an invisible 44px target sat on every kids tile.
- **Every press answers.** The tap highlight was off and only the Flow key had an active
  state, so a click looked like nothing. Every control now dips in 90ms (0.95 control,
  0.975 card, 0.9 play disc) and a row washes to the raised colour. Reduced motion keeps
  the wash and drops the scale.

## 0.8.0 — 2026-11-28

- **Settings is one system.** A heading (14/600), a note (12/1.5), a label (11/600), a micro
  line (10.5), and 36px fields with 14px text. Cards use their own action row instead of the
  page toolbar class, so the 22px void under every card is gone.
- **Saving is per card and visible.** A clean card has a quiet Save; editing turns it into an
  accent **Save changes**; saving shows **Saving…**; success shows a green check, **Saved** and
  the changed field, then returns to quiet. Only that card's fields are posted, so saving a
  name no longer re-geocodes the city. The button has a fixed width and `aria-live`.
- **Reset is a danger card**, full width, red dot and border, red ghost action, two
  confirmations. It no longer reads as another normal card with an accent dot.
- **The footer is a footer.** Version and state on one line, a text action for updates, and
  the 10.5px credit under it.
- **The Settings icon is sliders**, not the eight-spoke glyph that read as brightness.
- **The heart pops.** A 260ms scale on the button when a like lands, and row hearts are
  visible on touch devices instead of hover-only.
- **Connect a device** appears in Settings when the page is opened on the server: the LAN
  addresses, a `.local` name, click to copy, and the line that the library stays there.
- **Desktop client hardening:** navigation compares origins (a `startsWith` prefix check let
  `https://host.evil.com` pass), and a non-private address must use `https://`.
- The design audit now measures the settings heading, label, note and field roles.

## 0.7.1 — 2026-11-27

- **The kid's name is the identity mark, not a label.** The rail shows her name in a five-stop
  gradient with a soft glow, a slow sheen and a drifting aurora behind it; the age line and the
  initial avatar are gone. On a phone the same mark replaces the tab title in the topbar. Both
  animations stop under reduced motion.
- **Empty sections are removed.** "Recently played" and "Your playlists" no longer print a
  heading with nothing under it; on an empty library the page is the mast, the Flow key and
  the empty-state card, nothing else.
- Verified the narrow mast at 720: the Flow key is present and 56px, the mast 172px, no orphan
  headings.

## 0.7.0 — 2026-11-27

- **The Mac app can be a window to another MUSICFY.** Settings → This app takes an address; the
  shell probes it, saves it, and reloads as that server's client — same library, plays, likes
  and playlists, with audio streamed. The remote page gets no preload, so it has none of the
  local file bridge. The File menu offers **Use this Mac's library**. Switching is in place:
  the relaunch path raced the single-instance lock.
- **Kids mode is the same shell, one size up.** The adult rail and topbar stay: a 240px rail
  with her duotone profile, Home / Lists / Search, and **Grown-ups** at the bottom (the lock
  moves to the topbar on a phone, where the rail becomes a three-item bottom nav).
- **Home is a dashboard.** A mast with the greeting, "You left off on …" and **Mix it up**;
  **Your lists** as 2-up collage cards above the fold; an **Albums** rail and **Artists**
  duotones with **See all**; recent plays in two columns.
- **List and album pages are a split**, 300px sticky cover/action panel plus a 1fr table of
  72px hairline rows, 240px cover and 44px title — the adult playlist header, scaled, with no
  dead right column.
- **Search is a 640px field with a browse state** (lists, albums, artists), not a 1,516px input
  over a blank page.
- The five-stop rainbow wordmark and the white top pills are gone; the brand is the adult
  brand, and colour comes from covers, collages and the name duotone. The play disc is always
  visible where there is no hover.

## 0.6.2 — 2026-11-27

- **"Your rotation" could appear stuck or doubled.** `drawRotation` looked `#rotation-slot` up
  by id when it resumed, so a render that had already been replaced appended its rail into the
  new page — two rails, one stale seed, and the top one never moved. It now captures its own
  slot, draws at most once per slot, bails when the slot is detached, and clears before it
  paints.

## 0.6.1 — 2026-11-27

- **The play button oval is fixed.** `body.kids .main { width: 100% }` matched `.ctl.main` — the
  play button — not only `<main class="main">`. It is `main.main` now. Every `.ctl` is
  `flex: none` with `aspect-ratio: 1`; a unit test fails if the selector comes back.
- **Kids mode is a boundary.** Entering stops playback, clears the adult queue, closes the Now
  Playing sheet, the context menu, the drawers and the palette. The shared player's artist,
  album, add-to-playlist and like actions are guarded; the heart, source badge and add button
  are hidden.
- **Offline no longer becomes the adult app.** The mode is written to `localStorage` and read
  before the first render, and the last kids payload is cached, so an offline reload stays in
  Kids with her shelf instead of the parent's Home.
- **The PIN cannot be removed from inside the room it guards.** `/api/kids/pin` refuses in
  Kids mode and requires the current PIN to change or clear; `/api/kids/exit` is rate limited
  (10 tries, 10 minutes). Settings asks for the current PIN.
- **A phone can enter Kids mode.** The Settings card has **Open Kids mode**; the sidebar entry
  remains for desktop.
- Kids Home renders every album (the header said 15, the grid showed 12).
- Tiles are real buttons with an open overlay and a separate play button, so a list can be
  opened with the keyboard; tabs are 44px and the tile play button is 44px.
- The PIN prompt is a password field.

## 0.6.0 — 2026-11-27

- **Kids mode is the app, not a cage.** Three tabs — Home, Lists, Search — with the player bar.
  Home shows her recent plays, albums and lists; a card opens its own page with **Play all**,
  **Shuffle** and a row per song. Every row is a button, so tapping the cover plays it. Search
  finds her songs by title, artist or album. Albums and lists keep their covers.
- What is gone is adult work, not capability: no downloads, A&R, Prep, settings, delete,
  drag-to-playlist or context menu. The wordmark, cards and rows are the app's own.
- **Artist cards have gradients again.** A name becomes a duotone (two hues 38° apart, dark),
  on the artist card and the artist hero fallback, in the adult interface and in kids. Albums
  and tracks stay neutral: the colour marks identity, not decoration.
- Play buttons are pinned to circles (`flex: none` + `aspect-ratio`). A tight player bar could
  squeeze the main button into a pill; the NPC-shaped oval in the screenshot was that.

## 0.5.1 — 2026-11-27

- **A kid's playlists no longer sit inside yours.** They move into a named, collapsible group
  at the foot of the sidebar — headed by the child's name and a count — instead of a second
  colour in the same `PLAYLISTS` list. Collapsed by default, it remembers being open and opens
  itself when the filter matches something inside.
- Counts follow the split: the sidebar pill, Home's "Your playlists" and the Playlists page
  count only your lists. The Playlists page shows the kid's shelf as its own section.
- The split is deliberate rather than hidden: a parent still has to add and remove tracks from
  those lists, and hiding them would mean handing over the device to curate.
- DESIGN records the two roles: the group is management, the **Kids** entry is use.

## 0.5.0 — 2026-11-27

- **Every settings card saves itself.** The single Save at the bottom of the page is gone; the
  button sits at the foot of the card whose fields you just edited, and its message names only
  what changed there ("Saved · name").
- **Factory reset.** Settings → Reset clears the library index, playlists, plays, likes, jobs,
  covers and the settings, with two confirmations. Audio files on disk, the login and the app
  stay. The first-run flow appears again after the reload.
- The Library folder card says it plainly: a scan **adds**; it does not forget the folders you
  scanned before. That is why changing the folder left the old tracks in place.
- **Mobile footer fixed.** Version and update state share a line, the actions sit beside them
  (below on a phone), and the credit follows at 10px. No more four stacked elements of three
  different sizes.

## 0.4.3 — 2026-11-27

- Settings → **Kids** can now edit the kid's **name** and **age band** inline, without replaying
  the setup.
- The same card lists **every playlist with a switch**, so an existing list made for a child
  moves into Kids mode with one click — no need to know that a playlist has a context menu.
  The context menu (**Use in Kids Mode**) still works.
- The card is ordered by what you come to do: profile, playlist switches, then the PIN.

## 0.4.2 — 2026-11-27

- **Kids is a question in the first run.** The mode screen now asks **Anyone else?** — "Just
  me" or "A kid or teenager". Choosing a kid expands a name and an age band (up to 6, 7–10,
  11–14, 15 and up), and the Kids entry appears from then on even before a playlist is marked.
  The default path is unchanged: one tap and continue.
- **The kid is a person, not a toggle.** Their name sits under the wordmark on the Kids page
  ("Ana · Tap a list to play it."), the Settings card repeats the name and band, and the band
  sets the card size: bigger covers for the youngest, tighter for teenagers.
- **Playful, with a purpose.** The Kids empty shelf gets a gradient drum drawn with the app's
  five-stop gradient, the age and "anyone else" choices are gradient chips, and the track
  count on a kids card carries a small gradient dot. Still no cartoon palette and no second
  theme: the colour lives in the marks, not in the furniture.
- `GET /api/kids` returns the name and band; the settings file is the source (the PIN stays in
  the settings table).

## 0.4.1 — 2026-11-27

- Settings signature: **MUSICFY** is bold on the version line, and `Developed by Roger Lima ·
  WNL` is 10px, still flush left with it.
- The update state is colour, not just words: **green** for up to date, **yellow** for an
  update available or a restart pending, red for a failed check. `warn` is a token now
  (`#ffb454`), so `design-check` covers it.

## 0.4.0 — 2026-11-27

- **Kids mode.** Mark a playlist with **Use in Kids Mode** from its menu and a **Kids** entry
  appears in the sidebar. It opens a page with that playlist as a big card; a tap plays it.
  The sidebar, top bar and bottom navigation disappear, the player bar stays, and the wordmark
  becomes the only colourful thing in the app — the same gradient idea, five stops.
- **The kid's listening cannot reach your taste.** A kids play is written to `kids_listens`,
  not `listens`, so taste, rotation, play history, A&R and Prep — all of which read `listens` —
  never see it. Auto-download is skipped too. `bin/unit.mjs` asserts the branch and that the
  flag comes from the cookie, not from the request body.
- **A PIN to leave**, 4 to 8 digits, stored as a salted scrypt hash. The Settings card says
  what it is: a speed bump for a child, not a lock. Leaving without one is allowed.
- Settings gains a **Kids** card: how many playlists are in it, where to mark more, and the PIN.
- **Run setup again** moved to the top of the You card; it was at the bottom and read as
  missing.
- The Settings credit is now 12px and flush left with the version row, instead of 10px mono
  centred.

## 0.3.7 — 2026-11-27

- **One empty block, not two.** A stale lazy-fill timer from an earlier render looked the
  `#discover-home` id up again and appended a second copy into the page that replaced it. The
  timer now captures its own host and checks it is still in the document, and the render
  refuses to draw twice.
- **The mark is the app's own unit.** A dashed empty cover with a broken waveform in accent
  inside it: artwork and the audio that is missing, in the same stroke language as the rest.
  The level meter did not read as music.
- **New copy.** "An empty library, for now." then "MUSICFY plays files you already own. Add a
  folder with ⌘O, or download one track, and the page has something to say." The browser gets
  the Settings → Library folder variant.
- Settings ends with one inconspicuous credit line: `Developed by Roger Lima · WNL`, 10px
  mono, muted, centred, no border. DESIGN records it as a signature, not a footer bar.

## 0.3.6 — 2026-11-27

- **The empty Home is a block, not a sentence.** When there is no audio, the gap under the
  mast now holds a `.hollow` card: a level meter at zero (two rails, ticks, the needle
  resting at the bottom in accent), "Nothing to play yet.", and one sentence that says where
  the sections come from and where the action is.
- The action is named for the place it lives: **⌘O** in the app, **Settings → Library folder**
  in a browser. No new button, no duplicated scan path.
- The old line, "Nothing to surface yet. Add tracks or play a few, and this fills in.", is
  gone. On a phone the card stacks the mark above the copy.
- `DESIGN.md` records the empty-state contract and bans empty-box/ghost/sad-face art.

## 0.3.5 — 2026-11-27

- **The first-run copy was rewritten.** Deadpan instead of pleasant: "Your music. Not a
  rental."; a name left empty is addressed "like a bank statement"; the city can be skipped
  and you can "live in UTC like a server"; a folder is read in place, not "uploaded to a
  service that will lose interest in two years"; the last screen has "no account to cancel".
  Portuguese was written natively, not translated word for word.
- **Language is the first control.** EN / PT sits in the dialog header, before Skip, on every
  screen. The browser language still decides the first value. Switching saves the screen and
  anything typed, then reloads into the same step.
- The primary button on the first screen is **Come in**, not "Get started".
- `DESIGN.md` gains 5.4 Voice: deadpan, specific, jokes aimed at the industry and never at the
  person, and a banned list of onboarding clichés.

## 0.3.4 — 2026-11-27

- **A guided first run.** Five screens, one question each: the promise (your files, your
  disk, nothing uploaded), your name, your city, how you listen, and where your music is.
  The name screen shows the greeting as you type it; the city is looked up when you leave the
  field and the chip shows the place and time zone it will use; the mode changes the app
  immediately; the folder screen reads a folder in place and counts what it found.
- **Skippable at every step**, with a step counter and a playhead as the only progress. The
  last screen repeats the choices and opens the library. Skipping marks setup done.
- **Repeatable:** Settings → You → **Run setup again** replays it. The first-run card from
  0.2.9 is gone; the overlay replaces it.
- The flow resumes where it stopped if the app is closed halfway: `onboarding_step` is saved
  as each screen is finished. `onboarding_done` defaults to "an install that already chose a
  mode", so existing libraries never see the overlay.
- The city is geocoded once, when the field is left, and the result is stored here; the
  promise on screen says exactly that instead of claiming nothing is ever sent.
- README, INSTALL, DESIGN and DOCS record the flow and the two settings keys.

## 0.3.3 — 2026-11-27

- The **Prep** pill under Resume is gone. The home mast is the greeting, the session report,
  Flow and Resume; nothing else. On a phone Prep is reachable from the command palette, as
  `DESIGN.md` now says.

## 0.3.2 — 2026-11-27

- **Artist pages have artwork.** The 192px square with an initial is now a mosaic of up to
  four of the artist's album covers: one full tile, two side by side, three with a tall left
  tile, four in a 2×2.
- **Albums are cards, not text rows.** Each album shows its cover, the name on two lines,
  and `year · N tracks`; the grid is the same `.pcard` the Library uses. The old chips
  repeated the album names next to the empty square.
- The phone hero keeps a 148px square. It used to stretch to the column, which a mosaic made
  obvious; an album cover on a phone no longer stretches either.
- The colour is the albums' own: a real cover, or the letter tile the album endpoint already
  generates. No hue is invented for the artist.
- DESIGN records the artist hero and the album cards.

## 0.3.1 — 2026-11-27

- The library folder is a **select**, not a path to type: the download folder, the
  configured roots and one level under each, with **Other folder…** for anything else. The
  desktop app keeps **Choose folder** (Finder) as the primary way in.
- The model endpoint has a **model picker**. Once a base URL and key are stored, **Load
  models** asks the endpoint's `/models` and fills a datalist on the field; a gateway that
  does not list models keeps the field free text and says why.
- The endpoint state reads in colour: green when connected, red on an error, muted when
  unconfigured. The sentence and its two actions are one row with 10px of space, so the
  button no longer sits on the text.
- The mobile Settings grid uses `minmax(0, 1fr)`. A single `1fr` column grew to the widest
  child, so a long select option pushed the whole page sideways on a phone.
- `GET /api/library/folders` and `GET /api/llm/models` are the two new endpoints; both are
  documented in DOCS.md.

## 0.3.0 — 2026-11-27

- **MUSICFY for macOS (Apple Silicon).** `node desktop/build.mjs` builds `MUSICFY.app` and
  a DMG from this tree: an Electron window around the same `core/core.js`, with ffmpeg,
  ffprobe and yt-dlp inside the bundle. A friend downloads one file, drags it to Applications, and gets a
  library without Node, Homebrew, Python or a service. First launch needs **Open Anyway**
  in System Settings because the build is not notarized.
- The app keeps its data in `~/Library/Application Support/MUSICFY` and downloads in
  `~/Music/MUSICFY`; a scanned folder is read in place and nothing is uploaded. It listens
  on the first free port in 8790–8809, so a tunnel or server on 8710 is unaffected.
- **File → Add music folder…** (⌘O) opens the native picker, runs the existing folder scan,
  reports the result and reloads. Settings shows a **Choose folder** button in the desktop
  app only; a browser tab keeps the text field.
- The app keeps the Mac awake while a track plays, and exposes no Node API to the page.
- BPM/key analysis is the one component not bundled: the analyser needs a Python + librosa
  environment. Library, playback, search, downloads, playlists and DJ export work without
  it, and the terminal install still creates the analyser.
- `npm run deploy:all` no longer copies `dist/` or `desktop/vendor/` to a host.
- README, INSTALL, DOCS and THIRD_PARTY record the app, its data paths, the bundled
  licenses and the missing analyser.

## 0.2.10 — 2026-11-27

- The minimised player's heart reflects the current track. Starting a track painted only the
  full player bar, so the mini heart kept the previous track's state, or stayed an outline on
  a liked track. All three hearts now come from `paintLike`.

## 0.2.9 — 2026-11-26

- A fresh install asks once: **I am a DJ** / **I am a listener**, stored on the server. The
  store and the Pi already have explicit choices, so they do not see the card.
- A DJ gets a **Prep** link in the Home mast, so the prepared sets are one tap away on a
  phone instead of only through the palette.
- The command palette is context-aware on a playlist: Play, Shuffle, Export for Rekordbox,
  Export for Traktor, plus a Listener/DJ switch. Labels use the playlist name.
- INSTALL, README, DESIGN and DOCS record the first-run choice, the Prep link and the
  context actions.

## 0.2.8 — 2026-11-26

- The design gate is green again: Tools rows are their own `.chip-menu-item` role (30px,
  label only), documented in DESIGN.md, so the audit no longer compares them to 36px actions.
- Artwork placeholders are neutral. `gradFor` no longer invents a hue per track; a missing
  cover is `--bg-elev2` to `--bg-elev` with a muted initial, so real covers are the only
  colour in a rail.
- Settings moved out of the Studio group to the foot of the desktop sidebar, separated.
- Playlists, Settings and A&R use an inline subtitle instead of a headless hero card; Prep is
  the only real hero left.
- BPM and key read at 11px. Palette options expose `aria-activedescendant` and a platform
  hint (⌘K / Ctrl K). Playing-row secondary text uses `--fg-soft` on the accent wash.
- README, INSTALL, DESIGN and DOCS record the DJ default, the Listener switch, the menu role,
  neutral placeholders and the inline subtitle.

## 0.2.7 — 2026-11-26

- Album pages are fetched fresh, and a write clears the cached album and artist pages. After
  Delete the album can no longer reappear from the 90-second GET cache; the confirmation
  button says Delete and the page lands on the Library, where the album is gone.
- A&R album cards treat a partially owned album as a download, not as an Open. An outside or
  incomplete album gets the primary **Download** action and clicking the row queues the
  missing tracks; only a complete album opens. The meta says "1 of 3 here" or "not in
  library" instead of hiding the outside part.

## 0.2.6 — 2026-11-26

- A&R is back in the phone's bottom navigation, between Search and Library. Prep leaves the
  phone bar and remains in the desktop Studio group with A&R; on a phone, A&R is the more
  important destination. The Search A&R chip is removed because the destination is in the bar
  again, and the active tab is exact again (no Search fallback).

## 0.2.5 — 2026-11-26

- Hover and selected pills use a 2px **outer ring** instead of a border. The 2px border grew
  the pill, so hovering a scope or action chip in Search reflowed the row and shifted the
  whole result list. The ring keeps the 2px edge and cannot move anything.

## 0.2.4 — 2026-11-26

- The library pill is hidden on phones. Its counts already sit in the Library stats line,
  and on a 390px header it squeezed the page title to "Libr...". The title now has room for
  the whole word next to the three top-bar controls.

## 0.2.3 — 2026-11-26

- The rounded display stack is removed. The mast greeting, playlist header, crate names and
  Prep title use the same native system sans as the rest of the interface; the rounded face
  read as a different product. DESIGN.md records the decision.

## 0.2.2 — 2026-11-26

- Hover and selected pills use a 2px border at the edge; a 1px bright hairline on a rounded
  pill was rendering jagged at phone scale. The selected Mode, action chips, sort and filter
  tabs, ghost buttons and suggestion chips all follow it.
- The command palette has its own **⌘** control in the top bar; it no longer shares the
  queue/list icon.
- The Flow beam is gone. It ran once and left a frozen highlight at the end; the mast glow is
  static and the thinking orb exists only while a request is running.
- A collapsed sidebar hides the Studio group label instead of mangling it in the 68px rail.

## 0.2.1 — 2026-11-26

- The selected Mode and a focused search field use a 2px accent ring instead of a 1px
  hairline, which rendered rough on the rounded pills.
- A&R opens with **For you now**: eight local picks from `/api/recommend`, cached for five
  minutes, refreshed in the background while the page is open, and replaceable with the
  refresh button. A request hides the row and shows the draft. With no picks, the three-step
  explainer remains the starter. The safety line stays under the row.

## 0.2.0 — 2026-11-26

- **Mode-driven navigation.** Listener has five destinations (Home, Search, Library,
  Playlists, Settings); DJ adds Prep. A&R moved under a **Studio** group in the sidebar and is
  reached from Search on a phone; A&R keeps the sidebar item and the bottom Search tab active.
- **One scoped search.** Search's Include toggles became a Scope control (Both, This library,
  Web) with a namespaced attribute, and playlist hits appear above track results. The Library
  field is labelled as a local filter and hands a no-result query to Search.
- **Command palette** on `⌘K` / `Ctrl-K` and a top-bar button: views, tracks, playlists, Play
  library shuffled and Scan a folder, with arrow/Enter navigation.
- **All native confirm/prompt dialogs replaced** by one in-app `.ask-dialog` (message,
  optional field, Cancel, one accent action). The playback log copies directly instead of
  opening a prompt.
- Playlist Upload moved into the `…` menu with Download and the other secondary actions.
- Motion budget: the mast glow is static, the Flow beam runs once on hover, and the thinking
  orb exists only while a request is running.
- A native display stack (`ui-rounded`, SF Pro Rounded, Avenir Next) for the mast greeting,
  playlist header, crate names and Prep title. No web font.
- DESIGN.md, DOCS.md and README record the navigation, scopes, palette, dialogs, display
  stack and motion rules.

## 0.1.85 — 2026-11-26

- **The selected mode is unmistakable.** A mode switch (Listener/DJ, DJ set/Listening) keeps
  the accent as a soft wash with an accent border and bold text; it is a setting, not a
  filter, and still not a solid fill. Filter and sort chips keep the neutral elevated surface
  with a brighter border and weight. The Mode buttons also carry `aria-pressed`.

## 0.1.84 — 2026-11-26

- **"Fresh in your library" now sorts by when the audio arrived**, not by when the track row
  was created. A download or an upgrade of a track already in the library writes a new file
  row but leaves the track's `added_at` alone, so the rail sat on the original batch forever.
  It now reads the newest owned file per track (`MAX(files.added_at)`), with the track date as
  the fallback. The unplaylisted rail uses the same clock.

## 0.1.83 — 2026-11-26

- Library and Search no longer open with a page hero: their toolbar is the header. The first
  track row is 247px on a 1440x900 desktop (was 343) and 342px on an iPhone 13, about half
  the visible height (was 438, 66%). The one-line hero remains on Playlists, Settings, A&R
  and Prep.
- DESIGN.md and DOCS.md record the rule and the measured positions.

## 0.1.82 — 2026-11-26

- **One accent per view.** Filters, sort controls and segmented tabs are an elevated neutral
  surface; the accent fill is the primary action. Playlist Play is the only orange fill on
  that page, Search's Library/Web toggles are states, and card play discs are neutral on
  touch.
- **Library is content first.** Ten equal chips became four ways in (Artists, Albums, Genres,
  For you) plus a Tools menu for import, upload, recent downloads and the BPM sort. Counts
  have thousands separators. First track row: 343px on desktop (was 467), 438px on phone
  (was 578).
- **The page name appears once.** The top bar owns it; a page hero is one line of context,
  with no kicker and no repeated title. Library and Search lose about 60px of chrome.
- Type: the card artist is the meta role (11px, was the 13.33px browser default), genre, key
  and table labels start at 10.5px, and the title/artist hierarchy is visible again.
- The top bar pill is on Library only (not Playlists or Settings), the back arrow is on
  detail pages only, and static page titles are translated in a Portuguese session.
- The player bar is hidden until the first track starts. Settings cards size to their
  content. A&R opens with a three-step starter instead of a void.
- Playlist cards say "em audição" instead of "· listening", and the playlist header meta
  ("2 precisam de análise") is translated.
- DESIGN.md and DOCS.md record the accent rule, the one-line hero, the toolbar and the
  measured first-row positions.

## 0.1.81 — 2026-11-26

- **A model base URL keeps its path.** OpenRouter serves at `/api/v1`; the endpoint builder
  replaced the path with `/v1` and every request answered 404. Gateways that mount OpenAI
  under a prefix had the same failure. The path the owner typed is now kept and
  `/chat/completions` is appended to it.
- A failed model response says what the provider said (status plus the message body), not
  only `llm 404`.
- A reasoning model is usable. The connection probe accepts a 200 that answered with
  reasoning instead of content, and its budget is 256 tokens; the planner's 2500 tokens is
  enough for a reasoning model (verified with OpenRouter `z-ai/glm-5.3-flash`).

## 0.1.80 — 2026-11-26

- Saving one setting reports one setting. The form was compared against the stored
  settings, where default booleans and selects are absent, so the first save of a time zone
  said "6 settings". The baseline is now the form as rendered.

## 0.1.79 — 2026-11-26

- The "Saved · field" line is built from translated parts, so "Saved · time zone" is
  "Salvo · fuso horário" rather than an English tail.
- INSTALL says that re-scanning an imported playlist replaces its tracks and order with the
  file's current contents.

## 0.1.78 — 2026-11-26

- **A body handler cannot hang the request any more.** Twelve `req.on('end', async …)`
  callbacks were promises the HTTP layer never awaited; one exception left the client
  waiting until its timeout. They all go through one wrapper that answers 500 JSON.
- **The model plan is normalised at the boundary.** `artists: "Aphex Twin"` no longer
  throws, and `download: "false"` no longer downloads. Lists, booleans and counts are
  converted once, for every consumer.
- The model gets one 45 second budget instead of a 20 second attempt inside a 45 second
  race; retries no longer leave orphan requests, and the probe asks for enough tokens to
  survive a reasoning model.
- **Adopted files are never edited.** Verify-files no longer prunes or requeues an external
  file when its drive is away, and transcode and tag writing skip them. The card's promise
  is now true.
- **The NML importer reads Traktor files and our own exports**: numeric node types and
  index primary keys. A round-trip test covers the exporter and importer together.
- Two `playlist.m3u` files with the same name are two playlists; the source path is part of
  the id, and the scan counts distinct playlists. BPM and key from a playlist now reach a
  track that was already in the library.
- Playlist parsing is capped at 64 MB, numeric XML entities decode, and a playlist file
  outside the allowed roots is not read.
- **"Fresh in your library" is actually newest first.** A batch shares one `added_at`
  second, and the old order fell back to rowid; the id now breaks the tie on the rail and in
  the songs table.
- The updater keeps the previous HEAD as `refs/musicfy/update-*`, so a local commit is never
  discarded by `checkout -B`, and a bundle update verifies the published sha256 instead of
  trusting the archive blindly.
- Portuguese: the "Saved · field" status, its field names, and the common server errors;
  the translation gate now also checks text written straight into the DOM.
- A bare tempo filter ("tracks in Dm between 120 and 130 bpm") is a search, not a playlist;
  a Portuguese genre in a prose brief ("10 faixas de samba para uma festa") reaches the
  catalogue search (rules-only A&R check: 5/5).

## 0.1.77 — 2026-11-26

- Portuguese in the discovery headings: "Because you play X" and "NOT IN YOUR LIBRARY" were
  composed at runtime, so the exact-match dictionary never saw them. They have a rule now,
  along with the rail tags.
- Swept the same class of miss: the greeting (Morning / Afternoon / Evening / Late one),
  empty states in liked songs, queue, album and search, the source-loading line, "Show all N
  albums", genre counts, "Download album", "Back to songs", "Copy playback log" and the
  remaining Settings status lines. About 35 strings that stayed English.

## 0.1.76 — 2026-11-26

- **Lock-screen controls act on iOS again.** Play, pause, previous and next used the queue's
  asynchronous path, which reads Cache Storage for a saved track; iOS suspends that read
  while the screen is off, so the press arrived and nothing started. The remote handlers are
  synchronous now: they hand the element the source warmed in memory (or the stream path)
  and start it in the same task. Play rebuilds a source that died during a long lock and
  resumes at the same position. Every remote press is written to the playback log.

## 0.1.75 — 2026-11-26

- **Update now works on an install that cannot fast-forward.** The installer clones with
  `--depth 1`, an older install may sit on a detached HEAD, and a rewritten upstream history
  has no common ancestor; all three made `git pull --ff-only` fail with no explanation. The
  update now fetches the branch and moves to it, which is what `install.sh` always did, and
  it refuses to discard tracked local edits (listing them instead).
- A failed git command reports the reason. The interface used to show only
  `Command failed: git -C ... pull --ff-only`; it now appends the last lines of stderr.
- `musicfy update` uses the same code as the button, so the terminal and the interface
  cannot disagree again.

## 0.1.74 — 2026-11-26

- Settings prefills are generic. The city, genre, artist, listening context and avoid-list
  fields no longer suggest one person's library ("Brasília", "Burial, Overmono, Floating
  Points"), the catalogue-country field starts empty, and the library folder reads
  `/path/to/music` instead of a macOS home. The placeholders are translated as well.

## 0.1.73 — 2026-11-26

- **Settings > Library folder**: point at a folder you already have, or at one playlist
  file, and the audio is registered where it is. Nothing is copied, moved or renamed, and a
  track removed from the library later leaves its file on disk (`files.external`).
- Traktor NML, rekordbox XML, M3U/M3U8 and PLS playlists are imported with their order. The
  BPM and key a Traktor or rekordbox file already carries are kept, so an analysed collection
  does not need to be analysed again; anything missing stays available for the analyser.
- A scan from another machine, or through the proxy, is limited to `MUSICFY_MUSIC_ROOTS`.
  A scan started on the machine itself may read any folder its user can read.
- Download replacement, transcode, duplicate cleanup and track deletion never unlink an
  adopted file: they remove the row and leave the owner's bytes alone.

## 0.1.72 — 2026-11-26

- Library, Playlists, Search, Settings and A&R start with the same header card Prep has:
  gradient, texture, kicker, page name and one line. Prep keeps its meter inside it.
- Mode is a normal card again: heading and switch on the first row, the note below at the
  same left edge as every other card. The note no longer starts under the switch.
- DESIGN.md records the page hero as the shared container.

## 0.1.70 — 2026-11-26

- The interface follows its own rule: no em dashes. 60 occurrences in toasts, notes,
  separators and the Portuguese dictionary replaced with a plain hyphen, and
  `design-check` now fails when one comes back.
- The paid-API rule says what it means: no paid API is required; a model endpoint you run
  yourself (or a free one) and a cookies file from your own YouTube session are optional,
  never required.

## 0.1.69 — 2026-11-26

- A YouTube sign-in request is treated as temporary. When every source fails and YouTube
  asked for a login, the job returns to the queue and retries after 10 minutes, then 20,
  instead of being marked permanently failed.
- README says plainly that a rented server can be asked for a YouTube session, that search
  and metadata still work, and lists only free fixes (cookies, upload from home, SoundCloud).

## 0.1.68 — 2026-11-26

- Duration matching has a ceiling. A track under three minutes gave 60% slack in both
  directions, so a 2:12 song accepted a 3:31 candidate; the rescue sweep used the same
  window. Tolerance is now 25% (max 20s) under three minutes, 8% (max 30s) above it.
- Ingest rejects a file far longer than the declared length (`1.35x + 20s`, `1.6x + 60s`
  for long tracks). Before this, only truncation was rejected and a 3 hour DJ set passed as
  a 4 minute track.
- yt-dlp is not allowed to download past that ceiling, on the search path and the
  last-resort query.
- The title-only rescue requires an artist token in the title or uploader. Without it,
  "Meninas do Leblon" became "Loiraça Belzebu do Leblon".
- The ceiling used on the last-resort path was scoped inside the search branch; moved to
  the function so the fallback cannot throw a ReferenceError.

## 0.1.67 — 2026-11-26

- Settings: "Modo" sits on the same line as its note. The generic card rule gave every
  heading a 12px bottom margin, and inside the Mode flex row that lifted the heading out of
  line. The row aligns on the text baseline, the switch stays centred.
- Every section marker is the same accent dot. The per-card colours (accent, green, grey)
  read as a status when they were only decoration.

## 0.1.66 — 2026-11-26

- Listener mode no longer shows the SOURCE column (Local/YT/SC) or the player's rung badge.
  The column is removed from the grid at every width that shows the table, so the remaining
  columns keep their alignment.

## 0.1.65 — 2026-11-26

- A read after a write cannot come from a cache. `nocache` requests set `cache: no-store`
  on the fetch, JSON responses carry `cache-control: no-store`, and the service worker
  passes those through without storing them. A deleted playlist disappeared from the list
  only after a reload; now the refresh after the delete is honest.

## 0.1.64 — 2026-11-26

- The service worker answered `/api/playlists` (and tracks/likes) from its cache first.
  After creating or deleting a playlist the app re-read the old list, so the change looked
  like it had not happened. Those reads are network-first now, cache only when offline, and
  only for GET. Shell cache moved to `mf-shell-v7`.

## 0.1.63 — 2026-11-26

- Deleting a playlist asks inside the sheet ("Delete playlist" / "Keep it") instead of a
  native confirm, which is invisible in some installed web apps and left the item looking
  dead. Failures are shown ("Could not delete: 403") instead of being swallowed.

## 0.1.62 — 2026-11-26

- The capability panel renders. A help answer carries no `plan`, and the status line read
  `a.plan.intent`, threw, and swallowed the answer. The four examples now work end to end.

## 0.1.61 — 2026-11-26

- "What can you do" renders its answer. The agent returns the capability text as `answer`,
  and the A&R view only read `spoken`, so the chip looked like it did nothing. Its examples
  are shown as clickable prompts.

## 0.1.60 — 2026-11-26

- The draft reason no longer starts with ". ": an empty reason returned a lone period.
- `deploy:all` checks a host behind the token login with the token and accepts either the
  login page (200) or the root page (200) as "up"; it also restarts the systemd unit
  instead of `musicfy restart`, which refuses while the unit is active.

## 0.1.59 — 2026-11-26

- The A&R examples are generic and static: "create a playlist of 20 tracks", "tracks between
  120 and 130 BPM", "how much of my library has audio", "what can you do". The library-derived
  prompts ("10 tracks by <artist from this library>") are gone; on a fresh install they read
  as a bug, and on someone else's they presume taste.
- "What can you do" and the audio-coverage question are answered deterministically before
  the planner, which had been filing them as searches for the words "do" and "library".
- No leading ". " when the mood has no reason sentence.

## 0.1.58 — 2026-11-26

- `deploy:all` prints the asset URL each host serves (`app.js?v=…`); the check's grep was
  escaped wrongly and printed `?`.

## 0.1.57 — 2026-11-26

- `FLEET.md` is the host source of truth: which machine, which ssh name, where the code and
  data live, which local port maps to which host, how each one updates.
- `npm run deploy:all` deploys both hosts and verifies the version and `/` on each;
  `npm run fleet:check` is read-only and exits non-zero on drift.
- The agent instructions now point at `FLEET.md` instead of an rsync line that updated one
  host and hand-edited the asset version.

## 0.1.56 — 2026-11-26

- The home page answers again. It was written with `writeHead` followed by `setHeader`;
  the second call threw inside the route, the error path could not send anything, and `/`
  hung while every API answered. One `writeHead` with the final headers.

## 0.1.55 — 2026-11-26

- The shell's asset URLs carry the running version (`/app.js?v=0.1.55`) and the service
  worker cache name moved to `mf-shell-v6`. After an update the browser fetches the new
  bundle on the next load instead of running the previous one from cache; that stale
  client was still using the old A&R gate on the VPS.
- `index.html` is served with `cache-control: no-cache`, so the versioned URLs are seen.

## 0.1.54 — 2026-11-26

- The A&R view sends every sentence to the agent. Its client-side gate was an English verb
  list, so a Portuguese request fell to the old keyword parser: "crie uma lista de 10
  faixas de Natal" was answered with library tracks tagged Christmas by mistake (Death).
- The Search box routes a request to A&R instead of searching its words. A sentence typed
  there now produces the same draft.
- Verified in the browser, in Portuguese: A&R and Search both return a 10-track Christmas
  draft.

## 0.1.53 — 2026-11-25

- The planner asks the endpoint for JSON (`response_format`) and falls back to a plain call
  if the endpoint rejects it. Empty completions and the long hidden-reasoning delays are
  gone in practice: five prompts ran 5/5 three times.
- `\b` does not sit next to an accented letter, so "forró" never matched the genre list and
  the rules fallback treated it as an artist ("0 de forr"). The boundary is letter-class
  based now; a genre after "de" is searched as a genre, and the fallback returns tracks.
- The model gets 45s for its retries instead of being cut at 15s.
- `npm run ar:check` runs five real sentences against the running instance and fails when
  one produces no tracks.

## 0.1.52 — 2026-11-25

- A&R asks the model to read every request when one is configured, not only the sentences
  a regex guessed were hard. The rules planner is the fallback for a timeout, an empty
  completion or no model. Plans carry genres, themes, artists and allowExternal.
- The real cause of "the model returned nothing usable": the planner ran with
  `max_tokens: 700`, and a reasoning model spent the budget on hidden reasoning and
  returned empty content with `finish_reason: length`. It now gets 2500 and reports that
  case explicitly.
- Genres from the plan are searched in the catalogue alongside themes, each theme filtered
  on its own words; a genre is not treated as an artist ("10 faixas de samba…" returned 0).
- Follow-ups read the sentence together with the request they follow.

## 0.1.51 — 2026-11-25

- `bin/deploy-pi.sh` (`npm run deploy:pi`) deploys the whole app — including
  `package.json`, which carries the version the Pi reports — restarts the service and
  fails if the running version does not match the tree. A deploy that skipped
  `package.json` left the Pi on 0.1.31 while running newer code.

## 0.1.50 — 2026-11-25

- When a storefront returns few albums, Deezer fills them; when it returns no artists, the
  artists named by those songs fill the list. An invalid or empty storefront now returns
  songs, albums and artists instead of an empty catalogue.

## 0.1.49 — 2026-11-25

- The catalogue follows a country instead of always asking the US store. Settings →
  Catalogue country (two letters), empty follows the geocoded city, `MUSICFY_COUNTRY` for a
  server with no city. Applied to searches, artist songs, album tracklists and artwork.
- A storefront that returns nothing no longer means an empty answer: Deezer (keyless,
  country-agnostic) fills the songs, so the catalogue is not iTunes-only.
- Verified: for the same artist, BR and US return different albums, and an invalid
  storefront still returns eight songs from Deezer.

## 0.1.48 — 2026-11-25

- Every remaining native confirm/prompt goes through the dictionary: delete track, delete
  album, delete selection, Traktor tags, analyser corrections, cue-less export, dedupe,
  playlist name for a selection. The browser still draws OK/Cancel.
- Chrome the audit listed: `Play <track>` aria labels, `BUILT FROM <artist>`, On deck,
  shuffle, Hide/Show sidebar, Track options, View/List/Grid/Compact, Seek, Metadata only,
  Press Enter to search, Searching, Sort playlists.
- The library pill is shown only on Library and Settings; it was taking 138px of the top
  bar on every page.
- M3U exports declare `#EXTENC:UTF-8`.

## 0.1.47 — 2026-11-25

- Update status separates the running version from the version on disk. Files replaced
  without a restart now read "Version X is installed. Restart to run it." with a Restart
  now button; `/api/restart` works for a PID-file install and for one started by hand.
- Names are no longer translated: the MutationObserver bypassed the skip list for single
  text nodes, so a playlist called "Home" showed "Início".
- Accents: search folds diacritics on both sides ("abris" finds "Ábris"), duplicate keys
  and identity fold instead of deleting ("Björk" = "Bjork"), SQL text search uses the same
  rule, and "não ouço há meses" is a last-played filter instead of the word "meses".
- Playlist, album and artist headers read "1 faixa" in the source; one GB definition with
  the locale decimal separator; Analyse accepts 1.204 and 1,204.
- A&R names keep accents ("Criar uma lista com faixas…"); "Nothing by X" is Portuguese.
- `/api/ask` answers a Portuguese help question in Portuguese, with Portuguese examples.
- Action buttons (Play 3, Queue 3, Queued 3) and status words are translated.

## 0.1.46 — 2026-11-25

- Installs without git can update. `musicfy update` on a bundle takes the latest release,
  verifies it and swaps the code (previous copy kept under `backups/`), instead of stopping
  at "not a git checkout". Settings' **Check for updates** reports the published version and
  **Update now** applies it; on a PID-file install it restarts itself.
- `bin/update-bundle.mjs` is a standalone bootstrap for installs older than this release,
  which have no release updater to run.

## 0.1.45 — 2026-11-25

- The Portuguese prompt asks for catalogue search themes in English, the language the
  catalogue indexes, so a Portuguese word the metadata does not carry ("galpão") is not
  searched literally. Rules-only requests still search the word they were given.

## 0.1.44 — 2026-11-25

- The catalogue query is built from the normalised sentence, so "10 faixas electronic que
  não tenho" searches "electronic" and returns 10, not 4 from the whole Portuguese sentence.
  "Fora da biblioteca" is recognised on the normalised text as well. English is unchanged.

## 0.1.43 — 2026-11-25

- Portuguese artist names are read from the normalised sentence: "10 faixas de Aphex Twin"
  becomes "10 tracks by Aphex Twin" before the artist is taken, and "álbum mais recente de
  X" is an artist album request like its English form.
- Portuguese briefs are detected as briefs (aniversário, festa, criança, filha, bebê) and
  trigger the child-safe path.

## 0.1.42 — 2026-11-25

- "Based on X" uses X to search the catalogue without hard-filtering every result by that
  word. Only "by X" filters strictly. This keeps English requests such as "music like
  Berghain" from being emptied by a word that is not an artist.
- No English text or behaviour was changed for the Portuguese work: the English prompt is
  the same string, the Portuguese sentences only run when the request is Portuguese, and
  the English path is the default.

## 0.1.41 — 2026-11-25

- The agent answers in the interface language. Every request carries `x-mf-lang`; the model
  prompt is written in that language (same endpoint, same model, same JSON schema), and the
  agent's own sentences come from a Portuguese set instead of being translated afterwards.
- Playlist summaries and reasons are Portuguese end to end ("17 faixas · 0 locais · 17
  novas", "0 de Bedouin na sua biblioteca, 17 novas do catálogo"), as is the report line
  and the "created" confirmation.

## 0.1.40 — 2026-11-25

- "Create a playlist based on Bedouin" now reads Bedouin as the artist. The rules planner
  only understood "by X", so the whole sentence went to the catalogue, which answered with
  nothing and the playlist came back empty. "Inspired by", "in the style of", "no estilo
  de", "baseada em" and "songs like" are read the same way, and descriptors ("electronic
  duo") are dropped.
- When the catalogue is down and nothing came back, the reason says so instead of
  "Nothing new turned up".

## 0.1.39 — 2026-11-25

- The next track's audio is fetched into memory while the current one plays, so changing
  track at the end needs no new connection. This is what a locked phone actually fails at,
  and it works for Flow and radio, where the next track is not known in advance.
- Two tracks of runway at most; a saved track still comes from disk.
- The play log keeps its timestamp again: a position field named `t` was overwriting it.

## 0.1.38 — 2026-11-25

- Audio responses carry `ETag`, `Last-Modified` and `Accept-Ranges`, honour `If-Range` and
  answer `HEAD`. A phone that loses signal can resume the same byte range instead of
  restarting the track or staying paused.
- A system pause while the screen is off no longer cancels the play intent; only an explicit
  pause (button, lock screen, steering wheel) does. Unlocking resumes what the system paused.
- The play log records `waiting`, `stalled`, `suspend`, and whether a pause came from the
  listener or from the system, with the buffer ahead at that moment.
- New `/api/diag/media` keeps the last media requests (range, status, timing), and Settings
  has **Copy playback log**, which copies the client log and the server view together.
- A real PNG icon and the iOS web-app meta tags, so adding MUSICFY to the Home Screen
  produces a proper standalone app; INSTALL.md has a "Playback in the car" section.

## 0.1.37 — 2026-11-25

- Menu headings are translated again. The whole `.ctx-title` block had been excluded as
  user data, which also skipped static headings such as "Use a track's cover". Only the
  name itself (`.ctx-name`) is left alone now, so a playlist called "Home" stays "Home".
- The streaming-result menu is translated: Play now, Add to playlist (stream), Download to
  library.

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
