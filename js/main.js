// 24 Hours of Happy — bootstrap (rev 2)
//
// Dev tip: some browsers block fetch() on file:// URLs. Serve over HTTP:
//   python -m http.server 8765
// then open http://localhost:8765/

import { loadHours } from "./hours.js";
import {
  currentMinuteOfDay,
  currentSecondsInMinute,
  parseDeepLink,
  writeDeepLink,
  clearDeepLink,
  formatTime,
  splitHM,
} from "./time.js";
import {
  initPlayer,
  setMinuteOfDay as playerSetMinuteOfDay,
  playPauseToggle,
  isPlaying,
  unmute,
  isMuted,
  getCurrentMinuteOfDay,
  getCurrentTimeSeconds,
  getCurrentHourLoaded,
  onHourEnded,
} from "./player.js";
import { initSlider, setMinuteOfDay as sliderSetMinuteOfDay } from "./slider.js";

let HOURS = [];
let manualOverride = false;

async function boot() {
  try {
    HOURS = await loadHours();
  } catch (err) {
    showError(err.message + " — try serving the folder over HTTP (see comment in js/main.js).");
    return;
  }

  const deep = parseDeepLink();
  const startMin = deep ? deep.minuteOfDay : currentMinuteOfDay();
  const startSec = deep ? deep.secondsInMinute : currentSecondsInMinute();
  manualOverride = !!deep;

  const svg = document.getElementById("slider");
  initSlider(svg, {
    initialMinute: startMin,
    onChange: onSliderChange,
  });
  updateReadout(startMin);

  await initPlayer({
    hours: HOURS,
    initialMinuteOfDay: startMin,
    initialSecondsInMinute: startSec,
  });

  onHourEnded(() => {
    const expected = manualOverride
      ? (getCurrentHourLoaded() + 1) % 24
      : currentMinuteOfDay() / 60 | 0;
    const nextMin = expected * 60;
    playerSetMinuteOfDay(nextMin, { force: true });
    sliderSetMinuteOfDay(nextMin);
    updateReadout(nextMin);
  });

  wireControls();
  wireGlobalKeys();
  startTickers(svg);
  pollUnmuteVisibility();
  watchPlayState();
}

function onSliderChange(min, { committed }) {
  manualOverride = true;
  playerSetMinuteOfDay(min);
  updateReadout(min);
  if (committed) {
    writeDeepLink(min);
    announce(`Now playing ${formatTime(min)}.`);
  }
}

function resyncNow() {
  manualOverride = false;
  const min = currentMinuteOfDay();
  const sec = currentSecondsInMinute();
  playerSetMinuteOfDay(min, { secondsInMinute: sec, force: true });
  sliderSetMinuteOfDay(min);
  updateReadout(min);
  clearDeepLink();
  announce(`Resynced to ${formatTime(min)}.`);
}

function wireControls() {
  document.getElementById("now").addEventListener("click", resyncNow);
  document.getElementById("playpause").addEventListener("click", () => playPauseToggle());
  document.getElementById("unmute").addEventListener("click", async () => {
    await unmute();
    document.getElementById("unmute").hidden = true;
  });
}

function wireGlobalKeys() {
  document.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    // Let the slider handle arrow keys etc. when focused.
    if (document.activeElement && document.activeElement.id === "slider") return;

    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      playPauseToggle();
    } else if (e.key.toLowerCase() === "n") {
      e.preventDefault();
      resyncNow();
    }
  });
}

function startTickers(svg) {
  // RAF loop: drive thumb + readout from the player while it's playing and the
  // user isn't dragging. Wall-clock fallback used when we don't yet have a
  // player time.
  function tick() {
    const isDragging = svg.classList.contains("dragging");
    if (!isDragging) {
      const playerMin = getCurrentMinuteOfDay();
      if (playerMin !== null) {
        sliderSetMinuteOfDay(playerMin);
        updateReadout(playerMin);
      } else if (!manualOverride) {
        const m = currentMinuteOfDay();
        sliderSetMinuteOfDay(m);
        updateReadout(m);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // 1s ticker: in live mode, detect wall-clock hour rollover so we can swap
  // videos slightly ahead of (or in case we lose) the ENDED event.
  setInterval(() => {
    if (manualOverride) return;
    const expectedHour = Math.floor(currentMinuteOfDay() / 60);
    const loaded = getCurrentHourLoaded();
    if (loaded !== null && expectedHour !== loaded) {
      const nextMin = expectedHour * 60 + (new Date().getMinutes());
      playerSetMinuteOfDay(nextMin, {
        secondsInMinute: currentSecondsInMinute(),
        force: true,
      });
      sliderSetMinuteOfDay(nextMin);
      updateReadout(nextMin);
    }
  }, 1000);
}

function watchPlayState() {
  const btn = document.getElementById("playpause");
  if (!btn) return;
  setInterval(async () => {
    try {
      btn.classList.toggle("is-playing", await isPlaying());
    } catch (_) { /* not ready */ }
  }, 500);
}

function updateReadout(min) {
  const el = document.getElementById("readout-time");
  if (el) el.textContent = formatTime(min);
}

async function pollUnmuteVisibility() {
  const btn = document.getElementById("unmute");
  if (!btn) return;
  try {
    if (await isMuted()) btn.hidden = false;
  } catch (_) {
    setTimeout(pollUnmuteVisibility, 1000);
  }
}

function announce(msg) {
  const el = document.getElementById("announcer");
  if (el) el.textContent = msg;
}

function showError(msg) {
  const root = document.querySelector("main") || document.body;
  const div = document.createElement("div");
  div.style.cssText = "color:#FCD42E;padding:1rem;text-align:center;max-width:40rem;margin:2rem auto;border:1px solid #FCD42E;border-radius:8px;";
  div.textContent = msg;
  root.appendChild(div);
}

boot();
