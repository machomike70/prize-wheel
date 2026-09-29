'use strict';

/**
 * Resolve site mode: shop | goml | open (demo / free spins).
 * Query ?site= wins; else Host heuristics.
 */
function resolveSite(req) {
  const q = (req.query && req.query.site) || (req.body && req.body.site);
  if (q === 'shop' || q === 'goml') return q;

  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (host.startsWith('shop.') || host.includes('shop.bwtz')) return 'shop';
  if (host.startsWith('goml.') || host.includes('goml.')) return 'goml';
  return 'open';
}

module.exports = { resolveSite };
