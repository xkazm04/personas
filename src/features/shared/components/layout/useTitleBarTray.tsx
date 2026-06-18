import { lazy, Suspense, useEffect, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { PersonaMonitor } from '@/features/shared/components/layout/monitor';
import { QuickAnswerPopover } from '@/features/shared/components/layout/quick-answer/QuickAnswerPopover';
import { FullScreenOverlay } from '@/features/shared/components/layout/FullScreenOverlay';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

// Lazy so the always-mounted tray doesn't pull these full-size surfaces into the
// main bundle — they load only when summoned.
const GoalAcceptanceOverlay = lazy(() =>
  import('@/features/teams/sub_goals/GoalAcceptanceOverlay').then((m) => ({ default: m.GoalAcceptanceOverlay })),
);
const ScheduleTimeline = lazy(() => import('@/features/schedules/components/ScheduleTimeline'));

function OverlayFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <LoadingSpinner size="md" />
    </div>
  );
}

/**
 * State for the title-bar quick-action dock (`TitleBarDock`): every count the
 * dock surfaces (today's schedules, pending reviews/questions, fleet
 * attention, unread notifications), the open-state of each header surface,
 * and the toggle actions. Kept apart from the dock so the data wiring stays
 * readable next to the purely visual capsule markup.
 */
export function useTitleBarTray() {
  const unreadCount = useNotificationCenterStore((s) => s.unreadCount);
  const markAllNotificationsRead = useNotificationCenterStore((s) => s.markAllRead);
  const cronAgents = useOverviewStore((s) => s.cronAgents);
  const pendingReviewCount = useOverviewStore((s) => s.pendingReviewCount);
  const unreadMessageCount = useOverviewStore((s) => s.unreadMessageCount);
  const draftReadyCount = useOverviewStore((s) =>
    Object.values(s.activeProcesses).filter((p) => p.status === 'draft_ready').length,
  );
  const running = useOverviewStore((s) =>
    Object.values(s.activeProcesses).some((p) => p.status === 'running'),
  );
  const questionCount = useAgentStore((s) => {
    let n = 0;
    for (const sess of Object.values(s.buildSessions)) {
      if (sess.phase === 'awaiting_input') n += sess.pendingQuestions.length;
    }
    return n;
  });
  const headerOverlay = useSystemStore((s) => s.headerOverlay);
  const setHeaderOverlay = useSystemStore((s) => s.setHeaderOverlay);
  const pendingAcceptance = useSystemStore((s) => s.pendingAcceptanceCount);
  const refreshPendingAcceptance = useSystemStore((s) => s.refreshPendingAcceptance);
  const openPalette = useCommandPaletteStore((s) => s.openPalette);

  // Keep the pending-acceptance badge live — cheap COUNT on mount + a 30s poll
  // (goals complete in the background, so the badge can't be derived from the
  // page-scoped goals array).
  useEffect(() => {
    void refreshPendingAcceptance();
    const id = setInterval(() => void refreshPendingAcceptance(), 30_000);
    return () => clearInterval(id);
  }, [refreshPendingAcceptance]);

  const todayScheduleCount = useMemo(() => {
    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return cronAgents.filter((a) => {
      if (!a.trigger_enabled || !a.persona_enabled) return false;
      if (!a.next_trigger_at) return false;
      const next = new Date(a.next_trigger_at);
      return next >= now && next <= endOfDay;
    }).length;
  }, [cronAgents]);

  const quickCount = questionCount + pendingReviewCount;
  const monitorAttention = unreadMessageCount + draftReadyCount;

  const notificationsOpen = headerOverlay === 'notifications';
  const reviewOpen = headerOverlay === 'quick-answer';
  const monitorOpen = headerOverlay === 'monitor';
  const isScheduleActive = headerOverlay === 'schedules';
  const acceptanceOpen = headerOverlay === 'goal-acceptance';

  const toggleNotifications = () => {
    if (!notificationsOpen) {
      markAllNotificationsRead();
      setHeaderOverlay('notifications');
    } else {
      setHeaderOverlay('none');
    }
  };
  // Schedules now opens as a full-screen overlay (Persona-Monitor pattern), not a
  // sidebar navigation — so summoning it doesn't lose your place in the app.
  const toggleSchedules = () => setHeaderOverlay(isScheduleActive ? 'none' : 'schedules');
  const toggleReview = () => setHeaderOverlay(reviewOpen ? 'none' : 'quick-answer');
  const toggleMonitor = () => setHeaderOverlay(monitorOpen ? 'none' : 'monitor');
  const openSearch = () => openPalette('settings');
  // Pending-acceptance badge → full-screen acceptance overlay (same pattern).
  const openAcceptance = () => setHeaderOverlay(acceptanceOpen ? 'none' : 'goal-acceptance');

  return {
    todayScheduleCount,
    quickCount,
    monitorAttention,
    unreadCount,
    pendingAcceptance,
    running,
    notificationsOpen,
    reviewOpen,
    monitorOpen,
    isScheduleActive,
    acceptanceOpen,
    toggleNotifications,
    toggleSchedules,
    toggleReview,
    toggleMonitor,
    openSearch,
    openAcceptance,
  };
}

/**
 * Mounts the Persona Monitor + Quick Answer popover for the dock's review and
 * monitor capsules. AnimatePresence so each overlay plays its exit fade-out
 * on close (a bare conditional unmounts instantly, skipping it).
 */
export function TrayOverlays() {
  const headerOverlay = useSystemStore((s) => s.headerOverlay);
  const setHeaderOverlay = useSystemStore((s) => s.setHeaderOverlay);
  return (
    <AnimatePresence>
      {headerOverlay === 'monitor' && (
        <PersonaMonitor onClose={() => setHeaderOverlay('none')} />
      )}
      {headerOverlay === 'quick-answer' && (
        <QuickAnswerPopover
          onClose={() => setHeaderOverlay('none')}
          onOpenMonitor={() => setHeaderOverlay('monitor')}
        />
      )}
      {headerOverlay === 'goal-acceptance' && (
        <Suspense key="goal-acceptance" fallback={null}>
          <GoalAcceptanceOverlay onClose={() => setHeaderOverlay('none')} />
        </Suspense>
      )}
      {headerOverlay === 'schedules' && (
        <FullScreenOverlay key="schedules" onClose={() => setHeaderOverlay('none')} testId="schedules-overlay">
          <Suspense fallback={<OverlayFallback />}>
            <ScheduleTimeline />
          </Suspense>
        </FullScreenOverlay>
      )}
    </AnimatePresence>
  );
}
