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
import OfferPanel from '@/components/quote-production/OfferPanel';
import CoverNotePanel from '@/components/quote-production/CoverNotePanel';
import PhasesEditor, { type Phase } from '@/components/quote-production/PhasesEditor';
import PhasePricingEditor from '@/components/quote-production/PhasePricingEditor';
import RfiNotice from '@/components/quote-production/RfiNotice';
import RfiResponseEditor, { type RfiResponseShape } from '@/components/quote-production/RfiResponseEditor';
import NovelShapeConfirmCard from '@/components/quote-production/NovelShapeConfirmCard';
import FreeformEditor from '@/components/quote-production/FreeformEditor';
import FixedPriceEditor from '@/components/quote-production/FixedPriceEditor';
import TimeAndMaterialsEditor, {
  type TmRate,
  type TmEstimate,
} from '@/components/quote-production/TimeAndMaterialsEditor';
import OfferKindPicker, {
  OFFER_KIND_LABEL,
  type OfferKind,
  type PricingStructure,
} from '@/components/quote-production/OfferKindPicker';
import type { Section, Shape } from '@/lib/shape';
import { countPopulated } from '@/lib/shape';

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

// Step 3's id stays 'pricing' for backward-compat with all the
// existing branches that match on it; the visible label reads
// "Offer" — that's the noun the operator now sees throughout.
const STEPS = [
  { id: 'intake',  label: 'Intake' },
  { id: 'scope',   label: 'Scope' },
  { id: 'pricing', label: 'Offer' },
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

  // Proposal classification (migration 009). Defaults to project_quote
  // so contractor quotes feel unchanged; scan emits a proposal_style
  // event early when the doc looks like consulting / partnership / RFI.
  const [proposalStyle, setProposalStyle] = createSignal<
    'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'unknown'
  >('project_quote');
  const [proposalConfidence, setProposalConfidence] = createSignal(1);
  const [programType, setProgramType] = createSignal<'one_off' | 'recurring' | 'rebate' | null>(null);
  const [termMonths, setTermMonths] = createSignal<number | null>(null);
  const [phases, setPhases] = createSignal<Phase[]>([]);
  const [rebateTerms, setRebateTerms] = createSignal<Array<{ product: string; rebate: string; basis: string }>>([]);
  const [rfiRequirements, setRfiRequirements] = createSignal<string[]>([]);
  const [rfiQuestions, setRfiQuestions] = createSignal<string[]>([]);
  // Offer step state (renamed from Pricing). Three axes:
  //   offerKind         — Quote / Bid / Proposal / Contract
  //   pricingStructure  — fixed_price / itemized / phase_priced /
  //                       time_and_materials / rebate_program
  //   autoDetected      — were these picked by scan, or has the
  //                       operator overridden them?
  // The picker (top of the Offer step) lets the operator override
  // whatever scan classified.
  const [offerKind, setOfferKind] = createSignal<OfferKind>('quote');
  const [pricingStructure, setPricingStructure] = createSignal<PricingStructure>('itemized');
  const [offerAutoDetected, setOfferAutoDetected] = createSignal(true);

  // Fixed-price editor state. When pricing_structure = 'fixed_price'
  // the wizard stores a single line_item under the hood — these two
  // signals back the description + amount on that line.
  const [fixedPriceDescription, setFixedPriceDescription] = createSignal('');
  const [fixedPriceTotal, setFixedPriceTotal] = createSignal(0);

  // T&M editor state — rate cards + estimate band.
  const [tmRates, setTmRates] = createSignal<TmRate[]>([]);
  const [tmEstimate, setTmEstimate] = createSignal<TmEstimate>({
    hours_low: 0,
    hours_high: 0,
    materials: 0,
  });

  // Novel-shape (5th wizard path) — when scan confidence is low or
  // proposal_style is 'unknown', we run /api/shape/propose and let
  // the operator confirm a freeform layout in one click. Sections
  // arrive pre-populated from the source doc.
  const [novelShape, setNovelShape] = createSignal<Shape | null>(null);
  const [novelShapeSource, setNovelShapeSource] = createSignal<'matched' | 'proposed' | null>(null);
  const [novelShapeId, setNovelShapeId] = createSignal<string | null>(null);
  const [novelMatchDistance, setNovelMatchDistance] = createSignal<number | null>(null);
  const [novelAccepted, setNovelAccepted] = createSignal(false);
  const [sectionsData, setSectionsData] = createSignal<Section[]>([]);
  const [proposingShape, setProposingShape] = createSignal(false);
  const [proposeShapeError, setProposeShapeError] = createSignal<string | null>(null);
  const isNovelStyle = () =>
    proposalStyle() === 'unknown' || (proposalConfidence() < 0.6 && novelShape() != null);

  const [rfiResponse, setRfiResponse] = createSignal<RfiResponseShape>({
    requirements_answered: [],
    questions_answered: [],
    narrative_sections: [],
    cover_letter: '',
    submission_format: '',
  });

  // Pricing
  const [markupPct, setMarkupPct] = createSignal<number>(props.shop.default_markup_pct ?? 32);

  // Review / Send
  const [pdfUrl, setPdfUrl] = createSignal<string | null>(null);
  const [renderingPdf, setRenderingPdf] = createSignal(false);
  const [savingQuote, setSavingQuote] = createSignal(false);
  const [quoteId, setQuoteId] = createSignal<string | null>(null);
  const [quoteRef, setQuoteRef] = createSignal<string | null>(null);
  const [sendError, setSendError] = createSignal<string | null>(null);
  /** Set when /api/quote/send returns ok but with delivery_error
   * (e.g. Brevo couldn't deliver, no recipients resolved). The quote
   * is saved as SENT but the email didn't actually leave — operator
   * needs to know so they can chase it manually. */
  const [deliveryWarning, setDeliveryWarning] = createSignal<string | null>(null);

  // Derived totals — per-line margin overrides the global. A null
  // margin_pct on a line falls back to the quote-level markupPct.
  // Narrative pricing: when there are zero line items but phases with
  // fees, total = sum of phase fees. baseSubtotal mirrors total in
  // that case (no margin math — phase fees are fixed-price).
  const isNarrativeStyle = () =>
    proposalStyle() === 'consulting' || proposalStyle() === 'partnership';
  const phasesTotal = createMemo(() =>
    round(
      phases().reduce((s, ph) => s + (Number(ph.fee) || 0), 0),
      2,
    ),
  );
  const useNarrativePricing = createMemo(
    () => lineItems().length === 0 && phases().length > 0 && isNarrativeStyle(),
  );
  // Total + baseSubtotal — branched by pricing_structure. Each
  // structure has its own dollar-math; the wizard's "total" surface
  // (Review card, PDF, save payload) reads from this memo.
  const tmMidEstimate = createMemo(() => {
    const rates = tmRates().filter((r) => r.rate > 0);
    if (rates.length === 0) return 0;
    const avg = rates.reduce((s, r) => s + r.rate, 0) / rates.length;
    const e = tmEstimate();
    const midHours = (e.hours_low + e.hours_high) / 2;
    return round(avg * midHours + (e.materials || 0), 2);
  });
  const baseSubtotal = createMemo(() => {
    switch (pricingStructure()) {
      case 'phase_priced':
        return phasesTotal();
      case 'fixed_price':
        return fixedPriceTotal();
      case 'time_and_materials':
        return tmMidEstimate();
      case 'rebate_program':
        return 0;
      case 'itemized':
      default:
        return useNarrativePricing()
          ? phasesTotal()
          : lineItems().reduce((s, li) => s + li.subtotal, 0);
    }
  });
  const total = createMemo(() => {
    switch (pricingStructure()) {
      case 'phase_priced':
        return phasesTotal();
      case 'fixed_price':
        return fixedPriceTotal();
      case 'time_and_materials':
        return tmMidEstimate();
      case 'rebate_program':
        return 0;
      case 'itemized':
      default:
        return useNarrativePricing()
          ? phasesTotal()
          : round(
              lineItems().reduce((s, li) => {
                const m = li.margin_pct != null ? li.margin_pct : markupPct();
                return s + li.subtotal * (1 + m / 100);
              }, 0),
              2,
            );
    }
  });
  const marginAmount = createMemo(() => round(total() - baseSubtotal(), 2));

  const startScan = async () => {
    setLineItems([]);
    setFlags([]);
    setScopeSummary('');
    setScanProgress(0);
    setScanError(null);
    setScanning(true);
    // Reset proposal classification state for each run.
    setProposalStyle('project_quote');
    setProposalConfidence(1);
    setProgramType(null);
    setTermMonths(null);
    setPhases([]);
    setRebateTerms([]);
    setRfiRequirements([]);
    setRfiQuestions([]);
    setNovelShape(null);
    setNovelShapeSource(null);
    setNovelShapeId(null);
    setNovelMatchDistance(null);
    setNovelAccepted(false);
    setSectionsData([]);
    setProposeShapeError(null);
    // Offer-axis signals reset between scans so the new doc's
    // detection isn't shadowed by the previous one.
    setOfferKind('quote');
    setPricingStructure('itemized');
    setOfferAutoDetected(true);
    setFixedPriceDescription('');
    setFixedPriceTotal(0);
    setTmRates([]);
    setTmEstimate({ hours_low: 0, hours_high: 0, materials: 0 });
    setRfiResponse({
      requirements_answered: [],
      questions_answered: [],
      narrative_sections: [],
      cover_letter: '',
      submission_format: '',
    });
    // 90-second hard cap on the scan. If Workers AI hangs or the
    // network drops mid-stream, the wizard surfaces a friendly error
    // + retry instead of pinning the "Scanning…" state forever.
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 90_000);
    try {
      const resp = await fetch('/api/quote/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: scopeText(),
          client_name: clientName(),
          project_title: projectTitle(),
        }),
        signal: abortCtrl.signal,
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
          else if (payload.type === 'proposal_style') {
            setProposalStyle(payload.payload?.style ?? 'project_quote');
            setProposalConfidence(payload.payload?.confidence ?? 1);
            setProgramType(payload.payload?.program_type ?? null);
            setTermMonths(payload.payload?.term_months ?? null);
            // Offer-axis auto-detection: scan returns the suggested
            // offer_kind + pricing_structure. Operator can override
            // on the Offer step picker.
            if (payload.payload?.offer_kind) {
              setOfferKind(payload.payload.offer_kind as OfferKind);
            }
            if (payload.payload?.pricing_structure) {
              setPricingStructure(payload.payload.pricing_structure as PricingStructure);
            }
            setOfferAutoDetected(true);
          }
          else if (payload.type === 'line_item') setLineItems([...lineItems(), payload.payload]);
          else if (payload.type === 'phase')     setPhases([...phases(), payload.payload]);
          else if (payload.type === 'rebate_term') setRebateTerms([...rebateTerms(), payload.payload]);
          else if (payload.type === 'requirement') setRfiRequirements([...rfiRequirements(), payload.payload?.text ?? '']);
          else if (payload.type === 'question')    setRfiQuestions([...rfiQuestions(), payload.payload?.text ?? '']);
          else if (payload.type === 'flag')      setFlags([...flags(), payload.payload]);
          else if (payload.type === 'done')      setScopeSummary(payload.payload?.scope_summary ?? '');
          else if (payload.type === 'error')     setScanError(payload.message);
        }
      }
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === 'AbortError';
      setScanError(
        aborted
          ? "Scan took too long (over 90 seconds). The model may be overloaded — give it a moment and retry."
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      clearTimeout(timeoutId);
      setScanning(false);
      // After the scan settles, if the classifier says this is an
      // inbound RFI, seed the response shells from the buyer's
      // detected requirements + questions. Operator-edited values are
      // preserved on re-scan because we only seed when shells are empty.
      if (proposalStyle() === 'rfi_received' && rfiResponse().requirements_answered.length === 0) {
        setRfiResponse({
          requirements_answered: rfiRequirements().map((r) => ({ requirement: r, response: '' })),
          questions_answered: rfiQuestions().map((q) => ({ question: q, answer: '' })),
          narrative_sections: [],
          cover_letter: '',
          submission_format: '',
        });
      }

      // Novel-path trigger. Scan returned an unknown style or low
      // confidence — call the shape proposer so the wizard can offer
      // a custom layout instead of forcing the doc into a wrong template.
      const styleUnknown = proposalStyle() === 'unknown';
      const lowConfidence = proposalConfidence() < 0.6;
      if ((styleUnknown || lowConfidence) && !novelShape() && scopeText().trim().length >= 40) {
        void proposeNovelShape();
      }
    }
  };

  const proposeNovelShape = async () => {
    setProposingShape(true);
    setProposeShapeError(null);
    try {
      const resp = await fetch('/api/shape/propose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: scopeText(),
          client_name: clientName(),
          project_title: projectTitle(),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as {
        source: 'matched' | 'proposed';
        shape_id?: string;
        shape: Shape;
        prefilled: Shape;
        match_distance?: number;
      };
      setNovelShape(data.shape);
      setNovelShapeSource(data.source);
      setNovelShapeId(data.shape_id ?? null);
      setNovelMatchDistance(data.match_distance ?? null);
      setSectionsData(data.prefilled.sections);
    } catch (e) {
      setProposeShapeError(e instanceof Error ? e.message : String(e));
    } finally {
      setProposingShape(false);
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
      const narrative = useNarrativePricing();
      const novel = novelShape() != null && novelAccepted();
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
          proposal_style: novel ? 'novel' : proposalStyle(),
          program_type: programType(),
          term_months: termMonths(),
          // Skip line_items entirely when novel — sections_data is
          // the priced/narrative output. Same for narrative
          // (phase-priced) docs.
          line_items: novel || narrative
            ? []
            : lineItems().map((li) => {
                const m = li.margin_pct != null ? li.margin_pct : markupPct();
                const lineTotal = round(li.subtotal * (1 + m / 100), 2);
                return {
                  ...li,
                  unit_price: round(li.unit_price * (1 + m / 100), 2),
                  subtotal: lineTotal,
                };
              }),
          phases: !novel && phases().length > 0 ? phases() : null,
          rebate_terms: !novel && rebateTerms().length > 0 ? rebateTerms() : null,
          // Novel-path output. Server renders sections in order.
          sections_data: novel ? sectionsData() : null,
          shape_name: novel ? novelShape()?.name : null,
          offer_kind: offerKind(),
          pricing_structure: pricingStructure(),
          tm_rates: pricingStructure() === 'time_and_materials' ? tmRates() : null,
          tm_estimate: pricingStructure() === 'time_and_materials' ? tmEstimate() : null,
          fixed_price_description:
            pricingStructure() === 'fixed_price' ? fixedPriceDescription() : null,
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
      const novel = novelShape() != null && novelAccepted();
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
          // line_items: for itemized, the editable rows; for
          // fixed-price, a synthesized single-row payload so the
          // existing line_items table on the DB still has the price
          // (the operator's "what's the engagement" + "total fee").
          line_items: novel
            ? []
            : pricingStructure() === 'fixed_price'
              ? [
                  {
                    position: 1,
                    description: fixedPriceDescription() || projectTitle(),
                    qty: 1,
                    unit: 'lump_sum',
                    unit_price: fixedPriceTotal(),
                    subtotal: fixedPriceTotal(),
                    category: 'services',
                    confidence: 'manual',
                    margin_pct: null,
                  },
                ]
              : pricingStructure() === 'time_and_materials' ||
                  pricingStructure() === 'rebate_program' ||
                  pricingStructure() === 'phase_priced'
                ? []
                : lineItems(),
          proposal_style: novel ? 'novel' : proposalStyle(),
          program_type: programType(),
          term_months: termMonths(),
          phases: !novel && phases().length > 0 ? phases() : null,
          rfi_response: proposalStyle() === 'rfi_received' ? rfiResponse() : null,
          shape_id: novel ? novelShapeId() : null,
          sections_data: novel ? sectionsData() : null,
          // Offer axes — migration 012.
          offer_kind: offerKind(),
          pricing_structure: pricingStructure(),
          tm_rates: pricingStructure() === 'time_and_materials' ? tmRates() : null,
          tm_estimate: pricingStructure() === 'time_and_materials' ? tmEstimate() : null,
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
      const sendBody = (await sendResp.json().catch(() => null)) as
        | { delivery_error?: string | null }
        | null;
      // Brevo soft-fail: quote rows are marked SENT regardless so the
      // operator sees the pipeline state; surface the delivery error
      // on SentStep so they know to chase it.
      setDeliveryWarning(sendBody?.delivery_error ?? null);
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
          proposalStyle={proposalStyle}
          proposalConfidence={proposalConfidence}
          phases={phases}
          setPhases={setPhases}
          rebateTerms={rebateTerms}
          rfiRequirements={rfiRequirements}
          rfiQuestions={rfiQuestions}
          termMonths={termMonths}
          novelShape={novelShape}
          novelShapeSource={novelShapeSource}
          novelMatchDistance={novelMatchDistance}
          proposingShape={proposingShape}
          proposeShapeError={proposeShapeError}
          onUpdateNovelShape={(s) => {
            setNovelShape(s);
            setSectionsData(s.sections);
          }}
          onAcceptNovelShape={() => {
            setNovelAccepted(true);
          }}
          onRetry={startScan}
          onBack={() => setStepIdx(0)}
          onContinue={() => setStepIdx(2)}
        />
      </Show>

      <Show when={stepId() === 'pricing'}>
        <Show
          when={proposalStyle() === 'rfi_received'}
          fallback={
            <Show
              when={novelShape() && novelAccepted()}
              fallback={
            <PricingStep
              shop={props.shop}
              lineItems={lineItems}
              scopeSummary={scopeSummary}
              markupPct={markupPct}
              setMarkupPct={setMarkupPct}
              baseSubtotal={baseSubtotal}
              marginAmount={marginAmount}
              total={total}
              updateLineItem={updateLineItem}
              removeLineItem={removeLineItem}
              addLineItem={addLineItem}
              proposalStyle={proposalStyle}
              phases={phases}
              setPhases={setPhases}
              rebateTerms={rebateTerms}
              narrativePricing={useNarrativePricing}
              offerKind={offerKind}
              setOfferKind={(v) => {
                setOfferKind(v);
                setOfferAutoDetected(false);
              }}
              pricingStructure={pricingStructure}
              setPricingStructure={(v) => {
                setPricingStructure(v);
                setOfferAutoDetected(false);
              }}
              offerAutoDetected={offerAutoDetected}
              fixedPriceDescription={fixedPriceDescription}
              setFixedPriceDescription={setFixedPriceDescription}
              fixedPriceTotal={fixedPriceTotal}
              setFixedPriceTotal={setFixedPriceTotal}
              tmRates={tmRates}
              setTmRates={setTmRates}
              tmEstimate={tmEstimate}
              setTmEstimate={setTmEstimate}
              onBack={() => setStepIdx(1)}
              onContinue={goToReview}
            />
              }
            >
              <NovelComposeStep
                shape={novelShape as () => Shape}
                sections={sectionsData}
                onUpdateSection={(idx, next) => {
                  const ns = sectionsData().slice();
                  ns[idx] = next;
                  setSectionsData(ns);
                }}
                onBack={() => setStepIdx(1)}
                onContinue={goToReview}
              />
            </Show>
          }
        >
          <RfiStep
            requirements={rfiRequirements}
            questions={rfiQuestions}
            response={rfiResponse}
            setResponse={setRfiResponse}
            scopeSummary={scopeSummary}
            clientName={clientName}
            projectTitle={projectTitle}
            onBack={() => setStepIdx(1)}
            onContinue={goToReview}
          />
        </Show>
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
          scopeSummary={scopeSummary}
          clientName={clientName}
          clientContact={clientContact}
          setClientContact={setClientContact}
          clientContactEmail={clientContactEmail}
          setClientContactEmail={setClientContactEmail}
          clientContactPhone={clientContactPhone}
          setClientContactPhone={setClientContactPhone}
          projectTitle={projectTitle}
          projectAddress={projectAddress}
          proposalStyle={proposalStyle}
          phases={phases}
          rebateTerms={rebateTerms}
          termMonths={termMonths}
          novelShape={novelShape}
          novelAccepted={novelAccepted}
          sectionsData={sectionsData}
          shop={props.shop}
          onBack={() => setStepIdx(2)}
          onSend={saveAndSend}
          onRetryRender={() => {
            setSendError(null);
            void renderPdf();
          }}
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
          novelShape={novelShape}
          novelAccepted={novelAccepted}
          novelShapeSource={novelShapeSource}
          sectionsData={sectionsData}
          deliveryWarning={deliveryWarning}
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
  // Returns the human-readable labels of fields that were actually
  // filled so the UI can surface a "Brief filled in X" notice.
  const applyMetadata = (
    m: (IntakeMetadata & { contact_email?: string | null; contact_phone?: string | null }) | null,
  ): string[] => {
    if (!m) return [];
    const filled: string[] = [];
    if (m.client_name && !p.clientName().trim()) {
      p.setClientName(m.client_name);
      filled.push('client');
    }
    if (m.contact_name && !p.clientContact().trim()) {
      p.setClientContact(m.contact_name);
      filled.push('contact name');
    }
    if (m.contact_email && !p.clientContactEmail().trim()) {
      p.setClientContactEmail(m.contact_email);
      filled.push('email');
    }
    if (m.contact_phone && !p.clientContactPhone().trim()) {
      p.setClientContactPhone(m.contact_phone);
      filled.push('phone');
    }
    if (m.project_title && !p.projectTitle().trim()) {
      p.setProjectTitle(m.project_title);
      filled.push('project title');
    }
    if (m.project_address && !p.projectAddress().trim()) {
      p.setProjectAddress(m.project_address);
      filled.push('address');
    }
    if (filled.length > 0) {
      setAutofillNote(filled);
      // Auto-dismiss after 8 seconds so the notice doesn't get stale.
      setTimeout(() => setAutofillNote(null), 8000);
    } else if (m) {
      // Source-uploaded but nothing matched — let the operator know
      // so they don't sit waiting for fields to fill that won't.
      setAutofillNote([]);
      setTimeout(() => setAutofillNote(null), 8000);
    }
    return filled;
  };

  const [autofillNote, setAutofillNote] = createSignal<string[] | null>(null);

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
            placeholder="client@example.com"
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

      <Show when={autofillNote()}>
        {(fields) => (
          <div class="mt-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-accent-tint,#fbe9d4)] px-3.5 py-2.5 flex items-start gap-2.5">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" class="text-[color:var(--color-accent)] mt-0.5 shrink-0" aria-hidden="true">
              <path d="M2.5 7l3 3 6-6.5" />
            </svg>
            <div class="text-[12.5px] leading-snug">
              <Show
                when={fields().length > 0}
                fallback={
                  <span class="text-[color:var(--color-ink-2)]">
                    Brief read the source but couldn't auto-fill — type the client and project below.
                  </span>
                }
              >
                <span class="font-medium">Brief filled in</span>{' '}
                <span class="text-[color:var(--color-ink-2)]">{fields().join(' · ')}</span>
                <span class="text-[color:var(--color-muted)]">. Edit anything that's wrong.</span>
              </Show>
            </div>
          </div>
        )}
      </Show>

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
      const data = (await resp.json()) as {
        text: string;
        page_count: number;
        empty_text: boolean;
        filename: string;
        metadata?: IntakeMetadata | null;
        metadata_debug?: unknown;
      };
      // Always log the metadata envelope so silent failures are
      // visible in DevTools without instrumenting the server. Cheap.
      console.info('[intake/extract-pdf]', {
        text_chars: data.text.length,
        metadata: data.metadata,
        metadata_debug: data.metadata_debug,
      });
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
      const data = (await resp.json().catch(() => null)) as
        | {
            text?: string;
            duration_seconds?: number | null;
            empty_text?: boolean;
            error?: string;
            file_type?: string;
            file_size?: number;
            tried?: Array<{ model: string; ok: boolean; chars: number; error?: string }>;
            metadata?: IntakeMetadata | null;
            metadata_debug?: unknown;
          }
        | null;
      console.info('[intake/transcribe]', {
        text_chars: data?.text?.length ?? 0,
        metadata: data?.metadata,
        metadata_debug: data?.metadata_debug,
      });
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
  proposalStyle: () => 'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'unknown';
  proposalConfidence: () => number;
  phases: () => Phase[];
  setPhases: (p: Phase[]) => void;
  rebateTerms: () => Array<{ product: string; rebate: string; basis: string }>;
  rfiRequirements: () => string[];
  rfiQuestions: () => string[];
  termMonths: () => number | null;
  novelShape: () => Shape | null;
  novelShapeSource: () => 'matched' | 'proposed' | null;
  novelMatchDistance: () => number | null;
  proposingShape: () => boolean;
  proposeShapeError: () => string | null;
  onUpdateNovelShape: (s: Shape) => void;
  onAcceptNovelShape: () => void;
  onRetry: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const styleLabel = () => {
    switch (p.proposalStyle()) {
      case 'partnership':
        return 'Partnership pitch';
      case 'consulting':
        return 'Consulting proposal';
      case 'rfi_received':
        return 'Inbound RFI';
      case 'unknown':
        return 'Unknown style';
      default:
        return 'Project quote';
    }
  };
  const isNarrative = () =>
    p.proposalStyle() === 'consulting' || p.proposalStyle() === 'partnership';

  const updatePhase = (idx: number, patch: Partial<Phase>) => {
    const next = p.phases().slice();
    next[idx] = { ...next[idx], ...patch };
    p.setPhases(next);
  };
  const addPhase = () => {
    p.setPhases([...p.phases(), { name: '', deliverables: [], duration: null }]);
  };
  const removePhase = (idx: number) => {
    p.setPhases(p.phases().filter((_, i) => i !== idx));
  };

  return (
    <div>
      {/* Header — eyebrow + serif H1 + big % readout right-aligned
          (matches design/mockups/01-agenda-default.png). */}
      <div class="flex items-start gap-6">
        <div class="flex-1 min-w-0">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] flex items-center gap-2">
            <span>Brief is reading the scope</span>
            <Show when={!p.scanning() && p.proposalStyle() !== 'project_quote'}>
              <span class="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm bg-[color:var(--color-accent-tint,#fbe9d4)] text-[color:var(--color-accent,#a85432)] text-[10.5px] font-medium uppercase">
                Detected: {styleLabel()}
              </span>
            </Show>
          </div>
          <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight tracking-tight">
            {p.proposalStyle() === 'consulting'
              ? 'Mapping out the phases.'
              : p.proposalStyle() === 'partnership'
                ? 'Pulling the rebate terms.'
                : p.proposalStyle() === 'rfi_received'
                  ? 'Reading what they’re asking for.'
                  : 'Picking out the line items.'}
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
        <ScanTaskList
          progress={p.progress}
          proposalStyle={p.proposalStyle}
          phaseCount={() => p.phases().length}
          rebateCount={() => p.rebateTerms().length}
          requirementCount={() => p.rfiRequirements().length}
          lineItemCount={() => p.lineItems().length}
        />
      </Show>

      <Show when={!p.scanning() && p.proposalStyle() === 'rfi_received'}>
        <div class="mt-6">
          <RfiNotice
            confidence={p.proposalConfidence}
            requirements={p.rfiRequirements}
            questions={p.rfiQuestions}
            onBack={p.onBack}
          />
        </div>
      </Show>

      {/* Novel-path confirmation. Appears when scan style is
          'unknown' or confidence < 0.6 and the shape proposer has
          returned a layout. One click → accept; opens FreeformEditor
          on the Pricing step. */}
      <Show when={!p.scanning() && p.proposingShape()}>
        <div class="mt-6 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] px-4 py-3 text-[13px] italic font-serif text-[color:var(--color-muted)]">
          Reading the doc shape…
        </div>
      </Show>
      <Show when={!p.scanning() && p.novelShape()}>
        <div class="mt-6">
          <NovelShapeConfirmCard
            shape={p.novelShape as () => Shape}
            source={p.novelShapeSource as () => 'matched' | 'proposed'}
            matchDistance={p.novelMatchDistance}
            onUpdateShape={p.onUpdateNovelShape}
            onAccept={() => {
              p.onAcceptNovelShape();
              p.onContinue();
            }}
          />
        </div>
      </Show>
      <Show when={!p.scanning() && p.proposeShapeError()}>
        <div class="mt-3 rounded-lg bg-[color:var(--color-danger-tint)] px-4 py-3 text-sm text-[color:var(--color-danger)]">
          Shape proposer failed: {p.proposeShapeError()}
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

      <Show when={!p.scanning() && (isNarrative() || p.phases().length > 0)}>
        <div class="mt-6">
          <PhasesEditor
            phases={p.phases}
            onUpdate={updatePhase}
            onAdd={addPhase}
            onRemove={removePhase}
          />
        </div>
      </Show>

      <Show when={!p.scanning() && p.proposalStyle() === 'partnership' && p.rebateTerms().length > 0}>
        <div class="mt-6 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
          <div class="px-4 py-3 border-b border-[color:var(--color-line)] flex justify-between items-baseline">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
              Rebate terms
            </div>
            <Show when={p.termMonths()}>
              <span class="text-[11px] font-mono text-[color:var(--color-muted-2)]">
                {p.termMonths()} month term
              </span>
            </Show>
          </div>
          <ul class="divide-y divide-[color:var(--color-line)]">
            <For each={p.rebateTerms()}>
              {(rt) => (
                <li class="px-4 py-3 grid grid-cols-[1fr_120px_1fr] gap-3 text-sm">
                  <div class="font-medium">{rt.product}</div>
                  <div class="font-mono tabular-nums text-right">{rt.rebate}</div>
                  <div class="text-[color:var(--color-muted)] text-[12.5px]">{rt.basis}</div>
                </li>
              )}
            </For>
          </ul>
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
            still let the operator advance — Pricing step (or the
            phases editor) can recover from a thin extract. */}
        <Button variant="accent" disabled={p.scanning()} onClick={p.onContinue}>
          {p.scanning()
            ? 'Scanning…'
            : p.lineItems().length === 0 && p.phases().length === 0
              ? 'Continue (add detail manually) →'
              : isNarrative()
                ? 'Continue to pricing →'
                : 'Continue to pricing →'}
        </Button>
      </div>
    </div>
  );
}

