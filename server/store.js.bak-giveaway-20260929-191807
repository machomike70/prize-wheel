'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

const DEFAULT_PRIZES = ['10% Off', 'Free Shipping', 'Mystery Gift', 'Try Again'];

/** @type {{ tickets: object[], prizes: string[], updatedAt: number } | null} */
let cache = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function defaultStore() {
  return {
    tickets: [],
    prizes: DEFAULT_PRIZES.slice(),
    updatedAt: Date.now(),
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
 * @param {(store: { tickets: object[], prizes: string[], updatedAt: number }) => T} fn
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

module.exports = {
  DATA_DIR,
  STORE_PATH,
  DEFAULT_PRIZES,
  load,
  update,
  getPrizes,
  setPrizes,
};
