/**
 * DecisionHub — the Decision Center's home on the Monitor's Activity band:
 * strip (level 1) → peek (level 2) → the item's own surface (level 3).
 *
 * The WIRING half. It owns the one roster read, which chip is open, the
 * verdict writes and the router; the strip and the peeks are slots it fills.
 *
 *  - Counts are always on. Items load only for the open chip (`load: [chip]`),
 *    or for every chip while "Triage all" is finding its first item.
 *  - A one-key verdict writes through `roster.decide` (optimistic; the roster
 *    restores the item and rethrows on failure). A lost compare-and-swap gets
 *    the "decided elsewhere" toast, anything else `toastCatch`.
 *  - Escape steps back one level at a time: the open surface's own modal
 *    first (the peek's keys are off while it is up), then the peek, and only
 *    then — on a press that reaches it — the Monitor.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import type { FeedTeam } from '@/features/fleet/monitor/channels/types';
import { useTranslation } from '@/i18n/useTranslation';
import { isDecisionConflict } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

import type { DecisionChip, DecisionItem, HubChip } from '../model/decisionModel';
import { useDecisionRoster } from '../useDecisionRoster';
import { walkChip } from './chipMeta';
import { DecisionPeek } from './DecisionPeek';
import { DecisionStrip } from './DecisionStrip';
import { useDecisionOpener } from './openDecision';
import { PEEK_WIDTH } from './PeekPanel';
import { ReadyPeek } from './ReadyPeek';
import { useLoadSettled } from './useLoadSettled';
import { useTriageAll, type TriageAllPhase } from './useTriageAll';

const NO_FEED_TEAMS: readonly FeedTeam[] = [];
const GUTTER = 16;

export function DecisionHub({ feedTeams = NO_FEED_TEAMS }: { feedTeams?: readonly FeedTeam[] }) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<HubChip, HTMLElement>());
  const [peek, setPeek] = useState<{ chip: HubChip; left: number } | null>(null);
  const [allPhase, setAllPhase] = useState<TriageAllPhase>('idle');

  const peekChip = peek?.chip ?? null;
  const decisionChip: DecisionChip | null = peekChip && peekChip !== 'ready' ? peekChip : null;
  const load = useMemo(
    () => (allPhase !== 'idle' ? 'all' as const : decisionChip ? [decisionChip] : []),
    [allPhase, decisionChip],
  );
  const roster = useDecisionRoster({ load });
  const { decide, refresh } = roster;
  const opener = useDecisionOpener({ decide, refresh, feedTeams });
  const triageAll = useTriageAll(allPhase, setAllPhase, roster, opener);

  /** Hang the peek under `anchor`, clamped so it never leaves the window. */
  const place = useCallback((chip: HubChip, anchor: HTMLElement | undefined) => {
    const box = boxRef.current?.getBoundingClientRect();
    const at = anchor?.getBoundingClientRect();
    if (!box || !at) return setPeek({ chip, left: 0 });
    const max = window.innerWidth - GUTTER - PEEK_WIDTH - box.left;
    setPeek({ chip, left: Math.max(GUTTER - box.left, Math.min(at.left - box.left, max)) });
  }, []);

  const onPick = useCallback((chip: HubChip, anchor: HTMLElement) => {
    chipRefs.current.set(chip, anchor);
    if (peekChip === chip) setPeek(null);
    else place(chip, anchor);
  }, [peekChip, place]);

  const onWalk = useCallback((step: 1 | -1) => {
    if (!peekChip) return;
    const next = walkChip(peekChip, step);
    const anchor = chipRefs.current.get(next)
      ?? boxRef.current?.querySelector<HTMLElement>(`[data-testid="decision-chip-${next}"]`)
      ?? undefined;
    place(next, anchor);
  }, [peekChip, place]);

  const closePeek = useCallback(() => setPeek(null), []);

  const decidedElsewhere = t.monitor.dc_hub_decided_elsewhere;
  const onDecide = useCallback((item: DecisionItem, verdict: 'accept' | 'reject') => {
    void (async () => {
      try {
        await decide({ item, verdict });
      } catch (err) {
        if (isDecisionConflict(err)) useToastStore.getState().addToast(decidedElsewhere, 'warning');
        else toastCatch('decision-hub:decide')(err);
      }
    })();
  }, [decide, decidedElsewhere]);

  const chipItems = decisionChip ? roster.byChip[decisionChip] : undefined;
  const items = useMemo(() => chipItems ?? [], [chipItems]);
  const error = decisionChip ? roster.errors[decisionChip] ?? null : null;
  const settled = useLoadSettled(decisionChip, roster.loading);
  const openItem = opener.open;
  const onOpen = useCallback((item: DecisionItem) => openItem(item, items), [openItem, items]);

  const keyboard = !opener.isOpen;

  return (
    // The hub takes the band's free width; the strip measures it as a CONTAINER
    // (chip names appear only when the band has room for all of them). The
    // container is the strip's own wrapper and never an ancestor of the peek
    // or a surface: a size container is a containing block for fixed
    // descendants, which would trap a non-portal modal inside the band.
    <div ref={boxRef} className="relative flex min-w-0 flex-1 items-center">
      <div className="@container min-w-0 flex-1">
        <DecisionStrip
          counts={roster.counts}
          active={peekChip}
          onPick={onPick}
          onTriageAll={triageAll.start}
          triageAllDisabled={roster.total === 0}
          triageAllBusy={triageAll.busy}
        />
      </div>
      {peek && peek.chip === 'ready' && (
        <ReadyPeek left={peek.left} keyboard={keyboard} onWalk={onWalk} onClose={closePeek} />
      )}
      {peek && decisionChip && (
        <DecisionPeek
          chip={decisionChip}
          items={items}
          ready={settled || items.length > 0 || error !== null}
          error={error}
          onRetry={refresh}
          onDecide={onDecide}
          onOpen={onOpen}
          onWalk={onWalk}
          onClose={closePeek}
          keyboard={keyboard}
          left={peek.left}
        />
      )}
      {opener.surface}
    </div>
  );
}
