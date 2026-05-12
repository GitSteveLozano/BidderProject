/**
 * Shared formatters + grouping helpers for the Quotes views.
 * Lives in lib/ so SSR pages and Solid islands share one source.
 */

export type QuoteState = 'DRAFT' | 'SENT' | 'AWAITING' | 'RESPONDED' | 'WON' | 'LOST';

export interface AgendaQuote {
  id: string;
  ref: string;
  client_name: string;
  project_title: string;
  state: QuoteState;
  total: number;
  next_step: string | null;
  age_days: number;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
}

/** Group quotes into the Agenda buckets per design/spec/screens.md. */
export function bucketQuotes(quotes: AgendaQuote[]): {
  today: AgendaQuote[];
  thisWeek: AgendaQuote[];
  coolingOff: AgendaQuote[];
  later: AgendaQuote[];
  decided: AgendaQuote[];
} {
  const today: AgendaQuote[] = [];
  const thisWeek: AgendaQuote[] = [];
  const coolingOff: AgendaQuote[] = [];
  const later: AgendaQuote[] = [];
  const decided: AgendaQuote[] = [];

  for (const q of quotes) {
    if (q.state === 'WON' || q.state === 'LOST') {
      decided.push(q);
      continue;
    }
    if (q.state === 'RESPONDED') {
      today.push(q);
      continue;
    }
    if (q.age_days >= 14) {
      coolingOff.push(q);
      continue;
    }
    if (q.age_days <= 1) {
      today.push(q);
    } else if (q.age_days <= 7) {
      thisWeek.push(q);
    } else {
      later.push(q);
    }
  }
  return { today, thisWeek, coolingOff, later, decided };
}

export function fmtCurrencyFull(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtCurrencyCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

export function fmtAge(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1d';
  return `${days}d`;
}

export function fmtRelativeDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours < 1) return 'just now';
    return `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Compute age_days from sent_at / responded_at / created_at. */
export function computeAge(q: { sent_at: string | null; responded_at: string | null; created_at: string }): number {
  const ref = q.responded_at ?? q.sent_at ?? q.created_at;
  return Math.floor((Date.now() - new Date(ref).getTime()) / (24 * 60 * 60 * 1000));
}
