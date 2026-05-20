export function currentHour(date = new Date()) {
  return date.getHours();
}

export function currentMinuteSeconds(date = new Date()) {
  return date.getMinutes() * 60 + date.getSeconds();
}

export function hourLabel(hour) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${h12} ${suffix}`;
}

export function shortHourLabel(hour) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return String(h12);
}

export function parseDeepLink(search = window.location.search) {
  const params = new URLSearchParams(search);
  const t = params.get("t");
  if (t) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
    if (m) {
      const h = clampHour(parseInt(m[1], 10));
      const min = clamp(parseInt(m[2], 10), 0, 59);
      const sec = m[3] ? clamp(parseInt(m[3], 10), 0, 59) : 0;
      if (h !== null) return { hour: h, seekSeconds: min * 60 + sec, source: "t" };
    }
  }
  const hourParam = params.get("hour");
  if (hourParam !== null) {
    const h = clampHour(parseInt(hourParam, 10));
    if (h !== null) return { hour: h, seekSeconds: 0, source: "hour" };
  }
  return null;
}

export function writeDeepLink({ hour, seekSeconds } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.delete("t");
  url.searchParams.delete("hour");
  if (hour !== undefined && hour !== null) {
    url.searchParams.set("hour", String(hour));
  }
  history.replaceState(null, "", url.toString());
}

export function clearDeepLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete("t");
  url.searchParams.delete("hour");
  history.replaceState(null, "", url.toString());
}

function clampHour(n) {
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 23) return null;
  return n;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
