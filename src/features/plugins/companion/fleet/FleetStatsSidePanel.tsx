import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ExternalLink, ListChecks, Clock } from 'lucide-react';
import { tasksPage } from '@/api/devTools/devTools';
import { listCronAgents } from '@/api/pipeline/triggers';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { FleetShipIcon } from '@/features/plugins/fleet/FleetShipIcon';
import { FLEET_STATE_META, fleetStateCounts, laneOfState, FLEET_LANE_ORDER } from '@/features/plugins/fleet/fleetStateMeta';
import { useNowTick, formatAgo } from '@/features/plugins/fleet/relativeAgo';
import { CompanionSidePanel } from '../CompanionSidePanel';
import { useOperativeMemoryStore } from '../orchestration/operativeMemoryStore';
import { parseDigest } from '../orchestration/parseDigest';

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
 *
 * **Clicking a row raises that session's terminal.** It reuses the app-wide
 * fleet grid layer rather than growing a second terminal host: set the active
 * session, raise `fleetGridOpen`, and the existing overlay opens focused on it
 * with its own Back button (and Escape) to return. The chat panel already
 * lifts itself above that overlay, so the conversation stays readable the
 * whole time — glance at the terminal, come back, keep talking.
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
  // Athena's own in-flight operations (dev_improve runs, dispatched
  // orchestration) — surfaced alongside fleet sessions so the panel reflects
  // ALL of Athena's work, not just terminals. Reuses the same digest +
  // parser the Live-ops strip reads; empty string → no rows.
  const opsDigest = useOperativeMemoryStore((s) => s.digest);
  const liveOps = useMemo(() => parseDigest(opsDigest), [opsDigest]);

  // Dev Runner active-task count + armed-schedule count — the other two lanes
  // of "what Athena has running". Polled lightly (mount + every 20s) off the
  // existing L0 counts endpoint and the cron-agent list; failures stay silent
  // so the panel degrades to fleet + live-ops rather than erroring.
  const [runnerActive, setRunnerActive] = useState(0);
  const [scheduleCount, setScheduleCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      tasksPage(undefined, ['running', 'queued'], 1)
        .then((p) => {
          if (alive) setRunnerActive((p.counts.running ?? 0) + (p.counts.queued ?? 0));
        })
        .catch(silentCatch('companion_side_panel_runner_count'));
      listCronAgents()
        .then((agents) => {
          if (alive) setScheduleCount(agents.length);
        })
        .catch(silentCatch('companion_side_panel_schedule_count'));
    };
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

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

  const openTerminal = (sessionId: string) => {
    const sys = useSystemStore.getState();
    sys.fleetSetActiveSession(sessionId);
    sys.fleetSetGridOpen(true);
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

      {/* No empty-state line: the count above already says "0 sessions", and a
          second sentence saying the same thing is the panel talking twice. */}
      {liveCount > 0 && (
        <ul className="space-y-1" data-testid="companion-fleet-side-panel-list">
          {rows.map((s) => {
            const meta = FLEET_STATE_META.find((m) => m.id === s.state) ?? FLEET_STATE_META[0]!;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => openTerminal(s.id)}
                  data-testid={`companion-fleet-side-panel-row-${s.id}`}
                  title={t.plugins.companion.side_panel_open_terminal}
                  aria-label={`${s.name ?? s.projectLabel} — ${t.plugins.companion.side_panel_open_terminal}`}
                  className="w-full text-left rounded-input bg-secondary/30 hover:bg-secondary/60 px-1.5 py-1 transition-colors focus-ring"
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
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {liveOps.length > 0 && (
        <div
          className="mt-1.5 pt-1.5 border-t border-secondary/40"
          data-testid="companion-side-panel-live-ops"
        >
          <div className="px-1 pb-1 typo-caption text-foreground">
            {t.plugins.companion.slash_label_live_ops}
          </div>
          <ul className="space-y-1">
            {liveOps.map((op) => (
              <li
                key={op.id8}
                data-testid={`companion-side-panel-op-${op.id8}`}
                className="rounded-input bg-secondary/20 px-1.5 py-1"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-primary"
                    aria-hidden="true"
                  />
                  <span
                    className="flex-1 min-w-0 truncate typo-caption text-foreground"
                    title={op.intent}
                  >
                    {op.intent}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 pl-3">
                  <span className="truncate text-[10px] text-foreground">{op.status}</span>
                  <span className="shrink-0 text-[10px] text-foreground tabular-nums">
                    {op.duration}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(runnerActive > 0 || scheduleCount > 0) && (
        <div
          className="mt-1.5 pt-1.5 border-t border-secondary/40 flex items-center gap-3 px-1"
          data-testid="companion-side-panel-runner-schedules"
        >
          {runnerActive > 0 && (
            <span
              className="inline-flex items-center gap-1 typo-caption text-foreground tabular-nums"
              title={t.sidebar.task_runner}
              data-testid="companion-side-panel-runner-count"
            >
              <ListChecks className="w-3 h-3" aria-hidden="true" />
              {runnerActive}
            </span>
          )}
          {scheduleCount > 0 && (
            <span
              className="inline-flex items-center gap-1 typo-caption text-foreground tabular-nums"
              title={t.sidebar.schedules}
              data-testid="companion-side-panel-schedule-count"
            >
              <Clock className="w-3 h-3" aria-hidden="true" />
              {scheduleCount}
            </span>
          )}
        </div>
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
