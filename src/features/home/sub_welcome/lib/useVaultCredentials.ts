import { useEffect, useState } from 'react';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Single credential source for the Home Welcome surface.
 *
 * Its one caller is the nav "Connections" chip (`useNavCardStatus`, which needs the
 * external/built-in split). It reads the ONE canonical source - the `vaultStore` - lazy-loading
 * it (keeping it off the eager Home bundle), seeds from whatever is already cached, triggers a
 * fetch only when the cache is empty, and stays subscribed so the count updates live. The retired
 * FleetHealthStrip once ran its own `list_credentials` poll beside it; this hook is what replaced
 * that second source.
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
      if (s.credentials.length === 0) s.fetchCredentials().catch(silentCatch('useVaultCredentials:fetchCredentials'));
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
