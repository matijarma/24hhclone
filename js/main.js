// 24 Hours of Happy - bootstrap (rev 4)
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
  getCurrentMinuteExact,
  getCurrentSecondOfDay,
  setCustomPlaylist,
} from "./player.js";
import {
  initSlider,
  setMinuteOfDay as sliderSetMinuteOfDay,
  setInteractive as sliderSetInteractive,
  setLabelMode as sliderSetLabelMode,
} from "./slider.js";

const TIME_FORMAT_24H = "24h";
const TIME_FORMAT_AMPM = "ampm";
const STORAGE_TIME_FORMAT_KEY = "24hh.time-format";
const STORAGE_CUSTOM_LAYOUT_KEY = "24hh.custom-layout.v1";

const CLOCK_DOUBLE_TAP_WINDOW_MS = 420;
const CLOCK_SINGLE_TAP_DELAY_MS = 240;
const UI_IDLE_DELAY_MS = 8000;
const CUSTOM_SYNC_DEBOUNCE_MS = 140;
const MOBILE_PICKER_BREAKPOINT = 900;

const SLOT_MINUTES = 4;
const SLOT_SECONDS = SLOT_MINUTES * 60;
const SLOTS_PER_HOUR = 15;
const SLOTS_PER_DAY = 24 * SLOTS_PER_HOUR;

const SVG_NS = "http://www.w3.org/2000/svg";

let HOURS = [];
let FAN_VIDEOS = [];
let FAN_BY_ID = new Map();
let FAN_COUNTRIES = [];
let flaggedFanVideoIds = new Set();

let customAssignments = createEmptyAssignments();
let pickerState = {
  openCountry: "",
  search: "",
};
let activeBrushVideoId = null;
let slotCellEls = new Array(SLOTS_PER_DAY).fill(null);
let slotCaptionEls = new Array(24).fill(null);
let customizerOpen = false;
let customizerReady = false;
let paintDragging = false;
let customSyncTimer = null;
let pendingPaintSlotIndex = null;
let closeAnimTimer = null;
let lastNowHourRow = null;
let lastNowSlotEl = null;
let mobileSheetState = {
  open: false,
  slotIndex: null,
};

let manualOverride = false;
let timeFormatMode = loadTimeFormatMode();
let clockWidgetMode = false;
let deferredInstallPrompt = null;
let clockTapLastAt = 0;
let clockTapTimer = null;
let ignoreClockTapUntil = 0;
let normalTapLastAt = 0;
let normalTapTimer = null;
let uiIdleTimer = null;

async function boot() {
  wirePwaInstall();
  wireFullscreenListeners();
  registerServiceWorker();
  void triggerYoutubeHealthCheck();

  try {
    HOURS = await loadHours();
  } catch (err) {
    showError(`${err.message} - try serving the folder over HTTP (see comment in js/main.js).`);
    return;
  }

  try {
    FAN_VIDEOS = await loadFanVideos();
    rebuildFanCatalogIndexes();
    applyFlaggedFanVideoFilter();
  } catch (err) {
    FAN_VIDEOS = [];
    rebuildFanCatalogIndexes();
    console.warn("Failed to load fan database:", err);
  }

  customAssignments = loadCustomAssignments(FAN_BY_ID);

  const deep = parseDeepLink();
  const startMin = deep ? deep.minuteOfDay : currentMinuteOfDay();
  const startSec = deep ? deep.secondsInMinute : currentSecondsInMinute();
  manualOverride = !!deep;

  const svg = document.getElementById("slider");
  initSlider(svg, {
    initialMinute: startMin,
    onChange: onSliderChange,
  });
  initClockWidgetDial();
  sliderSetLabelMode(timeFormatMode);

  initCustomizerUi();
  updateFormatToggleButton();
  updateReadout(startMin);
  updateClockWidgetOverlay();

  await initPlayer({
    hours: HOURS,
    initialMinuteOfDay: startMin,
    initialSecondsInMinute: startSec,
    assignmentsBySlot: customAssignments,
    fanVideos: FAN_VIDEOS,
  });

  wireControls();
  wireNormalQuickActions();
  wireGlobalKeys();
  wireUiAutoHide();
  startTickers(svg);
  watchPlayState();
  watchMuteState();
  await syncMuteButton();
}

async function triggerYoutubeHealthCheck() {
  try {
    const res = await fetch("/api/youtube-health", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      keepalive: true,
    });
    if (!res.ok) return;

    const payload = await res.json();
    const flaggedIds = extractFlaggedVideoIdSet(payload);
    setFlaggedFanVideoIds(flaggedIds);

    if (flaggedIds.size > 0) {
      console.warn(
        `[24hh] Excluding ${flaggedIds.size} private/unembeddable fan video(s).`,
        payload.privateOrUnembeddable,
      );
    }
  } catch (_) {
    // Local static hosting or non-worker environments can fail this check.
  }
}

function extractFlaggedVideoIdSet(payload) {
  const flaggedRows = Array.isArray(payload && payload.privateOrUnembeddable)
    ? payload.privateOrUnembeddable
    : [];
  const ids = new Set();

  for (const row of flaggedRows) {
    const videoId = normalizeVideoId(row && row.videoId);
    if (!videoId) continue;
    ids.add(videoId);
  }

  return ids;
}

function setFlaggedFanVideoIds(nextIds) {
  if (!(nextIds instanceof Set)) return;
  if (areStringSetsEqual(flaggedFanVideoIds, nextIds)) return;
  flaggedFanVideoIds = new Set(nextIds);
  applyFlaggedFanVideoFilter();
}

