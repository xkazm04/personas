import { useState, useCallback, useRef, useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { cancelSetupInstall, startSetupInstall } from "@/api/system/system";
import { silentCatch } from "@/lib/silentCatch";


export type InstallTarget = 'node' | 'claude_cli';
export type InstallPhase = 'idle' | 'downloading' | 'installing' | 'completed' | 'failed';

export interface InstallState {
  phase: InstallPhase;
  progressPct: number;
  outputLines: string[];
  error: string | null;
  manualCommand: string | null;
}

interface SetupOutputPayload {
  install_id: string;
  target: InstallTarget;
  line: string;
}

interface SetupStatusPayload {
  install_id: string;
  target: InstallTarget;
  status: string;
  progress_pct: number | null;
  error: string | null;
  manual_command: string | null;
}

function defaultState(): InstallState {
  return { phase: 'idle', progressPct: 0, outputLines: [], error: null, manualCommand: null };
}

/**
 * Ring cap on the retained install transcript. A looping/verbose npm install
 * used to accumulate every SETUP_OUTPUT line in React state forever while the
 * only consumer (`InstallButton`) renders the LAST line — an unbounded buffer
 * behind a one-line view. 500 matches the cap `matrixBuildSlice` already uses
 * for the same kind of stream.
 */
export const MAX_INSTALL_OUTPUT_LINES = 500;

function appendLine(lines: string[], line: string): string[] {
  const next = [...lines, line];
  return next.length > MAX_INSTALL_OUTPUT_LINES
    ? next.slice(next.length - MAX_INSTALL_OUTPUT_LINES)
    : next;
}

const INSTALL_PHASES: readonly InstallPhase[] = [
  'idle',
  'downloading',
  'installing',
  'completed',
  'failed',
];

/**
 * The backend's status string is not this union: `emit_status` in
 * `src-tauri/src/commands/infrastructure/setup.rs` also emits `"cancelled"`
 * (3 sites, including the final status after a cancel lands mid-phase). The
 * previous `status as InstallPhase` wrote that value straight into a field
 * the type says cannot hold it — the UI only survived because
 * `InstallButton` happens to fall through unknown phases to the idle button.
 * Parse at the boundary instead: anything the union does not name resolves to
 * `idle`, which is the state that already rendered, and the type stops lying.
 */
function toInstallPhase(status: string): InstallPhase {
  return (INSTALL_PHASES as readonly string[]).includes(status)
    ? (status as InstallPhase)
    : 'idle';
}

export function useAutoInstaller() {
  const [nodeState, setNodeState] = useState<InstallState>(defaultState());
  const [claudeState, setClaudeState] = useState<InstallState>(defaultState());
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  // Monotonic token identifying the newest install run. Registering the two
  // listeners takes two awaits, and the run that owns them is only decided
  // after both resolve — without this token a second install() started inside
  // that window ran cleanup() against the (still empty) shared array, then had
  // its own listeners overwritten by the first run's late assignment, leaking
  // them until unmount and double-appending every output line.
  const runIdRef = useRef(0);

  const cleanup = useCallback(() => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  const install = useCallback(async (target: 'node' | 'claude_cli' | 'all') => {
    const runId = ++runIdRef.current;
    cleanup();

    if (target === 'node' || target === 'all') {
      setNodeState({ phase: 'downloading', progressPct: 0, outputLines: [], error: null, manualCommand: null });
    }
    if (target === 'claude_cli' || target === 'all') {
      setClaudeState({ phase: 'downloading', progressPct: 0, outputLines: [], error: null, manualCommand: null });
    }

    // Held locally until BOTH listeners exist and this run is still the
    // current one; only then are they published to the shared ref.
    const registered: UnlistenFn[] = [];
    const superseded = () => {
      if (runIdRef.current === runId) return false;
      for (const unlisten of registered) unlisten();
      registered.length = 0;
      return true;
    };

    try {
      const unlistenOutput = await listen<SetupOutputPayload>(EventName.SETUP_OUTPUT, (event) => {
        if (runIdRef.current !== runId) return;
        const { target: t, line } = event.payload;
        const setter = t === 'node' ? setNodeState : setClaudeState;
        setter((prev) => ({ ...prev, outputLines: appendLine(prev.outputLines, line) }));
      });
      registered.push(unlistenOutput);
      if (superseded()) return;

      const unlistenStatus = await listen<SetupStatusPayload>(EventName.SETUP_STATUS, (event) => {
        if (runIdRef.current !== runId) return;
        const { target: t, status, progress_pct, error, manual_command } = event.payload;
        const setter = t === 'node' ? setNodeState : setClaudeState;
        setter((prev) => ({
          ...prev,
          phase: toInstallPhase(status),
          progressPct: progress_pct ?? prev.progressPct,
          error: error ?? prev.error,
          manualCommand: manual_command ?? prev.manualCommand,
        }));
      });

      registered.push(unlistenStatus);
      if (superseded()) return;

      unlistenersRef.current = registered;

      await startSetupInstall(target);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to start installation';
      if (target === 'node' || target === 'all') {
        setNodeState((prev) => ({ ...prev, phase: 'failed', error: errMsg }));
      }
      if (target === 'claude_cli' || target === 'all') {
        setClaudeState((prev) => ({ ...prev, phase: 'failed', error: errMsg }));
      }
      // Whichever half of the pair did register before the throw is only in
      // `registered` — cleanup() alone would leave it subscribed.
      for (const unlisten of registered) unlisten();
      registered.length = 0;
      cleanup();
    }
  }, [cleanup]);

  useEffect(() => {
    return () => {
      // Supersede any install still awaiting its listen() calls, so it
      // abandons them instead of subscribing after the hook is gone.
      runIdRef.current += 1;
      cleanup();
    };
  }, [cleanup]);

  const cancel = useCallback(() => {
    cancelSetupInstall().catch(silentCatch("autoInstaller:cancelInstall"));
    // Same reason as unmount: an install still mid-registration must not
    // publish its listeners after the user cancelled.
    runIdRef.current += 1;
    cleanup();
    setNodeState(defaultState());
    setClaudeState(defaultState());
  }, [cleanup]);

  return {
    nodeState,
    claudeState,
    install,
    cancel,
  };
}
