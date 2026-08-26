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
- **Has a visualizer** — a MilkDrop-style feedback visual that reacts to the
  station you are actually listening to. It runs in its own deck, or as the
  page's background, or filling the screen. See [The visualizer](#the-visualizer).
- **Casts to a television** — the CAST key under the machine hands a Chromecast
  the address of the station on the dial, with `play=auto` on the end. The TV
  loads its own 5RADIO and tunes itself. See [Casting](#casting-to-a-television).
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

### Casting to a television

The row under the boombox is a second, shallower chassis — same case, same
keys — with three controls: **CAST**, **VISUAL** and **MIRROR**.

CAST is the `play=auto` link with a device picker in front of it. Pressing it
raises Chrome's own Chromecast list; picking a television hands that television
`https://<your 5radio>/#s=<the station on the dial>&play=auto`, and the TV
loads it, tunes that station and plays it. The readout under the key says which
station is about to be sent, and changes as you press NEXT.

**The television runs its own copy.** It is not mirroring this tab and not
relaying audio through this computer — the TV holds its own connection to the
broadcaster. So the laptop can be closed, or the tab shut, and the music keeps
playing. Stopping it is the same key, which reads STOP while a cast is live.

This is the [Presentation API][pres] — `new PresentationRequest([url]).start()` —
which is the one kind of casting a web page is allowed to start for itself. It
comes with rules the panel enforces and explains rather than failing quietly:

| Rule | Why |
|---|---|
| Chrome, Edge, or another Chromium browser | Firefox and Safari have no Presentation API |
| **https**, and not `localhost` | the address goes to a *different machine* — a TV cannot reach your laptop's localhost, and Chrome will not hand a television a plain http page |
| not `file://` | that is not an address at all |

Deployed, none of that needs configuring: the cast address defaults to the
page's own origin, so on 5radio.org the key simply works. (Developing on
`localhost:5173` there is nothing a television can reach; `RADIO_CAST.setBase(
'https://5radio.org/')` from the console aims it at the deployed copy, which is
what the removed ADDRESS key used to do through a dialog.)

**VISUAL**, on by default, decides what the television actually shows. With it
on the address carries `view=visual` as well, and the TV opens straight into
the full-page visualizer with the page furniture faded out — a screen across
the room is something to look at, and a column of filter controls is not what
anyone casts a radio for. Turn it off and the TV gets the boombox instead.

Two things the panel will tell you about rather than let you discover:

- **No station on the dial** casts `?play=auto` on its own, which is SCAN — the
  television picks one and starts.
- **A station tuned from LIVE SEARCH** is not in `data/stations.js`, and the TV
  is loading its own copy with its own catalog, so it cannot look that id up.
  It scans instead. The readout says so before you press anything.

**MIRROR** explains the other kind of casting, the one no page may start. Chrome's
*Cast tab* throws this exact tab — this audio, these meters — at the television,
and there is deliberately no API for it: a page that could start screen-sharing
itself would be a gift to every bad advert on the web. So the dialog says where
Chrome and Edge keep it instead of pretending to offer it.

`js/cast.js` is a port of 5OS's `js/core/cast.js` with the OS around it taken
away and one thing added — the address carries the station. Its diagnostics are
the original's, in the original's order: every reason casting cannot work right
now, each one saying what to do about it, because "casting unavailable" helps
nobody.

[pres]: https://www.w3.org/TR/presentation-api/

---

### The visualizer

A third chassis under the cast deck. **START** runs it; `‹` and `›` step
through ten presets, **CYCLING** stops the 16-second clock, **BACKDROP** moves
the picture behind the whole page, and **FULL** fills the screen.

It is a port of 5OS's `js/apps/visualizer-milk.js`, itself an homage to Ryan
Geiss's MilkDrop built from first principles. No MilkDrop code and no `.milk`
presets are used; the technique is the well-known one — keep the previous frame,
draw it back through a distorted UV mapping, add this instant's waveform, repeat
— and the audio steers the warp. Nothing on screen is simulated. The tunnels and
smoke are one frame being resampled into the next a few thousand times.

**It does not bring three.js with it.** 5RADIO has no dependencies and no build
step, and keeping that cost nothing: the engine only ever asked three.js for an
orthographic camera, a quad, two render targets, two shader materials and a line
strip, which is a plain WebGL program with two framebuffers. The shaders came
across nearly verbatim — GLSL is GLSL — and the presets came across exactly.
`js/milkdrop.js` is written in GLSL ES 1.00 with no `#version`, which both
WebGL1 and WebGL2 accept.

#### It hears the actual station

This is the part that was supposed to be impossible. Both this README and 5OS's
said the same thing: reading a station's levels needs an `AnalyserNode`, that
needs `crossOrigin="anonymous"`, and almost no station sends the CORS headers
that then become mandatory — which is why the VU meters are a knowing fake and
why 5OS deliberately left 5RADIO off its audio bus.

