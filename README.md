# 5RADIO

An internet radio station finder shaped like a 1984 boombox. Filter 2,884
verified stations by genre and region, or hit **SCAN** and let the machine pick
one for you. Stations play in the page.

Open `index.html`. That's the whole install — no build step, no dependencies,
no server required.

---

## What it does

- **SCAN** — a random station from whatever the dials currently allow. If the
  stream turns out to be dead it rolls on to another, up to four times.
- **Genre** — 21 buckets derived from the stations' own tags.
- **Region** — five US regions plus Canada, UK & Ireland, Europe, Latin America,
  Asia & Pacific, and Africa & Middle East.
- **Search** — matches name, city, country, genre and tags.
- **Plays in the page** — real `<audio>` playback, with a tuning state, a signal
  lost state, and a link to the broadcaster when a stream won't open.
- **Every station links out** — the `↗` button opens the station's own site, so
  even an unplayable stream is still a usable suggestion.
- **Shareable** — tuning a station puts it in the URL (`#s=<id>`). Send that
  link and it opens cued to that station.
- **Remembers where you left it** — close the tab and come back and the same
  station is on the dial, at the same volume, with the same genre, region,
  search and sort still set. It is cued rather than playing, because a
  browser will not start audio without a gesture and a tab that makes noise
  on its own is a bad neighbour: press Play.

Keyboard: <kbd>Space</kbd> play/pause · <kbd>R</kbd> random · <kbd>←</kbd>
<kbd>→</kbd> previous/next · <kbd>S</kbd> stop.

---

## Where the stations come from

Wikipedia's [List of Internet radio stations][wiki] names the stations but
carries no stream addresses, so it can't be played from directly. The catalog is
built from [Radio Browser][rb] — the open, community-maintained database of
internet radio streams — and *seeded* with the names from that Wikipedia list, so
the stations the article calls out (SomaFM, KEXP, WFMU, WNYC, KCRW, Radio
Paradise, FIP, RTÉ, Triple J …) are all present.

Every station in `data/stations.json` has been filtered down hard:

| Rule | Why |
|---|---|
| HTTPS only | an `http://` stream is blocked as mixed content on an `https://` page |
| No HLS (`.m3u8`) | would need a streaming library; this site has no dependencies |
| Passed Radio Browser's own liveness check | skips streams already known to be down |
| Probed directly, hard failures dropped | 207 removed: dead hosts, 404s, expired certs, timeouts |
| One row per station | quality variants ("… 128k MP3" / "… 320k MP3") collapse onto one dial position |

A random sample of 70 streams answered with live audio **60 times (86%)**. The
rest were mostly hosts that refuse an unfamiliar client but play fine in a
browser, which is why the page has a "signal lost" state and an outbound link
rather than pretending every stream always works.

**LIVE SEARCH** (the switch under the filters) queries Radio Browser directly
instead of the built-in snapshot — the full database, current as of this second,
at the cost of needing a connection. It falls back to the snapshot automatically
if the API can't be reached.

[wiki]: https://en.wikipedia.org/wiki/List_of_Internet_radio_stations
[rb]: https://www.radio-browser.info/

---

## Layout

```
index.html            the page
css/boombox.css       the machine — pure CSS, no images
css/layout.css        page, filter panel, station rack
js/taxonomy.js        genre + region classifier, shared by the page and the tools
js/save.js            the session — what is on the dial, kept in localStorage
js/app.js             filtering, tuning, playback, live search
data/stations.js      the catalog as a <script>  ← what the page loads
data/stations.json    the same catalog as JSON   ← what the tools read
tools/                catalog pipeline (Node 18+)
```

`data/stations.js` exists because a page opened from `file://` cannot `fetch()`
a sibling JSON file — the browser treats it as cross-origin — but it can always
load a `<script>`. That one duplicated file is what makes double-clicking
`index.html` work.

### The taxonomy is shared on purpose

`js/taxonomy.js` loads two ways: as a plain `<script>` in the browser, and via
`require()` in the Node tools. Both the offline snapshot and the live search
label stations through the same code, so a station can't be Jazz offline and
Electronic online. `tools/check-taxonomy.mjs` enforces it.

The classifier only ever reads fields that are actually stored in the row (the
trimmed name and the first six tags). Labelling from anything richer would
produce a genre nothing in the file could explain — which is exactly the bug the
check caught during development.

---

### The session is a port, not a fresh idea

`js/save.js` is 5Space's `js/save.js` in a smaller key: one versioned JSON blob
in `localStorage` under `5radio.session.v1`, fields listed by hand rather than
copied wholesale, every storage touch inside a `try`, and a version guard that
ignores a blob it does not recognise instead of half restoring it. The same
names too — `serialize`, `deserialize`, `hasSave`, `deleteSave`, `saveInfo`.
Keeping the shape means a lesson learned in one of these projects carries to
the others.

It saves the moment anything changes, and on three other triggers, because no
one of them is reliable on its own: a twenty-second heartbeat for the tab left
open all afternoon, `beforeunload` for the ordinary close, and
`visibilitychange` for the phone that is switched away from and killed in the
background, where `beforeunload` never arrives.

The station is stored **whole**, not as an id. A station tuned from the live
search does not exist in `data/stations.js` at all, so an id alone would
restore to nothing — and the catalog is rebuilt from a live database, so a
station can vanish out from under a saved id. Sixteen fields is a rounding
error next to a 2,884 station catalog.

A `#s=` link beats the saved session: someone opening a shared link wants that
station, not the one they left.

## Rebuilding the catalog

Needs Node 18+ (for global `fetch`). Nothing to install.

```bash
node tools/build-catalog.mjs    # sweep Radio Browser        (~4 min)
node tools/prune-dead.mjs       # probe every stream, drop dead ones (~12 min)
node tools/check-taxonomy.mjs   # assert labels are reproducible     (instant)
```

Two shortcuts for everyday work:

```bash
node tools/relabel.mjs          # re-apply taxonomy.js locally, no network
node tools/audit-streams.mjs 70 # spot-check N random streams
```

After changing a rule in `js/taxonomy.js`, run `relabel` then `check-taxonomy` —
a rule tweak costs a second instead of a sixteen-minute rebuild.

---

## Notes

- **The VU meters are decorative.** Reading real audio levels needs an
  `AnalyserNode`, which needs `crossOrigin="anonymous"` on the `<audio>`
  element, and almost no station sends the CORS headers that would then require.
  Switching it on would silence most of the catalog, so the needles dance for
  the look of the thing and the streams stay playable.
- **The frequency readout is invented.** Internet stations have no frequency, so
  each one is hashed to a fixed spot on the dial — the same station always lands
  in the same place.
- Respects `prefers-reduced-motion`: the reels, cones, antenna and marquee all
  hold still.
- Streams belong to the broadcasters and play straight from their servers.
  Nothing is proxied, cached, or re-hosted here.
