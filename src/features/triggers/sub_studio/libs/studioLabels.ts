/**
 * studioLabels — shared label resolvers for Chain Studio surfaces. Kept out of
 * the components so the baseline switchboard and the deep-merge ledger variants
 * resolve the same condition tokens identically.
 */
import { useTranslation } from '@/i18n/useTranslation';
import type { LinkCondition } from './studioDraftModel';

type T = ReturnType<typeof useTranslation>['t'];

export function conditionLabel(t: T, condition: LinkCondition): string {
  switch (condition) {
    case 'on_success': return t.triggers.studio.condition_on_success;
    case 'on_failure': return t.triggers.studio.condition_on_failure;
    case 'output_match': return t.triggers.studio.condition_output_match;
    default: return t.triggers.studio.condition_always;
  }
}
