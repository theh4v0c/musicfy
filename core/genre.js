'use strict';
const paths = require('./paths');
const nodePath = require('node:path');
// Genre comes from MusicBrainz artist tags, not from guessing. Free, no account,
// one request per artist, cached on disk so the library only costs one pass.
const https = require('node:https');
const fs = require('node:fs');

const CACHE = nodePath.join(paths.DATA, 'genre-cache.json');
const UA = 'MUSICFY/1.0 ( self-hosted music )';
let cache = null;
let lastCall = 0;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { cache = {}; }
  return cache;
}
function save() {
  try { fs.writeFileSync(CACHE, JSON.stringify(load()), { mode: 0o600 }); } catch {}
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': UA, accept: 'application/json' }, timeout: 15000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('mb ' + r.statusCode)); }
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { b += c; });
      r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('timeout', function () { this.destroy(new Error('mb timeout')); }).on('error', reject);
  });
}

const throttle = () => {
  const wait = Math.max(0, 1500 - (Date.now() - lastCall));
  return new Promise((r) => setTimeout(r, wait)).then(() => { lastCall = Date.now(); });
};

// broad families the library can filter on, in priority order
const FAMILIES = [
  ['metal', /\b(metal|doom|sludge|grindcore|death metal|black metal|thrash|hardcore punk)\b/i],
  ['electronic', /\b(electronic|techno|house|microhouse|deep house|tech house|acid house|progressive house|ambient|idm|drum and bass|dnb|dubstep|trance|electro|breakbeat|downtempo|garage|bass|minimal)\b/i],
  ['hip hop', /\b(hip hop|hip-hop|rap|trap|grime)\b/i],
  ['latin', /\b(latin|latin pop|reggaeton|reggaetón|dembow|bachata|cumbia|salsa|merengue|sertanejo|perreo|flamenco)\b/i],
  ['children', /\b(children|kids|nursery|lullaby|bebefinn|pinkfong|cocomelon)\b/i],
  ['soundtrack', /\b(soundtrack|score|film music|video game|musical)\b/i],
  ['jazz', /\b(jazz|swing|bebop|fusion)\b/i],
  ['classical', /\b(classical|orchestra|baroque|romantic era|chamber|opera)\b/i],
  ['blues', /\b(blues|boogie woogie)\b/i],
  ['country', /\b(country|bluegrass|americana|honky tonk)\b/i],
  ['folk', /\b(folk|acoustic|singer-songwriter)\b/i],
  ['soul', /\b(soul|funk|r&b|rhythm and blues|disco|motown)\b/i],
  ['rock', /\b(rock|punk|indie rock|shoegaze|post-punk|grunge|alternative rock)\b/i],
  ['pop', /\b(pop|synthpop|eurodance|boy band)\b/i],
  ['reggae', /\b(reggae|dub|dancehall|ska)\b/i],
  ['gospel', /\b(gospel|worship|christian)\b/i],
];

/* iTunes returns role words where a genre should be ("Composer", "Actress") for odd
   releases. They are not genres, so they never become a family and never get shown. */
const NOT_A_GENRE = /^(composer|actress|actor|writer|producer|manager|author|artist)$/i;

function genreOf(value) {
  const g = String(value || '').trim();
  if (!g || NOT_A_GENRE.test(g)) return null;
  return g;
}

function familyOfString(genre) {
  const g = genreOf(genre);
  if (!g) return null;
  for (const [name, re] of FAMILIES) if (re.test(g)) return name;
  return null;
}

/* Recompute families from the genre text already stored, without the network. Quiet
   rows whose family is missing or no longer matches are corrected; everything else is
   left exactly as it is. */
function reclassify(db) {
  let changed = 0;
  const rows = db.prepare("SELECT id, genre, genre_family FROM tracks WHERE genre IS NOT NULL AND genre != ''").all();
  const upd = db.prepare('UPDATE tracks SET genre_family=? WHERE id=?');
  for (const r of rows) {
    const fam = familyOfString(r.genre);
    // only ever fills a gap or corrects a wrong family; a genre we cannot classify must
    // not erase a family that came from the artist's tags
    if (fam && fam !== (r.genre_family || null)) { upd.run(fam, r.id); changed += 1; }
  }
  return changed;
}

/* Families that came from MusicBrainz artist tags are already on disk; restore them for
   tracks whose genre text cannot be classified, without a network call. */
