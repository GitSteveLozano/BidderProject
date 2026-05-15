/**
 * <MultiUpload> — drag-drop or click-to-pick for the project intake flow.
 *
 * Accepts a folder (webkitdirectory) or multiple files. For each
 * file:
 *   1. POST /api/project/intake — extracts text, classifies,
 *      persists as an unattached intake_documents row, returns
 *      project matches.
 *   2. Streams results into the UI as each file completes.
 *   3. After all files settle, groups them: files that matched the
 *      same project go to that project; files whose top match is
 *      another file in this batch get a proposed new project.
 *
 * Output: a confirmation card per group, with the operator able to
 * accept/rename. Confirming POSTs /api/project (if new) +
 * /api/project/[id]/attach.
 */
import { createSignal, For, Show } from 'solid-js';

interface ProjectMatch {
  id: string;
  name: string;
  address: string | null;
  status: string;
  distance: number;
}

interface IntakeResult {
  document_id: string | null;
  filename: string | null;
  classification: string;
  direction: 'outbound' | 'inbound' | 'operator_own';
  confidence: number;
  extracted: {
    scope_summary: string;
    client_hints: {
      client_name: string | null;
      contact_name: string | null;
      project_title: string | null;
      project_address: string | null;
    };
    line_items_count: number;
  };
  matches: ProjectMatch[];
  suggested_project: {
    name: string;
    address: string | null;
    client_name_hint: string | null;
  } | null;
}

interface FileEntry {
  file: File;
  status: 'queued' | 'uploading' | 'done' | 'error';
  result?: IntakeResult;
  error?: string;
}

interface Group {
  kind: 'existing' | 'new';
  project_id?: string;
  name: string;
  address: string | null;
  document_ids: string[];
  files: FileEntry[];
  attaching?: boolean;
  attached?: boolean;
  attach_error?: string;
}

