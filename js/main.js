// 24 Hours of Happy - bootstrap (rev 2)
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
} from "./time.js";
import {
  initPlayer,
  setMinuteOfDay as playerSetMinuteOfDay,
  playPauseToggle,
  isPlaying,
  unmute,
  isMuted,
  getCurrentMinuteOfDay,
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
    showError(`${err.message} - try serving the folder over HTTP (see comment in js/main.js).`);
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
    const loadedHour = getCurrentHourLoaded();
    const expected = manualOverride && loadedHour !== null
      ? (loadedHour + 1) % 24
      : Math.floor(currentMinuteOfDay() / 60);
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
  const nowBtn = document.getElementById("now");
  const playPauseBtn = document.getElementById("playpause");
  const unmuteBtn = document.getElementById("unmute");
  const toggleBtn = document.getElementById("toggle-overlay");

  nowBtn?.addEventListener("click", resyncNow);
  playPauseBtn?.addEventListener("click", () => playPauseToggle());
  unmuteBtn?.addEventListener("click", async () => {
    await unmute();
    unmuteBtn.hidden = true;
  });
  toggleBtn?.addEventListener("click", () => {
    setOverlayHidden(!isOverlayHidden());
  });

  // Keep the button label and ARIA state in sync with the current class.
  updateOverlayToggleButton(isOverlayHidden());
}

function setOverlayHidden(hidden) {
  const nextHidden = Boolean(hidden);
  document.body.classList.toggle("overlay-hidden", nextHidden);
  updateOverlayToggleButton(nextHidden);
  announce(nextHidden ? "Overlay hidden." : "Overlay shown.");
}

function isOverlayHidden() {
  return document.body.classList.contains("overlay-hidden");
}

function updateOverlayToggleButton(hidden) {
  const toggleBtn = document.getElementById("toggle-overlay");
  if (!toggleBtn) return;

  toggleBtn.textContent = hidden ? "Show" : "Hide";
  toggleBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
  toggleBtn.setAttribute("aria-label", hidden ? "Show overlay" : "Hide overlay");
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
    } else if (e.key.toLowerCase() === "h") {
      e.preventDefault();
      setOverlayHidden(!isOverlayHidden());
    }
  });
}

function startTickers(svg) {
  // RAF loop: drive thumb + readout from the player while it is playing and the
  // user is not dragging. Wall-clock fallback is used when player time is absent.
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
  // videos slightly ahead of (or if we miss) the ENDED event.
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
    } catch (_) {
      // Player may not be ready yet.
    }
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
