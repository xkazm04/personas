/**
 * ReadyPeek — the `ready` chip's peek: ideas a person accepted that never
 * became work, and the bar that sends them.
 *
 * Rehomed from the retired DecisionDock's Dispatch tab. It is the deck's own
 * machinery, unchanged: `useAcceptedDispatch` reads the list once on mount
 * (so nothing is fetched while the peek is shut), `DeckDispatchBar` selects
 * and dispatches — one row ticked is "dispatch one", select-all is "all" —
 * and `DeckAcceptedList` draws the rows. After a dispatch or a delete the
 * strip's `ready` count is re-read so the chip and the list agree.
 */
import { useEffect } from 'react';

import { DeckAcceptedList } from '@/features/agents/quick-answer/triage/deck/DeckAcceptedList';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { useAcceptedDispatch } from '@/features/agents/quick-answer/triage/deck/useAcceptedDispatch';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { chipLabel } from './chipMeta';
import { PeekPanel } from './PeekPanel';
import { usePeekKeyboard } from './usePeekKeyboard';

const NO_ITEMS: never[] = [];
const noop = () => undefined;

export function ReadyPeek({
  left, keyboard, onWalk, onClose,
}: {
  left: number;
  keyboard: boolean;
  onWalk: (step: 1 | -1) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const label = chipLabel(t.monitor, 'ready');
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
    <PeekPanel label={tx(t.monitor.dc_hub_peek_aria, { label })} title={label} left={left} onClose={onClose} testId="decision-peek">
      <DeckDispatchBar ctl={ctl} />
      <div className="flex min-h-0 flex-1 flex-col" data-testid="decision-peek-ready">
        <DeckAcceptedList ctl={ctl} />
      </div>
    </PeekPanel>
  );
}
