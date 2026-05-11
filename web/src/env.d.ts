/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// Module form: `declare namespace App` in a file with imports requires
// `declare global` for the augmentation to attach to the global App
// namespace Astro generates. See:
//   https://docs.astro.build/en/recipes/middleware/#defining-app-locals
declare global {
  namespace App {
    interface Locals {
      runtime?: {
        env: import('./lib/supabase').CloudflareEnv;
        cf?: unknown;
        caches?: unknown;
        ctx?: unknown;
      };
    }
  }
}

export {};
