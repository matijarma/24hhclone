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

let customAssignments = createEmptyAssignments();
let desktopPickerState = {
  step: "country",
  country: "",
  city: "",
  search: "",
};
let activeBrushVideoId = null;
let slotCellEls = new Array(SLOTS_PER_DAY).fill(null);
let customizerOpen = false;
let customizerReady = false;
let paintDragging = false;
let customSyncTimer = null;
let mobilePickerState = {
  open: false,
  slotIndex: null,
  step: "country",
  country: "",
  city: "",
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

  try {
    HOURS = await loadHours();
  } catch (err) {
    showError(`${err.message} - try serving the folder over HTTP (see comment in js/main.js).`);
    return;
  }

  try {
    FAN_VIDEOS = await loadFanVideos();
    FAN_BY_ID = new Map(FAN_VIDEOS.map((entry) => [entry.videoId, entry]));
    FAN_COUNTRIES = Array.from(new Set(FAN_VIDEOS.map((entry) => entry.country))).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    FAN_VIDEOS = [];
    FAN_BY_ID = new Map();
    FAN_COUNTRIES = [];
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
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (customizerOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCustomizerModal();
      }
      return;
    }

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
  const list = document.getElementById("custom-video-list");
  const desktopPickerRoot = document.getElementById("custom-desktop-picker");
  const desktopBackBtn = document.getElementById("custom-desktop-back");
  const desktopSearchInput = document.getElementById("custom-picker-search");
  const closeTopBtn = document.getElementById("customize-close");
  const closeBottomBtn = document.getElementById("customize-done");
  const resetBtn = document.getElementById("custom-reset");
  const clearBrushBtn = document.getElementById("custom-clear-brush");

  if (!modal || !grid || !list || !desktopPickerRoot || !desktopBackBtn || !desktopSearchInput) {
    return;
  }

  buildCustomizerGrid(grid);
  resetDesktopPickerState({ render: false });
  renderDesktopPicker();
  renderSelectedBrushIndicator();
  renderAllSlotCells();
  renderMobilePicker();

  desktopBackBtn.addEventListener("click", onDesktopPickerBack);
  desktopSearchInput.addEventListener("input", () => {
    desktopPickerState.search = desktopSearchInput.value.trim();
    renderDesktopPicker();
  });

  list.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const option = e.target.closest("button[data-video-id]");
    if (!(option instanceof HTMLButtonElement)) return;

    const videoId = option.dataset.videoId;
    if (!videoId || !FAN_BY_ID.has(videoId)) return;

    setActiveBrush(videoId);
  });

  grid.addEventListener("pointerdown", onGridPointerDown);
  grid.addEventListener("pointerover", onGridPointerOver);
  grid.addEventListener("click", onGridClickFallback);
  window.addEventListener("pointerup", () => {
    paintDragging = false;
  });

  closeTopBtn?.addEventListener("click", closeCustomizerModal);
  closeBottomBtn?.addEventListener("click", closeCustomizerModal);
  resetBtn?.addEventListener("click", resetCustomLayout);
  clearBrushBtn?.addEventListener("click", () => {
    setActiveBrush(null);
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeCustomizerModal();
    }
  });

  window.addEventListener("resize", () => {
    renderDesktopPicker();
    renderMobilePicker();
  });

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

  customizerOpen = true;
  modal.hidden = false;
  document.body.classList.add("customize-open");
  syncSliderInteractivity();

  resetDesktopPickerState({ render: false });
  renderDesktopPicker();
  renderSelectedBrushIndicator();
  renderAllSlotCells();
  renderMobilePicker();

  requestAnimationFrame(() => {
    const closeBtn = document.getElementById("customize-close");
    closeBtn?.focus();
  });
}

function closeCustomizerModal() {
  const modal = document.getElementById("customize-modal");
  if (!modal) return;

  customizerOpen = false;
  paintDragging = false;
  closeMobilePicker();
  modal.hidden = true;
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
  gridRoot.textContent = "";

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");
    row.className = "custom-row";

    const hourLabel = document.createElement("div");
    hourLabel.className = "custom-row-label";
    hourLabel.textContent = String(hour).padStart(2, "0");

    const slotsWrap = document.createElement("div");
    slotsWrap.className = "custom-row-slots";

    for (let slotInHour = 0; slotInHour < SLOTS_PER_HOUR; slotInHour++) {
      const slotIndex = (hour * SLOTS_PER_HOUR) + slotInHour;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-slot";
      btn.dataset.slotIndex = String(slotIndex);
      btn.textContent = String(slotInHour + 1).padStart(2, "0");
      btn.setAttribute("aria-label", `Slot ${formatSlotLabel(slotIndex)}`);
      slotsWrap.appendChild(btn);
      slotCellEls[slotIndex] = btn;
    }

    row.appendChild(hourLabel);
    row.appendChild(slotsWrap);
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
    openMobilePicker(slot);
    e.preventDefault();
    return;
  }

  if (activeBrushVideoId && FAN_BY_ID.has(activeBrushVideoId)) {
    paintDragging = true;
    assignSlot(slot, activeBrushVideoId);
    e.preventDefault();
    return;
  }

  announce("Choose a fan video first, then paint slots.");
}

