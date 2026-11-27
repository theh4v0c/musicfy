# MUSICFY design guideline

**Status: binding.** This file and `design/tokens.json` are the source of truth for the
interface. Where this document and any CSS disagree, the CSS is wrong. Nothing in the
visual layer changes without changing this document first. This stays in force until
this document is deliberately changed.

---

## 1. The rule

1. Change `design/tokens.json` (or this document) first.
2. Change `web/app.css` to read the token. Never write a raw size.
3. Run `node bin/design-check.mjs`. It compares the stylesheet to the tokens and the
   built pages to both. It exits non-zero on any disagreement.
4. Only then deploy.

Two consequences worth stating plainly:

- **A value that is not in the table below does not exist.** If a screen needs a size
  that isn't there, the answer is "use one that is", not "add a fourth button height".
- **Two views must be indistinguishable where they share a role.** A filter row on
  Songs and a filter row on Library are the same thing and must measure the same.

## 2. Principles

1. **Content over chrome.** The artwork, the title, the list. Every band of pixels that
   is not one of those has to earn its height.
2. **One role, one shape.** Same job, same size, same radius, same type. Different pages
   do not get different buttons.
3. **Say it in a verb.** A control's label is what it does ("Play", "Upload track"),
   not what it is ("Flow", "More like this" need to be learned — use sparingly).
4. **No number without a question.** A count appears only where the user asked
   something it answers. Library totals belong to the Library, not to the masthead.
5. **Mobile is the same product.** Same controls, same words, same order. Only the
   container changes.

## 3. Colour

| token | value | use |
|---|---|---|
| `--bg` | `#0a0a0b` | page |
| `--bg-elev` | `#121214` | panel, sidebar, player bar, cards |
| `--bg-elev2` | `#1c1c1f` | raised: hover, chips on, inputs |
| `--line` | `rgba(255,255,255,.07)` | every border, every divider |
| `--fg` | `#f5f4f0` | primary text |
| `--fg-soft` | `rgba(245,244,240,.62)` | secondary text, ghost button label |
| `--fg-mute` | `rgba(245,244,240,.52)` | meta, kickers, inactive icons |
| `--acc` | `#ff5c39` | the one accent: the primary action, the playing row |
| `--on-acc` | `#140a07` | text and icons **on** an accent fill (6.36:1) |
| `--acc-soft` | `rgba(255,92,57,.14)` | accent wash behind a playing row |
| `--ok` | `#3fc57d` | success, ready |
| `--liked` | `#ff4d6d` | liked hearts only |

Rules: one accent colour. Accent fills the primary action only. Filters and sort controls are
an elevated neutral surface (`--bg-elev2`) with `--fg`; they are states, not actions, and must
not borrow the primary fill. A **mode** switch (Listener/DJ, DJ set/Listening) is a setting:
its selection uses `--acc-soft` with an accent border, still never a solid fill. On a touch
screen every card play disc is neutral until it is tapped. Never two filled
actions in one row. A selected filter or sort chip is a state, not an action: it uses the
`--acc-soft` wash with `--acc` text and the normal border, so a row can show its selection
without competing with the button that does something. Text is `--fg`, `--fg-soft` or
`--fg-mute`; there is no fourth grey.
Text on an accent fill is `--on-acc`, never white: white on `#ff5c39` is 3.07:1 and fails
AA at interface sizes.

The twelve harmonic key hues are a documented exception: they name musical keys, not the
brand, and live only on `.keychip`. They are not a second accent and must not be reused
for actions.

### 3.1 The brand lockup

The name is one thing, drawn at two sizes. It always carries the same weight (700), the
same tracking (`--brand-track`, -0.04em) and the same gradient
(`--brand-gradient`: `#ff9a4a → #ff5c39 → #ff3d6e`, clipped to the text).

| where | size |
|---|---|
| sidebar | 28px |
| phone bar wordmark, collapsed-rail monogram | 15px |

A flat-coloured copy of the name is a different logo. If the name appears somewhere new,
it uses these two tokens, not a new colour or a new letter-spacing.

## 4. Type

