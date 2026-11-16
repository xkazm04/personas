/**
 * console-style fan-out, partition E: harness entries for this partition's pages.
 * Owned by the partition-E builder; registry.tsx spreads it (wired by the Director).
 * vault/credentials, settings/appearance and settings/account live in consoleStyleSurfaces.tsx.
 */
import { useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { CredentialNavProvider, useCredentialNav, type CredentialNavKey } from '@/features/vault/shared/hooks/CredentialNavContext';
import type { SettingsTab, TemplateTab } from '@/lib/types/types';
import type { HarnessModule } from './registry';

async function quietly(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[page-harness] prepare step "${label}" failed`, err);
  }
}

function GoTo({ navKey }: { navKey: CredentialNavKey }) {
  const nav = useCredentialNav();
  useEffect(() => {
    const id = window.setTimeout(() => nav.navigate(navKey), 150);
    return () => window.clearTimeout(id);
  }, [nav, navKey]);
  return null;
}

const vaultView = (navKey: CredentialNavKey): HarnessModule => ({
  load: async () => {
    const { CredentialManager } = await import('@/features/vault/sub_credentials/manager/CredentialManager');
    return {
      default: () => (
        <CredentialNavProvider>
          <GoTo navKey={navKey} />
          <CredentialManager />
        </CredentialNavProvider>
      ),
    };
  },
  prepare: async () => {
    useSystemStore.setState({ sidebarSection: 'credentials' });
    await quietly('fetchCredentials', () => useVaultStore.getState().fetchCredentials());
    await quietly('fetchConnectorDefinitions', () => useVaultStore.getState().fetchConnectorDefinitions());
  },
});

const settingsTab = (tab: SettingsTab): HarnessModule => ({
  load: () => import('@/features/settings/components/SettingsPage'),
  prepare: () => { useSystemStore.setState({ sidebarSection: 'settings', settingsTab: tab }); },
});

const templatesTab = (tab: TemplateTab): HarnessModule => ({
  load: () => import('@/features/templates/components/DesignReviewsPage'),
  prepare: async () => {
    useSystemStore.setState({ sidebarSection: 'design-reviews', templateTab: tab });
    await quietly('fetchCredentials', () => useVaultStore.getState().fetchCredentials());
    await quietly('fetchConnectorDefinitions', () => useVaultStore.getState().fetchConnectorDefinitions());
  },
});

export const FANOUT_E_MODULES: Record<string, HarnessModule> = {
  'vault/catalog': vaultView('from-template'),
  'vault/add-new': vaultView('add-new'),
  'vault/databases': vaultView('databases'),
  'templates/generated': templatesTab('generated'),
  'templates/recipes': templatesTab('recipes'),
  'templates/n8n': templatesTab('n8n'),
  'settings/notifications': settingsTab('notifications'),
  'settings/api-keys': settingsTab('api-keys'),
  'settings/devices': settingsTab('devices'),
  'settings/limits': settingsTab('limits'),
};
