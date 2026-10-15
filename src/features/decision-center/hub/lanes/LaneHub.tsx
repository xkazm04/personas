/**
 * LaneHub — the Decision Center's home under the `lanes` setting: lane
 * buttons (level 1) → lane peek (level 2) → the Decision Deck scoped to the
 * lane (level 3). The chip hub (`DecisionHub`) is the `chips` twin; the
 * command bar mounts one or the other.
 *
 *  - Counts are the roster's lane counts (`decision_lanes_snapshot` + the
 *    frontend kinds). Items load only for the open lane: the chips its kinds
 *    come from (`chipsForLane`), then joined and ordered by lane.
 *  - `1`-`4` and `O` open a lane's peek (a second press closes it); while a
 *    peek is open ←/→ walk the lanes. Enter on a row opens the deck with
 *    `scope: lane`, focused on the row, and the deck's close reopens the peek.
 *  - One-key verdicts from a row write through `roster.decide`, exactly as
 *    the chip hub does.
 *  - The Sign peek also lists the draft mandates (`mandate:<charterId>`),
 *    which the roster does not carry (`usePeekSignItems`); A / R on one opens
 *    its Sign card, because signing needs the envelope and a drop its reason.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isDecisionConflict } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

import type { DecisionItem } from '../../model/decisionModel';
import { deckOriginOf, openDecisionDeck, useDecisionDeckStore } from '../../deck/deckStore';
import { isTypingTarget, plain } from '../../deck/keys';
import { useDecisionRoster } from '../../useDecisionRoster';
import { LANE_KEYS, chipsForLane, indexLanes, laneQueue, type LaneKey } from '../../lanes/laneModel';
import { LANE_ICON, laneForKey, laneLabel, walkLane } from '../../lanes/laneMeta';
import { useLanesSnapshot } from '../../lanes/useLanesSnapshot';
import { ReadyPeek } from '../ReadyPeek';
import { useLoadSettled } from '../useLoadSettled';
import { Peek } from '../visual/Peek';
import { LaneFooter } from './LaneFooter';
import { LaneStrip, type LanePeekKey, type LaneRefs } from './LaneStrip';
import { usePeekSignItems } from './usePeekSignItems';
import { requestOrphanage } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateDrawerRequest';

interface OpenPeek { key: LanePeekKey; focusId: string | null }

const NO_CHIPS: never[] = [];
const PEEK_ORDER: readonly LanePeekKey[] = [...LANE_KEYS, 'ready'];

/** True while a dialog other than the lane peek itself is up (deck, drawer, modal). */
function otherDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]:not([data-testid="decision-peek"])') !== null;
}

