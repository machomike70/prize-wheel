'use strict';
/**
 * Post giveaway scrape (Micheal Oct 24: "if I have a post and we get 100 likes would we be able to scrape the post
 * to get all the names into the wheel for the giveaway?" ... "a giveaway from any post. Any kind of engagement post").
 *
 * READ-ONLY X API v2 (app bearer): post lookup, liking_users, retweeted_by, optional replies via recent search
 * (conversation_id:<id>, last ~7 days only). Never posts, replies, DMs or spins. Poll voters are not exposed by X.
 */
const { X_BEARER_TOKEN } = require('./config');

const API = 'https://api.x.com/2';
const MAX_PAGES = 15; // 100 per page -> up to 1500 per list
const DEFAULT_EXCLUDE = ['getoffmylawn70', 'mmozley70'];

function parseTweetId(input) {
  const t = String(input || '').trim();
  if (/^\d{5,25}$/.test(t)) return t;
  const m = t.match(/(?:x|twitter)\.com\/(?:[A-Za-z0-9_]+|i(?:\/web)?)\/status(?:es)?\/(\d{5,25})/i);
  return m ? m[1] : null;
}

class XErr extends Error {
  constructor(msg, status, extra) { super(msg); this.status = status; Object.assign(this, extra || {}); }
}

/** User-context read (OAuth1 @GetOffMyLawn70) — X forbids app-only auth for liking_users. GET only. */
async function xgetUser(path) {
  const xu = require('./xUserClient');
  if (!xu.configured() || typeof xu.get !== 'function') throw new XErr('GOML user credentials not configured (needed to read likes)', 503);
  try {
    return await xu.get(API + path);
  } catch (e) {
    if (e.status === 429) throw new XErr('X rate limit hit on likes', 429, { rateLimited: true });
    throw new XErr('X API refused likes (' + (e.status || '?') + '): ' + e.message, e.status === 404 ? 404 : 502);
  }
}

async function xget(path, opts) {
  if (opts && opts.user) return xgetUser(path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(API + path, { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }, signal: ctrl.signal });
  } catch (e) {
    throw new XErr('X API unreachable (' + (e.name === 'AbortError' ? 'timeout' : e.message) + ')', 502);
  } finally { clearTimeout(timer); }
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) {
    const reset = Number(res.headers.get('x-rate-limit-reset')) || 0;
    throw new XErr('X rate limit hit' + (reset ? ' — resets ' + new Date(reset * 1000).toISOString() : ''), 429, { rateLimited: true, resetAt: reset ? new Date(reset * 1000).toISOString() : null });
  }
  if (res.status === 401 || res.status === 403) {
    throw new XErr('X API refused (' + res.status + '): ' + (body.detail || body.title || 'not authorized for this endpoint'), res.status);
  }
  if (!res.ok) throw new XErr('X API error ' + res.status + ': ' + (body.detail || body.title || 'unknown'), 502);
  return body;
}

/** Paginate a users list endpoint. Returns { users, pages, partial, error } and never throws for later pages. */
async function pageUsers(basePath, tokenParam, opts) {
  const users = [];
  let token = null; let pages = 0; let partial = false; let error = null; let rateLimited = false;
  do {
    const path = token ? basePath + (basePath.includes('?') ? '&' : '?') + tokenParam + '=' + encodeURIComponent(token) : basePath;
    let body;
    try {
      body = await xget(path, opts);
    } catch (e) {
      if (pages === 0) throw e;
      partial = true; error = e.message; rateLimited = !!e.rateLimited;
      break;
    }
    pages++;
    for (const u of body.data || []) users.push(u);
    token = (body.meta && body.meta.next_token) || null;
    if (pages >= MAX_PAGES && token) { partial = true; error = 'stopped after ' + MAX_PAGES + ' pages'; break; }
  } while (token);
  return { users, pages, partial, error, rateLimited };
}

async function searchReplies(tweetId) {
  const authors = new Map();
  let token = null; let pages = 0; let partial = false; let error = null;
  do {
    const path = `/tweets/search/recent?query=${encodeURIComponent('conversation_id:' + tweetId)}&max_results=100&expansions=author_id&user.fields=username,name` + (token ? '&next_token=' + encodeURIComponent(token) : '');
    let body;
    try { body = await xget(path); } catch (e) {
      partial = true; error = e.message; break;
    }
    pages++;
    const byId = new Map(((body.includes && body.includes.users) || []).map((u) => [u.id, u]));
    for (const t of body.data || []) {
      const u = byId.get(t.author_id);
      if (u) authors.set(u.id, u);
    }
    token = (body.meta && body.meta.next_token) || null;
    if (pages >= MAX_PAGES && token) { partial = true; error = 'stopped after ' + MAX_PAGES + ' pages'; break; }
  } while (token);
  return { users: [...authors.values()], pages, partial, error };
}

