import { useState, useEffect, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy, Bell, CalendarClock } from 'lucide-react';
import { IS_DESKTOP } from '@/lib/utils/platform/platform';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

const appWindow = IS_DESKTOP ? getCurrentWindow() : null;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const unreadCount = useNotificationCenterStore((s) => s.unreadCount);
  const toggleNotifications = useNotificationCenterStore((s) => s.toggle);
  const cronAgents = useOverviewStore((s) => s.cronAgents);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const sidebarSection = useSystemStore((s) => s.sidebarSection);

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

      {/* Spacer -- entire middle area is draggable */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Quick-action tray */}
      <div className="flex items-center gap-0.5 mr-1">
        {/* Schedule calendar */}
        <button
          className={`titlebar-btn relative transition-colors ${isScheduleActive ? 'text-blue-400' : ''}`}
          data-testid="titlebar-schedules"
          onClick={() => setSidebarSection('schedules')}
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

        {/* Notification bell */}
        <button
          className="titlebar-btn relative"
          data-testid="titlebar-notifications"
          onClick={toggleNotifications}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        >
          <Bell size={22} strokeWidth={1.5} />
          {unreadCount > 0 && (
            <span className="absolute top-2 right-1.5 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center text-[9px] font-bold leading-none rounded-full bg-orange-500 text-white shadow-elevation-1">
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
