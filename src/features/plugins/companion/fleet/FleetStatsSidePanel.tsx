import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ExternalLink } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { FleetShipIcon } from '@/features/plugins/fleet/FleetShipIcon';
import { FLEET_STATE_META, fleetStateCounts, laneOfState, FLEET_LANE_ORDER } from '@/features/plugins/fleet/fleetStateMeta';
import { useNowTick, formatAgo } from '@/features/plugins/fleet/relativeAgo';
import { CompanionSidePanel } from '../CompanionSidePanel';

/**
 * Live Fleet stats content for the companion chat's inner side-panel slot
 * (see `CompanionSidePanel`). Reads the SAME `fleetSessions` slice the Fleet
 * page and footer cluster read — `useFleetCompanionBridge` (mounted at the
 * app root) keeps it current independent of whether the Fleet page is open,
 * so this panel is never stale just because the operator is looking at chat.
 *
 * Shows: total active session count, a state-breakdown chip row, and a
 * per-session list (project, state, last activity) ordered attention-first
 * (needs-you lanes before working/parked/done) — the same taxonomy the
 * Monitor ledger and footer popover use, so a session never reads
 * differently across surfaces. Exited sessions are dropped from the list
 * (history, not something to glance at) but still count toward the page
 * link's context.
 */
export function FleetStatsSidePanel() {
  const { t, tx } = useTranslation();
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const open = useSystemStore((s) => s.companionSidePanelSlot === 'fleet');
  const setSlot = useSystemStore((s) => s.setCompanionSidePanelSlot);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const now = useNowTick();

  const counts = useMemo(() => fleetStateCounts(sessions), [sessions]);
  const chips = useMemo(
    () => FLEET_STATE_META.filter((m) => m.id !== 'exited' && counts[m.id] > 0),
    [counts],
  );
  const rows = useMemo(() => {
    const laneRank = new Map(FLEET_LANE_ORDER.map((lane, i) => [lane, i]));
    return sessions
      .filter((s) => s.state !== 'exited')
      .sort((a, b) => {
        const laneDiff = (laneRank.get(laneOfState(a.state)) ?? 99) - (laneRank.get(laneOfState(b.state)) ?? 99);
        if (laneDiff !== 0) return laneDiff;
        return Number(b.lastActivityMs) - Number(a.lastActivityMs);
      });
  }, [sessions]);
  const liveCount = rows.length;

  const openFleetPage = () => {
    setSidebarSection('plugins');
    setPluginTab('dev-tools');
    setDevToolsTab('fleet');
  };

  return (
    <CompanionSidePanel
      icon={<FleetShipIcon className="w-3.5 h-3.5 text-foreground" />}
      label={t.plugins.fleet.footer_title}
      open={open}
      onToggleOpen={() => setSlot(open ? null : 'fleet')}
      testId="companion-fleet-side-panel"
    >
      <div className="flex items-baseline justify-between gap-2 px-1 pb-1">
        <span className="typo-caption text-foreground">
          {liveCount === 1
            ? tx(t.plugins.fleet.sessions_one, { count: liveCount })
            : tx(t.plugins.fleet.sessions_other, { count: liveCount })}
        </span>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1 pb-1.5" data-testid="companion-fleet-side-panel-chips">
          {chips.map((m) => (
            <span
              key={m.id}
              data-testid={`companion-fleet-side-panel-chip-${m.id}`}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums ${m.chip} ${m.text}`}
              title={t.plugins.fleet[m.labelKey]}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
              {counts[m.id]}
            </span>
          ))}
        </div>
      )}

      {liveCount === 0 ? (
        <p className="px-1 py-2 typo-caption text-foreground">{t.plugins.fleet.footer_empty}</p>
      ) : (
        <ul className="space-y-1" data-testid="companion-fleet-side-panel-list">
          {rows.map((s) => {
            const meta = FLEET_STATE_META.find((m) => m.id === s.state) ?? FLEET_STATE_META[0]!;
            return (
              <li
                key={s.id}
                data-testid={`companion-fleet-side-panel-row-${s.id}`}
                className="rounded-input bg-secondary/30 px-1.5 py-1"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${meta.dot}`} aria-hidden="true" />
                  <span className="flex-1 min-w-0 truncate typo-caption text-foreground" title={s.projectLabel}>
                    {s.name ?? s.projectLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 pl-3">
                  <span className={`truncate text-[10px] ${meta.text}`}>{t.plugins.fleet[meta.labelKey]}</span>
                  <span
                    className="shrink-0 text-[10px] text-foreground tabular-nums"
                    title={t.plugins.companion.side_panel_activity_label}
                  >
                    {formatAgo(t, Number(s.lastActivityMs), now)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={openFleetPage}
        data-testid="companion-fleet-side-panel-open-page"
        className="mt-1 w-full flex items-center justify-center gap-1 px-1.5 py-1 rounded-input text-[10px] text-foreground hover:bg-secondary/40 transition-colors"
      >
        <ExternalLink className="w-3 h-3" />
        {t.plugins.fleet.footer_open_page}
      </button>
    </CompanionSidePanel>
  );
}
