# 24 Hours of Happy

An unofficial recreation of **24hoursofhappy.com** that syncs **Pharrell Williams - Happy (24 Hours of Happy)** to your local clock.

## Live URL

https://24hh.matijar.info

## Highlights

- Local-time synced playback across 24 hourly videos
- Circular 24-hour scrubber with keyboard support
- Persistent `24h` / `AM/PM` readout preference
- Fullscreen `Clock Widget` mode (analog + digital 12-hour clock)
- PWA install support with conditional in-app `Install` button
- Fan video customizer (`24 x 15` slot painter with local persistence + original fallback)
- Background fan-video health checks (Cloudflare Worker + YouTube Data API v3, cached 24h)

## Run Locally

Use a local HTTP server (opening `index.html` from `file://` can block JSON fetches):

```bash
python -m http.server 8765
```

Then open:

```text
http://localhost:8765/
```

## Controls

### Normal Mode

- `Drag` the ring thumb: scrub time
- `Arrow keys`: minute steps (`Shift` + arrows = 15-minute steps)
- `PageUp` / `PageDown`: +/- 1 hour
- `Home` / `End`: start/end of day
- `Space`: play/pause
- `N`: resync to current local time
- Click center clock readout: resync to current local time
- `H`: toggle overlay hide/show
- `M`: mute/unmute
- `Mute` / `Unmute` button: toggle audio
- Controls order/groups: `Mute` `Shuffle` `Customize` `Play/Pause` - `Show/Hide` `Clock Widget` `24h/AMPM` - `Info`
- `24h` / `AM/PM` button: switch readout format (saved in localStorage)
- `Customize` button: open 24-hour slot editor, pick fan videos by country/city, and paint slots
- `Install` button: shown only when PWA install is available and app is not already installed
- `Clock Widget` button: enter fullscreen clock mode

### Clock Widget Mode

- Fullscreen overlay clock (analog face with `12 / 3 / 6 / 9` + digital `h:mm AM/PM`)
- Slider/seek interactions are disabled
- Single tap/click anywhere: mute/unmute
- Double-tap/double-click anywhere: exit clock mode

## PWA

PWA support is enabled through:

- `manifest.webmanifest`
- `sw.js` app-shell caching service worker
- App icons (`icons/icon-192.png`, `icons/icon-512.png`)

Install can be triggered from browser UI, and from the in-app `Install` button when supported.

## Cloudflare Worker Health Check

The app triggers a background request on page open to:

```text
/api/youtube-health
```

That Worker endpoint:

- reads `wearehappyfrom.com.json`
- checks each video via YouTube Data API v3 (`videos.list`, `part=status`)
- flags videos where:
  - `status.privacyStatus === "private"` or
  - `status.embeddable === false`
- caches the check result for `24h` in the Worker cache

Set the API key as a Worker secret:

```bash
wrangler secret put YOUTUBE_API_KEY
```

Then deploy:

```bash
wrangler deploy
```

## Deep Links

- `?t=HH:MM` (optional seconds: `?t=HH:MM:SS`)
  Example: `?t=13:45`
- `?hour=H` (legacy/fallback)
  Example: `?hour=9`

When you scrub and release, the URL is updated with `?t=...` for sharing.

## Project Structure

```text
index.html
manifest.webmanifest
sw.js
css/style.css
js/main.js
js/player.js
js/slider.js
js/time.js
js/hours.js
worker.js
icons/icon-192.png
icons/icon-512.png
per-hour-yt-urls.json
```

## Credits

- Music/video property belongs to Pharrell Williams, Back Lot Music, and rights holders.
- Videos are embedded via YouTube.
- This project is an unofficial recreation of the original 24hoursofhappy.com experience and is not affiliated with the rights holders.
- coded by matijarma: https://github.com/matijarma/24hhclone
