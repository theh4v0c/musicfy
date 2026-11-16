'use strict';
// Canonical identity from the iTunes search API: free, no key, no account, and it
// returns exact duration, album, year and a coarse genre. MusicBrainz stays as the
// ISRC source but it rate limits hard, so it is optional here.
const https = require('node:https');
const fs = require('node:fs');

const CACHE = '/opt/musicfy/data/identity-cache.json';
let cache = null;
let lastCall = 0;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { cache = {}; }
  return cache;
}
function save() { try { fs.writeFileSync(CACHE, JSON.stringify(load()), { mode: 0o600 }); } catch {} }

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'MUSICFY/1.0', accept: 'application/json' }, timeout: 12000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('itunes ' + r.statusCode)); }
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { b += c; });
      r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('timeout', function () { this.destroy(new Error('itunes timeout')); }).on('error', reject);
  });
}

const throttle = () => {
  const wait = Math.max(0, 350 - (Date.now() - lastCall));
  return new Promise((r) => setTimeout(r, wait)).then(() => { lastCall = Date.now(); });
};

const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  return common / Math.max(A.size, B.size);
}

const FAMILY_OF_GENRE = [
  ['metal', /metal|hardcore|death|black metal|thrash|grindcore/i],
  ['electronic', /electronic|techno|house|dance|edm|ambient|drum|bass|dubstep|trance|garage|breakbeat|idm|experimental/i],
  ['hip hop', /hip[- ]?hop|rap|trap|grime/i],
  ['jazz', /jazz|swing|bebop/i],
  ['classical', /classical|orchestra|opera|baroque|piano|chamber/i],
  ['rock', /rock|punk|indie|alternative|shoegaze|grunge/i],
  ['folk', /folk|country|acoustic|americana|bluegrass/i],
  ['soul', /soul|funk|r&b|rhythm|disco|motown/i],
  ['reggae', /reggae|dub|dancehall|ska/i],
  ['pop', /pop|vocal|singer/i],
];

function familyOf(genre) {
  for (const [name, re] of FAMILY_OF_GENRE) if (re.test(String(genre || ''))) return name;
  return null;
}

// one call, exact identity
async function canon(artist, title) {
  const key = `${norm(artist)}|${norm(title)}`;
  const c = load();
  if (c[key] && Date.now() - c[key].at < 30 * 24 * 3600 * 1000) return c[key].hit || null;

  await throttle();
  const term = encodeURIComponent(`${artist} ${title}`.trim());
  let data;
  try { data = await getJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=8`); }
  catch { return null; }

  const results = (data && data.results) || [];
  if (!results.length) { c[key] = { at: Date.now(), hit: null }; save(); return null; }

  let best = null;
  const haveArtist = !!String(artist || '').trim();
  for (const r of results) {
    // when the caller only has a query string, judge on the title alone
    const score = haveArtist
      ? similarity(r.artistName, artist) * 0.6 + similarity(r.trackName, title) * 0.4
      : similarity(r.trackName, title);
    if (!best || score > best.score) {
      best = {
        score,
        title: r.trackName,
        artist: r.artistName,
        album: r.collectionName,
        duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : null,
        genre: r.primaryGenreName || null,
        family: familyOf(r.primaryGenreName),
        year: r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) : null,
        itunesId: r.trackId,
      };
    }
  }
  const out = best && best.score >= (haveArtist ? 0.5 : 0.6) ? best : null;
  c[key] = { at: Date.now(), hit: out };
  save();
  return out;
}

// free text form, used when the caller only has a query string
async function canonQuery(q) {
  const s = String(q || '').trim();
  if (!s) return null;
  const dash = s.match(/^(.+?)\s+-\s+(.+)$/);
  if (dash) {
    const hit = await canon(dash[1], dash[2]);
    if (hit) return hit;
  }
  // no dash: try the first words as the artist and the rest as the title
  const words = s.split(/\s+/).filter(Boolean);
  // people type both orders: "artist title" and "title artist"
  const splits = [];
  for (let i = 1; i <= Math.min(3, words.length - 1); i += 1) splits.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  for (let i = 1; i <= Math.min(3, words.length - 1); i += 1) splits.push([words.slice(-i).join(' '), words.slice(0, -i).join(' ')]);
  for (const [artist, title] of splits) {
    const hit = await canon(artist, title).catch(() => null);
    if (hit) return hit;
  }
  return canon('', s).catch(() => null);
}

// browse the catalogue the way a music app does: songs, albums and artists for a query
async function catalog(query, { songs = 40, albums = 12, artists = 6 } = {}) {
  const term = encodeURIComponent(String(query || '').trim());
  if (!term) return { songs: [], albums: [], artists: [] };
  const fetchEntity = async (entity, limit) => {
    await throttle();
    try {
      const data = await getJson(`https://itunes.apple.com/search?term=${term}&entity=${entity}&limit=${limit}`);
      return (data && data.results) || [];
    } catch { return []; }
  };
  const [trackRows, albumRows, artistRows] = await Promise.all([
    fetchEntity('song', songs),
    fetchEntity('album', albums),
    fetchEntity('musicArtist', artists),
  ]);
  return {
    songs: trackRows.map((r) => ({
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName,
      duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : null,
      genre: r.primaryGenreName || null,
      family: familyOf(r.primaryGenreName),
      year: r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) : null,
      artwork: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '300x300bb') : null,
    })),
    albums: albumRows.map((r) => ({
      name: r.collectionName,
      artist: r.artistName,
      year: r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) : null,
      tracks: r.trackCount || null,
      artwork: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '300x300bb') : null,
    })),
    artists: artistRows.map((r) => ({
      name: r.artistName,
      genre: r.primaryGenreName || null,
      artwork: null,
    })),
  };
}

module.exports = { canon, canonQuery, familyOf, catalog };