function applyFlaggedFanVideoFilter() {
  if (!Array.isArray(FAN_VIDEOS) || FAN_VIDEOS.length === 0) return;
  if (!(flaggedFanVideoIds instanceof Set) || flaggedFanVideoIds.size === 0) return;

  const nextVideos = FAN_VIDEOS.filter((fan) => !flaggedFanVideoIds.has(fan.videoId));
  if (nextVideos.length === FAN_VIDEOS.length) return;

  FAN_VIDEOS = nextVideos;
  rebuildFanCatalogIndexes();

  let assignmentsChanged = false;
  for (let i = 0; i < customAssignments.length; i++) {
    const assignedId = customAssignments[i];
    if (!assignedId) continue;
    if (FAN_BY_ID.has(assignedId)) continue;
    customAssignments[i] = null;
    assignmentsChanged = true;
  }

  if (activeBrushVideoId && !FAN_BY_ID.has(activeBrushVideoId)) {
    activeBrushVideoId = null;
  }

  if (customizerReady) {
    renderBrushBar();
    renderPickerLists();
    renderAllSlotCells();
    renderAllRowCaptions();
  }

  updateCustomizeButtonState();

  if (assignmentsChanged) {
    persistCustomAssignments(customAssignments);
  }

  setCustomPlaylist({ assignmentsBySlot: customAssignments, fanVideos: FAN_VIDEOS });
}

function rebuildFanCatalogIndexes() {
  FAN_BY_ID = new Map(FAN_VIDEOS.map((entry) => [entry.videoId, entry]));
  FAN_COUNTRIES = Array.from(new Set(FAN_VIDEOS.map((entry) => entry.country))).sort((a, b) => a.localeCompare(b));
}

function areStringSetsEqual(a, b) {
  if (a === b) return true;
  if (!(a instanceof Set) || !(b instanceof Set)) return false;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function onSliderChange(min, { committed }) {
  manualOverride = true;
  void playerSetMinuteOfDay(min);
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
  void playerSetMinuteOfDay(min, { secondsInMinute: sec, force: true });
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
  const customizeBtn = document.getElementById("customize-playlist");

  nowBtn?.addEventListener("click", resyncNow);
  playPauseBtn?.addEventListener("click", () => {
    void playPauseToggle();
  });
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
  customizeBtn?.addEventListener("click", openCustomizerModal);

  updateOverlayToggleButton(isOverlayHidden());
  updateFormatToggleButton();
  updateCustomizeButtonState();
}

function wireNormalQuickActions() {
  document.addEventListener("click", onNormalModeClick);
  document.addEventListener("dblclick", onNormalModeDoubleClick);
}

function onNormalModeClick(e) {
  if (clockWidgetMode || customizerOpen) return;
  if (e.button !== undefined && e.button !== 0) return;
  if (isNormalModeSingleTapExcluded(e.target)) return;

  const now = performance.now();
  if (now - normalTapLastAt <= CLOCK_DOUBLE_TAP_WINDOW_MS) {
    normalTapLastAt = 0;
    clearNormalTapTimer();
    void enterClockWidgetMode();
    return;
  }

  normalTapLastAt = now;
  clearNormalTapTimer();
  normalTapTimer = window.setTimeout(() => {
    normalTapTimer = null;
    if (clockWidgetMode || customizerOpen) return;
    void toggleMuteState();
  }, CLOCK_SINGLE_TAP_DELAY_MS);
}

function onNormalModeDoubleClick(e) {
  if (clockWidgetMode || customizerOpen) return;
  if (e.button !== undefined && e.button !== 0) return;
  if (isNormalModeDoubleTapExcluded(e.target)) return;
  e.preventDefault();
  normalTapLastAt = 0;
  clearNormalTapTimer();
  void enterClockWidgetMode();
}

function clearNormalTapTimer() {
  if (normalTapTimer !== null) {
    clearTimeout(normalTapTimer);
    normalTapTimer = null;
  }
}

function isNormalModeSingleTapExcluded(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".controls, #slider, footer, header, a, button, .customize-modal"));
}

function isNormalModeDoubleTapExcluded(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".controls, footer, header, a, button, .customize-modal"));
}

