/**
 * Agents overview panel.
 *
 * Renders the 7-agent architecture for the operator: what each agent
 * does, current state (chunk counts, findings counts, scheduled
 * follow-ups), and one-click actions ("seed Context", "run Intelligence").
 *
 * v1: read-only inspection + manual triggers. Auto-triggering happens
 * elsewhere (followup at quote send time, winloss at outcome, etc.) —
 * this panel is for operator visibility and manual re-runs.
 */
import { createResource, createSignal, For, Show } from 'solid-js';
import { isServer } from 'solid-js/web';

interface ContextSummary {
  shop_id: string;
  total: number;
  by_type: Array<{ chunk_type: string; count: number; last_updated: string | null }>;
}

interface IntakeRow {
  id: string;
  classification: string;
  classification_confidence: number;
  created_at: string;
}

interface Finding {
  id: string;
  finding_type: string;
  headline: string;
  body: string;
  sample_size: number;
  projected_impact_usd: number | null;
  generated_at: string;
}

interface FollowupDue {
  id: string;
  quote_id: string;
  kind: string;
  scheduled_for: string;
}

const CHUNK_LABELS: Record<string, string> = {
  voice_sample: 'Voice',
  scope_pattern: 'Scope',
  pricing_rule: 'Pricing',
  exclusion: 'Exclusions',
  service_definition: 'Services',
  past_quote_summary: 'Past quotes',
  template_section: 'Templates',
};

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', ...init });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

