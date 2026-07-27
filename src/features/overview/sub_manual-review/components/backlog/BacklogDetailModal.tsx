// The Backlog's review surface — the state machine around BacklogDetailLedger.
//
// It owns the three verdicts (accept / reject / build now), the busy gate, the
// queue stepper and the keyboard map. Layout owns none of that, so a
// presentation change can never alter what a decision does.
//
// Keyboard resolution (deliberately different from the focus deck landing in
// P5, which keeps ←/A reject and →/Z accept): here ←/→ WALK the queue, because
// a modal opened from a table is a reading surface first. Verdicts are on the
// letters instead — `A` accept, `R` reject.
import { useCallback, useEffect, useState } from 'react';

import { BaseModal } from '@/lib/ui/BaseModal';
import * as devApi from '@/api/devTools/devTools';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { BacklogDetailLedger, type BacklogNav } from './BacklogDetailLedger';
import type { BacklogIdea } from './backlogModel';

export type { BacklogNav } from './BacklogDetailLedger';

export function BacklogDetailModal({
  idea,
  categoryLabel,
  busy,
  onAccept,
  onReject,
  onClose,
  nav,
}: {
  idea: BacklogIdea;
  categoryLabel: (key: string) => string;
  /** True while the queue's own verdict call is in flight. */
  busy: boolean;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onClose: () => void;
  /** Absent when the idea was opened outside a list (no queue to walk). */
  nav?: BacklogNav;
}) {
  const { t } = useTranslation();
  const r = t.overview.review;
  const addToast = useToastStore((s) => s.addToast);
  const [building, setBuilding] = useState(false);
  const pending = idea.status === 'pending';
  const inFlight = busy || building;

  // A verdict advances the queue rather than dumping the user back to the table
  // to find their place again; the parent closes when the queue runs out.
  const decide = useCallback(
    async (verdict: 'accept' | 'reject') => {
      if (inFlight || !pending) return;
      await (verdict === 'accept' ? onAccept(idea.id) : onReject(idea.id));
      if (nav) nav.onStep(1);
      else onClose();
    },
    [inFlight, pending, onAccept, onReject, idea.id, nav, onClose],
  );

  // "Build now": queue a linked implementation task AND accept, in one move —
  // the direct idea→task path for obvious wins (ported from Idea Triage).
  const buildNow = useCallback(async () => {
    if (inFlight || !pending) return;
    setBuilding(true);
    try {
      await devApi.createTask(
        idea.title,
        idea.projectId ?? undefined,
        idea.description,
        idea.id,
      );
      addToast(r.backlog_build_queued, 'success');
      await onAccept(idea.id);
      if (nav) nav.onStep(1);
      else onClose();
    } catch (err) {
      toastCatch('BacklogDetailModal:buildNow')(err);
    } finally {
      setBuilding(false);
    }
  }, [inFlight, pending, idea, addToast, r.backlog_build_queued, onAccept, nav, onClose]);

  // ←/→ walk the queue, A/R decide. Ignored while a write is in flight (so a
  // double-tap can't skip an item mid-write), while a modifier is held, and
  // while focus sits in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (inFlight) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!nav) return;
        e.preventDefault();
        nav.onStep(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'a' || e.key === 'A') {
        if (!pending) return;
        e.preventDefault();
        void decide('accept');
      } else if (e.key === 'r' || e.key === 'R') {
        if (!pending) return;
        e.preventDefault();
        void decide('reject');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, inFlight, pending, decide]);

  return (
    <BaseModal isOpen onClose={onClose} titleId="backlog-detail" size="xl" staggerChildren={false}>
      <BacklogDetailLedger
        idea={idea}
        categoryLabel={categoryLabel}
        busy={inFlight}
        pending={pending}
        onAccept={() => void decide('accept')}
        onReject={() => void decide('reject')}
        onBuildNow={() => void buildNow()}
        onClose={onClose}
        nav={nav}
      />
    </BaseModal>
  );
}
