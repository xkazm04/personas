import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

/**
 * Match adoption questions against the user's credential vault.
 *
 * For questions with `vault_category` + `option_service_types`, checks
 * how many options have a matching credential in the vault:
 * - 1 match  → auto-select that option, mark as auto-detected
 * - 0 matches → BLOCK the question (user must add a credential via the catalog)
 * - 2+ matches → leave for the user to answer
 *
 * Questions without `vault_category` or `option_service_types` are ignored.
 */
export function matchVaultToQuestions(
  questions: TransformQuestionResponse[],
  credentialServiceTypes: Set<string>,
): {
  autoAnswers: Record<string, string>;
  autoDetectedIds: Set<string>;
  blockedQuestionIds: Set<string>;
} {
  const autoAnswers: Record<string, string> = {};
  const autoDetectedIds = new Set<string>();
  const blockedQuestionIds = new Set<string>();

  for (const q of questions) {
    if (!q.vault_category || !q.option_service_types || !q.options) continue;
    if (q.option_service_types.length !== q.options.length) continue;

    // Find which options have a matching credential in the vault
    const matchingIndices: number[] = [];
    let hasNullFallback = false;
    for (let i = 0; i < q.option_service_types.length; i++) {
      const st = q.option_service_types[i];
      if (st === null) {
        hasNullFallback = true;
        continue;
      }
      if (st && credentialServiceTypes.has(st)) {
        matchingIndices.push(i);
      }
    }

    if (matchingIndices.length === 1) {
      // Exactly 1 match → auto-select
      autoAnswers[q.id] = q.options[matchingIndices[0]!]!;
      autoDetectedIds.add(q.id);
    } else if (matchingIndices.length === 0 && !hasNullFallback) {
      // No matching credentials and no "Other" fallback → block the question
      blockedQuestionIds.add(q.id);
    }
    // 2+ matches → user must choose, no auto-answer
  }

  return { autoAnswers, autoDetectedIds, blockedQuestionIds };
}
