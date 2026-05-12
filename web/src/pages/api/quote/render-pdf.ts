/**
 * POST /api/quote/render-pdf
 *
 * Returns an HTML render of the bid, with print styles tuned for
 * Letter-size paper. The browser handles PDF generation via the
 * standard Print → Save as PDF flow.
 *
 * Why HTML and not a real PDF library:
 *   @react-pdf/renderer + Cloudflare Workers + Vite's bundler don't
 *   get along — fontkit (a transitive dep) can't resolve its entry
 *   point in Cloudflare's build environment. pdf-lib is the future
 *   alternative; both add real bundle weight and reduce iteration
 *   speed. For v1 we lean on the browser, which renders Newsreader
 *   and Geist faithfully and respects @media print sizing.
 *
 * Body: { client_name, client_contact, project_title, project_address,
 *         scope_summary, line_items, total, ref, date,
 *         shop: { legal_name, trade_name, license_number,
 *                 license_jurisdiction, boilerplate_intro,
 *                 boilerplate_closing } }
 *
 * Returns text/html; caller iframes it and triggers window.print()
 * when the user clicks "Print / Save as PDF".
 */
import type { APIRoute } from 'astro';

export const prerender = false;

interface LineItem {
  description: string;
  qty: number;
  unit?: string;
  unit_price: number;
  subtotal: number;
}

interface BidBody {
  ref?: string;
  date?: string;
  client_name?: string;
  client_contact?: string;
  project_title?: string;
  project_address?: string;
  scope_summary?: string;
  line_items: LineItem[];
  total: number;
  shop?: {
    legal_name?: string;
    trade_name?: string;
    license_number?: string;
    license_jurisdiction?: string;
    boilerplate_intro?: string;
    boilerplate_closing?: string;
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user || !locals.membership) {
    return new Response('Not authenticated', { status: 401 });
  }

  let body: BidBody;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const html = renderBid(body);
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};

function fmt(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBid(b: BidBody): string {
  const shop = b.shop ?? {};
  const ref = b.ref ?? 'Q-DRAFT';
  const date =
    b.date ??
    new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${esc(b.client_name ?? '')} · ${esc(ref)}</title>
    <style>
      @page { size: Letter; margin: 0.6in; }
      :root {
        --ink: #1c1a16;
        --muted: #6b6358;
        --muted-2: #918a7d;
        --line: #efe9dc;
        --paper: #fdfbf6;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: 'Newsreader', 'Iowan Old Style', Georgia, serif;
        font-size: 11px;
        color: var(--ink);
        background: var(--paper);
        line-height: 1.45;
      }
      .sheet {
        max-width: 7.3in;
        margin: 0 auto;
        padding: 0.6in 0.4in;
      }
      header {
        border-bottom: 1px solid var(--ink);
        padding-bottom: 12px;
        margin-bottom: 24px;
      }
      .shop {
        font-size: 22px;
        letter-spacing: -0.01em;
      }
      .shop-meta {
        color: var(--muted);
        font-size: 9px;
        margin-top: 4px;
      }
      .ref-row {
        display: flex;
        justify-content: space-between;
        margin-top: 8px;
        font-size: 9px;
      }
      .ref-row .label { color: var(--muted); }
      .ref-row .value { font-family: 'Geist Mono', ui-monospace, monospace; }
      h2 {
        font-size: 13px;
        font-weight: 500;
        letter-spacing: -0.01em;
        margin: 16px 0 6px;
      }
      .client-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        margin-bottom: 18px;
      }
      .label {
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-2);
        font-family: 'Geist Mono', ui-monospace, monospace;
        margin-bottom: 2px;
      }
      .scope-body {
        font-size: 11px;
        line-height: 1.5;
        margin-bottom: 16px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10px;
      }
      th {
        text-align: left;
        font-size: 8px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
        padding: 6px 8px;
        border-bottom: 1px solid var(--ink);
        font-family: 'Geist Mono', ui-monospace, monospace;
      }
      td {
        padding: 8px;
        border-bottom: 0.5px solid var(--line);
        vertical-align: top;
      }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      .totals {
        margin-top: 8px;
        padding-top: 14px;
        border-top: 1.5px solid var(--ink);
        display: flex;
        justify-content: flex-end;
        gap: 16px;
        align-items: baseline;
      }
      .total-label { font-size: 10px; color: var(--muted); }
      .total-value {
        font-size: 18px;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums;
      }
      .boilerplate {
        margin-top: 18px;
        line-height: 1.5;
      }
      footer {
        margin-top: 28px;
        padding-top: 8px;
        border-top: 0.5px solid var(--line);
        font-size: 8px;
        color: var(--muted-2);
        display: flex;
        justify-content: space-between;
        font-family: 'Geist Mono', ui-monospace, monospace;
      }
      @media screen {
        body { padding: 24px 0; }
        .sheet {
          background: var(--paper);
          box-shadow: 0 6px 18px rgba(28, 26, 22, 0.08);
          min-height: 10.5in;
        }
      }
    </style>
  </head>
  <body>
    <article class="sheet">
      <header>
        <div class="shop">${esc(shop.trade_name || shop.legal_name || '')}</div>
        <div class="shop-meta">${[shop.license_number, shop.license_jurisdiction].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="ref-row">
          <span><span class="label">Date:</span> <span>${esc(date)}</span></span>
          <span><span class="label">Quote:</span> <span class="value">${esc(ref)}</span></span>
        </div>
      </header>

      <div class="client-grid">
        <div>
          <div class="label">For</div>
          <div>${esc(b.client_name ?? '')}</div>
          ${b.client_contact ? `<div>${esc(b.client_contact)}</div>` : ''}
        </div>
        <div>
          <div class="label">Project</div>
          <div>${esc(b.project_title ?? '')}</div>
          ${b.project_address ? `<div style="color:var(--muted)">${esc(b.project_address)}</div>` : ''}
        </div>
      </div>

      ${shop.boilerplate_intro ? `<p class="boilerplate">${esc(shop.boilerplate_intro)}</p>` : ''}

      ${b.scope_summary ? `<h2>Scope</h2><p class="scope-body">${esc(b.scope_summary)}</p>` : ''}

      <h2>Line items</h2>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th class="num">Qty</th>
            <th class="num">Unit</th>
            <th class="num">Unit price</th>
            <th class="num">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${b.line_items
            .map(
              (li) => `
            <tr>
              <td>${esc(li.description)}</td>
              <td class="num">${esc(li.qty.toLocaleString())}</td>
              <td class="num" style="color:var(--muted)">${esc(li.unit ?? '')}</td>
              <td class="num">${esc(fmt(li.unit_price))}</td>
              <td class="num">${esc(fmt(li.subtotal))}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>

      <div class="totals">
        <span class="total-label">Total</span>
        <span class="total-value">${fmt(b.total)}</span>
      </div>

      ${shop.boilerplate_closing ? `<p class="boilerplate">${esc(shop.boilerplate_closing)}</p>` : ''}

      <footer>
        <span>${esc(shop.legal_name ?? '')}</span>
        <span>${shop.license_number ? esc(shop.license_number) + (shop.license_jurisdiction ? ' · ' + esc(shop.license_jurisdiction) : '') : ''}</span>
      </footer>
    </article>
  </body>
</html>`;
}
