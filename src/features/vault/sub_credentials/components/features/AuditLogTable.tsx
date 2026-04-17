import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight as ChevronRightIcon, ScrollText } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

const INFO_STATUS = STATUS_COLORS.info!;
const SUCCESS_STATUS = STATUS_COLORS.success!;
const WARNING_STATUS = STATUS_COLORS.warning!;
const ERROR_STATUS = STATUS_COLORS.error!;

export const OP_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  decrypt: { label: 'Decrypted', color: INFO_STATUS.text, dot: 'bg-blue-400' },
  create: { label: 'Created', color: SUCCESS_STATUS.text, dot: 'bg-emerald-400' },
  update: { label: 'Updated', color: 'text-purple-400', dot: 'bg-purple-400' },
  delete: { label: 'Deleted', color: ERROR_STATUS.text, dot: 'bg-red-400' },
  healthcheck: { label: 'Healthcheck', color: WARNING_STATUS.text, dot: 'bg-amber-400' },
};

const AUDIT_FILTERS = ['all', 'decrypt', 'create', 'update', 'delete', 'healthcheck'] as const;
const AUDIT_PAGE_SIZE = 20;

export function AuditLogTable({ auditLog }: { auditLog: CredentialAuditEntry[] }) {
  const { t } = useTranslation();
  const [auditFilter, setAuditFilter] = useState('all');
  const [auditPage, setAuditPage] = useState(0);

  const filtered = useMemo(() => {
    if (auditFilter === 'all') return auditLog;
    return auditLog.filter((e) => e.operation === auditFilter);
  }, [auditLog, auditFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / AUDIT_PAGE_SIZE));
  const pageEntries = filtered.slice(auditPage * AUDIT_PAGE_SIZE, (auditPage + 1) * AUDIT_PAGE_SIZE);

  const handleFilterChange = (f: string) => {
    setAuditFilter(f);
    setAuditPage(0);
  };

  if (auditLog.length === 0) {
    return (
      <div data-testid="audit-log-empty">
        <EmptyIllustration
          icon={ScrollText}
          heading={t.vault.audit_log.empty}
          description={t.vault.audit_log.empty_hint}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <div data-testid="audit-log-tab" className="space-y-2">
      {/* Filter */}
      <div className="flex items-center gap-1">
        {AUDIT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            className={`px-2 py-0.5 rounded typo-caption font-medium transition-colors ${
              auditFilter === f
                ? 'bg-primary/15 text-foreground/90 border border-primary/20'
                : 'text-foreground hover:text-muted-foreground/90 hover:bg-secondary/30'
            }`}
          >
            {f === 'all' ? 'All' : (OP_LABELS[f]?.label ?? f)}
          </button>
        ))}
        <span className="ml-auto typo-caption text-foreground">{filtered.length} entries</span>
      </div>

      {/* Table */}
      <div className="border border-primary/10 rounded-modal overflow-hidden">
        <table className="w-full typo-body">
          <thead>
            <tr className="border-b border-primary/10 bg-secondary/10">
              <th className="text-left px-3 py-1.5 typo-label font-medium text-foreground uppercase tracking-wider">{t.vault.features.intelligence.operation}</th>
              <th className="text-left px-3 py-1.5 typo-label font-medium text-foreground uppercase tracking-wider">{t.vault.features.intelligence.detail}</th>
              <th className="text-right px-3 py-1.5 typo-label font-medium text-foreground uppercase tracking-wider">{t.vault.features.intelligence.time}</th>
            </tr>
          </thead>
          <tbody>
            {pageEntries.map((entry) => {
              const op = OP_LABELS[entry.operation] ?? { label: entry.operation, color: 'text-foreground', dot: 'bg-muted-foreground' };
              return (
                <tr key={entry.id} className="border-b border-primary/5 last:border-b-0 hover:bg-secondary/10" data-testid={`audit-entry-${entry.id}`}>
                  <td className="px-3 py-1.5">
                    <span className={`inline-flex items-center gap-1.5 typo-caption font-medium ${op.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${op.dot}`} />
                      {op.label}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 typo-caption text-foreground truncate max-w-[300px]">
                    {entry.persona_name ? `by ${entry.persona_name}` : entry.detail ?? ''}
                  </td>
                  <td className="px-3 py-1.5 typo-caption text-foreground tabular-nums text-right whitespace-nowrap">
                    {formatRelativeTime(entry.created_at, '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setAuditPage((p) => Math.max(0, p - 1))}
            disabled={auditPage === 0}
            className="p-1 rounded hover:bg-secondary/30 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-foreground" />
          </button>
          <span className="typo-caption text-foreground tabular-nums">
            Page {auditPage + 1}/{totalPages}
          </span>
          <button
            onClick={() => setAuditPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={auditPage >= totalPages - 1}
            className="p-1 rounded hover:bg-secondary/30 disabled:opacity-30 transition-colors"
          >
            <ChevronRightIcon className="w-3.5 h-3.5 text-foreground" />
          </button>
        </div>
      )}
    </div>
  );
}
