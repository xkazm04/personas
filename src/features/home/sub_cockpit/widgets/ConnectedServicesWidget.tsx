import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { KitButton, Rows, Tile } from '@/features/shared/components/kit';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';
import { silentCatch } from '@/lib/silentCatch';
import { readCredentialHealthState, type HealthState } from '@/lib/credentials/healthState';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { ServiceRow } from './ServiceRow';

/** Failing first, so a cap never hides a broken credential behind "Show all". */
const HEALTH_ORDER: Record<HealthState, number> = { failed: 0, unreachable: 1, untested: 2, unverifiable: 3, verified: 4 };

/**
 * Connected services: the credentials in the vault, each with its health on the row's mark and
 * how many personas reference it. One kit Tile; the head counts the credentials and names how
 * many fail, the rows list failing ones first and cap at `limit` (default 8) with "Show all",
 * so nothing is cut silently. A row press opens the Connections page, as the head's action does.
 *
 * Config:
 *   { "limit": N }
 */
export function ConnectedServicesWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t, tx } = useTranslation();
  const limit = typeof config?.limit === 'number' && config.limit > 0 ? config.limit : 8;

  const { credentials, fetchCredentials } = useVaultStore(
    useShallow((s) => ({ credentials: s.credentials, fetchCredentials: s.fetchCredentials })),
  );
  const { personas, fetchPersonas } = useAgentStore(
    useShallow((s) => ({ personas: s.personas, fetchPersonas: s.fetchPersonas })),
  );

  // Fetch-if-empty exactly once: an empty vault re-produces the guard state
  // (fresh [] identity per fetch), which looped fetchCredentials indefinitely.
  const credentialsRequestedRef = useRef(false);
  useEffect(() => {
    if ((!credentials || credentials.length === 0) && !credentialsRequestedRef.current) {
      credentialsRequestedRef.current = true;
      fetchCredentials().catch(silentCatch('cockpit_connected_services_fetch_credentials'));
    }
  }, [credentials, fetchCredentials]);

  // Same fetch-if-empty guard for personas: without this, usage counts stay
  // empty until the user happens to visit another tab that fetches personas.
  const personasRequestedRef = useRef(false);
  useEffect(() => {
    if ((!personas || personas.length === 0) && !personasRequestedRef.current) {
      personasRequestedRef.current = true;
      fetchPersonas().catch(silentCatch('cockpit_connected_services_fetch_personas'));
    }
  }, [personas, fetchPersonas]);

  /**
   * Usage counts: for each credential id, the personas whose `design_context.credentialLinks`
   * map points to it. The schema is JSON TEXT, parsed defensively.
   */
  const usageByCredentialId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of personas ?? []) {
      const raw = p.design_context;
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const links = parsed.credentialLinks;
        if (links && typeof links === 'object') {
          for (const credId of Object.values(links as Record<string, unknown>)) {
            if (typeof credId === 'string' && credId.length > 0) {
              counts.set(credId, (counts.get(credId) ?? 0) + 1);
            }
          }
        }
      } catch (err) { silentCatch("features/home/sub_cockpit/widgets/ConnectedServicesWidget:catch1")(err); }
    }
    return counts;
  }, [personas]);

  // `unverifiable` (the connector has no live probe) is not a failure, and showing it as one is
  // what the resolver exists to prevent. See @/lib/credentials/healthState.
  const rows = useMemo(
    () => (credentials ?? [])
      .map((c) => ({ c, health: readCredentialHealthState(c) }))
      .sort((x, y) => HEALTH_ORDER[x.health] - HEALTH_ORDER[y.health]),
    [credentials],
  );
  const failing = rows.filter((r) => r.health === 'failed').length;

  const openConnections = () => {
    useSystemStore.getState().setSidebarSection('credentials');
  };
  const heading = title ?? t.home.nav.credentials.label;
  const noConnections = debtText('auto_no_connections_yet_5bb01e90');

  return (
    <Tile
      span={span}
      title={heading}
      count={rows.length || undefined}
      meta={failing > 0 ? <span className="k-toned t-error">{tx(t.agents.connectors.test_diff_failing, { count: failing })}</span> : undefined}
      actions={<><KitButton tone="quiet" onClick={openConnections}>{t.sidebar.manage}</KitButton>{actions}</>}
      footer={footer}
      state={rows.length === 0 ? 'empty' : undefined}
      empty={{ title: noConnections }}
      testId="cockpit-connected-services"
    >
      <Rows count={rows.length} cap={limit} empty={{ title: noConnections }} label={heading}>
        {rows.map(({ c, health }) => (
          <ServiceRow key={c.id} credential={c} health={health} used={usageByCredentialId.get(c.id) ?? 0} onPress={openConnections} />
        ))}
      </Rows>
    </Tile>
  );
}
