'use strict';

const crypto = require('crypto');
const { isValidClassicAddress } = require('xrpl');
const { update } = require('./store');
const { isLedgerDeliverable } = require('./ledgerPrizes');

function newCode() {
  return 'STG-' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

function issueRedeemCode({ prizeLabel, spinNonce }) {
  const label = String(prizeLabel || '').trim();
  if (!isLedgerDeliverable(label)) {
    const err = new Error('Prize is not an on-ledger delivery');
    err.status = 400;
    throw err;
  }
  const record = {
    code: newCode(),
    prizeLabel: label,
    winnerAddress: null,
    status: 'issued',
    createdAt: new Date().toISOString(),
    claimedAt: null,
    spinNonce: spinNonce || null,
    sent: false,
  };
  update((store) => {
    if (!Array.isArray(store.redeems)) store.redeems = [];
    store.redeems.push(record);
  });
  return record;
}

function attachLedgerRedeem(result) {
  if (!result || result.mode !== 'prizes' || !isLedgerDeliverable(result.label)) {
    return { redeemCode: null, ledgerDelivery: false, redeem: null };
  }
  const rec = issueRedeemCode({ prizeLabel: result.label, spinNonce: result.nonce });
  return {
    redeemCode: rec.code,
    ledgerDelivery: true,
    redeem: {
      prizeLabel: rec.prizeLabel,
      winnerAddress: null,
      status: rec.status,
      createdAt: rec.createdAt,
      sent: false,
    },
  };
}

/**
 * One code, one claim. Never submits a transaction.
 * A valid claim stays claimed_pending until a later explicit send enable.
 */
function claimRedeemCode({ code, address }) {
  const normalized = String(code || '').trim();
  const addr = String(address || '').trim();
  if (!normalized) {
    return { ok: false, status: 400, error: 'Missing code' };
  }
  if (!isValidClassicAddress(addr)) {
    return { ok: false, status: 400, error: 'Invalid XRPL classic address' };
  }

  let outcome = null;
  update((store) => {
    if (!Array.isArray(store.redeems)) store.redeems = [];
    const rec = store.redeems.find((row) => row && row.code === normalized);
    if (!rec) {
      outcome = { ok: false, status: 400, error: 'Invalid or unknown code' };
      return;
    }
    if (rec.status !== 'issued') {
      outcome = { ok: false, status: 409, error: 'Code already used' };
      return;
    }
    rec.winnerAddress = addr;
    rec.status = 'claimed_pending';
    rec.claimedAt = new Date().toISOString();
    rec.sent = false;
    outcome = {
      ok: true,
      status: 200,
      record: {
        prizeLabel: rec.prizeLabel,
        winnerAddress: rec.winnerAddress,
        status: rec.status,
        createdAt: rec.createdAt,
        claimedAt: rec.claimedAt,
        sent: false,
      },
    };
  });
  return outcome;
}

/**
 * STAGING send helpers. Atomic claimed_pending -> sending transition guarantees
 * at most one send attempt per code (no automatic retry on failure).
 */
function beginSend(code) {
  const normalized = String(code || '').trim();
  let rec = null;
  update((store) => {
    const row = (store.redeems || []).find((r) => r && r.code === normalized);
    if (!row || row.status !== 'claimed_pending' || row.sent === true || row.txHash) return;
    row.status = 'sending';
    row.sendStartedAt = new Date().toISOString();
    rec = { ...row };
  });
  return rec;
}

function finishSend(code, { ok, tx, error }) {
  const normalized = String(code || '').trim();
  let rec = null;
  update((store) => {
    const row = (store.redeems || []).find((r) => r && r.code === normalized);
    if (!row) return;
    if (ok) {
      row.status = 'sent';
      row.sent = true;
      row.txHash = tx.hash;
      row.txResult = tx.result;
      row.txValidated = tx.validated;
      row.txLedgerIndex = tx.ledgerIndex;
      row.amountXrp = tx.amountXrp;
      row.network = 'testnet';
      row.sentAt = new Date().toISOString();
    } else {
      row.status = 'send_failed';
      row.sent = false;
      row.sendError = String(error || 'send failed').slice(0, 300);
      if (tx && tx.hash) row.txHash = tx.hash;
    }
    rec = { ...row };
  });
  return rec;
}

function publicRedeemView(row) {
  if (!row) return null;
  return {
    prizeLabel: row.prizeLabel,
    status: row.status,
    sent: row.sent === true,
    winnerAddress: row.winnerAddress || null,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt || null,
    sentAt: row.sentAt || null,
    txHash: row.txHash || null,
    txResult: row.txResult || null,
    txValidated: row.txValidated === true,
    amountXrp: row.amountXrp || null,
    network: row.network || 'testnet',
    sendError: row.sendError || null,
  };
}

function getRedeem(code) {
  const normalized = String(code || '').trim();
  const { load } = require('./store');
  const row = (load().redeems || []).find((r) => r && r.code === normalized);
  return row ? publicRedeemView(row) : null;
}

function listRedeems() {
  const { load } = require('./store');
  return (load().redeems || []).map((r) => ({ code: r.code, ...publicRedeemView(r) }));
}

module.exports = {
  issueRedeemCode,
  attachLedgerRedeem,
  claimRedeemCode,
  beginSend,
  finishSend,
  getRedeem,
  listRedeems,
};
