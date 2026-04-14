import type { StateCreator } from "zustand";

export interface ProcessNavigateTo {
  /** Sidebar section to navigate to */
  section: string;
  /** Optional sub-tab within the section */
  tab?: string;
  /** Optional persona ID to select */
  personaId?: string;
  /** Optional chat session id — when present, restore that specific session in the chat tab */
  chatSessionId?: string;
}

export interface ActiveProcess {
  domain: string;
  runId?: string;
  label?: string;
  startedAt: number;
  status: "running" | "completed" | "failed" | "cancelled" | "queued" | "input_required" | "draft_ready";
  toolCallCount: number;
  costUsd: number;
  lastEvent?: string;
  queuePosition?: number;
  personaId?: string;
  /** Where to navigate when the user clicks this activity row */
  navigateTo?: ProcessNavigateTo;
}

export interface ProcessActivitySlice {
  activeProcesses: Record<string, ActiveProcess>; // keyed by domain or domain:runId
  recentProcesses: ActiveProcess[]; // last 10 completed, newest first

  // Actions
  processStarted: (domain: string, runId?: string, label?: string, navigateTo?: ProcessNavigateTo) => void;
  processEnded: (
    domain: string,
    action: "completed" | "failed" | "cancelled",
    runId?: string,
  ) => void;
  enrichProcess: (
    domain: string,
    updates: Partial<Pick<ActiveProcess, "toolCallCount" | "costUsd" | "lastEvent">>,
  ) => void;
  /** Update the status and/or navigateTo of an active process. */
  updateProcessStatus: (
    domain: string,
    status: ActiveProcess["status"],
    opts?: { lastEvent?: string; navigateTo?: ProcessNavigateTo; runId?: string },
  ) => void;
  processQueued: (
    domain: string,
    runId?: string,
    label?: string,
    position?: number,
    personaId?: string,
  ) => void;
  processPromoted: (executionId: string) => void;
  /** Remove all non-running processes (queued, action_required, draft_ready) and recent history. */
  clearNonActive: () => void;
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

  processStarted: (domain, runId, label, navigateTo) => {
    const key = processKey(domain, runId);
    set((state) => ({
      activeProcesses: {
        ...state.activeProcesses,
        [key]: {
          domain,
          runId,
          label: label ?? state.activeProcesses[key]?.label,
          startedAt: Date.now(),
          status: "running",
          toolCallCount: 0,
          costUsd: 0,
          navigateTo: navigateTo ?? state.activeProcesses[key]?.navigateTo,
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

  updateProcessStatus: (domain, status, opts) => {
    set((state) => {
      let key = opts?.runId ? processKey(domain, opts.runId) : domain;
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
            status,
            ...(opts?.lastEvent !== undefined && { lastEvent: opts.lastEvent }),
            ...(opts?.navigateTo !== undefined && { navigateTo: opts.navigateTo }),
          },
        },
      };
    });
  },

  processQueued: (domain, runId, label, position, personaId) => {
    const key = processKey(domain, runId);
    set((state) => {
      const existing = state.activeProcesses[key];
      return {
        activeProcesses: {
          ...state.activeProcesses,
          [key]: {
            domain,
            runId,
            label: label ?? existing?.label,
            startedAt: existing?.startedAt ?? Date.now(),
            status: "queued" as const,
            toolCallCount: 0,
            costUsd: 0,
            queuePosition: position,
            personaId,
          },
        },
      };
    });
  },

  processPromoted: (executionId) => {
    const key = processKey("execution", executionId);
    set((state) => {
      const existing = state.activeProcesses[key];
      if (!existing || existing.status !== "queued") return state;

      return {
        activeProcesses: {
          ...state.activeProcesses,
          [key]: {
            ...existing,
            status: "running" as const,
            startedAt: Date.now(),
            queuePosition: undefined,
          },
        },
      };
    });
  },

  clearNonActive: () => {
    set((state) => {
      const kept: Record<string, ActiveProcess> = {};
      for (const [key, proc] of Object.entries(state.activeProcesses)) {
        if (proc.status === "running") kept[key] = proc;
      }
      return { activeProcesses: kept, recentProcesses: [] };
    });
  },
});
