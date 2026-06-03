import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { storeBus } from '@/lib/storeBus';
import { silentCatch } from '@/lib/silentCatch';
import { getAuditIncident } from '@/api/overview/incidents';
import { useIncidentsData } from '../libs/useIncidentsData';
import { useIncidentActions } from '../libs/useIncidentActions';
import { consumePendingIncidentDeepLink } from '../libs/incidentDeepLink';
import { IncidentsInboxKpiHeader } from './IncidentsInboxKpiHeader';
import { IncidentSeverityLegend } from './IncidentSeverityLegend';
import { IncidentsFilterBar } from './IncidentsFilterBar';
import { IncidentRow } from './IncidentRow';
import { IncidentAgentGroup } from './IncidentAgentGroup';
import { IncidentDetailModal } from './IncidentDetailModal';
import { groupIncidentsByAgent } from '../libs/groupIncidents';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

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
  const [detailIncident, setDetailIncident] = useState<AuditIncident | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const { incidents, summary, loading, error, refresh } = useIncidentsData(filters);
  const actions = useIncidentActions({
    onAfterChange: async () => {
      setSelectedIds(new Set());
      await refresh();
    },
  });

  // Keep the latest loaded incidents in a ref so the deep-link resolver can
  // prefer the in-memory list without making the storeBus subscription depend
  // on `incidents` (which would tear down / re-add the listener on every refresh).
  const incidentsRef = useRef<AuditIncident[]>(incidents);
  incidentsRef.current = incidents;

  // Deep-link: open a specific incident's detail modal when Athena's
  // `incident_blocker` nudge is engaged. The engage handler navigates here
  // (lazy-mounting this component) and both (a) latches the id via
  // `incidentDeepLink` and (b) emits `incidents:open-detail`. We consume the
  // latch on mount (covers the case where the emit fired before we subscribed)
  // AND subscribe to the event (covers the already-mounted case). Resolve from
  // the loaded list first; otherwise fetch by id.
  useEffect(() => {
    let cancelled = false;

    const openById = (incidentId: string) => {
      const fromList = incidentsRef.current.find((i) => i.id === incidentId);
      if (fromList) {
        if (!cancelled) setDetailIncident(fromList);
        return;
      }
      getAuditIncident(incidentId)
        .then((incident) => {
          if (!cancelled && incident) setDetailIncident(incident);
        })
        .catch(silentCatch('incidents.deep-link.get_audit_incident'));
    };

    // Late-subscriber bridge: the emit may have fired during lazy-mount.
    const pending = consumePendingIncidentDeepLink();
    if (pending) openById(pending);

    const unsubscribe = storeBus.on('incidents:open-detail', ({ incidentId }) => {
      openById(incidentId);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Group open incidents by the agent they belong to so the inbox answers
  // "which of my agents needs me?" — worst-severity agents float to the top.
  const groups = useMemo(() => groupIncidentsByAgent(incidents), [incidents]);

  const renderRow = useCallback(
    (incident: AuditIncident) => (
      <IncidentRow
        key={incident.id}
        incident={incident}
        selected={selectedIds.has(incident.id)}
        onSelectChange={(sel) => toggleSelect(incident.id, sel)}
        onAcknowledge={() => void actions.acknowledge(incident.id)}
        onResolve={() => void actions.resolve(incident.id)}
        onDismiss={() => void actions.dismiss(incident.id)}
        onReopen={() => void actions.reopen(incident.id)}
        onOpenDetail={() => setDetailIncident(incident)}
      />
    ),
    [selectedIds, toggleSelect, actions],
  );

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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
            aria-label={t.overview.incidents.refresh}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t.overview.incidents.refresh}
          </button>
        }
      />

      <ContentBody>
        <div className="px-4 pt-3 pb-2">
          <IncidentsInboxKpiHeader summary={summary} />
        </div>

        <IncidentSeverityLegend />

        <IncidentsFilterBar filters={filters} onChange={setFilters} />

        {hasSelection && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/10 bg-primary/5">
            <span className="typo-caption text-foreground">
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
              className="px-2 py-0.5 typo-caption rounded-card border border-transparent text-foreground hover:bg-secondary/40 focus-ring"
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
          <div className="flex items-center justify-center py-16 typo-body text-foreground">
            {isFiltered
              ? t.overview.incidents.empty_state_filtered
              : t.overview.incidents.empty_state_open}
          </div>
        ) : (
          <div>
            {groups.map((group) => (
              <IncidentAgentGroup
                key={group.key}
                group={group}
                collapsed={collapsedGroups.has(group.key)}
                onToggle={() => toggleGroup(group.key)}
                onAckAll={(ids) => void actions.bulkAck(ids)}
                onResolveAll={(ids) => void actions.bulkResolve(ids)}
                renderRow={renderRow}
              />
            ))}
          </div>
        )}
      </ContentBody>

      {detailIncident && (
        <IncidentDetailModal
          incident={detailIncident}
          onClose={() => setDetailIncident(null)}
          onChanged={() => {
            setSelectedIds(new Set());
            void refresh();
          }}
        />
      )}
    </ContentBox>
  );
}
