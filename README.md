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
- **Or opens playing** — add `play=auto` and the link starts the stream by
  itself, for casting to a speaker or a screen that nobody is going to walk
  over and press PLAY on. See [Link options](#link-options).
- **Remembers where you left it** — close the tab and come back and the same
  station is on the dial, at the same volume, with the same genre, region,
  search and sort still set. It is cued rather than playing, because a
  browser will not start audio without a gesture and a tab that makes noise
  on its own is a bad neighbour: press Play.

Keyboard: <kbd>Space</kbd> play/pause · <kbd>R</kbd> random · <kbd>←</kbd>
<kbd>→</kbd> previous/next · <kbd>S</kbd> stop.

---

## Link options

A link can name a station and say what to do with it.

| | |
|---|---|
| `#s=<id>` | open cued to that station |
| `play=auto` | and start it playing |

```
https://5radio.org/#s=09902861-999f-4a6e-915b-3692401aee84?play=auto
https://5radio.org/#s=09902861-999f-4a6e-915b-3692401aee84&play=auto
https://5radio.org/?play=auto#s=09902861-999f-4a6e-915b-3692401aee84
```

All three are the same link. `play=auto` is read from the query string or from
the hash, joined with either `?` or `&` — `?` inside the fragment is not what
the URL spec had in mind, but it is what a person types when appending an
option to a link they were handed, and a link that has to survive a cast dialog
is no place to be pedantic. `1`, `true`, `yes`, `on` and a bare `play` work
as well; anything else (`play=no`) is ignored and the station stays cued.

**`play=auto` on its own, naming no station, hits SCAN** — a random station
from whatever the filters allow, rolling past dead streams the way SCAN always
does. `?genre=…`-style filters are not a thing; the filters come from the
saved session on the device that opens the link.

Once tuned, the flag is written back into the address bar alongside the
station, so a receiver that reloads the page comes back playing rather than
sitting on PRESS PLAY.

### When the browser says no

Autoplay is a permission, not a setting. A cast receiver or a kiosk browser
generally grants it — that is the case this flag exists for — but an ordinary
browser refuses audio on a page nobody has touched yet, and hands back a
`NotAllowedError`.

The request is not thrown away when that happens. The display says **AUTOPLAY
BLOCKED — TAP ANYWHERE TO START**, the station stays on the dial, and the first
tap or keypress anywhere on the page starts it. A gesture that lands on a
control instead — PLAY, SCAN, a station in the rack — is left to that control,
so pressing PLAY plays rather than toggling twice and stopping.

A refusal is also not counted against SCAN: the browser turning down a gesture
says nothing about the stream, and the next station would be refused in exactly
the same way, so SCAN holds still instead of burning through four stations.

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
js/osbridge.js        lets 5OS's on-screen keyboard type into this page
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

### Typing when 5OS frames this page

`js/osbridge.js` is what makes 5OS's on-screen keyboard work here. 5OS cannot
put a keystroke into another origin's frame — that is a security boundary, not a
gap — so it posts the key as a message and the framed page dispatches it itself.

The snippet in the 5OS README is not enough on its own, for a reason worth
writing down: **a synthetic `KeyboardEvent` is untrusted, and an untrusted key
event performs no default action.** Dispatching the event is enough for
5RADIO's own shortcuts, which only read `e.key` — but nothing appears in the
SEARCH box, the REGION dial does not move and the VOL fader does not slide,
because those are default actions the browser declines to perform for a fake
event.

So the bridge does what 5OS itself does when a frame happens to be same-origin
(`js/apps/keyboard.js`): dispatch the real event first, so shortcuts and
`preventDefault` behave exactly as from a physical keyboard, then — only if
nobody claimed the key — carry out the default action by hand. The text editing
is a port of 5OS's own `edit()`, so a key behaves identically either way.

Which means, from the on-screen keyboard:

| Focus | What a key does |
|---|---|
| SEARCH box | types, with Backspace, Delete, arrows, Home/End — and the filter re-runs, because the `input` event is fired too |
| GENRE / REGION / SORT | arrows move through the options, and a letter jumps to it ("j" → Jazz) |
| VOL fader | arrows nudge, PageUp/PageDown jump, Home/End go to the ends |
| a transport key | Enter presses it |
| nothing in particular | the normal shortcuts — Space, R, S, ← → |

The one rule that keeps those from colliding: a letter typed with the SEARCH box
focused types a letter, it does not also trigger the shortcut. 5RADIO's own key
handler already ignored text fields; the bridge simply respects `preventDefault`
for everything else.

Only `5os-key` is handled, because that is the only message kind 5OS actually
posts, and only from `window.parent` — the embedder drives the keyboard, nobody
else. Starting playback this way worked in testing; if a browser's autoplay
policy ever refuses a stream started without a real tap, the display says so and
one press of PLAY fixes it.

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

- **The machine moves when the audio does.** The cones, woofers, reels,
  antenna, STEREO flicker and VU meters all hang off one class, and that class
  means exactly one thing: the `<audio>` element is engaged and holding data
  (`readyState >= 3`). It used to mean "a `playing` event arrived", which is a
  narrower claim — it left the boombox still through the tuning gap and every
  rebuffer, and any path that never fired that one event left it still for
  good. Asking the element directly needs nothing armed and has no event to
  miss: a stall stops the machine, the recovery starts it again, and the frame
  loop promotes the display to PLAY if the event was late or never came. Brief
  `readyState` dips are coasted through for 600ms so a hiccup doesn't read as
  a fault; letting go of the transport — pause, STOP, a dead stream — stops
  everything at once.
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
