# 24 Hours of Happy 🎵🕒

A fan-made web app that syncs **Pharrell Williams - Happy (24 Hours of Happy)** to your local clock.
Spin the circular timeline, jump to any minute of the day, or lock back to "now" in one click.

## Highlights ✨

- Local-time synced playback (24 hourly videos)
- Circular 24-hour scrubber with keyboard support
- Quick deep-linking via URL query params
- Clean overlay toggle (`Hide` / `Show`) on the same button

## Run Locally 🚀

Use a local HTTP server (opening `index.html` directly from `file://` can block JSON fetches in some browsers):

```bash
python -m http.server 8765
```

Then open:

```text
http://localhost:8765/
```

## Controls 🎛️

- `Drag` the ring thumb: scrub time
- `Arrow keys`: minute steps (`Shift` + arrows = 15-minute steps)
- `PageUp` / `PageDown`: +/- 1 hour
- `Home` / `End`: start/end of day
- `Space`: play/pause
- `N`: resync to current local time
- `H`: toggle overlay hide/show
- `Now` button: resync to current local time
- `Hide/Show` button: toggle UI overlay visibility

## Deep Links 🔗

- `?t=HH:MM` (optional seconds: `?t=HH:MM:SS`)  
  Example: `?t=13:45`
- `?hour=H` (legacy/fallback)  
  Example: `?hour=9`

When you scrub and release, the URL is updated with `?t=...` for easy sharing.

## Project Structure 📁

```text
index.html
css/style.css
js/main.js
js/player.js
js/slider.js
js/time.js
js/hours.js
per-hour-yt-urls.json
```

## Credits 🙌

- Music/video property belongs to Pharrell Williams, Back Lot Music, and rights holders.
- Videos are embedded via YouTube.
- This project is a fan tribute and not an official release.
