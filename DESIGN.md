# MUSICFY design guideline

**Status: binding.** This file and `design/tokens.json` are the source of truth for the
interface. Where this document and any CSS disagree, the CSS is wrong. Nothing in the
visual layer changes without changing this document first. This stays in force until
Roger says otherwise.

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
| `--acc-soft` | `rgba(255,92,57,.14)` | accent wash behind a playing row |
| `--ok` | `#3fc57d` | success, ready |
| `--liked` | `#ff4d6d` | liked hearts only |

Rules: one accent colour. Accent fills the primary action only — never two filled
actions in one row. Text is `--fg`, `--fg-soft` or `--fg-mute`; there is no fourth grey.

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
| meta | `--fs-meta` | 11px | 400 | `.tcard-sub`, `.pcard-sub`, `.talbum-line` |
| kicker | `--fs-kicker` | 9.5px | 400, letter-spacing .18em, uppercase | `.prep-kicker` |

**Display type is the one exception**, and only for the two containers built for it:
the home masthead (`.mast-greet`, 42px, clamps with viewport) and a playlist/liked
header (`.plhead-name`, 52px; `.plhead` art 192px). A page hero is `.prep-title` at
30px. These are different containers, not the same element at a different size — do not
copy their numbers anywhere else.

The interface is one native sans (`system-ui`). No web fonts, no monospace stack
(`--mono` maps to `--sans`). Letter-spacing is negative only on display type
(`-.03em`) and positive only on kickers.

## 5. Controls

Three roles. Every interactive control in the app is one of them.

| role | what it is | height | type | padding | radius | classes |
|---|---|---|---|---|---|---|
| **action** | a button or a chip that does something | 36px | 13px / 600 | 16px sides | pill | `.btn`, `.btn-primary`, `.btn-ghost`, `.action-chip` |
| **tab** | a filter that changes the list in place | 30px | 12px | 12px sides | pill | `.mode-tab`, `.view-switch` |
| **icon** | a square icon control | 30×30 | 18px glyph | — | 8px | `.icon-btn` |

Anatomy rules:

- Height is set with `min-height` from the token and the sides with `padding: 0 <pad>`.
  Never vertical padding — it changes the height.
- The primary action is `--acc` filled with white text and a transparent 1px border;
  the secondary is transparent with a `--line` border. Both carry the same border width
  so they measure identically.
- An action is a pill. A container is not. If a control needs a subtitle, it is a
  container (see §6), not a taller button.
- Filters are pills in a group (`.mode-tabs`), and a view switcher (`.view-switch`) is
  a pill-shaped segmented control of the same 30px height, so the two sit on one line.
- A control that appears only sometimes is a bug: if the action cannot run, keep it
  visible and make it say why.

States:

| state | treatment |
|---|---|
| hover (pointer) | `--bg-elev2` for ghosts and icons; accent brightens for filled; border to `--fg-mute` |
| active | `transform: translateY(1px)` (see `.pressed`) |
| focus-visible | 1px accent outline, never removed |
| disabled | `opacity: .45`, `cursor: default`, no hover change |
| playing | accent text + `--acc-soft` row wash |

Touch: on `(pointer: coarse)`, icon controls may grow to 44×44 and small targets
(26–30px play discs, 9px tags) get their hit area extended with a pseudo-element —
never by making the visible control bigger than its role.

### 5.1 Settings sections

A settings card opens with a 6px tone dot before its heading, so the kind of setting is
readable before the label:

| tone | token | used for |
|---|---|---|
| accent | `--acc` | identity and machinery (You, Location, model, downloads) |
| positive | `--ok` | taste, and anything the engine learns |
| neutral | `--fg-mute` | housekeeping (maintenance, library) |

### 5.2 Exclusion chips

"Keep out of picks" is shown back as the terms the engine will use: pill chips,
`--fs-meta`, `--acc-soft` fill, 1px border in accent at 40%. The label above them is a
kicker: `never in picks`.

## 6. Containers

| container | radius | padding | background | use |
|---|---|---|---|---|
| `.mast` hero | `--r-xl` 18px | 16/20 | `--bg-elev` + light bloom | home only |
| `.prep-hero` | `--r-lg` 14px | 20/22 (13/15 on phone) | `--bg-elev` + right-edge texture | page header, once per view |
| `.pcard` / card | `--r-lg` | 12px | `--bg-elev` | playlists, albums, artists |
| `.answer`, `.inline-panel`, `.set-card` | `--r-lg` | 14–16px | `--bg-elev` | blocks inside a page |
| `.trow` row | `--r-sm` | 6px 12px | transparent, `--bg-elev` on hover | track list |
| `.mini` player | `--r-lg` | 8px 12px | `--bg-elev2` | phone, above the bar |

Cards are 150px wide in a rail on desktop, 128px on a phone, with the artwork square
and the title under it. A rail scrolls sideways; it does not wrap.

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

- Sidebar 272px, collapses to 68px; on a phone it is gone and the bottom bar replaces it.
- Top bar: 64px desktop, 56px phone, one 30px icon control per side.
- The view is the only scroller. Page padding 26/28/48 desktop, 18/16/130 phone — the
  130 clears the mini player and the bottom bar.
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
Nothing animates on load. `prefers-reduced-motion` turns the bloom and drift off.

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
NODE_PATH=… node bin/design-audit.mjs   # the measurement table, every view, 1440 and 390
bash bin/smoke.sh                  # API behaviour
node bin/test.mjs                  # 34 API tests
```

`design-check` is the gate. It checks that every `--r-*`, `--ctl-*`, `--fs-*` variable
in `:root` equals `design/tokens.json`, that no `border-radius` or control `font-size`
is written as a literal, and that every view measures to the same signature.

Measured contract at the time of writing (desktop and phone):

```
action  36h 13px pill      tab  30h 12px pill      icon  30h 18px 8px
section 19 / card 14 / row 14.5 / meta 11 / kicker 9.5
```
