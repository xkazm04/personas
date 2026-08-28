/**
 * Canonical questionnaire category order.
 *
 * ONE consumer today: `ChronologyAdoptionView` (`:37` imports
 * `categoryOrderIndex`; `:829` sorts `filteredAdoptionQuestions` with it).
 * That one sorted array is then handed to `PersonaLayoutAdoption` (`:1456`),
 * which is what renders BOTH surfaces the drift was about — the questionnaire's
 * stepper/story thread and the preview sidebar's buckets. Sorting once, here,
 * is therefore what prevents the "questionnaire says step 1/6 Configuration but
 * the preview sidebar's first bucket is Domain" drift found during the Visual
 * Brand Asset Factory live test.
 *
 * (This comment previously named a second consumer, `QuestionnaireFormFocus`,
 * that has never existed anywhere in the tree. Any new surface that buckets or
 * orders adoption questions must sort through this constant rather than
 * re-listing the categories.)
 *
 * Buckets with an unknown category sort after every listed category (index
 * 999) so authored order is preserved for untagged questions.
 */
export const QUESTIONNAIRE_CATEGORY_ORDER: readonly string[] = [
  'credentials',
  'configuration',
  'domain',
  'human_in_the_loop',
  'quality',
  'memory',
  'notifications',
  'boundaries',
] as const;

/** Returns a sort index for `category`, or 999 for unknown categories. */
export function categoryOrderIndex(category: string | null | undefined): number {
  if (!category) return 999;
  const idx = QUESTIONNAIRE_CATEGORY_ORDER.indexOf(category);
  return idx === -1 ? 999 : idx;
}

/** Stable compare: by canonical category order, unknown categories last. */
export function compareByCategoryOrder(a: string | null | undefined, b: string | null | undefined): number {
  return categoryOrderIndex(a) - categoryOrderIndex(b);
}
