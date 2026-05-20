let ytPlayer = null;
let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });

let onEndedCb = null;
let currentHourLoaded = null;

export function onHourEnded(cb) {
  onEndedCb = cb;
}

export function getCurrentHourLoaded() {
  return currentHourLoaded;
}

export async function initPlayer({ hours, initialHour, initialSeek }) {
  await loadIframeApi();

  const first = hours[initialHour];
  currentHourLoaded = initialHour;

  ytPlayer = new YT.Player("player", {
    width: "100%",
    height: "100%",
    videoId: first.videoId,
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      mute: 1,
      cc_load_policy: 1,
      start: Math.floor(initialSeek),
    },
    events: {
      onReady: (e) => {
        try {
          if (initialSeek > 0) e.target.seekTo(initialSeek, true);
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

export async function loadHour(hours, hour, seekSeconds = 0) {
  await readyPromise;
  const entry = hours[hour];
  if (!entry) return;
  currentHourLoaded = hour;
  ytPlayer.loadVideoById({
    videoId: entry.videoId,
    startSeconds: Math.max(0, Math.floor(seekSeconds)),
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
