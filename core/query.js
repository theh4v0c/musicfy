'use strict';
// Deterministic query engine over the library. No model involved: if the question can be
// answered from the database, this answers it exactly.
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

function parseKey(text) {
  const m = text.match(/\b(?:in|key of)\s+([A-G])([#b♯]?)\s*(m|maj|min|minor|major)?\b/i);
  if (!m) return null;
  let note = m[1].toUpperCase() + (m[2] === 'b' ? 'b' : m[2] ? '#' : '');
  note = FLAT[note] || note;
  if (!NOTES.includes(note)) return null;
  const minor = /^(m|min|minor)$/i.test(m[3] || '');
  return { key: note, scale: minor ? 'minor' : 'major' };
}

function parseBpm(text) {
  const range = text.match(/between\s+(\d{2,3})\s*(?:and|-|to)\s*(\d{2,3})\s*bpm/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const over = text.match(/(?:above|over|faster than|>)\s*(\d{2,3})\s*bpm/i);
  if (over) return { min: Number(over[1]) };
  const under = text.match(/(?:below|under|slower than|<)\s*(\d{2,3})\s*bpm/i);
  if (under) return { max: Number(under[1]) };
  const around = text.match(/(?:around|about|near|~)\s*(\d{2,3})\s*bpm/i);
  if (around) { const v = Number(around[1]); return { min: v - 4, max: v + 4 }; }
  const exact = text.match(/(\d{2,3})\s*bpm/i);
  if (exact) { const v = Number(exact[1]); return { min: v - 2, max: v + 2 }; }
  return null;
}

function parseLimit(text, fallback = 50) {
  // the first number in a sentence is usually a tempo or a year: "tracks between 120 and
  // 130 bpm" set limit=120. A limit has to be said as a count.
  const m = text.match(/\b(\d{1,3})\s+(?:songs?|tracks?|items?)\b/i)
    || text.match(/^\s*(\d{1,3})\s*$/);
  if (!m) return fallback;
  const v = Number(m[1]);
  return v > 0 && v <= 500 ? v : fallback;
}

function parse(text, db) {
  const q = String(text || '').toLowerCase();
  const filters = { limit: parseLimit(q), order: 'relevance' };
  const notes = [];

  const key = parseKey(q);
  if (key) { filters.key = key.key; filters.scale = key.scale; notes.push(`key ${key.key} ${key.scale}`); }

  const bpm = parseBpm(q);
  if (bpm) { filters.bpm = bpm; notes.push(`bpm ${bpm.min || 0}-${bpm.max || 'any'}`); }

  if (/\b(not downloaded|no audio|missing|without audio|not local)\b/.test(q)) { filters.owned = false; notes.push('no local audio'); }
  else if (/\b(downloaded|local|owned|downloaded already)\b/.test(q)) { filters.owned = true; notes.push('has audio'); }

  if (/\b(never played|not played|unplayed)\b/.test(q)) { filters.plays = { max: 0 }; notes.push('never played'); }
  else {
    const p = q.match(/played\s*(?:more than|over|at least)?\s*(\d{1,4})\s*(?:times|x)?/);
    if (p) { filters.plays = { min: Number(p[1]) }; notes.push(`played at least ${p[1]} times`); }
  }

  const decades = q.match(/\b(\d{2})s\b/);
  if (decades) {
    const d = Number(decades[1]);
    const start = d >= 50 ? 1900 + d : 2000 + d;
    filters.year = { min: start, max: start + 9 };
    notes.push(`years ${start}-${start + 9}`);
  }
  const yRange = q.match(/\b(19|20)(\d{2})\s*(?:-|to|through)\s*(19|20)(\d{2})\b/);
  if (yRange) {
    const a = Number(yRange[1] + yRange[2]);
    const b = Number(yRange[3] + yRange[4]);
    filters.year = { min: Math.min(a, b), max: Math.max(a, b) };
    notes.push(`years ${filters.year.min}-${filters.year.max}`);
  }
  const yOne = q.match(/\b(19|20)\d{2}\b/);
  if (yOne && !filters.year) { filters.year = { min: Number(yOne[0]), max: Number(yOne[0]) }; notes.push(`year ${yOne[0]}`); }

  // genre: match against what the library actually contains
  const genres = db.prepare("SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL AND genre != ''").all().map((r) => r.genre);
  for (const g of genres) {
    if (q.includes(String(g).toLowerCase())) { filters.genre = g; notes.push(`genre ${g}`); break; }
  }
  if (!filters.genre) {
    const family = { metal: '%metal%', electronic: '%electronic%', techno: '%techno%', house: '%house%', ambient: '%ambient%', jazz: '%jazz%', classical: '%classical%', hip: '%hip%' };
    for (const [word] of Object.entries(family)) {
      if (q.includes(word)) { filters.family = word; notes.push(`genre ${word}`); break; }
    }
  }

  if (/\b(random|shuffle|mix it up|any)\b/.test(q)) filters.order = 'random';
  else if (/\b(newest|recent|latest|added recently)\b/.test(q)) filters.order = 'newest';
  else if (/\b(oldest|earliest)\b/.test(q)) filters.order = 'oldest';
  else if (/\b(most played|top|popular|trending|favourite|favorite)\b/.test(q)) filters.order = 'plays';

  // strip everything already understood, then whatever remains is free text
  let work = q;
  const consumed = [
    /\b(?:in|key of)\s+[a-g][#b♯]?\s*(?:m|maj|min|minor|major)?\b/gi,
    /\b(?:between\s+\d{2,3}\s*(?:and|-|to)\s*\d{2,3}|(?:above|over|below|under|around|about|near)\s*\d{2,3}|\d{2,3})\s*bpm\b/gi,
    /\b(?:not\s+)?(?:downloaded|local|owned|downloaded already)\b/gi,
    /\b(?:no|without)\s+(?:local\s+)?audio\b/gi,
    /\b(?:never|not)\s+played\b/gi,
    /\bplayed\s*(?:more than|over|at least)?\s*\d{1,4}\s*(?:times|x)?\b/gi,
    /\b\d{2}s\b/gi,
    /\b(?:19|20)\d{2}\s*(?:-|to|through)\s*(?:19|20)\d{2}\b/gi,
    /\b(?:19|20)\d{2}\b/g,
  ];
  for (const re of consumed) work = work.replace(re, ' ');
  if (filters.genre) work = work.replace(new RegExp(String(filters.genre).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  for (const w of ['metal','electronic','techno','house','ambient','jazz','classical','hip','hop']) work = work.replace(new RegExp('\\b' + w + '\\b', 'gi'), ' ');

  // whatever is left of the sentence is treated as text over title, artist and album
  const stop = new Set(['the','a','an','my','me','of','in','for','with','and','or','to','from','that','which','are','is','do','does','did','i','have','has','what','who','when','where','how','any','some','all','please','list','give','show','find','create','make','build','playlist','songs','song','tracks','track','never','played','want','need','like','by','on','at','key','bpm','played','times','not','no','audio','downloaded','local','owned','random','shuffle','newest','oldest','most','top','popular','trending','between','above','below','over','under','around','about','near','kids','kid','children','child','can','could','would','should','you','your','yours','assist','help','able','tell','know','explain','capability','capabilities','commands','command','there','it','this','us','we','rated','rating','ratings','best']);
  const rest = work.replace(/[^a-z0-9#\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w));
  if (rest.length) { filters.text = rest.slice(0, 6); notes.push(`text ${rest.slice(0, 6).join(' ')}`); }

  filters.notes = notes;
  return filters;
}

function run(db, filters) {
  const where = [];
  const params = [];
  if (filters.key) { where.push('t.key = ?'); params.push(filters.key); }
  if (filters.scale) { where.push('t.key_scale = ?'); params.push(filters.scale); }
  if (filters.bpm) {
    if (filters.bpm.min) { where.push('t.bpm >= ?'); params.push(filters.bpm.min); }
    if (filters.bpm.max) { where.push('t.bpm <= ?'); params.push(filters.bpm.max); }
  }
  if (filters.year) { where.push('t.year BETWEEN ? AND ?'); params.push(filters.year.min, filters.year.max); }
  if (filters.genre) where.push(`(lower(t.genre) = lower(?) OR lower(COALESCE(t.genre_family,'')) = lower(?))`), params.push(filters.genre, filters.genre);
  if (filters.genreLike) {
    where.push(`(lower(COALESCE(t.genre,'')) LIKE ? OR lower(COALESCE(t.genre_family,'')) LIKE ?)`);
    params.push(filters.genreLike, filters.genreLike);
  }
  if (filters.family) { where.push("lower(COALESCE(t.genre_family,'')) = ?"); params.push(filters.family); }
  if (filters.owned === true) where.push("EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')");
  if (filters.owned === false) where.push("NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')");
  if (filters.plays) {
    if (filters.plays.min !== undefined) { where.push('(SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) >= ?'); params.push(filters.plays.min); }
    if (filters.plays.max !== undefined) { where.push('(SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) <= ?'); params.push(filters.plays.max); }
  }
  if (filters.text && filters.text.length) {
    const like = filters.text.map(() => "(lower(t.title) LIKE ? OR lower(COALESCE(t.artist,'')) LIKE ? OR lower(COALESCE(t.album,'')) LIKE ?)");
    where.push('(' + like.join(' OR ') + ')');
    for (const w of filters.text) params.push(`%${w}%`, `%${w}%`, `%${w}%`);
  }

  const order = filters.order === 'random' ? 'RANDOM()'
    : filters.order === 'newest' ? 't.added_at DESC'
    : filters.order === 'oldest' ? 't.added_at ASC'
    : filters.order === 'plays' ? 'plays DESC'
    : 't.title ASC';

  const sql = `SELECT t.id, t.title, t.artist, t.album, t.genre, t.year, t.bpm, t.key, t.key_scale, t.duration,
      (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) plays,
      (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned
    FROM tracks t
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order} LIMIT ?`;
  return db.prepare(sql).all(...params, filters.limit || 50);
}

module.exports = { parse, run };
