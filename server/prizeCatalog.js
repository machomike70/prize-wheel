'use strict';

/**
 * Prize catalog: the configurable list of wheel prizes ("prize codes").
 *
 * Stored in data/store.json → "prizes" (array of objects). Edit via the admin UI
 * (/wheel-staging/prizes.html) or the admin API (/api/admin/prizes). Each prize:
 *   { id, label, type, value?, sku?, note?, enabled, ledger, sendsEnabled:false }
 *
 * Types:
 *   percent        value = percent off merch subtotal (1-100)          → shop discount
 *   fixed          value = USD off merch subtotal (e.g. 5 = $5.00)      → shop discount
 *   free_shipping  shipping waived                                      → shop discount
 *   free_item      free merch item; sku optional (e.g. first-edition-tee) → shop/manual fulfil
 *   xrp            on-ledger XRP prize (staging: TESTNET Payment via STG-… redeem code)
 *   token|nft|mystery|manual  prize fulfilled by hand (admin redeems the code when delivered)
 *   none           "Try Again" — no code issued
 */
const crypto = require('crypto');
const { update, load } = require('./store');
const { parseDiscount } = require('./discount');

const TYPES = {
  percent: { label: 'Percent off', needsValue: true, couponable: true },
  fixed: { label: 'Fixed USD off', needsValue: true, couponable: true },
  free_shipping: { label: 'Free shipping', needsValue: false, couponable: true },
  free_item: { label: 'Free item (e.g. T-shirt)', needsValue: false, couponable: true },
  xrp: { label: 'XRP on-ledger (staging: testnet)', needsValue: false, couponable: false },
  token: { label: 'Token prize (manual)', needsValue: false, couponable: true },
  nft: { label: 'NFT prize (manual)', needsValue: false, couponable: true },
  mystery: { label: 'Mystery gift (manual)', needsValue: false, couponable: true },
  manual: { label: 'Other (manual fulfilment)', needsValue: false, couponable: true },
  none: { label: 'No prize (Try Again)', needsValue: false, couponable: false },
};

const CATALOG_VERSION = 1;

/** Seed list (mirrors the live wheel + required purchase codes). Applied once per store. */
const SEED_PRIZES = [
  { label: '5% Off', type: 'percent', value: 5 },
  { label: '10% Off', type: 'percent', value: 10 },
  { label: 'Free Shipping', type: 'free_shipping' },
  { label: 'Free 1st Edition T-Shirt', type: 'free_item', sku: 'first-edition-tee' },
  { label: 'Mystery Gift', type: 'mystery' },
  { label: '1000 BWTZ Tokens', type: 'token', value: 1000 },
  { label: 'Liquid Apes', type: 'nft' },
  { label: 'VIP Drop', type: 'manual' },
  { label: 'Try Again', type: 'none' },
];

function slugify(label) {
  const s = String(label || '')
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'prize';
}

function inferType(label, entry) {
  if (entry && entry.ledger === true) return { type: 'xrp' };
  const text = String(label || '');
  if (/try\s*again/i.test(text)) return { type: 'none' };
  if (/(t[\s-]*shirt|\btee\b)/i.test(text)) return { type: 'free_item', sku: 'first-edition-tee' };
  const d = parseDiscount(text);
  if (d && d.type === 'percent') return { type: 'percent', value: d.value };
  if (d && d.type === 'fixed_cents') return { type: 'fixed', value: d.value / 100 };
  if (d && d.type === 'free_shipping') return { type: 'free_shipping' };
  if (/mystery/i.test(text)) return { type: 'mystery' };
  if (/token|bwtz/i.test(text)) return { type: 'token' };
  if (/nft|apes?\b/i.test(text)) return { type: 'nft' };
  return { type: 'manual' };
}

/** Validate + normalize admin input. Returns { ok, prize } or { ok:false, error }. */
function validatePrizeInput(input, { partial = false, existing = null } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const base = existing ? { ...existing } : {};
  const out = { ...base };

  if (!partial || src.label !== undefined) {
    const label = String(src.label ?? '').trim().replace(/\s+/g, ' ');
    if (!label) return { ok: false, error: 'label is required' };
    if (label.length > 80) return { ok: false, error: 'label too long (max 80 chars)' };
    out.label = label;
  }
  if (!partial || src.type !== undefined) {
    const type = String(src.type ?? '').trim().toLowerCase() || inferType(out.label).type;
    if (!TYPES[type]) return { ok: false, error: 'type must be one of: ' + Object.keys(TYPES).join(', ') };
    out.type = type;
  }
  if (src.value !== undefined || !partial) {
    if (src.value === null || src.value === '' || src.value === undefined) {
      delete out.value;
    } else {
      const n = Number(src.value);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'value must be a positive number' };
      out.value = n;
    }
  }
  if (out.type === 'percent') {
    if (!Number.isFinite(out.value) || out.value <= 0 || out.value > 100) {
      return { ok: false, error: 'percent prizes need value between 1 and 100' };
    }
    out.value = Math.round(out.value);
  }
  if (out.type === 'fixed') {
    if (!Number.isFinite(out.value) || out.value <= 0 || out.value > 10000) {
      return { ok: false, error: 'fixed prizes need a USD value between 0.01 and 10000' };
    }
    out.value = Math.round(out.value * 100) / 100;
  }
  if (src.sku !== undefined) {
    const sku = String(src.sku || '').trim().slice(0, 60);
    if (sku) out.sku = sku; else delete out.sku;
  }
  if (src.note !== undefined) {
    const note = String(src.note || '').trim().slice(0, 200);
    if (note) out.note = note; else delete out.note;
  }
  if (src.enabled !== undefined) out.enabled = src.enabled === true || src.enabled === 'true';
  if (out.enabled === undefined) out.enabled = true;
  out.ledger = out.type === 'xrp';
  out.sendsEnabled = false; // per-prize flag stays false; sends gated globally by stagingSender
  return { ok: true, prize: out };
}

