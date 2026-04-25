import { useState, useEffect, useCallback, useRef } from 'react';
import { setAppSetting } from '@/api/system/settings';
import { getAppSettingCoalesced } from '@/hooks/utility/data/useSettings';
import { healthCheckLocal } from "@/api/system/system";
import { silentCatch } from "@/lib/silentCatch";

import {
  DEFAULT_CAPABILITIES,
  CAPABILITY_SETTING_KEY,
  mergeCapabilities,
  isOperationEnabled,
  getPreferredProvider,
} from '@/features/settings/sub_engine/libs/engineCapabilities';
import type { CliEngine } from '@/lib/types/types';
import type { CliOperation, EngineCapabilityMap } from '@/features/settings/sub_engine/libs/engineCapabilities';

interface UseEngineCapabilitiesResult {
  /** Full capability map (merged defaults + saved overrides) */
  capabilities: EngineCapabilityMap;
  /** Set of CLI providers currently installed on this machine */
  installedProviders: Set<CliEngine>;
  /** Whether initial load is complete */
  loaded: boolean;
  /** Check if a provider is enabled for an operation (considers installation status) */
  isEnabled: (operation: CliOperation, provider: CliEngine) => boolean;
  /** Get the best available provider for an operation */
  preferredProvider: (operation: CliOperation) => CliEngine | null;
  /** Toggle a capability on/off and persist */
  toggle: (operation: CliOperation, provider: CliEngine) => void;
  /** Reset all capabilities to test-derived defaults */
  resetToDefaults: () => void;
}

export function useEngineCapabilities(opts?: { onSave?: () => void }): UseEngineCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<EngineCapabilityMap>(DEFAULT_CAPABILITIES);
  const [installedProviders, setInstalledProviders] = useState<Set<CliEngine>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved capabilities + detect installed providers in parallel. The
  // settings read goes through the microtask coalescer so it shares an IPC
  // with any sibling `useAppSetting` calls mounting in the same tick.
  useEffect(() => {
    const loadAll = async () => {
      const [savedResult, localResult] = await Promise.allSettled([
        getAppSettingCoalesced(CAPABILITY_SETTING_KEY),
        healthCheckLocal(),
      ]);

      if (savedResult.status === 'fulfilled' && savedResult.value) {
        try {
          const parsed = JSON.parse(savedResult.value) as Partial<EngineCapabilityMap>;
          setCapabilities(mergeCapabilities(parsed));
        } catch {
          // Malformed JSON — fall back to defaults silently.
        }
      }

      if (localResult.status === 'fulfilled') {
        const installed = new Set<CliEngine>();
        for (const item of localResult.value.items) {
          if (item.status === 'ok' && item.id === 'claude_cli') {
            installed.add('claude_code');
          }
        }
        setInstalledProviders(installed);
      }

      setLoaded(true);
    };

    loadAll();
  }, []);

  // Debounced persist
  const onSaveRef = useRef(opts?.onSave);
  onSaveRef.current = opts?.onSave;

  const persist = useCallback((next: EngineCapabilityMap) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setAppSetting(CAPABILITY_SETTING_KEY, JSON.stringify(next))
        .then(() => onSaveRef.current?.())
        .catch(silentCatch("engineCapabilities:persistSettings"));
    }, 500);
  }, []);

  const toggle = useCallback((operation: CliOperation, provider: CliEngine) => {
    setCapabilities((prev) => {
      const next = { ...prev };
      next[operation] = { ...next[operation], [provider]: !next[operation][provider] };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetToDefaults = useCallback(() => {
    setCapabilities(DEFAULT_CAPABILITIES);
    persist(DEFAULT_CAPABILITIES);
  }, [persist]);

  const isEnabled = useCallback(
    (operation: CliOperation, provider: CliEngine) =>
      isOperationEnabled(capabilities, operation, provider, installedProviders),
    [capabilities, installedProviders],
  );

  const preferredProvider = useCallback(
    (operation: CliOperation) =>
      getPreferredProvider(capabilities, operation, installedProviders),
    [capabilities, installedProviders],
  );

  return {
    capabilities,
    installedProviders,
    loaded,
    isEnabled,
    preferredProvider,
    toggle,
    resetToDefaults,
  };
}
