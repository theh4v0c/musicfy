'use strict';
/* Every path the core knows comes from here. An installation decides its own layout with
 * MUSICFY_HOME (and the per-directory overrides); /opt/musicfy is only the default this
 * machine happens to use, never a requirement. Nothing else in core/ may spell a full
 * path. */
const path = require('node:path');
const fs = require('node:fs');

/* A binary is not in a fixed place: /usr/bin on Debian, /opt/homebrew/bin on macOS.
   Resolve through PATH (or an explicit override) instead of assuming one system. */
function which(name, override) {
  if (override) return override;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* keep looking */ }
    }
  }
  return name; // let the spawn fail with ENOENT and the caller report it
}

const ROOT = process.env.MUSICFY_HOME || '/opt/musicfy';
const DATA = process.env.MUSICFY_DATA || path.join(ROOT, 'data');
const BIN = process.env.MUSICFY_BIN || path.join(ROOT, 'ytdlp-venv', 'bin');
const exists = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };
const YTDLP = process.env.MUSICFY_YTDLP
  || (exists(path.join(BIN, 'yt-dlp')) ? path.join(BIN, 'yt-dlp') : which('yt-dlp'));
const ESSENTIA_PY = process.env.MUSICFY_PYTHON || path.join(ROOT, 'essentia-venv', 'bin', 'python');
const OWNED = process.env.MUSICFY_OWNED || path.join(ROOT, 'owned');
const DB = process.env.MUSICFY_DB || path.join(DATA, 'musicfy.db');
const LOGS = path.join(ROOT, 'logs');
const BACKUPS = process.env.MUSICFY_BACKUP_DIR || path.join(ROOT, 'backups');
const PORT = Number(process.env.MUSICFY_PORT || 8710);
const BIND = process.env.MUSICFY_BIND || '0.0.0.0';
const FFMPEG = which('ffmpeg', process.env.MUSICFY_FFMPEG);
const FFPROBE = which('ffprobe', process.env.MUSICFY_FFPROBE);

module.exports = { ROOT, DATA, BIN, YTDLP, ESSENTIA_PY, OWNED, DB, LOGS, BACKUPS, PORT, BIND, FFMPEG, FFPROBE, which };
