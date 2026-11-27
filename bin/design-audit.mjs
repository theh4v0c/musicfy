#!/usr/bin/env node
/* Design audit: the source of truth is a measurement, not a stylesheet comment.
 *
 * It walks every view at a desktop and a phone width, reads the computed style of
 * every interactive control, groups them by role, and fails when two views disagree
 * about the height, the type size or the radius of the same role.
 *
 *   BASE=http://localhost:8710 node bin/design-audit.mjs
 *   BASE=... node bin/design-audit.mjs --json     (machine output)
 *
 * Roles come from the class, not from the page:
 *   action  a button or a chip that does something   .btn .action-chip
 *   tab     a filter that changes the list           .mode-tab .view-switch
 *   icon    a square icon control                    .icon-btn
 *   section/card/row/meta/kicker   the type scale
 *
 * Display type (the home mast, a playlist header) is deliberately outside the contract:
 * it is a different container, not a different size of the same thing.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
for (const id of [process.env.PLAYWRIGHT_PATH, 'playwright'].filter(Boolean)) {
  try { ({ chromium } = require(id)); break; } catch {}
}
if (!chromium) {
  console.error('playwright not found. Run with NODE_PATH pointing at a node_modules that has it.');
  process.exit(2);
}

// defaults to a local instance; set BASE to audit a deployed one
const BASE = process.env.BASE || 'http://localhost:8710';
const json = process.argv.includes('--json');

const ROLES = [
  ['action', '.btn, .action-chip'],
  ['menu', '.chip-menu-item'],
  ['tab', '.mode-tab, .view-switch'],
  ['icon', '.icon-btn'],
  ['field', '.set-card input, .set-card select, .set-card .set-check'],
];
const TEXT = [
  ['section', '.sec-title'],
  ['card', '.tcard-name, .pcard-name'],
  ['row', '.tt'],
  ['meta', '.tcard-sub, .pcard-sub'],
  // the mast note is a sentence in the masthead, not a section kicker
  ['kicker', '.prep-kicker, .mast-kicker'],
  ['sethead', '.set-card h2'],
  ['setlabel', '.set-card label:not(.set-check)'],
  ['setnote', '.set-card .set-note'],
];

const VIEWS = [
  ['home', 'home', null],
  ['songs', 'songs', null],
  ['library', 'library', null],
  ['prep', 'djexport', null],
  ['settings', 'settings', null],
  ['liked', 'liked', null],
  ['search', 'search', null],
  ['playlist', null, 'first'],
];

const SIZES = [
  ['desktop', 1440, 900, false],
  ['phone', 390, 844, true],
  ['small', 360, 640, true],
];

const round = (n) => Math.round(n);
const sig = (v) => (v.h ? `${round(v.h)}h ${v.fs}px ${v.r}` : `${v.fs} / ${v.pad}`);

async function collect(page, view, opened) {
  const spec = VIEWS.find((v) => v[0] === view);
  if (spec[2] === 'first') {
    await page.evaluate(() => {
      const p = state.playlists.find((x) => (x.n_tracks || 0) > 10) || state.playlists[0];
      return openPlaylist(p.id, true);
    });
  } else {
    await page.evaluate((v) => nav(v), spec[1]);
  }
  await page.waitForTimeout(1400);
  return page.evaluate(([roles, text]) => {
    const out = {};
    for (const [role, sel] of text) {
      const seen = new Set();
      for (const el of document.querySelectorAll(sel)) {
        if (!el.getBoundingClientRect().height) continue;
        const cs = getComputedStyle(el);
        seen.add(`${cs.fontSize} ${cs.fontWeight}`);
      }
      out[role] = [...seen].map((k) => { const [fs, fw] = k.split(' '); return { h: 0, fs, r: '', pad: fw, n: 1 }; });
    }
    for (const [role, sel] of roles) {
      const seen = new Map();
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (el.closest('.np')) continue;
        const cs = getComputedStyle(el);
        const key = `${Math.round(r.height)}|${cs.fontSize}|${cs.borderTopLeftRadius}|${cs.paddingTop} ${cs.paddingRight}`;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      out[role] = [...seen.entries()].map(([key, n]) => {
        const [h, fs, r, pad] = key.split('|');
        return { h: Number(h), fs, r, pad, n };
      });
    }
    return out;
  }, [ROLES, TEXT]);
}

const page1 = await (async () => {
  const browser = await chromium.launch();
  const result = { sizes: {}, problems: [] };
  for (const [size, w, h, mobile] of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block',
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?audit=1`, { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    result.sizes[size] = {};
    for (const [view] of VIEWS) {
      result.sizes[size][view] = await collect(page, view);
    }
    await ctx.close();
  }
  await browser.close();
  return result;
})();

/* the contract: one signature per role per device */
const ALL_ROLES = [...ROLES, ...TEXT];
for (const [size] of SIZES) {
  for (const [role] of ALL_ROLES) {
    const byView = {};
    for (const [view] of VIEWS) {
      const sigs = new Set((page1.sizes[size][view][role] || []).map(sig));
      if (sigs.size) byView[view] = [...sigs];
    }
    const all = new Set(Object.values(byView).flat());
    if (all.size > 1) {
      page1.problems.push({ size, role, views: byView, distinct: [...all] });
    }
  }
}

if (json) {
  console.log(JSON.stringify(page1, null, 2));
} else {
  for (const [size] of SIZES) {
    console.log(`\n== ${size}`);
    for (const [role] of ALL_ROLES) {
      const rows = VIEWS.map(([view]) => {
        const s = [...new Set((page1.sizes[size][view][role] || []).map(sig))];
        return `${view.padEnd(9)} ${s.join('  |  ') || '—'}`;
      });
      console.log(`  ${role}`);
      for (const r of rows) console.log(`    ${r}`);
    }
  }
  if (page1.problems.length) {
    console.log('\nMISMATCHES');
    for (const p of page1.problems) {
      console.log(`  ${p.size} ${p.role}: ${p.distinct.join(' vs ')}`);
      for (const [v, sigs] of Object.entries(p.views)) console.log(`    ${v.padEnd(9)} ${sigs.join(', ')}`);
    }
    process.exit(1);
  }
  console.log('\nAll roles match on every view.');
}
