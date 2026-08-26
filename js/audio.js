/* ============================================================================
   5RADIO — hearing the stream
   ----------------------------------------------------------------------------
   The VU meters on the boombox are a knowing fake, and the README says why:
   reading a station's levels needs an AnalyserNode, an AnalyserNode needs
   `crossOrigin="anonymous"` on the <audio> element, and the belief — written
   down in this project and in 5OS both — was that almost no station sends the
   CORS headers that then become mandatory. Setting the attribute on a station
   that does not would stop it playing at all, so nobody set it.

   That belief is out of date. Probed across the catalog (tools/probe-cors.mjs),
   ~90% of the stations that answer at all send an `Access-Control-Allow-Origin`
   that admits us — most of them `*`, the rest reflecting the origin. Radio
   moved to CDNs, and CDNs send CORS headers.

   So this file asks for the real thing, and is careful about the ~10% that
   still refuse: a station that will not be read is remembered, so it is not
   made to fail twice, and `read()` still answers — with a drive synthesised
   from nothing, flagged `real: false`, so the caller can say so rather than
   pretending it is the music.

   **Why there are two audio elements.** The obvious design routes the radio's
   own `<audio>` through the analyser. It was built that way first, and it is a
   trap with teeth: `createMediaElementSource()` binds an element to the graph
   **permanently** — there is no unbinding it — and a `MediaElementAudioSource`
   whose media is not CORS-clean outputs *silence*, by specification.

   So the moment that graph exists, the ~10% of stations that refuse CORS play
   silently: measured on WFMU, the element reported `playing`, `currentTime`
   advanced past a minute, and the waveform was flat 128 — digital silence —
   while the display cheerfully read PLAY. A radio that lies about playing is
   far worse than a visual that does not react.

   Hence: the radio's element is never touched. A second, muted element fetches
   the same stream purely to be looked at, and it is the only thing wired into
   the graph. If it fails — a station that refuses CORS — nothing happens to
   the radio at all; the visual just falls back to its synthesised drive. The
   price is the stream being fetched twice while the visual is on (~16 KB/s for
   a 128k station) and the two connections sitting a little apart on the live
   edge, which a feedback smear does not notice the way a waveform scope would.

   One more trap, also silent: an AudioContext starts **suspended** until a
   gesture, and an analyser on a suspended context reads zeros forever. So the
   context is resumed on any gesture and the graph is only built once it is
   actually running.

   The meter is a port of 5OS's `OS.audio.meter`, including the one piece of
   hard-won knowledge in it: beats are found by **spectral flux**, not by
   energy over a running average. Broadcast audio is compressed flat, so the
   kick arrives as a rising edge on a high plateau rather than a spike out of
   quiet, and an energy detector never fires at all.
   ========================================================================== */

