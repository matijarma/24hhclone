import { hourLabel } from "./time.js";

const VID_RE = /[?&]v=([A-Za-z0-9_-]{11})/;

function extractVideoId(url) {
  const m = VID_RE.exec(url);
  if (!m) throw new Error(`Could not parse videoId from URL: ${url}`);
  return m[1];
}

export async function loadHours() {
  const res = await fetch("per-hour-yt-urls.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load per-hour-yt-urls.json: ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length !== 24) {
    throw new Error(`Expected 24 entries in per-hour-yt-urls.json, got ${raw && raw.length}`);
  }
  return raw.map((entry, hour) => ({
    hour,
    videoId: extractVideoId(entry.url),
    title: entry.title || hourLabel(hour),
  }));
}