function PricingStep(p: {
  shop: ShopContext;
  lineItems: () => LineItem[];
  scopeSummary: () => string;
  markupPct: () => number;
  setMarkupPct: (v: number) => void;
  baseSubtotal: () => number;
  marginAmount: () => number;
  total: () => number;
  updateLineItem: (idx: number, patch: Partial<LineItem>) => void;
  removeLineItem: (idx: number) => void;
  addLineItem: () => void;
  proposalStyle: () => 'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'unknown';
  phases: () => Phase[];
  setPhases: (p: Phase[]) => void;
  rebateTerms: () => Array<{ product: string; rebate: string; basis: string }>;
  narrativePricing: () => boolean;
  offerKind: () => OfferKind;
  setOfferKind: (v: OfferKind) => void;
  pricingStructure: () => PricingStructure;
  setPricingStructure: (v: PricingStructure) => void;
  offerAutoDetected: () => boolean;
  fixedPriceDescription: () => string;
  setFixedPriceDescription: (v: string) => void;
  fixedPriceTotal: () => number;
  setFixedPriceTotal: (v: number) => void;
  tmRates: () => TmRate[];
  setTmRates: (v: TmRate[]) => void;
  tmEstimate: () => TmEstimate;
  setTmEstimate: (v: TmEstimate) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const updatePhase = (idx: number, patch: Partial<Phase>) => {
    const next = p.phases().slice();
    next[idx] = { ...next[idx], ...patch };
    p.setPhases(next);
  };

  const isPartnership = () => p.proposalStyle() === 'partnership';
  const isRebateOnly = () =>
    isPartnership() && p.rebateTerms().length > 0 && p.phases().length === 0;

  const offerTitle = () => {
    switch (p.pricingStructure()) {
      case 'rebate_program':
        return 'Rebate terms read; no price needed.';
      case 'phase_priced':
        return 'Price each phase.';
      case 'fixed_price':
        return 'Set the fixed price.';
      case 'time_and_materials':
        return 'Set the rates + estimate.';
      default:
        return 'Confirm the numbers.';
    }
  };

  return (
    <div>
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
        Step 3 · Offer
      </div>
      <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight">
        {offerTitle()}
      </h1>

      <div class="mt-5">
        <OfferKindPicker
          offerKind={p.offerKind}
          setOfferKind={p.setOfferKind}
          pricingStructure={p.pricingStructure}
          setPricingStructure={p.setPricingStructure}
          autoDetected={p.offerAutoDetected}
        />
      </div>

      <Show when={p.pricingStructure() === 'rebate_program'}>
        <div class="mt-5 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-paper-2,#f6f4ef)] p-5">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-2">
            Rebate program — {p.rebateTerms().length} term{p.rebateTerms().length === 1 ? '' : 's'}
          </div>
          <p class="text-[13px] text-[color:var(--color-ink-2)] leading-relaxed">
            The operator's deliverable is the program structure (rebate
            rates, training, transition plan), not a project total. You
            can continue without entering a price; the rebate terms render
            on the PDF.
          </p>
          <ul class="mt-3 divide-y divide-[color:var(--color-line)] text-sm">
            <For each={p.rebateTerms()}>
              {(rt) => (
                <li class="py-2 grid grid-cols-[1fr_120px_1fr] gap-3 items-baseline">
                  <span class="font-medium">{rt.product}</span>
                  <span class="font-mono tabular-nums text-right">{rt.rebate}</span>
                  <span class="text-[color:var(--color-muted)] text-[12.5px]">{rt.basis}</span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={p.pricingStructure() === 'fixed_price'}>
        <div class="mt-5">
          <FixedPriceEditor
            description={p.fixedPriceDescription}
            setDescription={p.setFixedPriceDescription}
            total={p.fixedPriceTotal}
            setTotal={p.setFixedPriceTotal}
          />
        </div>
      </Show>

      <Show when={p.pricingStructure() === 'time_and_materials'}>
        <div class="mt-5">
          <TimeAndMaterialsEditor
            rates={p.tmRates}
            setRates={p.setTmRates}
            estimate={p.tmEstimate}
            setEstimate={p.setTmEstimate}
          />
        </div>
      </Show>

      <Show
        when={p.pricingStructure() === 'phase_priced'}
        fallback={<Show when={p.pricingStructure() === 'itemized'}>{(() => (
      <div class="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
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

        <div class="space-y-4">
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

        <OfferPanel
          scopeSummary={p.scopeSummary}
          lineItems={() =>
            p.lineItems().map((li) => ({
              description: li.description,
              qty: li.qty,
              unit: li.unit ?? 'lump_sum',
            }))
          }
          currentBaseSubtotal={p.baseSubtotal}
          onApplyMargin={(pct) => p.setMarkupPct(pct)}
        />
        </div>
      </div>
        ))()}</Show>
        }
      >
        <div class="mt-6">
          <PhasePricingEditor
            phases={p.phases}
            onUpdate={updatePhase}
            total={p.total}
          />
          <p class="mt-3 text-[12.5px] font-serif italic text-[color:var(--color-muted)] leading-relaxed">
            Phase fees are fixed-price — no margin slider. Add or rename
            phases on the Scope step.
          </p>
        </div>
      </Show>

      <div class="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={p.onBack}>← Back</Button>
        <Button
          variant="accent"
          disabled={!canContinueFromPricing(p)}
          onClick={p.onContinue}
        >
          Continue to review →
        </Button>
      </div>
    </div>
  );
}

/**
 * Offer Continue gate. Keyed to pricing_structure now, not proposal_style.
 *   itemized            → ≥1 line item
 *   phase_priced        → ≥1 phase with a fee (total > 0)
 *   fixed_price         → description + total > 0
 *   time_and_materials  → ≥1 rate + estimated hours > 0
 *   rebate_program      → ≥1 rebate term  (total $0 is fine — operator
 *                         is proposing structure, not invoicing)
 */
function canContinueFromPricing(p: {
  proposalStyle: () => 'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'unknown';
  pricingStructure: () => PricingStructure;
  lineItems: () => LineItem[];
  phases: () => Phase[];
  rebateTerms: () => Array<{ product: string; rebate: string; basis: string }>;
  total: () => number;
  fixedPriceDescription: () => string;
  fixedPriceTotal: () => number;
  tmRates: () => TmRate[];
  tmEstimate: () => TmEstimate;
}): boolean {
  switch (p.pricingStructure()) {
    case 'itemized':
      return p.lineItems().length > 0;
    case 'phase_priced':
      return p.phases().length > 0 && p.total() > 0;
    case 'fixed_price':
      return p.fixedPriceDescription().trim().length > 0 && p.fixedPriceTotal() > 0;
    case 'time_and_materials':
      return (
        p.tmRates().filter((r) => r.rate > 0).length > 0 &&
        p.tmEstimate().hours_high > 0
      );
    case 'rebate_program':
      return p.rebateTerms().length > 0;
    default:
      return false;
  }
}

function RfiStep(p: {
  requirements: () => string[];
  questions: () => string[];
  response: () => RfiResponseShape;
  setResponse: (next: RfiResponseShape) => void;
  scopeSummary: () => string;
  clientName: () => string;
  projectTitle: () => string;
  onBack: () => void;
  onContinue: () => void;
}) {
  // Asks Composition for a voice-matched body for one narrative
  // section. Inline mode — no quote_id needed, runs against Context.
  const draftSection = async (heading: string, prompt: string): Promise<string> => {
    const r = await fetch('/api/composition/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'rfi_section',
        scope_summary:
          (p.scopeSummary() || '') +
          (heading ? `\nSection: ${heading}` : '') +
          (prompt ? `\nOperator notes: ${prompt}` : ''),
        client_name: p.clientName(),
        project_title: p.projectTitle(),
        classification: 'rfi_received',
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    const json = (await r.json()) as { text?: string };
    return json.text ?? '';
  };

  const answeredCount = () =>
    p.response().requirements_answered.filter((r) => r.response.trim()).length +
    p.response().questions_answered.filter((q) => q.answer.trim()).length +
    (p.response().cover_letter.trim() ? 1 : 0);
  const totalToAnswer = () =>
    p.response().requirements_answered.length +
    p.response().questions_answered.length +
    1;
  const ready = () => answeredCount() >= Math.max(2, Math.ceil(totalToAnswer() / 2));

  return (
    <div>
      <div class="flex items-start gap-6">
        <div class="flex-1 min-w-0">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Step 3 · Response
          </div>
          <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight">
            Answer the buyer.
          </h1>
        </div>
        <div class="text-right">
          <div class="font-serif text-[28px] tabular-nums leading-none">
            {answeredCount()}<span class="text-[14px] text-[color:var(--color-muted)]">/{totalToAnswer()}</span>
          </div>
          <div class="text-[11px] font-mono uppercase text-[color:var(--color-muted-2)] mt-0.5">
            sections drafted
          </div>
        </div>
      </div>

      <div class="mt-6">
        <RfiResponseEditor
          requirements={p.requirements}
          questions={p.questions}
          response={p.response}
          setResponse={p.setResponse}
          draftSection={draftSection}
        />
      </div>

      <div class="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={p.onBack}>← Back</Button>
        <Button variant="accent" disabled={!ready()} onClick={p.onContinue}>
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
  scopeSummary: () => string;
  clientName: () => string;
  clientContact: () => string;
  setClientContact: (v: string) => void;
  clientContactEmail: () => string;
  setClientContactEmail: (v: string) => void;
  clientContactPhone: () => string;
  setClientContactPhone: (v: string) => void;
  projectTitle: () => string;
  projectAddress: () => string;
  proposalStyle: () => 'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'unknown';
  phases: () => Phase[];
  rebateTerms: () => Array<{ product: string; rebate: string; basis: string }>;
  termMonths: () => number | null;
  novelShape: () => Shape | null;
  novelAccepted: () => boolean;
  sectionsData: () => Section[];
  shop: ShopContext;
  onBack: () => void;
  onSend: () => void;
  onRetryRender?: () => void;
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

  // Sending-to panel edit/view toggle. Stable local state — must NOT
  // be derived from the live signal value, or typing the first
  // character into the email field flips the panel and unmounts the
  // input mid-keystroke (Solid's reactive Show evaluating on every
  // signal change). Initial mode is decided at mount, then only
  // changes via explicit user action (Done / Edit buttons).
  const [editingContact, setEditingContact] = createSignal(
    !p.clientContactEmail().trim(),
  );
  const emailLooksValid = () => {
    const e = p.clientContactEmail().trim();
    return e.length > 3 && e.includes('@') && e.includes('.');
  };

  // Style-aware view flags. Hide markup math + relax "needs line
  // items" for partnership/consulting/novel where total may be 0 or
  // structured as phases / rebates / freeform sections.
  const isPartnership = () => p.proposalStyle() === 'partnership';
  const isConsulting = () => p.proposalStyle() === 'consulting';
  const isNovel = () => p.novelShape() != null && p.novelAccepted();
  const isNarrative = () => isPartnership() || isConsulting() || isNovel();
  const hidesMarkup = () => isNarrative();

  // Pre-send readiness checks — each row gets a green check or a soft warning.
  const checks = createMemo(() => {
    const items = p.lineItems();
    const rebates = p.rebateTerms();
    const phaseCount = p.phases().length;
    const pricedPhaseCount = p.phases().filter((ph) => Number(ph.fee) > 0).length;

    // The "what's on the proposal" row adapts by style.
    let contentCheck: { ok: boolean; label: string; sub?: string };
    if (isNovel()) {
      const sections = p.sectionsData();
      const populated = sections.filter((s) => {
        if (s.kind === 'text') return s.body.trim().length > 0;
        if (s.kind === 'bullets') return s.items.length > 0;
        if (s.kind === 'kv_table') return s.rows.length > 0;
        return false;
      }).length;
      contentCheck = {
        ok: populated > 0,
        label: `${populated} of ${sections.length} section${sections.length === 1 ? '' : 's'} filled`,
        sub:
          populated === 0
            ? 'Compose step has no content — go back and fill at least one section.'
            : undefined,
      };
    } else if (isPartnership() && rebates.length > 0) {
      contentCheck = {
        ok: true,
        label: `${rebates.length} rebate term${rebates.length === 1 ? '' : 's'}${phaseCount > 0 ? ` · ${phaseCount} phase${phaseCount === 1 ? '' : 's'}` : ''}`,
      };
    } else if (isConsulting() || (isPartnership() && phaseCount > 0)) {
      contentCheck = {
        ok: pricedPhaseCount > 0,
        label: `${pricedPhaseCount} of ${phaseCount} phase${phaseCount === 1 ? '' : 's'} priced`,
        sub:
          pricedPhaseCount === 0
            ? 'Add a fee to at least one phase on the Pricing step.'
            : undefined,
      };
    } else {
      contentCheck = {
        ok: items.length > 0,
        label: `${items.length} line item${items.length === 1 ? '' : 's'} priced`,
        sub:
          items.length === 0
            ? 'Pricing step is empty — go back and add at least one line.'
            : undefined,
      };
    }

    const rows: Array<{ ok: boolean; label: string; sub?: string }> = [contentCheck];

    // Markup row — only meaningful for project_quote with line items.
    if (!hidesMarkup()) {
      rows.push({
        ok: p.markupPct() >= 20,
        label: `${p.markupPct().toFixed(0)}% markup applied`,
        sub:
          p.markupPct() < 20
            ? 'Below your typical floor; double-check this is intentional.'
            : undefined,
      });
    }

    rows.push(
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
    );
    return rows;
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
          {/* Empty + not rendering + has error → preview failed. The
              iframe never showed; surface the issue + a retry inline
              so the operator isn't staring at a blank page. */}
          <Show when={!p.rendering() && !p.pdfUrl() && p.error()}>
            <div class="aspect-[8.5/11] flex flex-col items-center justify-center gap-3 px-8 text-center">
              <div class="text-[15px] font-medium text-[color:var(--color-warn,#a85432)]">
                Preview couldn't render.
              </div>
              <p class="text-[13px] text-[color:var(--color-muted)] font-serif leading-relaxed max-w-[40ch]">
                Something went wrong producing the PDF. The quote itself is
                fine — you can still save + send, or retry the preview.
              </p>
              <Show when={p.onRetryRender}>
                <button
                  type="button"
                  onClick={() => p.onRetryRender!()}
                  class="mt-1 font-mono text-[11.5px] uppercase tracking-wide border border-[color:var(--color-line-2)] bg-white px-3 py-1.5 rounded-sm"
                >
                  Retry preview
                </button>
              </Show>
            </div>
          </Show>
        </div>

        <aside class="space-y-4">
          {/* Sending to — answers "where is this quote going?" */}
          <div
            class={[
              'rounded-xl border p-5',
              editingContact() && !p.clientContactEmail().trim()
                ? 'border-[color:var(--color-warn)] bg-[color:var(--color-warn-tint)]'
                : 'border-[color:var(--color-line)] bg-[color:var(--color-surface)]',
            ].join(' ')}
          >
            <div class="flex items-baseline justify-between mb-2">
              <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
                Sending to
              </div>
              <Show when={!editingContact()}>
                <button
                  type="button"
                  onClick={() => setEditingContact(true)}
                  class="text-[11px] font-mono uppercase tracking-wide text-[color:var(--color-muted-2)] hover:text-[color:var(--color-ink)]"
                >
                  Edit
                </button>
              </Show>
            </div>
            <Show
              when={!editingContact()}
              fallback={
                <div>
                  <Show when={!p.clientContactEmail().trim()}>
                    <p class="text-[14px] font-medium text-[color:var(--color-warn)] leading-snug">
                      No email on file.
                    </p>
                    <p class="mt-1.5 text-[12.5px] font-serif text-[color:var(--color-ink-2)] leading-relaxed">
                      Add one here and Brief will deliver the quote. Leave blank
                      to save without sending.
                    </p>
                  </Show>
                  <div class="mt-3 space-y-2">
                    <Field label="Contact email">
                      <Input
                        type="email"
                        value={p.clientContactEmail()}
                        onInput={(e) => p.setClientContactEmail(e.currentTarget.value)}
                        placeholder="client@example.com"
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
                  <div class="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setEditingContact(false)}
                      disabled={!p.clientContactEmail().trim() ? false : !emailLooksValid()}
                      class="font-mono text-[11px] uppercase tracking-wide border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-surface)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-sm"
                    >
                      {p.clientContactEmail().trim() ? 'Done' : 'Skip — save without sending'}
                    </button>
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

          {/* Final price card. Partnership pitches with rebate-only
              structure don't carry a quantifiable total — show the
              program shape instead of "$0.00", and skip the markup row. */}
          <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
              {isPartnership() && p.total() === 0
                ? 'Program'
                : isNovel() && p.total() === 0
                  ? 'Layout'
                  : 'Final price'}
            </div>
            <Show
              when={isPartnership() && p.total() === 0}
              fallback={
                <Show
                  when={isNovel() && p.total() === 0}
                  fallback={
                    <div class="mt-1 font-serif text-[32px] font-medium tabular-nums leading-none">
                      {fmt(p.total())}
                    </div>
                  }
                >
                  <div class="mt-1 font-serif text-[22px] font-medium leading-snug">
                    {p.novelShape()?.name ?? 'Custom layout'}
                  </div>
                  <div class="text-[12.5px] text-[color:var(--color-muted)] mt-1">
                    {p.sectionsData().length} section
                    {p.sectionsData().length === 1 ? '' : 's'}
                  </div>
                </Show>
              }
            >
              <div class="mt-1 font-serif text-[22px] font-medium leading-snug">
                Rebate program
              </div>
              <div class="text-[12.5px] text-[color:var(--color-muted)] mt-1">
                {p.rebateTerms().length} term{p.rebateTerms().length === 1 ? '' : 's'}
                {p.termMonths() ? ` · ${p.termMonths()} mo` : ''}
              </div>
            </Show>
            <div class="mt-2 text-[12.5px] text-[color:var(--color-muted)]">
              to <span class="font-medium text-[color:var(--color-ink)]">{recipient()}</span>
            </div>
            <Show
              when={
                !((isPartnership() && p.total() === 0) || (isNovel() && p.total() === 0))
              }
            >
              <dl class="mt-4 space-y-1.5 text-[13px] border-t border-[color:var(--color-line)] pt-3">
                <div class="flex justify-between">
                  <dt class="text-[color:var(--color-muted)]">
                    {isNarrative() ? 'Phase fees subtotal' : 'Line items subtotal'}
                  </dt>
                  <dd class="font-mono tabular-nums">{fmt(p.baseSubtotal())}</dd>
                </div>
                <Show when={!hidesMarkup()}>
                  <div class="flex justify-between">
                    <dt class="text-[color:var(--color-muted)]">Markup ({p.markupPct().toFixed(0)}%)</dt>
                    <dd class="font-mono tabular-nums">{fmt(p.marginAmount())}</dd>
                  </div>
                </Show>
                <div class="flex justify-between font-medium pt-1.5 border-t border-[color:var(--color-line)]">
                  <dt>Total</dt>
                  <dd class="font-mono tabular-nums">{fmt(p.total())}</dd>
                </div>
              </dl>
            </Show>
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

          <CoverNotePanel
            scopeSummary={p.scopeSummary}
            clientName={p.clientName}
            contactName={p.clientContact}
            projectTitle={p.projectTitle}
            total={p.total}
          />

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

/**
 * 5th-path equivalent of PricingStep — replaces the line-items
 * table for docs that don't fit a fast-path shape. Renders the
 * FreeformEditor on the operator-accepted shape; Continue is gated
 * on at least one populated section so empty proposals don't fly
 * through.
 */
function NovelComposeStep(p: {
  shape: () => Shape;
  sections: () => Section[];
  onUpdateSection: (idx: number, next: Section) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const populated = () => countPopulated(p.sections());
  const ready = () => populated() >= 1;

  return (
    <div>
      <div class="flex items-start gap-6">
        <div class="flex-1 min-w-0">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Step 3 · Compose
          </div>
          <h1 class="mt-1 font-serif text-[32px] font-medium leading-tight">
            Read through, edit anything.
          </h1>
          <p class="mt-1.5 text-[13.5px] font-serif italic text-[color:var(--color-muted)] leading-relaxed">
            Brief pre-filled each section from the source. Edit inline —
            no rigid template, just the structure you confirmed.
          </p>
        </div>
        <div class="text-right">
          <div class="font-serif text-[28px] tabular-nums leading-none">
            {populated()}
            <span class="text-[14px] text-[color:var(--color-muted)]">/{p.sections().length}</span>
          </div>
          <div class="text-[11px] font-mono uppercase text-[color:var(--color-muted-2)] mt-0.5">
            sections filled
          </div>
        </div>
      </div>

      <div class="mt-6">
        <FreeformEditor sections={p.sections} onUpdate={p.onUpdateSection} />
      </div>

      <div class="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={p.onBack}>← Back</Button>
        <Button variant="accent" disabled={!ready()} onClick={p.onContinue}>
          Continue to review →
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
  novelShape: () => Shape | null;
  novelAccepted: () => boolean;
  novelShapeSource: () => 'matched' | 'proposed' | null;
  sectionsData: () => Section[];
  deliveryWarning: () => string | null;
  onNewQuote: () => void;
}) {
  // Offer to save the proposed layout to the shop's library so the
  // next similar doc auto-matches. Only fires when the shape was
  // freshly proposed (not already a matched library shape).
  const canSaveShape = () =>
    p.novelShape() != null &&
    p.novelAccepted() &&
    p.novelShapeSource() === 'proposed';
  const [savingShape, setSavingShape] = createSignal(false);
  const [savedShape, setSavedShape] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const saveShape = async () => {
    const shape = p.novelShape();
    if (!shape) return;
    setSavingShape(true);
    setSaveError(null);
    try {
      const resp = await fetch('/api/shape/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: shape.name,
          description: shape.description,
          sections: p.sectionsData(),
          total_required: shape.total_required,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setSavedShape(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingShape(false);
    }
  };
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
        <h1 class="mt-1 font-serif text-[40px] font-medium leading-tight">
          {p.deliveryWarning() ? 'Saved — but not delivered.' : 'Off it goes.'}
        </h1>
        <p class="mt-3 text-[15px] font-serif italic text-[color:var(--color-muted)] max-w-[42ch] mx-auto leading-relaxed">
          {p.deliveryWarning()
            ? `${p.quoteRef()} is saved as sent in your pipeline, but the email didn't actually leave.`
            : `${p.quoteRef()} is in ${recipient()}'s inbox. Brief will tell you when it's read.`}
        </p>
      </div>

      <Show when={p.deliveryWarning()}>
        <div class="mt-6 rounded-xl border border-[color:var(--color-warn,#a85432)] bg-[color:var(--color-warn-tint,#fcefe6)] p-5">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-warn,#a85432)]">
            Delivery issue
          </div>
          <p class="mt-1.5 text-[13.5px] font-serif text-[color:var(--color-ink-2)] leading-relaxed">
            {p.deliveryWarning()}
          </p>
          <p class="mt-2 text-[12.5px] text-[color:var(--color-muted)] leading-relaxed">
            Send a manual reply from your email client, or go back and re-send
            after fixing the recipient. The quote stays in the SENT state either
            way — Brief won't double-send if you try again.
          </p>
          <Show when={p.quoteId()}>
            <a
              href={`/quotes/${p.quoteId()}`}
              class="mt-3 inline-block font-mono text-[11.5px] uppercase tracking-wide text-[color:var(--color-warn,#a85432)] hover:text-[color:var(--color-ink)]"
            >
              Open the quote →
            </a>
          </Show>
        </div>
      </Show>

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

      <Show when={canSaveShape()}>
        <div class="mt-6 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-paper-2,#f6f4ef)] p-5 max-w-[640px]">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Save this layout
          </div>
          <p class="mt-1.5 text-[13.5px] font-serif text-[color:var(--color-ink-2)] leading-relaxed">
            Brief composed this proposal as <strong class="font-medium">"{p.novelShape()?.name}"</strong>.
            Save it to your library and the next similar doc auto-routes here —
            no shape proposal step required.
          </p>
          <Show
            when={!savedShape()}
            fallback={
              <p class="mt-3 text-[12.5px] font-mono text-[color:var(--color-good,#3a7048)]">
                ✓ Saved. Similar docs will use this layout next time.
              </p>
            }
          >
            <div class="mt-3 flex gap-2">
              <button
                type="button"
                onClick={saveShape}
                disabled={savingShape()}
                class="font-mono text-[12px] uppercase tracking-wide border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-surface)] disabled:opacity-50 px-3 py-1.5 rounded-sm"
              >
                {savingShape() ? 'Saving…' : 'Save layout'}
              </button>
              <button
                type="button"
                onClick={() => setSavedShape(true)}
                class="font-mono text-[12px] uppercase tracking-wide text-[color:var(--color-muted-2)] hover:text-[color:var(--color-ink)] px-3 py-1.5"
              >
                No thanks
              </button>
            </div>
            <Show when={saveError()}>
              <p class="mt-2 text-[12px] text-[color:var(--color-danger)]">{saveError()}</p>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

/**
 * <ScanTaskList> — narrative of what Brief is doing while the SSE
 * stream parses the doc. Tasks advance based on `progress` thresholds
 * (which the scan endpoint emits as `{type:"progress",percent}`).
 *
 * Task labels adapt to the doc type once the classifier fires its
 * `proposal_style` event (usually around 50% progress). Before that
 * we show generic copy so contractor-coded labels don't appear on
 * non-construction docs.
 *
 * The active task gets a spinner + italic "reading..."; completed
 * tasks get a green check; future tasks fade to 40% opacity.
 */
type ScanStyle = 'project_quote' | 'partnership' | 'consulting' | 'rfi_received' | 'unknown';

interface ScanTask {
  at: number;
  label: string;
  /** Optional counter key — when this task lands, surface "X so far"
   * on the right. Maps to one of the count props. */
  counter?: 'line_item' | 'phase' | 'rebate' | 'requirement';
}

const SCAN_TASKS: Record<ScanStyle, ScanTask[]> = {
  project_quote: [
    { at: 0,  label: 'Reading the scope' },
    { at: 18, label: 'Identifying project type' },
    { at: 38, label: 'Pulling matching past jobs' },
    { at: 58, label: 'Estimating quantities' },
    { at: 78, label: 'Composing line items + crew estimate', counter: 'line_item' },
    { at: 92, label: 'Cross-checking against your typical margins' },
  ],
  partnership: [
    { at: 0,  label: 'Reading the proposal' },
    { at: 18, label: 'Recognizing this as a partnership pitch' },
    { at: 38, label: 'Pulling rebate terms + program structure' },
    { at: 58, label: 'Outlining the transition plan' },
    { at: 78, label: 'Composing the program summary', counter: 'rebate' },
    { at: 92, label: 'Cross-checking against past partnerships' },
  ],
  consulting: [
    { at: 0,  label: 'Reading the proposal' },
    { at: 18, label: 'Recognizing this as a consulting engagement' },
    { at: 38, label: 'Pulling matching past engagements' },
    { at: 58, label: 'Outlining phases + deliverables' },
    { at: 78, label: 'Composing the phase plan', counter: 'phase' },
    { at: 92, label: 'Cross-checking against your typical fee structure' },
  ],
  rfi_received: [
    { at: 0,  label: 'Reading the request' },
    { at: 18, label: 'Recognizing this as an inbound RFI' },
    { at: 38, label: 'Extracting requirements + vendor questions' },
    { at: 58, label: 'Noting submission format + deadline' },
    { at: 78, label: 'Drafting response section placeholders', counter: 'requirement' },
    { at: 92, label: 'Cross-checking against your past responses' },
  ],
  unknown: [
    { at: 0,  label: 'Reading the document' },
    { at: 18, label: 'Classifying the proposal type' },
    { at: 38, label: 'Pulling related past work' },
    { at: 58, label: 'Extracting the key structure' },
    { at: 78, label: 'Composing the editable draft' },
    { at: 92, label: 'Cross-checking against your defaults' },
  ],
};

function ScanTaskList(p: {
  progress: () => number;
  proposalStyle: () => ScanStyle;
  lineItemCount: () => number;
  phaseCount: () => number;
  rebateCount: () => number;
  requirementCount: () => number;
}) {
  // Lock the task set the first time we know the style. Switching
  // mid-scan would re-animate the completed tasks, which looks janky.
  const [locked, setLocked] = createSignal<ScanStyle | null>(null);
  const activeStyle = (): ScanStyle => {
    const s = p.proposalStyle();
    if (locked()) return locked()!;
    if (s !== 'unknown') {
      setLocked(s);
      return s;
    }
    // Until the classifier fires, use the generic ('unknown') copy.
    return 'unknown';
  };
  const tasks = () => SCAN_TASKS[activeStyle()];

  const counterFor = (key: ScanTask['counter']): number | null => {
    if (key === 'line_item') return p.lineItemCount();
    if (key === 'phase') return p.phaseCount();
    if (key === 'rebate') return p.rebateCount();
    if (key === 'requirement') return p.requirementCount();
    return null;
  };

  return (
    <div class="mt-6 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] px-5 py-4">
      <ul class="space-y-2.5">
        <For each={tasks()}>
          {(t, i) => {
            const next = tasks()[i() + 1];
            const done = () => p.progress() >= (next ? next.at : 100);
            const active = () => !done() && p.progress() >= t.at;
            const future = () => p.progress() < t.at;
            const count = () => (done() && t.counter ? counterFor(t.counter) : null);
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
                <Show when={count() != null && count()! > 0}>
                  <span class="text-[11px] font-mono tabular-nums text-[color:var(--color-muted)]">
                    {count()} so far
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
