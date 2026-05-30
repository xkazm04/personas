import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useShallow } from 'zustand/react/shallow';
import {
  Terminal as TerminalIcon,
  Play,
  RefreshCw,
  Send,
  Hourglass,
  Loader2,
  CheckCircle2,
  Clock,
  Ban,
  Sparkle,
  Bell,
  BellOff,
  Search,
  LayoutGrid,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { EventName } from '@/lib/eventRegistry';
import { spawnSession, writeInput } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { FleetSessionCard } from '../FleetSessionCard';
import { FleetTerminalPane } from '../FleetTerminalPane';
import { FleetTerminalOverlay } from '../FleetTerminalOverlay';
import { gcTerminals } from '../fleetTerminalManager';
import { useFleetTerminalConfig } from '../useFleetTerminalConfig';
import { sessionAttention, attentionClass, craftStalePrompt } from '../fleetAttention';
import { FleetHooksPill } from '../FleetHooksPill';
import { FleetBroadcastModal } from '../FleetBroadcastModal';
import { notifyFleetAwaiting } from '@/lib/notifications/notifyFleetAwaiting';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { companionApproveAction, companionRejectAction, companionSendMessage } from '@/api/companion';
import { actionLabel } from '@/features/plugins/companion/athenaLabels';
import { FleetNeedsYouBanner } from '../FleetNeedsYouBanner';
import { FleetSummaryPills } from '../FleetSummaryPills';
import { FleetStatusLegend } from '../FleetStatusLegend';
import type { FleetLabelKey } from '../FleetStatusDots';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText, debtText } from '@/i18n/DebtText';


// Visual order + label + icon + accent for the per-state group headers
// in the left list. Attention-grabbing first; terminal states last.
const GROUP_ORDER: ReadonlyArray<{
  id: FleetSessionState;
  /** plugins.fleet key for the group header label. */
  labelKey: FleetLabelKey;
  icon: typeof Hourglass;
  /** Tailwind text-color class for the icon + count badge. */
  accent: string;
}> = [
  { id: 'awaiting_input', labelKey: 'state_awaiting_input', icon: Hourglass,    accent: 'text-violet-400' },
  { id: 'running',        labelKey: 'state_working',        icon: Loader2,      accent: 'text-blue-400' },
  { id: 'spawning',       labelKey: 'state_spawning',       icon: Sparkle,      accent: 'text-cyan-400' },
  { id: 'idle',           labelKey: 'state_idle',           icon: CheckCircle2, accent: 'text-emerald-400' },
  { id: 'stale',          labelKey: 'state_stale',          icon: Clock,        accent: 'text-orange-400' },
  { id: 'exited',         labelKey: 'state_exited',         icon: Ban,          accent: 'text-foreground' },
];

/**
 * Sessions view — the only Fleet tab the user navigates between (Settings
 * still exists for uninstall + diagnostics). Layout:
 *
 *   ContentHeader: Project · counters                 [Hooks pill]
 *   ActionRow:     [Spawn]  [Broadcast]  [Refresh]
 *   Grid:
 *     Left col 4:  compact session rows (FleetSessionCard, memoized)
 *     Right col 8: live terminal pane for the focused session
 *
 * Optimization choices for 5-10 parallel CLIs:
 *  - useShallow on the sessions read → reference equality bails out the
 *    parent re-render when no sessions changed even if other slice fields
 *    did. Patches that touch one session preserve the other session
 *    objects' identity (see fleetPatchSession), so React.memo on each
 *    card avoids re-rendering the rows that didn't change.
 *  - Only the active session mounts an xterm — other sessions still
 *    receive PTY chunks in Rust but the FE event listener filters by id
 *    in O(1) and discards (only the active pane keeps a Terminal alive).
 *  - Event handlers (state / exited / registry-changed) are attached
 *    once via useEffect with empty-deps + stable refs for the slice
 *    actions; no resubscribe on every render.
 */
