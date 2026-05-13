/**
 * Composition agent — voice-matched bid prose.
 *
 * Takes (intake extract + company context + offer rationale) and
 * generates the actual text the operator sends. Uses heavy Context
 * retrieval — specifically voice_sample chunks — to match tone.
 *
 * Outputs six kinds, all stored in composition_drafts (migration 008)
 * with revision history:
 *   cover_note         — short opener that goes on the email body
 *   scope_narrative    — 2-3 paragraph description of what the work is
 *   exclusions         — bulleted list, copied/derived from Context
 *   terms              — payment + timing language
 *   closing            — sign-off in the operator's voice
 *   full_proposal      — assembled output for the PDF/email
 *
 * Composition is the LAST agent that runs on a quote before send.
 * It assumes Intake + Offer have already produced their structured
 * outputs. The agent's job is purely prose — it doesn't change any
 * structured field.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { generateText } from './ai';
import { retrieve } from './context';
import type { CloudflareEnv } from './supabase';

export type DraftKind =
  | 'cover_note'
  | 'scope_narrative'
  | 'exclusions'
  | 'terms'
  | 'closing'
  | 'full_proposal';

export interface CompositionInputs {
  shop_id: string;
  quote_id: string;
  kind: DraftKind;
  scope_summary: string;
  client_name: string;
  contact_first_name?: string;
  project_title: string;
  line_items?: Array<{ description: string; qty: number; unit: string; subtotal: number }>;
  total?: number;
  offer_rationale?: string;
  classification?: string;
}

export interface CompositionDraft {
  kind: DraftKind;
  text: string;
  used_chunks: Array<{ chunk_type: string; source_ref: string }>;
}

const SYSTEM_BY_KIND: Record<DraftKind, string> = {
  cover_note: `You write the email body that goes WITH a contractor's bid.
2-4 sentences. Operator-to-operator voice. State what's attached, hit
one specific scope detail to show you read the brief, end on a clear
next step. No "thank you for the opportunity" — that's office voice.`,

  scope_narrative: `You write the scope-of-work narrative section of a
contractor's bid. 2-3 short paragraphs. Concrete, specific to this job.
Reference materials, finishes, sequence. Avoid filler. Use the shop's
preferred terms verbatim (they show up in the voice_sample chunks).`,

  exclusions: `You write the EXCLUSIONS section of a contractor's bid.
Bullet list. 4-8 items. Standard items pulled from the shop's exclusion
chunks plus any specific to this job. Each bullet starts with the noun
("Permits", "Engineering"), then "by others" or "not included". Short.`,

  terms: `You write the PAYMENT TERMS + TIMING section of a contractor's bid.
Short. 2-3 sentences. Standard deposit / progress / final, with timing
phrased in business days. Match the shop's existing terms language.`,

  closing: `You write the closing line of a contractor's email. ONE
sentence + sign-off. Operator's voice. Match the boilerplate_closing
in the voice profile if one is set.`,

  full_proposal: `You write the FULL proposal document for a contractor.
Sections: opening paragraph, scope narrative, exclusions, terms, closing.
Markdown formatting. Match the shop's voice throughout. Do not invent
line items — refer to the table the operator attached.`,
};

/**
 * Generate one draft. Pulls Context (voice + scope_pattern +
 * exclusion + service_definition chunks), formats them as inline
 * context, asks Llama to write in that voice.
 */
