'use strict';

/**
 * Stub for active X Spaces detection.
 * Not required for staging sends - included for compatibility.
 */

async function findActiveHostedSpaces({ fresh = false }) {
  return {
    ok: false,
    found: false,
    space: null,
    spaces: [],
    chosen: null,
    reason: 'Active space detection not implemented in this build',
    error: 'Not configured',
  };
}

module.exports = {
  findActiveHostedSpaces,
};
