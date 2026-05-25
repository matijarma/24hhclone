import { splitHM } from "./time.js";

let ytPlayer = null;
let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });

let onEndedCb = null;
let currentHourLoaded = null;
let hoursRef = null;
const MIN_QUALITY = "hd720";

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

/**
 * Reads the player's reported current time and returns the minute-of-day it
 * implies (assuming the hour-video is 60 minutes). Returns null until ready.
 */
export function getCurrentMinuteOfDay() {
  if (!ytPlayer || currentHourLoaded === null) return null;
  try {
    const t = ytPlayer.getCurrentTime();
    if (!Number.isFinite(t)) return null;
    const minuteInHour = Math.max(0, Math.min(59, Math.floor(t / 60)));
    return currentHourLoaded * 60 + minuteInHour;
  } catch (_) {
    return null;
  }
}

export function getCurrentTimeSeconds() {
  if (!ytPlayer) return 0;
  try { return ytPlayer.getCurrentTime() || 0; } catch (_) { return 0; }
}

export async function initPlayer({ hours, initialMinuteOfDay, initialSecondsInMinute = 0 }) {
  hoursRef = hours;
  await loadIframeApi();

  const { hour, minute } = splitHM(initialMinuteOfDay);
  const startSeconds = minute * 60 + initialSecondsInMinute;
  currentHourLoaded = hour;
  const first = hours[hour];

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
      start: Math.floor(startSeconds),
    },
    events: {
      onReady: (e) => {
        try {
          if (startSeconds > 0) e.target.seekTo(startSeconds, true);
          enforceMinimumQuality(e.target);
          e.target.playVideo();
          scheduleQualityEnforcement(e.target);
        } catch (_) { /* ignore */ }
        readyResolve();
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED && onEndedCb) {
          onEndedCb(currentHourLoaded);
          return;
        }
        if (
          e.data === YT.PlayerState.PLAYING
          || e.data === YT.PlayerState.BUFFERING
          || e.data === YT.PlayerState.CUED
        ) {
          enforceMinimumQuality(e.target);
          scheduleQualityEnforcement(e.target);
        }
      },
    },
  });

  return readyPromise;
}

/**
 * Set playback position by minute-of-day. If the target hour differs from the
 * currently loaded video, the videoId is swapped via loadVideoById; otherwise
 * we just seekTo within the current video.
 *
 * `secondsInMinute` lets the caller pass a sub-minute offset when known
 * (e.g. wall-clock seconds for the live-tracking case).
 */
export async function setMinuteOfDay(minuteOfDay, { secondsInMinute = 0, force = false } = {}) {
  await readyPromise;
  if (!hoursRef) return;
  const { hour, minute } = splitHM(minuteOfDay);
  const seekSeconds = Math.max(0, Math.min(3599, minute * 60 + secondsInMinute));

  if (force || hour !== currentHourLoaded) {
    currentHourLoaded = hour;
    ytPlayer.loadVideoById({
      videoId: hoursRef[hour].videoId,
      startSeconds: Math.floor(seekSeconds),
    });
    scheduleQualityEnforcement(ytPlayer);
  } else {
    ytPlayer.seekTo(seekSeconds, true);
    enforceMinimumQuality(ytPlayer);
  }
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
  } catch (_) { return false; }
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
  setTimeout(() => enforceMinimumQuality(player), 250);
  setTimeout(() => enforceMinimumQuality(player), 1000);
  setTimeout(() => enforceMinimumQuality(player), 2500);
}

function enforceMinimumQuality(player) {
  if (!player) return;

  const targetQuality = resolvePreferredQuality(player);

  try {
    if (typeof player.setPlaybackQualityRange === "function") {
      player.setPlaybackQualityRange(targetQuality);
    }
  } catch (_) {
    // Optional API path; ignore failures.
  }

  try {
    if (typeof player.setPlaybackQuality === "function") {
      player.setPlaybackQuality(targetQuality);
    }
  } catch (_) {
    // Optional API path; ignore failures.
  }
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
