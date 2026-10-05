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
const { requireAdmin } = require('./auth');
const {
  addPayoutCode,
  getPayoutCodes,
  cleanExpiredCodes,
  update,
  addInventoryItem,
  getInventory,
  markDistributed,
  addDistribution,
  getDistributions,
} = require('./store');
const {
  createPayoutCode,
  validateAndBurn,
  checkCodeStatus,
} = require('./payout');
const { parseSpaceId, scrapeSpace, formatParticipantsForGiveaway } = require('./spaces');
const { findActiveHostedSpaces } = require('./spacesActive');
const xAuth = require('./xAuth');
const { scrapeXProfile, scrapeWebPage } = require('./scrape');
const { ensureStagingLedgerPrize, isLedgerDeliverable } = require('./ledgerPrizes');
const {
  attachLedgerRedeem,
  issueRedeemCode,
  claimRedeemCode,
  beginSend,
  finishSend,
  getRedeem,
  listRedeems,
} = require('./redeem');
const stagingSender = require('./stagingSender');
const prizeRoutes = require('./prizeRoutes');
const { ensurePrizeCatalog } = require('./prizeCatalog');
const { getHotWalletStatus } = require('./walletStatus');
const hotWallet = require('./hotWallet');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

// Initialize hot wallet on startup
hotWallet.initialize().catch(err => {
  console.error('[Server] Hot wallet initialization failed:', err.message);
});

app.use(express.json({ limit: '64kb' }));

const corsOptions =
  CORS_ORIGINS === '*'
    ? { origin: true }
    : {
        origin(origin, cb) {
          if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
          return cb(new Error('Not allowed by CORS'));
        },
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

// Staging: spin trigger is admin-only. Public viewers use GET verify / static UI.
app.post('/api/spin', spinLimiter, requireAdmin, (req, res) => {
  const norm = normalizeRequest(req.body);
  if (!norm.ok) {
    return res.status(norm.status).json({ error: norm.error });
  }
  const out = createSpin(norm.mode, norm.items);
  const ledger = attachLedgerRedeem(out.result);
  const coupon = prizeRoutes.attachPrizeCodeForAdminSpin(out.result, out.signature, req.body?.site);
  return res.json({
    ...out,
    redeemCode: ledger.redeemCode,
    ledgerDelivery: ledger.ledgerDelivery,
    redeem: ledger.redeem,
    prizeCode: coupon ? coupon.prizeCode : null,
    prize: coupon ? coupon.prize : null,
  });
});

// Prize catalog ("prize codes"), spin tickets, direct-issue codes, redeem.
prizeRoutes.mount(app, { requireAdmin });

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

// Giveaway spin endpoint (admin-only) - generates payout code after fair spin
app.post('/api/giveaway/spin', spinLimiter, requireAdmin, (req, res) => {
  const norm = normalizeRequest(req.body);
  if (!norm.ok) {
    return res.status(norm.status).json({ error: norm.error });
  }
  
  const spinResult = createSpin(norm.mode, norm.items);
  const { result, signature } = spinResult;
  
  // Generate one-time payout code
  const { code, codeDisplay, record } = createPayoutCode({
    spinId: result.nonce, // Use nonce as unique spin ID
    winner: result.label, // The winning name/handle
    mode: result.mode,
    label: result.label,
  });
  
  // Store only the hash
  addPayoutCode(record);
  
  // Clean up old codes periodically (keep < 100 codes in memory)
  const codes = getPayoutCodes();
  if (codes.length > 100) {
    cleanExpiredCodes();
  }
  
  // Return spin result + plaintext code ONCE (never logged, never stored)
  return res.json({
    result,
    signature,
    payoutCode: code,
    payoutCodeDisplay: codeDisplay,
    payoutExpiresAt: record.expiresAt,
    notice: 'Save this code securely - it will not be shown again',
  });
});

// Claim endpoint (public) - validates and burns code
const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many claim attempts; try again shortly' },
});

