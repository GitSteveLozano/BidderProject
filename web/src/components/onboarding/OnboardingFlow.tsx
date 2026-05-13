/**
 * <OnboardingFlow> — 2-screen self-serve onboarding.
 *
 * Step 1 · Basics. Business name, owner, what to call it, optional
 *   license. Everything else (pricing defaults, calendar, integrations,
 *   voice profile, etc.) lives in Settings — operator can fill it in
 *   later without blocking activation.
 *
 * Step 2 · Sample. Drop one piece of past writing — a sample bid (PDF),
 *   a website URL, pasted text, or a voice memo. Brief reads it to
 *   learn how the operator writes. Skip-able; the analyzer runs
 *   silently in the background (or not at all) so onboarding never
 *   stalls on a network call.
 *
 * On finish: PATCH /api/shops/me to mark onboarding_completed_at and
 * persist business basics, then redirect to /dashboard.
 */
import { createEffect, createSignal, For, Show } from 'solid-js';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';

interface Props {
  shopId: string;
  ownerName: string;
  ownerEmail: string;
  ownerFirst: string;
}

interface Profile {
  legal_name: string;
  trade_name: string;
  owner_name: string;
  business_noun: string;
  license_number: string;
  license_jurisdiction: string;
  license_classification: string;
}

const NOUN_SUGGESTIONS = ['shop', 'agency', 'studio', 'firm', 'practice'];

