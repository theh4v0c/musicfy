'use strict';
/* The Camelot wheel, in one place, with one meaning.
 *
 *   1A G#m   2A D#m   3A A#m   4A Fm    5A Cm    6A Gm
 *   7A Dm    8A Am    9A Em    10A Bm   11A F#m  12A C#m
 *   1B B     2B F#    3B C#     4B G#    5B D#    6B A#
 *   7B F     8B C     9B G     10B D    11B A    12B E
 *
 * Compatible neighbours (the rules every harmonic-mixing guide states):
 *   same number, other letter  -> relative major/minor, 0.90
 *   one number away, same letter -> 0.85
 *   two away, same letter      -> 0.40 (usable, not free)
 *   one away, other letter     -> 0.45 (energy boost)
 *   anything else              -> 0
 */

const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E' };
const MAJOR_B = { B: 1, 'F#': 2, 'C#': 3, 'G#': 4, 'D#': 5, 'A#': 6, F: 7, C: 8, G: 9, D: 10, A: 11, E: 12 };
const MINOR_A = { 'G#': 1, 'D#': 2, 'A#': 3, F: 4, C: 5, G: 6, D: 7, A: 8, E: 9, B: 10, 'F#': 11, 'C#': 12 };
const A_TO_MAJOR = Object.fromEntries(Object.entries(MINOR_A).map(([k, n]) => [n, k]));

function normKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  return (FLAT_TO_SHARP[k] || k.replace('♯', '#').replace('♭', 'b')).toUpperCase().replace('B', 'B');
}

/* key + scale -> { n: 1..12, minor: bool } or null */
function camelotOf(key, scale) {
  let k = String(key || '').trim();
  k = FLAT_TO_SHARP[k] || k.replace('♯', '#');
  if (!k) return null;
  const minor = String(scale || '').toLowerCase() === 'minor';
  const n = minor ? MINOR_A[k] : MAJOR_B[k];
  return n ? { n, minor } : null;
}

/* the text form: 8A, or Am */
function camelotLabel(key, scale) {
  const c = camelotOf(key, scale);
  return c ? `${c.n}${c.minor ? 'A' : 'B'}` : '';
}

function noteLabel(key, scale) {
  if (!key) return '';
  return `${key}${String(scale || '').toLowerCase() === 'minor' ? 'm' : ''}`;
}

function harmonicScore(a, b) {
  if (!a || !b) return 0;
  const d = Math.min(Math.abs(a.n - b.n), 12 - Math.abs(a.n - b.n));
  if (a.minor === b.minor) return d === 0 ? 1 : d === 1 ? 0.85 : d === 2 ? 0.4 : 0;
  if (a.n === b.n) return 0.9;          // relative major/minor: same number
  if (d === 1) return 0.45;             // energy boost across modes
  return 0;
}

/* greedy nearest-neighbour walk on the wheel, starting from the most common key */
function harmonicOrder(tracks) {
  const items = tracks.map((t) => ({ t, c: camelotOf(t.key, t.key_scale) }));
  const keyed = items.filter((x) => x.c);
  const rest = items.filter((x) => !x.c).map((x) => x.t);
  if (keyed.length < 2) return tracks;
  const counts = {};
  for (const x of keyed) { const k = `${x.c.n}${x.c.minor ? 'A' : 'B'}`; counts[k] = (counts[k] || 0) + 1; }
  const startKey = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  let cur = keyed.find((x) => `${x.c.n}${x.c.minor ? 'A' : 'B'}` === startKey) || keyed[0];
  const used = new Set([cur]);
  const order = [cur.t];
  while (order.length < keyed.length) {
    // highest compatibility first; when nothing is compatible any jump is a clash, so
    // take the shortest one on the wheel instead of an arbitrary track
    let best = null; let bestScore = -1; let bestDist = 99;
    for (const x of keyed) {
      if (used.has(x)) continue;
      const sc = harmonicScore(cur.c, x.c);
      const d = Math.min(Math.abs(cur.c.n - x.c.n), 12 - Math.abs(cur.c.n - x.c.n));
      if (sc > bestScore || (sc === bestScore && d < bestDist)) { bestScore = sc; bestDist = d; best = x; }
    }
    if (!best) break;
    used.add(best); order.push(best.t); cur = best;
  }
  return [...order, ...rest];
}

module.exports = { camelotOf, camelotLabel, noteLabel, harmonicScore, harmonicOrder, MINOR_A, MAJOR_B, A_TO_MAJOR };