function onGridClickFallback(e) {
  if (!isMobilePickerViewport()) return;
  if (!(e.target instanceof Element)) return;
  const slot = extractSlotIndexFromTarget(e.target);
  if (slot === null) return;

  if (mobilePickerState.open && mobilePickerState.slotIndex === slot) {
    return;
  }

  openMobilePicker(slot);
}

function onGridPointerOver(e) {
  if (!paintDragging) return;
  if (!(e.target instanceof Element)) return;

  const slot = extractSlotIndexFromTarget(e.target);
  if (slot === null) return;
  if (!activeBrushVideoId || !FAN_BY_ID.has(activeBrushVideoId)) return;

  assignSlot(slot, activeBrushVideoId);
}

function extractSlotIndexFromTarget(target) {
  const btn = target.closest(".custom-slot");
  if (!(btn instanceof HTMLButtonElement)) return null;
  const slot = parseInt(btn.dataset.slotIndex || "", 10);
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS_PER_DAY) return null;
  return slot;
}

function assignSlot(slotIndex, videoId) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOTS_PER_DAY) return;
  const normalizedVideoId = FAN_BY_ID.has(videoId) ? videoId : null;

  if (customAssignments[slotIndex] === normalizedVideoId) return;

  customAssignments[slotIndex] = normalizedVideoId;
  renderSlotCell(slotIndex);
  updateCustomizeButtonState();
  scheduleCustomPlaylistSync();
}

function resetCustomLayout() {
  customAssignments = createEmptyAssignments();
  renderAllSlotCells();
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

  cell.title = `${formatSlotLabel(slotIndex)} - ${fan.title} (${fan.country}${cityPart})${durationPart}${shortPart}`;
}

function setActiveBrush(videoId) {
  const normalized = (videoId && FAN_BY_ID.has(videoId)) ? videoId : null;
  if (normalized === activeBrushVideoId) return;

  activeBrushVideoId = normalized;
  renderSelectedBrushIndicator();
  renderDesktopPicker();
  renderAllSlotCells();
}

function renderSelectedBrushIndicator() {
  const label = document.getElementById("custom-brush-label");
  const clearBtn = document.getElementById("custom-clear-brush");
  if (!label || !clearBtn) return;

  label.textContent = "";

  if (!activeBrushVideoId || !FAN_BY_ID.has(activeBrushVideoId)) {
    const hint = document.createElement("span");
    hint.className = "custom-brush-empty";
    hint.textContent = "No brush selected. Choose a fan video and paint slots.";
    label.appendChild(hint);
    clearBtn.disabled = true;
    return;
  }

  const fan = FAN_BY_ID.get(activeBrushVideoId);

  const prefix = document.createElement("span");
  prefix.className = "custom-brush-prefix";
  prefix.textContent = "Brush:";

  const title = document.createElement("span");
  title.className = "custom-brush-title";
  title.textContent = fan.title;

  label.appendChild(prefix);
  label.appendChild(title);

  if (Number.isFinite(fan.duration)) {
    const duration = document.createElement("span");
    duration.className = "custom-brush-duration";
    duration.textContent = formatDurationCompact(fan.duration);
    label.appendChild(duration);
  }

  const place = document.createElement("span");
  place.className = "custom-brush-place";
  place.textContent = `${fan.country}${fan.city ? ` / ${fan.city}` : ""}`;
  label.appendChild(place);

  clearBtn.disabled = false;
}

function resetDesktopPickerState({ render = true } = {}) {
  desktopPickerState = {
    step: "country",
    country: "",
    city: "",
    search: "",
  };
  if (render) renderDesktopPicker();
}

