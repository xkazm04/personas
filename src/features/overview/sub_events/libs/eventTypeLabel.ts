import type { Translations } from '@/i18n/en';

/**
 * Human-readable, translated label for a bus event type.
 *
 * Most `persona_events.event_type` values are free-form technical identifiers
 * emitted by the fleet (recipe/LLM contracts) and render raw — translating them
 * would be wrong. Only the small set of code-owned reliability events carry a
 * curated, translated label here. Unknown types fall back to the raw identifier,
 * preserving prior events-feed behavior.
 */
export function eventTypeLabel(t: Translations, eventType: string): string {
  const labels = t.overview.events.type_labels;
  switch (eventType) {
    case 'sla.breach.opened':
      return labels.sla_breach_opened;
    case 'sla.breach.recovered':
      return labels.sla_breach_recovered;
    default:
      return eventType;
  }
}
