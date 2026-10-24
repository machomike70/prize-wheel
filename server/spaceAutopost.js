'use strict';

/**
 * Space watch-link auto-post from @GetOffMyLawn70 (Micheal, Oct 18 2026):
 *   "once I scrape the space you are to send a link to the spaces jumbo so the active listeners can watch the spin live"
 *   "Goml 70" · "I would rather bring traffic to the GOML website"
 * On a successful SCRAPE by any GOML admin: ONE post per Space ID from @GetOffMyLawn70 (existing GOML70 OAuth1 user
 * tokens via xUserClient; never logged). X has no API to add a post to a Space, so the admin then taps
 * "Pin to Space" (Share → Share to Space) in the X app.
 * AUTOPOST_MODE=live posts for real; anything else (default) = dry-run simulation (no X call).
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR, X_BEARER_TOKEN } = require('./config');
const X = require('./xUserClient');

const HANDLE = 'GetOffMyLawn70';
const env = (k, d = '') => String(process.env[k] || d).trim();
const LIVE = () => env('AUTOPOST_MODE') === 'live';
const ENABLED = () => !/^(0|false|no|off)$/i.test(env('AUTOPOST_ENABLED', 'true'));
const REPLY_ENABLED = () => !/^(0|false|no|off)$/i.test(env('AUTOPOST_REPLY_ENABLED', 'true'));
const WATCH_URL = () => env('AUTOPOST_WATCH_URL', 'https://goml.xtremerippleprotocol.online/wheel/?watch=1');
const postText = () => `🎡 Watch the GOML Prize Wheel spin live → ${WATCH_URL()}`;
const FILE = path.join(DATA_DIR, 'space-autopost.json');

function load() {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j && j.posts) return j; } catch { /* new */ }
  return { version: 1, posts: {}, latest: null };
}
function save(s) {
  const tmp = FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, FILE);
}
const links = (id) => ({ url: `https://x.com/${HANDLE}/status/${id}`, appUrl: `twitter://status?id=${id}` });

function roleOf(scrape, userId) {
  if (!userId || !scrape) return null;
  if ((scrape.hosts || []).some((u) => String(u.id) === String(userId))) return 'host';
  if ((scrape.speakers || []).some((u) => String(u.id) === String(userId))) return 'speaker';
  return 'listener';
}

const inflight = new Set();
let postImpl = (text) => X.post(text);
let replyImpl = (text, inReplyToTweetId) => X.reply(text, inReplyToTweetId);
let searchImpl = async (spaceId) => {
  if (!X_BEARER_TOKEN) return { posts: [], error: 'no X bearer configured' };
  const query = encodeURIComponent(`url:"${spaceId}" -is:retweet`);
  const url = `https://api.x.com/2/tweets/search/recent?query=${query}&max_results=25&tweet.fields=author_id,entities,created_at,reply_settings&expansions=author_id&user.fields=username`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } });
  if (!res.ok) throw new Error(`X search ${res.status}`);
  return res.json();
};

function parseStatusId(urlOrId) {
  if (!urlOrId) return null;
  const m = String(urlOrId).match(/\/status\/(\d+)/);
  if (m) return { id: m[1], username: String(urlOrId).match(/x\.com\/([^\/]+)\/status/)?.[1] };
  if (/^\d+$/.test(String(urlOrId).trim())) return { id: String(urlOrId).trim(), username: null };
  return null;
}

