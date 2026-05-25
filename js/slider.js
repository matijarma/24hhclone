// Circular 24-hour slider rendered as an SVG inside a fixed -500..500 viewBox.
// Exposes:
//   initSlider(svg, { initialMinute, onChange }) -> { setMinuteOfDay, getMinuteOfDay }
//
// onChange(minute, { committed }) fires:
//   - during drag/keyboard with committed=false (throttled to ~6Hz for scrub)
//   - on pointerup / keyboard release with committed=true

import { formatTime } from "./time.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const R_TRACK = 380;
const TICK_INNER = 380;
const TICK_OUTER = 402;
const TICK_OUTER_CARDINAL = 420;
const R_LABEL = 452;
const R_THUMB = 14;
const R_THUMB_HIT = 32;
const R_THUMB_HALO = 26;
const CIRC = 2 * Math.PI * R_TRACK;
const MIN_PER_DAY = 1440;
const LABEL_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

let svgEl = null;
let trackEl, progressEl, thumbEl, thumbHitEl, haloEl;
let onChangeCb = null;
let minuteOfDay = 0;
let dragging = false;
let scrubThrottleAt = 0;
let interactive = true;
let baseTabIndex = "0";
let labelMode = "24h";
const labelEls = [];
const SCRUB_HZ_MS = 160; // ~6 Hz

export function initSlider(svg, { initialMinute = 0, onChange = () => {} } = {}) {
  svgEl = svg;
  onChangeCb = onChange;
  baseTabIndex = svg.getAttribute("tabindex") || "0";
  interactive = true;
  labelMode = "24h";
  labelEls.length = 0;

  // Build SVG content.
  // Pointer hit-ring (transparent, generous grab zone along the track).
  appendChild(svg, circle({ cx: 0, cy: 0, r: R_TRACK, class: "hit" }));

  // Visible track.
  trackEl = appendChild(svg, circle({ cx: 0, cy: 0, r: R_TRACK, class: "track" }));

  // Progress arc - same circle, rotated -90deg so dasharray starts at top.
  progressEl = appendChild(svg, circle({
    cx: 0, cy: 0, r: R_TRACK, class: "progress",
    transform: "rotate(-90)",
    "stroke-dasharray": `0 ${CIRC}`,
    "stroke-dashoffset": "0",
  }));

  // 24 hour ticks.
  for (let h = 0; h < 24; h++) {
    const theta = hourToAngle(h);
    const cardinal = h === 0 || h === 6 || h === 12 || h === 18;
    const outer = cardinal ? TICK_OUTER_CARDINAL : TICK_OUTER;
    const x1 = Math.cos(theta) * TICK_INNER;
    const y1 = Math.sin(theta) * TICK_INNER;
    const x2 = Math.cos(theta) * outer;
    const y2 = Math.sin(theta) * outer;
    appendChild(svg, line({
      x1, y1, x2, y2,
      class: cardinal ? "tick cardinal" : "tick",
    }));
  }

  // Hour labels around the dial. Cardinal (0/6/12/18) are full size; the
  // off-cardinals are smaller and more subtle.
  for (const h of LABEL_HOURS) {
    const cardinal = h === 0 || h === 6 || h === 12 || h === 18;
    const theta = hourToAngle(h);
    const x = Math.cos(theta) * R_LABEL;
    const y = Math.sin(theta) * R_LABEL;
    const classes = ["label"];
    if (h === 12) classes.push("label-bottom");
    const attrs = { x, y, class: classes.join(" ") };
    if (!cardinal) attrs.style = "font-size: 28px; opacity: 0.55;";
    const el = appendChild(svg, textNode(attrs, formatRingLabel(h, labelMode)));
    labelEls.push({ hour: h, el });
  }

  // Thumb halo (focus/drag), thumb, thumb hit-target.
  haloEl = appendChild(svg, circle({ cx: 0, cy: 0, r: R_THUMB_HALO, class: "thumb-halo" }));
  thumbEl = appendChild(svg, circle({ cx: 0, cy: 0, r: R_THUMB, class: "thumb" }));
  thumbHitEl = appendChild(svg, circle({ cx: 0, cy: 0, r: R_THUMB_HIT, class: "thumb-hit" }));

  // Set initial position.
  setMinuteOfDay(initialMinute);

  // Pointer events.
  const startDrag = (e) => {
    if (!interactive) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    svg.classList.add("dragging");
    svg.setPointerCapture?.(e.pointerId);
    handlePointer(e, /*committed*/ false);
  };
  const moveDrag = (e) => {
    if (!interactive) return;
    if (!dragging) return;
    e.preventDefault();
    const now = performance.now();
    const force = (now - scrubThrottleAt) >= SCRUB_HZ_MS;
    handlePointer(e, /*committed*/ false, /*emitScrub*/ force);
    if (force) scrubThrottleAt = now;
  };
  const endDrag = (e) => {
    if (!interactive) return;
    if (!dragging) return;
    dragging = false;
    svg.classList.remove("dragging");
    try { svg.releasePointerCapture?.(e.pointerId); } catch (_) {}
    handlePointer(e, /*committed*/ true, /*emitScrub*/ true);
  };

  svg.addEventListener("pointerdown", startDrag);
  svg.addEventListener("pointermove", moveDrag);
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("lostpointercapture", endDrag);

  // Keyboard.
  svg.addEventListener("keydown", (e) => {
    if (!interactive) return;
    let delta = 0;
    let absolute = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        delta = e.shiftKey ? -15 : -1;
        break;
      case "ArrowRight":
      case "ArrowUp":
        delta = e.shiftKey ? 15 : 1;
        break;
      case "PageDown":
        delta = -60;
        break;
      case "PageUp":
        delta = 60;
        break;
      case "Home":
        absolute = 0;
        break;
      case "End":
        absolute = MIN_PER_DAY - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const next = absolute !== null
      ? absolute
      : wrap(minuteOfDay + delta);
    setMinuteOfDay(next);
    onChangeCb?.(next, { committed: true });
  });

  return {
    setMinuteOfDay,
    getMinuteOfDay: () => minuteOfDay,
    setInteractive,
    setLabelMode,
  };
}

