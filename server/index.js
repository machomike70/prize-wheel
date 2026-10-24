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
const { findLiveGomlSpace } = require('./gomlSpace');
const adminX = require('./adminX');
const prizeRoutes = require('./prizeRoutes');
const nftOps = require('./nftOps');
const xClaim = require('./xClaim');
const ticketsMod = require('./tickets');
const catalogMod = require('./prizeCatalog');
const { ensurePrizeCatalog, findPrize, publicPrize } = require('./prizeCatalog');

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

// Prize catalog + prize-code APIs (NFT/token/manual/shop). NO XRP sender on prod.
prizeRoutes.mount(app, { requireAdmin });

// NFT / issued-token prize ops wallet (rJB7…). IOU + NFT only; native XRP Payments refused.
nftOps.mount(app, { requireAdmin });
const spaceAutopost = require("./spaceAutopost"); // Space watch-link auto-post from @GetOffMyLawn70 (Oct 18)
require("./prizeWallet").mount(app, { requireAdmin }); // read-only prize wallet view (Oct 15)
require("./winners").mount(app, { requireAdmin }); // winners record (6-month retention)
const shopDiscountMod = require('./shopDiscount');
shopDiscountMod.mount(app, {
  requireAdmin,
  onMinted(v) {
    try {
      require('./winners').upsert({ code: v.code, xHandle: v.winner || null, prize: v.percent + '% off shop.bwtz.online', prizeType: 'shop_discount',
        dmText: v.dmText, status: 'code_minted', network: v.test ? 'shop-staging-TEST' : 'shop-live', note: v.idemKey });
    } catch (e) { console.error('[shop-discount] winners', e.message); }
  },
});
const xDmClaim = require('./xDmClaim');
xDmClaim.mount(app, { requireAdmin, tickets: require('./tickets'), catalog: catalogMod, nftOps, shopDiscount: shopDiscountMod, winners: require('./winners') });
// X claim admin issue + status (claim route already mounted by nftOps)
xClaim.mount(app, {
  requireAdmin,
  tickets: ticketsMod,
  catalog: catalogMod,
  mountClaim: false,
});


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

// GET /api/prizes is mounted by prizeRoutes (labels + details). Legacy bulk replace:
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

