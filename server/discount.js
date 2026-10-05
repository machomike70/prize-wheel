'use strict';

/**
 * Checkout discount helpers shared by the prize catalog, tickets and the shop.
 *
 * Output shape mirrors bear-witness-shop app/services.py parse_prize_discount /
 * apply_prize_discount so GET /api/tickets/lookup can be consumed unchanged:
 *   { type: 'percent',       value: <1-100>,  label }
 *   { type: 'fixed_cents',   value: <cents>,  label }
 *   { type: 'free_shipping', value: 100,      label }
 *   { type: 'free_item',     value: 0, sku,   label }   (merch item added free; shop records it)
 *
 * Label conventions (used to infer a type when none is configured):
 *   "10% Off" / "15% off" → percent · "$5 Off" → fixed · "Free Shipping" → shipping
 *   "discount:percent:10" / "discount:fixed:5" / "discount:shipping" → explicit
 */

function parseDiscount(label) {
  const raw = String(label || '').trim();
  if (!raw) return null;

  const tagged = raw.match(/^discount\s*:\s*(percent|fixed|shipping)\s*(?::\s*([\d.]+))?\s*$/i);
  if (tagged) {
    const kind = tagged[1].toLowerCase();
    if (kind === 'shipping') return { type: 'free_shipping', value: 100, label: raw };
    const n = Number(tagged[2]);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (kind === 'percent') {
      if (n > 100) return null;
      return { type: 'percent', value: Math.round(n), label: raw };
    }
    return { type: 'fixed_cents', value: Math.round(n * 100), label: raw };
  }

  if (/free\s*shipping/i.test(raw)) return { type: 'free_shipping', value: 100, label: raw };

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

/**
 * Same math as the shop: percent/fixed apply to merch subtotal only; free shipping zeroes shipping.
 * free_item has no cash effect here (the item is added to the order at fulfilment).
 */
function applyDiscount(discount, subtotalCents, shippingCents) {
  const sub = Math.max(0, Math.round(Number(subtotalCents) || 0));
  const ship = Math.max(0, Math.round(Number(shippingCents) || 0));
  const out = { subtotalCents: sub, shippingCents: ship, discountCents: 0 };
  if (!discount) return out;
  if (discount.type === 'percent') {
    const off = Math.max(0, Math.min(Math.round((sub * Number(discount.value)) / 100), sub));
    return { subtotalCents: sub - off, shippingCents: ship, discountCents: off };
  }
  if (discount.type === 'fixed_cents') {
    const off = Math.max(0, Math.min(Number(discount.value), sub));
    return { subtotalCents: sub - off, shippingCents: ship, discountCents: off };
  }
  if (discount.type === 'free_shipping') {
    return { subtotalCents: sub, shippingCents: 0, discountCents: ship };
  }
  return out;
}

module.exports = { parseDiscount, applyDiscount };
