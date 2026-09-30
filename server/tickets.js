'use strict';

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

/**
 * Create tickets (admin). For shop: codes for customers.
 * For goml: optional walletAddress binds a pre-checkout entitlement.
 */
function createTickets(opts) {
  const site = opts.site;
  if (!SITES.has(site)) {
    return { ok: false, error: 'site must be "shop" or "goml"', status: 400 };
  }
  const orderId =
    opts.orderId == null || opts.orderId === ''
      ? null
      : String(opts.orderId).slice(0, 120);

  let walletAddress = null;
  if (opts.walletAddress) {
    walletAddress = String(opts.walletAddress).trim();
    if (!XRPL_ADDR_RE.test(walletAddress)) {
      return { ok: false, error: 'Invalid XRPL wallet address', status: 400 };
    }
  }

  let codes = [];
  if (Array.isArray(opts.codes) && opts.codes.length) {
    codes = opts.codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (codes.length > 500) {
      return { ok: false, error: 'Too many codes (max 500)', status: 400 };
    }
    for (const c of codes) {
      const n = normalizeCode(c);
      if (n.length < 4 || n.length > 64) {
        return { ok: false, error: 'Each code must be 4–64 alphanumeric chars', status: 400 };
      }
    }
  } else {
    const count = Math.min(Math.max(Number(opts.count) || 1, 1), 200);
    for (let i = 0; i < count; i++) codes.push(generateCode());
  }

  try {
    const created = update((store) => {
      const existing = new Set(store.tickets.map((t) => normalizeCode(t.code)));
      const made = [];
      for (const code of codes) {
        let finalCode = code;
        if (existing.has(normalizeCode(finalCode))) {
          if (opts.codes && opts.codes.length) {
            throw Object.assign(new Error(`Code already exists: ${code}`), { status: 409 });
          }
          do {
            finalCode = generateCode();
          } while (existing.has(normalizeCode(finalCode)));
        }
        existing.add(normalizeCode(finalCode));
        const ticket = {
          code: finalCode,
          orderId,
          site,
          walletAddress,
          usedAt: null,
          createdAt: Date.now(),
          prizeResult: null,
        };
        store.tickets.push(ticket);
        made.push(ticket);
      }
      return made;
    });
    return { ok: true, tickets: created };
  } catch (err) {
    return { ok: false, error: err.message || 'Create failed', status: err.status || 500 };
  }
}

function listTickets({ site, unused, wallet } = {}) {
  const store = load();
  let list = store.tickets.slice();
  if (site && SITES.has(site)) list = list.filter((t) => t.site === site);
  if (unused === true || unused === '1' || unused === 'true') {
    list = list.filter((t) => !t.usedAt);
  }
  if (wallet) list = list.filter((t) => t.walletAddress === wallet);
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

function consumeTicket(code, site) {
  if (!SITES.has(site)) return { ok: false, error: 'Invalid site', status: 400 };
  const norm = normalizeCode(code);
  if (norm.length < 4) {
    return { ok: false, error: 'Invalid or missing spin code', status: 400 };
  }
  return update((store) => {
    const ticket = store.tickets.find((t) => codesMatch(t.code, code) && t.site === site);
    if (!ticket) return { ok: false, error: 'Unknown or invalid spin code', status: 404 };
    if (ticket.usedAt) {
      return {
        ok: false,
        error: 'This spin code has already been used',
        status: 409,
        ticket: { ...ticket },
      };
    }
    ticket.usedAt = Date.now();
    return { ok: true, ticket };
  });
}

/**
 * GOML public: ensure one unused wallet-bound entitlement, then consume it.
 * If wallet already used a goml ticket, reject. If unused bound ticket exists, consume it.
 * Otherwise mint + consume a pre-checkout ticket bound to wallet (one free spin).
 */
function consumeWalletEntitlement(wallet, site = 'goml') {
  if (!XRPL_ADDR_RE.test(wallet)) {
    return { ok: false, error: 'Invalid wallet', status: 400 };
  }
  if (!SITES.has(site)) return { ok: false, error: 'Invalid site', status: 400 };

  return update((store) => {
    const forWallet = store.tickets.filter(
      (t) => t.site === site && t.walletAddress === wallet
    );
    const used = forWallet.find((t) => t.usedAt);
    if (used) {
      return {
        ok: false,
        error: 'This wallet has already used its spin',
        status: 409,
        ticket: { ...used },
      };
    }
    let ticket = forWallet.find((t) => !t.usedAt);
    if (!ticket) {
      ticket = {
        code: generateCode(),
        orderId: null,
        site,
        walletAddress: wallet,
        usedAt: null,
        createdAt: Date.now(),
        prizeResult: null,
      };
      store.tickets.push(ticket);
    }
    ticket.usedAt = Date.now();
    return { ok: true, ticket };
  });
}

function attachPrizeResult(code, site, prizeResult) {
  update((store) => {
    const ticket = store.tickets.find((t) => codesMatch(t.code, code) && t.site === site);
    if (ticket) ticket.prizeResult = prizeResult;
  });
}

function findTicket(code, site) {
  const store = load();
  return (
    store.tickets.find((t) => codesMatch(t.code, code) && (!site || t.site === site)) || null
  );
}

function walletEntitlementStatus(wallet, site = 'goml') {
  const store = load();
  const forWallet = store.tickets.filter(
    (t) => t.site === site && t.walletAddress === wallet
  );
  const used = forWallet.find((t) => t.usedAt);
  const unused = forWallet.find((t) => !t.usedAt);
  if (used) {
    return {
      status: 'used',
      ticket: used,
      prizeResult: used.prizeResult || null,
    };
  }
  if (unused) return { status: 'ready', ticket: unused };
  return { status: 'eligible' }; // will mint on spin
}

module.exports = {
  SITES,
  generateCode,
  normalizeCode,
  createTickets,
  listTickets,
  consumeTicket,
  consumeWalletEntitlement,
  attachPrizeResult,
  findTicket,
  walletEntitlementStatus,
  XRPL_ADDR_RE,
};
