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

const SYSTEM = `You read a construction document and extract the six fields below.
The source can be any of:
  - an RFP or scope of work the CLIENT sent to the contractor,
  - a quote, estimate, or proposal the CONTRACTOR sent to their client,
  - a client email, or a walk-through transcript.

In every case the CLIENT is the party paying for the work (the builder,
GC, or homeowner). It is NEVER the bidding contractor — ignore the
contractor's own letterhead, footer, website, GST number, or signature
block when picking client_name / contact_email / contact_phone.

Return ONLY a JSON object of the exact shape — no fences, no preamble,
no closing.

{
  "client_name":     string | null,
  "contact_name":    string | null,
  "contact_email":   string | null,
  "contact_phone":   string | null,
  "project_title":   string | null,
  "project_address": string | null
}

Where to look:
- client_name: the addressee. Common labels that introduce it include
  "Bill To", "Sold To", "ATTN", "Attention", "TO:", "Customer",
  "Client", "Quote Address", "Prepared For", "Re:" — take the
  company or person named right after one of those.
- contact_name: a named individual on the client side, if present;
  distinct from client_name when client_name is a company.
- contact_email / contact_phone: the client-side email or phone. Skip
  anything in the contractor's letterhead or footer. E.164 phone
  format if possible (+15551234567); otherwise return what you see.
- project_title: take whatever follows a "Project", "Project Name",
  "Job", "Job Name", or "Re:" label, verbatim. A street address is a
  perfectly valid project_title when that's all the document gives
  you. Only fall back to a short descriptive phrase ("Two-story
  addition", "Stucco repair — west wall") if no such label exists.
  Do NOT return boilerplate like "Scope of Work", "Quote", or
  "Proposal".
- project_address: street address of the job site, if present. May
  match project_title when the title IS an address.

Rules:
- Return null for any field not clearly stated. Do not invent.
- Return values close to how they appear in the source — don't
  rewrite or paraphrase.`;

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
      contact_email: clean(parsed.contact_email),
      contact_phone: clean(parsed.contact_phone),
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
