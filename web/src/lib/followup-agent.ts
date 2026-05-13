/**
 * Follow-up agent — post-bid lifecycle.
 *
 * Schedules up to four touches per quote:
 *   - initial_check_in   (default sent_at + 3 business days)
 *   - gentle_nudge       (default sent_at + 7 business days)
 *   - last_call          (default sent_at + 14 business days)
 *   - postmortem         (only after operator marks lost — to capture why)
 *
 * The cadence anchors on the shop's *winning* historical cadence
 * when sample size supports it. Brief looks at past WON quotes,
 * computes the median days from sent_at → responded_at, and shifts
 * the standard 3/7/14 baseline toward whatever's actually worked.
 *
 * Drafts are voice-matched via the Composition agent so a follow-up
 * doesn't read as a CRM auto-email. Operator approves before send;
 * the cron worker (cron/process-scheduled) picks up approved rows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { compose, saveDraft, type CompositionDraft } from './composition-agent';
import type { CloudflareEnv } from './supabase';

export type FollowupKind = 'initial_check_in' | 'gentle_nudge' | 'last_call' | 'postmortem';

const DEFAULT_OFFSETS_BUSINESS_DAYS: Record<FollowupKind, number> = {
  initial_check_in: 3,
  gentle_nudge: 7,
  last_call: 14,
  postmortem: 0, // scheduled immediately on outcome capture
};

/** Add N business days (skip weekends). UTC math; good enough for v1. */
function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

/**
 * Compute the shop's historical median time-to-response for WON quotes.
 * Returns null when n < 8.
 */
async function shopWinningCadence(
  svc: SupabaseClient,
  shopId: string,
): Promise<number | null> {
  const { data } = await svc
    .from('quotes')
    .select('sent_at, responded_at, state')
    .eq('shop_id', shopId)
    .eq('state', 'WON')
    .not('sent_at', 'is', null)
    .not('responded_at', 'is', null)
    .limit(200);
  const days = (data ?? [])
    .map((r) => {
      const sent = new Date(r.sent_at).getTime();
      const resp = new Date(r.responded_at).getTime();
      return Math.round((resp - sent) / 86400000);
    })
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (days.length < 8) return null;
  return days[Math.floor(days.length / 2)];
}

/** Adjust the standard offsets toward the shop's actual winning cadence. */
function tunedOffsets(medianWinDays: number | null): Record<FollowupKind, number> {
  if (medianWinDays == null) return DEFAULT_OFFSETS_BUSINESS_DAYS;
  // If winners respond at median day 5, anchor first nudge at day 4
  // (one day before median), second at day 8, last call at day 14
  // (don't shrink the deadline; clients past median are usually lost).
  const initial = Math.max(2, medianWinDays - 1);
  const gentle = Math.max(initial + 2, medianWinDays + 2);
  const last = Math.max(gentle + 4, 12);
  return {
    initial_check_in: initial,
    gentle_nudge: gentle,
    last_call: last,
    postmortem: 0,
  };
}

/**
 * Schedule the three post-send touches for a quote that just moved
 * to SENT (or RESPONDED without a decision). Idempotent — re-running
 * cancels any prior unsent rows and inserts fresh ones aligned to the
 * current sent_at.
 */
