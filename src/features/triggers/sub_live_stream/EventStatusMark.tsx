import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';
import { useTranslation } from '@/i18n/useTranslation';
import { eventStatusLabel } from './eventStatusLabels';

const EVENT_STATE: Record<string, StateMarkState> = {
  pending: 'proposed',
  processing: 'running',
  delivered: 'success',
  completed: 'success',
  skipped: 'skipped',
  failed: 'error',
  dead_letter: 'error',
  discarded: 'refused',
};

/** A persona_events.status as a StateMark (glyph + word, no pill). An unknown token reads as a warning. */
export function EventStatusMark({ status }: { status: string }) {
  const { t } = useTranslation();
  return <StateMark state={EVENT_STATE[status] ?? 'warning'} label={eventStatusLabel(t, status as never)} />;
}
