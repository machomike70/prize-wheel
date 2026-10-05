'use strict';

(() => {
  const sess = window.PrizeWheelAdminSession;
  const $ = (id) => document.getElementById(id);
  const base = () => (sess && sess.apiBase ? sess.apiBase() : '');
  let prizes = [];
  let types = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function msg(id, text, ok) { const el = $(id); el.textContent = text || ''; el.className = 'msg ' + (ok ? 'ok' : 'err'); }
  function out(id, text) { const el = $(id); el.textContent = text; el.classList.toggle('hidden', !text); }

  async function api(path, opts = {}) {
    const res = await fetch(base() + path, {
      ...opts,
      headers: { ...(sess ? sess.authHeaders() : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) },
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || res.statusText || 'Request failed'); e.status = res.status; throw e; }
    return data;
  }

  function effect(p) {
    const d = p.discount;
    if (d && d.type === 'percent') return d.value + '% off merch';
    if (d && d.type === 'fixed_cents') return '$' + (d.value / 100).toFixed(2) + ' off merch';
    if (d && d.type === 'free_shipping') return 'Shipping $0';
    if (d && d.type === 'free_item') return 'Free item' + (d.sku ? ' (' + d.sku + ')' : '');
    if (p.type === 'xrp') return 'XRP payment (testnet)';
    if (p.type === 'none') return '—';
    return 'Manual fulfilment';
  }

  function renderPrizes() {
    $('prizeRows').innerHTML = prizes.map((p) => (
      `<tr class="${p.enabled ? '' : 'disabled'}">` +
      `<td><input type="checkbox" data-toggle="${esc(p.id)}" ${p.enabled ? 'checked' : ''} /></td>` +
      `<td>${esc(p.label)}<div class="note mono">${esc(p.id)}</div></td>` +
      `<td><span class="pill">${esc(p.type)}</span></td>` +
      `<td>${p.value == null ? '' : esc(p.value)}${p.sku ? '<div class="note">' + esc(p.sku) + '</div>' : ''}</td>` +
      `<td>${esc(effect(p))}</td>` +
      `<td><button class="secondary small" data-edit="${esc(p.id)}">Edit</button> ` +
      `<button class="danger small" data-del="${esc(p.id)}">Delete</button></td></tr>`
    )).join('') || '<tr><td colspan="6">No prizes</td></tr>';
    $('iPrize').innerHTML = prizes.filter((p) => p.type !== 'none')
      .map((p) => `<option value="${esc(p.id)}">${esc(p.label)}${p.enabled ? '' : ' (off wheel)'}</option>`).join('');
  }

  async function loadPrizes() {
    const data = await api('/api/admin/prizes');
    prizes = data.prizes || [];
    types = data.types || [];
    $('fType').innerHTML = types.map((t) => `<option value="${esc(t.id)}">${esc(t.id)} — ${esc(t.label)}</option>`).join('');
    renderPrizes();
    syncValueField();
  }

  function syncValueField() {
    const t = $('fType').value;
    const lbl = t === 'percent' ? 'Percent off (1–100)' : t === 'fixed' ? 'USD off (e.g. 5)' : t === 'token' ? 'Amount (optional)' : 'Value (not needed)';
    $('fValueLabel').textContent = lbl;
  }

  function resetForm() {
    $('editId').value = ''; $('fLabel').value = ''; $('fValue').value = ''; $('fSku').value = ''; $('fNote').value = '';
    $('fEnabled').checked = true; $('formTitle').textContent = '2 · Add a prize code';
    $('saveBtn').textContent = 'Add prize'; $('cancelEditBtn').classList.add('hidden');
  }

  async function savePrize() {
    const body = {
      label: $('fLabel').value.trim(),
      type: $('fType').value,
      value: $('fValue').value === '' ? null : Number($('fValue').value),
      sku: $('fSku').value.trim(),
      note: $('fNote').value.trim(),
      enabled: $('fEnabled').checked,
    };
    const id = $('editId').value;
    try {
      const data = id
        ? await api('/api/admin/prizes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(body) })
        : await api('/api/admin/prizes', { method: 'POST', body: JSON.stringify(body) });
      msg('formMsg', (id ? 'Saved ' : 'Added ') + data.prize.label + ' (' + data.prize.id + ')', true);
      resetForm();
      await loadPrizes();
    } catch (e) { msg('formMsg', e.message, false); }
  }

  function startEdit(id) {
    const p = prizes.find((x) => x.id === id); if (!p) return;
    $('editId').value = p.id; $('fLabel').value = p.label; $('fType').value = p.type;
    $('fValue').value = p.value == null ? '' : p.value; $('fSku').value = p.sku || ''; $('fEnabled').checked = p.enabled;
    $('formTitle').textContent = '2 · Edit prize'; $('saveBtn').textContent = 'Save changes';
    $('cancelEditBtn').classList.remove('hidden'); syncValueField();
    $('fLabel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function toggle(id, enabled) {
    try { await api('/api/admin/prizes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ enabled }) }); msg('listMsg', 'Updated', true); }
    catch (e) { msg('listMsg', e.message, false); }
    await loadPrizes();
  }

  async function del(id) {
    const p = prizes.find((x) => x.id === id);
    if (!confirm('Delete prize "' + (p ? p.label : id) + '"? Existing codes keep working.')) return;
    try { await api('/api/admin/prizes/' + encodeURIComponent(id), { method: 'DELETE' }); msg('listMsg', 'Deleted', true); }
    catch (e) { msg('listMsg', e.message, false); }
    await loadPrizes();
  }

  async function issue() {
    try {
      const data = await api('/api/admin/prize-codes', { method: 'POST', body: JSON.stringify({
        prizeId: $('iPrize').value, count: Number($('iCount').value) || 1, site: $('iSite').value, orderId: $('iOrder').value.trim() || undefined,
      }) });
      const codes = (data.codes && data.codes.length ? data.codes : data.redeemCodes) || [];
      msg('issueMsg', 'Issued ' + codes.length + ' code(s) for ' + data.prize.label + (data.notice ? '\n' + data.notice : ''), true);
      out('issueOut', codes.join('\n'));
      loadRecent();
    } catch (e) { msg('issueMsg', e.message, false); out('issueOut', ''); }
  }

  async function mint() {
    try {
      const data = await api('/api/tickets', { method: 'POST', body: JSON.stringify({
        site: $('tSite').value, count: Number($('tCount').value) || 1, orderId: $('tOrder').value.trim() || undefined,
      }) });
      const origin = location.origin + base();
      const lines = (data.tickets || []).map((t) => t.code + '   ' + origin + '/?code=' + encodeURIComponent(t.code) + '&mode=prizes&site=' + t.site);
      msg('mintMsg', 'Minted ' + lines.length + ' spin ticket(s)', true);
      out('mintOut', lines.join('\n'));
      loadRecent();
    } catch (e) { msg('mintMsg', e.message, false); out('mintOut', ''); }
  }

  function cents(id) { const v = Number($(id).value); return Number.isFinite(v) ? Math.round(v * 100) : 0; }
  function describe(t) {
    const lines = ['Code: ' + t.code + '  (site ' + t.site + ')'];
    if (!t.used) lines.push('Status: NOT SPUN yet (spin ticket)');
    else {
      lines.push('Prize: ' + (t.prizeResult ? t.prizeResult.label : '?') + '  [' + t.prizeType + ']  via ' + (t.source || 'spin'));
      lines.push('Redeemed: ' + (t.redeemed ? 'YES ' + new Date(t.redeemedAt).toLocaleString() + (t.redeemedOrderId ? ' order ' + t.redeemedOrderId : '') : 'no'));
      if (t.quote) lines.push('Quote: merch $' + (t.quote.subtotalCents / 100).toFixed(2) + ' · shipping $' + (t.quote.shippingCents / 100).toFixed(2) + ' · saved $' + (t.quote.discountCents / 100).toFixed(2));
      if (t.discount && t.discount.type === 'free_item') lines.push('Free item: ' + (t.discount.sku || t.discount.label) + ' — add to order at fulfilment');
      if (t.ledgerRedeemCode) lines.push('XRP redeem code: ' + t.ledgerRedeemCode + ' (winner redeems at /redeem.html)');
    }
    return lines.join('\n');
  }

  async function lookup() {
    const code = $('rCode').value.trim(); if (!code) return msg('redeemMsg', 'Enter a code', false);
    try {
      const t = await api('/api/tickets/lookup?code=' + encodeURIComponent(code) + '&subtotalCents=' + cents('rSub') + '&shippingCents=' + cents('rShip'));
      msg('redeemMsg', 'Found', true); out('redeemOut', describe(t));
    } catch (e) { msg('redeemMsg', e.message, false); out('redeemOut', ''); }
  }

  async function redeem() {
    const code = $('rCode').value.trim(); if (!code) return msg('redeemMsg', 'Enter a code', false);
    try {
      const data = await api('/api/admin/prize-codes/redeem', { method: 'POST', body: JSON.stringify({
        code, orderId: $('rOrder').value.trim() || undefined, subtotalCents: cents('rSub'), shippingCents: cents('rShip'),
      }) });
      msg('redeemMsg', 'Redeemed ✔', true); out('redeemOut', describe(data.ticket)); loadRecent();
    } catch (e) { msg('redeemMsg', e.message, false); }
  }

  async function loadRecent() {
    try {
      const data = await api('/api/tickets?limit=25');
      $('recentRows').innerHTML = (data.tickets || []).map((t) => (
        `<tr><td class="mono">${esc(t.code)}</td><td>${esc(t.site)}</td>` +
        `<td>${esc(t.prizeResult ? t.prizeResult.label : '—')}</td>` +
        `<td>${t.redeemed ? 'redeemed' : t.used ? (t.prizeType === 'none' ? 'no prize' : 'won · open') : 'unspun ticket'}</td>` +
        `<td>${t.createdAt ? esc(new Date(t.createdAt).toLocaleString()) : ''}</td></tr>`
      )).join('');
    } catch (e) { /* ignore */ }
  }

  async function unlock(token) {
    if (token && sess) sess.saveAdminToken(token);
    try {
      await loadPrizes();
      $('gate').classList.add('hidden'); $('main').classList.remove('hidden'); msg('gateMsg', '');
      loadRecent();
    } catch (e) {
      msg('gateMsg', e.status === 403 ? 'Wrong admin token' : e.message, false);
      if (e.status === 403 && sess) sess.clearAdminToken();
    }
  }

  $('authBtn').addEventListener('click', () => unlock($('tokenInput').value.trim()));
  $('tokenInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock($('tokenInput').value.trim()); });
  $('fType').addEventListener('change', syncValueField);
  $('saveBtn').addEventListener('click', savePrize);
  $('cancelEditBtn').addEventListener('click', resetForm);
  $('issueBtn').addEventListener('click', issue);
  $('mintBtn').addEventListener('click', mint);
  $('lookupBtn').addEventListener('click', lookup);
  $('redeemBtn').addEventListener('click', redeem);
  $('recentBtn').addEventListener('click', loadRecent);
  $('prizeRows').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'); if (ed) return startEdit(ed.dataset.edit);
    const dl = e.target.closest('[data-del]'); if (dl) return del(dl.dataset.del);
  });
  $('prizeRows').addEventListener('change', (e) => {
    const tg = e.target.closest('[data-toggle]'); if (tg) toggle(tg.dataset.toggle, tg.checked);
  });

  if (sess && sess.hasAdminToken()) unlock();
})();
