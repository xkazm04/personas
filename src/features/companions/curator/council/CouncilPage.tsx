// Council - the registry galaxy with the queue of councils docked on it, and
// one council open as its verdict page.
//
// This shell owns the header (its one action is the CTA on the selected
// council) and the stage. The stage is the fused instrument with the Project
// lanes docked top right; an open council replaces it with the verdict card.
//
//   Q    open the selected council; close the open one
//   Esc  close the open council (the verdict page owns it)
//   W    select the next council in the lanes (the stage owns it)
import { useCallback, useEffect, useMemo } from 'react';
import { Scale } from 'lucide-react';

import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

import { effectiveSubject } from './bench/queueModel';
import { useCouncilStore } from './councilStore';
import { FusedStage } from './galaxy/fused/FusedStage';
import { CouncilCta } from './queue/CouncilCta';
import { CouncilVerdict } from './verdict/CouncilVerdict';

export default function CouncilPage() {
  const { t } = useTranslation();
  const rawSubjects = useCouncilStore((s) => s.subjects);
  const fixtureDecisions = useCouncilStore((s) => s.fixtureDecisions);
  const subjectsStatus = useCouncilStore((s) => s.subjectsStatus);
  const openId = useCouncilStore((s) => s.openId);
  const openCouncil = useCouncilStore((s) => s.openCouncil);
  const pendingSubjectId = useSystemStore((s) => s.pendingCouncilSubjectId);
  const setPendingCouncilSubjectId = useSystemStore((s) => s.setPendingCouncilSubjectId);

  // `Q` opens the selected council full page and closes it again. It sits
  // at the route layer, below the verdict page's Esc.
  useAppKeyboard(
    useCallback((e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return false;
      if (e.key !== 'q' && e.key !== 'Q') return false;
      const s = useCouncilStore.getState();
      if (s.openId) s.openCouncil(null);
      else if (s.selectedId && s.subjects.some((x) => x.id === s.selectedId && x.latestRunId)) s.openCouncil(s.selectedId);
      return true;
    }, []),
    { priority: ROUTE_DECISION_PRIORITY },
  );

  // Leaving the page closes the open council, so a return lands on the sky
  // rather than inside a council the reader does not remember opening.
  useEffect(() => () => useCouncilStore.getState().openCouncil(null), []);

  /* The ledger's `ready` row hands off here: select that council (its stars
     light) and open its verdict page. The intent waits for the councils to
     arrive rather than being dropped on an empty list, and is cleared the
     moment it is honoured OR the moment the rows land without it, so a later
     visit opens the queue rather than re-opening a council the person has
     since decided. A subject id that no longer resolves is cleared too: a
     stale hand-off must not leave the page waiting forever. */
  useEffect(() => {
    if (!pendingSubjectId) return;
    if (subjectsStatus !== 'loaded') return;
    const s = useCouncilStore.getState();
    const found = s.subjects.find((row) => row.id === pendingSubjectId);
    setPendingCouncilSubjectId(null);
    if (!found) return;
    s.selectCouncil(found);
    if (found.latestRunId) s.openCouncil(found.id);
  }, [pendingSubjectId, subjectsStatus, setPendingCouncilSubjectId]);

  const open = useMemo(() => {
    const found = openId ? rawSubjects.find((s) => s.id === openId) : undefined;
    return found ? effectiveSubject(found, fixtureDecisions) : null;
  }, [openId, rawSubjects, fixtureDecisions]);
  const close = useCallback(() => openCouncil(null), [openCouncil]);

  return (
    <ContentBox data-testid="council-page">
      <ContentHeader
        icon={<Scale className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.sidebar.council}
        fitWidth
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <CouncilCta />
          </div>
        }
      />
      {/* `flex`, not the default body: the default wraps its children in a
          PADDED, `min-h-full` box inside a scroller, so a stage asking for
          `h-full` got the scroller's height MINUS the padding and the page
          ended short of the window with the field clipped inside it. The flex
          branch is `h-full` with no padding, which is what a stage needs. */}
      <ContentBody flex>
        <div data-testid="council-stage" className="relative flex min-h-0 flex-1 flex-col">
          {open ? <CouncilVerdict subject={open} onBack={close} /> : <FusedStage />}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
