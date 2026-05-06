import { useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import type { WidgetProps } from '../widgetRegistry';

/**
 * Recent executions table — last N runs with status, persona, cost,
 * latency. Different shape from any chart: an actual scannable list
 * of records, useful for "what just happened" or "did that fix
 * land?" questions.
 *
 * Athena-facing config:
 *   { "limit": 10, "status": "completed" | "failed" | "running" | undefined }
 *   When `status` is set, the table filters to that bucket.
 */
export function RecentExecutionsTableWidget({ config, title }: WidgetProps) {
  const limit = (config?.limit as number) ?? 10;
  const statusFilter = config?.status as string | undefined;
  const { rows, fetchGlobalExecutions } = useOverviewStore(
    useShallow((s) => ({
      rows: s.globalExecutions,
      fetchGlobalExecutions: s.fetchGlobalExecutions,
    })),
  );
  useEffect(() => {
    fetchGlobalExecutions(true, statusFilter, undefined);
  }, [statusFilter, fetchGlobalExecutions]);

  const visible = useMemo(() => rows.slice(0, limit), [rows, limit]);

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col">
      <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-2">
        {title ?? `Recent executions (last ${limit})`}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center typo-caption text-foreground/40">
            No executions
          </div>
        ) : (
          <table className="w-full typo-caption">
            <thead className="text-foreground/50">
              <tr className="text-left">
                <th className="font-medium pb-1.5">Status</th>
                <th className="font-medium pb-1.5">Persona</th>
                <th className="font-medium pb-1.5 text-right">Cost</th>
                <th className="font-medium pb-1.5 text-right">Duration</th>
                <th className="font-medium pb-1.5 text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const Icon = statusIcon(r.status);
                const color = statusColor(r.status);
                return (
                  <tr key={r.id} className="border-t border-foreground/5">
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1.5" style={{ color }}>
                        <Icon className="w-3.5 h-3.5" />
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1.5 text-foreground/85 truncate max-w-[180px]">
                      {(r as { persona_name?: string }).persona_name ?? r.persona_id.slice(0, 8)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-foreground/70">
                      ${r.cost_usd.toFixed(4)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-foreground/70">
                      {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="py-1.5 text-right text-foreground/50">
                      {formatRelative(r.started_at ?? r.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return CheckCircle2;
    case 'failed': return XCircle;
    case 'running': return Loader2;
    default: return Clock;
  }
}
function statusColor(status: string): string {
  switch (status) {
    case 'completed': return '#22c55e';
    case 'failed': return '#ef4444';
    case 'running': return '#06b6d4';
    default: return 'rgba(255,255,255,0.5)';
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
