import { splitHM } from "./time.js";

const SEC_PER_DAY = 24 * 60 * 60;
const SLOT_SECONDS = 4 * 60;
const SLOT_COUNT = SEC_PER_DAY / SLOT_SECONDS;
const MIN_QUALITY = "hd720";
const AUTO_TRANSITION_POLL_MS = 180;
const SEEK_TOLERANCE_SEC = 1.25;

let ytPlayer = null;
let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });

let onEndedCb = null;
let currentHourLoaded = null;
let hoursRef = null;

let qualitySessionToken = 0;
let transitionPollTimer = null;

let customAssignments = new Array(SLOT_COUNT).fill(null);
let fanMetaById = new Map();

let activeResolved = null;
let timelineAnchorAbsSec = 0;
let timelineAnchorVideoSec = 0;
let activeSegmentDurationSec = null;

let syncBusy = false;
let pendingSyncRequest = null;

const QUALITY_RANK = Object.freeze({
  highres: 0,
  hd2160: 1,
  hd1440: 2,
  hd1080: 3,
  hd720: 4,
  large: 5,
  medium: 6,
  small: 7,
  tiny: 8,
});

export function onHourEnded(cb) {
  onEndedCb = cb;
}

export function getCurrentHourLoaded() {
  return currentHourLoaded;
}

export function getCurrentMinuteExact() {
  const sec = getCurrentAbsoluteSecondOfDay();
  if (!Number.isFinite(sec)) return null;
  return sec / 60;
}

export function getCurrentSecondOfDay() {
  const sec = getCurrentAbsoluteSecondOfDay();
  if (!Number.isFinite(sec)) return null;
  return Math.floor(sec);
}

export function getCurrentMinuteOfDay() {
  const minuteExact = getCurrentMinuteExact();
  if (!Number.isFinite(minuteExact)) return null;
  return Math.floor(minuteExact);
}

export function getCurrentTimeSeconds() {
  if (!ytPlayer) return 0;
  try { return ytPlayer.getCurrentTime() || 0; } catch (_) { return 0; }
}

export function setCustomPlaylist({ assignmentsBySlot = null, fanVideos = null } = {}) {
  if (fanVideos !== null) {
    fanMetaById = normalizeFanMetaCollection(fanVideos);
  }

  if (assignmentsBySlot !== null) {
    customAssignments = normalizeAssignments(assignmentsBySlot);
  }

  if (ytPlayer) {
    const absNow = getCurrentAbsoluteSecondOfDay();
    const target = Number.isFinite(absNow) ? absNow : 0;
    void requestSync(target, { forceSeek: false, allowNoop: true });
  }
}

export async function initPlayer({
  hours,
  initialMinuteOfDay,
  initialSecondsInMinute = 0,
  assignmentsBySlot = null,
  fanVideos = null,
}) {
  hoursRef = hours;

  if (assignmentsBySlot !== null || fanVideos !== null) {
    setCustomPlaylist({ assignmentsBySlot, fanVideos });
  }

  await loadIframeApi();

  const startAbsSec = toAbsoluteSecond(initialMinuteOfDay, initialSecondsInMinute);
  const first = resolvePlaybackAtSecond(startAbsSec);

  currentHourLoaded = first.hour;
  activeResolved = first;

  ytPlayer = new YT.Player("player", {
    width: "100%",
    height: "100%",
    videoId: first.videoId,
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
      mute: 1,
      cc_load_policy: 0,
      fs: 0,
      vq: MIN_QUALITY,
      start: Math.floor(first.videoStartSec),
    },
    events: {
      onReady: (e) => {
        try {
          if (first.videoStartSec > 0) e.target.seekTo(first.videoStartSec, true);
          applyPreferredQuality(e.target, { forceSwitch: false });
          e.target.playVideo();
          scheduleQualityEnforcement(e.target);
        } catch (_) {
          // Ignore player readiness race errors.
        }

        setAnchor(startAbsSec, first.videoStartSec);
        setActiveSegment(first, startAbsSec);
        ensureTransitionLoop();
        readyResolve();
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) {
          const absNow = getCurrentAbsoluteSecondOfDay();
          const fallbackAbs = Number.isFinite(absNow)
            ? absNow
            : (activeResolved ? activeResolved.segmentEndAbsSec : 0);
          void requestSync(fallbackAbs, { forceSeek: true, allowNoop: false });
          if (onEndedCb) onEndedCb(currentHourLoaded);
        }
      },
    },
  });

  return readyPromise;
}

