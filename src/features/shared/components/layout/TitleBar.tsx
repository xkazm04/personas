import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy, Bell } from 'lucide-react';
import { IS_DESKTOP } from '@/lib/utils/platform/platform';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { useTranslation } from '@/i18n/useTranslation';

const appWindow = IS_DESKTOP ? getCurrentWindow() : null;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const unreadCount = useNotificationCenterStore((s) => s.unreadCount);
  const toggleNotifications = useNotificationCenterStore((s) => s.toggle);

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

      {/* Notification bell */}
      <button
        className="titlebar-btn relative mr-1"
        data-testid="titlebar-notifications"
        onClick={toggleNotifications}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell size={14} strokeWidth={1.5} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center text-[9px] font-bold leading-none rounded-full bg-orange-500 text-white shadow-elevation-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Window controls */}
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-minimize"
          data-testid="titlebar-minimize"
          onClick={() => void appWindow?.minimize()}
          aria-label={t.chrome.minimize}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          className="titlebar-btn titlebar-btn-maximize"
          data-testid="titlebar-maximize"
          onClick={() => void appWindow?.toggleMaximize()}
          aria-label={maximized ? t.chrome.restore : t.chrome.maximize}
        >
          {maximized
            ? <Copy size={12} strokeWidth={1.5} className="rotate-90" />
            : <Square size={12} strokeWidth={1.5} />
          }
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          data-testid="titlebar-close"
          onClick={() => void appWindow?.close()}
          aria-label={t.chrome.close_window}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
