/**
 * Observability (composition kit): the Overview section. The filter bar scopes the whole page,
 * so it sits here; the four headline figures are a StatStrip, each drawn as countable units
 * (cost and runs at a 1-2-5 quantum stated in the legend, success rate as 20 squares of 5%,
 * one square per active persona). The pipeline's per-source state is a ChipRow, shown only when
 * a source failed, went stale or has not loaded.
 */
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ChipRow, Dot, KitButton, RangePicker, Section, StatStrip, Toolbar, UnitStrip, apportion, type Chip } from '@/features/shared/components/kit';
import { DateRangePopover } from '@/features/overview/sub_usage/components/DayRangePicker';
import type { OverviewDayRange } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import type { useObservabilityData } from '../libs/useObservabilityData';
import { quantumFor } from '../libs/quantum';
import type { ObservabilityWords } from '../libs/useObservabilityWords';

const STALE_MS = 300_000;
// Unit labels, untranslated as before (DayRangePicker).
const PRESETS: Array<{ v: OverviewDayRange; label: string }> = [{ v: 1, label: '24h' }, { v: 7, label: '7d' }, { v: 30, label: '30d' }, { v: 90, label: '90d' }];

export interface OverviewProps {
  d: ReturnType<typeof useObservabilityData>;
  showAlerts: boolean;
  onToggleAlerts: () => void;
  activeAlertCount: number;
  pipelineErrors: Record<string, string>;
  pipelineFetchedAt: Record<string, number>;
  w: ObservabilityWords;
}

function sourceChips(p: OverviewProps): Chip[] {
  const { o } = p.w;
  const er = o.observability.error_recovery;
  const sources = [
    { key: 'observabilityMetrics', label: o.activity.metrics },
    { key: 'alertRules', label: o.observability_extra.alert_rules_label },
    { key: 'alertHistory', label: o.observability_extra.alert_history_label },
    { key: 'healingIssues', label: o.observability_extra.healing_issues },
  ];
  if (!sources.some((s) => p.pipelineErrors[s.key] || !p.pipelineFetchedAt[s.key])) return [];
  return sources.map(({ key, label }): Chip => {
    const at = p.pipelineFetchedAt[key];
    if (p.pipelineErrors[key]) return { id: key, label: `${label}: ${er.panel_failed}`, tone: 'error', glyph: 'solid' };
    if (at && Date.now() - at > STALE_MS) return { id: key, label: `${label}: ${er.panel_stale}`, tone: 'warning', glyph: 'soft' };
    if (at) return { id: key, label, tone: 'success', glyph: 'hollow' };
    return { id: key, label, glyph: 'empty', state: 'muted' };
  });
}

export function ObservabilityOverview(p: OverviewProps) {
  const { d, w } = p;
  const { o } = w;
  const x = o.observability_extra;
  const s = d.summary;
  const runs = s?.totalExecutions ?? 0;
  const ok = s?.successfulExecutions ?? 0;
  const failed = s?.failedExecutions ?? 0;
  const costQ = quantumFor(s ? s.totalCostUsd : 0, 60, 0.1);
  const runQ = quantumFor(runs, 60, 1);
  const chips = sourceChips(p);
  const dayFmt = new Intl.DateTimeFormat(w.language, { month: 'short', day: 'numeric' });
  const fmtDay = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00`));
  return (
    <Section
      id="s-obs-overview"
      eyebrow={w.eyebrow}
      title={w.t.sidebar.overview}
      meta={
        <span className="k-legend-row typo-caption">
          <span><UnitStrip size="s" label={x.total_cost} segments={[{ n: 1, tone: 'primary', glyph: 'soft' }]} /> = <Numeric value={costQ} unit="usd" precision={costQ < 1 ? 2 : 0} /></span>
          <span><UnitStrip size="s" label={x.executions_label} segments={[{ n: 1, tone: 'success' }]} /> = {runQ} {x.executions_label.toLowerCase()}</span>
        </span>
      }
      actions={
        <>
          <KitButton pressed={d.autoRefresh} onClick={() => d.setAutoRefresh(!d.autoRefresh)} testId="obs-auto-refresh">
            <span className="inline-flex items-center gap-2">
              <Dot tone="neutral" glyph={d.autoRefresh ? 'live' : 'hollow'} />
              {d.autoRefresh ? x.auto_refresh_on : x.auto_refresh_off}
            </span>
          </KitButton>
          <KitButton onClick={() => { void d.refreshAll(); }} testId="obs-refresh">{w.t.common.refresh}</KitButton>
        </>
      }
    >
      <Toolbar label={o.observability.title}>
        <PersonaSelect value={d.selectedPersonaId} onChange={d.setSelectedPersonaId} personas={d.personas} />
        <RangePicker
          label={o.usage_filters.time_range_label}
          presets={PRESETS}
          value={d.days}
          onChange={d.setDays}
          custom={{
            label: d.customDateRange ? `${fmtDay(d.customDateRange[0])} - ${fmtDay(d.customDateRange[1])}` : w.t.triggers.schedule.custom,
            active: d.customDateRange != null,
            render: (close) => (
              <DateRangePopover value={d.customDateRange ?? null} onChange={(r) => { d.setCustomDateRange(r); if (r) close(); }} />
            ),
          }}
        />
        <KitButton pressed={p.showAlerts} onClick={p.onToggleAlerts} testId="obs-alerts-toggle">
          <span className="inline-flex items-center gap-2">
            {p.activeAlertCount > 0 && <Dot tone="error" />}
            {o.observability.alert_rules}
            {p.activeAlertCount > 0 && <span className="typo-data k-regular k-quiet">{p.activeAlertCount}</span>}
          </span>
        </KitButton>
      </Toolbar>
      {chips.length > 0 && <ChipRow label={o.observability.title} emptyLabel="" chips={chips} />}
      {d.observabilityError && (
        <div className="k-in" style={{ marginBottom: 12 }}>
          <InlineErrorBanner severity="error" title={o.observability.metrics_unavailable} message={d.observabilityError} onRetry={d.refreshAll} />
        </div>
      )}
      <StatStrip
        state={!s && !d.observabilityError ? 'loading' : undefined}
        tiles={[
          {
            label: x.total_cost,
            value: s ? <Numeric value={s.totalCostUsd} unit="usd" precision={2} /> : null,
            draw: <UnitStrip size="s" rows={2} label={x.total_cost} segments={[{ n: s ? s.totalCostUsd / costQ : 0, tone: 'primary', glyph: 'soft' }]} />,
          },
          {
            label: x.executions_label,
            value: s ? <Numeric value={runs} unit="compact" /> : null,
            draw: <UnitStrip size="s" rows={2} label={x.executions_label} segments={apportion([{ value: ok, tone: 'success' }, { value: failed, tone: 'error' }], runQ)} />,
          },
          {
            label: x.success_rate,
            value: s ? <Numeric value={runs > 0 ? (ok / runs) * 100 : 0} unit="percent" precision={1} /> : null,
            draw: <UnitStrip size="m" label={x.success_rate} segments={runs > 0 ? apportion([{ value: ok, tone: 'success' }, { value: failed, tone: 'error' }], runs / 20) : []} />,
          },
          {
            label: x.active_personas,
            value: s ? s.activePersonas : null,
            draw: <UnitStrip size="m" label={x.active_personas} segments={[{ n: s?.activePersonas ?? 0, tone: 'agent' }]} />,
          },
        ]}
      />
    </Section>
  );
}