That stopped being true. `tools/probe-cors.mjs` measures it: of the stations in
the catalog that answer at all, **~90% send an `Access-Control-Allow-Origin`
that admits us**, most of them `*`. Radio moved onto CDNs, and CDNs send CORS
headers. Confirmed in a browser rather than just in curl — eight stations spread
across the catalog, eight with real spectra.

So the readout says **REACTING** when it is watching the real stream and
**PATTERN** when it is not, and the BPM next to it is measured.

**PATTERN has three different causes and says which**, because the first
version did not and that was a bug worth remembering. A probe element is
refused autoplay by exactly the same policy the radio is, so on a page nobody
has touched yet `probe.play()` throws `NotAllowedError` — and reporting that
as "this station will not allow its audio to be read" blamed the broadcaster
for the browser, then never recovered when Play was finally pressed. The
verdict now comes from whether the *bytes* arrive (`loadeddata` means CORS was
satisfied), never from whether playback began, and `real` is derived every
frame rather than latched once — so it corrects itself the moment the music
starts. The three sentences are "Press PLAY and the picture will follow the
music", "Listening for the stream…", and the genuine refusal. Beat detection
is 5OS's, including the one hard-won piece: onsets come from **spectral flux**,
not energy over a running average. Broadcast audio is compressed flat, so the
kick arrives as a rising edge on a high plateau rather than a spike out of
quiet, and an energy detector never fires at all. On a live trance station it
locks 128 BPM at 0.69 confidence within four seconds.

#### Why there are two audio elements

The obvious design routes the radio's own `<audio>` through the analyser. It
was built that way first, and it is a trap with teeth:
`createMediaElementSource()` binds an element to the graph **permanently**, and
a source node whose media is not CORS-clean outputs *silence* by specification.

So the moment that graph exists, the ~10% of stations that refuse CORS play
silently. Measured on WFMU: the element reported `playing`, `currentTime`
advanced past a minute, and the waveform was flat 128 — digital silence — while
the display read PLAY. A radio that lies about playing is far worse than a
visual that does not react.

The radio's element is therefore never touched. A second element, held at zero
gain, fetches the same stream purely to be looked at, and it is the only thing
wired into the graph. A station that refuses CORS fails *there*, inertly, and
the picture falls back to a synthesised drive labelled PATTERN — the radio never
notices. The price is the stream being fetched twice while the visual is on
(~16 KB/s for a 128k station) and the two connections sitting slightly apart on
the live edge, which a feedback smear does not notice the way a scope would.

(A station that refuses logs a CORS error in the console. That is the browser
narrating, not a fault: the failure is caught and handled.)

#### Three homes, one canvas

The picture can be in the deck, behind the page, or filling the screen. Building
an engine per home would mean three GL contexts and three copies of the feedback
history — and the history *is* the picture, so every move would flash black.
Instead there is one canvas moved between three parents; the feedback buffer
never learns it went anywhere.

In BACKDROP the neon grid stays where it is and the visual is **screened onto
it** rather than laid over it. Screen keeps whichever of the two is brighter,
and a MilkDrop frame is mostly black with bright traces through it — so the
black is where the horizon still shows through, and the traces glow over the
top. (The grid is repeated onto the backdrop element rather than left on
<body>, because a background on <body> is propagated to the viewport canvas,
which sits outside every stacking context and is not something a blend mode can
blend against.) A scrim still goes over both, so text stays readable when a
preset turns bright.

**FULL** uses the Fullscreen API on the stage alone. A page can be refused it by
permissions policy, in which case it says so — BACKDROP plus the browser's own
F11 is the route that always works.

`view=visual` in a link — what the CAST key sends a television — opens straight
into the full-page picture with the furniture faded out. On a TV nothing ever
moves a mouse, so it stays that way; on a laptop any mouse movement brings the
page back for a few seconds and Esc leaves cinema for good, because a bare
canvas with no visible way back reads as a fault rather than a feature.

Cost control: WebGL at full viewport is the most expensive thing this page does,
so the internal render scale drops to 0.65 above ~1.6 Mpx and 0.5 above ~3.5
Mpx. This mode is fill-rate bound, so resolution is worth far more than
anything else.

---

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
js/cast.js            the CAST row — hands a television the play=auto link
js/audio.js           the analyser + beat detector, on a second silent element
js/milkdrop.js        the MilkDrop-style engine, raw WebGL, no three.js
js/visualizer.js      the visualizer deck, backdrop, fullscreen and cinema
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
node tools/probe-cors.mjs 60    # what share of streams a visualizer could read
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
- **The VU meters are still decorative**, even though the visualizer proves the
  levels can now be had for real. Making them honest would mean the boombox
  running the second audio element all the time rather than only when the
  visual is on, and a station that refuses CORS would leave the needles dead
  instead of dancing. Left as they are, deliberately — but the reason below is
  now only half true, and `tools/probe-cors.mjs` says how half.
- **The old reason.** Reading real audio levels needs an
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
