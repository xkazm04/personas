import { useCallback, useReducer, useEffect } from 'react';
import * as credApi from '@/api/credentials';
import { testCredentialDesignHealthcheck, type CredentialDesignHealthcheckResult } from '@/api/credentialDesign';
import { toCredentialMetadata } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';

// ── Types ─────────────────────────────────────────────────────────────

export interface HealthResult {
  success: boolean;
  message: string;
  /** Only populated for design-flow healthchecks */
  healthcheckConfig?: Record<string, unknown> | null;
  lastSuccessfulTestAt?: string | null;
}

// ── Shared module-level cache ─────────────────────────────────────────

const resultCache = new Map<string, HealthResult>();
const loadingKeys = new Set<string>();
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

// ── Hook ──────────────────────────────────────────────────────────────

/**
 * Unified credential health service.
 *
 * All healthcheck results are cached in a shared `Map<string, HealthResult>`
 * so that any component reading the same key sees the same data without
 * redundant API calls. Pass a stable `key` — typically a credentialId for
 * stored credentials, or a prefix like `preview:<serviceType>` / `design`
 * for transient healthchecks.
 */
export function useCredentialHealth(key: string) {
  const [, rerender] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    subscribers.add(rerender);
    return () => { subscribers.delete(rerender); };
  }, [rerender]);

  const result = resultCache.get(key) ?? null;
  const isHealthchecking = loadingKeys.has(key);

  /** Generic async check: sets loading, runs fn, caches result. */
  const check = useCallback(async (fn: () => Promise<HealthResult>) => {
    loadingKeys.add(key);
    resultCache.delete(key);
    notify();
    try {
      const r = await fn();
      resultCache.set(key, r);
    } catch (e) {
      resultCache.set(key, {
        success: false,
        message: e instanceof Error ? e.message : 'Healthcheck failed',
      });
    } finally {
      loadingKeys.delete(key);
      notify();
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
        let parsed: Record<string, unknown> = {};
        if (cred.metadata) {
          try { parsed = JSON.parse(cred.metadata) as Record<string, unknown>; } catch { /* */ }
        }
        const nowIso = new Date().toISOString();
        const next: Record<string, unknown> = {
          ...parsed,
          healthcheck_last_success: hcResult.success,
          healthcheck_last_message: hcResult.message,
          healthcheck_last_tested_at: nowIso,
        };
        if (hcResult.success) next.healthcheck_last_success_at = nowIso;

        const updatedRaw = await credApi.updateCredential(key, {
          name: null,
          service_type: null,
          encrypted_data: null,
          metadata: JSON.stringify(next),
        });
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
    notify();
  }, [key]);

  /** Clear the cached result for this key. */
  const invalidate = useCallback(() => {
    resultCache.delete(key);
    notify();
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
  return loadingKeys.has(key);
}

export function resetHealthCache() {
  resultCache.clear();
  loadingKeys.clear();
  notify();
}
