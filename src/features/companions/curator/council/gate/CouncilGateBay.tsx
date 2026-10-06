// The gate, wired: it decides which sentence the gate carries, hands the
// write to the one door, and says out loud when the council moved under it.
//
// It also offers the second door (decision-center wave 3): "Open in Decision
// Center" hands the same subject to the global Decision Deck as a `single`
// item, built by the roster's own `councilToDecision` from the detail ON
// SCREEN — so the deck quotes the same digest this gate would. The in-page
// gate keeps working; when the deck closes the page re-reads.
//
// The digest it hands back is the digest of the round ON SCREEN - taken from
// the detail the table is rendering, never from a later read - so the
// backend's compare-and-swap is answering the question the person actually
// asked.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';
import { decideCouncilRow, isDecisionConflict } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import {
  deckOriginOf,
  openDecisionDeck,
  useDecisionDeckStore,
} from '@/features/decision-center/deck/deckStore';
import { councilToDecision } from '@/features/decision-center/roster/decisionAdapters';
import { useDecisionCopy } from '@/features/decision-center/roster/useDecisionCopy';

import { useCouncilStore } from '../councilStore';
import { gateOf } from '../table/councilCopy';
import type { Rubric } from '../table/rubrics';
import { usePercent } from '../table/usePercent';
import { CouncilGate } from './CouncilGate';

export function CouncilGateBay({
  subject,
  detail,
  rubric,
  onReload,
}: {
  subject: CouncilSubjectState;
  detail: CouncilRunDetail | null;
  rubric: Rubric;
  onReload: () => void;
}) {
  const { t, tx } = useTranslation();
  const g = t.council.gate;
  const percent = usePercent();
  const fixtureOn = useCouncilStore((s) => s.fixtureOn);
  const focusNonce = useCouncilStore((s) => s.gateFocusNonce);
  const recordFixtureDecision = useCouncilStore((s) => s.recordFixtureDecision);
  const refreshCouncils = useCouncilStore((s) => s.refreshCouncils);
  const addToast = useToastStore((s) => s.addToast);
  const [moved, setMoved] = useState(false);
  const decisionCopy = useDecisionCopy();

  const gate = gateOf(subject, rubric, percent);
  // A round the council has already superseded cannot be decided even when
  // the subject itself still reads `ready`, and the gate says which it is.
  const stale = Boolean(detail && !detail.isLatest);
  const open = gate.open && !stale && (fixtureOn || Boolean(detail));

  const standing =
    subject.state === 'approved' || subject.state === 'approved_drifted'
      ? ({ decision: 'approved', reason: null } as const)
      : subject.state === 'rejected'
        ? ({ decision: 'rejected', reason: subject.rejectionReason } as const)
        : null;

  const onDecide = useCallback(
    async (decision: 'approved' | 'rejected', reason: string | null) => {
      setMoved(false);
      if (fixtureOn) {
        // No backend to write to. The page holds it, says so, and repaints.
        recordFixtureDecision(subject.id, decision, reason);
        addToast(decision === 'approved' ? g.approved_toast : g.rejected_toast, 'success');
        return;
      }
      if (!detail) return;
      try {
        await decideCouncilRow(subject.id, detail.run.id, decision, detail.sawDigest, {
          reason: reason ?? undefined,
        });
        addToast(decision === 'approved' ? g.approved_toast : g.rejected_toast, 'success');
        // The bench row moves and the stars repaint on the way back up.
        await refreshCouncils();
        onReload();
      } catch (err) {
        if (isDecisionConflict(err)) {
          // Nothing was recorded. Say so, refetch, and let the person look
          // again; a silent retry would decide against a round they never saw.
          setMoved(true);
          onReload();
          void refreshCouncils();
          return;
        }
        toastCatch('council decision')(err);
      }
    },
    [addToast, detail, fixtureOn, g, onReload, recordFixtureDecision, refreshCouncils, subject.id],
  );

  // The deck door. Only for a live gate with a run on screen: the fixture has
  // no backend, and without the detail there is no digest to decide against.
  const deckOpen = useDecisionDeckStore((s) => s.request !== null);
  const openedDeck = useRef(false);
  const openInDeck = useCallback(
    (origin: HTMLElement) => {
      if (!detail) return;
      openedDeck.current = true;
      openDecisionDeck({
        scope: { kind: 'single', item: councilToDecision(subject, detail, decisionCopy) },
        origin: deckOriginOf(origin),
      });
    },
    [decisionCopy, detail, subject],
  );
  useEffect(() => {
    if (deckOpen || !openedDeck.current) return;
    openedDeck.current = false;
    // Whatever happened in the deck (decided, moved, closed untouched), the
    // bench and this round re-read so the gate shows the standing truth.
    onReload();
    void refreshCouncils();
  }, [deckOpen, onReload, refreshCouncils]);

  const why = moved
    ? g.moved
    : stale
      ? g.why_superseded
      : open
        ? g.open_body
        : tx(g[gate.key], gate.values);

  return (
    <CouncilGate
      open={open && !moved}
      why={why}
      standing={standing}
      onDecide={onDecide}
      focusNonce={focusNonce}
      fixture={fixtureOn}
      onOpenDeck={!fixtureOn && detail ? openInDeck : undefined}
    />
  );
}

export default CouncilGateBay;
