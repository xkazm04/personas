/** rAF heartbeat freeze detector. Measures frame gaps and captures events when the main thread
 *  stalls. Activate by setting localStorage `__personas_freeze_detector` to any truthy value.
 *  When absent the module is a complete no-op (zero overhead). */

import { unpatchAll, currentCallback } from './callbackTracker';

const FLAG = '__personas_freeze_detector';
const STORAGE_KEY = '__personas_freeze_events';
const FREEZE_MS = 100;
const SEVERE_MS = 500;
const RING_SIZE = 50;

interface FreezeEvent {
  ts: string; duration: number; domNodes: number;
  memoryMB: number | null; callback: string | null;
}

let running = false, rafId = 0, lastFrame = 0;
let ring: FreezeEvent[] = [];

function memMB(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
}

function push(ev: FreezeEvent): void {
  ring.push(ev);
  if (ring.length > RING_SIZE) ring.shift();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ring)); } catch { /* quota */ }
}

async function reportSevere(ev: FreezeEvent): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('log_frontend_error', { level: 'error', message: `UI freeze: ${ev.duration}ms ${JSON.stringify(ev)}` });
  } catch { /* not in Tauri context */ }
}

function tick(now: number): void {
  if (!running) return;
  if (lastFrame > 0) {
    const gap = now - lastFrame;
    if (gap > FREEZE_MS) {
      const ev: FreezeEvent = {
        ts: new Date().toISOString(), duration: Math.round(gap),
        domNodes: document.querySelectorAll('*').length,
        memoryMB: memMB(), callback: currentCallback,
      };
      push(ev);
      console.warn(`[freeze-detector] ${ev.duration}ms freeze`, ev);
      if (gap > SEVERE_MS) reportSevere(ev);
    }
  }
  lastFrame = now;
  rafId = requestAnimationFrame(tick);
}

function start(): void {
  if (running) return;
  running = true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) ring = JSON.parse(stored) as FreezeEvent[];
  } catch { ring = []; }
  // Callback patching disabled — it patches Promise.then, MutationObserver,
  // ResizeObserver constructors which can break React 19's internal scheduling.
  // patchCallbacks();
  lastFrame = 0;
  rafId = requestAnimationFrame(tick);
  console.info('[freeze-detector] started');
}

function stop(): void {
  if (!running) return;
  running = false;
  cancelAnimationFrame(rafId);
  unpatchAll();
  console.info('[freeze-detector] stopped');
}

// Console API: window.__FREEZE_DETECTOR__
(window as unknown as Record<string, unknown>).__FREEZE_DETECTOR__ = {
  get enabled() { return running; },
  start() { localStorage.setItem(FLAG, '1'); start(); },
  stop() { localStorage.removeItem(FLAG); stop(); },
  get events() { return [...ring]; },
  clear() { ring = []; localStorage.removeItem(STORAGE_KEY); },
};

// Always active during freeze investigation — revert to localStorage check after fix
start();
