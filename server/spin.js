'use strict';

const crypto = require('crypto');
const { SPIN_SECRET } = require('./config');

const MODES = new Set(['names', 'prizes']);

/**
 * Canonical JSON string for signing (stable key order).
 * @param {{ mode: string, items: string[], index: number, nonce: string, ts: number }} payload
 */
function canonicalString(payload) {
  return JSON.stringify({
    mode: payload.mode,
    items: payload.items,
    index: payload.index,
    nonce: payload.nonce,
    ts: payload.ts,
  });
}

function sign(payload) {
  const data = canonicalString(payload);
  return crypto.createHmac('sha256', SPIN_SECRET).update(data, 'utf8').digest('hex');
}

function verify(payload, signature) {
  if (!payload || typeof signature !== 'string' || !/^[0-9a-f]+$/i.test(signature)) {
    return false;
  }
  const expected = sign(payload);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Normalize and validate client spin request.
 * @returns {{ ok: true, mode: string, items: string[] } | { ok: false, error: string, status: number }}
 */
function normalizeRequest(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid body', status: 400 };
  }
  const mode = body.mode;
  if (!MODES.has(mode)) {
    return { ok: false, error: 'mode must be "names" or "prizes"', status: 400 };
  }
  if (!Array.isArray(body.items)) {
    return { ok: false, error: 'items must be an array', status: 400 };
  }
  const items = body.items.map((x) => String(x).trim()).filter((s) => s.length > 0);
  if (items.length < 2) {
    return { ok: false, error: 'Need at least 2 non-empty items', status: 400 };
  }
  if (items.length > 100) {
    return { ok: false, error: 'Too many items (max 100)', status: 400 };
  }
  for (const s of items) {
    if (s.length > 80) {
      return { ok: false, error: 'Item too long (max 80 chars)', status: 400 };
    }
  }
  return { ok: true, mode, items };
}

/**
 * Fair spin: crypto.randomInt + HMAC proof.
 */
function createSpin(mode, items) {
  const index = crypto.randomInt(0, items.length);
  const nonce = crypto.randomBytes(16).toString('hex');
  const ts = Date.now();
  const payload = { mode, items, index, nonce, ts };
  const signature = sign(payload);
  return {
    result: {
      mode,
      items,
      index,
      label: items[index],
      nonce,
      ts,
    },
    signature,
  };
}

/**
 * Parse payload from verify request (object or JSON string).
 */
function parsePayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validate shape of a claimed spin payload before verifying HMAC.
 */
function isPlausiblePayload(p) {
  if (!p || typeof p !== 'object') return false;
  if (!MODES.has(p.mode)) return false;
  if (!Array.isArray(p.items) || p.items.length < 2) return false;
  if (!Number.isInteger(p.index) || p.index < 0 || p.index >= p.items.length) return false;
  if (typeof p.nonce !== 'string' || !/^[0-9a-f]{32}$/i.test(p.nonce)) return false;
  if (!Number.isFinite(p.ts)) return false;
  return true;
}

module.exports = {
  canonicalString,
  sign,
  verify,
  normalizeRequest,
  createSpin,
  parsePayload,
  isPlausiblePayload,
};
