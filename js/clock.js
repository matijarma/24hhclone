import { hourLabel, shortHourLabel } from "./time.js";

const RING_RADIUS_PX = 320; // matches --ring-radius default

let buttons = [];
let activeHour = -1;
let stripContainer = null;

export function renderRing(ring, hours, onSelect) {
  // Clean any prior buttons (keep .ring-center)
  Array.from(ring.querySelectorAll(".hour-btn, .hour-strip")).forEach((n) => n.remove());

  const isMobile = window.matchMedia("(max-width: 800px)").matches;

  if (isMobile) {
    stripContainer = document.createElement("div");
    stripContainer.className = "hour-strip";
    ring.appendChild(stripContainer);
  } else {
    stripContainer = null;
  }

  buttons = hours.map((entry) => {
    const btn = document.createElement("button");
    btn.className = "hour-btn";
    btn.type = "button";
    btn.textContent = shortHourLabel(entry.hour);
    btn.setAttribute("aria-label", `Play ${hourLabel(entry.hour)} segment`);
    btn.setAttribute("aria-pressed", "false");
    btn.dataset.hour = String(entry.hour);

    if (!isMobile) {
      // Position around the ring. 0 (midnight) at the top.
      const angle = entry.hour * 15; // 360/24
      btn.style.transform =
        `translate(-50%, -50%) rotate(${angle}deg) translateY(-${RING_RADIUS_PX}px) rotate(${-angle}deg)`;
    }

    btn.addEventListener("click", () => onSelect(entry.hour));

    (stripContainer || ring).appendChild(btn);
    return btn;
  });
}

export function setActiveHour(hour) {
  if (activeHour === hour) return;
  activeHour = hour;
  buttons.forEach((btn, i) => {
    btn.setAttribute("aria-pressed", i === hour ? "true" : "false");
  });
  // On mobile, scroll the active hour into view.
  if (stripContainer && buttons[hour]) {
    buttons[hour].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

export function updateReadout(hour, minute) {
  const h = document.getElementById("readout-hour");
  const m = document.getElementById("readout-minute");
  if (h) h.textContent = hourLabel(hour);
  if (m) m.textContent = String(minute).padStart(2, "0");
}
