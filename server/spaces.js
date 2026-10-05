'use strict';

/**
 * Stub for X Spaces scraping functionality.
 * Not required for staging sends - included for compatibility.
 */

function parseSpaceId(input) {
  const match = String(input || '').match(/spaces?\/([a-zA-Z0-9]+)/i);
  return match ? match[1] : input;
}

async function scrapeSpace(spaceId) {
  return {
    ok: false,
    status: 501,
    error: 'Space scraping not implemented in this build',
  };
}

function formatParticipantsForGiveaway(result) {
  return [];
}

module.exports = {
  parseSpaceId,
  scrapeSpace,
  formatParticipantsForGiveaway,
};
