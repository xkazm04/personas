/**
 * LiveDeck — the Decision Deck itself, behind `DecisionDeckHost`'s lazy
 * boundary: the host is always mounted, this module (the deck modal, its card
 * shapes and writers) loads only once `openDecisionDeck` first sets a request.
 * From then on it stays mounted so a close can play its shrink-to-origin exit,
 * with the roster switched off while the deck is shut.
 *
 * While open it reads the ONE roster (`useDecisionRoster`), loading only what
 * the request's scope deals: its chip, every chip (`all`), the chips a lane's
 * kinds come from (`lane`, joined on the shared lanes snapshot), or nothing at
 * all for a `single` item the caller already holds. Verdicts go out through
 * `writeDeckVerdict` -> `roster.decide`; a write that did not land toasts and
 * rejects (the roster restores the card, the deck walks back to it), and a
 * row someone else decided first toasts "decided elsewhere" and stays gone.
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ApprovalActionFailedError, isDecisionConflict } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useToastStore } from '@/stores/toastStore';
import { chipOf, type DecisionChip, type DecisionItem } from '../model/decisionModel';
import { useDecisionRoster } from '../useDecisionRoster';
import { chipLabel } from './deckMeta';
import { originFromRect } from './deckMotion';
import { closeDecisionDeck, type DeckRequest } from './deckStore';
import type { DeckLanded, DeckVerdict } from './deckTypes';
import { ReplyRouteError, writeDeckVerdict, type DeckWriteDoors } from './deckWrites';
import { DeckModal, type DeckSessionSpec } from './DeckModal';
import { useDeckHosts } from './useDeckHosts';
import { chipsForLane, indexLanes } from '../lanes/laneModel';
import { laneLabel } from '../lanes/laneMeta';
import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import { useLanesSnapshot } from '../lanes/useLanesSnapshot';
import { isMandateWrite } from '../mandate/mandateWrites';
import { useMandateDeck } from '../mandate/useMandateDeck';
import { DeckLaneContext, type DeckLaneData } from './shapes/DeckLaneContext';
import { withLaneIrreversible } from './shapes/cardShape';
import { lensDealsLane } from '../lens/lensKinds';
import { useLensScanItems } from '../lens/useLensScanItems';

function loadOf(
  request: DeckRequest | null,
  snapshot: DecisionLanesSnapshot | null,
): readonly DecisionChip[] | 'all' | undefined {
  const scope = request?.scope;
  if (scope?.kind === 'chip') return [scope.chip];
  if (scope?.kind === 'lane') return chipsForLane(scope.lane, snapshot);
  if (scope?.kind === 'all') return 'all';
  return undefined;
}

export default function LiveDeck({ request, session }: { request: DeckRequest | null; session: number }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { hosts, followUp } = useDeckHosts();
  const laneScope = request?.scope.kind === 'lane';
  const lanesState = useLanesSnapshot(laneScope);
  const roster = useDecisionRoster({ load: loadOf(request, lanesState.snapshot), enabled: !!request, hosts });
  const lanes = useMemo(() => indexLanes(lanesState.snapshot), [lanesState.snapshot]);
  const mandateDeck = useMandateDeck(laneScope, lanesState.snapshot);
  // The lens-scan cards (spark one-control): fixed lanes, appended like the Sign lane's mandates.
  const lens = useLensScanItems(request?.scope.kind === 'lane' && lensDealsLane(request.scope.lane));
  const items = useMemo(
    () => (laneScope ? withLaneIrreversible([...roster.items, ...mandateDeck.items, ...lens.items], lanes) : roster.items),
    [laneScope, roster.items, mandateDeck.items, lens.items, lanes],
  );
  const laneData = useMemo<DeckLaneData>(
    () => ({ lanes, mandates: mandateDeck.mandates, charters: mandateDeck.charters }),
    [lanes, mandateDeck.mandates, mandateDeck.charters],
  );
  const { decide } = roster;
  const { write: writeMandate } = mandateDeck;
  const sendTeamReply = usePipelineStore((s) => s.sendChannelDirective);
  const sendPersonaReply = usePipelineStore((s) => s.sendPersonaChannelMessage);

  const doors = useMemo<DeckWriteDoors>(
    () => ({ decide, sendTeamReply, sendPersonaReply }),
    [decide, sendTeamReply, sendPersonaReply],
  );

  const decidedElsewhere = m.dc_hub_decided_elsewhere;
  const replyFailed = m.dc_deck_reply_failed;
  const onDecide = useCallback(async (v: DeckVerdict): Promise<DeckLanded | void> => {
    if (v.item.kind === 'report' && v.branchId === 'chat') {
      followUp.current = { item: v.item, linkedReviews: v.linkedReviews ?? [] };
    }
    // A Sign card, or a Breach card's amend / suspend, writes to the mandate.
    if (isMandateWrite(v)) {
      try {
        const written = await writeMandate(v);
        // Sent home to an offline device: the tray says it waits there, as the drawer does.
        if (written.queuedOn) {
          return { receipt: tx(m.dc_deck_receipt, { verdict: tx(m.remote_queued_until, { device: written.queuedOn }), title: v.item.title }) };
        }
      } catch (err) {
        toastCatch('decision-deck:mandate', m.ml_write_failed)(err);
        throw err;
      }
      return;
    }
    try {
      await writeDeckVerdict(v, doors);
    } catch (err) {
      // Someone else decided it first: the row is gone for good, nothing to restore.
      if (isDecisionConflict(err)) {
        useToastStore.getState().addToast(decidedElsewhere, 'warning');
        return;
      }
      if (err instanceof ApprovalActionFailedError) {
        toastCatch('decision-deck:approval')(err);
        return;
      }
      if (v.verdict === 'reply' || err instanceof ReplyRouteError) toastCatch('decision-deck:reply', replyFailed)(err);
      else toastCatch('decision-deck:decide')(err);
      throw err;
    }
  }, [doors, decidedElsewhere, replyFailed, followUp, writeMandate, m, tx]);

  const onOpenLink = useCallback((item: DecisionItem, linkId: string) => {
    if (!item.links?.some((l) => l.id === linkId)) return;
    const executionId = item.payload?.executionId;
    if (executionId) hosts.onOpenRun?.(executionId);
  }, [hosts]);

  const spec = useMemo<DeckSessionSpec | null>(() => {
    if (!request) return null;
    const { scope } = request;
    const scopeLabel = scope.kind === 'all'
      ? m.dc_deck_scope_all
      : scope.kind === 'lane'
        ? laneLabel(m, scope.lane)
        : chipLabel(m, scope.kind === 'chip' ? scope.chip : chipOf(scope.item.kind));
    return {
      key: session,
      scope,
      scopeLabel,
      focusId: request.focusId ?? (scope.kind === 'single' ? scope.item.id : undefined),
      origin: originFromRect(request.origin),
      readOnly: scope.kind === 'single' && !!scope.readOnly,
    };
  }, [request, session, m]);

  return (
    <DeckLaneContext.Provider value={laneData}>
    <DeckModal
      session={spec}
      items={items}
      loading={roster.loading}
      counts={roster.counts}
      lanes={lanes}
      laneCounts={roster.lanes}
      onDecide={onDecide}
      onBack={closeDecisionDeck}
      onOpenLink={onOpenLink}
    />
    </DeckLaneContext.Provider>
  );
}
