import { lazy, Suspense, useEffect, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { getPollingCoordinator } from '@/lib/polling/pollingCoordinator';
import { FullScreenOverlay } from '@/features/shared/components/layout/FullScreenOverlay';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { CircuitBreakerIndicator } from '@/features/agents/sub_executions/components/CircuitBreakerIndicator';

// Lazy so the always-mounted tray doesn't pull this full-size surface into the
// main bundle — it loads only when summoned.
const ScheduleTimeline = lazy(() => import('@/features/schedules/components/ScheduleTimeline'));
// And the two heaviest surfaces of all: the Persona Monitor drags the whole
// fleet feature tree (channel grid, triage columns, drawer, grid view) and the
// Quick Answer deck pulls the unified 7-queue triage machinery. Both were
// static imports here, which put them in the main bundle for every window that
// never opens them.
const PersonaMonitor = lazy(() =>
  import('@/features/fleet/monitor').then((m) => ({ default: m.PersonaMonitor })),
);
const QuickAnswerPopover = lazy(() =>
  import('@/features/agents/quick-answer/QuickAnswerPopover')
    .then((m) => ({ default: m.QuickAnswerPopover })),
);

/**
 * Chunk fallback for a lazily-summoned full-screen overlay: the overlay's OWN
 * opaque shell (same fixed geometry as the surface about to mount, so the swap
 * moves nothing) with the shared delayed header ghost under it. Warm chunks
 * resolve before its 150ms delay elapses, so this paints only when the chunk
 * is genuinely cold. Never a spinner (banned for surfaces) and never null
 * (which flashes the app underneath on first summon).
 */
function OverlayChunkFallback({ topClass }: { topClass: string }) {
  return (
    <div
      aria-hidden
      className={`fixed inset-x-0 bottom-0 ${topClass} z-50 bg-background flex flex-col px-6 pt-3`}
    >
      <RouteChunkSkeleton showIcon showActions={false} showSubtitle={false} />
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
  const unreadReportCount = useOverviewStore((s) => s.unreadReportCount);
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
  const monitorAttention = unreadReportCount + draftReadyCount;

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
 * monitor capsules, plus the provider circuit-breaker indicator.
 *
 * The breaker indicator had ZERO importers repo-wide until 2026-09-02, so a
 * tripped provider reached no pixel and the user saw only a wall of
 * unexplained failed runs. This is its mount, and it is deliberately the
 * least-noisy slot in the app: the dock's capsule strip is a 36px key row
 * that a full expandable panel cannot live in, and the title bar clips it —
 * whereas here the indicator is a fixed sliver pinned under the title bar
 * that occupies NO layout space and renders `null` outright while healthy
 * (and while its first status is still in flight). It costs nothing until
 * something is actually wrong, and then it is on every page at once. AnimatePresence so each overlay plays its exit fade-out
 * on close (a bare conditional unmounts instantly, skipping it).
 *
 * Exit + lazy: each keyed `<Suspense>` is the AnimatePresence child, and on
 * close AnimatePresence keeps that whole subtree mounted while the inner
 * motion root (already chunk-loaded by then) receives the exit signal through
 * PresenceContext — the same proven contract the dispatch overlay below has
 * always used, so lazification does not skip the fade-out.
 */
export function TrayOverlays() {
  const headerOverlay = useSystemStore((s) => s.headerOverlay);
  const setHeaderOverlay = useSystemStore((s) => s.setHeaderOverlay);
  return (
    <>
      {/* Not inside AnimatePresence: it is not an overlay that opens and
          closes with the dock — it appears when the fleet's providers break. */}
      <div className="pointer-events-none fixed right-3 top-[calc(var(--titlebar-height,40px)+0.5rem)] z-40 w-80 max-w-[calc(100vw-1.5rem)] [&>*]:pointer-events-auto">
        <CircuitBreakerIndicator />
      </div>
    <AnimatePresence>
      {headerOverlay === 'monitor' && (
        <Suspense
          key="monitor"
          fallback={<OverlayChunkFallback topClass="top-[var(--titlebar-height,40px)]" />}
        >
          <PersonaMonitor onClose={() => setHeaderOverlay('none')} />
        </Suspense>
      )}
      {headerOverlay === 'quick-answer' && (
        // top-12 mirrors the triage deck's own shell (TriageDeckVariant).
        <Suspense key="quick-answer" fallback={<OverlayChunkFallback topClass="top-12" />}>
          <QuickAnswerPopover
            onClose={() => setHeaderOverlay('none')}
            onOpenMonitor={() => setHeaderOverlay('monitor')}
          />
        </Suspense>
      )}
      {headerOverlay === 'schedules' && (
        <FullScreenOverlay key="schedules" onClose={() => setHeaderOverlay('none')} testId="schedules-overlay">
          {/* The shell above is the permanent chrome; the fallback is the shared
              delayed ghost — never a spinner (the old OverlayFallback rendered
              LoadingSpinner, which renders null: a blank gap posing as feedback). */}
          <Suspense fallback={<RouteChunkSkeleton />}>
            <ScheduleTimeline />
          </Suspense>
        </FullScreenOverlay>
      )}
    </AnimatePresence>
    </>
  );
}