export async function scheduleForQuote(
  svc: SupabaseClient,
  shopId: string,
  quoteId: string,
): Promise<{ scheduled: number; sent_at: string | null }> {
  const { data: q } = await svc
    .from('quotes')
    .select('sent_at, state')
    .eq('id', quoteId)
    .maybeSingle();
  if (!q || !q.sent_at) return { scheduled: 0, sent_at: null };
  if (q.state === 'WON' || q.state === 'LOST') return { scheduled: 0, sent_at: q.sent_at };

  await svc
    .from('followup_schedules')
    .update({ status: 'superseded', cancelled_reason: 'rescheduled' })
    .eq('quote_id', quoteId)
    .eq('status', 'scheduled');

  const median = await shopWinningCadence(svc, shopId);
  const offsets = tunedOffsets(median);
  const sentAt = new Date(q.sent_at);

  const rows: Array<{
    shop_id: string;
    quote_id: string;
    kind: FollowupKind;
    scheduled_for: string;
    status: string;
  }> = [];
  for (const kind of ['initial_check_in', 'gentle_nudge', 'last_call'] as FollowupKind[]) {
    rows.push({
      shop_id: shopId,
      quote_id: quoteId,
      kind,
      scheduled_for: addBusinessDays(sentAt, offsets[kind]).toISOString(),
      status: 'scheduled',
    });
  }
  const { error } = await svc.from('followup_schedules').insert(rows);
  if (error) {
    console.warn('[followup] schedule insert failed', error.message);
    return { scheduled: 0, sent_at: q.sent_at };
  }
  return { scheduled: rows.length, sent_at: q.sent_at };
}

/** Draft the message for a specific scheduled follow-up. Uses
 * Composition to generate, then writes to followup_schedules. */
export async function draftFollowup(
  env: CloudflareEnv,
  svc: SupabaseClient,
  followupId: string,
): Promise<{ draft_text: string } | null> {
  const { data: row } = await svc
    .from('followup_schedules')
    .select('id, shop_id, quote_id, kind, draft_revision')
    .eq('id', followupId)
    .maybeSingle();
  if (!row) return null;

  const { data: q } = await svc
    .from('quotes')
    .select('client_name, client_contact_name, project_title, scope_summary, total, ref, sent_at')
    .eq('id', row.quote_id)
    .maybeSingle();
  if (!q) return null;

  const draft: CompositionDraft = await compose(env, svc, {
    shop_id: row.shop_id,
    quote_id: row.quote_id,
    kind: 'cover_note',
    scope_summary: q.scope_summary ?? '',
    client_name: q.client_name ?? '',
    contact_first_name: (q.client_contact_name ?? '').split(' ')[0],
    project_title: q.project_title ?? '',
    classification: `follow_up_${row.kind}`,
  });

  // Tweak: prepend a one-liner that reminds the model of follow-up
  // context. Composition agent generated bid-cover prose; we coerce
  // it into a follow-up by adjusting the lead.
  const followupText = followupLeadFor(row.kind, q.client_contact_name) + '\n\n' + draft.text;

  await svc
    .from('followup_schedules')
    .update({ draft_text: followupText, draft_revision: (row.draft_revision ?? 0) + 1 })
    .eq('id', followupId);

  await saveDraft(svc, row.shop_id, row.quote_id, draft, {
    followup_id: followupId,
    followup_kind: row.kind,
  });

  return { draft_text: followupText };
}

function followupLeadFor(kind: FollowupKind, contactName: string | null): string {
  const first = (contactName ?? '').split(' ')[0] || 'there';
  switch (kind) {
    case 'initial_check_in':
      return `Hey ${first} — circling back on the bid we sent over.`;
    case 'gentle_nudge':
      return `Hey ${first} — anything outstanding on our number?`;
    case 'last_call':
      return `${first}, last touch on this one before I close the file on my end.`;
    case 'postmortem':
      return `${first} — appreciate you considering us. If you've got a minute, I'd love to know what landed and what didn't.`;
  }
}

/** Cron-callable. Returns due rows so the worker can draft+send. */
export async function listDue(
  svc: SupabaseClient,
  shopId: string,
  asOf: Date = new Date(),
): Promise<Array<{ id: string; quote_id: string; kind: FollowupKind; scheduled_for: string }>> {
  const { data } = await svc
    .from('followup_schedules')
    .select('id, quote_id, kind, scheduled_for')
    .eq('shop_id', shopId)
    .eq('status', 'scheduled')
    .lte('scheduled_for', asOf.toISOString())
    .order('scheduled_for');
  return (data ?? []) as Array<{ id: string; quote_id: string; kind: FollowupKind; scheduled_for: string }>;
}
