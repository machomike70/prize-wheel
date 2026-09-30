'use strict';

/**
 * Admin auth mirrors GOML Radio (api-server middlewares/adminAuth.ts):
 *   - X-Wallet-Token: JWT signed with SESSION_SECRET, role owner|admin
 *   - X-Admin-Token: raw ADMIN_TOKEN (or optional ADMIN_PASSWORD for shop tooling)
 *
 * Member (public GOML) sessions use prize-wheel–issued JWTs with role "member".
 */

const jwt = require('jsonwebtoken');
const {
  SESSION_SECRET,
  ADMIN_TOKEN,
  ADMIN_PASSWORD,
  SPIN_SECRET,
} = require('./config');

const MEMBER_COOKIE = 'pw_member_session';
const MEMBER_TTL = '7d';

function headerVal(req, name) {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return typeof v === 'string' ? v : undefined;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function jwtSecret() {
  return SESSION_SECRET || SPIN_SECRET;
}

/**
 * @returns {{ wallet?: string, role?: string } | null}
 */
function decodeWalletToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }
}

function isAdminRole(role) {
  return role === 'owner' || role === 'admin';
}

function isValidAdminToken(provided) {
  if (typeof provided !== 'string' || !provided) return false;
  if (ADMIN_TOKEN && provided === ADMIN_TOKEN) return true;
  if (ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 8 && provided === ADMIN_PASSWORD) return true;
  return false;
}

function isValidWalletAdmin(token) {
  const payload = decodeWalletToken(token);
  return Boolean(payload && isAdminRole(payload.role));
}

/**
 * True when request carries GOML admin credentials.
 */
function isAdminRequest(req) {
  const walletToken = headerVal(req, 'x-wallet-token');
  if (isValidWalletAdmin(walletToken)) return true;

  const adminHdr = headerVal(req, 'x-admin-token');
  if (isValidAdminToken(adminHdr)) return true;

  // Bearer ADMIN_TOKEN or password (tooling)
  const auth = headerVal(req, 'authorization');
  if (auth && /^bearer\s+/i.test(auth)) {
    const tok = auth.replace(/^bearer\s+/i, '').trim();
    if (isValidAdminToken(tok) || isValidWalletAdmin(tok)) return true;
  }
  return false;
}

function requireAdmin(req, res, next) {
  if (!SESSION_SECRET && !ADMIN_TOKEN && !ADMIN_PASSWORD) {
    return res.status(503).json({
      error: 'Admin auth not configured (need SESSION_SECRET and/or ADMIN_TOKEN from GOML)',
    });
  }
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  const walletToken = headerVal(req, 'x-wallet-token');
  const payload = decodeWalletToken(walletToken);
  if (payload && isAdminRole(payload.role)) {
    req.adminWallet = payload.wallet;
    req.adminRole = payload.role;
  }
  return next();
}

function issueMemberToken(wallet) {
  return jwt.sign({ wallet, role: 'member' }, jwtSecret(), { expiresIn: MEMBER_TTL });
}

function issueAdminCompatibleToken(wallet, role) {
  return jwt.sign({ wallet, role }, jwtSecret(), { expiresIn: '24h' });
}

/**
 * Resolve signed-in wallet for public GOML spins (member or admin).
 * @returns {{ wallet: string, role: string } | null}
 */
function getWalletSession(req) {
  const hdr = headerVal(req, 'x-wallet-token');
  if (hdr) {
    const p = decodeWalletToken(hdr);
    if (p && p.wallet && (p.role === 'member' || isAdminRole(p.role))) {
      return { wallet: p.wallet, role: p.role };
    }
  }
  const cookies = parseCookies(req);
  if (cookies[MEMBER_COOKIE]) {
    const p = decodeWalletToken(cookies[MEMBER_COOKIE]);
    if (p && p.wallet && (p.role === 'member' || isAdminRole(p.role))) {
      return { wallet: p.wallet, role: p.role };
    }
  }
  const auth = headerVal(req, 'authorization');
  if (auth && /^bearer\s+/i.test(auth)) {
    const p = decodeWalletToken(auth.replace(/^bearer\s+/i, '').trim());
    if (p && p.wallet && (p.role === 'member' || isAdminRole(p.role))) {
      return { wallet: p.wallet, role: p.role };
    }
  }
  return null;
}

function requireWallet(req, res, next) {
  const session = getWalletSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Wallet sign-in required' });
  }
  req.walletSession = session;
  return next();
}

function memberCookieHeader(token, { clear = false } = {}) {
  const secure = process.env.COOKIE_SECURE !== '0';
  const parts = [
    `${MEMBER_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function adminConfigured() {
  return Boolean(SESSION_SECRET || ADMIN_TOKEN || ADMIN_PASSWORD);
}

module.exports = {
  MEMBER_COOKIE,
  decodeWalletToken,
  isAdminRequest,
  requireAdmin,
  requireWallet,
  getWalletSession,
  issueMemberToken,
  issueAdminCompatibleToken,
  isAdminRole,
  isValidAdminToken,
  memberCookieHeader,
  adminConfigured,
  jwtSecret,
  headerVal,
};
