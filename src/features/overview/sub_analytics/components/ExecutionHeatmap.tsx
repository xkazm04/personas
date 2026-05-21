import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, Flame, Snowflake, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getExecutionHeatmap } from '@/api/overview/observability';
import { silentCatch } from '@/lib/silentCatch';
import type { ExecutionHeatmapData } from '@/lib/bindings/ExecutionHeatmapData';
import type { HeatmapDay } from '@/lib/bindings/HeatmapDay';
import type { HeatmapInsights } from '@/lib/bindings/HeatmapInsights';
import type { Translations } from '@/i18n/en';
import { debtText } from '@/i18n/DebtText';


interface ExecutionHeatmapProps {
  /** Persona ID for per-persona heatmap, or undefined for fleet-wide aggregate. */
  personaId?: string;
  /** Window length in days. Default 365. */
  days?: number;
  /** Optional callback when a day cell is clicked. Receives ISO date (YYYY-MM-DD). */
  onDayClick?: (date: string) => void;
  /** Render compact (no insights row) — useful inside dense dashboards. */
  compact?: boolean;
  className?: string;
}

const CELL_SIZE = 11;
const CELL_GAP = 3;
const WEEK_HEIGHT = 7 * (CELL_SIZE + CELL_GAP) - CELL_GAP;

/** Colour ramp (CSS values) for the 5 intensity levels (0..4). */
const INTENSITY_FILL = [
  'var(--heatmap-empty, rgba(255,255,255,0.04))',
  'rgba(99, 102, 241, 0.28)',
  'rgba(99, 102, 241, 0.55)',
  'rgba(139, 92, 246, 0.75)',
  'rgba(167, 139, 250, 0.95)',
];

const INTENSITY_BORDER = [
  'rgba(255,255,255,0.04)',
  'rgba(99, 102, 241, 0.45)',
  'rgba(99, 102, 241, 0.75)',
  'rgba(139, 92, 246, 0.85)',
  'rgba(167, 139, 250, 1.0)',
];

