/**
 * Observability, layer 1: every region below the Overview stats, abstracted to one pressable
 * kit `Tile` carrying that region's simple stat (the owner, 2026-10-04: "Abstracting all
 * sections below with cards and simple stat, on click expanding ... into nested levels").
 *
 * Each card is its own region under law 6 (docs/design/overview-loading.md): it retires its own
 * placeholder from its own source and never waits on another card's data, so a card showing a
 * stat never waits on layer 2's chart data. The two high-frequency sources - the in-memory IPC
 * metrics and the system-trace registry - keep their subscription inside their own card so a
 * recorded IPC call re-renders one tile and not the dashboard.
 */
import { memo, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { KitButton, StatStrip, Tile, Tiles, UnitStrip, apportion, type Glyph, type StatTile, type Tone } from '@/features/shared/components/kit';
import { getGlobalSummary, getIpcTotalCount, subscribeIpcMetrics } from '@/lib/ipcMetrics';
import { useSystemTraces } from '@/hooks/execution/useSystemTrace';
import { useOverviewStore } from '@/stores/overviewStore';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { AthenaHealth } from '@/lib/bindings/AthenaHealth';
import { issueState } from '../libs/issueModel';
import { HealingIssueSummary } from './HealingIssueSummary';
import { latencyTone } from '../libs/latencyTone';
import { worstErrorRate, type ToolPerformance } from '../libs/useToolPerformance';
import type { ObservabilityWords, RegionId } from '../libs/useObservabilityWords';

type CardMark = { tone: Tone; glyph?: Glyph; label: string };

interface CardShellProps {
  id: RegionId;
  open: RegionId | null;
  onOpen: (id: RegionId) => void;
  w: ObservabilityWords;
  /** 6 for the working list, 3 for the rest: two rows that fill the twelve columns exactly. */
  span?: number;
  mark?: CardMark;
  /** One quiet line under the title - the wide card has the room for it, the narrow ones do not. */
  meta?: ReactNode;
  /** In flight with nothing to show yet: the stat tiles ghost at their own geometry. */
  loading?: boolean;
  /** False = the card states its figure and is not a door (there is no level to enter). */
  enterable?: boolean;
  stats: readonly StatTile[];
}

/**
 * One layer-1 card: a kit `Tile` whose title is its one button (`onPress`) and whose body is a
 * kit `StatStrip`. Nothing here is hand-rolled - the card, the stat tile and the press are all
 * the kit's, and `aria-current` on the open one is `Tile`'s own spelling for "the region you
 * are in". The loading state is the StatStrip's own calm ghost at the figure's geometry, not
 * `Tile`'s row ghosts, which would be the wrong shape for a two-figure card.
 */
function CardShell({ id, open, onOpen, w, span = 3, mark, meta, loading, enterable = true, stats }: CardShellProps) {
  const isOpen = open === id;
  return (
    <Tile
      span={span}
      testId={`obs-card-${id}`}
      title={w.region[id]}
      // The open card's own summary line is said again by the section it opened, and a long one
      // pushes the Collapse action onto its own row, so the card drops it while it is the door.
      meta={loading || isOpen ? undefined : meta}
      mark={loading ? undefined : mark}
      state={isOpen ? 'selected' : undefined}
      onPress={enterable ? () => onOpen(id) : undefined}
      // The card is the disclosure, so the way back up lives on it: the press toggles, and the
      // action spells that out with `aria-expanded` for a reader who cannot see the open level.
      actions={isOpen ? (
        <KitButton quiet expanded onClick={() => onOpen(id)} testId={`obs-card-${id}-collapse`}>
          {w.o.review.backlog_collapse}
        </KitButton>
      ) : undefined}
    >
      <StatStrip state={loading ? 'loading' : undefined} tiles={stats} />
    </Tile>
  );
}

type Shell = Pick<CardShellProps, 'open' | 'onOpen' | 'w'>;

/** Health issues: the open count, drawn as open against auto-fixed. */
function HealthCard({ issues, loading, ...s }: Shell & { issues: PersonaHealingIssue[]; loading: boolean }) {
  const counts = useMemo(() => {
    let open = 0;
    let fixed = 0;
    for (const i of issues) {
      const st = issueState(i);
      if (st === 'fixed' || st === 'resolved') fixed += 1; else open += 1;
    }
    return { open, fixed };
  }, [issues]);
  const label = s.w.ad.filter_open;
  const quantum = Math.max(1, (counts.open + counts.fixed) / 20);
  return (
    <CardShell
      id="health"
      span={6}
      loading={loading && issues.length === 0}
      meta={issues.length > 0 ? <HealingIssueSummary issues={issues} w={s.w} /> : undefined}
      mark={counts.open > 0
        ? { tone: 'warning', glyph: 'solid', label }
        : { tone: 'success', glyph: 'hollow', label: s.w.o.observability.no_open_issues }}
      stats={[
        {
          label,
          value: <Numeric value={counts.open} unit="count" />,
          draw: <UnitStrip size="m" label={label} segments={apportion([{ value: counts.open, tone: 'warning' }, { value: counts.fixed, tone: 'success' }], quantum)} />,
        },
        { label: s.w.ad.filter_auto_fixed, value: <Numeric value={counts.fixed} unit="count" />, state: counts.fixed > 0 ? 'default' : 'muted' },
      ]}
      {...s}
    />
  );
}

/** Metrics: the window's cost and run count - the two figures the charts a level down draw. */
function ChartsCard({ peakCost, failed, anomalies, loading, ...s }: Shell & { peakCost: number | null; failed: number; anomalies: number; loading: boolean }) {
  const c = s.w.o.observability_charts;
  return (
    <CardShell
      id="charts"
      loading={loading}
      mark={anomalies > 0
        ? { tone: 'error', glyph: 'solid', label: s.w.tx(anomalies === 1 ? s.w.o.observability_charts.anomaly_detected : s.w.o.observability_charts.anomalies_detected, { count: anomalies }) }
        : { tone: 'primary', glyph: 'soft', label: s.w.o.activity.metrics }}
      // Deliberately NOT the window's total cost and run count: those are the Overview strip
      // directly above, and a card that repeats the section above it teaches nothing. These are
      // the two figures the charts a level down actually draw - the worst day, and the failures.
      stats={[
        { label: c.cost_over_time, value: peakCost == null ? null : <Numeric value={peakCost} unit="usd" precision={2} /> },
        { label: c.failed, value: <Numeric value={failed} unit="count" />, state: failed > 0 ? 'default' : 'muted' },
      ]}
      {...s}
    />
  );
}

/** Alert rules and the fired history: its own store read, so the dashboard does not carry it. */
const AlertsCard = memo(function AlertsCard(s: Shell) {
  const a = useOverviewStore(useShallow((st) => ({
    rules: st.alertRules.length,
    active: st.alertHistory.filter((x) => !x.dismissed).length,
    loading: st.alertRulesLoading,
  })));
  const x = s.w.o.observability_extra;
  const history = s.w.o.healing_issues_panel.alert_history_title;
  return (
    <CardShell
      id="alerts"
      loading={a.loading && a.rules === 0}
      mark={a.active > 0
        ? { tone: 'error', glyph: 'solid', label: history }
        : { tone: 'success', glyph: 'hollow', label: x.alert_rules_label }}
      stats={[
        { label: x.alert_rules_label, value: <Numeric value={a.rules} unit="count" /> },
        { label: history, value: <Numeric value={a.active} unit="count" />, state: a.active > 0 ? 'default' : 'muted' },
      ]}
      {...s}
    />
  );
});

/** IPC: the in-memory metrics store, subscribed here so a recorded call re-renders this tile only. */
const IpcCard = memo(function IpcCard(s: Shell) {
  const generation = useSyncExternalStore(subscribeIpcMetrics, getIpcTotalCount);
  const summary = useMemo(() => { void generation; return getGlobalSummary(); }, [generation]);
  const ip = s.w.o.ipc_panel;
  return (
    <CardShell
      id="ipc"
      // Nothing measured yet: the figures are honest zeros and there is no level to enter - the
      // section a level down renders nothing without a call, and has since it was written.
      enterable={summary.totalCalls > 0}
      mark={{ tone: latencyTone(summary.p95), glyph: 'solid', label: 'p95' }}
      stats={[
        { label: ip.calls_header, value: <Numeric value={summary.totalCalls} unit="count" /> },
        { label: 'p95', value: <Numeric value={summary.p95} unit="ms" /> },
      ]}
      {...s}
    />
  );
});

/** Tools: the dashboard's single read of `get_tool_performance_summary`, shared with the section. */
function ToolsCard({ perf, ...s }: Shell & { perf: ToolPerformance }) {
  const wd = s.w.o.widgets;
  const worst = worstErrorRate(perf.rows);
  const runs = perf.rows.reduce((n, r) => n + Number(r.total_runs), 0);
  const errLabel = wd.tool_performance_col_errors;
  return (
    <CardShell
      id="tools"
      loading={perf.loading && perf.rows.length === 0}
      mark={worst >= 0.05
        ? { tone: 'error', glyph: 'solid', label: errLabel }
        : worst > 0
          ? { tone: 'warning', glyph: 'soft', label: errLabel }
          : { tone: 'success', glyph: 'hollow', label: errLabel }}
      stats={[
        { label: wd.tool_performance_col_tool, value: <Numeric value={perf.rows.length} unit="count" /> },
        { label: wd.tool_performance_col_runs, value: <Numeric value={runs} unit="compact" /> },
      ]}
      {...s}
    />
  );
}

/** System traces: the in-memory registry, subscribed here for the same reason as IPC. */
const TracesCard = memo(function TracesCard(s: Shell) {
  const { traces, activeCount, errorCount } = useSystemTraces();
  return (
    <CardShell
      id="traces"
      mark={errorCount > 0
        ? { tone: 'error', glyph: 'solid', label: s.w.t.common.error }
        : activeCount > 0
          ? { tone: 'primary', glyph: 'live', label: s.w.t.common.active }
          : { tone: 'neutral', glyph: 'hollow', label: s.w.o.observability_extra.system_trace }}
      stats={[
        { label: s.w.t.agents.executions.trace, value: <Numeric value={traces.length} unit="count" /> },
        { label: s.w.t.common.active, value: <Numeric value={activeCount} unit="count" />, state: activeCount > 0 ? 'default' : 'muted' },
      ]}
      {...s}
    />
  );
});

/** Athena: the dashboard's single `companion_get_health` read, shared with the panel. */
function AthenaCard({ health, loading, ...s }: Shell & { health: AthenaHealth | null; loading: boolean }) {
  const a = s.w.o.athena;
  return (
    <CardShell
      id="athena"
      loading={loading && !health}
      mark={health && health.errors > 0
        ? { tone: 'error', glyph: 'solid', label: a.errors }
        : { tone: 'agent', glyph: 'soft', label: a.health_title }}
      stats={[
        { label: a.turns, value: health ? <Numeric value={health.turns} unit="count" /> : null },
        { label: a.triage_passes, value: health ? <Numeric value={health.triage.passes} unit="count" /> : null },
      ]}
      {...s}
    />
  );
}

export interface ObservabilityCardsProps extends Shell {
  issues: PersonaHealingIssue[];
  issuesLoading: boolean;
  peakCost: number | null;
  failed: number;
  anomalies: number;
  metricsLoading: boolean;
  tools: ToolPerformance;
  athena: { data: AthenaHealth | null; loading: boolean };
}

export function ObservabilityCards(p: ObservabilityCardsProps) {
  const s: Shell = { open: p.open, onOpen: p.onOpen, w: p.w };
  return (
    <Tiles label={p.w.o.observability.title}>
      <HealthCard issues={p.issues} loading={p.issuesLoading} {...s} />
      <ChartsCard peakCost={p.peakCost} failed={p.failed} anomalies={p.anomalies} loading={p.metricsLoading} {...s} />
      <AlertsCard {...s} />
      <IpcCard {...s} />
      <ToolsCard perf={p.tools} {...s} />
      <TracesCard {...s} />
      <AthenaCard health={p.athena.data} loading={p.athena.loading} {...s} />
    </Tiles>
  );
}
