'use strict';

const xrpl = require('xrpl');

/**
 * Server-held XRPL hot wallet for GOML giveaway prizes.
 * 
 * SECURITY:
 * - Seed stored ONLY in server environment variable HOT_WALLET_SEED
 * - Private key NEVER exposed to clients or logged
 * - Wallet address is public and can be shared for deposits
 * 
 * ARCHITECTURE:
 * - Single hot wallet per deployment
 * - Sponsors deposit NFTs/tokens to this wallet
 * - Server tracks inventory via XRPL websocket/polling
 * - Admin assigns items to sponsors/giveaways
 * - Server signs and submits distributions to winners
 */

const HOT_WALLET_SEED = process.env.HOT_WALLET_SEED;
const XRPL_NETWORK = process.env.XRPL_NETWORK || 'testnet';

let wallet = null;
let client = null;
let isConnected = false;

/**
 * Get WebSocket URL for network.
 */
function getNetworkUrl() {
  if (XRPL_NETWORK === 'mainnet') {
    return 'wss://xrplcluster.com';
  }
  return 'wss://s.altnet.rippletest.net:51233';
}

/**
 * Initialize hot wallet from environment.
 * Call once on server startup.
 */
async function initialize() {
  if (wallet) {
    console.log('[HotWallet] Already initialized');
    return;
  }

  if (!HOT_WALLET_SEED) {
    console.warn('[HotWallet] HOT_WALLET_SEED not set - hot wallet disabled');
    console.warn('[HotWallet] Set HOT_WALLET_SEED in .env to enable server-held wallet');
    return;
  }

  try {
    // Initialize wallet from seed (server-side only, never exposed)
    wallet = xrpl.Wallet.fromSeed(HOT_WALLET_SEED);
    
    // SECURITY: Log only public info, NEVER seed or private key
    console.log(`[HotWallet] Initialized (${XRPL_NETWORK})`);
    console.log(`[HotWallet] Address: ${wallet.address}`);
    console.log(`[HotWallet] Network: ${getNetworkUrl()}`);
    
    // Initialize XRPL client
    client = new xrpl.Client(getNetworkUrl());
    
  } catch (err) {
    console.error('[HotWallet] Initialization failed:', err.message);
    wallet = null;
    client = null;
  }
}

/**
 * Connect to XRPL network.
 */
async function connect() {
  if (!client) {
    throw new Error('Hot wallet not initialized');
  }
  
  if (isConnected) {
    return;
  }

  try {
    await client.connect();
    isConnected = true;
    console.log('[HotWallet] Connected to XRPL');
  } catch (err) {
    console.error('[HotWallet] Connection failed:', err.message);
    throw err;
  }
}

/**
 * Disconnect from XRPL network.
 */
async function disconnect() {
  if (client && isConnected) {
    try {
      await client.disconnect();
      isConnected = false;
      console.log('[HotWallet] Disconnected from XRPL');
    } catch (err) {
      console.error('[HotWallet] Disconnect failed:', err.message);
    }
  }
}

/**
 * Get hot wallet address (public, safe to expose).
 */
function getAddress() {
  return wallet ? wallet.address : null;
}

/**
 * Check if hot wallet is enabled.
 */
function isEnabled() {
  return wallet !== null;
}

/**
 * Get account balance and info.
 */
async function getAccountInfo() {
  if (!wallet) {
    throw new Error('Hot wallet not initialized');
  }

  await connect();

  try {
    const response = await client.request({
      command: 'account_info',
      account: wallet.address,
      ledger_index: 'validated',
    });

    return {
      address: wallet.address,
      balance: xrpl.dropsToXrp(response.result.account_data.Balance),
      sequence: response.result.account_data.Sequence,
      network: XRPL_NETWORK,
    };
  } catch (err) {
    if (err.data?.error === 'actNotFound') {
      return {
        address: wallet.address,
        balance: '0',
        sequence: null,
        network: XRPL_NETWORK,
        funded: false,
        message: 'Account not found - needs funding from faucet',
      };
    }
    throw err;
  }
}

/**
 * Get account transactions (for tracking deposits).
 * @param {number} limit - Max transactions to fetch
 */
