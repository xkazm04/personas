import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Cloud, Radio, Unplug, Pause, Play, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { useTranslation } from '@/i18n/useTranslation';

const STREAM_WINDOW_MS = 60_000; // rolling window for events/min calculation
const STREAM_TIMESTAMP_CAP = 10_000; // hard cap on timestamp buffer to prevent OOM under sustained bursts

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export function LiveStreamTab() {
  const { t } = useTranslation();

  const STATUS_OPTIONS = [
    { value: 'all', label: t.triggers.all_statuses },
    { value: 'completed', label: t.execution_status.completed },
    { value: 'failed', label: t.execution_status.failed },
    { value: 'pending', label: t.status_tokens.event.pending },
    { value: 'processing', label: t.status_tokens.event.processing },
    { value: 'skipped', label: 'Skipped' },
  ];
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
    const now = Date.now();
    recvTimestamps.current.push(now);
    // Trim outside the rolling window
    const cutoff = now - STREAM_WINDOW_MS;
    while (recvTimestamps.current.length > 0 && recvTimestamps.current[0]! < cutoff) {
      recvTimestamps.current.shift();
    }
    // Hard-cap buffer size: under sustained high-rate bursts the time-window
    // trim alone can still let the array grow unboundedly. FIFO-evict the oldest.
    if (recvTimestamps.current.length > STREAM_TIMESTAMP_CAP) {
      recvTimestamps.current.splice(0, recvTimestamps.current.length - STREAM_TIMESTAMP_CAP);
    }
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
      const cutoff = Date.now() - STREAM_WINDOW_MS;
      while (recvTimestamps.current.length > 0 && recvTimestamps.current[0]! < cutoff) {
        recvTimestamps.current.shift();
      }
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
    { value: 'all', label: t.triggers.all_types },
    ...availableTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
  ], [availableTypes]);

  const getPersona = (id: string | null) =>
    id ? personas.find((p) => p.id === id) : null;

  const columns: DataGridColumn<PersonaEvent>[] = [
    {
      key: 'type',
      label: t.triggers.col_type,
      width: '1fr',
      filterComponent: (
        <ColumnDropdownFilter
          label={t.triggers.col_type}
          value={typeFilter}
          options={typeOptions}
          onChange={setTypeFilter}
        />
      ),
      render: (event) => <EventTypeChip eventType={event.event_type} />,
    },
    {
      key: 'source',
      label: t.triggers.col_source,
      width: '0.8fr',
      render: (event) => (
        <span className="typo-body text-foreground truncate flex items-center gap-1">
          {event.source_type === 'cloud_webhook' && <Cloud className="w-3 h-3 text-blue-400 flex-shrink-0" />}
          {event.source_type === 'smee_relay' && <Unplug className="w-3 h-3 text-purple-400 flex-shrink-0" />}
          {event.source_type}
        </span>
      ),
    },
    {
      key: 'target',
      label: t.triggers.col_target_agent,
      width: '1fr',
      filterComponent: (
        <PersonaColumnFilter
          value={targetPersonaId}
          onChange={setTargetPersonaId}
          personas={personas}
          label={t.triggers.col_target_agent}
        />
      ),
      render: (event) => {
        const persona = getPersona(event.target_persona_id);
        if (persona) {
          return (
            <div className="flex items-center gap-2 min-w-0">
              <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="md" />
              <span className="typo-body text-foreground truncate">{persona.name}</span>
            </div>
          );
        }
        return <span className="typo-body text-foreground truncate">{t.triggers.broadcast_label}</span>;
      },
    },
    {
      key: 'status',
      label: t.triggers.col_status,
      width: '0.7fr',
      filterComponent: (
        <ColumnDropdownFilter
          label={t.triggers.col_status}
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={setStatusFilter}
        />
      ),
      render: (event) => {
        const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
        return (
          <span className={`inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-card font-medium ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
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
        <span className="typo-body text-foreground">{formatRelativeTime(event.created_at)}</span>
      ),
    },
  ];

  return (
    <>
      {/* Stream stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-primary/10 bg-secondary/5 flex-shrink-0">
        <button
          onClick={() => isPaused ? handleResume() : setIsPaused(true)}
          disabled={!attached && !isPaused}
          className={`relative inline-flex items-center h-9 pl-3 pr-3.5 rounded-full typo-label font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 disabled:opacity-60 disabled:cursor-not-allowed ${
            isPaused
              ? 'bg-amber-500/10 text-amber-200 hover:bg-amber-500/15'
              : attached
                ? 'bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                : 'bg-secondary/30 text-foreground'
          }`}
          title={isPaused ? t.triggers.resume_tooltip : t.triggers.pause_tooltip}
          aria-live="polite"
        >
          <AnimatePresence mode="wait" initial={false}>
            {isPaused ? (
              <motion.span
                key="ring-paused"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-amber-400/70"
              />
            ) : attached ? (
              <motion.span
                key="ring-live"
                initial={{ opacity: 0.3 }}
                animate={{ opacity: [0.4, 1, 0.4] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-400"
              />
            ) : (
              <motion.span
                key="ring-idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 rounded-full border border-primary/20"
              />
            )}
          </AnimatePresence>

          <span className="relative flex items-center gap-2">
            {isPaused ? (
              <Play className="w-3.5 h-3.5" />
            ) : attached ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Radio className="w-3.5 h-3.5" />
            )}
            <span className="flex items-baseline gap-1.5">
              <span>
                {isPaused
                  ? t.triggers.paused_label
                  : attached
                    ? t.triggers.live_label
                    : t.triggers.connecting_label}
              </span>
              {(isPaused || attached) && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="tabular-nums font-semibold">
                    {isPaused ? pausedQueueCount : eventsPerMin}
                  </span>
                  <span className="opacity-70">
                    {isPaused ? t.triggers.queued_bare : t.triggers.events_per_min}
                  </span>
                </>
              )}
            </span>
          </span>
        </button>

        <div className="h-4 w-px bg-primary/15" />

        <div className="flex items-center gap-1.5 typo-caption text-foreground tabular-nums">
          <span className="text-foreground font-semibold">{totalReceived}</span>
          <span className="text-foreground">{t.triggers.received_label}</span>
        </div>
        <div className="flex items-center gap-1.5 typo-caption text-foreground tabular-nums">
          <span className="text-foreground font-semibold">{events.length}</span>
          <span className="text-foreground">{t.triggers.in_buffer}</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleClear}
            disabled={events.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-card typo-caption font-medium border bg-secondary/30 text-foreground border-primary/15 hover:bg-secondary/50 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={t.triggers.clear_stream_title}
          >
            <Trash2 className="w-3 h-3" />
            {t.triggers.clear_stream}
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
          loadingLabel={t.triggers.connecting_to_bus}
          emptyIcon={Radio}
          emptyTitle={t.triggers.no_events_title}
          emptyDescription={t.triggers.no_events_desc}
          className="flex-1"
        />
      </ContentBody>

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </>
  );
}
