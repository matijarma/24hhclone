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
  resumePlayback,
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
const STORAGE_SHUFFLE_HISTORY_KEY = "24hh.shuffle-history.v1";

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

const CONTINENT_ORDER = ["EU", "AS", "AF", "NA", "SA", "OC", "AN", "??"];
const CONTINENT_LABEL = {
  EU: "Europe",
  AS: "Asia",
  AF: "Africa",
  NA: "N. America",
  SA: "S. America",
  OC: "Oceania",
  AN: "Antarctic",
  "??": "Other",
};
const CONTINENT_BY_COUNTRY = {
  AD:"EU", AL:"EU", AT:"EU", BA:"EU", BE:"EU", BG:"EU", BY:"EU", CH:"EU",
  CY:"EU", CZ:"EU", DE:"EU", DK:"EU", EE:"EU", ES:"EU", FI:"EU", FR:"EU",
  GB:"EU", GR:"EU", HR:"EU", HU:"EU", IE:"EU", IS:"EU", IT:"EU", LI:"EU",
  LT:"EU", LU:"EU", LV:"EU", MC:"EU", MD:"EU", ME:"EU", MK:"EU", MT:"EU",
  NL:"EU", NO:"EU", PL:"EU", PT:"EU", RO:"EU", RS:"EU", RU:"EU", SE:"EU",
  SI:"EU", SK:"EU", SM:"EU", UA:"EU", VA:"EU", XK:"EU",
  BB:"NA", BM:"NA", BS:"NA", BZ:"NA", CA:"NA", CR:"NA", CU:"NA", DO:"NA",
  GL:"NA", GT:"NA", HN:"NA", HT:"NA", JM:"NA", MX:"NA", NI:"NA", PA:"NA",
  PR:"NA", SV:"NA", TT:"NA", US:"NA",
  AR:"SA", BO:"SA", BR:"SA", CL:"SA", CO:"SA", EC:"SA", FK:"SA", GY:"SA",
  PE:"SA", PY:"SA", SR:"SA", UY:"SA", VE:"SA",
  AE:"AS", AF:"AS", AM:"AS", AZ:"AS", BD:"AS", BN:"AS", BT:"AS", CN:"AS",
  GE:"AS", HK:"AS", ID:"AS", IL:"AS", IN:"AS", IQ:"AS", IR:"AS", JO:"AS",
  JP:"AS", KG:"AS", KH:"AS", KP:"AS", KR:"AS", KW:"AS", KZ:"AS", LA:"AS",
  LB:"AS", LK:"AS", MM:"AS", MN:"AS", MO:"AS", MV:"AS", MY:"AS", NP:"AS",
  OM:"AS", PH:"AS", PK:"AS", PS:"AS", QA:"AS", SA:"AS", SG:"AS", SY:"AS",
  TH:"AS", TJ:"AS", TL:"AS", TM:"AS", TR:"AS", TW:"AS", UZ:"AS", VN:"AS",
  YE:"AS",
  AO:"AF", BF:"AF", BI:"AF", BJ:"AF", BW:"AF", CD:"AF", CF:"AF", CG:"AF",
  CI:"AF", CM:"AF", CV:"AF", DJ:"AF", DZ:"AF", EG:"AF", EH:"AF", ER:"AF",
  ET:"AF", GA:"AF", GH:"AF", GM:"AF", GN:"AF", GQ:"AF", GW:"AF", KE:"AF",
  KM:"AF", LR:"AF", LS:"AF", LY:"AF", MA:"AF", MG:"AF", ML:"AF", MR:"AF",
  MU:"AF", MW:"AF", MZ:"AF", NA:"AF", NE:"AF", NG:"AF", RW:"AF", SC:"AF",
  SD:"AF", SL:"AF", SN:"AF", SO:"AF", SS:"AF", ST:"AF", SZ:"AF", TD:"AF",
  TG:"AF", TN:"AF", TZ:"AF", UG:"AF", ZA:"AF", ZM:"AF", ZW:"AF",
  AU:"OC", FJ:"OC", FM:"OC", KI:"OC", MH:"OC", NC:"OC", NR:"OC", NZ:"OC",
  PF:"OC", PG:"OC", PW:"OC", SB:"OC", TK:"OC", TO:"OC", TV:"OC", VU:"OC", WS:"OC",
  AQ:"AN", TF:"AN",
};

