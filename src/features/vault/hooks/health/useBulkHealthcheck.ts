import { useState, useCallback, useRef, useEffect } from 'react';
import * as credApi from '@/api/vault/credentials';
import { toCredentialMetadata, type CredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';
import { createModuleCache, useModuleCacheSubscription } from '@/hooks/utility/data/useModuleSubscription';
import { setHealthResultStatic } from './useCredentialHealth';

// -- Bulk-specific state cache (separate from per-key health cache) --

export interface BulkResult {
  credentialId: string;
  credentialName: string;
  success: boolean;
  message: string;
  durationMs: number;
}

export interface BulkSummary {
  total: number;
  passed: number;
  failed: number;
  results: BulkResult[];
  slowest: BulkResult[];
  needsAttention: BulkResult[];
  completedAt: string;
}

const bulkSummaryCache = createModuleCache<'latest', BulkSummary>();

// -- Hook -------------------------------------------------------------

const CONCURRENCY = 3;
const STORE_FLUSH_INTERVAL = 5;

export function useBulkHealthcheck() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  // Subscribe to bulk summary cache for re-renders
  useModuleCacheSubscription(bulkSummaryCache as never);
  const summary = bulkSummaryCache.get('latest') ?? null;

  const run = useCallback(async (credentials: CredentialMetadata[]) => {
    if (credentials.length === 0) return;
    cancelRef.current = false;
    if (mountedRef.current) {
      setIsRunning(true);
      setProgress({ done: 0, total: credentials.length, failed: 0 });
    }

    const results: BulkResult[] = [];
    let doneCount = 0;
    let failedCount = 0;

    // Batch store updates: collect patched credentials and flush periodically
    const pendingUpdates = new Map<string, CredentialMetadata>();
    let updatesSinceFlush = 0;

    const flushStoreUpdates = () => {
      if (pendingUpdates.size === 0) return;
      const patches = new Map(pendingUpdates);
      pendingUpdates.clear();
      updatesSinceFlush = 0;
      useVaultStore.setState((s) => ({
        credentials: s.credentials.map((c) => patches.get(c.id) ?? c),
      }));
    };

    // Process in batches of CONCURRENCY
    const queue = [...credentials];

    const worker = async () => {
      while (queue.length > 0 && !cancelRef.current) {
        const cred = queue.shift();
        if (!cred) break;

        const start = performance.now();
        let success = false;
        let message = 'Cancelled';

        if (!cancelRef.current) {
          try {
            const hcResult = await credApi.healthcheckCredential(cred.id);
            success = hcResult.success;
            message = hcResult.message;

            // Sync result into the shared module-level health cache so
            // CredentialCard picks up fresh data instead of stale metadata.
            setHealthResultStatic(cred.id, { success, message });

            // Persist healthcheck metadata via atomic patch (avoids stale overwrites)
            const nowIso = new Date().toISOString();
            const patch: Record<string, unknown> = {
              healthcheck_last_success: hcResult.success,
              healthcheck_last_message: hcResult.message,
              healthcheck_last_tested_at: nowIso,
            };
            if (hcResult.success) patch.healthcheck_last_success_at = nowIso;

            try {
              const updatedRaw = await credApi.patchCredentialMetadata(cred.id, patch);
              const updated = toCredentialMetadata(updatedRaw);
              pendingUpdates.set(cred.id, updated);
              updatesSinceFlush++;
              if (updatesSinceFlush >= STORE_FLUSH_INTERVAL) {
                flushStoreUpdates();
              }
            } catch { /* intentional: non-critical -- healthcheck metadata persistence is best-effort */ }
          } catch (e) {
            success = false;
            message = e instanceof Error ? e.message : 'Healthcheck failed';
          }
        }

        const durationMs = performance.now() - start;
        results.push({
          credentialId: cred.id,
          credentialName: cred.name,
          success,
          message,
          durationMs,
        });
        doneCount++;
        if (!success) failedCount++;
        if (mountedRef.current) {
          setProgress({ done: doneCount, total: credentials.length, failed: failedCount });
        }
      }
    };

    // Launch CONCURRENCY workers
    const workers = Array.from({ length: Math.min(CONCURRENCY, credentials.length) }, () => worker());
    await Promise.all(workers);

    // Flush any remaining batched store updates
    flushStoreUpdates();

    // Build summary
    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const slowest = [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
    const needsAttention = results.filter((r) => !r.success);

    const bulkSummary: BulkSummary = {
      total: results.length,
      passed,
      failed,
      results,
      slowest,
      needsAttention,
      completedAt: new Date().toISOString(),
    };

    if (mountedRef.current) {
      bulkSummaryCache.set('latest', bulkSummary);
      bulkSummaryCache.notify();
      setIsRunning(false);
    }

  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const dismiss = useCallback(() => {
    bulkSummaryCache.delete('latest');
    bulkSummaryCache.notify();
  }, []);

  return { isRunning, progress, summary, run, cancel, dismiss };
}
