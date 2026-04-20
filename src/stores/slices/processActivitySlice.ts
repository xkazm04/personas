import type { StateCreator } from "zustand";

/**
 * Every status an {@link ActiveProcess} can hold. Acts as the single source
 * of truth for the FSM — `clearNonActive` is written against this list so
 * adding a status forces an explicit "survives clear?" decision at the
 * switch statement below rather than silently inheriting a default.
 */
export const ACTIVE_PROCESS_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
  "queued",
  "input_required",
  "draft_ready",
] as const;
export type ActiveProcessStatus = (typeof ACTIVE_PROCESS_STATUSES)[number];

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
  status: ActiveProcessStatus;
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
  /**
   * Remove every non-`running` entry in `activeProcesses` plus all recent
   * history. Concretely, drops: `queued`, `input_required`, `draft_ready`,
   * `completed`, `failed`, `cancelled` — i.e. everything in
   * {@link ACTIVE_PROCESS_STATUSES} except `"running"`.
   *
   * Historical note: earlier doc-comments referenced `"action_required"`,
   * which was the pre-rename label for today's `"input_required"`. There is
   * no `"action_required"` value anywhere in the codebase — the status is
   * `"input_required"` everywhere (see `status_tokens` in `src/i18n/en.ts`).
   */
  clearNonActive: () => void;
}

const MAX_RECENT = 10;

/**
 * Build a storage key from `(domain, runId)`.
 *
 * ## Invariant
 * Neither `domain` nor `runId` may contain `":"`. Execution IDs are UUIDs
 * and domain names are lowercase identifiers today, so the invariant holds —
 * but we enforce it here so a future "namespaced" ID scheme like
 * `"workspace:123"` can't silently collide with another run:
 *
 *   processKey("build", "x:y")   vs   processKey("build:x", "y")
 *
 * both naively produce `"build:x:y"`. Instead of picking one, we guard at
 * the construction site.
 */
function processKey(domain: string, runId?: string): string {
  if (domain.includes(":")) {
    throw new Error(
      `processKey: domain contains ":" which conflicts with the key separator (got ${JSON.stringify(domain)})`,
    );
  }
  if (runId !== undefined && runId.includes(":")) {
    throw new Error(
      `processKey: runId contains ":" which conflicts with the key separator (got ${JSON.stringify(runId)})`,
    );
  }
  return runId ? `${domain}:${runId}` : domain;
}

/**
 * Look up an `activeProcesses` key using the same fallback rules as
 * [`enrichProcess`] / [`updateProcessStatus`]: exact `domain[:runId]` match
 * first, then a `domain:*` prefix fallback when no runId was provided. This
 * symmetry is why the store used to leak `running` rows when a caller
 * emitted `processEnded("domain")` for a process that had been stored under
 * `"domain:runId"`.
 */
function findProcessKey(
  activeProcesses: Record<string, ActiveProcess>,
  domain: string,
  runId?: string,
): string | null {
  const exact = runId ? processKey(domain, runId) : domain;
  if (exact in activeProcesses) return exact;
  if (!runId) {
    const match = Object.keys(activeProcesses).find((k) => k.startsWith(`${domain}:`));
    if (match) return match;
  }
  return null;
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
    set((state) => {
      // Mirror the prefix-match fallback in enrichProcess / updateProcessStatus
      // so `processEnded("execution")` can still reap a row stored under
      // `"execution:<id>"`. Without this, async enrichment that added the
      // runId would leave a "running" row forever after completion.
      const key = findProcessKey(state.activeProcesses, domain, runId);
      if (!key) return state;
      const process = state.activeProcesses[key];
      if (!process) return state;

      const { [key]: _, ...remaining } = state.activeProcesses;
      const ended: ActiveProcess = { ...process, status: action };
      const recent = [ended, ...state.recentProcesses].slice(0, MAX_RECENT);

      return { activeProcesses: remaining, recentProcesses: recent };
    });
  },

  enrichProcess: (domain, updates) => {
    set((state) => {
      const key = findProcessKey(state.activeProcesses, domain);
      if (!key) return state;
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
      const key = findProcessKey(state.activeProcesses, domain, opts?.runId);
      if (!key) return state;
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
        // Explicit switch rather than `!== 'running'` so adding a new value to
        // ACTIVE_PROCESS_STATUSES is a TypeScript exhaustiveness error here
        // instead of silently inheriting "dropped" semantics.
        if (shouldSurviveClearNonActive(proc.status)) kept[key] = proc;
      }
      return { activeProcesses: kept, recentProcesses: [] };
    });
  },
});

/**
 * Decide whether a given {@link ActiveProcessStatus} survives
 * [`ProcessActivitySlice.clearNonActive`]. Only `"running"` stays — every
 * other status is ephemeral from the activity-dock's perspective. Extracted
 * as a named predicate so adding a new status forces an explicit case here
 * via the `never` exhaustiveness check.
 */
export function shouldSurviveClearNonActive(status: ActiveProcessStatus): boolean {
  switch (status) {
    case "running":
      return true;
    case "queued":
    case "input_required":
    case "draft_ready":
    case "completed":
    case "failed":
    case "cancelled":
      return false;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
