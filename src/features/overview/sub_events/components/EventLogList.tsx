import { useState, useCallback } from 'react';
import { Zap, Activity, RefreshCw, AlertCircle, CheckCircle2, Clock, Server, Plus, Search, Bookmark, BookmarkX, X } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { formatRelativeTime, EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { PersonaEvent } from '@/lib/types/types';
import { seedMockEvent } from '@/api/overview/events';
import { useEventLog } from '../libs/useEventLog';
import { EventDetailContent } from './EventLogItem';
import { createLogger } from "@/lib/log";

const logger = createLogger("event-log");

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export default function EventLogList() {
  const {
    recentEvents, personas, availableTypes,
    statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    sortDirection, toggleSortDirection,
    selectedEvent, setSelectedEvent,
    selectedPersonaId, setSelectedPersonaId,
    isLoading, isRefreshing, isSearching,
    filteredEvents,
    handleRefresh, getPersona,
    // Search
    searchText, setSearchText, serverHasMore,
    // Saved views
    savedViews, activeViewId, saveCurrentView, applySavedView, removeSavedView, clearFilters,
  } = useEventLog();

  const [copiedPayload, setCopiedPayload] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [viewName, setViewName] = useState('');

  const handleSeedEvent = useCallback(async () => {
    try { await seedMockEvent(); await handleRefresh(); }
    catch (err) { logger.error('Failed to seed mock event', { error: err }); }
  }, [handleRefresh]);

  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim();

  const handleSaveView = async () => {
    if (!viewName.trim()) return;
    await saveCurrentView(viewName.trim());
    setViewName('');
    setShowSaveDialog(false);
  };

  const typeOptions = [
    { value: 'all', label: 'All types' },
    ...availableTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
  ];

  const personaOptions = [
    { value: '', label: 'All personas' },
    ...personas.map((p) => ({ value: p.id, label: p.name })),
  ];

  const columns: DataGridColumn<PersonaEvent>[] = [
    {
      key: 'type',
      label: 'Type',
      width: '1fr',
      filterOptions: typeOptions,
      filterValue: typeFilter,
      onFilterChange: setTypeFilter,
      render: (event) => {
        const typeColor = EVENT_TYPE_COLORS[event.event_type]?.tailwind ?? 'text-foreground/80';
        return <span className={`typo-heading truncate ${typeColor}`}>{event.event_type}</span>;
      },
    },
    {
      key: 'source',
      label: 'Source',
      width: '1fr',
      render: (event) => (
        <span className="text-sm text-foreground truncate">{event.source_type}</span>
      ),
    },
    {
      key: 'persona',
      label: 'Persona',
      width: '1.2fr',
      filterOptions: personaOptions,
      filterValue: selectedPersonaId,
      onFilterChange: (v) => setSelectedPersonaId(v),
      render: (event) => {
        const targetPersona = getPersona(event.target_persona_id);
        if (targetPersona) {
          return (
            <div className="flex items-center gap-2 min-w-0">
              <PersonaIcon icon={targetPersona.icon} color={targetPersona.color} display="pop"
                frameClass="border border-primary/15"
                frameStyle={{ backgroundColor: colorWithAlpha(targetPersona.color || '#6366f1', 0.08) }} />
              <span className="text-sm text-foreground truncate">{targetPersona.name}</span>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center border border-primary/10 bg-muted/20 flex-shrink-0">
              <Server className="w-3.5 h-3.5 text-foreground/40" />
            </div>
            <span className="text-sm text-foreground/60 truncate">{event.source_type || 'System'}</span>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '0.8fr',
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
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-lg font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
            {statusIcon}
            {event.status}
          </span>
        );
      },
    },
    {
      key: 'created',
      label: 'Created',
      width: '0.8fr',
      sortable: true,
      align: 'right' as const,
      render: (event) => (
        <span className="text-sm text-foreground">{formatRelativeTime(event.created_at)}</span>
      ),
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Zap className="w-5 h-5 text-status-warning" />}
        iconColor="amber"
        title="Events"
        subtitle={`${filteredEvents.length}${serverHasMore ? '+' : ''} of ${recentEvents.length} event${recentEvents.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && (
              <button onClick={handleSeedEvent} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock event (dev only)">
                <Plus className="w-3.5 h-3.5" /> Mock Event
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-foreground/70 hover:text-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
              title="Refresh"
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
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search events by type, source, or payload..."
              className="w-full pl-8 pr-8 py-1.5 text-sm rounded-lg bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground/40 hover:text-foreground/70"
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
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors whitespace-nowrap"
                title="Save current filters as a view"
              >
                <Bookmark className="w-3 h-3" /> Save view
              </button>
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-secondary/40 text-foreground/70 border border-primary/10 hover:bg-secondary/60 transition-colors whitespace-nowrap"
                title="Clear all filters"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>

        {/* Saved views chips */}
        {savedViews.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-foreground/50">Views:</span>
            {savedViews.map((view) => (
              <button
                key={view.id}
                onClick={() => applySavedView(view)}
                className={`group flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg border transition-colors ${
                  activeViewId === view.id
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary/30 text-foreground/70 border-primary/10 hover:bg-secondary/50'
                }`}
              >
                <Bookmark className="w-2.5 h-2.5" />
                {view.name}
                <button
                  onClick={(e) => { e.stopPropagation(); removeSavedView(view.id); }}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 text-foreground/40 hover:text-status-error transition-opacity"
                  title="Delete view"
                >
                  <BookmarkX className="w-2.5 h-2.5" />
                </button>
              </button>
            ))}
          </div>
        )}

        {/* Save view dialog */}
        {showSaveDialog && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/40 border border-primary/10">
            <input
              type="text"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="View name (e.g. 'Failed webhooks this week')"
              className="flex-1 px-2 py-1 text-sm rounded bg-background/50 border border-primary/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveView(); if (e.key === 'Escape') setShowSaveDialog(false); }}
              autoFocus
            />
            <button
              onClick={handleSaveView}
              disabled={!viewName.trim()}
              className="px-3 py-1 text-xs rounded-lg bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 disabled:opacity-40 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => { setShowSaveDialog(false); setViewName(''); }}
              className="px-2 py-1 text-xs rounded-lg text-foreground/60 hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <ContentBody flex>
        <DataGrid<PersonaEvent>
          columns={columns}
          data={filteredEvents}
          getRowKey={(e) => e.id}
          onRowClick={setSelectedEvent}
          getRowAccent={(event) => {
            if (event.status === 'processing') return 'hover:border-l-status-processing';
            if (event.status === 'completed' || event.status === 'delivered') return 'hover:border-l-status-success';
            if (event.status === 'failed') return 'hover:border-l-status-error';
            return 'hover:border-l-status-pending';
          }}
          sortKey="created"
          sortDirection={sortDirection}
          onSort={() => toggleSortDirection()}
          pageSize={20}
          isLoading={isLoading}
          loadingLabel="Loading events..."
          emptyIcon={Activity}
          emptyTitle="No events yet"
          emptyDescription="Events from webhooks, executions, and persona actions will appear here as your agents run."
          className="flex-1"
        />
      </ContentBody>

      {selectedEvent && (
          <DetailModal
            title={`Event: ${selectedEvent.event_type}`}
            subtitle={`Status: ${selectedEvent.status}`}
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
