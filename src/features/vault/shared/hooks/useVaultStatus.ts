import { useEffect, useState } from 'react';
import { vaultStatus, type VaultStatus } from '@/api/vault/credentials';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Shared `vaultStatus()` fetch — the value (AES/keychain/local status) is
 * process-stable, so every consumer under `CredentialManager` reads a single
 * module-level cache instead of independently round-tripping IPC on mount.
 *
 * `VaultTrustBadge` and `CredentialEditForm` both used to call `vaultStatus()`
 * on their own with divergent error handling (silentCatch vs toastCatch) —
 * see vault-credentials-2-4.md #6. Failures here are silent: this hook backs
 * a passive display, not a user-triggered action, so a toast on a background
 * poll would be noise.
 */

let cache: VaultStatus | null = null;
let inFlight: Promise<VaultStatus> | null = null;
const listeners = new Set<(status: VaultStatus) => void>();

function notify(status: VaultStatus) {
  cache = status;
  for (const listener of listeners) listener(status);
}

function fetchVaultStatus(): Promise<VaultStatus | null> {
  if (!inFlight) {
    inFlight = vaultStatus()
      .then((status) => {
        notify(status);
        return status;
      })
      .catch((e: unknown) => {
        silentCatch('useVaultStatus.vaultStatus')(e);
        return cache as VaultStatus;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function useVaultStatus() {
  const [status, setStatus] = useState<VaultStatus | null>(cache);

  useEffect(() => {
    listeners.add(setStatus);
    void fetchVaultStatus();
    return () => {
      listeners.delete(setStatus);
    };
  }, []);

  return status;
}

/** Forces a fresh IPC round-trip and refreshes every mounted consumer. */
export function refreshVaultStatus() {
  inFlight = null;
  return fetchVaultStatus();
}
