import { useEffect, useState, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Terminal as TerminalIcon,
  Play,
  RefreshCw,
  FolderKanban,
  AlertCircle,
  Download,
  CheckCircle2,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { EventName } from '@/lib/eventRegistry';
import { spawnSession, installHooks } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { FleetSessionCard } from '../FleetSessionCard';
import { FleetTerminalPane } from '../FleetTerminalPane';
import { STATE_PRIORITY } from '../FleetStatusBadge';

export default function FleetGridPage() {
  const sessions = useSystemStore((s) => s.fleetSessions);
  const refresh = useSystemStore((s) => s.fleetRefresh);
  const patchSession = useSystemStore((s) => s.fleetPatchSession);
  const removeLocal = useSystemStore((s) => s.fleetRemoveSessionLocal);
  const activeSessionId = useSystemStore((s) => s.fleetActiveSessionId);
  const setActiveSession = useSystemStore((s) => s.fleetSetActiveSession);
  const hooksInstalled = useSystemStore((s) => s.fleetHooksInstalled);
  const hookPort = useSystemStore((s) => s.fleetHookPort);
  const applyHookStatus = useSystemStore((s) => s.fleetApplyHookStatus);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  const [spawning, setSpawning] = useState(false);
  const [installing, setInstalling] = useState(false);

  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((p) => p.id === activeProjectId) : null) ?? null,
    [activeProjectId, projects],
  );

  // Initial fetch + project list + event subscriptions
  useEffect(() => {
    refresh();
    fetchProjects().catch(silentCatch('FleetGridPage:fetchProjects'));

    const unStateP = listen<{ session_id: string; state: string; reason?: string }>(
      EventName.FLEET_SESSION_STATE,
      (event) => {
        patchSession(event.payload.session_id, {
          state: event.payload.state as FleetSessionState,
          stateReason: event.payload.reason ?? null,
          lastActivityMs: BigInt(Date.now()),
        });
      },
    );

    const unExitedP = listen<{ session_id: string; exit_code: number | null }>(
      EventName.FLEET_SESSION_EXITED,
      (event) => {
        patchSession(event.payload.session_id, {
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
          removeLocal(event.payload.session_id);
        } else {
          // Added or updated — re-fetch to get the full row.
          refresh();
        }
      },
    );

    return () => {
      unStateP.then((fn) => fn());
      unExitedP.then((fn) => fn());
      unRegistryP.then((fn) => fn());
    };
  }, [refresh, patchSession, removeLocal, fetchProjects]);

  // Group sessions by project label
  const groups = useMemo(() => {
    const map = new Map<string, FleetSession[]>();
    for (const s of sessions) {
      const key = s.projectLabel || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const pa = STATE_PRIORITY[a.state] ?? 0;
        const pb = STATE_PRIORITY[b.state] ?? 0;
        if (pa !== pb) return pb - pa;
        return Number(b.lastActivityMs) - Number(a.lastActivityMs);
      });
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions]);

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

  const handleInstallHooks = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const status = await installHooks();
      applyHookStatus(status);
      refresh();
    } catch (e) {
      toastCatch('FleetGridPage:install', 'Failed to install Claude Code hooks')(e);
    } finally {
      setInstalling(false);
    }
  }, [installing, applyHookStatus, refresh]);

  const waitingCount = sessions.filter((s) => s.state === 'awaiting_input').length;
  const runningCount = sessions.filter((s) => s.state === 'running').length;

  return (
    <ContentBox>
      <ContentHeader
        icon={<TerminalIcon className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Fleet — Sessions"
        subtitle={
          activeProject
            ? `Project: ${activeProject.name} · ${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${waitingCount} waiting · ${runningCount} running`
            : 'No project selected — pick one in Dev Tools → Projects'
        }
      />
      <ContentBody>
        <div data-testid="fleet-grid-page" />

        {/* Install banner — prominent so the user can act without
            navigating to Settings. Hidden once installed. */}
        {!hooksInstalled && (
          <div
            data-testid="fleet-grid-install-banner"
            className="border border-amber-500/30 rounded-modal bg-amber-500/8 px-4 py-3 mb-3 flex items-start gap-3"
          >
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="typo-caption font-medium text-amber-300 mb-1">
                Claude Code hooks not installed
              </p>
              <p className="text-[11px] text-foreground/70 leading-relaxed">
                Without hooks, sessions you spawn here work but live state from external{' '}
                <code className="font-mono">claude</code> runs (sessions started from any other
                terminal) won't be tracked. One click patches{' '}
                <code className="font-mono">~/.claude/settings.json</code> with six tagged hook
                entries; uninstall any time from the Settings tab.
              </p>
            </div>
            <Button
              data-testid="fleet-grid-install-hooks"
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              disabled={installing}
              onClick={handleInstallHooks}
            >
              {installing ? 'Installing…' : 'Install hooks'}
            </Button>
          </div>
        )}

        {hooksInstalled && hookPort > 0 && (
          <div
            data-testid="fleet-grid-install-ok"
            className="border border-emerald-500/20 rounded-modal bg-emerald-500/5 px-3 py-1.5 mb-3 flex items-center gap-2 text-[11px] text-emerald-300/90"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            Hooks installed → <code className="font-mono">/fleet/hooks/* on port {hookPort}</code>.
            External <code className="font-mono">claude</code> runs are tracked.
          </div>
        )}

        <ActionRow>
          <Button
            data-testid="fleet-spawn"
            variant="accent"
            accentColor="amber"
            size="sm"
            icon={<Play className="w-3.5 h-3.5" />}
            disabled={!activeProject || spawning}
            onClick={handleSpawn}
            title={activeProject ? `Spawn at ${activeProject.root_path}` : 'Pick a project first'}
          >
            {spawning ? 'Spawning…' : `Spawn in ${activeProject?.name ?? 'project'}`}
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

        {activeProject && (
          <p
            data-testid="fleet-active-project-path"
            className="text-[10px] font-mono text-foreground/40 mt-1 mb-3 truncate"
            title={activeProject.root_path}
          >
            cwd: {activeProject.root_path}
          </p>
        )}

        <div className="grid grid-cols-12 gap-3 mt-3 min-h-[400px]">
          {/* Session list (left) */}
          <div className="col-span-4 space-y-3 max-h-[calc(100vh-320px)] overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-primary/10 rounded-modal">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-2">
                  <TerminalIcon className="w-6 h-6 text-amber-400/50" />
                </div>
                <p className="text-[11px] text-foreground/60">No sessions yet</p>
                <p className="text-[10px] text-foreground/40 mt-1 px-3">
                  {activeProject
                    ? 'Click Spawn to launch claude in this project, or run it externally once hooks are installed.'
                    : 'Pick a project in Dev Tools → Projects, then come back here.'}
                </p>
              </div>
            ) : (
              groups.map(([projectLabel, projectSessions]) => (
                <div key={projectLabel}>
                  <h4 className="typo-label uppercase tracking-wider text-foreground/50 px-1 mb-1.5 flex items-center gap-1.5">
                    <FolderKanban className="w-3 h-3" />
                    {projectLabel}
                  </h4>
                  <div className="space-y-1.5">
                    {projectSessions.map((s) => (
                      <FleetSessionCard key={s.id} session={s} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Active terminal pane (right) */}
          <div className="col-span-8 border border-primary/10 rounded-modal overflow-hidden bg-[#0a0a0c]">
            {activeSession ? (
              activeSession.state === 'exited' ? (
                <div className="h-full flex flex-col items-center justify-center text-foreground/60 p-6">
                  <p className="typo-caption mb-2">Session exited</p>
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
              <div className="h-full flex flex-col items-center justify-center text-foreground/40 p-6">
                <TerminalIcon className="w-10 h-10 mb-3 text-foreground/20" />
                <p className="typo-caption">Select a session to view its terminal</p>
              </div>
            )}
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
