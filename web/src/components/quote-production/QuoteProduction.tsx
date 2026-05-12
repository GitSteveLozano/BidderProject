/**
 * <QuoteProduction> — 5-step quote flow.
 *
 * Steps: Intake → Scope → Pricing → Review → Send
 *
 * Step 2 (Scope) consumes /api/quote/scan SSE and progressively renders
 * line items as Claude emits tool calls. Step 3 (Pricing) is purely
 * client-side via Solid signals. Step 4 (Review) iframes a PDF rendered
 * by /api/quote/render-pdf. Step 5 (Send) writes DRAFT→SENT via
 * /api/quote/send.
 */
import { createSignal, For, Show, createMemo } from 'solid-js';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';
import Stepper from '@/components/ui/Stepper';
import Pill from '@/components/ui/Pill';

interface ShopContext {
  legal_name: string;
  trade_name?: string;
  license_number?: string;
  license_jurisdiction?: string;
  boilerplate_intro?: string;
  boilerplate_closing?: string;
  default_markup_pct: number;
  default_labor_rate: number;
}

interface LineItem {
  position: number;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  category: string;
  confidence?: string;
  source_excerpt?: string;
}

interface Flag {
  kind: 'warn' | 'info';
  text: string;
}

const STEPS = [
  { id: 'intake',  label: 'Intake' },
  { id: 'scope',   label: 'Scope' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'review',  label: 'Review' },
  { id: 'send',    label: 'Send' },
];