export default function FleetGridPage() {
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const refresh = useSystemStore((s) => s.fleetRefresh);
  const patchSession = useSystemStore((s) => s.fleetPatchSession);
  const removeLocal = useSystemStore((s) => s.fleetRemoveSessionLocal);
  const recordTransition = useSystemStore((s) => s.fleetRecordTransition);
  const activeSessionId = useSystemStore((s) => s.fleetActiveSessionId);
  const setActiveSession = useSystemStore((s) => s.fleetSetActiveSession);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore(useShallow((s) => s.projects));
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const notifyAwaiting = useSystemStore((s) => s.fleetNotifyAwaiting);
  const setNotifyAwaiting = useSystemStore((s) => s.fleetSetNotifyAwaiting);
  const companionApprovals = useCompanionStore(useShallow((s) => s.approvals));
  const removeApproval = useCompanionStore((s) => s.removeApproval);

  const { t, tx } = useTranslation();

  // Keep the persisted terminal settings (font, copy-on-select, theme) applied
  // to every live managed terminal, and track the app's light/dark appearance.
  useFleetTerminalConfig();

  const [spawning, setSpawning] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  // Fullscreen terminal grid overlay (transient — minimizing returns to the
  // single-pane view showing the last-selected session).
  const [gridOpen, setGridOpen] = useState(false);
  // Session ids with an in-flight "Ask Athena" proactive turn (drives the
  // tile's "thinking" affordance until the turn resolves).
  const [askingAthena, setAskingAthena] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FleetSessionState | null>(null);
  const [query, setQuery] = useState('');

  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((p) => p.id === activeProjectId) : null) ?? null,
    [activeProjectId, projects],
  );

  // Hold the latest refresh/patch/remove in refs so the listener effect can
  // stay attached once for the lifetime of the page. Without this, every
  // sessions-array update would tear down + re-attach the three Tauri
  // listeners (cheap individually but noisy under 5-10 sessions).
  const actionsRef = useRef({ refresh, patchSession, removeLocal, recordTransition });
  actionsRef.current = { refresh, patchSession, removeLocal, recordTransition };

  // Refs read by the once-attached listener: the live notify preference, a
  // snapshot of sessions (to resolve a name for the alert body), and the set
  // of ids we've already alerted on so a re-emitted awaiting_input event
  // doesn't double-notify. `t`/`tx` are stable proxies, safe to close over.
  const notifyRef = useRef(notifyAwaiting);
  notifyRef.current = notifyAwaiting;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const awaitingSeenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    actionsRef.current.refresh();
    fetchProjects().catch(silentCatch('FleetGridPage:fetchProjects'));

    const unStateP = listen<{ session_id: string; state: string; reason?: string }>(
      EventName.FLEET_SESSION_STATE,
      (event) => {
        const { session_id, state, reason } = event.payload;
        actionsRef.current.patchSession(session_id, {
          state: state as FleetSessionState,
          stateReason: reason ?? null,
          lastActivityMs: BigInt(Date.now()),
        });
        actionsRef.current.recordTransition(session_id, state as FleetSessionState);

        // Desktop "push" alert on entering awaiting_input — once per entry.
        const seen = awaitingSeenRef.current;
        if (state === 'awaiting_input') {
          if (!seen.has(session_id)) {
            seen.add(session_id);
            if (notifyRef.current) {
              const sess = sessionsRef.current.find((s) => s.id === session_id);
              const name = sess?.name ?? sess?.projectLabel ?? '';
              notifyFleetAwaiting(
                t.plugins.fleet.notify_title,
                tx(t.plugins.fleet.notify_body, { name }),
              );
            }
          }
        } else {
          seen.delete(session_id);
        }
      },
    );

    const unExitedP = listen<{ session_id: string; exit_code: number | null }>(
      EventName.FLEET_SESSION_EXITED,
      (event) => {
        actionsRef.current.patchSession(event.payload.session_id, {
          state: 'exited' as FleetSessionState,
          exitCode: event.payload.exit_code,
          lastActivityMs: BigInt(Date.now()),
        });
        actionsRef.current.recordTransition(event.payload.session_id, 'exited' as FleetSessionState);
      },
    );

    const unRegistryP = listen<{ kind: 'added' | 'removed' | 'updated'; session_id: string }>(
      EventName.FLEET_REGISTRY_CHANGED,
      (event) => {
        if (event.payload.kind === 'removed') {
          actionsRef.current.removeLocal(event.payload.session_id);
        } else {
          // Added or updated → re-fetch to get the full row.
          actionsRef.current.refresh();
        }
      },
    );

    return () => {
      unStateP.then((fn) => fn());
      unExitedP.then((fn) => fn());
      unRegistryP.then((fn) => fn());
    };
    // Effect intentionally has no deps — actions live behind a ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable callbacks so React.memo on FleetSessionCard isn't broken by a
  // new closure identity every render.
  const handleActivate = useCallback(
    (id: string) => setActiveSession(id),
    [setActiveSession],
  );
  const handleRemovedLocal = useCallback(
    (id: string) => removeLocal(id),
    [removeLocal],
  );

  // Inline reply from the "Needs you" banner — write the line to the
  // session's PTY (trailing \r submits, mirroring the broadcast composer).
  const handleReply = useCallback(async (id: string, replyText: string) => {
    try {
      await writeInput(id, `${replyText}\r`);
    } catch (e) {
      toastCatch('FleetGridPage:reply', 'Failed to send reply to session')(e);
    }
  }, []);

  // Companion approvals folded into the same "Needs you" surface — the
  // idea's "approve/reject companion actions" half. Read-only on the
  // companion store except for removing the row once resolved.
  const approvalItems = useMemo(
    () =>
      companionApprovals.map((a) => ({
        id: a.id,
        label: actionLabel(t, a.action),
        rationale: a.rationale,
      })),
    [companionApprovals, t],
  );

  const handleApprove = useCallback(async (id: string) => {
    try {
      await companionApproveAction(id);
      removeApproval(id);
    } catch (e) {
      toastCatch('FleetGridPage:approve', 'Failed to approve action')(e);
    }
  }, [removeApproval]);

  const handleRejectApproval = useCallback(async (id: string) => {
    try {
      await companionRejectAction(id);
      removeApproval(id);
    } catch (e) {
      toastCatch('FleetGridPage:rejectApproval', 'Failed to reject action')(e);
    }
  }, [removeApproval]);

  // Ask Athena to reason about one stale session and (if there's a clear
  // winner) propose writing the next step into its terminal. Her proposal
  // returns as an on-tile approval via the companion approvals event.
  const handleAskAthena = useCallback(async (session: FleetSession) => {
    setAskingAthena((prev) => new Set(prev).add(session.id));
    try {
      await companionSendMessage(craftStalePrompt(session));
    } catch (e) {
      toastCatch('FleetGridPage:askAthena', 'Failed to reach Athena')(e);
    } finally {
      setAskingAthena((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
    }
  }, []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // Sessions that can host a live terminal (everything but exited) — drives
  // the tiled grid view. Most-recently-active first.
  const liveSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.state !== 'exited')
        .sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs)),
    [sessions],
  );

  // Reap managed terminals whose session disappeared (removed from the
  // registry). Terminals persist across active-session switches and even
  // across leaving/returning to the Fleet page — only an actual removal
  // disposes one. Runs on the sessions list, never on unmount.
  useEffect(() => {
    gcTerminals(new Set(sessions.map((s) => s.id)));
  }, [sessions]);

  // If every session exits/closes while the grid overlay is up, minimize back
  // to the single view rather than showing an empty fullscreen grid.
  useEffect(() => {
    if (gridOpen && liveSessions.length === 0) setGridOpen(false);
  }, [gridOpen, liveSessions.length]);

  const handleSpawn = useCallback(async () => {
    if (!activeProject || spawning) return;
    setSpawning(true);
    try {
      const id = await spawnSession(activeProject.root_path);
      setActiveSession(id);
      refresh();
    } catch (e) {
      toastCatch('FleetGridPage:spawn', 'Failed to spawn Claude Code session')(e);
    } finally {
      setSpawning(false);
    }
  }, [activeProject, spawning, refresh, setActiveSession]);

  // Count sessions in every lifecycle state — feeds the summary pills and
  // the header subtitle. A full Record keeps the pill component honest about
  // states the subtitle previously ignored (spawning, stale).
  const stateCounts = useMemo(() => {
    const c: Record<FleetSessionState, number> = {
      spawning: 0, running: 0, awaiting_input: 0, idle: 0, stale: 0, exited: 0,
    };
    for (const s of sessions) c[s.state] += 1;
    return c;
  }, [sessions]);

  const toggleFilter = useCallback(
    (state: FleetSessionState) => setFilter((cur) => (cur === state ? null : state)),
    [],
  );

  // Sessions blocked on the operator — drives the "Needs you" attention
  // banner. Newest activity first so the most recent prompt leads.
  const waitingSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.state === 'awaiting_input')
        .sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs)),
    [sessions],
  );

  // Cycle focus through the waiting sessions, wrapping around from the
  // currently-focused one — fast triage when several are blocked at once.
  const handleCycleNext = useCallback(() => {
    if (waitingSessions.length === 0) return;
    const idx = waitingSessions.findIndex((s) => s.id === activeSessionId);
    const next = waitingSessions[(idx + 1) % waitingSessions.length];
    if (next) setActiveSession(next.id);
  }, [waitingSessions, activeSessionId, setActiveSession]);

  // Group sessions by lifecycle state. Order matters: attention-grabbing
  // first (awaiting_input → working → spawning → idle → stale → exited).
  // Within a group, newest activity first.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const buckets = new Map<FleetSessionState, FleetSession[]>();
    for (const s of sessions) {
      if (q && !`${s.projectLabel} ${s.name ?? ''}`.toLowerCase().includes(q)) continue;
      const arr = buckets.get(s.state) ?? [];
      arr.push(s);
      buckets.set(s.state, arr);
    }
    for (const arr of buckets.values()) {
      arr.sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs));
    }
    return GROUP_ORDER
      .filter((g) => buckets.has(g.id) && (filter === null || g.id === filter))
      .map((g) => ({ ...g, sessions: buckets.get(g.id)! }));
  }, [sessions, filter, query]);

  const sessionCount =
    sessions.length === 1
      ? tx(t.plugins.fleet.sessions_one, { count: sessions.length })
      : tx(t.plugins.fleet.sessions_other, { count: sessions.length });
  const subtitle = activeProject
    ? `${activeProject.name} · ${sessionCount}`
    : t.plugins.fleet.no_project_hint;

  return (
    <ContentBox>
      <ContentHeader
        icon={<TerminalIcon className="w-5 h-5 text-primary" />}
        title={debtText("auto_fleet_sessions_691c1118")}
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="fleet-notify-toggle"
              aria-pressed={notifyAwaiting}
              aria-label={notifyAwaiting ? t.plugins.fleet.notify_disable : t.plugins.fleet.notify_enable}
              title={notifyAwaiting ? t.plugins.fleet.notify_disable : t.plugins.fleet.notify_enable}
              onClick={() => setNotifyAwaiting(!notifyAwaiting)}
              className="flex items-center rounded-interactive px-1.5 py-1 text-foreground transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
            >
              {notifyAwaiting
                ? <Bell className="w-3.5 h-3.5" />
                : <BellOff className="w-3.5 h-3.5" />}
            </button>
            <FleetStatusLegend />
            <FleetHooksPill />
          </div>
        }
      />
      <ContentBody>
        <div data-testid="fleet-grid-page" />

        <FleetSummaryPills counts={stateCounts} activeFilter={filter} onToggle={toggleFilter} />

        <FleetNeedsYouBanner
          waiting={waitingSessions}
          onJump={handleActivate}
          onReply={handleReply}
          approvals={approvalItems}
          onApprove={handleApprove}
          onReject={handleRejectApproval}
          onCycleNext={handleCycleNext}
        />

        {sessions.length > 0 && waitingSessions.length === 0 && approvalItems.length === 0 && (
          <div
            data-testid="fleet-all-clear"
            className="mb-3 inline-flex items-center gap-1.5 rounded-card border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 typo-caption text-emerald-300"
          >
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            {t.plugins.fleet.all_clear}
          </div>
        )}

        <ActionRow>
          <Button
            data-testid="fleet-grid-open"
            variant="secondary"
            size="sm"
            icon={<LayoutGrid className="w-3.5 h-3.5" />}
            disabled={liveSessions.length === 0}
            onClick={() => setGridOpen(true)}
            title={t.plugins.fleet.grid_open_aria}
          >
            {t.plugins.fleet.view_grid}
          </Button>
          <Button
            data-testid="fleet-spawn"
            variant="primary"
            size="sm"
            icon={<Play className="w-3.5 h-3.5" />}
            disabled={!activeProject || spawning}
            onClick={handleSpawn}
            title={activeProject ? `Spawn at ${activeProject.root_path}` : 'Pick a project first'}
          >
            {spawning ? 'Spawning…' : 'Spawn'}
          </Button>
          <Button
            data-testid="fleet-broadcast-open"
            variant="secondary"
            size="sm"
            icon={<Send className="w-3.5 h-3.5" />}
            disabled={sessions.filter((s) => s.state !== 'exited').length === 0}
            onClick={() => setBroadcastOpen(true)}
          >
            Broadcast
          </Button>
          <Button
            data-testid="fleet-grid-refresh"
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={refresh}
          >
            Refresh
          </Button>
        </ActionRow>

        <div className="grid grid-cols-12 gap-3 mt-3 min-h-[400px]">
          {/* Compact session list, grouped by state (left).
              Group header → divider → rows. Empty groups are filtered
              out by `groups` so the dividers never strand a zero-row
              section. */}
          <div
            data-testid="fleet-session-list"
            className="col-span-4 max-h-[calc(100vh-300px)] overflow-y-auto pr-1"
          >
            {sessions.length > 1 && (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-foreground" aria-hidden="true" />
                <input
                  type="text"
                  data-testid="fleet-session-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t.plugins.fleet.search_placeholder}
                  placeholder={t.plugins.fleet.search_placeholder}
                  className="w-full rounded-input border border-primary/10 bg-secondary/40 py-1 pl-7 pr-2 text-[12px] text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                />
              </div>
            )}
            {sessions.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-primary/10 rounded-modal">
                <div className="w-10 h-10 rounded-modal bg-primary/8 border border-primary/15 flex items-center justify-center mx-auto mb-2">
                  <TerminalIcon className="w-5 h-5 text-foreground" />
                </div>
                <p className="text-[11px] text-foreground"><DebtText k="auto_no_sessions_yet_9d7789c9" /></p>
                <p className="text-[10px] text-foreground mt-1 px-3">
                  {activeProject
                    ? 'Click Spawn to launch claude, or run it externally once hooks are installed.'
                    : 'Pick a project in Dev Tools → Projects.'}
                </p>
              </div>
            ) : groups.length === 0 ? (
              <div className="text-center py-6 text-[11px] text-foreground" data-testid="fleet-no-matches">
                {t.plugins.fleet.search_no_matches}
              </div>
            ) : (
              groups.map((g, idx) => {
                const GroupIcon = g.icon;
                const isFirst = idx === 0;
                return (
                  <div
                    key={g.id}
                    data-testid={`fleet-group-${g.id}`}
                    className={isFirst ? '' : 'pt-2 mt-2 border-t border-primary/10'}
                  >
                    <div className="flex items-center gap-1.5 px-2 mb-1">
                      <GroupIcon className={`w-3 h-3 ${g.accent} ${g.id === 'running' ? 'animate-spin' : ''}`} />
                      <span className="typo-label uppercase tracking-wider text-foreground">
                        {t.plugins.fleet[g.labelKey]}
                      </span>
                      <span
                        className={`ml-auto text-[10px] font-semibold ${g.accent}`}
                        aria-label={
                          g.sessions.length === 1
                            ? tx(t.plugins.fleet.sessions_one, { count: g.sessions.length })
                            : tx(t.plugins.fleet.sessions_other, { count: g.sessions.length })
                        }
                      >
                        {g.sessions.length}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {g.sessions.map((s) => (
                        <FleetSessionCard
                          key={s.id}
                          session={s}
                          isActive={s.id === activeSessionId}
                          onActivate={handleActivate}
                          onRemovedLocal={handleRemovedLocal}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Terminal area (right) — single focused pane. The fullscreen grid
              overlay (Grid button) takes over for multi-session viewing; while
              it's open we unmount this pane so the two don't contend for the
              same managed terminal's holder element. */}
          <div className="col-span-8 min-h-0">
            {gridOpen ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-foreground p-6 border border-primary/10 rounded-modal bg-[#0a0a0c]">
                <LayoutGrid className="w-10 h-10 mb-3 text-primary" />
                <p className="typo-caption">{t.plugins.fleet.grid_active_hint}</p>
              </div>
            ) : activeSession ? (
              <div
                className={`h-full border rounded-modal overflow-hidden bg-[#0a0a0c] ${
                  attentionClass(sessionAttention(activeSession)) || 'border-primary/10'
                }`}
              >
                {activeSession.state === 'exited' ? (
                  <div className="h-full flex flex-col items-center justify-center text-foreground p-6">
                    <p className="typo-caption mb-2"><DebtText k="auto_session_exited_a34ee64f" /></p>
                    <p className="text-[10px]">
                      {activeSession.exitCode !== null
                        ? `Exit code ${activeSession.exitCode}`
                        : 'Process exited unexpectedly'}
                    </p>
                  </div>
                ) : (
                  <FleetTerminalPane sessionId={activeSession.id} />
                )}
              </div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-foreground p-6 border border-primary/10 rounded-modal bg-[#0a0a0c]">
                <TerminalIcon className="w-10 h-10 mb-3" />
                <p className="typo-caption"><DebtText k="auto_select_a_session_to_view_its_terminal_921aba6c" /></p>
              </div>
            )}
          </div>
        </div>
      </ContentBody>

      <FleetBroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />

      <FleetTerminalOverlay
        open={gridOpen}
        sessions={liveSessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSession}
        onClose={() => setGridOpen(false)}
        approvals={companionApprovals}
        askingSessionIds={askingAthena}
        onApprove={handleApprove}
        onReject={handleRejectApproval}
        onAskAthena={handleAskAthena}
      />
    </ContentBox>
  );
}
