// Fill missing album track numbers from the catalogue, once, for the whole library.
// The album page does the same for the album it shows; this catches everything else.
//   node bin/fill-album-order.mjs [--dry-run] [--limit=20] [--album="Human"]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const paths = require('../core/paths');
const identity = require('../core/identity');
const albumOrder = require('../core/album-order');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const onlyArg = args.find((a) => a.startsWith('--album='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 0) : 0;
const only = onlyArg ? onlyArg.slice('--album='.length).replace(/^["']|["']$/g, '') : '';

const db = new DatabaseSync(paths.DB);
// the server is writing at the same time: wait for the lock instead of dying on it
db.exec('PRAGMA busy_timeout=5000');
const all = db.prepare(`SELECT id,title,artist,album,duration,track_no,disc_no FROM tracks
  WHERE album IS NOT NULL AND album != '' ORDER BY album, id`).all();

const albums = new Map();
for (const r of all) {
  if (only && r.album !== only) continue;
  if (!albums.has(r.album)) albums.set(r.album, []);
  albums.get(r.album).push(r);
}

let checked = 0, filledSheets = 0, filledTracks = 0, noMatch = 0;
for (const [name, rows] of albums) {
  if (!rows.some((r) => !Number(r.track_no))) continue;
  if (limit && checked >= limit) break;
  checked += 1;
  const artists = new Set(rows.map((r) => String(r.artist || '').trim()).filter(Boolean));
  const artist = artists.size === 1 ? [...artists][0] : '';
  let list = null;
  // a deliberate backfill asks again even when a recent failure was cached
  try { list = await identity.albumTracklist(name, artist, { force: true }); } catch {}
  if (!list || !list.length) {
    noMatch += 1;
    console.log(`no catalogue match   ${name}`);
    continue;
  }
  const out = albumOrder.apply(db, rows.slice(), list, { write: !dryRun });
  if (out.filled) {
    filledSheets += 1;
    filledTracks += out.filled;
    console.log(`filled ${String(out.filled).padStart(2)}/${String(rows.length).padStart(2)}  ${name}${dryRun ? '  (dry run)' : ''}`);
  }
}
console.log(`\n${dryRun ? 'would fill' : 'filled'} ${filledTracks} track number${filledTracks === 1 ? '' : 's'} across ${filledSheets} album${filledSheets === 1 ? '' : 's'}; ${noMatch} album${noMatch === 1 ? '' : 's'} had no catalogue match.`);
