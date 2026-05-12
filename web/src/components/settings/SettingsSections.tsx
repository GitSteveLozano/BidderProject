/**
 * <SettingsSections> — Solid island wrapping all Settings sections.
 *
 * Reads /api/shops/me on mount, lets the user edit any section, PATCHes
 * dirty fields. Sections (per design):
 *   Account, Shop & License, Pricing Defaults, Connected Services,
 *   Branding, Notifications, Data Export.
 *
 * Most integrations (QuickBooks, DocuSign, Drive) are placeholder
 * "Connect" rows — the OAuth flows ship in a follow-on. Google Calendar
 * is functional (toggle, persisted in shops table).
 */
import { createResource, createSignal, For, Show } from 'solid-js';
import Button from '@/components/ui/Button';
import { Card, CardHeader, CardBody, CardFooter } from '@/components/ui/Card';
import Field, { Input } from '@/components/ui/Field';
import Pill from '@/components/ui/Pill';
import ThemeToggle from '@/components/ui/ThemeToggle';

type Shop = Record<string, any>;

async function loadShop(): Promise<Shop> {
  const resp = await fetch('/api/shops/me');
  if (!resp.ok) throw new Error(`Could not load shop (${resp.status})`);
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

export default function SettingsSections() {
  const [shop, { mutate, refetch }] = createResource<Shop>(loadShop);
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
    <Show when={shop()} fallback={<div class="text-sm text-[color:var(--color-muted)]">Loading…</div>}>
      <div class="space-y-6">
        <AppearanceSection />
        <ShopSection shop={shop()!} saving={savingKey() === 'shop'} onSave={(p) => onSave('shop', p)} />
        <LicenseSection shop={shop()!} saving={savingKey() === 'license'} onSave={(p) => onSave('license', p)} />
        <PricingSection shop={shop()!} saving={savingKey() === 'pricing'} onSave={(p) => onSave('pricing', p)} />
        <IntegrationsSection shop={shop()!} onSave={(p) => onSave('integrations', p)} />
        <DataExportSection shopId={shop()!.id} />
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
  );
}

function AppearanceSection() {
  return (
    <Card>
      <CardHeader>
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

function ShopSection(props: { shop: Shop; saving: boolean; onSave: (p: Partial<Shop>) => void }) {
  const [form, setForm] = createSignal({
    legal_name: props.shop.legal_name ?? '',
    trade_name: props.shop.trade_name ?? '',
    owner_name: props.shop.owner_name ?? '',
  });
  return (
    <Card>
      <CardHeader>
        <h3 class="font-serif text-base font-medium flex-1">Shop</h3>
      </CardHeader>
      <CardBody>
        <div class="grid grid-cols-2 gap-4">
          <Field label="Legal name" class="col-span-2">
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

function LicenseSection(props: { shop: Shop; saving: boolean; onSave: (p: Partial<Shop>) => void }) {
  const [form, setForm] = createSignal({
    license_number: props.shop.license_number ?? '',
    license_jurisdiction: props.shop.license_jurisdiction ?? '',
    license_classification: props.shop.license_classification ?? '',
  });
  return (
    <Card>
      <CardHeader>
        <h3 class="font-serif text-base font-medium flex-1">License</h3>
      </CardHeader>
      <CardBody>
        <div class="grid grid-cols-3 gap-4">
          <Field label="Number" class="col-span-2">
            <Input value={form().license_number} onInput={(e) => setForm({ ...form(), license_number: e.currentTarget.value })} />
          </Field>
          <Field label="State">
            <Input maxlength={4} value={form().license_jurisdiction} onInput={(e) => setForm({ ...form(), license_jurisdiction: e.currentTarget.value })} />
          </Field>
          <Field label="Classification" class="col-span-3">
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

function PricingSection(props: { shop: Shop; saving: boolean; onSave: (p: Partial<Shop>) => void }) {
  const [form, setForm] = createSignal({
    default_markup_pct: props.shop.default_markup_pct ?? 32,
    default_labor_rate: props.shop.default_labor_rate ?? 92,
    default_overhead_pct: props.shop.default_overhead_pct ?? 18,
  });
  return (
    <Card>
      <CardHeader>
        <h3 class="font-serif text-base font-medium flex-1">Pricing defaults</h3>
      </CardHeader>
      <CardBody>
        <div class="grid grid-cols-3 gap-4">
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

function IntegrationsSection(props: { shop: Shop; onSave: (p: Partial<Shop>) => void }) {
  return (
    <Card>
      <CardHeader>
        <h3 class="font-serif text-base font-medium flex-1">Connected services</h3>
      </CardHeader>
      <div>
        <For each={INTEGRATIONS}>
          {(item) => {
            const connected = () => !!props.shop[item.key];
            return (
              <div class="flex items-center gap-3 px-5 py-3.5 border-t border-[color:var(--color-line)] first:border-t-0">
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

function DataExportSection(props: { shopId: string }) {
  return (
    <Card>
      <CardHeader>
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