// Tickets mint/list/lookup + prize-codes: see prizeRoutes.mount above.
// Wallet entitlement (GOML/shop Xaman) stays here:

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
    const cat = findPrize({ label: out.result.label });
    attachPrizeResult(consumedTicket.code, consumedTicket.site, {
      label: out.result.label,
      prizeId: cat ? cat.id : null,
      type: cat ? cat.type : undefined,
      value: cat && cat.value !== undefined ? cat.value : undefined,
      sku: cat && cat.sku ? cat.sku : undefined,
      index: out.result.index,
      nonce: out.result.nonce,
      ts: out.result.ts,
      signature: out.signature,
      source: 'wallet_or_ticket_spin',
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

app.post('/api/admin/spin', requireAdmin, spinLimiter, async (req, res) => {
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
    // Flip to done after animation window so late pollers see final state.
    // Scope to this live.id so a later spin is not marked done by this timer.
    const spunId = live.id;
    setTimeout(() => {
      const done = markLiveDone(spunId);
      if (done && done.id === spunId && done.status === 'done') {
        liveHub.broadcast('done', { live: done });
        liveHub.broadcast('state', { live: done });
      }
    }, LIVE_SPIN_DURATION_MS + 200);
  }

  const discount =
    out.result.mode === 'prizes' ? parseDiscount(out.result.label) : null;
  const coupon = prizeRoutes.attachPrizeCodeForAdminSpin(out.result, out.signature, req.body?.site);
  // Q5: shop codes are minted only after the winner sends their wallet (X DM claim flow), never at spin time.
  let shopDiscount; let claim; let prizeWon = null;
  if (out.result.mode === 'prizes') {
    const sp = catalogMod.findPrize({ label: out.result.label });
    if (sp && sp.type === 'shop_discount') prizeWon = sp.value + '% off at shop.bwtz.online';
  }
  const manualMode = out.result.mode === 'names' && xDmClaim.getMode() === 'manual';
  if (manualMode && live && req.body?.autoClaim !== false) { // Manual: names only, winner flow runs, NO prize named or sent
    try { claim = xDmClaim.createClaim({ handle: out.result.label, prizeId: '__manual__', liveId: live.id, spinStartedAt: live.startedAt,
        spaceId: req.body?.spaceId || null, spaceTitle: req.body?.note || null, userId: (process.env.DM_SIMULATE_ENABLED === 'true' && req.body?.testUserId) || undefined }); } catch (e) { claim = { error: e.message }; }
  } else if (out.result.mode === 'names' && req.body?.claimPrizeId && live) {
    try {
      claim = xDmClaim.createClaim({ handle: out.result.label, prizeId: req.body.claimPrizeId, liveId: live.id, spinStartedAt: live.startedAt,
        spaceId: req.body?.spaceId || null, spaceTitle: req.body?.note || null });
      const p = claim.prize; prizeWon = p.type === 'shop_discount' ? p.percent + '% off at shop.bwtz.online' : p.label;
    } catch (e) { claim = { error: e.message }; }
  }
  if (prizeWon && live) {
    const st = require('./store');
    st.update((s) => { if (s.live && s.live.id === live.id) s.live.prizeWon = prizeWon; return null; });
    live = st.getLive();
    liveHub.broadcast('state', { live });
  }

  return res.json({
    ...out,
    giveaway: true,
    recorded: recorded || undefined,
    live: live || undefined,
    viewers: liveHub.clientCount(),
    discount: discount || undefined,
    prizeCode: coupon ? coupon.prizeCode : undefined,
    shopDiscount: shopDiscount || undefined,
    claim: claim ? { id: claim.id, code: claim.code, handle: claim.handle, prize: claim.prize, dmDueAt: claim.dmDueAt, expiresAt: claim.expiresAt, error: claim.error } : undefined,
    prize: coupon ? coupon.prize : undefined,
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
      return res.status(result.status || 502).json({
        error: result.error,
        hasListeners: result.hasListeners === true,
        method: result.method || undefined,
        warning: result.warning || undefined,
      });
    }

    const names = formatParticipantsForGiveaway(result);
    // Admin tapped SCRAPE: post the watch link ONCE per Space from @GetOffMyLawn70 (AUTOPOST_MODE=live, else simulated).
    const autopost = req.body?.autopost === true
      ? await spaceAutopost.autopostAfterScrape(result, await adminX.trackingFor(req).catch(() => null), { spacePostUrl: typeof req.body?.spacePostUrl === 'string' ? req.body.spacePostUrl.slice(0, 300) : undefined })
      : undefined;
    return res.json({
      autopost,
      spaceId: result.spaceId,
      spaceData: result.spaceData,
      hosts: result.hosts,
      speakers: result.speakers,
      listeners: result.listeners,
      names,
      total: result.total,
      hasListeners: result.hasListeners === true,
      warning: result.warning || undefined,
      method: result.method || undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Scrape failed' });
  }
});

// Auto-detect the live GOML Space (creator or host = GOML accounts; ids via
// GOML_SPACE_HOST_IDS). Read-only; always 200 so the admin can fall back to
// pasted/cached names when nothing is live or X is unavailable.
const spaceDetectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Space lookups; try again shortly' },
});

// Latest watch-link post + replies for the current Space, for every admin's spin page (not only the one who scraped).
app.get('/api/admin/spaces/autopost-latest', requireAdmin, (_req, res) => {
  res.json({ ok: true, latest: spaceAutopost.getLatest() });
});

app.get('/api/admin/spaces/goml-live', requireAdmin, spaceDetectLimiter, async (req, res) => {
  try {
    const fresh = String(req.query.fresh || '') === '1';
    const quick = String(req.query.quick || '') === '1';
    // Track WHICHEVER admin is asking (their X account), plus GOML fallbacks.
    const tracking = await adminX.trackingFor(req);
    return res.json(
      await findLiveGomlSpace({ meIds: tracking.userId ? [tracking.userId] : [], tracking, fresh, quick })
    );
  } catch (err) {
    return res.json({ ok: false, live: false, space: null, spaces: [], error: err.message || 'Lookup failed' });
  }
});

// Per-admin "My X handle" for Space tracking (GET/PUT /api/admin/me/x)
adminX.mount(app, { requireAdmin, limiter: spaceDetectLimiter });

app.get('/api/admin/status', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    wallet: req.adminWallet || null,
    role: req.adminRole || null,
    xrpSendsEnabled: false,
    xrpSendsNote: 'Production XRP Payment path permanently OFF for Wednesday NFT unlock',
    nftOps: '/api/admin/nft-ops/status (NFT + IOU sends only)',
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

app.use((req, res, next) => {
  const pathOnly = (req.path || '').split('?')[0];
  if (pathOnly === '/script.js' || pathOnly.endsWith('/script.js')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

// Bust caches for hub logo swaps during live shows
app.use((req, res, next) => {
  if (/\/assets\/bw2-hub/i.test(req.path) || /bw2-hub.*\.png$/i.test(req.path)) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  next();
});

app.use(express.static(publicDir, {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (String(filePath).endsWith('script.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/prizes', (_req, res) => {
  res.sendFile(path.join(publicDir, 'prizes.html'));
});

app.get(['/live', '/live/'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

try {
  ensurePrizeCatalog();
} catch (err) {
  console.error('[prizes] ensurePrizeCatalog failed:', err.message);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Prize Wheel listening on http://127.0.0.1:${PORT}`);
  console.log('[prizes] Wednesday unlock: NFT/token/manual codes ON; nft-ops (NFT+IOU) mounted; mainnet XRP sends OFF');
});
