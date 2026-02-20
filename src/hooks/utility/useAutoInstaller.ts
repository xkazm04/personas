import { useState, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { startSetupInstall, cancelSetupInstall } from '@/api/tauriApi';

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

export function useAutoInstaller() {
  const [nodeState, setNodeState] = useState<InstallState>(defaultState());
  const [claudeState, setClaudeState] = useState<InstallState>(defaultState());
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  const cleanup = useCallback(() => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  const install = useCallback(async (target: 'node' | 'claude_cli' | 'all') => {
    cleanup();

    if (target === 'node' || target === 'all') {
      setNodeState({ phase: 'downloading', progressPct: 0, outputLines: [], error: null, manualCommand: null });
    }
    if (target === 'claude_cli' || target === 'all') {
      setClaudeState({ phase: 'downloading', progressPct: 0, outputLines: [], error: null, manualCommand: null });
    }

    try {
      const unlistenOutput = await listen<SetupOutputPayload>('setup-output', (event) => {
        const { target: t, line } = event.payload;
        const setter = t === 'node' ? setNodeState : setClaudeState;
        setter((prev) => ({ ...prev, outputLines: [...prev.outputLines, line] }));
      });

      const unlistenStatus = await listen<SetupStatusPayload>('setup-status', (event) => {
        const { target: t, status, progress_pct, error, manual_command } = event.payload;
        const setter = t === 'node' ? setNodeState : setClaudeState;
        setter((prev) => ({
          ...prev,
          phase: status as InstallPhase,
          progressPct: progress_pct ?? prev.progressPct,
          error: error ?? prev.error,
          manualCommand: manual_command ?? prev.manualCommand,
        }));
      });

      unlistenersRef.current = [unlistenOutput, unlistenStatus];

      await startSetupInstall(target);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to start installation';
      if (target === 'node' || target === 'all') {
        setNodeState((prev) => ({ ...prev, phase: 'failed', error: errMsg }));
      }
      if (target === 'claude_cli' || target === 'all') {
        setClaudeState((prev) => ({ ...prev, phase: 'failed', error: errMsg }));
      }
      cleanup();
    }
  }, [cleanup]);

  const cancel = useCallback(() => {
    cancelSetupInstall().catch(() => {});
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
