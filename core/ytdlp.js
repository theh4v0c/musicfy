// MUSICFY ladder: yt-dlp rung. No accounts, no registration, sovereign.
'use strict';
const { execFile } = require('node:child_process');

const YTDLP = '/opt/musicfy/ytdlp-venv/bin/yt-dlp';

// ytsearch -> normalized candidates
function searchYoutube(seed, { limit = 8 } = {}) {
  const query = `${seed.artist || ''} ${seed.title}`.trim();
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist', '--no-warnings', '--quiet',
      '--print', '%(id)s\t%(title)s\t%(duration)s\t%(channel)s',
      `ytsearch${limit}:${query}`,
    ];
    execFile(YTDLP, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      const out = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const [id, title, dur, channel] = line.split('\t');
        if (!id) continue;
        out.push({
          source: 'youtube',
          rung: 'yt-dlp',
          id,
          title: title || '',
          duration: dur ? Number(dur) : null,
          artist: channel || '',
          format: 'stream',
          bitrate: null,
          handle: { kind: 'youtube', id },
        });
      }
      resolve(out);
    });
  });
}

// scsearch -> SoundCloud candidates via yt-dlp (no account, public tracks)
function searchSoundcloud(seed, { limit = 8 } = {}) {
  const query = `${seed.artist || ''} ${seed.title}`.trim();
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist', '--no-warnings', '--quiet',
      '--print', '%(id)s\t%(url)s\t%(title)s\t%(duration)s\t%(uploader)s',
      `scsearch${limit}:${query}`,
    ];
    execFile(YTDLP, args, { timeout: 45000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      const out = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const [id, url, title, dur, uploader] = line.split('\t');
        if (!id || !url) continue;
        out.push({
          source: 'soundcloud',
          rung: 'soundcloud',
          id,
          url,
          title: title || '',
          duration: dur ? Number(dur) : null,
          artist: uploader || '',
          format: 'stream',
          bitrate: null,
          handle: { kind: 'soundcloud', id, url },
        });
      }
      resolve(out);
    });
  });
}

// YouTube Music catalogue search (songs and albums, not random uploads)
function searchYouTubeMusic(query, opts = {}) {
  const limit = opts.limit || 30;
  const detailLimit = opts.detailLimit || 6;
  const wantDetail = opts.detail !== false;

  const flatSearch = () => new Promise((resolve) => {
    const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
    execFile(YTDLP, [
      '--no-warnings', '--flat-playlist', '--playlist-end', String(limit),
      '--print', '%(id)s\t%(url)s\t%(title)s\t%(duration)s\t%(channel)s\t%(ie_key)s',
      url,
    ], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return resolve([]);
      const out = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const [id, pageUrl, title, dur, channel, ie] = line.split('\t');
        if (!id || !title || title === 'NA') continue;
        if (ie !== 'Youtube') continue;
        if (/playlist\?list=/.test(pageUrl || '')) continue;
        out.push({
          id, url: `https://www.youtube.com/watch?v=${id}`, title,
          duration: Number(dur) || null, channel: channel === 'NA' ? null : channel, rung: 'ytmusic',
        });
      }
      resolve(out);
    });
  });

  // the flat listing has no artist and no duration, which is why matching used to fail.
  // resolve the top few properly, in parallel, and keep the rest as titles only.
  const detail = (entry) => new Promise((resolve) => {
    execFile(YTDLP, [
      '--no-warnings', '--skip-download',
      '--print', '%(artist)s\t%(duration)s\t%(channel)s\t%(track)s\t%(album)s',
      entry.url,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return resolve(entry);
      const [artist, dur, channel, , album] = String(stdout).trim().split('\t');
      resolve({
        ...entry,
        artist: artist && artist !== 'NA' ? artist : (entry.channel || null),
        duration: Number(dur) || entry.duration || null,
        channel: channel && channel !== 'NA' ? channel : entry.channel,
        album: album && album !== 'NA' ? album : null,
      });
    });
  });

  return flatSearch().then(async (entries) => {
    if (!wantDetail || !entries.length) return entries;
    // resolve the entries whose titles actually resemble the query, not merely the first few
    const qWords = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 2);
    const overlap = (e) => {
      const t = String(e.title || '').toLowerCase();
      return qWords.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    };
    const ranked = entries.map((e, i) => ({ e, i, s: overlap(e) })).sort((a, b) => b.s - a.s || a.i - b.i);
    const chosen = new Set(ranked.slice(0, detailLimit).map((r) => r.i));
    const head = entries.filter((e, i) => chosen.has(i));
    const tail = entries.filter((e, i) => !chosen.has(i));
    const detailed = await Promise.all(head.map((e) => detail(e)));
    return [...detailed, ...tail];
  });
}

function searchSoundcloud(seed, { limit = 8 } = {}) {
  const query = `${seed.artist || ''} ${seed.title}`.trim();
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist', '--no-warnings', '--quiet',
      '--print', '%(id)s\t%(url)s\t%(title)s\t%(duration)s\t%(uploader)s',
      `scsearch${limit}:${query}`,
    ];
    execFile(YTDLP, args, { timeout: 45000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      const out = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const [id, url, title, dur, uploader] = line.split('\t');
        if (!id || !url) continue;
        out.push({
          source: 'soundcloud',
          rung: 'soundcloud',
          id,
          url,
          title: title || '',
          duration: dur ? Number(dur) : null,
          artist: uploader || '',
          format: 'stream',
          bitrate: null,
          handle: { kind: 'soundcloud', id, url },
        });
      }
      resolve(out);
    });
  });
}

// YouTube Music catalogue search (songs and albums, not random uploads)
function streamUrl(id) {
  return streamUrlFor(`https://www.youtube.com/watch?v=${id}`);
}

// streaming URL for any yt-dlp-resolvable page (soundcloud etc)
function streamUrlFor(pageUrl, opts = {}) {
  const format = opts.format || 'bestaudio/best';
  return new Promise((resolve, reject) => {
    execFile(YTDLP, ['--no-warnings', '-f', format, '-g', pageUrl],
      { timeout: 45000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        const url = stdout.trim().split('\n')[0];
        if (!url) return reject(new Error('no stream url'));
        resolve(url);
      });
  });
}

// audio-only download path (returns a filename in cache dir; caller manages)
function downloadArgs(id, dest) {
  return ['--no-warnings', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '-o', `${dest}/%(title)s.%(ext)s`, `https://www.youtube.com/watch?v=${id}`];
}

module.exports = { searchYoutube, searchYouTubeMusic, searchSoundcloud, streamUrl, streamUrlFor, downloadArgs, YTDLP };
