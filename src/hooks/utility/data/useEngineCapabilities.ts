import { useState, useEffect, useCallback, useRef } from 'react';
import { getAppSetting, setAppSetting } from '@/api/system/settings';
import { systemHealthCheck } from '@/api';
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

export function useEngineCapabilities(): UseEngineCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<EngineCapabilityMap>(DEFAULT_CAPABILITIES);
  const [installedProviders, setInstalledProviders] = useState<Set<CliEngine>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved capabilities + detect installed providers
  useEffect(() => {
    const loadAll = async () => {
      // Load saved capabilities
      try {
        const saved = await getAppSetting(CAPABILITY_SETTING_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<EngineCapabilityMap>;
          setCapabilities(mergeCapabilities(parsed));
        }
      } catch {
        // Use defaults on error
      }

      // Detect installed providers
      try {
        const report = await systemHealthCheck();
        const localSection = report.sections.find((s) => s.id === 'local');
        if (localSection) {
          const installed = new Set<CliEngine>();
          for (const item of localSection.items) {
            if (item.status === 'ok') {
              if (item.id === 'claude_cli') installed.add('claude_code');
              else if (item.id === 'gemini_cli') installed.add('gemini_cli');
              else if (item.id === 'copilot_cli') installed.add('copilot_cli');
              else if (item.id === 'codex_cli') installed.add('codex_cli');
            }
          }
          setInstalledProviders(installed);
        }
      } catch {
        // No providers detected
      }

      setLoaded(true);
    };

    loadAll();
  }, []);

  // Debounced persist
  const persist = useCallback((next: EngineCapabilityMap) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setAppSetting(CAPABILITY_SETTING_KEY, JSON.stringify(next)).catch(() => {});
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
