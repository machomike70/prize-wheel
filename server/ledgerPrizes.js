'use strict';

const { getPrizes, update } = require('./store');

/**
 * Staging-only example. ledger=true so a win can issue a redeem code.
 * sendsEnabled is always false: this prize is not enabled for real sends.
 */
const STAGING_LEDGER_EXAMPLE = {
  label: 'STAGING ONLY example ledger prize (sends disabled)',
  ledger: true,
  sendsEnabled: false,
  note: 'Staging example only. Not enabled for real on-ledger sends.',
};

const OFF_LEDGER_PATTERNS = [
  /extra\s*5\s*%/i,
  /extra\s*10\s*%/i,
  /\b10\s*%\s*off\b/i,
  /free\s*us\s*shipping/i,
  /free\s*shipping/i,
  /first[- ]edition\s*tee/i,
  /winner\s*pays\s*shipping/i,
  /try again/i,
];

function prizeLabel(entry) {
  if (entry && typeof entry === 'object') return String(entry.label || '').trim();
  return String(entry || '').trim();
}

function isOffLedgerLabel(label) {
  const text = String(label || '').trim();
  if (!text) return true;
  return OFF_LEDGER_PATTERNS.some((re) => re.test(text));
}

function isLedgerDeliverable(label) {
  const text = String(label || '').trim();
  if (!text || isOffLedgerLabel(text)) return false;
  if (text === STAGING_LEDGER_EXAMPLE.label) return true;
  return getPrizes().some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return prizeLabel(entry) === text && entry.ledger === true;
  });
}

function ensureStagingLedgerPrize() {
  update((store) => {
    if (!Array.isArray(store.prizes)) store.prizes = [];
    store.prizes = store.prizes.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const next = { ...entry, sendsEnabled: false };
      if (isOffLedgerLabel(prizeLabel(next))) next.ledger = false;
      return next;
    });
    const has = store.prizes.some((entry) => prizeLabel(entry) === STAGING_LEDGER_EXAMPLE.label);
    if (!has) store.prizes.push({ ...STAGING_LEDGER_EXAMPLE });
    if (!Array.isArray(store.redeems)) store.redeems = [];
  });
}

module.exports = {
  STAGING_LEDGER_EXAMPLE,
  prizeLabel,
  isOffLedgerLabel,
  isLedgerDeliverable,
  ensureStagingLedgerPrize,
};