let HOURS = [];
let FAN_VIDEOS = [];
let FAN_BY_ID = new Map();
let FAN_COUNTRIES = [];
let flaggedFanVideoIds = new Set();

let customAssignments = createEmptyAssignments();
let pickerState = {
  path: [],
  search: "",
};
let activeBrushVideoId = null;
let slotCellEls = new Array(SLOTS_PER_DAY).fill(null);
let customizerOpen = false;
let customizerReady = false;
let paintDragging = false;
let customSyncTimer = null;
let pendingPaintSlotIndex = null;
let closeAnimTimer = null;
let lastNowHourRow = null;
let lastNowSlotEl = null;
let deleteMode = false;
let shuffleMode = false;
let preShuffleAssignments = null;
let infoCloseAnimTimer = null;
let infoMarkdownCache = null;

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
let lastFanLocationText = null;
let wasPlayingBeforeHidden = false;
let lastFocusRecoveryAt = 0;

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
  const readout = document.getElementById("readout");
  const playPauseBtn = document.getElementById("playpause");
  const muteBtn = document.getElementById("mute-toggle");
  const toggleBtn = document.getElementById("toggle-overlay");
  const formatBtn = document.getElementById("format-toggle");
  const installBtn = document.getElementById("install-app");
  const widgetBtn = document.getElementById("clock-widget");
  const customizeBtn = document.getElementById("customize-playlist");
  const shuffleBtn = document.getElementById("shuffle");
  const infoBtn = document.getElementById("info");
  const infoCloseBtn = document.getElementById("info-close");
  const infoModal = document.getElementById("info-modal");

  readout?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    resyncNow();
  });
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
  shuffleBtn?.addEventListener("click", toggleShuffleMode);
  infoBtn?.addEventListener("click", () => { void openInfoModal(); });
  infoCloseBtn?.addEventListener("click", closeInfoModal);
  infoModal?.querySelector(".info-backdrop")?.addEventListener("click", closeInfoModal);

  updateOverlayToggleButton(isOverlayHidden());
  updateFormatToggleButton();
  updateCustomizeButtonState();
}

function wireNormalQuickActions() {
  document.addEventListener("click", onNormalModeClick);
  document.addEventListener("dblclick", onNormalModeDoubleClick);
}

function onNormalModeClick(e) {
  if (clockWidgetMode || isQuickActionModalOpen()) return;
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
    if (clockWidgetMode || isQuickActionModalOpen()) return;
    void toggleMuteState();
  }, CLOCK_SINGLE_TAP_DELAY_MS);
}

function onNormalModeDoubleClick(e) {
  if (clockWidgetMode || isQuickActionModalOpen()) return;
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
  return Boolean(target.closest(".controls, #slider, .readout, footer, header, a, button, .customize-modal, .info-modal"));
}

function isNormalModeDoubleTapExcluded(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".controls, .readout, footer, header, a, button, .customize-modal, .info-modal"));
}

function isQuickActionModalOpen() {
  return isCustomizerModalOpen() || isInfoModalOpen();
}