export function setMinuteOfDay(min) {
  minuteOfDay = wrap(Math.round(min));
  const theta = minuteToAngle(minuteOfDay);
  const x = Math.cos(theta) * R_TRACK;
  const y = Math.sin(theta) * R_TRACK;
  if (thumbEl) {
    thumbEl.setAttribute("cx", x);
    thumbEl.setAttribute("cy", y);
  }
  if (thumbHitEl) {
    thumbHitEl.setAttribute("cx", x);
    thumbHitEl.setAttribute("cy", y);
  }
  if (haloEl) {
    haloEl.setAttribute("cx", x);
    haloEl.setAttribute("cy", y);
  }
  if (progressEl) {
    const len = (minuteOfDay / MIN_PER_DAY) * CIRC;
    progressEl.setAttribute("stroke-dasharray", `${len} ${CIRC}`);
  }
  if (svgEl) {
    svgEl.setAttribute("aria-valuenow", String(minuteOfDay));
    svgEl.setAttribute("aria-valuetext", formatTime(minuteOfDay, labelMode));
  }
}

export function setInteractive(enabled) {
  interactive = Boolean(enabled);
  if (!svgEl) return;
  svgEl.classList.toggle("is-disabled", !interactive);
  if (interactive) {
    svgEl.setAttribute("tabindex", baseTabIndex);
    svgEl.removeAttribute("aria-disabled");
  } else {
    svgEl.classList.remove("dragging");
    dragging = false;
    svgEl.setAttribute("tabindex", "-1");
    svgEl.setAttribute("aria-disabled", "true");
  }
}

export function setLabelMode(mode = "24h") {
  labelMode = mode === "ampm" ? "ampm" : "24h";
  for (const { hour, el } of labelEls) {
    el.textContent = formatRingLabel(hour, labelMode);
  }
  if (svgEl) {
    svgEl.setAttribute("aria-valuetext", formatTime(minuteOfDay, labelMode));
  }
}

function handlePointer(e, committed, emitScrub = true) {
  const min = pointerToMinute(e);
  setMinuteOfDay(min);
  if (committed || emitScrub) {
    onChangeCb?.(minuteOfDay, { committed });
  }
}

function pointerToMinute(e) {
  const rect = svgEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  // theta: 0 = +x axis (3 o'clock), grows CCW in standard math. SVG y is flipped, so atan2(dy,dx) gives CW angle when y points down - which matches us.
  let theta = Math.atan2(dy, dx);
  // Shift origin so 0 = top (12 o'clock).
  let a = theta + Math.PI / 2;
  if (a < 0) a += Math.PI * 2;
  // Convert to minute.
  const min = Math.round((a / (Math.PI * 2)) * MIN_PER_DAY);
  return wrap(min);
}

function wrap(min) {
  return ((min % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

function hourToAngle(h) {
  return minuteToAngle(h * 60);
}
function minuteToAngle(m) {
  return (m / MIN_PER_DAY) * Math.PI * 2 - Math.PI / 2;
}

function formatRingLabel(hour, mode) {
  if (mode !== "ampm") {
    return String(hour).padStart(2, "0");
  }
  const hour12 = hour % 12 || 12;
  const suffix = hour >= 12 ? "P" : "A";
  return `${hour12}${suffix}`;
}

function appendChild(parent, el) {
  parent.appendChild(el);
  return el;
}

function circle(attrs) {
  const el = document.createElementNS(SVG_NS, "circle");
  setAttrs(el, attrs);
  return el;
}
function line(attrs) {
  const el = document.createElementNS(SVG_NS, "line");
  setAttrs(el, attrs);
  return el;
}
function textNode(attrs, text) {
  const el = document.createElementNS(SVG_NS, "text");
  setAttrs(el, attrs);
  el.textContent = text;
  return el;
}
function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
}
