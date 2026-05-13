/**
 * FixedPriceEditor — single description + single number.
 *
 * The simplest pricing structure: one engagement, one total. Used for
 * sales proposals and small retainers where the client doesn't need a
 * breakdown. The wizard stores this as a single line_item under the
 * hood (qty=1, unit='lump_sum') so save / PDF / send keep working
 * without a special path.
 */
import Field, { Input } from '@/components/ui/Field';

interface Props {
  description: () => string;
  setDescription: (v: string) => void;
  total: () => number;
  setTotal: (v: number) => void;
}

export default function FixedPriceEditor(p: Props) {
  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5 space-y-4">
      <Field
        label="What's the engagement"
        helper="One sentence — the client will see this on the PDF."
      >
        <Input
          value={p.description()}
          onInput={(e) => p.setDescription(e.currentTarget.value)}
          placeholder="e.g. Q4 brand refresh — strategy + visual system + handoff"
        />
      </Field>
      <Field label="Total fee">
        <Input
          type="number"
          step="100"
          value={p.total() || ''}
          onInput={(e) => p.setTotal(parseFloat(e.currentTarget.value || '0'))}
          placeholder="0"
        />
      </Field>
      <p class="text-[12.5px] font-serif italic text-[color:var(--color-muted)] leading-relaxed">
        Fixed-price proposals don't have a margin slider. Total is what the
        client sees and what they pay.
      </p>
    </div>
  );
}
