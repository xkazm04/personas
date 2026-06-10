import { useEffect } from 'react';
import { obsidianBrainGetConfig } from '@/api/obsidianBrain';
import { useSystemStore } from '@/stores/systemStore';
import { useAuthStore } from '@/stores/authStore';
import { silentCatch } from '@/lib/silentCatch';

// One-shot per app run — the persisted config only changes through the Setup
// panel, which updates the store itself.
let rehydrated = false;

/**
 * Rehydrate the active-vault store state from the persisted vault config.
 *
 * The Rust side has always persisted the active vault in app_settings
 * (`obsidian_brain_save_config`), but the Zustand flags every consumer reads
 * (`obsidianVaultPath` / `obsidianVaultName` / `obsidianConnected`) started
 * each session at null/false and nothing loaded them back — so after an app
 * restart the Brain plugin showed "No vault connected" and the
 * obsidian_memory connector stayed hidden until the user re-saved Setup.
 *
 * Mounted in {@link BackgroundServices} so it runs app-wide (the connector
 * gating in useVisibleConnectorDefinitions lives outside the plugin page).
 */
export function useObsidianVaultRehydration() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated || rehydrated) return;
    rehydrated = true;
    obsidianBrainGetConfig()
      .then((config) => {
        if (!config?.vaultPath) return;
        const store = useSystemStore.getState();
        // Don't clobber a vault the user already activated this session.
        if (store.obsidianVaultPath) return;
        store.setObsidianVaultPath(config.vaultPath);
        store.setObsidianVaultName(config.vaultName);
        store.setObsidianConnected(true);
      })
      .catch((err) => {
        // Allow a retry on the next mount (e.g. auth raced the first attempt).
        rehydrated = false;
        silentCatch('features/plugins/obsidian-brain/useObsidianVaultRehydration')(err);
      });
  }, [isAuthenticated]);
}
