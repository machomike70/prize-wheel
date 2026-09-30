'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { PORT, CORS_ORIGINS } = require('./config');
const {
  normalizeRequest,
  createSpin,
  verify,
  parsePayload,
  isPlausiblePayload,
} = require('./spin');
const { requireAdmin, getWalletSession, adminConfigured } = require('./auth');
const {
  createTickets,
  listTickets,
  consumeTicket,
  consumeWalletEntitlement,
  attachPrizeResult,
  findTicket,
  walletEntitlementStatus,
  normalizeCode,
} = require('./tickets');
const {
  getPrizes,
  setPrizes,
  recordGiveaway,
  listGiveaways,
  getLive,
  setLiveReady,
  setLiveSpin,
  markLiveDone,
  clearLive,
  LIVE_SPIN_DURATION_MS,
} = require('./store');
const liveHub = require('./live');
const { resolveSite } = require('./site');
const walletAuth = require('./walletAuth');
const { parseDiscount } = require('./discount');
const { parseSpaceId, scrapeSpace, formatParticipantsForGiveaway } = require('./spaces');

const app = express();
// Behind Caddy — needed for express-rate-limit X-Forwarded-For
app.set("trust proxy", 1);
const publicDir = path.join(__dirname, '..', 'public');

app.use(express.json({ limit: '64kb' }));

const corsOptions =
  CORS_ORIGINS === '*'
    ? { origin: true, credentials: true }
    : {
        origin(origin, cb) {
          if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
          return cb(new Error('Not allowed by CORS'));
        },
        credentials: true,
      };
app.use(cors(corsOptions));

const spinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many spins; try again shortly' },
});

const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scrape requests; try again shortly' },
});

walletAuth.mount(app);

// ── Public config / prizes ───────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const site = resolveSite(req);
  res.json({
    site,
    adminConfigured: adminConfigured(),
    xamanConfigured: walletAuth.xamanConfigured(),
    prizes: getPrizes(),
  });
});

app.get('/api/prizes', (_req, res) => {
  res.json({ prizes: getPrizes() });
});

app.put('/api/prizes', requireAdmin, (req, res) => {
  if (!Array.isArray(req.body?.items) && !Array.isArray(req.body?.prizes)) {
    return res.status(400).json({ error: 'items (or prizes) array required' });
  }
  const items = req.body.items || req.body.prizes;
  const cleaned = items.map((x) => String(x).trim()).filter((s) => s.length > 0);
  if (cleaned.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 prizes' });
  }
  if (cleaned.length > 100) {
    return res.status(400).json({ error: 'Too many prizes (max 100)' });
  }
  for (const s of cleaned) {
    if (s.length > 80) return res.status(400).json({ error: 'Prize too long (max 80)' });
  }
  const prizes = setPrizes(cleaned);
  return res.json({ prizes });
});

// ── Tickets (admin mint / list) ──────────────────────────────────────────────

app.post('/api/tickets', requireAdmin, (req, res) => {
  const result = createTickets({
    site: req.body?.site || 'shop',
    count: req.body?.count,
    codes: req.body?.codes,
    orderId: req.body?.orderId,
    walletAddress: req.body?.walletAddress,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ tickets: result.tickets });
});

app.get('/api/tickets', requireAdmin, (req, res) => {
  const unused =
    req.query.unused === '1' || req.query.unused === 'true'
      ? true
      : req.query.unused === '0' || req.query.unused === 'false'
        ? false
        : undefined;
  const list = listTickets({
    site: req.query.site,
    unused: unused === false ? undefined : unused,
    wallet: req.query.wallet,
  });
  // If unused=false explicitly, show only used — keep simple: filter client-side if needed
  return res.json({ tickets: list });
});

app.get('/api/tickets/lookup', (req, res) => {
  const site = resolveSite(req);
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: 'code required' });
  const ticket = findTicket(code, site === 'open' ? undefined : site);
  if (!ticket) return res.status(404).json({ error: 'Unknown code' });
  const prizeResult = ticket.usedAt ? ticket.prizeResult : undefined;
  const discount = prizeResult?.label ? parseDiscount(prizeResult.label) : null;
  return res.json({
    code: ticket.code,
    site: ticket.site,
    used: Boolean(ticket.usedAt),
    usedAt: ticket.usedAt,
    walletAddress: ticket.walletAddress || undefined,
    orderId: ticket.orderId || undefined,
    prizeResult,
    discount: discount || undefined,
  });
});

app.get('/api/entitlement', (req, res) => {
  const session = getWalletSession(req);
  if (!session) return res.status(401).json({ error: 'Wallet sign-in required' });
  const q = req.query?.site;
  const resolved = resolveSite(req);
  const site =
    q === 'shop' || q === 'goml'
      ? q
      : resolved === 'shop' || resolved === 'goml'
        ? resolved
        : 'goml';
  const status = walletEntitlementStatus(session.wallet, site);
  const prizeLabel = status.prizeResult?.label;
  const discount = prizeLabel ? parseDiscount(prizeLabel) : null;
  return res.json({
    wallet: session.wallet,
    role: session.role,
    site,
    ...status,
    discount: discount || undefined,
  });
});

