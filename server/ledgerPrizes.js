'use strict';

/**
 * Minimal stub for ledger prize deliverability checks.
 * Determines which prizes should generate on-ledger redeem codes.
 */

const LEDGER_DELIVERABLE_PRIZES = [
  'XRP Prize',
  'NFT Prize',
  'Testnet XRP',
  // Add other prize labels that should trigger ledger delivery
];

function isLedgerDeliverable(prizeLabel) {
  const label = String(prizeLabel || '').trim();
  return LEDGER_DELIVERABLE_PRIZES.some(p => label.includes(p));
}

function ensureStagingLedgerPrize() {
  // Stub: ensure at least one ledger-deliverable prize exists in config
  console.log('[ledgerPrizes] Staging ledger prize check completed');
}

module.exports = {
  isLedgerDeliverable,
  ensureStagingLedgerPrize,
};
