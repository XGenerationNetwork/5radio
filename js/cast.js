/* ============================================================================
   5RADIO — casting the radio to a television
   ----------------------------------------------------------------------------
   A port of 5OS's `js/core/cast.js`, with the OS around it taken away and one
   thing added: the address handed to the television carries the station.

   Worth being straight about what a web page can and cannot do here, because
   "cast this" means two different things and only one of them is ours to
   trigger.

   What we can do is the **Presentation API**: `new PresentationRequest([url])`
   then `.start()` raises Chrome's own device picker, and the Chromecast loads
   that URL itself. Because 5RADIO now understands `play=auto`, the address we
   hand over is not the front page but the station on the dial, already asking
   to be played — so the television tunes itself and the sound comes out of the
   television. That is the whole feature.

   The receiver runs its *own copy*. This tab is not mirrored and not relaying:
   the TV holds its own connection to the broadcaster, so closing this tab, or
   shutting the laptop, leaves the music playing.

   What we cannot do is tab mirroring. Chrome's "Cast tab" throws this exact
   session, audio and all, at the TV — and there is no API for it by design,
   since a page that could start screen-sharing itself would be a gift to every
   malicious ad on the web. So the MIRROR key explains where that lives rather
   than pretending to offer it.

   The cast address is therefore configurable: someone developing on
   localhost:5173 can still point the television at their deployed 5RADIO.
   ========================================================================== */

