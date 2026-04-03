import type { StateCreator } from "zustand";

export interface ActiveProcess {
  domain: string;
  runId?: string;
  label?: string;
  startedAt: number;
  status: "running" | "completed" | "failed" | "cancelled";
  toolCallCount: number;
  costUsd: number;
  lastEvent?: string;
}

export interface ProcessActivitySlice {
  activeProcesses: Record<string, ActiveProcess>; // keyed by domain or domain:runId
  recentProcesses: ActiveProcess[]; // last 10 completed, newest first

  // Actions
  processStarted: (domain: string, runId?: string, label?: string) => void;
  processEnded: (
    domain: string,
    action: "completed" | "failed" | "cancelled",
    runId?: string,
  ) => void;
  enrichProcess: (
    domain: string,
    updates: Partial<Pick<ActiveProcess, "toolCallCount" | "costUsd" | "lastEvent">>,
  ) => void;
}

const MAX_RECENT = 10;

function processKey(domain: string, runId?: string): string {
  return runId ? `${domain}:${runId}` : domain;
}

export const createProcessActivitySlice: StateCreator<
  ProcessActivitySlice,
  [],
  [],
  ProcessActivitySlice
> = (set, _get) => ({
  activeProcesses: {},
  recentProcesses: [],

  processStarted: (domain, runId, label) => {
    const key = processKey(domain, runId);
    set((state) => ({
      activeProcesses: {
        ...state.activeProcesses,
        [key]: {
          domain,
          runId,
          label,
          startedAt: Date.now(),
          status: "running",
          toolCallCount: 0,
          costUsd: 0,
        },
      },
    }));
  },

  processEnded: (domain, action, runId) => {
    const key = processKey(domain, runId);
    set((state) => {
      const process = state.activeProcesses[key];
      if (!process) return state;

      const { [key]: _, ...remaining } = state.activeProcesses;
      const ended: ActiveProcess = { ...process, status: action };
      const recent = [ended, ...state.recentProcesses].slice(0, MAX_RECENT);

      return { activeProcesses: remaining, recentProcesses: recent };
    });
  },

  enrichProcess: (domain, updates) => {
    // Try exact domain key first, then look for domain:* prefix
    set((state) => {
      let key = domain;
      if (!(key in state.activeProcesses)) {
        const match = Object.keys(state.activeProcesses).find((k) => k.startsWith(`${domain}:`));
        if (match) key = match;
        else return state;
      }
      const existing = state.activeProcesses[key];
      if (!existing) return state;

      return {
        activeProcesses: {
          ...state.activeProcesses,
          [key]: {
            ...existing,
            ...(updates.toolCallCount !== undefined && { toolCallCount: updates.toolCallCount }),
            ...(updates.costUsd !== undefined && { costUsd: updates.costUsd }),
            ...(updates.lastEvent !== undefined && { lastEvent: updates.lastEvent }),
          },
        },
      };
    });
  },
});
