/**
 * <OnboardingFlow> — 7-step self-serve onboarding island.
 *
 * Steps (post-Google-sign-in):
 *   1. Welcome
 *   2. Voice sample upload (text paste for now — file upload TODO)
 *   3. Scan (real Claude tool-use streaming via /api/voice/analyze)
 *   4. License
 *   5. Confirm profile
 *   6. Pricing defaults
 *   7. Calendar consent (already granted at sign-in if scopes were OK)
 *
 * On completion: PATCH /api/shops/me sets onboarding_completed_at; the
 * Astro page redirects to /dashboard.
 */
import { createSignal, For, Show, createMemo } from 'solid-js';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';
import Stepper from '@/components/ui/Stepper';

interface Props {
  shopId: string;
  ownerName: string;
  ownerEmail: string;
  ownerFirst: string;
  calendarAlreadyConnected: boolean;
}

interface VoiceSignal {
  kind: string;
  value: string;
  evidence?: string;
}

interface ProfileForm {
  legal_name: string;
  trade_name: string;
  license_number: string;
  license_jurisdiction: string;
  license_classification: string;
  default_markup_pct: number;
  default_labor_rate: number;
}

const STEPS = [
  { id: 'welcome',  label: 'Welcome' },
  { id: 'upload',   label: 'Upload' },
  { id: 'scan',     label: 'Scan' },
  { id: 'license',  label: 'License' },
  { id: 'confirm',  label: 'Confirm' },
  { id: 'defaults', label: 'Defaults' },
  { id: 'calendar', label: 'Calendar' },
];

