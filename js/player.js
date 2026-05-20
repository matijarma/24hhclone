import { splitHM } from "./time.js";

let ytPlayer = null;
let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });

let onEndedCb = null;
let currentHourLoaded = null;
let hoursRef = null;

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
      start: Math.floor(startSeconds),
    },
    events: {
      onReady: (e) => {
        try {
          if (startSeconds > 0) e.target.seekTo(startSeconds, true);
          e.target.playVideo();
        } catch (_) { /* ignore */ }
        readyResolve();
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED && onEndedCb) {
          onEndedCb(currentHourLoaded);
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
  } else {
    ytPlayer.seekTo(seekSeconds, true);
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
