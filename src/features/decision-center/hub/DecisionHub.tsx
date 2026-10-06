/**
 * DecisionHub — the Decision Center's home on the Monitor's Activity band:
 * strip (level 1) → peek (level 2) → the Decision Deck (level 3).
 *
 * The WIRING half; R2-C's strip and peek (`visual/`) are the look. It owns the
 * one roster read, which chip is open, and the one-key verdict writes.
 *
 *  - Counts are always on. Items load only for the open chip (`load: [chip]`).
 *  - A one-key verdict writes through `roster.decide` (optimistic; the roster
 *    restores the item and rethrows on failure). A lost compare-and-swap gets
 *    the "decided elsewhere" toast, anything else `toastCatch`.
 *  - Enter on a row (or "Open deck") opens the deck through its one door,
 *    scoped to the chip and focused on the row, growing out of the row; the
 *    peek folds away behind it. "Triage all" opens the deck over every chip.
 *  - Escape steps back one level at a time: the deck first (its own keys),
 *    then — because the hub asked the deck to return to the chip — the peek
 *    reopens on the row it left, then the strip, and only then the Monitor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { isDecisionConflict } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

import type { DecisionChip, DecisionItem, HubChip } from '../model/decisionModel';
import { deckOriginOf, openDecisionDeck, useDecisionDeckStore, type DeckRequest } from '../deck/deckStore';
import { useDecisionRoster } from '../useDecisionRoster';
import { leadChip, walkChip } from './chipMeta';
import { ReadyPeek } from './ReadyPeek';
import { useLoadSettled } from './useLoadSettled';
import { Peek } from './visual/Peek';
import { Strip, type StripRefs } from './visual/Strip';

interface OpenPeek {
  chip: HubChip;
  /** The row to land on (the deck closed on it). */
  focusId: string | null;
}

const NO_ITEMS: DecisionItem[] = [];

export function DecisionHub() {
  const { t } = useTranslation();
  const chipRefs: StripRefs = useRef({});
  const [peek, setPeek] = useState<OpenPeek | null>(null);

  const peekChip = peek?.chip ?? null;
  const decisionChip: DecisionChip | null = peekChip && peekChip !== 'ready' ? peekChip : null;
  const load = useMemo(() => (decisionChip ? [decisionChip] : []), [decisionChip]);
  const roster = useDecisionRoster({ load });
  const { decide, refresh, counts } = roster;

  const deckOpen = useDecisionDeckStore((s) => s.request !== null);
  const closedReturnTo = useDecisionDeckStore((s) => s.closedReturnTo);
  /** The deck session THIS hub opened; only its close reopens a peek. */
  const ownSession = useRef<number | null>(null);
  const lastFocus = useRef<string | null>(null);

  const onChip = useCallback((chip: HubChip) => {
    setPeek((p) => (p?.chip === chip ? null : { chip, focusId: null }));
  }, []);
  const onWalk = useCallback((step: 1 | -1) => {
    setPeek((p) => (p ? { chip: walkChip(p.chip, step), focusId: null } : p));
  }, []);
  /** Close only if `chip`'s peek is still the open one (a deferred close may land late). */
  const closeChip = useCallback((chip: HubChip) => {
    setPeek((p) => (p?.chip === chip ? null : p));
  }, []);
  const closeOpen = useCallback(() => { if (peekChip) closeChip(peekChip); }, [peekChip, closeChip]);

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

  const openDeck = useCallback((request: DeckRequest) => {
    openDecisionDeck(request);
    ownSession.current = useDecisionDeckStore.getState().session;
    setPeek(null);
  }, []);

  const onOpen = useCallback((item: DecisionItem, from: Element | null) => {
    if (!decisionChip) return;
    lastFocus.current = item.id;
    openDeck({
      scope: { kind: 'chip', chip: decisionChip },
      focusId: item.id,
      origin: deckOriginOf(from),
      returnTo: decisionChip,
    });
  }, [decisionChip, openDeck]);

  const onTriageAll = useCallback((anchor: HTMLElement) => {
    lastFocus.current = null;
    openDeck({ scope: { kind: 'all' }, origin: deckOriginOf(anchor) });
  }, [openDeck]);

  // The deck this hub opened closed with a chip to return to: reopen its peek
  // on the row the deck was opened from (if it is still waiting).
  useEffect(() => {
    if (!closedReturnTo) return;
    const deck = useDecisionDeckStore.getState();
    if (deck.request || ownSession.current !== deck.session) return;
    ownSession.current = null;
    deck.consumeReturn();
    setPeek({ chip: closedReturnTo.chip, focusId: lastFocus.current });
  }, [closedReturnTo]);

  const items = (decisionChip ? roster.byChip[decisionChip] : undefined) ?? NO_ITEMS;
  const error = decisionChip ? roster.errors[decisionChip] ?? null : null;
  const settled = useLoadSettled(decisionChip, roster.loading);
  // A chip whose source did not answer is never shown as an empty band: an
  // uncountable chip with nothing listed reads as failed, with a retry.
  const failed = error !== null
    || (decisionChip !== null && counts[decisionChip].failed && settled && items.length === 0);
  const lead = leadChip(counts);
  const keyboard = !deckOpen;
  const anchor = peekChip ? chipRefs.current[peekChip] ?? null : null;

  return (
    // The hub takes the band's free width; the strip measures it and drops its
    // labels when they would not fit. The peek hangs from this box.
    <div className="relative flex min-w-0 flex-1 items-center" data-testid="decision-hub">
      <Strip
        counts={counts}
        total={roster.total}
        openChip={peekChip}
        chipRefs={chipRefs}
        onChip={onChip}
        onTriageAll={onTriageAll}
      />
      {peek && peek.chip === 'ready' && (
        <ReadyPeek
          count={counts.ready.failed ? null : counts.ready.n}
          anchor={anchor}
          keyboard={keyboard}
          onWalk={onWalk}
          onClose={closeOpen}
        />
      )}
      {peek && decisionChip && (
        <Peek
          key={decisionChip}
          chip={decisionChip}
          items={items}
          lamp={counts[decisionChip].lamp}
          ready={settled || items.length > 0 || error !== null}
          failed={failed}
          lead={lead === decisionChip}
          anchor={anchor}
          keyboard={keyboard}
          initialFocusId={peek.focusId}
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
