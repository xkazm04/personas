/**
 * FocusSurface — reviews, questions, proposals, goals and Athena's approvals,
 * opened in the shared `TriageFocus` inside a `BaseModal`.
 *
 * Moved here from `useRailSurface` (which rendered it inside the retired
 * DecisionDock's body). Same contract: the queue it walks is the list the item
 * was opened from, a failed write REJECTS so the card stays open with what was
 * typed, and a landed verdict drops the item from the walk — the modal closes
 * when the walk is empty.
 *
 * A write that lost its compare-and-swap is not a failure: the row is decided,
 * by someone else. It leaves the walk with the "decided elsewhere" toast
 * instead of an error on a card that no longer exists.
 */
import { useCallback, useMemo, useState } from 'react';

import type { TriageDecision, TriageItem } from '@/features/agents/quick-answer/triage/triageTypes';
import { TriageFocus } from '@/features/shared/components/decisions/TriageFocus';
import { BaseModal } from '@/lib/ui/BaseModal';
import { isDecisionConflict } from '@/lib/decisions/rowWrites';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';

import type { DecisionItem } from '../../model/decisionModel';
import { isRosterDeferral, isTriageKind } from '../../roster/decisionDispatch';
import type { HubDecide } from '../openDecision';

const TITLE_ID = 'decision-focus-title';

/**
 * `TriageFocus` speaks the six triage kinds; Athena's approvals are the one
 * focus kind outside them. It never branches on `kind` (no read of it in
 * `TriageFocus*` or `TriageCardBody`, checked 2026-10-06) and every verdict is
 * mapped back to the ORIGINAL item by id before it is written, so the stand-in
 * kind only ever reaches rendering.
 */
function asFocusItem(item: DecisionItem): TriageItem {
  return { ...item, kind: isTriageKind(item.kind) ? item.kind : 'review' };
}

export function FocusSurface({
  item, queue, decide, onClose,
}: {
  item: DecisionItem;
  queue: readonly DecisionItem[];
  decide: HubDecide;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [walk, setWalk] = useState<DecisionItem[]>(() => (queue.some((q) => q.id === item.id) ? [...queue] : [item]));
  const [index, setIndex] = useState(() => Math.max(0, walk.findIndex((q) => q.id === item.id)));
  const byId = useMemo(() => new Map(walk.map((q) => [q.id, q])), [walk]);
  const items = useMemo(() => walk.map(asFocusItem), [walk]);

  const drop = useCallback((id: string) => {
    const next = walk.filter((q) => q.id !== id);
    if (next.length === 0) {
      onClose();
      return;
    }
    setWalk(next);
    setIndex((i) => Math.min(i, next.length - 1));
  }, [walk, onClose]);

  const onDecide = useCallback(async (decision: TriageDecision) => {
    const original = byId.get(decision.item.id);
    if (!original) return;
    const full = { ...decision, item: original };
    try {
      await decide(full);
    } catch (err) {
      if (!isDecisionConflict(err)) throw err;
      useToastStore.getState().addToast(t.monitor.dc_hub_decided_elsewhere, 'warning');
    }
    // A skip (or a question with nothing filled in) wrote nothing: walk on.
    if (isRosterDeferral(full)) setIndex((i) => Math.min(i + 1, walk.length - 1));
    else drop(original.id);
  }, [byId, decide, drop, t, walk.length]);

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      size="xl"
      staggerChildren={false}
      panelClassName="flex max-h-[82vh] flex-col overflow-hidden rounded-modal border border-border bg-background shadow-elevation-4"
    >
      <h2 id={TITLE_ID} className="sr-only">{t.monitor.grid_rail_triage_modal_aria}</h2>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="decision-focus-surface">
        <TriageFocus
          className="min-h-0 flex-1"
          items={items}
          index={index}
          onIndexChange={setIndex}
          onDecide={onDecide}
        />
      </div>
    </BaseModal>
  );
}
