import { useEffect } from 'react';
import { obsidianBrainGetConfig } from '@/api/obsidianBrain';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';

// One-shot per app run — the persisted config only changes through the Setup
// panel and the saved-vaults sidebar, which update the store themselves.
let rehydrated = false;

/** Backoff between attempts when the config read fails (backend still booting). */
const RETRY_DELAYS_MS = [1_000, 4_000];

/**
 * Rehydrate the active-vault store state from the persisted vault config.
 *
 * The Rust side persists the active vault in app_settings
 * (`obsidian_brain_save_config`), but the Zustand flags every consumer reads
 * (`obsidianVaultPath` / `obsidianVaultName` / `obsidianConnected`) start each
 * session at null/false — this hook is the only thing that loads them back.
 *
 * It must NOT wait for `useAuthStore.isAuthenticated`. That flag is the Google
 * sign-in, not local access: the vault commands never required it
 * (`require_auth_sync` is a no-op), and at startup the flag is racy — the
 * backend restores the session ~1s after boot and announces it with an event
 * the frontend listener can miss. Gating on it left the Brain plugin on
 * "No Vault Connected" for whole sessions while the choice sat in the DB.
 *
 * Mounted in {@link BackgroundServices} so it runs app-wide (the connector
 * gating in useVisibleConnectorDefinitions lives outside the plugin page).
 */
export function useObsidianVaultRehydration() {
  useEffect(() => {
    if (rehydrated) return;
    rehydrated = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = (n: number) => {
      obsidianBrainGetConfig()
        .then((config) => {
          if (cancelled || !config?.vaultPath) return;
          const store = useSystemStore.getState();
          // Don't clobber a vault the user already activated this session.
          if (store.obsidianVaultPath) return;
          store.setObsidianVaultPath(config.vaultPath);
          store.setObsidianVaultName(config.vaultName);
          store.setObsidianConnected(true);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const delay = RETRY_DELAYS_MS[n];
          if (delay !== undefined) {
            timer = setTimeout(() => attempt(n + 1), delay);
            return;
          }
          silentCatch('features/plugins/obsidian-brain/useObsidianVaultRehydration')(err);
        });
    };
    attempt(0);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      // Unmounted mid-flight: let the next mount try again.
      rehydrated = false;
    };
  }, []);
}
