// VitalsConsole — Mission Control's central pane: success ring + four big
// readouts + traffic/error sparkline, plus an optional trailing readout slot
// (the daily success-rate trend). Extracted from the pre-consolidation
// DashboardHomeMissionControl during the 2026-08-25 monitoring consolidation.

import { memo, useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ClipboardCheck, Activity, Cpu, Bell } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { KpiTile, type KpiTrend } from '@/features/overview/components/shared/KpiTile';
import { computeSeriesTrendPct } from '@/features/overview/libs/computeTrends';
import { PaneHeader } from './PaneHeader';

export const VitalsConsole = memo(function VitalsConsole({
  successRate, activeAgents, activeAlertCount, totalExecutions, pendingReviews, points, personaName, trend,
}: {
  /** null when nothing ran in the window — an unmeasured rate, not a zero one. */
  successRate: number | null;
  activeAgents: number;
  activeAlertCount: number;
  totalExecutions: number;
  pendingReviews: number;
  points: { date: string; total_executions: number; failed: number }[];
  personaName: string | null;
  /** Optional extra readout rendered under the sparkline (e.g. the daily
   *  success-rate trend). */
  trend?: React.ReactNode;
}) {
  const { t, language } = useTranslation();
  const { effectiveDays, compareEnabled } = useOverviewFilterValues();

  // Direction-of-travel for the Runs tile, using a REAL prior-period comparison
  // (the same machinery the Execution Metrics compare path uses — see
  // computeSeriesTrendPct / splitComparisonPeriods in overview/libs). It only
  // yields a trend when the loaded window genuinely spans two periods, i.e. the
  // pipeline fetched at 2× (compare mode). When compare is off there is no
  // honest prior period, so the tile shows no arrow rather than the old
  // front-half/back-half heuristic that lied over a single window.
  const runsTrend = useMemo<KpiTrend | null>(() => {
    const pct = computeSeriesTrendPct(
      points.map((p) => p.total_executions),
      effectiveDays,
      compareEnabled,
    );
    return pct === null ? null : { pct, invertColor: false };
  }, [points, effectiveDays, compareEnabled]);

  // Build a tiny static sparkline of traffic vs errors for context. The traffic
  // series gets a gradient-filled area (so the pane's only chart reads as
  // finished, not a bare polyline); errors stay a thin overlaid line. Both
  // series mark their latest value with an end dot.
  const sparkline = useMemo(() => {
    if (!points.length) return null;
    const max = Math.max(...points.map((p) => p.total_executions), 1);
    const w = 200, h = 40;
    const pad = 2; // keep end dots + stroke off the top/bottom edge
    const step = w / Math.max(points.length - 1, 1);
    const toY = (v: number) => h - pad - (v / max) * (h - pad * 2);
    const xy = (v: number, i: number) => ({ x: i * step, y: toY(v) });
    const trafficPts = points.map((p, i) => xy(p.total_executions, i));
    const errorPts = points.map((p, i) => xy(p.failed, i));
    const toStr = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y.toFixed(1)}`).join(' ');
    const lastX = (points.length - 1) * step;
    const area = `M0,${h} L${toStr(trafficPts).replace(/ /g, ' L')} L${lastX},${h} Z`;
    return {
      traffic: toStr(trafficPts),
      errors: toStr(errorPts),
      area,
      trafficEnd: trafficPts[trafficPts.length - 1]!,
      errorEnd: errorPts[errorPts.length - 1]!,
      w, h,
    };
  }, [points]);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col">
      <PaneHeader label={t.overview.dashboard.pane_vitals} subtitle={personaName ?? t.overview.dashboard.vitals_subtitle_fleet} />
      <div className="flex-1 flex flex-col items-center gap-5 px-4 py-6">
        <SuccessRing rate={successRate} />
        <div className="w-full space-y-2">
          {personaName && (
            <div className="flex justify-end">
              <FleetTag />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <KpiTile density="console" icon={<Activity className="w-3.5 h-3.5" />} label={t.overview.dashboard.tile_runs} numericValue={totalExecutions} compact language={language} color="text-emerald-400" trend={runsTrend} />
            <KpiTile density="console" icon={<Cpu className="w-3.5 h-3.5" />} label={t.overview.dashboard.tile_agents} numericValue={activeAgents} color="text-violet-400" />
            <KpiTile density="console" icon={<Bell className="w-3.5 h-3.5" />} label={t.overview.dashboard.tile_alerts} numericValue={activeAlertCount} color={activeAlertCount > 0 ? 'text-red-400' : 'text-foreground'} />
            <KpiTile density="console" icon={<ClipboardCheck className="w-3.5 h-3.5" />} label={t.overview.dashboard.tile_reviews} numericValue={pendingReviews} color={pendingReviews > 0 ? 'text-amber-400' : 'text-foreground'} />
          </div>
        </div>
        {sparkline && (
          <div className="w-full pt-3 border-t border-primary/10">
            <div className="flex items-center justify-between typo-caption uppercase tracking-widest text-foreground mb-1.5 font-mono">
              <span>{t.overview.dashboard.spark_traffic_errors}</span>
              <span>{points.length}d</span>
            </div>
            <svg viewBox={`0 0 ${sparkline.w} ${sparkline.h}`} className="w-full h-10" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="vitals-spark-traffic" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* baseline */}
              <line x1="0" y1={sparkline.h - 2} x2={sparkline.w} y2={sparkline.h - 2} stroke="currentColor" className="text-primary/10" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <path d={sparkline.area} fill="url(#vitals-spark-traffic)" stroke="none" />
              <polyline fill="none" stroke="#06b6d4" strokeWidth="1.5" points={sparkline.traffic} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              <polyline fill="none" stroke="#f43f5e" strokeWidth="1.5" points={sparkline.errors} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={sparkline.trafficEnd.x} cy={sparkline.trafficEnd.y} r="2" fill="#06b6d4" />
              <circle cx={sparkline.errorEnd.x} cy={sparkline.errorEnd.y} r="2" fill="#f43f5e" />
            </svg>
          </div>
        )}
        {trend}
      </div>
    </div>
  );
});

function SuccessRing({ rate }: { rate: number | null }) {
  const { t } = useTranslation();
  // Honour reduced-motion: collapse the 600ms ring sweep to its final state
  // rather than animating the stroke. The global reduced-motion CSS already
  // clamps transition-duration, but gating here makes the intent explicit and
  // covers the case where this inline transition is read by JS tooling.
  const reduceMotion = useReducedMotion();
  const size = 164;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // An unmeasured window draws the track and no arc. Drawing rate 0 instead
  // would render a fleet that executed nothing as an alarm-coloured 0% — a
  // finding the surface fabricated, with the same geometry as a real outage.
  const measured = rate !== null;
  const offset = measured ? c - (rate / 100) * c : c;
  const color = !measured ? 'transparent' : rate >= 90 ? '#34d399' : rate >= 75 ? '#fbbf24' : '#fb7185';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={stroke} fill="none" className="text-primary/10" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: reduceMotion ? 'none' : 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-4xl tabular-nums text-foreground">
          {measured ? (
            <>
              <AnimatedCounter value={rate} formatFn={(v) => `${Math.round(v)}`} />
              <span className="text-foreground typo-body-lg">%</span>
            </>
          ) : (
            <span className="text-foreground">—</span>
          )}
        </div>
        <div className="typo-caption uppercase tracking-[0.25em] text-foreground mt-1 font-mono">
          {t.overview.dashboard.success_label}
        </div>
      </div>
    </div>
  );
}

// Small chip marking a pane (or sub-section) as fleet-wide — its data ignores
// the header persona filter. Rendered wherever Mission Control mixes
// persona-scoped and fleet-scoped readouts so the boundary stays visible.
export function FleetTag() {
  const { t } = useTranslation();
  return (
    <span
      title={t.overview.dashboard.scope_fleet_hint}
      className="typo-caption font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-interactive border border-primary/15 bg-primary/[0.04] text-foreground flex-shrink-0"
    >
      {t.overview.dashboard.scope_fleet}
    </span>
  );
}
