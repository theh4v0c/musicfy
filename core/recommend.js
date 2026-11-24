'use strict';
// Recommendations that follow what is being played now.
// Inputs: recent listens (weighted heavily), the historical co-listening graph, and
// feature proximity (genre family, key, tempo). No model required, so it cannot drift.
const { camelotOf, harmonicScore } = require('./harmonic');

function build(db, { days = 30, limit = 40, excludePlaylisted = false, avoid = [] } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;

  // 1. what is playing now
  const recent = db.prepare(`SELECT l.track_id id, COUNT(*) plays FROM listens l
    WHERE l.played_at >= ? GROUP BY l.track_id`).all(since);
  const recentWeight = new Map(recent.map((r) => [r.id, r.plays]));

  // 2. what used to play with it, from the historical co-listening graph
  const seeds = recent.map((r) => r.id).slice(0, 40);
  const neighbours = new Map();
  for (const id of seeds) {
    const t = db.prepare('SELECT artist FROM tracks WHERE id=?').get(id);
    if (!t || !t.artist) continue;
    const edges = db.prepare(`SELECT b, w FROM play_edges WHERE a=? ORDER BY w DESC LIMIT 12`).all(t.artist);
    for (const e of edges) {
      const w = Number(e.w) || 0;
      if (!w) continue;
      neighbours.set(e.b, Math.max(neighbours.get(e.b) || 0, w));
    }
  }
  const maxEdge = Math.max(1, ...neighbours.values());

  // 3. candidate pool: everything with audio, minus what has been played in the window
  const pool = db.prepare(`SELECT t.id, t.title, t.artist, t.genre_family, t.bpm, t.key, t.key_scale,
      (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) plays,
      (SELECT MAX(l.played_at) FROM listens l WHERE l.track_id=t.id) last,
      (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned
    FROM tracks t`).all();

  // taste profile from the last few weeks: dominant family, tempo band, key
  const played = pool.filter((p) => recentWeight.has(p.id) && p.owned);
  const famCount = {};
  let bpmSum = 0, bpmN = 0;
  const keys = [];
  for (const p of played) {
    if (p.genre_family) famCount[p.genre_family] = (famCount[p.genre_family] || 0) + (recentWeight.get(p.id) || 1);
    if (p.bpm) { bpmSum += p.bpm; bpmN += 1; }
    const c = camelotOf(p.key, p.key_scale);
    if (c) keys.push(c);
  }
  const topFamily = Object.entries(famCount).sort((a, b) => b[1] - a[1])[0];
  const avgBpm = bpmN ? bpmSum / bpmN : null;

  const playlisted = excludePlaylisted
    ? new Set(db.prepare('SELECT DISTINCT track_id id FROM playlist_tracks').all().map((r) => r.id))
    : null;

  const avoidList = avoid.map((w) => String(w).toLowerCase()).filter(Boolean);
  const exclude = require('./exclude');
  const scored = [];
  for (const p of pool) {
    if (!p.owned) continue;                                  // only recommend what can be played
    if (playlisted && playlisted.has(p.id)) continue;         // weekly list must surface something new
    // artist, album, title, genre and family, so "reggaeton" in a genre column counts
    if (avoidList.length && exclude.matches(avoidList, p)) continue;
    const playedRecently = recentWeight.get(p.id);
    if (playedRecently && playedRecently > 1) continue;       // do not just repeat the current rotation
    let score = 0;
    const reasons = [];

    const edge = p.artist ? neighbours.get(p.artist) : 0;
    if (edge) { const v = (edge / maxEdge) * 34; score += v; reasons.push('played alongside your recent tracks'); }

    if (topFamily && p.genre_family === topFamily[0]) { score += 18; reasons.push(`same family as what you play now (${topFamily[0]})`); }
    // a family you do not play is not a recommendation, it is a library row
    else if (p.genre_family && !famCount[p.genre_family]) score -= 22;
    if (avgBpm && p.bpm) {
      const delta = Math.abs(p.bpm - avgBpm);
      if (delta <= 3) { score += 16; reasons.push('tempo matches your current rotation'); }
      else if (delta <= 8) { score += 9; reasons.push('close tempo'); }
    }
    const pc = camelotOf(p.key, p.key_scale);
    if (pc && keys.length) {
      const best = Math.max(...keys.slice(-20).map((k) => harmonicScore(k, pc)));
      if (best >= 0.6) { score += 12; reasons.push('harmonically compatible'); }
      else if (best > 0) score += 5;
    }
    if (!p.last) { score += 8; reasons.push('never played'); }
    else if (now - p.last > 180 * 86400) { score += 5; reasons.push('not heard in months'); }

    if (score <= 0) continue;
    scored.push({ ...p, score: Math.round(score), reasons });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    window: days,
    profile: { plays: recent.reduce((n, r) => n + r.plays, 0), topFamily: topFamily ? topFamily[0] : null, avgBpm: avgBpm ? Math.round(avgBpm) : null },
    picks: scored.slice(0, limit),
  };
}

module.exports = { build };