export async function setMinuteOfDay(minuteOfDay, { secondsInMinute = 0, force = false } = {}) {
  await readyPromise;
  const targetAbsSec = toAbsoluteSecond(minuteOfDay, secondsInMinute);
  await requestSync(targetAbsSec, {
    forceSeek: Boolean(force),
    allowNoop: !force,
  });
}

export async function playPauseToggle() {
  await readyPromise;
  const state = ytPlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    ytPlayer.pauseVideo();
  } else {
    ytPlayer.playVideo();
  }
}

export async function isPlaying() {
  await readyPromise;
  try {
    return ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
  } catch (_) {
    return false;
  }
}

export async function unmute() {
  await readyPromise;
  ytPlayer.unMute();
}

export async function mute() {
  await readyPromise;
  ytPlayer.mute();
}

export async function isMuted() {
  await readyPromise;
  return ytPlayer.isMuted();
}

function resolvePlaybackAtSecond(absSec) {
  if (!hoursRef || !Array.isArray(hoursRef) || hoursRef.length !== 24) {
    throw new Error("Player hours are not initialized.");
  }

  const sec = normalizeSecond(absSec);
  const slotIndex = Math.floor(sec / SLOT_SECONDS);
  const slotStart = slotIndex * SLOT_SECONDS;
  const slotOffset = sec - slotStart;
  const slotEnd = slotStart + SLOT_SECONDS;
  const hour = Math.floor(sec / 3600) % 24;

  const assignedVideoId = customAssignments[slotIndex];
  if (assignedVideoId) {
    const meta = fanMetaById.get(assignedVideoId);
    const rawDuration = meta ? coerceDurationSeconds(meta.duration) : null;
    const fanDuration = Number.isFinite(rawDuration)
      ? Math.max(0, rawDuration)
      : SLOT_SECONDS;

    if (fanDuration > slotOffset) {
      return {
        kind: "fan",
        videoId: assignedVideoId,
        hour,
        slotIndex,
        // Seeking inside a slot must continue within the fan clip at the same
        // slot offset so circle scrubs map correctly.
        videoStartSec: slotOffset,
        segmentEndAbsSec: slotStart + Math.min(SLOT_SECONDS, fanDuration),
      };
    }
  }

  const hourStart = hour * 3600;
  const secInHour = sec - hourStart;
  const hourEnd = hourStart + 3600;
  return {
    kind: "original",
    videoId: hoursRef[hour].videoId,
    hour,
    slotIndex,
    videoStartSec: secInHour,
    segmentEndAbsSec: Math.min(slotEnd, hourEnd),
  };
}

function ensureTransitionLoop() {
  if (transitionPollTimer !== null) return;
  transitionPollTimer = setInterval(() => {
    if (!ytPlayer || activeSegmentDurationSec === null) return;
    if (syncBusy) return;

    const currentVideoSec = safeGetCurrentTime(ytPlayer);
    if (!Number.isFinite(currentVideoSec)) return;

    const elapsed = currentVideoSec - timelineAnchorVideoSec;
    if (!Number.isFinite(elapsed)) return;
    if (elapsed < activeSegmentDurationSec - 0.16) return;

    const nextAbs = activeResolved
      ? activeResolved.segmentEndAbsSec
      : (timelineAnchorAbsSec + activeSegmentDurationSec);
    void requestSync(nextAbs, { forceSeek: false, allowNoop: true });
  }, AUTO_TRANSITION_POLL_MS);
}

async function requestSync(absSec, options = {}) {
  pendingSyncRequest = {
    absSec: normalizeSecond(absSec),
    options,
  };

  if (syncBusy) return;
  syncBusy = true;

  try {
    while (pendingSyncRequest) {
      const req = pendingSyncRequest;
      pendingSyncRequest = null;
      await performSync(req.absSec, req.options || {});
    }
  } finally {
    syncBusy = false;
  }
}

