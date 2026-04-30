import { useCallback, useState } from 'react';
import { RefreshCw, Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { useIncidentsData } from '../libs/useIncidentsData';
import { useIncidentActions } from '../libs/useIncidentActions';
import { IncidentsInboxKpiHeader } from './IncidentsInboxKpiHeader';
import { IncidentsFilterBar } from './IncidentsFilterBar';
import { IncidentRow } from './IncidentRow';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';

const DEFAULT_FILTERS: IncidentFilters = {
  statuses: ['open'], // default to open-only — the inbox's primary use case
  severities: null,
  source_tables: null,
  persona_id: null,
  since: null,
};

export default function IncidentsInbox() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<IncidentFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { incidents, summary, loading, error, refresh } = useIncidentsData(filters);
  const actions = useIncidentActions({
    onAfterChange: async () => {
      setSelectedIds(new Set());
      await refresh();
    },
  });

  const toggleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const isFiltered =
    (filters.statuses?.length ?? 0) > 0 ||
    (filters.severities?.length ?? 0) > 0 ||
    (filters.source_tables?.length ?? 0) > 0 ||
    !!filters.persona_id;

  const selectedArray = Array.from(selectedIds);
  const hasSelection = selectedArray.length > 0;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Inbox className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.overview.incidents.title}
        subtitle={t.overview.incidents.subtitle}
        actions={
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-card border border-primary/15 text-foreground/80 hover:bg-secondary/40 transition-colors focus-ring"
            aria-label={t.overview.incidents.refresh}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t.overview.incidents.refresh}
          </button>
        }
      />

      <ContentBody>
        <div className="px-4 py-3">
          <IncidentsInboxKpiHeader summary={summary} />
        </div>

        <IncidentsFilterBar filters={filters} onChange={setFilters} />

        {hasSelection && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/10 bg-primary/5">
            <span className="typo-caption text-foreground/70">
              {selectedArray.length} selected
            </span>
            <button
              onClick={() => void actions.bulkAck(selectedArray)}
              className="px-2 py-0.5 typo-caption rounded-card border border-primary/15 hover:bg-secondary/40 focus-ring"
            >
              {t.overview.incidents.bulk_acknowledge_count.replace('{count}', String(selectedArray.length))}
            </button>
            <button
              onClick={() => void actions.bulkResolve(selectedArray)}
              className="px-2 py-0.5 typo-caption rounded-card border border-primary/15 hover:bg-secondary/40 focus-ring"
            >
              {t.overview.incidents.bulk_resolve_count.replace('{count}', String(selectedArray.length))}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-2 py-0.5 typo-caption rounded-card border border-transparent text-foreground/60 hover:bg-secondary/40 focus-ring"
            >
              {t.overview.incidents.bulk_clear_selection}
            </button>
          </div>
        )}

        {error && (
          <div className="px-4 py-3">
            <InlineErrorBanner
              message={`${t.overview.incidents.load_failed}: ${error}`}
              onRetry={() => void refresh()}
            />
          </div>
        )}

        {loading && incidents.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner size="lg" label={t.overview.incidents.loading} />
          </div>
        ) : incidents.length === 0 ? (
          <div className="flex items-center justify-center py-16 typo-body text-foreground/60">
            {isFiltered
              ? t.overview.incidents.empty_state_filtered
              : t.overview.incidents.empty_state_open}
          </div>
        ) : (
          <div className="divide-y divide-primary/5">
            {incidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                selected={selectedIds.has(incident.id)}
                onSelectChange={(sel) => toggleSelect(incident.id, sel)}
                onAcknowledge={() => void actions.acknowledge(incident.id)}
                onResolve={() => void actions.resolve(incident.id)}
                onDismiss={() => void actions.dismiss(incident.id)}
                onReopen={() => void actions.reopen(incident.id)}
              />
            ))}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
