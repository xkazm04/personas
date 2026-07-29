// Practice detail — the review surface. Opening a practice shows the full
// claim and its evidence, the metadata the table no longer carries (origin,
// topic, altitude, confidence, provenance), and the governance action its
// current state allows.
//
// Governance, not editing: `observed`/`proposed` items get Adopt / Reject,
// `adopted` items get Roll out and Deprecate. Rejection is retained rather
// than deleted — the miners dedup against it for 90 days, so a rejected
// practice stops coming back.
//
// Presentation is LEDGER (the /prototype round-1 winner): prose left, facts and
// actions in a margin rail, one vertical divider instead of a dozen borders.
// This wrapper owns the state machine — decide(), busy, keyboard stepping — and
// the view owns only layout, so a presentation change can never alter
// governance behaviour.
import { useEffect, useState } from 'react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { decideWorkspaceKnowledge, isActionableKind } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { PracticeDetailLedger } from './PracticeDetailLedger';
import type { PracticeNav, PracticeViewProps } from './practiceViewTypes';

export type { PracticeNav } from './practiceViewTypes';

export function PracticeDetailModal({
  practice,
  projectById,
  onClose,
  onChanged,
  onRollout,
  nav,
}: {
  practice: WorkspaceKnowledge;
  projectById: Map<string, DevProject>;
  onClose: () => void;
  onChanged: () => void;
  /** Open the rollout surface for an adopted practice. */
  onRollout?: (practice: WorkspaceKnowledge) => void;
  /** Absent when the practice was opened outside a list (no queue to walk). */
  nav?: PracticeNav;
}) {
  const { t } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'adopt' | 'reject' | 'deprecate') => {
    setBusy(true);
    try {
      await decideWorkspaceKnowledge(practice.id, decision);
      // Adopting an ACTIONABLE kind (pitfall/pattern) queues every applicable
      // member repo at `to_process`; say so, or the decision reads as a state
      // change with no consequence.
      addToast(
        decision === 'adopt'
          ? (isActionableKind(practice.kind) ? tw.decide_adopted_queued : tw.decide_adopted)
          : decision === 'reject' ? tw.decide_rejected
            : tw.decide_deprecated,
        decision === 'adopt' ? 'success' : 'warning',
      );
      onChanged();
      // Reviewing a queue is the common case, so a decision advances instead of
      // dumping you back to the table and making you find your place again.
      // The parent closes when the queue runs out.
      if (nav) nav.onStep(1);
      else onClose();
    } catch (err) {
      toastCatch('workspaces:decide')(err);
    } finally {
      setBusy(false);
    }
  };

  // ←/→ walk the queue. Ignored while a decision is in flight (so a double-tap
  // can't skip an item mid-write) and while focus sits in a text field.
  useEffect(() => {
    if (!nav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (busy) return;
      e.preventDefault();
      nav.onStep(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, busy]);

  const originLabel = practice.origin_project_id
    ? projectById.get(practice.origin_project_id)?.name ?? tw.origin_removed
    : tw.origin_workspace;
  const actorLabel = (() => {
    try {
      return practice.provenance
        ? (JSON.parse(practice.provenance) as { actor_kind?: string }).actor_kind ?? null
        : null;
    } catch {
      return null;
    }
  })();

  const viewProps: PracticeViewProps = {
    practice,
    projectById,
    originLabel,
    actorLabel,
    busy,
    pending: practice.status === 'observed' || practice.status === 'proposed',
    adopted: practice.status === 'adopted',
    onDecide: decide,
    onRollout: onRollout ? () => { onRollout(practice); onClose(); } : undefined,
    onClose,
    nav,
  };

  // size="xl", not "lg": at max-w-3xl the governance buttons wrapped onto a
  // second row and split their own icon from their label.
  return (
    <BaseModal isOpen onClose={onClose} titleId="practice-detail" size="xl" staggerChildren={false}>
      <PracticeDetailLedger {...viewProps} />
    </BaseModal>
  );
}
