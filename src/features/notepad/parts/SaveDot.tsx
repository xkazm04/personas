import { useTranslation } from '@/i18n/useTranslation';

import type { NoteSaveState } from '../notepadStore';

/** Dot colour per save state. `clean` renders nothing — a saved document is
 *  the resting state and does not need a light to say so. */
const SAVE_DOT: Record<Exclude<NoteSaveState, 'clean'>, string> = {
  dirty: 'bg-status-warning/70',
  saving: 'bg-status-info/80 animate-pulse motion-reduce:animate-none',
  error: 'bg-status-error',
};

/** A note's save state as a dot. Shared by the tab strip and the overview cards
 *  so an unsaved note looks the same wherever it is shown. */
export function SaveDot({ state }: { state: NoteSaveState }) {
  const { t } = useTranslation();
  if (state === 'clean') return null;
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SAVE_DOT[state]}`}
      data-testid={`notepad-save-${state}`}
      aria-label={
        state === 'dirty' ? t.notepad.save_dirty : state === 'saving' ? t.notepad.save_saving : t.notepad.save_error
      }
    />
  );
}