/** Normalize one stored entry (string or object) into a full prize object. */
function normalizeEntry(entry) {
  if (typeof entry === 'string') {
    const label = entry.trim();
    if (!label) return null;
    const inferred = inferType(label);
    const v = validatePrizeInput({ label, ...inferred, enabled: true });
    return v.ok ? v.prize : { label, type: 'manual', enabled: true, ledger: false, sendsEnabled: false };
  }
  if (entry && typeof entry === 'object') {
    const label = String(entry.label || '').trim();
    if (!label) return null;
    const type = TYPES[entry.type] ? entry.type : inferType(label, entry).type;
    const inferred = TYPES[entry.type] ? {} : inferType(label, entry);
    const v = validatePrizeInput({
      ...inferred,
      ...entry,
      type,
      value: entry.value !== undefined ? entry.value : inferred.value,
      sku: entry.sku !== undefined ? entry.sku : inferred.sku,
      enabled: entry.enabled === undefined ? true : entry.enabled,
    });
    const p = v.ok ? v.prize : { label, type: 'manual', enabled: entry.enabled !== false, ledger: false, sendsEnabled: false };
    if (entry.id) p.id = String(entry.id);
    return p;
  }
  return null;
}

function uniqueId(prizes, label) {
  const taken = new Set(prizes.map((p) => p && p.id).filter(Boolean));
  let id = slugify(label);
  if (!taken.has(id)) return id;
  for (let i = 2; i < 1000; i++) {
    if (!taken.has(id + '-' + i)) return id + '-' + i;
  }
  return id + '-' + crypto.randomBytes(3).toString('hex');
}

/**
 * Startup migration: string → object prizes, assign ids, and (once, version-gated)
 * add the seed list so 5%/10%/free shipping/free tee exist. Admin deletions stick
 * because the seed only runs when prizeCatalogVersion < CATALOG_VERSION.
 */
function ensurePrizeCatalog() {
  update((store) => {
    const list = Array.isArray(store.prizes) ? store.prizes : [];
    const out = [];
    for (const entry of list) {
      const p = normalizeEntry(entry);
      if (!p) continue;
      if (out.some((q) => q.label.toLowerCase() === p.label.toLowerCase())) continue;
      if (!p.id) p.id = uniqueId(out, p.label);
      out.push(p);
    }
    if ((Number(store.prizeCatalogVersion) || 0) < CATALOG_VERSION) {
      for (const seed of SEED_PRIZES) {
        const lower = seed.label.toLowerCase();
        // Map legacy spellings (e.g. "10% OFF", "TRY AGAIN") instead of duplicating.
        const existing = out.find((q) => q.label.toLowerCase().replace(/\s+/g, ' ') === lower);
        if (existing) {
          Object.assign(existing, validatePrizeInput({ ...seed, enabled: existing.enabled }).prize, { id: existing.id });
          continue;
        }
        const v = validatePrizeInput({ ...seed, enabled: true });
        if (v.ok) out.push({ ...v.prize, id: uniqueId(out, seed.label) });
      }
      // Keep "Try Again" last on the wheel, ledger example after it.
      out.sort((a, b) => rank(a) - rank(b));
      store.prizeCatalogVersion = CATALOG_VERSION;
    }
    store.prizes = out;
  });
}

function rank(p) {
  if (p.type === 'xrp') return 3000;
  if (p.type === 'none') return 2000;
  const i = SEED_PRIZES.findIndex((s) => s.label.toLowerCase() === String(p.label).toLowerCase());
  return i === -1 ? 1000 : i;
}

function listPrizes({ includeDisabled = true } = {}) {
  const prizes = (load().prizes || []).map((p) => normalizeEntry(p)).filter(Boolean);
  // normalizeEntry drops nothing important; ids preserved via entry.id
  return includeDisabled ? prizes : prizes.filter((p) => p.enabled !== false);
}

/** Prizes that appear on the public / ticket wheel (enabled, non-ledger-example duplicates allowed). */
function wheelPrizes() {
  return listPrizes({ includeDisabled: false });
}

