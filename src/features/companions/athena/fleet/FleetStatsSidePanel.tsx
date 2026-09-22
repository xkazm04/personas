import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ExternalLink } from 'lucide-react';
import { tasksPage } from '@/api/devTools/devTools';
import { companionListProactiveMessages, type ProactiveMessage } from '@/api/companion';
import type { DevTask } from '@/lib/bindings/DevTask';
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
 * Live "what Athena has running" content for the companion chat's inner
 * side-panel slot (see `CompanionSidePanel`).
 *
 * Four lanes, ONE shape. Fleet terminals, her own live ops, Run Desk tasks and
 * her scheduled check-ins each render as `<PanelSection>` — a `Title (N)` header,
 * a list of rows beneath it, a divider between sections — because they answer the
 * same question and reading them should not require re-learning the layout per
 * lane. An empty lane keeps its header and says `(0)`: the count IS the empty
 * state, so the panel never grows a second sentence saying what the number
 * already said (the old build wrote a separate "0 sessions" line and hid the
 * runner/schedule lanes entirely at zero, which made "nothing running" and "this
 * lane doesn't exist" indistinguishable).
 *
 * Fleet reads the SAME `fleetSessions` slice the Fleet page and footer cluster
 * read — `useFleetCompanionBridge` (mounted at the app root) keeps it current
 * independent of whether the Fleet page is open, so this panel is never stale
 * just because the operator is looking at chat. Exited sessions are dropped
 * (history, not something to glance at) and the rest are ordered attention-first,
 * the same taxonomy the Monitor ledger and footer popover use.
 *
 * **Schedules are Athena's own, not the app's.** The panel used to count
 * `list_cron_agents`, which is the app-wide persona/trigger schedule registry —
 * nothing to do with her, so the number moved when the operator armed an
 * unrelated cron. Her schedules are the `schedule_proactive` commitments she
 * makes in conversation: `companion_proactive_message` rows carrying a
 * `scheduledFor` (written by `proactive::insert_scheduled`, trigger kind
 * `athena_scheduled`) and still `queued`. That filter is the whole answer to
 * "can we identify Athena's schedules only" — yes, and this is it.
 *
 * **Clicking a row raises the thing it names.** Fleet rows raise that session's
 * terminal via the app-wide fleet grid layer rather than growing a second
 * terminal host; Run Desk rows open Dev Tools → Run Desk. The chat panel lifts
 * itself above the grid overlay, so the conversation stays readable throughout.
 */
export function FleetStatsSidePanel() {
  const { t } = useTranslation();
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

  // Dev Runner active tasks + Athena's own scheduled check-ins — the other two
  // lanes of "what Athena has running". Polled lightly (mount + every 20s);
  // failures stay silent so the panel degrades to the lanes that did load
  // rather than erroring.
  const [runnerTasks, setRunnerTasks] = useState<DevTask[]>([]);
  const [schedules, setSchedules] = useState<ProactiveMessage[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      tasksPage(undefined, ['running', 'queued'], 8)
        .then((p) => {
          if (alive) setRunnerTasks(p.tasks);
        })
        .catch(silentCatch('companion_side_panel_runner_tasks'));
      companionListProactiveMessages(true, 30)
        .then((msgs) => {
          if (alive) {
            setSchedules(
              msgs
                .filter((m) => m.scheduledFor && m.status === 'queued')
                .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
                .slice(0, 8),
            );
          }
        })
        .catch(silentCatch('companion_side_panel_schedules'));
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

  const openFleetPage = () => {
    setSidebarSection('plugins');
    setPluginTab('dev-tools');
    setDevToolsTab('fleet');
  };

  const openRunDesk = () => {
    setSidebarSection('plugins');
    setPluginTab('dev-tools');
    setDevToolsTab('task-runner');
  };

  const openTerminal = (sessionId: string) => {
    const sys = useSystemStore.getState();
    sys.fleetSetActiveSession(sessionId);
    sys.fleetSetGridOpen(true);
  };

  return (
    <CompanionSidePanel
      icon={<FleetShipIcon className="w-3.5 h-3.5 text-foreground" />}
      label={t.plugins.companion.side_panel_fleet_label}
      open={open}
      onToggleOpen={() => setSlot(open ? null : 'fleet')}
      testId="companion-fleet-side-panel"
    >
      <PanelSection
        title={t.plugins.fleet.footer_title}
        count={rows.length}
        first
        testId="companion-side-panel-section-fleet"
      >
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 pb-1" data-testid="companion-fleet-side-panel-chips">
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
        {rows.length > 0 && (
          <ul className="space-y-1" data-testid="companion-fleet-side-panel-list">
            {rows.map((s) => {
              const meta = FLEET_STATE_META.find((m) => m.id === s.state) ?? FLEET_STATE_META[0]!;
              return (
                <PanelRow
                  key={s.id}
                  testId={`companion-fleet-side-panel-row-${s.id}`}
                  dotClass={meta.dot}
                  title={s.name ?? s.projectLabel}
                  titleTooltip={s.projectLabel}
                  status={t.plugins.fleet[meta.labelKey]}
                  statusClass={meta.text}
                  meta={formatAgo(t, Number(s.lastActivityMs), now)}
                  metaTooltip={t.plugins.companion.side_panel_activity_label}
                  onClick={() => openTerminal(s.id)}
                  actionLabel={t.plugins.companion.side_panel_open_terminal}
                />
              );
            })}
          </ul>
        )}
      </PanelSection>

      <PanelSection
        title={t.plugins.companion.slash_label_live_ops}
        count={liveOps.length}
        testId="companion-side-panel-live-ops"
      >
        {liveOps.length > 0 && (
          <ul className="space-y-1">
            {liveOps.map((op) => (
              <PanelRow
                key={op.id8}
                testId={`companion-side-panel-op-${op.id8}`}
                dotClass="bg-primary"
                title={op.intent}
                status={op.status}
                meta={op.duration}
              />
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection
        title={t.sidebar.task_runner}
        count={runnerTasks.length}
        testId="companion-side-panel-runner"
      >
        {runnerTasks.length > 0 && (
          <ul className="space-y-1">
            {runnerTasks.map((task) => (
              <PanelRow
                key={task.id}
                testId={`companion-side-panel-runner-row-${task.id}`}
                dotClass={task.status === 'running' ? 'bg-primary' : 'bg-foreground/40'}
                title={task.title}
                status={task.status}
                meta={
                  task.updated_at
                    ? formatAgo(t, Date.parse(task.updated_at), now)
                    : ''
                }
                metaTooltip={t.plugins.companion.side_panel_activity_label}
                onClick={openRunDesk}
                actionLabel={t.sidebar.task_runner}
              />
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection
        title={t.sidebar.schedules}
        count={schedules.length}
        testId="companion-side-panel-schedules"
      >
        {schedules.length > 0 && (
          <ul className="space-y-1">
            {schedules.map((m) => (
              <PanelRow
                key={m.id}
                testId={`companion-side-panel-schedule-row-${m.id}`}
                dotClass="bg-foreground/40"
                title={m.message}
                status={formatDueClock(m.scheduledFor)}
                meta=""
                titleTooltip={m.message}
              />
            ))}
          </ul>
        )}
      </PanelSection>

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

/**
 * One lane of the panel: `Title (N)` and whatever rows the caller renders.
 * Always rendered, even at zero — the count carries the empty state, so the
 * operator can tell "nothing running" from "this lane isn't here". Every
 * section but the first draws the divider that separates it from the one above.
 */
function PanelSection({
  title,
  count,
  first,
  testId,
  children,
}: {
  title: string;
  count: number;
  first?: boolean;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      data-section-count={count}
      className={first ? '' : 'mt-1.5 pt-1.5 border-t border-secondary/40'}
    >
      <div className="flex items-baseline gap-1 px-1 pb-1">
        <span className="typo-caption text-foreground">{title}</span>
        <span className="typo-caption text-foreground tabular-nums">({count})</span>
      </div>
      {children}
    </div>
  );
}

/**
 * One row, identical across all four lanes: a status dot + primary label on the
 * first line, a status word and a right-aligned meta value on the second.
 * Rendered as a button when the caller has somewhere to send the operator, and
 * as a plain div otherwise — so a non-navigable row never advertises a click
 * that does nothing.
 */
function PanelRow({
  testId,
  dotClass,
  title,
  titleTooltip,
  status,
  statusClass,
  meta,
  metaTooltip,
  onClick,
  actionLabel,
}: {
  testId: string;
  dotClass: string;
  title: string;
  titleTooltip?: string;
  status: string;
  statusClass?: string;
  meta: string;
  metaTooltip?: string;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dotClass}`} aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate typo-caption text-foreground" title={titleTooltip ?? title}>
          {title}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 pl-3">
        <span className={`truncate text-[10px] ${statusClass ?? 'text-foreground'}`}>{status}</span>
        {meta && (
          <span className="shrink-0 text-[10px] text-foreground tabular-nums" title={metaTooltip}>
            {meta}
          </span>
        )}
      </div>
    </>
  );

  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          data-testid={testId}
          title={actionLabel}
          aria-label={actionLabel ? `${title} — ${actionLabel}` : title}
          className="w-full text-left rounded-input bg-secondary/30 hover:bg-secondary/60 px-1.5 py-1 transition-colors focus-ring"
        >
          {body}
        </button>
      ) : (
        <div data-testid={testId} className="rounded-input bg-secondary/20 px-1.5 py-1">
          {body}
        </div>
      )}
    </li>
  );
}

/**
 * Due-time label for a scheduled check-in. Deliberately NOT `RelativeTime` /
 * `formatAgo`: both describe the PAST ("3m ago"), and every row here is by
 * definition in the future, so they would all read "just now". A clock time is
 * the honest rendering — with the date prefixed once it is no longer today.
 * Locale-aware via `Intl`, so it is not English-shaped text needing i18n.
 */
function formatDueClock(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const due = new Date(ms);
  const clock = due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const sameDay =
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate();
  if (sameDay) return clock;
  return `${due.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock}`;
}