app.post('/api/claim', claimLimiter, (req, res) => {
  const { code } = req.body;
  
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid code' });
  }
  
  const result = validateAndBurn({
    inputCode: code,
    payoutCodes: getPayoutCodes()
  });
  
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }
  
  // Persist the burned status to disk
  update((store) => {
    const codeIndex = store.payoutCodes.findIndex(c => c.codeHash === result.record.codeHash);
    if (codeIndex !== -1) {
      store.payoutCodes[codeIndex] = result.record;
    }
  });
  
  // Code is valid and burned - trigger NFT release
  // TODO: integrate with hot wallet / XRPL NFT send
  // For now, stub the release hook
  const releaseResult = stubNftRelease(result.record);
  
  return res.json({
    success: true,
    message: 'Code redeemed successfully',
    winner: result.record.winner,
    prize: result.record.label,
    spinId: result.record.spinId,
    nftRelease: releaseResult,
  });
});

// Check code status (public, read-only)
app.get('/api/claim/check', (req, res) => {
  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing code parameter' });
  }
  
  const payoutCodes = getPayoutCodes();
  const status = checkCodeStatus({ inputCode: code, payoutCodes });
  
  return res.json(status);
});

/**
 * Stub for NFT release - replace with actual XRPL hot wallet integration.
 */
function stubNftRelease(codeRecord) {
  console.log('[NFT Release Stub] Code burned:', {
    spinId: codeRecord.spinId,
    winner: codeRecord.winner,
    prize: codeRecord.label,
    burnedAt: new Date(codeRecord.burnedAt).toISOString(),
  });
  
  // Staging: no client-side wallet signature / Xaman step after claim.
  return {
    status: 'queued_server',
    message: 'NFT release queued server-side — no wallet signature required on staging',
    spinId: codeRecord.spinId,
    winner: codeRecord.winner,
  };
}

// ===== STAGING TESTNET SENDS (LEDGER REDEEM) =====

const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many redeem attempts; try again shortly' },
});

function hotWalletPublicStatus() {
  const status = getHotWalletStatus();
  const send = stagingSender.publicStatus();
  return {
    configured: status.configured === true,
    network: 'testnet',
    sendsEnabled: send.sendsEnabled === true,
    sendBlockedReason: send.sendBlockedReason,
    payoutXrp: send.payoutXrp,
  };
}

// Winner submits a one-time code plus their classic address.
// STAGING: when stagingSender gates pass (testnet only), a real testnet Payment
// is submitted from the staging hot wallet. Otherwise claims stay claimed_pending.
app.post('/api/redeem', redeemLimiter, async (req, res) => {
  const result = claimRedeemCode({
    code: req.body?.code,
    address: req.body?.address,
  });
  if (!result.ok) {
    return res.status(result.status || 400).json({
      ok: false,
      error: result.error,
      sent: false,
    });
  }
  const code = String(req.body?.code || '').trim();
  if (!stagingSender.sendsEnabled()) {
    return res.json({
      ok: true,
      status: 'claimed_pending',
      sent: false,
      message: 'Claim accepted. Sends are disabled; nothing was sent.',
      prize: result.record.prizeLabel,
      winnerAddress: result.record.winnerAddress,
      hotWallet: hotWalletPublicStatus(),
    });
  }
  const started = beginSend(code);
  if (!started) {
    return res.status(409).json({ ok: false, error: 'Send already in progress or done', sent: false });
  }
  try {
    const tx = await stagingSender.sendPrize({ destination: result.record.winnerAddress, code });
    const ok = tx.result === 'tesSUCCESS' && tx.validated === true;
    const rec = finishSend(code, ok ? { ok: true, tx } : { ok: false, tx, error: 'tx result ' + tx.result });
    console.log('[redeem-send] code=%s result=%s validated=%s hash=%s', code.slice(0, 8) + '...', tx.result, tx.validated, tx.hash);
    return res.status(ok ? 200 : 502).json({
      ok,
      status: rec.status,
      sent: rec.sent === true,
      prize: rec.prizeLabel,
      winnerAddress: rec.winnerAddress,
      txHash: tx.hash,
      txResult: tx.result,
      validated: tx.validated,
      amountXrp: tx.amountXrp,
      network: 'testnet',
      explorer: 'https://testnet.xrpl.org/transactions/' + tx.hash,
      hotWallet: hotWalletPublicStatus(),
    });
  } catch (err) {
    const rec = finishSend(code, { ok: false, error: err.message });
    console.error('[redeem-send] failed code=%s err=%s', code.slice(0, 8) + '...', err.message);
    return res.status(502).json({
      ok: false,
      status: rec ? rec.status : 'send_failed',
      sent: false,
      error: 'Send failed; flagged for manual review (no automatic retry).',
      hotWallet: hotWalletPublicStatus(),
    });
  }
});

