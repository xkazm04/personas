/**
 * BacklogSurface — an idea, opened in the Backlog's own `BacklogDetailModal`.
 *
 * The modal wants the full `BacklogIdea` (scores, evidence, verify state); the
 * roster item carries a projection, so the row is read once by id
 * (`dev_tools_get_idea`) and mapped through the Backlog's own `toBacklogIdea`.
 * Its two verdicts write through the roster's `decide`, the same door as the
 * peek's A / R, so a verdict here leaves the strip count and the list at once.
 */
import { useCallback, useMemo, useState } from 'react';

import { getIdea } from '@/api/devTools/devTools';
import { BacklogDetailModal } from '@/features/overview/sub_manual-review/components/backlog/BacklogDetailModal';
import { toBacklogIdea } from '@/features/overview/sub_manual-review/components/backlog/backlogModel';
import { useCategoryLabel } from '@/features/overview/sub_manual-review/components/backlog/backlogLabels';
import { useTranslation } from '@/i18n/useTranslation';
import { isDecisionConflict } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import type { DecisionItem } from '../../model/decisionModel';
import type { HubDecide } from '../openDecision';
import { SurfaceReadError, useSurfaceRow } from './useSurfaceRow';

export function BacklogSurface({
  item, decide, onClose,
}: {
  item: DecisionItem;
  decide: HubDecide;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const categoryLabel = useCategoryLabel();
  const projects = useSystemStore((s) => s.projects);
  const { row, failure, retry } = useSurfaceRow(getIdea, item.sourceId);

  const idea = useMemo(() => {
    if (!row) return null;
    const nameOf = (id: string | null): string => {
      if (!id) return '';
      // A project deleted since the idea was raised keeps its id on screen
      // rather than reading as "no project".
      const project = projects.find((p) => p.id === id);
      return project ? project.name : id;
    };
    return toBacklogIdea(row, nameOf);
  }, [row, projects]);

  // Settles, never rejects: the modal fires its verdicts as `void decide(…)`
  // from a key handler, so a rejection here would be an unhandled one. A
  // failed write is toasted and the roster has already put the item back in
  // the peek; a lost compare-and-swap is the "decided elsewhere" toast.
  const decidedElsewhere = t.monitor.dc_hub_decided_elsewhere;
  const verdict = useCallback(async (v: 'accept' | 'reject') => {
    setBusy(true);
    try {
      await decide({ item, verdict: v });
    } catch (err) {
      if (isDecisionConflict(err)) useToastStore.getState().addToast(decidedElsewhere, 'warning');
      else toastCatch('decision-hub:idea-verdict')(err);
    } finally {
      setBusy(false);
    }
  }, [decide, item, decidedElsewhere]);
  const onAccept = useCallback(() => verdict('accept'), [verdict]);
  const onReject = useCallback(() => verdict('reject'), [verdict]);

  if (failure) return <SurfaceReadError failure={failure} onRetry={retry} onClose={onClose} />;
  if (!idea) return null;
  return (
    <BacklogDetailModal
      idea={idea}
      categoryLabel={categoryLabel}
      busy={busy}
      onAccept={onAccept}
      onReject={onReject}
      onClose={onClose}
    />
  );
}
