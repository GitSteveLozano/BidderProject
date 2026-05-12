/**
 * <SettingsSections> — sectioned Settings page island.
 *
 * Layout: sticky left-rail table of contents + scrollable right column
 * with H2-grouped sections. Each card hangs an `id` matching its TOC
 * entry so anchor clicks scroll to it. Reads /api/shops/me on mount;
 * if that fails the page surfaces the error rather than showing a
 * perpetual "Loading…" — operators can't fix what they can't see.
 */
import { createResource, createSignal, For, Show } from 'solid-js';
import { isServer } from 'solid-js/web';
import Button from '@/components/ui/Button';
import { Card, CardHeader, CardBody, CardFooter } from '@/components/ui/Card';
import Field, { Input } from '@/components/ui/Field';
import Pill from '@/components/ui/Pill';
import ThemeToggle from '@/components/ui/ThemeToggle';

type Shop = Record<string, any>;

interface Props {
  user_email: string;
  user_name: string;
  role: 'owner' | 'admin' | 'member';
}

async function loadShop(): Promise<Shop> {
  const resp = await fetch('/api/shops/me');
  if (!resp.ok) throw new Error(`Could not load shop (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

async function saveShop(patch: Partial<Shop>): Promise<Shop> {
  const resp = await fetch('/api/shops/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(`Save failed (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

const TOC: Array<{ id: string; label: string; group: 'identity' | 'work' | 'data' | 'account' }> = [
  { id: 'account',     label: 'Account',         group: 'account' },
  { id: 'shop',        label: 'Shop',            group: 'identity' },
  { id: 'license',     label: 'License',         group: 'identity' },
  { id: 'pricing',     label: 'Pricing',         group: 'work' },
  { id: 'voice',       label: 'Voice',           group: 'work' },
  { id: 'integrations',label: 'Connected',       group: 'data' },
  { id: 'delivery',    label: 'Delivery',        group: 'data' },
  { id: 'export',      label: 'Data export',     group: 'data' },
  { id: 'appearance',  label: 'Appearance',      group: 'account' },
];

const GROUP_LABELS: Record<string, string> = {
  account: 'Account',
  identity: 'Your shop, on the record',
  work: 'How you work',
  data: 'Where data flows',
};

export default function SettingsSections(props: Props) {
  // Gate the fetch on a client-only source. Cloudflare Worker's fetch
  // doesn't accept relative URLs, so calling fetch('/api/shops/me')
  // during the SSR pass throws "Invalid URL" and the island never
  // hydrates. The source function evaluates to false on the server
  // (no fetch) and true on the client (fetch runs once).
  const [shop, { mutate, refetch }] = createResource<Shop, boolean>(
    () => !isServer,
    loadShop,
  );
  const [savingKey, setSavingKey] = createSignal<string | null>(null);
  const [errorKey, setErrorKey] = createSignal<string | null>(null);

  const onSave = async (sectionKey: string, patch: Partial<Shop>) => {
    setSavingKey(sectionKey);
    setErrorKey(null);
    try {
      const next = await saveShop(patch);
      mutate(next);
    } catch (err) {
      setErrorKey(sectionKey);
      console.error('[settings] save failed', err);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div class="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-x-10 gap-y-6">
      {/* Left-rail TOC */}
      <nav class="hidden lg:block">
        <div class="sticky top-6">
          <For each={(['account', 'identity', 'work', 'data'] as const)}>
            {(group) => (
              <div class="mb-4">
                <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-1.5">
                  {GROUP_LABELS[group]}
                </div>
                <ul class="space-y-0.5">
                  <For each={TOC.filter((t) => t.group === group)}>
                    {(item) => (
                      <li>
                        <a
                          href={`#${item.id}`}
                          class="block px-2 py-1 -mx-2 rounded text-[13px] text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-ink)]"
                        >
                          {item.label}
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </div>
      </nav>

      {/* Right column */}
      <div class="min-w-0">
        <Show
          when={shop()}
          fallback={
            <Show
              when={shop.error}
              fallback={
                <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-8 text-sm italic font-serif text-[color:var(--color-muted)]">
                  Loading your shop…
                </div>
              }
            >
              <div class="rounded-xl border border-[color:var(--color-danger)] bg-[color:var(--color-danger-tint)] px-5 py-4 text-sm text-[color:var(--color-danger)]">
                <div class="font-medium mb-1">Couldn't load your shop.</div>
                <div class="font-mono text-xs">{shop.error?.message}</div>
                <button class="mt-2 underline" onClick={() => refetch()}>Try again</button>
              </div>
            </Show>
          }
        >
          <div class="space-y-10">
            <GroupHeader id="account-group" label={GROUP_LABELS.account} />
            <div class="space-y-5 -mt-6">
              <AccountSection id="account" user_email={props.user_email} user_name={props.user_name} role={props.role} />
              <AppearanceSection id="appearance" />
            </div>

            <GroupHeader id="identity-group" label={GROUP_LABELS.identity} />
            <div class="space-y-5 -mt-6">
              <ShopSection id="shop" shop={shop()!} saving={savingKey() === 'shop'} onSave={(p) => onSave('shop', p)} />
              <LicenseSection id="license" shop={shop()!} saving={savingKey() === 'license'} onSave={(p) => onSave('license', p)} />
            </div>

            <GroupHeader id="work-group" label={GROUP_LABELS.work} />
            <div class="space-y-5 -mt-6">
              <PricingSection id="pricing" shop={shop()!} saving={savingKey() === 'pricing'} onSave={(p) => onSave('pricing', p)} />
              <VoiceProfileSection id="voice" shop={shop()!} saving={savingKey() === 'voice'} onSave={(p) => onSave('voice', p)} />
            </div>

            <GroupHeader id="data-group" label={GROUP_LABELS.data} />
            <div class="space-y-5 -mt-6">
              <IntegrationsSection id="integrations" shop={shop()!} onSave={(p) => onSave('integrations', p)} />
              <DeliveryStatusSection id="delivery" />
              <DataExportSection id="export" shopId={shop()!.id} />
            </div>
          </div>
          <Show when={errorKey()}>
            <div
              role="alert"
              class="fixed bottom-4 right-4 rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-tint)] px-4 py-3 text-sm text-[color:var(--color-danger)] shadow-[var(--shadow-md)]"
            >
              Save failed. <button class="underline" onClick={() => refetch()}>Try again</button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function GroupHeader(p: { id: string; label: string }) {
  return (
    <div id={p.id} class="pb-2 border-b border-[color:var(--color-line)]">
      <h2 class="font-serif text-[20px] font-medium tracking-tight">{p.label}</h2>
    </div>
  );
}

function AccountSection(p: { id: string; user_email: string; user_name: string; role: string }) {
  return (
    <Card class="scroll-mt-6" >
      <div id={p.id} class="absolute" />
      <CardHeader>
        <h3 class="font-serif text-base font-medium flex-1">Signed in</h3>
        <Pill tone="neutral" dot={false} size="sm">{p.role}</Pill>
      </CardHeader>
      <CardBody>
        <dl class="space-y-2.5 text-sm">
          <div class="flex items-baseline gap-3">
            <dt class="text-[color:var(--color-muted)] w-20 shrink-0">Name</dt>
            <dd class="font-medium">{p.user_name}</dd>
          </div>
          <div class="flex items-baseline gap-3">
            <dt class="text-[color:var(--color-muted)] w-20 shrink-0">Email</dt>
            <dd class="font-mono text-[13px]">{p.user_email}</dd>
          </div>
        </dl>
      </CardBody>
      <CardFooter>
        <div class="flex-1" />
        <a
          href="/auth/signout"
          class="inline-flex items-center justify-center gap-[7px] rounded-lg font-medium whitespace-nowrap px-3.5 py-2 text-[13px] bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-2)]"
        >
          Sign out
        </a>
      </CardFooter>
    </Card>
  );
}

function AppearanceSection(p: { id: string }) {
  return (
    <Card>
      <CardHeader id={p.id}>
        <h3 class="font-serif text-base font-medium flex-1">Appearance</h3>
      </CardHeader>
      <CardBody>
        <div class="flex items-center gap-3">
          <div class="flex-1">
            <div class="text-sm font-medium">Theme</div>
            <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
              Paper (light, default) or Site (dark). Saved to this browser.
            </div>
          </div>
          <ThemeToggle />
        </div>
      </CardBody>
    </Card>
  );
}

function ShopSection(props: { id: string; shop: Shop; saving: boolean; onSave: (p: Partial<Shop>) => void }) {
  const [form, setForm] = createSignal({
    legal_name: props.shop.legal_name ?? '',
    trade_name: props.shop.trade_name ?? '',
    owner_name: props.shop.owner_name ?? '',
  });
  return (
    <Card>
      <CardHeader id={props.id}>
        <h3 class="font-serif text-base font-medium flex-1">Shop</h3>
      </CardHeader>
      <CardBody>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Legal name" class="sm:col-span-2">
            <Input value={form().legal_name} onInput={(e) => setForm({ ...form(), legal_name: e.currentTarget.value })} />
          </Field>
          <Field label="Trade name / DBA">
            <Input value={form().trade_name} onInput={(e) => setForm({ ...form(), trade_name: e.currentTarget.value })} />
          </Field>
          <Field label="Owner name">
            <Input value={form().owner_name} onInput={(e) => setForm({ ...form(), owner_name: e.currentTarget.value })} />
          </Field>
        </div>
      </CardBody>
      <CardFooter>
        <div class="flex-1" />
        <Button variant="accent" onClick={() => props.onSave(form())} disabled={props.saving}>
          {props.saving ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function LicenseSection(props: { id: string; shop: Shop; saving: boolean; onSave: (p: Partial<Shop>) => void }) {
  const [form, setForm] = createSignal({
    license_number: props.shop.license_number ?? '',
    license_jurisdiction: props.shop.license_jurisdiction ?? '',
    license_classification: props.shop.license_classification ?? '',
  });
  return (
    <Card>
      <CardHeader id={props.id}>
        <h3 class="font-serif text-base font-medium flex-1">License</h3>
      </CardHeader>
      <CardBody>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Number" class="sm:col-span-2">
            <Input value={form().license_number} onInput={(e) => setForm({ ...form(), license_number: e.currentTarget.value })} />
          </Field>
          <Field label="State">
            <Input maxlength={4} value={form().license_jurisdiction} onInput={(e) => setForm({ ...form(), license_jurisdiction: e.currentTarget.value })} />
          </Field>
          <Field label="Classification" class="sm:col-span-3">
            <Input value={form().license_classification} onInput={(e) => setForm({ ...form(), license_classification: e.currentTarget.value })} />
          </Field>
        </div>
      </CardBody>
      <CardFooter>
        <div class="flex-1" />
        <Button variant="accent" onClick={() => props.onSave(form())} disabled={props.saving}>
          {props.saving ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PricingSection(props: { id: string; shop: Shop; saving: boolean; onSave: (p: Partial<Shop>) => void }) {
  const [form, setForm] = createSignal({
    default_markup_pct: props.shop.default_markup_pct ?? 32,
    default_labor_rate: props.shop.default_labor_rate ?? 92,
    default_overhead_pct: props.shop.default_overhead_pct ?? 18,
  });
  return (
    <Card>
      <CardHeader id={props.id}>
        <h3 class="font-serif text-base font-medium flex-1">Pricing defaults</h3>
      </CardHeader>
      <CardBody>
        <p class="text-[13px] font-serif italic text-[color:var(--color-muted)] mb-4 leading-relaxed">
          Brief stamps these on every quote until you override them per-line. Refines automatically as you close more jobs.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Target margin %">
            <Input
              type="number"
              step="0.5"
              value={form().default_markup_pct}
              onInput={(e) => setForm({ ...form(), default_markup_pct: parseFloat(e.currentTarget.value || '0') })}
            />
          </Field>
          <Field label="Labor rate $/hr">
            <Input
              type="number"
              step="1"
              value={form().default_labor_rate}
              onInput={(e) => setForm({ ...form(), default_labor_rate: parseFloat(e.currentTarget.value || '0') })}
            />
          </Field>
          <Field label="Overhead %">
            <Input
              type="number"
              step="0.5"
              value={form().default_overhead_pct}
              onInput={(e) => setForm({ ...form(), default_overhead_pct: parseFloat(e.currentTarget.value || '0') })}
            />
          </Field>
        </div>
      </CardBody>
      <CardFooter>
        <div class="flex-1" />
        <Button variant="accent" onClick={() => props.onSave(form())} disabled={props.saving}>
          {props.saving ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </Card>
  );
}

const INTEGRATIONS = [
  { key: 'google_calendar_connected', label: 'Google Calendar', sub: 'Free/busy for send-time suggestions', toggleable: true },
  { key: 'payroll_connected', label: 'ProService Hawaii (payroll)', sub: 'Loaded labor rates + actuals reconciliation', toggleable: false },
  { key: 'quickbooks_connected', label: 'QuickBooks', sub: 'Sync invoices and AR', toggleable: false },
  { key: 'docusign_connected', label: 'DocuSign', sub: 'Send quotes for signature', toggleable: false },
  { key: 'drive_connected', label: 'Google Drive', sub: 'Attach files from your Drive', toggleable: false },
];

function IntegrationsSection(props: { id: string; shop: Shop; onSave: (p: Partial<Shop>) => void }) {
  // Calendar's "Connect" is special — it has to run an OAuth scope
  // upgrade through /auth/signin?with_calendar=1, not a local toggle.
  // Disconnect stays local (just clears the flag).
  const calConnected = () => !!props.shop.google_calendar_connected && props.shop.google_calendar_scope === 'read';
  return (
    <Card>
      <CardHeader id={props.id}>
        <h3 class="font-serif text-base font-medium flex-1">Connected services</h3>
      </CardHeader>
      <div>
        <div class="flex items-center gap-3 px-5 py-3.5">
          <div class="flex-1">
            <div class="font-medium text-sm">Google Calendar</div>
            <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
              Free/busy for the Best-time-to-send chip on Reply / Nudge drafts.
            </div>
          </div>
          <Show when={calConnected()} fallback={<Pill tone="neutral" dot={false}>Not connected</Pill>}>
            <Pill tone="good">Connected</Pill>
          </Show>
          <Show
            when={calConnected()}
            fallback={
              <a
                href="/auth/signin?with_calendar=1&next=/settings"
                class="inline-flex items-center justify-center gap-[7px] rounded-lg font-medium whitespace-nowrap px-3 py-1.5 text-[12px] bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] hover:brightness-95"
              >
                Connect
              </a>
            }
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={() => props.onSave({ google_calendar_connected: false, google_calendar_scope: null } as any)}
            >
              Disconnect
            </Button>
          </Show>
        </div>
        <For each={INTEGRATIONS.filter((i) => i.key !== 'google_calendar_connected')}>
          {(item) => {
            const connected = () => !!props.shop[item.key];
            return (
              <div class="flex items-center gap-3 px-5 py-3.5 border-t border-[color:var(--color-line)]">
                <div class="flex-1">
                  <div class="font-medium text-sm">{item.label}</div>
                  <div class="text-xs text-[color:var(--color-muted)] mt-0.5">{item.sub}</div>
                </div>
                <Show when={connected()} fallback={<Pill tone="neutral" dot={false}>Not connected</Pill>}>
                  <Pill tone="good">Connected</Pill>
                </Show>
                <Show when={item.toggleable}>
                  <Button
                    size="sm"
                    variant={connected() ? 'ghost' : 'default'}
                    onClick={() => props.onSave({ [item.key]: !connected() } as any)}
                  >
                    {connected() ? 'Disconnect' : 'Connect'}
                  </Button>
                </Show>
                <Show when={!item.toggleable}>
                  <Button size="sm" disabled>Coming soon</Button>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Card>
  );
}

function VoiceProfileSection(props: { id: string; shop: Shop; saving: boolean; onSave: (p: Partial<Shop>) => void }) {
  const initialProfile = props.shop.voice_profile ?? {};
  const [intro, setIntro] = createSignal<string>(initialProfile.boilerplate_intro ?? '');
  const [closing, setClosing] = createSignal<string>(initialProfile.boilerplate_closing ?? '');

  const tone = initialProfile.tone as string | undefined;
  const preferredTerms = (initialProfile.preferred_terms as string[] | undefined) ?? [];
  const avoidTerms = (initialProfile.avoid_terms as string[] | undefined) ?? [];
  const calibratedAt = props.shop.voice_sample_processed_at as string | undefined;

  const save = () => {
    props.onSave({
      voice_profile: {
        ...initialProfile,
        boilerplate_intro: intro().trim() || null,
        boilerplate_closing: closing().trim() || null,
      },
    });
  };

  return (
    <Card>
      <CardHeader id={props.id}>
        <h3 class="font-serif text-base font-medium flex-1">Voice</h3>
        <Show when={calibratedAt}>
          <Pill tone="good" size="sm" dot={false}>
            Calibrated
          </Pill>
        </Show>
      </CardHeader>
      <CardBody>
        <Show when={tone || preferredTerms.length > 0}>
          <div class="rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-line)] px-4 py-3 mb-4 text-[13px] leading-relaxed">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] mb-1.5">
              What Brief learned
            </div>
            <Show when={tone}>
              <div class="text-[color:var(--color-ink-2)]">
                <strong class="font-medium">Tone:</strong> <span class="font-serif italic">{tone}</span>
              </div>
            </Show>
            <Show when={preferredTerms.length > 0}>
              <div class="mt-1 text-[color:var(--color-ink-2)]">
                <strong class="font-medium">You say:</strong>{' '}
                <span class="font-mono text-[12px] text-[color:var(--color-muted)]">
                  {preferredTerms.join(', ')}
                </span>
              </div>
            </Show>
            <Show when={avoidTerms.length > 0}>
              <div class="mt-1 text-[color:var(--color-ink-2)]">
                <strong class="font-medium">You don't say:</strong>{' '}
                <span class="font-mono text-[12px] text-[color:var(--color-muted)]">
                  {avoidTerms.join(', ')}
                </span>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={!tone && preferredTerms.length === 0}>
          <p class="text-sm italic font-serif text-[color:var(--color-muted)] mb-4 leading-relaxed">
            No voice signal yet. Run the onboarding sample (or paste 5+ paragraphs from a real quote) and Brief learns how you write.
          </p>
        </Show>

        <Field
          label="Boilerplate intro"
          helper="Goes above the line items on the PDF + at the top of email drafts. Optional."
        >
          <textarea
            rows={3}
            value={intro()}
            onInput={(e) => setIntro(e.currentTarget.value)}
            placeholder="Thanks for thinking of us on this one — here's what we'd put together."
            class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y leading-relaxed"
          />
        </Field>
        <div class="mt-3">
          <Field
            label="Sign-off"
            helper="Ends every Reply / Nudge draft. Keep it short — one line."
          >
            <Input
              value={closing()}
              onInput={(e) => setClosing(e.currentTarget.value)}
              placeholder="Talk soon, — Cavy"
            />
          </Field>
        </div>
      </CardBody>
      <CardFooter>
        <div class="flex-1" />
        <Button variant="accent" onClick={save} disabled={props.saving}>
          {props.saving ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function DeliveryStatusSection(props: { id: string }) {
  // Client-only — same reason as loadShop above: CF Worker fetch can't
  // resolve the relative URL during SSR.
  const [report] = createResource(
    () => !isServer,
    async () => {
      const resp = await fetch('/api/health/delivery');
      if (!resp.ok) throw new Error(`Health probe ${resp.status}`);
      return resp.json() as Promise<{
        brevo: { configured: boolean; ok: boolean; detail: string };
        twilio: { configured: boolean; ok: boolean; detail: string };
      }>;
    },
  );

  const row = (
    name: string,
    state: { configured: boolean; ok: boolean; detail: string } | undefined,
  ) => {
    const tone = !state || !state.configured ? 'neutral' : state.ok ? 'good' : 'warn';
    const label = !state ? 'Loading…' : !state.configured ? 'Not configured' : state.ok ? 'Ready' : 'Issue';
    return (
      <div class="flex items-start gap-3 px-5 py-3.5 border-t border-[color:var(--color-line)] first:border-t-0">
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">{name}</div>
          <Show when={state}>
            <div class="text-xs text-[color:var(--color-muted)] mt-0.5 leading-relaxed">
              {state!.detail}
            </div>
          </Show>
        </div>
        <Pill tone={tone as any} size="sm">{label}</Pill>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader id={props.id}>
        <h3 class="font-serif text-base font-medium flex-1">Delivery</h3>
        <a
          href="/api/health/delivery"
          class="text-xs text-[color:var(--color-accent)] hover:brightness-95 underline"
        >
          Raw JSON ↗
        </a>
      </CardHeader>
      <div>
        {row('Brevo (email)', report()?.brevo)}
        {row('Twilio (SMS)', report()?.twilio)}
      </div>
    </Card>
  );
}

function DataExportSection(props: { id: string; shopId: string }) {
  return (
    <Card>
      <CardHeader id={props.id}>
        <h3 class="font-serif text-base font-medium flex-1">Data export</h3>
      </CardHeader>
      <CardBody>
        <p class="text-sm text-[color:var(--color-muted)] leading-relaxed">
          Your data is yours. Export your shop's complete record as JSON — quotes, jobs, clients, line items, messages, events.
        </p>
      </CardBody>
      <CardFooter>
        <div class="flex-1" />
        <a
          href={`/api/shops/${props.shopId}/export`}
          class="inline-flex items-center justify-center gap-[7px] rounded-lg font-medium whitespace-nowrap px-3.5 py-2 text-[13px] bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-2)]"
          download=""
        >
          Download JSON
        </a>
      </CardFooter>
    </Card>
  );
}