function wireGlobalKeys() {
  document.addEventListener("keydown", (e) => {
    if (customizerOpen && e.key === "Escape") {
      e.preventDefault();
      if (mobileSheetState.open) closeMobileSheet();
      else closeCustomizerModal();
      return;
    }

    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (customizerOpen) return;

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
      void playPauseToggle();
    } else if (key === "n") {
      e.preventDefault();
      resyncNow();
    } else if (key === "h") {
      e.preventDefault();
      setOverlayHidden(!isOverlayHidden());
    } else if (key === "m") {
      e.preventDefault();
      void toggleMuteState();
    } else if (key === "c") {
      e.preventDefault();
      openCustomizerModal();
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
  syncSliderInteractivity();
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
  sliderSetLabelMode(timeFormatMode);
  updateFormatToggleButton();
  updateReadout(getClockReference().minuteFloor);
  announce(`Time format set to ${timeFormatMode === TIME_FORMAT_24H ? "24-hour" : "AM/PM"}.`);

  if (customizerOpen) {
    renderAllSlotCells();
  }
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
    if (!clockWidgetMode && !isDragging && !customizerOpen) {
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

    if (customizerOpen) {
      tickCustomizerNow();
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  setInterval(() => {
    if (manualOverride) return;

    const expectedSec = (currentMinuteOfDay() * 60) + currentSecondsInMinute();
    const playerSec = getCurrentSecondOfDay();
    if (!Number.isFinite(playerSec)) return;

    const drift = shortestSecondDelta(playerSec, expectedSec);
    if (Math.abs(drift) <= 4) return;

    const nextMin = currentMinuteOfDay();
    const nextSecInMinute = currentSecondsInMinute();

    void playerSetMinuteOfDay(nextMin, {
      secondsInMinute: nextSecInMinute,
      force: true,
    });

    sliderSetMinuteOfDay(nextMin);
    updateReadout(nextMin);
    updateClockWidgetOverlay();
  }, 1000);
}

function shortestSecondDelta(actual, expected) {
  let diff = actual - expected;
  const dayHalf = 24 * 60 * 60 / 2;
  const day = 24 * 60 * 60;

  while (diff > dayHalf) diff -= day;
  while (diff < -dayHalf) diff += day;
  return diff;
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
  if (clockWidgetMode || customizerOpen) return;

  clearNormalTapTimer();
  normalTapLastAt = 0;
  clockWidgetMode = true;
  ignoreClockTapUntil = performance.now() + 350;
  document.body.classList.add("clock-mode");
  syncSliderInteractivity();
  attachClockWidgetInput();
  updateClockWidgetOverlay();

  const fullscreenTarget = document.documentElement;
  if (fullscreenTarget?.requestFullscreen) {
    try {
      await fullscreenTarget.requestFullscreen();
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
  syncSliderInteractivity();
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
  clockTapLastAt = 0;
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
  timeEl.textContent = formatMinute(minuteFloor);

  const minuteInHour = minuteExact % 60;
  const hour24 = Math.floor(minuteExact / 60) % 24;
  const hour12 = hour24 % 12;

  const minuteAngle = (minuteInHour / 60) * 360;
  const hourAngle = ((hour12 + (minuteInHour / 60)) / 12) * 360;

  minuteHand.style.transform = `translateX(-50%) rotate(${minuteAngle}deg)`;
  hourHand.style.transform = `translateX(-50%) rotate(${hourAngle}deg)`;
}

function initClockWidgetDial() {
  const dial = document.getElementById("clock-widget-dial");
  if (!dial || dial.dataset.ready === "1") return;

  dial.textContent = "";

  appendSvg(dial, "circle", {
    cx: 0,
    cy: 0,
    r: 380,
    class: "clock-dial-track",
  });

  for (let h = 0; h < 12; h++) {
    const theta = clockHourToAngle(h);
    const cardinal = h === 0 || h === 3 || h === 6 || h === 9;
    const inner = 380;
    const outer = cardinal ? 420 : 402;

    appendSvg(dial, "line", {
      x1: Math.cos(theta) * inner,
      y1: Math.sin(theta) * inner,
      x2: Math.cos(theta) * outer,
      y2: Math.sin(theta) * outer,
      class: cardinal ? "clock-dial-tick cardinal" : "clock-dial-tick",
    });
  }

  const labels = [
    { h: 0, text: "12" },
    { h: 3, text: "3" },
    { h: 6, text: "6" },
    { h: 9, text: "9" },
  ];
  for (const { h, text } of labels) {
    const theta = clockHourToAngle(h);
    appendSvg(dial, "text", {
      x: Math.cos(theta) * 452,
      y: Math.sin(theta) * 452,
      class: "clock-dial-label",
      textContent: text,
    });
  }

  dial.dataset.ready = "1";
}

function clockHourToAngle(hour) {
  return (hour / 12) * Math.PI * 2 - Math.PI / 2;
}

function appendSvg(parent, tagName, attrs) {
  const el = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "textContent") {
      el.textContent = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }
  parent.appendChild(el);
  return el;
}

function getClockReference() {
  const minuteExact = getCurrentMinuteExact();
  if (Number.isFinite(minuteExact)) {
    const normalized = normalizeMinute(minuteExact);
    return {
      minuteExact: normalized,
      minuteFloor: Math.floor(normalized),
    };
  }

  const playerMin = getCurrentMinuteOfDay();
  if (playerMin !== null) {
    const minute = normalizeMinute(playerMin);
    return { minuteExact: minute, minuteFloor: minute };
  }

  const now = new Date();
  const fallback = normalizeMinute(
    now.getHours() * 60 + now.getMinutes() + (now.getSeconds() / 60),
  );
  return {
    minuteExact: fallback,
    minuteFloor: Math.floor(fallback),
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

function initCustomizerUi() {
  const modal = document.getElementById("customize-modal");
  const grid = document.getElementById("customize-grid");
  const desktopRoot = document.getElementById("custom-desktop-picker");
  const desktopSearch = document.getElementById("custom-picker-search");
  const sheetRoot = document.getElementById("custom-sheet-list");
  const sheetSearch = document.getElementById("custom-sheet-search");
  const sheetCloseBtn = document.getElementById("custom-sheet-close");
  const closeTopBtn = document.getElementById("customize-close");
  const closeBottomBtn = document.getElementById("customize-done");
  const resetBtn = document.getElementById("custom-reset");
  const clearBrushBtn = document.getElementById("custom-clear-brush");
  const sheetEl = document.getElementById("custom-mobile-picker");
  const backdrop = modal?.querySelector(".customize-backdrop");

  if (!modal || !grid || !desktopRoot || !desktopSearch || !sheetRoot || !sheetSearch) return;

  buildCustomizerGrid(grid);
  renderBrushBar();
  renderPickerLists();
  renderAllSlotCells();
  renderAllRowCaptions();
  renderCustomizerStatus();

  const syncSearchInputs = (value) => {
    pickerState.search = value;
    if (desktopSearch.value !== value) desktopSearch.value = value;
    if (sheetSearch.value !== value) sheetSearch.value = value;
    renderPickerLists();
  };
  desktopSearch.addEventListener("input", () => syncSearchInputs(desktopSearch.value));
  sheetSearch.addEventListener("input", () => syncSearchInputs(sheetSearch.value));

  desktopRoot.addEventListener("click", onPickerListClick);
  sheetRoot.addEventListener("click", onPickerListClick);

  grid.addEventListener("pointerdown", onGridPointerDown);
  grid.addEventListener("pointerover", onGridPointerOver);
  grid.addEventListener("click", onGridClickFallback);
  grid.addEventListener("dblclick", onGridDoubleClick);
  window.addEventListener("pointerup", () => {
    paintDragging = false;
  });

  closeTopBtn?.addEventListener("click", closeCustomizerModal);
  closeBottomBtn?.addEventListener("click", closeCustomizerModal);
  resetBtn?.addEventListener("click", resetCustomLayout);
  clearBrushBtn?.addEventListener("click", () => setActiveBrush(null));
  sheetCloseBtn?.addEventListener("click", closeMobileSheet);

  backdrop?.addEventListener("click", () => {
    if (mobileSheetState.open) closeMobileSheet();
    else closeCustomizerModal();
  });

  if (sheetEl) {
    sheetEl.addEventListener("click", (e) => {
      if (e.target === sheetEl) closeMobileSheet();
    });
  }

  customizerReady = true;
  updateCustomizeButtonState();
}

function openCustomizerModal() {
  if (!customizerReady) return;
  if (FAN_VIDEOS.length === 0) {
    announce("Fan video database is unavailable.");
    return;
  }

  const modal = document.getElementById("customize-modal");
  if (!modal) return;

  if (closeAnimTimer !== null) {
    clearTimeout(closeAnimTimer);
    closeAnimTimer = null;
  }

  customizerOpen = true;
  pendingPaintSlotIndex = null;
  modal.hidden = false;
  modal.dataset.state = "opening";
  document.body.classList.add("customize-open");
  syncSliderInteractivity();

  pickerState.search = "";
  const desktopSearch = document.getElementById("custom-picker-search");
  const sheetSearch = document.getElementById("custom-sheet-search");
  if (desktopSearch) desktopSearch.value = "";
  if (sheetSearch) sheetSearch.value = "";

  renderBrushBar();
  renderPickerLists();
  renderAllSlotCells();
  renderAllRowCaptions();
  renderCustomizerStatus();
  tickCustomizerNow();

  requestAnimationFrame(() => {
    modal.dataset.state = "open";
    requestAnimationFrame(() => {
      const closeBtn = document.getElementById("customize-close");
      closeBtn?.focus();
    });
  });
}

function closeCustomizerModal() {
  const modal = document.getElementById("customize-modal");
  if (!modal) return;

  customizerOpen = false;
  paintDragging = false;
  pendingPaintSlotIndex = null;
  clearNowMarker();
  closeMobileSheet({ immediate: true });

  modal.dataset.state = "closing";

  if (closeAnimTimer !== null) clearTimeout(closeAnimTimer);
  closeAnimTimer = window.setTimeout(() => {
    closeAnimTimer = null;
    modal.hidden = true;
    modal.dataset.state = "closed";
  }, 240);

  document.body.classList.remove("customize-open");
  syncSliderInteractivity();
}

function syncSliderInteractivity() {
  const interactive = !clockWidgetMode && !customizerOpen && !isOverlayHidden();
  sliderSetInteractive(interactive);
}

function updateCustomizeButtonState() {
  const btn = document.getElementById("customize-playlist");
  if (!btn) return;

  const assignedCount = countAssignedSlots();
  btn.textContent = assignedCount > 0
    ? `Customize (${assignedCount})`
    : "Customize";

  if (FAN_VIDEOS.length === 0) {
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
    btn.title = "Fan video database unavailable";
  } else {
    btn.disabled = false;
    btn.removeAttribute("aria-disabled");
    btn.title = "Customize 24h slots";
  }
}

function buildCustomizerGrid(gridRoot) {
  slotCellEls = new Array(SLOTS_PER_DAY).fill(null);
  slotCaptionEls = new Array(24).fill(null);
  gridRoot.textContent = "";

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");
    row.className = "custom-row";
    row.dataset.hour = String(hour);

    const hourLabel = document.createElement("button");
    hourLabel.type = "button";
    hourLabel.className = "custom-row-label";
    if (hour % 6 === 0) hourLabel.classList.add("is-cardinal");
    hourLabel.textContent = String(hour).padStart(2, "0");
    hourLabel.setAttribute("aria-label", `Fill hour ${String(hour).padStart(2, "0")} with current brush`);
    hourLabel.addEventListener("click", () => onHourLabelClick(hour));

    const slotsWrap = document.createElement("div");
    slotsWrap.className = "custom-row-slots";

    for (let slotInHour = 0; slotInHour < SLOTS_PER_HOUR; slotInHour++) {
      const slotIndex = (hour * SLOTS_PER_HOUR) + slotInHour;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-slot";
      btn.dataset.slotIndex = String(slotIndex);
      btn.setAttribute("aria-label", `Slot ${formatSlotLabel(slotIndex)}`);
      slotsWrap.appendChild(btn);
      slotCellEls[slotIndex] = btn;
    }

    const caption = document.createElement("div");
    caption.className = "custom-row-caption";
    slotCaptionEls[hour] = caption;

    row.appendChild(hourLabel);
    row.appendChild(slotsWrap);
    row.appendChild(caption);
    gridRoot.appendChild(row);
  }
}

function onGridPointerDown(e) {
  if (!(e.target instanceof Element)) return;
  if (e.button !== undefined && e.button !== 0) return;

  const slot = extractSlotIndexFromTarget(e.target);
  if (slot === null) return;

  if (isMobilePickerViewport()) {
    paintDragging = false;
    if (activeBrushVideoId && FAN_BY_ID.has(activeBrushVideoId)) {
      assignSlot(slot, activeBrushVideoId);
    } else {
      openMobileSheet(slot);
    }
    e.preventDefault();
    return;
  }

  if (activeBrushVideoId && FAN_BY_ID.has(activeBrushVideoId)) {
    paintDragging = true;
    assignSlot(slot, activeBrushVideoId);
    e.preventDefault();
    return;
  }

  pendingPaintSlotIndex = slot;
  const search = document.getElementById("custom-picker-search");
  search?.focus();
  announce(`Pick a video to paint slot ${formatSlotLabel(slot)}.`);
}

function onGridClickFallback(e) {
  if (!isMobilePickerViewport()) return;
  if (!(e.target instanceof Element)) return;
  const slot = extractSlotIndexFromTarget(e.target);
  if (slot === null) return;
  if (activeBrushVideoId && FAN_BY_ID.has(activeBrushVideoId)) return;
  if (mobileSheetState.open && mobileSheetState.slotIndex === slot) return;
  openMobileSheet(slot);
}

function onGridDoubleClick(e) {
  if (!(e.target instanceof Element)) return;
  const slot = extractSlotIndexFromTarget(e.target);
  if (slot === null) return;
  if (!customAssignments[slot]) return;
  e.preventDefault();
  clearSlotAssignment(slot);
}

function onGridPointerOver(e) {
  if (!paintDragging) return;
  if (!(e.target instanceof Element)) return;

  const slot = extractSlotIndexFromTarget(e.target);
  if (slot === null) return;
  if (!activeBrushVideoId || !FAN_BY_ID.has(activeBrushVideoId)) return;

  assignSlot(slot, activeBrushVideoId, { pulse: false });
}

function extractSlotIndexFromTarget(target) {
  const btn = target.closest(".custom-slot");
  if (!(btn instanceof HTMLButtonElement)) return null;
  const slot = parseInt(btn.dataset.slotIndex || "", 10);
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS_PER_DAY) return null;
  return slot;
}

function onHourLabelClick(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour >= 24) return;

  const allAssignedToBrush = activeBrushVideoId && hourSlotsAllMatch(hour, activeBrushVideoId);
  if (allAssignedToBrush) {
    clearHour(hour);
    announce(`Cleared hour ${String(hour).padStart(2, "0")}.`);
    return;
  }

  if (!activeBrushVideoId || !FAN_BY_ID.has(activeBrushVideoId)) {
    announce("Pick a video first, then click an hour to fill it.");
    return;
  }

  paintHour(hour, activeBrushVideoId);
  const fan = FAN_BY_ID.get(activeBrushVideoId);
  announce(`Filled hour ${String(hour).padStart(2, "0")} with ${fan.title}.`);
}

function hourSlotsAllMatch(hour, videoId) {
  for (let i = 0; i < SLOTS_PER_HOUR; i++) {
    if (customAssignments[hour * SLOTS_PER_HOUR + i] !== videoId) return false;
  }
  return true;
}

function paintHour(hour, videoId) {
  for (let i = 0; i < SLOTS_PER_HOUR; i++) {
    assignSlot(hour * SLOTS_PER_HOUR + i, videoId, { pulse: false });
  }
}

function clearHour(hour) {
  for (let i = 0; i < SLOTS_PER_HOUR; i++) {
    clearSlotAssignment(hour * SLOTS_PER_HOUR + i);
  }
}

function assignSlot(slotIndex, videoId, options = {}) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOTS_PER_DAY) return;
  const normalizedVideoId = FAN_BY_ID.has(videoId) ? videoId : null;

  if (customAssignments[slotIndex] === normalizedVideoId) return;

  customAssignments[slotIndex] = normalizedVideoId;
  renderSlotCell(slotIndex);
  renderRowCaption(Math.floor(slotIndex / SLOTS_PER_HOUR));
  renderCustomizerStatus();
  updateCustomizeButtonState();
  scheduleCustomPlaylistSync();

  if (options.pulse !== false) {
    pulseSlot(slotIndex);
  }
}

function clearSlotAssignment(slotIndex) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOTS_PER_DAY) return;
  if (customAssignments[slotIndex] === null) return;

  customAssignments[slotIndex] = null;
  renderSlotCell(slotIndex);
  renderRowCaption(Math.floor(slotIndex / SLOTS_PER_HOUR));
  renderCustomizerStatus();
  updateCustomizeButtonState();
  scheduleCustomPlaylistSync();
}

