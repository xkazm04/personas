import { useState, useCallback } from 'react';
import { Zap, Activity, RefreshCw, AlertCircle, CheckCircle2, Clock, Loader2, Server, Bot, Plus } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { AnimatePresence } from 'framer-motion';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { formatRelativeTime, EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import type { PersonaEvent } from '@/lib/types/types';
import { seedMockEvent } from '@/api/overview/events';
import { useEventLog } from '../libs/useEventLog';
import { EventDetailContent } from './EventLogItem';

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
    isLoading, isRefreshing,
    filteredEvents,
    handleRefresh, getPersona,
  } = useEventLog();

  const [copiedPayload, setCopiedPayload] = useState(false);

  const handleSeedEvent = useCallback(async () => {
    try { await seedMockEvent(); await handleRefresh(); }
    catch (err) { console.error('Failed to seed mock event:', err); }
  }, [handleRefresh]);

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
        return <span className={`text-sm font-medium truncate ${typeColor}`}>{event.event_type}</span>;
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
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0"
                style={{ backgroundColor: (targetPersona.color || '#6366f1') + '15' }}
              >
                {targetPersona.icon || <Bot className="w-3.5 h-3.5 text-foreground/50" />}
              </div>
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
        const statusIcon = event.status === 'completed' || event.status === 'processed'
          ? <CheckCircle2 className="w-3 h-3" />
          : event.status === 'failed' ? <AlertCircle className="w-3 h-3" />
          : event.status === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" />
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
        subtitle={`${filteredEvents.length} of ${recentEvents.length} event${recentEvents.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && (
              <button onClick={handleSeedEvent} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock event (dev only)">
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

      <ContentBody flex>
        <DataGrid<PersonaEvent>
          columns={columns}
          data={filteredEvents}
          getRowKey={(e) => e.id}
          onRowClick={setSelectedEvent}
          getRowAccent={(event) => {
            if (event.status === 'processing') return 'hover:border-l-status-processing';
            if (event.status === 'completed' || event.status === 'processed') return 'hover:border-l-status-success';
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

      <AnimatePresence>
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
      </AnimatePresence>
    </ContentBox>
  );
}
