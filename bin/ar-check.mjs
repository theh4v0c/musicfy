#!/usr/bin/env node
/* A&R acceptance check: real sentences, real catalogue, same endpoint the UI uses.
 *
 *   BASE=http://LAN_IP:8710 node bin/ar-check.mjs
 *
 * Fails when a request does not produce the expected intent and at least one track.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8710';
const CASES = [
  ['techno, outside the library', 'uma lista de techno que eu não tenho', 'build_playlist'],
  ['samba for a party', '10 faixas de samba para uma festa', 'build_playlist'],
  ['forró', '10 faixas de forró pra dançar', 'build_playlist'],
  ['named artist', 'create a playlist based on Bedouin', 'build_playlist'],
  ['count', 'quantas faixas eu tenho', 'report_library'],
];

let pass = 0;
for (const [name, q, intent] of CASES) {
  const started = Date.now();
  let d = null;
  try {
    const r = await fetch(`${BASE}/api/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mf-lang': 'pt-BR' },
      body: JSON.stringify({ q }),
    });
    d = await r.json();
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
    continue;
  }
  const action = d.action || {};
  const plan = d.plan || {};
  const ids = Array.isArray(action.trackIds) ? action.trackIds : [];
  const online = Array.isArray(action.online) ? action.online : [];
  const ok = plan.intent === intent && (intent === 'report_library' || ids.length + online.length > 0);
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: source=${d.source} intent=${plan.intent} ` +
    `local=${ids.length} new=${online.length} ${(Date.now() - started) / 1000}s`);
  if (!ok) console.log(`      ${String(d.spoken || '').slice(0, 160)}`);
}
console.log(`${pass}/${CASES.length}`);
process.exit(pass === CASES.length ? 0 : 1);
