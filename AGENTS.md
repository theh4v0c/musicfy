# Agent instructions — MUSICFY

## The design source of truth

`DESIGN.md` and `design/tokens.json` govern this app's interface. They are binding
until Roger says otherwise. Where a stylesheet and that document disagree, the
stylesheet is wrong.

Change order, every time:

1. `design/tokens.json` (or `DESIGN.md`) first.
2. `web/app.css` reads the token. Never write a raw size.
3. `node bin/design-check.mjs` — tokens ↔ CSS, literal scans.
4. `node bin/design-check.mjs --dom` — the built pages, every view, 1440 and 390.
5. `bash bin/smoke.sh && node bin/test.mjs` — API behaviour.

A check that fails means the work is not done. Do not "adjust the check" to make it
pass; adjust the CSS or update the token deliberately, and say which.

## Where things are recorded

- `MILESTONES.md` — dated log of what shipped and why, plus what is open. Read it before
  proposing work; add an entry when something lands.
- `DOCS.md` — how the system works.
- `DESIGN.md` + `design/tokens.json` — the interface contract.

## Hard rules

- Three control roles only: **action** (36px/13px/pill), **tab** (30px/12px/pill),
  **icon** (30px/18px/8px). No bespoke control shapes, no per-page sizes.
- One shape per row, one left edge per block.
- A styling class does one job. Never share a layout class between rows with different
  contents (that is how `.lib-actions` broke two pages at once).
- Never let a service worker own a media response.
- Deploy: `rsync -az web/ plm:/opt/musicfy/web/ && rsync -az core/ plm:/opt/musicfy/core/ && ssh plm 'sudo systemctl restart musicfy-core'`.
  Bump `?v=` in `web/index.html`.
- Verify through the client path, not `curl`: the gzip cache is keyed by content hash
  now, but the browser is the only honest witness.