function wireGlobalKeys() {
  document.addEventListener("keydown", (e) => {
    if (isInfoModalOpen() && e.key === "Escape") {
      e.preventDefault();
      closeInfoModal();
      return;
    }

    if (customizerOpen && e.key === "Escape") {
      e.preventDefault();
      closeCustomizerModal();
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

  toggleBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
  toggleBtn.setAttribute("aria-label", hidden ? "Show overlay" : "Hide overlay");
  toggleBtn.title = hidden ? "Show overlay" : "Hide overlay";
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
    muteBtn.classList.toggle("ctrl-unmute", muted);
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.setAttribute("aria-label", muted ? "Unmute video" : "Mute video");
    muteBtn.title = muted ? "Unmute" : "Mute";
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

    updateFanLocationDisplays();

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
  if (clockWidgetMode || isQuickActionModalOpen()) return;

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
  if (!clockWidgetMode || isQuickActionModalOpen()) return;
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
    if (!clockWidgetMode || isQuickActionModalOpen()) return;
    void toggleMuteState();
  }, CLOCK_SINGLE_TAP_DELAY_MS);
}

function onClockWidgetDoubleClick(e) {
  if (!clockWidgetMode || isQuickActionModalOpen()) return;
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

function updateFanLocationDisplays() {
  const fan = getCurrentFanPlaybackMeta();
  const locationText = fan ? formatFanLocationText(fan) : "";
  if (locationText === lastFanLocationText) return;
  lastFanLocationText = locationText;

  const readoutSub = document.getElementById("readout-sub");
  if (readoutSub) {
    readoutSub.textContent = locationText ? `now playing from ${locationText}` : "now playing";
  }

  const clockWidgetLocation = document.getElementById("clock-widget-location");
  if (clockWidgetLocation) {
    clockWidgetLocation.textContent = locationText;
    clockWidgetLocation.dataset.visible = locationText ? "true" : "false";
  }

  const overlayFanLocation = document.getElementById("overlay-fan-location");
  if (overlayFanLocation) {
    overlayFanLocation.textContent = locationText;
    overlayFanLocation.dataset.visible = locationText ? "true" : "false";
  }
}

function getCurrentFanPlaybackMeta() {
  const currentSecond = getCurrentSecondOfDay();
  if (!Number.isFinite(currentSecond)) return null;

  const sec = normalizeSecondOfDay(currentSecond);
  const slotIndex = Math.floor(sec / SLOT_SECONDS);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOTS_PER_DAY) return null;

  const fanVideoId = customAssignments[slotIndex];
  if (!fanVideoId) return null;

  const fan = FAN_BY_ID.get(fanVideoId);
  if (!fan) return null;

  const slotOffset = sec - (slotIndex * SLOT_SECONDS);
  const fanDuration = Number.isFinite(fan.duration)
    ? Math.max(0, Math.floor(fan.duration))
    : SLOT_SECONDS;
  if (fanDuration <= slotOffset) return null;

  return fan;
}

function formatFanLocationText(fan) {
  return fan && fan.city ? fan.city : "";
}

function normalizeSecondOfDay(second) {
  const daySeconds = 24 * 60 * 60;
  return ((Math.floor(second) % daySeconds) + daySeconds) % daySeconds;
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
  const closeTopBtn = document.getElementById("customize-close");
  const closeBottomBtn = document.getElementById("customize-done");
  const resetBtn = document.getElementById("custom-reset");
  const clearBrushBtn = document.getElementById("custom-clear-brush");
  const randomizeBtn = document.getElementById("custom-randomize");
  const deletePaintBtn = document.getElementById("custom-delete-paint");
  const backdrop = modal?.querySelector(".customize-backdrop");

  if (!modal || !grid || !desktopRoot || !desktopSearch) return;

  buildCustomizerGrid(grid);
  renderBrushBar();
  renderPickerLists();
  renderAllSlotCells();

  desktopSearch.addEventListener("input", () => {
    pickerState.search = desktopSearch.value;
    renderPickerLists();
  });

  desktopRoot.addEventListener("click", onPickerListClick);

  document.getElementById("custom-breadcrumb")?.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const seg = e.target.closest("[data-breadcrumb-depth]");
    if (!(seg instanceof HTMLElement)) return;
    const depth = parseInt(seg.dataset.breadcrumbDepth || "", 10);
    onBreadcrumbClick(depth);
  });

  grid.addEventListener("pointerdown", onGridPointerDown);
  grid.addEventListener("pointerover", onGridPointerOver);
  grid.addEventListener("dblclick", onGridDoubleClick);
  window.addEventListener("pointerup", () => {
    paintDragging = false;
  });

  closeTopBtn?.addEventListener("click", closeCustomizerModal);
  closeBottomBtn?.addEventListener("click", closeCustomizerModal);
  resetBtn?.addEventListener("click", resetCustomLayout);
  clearBrushBtn?.addEventListener("click", () => setActiveBrush(null));
  randomizeBtn?.addEventListener("click", randomizeGrid);
  deletePaintBtn?.addEventListener("click", toggleDeleteMode);

  backdrop?.addEventListener("click", () => closeCustomizerModal());

  customizerReady = true;
  updateCustomizeButtonState();
}