// ── Fair spin ────────────────────────────────────────────────────────────────

app.post('/api/spin', spinLimiter, (req, res) => {
  const site = resolveSite(req);
  let consumedTicket = null;

  // Shop: unused purchase code (Square thank-you) OR wallet entitlement (Xaman pre-checkout)
  if (site === 'shop') {
    const code = req.body?.code || req.query?.code;
    if (code && normalizeCode(code)) {
      const consumed = consumeTicket(code, 'shop');
      if (!consumed.ok) {
        return res.status(consumed.status).json({
          error: consumed.error,
          usedAt: consumed.ticket?.usedAt,
          prizeResult: consumed.ticket?.prizeResult,
        });
      }
      consumedTicket = consumed.ticket;
    } else {
      const session = getWalletSession(req);
      if (!session) {
        return res.status(401).json({
          error: 'Spin code or wallet sign-in required for shop',
        });
      }
      const consumed = consumeWalletEntitlement(session.wallet, 'shop');
      if (!consumed.ok) {
        return res.status(consumed.status).json({
          error: consumed.error,
          usedAt: consumed.ticket?.usedAt,
          prizeResult: consumed.ticket?.prizeResult,
        });
      }
      consumedTicket = consumed.ticket;
    }
  }

  // GOML: wallet session required; one entitlement per wallet (pre-checkout)
  if (site === 'goml') {
    const session = getWalletSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Wallet sign-in required for GOML spins' });
    }
    // Admins distributing live can pass adminSpin=1 to skip entitlement (fair spin still)
    const adminSpin = req.body?.adminSpin === true || req.body?.adminSpin === 1;
    const { isAdminRequest } = require('./auth');
    if (adminSpin && isAdminRequest(req)) {
      // free admin distribution spin — no ticket consume
      consumedTicket = null;
    } else {
      const consumed = consumeWalletEntitlement(session.wallet, 'goml');
      if (!consumed.ok) {
        return res.status(consumed.status).json({
          error: consumed.error,
          usedAt: consumed.ticket?.usedAt,
          prizeResult: consumed.ticket?.prizeResult,
        });
      }
      consumedTicket = consumed.ticket;
    }
  }

  // For shop/goml, force server-managed prize list (client cannot change odds).
  // Admin giveaway spins (adminSpin + requireAdmin creds) may pass mode/items.
  let body = req.body || {};
  const adminGiveaway =
    (body.adminSpin === true || body.adminSpin === 1) &&
    require('./auth').isAdminRequest(req);
  if ((site === 'shop' || site === 'goml') && !adminGiveaway) {
    const prizes = getPrizes();
    body = { mode: 'prizes', items: prizes };
  } else if (adminGiveaway) {
    const mode = body.mode === 'names' ? 'names' : 'prizes';
    let items = Array.isArray(body.items) ? body.items : null;
    if (mode === 'prizes' && (!items || !items.length)) items = getPrizes();
    body = { mode, items: items || [] };
  }

  const norm = normalizeRequest(body);
  if (!norm.ok) {
    // Best-effort: we already consumed — attach error note (rare: bad prize list)
    return res.status(norm.status).json({ error: norm.error });
  }

  const out = createSpin(norm.mode, norm.items);

  if (consumedTicket) {
    attachPrizeResult(consumedTicket.code, consumedTicket.site, {
      label: out.result.label,
      index: out.result.index,
      nonce: out.result.nonce,
      ts: out.result.ts,
      signature: out.signature,
    });
  }

  const discount = parseDiscount(out.result.label);
  return res.json({
    ...out,
    site,
    discount: discount || undefined,
    ticket: consumedTicket
      ? { code: consumedTicket.code, site: consumedTicket.site, walletAddress: consumedTicket.walletAddress }
      : undefined,
  });
});

function handleVerify(req, res) {
  const rawPayload = req.method === 'GET' ? req.query.payload : req.body?.payload ?? req.body?.result;
  const sig = req.method === 'GET' ? req.query.sig : req.body?.sig ?? req.body?.signature;

  const payload = parsePayload(rawPayload);
  if (!payload || !isPlausiblePayload(payload)) {
    return res.status(400).json({ valid: false, error: 'Invalid payload' });
  }
  if (typeof sig !== 'string') {
    return res.status(400).json({ valid: false, error: 'Missing signature' });
  }
  const valid = verify(
    {
      mode: payload.mode,
      items: payload.items,
      index: payload.index,
      nonce: payload.nonce,
      ts: payload.ts,
    },
    sig
  );
  return res.json({ valid });
}

app.get('/api/verify', handleVerify);
app.post('/api/verify', handleVerify);

// ── Public live giveaway (watch-only; no wallet / shop gate) ────────────────

app.get('/api/live', (_req, res) => {
  res.json({
    live: getLive(),
    viewers: liveHub.clientCount(),
  });
});

app.get('/api/live/stream', (req, res) => {
  liveHub.subscribe(req, res);
  // Push current snapshot immediately so late joiners / reconnects sync
  try {
    res.write(
      `event: state\ndata: ${JSON.stringify({ live: getLive() })}\n\n`
    );
  } catch {
    /* client gone */
  }
});