function pulseSlot(slotIndex) {
  const cell = slotCellEls[slotIndex];
  if (!cell) return;
  cell.classList.remove("is-paint-pulse");
  void cell.offsetWidth;
  cell.classList.add("is-paint-pulse");
  window.setTimeout(() => cell.classList.remove("is-paint-pulse"), 240);
}

function resetCustomLayout() {
  customAssignments = createEmptyAssignments();
  renderAllSlotCells();
  renderAllRowCaptions();
  renderCustomizerStatus();
  updateCustomizeButtonState();
  scheduleCustomPlaylistSync({ immediate: true });
  announce("Custom layout reset to default timeline.");
}

function scheduleCustomPlaylistSync({ immediate = false } = {}) {
  if (customSyncTimer !== null) {
    clearTimeout(customSyncTimer);
    customSyncTimer = null;
  }

  const commit = () => {
    customSyncTimer = null;
    persistCustomAssignments(customAssignments);
    setCustomPlaylist({ assignmentsBySlot: customAssignments });
  };

  if (immediate) {
    commit();
    return;
  }

  customSyncTimer = window.setTimeout(commit, CUSTOM_SYNC_DEBOUNCE_MS);
}

function renderAllSlotCells() {
  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    renderSlotCell(slot);
  }
}

function renderSlotCell(slotIndex) {
  const cell = slotCellEls[slotIndex];
  if (!cell) return;

  const assignedVideoId = customAssignments[slotIndex];
  const fan = assignedVideoId ? FAN_BY_ID.get(assignedVideoId) : null;

  cell.classList.remove("is-assigned", "is-short", "is-brush-match");

  if (!fan) {
    cell.removeAttribute("data-video-id");
    cell.title = `${formatSlotLabel(slotIndex)} - original timeline`;
    return;
  }

  cell.dataset.videoId = fan.videoId;
  cell.classList.add("is-assigned");
  if (fan.isShort) cell.classList.add("is-short");
  if (activeBrushVideoId && fan.videoId === activeBrushVideoId) {
    cell.classList.add("is-brush-match");
  }

  const cityPart = fan.city ? ` / ${fan.city}` : "";
  const durationPart = Number.isFinite(fan.duration)
    ? ` - ${formatDurationCompact(fan.duration)}`
    : "";
  const shortPart = fan.isShort ? " - short clip" : "";
  cell.title = `${formatSlotLabel(slotIndex)} - ${fan.title} (${fan.country}${cityPart})${durationPart}${shortPart} (double-click to clear)`;
}

