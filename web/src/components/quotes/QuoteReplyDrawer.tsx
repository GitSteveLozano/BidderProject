/**
 * <QuoteReplyDrawer> — hash-driven wrapper around ReplyNudgeDrawer for
 * the /quotes/[id] page.
 *
 * Wires the dashboard's "Reply" / "Nudge" buttons (which navigate to
 * /quotes/{id}#reply or #nudge) and the quote page's own
 * "Send reminder" / "Reply to client" button (#reply) to actually
 * open the drawer.
 *
 * On mount + every hashchange:
 *   #reply → opens drawer in reply mode
 *   #nudge → opens drawer in nudge mode
 *   anything else → closed
 * On close, strips the fragment so a reload doesn't reopen.
 */
import { createSignal, onMount, onCleanup } from 'solid-js';

import ReplyNudgeDrawer from './ReplyNudgeDrawer';
import type { AgendaQuote } from '@/lib/quote-helpers';

interface Props {
  quote: AgendaQuote;
  /** Last inbound message, when present — feeds Reply mode's "client wrote" block. */
  inbound?: { sender: string; sent_at: string; body: string };
}

export default function QuoteReplyDrawer(props: Props) {
  const [mode, setMode] = createSignal<'reply' | 'nudge' | null>(null);

  const syncFromHash = () => {
    if (typeof window === 'undefined') return;
    const h = window.location.hash.replace(/^#/, '');
    if (h === 'reply' || h === 'nudge') {
      setMode(h);
    } else {
      setMode(null);
    }
  };

  const clearHash = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  };

  onMount(() => {
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    onCleanup(() => window.removeEventListener('hashchange', syncFromHash));
  });

  const onClose = () => {
    setMode(null);
    clearHash();
  };

  return (
    <ReplyNudgeDrawer
      open={mode() != null}
      onClose={onClose}
      mode={mode() ?? 'reply'}
      quote={props.quote}
      inbound={props.inbound}
    />
  );
}
