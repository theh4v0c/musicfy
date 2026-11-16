'use strict';
// Find artwork for tracks that have none, using the public iTunes search API.
// No account, no key, returns a 600x600 crop.
const https = require('node:https');

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

module.exports = { artworkFor };
