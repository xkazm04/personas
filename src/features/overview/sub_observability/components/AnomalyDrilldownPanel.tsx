/**
 * Anomaly drill-down (Observability and Activity > cost anomalies), in the shared BaseModal's own
 * panel, composed from the kit: the spike's value, baseline and deviation as a StatStrip, then
 * the likely root causes and the correlated events as ListRows on the spine, each Mark in the
 * tone of what kind of event it was, relevance drawn as ten units. Loading is the kit's ghost,
 * not a spinner.
 *
 * Not `KitHost compact` (doctrine 6c, 2026-10-03): a drill-down exists to be READ - it explains
 * one spike in prose, figures and event rows - and the compact tier subtracts 11.1-12.5% from
 * every row token it holds. Compact is for dense tool lists. This panel is also mounted by
 * Activity's cost-anomaly section, which gains the same step back.
 */
import { memo, useMemo } from 'react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { KitButton, KitHost, ListRow, Rows, Section, StatStrip, Surface, UnitStrip, type Glyph, type Tone } from '@/features/shared/components/kit';
import type { AnomalyDrilldownData } from '@/lib/bindings/AnomalyDrilldownData';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import { useTranslation } from '@/i18n/useTranslation';
import { formatSignedOffset } from '@/lib/utils/formatters';

interface AnomalyDrilldownPanelProps {
  anomaly: MetricAnomaly;
  data: AnomalyDrilldownData | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

const EVENT_MARK: Record<string, { tone: Tone; glyph: Glyph }> = {
  prompt_deployment: { tone: 'agent', glyph: 'solid' },
  credential_rotation: { tone: 'warning', glyph: 'soft' },
  circuit_breaker: { tone: 'error', glyph: 'solid' },
  healing_issue: { tone: 'primary', glyph: 'soft' },
  alert: { tone: 'error', glyph: 'soft' },
  external: { tone: 'neutral', glyph: 'hollow' },
};
const markOf = (type: string) => EVENT_MARK[type] ?? EVENT_MARK.external!;

const Relevance = memo(function Relevance({ value, label }: { value: number; label: string }) {
  const n = Math.max(0, Math.min(1, value)) * 10;
  const tone: Tone = value >= 0.7 ? 'success' : value >= 0.4 ? 'warning' : 'error';
  return (
    <span className="k-fig">
      <UnitStrip size="pip" label={label} segments={[{ n, tone }, { n: 10 - n, glyph: 'empty' }]} />
      <span className="typo-data k-regular"><Numeric value={value} unit="ratio" precision={0} /></span>
    </span>
  );
});

export default function AnomalyDrilldownPanel({ anomaly, data, loading, error, onClose }: AnomalyDrilldownPanelProps) {
  const { t } = useTranslation();
  const x = t.overview.anomaly_drilldown_extra;
  const metricLabel = ({
    cost: t.overview.activity.col_cost,
    error_rate: t.overview.observability_extra.error_rate,
    latency: t.overview.health_extra.latency_p95,
  } as Record<string, string>)[anomaly.metric] ?? anomaly.metric;
  const events = useMemo(() => (data ? [...data.correlatedEvents].sort((a, b) => a.offsetSeconds - b.offsetSeconds) : []), [data]);
  const causes = data?.rootCauseSuggestions ?? [];
  const confidence = t.overview.healing_issues_panel.confidence_pct_suffix.replace(/^%\s*/, '');

  return (
    <BaseModal isOpen onClose={onClose} titleId="anomaly-drilldown-title" maxWidthClass="max-w-2xl" staggerChildren={false}>
      <KitHost testId="anomaly-drilldown">
        <div className="overflow-y-auto" style={{ maxHeight: '85vh', padding: '20px 8px 8px 4px' }}>
          <Surface>
            <Section
              eyebrow={<>{metricLabel} {t.overview.healing_issues_panel.spike_on} <AbsoluteTime timestamp={anomaly.date} variant="date" /></>}
              title={<span id="anomaly-drilldown-title">{x.title}</span>}
              actions={<KitButton quiet onClick={onClose} hint="Esc">{t.common.close}</KitButton>}
            >
              <StatStrip tiles={[
                { label: x.value_label.replace(/:$/, ''), value: <Numeric value={anomaly.value} precision={2} /> },
                { label: x.baseline_label.replace(/:$/, ''), value: <Numeric value={anomaly.baseline} precision={2} /> },
                { label: metricLabel, value: <span className="t-error k-toned">+<Numeric value={anomaly.deviation_pct} unit="percent" precision={0} /></span> },
              ]} />
              {causes.length > 0 && !loading && (
                <Section level={2} title={x.likely_root_causes} count={causes.length}>
                  <Rows count={causes.length} empty={{ title: '' }}>
                    {causes.map((s) => (
                      <ListRow
                        key={`${s.rank}-${s.eventType}`}
                        size="l"
                        name={`#${s.rank} ${s.title}`}
                        meta={s.description}
                        mark={{ ...markOf(s.eventType), label: s.eventType }}
                        figures={<Relevance value={s.confidence} label={confidence} />}
                        time={s.relatedEventTimestamp ? <AbsoluteTime timestamp={s.relatedEventTimestamp} variant="compact" /> : undefined}
                      />
                    ))}
                  </Rows>
                </Section>
              )}
              <Section
                level={2}
                title={x.correlated_events}
                count={data && !loading ? data.correlatedEvents.length : undefined}
                desc={loading ? x.correlating : undefined}
                state={loading ? 'loading' : error ? 'empty' : undefined}
                empty={{ title: error ?? '', tone: 'error' }}
              >
                <Rows count={events.length} empty={{ title: x.no_correlated }}>
                  {events.map((e, i) => (
                    <ListRow
                      key={`${e.timestamp}-${e.eventType}-${i}`}
                      size="m"
                      name={e.label}
                      nameClass="typo-body k-regular"
                      meta={e.detail ?? <AbsoluteTime timestamp={e.timestamp} variant="compact" />}
                      mark={{ ...markOf(e.eventType), label: e.eventType }}
                      figures={<Relevance value={e.relevance} label={e.label} />}
                      time={formatSignedOffset(e.offsetSeconds)}
                    />
                  ))}
                </Rows>
              </Section>
            </Section>
          </Surface>
        </div>
      </KitHost>
    </BaseModal>
  );
}
