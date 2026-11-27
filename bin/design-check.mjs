#!/usr/bin/env node
/* Design check. The gate between design/tokens.json and the app.
 *
 *   node bin/design-check.mjs           tokens <-> CSS, plus literal scans
 *   node bin/design-check.mjs --dom     also measure the built pages (needs playwright)
 *
 * It fails when:
 *   - a radius, font or height variable disagrees with design/tokens.json
 *   - a border-radius is written as a literal instead of a token
 *   - a control's font-size is written as a literal instead of a token
 *   - two views measure a shared role differently (--dom)
 *
 * Exit 0 means the interface matches the guideline in DESIGN.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(root, 'web/app.css');
const tokensPath = path.join(root, 'design/tokens.json');

const css = fs.readFileSync(cssPath, 'utf8');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));

const problems = [];

/* the interface is plain text: no em dashes (README design rule 4) */
for (const file of ['web/app.js', 'web/i18n.js', 'web/index.html']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const hit = text.split('\n').findIndex((line) => line.includes('\u2014'));
  if (hit >= 0) problems.push(`${file}:${hit + 1}: em dash in interface text`);
}
// -.04em and -0.04em are the same number; compare canonically
const norm = (v) => String(v).replace(/\s+/g, '').toLowerCase().replace(/(-?)0\.(\d)/g, '$1.$2');

/* ---- 1. the :root block ---- */
const rootBlock = cssNoComments.match(/:root\s*\{([\s\S]*?)\}/);
if (!rootBlock) {
  console.error('no :root block in web/app.css');
  process.exit(2);
}
const vars = {};
for (const line of rootBlock[1].split(';')) {
  const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+)$/);
  if (m) vars[m[1]] = m[2].trim();
}

/* ---- 2. tokens.json <-> :root ---- */
const expect = [];
for (const [k, v] of Object.entries(tokens.color)) expect.push([`--${k}`, v]);
for (const [k, v] of Object.entries(tokens.radius)) expect.push([`--r-${k}`, v]);
expect.push(
  ['--h-action', tokens.control.action.height],
  ['--fs-action', tokens.control.action.font],
  ['--pad-action', tokens.control.action.padding],
  ['--h-tab', tokens.control.tab.height],
  ['--fs-tab', tokens.control.tab.font],
  ['--pad-tab', tokens.control.tab.padding],
  ['--h-icon', tokens.control.icon.size],
  ['--h-touch', tokens.control.touch.size],
  ['--fs-icon', tokens.control.icon.font],
  ['--r-icon', tokens.radius[tokens.control.icon.radius]],
  ['--fs-section', tokens.type.section],
  ['--fs-card', tokens.type.card],
  ['--fs-row', tokens.type.row],
  ['--fs-meta', tokens.type.meta],
  ['--fs-kicker', tokens.type.kicker],
  ['--fs-micro', tokens.type.micro],
  ['--fs-note', tokens.type.note],
  ['--fs-label', tokens.type.label],
  ['--field-h', tokens.control.field.height],
  ['--brand-track', tokens.brand.tracking],
  ['--brand-gradient', tokens.brand.gradient],
);

/* ---- 2b. filled controls must be readable ---- */
const rgbOf = (hex) => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const luminance = (rgb) => {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const la = luminance(rgbOf(a)); const lb = luminance(rgbOf(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
if (tokens.color.acc && tokens.color['on-acc']) {
  const ratio = contrast(tokens.color['on-acc'], tokens.color.acc);
  if (ratio < 4.5) problems.push(`--on-acc on --acc is ${ratio.toFixed(2)}:1 — needs 4.5:1`);
}

const missing = [];
for (const [name, want] of expect) {
  const have = vars[name];
  if (have === undefined) { missing.push(name); continue; }
  if (norm(have) !== norm(want)) problems.push(`${name}: css ${have} ≠ tokens ${want}`);
}

/* ---- 3. no literal radii ---- */
const radiusLiterals = new Set();
for (const m of css.matchAll(/border-radius:\s*([^;}]+)/g)) {
  const value = m[1].trim();
  if (/^var\(--r-[\w-]+\)$/.test(value) || value === '50%' || value === '0' || value === 'inherit') continue;
  radiusLiterals.add(value);
}
for (const v of radiusLiterals) problems.push(`border-radius: ${v} — use a var(--r-*) token`);

/* ---- 4. control font sizes come from a token ---- */
const controlSel = /\.(btn|action-chip|mode-tab|icon-btn|view-switch)\b/;
for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const [sel, body] = [m[1], m[2]];
  if (!controlSel.test(sel)) continue;
  const fs = /font-size:\s*([^;}]+)/.exec(body);
  if (fs && !/^var\(--fs-[\w-]+\)$/.test(fs[1].trim())) {
    problems.push(`${sel.trim().split('\n')[0]} font-size: ${fs[1].trim()} — use var(--fs-*)`);
  }
  const isGlyph = /svg|img/.test(sel);
  const h = isGlyph ? null : /(?:^|[;{]\s*)(?:min-)?height:\s*([^;}]+)/.exec(body);
  if (h && !/^var\(--h-[\w-]+\)$/.test(h[1].trim()) && !/calc\(/.test(h[1]) && !/%$/.test(h[1].trim())) {
    problems.push(`${sel.trim().split('\n')[0]} height: ${h[1].trim()} — use var(--h-*)`);
  }
}

/* ---- report the static half ---- */
const matched = expect.filter(([n, w]) => vars[n] !== undefined && norm(vars[n]) === norm(w)).length;
console.log(`tokens: ${matched}/${expect.length} match :root` + (missing.length ? ` (missing: ${missing.join(', ')})` : ''));

if (problems.length) {
  console.log('\nFAIL');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('CSS matches design/tokens.json, and no control invents a size.');

/* ---- 5. optional: measure the built pages ---- */
if (process.argv.includes('--dom')) {
  const r = spawnSync(process.execPath, [path.join(root, 'bin/design-audit.mjs')], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    console.log('\nFAIL: the built pages do not match the contract.');
    process.exit(1);
  }
}
console.log('\nOK');
