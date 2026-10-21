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
const { DATA_DIR } = require('./config');
const X = require('./xUserClient');

const HANDLE = 'GetOffMyLawn70';
const env = (k, d = '') => String(process.env[k] || d).trim();
const LIVE = () => env('AUTOPOST_MODE') === 'live';
const ENABLED = () => !/^(0|false|no|off)$/i.test(env('AUTOPOST_ENABLED', 'true'));
const WATCH_URL = () => env('AUTOPOST_WATCH_URL', 'https://goml.xtremerippleprotocol.online/wheel/?watch=1');
const postText = () => `🎡 Watch the GOML Prize Wheel spin live → ${WATCH_URL()}`;
const FILE = path.join(DATA_DIR, 'space-autopost.json');

function load() {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j && j.posts) return j; } catch { /* new */ }
  return { version: 1, posts: {} };
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
let postImpl = (text) => X.post(text); // overridable in tests

/** Never throws. tracking = { handle, userId } of the admin who tapped SCRAPE (for the on-stage warning). */
async function autopostAfterScrape(scrape, tracking) {
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
    const done = load().posts[spaceId];
    if (done) return { status: 'already', spaceId, tweetId: done.tweetId, ...links(done.tweetId), postedAt: done.at, dryRun: !!done.dryRun, ...base };
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
      const s = load();
      s.posts[spaceId] = { tweetId, at: new Date().toISOString(), dryRun: dryRun || undefined, by: tracking && tracking.handle ? tracking.handle : undefined };
      save(s);
      console.log(`[space-autopost] ${dryRun ? 'DRY-RUN ' : ''}watch link for Space ${spaceId} from @${HANDLE}`);
      return { status: 'posted', spaceId, tweetId, ...links(tweetId), postedAt: s.posts[spaceId].at, dryRun, ...base };
    } finally {
      inflight.delete(spaceId);
    }
  } catch (err) {
    console.warn('[space-autopost] failed:', err.message);
    return { status: 'error', error: err.message };
  }
}

module.exports = { autopostAfterScrape, postText, roleOf, _test: { load, FILE, setPost: (fn) => { postImpl = fn; } } };
