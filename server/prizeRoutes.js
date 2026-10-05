'use strict';

/**
 * Prize catalog + spin tickets + prize codes HTTP API (staging).
 *
 * Public:
 *   GET  /api/prizes                      enabled wheel prizes
 *   GET  /api/tickets/lookup?code=        ticket / prize-code status (+ shop discount, optional quote)
 *   POST /api/tickets/spin {code}         spend a spin ticket → server-side fair spin over enabled prizes
 * Admin (X-Admin-Token):
 *   GET/POST /api/admin/prizes, PUT/DELETE /api/admin/prizes/:id   manage prize list ("add a code")
 *   POST /api/tickets {site,count,orderId}                         mint spin tickets (shop compatible)
 *   GET  /api/tickets                                             list tickets / prize codes
 *   POST /api/admin/prize-codes {prizeId,count,site,orderId}       issue codes pre-bound to a prize
 *   POST /api/admin/prize-codes/redeem {code,orderId}              one-time redeem / mark fulfilled
 */
const rateLimit = require('express-rate-limit');
const { createSpin } = require('./spin');
const catalog = require('./prizeCatalog');
const tickets = require('./tickets');
const { parseDiscount, applyDiscount } = require('./discount');
const { issueRedeemCode } = require('./redeem');
const { STAGING_LEDGER_EXAMPLE } = require('./ledgerPrizes');

function prizeForResult(prizeResult) {
  if (!prizeResult) return null;
  return (
    catalog.findPrize({ id: prizeResult.prizeId, label: prizeResult.label }) ||
    (prizeResult.type ? { label: prizeResult.label, type: prizeResult.type, value: prizeResult.value, sku: prizeResult.sku } : null)
  );
}

function discountForResult(prizeResult) {
  if (!prizeResult) return null;
  if (prizeResult.type) {
    return catalog.discountFor({
      label: prizeResult.label,
      type: prizeResult.type,
      value: prizeResult.value,
      sku: prizeResult.sku,
    });
  }
  const p = prizeForResult(prizeResult);
  return p ? catalog.discountFor(p) : parseDiscount(prizeResult.label);
}

function prizeResultFrom(prize, extra = {}) {
  return {
    label: prize.label,
    prizeId: prize.id || null,
    type: prize.type,
    value: prize.value ?? null,
    sku: prize.sku || null,
    ...extra,
  };
}

function ticketView(t, { subtotalCents, shippingCents } = {}) {
  if (!t) return null;
  const pr = t.prizeResult || null;
  const discount = discountForResult(pr);
  const view = {
    code: t.code,
    site: t.site,
    used: Boolean(t.usedAt),
    usedAt: t.usedAt || null,
    orderId: t.orderId || undefined,
    walletAddress: t.walletAddress || undefined,
    createdAt: t.createdAt || null,
    prizeResult: t.usedAt ? pr : undefined,
    prizeType: pr ? pr.type || (catalog.inferType(pr.label).type) : null,
    discount: discount || undefined,
    fulfillment: pr ? catalog.fulfillmentFor({ type: pr.type || catalog.inferType(pr.label).type }) : null,
    redeemed: Boolean(t.redeemedAt),
    redeemedAt: t.redeemedAt || null,
    redeemedOrderId: t.redeemedOrderId || null,
    ledgerRedeemCode: t.ledgerRedeemCode || undefined,
    source: pr ? pr.source || 'spin' : undefined,
  };
  if (subtotalCents !== undefined || shippingCents !== undefined) {
    view.quote = applyDiscount(discount, subtotalCents, shippingCents);
  }
  return view;
}