export default function OnboardingFlow(props: Props) {
  const [step, setStep] = createSignal<1 | 2>(1);

  const [profile, setProfile] = createSignal<Profile>({
    legal_name: props.ownerName,
    trade_name: '',
    owner_name: props.ownerName,
    business_noun: 'shop',
    license_number: '',
    license_jurisdiction: '',
    license_classification: '',
  });
  const update = (patch: Partial<Profile>) => setProfile({ ...profile(), ...patch });
  const [showLicense, setShowLicense] = createSignal(false);

  // Step 2 — sample drop. Accepts any one of: file, url, pasted text,
  // recorded voice (deferred to MediaRecorder in the future; for v1
  // text + file + URL are the three entry points).
  const [sampleText, setSampleText] = createSignal('');
  const [sampleUrl, setSampleUrl] = createSignal('');
  const [pdfChip, setPdfChip] = createSignal<{ name: string; chars: number } | null>(null);
  const [sampleBusy, setSampleBusy] = createSignal(false);
  const [sampleError, setSampleError] = createSignal<string | null>(null);

  const [finishing, setFinishing] = createSignal(false);
  const [finishError, setFinishError] = createSignal<string | null>(null);

  const canContinueStep1 = () =>
    profile().legal_name.trim().length > 0 &&
    profile().business_noun.trim().length > 0 &&
    profile().owner_name.trim().length > 0;

  const handlePdf = async (file: File) => {
    setSampleBusy(true);
    setSampleError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/intake/extract-pdf', { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { text: string; empty_text: boolean; filename: string };
      if (data.empty_text) {
        setSampleError('That PDF has no selectable text — try another file, or paste/type your sample.');
        return;
      }
      setSampleText(data.text);
      setPdfChip({ name: data.filename, chars: data.text.length });
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : String(err));
    } finally {
      setSampleBusy(false);
    }
  };

  const fetchUrl = async () => {
    const url = sampleUrl().trim();
    if (!url) return;
    setSampleBusy(true);
    setSampleError(null);
    try {
      // Re-use the public-record-lookup endpoint to fetch the page and
      // extract text content from the website. It already returns
      // og-tag + JSON-LD context which is good signal.
      const resp = await fetch('/api/onboarding/public-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ website_url: url }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { matches?: Array<{ evidence_excerpt?: string; legal_name?: string }> };
      const m = data.matches?.[0];
      if (!m) {
        setSampleError(`Couldn't read anything from ${url}. Paste a sample instead?`);
        return;
      }
      // Compose a small "sample" from what we extracted. Better than
      // nothing for voice signal — gives the analyzer some material.
      const composed = [
        m.legal_name ? `Company: ${m.legal_name}` : '',
        m.evidence_excerpt ? `Description: ${m.evidence_excerpt}` : '',
      ].filter(Boolean).join('\n\n');
      if (composed.length < 50) {
        setSampleError(`Found the page but only ${composed.length} chars of text. Drop a PDF or paste a sample.`);
        return;
      }
      setSampleText(composed);
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : String(err));
    } finally {
      setSampleBusy(false);
    }
  };

  const finish = async (opts: { withSample: boolean }) => {
    setFinishing(true);
    setFinishError(null);
    try {
      const patch: Record<string, unknown> = {
        ...profile(),
        // Trim license fields if all empty so we don't write meaningless rows.
        license_number: profile().license_number.trim() || null,
        license_jurisdiction: profile().license_jurisdiction.trim() || null,
        license_classification: profile().license_classification.trim() || null,
        trade_name: profile().trade_name.trim() || null,
        business_noun: profile().business_noun.trim().toLowerCase() || 'shop',
        onboarding_completed_at: new Date().toISOString(),
      };
      const resp = await fetch('/api/shops/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) throw new Error(await resp.text());

      // Kick off the voice analyzer in the background if we have a
      // sample. Don't await — onboarding redirects immediately;
      // signal lands on shop.voice_profile when the analyzer finishes.
      if (opts.withSample && sampleText().trim().length >= 50) {
        void fetch('/api/voice/analyze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: sampleText() }),
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[onboarding] background analyze failed', err);
        });
      }

      window.location.href = '/dashboard';
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : String(err));
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div class="max-w-[680px] mx-auto py-10 px-4">
      <div class="flex items-baseline gap-3 mb-8">
        <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
          Setting up Brief
        </div>
        <span class="flex-1" />
        <div class="font-mono text-xs text-[color:var(--color-muted)]">
          Step {step()} of 2
        </div>
      </div>

      <Show when={step() === 1}>
        <h1 class="font-serif text-[40px] font-medium leading-tight">
          Welcome, <em>{props.ownerFirst}</em>.
        </h1>
        <p class="mt-3 text-[15px] font-serif text-[color:var(--color-ink-2)] leading-relaxed max-w-[55ch]">
          Two quick questions and you're in. Brief works without any of this
          (you can edit everything from Settings later), but it sharpens up
          fast once it knows the basics.
        </p>

        <div class="mt-7 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-6 shadow-[var(--shadow-sm)]">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] mb-3">
            Your business
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Legal or trade name" class="sm:col-span-2">
              <Input
                value={profile().legal_name}
                onInput={(e) => update({ legal_name: e.currentTarget.value })}
                placeholder="L·A Stucco / Halsted & Sons / etc."
              />
            </Field>
            <Field label="Your name">
              <Input
                value={profile().owner_name}
                onInput={(e) => update({ owner_name: e.currentTarget.value })}
              />
            </Field>
            <Field label="What you call this" helper="Plural? Just give us the singular noun.">
              <Input
                value={profile().business_noun}
                onInput={(e) => update({ business_noun: e.currentTarget.value })}
                placeholder="shop"
                maxlength={32}
              />
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <For each={NOUN_SUGGESTIONS}>
                  {(n) => (
                    <button
                      type="button"
                      onClick={() => update({ business_noun: n })}
                      class={[
                        'text-[11px] font-mono px-2 py-0.5 rounded-full border',
                        profile().business_noun === n
                          ? 'bg-[color:var(--color-accent-tint)] border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                          : 'border-[color:var(--color-line-2)] text-[color:var(--color-muted)] hover:bg-[color:var(--color-surface-2)]',
                      ].join(' ')}
                    >
                      {n}
                    </button>
                  )}
                </For>
              </div>
            </Field>
          </div>
        </div>

        <Show
          when={showLicense()}
          fallback={
            <button
              type="button"
              onClick={() => setShowLicense(true)}
              class="mt-3 text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] underline"
            >
              + Add a license (optional — we stamp it on every quote)
            </button>
          }
        >
          <div class="mt-3 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-6 shadow-[var(--shadow-sm)]">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] mb-3">
              License (optional)
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Number" class="sm:col-span-2">
                <Input
                  value={profile().license_number}
                  onInput={(e) => update({ license_number: e.currentTarget.value })}
                  placeholder="C-35 #1089342"
                />
              </Field>
              <Field label="State">
                <Input
                  value={profile().license_jurisdiction}
                  onInput={(e) => update({ license_jurisdiction: e.currentTarget.value })}
                  placeholder="CA"
                  maxlength={4}
                />
              </Field>
              <Field label="Classification" class="sm:col-span-3">
                <Input
                  value={profile().license_classification}
                  onInput={(e) => update({ license_classification: e.currentTarget.value })}
                  placeholder="C-35 Lathing and Plastering"
                />
              </Field>
            </div>
          </div>
        </Show>

        <div class="mt-8 flex items-center justify-between">
          <a
            href="/auth/signout"
            class="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
          >
            Sign out
          </a>
          <Button
            variant="accent"
            disabled={!canContinueStep1()}
            onClick={() => setStep(2)}
          >
            Continue →
          </Button>
        </div>
      </Show>

      <Show when={step() === 2}>
        <h1 class="font-serif text-[40px] font-medium leading-tight">
          Show Brief one thing you've already written.
        </h1>
        <p class="mt-3 text-[15px] font-serif text-[color:var(--color-ink-2)] leading-relaxed max-w-[55ch]">
          A past quote, your website, or a few paragraphs you sent a client.
          Brief reads it to learn your voice — the way you scope, the way you
          sign off. Skip if you'd rather; we'll learn as you go.
        </p>

        <div class="mt-7 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-6 shadow-[var(--shadow-sm)]">
          {/* Three intake methods on one card. Whichever the operator
              uses populates the same `sampleText` signal, which the
              analyzer reads on finish. */}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              class={[
                'rounded-lg border border-dashed px-4 py-3 cursor-pointer transition-colors',
                pdfChip()
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-tint)]'
                  : 'border-[color:var(--color-line-2)] bg-[color:var(--color-surface-2)] hover:border-[color:var(--color-accent)]',
              ].join(' ')}
            >
              <input
                type="file"
                accept="application/pdf,.pdf"
                class="sr-only"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) handlePdf(f);
                }}
              />
              <div class="flex items-start gap-3">
                <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" class="text-[color:var(--color-muted)] shrink-0 mt-0.5" aria-hidden="true">
                  <path d="M7 4h7l4 4v9.5a1.5 1.5 0 0 1 -1.5 1.5h-9.5a1.5 1.5 0 0 1 -1.5 -1.5v-12a1.5 1.5 0 0 1 1.5 -1.5z" />
                  <path d="M14 4v4h4" />
                  <path d="M11 18v-4M9 16l2 -2 2 2" stroke-linecap="round" />
                </svg>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-sm">Drop a PDF</div>
                  <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
                    Past quote, proposal, or RFP response
                  </div>
                  <Show when={pdfChip()}>
                    <div class="mt-1.5 text-[11.5px] font-mono text-[color:var(--color-accent)]">
                      ✓ {pdfChip()!.name} · {pdfChip()!.chars.toLocaleString()} chars
                    </div>
                  </Show>
                </div>
              </div>
            </label>

            <div class="rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface-2)] px-4 py-3">
              <div class="flex items-start gap-3">
                <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" class="text-[color:var(--color-muted)] shrink-0 mt-0.5" aria-hidden="true">
                  <path d="M10 12.5l3 -3M5.5 14.5a3 3 0 0 1 0 -4l3 -3a3 3 0 0 1 4 0M16.5 7.5a3 3 0 0 1 0 4l-3 3a3 3 0 0 1 -4 0" />
                </svg>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-sm">Or paste a website URL</div>
                  <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
                    Brief reads your About / Services page
                  </div>
                  <div class="mt-2 flex gap-1.5">
                    <input
                      type="url"
                      value={sampleUrl()}
                      onInput={(e) => setSampleUrl(e.currentTarget.value)}
                      placeholder="example.com"
                      class="flex-1 min-w-0 px-2 py-1 rounded text-xs bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)]"
                    />
                    <button
                      type="button"
                      onClick={fetchUrl}
                      disabled={sampleBusy() || !sampleUrl().trim()}
                      class="text-xs font-medium px-2 py-1 rounded bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] disabled:opacity-50"
                    >
                      Fetch
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-5">
            <Field label="Or paste 5+ paragraphs" helper="Any old quote, proposal, or email you sent a client.">
              <textarea
                rows={8}
                value={sampleText()}
                onInput={(e) => setSampleText(e.currentTarget.value)}
                placeholder="Drop in any text Brief can learn your voice from…"
                class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y leading-relaxed"
              />
            </Field>
            <div class="mt-1 text-[11px] text-[color:var(--color-muted)] font-mono">
              {sampleText().length.toLocaleString()} chars
              {sampleText().length > 0 && sampleText().length < 50 && (
                <span class="text-[color:var(--color-warn)]"> · need at least 50 to learn anything</span>
              )}
            </div>
          </div>

          <Show when={sampleBusy()}>
            <div class="mt-2 text-xs text-[color:var(--color-muted)] italic font-serif">
              Reading…
            </div>
          </Show>
          <Show when={sampleError()}>
            <div class="mt-2 text-xs text-[color:var(--color-danger)]">{sampleError()}</div>
          </Show>
        </div>

        <Show when={finishError()}>
          <div class="mt-4 rounded-lg bg-[color:var(--color-danger-tint)] px-4 py-3 text-sm text-[color:var(--color-danger)]">
            {finishError()}
          </div>
        </Show>

        <div class="mt-8 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
          <div class="flex items-center gap-3">
            <button
              type="button"
              onClick={() => finish({ withSample: false })}
              disabled={finishing()}
              class="text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] underline"
            >
              Skip — I'll add later
            </button>
            <Button
              variant="accent"
              disabled={finishing() || sampleText().trim().length < 50}
              onClick={() => finish({ withSample: true })}
            >
              {finishing() ? 'Finishing…' : 'Finish setup →'}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}
