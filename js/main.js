// 24 Hours of Happy - bootstrap (rev 3)
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
  formatTime12h,
} from "./time.js";
import {
  initPlayer,
  setMinuteOfDay as playerSetMinuteOfDay,
  playPauseToggle,
  isPlaying,
  unmute,
  mute,
  isMuted,
  getCurrentMinuteOfDay,
  getCurrentHourLoaded,
  getCurrentTimeSeconds,
  onHourEnded,
} from "./player.js";
import {
  initSlider,
  setMinuteOfDay as sliderSetMinuteOfDay,
  setInteractive as sliderSetInteractive,
} from "./slider.js";

const TIME_FORMAT_24H = "24h";
const TIME_FORMAT_AMPM = "ampm";
const STORAGE_TIME_FORMAT_KEY = "24hh.time-format";
const CLOCK_DOUBLE_TAP_WINDOW_MS = 420;
const CLOCK_SINGLE_TAP_DELAY_MS = 240;

let HOURS = [];
let manualOverride = false;
let timeFormatMode = loadTimeFormatMode();
let clockWidgetMode = false;
let deferredInstallPrompt = null;
let clockTapLastAt = 0;
let clockTapTimer = null;
let ignoreClockTapUntil = 0;

async function boot() {
  wirePwaInstall();
  wireFullscreenListeners();
  registerServiceWorker();

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

  updateFormatToggleButton();
  updateReadout(startMin);
  updateClockWidgetOverlay();

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
    updateClockWidgetOverlay();
  });

  wireControls();
  wireGlobalKeys();
  startTickers(svg);
  watchPlayState();
  watchMuteState();
  await syncMuteButton();
}

function onSliderChange(min, { committed }) {
  manualOverride = true;
  playerSetMinuteOfDay(min);
  updateReadout(min);
  if (committed) {
    writeDeepLink(min);
    announce(`Now playing ${formatMinute(min)}.`);
  }
}

function resyncNow() {
  manualOverride = false;
  const min = currentMinuteOfDay();
  const sec = currentSecondsInMinute();
  playerSetMinuteOfDay(min, { secondsInMinute: sec, force: true });
  sliderSetMinuteOfDay(min);
  updateReadout(min);
  updateClockWidgetOverlay();
  clearDeepLink();
  announce(`Resynced to ${formatMinute(min)}.`);
}

function wireControls() {
  const nowBtn = document.getElementById("now");
  const playPauseBtn = document.getElementById("playpause");
  const muteBtn = document.getElementById("mute-toggle");
  const toggleBtn = document.getElementById("toggle-overlay");
  const formatBtn = document.getElementById("format-toggle");
  const installBtn = document.getElementById("install-app");
  const widgetBtn = document.getElementById("clock-widget");

  nowBtn?.addEventListener("click", resyncNow);
  playPauseBtn?.addEventListener("click", () => playPauseToggle());
  muteBtn?.addEventListener("click", () => {
    void toggleMuteState();
  });
  toggleBtn?.addEventListener("click", () => {
    setOverlayHidden(!isOverlayHidden());
  });
  formatBtn?.addEventListener("click", toggleTimeFormat);
  installBtn?.addEventListener("click", () => {
    void promptInstall();
  });
  widgetBtn?.addEventListener("click", () => {
    void enterClockWidgetMode();
  });

  updateOverlayToggleButton(isOverlayHidden());
  updateFormatToggleButton();
}

function wireGlobalKeys() {
  document.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (clockWidgetMode) {
      if (e.key === "Escape") {
        e.preventDefault();
        void exitClockWidgetMode();
      }
      return;
    }

    if (document.activeElement && document.activeElement.id === "slider") return;

    const key = e.key.toLowerCase();
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      playPauseToggle();
    } else if (key === "n") {
      e.preventDefault();
      resyncNow();
    } else if (key === "h") {
      e.preventDefault();
      setOverlayHidden(!isOverlayHidden());
    } else if (key === "m") {
      e.preventDefault();
      void toggleMuteState();
    }
  });
}

