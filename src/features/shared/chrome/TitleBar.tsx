import { useState, useEffect } from 'react';
// eslint-disable-next-line no-restricted-imports -- TitleBar owns the native window chrome (minimize/maximize/close); the Tauri window API is intrinsic to this primitive and cannot be lifted without moving the window controls themselves out of the design-system layer.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy, ArrowLeft } from 'lucide-react';
import { IS_DESKTOP } from '@/lib/utils/platform/platform';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { TitleBarAmbient } from '@/features/shared/chrome/TitleBarAmbient';
import TitleBarDock from '@/features/shared/chrome/TitleBarDock';

const appWindow = IS_DESKTOP ? getCurrentWindow() : null;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
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

      {/* Spacer -- entire middle area is draggable */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Time-of-day chip -- inline, sits before the action tray */}
      <TitleBarAmbient />

      {/* Quick-action dock (search / schedules / review / monitor / notifications) */}
      <TitleBarDock />

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
