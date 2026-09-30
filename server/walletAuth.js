'use strict';

/**
 * Public wallet auth for GOML site mode:
 *  1) Xaman SignIn (when XAMAN_API_KEY/SECRET set — same keys as GOML)
 *  2) XRPL challenge-sign (Crossmark / GemWallet) via ripple-keypairs
 *
 * Admin role is NOT decided by a separate allowlist here: if the wallet
 * already holds a GOML admin/owner JWT (SESSION_SECRET), prize-wheel
 * requireAdmin accepts it. Fresh Xaman/challenge logins get role "member"
 * unless OWNER_WALLET_ADDRESS matches (owner convenience).
 */

const crypto = require('crypto');
const keypairs = require('ripple-keypairs');
const {
  XAMAN_API_KEY,
  XAMAN_API_SECRET,
  OWNER_WALLET_ADDRESS,
} = require('./config');
const {
  issueMemberToken,
  issueAdminCompatibleToken,
  memberCookieHeader,
  isAdminRole,
} = require('./auth');

const XAMAN_BASE = 'https://xumm.app/api/v1/platform';
const XRPL_ADDR_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,33}$/;

/** @type {Map<string, { sessionToken: string, expiresAt: number, redeemed: boolean }>} */
const pendingXaman = new Map();
/** @type {Map<string, { nonce: string, expiresAt: number, used: boolean }>} */
const pendingNonces = new Map();

const PAYLOAD_TTL_MS = 12 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingXaman) if (now > v.expiresAt) pendingXaman.delete(k);
  for (const [k, v] of pendingNonces) if (now > v.expiresAt) pendingNonces.delete(k);
}, 60 * 1000).unref();

function xamanConfigured() {
  return Boolean(XAMAN_API_KEY && XAMAN_API_SECRET);
}

function xamanHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': XAMAN_API_KEY,
    'X-API-Secret': XAMAN_API_SECRET,
  };
}

function roleForWallet(wallet) {
  if (OWNER_WALLET_ADDRESS && wallet === OWNER_WALLET_ADDRESS) return 'owner';
  return 'member';
}

function tokenForWallet(wallet) {
  const role = roleForWallet(wallet);
  if (isAdminRole(role)) return issueAdminCompatibleToken(wallet, role);
  return issueMemberToken(wallet);
}

function setAuthCookies(res, token) {
  res.setHeader('Set-Cookie', memberCookieHeader(token));
}

