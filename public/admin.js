(() => {
  'use strict';

  const WALLET_TOKEN_KEY = 'goml_wallet_token';
  const ADMIN_TOKEN_KEY = 'goml_admin_token';
  const WALLET_ADDR_KEY = 'goml_wallet_addr';
  const WALLET_ROLE_KEY = 'goml_wallet_role';

  // When embedded under /wheel* on GOML, sessionStorage is same-origin.
  // Also accept ?token= for tooling (not shown in UI).
  const params = new URLSearchParams(location.search);

  function apiBase() {
    // Works both at / and behind handle_path /wheel*
    const path = location.pathname;
    if (path.startsWith('/wheel')) return '/wheel';
    return '';
  }

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const wallet =
      sessionStorage.getItem(WALLET_TOKEN_KEY) ||
      localStorage.getItem(WALLET_TOKEN_KEY) ||
      params.get('walletToken');
    const admin =
      sessionStorage.getItem(ADMIN_TOKEN_KEY) ||
      localStorage.getItem(ADMIN_TOKEN_KEY) ||
      params.get('adminToken');
    if (wallet) h['X-Wallet-Token'] = wallet;
    else if (admin) h['X-Admin-Token'] = admin;
    return h;
  }

  function hasCreds() {
    const h = authHeaders();
    return Boolean(h['X-Wallet-Token'] || h['X-Admin-Token']);
  }

  const els = {
    gate: document.getElementById('gate'),
    gateMsg: document.getElementById('gateMsg'),
    app: document.getElementById('app'),
    who: document.getElementById('who'),
    rolePill: document.getElementById('rolePill'),
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

  async function boot() {
    if (!hasCreds()) {
      els.gate.classList.remove('hidden');
      els.gateMsg.textContent = 'No GOML admin session found in this browser.';
      return;
    }
    try {
      const st = await api('/api/admin/status');
      els.app.classList.remove('hidden');
      const addr =
        sessionStorage.getItem(WALLET_ADDR_KEY) ||
        st.wallet ||
        'token login';
      els.who.textContent = addr;
      els.rolePill.textContent = st.role || 'admin-token';
      els.prizeList.value = (st.prizes || []).join('\n');
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
      ? 'Contestant names (one per line)'
      : 'Prizes (one per line; leave blank to use saved prize list)';
    els.giveawayItems.placeholder = names
      ? 'Alice\nBob\nCarol'
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

  els.savePrizes.addEventListener('click', savePrizes);
  els.mintBtn.addEventListener('click', mint);
  els.refreshTickets.addEventListener('click', refreshTickets);
  els.filterSite.addEventListener('change', refreshTickets);
  els.filterUnused.addEventListener('change', refreshTickets);
  els.giveawayMode.addEventListener('change', syncGiveawayModeLabel);
  els.giveawaySpinBtn.addEventListener('click', spinGiveaway);
  els.giveawayUsePrizes.addEventListener('click', loadPrizesIntoGiveaway);
  if (els.giveawayPushLive) els.giveawayPushLive.addEventListener('click', pushLiveReady);
  if (els.giveawayClearLive) els.giveawayClearLive.addEventListener('click', clearLive);
  els.giveawayCopyProof.addEventListener('click', copyProof);

  boot();
})();
