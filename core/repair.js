'use strict';
// Metadata repair: the catalogue says what the track really is, the model only decides
// how to present it. Nothing is written without an explicit apply.
const identity = require('./identity');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function propose(db, trackId) {
  const t = db.prepare('SELECT id, title, artist, album, year, genre, genre_family, bpm, key, duration, meta_locked FROM tracks WHERE id=?').get(trackId);
  if (!t) return null;
  let c = null;
  try { c = await identity.canon(t.artist || '', t.title || ''); } catch {}

  const proposal = {
    id: t.id,
    before: { title: t.title, artist: t.artist, album: t.album, year: t.year, genre: t.genre },
    after: {},
    reasons: [],
    confidence: 0,
  };

  // a field edited by hand is authoritative: the catalogue is a suggestion, not an
  // override. Without this, "Fix metadata" reverted a corrected album to whichever
  // release the catalogue happened to match.
  const locked = new Set(String(t.meta_locked || '').split(',').map((x) => x.trim()).filter(Boolean));
  if (c) {
    proposal.confidence = Math.round((c.score || 0) * 100);
    const titleDiffers = norm(c.title) !== norm(t.title);
    const artistDiffers = norm(c.artist) !== norm(t.artist);
    if (titleDiffers && !locked.has('title')) { proposal.after.title = c.title; proposal.reasons.push(`title: "${t.title}" -> "${c.title}"`); }
    if (artistDiffers && !locked.has('artist')) { proposal.after.artist = c.artist; proposal.reasons.push(`artist: "${t.artist}" -> "${c.artist}"`); }
    if (c.album && norm(c.album) !== norm(t.album) && !locked.has('album')) { proposal.after.album = c.album; proposal.reasons.push(`album: "${t.album || ''}" -> "${c.album}"`); }
    if (c.year && Number(c.year) !== Number(t.year) && !locked.has('year')) { proposal.after.year = c.year; proposal.reasons.push(`year: ${t.year || '-'} -> ${c.year}`); }
    if (c.genre && norm(c.genre) !== norm(t.genre) && !locked.has('genre')) { proposal.after.genre = c.genre; proposal.reasons.push(`genre: "${t.genre || ''}" -> "${c.genre}"`); }
    if (c.family && c.family !== t.genre_family && !locked.has('genre_family')) proposal.after.genre_family = c.family;
  } else {
    proposal.reasons.push('no catalogue match, nothing to compare against');
  }
  proposal.changed = Object.keys(proposal.after).length > 0;
  return proposal;
}

function apply(db, trackId, fields) {
  const allowed = ['title', 'artist', 'album', 'year', 'genre', 'genre_family'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (fields[k] === undefined) continue;
    sets.push(`${k}=?`);
    params.push(fields[k] === '' ? null : fields[k]);
  }
  if (!sets.length) return { changed: 0 };
  // keep the identity key in step with the corrected title and artist. An album or
  // year edit is not an identity change, so a duplicate elsewhere must not block it.
  const cur = db.prepare('SELECT title, artist FROM tracks WHERE id=?').get(trackId);
  if (!cur) return { changed: 0 };
  const titleChanged = fields.title !== undefined && norm(fields.title) !== norm(cur.title);
  const artistChanged = fields.artist !== undefined && norm(fields.artist) !== norm(cur.artist);
  if (titleChanged || artistChanged) {
    const title = fields.title !== undefined ? fields.title : cur.title;
    const artist = fields.artist !== undefined ? fields.artist : cur.artist;
    const dupKey = `${norm(artist)}|${norm(title)}`;
    const clash = db.prepare('SELECT id FROM tracks WHERE dup_key=? AND id != ?').get(dupKey, trackId);
    if (clash) return { changed: 0, error: 'another track already has that title and artist', clash: clash.id };
    sets.push('dup_key=?');
    params.push(dupKey);
  }
  sets.push('updated_at=?');
  params.push(Math.floor(Date.now() / 1000), trackId);
  db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id=?`).run(...params);
  return { changed: sets.length - (titleChanged || artistChanged ? 2 : 1) };
}

module.exports = { propose, apply };
