/**
 * <DataTable> — uniform table primitive for /quotes, /jobs, /clients.
 *
 * Header chrome renders immediately; rows are either provided (`rows`) or
 * a skeleton (when `loading`). `emptyState` slot overrides the default
 * <EmptyState variant="table" /> fallback.
 *
 * Column `render` is the escape hatch — falls back to `String(row[key])`
 * if absent. `mono` toggles tabular-nums for numeric columns.
 */
import { For, Show, type JSX, type Component } from 'solid-js';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  width?: string;
  mono?: boolean;
  render?: (row: T) => JSX.Element;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyState?: JSX.Element;
}

function DataTable<T>(props: DataTableProps<T>) {
  return (
    <div class="overflow-x-auto rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)]">
      <table class="w-full border-collapse">
        <thead class="bg-[color:var(--color-surface-2)]">
          <tr>
            <For each={props.columns}>
              {(col) => (
                <th
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  class={[
                    'px-3.5 py-3 text-[10.5px] font-mono font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted)]',
                    'border-b border-[color:var(--color-line)]',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  ].join(' ')}
                >
                  {col.header}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show when={props.loading} fallback={
            <Show when={props.rows.length > 0} fallback={
              <tr>
                <td colSpan={props.columns.length}>
                  {props.emptyState ?? <DefaultEmpty />}
                </td>
              </tr>
            }>
              <For each={props.rows}>
                {(row) => (
                  <tr
                    onClick={props.onRowClick ? () => props.onRowClick!(row) : undefined}
                    tabindex={props.onRowClick ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!props.onRowClick) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        props.onRowClick(row);
                      }
                    }}
                    class={[
                      'border-b border-[color:var(--color-line)] last:border-b-0',
                      props.onRowClick ? 'cursor-pointer hover:bg-[color:var(--color-surface-2)] transition-colors' : '',
                    ].join(' ')}
                  >
                    <For each={props.columns}>
                      {(col) => (
                        <td
                          class={[
                            'px-3.5 py-3 align-middle text-[13.5px] text-[color:var(--color-ink)]',
                            col.align === 'right' ? 'text-right' : 'text-left',
                            col.mono ? 'font-mono tabular-nums' : '',
                          ].join(' ')}
                        >
                          {col.render ? col.render(row) : String((row as any)[col.key] ?? '—')}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </Show>
          }>
            {/* Loading: 6 skeleton rows */}
            <For each={Array.from({ length: 6 })}>
              {() => (
                <tr class="border-b border-[color:var(--color-line)] last:border-b-0">
                  <For each={props.columns}>
                    {() => (
                      <td class="px-3.5 py-3">
                        <span class="block h-3 rounded bg-[color:var(--color-bg-2)] animate-pulse" />
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </Show>
        </tbody>
      </table>
    </div>
  );
}

const DefaultEmpty: Component = () => (
  <div class="py-10 text-center text-sm italic text-[color:var(--color-muted)] font-serif">
    Nothing here yet.
  </div>
);

export default DataTable;
