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
import { CARD_CONTAINER } from '@/features/overview/utils/dashboardGrid';

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

function CommandRow({ stat, maxP95 }: { stat: IpcCommandStats; maxP95: number }) {
  const shortName = stat.command.replace(/^(get_|list_|fetch_|create_|update_|delete_)/, '');
  return (
    <div role="row" tabIndex={0} className="grid grid-cols-[1fr_60px_60px_60px_52px] items-center gap-2 px-3 py-1.5 hover:bg-white/[0.02] focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none text-sm">
      <div role="cell" className="flex flex-col gap-0.5 min-w-0">
        <span className="font-mono text-foreground/80 truncate" title={stat.command}>{shortName}</span>
        <LatencyBar value={stat.p95} max={maxP95} />
      </div>
      <span role="cell" className={`text-right font-mono ${latencyColor(stat.p50)}`}>{formatMs(stat.p50)}</span>
      <span role="cell" className={`text-right font-mono ${latencyColor(stat.p95)}`}>{formatMs(stat.p95)}</span>
      <span role="cell" className={`text-right font-mono ${latencyColor(stat.p99)}`}>{formatMs(stat.p99)}</span>
      <span role="cell" className="text-right text-muted-foreground/60 font-mono">{stat.count}</span>
    </div>
  );
}

function SlowestCallRow({ record }: { record: IpcCallRecord }) {
  const age = Date.now() - record.timestamp;
  const ageLabel = age < 60_000 ? `${Math.floor(age / 1000)}s ago` : age < 3_600_000 ? `${Math.floor(age / 60_000)}m ago` : `${Math.floor(age / 3_600_000)}h ago`;
  return (
    <div role="row" tabIndex={0} className="flex items-center gap-3 px-3 py-1.5 hover:bg-white/[0.02] focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none text-sm">
      <span role="cell" className={`font-mono font-bold min-w-[60px] text-right ${latencyColor(record.durationMs)}`}>
        {formatMs(record.durationMs)}
      </span>
      <span role="cell" className="font-mono text-foreground/80 flex-1 truncate" title={record.command}>{record.command}</span>
      {!record.ok && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
      <span role="cell" className="text-muted-foreground/50 text-sm min-w-[50px] text-right">{ageLabel}</span>
    </div>
  );
}

type Tab = 'commands' | 'slowest';

export default function IpcPerformancePanel() {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('commands');
  const { stats, slowest, summary } = useIpcSnapshot();

  const toggleExpanded = useCallback(() => setExpanded(e => !e), []);

  const maxP95 = useMemo(() => {
    if (stats.length === 0) return 1;
    return Math.max(...stats.map(s => s.p95));
  }, [stats]);

  if (summary.totalCalls === 0) return null;

  return (
    <div className={`${CARD_CONTAINER} overflow-hidden`}>
      <button onClick={toggleExpanded} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 shadow-inner flex items-center justify-center">
            <Gauge className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-left">
            <h3 className="typo-heading text-foreground/90 uppercase tracking-widest">IPC Performance</h3>
            <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/70">
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
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/50" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/50" />}
      </button>

      {expanded && (
        <div className="border-t border-primary/10">
          <div className="flex items-center gap-1 px-4 py-2 border-b border-primary/5">
            <button onClick={() => setTab('commands')} className={`flex items-center gap-1.5 px-3 py-1 rounded-lg typo-heading transition-all focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none ${tab === 'commands' ? 'bg-background text-foreground shadow-sm border border-primary/20' : 'text-muted-foreground/80 hover:text-muted-foreground'}`}>
              <Gauge className="w-3 h-3" /> By Command
            </button>
            <button onClick={() => setTab('slowest')} className={`flex items-center gap-1.5 px-3 py-1 rounded-lg typo-heading transition-all focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none ${tab === 'slowest' ? 'bg-background text-foreground shadow-sm border border-primary/20' : 'text-muted-foreground/80 hover:text-muted-foreground'}`}>
              <Timer className="w-3 h-3" /> Slowest Calls
            </button>
          </div>

          {tab === 'commands' && (
            <div role="table" aria-label="IPC command performance">
              <div role="row" className="grid grid-cols-[1fr_60px_60px_60px_52px] gap-2 px-3 py-1.5 text-sm text-muted-foreground/50 border-b border-primary/5">
                <span role="columnheader">Command</span>
                <span role="columnheader" className="text-right">p50</span>
                <span role="columnheader" className="text-right">p95</span>
                <span role="columnheader" className="text-right">p99</span>
                <span role="columnheader" className="text-right">Calls</span>
              </div>
              <div role="rowgroup" className="max-h-[300px] overflow-y-auto divide-y divide-primary/[0.03]">
                {stats.map(stat => <CommandRow key={stat.command} stat={stat} maxP95={maxP95} />)}
              </div>
            </div>
          )}

          {tab === 'slowest' && (
            <div role="table" aria-label="Slowest IPC calls">
              <div role="row" className="flex items-center gap-3 px-3 py-1.5 text-sm text-muted-foreground/50 border-b border-primary/5">
                <span role="columnheader" className="min-w-[60px] text-right">Duration</span>
                <span role="columnheader" className="flex-1">Command</span>
                <span role="columnheader" className="min-w-[50px] text-right">When</span>
              </div>
              <div role="rowgroup" className="max-h-[300px] overflow-y-auto divide-y divide-primary/[0.03]">
                {slowest.map((record, i) => <SlowestCallRow key={`${record.command}-${record.timestamp}-${i}`} record={record} />)}
              </div>
            </div>
          )}

          {(summary.errorRate > 0 || summary.timeoutRate > 0) && (
            <div className="px-4 py-2 border-t border-primary/5 bg-secondary/30 flex items-center gap-4 text-sm">
              {summary.errorRate > 0 && <span className="text-red-400/80">Error rate: {formatRate(summary.errorRate)}</span>}
              {summary.timeoutRate > 0 && <span className="text-amber-400/80">Timeout rate: {formatRate(summary.timeoutRate)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
