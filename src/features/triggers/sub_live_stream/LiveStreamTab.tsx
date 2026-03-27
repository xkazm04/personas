import { useState, useEffect, useRef, useCallback } from 'react';
import { Cloud, Radio, Unplug } from 'lucide-react';
import { ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { useAgentStore } from '@/stores/agentStore';
import { listEvents } from '@/api/overview/events';
import { formatRelativeTime, EVENT_STATUS_COLORS } from '@/lib/utils/formatters';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { PersonaEvent } from '@/lib/types/types';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { EventDetailModal } from './EventDetailModal';
import { EventTypeChip } from './EventTypeChip';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export function LiveStreamTab() {
  const personas = useAgentStore((s) => s.personas);

  const [events, setEvents] = useState<PersonaEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState<PersonaEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const newEventIds = useRef(new Set<string>());
  const eventIdIndex = useRef(new Set<string>());

  useEffect(() => {
    let stale = false;
    listEvents(100).then((recentEvents) => {
      if (!stale) {
        eventIdIndex.current = new Set(recentEvents.map((e) => e.id));
        setEvents(recentEvents);
        setIsLoading(false);
      }
    }).catch(() => { if (!stale) setIsLoading(false); });
    return () => { stale = true; };
  }, [personas]);

  useEventBusListener((evt: PersonaEvent) => {
    setEvents((prev) => {
      if (eventIdIndex.current.has(evt.id)) {
        return prev.map((e) => (e.id === evt.id ? evt : e));
      }
      eventIdIndex.current.add(evt.id);
      newEventIds.current.add(evt.id);
      setTimeout(() => newEventIds.current.delete(evt.id), 1600);
      const next = [evt, ...prev];
      if (next.length > 200) {
        eventIdIndex.current.delete(next[200]!.id);
        return next.slice(0, 200);
      }
      return next;
    });
  });

  const getRowClassName = useCallback(
    (event: PersonaEvent) => newEventIds.current.has(event.id) ? 'livestream-highlight' : '',
    [],
  );

  const availableTypes = [...new Set(events.map((e) => e.event_type))].sort();
  const filteredEvents = events.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (typeFilter !== 'all' && e.event_type !== typeFilter) return false;
    return true;
  });

  const typeOptions = [
    { value: 'all', label: 'All types' },
    ...availableTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
  ];

  const getPersona = (id: string | null) =>
    id ? personas.find((p) => p.id === id) : null;

  const columns: DataGridColumn<PersonaEvent>[] = [
    {
      key: 'type',
      label: 'Type',
      width: '1fr',
      filterOptions: typeOptions,
      filterValue: typeFilter,
      onFilterChange: setTypeFilter,
      render: (event) => <EventTypeChip eventType={event.event_type} />,
    },
    {
      key: 'source',
      label: 'Source',
      width: '0.8fr',
      render: (event) => (
        <span className="text-sm text-foreground truncate flex items-center gap-1">
          {event.source_type === 'cloud_webhook' && <Cloud className="w-3 h-3 text-blue-400 flex-shrink-0" />}
          {event.source_type === 'smee_relay' && <Unplug className="w-3 h-3 text-purple-400 flex-shrink-0" />}
          {event.source_type}
        </span>
      ),
    },
    {
      key: 'target',
      label: 'Target Agent',
      width: '1fr',
      render: (event) => {
        const persona = getPersona(event.target_persona_id);
        if (persona) {
          return (
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-5 h-5 rounded-md flex items-center justify-center text-xs border border-primary/15 flex-shrink-0"
                style={{ backgroundColor: colorWithAlpha(persona.color || '#6366f1', 0.08) }}
              >
                {persona.icon || '\u{1F916}'}
              </div>
              <span className="text-sm text-foreground truncate">{persona.name}</span>
            </div>
          );
        }
        return <span className="text-sm text-muted-foreground/60 truncate">broadcast</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '0.7fr',
      filterOptions: STATUS_OPTIONS,
      filterValue: statusFilter,
      onFilterChange: setStatusFilter,
      render: (event) => {
        const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
        return (
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
            {event.status}
          </span>
        );
      },
    },
    {
      key: 'created',
      label: 'Time',
      width: '0.7fr',
      sortable: true,
      align: 'right' as const,
      render: (event) => (
        <span className="text-sm text-foreground/70">{formatRelativeTime(event.created_at)}</span>
      ),
    },
  ];

  return (
    <>
      <ContentBody flex>
        <DataGrid<PersonaEvent>
          columns={columns}
          data={filteredEvents}
          getRowKey={(e) => e.id}
          getRowClassName={getRowClassName}
          onRowClick={setSelectedEvent}
          getRowAccent={(event) => {
            if (event.status === 'processing') return 'hover:border-l-status-processing';
            if (event.status === 'completed' || event.status === 'delivered') return 'hover:border-l-status-success';
            if (event.status === 'failed') return 'hover:border-l-status-error';
            return 'hover:border-l-status-pending';
          }}
          sortKey="created"
          sortDirection="desc"
          onSort={() => {}}
          pageSize={20}
          isLoading={isLoading}
          loadingLabel="Connecting to event bus..."
          emptyIcon={Radio}
          emptyTitle="No events on the bus"
          emptyDescription="Events will appear here in real-time as agents publish and subscribe through the shared event bus."
          className="flex-1"
        />
      </ContentBody>

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </>
  );
}