// Public status for a redeem code (code holder only knows the code).
app.get('/api/redeem/status', redeemLimiter, (req, res) => {
  const rec = getRedeem(req.query?.code);
  if (!rec) return res.status(404).json({ ok: false, error: 'Unknown code' });
  return res.json({ ok: true, ...rec });
});

app.get('/api/admin/redeems', requireAdmin, (_req, res) => {
  return res.json({ ok: true, redeems: listRedeems(), hotWallet: hotWalletPublicStatus() });
});

app.post('/api/admin/ledger-redeem', requireAdmin, (req, res) => {
  const prizeLabel = String(req.body?.prizeLabel || '').trim();
  if (!isLedgerDeliverable(prizeLabel)) {
    return res.status(400).json({
      ok: false,
      error: 'Prize does not use on-ledger delivery',
      redeemCode: null,
      sent: false,
    });
  }
  try {
    const rec = issueRedeemCode({ prizeLabel, spinNonce: null });
    return res.json({
      ok: true,
      redeemCode: rec.code,
      status: rec.status,
      prize: rec.prizeLabel,
      sent: false,
      notice: stagingSender.sendsEnabled()
        ? 'Give this one-time code to the winner. Claim triggers a TESTNET payment.'
        : 'Give this one-time code to the winner. Nothing was sent on-ledger.',
    });
  } catch (err) {
    return res.status(err.status || 400).json({ ok: false, error: err.message, sent: false });
  }
});

// ===== HOT WALLET ENDPOINTS (GOML SHARED WALLET) =====

// Get hot wallet info (public address only)
app.get('/api/hotwallet/info', (req, res) => {
  if (!hotWallet.isEnabled()) {
    return res.status(503).json({ 
      error: 'Hot wallet not configured',
      message: 'Set HOT_WALLET_SEED in environment to enable'
    });
  }

  res.json({
    address: hotWallet.getAddress(),
    network: hotWallet.XRPL_NETWORK,
    enabled: true,
  });
});

