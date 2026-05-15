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

/** Direction of the document relative to the operator.
 *
 * outbound      — operator → client. The five proposal styles fall
 *                 under this (project_quote, partnership, etc.) and
 *                 these are the docs the quote wizard handles.
 * inbound       — client / GC / designer → operator. Plans,
 *                 selections, RFI received, scoping emails. These
 *                 route to a project file, not the quote editor.
 * operator_own  — operator's own records (vendor invoices, spec
 *                 templates they re-use). Feed cost basis + the
 *                 shape library; never get sent.
 */
export type Direction = 'outbound' | 'inbound' | 'operator_own';

export type Classification =
  // outbound proposals (operator-authored)
  | 'project_quote'
  | 'partnership'
  | 'consulting'
  | 'rfi_received'           // a buyer's RFI sitting in front of an operator
  | 'change_request'
  // inbound (sent to the operator — inputs for producing a quote)
  | 'architectural_plan'
  | 'elevation_drawing'
  | 'engineer_sealed'
  | 'spec_template'
  | 'takeoff'
  | 'selections_list'
  | 'email_thread'
  // operator-own
  | 'vendor_invoice'
  // catch-all
  | 'unknown';

/** Direction implied by each classification when the model omits it. */
const CLASSIFICATION_DIRECTION: Record<Classification, Direction> = {
  project_quote: 'outbound',
  partnership: 'outbound',
  consulting: 'outbound',
  rfi_received: 'inbound',
  change_request: 'outbound',
  architectural_plan: 'inbound',
  elevation_drawing: 'inbound',
  engineer_sealed: 'inbound',
  spec_template: 'inbound',
  takeoff: 'inbound',
  selections_list: 'inbound',
  email_thread: 'inbound',
  vendor_invoice: 'operator_own',
  unknown: 'outbound',
};

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
  /** Direction of the doc — see Direction type. The wizard routes
   * on this: outbound → quote editor; inbound + operator_own →
   * project file. */
  direction: Direction;
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

const EMPTY_EXTRACT: Omit<IntakeExtract, 'classification' | 'confidence' | 'direction'> = {
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
that arrived in a contractor's / agency's / homebuilder's inbox and
produce a SINGLE JSON object describing what it is.

Return ONLY the JSON object — no fences, no preamble, no closing.

Direction (pick exactly one). Tells the app whether this is something
the operator is producing vs. consuming:
- "outbound"     — Operator-authored. Goes to a client. The five
                   proposal styles below are all outbound.
- "inbound"      — Sent TO the operator. Plans, selections, RFI,
                   designer email. Inputs to producing a quote, not
                   the quote itself.
- "operator_own" — Operator's internal records. Vendor invoices,
                   spec templates they reuse. Cost data + reference.

Classification (pick exactly one). Determines the editor + shape the
app uses downstream:

OUTBOUND classes:
- "project_quote": Operator's bid with line items (qty/unit/price).
  Contractor or vendor style.
- "partnership": Supplier-to-customer partnership pitch. Need/solution,
  rebates, training, transition plan, multi-year term. No per-project
  line items.
- "consulting": Agency / studio / consulting proposal. Phases +
  deliverables. Often no per-unit pricing.
- "rfi_received": A buyer's RFI sitting in front of the operator —
  the operator needs to RESPOND. Lists requirements + vendor
  questions + submission instructions. (Direction is 'inbound' even
  though the operator will write an outbound response.)
- "change_request": Mid-job scope change (add a wall, switch finish).

INBOUND classes (sent TO the operator):
- "architectural_plan": Floor plans / structural drawings / full
  building set. Typically 8+ pages, lots of dimension labels, sheet
  index (A-1 site, A-2 elevations, S-1 foundation, etc.).
- "elevation_drawing": Façade drawing with material callouts
  ("Acrylic Stucco - Kendall Charcoal", "Board and batten Hardie",
  shingle colors). Single or few pages.
- "engineer_sealed": Stamped engineering doc, mostly dimensions, may
  have a P.Eng seal/stamp. Sparse text.
- "spec_template": Builder spec sheet with $ allowances by category
  (Foundation / Walls / Roof / Electrical / etc.) — a build standard,
  not a custom proposal. Often has "$ + GST" placeholder dollar
  amounts.
- "takeoff": Quantity survey. Tables of items + counts + dimensions
  derived from plans. Used to feed a quote.
- "selections_list": Homeowner's chosen finishes by room (tile, paint,
  flooring, hardware). Usually a Word doc or simple list.
- "email_thread": Multi-message scoping conversation between the
  operator, a designer, and/or a GC. Reply-quoted chains, multiple
  authors.

