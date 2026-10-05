'use strict';

/**
 * Staging admin session shared across /wheel-staging/* pages.
 * Persists to localStorage (cross-tab, same origin) + sessionStorage.
 * Key is staging-scoped so it does not collide with prod GOML keys
 * (goml_admin_token / goml_wallet_token) on the same host.
 *
 * Staging deliberately has NO Xaman / XRPL wallet SignIn gate for admin
 * scrape/spin/payout — ADMIN_TOKEN via X-Admin-Token is sufficient.
 */
(function (global) {
  var TOKEN_KEY = 'pw_staging_admin_token';
  var LEGACY_KEY = 'adminToken';

  function apiBase() {
    var path = location.pathname || '';
    if (path.indexOf('/wheel-staging') === 0) return '/wheel-staging';
    if (path.indexOf('/wheel') === 0) return '/wheel';
    return '';
  }

  function safeGet(store, key) {
    try {
      return store.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }

  function safeSet(store, key, value) {
    try {
      store.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeRemove(store, key) {
    try {
      store.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }

  function saveAdminToken(token) {
    if (typeof token !== 'string') return false;
    token = token.trim();
    if (!token) return false;
    var ok = false;
    ok = safeSet(localStorage, TOKEN_KEY, token) || ok;
    ok = safeSet(sessionStorage, TOKEN_KEY, token) || ok;
    // Mirror legacy key so any un-updated inline page still finds the token.
    safeSet(sessionStorage, LEGACY_KEY, token);
    safeSet(localStorage, LEGACY_KEY, token);
    return ok;
  }

  function readAdminToken() {
    var modern =
      safeGet(localStorage, TOKEN_KEY) ||
      safeGet(sessionStorage, TOKEN_KEY);
    if (modern) return modern;
    var legacy =
      safeGet(sessionStorage, LEGACY_KEY) ||
      safeGet(localStorage, LEGACY_KEY) ||
      '';
    if (legacy) {
      saveAdminToken(legacy);
      return legacy;
    }
    return '';
  }

  function clearAdminToken() {
    safeRemove(localStorage, TOKEN_KEY);
    safeRemove(sessionStorage, TOKEN_KEY);
    safeRemove(localStorage, LEGACY_KEY);
    safeRemove(sessionStorage, LEGACY_KEY);
  }

  function authHeaders(extra) {
    var h = { 'Content-Type': 'application/json' };
    var token = readAdminToken();
    if (token) h['X-Admin-Token'] = token;
    if (extra && typeof extra === 'object') {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
      }
    }
    return h;
  }

  function hasAdminToken() {
    return Boolean(readAdminToken());
  }

  global.PrizeWheelAdminSession = {
    TOKEN_KEY: TOKEN_KEY,
    LEGACY_KEY: LEGACY_KEY,
    apiBase: apiBase,
    readAdminToken: readAdminToken,
    saveAdminToken: saveAdminToken,
    clearAdminToken: clearAdminToken,
    authHeaders: authHeaders,
    hasAdminToken: hasAdminToken,
  };
})(typeof window !== 'undefined' ? window : globalThis);