function renderAllRowCaptions() {
  for (let hour = 0; hour < 24; hour++) renderRowCaption(hour);
}

function renderRowCaption(hour) {
  const caption = slotCaptionEls[hour];
  if (!caption) return;

  caption.classList.remove("is-assigned", "is-mixed");

  const dominant = dominantHourAssignment(hour);
  if (!dominant) {
    caption.textContent = "Official";
    return;
  }

  if (dominant.mixed) {
    caption.classList.add("is-mixed");
    caption.textContent = `${dominant.fan.city || dominant.fan.country} + more`;
    return;
  }

  caption.classList.add("is-assigned");
  const fan = dominant.fan;
  caption.textContent = fan.city ? `${fan.city}, ${fan.country}` : fan.country;
}

function dominantHourAssignment(hour) {
  const counts = new Map();
  let totalAssigned = 0;
  for (let i = 0; i < SLOTS_PER_HOUR; i++) {
    const id = customAssignments[hour * SLOTS_PER_HOUR + i];
    if (!id) continue;
    totalAssigned += 1;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (totalAssigned === 0) return null;

  let topId = null;
  let topCount = 0;
  for (const [id, c] of counts) {
    if (c > topCount) {
      topCount = c;
      topId = id;
    }
  }
  if (!topId) return null;
  const fan = FAN_BY_ID.get(topId);
  if (!fan) return null;

  return { fan, mixed: counts.size > 1 };
}

function setActiveBrush(videoId) {
  const normalized = (videoId && FAN_BY_ID.has(videoId)) ? videoId : null;
  if (normalized === activeBrushVideoId) return;

  activeBrushVideoId = normalized;
  renderBrushBar();
  refreshPickerSelection();
  renderAllSlotCells();
}

function renderBrushBar() {
  const wrap = document.getElementById("customize-brush");
  const swatch = document.getElementById("brush-swatch");
  const info = document.getElementById("brush-info");
  const clearBtn = document.getElementById("custom-clear-brush");
  if (!wrap || !swatch || !info || !clearBtn) return;

  info.textContent = "";

  if (!activeBrushVideoId || !FAN_BY_ID.has(activeBrushVideoId)) {
    wrap.dataset.empty = "true";
    swatch.style.background = "";
    swatch.style.boxShadow = "";
    const hint = document.createElement("p");
    hint.className = "brush-hint";
    hint.textContent = "Pick a video below or tap an empty slot to begin.";
    info.appendChild(hint);
    clearBtn.disabled = true;
    return;
  }

  const fan = FAN_BY_ID.get(activeBrushVideoId);
  wrap.dataset.empty = "false";
  applyBrushSwatch(swatch, fan);

  const place = document.createElement("p");
  place.className = "brush-place";
  place.textContent = fan.city ? `${fan.city}, ${fan.country}` : fan.country;

  const title = document.createElement("p");
  title.className = "brush-title";
  title.textContent = fan.title;

  const meta = document.createElement("p");
  meta.className = "brush-meta";
  if (Number.isFinite(fan.duration)) {
    const dur = document.createElement("span");
    dur.className = "brush-duration";
    dur.textContent = formatDurationCompact(fan.duration);
    meta.appendChild(dur);
  }
  if (fan.isShort) {
    const short = document.createElement("span");
    short.textContent = "Short fallback";
    short.style.color = "rgba(255, 175, 107, 0.95)";
    short.style.letterSpacing = "0.04em";
    meta.appendChild(short);
  }

  info.appendChild(place);
  info.appendChild(title);
  if (meta.childElementCount > 0) info.appendChild(meta);
  clearBtn.disabled = false;
}

function applyBrushSwatch(el, fan) {
  if (!fan) return;
  const hue = (hashStr(fan.videoId) % 24) - 12;
  const inner = `hsl(${48 + hue}, 95%, 88%)`;
  const mid = `hsl(${48 + hue}, 95%, 56%)`;
  const outer = `hsl(${42 + hue}, 70%, 38%)`;
  el.style.background = `radial-gradient(circle at 32% 28%, ${inner} 0%, ${mid} 42%, ${outer} 100%)`;
  el.style.boxShadow = `0 0 0 1px rgba(0, 0, 0, 0.25), 0 8px 22px hsla(${48 + hue}, 95%, 56%, 0.32)`;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function renderPickerLists() {
  const desktopRoot = document.getElementById("custom-desktop-picker");
  const sheetRoot = document.getElementById("custom-sheet-list");
  if (desktopRoot) renderPickerInto(desktopRoot);
  if (sheetRoot) renderPickerInto(sheetRoot);
}

function renderPickerInto(root) {
  root.textContent = "";

  if (FAN_VIDEOS.length === 0) {
    const empty = document.createElement("p");
    empty.className = "custom-list-empty";
    empty.textContent = "Fan video database unavailable.";
    root.appendChild(empty);
    root.dataset.search = "false";
    return;
  }

  const query = pickerState.search.trim().toLowerCase();
  const searching = query.length > 0;
  root.dataset.search = searching ? "true" : "false";

  if (searching) {
    const matches = FAN_VIDEOS.filter((fan) => (
      fan.title.toLowerCase().includes(query)
      || (fan.city && fan.city.toLowerCase().includes(query))
      || fan.country.toLowerCase().includes(query)
    ));

    if (matches.length === 0) {
      const empty = document.createElement("p");
      empty.className = "custom-list-empty";
      empty.textContent = "Nothing matches. Try a country or a city.";
      root.appendChild(empty);
      return;
    }

    const country = document.createElement("div");
    country.className = "custom-country";
    country.dataset.open = "true";

    const wrap = document.createElement("div");
    wrap.className = "custom-country-body-wrap";

    const body = document.createElement("div");
    body.className = "custom-country-body";

    const inner = document.createElement("div");
    inner.className = "custom-country-body-inner";

    for (const fan of matches) {
      inner.appendChild(buildVideoOption(fan, { showCountry: true }));
    }

    body.appendChild(inner);
    wrap.appendChild(body);
    country.appendChild(wrap);
    root.appendChild(country);
    return;
  }

  const byCountry = new Map();
  for (const fan of FAN_VIDEOS) {
    if (!byCountry.has(fan.country)) byCountry.set(fan.country, []);
    byCountry.get(fan.country).push(fan);
  }
  const sortedCountries = Array.from(byCountry.keys()).sort((a, b) => a.localeCompare(b));

  for (const country of sortedCountries) {
    const videos = byCountry.get(country);
    const isOpen = pickerState.openCountry === country;
    const hasSelected = activeBrushVideoId && videos.some((v) => v.videoId === activeBrushVideoId);

    const item = document.createElement("div");
    item.className = "custom-country";
    item.dataset.country = country;
    if (isOpen) item.dataset.open = "true";
    if (hasSelected) item.dataset.hasSelected = "true";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "custom-country-header";
    header.setAttribute("aria-expanded", isOpen ? "true" : "false");
    header.dataset.toggleCountry = country;

    const chev = document.createElement("span");
    chev.className = "custom-country-chevron";
    chev.setAttribute("aria-hidden", "true");
    header.appendChild(chev);

    const name = document.createElement("span");
    name.className = "custom-country-name";
    name.textContent = country;
    header.appendChild(name);

    const count = document.createElement("span");
    count.className = "custom-country-count";
    const cityCount = new Set(videos.map((v) => v.city).filter(Boolean)).size;
    count.textContent = cityCount > 0
      ? `${cityCount} ${cityCount === 1 ? "city" : "cities"} · ${videos.length} ${videos.length === 1 ? "video" : "videos"}`
      : `${videos.length} ${videos.length === 1 ? "video" : "videos"}`;
    header.appendChild(count);

    const dot = document.createElement("span");
    dot.className = "custom-country-dot";
    dot.setAttribute("aria-hidden", "true");
    header.appendChild(dot);

    item.appendChild(header);

    const wrap = document.createElement("div");
    wrap.className = "custom-country-body-wrap";

    const body = document.createElement("div");
    body.className = "custom-country-body";

    const inner = document.createElement("div");
    inner.className = "custom-country-body-inner";
    for (const fan of videos) {
      inner.appendChild(buildVideoOption(fan, { showCountry: false }));
    }

    body.appendChild(inner);
    wrap.appendChild(body);
    item.appendChild(wrap);
    root.appendChild(item);
  }
}

function buildVideoOption(fan, { showCountry }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "custom-video-option";
  btn.dataset.videoId = fan.videoId;
  if (activeBrushVideoId === fan.videoId) btn.classList.add("is-selected");
  if (fan.isShort) btn.classList.add("is-short");

  const radio = document.createElement("span");
  radio.className = "custom-video-radio";
  radio.setAttribute("aria-hidden", "true");
  btn.appendChild(radio);

  const body = document.createElement("div");
  body.className = "custom-video-body";

  const city = document.createElement("span");
  city.className = "custom-video-city";
  const cityText = fan.city || fan.country;
  city.textContent = showCountry && fan.city
    ? `${fan.city} · ${fan.country}`
    : cityText;
  body.appendChild(city);

  const title = document.createElement("span");
  title.className = "custom-video-title";
  title.textContent = fan.title;
  body.appendChild(title);

  btn.appendChild(body);

  if (Number.isFinite(fan.duration)) {
    const dur = document.createElement("span");
    dur.className = "custom-video-duration";
    dur.textContent = formatDurationCompact(fan.duration);
    btn.appendChild(dur);
  }

  return btn;
}

function refreshPickerSelection() {
  const roots = [
    document.getElementById("custom-desktop-picker"),
    document.getElementById("custom-sheet-list"),
  ].filter(Boolean);

  for (const root of roots) {
    for (const opt of root.querySelectorAll(".custom-video-option")) {
      const isSelected = opt.dataset.videoId === activeBrushVideoId;
      opt.classList.toggle("is-selected", isSelected);
    }
    for (const item of root.querySelectorAll(".custom-country")) {
      const country = item.dataset.country;
      if (!country) continue;
      const hasSelected = activeBrushVideoId && Array.from(item.querySelectorAll(".custom-video-option")).some((o) => o.dataset.videoId === activeBrushVideoId);
      if (hasSelected) item.dataset.hasSelected = "true";
      else delete item.dataset.hasSelected;
    }
  }
}

function onPickerListClick(e) {
  if (!(e.target instanceof Element)) return;

  const header = e.target.closest("[data-toggle-country]");
  if (header instanceof HTMLElement) {
    const country = header.dataset.toggleCountry || "";
    pickerState.openCountry = pickerState.openCountry === country ? "" : country;
    renderPickerLists();
    return;
  }

  const option = e.target.closest(".custom-video-option");
  if (option instanceof HTMLButtonElement) {
    const videoId = option.dataset.videoId;
    if (!videoId || !FAN_BY_ID.has(videoId)) return;

    const fan = FAN_BY_ID.get(videoId);

    if (Number.isInteger(pendingPaintSlotIndex)) {
      const slot = pendingPaintSlotIndex;
      pendingPaintSlotIndex = null;
      setActiveBrush(videoId);
      assignSlot(slot, videoId);
      announce(`Painted ${formatSlotLabel(slot)} with ${fan.title}. Brush loaded for more painting.`);
      return;
    }

    if (mobileSheetState.open && Number.isInteger(mobileSheetState.slotIndex)) {
      const slot = mobileSheetState.slotIndex;
      setActiveBrush(videoId);
      assignSlot(slot, videoId);
      closeMobileSheet();
      announce(`Painted ${formatSlotLabel(slot)} with ${fan.title}.`);
      return;
    }

    if (activeBrushVideoId === videoId) {
      setActiveBrush(null);
      announce("Brush cleared.");
    } else {
      setActiveBrush(videoId);
      announce(`Brush loaded: ${fan.title}.`);
    }
  }
}

function tickCustomizerNow() {
  const min = currentMinuteOfDay();
  const hour = Math.floor(min / 60);
  const slotInHour = Math.floor((min % 60) / SLOT_MINUTES);
  const slotIndex = hour * SLOTS_PER_HOUR + slotInHour;
  if (!Number.isInteger(slotIndex)) return;

  const grid = document.getElementById("customize-grid");
  if (!grid) return;
  const row = grid.querySelector(`.custom-row[data-hour="${hour}"]`);
  const slot = slotCellEls[slotIndex];

  if (row && row !== lastNowHourRow) {
    if (lastNowHourRow) lastNowHourRow.classList.remove("is-now");
    row.classList.add("is-now");
    lastNowHourRow = row;
  }
  if (slot && slot !== lastNowSlotEl) {
    if (lastNowSlotEl) lastNowSlotEl.classList.remove("is-now-tick");
    slot.classList.add("is-now-tick");
    lastNowSlotEl = slot;
  }
}

function clearNowMarker() {
  if (lastNowHourRow) {
    lastNowHourRow.classList.remove("is-now");
    lastNowHourRow = null;
  }
  if (lastNowSlotEl) {
    lastNowSlotEl.classList.remove("is-now-tick");
    lastNowSlotEl = null;
  }
}

function renderCustomizerStatus() {
  const status = document.getElementById("customize-status");
  const done = document.getElementById("customize-done");
  const count = countAssignedSlots();

  if (status) {
    status.textContent = count === 0
      ? "All hours · original timeline"
      : `${count} of ${SLOTS_PER_DAY} slots · ${Math.round((count / SLOTS_PER_DAY) * 100)}%`;
  }
  if (done) {
    done.textContent = count > 0 ? `Done · ${count} set` : "Done";
  }
}

function countAssignedSlots() {
  let count = 0;
  for (const slot of customAssignments) {
    if (slot) count += 1;
  }
  return count;
}

function createEmptyAssignments() {
  return new Array(SLOTS_PER_DAY).fill(null);
}

function loadCustomAssignments(videoMap) {
  const empty = createEmptyAssignments();
  if (videoMap instanceof Map && videoMap.size === 0) return empty;

  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM_LAYOUT_KEY);
    if (!raw) return empty;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty;

    const next = createEmptyAssignments();
    for (const [rawSlot, rawVideoId] of Object.entries(parsed)) {
      const slot = parseInt(rawSlot, 10);
      if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS_PER_DAY) continue;
      if (typeof rawVideoId !== "string") continue;

      const videoId = rawVideoId.trim();
      if (!videoId) continue;
      if (videoMap && videoMap.size > 0 && !videoMap.has(videoId)) continue;

      next[slot] = videoId;
    }

    return next;
  } catch (_) {
    return empty;
  }
}

