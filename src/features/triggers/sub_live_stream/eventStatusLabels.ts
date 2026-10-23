/**
 * eventStatusLabels - the Live Stream's one vocabulary for persona_events.status.
 *
 * Keyed by the generated `PersonaEventStatus` union, so a status the Rust enum
 * (core/src/models/event.rs) gains does not compile until it has a label here.
 * `delivered` is the success state the bus actually writes; `completed` is the
 * mock/seed success state. A filter that offers only `completed` hides almost
 * every successful delivery.
 */
import type { Translations } from '@/i18n/useTranslation';
import type { PersonaEventStatus } from '@/lib/bindings/PersonaEventStatus';

export function eventStatusLabels(t: Translations): Record<PersonaEventStatus, string> {
  return {
    pending: t.status_tokens.event.pending,
    processing: t.status_tokens.event.processing,
    delivered: t.status_tokens.delivery.delivered,
    completed: t.execution_status.completed,
    skipped: t.triggers.live_status_skipped,
    failed: t.status_tokens.event.failed,
    dead_letter: t.triggers.tab_dead_letter,
    discarded: t.triggers.pending_approval.discarded,
  };
}

/** Every status, in lifecycle order (the filter's option order). */
export const EVENT_STATUS_ORDER: readonly PersonaEventStatus[] = [
  'pending', 'processing', 'delivered', 'completed', 'skipped', 'failed', 'dead_letter', 'discarded',
];

/** Label for a raw row status; an unknown token renders as itself rather than blank. */
export function eventStatusLabel(t: Translations, status: string): string {
  const labels = eventStatusLabels(t);
  return (labels as Record<string, string>)[status] ?? status;
}
