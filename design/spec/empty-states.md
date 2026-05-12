# Empty states

Cross-cutting. Empty/error states are primary screens, not error screens — they ship the worst defaults by default and they hit hardest in production. This doc enumerates every empty/error/calibrating surface so they get implementation attention as a batch.

## Three data states

Derived from `shops.data_state` (see `data-shapes.md`):

| State | Definition | Visual treatment |
|---|---|---|
| `cold-start` | `quote_count === 0` | Primary empty state per view. Editorial copy. CTA: produce first quote. |
| `calibrating` | `1 ≤ quote_count ≤ 5` OR `< 14 days since first quote` | Subtle "calibrating" disclaimer at top of relevant views. KPIs hide trend arrows. Brief's drafts read as drafts (more visible review affordance). |
| `calibrated` | `quote_count > 5` AND `≥ 14 days since first quote` | Default rendering. Trend arrows on. Brief drafts feel confident. |

A sidebar pill displays the current state in `calibrating` only. Tooltip: "Brief is still learning your voice. Drafts will improve as you send more quotes." Pill auto-dismisses on transition to `calibrated`.

## Per-view copy (cold-start)

### `/bids` (Quotes — Agenda)
```
Eyebrow:  COLD START
Title:    No quotes yet.
Body:     The fastest way to start is to upload one you sent recently. Brief
          reads it, learns your voice, and gets ready for the next one.
Primary:  Produce your first quote  →  /generate
Secondary: Upload an existing quote  →  /generate?intake=upload
```

### `/quotes/[id]` (no activity yet)
```
(inline in sidebar, not full-page)
"Sent to {client_first_name} — no opens yet. Brief will let you know."
```

### `/jcr` (Jobs)
```
Eyebrow:  NO JOBS YET
Title:    Jobs land here after you win a quote.
Body:     Mark any quote as won from the Quotes view and the job opens up here —
          schedule, crew, costs, all of it.
Primary:  Go to Quotes  →  /bids
```

### `/clients`
```
Eyebrow:  COLD START
Title:    Clients are added automatically.
Body:     The first quote you send creates the first client. You don't have to
          enter anyone manually unless you want to.
Primary:  Produce your first quote  →  /generate
Secondary: Add a client manually  → modal
```

### `/insights` (Dashboard)
```
Eyebrow:  COLD START
Title:    Numbers show up here after your first quote.
Body:     There's nothing meaningful to chart yet — and we won't fake it. Send
          your first quote and the dashboard will start filling in.
Primary:  Produce your first quote  →  /generate
```

## Per-view copy (calibrating)

Inline disclaimer banners under the page title, dismissible per-session:

### `/bids`
> Brief is still calibrating to your voice — drafts will sharpen over the next few quotes.

### `/insights`
> Trends hidden while Brief calibrates. Send a few more quotes and the dashboard will fill in.

### `/quotes/[id]` (Reply/Nudge drawer specifically)
> Draft from a learning model — read closely before you send.

## Per-view copy (quiet / mid-day empty)

When the **app has data** but a specific group is empty:

### `/bids` Agenda — "Today" empty mid-day
```
Nothing here. Quiet is good.
```
Italic serif, muted. No CTA. (This is the only state where "empty = success".)

### `/bids` Agenda — "Cooling off" populated (NOT empty — opposite signal)
```
Group is shown only when populated. Subtitle:
"No movement in 2+ weeks — try a different angle or close the loop."
```

## Error states (per surface)

### Network / load errors
Inline banner pattern, **never full-page replacement** unless the entire view is unrecoverable.

```
[icon]  We couldn't refresh the list. [Retry]
        Showing cached data from 12 min ago.
```

### SSE stream interruption (Quote production)
```
Connection dropped at item 7. Brief picked up where it stopped — you're at
{x of y} items.
[Continue] [Save what's here as draft]
```

### Voice upload parse failure (Onboarding)
```
We couldn't read this one. Could be a scan, could be an unusual format. Try a
recent quote or email you typed yourself — those work best.
[Try another file]  [Skip — you'll have less polish]
```

### Integration disconnect (e.g. Google Calendar revoked outside Brief)
```
[warn banner on /bids and /settings]
Google Calendar disconnected — Brief can't suggest send times until it's
reconnected.
[Reconnect]
```

### Permission denied (Calendar Pattern A)
Calendar consent screen, denied state — **not** treated as an error:
```
That's fine. Brief works without calendar access; you'll just schedule sends
manually instead of getting suggestions.
[Continue without calendar]   [Reconsider]
```

## Loading states — no full-page spinners

App-wide convention:

| Surface | Loading treatment |
|---|---|
| Tables | 6 skeleton rows with `animate-pulse`. Header chrome renders immediately. |
| KPI tiles | Skeleton block, same dimensions. Trend arrows hidden during load. |
| Drawer / modal | Opens immediately, drafts stream in (SSE) or skeleton block (REST). |
| Onboarding step transitions | 240ms slide; no spinner. |
| Quote PDF preview | Skeleton page placeholder while rendering. |

Hard rule: **never** show a centered spinner over the whole page. The page shell renders, content fills in.

## Voice & tone tests

Every empty-state string should pass these:

1. Reads as a sentence a tradesperson would say out loud. Not as marketing copy.
2. Tells you what will happen, not what's missing. ("Jobs land here after you win a quote" — not "No jobs found.")
3. No exclamation marks. No emoji. No "Oops!" / "Sorry!" / "Whoops".
4. Brief speaks in first person sparingly — only when the action is Brief's ("Brief will let you know when she opens it"). Most copy uses second person ("You'll see jobs here…").
5. Editorial register, not corporate. If you wouldn't put it in a magazine column, rewrite.
