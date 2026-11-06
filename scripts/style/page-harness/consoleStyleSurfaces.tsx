/**
 * Console-style WP0: the six routed pages the BEFORE/AFTER pair is shot on.
 * Aliases reuse existing entries (Mission Control, Factory landing); new entries
 * mount the real page component as the router does.
 *
 *   overview/home              = overview/sub_missionControl
 *   agents/list                PersonaOverviewPage
 *   vault/credentials          CredentialManager
 *   plugins/dev-tools-overview DevToolsPage, overview tab
 *   settings/appearance        SettingsPage, appearance tab (+ settings/account)
 *   teams/factory              = factory/landing
 */
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { MISSION_CONTROL_MODULES } from './missionControlSurfaces';
import { FACTORY_MODULES } from './factorySurfaces';
import type { HarnessModule } from './registry';

async function quietly(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[page-harness] prepare step "${label}" failed`, err);
  }
}

const settingsTab = (tab: 'appearance' | 'account'): HarnessModule => ({
  load: () => import('@/features/settings/components/SettingsPage'),
  prepare: () => { useSystemStore.setState({ sidebarSection: 'settings', settingsTab: tab }); },
});

export const CONSOLE_STYLE_MODULES: Record<string, HarnessModule> = {
  'overview/home': MISSION_CONTROL_MODULES['overview/sub_missionControl'],
  'teams/factory': FACTORY_MODULES['factory/landing'],
  'agents/list': {
    load: () => import('@/features/agents/components/allPersonas/PersonaOverviewPage'),
    prepare: async () => {
      useSystemStore.setState({ sidebarSection: 'personas' });
      await quietly('fetchPersonas', () => useAgentStore.getState().fetchPersonas());
      await quietly('fetchPersonaSummaries', () => useAgentStore.getState().fetchPersonaSummaries());
      await quietly('fetchBudgetSpend', () => useAgentStore.getState().fetchBudgetSpend());
    },
  },
  'vault/credentials': {
    load: async () => {
      const { CredentialManager } = await import('@/features/vault/sub_credentials/manager/CredentialManager');
      return { default: CredentialManager };
    },
    prepare: async () => {
      useSystemStore.setState({ sidebarSection: 'credentials' });
      await quietly('fetchCredentials', () => useVaultStore.getState().fetchCredentials());
      await quietly('fetchConnectorDefinitions', () => useVaultStore.getState().fetchConnectorDefinitions());
    },
  },
  'plugins/dev-tools-overview': {
    load: () => import('@/features/plugins/dev-tools/DevToolsPage'),
    prepare: async () => {
      useSystemStore.setState({ sidebarSection: 'plugins', devToolsTab: 'overview' });
      await quietly('fetchProjects', () => useSystemStore.getState().fetchProjects());
      useSystemStore.setState({ activeProjectId: 'p-atlas' });
      await quietly('fetchCredentials', () => useVaultStore.getState().fetchCredentials());
    },
  },
  'settings/appearance': settingsTab('appearance'),
  'settings/account': settingsTab('account'),
};
