/* ============================================================================
   5RADIO — station taxonomy
   ----------------------------------------------------------------------------
   Radio Browser stations carry free-form tags ("classic rock", "musica",
   "80's", "otr") and a free-form state field ("Los Angeles CA", "Calfornia",
   "Detroit"). This file turns both into the fixed set of genres and regions the
   dials offer.

   Loaded two ways on purpose, so the offline snapshot and the live search can
   never drift apart:
     - the browser loads it as a plain <script>  -> window.RADIO_TAXONOMY
     - tools/build-catalog.mjs require()s it     -> module.exports
   tools/check-taxonomy.mjs asserts the shipped snapshot still agrees with it.
   ========================================================================== */

(function (root) {
  'use strict';

  /* Tag -> genre. First match wins, so specific formats sit above the
   * catch-alls ("music", "radio", "pop"). */
  var GENRE_RULES = [
    ['News & Talk',  ['news', 'talk', 'talk radio', 'current affairs', 'politics', 'information', 'noticias', 'public radio', 'npr', 'infos', 'old time radio', 'otr', 'radio shows', 'comedy', 'drama', 'audiobook', 'spoken word']],
    ['Sports',       ['sport', 'sports', 'football', 'baseball', 'basketball', 'hockey', 'soccer', 'espn']],
    ['Classical',    ['classical', 'klassik', 'clasica', 'classique', 'opera', 'symphony', 'baroque', 'chamber music']],
    ['Jazz',         ['jazz', 'bebop', 'swing', 'big band']],
    ['Blues',        ['blues']],
    ['Metal',        ['metal', 'hardcore', 'thrash', 'doom', 'punk']],
    ['Rock',         ['rock', 'alternative', 'grunge', 'classic rock', 'album rock']],
    ['Indie',        ['indie', 'college', 'shoegaze', 'lo-fi', 'lofi', 'freeform', 'eclectic', 'underground']],
    ['Hip Hop',      ['hip hop', 'hip-hop', 'hiphop', 'rap', 'trap', 'urban']],
    ['R&B and Soul', ['r&b', 'rnb', 'soul', 'funk', 'motown', 'quiet storm']],
    ['Electronic',   ['electronic', 'techno', 'house', 'trance', 'edm', 'drum and bass', 'dnb', 'dubstep', 'downtempo', 'breakbeat', 'electro', 'idm', 'lounge', 'club', 'dance']],
    ['Ambient',      ['ambient', 'chillout', 'chill', 'space music', 'new age', 'meditation', 'relax', 'sleep', 'drone']],
    ['Country',      ['country', 'bluegrass', 'americana', 'honky tonk']],
    ['Folk',         ['folk', 'singer-songwriter', 'acoustic', 'celtic', 'traditional', 'roots']],
    ['Reggae',       ['reggae', 'dancehall', 'ska', 'dub']],
    ['Latin',        ['latin', 'latino', 'salsa', 'bachata', 'merengue', 'cumbia', 'reggaeton', 'tango', 'ranchera', 'banda', 'sertanejo', 'mpb', 'samba', 'bossa nova', 'grupera', 'tropical', 'vallenato', 'regional mexicano']],
    ['Oldies',       ['oldies', '50s', '60s', '70s', '80s', '90s', "50's", "60's", "70's", "80's", "90's", 'nostalgia', 'retro', 'schlager', 'classic hits', 'yacht rock', 'doo wop', 'evergreen', 'flashback']],
    ['World',        ['world', 'african', 'afro', 'arabic', 'balkan', 'bollywood', 'desi', 'k-pop', 'j-pop', 'kpop', 'jpop', 'anime', 'turkish', 'greek', 'chinese', 'tamil', 'ethnic', 'flamenco', 'fado']],
    ['Religious',    ['christian', 'gospel', 'religion', 'religious', 'catholic', 'islam', 'quran', 'church', 'worship', 'jewish', 'spiritual', 'praise', 'bible']],
    ['Pop',          ['pop', 'top 40', 'top40', 'hits', 'charts', 'adult contemporary', 'hot ac', 'contemporary', 'variety']]
  ];

  var US_REGIONS = {
    'Northeast US': ['CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'NJ', 'NY', 'PA'],
    'Southeast US': ['DE', 'FL', 'GA', 'MD', 'NC', 'SC', 'VA', 'DC', 'WV', 'AL', 'KY', 'MS', 'TN', 'AR', 'LA'],
    'Midwest US':   ['IL', 'IN', 'MI', 'OH', 'WI', 'IA', 'KS', 'MN', 'MO', 'NE', 'ND', 'SD'],
    'Southwest US': ['AZ', 'NM', 'OK', 'TX'],
    'West US':      ['AK', 'CA', 'CO', 'HI', 'ID', 'MT', 'NV', 'OR', 'UT', 'WA', 'WY']
  };

  var STATE_NAMES = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
    hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
    kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
    massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
    missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
    oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
    virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
    wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC',
    /* misspellings and abbreviations that actually occur in the source data */
    calfornia: 'CA', virgina: 'VA', 'la.': 'LA', 'penn.': 'PA', 'mass.': 'MA'
  };

  var WORLD_REGIONS = {
    'Canada':                 ['CA'],
    'UK and Ireland':         ['GB', 'IE'],
    'Europe':                 ['FR', 'DE', 'NL', 'BE', 'IT', 'ES', 'PT', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'IS', 'PL', 'CZ', 'GR', 'RO', 'HU', 'RU', 'UA'],
    'Latin America':          ['MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'JM', 'PR'],
    'Asia and Pacific':       ['JP', 'KR', 'IN', 'PH', 'ID', 'TH', 'VN', 'CN', 'TW', 'MY', 'SG', 'AU', 'NZ'],
    'Africa and Middle East': ['IL', 'TR', 'AE', 'EG', 'ZA', 'NG', 'KE', 'MA']
  };

  /* Geographic, not alphabetical: US first, then outward. */
  var REGION_ORDER = [
    'Northeast US', 'Southeast US', 'Midwest US', 'Southwest US', 'West US',
    'United States (other)', 'Canada', 'UK and Ireland', 'Europe',
    'Latin America', 'Asia and Pacific', 'Africa and Middle East', 'Rest of World'
  ];

  var stateToRegion = {};
  Object.keys(US_REGIONS).forEach(function (region) {
    US_REGIONS[region].forEach(function (s) { stateToRegion[s] = region; });
  });

  var countryToRegion = {};
  Object.keys(WORLD_REGIONS).forEach(function (region) {
    WORLD_REGIONS[region].forEach(function (c) { countryToRegion[c] = region; });
  });

  function tidy(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Word-boundary match, so "dub" cannot eat "Dublin" and "rap" cannot eat
   * "rapid". Compiled patterns are cached: this runs 3,000+ times on load. */
  var reCache = {};
  function hasWord(hay, word) {
    var re = reCache[word] || (reCache[word] = new RegExp('(^|[^a-z0-9])' + escapeRe(word) + '([^a-z0-9]|$)'));
    return re.test(hay);
  }

  function classifyGenre(tags, name) {
    var hay = ((tags || '') + ' ' + (name || '')).toLowerCase();
    for (var i = 0; i < GENRE_RULES.length; i++) {
      var keys = GENRE_RULES[i][1];
      for (var k = 0; k < keys.length; k++) {
        if (hasWord(hay, keys[k])) return GENRE_RULES[i][0];
      }
    }
    return 'Variety';
  }

  function usStateCode(state) {
    var s = tidy(state);
    if (!s) return '';
    var tail = s.match(/\b([A-Z]{2})\b\s*$/);            // "Los Angeles CA"
    if (tail && stateToRegion[tail[1]]) return tail[1];
    var named = STATE_NAMES[s.toLowerCase()];            // "California"
    if (named) return named;
    var lower = s.toLowerCase();
    var names = Object.keys(STATE_NAMES);
    for (var i = 0; i < names.length; i++) {             // "Austin, Texas"
      if (lower.indexOf(names[i]) !== -1) return STATE_NAMES[names[i]];
    }
    return '';
  }

  function regionFor(countryCode, stateCode) {
    if (countryCode === 'US') return stateToRegion[stateCode] || 'United States (other)';
    return countryToRegion[countryCode] || 'Rest of World';
  }

  /* Radio Browser registers each quality of a stream as its own entry:
   *   "SomaFM Groove Salad (128k MP3)"     "SmoothJazz.com 64k aac+"
   *   "KEXP 90.3 Seattle, WA (AAC 160K)"   "Radio X - 128 kbps mp3"
   * Strip the quality so the variants collapse onto one dial position.
   *
   * Every pattern below requires a bitrate ("128k") or a bracketed codec, so
   * numbers that are part of the identity survive: "KEXP 90.3", "Radio 538",
   * "181.FM" and "KJazz 88.1 HD2" all come through untouched.
   */
  var CODEC = '(?:mp3|aac\\+?|aacp|ogg|opus|flac|wma)';
  var RATE = '\\d{2,3}\\s*k(?:bps)?';
  /* Wrap before making optional: RATE already ends in "?", so a bare trailing
   * "?" would attach to that token instead of to the whole group. */
  var OPT_CODEC = '(?:' + CODEC + ')?';
  /* Inside brackets a bitrate can drop the "k" ("[MP3 320]"), which is only
   * safe to strip because a codec is sitting right next to it. The trailing
   * pattern still demands the "k", so "Radio Nova 100" keeps its number. */
  var OPT_RATE_LOOSE = '(?:\\d{2,3}\\s*k?(?:bps)?)?';
  var QUALITY_PATTERNS = [
    // bracketed, either order: (128k MP3) / (AAC 160K) / [MP3 320] / [mp3]
    new RegExp('[([]\\s*(?:' + RATE + '\\s*' + OPT_CODEC + '|' + CODEC + '\\s*' + OPT_RATE_LOOSE + ')\\s*[)\\]]', 'gi'),
    // trailing, either order, with or without a dash: - 128 kbps mp3 / 64k aac+
    new RegExp('[\\s\\-–|]+(?:' + RATE + '\\s*' + OPT_CODEC + '|' + CODEC + '\\s*' + RATE + ')\\s*$', 'gi')
  ];

  function displayName(name) {
    var out = String(name || '');
    for (var i = 0; i < QUALITY_PATTERNS.length; i++) {
      out = out.replace(QUALITY_PATTERNS[i], ' ');
    }
    return tidy(out.replace(/\s*[-–|,]\s*$/, '')) || tidy(name);
  }

  /* Once displayName() collapses the quality suffixes, several rows can claim
   * the same dial position. Keep one: MP3 over AAC because every browser can
   * decode it, then the fatter pipe, then the record people actually click. */
  function preferVariant(a, b) {
    var mp3 = function (s) { return s.codec === 'MP3' ? 1 : 0; };
    if (mp3(a) !== mp3(b)) return mp3(a) > mp3(b) ? a : b;
    if (a.bitrate !== b.bitrate) return a.bitrate > b.bitrate ? a : b;
    return (a.clicks || 0) >= (b.clicks || 0) ? a : b;
  }

  /* Two rows are the same station when the cleaned name, country and state
   * match. State is part of it on purpose: a "KISS FM" in Texas and one in
   * California are genuinely different stations. */
  function identity(s) {
    return s.name.toLowerCase() + '|' + s.cc + '|' + s.state;
  }

  /* Collapse a list of stations down to one row per station.
   *
   * Radio Browser often holds the same station several times: once per quality
   * tier, and sometimes once with the state filled in and once without. An
   * unknown state means "not recorded", not "somewhere else" -- so when every
   * located copy of a name agrees on one state, that state is copied onto the
   * stateless copies before deduping. They then collapse normally, and the
   * recovered state also puts them on the right region dial.
   *
   * A name that genuinely appears in two different states (a "KISS FM" in both
   * Texas and California) has no single answer, so those are left apart.
   */
  function mergeIdentities(stations) {
    var statesByName = {};
    stations.forEach(function (s) {
      if (!s.state) return;
      var key = s.name.toLowerCase() + '|' + s.cc;
      (statesByName[key] = statesByName[key] || {})[s.state] = s;
    });

    stations.forEach(function (s) {
      if (s.state) return;
      var found = statesByName[s.name.toLowerCase() + '|' + s.cc];
      if (!found) return;
      var codes = Object.keys(found);
      if (codes.length !== 1) return;      // ambiguous: leave it alone
      s.state = codes[0];
      s.place = s.place || found[codes[0]].place;
      s.region = regionFor(s.cc, s.state);
    });

    var kept = {};
    var order = [];
    stations.forEach(function (s) {
      var key = identity(s);
      if (!(key in kept)) { kept[key] = s; order.push(key); }
      else kept[key] = preferVariant(kept[key], s);
    });

    return order.map(function (k) { return kept[k]; });
  }

  var TAXONOMY = {
    GENRE_RULES: GENRE_RULES,
    US_REGIONS: US_REGIONS,
    STATE_NAMES: STATE_NAMES,
    WORLD_REGIONS: WORLD_REGIONS,
    REGION_ORDER: REGION_ORDER,
    genres: GENRE_RULES.map(function (r) { return r[0]; }).concat(['Variety']).sort(),
    tidy: tidy,
    classifyGenre: classifyGenre,
    usStateCode: usStateCode,
    regionFor: regionFor,
    displayName: displayName,
    preferVariant: preferVariant,
    identity: identity,
    mergeIdentities: mergeIdentities
  };

  root.RADIO_TAXONOMY = TAXONOMY;
  if (typeof module !== 'undefined' && module.exports) module.exports = TAXONOMY;
})(typeof globalThis !== 'undefined' ? globalThis : this);
