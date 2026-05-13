/**
 * Intake agent — document understanding.
 *
 * Reads raw text (PDF body, pasted scope, voice transcript, email
 * body) and produces two outputs in one pass:
 *
 *   1. A *classification* with a confidence score. Five categories
 *      cover the corpus we've analyzed:
 *        - itemized_project_quote      (Cavy: qty/unit/price)
 *        - templated_partnership_pitch (Hardie: rebates, transition)
 *        - narrative_consulting_proposal (Paras: phases, deliverables)
 *        - inbound_rfi                 (uOttawa: buyer asking us)
 *        - change_request              (mid-job scope add)
 *
 *   2. A *structured extract* whose shape depends on the
 *      classification — line items for itemized quotes, phases for
 *      consulting, rebate terms for partnerships, requirements +
 *      questions for inbound RFIs, etc.
 *
 * Per the architecture: the LLM produces a structured object only.
 * App code routes on classification + confidence. Routing decisions
 * are deterministic, not model-driven.
 *
 * Confidence < 0.9 means the UI prompts the operator to confirm. The
 * threshold is exposed as ROUTING_CONFIDENCE_THRESHOLD so we can move
 * it down as the classifier gets calibrated.
 */
import { generateText, extractJson } from './ai';
import type { CloudflareEnv } from './supabase';

export type Classification =
  | 'project_quote'
  | 'partnership'
  | 'consulting'
  | 'rfi_received'
  | 'change_request'
  | 'unknown';

export const ROUTING_CONFIDENCE_THRESHOLD = 0.9;

export interface LineItem {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  category: string;
  confidence: 'high' | 'med' | 'low';
  source_excerpt?: string;
}

export interface IntakeExtract {
  classification: Classification;
  confidence: number;
  scope_summary: string;
  client_hints: {
    client_name: string | null;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    project_title: string | null;
    project_address: string | null;
  };
  // Shape depends on classification — see below for which keys are
  // populated for which classifications. All keys present; unused
  // ones empty.
  line_items: LineItem[];                    // itemized_project_quote
  phases: Array<{ name: string; deliverables: string[]; duration?: string }>; // consulting
  rebate_terms: Array<{ product: string; rebate: string; basis: string }>;    // partnership
  term_months: number | null;                                                  // partnership
  requirements: string[];                    // inbound_rfi
  questions: string[];                       // inbound_rfi
  deadline: string | null;                   // inbound_rfi
  flags: Array<{ kind: 'warn' | 'info'; text: string }>;
}

const EMPTY_EXTRACT: Omit<IntakeExtract, 'classification' | 'confidence'> = {
  scope_summary: '',
  client_hints: {
    client_name: null,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    project_title: null,
    project_address: null,
  },
  line_items: [],
  phases: [],
  rebate_terms: [],
  term_months: null,
  requirements: [],
  questions: [],
  deadline: null,
  flags: [],
};

