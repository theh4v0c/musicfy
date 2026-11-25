'use strict';
/* "Keep out of picks" — one place that decides what a track is, for exclusion purposes.
 *
 * The field is free text and people write instructions, not tags: "non pop, reggaeton,
 * latin, emo, EDM". Matching that literally found nothing, because metadata says
 * "Reggaeton", "Latin Pop", "House". So the text is normalised into terms, umbrella
 * terms are expanded once, and the terms are matched against artist, album, title,
 * genre and genre family together.
 */

const SYNONYMS = {
  edm: ['edm', 'big room', 'electro house', 'future house', 'future bass', 'dance pop', 'tropical house', 'commercial house', 'slap house'],
  pop: ['pop'],                    // also catches "latin pop", "dance pop", "pop punk"
  latin: ['latin', 'reggaeton', 'dembow', 'bachata', 'merengue', 'salsa', 'cumbia', 'perreo', 'sertanejo'],
  reggaeton: ['reggaeton', 'dembow', 'perreo'],
  reggaetón: ['reggaeton', 'dembow', 'perreo'],
  emo: ['emo', 'screamo', 'midwest emo', 'emotional hardcore', 'post-hardcore', 'pop punk'],
  metalcore: ['metalcore', 'deathcore', 'hardcore'],
  christmas: ['christmas', 'xmas', 'holiday', 'noel'],
  children: ['children', "children's", 'kids', 'nursery', 'bebefinn', 'pinkfong', 'cocomelon'],
};

const PREFIX = /^(?:no|non|not|without|avoid|skip|exclude|off|don'?t play|do not play|keep out(?: of picks)?)\s+/i;
const SUFFIX = /\s+(?:music|tracks?|songs?|please)$/i;

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* text -> the terms that mean "no" */
function parse(text) {
  const parts = String(text || '').split(/[\n,;]+|\band\b/gi).map((x) => x.trim()).filter(Boolean);
  const terms = new Set();
  for (const raw of parts) {
    let t = normalize(raw).replace(PREFIX, '').replace(SUFFIX, '').trim();
    if (!t) continue;
    // "pop music, reggaeton" -> both; "electronic" must stay a single word
    terms.add(t);
    for (const extra of SYNONYMS[t] || []) terms.add(normalize(extra));
  }
  return [...terms];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* a track is excluded when any term appears in any of its descriptive fields */
function matches(terms, track) {
  if (!terms || !terms.length || !track) return false;
  const hay = normalize([track.artist, track.album, track.title, track.genre, track.genre_family].filter(Boolean).join(' | '));
  if (!hay) return false;
  for (const term of terms) {
    if (!term) continue;
    if (term.length <= 3) {
      // short terms are words, not fragments: "pop" must not match "populate"
      if (new RegExp(`(^|[^a-z0-9])${escapeRe(term)}([^a-z0-9]|$)`).test(hay)) return true;
    } else if (hay.includes(term)) return true;
  }
  return false;
}

module.exports = { parse, matches, normalize };