async function performSync(absSec, { forceSeek = false, allowNoop = true } = {}) {
  await readyPromise;
  if (!ytPlayer) return;

  const resolved = resolvePlaybackAtSecond(absSec);
  const desiredVideoSec = Math.max(0, resolved.videoStartSec);

  let currentVideoSec = safeGetCurrentTime(ytPlayer);
  if (!Number.isFinite(currentVideoSec)) currentVideoSec = desiredVideoSec;

  const sameVideo = activeResolved
    && activeResolved.kind === resolved.kind
    && activeResolved.videoId === resolved.videoId;

  let reloaded = false;
  let seeked = false;

  if (!sameVideo) {
    ytPlayer.loadVideoById({
      videoId: resolved.videoId,
      startSeconds: Math.floor(desiredVideoSec),
      suggestedQuality: MIN_QUALITY,
    });
    scheduleQualityEnforcement(ytPlayer);
    reloaded = true;
  } else {
    const diff = Math.abs(currentVideoSec - desiredVideoSec);
    const shouldSeek = forceSeek || diff > SEEK_TOLERANCE_SEC;
    if (shouldSeek) {
      ytPlayer.seekTo(desiredVideoSec, true);
      applyPreferredQuality(ytPlayer, { forceSwitch: false });
      seeked = true;
    } else if (!allowNoop) {
      ytPlayer.seekTo(desiredVideoSec, true);
      applyPreferredQuality(ytPlayer, { forceSwitch: false });
      seeked = true;
    }
  }

  currentHourLoaded = resolved.hour;
  activeResolved = resolved;

  const anchorVideoSec = (reloaded || seeked)
    ? desiredVideoSec
    : currentVideoSec;
  setAnchor(absSec, anchorVideoSec);
  setActiveSegment(resolved, absSec);
}

function setAnchor(absSec, videoSec) {
  timelineAnchorAbsSec = normalizeSecond(absSec);
  timelineAnchorVideoSec = Math.max(0, videoSec || 0);
}

function setActiveSegment(resolved, startAbsSec) {
  const endAbsSec = normalizeSecond(resolved.segmentEndAbsSec);
  const duration = forwardDistanceSeconds(startAbsSec, endAbsSec);

  activeResolved = {
    ...resolved,
    segmentEndAbsSec: endAbsSec,
  };

  activeSegmentDurationSec = Math.max(0.08, duration);
}

function getCurrentAbsoluteSecondOfDay() {
  if (!ytPlayer || activeResolved === null) return null;

  const currentVideoSec = safeGetCurrentTime(ytPlayer);
  if (!Number.isFinite(currentVideoSec)) return null;

  const elapsed = currentVideoSec - timelineAnchorVideoSec;
  if (!Number.isFinite(elapsed)) return null;

  return normalizeSecond(timelineAnchorAbsSec + elapsed);
}

function normalizeAssignments(assignmentsBySlot) {
  const slots = new Array(SLOT_COUNT).fill(null);

  if (Array.isArray(assignmentsBySlot)) {
    for (let i = 0; i < Math.min(SLOT_COUNT, assignmentsBySlot.length); i++) {
      const videoId = normalizeVideoId(assignmentsBySlot[i]);
      if (videoId) slots[i] = videoId;
    }
    return slots;
  }

  if (assignmentsBySlot && typeof assignmentsBySlot === "object") {
    for (const [rawKey, rawValue] of Object.entries(assignmentsBySlot)) {
      const slot = parseInt(rawKey, 10);
      if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) continue;
      const videoId = normalizeVideoId(rawValue);
      if (videoId) slots[slot] = videoId;
    }
  }

  return slots;
}

function normalizeFanMetaCollection(fanVideos) {
  const map = new Map();

  if (fanVideos instanceof Map) {
    fanVideos.forEach((value, key) => {
      const videoId = normalizeVideoId(key) || normalizeVideoId(value && value.videoId);
      if (!videoId) return;
      map.set(videoId, {
        ...(value || {}),
        videoId,
      });
    });
    return map;
  }

  if (Array.isArray(fanVideos)) {
    for (const item of fanVideos) {
      const videoId = normalizeVideoId(item && item.videoId);
      if (!videoId) continue;
      map.set(videoId, {
        ...(item || {}),
        videoId,
      });
    }
    return map;
  }

  if (fanVideos && typeof fanVideos === "object") {
    for (const [rawKey, value] of Object.entries(fanVideos)) {
      const videoId = normalizeVideoId(rawKey) || normalizeVideoId(value && value.videoId);
      if (!videoId) continue;
      map.set(videoId, {
        ...(value || {}),
        videoId,
      });
    }
  }

  return map;
}

