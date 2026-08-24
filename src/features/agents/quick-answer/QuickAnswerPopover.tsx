// QuickAnswerPopover — the app-size triage surface for everything waiting on a
// human. Mounted from the title-bar dock's TrayOverlays when
// headerOverlay === 'quick-answer'.
//
// It used to be a 576px anchored panel over two queues (build questions +
// persona reviews). It is now a full-app deck over SEVEN: persona manual
// reviews, build questions, backlog ideas, workspace practices, policy
// proposals, evolution promotions and goal acceptance — unified by
// `triage/triageTypes` and fed by `triage/useUnifiedTriage`.
//
// The exported name and props are unchanged, so `TrayOverlays` never learned
// about any of this. `QuickAnswerBody` and its children are deliberately NOT
// deleted — the channel-timeline rail and the reviews rail still render them.

import { lazy, Suspense, useCallback, useMemo } from 'react';

import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';

import { useUnifiedTriage } from './triage/useUnifiedTriage';
import { useTriageCopy } from './triage/useTriageCopy';

// Lazy: the deck pulls in framer drag machinery and the markdown renderer, and
// most sessions never open it.
const TriageDeckVariant = lazy(() =>
  import('./triage/TriageDeckVariant').then((m) => ({ default: m.TriageDeckVariant })),
);

interface QuickAnswerPopoverProps {
  onClose: () => void;
  onOpenMonitor: () => void;
}

export function QuickAnswerPopover({ onClose, onOpenMonitor }: QuickAnswerPopoverProps) {
  const { t } = useTranslation();
  const copy = useTriageCopy();
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const setTeamsTab = useSystemStore((s) => s.setTeamsTab);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const setPendingExecutionFocus = useOverviewStore((s) => s.setPendingExecutionFocus);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  // Deep-link for questions that need the full builder (connector picker or
  // file attach) — mirrors QuickAnswerBody's openBuilder.
  //
  // Memoised, both of these: they are handed to `useUnifiedTriage`, which puts
  // them in the injected port bundle every verdict route reads. An unwrapped
  // arrow here re-created the bundle on every render, which re-created `decide`,
  // which re-rendered all three stacked cards on every keystroke.
  const openBuilder = useCallback(
    (personaId: string) => {
      setSidebarSection('personas');
      setEditorTab('matrix' as Parameters<typeof setEditorTab>[0]);
      selectPersona(personaId);
      onClose();
    },
    [setSidebarSection, setEditorTab, selectPersona, onClose],
  );

  // "See the run that raised this" — `GlobalExecutionList` watches
  // `pendingExecutionFocus` and pops that execution's detail modal (the same
  // handoff the notification centre and the schedule history rows use, so there
  // is nothing new to keep working here).
  const openRun = useCallback(
    (executionId: string) => {
      setPendingExecutionFocus(executionId);
      setOverviewTab('executions');
      setSidebarSection('overview');
      onClose();
    },
    [setPendingExecutionFocus, setOverviewTab, setSidebarSection, onClose],
  );

  // "Open the goals board" — the goal card's read-more branch. The board is
  // scoped to the ACTIVE project (`GoalsPage` reads `activeProjectId`), so
  // landing on the goal's own board means switching to its project first;
  // sending the reviewer to whichever project happened to be active would show
  // them a board the card is not on.
  const openGoalBoard = useCallback(
    (projectId: string) => {
      void setActiveProject(projectId);
      setSidebarSection('teams');
      setTeamsTab('goals');
      setGoalsTab('board');
      onClose();
    },
    [setActiveProject, setSidebarSection, setTeamsTab, setGoalsTab, onClose],
  );

  const hosts = useMemo(
    () => ({ onOpenBuilder: openBuilder, onOpenRun: openRun, onOpenGoalBoard: openGoalBoard }),
    [openBuilder, openRun, openGoalBoard],
  );

  const queue = useUnifiedTriage(copy, hosts);

  return (
    // NOT `fallback={null}`: the deck is a lazy chunk, and null left the
    // titlebar button visibly doing nothing for the whole first-open chunk-load
    // gap. The fallback claims the deck's exact geometry (opaque, pinned under
    // the title bar — the same classes `TriageDeckVariant` renders) with the
    // shared delayed header ghost inside. Both wrapper and ghost sit behind the
    // standard 150ms CSS animation delay, so a warm or prefetched chunk
    // resolves before a single pixel of fallback paints.
    <Suspense
      fallback={
        <div
          aria-hidden
          className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col bg-background animate-fade-in"
          style={{ animationDelay: '150ms' }}
        >
          <RouteChunkSkeleton showActions={false} showSubtitle={false} />
        </div>
      }
    >
      <TriageDeckVariant
        queue={queue}
        title={t.monitor.quick_title}
        onOpenMonitor={onOpenMonitor}
        onClose={onClose}
      />
    </Suspense>
  );
}

export default QuickAnswerPopover;
