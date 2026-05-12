/**
 * GET /api/quote/[id]/track-open
 *
 * 1x1 transparent GIF that fires `quote.opened` when the recipient's
 * email client (or our public view page) loads it. Public — no auth.
 * Query `?from=email` vs `?from=page` so the dashboard can distinguish
 * email-opens from page-loads if it ever wants to.
 *
 * We don't dedupe at write time. The dashboard funnel folds duplicates
 * via a Set on quote_id, and per-open timestamps are useful as
 * engagement signal (e.g. "they opened it 4 times this week").
 */
import type { APIRoute } from 'astro';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

// 1x1 transparent GIF, base64-decoded once at module load.
const PIXEL_BYTES = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
);

export const GET: APIRoute = async ({ params, request, locals, url }) => {
  const env = locals.runtime?.env;
  const id = params.id;
  if (env && id) {
    const svc = supabaseService(env, 'service');
    const { data: quote } = await svc
      .from('quotes')
      .select('shop_id, state')
      .eq('id', id)
      .neq('state', 'DRAFT')
      .maybeSingle();
    if (quote) {
      const from = url.searchParams.get('from') === 'page' ? 'page' : 'email';
      await svc.from('events').insert({
        shop_id: quote.shop_id,
        quote_id: id,
        type: 'quote.opened',
        actor: 'client',
        payload: {
          source: from,
          user_agent: request.headers.get('user-agent') ?? null,
        },
      });
    }
  }

  return new Response(PIXEL_BYTES, {
    status: 200,
    headers: {
      'content-type': 'image/gif',
      'content-length': String(PIXEL_BYTES.length),
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
    },
  });
};
