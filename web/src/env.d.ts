/// <reference types="astro/client" />

import type { CloudflareEnv } from './lib/supabase';

type Runtime = {
  env: CloudflareEnv;
};

declare namespace App {
  interface Locals {
    runtime?: Runtime;
  }
}
