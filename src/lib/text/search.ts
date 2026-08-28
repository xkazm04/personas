// Locale-aware text matching for user-typed queries.
//
// WHY THIS EXISTS: the app ships 14 locales and orders strings with
// `localeCompare` at ~180 sites, but every substring MATCH was written inline as
// `haystack.toLowerCase().includes(needle)`. That fails two ways the ordering
// path already handles: `toLowerCase` is locale-insensitive (Turkish dotted and
// dotless I fold wrongly), and unnormalized input means a user typing "resume"
// never matches "resume" spelled with accents, because the accented form is a
// different code-point sequence.
//
// Folding is defined ONCE here so the matching policy (case folding, diacritics,
// whitespace, multi-term) is a property of the app rather than of whichever call
// site was written last.

/** Case- and diacritic-folded form of `value`, for comparison only. */
export function foldForSearch(value: string, locale?: string): string {
  return value
    .normalize('NFD')
    // Strip combining marks (U+0300-U+036F): "e"+U+0301 folds to "e".
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase(locale)
    .trim();
}

/**
 * True when every whitespace-separated term in `query` appears in `haystack`.
 *
 * Multi-term is deliberate: a user typing two words means "both", and an
 * `includes` of the raw query silently requires them adjacent and in order.
 * An empty or whitespace-only query matches everything - the caller decides
 * whether to run the filter at all.
 */
export function matchesQuery(haystack: string, query: string, locale?: string): boolean {
  const terms = foldForSearch(query, locale).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = foldForSearch(haystack, locale);
  return terms.every((term) => hay.includes(term));
}
