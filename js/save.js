/* ============================================================================
   5RADIO — remembering where you left the dial
   ----------------------------------------------------------------------------
   A port of 5Space's `js/save.js`, kept deliberately in its shape and its
   vocabulary: one versioned JSON blob in localStorage, fields listed by hand
   rather than copied wholesale, every storage touch inside a try, and a
   version guard that ignores a blob it does not recognise instead of half
   restoring it.  The same pair of functions - serialize and deserialize - and
   the same names around them: hasSave, loadSession, deleteSave, saveInfo.

   What a radio has to remember is smaller than a roguelike run, so the parts
   of 5Space that exist to fight size - run-length encoding, tuple-packed
   greens - have no counterpart here and were left behind.  What did come
   across is the autosave: a heartbeat, plus `beforeunload`, plus
   `visibilitychange`, because a tab that is closed is very often a tab that
   was never unloaded politely, and on a phone `beforeunload` may not fire at
   all.

   The station is stored whole rather than as an id.  A station tuned from the
   live search does not exist in `data/stations.js` at all, so an id alone
   would restore to nothing - and a catalog that is rebuilt overnight can drop
   the station under you.  Eighteen fields is a rounding error next to a 2,884
   station catalog.
   ========================================================================== */

(function () {
  'use strict';

  var save = {};
  window.RADIO_SAVE = save;

  var SAVE_KEY = '5radio.session.v1';
  var LEGACY_VOLUME_KEY = '5radio.volume';   /* what the volume used before */
  var SAVE_VERSION = 1;

  var AUTOSAVE_SECONDS = 20;                 /* the interval the family uses */

  save.SAVE_KEY = SAVE_KEY;
  save.SAVE_VERSION = SAVE_VERSION;
  save.AUTOSAVE_SECONDS = AUTOSAVE_SECONDS;

  /* ------------------------------------------------------------------ */
  /* the station                                                        */
  /* ------------------------------------------------------------------ */

  /* Listed rather than copied, so that a stray field the live search picked
     up from the API - or anything the app hangs off a station at runtime -
     can never end up in the blob by accident.  These are exactly the fields
     `adopt` builds and `data/stations.js` ships. */
  var STATION_FIELDS = ['id', 'name', 'url', 'homepage', 'country', 'cc', 'state',
                        'place', 'region', 'genre', 'tags', 'codec', 'bitrate',
                        'votes', 'clicks', 'lang'];

  save.packStation = function (s) {
    if (!s || !s.url) return null;
    var out = {};
    STATION_FIELDS.forEach(function (k) {
      if (s[k] === undefined || s[k] === null || s[k] === '') return;
      out[k] = k === 'tags' ? (s.tags || []).slice(0, 6) : s[k];
    });
    return out;
  };

  /* A station comes back with every field the app expects to read, because
     the renderer indexes `tags` and prints `place` without asking first. */
  save.unpackStation = function (data) {
    if (!data || !data.url || !data.id) return null;
    return {
      id: data.id,
      name: data.name || 'Unknown station',
      url: data.url,
      homepage: data.homepage || '',
      country: data.country || '',
      cc: data.cc || '',
      state: data.state || '',
      place: data.place || '',
      region: data.region || '',
      genre: data.genre || 'Variety',
      tags: data.tags || [],
      codec: data.codec || '',
      bitrate: data.bitrate || 0,
      votes: data.votes || 0,
      clicks: data.clicks || 0,
      lang: data.lang || ''
    };
  };

  /* ------------------------------------------------------------------ */
  /* serialisation                                                      */
  /* ------------------------------------------------------------------ */

  /* `session` is the app's own snapshot: the station on the dial, the volume,
     and the filters that decide what NEXT and SCAN will find.  Restoring to a
     station but not to the list it came from would leave the arrow buttons
     walking a different set of stations than the one on screen. */
  save.serialize = function (session) {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      station: save.packStation(session.station),
      volume: clampVolume(session.volume),
      genre: session.genre || '',
      region: session.region || '',
      q: session.q || '',
      sort: session.sort || 'popular',
      live: !!session.live,
      shown: session.shown || 0
    };
  };

  save.deserialize = function (data) {
    return {
      station: save.unpackStation(data.station),
      volume: clampVolume(data.volume),
      genre: data.genre || '',
      region: data.region || '',
      q: data.q || '',
      sort: data.sort || 'popular',
      live: !!data.live,
      shown: data.shown || 0,
      savedAt: data.savedAt || 0
    };
  };

  function clampVolume(v) {
    var n = Number(v);
    if (!isFinite(n)) return 80;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  /* ------------------------------------------------------------------ */
  /* storage                                                            */
  /* ------------------------------------------------------------------ */

  save.hasSave = function () {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  };

  save.saveSession = function (session) {
    if (!session) return false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save.serialize(session)));
      return true;
    } catch (e) {
      /* A radio has nowhere good to shout about this, and a failed save is
         not worth interrupting playback for.  The console is enough. */
      console.warn('5RADIO: could not save the session:', e);
      return false;
    }
  };

  save.loadSession = function () {
    try {
      var blob = localStorage.getItem(SAVE_KEY);
      if (!blob) return migrateLegacy();
      var data = JSON.parse(blob);
      if (data.version !== SAVE_VERSION) {
        console.warn('5RADIO: session version mismatch, starting fresh.');
        return null;
      }
      return save.deserialize(data);
    } catch (e) {
      console.error('5RADIO: could not read the saved session:', e);
      return null;
    }
  };

  /* Before this file there was one loose key holding the volume as a bare
     string.  Someone who had set it should not have it forgotten because the
     saving got better, so it is read once and folded into the session. */
  function migrateLegacy() {
    try {
      var vol = localStorage.getItem(LEGACY_VOLUME_KEY);
      if (vol === null) return null;
      return save.deserialize({ volume: vol });
    } catch (e) {
      return null;
    }
  }

  save.deleteSave = function () {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(LEGACY_VOLUME_KEY);
    } catch (e) { /* ignore */ }
  };

  /* What was left on the dial, without restoring it - for anything that wants
     to describe the saved session rather than resume it. */
  save.saveInfo = function () {
    try {
      var blob = localStorage.getItem(SAVE_KEY);
      if (!blob) return null;
      var data = JSON.parse(blob);
      if (!data.station) return null;
      return {
        name: data.station.name,
        genre: data.station.genre,
        place: data.station.place,
        savedAt: data.savedAt
      };
    } catch (e) {
      return null;
    }
  };

  /* ------------------------------------------------------------------ */
  /* autosave                                                           */
  /* ------------------------------------------------------------------ */

  /* `snapshot` is called for a fresh session whenever one is wanted.  Three
     triggers, because no one of them is reliable on its own:

       - a heartbeat, for the tab that stays open all afternoon;
       - `beforeunload`, for the ordinary close;
       - `visibilitychange`, for the phone that is switched away from and
         killed in the background, where `beforeunload` never arrives.

     Returns a `flush` so the app can also save the moment something actually
     changes, which is what makes closing the tab immediately after tuning
     still come back to the right station. */
  save.autosave = function (snapshot) {
    var timer = null;

    function flush() {
      var session = snapshot();
      if (session) save.saveSession(session);
    }

    timer = setInterval(flush, AUTOSAVE_SECONDS * 1000);

    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);

    return {
      flush: flush,
      stop: function () { if (timer) { clearInterval(timer); timer = null; } }
    };
  };

})();