/** Resolve a (count, thresholds) into 0..4. 0 means no activity. */
function intensityFor(count: number, thresholds: readonly [number, number, number, number]): number {
  if (count <= 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

interface FilledDay {
  date: string;
  count: number;
  cost: number;
  weekday: number;
  weekIndex: number;
  isFuture: boolean;
}

/**
 * Densifies the sparse server response into a complete 53-week × 7-day grid.
 * Anchored on today (rightmost column). Empty days for missing dates and for
 * the leading partial week.
 */
function buildGrid(data: ExecutionHeatmapData): { weeks: FilledDay[][]; monthLabels: { weekIndex: number; month: number }[] } {
  const byDate = new Map<string, HeatmapDay>();
  for (const d of data.days) byDate.set(d.date, d);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // We want the rightmost cell (last day in grid) to be today, and the bottom row to align Sat.
  // GitHub uses Sunday as first row. We anchor to today's weekday.
  const totalDays = data.window_days;
  // Compute start so that we have totalDays cells ending today.
  const start = new Date(today);
  start.setDate(start.getDate() - (totalDays - 1));

  // Pad start back to the previous Sunday so column 0 is a full Sun..Sat strip.
  const startWeekday = start.getDay(); // 0..6, Sun=0
  const paddedStart = new Date(start);
  paddedStart.setDate(paddedStart.getDate() - startWeekday);

  // Pad end forward to the next Saturday so the last column is a full Sun..Sat strip.
  const endWeekday = today.getDay();
  const paddedEnd = new Date(today);
  paddedEnd.setDate(paddedEnd.getDate() + (6 - endWeekday));

  const totalCells = Math.round((paddedEnd.getTime() - paddedStart.getTime()) / 86_400_000) + 1;
  const totalWeeks = Math.ceil(totalCells / 7);

  const weeks: FilledDay[][] = Array.from({ length: totalWeeks }, () => []);
  const monthLabels: { weekIndex: number; month: number }[] = [];
  let lastMonth = -1;

  for (let i = 0; i < totalCells; i++) {
    const date = new Date(paddedStart);
    date.setDate(paddedStart.getDate() + i);
    const isoDate = formatIso(date);
    const weekIndex = Math.floor(i / 7);
    const weekday = date.getDay();
    const isFuture = date > today;
    const inWindow = date >= start && date <= today;

    const hit = inWindow ? byDate.get(isoDate) : undefined;
    const week = weeks[weekIndex];
    if (!week) continue;
    week.push({
      date: isoDate,
      count: hit?.count ?? 0,
      cost: hit?.cost ?? 0,
      weekday,
      weekIndex,
      isFuture,
    });

    // First Sunday of each new month → place a label at this column.
    if (weekday === 0 && date.getMonth() !== lastMonth && date >= start) {
      monthLabels.push({ weekIndex, month: date.getMonth() });
      lastMonth = date.getMonth();
    }
  }

  return { weeks, monthLabels };
}

function formatIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatHumanDate(iso: string): string {
  // Display as "MMM D, YYYY" without pulling in a date library.
  const [y, m, d] = iso.split('-').map((s) => Number.parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function monthShortLabel(t: Translations, month: number): string {
  const keys = [
    t.overview.heatmap.month_jan,
    t.overview.heatmap.month_feb,
    t.overview.heatmap.month_mar,
    t.overview.heatmap.month_apr,
    t.overview.heatmap.month_may,
    t.overview.heatmap.month_jun,
    t.overview.heatmap.month_jul,
    t.overview.heatmap.month_aug,
    t.overview.heatmap.month_sep,
    t.overview.heatmap.month_oct,
    t.overview.heatmap.month_nov,
    t.overview.heatmap.month_dec,
  ];
  return keys[month] ?? '';
}

export function ExecutionHeatmap({
  personaId,
  days = 365,
  onDayClick,
  compact = false,
  className,
}: ExecutionHeatmapProps) {
  const { t, tx } = useTranslation();
  const [data, setData] = useState<ExecutionHeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<FilledDay | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getExecutionHeatmap(days, personaId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        silentCatch('ExecutionHeatmap:load')(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, days]);

  const grid = useMemo(() => (data ? buildGrid(data) : null), [data]);

  const totalExecutions = data?.insights.total_executions ?? 0;
  const totalCost = data?.insights.total_cost ?? 0;
  const isEmpty = !loading && totalExecutions === 0;

  const title = personaId ? t.overview.heatmap.title_persona : t.overview.heatmap.title_global;
  const subtitle = totalCost > 0
    ? tx(t.overview.heatmap.subtitle_executions_with_cost, {
        count: totalExecutions,
        cost: totalCost.toFixed(2),
      })
    : tx(t.overview.heatmap.subtitle_executions, { count: totalExecutions });

  return (
    <div
      className={`rounded-card border border-primary/10 bg-secondary/[0.03] p-4 ${className ?? ''}`}
      data-testid="execution-heatmap"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="typo-label text-foreground/90 truncate">{title}</div>
          <div className="typo-caption text-foreground mt-0.5">{subtitle}</div>
        </div>
        {data?.insights && !isEmpty && !compact && (
          <Legend />
        )}
      </div>

      {loading ? (
        <HeatmapSkeleton />
      ) : error ? (
        <div className="flex items-center gap-2 typo-caption text-red-400/80 py-6">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-8 text-foreground">
          <Activity className="w-6 h-6 mb-2 opacity-50" />
          <span className="typo-caption">{t.overview.heatmap.no_activity}</span>
        </div>
      ) : grid && data ? (
        <>
          {!compact && (
            <InsightsRow insights={data.insights} t={t} tx={tx} placement="top" />
          )}

          <div className="overflow-x-auto -mx-1 px-1">
            <HeatmapGrid
              weeks={grid.weeks}
              monthLabels={grid.monthLabels}
              thresholds={data.insights.intensity_thresholds}
              onHover={setHover}
              onClick={onDayClick}
              t={t}
            />
          </div>

          {hover && (
            <div className="mt-2 typo-caption text-foreground">
              <HoverLine day={hover} t={t} tx={tx} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 typo-caption text-foreground shrink-0">
      <span>{t.overview.heatmap.less}</span>
      {INTENSITY_FILL.map((fill, i) => (
        <span
          key={i}
          className="rounded-[2px]"
          style={{
            width: CELL_SIZE,
            height: CELL_SIZE,
            backgroundColor: fill,
            border: `1px solid ${INTENSITY_BORDER[i]}`,
          }}
        />
      ))}
      <span>{t.overview.heatmap.more}</span>
    </div>
  );
}

function HeatmapSkeleton() {
  return (
    <div
      className="animate-pulse rounded-input bg-secondary/[0.05]"
      style={{ height: WEEK_HEIGHT + 24 }}
    />
  );
}

function HeatmapGrid({
  weeks, monthLabels, thresholds, onHover, onClick, t,
}: {
  weeks: FilledDay[][];
  monthLabels: { weekIndex: number; month: number }[];
  thresholds: readonly [number, number, number, number];
  onHover: (d: FilledDay | null) => void;
  onClick?: (date: string) => void;
  t: Translations;
}) {
  const cols = weeks.length;
  const width = cols * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const monthLabelHeight = 14;

  return (
    <svg
      width={width}
      height={WEEK_HEIGHT + monthLabelHeight + 4}
      role="img"
      aria-label={debtText("auto_execution_activity_over_the_last_year_d8c7055f")}
      style={{ display: 'block' }}
    >
      {monthLabels.map((m) => (
        <text
          key={`${m.weekIndex}-${m.month}`}
          x={m.weekIndex * (CELL_SIZE + CELL_GAP)}
          y={10}
          fontSize={10}
          fill="currentColor"
          opacity={0.45}
        >
          {monthShortLabel(t, m.month)}
        </text>
      ))}
      {weeks.map((week, wi) =>
        week.map((day) => {
          if (day.isFuture) return null;
          const x = wi * (CELL_SIZE + CELL_GAP);
          const y = monthLabelHeight + 4 + day.weekday * (CELL_SIZE + CELL_GAP);
          const level = intensityFor(day.count, thresholds);
          const interactive = !!onClick && day.count > 0;
          return (
            <rect
              key={day.date}
              x={x}
              y={y}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2}
              ry={2}
              fill={INTENSITY_FILL[level]}
              stroke={INTENSITY_BORDER[level]}
              strokeWidth={0.6}
              style={{
                cursor: interactive ? 'pointer' : 'default',
                transition: 'transform 120ms ease, filter 120ms ease',
              }}
              onMouseEnter={() => onHover({ ...day })}
              onMouseLeave={() => onHover(null)}
              onClick={() => interactive && onClick?.(day.date)}
            />
          );
        }),
      )}
    </svg>
  );
}

function HoverLine({
  day, t, tx,
}: {
  day: FilledDay;
  t: Translations;
  tx: (template: string, params: Record<string, string | number>) => string;
}) {
  const date = formatHumanDate(day.date);
  let line: string;
  if (day.count === 0) line = t.overview.heatmap.tooltip_no_runs;
  else if (day.count === 1) line = tx(t.overview.heatmap.tooltip_one_run, { date });
  else line = tx(t.overview.heatmap.tooltip_runs, { count: day.count, date });

  if (day.cost > 0) {
    line += tx(t.overview.heatmap.tooltip_with_cost, { cost: day.cost.toFixed(2) });
  }
  return <span>{line}</span>;
}

function InsightsRow({
  insights, t, tx, placement = 'bottom',
}: {
  insights: HeatmapInsights;
  t: Translations;
  tx: (template: string, params: Record<string, string | number>) => string;
  placement?: 'top' | 'bottom';
}) {
  const containerCls = placement === 'top'
    ? 'grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 pb-3 border-b border-primary/10'
    : 'grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-primary/10';
  return (
    <div className={containerCls}>
      <InsightCell
        icon={<Flame className="w-3.5 h-3.5 text-amber-400/80" />}
        label={t.overview.heatmap.insights_streak}
        value={tx(t.overview.heatmap.insights_streak_days, { days: insights.longest_streak_days })}
      />
      <InsightCell
        icon={<Snowflake className="w-3.5 h-3.5 text-sky-400/80" />}
        label={t.overview.heatmap.insights_dormant}
        value={renderDormant(insights, t, tx)}
      />
      <InsightCell
        icon={<Activity className="w-3.5 h-3.5 text-violet-400/80" />}
        label={t.overview.heatmap.insights_peak}
        value={
          insights.peak_day_date
            ? tx(t.overview.heatmap.insights_peak_value, {
                count: insights.peak_day_count,
                date: formatHumanDate(insights.peak_day_date),
              })
            : '—'
        }
      />
      <InsightCell
        icon={
          insights.week_over_week_pct == null
            ? <Activity className="w-3.5 h-3.5 text-foreground" />
            : insights.week_over_week_pct >= 0
              ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400/80" />
              : <TrendingDown className="w-3.5 h-3.5 text-red-400/80" />
        }
        label={t.overview.heatmap.insights_wow}
        value={renderWow(insights, t, tx)}
      />
    </div>
  );
}

function renderDormant(
  insights: HeatmapInsights,
  t: Translations,
  tx: (template: string, params: Record<string, string | number>) => string,
): string {
  if (insights.dormant_days == null) return t.overview.heatmap.insights_dormant_never;
  if (insights.dormant_days === 0) return t.overview.heatmap.insights_dormant_active;
  return tx(t.overview.heatmap.insights_dormant_days, { days: insights.dormant_days });
}

function renderWow(
  insights: HeatmapInsights,
  t: Translations,
  tx: (template: string, params: Record<string, string | number>) => string,
): string {
  const pct = insights.week_over_week_pct;
  if (pct == null) {
    return insights.current_week_executions > 0
      ? t.overview.heatmap.insights_wow_new
      : '—';
  }
  if (Math.abs(pct) < 1) return t.overview.heatmap.insights_wow_flat;
  const rounded = Math.round(pct);
  return rounded >= 0
    ? tx(t.overview.heatmap.insights_wow_up, { pct: rounded })
    : tx(t.overview.heatmap.insights_wow_down, { pct: rounded });
}

function InsightCell({
  icon, label, value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 typo-caption text-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="typo-body text-foreground/90 mt-0.5 truncate">{value}</div>
    </div>
  );
}