function renderDesktopPicker() {
  const root = document.getElementById("custom-desktop-picker");
  const list = document.getElementById("custom-video-list");
  const stageEl = document.getElementById("custom-desktop-stage");
  const pathEl = document.getElementById("custom-desktop-path");
  const backBtn = document.getElementById("custom-desktop-back");
  const searchInput = document.getElementById("custom-picker-search");
  if (!root || !list || !stageEl || !pathEl || !backBtn || !searchInput) return;

  if (desktopPickerState.step === "country") {
    stageEl.textContent = "Select country";
    pathEl.textContent = "Step 1 of 3";
    backBtn.hidden = true;
    searchInput.placeholder = "Search countries";
  } else if (desktopPickerState.step === "city") {
    stageEl.textContent = "Select city";
    pathEl.textContent = desktopPickerState.country || "Step 2 of 3";
    backBtn.hidden = false;
    searchInput.placeholder = "Search cities";
  } else {
    stageEl.textContent = "Select video";
    pathEl.textContent = [desktopPickerState.country, desktopPickerState.city]
      .filter(Boolean)
      .join(" / ");
    backBtn.hidden = false;
    searchInput.placeholder = "Search videos";
  }

  if (searchInput.value !== desktopPickerState.search) {
    searchInput.value = desktopPickerState.search;
  }

  root.textContent = "";
  list.hidden = desktopPickerState.step !== "video";
  if (list.hidden) list.textContent = "";

  if (desktopPickerState.step === "country") {
    renderDesktopCountryStep(root);
  } else if (desktopPickerState.step === "city") {
    renderDesktopCityStep(root);
  } else {
    renderDesktopVideoStep(root, list);
  }
}

function onDesktopPickerBack() {
  if (desktopPickerState.step === "video") {
    const cities = getCitiesForCountry(desktopPickerState.country);
    desktopPickerState.step = cities.length > 1 ? "city" : "country";
  } else if (desktopPickerState.step === "city") {
    desktopPickerState.step = "country";
  } else {
    return;
  }

  desktopPickerState.search = "";
  renderDesktopPicker();
}

function renderDesktopCountryStep(root) {
  const query = desktopPickerState.search.toLowerCase();
  const countries = FAN_COUNTRIES.filter((country) => (
    !query || country.toLowerCase().includes(query)
  ));

  const info = document.createElement("p");
  info.className = "custom-picker-info";
  info.textContent = "Pick a country to continue.";
  root.appendChild(info);

  if (countries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "custom-list-empty";
    empty.textContent = "No countries match your search.";
    root.appendChild(empty);
    return;
  }

  const wall = document.createElement("div");
  wall.className = "custom-chip-wall";
  for (const country of countries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "custom-pill";
    btn.textContent = country;
    btn.addEventListener("click", () => {
      selectDesktopCountry(country);
    });
    wall.appendChild(btn);
  }
  root.appendChild(wall);
}

function selectDesktopCountry(country) {
  desktopPickerState.country = country;
  desktopPickerState.city = "";
  desktopPickerState.search = "";

  const cities = getCitiesForCountry(country);
  if (cities.length <= 1) {
    desktopPickerState.city = cities[0] || "";
    const videos = getFilteredFanVideos(country, desktopPickerState.city);
    if (videos.length === 1) {
      setActiveBrush(videos[0].videoId);
      announce(`Brush set to ${videos[0].title}.`);
      desktopPickerState.step = "country";
      desktopPickerState.country = "";
      desktopPickerState.city = "";
      desktopPickerState.search = "";
      renderDesktopPicker();
      return;
    }
    desktopPickerState.step = "video";
    renderDesktopPicker();
    return;
  }

  desktopPickerState.step = "city";
  renderDesktopPicker();
}

function renderDesktopCityStep(root) {
  const query = desktopPickerState.search.toLowerCase();
  const cities = getCitiesForCountry(desktopPickerState.country).filter((city) => (
    !query || city.toLowerCase().includes(query)
  ));

  const info = document.createElement("p");
  info.className = "custom-picker-info";
  info.textContent = `Choose city in ${desktopPickerState.country}.`;
  root.appendChild(info);

  if (cities.length === 0) {
    const empty = document.createElement("p");
    empty.className = "custom-list-empty";
    empty.textContent = "No cities match your search.";
    root.appendChild(empty);
    return;
  }

  const wall = document.createElement("div");
  wall.className = "custom-chip-wall";
  for (const city of cities) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "custom-pill";
    btn.textContent = city;
    btn.addEventListener("click", () => {
      selectDesktopCity(city);
    });
    wall.appendChild(btn);
  }
  root.appendChild(wall);
}

