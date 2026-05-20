// 24 Hours of Happy — bootstrap
//
// Dev tip: some browsers block fetch() on file:// URLs. If the page is blank,
// serve the folder over HTTP, e.g.:
//   python -m http.server 8000
// then open http://localhost:8000/

import { loadHours } from "./hours.js";
import {
  currentHour,
  currentMinuteSeconds,
  parseDeepLink,
  writeDeepLink,
  clearDeepLink,
  hourLabel,
} from "./time.js";
import {
  initPlayer,
  loadHour,
  playPauseToggle,
  unmute,
  isMuted,
  onHourEnded,
} from "./player.js";
import { renderRing, setActiveHour, updateReadout } from "./clock.js";

let HOURS = [];
let manualOverride = false;
let lastTickHour = -1;

async function boot() {
  try {
    HOURS = await loadHours();
  } catch (err) {
    showError(err.message + " — try serving the folder over HTTP (see comment in js/main.js).");
    return;
  }

  const deep = parseDeepLink();
  const startHour = deep ? deep.hour : currentHour();
  const startSeek = deep ? deep.seekSeconds : currentMinuteSeconds();
  manualOverride = !!deep;

  const ring = document.getElementById("ring");
  renderRing(ring, HOURS, onHourClick);
  setActiveHour(startHour);
  updateReadout(startHour, deep ? Math.floor(deep.seekSeconds / 60) : new Date().getMinutes());

  await initPlayer({ hours: HOURS, initialHour: startHour, initialSeek: startSeek });

  onHourEnded(() => {
    // 60-min video ended. If we're tracking wall-clock, snap to it; otherwise advance.
    if (manualOverride) {
      const next = (currentLoadedHourFromActive() + 1) % 24;
      onHourClick(next);
    } else {
      const h = currentHour();
      loadHour(HOURS, h, currentMinuteSeconds());
      setActiveHour(h);
    }
  });

  wireControls();
  wireKeyboard();
  startTicker();

  // Reveal unmute affordance until the user un-mutes.
  pollUnmuteVisibility();

  // Re-render ring on breakpoint flip (orientation/resize across the mobile boundary).
  let lastIsMobile = window.matchMedia("(max-width: 800px)").matches;
  window.addEventListener("resize", () => {
    const nowMobile = window.matchMedia("(max-width: 800px)").matches;
    if (nowMobile !== lastIsMobile) {
      lastIsMobile = nowMobile;
      renderRing(ring, HOURS, onHourClick);
      setActiveHour(activeHourGuess());
    }
  });
}

function activeHourGuess() {
  // After re-render we re-mark whichever hour we last announced.
  return lastTickHour >= 0 ? lastTickHour : currentHour();
}

function onHourClick(hour) {
  manualOverride = true;
  loadHour(HOURS, hour, 0);
  setActiveHour(hour);
  updateReadout(hour, 0);
  writeDeepLink({ hour });
  announce(`Now playing ${hourLabel(hour)}.`);
}

function step(delta) {
  const base = manualOverride ? currentLoadedHourFromActive() : currentHour();
  const next = ((base + delta) % 24 + 24) % 24;
  onHourClick(next);
}

function currentLoadedHourFromActive() {
  // Read aria-pressed off the buttons to find the active hour.
  const pressed = document.querySelector('.hour-btn[aria-pressed="true"]');
  if (!pressed) return currentHour();
  return parseInt(pressed.dataset.hour, 10);
}

function resyncNow() {
  manualOverride = false;
  const h = currentHour();
  const s = currentMinuteSeconds();
  loadHour(HOURS, h, s);
  setActiveHour(h);
  updateReadout(h, new Date().getMinutes());
  clearDeepLink();
  announce(`Resynced to ${hourLabel(h)}.`);
}

function wireControls() {
  document.getElementById("prev").addEventListener("click", () => step(-1));
  document.getElementById("next").addEventListener("click", () => step(+1));
  document.getElementById("now").addEventListener("click", resyncNow);
  document.getElementById("playpause").addEventListener("click", () => playPauseToggle());
  document.getElementById("unmute").addEventListener("click", async () => {
    await unmute();
    document.getElementById("unmute").hidden = true;
  });
}

function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    // Ignore when typing in an input field
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(+1); }
    else if (e.key === " " || e.code === "Space") { e.preventDefault(); playPauseToggle(); }
    else if (e.key.toLowerCase() === "n") { e.preventDefault(); resyncNow(); }
  });
}

function startTicker() {
  setInterval(() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();

    if (!manualOverride) {
      updateReadout(h, m);
      if (h !== lastTickHour) {
        if (lastTickHour !== -1) {
          // Hour rolled over: swap video.
          loadHour(HOURS, h, 0);
          setActiveHour(h);
        }
        lastTickHour = h;
      }
    }
  }, 1000);
}

async function pollUnmuteVisibility() {
  // Wait a beat for the player to be ready, then check muted state.
  const btn = document.getElementById("unmute");
  if (!btn) return;
  try {
    if (await isMuted()) btn.hidden = false;
  } catch (_) {
    // Player not ready yet; try again shortly.
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