function openCustomizerModal() {
  if (!customizerReady) return;
  if (FAN_VIDEOS.length === 0) {
    announce("Fan video database is unavailable.");
    return;
  }
  if (shuffleMode) setShuffleMode(false);

  const modal = document.getElementById("customize-modal");
  if (!modal) return;

  if (closeAnimTimer !== null) {
    clearTimeout(closeAnimTimer);
    closeAnimTimer = null;
  }

  customizerOpen = true;
  pendingPaintSlotIndex = null;
  applyDeleteMode(false);
  modal.hidden = false;
  modal.dataset.state = "opening";
  document.body.classList.add("customize-open");
  syncSliderInteractivity();

  pickerState.search = "";
  pickerState.path = [];
  const desktopSearch = document.getElementById("custom-picker-search");
  if (desktopSearch) desktopSearch.value = "";

  renderBrushBar();
  renderPickerLists();
  renderAllSlotCells();
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
  const interactive = !clockWidgetMode && !customizerOpen && !isOverlayHidden() && !shuffleMode;
  sliderSetInteractive(interactive);
}

function updateCustomizeButtonState() {
  const btn = document.getElementById("customize-playlist");
  if (!btn) return;

  if (FAN_VIDEOS.length === 0) {
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
    btn.title = "Fan video database unavailable";
  } else if (shuffleMode) {
    btn.disabled = true;
    btn.title = "Disabled during shuffle";
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
    row.dataset.hour = String(hour);
    row.dataset.col = hour < 12 ? "am" : "pm";

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

  if (deleteMode) {
    paintDragging = !isMobilePickerViewport();
    clearSlotAssignment(slot);
    e.preventDefault();
    return;
  }

  if (activeBrushVideoId && FAN_BY_ID.has(activeBrushVideoId)) {
    paintDragging = !isMobilePickerViewport();
    assignSlot(slot, activeBrushVideoId);
    e.preventDefault();
    return;
  }

  pendingPaintSlotIndex = slot;
  const search = document.getElementById("custom-picker-search");
  if (search) {
    search.scrollIntoView({ block: "nearest", behavior: "smooth" });
    search.focus({ preventScroll: true });
  }
  announce(`Pick a video to paint slot ${formatSlotLabel(slot)}.`);
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

  if (deleteMode) {
    clearSlotAssignment(slot);
    return;
  }

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

function setActiveBrush(videoId) {
  const normalized = (videoId && FAN_BY_ID.has(videoId)) ? videoId : null;
  if (normalized) applyDeleteMode(false);
  if (normalized === activeBrushVideoId) return;

  activeBrushVideoId = normalized;
  renderBrushBar();
  refreshPickerSelection();
  renderAllSlotCells();
}

function applyDeleteMode(on) {
  const next = Boolean(on);
  if (next === deleteMode) return;
  deleteMode = next;

  document.body.classList.toggle("delete-paint-mode", deleteMode);
  const btn = document.getElementById("custom-delete-paint");
  if (btn) {
    btn.classList.toggle("is-active", deleteMode);
    btn.setAttribute("aria-pressed", deleteMode ? "true" : "false");
  }
  const wrap = document.getElementById("customize-brush");
  if (wrap) {
    if (deleteMode) wrap.dataset.mode = "erase";
    else delete wrap.dataset.mode;
  }
  renderBrushBar();
}

function toggleDeleteMode() {
  applyDeleteMode(!deleteMode);
  announce(deleteMode ? "Erase mode on. Tap or drag slots to clear them." : "Erase mode off.");
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function filterSlotEligibleVideos(videos) {
  if (!Array.isArray(videos)) return [];
  return videos.filter((fan) => fan && !fan.isShort);
}

// Build a 360-length array of videoIds from a pool, avoiding consecutive repeats.
function buildRandomFill(pool) {
  const ids = pool.map((v) => v.videoId);
  if (ids.length === 0) return new Array(SLOTS_PER_DAY).fill(null);

  if (ids.length === 1) {
    const out = new Array(SLOTS_PER_DAY).fill(null);
    for (let i = 0; i < SLOTS_PER_DAY; i += 2) out[i] = ids[0];
    return out;
  }

  const queue = [];
  while (queue.length < SLOTS_PER_DAY) {
    for (const id of shuffleArray(ids)) {
      queue.push(id);
      if (queue.length >= SLOTS_PER_DAY) break;
    }
  }
  // De-dup consecutive: if queue[i] === queue[i-1], swap with a later non-matching entry.
  for (let i = 1; i < queue.length; i++) {
    if (queue[i] !== queue[i - 1]) continue;
    for (let j = i + 1; j < queue.length; j++) {
      if (queue[j] !== queue[i - 1] && (j + 1 >= queue.length || queue[j + 1] !== queue[i])) {
        [queue[i], queue[j]] = [queue[j], queue[i]];
        break;
      }
    }
  }
  return queue.slice(0, SLOTS_PER_DAY);
}

function randomizeGrid() {
  const scope = pickerState.path.length > 0 ? videosAtPath(pickerState.path) : FAN_VIDEOS.slice();
  if (scope.length === 0) {
    announce("No videos in this scope to randomize from.");
    return;
  }
  const eligibleScope = filterSlotEligibleVideos(scope);
  if (eligibleScope.length === 0) {
    announce("No 4+ minute videos in this scope to randomize from.");
    return;
  }

  const fill = buildRandomFill(eligibleScope);
  customAssignments = createEmptyAssignments();
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    customAssignments[i] = fill[i] && FAN_BY_ID.has(fill[i]) ? fill[i] : null;
  }
  applyDeleteMode(false);
  renderAllSlotCells();
  updateCustomizeButtonState();
  scheduleCustomPlaylistSync({ immediate: true });

  const scopeName = pickerState.path.length > 0
    ? (CONTINENT_LABEL[pickerState.path[pickerState.path.length - 1]] || pickerState.path[pickerState.path.length - 1])
    : "all videos";
  announce(`Randomized the day from ${eligibleScope.length} ${eligibleScope.length === 1 ? "video" : "videos"} in ${scopeName}.`);
}

function renderBrushBar() {
  const wrap = document.getElementById("customize-brush");
  const swatch = document.getElementById("brush-swatch");
  const info = document.getElementById("brush-info");
  const clearBtn = document.getElementById("custom-clear-brush");
  if (!wrap || !swatch || !info || !clearBtn) return;

  info.textContent = "";

  if (deleteMode) {
    wrap.dataset.empty = "true";
    swatch.style.background = "";
    swatch.style.boxShadow = "";
    const hint = document.createElement("p");
    hint.className = "brush-hint";
    hint.textContent = "Erasing — tap or drag slots to clear";
    info.appendChild(hint);
    clearBtn.disabled = !activeBrushVideoId;
    return;
  }

  if (!activeBrushVideoId || !FAN_BY_ID.has(activeBrushVideoId)) {
    wrap.dataset.empty = "true";
    swatch.style.background = "";
    swatch.style.boxShadow = "";
    const hint = document.createElement("p");
    hint.className = "brush-hint";
    hint.textContent = "Pick a video to paint";
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

  const line2 = document.createElement("div");
  line2.className = "brush-line2";

  const title = document.createElement("span");
  title.className = "brush-title";
  title.textContent = fan.title;
  line2.appendChild(title);

  if (Number.isFinite(fan.duration)) {
    const dur = document.createElement("span");
    dur.className = "brush-duration";
    dur.textContent = formatDurationCompact(fan.duration);
    line2.appendChild(dur);
  }
  if (fan.isShort) {
    const short = document.createElement("span");
    short.className = "brush-short";
    short.textContent = "Short";
    line2.appendChild(short);
  }

  info.appendChild(place);
  info.appendChild(line2);
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
  renderBreadcrumbs();

  const desktopRoot = document.getElementById("custom-desktop-picker");
  if (desktopRoot) renderPickerInto(desktopRoot);
}

function continentOf(fan) {
  return CONTINENT_BY_COUNTRY[fan.country] || "??";
}

function videosAtPath(path) {
  return FAN_VIDEOS.filter((fan) => {
    if (path.length >= 1 && continentOf(fan) !== path[0]) return false;
    if (path.length >= 2 && fan.country !== path[1]) return false;
    if (path.length >= 3 && (fan.city || "") !== path[2]) return false;
    return true;
  });
}

function groupKeyForStep(fan, step) {
  if (step === 0) return continentOf(fan);
  if (step === 1) return fan.country;
  if (step === 2) return fan.city || "(unspecified)";
  return null;
}

function renderPickerInto(root) {
  root.textContent = "";

  const browseWrap = root.closest(".customize-browse");
  if (browseWrap) {
    browseWrap.dataset.searching = pickerState.search.trim().length > 0 ? "true" : "false";
  }

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

  const wrap = document.createElement("div");
  wrap.className = "custom-pill-wrap";

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
    matches.sort((a, b) => (a.city || a.country).localeCompare(b.city || b.country) || a.title.localeCompare(b.title));
    for (const fan of matches) {
      wrap.appendChild(buildVideoPill(fan, { context: "search" }));
    }
    root.appendChild(wrap);
    return;
  }

  const path = pickerState.path.slice();
  const step = path.length;
  const candidates = videosAtPath(path);

  if (step === 3) {
    const sorted = candidates.slice().sort((a, b) => a.title.localeCompare(b.title));
    for (const fan of sorted) {
      wrap.appendChild(buildVideoPill(fan, { context: "terminal" }));
    }
    root.appendChild(wrap);
    return;
  }

  const groups = new Map();
  for (const fan of candidates) {
    const key = groupKeyForStep(fan, step);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fan);
  }

  const drillEntries = [];
  const videoEntries = [];
  for (const [key, vids] of groups) {
    if (vids.length === 1) videoEntries.push({ key, fan: vids[0] });
    else drillEntries.push({ key, count: vids.length });
  }

  if (step === 0) {
    drillEntries.sort((a, b) => CONTINENT_ORDER.indexOf(a.key) - CONTINENT_ORDER.indexOf(b.key));
  } else {
    drillEntries.sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
  }
  videoEntries.sort((a, b) => {
    const ka = (a.fan.city || a.fan.country || a.key).toLowerCase();
    const kb = (b.fan.city || b.fan.country || b.key).toLowerCase();
    return ka.localeCompare(kb) || a.fan.title.localeCompare(b.fan.title);
  });

  for (const entry of drillEntries) {
    wrap.appendChild(buildPill(entry.key, step, entry.count));
  }
  for (const entry of videoEntries) {
    const ctx = step === 1 ? "country" : "city";
    wrap.appendChild(buildVideoPill(entry.fan, { context: ctx }));
  }

  if (drillEntries.length === 0 && videoEntries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "custom-list-empty";
    empty.textContent = "No videos here.";
    root.appendChild(empty);
    return;
  }

  root.appendChild(wrap);
}

function buildPill(key, step, count) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "custom-pill";
  btn.dataset.pillKey = key;
  btn.dataset.pillStep = String(step);

  const label = document.createElement("span");
  label.className = "custom-pill-label";
  if (step === 0) {
    label.classList.add("is-upper");
    label.textContent = CONTINENT_LABEL[key] || key;
  } else if (step === 1) {
    label.classList.add("is-upper");
    label.textContent = key;
  } else {
    label.textContent = key;
  }
  btn.appendChild(label);

  const c = document.createElement("span");
  c.className = "custom-pill-count";
  c.textContent = String(count);
  btn.appendChild(c);

  return btn;
}

