# Design handoff — auth + calendar (v1)

This folder is the source of truth for the design pass on Google auth and Google Calendar integration. Lives at repo root (not under `web/`) so it doesn't get uploaded to Cloudflare Pages on deploy.

## Layout

```
design/
  README.md            ← this file (index of what's here)
  spec/                ← one markdown file per screen / component
  snapshots/           ← extracted HTML reference per state
  mockups/             ← PNG/JPG/SVG mockups per breakpoint
  tokens.md            ← (optional) palette/type/spacing changes
```

## Naming conventions

- **Spec files:** `spec/<route-or-component>.md`
  Examples: `spec/auth-signin.md`, `spec/bids.md`, `spec/header-user-menu.md`
- **Snapshots:** `snapshots/<screen>-<state>.html`
  Examples: `snapshots/bids-empty.html`, `snapshots/bids-error.html`, `snapshots/generate-streaming.html`
- **Mockups:** `mockups/<screen>-<breakpoint>.png`
  Breakpoints: `desktop` (≥1024), `tablet` (640–1023), `mobile` (≤639). Tablet only if it differs meaningfully from desktop.

## What each spec doc should contain

For every screen or component, the spec covers:

1. **Scope** — new screen, full redesign, or in-page component. Name the file path it replaces (e.g. `web/src/pages/bids.astro`, `web/src/components/BidGenerator.tsx`).
2. **States** — default, loading, empty, error, hover, focus, disabled, success.
3. **Interaction** — what's SSR, what's a client island, what triggers a network call, what streams (SSE).
4. **Tokens changed** — colors, type scale, spacing, radii. List explicitly; if unchanged, say so.
5. **Components reused vs new** — flag new primitives so they get extracted, not duplicated.
6. **Content rules** — currency format, date format, % precision, null/missing rendering.
7. **Accessibility** — keyboard order, focus ring, contrast, ARIA for icon-only buttons.

## Stack constraints to design within

- Astro 4.16 hybrid output on Cloudflare Pages (SSR `.astro` pages + prerendered marketing)
- Solid JS for interactive islands (see `web/src/components/BidGenerator.tsx`, `PostmortemRunner.tsx`)
- Tailwind 3.4 — palette uses `ink-{50..900}` (greys) and `accent-{50..700}`; see `web/tailwind.config.mjs`
- Supabase as backing store. Long-term multi-tenant; first sign-in self-serves a new company row.
- Astro streaming SSR is **off** (postbuild patch — `web/scripts/patch-cf-streaming.mjs`). Page HTML is fully rendered before flush.
- SSE from API routes (`/api/bids/generate`) is **on** and works fine. Client islands consume via `fetch().body.getReader()`.

## In scope for this design pass

- Sign-in screen (Google OAuth button, error states, "session expired")
- Header user menu (avatar, email, "Disconnect Google", sign out)
- Permission re-grant UI when Calendar scope is missing or revoked
- "Calendar not connected" empty states wherever Calendar data appears
- Self-serve onboarding (first sign-in → create company, name pulled from Google profile)
- Owner invite UX (generate invite link, see pending invites)
- Per-page locked state for protected routes pre-login
- Calendar integration surfaces (TBD — depends on what the mockups show)

## Out of scope

- Anything that needs new Supabase columns/views — call those out in the spec so we land schema migrations first, separately
- Custom fonts (system stack only for now; adding a font is a separate decision)
- Heavy client-side state (Solid signals only; no global store)
- Astro server-streaming patterns (would re-trigger the `[object Object]` bug we just fixed)

## Inbox / TODO

Empty until design starts dropping files. Add a brief one-liner here per file added so the engineer reading the folder knows where to start.

- [ ] _(awaiting first spec drop)_
