// Spend in layer 2: the window's cost, burn and projection as stat tiles, and
// the daily cost drawn as bars with the backend's anomaly days marked (the
// cost_anomalies FleetOptimizationCard reads to raise its cost recommendation).

import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import { Section, StatStrip, ChartFrame, toneColor } from '@/features/shared/components/kit';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { formatNumeric } from '@/lib/utils/formatters';
import type { MissionReadings } from '../useMissionReadings';

export function SpendDetail({ readings }: { readings: MissionReadings }) {
  const { t, tx, language } = useTranslation();
  const ml = t.overview.mission_layers;
  const anomalies = useOverviewStore((s) => s.executionDashboard?.cost_anomalies);
  // The backend's month-end projection: an estimate, and labelled as one.
  const monthEnd = useOverviewStore((s) => s.executionDashboard?.projected_monthly_cost ?? null);
  const sp = readings.spend.status === 'ready' ? readings.spend.value : null;
  const st = sp ? 'default' : 'loading';
  const bars = useMemo(() => {
    const pts = readings.points;
    const max = Math.max(...pts.map((p) => p.cost), 0.0001);
    const spikes = new Set((anomalies ?? []).map((a) => a.date.slice(0, 10)));
    return pts.map((p) => ({ h: p.cost / max, spike: spikes.has(p.date.slice(0, 10)) }));
  }, [readings.points, anomalies]);

  return (
    <div className="mc-detail-stack">
      <StatStrip tiles={[
        { label: ml.dim_spend, value: sp ? <Numeric value={sp.total} unit="usd" /> : null, state: st },
        { label: t.overview.health_extra.burn, value: sp?.burnRate != null ? <Numeric value={sp.burnRate} unit="usd" /> : null, state: st },
        { label: t.overview.health_extra.cost_anomalies, value: sp ? <Numeric value={sp.anomalies} unit="count" /> : null, state: st },
        { label: t.overview.sla.avg_latency, value: sp ? <Numeric value={sp.avgLatencyMs} unit="ms" /> : null, state: st },
      ]} />
      <Section
        level={2}
        title={t.overview.sla.metric_cost}
        meta={monthEnd !== null ? tx(ml.projected_month, { value: formatNumeric(monthEnd, 'usd', { language }) }) : undefined}
      >
        <ChartFrame height={160} label={t.overview.sla.metric_cost} state={bars.length ? 'default' : sp ? 'empty' : 'loading'} empty={{ title: ml.no_runs }}>
          <svg className="mc-bars" viewBox={`0 0 ${bars.length * 10} 100`} preserveAspectRatio="none" aria-hidden="true">
            {bars.map((b, i) => (
              <rect
                key={i}
                x={i * 10 + 1.5}
                width={7}
                y={100 - Math.max(b.h * 100, 1.5)}
                height={Math.max(b.h * 100, 1.5)}
                rx={1.5}
                fill={toneColor(b.spike ? 'warning' : 'primary')}
                opacity={b.spike ? 0.95 : 0.55}
              />
            ))}
          </svg>
        </ChartFrame>
      </Section>
    </div>
  );
}