function selectDesktopCity(city) {
  desktopPickerState.city = city;
  desktopPickerState.search = "";

  const videos = getFilteredFanVideos(desktopPickerState.country, city);
  if (videos.length === 1) {
    setActiveBrush(videos[0].videoId);
    announce(`Brush set to ${videos[0].title}.`);
    desktopPickerState.step = "country";
    desktopPickerState.country = "";
    desktopPickerState.city = "";
    desktopPickerState.search = "";
    renderDesktopPicker();
    return;
  }

  desktopPickerState.step = "video";
  renderDesktopPicker();
}

function renderDesktopVideoStep(root, list) {
  const info = document.createElement("p");
  info.className = "custom-picker-info";
  info.textContent = "Pick a video for painting slots.";
  root.appendChild(info);

  const query = desktopPickerState.search.toLowerCase();
  const videos = getFilteredFanVideos(desktopPickerState.country, desktopPickerState.city)
    .filter((fan) => (
      !query
      || fan.title.toLowerCase().includes(query)
      || fan.city.toLowerCase().includes(query)
      || fan.country.toLowerCase().includes(query)
    ));

  renderDesktopVideoList(root, list, videos);
}

function renderDesktopVideoList(root, list, videos) {
  if (!list || !root) return;
  list.textContent = "";

  if (FAN_VIDEOS.length === 0) {
    const msg = document.createElement("p");
    msg.className = "custom-list-empty";
    msg.textContent = "Fan video database unavailable.";
    root.appendChild(msg);
    return;
  }

  if (videos.length === 0) {
    const msg = document.createElement("p");
    msg.className = "custom-list-empty";
    msg.textContent = "No videos match your search.";
    root.appendChild(msg);
    return;
  }
  const fragment = document.createDocumentFragment();

  for (const fan of videos) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "custom-video-option";
    btn.dataset.videoId = fan.videoId;
    if (activeBrushVideoId === fan.videoId) {
      btn.classList.add("is-selected");
    }

    const top = document.createElement("div");
    top.className = "custom-video-top";

    const title = document.createElement("span");
    title.className = "custom-video-title";
    title.textContent = fan.title;
    top.appendChild(title);

    if (Number.isFinite(fan.duration)) {
      const dur = document.createElement("span");
      dur.className = "custom-video-duration";
      dur.textContent = formatDurationCompact(fan.duration);
      top.appendChild(dur);
    }

    const meta = document.createElement("div");
    meta.className = "custom-video-meta";
    meta.textContent = `${fan.country}${fan.city ? ` / ${fan.city}` : ""}`;

    if (fan.isShort) {
      const shortBadge = document.createElement("span");
      shortBadge.className = "custom-video-short-badge";
      shortBadge.textContent = "< 4:00 (fallback)";
      meta.appendChild(shortBadge);
    }

    btn.appendChild(top);
    btn.appendChild(meta);
    fragment.appendChild(btn);
  }

  list.appendChild(fragment);
}