function restoreFromCache(db) {
  const c = load();
  let filled = 0;
  const rows = db.prepare("SELECT id, artist FROM tracks WHERE genre_family IS NULL AND artist IS NOT NULL AND artist != ''").all();
  const upd = db.prepare('UPDATE tracks SET genre_family=? WHERE id=?');
  for (const r of rows) {
    const hit = c[String(r.artist).toLowerCase().trim()];
    if (hit && hit.family) { upd.run(hit.family, r.id); filled += 1; }
  }
  return filled;
}

function familyOf(genres) {
  for (const [name, re] of FAMILIES) {
    if (genres.some((g) => re.test(g))) return name;
  }
  return null;
}

/* A tag string can name several people: "Oxia, Robag Wruhme" is not an artist, so a
   single MusicBrainz query for it returns nothing. Try each name, first hit wins — this is
   why a library full of collaborations used to tag nothing at all. */
function artistCandidates(name) {
  return String(name || '')
    .split(/\s*(?:,|;|&|\bfeat\.?\b|\bft\.?\b|\bvs\.?\b|\bx\b)\s*/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 1 && !/^[|_\-.\s]+$/.test(x))
    .slice(0, 3);
}

async function lookupOne(artist) {
  const c = load();
  const key = String(artist || '').toLowerCase().trim();
  if (!key) return null;
  if (c[key] && !c[key].err) return c[key];
  if (c[key] && c[key].err) delete c[key];
  const q = encodeURIComponent(`artist:"${artist}"`);
  const url = `https://musicbrainz.org/ws/2/artist?query=${q}&fmt=json&limit=3`;
  let data = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await throttle();
    try { data = await getJson(url); lastErr = null; break; }
    catch (e) {
      lastErr = e;
      if (!/50[0-9]|429/.test(String(e.message))) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (!data) return { genres: [], family: null, err: lastErr ? String(lastErr.message) : 'no data' };
  const list = (data && data.artists) || [];
  const best = list.find((a) => String(a.name || '').toLowerCase() === key) || list[0];
  const genres = ((best && best.tags) || []).sort((a, b) => (b.count || 0) - (a.count || 0)).map((t) => t.name).slice(0, 6);
  const entry = { genres, family: familyOf(genres), at: Date.now() };
  c[key] = entry;
  save();
  return entry;
}

async function fetchArtistTags(artist) {
  const c = load();
  const key = String(artist || '').toLowerCase().trim();
  if (!key) return null;
  const cached = c[key];
  // a hit is final; an empty result is only final for a single name, because a
  // collaboration string has to be split before anyone can answer for it
  if (cached && cached.genres && cached.genres.length) return cached;
  // a single-name miss is cached, but not forever: MusicBrainz gains tags, and a miss
  // from two years ago is a guess about today. Collaborations always retry.
  const MISS_TTL = 90 * 86400 * 1000;
  if (cached && !cached.err && artistCandidates(artist).length <= 1 && Date.now() - (cached.at || 0) < MISS_TTL) return cached;
  for (const cand of artistCandidates(artist)) {
    const entry = await lookupOne(cand);
    if (entry && entry.genres && entry.genres.length) {
      const merged = { genres: entry.genres, family: entry.family, from: cand, at: Date.now() };
      c[key] = merged;
      save();
      return merged;
    }
  }
  // genuinely untagged: remember the miss, but without an error flag so it can retry later
  c[key] = { genres: [], family: null, at: Date.now() };
  save();
  return c[key];
}

async function fillTracks(db, { limit = 100, onProgress = null } = {}) {
  const rows = db.prepare(`SELECT DISTINCT artist FROM tracks
    WHERE (genre IS NULL OR genre = '') AND artist IS NOT NULL AND artist != '' LIMIT ?`).all(limit);
  let tagged = 0, families = 0, looked = 0;
  for (const row of rows) {
    looked += 1;
    if (onProgress) { try { onProgress({ checked: looked, tagged, families }); } catch {} }
    const info = await fetchArtistTags(row.artist);
    if (!info || !info.genres || !info.genres.length) continue;
    const primary = info.genres[0];
    db.prepare("UPDATE tracks SET genre=? WHERE artist=? AND (genre IS NULL OR genre='')").run(primary, row.artist);
    tagged += 1;
    if (info.family) {
      db.prepare('UPDATE tracks SET genre_family=? WHERE artist=?').run(info.family, row.artist);
      families += 1;
    }
  }
  const remaining = db.prepare("SELECT COUNT(DISTINCT artist) c FROM tracks WHERE (genre IS NULL OR genre='') AND artist IS NOT NULL AND artist != ''").get().c;
  return { artistsChecked: looked, tagged, families, remainingArtists: remaining };
}

module.exports = { fillTracks, fetchArtistTags, familyOf, familyOfString, genreOf, reclassify, restoreFromCache, FAMILIES };
