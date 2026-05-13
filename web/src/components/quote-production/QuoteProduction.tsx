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
  subtotal: number; // cost basis: qty * unit_price
  category: string;
  confidence?: string;
  source_excerpt?: string;
  /** Per-line margin override. null = use the quote-level markup. */
  margin_pct?: number | null;
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
  const [clientContactEmail, setClientContactEmail] = createSignal('');
  const [clientContactPhone, setClientContactPhone] = createSignal('');
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

  // Derived totals — per-line margin overrides the global. A null
  // margin_pct on a line falls back to the quote-level markupPct.
  const baseSubtotal = createMemo(() =>
    lineItems().reduce((s, li) => s + li.subtotal, 0),
  );
  const total = createMemo(() =>
    round(
      lineItems().reduce((s, li) => {
        const m = li.margin_pct != null ? li.margin_pct : markupPct();
        return s + li.subtotal * (1 + m / 100);
      }, 0),
      2,
    ),
  );
  const marginAmount = createMemo(() => round(total() - baseSubtotal(), 2));

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
        margin_pct: null,
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
          // Pre-apply per-line margin so the PDF shows the customer-
          // facing price per line. unit_price stays as cost basis on
          // the wizard; the PDF only needs the all-in line subtotal.
          line_items: lineItems().map((li) => {
            const m = li.margin_pct != null ? li.margin_pct : markupPct();
            const lineTotal = round(li.subtotal * (1 + m / 100), 2);
            return {
              ...li,
              unit_price: round(li.unit_price * (1 + m / 100), 2),
              subtotal: lineTotal,
            };
          }),
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
          client_contact_email: clientContactEmail().trim() || null,
          client_contact_phone: clientContactPhone().trim() || null,
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

      // Send. If the operator gave us an email, hand off to Brevo via
      // channel='email'; otherwise just mark sent without delivery.
      const channel = clientContactEmail().trim() ? 'email' : 'manual';
      const sendResp = await fetch('/api/quote/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quote_id: saved.id, channel }),
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
          clientContactEmail={clientContactEmail} setClientContactEmail={setClientContactEmail}
          clientContactPhone={clientContactPhone} setClientContactPhone={setClientContactPhone}
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
          baseSubtotal={baseSubtotal}
          marginAmount={marginAmount}
          markupPct={markupPct}
          lineItems={lineItems}
          clientName={clientName}
          clientContact={clientContact}
          setClientContact={setClientContact}
          clientContactEmail={clientContactEmail}
          setClientContactEmail={setClientContactEmail}
          clientContactPhone={clientContactPhone}
          setClientContactPhone={setClientContactPhone}
          projectTitle={projectTitle}
          projectAddress={projectAddress}
          shop={props.shop}
          onBack={() => setStepIdx(2)}
          onSend={saveAndSend}
          sending={savingQuote}
          error={sendError}
        />
      </Show>

      <Show when={stepId() === 'send'}>
        <SentStep
          quoteId={quoteId}
          quoteRef={quoteRef}
          clientName={clientName}
          clientContact={clientContact}
          projectTitle={projectTitle}
          total={total}
          lineItemCount={() => lineItems().length}
          onNewQuote={() => window.location.reload()}
        />
      </Show>
    </div>
  );
}

