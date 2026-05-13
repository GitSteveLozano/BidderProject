/**
 * Extract client + project metadata from intake text (PDF body or
 * voice transcript). Used by /api/intake/extract-pdf and
 * /api/intake/transcribe so the operator doesn't have to retype what
 * the source document already says — the IntakeStep form auto-fills
 * client_name / contact_name / contact_email / contact_phone /
 * project_title / project_address from the extraction.
 *
 * Returns an object of nullable fields. Caller decides whether to
 * overwrite existing form state (typically: only fill empty fields).
 *
 * Failure mode: returns all-null. Never throws — the metadata pass is
 * best-effort and a missed field is fine.
 */
import type { CloudflareEnv } from './supabase';
import { generateText, extractJson } from './ai';

export interface IntakeMetadata {
  client_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  project_title: string | null;
  project_address: string | null;
}

const EMPTY: IntakeMetadata = {
  client_name: null,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  project_title: null,
  project_address: null,
};

const SYSTEM = `You read a construction-scope document, RFP, voice
transcript, or proposal and pull out six fields about the client and
the project. Return ONLY a JSON object — no fences, no preamble, no
closing remarks.

Shape:
{
  "client_name":     string | null,
  "contact_name":    string | null,
  "contact_email":   string | null,
  "contact_phone":   string | null,
  "project_title":   string | null,
  "project_address": string | null
}

Definitions:
- client_name: the COMPANY or HOMEOWNER name commissioning the work.
  If a builder/GC is procuring, use the GC company name. If it's a
  homeowner with a personal name, use that. Include "LLC"/"Inc" when
  present in the source.
- contact_name: the named person on the client side. May equal
  client_name for individual homeowners.
- contact_email: their email if it appears anywhere in the text.
- contact_phone: their phone number if it appears.
- project_title: a short title for the work. Lift verbatim if the
  source has one ("Two-story addition · scratch + brown coat"); else
  synthesize a 3–7 word title from the scope. Not the address.
  Never the boilerplate ("Scope of Work", "Proposal", "RFP").
- project_address: street address of the job site, if present.

Example 1 — email-style RFP:
Source: "From: Diane Halsted <diane@halstedcontracting.example>
Subject: 418 Ridgemoor Ln stucco
Hi Cavy, we need a re-stucco quote on 418 Ridgemoor Ln, Pasadena.
Strip + lath repair + scratch/brown/finish coats, sand-float, integral
pigment. Two elevations (~4,200 sqft)."

Output:
{
  "client_name": "Halsted & Sons Contracting",
  "contact_name": "Diane Halsted",
  "contact_email": "diane@halstedcontracting.example",
  "contact_phone": null,
  "project_title": "Re-stucco on Ridgemoor — strip + 3-coat",
  "project_address": "418 Ridgemoor Ln, Pasadena"
}

Example 2 — voice walk-through transcript:
Source: "Okay, this one's for Vermont Modern, two-story addition at
1822 Vermont Ave in Glendale. About 1,850 square feet. Standard
scratch and brown over wire lath. Priya Shah is the contact —
priya@vermontmodern.example."

Output:
{
  "client_name": "Vermont Modern LLC",
  "contact_name": "Priya Shah",
  "contact_email": "priya@vermontmodern.example",
  "contact_phone": null,
  "project_title": "Two-story addition · scratch + brown coat",
  "project_address": "1822 Vermont Ave, Glendale"
}

Rules:
- Lean toward extraction, not null. If you can see a plausible client
  name in the source — even partial — use it. The operator can
  correct it in 2 seconds; missing it costs them more time.
- Only return null if there is genuinely nothing to extract.
- project_title may be SYNTHESIZED from the scope when the source
  doesn't name one — keep it concrete and specific.
- Phone: prefer E.164 (+15551234567) when possible; else raw digits.`;

export interface ExtractOptions {
  /** When operator already typed a client/project, pass these in so
   * the model can refine instead of replace. Optional. */
  hints?: { client_name?: string; project_title?: string };
}

export async function extractIntakeMetadata(
  env: CloudflareEnv,
  rawText: string,
  opts: ExtractOptions = {},
): Promise<IntakeMetadata> {
  if (!env.AI) return { ...EMPTY };
  const cleaned = (rawText ?? '').trim();
  // Dropped from 50 → 30 chars. A short voice transcript like
  // "Halsted, 418 Ridgemoor, stucco re-do" is enough to extract from.
  if (cleaned.length < 30) return { ...EMPTY };
  const text = cleaned.slice(0, 8000);

  const hintLine =
    opts.hints?.client_name || opts.hints?.project_title
      ? `Operator already typed: client="${opts.hints?.client_name ?? '(blank)'}", project="${opts.hints?.project_title ?? '(blank)'}". Use as a hint; trust the source over the typed value.\n\n`
      : '';

  try {
    const response = await generateText(env, {
      max_tokens: 800,
      temperature: 0.1,
      json: true,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content:
            `${hintLine}Source document:\n--- BEGIN ---\n${text}\n--- END ---\n\nReturn the JSON.`,
        },
      ],
    });
    const parsed = extractJson<Partial<IntakeMetadata>>(response);
    if (!parsed) {
      console.warn('[intake-metadata] could not parse JSON, raw:', response.slice(0, 300));
      return { ...EMPTY };
    }
    const result: IntakeMetadata = {
      client_name: clean(parsed.client_name),
      contact_name: clean(parsed.contact_name),
      contact_email: clean(parsed.contact_email),
      contact_phone: clean(parsed.contact_phone),
      project_title: clean(parsed.project_title),
      project_address: clean(parsed.project_address),
    };
    if (!result.client_name && !result.project_title && !result.contact_name) {
      console.warn(
        '[intake-metadata] all-null on text len',
        text.length,
        'raw:',
        response.slice(0, 200),
      );
    }
    return result;
  } catch (e) {
    console.warn('[intake-metadata] generation failed', e);
    return { ...EMPTY };
  }
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (low === 'null' || low === 'unknown' || low === 'n/a' || low === '(blank)') return null;
  return t;
}