export default function OnboardingFlow(props: Props) {
  const [stepIdx, setStepIdx] = createSignal(0);
  const stepId = createMemo(() => STEPS[stepIdx()].id);
  const completed = createMemo(() => STEPS.slice(0, stepIdx()).map((s) => s.id));

  // Step 2: voice sample (paste-text MVP)
  const [voiceText, setVoiceText] = createSignal('');
  const [voiceSignals, setVoiceSignals] = createSignal<VoiceSignal[]>([]);
  const [scanProgress, setScanProgress] = createSignal(0);
  const [scanError, setScanError] = createSignal<string | null>(null);

  // Step 4-6: profile
  const [profile, setProfile] = createSignal<ProfileForm>({
    legal_name: props.ownerName,
    trade_name: '',
    license_number: '',
    license_jurisdiction: 'CA',
    license_classification: '',
    default_markup_pct: 32,
    default_labor_rate: 92,
  });
  const updateProfile = (patch: Partial<ProfileForm>) =>
    setProfile({ ...profile(), ...patch });

  // Step 7: calendar
  const [calendarConnected, setCalendarConnected] = createSignal(props.calendarAlreadyConnected);

  const [finishing, setFinishing] = createSignal(false);

  const next = () => setStepIdx(Math.min(stepIdx() + 1, STEPS.length - 1));
  const back = () => setStepIdx(Math.max(stepIdx() - 1, 0));

  // Kick off the scan when we land on step 3
  const startScan = async () => {
    setScanProgress(0);
    setScanError(null);
    setVoiceSignals([]);
    try {
      const resp = await fetch('/api/voice/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: voiceText() }),
      });
      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}: ${await resp.text()}`);
      }
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
          if (payload.type === 'progress') {
            setScanProgress(payload.percent);
          } else if (payload.type === 'signal') {
            setVoiceSignals([...voiceSignals(), payload.payload]);
          } else if (payload.type === 'done') {
            setScanProgress(100);
          } else if (payload.type === 'error') {
            setScanError(payload.message);
          }
        }
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    }
  };

  const goToScan = async () => {
    next();
    await startScan();
  };

  const finish = async () => {
    setFinishing(true);
    try {
      const resp = await fetch('/api/shops/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...profile(),
          google_calendar_connected: calendarConnected(),
          onboarding_completed_at: new Date().toISOString(),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[onboarding] finish failed', err);
      alert('Could not save profile: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div class="max-w-[740px] mx-auto py-4">
      <div class="flex items-center justify-between mb-10">
        <div>
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Setting up Brief
          </div>
          <h1 class="font-serif text-[40px] font-medium leading-tight mt-1">
            {stepIdx() === STEPS.length - 1 ? "You're ready." : 'Welcome.'}
          </h1>
        </div>
        <Stepper steps={STEPS} current={stepId()} completed={completed()} />
      </div>

      <Show when={stepId() === 'welcome'}>
        {/* Editorial welcome card — matches design/mockups/07-calendar.png style. */}
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-10 shadow-[var(--shadow-sm)]">
          <h2 class="font-serif text-[26px] font-medium leading-tight">
            Want to save a few minutes?
          </h2>
          <p class="mt-4 text-[15px] font-serif text-[color:var(--color-ink-2)] leading-relaxed">
            If your business has a <em>public</em> record — a contractor license, a state registry, a professional board listing — Brief can read it and pre-fill your profile. Most businesses don't have one, and that's fine. You can fill the profile out yourself in about a minute.
          </p>
          <button
            type="button"
            onClick={next}
            class="mt-6 w-full text-left rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface-2)] hover:bg-[color:var(--color-surface)] hover:border-[color:var(--color-line-strong)] px-5 py-4 transition-colors flex items-center gap-4"
          >
            <div class="w-9 h-9 rounded-md bg-[color:var(--color-accent-tint)] text-[color:var(--color-accent)] grid place-items-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.3 10.3l3.2 3.2" stroke-linecap="round" />
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-[14px]">Look up a public record</div>
              <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
                Contractor license, state business registry, or similar. We'll show you what we found before saving anything.
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" class="text-[color:var(--color-muted)]" aria-hidden="true"><path d="M5 3l4 4-4 4" /></svg>
          </button>
          <button
            type="button"
            onClick={next}
            class="mt-3 w-full text-left rounded-lg border border-[color:var(--color-line-2)] hover:bg-[color:var(--color-surface-2)] hover:border-[color:var(--color-line-strong)] px-5 py-4 transition-colors flex items-center gap-4"
          >
            <div class="w-9 h-9 rounded-md bg-[color:var(--color-bg-2)] text-[color:var(--color-muted)] grid place-items-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 2.5h6l3.5 3.5v7.5a0.5 0.5 0 0 1 -0.5 0.5h-9a0.5 0.5 0 0 1 -0.5 -0.5v-11a0.5 0.5 0 0 1 0.5 -0.5z" />
                <path d="M9 2.5v3.5h3.5" />
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-[14px]">Skip and fill it in yourself</div>
              <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
                Takes about a minute. Six steps total — none of them graded.
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" class="text-[color:var(--color-muted)]" aria-hidden="true"><path d="M5 3l4 4-4 4" /></svg>
          </button>
        </div>
      </Show>

      <Show when={stepId() === 'upload'}>
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-10 shadow-[var(--shadow-sm)]">
          <h2 class="font-serif text-[26px] font-medium leading-tight">
            Show Brief one thing you've already written.
          </h2>
          <p class="mt-4 text-[15px] font-serif text-[color:var(--color-ink-2)] leading-relaxed">
            A past quote, your website, or even a rough email you sent a client. Brief reads it to learn your voice — the way you scope, the way you price, the way you sign off. It's the difference between Brief sounding like <em>you</em> and Brief sounding like a chatbot.
          </p>
          <div class="mt-6">
            <Field label="Sample text">
              <textarea
                rows={10}
                value={voiceText()}
                onInput={(e) => setVoiceText(e.currentTarget.value)}
                placeholder="Paste 5+ paragraphs from a real quote, email, or proposal…"
                class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y min-h-[200px] leading-relaxed"
              />
            </Field>
            <p class="mt-2 text-xs text-[color:var(--color-muted)] italic font-serif">
              File upload + URL paste coming soon — text paste works today.
            </p>
          </div>
          <div class="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStepIdx(3)}>
              Skip for now — you'll have less polish
            </Button>
            <Button
              variant="accent"
              disabled={voiceText().trim().length < 200}
              onClick={goToScan}
            >
              Scan this →
            </Button>
          </div>
        </div>
      </Show>

      <Show when={stepId() === 'scan'}>
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-10 shadow-[var(--shadow-sm)]">
          {/* Header row — eyebrow + serif H1 + big % readout (matches
              design/mockups/01-welcome.png "Working on C-35 #1089342"
              format applied to voice analysis). */}
          <div class="flex items-start gap-6">
            <div class="flex-1 min-w-0">
              <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
                Brief is reading the sample
              </div>
              <h2 class="mt-1 font-serif text-[26px] font-medium leading-tight">
                Picking up your voice.
              </h2>
            </div>
            <div class="font-serif text-[32px] font-medium tabular-nums leading-none text-[color:var(--color-ink)]">
              {Math.round(scanProgress())}<span class="text-[16px] text-[color:var(--color-muted)]">%</span>
            </div>
          </div>
          <div class="mt-4 h-1 bg-[color:var(--color-bg-2)] rounded-full overflow-hidden">
            <div
              class="h-full bg-[color:var(--color-accent)] transition-all duration-300"
              style={{ width: `${scanProgress()}%` }}
            />
          </div>
          <Show when={scanError()}>
            <div class="mt-4 rounded-lg bg-[color:var(--color-danger-tint)] px-4 py-3 text-sm text-[color:var(--color-danger)]">
              {scanError()}. <button class="underline" onClick={startScan}>Try again</button>
            </div>
          </Show>
          <div class="mt-6 space-y-2">
            <For each={voiceSignals()}>
              {(s) => (
                <div class="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] px-4 py-2.5 flex items-start gap-3 text-sm">
                  <span class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] pt-1 min-w-[110px]">
                    {s.kind.replace(/_/g, ' ')}
                  </span>
                  <div class="flex-1">
                    <div class="text-[color:var(--color-ink)]">{s.value}</div>
                    <Show when={s.evidence}>
                      <div class="mt-1 text-xs italic text-[color:var(--color-muted)] font-serif">
                        "{s.evidence}"
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
          <div class="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={back}>← Back</Button>
            <Button
              variant="accent"
              disabled={scanProgress() < 100 && !scanError()}
              onClick={next}
            >
              Continue →
            </Button>
          </div>
        </div>
      </Show>

      <Show when={stepId() === 'license'}>
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-8 shadow-[var(--shadow-sm)]">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Step 4 · License
          </div>
          <h2 class="mt-1 font-serif text-[24px] font-medium leading-tight">
            Contractor license.
          </h2>
          <p class="mt-3 text-sm text-[color:var(--color-muted)] leading-relaxed">
            We'll print it on the bottom of every bid. Skip if you'd rather add it later — most clients will ask before they sign anyway.
          </p>
          <div class="mt-5 grid grid-cols-3 gap-4">
            <Field label="License #" class="col-span-2">
              <Input
                value={profile().license_number}
                onInput={(e) => updateProfile({ license_number: e.currentTarget.value })}
                placeholder="C-35 #1089342"
              />
            </Field>
            <Field label="State">
              <Input
                value={profile().license_jurisdiction}
                onInput={(e) => updateProfile({ license_jurisdiction: e.currentTarget.value })}
                placeholder="CA"
                maxlength={4}
              />
            </Field>
            <Field label="Classification" class="col-span-3">
              <Input
                value={profile().license_classification}
                onInput={(e) => updateProfile({ license_classification: e.currentTarget.value })}
                placeholder="C-35 Lathing and Plastering"
              />
            </Field>
          </div>
          <div class="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={back}>← Back</Button>
            <Button variant="accent" onClick={next}>Continue →</Button>
          </div>
        </div>
      </Show>

      <Show when={stepId() === 'confirm'}>
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-8 shadow-[var(--shadow-sm)]">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Step 5 · Confirm
          </div>
          <h2 class="mt-1 font-serif text-[24px] font-medium leading-tight">
            Your shop, on the record.
          </h2>
          <div class="mt-5 grid grid-cols-2 gap-4">
            <Field label="Legal name" class="col-span-2">
              <Input
                value={profile().legal_name}
                onInput={(e) => updateProfile({ legal_name: e.currentTarget.value })}
              />
            </Field>
            <Field label="DBA / Trade name" class="col-span-2">
              <Input
                value={profile().trade_name}
                onInput={(e) => updateProfile({ trade_name: e.currentTarget.value })}
                placeholder="L·A Stucco"
              />
            </Field>
            <Field label="Owner email">
              <Input value={props.ownerEmail} disabled />
            </Field>
          </div>
          <div class="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={back}>← Back</Button>
            <Button variant="accent" onClick={next}>Continue →</Button>
          </div>
        </div>
      </Show>

      <Show when={stepId() === 'defaults'}>
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-8 shadow-[var(--shadow-sm)]">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Step 6 · Defaults
          </div>
          <h2 class="mt-1 font-serif text-[24px] font-medium leading-tight">
            Pricing defaults.
          </h2>
          <p class="mt-3 text-sm text-[color:var(--color-muted)] leading-relaxed">
            Best guesses for now — Brief refines these as you close jobs.
          </p>
          <div class="mt-5 grid grid-cols-2 gap-4">
            <Field label="Target margin %" helper="Standard: 30–35%">
              <Input
                type="number"
                step="0.5"
                value={profile().default_markup_pct}
                onInput={(e) => updateProfile({ default_markup_pct: parseFloat(e.currentTarget.value || '0') })}
              />
            </Field>
            <Field label="Loaded labor rate ($/hr)" helper="Burdened average across your crew">
              <Input
                type="number"
                step="1"
                value={profile().default_labor_rate}
                onInput={(e) => updateProfile({ default_labor_rate: parseFloat(e.currentTarget.value || '0') })}
              />
            </Field>
          </div>
          <div class="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={back}>← Back</Button>
            <Button variant="accent" onClick={next}>Continue →</Button>
          </div>
        </div>
      </Show>

      <Show when={stepId() === 'calendar'}>
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-8 shadow-[var(--shadow-sm)]">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Step 7 · Calendar
          </div>
          <h2 class="mt-1 font-serif text-[24px] font-medium leading-tight">
            {props.calendarAlreadyConnected ? 'Calendar connected.' : 'Connect your calendar.'}
          </h2>
          <p class="mt-3 text-sm text-[color:var(--color-muted)] leading-relaxed">
            Brief reads your free/busy to suggest the best time to send follow-ups. Read-only — nothing posted without your say-so.
          </p>
          <div class="mt-5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] px-4 py-3.5 flex items-center gap-3">
            <div class="flex-1 text-sm">
              <strong class="font-medium">Google Calendar</strong>
              <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
                {calendarConnected() ? 'Connected — read access' : 'Not connected'}
              </div>
            </div>
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={calendarConnected()}
                onChange={(e) => setCalendarConnected(e.currentTarget.checked)}
                class="w-4 h-4 accent-[color:var(--color-accent)]"
              />
              {calendarConnected() ? 'Enabled' : 'Enable'}
            </label>
          </div>
          <div class="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={back}>← Back</Button>
            <Button variant="accent" disabled={finishing()} onClick={finish}>
              {finishing() ? 'Saving…' : "Finish setup →"}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}
