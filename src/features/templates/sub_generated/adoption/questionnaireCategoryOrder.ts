/**
 * Canonical questionnaire category order.
 *
 * Shared by the adoption flow's sort (MatrixAdoptionView → filteredAdoptionQuestions)
 * and the Live Preview sidebar bucket walk (QuestionnaireFormFocus). Keeping
 * both surfaces on this one constant prevents the "questionnaire says step 1/6
 * Configuration but the preview sidebar's first bucket is Domain" drift that
 * surfaced during the Visual Brand Asset Factory live test.
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
