import { useState, useMemo, useSyncExternalStore, useCallback } from 'react';
import { ChevronDown, ChevronUp, Timer, AlertTriangle, Gauge } from 'lucide-react';
import {
  computeCommandStats,
  getSlowestCalls,
  getGlobalSummary,
  getIpcTotalCount,
  subscribeIpcMetrics,
  type IpcCommandStats,
  type IpcCallRecord,
} from '@/lib/ipcMetrics';
import { latencyToHealth, HEALTH_STATUS_TOKEN } from '@/lib/design/statusTokens';
import { CARD_CONTAINER } from '@/features/overview/libs/dashboardGrid';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { useTranslation } from '@/i18n/useTranslation';

function useIpcSnapshot() {
  const generation = useSyncExternalStore(subscribeIpcMetrics, getIpcTotalCount);
  return useMemo(() => {
    void generation;
    return {
      stats: computeCommandStats(),
      slowest: getSlowestCalls(10),
      summary: getGlobalSummary(),
    };
  }, [generation]);
}

function formatMs(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function latencyColor(ms: number): string {
  return HEALTH_STATUS_TOKEN[latencyToHealth(ms)].text;
}

function LatencyBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = `${HEALTH_STATUS_TOKEN[latencyToHealth(value)].icon}/40`;
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary/40 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ageLabel(timestamp: number): string {
  const age = Date.now() - timestamp;
  return age < 60_000
    ? `${Math.floor(age / 1000)}s ago`
    : age < 3_600_000
      ? `${Math.floor(age / 60_000)}m ago`
      : `${Math.floor(age / 3_600_000)}h ago`;
}

type Tab = 'commands' | 'slowest';

export default function IpcPerformancePanel() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('commands');
  const [bandFilter, setBandFilter] = useState<string>('all');
  const { stats, slowest, summary } = useIpcSnapshot();

  const toggleExpanded = useCallback(() => setExpanded(e => !e), []);

  const maxP95 = useMemo(() => {
    if (stats.length === 0) return 1;
    return Math.max(...stats.map(s => s.p95));
  }, [stats]);

  // p95 latency-band filter. Band names map to latencyToHealth thresholds;
  // labels are pure ms/s units (technical, untranslated), so only "All" is
  // localized — no new i18n keys.
  const bandOptions = useMemo(() => [
    { value: 'all', label: t.common.all },
    { value: 'healthy', label: '< 50 ms' },
    { value: 'info', label: '50–200 ms' },
    { value: 'warning', label: '200 ms – 1 s' },
    { value: 'critical', label: '≥ 1 s' },
  ], [t.common.all]);

  const visibleStats = useMemo(
    () => (bandFilter === 'all' ? stats : stats.filter((s) => latencyToHealth(s.p95) === bandFilter)),
    [stats, bandFilter],
  );

  // Slowest-calls outcome filter. Reuses common.all/success/error — no new keys.
  const [okFilter, setOkFilter] = useState<string>('all');
  const okOptions = useMemo(() => [
    { value: 'all', label: t.common.all },
    { value: 'ok', label: t.common.success },
    { value: 'error', label: t.common.error },
  ], [t.common.all, t.common.success, t.common.error]);

  const visibleSlowest = useMemo(
    () => (okFilter === 'all' ? slowest : slowest.filter((r) => (okFilter === 'ok' ? r.ok : !r.ok))),
    [slowest, okFilter],
  );

  const commandColumns = useMemo<TableColumn<IpcCommandStats>[]>(() => [
    {
      key: 'command',
      label: t.overview.ipc_panel.command,
      width: 'minmax(140px, 1fr)',
      sortable: true,
      sortFn: (a, b) => a.command.localeCompare(b.command),
      render: (stat) => {
        const shortName = stat.command.replace(/^(get_|list_|fetch_|create_|update_|delete_)/, '');
        return (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-mono text-foreground truncate" title={stat.command}>{shortName}</span>
            <LatencyBar value={stat.p95} max={maxP95} />
          </div>
        );
      },
    },
    {
      key: 'p50', label: 'p50', width: '64px', align: 'right', sortable: true,
      sortFn: (a, b) => a.p50 - b.p50,
      render: (stat) => <span className={`font-mono ${latencyColor(stat.p50)}`}>{formatMs(stat.p50)}</span>,
    },
    {
      key: 'p95', label: 'p95', width: '64px', align: 'right', sortable: true,
      sortFn: (a, b) => a.p95 - b.p95,
      filterOptions: bandOptions,
      filterValue: bandFilter,
      onFilterChange: setBandFilter,
      render: (stat) => <span className={`font-mono ${latencyColor(stat.p95)}`}>{formatMs(stat.p95)}</span>,
    },
    {
      key: 'p99', label: 'p99', width: '64px', align: 'right', sortable: true,
      sortFn: (a, b) => a.p99 - b.p99,
      render: (stat) => <span className={`font-mono ${latencyColor(stat.p99)}`}>{formatMs(stat.p99)}</span>,
    },
    {
      key: 'count', label: t.overview.ipc_panel.calls_header, width: '64px', align: 'right', sortable: true,
      sortFn: (a, b) => a.count - b.count,
      render: (stat) => <span className="font-mono text-foreground">{stat.count}</span>,
    },
  ], [t, maxP95, bandOptions, bandFilter]);

  const slowestColumns = useMemo<TableColumn<IpcCallRecord>[]>(() => [
    {
      key: 'duration', label: t.overview.ipc_panel.duration_header, width: '80px', align: 'right', sortable: true,
      sortFn: (a, b) => a.durationMs - b.durationMs,
      render: (rec) => (
        <span className={`font-mono font-bold ${latencyColor(rec.durationMs)}`}>{formatMs(rec.durationMs)}</span>
      ),
    },
    {
      key: 'command', label: 'Command', width: 'minmax(140px, 1fr)', sortable: true,
      sortFn: (a, b) => a.command.localeCompare(b.command),
      filterOptions: okOptions,
      filterValue: okFilter,
      onFilterChange: setOkFilter,
      render: (rec) => (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-foreground truncate" title={rec.command}>{rec.command}</span>
          {!rec.ok && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
        </span>
      ),
    },
    {
      key: 'when', label: t.overview.ipc_panel.when_header, width: '80px', align: 'right', sortable: true,
      sortFn: (a, b) => a.timestamp - b.timestamp,
      render: (rec) => <span className="text-foreground">{ageLabel(rec.timestamp)}</span>,
    },
  ], [t, okOptions, okFilter]);

  if (summary.totalCalls === 0) return null;

  return (
    <div className={`${CARD_CONTAINER} overflow-hidden`}>
      <button onClick={toggleExpanded} className="w-full flex items-center justify-between px-4 py-3 hover:bg-foreground/[0.02] focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-modal bg-indigo-500/10 border border-indigo-500/20 shadow-inner flex items-center justify-center">
            <Gauge className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-left">
            <h3 className="typo-heading text-foreground/90 uppercase tracking-widest">{t.overview.ipc_panel.title}</h3>
            <div className="flex items-center gap-3 mt-0.5 typo-body text-foreground">
              <span>{summary.totalCalls.toLocaleString()} calls</span>
              <span className="text-primary/15">|</span>
              <span>p50 <span className={latencyColor(summary.p50)}>{formatMs(summary.p50)}</span></span>
              <span className="text-primary/15">|</span>
              <span>p95 <span className={latencyColor(summary.p95)}>{formatMs(summary.p95)}</span></span>
              {summary.timeoutRate > 0 && (
                <>
                  <span className="text-primary/15">|</span>
                  <span className="text-red-400">{formatRate(summary.timeoutRate)} timeouts</span>
                </>
              )}
            </div>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-foreground" /> : <ChevronDown className="w-4 h-4 text-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-primary/10">
          <div className="flex items-center gap-1 px-4 py-2 border-b border-primary/5">
            <button onClick={() => setTab('commands')} className={`flex items-center gap-1.5 px-3 py-1 rounded-card typo-heading transition-all focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none ${tab === 'commands' ? 'bg-background text-foreground shadow-elevation-1 border border-primary/20' : 'text-foreground hover:text-muted-foreground'}`}>
              <Gauge className="w-3 h-3" /> {t.overview.ipc_panel.by_command}
            </button>
            <button onClick={() => setTab('slowest')} className={`flex items-center gap-1.5 px-3 py-1 rounded-card typo-heading transition-all focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none ${tab === 'slowest' ? 'bg-background text-foreground shadow-elevation-1 border border-primary/20' : 'text-foreground hover:text-muted-foreground'}`}>
              <Timer className="w-3 h-3" /> {t.overview.ipc_panel.slowest_calls}
            </button>
          </div>

          {tab === 'commands' && (
            <UnifiedTable<IpcCommandStats>
              columns={commandColumns}
              data={visibleStats}
              getRowKey={(stat) => stat.command}
              density="compact"
              defaultSortKey="p95"
              rowHeight={44}
              borderless
              className="max-h-[300px]"
              emptyTitle={t.overview.events.no_filter_match}
              ariaLabel={t.overview.ipc_panel.commands_table_label}
            />
          )}

          {tab === 'slowest' && (
            <UnifiedTable<IpcCallRecord>
              columns={slowestColumns}
              data={visibleSlowest}
              getRowKey={(rec) => `${rec.command}-${rec.timestamp}`}
              density="compact"
              defaultSortKey="duration"
              rowHeight={36}
              borderless
              className="max-h-[300px]"
              rowAccent={(rec) => (!rec.ok ? 'border-l-red-400/70' : undefined)}
              emptyTitle={t.overview.events.no_filter_match}
              ariaLabel={t.overview.ipc_panel.slowest_table_label}
            />
          )}

          {(summary.errorRate > 0 || summary.timeoutRate > 0) && (
            <div className="px-4 py-2 border-t border-primary/5 bg-secondary/30 flex items-center gap-4 typo-body">
              {summary.errorRate > 0 && <span className="text-red-400/80">{t.overview.ipc_panel.error_rate} {formatRate(summary.errorRate)}</span>}
              {summary.timeoutRate > 0 && <span className="text-amber-400/80">{t.overview.ipc_panel.timeout_rate} {formatRate(summary.timeoutRate)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