function persistCustomAssignments(assignments) {
  try {
    const sparse = {};
    for (let slot = 0; slot < assignments.length; slot++) {
      const videoId = assignments[slot];
      if (!videoId) continue;
      sparse[slot] = videoId;
    }
    localStorage.setItem(STORAGE_CUSTOM_LAYOUT_KEY, JSON.stringify(sparse));
  } catch (_) {
    // Local storage unavailable.
  }
}

function formatSlotLabel(slotIndex) {
  const startMinute = slotIndex * SLOT_MINUTES;
  const endMinute = startMinute + SLOT_MINUTES;
  return `${formatTime(startMinute, TIME_FORMAT_24H)}-${formatTime(endMinute, TIME_FORMAT_24H)}`;
}

function formatDurationCompact(durationSeconds) {
  const sec = Math.max(0, Math.floor(durationSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}' ${String(s).padStart(2, "0")}"`;
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

async function loadFanVideos() {
  const res = await fetch("wearehappyfrom.com.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load wearehappyfrom.com.json: ${res.status}`);
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error("Fan database must be a JSON array.");
  }

  const entries = [];
  for (const item of raw) {
    const normalized = normalizeFanVideo(item);
    if (!normalized) continue;
    entries.push(normalized);
  }

  entries.sort((a, b) => {
    const byCountry = a.country.localeCompare(b.country);
    if (byCountry !== 0) return byCountry;

    const byCity = (a.city || "").localeCompare(b.city || "");
    if (byCity !== 0) return byCity;

    return a.title.localeCompare(b.title);
  });

  return entries;
}

function normalizeFanVideo(item) {
  if (!item || typeof item !== "object") return null;

  const videoId = normalizeVideoId(item.videoId) || extractVideoId(item.url);
  if (!videoId) return null;

  const title = normalizeText(item.title) || `Fan video ${videoId}`;
  const country = normalizeText(item.country) || "--";
  const city = normalizeText(item.city) || "";
  const duration = normalizeDuration(item.duration);

  return {
    videoId,
    url: normalizeText(item.url) || `https://www.youtube.com/watch?v=${videoId}`,
    title,
    country,
    city,
    duration,
    isShort: Number.isFinite(duration) && duration < SLOT_SECONDS,
  };
}

function normalizeDuration(raw) {
  if (Number.isFinite(raw)) return Math.max(0, Math.floor(raw));

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      return Math.max(0, parseInt(trimmed, 10));
    }

    const mmss = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (mmss) {
      const m = parseInt(mmss[1], 10);
      const s = parseInt(mmss[2], 10);
      return (m * 60) + s;
    }
  }

  return null;
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeVideoId(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed;
}

function extractVideoId(url) {
  if (typeof url !== "string") return "";

  const watchMatch = /[?&]v=([A-Za-z0-9_-]{11})/.exec(url);
  if (watchMatch) return watchMatch[1];

  const shortMatch = /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url);
  if (shortMatch) return shortMatch[1];

  return "";
}

