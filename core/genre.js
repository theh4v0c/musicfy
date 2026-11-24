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
  ['electronic', /\b(electronic|techno|house|ambient|idm|drum and bass|dnb|dubstep|trance|electro|breakbeat|downtempo|garage|bass)\b/i],
  ['hip hop', /\b(hip hop|hip-hop|rap|trap|grime)\b/i],
  ['jazz', /\b(jazz|swing|bebop|fusion)\b/i],
  ['classical', /\b(classical|orchestra|baroque|romantic era|chamber|opera|piano)\b/i],
  ['rock', /\b(rock|punk|indie|shoegaze|post-punk|grunge|alternative)\b/i],
  ['folk', /\b(folk|acoustic|country|bluegrass|americana)\b/i],
  ['soul', /\b(soul|funk|r&b|rhythm and blues|disco|motown)\b/i],
  ['reggae', /\b(reggae|dub|dancehall|ska)\b/i],
  ['pop', /\b(pop|synthpop|eurodance|boy band)\b/i],
];

function familyOf(genres) {
  for (const [name, re] of FAMILIES) {
    if (genres.some((g) => re.test(g))) return name;
  }
  return null;
}

async function fetchArtistTags(artist) {
  const c = load();
  const key = String(artist || '').toLowerCase().trim();
  if (!key) return null;
  if (c[key]) return c[key];
  const q = encodeURIComponent(`artist:"${artist}"`);
  const url = `https://musicbrainz.org/ws/2/artist?query=${q}&fmt=json&limit=3`;
  let data = null;
  let lastErr = null;
  // MusicBrainz throttles hard: back off instead of recording a permanent miss
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await throttle();
    try { data = await getJson(url); lastErr = null; break; }
    catch (e) {
      lastErr = e;
      if (!/50[0-9]|429/.test(String(e.message))) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (!data) {
    if (lastErr && !/50[0-9]|429/.test(String(lastErr.message))) {
      c[key] = { genres: [], family: null, err: String(lastErr.message), at: Date.now() };
      save();
    }
    return { genres: [], family: null, err: lastErr ? String(lastErr.message) : 'no data' };
  }
  const list = (data && data.artists) || [];
  const best = list.find((a) => String(a.name || '').toLowerCase() === key) || list[0];
  let genres = ((best && best.tags) || []).sort((a, b) => (b.count || 0) - (a.count || 0)).map((t) => t.name).slice(0, 6);
  const entry = { genres, family: familyOf(genres), at: Date.now() };
  c[key] = entry;
  save();
  return entry;
}

async function fillTracks(db, { limit = 100 } = {}) {
  const rows = db.prepare(`SELECT DISTINCT artist FROM tracks
    WHERE (genre IS NULL OR genre = '') AND artist IS NOT NULL AND artist != '' LIMIT ?`).all(limit);
  let tagged = 0, families = 0, looked = 0;
  for (const row of rows) {
    looked += 1;
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

module.exports = { fillTracks, fetchArtistTags, FAMILIES };
