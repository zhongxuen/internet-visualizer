// Per-route first-load JS, gzipped, read out of the prerendered HTML each route ships.
//
//   npm run build && node perf/bundles.mjs
//
// Next 16 does not print a size table, and the numbers here are the ones the phase-14
// budget is written against. Cross-checked against what the browser actually fetches:
// `perf/vitals.mjs` reports the same figure from resource timing.
// Every <script src> and every JS preload in the document is what the browser fetches
// before the route is interactive, so that set -- deduped -- is the route's initial JS.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative, sep } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const next = join(root, '.next');
const appDir = join(next, 'server', 'app');

const gzipCache = new Map();
function gz(chunk) {
  if (gzipCache.has(chunk)) return gzipCache.get(chunk);
  const file = join(next, chunk);
  const size = existsSync(file) ? gzipSync(readFileSync(file)).length : 0;
  gzipCache.set(chunk, size);
  return size;
}

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) htmlFiles(full, out);
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

// Next ships the legacy polyfill bundle with `noModule`, so no browser that can run the
// app ever downloads it. Counting it would inflate every route by the same ~39 KB and
// hide the numbers that actually move.
function noModuleChunks(html) {
  const skip = new Set();
  for (const tag of html.match(/<script[^>]*noModule[^>]*>/gi) ?? []) {
    for (const c of tag.match(/static\/chunks\/[A-Za-z0-9_./-]+\.js/g) ?? []) skip.add(c);
  }
  return skip;
}

const rows = [];
for (const file of htmlFiles(appDir)) {
  const html = readFileSync(file, 'utf8');
  const skip = noModuleChunks(html);
  const chunks = new Set(
    (html.match(/static\/chunks\/[A-Za-z0-9_./-]+\.js/g) ?? []).filter(
      (c) => !skip.has(c),
    ),
  );
  let total = 0;
  for (const chunk of chunks) total += gz(chunk);
  const route =
    '/' +
    relative(appDir, file)
      .split(sep)
      .join('/')
      .replace(/\.html$/, '');
  rows.push({ route, chunks: chunks.size, kb: total / 1024 });
}

rows.sort((a, b) => b.kb - a.kb);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('route', 50) + pad('chunks', 8) + 'first-load JS (gzip)');
console.log('-'.repeat(78));
for (const r of rows) {
  console.log(pad(r.route, 50) + pad(r.chunks, 8) + r.kb.toFixed(1).padStart(7) + ' KB');
}
console.log('\nroutes measured:', rows.length);
