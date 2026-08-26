/*
 * Can a browser analyse this stream's audio?
 * ------------------------------------------
 * A Web Audio AnalyserNode may only read a media element whose data arrived
 * under CORS: `crossOrigin="anonymous"` on the <audio>, and an
 * `Access-Control-Allow-Origin` on the response that admits us. Without both,
 * the element is "tainted" and the analyser returns silence — and worse, if
 * the attribute is set and the header is missing, the stream does not play at
 * all.
 *
 * So the visualizer's whole design turns on one number: what share of the
 * catalog would actually answer. This measures it rather than guessing.
 *
 * Run:  node tools/probe-cors.mjs [count] [origin]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'stations.json'), 'utf8'));

const N = Number(process.argv[2] || 60);
const ORIGIN = process.argv[3] || 'https://5radio.org';
const TIMEOUT = 9000;

/* A deterministic spread across the catalog rather than a random sample, so
   two runs are comparable and one popular host cannot dominate. */
const step = Math.max(1, Math.floor(catalog.stations.length / N));
const sample = [];
for (let i = 0; i < catalog.stations.length && sample.length < N; i += step) {
  sample.push(catalog.stations[i]);
}

async function probe(station) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    /* GET, not HEAD: icecast and shoutcast frequently mishandle HEAD. The
       Range header keeps it to a couple of KB, and we abort the body anyway. */
    const res = await fetch(station.url, {
      method: 'GET',
      signal: ctl.signal,
      headers: { Origin: ORIGIN, Range: 'bytes=0-1023', 'User-Agent': '5radio-cors-probe/1.0' }
    });
    const acao = res.headers.get('access-control-allow-origin');
    try { await res.body?.cancel(); } catch { /* already gone */ }
    const ok = acao === '*' || (acao && acao.toLowerCase() === ORIGIN.toLowerCase());
    return { status: res.status, acao, ok };
  } catch (e) {
    return { status: 0, acao: null, ok: false, err: e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.name };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (let i = 0; i < sample.length; i += 10) {
  const batch = sample.slice(i, i + 10);
  const got = await Promise.all(batch.map(probe));
  batch.forEach((s, k) => results.push({ station: s, ...got[k] }));
  process.stdout.write(`  probed ${results.length}/${sample.length}\r`);
}

const reachable = results.filter((r) => r.status > 0);
const allowed = results.filter((r) => r.ok);

console.log(`\n\nProbed ${results.length} stations as ${ORIGIN}\n`);
console.log(`  reachable at all          ${reachable.length}`);
console.log(`  sent Access-Control-Allow-Origin that admits us   ${allowed.length}`);
console.log(`  => analysable share of those that answered: ` +
            (reachable.length ? (allowed.length / reachable.length * 100).toFixed(1) : '0') + '%');

if (allowed.length) {
  console.log('\nStations a visualizer could actually read:');
  for (const r of allowed.slice(0, 20)) console.log(`  ${r.acao.padEnd(3)}  ${r.station.name}`);
}

const withHeader = results.filter((r) => r.acao && !r.ok);
if (withHeader.length) {
  console.log('\nSent an ACAO that does NOT admit us:');
  for (const r of withHeader.slice(0, 8)) console.log(`  ${r.acao}  ${r.station.name}`);
}
