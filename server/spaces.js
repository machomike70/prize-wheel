'use strict';

/**
 * X Spaces scraper — fetch hosts, speakers, AND LISTENERS from a live Space.
 * 
 * Strategy:
 * 1. Try AudioSpace GraphQL (unofficial but widely used) for FULL participant list
 * 2. Fall back to official X API v2 (hosts+speakers only) if GraphQL fails
 * 3. Return warning flag when listeners unavailable so UI can warn/block
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
 * Try AudioSpaceById GraphQL (unofficial but comprehensive).
 * Returns full participant list including listeners when successful.
 */
async function scrapeSpaceGraphQL(spaceId) {
  if (!X_BEARER_TOKEN) return null;

  try {
    // AudioSpaceById GraphQL query - gets full participant list
    const variables = {
      id: spaceId,
      isMetatagsQuery: false,
      withReplays: true,
      withListeners: true,
    };

    const features = {
      spaces_2022_h2_clipping: true,
      spaces_2022_h2_spaces_communities: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      tweetypie_unmention_optimization_enabled: true,
      vibe_api_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      longform_notetweets_rich_text_read_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    };

    // Known GraphQL endpoint for AudioSpaceById
    // Query hash may need periodic updates if X changes their API
    const queryId = 'Uv5R_-Chxbn1FEkyUkSW2A';
    
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features),
    });

    const graphqlRes = await fetch(
      `https://twitter.com/i/api/graphql/${queryId}/AudioSpaceById?${params}`,
      {
        headers: {
          Authorization: `Bearer ${X_BEARER_TOKEN}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'x-twitter-active-user': 'yes',
          'x-twitter-client-language': 'en',
        },
      }
    );

    if (!graphqlRes.ok) {
      console.warn(`GraphQL AudioSpaceById failed: ${graphqlRes.status}`);
      return null;
    }

    const json = await graphqlRes.json();
    const audioSpace = json.data?.audioSpace;
    
    if (!audioSpace) {
      console.warn('GraphQL returned no audioSpace data');
      return null;
    }

    // Extract metadata
    const metadata = audioSpace.metadata;
    const state = metadata?.state;
    
    if (state !== 'Running' && state !== 'live') {
      return {
        ok: false,
        error: `Space is not live (state: ${state || 'unknown'})`,
        status: 400,
      };
    }

    // Extract participants from GraphQL response
    const participants = audioSpace.participants || {};
    const admins = participants.admins || [];
    const speakersList = participants.speakers || [];
    const listenersList = participants.listeners || [];

    // Build user list with roles
    const allParticipants = [];
    const seenIds = new Set();

    // Hosts/admins
    for (const admin of admins) {
      const user = admin.periscope_user_id ? admin : admin.twitter_screen_name ? admin : null;
      if (!user) continue;
      const userId = user.user_id || user.periscope_user_id;
      if (seenIds.has(userId)) continue;
      seenIds.add(userId);
      allParticipants.push({
        id: userId,
        username: user.twitter_screen_name || user.username || user.display_name,
        name: user.display_name || user.name,
        role: 'host',
      });
    }

    // Speakers
    for (const speaker of speakersList) {
      const user = speaker.periscope_user_id ? speaker : speaker.twitter_screen_name ? speaker : null;
      if (!user) continue;
      const userId = user.user_id || user.periscope_user_id;
      if (seenIds.has(userId)) continue;
      seenIds.add(userId);
      allParticipants.push({
        id: userId,
        username: user.twitter_screen_name || user.username || user.display_name,
        name: user.display_name || user.name,
        role: 'speaker',
      });
    }

    // LISTENERS - the critical piece
    for (const listener of listenersList) {
      const user = listener.periscope_user_id ? listener : listener.twitter_screen_name ? listener : null;
      if (!user) continue;
      const userId = user.user_id || user.periscope_user_id;
      if (seenIds.has(userId)) continue;
      seenIds.add(userId);
      allParticipants.push({
        id: userId,
        username: user.twitter_screen_name || user.username || user.display_name,
        name: user.display_name || user.name,
        role: 'listener',
      });
    }

    // Separate by role for detailed reporting
    const hosts = allParticipants.filter(p => p.role === 'host');
    const speakers = allParticipants.filter(p => p.role === 'speaker');
    const listeners = allParticipants.filter(p => p.role === 'listener');

    return {
      ok: true,
      method: 'graphql',
      spaceId,
      spaceData: {
        id: audioSpace.rest_id || spaceId,
        title: metadata?.title,
        state: metadata?.state,
        participantCount: allParticipants.length,
      },
      hosts,
      speakers,
      listeners,
      total: allParticipants.length,
      hasListeners: true,
    };
  } catch (err) {
    console.error('GraphQL scrape error:', err);
    return null;
  }
}

/**
 * Fallback: Official X API v2 (hosts + speakers only, NO listeners).
 */
async function scrapeSpaceOfficial(spaceId) {
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
    const spaceData = json.data;
    
    if (!spaceData) {
      return {
        ok: false,
        error: 'Invalid Space response from X API',
        status: 502,
      };
    }

    if (spaceData.state !== 'live' && spaceData.state !== 'Running') {
      return {
        ok: false,
        error: `Space is not live (state: ${spaceData.state || 'unknown'})`,
        status: 400,
      };
    }

    // Get user IDs
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

    // Fetch user details
    let users = [];
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

      if (userRes.ok) {
        const userJson = await userRes.json();
        if (userJson.data) users.push(...userJson.data);
      }
    }

    const userMap = new Map();
    for (const user of users) {
      userMap.set(user.id, {
        id: user.id,
        name: user.name,
        username: user.username,
      });
    }

    const hosts = hostIds.map(id => userMap.get(id)).filter(Boolean);
    const speakers = speakerIds.map(id => userMap.get(id)).filter(Boolean);

    return {
      ok: true,
      method: 'official-api',
      spaceId,
      spaceData: {
        id: spaceData.id,
        title: spaceData.title,
        state: spaceData.state,
        participantCount: spaceData.participant_count,
      },
      hosts,
      speakers,
      listeners: [],
      total: hosts.length + speakers.length,
      hasListeners: false,
      warning: 'INCOMPLETE: Listeners not available (official API limitation)',
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to fetch Space: ${err.message}`,
      status: 502,
    };
  }
}