export default function AgentsPanel() {
  const [busy, setBusy] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const [contextSummary, { refetch: refetchContext }] = createResource<ContextSummary | null, true>(
    () => !isServer,
    async () => fetchJSON<ContextSummary>('/api/context/summary'),
  );
  const [findings, { refetch: refetchFindings }] = createResource<Finding[] | null, true>(
    () => !isServer,
    async () => {
      const r = await fetchJSON<{ findings: Finding[] }>('/api/intelligence/findings');
      return r.findings;
    },
  );
  const [due] = createResource<FollowupDue[] | null, true>(
    () => !isServer,
    async () => {
      const r = await fetchJSON<{ due: FollowupDue[] }>('/api/followup/due');
      return r.due;
    },
  );

  const beep = (kind: 'ok' | 'warn', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  };

  const seedContext = async () => {
    setBusy('seed');
    try {
      const r = await fetchJSON<{ upserted: number; embedded: number; failed: number }>(
        '/api/context/seed',
        { method: 'POST' },
      );
      beep('ok', `Context seeded — ${r.upserted} chunks (${r.embedded} embedded, ${r.failed} failed)`);
      await refetchContext();
    } catch (e) {
      beep('warn', `Seed failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const runIntelligence = async () => {
    setBusy('intel');
    try {
      const r = await fetchJSON<{ written: number; skipped: number }>(
        '/api/intelligence/run',
        { method: 'POST' },
      );
      beep('ok', `Intelligence pass — ${r.written} new findings (${r.skipped} duplicates)`);
      await refetchFindings();
    } catch (e) {
      beep('warn', `Intelligence run failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const dismissFinding = async (id: string) => {
    try {
      await fetchJSON('/api/intelligence/findings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action: 'dismiss' }),
      });
      await refetchFindings();
    } catch (e) {
      beep('warn', `Dismiss failed: ${(e as Error).message}`);
    }
  };

  return (
    <div class="space-y-8">
      <Show when={toast()}>
        <div
          class={`rounded-md border px-4 py-2.5 text-sm ${
            toast()!.kind === 'ok'
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}
        >
          {toast()!.text}
        </div>
      </Show>

      {/* Context */}
      <AgentCard
        name="Context"
        role="Owns the company profile. Voice, scope language, pricing logic, past jobs. Every other agent reads from here."
        status={
          contextSummary.loading
            ? 'Loading…'
            : `${contextSummary()?.total ?? 0} chunks across ${contextSummary()?.by_type.length ?? 0} types`
        }
        action={{
          label: busy() === 'seed' ? 'Seeding…' : 'Re-seed from existing data',
          disabled: busy() === 'seed',
          onClick: seedContext,
        }}
      >
        <Show when={contextSummary()?.by_type?.length}>
          <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <For each={contextSummary()!.by_type}>
              {(row) => (
                <div class="rounded-md bg-[color:var(--color-paper-2,#f6f4ef)] px-3 py-2">
                  <div class="text-[11px] font-mono uppercase text-[color:var(--color-muted-2)]">
                    {CHUNK_LABELS[row.chunk_type] ?? row.chunk_type}
                  </div>
                  <div class="text-lg font-medium">{row.count}</div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </AgentCard>

      {/* Intake */}
      <AgentCard
        name="Intake"
        role="Reads RFPs, briefs, sketches, emails, change requests. Classifies the document type and extracts structured data."
        status="Wired to scan + classify. Routes to the right editor based on confidence."
        details={
          <>
            <p class="text-[13px] text-[color:var(--color-muted-2)]">
              Taxonomy: itemized_project_quote · templated_partnership_pitch · narrative_consulting_proposal · inbound_rfi · change_request
            </p>
          </>
        }
      />

      {/* Offer */}
      <AgentCard
        name="Offer"
        role="Pulls loaded labor cost via tool call (no hallucination), applies historical margins, factors win-rate. Recommends a price range with citations."
        status="Lookup-spec protocol enforced: LLM never asserts a number, app code fills the template."
      />

      {/* Composition */}
      <AgentCard
        name="Composition"
        role="Writes the actual bid in the company's voice. Strong generation, heavy voice context."
        status="Six draft kinds: cover_note · scope_narrative · exclusions · terms · closing · full_proposal"
      />

      {/* Win/Loss */}
      <AgentCard
        name="Win/Loss"
        role="Asynchronous. Captures bid outcomes, infers contributing factors, feeds patterns back into Context."
        status="Fires automatically on mark-won/mark-lost. Closed-loop with Context."
      />

      {/* Follow-up */}
      <AgentCard
        name="Follow-up"
        role="Schedules follow-ups based on the shop's historical winning cadence. Drafts in voice. Surfaces cold bids."
        status={due.loading ? 'Loading…' : `${due()?.length ?? 0} follow-ups due now`}
      >
        <Show when={due() && due()!.length > 0}>
          <ul class="mt-3 space-y-1 text-sm">
            <For each={due()}>
              {(f) => (
                <li class="flex justify-between border-b border-[color:var(--color-line)] py-1.5">
                  <span class="font-mono text-[12px]">{f.kind.replace(/_/g, ' ')}</span>
                  <span class="text-[color:var(--color-muted-2)]">
                    {new Date(f.scheduled_for).toLocaleDateString()}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </AgentCard>

      {/* Intelligence */}
      <AgentCard
        name="Intelligence"
        role="Strategic findings. Capacity-aware pricing, win-rate by deal size, delivered margin trends, exclusions drift."
        status={
          findings.loading
            ? 'Loading…'
            : `${findings()?.length ?? 0} active findings`
        }
        action={{
          label: busy() === 'intel' ? 'Running…' : 'Run analysis',
          disabled: busy() === 'intel',
          onClick: runIntelligence,
        }}
      >
        <Show when={findings() && findings()!.length > 0}>
          <div class="mt-3 space-y-3">
            <For each={findings()}>
              {(f) => (
                <div class="rounded-md border border-[color:var(--color-line)] bg-white p-3">
                  <div class="flex justify-between items-start gap-3">
                    <div>
                      <div class="text-[11px] font-mono uppercase text-[color:var(--color-muted-2)]">
                        {f.finding_type.replace(/_/g, ' ')}
                      </div>
                      <h4 class="font-medium text-sm mt-0.5">{f.headline}</h4>
                      <p class="text-[13px] text-[color:var(--color-ink-2)] mt-1">{f.body}</p>
                      <div class="text-[11px] font-mono text-[color:var(--color-muted-2)] mt-1.5">
                        n={f.sample_size}
                        {f.projected_impact_usd != null &&
                          ` · projected impact $${f.projected_impact_usd.toLocaleString()}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => dismissFinding(f.id)}
                      class="text-[11px] font-mono uppercase text-[color:var(--color-muted-2)] hover:text-[color:var(--color-ink)]"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </AgentCard>
    </div>
  );
}

interface CardProps {
  name: string;
  role: string;
  status: string;
  action?: { label: string; disabled?: boolean; onClick: () => void };
  details?: import('solid-js').JSX.Element;
  children?: import('solid-js').JSX.Element;
}

function AgentCard(props: CardProps) {
  return (
    <section class="border-t border-[color:var(--color-line)] pt-6">
      <div class="flex justify-between items-start gap-6">
        <div class="flex-1">
          <div class="flex items-baseline gap-3">
            <h3 class="font-serif text-[20px] font-medium">{props.name}</h3>
            <span class="text-[11px] font-mono uppercase text-[color:var(--color-muted-2)]">agent</span>
          </div>
          <p class="text-[14px] text-[color:var(--color-ink-2)] mt-1 max-w-[60ch]">{props.role}</p>
          <p class="text-[12px] font-mono text-[color:var(--color-muted-2)] mt-2">{props.status}</p>
          {props.details}
        </div>
        <Show when={props.action}>
          <button
            type="button"
            disabled={props.action!.disabled}
            onClick={props.action!.onClick}
            class="font-mono text-[12px] uppercase tracking-wide border border-[color:var(--color-line)] hover:border-[color:var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed bg-white px-3 py-1.5 rounded-sm whitespace-nowrap"
          >
            {props.action!.label}
          </button>
        </Show>
      </div>
      {props.children}
    </section>
  );
}