function isMobilePickerViewport() {
  return window.matchMedia(`(max-width: ${MOBILE_PICKER_BREAKPOINT}px)`).matches;
}

function openMobileSheet(slotIndex) {
  const sheet = document.getElementById("custom-mobile-picker");
  if (!sheet) return;

  mobileSheetState = { open: true, slotIndex };

  const titleEl = document.getElementById("custom-sheet-title");
  const eyebrowEl = document.getElementById("custom-sheet-eyebrow");
  if (titleEl) {
    titleEl.textContent = Number.isInteger(slotIndex)
      ? `Paint slot ${formatSlotLabel(slotIndex)}`
      : "Pick a video";
  }
  if (eyebrowEl) {
    eyebrowEl.textContent = Number.isInteger(slotIndex) ? "Slot" : "Browse";
  }

  sheet.hidden = false;
  renderPickerLists();
  requestAnimationFrame(() => {
    sheet.dataset.open = "true";
  });
}

function closeMobileSheet({ immediate = false } = {}) {
  const sheet = document.getElementById("custom-mobile-picker");
  mobileSheetState = { open: false, slotIndex: null };
  if (!sheet) return;
  sheet.dataset.open = "false";
  if (immediate) {
    sheet.hidden = true;
    return;
  }
  window.setTimeout(() => {
    if (mobileSheetState.open) return;
    sheet.hidden = true;
  }, 280);
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

function wireUiAutoHide() {
  const markUiActive = () => {
    document.body.classList.remove("ui-idle");
    scheduleUiIdle();
  };

  document.addEventListener("pointermove", markUiActive, { passive: true });
  document.addEventListener("pointerdown", markUiActive, { passive: true });
  document.addEventListener("touchstart", markUiActive, { passive: true });
  document.addEventListener("wheel", markUiActive, { passive: true });
  document.addEventListener("keydown", markUiActive);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") markUiActive();
  });

  markUiActive();
}

function scheduleUiIdle() {
  if (uiIdleTimer !== null) {
    clearTimeout(uiIdleTimer);
  }
  uiIdleTimer = window.setTimeout(() => {
    document.body.classList.add("ui-idle");
  }, UI_IDLE_DELAY_MS);
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
