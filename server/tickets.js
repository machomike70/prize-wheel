'use strict';

/**
 * Spin tickets + prize codes (one record type, stored in data/store.json → "tickets").
 *
 *  - Spin ticket: minted by admin / shop (POST /api/tickets). Holder spins once at
 *    /wheel-staging/?code=XXXX-XXXX-XX&mode=prizes → prizeResult is attached and the
 *    SAME code becomes the prize/coupon code (shop looks it up via /api/tickets/lookup).
 *  - Direct prize code: admin issues a code already bound to a prize (no spin needed).
 *  - Redeem: one-time burn when the prize is applied/fulfilled (redeemedAt).
 *
 * Shape (back-compatible with the live wheel + bear-witness-shop):
 *  { code, site, orderId, walletAddress, usedAt, createdAt,
 *    prizeResult: { label, prizeId, type, value, sku, index, nonce, ts, signature, source } | null,
 *    redeemedAt, redeemedOrderId, redeemedNote, ledgerRedeemCode }
 */
const crypto = require('crypto');
const { update, load } = require('./store');

const SITES = new Set(['shop', 'goml']);
const XRPL_ADDR_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,33}$/;

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8);
}

function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function codesMatch(a, b) {
  return normalizeCode(a) === normalizeCode(b) && normalizeCode(a).length > 0;
}

function cleanOrderId(v) {
  return v == null || v === '' ? null : String(v).slice(0, 120);
}

/**
 * Create spin tickets (admin / shop). Optional prizeResult pre-binds a prize (direct issue).
 */
function createTickets(opts) {
  const site = opts.site || 'shop';
  if (!SITES.has(site)) return { ok: false, error: 'site must be "shop" or "goml"', status: 400 };
  const orderId = cleanOrderId(opts.orderId);
  let walletAddress = null;
  if (opts.walletAddress) {
    walletAddress = String(opts.walletAddress).trim();
    if (!XRPL_ADDR_RE.test(walletAddress)) return { ok: false, error: 'Invalid XRPL wallet address', status: 400 };
  }

  let codes = [];
  if (Array.isArray(opts.codes) && opts.codes.length) {
    codes = opts.codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (codes.length > 500) return { ok: false, error: 'Too many codes (max 500)', status: 400 };
    for (const c of codes) {
      const n = normalizeCode(c);
      if (n.length < 4 || n.length > 64) return { ok: false, error: 'Each code must be 4–64 alphanumeric chars', status: 400 };
    }
  } else {
    const count = Math.min(Math.max(Number(opts.count) || 1, 1), 200);
    for (let i = 0; i < count; i++) codes.push(generateCode());
  }

  try {
    const created = update((store) => {
      if (!Array.isArray(store.tickets)) store.tickets = [];
      const existing = new Set(store.tickets.map((t) => normalizeCode(t.code)));
      const made = [];
      for (const code of codes) {
        let finalCode = code;
        if (existing.has(normalizeCode(finalCode))) {
          if (opts.codes && opts.codes.length) {
            throw Object.assign(new Error(`Code already exists: ${code}`), { status: 409 });
          }
          do { finalCode = generateCode(); } while (existing.has(normalizeCode(finalCode)));
        }
        existing.add(normalizeCode(finalCode));
        const now = Date.now();
        const ticket = {
          code: finalCode,
          orderId,
          site,
          walletAddress,
          usedAt: opts.prizeResult ? now : null,
          createdAt: now,
          prizeResult: opts.prizeResult ? { ...opts.prizeResult } : null,
          redeemedAt: null,
          redeemedOrderId: null,
        };
        if (opts.note) ticket.note = String(opts.note).slice(0, 200);
        store.tickets.push(ticket);
        made.push({ ...ticket });
      }
      return made;
    });
    return { ok: true, tickets: created };
  } catch (err) {
    return { ok: false, error: err.message || 'Create failed', status: err.status || 500 };
  }
}

function listTickets({ site, unused, limit } = {}) {
  let list = (load().tickets || []).slice();
  if (site && SITES.has(site)) list = list.filter((t) => t.site === site);
  if (unused === true || unused === '1' || unused === 'true') list = list.filter((t) => !t.usedAt);
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const n = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return list.slice(0, n);
}

function findTicket(code, site) {
  return (load().tickets || []).find((t) => codesMatch(t.code, code) && (!site || t.site === site)) || null;
}

/**
 * Atomically consume an unspun ticket and attach the spin result produced by makeResult(ticket).
 * makeResult runs inside the store mutation so two concurrent spins cannot both win.
 */
function spinTicket(code, site, makeResult) {
  const norm = normalizeCode(code);
  if (norm.length < 4) return { ok: false, error: 'Invalid or missing spin code', status: 400 };
  return update((store) => {
    const ticket = (store.tickets || []).find((t) => codesMatch(t.code, code) && (!site || t.site === site));
    if (!ticket) return { ok: false, error: 'Unknown or invalid spin code', status: 404 };
    if (ticket.usedAt) {
      return { ok: false, error: 'This spin code has already been used', status: 409, ticket: { ...ticket } };
    }
    const prizeResult = makeResult(ticket);
    ticket.usedAt = Date.now();
    ticket.prizeResult = prizeResult;
    return { ok: true, ticket: { ...ticket } };
  });
}

function setTicketFields(code, fields) {
  return update((store) => {
    const ticket = (store.tickets || []).find((t) => codesMatch(t.code, code));
    if (ticket) Object.assign(ticket, fields);
    return ticket ? { ...ticket } : null;
  });
}

/**
 * One-time redeem of a won prize code. Returns the updated ticket or an error.
 */
function redeemTicket(code, { orderId, note } = {}) {
  return update((store) => {
    const ticket = (store.tickets || []).find((t) => codesMatch(t.code, code));
    if (!ticket) return { ok: false, status: 404, error: 'Unknown code' };
    if (!ticket.usedAt || !ticket.prizeResult) {
      return { ok: false, status: 409, error: 'Code has not been spun yet — spin first' };
    }
    if (ticket.prizeResult.type === 'none') {
      return { ok: false, status: 409, error: 'No prize on this code (Try Again)' };
    }
    if (ticket.prizeResult.type === 'xrp') {
      return { ok: false, status: 409, error: 'XRP prize — redeem the STG- code with an XRPL address at /redeem.html' };
    }
    if (ticket.redeemedAt) {
      return { ok: false, status: 409, error: 'Code already redeemed', ticket: { ...ticket } };
    }
    ticket.redeemedAt = Date.now();
    ticket.redeemedOrderId = cleanOrderId(orderId);
    if (note) ticket.redeemedNote = String(note).slice(0, 200);
    return { ok: true, ticket: { ...ticket } };
  });
}

module.exports = {
  SITES,
  XRPL_ADDR_RE,
  generateCode,
  normalizeCode,
  createTickets,
  listTickets,
  findTicket,
  spinTicket,
  setTicketFields,
  redeemTicket,
};