function renderBreadcrumbs() {
  const el = document.getElementById("custom-breadcrumb");
  if (el) renderBreadcrumbInto(el);
}

function renderBreadcrumbInto(el) {
  el.textContent = "";
  const path = pickerState.path;
  const segments = [{ label: "Browse", depth: 0 }];
  if (path.length >= 1) segments.push({ label: CONTINENT_LABEL[path[0]] || path[0], depth: 1 });
  if (path.length >= 2) segments.push({ label: path[1], depth: 2 });
  if (path.length >= 3) segments.push({ label: path[2], depth: 3 });

  segments.forEach((seg, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "picker-breadcrumb-sep";
      sep.textContent = "›";
      sep.setAttribute("aria-hidden", "true");
      el.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-breadcrumb-seg";
    btn.textContent = seg.label;
    btn.dataset.breadcrumbDepth = String(seg.depth);
    if (idx === segments.length - 1) btn.classList.add("is-current");
    el.appendChild(btn);
  });
}

function buildVideoPill(fan, { context }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "custom-pill is-video";
  btn.dataset.videoId = fan.videoId;
  if (activeBrushVideoId === fan.videoId) btn.classList.add("is-selected");
  if (fan.isShort) btn.classList.add("is-short");

  if (fan.isShort) {
    const dot = document.createElement("span");
    dot.className = "custom-pill-dot";
    dot.setAttribute("aria-hidden", "true");
    btn.appendChild(dot);
  }

  const label = document.createElement("span");
  label.className = "custom-pill-label";

  let labelText;
  if (context === "search") {
    const place = fan.city ? `${fan.city}, ${fan.country}` : fan.country;
    labelText = `${place} · ${fan.title}`;
  } else if (context === "country") {
    labelText = fan.city || fan.country;
  } else if (context === "city") {
    labelText = fan.city || fan.country;
  } else {
    labelText = fan.title;
  }
  label.textContent = labelText;
  btn.appendChild(label);

  if (Number.isFinite(fan.duration)) {
    const dur = document.createElement("span");
    dur.className = "custom-pill-duration";
    dur.textContent = formatDurationCompact(fan.duration);
    btn.appendChild(dur);
  }

  btn.title = `${fan.title}${fan.city ? ` — ${fan.city}, ${fan.country}` : ` — ${fan.country}`}`;
  return btn;
}

