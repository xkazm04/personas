import { useCallback, useEffect, useMemo } from 'react';
import { EventName } from '@/lib/eventRegistry';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { deriveConnectorAttention, type ConnectorAttentionItem } from '@/lib/credentials/connectorAttention';

/** Connectors that currently need the user, derived live from the vault store. */
export function useConnectorAttention(): ConnectorAttentionItem[] {
  const credentials = useVaultStore((s) => s.credentials);
  const pendingDeleteIds = useVaultStore((s) => s.pendingDeleteCredentialIds);
  return useMemo(
    () => deriveConnectorAttention(credentials.filter((c) => !pendingDeleteIds.has(c.id))),
    [credentials, pendingDeleteIds],
  );
}

/**
 * Keeps the vault store fresh enough for the app-wide attention surface
 * (title-bar badge + notification tray). Mount it ONCE, somewhere that is
 * always mounted.
 *
 * The backend persists `needs_reauth` before it emits either re-auth event
 * (engine/oauth_refresh.rs), so a forced refetch on each event is sufficient —
 * the store stays the single source of truth and nothing here keeps its own
 * list that could drift from it.
 */
export function useConnectorAttentionWatcher(): void {
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  useEffect(() => {
    fetchCredentials().catch(silentCatch('useConnectorAttentionWatcher:initialFetch'));
  }, [fetchCredentials]);

  const refetch = useCallback(() => {
    fetchCredentials({ force: true }).catch(silentCatch('useConnectorAttentionWatcher:eventRefetch'));
  }, [fetchCredentials]);
  useTypedTauriEvent(EventName.CREDENTIAL_REAUTH_REQUIRED, refetch);
  useTypedTauriEvent(EventName.CREDENTIAL_REAUTH_RESOLVED, refetch);
}

/** Open the Connections list with the credential's detail focused. */
export function openConnectorForAttention(credentialId: string): void {
  const system = useSystemStore.getState();
  system.setHeaderOverlay('none');
  system.setSidebarSection('credentials');
  useVaultStore.getState().setFocusCredentialId(credentialId);
}
