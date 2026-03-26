import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as credApi from '@/api/vault/credentials';
import { testCredentialDesignHealthcheck, type CredentialDesignHealthcheckResult } from '@/api/vault/credentialDesign';
import { encryptWithSessionKey } from '@/lib/utils/platform/crypto';
import { toCredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from "@/stores/vaultStore";
import { createModuleCache, useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';

// -- Types -------------------------------------------------------------

/**
 * Health result storage contract
 *
 * Health results exist in three layers with the following priority:
 *
 * 1. **Module cache** (authoritative for the current session)
 *    `resultCache` -- a module-level `ModuleCache<string, HealthResult>`.
 *    Populated by `checkStored`, `checkPreview`, `checkDesign`, or `setResult`.
 *    Cleared on page reload. This is the source of truth when present.
 *
 * 2. **Credential metadata** (persisted, possibly stale)
 *    `credential.healthcheck_last_success` / `healthcheck_last_message` /
 *    `healthcheck_last_tested_at` -- written by `checkStored` via
 *    `patchCredentialMetadata` after each healthcheck. Survives reloads.
 *    Used as a fallback in `CredentialCard` when the module cache has
 *    no entry for that credential ID.
 *
 * 3. **Zustand credentialSlice** (pass-through, not authoritative)
 *    `credentialSlice.healthcheckCredential` calls the API but does NOT
 *    cache the result. It exists for one-off calls from non-hook code.
 *    Consumers should prefer `useCredentialHealth` for cached results.
 *
 * When `CredentialCard` falls back to persisted metadata, it marks the
 * result with `isStale: true` so the UI can show a staleness indicator.
 */

export interface HealthResult {
  success: boolean;
  message: string;
  /** Only populated for design-flow healthchecks */
  healthcheckConfig?: Record<string, unknown> | null;
  lastSuccessfulTestAt?: string | null;
  /** True when this result was loaded from persisted metadata rather than a live check. */
  isStale?: boolean;
}

type CredentialHealthPreviewTarget = {
  mode: 'preview';
  serviceType?: string | null;
};

type CredentialHealthTarget = string | CredentialHealthPreviewTarget;

// -- Shared module-level caches ---------------------------------------

const resultCache = createModuleCache<string, HealthResult>();
const loadingRefCounts = new Map<string, number>();

function beginLoading(key: string) {
  loadingRefCounts.set(key, (loadingRefCounts.get(key) ?? 0) + 1);
}

function endLoading(key: string) {
  const next = (loadingRefCounts.get(key) ?? 0) - 1;
  if (next <= 0) loadingRefCounts.delete(key);
  else loadingRefCounts.set(key, next);
}

// -- Hook --------------------------------------------------------------

/**
 * Unified credential health service.
 *
 * All healthcheck results are cached in a shared `ModuleCache<string, HealthResult>`
 * so that any component reading the same key sees the same data without
 * redundant API calls. Pass either:
 * - a credential ID string for stored credentials, or
 * - `{ mode: 'preview', serviceType }` for ephemeral preview checks.
 */
export function useCredentialHealth(target: CredentialHealthTarget) {
  const targetMode = typeof target === 'string' ? 'stored' : target.mode;
  const key = useMemo(() => {
    if (typeof target === 'string') return target;
    return `preview:${target.serviceType ?? '_none'}`;
  }, [target]);

  const previousPreviewKeyRef = useRef<string | null>(null);

  // Preview health entries are ephemeral; clear old keys when switching connector.
  useEffect(() => {
    if (targetMode !== 'preview') return;
    const prevKey = previousPreviewKeyRef.current;
    if (prevKey && prevKey !== key) {
      resultCache.delete(prevKey);
    }
    previousPreviewKeyRef.current = key;
    resultCache.notify();

    return () => {
      resultCache.delete(key);
      resultCache.notify();
    };
  }, [key, targetMode]);

  // Track in-flight checks so we can clean up orphaned refcounts on unmount.
  const inflightRef = useRef(0);

  useEffect(() => {
    return () => {
      // On unmount, if any checks are still in-flight, their finally blocks
      // will eventually decrement. But if the component is destroyed due to
      // an uncaught error boundary, force-clear to prevent stuck loading.
      if (inflightRef.current > 0) {
        const count = loadingRefCounts.get(key) ?? 0;
        const corrected = count - inflightRef.current;
        if (corrected <= 0) loadingRefCounts.delete(key);
        else loadingRefCounts.set(key, corrected);
        inflightRef.current = 0;
      }
    };
  }, [key]);

  const result = useModuleSubscription(resultCache, key) ?? null;
  const isHealthchecking = (loadingRefCounts.get(key) ?? 0) > 0;

  /** Generic async check: sets loading, runs fn, caches result. */
  const check = useCallback(async (fn: () => Promise<HealthResult>) => {
    beginLoading(key);
    inflightRef.current += 1;
    resultCache.delete(key);
    resultCache.notify();
    try {
      const r = await fn();
      resultCache.set(key, r);
    } catch (e) {
      resultCache.set(key, {
        success: false,
        message: e instanceof Error ? e.message : 'Healthcheck failed',
      });
    } finally {
      endLoading(key);
      inflightRef.current = Math.max(0, inflightRef.current - 1);
      resultCache.notify();
    }
  }, [key]);

  /**
   * Check a stored credential by ID. Also persists the result into
   * credential metadata and updates the Zustand store.
   */
  const checkStored = useCallback(async () => {
    await check(async () => {
      const hcResult = await credApi.healthcheckCredential(key);

      // Persist healthcheck metadata on the credential
      const credentials = useVaultStore.getState().credentials;
      const cred = credentials.find((c) => c.id === key);
      if (cred) {
        const nowIso = new Date().toISOString();
        const patch: Record<string, unknown> = {
          healthcheck_last_success: hcResult.success,
          healthcheck_last_message: hcResult.message,
          healthcheck_last_tested_at: nowIso,
        };
        if (hcResult.success) patch.healthcheck_last_success_at = nowIso;

        const updatedRaw = await credApi.patchCredentialMetadata(key, patch);
        const updated = toCredentialMetadata(updatedRaw);
        useVaultStore.setState((s) => ({
          credentials: s.credentials.map((c) => (c.id === key ? updated : c)),
        }));
      }

      return hcResult;
    });
  }, [key, check]);

  /** Check unsaved credential values against a known service type. */
  const checkPreview = useCallback(async (serviceType: string, fieldValues: Record<string, string>) => {
    await check(async () => {
      const encrypted = await encryptWithSessionKey(JSON.stringify(fieldValues));
      return await credApi.healthcheckCredentialPreview(serviceType, encrypted);
    });
  }, [check]);

  /** Design-flow healthcheck via `testCredentialDesignHealthcheck`. */
  const checkDesign = useCallback(async (
    instruction: string,
    connector: Record<string, unknown>,
    values: Record<string, string>,
  ) => {
    await check(async () => {
      const response: CredentialDesignHealthcheckResult =
        await testCredentialDesignHealthcheck(instruction, connector, values);
      const entry: HealthResult = {
        success: response.success,
        message: response.message,
      };
      if (response.healthcheck_config && (response.healthcheck_config as Record<string, unknown>).skip !== true) {
        entry.healthcheckConfig = response.healthcheck_config;
        if (response.success) {
          entry.lastSuccessfulTestAt = new Date().toLocaleTimeString();
        }
      }
      return entry;
    });
  }, [check]);

  /** Directly set a result (e.g. from an OAuth callback). */
  const setResult = useCallback((r: HealthResult | null) => {
    if (r) resultCache.set(key, r);
    else resultCache.delete(key);
    resultCache.notify();
  }, [key]);

  /** Clear the cached result for this key. */
  const invalidate = useCallback(() => {
    resultCache.delete(key);
    resultCache.notify();
  }, [key]);

  return {
    result,
    isHealthchecking,
    check,
    checkStored,
    checkPreview,
    checkDesign,
    setResult,
    invalidate,
  };
}

// -- Static helpers (read cache without subscribing) -------------------

export function getHealthResult(key: string): HealthResult | null {
  return resultCache.get(key) ?? null;
}

export function isHealthChecking(key: string): boolean {
  return (loadingRefCounts.get(key) ?? 0) > 0;
}

export function resetHealthCache() {
  resultCache.clear();
  loadingRefCounts.clear();
  resultCache.notify();
}
