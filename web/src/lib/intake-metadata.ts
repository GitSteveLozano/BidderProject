/**
 * Extract client + project metadata from intake text (PDF body or
 * voice transcript). Used by /api/intake/extract-pdf and
 * /api/intake/transcribe so the operator doesn't have to retype what
 * the source document already says — the IntakeStep form auto-fills
 * client_name / contact_name / project_title / project_address from
 * the extraction.
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
  project_title: string | null;
  project_address: string | null;
}

const EMPTY: IntakeMetadata = {
  client_name: null,
  contact_name: null,
  project_title: null,
  project_address: null,
};

const SYSTEM = `You read a construction-scope document (RFP, client email, or
walk-through transcript) and extract the four fields below. Return ONLY a
JSON object of the exact shape — no fences, no preamble, no closing.

{
  "client_name":   string | null,
  "contact_name":  string | null,
  "project_title": string | null,
  "project_address": string | null
}

Rules:
- client_name: the COMPANY or HOMEOWNER name commissioning the work.
  If it's a builder/GC, use the company name (not the project owner).
- contact_name: the specific person at the client side, if named.
  Different from client_name when client_name is a company.
- project_title: short title for the work itself ("Two-story addition",
  "Stucco repair — west wall"). Not the address. Not boilerplate
  ("Scope of Work", "Proposal").
- project_address: street address of the job site, if present.
- Return null for any field not clearly stated in the source. Do not
  invent. Better to return null than to guess.`;

export async function extractIntakeMetadata(
  env: CloudflareEnv,
  rawText: string,
): Promise<IntakeMetadata> {
  if (!env.AI || !rawText || rawText.trim().length < 50) return { ...EMPTY };
  const text = rawText.slice(0, 8000);
  try {
    const response = await generateText(env, {
      max_tokens: 400,
      temperature: 0.1,
      json: true,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content:
            `Source document:\n--- BEGIN ---\n${text}\n--- END ---\n\nReturn the JSON.`,
        },
      ],
    });
    const parsed = extractJson<Partial<IntakeMetadata>>(response);
    if (!parsed) return { ...EMPTY };
    return {
      client_name: clean(parsed.client_name),
      contact_name: clean(parsed.contact_name),
      project_title: clean(parsed.project_title),
      project_address: clean(parsed.project_address),
    };
  } catch {
    return { ...EMPTY };
  }
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'unknown') return null;
  return t;
}
