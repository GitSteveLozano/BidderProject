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

interface Phase {
  name: string;
  deliverables?: string[];
  duration?: string | null;
  fee?: number | null;
}

interface RebateTerm {
  product: string;
  rebate: string;
  basis: string;
}

interface SectionData {
  kind: 'text' | 'bullets' | 'kv_table';
  key?: string;
  label?: string;
  body?: string;
  items?: string[];
  headers?: string[];
  rows?: Array<Record<string, string>>;
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
  /** Non-itemized proposals (consulting/partnership) render phases
   * + rebate_terms in place of the line-items table. */
  phases?: Phase[] | null;
  rebate_terms?: RebateTerm[] | null;
  /** Novel-shape proposals (5th wizard path) render sections_data —
   * the operator-edited content for each section of their chosen
   * layout. Takes precedence over phases/rebate/line_items when
   * present. */
  sections_data?: SectionData[] | null;
  shape_name?: string | null;
  proposal_style?: 'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'novel' | 'unknown' | null;
  program_type?: 'one_off' | 'recurring' | 'rebate' | null;
  term_months?: number | null;
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

/**
 * Picks the right priced-section format based on what the wizard
 * sent. A partnership pitch has rebate_terms; a consulting proposal
 * has phases with fees; a project quote has line items. Some docs
 * have a mix (a partnership with a transition-plan phase list);
 * render every populated section.
 */
function renderBody(b: BidBody): string {
  const sections: string[] = [];

  // Novel-path sections take precedence. When the operator picked a
  // freeform shape, it's the authoritative layout — render only
  // those sections and skip the legacy line_items / phases / rebate
  // tables below.
  if (b.sections_data && b.sections_data.length > 0) {
    for (const s of b.sections_data) {
      const label = typeof s.label === 'string' ? s.label : '';
      if (!label) continue;
      if (s.kind === 'text') {
        const body = (s.body ?? '').trim();
        if (!body) continue;
        sections.push(
          `<h2>${esc(label)}</h2><p class="scope-body" style="white-space:pre-wrap">${esc(body)}</p>`,
        );
      } else if (s.kind === 'bullets') {
        const items = Array.isArray(s.items) ? s.items.filter((i) => i.trim().length > 0) : [];
        if (items.length === 0) continue;
        sections.push(
          `<h2>${esc(label)}</h2><ul style="margin:0 0 16px 18px;padding:0;line-height:1.55">${items
            .map((i) => `<li>${esc(i)}</li>`)
            .join('')}</ul>`,
        );
      } else if (s.kind === 'kv_table') {
        const headers = Array.isArray(s.headers) ? s.headers : [];
        const rows = Array.isArray(s.rows) ? s.rows : [];
        if (headers.length === 0 || rows.length === 0) continue;
        sections.push(`
          <h2>${esc(label)}</h2>
          <table>
            <thead>
              <tr>${headers.map((h, i) => `<th${i > 0 ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) =>
                    `<tr>${headers
                      .map(
                        (h, i) =>
                          `<td${i > 0 ? ' class="num"' : ''}>${esc(r[h] ?? '')}</td>`,
                      )
                      .join('')}</tr>`,
                )
                .join('')}
            </tbody>
          </table>`);
      }
    }
    if (sections.length > 0) return sections.join('\n');
    // Sections present but all empty — fall through to legacy
    // tables (probably nothing there either) and we'll show the
    // soft-empty note at the bottom.
  }

  if (b.phases && b.phases.length > 0) {
    const rows = b.phases
      .map((ph, i) => {
        const deliverables =
          ph.deliverables && ph.deliverables.length > 0
            ? `<ul style="margin:4px 0 0 14px;padding:0;color:var(--muted);font-size:10px;line-height:1.5">${ph.deliverables
                .map((d) => `<li>${esc(d)}</li>`)
                .join('')}</ul>`
            : '';
        const feeCell =
          ph.fee != null
            ? `<td class="num">${esc(fmt(Number(ph.fee)))}</td>`
            : `<td class="num" style="color:var(--muted-2)">—</td>`;
        return `
          <tr>
            <td style="width:32px;color:var(--muted-2);font-family:'Geist Mono',monospace;font-size:9px">${String(i + 1).padStart(2, '0')}</td>
            <td>
              <div style="font-weight:500">${esc(ph.name)}</div>
              ${deliverables}
            </td>
            <td class="num" style="color:var(--muted)">${esc(ph.duration ?? '')}</td>
            ${feeCell}
          </tr>`;
      })
      .join('');
    sections.push(`
      <h2>Phases &amp; deliverables</h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Phase</th>
            <th class="num">Duration</th>
            <th class="num">Fee</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  if (b.rebate_terms && b.rebate_terms.length > 0) {
    const termsHeader = b.term_months
      ? `<p class="scope-body" style="color:var(--muted);font-size:10px;margin-top:-4px">Term: ${b.term_months} months</p>`
      : '';
    const rows = b.rebate_terms
      .map(
        (rt) => `
          <tr>
            <td>${esc(rt.product)}</td>
            <td class="num">${esc(rt.rebate)}</td>
            <td style="color:var(--muted)">${esc(rt.basis)}</td>
          </tr>`,
      )
      .join('');
    sections.push(`
      <h2>Rebate program</h2>
      ${termsHeader}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th class="num">Rebate</th>
            <th>Basis</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  if (b.line_items && b.line_items.length > 0) {
    const rows = b.line_items
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
      .join('');
    sections.push(`
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
        <tbody>${rows}</tbody>
      </table>`);
  }

  if (sections.length === 0) {
    // Last resort — empty proposal. Better than rendering an
    // empty line-items table that confuses the reader.
    return `<p class="scope-body" style="color:var(--muted);font-style:italic">
      No priced sections yet — see the scope above.
    </p>`;
  }
  return sections.join('\n');
}

/** Hide the bottom "Total: $X" line when the doc legitimately has no
 * total (rebate-only partnership, narrative consulting with no fees,
 * novel layouts with zero $). Project quotes always show it. */
function shouldShowTotal(b: BidBody): boolean {
  if (b.total > 0) return true;
  // total === 0
  if (b.proposal_style === 'project_quote' || b.proposal_style == null) return true;
  return false;
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

      ${renderBody(b)}

      ${shouldShowTotal(b)
        ? `<div class="totals">
             <span class="total-label">Total</span>
             <span class="total-value">${fmt(b.total)}</span>
           </div>`
        : ''}

      ${shop.boilerplate_closing ? `<p class="boilerplate">${esc(shop.boilerplate_closing)}</p>` : ''}

      <footer>
        <span>${esc(shop.legal_name ?? '')}</span>
        <span>${shop.license_number ? esc(shop.license_number) + (shop.license_jurisdiction ? ' · ' + esc(shop.license_jurisdiction) : '') : ''}</span>
      </footer>
    </article>
  </body>
</html>`;
}
