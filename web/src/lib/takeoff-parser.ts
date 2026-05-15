/**
 * Takeoff parser — normalizes line items extracted from quantity
 * surveys. Phase 5.
 *
 * Generic Intake extraction handles the basics (description + qty +
 * unit + unit_price). Takeoffs have construction-specific quirks the
 * base prompt doesn't fully tame:
 *
 *   1. Unit aliases — sf/sqft/SF/sq ft → 'sqft'; lf/LF/ln ft → 'lf';
 *      cy/CY/cu yd → 'cy'; each/ea/EA → 'each'.
 *   2. Inline dimensions — "12'-6" × 8'" or "12x16" tables need the
 *      area computed and surfaced as qty.
 *   3. Section headers — takeoffs are usually grouped by trade
 *      (Foundation, Framing, Drywall, Painting). When we can detect
 *      a header, propagate it as the category for following rows.
 *
 * This module runs as a post-processor on IntakeExtract.line_items
 * for documents classified as `takeoff`. Cheap pure-text math, no
 * LLM call.
 */

import type { LineItem } from './intake-agent';

const UNIT_ALIASES: Record<string, string> = {
  // length
  'lf': 'lf', 'l.f.': 'lf', 'l f': 'lf', 'lnft': 'lf', 'ln ft': 'lf', 'ln-ft': 'lf', 'lin ft': 'lf', 'linear feet': 'lf', 'linear foot': 'lf',
  // area
  'sf': 'sqft', 'sqft': 'sqft', 'sq.ft.': 'sqft', 'sq ft': 'sqft', 's.f.': 'sqft', 'square feet': 'sqft', 'square foot': 'sqft',
  // volume
  'cy': 'cy', 'cu yd': 'cy', 'cu. yd.': 'cy', 'cuyd': 'cy', 'cubic yard': 'cy', 'cubic yards': 'cy',
  // discrete
  'ea': 'each', 'each': 'each', 'pc': 'each', 'pcs': 'each', 'pieces': 'each',
  // time
  'hr': 'hr', 'hour': 'hr', 'hours': 'hr', 'hrs': 'hr',
  'day': 'day', 'days': 'day',
  // lump
  'ls': 'lump_sum', 'lump sum': 'lump_sum', 'lump-sum': 'lump_sum', 'lumpsum': 'lump_sum',
};

export function normalizeUnit(raw: string | null | undefined): string {
  if (!raw) return 'each';
  const k = raw.toLowerCase().trim();
  return UNIT_ALIASES[k] ?? k;
}

/** Recognize section-header rows. Header rows have no qty + no
 * unit_price, and the description matches a trade keyword. Returns
 * the normalized trade name or null. */
const TRADE_HEADERS = [
  'foundation', 'concrete', 'framing', 'roofing', 'siding', 'windows', 'doors',
  'insulation', 'drywall', 'painting', 'flooring', 'tile', 'cabinets',
  'countertops', 'plumbing', 'electrical', 'hvac', 'finishes', 'exterior',
  'interior', 'site work', 'excavation', 'landscaping', 'masonry',
  'stucco', 'eifs',
];

export function detectSectionHeader(li: {
  description: string;
  qty: number;
  unit_price: number;
}): string | null {
  if ((li.qty ?? 0) > 0 && (li.unit_price ?? 0) > 0) return null;
  const haystack = li.description.toLowerCase().trim();
  for (const trade of TRADE_HEADERS) {
    if (haystack === trade || haystack.startsWith(`${trade}:`) || haystack.startsWith(`${trade} -`)) {
      return trade;
    }
  }
  return null;
}

/** Parse a dimension string out of a description. Returns area in
 * sqft when both dimensions are present. Handles:
 *   "12'-6\" x 8'"   → 100
 *   "12' x 16'"      → 192
 *   "12x16"          → 192  (assumes feet)
 *   "12×16"          → 192  (en dash multiplier)
 *
 * Returns null if no parseable dimension found.
 */
const DIM_RE = /(\d+)'?(?:[-\s]*(\d+)\s*")?\s*[x×]\s*(\d+)'?(?:[-\s]*(\d+)\s*")?/i;

export function extractAreaSqft(description: string): number | null {
  const m = description.match(DIM_RE);
  if (!m) return null;
  const w = parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 12 : 0);
  const h = parseInt(m[3], 10) + (m[4] ? parseInt(m[4], 10) / 12 : 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return Math.round(w * h * 100) / 100;
}

/** Main entry: normalize a list of line items extracted from a
 * takeoff document. Returns a filtered + tagged list (section
 * headers stripped, qty/unit normalized, categories propagated). */
export function normalizeTakeoffItems(items: LineItem[]): LineItem[] {
  const out: LineItem[] = [];
  let currentCategory: string | null = null;

  for (const li of items) {
    if (!li || !li.description) continue;

    const header = detectSectionHeader({
      description: li.description,
      qty: Number(li.qty ?? 0),
      unit_price: Number(li.unit_price ?? 0),
    });
    if (header) {
      currentCategory = header;
      continue; // drop the header row itself
    }

    const unit = normalizeUnit(li.unit);
    let qty = Number(li.qty ?? 0);

    // If qty is missing or unit is sqft and the description has
    // dimensions, try to recover qty from the dimensions.
    if ((qty <= 0 || unit === 'sqft') && qty <= 0) {
      const area = extractAreaSqft(li.description);
      if (area != null) {
        qty = area;
      }
    }

    const unitPrice = Number(li.unit_price ?? 0);
    out.push({
      description: li.description,
      qty,
      unit,
      unit_price: unitPrice,
      category: (li.category || currentCategory) ?? 'other',
      confidence: li.confidence ?? 'med',
      source_excerpt: li.source_excerpt,
    });
  }

  return out;
}
