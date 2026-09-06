import type { Translations } from '@/i18n/en';

/**
 * Human-readable, translated label for a bus event type.
 *
 * The small set of code-owned reliability events carry a curated, translated
 * label. Everything else is a free-form technical identifier emitted by the
 * fleet (recipe/LLM contracts) — no display-name registry exists for those
 * (`EventVocabularyEntry` stores only type/category/source), so they are
 * humanized mechanically: separators become spaces and the first letter is
 * capitalized (`execution.retry_scheduled` → "Execution retry scheduled").
 * The raw identifier stays available via the cell's `title` tooltip.
 */
export function eventTypeLabel(t: Translations, eventType: string): string {
  const labels = t.overview.events.type_labels;
  switch (eventType) {
    case 'sla.breach.opened':
      return labels.sla_breach_opened;
    case 'sla.breach.recovered':
      return labels.sla_breach_recovered;
    case 'schedule.missed.offline':
      return labels.schedule_missed_offline;
    case 'schedule.skipped.overlap':
      return labels.schedule_skipped_overlap;
    case 'schedule.paused.failure_rate':
      return labels.schedule_paused_failure_rate;
    case 'team.channel.leader_verdict':
      return labels.team_channel_leader_verdict;
    default:
      return humanizeEventType(eventType);
  }
}

/**
 * Mechanical display form of a technical event-type identifier: `.`, `_`, `-`
 * and `:` become spaces, runs of whitespace collapse, and the first character
 * is uppercased. Purely typographic — never translated, so free-form fleet
 * identifiers keep their meaning verbatim.
 */
export function humanizeEventType(eventType: string): string {
  const spaced = eventType.replace(/[._:-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return eventType;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
