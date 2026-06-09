import { useState, useEffect, useMemo } from 'react';
// eslint-disable-next-line no-restricted-imports -- TitleBar owns the native window chrome (minimize/maximize/close); the Tauri window API is intrinsic to this primitive and cannot be lifted without moving the window controls themselves out of the design-system layer.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy, Bell, CalendarClock, ArrowLeft, Search } from 'lucide-react';
import { IS_DESKTOP } from '@/lib/utils/platform/platform';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { useTranslation } from '@/i18n/useTranslation';
import ProcessActivityIndicator from '@/features/shared/components/layout/ProcessActivityIndicator';
import { TitleBarAmbient } from '@/features/shared/components/layout/TitleBarAmbient';

const appWindow = IS_DESKTOP ? getCurrentWindow() : null;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const unreadCount = useNotificationCenterStore((s) => s.unreadCount);
  const markAllNotificationsRead = useNotificationCenterStore((s) => s.markAllRead);
  const cronAgents = useOverviewStore((s) => s.cronAgents);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const sidebarSection = useSystemStore((s) => s.sidebarSection);
  const navigationHistory = useSystemStore((s) => s.navigationHistory);
  const navigateBack = useSystemStore((s) => s.navigateBack);
  // A fullscreen surface (e.g. the Fleet grid overlay) can register a Back
  // handler; surface the Back button so the user can dismiss it from here too.
  const backInterceptor = useSystemStore((s) => s.backInterceptor);
  // Unified header-overlay controller — Notifications & Monitor are mutually
  // exclusive, and route nav / Back close the active overlay (see uiSlice).
  const headerOverlay = useSystemStore((s) => s.headerOverlay);
  const setHeaderOverlay = useSystemStore((s) => s.setHeaderOverlay);
  const openPalette = useCommandPaletteStore((s) => s.openPalette);
  const notificationsOpen = headerOverlay === 'notifications';

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

  useEffect(() => {
    if (!appWindow) return;
    // Sync initial state
    void appWindow.isMaximized().then(setMaximized);
    // Listen for resize changes
    let unlisten: (() => void) | undefined;
    void appWindow.onResized(async () => {
      setMaximized(await appWindow.isMaximized());
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  const { t } = useTranslation();

  // Opening the bell marks everything read (clears the unread badge); closing
  // is a plain toggle. Mirrors how most notification trays behave — surfacing
  // the panel is the acknowledgement.
  const handleToggleNotifications = () => {
    if (!notificationsOpen) {
      markAllNotificationsRead();
      setHeaderOverlay('notifications'); // structurally closes the Monitor if open
    } else {
      setHeaderOverlay('none');
    }
  };

  if (!IS_DESKTOP) return null;

  const isScheduleActive = sidebarSection === 'schedules';

  return (
    <div
      data-tauri-drag-region
      className="titlebar"
      role="banner"
    >
      {/* App identity */}
      <div data-tauri-drag-region className="titlebar-title">
        <img src="/illustrations/logo-v1-geometric-nobg.png" alt="" className="titlebar-logo" draggable={false} />
        <span>{t.chrome.app_title}</span>
      </div>

      {/* Back-history button — closes an open header overlay first, otherwise
       *  pops the last sidebar location (NAV_HISTORY_MAX cap in the store).
       *  Shown whenever there's somewhere to go back to: an open overlay OR a
       *  non-empty history. Sits next to the logo so nav controls cluster. */}
      {(headerOverlay !== 'none' || navigationHistory.length > 0 || backInterceptor !== null) && (
        <button
          type="button"
          className="titlebar-btn ml-1"
          data-testid="titlebar-back"
          onClick={navigateBack}
          aria-label={t.common.back}
          title={t.common.back}
        >
          <ArrowLeft size={20} strokeWidth={1.5} />
        </button>
      )}

      {/* Spacer -- entire middle area is draggable */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Time-of-day chip -- inline, sits before the action tray */}
      <TitleBarAmbient />

      {/* Quick-action tray */}
      <div className="flex items-center gap-0.5 mr-1">
        {/* Search — opens the command palette (settings scope). Moved off the
            ambient illustration so the time-of-day art stays a window-drag
            region; lives left of the schedule icon. */}
        <button
          className="titlebar-btn"
          data-testid="titlebar-search"
          onClick={() => openPalette('settings')}
          aria-label={t.settings.search.trigger_aria}
          title={t.settings.search.trigger_hint}
        >
          <Search size={20} strokeWidth={1.5} />
        </button>

        {/* Schedule calendar */}
        <button
          className={`titlebar-btn relative ${isScheduleActive ? 'titlebar-btn-active' : ''}`}
          data-testid="titlebar-schedules"
          aria-pressed={isScheduleActive}
          onClick={() => setSidebarSection(isScheduleActive ? 'home' : 'schedules')}
          aria-label={`Schedules${todayScheduleCount > 0 ? ` (${todayScheduleCount} today)` : ''}`}
          title={todayScheduleCount > 0 ? `${todayScheduleCount} scheduled today` : 'Schedules'}
        >
          <CalendarClock size={22} strokeWidth={1.5} />
          {todayScheduleCount > 0 && (
            <span
              className="absolute bottom-1.5 right-1 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center text-[10px] font-semibold leading-none rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/25"
              style={{ filter: `brightness(${1 / todayScheduleCount})` }}
            >
              {todayScheduleCount}
            </span>
          )}
        </button>

        {/* Process activity indicator */}
        <ProcessActivityIndicator />

        {/* Notification bell — background highlight while the center is open */}
        <button
          className={`titlebar-btn relative ${notificationsOpen ? 'titlebar-btn-active' : ''}`}
          data-testid="titlebar-notifications"
          aria-pressed={notificationsOpen}
          onClick={handleToggleNotifications}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        >
          <Bell size={22} strokeWidth={1.5} />
          {unreadCount > 0 && (
            <span className="absolute top-2 right-1.5 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center text-[9px] font-bold leading-none rounded-full bg-orange-500 text-foreground shadow-elevation-1">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Divider between actions and window chrome */}
      <div className="w-px h-5 bg-primary/10 mx-1" />

      {/* Window controls */}
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-minimize"
          data-testid="titlebar-minimize"
          onClick={() => void appWindow?.minimize()}
          aria-label={t.chrome.minimize}
        >
          <Minus size={18} strokeWidth={1.5} />
        </button>
        <button
          className="titlebar-btn titlebar-btn-maximize"
          data-testid="titlebar-maximize"
          onClick={() => void appWindow?.toggleMaximize()}
          aria-label={maximized ? t.chrome.restore : t.chrome.maximize}
        >
          {maximized
            ? <Copy size={15} strokeWidth={1.5} className="rotate-90" />
            : <Square size={15} strokeWidth={1.5} />
          }
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          data-testid="titlebar-close"
          onClick={() => void appWindow?.close()}
          aria-label={t.chrome.close_window}
        >
          <X size={18} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
