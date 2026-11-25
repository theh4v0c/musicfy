'use strict';
// Find artwork for tracks that have none, using the public iTunes search API.
// No account, no key, returns a 600x600 crop.
const https = require('node:https');
const deezer = require('./deezer');

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'MUSICFY/1.0', accept: 'application/json' }, timeout: 15000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('itunes ' + r.statusCode)); }
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { body += c; });
      r.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('timeout', function () { this.destroy(new Error('itunes timeout')); }).on('error', reject);
  });
}

async function artworkFor(artist, title) {
  const term = encodeURIComponent(`${artist || ''} ${title || ''}`.trim());
  if (!term) return null;
  const data = await getJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`);
  const results = (data && data.results) || [];
  if (!results.length) return null;
  const wantTitle = String(title || '').toLowerCase();
  const wantArtist = String(artist || '').toLowerCase();
  const pick = results.find((r) => String(r.trackName || '').toLowerCase().includes(wantTitle)
    && String(r.artistName || '').toLowerCase().includes(wantArtist.split(/[,&]/)[0].trim())) || results[0];
  const url = pick && pick.artworkUrl100;
  if (!url) return null;
  return url.replace('100x100bb', '600x600bb');
}

async function artworkForAlbum(album, artist) {
  if (!album) return artworkFor(artist, '');
  const want = String(album).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wantArtist = String(artist || '').toLowerCase().split(/[,&]/)[0].trim();

  // Deezer first: its album search returns the artist with the title, which is the only
  // way a one-word album ("Green") can be resolved. iTunes does not carry every record.
  try {
    const hits = await deezer.searchAlbums(`${artist || ''} ${album}`.trim(), 20);
    const exact = hits.find((r) => {
      const name = String(r.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return name === want && (!wantArtist || String(r.artist || '').toLowerCase().includes(wantArtist));
    });
    if (exact && exact.cover) return exact.cover.replace(/\/1000x1000-.*$/, '/600x600-000000-80-0-0.jpg');
  } catch {}

  const term = encodeURIComponent(`${artist || ''} ${album}`.trim());
  try {
    const data = await getJson(`https://itunes.apple.com/search?term=${term}&entity=album&limit=8`);
    const results = (data && data.results) || [];
    const pick = results.find((r) => {
      const name = String(r.collectionName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const by = String(r.artistName || '').toLowerCase();
      return name === want && (!wantArtist || by.includes(wantArtist));
    });
    // no exact artist+album match is better than a different record's cover
    const url = pick && pick.artworkUrl100;
    return url ? url.replace('100x100bb', '600x600bb') : null;
  } catch { return null; }
}

module.exports = { artworkFor, artworkForAlbum };