app.post('/api/admin/live/ready', requireAdmin, (req, res) => {
  const mode = req.body?.mode === 'names' ? 'names' : 'prizes';
  let items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (mode === 'prizes' && (!items || !items.length)) {
    items = getPrizes();
  }
  const norm = normalizeRequest({ mode, items: items || [] });
  if (!norm.ok) {
    return res.status(norm.status).json({ error: norm.error });
  }
  const live = setLiveReady({
    mode: norm.mode,
    items: norm.items,
    note: req.body?.note,
    adminWallet: req.adminWallet || null,
  });
  liveHub.broadcast('ready', { live });
  liveHub.broadcast('state', { live });
  return res.json({ live });
});

app.post('/api/admin/live/clear', requireAdmin, (_req, res) => {
  const live = clearLive();
  liveHub.broadcast('clear', { live });
  liveHub.broadcast('state', { live });
  return res.json({ live });
});

// ── Admin giveaway spin (no ticket / wallet burn) ───────────────────────────

app.post('/api/admin/spin', requireAdmin, spinLimiter, (req, res) => {
  const mode = req.body?.mode === 'names' ? 'names' : 'prizes';
  let items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (mode === 'prizes' && (!items || !items.length)) {
    items = getPrizes();
  }

  const norm = normalizeRequest({ mode, items: items || [] });
  if (!norm.ok) {
    return res.status(norm.status).json({ error: norm.error });
  }

  const out = createSpin(norm.mode, norm.items);

  const shouldRecord =
    req.body?.record === true ||
    req.body?.record === 1 ||
    req.body?.record === '1';
  let recorded = null;
  if (shouldRecord) {
    recorded = recordGiveaway({
      mode: out.result.mode,
      winner: out.result.label,
      index: out.result.index,
      nonce: out.result.nonce,
      ts: out.result.ts,
      signature: out.signature,
      note: req.body?.note,
      adminWallet: req.adminWallet || null,
      itemsCount: out.result.items.length,
    });
  }

  // Broadcast to public watchers unless explicitly disabled
  const broadcast =
    req.body?.broadcast !== false &&
    req.body?.broadcast !== 0 &&
    req.body?.broadcast !== '0';
  let live = null;
  if (broadcast) {
    live = setLiveSpin({
      mode: out.result.mode,
      items: out.result.items,
      index: out.result.index,
      winner: out.result.label,
      nonce: out.result.nonce,
      ts: out.result.ts,
      signature: out.signature,
      note: req.body?.note,
      adminWallet: req.adminWallet || null,
      durationMs: LIVE_SPIN_DURATION_MS,
    });
    liveHub.broadcast('spin', { live });
    liveHub.broadcast('state', { live });
    // Flip to done after animation window so late pollers see final state
    setTimeout(() => {
      const done = markLiveDone();
      liveHub.broadcast('done', { live: done });
      liveHub.broadcast('state', { live: done });
    }, LIVE_SPIN_DURATION_MS + 200);
  }

  const discount =
    out.result.mode === 'prizes' ? parseDiscount(out.result.label) : null;

  return res.json({
    ...out,
    giveaway: true,
    recorded: recorded || undefined,
    live: live || undefined,
    viewers: liveHub.clientCount(),
    discount: discount || undefined,
  });
});

app.get('/api/admin/giveaways', requireAdmin, (req, res) => {
  const limit = req.query.limit;
  return res.json({ giveaways: listGiveaways(limit) });
});

// ── X Space scraping for live giveaways ──────────────────────────────────────

app.post('/api/admin/spaces/scrape', requireAdmin, scrapeLimiter, async (req, res) => {
  const input = req.body?.spaceUrl || req.body?.spaceId;
  if (!input) {
    return res.status(400).json({ error: 'spaceUrl or spaceId required' });
  }

  const spaceId = parseSpaceId(input);
  if (!spaceId) {
    return res.status(400).json({ error: 'Invalid Space URL or ID' });
  }

  try {
    const result = await scrapeSpace(spaceId);
    if (!result.ok) {
      return res.status(result.status || 502).json({ error: result.error });
    }

    const names = formatParticipantsForGiveaway(result);
    return res.json({
      spaceId: result.spaceId,
      spaceData: result.spaceData,
      hosts: result.hosts,
      speakers: result.speakers,
      listeners: result.listeners,
      names,
      total: result.total,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Scrape failed' });
  }
});

app.get('/api/admin/status', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    wallet: req.adminWallet || null,
    role: req.adminRole || null,
    prizes: getPrizes(),
    ticketCounts: {
      shop: listTickets({ site: 'shop' }).length,
      shopUnused: listTickets({ site: 'shop', unused: true }).length,
      goml: listTickets({ site: 'goml' }).length,
      gomlUnused: listTickets({ site: 'goml', unused: true }).length,
    },
    giveawayCount: listGiveaways(200).length,
    live: getLive(),
    liveViewers: liveHub.clientCount(),
  });
});

app.use(express.static(publicDir));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get(['/live', '/live/'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Prize Wheel listening on http://127.0.0.1:${PORT}`);
});
