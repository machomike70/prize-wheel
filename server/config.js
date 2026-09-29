'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SPIN_SECRET = process.env.SPIN_SECRET;
if (!SPIN_SECRET || SPIN_SECRET.length < 16) {
  console.error('SPIN_SECRET must be set in .env (min 16 chars). See .env.example');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3847;

const rawOrigins = (process.env.CORS_ORIGINS || '*').trim();
const CORS_ORIGINS = rawOrigins === '*'
  ? '*'
  : rawOrigins.split(',').map((s) => s.trim()).filter(Boolean);

module.exports = { SPIN_SECRET, PORT, CORS_ORIGINS };
