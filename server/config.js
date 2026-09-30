'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });


function env(name, fallback = '') {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  let v = String(raw).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

const SPIN_SECRET = env('SPIN_SECRET');
if (!SPIN_SECRET || SPIN_SECRET.length < 16) {
  console.error('SPIN_SECRET must be set in .env (min 16 chars). See .env.example');
  process.exit(1);
}

const PORT = Number(env('PORT')) || 3847;

const rawOrigins = (env('CORS_ORIGINS', '*')).trim();
const CORS_ORIGINS = rawOrigins === '*'
  ? '*'
  : rawOrigins.split(',').map((s) => s.trim()).filter(Boolean);

/** Shared with GOML Radio — verifies X-Wallet-Token JWTs (admin/owner). */
const SESSION_SECRET = env('SESSION_SECRET');

/** Shared with GOML Radio — X-Admin-Token for tooling / legacy token login. */
const ADMIN_TOKEN = env('ADMIN_TOKEN');

/** Optional shop/API tooling password (NOT the GOML admin gate). */
const ADMIN_PASSWORD = env('ADMIN_PASSWORD');

const XAMAN_API_KEY = env('XAMAN_API_KEY');
const XAMAN_API_SECRET = env('XAMAN_API_SECRET');

const OWNER_WALLET_ADDRESS = env('OWNER_WALLET_ADDRESS');

const DATA_DIR = process.env.DATA_DIR
  ? require('path').resolve(process.env.DATA_DIR)
  : require('path').join(__dirname, '..', 'data');

module.exports = {
  SPIN_SECRET,
  PORT,
  CORS_ORIGINS,
  SESSION_SECRET,
  ADMIN_TOKEN,
  ADMIN_PASSWORD,
  XAMAN_API_KEY,
  XAMAN_API_SECRET,
  OWNER_WALLET_ADDRESS,
  DATA_DIR,
};