| role | token | size | weight | class |
|---|---|---|---|---|
| section | `--fs-section` | 19px | 600 | `.sec-title` |
| card title | `--fs-card` | 14px | 600 | `.tcard-name`, `.pcard-name` |
| row title | `--fs-row` | 14.5px | 600 | `.tt` |
| meta | `--fs-meta` | 11px | 400 | `.tcard-sub`, `.pcard-sub`, `.tcard-artist`, `.talbum-line` |
| data label | (none) | 10.5px | 600 | `.genrechip`, `.keychip`, `.thead` |
| kicker | `--fs-kicker` | 9.5px | 400, letter-spacing .18em, uppercase | `.prep-kicker` |

**Display type is the one exception**, and only for the two containers built for it:
the home masthead (`.mast-greet`, 42px, clamps with viewport) and a playlist/liked
header (`.plhead-name`, 52px; `.plhead` art 192px). A page hero is `.prep-title` at
30px. These are different containers, not the same element at a different size — do not
copy their numbers anywhere else.

The interface is one native sans (`system-ui`). No web fonts, no display face, no monospace
stack (`--mono` maps to `--sans`). A rounded variant was tried and rejected: it read as a
different product. Letter-spacing is negative only on display type (`-.03em`) and positive
only on kickers.

## 5. Controls

Three visual roles, plus one touch minimum. Every interactive control is one of them.

| role | what it is | height | type | padding | radius | classes |
|---|---|---|---|---|---|---|
| **action** | a button or a chip that does something | 36px | 13px / 600 | 16px sides | pill | `.btn`, `.btn-primary`, `.btn-ghost`, `.action-chip` |
| **menu** | a row inside a popover menu | 30px | 13px / 600 | 10px sides | 8px | `.chip-menu-item` |
| **tab** | a filter that changes the list in place | 30px | 12px | 12px sides | pill | `.mode-tab`, `.view-switch` |
| **icon** | a square icon control | 30×30 | 18px glyph | — | 8px | `.icon-btn` |
| **touch** | minimum tap area on `(pointer: coarse)` | 44×44 | — | — | — | hit area, not a visible shape |

Anatomy rules:

- Height is set with `min-height` from the token and the sides with `padding: 0 <pad>`.
  Never vertical padding — it changes the height.
- The primary action is `--acc` filled with `--on-acc` text and a transparent 1px border;
  the secondary is transparent with a `--line` border. Both carry the same border width
  so they measure identically.
- An action is a pill. A container is not. If a control needs a subtitle, it is a
  container (see §6), not a taller button.
- Filters are pills in a group (`.mode-tabs`), and a view switcher (`.view-switch`) is
  a pill-shaped segmented control of the same 30px height, so the two sit on one line.
- In a flex row, control heights never stretch to a taller neighbour: the row centres its
  children (`align-items: center`), so a 30px icon and a 36px action stay 30 and 36.
- A row of four actions on a phone is a two-column grid of equal pills starting at the
  text edge, not one pill alone on a right-aligned line. A card's full-width USB button is
  a card rule; in a row it is one cell of four.
- A control that appears only sometimes is a bug: if the action cannot run, keep it
  visible and make it say why.

States:

| state | treatment |
|---|---|
| hover (pointer) | `--bg-elev2` for ghosts and icons; accent brightens for filled; border to `--fg-mute` |
| active | `transform: translateY(1px)` (see `.pressed`) |
| focus-visible | 2px accent outline, never removed |
| hover / selected pill | 2px outer ring, so hovering never reflows the row |
| focus-within | a reveal or hover state also appears when a child has keyboard focus |
| disabled | `opacity: .45`, `cursor: default`, no hover change |
| playing | accent text + `--acc-soft` row wash |

Touch: on `(pointer: coarse)`, icon controls grow to 44×44 (top bar, player controls) and
small targets (row play discs, like, more, card play) get a 44×44 hit area from an
absolutely positioned pseudo-element. The visible disc keeps its designed size.

### 5.3 Sliders

A progress bar is a slider, not a div: `role="slider"`, `tabindex="0"`,
`aria-valuemin/max/now`, `aria-valuetext` as `current / duration`, and keyboard support
(←/→ ±5 s, Shift ±30 s, Home, End). Focus uses the global focus-visible ring. The same
rules apply to the full player and the phone bar.

### 5.1 Settings sections

A settings card opens with a 6px tone dot before its heading, so the kind of setting is
readable before the label:

