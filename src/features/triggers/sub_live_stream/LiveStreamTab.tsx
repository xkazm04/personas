import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Cloud, Radio, Unplug, Pause, Play, Trash2 } from 'lucide-react';
import { ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { PersonaColumnFilter } from '@/features/shared/components/forms/PersonaColumnFilter';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { useAgentStore } from '@/stores/agentStore';
import { listEvents } from '@/api/overview/events';
import { formatRelativeTime, EVENT_STATUS_COLORS } from '@/lib/utils/formatters';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { PersonaEvent } from '@/lib/types/types';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { EventDetailModal } from './EventDetailModal';
import { EventTypeChip } from './EventTypeChip';

const STREAM_WINDOW_MS = 60_000; // rolling window for events/min calculation

/** Trim timestamps older than `windowMs` from a sorted array (mutates in place). */
function trimRollingWindow(timestamps: number[], windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  while (timestamps.length > 0 && timestamps[0]! < cutoff) {
    timestamps.shift();
  }
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'skipped', label: 'Skipped' },
];

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export function LiveStreamTab() {
  const personas = useAgentStore((s) => s.personas);

  const [events, setEvents] = useState<PersonaEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [targetPersonaId, setTargetPersonaId] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<PersonaEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedQueueCount, setPausedQueueCount] = useState(0);
  // Receive counts since component mounted (resets on Clear)
  const [totalReceived, setTotalReceived] = useState(0);
  // Rolling timestamps for events/min calculation
  const recvTimestamps = useRef<number[]>([]);
  const [eventsPerMin, setEventsPerMin] = useState(0);

  const newEventIds = useRef(new Set<string>());
  const eventIdIndex = useRef(new Set<string>());
  const pausedQueueRef = useRef<PersonaEvent[]>([]);

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

  const attached = useEventBusListener((evt: PersonaEvent) => {
    // CDC multiplexes full events with lightweight {action,table,rowid}
    // notifications on the same channel — reject the latter.
    if (!evt?.id || !evt?.event_type) return;

    // Stats: track every received event regardless of pause state
    recvTimestamps.current.push(Date.now());
    trimRollingWindow(recvTimestamps.current, STREAM_WINDOW_MS);
    setTotalReceived((c) => c + 1);
    setEventsPerMin(recvTimestamps.current.length);

    if (isPaused) {
      // Buffer for replay on resume — but only NEW events; status updates on
      // already-displayed events still flow through to keep the UI honest.
      if (!eventIdIndex.current.has(evt.id)) {
        pausedQueueRef.current.push(evt);
        setPausedQueueCount(pausedQueueRef.current.length);
        return;
      }
    }

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

  // Tick the events/min counter even when no new events arrive — old timestamps
  // need to fall out of the rolling window.
  useEffect(() => {
    const interval = setInterval(() => {
      trimRollingWindow(recvTimestamps.current, STREAM_WINDOW_MS);
      setEventsPerMin(recvTimestamps.current.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleResume = useCallback(() => {
    setIsPaused(false);
    const queued = pausedQueueRef.current;
    pausedQueueRef.current = [];
    setPausedQueueCount(0);
    if (queued.length === 0) return;
    setEvents((prev) => {
      // Drain queued in original order (oldest first), prepending each
      let next = prev;
      for (let i = queued.length - 1; i >= 0; i--) {
        const evt = queued[i]!;
        if (eventIdIndex.current.has(evt.id)) continue;
        eventIdIndex.current.add(evt.id);
        newEventIds.current.add(evt.id);
        setTimeout(() => newEventIds.current.delete(evt.id), 1600);
        next = [evt, ...next];
      }
      if (next.length > 200) {
        for (let i = 200; i < next.length; i++) eventIdIndex.current.delete(next[i]!.id);
        next = next.slice(0, 200);
      }
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    setEvents([]);
    eventIdIndex.current.clear();
    newEventIds.current.clear();
    pausedQueueRef.current = [];
    setPausedQueueCount(0);
    setTotalReceived(0);
    recvTimestamps.current = [];
    setEventsPerMin(0);
  }, []);

  const getRowClassName = useCallback(
    (event: PersonaEvent) => newEventIds.current.has(event.id) ? 'livestream-highlight' : '',
    [],
  );

  const availableTypes = useMemo(() => [...new Set(events.map((e) => e.event_type))].sort(), [events]);
  const filteredEvents = useMemo(() => events.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (typeFilter !== 'all' && e.event_type !== typeFilter) return false;
    if (targetPersonaId && e.target_persona_id !== targetPersonaId) return false;
    return true;
  }), [events, statusFilter, typeFilter, targetPersonaId]);

  const typeOptions = useMemo(() => [
    { value: 'all', label: 'All types' },
    ...availableTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
  ], [availableTypes]);

  const getPersona = (id: string | null) =>
    id ? personas.find((p) => p.id === id) : null;

  const columns: DataGridColumn<PersonaEvent>[] = [
    {
      key: 'type',
      label: 'Type',
      width: '1fr',
      filterComponent: (
        <ColumnDropdownFilter
          label="Type"
          value={typeFilter}
          options={typeOptions}
          onChange={setTypeFilter}
        />
      ),
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
      filterComponent: (
        <PersonaColumnFilter
          value={targetPersonaId}
          onChange={setTargetPersonaId}
          personas={personas}
          label="Target Agent"
        />
      ),
      render: (event) => {
        const persona = getPersona(event.target_persona_id);
        if (persona) {
          return (
            <div className="flex items-center gap-2 min-w-0">
              <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="md" />
              <span className="text-sm text-foreground truncate">{persona.name}</span>
            </div>
          );
        }
        return <span className="text-sm text-foreground/60 truncate">broadcast</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '0.7fr',
      filterComponent: (
        <ColumnDropdownFilter
          label="Status"
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={setStatusFilter}
        />
      ),
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
      {/* Stream stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-primary/10 bg-secondary/5 flex-shrink-0">
        <div className="flex items-center gap-1.5" title={attached ? 'Connected to event bus' : 'Connecting…'}>
          <span className={`relative flex h-2 w-2 ${attached && !isPaused ? '' : 'opacity-40'}`}>
            {attached && !isPaused && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-400' : attached ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`} />
          </span>
          <span className="typo-label text-foreground/80">{isPaused ? 'Paused' : attached ? 'Live' : 'Connecting'}</span>
        </div>

        <div className="h-4 w-px bg-primary/15" />

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 tabular-nums">
          <span className="text-foreground/80 font-semibold">{eventsPerMin}</span>
          <span className="text-muted-foreground/50">events/min</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 tabular-nums">
          <span className="text-foreground/80 font-semibold">{totalReceived}</span>
          <span className="text-muted-foreground/50">received</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 tabular-nums">
          <span className="text-foreground/80 font-semibold">{events.length}</span>
          <span className="text-muted-foreground/50">in buffer</span>
        </div>
        {pausedQueueCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-300 tabular-nums">
            <span className="font-semibold">{pausedQueueCount}</span>
            <span className="text-amber-300/60">queued</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => isPaused ? handleResume() : setIsPaused(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              isPaused
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                : 'bg-secondary/30 text-foreground/70 border-primary/15 hover:bg-secondary/50 hover:text-foreground'
            }`}
            title={isPaused ? 'Resume live updates' : 'Pause incoming events'}
          >
            {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={handleClear}
            disabled={events.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border bg-secondary/30 text-foreground/70 border-primary/15 hover:bg-secondary/50 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Clear stream buffer"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>

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
          onSort={() => { }}
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
