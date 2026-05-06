/**
 * Phase F: companion dashboard widget registry.
 *
 * Athena composes dashboards by emitting `compose_dashboard` ops with
 * a list of widgets. Each widget has a `kind` matching one of the
 * keys here, plus a `config` object the widget interprets.
 *
 * Adding a new widget kind: implement a React component + register it
 * here. Athena reads the constitution (which lists the registry keys)
 * to know what's available — keep both lists in sync.
 *
 * Components are kept small and self-contained; data fetching happens
 * inside each widget so Athena's spec can stay declarative (the
 * pieces don't need to share a parent loader).
 */
import type { ComponentType } from 'react';
import { ActivityHeatmapWidget } from './widgets/ActivityHeatmapWidget';
import { CostPerDayChartWidget } from './widgets/CostPerDayChartWidget';
import { ExecutionsStatusChartWidget } from './widgets/ExecutionsStatusChartWidget';
import { KpiTileWidget } from './widgets/KpiTileWidget';
import { LatencyDistributionChartWidget } from './widgets/LatencyDistributionChartWidget';
import { PersonaCostDonutWidget } from './widgets/PersonaCostDonutWidget';
import { RecentExecutionsTableWidget } from './widgets/RecentExecutionsTableWidget';
import { SuccessRateGaugeWidget } from './widgets/SuccessRateGaugeWidget';
import { TopPersonasListWidget } from './widgets/TopPersonasListWidget';

export interface WidgetProps {
  /** Free-form config block from Athena's compose_dashboard op. */
  config?: Record<string, unknown>;
  /** Optional title override; widget falls back to its own default. */
  title?: string;
}

export const widgetRegistry: Record<string, ComponentType<WidgetProps>> = {
  kpi_tile: KpiTileWidget,
  executions_status_chart: ExecutionsStatusChartWidget,
  cost_per_day_chart: CostPerDayChartWidget,
  top_personas_list: TopPersonasListWidget,
  // Phase F.3 round 2 — additional visual shapes for richer composition.
  latency_distribution_chart: LatencyDistributionChartWidget,
  success_rate_gauge: SuccessRateGaugeWidget,
  persona_cost_donut: PersonaCostDonutWidget,
  activity_heatmap: ActivityHeatmapWidget,
  recent_executions_table: RecentExecutionsTableWidget,
};
