#!/usr/bin/env node
// Nightly database snapshot with retention. VACUUM INTO is atomic and needs no extra tooling.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const paths = require('./paths');

const DB = paths.DB;
const OUT = paths.BACKUPS;
const KEEP = Number(process.env.MUSICFY_BACKUP_KEEP || 7);

// a job that runs before the first boot has nothing to snapshot, and must not create
// the app's database just to copy it
if (!fs.existsSync(DB)) {
  console.log(JSON.stringify({ snapshot: null, skipped: 'database does not exist yet' }));
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const dest = path.join(OUT, `musicfy-${stamp}.db`);
const tmp = path.join(OUT, `.musicfy-${stamp}.db.tmp`);
try { fs.rmSync(tmp); } catch {}

// snapshot beside the target, verify it, then rotate. The old file stays until a good
// replacement exists: a failed vacuum used to leave the day with no backup at all.
const db = new DatabaseSync(DB);
db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
db.close();
const size = fs.statSync(tmp).size;
if (!size) { fs.rmSync(tmp); throw new Error('backup is empty'); }
const check = new DatabaseSync(tmp, { readOnly: true });
const integrity = check.prepare('PRAGMA integrity_check').get();
const tables = check.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c;
check.close();
const verdict = Object.values(integrity || {})[0];
// an empty database is not a corrupt one: a job that runs before the first boot (or
// after a data-directory move) should say so and leave no file, not claim corruption
if (!tables) {
  fs.rmSync(tmp);
  console.log(JSON.stringify({ snapshot: null, skipped: 'database has no schema yet' }));
  process.exit(0);
}
if (verdict !== 'ok') { fs.rmSync(tmp); throw new Error(`backup failed integrity: ${verdict}`); }
fs.renameSync(tmp, dest);

const files = fs.readdirSync(OUT).filter((f) => /^musicfy-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
  try { fs.rmSync(path.join(OUT, old)); } catch {}
}
console.log(JSON.stringify({ snapshot: dest, bytes: fs.statSync(dest).size, kept: Math.min(files.length, KEEP) }));
