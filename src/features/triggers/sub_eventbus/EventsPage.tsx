import { useState, useEffect } from "react";
import { Activity, Cloud, ExternalLink, Gauge, Radio, Unplug, Webhook, Zap } from "lucide-react";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { listAllTriggers, getTriggerHealthMap } from '@/api/pipeline/triggers';
import { listEvents, testEventFlow } from '@/api/overview/events';
import { formatRelativeTime, EVENT_STATUS_COLORS, EVENT_TYPE_COLORS } from '@/lib/utils/formatters';
import type { PersonaTrigger, PersonaEvent } from '@/lib/types/types';
import { useEventBusListener } from '@/hooks/realtime/useEventBusListener';
import { RateLimitDashboard } from "./RateLimitDashboard";
import { EventDetailModal } from '@/features/overview/sub_events/EventDetailModal';
import { CloudWebhooksTab } from './CloudWebhooksTab';
import { SmeeRelayTab } from './SmeeRelayTab';

type EventBusTab = "live" | "rate-limits" | "test" | "smee" | "webhooks";
type BusHealth = "healthy" | "degraded" | "failing" | null;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

export function EventsPage() {
  const [tab, setTab] = useState<EventBusTab>("live");
  const personas = useAgentStore((s) => s.personas);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  // Bus health
  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>([]);
  const [busHealth, setBusHealth] = useState<BusHealth>(null);

  // Live event stream
  const [events, setEvents] = useState<PersonaEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState<PersonaEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Test panel
  const [testEventType, setTestEventType] = useState('test_event');
  const [testPayload, setTestPayload] = useState('{}');
  const [testResult, setTestResult] = useState<PersonaEvent | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Fetch initial data
  useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const [triggers, healthMap, recentEvents] = await Promise.all([
          listAllTriggers(),
          getTriggerHealthMap(),
          listEvents(100),
        ]);
        if (stale) return;

        setAllTriggers(triggers);
        setEvents(recentEvents);
        setIsLoading(false);

        const healthValues = Object.values(healthMap);
        if (healthValues.includes('failing')) setBusHealth('failing');
        else if (healthValues.includes('degraded')) setBusHealth('degraded');
        else if (healthValues.length > 0) setBusHealth('healthy');
      } catch {
        setIsLoading(false);
      }
    }
    load();
    return () => { stale = true; };
  }, [personas]);

  // Real-time event bus subscription
  useEventBusListener((evt: PersonaEvent) => {
    setEvents((prev) => {
      if (prev.some((e) => e.id === evt.id)) {
        return prev.map((e) => (e.id === evt.id ? evt : e));
      }
      return [evt, ...prev].slice(0, 200);
    });
  });

  // Derived
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

  const handleTestFire = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      let payload: string | undefined;
      try {
        const parsed = JSON.parse(testPayload);
        payload = JSON.stringify(parsed);
      } catch {
        payload = undefined;
      }
      const result = await testEventFlow(testEventType, payload);
      setTestResult(result);
    } catch {
      // handled by UI
    } finally {
      setIsTesting(false);
    }
  };

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
                style={{ backgroundColor: (persona.color || '#6366f1') + '15' }}
              >
                {persona.icon || '🤖'}
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
    <ContentBox data-testid="events-page">
      <ContentHeader
        icon={<Radio className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="Event Bus"
        subtitle="Central event hub — agents publish and subscribe to events through this shared bus"
        actions={
          <button
            onClick={() => {
              setSidebarSection('overview');
              void import("@/stores/overviewStore").then(({ useOverviewStore }) =>
                useOverviewStore.getState().setOverviewTab('events')
              );
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-secondary/50 transition-colors"
            title="View full Event Log in Overview"
          >
            <ExternalLink className="w-3 h-3" />
            Full Event Log
          </button>
        }
      >
        {/* Tab bar */}
        <div className="flex items-center gap-1 mt-4">
          <button
            data-testid="events-tab-live"
            onClick={() => setTab("live")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl transition-colors ${
              tab === "live"
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                : "text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Live Stream
            {busHealth && busHealth !== 'healthy' && (
              <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                busHealth === 'failing' ? 'bg-red-400 animate-pulse' : 'bg-amber-400 animate-pulse'
              }`} />
            )}
          </button>
          <button
            data-testid="events-tab-rate-limits"
            onClick={() => setTab("rate-limits")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl transition-colors ${
              tab === "rate-limits"
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            Rate Limits
          </button>
          <button
            data-testid="events-tab-test"
            onClick={() => setTab("test")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl transition-colors ${
              tab === "test"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Test
          </button>
          <button
            data-testid="events-tab-smee"
            onClick={() => setTab("smee")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl transition-colors ${
              tab === "smee"
                ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                : "text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <Unplug className="w-3.5 h-3.5" />
            Smee Relay
          </button>
          <button
            data-testid="events-tab-webhooks"
            onClick={() => setTab("webhooks")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl transition-colors ${
              tab === "webhooks"
                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                : "text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <Webhook className="w-3.5 h-3.5" />
            Cloud Webhooks
          </button>
        </div>
      </ContentHeader>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tab === "live" && (
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
        )}

        {tab === "rate-limits" && <RateLimitDashboard triggers={allTriggers} />}

        {tab === "test" && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-6 space-y-6 max-w-xl">
              <div>
                <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider mb-4">
                  Publish Test Event
                </h3>
                <p className="text-sm text-muted-foreground/70 mb-4">
                  Fire a test event into the bus to verify subscriptions and agent routing.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">Event Type</label>
                  <input
                    type="text"
                    value={testEventType}
                    onChange={(e) => setTestEventType(e.target.value)}
                    placeholder="e.g. build_complete, deploy, file_changed"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground/80 mb-1.5">Payload (JSON)</label>
                  <textarea
                    value={testPayload}
                    onChange={(e) => setTestPayload(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-secondary/30 text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                  />
                </div>
                <button
                  onClick={handleTestFire}
                  disabled={isTesting || !testEventType.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
                >
                  <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse' : ''}`} />
                  {isTesting ? 'Publishing...' : 'Publish Event'}
                </button>
              </div>

              {testResult && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                  <p className="text-sm font-medium text-emerald-400">Event published</p>
                  <div className="text-xs text-muted-foreground/70 space-y-1 font-mono">
                    <p>ID: {testResult.id}</p>
                    <p>Type: {testResult.event_type}</p>
                    <p>Status: {testResult.status}</p>
                    {testResult.target_persona_id && (
                      <p>Target: {getPersona(testResult.target_persona_id)?.name ?? testResult.target_persona_id}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "smee" && <SmeeRelayTab onSwitchToLiveStream={() => setTab("live")} />}

        {tab === "webhooks" && <CloudWebhooksTab />}
      </div>

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </ContentBox>
  );
}