/**
 * Master scrape function: tries GraphQL first (full room), falls back to official API.
 * Returns { ok, spaceId, spaceData, hosts, speakers, listeners, total, hasListeners, warning? }
 */
async function scrapeSpace(spaceId) {
  if (!X_BEARER_TOKEN) {
    return {
      ok: false,
      error: 'X_BEARER_TOKEN not configured (required for Space scraping)',
      status: 503,
    };
  }

  // Try GraphQL first (full participant list including listeners)
  console.log(`Scraping Space ${spaceId} via GraphQL...`);
  const graphqlResult = await scrapeSpaceGraphQL(spaceId);
  
  if (graphqlResult && graphqlResult.ok) {
    console.log(`✓ GraphQL success: ${graphqlResult.total} participants (${graphqlResult.listeners.length} listeners)`);
    return graphqlResult;
  }

  if (graphqlResult && !graphqlResult.ok) {
    // GraphQL returned explicit error (e.g. Space not live)
    return graphqlResult;
  }

  // GraphQL failed or unavailable, fall back to official API (hosts+speakers only)
  console.warn('GraphQL failed, falling back to official API (hosts+speakers only)');
  const officialResult = await scrapeSpaceOfficial(spaceId);
  
  if (!officialResult.ok) {
    return officialResult;
  }

  // Return with strong warning flag
  return {
    ...officialResult,
    warning: '⚠️ INCOMPLETE: Only hosts + speakers available. Listeners cannot be scraped with current auth.',
  };
}

/**
 * Format participants as names for the giveaway textarea.
 * Dedupes by user id or username (case-insensitive).
 * Prefers @handle format for clarity.
 */
function formatParticipantsForGiveaway(scrapeResult) {
  const { hosts, speakers, listeners } = scrapeResult;
  const all = [...hosts, ...speakers, ...listeners];
  
  const seen = new Set();
  const names = [];
  
  for (const user of all) {
    // Dedupe by ID first, then username
    const dedupeKey = user.id || user.username?.toLowerCase();
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    
    // Format: prefer @username, fall back to name
    const username = user.username || user.twitter_screen_name;
    if (username) {
      names.push(`@${username}`);
    } else if (user.name || user.display_name) {
      names.push(user.name || user.display_name);
    }
  }
  
  return names;
}

module.exports = {
  parseSpaceId,
  scrapeSpace,
  formatParticipantsForGiveaway,
};
