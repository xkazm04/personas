import { useEffect, useState } from 'react';

/**
 * Single credential source for the Home Welcome surface.
 *
 * Both the nav "Connections" chip (needs the external/built-in split) and
 * FleetHealthStrip (needs just the count) read credentials from the ONE
 * canonical source — the `vaultStore` — through this hook. It lazy-loads the
 * vault store (keeping it off the eager Home bundle), seeds from whatever is
 * already cached, triggers a fetch only when the cache is empty, and stays
 * subscribed so the count updates live. Previously FleetHealthStrip issued its
 * own `list_credentials` IPC on a 30s poll while the nav hook read the store —
 * two sources for the same data; this collapses them to one.
 */
export interface CredentialLite {
  service_type: string;
}

export function useVaultCredentials(): CredentialLite[] {
  const [creds, setCreds] = useState<CredentialLite[]>([]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('@/stores/vaultStore').then(({ useVaultStore }) => {
      if (cancelled) return;
      const s = useVaultStore.getState();
      setCreds(s.credentials);
      if (s.credentials.length === 0) s.fetchCredentials().catch(() => {});
      let prev = s.credentials;
      unsub = useVaultStore.subscribe((st) => {
        if (st.credentials !== prev) {
          prev = st.credentials;
          setCreds(st.credentials);
        }
      });
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  return creds;
}
