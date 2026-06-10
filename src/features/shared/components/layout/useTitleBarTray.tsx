import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { PersonaMonitor } from '@/features/shared/components/layout/monitor';
import { QuickAnswerPopover } from '@/features/shared/components/layout/quick-answer/QuickAnswerPopover';

/**
 * PROTOTYPE SCAFFOLD — shared state for the title-bar quick-action tray
 * variants (see TitleBarVariantDock / TitleBarVariantLedger). Mirrors the
 * store wiring that lives in TitleBar's baseline tray + ProcessActivityIndicator
 * so every variant renders identical data through a different visual model.
 * Deleted (or folded into the winner) at consolidation.
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
  const sidebarSection = useSystemStore((s) => s.sidebarSection);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const headerOverlay = useSystemStore((s) => s.headerOverlay);
  const setHeaderOverlay = useSystemStore((s) => s.setHeaderOverlay);
  const openPalette = useCommandPaletteStore((s) => s.openPalette);

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
  const isScheduleActive = sidebarSection === 'schedules';

  const toggleNotifications = () => {
    if (!notificationsOpen) {
      markAllNotificationsRead();
      setHeaderOverlay('notifications');
    } else {
      setHeaderOverlay('none');
    }
  };
  const toggleSchedules = () => setSidebarSection(isScheduleActive ? 'home' : 'schedules');
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
 * Mounts the two overlays that normally live inside ProcessActivityIndicator
 * (which the variants do not render). Only mounted by variants — the baseline
 * tray keeps ProcessActivityIndicator and would double-mount otherwise.
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
    </AnimatePresence>
  );
}
