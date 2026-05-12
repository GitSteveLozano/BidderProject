/**
 * POST /api/quote/render-pdf
 *
 * Renders a bid PDF via @react-pdf/renderer (server-side, declarative).
 *
 * Body: { client_name, project_title, project_address, scope_summary,
 *         line_items: [{description, qty, unit, unit_price, subtotal, category}],
 *         total, shop: { legal_name, license_number, license_jurisdiction,
 *                        boilerplate_intro, boilerplate_closing } }
 *
 * Returns application/pdf bytes. Caller embeds in an <iframe>.
 */
import type { APIRoute } from 'astro';
import { renderToBuffer } from '@react-pdf/renderer';

import BidPdf from '@/lib/pdf/BidPdf';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user || !locals.membership) {
    return new Response('Not authenticated', { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  try {
    const buffer = await renderToBuffer(BidPdf(body));
    return new Response(buffer as any, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(
      `PDF render failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 },
    );
  }
};
