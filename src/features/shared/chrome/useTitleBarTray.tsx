import { lazy, Suspense, useEffect, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { getPollingCoordinator } from '@/lib/polling/pollingCoordinator';
import { PersonaMonitor } from '@/features/fleet/monitor';
import { QuickAnswerPopover } from '@/features/agents/quick-answer/QuickAnswerPopover';
import { FullScreenOverlay } from '@/features/shared/components/layout/FullScreenOverlay';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

// Lazy so the always-mounted tray doesn't pull this full-size surface into the
// main bundle — it loads only when summoned.
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
  const openPalette = useCommandPaletteStore((s) => s.openPalette);
  const pendingTotal = useSystemStore((s) => s.pendingCounts?.total ?? 0);
  const refreshPendingCounts = useSystemStore((s) => s.refreshPendingCounts);

  /**
   * The badge's own poll, on the shared coordinator's 30s bucket.
   *
   * Two things this fixes. The tray never fetched anything: the review badge
   * was only ever fresh because the SIDEBAR happened to poll
   * `pendingReviewCount` on its own ticker, so a window with the sidebar
   * collapsed showed a number that stopped moving. And the count it did read
   * came from a raw `setInterval` living beside it, which ticked on its own
   * offset and made SQLite warm its cache a second time for a badge.
   */
  useEffect(() => {
    const { dispose } = getPollingCoordinator().register(
      'titleBarPendingCounts',
      refreshPendingCounts,
      { interval: POLLING_CONFIG.dashboardRefresh.interval },
    );
    return dispose;
  }, [refreshPendingCounts]);

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

  /**
   * Everything the deck behind this capsule will actually deal.
   *
   * `pendingTotal` is the backend's sum over the SIX DB-backed queues — and it
   * already includes manual reviews, so `pendingReviewCount` must NOT be added
   * on top of it. This used to read `questionCount + pendingReviewCount`: two
   * of seven queues, so a reviewer with 26 pending ideas and nothing else saw
   * `0`. A confidently wrong number is worse than an absent one.
   *
   * Build questions are the one term added client-side, and that is not an
   * oversight to be tidied away into the Rust query: a halted CLI awaiting
   * input lives in `buildSessions` state and has no row anywhere to count.
   */
  const quickCount = pendingTotal + questionCount;
  const monitorAttention = unreadMessageCount + draftReadyCount;

  const notificationsOpen = headerOverlay === 'notifications';
  const reviewOpen = headerOverlay === 'quick-answer';
  const monitorOpen = headerOverlay === 'monitor';
  const isScheduleActive = headerOverlay === 'schedules';

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

  return {
    todayScheduleCount,
    quickCount,
    monitorAttention,
    unreadCount,
    running,
    notificationsOpen,
    reviewOpen,
    monitorOpen,
    isScheduleActive,
    toggleNotifications,
    toggleSchedules,
    toggleReview,
    toggleMonitor,
    openSearch,
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
