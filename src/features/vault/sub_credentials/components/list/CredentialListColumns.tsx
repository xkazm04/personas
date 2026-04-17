import { useMemo } from 'react';
import { Key, Plug, Trash2, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { capitalize } from './credentialListTypes';
import { useTranslation } from '@/i18n/useTranslation';

export interface CredRow {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
}

export function HealthBadge({ success }: { success: boolean | null }) {
  if (success === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-card font-medium bg-secondary/60 text-foreground/60 border border-primary/15">
        <HelpCircle className="w-3 h-3" />
        untested
      </span>
    );
  }
  if (success) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-card font-medium bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border border-emerald-600/25 dark:border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" />
        healthy
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-card font-medium bg-red-600/15 text-red-700 dark:text-red-400 border border-red-600/25 dark:border-red-500/20">
      <XCircle className="w-3 h-3" />
      failing
    </span>
  );
}

export function useCredentialColumns({
  isSimple,
  pendingDeleteIds,
  categoryOptions,
  categoryFilter,
  setCategoryFilter,
  healthOptions,
  healthFilter,
  setHealthFilter,
  onDelete,
}: {
  isSimple: boolean;
  pendingDeleteIds: Set<string>;
  categoryOptions: { value: string; label: string }[];
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  healthOptions: { value: string; label: string }[];
  healthFilter: string;
  setHealthFilter: (v: string) => void;
  onDelete: (id: string) => void;
}): DataGridColumn<CredRow>[] {
  const { t } = useTranslation();
  const nameColumn: DataGridColumn<CredRow> = useMemo(() => ({
    key: 'name',
    label: 'Name',
    width: isSimple ? '1fr' : '1.4fr',
    sortable: true,
    render: (row) => {
      const isPending = pendingDeleteIds.has(row.credential.id);
      return (
        <div className={`flex items-center gap-2.5 min-w-0 ${isPending ? 'opacity-40 pointer-events-none' : ''}`}>
          {isPending ? (
            <LoadingSpinner className="text-red-400/70 flex-shrink-0" />
          ) : (
            <div
              className="w-6 h-6 rounded-input flex items-center justify-center flex-shrink-0 border"
              style={{
                backgroundColor: row.connector ? `${row.connector.color}15` : undefined,
                borderColor: row.connector ? `${row.connector.color}30` : undefined,
              }}
            >
              {row.connector?.icon_url ? (
                <ThemedConnectorIcon url={row.connector.icon_url} label={row.connector.label} color={row.connector.color} size="w-3.5 h-3.5" />
              ) : row.connector ? (
                <Plug className="w-3.5 h-3.5" style={{ color: row.connector.color }} />
              ) : (
                <Key className="w-3.5 h-3.5 text-emerald-400/80" />
              )}
            </div>
          )}
          <span className="text-sm font-medium text-foreground truncate">
            {row.credential.name}
            {isPending && <span className="ml-2 text-xs text-red-400/70 font-normal">{t.common.deleting}</span>}
          </span>
        </div>
      );
    },
  }), [isSimple, pendingDeleteIds]);

  return useMemo(() => {
    if (isSimple) {
      return [
        nameColumn,
        {
          key: 'health',
          label: 'Status',
          width: '100px',
          render: (row: CredRow) => <HealthBadge success={row.credential.healthcheck_last_success} />,
        },
      ];
    }
    return [
      nameColumn,
      {
        key: 'type',
        label: 'Type',
        width: '0.8fr',
        sortable: true,
        render: (row: CredRow) => (
          <span className="text-sm text-foreground/70 truncate">{row.connector?.label || row.credential.service_type}</span>
        ),
      },
      {
        key: 'category',
        label: 'Category',
        width: '0.7fr',
        filterOptions: categoryOptions,
        filterValue: categoryFilter,
        onFilterChange: setCategoryFilter,
        render: (row: CredRow) => (
          <span className="text-sm text-muted-foreground/60">{capitalize(row.connector?.category || 'other')}</span>
        ),
      },
      {
        key: 'health',
        label: 'Health',
        width: '0.6fr',
        filterOptions: healthOptions,
        filterValue: healthFilter,
        onFilterChange: setHealthFilter,
        render: (row: CredRow) => <HealthBadge success={row.credential.healthcheck_last_success} />,
      },
      {
        key: 'created',
        label: 'Created',
        width: '0.7fr',
        sortable: true,
        align: 'right' as const,
        render: (row: CredRow) => (
          <span className="text-sm text-foreground/60">{formatRelativeTime(row.credential.created_at)}</span>
        ),
      },
      {
        key: 'actions',
        label: '',
        width: '50px',
        align: 'right' as const,
        render: (row: CredRow) => {
          const isPending = pendingDeleteIds.has(row.credential.id);
          return isPending ? (
            <LoadingSpinner size="sm" className="text-red-400/50" />
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(row.credential.id); }}
              className="p-1 rounded-card text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={t.vault.credential_card.delete_credential}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          );
        },
      },
    ];
  }, [isSimple, nameColumn, categoryOptions, categoryFilter, healthOptions, healthFilter, onDelete, pendingDeleteIds, setCategoryFilter, setHealthFilter]);
}