function findPrize({ id, label } = {}) {
  const all = listPrizes();
  if (id) {
    const byId = all.find((p) => p.id === String(id));
    if (byId) return byId;
  }
  if (label) {
    const l = String(label).trim().toLowerCase();
    return all.find((p) => p.label.toLowerCase() === l) || null;
  }
  return null;
}

function addPrize(input) {
  const v = validatePrizeInput(input);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  let outcome;
  update((store) => {
    const prizes = Array.isArray(store.prizes) ? store.prizes : [];
    if (prizes.some((p) => String((p && p.label) || p).toLowerCase() === v.prize.label.toLowerCase())) {
      outcome = { ok: false, status: 409, error: 'A prize with that label already exists' };
      return;
    }
    if (prizes.length >= 100) {
      outcome = { ok: false, status: 400, error: 'Too many prizes (max 100)' };
      return;
    }
    const prize = { ...v.prize, id: uniqueId(prizes, v.prize.label), createdAt: new Date().toISOString() };
    // Insert before Try Again / ledger entries so new prizes land in the main ring.
    const idx = prizes.findIndex((p) => p && typeof p === 'object' && (p.type === 'none' || p.type === 'xrp'));
    if (idx === -1) prizes.push(prize); else prizes.splice(idx, 0, prize);
    store.prizes = prizes;
    outcome = { ok: true, prize };
  });
  return outcome;
}

function updatePrize(id, input) {
  let outcome;
  update((store) => {
    const prizes = Array.isArray(store.prizes) ? store.prizes : [];
    const i = prizes.findIndex((p) => p && p.id === String(id));
    if (i === -1) { outcome = { ok: false, status: 404, error: 'Unknown prize id' }; return; }
    const v = validatePrizeInput(input, { partial: true, existing: normalizeEntry(prizes[i]) });
    if (!v.ok) { outcome = { ok: false, status: 400, error: v.error }; return; }
    const dup = prizes.some((p, j) => j !== i && p && String(p.label || '').toLowerCase() === v.prize.label.toLowerCase());
    if (dup) { outcome = { ok: false, status: 409, error: 'A prize with that label already exists' }; return; }
    prizes[i] = { ...v.prize, id: prizes[i].id, updatedAt: new Date().toISOString() };
    outcome = { ok: true, prize: prizes[i] };
  });
  return outcome;
}

function deletePrize(id, { protectLabel } = {}) {
  let outcome;
  update((store) => {
    const prizes = Array.isArray(store.prizes) ? store.prizes : [];
    const i = prizes.findIndex((p) => p && p.id === String(id));
    if (i === -1) { outcome = { ok: false, status: 404, error: 'Unknown prize id' }; return; }
    if (protectLabel && prizes[i].label === protectLabel) {
      outcome = { ok: false, status: 400, error: 'This staging ledger prize is used by the Telegram bridge; disable it instead' };
      return;
    }
    const enabledLeft = prizes.filter((p, j) => j !== i && p && p.enabled !== false).length;
    if (enabledLeft < 2) { outcome = { ok: false, status: 400, error: 'Wheel needs at least 2 enabled prizes' }; return; }
    const [removed] = prizes.splice(i, 1);
    outcome = { ok: true, removed };
  });
  return outcome;
}

/** Checkout discount (shop-compatible) for a prize, or null for non-discount prizes. */
function discountFor(prize) {
  if (!prize) return null;
  switch (prize.type) {
    case 'percent': return { type: 'percent', value: Math.round(prize.value), label: prize.label };
    case 'fixed': return { type: 'fixed_cents', value: Math.round(prize.value * 100), label: prize.label };
    case 'free_shipping': return { type: 'free_shipping', value: 100, label: prize.label };
    case 'free_item': return { type: 'free_item', value: 0, sku: prize.sku || null, label: prize.label };
    default: return null;
  }
}

function fulfillmentFor(prize) {
  if (!prize) return 'none';
  if (['percent', 'fixed', 'free_shipping'].includes(prize.type)) return 'shop_checkout';
  if (prize.type === 'free_item') return 'shop_checkout_or_manual';
  if (prize.type === 'xrp') return 'xrpl_testnet_payment';
  if (prize.type === 'none') return 'none';
  return 'manual';
}

function publicPrize(p) {
  return {
    id: p.id,
    label: p.label,
    type: p.type,
    value: p.value ?? null,
    sku: p.sku || null,
    enabled: p.enabled !== false,
    discount: discountFor(p),
    fulfillment: fulfillmentFor(p),
  };
}

module.exports = {
  TYPES,
  SEED_PRIZES,
  CATALOG_VERSION,
  ensurePrizeCatalog,
  listPrizes,
  wheelPrizes,
  findPrize,
  addPrize,
  updatePrize,
  deletePrize,
  discountFor,
  fulfillmentFor,
  publicPrize,
  inferType,
  validatePrizeInput,
};
