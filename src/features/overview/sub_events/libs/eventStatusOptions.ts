import type { PersonaEventStatus } from '@/lib/bindings/PersonaEventStatus';
import type { Translations } from '@/i18n/en';
import { tokenLabel } from '@/i18n/tokenMaps';

/**
 * Status values the Events tab filter offers, in display order. Every entry
 * must be a real `PersonaEventStatus` (the backend writes no "processed").
 */
export const EVENT_STATUS_FILTER_VALUES = [
  'pending',
  'processing',
  'delivered',
  'completed',
  'skipped',
  'failed',
  'dead_letter',
  'discarded',
] as const satisfies readonly PersonaEventStatus[];

export function eventStatusOptions(t: Translations, allLabel: string) {
  const label = (status: (typeof EVENT_STATUS_FILTER_VALUES)[number]): string => {
    switch (status) {
      case 'delivered': return tokenLabel(t, 'delivery', 'delivered');
      case 'completed': return tokenLabel(t, 'execution', 'completed');
      default: return tokenLabel(t, 'event', status);
    }
  };
  return [
    { value: 'all', label: allLabel },
    ...EVENT_STATUS_FILTER_VALUES.map((value) => ({ value, label: label(value) })),
  ];
}
