'use strict';

/**
 * STAGING-ONLY testnet prize sender for ledger redeem claims.
 *
 * Gates (ALL must pass or nothing is sent):
 *  - STAGING_SENDS_ENABLED=true in staging .env
 *  - XRPL_NETWORK=testnet
 *  - seed loaded from systemd credential (LoadCredential=hot_wallet_seed:/path/to/staging-hot-wallet-seed)
 *  - derived address === STAGING_HOT_WALLET_ADDRESS
 *  - connected server reports network_id === 1 (XRPL Testnet) before every send
 * Endpoint is hard-pinned to testnet; there is NO mainnet code path here.
 * The seed is never logged, returned, or written anywhere.
 */
const fs = require('fs');
const path = require('path');
const xrpl = require('xrpl');

const TESTNET_URL = 'wss://s.altnet.rippletest.net:51233';
const TESTNET_NETWORK_ID = 1;
const MAX_PAYOUT_XRP = 25;
const CRED_NAME = 'hot_wallet_seed';

let wallet = null;
let walletState = 'not_loaded';
let client = null;

function envFlag() {
  return String(process.env.STAGING_SENDS_ENABLED || '').trim().toLowerCase() === 'true';
}

function networkOk() {
  return String(process.env.XRPL_NETWORK || '').trim().toLowerCase() === 'testnet';
}

function expectedAddress() {
  return String(process.env.STAGING_HOT_WALLET_ADDRESS || '').trim();
}

function payoutXrp() {
  const n = Number(String(process.env.STAGING_PAYOUT_XRP || '1').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > MAX_PAYOUT_XRP) return null;
  return n;
}

function loadWallet() {
  if (wallet || walletState === 'mismatch' || walletState === 'invalid') return;
  const dir = process.env.CREDENTIALS_DIRECTORY;
  if (!dir) { walletState = 'no_credential'; return; }
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, CRED_NAME), 'utf8').trim();
  } catch {
    walletState = 'no_credential';
    return;
  }
  try {
    const w = xrpl.Wallet.fromSeed(raw);
    raw = null;
    if (!expectedAddress() || w.address !== expectedAddress()) {
      walletState = 'mismatch';
      return;
    }
    wallet = w;
    walletState = 'loaded';
  } catch {
    walletState = 'invalid';
  }
}

function blockedReason() {
  if (!envFlag()) return 'sends_disabled_until_explicit_enable';
  if (!networkOk()) return 'network_not_testnet';
  if (payoutXrp() == null) return 'payout_amount_invalid';
  loadWallet();
  if (walletState !== 'loaded') return 'hot_wallet_' + walletState;
  return null;
}

function sendsEnabled() {
  return blockedReason() === null;
}

function publicStatus() {
  const reason = blockedReason();
  return {
    network: 'testnet',
    sendsEnabled: reason === null,
    sendBlockedReason: reason,
    payoutXrp: reason === null ? payoutXrp() : undefined,
  };
}

async function getClient() {
  if (client && client.isConnected()) return client;
  client = new xrpl.Client(TESTNET_URL);
  await client.connect();
  return client;
}

/**
 * Send the prize Payment for a claimed redeem record. Caller handles idempotency.
 * @returns {{hash, result, validated, ledgerIndex, amountXrp, from}}
 */
async function sendPrize({ destination, code }) {
  const reason = blockedReason();
  if (reason) {
    const err = new Error('sends blocked: ' + reason);
    err.blocked = true;
    throw err;
  }
  if (!xrpl.isValidClassicAddress(destination)) throw new Error('invalid destination');
  if (destination === wallet.address) throw new Error('destination is hot wallet');
  const c = await getClient();
  const si = await c.request({ command: 'server_info' });
  const nid = si.result && si.result.info && si.result.info.network_id;
  if (nid !== TESTNET_NETWORK_ID) {
    throw new Error('refusing to send: connected network_id is not testnet');
  }
  const amountXrp = payoutXrp();
  const memo = 'prize-wheel-staging redeem ' + String(code || '').slice(0, 40);
  const tx = {
    TransactionType: 'Payment',
    Account: wallet.address,
    Destination: destination,
    Amount: xrpl.xrpToDrops(String(amountXrp)),
    Memos: [{ Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() } }],
  };
  const prepared = await c.autofill(tx);
  const signed = wallet.sign(prepared);
  const res = await c.submitAndWait(signed.tx_blob);
  return {
    hash: res.result.hash,
    result: res.result.meta && res.result.meta.TransactionResult,
    validated: res.result.validated === true,
    ledgerIndex: res.result.ledger_index,
    amountXrp,
    from: wallet.address,
  };
}

module.exports = { sendsEnabled, publicStatus, sendPrize, blockedReason, TESTNET_URL };