async function getTransactions(limit = 50) {
  if (!wallet) {
    throw new Error('Hot wallet not initialized');
  }

  await connect();

  try {
    const response = await client.request({
      command: 'account_tx',
      account: wallet.address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit,
    });

    return response.result.transactions.map(tx => ({
      hash: tx.tx.hash,
      type: tx.tx.TransactionType,
      from: tx.tx.Account,
      to: tx.tx.Destination,
      amount: tx.tx.Amount,
      memo: tx.tx.Memos,
      date: tx.tx.date,
      validated: tx.validated,
    }));
  } catch (err) {
    if (err.data?.error === 'actNotFound') {
      return [];
    }
    throw err;
  }
}

/**
 * Get NFTs owned by hot wallet.
 */
async function getNFTs() {
  if (!wallet) {
    throw new Error('Hot wallet not initialized');
  }

  await connect();

  try {
    const response = await client.request({
      command: 'account_nfts',
      account: wallet.address,
      ledger_index: 'validated',
    });

    return response.result.account_nfts || [];
  } catch (err) {
    if (err.data?.error === 'actNotFound') {
      return [];
    }
    throw err;
  }
}

/**
 * Create destination-locked NFT offer for winner.
 * @param {string} nftokenId - NFT ID to transfer
 * @param {string} destination - Winner's XRPL address
 */
async function createNFTOffer(nftokenId, destination) {
  if (!wallet) {
    throw new Error('Hot wallet not initialized');
  }

  await connect();

  try {
    // Create destination-locked sell offer with 0 amount
    const tx = {
      TransactionType: 'NFTokenCreateOffer',
      Account: wallet.address,
      NFTokenID: nftokenId,
      Amount: '0',
      Destination: destination,
      Flags: 1, // tfSellNFToken
    };

    const prepared = await client.autofill(tx);
    
    // Sign with server-held wallet (NEVER expose to client)
    const signed = wallet.sign(prepared);
    
    // Submit and wait
    const result = await client.submitAndWait(signed.tx_blob);

    return {
      hash: result.result.hash,
      result: result.result.meta.TransactionResult,
      offerId: result.result.meta.offer_id,
    };
  } catch (err) {
    console.error('[HotWallet] NFT offer creation failed:', err.message);
    throw err;
  }
}

/**
 * Send XRP payment from hot wallet.
 * @param {string} destination - Recipient address
 * @param {string} amount - Amount in XRP
 * @param {string} memo - Optional memo
 */
async function sendPayment(destination, amount, memo = null) {
  if (!wallet) {
    throw new Error('Hot wallet not initialized');
  }

  await connect();

  try {
    const tx = {
      TransactionType: 'Payment',
      Account: wallet.address,
      Destination: destination,
      Amount: xrpl.xrpToDrops(amount),
    };

    if (memo) {
      tx.Memos = [{
        Memo: {
          MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase(),
        }
      }];
    }

    const prepared = await client.autofill(tx);
    
    // Sign with server-held wallet
    const signed = wallet.sign(prepared);
    
    // Submit and wait
    const result = await client.submitAndWait(signed.tx_blob);

    return {
      hash: result.result.hash,
      result: result.result.meta.TransactionResult,
    };
  } catch (err) {
    console.error('[HotWallet] Payment failed:', err.message);
    throw err;
  }
}

/**
 * Subscribe to transaction stream for real-time deposit detection.
 * @param {Function} callback - Called for each transaction
 */
async function subscribeToTransactions(callback) {
  if (!wallet) {
    throw new Error('Hot wallet not initialized');
  }

  await connect();

  try {
    await client.request({
      command: 'subscribe',
      accounts: [wallet.address],
    });

    client.on('transaction', (tx) => {
      if (tx.validated && tx.transaction.Destination === wallet.address) {
        callback(tx);
      }
    });

    console.log('[HotWallet] Subscribed to transaction stream');
  } catch (err) {
    console.error('[HotWallet] Subscription failed:', err.message);
    throw err;
  }
}

module.exports = {
  initialize,
  connect,
  disconnect,
  getAddress,
  isEnabled,
  getAccountInfo,
  getTransactions,
  getNFTs,
  createNFTOffer,
  sendPayment,
  subscribeToTransactions,
  XRPL_NETWORK,
};
