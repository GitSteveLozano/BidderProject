import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import solidJs from '@astrojs/solid-js';
import tailwind from '@astrojs/tailwind';

// Cloudflare Pages target with hybrid rendering — landing + 404 are
// prerendered, everything else is SSR via the Astro Cloudflare adapter.
//
// Streaming SSR is disabled post-build via scripts/patch-cf-streaming.mjs
// because Cloudflare's nodejs_compat polyfill makes Astro's isNode check
// evaluate true, which selects the Node async-iterable response path
// that Cloudflare's Response constructor can't accept. (We learned that
// the hard way — see commit 1761de3.)
export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare({
    mode: 'directory',
    runtime: { mode: 'local', type: 'pages' },
  }),
  integrations: [
    solidJs(),
    tailwind({ applyBaseStyles: true }),
  ],
  site: 'https://bidderproject.pages.dev',
  // Image optimization — Cloudflare adapter doesn't ship Sharp; use the
  // no-op service so Astro's <Image> component is a passthrough.
  image: { service: { entrypoint: 'astro/assets/services/noop' } },
});