async function findSpacePosts(spaceId, scrape, excludeIds) {
  try {
    const data = await searchImpl(spaceId);
    if (!data || !data.data) return { posts: [], error: data.error || data.errors?.[0]?.message };
    const users = (data.includes?.users || []).reduce((m, u) => (m[u.id] = u, m), {});
    const hostIds = new Set();
    (scrape.hosts || []).forEach((h) => hostIds.add(String(h.id)));
    if (scrape.spaceData?.creator_id) hostIds.add(String(scrape.spaceData.creator_id));
    (scrape.spaceData?.host_ids || []).forEach((id) => hostIds.add(String(id)));
    const allowedUsernames = ['mmozley70', 'getoffmylawn70'];
    const exclude = new Set(excludeIds || []);
    const posts = (data.data || [])
      .filter((t) => {
        if (exclude.has(t.id)) return false;
        const hasSpaceUrl = (t.entities?.urls || []).some((u) =>
          (u.expanded_url || u.unwound_url || '').includes('/i/spaces/' + spaceId)
        );
        if (!hasSpaceUrl) return false;
        const author = users[t.author_id];
        if (hostIds.has(t.author_id)) return true;
        if (author && allowedUsernames.includes(author.username.toLowerCase())) return true;
        return false;
      })
      .map((t) => ({
        id: t.id,
        authorId: t.author_id,
        username: users[t.author_id]?.username,
        replySettings: t.reply_settings,
        createdAt: t.created_at,
      }))
      .sort((a, b) => {
        try {
          return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
        } catch {
          return new Date(b.createdAt) - new Date(a.createdAt);
        }
      });
    const max = Number(env('AUTOPOST_REPLY_MAX', '10'));
    return { posts: posts.slice(0, max) };
  } catch (err) {
    return { posts: [], error: err.message };
  }
}

