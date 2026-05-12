/**
 * <ProgressiveRender> — behavior wrapper around an SSE endpoint.
 *
 * Mirrors web/src/components/BidGenerator.tsx:82–101 — buffer reader
 * chunks, split on `\n\n`, JSON-parse each `data:` line, branch on
 * payload.type via the onEvent callback. Renders no chrome — the
 * parent controls the UI surface.
 *
 * Used by the Quote production AI scan (PR 4), Reply/Nudge drafters
 * (PR 5), voice analyze (PR 3).
 */
import { createEffect, onCleanup, type JSX } from 'solid-js';

export interface SSEEvent<T = unknown> {
  type: string;
  [k: string]: unknown;
  payload?: T;
}

interface ProgressiveRenderProps<T = unknown> {
  endpoint: string;
  body: Record<string, unknown>;
  /** True to actually start the fetch; flip false to abort. */
  active: boolean;
  onEvent: (event: SSEEvent<T>) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  children: JSX.Element;
}

function ProgressiveRender<T>(props: ProgressiveRenderProps<T>) {
  let controller: AbortController | null = null;

  createEffect(() => {
    if (!props.active) {
      controller?.abort();
      controller = null;
      return;
    }
    controller = new AbortController();
    const ac = controller;

    (async () => {
      try {
        const resp = await fetch(props.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(props.body),
          signal: ac.signal,
        });
        if (!resp.ok) {
          throw new Error(`Server returned ${resp.status}: ${await resp.text()}`);
        }
        if (!resp.body) throw new Error('No response body');

        const reader = resp.body.getReader();
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
            try {
              const payload = JSON.parse(dataLine.slice(6));
              props.onEvent(payload);
              if (payload.type === 'done') props.onDone?.();
            } catch (parseErr) {
              // Malformed SSE chunk — surface but don't kill the stream.
              console.error('[ProgressiveRender] malformed event', dataLine, parseErr);
            }
          }
        }
        props.onDone?.();
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        props.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });

  onCleanup(() => {
    controller?.abort();
    controller = null;
  });

  return <>{props.children}</>;
}

export default ProgressiveRender;