export function LaneHub({ keysEnabled = true }: { keysEnabled?: boolean }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const refs: LaneRefs = useRef({});
  const [peek, setPeek] = useState<OpenPeek | null>(null);
  const lane: LaneKey | null = peek && peek.key !== 'ready' ? peek.key : null;

  const lanesState = useLanesSnapshot(true);
  const load = useMemo(() => (lane ? chipsForLane(lane, lanesState.snapshot) : NO_CHIPS), [lane, lanesState.snapshot]);
  const roster = useDecisionRoster({ load });
  const { decide, refresh, counts } = roster;
  const index = useMemo(() => indexLanes(lanesState.snapshot), [lanesState.snapshot]);
  const sign = usePeekSignItems(lane === 'sign');
  const items = useMemo(
    () => (lane ? laneQueue(lane, sign.items.length > 0 ? [...roster.items, ...sign.items] : roster.items, index) : []),
    [lane, roster.items, sign.items, index],
  );

  const deckOpen = useDecisionDeckStore((s) => s.request !== null);
  const closedReturnTo = useDecisionDeckStore((s) => s.closedReturnTo);
  const ownSession = useRef<number | null>(null);
  const lastFocus = useRef<string | null>(null);

  const toggle = useCallback((key: LanePeekKey) => {
    setPeek((p) => (p?.key === key ? null : { key, focusId: null }));
  }, []);
  // Orphans (O) opens the orphanage (the mandate drawer's page, WP6), where
  // its work is drafted, adopted or archived, rather than a peek of cards.
  const openLane = useCallback((key: LanePeekKey) => {
    if (key === 'orphan') { setPeek(null); requestOrphanage(); return; }
    toggle(key);
  }, [toggle]);
  const onWalk = useCallback((step: 1 | -1) => {
    setPeek((p) => (p ? { key: walkLane(p.key, step, PEEK_ORDER), focusId: null } : p));
  }, []);
  const closeOpen = useCallback(() => setPeek(null), []);

  const decidedElsewhere = m.dc_hub_decided_elsewhere;
  const onDecide = useCallback((item: DecisionItem, verdict: 'accept' | 'reject') => {
    void (async () => {
      try {
        await decide({ item, verdict });
      } catch (err) {
        if (isDecisionConflict(err)) useToastStore.getState().addToast(decidedElsewhere, 'warning');
        else toastCatch('lane-hub:decide')(err);
      }
    })();
  }, [decide, decidedElsewhere]);

  const onOpen = useCallback((item: DecisionItem, from: Element | null) => {
    if (!lane) return;
    lastFocus.current = item.id;
    openDecisionDeck({ scope: { kind: 'lane', lane }, focusId: item.id, origin: deckOriginOf(from), returnTo: lane });
    ownSession.current = useDecisionDeckStore.getState().session;
    setPeek(null);
  }, [lane]);

  // The deck this hub opened closed: reopen the lane's peek on the row it left.
  useEffect(() => {
    if (!closedReturnTo) return;
    const deck = useDecisionDeckStore.getState();
    if (deck.request || ownSession.current !== deck.session) return;
    ownSession.current = null;
    deck.consumeReturn();
    const back = closedReturnTo.chip;
    if (!(LANE_KEYS as readonly string[]).includes(back)) return;
    setPeek({ key: back as LaneKey, focusId: lastFocus.current });
  }, [closedReturnTo]);

  useAppKeyboard((e) => {
    if (!plain(e) || e.shiftKey || isTypingTarget(e.target) || otherDialogOpen()) return false;
    const target = laneForKey(e.key);
    if (!target) return false;
    e.preventDefault();
    openLane(target);
    return true;
  }, { enabled: keysEnabled && !deckOpen, priority: ROUTE_DECISION_PRIORITY });

  const laneCounts = roster.lanes;
  const settled = useLoadSettled(lane, roster.loading) && sign.ready;
  if (!laneCounts) return null;
  const failed = lane !== null && (laneCounts[lane].failed || sign.failed) && settled && items.length === 0;
  const anchor = peek ? refs.current[peek.key] ?? null : null;

  return (
    <div className="relative flex min-w-0 flex-1 items-center" data-testid="decision-lane-hub">
      <LaneStrip
        counts={laneCounts}
        settled={roster.lanesSettled}
        ready={counts.ready}
        open={peek?.key ?? null}
        refs={refs}
        onLane={(l) => openLane(l)}
        onReady={() => toggle('ready')}
      />
      {peek?.key === 'ready' && (
        <ReadyPeek
          count={counts.ready.failed ? null : counts.ready.n}
          anchor={anchor}
          keyboard={!deckOpen}
          onWalk={onWalk}
          onClose={closeOpen}
        />
      )}
      {lane && (
        <Peek
          key={lane}
          chip={null}
          identity={{ id: `lane-${lane}`, label: laneLabel(m, lane), icon: LANE_ICON[lane] }}
          footer={<LaneFooter />}
          items={items}
          lamp={laneCounts[lane].lamp}
          ready={settled || items.length > 0}
          failed={failed}
          lead={lane === 'breach'}
          anchor={anchor}
          keyboard={!deckOpen}
          initialFocusId={peek?.focusId}
          onRetry={refresh}
          onDecide={onDecide}
          onOpen={onOpen}
          onWalk={onWalk}
          onClose={closeOpen}
        />
      )}
    </div>
  );
}
