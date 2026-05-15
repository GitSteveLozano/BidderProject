/**
 * Email thread parser — Phase 7. Splits a multi-message conversation
 * into individual messages, extracts participants, and infers the
 * topic shift across messages.
 *
 * Plain-text PDF extracts of an email thread typically look like:
 *
 *   From: kelsey@example.com
 *   Sent: Tuesday, January 14, 2026 9:32 AM
 *   To: stucco@example.com
 *   Subject: RE: Bartman elevations
 *
 *   Hey — the homeowner moved the deck rail location...
 *
 *   > On Mon, Jan 13, 2026 at 4:21 PM, Steve <stucco@example.com> wrote:
 *   > Sent over the revised elevations...
 *
 * The signal we need: per-message author + timestamp + body so Brief
 * can answer "what did Kelsey ask for that's not in the plans yet?"
 * Pure-text parsing — no LLM call.
 */

export interface EmailMessage {
  index: number;        // 0 = newest, 1 = previous, …
  author: string | null;
  author_email: string | null;
  sent_at: string | null;
  subject: string | null;
  body: string;
}

export interface EmailThreadParse {
  messages: EmailMessage[];
  participants: Array<{ name: string | null; email: string | null }>;
  message_count: number;
  has_attachments_hint: boolean;
}

const HEADER_PATTERNS = [
  // RFC-style: From: name <addr>
  /^From:\s*(.+?)$/im,
  /^Sent:\s*(.+?)$/im,
  /^Date:\s*(.+?)$/im,
  /^To:\s*(.+?)$/im,
  /^Cc:\s*(.+?)$/im,
  /^Subject:\s*(.+?)$/im,
];

const EMAIL_ADDR_RE = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;
const NAME_ADDR_RE = /^([^<]+?)\s*<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/i;

/** Find boundaries that start a new message inside the thread. */
function findMessageBoundaries(lines: string[]): number[] {
  const boundaries: number[] = [0];
  for (let i = 1; i < lines.length; i += 1) {
    const ln = lines[i].trim();
    // Outlook / Gmail-style "From:" or "On ... wrote:" markers.
    if (/^From:\s/i.test(ln)) {
      // Avoid mid-body "From the desk of" false-positives by requiring
      // the next few lines to look like an email header block.
      const look = lines.slice(i, i + 6).join('\n');
      if (
        /(?:Sent|Date):\s/i.test(look) ||
        /(?:To|Cc):\s/i.test(look) ||
        /Subject:\s/i.test(look)
      ) {
        boundaries.push(i);
      }
    } else if (/^On\s.+wrote:\s*$/i.test(ln)) {
      boundaries.push(i);
    } else if (/^-{3,}\s*Original Message\s*-{3,}/i.test(ln)) {
      boundaries.push(i + 1);
    } else if (/^_{5,}/.test(ln) && /From:\s/i.test(lines[i + 1] ?? '')) {
      boundaries.push(i + 1);
    }
  }
  return boundaries;
}

function parseHeader(block: string, pattern: RegExp): string | null {
  const m = block.match(pattern);
  return m ? m[1].trim() : null;
}

function parseAuthor(fromHeader: string | null): { name: string | null; email: string | null } {
  if (!fromHeader) return { name: null, email: null };
  const named = fromHeader.match(NAME_ADDR_RE);
  if (named) return { name: named[1].trim().replace(/^"|"$/g, ''), email: named[2].toLowerCase() };
  const bareEmail = fromHeader.match(EMAIL_ADDR_RE);
  if (bareEmail) return { name: null, email: bareEmail[1].toLowerCase() };
  return { name: fromHeader.trim(), email: null };
}

function stripQuotedPrefix(body: string): string {
  // Strip leading "> " quote lines from the body (those are the prior
  // message which we're parsing separately).
  return body
    .split('\n')
    .filter((ln) => !/^\s*>/.test(ln))
    .join('\n')
    .trim();
}

export function parseEmailThread(text: string): EmailThreadParse {
  if (!text || text.length < 40) {
    return { messages: [], participants: [], message_count: 0, has_attachments_hint: false };
  }
  const lines = text.split(/\r?\n/);
  const bounds = findMessageBoundaries(lines);
  bounds.push(lines.length); // sentinel

  const messages: EmailMessage[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const block = lines.slice(start, end).join('\n');
    if (block.trim().length < 20) continue;

    const headerEnd = block.search(/\n\s*\n/);
    const headerBlock = headerEnd > 0 ? block.slice(0, headerEnd) : block.slice(0, 400);
    const bodyBlock = headerEnd > 0 ? block.slice(headerEnd + 2) : block;

    const fromHdr = parseHeader(headerBlock, HEADER_PATTERNS[0]);
    const sentHdr =
      parseHeader(headerBlock, HEADER_PATTERNS[1]) ??
      parseHeader(headerBlock, HEADER_PATTERNS[2]);
    const subjHdr = parseHeader(headerBlock, HEADER_PATTERNS[5]);

    const { name, email } = parseAuthor(fromHdr);

    // "On ... wrote:" style — no full header block, just author line
    const onWroteMatch = block.match(/^On\s+(.+?),?\s+([^<]+?)\s*<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})?>?\s+wrote:/im);
    const inferredName = name ?? (onWroteMatch ? onWroteMatch[2]?.trim() : null);
    const inferredEmail = email ?? (onWroteMatch ? onWroteMatch[3]?.toLowerCase() : null);
    const inferredSent = sentHdr ?? (onWroteMatch ? onWroteMatch[1]?.trim() : null);

    messages.push({
      index: messages.length,
      author: inferredName,
      author_email: inferredEmail ?? null,
      sent_at: inferredSent,
      subject: subjHdr,
      body: stripQuotedPrefix(bodyBlock).slice(0, 4000),
    });
  }

  // Dedup participants by email-or-name.
  const seen = new Set<string>();
  const participants: Array<{ name: string | null; email: string | null }> = [];
  for (const m of messages) {
    const key = (m.author_email ?? m.author ?? '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    participants.push({ name: m.author, email: m.author_email });
  }

  const hasAttachmentsHint =
    /attachments?:\s|see attach|attached:/i.test(text);

  return {
    messages,
    participants,
    message_count: messages.length,
    has_attachments_hint: hasAttachmentsHint,
  };
}