OPERATOR-OWN classes:
- "vendor_invoice": A supplier's invoice / sales order to the
  operator. Has BILL TO / SHIP TO addressed to the operator, an
  invoice/order number, line items with prices the operator PAID. This
  is cost data, not what they will quote.

CATCH-ALL:
- "unknown": Confidence too low to commit.

confidence: float 0-1.

Then populate the shape below. Use fields appropriate to the
classification. Unused fields stay as empty arrays / null.

{
  "classification": one of the values above,
  "direction": "outbound" | "inbound" | "operator_own",
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
- For rfi_received: line_items + rebate_terms + phases stay empty.
  Populate requirements, questions, deadline. Direction is 'inbound'.
- For consulting: phases is the primary output. line_items only
  populated if the doc actually has prices.
- For partnership: rebate_terms + term_months are the primary output.
  line_items empty.
- For change_request: line_items only (the adds/deletes).

Inbound + operator-own routing (Phase 1 — these route to a project
file, not the quote editor):
- For architectural_plan / elevation_drawing / engineer_sealed:
  DO NOT extract line_items. Drawings aren't proposals. Populate
  scope_summary with what the doc describes (e.g. "2-story addition
  plans, 2200 sqft, Manitoba code") and client_hints from any
  legible client/project labels. Direction is 'inbound'.
- For spec_template: don't extract dollar amounts ($-placeholders are
  templates). Populate scope_summary describing the spec scope.
  Direction is 'inbound' (sent by a builder to be used).
- For takeoff: line_items CAN be extracted — they're the takeoff
  rows themselves. Mark category appropriately. Direction is 'inbound'.
- For selections_list: don't extract line_items. Note categories
  (flooring, tile, paint) in scope_summary. Direction is 'inbound'.
- For email_thread: don't extract line_items. scope_summary should
  describe what's being discussed. Pull client_hints from the email
  thread participants. Direction is 'inbound'.
- For vendor_invoice: extract line_items (the operator's costs —
  used downstream as cost basis). category='materials' usually.
  Direction is 'operator_own'.

Strong signals for direction detection:
- SHIP TO / BILL TO / INVOICE NO / SALES ORDER NO → vendor_invoice,
  operator_own. The addressee is the operator.
- "Proposal to: [Person]" header, signature line at end → outbound.
- DRAWING NO / SHEET INDEX / dimension labels everywhere → plan.
- "Selections" / "Material Selection" / room-by-room finish list →
  selections_list.
- Reply-quoted "On [date] [name] wrote:" → email_thread.`;

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
    return { classification: 'unknown', confidence: 0, direction: 'outbound', ...EMPTY_EXTRACT };
  }

  const parsed = extractJson<Partial<IntakeExtract>>(raw);
  if (!parsed) {
    return {
      classification: 'unknown',
      confidence: 0,
      direction: 'outbound',
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
  // Direction: trust the model's explicit value, fall back to the
  // classification's implied direction.
  const direction: Direction =
    parsed.direction === 'outbound' ||
    parsed.direction === 'inbound' ||
    parsed.direction === 'operator_own'
      ? parsed.direction
      : CLASSIFICATION_DIRECTION[classification];

  return {
    classification,
    direction,
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
    | 'project_file'      // inbound + operator_own land here (Phase 2 wires it up)
    | 'unknown';
}

/** Deterministic routing from an extract. App code calls this; the
 * LLM never decides routing. */
export function decideRoute(extract: IntakeExtract): RouteDecision {
  const flow = flowFor(extract.classification, extract.direction);
  return {
    route: extract.confidence >= ROUTING_CONFIDENCE_THRESHOLD ? 'auto' : 'confirm',
    classification: extract.classification,
    confidence: extract.confidence,
    recommended_flow: flow,
  };
}

function flowFor(c: Classification, direction: Direction): RouteDecision['recommended_flow'] {
  // Inbound + operator-own docs route to the project file in Phase 2.
  // Until then, the wizard catches the signal and shows a warning
  // banner; the operator can still proceed through the quote editor
  // if they really want to.
  if (direction === 'inbound' || direction === 'operator_own') {
    if (c === 'rfi_received') return 'rfi_response_helper';
    return 'project_file';
  }
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

const ALL_CLASSIFICATIONS: ReadonlyArray<Classification> = [
  'project_quote',
  'partnership',
  'consulting',
  'rfi_received',
  'change_request',
  'architectural_plan',
  'elevation_drawing',
  'engineer_sealed',
  'spec_template',
  'takeoff',
  'selections_list',
  'email_thread',
  'vendor_invoice',
  'unknown',
];
function isClassification(v: unknown): v is Classification {
  return typeof v === 'string' && (ALL_CLASSIFICATIONS as readonly string[]).includes(v);
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
