/*
 * Spot-check the catalog: pull a random sample of stream URLs and see whether
 * they actually hand back audio bytes right now.
 *
 * Run:  node tools/audit-streams.mjs [sampleSize]
 *
 * This is a health check on the snapshot, not a build step -- the numbers it
 * prints are what "hit rate" in the README is based on.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'stations.json'), 'utf8'));
const size = Number(process.argv[2] || 60);

const sample = [...catalog.stations].sort(() => Math.random() - 0.5).slice(0, size);

async function probe(station) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(station.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Icy: 'MetaData:0', Range: 'bytes=0-4096' },
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok && res.status !== 206) return { ok: false, why: 'HTTP ' + res.status };
    // Read a little to prove bytes actually flow, then bail out of the stream.
    const reader = res.body.getReader();
    const first = await reader.read();
    reader.cancel().catch(() => {});
    if (!first.value || first.value.length === 0) return { ok: false, why: 'no bytes' };
    if (!/audio|mpeg|ogg|aac|octet-stream|video/i.test(type)) return { ok: false, why: 'type ' + type };
    return { ok: true, why: type + ' ' + first.value.length + 'B' };
  } catch (e) {
    return { ok: false, why: e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 40) };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
const CONCURRENCY = 10;
let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < sample.length) {
      const s = sample[cursor++];
      const r = await probe(s);
      results.push({ s, r });
      process.stdout.write(r.ok ? '.' : 'x');
    }
  })
);

const bad = results.filter((x) => !x.r.ok);
console.log('\n\n' + (results.length - bad.length) + '/' + results.length + ' streams answered with audio');
if (bad.length) {
  console.log('\nFailures:');
  for (const b of bad) console.log('  ' + b.s.name.padEnd(38).slice(0, 38) + ' ' + b.r.why + '  ' + b.s.url);
}