| tone | token | used for |
|---|---|---|
| accent | `--acc` | identity and machinery (You, Location, model, downloads) |
| positive | `--ok` | taste, and anything the engine learns |
| neutral | `--fg-mute` | housekeeping (maintenance, library) |

Settings is two columns on a wide screen, at most 1100px wide, with the mode band across
the top. Cards in one row share the same top and bottom edge; the grid stretches a short
card to its row instead of letting a masonry column start at a different height. One
column on a phone. A note directly above a field or checkbox keeps 10px of separation.
The page ends with one credit line, 10px, muted and flush left with the version row:
`Developed by Roger Lima · WNL`. It is a signature, not a footer bar: no border, no links, no
second row. The version line reports the update state in colour: `--ok` when current, `--warn`
when an update is available or a restart is pending, `--liked` when the check fails. The
wordmark on that line is 700; the state sentence stays regular.

The Library folder card has one primary action, **Scan folder**. The folder itself is a
select of places this install may scan — the download folder, the configured roots and one
level under each — with **Other folder…** revealing the path field, which is the only way a
browser on another machine can name one. In the desktop app a ghost **Choose folder** sits
before the scan and opens the native picker; a browser tab hides it, and it never takes the
primary role.

The model endpoint card puts its state on one row: the sentence on the left, **Test
connection** and **Load models** on the right, 10px of air and wrapping on an even card. The
sentence carries the tone token — green when connected, red on an error, muted otherwise —
so the dot and the words agree. Model names are a datalist filled from the endpoint; when it
does not list them, the field stays free text and says so.

### 5.2 Exclusion chips

"Keep out of picks" is shown back as the terms the engine will use: pill chips,
`--fs-meta`, `--acc-soft` fill, 1px border in accent at 40%. The label above them is a
kicker: `never in picks`.

### 5.3 First run

Five screens, one question each: the promise, name, city, mode, folder. The promise comes
first and says what never leaves the computer, before any field. Every screen can be
skipped; the mono step counter and a 2px playhead are the only progress chrome. The name
screen shows the greeting it will produce as it is typed, the city is resolved when the field
is left and the chip that appears is the place the app will use, the mode screen changes the
app at once, and the folder screen reads a folder in place and reports the count without
blocking. The last screen repeats the mode and the place and offers "Open my library".

It is a dialog: focus is trapped, Enter advances from a field, Escape goes back, the cards
are buttons rather than a carousel. On a phone it fills the screen and the action sits at the
bottom. Skipping marks setup done; Settings, under You, replays it.

The mode screen carries a second question, **Anyone else?**. It expands to a kid's name and
an age band only when **A kid or teenager** is chosen, so the default path stays one tap. It
writes `kids_name` and `kids_age`, and the Kids entry appears from that point even before a
playlist is marked.

The language switch (EN / PT) is the first control in the dialog, before Skip: the copy is
the product here, and it has to be readable before anything is asked. The browser language
still decides the first value. Switching saves the current screen and the fields already
typed, then reloads into the same step.

### 5.4 Voice

Copy is deadpan and specific. It names the thing — files, disk, folder, UTC, bank statement —
instead of the feeling, and any joke aims at the industry this app is refusing to be, never at
the person. Banned: "Let's get started", "Welcome aboard", "You're all set", "Oops",
exclamation marks, "seamless", "delight". A screen that can be skipped says so. A promise with
an exception names the exception: the city is geocoded once, and the copy says exactly that.

### 5.5 Kids mode

Kids mode is a separate shelf, not a theme: the same type, the same spacing, no cartoon
palette. The sidebar, the top bar and the bottom navigation disappear; the player bar stays.
The wordmark is colourful — five stops, clipped to the text — and so is the drum on the empty
shelf and the dot before a track count; everywhere else stays monochrome. The kid's name sits
under the wordmark, and the age band from setup sets the card size: up to 6 gets 240px cards,
11 and over gets 170px. The gradient is the app's own, not a second palette.

The page is a grid of the playlists marked for Kids mode; a tap plays one. **Leave** is the
only other control, and it asks for the PIN when one is set. Plays made here are written to
their own table, so taste, rotation, history and A&R never see them. The PIN is a speed bump
for a child and the copy says so.