function IntakeStep(p: {
  clientName: () => string; setClientName: (v: string) => void;
  clientContact: () => string; setClientContact: (v: string) => void;
  clientContactEmail: () => string; setClientContactEmail: (v: string) => void;
  clientContactPhone: () => string; setClientContactPhone: (v: string) => void;
  projectTitle: () => string; setProjectTitle: (v: string) => void;
  projectAddress: () => string; setProjectAddress: (v: string) => void;
  scopeText: () => string; setScopeText: (v: string) => void;
  canContinue: () => boolean;
  onContinue: () => void;
}) {
  // Apply auto-extracted metadata (from PDF or voice) to the form.
  // Only writes empty fields — never clobbers what the operator typed.
  const applyMetadata = (m: (IntakeMetadata & { contact_email?: string | null; contact_phone?: string | null }) | null) => {
    if (!m) return;
    if (m.client_name && !p.clientName().trim()) p.setClientName(m.client_name);
    if (m.contact_name && !p.clientContact().trim()) p.setClientContact(m.contact_name);
    if (m.contact_email && !p.clientContactEmail().trim()) p.setClientContactEmail(m.contact_email);
    if (m.contact_phone && !p.clientContactPhone().trim()) p.setClientContactPhone(m.contact_phone);
    if (m.project_title && !p.projectTitle().trim()) p.setProjectTitle(m.project_title);
    if (m.project_address && !p.projectAddress().trim()) p.setProjectAddress(m.project_address);
  };

  // What's still keeping the operator from advancing. Surfacing this
  // next to the disabled button — otherwise it just looks broken when
  // auto-extraction missed the client / project fields.
  const missingForScan = (): string[] => {
    const m: string[] = [];
    if (!p.clientName().trim()) m.push('client name');
    if (!p.projectTitle().trim()) m.push('project title');
    if (p.scopeText().trim().length < 30) m.push('scope');
    return m;
  };

  return (
    <div>
      <h1 class="font-serif text-[36px] sm:text-[40px] font-medium leading-tight tracking-tight">
        Tell Brief about the job.
      </h1>
      <p class="mt-3 text-[15px] font-serif text-[color:var(--color-ink-2)] leading-relaxed max-w-[55ch]">
        Drop a PDF, record a quick walk-through, or just type the scope.
        Brief reads what you give it and builds the line items.
      </p>

      {/* Client + project. Email + phone are how Brief actually
          delivers — without one of them the quote saves but doesn't
          send. Surface that on the Review step so the operator can
          spot it before hitting send. */}
      <div class="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Client name" required>
          <Input value={p.clientName()} onInput={(e) => p.setClientName(e.currentTarget.value)} />
        </Field>
        <Field label="Contact name (optional)">
          <Input value={p.clientContact()} onInput={(e) => p.setClientContact(e.currentTarget.value)} />
        </Field>
        <Field label="Contact email" helper="Where the quote gets sent.">
          <Input
            type="email"
            value={p.clientContactEmail()}
            onInput={(e) => p.setClientContactEmail(e.currentTarget.value)}
            placeholder="diane@halsted.com"
          />
        </Field>
        <Field label="Contact phone (optional)" helper="For SMS reminders.">
          <Input
            value={p.clientContactPhone()}
            onInput={(e) => p.setClientContactPhone(e.currentTarget.value)}
            placeholder="+1…"
          />
        </Field>
        <Field label="Project title" required>
          <Input value={p.projectTitle()} onInput={(e) => p.setProjectTitle(e.currentTarget.value)} />
        </Field>
        <Field label="Project address (optional)">
          <Input value={p.projectAddress()} onInput={(e) => p.setProjectAddress(e.currentTarget.value)} />
        </Field>
      </div>

      {/* Shortcut bar — PDF + voice side by side, populate the textarea. */}
      <div class="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PdfIntake setScopeText={p.setScopeText} applyMetadata={applyMetadata} />
        <VoiceIntake setScopeText={p.setScopeText} applyMetadata={applyMetadata} />
      </div>

      {/* Scope textarea — primary input, always visible. */}
      <div class="mt-4">
        <Field
          label="Scope"
          required
          helper="The PDF or recording fills this in. You can also type or paste directly. Brief scans whatever ends up here."
        >
          <textarea
            rows={10}
            value={p.scopeText()}
            onInput={(e) => p.setScopeText(e.currentTarget.value)}
            placeholder="Paste the scope, or use a shortcut above…"
            class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y min-h-[200px] leading-relaxed"
          />
        </Field>
      </div>

      <div class="mt-6 flex flex-col items-end gap-2">
        <Show when={missingForScan().length > 0}>
          <span class="text-xs text-[color:var(--color-muted)]">
            Add {formatMissing(missingForScan())} to continue.
          </span>
        </Show>
        <Button variant="accent" onClick={p.onContinue} disabled={!p.canContinue()}>
          Scan this scope →
        </Button>
      </div>
    </div>
  );
}

function formatMissing(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

interface IntakeMetadata {
  client_name?: string | null;
  contact_name?: string | null;
  project_title?: string | null;
  project_address?: string | null;
}

function PdfIntake(p: {
  setScopeText: (v: string) => void;
  applyMetadata: (m: IntakeMetadata | null) => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [info, setInfo] = createSignal<{ filename: string; pages: number; chars: number } | null>(null);
  let inputRef: HTMLInputElement | undefined;

  const handle = async (file: File) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/intake/extract-pdf', { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json() as { text: string; page_count: number; empty_text: boolean; filename: string; metadata?: IntakeMetadata | null };
      if (data.empty_text) {
        setError('Brief read the PDF but found no selectable text — looks scanned. Try the voice or paste option instead.');
        return;
      }
      p.setScopeText(data.text);
      p.applyMetadata(data.metadata ?? null);
      setInfo({ filename: data.filename, pages: data.page_count, chars: data.text.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label
        class={[
          'block rounded-xl border-2 border-dashed cursor-pointer px-5 py-6 text-center transition-colors',
          busy()
            ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-tint)]'
            : 'border-[color:var(--color-line-2)] bg-[color:var(--color-surface-2)] hover:border-[color:var(--color-accent)]',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          class="sr-only"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) handle(f);
          }}
        />
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" class="mx-auto text-[color:var(--color-muted)]" aria-hidden="true">
          <path d="M7 4h7l4 4v9.5a1.5 1.5 0 0 1 -1.5 1.5h-9.5a1.5 1.5 0 0 1 -1.5 -1.5v-12a1.5 1.5 0 0 1 1.5 -1.5z" />
          <path d="M14 4v4h4" />
          <path d="M11 18v-5M9 15l2 -2 2 2" stroke-linecap="round" />
        </svg>
        <div class="mt-2 text-sm font-medium">
          {busy() ? 'Extracting text…' : info() ? `${info()!.filename} · ${info()!.pages} page${info()!.pages === 1 ? '' : 's'} · ${info()!.chars.toLocaleString()} chars` : 'Drop a PDF or click to choose'}
        </div>
        <div class="mt-1 text-xs text-[color:var(--color-muted)]">
          Up to 15 MB. Native-text PDFs only — scanned images won't parse.
        </div>
      </label>
      <Show when={error()}>
        <div class="mt-2 text-xs text-[color:var(--color-danger)]">{error()}</div>
      </Show>
    </div>
  );
}

