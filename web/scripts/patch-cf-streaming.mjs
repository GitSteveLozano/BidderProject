#!/usr/bin/env node
/**
 * Postbuild patch: disable Astro streaming SSR on Cloudflare Pages.
 *
 * Root cause (confirmed via /bids?diag=1):
 *   On Cloudflare Workers with nodejs_compat enabled,
 *   Object.prototype.toString.call(process) === "[object process]".
 *   Astro's `isNode` check then evaluates TRUE, so renderPage picks
 *   `renderToAsyncIterable` instead of `renderToReadableStream`. The
 *   async iterable is passed to `new Response(...)`, which coerces it
 *   to the literal string "[object Object]". API routes work because
 *   they build `new Response(JSON.stringify(...))` directly.
 *
 * Fix:
 *   Construct the Astro App with streaming=false. renderPage then uses
 *   renderToString → real string body → Response handles it fine.
 *
 * Why not patch upstream:
 *   Until @astrojs/cloudflare exposes a `streaming: false` option, this
 *   is the smallest local fix. Idempotent; safe to re-run.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const adapterPath = resolve(here, '..', 'dist', '_worker.js', '_@astrojs-ssr-adapter.mjs');

const src = await readFile(adapterPath, 'utf8');

const needle = 'const app = new App(manifest);';
const replacement = 'const app = new App(manifest, false); // streaming disabled — see scripts/patch-cf-streaming.mjs';

function fail(msg) {
  console.error(`[patch-cf-streaming] FAILED: ${msg}`);
  console.error(`File: ${adapterPath}`);
  console.error(
    'The @astrojs/cloudflare adapter output shape may have changed.',
    'Check createExports() in the dist file and update the needle.',
  );
  process.exit(1);
}

if (src.includes(replacement)) {
  console.log('[patch-cf-streaming] already patched, skipping');
  process.exit(0);
}

if (!src.includes(needle)) {
  fail(`needle not found: ${JSON.stringify(needle)}`);
}

// Guard against ambiguous matches — if `new App(manifest)` appears more
// than once we can't be sure we patched the right call site.
const matches = src.split(needle).length - 1;
if (matches !== 1) {
  fail(`expected exactly 1 occurrence of needle, found ${matches}`);
}

const patched = src.replace(needle, replacement);
await writeFile(adapterPath, patched, 'utf8');

// Read back and assert the patched marker is present. Catches the case
// where a future Rollup minification step might strip our comment or
// rewrite the constructor call.
const verify = await readFile(adapterPath, 'utf8');
if (!verify.includes('new App(manifest, false)')) {
  fail('post-write verification: "new App(manifest, false)" not present in adapter output');
}
console.log(`[patch-cf-streaming] patched ${adapterPath} (streaming=false, verified)`);
