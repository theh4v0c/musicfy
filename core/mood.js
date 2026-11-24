'use strict';
const exclude = require('./exclude');
// Turns a plain request into a scored selection from the local library.
// No model: style and mood are keyword presets, the ranking is numbers we already store.

const fs = require('node:fs');
const queryEngine = require('./query');

const STYLES = [
  { id: 'burningman', re: /\b(burning\s*man|playa|desert)\b/i, families: ['electronic', 'house', 'techno', 'ambient'], bpm: { min: 95, max: 128 }, label: 'Burning Man: 95-128 BPM, electronic to downtempo' },
  { id: 'indiedance', re: /\b(indie[ -]?dance)\b/i, families: ['electronic', 'house'], bpm: { min: 110, max: 124 }, label: 'indie dance: 110-124 BPM' },
  { id: 'downtempo', re: /\b(downtempo|chill|sunset|ambient)\b/i, families: ['ambient', 'electronic'], bpm: { max: 115 }, label: 'downtempo: under 115 BPM' },
  { id: 'techno', re: /\btechno\b/i, families: ['techno'], bpm: { min: 125, max: 142 }, label: 'techno: 125-142 BPM' },
  { id: 'house', re: /\bhouse\b/i, families: ['house'], bpm: { min: 118, max: 128 }, label: 'house: 118-128 BPM' },
  { id: 'dance', re: /\b(dance|club|party|rave)\b/i, families: ['electronic', 'house', 'techno'], bpm: { min: 118, max: 134 }, label: 'dance floor: 118-134 BPM' },
];

