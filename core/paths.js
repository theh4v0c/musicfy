'use strict';
/* Every path the core knows comes from here. An installation decides its own layout with
 * MUSICFY_HOME (and the per-directory overrides); /opt/musicfy is only the default this
 * machine happens to use, never a requirement. Nothing else in core/ may spell a full
 * path. */
const path = require('node:path');

const ROOT = process.env.MUSICFY_HOME || '/opt/musicfy';
const DATA = process.env.MUSICFY_DATA || path.join(ROOT, 'data');
const BIN = process.env.MUSICFY_BIN || path.join(ROOT, 'ytdlp-venv', 'bin');
const YTDLP = process.env.MUSICFY_YTDLP || path.join(BIN, 'yt-dlp');
const ESSENTIA_PY = process.env.MUSICFY_PYTHON || path.join(ROOT, 'essentia-venv', 'bin', 'python');
const OWNED = process.env.MUSICFY_OWNED || path.join(ROOT, 'owned');
const DB = process.env.MUSICFY_DB || path.join(DATA, 'musicfy.db');
const LOGS = path.join(ROOT, 'logs');
const BACKUPS = process.env.MUSICFY_BACKUP_DIR || path.join(ROOT, 'backups');
const PORT = Number(process.env.MUSICFY_PORT || 8710);
const BIND = process.env.MUSICFY_BIND || '0.0.0.0';

module.exports = { ROOT, DATA, BIN, YTDLP, ESSENTIA_PY, OWNED, DB, LOGS, BACKUPS, PORT, BIND };
