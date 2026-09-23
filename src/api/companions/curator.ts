import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';

/**
 * The fleet's development sessions as structure-only process instances.
 *
 * Runs the registry's `process-sessions.mjs` through Curator's instrument door. A cold read
 * walks every fleet transcript (measured ~20 s over ~2,100 files); warm it only stats them.
 */
export const readCuratorProcess = () =>
  invoke<CuratorProcess>('curator_process_read', {}, { timeoutMs: 200_000 });
