/**
 * <ContactsList> — multi-contact editor on /clients/[id].
 *
 * Lists current contacts with primary + always-notify badges, lets the
 * operator add/edit/delete inline. Only the primary contact is gated
 * to one per client; everyone else is free-form. Always-notify drives
 * the default recipient set on the per-quote send picker.
 */
import { createResource, createSignal, For, Show } from 'solid-js';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';
import Pill from '@/components/ui/Pill';

export interface ClientContact {
  id: string;
  client_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  is_primary: boolean;
  always_notify: boolean;
}

interface Props {
  client_id: string;
  initial: ClientContact[];
  /** If the parent client row has legacy primary_contact_* data but
   * client_contacts is empty, the parent passes a one-time prompt so
   * the operator can import it as a real contact without re-typing. */
  legacy_primary?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
}

const EMPTY_DRAFT = {
  name: '',
  email: '',
  phone: '',
  title: '',
  is_primary: false,
  always_notify: true,
};

export default function ContactsList(props: Props) {
  const [contacts, setContacts] = createSignal<ClientContact[]>([...props.initial]);
  const [adding, setAdding] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal({ ...EMPTY_DRAFT });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const openAdd = () => {
    setDraft({ ...EMPTY_DRAFT, is_primary: contacts().length === 0 });
    setEditingId(null);
    setAdding(true);
    setError(null);
  };

  const openEdit = (c: ClientContact) => {
    setDraft({
      name: c.name ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      title: c.title ?? '',
      is_primary: c.is_primary,
      always_notify: c.always_notify,
    });
    setEditingId(c.id);
    setAdding(true);
    setError(null);
  };

  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT });
    setError(null);
  };

  const submit = async () => {
    const d = draft();
    if (!d.name.trim() && !d.email.trim() && !d.phone.trim()) {
      setError('Need at least a name, email, or phone.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = editingId()
        ? `/api/client/${props.client_id}/contacts/${editingId()}`
        : `/api/client/${props.client_id}/contacts`;
      const resp = await fetch(url, {
        method: editingId() ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: d.name.trim() || null,
          email: d.email.trim() || null,
          phone: d.phone.trim() || null,
          title: d.title.trim() || null,
          is_primary: d.is_primary,
          always_notify: d.always_notify,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const saved = (await resp.json()) as ClientContact;
      if (editingId()) {
        const id = editingId()!;
        setContacts(
          contacts().map((c) => {
            if (c.id === id) return saved;
            // If saved was promoted to primary, demote the others
            // locally to match what the server did.
            if (saved.is_primary && c.is_primary) return { ...c, is_primary: false };
            return c;
          }),
        );
      } else {
        setContacts([
          ...contacts().map((c) =>
            saved.is_primary ? { ...c, is_primary: false } : c,
          ),
          saved,
        ]);
      }
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: ClientContact) => {
    if (!confirm(`Remove ${c.name ?? c.email ?? c.phone ?? 'this contact'}?`)) return;
    const before = contacts();
    setContacts(contacts().filter((x) => x.id !== c.id));
    try {
      const resp = await fetch(`/api/client/${props.client_id}/contacts/${c.id}`, {
        method: 'DELETE',
      });
      if (!resp.ok) throw new Error(await resp.text());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setContacts(before);
    }
  };

  return (
    <div>
      <Show when={contacts().length === 0 && !adding()}>
        <p class="text-sm italic font-serif text-[color:var(--color-muted)] mb-3">
          No contacts yet. Add one so Brief knows who to send quotes to.
        </p>
        <Show when={props.legacy_primary}>
          {(legacy) => (
            <button
              type="button"
              onClick={() => {
                setDraft({
                  name: legacy().name ?? '',
                  email: legacy().email ?? '',
                  phone: legacy().phone ?? '',
                  title: '',
                  is_primary: true,
                  always_notify: true,
                });
                setEditingId(null);
                setAdding(true);
              }}
              class="mb-3 w-full text-left rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface-2)] hover:border-[color:var(--color-accent)] px-3 py-2.5"
            >
              <div class="text-xs text-[color:var(--color-muted)] mb-0.5">Legacy primary contact on file</div>
              <div class="text-sm font-medium">
                {legacy().name ?? legacy().email ?? legacy().phone}
              </div>
              <div class="text-xs text-[color:var(--color-accent)] mt-1">Add as contact →</div>
            </button>
          )}
        </Show>
      </Show>

      <ul class="space-y-2.5">
        <For each={contacts()}>
          {(c) => (
            <li class="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] px-3 py-2.5 flex items-start gap-3 group">
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="font-medium text-sm">{c.name ?? '(no name)'}</span>
                  <Show when={c.title}>
                    <span class="text-xs text-[color:var(--color-muted)] italic font-serif">· {c.title}</span>
                  </Show>
                  <span class="flex-1" />
                  <Show when={c.is_primary}>
                    <Pill tone="accent" dot={false} size="sm">Primary</Pill>
                  </Show>
                  <Show when={c.always_notify}>
                    <Pill tone="good" dot={false} size="sm">Always notify</Pill>
                  </Show>
                </div>
                <div class="text-xs text-[color:var(--color-muted)] mt-1 space-y-0.5">
                  <Show when={c.email}>
                    <div>
                      <a class="hover:underline text-[color:var(--color-accent)]" href={`mailto:${c.email}`}>{c.email}</a>
                    </div>
                  </Show>
                  <Show when={c.phone}>
                    <div class="font-mono">{c.phone}</div>
                  </Show>
                </div>
              </div>
              <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(c)}
                  class="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] px-2 py-1"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(c)}
                  class="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] px-2 py-1"
                >
                  Remove
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>

      <Show
        when={adding()}
        fallback={
          <button
            type="button"
            onClick={openAdd}
            class="mt-3 text-sm text-[color:var(--color-accent)] hover:brightness-95 inline-flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            Add contact
          </button>
        }
      >
        <div class="mt-3 rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface)] p-3.5">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-2">
            {editingId() ? 'Edit contact' : 'New contact'}
          </div>
          <div class="grid grid-cols-2 gap-2.5">
            <Field label="Name">
              <Input
                value={draft().name}
                onInput={(e) => setDraft({ ...draft(), name: e.currentTarget.value })}
              />
            </Field>
            <Field label="Title" helper="e.g. Owner, PM, AP">
              <Input
                value={draft().title}
                onInput={(e) => setDraft({ ...draft(), title: e.currentTarget.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={draft().email}
                onInput={(e) => setDraft({ ...draft(), email: e.currentTarget.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={draft().phone}
                onInput={(e) => setDraft({ ...draft(), phone: e.currentTarget.value })}
              />
            </Field>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft().is_primary}
                onChange={(e) => setDraft({ ...draft(), is_primary: e.currentTarget.checked })}
                class="accent-[color:var(--color-accent)]"
              />
              <span>Primary</span>
            </label>
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft().always_notify}
                onChange={(e) => setDraft({ ...draft(), always_notify: e.currentTarget.checked })}
                class="accent-[color:var(--color-accent)]"
              />
              <span>Always notify on quotes</span>
            </label>
          </div>
          <Show when={error()}>
            <div class="mt-2 text-xs text-[color:var(--color-danger)]">{error()}</div>
          </Show>
          <div class="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={cancel}>Cancel</Button>
            <Button variant="accent" disabled={busy()} onClick={submit}>
              {busy() ? 'Saving…' : editingId() ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}