(function () {
  'use strict';

  var cast = {};
  window.RADIO_CAST = cast;

  /* A device setting, not part of the session: which television address this
     computer uses is a property of this computer, and it should survive a
     session that is cleared or a version that is retired. */
  var ADDR_KEY = '5radio.cast.url';

  /* Material's cast glyph. Nothing in the emoji set reads as "cast", and this
     is the one icon every television-adjacent UI already uses. */
  var GLYPH =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path fill="currentColor" d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7z' +
    'm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5' +
    'c0-1.1-.9-2-2-2z"/></svg>';

  /* Tab mirroring lives in the browser's own menus and nowhere else, so these
     steps are the whole of that feature. */
  var MIRROR = [
    {
      name: 'Chrome',
      steps: [
        'Open the <b>⋮</b> menu, top right.',
        '<i>Cast, save and share</i> → <i>Cast…</i>  (older versions list <i>Cast…</i> directly).',
        'Pick your television.',
        'Under <i>Sources</i>, choose <b>Cast tab</b> to send this tab, or <b>Cast screen</b> for the whole desktop.'
      ]
    },
    {
      name: 'Edge',
      steps: ['Open the <b>⋯</b> menu → <i>More tools</i> → <i>Cast media to device</i>.']
    }
  ];
  cast.mirrorSteps = MIRROR;

  var $ = function (id) { return document.getElementById(id); };

  var el = {};

  /* ------------------------------------------------------------------ */
  /* the address                                                        */
  /* ------------------------------------------------------------------ */

  function stored() {
    try { return String(localStorage.getItem(ADDR_KEY) || '').trim(); }
    catch (e) { return ''; }
  }

  /* Casting means handing a television an address to load, so 5RADIO has to be
     *at* an address. Opened as a file it simply is not. */
  cast.served = function () {
    return location.protocol === 'http:' || location.protocol === 'https:';
  };

  cast.base = function () {
    var custom = stored();
    if (custom) return custom;
    if (location.protocol === 'file:') return '';
    return location.origin + location.pathname;
  };

  cast.setBase = function (url) {
    try {
      if (url) localStorage.setItem(ADDR_KEY, normalise(url));
      else localStorage.removeItem(ADDR_KEY);
    } catch (e) { /* a browser with no storage still casts, just not tomorrow */ }
    availabilityRequest = null;
    availability = null;
    watch();
    paint();
  };

  /* Whatever gets pasted in, what comes out is an address we can safely hang a
     fragment off. The fragment is stripped because ours goes there and two '#'
     in one URL is not a URL; a query someone typed is theirs, so it stays, and
     cast.target() joins onto it correctly. */
  function normalise(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
    try {
      var p = new URL(u);
      return p.origin + p.pathname + p.search;
    } catch (e) { return u; }
  }

  /* What the television is actually sent: the station on the dial, already
     asking to be played. No station on the dial means no station to name, and
     `play=auto` on its own is SCAN — the TV picks one and starts. */
  cast.target = function () {
    var base = cast.base();
    if (!base) return '';
    var s = station();
    if (!s) return base + (base.indexOf('?') === -1 ? '?' : '&') + 'play=auto';
    return base + '#s=' + encodeURIComponent(s.id) + '&play=auto';
  };

  function station() {
    try { return (window.RADIO_APP && window.RADIO_APP.current()) || null; }
    catch (e) { return null; }
  }

  /* A station tuned from LIVE SEARCH is not in `data/stations.js`, so the
     television — loading its own copy, with its own catalog — would look that
     id up and find nothing. It falls back to SCAN, which is a fine outcome but
     not the one the button appears to promise, so the panel says so instead of
     letting it be a surprise. */
  function inCatalog(s) {
    if (!s) return false;
    var all = (window.RADIO_CATALOG && window.RADIO_CATALOG.stations) || [];
    for (var i = 0; i < all.length; i++) if (all[i].id === s.id) return true;
    return false;
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return url; }
  }

  /* ------------------------------------------------------------------ */
  /* whether it could possibly work                                     */
  /* ------------------------------------------------------------------ */

  function supported() { return typeof window.PresentationRequest === 'function'; }

  /* Every reason this cannot work, in the order someone would hit them. Each
     says what to do about it, because "casting unavailable" helps nobody. */
  cast.diagnose = function () {
    if (!supported()) {
      return { ok: false, why: 'This browser has no Presentation API. Chrome, Edge or another ' +
                               'Chromium browser can cast; Firefox and Safari cannot.' };
    }
    var base = cast.base();
    if (!base) {
      return { ok: false, why: '5RADIO is open from a file on this computer, so a television has ' +
                               'no address to load. Set a cast address, or serve 5RADIO over https.' };
    }
    var parsed;
    try { parsed = new URL(base); } catch (e) {
      return { ok: false, why: 'That cast address is not a URL Chrome will accept.' };
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)) {
      return { ok: false, why: parsed.host + ' is only an address on this computer — a television ' +
                               'on your network cannot reach it. Set the address of a deployed 5RADIO.' };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, why: 'Chrome only hands a television an https address. ' +
                               parsed.origin + ' is not one.' };
    }
    return { ok: true, url: cast.target() };
  };

  /* ------------------------------------------------------------------ */
  /* the connection                                                     */
  /* ------------------------------------------------------------------ */

  var availabilityRequest = null;   /* stable, base address — "is a TV out there" */
  var availability = null;
  var connection = null;

  /* Availability is about whether a receiver exists on this network, not about
     which station is on the dial, so it watches the bare address and is not
     rebuilt every time someone presses NEXT. */
  function watch() {
    if (!supported()) { paint(); return; }
    var d = cast.diagnose();
    if (!d.ok) { paint(); return; }
    if (!availabilityRequest) {
      try { availabilityRequest = new PresentationRequest([cast.base()]); }
      catch (e) { availabilityRequest = null; }
    }
    if (!availabilityRequest || !availabilityRequest.getAvailability) { paint(); return; }

    availabilityRequest.getAvailability().then(function (a) {
      availability = a;
      a.addEventListener('change', paint);
      paint();
    }).catch(function () {
      /* Continuous monitoring is optional and Chrome is allowed to refuse.
         Refusing is not an error: the picker still works, we just cannot
         light the key up in advance. */
      paint();
    });
  }

  cast.available = function () { return !!(availability && availability.value); };
  cast.connected = function () { return !!connection; };

  function hold(conn) {
    connection = conn;
    conn.addEventListener('close', function () { drop(); });
    conn.addEventListener('terminate', function () { drop(); });
    paint();
  }

  function drop() {
    if (!connection) return;
    connection = null;
    paint();
  }

  /* Chrome raises the device picker only from inside a real click, so this
     runs synchronously in the handler — no awaiting anything first. */
  cast.start = function () {
    var d = cast.diagnose();
    if (!d.ok) { say(d.why, true); return; }

    var req;
    try { req = new PresentationRequest([d.url]); }
    catch (e) { say('Chrome refused that address.', true); return; }

    req.start().then(hold).catch(function (err) {
      var name = err && err.name;
      /* Closing the picker is a decision, not a failure. */
      if (name === 'NotAllowedError' || name === 'AbortError') { paint(); return; }
      if (name === 'NotFoundError') {
        say('Nothing on this network answered. Check the TV is on and on the same network.', true);
      } else if (name === 'InvalidAccessError') {
        say('Chrome opens the picker only from a real click. Press CAST again.', true);
      } else if (name === 'NotSupportedError') {
        say('This browser has the Presentation API but no cast back end. Desktop Chrome or Edge does.', true);
      } else {
        say((err && err.message) || String(err), true);
      }
    });
  };

  cast.stop = function () {
    if (!connection) return;
    try { connection.terminate(); }
    catch (e) { try { connection.close(); } catch (e2) { /* already gone */ } }
    drop();
  };

  /* ------------------------------------------------------------------ */
  /* the panel                                                          */
  /* ------------------------------------------------------------------ */

  /* A message that outranks the standing readout until something else
     happens — a refusal, a saved address. */
  var notice = null;
  var noticeBad = false;
  var noticeTimer = null;

  function say(text, bad) {
    notice = text;
    noticeBad = !!bad;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { notice = null; paint(); }, 9000);
    paint();
  }

  function paint() {
    if (!el.deck) return;

    var d = cast.diagnose();
    var s = station();
    var live = s && !inCatalog(s);

    el.deck.classList.toggle('is-casting', !!connection);
    el.deck.classList.toggle('is-ready', !connection && d.ok && cast.available());
    el.deck.classList.toggle('is-blocked', !d.ok);

    el.btn.disabled = !d.ok && !connection;
    el.lab.textContent = connection ? 'STOP' : 'CAST';
    el.btn.title = connection ? 'Stop casting to the television'
                 : d.ok ? 'Send this station to a television'
                 : 'Casting is not possible right now';

    if (notice) {
      line(notice, noticeBad ? 'warn' : '');
      el.sub.textContent = '';
      return;
    }

    if (connection) {
      line('CASTING TO A TELEVISION', 'good');
      el.sub.textContent = s
        ? s.name + ' is playing on the TV. This tab is not mirrored — you can close it.'
        : 'The TV is running its own copy of 5RADIO. This tab is not mirrored.';
      return;
    }

    if (!d.ok) {
      line('CASTING UNAVAILABLE', 'warn');
      el.sub.textContent = d.why;
      return;
    }

    line(cast.available() ? 'A TELEVISION IS READY' : 'CAST TO A TELEVISION',
         cast.available() ? 'good' : '');

    var what = s ? '“' + s.name + '”' : 'a station it picks itself';
    el.sub.textContent =
      (cast.available()
        ? 'Send ' + what + ' to the TV — it tunes itself and the sound comes out of the television. '
        : 'Press CAST to pick a television. It loads ' + hostOf(d.url) + ', tunes ' + what +
          ' and plays it. ') +
      (live ? 'This one came from LIVE SEARCH, so the TV cannot look it up — it will scan instead.'
            : 'Nothing here is mirrored or relayed; the TV plays it directly.');
  }

  function line(text, tone) {
    el.line.textContent = text;
    el.line.className = 'cast-line' + (tone ? ' ' + tone : '');
  }

  /* ------------------------------------------------------------------ */
  /* the two dialogs                                                    */
  /* ------------------------------------------------------------------ */

  function dialog(title, bodyNodes, buttons) {
    var dlg = document.createElement('dialog');
    dlg.className = 'cast-dialog';

    var h = document.createElement('h3');
    h.textContent = title;
    dlg.appendChild(h);

    var body = document.createElement('div');
    body.className = 'cast-dialog-body';
    bodyNodes.forEach(function (n) { body.appendChild(n); });
    dlg.appendChild(body);

    var row = document.createElement('div');
    row.className = 'cast-dialog-keys';
    buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill' + (b.primary ? ' pill-hot' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', function () {
        var keep = b.action && b.action();
        if (!keep) close();
      });
      row.appendChild(btn);
    });
    dlg.appendChild(row);

    function close() {
      try { dlg.close(); } catch (e) { /* never opened */ }
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
    }

    dlg.addEventListener('cancel', function () { close(); });
    document.body.appendChild(dlg);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    return { el: dlg, close: close };
  }

  function p(text) {
    var n = document.createElement('p');
    n.textContent = text;
    return n;
  }

  cast.address = function () {
    var here = location.protocol === 'file:' ? '' : location.origin + location.pathname;

    var input = document.createElement('input');
    input.type = 'url';
    input.className = 'cast-input';
    input.value = stored();
    input.placeholder = here || 'https://your-5radio-address/';
    input.setAttribute('aria-label', 'Cast address');

    var note = document.createElement('div');
    note.className = 'cast-dialog-note';
    note.innerHTML =
      '<p>The address the television loads. Leave it blank to cast wherever 5RADIO is open right now' +
      (here ? ' (<span class="mono">' + here.replace(/[&<>]/g, '') + '</span>)' : '') + '.</p>' +
      '<p>A television can only load an address it can reach, which rules out two of the usual ones:</p>' +
      '<ul><li><span class="mono">localhost</span> is this computer only — the TV is a different machine.</li>' +
      '<li><span class="mono">file://</span> is not an address at all.</li></ul>' +
      '<p>It has to be https as well; Chrome will not hand a television a plain http page. 5RADIO needs ' +
      'no server, so any static host will do — put that address here.</p>';

    var d = dialog('Cast address', [input, note], [
      { label: 'Cancel' },
      {
        label: 'Save', primary: true,
        action: function () {
          cast.setBase(input.value.trim());
          say(cast.base() ? 'Cast address saved: ' + hostOf(cast.base())
                          : 'Cast address cleared — using this page’s own address.');
        }
      }
    ]);
    setTimeout(function () { input.focus(); }, 0);
    return d;
  };

  /* No API starts tab mirroring, and that is deliberate on the browser's part,
     so the honest thing is to say where the browser keeps it. */
  cast.mirror = function () {
    var body = [
      p('CAST opens a fresh 5RADIO on the television and lets it play by itself — the TV holds its ' +
        'own connection to the broadcaster, so you can close this tab and the music keeps going.'),
      p('If you want this tab instead — this audio, these meters moving — that is tab mirroring, and ' +
        'only the browser itself can start it. No page is allowed to, which is the point: a page that ' +
        'could share your screen without asking would be a gift to every bad advert on the web.')
    ];

    MIRROR.forEach(function (b) {
      var h = document.createElement('h4');
      h.textContent = b.name;
      body.push(h);
      var ol = document.createElement('ol');
      b.steps.forEach(function (s) {
        var li = document.createElement('li');
        li.innerHTML = s;
        ol.appendChild(li);
      });
      body.push(ol);
    });

    var tip = document.createElement('div');
    tip.className = 'cast-dialog-note';
    tip.textContent = 'Mirroring sends this tab, so the television gets the boombox itself, ' +
                      'meters and all. Press F11 first and it arrives without browser furniture ' +
                      'around it.';
    body.push(tip);

    return dialog('Mirror this tab instead', body, [{ label: 'Got it', primary: true }]);
  };

  /* ------------------------------------------------------------------ */

  cast.init = function () {
    el.deck = $('castDeck');
    if (!el.deck) return;

    /* On the television we *are* the receiver; offering to cast onward would
       be absurd, so the whole row goes. */
    if (navigator.presentation && navigator.presentation.receiver) {
      el.deck.hidden = true;
      return;
    }

    el.btn = $('btnCast');
    el.lab = $('castLab');
    el.line = $('castLine');
    el.sub = $('castSub');
    el.glyph = $('castGlyph');

    el.glyph.innerHTML = GLYPH;

    el.btn.addEventListener('click', function () {
      if (connection) cast.stop();
      else cast.start();
    });
    $('btnCastAddr').addEventListener('click', cast.address);
    $('btnCastHelp').addEventListener('click', cast.mirror);

    /* The address carries the station, so a new station is a new address. */
    window.addEventListener('5radio:tuned', function () { paint(); });

    /* Chrome can hand back a connection started elsewhere (a reload, another
       tab) — take it rather than showing a disconnected key. */
    if (navigator.presentation && supported()) {
      try {
        var d = cast.diagnose();
        if (d.ok) {
          navigator.presentation.defaultRequest = new PresentationRequest([d.url]);
          navigator.presentation.defaultRequest.addEventListener('connectionavailable', function (ev) {
            hold(ev.connection);
          });
        }
      } catch (e) { /* optional, and not worth a broken row over */ }
    }

    watch();
    paint();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cast.init);
  else cast.init();

})();