// Get hot wallet account details (admin only)
app.get('/api/hotwallet/account', requireAdmin, async (req, res) => {
  if (!hotWallet.isEnabled()) {
    return res.status(503).json({ error: 'Hot wallet not configured' });
  }

  try {
    const info = await hotWallet.getAccountInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get hot wallet transactions (admin only)
app.get('/api/hotwallet/transactions', requireAdmin, async (req, res) => {
  if (!hotWallet.isEnabled()) {
    return res.status(503).json({ error: 'Hot wallet not configured' });
  }

  try {
    const limit = parseInt(req.query.limit) || 50;
    const txs = await hotWallet.getTransactions(limit);
    res.json({ transactions: txs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get hot wallet NFTs (admin only)
app.get('/api/hotwallet/nfts', requireAdmin, async (req, res) => {
  if (!hotWallet.isEnabled()) {
    return res.status(503).json({ error: 'Hot wallet not configured' });
  }

  try {
    const nfts = await hotWallet.getNFTs();
    res.json({ nfts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get inventory (admin only)
app.get('/api/hotwallet/inventory', requireAdmin, (req, res) => {
  const available = req.query.available === 'true';
  const items = getInventory({ available });
  res.json({ items });
});

// Add inventory item manually (admin only)
app.post('/api/hotwallet/inventory', requireAdmin, (req, res) => {
  const { type, tokenId, amount, sponsor, label, memo } = req.body;

  if (!type || !label) {
    return res.status(400).json({ error: 'Missing required fields: type, label' });
  }

  const item = {
    id: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type, // 'nft' or 'token'
    tokenId, // NFT ID or token code
    amount, // For tokens
    sponsor,
    label,
    memo,
    addedAt: Date.now(),
    distributed: false,
    distributedAt: null,
    distributionId: null,
  };

  addInventoryItem(item);
  res.json({ item });
});

// Distribute prize to winner (admin only)
app.post('/api/hotwallet/distribute', requireAdmin, async (req, res) => {
  if (!hotWallet.isEnabled()) {
    return res.status(503).json({ error: 'Hot wallet not configured' });
  }

  const { itemId, destination, spinId } = req.body;

  if (!itemId || !destination) {
    return res.status(400).json({ error: 'Missing required fields: itemId, destination' });
  }

  // Get inventory item
  const items = getInventory();
  const item = items.find(i => i.id === itemId);

  if (!item) {
    return res.status(404).json({ error: 'Inventory item not found' });
  }

  if (item.distributed) {
    return res.status(400).json({ error: 'Item already distributed' });
  }

  try {
    let txResult;

    if (item.type === 'nft') {
      // Create destination-locked NFT offer
      txResult = await hotWallet.createNFTOffer(item.tokenId, destination);
    } else if (item.type === 'token') {
      // Send token payment
      txResult = await hotWallet.sendPayment(
        destination,
        item.amount,
        `Prize: ${item.label} | Spin: ${spinId || 'manual'}`
      );
    } else {
      return res.status(400).json({ error: 'Unknown item type' });
    }

    // Record distribution
    const distribution = {
      id: `dist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      itemId,
      destination,
      spinId,
      txHash: txResult.hash,
      txResult: txResult.result,
      offerId: txResult.offerId,
      createdAt: Date.now(),
    };

    addDistribution(distribution);
    markDistributed(itemId, distribution.id);

    res.json({
      success: true,
      distribution,
      txHash: txResult.hash,
      explorerUrl: hotWallet.XRPL_NETWORK === 'mainnet'
        ? `https://livenet.xrpl.org/transactions/${txResult.hash}`
        : `https://testnet.xrpl.org/transactions/${txResult.hash}`,
    });
  } catch (err) {
    console.error('[HotWallet] Distribution failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get distributions (admin only)
app.get('/api/hotwallet/distributions', requireAdmin, (req, res) => {
  const distributions = getDistributions();
  res.json({ distributions });
});

// ===== CLIENT-SIDE WALLET REGISTRATION (SPONSORS/TENANTS) =====

// Register client-generated wallet (public address only)
app.post('/api/wallets/register', async (req, res) => {
  const { address, label, network, publicKey } = req.body;

  if (!address || !label) {
    return res.status(400).json({ error: 'Missing required fields: address, label' });
  }

  // SECURITY: Only accept public info, NEVER seed or private key
  if (req.body.seed || req.body.privateKey) {
    console.error('[Security] Attempted to send seed/private key to server - REJECTED');
    return res.status(400).json({ 
      error: 'SECURITY: Never send seed or private key to server',
    });
  }

  // Store only public info
  const wallet = {
    id: `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    address,
    label,
    network: network || 'testnet',
    publicKey,
    registeredAt: Date.now(),
    type: 'client-side', // Mark as client-generated
  };

  update((store) => {
    if (!store.wallets) store.wallets = [];
    store.wallets.push(wallet);
  });

  res.json({ 
    success: true,
    wallet: {
      id: wallet.id,
      address: wallet.address,
      label: wallet.label,
      network: wallet.network,
    }
  });
});

// Health endpoint
app.get('/api/health', (_req, res) => {
  return res.json({
    ok: true,
    service: 'prize-wheel-staging',
    hotWallet: hotWalletPublicStatus(),
    x: xAuth.publicStatus(),
    bearerConfigured: xAuth.bearerConfigured(),
    userOAuthConfigured: xAuth.userOAuthConfigured(),
  });
});

// Config for admin Space UI (no secrets)
app.get('/api/admin/spaces/config', requireAdmin, (_req, res) => {
  const st = xAuth.getStatus();
  return res.json({
    ok: true,
    spaceUrl: process.env.SPACE_URL || null,
    bearerConfigured: st.bearerConfigured,
    userOAuthConfigured: st.userOAuthConfigured,
    authMode: st.authMode,
    goml: { handle: st.goml.handle, userId: st.goml.userId },
    note:
      'Spaces lookups use the app Bearer (X Spaces endpoints reject OAuth 1.0a). ' +
      'GOML user OAuth identifies the GOML account so "Use GOML Space" can find the live Space ' +
      'GOML created / co-hosts / speaks in. Listener-only presence is not exposed by X — paste the URL.',
  });
});

// Active spaces endpoint
app.get('/api/admin/spaces/active', requireAdmin, async (req, res) => {
  try {
    const result = await findActiveHostedSpaces({ fresh: String(req.query.fresh || '') === '1' });
    const status = !result.ok && result.error && result.error.includes('not configured') ? 503 : 200;
    return res.status(status).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      found: false,
      space: null,
      spaces: [],
      chosen: null,
      reason: err.message || 'Active space lookup failed',
      error: err.message || 'Active space lookup failed',
    });
  }
});

// X Space scraping
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
    return res.json({
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
      auth: xAuth.publicStatus(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Scrape failed' });
  }
});

// X auth status
app.get('/api/admin/x/status', requireAdmin, scrapeLimiter, async (req, res) => {
  const status = xAuth.getStatus();
  if (String(req.query.verify || '') === '1') {
    status.verify = await xAuth.verifyUser({ force: false });
  }
  return res.json({ ok: true, ...status });
});

// X profile scraping
app.post('/api/admin/scrape/x-profile', requireAdmin, scrapeLimiter, async (req, res) => {
  const username = req.body?.username || req.body?.handle || req.body?.url;
  if (!username) {
    return res.status(400).json({
      error: 'username required (or handle / x.com profile url)',
      publicRead: 'locked — admin X-Admin-Token required',
    });
  }
  try {
    const result = await scrapeXProfile(username);
    if (!result.ok) {
      return res.status(result.status || 502).json({
        error: result.error,
        publicRead: 'locked — admin X-Admin-Token required',
      });
    }
    const { ok, ...payload } = result;
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'X profile scrape failed' });
  }
});

app.get('/api/admin/scrape/x-profile', requireAdmin, scrapeLimiter, async (req, res) => {
  const username = req.query?.username || req.query?.handle || req.query?.url;
  if (!username) {
    return res.status(400).json({
      error: 'username query required',
      publicRead: 'locked — admin X-Admin-Token required',
    });
  }
  try {
    const result = await scrapeXProfile(username);
    if (!result.ok) {
      return res.status(result.status || 502).json({
        error: result.error,
        publicRead: 'locked — admin X-Admin-Token required',
      });
    }
    const { ok, ...payload } = result;
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'X profile scrape failed' });
  }
});

// Web page scraping
app.post('/api/admin/scrape/web', requireAdmin, scrapeLimiter, async (req, res) => {
  const url = req.body?.url;
  if (!url) {
    return res.status(400).json({
      error: 'url required (https preferred)',
      publicRead: 'locked — admin X-Admin-Token required',
      robotsTxt: 'not enforced in v1',
    });
  }
  try {
    const result = await scrapeWebPage(url);
    if (!result.ok) {
      return res.status(result.status || 502).json({
        error: result.error,
        publicRead: 'locked — admin X-Admin-Token required',
        robotsTxt: 'not enforced in v1',
      });
    }
    const { ok, ...payload } = result;
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Web scrape failed' });
  }
});

app.use(express.static(publicDir));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/prizes', (_req, res) => {
  res.sendFile(path.join(publicDir, 'prizes.html'));
});

app.get('/giveaway', (_req, res) => {
  res.sendFile(path.join(publicDir, 'giveaway.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

try {
  ensureStagingLedgerPrize();
} catch (err) {
  console.error('[redeem] failed to ensure staging ledger prize:', err.message);
}
try {
  ensurePrizeCatalog();
} catch (err) {
  console.error('[prizes] failed to ensure prize catalog:', err.message);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Prize Wheel listening on http://127.0.0.1:${PORT}`);
});