function getCitiesForCountry(country) {
  const set = new Set();
  for (const fan of FAN_VIDEOS) {
    if (country && fan.country !== country) continue;
    if (fan.city) set.add(fan.city);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function getFilteredFanVideos(country, city) {
  return FAN_VIDEOS.filter((fan) => {
    if (country && fan.country !== country) return false;
    if (city && fan.city !== city) return false;
    return true;
  });
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

function openMobilePicker(slotIndex) {
  if (!isMobilePickerViewport()) return;

  mobilePickerState = {
    open: true,
    slotIndex,
    step: "country",
    country: "",
    city: "",
  };
  renderMobilePicker();
}

function closeMobilePicker() {
  mobilePickerState = {
    open: false,
    slotIndex: null,
    step: "country",
    country: "",
    city: "",
  };
  renderMobilePicker();
}

function renderMobilePicker() {
  const panel = document.getElementById("custom-mobile-picker");
  if (!panel) return;

  if (!customizerOpen || !isMobilePickerViewport() || !mobilePickerState.open) {
    panel.hidden = true;
    panel.textContent = "";
    return;
  }

  panel.hidden = false;
  panel.textContent = "";

  const head = document.createElement("div");
  head.className = "custom-mobile-head";

  const title = document.createElement("div");
  title.className = "custom-mobile-title";
  title.textContent = `Pick for ${formatSlotLabel(mobilePickerState.slotIndex)}`;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "custom-mobile-close";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeMobilePicker);

  head.appendChild(title);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  if (mobilePickerState.step !== "country") {
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "custom-mobile-back";
    backBtn.textContent = "Back";
    backBtn.addEventListener("click", onMobilePickerBack);
    panel.appendChild(backBtn);
  }

  if (mobilePickerState.step === "country") {
    renderMobileCountryStep(panel);
  } else if (mobilePickerState.step === "city") {
    renderMobileCityStep(panel);
  } else {
    renderMobileVideoStep(panel);
  }
}

function onMobilePickerBack() {
  if (mobilePickerState.step === "video") {
    const cities = getCitiesForCountry(mobilePickerState.country);
    mobilePickerState.step = cities.length > 1 ? "city" : "country";
    renderMobilePicker();
    return;
  }

  if (mobilePickerState.step === "city") {
    mobilePickerState.step = "country";
    renderMobilePicker();
  }
}

function renderMobileCountryStep(panel) {
  const info = document.createElement("p");
  info.className = "custom-mobile-info";
  info.textContent = "Choose a country";
  panel.appendChild(info);

  const pills = document.createElement("div");
  pills.className = "custom-mobile-pills";

  for (const country of FAN_COUNTRIES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "custom-pill";
    btn.textContent = country;
    btn.addEventListener("click", () => {
      chooseMobileCountry(country);
    });
    pills.appendChild(btn);
  }

  panel.appendChild(pills);
}

function chooseMobileCountry(country) {
  mobilePickerState.country = country;
  mobilePickerState.city = "";

  const cities = getCitiesForCountry(country);
  if (cities.length <= 1) {
    mobilePickerState.city = cities[0] || "";

    const videos = getFilteredFanVideos(country, mobilePickerState.city);
    if (videos.length === 1) {
      applyMobileVideoChoice(videos[0]);
      return;
    }

    mobilePickerState.step = "video";
    renderMobilePicker();
    return;
  }

  mobilePickerState.step = "city";
  renderMobilePicker();
}

function renderMobileCityStep(panel) {
  const info = document.createElement("p");
  info.className = "custom-mobile-info";
  info.textContent = `Choose city in ${mobilePickerState.country}`;
  panel.appendChild(info);

  const pills = document.createElement("div");
  pills.className = "custom-mobile-pills";

  const cities = getCitiesForCountry(mobilePickerState.country);
  for (const city of cities) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "custom-pill";
    btn.textContent = city;
    btn.addEventListener("click", () => {
      chooseMobileCity(city);
    });
    pills.appendChild(btn);
  }

  panel.appendChild(pills);
}

function chooseMobileCity(city) {
  mobilePickerState.city = city;

  const videos = getFilteredFanVideos(mobilePickerState.country, city);
  if (videos.length === 1) {
    applyMobileVideoChoice(videos[0]);
    return;
  }

  mobilePickerState.step = "video";
  renderMobilePicker();
}

function renderMobileVideoStep(panel) {
  const info = document.createElement("p");
  info.className = "custom-mobile-info";
  info.textContent = "Choose video";
  panel.appendChild(info);

  const list = document.createElement("div");
  list.className = "custom-mobile-video-list";

  const videos = getFilteredFanVideos(mobilePickerState.country, mobilePickerState.city);
  for (const fan of videos) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "custom-mobile-video-option";

    const top = document.createElement("div");
    top.className = "custom-mobile-video-top";

    const title = document.createElement("span");
    title.className = "custom-mobile-video-title";
    title.textContent = fan.title;
    top.appendChild(title);

    if (Number.isFinite(fan.duration)) {
      const dur = document.createElement("span");
      dur.className = "custom-mobile-video-duration";
      dur.textContent = formatDurationCompact(fan.duration);
      top.appendChild(dur);
    }

    const meta = document.createElement("div");
    meta.className = "custom-mobile-video-meta";
    meta.textContent = `${fan.country}${fan.city ? ` / ${fan.city}` : ""}`;

    if (fan.isShort) {
      const badge = document.createElement("span");
      badge.className = "custom-video-short-badge";
      badge.textContent = "< 4:00 (fallback)";
      meta.appendChild(badge);
    }

    btn.appendChild(top);
    btn.appendChild(meta);
    btn.addEventListener("click", () => {
      applyMobileVideoChoice(fan);
    });

    list.appendChild(btn);
  }

  if (videos.length === 0) {
    const empty = document.createElement("p");
    empty.className = "custom-list-empty";
    empty.textContent = "No videos for this selection.";
    panel.appendChild(empty);
  } else {
    panel.appendChild(list);
  }
}

function applyMobileVideoChoice(fan) {
  if (!fan || !FAN_BY_ID.has(fan.videoId)) return;

  setActiveBrush(fan.videoId);

  if (Number.isInteger(mobilePickerState.slotIndex)) {
    assignSlot(mobilePickerState.slotIndex, fan.videoId);
  }

  closeMobilePicker();
  announce(`Selected ${fan.title} as paint brush.`);
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