(function () {
  'use strict';

  var A = {};
  window.RADIO_AUDIO = A;

  var ctx = null;
  var probe = null;           /* the second element — muted, only looked at */
  var source = null;          /* MediaElementAudioSourceNode, bound to probe */
  var analyser = null;
  var player = null;          /* the radio's own element. Never touched. */
  var wanted = false;
  var meter = null;
  var corsOk = false;         /* did the stream come back at all? */

  /* Stations whose stream refused CORS. Remembered for the session so one is
     not made to fail twice. */
  var deaf = {};

  A.supported = function () {
    return typeof window.AudioContext === 'function' ||
           typeof window.webkitAudioContext === 'function';
  };

  A.attach = function (el) { player = el; };

  A.wanted = function () { return wanted; };
  /* "Real" is not a flag someone set once; it is whether audio is moving
     through the analyser right now. Derived, so it heals itself: the probe
     may load while the page is still untouched and only start when the radio
     does, and the readout should follow that rather than latch. */
  A.real = function () {
    return !!(corsOk && analyser && ctx && ctx.state === 'running' &&
              probe && !probe.paused && probe.readyState >= 2);
  };
  A.deafTo = function (station) { return !!(station && deaf[station.id]); };

  /* ------------------------------------------------------------------ */
  /* the probe                                                          */
  /* ------------------------------------------------------------------ */

  function context() {
    try {
      if (!ctx) {
        var C = window.AudioContext || window.webkitAudioContext;
        ctx = new C();
      }
    } catch (e) { return Promise.resolve(null); }
    if (ctx.state === 'running') return Promise.resolve(ctx);
    return ctx.resume().then(function () { return ctx.state === 'running' ? ctx : null; })
                       .catch(function () { return null; });
  }

  /* Built once, and only once the context is genuinely running — an analyser
     on a suspended context reads zeros forever and looks like a broken visual.
     The gain of zero is what keeps this element silent: it has to reach the
     destination for the graph to be pulled at all, but nobody should hear it.
     The radio is what you hear. */
  function ensureProbe() {
    if (probe) return true;
    if (!ctx || ctx.state !== 'running') return false;
    try {
      probe = new Audio();
      probe.crossOrigin = 'anonymous';
      probe.preload = 'auto';
      probe.muted = false;             /* muting would also mute the analyser */
      probe.volume = 1;

      source = ctx.createMediaElementSource(probe);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.15;   /* see the meter's note */
      var silence = ctx.createGain();
      silence.gain.value = 0;

      source.connect(analyser);
      analyser.connect(silence);
      silence.connect(ctx.destination);
      meter = makeMeter(analyser);
      return true;
    } catch (e) {
      probe = null; source = null; analyser = null;
      return false;
    }
  }

  /* Point the probe at a station. Answers whether the *stream* will be read —
     which is a different question from whether it is being read this second,
     and conflating the two was a real bug: on a page nobody has touched yet
     `probe.play()` is refused with NotAllowedError exactly as the radio's own
     element is, and reporting that as "this station will not allow its audio
     to be read" blamed the broadcaster for the browser's autoplay policy, then
     never recovered when playback finally started.

     So the verdict comes from whether *data arrives* — `loadeddata` means the
     bytes came back and CORS was satisfied — and never from whether playback
     began. Only a genuine `error` marks a station unreadable. Getting the
     sound moving afterwards is `follow()`'s job. */
  function watch(station) {
    if (!station || !station.url) return Promise.resolve(false);
    if (deaf[station.id]) return Promise.resolve(false);
    if (!ensureProbe()) return Promise.resolve(false);

    return new Promise(function (resolve) {
      var settled = false;
      function done(ok) {
        if (settled) return;
        settled = true;
        ['playing', 'loadeddata', 'canplay'].forEach(function (t) {
          probe.removeEventListener(t, good);
        });
        probe.removeEventListener('error', bad);
        clearTimeout(timer);
        corsOk = ok;
        resolve(ok);
      }
      function good() { done(true); }
      function bad() {
        /* The station will not be read. Remember it, stop the probe, and let
           the visual fall back — the radio has not noticed any of this. */
        deaf[station.id] = true;
        try { probe.removeAttribute('src'); probe.load(); } catch (e) {}
        done(false);
      }

      ['playing', 'loadeddata', 'canplay'].forEach(function (t) {
        probe.addEventListener(t, good);
      });
      probe.addEventListener('error', bad);
      var timer = setTimeout(function () { done(probe.readyState >= 2); }, 9000);

      probe.src = station.url;
      /* A refusal here is "not yet", not "cannot": no gesture has been given.
         The data still arrives, `loadeddata` still fires, and follow() starts
         the sound the moment the radio itself is playing. */
      probe.play().catch(function () { /* waiting on a gesture */ });
    });
  }

  function hush() {
    corsOk = false;
    if (!probe) return;
    try { probe.pause(); probe.removeAttribute('src'); probe.load(); } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /* turning it on                                                      */
  /* ------------------------------------------------------------------ */

  A.enable = function (station) {
    wanted = true;
    if (!A.supported()) return Promise.resolve(false);
    return context().then(function (c) {
      if (!c) return false;
      return watch(station);
    });
  };

  A.disable = function () {
    wanted = false;
    hush();                  /* stop fetching the stream a second time */
  };

  /* A new station is a new stream for the probe too. */
  A.retune = function (station) {
    if (!wanted) return Promise.resolve(false);
    hush();
    return context().then(function (c) {
      if (!c) return false;
      return watch(station);
    });
  };

  /* Keep the probe roughly with the radio: no point fetching a second copy of
     a stream nobody is listening to. */
  A.follow = function (playing) {
    if (!wanted || !probe || !probe.src) return;
    if (playing && probe.paused) probe.play().catch(function () {});
    else if (!playing && !probe.paused) probe.pause();
  };

  /* Any user gesture is a chance to get a suspended context going. */
  A.kick = function () {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
  };

  /* ------------------------------------------------------------------ */
  /* what a visual actually wants                                        */
  /* ------------------------------------------------------------------ */

  var fake = {
    level: 0, bass: 0, lowMid: 0, mid: 0, treble: 0, beat: 0, bpm: 0,
    waveform: null, spectrum: null, real: false
  };
  var fakePhase = 0;
  var fakeWave = new Uint8Array(2048);
  var fakeBeatAt = 0;

  /* When there is nothing to read, the machine should still move — the same
     decision the VU meters made, for the same reason, and flagged the same
     way so nothing downstream can mistake it for the real thing. */
  function synthesise(now, playing) {
    if (!playing) {
      fake.level = fake.bass = fake.mid = fake.treble = fake.beat = 0;
      return fake;
    }
    fakePhase += 0.016;
    var swell = 0.35 + 0.22 * Math.sin(fakePhase * 0.7) + 0.12 * Math.sin(fakePhase * 2.3);
    fake.level = Math.max(0, swell);
    fake.bass = Math.max(0, swell * 0.9 + 0.1 * Math.sin(fakePhase * 3.1));
    fake.lowMid = fake.level * 0.8;
    fake.mid = Math.max(0, swell * 0.7 + 0.1 * Math.sin(fakePhase * 1.7));
    fake.treble = Math.max(0, swell * 0.5 + 0.1 * Math.cos(fakePhase * 4.1));

    /* A steady 120-ish, so presets that lean on the beat still breathe. */
    fake.bpm = 120;
    fake.beat *= 0.86;
    if (now - fakeBeatAt > 500) { fakeBeatAt = now; fake.beat = 1; }

    for (var i = 0; i < fakeWave.length; i++) {
      var f = i / fakeWave.length;
      fakeWave[i] = 128 + Math.round(
        46 * fake.level * Math.sin(f * Math.PI * 12 + fakePhase * 3) +
        18 * Math.sin(f * Math.PI * 41 - fakePhase * 5));
    }
    fake.waveform = fakeWave;
    return fake;
  }

  A.read = function (now, playing) {
    now = now || performance.now();
    if (meter && A.real() && playing) {
      var m = meter.update(now);
      if (m.level > 0.0005 || m.beat > 0) return m;
      /* Connected but silent — a stream that died, or a gap. Rather than
         freeze the picture, coast on the synthetic drive. */
    }
    return synthesise(now, playing);
  };

  /* ------------------------------------------------------------------ */
  /* the meter — ported from 5OS's OS.audio.meter                        */
  /* ------------------------------------------------------------------ */

  function makeMeter(an) {
    var bins = an.frequencyBinCount;
    var spectrum = new Uint8Array(bins);
    var waveform = new Uint8Array(an.fftSize);
    var rate = (an.context && an.context.sampleRate) || 48000;
    var hzPerBin = rate / an.fftSize;

    function range(lo, hi) {
      return [Math.max(1, Math.floor(lo / hzPerBin)), Math.min(bins - 1, Math.ceil(hi / hzPerBin))];
    }
    var BANDS = {
      bass: range(20, 250), lowMid: range(250, 800),
      mid: range(800, 3000), treble: range(3000, 12000)
    };

    var prevBass = null, history = [], HISTORY = 90;
    var lastBeatAt = 0, REFRACTORY = 240;
    var intervals = [], bpm = 0, confidence = 0;
    var smooth = { level: 0, bass: 0, lowMid: 0, mid: 0, treble: 0, beat: 0 };
    var lastAt = 0;
    var out = { real: true, waveform: waveform, spectrum: spectrum, bands: BANDS };

    function bandEnergy(r) {
      var sum = 0;
      for (var i = r[0]; i <= r[1]; i++) sum += spectrum[i];
      return sum / ((r[1] - r[0] + 1) * 255);
    }
    function ease(c, t, up, down) {
      return t > c ? c + (t - c) * up : c + (t - c) * down;
    }

    /* The commonest gap between onsets is the beat length; the rest is
       syncopation and noise. */
    function estimateBpm() {
      if (intervals.length < 4) return bpm;
      var best = 0, bestScore = 0, i, j;
      for (i = 0; i < intervals.length; i++) {
        var score = 0;
        for (j = 0; j < intervals.length; j++) {
          if (Math.abs(intervals[j] - intervals[i]) < 40) score++;
        }
        if (score > bestScore) { bestScore = score; best = intervals[i]; }
      }
      if (!best) return bpm;

      /* Average the winning cluster: a frame-quantised 174 arrives as a mix
         of 333 and 350 ms, and 333 alone reads as 180 and folds to 90. */
      var sum = 0, n = 0;
      for (var k = 0; k < intervals.length; k++) {
        if (Math.abs(intervals[k] - best) < 40) { sum += intervals[k]; n++; }
      }
      var next = 60000 / (sum / n);
      while (next < 70) next *= 2;
      while (next > 190) next /= 2;      /* 174 is a real tempo; ceiling is 190 */

      confidence = bestScore / intervals.length;
      if (confidence < 0.34) return bpm;
      if (!bpm) return next;
      var ratio = next / bpm;
      if (Math.abs(ratio - 2) < 0.15 || Math.abs(ratio - 0.5) < 0.08) return next;
      return bpm + (next - bpm) * (0.12 + confidence * 0.3);
    }

    out.update = function (now) {
      lastAt = now;
      an.getByteFrequencyData(spectrum);
      an.getByteTimeDomainData(waveform);

      var bass = bandEnergy(BANDS.bass);
      var lowMid = bandEnergy(BANDS.lowMid);
      var mid = bandEnergy(BANDS.mid);
      var treble = bandEnergy(BANDS.treble);

      var sum = 0;
      for (var i = 0; i < bins; i++) sum += spectrum[i];
      var level = sum / (bins * 255);

      /* rise fast, fall slow: snap to a hit, then relax */
      smooth.level = ease(smooth.level, level, 0.35, 0.08);
      smooth.bass = ease(smooth.bass, bass, 0.45, 0.10);
      smooth.lowMid = ease(smooth.lowMid, lowMid, 0.40, 0.10);
      smooth.mid = ease(smooth.mid, mid, 0.40, 0.12);
      smooth.treble = ease(smooth.treble, treble, 0.50, 0.15);

      /* Spectral flux: how much the bass bins *rose*. Falls are ignored — a
         beat is an attack, and the decay after it is not another one. */
      var r0 = BANDS.bass[0], r1 = BANDS.bass[1];
      if (!prevBass) prevBass = new Float32Array(r1 - r0 + 1);
      var flux = 0;
      for (var f = r0; f <= r1; f++) {
        var c = spectrum[f] / 255;
        var rise = c - prevBass[f - r0];
        if (rise > 0) flux += rise;
        prevBass[f - r0] = c;
      }
      flux /= (r1 - r0 + 1);

      history.push(flux);
      if (history.length > HISTORY) history.shift();

      var mean = 0, h;
      for (h = 0; h < history.length; h++) mean += history[h];
      mean /= (history.length || 1);
      var variance = 0;
      for (h = 0; h < history.length; h++) {
        var d = history[h] - mean;
        variance += d * d;
      }
      var sd = Math.sqrt(variance / (history.length || 1));

      /* An onset stands clear of the recent normal; the sd term is what makes
         that adapt to a busy mix versus a sparse one. */
      var threshold = mean + sd * 1.5;
      if (history.length > 20 && flux > threshold && flux > 0.0012 &&
          bass > 0.02 && now - lastBeatAt > REFRACTORY) {
        if (lastBeatAt) {
          var gap = now - lastBeatAt;
          if (gap > 250 && gap < 1500) {
            intervals.push(gap);
            if (intervals.length > 24) intervals.shift();
            bpm = estimateBpm();
          }
        }
        lastBeatAt = now;
        smooth.beat = 1;
      } else {
        smooth.beat *= 0.86;
      }

      out.level = smooth.level;
      out.bass = smooth.bass;
      out.lowMid = smooth.lowMid;
      out.mid = smooth.mid;
      out.treble = smooth.treble;
      out.beat = smooth.beat;
      out.bpm = bpm;
      out.confidence = confidence;
      return out;
    };

    return out;
  }

})();