const MOODS = [
  { id: 'question', re: /\b(question(?:ing)? everything|unsettle|dissonan|existential|mind[ -]?bend|weird|strange|uneasy)\b/i, minor: true, keys: ['C#', 'D#', 'F#', 'G#', 'A#'], bpm: { min: 95, max: 126 }, energy: { min: 0.35 }, label: 'unsettling: minor and sharp keys, mid tempo' },
  { id: 'feel', re: /\b(make (?:people|them) feel|feel something|emotional|moving|melanchol|sad|heartbreak|introspect|beautiful)\b/i, minor: true, bpm: { max: 120 }, energy: { max: 0.6 }, label: 'emotional: slow, minor, lower energy' },
  { id: 'euphoric', re: /\b(euphori|uplift|joy|happy|peak|energetic|energy)\b/i, major: true, bpm: { min: 122, max: 134 }, energy: { min: 0.55 }, label: 'euphoric: major, fast, high energy' },
];

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function detect(query) {
  const q = String(query || '');
  const style = STYLES.find((s) => s.re.test(q)) || null;
  const mood = MOODS.find((m) => m.re.test(q)) || null;
  const ref = q.match(/\b(?:like|similar to|in the style of|style of|sounds like|following)\s+([a-z0-9 .&'_-]{2,60})$/i);
  const reference = ref ? ref[1].replace(/\b(playlist|tracks?|songs?|please)\b/gi, ' ').replace(/\s+/g, ' ').trim() : null;
  return { style, mood, reference };
}

function artistProfile(db, name) {
  if (!name) return null;
  const rows = db.prepare(`SELECT bpm, key, key_scale, energy, genre_family FROM tracks t
    WHERE lower(t.artist)=lower(?) AND t.bpm IS NOT NULL AND t.bpm > 0`).all(name);
  if (!rows.length) return null;
  const bpm = rows.reduce((a, r) => a + Number(r.bpm || 0), 0) / rows.length;
  const families = {};
  const keys = {};
  for (const r of rows) {
    if (r.genre_family) families[r.genre_family] = (families[r.genre_family] || 0) + 1;
    if (r.key) { const k = `${r.key}${r.key_scale === 'minor' ? 'm' : ''}`; keys[k] = (keys[k] || 0) + 1; }
  }
  const family = Object.entries(families).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { artist: name, avgBpm: Math.round(bpm), family, keys: Object.keys(keys) };
}

function inBpm(bpm, range) {
  if (!range || !bpm) return 0;
  const { min, max } = range;
  return (!min || bpm >= min) && (!max || bpm <= max);
}

function score(t, ctx) {
  let s = 0;
  const bpm = Number(t.bpm) || 0;
  const energy = Number(t.energy) || 0;
  const fam = String(t.genre_family || '').toLowerCase();
  const key = `${t.key || ''}${t.key_scale === 'minor' ? 'm' : ''}`;

  if (ctx.style) {
    if (ctx.style.families.includes(fam)) s += 5;
    else if (fam) s -= 1;
    if (bpm) s += inBpm(bpm, ctx.style.bpm) ? 4 : -2;
  }

  if (ctx.mood) {
    if (ctx.mood.minor && t.key_scale === 'minor') s += 3;
    if (ctx.mood.major && t.key_scale === 'major') s += 2;
    if (ctx.mood.keys && ctx.mood.keys.includes(t.key)) s += 2;
    if (bpm) s += inBpm(bpm, ctx.mood.bpm) ? 2 : -1;
    if (energy && ctx.mood.energy) {
      const e = ctx.mood.energy;
      s += (e.min === undefined || energy >= e.min) && (e.max === undefined || energy <= e.max) ? 2 : -1;
    }
  }

  if (ctx.referenceProfile) {
    const p = ctx.referenceProfile;
    if (bpm && p.avgBpm) {
      // half and double time are the same pulse for mixing purposes
      const d = Math.min(Math.abs(bpm - p.avgBpm), Math.abs(bpm / 2 - p.avgBpm), Math.abs(bpm * 2 - p.avgBpm));
      s += d <= 4 ? 5 : d <= 8 ? 3 : d > 16 ? -2 : 0;
    }
    // a metal reference must not return house just because the numbers line up
    if (p.family) s += fam === p.family ? 4 : (fam ? -12 : 0);
    if (p.keys && p.keys.includes(key)) s += 2;
  }

  // taste: what you actually play, like and file
  s += Math.min(Number(t.plays) || 0, 10) / 5;
  s += Number(t.liked) ? 2 : 0;
  s += Math.min(Number(t.npl) || 0, 3);
  // library building: unplayed tracks deserve a chance, but only after taste
  if (!Number(t.plays)) s += 2.2;
  if (Number(t.owned)) s += 0.5;
  if (bpm) s += 0.5;
  if (t.key) s += 0.5;
  return s;
}

function reason(ctx, picked) {
  const bits = [];
  // a style already says what this is; the leftover words are noise ("Ware from your library")
  if (ctx.text && ctx.text.length && picked.length && !ctx.style && !ctx.mood && !ctx.reference) {
    // instructions are not search terms: "set of 12, some I dont have" is not a title
    const FILLER = /^(include|including|some|any|ones|tracks|songs|track|song|that|which|i|dont|don't|have|has|not|no|in|my|library|new|find|more|from|the|a|an|and|or|with|of|for|to|please|create|make|build|playlist|crate|set|me|of)$/i;
    const words = ctx.text.filter((w) => !FILLER.test(String(w)));
    if (words.length) bits.push(`${words.join(' ')} from your library`);
  }
  if (ctx.style) bits.push(ctx.style.label);
  if (ctx.mood) bits.push(ctx.mood.label);
  if (ctx.referenceProfile) bits.push(`follows ${ctx.referenceProfile.artist}: ${ctx.referenceProfile.avgBpm} BPM, ${ctx.referenceProfile.family || 'mixed family'}`);
  else if (ctx.reference) bits.push(`You do not have ${ctx.reference} yet, so this follows the request instead`);
  if (!picked.length) bits.push('nothing in your library matched');
  else if (picked.length < ctx.count) bits.push(`${picked.length} in your library fit`);
  return bits.join('. ') + '.';
}

function select(db, query, count) {
  const ctx = detect(query);
  ctx.count = Math.max(1, Math.min(Number(count) || 20, 100));
  ctx.referenceProfile = ctx.reference ? artistProfile(db, ctx.reference) : null;
  const parsed = queryEngine.parse(query, db);
  ctx.text = parsed.text || [];
  ctx.genre = parsed.genre || null;
  ctx.family = parsed.family || null;

  let rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.bpm, t.key, t.key_scale, t.energy,
      t.genre, t.genre_family,
      (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned,
      (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) plays,
      (SELECT COUNT(*) FROM likes lk WHERE lk.track_id=t.id) liked,
      (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.track_id=t.id) npl
    FROM tracks t`).all();

  let avoid = [];
  try {
    const s = JSON.parse(fs.readFileSync('/opt/musicfy/data/settings.json', 'utf8'));
    avoid = exclude.parse(s.taste_avoid || '');
  } catch {}
  // asking for a banned thing by name overrides the ban for that request
  const qLower = String(query || '').toLowerCase();
  avoid = avoid.filter((w) => !qLower.includes(w));
  if (avoid.length) rows = rows.filter((t) => !exclude.matches(avoid, t));
  // a genre word that the library does not use must not empty the result: ask for
  // "ambient" in a library tagged electronic and you still want the ambient-leaning
  // tracks, not a shrug. The style below decides when the family is unknown.
  if (ctx.genre) {
    const hit = rows.filter((t) => String(t.genre || '').toLowerCase() === String(ctx.genre).toLowerCase());
    if (hit.length) rows = hit;
  }
  if (ctx.family) {
    const hit = rows.filter((t) => String(t.genre_family || '').toLowerCase() === String(ctx.family).toLowerCase());
    if (hit.length) rows = hit;
  }
  if (!ctx.style && !ctx.mood && !ctx.reference && ctx.text.length) {
    const words = ctx.text.map((w) => w.toLowerCase());
    rows = rows.filter((t) => {
      const hay = `${t.title || ''} ${t.artist || ''} ${t.album || ''}`.toLowerCase();
      return words.some((w) => hay.includes(w));
    });
  }

  const excluded = ctx.referenceProfile ? ctx.referenceProfile.artist.toLowerCase() : null;
  const scored = rows
    .filter((t) => !excluded || String(t.artist || '').toLowerCase() !== excluded)
    .map((t) => ({ ...t, score: score(t, ctx) }))
    .sort((a, b) => b.score - a.score);

  // constraints first: a style keeps its families when the library can afford it
  let pool = scored;
  if (ctx.style) {
    const famOf = (t) => String(t.genre_family || '').toLowerCase();
    const famMatch = scored.filter((t) => ctx.style.families.includes(famOf(t)));
    // enough tagged tracks: stay strict. Otherwise allow untagged tracks, never a
    // known wrong family (pop, metal, hip hop) just to fill the count.
    if (famMatch.length >= ctx.count) pool = famMatch;
    else if (famMatch.length) pool = scored.filter((t) => !famOf(t) || ctx.style.families.includes(famOf(t)));
  }
  // a downtempo request must not return a 123 BPM track
  if (ctx.style && ctx.style.bpm) {
    const inside = pool.filter((t) => t.bpm && inBpm(Number(t.bpm), ctx.style.bpm));
    if (inside.length >= ctx.count) pool = inside;
    else if (inside.length) {
      // most of a young library has no BPM yet: keep what fits and let the unanalysed
      // ones in behind it rather than returning three tracks when ten were asked for
      pool = [...inside, ...pool.filter((t) => !t.bpm)];
    }
  }
  // a reference artist with a known family stays in that family, even if short;
  // silently swapping metal for house because the BPM matches is worse than saying so
  if (ctx.referenceProfile && ctx.referenceProfile.family) {
    const fam = String(ctx.referenceProfile.family).toLowerCase();
    const same = pool.filter((t) => String(t.genre_family || '').toLowerCase() === fam);
    if (same.length) pool = same;
  }

  // Burning Man is a journey, not twelve tracks at the same tempo
  if (ctx.style && ctx.style.id === 'burningman') {
    const buckets = [[95, 109.99], [110, 119.99], [120, 128.01]];
    const lists = buckets.map(([min, max]) => pool.filter((t) => Number(t.bpm) >= min && Number(t.bpm) <= max));
    const mixed = [];
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest; i += 1) {
      for (const l of lists) if (l[i] && !mixed.includes(l[i])) mixed.push(l[i]);
    }
    for (const t of pool) if (!mixed.includes(t)) mixed.push(t);
    pool = mixed;
  }

  // do not let one artist take over the crate
  const picked = [];
  const perArtist = new Map();
  for (const t of pool) {
    if (picked.length >= ctx.count) break;
    const a = String(t.artist || '').toLowerCase();
    const n = perArtist.get(a) || 0;
    if (n >= 2) continue;
    perArtist.set(a, n + 1);
    picked.push(t);
  }
  for (const t of pool) {
    if (picked.length >= ctx.count) break;
    if (!picked.includes(t)) picked.push(t);
  }

  return { tracks: picked, ctx, reason: reason(ctx, picked) };
}

module.exports = { detect, select, artistProfile };
