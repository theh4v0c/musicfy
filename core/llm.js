'use strict';
// Turns a sentence into query filters through the WNL LLM endpoint.
// The model never sees the library: it only produces a structured request.
const https = require('node:https');
const fs = require('node:fs');
const { URL } = require('node:url');

const CONFIG = '/opt/musicfy/data/llm.json';

function config() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (c && c.base_url && c.api_key) return c;
  } catch {}
  return null;
}

function available() {
  return !!config();
}

const SYSTEM = `You convert a music library request into JSON. Reply with JSON only.
Schema:
{"filters":{"key":"C|C#|D|D#|E|F|F#|G|G#|A|A#|B","scale":"major|minor","bpm":{"min":number,"max":number},
"year":{"min":number,"max":number},"genre":"string","owned":true|false,"plays":{"min":number,"max":number},
"order":"relevance|random|newest|oldest|plays","limit":number,"text":["words"]},
"title":"playlist name if the user asked for a playlist, else null"}
Rules: omit any filter not requested. "in Dm" means key D and scale minor. "around 128 bpm" means min 124 max 132.
"not downloaded" means owned false. "never played" means plays {"max":0}. Use order "random" for shuffled or mixed requests,
"plays" for most played or trending. limit is the number of songs requested, default 50, maximum 200.`;

function ask(question, timeoutMs = 12000) {
  const c = config();
  if (!c) return Promise.reject(new Error('llm not configured'));
  const url = new URL('/v1/chat/completions', c.base_url.endsWith('/v1') ? c.base_url.replace(/\/$/, '') : c.base_url);
  const body = JSON.stringify({
    model: c.model || 'Auto',
    temperature: 0,
    max_tokens: 300,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: question }],
  });
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: `Bearer ${c.api_key}`,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`llm ${res.statusCode}`));
        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices[0].message.content.trim();
          const json = JSON.parse(text.replace(/^```(json)?/i, '').replace(/```$/, '').trim());
          resolve(json);
        } catch (e) { reject(new Error('llm returned unparsable json')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('llm timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// raw completion, used by the agent planner
function askRaw(prompt, timeoutMs = 10000) {
  const c = config();
  if (!c) return Promise.reject(new Error('llm not configured'));
  const url = new URL('/v1/chat/completions', c.base_url.endsWith('/v1') ? c.base_url.replace(/\/$/, '') : c.base_url);
  const body = JSON.stringify({ model: c.model || 'Auto', temperature: 0, max_tokens: 300, messages: [{ role: 'user', content: prompt }] });
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', timeout: timeoutMs, headers: {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${c.api_key}` } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('llm ' + res.statusCode));
        try { resolve(JSON.parse(data).choices[0].message.content); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('llm timeout')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// write the model endpoint from the Settings page
function saveConfig(patch) {
  const file = '/opt/musicfy/data/llm.json';
  let c = {};
  try { c = JSON.parse(require('node:fs').readFileSync(file, 'utf8')); } catch {}
  for (const k of ['base_url', 'api_key', 'model']) {
    if (patch[k] === undefined) continue;
    // an empty api_key clears it: never keep a stored key when base_url changes
    if (k === 'api_key' && !patch[k]) { delete c.api_key; continue; }
    c[k] = patch[k];
  }
  require('node:fs').writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  if (cached) cached = null;
  return c;
}

module.exports = { ask, askRaw, available, config, saveConfig, CONFIG };
