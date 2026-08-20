/*
 * Assert the shipped catalog still agrees with js/taxonomy.js.
 *
 * The snapshot in data/ was labelled at build time; the page relabels live
 * search results in the browser using the same file. If the two ever disagree,
 * a station would sit under one genre offline and a different one live. This
 * re-runs the classifier over the shipped rows and reports any drift.
 *
 * Run:  node tools/check-taxonomy.mjs      (no network, ~1s)
 * Exit: 0 = in sync, 1 = drift found
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = createRequire(import.meta.url)('../js/taxonomy.js');
const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'stations.json'), 'utf8'));

const drift = [];
for (const s of catalog.stations) {
  const genre = T.classifyGenre(s.tags.join(','), s.name);
  const region = T.regionFor(s.cc, s.state);
  if (genre !== s.genre) drift.push(`genre  ${s.name}: catalog=${s.genre} taxonomy=${genre}`);
  if (region !== s.region) drift.push(`region ${s.name}: catalog=${s.region} taxonomy=${region}`);
}

/* Every genre and region the catalog advertises must be one the dials can offer. */
const unknownGenres = catalog.genres.filter((g) => !T.genres.includes(g));
const unknownRegions = catalog.regions.filter((r) => !T.REGION_ORDER.includes(r));

console.log(`Checked ${catalog.stations.length} stations against js/taxonomy.js`);
if (unknownGenres.length) console.log('Genres not in taxonomy :', unknownGenres);
if (unknownRegions.length) console.log('Regions not in taxonomy:', unknownRegions);

if (drift.length || unknownGenres.length || unknownRegions.length) {
  console.log(`\n${drift.length} mislabelled station(s):`);
  for (const d of drift.slice(0, 25)) console.log('  ' + d);
  if (drift.length > 25) console.log(`  ...and ${drift.length - 25} more`);
  console.log('\nFAIL - rebuild with: node tools/build-catalog.mjs');
  process.exit(1);
}

console.log('OK - snapshot and live classifier agree.');
