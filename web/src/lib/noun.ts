/**
 * Render variants of a shop's `business_noun` (default "shop") for
 * inline use in copy. Operator sets the singular lowercase form
 * ("shop", "agency", "studio", "practice", "firm") in Settings; this
 * helper produces title-case, possessive, and capitalized forms so
 * the calling site doesn't have to roll its own.
 *
 * Examples:
 *   noun('shop')                       → 'shop'
 *   noun('agency', { case: 'Title' })  → 'Agency'
 *   noun('agency', { possessive: true })   → "agency's"
 *   noun('shop',  { case: 'Title', possessive: true }) → "Shop's"
 */
export function noun(
  raw: string | null | undefined,
  opts: { case?: 'lower' | 'Title'; possessive?: boolean } = {},
): string {
  const base = (raw ?? 'shop').trim().toLowerCase() || 'shop';
  const cased = opts.case === 'Title' ? titleCase(base) : base;
  return opts.possessive ? `${cased}'s` : cased;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