export default function QuoteProduction(props: { shop: ShopContext }) {
  const [stepIdx, setStepIdx] = createSignal(0);
  const stepId = createMemo(() => STEPS[stepIdx()].id);
  const completed = createMemo(() => STEPS.slice(0, stepIdx()).map((s) => s.id));

  // Intake
  const [clientName, setClientName] = createSignal('');
  const [clientContact, setClientContact] = createSignal('');
  const [projectTitle, setProjectTitle] = createSignal('');
  const [projectAddress, setProjectAddress] = createSignal('');
  const [scopeText, setScopeText] = createSignal('');

  // Scope (SSE results)
  const [lineItems, setLineItems] = createSignal<LineItem[]>([]);
  const [flags, setFlags] = createSignal<Flag[]>([]);
  const [scopeSummary, setScopeSummary] = createSignal('');
  const [scanProgress, setScanProgress] = createSignal(0);
  const [scanError, setScanError] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal(false);

  // Pricing
  const [markupPct, setMarkupPct] = createSignal<number>(props.shop.default_markup_pct ?? 32);

  // Review / Send
  const [pdfUrl, setPdfUrl] = createSignal<string | null>(null);
  const [renderingPdf, setRenderingPdf] = createSignal(false);
  const [savingQuote, setSavingQuote] = createSignal(false);
  const [quoteId, setQuoteId] = createSignal<string | null>(null);
  const [quoteRef, setQuoteRef] = createSignal<string | null>(null);
  const [sendError, setSendError] = createSignal<string | null>(null);

  // Derived totals
  const baseSubtotal = createMemo(() =>
    lineItems().reduce((s, li) => s + li.subtotal, 0),
  );
  const marginAmount = createMemo(() =>
    Math.round(baseSubtotal() * (markupPct() / 100) * 100) / 100,
  );
  const total = createMemo(() => round(baseSubtotal() + marginAmount(), 2));

  const startScan = async () => {
    setLineItems([]);
    setFlags([]);
    setScopeSummary('');
    setScanProgress(0);
    setScanError(null);
    setScanning(true);
    try {
      const resp = await fetch('/api/quote/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: scopeText(),
          client_name: clientName(),
          project_title: projectTitle(),
        }),
      });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}: ${await resp.text()}`);
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const block of events) {
          const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6));
          if (payload.type === 'progress') setScanProgress(payload.percent);
          else if (payload.type === 'line_item') setLineItems([...lineItems(), payload.payload]);
          else if (payload.type === 'flag')      setFlags([...flags(), payload.payload]);
          else if (payload.type === 'done')      setScopeSummary(payload.payload?.scope_summary ?? '');
          else if (payload.type === 'error')     setScanError(payload.message);
        }
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const goToScope = async () => {
    setStepIdx(1);
    await startScan();
  };

  const updateLineItem = (idx: number, patch: Partial<LineItem>) => {
    const next = lineItems().slice();
    const li = { ...next[idx], ...patch };
    li.subtotal = round(li.qty * li.unit_price, 2);
    next[idx] = li;
    setLineItems(next);
  };
  const removeLineItem = (idx: number) => {
    setLineItems(lineItems().filter((_, i) => i !== idx));
  };
  const addLineItem = () => {
    setLineItems([
      ...lineItems(),
      {
        position: lineItems().length + 1,
        description: '',
        qty: 1,
        unit: 'lump_sum',
        unit_price: 0,
        subtotal: 0,
        category: 'other',
        confidence: 'manual',
      },
    ]);
  };

  const renderPdf = async () => {
    setRenderingPdf(true);
    try {
      const resp = await fetch('/api/quote/render-pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ref: quoteRef() ?? undefined,
          client_name: clientName(),
          client_contact: clientContact(),
          project_title: projectTitle(),
          project_address: projectAddress(),
          scope_summary: scopeSummary(),
          line_items: lineItems(),
          total: total(),
          shop: props.shop,
        }),
      });
      if (!resp.ok) throw new Error(`Preview render failed: ${await resp.text()}`);
      // Response is HTML; iframe via blob URL so the browser owns the print flow.
      const blob = await resp.blob();
      setPdfUrl(URL.createObjectURL(blob));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenderingPdf(false);
    }
  };

  const goToReview = async () => {
    setStepIdx(3);
    await renderPdf();
  };

  const saveAndSend = async () => {
    setSavingQuote(true);
    setSendError(null);
    try {
      // Save
      const saveResp = await fetch('/api/quote/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: quoteId() ?? undefined,
          client_name: clientName(),
          client_contact_name: clientContact() || null,
          project_title: projectTitle(),
          project_address: projectAddress() || null,
          scope_summary: scopeSummary(),
          source: 'manual',
          total: total(),
          margin_pct: markupPct(),
          line_items: lineItems(),
        }),
      });
      if (!saveResp.ok) throw new Error(`Save failed: ${await saveResp.text()}`);
      const saved = (await saveResp.json()) as { id: string; ref: string };
      setQuoteId(saved.id);
      setQuoteRef(saved.ref);

      // Send
      const sendResp = await fetch('/api/quote/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quote_id: saved.id, channel: 'manual' }),
      });
      if (!sendResp.ok) throw new Error(`Send failed: ${await sendResp.text()}`);
      setStepIdx(4);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingQuote(false);
    }
  };

  const canContinueFromIntake = (): boolean =>
    !!clientName().trim() && !!projectTitle().trim() && scopeText().trim().length >= 30;

  return (
    <div class="max-w-[1100px] mx-auto">
      <div class="flex items-center justify-between mb-8">
        <a href="/quotes" class="text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]">
          ← All quotes
        </a>
        <Stepper steps={STEPS} current={stepId()} completed={completed()} />
      </div>

      <Show when={stepId() === 'intake'}>
        <IntakeStep
          clientName={clientName} setClientName={setClientName}
          clientContact={clientContact} setClientContact={setClientContact}
          projectTitle={projectTitle} setProjectTitle={setProjectTitle}
          projectAddress={projectAddress} setProjectAddress={setProjectAddress}
          scopeText={scopeText} setScopeText={setScopeText}
          canContinue={canContinueFromIntake}
          onContinue={goToScope}
        />
      </Show>

      <Show when={stepId() === 'scope'}>
        <ScopeStep
          scanning={scanning}
          progress={scanProgress}
          error={scanError}
          lineItems={lineItems}
          flags={flags}
          scopeSummary={scopeSummary}
          onRetry={startScan}
          onBack={() => setStepIdx(0)}
          onContinue={() => setStepIdx(2)}
        />
      </Show>

      <Show when={stepId() === 'pricing'}>
        <PricingStep
          shop={props.shop}
          lineItems={lineItems}
          markupPct={markupPct}
          setMarkupPct={setMarkupPct}
          baseSubtotal={baseSubtotal}
          marginAmount={marginAmount}
          total={total}
          updateLineItem={updateLineItem}
          removeLineItem={removeLineItem}
          addLineItem={addLineItem}
          onBack={() => setStepIdx(1)}
          onContinue={goToReview}
        />
      </Show>

      <Show when={stepId() === 'review'}>
        <ReviewStep
          rendering={renderingPdf}
          pdfUrl={pdfUrl}
          total={total}
          clientName={clientName}
          onBack={() => setStepIdx(2)}
          onSend={saveAndSend}
          sending={savingQuote}
          error={sendError}
        />
      </Show>

      <Show when={stepId() === 'send'}>
        <SentStep
          quoteRef={quoteRef}
          clientName={clientName}
          onNewQuote={() => window.location.reload()}
        />
      </Show>
    </div>
  );
}

function IntakeStep(p: {
  clientName: () => string; setClientName: (v: string) => void;
  clientContact: () => string; setClientContact: (v: string) => void;
  projectTitle: () => string; setProjectTitle: (v: string) => void;
  projectAddress: () => string; setProjectAddress: (v: string) => void;
  scopeText: () => string; setScopeText: (v: string) => void;
  canContinue: () => boolean;
  onContinue: () => void;
}) {
  return (
    <div>
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
        Step 1 · Intake
      </div>
      <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight">
        How did the scope come in?
      </h1>
      <p class="mt-2 text-sm text-[color:var(--color-muted)] max-w-2xl leading-relaxed">
        Paste an RFP, an email from a client, or notes from a walk-through. Brief reads it and builds the line items.
      </p>

      <div class="mt-6 grid grid-cols-2 gap-4">
        <Field label="Client name">
          <Input value={p.clientName()} onInput={(e) => p.setClientName(e.currentTarget.value)} />
        </Field>
        <Field label="Contact (optional)">
          <Input value={p.clientContact()} onInput={(e) => p.setClientContact(e.currentTarget.value)} />
        </Field>
        <Field label="Project title">
          <Input value={p.projectTitle()} onInput={(e) => p.setProjectTitle(e.currentTarget.value)} />
        </Field>
        <Field label="Project address (optional)">
          <Input value={p.projectAddress()} onInput={(e) => p.setProjectAddress(e.currentTarget.value)} />
        </Field>
      </div>

      <div class="mt-4">
        <Field label="Scope text" helper="RFP, email body, walk-through notes — paste anything that describes the work">
          <textarea
            rows={10}
            value={p.scopeText()}
            onInput={(e) => p.setScopeText(e.currentTarget.value)}
            placeholder="Paste the scope text here…"
            class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y min-h-[180px] leading-relaxed"
          />
        </Field>
      </div>

      <div class="mt-6 flex justify-end">
        <Button variant="accent" onClick={p.onContinue} disabled={!p.canContinue()}>
          Scan this scope →
        </Button>
      </div>
    </div>
  );
}

function ScopeStep(p: {
  scanning: () => boolean;
  progress: () => number;
  error: () => string | null;
  lineItems: () => LineItem[];
  flags: () => Flag[];
  scopeSummary: () => string;
  onRetry: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div>
      {/* Header — eyebrow + serif H1 + big % readout right-aligned
          (matches design/mockups/01-agenda-default.png). */}
      <div class="flex items-start gap-6">
        <div class="flex-1 min-w-0">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Brief is reading the scope
          </div>
          <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight tracking-tight">
            Picking out the line items.
          </h1>
        </div>
        <div class="font-serif text-[36px] font-medium tabular-nums leading-none text-[color:var(--color-ink)]">
          {Math.round(p.progress())}<span class="text-[18px] text-[color:var(--color-muted)]">%</span>
        </div>
      </div>

      <div class="mt-4 h-1 bg-[color:var(--color-bg-2)] rounded-full overflow-hidden">
        <div
          class="h-full bg-[color:var(--color-accent)] transition-all duration-300"
          style={{ width: `${p.progress()}%` }}
        />
      </div>

      <Show when={p.error()}>
        <div class="mt-4 rounded-lg bg-[color:var(--color-danger-tint)] px-4 py-3 text-sm text-[color:var(--color-danger)]">
          {p.error()}.{' '}
          <button class="underline" onClick={p.onRetry}>Retry</button>
        </div>
      </Show>

      <Show when={p.flags().length > 0}>
        <div class="mt-6 space-y-2">
          <For each={p.flags()}>
            {(f) => (
              <div class="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] px-4 py-3 flex items-start gap-3">
                <span class={[
                  'mt-0.5 w-1.5 h-1.5 rounded-full shrink-0',
                  f.kind === 'warn' ? 'bg-[color:var(--color-warn)]' : 'bg-[color:var(--color-info)]',
                ].join(' ')} aria-hidden="true" />
                <div class="text-sm">{f.text}</div>
                <span class="ml-auto text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
                  {f.kind}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="mt-6">
        <Show when={p.lineItems().length > 0}>
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] mb-2">
            Line items ({p.lineItems().length})
          </div>
          <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-line)]">
            <For each={p.lineItems()}>
              {(li) => (
                <div class="px-4 py-3 flex items-start gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-[color:var(--color-ink)]">{li.description}</div>
                    <div class="text-xs text-[color:var(--color-muted)] mt-1">
                      {li.qty} {li.unit} · ${li.unit_price.toFixed(2)}/u · ${li.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                    <Show when={li.source_excerpt}>
                      <div class="mt-1.5 text-xs italic text-[color:var(--color-muted)] font-serif">
                        "{li.source_excerpt}"
                      </div>
                    </Show>
                  </div>
                  <Show when={li.confidence}>
                    <Pill
                      tone={li.confidence === 'high' ? 'good' : li.confidence === 'low' ? 'warn' : 'info'}
                      size="sm"
                    >
                      {li.confidence}
                    </Pill>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={p.onBack}>← Back</Button>
        <Button variant="accent" disabled={p.scanning() || p.lineItems().length === 0} onClick={p.onContinue}>
          Continue to pricing →
        </Button>
      </div>
    </div>
  );
}

function PricingStep(p: {
  shop: ShopContext;
  lineItems: () => LineItem[];
  markupPct: () => number;
  setMarkupPct: (v: number) => void;
  baseSubtotal: () => number;
  marginAmount: () => number;
  total: () => number;
  updateLineItem: (idx: number, patch: Partial<LineItem>) => void;
  removeLineItem: (idx: number) => void;
  addLineItem: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
        Step 3 · Pricing
      </div>
      <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight">
        Confirm the numbers.
      </h1>

      <div class="mt-6 grid grid-cols-[1fr_320px] gap-6">
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)]">
          <div class="grid grid-cols-[3fr_70px_80px_110px_100px_40px] px-4 py-3 border-b border-[color:var(--color-line)] text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
            <div>Description</div>
            <div class="text-right">Qty</div>
            <div class="text-right">Unit</div>
            <div class="text-right">Unit $</div>
            <div class="text-right">Subtotal</div>
            <div />
          </div>
          <div class="divide-y divide-[color:var(--color-line)]">
            <For each={p.lineItems()}>
              {(li, idx) => (
                <div class="grid grid-cols-[3fr_70px_80px_110px_100px_40px] items-center px-4 py-2.5 gap-2 text-sm">
                  <input
                    class="bg-transparent border-0 outline-none px-1 py-1 focus:bg-[color:var(--color-surface-2)] rounded"
                    value={li.description}
                    onInput={(e) => p.updateLineItem(idx(), { description: e.currentTarget.value })}
                  />
                  <input
                    type="number"
                    step="0.01"
                    class="bg-transparent border-0 outline-none px-1 py-1 text-right tabular-nums focus:bg-[color:var(--color-surface-2)] rounded"
                    value={li.qty}
                    onInput={(e) => p.updateLineItem(idx(), { qty: parseFloat(e.currentTarget.value || '0') })}
                  />
                  <input
                    class="bg-transparent border-0 outline-none px-1 py-1 text-right text-xs text-[color:var(--color-muted)] focus:bg-[color:var(--color-surface-2)] rounded"
                    value={li.unit}
                    onInput={(e) => p.updateLineItem(idx(), { unit: e.currentTarget.value })}
                  />
                  <input
                    type="number"
                    step="0.01"
                    class="bg-transparent border-0 outline-none px-1 py-1 text-right tabular-nums focus:bg-[color:var(--color-surface-2)] rounded"
                    value={li.unit_price}
                    onInput={(e) => p.updateLineItem(idx(), { unit_price: parseFloat(e.currentTarget.value || '0') })}
                  />
                  <div class="text-right tabular-nums font-mono">
                    ${li.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <button
                    type="button"
                    aria-label="Remove line item"
                    class="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)]"
                    onClick={() => p.removeLineItem(idx())}
                  >×</button>
                </div>
              )}
            </For>
          </div>
          <div class="px-4 py-3 border-t border-[color:var(--color-line)]">
            <Button size="sm" variant="ghost" onClick={p.addLineItem}>+ Add line item</Button>
          </div>
        </div>

        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
            Margin
          </div>
          <div class="mt-1 flex items-baseline gap-1.5">
            <input
              type="number"
              step="0.5"
              class="font-serif text-[28px] font-medium tabular-nums w-20 bg-transparent border-0 outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1"
              value={p.markupPct()}
              onInput={(e) => p.setMarkupPct(parseFloat(e.currentTarget.value || '0'))}
            />
            <span class="text-sm text-[color:var(--color-muted)]">%</span>
          </div>
          <div class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-[color:var(--color-muted)]">Subtotal</span>
              <span class="tabular-nums font-mono">
                ${p.baseSubtotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-[color:var(--color-muted)]">Margin</span>
              <span class="tabular-nums font-mono">
                ${p.marginAmount().toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div class="flex justify-between pt-2 mt-2 border-t border-[color:var(--color-line)] font-medium">
              <span>Total</span>
              <span class="tabular-nums font-mono font-serif text-[18px]">
                ${p.total().toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={p.onBack}>← Back</Button>
        <Button variant="accent" disabled={p.lineItems().length === 0} onClick={p.onContinue}>
          Continue to review →
        </Button>
      </div>
    </div>
  );
}

function ReviewStep(p: {
  rendering: () => boolean;
  pdfUrl: () => string | null;
  total: () => number;
  clientName: () => string;
  onBack: () => void;
  onSend: () => void;
  sending: () => boolean;
  error: () => string | null;
}) {
  let iframeRef: HTMLIFrameElement | undefined;

  const printIt = () => {
    if (!iframeRef || !iframeRef.contentWindow) return;
    iframeRef.contentWindow.focus();
    iframeRef.contentWindow.print();
  };

  return (
    <div>
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
        Step 4 · Review
      </div>
      <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight">
        Read through it once.
      </h1>
      <p class="mt-2 text-sm text-[color:var(--color-muted)]">
        Final price: <span class="font-serif font-medium text-[color:var(--color-ink)]">
          ${p.total().toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span> to {p.clientName()}.
      </p>

      <div class="mt-6 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] overflow-hidden">
        <Show when={p.rendering()}>
          <div class="aspect-[8.5/11] flex items-center justify-center text-sm text-[color:var(--color-muted)]">
            Rendering preview…
          </div>
        </Show>
        <Show when={!p.rendering() && p.pdfUrl()}>
          <iframe
            ref={iframeRef!}
            src={p.pdfUrl()!}
            class="w-full aspect-[8.5/11] bg-white"
            title="Bid preview"
          />
        </Show>
      </div>

      <Show when={!p.rendering() && p.pdfUrl()}>
        <div class="mt-3 flex items-center justify-between text-xs text-[color:var(--color-muted)]">
          <span class="italic font-serif">
            Looks right? Print to PDF before sending, or just save and mark sent.
          </span>
          <button
            type="button"
            onClick={printIt}
            class="underline hover:text-[color:var(--color-ink)]"
          >
            Print / Save as PDF
          </button>
        </div>
      </Show>

      <Show when={p.error()}>
        <div class="mt-4 rounded-lg bg-[color:var(--color-danger-tint)] px-4 py-3 text-sm text-[color:var(--color-danger)]">
          {p.error()}
        </div>
      </Show>

      <div class="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={p.onBack}>← Back to pricing</Button>
        <Button variant="accent" disabled={p.sending() || !p.pdfUrl()} onClick={p.onSend}>
          {p.sending() ? 'Saving…' : 'Save + mark sent →'}
        </Button>
      </div>
    </div>
  );
}

function SentStep(p: {
  quoteRef: () => string | null;
  clientName: () => string;
  onNewQuote: () => void;
}) {
  return (
    <div class="text-center py-16">
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
        Sent
      </div>
      <h1 class="mt-2 font-serif text-[40px] font-medium leading-tight">
        Off it goes.
      </h1>
      <p class="mt-3 text-sm text-[color:var(--color-muted)] max-w-md mx-auto">
        Quote {p.quoteRef()} to {p.clientName()}. Brief will let you know when they open it.
      </p>
      <div class="mt-6 flex items-center justify-center gap-2">
        <a
          href="/quotes"
          class="inline-flex items-center px-4 py-2 rounded-lg bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-sm font-medium hover:bg-[color:var(--color-surface-2)]"
        >
          View all quotes
        </a>
        <Button variant="accent" onClick={p.onNewQuote}>New quote</Button>
      </div>
    </div>
  );
}

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}
