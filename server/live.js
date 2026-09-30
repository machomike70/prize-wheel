'use strict';

/**
 * In-memory SSE fan-out for public giveaway watchers.
 * Persisted live state lives in store.js; this only tracks connected clients.
 */

/** @type {Set<import('http').ServerResponse>} */
const clients = new Set();

function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      cleanup();
    }
  }, 25000);

  function cleanup() {
    clearInterval(heartbeat);
    clients.delete(res);
  }

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('error', cleanup);

  return { cleanup };
}

/**
 * @param {string} event
 * @param {object} data
 */
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = {
  subscribe,
  broadcast,
  clientCount,
};
