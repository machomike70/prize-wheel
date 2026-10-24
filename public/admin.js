(() => {
  'use strict';

  const WALLET_TOKEN_KEY = 'goml_wallet_token';
  const ADMIN_TOKEN_KEY = 'goml_admin_token';
  const WALLET_ADDR_KEY = 'goml_wallet_addr';
  const WALLET_ROLE_KEY = 'goml_wallet_role';

  // GOML Admin stores goml_wallet_token / goml_admin_token in sessionStorage
  // (and, after the session bridge, localStorage) on this same origin.
  // Some browsers partition iframe storage even for same-origin embeds, so
  // also read the parent window's storage and accept a same-origin postMessage.
  // Query tokens are for tooling only (not shown in the UI).
  const params = new URLSearchParams(location.search);

  function apiBase() {
    // Works both at / and behind handle_path /wheel*
    const m = location.pathname.match(/^\/wheel[A-Za-z0-9_-]*(?=\/|$)/);
    return m ? m[0] : '';
  }

  function storageGet(win, kind, key) {
    try {
      const store = kind === 'local' ? win.localStorage : win.sessionStorage;
      return store.getItem(key);
    } catch {
      return null;
    }
  }

  function ancestorWindows() {
    const out = [];
    try {
      if (window.parent && window.parent !== window) out.push(window.parent);
    } catch { /* cross-origin parent */ }
    try {
      if (window.top && window.top !== window && out.indexOf(window.top) === -1) out.push(window.top);
    } catch { /* cross-origin top */ }
    return out;
  }

  function readSessionKey(key) {
    const own = storageGet(window, 'session', key) || storageGet(window, 'local', key);
    if (own) return own;
    for (const win of ancestorWindows()) {
      const v = storageGet(win, 'session', key) || storageGet(win, 'local', key);
      if (v) return v;
    }
    if (key === WALLET_TOKEN_KEY) return params.get('walletToken');
    if (key === ADMIN_TOKEN_KEY) return params.get('adminToken');
    return null;
  }

  function adoptAncestorSession() {
    const keys = [WALLET_TOKEN_KEY, ADMIN_TOKEN_KEY, WALLET_ADDR_KEY, WALLET_ROLE_KEY];
    for (const key of keys) {
      if (storageGet(window, 'session', key) || storageGet(window, 'local', key)) continue;
      for (const win of ancestorWindows()) {
        const v = storageGet(win, 'session', key) || storageGet(win, 'local', key);
        if (!v) continue;
        persistKey(key, v);
        break;
      }
    }
  }

  function persistKey(key, value) {
    if (typeof value !== 'string' || !value) return false;
    let changed = false;
    try {
      if (sessionStorage.getItem(key) !== value) {
        sessionStorage.setItem(key, value);
        changed = true;
      }
    } catch { /* storage blocked */ }
    try {
      if (localStorage.getItem(key) !== value) {
        localStorage.setItem(key, value);
        changed = true;
      }
    } catch { /* private mode / blocked */ }
    return changed;
  }

  function rememberSession(partial) {
    const pairs = [
      [WALLET_TOKEN_KEY, partial.walletToken],
      [ADMIN_TOKEN_KEY, partial.adminToken],
      [WALLET_ADDR_KEY, partial.walletAddr],
      [WALLET_ROLE_KEY, partial.walletRole],
    ];
    let changed = false;
    for (const [key, value] of pairs) {
      if (persistKey(key, value)) changed = true;
    }
    return changed;
  }

  /** Capture ?adminToken= / ?walletToken= into durable storage, then drop them from the URL. */
  function adoptQueryTokens() {
    const admin = params.get('adminToken');
    const wallet = params.get('walletToken');
    if (!admin && !wallet) return;
    rememberSession({
      adminToken: admin || undefined,
      walletToken: wallet || undefined,
    });
    try {
      const url = new URL(location.href);
      url.searchParams.delete('adminToken');
      url.searchParams.delete('walletToken');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch { /* ignore */ }
  }

  function authHeaders() {
    adoptAncestorSession();
    const h = { 'Content-Type': 'application/json' };
    const wallet = readSessionKey(WALLET_TOKEN_KEY);
    const admin = readSessionKey(ADMIN_TOKEN_KEY);
    if (wallet) h['X-Wallet-Token'] = wallet;
    else if (admin) h['X-Admin-Token'] = admin;
    return h;
  }

  function hasCreds() {
    const h = authHeaders();
    return Boolean(h['X-Wallet-Token'] || h['X-Admin-Token']);
  }

  function requestParentSession() {
    const msg = { type: 'goml-admin-session-request' };
    for (const win of ancestorWindows()) {
      try { win.postMessage(msg, location.origin); } catch { /* ignore */ }
    }
  }

  const els = {
    gate: document.getElementById('gate'),
    gateMsg: document.getElementById('gateMsg'),
    app: document.getElementById('app'),
    who: document.getElementById('who'),
    rolePill: document.getElementById('rolePill'),
    spaceUrl: document.getElementById('spaceUrl'),
    spaceStatus: document.getElementById('spaceStatus'),
    trackLine: document.getElementById('trackLine'),
    trackHandle: document.getElementById('trackHandle'),
    trackChange: document.getElementById('trackChange'),
    trackForm: document.getElementById('trackForm'),
    trackInput: document.getElementById('trackInput'),
    trackSave: document.getElementById('trackSave'),
    trackMsg: document.getElementById('trackMsg'),
    spaceAdvanced: document.getElementById('spaceAdvanced'),
    resultCard: document.getElementById('resultCard'),
    adminWheel: document.getElementById('adminWheel'),
    resultWinner: document.getElementById('resultWinner'),
    resultTitle: document.getElementById('resultTitle'),
    resultMeta: document.getElementById('resultMeta'),
    resultBroadcast: document.getElementById('resultBroadcast'),
    refreshSpace: document.getElementById('refreshSpace'),
    spaceGoLive: document.getElementById('spaceGoLive'),
    spaceBroadcast: document.getElementById('spaceBroadcast'),
    spaceParticipantCount: document.getElementById('spaceParticipantCount'),
    spaceBreakdown: document.getElementById('spaceBreakdown'),
    spaceLastSync: document.getElementById('spaceLastSync'),
    spaceMsg: document.getElementById('spaceMsg'),
    spaceWarning: document.getElementById('spaceWarning'),
    spaceWarningText: document.getElementById('spaceWarningText'),
    spaceOverride: document.getElementById('spaceOverride'),
    spaceResult: document.getElementById('spaceResult'),
    spaceWinner: document.getElementById('spaceWinner'),
    spaceIndex: document.getElementById('spaceIndex'),
    spaceTs: document.getElementById('spaceTs'),
    prizeList: document.getElementById('prizeList'),
    savePrizes: document.getElementById('savePrizes'),
    prizeMsg: document.getElementById('prizeMsg'),
    site: document.getElementById('site'),
    count: document.getElementById('count'),
    orderId: document.getElementById('orderId'),
    walletBind: document.getElementById('walletBind'),
    mintBtn: document.getElementById('mintBtn'),
    mintMsg: document.getElementById('mintMsg'),
    mintOut: document.getElementById('mintOut'),
    filterSite: document.getElementById('filterSite'),
    filterUnused: document.getElementById('filterUnused'),
    refreshTickets: document.getElementById('refreshTickets'),
    ticketBody: document.getElementById('ticketBody'),
    gomlAdminLink: document.getElementById('gomlAdminLink'),
    giveawayMode: document.getElementById('giveawayMode'),
    giveawayRecord: document.getElementById('giveawayRecord'),
    giveawayItems: document.getElementById('giveawayItems'),
    giveawayItemsLabel: document.getElementById('giveawayItemsLabel'),
    giveawayNote: document.getElementById('giveawayNote'),
    giveawaySpinBtn: document.getElementById('giveawaySpinBtn'),
    giveawayUsePrizes: document.getElementById('giveawayUsePrizes'),
    giveawayPushLive: document.getElementById('giveawayPushLive'),
    giveawayClearLive: document.getElementById('giveawayClearLive'),
    giveawayBroadcast: document.getElementById('giveawayBroadcast'),
    giveawayWatchUrl: document.getElementById('giveawayWatchUrl'),
    giveawayMsg: document.getElementById('giveawayMsg'),
    giveawayResult: document.getElementById('giveawayResult'),
    giveawayWinner: document.getElementById('giveawayWinner'),
    giveawayIndex: document.getElementById('giveawayIndex'),
    giveawayTs: document.getElementById('giveawayTs'),
    giveawayProof: document.getElementById('giveawayProof'),
    giveawayCopyProof: document.getElementById('giveawayCopyProof'),
    giveawayBody: document.getElementById('giveawayBody'),
  };

  // Prefer GOML admin route on same host
  try {
    if (location.hostname.includes('goml')) {
      els.gomlAdminLink.href = '/admin';
    } else {
      els.gomlAdminLink.href = 'https://goml.xtremerippleprotocol.online/admin';
    }
  } catch { /* ignore */ }

  async function api(path, opts = {}) {
    const res = await fetch(apiBase() + path, {
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) },
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }

  function showMsg(el, text, ok) {
    el.textContent = text || '';
    el.className = 'msg ' + (ok ? 'ok' : 'err');
  }

  // ── X Space scraping + GOML live-Space auto-detect ──────────────────────────
  // No hard-coded default Space: on open / SCRAPE we ask the server
  // which GOML Space is live right now (/api/admin/spaces/goml-live), fill the
  // field and scrape it. If nothing is live, spins fall back to pasted/cached names.

  const SPACE_URL_KEY = 'pw_space_url';
  const SPACE_NAMES_KEY = 'pw_space_names';
  const SPACE_DATA_KEY = 'pw_space_data';
  const SPACE_DATA_AT_KEY = 'pw_space_data_at';
  // Cached room names older than this are from a previous show — drop them.
  const SPACE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

  let currentSpaceNames = [];
  let currentSpaceData = null;
  let lastSpaceScrapeError = null;
  let lastDetected = null; // last live GOML Space from autodetect (or null)
  let lastLoad = null; // { id, at } of the last successful Space load this page session
  // 'user' = typed/pasted this session (respected); 'saved'/'auto' = may be replaced
  let spaceFieldSource = 'auto';

  function parseSpaceIdClient(input) {
    const t = String(input || '').trim();
    if (!t) return null;
    if (/^[A-Za-z0-9_-]{13,}$/.test(t)) return t;
    const m = t.match(/(?:twitter|x)\.com\/i\/spaces\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function isNotLiveError(raw) {
    const lower = String(raw || '').toLowerCase();
    return (
      lower.includes('not live') ||
      lower.includes('timedout') ||
      lower.includes('ended') ||
      lower.includes('canceled') ||
      lower.includes('cancelled') ||
      lower.includes('not found')
    );
  }

  function ssGet(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }
  function ssSet(key, v) {
    try { sessionStorage.setItem(key, v); } catch { /* ignore */ }
  }
  function ssDel(key) {
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  }

  function spaceLabel(sp) {
    if (!sp) return 'the Space';
    // Newer API: myRole = role of the tracked admin; matchedBy = you | goml | cohost
    const r = 'myRole' in sp ? sp.myRole : sp.gomlRole;
    let role = r === 'creator' ? 'your Space' : r === 'host' ? 'you are co-host' : r === 'speaker' ? 'you are a speaker' : '';
    if (!role && sp.matchedBy === 'goml') role = 'GOML Space';
    if (!role && sp.matchedBy === 'cohost') role = 'GOML co-host Space';
    return '"' + (sp.title || sp.id) + '"' + (role ? ' (' + role + ')' : '');
  }

  function setSpaceStatus(text, kind) {
    if (!els.spaceStatus) return;
    els.spaceStatus.textContent = text || '';
    els.spaceStatus.className = 'space-status ' + (kind || '');
  }

  function spaceNotReadyMessage(raw) {
    const msg = String(raw || '');
    const lower = msg.toLowerCase();
    const notLive =
      lower.includes('not live') ||
      lower.includes('scheduled') ||
      lower.includes('prepublished') ||
      lower.includes('timedout') ||
      lower.includes('timeout') ||
      lower.includes('ended') ||
      lower.includes('canceled') ||
      lower.includes('cancelled');
    const empty =
      lower.includes('no participants') ||
      lower.includes('0 participant') ||
      lower.includes('empty');
    if (notLive || empty) {
      return (
        'Space not live / empty. SPIN still works with names pasted under Giveaway spin ' +
        'or cached names.' +
        (msg ? ' [' + msg + ']' : '')
      );
    }
    return msg || 'Could not sync Space room.';
  }

  function pastedGiveawayNames() {
    if (!els.giveawayItems) return [];
    return els.giveawayItems.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function breakdownText(d) {
    const hostsCount = d?.hosts?.length || 0;
    const speakersCount = d?.speakers?.length || 0;
    const listenersCount = d?.listeners?.length || 0;
    const parts = [];
    if (hostsCount > 0) parts.push(`${hostsCount} host${hostsCount !== 1 ? 's' : ''}`);
    if (speakersCount > 0) parts.push(`${speakersCount} speaker${speakersCount !== 1 ? 's' : ''}`);
    if (listenersCount > 0) parts.push(`${listenersCount} listener${listenersCount !== 1 ? 's' : ''}`);
    return parts.join(', ');
  }

  function applyCachedSpaceUi(note) {
    if (!currentSpaceNames.length) return;
    els.spaceParticipantCount.textContent = String(currentSpaceNames.length);
    const b = breakdownText(currentSpaceData);
    if (b) els.spaceBreakdown.textContent = b;
    if (note) els.spaceLastSync.textContent = note;
  }

  function resetRoomUi(note) {
    els.spaceParticipantCount.textContent = '—';
    els.spaceBreakdown.textContent = '—';
    els.spaceLastSync.textContent = note || 'Not synced yet';
    els.spaceWarning.classList.add('hidden');
  }

  /** Remove sessionStorage pointing at an ended Space (and stale cached names). */
  function clearStaleSpace(staleId) {
    const saved = ssGet(SPACE_URL_KEY);
    if (saved && (!staleId || parseSpaceIdClient(saved) === staleId)) ssDel(SPACE_URL_KEY);
    const at = Number(ssGet(SPACE_DATA_AT_KEY)) || 0;
    if (!at || Date.now() - at > SPACE_CACHE_MAX_AGE_MS) dropCachedNames();
    if (staleId && parseSpaceIdClient(els.spaceUrl.value) === staleId) {
      els.spaceUrl.value = '';
      spaceFieldSource = 'auto';
    }
  }

  function dropCachedNames() {
    ssDel(SPACE_NAMES_KEY);
    ssDel(SPACE_DATA_KEY);
    ssDel(SPACE_DATA_AT_KEY);
    currentSpaceNames = [];
    currentSpaceData = null;
  }

  // ── Who are we tracking? (the admin who opened the wheel) ───────────────────
  const MY_X_KEY = 'pw_my_x_handle';
  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ } }

  function renderTracking(t) {
    if (!els.trackHandle) return;
    if (t && t.handle && t.userId) {
      const note = t.source === 'seed' || t.source === 'owner' ? ' (auto)' : t.source === 'browser' ? ' (this browser)' : '';
      els.trackHandle.textContent = '@' + t.handle + note;
      els.trackLine.classList.remove('unset');
      if (els.trackInput && !els.trackInput.value) els.trackInput.value = '@' + t.handle;
    } else {
      els.trackHandle.textContent = t && t.error ? t.error : 'nobody yet — set your X handle';
      els.trackLine.classList.add('unset');
    }
  }

  async function saveMyHandle() {
    const v = (els.trackInput.value || '').trim();
    els.trackSave.disabled = true;
    showMsg(els.trackMsg, v ? 'Checking ' + v + ' on X...' : 'Clearing...', true);
    try {
      const d = await api('/api/admin/me/x', { method: 'PUT', body: JSON.stringify({ handle: v }) });
      lsSet(MY_X_KEY, d.tracking && d.tracking.handle && v ? d.tracking.handle : '');
      renderTracking(d.tracking);
      showMsg(els.trackMsg, v ? 'Saved — tracking @' + d.tracking.handle + (d.stored === 'browser' ? ' (this browser)' : '') : 'Cleared', true);
      els.trackForm.classList.add('hidden');
      setSpaceStatus('Looking for a live Space you are in...', '');
      await detectOnOpen(true);
    } catch (err) {
      showMsg(els.trackMsg, err.message, false);
    } finally {
      els.trackSave.disabled = false;
    }
  }

  async function detectGomlSpace(fresh, quick) {
    try {
      const q = [];
      if (fresh) q.push('fresh=1');
      if (quick) q.push('quick=1');
      const myHandle = lsGet(MY_X_KEY);
      if (myHandle) q.push('xHandle=' + encodeURIComponent(myHandle));
      const d = await api('/api/admin/spaces/goml-live' + (q.length ? '?' + q.join('&') : ''));
      if (d && d.tracking) renderTracking(d.tracking);
      lastDetected = d && d.live && d.space ? d.space : null;
      return d;
    } catch (err) {
      lastDetected = null;
      return { ok: false, live: false, space: null, error: err.message };
    }
  }

  async function scrapeSpace(spaceUrl) {
    try {
      const data = await api('/api/admin/spaces/scrape', {
        method: 'POST',
        body: JSON.stringify({ spaceUrl, autopost: true, spacePostUrl: (window.__gomlSpacePostUrl ? window.__gomlSpacePostUrl() : '').trim() || undefined }), // SCRAPE is only reachable from the admin's tap
      });
      if (data && data.autopost) renderAutopost(data.autopost);
      armShareLink(data && data.autopost); // Share Link: armed after any successful SCRAPE (no spin)
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function useDetected(space) {
    els.spaceUrl.value = space.url;
    spaceFieldSource = 'auto';
    ssSet(SPACE_URL_KEY, space.url);
  }

  /**
   * Work out which Space to scrape: the live GOML Space (auto-detected) unless
   * the admin typed a different one this session. Returns { url, detected, detect }.
   */
  async function resolveSpaceTarget(fresh) {
    const typed = els.spaceUrl.value.trim();
    const typedId = parseSpaceIdClient(typed);
    // A link the admin pasted/typed wins — load it straight away (detect only if it has ended).
    if (typedId && spaceFieldSource === 'user') return { url: typed, typedId, detected: null, detect: null, lazy: true };
    const detect = await detectGomlSpace(fresh);
    const live = detect && detect.live ? detect.space : null;
    if (live && (!typedId || typedId === live.id || spaceFieldSource !== 'user')) {
      useDetected(live);
      return { url: live.url, detected: live, detect };
    }
    if (typedId) return { url: typed, typedId, detected: live, detect };
    return { url: null, detected: null, detect };
  }

  async function refreshSpace(silent = false) {
    if (!silent) {
      els.refreshSpace.disabled = true;
      showMsg(els.spaceMsg, els.spaceUrl.value.trim() && spaceFieldSource === 'user' ? 'Scraping that Space (names only, no spin)...' : 'Looking for your live Space...', true);
    }
    try {
      return await refreshSpaceInner(silent);
    } finally {
      if (!silent) els.refreshSpace.disabled = false;
    }
  }

  function noLiveSpaceFallback(silent, detect, endedId) {
    const pasted = pastedGiveawayNames().length;
    const why = detect && detect.ok === false && detect.error
      ? 'Could not check X for a live Space (' + detect.error + ').'
      : endedId
        ? 'Space ' + endedId + ' has ended and no other live Space was found for you.'
        : 'No live Space found where you are host, co-host or speaker.';
    let fallback;
    if (currentSpaceNames.length >= 2) {
      fallback = 'SPIN will use the ' + currentSpaceNames.length + ' names loaded earlier tonight.';
      applyCachedSpaceUi('No live Space — keeping ' + currentSpaceNames.length + ' cached names');
    } else if (pasted >= 2) {
      fallback = 'SPIN will use the ' + pasted + ' names pasted under Giveaway spin.';
      resetRoomUi('No live Space');
    } else {
      fallback = 'Tap "Wrong Space or none found? Paste a link" to use any Space, or paste names under Giveaway spin, then SPIN.';
      resetRoomUi('No live Space');
    }
    setSpaceStatus('⚪ ' + why, 'warn');
    try { if (els.spaceAdvanced) els.spaceAdvanced.open = true; } catch { /* ignore */ }
    if (!silent) showMsg(els.spaceMsg, why + ' ' + fallback, false);
    return null;
  }

  async function refreshSpaceInner(silent) {
    const target = await resolveSpaceTarget(!silent);
    if (!target.url) return noLiveSpaceFallback(silent, target.detect, null);

    if (target.detected && target.url === target.detected.url) {
      setSpaceStatus('🔴 LIVE: ' + spaceLabel(target.detected) + ' — loading names...', 'live');
      if (!silent) showMsg(els.spaceMsg, 'Found live Space ' + spaceLabel(target.detected) + ' — scraping names (no spin)...', true);
    }

    let usedUrl = target.url;
    let result = await scrapeSpace(usedUrl);

    // Typed/saved Space has ended — switch to the live GOML Space if there is one.
    if (!result.ok && isNotLiveError(result.error)) {
      const endedId = parseSpaceIdClient(usedUrl);
      clearStaleSpace(endedId);
      if (target.lazy) {
        target.detect = await detectGomlSpace(true);
        target.detected = lastDetected;
      }
      if (target.detected && target.detected.id !== endedId) {
        useDetected(target.detected);
        usedUrl = target.detected.url;
        setSpaceStatus('🔴 LIVE: ' + spaceLabel(target.detected) + ' — loading names...', 'live');
        result = await scrapeSpace(usedUrl);
      } else {
        lastSpaceScrapeError = result.error || '';
        return noLiveSpaceFallback(silent, target.detect, endedId);
      }
    }

    if (!result.ok) {
      lastSpaceScrapeError = result.error || '';
      const soft = spaceNotReadyMessage(lastSpaceScrapeError);
      const title = target.detected ? '"' + (target.detected.title || target.detected.id) + '"' : 'the Space';
      setSpaceStatus('⚠️ Could not load names for ' + title + ' (' + lastSpaceScrapeError + ')', 'warn');
      if (currentSpaceNames.length >= 2) {
        applyCachedSpaceUi('Sync failed — keeping ' + currentSpaceNames.length + ' cached names (spin still OK)');
        if (!silent) {
          showMsg(els.spaceMsg, soft + ' Cached ' + currentSpaceNames.length + ' names still loaded — SPIN works.', false);
        }
      } else {
        resetRoomUi('Sync failed');
        if (!silent) showMsg(els.spaceMsg, soft, false);
      }
      return null;
    }
    lastSpaceScrapeError = null;

    const { data } = result;
    currentSpaceNames = data.names || [];
    currentSpaceData = data;
    lastLoad = { id: data.spaceId, at: Date.now() };
    ssSet(SPACE_URL_KEY, usedUrl);
    ssSet(SPACE_NAMES_KEY, JSON.stringify(currentSpaceNames));
    ssSet(SPACE_DATA_KEY, JSON.stringify(data));
    ssSet(SPACE_DATA_AT_KEY, String(Date.now()));

    const hostsCount = data.hosts?.length || 0;
    const speakersCount = data.speakers?.length || 0;
    const listenersCount = data.listeners?.length || 0;
    const total = data.total || currentSpaceNames.length;
    const title = data.spaceData?.title || target.detected?.title || data.spaceId || 'X Space';

    els.spaceParticipantCount.textContent = String(total);
    els.spaceBreakdown.textContent = breakdownText(data) || '—';
    els.spaceLastSync.textContent = 'Synced ' + new Date().toLocaleTimeString();
    const roleSp = lastDetected && lastDetected.id === data.spaceId ? lastDetected : null;
    setSpaceStatus('🔴 LIVE: ' + (roleSp ? spaceLabel({ ...roleSp, title }) : '"' + title + '"') + ' — ' + total + ' names loaded', 'live');

    if (data.hasListeners === false) {
      els.spaceWarning.classList.remove('hidden');
      els.spaceWarningText.textContent = data.warning || 'Only hosts + speakers available. Listeners cannot be scraped.';
      els.spaceOverride.checked = false;
      if (!silent) {
        showMsg(els.spaceMsg, `⚠️ INCOMPLETE: ${hostsCount + speakersCount} participants (${hostsCount} hosts, ${speakersCount} speakers). Listeners unavailable.`, false);
      }
    } else {
      els.spaceWarning.classList.add('hidden');
      if (!silent) {
        if (total < 1) {
          lastSpaceScrapeError = 'No participants found in Space';
          els.spaceLastSync.textContent = 'Space empty';
          showMsg(els.spaceMsg, spaceNotReadyMessage(lastSpaceScrapeError), false);
        } else {
          showMsg(els.spaceMsg, `✓ "${title}": ${total} participants (${hostsCount} hosts, ${speakersCount} speakers, ${listenersCount} listeners)`, true);
        }
      }
    }

    return data;
  }

  // ── Big result card (phone-friendly: no need to open the watch page) ─────────

  function showResultCard(o) {
    const card = els.resultCard;
    if (!card) return;
    card.classList.remove('hidden', 'ok', 'err');
    card.classList.add(o.error ? 'err' : 'ok');
    els.resultWinner.textContent = o.error ? 'Spin failed' : o.winner || '?';
    els.resultTitle.textContent = o.error ? o.error : o.title || '';
    els.resultMeta.textContent = o.meta || '';
    setBroadcastLine(o.broadcastText || '', o.broadcastKind || '');
    try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
  }

  function setBroadcastLine(text, kind) {
    if (!els.resultBroadcast) return;
    els.resultBroadcast.textContent = text;
    els.resultBroadcast.className = 'result-broadcast ' + (kind || '');
  }

  /** Confirm the public watch page state now shows this spin (GET /api/live is public). */
  async function confirmBroadcast(data, requested) {
    if (!requested) {
      setBroadcastLine('Not broadcast (admin-only result) — the watch page was not changed.', 'muted');
      return;
    }
    const liveId = data && data.live && data.live.id;
    if (!liveId) {
      setBroadcastLine('❌ Broadcast FAILED — the watch page did not get this spin. Spin again with Broadcast on.', 'bad');
      return;
    }
    setBroadcastLine('⏳ Checking the watch page...', 'muted');
    try {
      const res = await fetch(apiBase() + '/api/live', { cache: 'no-store', credentials: 'same-origin' });
      const j = await res.json();
      const same = j && j.live && j.live.id === liveId;
      const viewers = typeof j?.viewers === 'number' ? j.viewers : (typeof data.viewers === 'number' ? data.viewers : null);
      if (same) {
        setBroadcastLine(
          '✅ Broadcast to the watch page' + (viewers != null ? ' · ' + viewers + ' watching now' : ''),
          'good'
        );
      } else if (j && j.live && j.live.id) {
        setBroadcastLine('⚠️ Watch page already shows a newer spin (this one was broadcast).', 'warn');
      } else {
        setBroadcastLine('❌ Broadcast not confirmed — the watch page is not showing this spin.', 'bad');
      }
    } catch (err) {
      setBroadcastLine('⚠️ Spin was broadcast, but could not re-check the watch page (' + err.message + ').', 'warn');
    }
  }

  // ── Load names onto the wheel (NO spin) ─────────────────────────────────────

  function renderDetected(d, stillChecking) {
    if (d && d.live && d.space) {
      if (spaceFieldSource !== 'user') useDetected(d.space);
      setSpaceStatus(
        '🔴 LIVE: ' + spaceLabel(d.space) + ' — ' + d.space.participantCount + ' in room. Tap SCRAPE to load names.' +
          (stillChecking ? ' (still checking Spaces you co-host…)' : ''),
        'live'
      );
      return;
    }
    if (stillChecking) {
      setSpaceStatus('Checking Spaces you co-host or speak in...', '');
      return;
    }
    const saved = parseSpaceIdClient(els.spaceUrl.value);
    if (saved) {
      setSpaceStatus('⚪ No live Space auto-detected. Last used Space ' + saved + ' is in the link box — SCRAPE will check it.', 'warn');
    } else {
      setSpaceStatus(
        '⚪ ' + (d && d.ok === false && d.error ? 'Could not check X (' + d.error + ').' : 'No live Space found for you or the GOML hosts.') +
          ' Paste a Space link below, or paste names under Giveaway spin, then SPIN.',
        'warn'
      );
      try { if (els.spaceAdvanced) els.spaceAdvanced.open = true; } catch { /* ignore */ }
    }
  }

  // On open: show what we know fast, then refine with the slower follow-scan.
  async function detectOnOpen(fresh) {
    const d = await detectGomlSpace(fresh === true, true);
    const mine = d && d.live && d.space && d.space.matchedBy === 'you';
    const refine = !!(d && d.pending && !mine);
    renderDetected(d, refine);
    if (!refine) return;
    const d2 = await detectGomlSpace(false, false);
    renderDetected(d2 && (d2.live || !(d && d.live)) ? d2 : d, false);
  }


  function liveIsBusy(live) {
    if (!live) return false;
    if (live.status === 'spinning') return true;
    // Don't wipe a winner the audience is still looking at (auto-load on open only)
    const t = Number(live.updatedAt || live.startedAt || 0);
    return live.status === 'done' && t && Date.now() - t < 2 * 60 * 1000;
  }

  /** Push loaded names to the watch page + admin wheel as an idle "ready" preview. */
  async function pushNamesPreview(names, title, { auto = false } = {}) {
    const broadcastOn = els.spaceBroadcast ? els.spaceBroadcast.checked : true;
    if (!broadcastOn || !names || names.length < 2) return false;
    try {
      if (auto) {
        const res = await fetch(apiBase() + '/api/live', { cache: 'no-store', credentials: 'same-origin' });
        const j = await res.json().catch(() => ({}));
        if (liveIsBusy(j.live)) return false;
      }
      await api('/api/admin/live/ready', {
        method: 'POST',
        body: JSON.stringify({ mode: 'names', items: names, note: title || undefined }),
      });
      return true;
    } catch {
      return false;
    }
  }

  async function loadSpaceNames({ auto = false } = {}) {
    const data = await refreshSpace(false);
    if (data && currentSpaceNames.length >= 2) {
      const title = data.spaceData?.title || lastDetected?.title || 'X Space giveaway';
      const pushed = await pushNamesPreview(currentSpaceNames, title, { auto });
      const base =
        '✓ Loaded ' + currentSpaceNames.length + ' names from "' + title + '"' +
        (pushed ? ' onto the wheel' : '') + '. Tap SPIN when ready.';
      showMsg(els.spaceMsg, data.hasListeners === false ? els.spaceMsg.textContent : base, data.hasListeners !== false);
    }
    return data;
  }

  // ── SPIN (only when tapped) ──────────────────────────────────────────────────

  let revealTimer = 0;

  async function spinLoaded() {
    const pasteNames = pastedGiveawayNames();
    let spinNames = [];
    let source = '';
    let noteTitle = 'Giveaway spin';
    let titleLine = '';
    const snap = currentSpaceData;

    if (currentSpaceNames.length >= 2) {
      // Hosts/speakers-only scrape still needs explicit override
      if (snap && snap.hasListeners === false && !els.spaceOverride.checked) {
        showMsg(
          els.spaceMsg,
          '⚠️ Listeners unavailable from scrape. Check override to spin hosts/speakers, or paste names under Giveaway spin.',
          false
        );
        els.spaceWarning.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      spinNames = currentSpaceNames.slice();
      const fresh = !!(lastLoad && snap && snap.spaceId === lastLoad.id && Date.now() - lastLoad.at < 60 * 60 * 1000);
      source = fresh ? 'live Space' : 'loaded Space names';
      noteTitle = snap?.spaceData?.title || lastDetected?.title || 'X Space giveaway';
      titleLine = '🎤 ' + noteTitle + (fresh ? '' : ' (loaded earlier — Space may have ended)');
    } else if (pasteNames.length >= 2) {
      spinNames = pasteNames;
      source = 'pasted names';
      noteTitle = (els.giveawayNote && els.giveawayNote.value.trim()) || 'Pasted names giveaway';
      titleLine = 'No Space names loaded — spun the ' + pasteNames.length + ' names pasted under Giveaway spin';
    } else {
      const msg =
        'No names to spin. Tap SCRAPE while the Space is live, or paste at least 2 names ' +
        '(one per line) under Giveaway spin.';
      showMsg(els.spaceMsg, msg, false);
      showResultCard({ error: msg, meta: '', broadcastText: 'Nothing was spun or broadcast.', broadcastKind: 'muted' });
      return;
    }

    const doBroadcast = els.spaceBroadcast
      ? els.spaceBroadcast.checked
      : !els.giveawayBroadcast || els.giveawayBroadcast.value !== '0';

    const hostsCount = snap?.hosts?.length || 0;
    const speakersCount = snap?.speakers?.length || 0;
    const listenersCount = snap?.listeners?.length || 0;
    const hasListeners = snap?.hasListeners;

    els.spaceGoLive.disabled = true;
    showMsg(els.spaceMsg, `Spinning ${spinNames.length} names (${source})...`, true);

    try {
      const data = await api('/api/admin/spin', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'names',
          items: spinNames,
          record: true,
          broadcast: doBroadcast,
          note: noteTitle,
          claimPrizeId: (document.getElementById('claimPrize') || {}).value || undefined,
        }),
      });

      const label = data.result?.label || '?';
      els.spaceWinner.textContent = label;
      els.spaceIndex.textContent = String(data.result?.index ?? '');
      els.spaceTs.textContent = data.result?.ts ? new Date(data.result.ts).toLocaleString() : '';

      const breakdown =
        source === 'pasted names'
          ? 'pasted names'
          : hasListeners === false
            ? `${hostsCount} hosts, ${speakersCount} speakers (listeners unavailable)`
            : `${hostsCount} hosts, ${speakersCount} speakers, ${listenersCount} listeners`;
      const meta =
        spinNames.length + ' names · ' + breakdown + ' · ' +
        new Date(data.result?.ts || Date.now()).toLocaleTimeString();

      const reveal = () => {
        showMsg(els.spaceMsg, '🎉 Winner: ' + label + (doBroadcast ? '' : ' · not broadcast'), true);
        showResultCard({ winner: label, title: titleLine, meta });
        confirmBroadcast(data, doBroadcast);
      };

      if (doBroadcast && data.live && els.adminWheel) {
        // Let the embedded wheel play the same server-committed result first.
        showResultCard({ winner: '🎰 Spinning…', title: titleLine, meta: spinNames.length + ' names', broadcastText: '', broadcastKind: 'muted' });
        try { els.adminWheel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
        clearTimeout(revealTimer);
        const wait = Math.min(15000, Number(data.live.durationMs) || 8500) + 400;
        revealTimer = setTimeout(reveal, wait);
      } else {
        reveal();
      }

      await refreshGiveaways();
    } catch (err) {
      showMsg(els.spaceMsg, err.message, false);
      showResultCard({ error: err.message, broadcastText: 'Nothing was broadcast.', broadcastKind: 'muted' });
    } finally {
      els.spaceGoLive.disabled = false;
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────

  let bootGen = 0;
  let gateWait = 0;

  function showNoSession() {
    els.gate.classList.remove('hidden');
    els.app.classList.add('hidden');
    els.gateMsg.textContent = 'No GOML admin session found in this browser.';
  }

  async function boot() {
    const gen = ++bootGen;
    if (gateWait) {
      clearTimeout(gateWait);
      gateWait = 0;
    }
    if (!hasCreds()) {
      if (ancestorWindows().length) {
        requestParentSession();
        let tries = 0;
        gateWait = setInterval(() => {
          tries += 1;
          if (gen !== bootGen) {
            clearInterval(gateWait);
            gateWait = 0;
            return;
          }
          if (hasCreds()) {
            clearInterval(gateWait);
            gateWait = 0;
            boot();
            return;
          }
          if (tries >= 5) {
            clearInterval(gateWait);
            gateWait = 0;
            showNoSession();
            return;
          }
          requestParentSession();
        }, 200);
        return;
      }
      showNoSession();
      return;
    }
    try {
      const st = await api('/api/admin/status');
      if (gen !== bootGen) return;
      els.gate.classList.add('hidden');
      els.app.classList.remove('hidden');
      const addr =
        sessionStorage.getItem(WALLET_ADDR_KEY) ||
        st.wallet ||
        'token login';
      els.who.textContent = addr;
      els.rolePill.textContent = st.role || 'admin-token';
      els.prizeList.value = (st.prizes || []).join('\n');

      // Space field: restore last value (never a hard-coded default). Stale /
      // ended Spaces are cleared by refreshSpace, which also auto-detects the
      // live GOML Space and fills the field.
      const savedSpaceUrl = ssGet(SPACE_URL_KEY) || '';
      els.spaceUrl.value = savedSpaceUrl;
      spaceFieldSource = savedSpaceUrl ? 'saved' : 'auto';

      // Restore cached names only if they are from tonight (< 6h old)
      const cachedAt = Number(ssGet(SPACE_DATA_AT_KEY)) || 0;
      const cachedNames = ssGet(SPACE_NAMES_KEY);
      const cachedData = ssGet(SPACE_DATA_KEY);
      if (cachedNames && cachedData && cachedAt && Date.now() - cachedAt <= SPACE_CACHE_MAX_AGE_MS) {
        try {
          currentSpaceNames = JSON.parse(cachedNames) || [];
          currentSpaceData = JSON.parse(cachedData);
          if (currentSpaceNames.length > 0) applyCachedSpaceUi('From cache (refreshing...)');
        } catch {
          dropCachedNames();
        }
      } else if (cachedNames || cachedData) {
        dropCachedNames();
      }

      if (els.giveawayWatchUrl) {
        els.giveawayWatchUrl.value = (apiBase() || '/wheel') + '/?watch=1&embed=1&controls=0';
      }

      // Embedded watch wheel (same page/animation the audience sees)
      if (els.adminWheel && !els.adminWheel.getAttribute('src')) {
        els.adminWheel.src = (apiBase() || '') + '/?watch=1&embed=1&controls=0&admin=1';
      }

      // On open: find the live Space you're in and show its title. No scrape, never spins.
      setSpaceStatus('Looking for a live Space you are in...', '');
      setTimeout(() => detectOnOpen(false), 100);

      await refreshTickets();
      await refreshGiveaways();
      syncGiveawayModeLabel();
    } catch (err) {
      els.gate.classList.remove('hidden');
      els.gateMsg.textContent = err.message || 'Admin auth failed';
    }
  }

  async function savePrizes() {
    const items = els.prizeList.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const data = await api('/api/prizes', {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
      els.prizeList.value = data.prizes.join('\n');
      showMsg(els.prizeMsg, 'Saved ' + data.prizes.length + ' prizes', true);
    } catch (err) {
      showMsg(els.prizeMsg, err.message, false);
    }
  }

  async function mint() {
    const body = {
      site: els.site.value,
      count: Number(els.count.value) || 1,
      orderId: els.orderId.value.trim() || undefined,
      walletAddress: els.walletBind.value.trim() || undefined,
    };
    try {
      const data = await api('/api/tickets', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const codes = data.tickets.map((t) => t.code).join('\n');
      els.mintOut.textContent = codes;
      showMsg(els.mintMsg, 'Minted ' + data.tickets.length + ' ticket(s)', true);
      await refreshTickets();
    } catch (err) {
      showMsg(els.mintMsg, err.message, false);
    }
  }

  async function refreshTickets() {
    const q = new URLSearchParams();
    if (els.filterSite.value) q.set('site', els.filterSite.value);
    if (els.filterUnused.value) q.set('unused', els.filterUnused.value);
    try {
      const data = await api('/api/tickets?' + q.toString());
      els.ticketBody.innerHTML = (data.tickets || [])
        .slice(0, 100)
        .map((t) => {
          const used = t.usedAt
            ? new Date(t.usedAt).toLocaleString()
            : '—';
          const prize = t.prizeResult?.label || '—';
          return (
            '<tr>' +
            '<td><code>' +
            escapeHtml(t.code) +
            '</code></td>' +
            '<td>' +
            escapeHtml(t.site) +
            '</td>' +
            '<td><code>' +
            escapeHtml(t.walletAddress || '—') +
            '</code></td>' +
            '<td>' +
            escapeHtml(t.orderId || '—') +
            '</td>' +
            '<td>' +
            escapeHtml(used) +
            '</td>' +
            '<td>' +
            escapeHtml(prize) +
            '</td>' +
            '</tr>'
          );
        })
        .join('');
    } catch (err) {
      els.ticketBody.innerHTML =
        '<tr><td colspan="6">' + escapeHtml(err.message) + '</td></tr>';
    }
  }

  function syncGiveawayModeLabel() {
    const names = els.giveawayMode.value === 'names';
    els.giveawayItemsLabel.textContent = names
      ? 'Contestant names (one per line) — paste & spin anytime'
      : 'Prizes (one per line; blank = saved list) — spin anytime';
    els.giveawayItems.placeholder = names
      ? 'Alice\nBob\nCarol\n(no Space needed)'
      : 'Leave blank to use saved prizes, or paste a custom list';
  }

  function loadPrizesIntoGiveaway() {
    els.giveawayMode.value = 'prizes';
    els.giveawayItems.value = els.prizeList.value;
    syncGiveawayModeLabel();
    showMsg(els.giveawayMsg, 'Loaded current prize list into the spin box', true);
  }

  async function spinGiveaway() {
    const mode = els.giveawayMode.value === 'names' ? 'names' : 'prizes';
    const items = els.giveawayItems.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const body = {
      mode,
      record: els.giveawayRecord.value === '1',
      broadcast: !els.giveawayBroadcast || els.giveawayBroadcast.value !== '0',
      note: els.giveawayNote.value.trim() || undefined,
    };
    if (items.length) body.items = items;
    // Names mode requires items; prizes can fall back to server list
    if (mode === 'names' && items.length < 2) {
      showMsg(els.giveawayMsg, 'Paste at least 2 contestant names', false);
      return;
    }
    els.giveawaySpinBtn.disabled = true;
    try {
      const data = await api('/api/admin/spin', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const label = data.result?.label || '?';
      els.giveawayWinner.textContent = label;
      els.giveawayIndex.textContent = String(data.result?.index ?? '');
      els.giveawayTs.textContent = data.result?.ts
        ? new Date(data.result.ts).toLocaleString()
        : '';
      const proof = {
        result: data.result,
        signature: data.signature,
      };
      els.giveawayProof.value = JSON.stringify(proof, null, 2);
      els.giveawayResult.classList.remove('hidden');
      const viewers = typeof data.viewers === 'number' ? data.viewers : null;
      const gTitle = body.note || (mode === 'names' ? 'Names giveaway' : 'Prize spin');
      const gMeta = (data.result?.items?.length || items.length || '') + ' entries · ' + mode + ' · ' +
        new Date(data.result?.ts || Date.now()).toLocaleTimeString();
      const gReveal = () => {
        showResultCard({ winner: label, title: gTitle, meta: gMeta });
        renderShopCard(data.shopDiscount || null);
        confirmBroadcast(data, body.broadcast);
      };
      if (body.broadcast && data.live && els.adminWheel) {
        showResultCard({ winner: '🎰 Spinning…', title: gTitle, meta: gMeta, broadcastText: '', broadcastKind: 'muted' });
        try { els.adminWheel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
        clearTimeout(revealTimer);
        revealTimer = setTimeout(gReveal, Math.min(15000, Number(data.live.durationMs) || 8500) + 400);
      } else {
        gReveal();
      }
      showMsg(
        els.giveawayMsg,
        'Winner: ' +
          label +
          (data.recorded ? ' (recorded)' : '') +
          (data.live ? ' · broadcast live' : '') +
          (viewers != null ? ' · ' + viewers + ' watching' : ''),
        true
      );
      await refreshGiveaways();
    } catch (err) {
      showMsg(els.giveawayMsg, err.message, false);
      showResultCard({ error: err.message, broadcastText: 'Nothing was broadcast.', broadcastKind: 'muted' });
    } finally {
      els.giveawaySpinBtn.disabled = false;
    }
  }

  async function refreshGiveaways() {
    try {
      const data = await api('/api/admin/giveaways?limit=30');
      const rows = data.giveaways || [];
      if (!rows.length) {
        els.giveawayBody.innerHTML =
          '<tr><td colspan="4" style="color:var(--muted)">No recorded giveaways yet</td></tr>';
        return;
      }
      els.giveawayBody.innerHTML = rows
        .map((g) => {
          const when = g.ts || g.recordedAt
            ? new Date(g.ts || g.recordedAt).toLocaleString()
            : '—';
          return (
            '<tr>' +
            '<td>' + escapeHtml(when) + '</td>' +
            '<td>' + escapeHtml(g.mode || '—') + '</td>' +
            '<td><strong>' + escapeHtml(g.winner || '—') + '</strong></td>' +
            '<td>' + escapeHtml(g.note || '—') + '</td>' +
            '</tr>'
          );
        })
        .join('');
    } catch (err) {
      els.giveawayBody.innerHTML =
        '<tr><td colspan="4">' + escapeHtml(err.message) + '</td></tr>';
    }
  }


  async function pushLiveReady() {
    const mode = els.giveawayMode.value === 'names' ? 'names' : 'prizes';
    const items = els.giveawayItems.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const body = {
      mode,
      note: els.giveawayNote.value.trim() || undefined,
    };
    if (items.length) body.items = items;
    if (mode === 'names' && items.length < 2) {
      showMsg(els.giveawayMsg, 'Paste at least 2 contestant names', false);
      return;
    }
    try {
      const data = await api('/api/admin/live/ready', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      showMsg(
        els.giveawayMsg,
        'Pushed to live watchers (' +
          (data.live?.items?.length || 0) +
          ' entries). Spin when ready.',
        true
      );
    } catch (err) {
      showMsg(els.giveawayMsg, err.message, false);
    }
  }

  async function clearLive() {
    try {
      await api('/api/admin/live/clear', {
        method: 'POST',
        body: '{}',
      });
      showMsg(els.giveawayMsg, 'Live giveaway cleared', true);
    } catch (err) {
      showMsg(els.giveawayMsg, err.message, false);
    }
  }

  async function copyProof() {
    try {
      await navigator.clipboard.writeText(els.giveawayProof.value || '');
      showMsg(els.giveawayMsg, 'Proof copied', true);
    } catch {
      els.giveawayProof.select();
      showMsg(els.giveawayMsg, 'Select + copy the proof manually', false);
    }
  }

    function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  els.spaceUrl.addEventListener('input', () => {
    spaceFieldSource = els.spaceUrl.value.trim() ? 'user' : 'auto';
  });
  els.spaceUrl.addEventListener('change', () => {
    const v = els.spaceUrl.value.trim();
    if (v) ssSet(SPACE_URL_KEY, v);
    else ssDel(SPACE_URL_KEY);
  });
  if (els.trackChange) {
    els.trackChange.addEventListener('click', () => {
      els.trackForm.classList.toggle('hidden');
      if (!els.trackForm.classList.contains('hidden')) els.trackInput.focus();
    });
    els.trackSave.addEventListener('click', saveMyHandle);
    els.trackInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveMyHandle(); });
  }
  // Load = names only (no spin). SPIN = spin only when tapped.
  els.refreshSpace.addEventListener('click', () => loadSpaceNames({ auto: false }));
  els.spaceGoLive.addEventListener('click', spinLoaded);
  els.savePrizes.addEventListener('click', savePrizes);
  els.mintBtn.addEventListener('click', mint);
  els.refreshTickets.addEventListener('click', refreshTickets);
  els.filterSite.addEventListener('change', refreshTickets);
  els.filterUnused.addEventListener('change', refreshTickets);
  els.giveawayMode.addEventListener('change', syncGiveawayModeLabel);
  // ── X DM claims panel ────────────────────────────────────────────────────
  const escH = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function loadClaimPrizes() {
    const sel = document.getElementById('claimPrize'); if (!sel) return;
    try {
      const d = await api('/api/admin/prizes');
      const list = (d.prizes || d || []).filter((p) => p && ['nft', 'token', 'shop_discount'].includes(p.type));
      const keep = sel.value;
      sel.innerHTML = '<option value="">No auto DM (just pick a winner)</option>' + list.map((p) => '<option value="' + escH(p.id) + '">' + escH(p.label) + ' (' + escH(p.type) + ')</option>').join('');
      sel.value = keep;
    } catch { /* ignore */ }
  }
  async function loadClaims() {
    const box = document.getElementById('claimsList'); if (!box) return;
    try {
      const d = await api('/api/admin/claims');
      const nx = d.nextReadInMs == null ? 'no open claims, no DM reads' : 'next DM check in ' + Math.round(d.nextReadInMs / 60000) + ' min';
      document.getElementById('claimsMeta').textContent = nx + ' · X usage this run: ' + (d.usage.chatSends || 0) + ' Chat sends, ' + (d.usage.chatReads || 0) + ' Chat reads, ' + d.usage.sends + ' DM sends, ' + d.usage.reads + ' DM reads, ' + d.usage.posts + ' posts · public posts: ' + d.publicPosts + (d.allowlist === 'on' ? ' · TEST allowlist on' : '');
      box.innerHTML = (d.claims || []).slice(0, 12).map((c) => {
        const due = c.status === 'scheduled' ? ' · DM in ' + Math.max(0, Math.round((c.dmDueAt - Date.now()) / 1000)) + 's' : '';
        const left = c.open ? ' · ' + Math.max(0, Math.round((c.expiresAt - Date.now()) / 3600000)) + 'h left to claim' : '';
        const alerts = (c.alerts || []).filter((a) => a.level !== 'info').map((a) => '<div style="color:#f87171">⚠️ ' + escH(a.text) + '</div>').join('')
          + (c.mention && c.mention.text && !c.mention.posted ? '<div class="hint">Draft @mention: ' + escH(c.mention.text) + ' <button type="button" class="btn-secondary" data-post-mention="' + escH(c.id) + '">Post @mention</button></div>' : '');
        const tx = c.tx && (c.tx.explorer ? '<a href="' + escH(c.tx.explorer) + '" target="_blank">tx</a>' : c.tx.shopCode ? 'shop code sent' : '');
        return '<div style="padding:0.4rem 0;border-top:1px solid var(--line)"><strong>@' + escH(c.handle) + '</strong> · ' + escH(c.prize.label) + '<br><span class="hint">' + escH(c.status) + due + left + (c.wallet ? ' · ' + escH(c.wallet.slice(0, 8)) + '…' : '') + '</span> ' + (c.mode === 'manual' ? ' <span style="color:#e6c35c">[MANUAL]</span>' : '') + (tx || '') + alerts + manualCard(c) + '</div>';
      }).join('') || '<div class="hint">No claims yet.</div>';
    } catch (e) { box.textContent = e.message; }
  }
  document.addEventListener('click', async (ev) => { const b = ev.target.closest && ev.target.closest('[data-post-mention]'); if (!b) return;
    if (!confirm('Post this @mention publicly from @GetOffMyLawn70?')) return; b.disabled = true;
    try { const d = await api('/api/admin/claims/' + encodeURIComponent(b.dataset.postMention) + '/post-mention', { method: 'POST', body: '{}' }); b.textContent = d.posted ? 'Posted' : 'Not posted (mode)'; loadClaims(); } catch (e) { b.textContent = e.message; } });
  // ── Auto/Manual giveaway switch (saved server-side) ──
  let gwMode = 'auto';
  function renderGwMode() {
    const on = (id, yes) => { const b = document.getElementById(id); if (b) { b.style.background = yes ? '#e6c35c' : '#111'; b.style.color = yes ? '#111' : '#ccc'; b.setAttribute('aria-pressed', yes ? 'true' : 'false'); } };
    on('gwAuto', gwMode === 'auto'); on('gwManual', gwMode === 'manual');
    const l = document.getElementById('gwModeLabel'); if (l) l.textContent = gwMode === 'manual' ? 'MANUAL (you choose the prize)' : 'AUTO (prize sent automatically)';
    const h = document.getElementById('gwModeHint'); if (h) h.textContent = gwMode === 'manual' ? 'Names only. Winner gets the claim code and is verified; nothing is sent until you choose.' : 'Prize below is DMd and sent automatically once the wallet checks out.';
    const sel = document.getElementById('claimPrize'); const lab = document.getElementById('claimPrizeLabel');
    if (sel) sel.style.display = gwMode === 'manual' ? 'none' : ''; if (lab) lab.style.display = gwMode === 'manual' ? 'none' : '';
  }
  async function loadGwMode() { try { gwMode = (await api('/api/admin/giveaway-mode')).mode; } catch {} renderGwMode(); }
  async function setGwMode(m) { if (m === gwMode) return; if (!confirm('Switch giveaway to ' + m.toUpperCase() + '?')) return; try { gwMode = (await api('/api/admin/giveaway-mode', { method: 'POST', body: JSON.stringify({ mode: m }) })).mode; } catch (e) { alert(e.message); } renderGwMode(); }
  const gA = document.getElementById('gwAuto'); if (gA) gA.addEventListener('click', () => setGwMode('auto'));
  const gM = document.getElementById('gwManual'); if (gM) gM.addEventListener('click', () => setGwMode('manual'));
  loadGwMode();
  let manualPrizeOpts = '';
  async function loadManualPrizes() { try { const d = await api('/api/admin/prizes'); manualPrizeOpts = (d.prizes || d || []).filter((p) => p && ['nft', 'token', 'shop_discount'].includes(p.type) && (p.type !== 'shop_discount' || (p.value >= 5 && p.value <= 15))).map((p) => '<option value="' + escH(p.id) + '">' + escH(p.label) + ' (' + escH(p.type) + ')</option>').join(''); } catch {} }
  loadManualPrizes();
  function manualCard(c) {
    if (c.mode !== 'manual') return '';
    if (c.status === 'verified_manual' || c.status === 'manual_self') {
      return '<div style="margin-top:0.4rem;padding:0.5rem;border:1px solid #22c55e;border-radius:8px;background:#06210f">'
        + '<div>✅ <strong>@' + escH(c.handle) + '</strong> verified, wallet:</div>'
        + '<input readonly value="' + escH(c.wallet) + '" style="width:100%;font-family:monospace;margin:0.3rem 0" onclick="this.select()" aria-label="Winner wallet">'
        + (c.status === 'verified_manual'
          ? '<select data-mp="' + escH(c.id) + '" style="width:100%"><option value="">Choose a prize for the bot to send…</option>' + manualPrizeOpts + '</select>'
            + '<div style="display:flex;gap:0.4rem;margin-top:0.35rem;flex-wrap:wrap"><button type="button" data-msend="' + escH(c.id) + '">Send this prize</button><button type="button" class="secondary" data-mself="' + escH(c.id) + '">I\'ll send it myself</button></div>'
          : '<div class="hint">You are sending it yourself.</div><input data-mwhat="' + escH(c.id) + '" placeholder="What you sent (optional)" style="width:100%;margin:0.3rem 0"><button type="button" data-mmark="' + escH(c.id) + '">Mark sent (sends ✅ to winner)</button>')
        + '</div>';
    }
    return '';
  }
  window.__manualCard = manualCard;
  document.addEventListener('click', async (ev) => {
    const t = ev.target; if (!t || !t.dataset) return;
    try {
      if (t.dataset.msend) { const sel = document.querySelector('[data-mp="' + t.dataset.msend + '"]'); if (!sel || !sel.value) return alert('Choose a prize first');
        if (!confirm('Send "' + sel.options[sel.selectedIndex].text + '" to this winner now?')) return; t.disabled = true;
        const d = await api('/api/admin/claims/' + encodeURIComponent(t.dataset.msend) + '/manual-send', { method: 'POST', body: JSON.stringify({ prizeId: sel.value }) });
        alert(d.ok ? 'Sent ✅' : 'Not sent: ' + (d.result || d.error) + (d.note ? '\n' + d.note : '')); loadClaims(); }
      else if (t.dataset.mself) { if (!confirm("You'll send the prize yourself?")) return; await api('/api/admin/claims/' + encodeURIComponent(t.dataset.mself) + '/self-send', { method: 'POST', body: '{}' }); loadClaims(); }
      else if (t.dataset.mmark) { if (!confirm('Mark as sent and message the winner ✅?')) return; t.disabled = true; const w = document.querySelector('[data-mwhat="' + t.dataset.mmark + '"]');
        await api('/api/admin/claims/' + encodeURIComponent(t.dataset.mmark) + '/mark-sent', { method: 'POST', body: JSON.stringify({ what: w ? w.value : '' }) }); loadClaims(); }
    } catch (e) { alert(e.message); t.disabled = false; }
  });
  // Read-only prize wallet view (Micheal Oct 15: "we need admin access to see whats in the prize wallet")
  const pwDet = document.getElementById('prizeWalletDetails');
  if (pwDet && window.PrizeWalletPanel) pwDet.addEventListener('toggle', () => {
    if (pwDet.open && !pwDet.dataset.loaded) { pwDet.dataset.loaded = '1'; window.PrizeWalletPanel.mount(document.getElementById('prizeWalletPanel'), { fetch: () => api('/api/admin/prize-wallet') }); }
  });
  const ckBtn = document.getElementById('claimsCheckDms');
  if (ckBtn) ckBtn.addEventListener('click', async () => { ckBtn.disabled = true; try { const d = await api('/api/admin/claims/check-dms', { method: 'POST', body: '{}' }); document.getElementById('claimsMeta').textContent = d.read ? 'Checked: ' + d.events + ' DMs, ' + (d.processed || []).length + ' new' : 'No read: ' + d.reason; } catch (e) { document.getElementById('claimsMeta').textContent = e.message; } finally { ckBtn.disabled = false; setTimeout(loadClaims, 1500); } });
  const eosD = document.getElementById('eosDraftBtn');
  if (eosD) eosD.addEventListener('click', async () => { const d = await api('/api/admin/end-of-show/draft'); document.getElementById('eosText').value = d.posts.join('\n\n---\n\n'); document.getElementById('eosMsg').textContent = d.winners + ' winners · mode: ' + d.mode + ' · review, then tap Post'; });
  const eosP = document.getElementById('eosPostBtn');
  if (eosP) eosP.addEventListener('click', async () => { const posts = document.getElementById('eosText').value.split(/\n\n---\n\n/).map((s) => s.trim()).filter(Boolean); if (!posts.length) return; if (!confirm('Post ' + posts.length + ' post(s) from @GetOffMyLawn70?')) return; const d = await api('/api/admin/end-of-show/post', { method: 'POST', body: JSON.stringify({ posts }) }); document.getElementById('eosMsg').textContent = d.results.map((r) => r.dryRun ? 'DRY-RUN saved (not posted)' : 'Posted ' + r.id).join(' · '); });
  loadClaimPrizes(); loadClaims(); setInterval(loadClaims, 15000);

  // ── Shop discount code card (shop.bwtz.online) ───────────────────────────
  let shopCur = null;
  function renderShopCard(sd) {
    const card = document.getElementById('shopCodeCard');
    if (!card) return;
    if (!sd) { card.classList.add('hidden'); return; }
    shopCur = sd;
    const $ = (id) => document.getElementById(id);
    card.classList.remove('hidden', 'ok', 'err');
    const minted = sd.status === 'minted' && sd.code;
    card.classList.add(minted ? 'ok' : 'err');
    $('shopCodeValue').textContent = minted ? sd.code : (sd.status === 'refused' || sd.status === 'conflict' ? 'Code refused' : 'Code pending, admin retry');
    $('shopCodeLine').textContent = minted ? (sd.percent + '% off · ' + (sd.shopLine || 'Use at shop.bwtz.online checkout')) : (sd.error || '');
    $('shopCodeStatus').textContent = minted ? ((sd.test ? 'TEST code (staging) · ' : '') + 'single-use' + (sd.expiresAt ? ' · expires ' + sd.expiresAt : '')) : ('status: ' + sd.status + (sd.httpStatus ? ' (' + sd.httpStatus + ')' : ''));
    $('shopCodeRetry').classList.toggle('hidden', minted || sd.status === 'refused' || sd.status === 'conflict');
    $('shopCodeCopyDm').classList.toggle('hidden', !minted);
    $('shopCodeDm').classList.toggle('hidden', !minted);
    $('shopCodeDm').value = sd.dmText || '';
  }
  const shopRetryBtn = document.getElementById('shopCodeRetry');
  if (shopRetryBtn) shopRetryBtn.addEventListener('click', async () => {
    if (!shopCur) return;
    shopRetryBtn.disabled = true;
    try {
      const d = await api('/api/admin/shop-discount/retry', { method: 'POST', body: JSON.stringify({ idemKey: shopCur.idemKey }) });
      renderShopCard(d.shopDiscount);
    } catch (e) { document.getElementById('shopCodeStatus').textContent = 'Retry failed: ' + e.message; }
    finally { shopRetryBtn.disabled = false; }
  });
  const shopCopyBtn = document.getElementById('shopCodeCopyDm');
  if (shopCopyBtn) shopCopyBtn.addEventListener('click', () => { try { navigator.clipboard.writeText(document.getElementById('shopCodeDm').value); shopCopyBtn.textContent = 'Copied ✓'; } catch { /* ignore */ } });
  const shopGenBtn = document.getElementById('shopGenBtn');
  if (shopGenBtn) shopGenBtn.addEventListener('click', async () => {
    shopGenBtn.disabled = true;
    try {
      const d = await api('/api/admin/shop-discount/mint', { method: 'POST', body: JSON.stringify({ percent: Number(document.getElementById('shopGenPct').value), winner: document.getElementById('shopGenWinner').value.trim() || undefined }) });
      renderShopCard(d.shopDiscount);
    } catch (e) { renderShopCard({ status: 'pending', error: e.message }); }
    finally { shopGenBtn.disabled = false; }
  });

  els.giveawaySpinBtn.addEventListener('click', spinGiveaway);
  els.giveawayUsePrizes.addEventListener('click', loadPrizesIntoGiveaway);
  if (els.giveawayPushLive) els.giveawayPushLive.addEventListener('click', pushLiveReady);
  if (els.giveawayClearLive) els.giveawayClearLive.addEventListener('click', clearLive);
  els.giveawayCopyProof.addEventListener('click', copyProof);

  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin) return;
    const data = ev.data;
    if (!data || data.type !== 'goml-admin-session') return;
    if (!rememberSession(data)) return;
    if (!els.app.classList.contains('hidden')) return;
    boot();
  });

  // ── Space watch-link auto-post from @GetOffMyLawn70 (Micheal Oct 18: "once I scrape the space you are to send a
  //    link to the spaces jumbo"; "Goml 70"; "I would rather bring traffic to the GOML website") ─────────────────
  const apBox = document.getElementById('autopostBox');
  const PIN_HINT = 'With the Space open: Share → Share to Space, then pin it';
  let lastApKey = '';
  function linkify(t) {
    return escH(t).replace(/(https:\/\/[^\s<]+)/g, '<span class="ap-link">$1</span>');
  }
  function renderAutopost(a, meta) {
    if (!apBox) return;
    if (!a || a.status === 'disabled' || a.status === 'skipped') { apBox.classList.add('hidden'); apBox.innerHTML = ''; lastApKey = ''; return; }
    apBox.classList.remove('hidden');
    let h = '';
    if (meta && meta.shared) {
      h += '<div style="font-size:.8rem;color:#94a3b8;margin-bottom:.3rem">Scraped by ' + (meta.scrapedBy ? '@' + escH(meta.scrapedBy) : 'another admin');
      if (meta.at) h += ' · ' + escH(new Date(meta.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      h += '</div>';
    }
    if (a.status === 'posted' || a.status === 'already') {
      armShareLink(a);
      h += '<div class="ap-title">' + (a.status === 'posted' ? '✅ Watch link posted from @GetOffMyLawn70' : '✅ Already posted for this Space (not posted again)') +
        (a.dryRun ? ' <span class="xc-badge">SIMULATION: not really posted</span>' : '') + '</div>';
      h += '<div class="ap-card"><div class="ap-card-head"><span class="ap-av">GOML</span><div><strong>GET OFF MY LAWN</strong><div class="ap-muted">@GetOffMyLawn70 · ' +
        escH(new Date(a.postedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</div></div><span class="ap-x">𝕏</span></div>' +
        '<div class="ap-card-text">' + linkify(a.text || '') + '</div>' +
        '<div class="ap-card-link"><div class="ap-muted">goml.xtremerippleprotocol.online</div><strong>🎡 GOML Prize Wheel: watch live</strong></div></div>';
      h += '<a class="ap-pin" href="' + escH(a.url) + '" target="_blank" rel="noopener">📌 Pin to Space</a>';
      h += '<div class="ap-hint">' + escH(PIN_HINT) + '</div>';
      h += '<div class="ap-copy"><input readonly id="apPostUrl" value="' + escH(a.url) + '" aria-label="Post link"><button type="button" data-ap="copy">Copy</button></div>';
      h += '<div class="ap-alt"><a href="' + escH(a.appUrl) + '">Open in the X app instead</a> · <a href="' + escH(a.watchUrl) + '" target="_blank" rel="noopener">Open watch page</a></div>';
      if (a.warning && !(meta && meta.shared)) h += '<div class="ap-warn">⚠️ ' + escH(a.warning) + '</div>';
      if (a.replies) {
        if (!document.getElementById('ap-replies-css')) {
          const st = document.createElement('style');
          st.id = 'ap-replies-css';
          st.textContent = '.ap-replies{margin-top:.6rem;font-size:.85rem}.ap-r{padding:.25rem 0}.ap-r a{color:#c4b5fd}';
          document.head.appendChild(st);
        }
        h += '<div class="ap-replies">';
        h += '<div style="font-weight:600;margin-bottom:.3rem">💬 Also replied under the Space post(s):</div>';
        if (a.replies.length === 0) {
          h += '<div class="ap-warn">No Space post found to reply under: paste one in "Space post URL" below and SCRAPE again.</div>';
        } else {
          a.replies.forEach((r) => {
            h += '<div class="ap-r">';
            h += '<a href="' + escH(r.parentUrl) + '" target="_blank" rel="noopener">';
            h += escH(r.username ? '@' + r.username + ' post' : 'Space post') + '</a> ';
            if (r.status === 'replied') {
              h += '✅ replied';
              if (r.replyUrl) h += ' · <a href="' + escH(r.replyUrl) + '" target="_blank" rel="noopener">view reply</a>';
            } else if (r.status === 'already') {
              h += '✅ already replied';
              if (r.replyUrl) h += ' · <a href="' + escH(r.replyUrl) + '" target="_blank" rel="noopener">view reply</a>';
            } else {
              h += '⚠️ ' + escH(r.error || r.status);
            }
            h += '</div>';
          });
        }
        if (a.replySearch && a.replySearch.error) {
          h += '<div style="font-size:.75rem;color:#94a3b8;margin-top:.3rem">Search: ' + escH(a.replySearch.error) + '</div>';
        }
        h += '</div>';
      }
    } else if (a.status === 'in_progress') {
      h += '<div class="ap-hint">Posting the watch link…</div>';
    } else {
      h += '<div class="ap-warn">⚠️ Watch link not posted: ' + escH(a.error || a.status) + '</div>';
    }
    apBox.innerHTML = h;
    lastApKey = (a.spaceId || '') + '|' + (a.url || '') + '|' + ((a.replies || []).length + (a.replies || []).map(r => r.status).join(','));
  }
  window.__gomlSpacePostUrl = () => (document.getElementById('spacePostUrl') || {}).value || '';
  async function pollLatest() {
    try {
      const res = await api('/api/admin/spaces/autopost-latest');
      if (res && res.ok && res.latest && res.latest.result && (Date.now() - new Date(res.latest.at).getTime()) < 6 * 3600 * 1000) {
        const l = res.latest;
        const newKey = (l.result.spaceId || '') + '|' + (l.result.url || '') + '|' + ((l.result.replies || []).length + (l.result.replies || []).map(r => r.status).join(','));
        if (newKey && newKey !== lastApKey) {
          renderAutopost(l.result, { scrapedBy: l.scrapedBy, at: l.at, shared: true });
        }
      }
    } catch { /* ignore */ }
  }
  setTimeout(pollLatest, 1500);
  setInterval(pollLatest, 10000);
  document.addEventListener('click', (ev) => {
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-ap="copy"]') : null;
    if (!t) return;
    const i = document.getElementById('apPostUrl');
    if (!i) return;
    i.select();
    const ok = () => { t.textContent = 'Copied ✓'; setTimeout(() => { t.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(i.value).then(ok, () => { document.execCommand('copy'); ok(); });
    else { document.execCommand('copy'); ok(); }
  });
  // ── Permanent Share Link button (Micheal Oct 23: "when i scrape it generates a link to the live prize wheel i send it
  //    to the space ... the wheel never spins on its own"). Pure client-side: share sheet / copy only, no spin. ──
  const WATCH_LINK = 'https://goml.xtremerippleprotocol.online/wheel/?watch=1';
  let shareArmed = false;
  let sharePostUrl = '';
  let shareWatchUrl = '';

  function armShareLink(a) {
    shareArmed = true;
    shareWatchUrl = (a && a.watchUrl) || WATCH_LINK;
    sharePostUrl = (a && (a.status === 'posted' || a.status === 'already') && a.url) || '';
  
    const btn = document.getElementById('shareLinkBtn');
    const status = document.getElementById('shareLinkStatus');
    const postLink = document.getElementById('shareLinkPost');
  
    btn.disabled = false;
    status.textContent = '✅ Ready: live wheel link' + (sharePostUrl ? ' + GOML post' : '');
  
    if (sharePostUrl) {
      postLink.href = sharePostUrl;
      postLink.classList.remove('hidden');
    } else {
      postLink.classList.add('hidden');
    }
  }

  window.__armShareLink = armShareLink;

  function getShareText() {
    let text = '🎡 Watch the GOML Prize Wheel spin live → ' + shareWatchUrl;
    if (sharePostUrl) {
      text += '\n' + sharePostUrl;
    }
    return text;
  }

  function showToast(message, duration) {
    const toast = document.getElementById('shareLinkToast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  }

  function fallbackCopy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return Promise.resolve();
      } catch (err) {
        document.body.removeChild(textarea);
        return Promise.reject(err);
      }
    }
  }

  document.getElementById('shareLinkBtn').addEventListener('click', async function() {
    const status = document.getElementById('shareLinkStatus');
  
    if (!shareArmed) {
      status.textContent = 'Scrape first';
      return;
    }
  
    const shareText = getShareText();
    const shareTextNoUrl = '🎡 Watch the GOML Prize Wheel spin live → ';
  
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'GOML Prize Wheel: watch live',
          text: shareTextNoUrl,
          url: shareWatchUrl
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          return;
        }
        try {
          await fallbackCopy(shareText);
          showToast('Copied ✓', 1800);
          status.textContent = 'Copied: paste it into the Space';
        } catch (copyErr) {
          console.error('Copy failed:', copyErr);
        }
      }
    } else {
      try {
        await fallbackCopy(shareText);
        showToast('Copied ✓', 1800);
        status.textContent = 'Copied: paste it into the Space';
      } catch (err) {
        console.error('Copy failed:', err);
      }
    }
  });

  adoptQueryTokens();
  boot();
})();
