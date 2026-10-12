/**
 * DecisionDeckHost — the single global mount of the Decision Deck.
 *
 * Mounted once in the app's GlobalOverlays (lazy island "decision-deck"). It
 * renders nothing until `openDecisionDeck` first sets a request; from then on
 * it stays mounted so a close can play its shrink-to-origin exit, with the
 * roster switched off while the deck is shut.
 *
 * While open it reads the ONE roster (`useDecisionRoster`), loading only what
 * the request's scope deals: its chip, every chip (`all`), or nothing at all
 * for a `single` item the caller already holds. Verdicts go out through
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
import { closeDecisionDeck, useDecisionDeckStore, type DeckRequest } from './deckStore';
import type { DeckVerdict } from './deckTypes';
import { ReplyRouteError, writeDeckVerdict, type DeckWriteDoors } from './deckWrites';
import { DeckModal, type DeckSessionSpec } from './DeckModal';
import { useDeckHosts } from './useDeckHosts';

function loadOf(request: DeckRequest | null): readonly DecisionChip[] | 'all' | undefined {
  const scope = request?.scope;
  if (scope?.kind === 'chip') return [scope.chip];
  if (scope?.kind === 'all') return 'all';
  return undefined;
}

function LiveDeck({ request, session }: { request: DeckRequest | null; session: number }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const { hosts, followUp } = useDeckHosts();
  const roster = useDecisionRoster({ load: loadOf(request), enabled: !!request, hosts });
  const { decide } = roster;
  const sendTeamReply = usePipelineStore((s) => s.sendChannelDirective);
  const sendPersonaReply = usePipelineStore((s) => s.sendPersonaChannelMessage);

  const doors = useMemo<DeckWriteDoors>(
    () => ({ decide, sendTeamReply, sendPersonaReply }),
    [decide, sendTeamReply, sendPersonaReply],
  );

  const decidedElsewhere = m.dc_hub_decided_elsewhere;
  const replyFailed = m.dc_deck_reply_failed;
  const onDecide = useCallback(async (v: DeckVerdict) => {
    if (v.item.kind === 'report' && v.branchId === 'chat') {
      followUp.current = { item: v.item, linkedReviews: v.linkedReviews ?? [] };
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
  }, [doors, decidedElsewhere, replyFailed, followUp]);

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
    <DeckModal
      session={spec}
      items={roster.items}
      loading={roster.loading}
      onDecide={onDecide}
      onBack={closeDecisionDeck}
      onOpenLink={onOpenLink}
    />
  );
}

export default function DecisionDeckHost() {
  const request = useDecisionDeckStore((s) => s.request);
  const session = useDecisionDeckStore((s) => s.session);
  // Never opened: mount nothing, read nothing.
  if (session === 0) return null;
  return <LiveDeck request={request} session={session} />;
}
