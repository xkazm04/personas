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
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { EventName } from '@/lib/eventRegistry';
import { spawnSession } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { FleetSessionCard } from '../FleetSessionCard';
import { FleetTerminalPane } from '../FleetTerminalPane';
import { FleetHooksPill } from '../FleetHooksPill';
import { FleetBroadcastModal } from '../FleetBroadcastModal';
import { DebtText, debtText } from '@/i18n/DebtText';


// Visual order + label + icon + accent for the per-state group headers
// in the left list. Attention-grabbing first; terminal states last.
const GROUP_ORDER: ReadonlyArray<{
  id: FleetSessionState;
  label: string;
  icon: typeof Hourglass;
  /** Tailwind text-color class for the icon + count badge. */
  accent: string;
}> = [
  { id: 'awaiting_input', label: 'Awaiting input', icon: Hourglass,    accent: 'text-violet-400' },
  { id: 'running',        label: 'Working',        icon: Loader2,      accent: 'text-blue-400' },
  { id: 'spawning',       label: 'Spawning',       icon: Sparkle,      accent: 'text-cyan-400' },
  { id: 'idle',           label: 'Idle',           icon: CheckCircle2, accent: 'text-emerald-400' },
  { id: 'stale',          label: 'Stale',          icon: Clock,        accent: 'text-orange-400' },
  { id: 'exited',         label: 'Exited',         icon: Ban,          accent: 'text-foreground' },
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
  const activeSessionId = useSystemStore((s) => s.fleetActiveSessionId);
  const setActiveSession = useSystemStore((s) => s.fleetSetActiveSession);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore(useShallow((s) => s.projects));
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  const [spawning, setSpawning] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((p) => p.id === activeProjectId) : null) ?? null,
    [activeProjectId, projects],
  );

  // Hold the latest refresh/patch/remove in refs so the listener effect can
  // stay attached once for the lifetime of the page. Without this, every
  // sessions-array update would tear down + re-attach the three Tauri
  // listeners (cheap individually but noisy under 5-10 sessions).
  const actionsRef = useRef({ refresh, patchSession, removeLocal });
  actionsRef.current = { refresh, patchSession, removeLocal };

  useEffect(() => {
    actionsRef.current.refresh();
    fetchProjects().catch(silentCatch('FleetGridPage:fetchProjects'));

    const unStateP = listen<{ session_id: string; state: string; reason?: string }>(
      EventName.FLEET_SESSION_STATE,
      (event) => {
        actionsRef.current.patchSession(event.payload.session_id, {
          state: event.payload.state as FleetSessionState,
          stateReason: event.payload.reason ?? null,
          lastActivityMs: BigInt(Date.now()),
        });
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

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

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

  const counts = useMemo(() => {
    let waiting = 0, working = 0, idle = 0, exited = 0;
    for (const s of sessions) {
      if (s.state === 'awaiting_input') waiting += 1;
      else if (s.state === 'running') working += 1;
      else if (s.state === 'idle') idle += 1;
      else if (s.state === 'exited') exited += 1;
    }
    return { waiting, working, idle, exited };
  }, [sessions]);

  // Group sessions by lifecycle state. Order matters: attention-grabbing
  // first (awaiting_input → working → spawning → idle → stale → exited).
  // Within a group, newest activity first.
  const groups = useMemo(() => {
    const buckets = new Map<FleetSessionState, FleetSession[]>();
    for (const s of sessions) {
      const arr = buckets.get(s.state) ?? [];
      arr.push(s);
      buckets.set(s.state, arr);
    }
    for (const arr of buckets.values()) {
      arr.sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs));
    }
    return GROUP_ORDER
      .filter((g) => buckets.has(g.id))
      .map((g) => ({ ...g, sessions: buckets.get(g.id)! }));
  }, [sessions]);

  const subtitle = activeProject
    ? `Project: ${activeProject.name} · ${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${counts.waiting} waiting · ${counts.working} working · ${counts.idle} idle${counts.exited > 0 ? ` · ${counts.exited} exited` : ''}`
    : 'No project selected — pick one in Dev Tools → Projects';

  return (
    <ContentBox>
      <ContentHeader
        icon={<TerminalIcon className="w-5 h-5 text-primary" />}
        title={debtText("auto_fleet_sessions_691c1118")}
        subtitle={subtitle}
        actions={<FleetHooksPill />}
      />
      <ContentBody>
        <div data-testid="fleet-grid-page" />

        <ActionRow>
          <Button
            data-testid="fleet-spawn"
            variant="primary"
            size="sm"
            icon={<Play className="w-3.5 h-3.5" />}
            disabled={!activeProject || spawning}
            onClick={handleSpawn}
            title={activeProject ? `Spawn at ${activeProject.root_path}` : 'Pick a project first'}
          >
            {spawning ? 'Spawning…' : `Spawn in ${activeProject?.name ?? 'project'}`}
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
                        {g.label}
                      </span>
                      <span
                        className={`ml-auto text-[10px] font-semibold ${g.accent}`}
                        aria-label={`${g.sessions.length} session${g.sessions.length === 1 ? '' : 's'}`}
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

          {/* Active terminal pane (right) */}
          <div className="col-span-8 border border-primary/10 rounded-modal overflow-hidden bg-[#0a0a0c]">
            {activeSession ? (
              activeSession.state === 'exited' ? (
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
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-foreground p-6">
                <TerminalIcon className="w-10 h-10 mb-3" />
                <p className="typo-caption"><DebtText k="auto_select_a_session_to_view_its_terminal_921aba6c" /></p>
              </div>
            )}
          </div>
        </div>
      </ContentBody>

      <FleetBroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </ContentBox>
  );
}