/** Never throws. tracking = { handle, userId } of the admin who tapped SCRAPE (for the on-stage warning). */
async function autopostAfterScrape(scrape, tracking, opts = {}) {
  try {
    if (!ENABLED()) return { status: 'disabled' };
    const spaceId = scrape && scrape.spaceId;
    if (!spaceId) return { status: 'skipped', error: 'no Space id' };
    const role = roleOf(scrape, tracking && tracking.userId);
    const who = tracking && tracking.handle ? '@' + tracking.handle : 'You';
    const warning = role === 'listener'
      ? `${who} ${tracking && tracking.handle ? 'is' : 'are'} not host, co-host or speaker in this Space. X only lets hosts/co-hosts/speakers Share to Space: get added as a speaker, or ask a host to pin it.`
      : (!tracking || !tracking.userId ? 'Could not check if you are on stage (set "Tracking" to your X handle). Only hosts/co-hosts/speakers can Share to Space.' : undefined);
    const base = { handle: HANDLE, text: postText(), watchUrl: WATCH_URL(), role, warning };
    const s = load();
    const done = s.posts[spaceId];
    if (done && done.tweetId) {
      const result = { status: 'already', spaceId, tweetId: done.tweetId, ...links(done.tweetId), postedAt: done.at, dryRun: !!done.dryRun, ...base };
      if (inflight.has('r:' + spaceId)) return { ...result, replies: undefined, replyNote: 'Replies in progress' };
      inflight.add('r:' + spaceId);
      try {
        const finalResult = { ...result, ...(await processReplies(spaceId, scrape, done.tweetId, tracking, opts, s)) };
        saveLatest(spaceId, tracking, finalResult);
        return finalResult;
      } finally { inflight.delete('r:' + spaceId); }
    }
    if (inflight.has(spaceId)) return { status: 'in_progress', spaceId, ...base };
    inflight.add(spaceId);
    try {
      let tweetId;
      const dryRun = !LIVE();
      if (dryRun) {
        tweetId = 'sim' + Date.now();
        try { fs.appendFileSync(path.join(DATA_DIR, 'x-dryrun.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind: 'space-autopost', from: '@' + HANDLE, spaceId, text: postText() }) + '\n'); } catch { /* ignore */ }
      } else {
        if (!X.configured()) return { status: 'error', error: 'GOML70 X credentials not configured', ...base };
        const j = await postImpl(postText());
        tweetId = j && j.data && j.data.id;
        if (!tweetId) throw new Error('X did not return a post id');
      }
      const s2 = load();
      if (!s2.posts[spaceId]) s2.posts[spaceId] = { replies: {} };
      s2.posts[spaceId].tweetId = tweetId;
      s2.posts[spaceId].at = new Date().toISOString();
      s2.posts[spaceId].dryRun = dryRun || undefined;
      s2.posts[spaceId].by = tracking && tracking.handle ? tracking.handle : undefined;
      save(s2);
      console.log(`[space-autopost] ${dryRun ? 'DRY-RUN ' : ''}watch link for Space ${spaceId} from @${HANDLE}`);
      const result = { status: 'posted', spaceId, tweetId, ...links(tweetId), postedAt: s2.posts[spaceId].at, dryRun, ...base };
      const replyResult = await processReplies(spaceId, scrape, tweetId, tracking, opts, s2);
      const finalResult = { ...result, ...replyResult };
      saveLatest(spaceId, tracking, finalResult);
      return finalResult;
    } finally {
      inflight.delete(spaceId);
    }
  } catch (err) {
    console.warn('[space-autopost] failed:', err.message);
    return { status: 'error', error: err.message };
  }
}

function saveLatest(spaceId, tracking, finalResult) {
  try {
    const s3 = load();
    s3.latest = { spaceId, at: new Date().toISOString(), scrapedBy: (tracking && tracking.handle) || null, result: stripResult(finalResult) };
    save(s3);
  } catch (e) { console.warn('[space-autopost] latest save failed:', e.message); }
}

function stripResult(r) {
  const { role, warning, ...rest } = r;
  return rest;
}

async function processReplies(spaceId, scrape, excludeId, tracking, opts, s) {
  if (!REPLY_ENABLED()) return {};
  const search = await findSpacePosts(spaceId, scrape, [excludeId]);
  const parents = [...(search.posts || [])];
  const pasted = parseStatusId(opts.spacePostUrl);
  if (pasted && pasted.id && !parents.some((p) => p.id === pasted.id)) {
    parents.push({ id: pasted.id, username: pasted.username || null, source: 'pasted' });
  }
  parents.forEach((p) => { if (!p.source) p.source = 'search'; });
  const replies = [];
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i];
    const parentUrl = `https://x.com/${p.username || 'i'}/status/${p.id}`;
    const item = { parentId: p.id, parentUrl, username: p.username, source: p.source };
    const existing = (s.posts[spaceId]?.replies || {})[p.id];
    if (existing && existing.replyId) {
      item.status = 'already';
      item.replyId = existing.replyId;
      item.replyUrl = `https://x.com/GetOffMyLawn70/status/${existing.replyId}`;
      replies.push(item);
      continue;
    }
    if (p.replySettings && p.replySettings !== 'everyone' && (p.username || '').toLowerCase() !== 'getoffmylawn70') {
      item.status = 'skipped';
      item.error = `Replies are limited on this post (@${p.username || 'unknown'})`;
      replies.push(item);
      continue;
    }
    try {
      const dryRun = !LIVE();
      let replyId;
      if (dryRun) {
        replyId = 'simr' + Date.now() + i;
        try { fs.appendFileSync(path.join(DATA_DIR, 'x-dryrun.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind: 'space-reply', from: '@GetOffMyLawn70', spaceId, parentId: p.id, text: postText() }) + '\n'); } catch { /* ignore */ }
      } else {
        const j = await replyImpl(postText(), p.id);
        replyId = j && j.data && j.data.id;
        if (!replyId) throw new Error('X did not return a reply id');
      }
      const s2 = load();
      if (!s2.posts[spaceId]) s2.posts[spaceId] = { replies: {} };
      if (!s2.posts[spaceId].replies) s2.posts[spaceId].replies = {};
      s2.posts[spaceId].replies[p.id] = { replyId, at: new Date().toISOString(), dryRun: dryRun || undefined, by: tracking && tracking.handle || undefined };
      save(s2);
      console.log(`[space-autopost] ${dryRun ? 'DRY-RUN ' : ''}reply to ${p.id} for Space ${spaceId}`);
      item.status = 'replied';
      item.replyId = replyId;
      item.replyUrl = `https://x.com/GetOffMyLawn70/status/${replyId}`;
      replies.push(item);
    } catch (err) {
      console.warn(`[space-autopost] reply to ${p.id} failed:`, err.message);
      item.status = 'error';
      item.error = err.message;
      replies.push(item);
    }
  }
  return { replies, replySearch: { found: search.posts?.length || 0, error: search.error } };
}

function getLatest() {
  return load().latest || null;
}

module.exports = { autopostAfterScrape, postText, roleOf, getLatest, _test: { load, FILE, setPost: (fn) => { postImpl = fn; }, setReply: (fn) => { replyImpl = fn; }, setSearch: (fn) => { searchImpl = fn; } } };
