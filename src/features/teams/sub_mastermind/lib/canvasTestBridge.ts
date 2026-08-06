// Dev/test door into the canvas action grammar (canvasActionStore).
//
// The :17320 test-automation harness drives the live app through `/eval`,
// which is fire-and-forget — it cannot await a promise across calls. So this
// bridge exposes `window.__mmCanvas.dispatch(action)` AND mirrors every
// settled result into a hidden DOM stash (`data-testid="mm-action-result"`)
// that a later `/query` call reads back. The established eval→DOM-readback
// pattern, applied to the canvas.
//
// Dev-gated: `import.meta.env.DEV` covers `tauri:dev:test` (the live-test
// vehicle) and plain dev, and keeps the global out of shipped bundles. Athena's
// v2 door will be a companion op through a Tauri event bridge, not this.
import { useEffect } from 'react';

import {
  dispatchCanvasAction,
  type CanvasActionRequest,
  type CanvasActionResult,
} from './canvasActionStore';

interface CanvasBridge {
  /** Resolves with the settled envelope; also stashed at `last` + in the DOM. */
  dispatch: (action: CanvasActionRequest) => Promise<CanvasActionResult>;
  last: CanvasActionResult | null;
}

type BridgeWindow = typeof window & { __mmCanvas?: CanvasBridge };

const STASH_TESTID = 'mm-action-result';

/** Mounted by CanvasShell — the bridge exists exactly while a shell can answer. */
export function useCanvasTestBridge(): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const stash = document.createElement('div');
    stash.setAttribute('data-testid', STASH_TESTID);
    stash.style.display = 'none';
    document.body.appendChild(stash);
    const bridge: CanvasBridge = {
      last: null,
      dispatch: (action) =>
        dispatchCanvasAction(action).then((result) => {
          bridge.last = result;
          stash.textContent = JSON.stringify(result);
          return result;
        }),
    };
    (window as BridgeWindow).__mmCanvas = bridge;
    return () => {
      stash.remove();
      delete (window as BridgeWindow).__mmCanvas;
    };
  }, []);
}
