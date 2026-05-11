/**
 * POST /api/bids/generate
 *
 * Cloudflare Pages Function that runs the 4-agent generation pipeline:
 *
 *   1. Pricing   — deterministic math over loaded labor + materials +
 *                  capacity (lib/pricing.ts). Numbers come from Supabase
 *                  queries, never the LLM.
 *   2. Composition (streaming) — Anthropic Claude generates the bid in
 *                  the company's voice. Streams tokens via SSE.
 *   3. Exclusions verification — pure substring/keyword check against
 *                  the company's standard exclusions for the service line.
 *
 * Returns text/event-stream with two event types:
 *   data: {"type": "token", "text": "..."}     — bid draft delta
 *   data: {"type": "done", "result": {...}}    — final structured result
 */

import Anthropic from '@anthropic-ai/sdk';

import { client as supabaseClient, type CloudflareEnv } from '../../../src/lib/supabase';
import { computePricing, type LaborItem } from '../../../src/lib/pricing';

export const onRequestPost: PagesFunction<CloudflareEnv> = async (ctx) => {
  const env = ctx.env;
  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const {
    company_id,
    service_line,
    client_name,
    scope_summary,
    labor_plan,
    material_quantity,
    // client_segment is captured for parity with the FastAPI route
    // (Follow-up cadence reads it on SENT) but the streaming flow
    // here stops at DRAFT_GENERATED / EXCLUSIONS_REVIEW.
    client_segment: _client_segment = 'repeat',
  } = body;

  if (!company_id || !service_line || !labor_plan || material_quantity == null) {
    return new Response('Missing required fields', { status: 400 });
  }

  // ── 1. Pricing ────────────────────────────────────────────────
  const pricing = await computePricing({
    companyId: company_id,
    serviceLine: service_line,
    laborPlan: labor_plan as LaborItem[],
    materialQuantity: material_quantity,
    estimatedStartDate: new Date(),
    env,
  });

  // ── 2 + 3. Composition + verification (streamed SSE) ─────────
  const sb = supabaseClient(env, 'anon');
  const { data: voice } = await sb
    .from('voice_patterns')
    .select('*')
    .eq('company_id', company_id)
    .maybeSingle();
  const { data: sl } = await sb
    .from('service_lines')
    .select('typical_scope_text, standard_exclusions')
    .eq('company_id', company_id)
    .eq('line_name', service_line)
    .maybeSingle();

  const exclusionsRequired: string[] = sl?.standard_exclusions ?? [];

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured in Cloudflare environment' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const client = new Anthropic({ apiKey });

  const systemPrompt = `You write specialty-contractor bid documents in the
company's own voice. You have:
- The company's voice patterns (tone, sentence length, preferred terms, boilerplate)
- The service-line scope template
- A pre-computed pricing breakdown (authoritative — do NOT change numbers)
- The standard exclusions for this service line

Output format (markdown):
1. Greeting / boilerplate intro (in voice)
2. Project header (client, address, brief description)
3. Scope of work (use scope template language; specific to this job)
4. Inclusions (call them out explicitly)
5. **Exclusions** (list ALL standard exclusions for this service line — do not skip any)
6. Pricing (use exact numbers from the pricing breakdown)
7. Payment terms and warranty (from boilerplate)
8. Boilerplate closing

DO NOT invent or modify pricing numbers. DO NOT skip exclusions.
Return ONLY the markdown bid document — no preamble, no code fence.`;

  const companyContext = `COMPANY VOICE PROFILE (stable):
${JSON.stringify({
  tone: voice?.tone,
  preferred_terms: voice?.preferred_terms,
  boilerplate_intro: voice?.boilerplate_intro,
  boilerplate_scope_intro: voice?.boilerplate_scope_intro,
  boilerplate_terms: voice?.boilerplate_terms,
  boilerplate_warranty: voice?.boilerplate_warranty,
  boilerplate_closing: voice?.boilerplate_closing,
}, null, 2)}

SERVICE LINE: ${service_line}
TYPICAL SCOPE TEMPLATE: ${sl?.typical_scope_text ?? ''}
STANDARD EXCLUSIONS (include ALL of these):
${exclusionsRequired.map((e) => `  - ${e}`).join('\n') || '  (none)'}`;

  const userMsg = `SCOPE FROM INTAKE:
${scope_summary}

CLIENT:
- Name: ${client_name}

PRICING (authoritative — copy these numbers exactly):
- Target price: $${pricing.target_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
- Labor: ${pricing.labor.total_hours} hours, $${pricing.labor.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
- Materials: $${(pricing.materials.subtotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
- Overhead: $${pricing.overhead.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
- Total margin: ${pricing.profit.target_margin_pct}%

Write the bid document.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const model = env.DEFAULT_MODEL_SONNET ?? 'claude-sonnet-4-6';
        const chunks: string[] = [];

        // client.messages.stream() returns a MessageStream that emits
        // 'text' events for each delta. Use .on() + finalMessage()
        // per the Anthropic SDK's recommended streaming pattern.
        const msgStream = client.messages.stream({
          model,
          max_tokens: 3000,
          temperature: 0.4,
          system: [
            { type: 'text', text: systemPrompt },
            {
              type: 'text',
              text: companyContext,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userMsg }],
        });

        msgStream.on('text', (text: string) => {
          chunks.push(text);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'token', text })}\n\n`),
          );
        });

        await msgStream.finalMessage();

        const draft = chunks.join('');
        const verification = verifyExclusions(draft, exclusionsRequired);
        const result = {
          state: verification.all_present ? 'DRAFT_GENERATED' : 'EXCLUSIONS_REVIEW',
          pricing: { ...pricing, narrative: pricing_narrative(pricing) },
          composition: {
            draft_markdown: draft,
            exclusions_verified: verification.all_present,
            exclusions_present: verification.present,
            exclusions_missing: verification.missing,
            total_required: exclusionsRequired.length,
          },
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done', result })}\n\n`),
        );
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    },
  });
};