const SYSTEM_PROMPT = `You are Brief's Intake agent. You read one document
(a proposal, RFP, scope, email, or transcript) and produce a SINGLE JSON
object describing what it is and what it contains.

Return ONLY the JSON object — no fences, no preamble, no closing.

Classification taxonomy (pick exactly one):
- "itemized_project_quote": Vendor-authored bid with line items
  (descriptions, quantities, units, prices). Contractor-style.
- "templated_partnership_pitch": Vendor-authored partnership/supply
  proposal. Need/Solution structure, rebates, training, transition
  plan. No per-project line items.
- "narrative_consulting_proposal": Agency/consulting proposal. Phases,
  deliverables, narrative. Typically no per-unit pricing.
- "inbound_rfi": A buyer asking vendors to respond. Lists requirements,
  asks questions, has submission instructions. Document is INCOMING.
- "change_request": Mid-job scope change (add a wall, switch finish).
- "unknown": Confidence too low to commit.

confidence: float 0-1, your honest read.

Then populate the shape below. Use the fields appropriate to the
classification. Unused fields stay as empty arrays / null.

{
  "classification": one of the values above,
  "confidence": 0-1,
  "scope_summary": "1-2 sentence plain-English summary",
  "client_hints": {
    "client_name": string | null,    // company/homeowner commissioning
    "contact_name": string | null,
    "contact_email": string | null,
    "contact_phone": string | null,
    "project_title": string | null,
    "project_address": string | null
  },
  "line_items": [
    { "description": string, "qty": number, "unit": string,
      "unit_price": number, "category": string,
      "confidence": "high"|"med"|"low",
      "source_excerpt": "<=80 chars" }
  ],
  "phases": [
    { "name": string, "deliverables": [string], "duration": string|null }
  ],
  "rebate_terms": [
    { "product": string, "rebate": string, "basis": string }
  ],
  "term_months": number | null,
  "requirements": [string],
  "questions": [string],
  "deadline": string | null,
  "flags": [
    { "kind": "warn"|"info", "text": "short, specific, <200 chars" }
  ]
}

Units to use for line_items (widen beyond construction when needed):
each | hr | sqft | lf | cy | day | lump_sum | month | phase | project |
retainer | msf | per_home | %

Categories for line_items (widen for non-construction):
labor | materials | subs | permits | equipment | services | strategy |
production | rebate | marketing_support | training | other

Rules:
- Do not invent. If the source doesn't say something, return null/[].
- For inbound_rfi: line_items + rebate_terms + phases stay empty.
  Populate requirements, questions, deadline, and flag the doc as RFI.
- For narrative_consulting_proposal: phases is the primary output.
  line_items only populated if the doc actually has prices.
- For templated_partnership_pitch: rebate_terms + term_months are the
  primary output. line_items empty.
- For change_request: line_items only (the adds/deletes), flagged as
  change-order content.`;

export interface ClassifyOpts {
  /** Max chars of input text the model sees. Default 16k. */
  truncate?: number;
}

/** Run the full intake pass on a piece of raw text. */
export async function classifyAndExtract(
  env: CloudflareEnv,
  rawText: string,
  hints: { client_name?: string; project_title?: string } = {},
  opts: ClassifyOpts = {},
): Promise<IntakeExtract> {
  const text = rawText.slice(0, opts.truncate ?? 16000);
  const userMsg =
    `Hints from operator: client=${hints.client_name ?? '(unknown)'}, project=${hints.project_title ?? '(unknown)'}\n\n` +
    `Document text:\n--- BEGIN ---\n${text}\n--- END ---\n\n` +
    `Return the JSON now.`;

  let raw = '';
  try {
    raw = await generateText(env, {
      max_tokens: 4000,
      temperature: 0.2,
      json: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    });
  } catch (e) {
    console.warn('[intake] generation failed', e);
    return { classification: 'unknown', confidence: 0, ...EMPTY_EXTRACT };
  }

  const parsed = extractJson<Partial<IntakeExtract>>(raw);
  if (!parsed) {
    return {
      classification: 'unknown',
      confidence: 0,
      ...EMPTY_EXTRACT,
      flags: [
        {
          kind: 'warn',
          text: `Couldn't parse Intake output. Raw: ${raw.slice(0, 200)}`,
        },
      ],
    };
  }

  // Validate + coerce. The model is generally well-behaved with
  // JSON-mode but defensive coercion is cheap insurance.
  const classification = isClassification(parsed.classification)
    ? parsed.classification
    : 'unknown';
  const confidence = clamp01(Number(parsed.confidence ?? 0));

  return {
    classification,
    confidence,
    scope_summary: typeof parsed.scope_summary === 'string' ? parsed.scope_summary : '',
    client_hints: {
      client_name: nullableString(parsed.client_hints?.client_name),
      contact_name: nullableString(parsed.client_hints?.contact_name),
      contact_email: nullableString(parsed.client_hints?.contact_email),
      contact_phone: nullableString(parsed.client_hints?.contact_phone),
      project_title: nullableString(parsed.client_hints?.project_title),
      project_address: nullableString(parsed.client_hints?.project_address),
    },
    line_items: Array.isArray(parsed.line_items)
      ? parsed.line_items.map(coerceLineItem).filter((li): li is LineItem => li != null)
      : [],
    phases: Array.isArray(parsed.phases)
      ? parsed.phases
          .filter((p): p is { name: string; deliverables: string[]; duration?: string } =>
            p != null && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string',
          )
          .map((p) => ({
            name: p.name,
            deliverables: Array.isArray(p.deliverables)
              ? p.deliverables.filter((d): d is string => typeof d === 'string')
              : [],
            duration: typeof p.duration === 'string' ? p.duration : undefined,
          }))
      : [],
    rebate_terms: Array.isArray(parsed.rebate_terms)
      ? parsed.rebate_terms
          .filter(
            (r): r is { product: string; rebate: string; basis: string } =>
              r != null && typeof r === 'object',
          )
          .map((r) => ({
            product: String(r.product ?? ''),
            rebate: String(r.rebate ?? ''),
            basis: String(r.basis ?? ''),
          }))
      : [],
    term_months: typeof parsed.term_months === 'number' ? parsed.term_months : null,
    requirements: Array.isArray(parsed.requirements)
      ? parsed.requirements.filter((r): r is string => typeof r === 'string')
      : [],
    questions: Array.isArray(parsed.questions)
      ? parsed.questions.filter((q): q is string => typeof q === 'string')
      : [],
    deadline: nullableString(parsed.deadline),
    flags: Array.isArray(parsed.flags)
      ? parsed.flags
          .filter(
            (f): f is { kind: 'warn' | 'info'; text: string } =>
              f != null && typeof f === 'object' && typeof (f as { text?: unknown }).text === 'string',
          )
          .map((f) => ({
            kind: f.kind === 'warn' ? 'warn' : 'info',
            text: f.text,
          }))
      : [],
  };
}

