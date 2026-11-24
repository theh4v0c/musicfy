/* Unit tests for the pure functions. No server, no database, no network:
 *   node --test bin/unit.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const H = require('../core/harmonic.js');

const MINOR = { 1: 'G#', 2: 'D#', 3: 'A#', 4: 'F', 5: 'C', 6: 'G', 7: 'D', 8: 'A', 9: 'E', 10: 'B', 11: 'F#', 12: 'C#' };
const MAJOR = { 1: 'B', 2: 'F#', 3: 'C#', 4: 'G#', 5: 'D#', 6: 'A#', 7: 'F', 8: 'C', 9: 'G', 10: 'D', 11: 'A', 12: 'E' };

test('the twelve minor keys land on 1A..12A', () => {
  for (const [n, key] of Object.entries(MINOR)) {
    const c = H.camelotOf(key, 'minor');
    assert.equal(c && c.n, Number(n), `${key}m`);
    assert.equal(c && c.minor, true);
    assert.equal(H.camelotLabel(key, 'minor'), `${n}A`);
  }
});

test('the twelve major keys land on 1B..12B', () => {
  for (const [n, key] of Object.entries(MAJOR)) {
    assert.equal(H.camelotLabel(key, 'major'), `${n}B`);
  }
});

test('flats are the same key as their sharps', () => {
  assert.equal(H.camelotLabel('Db', 'major'), H.camelotLabel('C#', 'major'));
  assert.equal(H.camelotLabel('Eb', 'minor'), H.camelotLabel('D#', 'minor'));
  assert.equal(H.camelotLabel('Bb', 'major'), H.camelotLabel('A#', 'major'));
});

test('the four compatibility rules', () => {
  const a = (n, minor) => ({ n, minor });
  assert.equal(H.harmonicScore(a(8, true), a(8, true)), 1);      // same
  assert.equal(H.harmonicScore(a(8, true), a(8, false)), 0.9);   // relative major
  assert.equal(H.harmonicScore(a(8, true), a(9, true)), 0.85);   // one along
  assert.equal(H.harmonicScore(a(8, true), a(9, false)), 0.45);  // energy boost
  assert.equal(H.harmonicScore(a(8, true), a(10, true)), 0.4);   // two along
  assert.equal(H.harmonicScore(a(8, true), a(11, true)), 0);     // clash
  assert.equal(H.harmonicScore(a(12, true), a(1, true)), 0.85);  // wraps 12 -> 1
});

test('8A and 9B are not a match, 8A and 8B are the relative pair', () => {
  const eightA = H.camelotOf('A', 'minor');
  const nineB = H.camelotOf('G', 'major');
  const eightB = H.camelotOf('C', 'major');
  assert.equal(H.harmonicScore(eightA, nineB), 0.45);
  assert.equal(H.harmonicScore(eightA, eightB), 0.9);
  assert.notEqual(H.harmonicScore(eightA, nineB), 1);
});

test('harmonicOrder takes the best available move at every step', () => {
  const t = (key, scale) => ({ id: key + scale, key, key_scale: scale });
  const list = [t('A', 'minor'), t('F', 'major'), t('E', 'minor'), t('', null), t('B', 'minor'), t('C#', 'minor')];
  const out = H.harmonicOrder(list);
  assert.equal(out.length, list.length);
  assert.equal(out.at(-1).key, '');            // unkeyed last
  const keyed = out.filter((x) => x.key && H.camelotLabel(x.key, x.key_scale));
  for (let i = 1; i < keyed.length; i += 1) {
    const cur = H.camelotOf(keyed[i - 1].key, keyed[i - 1].key_scale);
    const chosen = H.camelotOf(keyed[i].key, keyed[i].key_scale);
    const remaining = keyed.slice(i).map((x) => H.camelotOf(x.key, x.key_scale));
    const best = Math.max(...remaining.map((c) => H.harmonicScore(cur, c)));
    assert.equal(H.harmonicScore(cur, chosen), best, `step ${i} was not the best available move`);
  }
});

test('a compatible chain stays on the wheel', () => {
  const t = (key, scale) => ({ id: key + scale, key, key_scale: scale });
  // A minor -> E minor -> B minor -> F# minor is the classic 8A..11A walk
  const list = [t('F#', 'minor'), t('A', 'minor'), t('B', 'minor'), t('E', 'minor')];
  const keys = H.harmonicOrder(list).map((x) => H.camelotLabel(x.key, x.key_scale));
  for (let i = 1; i < keys.length; i += 1) {
    const a = { n: Number(keys[i - 1].slice(0, -1)), minor: keys[i - 1].endsWith('A') };
    const b = { n: Number(keys[i].slice(0, -1)), minor: keys[i].endsWith('A') };
    assert.ok(H.harmonicScore(a, b) > 0, `${keys[i - 1]} -> ${keys[i]}`);
  }
});