function refreshPickerSelection() {
  const root = document.getElementById("custom-desktop-picker");
  if (!root) return;
  for (const opt of root.querySelectorAll(".custom-pill.is-video")) {
    const isSelected = opt.dataset.videoId === activeBrushVideoId;
    opt.classList.toggle("is-selected", isSelected);
  }
}

function onBreadcrumbClick(depth) {
  if (!Number.isInteger(depth)) return;
  if (depth >= pickerState.path.length) return;
  pickerState.path = pickerState.path.slice(0, depth);
  renderPickerLists();
}

function onPickerListClick(e) {
  if (!(e.target instanceof Element)) return;

  const pill = e.target.closest(".custom-pill");
  if (pill instanceof HTMLButtonElement) {
    const videoId = pill.dataset.videoId;
    if (videoId && FAN_BY_ID.has(videoId)) {
      // fall through to video-pick handling below
    } else {
      const key = pill.dataset.pillKey || "";
      if (!key) return;
      pickerState.path = [...pickerState.path, key];
      renderPickerLists();
      return;
    }
  }

  const option = pill && pill.dataset.videoId ? pill : null;
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

function loadShuffleHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_SHUFFLE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch (_) {
    return [];
  }
}

function persistShuffleHistory(ids) {
  try {
    localStorage.setItem(STORAGE_SHUFFLE_HISTORY_KEY, JSON.stringify(ids));
  } catch (_) {
    // Local storage unavailable.
  }
}

