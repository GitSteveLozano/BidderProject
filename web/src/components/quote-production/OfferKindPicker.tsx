/**
 * <OfferKindPicker> — small dropdown row at the top of the Offer
 * step. Operator confirms / overrides what scan auto-detected.
 *
 * Two selects: offer_kind (Quote / Bid / Proposal / Contract) +
 * pricing_structure (the five structures). Sits inline above the
 * editor body — kept compact so it doesn't dominate the page.
 */
import { For } from 'solid-js';

export type OfferKind = 'quote' | 'bid' | 'proposal' | 'contract';
export type PricingStructure =
  | 'fixed_price'
  | 'itemized'
  | 'phase_priced'
  | 'time_and_materials'
  | 'rebate_program';

const OFFER_KINDS: Array<{ value: OfferKind; label: string }> = [
  { value: 'quote', label: 'Quote' },
  { value: 'bid', label: 'Bid' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'contract', label: 'Contract' },
];

const PRICING_STRUCTURES: Array<{ value: PricingStructure; label: string }> = [
  { value: 'fixed_price', label: 'Fixed price' },
  { value: 'itemized', label: 'Itemized' },
  { value: 'phase_priced', label: 'Phase-priced' },
  { value: 'time_and_materials', label: 'Time & materials' },
  { value: 'rebate_program', label: 'Rebate program' },
];

interface Props {
  offerKind: () => OfferKind;
  setOfferKind: (v: OfferKind) => void;
  pricingStructure: () => PricingStructure;
  setPricingStructure: (v: PricingStructure) => void;
  /** Whether Brief auto-detected these values from intake. Drives the
   * "Brief detected" prefix on the label. */
  autoDetected: () => boolean;
}

export default function OfferKindPicker(p: Props) {
  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
      <span class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
        {p.autoDetected() ? 'Brief detected' : 'Set'}
      </span>
      <label class="flex items-center gap-1.5 text-[13px]">
        <span class="text-[color:var(--color-muted)]">Kind</span>
        <select
          value={p.offerKind()}
          onChange={(e) => p.setOfferKind(e.currentTarget.value as OfferKind)}
          class="font-medium bg-transparent border-0 outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1 py-1"
        >
          <For each={OFFER_KINDS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
        </select>
      </label>
      <label class="flex items-center gap-1.5 text-[13px]">
        <span class="text-[color:var(--color-muted)]">Structure</span>
        <select
          value={p.pricingStructure()}
          onChange={(e) =>
            p.setPricingStructure(e.currentTarget.value as PricingStructure)
          }
          class="font-medium bg-transparent border-0 outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1 py-1"
        >
          <For each={PRICING_STRUCTURES}>
            {(o) => <option value={o.value}>{o.label}</option>}
          </For>
        </select>
      </label>
    </div>
  );
}

export const OFFER_KIND_LABEL: Record<OfferKind, string> = {
  quote: 'Quote',
  bid: 'Bid',
  proposal: 'Proposal',
  contract: 'Contract',
};