function intOrUndef(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

function mount(app, { requireAdmin }) {
  const ticketSpinLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many spins; try again shortly' },
  });
  const lookupLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many lookups; try again shortly' },
  });

  // ── Prize catalog ─────────────────────────────────────────────────────────
  app.get('/api/prizes', (_req, res) => {
    const prizes = catalog.wheelPrizes().map(catalog.publicPrize);
    res.json({ ok: true, prizes, labels: prizes.map((p) => p.label) });
  });

  app.get('/api/admin/prizes', requireAdmin, (_req, res) => {
    res.json({
      ok: true,
      prizes: catalog.listPrizes().map(catalog.publicPrize),
      types: Object.entries(catalog.TYPES).map(([id, t]) => ({ id, ...t })),
      storePath: 'data/store.json → prizes',
    });
  });

  app.post('/api/admin/prizes', requireAdmin, (req, res) => {
    const out = catalog.addPrize(req.body || {});
    if (!out.ok) return res.status(out.status || 400).json(out);
    console.log('[prizes] added id=%s type=%s', out.prize.id, out.prize.type);
    return res.status(201).json({ ok: true, prize: catalog.publicPrize(out.prize) });
  });

  app.put('/api/admin/prizes/:id', requireAdmin, (req, res) => {
    const out = catalog.updatePrize(req.params.id, req.body || {});
    if (!out.ok) return res.status(out.status || 400).json(out);
    return res.json({ ok: true, prize: catalog.publicPrize(out.prize) });
  });

  app.delete('/api/admin/prizes/:id', requireAdmin, (req, res) => {
    const out = catalog.deletePrize(req.params.id, { protectLabel: STAGING_LEDGER_EXAMPLE.label });
    if (!out.ok) return res.status(out.status || 400).json(out);
    return res.json({ ok: true, removed: out.removed && out.removed.id });
  });

  // ── Spin tickets (shop / goml) ───────────────────────────────────────────
  app.post('/api/tickets', requireAdmin, (req, res) => {
    const result = tickets.createTickets({
      site: req.body?.site || 'shop',
      count: req.body?.count,
      codes: req.body?.codes,
      orderId: req.body?.orderId,
      walletAddress: req.body?.walletAddress,
      note: req.body?.note,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json({ tickets: result.tickets });
  });

  app.get('/api/tickets', requireAdmin, (req, res) => {
    const list = tickets.listTickets({ site: req.query.site, unused: req.query.unused, limit: req.query.limit });
    return res.json({ ok: true, tickets: list.map((t) => ticketView(t)) });
  });

  app.get('/api/tickets/lookup', lookupLimiter, (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'code required' });
    const site = req.query.site === 'shop' || req.query.site === 'goml' ? req.query.site : undefined;
    const t = tickets.findTicket(String(code), site);
    if (!t) return res.status(404).json({ error: 'Unknown code' });
    return res.json(
      ticketView(t, {
        subtotalCents: intOrUndef(req.query.subtotalCents),
        shippingCents: intOrUndef(req.query.shippingCents),
      })
    );
  });

  app.post('/api/tickets/spin', ticketSpinLimiter, (req, res) => {
    const code = String(req.body?.code || '').trim();
    const site = req.body?.site === 'shop' || req.body?.site === 'goml' ? req.body.site : undefined;
    const prizes = catalog.wheelPrizes();
    if (prizes.length < 2) return res.status(503).json({ error: 'Wheel needs at least 2 enabled prizes' });
    const items = prizes.map((p) => p.label);
    let spin = null;
    const out = tickets.spinTicket(code, site, () => {
      spin = createSpin('prizes', items);
      const prize = prizes[spin.result.index];
      return prizeResultFrom(prize, {
        index: spin.result.index,
        nonce: spin.result.nonce,
        ts: spin.result.ts,
        signature: spin.signature,
        source: 'ticket_spin',
      });
    });
    if (!out.ok) {
      return res.status(out.status || 400).json({
        error: out.error,
        ticket: out.ticket ? ticketView(out.ticket) : undefined,
      });
    }
    let ticket = out.ticket;
    let redeemCode = null;
    if (ticket.prizeResult.type === 'xrp') {
      try {
        const rec = issueRedeemCode({ prizeLabel: ticket.prizeResult.label, spinNonce: spin.result.nonce });
        redeemCode = rec.code;
        ticket = tickets.setTicketFields(ticket.code, { ledgerRedeemCode: rec.code }) || ticket;
      } catch (err) {
        console.error('[tickets/spin] ledger redeem issue failed:', err.message);
      }
    }
    console.log('[tickets/spin] code=%s prize=%s type=%s', ticket.code.slice(0, 4) + '…', ticket.prizeResult.prizeId, ticket.prizeResult.type);
    return res.json({
      ok: true,
      result: spin.result,
      signature: spin.signature,
      prize: catalog.publicPrize(prizes[spin.result.index]),
      prizeCode: ticket.prizeResult.type === 'none' || ticket.prizeResult.type === 'xrp' ? null : ticket.code,
      redeemCode,
      ticket: ticketView(ticket),
    });
  });

  // ── Direct-issue prize codes + redeem (admin) ────────────────────────────
  app.post('/api/admin/prize-codes', requireAdmin, (req, res) => {
    const prize = catalog.findPrize({ id: req.body?.prizeId, label: req.body?.label });
    if (!prize) return res.status(404).json({ ok: false, error: 'Unknown prize (prizeId or label)' });
    if (prize.type === 'none') return res.status(400).json({ ok: false, error: 'Cannot issue a code for a no-prize segment' });
    const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 100);
    if (prize.type === 'xrp') {
      try {
        const codes = [];
        for (let i = 0; i < count; i++) codes.push(issueRedeemCode({ prizeLabel: prize.label, spinNonce: null }).code);
        return res.status(201).json({ ok: true, prize: catalog.publicPrize(prize), redeemCodes: codes, codes: [],
          notice: 'XRP prize: give the STG- code to the winner; they redeem with an XRPL address (testnet on staging).' });
      } catch (err) {
        return res.status(err.status || 400).json({ ok: false, error: err.message });
      }
    }
    const result = tickets.createTickets({
      site: req.body?.site || 'shop',
      count,
      orderId: req.body?.orderId,
      note: req.body?.note,
      prizeResult: prizeResultFrom(prize, { source: 'admin_issue', ts: Date.now() }),
    });
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
    console.log('[prize-codes] issued %d prize=%s', result.tickets.length, prize.id);
    return res.status(201).json({
      ok: true,
      prize: catalog.publicPrize(prize),
      codes: result.tickets.map((t) => t.code),
      tickets: result.tickets.map((t) => ticketView(t)),
    });
  });

  app.post('/api/admin/prize-codes/redeem', requireAdmin, (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ ok: false, error: 'code required' });
    const out = tickets.redeemTicket(code, { orderId: req.body?.orderId, note: req.body?.note });
    if (!out.ok) {
      return res.status(out.status || 400).json({ ok: false, error: out.error, ticket: out.ticket ? ticketView(out.ticket) : undefined });
    }
    const view = ticketView(out.ticket, {
      subtotalCents: intOrUndef(req.body?.subtotalCents),
      shippingCents: intOrUndef(req.body?.shippingCents),
    });
    console.log('[prize-codes] redeemed code=%s type=%s', out.ticket.code.slice(0, 4) + '…', view.prizeType);
    return res.json({ ok: true, ticket: view });
  });
}

/**
 * Admin /api/spin in prizes mode: if the landed label is a configured coupon-type prize,
 * issue a prize code bound to that spin (so a host-run spin yields a redeemable code).
 */
function attachPrizeCodeForAdminSpin(result, signature, site) {
  if (!result || result.mode !== 'prizes') return null;
  const prize = catalog.findPrize({ label: result.label });
  if (!prize || !catalog.TYPES[prize.type] || !catalog.TYPES[prize.type].couponable) return null;
  const out = tickets.createTickets({
    site: site === 'shop' ? 'shop' : 'goml',
    count: 1,
    prizeResult: prizeResultFrom(prize, {
      index: result.index, nonce: result.nonce, ts: result.ts, signature, source: 'admin_spin',
    }),
  });
  if (!out.ok) return null;
  return { prizeCode: out.tickets[0].code, prize: catalog.publicPrize(prize), discount: catalog.discountFor(prize) };
}

module.exports = { mount, attachPrizeCodeForAdminSpin, ticketView };
