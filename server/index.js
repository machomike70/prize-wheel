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
} = require('./store');
const {
  createPayoutCode,
  validateAndBurn,
  checkCodeStatus,
} = require('./payout');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

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
  
  const payoutCodes = getPayoutCodes();
  const result = validateAndBurn({ inputCode: code, payoutCodes });
  
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }
  
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

app.use(express.static(publicDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Prize Wheel listening on http://127.0.0.1:${PORT}`);
});