export interface RouteDecision {
  route: 'auto' | 'confirm';
  classification: Classification;
  confidence: number;
  recommended_flow:
    | 'quote_production'
    | 'partnership_editor'
    | 'consulting_editor'
    | 'rfi_response_helper'
    | 'change_order_editor'
    | 'unknown';
}

/** Deterministic routing from an extract. App code calls this; the
 * LLM never decides routing. */
export function decideRoute(extract: IntakeExtract): RouteDecision {
  const flow = flowFor(extract.classification);
  return {
    route: extract.confidence >= ROUTING_CONFIDENCE_THRESHOLD ? 'auto' : 'confirm',
    classification: extract.classification,
    confidence: extract.confidence,
    recommended_flow: flow,
  };
}

function flowFor(c: Classification): RouteDecision['recommended_flow'] {
  switch (c) {
    case 'project_quote':
      return 'quote_production';
    case 'partnership':
      return 'partnership_editor';
    case 'consulting':
      return 'consulting_editor';
    case 'rfi_received':
      return 'rfi_response_helper';
    case 'change_request':
      return 'change_order_editor';
    default:
      return 'unknown';
  }
}

function isClassification(v: unknown): v is Classification {
  return (
    v === 'project_quote' ||
    v === 'partnership' ||
    v === 'consulting' ||
    v === 'rfi_received' ||
    v === 'change_request' ||
    v === 'unknown'
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function nullableString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'unknown') return null;
  return t;
}

function coerceLineItem(raw: unknown): LineItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.description !== 'string') return null;
  return {
    description: r.description,
    qty: Number(r.qty ?? 0) || 0,
    unit: typeof r.unit === 'string' ? r.unit : 'lump_sum',
    unit_price: Number(r.unit_price ?? 0) || 0,
    category: typeof r.category === 'string' ? r.category : 'other',
    confidence: r.confidence === 'high' || r.confidence === 'med' || r.confidence === 'low' ? r.confidence : 'low',
    source_excerpt: typeof r.source_excerpt === 'string' ? r.source_excerpt : undefined,
  };
}