export default function MultiUpload(props: { onComplete?: () => void }) {
  const [files, setFiles] = createSignal<FileEntry[]>([]);
  const [phase, setPhase] = createSignal<'idle' | 'uploading' | 'grouping' | 'confirming' | 'done'>('idle');
  const [groups, setGroups] = createSignal<Group[]>([]);
  let inputRef: HTMLInputElement | undefined;

  const onPick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const next: FileEntry[] = Array.from(list)
      .filter((f) => /\.(pdf|png|jpe?g|webp)$/i.test(f.name))
      .map((f) => ({ file: f, status: 'queued' as const }));
    if (next.length === 0) {
      setFiles([{ file: list[0], status: 'error', error: 'No PDFs or images selected' }]);
      return;
    }
    setFiles(next);
    void runBatch(next);
  };

  const runBatch = async (entries: FileEntry[]) => {
    setPhase('uploading');
    const updated: FileEntry[] = entries.slice();
    for (let i = 0; i < updated.length; i += 1) {
      updated[i] = { ...updated[i], status: 'uploading' };
      setFiles(updated.slice());
      try {
        const fd = new FormData();
        fd.append('file', updated[i].file);
        const resp = await fetch('/api/project/intake', { method: 'POST', body: fd });
        const data = (await resp.json()) as IntakeResult & { error?: string };
        if (!resp.ok || (data as any).error) {
          throw new Error(data.error ?? `HTTP ${resp.status}`);
        }
        updated[i] = { ...updated[i], status: 'done', result: data };
      } catch (e) {
        updated[i] = { ...updated[i], status: 'error', error: e instanceof Error ? e.message : String(e) };
      }
      setFiles(updated.slice());
    }
    setPhase('grouping');
    setGroups(buildGroups(updated));
    setPhase('confirming');
  };

  const acceptGroup = async (gi: number) => {
    const g = groups()[gi];
    if (!g) return;
    const next = groups().slice();
    next[gi] = { ...g, attaching: true, attach_error: undefined };
    setGroups(next);
    try {
      let projectId = g.project_id;
      if (g.kind === 'new') {
        const createResp = await fetch('/api/project', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: g.name, address: g.address }),
        });
        if (!createResp.ok) throw new Error(await createResp.text());
        const { project } = (await createResp.json()) as { project: { id: string } };
        projectId = project.id;
      }
      if (!projectId) throw new Error('No project id');
      const attachResp = await fetch(`/api/project/${projectId}/attach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document_ids: g.document_ids }),
      });
      if (!attachResp.ok) throw new Error(await attachResp.text());
      next[gi] = { ...g, attaching: false, attached: true, project_id: projectId };
      setGroups(next);
      // If every group is attached, signal completion.
      if (next.every((x) => x.attached)) {
        setPhase('done');
        props.onComplete?.();
      }
    } catch (e) {
      next[gi] = { ...g, attaching: false, attach_error: e instanceof Error ? e.message : String(e) };
      setGroups(next);
    }
  };

  const renameGroup = (gi: number, name: string) => {
    const next = groups().slice();
    next[gi] = { ...next[gi], name };
    setGroups(next);
  };

  return (
    <div class="space-y-4">
      <Show
        when={phase() === 'idle'}
        fallback={null}
      >
        <label
          class="block rounded-xl border-2 border-dashed border-[color:var(--color-line-2)] bg-[color:var(--color-surface-2)] hover:border-[color:var(--color-accent)] px-8 py-10 cursor-pointer text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPick(e.dataTransfer?.files ?? null);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            class="sr-only"
            onChange={(e) => onPick(e.currentTarget.files)}
          />
          <svg width="28" height="28" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" class="mx-auto text-[color:var(--color-muted)]" aria-hidden="true">
            <path d="M11 16V6M6 11l5-5 5 5" />
            <path d="M3 18h16" />
          </svg>
          <div class="mt-3 text-[15px] font-medium">Drop a folder or pick PDFs and images</div>
          <div class="mt-1 text-[12.5px] text-[color:var(--color-muted)]">
            Brief reads each one — PDFs through the text classifier, images through vision — and groups related files into projects.
          </div>
        </label>
      </Show>

      <Show when={phase() === 'uploading' || phase() === 'grouping'}>
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
            {phase() === 'uploading' ? 'Reading docs…' : 'Grouping by project…'}
          </div>
          <ul class="mt-3 space-y-2">
            <For each={files()}>
              {(f) => (
                <li class="flex items-center gap-3 text-[13px]">
                  <span class="w-2 h-2 rounded-full shrink-0" classList={{
                    'bg-[color:var(--color-muted-2)]': f.status === 'queued',
                    'bg-[color:var(--color-accent)] animate-pulse': f.status === 'uploading',
                    'bg-[color:var(--color-good)]': f.status === 'done',
                    'bg-[color:var(--color-danger)]': f.status === 'error',
                  }} />
                  <span class="flex-1 truncate font-mono text-[12px]">{f.file.name}</span>
                  <span class="text-[11px] font-mono text-[color:var(--color-muted-2)]">
                    {f.status === 'done' && f.result
                      ? `${f.result.classification.replace(/_/g, ' ')} · ${f.result.direction}`
                      : f.status === 'error'
                        ? f.error?.slice(0, 60)
                        : f.status}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={(phase() === 'confirming' || phase() === 'done') && groups().length > 0}>
        <div class="space-y-3">
          <For each={groups()}>
            {(g, gi) => (
              <div
                class="rounded-xl border bg-[color:var(--color-surface)] p-5"
                classList={{
                  'border-[color:var(--color-good,#3a7d44)] bg-[color:var(--color-good-tint,#e6f0e7)]': g.attached,
                  'border-[color:var(--color-line)]': !g.attached,
                }}
              >
                <div class="flex items-baseline justify-between gap-3">
                  <div>
                    <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
                      {g.kind === 'existing' ? 'Matches existing project' : 'New project'}
                    </div>
                    <Show
                      when={!g.attached}
                      fallback={
                        <h3 class="mt-1 font-serif text-[18px] font-medium">{g.name}</h3>
                      }
                    >
                      <input
                        class="mt-1 font-serif text-[18px] font-medium bg-transparent border-0 outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1 w-full"
                        value={g.name}
                        onInput={(e) => renameGroup(gi(), e.currentTarget.value)}
                      />
                    </Show>
                    <Show when={g.address}>
                      <div class="text-[12.5px] font-mono text-[color:var(--color-muted)] mt-0.5">{g.address}</div>
                    </Show>
                  </div>
                  <span class="text-[11px] font-mono text-[color:var(--color-muted-2)] shrink-0">
                    {g.files.length} doc{g.files.length === 1 ? '' : 's'}
                  </span>
                </div>

                <ul class="mt-3 space-y-1 text-[12.5px]">
                  <For each={g.files}>
                    {(f) => (
                      <li class="flex items-center gap-2 font-mono text-[color:var(--color-ink-2)]">
                        <span class="w-1 h-1 rounded-full bg-[color:var(--color-muted-2)]" />
                        <span class="truncate flex-1">{f.file.name}</span>
                        <Show when={f.result}>
                          <span class="text-[10.5px] text-[color:var(--color-muted-2)]">
                            {f.result!.classification.replace(/_/g, ' ')}
                          </span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>

                <Show when={!g.attached}>
                  <div class="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => acceptGroup(gi())}
                      disabled={g.attaching}
                      class="font-mono text-[11.5px] uppercase tracking-wide border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-surface)] px-3 py-1.5 rounded-sm disabled:opacity-50"
                    >
                      {g.attaching ? 'Attaching…' : g.kind === 'existing' ? 'Attach to this project' : 'Create + attach'}
                    </button>
                  </div>
                </Show>
                <Show when={g.attached && g.project_id}>
                  <a
                    href={`/projects/${g.project_id}`}
                    class="mt-3 inline-block font-mono text-[11.5px] uppercase tracking-wide text-[color:var(--color-good,#3a7d44)] hover:text-[color:var(--color-ink)]"
                  >
                    Open project →
                  </a>
                </Show>
                <Show when={g.attach_error}>
                  <div class="mt-2 text-[12px] text-[color:var(--color-danger)]">{g.attach_error}</div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Pure grouping logic. Files matched to the same existing project
 * cluster together. Files with no match get their own "new project"
 * group keyed by the suggested project name + address. */
function buildGroups(entries: FileEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const f of entries) {
    if (f.status !== 'done' || !f.result || !f.result.document_id) continue;
    const r = f.result;
    const docId = r.document_id as string;
    if (r.matches.length > 0) {
      const m = r.matches[0];
      const key = `existing:${m.id}`;
      const g = groups.get(key) ?? {
        kind: 'existing' as const,
        project_id: m.id,
        name: m.name,
        address: m.address,
        document_ids: [],
        files: [],
      };
      g.document_ids.push(docId);
      g.files.push(f);
      groups.set(key, g);
    } else if (r.suggested_project) {
      const key = `new:${(r.suggested_project.address ?? r.suggested_project.name).toLowerCase()}`;
      const g = groups.get(key) ?? {
        kind: 'new' as const,
        name: r.suggested_project.name,
        address: r.suggested_project.address,
        document_ids: [],
        files: [],
      };
      g.document_ids.push(docId);
      g.files.push(f);
      groups.set(key, g);
    }
  }
  return Array.from(groups.values());
}