function toggleShuffleMode() {
  setShuffleMode(!shuffleMode);
}

function setShuffleMode(on) {
  const next = Boolean(on);
  if (next === shuffleMode) return;

  const btn = document.getElementById("shuffle");
  const customizeBtn = document.getElementById("customize-playlist");

  if (next) {
    if (FAN_VIDEOS.length === 0) {
      announce("Fan video database is unavailable.");
      return;
    }
    const eligibleVideos = filterSlotEligibleVideos(FAN_VIDEOS);
    if (eligibleVideos.length === 0) {
      announce("No 4+ minute fan videos available for shuffle.");
      return;
    }
    preShuffleAssignments = customAssignments.slice();

    let history = loadShuffleHistory();
    const eligibleIds = new Set(eligibleVideos.map((v) => v.videoId));
    history = history.filter((id) => eligibleIds.has(id));

    let pool = eligibleVideos.filter((v) => !history.includes(v.videoId));
    if (pool.length < SLOTS_PER_DAY) {
      history = [];
      pool = eligibleVideos.slice();
    }
    const fill = buildRandomFill(shuffleArray(pool).slice(0, Math.max(SLOTS_PER_DAY, pool.length)));

    const usedIds = new Set();
    const next360 = createEmptyAssignments();
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      const id = fill[i];
      next360[i] = id && FAN_BY_ID.has(id) ? id : null;
      if (next360[i]) usedIds.add(next360[i]);
    }
    persistShuffleHistory([...history, ...usedIds]);

    customAssignments = next360;
    shuffleMode = true;
    document.body.classList.add("shuffle-mode");
    if (btn) { btn.classList.add("is-active"); btn.setAttribute("aria-pressed", "true"); }
    if (customizeBtn) { customizeBtn.disabled = true; customizeBtn.title = "Disabled during shuffle"; }
    syncSliderInteractivity();
    setCustomPlaylist({ assignmentsBySlot: customAssignments });
    announce("Shuffle on. Playing random videos.");
  } else {
    if (preShuffleAssignments) {
      customAssignments = preShuffleAssignments.slice();
      preShuffleAssignments = null;
    }
    shuffleMode = false;
    document.body.classList.remove("shuffle-mode");
    if (btn) { btn.classList.remove("is-active"); btn.setAttribute("aria-pressed", "false"); }
    if (customizeBtn) { customizeBtn.disabled = FAN_VIDEOS.length === 0; customizeBtn.title = "Customize 24h slots"; }
    syncSliderInteractivity();
    setCustomPlaylist({ assignmentsBySlot: customAssignments });
    updateCustomizeButtonState();
    announce("Shuffle off.");
  }
}

