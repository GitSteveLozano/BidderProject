import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import solidJs from '@astrojs/solid-js';
import tailwind from '@astrojs/tailwind';

// Cloudflare Pages target with hybrid rendering — most pages are static,
// the bid-generation flow uses server-rendered routes that call into
// /functions/api/* (Cloudflare Pages Functions, deployed alongside).
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
  site: 'https://bid-intel.pages.dev',
  // Image optimization — for now use the cloudflare adapter's built-in
  image: { service: { entrypoint: 'astro/assets/services/noop' } },
});
