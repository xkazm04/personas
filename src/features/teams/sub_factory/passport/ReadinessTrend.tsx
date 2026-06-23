// Cover trend line — the project's golden-% history as a sparkline plus the
// delta since its last real change. Appears only once there are ≥2 recorded
// snapshots, so it accrues as the user scans/upgrades over time. A downward
// delta renders red — the lightweight regression signal.
import { Sparkline } from './passportWidgets';
import { getHistory, trendDelta } from './passportHistory';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

export function ReadinessTrend({ slug }: { slug: string }) {
  const hist = getHistory(slug);
  if (hist.length < 2) return null;
  const golden = hist.map((s) => s.golden);
  const d = trendDelta(slug);
  const dg = d?.golden ?? 0;
  const tone = dg > 0 ? 'text-emerald-300' : dg < 0 ? 'text-red-300' : 'text-foreground/40';
  return (
    <Tooltip content={`Golden-standard trend over ${hist.length} recorded snapshots${dg !== 0 ? ` · ${dg > 0 ? '+' : ''}${dg} since last change` : ''}`}>
      <span className="inline-flex items-center gap-1.5 cursor-default">
        <span className="typo-label text-foreground/40 flex-shrink-0">Trend</span>
        <span className="text-foreground/30 flex-shrink-0">
          <Sparkline values={golden} />
        </span>
        {dg !== 0 && (
          <span className={`typo-label tabular-nums font-semibold ${tone}`}>{dg > 0 ? '▲' : '▼'}{Math.abs(dg)}</span>
        )}
      </span>
    </Tooltip>
  );
}