## 6. Containers
| container | radius | padding | background | use |
|---|---|---|---|---|
| `.mast` hero | `--r-xl` 18px | 16/20 | `--bg-elev` + light bloom | home only |
| `.prep-hero` | `--r-lg` 14px | 20/22 (13/15 on phone) | `--bg-elev` + right-edge texture | Prep only: title and coverage meter |
| `.prep-hero` | `--r-lg` 14px | 20/22 (13/15 on phone) | `--bg-elev` + right-edge texture | Prep only: title plus the coverage meter |
| `.pcard` / card | `--r-lg` | 12px | `--bg-elev` | playlists, albums, artists |
| `.answer`, `.inline-panel`, `.set-card` | `--r-lg` | 14–16px | `--bg-elev` | blocks inside a page |
| `.trow` row | `--r-sm` | 6px 12px | transparent, `--bg-elev` on hover | track list |
| `.mini` player | `--r-lg` | 8px 12px | `--bg-elev2` | phone, above the bar |

Cards are 150px wide in a rail on desktop, 128px on a phone, with the artwork square
and the title under it. A rail scrolls sideways; it does not wrap.

An empty page is not a sentence in the gap. `.hollow` is a block: a mark, a one-line title,
one sentence saying what the content would come from, and where the action lives — `⌘O` in
the app, Settings → Library folder in a browser. The mark is an empty cover (a dashed square,
the app's own unit) with a broken waveform in accent inside it (the thing that is missing),
drawn in the same stroke language as the rest. No illustrations of empty boxes, ghosts, notes
or sad faces.

The page name lives in the top bar, once. Library and Search start with their toolbar: the
first track row is the content. Playlists, Settings and A&R start with an inline `.page-sub`
line, not a hero card. Prep is the only page with a real hero: its card carries the title and
the coverage meter. A hidden `h1` keeps the outline correct.

The Library toolbar is four ways into the library (Artists, Albums, Genres, For you) plus
one Tools menu for import, upload, recent downloads and the BPM sort. Ten equal pills across
five phone rows were chrome before content. The player bar stays hidden until the first
track starts; an empty player is a broken widget, not a state.

No generated rainbow: a track without artwork gets a neutral surface (`--bg-elev2` to
`--bg-elev`) with a muted initial. Real artwork is the only source of colour in a grid.
Menu rows use `.chip-menu-item` (30px, one label, no inline hint) so the Tools popover cannot
reflow a row.

An artist page has no artwork of its own. Its hero is a mosaic of up to four of the
artist's album covers (one full, two side by side, three with a tall left tile, four in a
2×2) and its albums are `.pcard` cards with the name on two lines and `year · N tracks`
under it, not a list of text rows. The colour is the albums': a real cover, or the letter
tile the album endpoint already generates for an album without one. The hero never invents
a hue of its own. On a phone the hero keeps its 148px square instead of stretching to the
column.

Navigation follows the device and the mode. The phone bottom bar is Home, Search, A&R,
Library, Playlists and Settings; Prep is desktop-only in the **Studio** group with A&R, and is
reachable on a phone from the command palette.
On desktop, A&R and Prep sit under Studio; Prep disappears entirely in Listener. Settings is
separated at the foot of the sidebar, outside Studio. A&R is not hidden on a phone: it is a
destination, not a Search sub-page.

Search is the one global search. Its Scope control is Both, This library or Web; playlist
hits appear above the track results, so sets are found in the same field. The Library field
is a local filter, labelled as one, and when nothing matches it hands the query to Search
("Search everywhere").

The command palette (`⌘K` / `Ctrl-K`, and the top-bar `⌘` button) jumps to a view, track or
playlist, or runs Play library shuffled and Scan a folder. On a playlist it also offers Play,
Shuffle, the Rekordbox and Traktor exports, and a mode switch. A fresh install opens with a
first-run card: I am a DJ / I am a listener; the choice is stored on the server. A&R opens with **For you now**, a preloaded set of local picks from the
recommender, refreshed in the background every five minutes and by the refresh button; a
search replaces it. With no picks, the three-step explainer is the starter instead. Every confirmation and prompt is
the in-app `.ask-dialog` (message, optional field, Cancel, accent action); no native
`confirm` or `prompt`. Playlist upload lives in the playlist `…` menu with the other
secondary actions.

Metadata is edited in a modal `<dialog>` (`.meta-dialog`): native focus trap, Escape,
dimmed backdrop, fields on one column and exactly one accent-filled Save. The sheet menu
is for actions; it never grows a form. A selected checkbox is a real 18px checkbox with
its label, not a full-width input.

