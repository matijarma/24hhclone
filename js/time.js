export const MIN_PER_DAY = 24 * 60;

export function currentMinuteOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

export function currentSecondsInMinute(date = new Date()) {
  return date.getSeconds();
}

export function splitHM(minuteOfDay) {
  const m = ((minuteOfDay % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return { hour: Math.floor(m / 60), minute: m % 60 };
}

export function formatTime(minuteOfDay) {
  const { hour, minute } = splitHM(minuteOfDay);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function hourLabel(hour) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${h12} ${suffix}`;
}

export function parseDeepLink(search = window.location.search) {
  const params = new URLSearchParams(search);
  const t = params.get("t");
  if (t) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
    if (m) {
      const h = clamp(parseInt(m[1], 10), 0, 23);
      const min = clamp(parseInt(m[2], 10), 0, 59);
      const sec = m[3] ? clamp(parseInt(m[3], 10), 0, 59) : 0;
      if (h !== null && min !== null) {
        return { minuteOfDay: h * 60 + min, secondsInMinute: sec, source: "t" };
      }
    }
  }
  const hourParam = params.get("hour");
  if (hourParam !== null) {
    const h = clamp(parseInt(hourParam, 10), 0, 23);
    if (h !== null) return { minuteOfDay: h * 60, secondsInMinute: 0, source: "hour" };
  }
  return null;
}

export function writeDeepLink(minuteOfDay) {
  const url = new URL(window.location.href);
  url.searchParams.delete("hour");
  if (minuteOfDay === null || minuteOfDay === undefined) {
    url.searchParams.delete("t");
  } else {
    const { hour, minute } = splitHM(minuteOfDay);
    url.searchParams.set("t", `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  history.replaceState(null, "", url.toString());
}

export function clearDeepLink() {
  writeDeepLink(null);
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return null;
  if (n < lo || n > hi) return null;
  return n;
}
