// MUSICFY ladder: source abstraction, normalization, scoring. Zero deps.
'use strict';

// ---------- normalization ----------
const SMART = { '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2212': '-', '\uff0c': ',', '\uff1a': ':', '\uff08': '(', '\uff09': ')' };
function foldDiacritics(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

function normalize(s) {
  if (!s) return '';
  let t = String(s);
  t = t.replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2212\uff0c\uff1a\uff08\uff09]/g, (c) => SMART[c] || ' ');
  t = foldDiacritics(t).toLowerCase();
  t = t.replace(/\((official\s+)?(music\s+)?(video|audio|lyric[s]?\s+video|visualizer)\)/g, ' ');
  t = t.replace(/\[(official\s+)?(music\s+)?(video|audio|hd|hq|4k|remaster(ed)?( version)?)\]/g, ' ');
  t = t.replace(/\b(official|remaster(ed)?(\s+version)?|hq|hd|4k|video|audio)\b/g, ' ');
  t = t.replace(/\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/g, ' ');
  t = t.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return t.split(/\s+/).filter(Boolean).join(' ');
}

function artistTokens(s) {
  return normalize(s).split(' ').filter((w) => w.length > 1);
}

// ---------- scoring ----------
// candidate: { title, artist, album?, duration?, format?, bitrate?, size?, filename? }
// seed: { title, artist, duration? }
/* A remaster is a different recording, not a cleaner copy: Nothing 2006 re-recorded
   guitars and triggered drums. A request that does not name a remaster must not be
   answered with one just because the catalogue's canonical match happens to be it. */
function titleForVersion(seedTitle, baseTitle, canonTitle) {
  const wants = /\bremaster(ed)?\b/i.test(String(seedTitle || ''));
  if (wants) return /\bremaster/i.test(String(canonTitle || '')) ? canonTitle : String(seedTitle || '');
  return baseTitle;
}

function scoreCandidate(candidate, seed) {
  const ct = normalize(candidate.title || candidate.filename || '');
  const st = normalize(seed.title);
  let score = 0;
  const reasons = [];

  if (!ct || !st) return { score: 0, reasons: ['empty fields'] };

  if (ct === st) { score += 40; reasons.push('title exact'); }
  else if (ct.includes(st) || st.includes(ct)) { score += 30; reasons.push('title contains'); }
  else {
    const stWords = st.split(' ');
    const hitWords = stWords.filter((w) => ct.includes(w)).length;
    const ratio = stWords.length ? hitWords / stWords.length : 0;
    if (ratio >= 0.7) { score += 15; reasons.push(`title ${Math.round(ratio * 100)}% words`); }
    else return { score: 0, reasons: ['title mismatch'] };
  }

  const ca = artistTokens(candidate.artist || candidate.filename || '');
  const sa = artistTokens(seed.artist || '');
  if (sa.length) {
    const hits = sa.filter((w) => ca.includes(w)).length;
    if (hits === sa.length) { score += 25; reasons.push('artist full'); }
    else if (hits > 0) { score += 12; reasons.push(`artist partial ${hits}/${sa.length}`); }
    else if (ca.length === 0) { score += 4; reasons.push('artist unknown'); }
    else {
      // unreliable metadata sources (YouTube channel names, archive creators) hold labels, not artists.
      // Do not disqualify: check if the seed artist appears in the title text instead.
      const ct2 = normalize(candidate.title || candidate.filename || '');
      const sa2 = artistTokens(seed.artist || '').every((w) => ct2.includes(w));
      if (sa2) { score += 10; reasons.push('artist in title'); }
      else return { score: 0, reasons: ['artist mismatch'] };
    }
  }

  if (seed.duration && candidate.duration) {
    const d = Math.abs(seed.duration - candidate.duration);
    if (d <= 3) { score += 20; reasons.push('duration close'); }
    else if (d <= 8) { score += 10; reasons.push('duration ok'); }
    else if (d > 25) { score -= 15; reasons.push('duration far'); }
  }

  const candidateRemaster = /\bremaster(ed)?\b|\bre-?release\b|\breissue\b/i.test(String(candidate.title || ''));
  if (seed.wantsRemaster === false && candidateRemaster) { score -= 15; reasons.push('version mismatch'); }
  else if (seed.wantsRemaster === true && !candidateRemaster) { score -= 10; reasons.push('not the remaster'); }

  const fmt = String(candidate.format || '').toLowerCase();
  const br = Number(candidate.bitrate || 0);
  if (fmt === 'flac' || fmt.includes('flac')) { score += 15; reasons.push('flac'); }
  else if (br >= 320) { score += 10; reasons.push('320'); }
  else if (br >= 256) { score += 8; reasons.push('v2+'); }
  else if (br >= 192) { score += 4; reasons.push('192+'); }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

const QUALITY_RANK = (c) => {
  const f = String(c.format || '').toLowerCase();
  const br = Number(c.bitrate || 0);
  if (f.includes('flac')) return 100;
  if (br >= 320) return 80;
  if (br >= 256) return 60;
  if (br >= 192) return 40;
  return 20;
};


// A rate limit or a bot check is a fact about the address, not about a player client.
// Walking the rest of the YouTube clients meets the same wall, so the downloader should
// stop retrying and try another source. Kept here so it can be tested without a network.
const ADDRESS_BLOCKED = /HTTP Error 429|Too Many Requests|Sign in to confirm|not a bot|HTTP Error 403/i;
function blockedByAddress(text) {
  return ADDRESS_BLOCKED.test(String(text || ''));
}

module.exports = { normalize, artistTokens, scoreCandidate, titleForVersion, QUALITY_RANK, blockedByAddress };
