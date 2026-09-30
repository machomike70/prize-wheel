'use strict';

/**
 * Detect checkout discounts from prize labels (and optional tagged forms).
 *
 * Conventions Micheal can use in the prize list:
 *   - "10% Off" / "15% off"     → percent off merchandise subtotal
 *   - "$5 Off" / "$5.00 Off"    → fixed USD off merchandise
 *   - "Free Shipping"           → shipping waived
 *   - "discount:percent:10"     → explicit percent
 *   - "discount:fixed:5"        → explicit fixed USD
 *   - "discount:shipping"       → free shipping
 *
 * Non-discount prizes (Mystery Gift, Try Again, VIP Drop, …) return null.
 */

function parseDiscount(label) {
  const raw = String(label || '').trim();
  if (!raw) return null;

  const tagged = raw.match(/^discount\s*:\s*(percent|fixed|shipping)\s*(?::\s*([\d.]+))?\s*$/i);
  if (tagged) {
    const kind = tagged[1].toLowerCase();
    if (kind === 'shipping') {
      return { type: 'free_shipping', value: 100, label: raw };
    }
    const n = Number(tagged[2]);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (kind === 'percent') {
      if (n > 100) return null;
      return { type: 'percent', value: Math.round(n), label: raw };
    }
    return {
      type: 'fixed_cents',
      value: Math.round(n * 100),
      label: raw,
    };
  }

  if (/free\s*shipping/i.test(raw)) {
    return { type: 'free_shipping', value: 100, label: raw };
  }

  const pct = raw.match(/(\d+(?:\.\d+)?)\s*%\s*(?:off)?/i);
  if (pct) {
    const n = Number(pct[1]);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
    return { type: 'percent', value: Math.round(n), label: raw };
  }

  const usd = raw.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*(?:off)?/i);
  if (usd) {
    const n = Number(usd[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { type: 'fixed_cents', value: Math.round(n * 100), label: raw };
  }

  return null;
}

module.exports = { parseDiscount };
