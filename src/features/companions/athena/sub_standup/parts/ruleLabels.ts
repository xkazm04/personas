import { useCallback } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRuleClass } from '@/lib/bindings/AwayRuleClass';

/** Every away-rule class, in the order the sheet lists them. */
export const RULE_CLASSES: readonly AwayRuleClass[] = [
  'scope', 'goals', 'dependency_bump', 'retune', 'create_agent', 'money', 'data', 'schema', 'secrets', 'push',
];

/** Classes the park check always holds for the operator (WP3's classifier parks them regardless). */
export const LOCKED_CLASSES: readonly AwayRuleClass[] = ['money', 'data', 'schema', 'secrets', 'push'];

export function useRuleLabels(): (k: AwayRuleClass) => string {
  const { t } = useTranslation();
  const labels = t.athena.standup.rules.classes;
  return useCallback((k: AwayRuleClass) => labels[k], [labels]);
}
