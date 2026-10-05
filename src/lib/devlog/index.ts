// devlog - the WebView's producers into the app's JSONL log (see buffer.ts).
// `installDevlog()` is called once from main.tsx; everything else is the
// producer surface the instrumented modules import.

import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { DevlogRecord } from '@/lib/bindings/DevlogRecord';
import {
  DEVLOG_FLUSH_TIMEOUT_MS,
  DEVLOG_INGEST_COMMAND,
  installDevlogBuffer,
} from './buffer';
import { startLongTaskObserver } from './perf';

export {
  devlog,
  flushDevlog,
  setDevlogRouteReader,
  DEVLOG_INGEST_COMMAND,
  type DevlogInput,
} from './buffer';
export { recordError, errorKindOf } from './errors';

/** The batch transport: one `devlog_ingest` call with a short timeout. */
export function sendDevlogBatch(records: DevlogRecord[]): Promise<void> {
  return invokeWithTimeout<void>(DEVLOG_INGEST_COMMAND, { records }, { timeoutMs: DEVLOG_FLUSH_TIMEOUT_MS });
}

/** Start flushing (timers + pagehide), and in DEV the long-task observer. */
export function installDevlog(): () => void {
  // DEV-gated so a production bundle never constructs a PerformanceObserver.
  const stopLongTasks = import.meta.env.DEV ? startLongTaskObserver() : null;
  // index.html's boot-time error handlers stand down from here on, so an
  // error is never recorded by both them and main.tsx's handlers.
  (window as unknown as { __personasDevlogReady?: boolean }).__personasDevlogReady = true;
  return installDevlogBuffer({
    send: sendDevlogBatch,
    onTeardown: stopLongTasks ?? undefined,
  });
}
