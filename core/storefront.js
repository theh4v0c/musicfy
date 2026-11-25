'use strict';
/* Which catalogue storefront to ask.
 *
 * iTunes serves a different catalogue per country: a release that exists in Brazil can be
 * missing from the US store, with a different tracklist and duration. The app used the
 * default (US) everywhere, so a Brazilian library was matched against the wrong catalogue.
 * Deezer is added as a second source so the answer never depends on one storefront.
 */
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const SETTINGS = path.join(paths.DATA, 'settings.json');
// ISO 3166-1 alpha-2, upper case. A short allowlist is worse than a shape check plus the
// storefronts iTunes actually serves; an unknown code returns an empty catalogue and the
// caller falls back to Deezer.
function code(value) {
  const v = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : '';
}

// geocoding stores an English country name in some builds and a code in others
const NAMES = {
  BRAZIL: 'BR', BRASIL: 'BR', PORTUGAL: 'PT', 'UNITED STATES': 'US', USA: 'US',
  'UNITED KINGDOM': 'GB', UK: 'GB', IRELAND: 'IE', SPAIN: 'ES', FRANCE: 'FR',
  GERMANY: 'DE', ITALY: 'IT', NETHERLANDS: 'NL', BELGIUM: 'BE', SWITZERLAND: 'CH',
  AUSTRIA: 'AT', SWEDEN: 'SE', NORWAY: 'NO', DENMARK: 'DK', FINLAND: 'FI',
  POLAND: 'PL', CZECHIA: 'CZ', 'CZECH REPUBLIC': 'CZ', GREECE: 'GR', TURKEY: 'TR',
  RUSSIA: 'RU', UKRAINE: 'UA', CANADA: 'CA', MEXICO: 'MX', ARGENTINA: 'AR',
  CHILE: 'CL', COLOMBIA: 'CO', PERU: 'PE', URUGUAY: 'UY', PARAGUAY: 'PY',
  BOLIVIA: 'BO', ECUADOR: 'EC', VENEZUELA: 'VE', JAPAN: 'JP', 'SOUTH KOREA': 'KR',
  CHINA: 'CN', 'HONG KONG': 'HK', TAIWAN: 'TW', SINGAPORE: 'SG', INDIA: 'IN',
  INDONESIA: 'ID', THAILAND: 'TH', VIETNAM: 'VN', PHILIPPINES: 'PH', MALAYSIA: 'MY',
  AUSTRALIA: 'AU', 'NEW ZEALAND': 'NZ', 'SOUTH AFRICA': 'ZA', NIGERIA: 'NG',
  EGYPT: 'EG', MOROCCO: 'MA', ISRAEL: 'IL', 'SAUDI ARABIA': 'SA', 'UNITED ARAB EMIRATES': 'AE',
};

function fromName(value) {
  const direct = code(value);
  if (direct) return direct;
  const key = String(value || '').trim().toUpperCase();
  return NAMES[key] || '';
}

function readSettings(file = SETTINGS) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

// explicit request/option > saved storefront > geocoded country > environment > US
function resolve({ explicit, settings, env = process.env, file } = {}) {
  const hit = code(explicit)
    || code(settings && settings.storefront_country)
    || fromName(settings && settings.country)
    || code(env.MUSICFY_COUNTRY)
    || 'US';
  return hit;
}

function current(explicit) {
  return resolve({ explicit, settings: readSettings() });
}

module.exports = { code, fromName, resolve, current, readSettings, NAMES };
