import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { HealthState } from '@/lib/credentials/healthState';
import type { CredentialMetadata } from '@/lib/types/types';
import type { Tone } from '@/features/shared/components/kit';

import { Cell, nameCell, type TableColumn } from './widgetTable';

/** Health as the row's accent tone: failing is the one error, a verified probe a success. */
export const HEALTH_TONE: Record<HealthState, Tone> = {
  verified: 'success',
  failed: 'error',
  unreachable: 'warning',
  unverifiable: 'neutral',
  untested: 'neutral',
};

/** One credential in the Cockpit's connected-services table. */
export interface ServiceRowData {
  credential: CredentialMetadata;
  health: HealthState;
  used: number;
}

/**
 * The column model of the Cockpit's connected-services table (was `ServiceRow`, a kit `ListRow`,
 * until the owner ruled on 2026-10-03 that the app's shared `UnifiedTable` wins everywhere).
 *
 * The name is the row's one emphasis, its full text in a Hint so a long name never truncates
 * silently, and health is the row's left accent. The two facts the rows SHARE are named columns:
 * what the probe last said - its own message when it failed, the health word otherwise, toned only
 * when it IS a failure - and how many personas use the credential.
 */
export function useServiceColumns(): TableColumn<ServiceRowData>[] {
  const { t, tx } = useTranslation();
  const cl = t.vault.credential_list;
  const c = t.overview.cockpit;
  return useMemo(() => {
    const healthLabel: Record<HealthState, string> = {
      verified: cl.health_healthy,
      failed: cl.health_failing,
      unreachable: cl.health_unreachable,
      unverifiable: cl.health_unverifiable,
      untested: cl.health_untested,
    };
    return [
      {
        key: 'name',
        label: c.col_service,
        width: 'minmax(0, 1fr)',
        render: (row) => nameCell(row.credential.name, healthLabel[row.health], row.credential.name),
      },
      {
        key: 'status',
        label: t.common.status,
        width: 'minmax(0, 1.4fr)',
        render: (row) => {
          const failing = row.health === 'failed' || row.health === 'unreachable';
          const message = failing ? row.credential.healthcheck_last_message || healthLabel[row.health] : null;
          return failing
            ? <Cell value={message} tone={HEALTH_TONE[row.health]} hint={message} />
            : <Cell value={healthLabel[row.health]} />;
        },
      },
      {
        key: 'used',
        label: c.col_used_by,
        width: 'minmax(0, 8rem)',
        align: 'right' as const,
        render: (row) => (
          <Cell
            data
            value={row.used > 0
              ? tx(row.used === 1 ? t.vault.audit_log.personas_one : t.vault.audit_log.personas_other, { count: row.used })
              : null}
          />
        ),
      },
    ];
  }, [c.col_service, c.col_used_by, cl, t.common.status, t.vault.audit_log.personas_one, t.vault.audit_log.personas_other, tx]);
}
