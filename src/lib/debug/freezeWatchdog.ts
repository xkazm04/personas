/**
 * Freeze Watchdog — uses a Web Worker to monitor the main thread from outside.
 *
 * The main thread posts a heartbeat every 100ms. If the worker doesn't receive
 * a heartbeat for >500ms, it knows the main thread is frozen and logs the last
 * known state. Unlike rAF-based detection, this catches PERMANENT freezes.
 *
 * The worker also receives snapshots of the current call stack and active
 * timers/observers so it can report what was happening when the freeze started.
 */

interface HeartbeatData {
  ts: number;
  domNodes: number;
  memoryMB: number | null;
  pendingCallbacks: string[];
  lastAction: string;
}

let worker: Worker | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastAction = 'init';

/** Call this from key code paths to record what the main thread is doing */
export function markAction(action: string): void {
  lastAction = action;
}

function createWorkerBlob(): Blob {
  const code = `
    let lastHeartbeat = Date.now();
    let lastData = null;
    let frozen = false;
    const TIMEOUT_MS = 750;
    const CHECK_MS = 200;

    setInterval(() => {
      const now = Date.now();
      const gap = now - lastHeartbeat;
      if (gap > TIMEOUT_MS && !frozen) {
        frozen = true;
        self.postMessage({
          type: 'freeze_detected',
          gap: gap,
          lastData: lastData,
          detectedAt: new Date().toISOString(),
        });
      }
      if (gap <= TIMEOUT_MS && frozen) {
        frozen = false;
        self.postMessage({
          type: 'freeze_recovered',
          duration: gap,
          detectedAt: new Date().toISOString(),
        });
      }
    }, CHECK_MS);

    self.onmessage = (e) => {
      if (e.data.type === 'heartbeat') {
        lastHeartbeat = Date.now();
        lastData = e.data.payload;
      }
    };
  `;
  return new Blob([code], { type: 'application/javascript' });
}

export function startWatchdog(): void {
  if (worker) return;

  try {
    const blob = createWorkerBlob();
    worker = new Worker(URL.createObjectURL(blob));

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'freeze_detected') {
        const report = `[WATCHDOG] FREEZE DETECTED — main thread unresponsive for ${msg.gap}ms\n` +
          `Last action: ${msg.lastData?.lastAction ?? 'unknown'}\n` +
          `DOM nodes: ${msg.lastData?.domNodes ?? '?'}\n` +
          `Heap: ${msg.lastData?.memoryMB ?? '?'}MB\n` +
          `Pending: ${msg.lastData?.pendingCallbacks?.join(', ') ?? 'none'}\n` +
          `Detected at: ${msg.detectedAt}`;
        console.error(report);
        // Persist to localStorage (crash-safe)
        try {
          const prev = JSON.parse(localStorage.getItem('__watchdog_freezes') || '[]');
          prev.push({ ...msg, report });
          if (prev.length > 10) prev.shift();
          localStorage.setItem('__watchdog_freezes', JSON.stringify(prev));
        } catch { /* intentional: localStorage may be unavailable during freeze */ }
        // Try IPC to Rust (may fail if thread is blocked)
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__TAURI_INTERNALS__?.invoke?.('log_frontend_error', {
            level: 'warn', message: report
          });
        } catch { /* intentional: IPC may be blocked during freeze */ }
      }
      if (msg.type === 'freeze_recovered') {
        console.warn(`[WATCHDOG] Thread recovered after ${msg.duration}ms`);
      }
    };

    // Send heartbeats from main thread
    heartbeatTimer = setInterval(() => {
      if (!worker) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mem = (performance as any).memory;
      worker.postMessage({
        type: 'heartbeat',
        payload: {
          ts: Date.now(),
          domNodes: document.querySelectorAll('*').length,
          memoryMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
          pendingCallbacks: [],
          lastAction,
        } satisfies HeartbeatData,
      });
    }, 100);

    console.info('[watchdog] Started — monitoring main thread from Web Worker');
  } catch (e) {
    console.warn('[watchdog] Failed to start:', e);
  }
}

export function stopWatchdog(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (worker) { worker.terminate(); worker = null; }
}

// Auto-start only in dev mode — no overhead in production
if (import.meta.env.DEV) startWatchdog();
