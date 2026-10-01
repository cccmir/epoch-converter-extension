# Epoch & Unix Timestamp Converter

A Chrome extension for converting Unix/epoch timestamps to human-readable dates and back — in a toolbar popup, by hovering over timestamps on any webpage, and in a dedicated Chrome DevTools panel for inspecting API responses.

## Features

- **Toolbar popup**
  - Live-updating current Unix timestamp.
  - Timestamp → Human date, with auto-detected unit (seconds / milliseconds / microseconds / nanoseconds), Local, UTC, ISO 8601, and relative time ("in 3 months").
  - Human date → Timestamp, with a timezone picker (Local, UTC, any pinned zone, or an ad-hoc search).
  - Pinned Timezones: pin up to 3 timezones (quick-pick chips for common cities, or search any of the ~400 IANA zones). Pinned zones appear automatically everywhere a timestamp is shown, labeled with their live, DST-correct UTC offset.
- **On-page hover**
  - Hover over any 10-digit (seconds) or 13-digit (millisecond) number on any webpage to see a tooltip with the converted date — Local, UTC, pinned zones, and relative time.
  - Toggle on/off from the popup.
- **DevTools "Epoch" panel**
  - A custom panel (next to Elements/Console/Network/etc.) since Chrome doesn't let extensions inject into the native Network panel.
  - Captures network responses while DevTools is open, in a sortable table (Name/Method/Status/Type/Size/Time).
  - Per-request detail view with Headers (collapsible sections), a formatted/collapsible JSON Preview, raw Response, Payload (query params + request body), and Timing — all with hover-to-convert on every timestamp found.
  - A resizable, hideable detail pane; a "Preserve log" toggle like the real Network tab; a "Paste text" tab for pasting in JSON/logs from anywhere (e.g. the Console).

## Installing (unpacked, for development/testing)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Reload the extension here any time you change the code. **Tabs that were already open need to be refreshed** — Chrome doesn't re-inject the content script into existing tabs on reload.

## Project structure

```
manifest.json      Extension manifest (MV3)
popup.html/.css/.js    Toolbar popup: converters + pinned timezone settings
content.js          On-page hover detection + tooltip (injected into all pages)
devtools.html/.js   Registers the "Epoch" DevTools panel
panel.html/.css/.js DevTools panel: network capture, detail tabs, paste tool
icon16/48/128.png   Toolbar/store icons
```

## Permissions

- `storage` — remembers whether hover is enabled and which timezones are pinned (via `chrome.storage.sync`, scoped to your Chrome profile).
- Content script on `<all_urls>` — needed so hover-to-convert works on any page, not just a fixed list of sites.
- `devtools_page` — registers the Epoch DevTools panel.

No permission is used to read, store, or transmit anything beyond the two settings above. The extension makes no network requests of its own; nothing it detects on a page or captures in DevTools is sent anywhere.

## Known limitations

- The DevTools panel only captures traffic while DevTools is open on that tab (the same limitation the native Network panel has).
- Hover detection is heuristic: any standalone 10-digit number in roughly the 2001–2100 range (or 13-digit for milliseconds) is treated as a timestamp, which can occasionally false-positive on things like phone numbers or IDs that happen to fall in that range.
- It isn't a pixel-for-pixel clone of Chrome's Network tab — no waterfall chart, WebSocket frame inspection, or request blocking/throttling.

## Development notes

The zoned-time conversion (used for pinned/custom timezones in the Date → Timestamp converter) uses `Intl.DateTimeFormat` to read a zone's actual offset and converges on it iteratively — no timezone database or external library required. It's been checked against fixed-offset zones (Tokyo), DST transitions (New York summer/winter), and half-hour offsets (India).