export async function compose(
  env: CloudflareEnv,
  svc: SupabaseClient,
  inputs: CompositionInputs,
): Promise<CompositionDraft> {
  // Retrieve relevant Context chunks. Different draft kinds need
  // different chunk types.
  const chunkTypes = chunkTypesFor(inputs.kind);
  const probe =
    inputs.kind === 'exclusions'
      ? 'standard exclusions on quotes'
      : inputs.kind === 'terms'
        ? 'payment terms and timing'
        : `${inputs.kind} ${inputs.scope_summary}`;
  const chunks = await retrieve(env, svc, inputs.shop_id, probe, {
    chunk_types: chunkTypes,
    limit: 8,
  });

  // Always pull voice samples regardless of kind — voice is the
  // through-line.
  const voiceChunks =
    chunks.some((c) => c.chunk_type === 'voice_sample')
      ? []
      : await retrieve(env, svc, inputs.shop_id, 'how this shop writes', {
          chunk_types: ['voice_sample'],
          limit: 4,
        });

  const allChunks = [...voiceChunks, ...chunks];
  const contextBlock = allChunks
    .map((c, i) => `[${i + 1}] (${c.chunk_type}/${c.source_ref}) ${c.content}`)
    .join('\n');

  const itemsBlock = inputs.line_items?.length
    ? `Line items:\n${inputs.line_items.map((li) => `  - ${li.qty} ${li.unit} ${li.description} — $${li.subtotal.toFixed(2)}`).join('\n')}`
    : '';

  const userMsg =
    `Client: ${inputs.client_name}${inputs.contact_first_name ? ` (${inputs.contact_first_name})` : ''}\n` +
    `Project: ${inputs.project_title}\n` +
    `Scope: ${inputs.scope_summary}\n` +
    (inputs.total ? `Total: $${inputs.total.toLocaleString()}\n` : '') +
    (inputs.offer_rationale ? `Pricing rationale: ${inputs.offer_rationale}\n` : '') +
    (inputs.classification ? `Document type: ${inputs.classification}\n` : '') +
    (itemsBlock ? `${itemsBlock}\n` : '') +
    `\nShop voice + reference chunks:\n${contextBlock || '(profile empty — write neutral professional)'}\n\n` +
    `Write the ${inputs.kind} now. Do not include section headers unless writing the full_proposal.`;

  const text = await generateText(env, {
    max_tokens: inputs.kind === 'full_proposal' ? 1800 : 500,
    temperature: 0.5,
    messages: [
      { role: 'system', content: SYSTEM_BY_KIND[inputs.kind] },
      { role: 'user', content: userMsg },
    ],
  });

  return {
    kind: inputs.kind,
    text: text.trim(),
    used_chunks: allChunks.map((c) => ({
      chunk_type: c.chunk_type,
      source_ref: c.source_ref,
    })),
  };
}

function chunkTypesFor(kind: DraftKind): Array<
  'voice_sample' | 'scope_pattern' | 'pricing_rule' | 'exclusion' | 'service_definition' | 'past_quote_summary'
> {
  switch (kind) {
    case 'cover_note':
      return ['voice_sample', 'past_quote_summary'];
    case 'scope_narrative':
      return ['voice_sample', 'scope_pattern', 'service_definition'];
    case 'exclusions':
      return ['exclusion', 'voice_sample'];
    case 'terms':
      return ['voice_sample', 'pricing_rule'];
    case 'closing':
      return ['voice_sample'];
    case 'full_proposal':
      return ['voice_sample', 'scope_pattern', 'exclusion', 'service_definition', 'past_quote_summary'];
  }
}

/** Persist a draft. Auto-increments revision per (quote_id, kind). */
export async function saveDraft(
  svc: SupabaseClient,
  shopId: string,
  quoteId: string,
  draft: CompositionDraft,
  promptContext: Record<string, unknown> = {},
): Promise<{ id: string; revision: number } | null> {
  const { data: prior } = await svc
    .from('composition_drafts')
    .select('revision')
    .eq('quote_id', quoteId)
    .eq('kind', draft.kind)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();
  const revision = (prior?.revision ?? 0) + 1;
  const { data, error } = await svc
    .from('composition_drafts')
    .insert({
      shop_id: shopId,
      quote_id: quoteId,
      kind: draft.kind,
      revision,
      draft_text: draft.text,
      prompt_context: { ...promptContext, used_chunks: draft.used_chunks },
    })
    .select('id')
    .single();
  if (error || !data) {
    console.warn('[composition] saveDraft failed', error?.message);
    return null;
  }
  return { id: data.id, revision };
}
