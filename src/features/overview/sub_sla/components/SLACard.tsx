import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaSlaStats } from '@/api/overview/sla';
import { formatPercent, formatDuration, formatMtbf, SLA_CARD_COLOR_CLASSES, type SlaMetricColor } from '../libs/slaHelpers';
import { rateToHealth, HEALTH_STATUS_TOKEN } from '@/lib/design/statusTokens';
import { Numeric } from '@/features/shared/components/display/Numeric';

export function SlaCard({ label, value, sub, color, icon, tooltip, scope }: {
  label: string; value: string; sub: string; color: string; icon: React.ReactNode;
  /** Optional native tooltip — used to surface the metric's denominator
   *  policy (e.g. "cancelled runs are excluded") so a user comparing
   *  this number to an external SRE dashboard can see why the values
   *  may differ. */
  tooltip?: string;
  /** Optional scope badge (e.g. "All-time"). When set, renders a small
   *  pill in the top-right corner of the card so users can tell at a
   *  glance which numbers are bound to the selected time window and
   *  which are not. The healing summary cards are all-time / snapshot;
   *  see `get_sla_dashboard` in `sla.rs` for the policy. */
  scope?: string;
}) {
  const cls = SLA_CARD_COLOR_CLASSES[color as SlaMetricColor] ?? SLA_CARD_COLOR_CLASSES.emerald;

  return (
    <div className={`rounded-modal border p-4 relative shadow-elevation-1 ${cls}`} title={tooltip}>
      {scope && (
        <span className="absolute top-2 right-2 typo-caption font-mono uppercase tracking-wider opacity-60 px-1.5 py-0.5 rounded-full border border-current/20 bg-current/5">
          {scope}
        </span>
      )}
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="typo-label font-mono opacity-80">{label}</span>
      </div>
      <div className="typo-data-lg tabular-nums">{value}</div>
      <div className="typo-caption opacity-60 mt-1">{sub}</div>
    </div>
  );
}

/**
 * Per-agent reliability matrix: one row per persona, one column per metric —
 * everything visible and comparable at once, the same spirit as the Leaderboard
 * and Health matrix views (`LeaderboardMatrixView`). Replaces the old
 * expand-per-row card list, which only ever showed one agent's detail at a
 * time. Every field `PersonaRow`'s expanded panel used to hide behind a click
 * is now its own column — no detail modal needed, `PersonaSlaStats` is small
 * enough to fit as a row.
 */
export function SlaMatrixTable({ rows, onSelectAgent }: {
  rows: PersonaSlaStats[];
  /** Optional row-click handler (e.g. deep-link into the agent's own page). */
  onSelectAgent?: (personaId: string) => void;
}) {
  const { t } = useTranslation();
  const sc = t.overview.sla_card;
  const sla = t.overview.sla;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr className="bg-primary/[0.03]">
            <th className="px-3 py-2 text-left typo-caption font-semibold text-foreground">{sc.agent}</th>
            <th className="px-2 py-2 text-center typo-caption font-semibold text-foreground">{sla.success_rate}</th>
            <th className="px-2 py-2 text-center typo-caption font-semibold text-foreground">{sc.runs}</th>
            <th className="px-2 py-2 text-center typo-caption font-semibold text-foreground">{sla.metric_avg_latency}</th>
            <th className="px-2 py-2 text-center typo-caption font-semibold text-foreground">{sla.metric_p95_latency}</th>
            <th className="px-2 py-2 text-center typo-caption font-semibold text-foreground">{sla.metric_cost}</th>
            <th className="px-2 py-2 text-center typo-caption font-semibold text-foreground">{sla.metric_mtbf}</th>
            <th className="px-2 py-2 text-center typo-caption font-semibold text-foreground">{sc.auto_healed}</th>
            <th className="px-2 py-2 text-center typo-caption font-semibold text-foreground">{sc.streak}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((stats) => {
            const health = rateToHealth(stats.success_rate);
            const rateHealth = HEALTH_STATUS_TOKEN[health];
            const capped = stats.consecutive_failures >= stats.consecutive_failure_lookback;
            const streakLabel = stats.consecutive_failures > 0
              ? (capped ? `${stats.consecutive_failure_lookback}+` : `${stats.consecutive_failures}`)
              : '—';
            return (
              <tr
                key={stats.persona_id}
                onClick={onSelectAgent ? () => onSelectAgent(stats.persona_id) : undefined}
                className={`hover:bg-primary/[0.03] transition-colors ${onSelectAgent ? 'cursor-pointer' : ''}`}
              >
                <td className="px-3 py-1.5 align-middle border-t border-primary/[0.06]">
                  <span className="typo-body font-medium text-foreground truncate block max-w-[200px]">{stats.persona_name}</span>
                </td>
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  <span className={`typo-body tabular-nums font-semibold ${rateHealth.text}`}>{formatPercent(stats.success_rate)}</span>
                </td>
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  <span className="typo-body tabular-nums text-foreground">{String(stats.total_executions)}</span>
                </td>
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  <span className="typo-body tabular-nums text-foreground">{formatDuration(stats.avg_duration_ms)}</span>
                </td>
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  <span className="typo-body tabular-nums text-foreground">{stats.p95_duration_ms != null ? formatDuration(stats.p95_duration_ms) : 'N/A'}</span>
                </td>
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  <Numeric value={stats.total_cost_usd} unit="usd" className="typo-body tabular-nums text-foreground" />
                </td>
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  <span className="typo-body tabular-nums text-foreground">{stats.mtbf_seconds != null ? formatMtbf(stats.mtbf_seconds) : 'N/A'}</span>
                </td>
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  <span className="typo-body tabular-nums text-foreground">{String(stats.auto_healed_count)}</span>
                </td>
                <td className="px-2 py-1.5 text-center align-middle border-t border-primary/[0.06]">
                  <span
                    className={`typo-body tabular-nums ${stats.consecutive_failures > 0 ? 'text-status-error' : 'text-foreground'}`}
                    title={capped ? `At least ${stats.consecutive_failure_lookback} consecutive failures (lookback cap reached)` : undefined}
                  >
                    {streakLabel}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DailyTrendChart({ points }: { points: { date: string; success_rate: number; total: number }[] }) {
  if (points.length === 0) return null;
  const barWidth = Math.max(4, Math.min(16, Math.floor(600 / points.length)));

  return (
    <div className="flex items-end gap-px h-24 overflow-x-auto overflow-y-hidden">
      {points.map((p, i) => {
        const color = `${HEALTH_STATUS_TOKEN[rateToHealth(p.success_rate)].icon}/60`;
        return (
          <div key={i} className="flex flex-col items-center justify-end flex-shrink-0" style={{ width: barWidth }} title={`${p.date}: ${formatPercent(p.success_rate)} (${p.total} runs)`}>
            <div
              className={`animate-fade-in w-full rounded-t-interactive ${color}`}
              // Bar height encodes the success rate (0–1). Without an explicit
              // height every bar rendered at 0px and the trend chart was blank.
              // 2% floor keeps a low/zero-rate day visible as a sliver.
              style={{ height: `${Math.max(2, p.success_rate * 100)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
