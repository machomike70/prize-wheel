'use strict';

/**
 * Stub for X (Twitter) API authentication.
 * Not required for staging sends - included for compatibility.
 */

function publicStatus() {
  return {
    bearerConfigured: false,
    userOAuthConfigured: false,
  };
}

function bearerConfigured() {
  return false;
}

function userOAuthConfigured() {
  return false;
}

function getStatus() {
  return {
    bearerConfigured: false,
    userOAuthConfigured: false,
    authMode: 'none',
    goml: { handle: null, userId: null },
  };
}

async function verifyUser({ force = false }) {
  return {
    ok: false,
    error: 'X API authentication not configured',
  };
}

module.exports = {
  publicStatus,
  bearerConfigured,
  userOAuthConfigured,
  getStatus,
  verifyUser,
};
