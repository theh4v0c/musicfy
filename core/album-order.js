'use strict';
/* Album order is part of the record, not of the view. The catalogue knows the running
 * order of a release; a download often arrives without track numbers. This module lines
 * the two up and writes the missing numbers to the track, so the order survives an
 * offline start, a catalogue hiccup and an export. It never overwrites a number that is
 * already on the track: a person's tag or an earlier correction wins. */

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// how close two durations have to be before a missing title match may use them
const DURATION_SLACK = 5;

function catalogueMaps(list) {
  const byTitle = new Map();
  const all = [];
  list.forEach((s, i) => {
    const key = norm(s.title);
    if (key && !byTitle.has(key)) byTitle.set(key, { s, i });
    if (Number(s.duration) > 0) all.push({ s, i, d: Number(s.duration) });
  });
  return { byTitle, all };
}

function matchRow(row, maps, used) {
  const hit = maps.byTitle.get(norm(row.title));
  if (hit && !used.has(hit.i)) return hit;
  const dur = Number(row.duration);
  if (!dur) return null;
  // durations are only a fallback: a unique, still-unclaimed entry within a few
  // seconds. Two versions of one song are a coin toss, so no match is better.
  const near = maps.all.filter((x) => !used.has(x.i) && Math.abs(x.d - dur) <= DURATION_SLACK);
  return near.length === 1 ? near[0] : null;
}

/* rows: track rows with id,title,duration,track_no,disc_no.
 * list: catalogue entries { title, trackNumber, discNumber, duration } in running order.
 * Returns the same rows, sorted, with missing numbers written to the database. */
function apply(db, rows, list, opts = {}) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(list) || !list.length) return rows;
  const maps = catalogueMaps(list);
  const used = new Set();
  const hits = [];
  for (const row of rows) {
    const hit = matchRow(row, maps, used);
    if (hit) { used.add(hit.i); hits.push({ row, hit }); }
  }
  // a catalogue release that shares almost no titles is a different album with the
  // same name ("Alive"); numbering from it would be worse than leaving the rows alone
  const coverage = hits.length / Math.min(rows.length, list.length);
  if (rows.length >= 4 && (hits.length < 2 || coverage < 0.4)) return Object.assign(rows, { filled: 0, coverage });

  const write = opts.write !== false;
  const fillTrack = write ? db.prepare('UPDATE tracks SET track_no=? WHERE id=? AND (track_no IS NULL OR track_no=0)') : null;
  const fillDisc = write ? db.prepare('UPDATE tracks SET disc_no=? WHERE id=? AND (disc_no IS NULL OR disc_no=0)') : null;
  let filled = 0;

  for (const { row, hit } of hits) {
    const trackNo = Number(hit.s.trackNumber) || 0;
    const discNo = Number(hit.s.discNumber) || 0;
    if (!Number(row.track_no) && trackNo) {
      if (fillTrack) fillTrack.run(trackNo, row.id);
      row.track_no = trackNo;
      filled += 1;
    }
    if (!Number(row.disc_no) && discNo) {
      if (fillDisc) fillDisc.run(discNo, row.id);
      row.disc_no = discNo;
    }
  }

  rows.sort((a, b) => {
    const da = Number(a.disc_no) || 1;
    const dbn = Number(b.disc_no) || 1;
    if (da !== dbn) return da - dbn;
    const ta = Number(a.track_no) || 0;
    const tb = Number(b.track_no) || 0;
    if (ta && tb) return ta - tb || a.id - b.id;
    if (ta) return -1;
    if (tb) return 1;
    return a.id - b.id;
  });

  return Object.assign(rows, { filled, coverage });
}

module.exports = { apply, norm };
