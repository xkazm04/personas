/**
 * ReadyPeek — the `ready` chip's peek: ideas a person accepted that never
 * became work, and the bar that sends them, in R2-C's glass.
 *
 * Rehomed from the retired DecisionDock's Dispatch tab. It is the deck's own
 * machinery, unchanged: `useAcceptedDispatch` reads the list once on mount
 * (so nothing is fetched while the peek is shut), `DeckDispatchBar` selects
 * and dispatches — one row ticked is "dispatch one", select-all is "all" —
 * and `DeckAcceptedList` draws the rows. After a dispatch or a delete the
 * strip's `ready` count is re-read so the chip and the list agree.
 */
import { useEffect } from 'react';

import { DeckAcceptedList } from './ready/DeckAcceptedList';
import { DeckDispatchBar } from './ready/DeckDispatchBar';
import { useAcceptedDispatch } from './ready/useAcceptedDispatch';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { usePeekKeyboard } from './usePeekKeyboard';
import { PeekShell } from './visual/PeekShell';

const NO_ITEMS: never[] = [];
const noop = () => undefined;

export function ReadyPeek({
  count, anchor, keyboard, onWalk, onClose,
}: {
  count: number | null;
  anchor: HTMLElement | null;
  keyboard: boolean;
  onWalk: (step: 1 | -1) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ctl = useAcceptedDispatch({
    resolveErrorMessage: (err) =>
      resolveErrorTranslated(t, err instanceof Error ? err.message : String(err)).message,
  });
  // Only Esc and ←/→ mean anything here: the rows are selected, not decided.
  usePeekKeyboard(NO_ITEMS, keyboard, { onOpen: noop, onDecide: noop, onWalk, onClose });

  const refreshUndispatched = useSystemStore((s) => s.refreshUndispatchedIdeas);
  const { report } = ctl;
  useEffect(() => {
    if (report) void refreshUndispatched().catch(silentCatch('decision-hub:ready-recount'));
  }, [report, refreshUndispatched]);

  return (
    <PeekShell chip="ready" lamp="success" count={count} anchor={anchor} onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2" data-testid="decision-peek-ready">
        <DeckDispatchBar ctl={ctl} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <DeckAcceptedList ctl={ctl} />
        </div>
      </div>
    </PeekShell>
  );
}
