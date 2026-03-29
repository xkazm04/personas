import { CHART_GRAD } from '../libs/chartConstants';

/**
 * Hidden SVG that defines shared linearGradient defs for all Recharts charts.
 * Mount once near the app root — charts reference these by stable ID
 * (e.g. `fill={`url(#${CHART_GRAD.cost})`}`).
 */
export function ChartGradientDefs() {
  return (
    <svg width={0} height={0} className="absolute" aria-hidden="true">
      <defs>
        {/* Indigo — cost / primary metric area fills */}
        <linearGradient id={CHART_GRAD.cost} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
        </linearGradient>

        {/* Cyan — traffic / volume area fills */}
        <linearGradient id={CHART_GRAD.traffic} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
        </linearGradient>

        {/* Rose — error area fills */}
        <linearGradient id={CHART_GRAD.error} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25} />
          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
        </linearGradient>

        {/* Green — success area fills */}
        <linearGradient id={CHART_GRAD.success} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
          <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}
