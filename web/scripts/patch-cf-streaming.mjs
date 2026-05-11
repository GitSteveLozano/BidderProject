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

if (src.includes(replacement)) {
  console.log('[patch-cf-streaming] already patched, skipping');
  process.exit(0);
}

if (!src.includes(needle)) {
  console.error(`[patch-cf-streaming] FAILED: needle not found in ${adapterPath}`);
  console.error('The @astrojs/cloudflare adapter output shape may have changed.');
  console.error('Check createExports() in the dist file and update the needle.');
  process.exit(1);
}

const patched = src.replace(needle, replacement);
await writeFile(adapterPath, patched, 'utf8');
console.log(`[patch-cf-streaming] patched ${adapterPath} (streaming=false)`);
