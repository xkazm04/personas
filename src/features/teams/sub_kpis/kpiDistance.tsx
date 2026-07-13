// Distance-to-target primitives, shared between the KPI dashboard and the
// KpiSignalBoard variants: the per-KPI row model, the pace-% math, and the
// recharts horizontal bar renderer.
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { KpiTrack, OffTrackReason } from './kpiMath';
import { kpiProgressPct } from './kpiMath';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';

export const CHART_ROW_H = 38;

export interface DistanceRow {
  id: string;
  name: string;
  project: string;
  /** Progress toward target, 0–115% (overshoot visible). */
  pct: number;
  fill: string;
  current: number | null;
  target: number | null;
  unit: string;
  track: KpiTrack;
  reason: OffTrackReason | null;
}

export interface DistanceGroup {
  key: string;
  label: string;
  order: number;
  rows: DistanceRow[];
}

/** Progress toward target as 0–115% (overshoot visible), direction-aware. */
export function distancePct(kpi: DevKpi): number | null {
  const pct = kpiProgressPct(kpi);
  if (pct != null) return Math.min(115, pct);
  // No baseline: simple ratio against the target.
  const { current_value: cur, target_value: target } = kpi;
  if (cur == null || target == null || target === 0) return null;
  const ratio = kpi.direction === 'down' ? target / Math.max(cur, 1e-9) : cur / target;
  return Math.min(115, Math.round(ratio * 100));
}

/** The pace-colored horizontal bar chart for one set of Distance-to-target
 *  rows. Extracted so the Distance section can render one chart per group. */
export function DistanceBars({ rows, onOpen }: { rows: DistanceRow[]; onOpen: (kpiId: string) => void }) {
  return (
    <LazyChart
      fallback={<div className="h-24" />}
      render={(R) => (
        <R.ResponsiveContainer width="100%" height={rows.length * CHART_ROW_H + 30}>
          <R.BarChart
            accessibilityLayer={false}
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 36, bottom: 0, left: 8 }}
            onClick={(state) => {
              const payload = (
                state as unknown as { activePayload?: Array<{ payload?: { id?: string } }> }
              )?.activePayload?.[0]?.payload;
              if (payload?.id) onOpen(payload.id);
            }}
          >
            <R.XAxis
              type="number"
              domain={[0, 115]}
              tickFormatter={(v: number) => `${v}%`}
              stroke="var(--muted-foreground)"
              fontSize={11}
            />
            <R.YAxis
              type="category"
              dataKey="name"
              width={210}
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
            />
            <R.ReferenceLine x={100} stroke="var(--status-success)" strokeDasharray="4 3" />
            <R.Tooltip
              cursor={{ fill: 'var(--secondary)', opacity: 0.3 }}
              contentStyle={{
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={((value: unknown, _n: unknown, item: unknown) => {
                const p = (
                  item as { payload?: { current?: number | null; target?: number | null; unit?: string; project?: string } }
                )?.payload;
                const cur = p?.current ?? '—';
                const tgt = p?.target ?? '—';
                return [`${String(value)}% — ${cur} / ${tgt} ${p?.unit ?? ''}`, p?.project ?? ''];
              }) as never}
            />
            <R.Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={16} cursor="pointer">
              {rows.map((row) => (
                <R.Cell key={row.id} fill={row.fill} />
              ))}
              <R.LabelList
                dataKey="pct"
                position="right"
                formatter={((v: unknown) => `${String(v)}%`) as never}
                style={{ fill: 'var(--foreground)', fontSize: 11 }}
              />
            </R.Bar>
          </R.BarChart>
        </R.ResponsiveContainer>
      )}
    />
  );
}
