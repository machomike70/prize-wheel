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

app.post('/api/spin', spinLimiter, (req, res) => {
  const norm = normalizeRequest(req.body);
  if (!norm.ok) {
    return res.status(norm.status).json({ error: norm.error });
  }
  const out = createSpin(norm.mode, norm.items);
  return res.json(out);
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
  
  return {
    status: 'pending',
    message: 'NFT release queued for hot wallet processing',
    spinId: codeRecord.spinId,
    winner: codeRecord.winner,
  };
}

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

app.use(express.static(publicDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Prize Wheel listening on http://127.0.0.1:${PORT}`);
});
