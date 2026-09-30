/**
 * Observability (composition kit): the marks drawn over the trend charts. Annotations are a
 * dashed reference line with a small dot; a cost anomaly is a diamond in the error tone that
 * opens its drill-down. Colours come from kit tones and theme variables, so light themes get
 * them too (the diamond's rim is the background, not white).
 */
import type { RechartsModule } from '@/features/shared/charts/RechartsWrapper';
import { toneColor } from '@/features/shared/components/kit';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import type { ChartAnnotationRecord } from '../libs/chartAnnotations';
import { getAnnotationColor } from '../libs/chartAnnotations';

export function renderAnnotationLines(R: RechartsModule, annotations: ChartAnnotationRecord[], keyPrefix: string) {
  return annotations.map((a, i) => (
    <R.ReferenceLine
      key={`${keyPrefix}-annotation-${a.date}-${a.type}-${i}`}
      x={a.date}
      stroke={getAnnotationColor(a.type, a.color)}
      strokeDasharray="4 4"
      strokeOpacity={0.5}
      label={({ viewBox }) => {
        if (!viewBox) return null;
        return (
          <g>
            <title>{a.label}</title>
            <circle cx={viewBox.x} cy={viewBox.y - 6} r={2.2} fill={getAnnotationColor(a.type, a.color)} />
          </g>
        );
      }}
    />
  ));
}

export function renderAnomalyMarkers(
  R: RechartsModule,
  anomalies: MetricAnomaly[],
  { animate, onClick, label }: { animate: boolean; onClick?: (date: string) => void; label: (a: MetricAnomaly) => string },
) {
  const tone = toneColor('error');
  return anomalies.map((a) => (
    <R.ReferenceLine
      key={`anomaly-${a.date}`}
      x={a.date}
      stroke={tone}
      strokeDasharray="2 3"
      strokeOpacity={0.5}
      label={({ viewBox }) => {
        if (!viewBox) return null;
        const cx = viewBox.x ?? 0;
        const cy = (viewBox.y ?? 0) - 8;
        return (
          <g style={{ cursor: onClick ? 'pointer' : undefined }} onClick={() => onClick?.(a.date)}>
            <title>{label(a)}</title>
            <circle cx={cx} cy={cy} r={6} fill="none" stroke={tone} strokeWidth={1} opacity={0.3}>
              {animate && <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />}
              {animate && <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />}
            </circle>
            <polygon points={`${cx},${cy - 4} ${cx + 4},${cy} ${cx},${cy + 4} ${cx - 4},${cy}`} fill={tone} stroke="var(--background)" strokeWidth={1} />
          </g>
        );
      }}
    />
  ));
}
