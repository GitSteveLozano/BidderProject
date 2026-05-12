# Deploy notes

## Cloudflare Pages auto-deploy

Brief deploys to Cloudflare Pages. Make sure **automatic deployments** are enabled in:

  Cloudflare Pages → your project → Settings → Builds & deployments → Branch deployments

If automatic deployments are disabled, each merged PR has to be manually retried in the Cloudflare dashboard, which is painful (we hit this during initial bringup — see commit history around the v1 launch).

## Verifying which commit is live

The `/quotes?diag=1` probe returns a `build_tag` in the JSON response — bump it when the SSR contract changes so a regression is visible at a glance.

To confirm a deploy is current:

```bash
curl -s https://bidderproject.pages.dev/quotes?diag=1 | jq .build_tag
# expected: "brief-v1-streaming-disabled" (or whatever the current main tag is)
```

If you see a different `build_tag`, Cloudflare hasn't promoted the latest build yet.

## Required environment variables

Set in Cloudflare Pages → Settings → Environment variables, on BOTH Production and Preview:

| Variable | Type | Value |
|---|---|---|
| `SUPABASE_URL` | Plaintext | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Secret | from Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Secret | from Supabase → Settings → API (service_role) |
| `ANTHROPIC_API_KEY` | Secret | from console.anthropic.com |
| `DEFAULT_MODEL_SONNET` | Plaintext | `claude-sonnet-4-6` (optional, defaults applied if unset) |
| `DEFAULT_MODEL_HAIKU` | Plaintext | `claude-haiku-4-5` (optional) |

## Required Cloudflare compatibility flags

Cloudflare Pages → Settings → Functions:

- **Compatibility date:** 2025-07-18 or later
- **Compatibility flags (Production):** `nodejs_compat`
- **Compatibility flags (Preview):** `nodejs_compat`

`nodejs_compat` is load-bearing — `@supabase/supabase-js` needs Node compatibility. With it enabled, Cloudflare exposes a `process` global that makes Astro's `isNode` check return true. We work around that with a postbuild patch (`web/scripts/patch-cf-streaming.mjs`) that forces `streaming=false`. CI verifies the patch landed on every build.

## Google OAuth setup

See `web/src/lib/auth.ts` for the auth wiring. Required external setup:

- **Google Cloud Console** → OAuth consent screen → Publishing status **Production** (Testing mode requires test-user listing for every sign-in)
- Scope list: `userinfo.email` + `userinfo.profile` only. Don't add Calendar or any sensitive scopes — they trigger the "unverified app" warning for all users until Google verifies the app (weeks-long process). Calendar comes back as an opt-in Settings flow in a future PR.
- **Google Cloud Console** → Credentials → OAuth client → Authorized redirect URI: `https://<supabase-ref>.supabase.co/auth/v1/callback`
- **Supabase** → Authentication → Providers → Google → enabled with Client ID + Secret. Site URL and Redirect URLs must include the production domain + (optionally) `http://localhost:4321/auth/callback` for local preview.

## Demo seed user

After signing in once with a Google account, run this in Supabase SQL Editor to link your user to the demo shop (so you see seeded quotes/jobs/clients immediately):

```sql
INSERT INTO memberships (user_id, shop_id, role)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@example.com'),
  '00000000-0000-4000-8000-000000000001',
  'owner'
)
ON CONFLICT DO NOTHING;

UPDATE shops SET onboarding_completed_at = now()
WHERE id = '00000000-0000-4000-8000-000000000001'
  AND onboarding_completed_at IS NULL;
```

(Skip if you want to walk through the onboarding flow yourself — first sign-in self-serves a fresh empty shop.)