async function scrapePost(input, opts = {}) {
  if (!X_BEARER_TOKEN) throw new XErr('X bearer token not configured', 500);
  const tweetId = parseTweetId(input);
  if (!tweetId) throw new XErr('Paste an X post link like https://x.com/user/status/123…', 400);
  const includeReplies = opts.includeReplies === true;
  const excludeHosts = opts.excludeHosts !== false;

  const look = await xget(`/tweets/${tweetId}?tweet.fields=public_metrics,conversation_id,created_at,author_id&expansions=author_id&user.fields=username,name,protected`);
  if (!look.data) {
    const e0 = (look.errors || [])[0] || {};
    const type = String(e0.type || '');
    let msg = e0.detail || 'Post not found';
    if (/not-found/.test(type)) msg = 'Post not found — it may be deleted, or the link is wrong';
    else if (/not-authorized/.test(type)) msg = 'Post is protected/private — X does not let us read its likes';
    throw new XErr(msg, 404);
  }
  const post = look.data;
  const author = ((look.includes && look.includes.users) || []).find((u) => u.id === post.author_id) || {};
  const metrics = post.public_metrics || {};

  const likesR = await pageUsers(`/tweets/${tweetId}/liking_users?max_results=100&user.fields=username,name`, 'pagination_token', { user: true }).catch((e) => ({ users: [], pages: 0, partial: true, error: e.message, rateLimited: !!e.rateLimited }));
  const rtR = await pageUsers(`/tweets/${tweetId}/retweeted_by?max_results=100&user.fields=username,name`, 'pagination_token').catch((e) => ({ users: [], pages: 0, partial: true, error: e.message, rateLimited: !!e.rateLimited }));
  const repR = includeReplies ? await searchReplies(post.conversation_id || tweetId) : null;

  const excluded = new Set();
  if (author.username) excluded.add(author.username.toLowerCase());
  if (excludeHosts) DEFAULT_EXCLUDE.forEach((h) => excluded.add(h));

  const seen = new Set(); const names = []; const skipped = new Set();
  const add = (u) => {
    const h = String(u.username || '').trim();
    if (!h) return;
    const k = h.toLowerCase();
    if (excluded.has(k)) { skipped.add('@' + h); return; }
    if (seen.has(k)) return;
    seen.add(k); names.push('@' + h);
  };
  likesR.users.forEach(add); rtR.users.forEach(add); if (repR) repR.users.forEach(add);

  const warnings = [];
  const capNote = (label, got, expected, r) => {
    if (r.error) warnings.push(label + ': ' + r.error + (got ? ' (kept the ' + got + ' loaded so far)' : ''));
    if (label === 'Likes' && likesPrivate) return true;
    if (typeof expected === 'number' && got < expected) {
      warnings.push(`${label}: X returned ${got} of ${expected} (X hides some accounts — suspended/private/limits — or caps this list)`);
      return true;
    }
    return !!r.partial;
  };
  const likesPrivate = (metrics.like_count || 0) > 0 && likesR.users.length === 0 && String(author.username || '').toLowerCase() !== 'getoffmylawn70';
  if (likesPrivate) {
    warnings.push('Likes are private on X: only the account that wrote a post can see who liked it. Likes load for @GetOffMyLawn70 posts; for this post only reposts' + (includeReplies ? ' and replies' : '') + ' were loaded. Tip: run the giveaway from a @GetOffMyLawn70 post (or ask people to repost).');
    likesR.error = null;
  }
  const capped = {
    likes: capNote('Likes', likesR.users.length, metrics.like_count, likesR),
    reposts: capNote('Reposts', rtR.users.length, metrics.retweet_count, rtR),
    replies: repR ? capNote('Replies', repR.users.length, undefined, repR) : false,
  };
  if (repR) warnings.push('Replies come from X recent search: only replies from the last ~7 days are included.');
  const rateLimited = !!(likesR.rateLimited || rtR.rateLimited || (repR && /rate limit/i.test(repR.error || '')));

  return {
    ok: true,
    tweetId,
    url: `https://x.com/${author.username || 'i'}/status/${tweetId}`,
    author: author.username ? '@' + author.username : null,
    text: String(post.text || '').slice(0, 200),
    createdAt: post.created_at || null,
    metrics: { likes: metrics.like_count ?? null, reposts: metrics.retweet_count ?? null, replies: metrics.reply_count ?? null, quotes: metrics.quote_count ?? null },
    counts: { likes: likesR.users.length, reposts: rtR.users.length, replies: repR ? repR.users.length : null, unique: names.length },
    includeReplies,
    excluded: [...skipped],
    capped,
    likesPrivate,
    rateLimited,
    warnings,
    names,
  };
}

function mount(app, { requireAdmin, limiter }) {
  const mw = limiter ? [requireAdmin, limiter] : [requireAdmin];
  // Names only: NO spin, NO X post/reply. Admin spins manually with SPIN.
  app.post('/api/admin/post-giveaway/scrape', ...mw, async (req, res) => {
    try {
      const b = req.body || {};
      const out = await scrapePost(String(b.postUrl || '').slice(0, 400), { includeReplies: b.includeReplies === true, excludeHosts: b.excludeHosts !== false });
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Post scrape failed', rateLimited: !!e.rateLimited, resetAt: e.resetAt || undefined });
    }
  });
}

module.exports = { mount, parseTweetId, scrapePost };
