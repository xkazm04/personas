import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { dbConnectorCapability } from '@/api/vault/database/dbSchema';
import type { DbConnectorCapability } from '@/api/vault/database/dbSchema';

interface ConnectorCapabilityNoteProps {
  serviceType: string;
}

/**
 * Small badge that advertises the active connector's honest query-capability
 * class (full-SQL / SELECT-subset / key-value / introspection-only). The class
 * is resolved from the backend `db_connector_capability` command — the single
 * source of truth that lives next to the query dispatch — so the editor never
 * implies more SQL than the connector actually supports.
 */
export function ConnectorCapabilityNote({ serviceType }: ConnectorCapabilityNoteProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;
  const [capability, setCapability] = useState<DbConnectorCapability | null>(null);

  useEffect(() => {
    let active = true;
    dbConnectorCapability(serviceType)
      .then((c) => { if (active) setCapability(c); })
      .catch(silentCatch('features/vault/sub_databases/tabs/ConnectorCapabilityNote:fetch'));
    return () => { active = false; };
  }, [serviceType]);

  if (!capability) return null;

  const { label, hint } = describe(capability, db);

  return (
    <Tooltip content={hint}>
      <span
        data-testid="db-capability-note"
        data-capability={capability}
        className="flex items-center gap-1 typo-body px-2 py-0.5 rounded-card bg-secondary/40 border border-primary/8 text-foreground"
      >
        <Info className="w-3 h-3" />
        {label}
      </span>
    </Tooltip>
  );
}

function describe(
  capability: DbConnectorCapability,
  db: ReturnType<typeof useTranslation>['t']['vault']['databases'],
): { label: string; hint: string } {
  switch (capability) {
    case 'full-sql':
      return { label: db.capability_full_sql, hint: db.capability_full_sql_hint };
    case 'select-subset':
      return { label: db.capability_select_subset, hint: db.capability_select_subset_hint };
    case 'key-value':
      return { label: db.capability_key_value, hint: db.capability_key_value_hint };
    case 'introspection-only':
      return { label: db.capability_introspection_only, hint: db.capability_introspection_only_hint };
  }
}
