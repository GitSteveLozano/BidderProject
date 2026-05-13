/**
 * POST /api/quote/scan
 *
 * Reads an uploaded scope (PDF text, pasted scope, voice transcript)
 * and extracts the structured proposal in one pass. Widened in
 * migration 009 to handle four proposal styles, not just contractor
 * line items.
 *
 * SSE events:
 *   data: {"type":"progress","percent":N}
 *   data: {"type":"proposal_style","payload":{style,confidence,program_type,term_months}}
 *   data: {"type":"line_item","payload":{...}}             project_quote
 *   data: {"type":"phase","payload":{name,deliverables[],duration}}  consulting/partnership
 *   data: {"type":"rebate_term","payload":{product,rebate,basis}}    partnership
 *   data: {"type":"requirement","payload":{text}}          rfi_received
 *   data: {"type":"question","payload":{text}}             rfi_received
 *   data: {"type":"flag","payload":{kind,text}}
 *   data: {"type":"done","payload":{proposal_style, line_item_count,
 *     phase_count, rebate_term_count, flag_count, scope_summary,
 *     program_type, term_months}}
 *   data: {"type":"error","message":string}
 *
 * Empty line_items is no longer a parse failure — narrative
 * proposals (consulting / partnership) legitimately have zero items.
 * The wizard reads proposal_style and renders the right editor.
 */
import type { APIRoute } from 'astro';

import { streamText, extractJson } from '@/lib/ai';

export const prerender = false;

