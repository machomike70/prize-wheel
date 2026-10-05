'use strict';

/**
 * Stub for web scraping functionality.
 * Not required for staging sends - included for compatibility.
 */

async function scrapeXProfile(username) {
  return {
    ok: false,
    status: 501,
    error: 'X profile scraping not implemented in this build',
  };
}

async function scrapeWebPage(url) {
  return {
    ok: false,
    status: 501,
    error: 'Web page scraping not implemented in this build',
  };
}

module.exports = {
  scrapeXProfile,
  scrapeWebPage,
};
