/* Unit tests for the pure functions. No server, no database, no network:
 *   node --test bin/unit.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const H = require('../core/harmonic.js');
const A = require('../core/agent.js');
const G = require('../core/genre.js');
const L = require('../core/ladder.js');

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

test('recommend does not carry a second, wrong wheel', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = new URL('../core/', import.meta.url).pathname;
  const wheels = readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /const CAMELOT\b|const MINOR_A\b/.test(readFileSync(join(dir, f), 'utf8')));
  assert.deepEqual(wheels, ['harmonic.js'], `wheel defined in ${wheels.join(', ')}`);
  // and the score recommend now reads is the relative pair, not silence
  assert.equal(H.harmonicScore(H.camelotOf('A', 'minor'), H.camelotOf('C', 'major')), 0.9);
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

test('a new subject is not a follow-up', () => {
  assert.equal(A.isFollowUp('10 aphex twin'), false);
  assert.equal(A.isFollowUp('albums by fear factory'), false);
  assert.equal(A.isFollowUp('make it darker'), true);
  assert.equal(A.isFollowUp('the same but slower'), true);
  assert.equal(A.isFollowUp('two more'), true);
});

test('the brief filter rejects a single-word coincidence', () => {
  // "Kids" is a real song, but it is not about unicorns or robots
  assert.equal(A.briefMatches(['unicorns and robots'], {
    title: 'Kids', artist: 'MGMT', album: 'Oracular Spectacular', genre: 'Alternative',
  }), false);
  assert.equal(A.briefMatches(['unicorns and robots'], {
    title: 'Sleeping Unicorns', artist: 'The Kiboomers', album: 'x', genre: "Children's Music",
  }), true);
  assert.equal(A.briefMatches(['unicorns and robots'], {
    title: 'The Robot Song', artist: 'Remember White', album: 'x', genre: 'Pop',
  }), true);
});

test('a curly apostrophe is the same instruction', () => {
  assert.equal(A.cleanQuery('I don’t have it'), "I don't have it");
  assert.equal(A.planLocally('5 Gespona tracks I don’t have').intent, 'build_playlist');
  assert.equal(A.isFollowUp('make it darker'), true);
});

test('children’s music is recognised without a genre', () => {
  assert.equal(G.looksChildren({ title: 'Sprunki (Get Funky)', artist: 'ANGRYHED' }), true);
  assert.equal(G.looksChildren({ title: 'Friend Like You (Sped Up)', artist: 'Horror Skunx', album: 'Horror Skunx' }), true);
  assert.equal(G.looksChildren({ title: 'Kids', artist: 'MGMT', album: 'Oracular Spectacular' }), false);
  assert.equal(G.looksChildren({ genre: "Children's Music" }), true);
  assert.equal(G.looksChildren({ genre: 'Techno' }), false);
  assert.equal(G.looksChildren({ album: 'Nursery Rhymes', artist: 'Meshuggah', title: 'War' }), false);
});

test('a plain request is not answered with a remaster', () => {
  const plain = { title: 'Glints Collide', artist: 'Meshuggah', duration: 296, wantsRemaster: false };
  const remaster = { title: 'Glints Collide', artist: 'Meshuggah', duration: 296, wantsRemaster: false };
  const a = L.scoreCandidate({ title: 'Glints Collide', artist: 'Meshuggah', duration: 296 }, plain);
  const b = L.scoreCandidate({ title: 'Glints Collide (Remastered 2006)', artist: 'Meshuggah', duration: 297 }, remaster);
  assert.ok(a.score > b.score, `${a.score} vs ${b.score}`);
  assert.equal(L.titleForVersion('Glints Collide', 'Glints Collide', 'Glints Collide (Remastered 2006)'), 'Glints Collide');
  assert.equal(L.titleForVersion('Glints Collide (Remastered 2006)', 'Glints Collide', 'Glints Collide (Remastered 2006)'), 'Glints Collide (Remastered 2006)');
});

const O = require('../core/album-order.js');
const fakeDb = (writes) => ({ prepare: (sql) => ({ run: (...args) => writes.push({ sql, args }) }) });

test('album order writes missing numbers and sorts by them', () => {
  const writes = [];
  const rows = [
    { id: 1, title: 'Second', duration: 200, track_no: 2, disc_no: null },
    { id: 2, title: 'First', duration: 201, track_no: null, disc_no: null },
  ];
  const list = [
    { title: 'First', trackNumber: 1, discNumber: 1, duration: 201 },
    { title: 'Second', trackNumber: 2, discNumber: 1, duration: 200 },
  ];
  const out = O.apply(fakeDb(writes), rows.slice(), list);
  assert.deepEqual(out.map((r) => r.id), [2, 1]);
  assert.equal(out[0].track_no, 1);
  assert.equal(out.filled, 1);
  assert.equal(writes.filter((w) => /SET track_no/.test(w.sql)).length, 1);
  assert.equal(writes.filter((w) => /SET disc_no/.test(w.sql)).length, 2);
});

test('album order never overwrites a track number already on the row', () => {
  const rows = [{ id: 1, title: 'One', duration: 100, track_no: 9, disc_no: null }];
  const list = [{ title: 'One', trackNumber: 1, discNumber: 1, duration: 100 }];
  const out = O.apply(fakeDb([]), rows, list);
  assert.equal(out[0].track_no, 9);
  assert.equal(out.filled, 0);
});

test('album order falls back to duration for a mangled title', () => {
  const rows = [{ id: 4, title: 'C**k/ver10', duration: 300, track_no: null, disc_no: null }];
  const list = [{ title: 'Cock/ver10', trackNumber: 8, discNumber: 1, duration: 300 }];
  const out = O.apply(fakeDb([]), rows, list);
  assert.equal(out[0].track_no, 8);
});

test('album order keeps discs apart', () => {
  const rows = [
    { id: 1, title: 'D2T1', duration: 100, track_no: 1, disc_no: null },
    { id: 2, title: 'D1T2', duration: 100, track_no: 2, disc_no: null },
    { id: 3, title: 'D1T1', duration: 100, track_no: 1, disc_no: null },
  ];
  const list = [
    { title: 'D1T1', trackNumber: 1, discNumber: 1, duration: 100 },
    { title: 'D1T2', trackNumber: 2, discNumber: 1, duration: 100 },
    { title: 'D2T1', trackNumber: 1, discNumber: 2, duration: 100 },
  ];
  const out = O.apply(fakeDb([]), rows.slice(), list);
  assert.deepEqual(out.map((r) => r.id), [3, 2, 1]);
});

test('album order ignores a same-name release that shares almost no titles', () => {
  const rows = [
    { id: 1, title: 'Alpha', duration: 100, track_no: null, disc_no: null },
    { id: 2, title: 'Beta', duration: 100, track_no: null, disc_no: null },
    { id: 3, title: 'Gamma', duration: 100, track_no: null, disc_no: null },
    { id: 4, title: 'Delta', duration: 100, track_no: null, disc_no: null },
  ];
  const list = [{ title: 'Something Else', trackNumber: 1, discNumber: 1, duration: 100 }];
  const out = O.apply(fakeDb([]), rows, list);
  assert.equal(out.filled, 0);
  assert.equal(out[0].track_no, null);
});
