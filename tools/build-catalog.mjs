/*
 * 5RADIO catalog builder
 * -----------------------
 * Snapshots a verified, offline-capable station catalog from the Radio Browser
 * open database (https://www.radio-browser.info/), the community-maintained
 * index of internet radio streams.
 *
 * Only stations that pass Radio Browser's own liveness check are kept, and only
 * plain HTTPS progressive streams -- no HLS, and no http:// (mixed content gets
 * blocked outright when the site is served over https).
 *
 * Genre and region come from js/taxonomy.js, the same classifier the page uses
 * for live search, so the snapshot and live results are always labelled alike.
 *
 * Run:  node tools/build-catalog.mjs   (then: node tools/prune-dead.mjs)
 * Out:  data/stations.json, data/stations.js
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = createRequire(import.meta.url)('../js/taxonomy.js');

const API = 'https://de1.api.radio-browser.info/json';
const UA = '5radio-catalog-builder/1.0';

/* ---------------------------------------------------------------- fetching */

async function api(path) {
  const res = await fetch(`${API}/${path}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

const q = (params) =>
  'stations/search?' +
  new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', ...params });

/* Countries to sweep. The US is deliberately over-sampled: the brief asks for a
 * US-first directory, with the rest of the world as the long tail. */
const COUNTRY_QUOTA = {
  US: 2000, GB: 220, CA: 180, IE: 90, AU: 160, NZ: 60,
  FR: 150, DE: 200, NL: 120, BE: 80, IT: 140, ES: 140, PT: 80, CH: 70, AT: 70,
  SE: 90, NO: 70, DK: 70, FI: 70, IS: 25, PL: 110, CZ: 60, GR: 80, RO: 70, HU: 50,
  BR: 160, MX: 140, AR: 110, CL: 70, CO: 80, PE: 60,
  JP: 90, KR: 45, IN: 130, PH: 70, ID: 70, TH: 45, VN: 35, CN: 35, TW: 35, MY: 40, SG: 30,
  IL: 60, TR: 70, AE: 40, EG: 35, ZA: 70, NG: 45, KE: 40, MA: 35,
  RU: 90, UA: 60, JM: 30,
};

/* Stations named in the Wikipedia "List of Internet radio stations" article
 * that the site should be able to surface by name. Looked up individually so a
 * clickcount sweep can't drop them. */
const WIKIPEDIA_PICKS = [
  'SomaFM', 'Radio Paradise', 'KEXP', 'WFMU', 'WNYC', 'WQXR', 'KCRW', 'WXPN',
  'WFUV', 'NPR', 'KUVO', 'KFJC', 'KDVS', 'KZSC', 'WREK', 'WORT', 'KGNU',
  'WERS', 'KTRU', 'WKCR', 'WRPI', 'KTUH', 'WEFT', 'KFAI', 'WCPE', 'KNHC',
  'BBC Radio', 'FIP', 'France Inter', 'France Culture', 'France Musique',
  'RTE Radio', 'RTE 2fm', 'RTE lyric', 'Rai Radio', 'YleX', 'Yle Radio Suomi',
  'Sveriges Radio', 'Danmarks Radio', 'Deutsche Welle', 'Radio Nova',
  'Radio Popolare', 'Triple J', 'ABC NewsRadio', 'RTRFM', 'FBi Radio',
  'Radio New Zealand', 'Voice of America', 'Vatican Radio', 'Radio Caroline',
  'KNAC', 'Radioseven', 'Frequence3', 'RauteMusik', 'AccuRadio', 'Radio Free Brooklyn',
  'Amazing Radio', 'Dandelion Radio', 'Radio Regent', 'CKUA', 'CJRU', 'CIUT',
  'Boxout', 'oWOW', 'Groovera', 'Radio Maria', 'K-LOVE', 'AKTINA',
];

/* ------------------------------------------------------------- normalising */

function normalise(s) {
  const url = s.url_resolved || s.url || '';
  if (!url.startsWith('https://')) return null;               // would be blocked as mixed content
  if (s.hls === 1 || /\.m3u8(\?|$)/i.test(url)) return null;  // needs an HLS library
  if (s.lastcheckok !== 1) return null;                       // failed Radio Browser's own check
  if (!T.tidy(s.name)) return null;

  const state = s.countrycode === 'US' ? T.usStateCode(s.state) : '';

  /* Trim name and tags FIRST, then classify from the trimmed values. The row
   * only ships those, so labelling from anything richer would produce a genre
   * nothing in the file can explain -- and live search, which classifies from
   * the same two fields, would disagree. tools/check-taxonomy.mjs enforces it. */
  const name = T.displayName(s.name).slice(0, 70);
  const tags = (s.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6);

  return {
    id: s.stationuuid,
    name,
    url,
    homepage: s.homepage || '',
    country: s.countrycode === 'US' ? 'United States' : T.tidy(s.country),
    cc: s.countrycode || '',
    state,
    place: T.tidy(s.countrycode === 'US' ? s.state : s.state || s.country),
    region: T.regionFor(s.countrycode, state),
    genre: T.classifyGenre(tags.join(','), name),
    tags,
    codec: (s.codec || '').toUpperCase(),
    bitrate: s.bitrate || 0,
    votes: s.votes || 0,
    clicks: s.clickcount || 0,
    lang: (s.language || '').split(',')[0].trim(),
  };
}

/* -------------------------------------------------------------------- main */

const raw = new Map();
const add = (list) => {
  for (const s of list) if (s && s.stationuuid) raw.set(s.stationuuid, s);
};

console.log('Sweeping countries...');
for (const [cc, limit] of Object.entries(COUNTRY_QUOTA)) {
  try {
    const list = await api(q({ countrycode: cc, limit: String(limit) }));
    add(list);
    process.stdout.write('  ' + cc + ':' + list.length);
  } catch {
    process.stdout.write('  ' + cc + ':ERR');
  }
}

console.log('\n\nLooking up Wikipedia-listed stations...');
for (const name of WIKIPEDIA_PICKS) {
  try {
    add(await api(q({ name, limit: '25' })));
  } catch { /* a miss on one name is not fatal */ }
}

console.log('Raw stations: ' + raw.size);

/* Dedupe on stream URL first, then hand the rest to the shared identity merge
 * in js/taxonomy.js, so the builder and tools/relabel.mjs collapse variants
 * identically. */
const seenUrl = new Set();
const rows = [];
for (const s of raw.values()) {
  const n = normalise(s);
  if (!n) continue;
  if (seenUrl.has(n.url)) continue;
  seenUrl.add(n.url);
  rows.push(n);
}

const stations = T.mergeIdentities(rows).sort(
  (a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name)
);

const tally = (key) =>
  Object.fromEntries(
    Object.entries(
      stations.reduce((m, s) => {
        m[s[key]] = (m[s[key]] || 0) + 1;
        return m;
      }, {})
    ).sort((a, b) => b[1] - a[1])
  );

const present = tally('region');

const out = {
  source: 'Radio Browser (https://www.radio-browser.info/) - community database of internet radio streams',
  seeded_from: 'https://en.wikipedia.org/wiki/List_of_Internet_radio_stations',
  built: new Date().toISOString().slice(0, 10),
  count: stations.length,
  genres: Object.keys(tally('genre')).sort(),
  regions: T.REGION_ORDER.filter((r) => present[r]),
  stations,
};

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'stations.json'), JSON.stringify(out));
/* Also emit the catalog as a plain script. A file:// page cannot fetch() a
 * sibling JSON file (CORS treats it as a cross-origin request), but it can
 * always load a <script>. That is what makes double-clicking index.html work. */
writeFileSync(
  join(ROOT, 'data', 'stations.js'),
  '/* Generated by tools/build-catalog.mjs on ' + out.built + '. Do not edit by hand. */\n' +
    'window.RADIO_CATALOG = ' + JSON.stringify(out) + ';\n'
);

console.log('\nKept ' + stations.length + ' stations -> data/stations.json + data/stations.js');
console.log('By genre :', tally('genre'));
console.log('By region:', present);
console.log('\nNext: node tools/prune-dead.mjs   (probes every stream, drops the dead ones)');
