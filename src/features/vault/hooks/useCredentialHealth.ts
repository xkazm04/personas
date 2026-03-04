import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as credApi from '@/api/credentials';
import { testCredentialDesignHealthcheck, type CredentialDesignHealthcheckResult } from '@/api/credentialDesign';
import { toCredentialMetadata } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import { createModuleCache, useModuleSubscription } from '@/hooks/utility/useModuleSubscription';

// ── Types ─────────────────────────────────────────────────────────────

export interface HealthResult {
  success: boolean;
  message: string;
  /** Only populated for design-flow healthchecks */
  healthcheckConfig?: Record<string, unknown> | null;
  lastSuccessfulTestAt?: string | null;
}

type CredentialHealthPreviewTarget = {
  mode: 'preview';
  serviceType?: string | null;
};

type CredentialHealthTarget = string | CredentialHealthPreviewTarget;

// ── Shared module-level caches ───────────────────────────────────────

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

// ── Hook ──────────────────────────────────────────────────────────────

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

  const result = useModuleSubscription(resultCache, key) ?? null;
  const isHealthchecking = (loadingRefCounts.get(key) ?? 0) > 0;

  /** Generic async check: sets loading, runs fn, caches result. */
  const check = useCallback(async (fn: () => Promise<HealthResult>) => {
    beginLoading(key);
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
      const credentials = usePersonaStore.getState().credentials;
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
        usePersonaStore.setState((s) => ({
          credentials: s.credentials.map((c) => (c.id === key ? updated : c)),
        }));
      }

      return hcResult;
    });
  }, [key, check]);

  /** Check unsaved credential values against a known service type. */
  const checkPreview = useCallback(async (serviceType: string, fieldValues: Record<string, string>) => {
    await check(async () => {
      return await credApi.healthcheckCredentialPreview(serviceType, fieldValues);
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

// ── Static helpers (read cache without subscribing) ───────────────────

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