async function createXamanPayload(req, res) {
  if (!xamanConfigured()) {
    return res.status(503).json({ error: 'Xaman not configured' });
  }
  try {
    const response = await fetch(`${XAMAN_BASE}/payload`, {
      method: 'POST',
      headers: xamanHeaders(),
      body: JSON.stringify({
        txjson: { TransactionType: 'SignIn' },
        options: { expire: 10 },
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error('Xaman payload failed', response.status, body.slice(0, 200));
      return res.status(502).json({ error: 'Failed to create Xaman payload' });
    }
    const data = await response.json();
    const uuid = data.uuid;
    if (!uuid) return res.status(502).json({ error: 'No UUID from Xaman' });

    const sessionToken = crypto.randomBytes(32).toString('hex');
    pendingXaman.set(uuid, {
      sessionToken,
      expiresAt: Date.now() + PAYLOAD_TTL_MS,
      redeemed: false,
    });

    return res.json({
      uuid,
      sessionToken,
      qrUrl: data.refs?.qr_png ?? null,
      deepLink: data.next?.always ?? null,
    });
  } catch (err) {
    console.error('Xaman payload error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function pollXamanPayload(req, res) {
  const { uuid } = req.params;
  if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) {
    return res.status(400).json({ error: 'Invalid uuid' });
  }
  if (!xamanConfigured()) {
    return res.status(503).json({ error: 'Xaman not configured' });
  }

  const rawSession = req.headers['x-xaman-session'];
  const provided = Array.isArray(rawSession) ? rawSession[0] : rawSession;
  const pending = pendingXaman.get(uuid);
  if (!pending || !provided || pending.sessionToken !== provided) {
    return res.status(403).json({ error: 'Invalid or missing session token' });
  }
  if (pending.redeemed) {
    return res.status(403).json({ error: 'Payload already redeemed' });
  }
  if (Date.now() > pending.expiresAt) {
    pendingXaman.delete(uuid);
    return res.json({ status: 'expired' });
  }

  try {
    const response = await fetch(`${XAMAN_BASE}/payload/${uuid}`, {
      headers: {
        'X-API-Key': XAMAN_API_KEY,
        'X-API-Secret': XAMAN_API_SECRET,
      },
    });
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to check payload' });
    }
    const data = await response.json();
    const meta = data.meta || {};
    if (meta.expired || meta.cancelled) {
      pendingXaman.delete(uuid);
      return res.json({ status: 'expired' });
    }
    if (!meta.signed) {
      return res.json({ status: 'pending' });
    }
    const wallet = data.response?.account || '';
    if (!wallet || !XRPL_ADDR_RE.test(wallet)) {
      return res.json({ status: 'pending' });
    }

    pending.redeemed = true;
    pendingXaman.delete(uuid);

    const role = roleForWallet(wallet);
    const token = tokenForWallet(wallet);
    setAuthCookies(res, token);
    return res.json({ status: 'signed', wallet, role, token });
  } catch (err) {
    console.error('Xaman poll error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function createChallenge(_req, res) {
  const nonce = crypto.randomBytes(32).toString('hex');
  const id = crypto.randomUUID();
  pendingNonces.set(id, { nonce, expiresAt: Date.now() + NONCE_TTL_MS, used: false });
  return res.json({ challengeId: id, nonce });
}

function verifyChallenge(req, res) {
  const { challengeId, walletAddress, signature, publicKey } = req.body || {};
  if (
    typeof challengeId !== 'string' ||
    typeof walletAddress !== 'string' ||
    !XRPL_ADDR_RE.test(walletAddress) ||
    typeof signature !== 'string' ||
    typeof publicKey !== 'string'
  ) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const pending = pendingNonces.get(challengeId);
  if (!pending) return res.status(400).json({ error: 'Challenge not found or expired' });
  if (pending.used) return res.status(400).json({ error: 'Challenge already used' });
  if (Date.now() > pending.expiresAt) {
    pendingNonces.delete(challengeId);
    return res.status(400).json({ error: 'Challenge expired' });
  }

  let sigValid = false;
  try {
    sigValid = keypairs.verify(pending.nonce, signature, publicKey);
  } catch {
    return res.status(400).json({ error: 'Invalid signature format' });
  }
  if (!sigValid) return res.status(401).json({ error: 'Signature verification failed' });

  let derived;
  try {
    derived = keypairs.deriveAddress(publicKey);
  } catch {
    return res.status(400).json({ error: 'Could not derive address from public key' });
  }
  if (derived !== walletAddress) {
    return res.status(401).json({ error: 'Public key does not match wallet address' });
  }

  pending.used = true;
  pendingNonces.delete(challengeId);

  const role = roleForWallet(walletAddress);
  const token = tokenForWallet(walletAddress);
  setAuthCookies(res, token);
  return res.json({ token, wallet: walletAddress, role });
}

function verifySession(req, res) {
  const { getWalletSession } = require('./auth');
  const session = getWalletSession(req);
  if (!session) return res.status(401).json({ valid: false });
  return res.json({ valid: true, wallet: session.wallet, role: session.role });
}

function logout(_req, res) {
  res.setHeader('Set-Cookie', memberCookieHeader('', { clear: true }));
  return res.json({ ok: true });
}

function mount(app) {
  app.post('/api/auth/xaman/payload', createXamanPayload);
  app.get('/api/auth/xaman/payload/:uuid', pollXamanPayload);
  app.get('/api/auth/xaman/verify', verifySession);
  app.post('/api/auth/xrpl/challenge', createChallenge);
  app.post('/api/auth/xrpl/verify', verifyChallenge);
  app.get('/api/auth/me', verifySession);
  app.post('/api/auth/logout', logout);
}

module.exports = {
  mount,
  xamanConfigured,
  XRPL_ADDR_RE,
};