function VoiceIntake(p: {
  setScopeText: (v: string) => void;
  applyMetadata: (m: IntakeMetadata | null) => void;
}) {
  const [state, setState] = createSignal<'idle' | 'recording' | 'uploading' | 'done'>('idle');
  const [error, setError] = createSignal<string | null>(null);
  const [info, setInfo] = createSignal<{ duration: number | null; chars: number; bytes: number } | null>(null);
  // `elapsed` is the live counter while recording; `recordedSeconds`
  // is the captured value at stop-time so the UI can keep showing
  // it through 'uploading' and 'done' states.
  const [elapsed, setElapsed] = createSignal(0);
  const [recordedSeconds, setRecordedSeconds] = createSignal<number | null>(null);
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let timer: number | null = null;

  const cleanup = () => {
    if (timer != null) { clearInterval(timer); timer = null; }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    mediaRecorder = null;
    chunks = [];
  };

  const start = async () => {
    // eslint-disable-next-line no-console
    console.log('[VoiceIntake] start clicked', { state: state(), hasMR: !!mediaRecorder });
    if (state() === 'recording') {
      // Defensive — if the button reads as "start" but we're somehow
      // still in recording state, treat as a stop instead.
      // eslint-disable-next-line no-console
      console.warn('[VoiceIntake] start clicked while recording — routing to stop');
      stop();
      return;
    }
    setError(null);
    setInfo(null);
    setRecordedSeconds(null);

    if (typeof MediaRecorder === 'undefined') {
      setError('MediaRecorder isn\'t available in this browser. Use the file-upload fallback below or paste the scope directly.');
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(mediaStream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onerror = (e) => {
        // eslint-disable-next-line no-console
        console.error('[VoiceIntake] MediaRecorder error', e);
        setError(`Recorder error: ${(e as any).error?.message ?? 'unknown'}`);
        setState('idle');
        cleanup();
      };
      mediaRecorder.onstop = async () => {
        try {
          const mime = mediaRecorder?.mimeType || 'audio/webm';
          // eslint-disable-next-line no-console
          console.log('[VoiceIntake] onstop fired', { chunkCount: chunks.length, mime });
          if (chunks.length === 0) {
            setError('Recording stopped before any audio data was captured. Try again — record for at least a second or two.');
            setState('idle');
            cleanup();
            return;
          }
          const blob = new Blob(chunks, { type: mime });
          // eslint-disable-next-line no-console
          console.log('[VoiceIntake] blob built', { size: blob.size, type: blob.type });
          cleanup();
          await transcribe(blob);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[VoiceIntake] onstop failure', err);
          setError(`Audio processing failed: ${err instanceof Error ? err.message : String(err)}`);
          setState('idle');
          cleanup();
        }
      };
      mediaRecorder.start(250);
      // eslint-disable-next-line no-console
      console.log('[VoiceIntake] recorder started', { state: mediaRecorder.state, mime: mediaRecorder.mimeType });
      setState('recording');
      setElapsed(0);
      timer = window.setInterval(() => setElapsed(elapsed() + 1), 1000);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[VoiceIntake] start failure', err);
      setError(`Mic access failed: ${err instanceof Error ? err.message : String(err)}`);
      cleanup();
    }
  };

  const stop = () => {
    // eslint-disable-next-line no-console
    console.log('[VoiceIntake] stop clicked', {
      state: state(),
      mrState: mediaRecorder?.state,
      hasMR: !!mediaRecorder,
      hasStream: !!mediaStream,
    });
    setRecordedSeconds(elapsed());
    if (timer != null) { clearInterval(timer); timer = null; }
    if (!mediaRecorder) {
      setError('Recorder isn\'t initialized — try starting again.');
      setState('idle');
      cleanup();
      return;
    }
    if (mediaRecorder.state === 'inactive') {
      setError('Recorder was already stopped. If you saw this immediately after pressing record, the mic stream ended early.');
      setState('idle');
      cleanup();
      return;
    }
    try {
      if (typeof mediaRecorder.requestData === 'function') {
        try { mediaRecorder.requestData(); } catch {}
      }
      mediaRecorder.stop();
      setState('uploading');
      // eslint-disable-next-line no-console
      console.log('[VoiceIntake] stop() called, awaiting onstop');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[VoiceIntake] stop() threw', err);
      setError(`Couldn't stop the recorder: ${err instanceof Error ? err.message : String(err)}`);
      setState('idle');
      // Critical: kill the stream so the mic indicator goes off and
      // the operator sees that pressing stop did something.
      cleanup();
    }
  };

  // Audio-file fallback for browsers/setups where MediaRecorder is
  // flaky. User drops an mp3/wav/m4a/webm — same transcribe path.
  const handleAudioUpload = async (file: File) => {
    setError(null);
    setInfo(null);
    setRecordedSeconds(null);
    setState('uploading');
    await transcribe(file);
  };

  const transcribe = async (blob: Blob) => {
    try {
      const fd = new FormData();
      const filename = blob instanceof File
        ? blob.name
        : blob.type.includes('mp4')
          ? 'recording.m4a'
          : blob.type.includes('webm')
            ? 'recording.webm'
            : blob.type.includes('ogg')
              ? 'recording.ogg'
              : 'recording.wav';
      fd.append('file', blob, filename);
      const resp = await fetch('/api/intake/transcribe', { method: 'POST', body: fd });
      const data = await resp.json().catch(() => null) as
        | {
            text?: string;
            duration_seconds?: number | null;
            empty_text?: boolean;
            error?: string;
            file_type?: string;
            file_size?: number;
            tried?: Array<{ model: string; ok: boolean; chars: number; error?: string }>;
            metadata?: IntakeMetadata | null;
          }
        | null;
      if (!resp.ok) {
        throw new Error(data?.error || `Server returned ${resp.status}`);
      }
      if (!data || data.empty_text || !data.text?.trim()) {
        const triedSummary = (data?.tried ?? [])
          .map((t) => `${t.model.split('/').pop()}: ${t.ok ? `${t.chars} chars` : t.error}`)
          .join(' · ');
        setError(
          `Captured ${recordedSeconds() ?? '?'}s of audio (${data?.file_type || 'unknown format'}, ` +
          `${data?.file_size ?? '?'} bytes) but Whisper returned an empty transcript. ` +
          `${triedSummary ? `Tried — ${triedSummary}.` : ''} ` +
          `Try again, use the file-upload fallback below, or paste the scope directly.`,
        );
        setState('idle');
        return;
      }
      p.setScopeText(data.text);
      p.applyMetadata(data.metadata ?? null);
      setInfo({
        duration: data.duration_seconds ?? null,
        chars: data.text.length,
        bytes: data.file_size ?? blob.size,
      });
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('idle');
    }
  };

  const timerLabel = (secs: number) =>
    `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <div>
      <div
        class={[
          'rounded-xl border border-[color:var(--color-line-2)] px-5 py-5 flex items-center gap-4',
          state() === 'recording'
            ? 'bg-[color:var(--color-danger-tint)] border-[color:var(--color-danger)]'
            : 'bg-[color:var(--color-surface-2)]',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={state() === 'recording' ? stop : start}
          disabled={state() === 'uploading'}
          class={[
            'w-12 h-12 rounded-full grid place-items-center shrink-0 transition-colors',
            state() === 'recording'
              ? 'bg-[color:var(--color-danger)] text-white animate-pulse'
              : 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)]',
            state() === 'uploading' ? 'opacity-50 cursor-wait' : 'hover:brightness-95',
          ].join(' ')}
          aria-label={state() === 'recording' ? 'Stop recording' : 'Start recording'}
        >
          <Show
            when={state() === 'recording'}
            fallback={
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
                <rect x="7" y="2" width="6" height="9" rx="3" />
                <path d="M4 10a6 6 0 0 0 12 0M10 16v2" stroke-linecap="round" />
              </svg>
            }
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <rect x="2" y="2" width="10" height="10" rx="1.5" />
            </svg>
          </Show>
        </button>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium flex items-baseline gap-2">
            <span>
              {state() === 'idle' && 'Tap to start recording'}
              {state() === 'recording' && 'Recording…'}
              {state() === 'uploading' && 'Transcribing with Workers AI…'}
              {state() === 'done' && info() && `Transcribed ${info()!.chars.toLocaleString()} chars`}
            </span>
            <Show when={state() === 'recording' || (recordedSeconds() != null && state() !== 'idle')}>
              <span class="font-mono text-xs text-[color:var(--color-muted)] tabular-nums">
                {timerLabel(state() === 'recording' ? elapsed() : recordedSeconds() ?? 0)}
              </span>
            </Show>
          </div>
          <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
            {state() === 'recording'
              ? 'Tap to stop'
              : state() === 'uploading'
                ? 'Whisper running on your audio. A few seconds.'
                : state() === 'done'
                  ? 'Transcript appears below; edit anything you want to keep.'
                  : 'Up to 25 minutes. Talk through the walk-through; Brief structures it.'}
          </div>
        </div>
        <Show when={state() === 'done'}>
          <button
            type="button"
            onClick={start}
            class="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] underline"
          >
            Record again
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div class="mt-2 text-xs text-[color:var(--color-danger)] leading-relaxed">{error()}</div>
      </Show>

      {/* File-upload alternative. Same Whisper path, no MediaRecorder.
          Discoverable as a peer option so operators with flaky mic
          setups can use this without hunting through an accordion. */}
      <Show when={state() === 'idle' || state() === 'done'}>
        <label class="mt-3 block rounded-xl border border-dashed border-[color:var(--color-line-2)] bg-[color:var(--color-surface-2)] hover:border-[color:var(--color-accent)] px-5 py-4 cursor-pointer">
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
            class="sr-only"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) handleAudioUpload(f);
            }}
          />
          <div class="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" class="text-[color:var(--color-muted)]" aria-hidden="true">
              <path d="M4 12v3.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1 -1v-3.5" />
              <path d="M10 4v8M7 7l3 -3 3 3" stroke-linecap="round" />
            </svg>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">Or drop an audio file</div>
              <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
                Record on your phone, send it here. mp3, wav, m4a, webm, ogg.
              </div>
            </div>
          </div>
        </label>
      </Show>
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

      {/* Narrative task list — gives the operator a sense of what
          Brief is actually doing while the SSE stream fills line
          items. Tasks animate to "done" as scan progress crosses
          their thresholds. Stays visible until 100% AND we have
          line items; then collapses to make room. */}
      <Show when={!p.error() && (p.progress() < 100 || p.lineItems().length === 0)}>
        <ScanTaskList progress={p.progress} lineItemCount={() => p.lineItems().length} />
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
                      {li.qty} {li.unit} · ${Number(li.unit_price ?? 0).toFixed(2)}/u · ${Number(li.subtotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
        {/* Gated only on the scan still running. Zero-item scans
            still let the operator advance — Pricing step has an
            "Add line" UI that can recover from a thin extract. */}
        <Button variant="accent" disabled={p.scanning()} onClick={p.onContinue}>
          {p.lineItems().length === 0 && !p.scanning()
            ? 'Continue (add lines manually) →'
            : 'Continue to pricing →'}
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

      <div class="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-x-auto">
          <div class="grid grid-cols-[3fr_60px_70px_90px_70px_100px_36px] min-w-[720px] px-4 py-3 border-b border-[color:var(--color-line)] text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
            <div>Description</div>
            <div class="text-right">Qty</div>
            <div class="text-right">Unit</div>
            <div class="text-right">Unit $</div>
            <div class="text-right">Margin</div>
            <div class="text-right">Total</div>
            <div />
          </div>
          <div class="divide-y divide-[color:var(--color-line)] min-w-[720px]">
            <For each={p.lineItems()}>
              {(li, idx) => {
                const effectiveMargin = () => (li.margin_pct != null ? li.margin_pct : p.markupPct());
                const lineTotal = () => round(li.subtotal * (1 + effectiveMargin() / 100), 2);
                return (
                  <div class="grid grid-cols-[3fr_60px_70px_90px_70px_100px_36px] items-center px-4 py-2.5 gap-2 text-sm">
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
                    <div class="relative">
                      <input
                        type="number"
                        step="0.5"
                        placeholder={`${p.markupPct()}`}
                        title={li.margin_pct == null ? `Default: ${p.markupPct()}% (quote-level). Type to override.` : `Per-line override`}
                        class={[
                          'w-full bg-transparent border-0 outline-none px-1 py-1 text-right tabular-nums focus:bg-[color:var(--color-surface-2)] rounded',
                          li.margin_pct == null ? 'text-[color:var(--color-muted)]' : 'text-[color:var(--color-ink)]',
                        ].join(' ')}
                        value={li.margin_pct ?? ''}
                        onInput={(e) => {
                          const raw = e.currentTarget.value;
                          p.updateLineItem(idx(), { margin_pct: raw === '' ? null : parseFloat(raw) });
                        }}
                      />
                    </div>
                    <div class="text-right tabular-nums font-mono">
                      ${lineTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                    <button
                      type="button"
                      aria-label="Remove line item"
                      class="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)]"
                      onClick={() => p.removeLineItem(idx())}
                    >×</button>
                  </div>
                );
              }}
            </For>
          </div>
          <div class="px-4 py-3 border-t border-[color:var(--color-line)]">
            <Button size="sm" variant="ghost" onClick={p.addLineItem}>+ Add line item</Button>
          </div>
        </div>

        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
            Default margin
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
          <p class="mt-1 text-[11.5px] text-[color:var(--color-muted)] leading-relaxed">
            Applied to every line where you haven't set an override.
          </p>
          <div class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-[color:var(--color-muted)]">Cost subtotal</span>
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
  baseSubtotal: () => number;
  marginAmount: () => number;
  markupPct: () => number;
  lineItems: () => LineItem[];
  clientName: () => string;
  clientContact: () => string;
  setClientContact: (v: string) => void;
  clientContactEmail: () => string;
  setClientContactEmail: (v: string) => void;
  clientContactPhone: () => string;
  setClientContactPhone: (v: string) => void;
  projectTitle: () => string;
  projectAddress: () => string;
  shop: ShopContext;
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

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const recipient = () => p.clientContact()?.trim() || p.clientName();

  // Pre-send readiness checks — each row gets a green check or a soft warning.
  const checks = createMemo(() => {
    const items = p.lineItems();
    return [
      {
        ok: items.length > 0,
        label: `${items.length} line item${items.length === 1 ? '' : 's'} priced`,
        sub: items.length === 0 ? 'Pricing step is empty — go back and add at least one line.' : undefined,
      },
      {
        ok: p.markupPct() >= 20,
        label: `${p.markupPct().toFixed(0)}% markup applied`,
        sub: p.markupPct() < 20 ? 'Below your typical floor; double-check this is intentional.' : undefined,
      },
      {
        ok: !!p.projectAddress().trim(),
        label: 'Project address on the quote',
        sub: !p.projectAddress().trim() ? 'Optional, but most signers expect it.' : undefined,
      },
      {
        ok: !!p.clientContactEmail().trim(),
        label: p.clientContactEmail().trim()
          ? `Sending to ${p.clientContactEmail().trim()}`
          : 'No email — quote will save without delivery',
        sub: !p.clientContactEmail().trim()
          ? 'Add a contact email on Intake (or to the client later) for Brief to deliver this.'
          : undefined,
      },
    ];
  });

  return (
    <div>
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
        Step 4 · Review
      </div>
      <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight">
        Read through it once.
      </h1>
      <p class="mt-2 text-[15px] font-serif italic text-[color:var(--color-muted)]">
        Brief renders the PDF from your shop's letterhead. The numbers below are
        what {recipient()} sees.
      </p>

      <div class="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] overflow-hidden">
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

        <aside class="space-y-4">
          {/* Sending to — answers "where is this quote going?" */}
          <div
            class={[
              'rounded-xl border p-5',
              p.clientContactEmail().trim()
                ? 'border-[color:var(--color-line)] bg-[color:var(--color-surface)]'
                : 'border-[color:var(--color-warn)] bg-[color:var(--color-warn-tint)]',
            ].join(' ')}
          >
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-2">
              Sending to
            </div>
            <Show
              when={p.clientContactEmail().trim()}
              fallback={
                <div>
                  <p class="text-[14px] font-medium text-[color:var(--color-warn)] leading-snug">
                    No email on file.
                  </p>
                  <p class="mt-1.5 text-[12.5px] font-serif text-[color:var(--color-ink-2)] leading-relaxed">
                    Add one here and Brief will deliver the quote. Leave blank
                    to save without sending.
                  </p>
                  <div class="mt-3 space-y-2">
                    <Field label="Contact email">
                      <Input
                        type="email"
                        value={p.clientContactEmail()}
                        onInput={(e) => p.setClientContactEmail(e.currentTarget.value)}
                        placeholder="diane@halsted.com"
                      />
                    </Field>
                    <Field label="Contact name (optional)">
                      <Input
                        value={p.clientContact()}
                        onInput={(e) => p.setClientContact(e.currentTarget.value)}
                      />
                    </Field>
                    <Field label="SMS phone (optional)">
                      <Input
                        value={p.clientContactPhone()}
                        onInput={(e) => p.setClientContactPhone(e.currentTarget.value)}
                        placeholder="+1…"
                      />
                    </Field>
                  </div>
                </div>
              }
            >
              <div class="space-y-2">
                <div class="text-[14px] leading-snug">
                  <div class="font-medium">{p.clientContact() || p.clientName()}</div>
                  <div class="font-mono text-[12.5px] text-[color:var(--color-accent)]">
                    {p.clientContactEmail()}
                  </div>
                </div>
                <Show when={p.clientContactPhone().trim()}>
                  <div class="text-[12.5px] font-mono text-[color:var(--color-muted)]">
                    + SMS to {p.clientContactPhone()}
                  </div>
                </Show>
                <p class="text-[11.5px] italic font-serif text-[color:var(--color-muted)] pt-1.5 border-t border-[color:var(--color-line)] leading-relaxed">
                  Any always-notify contacts on this client will also receive a
                  copy. Manage them on the client page.
                </p>
              </div>
            </Show>
          </div>

          {/* Final price card */}
          <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">Final price</div>
            <div class="mt-1 font-serif text-[32px] font-medium tabular-nums leading-none">
              {fmt(p.total())}
            </div>
            <div class="mt-2 text-[12.5px] text-[color:var(--color-muted)]">
              to <span class="font-medium text-[color:var(--color-ink)]">{recipient()}</span>
            </div>
            <dl class="mt-4 space-y-1.5 text-[13px] border-t border-[color:var(--color-line)] pt-3">
              <div class="flex justify-between">
                <dt class="text-[color:var(--color-muted)]">Line items subtotal</dt>
                <dd class="font-mono tabular-nums">{fmt(p.baseSubtotal())}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-[color:var(--color-muted)]">Markup ({p.markupPct().toFixed(0)}%)</dt>
                <dd class="font-mono tabular-nums">{fmt(p.marginAmount())}</dd>
              </div>
              <div class="flex justify-between font-medium pt-1.5 border-t border-[color:var(--color-line)]">
                <dt>Total</dt>
                <dd class="font-mono tabular-nums">{fmt(p.total())}</dd>
              </div>
            </dl>
          </div>

          {/* Pre-send checklist */}
          <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-3">Before you send</div>
            <ul class="space-y-2.5">
              <For each={checks()}>
                {(c) => (
                  <li class="flex items-start gap-2.5 text-[13px]">
                    <span class="w-4 h-4 mt-0.5 grid place-items-center shrink-0" aria-hidden="true">
                      <Show
                        when={c.ok}
                        fallback={
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-[color:var(--color-warn)]" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                            <circle cx="7" cy="7" r="5.5" />
                            <path d="M7 4.5v3M7 9.5v.2" />
                          </svg>
                        }
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-[color:var(--color-good)]" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M2.5 7l3 3 6-6.5" />
                        </svg>
                      </Show>
                    </span>
                    <div class="flex-1">
                      <div class={c.ok ? '' : 'text-[color:var(--color-ink-2)]'}>{c.label}</div>
                      <Show when={c.sub}>
                        <div class="text-[11.5px] text-[color:var(--color-muted)] mt-0.5 leading-relaxed">{c.sub}</div>
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </div>

          {/* Letterhead snippet */}
          <div class="rounded-xl bg-[color:var(--color-surface-2)] px-4 py-3 text-[12px] text-[color:var(--color-muted)] leading-relaxed font-serif">
            Sent from <span class="font-medium text-[color:var(--color-ink-2)]">{p.shop.trade_name || p.shop.legal_name}</span>
            <Show when={p.shop.license_number}>
              {' · '}License {p.shop.license_number}{p.shop.license_jurisdiction ? ` (${p.shop.license_jurisdiction})` : ''}
            </Show>
          </div>
        </aside>
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
  quoteId: () => string | null;
  quoteRef: () => string | null;
  clientName: () => string;
  clientContact: () => string;
  projectTitle: () => string;
  total: () => number;
  lineItemCount: () => number;
  onNewQuote: () => void;
}) {
  const sentAt = new Date().toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const fmt = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const recipient = () => p.clientContact()?.trim() || p.clientName();

  return (
    <div class="max-w-[720px] mx-auto pt-8 pb-16">
      <div class="text-center">
        <div
          class="inline-flex w-14 h-14 rounded-full bg-[color:var(--color-good-tint)] text-[color:var(--color-good)] items-center justify-center mb-4"
          aria-hidden="true"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 11l5 5 10-10" />
          </svg>
        </div>
        <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">Step 5 · Sent</div>
        <h1 class="mt-1 font-serif text-[40px] font-medium leading-tight">Off it goes.</h1>
        <p class="mt-3 text-[15px] font-serif italic text-[color:var(--color-muted)] max-w-[42ch] mx-auto leading-relaxed">
          {p.quoteRef()} is in {recipient()}'s inbox. Brief will tell you when it's read.
        </p>
      </div>

      {/* Ticket-stub summary */}
      <div class="mt-8 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
        <div class="px-5 py-3 border-b border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] flex items-center gap-3">
          <span class="font-mono text-[11px] tracking-[0.06em] text-[color:var(--color-muted-2)] uppercase">Quote ref</span>
          <span class="font-mono text-sm text-[color:var(--color-ink)]">{p.quoteRef()}</span>
          <span class="flex-1" />
          <Pill tone="good" dot={false} size="sm">Sent</Pill>
        </div>
        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-y-3 px-5 py-4 text-sm">
          <div>
            <dt class="text-[11px] font-mono uppercase tracking-wide text-[color:var(--color-muted)]">Recipient</dt>
            <dd class="mt-1 font-medium truncate">{recipient()}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-mono uppercase tracking-wide text-[color:var(--color-muted)]">Project</dt>
            <dd class="mt-1 font-medium truncate" title={p.projectTitle()}>{p.projectTitle()}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-mono uppercase tracking-wide text-[color:var(--color-muted)]">Total</dt>
            <dd class="mt-1 font-serif font-medium tabular-nums">{fmt(p.total())}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-mono uppercase tracking-wide text-[color:var(--color-muted)]">Line items</dt>
            <dd class="mt-1 font-mono tabular-nums">{p.lineItemCount()}</dd>
          </div>
        </dl>
        <div class="px-5 pb-4 text-[12px] font-mono text-[color:var(--color-muted)]">
          {sentAt}
        </div>
      </div>

      {/* What happens next */}
      <section class="mt-6 rounded-xl bg-[color:var(--color-accent-tint)]/40 px-5 py-4">
        <h3 class="text-eyebrow font-mono uppercase text-[color:var(--color-accent)] mb-3">What happens next</h3>
        <ul class="space-y-2.5 text-[13.5px] text-[color:var(--color-ink-2)] leading-relaxed">
          <li class="flex items-start gap-2.5">
            <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-[color:var(--color-accent)] shrink-0" aria-hidden="true" />
            <span><strong class="font-medium">Brief watches for opens.</strong> You'll see the timeline tick on the quote detail.</span>
          </li>
          <li class="flex items-start gap-2.5">
            <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-[color:var(--color-accent)] shrink-0" aria-hidden="true" />
            <span><strong class="font-medium">If it goes 5+ days quiet,</strong> Brief drafts a soft check-in for your review.</span>
          </li>
          <li class="flex items-start gap-2.5">
            <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-[color:var(--color-accent)] shrink-0" aria-hidden="true" />
            <span><strong class="font-medium">When they respond,</strong> the Reply drawer opens with a draft grounded in the thread.</span>
          </li>
        </ul>
      </section>

      <div class="mt-7 flex items-center justify-center gap-2 flex-wrap">
        <Show when={p.quoteId()}>
          <a
            href={`/quotes/${p.quoteId()}`}
            class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-sm font-medium hover:bg-[color:var(--color-surface-2)]"
          >
            View this quote
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M2 5.5h7M6 2l3.5 3.5L6 9" />
            </svg>
          </a>
        </Show>
        <a
          href="/quotes"
          class="inline-flex items-center px-4 py-2 rounded-lg bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-sm font-medium hover:bg-[color:var(--color-surface-2)]"
        >
          All quotes
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

/**
 * <ScanTaskList> — narrative of what Brief is doing while the SSE
 * stream fills the line items. Tasks advance based on `progress`
 * thresholds (which the scan endpoint emits in
 * `{type:"progress",percent}` events). Active task gets a spinner +
 * "reading..." right-aligned; completed tasks get a green checkmark;
 * future tasks render at 40% opacity.
 *
 * Mirrors design/mockups/01-agenda-default.png. The thresholds
 * intentionally finish a beat before 100% so by the time progress
 * hits 100 every task is checked and the list can transition cleanly
 * to the line items panel.
 */
function ScanTaskList(p: {
  progress: () => number;
  lineItemCount: () => number;
}) {
  const tasks = [
    { at: 0,  label: 'Reading the scope text' },
    { at: 18, label: 'Identifying project type' },
    { at: 38, label: 'Pulling matching past jobs' },
    { at: 58, label: 'Estimating quantities' },
    { at: 78, label: 'Composing line items + crew estimate' },
    { at: 92, label: 'Cross-checking against your typical margins' },
  ];
  return (
    <div class="mt-6 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] px-5 py-4">
      <ul class="space-y-2.5">
        <For each={tasks}>
          {(t, i) => {
            const next = tasks[i() + 1];
            const done = () => p.progress() >= (next ? next.at : 100);
            const active = () => !done() && p.progress() >= t.at;
            const future = () => p.progress() < t.at;
            return (
              <li
                class={[
                  'flex items-center gap-3 text-[14px] transition-opacity duration-200',
                  future() ? 'opacity-40' : '',
                ].join(' ')}
              >
                <span class="w-4 h-4 grid place-items-center shrink-0" aria-hidden="true">
                  <Show when={done()} fallback={
                    <Show when={active()} fallback={
                      <span class="w-2.5 h-2.5 rounded-full border border-[color:var(--color-line-2)]" />
                    }>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="animate-spin text-[color:var(--color-accent)]">
                        <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="6 10" />
                      </svg>
                    </Show>
                  }>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="text-[color:var(--color-good)]">
                      <path d="M2.5 7l3 3 6-6.5" />
                    </svg>
                  </Show>
                </span>
                <span class="flex-1">{t.label}</span>
                <Show when={active()}>
                  <span class="text-[11px] font-mono italic text-[color:var(--color-muted-2)]">reading…</span>
                </Show>
                <Show when={done() && t.label === 'Composing line items + crew estimate' && p.lineItemCount() > 0}>
                  <span class="text-[11px] font-mono tabular-nums text-[color:var(--color-muted)]">
                    {p.lineItemCount()} so far
                  </span>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
    </div>
  );
}
