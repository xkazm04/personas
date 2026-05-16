import { useEffect, useState, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Terminal as TerminalIcon, Plus, RefreshCw, FolderInput } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { EventName } from '@/lib/eventRegistry';
import { spawnSession } from '@/api/fleet/fleet';
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

  const [showSpawn, setShowSpawn] = useState(false);
  const [cwd, setCwd] = useState('');
  const [spawning, setSpawning] = useState(false);

  // Initial fetch + event subscriptions
  useEffect(() => {
    refresh();

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
  }, [refresh, patchSession, removeLocal]);

  // Group sessions by project label
  const groups = useMemo(() => {
    const map = new Map<string, FleetSession[]>();
    for (const s of sessions) {
      const key = s.projectLabel || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    // Sort sessions within each group by state priority, then by recency.
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
    if (!cwd.trim() || spawning) return;
    setSpawning(true);
    try {
      const id = await spawnSession(cwd.trim());
      setActiveSession(id);
      setShowSpawn(false);
      setCwd('');
      refresh();
    } catch (e) {
      toastCatch('FleetGridPage:spawn', 'Failed to spawn Claude Code session')(e);
    } finally {
      setSpawning(false);
    }
  }, [cwd, spawning, refresh, setActiveSession]);

  const waitingCount = sessions.filter((s) => s.state === 'awaiting_input').length;
  const runningCount = sessions.filter((s) => s.state === 'running').length;

  return (
    <ContentBox>
      <ContentHeader
        icon={<TerminalIcon className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Fleet — Sessions"
        subtitle={
          sessions.length === 0
            ? 'No sessions tracked yet'
            : `${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${waitingCount} waiting · ${runningCount} running`
        }
      />
      <ContentBody>
        {!hooksInstalled && (
          <div className="border border-amber-500/25 rounded-modal bg-amber-500/5 px-3 py-2 mb-3 text-[11px] text-amber-300/90">
            Hooks not installed — sessions you spawn here will work, but live state from external{' '}
            <code className="font-mono">claude</code> runs won't be tracked. Open Settings tab to install.
          </div>
        )}

        <ActionRow>
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowSpawn((v) => !v)}
          >
            {showSpawn ? 'Cancel' : 'Spawn session'}
          </Button>
          <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={refresh}>
            Refresh
          </Button>
        </ActionRow>

        {showSpawn && (
          <div className="mt-2 mb-3 flex items-center gap-2 p-2 border border-primary/15 rounded-modal bg-primary/5">
            <FolderInput className="w-4 h-4 text-foreground/50 flex-shrink-0" />
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="C:\path\to\project"
              className="flex-1 px-3 py-1.5 typo-caption font-mono bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSpawn();
              }}
            />
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              disabled={!cwd.trim() || spawning}
              onClick={handleSpawn}
            >
              {spawning ? 'Spawning…' : 'Spawn'}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-12 gap-3 mt-3 min-h-[400px]">
          {/* Session list (left) */}
          <div className="col-span-4 space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-primary/10 rounded-modal">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-2">
                  <TerminalIcon className="w-6 h-6 text-amber-400/50" />
                </div>
                <p className="text-[11px] text-foreground/60">No sessions yet</p>
                <p className="text-[10px] text-foreground/40 mt-1">Spawn one above, or run claude in any terminal once hooks are installed.</p>
              </div>
            ) : (
              groups.map(([projectLabel, projectSessions]) => (
                <div key={projectLabel}>
                  <h4 className="typo-label uppercase tracking-wider text-foreground/50 px-1 mb-1.5">
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
