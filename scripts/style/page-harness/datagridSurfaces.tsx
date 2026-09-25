/**
 * The shared DataGrid's other consumers (Gate 2b): each real surface mounted on
 * synthetic data, so a before/after pair shows what a DataGrid change does to
 * them under the default `fit='fill'`.
 *
 *   datagrid/persona-overview  PersonaOverviewPage (personas from the sub_events tape)
 *   datagrid/live-stream       LiveStreamTab (backfill from the sub_events tape)
 *   datagrid/credentials       CredentialList on synthetic credential props
 *   datagrid/databases         DatabaseListView on a synthetic vault store
 */
import type { ComponentType } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { HarnessModule } from './registry';

const T0 = '2026-09-22T15:40:00.000Z';
const daysAgo = (d: number) => new Date(Date.parse(T0) - d * 86_400_000).toISOString();

function connector(name: string, label: string, category: string, color: string): ConnectorDefinition {
  return {
    id: `conn-${name}`, name, label, category, color, icon_url: null, fields: [], healthcheck_config: null,
    services: [], events: [], metadata: null, is_builtin: true, created_at: daysAgo(90), updated_at: daysAgo(90),
  };
}

const CONNECTORS: ConnectorDefinition[] = [
  connector('supabase', 'Supabase', 'database', '#3ECF8E'),
  connector('postgres', 'PostgreSQL', 'database', '#336791'),
  connector('github', 'GitHub', 'development', '#8b949e'),
  connector('slack', 'Slack', 'messaging', '#E01E5A'),
  connector('openai', 'OpenAI', 'ai', '#10a37f'),
];

// [id, name, service_type, healthy?, usedDaysAgo]
const CRED_ROWS: [string, string, string, boolean | null, number | null][] = [
  ['c1', 'Production Supabase', 'supabase', true, 1],
  ['c2', 'Analytics warehouse (read replica, EU region)', 'postgres', false, 12],
  ['c3', 'GitHub org token', 'github', true, 0.2],
  ['c4', 'Release notes Slack bot', 'slack', null, null],
  ['c5', 'OpenAI team key', 'openai', true, 3],
  ['c6', 'Staging Postgres', 'postgres', true, 30],
];

const CREDENTIALS: CredentialMetadata[] = CRED_ROWS.map(([id, name, service_type, ok, used], i) => ({
  id, name, service_type, metadata: null,
  healthcheck_last_success: ok,
  healthcheck_last_message: ok === false ? 'Connection refused (port 5432)' : null,
  healthcheck_last_tested_at: ok === null ? null : daysAgo(0.5),
  healthcheck_last_success_at: ok ? daysAgo(0.5) : null,
  last_used_at: used === null ? null : daysAgo(used),
  created_at: daysAgo(60 - i * 7), updated_at: daysAgo(2),
}));

const noop = () => {};

export const DATAGRID_MODULES: Record<string, HarnessModule> = {
  'datagrid/persona-overview': {
    load: () => import('@/features/agents/components/allPersonas/PersonaOverviewPage'),
    prepare: async () => { await useAgentStore.getState().fetchPersonas(); },
  },
  'datagrid/live-stream': {
    load: async () => {
      const { LiveStreamTab } = await import('@/features/triggers/sub_live_stream/LiveStreamTab');
      return { default: LiveStreamTab as ComponentType };
    },
    prepare: async () => { await useAgentStore.getState().fetchPersonas(); },
  },
  'datagrid/credentials': {
    load: async () => {
      const { CredentialList } = await import('@/features/vault/sub_credentials/components/list/CredentialList');
      return {
        default: function Credentials() {
          return (
            <div className="flex flex-col flex-1 min-h-0 p-4">
              <CredentialList credentials={CREDENTIALS} connectorDefinitions={CONNECTORS} searchTerm="" onDelete={noop} />
            </div>
          );
        },
      };
    },
  },
  'datagrid/databases': {
    load: async () => {
      const { DatabaseListView } = await import('@/features/vault/sub_databases/DatabaseListView');
      return {
        default: function Databases() {
          return (
            <div className="flex flex-col flex-1 min-h-0 p-4">
              <DatabaseListView onBack={noop} />
            </div>
          );
        },
      };
    },
    prepare: () => {
      useVaultStore.setState({ credentials: CREDENTIALS, connectorDefinitions: CONNECTORS });
    },
  },
};
