import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Zap, RefreshCw, AlertCircle, CheckCircle2, Clock, Plus, Search, Bookmark, BookmarkX, X, BookOpen, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useSystemStore } from '@/stores/systemStore';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { PersonaColumnFilter } from '@/features/shared/components/forms/PersonaColumnFilter';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { formatRelativeTime, EVENT_STATUS_COLORS, getEventTypeColor } from '@/lib/utils/formatters';
import type { PersonaEvent } from '@/lib/types/types';
import { seedMockEvent } from '@/api/overview/events';
import { useEventLog } from '../libs/useEventLog';
import { EventDetailContent } from './EventLogItem';
import { createLogger } from "@/lib/log";

const logger = createLogger("event-log");

// Status options and source type labels are built inside the component to use translations

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

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
  const SOURCE_TYPE_LABELS: Record<string, string> = {
    persona: t.overview.events.source_event,
    user: t.overview.events.source_manual,
    system: t.overview.events.source_system,
    scheduler: t.overview.events.source_scheduled,
  };
  const {
    recentEvents, personas, availableTypes,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    sortDirection: _sortDirection, toggleSortDirection: _toggleSortDirection,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId,
    isLoading, isRefreshing, isSearching,
    filteredEvents,
    handleRefresh, getPersona,
    // Search
    searchText, setSearchText, serverHasMore,
    // Cursor pagination
    loadOlder, hasMoreOlder, isLoadingOlder,
    // Saved views
    savedViews, activeViewId, saveCurrentView, applySavedView, removeSavedView, clearFilters,
  } = useEventLog();

  // Auto-load older events when the sentinel scrolls into view
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMoreOlder || isLoadingOlder) return;
    const node = loadMoreSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadOlder();
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreOlder, isLoadingOlder, loadOlder, filteredEvents.length]);

  const [copiedPayload, setCopiedPayload] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [viewName, setViewName] = useState('');
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
  }, [filteredEvents]);

  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim() || triggerFilter !== 'all';

  const handleSaveView = async () => {
    if (!viewName.trim()) return;
    await saveCurrentView(viewName.trim());
    setViewName('');
    setShowSaveDialog(false);
  };

  const typeOptions = [
    { value: 'all', label: t.overview.events.all_types },
    ...[...availableTypes].sort((a, b) => a.localeCompare(b)).map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
  ];


  const columns: TableColumn<PersonaEvent>[] = [
    {
      key: 'trigger',
      label: 'Trigger',
      width: 'minmax(100px, 0.6fr)',
      filterComponent: (
        <ColumnDropdownFilter
          label="Trigger"
          value={triggerFilter}
          options={triggerOptions}
          onChange={setTriggerFilter}
        />
      ),
      render: (event) => {
        const label = SOURCE_TYPE_LABELS[event.source_type] ?? event.source_type;
        return <span className="typo-body text-foreground">{label}</span>;
      },
    },
    {
      key: 'persona',
      label: 'Persona',
      width: 'minmax(160px, 1fr)',
      filterComponent: (
        <PersonaColumnFilter
          value={selectedPersonaId}
          onChange={(v) => setSelectedPersonaId(v)}
          personas={personas}
        />
      ),
      render: (event) => {
        const targetPersona = getPersona(event.target_persona_id);
        if (targetPersona) {
          return <span className="typo-body text-foreground truncate">{targetPersona.name}</span>;
        }
        // Strip "persona:" prefix from source_type values
        const raw = event.source_type || '';
        const display = raw.startsWith('persona:') ? raw.slice(8) : '';
        return display
          ? <span className="typo-body text-foreground truncate">{display}</span>
          : <span className="typo-body text-foreground">—</span>;
      },
    },
    {
      key: 'type',
      label: 'Event Name',
      width: 'minmax(180px, 1.2fr)',
      filterOptions: typeOptions,
      filterValue: typeFilter,
      onFilterChange: setTypeFilter,
      render: (event) => {
        const typeColor = getEventTypeColor(event.event_type).tailwind;
        return <span className={`typo-heading truncate ${typeColor}`}>{event.event_type}</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: 'minmax(140px, 0.8fr)',
      filterOptions: STATUS_OPTIONS,
      filterValue: statusFilter,
      onFilterChange: setStatusFilter,
      render: (event) => {
        const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
        const statusIcon = event.status === 'completed' || event.status === 'delivered'
          ? <CheckCircle2 className="w-3 h-3" />
          : event.status === 'failed' ? <AlertCircle className="w-3 h-3" />
            : event.status === 'processing' ? <LoadingSpinner size="xs" />
              : <Clock className="w-3 h-3" />;
        return (
          <span className={`inline-flex items-center gap-1.5 typo-caption px-2 py-0.5 rounded-card font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
            {statusIcon}
            {event.status}
          </span>
        );
      },
    },
    {
      key: 'created',
      label: 'Created',
      width: 'minmax(120px, 0.8fr)',
      sortable: true,
      align: 'right' as const,
      render: (event) => (
        <span className="typo-body text-foreground">{formatRelativeTime(event.created_at)}</span>
      ),
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-status-warning" />}
        iconColor="amber"
        title={t.overview.events.title}
        subtitle={`${filteredEvents.length}${serverHasMore ? '+' : ''} ${tx(recentEvents.length === 1 ? t.overview.events.subtitle_one : t.overview.events.subtitle, { filtered: filteredEvents.length, total: recentEvents.length })}`}
        actions={
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && (
              <button onClick={handleSeedEvent} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title={t.overview.events.seed_tooltip}>
                <Plus className="w-3.5 h-3.5" /> {t.overview.events.mock_event}
              </button>
            )}
            <button
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

      {/* Search bar + saved views */}
      <div className="px-4 pb-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t.overview.events.search_placeholder}
              className="w-full pl-8 pr-8 py-1.5 typo-body rounded-card bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 transition-colors"
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground hover:text-foreground/70"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isSearching && <LoadingSpinner size="xs" />}
          {hasActiveFilters && (
            <>
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex items-center gap-1 px-2 py-1.5 typo-caption rounded-card bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors whitespace-nowrap"
                title="Save current filters as a view"
              >
                <Bookmark className="w-3 h-3" /> {t.overview.events.save_view}
              </button>
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-2 py-1.5 typo-caption rounded-card bg-secondary/40 text-foreground border border-primary/10 hover:bg-secondary/60 transition-colors whitespace-nowrap"
                title="Clear all filters"
              >
                <X className="w-3 h-3" /> {t.common.clear}
              </button>
            </>
          )}
        </div>

        {/* Saved views chips */}
        {savedViews.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="typo-caption text-foreground">{t.overview.events.views_label}</span>
            {savedViews.map((view) => (
              <button
                key={view.id}
                onClick={() => applySavedView(view)}
                className={`group flex items-center gap-1 px-2 py-0.5 typo-caption rounded-card border transition-colors ${activeViewId === view.id
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary/30 text-foreground border-primary/10 hover:bg-secondary/50'
                  }`}
              >
                <Bookmark className="w-2.5 h-2.5" />
                {view.name}
                <button
                  onClick={(e) => { e.stopPropagation(); removeSavedView(view.id); }}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 text-foreground hover:text-status-error transition-opacity"
                  title={t.overview.events.delete_view}
                >
                  <BookmarkX className="w-2.5 h-2.5" />
                </button>
              </button>
            ))}
          </div>
        )}

        {/* Save view dialog */}
        {showSaveDialog && (
          <div className="flex items-center gap-2 p-2 rounded-card bg-secondary/40 border border-primary/10">
            <input
              type="text"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder={t.overview.events.view_name_placeholder}
              className="flex-1 px-2 py-1 typo-body rounded bg-background/50 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveView(); if (e.key === 'Escape') setShowSaveDialog(false); }}
              autoFocus
            />
            <button
              onClick={handleSaveView}
              disabled={!viewName.trim()}
              className="px-3 py-1 typo-caption rounded-card bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 disabled:opacity-40 transition-colors"
            >
              {t.common.save}
            </button>
            <button
              onClick={() => { setShowSaveDialog(false); setViewName(''); }}
              className="px-2 py-1 typo-caption rounded-card text-foreground hover:text-foreground transition-colors"
            >
              {t.common.cancel}
            </button>
          </div>
        )}
      </div>

      <ContentBody flex>
        {!isLoading && displayedEvents.length === 0 && !hasActiveFilters ? (
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
              isLoading={isLoading}
              emptyTitle={t.overview.events.no_filter_match}
              rowHeight={44}
              className="flex-1"
            />
            {(hasMoreOlder || isLoadingOlder) && displayedEvents.length > 0 && (
              <div ref={loadMoreSentinelRef} className="flex items-center justify-center py-2 border-t border-primary/5">
                {isLoadingOlder ? (
                  <span className="flex items-center gap-2 typo-caption text-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" /> {t.overview.events.loading_older}
                  </span>
                ) : (
                  <button
                    onClick={loadOlder}
                    className="typo-caption text-foreground hover:text-foreground transition-colors"
                  >
                    {t.overview.events.load_older}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </ContentBody>

      {selectedEvent && (
        <DetailModal
          title={`${t.overview.events.event_detail_title} ${selectedEvent.event_type}`}
          subtitle={`${t.overview.events.event_detail_status} ${selectedEvent.status}`}
          onClose={() => { setSelectedEvent(null); setCopiedPayload(false); }}
        >
          <EventDetailContent
            event={selectedEvent}
            copiedPayload={copiedPayload}
            setCopiedPayload={setCopiedPayload}
          />
        </DetailModal>
      )}
    </ContentBox>
  );
}
