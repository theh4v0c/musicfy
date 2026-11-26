#!/usr/bin/env node
/* Translation gate.
 *
 * The UI translation layer is exact-match plus patterns, so a string it does not know
 * silently stays in English. This script loads the real dictionary in Node and fails when
 *   - a key is declared twice (the later one wins and hides a mistake),
 *   - a toast shown by the interface has no translation,
 *   - a pattern patches half-translated output instead of producing it ("nunca played").
 *
 * Run it after touching web/i18n.js or adding a toast: `node bin/i18n-check.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const i18n = read('web/i18n.js');
const app = read('web/app.js');

// --- load the dictionary the page loads, with the smallest possible DOM -------------
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('window', {});
define('localStorage', { getItem: () => 'pt-BR', setItem() {} });
define('navigator', { language: 'pt-BR', languages: ['pt-BR'] });
define('location', { reload() {} });
globalThis.document = {
  documentElement: {}, body: null, readyState: 'complete',
  addEventListener() {}, createTreeWalker: () => ({ currentNode: null, nextNode: () => null }),
};
globalThis.NodeFilter = { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_REJECT: 2, FILTER_ACCEPT: 1 };
globalThis.MutationObserver = class { observe() {} };
new Function(i18n)();
const t = globalThis.window.I18N.t;
if (typeof t !== 'function') throw new Error('web/i18n.js did not expose I18N.t');

const problems = [];

// --- duplicate keys ------------------------------------------------------------------
const seen = new Map();
for (const line of i18n.split('\n')) {
  // a line may declare several keys; read every pair, not only the first
  for (const m of line.matchAll(/'((?:[^'\\]|\\.)+)':/g)) {
    const key = m[1];
    if (!/^\s{4}/.test(line) && !/^\s{4}/.test(m[0])) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
}
for (const [key, n] of seen) if (n > 1) problems.push(`duplicate key: ${key} (${n} times)`);

// --- every literal toast must have a translation --------------------------------------
const toasts = new Set();
for (const m of app.matchAll(/\btoast(?:Persistent)?\(\s*(['"`])([\s\S]*?)\1/g)) {
  const body = m[2];
  if (body.includes('${')) continue; // built at runtime; the patterns own those
  toasts.add(body);
}
for (const s of toasts) {
  if (!s.trim()) continue;
  if (t(s) === s) problems.push(`toast not translated: ${JSON.stringify(s)}`);
}

// --- patterns that exist only to repair a previous half-translation --------------------
for (const [re] of [...i18n.matchAll(/\[\s*\/\^?([^/\n]+)\/\w*,\s*\(?m?\)?\s*=>/g)]) {
  if (/nunca |faixas? by /.test(re)) problems.push(`patch-style pattern: /${re}/`);
}

if (problems.length) {
  console.error(`i18n check failed (${problems.length})`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`i18n ok · ${seen.size} keys · ${toasts.size} toasts`);