function normalizeVideoId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function coerceDurationSeconds(raw) {
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.floor(raw));
}

function toAbsoluteSecond(minuteOfDay, secondsInMinute = 0) {
  const { hour, minute } = splitHM(minuteOfDay);
  const clampedSeconds = clamp(secondsInMinute, 0, 59.999);
  return normalizeSecond((hour * 3600) + (minute * 60) + clampedSeconds);
}

function safeGetCurrentTime(player) {
  try {
    const t = player.getCurrentTime();
    return Number.isFinite(t) ? t : null;
  } catch (_) {
    return null;
  }
}

function forwardDistanceSeconds(fromAbsSec, toAbsSec) {
  const from = normalizeSecond(fromAbsSec);
  const to = normalizeSecond(toAbsSec);
  if (to >= from) return to - from;
  return (SEC_PER_DAY - from) + to;
}

function normalizeSecond(secondOfDay) {
  const sec = Number(secondOfDay);
  if (!Number.isFinite(sec)) return 0;
  const normalized = ((sec % SEC_PER_DAY) + SEC_PER_DAY) % SEC_PER_DAY;
  return normalized;
}

function clamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function loadIframeApi() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
}

function scheduleQualityEnforcement(player) {
  const token = ++qualitySessionToken;

  applyPreferredQuality(player, { forceSwitch: false });

  setTimeout(() => {
    if (token !== qualitySessionToken) return;
    applyPreferredQuality(player, { forceSwitch: true });
  }, 1200);
}

function applyPreferredQuality(player, { forceSwitch } = { forceSwitch: false }) {
  if (!player) return;

  const targetQuality = resolvePreferredQuality(player);

  try {
    if (typeof player.setPlaybackQualityRange === "function") {
      player.setPlaybackQualityRange(targetQuality);
    }
  } catch (_) {
    // Optional API path; ignore failures.
  }

  if (!forceSwitch) return;

  const currentQuality = getCurrentQuality(player);
  if (!shouldForceSwitch(currentQuality, targetQuality)) return;

  try {
    if (typeof player.setPlaybackQuality === "function") {
      player.setPlaybackQuality(targetQuality);
    }
  } catch (_) {
    // Optional API path; ignore failures.
  }
}

function getCurrentQuality(player) {
  try {
    return player.getPlaybackQuality?.() || null;
  } catch (_) {
    return null;
  }
}

function shouldForceSwitch(currentQuality, targetQuality) {
  if (!targetQuality) return false;
  if (!currentQuality) return true;

  const currentRank = QUALITY_RANK[currentQuality];
  const targetRank = QUALITY_RANK[targetQuality];
  if (!Number.isFinite(targetRank)) return false;
  if (!Number.isFinite(currentRank)) return true;

  return currentRank > targetRank;
}

function resolvePreferredQuality(player) {
  try {
    const levels = player.getAvailableQualityLevels?.();
    if (!Array.isArray(levels) || levels.length === 0) {
      return MIN_QUALITY;
    }

    const minRank = QUALITY_RANK[MIN_QUALITY] ?? QUALITY_RANK.hd720;
    const atLeastMin = levels.filter((q) => {
      const rank = QUALITY_RANK[q];
      return Number.isFinite(rank) && rank <= minRank;
    });
    if (atLeastMin.length > 0) {
      return pickHighestQuality(atLeastMin);
    }

    return pickHighestQuality(levels);
  } catch (_) {
    return MIN_QUALITY;
  }
}

function pickHighestQuality(levels) {
  return levels
    .slice()
    .sort((a, b) => (QUALITY_RANK[a] ?? 999) - (QUALITY_RANK[b] ?? 999))[0] || MIN_QUALITY;
}
