/**
 * Proposal "shape" abstraction — the 5th path in the wizard.
 *
 * A Shape is a named list of typed Sections. The wizard renders them
 * via a generic FreeformEditor, the PDF render walks them top-to-
 * bottom, and the save endpoint persists them as the quote's
 * sections_data jsonb.
 *
 * Shape kinds are deliberately few in v1 — three covers the long
 * tail of proposal docs we've seen (text paragraphs, bullet lists,
 * key/value tables for rebate-style data). New kinds get added here
 * when we hit a doc that doesn't fit any of them.
 */

export type SectionKind = 'text' | 'bullets' | 'kv_table';

export interface TextSection {
  kind: 'text';
  key: string;
  label: string;
  body: string;
}

export interface BulletsSection {
  kind: 'bullets';
  key: string;
  label: string;
  items: string[];
}

export interface KvTableSection {
  kind: 'kv_table';
  key: string;
  label: string;
  headers: [string, string] | [string, string, string];
  rows: Array<Record<string, string>>;
}

export type Section = TextSection | BulletsSection | KvTableSection;

export interface Shape {
  name: string;
  description: string;
  sections: Section[];
  /** Most novel shapes don't require a money total. Used by the
   * Pricing-step gate so the wizard doesn't force a fake price. */
  total_required: boolean;
}

const VALID_KINDS: SectionKind[] = ['text', 'bullets', 'kv_table'];

/** Coerce a possibly-untrusted JSON blob into a valid Shape. Drops
 * malformed sections rather than throwing — the operator can still
 * use whatever survived. */
export function normalizeShape(raw: unknown): Shape | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  const description = typeof r.description === 'string' ? r.description.trim() : '';
  if (!name) return null;

  const sections: Section[] = Array.isArray(r.sections)
    ? r.sections.map(normalizeSection).filter((s): s is Section => s != null)
    : [];

  return {
    name,
    description,
    sections,
    total_required: r.total_required === true,
  };
}

function normalizeSection(raw: unknown): Section | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = typeof r.kind === 'string' ? r.kind : null;
  if (!kind || !VALID_KINDS.includes(kind as SectionKind)) return null;
  const key = typeof r.key === 'string' && r.key.trim() ? r.key.trim() : null;
  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : null;
  if (!key || !label) return null;

  switch (kind) {
    case 'text':
      return {
        kind: 'text',
        key,
        label,
        body: typeof r.body === 'string' ? r.body : '',
      };
    case 'bullets':
      return {
        kind: 'bullets',
        key,
        label,
        items: Array.isArray(r.items)
          ? r.items.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
          : [],
      };
    case 'kv_table': {
      const headers = Array.isArray(r.headers)
        ? r.headers.filter((h): h is string => typeof h === 'string').slice(0, 3)
        : [];
      if (headers.length < 2) return null;
      const rows: Array<Record<string, string>> = Array.isArray(r.rows)
        ? r.rows
            .map((row) => {
              if (!row || typeof row !== 'object') return null;
              const obj = row as Record<string, unknown>;
              const out: Record<string, string> = {};
              for (const h of headers) {
                out[h] = typeof obj[h] === 'string' ? (obj[h] as string) : '';
              }
              return out;
            })
            .filter((row): row is Record<string, string> => row != null)
        : [];
      return {
        kind: 'kv_table',
        key,
        label,
        headers: headers as [string, string] | [string, string, string],
        rows,
      };
    }
    default:
      return null;
  }
}

/** Plain-text representation of the shape for embedding. Captures
 * the proposal's "type" — its name, what it's for, and the section
 * structure — so embedding similarity surfaces near-duplicates. */
export function shapeToEmbeddingText(shape: Shape): string {
  const sectionList = shape.sections
    .map((s) => `${s.kind}/${s.label}`)
    .join(', ');
  return `${shape.name}. ${shape.description}. Sections: ${sectionList}.`;
}

/** Count populated sections (any section with non-empty content). */
export function countPopulated(sections: Section[]): number {
  return sections.filter((s) => {
    if (s.kind === 'text') return s.body.trim().length > 0;
    if (s.kind === 'bullets') return s.items.length > 0;
    if (s.kind === 'kv_table') return s.rows.length > 0;
    return false;
  }).length;
}