// ─── helpers ─────────────────────────────────────────────────────

function pricing_narrative(p: any): string {
  return (
    `Target price $${p.target_price.toLocaleString()}: ${p.labor.total_hours} labor hours ` +
    `at $${p.labor.subtotal.toLocaleString()}, materials $${(p.materials.subtotal ?? 0).toLocaleString()}, ` +
    `${p.overhead.pct}% overhead, ${p.profit.target_margin_pct}% target margin. ` +
    `Capacity at start: ${Math.round((p.capacity_utilization_at_start ?? 0) * 100)}% — ` +
    `${p.capacity_modifier.rationale}.`
  );
}

const STOPWORDS = new Set([
  'the','a','an','of','to','in','on','and','or','for','with',
  'is','are','be','by','as','at','from','not','should','this',
  'that','any','all',
]);

function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /[a-z][a-z-]+/g;
  let m: RegExpExecArray | null;
  const lower = text.toLowerCase();
  while ((m = re.exec(lower)) !== null) {
    if (!STOPWORDS.has(m[0])) out.push(m[0]);
  }
  return out;
}

function isPresent(exclusion: string, draft: string): boolean {
  const exclTokens = tokenize(exclusion);
  if (exclTokens.length === 0) return false;
  // Verbatim 5-word phrase check
  const phrase = exclTokens.slice(0, 5).join(' ');
  if (phrase && tokenize(draft).join(' ').includes(phrase)) return true;
  // Token-set overlap >= 70%
  const draftTokens = new Set(tokenize(draft));
  const overlap = exclTokens.filter((t) => draftTokens.has(t)).length;
  return overlap / Math.max(exclTokens.length, 1) >= 0.7;
}

function verifyExclusions(draft: string, required: string[]) {
  const present: string[] = [];
  const missing: string[] = [];
  for (const ex of required) {
    if (isPresent(ex, draft)) present.push(ex);
    else missing.push(ex);
  }
  return { all_present: missing.length === 0, present, missing };
}