const SYSTEM_PROMPT = `You read a proposal document and extract its structure
for a bid-management app. The author could be a contractor (itemized
labor + materials), an agency/consultant (phases + deliverables, often
no per-unit pricing), a supplier (partnership pitch with rebates), or
the document could be an INBOUND RFI/RFP from a buyer asking the user
to respond.

Return ONLY a JSON object of the exact shape below — no fences, no
preamble, no closing.

{
  "proposal_style": "project_quote" | "partnership" | "consulting" | "rfi_received" | "unknown",
  "confidence": 0-1 (your honest read),
  "program_type": "one_off" | "recurring" | "rebate" | null,
  "term_months": number | null,
  "scope_summary": "1-2 sentence plain-English summary",
  "line_items": [
    {
      "description": "string",
      "qty": number,
      "unit": "each" | "hr" | "sqft" | "lf" | "cy" | "day" | "lump_sum" |
              "msf" | "per_home" | "pct" |
              "month" | "phase" | "project" | "package" | "retainer",
      "unit_price": number,
      "category": "labor" | "materials" | "subs" | "permits" | "equipment" |
                  "services" | "strategy" | "production" |
                  "rebate" | "marketing_support" | "training" | "discount" |
                  "subscription" | "other",
      "confidence": "high" | "med" | "low",
      "source_excerpt": "≤ 80 chars from the source supporting this item"
    }
  ],
  "phases": [
    { "name": "string", "deliverables": ["string"], "duration": "string"|null }
  ],
  "rebate_terms": [
    { "product": "string", "rebate": "string", "basis": "string" }
  ],
  "requirements": ["string"],
  "questions": ["string"],
  "deadline": "string" | null,
  "flags": [
    { "kind": "warn" | "info", "text": "short, specific, under 200 chars" }
  ]
}

Style guide — pick exactly one for proposal_style:

- "project_quote": contractor or vendor bid for a specific project
  with discrete line items (qty/unit/price). Populate line_items.
  Leave phases / rebate_terms / requirements / questions empty.

- "partnership": supplier-to-customer partnership pitch. Need/solution
  structure, rebates, training/transition plans, multi-year term.
  Populate rebate_terms + term_months + program_type='rebate'. Phases
  optional (e.g., transition plan). line_items usually empty.

- "consulting": agency, studio, or consulting proposal. Phase-based
  narrative with deliverables under each. line_items only if the doc
  actually contains prices. program_type='one_off' or 'recurring'.

- "rfi_received": an INBOUND request — a buyer asking vendors to
  respond. Lists requirements, asks questions, has submission
  instructions. Populate requirements + questions + deadline. Do not
  fabricate line_items or rebate_terms.

- "unknown": confidence too low to commit.

Rules:
- Pull only what's in the source. Do not invent items, phases, or
  rebates. Better to return empty than to guess.
- Aim for: 6-12 line_items OR 2-6 phases OR 2-8 rebate_terms OR 4-12
  requirements depending on style. Concise — operator will edit.
- flags: warn for things to confirm (mismatched dimensions, scope
  ambiguity, INBOUND RFI when an outbound bid is the usual case).
  info for context that affects pricing or interpretation.
- For rfi_received, ALWAYS include a warn flag: "This looks like an
  inbound RFI — Brief assumes you're authoring an outbound bid. Want
  to draft just the narrative response sections?"`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return new Response('Cloudflare runtime not available', { status: 500 });
  if (!locals.user || !locals.membership) {
    return new Response('Not authenticated', { status: 401 });
  }
  if (!env.AI) {
    return new Response('Workers AI binding not configured', { status: 500 });
  }

  let body: { content?: string; client_name?: string; project_title?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.content || body.content.trim().length < 30) {
    return new Response('content too short to scan', { status: 400 });
  }
  const content: string = body.content;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        emit({ type: 'progress', percent: 5 });

        const userMsg =
          `Client: ${body.client_name ?? '(unknown)'}\n` +
          `Project: ${body.project_title ?? '(unknown)'}\n\n` +
          `Document text:\n--- BEGIN ---\n${content.slice(0, 16000)}\n--- END ---\n\n` +
          `Classify, then extract. Return the JSON.`;

        let full = '';
        let percent = 5;
        for await (const chunk of streamText(env, {
          max_tokens: 4000,
          temperature: 0.2,
          json: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
        })) {
          full += chunk;
          percent = Math.min(percent + 3, 92);
          emit({ type: 'progress', percent });
        }

        const parsed = extractJson<{
          proposal_style?: string;
          confidence?: number;
          program_type?: string;
          term_months?: number;
          scope_summary?: string;
          line_items?: Array<Record<string, unknown>>;
          phases?: Array<Record<string, unknown>>;
          rebate_terms?: Array<Record<string, unknown>>;
          requirements?: unknown[];
          questions?: unknown[];
          deadline?: unknown;
          flags?: Array<{ kind?: string; text?: string }>;
        }>(full);

        if (!parsed) {
          // Couldn't get usable structure out — fall back to a
          // best-effort scope summary and warn. Operator can still
          // proceed manually.
          emit({
            type: 'flag',
            payload: {
              kind: 'warn',
              text: `Couldn't parse Brief's output. Start the scope manually or retry.`,
            },
          });
          emit({ type: 'flag', payload: { kind: 'info', text: full.slice(0, 800) } });
        }

        const proposal_style = normalizeStyle(parsed?.proposal_style);
        const confidence =
          typeof parsed?.confidence === 'number' ? clamp01(parsed.confidence) : 0.5;
        const program_type = normalizeProgramType(parsed?.program_type);
        const term_months =
          typeof parsed?.term_months === 'number' ? parsed.term_months : null;
        const scope_summary =
          typeof parsed?.scope_summary === 'string' ? parsed.scope_summary : '';

        // Emit classification first so the wizard can switch editors
        // before line items / phases start arriving.
        emit({
          type: 'proposal_style',
          payload: { style: proposal_style, confidence, program_type, term_months },
        });

        const line_items = Array.isArray(parsed?.line_items) ? parsed!.line_items : [];
        const phases = Array.isArray(parsed?.phases) ? parsed!.phases : [];
        const rebate_terms = Array.isArray(parsed?.rebate_terms) ? parsed!.rebate_terms : [];
        const requirements = Array.isArray(parsed?.requirements) ? parsed!.requirements : [];
        const questions = Array.isArray(parsed?.questions) ? parsed!.questions : [];
        const flags = Array.isArray(parsed?.flags) ? parsed!.flags : [];

        // Line items — defensive numeric coercion. Only fires when
        // the doc actually has them.
        for (let i = 0; i < line_items.length; i += 1) {
          const raw = line_items[i] ?? {};
          const qty = Number(raw.qty ?? 0);
          const unit_price = Number(raw.unit_price ?? 0);
          const subtotal = round(qty * unit_price, 2);
          emit({
            type: 'line_item',
            payload: {
              description:
                typeof raw.description === 'string' ? raw.description : '(unknown)',
              qty,
              unit: typeof raw.unit === 'string' ? raw.unit : 'lump_sum',
              unit_price,
              subtotal,
              category: typeof raw.category === 'string' ? raw.category : 'other',
              confidence: typeof raw.confidence === 'string' ? raw.confidence : 'low',
              source_excerpt:
                typeof raw.source_excerpt === 'string' ? raw.source_excerpt : null,
              position: i + 1,
            },
          });
        }

        // Phases — for consulting / partnership.
        for (let i = 0; i < phases.length; i += 1) {
          const p = phases[i] ?? {};
          emit({
            type: 'phase',
            payload: {
              position: i + 1,
              name: typeof p.name === 'string' ? p.name : `Phase ${i + 1}`,
              deliverables: Array.isArray(p.deliverables)
                ? (p.deliverables as unknown[]).filter(
                    (d): d is string => typeof d === 'string',
                  )
                : [],
              duration: typeof p.duration === 'string' ? p.duration : null,
            },
          });
        }

        // Rebate terms — for partnership.
        for (const r of rebate_terms) {
          emit({
            type: 'rebate_term',
            payload: {
              product: typeof r.product === 'string' ? r.product : '',
              rebate: typeof r.rebate === 'string' ? r.rebate : '',
              basis: typeof r.basis === 'string' ? r.basis : '',
            },
          });
        }

        // RFI fields.
        for (const r of requirements) {
          if (typeof r === 'string') emit({ type: 'requirement', payload: { text: r } });
        }
        for (const q of questions) {
          if (typeof q === 'string') emit({ type: 'question', payload: { text: q } });
        }

        for (const f of flags) emit({ type: 'flag', payload: f });

        emit({ type: 'progress', percent: 100 });
        emit({
          type: 'done',
          payload: {
            proposal_style,
            confidence,
            program_type,
            term_months,
            scope_summary,
            line_item_count: line_items.length,
            phase_count: phases.length,
            rebate_term_count: rebate_terms.length,
            requirement_count: requirements.length,
            question_count: questions.length,
            flag_count: flags.length,
            parsed: parsed != null,
          },
        });
        controller.close();
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
    },
  });
};

function normalizeStyle(
  v: unknown,
): 'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'unknown' {
  return v === 'project_quote' ||
    v === 'partnership' ||
    v === 'consulting' ||
    v === 'rfi_received' ||
    v === 'unknown'
    ? v
    : 'project_quote'; // default to the legacy behavior when missing
}

function normalizeProgramType(v: unknown): 'one_off' | 'recurring' | 'rebate' | null {
  return v === 'one_off' || v === 'recurring' || v === 'rebate' ? v : null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}
