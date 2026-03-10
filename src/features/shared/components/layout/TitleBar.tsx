import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy } from 'lucide-react';
import { IS_DESKTOP } from '@/lib/utils/platform/platform';

const appWindow = IS_DESKTOP ? getCurrentWindow() : null;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

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

  if (!IS_DESKTOP) return null;

  return (
    <div
      data-tauri-drag-region
      className="titlebar"
    >
      {/* App identity */}
      <div data-tauri-drag-region className="titlebar-title">
        <img src="/illustrations/logo-v1-geometric-nobg.png" alt="" className="titlebar-logo" draggable={false} />
        <span>Personas</span>
      </div>

      {/* Spacer — entire middle area is draggable */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Window controls */}
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-minimize"
          onClick={() => void appWindow?.minimize()}
          aria-label="Minimize"
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          className="titlebar-btn titlebar-btn-maximize"
          onClick={() => void appWindow?.toggleMaximize()}
          aria-label={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized
            ? <Copy size={12} strokeWidth={1.5} className="rotate-90" />
            : <Square size={12} strokeWidth={1.5} />
          }
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={() => void appWindow?.close()}
          aria-label="Close"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
