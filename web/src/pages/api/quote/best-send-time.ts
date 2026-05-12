/**
 * GET /api/quote/best-send-time?quote_id=X
 *
 * Returns { when, why, source } where source is 'calendar' if we read
 * the shop's Google Calendar freebusy and found the next open 9-11 AM
 * weekday window, or 'heuristic' if Calendar isn't connected / the
 * provider token expired / the call failed.
 *
 * The Calendar path uses the provider_token already on the session
 * cookie (Supabase puts Google's access_token there at sign-in). Token
 * lifetimes are ~1h, so if the user signed in this session it's
 * almost certainly valid. If it's expired we fall back to heuristic
 * rather than try to refresh — re-signing-in is the cleanest UX and
 * matches how the rest of the app handles cookie-bound tokens.
 *
 * To use Calendar at all, the user has to have signed in with the
 * calendar.readonly scope. The Settings "Connect Calendar" button
 * triggers a reauth that requests it.
 */
import type { APIRoute } from 'astro';

import { readSessionCookie } from '@/lib/auth';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

interface Result {
  when: string;
  why: string;
  source: 'calendar' | 'heuristic';
}

export const GET: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  const quoteId = url.searchParams.get('quote_id');
  if (!quoteId) return json({ error: 'quote_id required' }, 400);

  const svc = supabaseService(env, 'service');
  const { data: quote } = await svc
    .from('quotes')
    .select('id, sent_at, created_at')
    .eq('id', quoteId)
    .eq('shop_id', locals.membership.shop_id)
    .maybeSingle();
  if (!quote) return json({ error: 'Quote not found' }, 404);

  const { data: shop } = await svc
    .from('shops')
    .select('google_calendar_connected, google_calendar_scope')
    .eq('id', locals.membership.shop_id)
    .maybeSingle();

  const ageDays = Math.floor(
    (Date.now() - new Date(quote.sent_at ?? quote.created_at).getTime()) / 86_400_000,
  );

  const cookie = readSessionCookie(request.headers.get('cookie'));
  const providerToken = cookie?.provider_token;
  const calendarEnabled =
    shop?.google_calendar_connected === true && shop?.google_calendar_scope === 'read';

  if (calendarEnabled && providerToken) {
    const slot = await pickFreeMorningSlot(providerToken);
    if (slot) {
      return json(
        {
          when: slot.label,
          why: ageDays >= 5
            ? `Your calendar is clear that morning — and it's been ${ageDays} days since the quote went out.`
            : 'First free spot on your calendar inside your 9–11 AM open-rate window.',
          source: 'calendar',
        } satisfies Result,
        200,
      );
    }
  }

  // Fall back to the deterministic heuristic. Mirrors the inline
  // bestSendTime() the drawer used to compute client-side, but now the
  // endpoint owns the rule so the drawer doesn't need to re-implement.
  return json(heuristic(ageDays), 200);
};

interface BusyBlock {
  start: string;
  end: string;
}

async function pickFreeMorningSlot(token: string): Promise<{ label: string } | null> {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 9 * 86_400_000).toISOString();

  const resp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: 'primary' }],
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!resp || !resp.ok) return null;
  const data = (await resp.json()) as { calendars?: { primary?: { busy?: BusyBlock[] } } };
  const busy = (data.calendars?.primary?.busy ?? []).map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));

  // Walk the next 7 weekdays. For each, check if the 9:10–10:30 AM
  // window is free. First clean window wins.
  const start = new Date(now);
  start.setSeconds(0, 0);
  for (let i = 0; i < 9; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const windowStart = new Date(day);
    windowStart.setHours(9, 10, 0, 0);
    const windowEnd = new Date(day);
    windowEnd.setHours(10, 30, 0, 0);
    if (windowStart < now) continue;
    const conflict = busy.some((b) => b.start < windowEnd && b.end > windowStart);
    if (conflict) continue;
    const label = sameDay(windowStart, now)
      ? `Today, 9:10 AM`
      : sameDay(windowStart, addDays(now, 1))
        ? `Tomorrow, 9:10 AM`
        : `${windowStart.toLocaleDateString('en-US', { weekday: 'long' })}, 9:10 AM`;
    return { label };
  }
  return null;
}

function heuristic(ageDays: number): Result {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (day >= 1 && day <= 5 && hour >= 9 && hour < 11) {
    return {
      when: 'Send now',
      why: 'Weekday mid-morning is when this client tends to open.',
      source: 'heuristic',
    };
  }
  const target = nextWeekdayMorning(now);
  const dayLabel = sameDay(target, addDays(now, 1))
    ? 'Tomorrow'
    : target.toLocaleDateString('en-US', { weekday: 'long' });
  return {
    when: `${dayLabel}, 9:10 AM`,
    why: ageDays >= 5
      ? `It's been ${ageDays} days. Builder-to-builder check-ins read best at the start of the workday.`
      : 'Tuesday-morning open-rate window is highest for this segment.',
    source: 'heuristic',
  };
}

function nextWeekdayMorning(from: Date): Date {
  const x = new Date(from);
  x.setHours(9, 10, 0, 0);
  if (x <= from) x.setDate(x.getDate() + 1);
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