function wireFullscreenListeners() {
  document.addEventListener("fullscreenchange", () => {
    if (!clockWidgetMode) return;
    if (!document.fullscreenElement) {
      void exitClockWidgetMode({ fromFullscreenChange: true });
    }
  });
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

function toggleTimeFormat() {
  timeFormatMode = timeFormatMode === TIME_FORMAT_24H
    ? TIME_FORMAT_AMPM
    : TIME_FORMAT_24H;
  persistTimeFormatMode(timeFormatMode);
  updateFormatToggleButton();
  updateReadout(getClockReference().minuteFloor);
  announce(`Time format set to ${timeFormatMode === TIME_FORMAT_24H ? "24-hour" : "AM/PM"}.`);
}

function updateFormatToggleButton() {
  const formatBtn = document.getElementById("format-toggle");
  if (!formatBtn) return;

  const is24h = timeFormatMode === TIME_FORMAT_24H;
  formatBtn.textContent = is24h ? "24h" : "AM/PM";
  formatBtn.setAttribute("aria-pressed", is24h ? "false" : "true");
  formatBtn.setAttribute(
    "aria-label",
    is24h ? "Switch to 12-hour time" : "Switch to 24-hour time",
  );
}

async function toggleMuteState() {
  try {
    if (await isMuted()) {
      await unmute();
    } else {
      await mute();
    }
    await syncMuteButton();
  } catch (_) {
    // Player might not be ready yet.
  }
}

async function syncMuteButton() {
  const muteBtn = document.getElementById("mute-toggle");
  if (!muteBtn) return;

  try {
    const muted = await isMuted();
    muteBtn.textContent = muted ? "Unmute" : "Mute";
    muteBtn.classList.toggle("ctrl-unmute", muted);
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.setAttribute("aria-label", muted ? "Unmute video" : "Mute video");
  } catch (_) {
    // Player might not be ready yet.
  }
}

function watchMuteState() {
  setInterval(() => {
    void syncMuteButton();
  }, 900);
}

function startTickers(svg) {
  function tick() {
    const isDragging = svg.classList.contains("dragging");
    if (!clockWidgetMode && !isDragging) {
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

    if (clockWidgetMode) {
      updateClockWidgetOverlay();
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

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
      updateClockWidgetOverlay();
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

async function enterClockWidgetMode() {
  if (clockWidgetMode) return;

  clockWidgetMode = true;
  ignoreClockTapUntil = performance.now() + 350;
  document.body.classList.add("clock-mode");
  sliderSetInteractive(false);
  attachClockWidgetInput();
  updateClockWidgetOverlay();

  const stage = document.getElementById("stage");
  if (stage?.requestFullscreen) {
    try {
      await stage.requestFullscreen();
    } catch (_) {
      // Fullscreen may be blocked on some browsers/devices.
    }
  }

  announce("Clock widget mode enabled.");
}

async function exitClockWidgetMode({ fromFullscreenChange = false } = {}) {
  if (!clockWidgetMode) return;

  clockWidgetMode = false;
  document.body.classList.remove("clock-mode");
  sliderSetInteractive(true);
  detachClockWidgetInput();
  clearClockTapTimer();
  clockTapLastAt = 0;

  if (!fromFullscreenChange && document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (_) {
      // Ignore exit failures.
    }
  }

  announce("Clock widget mode disabled.");
}

function attachClockWidgetInput() {
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.addEventListener("pointerup", onClockWidgetPointerUp);
  stage.addEventListener("dblclick", onClockWidgetDoubleClick);
}

function detachClockWidgetInput() {
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.removeEventListener("pointerup", onClockWidgetPointerUp);
  stage.removeEventListener("dblclick", onClockWidgetDoubleClick);
}

function onClockWidgetPointerUp(e) {
  if (!clockWidgetMode) return;
  if (e.button !== undefined && e.button !== 0) return;

  const now = performance.now();
  if (now < ignoreClockTapUntil) return;

  if (now - clockTapLastAt <= CLOCK_DOUBLE_TAP_WINDOW_MS) {
    clockTapLastAt = 0;
    clearClockTapTimer();
    void exitClockWidgetMode();
    return;
  }

  clockTapLastAt = now;
  clearClockTapTimer();
  clockTapTimer = window.setTimeout(() => {
    clockTapTimer = null;
    if (!clockWidgetMode) return;
    void toggleMuteState();
  }, CLOCK_SINGLE_TAP_DELAY_MS);
}

function onClockWidgetDoubleClick(e) {
  if (!clockWidgetMode) return;
  e.preventDefault();
  clearClockTapTimer();
  void exitClockWidgetMode();
}

function clearClockTapTimer() {
  if (clockTapTimer !== null) {
    clearTimeout(clockTapTimer);
    clockTapTimer = null;
  }
}

function updateClockWidgetOverlay() {
  const timeEl = document.getElementById("clock-widget-time");
  const hourHand = document.getElementById("clock-hour-hand");
  const minuteHand = document.getElementById("clock-minute-hand");
  if (!timeEl || !hourHand || !minuteHand) return;

  const { minuteExact, minuteFloor } = getClockReference();
  timeEl.textContent = formatTime12h(minuteFloor);

  const minuteInHour = minuteExact % 60;
  const hour24 = Math.floor(minuteExact / 60) % 24;
  const hour12 = hour24 % 12;

  const minuteAngle = (minuteInHour / 60) * 360;
  const hourAngle = ((hour12 + (minuteInHour / 60)) / 12) * 360;

  minuteHand.style.transform = `translateX(-50%) rotate(${minuteAngle}deg)`;
  hourHand.style.transform = `translateX(-50%) rotate(${hourAngle}deg)`;
}

function getClockReference() {
  const loadedHour = getCurrentHourLoaded();
  if (loadedHour !== null) {
    const seconds = getCurrentTimeSeconds();
    if (Number.isFinite(seconds)) {
      const clampedSeconds = Math.max(0, Math.min(3599.999, seconds));
      const minuteExact = normalizeMinute(loadedHour * 60 + (clampedSeconds / 60));
      return {
        minuteExact,
        minuteFloor: Math.floor(minuteExact),
      };
    }
  }

  const playerMin = getCurrentMinuteOfDay();
  if (playerMin !== null) {
    const minute = normalizeMinute(playerMin);
    return { minuteExact: minute, minuteFloor: minute };
  }

  const now = new Date();
  const minuteExact = normalizeMinute(
    now.getHours() * 60 + now.getMinutes() + (now.getSeconds() / 60),
  );
  return {
    minuteExact,
    minuteFloor: Math.floor(minuteExact),
  };
}

function normalizeMinute(minuteOfDay) {
  return ((minuteOfDay % 1440) + 1440) % 1440;
}

function updateReadout(min) {
  const el = document.getElementById("readout-time");
  if (el) el.textContent = formatMinute(min);
}

function formatMinute(minuteOfDay, { force12h = false } = {}) {
  if (force12h) return formatTime12h(minuteOfDay);
  return formatTime(minuteOfDay, timeFormatMode);
}

function loadTimeFormatMode() {
  try {
    const stored = localStorage.getItem(STORAGE_TIME_FORMAT_KEY);
    if (stored === TIME_FORMAT_AMPM || stored === TIME_FORMAT_24H) {
      return stored;
    }
  } catch (_) {
    // Local storage unavailable.
  }
  return TIME_FORMAT_24H;
}

function persistTimeFormatMode(mode) {
  try {
    localStorage.setItem(STORAGE_TIME_FORMAT_KEY, mode);
  } catch (_) {
    // Local storage unavailable.
  }
}

function wirePwaInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    refreshInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    refreshInstallButton();
    announce("App installed.");
  });

  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  const onStandaloneChange = () => refreshInstallButton();
  if (typeof standaloneQuery.addEventListener === "function") {
    standaloneQuery.addEventListener("change", onStandaloneChange);
  } else if (typeof standaloneQuery.addListener === "function") {
    standaloneQuery.addListener(onStandaloneChange);
  }

  refreshInstallButton();
}

function isStandaloneMode() {
  const standaloneMatch = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = window.navigator.standalone === true;
  return standaloneMatch || iosStandalone;
}

function refreshInstallButton() {
  const btn = document.getElementById("install-app");
  if (!btn) return;
  const shouldShow = Boolean(deferredInstallPrompt) && !isStandaloneMode();
  btn.hidden = !shouldShow;
}

async function promptInstall() {
  if (!deferredInstallPrompt || isStandaloneMode()) return;

  try {
    await deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
  } catch (_) {
    // Ignore prompt failures.
  }

  deferredInstallPrompt = null;
  refreshInstallButton();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Ignore registration errors.
    });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
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
