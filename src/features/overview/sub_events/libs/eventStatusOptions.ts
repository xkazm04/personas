import type { PersonaEventStatus } from '@/lib/bindings/PersonaEventStatus';
import type { Translations } from '@/i18n/en';
import { tokenLabel } from '@/i18n/tokenMaps';

/**
 * Status values the Events tab filter offers, in display order. Every entry
 * must be a real `PersonaEventStatus` (the backend writes no "processed").
 *
 * `dead_letter` and `discarded` are real statuses still missing from this list:
 * they need `status_tokens.event` labels in all 14 locales first.
 */
export const EVENT_STATUS_FILTER_VALUES = [
  'pending',
  'processing',
  'delivered',
  'completed',
  'skipped',
  'failed',
] as const satisfies readonly PersonaEventStatus[];

export function eventStatusOptions(t: Translations, allLabel: string) {
  const label = (status: (typeof EVENT_STATUS_FILTER_VALUES)[number]): string => {
    switch (status) {
      case 'delivered': return tokenLabel(t, 'delivery', 'delivered');
      case 'completed': return tokenLabel(t, 'execution', 'completed');
      // No status_tokens label exists yet (same English literal the list carried).
      case 'skipped': return 'Skipped';
      default: return tokenLabel(t, 'event', status);
    }
  };
  return [
    { value: 'all', label: allLabel },
    ...EVENT_STATUS_FILTER_VALUES.map((value) => ({ value, label: label(value) })),
  ];
}
