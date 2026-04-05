/**
 * Store & Memory Growth Monitor
 *
 * Tracks Zustand store update frequency and memory growth to detect
 * infinite update loops that cause OOM. Runs independently of rAF
 * (uses setInterval from ORIGINAL, unpatched API).
 *
 * Captures:
 * - Store update counts per second
 * - Heap growth rate
 * - DOM node growth rate
 * - React fiber tree depth (via __REACT_DEVTOOLS_GLOBAL_HOOK__)
 *
 * Writes findings to localStorage AND Rust log every 2 seconds.
 */

const _origSetInterval = window.setInterval.bind(window);
const _origClearInterval = window.clearInterval.bind(window);

interface StoreUpdateRecord {
  name: string;
  count: number;
  lastStack: string;
}

interface Snapshot {
  ts: number;
  heapMB: number;
  domNodes: number;
  stores: Record<string, number>;
}

const storeUpdates = new Map<string, StoreUpdateRecord>();
const snapshots: Snapshot[] = [];
let timerId: ReturnType<typeof setInterval> | null = null;

function getHeapMB(): number {
  const m = (performance as any).memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : -1;
}

function getStack(): string {
  return (new Error().stack ?? '').split('\n').slice(3, 8).join('\n');
}

/**
 * Call this from a Zustand store's subscribe or middleware to track updates.
 * E.g.: myStore.subscribe(() => trackStoreUpdate('agentStore'));
 */
export function trackStoreUpdate(name: string): void {
  const rec = storeUpdates.get(name);
  if (rec) {
    rec.count++;
    rec.lastStack = getStack();
  } else {
    storeUpdates.set(name, { name, count: 1, lastStack: getStack() });
  }
}

/**
 * Monkey-patch a Zustand store to auto-track updates.
 * Usage: monitorStore(useSystemStore, 'systemStore');
 */
export function monitorStore(store: { subscribe: (fn: () => void) => () => void }, name: string): () => void {
  return store.subscribe(() => trackStoreUpdate(name));
}

function tick(): void {
  const now = Date.now();
  const heapMB = getHeapMB();
  const domNodes = document.querySelectorAll('*').length;

  // Collect store counts and reset
  const storeCounts: Record<string, number> = {};
  let totalUpdates = 0;
  storeUpdates.forEach((rec, name) => {
    storeCounts[name] = rec.count;
    totalUpdates += rec.count;
  });

  const snap: Snapshot = { ts: now, heapMB, domNodes, stores: storeCounts };
  snapshots.push(snap);
  if (snapshots.length > 30) snapshots.shift(); // keep 60 seconds

  // Detect anomalies
  const alerts: string[] = [];

  // 1. Any store updating >20 times in 2 seconds
  storeUpdates.forEach((rec) => {
    if (rec.count > 20) {
      alerts.push(`STORE LOOP: ${rec.name} updated ${rec.count}x in 2s\n${rec.lastStack}`);
    }
    rec.count = 0; // reset for next tick
  });

  // 2. Heap growing >20MB in 2 seconds
  if (snapshots.length >= 2) {
    const prev = snapshots[snapshots.length - 2];
    const growth = heapMB - prev.heapMB;
    if (growth > 20) {
      alerts.push(`HEAP GROWTH: +${growth}MB in 2s (${prev.heapMB}→${heapMB}MB)`);
    }
  }

  // 3. DOM growing >200 nodes in 2 seconds (after initial render)
  if (snapshots.length >= 4) { // skip first 6 seconds
    const prev = snapshots[snapshots.length - 2];
    const growth = domNodes - prev.domNodes;
    if (growth > 200) {
      alerts.push(`DOM GROWTH: +${growth} nodes in 2s (${prev.domNodes}→${domNodes})`);
    }
  }

  // Log to console
  if (totalUpdates > 0 || alerts.length > 0) {
    const summary = `[store-monitor] heap=${heapMB}MB dom=${domNodes} stores=${JSON.stringify(storeCounts)}`;
    console.warn(summary);
    if (alerts.length > 0) {
      const alertMsg = `[STORE ALERT]\n${alerts.join('\n---\n')}`;
      console.error(alertMsg);
      // Write to Rust log
      try {
        (window as any).__TAURI_INTERNALS__?.invoke?.('log_frontend_error', {
          level: 'error', message: alertMsg + '\n' + summary
        });
      } catch {}
    }
  }

  // Always persist latest to localStorage (crash-safe)
  try {
    localStorage.setItem('__store_monitor', JSON.stringify({
      ts: new Date().toISOString(),
      heapMB,
      domNodes,
      stores: storeCounts,
      alerts,
      history: snapshots.slice(-5),
    }));
  } catch {}
}

export function startMonitor(): void {
  if (timerId) return;
  // Use ORIGINAL setInterval to avoid being tracked by callbackTracker
  timerId = _origSetInterval(tick, 2000);
  console.info('[store-monitor] Started — tracking store updates + memory growth');
}

export function stopMonitor(): void {
  if (timerId) { _origClearInterval(timerId); timerId = null; }
}

// Expose on window
(window as any).__STORE_MONITOR__ = {
  get snapshots() { return [...snapshots]; },
  get stores() { return Object.fromEntries(storeUpdates); },
  start: startMonitor,
  stop: stopMonitor,
};

// Auto-start
startMonitor();
