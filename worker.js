const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_KEY_URL = "https://24hh.internal/youtube-health-cache-v1";
const YOUTUBE_VIDEOS_API = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_ID_RE = /(?:[?&]v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/youtube-health") {
      return handleYoutubeHealthCheck(request, env, ctx);
    }

    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }

    return jsonResponse(
      { error: "ASSETS binding is not available." },
      { status: 500 },
    );
  },
};

async function handleYoutubeHealthCheck(request, env, ctx) {
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  if (!env.YOUTUBE_API_KEY) {
    return jsonResponse(
      { error: "Missing YOUTUBE_API_KEY worker secret." },
      { status: 500 },
    );
  }

  const cache = caches.default;
  const cacheRequest = new Request(CACHE_KEY_URL, { method: "GET" });
  const cachedResponse = await cache.match(cacheRequest);
  const nowMs = Date.now();

  if (cachedResponse) {
    const cachedPayload = await safeJson(cachedResponse);
    if (isFreshPayload(cachedPayload, nowMs)) {
      return jsonResponse(
        {
          ...cachedPayload,
          cache: { ...(cachedPayload.cache || {}), hit: true, stale: false },
        },
        { status: 200 },
      );
    }
  }

  try {
    const freshPayload = await runYoutubeHealthCheck(request, env, nowMs);
    const serialized = JSON.stringify(freshPayload);

    const cacheable = new Response(serialized, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(cacheRequest, cacheable));

    return new Response(serialized, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (cachedResponse) {
      const stalePayload = await safeJson(cachedResponse);
      if (stalePayload && typeof stalePayload === "object") {
        return jsonResponse(
          {
            ...stalePayload,
            cache: { ...(stalePayload.cache || {}), hit: true, stale: true },
            warning: "Returning stale cached result after refresh failure.",
          },
          { status: 200 },
        );
      }
    }

    return jsonResponse(
      { error: `YouTube health check failed: ${toErrorMessage(error)}` },
      { status: 502 },
    );
  }
}

function isFreshPayload(payload, nowMs) {
  if (!payload || typeof payload !== "object") return false;
  const checkedAtEpochMs = payload.checkedAtEpochMs;
  if (!Number.isFinite(checkedAtEpochMs)) return false;
  return (nowMs - checkedAtEpochMs) < CACHE_TTL_MS;
}

async function runYoutubeHealthCheck(request, env, nowMs) {
  const fanRows = await loadFanRows(request, env);
  const videoMetaById = collectVideoMeta(fanRows);
  const allVideoIds = Array.from(videoMetaById.keys());

  const statusById = await fetchStatusesByVideoId(allVideoIds, env.YOUTUBE_API_KEY);

  const privateOrUnembeddable = [];
  const unresolved = [];

  for (const videoId of allVideoIds) {
    const status = statusById.get(videoId);
    const meta = videoMetaById.get(videoId) || {};

    if (!status) {
      unresolved.push({
        videoId,
        title: meta.title || null,
        country: meta.country || null,
        city: meta.city || null,
        reason: "not_returned_by_youtube_api",
      });
      continue;
    }

    const privacyStatus = status.privacyStatus || null;
    const embeddable = typeof status.embeddable === "boolean"
      ? status.embeddable
      : null;
    const isPrivate = privacyStatus === "private";
    const isNotEmbeddable = embeddable === false;

    if (!isPrivate && !isNotEmbeddable) continue;

    privateOrUnembeddable.push({
      videoId,
      title: meta.title || null,
      country: meta.country || null,
      city: meta.city || null,
      privacyStatus,
      embeddable,
    });
  }

  const checkedAt = new Date(nowMs).toISOString();
  const nextCheckAt = new Date(nowMs + CACHE_TTL_MS).toISOString();

  return {
    ok: true,
    source: "wearehappyfrom.com.json",
    checkedAt,
    checkedAtEpochMs: nowMs,
    nextCheckAt,
    cache: {
      ttlSeconds: CACHE_TTL_SECONDS,
      hit: false,
      stale: false,
    },
    totals: {
      catalogVideos: allVideoIds.length,
      returnedByApi: statusById.size,
      privateOrUnembeddable: privateOrUnembeddable.length,
      unresolved: unresolved.length,
    },
    privateOrUnembeddable,
    unresolved,
  };
}

async function loadFanRows(request, env) {
  const url = new URL("/wearehappyfrom.com.json", request.url);
  const requestInit = {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  };

  const res = (env.ASSETS && typeof env.ASSETS.fetch === "function")
    ? await env.ASSETS.fetch(new Request(url.toString(), requestInit))
    : await fetch(url.toString(), requestInit);

  if (!res.ok) {
    throw new Error(`Failed to load dataset (${res.status}).`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Dataset is not a JSON array.");
  }
  return data;
}

function collectVideoMeta(rows) {
  const byId = new Map();

  for (const row of rows) {
    const videoId = extractVideoId(row);
    if (!videoId) continue;

    if (!byId.has(videoId)) {
      byId.set(videoId, {
        title: normalizeText(row && row.title),
        country: normalizeText(row && row.country),
        city: normalizeText(row && row.city),
      });
    }
  }

  return byId;
}

function extractVideoId(row) {
  if (!row || typeof row !== "object") return "";

  const direct = normalizeText(row.videoId);
  if (/^[A-Za-z0-9_-]{11}$/.test(direct)) return direct;

  const url = normalizeText(row.url);
  if (!url) return "";
  const match = YOUTUBE_ID_RE.exec(url);
  return match ? match[1] : "";
}

async function fetchStatusesByVideoId(videoIds, apiKey) {
  const out = new Map();
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const url = new URL(YOUTUBE_VIDEOS_API);
    url.searchParams.set("part", "status");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API returned ${res.status}: ${body.slice(0, 240)}`);
    }

    const data = await res.json();
    const items = Array.isArray(data && data.items) ? data.items : [];
    for (const item of items) {
      const id = normalizeText(item && item.id);
      if (!id) continue;
      const status = (item && item.status && typeof item.status === "object")
        ? item.status
        : {};
      out.set(id, {
        privacyStatus: normalizeText(status.privacyStatus) || null,
        embeddable: typeof status.embeddable === "boolean" ? status.embeddable : null,
      });
    }
  }

  return out;
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toErrorMessage(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;
  if (typeof error.message === "string") return error.message;
  return String(error);
}

async function safeJson(response) {
  try {
    return await response.clone().json();
  } catch (_) {
    return null;
  }
}

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
