import { useState, useCallback, useRef, useEffect } from 'react';
import * as credApi from '@/api/vault/credentials';
import type { CredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';
import { toastCatch } from '@/lib/silentCatch';
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

/**
 * Manual "Test all" runner.
 *
 * Delegates the whole sweep to a single `healthcheck_all_credentials` IPC call
 * that runs the per-credential loop server-side. This replaced the previous
 * client-side fan-out of ~24 concurrent `healthcheck_credential` calls, whose
 * privileged-IPC stampede raced the `x-ipc-token` injection and surfaced valid
 * credentials as false "degraded" failures. The automated daily sweep runs
 * fully in-process via the engine's `CredentialHealthcheckSubscription` — this
 * hook only powers the explicit, user-initiated button.
 */
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
    cancelRef.current = false;
    if (mountedRef.current) {
      setIsRunning(true);
      // The server-side sweep doesn't stream per-credential progress, so the
      // bar is effectively indeterminate: seed it with the visible count and
      // snap to complete when the single call returns.
      setProgress({ done: 0, total: credentials.length, failed: 0 });
    }

    try {
      const result = await credApi.healthcheckAllCredentials();
      if (cancelRef.current || !mountedRef.current) return;

      // Mirror each outcome into the shared per-card health cache so
      // CredentialCard reflects the fresh result without waiting for a reload.
      const results: BulkResult[] = result.results.map((r) => {
        setHealthResultStatic(r.credentialId, { success: r.success, message: r.message });
        return {
          credentialId: r.credentialId,
          credentialName: r.credentialName,
          success: r.success,
          message: r.message,
          durationMs: r.durationMs,
        };
      });

      const slowest = [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
      const needsAttention = results.filter((r) => !r.success);
      const bulkSummary: BulkSummary = {
        total: result.total,
        passed: result.passed,
        failed: result.failed,
        results,
        slowest,
        needsAttention,
        completedAt: result.completedAt,
      };
      bulkSummaryCache.set('latest', bulkSummary);
      bulkSummaryCache.notify();
      setProgress({ done: result.total, total: result.total, failed: result.failed });

      // The sweep persisted fresh healthcheck metadata server-side; refresh the
      // store so the connections table reflects it.
      void useVaultStore.getState().fetchCredentials();
    } catch (e) {
      if (cancelRef.current || !mountedRef.current) return;
      toastCatch('useBulkHealthcheck:healthcheckAllCredentials')(e);
    } finally {
      if (mountedRef.current) setIsRunning(false);
    }
  }, []);

  const cancel = useCallback(() => {
    // The server-side sweep can't be aborted mid-flight; flip the flag so we
    // discard the result and reset the button when the call returns.
    cancelRef.current = true;
    if (mountedRef.current) setIsRunning(false);
  }, []);

  const dismiss = useCallback(() => {
    bulkSummaryCache.delete('latest');
    bulkSummaryCache.notify();
  }, []);

  return { isRunning, progress, summary, run, cancel, dismiss };
}
