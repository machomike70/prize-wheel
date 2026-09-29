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

app.use(express.static(publicDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Prize Wheel listening on http://127.0.0.1:${PORT}`);
});
