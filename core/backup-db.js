#!/usr/bin/env node
// Nightly database snapshot with retention. VACUUM INTO is atomic and needs no extra tooling.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB = paths.DB;
const OUT = paths.BACKUPS;
const KEEP = Number(process.env.MUSICFY_BACKUP_KEEP || 7);

fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const dest = path.join(OUT, `musicfy-${stamp}.db`);
if (fs.existsSync(dest)) fs.rmSync(dest);

const db = new DatabaseSync(DB);
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();

const files = fs.readdirSync(OUT).filter((f) => /^musicfy-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
  try { fs.rmSync(path.join(OUT, old)); } catch {}
}
console.log(JSON.stringify({ snapshot: dest, bytes: fs.statSync(dest).size, kept: Math.min(files.length, KEEP) }));
