/* ============================================================================
   5RADIO — application
   ----------------------------------------------------------------------------
   Drives the boombox: filtering, tuning, playback, and the live search against
   radio-browser.info. No framework, no build step, no dependencies.

   Data comes from data/stations.js (a <script>, not a fetch, so the page also
   works when opened straight off the disk) and is labelled by js/taxonomy.js,
   the same classifier the live search uses.
   ========================================================================== */

(function () {
  'use strict';

  var T = window.RADIO_TAXONOMY;
  var CATALOG = window.RADIO_CATALOG || { stations: [], genres: [], regions: [] };

  var PAGE_SIZE = 60;
  var TUNE_TIMEOUT_MS = 14000;   // how long a stream gets to produce audio
  var SCAN_RETRIES = 4;          // dead streams to skip past before giving up on SCAN

  /* Radio Browser mirrors, tried in order, for live search only. */
  var API_HOSTS = [
    'https://de1.api.radio-browser.info/json/',
    'https://all.api.radio-browser.info/json/'
  ];

  /* Cassette-spine colour per genre. */
  var GENRE_COLOR = {
    'News & Talk': '#8d99a8', Sports: '#5aa9e6', Classical: '#c9a227',
    Jazz: '#e08e45', Blues: '#4f8ef7', Metal: '#b5b5bd', Rock: '#ff3b6b',
    Indie: '#c56cf0', 'Hip Hop': '#f5b700', 'R&B and Soul': '#e0479e',
    Electronic: '#00e5d0', Ambient: '#6fd3c7', Country: '#d98555',
    Folk: '#9ac06e', Reggae: '#3ec46d', Latin: '#ff8c42', Oldies: '#d4a373',
    World: '#7ea8f7', Religious: '#b8a1e3', Pop: '#ff6f91', Variety: '#7d848d'
  };

  /* ------------------------------------------------------------------ dom */

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    boombox: $('boombox'),
    lcdMode: $('lcdMode'), lcdName: $('lcdName'), lcdMeta: $('lcdMeta'),
    lcdFreq: $('lcdFreq'), lcdQuality: $('lcdQuality'),
    ticks: $('ticks'), needle: $('needle'), vuL: $('vuL'), vuR: $('vuR'),
    btnPlay: $('btnPlay'), playGlyph: $('playGlyph'), playLab: $('playLab'),
    btnPrev: $('btnPrev'), btnNext: $('btnNext'), btnStop: $('btnStop'),
    btnScan: $('btnScan'), btnScan2: $('btnScan2'), btnReset: $('btnReset'),
    volume: $('volume'), volOut: $('volOut'),
    genre: $('genre'), region: $('region'), search: $('search'), sort: $('sort'),
    liveMode: $('liveMode'), count: $('count'),
    list: $('list'), empty: $('empty'), btnMore: $('btnMore'),
    player: $('player')
  };

  /* Set up by init(); js/save.js owns the timer, the unload hooks and the
     blob itself. */
  var autosave = null;

  var state = {
    pool: CATALOG.stations,   // what the filters run over (catalog, or live results)
    matches: [],              // current filtered + sorted view
    shown: PAGE_SIZE,
    current: null,
    live: false,
    liveBusy: false,
    scanTries: 0
  };

  /* --------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* A station has no real frequency, but a boombox needs a number on the dial.
   * Hash the id so each station always lands on the same spot: the needle
   * becomes a recognisable position rather than a random twitch. */
  function freqFor(station) {
    var h = 0, key = station.id || station.url || station.name;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return 88.1 + (h % 200) / 10;   // 88.1 – 108.0
  }

  function placeOf(s) {
    if (s.cc === 'US') return s.place || 'United States';
    return s.place && s.country && s.place !== s.country
      ? s.place + ', ' + s.country
      : (s.place || s.country || 'Unknown');
  }

  function qualityOf(s) {
    var bits = [];
    if (s.codec) bits.push(s.codec);
    if (s.bitrate) bits.push(s.bitrate + 'k');
    return bits.join(' ');
  }

  function press(button) {
    if (!button) return;
    button.classList.add('pressed');
    setTimeout(function () { button.classList.remove('pressed'); }, 130);
  }

  /* --------------------------------------------------------------- filters */

  function currentFilter() {
    return {
      genre: el.genre.value,
      region: el.region.value,
      q: el.search.value.trim().toLowerCase()
    };
  }

  function matchesFilter(s, f) {
    if (f.genre && s.genre !== f.genre) return false;
    if (f.region && s.region !== f.region) return false;
    if (f.q) {
      var hay = (s.name + ' ' + s.place + ' ' + s.country + ' ' + s.genre + ' ' + s.tags.join(' ')).toLowerCase();
      if (hay.indexOf(f.q) === -1) return false;
    }
    return true;
  }

  var SORTERS = {
    popular: function (a, b) { return b.clicks - a.clicks || a.name.localeCompare(b.name); },
    name: function (a, b) { return a.name.localeCompare(b.name); },
    place: function (a, b) { return (placeOf(a)).localeCompare(placeOf(b)) || a.name.localeCompare(b.name); },
    bitrate: function (a, b) { return b.bitrate - a.bitrate || a.name.localeCompare(b.name); }
  };

  function applyFilters(keepShown) {
    var f = currentFilter();
    state.matches = state.pool.filter(function (s) { return matchesFilter(s, f); });
    state.matches.sort(SORTERS[el.sort.value] || SORTERS.popular);
    if (!keepShown) state.shown = PAGE_SIZE;
    render();
  }

  /* ---------------------------------------------------------------- render */

  function stationRow(s) {
    var color = GENRE_COLOR[s.genre] || '#7d848d';
    var li = document.createElement('li');
    li.className = 'st' + (state.current && state.current.id === s.id ? ' current' : '');
    li.style.setProperty('--tab', color);
    li.style.setProperty('--tab-soft', color + '33');
    li.dataset.id = s.id;

    var quality = qualityOf(s);
    li.innerHTML =
      '<span class="st-tab"></span>' +
      '<div class="st-body">' +
        '<span class="st-name">' + esc(s.name) + '</span>' +
        '<span class="st-meta">' +
          '<span class="chip chip-genre">' + esc(s.genre) + '</span>' +
          '<span>' + esc(placeOf(s)) + '</span>' +
          (quality ? '<span class="chip">' + esc(quality) + '</span>' : '') +
        '</span>' +
      '</div>' +
      '<div class="st-controls">' +
        '<button class="st-btn st-play" type="button" title="Play ' + esc(s.name) + '" aria-label="Play ' + esc(s.name) + '">▶</button>' +
        '<a class="st-btn" href="' + esc(s.homepage || s.url) + '" target="_blank" rel="noopener noreferrer" ' +
           'title="Open ' + esc(s.name) + ' at the source" aria-label="Open ' + esc(s.name) + ' in a new tab">↗</a>' +
      '</div>';

    li.querySelector('.st-play').addEventListener('click', function (e) {
      e.stopPropagation();
      tune(s, true);
    });
    li.addEventListener('click', function () { tune(s, true); });

    return li;
  }

  function render() {
    var total = state.matches.length;
    var slice = state.matches.slice(0, state.shown);

    var frag = document.createDocumentFragment();
    slice.forEach(function (s) { frag.appendChild(stationRow(s)); });
    el.list.innerHTML = '';
    el.list.appendChild(frag);

    el.empty.hidden = total > 0;
    el.btnMore.hidden = total <= state.shown;
    el.count.textContent =
      (state.live ? 'LIVE: ' : '') +
      total.toLocaleString() + (total === 1 ? ' STATION' : ' STATIONS') +
      (total > slice.length ? ' (SHOWING ' + slice.length.toLocaleString() + ')' : '');
  }

  function markCurrentRow() {
    var rows = el.list.querySelectorAll('.st');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('current', !!state.current && rows[i].dataset.id === state.current.id);
    }
  }

  /* ---------------------------------------------------------------- the LCD */

  function setMode(mode) {
    el.lcdMode.textContent = mode;
    el.boombox.classList.toggle('is-tuning', mode === 'TUNE');
    el.boombox.classList.toggle('is-error', mode === 'FAIL');
    var playing = mode === 'PLAY';
    el.playGlyph.textContent = playing ? '❚❚' : '▶';
    el.playLab.textContent = playing ? 'PAUSE' : 'PLAY';
    el.btnPlay.classList.toggle('on', playing);
    el.btnPlay.setAttribute('aria-pressed', String(playing));
    syncMotion();
  }

  /* ---------------------------------------------------------- the motion */

  /* Every moving part -- cones, woofers, reels, antenna, the STEREO flicker,
   * the VU meters -- hangs off `is-playing`, and `is-playing` means one thing:
   * audio is moving right now. It used to mean "a `playing` event arrived",
   * which is a different claim: it left the machine still during the tuning
   * gap and through every rebuffer, and any path that never produced that one
   * event -- an autoplayed link among them -- left it still for good.
   *
   * Asking the element itself needs nothing armed and has no event to miss.
   * A stall stops the machine and the recovery starts it again by itself. */
  function audioEngaged() {
    var p = el.player;
    return !!p.currentSrc && !p.paused && !p.ended;
  }

  function audioFlowing() {
    return audioEngaged() && el.player.readyState >= 3;   // HAVE_FUTURE_DATA
  }

  /* A rebuffer can flick readyState down for a few frames. Dropping every
   * moving part for that long reads as a fault rather than a hiccup, so the
   * machine coasts a little before it stops; letting go of the transport
   * altogether -- pause, STOP, a stream that died -- stops it at once. */
  var MOTION_COAST_MS = 600;
  var coastUntil = 0;

  function syncMotion(now) {
    now = now === undefined ? performance.now() : now;
    var on;
    if (!audioEngaged()) { coastUntil = 0; on = false; }
    else if (audioFlowing()) { coastUntil = now + MOTION_COAST_MS; on = true; }
    else on = now < coastUntil;

    el.boombox.classList.toggle('is-playing', on);
    return on;
  }

  /* Scroll the station name only when it genuinely overflows the display. */
  function fitName(text) {
    el.lcdName.classList.remove('scrolling');
    el.lcdName.textContent = text;
    var over = el.lcdName.scrollWidth - el.lcdName.parentNode.clientWidth;
    if (over > 4) {
      el.lcdName.style.setProperty('--shift', -(over + 12) + 'px');
      el.lcdName.classList.add('scrolling');
    }
  }

  function showStation(s) {
    var freq = freqFor(s);
    fitName(s.name.toUpperCase());
    el.lcdFreq.textContent = freq.toFixed(1);
    el.lcdMeta.textContent = (s.genre + ' · ' + placeOf(s)).toUpperCase();
    el.lcdQuality.textContent = qualityOf(s);
    el.needle.style.left = ((freq - 88) / 20 * 100).toFixed(2) + '%';
  }

  /* ------------------------------------------------------------- autoplay */

  /* `play=auto` in the link says the person who made it wanted sound, which is
   * not the same as the browser agreeing: a page nobody has touched yet gets a
   * NotAllowedError instead of audio. On the receivers this flag exists for --
   * a cast target, a kiosk browser -- there is usually no such policy and the
   * first attempt simply plays. Everywhere else the request is kept alive and
   * honoured on the first gesture the page sees, rather than dropped. */
  var autoplayWanted = false;
  var autoplayArmed = false;
  var pendingAutoScan = false;

  function armAutoplayRetry() {
    if (autoplayArmed) return;
    autoplayArmed = true;
    document.addEventListener('pointerdown', onFirstGesture, true);
    document.addEventListener('keydown', onFirstGesture, true);
  }

  function onFirstGesture(e) {
    autoplayArmed = false;
    document.removeEventListener('pointerdown', onFirstGesture, true);
    document.removeEventListener('keydown', onFirstGesture, true);

    /* A gesture that landed on a control means that control decides -- PLAY,
     * SCAN, a station row. Anything else (a tap on the chassis, a stray key)
     * is just the permission the browser was holding out for. */
    var t = e.target;
    if (t && t.closest && t.closest('button, a, input, select, label, .st')) return;

    /* Deferred so the app's own handlers go first: if one of them already
     * started playback -- Space toggling PLAY -- there is nothing left to do,
     * and starting again here would leave the two fighting over the player. */
    setTimeout(function () {
      if (state.current && el.player.paused) start();
    }, 0);
  }

  /* ------------------------------------------------------------- playback */

  var tuneTimer = null;

  function clearTuneTimer() {
    if (tuneTimer) { clearTimeout(tuneTimer); tuneTimer = null; }
  }

  function tune(station, autoplay) {
    if (!station) return;
    state.current = station;
    showStation(station);
    markCurrentRow();

    try {
      /* Carry an autoplay flag that arrived in the hash back into the URL: a
       * receiver that reloads should come back playing, not sitting on PRESS
       * PLAY. One that arrived in the query string survives on its own --
       * replacing only the fragment leaves the rest of the URL alone. */
      var opt = hashParams().play;
      history.replaceState(null, '', '#s=' + encodeURIComponent(station.id) +
        (opt === undefined ? '' : '&play=' + encodeURIComponent(opt || 'auto')));
    } catch (e) { /* file:// can refuse replaceState; the radio still works */ }

    /* The hash is for sharing a link; the session is for closing the tab. */
    saveNow();

    el.player.src = station.url;
    if (autoplay) start();
    else setMode('STOP');
  }

  function start() {
    if (!state.current) { scan(); return; }
    setMode('TUNE');
    el.lcdQuality.textContent = 'TUNING…';

    clearTuneTimer();
    tuneTimer = setTimeout(function () {
      if (el.player.paused || el.player.readyState < 3) failStation('NO SIGNAL — TRY THE ↗ LINK');
    }, TUNE_TIMEOUT_MS);

    var p = el.player.play();
    if (p && p.catch) {
      p.catch(function (err) {
        // NotAllowedError means the browser wants a user gesture; everything
        // else means the stream itself would not open.
        if (err && err.name === 'NotAllowedError') {
          // Not this station's fault, so SCAN must not roll on: the next
          // station would be refused in exactly the same way.
          state.scanTries = 0;
          if (autoplayWanted) armAutoplayRetry();
          failStation(autoplayWanted
            ? 'AUTOPLAY BLOCKED — TAP ANYWHERE TO START'
            : 'PRESS PLAY TO START');
          return;
        }
        failStation('STREAM REFUSED — TRY THE ↗ LINK');
      });
    }
  }

  function failStation(message) {
    clearTuneTimer();
    setMode('FAIL');
    el.lcdQuality.textContent = '';
    el.lcdMeta.textContent = message;

    // A dead stream during SCAN just means "keep scanning" -- roll on to another.
    if (state.scanTries > 0) {
      state.scanTries--;
      setTimeout(scan, 350);
    }
  }

  function stop() {
    clearTuneTimer();
    state.scanTries = 0;
    el.player.pause();
    try { el.player.removeAttribute('src'); el.player.load(); } catch (e) {}
    setMode('STOP');
    if (state.current) el.lcdQuality.textContent = qualityOf(state.current);
  }

  function toggle() {
    if (!state.current) { scan(); return; }
    if (el.player.paused) {
      if (!el.player.src) el.player.src = state.current.url;
      start();
    } else {
      clearTuneTimer();
      el.player.pause();
      setMode('STOP');
    }
  }

  function step(delta) {
    if (!state.matches.length) return;
    var i = state.current
      ? state.matches.findIndex(function (s) { return s.id === state.current.id; })
      : -1;
    var next = state.matches[((i + delta) % state.matches.length + state.matches.length) % state.matches.length];
    if (next) tune(next, true);
  }

  /* The headline feature: a random station from whatever the dials currently
   * allow. Weighted slightly toward stations other people actually listen to,
   * so SCAN lands on a real station more often than on a dead novelty feed. */
  function scan() {
    if (!state.matches.length) {
      setMode('FAIL');
      el.lcdMeta.textContent = 'NOTHING MATCHES THOSE FILTERS';
      return;
    }

    var pool = state.matches;
    var pick;
    if (pool.length > 12) {
      // Take the better of two draws, biased toward the more-listened half.
      var a = pool[Math.floor(Math.random() * pool.length)];
      var b = pool[Math.floor(Math.random() * pool.length)];
      pick = (a.clicks >= b.clicks ? a : b);
      if (state.current && pick.id === state.current.id) {
        pick = pool[Math.floor(Math.random() * pool.length)];
      }
    } else {
      pick = pool[Math.floor(Math.random() * pool.length)];
    }

    tune(pick, true);

    var row = el.list.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(pick.id) : pick.id) + '"]');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function scanWithRetries() {
    state.scanTries = SCAN_RETRIES;
    scan();
  }

  /* The display caught up with the audio: the stream is through, so whatever
   * the machine was doing before -- tuning, or reporting a stream that would
   * not open -- is over. Reached from the `playing` event, and from the frame
   * loop when that event was late or never came. */
  function showPlaying() {
    clearTuneTimer();
    state.scanTries = 0;
    setMode('PLAY');
    if (state.current) {
      el.lcdQuality.textContent = qualityOf(state.current);
      el.lcdMeta.textContent = (state.current.genre + ' · ' + placeOf(state.current)).toUpperCase();
    }
  }

  /* ------------------------------------------------------------ VU meters */

  /* These are driven by a random walk, not by the audio itself. Reading real
   * levels needs an AnalyserNode, which needs crossOrigin="anonymous" on the
   * <audio> element, and almost no station sends the CORS headers that would
   * then require -- switching it on would silence most of the catalog. So the
   * needles dance for the look of the thing, and the stream stays playable. */
  var vuSegs = { L: [], R: [] };
  var vuLevel = { L: 0, R: 0 };

  function buildVU() {
    [['L', el.vuL], ['R', el.vuR]].forEach(function (pair) {
      var frag = document.createDocumentFragment();
      for (var i = 0; i < 16; i++) {
        var seg = document.createElement('i');
        if (i >= 13) seg.classList.add('hotseg');
        else if (i >= 10) seg.classList.add('warm');
        frag.appendChild(seg);
        vuSegs[pair[0]].push(seg);
      }
      pair[1].appendChild(frag);
    });
  }

  var vuTick = 0;
  function animateVU(now) {
    requestAnimationFrame(animateVU);
    if (now - vuTick < 60) return;   // ~16fps is plenty for LED segments
    vuTick = now;

    /* One answer for the whole machine: the CSS animations through the class,
     * the LED meters through the return value. They cannot disagree. */
    var playing = syncMotion(now);

    /* Audio moving while the display still reads TUNE (or FAIL) means the
     * `playing` event was late or never arrived. Believe the audio. */
    if (playing && el.lcdMode.textContent !== 'PLAY' && audioFlowing()) showPlaying();

    ['L', 'R'].forEach(function (ch) {
      var target = playing ? 5 + Math.random() * 11 : 0;
      vuLevel[ch] += (target - vuLevel[ch]) * (target > vuLevel[ch] ? 0.65 : 0.22);
      var lit = Math.round(vuLevel[ch]);
      vuSegs[ch].forEach(function (seg, i) { seg.classList.toggle('on', i < lit); });
    });
  }

  /* ---------------------------------------------------------- live search */

  function apiGet(path) {
    var attempt = 0;
    function go() {
      return fetch(API_HOSTS[attempt] + path, { headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .catch(function (err) {
          if (++attempt < API_HOSTS.length) return go();
          throw err;
        });
    }
    return go();
  }

  /* Turn a raw Radio Browser row into the same shape as a catalog row, using
   * the shared classifier so live results and the snapshot label alike. */
  function adopt(raw) {
    var url = raw.url_resolved || raw.url || '';
    if (!/^https:\/\//.test(url)) return null;
    if (raw.hls === 1 || /\.m3u8(\?|$)/i.test(url)) return null;
    var name = T.displayName(raw.name).slice(0, 70);
    if (!name) return null;

    var state_ = raw.countrycode === 'US' ? T.usStateCode(raw.state) : '';
    var tags = (raw.tags || '').split(',').map(function (t) { return t.trim(); })
      .filter(Boolean).slice(0, 6);

    return {
      id: raw.stationuuid,
      name: name,
      url: url,
      homepage: raw.homepage || '',
      country: raw.countrycode === 'US' ? 'United States' : T.tidy(raw.country),
      cc: raw.countrycode || '',
      state: state_,
      place: T.tidy(raw.countrycode === 'US' ? raw.state : raw.state || raw.country),
      region: T.regionFor(raw.countrycode, state_),
      genre: T.classifyGenre(tags.join(','), name),
      tags: tags,
      codec: (raw.codec || '').toUpperCase(),
      bitrate: raw.bitrate || 0,
      votes: raw.votes || 0,
      clicks: raw.clickcount || 0,
      lang: (raw.language || '').split(',')[0].trim()
    };
  }

  /* Narrow the query server-side where the API can help, then let the shared
   * filter do the rest locally -- regions like "Europe" span many countries,
   * and our genres are buckets rather than raw tags. */
  function liveQuery() {
    var f = currentFilter();
    var params = new URLSearchParams({
      hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '400'
    });

    if (f.q) params.set('name', f.q);

    if (f.region && (f.region.indexOf('US') !== -1 || f.region === 'United States (other)')) {
      params.set('countrycode', 'US');
    } else if (f.region === 'Canada') {
      params.set('countrycode', 'CA');
    }

    if (!f.q && f.genre && f.genre !== 'Variety') {
      var rule = T.GENRE_RULES.filter(function (r) { return r[0] === f.genre; })[0];
      if (rule) params.set('tag', rule[1][0]);
    }

    return 'stations/search?' + params.toString();
  }

  var liveTimer = null;
  function refreshLive() {
    if (!state.live) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () {
      state.liveBusy = true;
      el.count.textContent = 'SEARCHING radio-browser.info…';

      apiGet(liveQuery())
        .then(function (rows) {
          state.pool = rows.map(adopt).filter(Boolean);
          state.liveBusy = false;
          applyFilters();
          flushAutoScan();
        })
        .catch(function () {
          state.liveBusy = false;
          state.live = false;
          el.liveMode.checked = false;
          state.pool = CATALOG.stations;
          applyFilters();
          el.count.textContent = 'LIVE SEARCH UNREACHABLE — USING BUILT-IN CATALOG';
          flushAutoScan();
        });
    }, 260);
  }

  function onFilterChange() {
    if (state.live) refreshLive();
    else applyFilters();
    saveNow();
  }

  /* ------------------------------------------------------------- controls */

  function populateSelects() {
    var genreCounts = {}, regionCounts = {};
    CATALOG.stations.forEach(function (s) {
      genreCounts[s.genre] = (genreCounts[s.genre] || 0) + 1;
      regionCounts[s.region] = (regionCounts[s.region] || 0) + 1;
    });

    (CATALOG.genres || []).forEach(function (g) {
      var o = document.createElement('option');
      o.value = g;
      o.textContent = g + ' (' + (genreCounts[g] || 0) + ')';
      el.genre.appendChild(o);
    });

    (CATALOG.regions || []).forEach(function (r) {
      var o = document.createElement('option');
      o.value = r;
      o.textContent = r + ' (' + (regionCounts[r] || 0) + ')';
      el.region.appendChild(o);
    });
  }

  function buildTicks() {
    var frag = document.createDocumentFragment();
    for (var f = 88; f <= 108; f++) {
      var tick = document.createElement('i');
      if (f % 2 === 0) {
        tick.className = 'major';
        tick.dataset.n = String(f);
      }
      frag.appendChild(tick);
    }
    el.ticks.appendChild(frag);
  }

  function setVolume(v) {
    el.player.volume = Math.max(0, Math.min(1, v / 100));
    el.volOut.textContent = v;
    saveNow();
  }

  /* ------------------------------------------------------------- session */

  /* Everything worth coming back to: what is on the dial, how loud, and the
   * filters that decide what NEXT and SCAN will reach.  See js/save.js. */
  function sessionSnapshot() {
    return {
      station: state.current,
      volume: Number(el.volume.value),
      genre: el.genre.value,
      region: el.region.value,
      q: el.search.value,
      sort: el.sort.value,
      live: state.live,
      shown: state.shown
    };
  }

  /* Saved on every change as well as on the timer, so a tab closed one
   * second after tuning still comes back to that station. */
  function saveNow() {
    if (autosave) autosave.flush();
  }

  /* Restores the controls, and answers with the station that was tuned so
   * that boot can put it on the dial once the list around it exists. */
  function restoreSession() {
    var session = RADIO_SAVE.loadSession();
    if (!session) { el.volume.value = 80; setVolume(80); return null; }

    el.volume.value = session.volume;
    el.player.volume = Math.max(0, Math.min(1, session.volume / 100));
    el.volOut.textContent = session.volume;

    if (session.genre && hasOption(el.genre, session.genre)) el.genre.value = session.genre;
    if (session.region && hasOption(el.region, session.region)) el.region.value = session.region;
    if (session.sort && hasOption(el.sort, session.sort)) el.sort.value = session.sort;
    el.search.value = session.q;

    /* Live mode is a network pool, so it is put back as a checkbox here and
     * refreshed by boot rather than fetched from inside a restore. */
    el.liveMode.checked = session.live;
    state.live = session.live;
    if (session.shown > PAGE_SIZE) state.shown = Math.min(session.shown, PAGE_SIZE * 20);

    return session.station;
  }

  /* A genre or region that the catalog no longer has - it is rebuilt from a
   * live database - must not leave a select showing something it cannot
   * filter by. */
  function hasOption(select, value) {
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) return true;
    }
    return false;
  }

  /* ----------------------------------------------------------------- url */

  /* The hash carries the station (`#s=<id>`) and may carry options beside it.
   * They are read the same way whether they were joined with an `&` or a `?`:
   * `#s=<id>?play=auto` is what a person actually types when appending an
   * option to a link they were handed, and a link that has to survive being
   * pasted into a cast dialog is no place to be pedantic about which
   * separator a fragment is supposed to use. */
  function hashParams() {
    var out = {};
    (location.hash || '').replace(/^#/, '').split(/[?&]/).forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      var k = eq === -1 ? pair : pair.slice(0, eq);
      var v = eq === -1 ? '' : pair.slice(eq + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); }
      catch (e) { out[k] = v; }   // a stray % is not worth losing the link over
    });
    return out;
  }

  /* Either side of the '#': `?play=auto` before it, `play=auto` inside it. */
  function urlParam(name) {
    var inHash = hashParams()[name];
    if (inHash !== undefined) return inHash;
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }

  /* `auto` is the documented spelling; the others are what people type when
   * they are guessing, and a bare `play` with no value counts too. */
  var AUTOPLAY_WORDS = { auto: 1, '1': 1, 'true': 1, yes: 1, on: 1, '': 1 };

  function autoplayRequested() {
    var v = urlParam('play');
    return v != null && AUTOPLAY_WORDS[String(v).toLowerCase()] === 1;
  }

  function stationFromHash() {
    var id = hashParams().s;
    if (!id) return null;
    return CATALOG.stations.filter(function (s) { return s.id === id; })[0] || null;
  }

  /* A `play=auto` link that names no station wants the machine to pick one --
   * which is SCAN. In live mode the pool is still on its way from the network
   * when boot finishes, so the scan waits for it to land. */
  function flushAutoScan() {
    if (!pendingAutoScan) return;
    pendingAutoScan = false;
    scanWithRetries();
  }

  function wire() {
    el.btnPlay.addEventListener('click', function () { press(el.btnPlay); toggle(); });
    el.btnStop.addEventListener('click', function () { press(el.btnStop); stop(); });
    el.btnPrev.addEventListener('click', function () { press(el.btnPrev); step(-1); });
    el.btnNext.addEventListener('click', function () { press(el.btnNext); step(1); });
    el.btnScan.addEventListener('click', function () { press(el.btnScan); scanWithRetries(); });
    el.btnScan2.addEventListener('click', scanWithRetries);

    el.btnReset.addEventListener('click', function () {
      el.genre.value = '';
      el.region.value = '';
      el.search.value = '';
      el.sort.value = 'popular';
      onFilterChange();
    });

    el.genre.addEventListener('change', onFilterChange);
    el.region.addEventListener('change', onFilterChange);
    el.sort.addEventListener('change', function () { applyFilters(true); saveNow(); });
    el.search.addEventListener('input', function () {
      if (state.live) refreshLive();
      else applyFilters();
    });

    el.liveMode.addEventListener('change', function () {
      state.live = el.liveMode.checked;
      if (state.live) {
        refreshLive();
      } else {
        state.pool = CATALOG.stations;
        applyFilters();
      }
      saveNow();
    });

    el.btnMore.addEventListener('click', function () {
      state.shown += PAGE_SIZE;
      render();
      saveNow();
    });

    el.volume.addEventListener('input', function () { setVolume(Number(el.volume.value)); });

    /* audio element -> display */
    el.player.addEventListener('playing', showPlaying);
    el.player.addEventListener('waiting', function () {
      if (!el.player.paused) el.lcdQuality.textContent = 'BUFFERING…';
    });
    el.player.addEventListener('error', function () {
      if (el.player.src) failStation('SIGNAL LOST — TRY THE ↗ LINK');
    });
    el.player.addEventListener('stalled', function () {
      if (!el.player.paused) el.lcdQuality.textContent = 'STALLED…';
    });

    /* keyboard: the boombox should be playable without the mouse */
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Match on e.key first: not every source populates e.code ("Spacebar" is
      // the legacy value some browsers still send for the space bar).
      var space = e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space';
      if (space) { e.preventDefault(); press(el.btnPlay); toggle(); }
      else if (e.key === 'r' || e.key === 'R') { press(el.btnScan); scanWithRetries(); }
      else if (e.key === 'ArrowRight') { press(el.btnNext); step(1); }
      else if (e.key === 'ArrowLeft') { press(el.btnPrev); step(-1); }
      else if (e.key === 's' || e.key === 'S') { press(el.btnStop); stop(); }
    });

    /* re-measure the marquee when the display changes width */
    window.addEventListener('resize', function () {
      if (state.current) fitName(state.current.name.toUpperCase());
    });
  }

  /* ------------------------------------------------------------------ boot */

  function init() {
    if (!CATALOG.stations.length) {
      el.lcdName.textContent = 'NO CATALOG';
      el.lcdMeta.textContent = 'data/stations.js FAILED TO LOAD';
      el.count.textContent = '0 STATIONS';
      return;
    }

    buildTicks();
    buildVU();
    populateSelects();

    /* The controls come back before the list is built, so the filters the
     * session restored are the ones applyFilters() reads. */
    var last = restoreSession();
    wire();

    if (state.live) refreshLive();             // the pool was the network
    else applyFilters(true);                   // keep the restored page size
    requestAnimationFrame(animateVU);

    autosave = RADIO_SAVE.autosave(sessionSnapshot);

    autoplayWanted = autoplayRequested();

    /* A link that names a station beats the session: someone opening a
     * shared #s= link wants that station, not the one they left. */
    var station = stationFromHash() || last;
    if (station) {
      /* Cued, never played -- unless the link asked for sound. A tab that
       * starts making noise on its own is a bad neighbour; a link that says
       * `play=auto` is someone asking for exactly that, on purpose. */
      tune(station, autoplayWanted);
      if (!autoplayWanted) el.lcdMeta.textContent = 'PRESS PLAY';
    } else if (autoplayWanted) {
      if (state.live) pendingAutoScan = true;   // wait for the network pool
      else scanWithRetries();
    } else {
      setMode('STOP');
      el.lcdQuality.textContent = CATALOG.count.toLocaleString() + ' STATIONS';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
