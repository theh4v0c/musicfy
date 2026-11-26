'use strict';
const paths = require('./paths');
const nodePath = require('node:path');
// Turns a sentence into query filters through the WNL LLM endpoint.
// The model never sees the library: it only produces a structured request.
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const { URL } = require('node:url');

const CONFIG = nodePath.join(paths.DATA, 'llm.json');

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
The question may be written in Portuguese or in English; map it to the same schema and the
same English filter keys. Rules: omit any filter not requested. "in Dm" means key D and scale minor. "around 128 bpm" means min 124 max 132.
"not downloaded" means owned false. "never played" means plays {"max":0}. Use order "random" for shuffled or mixed requests,
"plays" for most played or trending. limit is the number of songs requested, default 50, maximum 200.`;

/* A model endpoint is a URL a person types, so it is validated like one. http is
   accepted for a model on this machine (Ollama listens on http://localhost:11434 and
   cannot speak TLS); anything else has to be https. Cloud metadata addresses are refused
   outright: they are never a model, only a way to read the host's credentials. */
function isLocalHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === 'host.docker.internal' || /\.local$/.test(h)
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || /^fc|^fd/.test(h);
}
function isMetadataHost(host) {
  return /^(169\.254\.169\.254|100\.100\.100\.200|metadata\.google\.internal|fd00:ec2::254)$/i.test(String(host || ''));
}
function endpoint(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!/^https?:\/\//i.test(raw)) throw new Error('the model endpoint must start with http:// or https://');
  const base = new URL(raw.endsWith('/v1') ? raw.replace(/\/$/, '') : raw);
  if (isMetadataHost(base.hostname)) throw new Error('that address is not a model endpoint');
  if (base.protocol === 'http:' && !isLocalHost(base.hostname)) {
    throw new Error('http is only allowed for a model on this machine; use https for a remote endpoint');
  }
  return { url: new URL('/v1/chat/completions', base), mod: base.protocol === 'http:' ? http : https };
}

function post(body, timeoutMs) {
  const c = config();
  if (!c) return Promise.reject(new Error('llm not configured'));
  let target;
  try { target = endpoint(c.base_url); } catch (e) { return Promise.reject(e); }
  const payload = Buffer.from(body);
  const MAX = 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const req = target.mod.request(target.url, {
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        authorization: `Bearer ${c.api_key}`,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > MAX) { req.destroy(new Error('llm response too large')); }
      });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`llm ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch { reject(new Error('llm returned unparsable json')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('llm timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function ask(question, timeoutMs = 12000) {
  const body = JSON.stringify({
    model: (config() || {}).model || 'Auto',
    temperature: 0,
    max_tokens: 300,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: question }],
  });
  const parsed = await post(body, timeoutMs);
  const text = String((((parsed.choices || [])[0] || {}).message || {}).content || '').trim();
  if (!text) throw new Error('llm returned nothing');
  return JSON.parse(text.replace(/^```(json)?/i, '').replace(/```$/, '').trim());
}

// raw completion, used by the agent planner
async function askRaw(prompt, timeoutMs = 10000, opts = {}) {
  // A reasoning model spends this budget on hidden reasoning first. At 700 the planner
  // prompt sometimes came back with finish_reason "length" and an empty content, which
  // looked like "the model returned nothing usable".
  const base = { model: (config() || {}).model || 'Auto', temperature: 0, max_tokens: 2500, messages: [{ role: 'user', content: prompt }] };
  // JSON mode keeps the answer short and stops the empty completions the planner hit.
  // Not every OpenAI-compatible endpoint accepts it, so a 400 falls back to plain.
  const body = opts.json ? JSON.stringify({ ...base, response_format: { type: 'json_object' } }) : JSON.stringify(base);
  let parsed;
  try { parsed = await post(body, timeoutMs); }
  catch (e) {
    if (opts.json && /llm 400/.test(String(e.message))) parsed = await post(JSON.stringify(base), timeoutMs);
    else throw e;
  }
  const choice = (parsed.choices || [])[0] || {};
  const text = String((choice.message || {}).content || '').trim();
  if (!text && choice.finish_reason === 'length') throw new Error('model ran out of tokens');
  return text;
}

// A tiny completion, used by Settings to show whether the endpoint actually answers.
async function probe(timeoutMs = 8000) {
  const c = config();
  if (!c) return { configured: false, ok: false, error: 'not configured', model: null, ms: 0 };
  try {
    const started = Date.now();
    const parsed = await post(JSON.stringify({
      model: c.model || 'Auto', temperature: 0, max_tokens: 64,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    }), timeoutMs);
    const text = String((((parsed.choices || [])[0] || {}).message || {}).content || '').trim();
    if (!text) throw new Error('empty response');
    return { configured: true, ok: true, error: null, model: c.model || 'Auto', ms: Date.now() - started };
  } catch (e) {
    return { configured: true, ok: false, error: String(e.message || e).slice(0, 160), model: c.model || 'Auto', ms: 0 };
  }
}

// write the model endpoint from the Settings page
function saveConfig(patch) {
  const file = CONFIG;
  let c = {};
  try { c = JSON.parse(require('node:fs').readFileSync(file, 'utf8')); } catch {}
  for (const k of ['base_url', 'api_key', 'model']) {
    if (patch[k] === undefined) continue;
    // an empty api_key clears it: never keep a stored key when base_url changes
    if (k === 'api_key' && !patch[k]) { delete c.api_key; continue; }
    c[k] = patch[k];
  }
  require('node:fs').writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  return c;
}

module.exports = { ask, askRaw, probe, available, config, saveConfig, endpoint, CONFIG };
