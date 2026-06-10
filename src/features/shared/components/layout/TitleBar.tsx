import { useState, useEffect } from 'react';
// eslint-disable-next-line no-restricted-imports -- TitleBar owns the native window chrome (minimize/maximize/close); the Tauri window API is intrinsic to this primitive and cannot be lifted without moving the window controls themselves out of the design-system layer.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy, Bell, CalendarClock, ArrowLeft, Search } from 'lucide-react';
import { IS_DESKTOP } from '@/lib/utils/platform/platform';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import ProcessActivityIndicator from '@/features/shared/components/layout/ProcessActivityIndicator';
import { TitleBarAmbient } from '@/features/shared/components/layout/TitleBarAmbient';
import { useTitleBarTray } from './useTitleBarTray';
import TitleBarVariantDock from './TitleBarVariantDock';
import TitleBarVariantLedger from './TitleBarVariantLedger';

const appWindow = IS_DESKTOP ? getCurrentWindow() : null;

/* PROTOTYPE SCAFFOLD — temporary tray-variant switcher (left side of the
   title bar). Removed at consolidation; the winning variant replaces the
   baseline tray. */
const TRAY_VARIANTS = ['base', 'dock', 'ledger'] as const;
type TrayVariant = (typeof TRAY_VARIANTS)[number];
const TRAY_VARIANT_KEY = 'titlebar-tray-variant';

function initialTrayVariant(): TrayVariant {
  const stored = localStorage.getItem(TRAY_VARIANT_KEY);
  return TRAY_VARIANTS.includes(stored as TrayVariant) ? (stored as TrayVariant) : 'base';
}

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [trayVariant, setTrayVariant] = useState<TrayVariant>(initialTrayVariant);
  const navigationHistory = useSystemStore((s) => s.navigationHistory);
  const navigateBack = useSystemStore((s) => s.navigateBack);
  // A fullscreen surface (e.g. the Fleet grid overlay) can register a Back
  // handler; surface the Back button so the user can dismiss it from here too.
  const backInterceptor = useSystemStore((s) => s.backInterceptor);
  // Unified header-overlay controller — Notifications & Monitor are mutually
  // exclusive, and route nav / Back close the active overlay (see uiSlice).
  const headerOverlay = useSystemStore((s) => s.headerOverlay);

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

  const pickTrayVariant = (v: TrayVariant) => {
    setTrayVariant(v);
    localStorage.setItem(TRAY_VARIANT_KEY, v);
  };

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

      {/* PROTOTYPE SCAFFOLD — tray variant switcher. Throwaway. */}
      <div
        className="titlebar-nodrag ml-3 flex items-center gap-0.5 rounded-full border border-primary/10 bg-secondary/40 p-0.5"
        data-testid="titlebar-tray-switcher"
      >
        {TRAY_VARIANTS.map((v) => (
          <button
            key={v}
            type="button"
            className={`h-5 rounded-full px-2 text-xs leading-none transition-colors ${
              trayVariant === v
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => pickTrayVariant(v)}
            aria-pressed={trayVariant === v}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Spacer -- entire middle area is draggable */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Time-of-day chip -- inline, sits before the action tray */}
      <TitleBarAmbient />

      {/* Quick-action tray — baseline or one of the prototype variants */}
      {trayVariant === 'base' && <BaselineTray />}
      {trayVariant === 'dock' && <TitleBarVariantDock />}
      {trayVariant === 'ledger' && <TitleBarVariantLedger />}

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

/**
 * The pre-prototype quick-action tray, byte-for-byte the markup that shipped
 * before the variant experiment — kept as the default A/B reference.
 * State wiring lives in useTitleBarTray (shared with the variants).
 */
function BaselineTray() {
  const { t } = useTranslation();
  const tray = useTitleBarTray();

  return (
    <div className="flex items-center gap-0.5 mr-1">
      {/* Search — opens the command palette (settings scope). Moved off the
          ambient illustration so the time-of-day art stays a window-drag
          region; lives left of the schedule icon. */}
      <button
        className="titlebar-btn"
        data-testid="titlebar-search"
        onClick={tray.openSearch}
        aria-label={t.settings.search.trigger_aria}
        title={t.settings.search.trigger_hint}
      >
        <Search size={20} strokeWidth={1.5} />
      </button>

      {/* Schedule calendar */}
      <button
        className={`titlebar-btn relative ${tray.isScheduleActive ? 'titlebar-btn-active' : ''}`}
        data-testid="titlebar-schedules"
        aria-pressed={tray.isScheduleActive}
        onClick={tray.toggleSchedules}
        aria-label={`Schedules${tray.todayScheduleCount > 0 ? ` (${tray.todayScheduleCount} today)` : ''}`}
        title={tray.todayScheduleCount > 0 ? `${tray.todayScheduleCount} scheduled today` : 'Schedules'}
      >
        <CalendarClock size={22} strokeWidth={1.5} />
        {tray.todayScheduleCount > 0 && (
          <span
            className="absolute bottom-1.5 right-1 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center text-[10px] font-semibold leading-none rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/25"
            style={{ filter: `brightness(${1 / tray.todayScheduleCount})` }}
          >
            {tray.todayScheduleCount}
          </span>
        )}
      </button>

      {/* Process activity indicator */}
      <ProcessActivityIndicator />

      {/* Notification bell — background highlight while the center is open */}
      <button
        className={`titlebar-btn relative ${tray.notificationsOpen ? 'titlebar-btn-active' : ''}`}
        data-testid="titlebar-notifications"
        aria-pressed={tray.notificationsOpen}
        onClick={tray.toggleNotifications}
        aria-label={`Notifications${tray.unreadCount > 0 ? ` (${tray.unreadCount} unread)` : ''}`}
        title={tray.unreadCount > 0 ? `${tray.unreadCount} unread notifications` : 'Notifications'}
      >
        <Bell size={22} strokeWidth={1.5} />
        {tray.unreadCount > 0 && (
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 min-w-[18px] h-[18px] px-[3px] flex items-center justify-center text-[12px] font-bold leading-none rounded-full bg-orange-500 text-foreground shadow-elevation-1">
            {tray.unreadCount > 9 ? '9+' : tray.unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
