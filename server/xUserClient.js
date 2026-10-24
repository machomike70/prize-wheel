'use strict';
/** Minimal OAuth1 (HMAC-SHA1) client for @GetOffMyLawn70. Credentials from env GOML70_X_*; never logged. */
const crypto = require('crypto');
const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function creds() {
  const c = { ck: process.env.GOML70_X_API_KEY, cs: process.env.GOML70_X_API_SECRET, t: process.env.GOML70_X_ACCESS_TOKEN, ts: process.env.GOML70_X_ACCESS_SECRET };
  return c.ck && c.cs && c.t && c.ts ? c : null;
}
function authHeader(method, url, c) {
  const u = new URL(url);
  const o = { oauth_consumer_key: c.ck, oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: c.t, oauth_version: '1.0' };
  const params = [...Object.entries(o), ...[...u.searchParams.entries()]].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] + '=' + a[1]).localeCompare(b[0] + '=' + b[1]));
  const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(params.map(([k, v]) => k + '=' + v).join('&'))].join('&');
  o.oauth_signature = crypto.createHmac('sha1', enc(c.cs) + '&' + enc(c.ts)).update(base).digest('base64');
  return 'OAuth ' + Object.entries(o).map(([k, v]) => enc(k) + '="' + enc(v) + '"').join(', ');
}
const usage = { reads: 0, sends: 0, posts: 0 };
async function call(method, url, body, kind) {
  const c = creds();
  if (!c) throw Object.assign(new Error('GOML70 credentials not configured'), { status: 503 });
  const r = await fetch(url, { method, headers: { Authorization: authHeader(method, url, c), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (kind) usage[kind]++;
  let j = null; try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) {
    const detail = j && (j.detail || j.title || (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].detail))) || ('HTTP ' + r.status);
    throw Object.assign(new Error(String(detail).slice(0, 200)), { status: r.status, body: j });
  }
  return j;
}
const API = 'https://api.x.com/2';
// ── X Chat (encrypted) via python Chat XDK bridge; keys from systemd credential ──
const { execFile } = require('child_process');
const BRIDGE = process.env.XCHAT_BRIDGE || require('path').join(__dirname, '..', 'xchat', 'xchat_bridge.py');
const PY = process.env.XCHAT_PYTHON || require('path').join(__dirname, '..', 'xchat', 'venv', 'bin', 'python');
function bridge(args, input) {
  return new Promise((resolve, reject) => {
    const ch = execFile(PY, [BRIDGE, ...args], { timeout: 60000, maxBuffer: 4 << 20 }, (err, stdout) => {
      let j = null; try { j = JSON.parse(String(stdout).trim().split('\n').pop()); } catch {}
      if (j && j.usage) { usage.chatReads = (usage.chatReads || 0) + j.usage.reads; usage.chatSends = (usage.chatSends || 0) + j.usage.sends; usage.keyLookups = (usage.keyLookups || 0) + j.usage.keyLookups; }
      if (!j) return reject(Object.assign(new Error('xchat bridge failed' + (err ? ': ' + String(err.message).split('\n')[0].slice(0, 160) : '')), { status: 0 }));
      resolve(j);
    });
    if (input != null) ch.stdin.end(input); else ch.stdin.end();
  });
}
module.exports = {
  chatEnabled: () => String(process.env.XCHAT_ENABLED || '') === 'true',
  chatHas: (peer) => bridge(['haschat', String(peer)]),
  chatRead: (peer, max) => bridge(['read', String(peer), String(max || 20)]),
  chatSend: (peer, text) => bridge(['send', String(peer)], text),
  configured: () => !!creds(),
  usage,
  me: () => call('GET', API + '/users/me', null, 'reads'),
  userByUsername: (u) => call('GET', API + '/users/by/username/' + encodeURIComponent(u), null, 'reads'),
  sendDm: (userId, text) => call('POST', API + '/dm_conversations/with/' + encodeURIComponent(userId) + '/messages', { text }, 'sends'),
  dmEvents: (paginationToken) => call('GET', API + '/dm_events?event_types=MessageCreate&max_results=50&dm_event.fields=id,text,sender_id,created_at,dm_conversation_id' + (paginationToken ? '&pagination_token=' + encodeURIComponent(paginationToken) : ''), null, 'reads'),
  post: (text) => call('POST', API + '/tweets', { text }, 'posts'),
  reply: (text, inReplyToTweetId) => call('POST', API + '/tweets', { text, reply: { in_reply_to_tweet_id: String(inReplyToTweetId) } }, 'posts'),
};
