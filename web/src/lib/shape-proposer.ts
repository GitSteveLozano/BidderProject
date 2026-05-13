/**
 * Shape proposer — the LLM call behind the 5th wizard path.
 *
 * When Intake can't match a doc to one of the four fast-path
 * proposal_styles with high confidence, this proposes a custom
 * Shape (named sections) from the doc text. The wizard shows it as
 * a one-click confirmation card; the operator accepts (default) or
 * edits.
 *
 * The proposer is deliberately conservative: prefer 3-5 sections,
 * favour familiar names (Cover letter, Rebate program, Phases,
 * etc.), and don't invent content — that's the editor's job.
 */
import { generateText, extractJson } from './ai';
import { normalizeShape, type Shape } from './shape';
import type { CloudflareEnv } from './supabase';

const SYSTEM = `You read a proposal/bid/RFP/quote document that doesn't fit
any of the standard templates (itemized project quote, partnership pitch
with rebates, consulting deck with phases, inbound RFI). Your job is to
propose a SHAPE for it — a short list of named sections — so a bid app
can render it without forcing it into a wrong template.

Return ONLY this JSON shape, no fences:

{
  "name": "short kebab-style or sentence label (e.g. 'rebate proposal',
           'design + build SOW', 'subscription pitch')",
  "description": "<=120 chars, what this kind of doc is for",
  "sections": [
    { "kind": "text",     "key": "snake_case_id", "label": "Human label" },
    { "kind": "bullets",  "key": "...", "label": "..." },
    { "kind": "kv_table", "key": "...", "label": "...",
      "headers": ["Col 1", "Col 2"] }
  ],
  "total_required": false
}

Section kinds:
- "text": a paragraph or two of prose (cover letter, scope summary,
          approach, qualifications, terms, closing).
- "bullets": a short list (deliverables, exclusions, milestones,
             requirements answered).
- "kv_table": a structured table (rebate rates, fee schedule,
              pricing tiers, training plan). headers is the column
              labels — 2 or 3 columns max.

Rules:
- 3-6 sections, ordered top-to-bottom as the proposal should read.
- Lift names from the source when it has explicit headings; otherwise
  pick conventional names.
- DO NOT include section content. The operator fills the body via the
  editor. You're proposing the SHAPE only.
- total_required: true only when the doc clearly invoices a specific
  dollar amount. For rebate programs, partnerships, narrative pitches,
  or RFP responses — usually false.
- Prefer reuse — if the doc is "rebate proposal with transition plan",
  use the same section names you'd use for a similar doc.`;

export interface ProposeOptions {
  /** Operator's typed hints — informs section naming. */
  client_name?: string;
  project_title?: string;
}

export async function proposeShape(
  env: CloudflareEnv,
  rawText: string,
  opts: ProposeOptions = {},
): Promise<Shape | null> {
  if (!env.AI) return null;
  const text = (rawText ?? '').trim();
  if (text.length < 40) return null;

  const userMsg =
    `Context: client="${opts.client_name ?? '(unknown)'}", project="${opts.project_title ?? '(unknown)'}".\n\n` +
    `Document:\n--- BEGIN ---\n${text.slice(0, 8000)}\n--- END ---\n\n` +
    `Propose the shape JSON now.`;

  let raw = '';
  try {
    raw = await generateText(env, {
      max_tokens: 800,
      temperature: 0.2,
      json: true,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
    });
  } catch (e) {
    console.warn('[shape-proposer] generation failed', e);
    return null;
  }
  const parsed = extractJson<unknown>(raw);
  const shape = normalizeShape(parsed);
  if (!shape || shape.sections.length === 0) {
    console.warn('[shape-proposer] empty / invalid shape, raw:', raw.slice(0, 300));
    return null;
  }
  return shape;
}

/**
 * Pre-populate section content from the source doc. Runs after the
 * operator accepts the proposed shape — saves them from filling a
 * blank editor. Best-effort; operator can fully edit after.
 */
const PREFILL_SYSTEM = `You fill in the BODY of each section of a proposal
shape, using the source doc as the only source of truth. Return ONLY
this JSON shape (matching the section list given):

[
  { "kind": "text",     "key": "...", "label": "...", "body": "..." },
  { "kind": "bullets",  "key": "...", "label": "...", "items": ["..."] },
  { "kind": "kv_table", "key": "...", "label": "...",
    "headers": [...], "rows": [{ "Col 1": "...", "Col 2": "..." }] }
]

Rules:
- Match section keys/kinds verbatim — don't reorder, add, or remove.
- Pull content from the source. Don't invent.
- text bodies: ≤ 3 short paragraphs, plain prose, no markdown.
- bullets: lift verbatim phrases where possible.
- kv_table rows: extract rate tables / fee schedules / etc directly
  from the source. Empty array is fine if nothing matches.
- A section with no source material gets empty content — empty body,
  [] items, or [] rows.`;

export async function prefillShape(
  env: CloudflareEnv,
  shape: Shape,
  rawText: string,
): Promise<Shape> {
  if (!env.AI) return shape;
  const text = (rawText ?? '').trim();
  if (!text || shape.sections.length === 0) return shape;

  const skeleton = shape.sections.map((s) => {
    if (s.kind === 'text') return { kind: s.kind, key: s.key, label: s.label, body: '' };
    if (s.kind === 'bullets') return { kind: s.kind, key: s.key, label: s.label, items: [] };
    return {
      kind: s.kind,
      key: s.key,
      label: s.label,
      headers: s.headers,
      rows: [],
    };
  });

  const userMsg =
    `Shape skeleton (fill in body / items / rows for each):\n` +
    `${JSON.stringify(skeleton, null, 2)}\n\n` +
    `Source doc:\n--- BEGIN ---\n${text.slice(0, 12000)}\n--- END ---\n\n` +
    `Return the filled array JSON.`;

  let raw = '';
  try {
    raw = await generateText(env, {
      max_tokens: 3000,
      temperature: 0.2,
      json: true,
      messages: [
        { role: 'system', content: PREFILL_SYSTEM },
        { role: 'user', content: userMsg },
      ],
    });
  } catch (e) {
    console.warn('[shape-proposer] prefill failed', e);
    return shape;
  }
  // The prefill returns an array; wrap as a Shape to reuse the
  // normalizer.
  const parsed = extractJson<unknown>(raw);
  // Accept either bare array or wrapped { sections: [] }
  const sectionsRaw = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { sections?: unknown[] }).sections)
      ? (parsed as { sections: unknown[] }).sections
      : null;
  if (!sectionsRaw) {
    console.warn('[shape-proposer] prefill returned non-array, raw:', raw.slice(0, 300));
    return shape;
  }
  const filled = normalizeShape({
    name: shape.name,
    description: shape.description,
    sections: sectionsRaw,
    total_required: shape.total_required,
  });
  return filled ?? shape;
}
