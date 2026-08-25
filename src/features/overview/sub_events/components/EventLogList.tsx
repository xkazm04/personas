import { useCallback, useMemo, useState } from 'react';
import { Zap, RefreshCw, Plus, BookOpen, Loader2, BellOff } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { UnifiedTable } from '@/features/shared/components/display/UnifiedTable';
import { timeGroupKey, timeGroupLabels } from '@/features/shared/components/display/grouping';
import type { PersonaEvent } from '@/lib/types/types';
import { seedMockEvent } from '@/api/overview/events';
import { useEventLog } from '../libs/useEventLog';
import { EventDetailContent } from './EventDetailContent';
import { EventLogToolbar } from './EventLogToolbar';
import { useEventLogColumns } from './eventLogColumns';
import { createLogger } from "@/lib/log";


const logger = createLogger("event-log");

const EVENT_ROW_HEIGHT = 44;

export default function EventLogList() {
  const { t, tx } = useTranslation();
  const STATUS_OPTIONS = [
    { value: 'all', label: t.overview.events.all_statuses },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'pending', label: 'Pending' },
    { value: 'processed', label: 'Processed' },
    { value: 'processing', label: 'Processing' },
    { value: 'skipped', label: 'Skipped' },
  ];
  const SOURCE_TYPE_LABELS = useMemo<Record<string, string>>(() => ({
    persona: t.overview.events.source_event,
    user: t.overview.events.source_manual,
    system: t.overview.events.source_system,
    scheduler: t.overview.events.source_scheduled,
  }), [t.overview.events.source_event, t.overview.events.source_manual, t.overview.events.source_scheduled, t.overview.events.source_system]);
  const {
    recentEvents, personas, availableTypes, skippedStats,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId,
    isFetching, isRefreshing, isSearching,
    filteredEvents,
    handleRefresh, getPersona,
    // Search
    searchText, setSearchText, serverHasMore,
    // Cursor pagination
    loadOlder, hasMoreOlder, isLoadingOlder,
    // Saved views
    savedViews, activeViewId, saveCurrentView, applySavedView, removeSavedView, clearFilters,
  } = useEventLog();

  const [triggerFilter, setTriggerFilter] = useState<string>('all');

  const handleSeedEvent = useCallback(async () => {
    try { await seedMockEvent(); await handleRefresh(); }
    catch (err) { logger.error('Failed to seed mock event', { error: err }); }
  }, [handleRefresh]);

  // Apply client-side trigger filter on top of server-filtered events
  const displayedEvents = useMemo(() => {
    if (triggerFilter === 'all') return filteredEvents;
    return filteredEvents.filter((e) => e.source_type === triggerFilter);
  }, [filteredEvents, triggerFilter]);

  // Unique trigger (source_type) values from current data for dropdown
  const triggerOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const e of filteredEvents) unique.add(e.source_type);
    const items = Array.from(unique)
      .sort((a, b) => (SOURCE_TYPE_LABELS[a] ?? a).localeCompare(SOURCE_TYPE_LABELS[b] ?? b))
      .map((v) => ({ value: v, label: SOURCE_TYPE_LABELS[v] ?? v }));
    return [{ value: 'all', label: t.overview.events.all_triggers }, ...items];
  }, [SOURCE_TYPE_LABELS, filteredEvents, t.overview.events.all_triggers]);

  const hasActiveFilters = !!(statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim() || triggerFilter !== 'all');

  const typeOptions = useMemo(() => [
    { value: 'all', label: t.overview.events.all_types },
    ...[...availableTypes].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v.replace(/_/g, ' ') })),
  ], [availableTypes, t.overview.events.all_types]);

  // Bucket the event stream under sticky day headers (Today / Yesterday / …)
  // for temporal wayfinding. Grouping runs over UnifiedTable's already-sorted
  // rows; events arrive newest-first so the buckets stay contiguous.
  const groupLabels = useMemo(() => timeGroupLabels(t), [t]);
  const groupOf = useCallback(
    (event: PersonaEvent) => {
      const key = timeGroupKey(event.created_at);
      return { key, label: groupLabels[key] };
    },
    [groupLabels],
  );

  const columns = useEventLogColumns({
    t,
    sourceTypeLabels: SOURCE_TYPE_LABELS,
    personas,
    getPersona,
    triggerFilter, setTriggerFilter, triggerOptions,
    typeOptions, typeFilter, setTypeFilter,
    statusOptions: STATUS_OPTIONS, statusFilter, setStatusFilter,
    selectedPersonaId, setSelectedPersonaId,
  });

  // ── Loading choreography (docs/design/overview-loading.md, law 1) ──
  // `isFetching` is handed straight to UnifiedTable, which owns the whole
  // cold-load contract: calm delayed ghost rows under its real column header
  // while the region is empty and a fetch runs, the settled-only empty state,
  // and the id-guarded row cascade. Rows already on screen — including store
  // data pre-warmed by the event bus or a prior visit — are never hidden by a
  // fetch. The only thing left here is gating this surface's own rich
  // zero-events CTA on the fetch having settled (law 5).
  const showRichEmpty = !isFetching && displayedEvents.length === 0 && !hasActiveFilters;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-status-warning" />}
        iconColor="amber"
        title={t.overview.events.title}
        subtitle={tx(recentEvents.length === 1 ? t.overview.events.subtitle_one : t.overview.events.subtitle, { filtered: filteredEvents.length, total: `${recentEvents.length}${serverHasMore ? '+' : ''}` })}
        actions={
          <div className="flex items-center gap-2">
            {/* Dead-trigger signal: events that fired but had no subscriber in
                the last 7 days. Hidden when everything matched. */}
            {skippedStats && Number(skippedStats.skipped) > 0 && (
              <Tooltip
                content={tx(t.overview.events.skipped_stat_tooltip, {
                  skipped: Number(skippedStats.skipped),
                  total: Number(skippedStats.total),
                  rate: `${Math.round((Number(skippedStats.skipped) / Math.max(1, Number(skippedStats.total))) * 100)}%`,
                })}
              >
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 typo-caption rounded-card bg-status-warning/10 text-status-warning border border-status-warning/20">
                  <BellOff className="w-3 h-3" />
                  {tx(t.overview.events.skipped_stat_label, { skipped: Number(skippedStats.skipped) })}
                </span>
              </Tooltip>
            )}
            {import.meta.env.DEV && (
              <button type="button" onClick={handleSeedEvent} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title={t.overview.events.seed_tooltip}>
                <Plus className="w-3.5 h-3.5" /> {t.overview.events.mock_event}
              </button>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-card text-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
              title={t.common.refresh}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <EventLogToolbar
        searchText={searchText}
        setSearchText={setSearchText}
        isSearching={isSearching}
        hasActiveFilters={hasActiveFilters}
        clearFilters={clearFilters}
        savedViews={savedViews}
        activeViewId={activeViewId}
        saveCurrentView={saveCurrentView}
        applySavedView={applySavedView}
        removeSavedView={removeSavedView}
      />

      <ContentBody flex>
        {showRichEmpty ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <EmptyState
              icon={Zap}
              title={t.overview.events.no_events}
              subtitle={t.overview.events.no_events_hint}
              iconColor="text-amber-400/80"
              iconContainerClassName="bg-amber-500/10 border-amber-500/20"
              action={{ label: t.overview.dashboard.create_persona, onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus }}
              secondaryAction={{ label: t.overview.dashboard.from_templates, onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen }}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <UnifiedTable<PersonaEvent>
              columns={columns}
              data={displayedEvents}
              getRowKey={(e) => e.id}
              onRowClick={setSelectedEvent}
              isLoading={isFetching}
              emptyTitle={t.overview.events.no_filter_match}
              rowHeight={EVENT_ROW_HEIGHT}
              rowAccent={(e) =>
                e.status === 'failed'
                  ? 'border-l-red-400/70'
                  : e.status === 'pending' || e.status === 'processing'
                    ? 'border-l-amber-400/70'
                    : undefined
              }
              className="h-full"
              tableId="overview-events"
              scrollRestoreKey={`overview/events|status=${statusFilter}|type=${typeFilter}|persona=${selectedPersonaId ?? 'all'}|trigger=${triggerFilter}`}
              rowReveal={{ resetKey: `${statusFilter}|${typeFilter}|${selectedPersonaId ?? 'all'}|${triggerFilter}` }}
              groupBy={groupOf}
              onEndReached={hasMoreOlder && !isLoadingOlder ? loadOlder : undefined}
            />
            {/* Infinite scroll drives loadOlder from the table's own scroll
                container; this strip just reflects the in-flight fetch. */}
            {isLoadingOlder && displayedEvents.length > 0 && (
              <div className="flex items-center justify-center py-2 border-t border-primary/5">
                <span className="flex items-center gap-2 typo-caption text-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> {t.overview.events.loading_older}
                </span>
              </div>
            )}
          </div>
        )}
      </ContentBody>

      {selectedEvent && (
        <DetailModal
          title={`${t.overview.events.event_detail_title} ${selectedEvent.event_type}`}
          subtitle={`${t.overview.events.event_detail_status} ${selectedEvent.status}`}
          onClose={() => setSelectedEvent(null)}
        >
          <EventDetailContent event={selectedEvent} />
        </DetailModal>
      )}
    </ContentBox>
  );
}
