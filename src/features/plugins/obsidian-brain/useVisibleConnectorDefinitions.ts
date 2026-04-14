import { useMemo } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Returns the set of connector definitions visible to the current user,
 * applying plugin gating from `metadata.requires_plugin`.
 *
 * Connectors that declare `requires_plugin: "obsidian-brain"` are hidden
 * until the user has configured a vault path in the Obsidian Brain plugin.
 * When the vault is later connected the same selector re-renders and the
 * connector becomes visible automatically.
 *
 * Use this hook in places where the user *picks* a connector (catalog,
 * persona connector picker, agent matrix). Do not use it in admin-only
 * listings where every connector should be visible regardless of state.
 */
export function useVisibleConnectorDefinitions() {
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const obsidianVaultPath = useSystemStore((s) => s.obsidianVaultPath);
  const obsidianConnected = useSystemStore((s) => s.obsidianConnected);

  return useMemo(() => {
    const obsidianReady = Boolean(obsidianVaultPath) && obsidianConnected;
    return connectorDefinitions.filter((def) => {
      const requires =
        def.metadata && typeof def.metadata === 'object'
          ? (def.metadata as Record<string, unknown>).requires_plugin
          : null;
      if (requires === 'obsidian-brain' && !obsidianReady) return false;
      return true;
    });
  }, [connectorDefinitions, obsidianVaultPath, obsidianConnected]);
}
