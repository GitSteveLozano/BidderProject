/**
 * Vision agent — Llama 3.2 11B Vision Instruct on Cloudflare
 * Workers AI. Phase 6 pilot.
 *
 * Use cases:
 *   • Elevation drawings — extract material callouts ("Acrylic stucco
 *     Kendall Charcoal", "Hardie board & batten Iron Gray", "Asphalt
 *     shingles Charcoal").
 *   • Floor plans — extract room labels + dimensions when readable.
 *   • Photos of selections lists or whiteboards — best-effort text
 *     extraction.
 *
 * Workers AI Vision-Instruct accepts an `image` byte-array. We send
 * the raw bytes plus a structured prompt and ask for JSON.
 *
 * Free tier: no per-image cost under the Workers AI daily allowance.
 */
import { extractJson } from './ai';
import type { CloudflareEnv } from './supabase';

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

export type VisionDocKind = 'elevation' | 'plan' | 'selections' | 'other';

export interface MaterialCallout {
  material: string;
  color?: string | null;
  location?: string | null;
  source_excerpt?: string | null;
  confidence: 'high' | 'med' | 'low';
}

export interface RoomEntry {
  name: string;
  dimensions?: string | null;
  area_sqft?: number | null;
  notes?: string | null;
}

export interface VisionExtract {
  doc_kind: VisionDocKind;
  scope_summary: string;
  material_callouts: MaterialCallout[];
  rooms: RoomEntry[];
  text_observed: string[];
  confidence: number;
}

const EMPTY_EXTRACT: VisionExtract = {
  doc_kind: 'other',
  scope_summary: '',
  material_callouts: [],
  rooms: [],
  text_observed: [],
  confidence: 0,
};

const SYSTEM_PROMPT = `You are Brief's Vision agent. You read ONE image
(typically an elevation drawing, floor plan, selections sheet photo, or
similar) and produce a SINGLE JSON object describing what's in it.

Return ONLY the JSON object — no fences, no preamble.

Pick exactly one doc_kind:
- "elevation": Façade drawing with visible material callouts (stucco,
  Hardie, shingles, brick) and often color names. Side-view of a
  building.
- "plan": Floor plan / site plan — top-down view, room labels,
  dimension lines.
- "selections": Photo of a selections list, mood board, finish
  sample, or whiteboard with material choices.
- "other": Image is unclear or unrelated.

material_callouts: each material visible with its color/finish.
  - material: e.g. "Acrylic stucco", "Hardie board and batten",
    "Asphalt shingles", "Brick veneer", "Stone veneer".
  - color: the exact color/finish name written on the drawing (e.g.
    "Kendall Charcoal", "Iron Gray"). Null if not visible.
  - location: where on the building it's applied. Null if unclear.
  - source_excerpt: the literal text you read off the drawing.

rooms: only populate for floor plans. Each room with its label and
  any dimensions you can read.

text_observed: a list of ALL readable text in the image, in roughly
  the order it appears. Useful as a backstop if you can't fully
  structure the result.

scope_summary: 1-2 sentence plain-English summary.

confidence: 0-1, your overall confidence in the extraction.

Schema:
{
  "doc_kind": "elevation"|"plan"|"selections"|"other",
  "scope_summary": "...",
  "material_callouts": [
    { "material": str, "color": str|null, "location": str|null,
      "source_excerpt": str|null, "confidence": "high"|"med"|"low" }
  ],
  "rooms": [
    { "name": str, "dimensions": str|null, "area_sqft": number|null,
      "notes": str|null }
  ],
  "text_observed": [str],
  "confidence": 0-1
}`;

/** Run Llama 3.2 Vision on raw image bytes. Returns parsed extract
 * or the empty fallback if anything fails. */
export async function analyzeImage(
  env: CloudflareEnv,
  imageBytes: Uint8Array,
  hint?: string,
): Promise<VisionExtract> {
  if (!env.AI) return { ...EMPTY_EXTRACT };

  const userPrompt =
    hint
      ? `Operator hint: ${hint}\n\nReturn the JSON now.`
      : 'Return the JSON now.';

  let raw = '';
  try {
    const result = (await env.AI.run(VISION_MODEL, {
      image: Array.from(imageBytes),
      prompt: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
      max_tokens: 2000,
      temperature: 0.2,
    } as any)) as { description?: string; response?: string };
    raw = (result.description ?? result.response ?? '').trim();
  } catch (e) {
    console.warn('[vision] model run failed', e);
    return { ...EMPTY_EXTRACT };
  }

  const parsed = extractJson<Partial<VisionExtract>>(raw);
  if (!parsed) {
    return {
      ...EMPTY_EXTRACT,
      scope_summary: raw.slice(0, 300),
      text_observed: raw.split(/\n+/).filter(Boolean).slice(0, 40),
    };
  }

  return {
    doc_kind: isDocKind(parsed.doc_kind) ? parsed.doc_kind : 'other',
    scope_summary: parsed.scope_summary ?? '',
    material_callouts: Array.isArray(parsed.material_callouts)
      ? parsed.material_callouts
          .filter((m: any) => m && typeof m.material === 'string')
          .slice(0, 30)
          .map((m: any) => ({
            material: String(m.material),
            color: m.color ? String(m.color) : null,
            location: m.location ? String(m.location) : null,
            source_excerpt: m.source_excerpt ? String(m.source_excerpt) : null,
            confidence: ['high', 'med', 'low'].includes(m.confidence) ? m.confidence : 'med',
          }))
      : [],
    rooms: Array.isArray(parsed.rooms)
      ? parsed.rooms
          .filter((r: any) => r && typeof r.name === 'string')
          .slice(0, 40)
          .map((r: any) => ({
            name: String(r.name),
            dimensions: r.dimensions ? String(r.dimensions) : null,
            area_sqft: typeof r.area_sqft === 'number' ? r.area_sqft : null,
            notes: r.notes ? String(r.notes) : null,
          }))
      : [],
    text_observed: Array.isArray(parsed.text_observed)
      ? parsed.text_observed.filter((t: any) => typeof t === 'string').slice(0, 60)
      : [],
    confidence: typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0,
  };
}

function isDocKind(v: unknown): v is VisionDocKind {
  return v === 'elevation' || v === 'plan' || v === 'selections' || v === 'other';
}

/** Map VisionExtract.doc_kind to the intake_documents classification
 * enum. */
export function visionKindToClassification(
  kind: VisionDocKind,
): 'elevation_drawing' | 'architectural_plan' | 'selections_list' | 'unknown' {
  switch (kind) {
    case 'elevation': return 'elevation_drawing';
    case 'plan':      return 'architectural_plan';
    case 'selections': return 'selections_list';
    default:           return 'unknown';
  }
}
