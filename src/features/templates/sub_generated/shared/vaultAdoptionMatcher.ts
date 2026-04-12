import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

/**
 * Match adoption questions against the user's credential vault.
 *
 * For questions with `vault_category` + `option_service_types`, checks
 * how many options have a matching credential in the vault:
 * - 1 match  → auto-select that option, mark as auto-detected
 * - 0 or 2+  → leave for the user to answer
 */
export function matchVaultToQuestions(
  questions: TransformQuestionResponse[],
  credentialServiceTypes: Set<string>,
): {
  autoAnswers: Record<string, string>;
  autoDetectedIds: Set<string>;
} {
  const autoAnswers: Record<string, string> = {};
  const autoDetectedIds = new Set<string>();

  for (const q of questions) {
    if (!q.vault_category || !q.option_service_types || !q.options) continue;
    if (q.option_service_types.length !== q.options.length) continue;

    // Find which options have a matching credential in the vault
    const matchingIndices: number[] = [];
    for (let i = 0; i < q.option_service_types.length; i++) {
      const st = q.option_service_types[i];
      if (st && credentialServiceTypes.has(st)) {
        matchingIndices.push(i);
      }
    }

    // Exactly 1 match → auto-select
    if (matchingIndices.length === 1) {
      autoAnswers[q.id] = q.options[matchingIndices[0]!]!;
      autoDetectedIds.add(q.id);
    }
  }

  return { autoAnswers, autoDetectedIds };
}
