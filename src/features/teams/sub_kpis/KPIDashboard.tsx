// KPI dashboard — active KPIs as stat cards (current vs target, direction,
// off-track tint, cadence + freshness), grouped under their context group.
// Click opens the detail drawer. Parked KPIs (needed_connector set) carry the
// "Connect <service>" CTA that deep-links into the vault credential catalog.
import { useMemo } from 'react';
import { Cable, Gauge } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { kpiTrack, kpiProgressPct, type KpiTrack } from './kpiMath';

const TRACK_TINT: Record<KpiTrack, string> = {
  met: 'border-success/40',
  'on-track': 'border-primary/15',
  'off-track': 'border-destructive/50',
  unmeasured: 'border-primary/10',
};

export function KPIDashboard({
  loading,
  onOpen,
  onReviewProposals,
}: {
  loading: boolean;
  onOpen: (kpiId: string) => void;
  onReviewProposals: () => void;
}) {
  const { t, tx } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const visible = useMemo(
    () => kpis.filter((k) => k.status === 'active' || k.status === 'paused'),
    [kpis],
  );
  const hasProposals = useMemo(() => kpis.some((k) => k.status === 'proposed'), [kpis]);

  if (loading && kpis.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title={t.kpis.empty_title}
        description={hasProposals ? t.kpis.empty_with_proposals_hint : t.kpis.empty_hint}
        action={
          hasProposals
            ? { label: t.kpis.review_proposals_cta, onClick: onReviewProposals }
            : undefined
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="kpi-dashboard">
      {visible.map((kpi) => {
        const track = kpiTrack(kpi);
        const progress = kpiProgressPct(kpi);
        return (
          <button
            key={kpi.id}
            type="button"
            onClick={() => onOpen(kpi.id)}
            data-testid={`kpi-card-${kpi.id}`}
            className={`text-left rounded-card border bg-secondary/20 hover:bg-secondary/40 transition-colors p-4 space-y-2 ${TRACK_TINT[track]} ${kpi.status === 'paused' ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="typo-heading text-foreground">{kpi.name}</span>
              <span className="typo-caption text-foreground uppercase">{kpi.category}</span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="typo-title text-foreground tabular-nums">
                {kpi.current_value != null ? <Numeric value={kpi.current_value} /> : '—'}
              </span>
              {kpi.target_value != null && (
                <span className="typo-body text-foreground tabular-nums">
                  / <Numeric value={kpi.target_value} /> {kpi.unit}
                </span>
              )}
              <span className="typo-caption text-foreground">
                {kpi.direction === 'down' ? '↓' : '↑'}
              </span>
            </div>

            {progress != null && (
              <div className="h-1 rounded-full bg-secondary/60 overflow-hidden">
                <div
                  className={`h-full rounded-full ${track === 'off-track' ? 'bg-destructive/70' : 'bg-primary/70'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <span className="typo-caption text-foreground">
                {track === 'met'
                  ? t.kpis.track_met
                  : track === 'off-track'
                    ? t.kpis.track_off
                    : track === 'unmeasured'
                      ? t.kpis.track_unmeasured
                      : t.kpis.track_on}
              </span>
              {kpi.last_measured_at && (
                <span className="typo-caption text-foreground">
                  · <RelativeTime timestamp={kpi.last_measured_at} />
                </span>
              )}
              {kpi.needed_connector && (
                <Tooltip content={tx(t.kpis.connect_tooltip, { service: kpi.needed_connector })}>
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSidebarSection('credentials');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        setSidebarSection('credentials');
                      }
                    }}
                    className="inline-flex items-center gap-1 typo-caption text-primary hover:underline cursor-pointer"
                    data-testid={`kpi-connect-${kpi.id}`}
                  >
                    <Cable className="w-3 h-3" />
                    {tx(t.kpis.connect_cta, { service: kpi.needed_connector })}
                  </span>
                </Tooltip>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
