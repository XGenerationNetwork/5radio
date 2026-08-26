/* ============================================================================
   5RADIO — the visualizer deck
   ----------------------------------------------------------------------------
   A third chassis under the machine, hosting the MilkDrop-style visual from
   js/milkdrop.js and driven by js/audio.js.

   Four things it has to get right that the engine itself never thinks about:

   **One engine, three homes.** The visual can be in the deck, painted across
   the whole page behind the content, or filling the screen. Building an engine
   per home would mean three GL contexts, three ping-pong pairs and three
   copies of the feedback history — and the history *is* the picture, so moving
   between homes would flash a black frame each time. Instead there is one
   canvas and one context, moved between three parents. The feedback buffer
   never learns it went anywhere.

   **The background is the same canvas.** When BACKGROUND is on, the canvas is
   fixed behind the page at full viewport size and the page's own background
   goes transparent so it shows through. Everything on top gets a scrim, or the
   text becomes unreadable the moment the visual goes bright.

   **A visual with nothing to watch is a screensaver.** js/audio.js answers
   with `real: false` when it cannot read the stream, and the readout says
   REACTING or PATTERN accordingly rather than letting a synthetic drive pass
   for the music.

   **It must be able to stop.** WebGL at full viewport is the most expensive
   thing this page does, so it renders only when it is on, pauses itself when
   the tab is hidden, and drops the internal resolution when the canvas gets
   large.
   ========================================================================== */

