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
  // Set when the stored capability JSON failed to parse. `capabilities` then
  // stays at the permissive DEFAULT_CAPABILITIES the useState was seeded
  // with -- if a later `toggle()` were allowed to persist, it would silently
  // overwrite the operator's real (but now-corrupt) stored map with "every
  // operation enabled" the moment they flip one unrelated switch. Block
  // persistence until an explicit `resetToDefaults()` (a deliberate choice,
  // not a side effect) clears it.
  const loadCorruptedRef = useRef(false);

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
        } catch (err) {
          loadCorruptedRef.current = true;
          silentCatch("hooks/utility/data/useEngineCapabilities:catch1")(err);
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
    if (loadCorruptedRef.current) {
      // Refuse to write over a load we know is corrupt -- see loadCorruptedRef.
      silentCatch("engineCapabilities:persistBlockedByCorruptLoad")(
        new Error('Refusing to persist engine capabilities: stored JSON failed to parse on load'),
      );
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setAppSetting(CAPABILITY_SETTING_KEY, JSON.stringify(next))
        .then(() => onSaveRef.current?.())
        .catch(silentCatch("engineCapabilities:persistSettings"));
    }, 500);
  }, []);

  // Mirror of `capabilities` readable from event handlers. A setState updater
  // must be PURE -- React may invoke it twice (always does under StrictMode),
  // so `persist()` cannot live inside one. Reading the previous map from this
  // ref instead lets `toggle` compute `next` up front, hand setState a plain
  // value, and persist exactly once. The ref is written eagerly in `toggle`
  // (not only by the effect) so several toggles in one tick still compose.
  const capabilitiesRef = useRef(capabilities);
  useEffect(() => { capabilitiesRef.current = capabilities; }, [capabilities]);

  const toggle = useCallback((operation: CliOperation, provider: CliEngine) => {
    const prev = capabilitiesRef.current;
    const next = { ...prev };
    next[operation] = { ...next[operation], [provider]: !next[operation][provider] };
    capabilitiesRef.current = next;
    setCapabilities(next);
    persist(next);
  }, [persist]);

  const resetToDefaults = useCallback(() => {
    // An explicit reset is a deliberate, informed choice to discard whatever
    // is stored -- safe to clear the corrupt-load guard so this write (unlike
    // a plain toggle) is allowed through.
    loadCorruptedRef.current = false;
    capabilitiesRef.current = DEFAULT_CAPABILITIES;
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
