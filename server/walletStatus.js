'use strict';

/**
 * Minimal stub for hot wallet status checks.
 */

function getHotWalletStatus() {
  const hotWalletSeed = process.env.HOT_WALLET_SEED;
  const configured = Boolean(hotWalletSeed && hotWalletSeed.trim());
  
  return {
    configured,
    network: process.env.XRPL_NETWORK || 'testnet',
  };
}

module.exports = {
  getHotWalletStatus,
};