## 7. Layout

```
┌──────────┬───────────────────────────┐
│ sidebar  │ topbar 64 (56 phone)      │
│ 272      ├───────────────────────────┤
│ (68 col) │ view  pad 26/28/48        │
│          │       (18/16/130 phone)   │
├──────────┴───────────────────────────┤
│ playerbar 88 (phone: mini + nav 60)  │
└──────────────────────────────────────┘
```

- Sidebar 272px, collapses to 68px; on a phone it is gone and the bottom bar replaces it. The collapsed rail hides every label, including the Studio group.
- Top bar: 64px desktop, 56px phone, one 30px icon control per side.
- The view is the only scroller. Page padding 26/28/48 desktop, 18/16/130 phone — the
  130 clears the mini player and the bottom bar.
- The home masthead does one job: greet and offer Flow. On-deck picks sit below the
  first content rail, so music starts in the top third; the old library counters were
  removed.
- Bottom bar 60px + safe-area; the mini player floats at 64px from the bottom.
- Breakpoints, and only these three: **920** (shell switches to phone/tablet), **760**
  (dense phone rules), **1281** (wide table columns). A new breakpoint is a design
  change, not a styling detail.

## 8. Spacing

`2 4 6 8 10 12 14 16 18 20 22 24 26 28 30 36 48`. Gaps inside a control row: 8–10px.
Gaps between sections: 22–30px. Anything larger is a deliberate hero.

## 9. Motion

Fast 120ms, base 160ms, slow 240ms; `ease` unless a transform needs
`cubic-bezier(.2,.8,.2,1)`. Hover lifts 1px, press pushes 1px, card hover lifts 2px.
Nothing animates on load. The mast glow is static and there is no beam animation; the
thinking orb exists only while a request is in flight. `prefers-reduced-motion` turns the
remaining motion off.

## 10. Content

- Sentence case for prose, Title Case only for page and section titles.
- A label is a verb phrase: "Upload track", "Play", "Analyze 1050 unanalyzed".
- One idea per line of meta. Quote a track as “Title”, not as a raw id.
- Counts are spelled with thousands separators (1,416), never bare (1416) and never
  with an unexplained unit ("14.0G" must be "14.0 GB").
- No jargon: not "OWNED", not "rung", not "catalog row". Say "downloaded", "streamed",
  "in your library".
- Empty states say what will fill them ("Play something and it lands here"), never
  "No data".
- Titles and metadata are selectable text. Controls, rows and drag surfaces are not:
  `user-select: none` is scoped to those, never to `body`.

## 11. Forbidden

These are real defects from this project, not hypotheticals:

1. **A styling class shared by rows with different contents.** `.lib-actions` once
   styled the Library buttons, the Songs filter bar and a Settings row; one rule broke
   two of the three. Each row gets its own name and one shared rule.
2. **A bespoke control shape.** A card-shaped "Flow" button with its own disc, subtitle
   and radius, next to a pill. If it is a control, it is one of the three roles.
3. **Mixed shapes in one row.** A pill next to a rounded card next to a naked link. One
   shape per row, one left edge per block.
4. **A control that hides itself** because a count crossed a threshold.
5. **Numbers as decoration.** Session minutes, average BPM or library counters in a
   header answer nothing.
6. **Monospace for the interface.** It is a DJ library, not a terminal.
7. **A second scroll container inside a page**, or a horizontal scroll with no visual
   cue that it scrolls.

## 12. Verification

```bash
node bin/design-check.mjs          # tokens ↔ CSS ↔ built pages, exits non-zero on drift
NODE_PATH=… node bin/design-audit.mjs   # measurement table, every view, 1440 / 390 / 360
bash bin/smoke.sh                  # API behaviour
node bin/test.mjs                  # 61 API tests
```

`design-check` is the gate. It checks that every `--r-*`, `--ctl-*`, `--fs-*` variable
in `:root` equals `design/tokens.json`, that no `border-radius` or control `font-size`
is written as a literal, and that every view measures to the same signature.

Measured contract at the time of writing (desktop and phone):

```
action  36h 13px pill      tab  30h 12px pill      icon  30h 18px 8px
section 19 / card 14 / row 14.5 / meta 11 / kicker 9.5
```
