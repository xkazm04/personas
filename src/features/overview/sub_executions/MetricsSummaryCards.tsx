import {
  DollarSign,
  AlertTriangle, ArrowUpRight,
} from 'lucide-react';
import { CHART_COLORS } from '@/features/overview/sub_usage/charts/chartConstants';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';

// -- Formatters (shared) ----------------------------------------------

export const fmtCost = (v: number) => v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
export const fmtMs = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
export const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// -- Summary Card -----------------------------------------------------

export function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-500/15 border-blue-500/25',
    emerald: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25',
    violet: 'text-violet-400 bg-violet-500/15 border-violet-500/25',
    amber: 'text-amber-400 bg-amber-500/15 border-amber-500/25',
  };
  const c = colorMap[color] ?? colorMap.blue!;
  const parts = c.split(' ');
  const textColor = parts[0];
  const bg = parts[1];
  const border = parts[2];

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${border} ${bg}`}>
      <Icon className={`w-4 h-4 ${textColor}`} />
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground/70 truncate">{label}</p>
        <p className={`text-sm font-semibold ${textColor}`}>{value}</p>
      </div>
    </div>
  );
}

// -- Anomaly Badge ----------------------------------------------------

export function AnomalyBadge({
  anomaly,
  onClickExecution,
}: {
  anomaly: DashboardCostAnomaly;
  onClickExecution?: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/25 bg-amber-500/10">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-amber-300">
          {fmtDate(anomaly.date)} -- Cost spike {fmtCost(anomaly.cost)}
          <span className="text-amber-400/70 ml-1">
            ({anomaly.deviation_sigma.toFixed(1)}σ above avg {fmtCost(anomaly.moving_avg)})
          </span>
        </p>
        {anomaly.execution_ids.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground/60">Top executions:</span>
            {anomaly.execution_ids.map((id) => (
              <button
                key={id}
                onClick={() => onClickExecution?.(id)}
                className="text-sm font-mono text-blue-400 hover:text-blue-300 underline decoration-blue-400/30"
              >
                {id.slice(0, 8)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Chart Tooltip ----------------------------------------------------

export function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background/95 border border-primary/20 rounded-xl px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-sm text-muted-foreground/80 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground/70">{entry.name}:</span>
          <span className="font-mono text-foreground/90">{typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// -- Top Personas List ------------------------------------------------

interface TopPersona {
  persona_id: string;
  persona_name: string;
  total_cost: number;
  total_executions: number;
  avg_cost_per_exec: number;
}

export function TopPersonasList({ personas }: { personas: TopPersona[] }) {
  if (personas.length === 0) return null;
  const maxCost = personas[0]?.total_cost || 1;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground/70">Top Personas by Cost</h4>
      <div className="space-y-1.5">
        {personas.map((p, i) => {
          const pct = (p.total_cost / maxCost) * 100;
          return (
            <div key={p.persona_id} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-primary/10 bg-secondary/20">
              <span className="text-sm font-mono text-muted-foreground/60 w-4 text-right">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground/80 truncate">{p.persona_name}</span>
                  <span className="text-sm font-mono text-violet-400">{fmtCost(p.total_cost)}</span>
                </div>
                <div className="h-1.5 bg-secondary/40 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                      opacity: 0.7,
                    }}
                  />
                </div>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground/60">
                  <span>{p.total_executions} executions</span>
                  <span>~{fmtCost(p.avg_cost_per_exec)}/exec</span>
                </div>
              </div>
              <ArrowUpRight className="w-3 h-3 text-muted-foreground/50" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