(function () {
  'use strict';

  var V = {};
  window.RADIO_VIS = V;

  var $ = function (id) { return document.getElementById(id); };

  var el = {};
  var engine = null;
  var canvas = null;
  var running = false;
  var background = false;
  var raf = 0;
  var lastAt = 0;
  var failed = false;

  /* Internal render scale. This mode is fill-rate bound, so halving the
     resolution is worth far more than anything else — and a full-page canvas
     on a 4K display is four times the work of the deck. */
  function scaleFor(w, h) {
    var px = w * h;
    if (px > 3500000) return 0.5;
    if (px > 1600000) return 0.65;
    return 1;
  }

  /* ------------------------------------------------------------------ */
  /* the three homes                                                    */
  /* ------------------------------------------------------------------ */

  function home() {
    if (document.fullscreenElement) return 'full';
    return background ? 'back' : 'deck';
  }

  function place() {
    if (!canvas) return;
    var where = home();
    var parent = where === 'full' ? el.fullHost
               : where === 'back' ? el.backHost
               : el.stage;
    if (canvas.parentNode !== parent) parent.appendChild(canvas);

    document.body.classList.toggle('vis-background', background && running);
    el.deck.classList.toggle('is-background', background);
    fit();
  }

  function fit() {
    if (!engine || !canvas) return;
    var box = canvas.parentNode;
    if (!box) return;
    var r = box.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(2, Math.round(r.width * dpr));
    var h = Math.max(2, Math.round(r.height * dpr));
    if (!w || !h) return;
    engine.setScale(scaleFor(w, h));
    engine.resize(w, h);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }

  /* ------------------------------------------------------------------ */
  /* the loop                                                           */
  /* ------------------------------------------------------------------ */

  function frame(now) {
    if (!running) { raf = 0; return; }
    raf = requestAnimationFrame(frame);

    /* A hidden tab gets no frames from the browser anyway, but a visible tab
       whose visual is off-screen still costs a full GPU pass, so the deck
       stops when it scrolls away and the background never does. */
    var dt = lastAt ? (now - lastAt) / 1000 : 0.016;
    lastAt = now;

    var playing = !el.player.paused;
    RADIO_AUDIO.follow(playing);      /* don't fetch a second copy of silence */
    var a = RADIO_AUDIO.read(now, playing);
    engine.render(a, dt);
    paintReadout(a);
  }

  var readoutAt = 0;
  function paintReadout(a) {
    var now = performance.now();
    if (now - readoutAt < 400) return;
    readoutAt = now;

    el.preset.textContent = engine.presetName().toUpperCase();
    var real = a.real;
    el.source.textContent = real ? 'REACTING' : 'PATTERN';
    el.source.className = 'vis-tag' + (real ? ' good' : '');
    el.source.title = real
      ? 'Reading the stream itself through an AnalyserNode'
      : 'Not reading the stream — the picture is running on a synthesised drive';
    el.bpm.textContent = real && a.bpm ? Math.round(a.bpm) + ' BPM' : '';
    el.sub.textContent = why(real);
  }

  /* There are three reasons the picture might not be reacting, and they want
     three different sentences. Saying "this station will not allow it" when the
     truth is "nothing is playing yet" blames the broadcaster for the browser,
     and sends someone hunting for a fault that is not there. Derived every
     frame rather than set once, so it corrects itself the moment Play is
     pressed. */
  function why(real) {
    if (real) return 'Reading the stream directly. Beats come from spectral flux, which is what works on broadcast audio.';
    if (RADIO_AUDIO.deafTo(currentStation())) {
      return 'This station will not let its audio be read, so the picture runs on a synthesised drive.';
    }
    if (el.player.paused) return 'Press PLAY and the picture will follow the music.';
    return 'Listening for the stream…';
  }

  /* ------------------------------------------------------------------ */
  /* on and off                                                         */
  /* ------------------------------------------------------------------ */

  V.start = function () {
    if (running || failed) return;

    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'vis-canvas';
      el.stage.appendChild(canvas);
      engine = RADIO_MILK.create(canvas, { auto: true, dwell: 16 });
      if (!engine) {
        failed = true;
        el.deck.classList.add('is-failed');
        el.preset.textContent = 'NO WEBGL';
        el.source.textContent = '';
        el.sub.textContent = 'This browser or machine has no WebGL, so the visual cannot run.';
        return;
      }
    }

    running = true;
    el.deck.classList.add('is-on');
    el.btnLab.textContent = 'STOP';
    el.btn.setAttribute('aria-pressed', 'true');
    place();

    /* Ask for the real audio. The answer arrives late — the stream has to be
       refetched under CORS to find out — and either way the visual is already
       running by then, on whichever drive it turns out to have. */
    RADIO_AUDIO.kick();
    RADIO_AUDIO.enable(currentStation());   /* the readout says how it went */

    lastAt = 0;
    if (!raf) raf = requestAnimationFrame(frame);
    save();
  };

  V.stop = function () {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    el.deck.classList.remove('is-on');
    el.btnLab.textContent = 'START';
    el.btn.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('vis-background');
    RADIO_AUDIO.disable();
    save();
  };

  V.toggle = function () { running ? V.stop() : V.start(); };
  V.running = function () { return running; };

  V.setBackground = function (on) {
    background = !!on;
    el.btnBack.setAttribute('aria-pressed', String(background));
    el.btnBack.classList.toggle('on', background);
    if (running) place();
    else el.deck.classList.toggle('is-background', background);
    save();
  };

  /* ------------------------------------------------------------------ */
  /* fullscreen                                                         */
  /* ------------------------------------------------------------------ */

  /* True fullscreen of the stage alone. A page can be refused this by
     permissions policy — inside a frame that was not given `allow="fullscreen"`,
     for instance — so the failure is reported rather than swallowed, and
     BACKGROUND plus the browser's own F11 is the route that always works. */
  V.fullscreen = function () {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
      return;
    }
    if (!running) V.start();
    var host = el.fullHost;
    var go = host.requestFullscreen || host.webkitRequestFullscreen;
    if (!go) { el.sub.textContent = 'This browser has no Fullscreen API. Try F11.'; return; }
    go.call(host).catch(function (err) {
      el.sub.textContent = 'Fullscreen was refused (' + (err && err.name) +
                           '). Turn BACKGROUND on and press F11 instead.';
    });
  };

  function onFsChange() {
    var full = !!document.fullscreenElement;
    el.deck.classList.toggle('is-full', full);
    document.body.classList.toggle('vis-full', full);
    place();
    if (full && !running) V.start();
  }

  /* ------------------------------------------------------------------ */
  /* cinema                                                             */
  /* ------------------------------------------------------------------ */

  /* What a television gets: the visual, and none of the furniture. A TV never
     needs the controls back — but the same link opened on a laptop would leave
     someone staring at a picture with invisible, unclickable controls, which
     reads as a fault rather than a feature. So any sign of a person brings the
     page back for a few seconds, and Esc leaves cinema for good. Nothing on a
     TV ever moves a mouse, so nothing on a TV is ever disturbed by this. */
  var WAKE_MS = 3500;
  var wakeTimer = 0;
  var inCinema = false;

  function cinema(on) {
    inCinema = !!on;
    document.body.classList.toggle('vis-cinema', inCinema);
    if (!inCinema) {
      document.body.classList.remove('vis-woken');
      clearTimeout(wakeTimer);
      return;
    }
    ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(function (t) {
      document.addEventListener(t, wake, { passive: true });
    });
  }

  function wake(e) {
    if (!inCinema) return;
    if (e && e.type === 'keydown' && e.key === 'Escape') { cinema(false); return; }
    document.body.classList.add('vis-woken');
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(function () {
      document.body.classList.remove('vis-woken');
    }, WAKE_MS);
  }

  V.cinema = cinema;

  /* ------------------------------------------------------------------ */
  /* session                                                            */
  /* ------------------------------------------------------------------ */

  /* Kept apart from the radio's own session blob: whether the visual is on is
     a property of this machine's patience with a GPU, not of what is on the
     dial, and a saved session moved between a laptop and a phone should not
     bring a full-screen WebGL loop with it. */
  var KEY = '5radio.visual.v1';

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        on: running, background: background
      }));
    } catch (e) { /* nothing to be done, and not worth interrupting for */ }
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch (e) { return null; }
  }

  function currentStation() {
    try { return (window.RADIO_APP && window.RADIO_APP.current()) || null; }
    catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ */

  V.init = function () {
    el.deck = $('visDeck');
    if (!el.deck) return;

    el.stage = $('visStage');
    el.backHost = $('visBack');
    el.fullHost = $('visFull');
    el.btn = $('btnVis');
    el.btnLab = $('visLab');
    el.btnBack = $('btnVisBack');
    el.btnFull = $('btnVisFull');
    el.prev = $('btnVisPrev');
    el.nextK = $('btnVisNext');
    el.cycle = $('btnVisCycle');
    el.preset = $('visPreset');
    el.source = $('visSource');
    el.bpm = $('visBpm');
    el.sub = $('visSub');
    el.player = $('player');

    RADIO_AUDIO.attach(el.player);

    el.btn.addEventListener('click', V.toggle);
    el.btnBack.addEventListener('click', function () { V.setBackground(!background); });
    el.btnFull.addEventListener('click', V.fullscreen);
    el.prev.addEventListener('click', function () { if (engine) { engine.next(-1); paintReadout({ real: RADIO_AUDIO.real() }); } });
    el.nextK.addEventListener('click', function () { if (engine) { engine.next(1); paintReadout({ real: RADIO_AUDIO.real() }); } });
    el.cycle.addEventListener('click', function () {
      if (!engine) return;
      var on = !engine.auto();
      engine.setAuto(on);
      el.cycle.classList.toggle('on', !on);
      el.cycle.querySelector('.key-lab').textContent = on ? 'CYCLING' : 'HELD';
    });

    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('resize', function () { if (running) fit(); });

    /* A new station is a new stream, and a new stream has to be fetched under
       CORS again or the analyser goes quiet halfway through the evening. */
    window.addEventListener('5radio:tuned', function (e) {
      if (!running) return;
      RADIO_AUDIO.retune(e.detail && e.detail.station);
    });

    /* Any gesture is a chance to get a suspended AudioContext going. */
    ['pointerdown', 'keydown'].forEach(function (t) {
      document.addEventListener(t, function () { RADIO_AUDIO.kick(); }, { passive: true });
    });

    if (!RADIO_MILK || typeof window.WebGLRenderingContext !== 'function') {
      el.deck.classList.add('is-failed');
      el.sub.textContent = 'This browser has no WebGL, so the visual cannot run.';
      failed = true;
      return;
    }

    /* `view=visual` in the link — what the CAST key sends a television — opens
       straight into the full-page visual with the page furniture out of the
       way. On a TV nobody is going to scroll to a deck. */
    var wantsVisual = window.RADIO_APP && RADIO_APP.urlParam &&
                      /^(visual|milk|1|true|yes)$/i.test(String(RADIO_APP.urlParam('view') || ''));

    var saved = load();
    if (wantsVisual) {
      V.setBackground(true);
      V.start();
      cinema(true);
    } else if (saved) {
      if (saved.background) V.setBackground(true);
      if (saved.on) V.start();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', V.init);
  else V.init();

})();
