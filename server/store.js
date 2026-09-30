'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

const DEFAULT_PRIZES = ['10% Off', 'Free Shipping', 'Mystery Gift', 'Try Again'];
const MAX_GIVEAWAYS = 200;
/** Match client SPIN_DURATION (seconds) */
const LIVE_SPIN_DURATION_MS = 8500;

/** @type {{ tickets: object[], prizes: string[], giveaways: object[], live: object|null, updatedAt: number } | null} */
let cache = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function emptyLive() {
  return {
    id: null,
    status: 'idle',
    mode: null,
    items: [],
    index: null,
    winner: null,
    nonce: null,
    ts: null,
    signature: null,
    note: null,
    startedAt: null,
    durationMs: LIVE_SPIN_DURATION_MS,
    adminWallet: null,
    updatedAt: Date.now(),
  };
}

function defaultStore() {
  return {
    tickets: [],
    prizes: DEFAULT_PRIZES.slice(),
    giveaways: [],
    live: emptyLive(),
    updatedAt: Date.now(),
  };
}

function normalizeLive(raw) {
  if (!raw || typeof raw !== 'object') return emptyLive();
  return {
    id: raw.id || null,
    status:
      raw.status === 'ready' || raw.status === 'spinning' || raw.status === 'done'
        ? raw.status
        : 'idle',
    mode: raw.mode === 'names' || raw.mode === 'prizes' ? raw.mode : null,
    items: Array.isArray(raw.items) ? raw.items.map(String) : [],
    index: Number.isInteger(raw.index) ? raw.index : null,
    winner: raw.winner != null ? String(raw.winner) : null,
    nonce: raw.nonce || null,
    ts: Number.isFinite(raw.ts) ? raw.ts : null,
    signature: raw.signature || null,
    note: raw.note ? String(raw.note).slice(0, 200) : null,
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : null,
    durationMs: Number.isFinite(raw.durationMs) ? raw.durationMs : LIVE_SPIN_DURATION_MS,
    adminWallet: raw.adminWallet || null,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

function load() {
  if (cache) return cache;
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) {
    cache = defaultStore();
    persist(cache);
    return cache;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      prizes:
        Array.isArray(parsed.prizes) && parsed.prizes.length
          ? parsed.prizes.map(String)
          : DEFAULT_PRIZES.slice(),
      giveaways: Array.isArray(parsed.giveaways) ? parsed.giveaways : [],
      live: normalizeLive(parsed.live),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    cache = defaultStore();
    persist(cache);
  }
  return cache;
}

function persist(store) {
  ensureDir();
  store.updatedAt = Date.now();
  const tmp = STORE_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH);
  cache = store;
}

/**
 * Mutate store synchronously (atomic within single Node process).
 * @template T
 * @param {(store: object) => T} fn
 * @returns {T}
 */
function update(fn) {
  const store = load();
  const result = fn(store);
  persist(store);
  return result;
}

function getPrizes() {
  return load().prizes.slice();
}

function setPrizes(items) {
  return update((store) => {
    store.prizes = items.map((x) => String(x).trim()).filter((s) => s.length > 0);
    return store.prizes.slice();
  });
}

/**
 * Record an admin giveaway spin result (optional).
 * @param {{ mode: string, winner: string, index: number, nonce: string, ts: number, signature: string, note?: string, adminWallet?: string, itemsCount?: number }} entry
 */
function recordGiveaway(entry) {
  return update((store) => {
    if (!Array.isArray(store.giveaways)) store.giveaways = [];
    const row = {
      id: 'gw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      mode: entry.mode,
      winner: entry.winner,
      index: entry.index,
      nonce: entry.nonce,
      ts: entry.ts,
      signature: entry.signature,
      note: entry.note ? String(entry.note).slice(0, 200) : null,
      adminWallet: entry.adminWallet || null,
      itemsCount: entry.itemsCount || null,
      recordedAt: Date.now(),
    };
    store.giveaways.unshift(row);
    if (store.giveaways.length > MAX_GIVEAWAYS) {
      store.giveaways = store.giveaways.slice(0, MAX_GIVEAWAYS);
    }
    return row;
  });
}

function listGiveaways(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return load().giveaways.slice(0, n);
}

function getLive() {
  const live = normalizeLive(load().live);
  // Auto-flip spinning → done after duration so late joiners see final state
  if (
    live.status === 'spinning' &&
    live.startedAt &&
    Date.now() - live.startedAt >= (live.durationMs || LIVE_SPIN_DURATION_MS)
  ) {
    return update((store) => {
      const cur = normalizeLive(store.live);
      if (cur.status === 'spinning') {
        cur.status = 'done';
        cur.updatedAt = Date.now();
        store.live = cur;
      }
      return normalizeLive(store.live);
    });
  }
  return live;
}

/**
 * Stage contestant/prize list for public watchers (no winner yet).
 * @param {{ mode: string, items: string[], note?: string, adminWallet?: string|null }} opts
 */
function setLiveReady(opts) {
  return update((store) => {
    const id =
      'live_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    store.live = {
      id,
      status: 'ready',
      mode: opts.mode,
      items: opts.items.slice(),
      index: null,
      winner: null,
      nonce: null,
      ts: null,
      signature: null,
      note: opts.note ? String(opts.note).slice(0, 200) : null,
      startedAt: null,
      durationMs: LIVE_SPIN_DURATION_MS,
      adminWallet: opts.adminWallet || null,
      updatedAt: Date.now(),
    };
    return normalizeLive(store.live);
  });
}

/**
 * Publish a live spin for public watchers.
 * @param {{ mode: string, items: string[], index: number, winner: string, nonce: string, ts: number, signature: string, note?: string, adminWallet?: string|null, durationMs?: number }} opts
 */
function setLiveSpin(opts) {
  return update((store) => {
    const id =
      'live_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const now = Date.now();
    store.live = {
      id,
      status: 'spinning',
      mode: opts.mode,
      items: opts.items.slice(),
      index: opts.index,
      winner: opts.winner,
      nonce: opts.nonce,
      ts: opts.ts,
      signature: opts.signature,
      note: opts.note ? String(opts.note).slice(0, 200) : null,
      startedAt: now,
      durationMs: opts.durationMs || LIVE_SPIN_DURATION_MS,
      adminWallet: opts.adminWallet || null,
      updatedAt: now,
    };
    return normalizeLive(store.live);
  });
}

function markLiveDone() {
  return update((store) => {
    const cur = normalizeLive(store.live);
    if (cur.status === 'spinning') {
      cur.status = 'done';
      cur.updatedAt = Date.now();
      store.live = cur;
    }
    return normalizeLive(store.live);
  });
}

function clearLive() {
  return update((store) => {
    store.live = emptyLive();
    return normalizeLive(store.live);
  });
}

module.exports = {
  DATA_DIR,
  STORE_PATH,
  DEFAULT_PRIZES,
  LIVE_SPIN_DURATION_MS,
  load,
  update,
  getPrizes,
  setPrizes,
  recordGiveaway,
  listGiveaways,
  getLive,
  setLiveReady,
  setLiveSpin,
  markLiveDone,
  clearLive,
};