/* ---- Info modal + minimal markdown ---- */
function isInfoModalOpen() {
  const modal = document.getElementById("info-modal");
  return Boolean(modal && !modal.hidden && modal.dataset.state !== "closed");
}

function isCustomizerModalOpen() {
  const modal = document.getElementById("customize-modal");
  return Boolean(modal && !modal.hidden && modal.dataset.state !== "closed");
}

async function openInfoModal() {
  const modal = document.getElementById("info-modal");
  const content = document.getElementById("info-content");
  if (!modal || !content) return;

  if (infoCloseAnimTimer !== null) {
    clearTimeout(infoCloseAnimTimer);
    infoCloseAnimTimer = null;
  }

  if (infoMarkdownCache === null) {
    try {
      const res = await fetch("hello.md", { cache: "no-store" });
      infoMarkdownCache = res.ok ? await res.text() : "# About\n\nNo info available.";
    } catch (_) {
      infoMarkdownCache = "# About\n\nNo info available.";
    }
  }
  content.innerHTML = renderMarkdown(infoMarkdownCache);

  modal.hidden = false;
  modal.dataset.state = "opening";
  requestAnimationFrame(() => {
    modal.dataset.state = "open";
    requestAnimationFrame(() => {
      document.getElementById("info-close")?.focus();
    });
  });
}

function closeInfoModal() {
  const modal = document.getElementById("info-modal");
  if (!modal) return;
  modal.dataset.state = "closing";
  if (infoCloseAnimTimer !== null) clearTimeout(infoCloseAnimTimer);
  infoCloseAnimTimer = window.setTimeout(() => {
    infoCloseAnimTimer = null;
    modal.hidden = true;
    modal.dataset.state = "closed";
  }, 240);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInlineMarkdown(text) {
  let out = escapeHtml(text);
  // code spans first (so their contents aren't further parsed)
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // links [label](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  // bold then italic
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, c) => `<strong>${c}</strong>`);
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, (_m, pre, c) => `${pre}<em>${c}</em>`);
  out = out.replace(/_([^_]+)_/g, (_m, c) => `<em>${c}</em>`);
  return out;
}

function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let para = [];
  let listItems = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInlineMarkdown(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      html.push(`<ul>${listItems.map((li) => `<li>${renderInlineMarkdown(li)}</li>`).join("")}</ul>`);
      listItems = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);

    if (heading) {
      flushPara(); flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushPara();
      listItems.push(bullet[1]);
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return html.join("\n");
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
    if (document.visibilityState === "visible") {
      markUiActive();
      void recoverPlaybackAfterFocusReturn();
    } else if (document.visibilityState === "hidden") {
      void rememberPlaybackStateBeforeHide();
    }
  });
  window.addEventListener("focus", () => {
    markUiActive();
    void recoverPlaybackAfterFocusReturn();
  });

  markUiActive();
}

async function rememberPlaybackStateBeforeHide() {
  try {
    wasPlayingBeforeHidden = await isPlaying();
  } catch (_) {
    wasPlayingBeforeHidden = false;
  }
}

async function recoverPlaybackAfterFocusReturn() {
  const now = performance.now();
  if (now - lastFocusRecoveryAt < 650) return;
  lastFocusRecoveryAt = now;

  if (!wasPlayingBeforeHidden) return;

  let minute = currentMinuteOfDay();
  let secondInMinute = currentSecondsInMinute();

  const playerSec = getCurrentSecondOfDay();
  if (manualOverride && Number.isFinite(playerSec)) {
    const normalized = normalizeSecondOfDay(playerSec);
    minute = Math.floor(normalized / 60);
    secondInMinute = normalized % 60;
  }

  try {
    await playerSetMinuteOfDay(minute, { secondsInMinute: secondInMinute, force: true });
    if (!(await isPlaying())) {
      await resumePlayback();
    }
  } catch (_) {
    // Ignore visibility recovery failures.
  }
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
