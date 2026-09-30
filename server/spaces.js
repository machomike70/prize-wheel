'use strict';

/**
 * X Spaces scraper — fetch hosts, speakers, and listeners from a live Space.
 * Uses the AudioSpace GraphQL endpoint with bearer token auth.
 */

const { X_BEARER_TOKEN } = require('./config');

/**
 * Parse Space URL or ID to extract the Space ID.
 * Supports:
 *  - https://twitter.com/i/spaces/1AKEmvzOBeeKL
 *  - https://x.com/i/spaces/1AKEmvzOBeeKL
 *  - 1AKEmvzOBeeKL (bare ID)
 */
function parseSpaceId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  // Bare ID
  if (/^[A-Za-z0-9_-]{13,}$/.test(trimmed)) return trimmed;
  // URL
  const match = trimmed.match(/(?:twitter|x)\.com\/i\/spaces\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch Space details + participants from X API.
 * Returns { ok: true, hosts, speakers, listeners, spaceData } or { ok: false, error }.
 */
async function scrapeSpace(spaceId) {
  if (!X_BEARER_TOKEN) {
    return {
      ok: false,
      error: 'X_BEARER_TOKEN not configured (required for Space scraping)',
      status: 503,
    };
  }

  // First get Space metadata to verify it's live
  let spaceData;
  try {
    const spaceRes = await fetch(
      `https://api.twitter.com/2/spaces/${spaceId}?space.fields=host_ids,speaker_ids,participant_count,state,title`,
      {
        headers: {
          Authorization: `Bearer ${X_BEARER_TOKEN}`,
          'User-Agent': 'prize-wheel/1.0',
        },
      }
    );

    if (!spaceRes.ok) {
      if (spaceRes.status === 401 || spaceRes.status === 403) {
        return {
          ok: false,
          error: 'X API authentication failed (check X_BEARER_TOKEN)',
          status: 503,
        };
      }
      if (spaceRes.status === 404) {
        return {
          ok: false,
          error: 'Space not found or not accessible',
          status: 404,
        };
      }
      const errorData = await spaceRes.json().catch(() => ({}));
      return {
        ok: false,
        error: errorData.title || errorData.detail || `X API error: ${spaceRes.status}`,
        status: 502,
      };
    }

    const json = await spaceRes.json();
    spaceData = json.data;
    if (!spaceData) {
      return {
        ok: false,
        error: 'Invalid Space response from X API',
        status: 502,
      };
    }

    // Check if Space is live
    if (spaceData.state !== 'live' && spaceData.state !== 'Running') {
      return {
        ok: false,
        error: `Space is not live (state: ${spaceData.state || 'unknown'})`,
        status: 400,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to fetch Space: ${err.message}`,
      status: 502,
    };
  }

  // Get user IDs from Space metadata
  const hostIds = spaceData.host_ids || [];
  const speakerIds = spaceData.speaker_ids || [];
  const allUserIds = [...new Set([...hostIds, ...speakerIds])];

  if (allUserIds.length === 0) {
    return {
      ok: false,
      error: 'No participants found in Space',
      status: 404,
    };
  }

  // Fetch user details (names, handles) in batches
  let users = [];
  try {
    const batchSize = 100;
    for (let i = 0; i < allUserIds.length; i += batchSize) {
      const batch = allUserIds.slice(i, i + batchSize);
      const userRes = await fetch(
        `https://api.twitter.com/2/users?ids=${batch.join(',')}&user.fields=name,username`,
        {
          headers: {
            Authorization: `Bearer ${X_BEARER_TOKEN}`,
            'User-Agent': 'prize-wheel/1.0',
          },
        }
      );

      if (!userRes.ok) {
        console.warn(`Failed to fetch user batch: ${userRes.status}`);
        continue;
      }

      const userJson = await userRes.json();
      if (userJson.data) {
        users.push(...userJson.data);
      }
    }
  } catch (err) {
    console.error('Error fetching users:', err);
    // Continue with whatever we got
  }

  // Map user IDs to names
  const userMap = new Map();
  for (const user of users) {
    userMap.set(user.id, {
      name: user.name,
      username: user.username,
      displayName: user.name || `@${user.username}`,
    });
  }

  const hosts = hostIds.map(id => userMap.get(id)).filter(Boolean);
  const speakers = speakerIds.map(id => userMap.get(id)).filter(Boolean);

  // NOTE: Official X API v2 does NOT expose listener IDs or names.
  // Full listener lists require unofficial GraphQL endpoints or browser session cookies.
  // For now, we return hosts + speakers reliably.
  const listeners = [];

  return {
    ok: true,
    spaceId,
    spaceData: {
      id: spaceData.id,
      title: spaceData.title,
      state: spaceData.state,
      participantCount: spaceData.participant_count,
    },
    hosts,
    speakers,
    listeners,
    total: hosts.length + speakers.length + listeners.length,
  };
}

/**
 * Format participants as names for the giveaway textarea.
 * Dedupes by username (case-insensitive).
 */
function formatParticipantsForGiveaway(scrapeResult) {
  const { hosts, speakers, listeners } = scrapeResult;
  const all = [...hosts, ...speakers, ...listeners];
  
  const seen = new Set();
  const names = [];
  
  for (const user of all) {
    const key = user.username.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(user.displayName);
    }
  }
  
  return names;
}

module.exports = {
  parseSpaceId,
  scrapeSpace,
  formatParticipantsForGiveaway,
};
