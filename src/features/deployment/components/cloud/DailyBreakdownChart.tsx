import { useMemo, useRef, useState } from 'react';

export interface DailyPoint {
  date: string;
  count: number;
  cost: number;
  success_rate: number | null;
}

const CHART_H = 100;
const BAR_GAP = 2;
const LABEL_H = 16;
const COST_LINE_COLOR = 'rgb(129 140 248)'; // indigo-400

function successColor(rate: number | null): string {
  if (rate == null) return 'rgb(148 163 184)'; // slate-400
  if (rate >= 0.9) return 'rgb(52 211 153)';   // emerald-400
  if (rate >= 0.7) return 'rgb(251 191 36)';   // amber-400
  return 'rgb(248 113 113)';                    // red-400
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function DailyBreakdownChart({ data }: { data: DailyPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const { maxCount, maxCost } = useMemo(() => {
    let mc = 0;
    let mco = 0;
    for (const d of data) {
      if (d.count > mc) mc = d.count;
      if (d.cost > mco) mco = d.cost;
    }
    return { maxCount: mc || 1, maxCost: mco || 1 };
  }, [data]);

  if (data.length === 0) return null;

  const totalW = containerRef.current?.clientWidth ?? 400;
  const barW = Math.max(4, (totalW - BAR_GAP * (data.length - 1)) / data.length);
  const svgW = data.length * (barW + BAR_GAP) - BAR_GAP;
  const svgH = CHART_H + LABEL_H;

  // Cost line points
  const costPoints = data.map((d, i) => {
    const cx = i * (barW + BAR_GAP) + barW / 2;
    const cy = CHART_H - (d.cost / maxCost) * (CHART_H - 4);
    return `${cx.toFixed(1)},${cy.toFixed(1)}`;
  });

  // Show every N-th label to avoid overlap
  const labelStep = Math.max(1, Math.ceil(data.length / 10));

  return (
    <div
      ref={containerRef}
      className="rounded-xl bg-secondary/20 border border-primary/10 px-3 pt-2 pb-1 relative"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground/70">Daily Executions</span>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'rgb(52 211 153)' }} />
            Runs
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-0.5 rounded-full" style={{ background: COST_LINE_COLOR }} />
            Cost
          </span>
        </div>
      </div>

      <svg
        width="100%"
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {/* Bars */}
        {data.map((d, i) => {
          const x = i * (barW + BAR_GAP);
          const barH = Math.max(1, (d.count / maxCount) * (CHART_H - 4));
          const y = CHART_H - barH;
          const isHovered = hoverIdx === i;

          return (
            <g key={i}>
              {/* Hover zone (full height for easy targeting) */}
              <rect
                x={x}
                y={0}
                width={barW}
                height={svgH}
                fill="transparent"
                onMouseEnter={(e) => {
                  setHoverIdx(i);
                  const rect = (e.target as SVGRectElement).closest('svg')!.getBoundingClientRect();
                  setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseMove={(e) => {
                  const rect = (e.target as SVGRectElement).closest('svg')!.getBoundingClientRect();
                  setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseLeave={() => { setHoverIdx(null); setTooltipPos(null); }}
              />
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={Math.min(2, barW / 4)}
                fill={successColor(d.success_rate)}
                opacity={isHovered ? 1 : 0.7}
                className="transition-opacity duration-100"
              />
              {/* Date label */}
              {i % labelStep === 0 && (
                <text
                  x={x + barW / 2}
                  y={CHART_H + LABEL_H - 2}
                  textAnchor="middle"
                  fill="currentColor"
                  className="text-muted-foreground/40"
                  fontSize={9}
                >
                  {formatShortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}

        {/* Cost trend line */}
        {data.length >= 2 && (
          <polyline
            points={costPoints.join(' ')}
            fill="none"
            stroke={COST_LINE_COLOR}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.8}
          />
        )}
      </svg>

      {/* Tooltip */}
      {hoverIdx != null && tooltipPos && data[hoverIdx] && (
        <div
          className="absolute z-20 pointer-events-none px-2.5 py-1.5 rounded-lg bg-gray-900/95 border border-primary/15 text-[11px] leading-relaxed shadow-lg backdrop-blur-sm"
          style={{
            left: Math.min(tooltipPos.x + 12, (containerRef.current?.clientWidth ?? 300) - 140),
            top: Math.max(0, tooltipPos.y - 60),
          }}
        >
          <p className="text-foreground/90 font-medium">{data[hoverIdx]!.date}</p>
          <p className="text-muted-foreground/70">
            Runs: <span className="text-foreground/80">{data[hoverIdx]!.count}</span>
          </p>
          <p className="text-muted-foreground/70">
            Cost: <span className="text-foreground/80">${data[hoverIdx]!.cost.toFixed(2)}</span>
          </p>
          <p className="text-muted-foreground/70">
            Success:{' '}
            <span style={{ color: successColor(data[hoverIdx]!.success_rate) }}>
              {data[hoverIdx]!.success_rate != null
                ? `${(data[hoverIdx]!.success_rate! * 100).toFixed(0)}%`
                : '-'}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
