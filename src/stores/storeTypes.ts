/**
 * Shared types for the persona store slice architecture.
 * Each domain store defines its own composite type.
 */

// Re-export slice interfaces for domain store composition

import type { PersonaSlice } from "./slices/agents/personaSlice";
import type { ToolSlice } from "./slices/agents/toolSlice";
import type { TriggerSlice } from "./slices/pipeline/triggerSlice";
import type { ExecutionSlice } from "./slices/agents/executionSlice";
import type { CredentialSlice } from "./slices/vault/credentialSlice";
import type { OverviewSlice } from "./slices/overview/overviewSlice";
import type { MessageSlice } from "./slices/overview/messageSlice";
import type { EventSlice } from "./slices/overview/eventSlice";
import type { HealingSlice } from "./slices/overview/healingSlice";
import type { TeamSlice } from "./slices/pipeline/teamSlice";
import type { GroupSlice } from "./slices/pipeline/groupSlice";
import type { MemorySlice } from "./slices/overview/memorySlice";
import type { UiSlice } from "./slices/system/uiSlice";
import type { TestSlice } from "./slices/agents/testSlice";
import type { LabSlice } from "./slices/agents/labSlice";
import type { CloudSlice } from "./slices/system/cloudSlice";
import type { GitLabSlice } from "./slices/system/gitlabSlice";
import type { DatabaseSlice } from "./slices/vault/databaseSlice";
import type { RecipeSlice } from "./slices/pipeline/recipeSlice";
import type { AutomationSlice } from "./slices/vault/automationSlice";
import type { OnboardingSlice } from "./slices/system/onboardingSlice";
import type { CronAgentsSlice } from "./slices/overview/cronAgentsSlice";
import type { MiniPlayerSlice } from "./slices/agents/miniPlayerSlice";
import type { HealthCheckSlice } from "./slices/agents/healthCheckSlice";
import type { TourSlice } from "./slices/system/tourSlice";
import type { BudgetEnforcementSlice } from "./slices/agents/budgetEnforcementSlice";
import type { AlertSlice } from "./slices/overview/alertSlice";
import type { PersonaHealthSlice } from "./slices/overview/personaHealthSlice";
import type { ViewModeSlice } from "./slices/system/viewModeSlice";
import type { DevToolsSlice } from "./slices/system/devToolsSlice";
import type { NetworkSlice } from "./slices/network/networkSlice";
import type { SetupSlice } from "./slices/system/setupSlice";
import type { AmbientContextSlice } from "./slices/system/ambientContextSlice";
import type { ArtistSlice } from "./slices/system/artistSlice";
import type { ObsidianBrainSlice } from "./slices/system/obsidianBrainSlice";
import type { ResearchLabSlice } from "./slices/system/researchLabSlice";
import type { TwinSlice } from "./slices/system/twinSlice";
import type { ChatSlice } from "./slices/agents/chatSlice";
import type { MatrixBuildSlice } from "./slices/agents/matrixBuildSlice";
import type { RotationSlice } from "./slices/vault/rotationSlice";
import type { ProcessActivitySlice } from "./slices/processActivitySlice";

// -- Shared helpers ------------------------------------------------------
import * as Sentry from "@sentry/react";
import { isTauriError, type TauriErrorKind } from "@/lib/types/tauriError";

/** A single scoped error entry keyed by action name. */
export interface SliceError {
  message: string;
  kind: TauriErrorKind | null;
  timestamp: number;
}

export function errMsg(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (isTauriError(err)) return err.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof err === "object" && err !== null && "error" in err) return String((err as any).error);
  return fallback;
}

/** Extract the structured `kind` code from a Tauri error, or `undefined` for unstructured errors. */
export function errKind(err: unknown): TauriErrorKind | undefined {
  return isTauriError(err) ? err.kind : undefined;
}

/**
 * Unified error reporter that both updates slice error state (for inline
 * display) AND fires a toast (for transient notification).
 *
 * @param err     - The caught error value
 * @param fallback - Human-readable fallback message
 * @param set     - Zustand `set` callback from the calling slice
 * @param options - Optional overrides
 *   • severity: "toast" = toast only (no state), "state" = state only (no toast),
 *     "both" (default) = update state AND fire toast
 *   • stateUpdates - extra fields to merge into the set() call (e.g. isLoading: false)
 */
// Toast deduplication: suppress identical error toasts within a cooldown window
const _toastCooldownMs = 5000;
const _recentToasts = new Map<string, number>();

export function reportError(
  err: unknown,
  fallback: string,
  set: (partial: { error: string; errorKind?: TauriErrorKind | null }) => void,
  options?: {
    severity?: "toast" | "state" | "both";
    stateUpdates?: Record<string, unknown>;
    /** Scoped action name — when provided, the error is also written to sliceErrors[action]. */
    action?: string;
  },
): string {
  const { severity = "both", stateUpdates, action } = options ?? {};
  const message = errMsg(err, fallback);
  const kind = errKind(err);

  Sentry.withScope((scope) => {
    if (kind) scope.setTag("error.kind", kind);
    if (action) scope.setTag("error.action", action);
    scope.setExtra("fallback", fallback);
    Sentry.captureException(err);
  });

  if (severity !== "toast") {
    if (action) {
      // Use functional form to merge into the per-action error map without clobbering sibling entries.
      // The runtime `set` is always a Zustand setter that supports (state) => partial.
      (set as unknown as (fn: (state: { sliceErrors?: Record<string, SliceError> }) => Record<string, unknown>) => void)(
        (state) => ({
          error: message,
          errorKind: kind ?? null,
          sliceErrors: {
            ...(state.sliceErrors ?? {}),
            [action]: { message, kind: kind ?? null, timestamp: Date.now() },
          },
          ...stateUpdates,
        }),
      );
    } else {
      set({ error: message, errorKind: kind ?? null, ...stateUpdates } as { error: string; errorKind?: TauriErrorKind | null });
    }
  }
  if (severity !== "state") {
    const now = Date.now();
    const lastShown = _recentToasts.get(message);
    if (!lastShown || now - lastShown > _toastCooldownMs) {
      _recentToasts.set(message, now);
      // Evict stale entries to prevent memory leak
      if (_recentToasts.size > 50) {
        for (const [key, ts] of _recentToasts) {
          if (now - ts > _toastCooldownMs * 2) _recentToasts.delete(key);
        }
      }
      // Use storeBus to avoid circular dependency at module load time
      import("@/lib/storeBus").then(({ storeBus }) => {
        storeBus.emit('toast', { message, type: 'error' });
      }).catch(() => {});
    }
  }
  return message;
}

/**
 * Remove a single scoped error entry by action name.
 * Pass the Zustand `set` from the calling slice.
 */
export function clearSliceError(
  action: string,
  set: (fn: (state: { sliceErrors?: Record<string, SliceError> }) => Record<string, unknown>) => void,
): void {
  set((state) => {
    const prev = state.sliceErrors ?? {};
    const { [action]: _, ...rest } = prev;
    return { sliceErrors: rest };
  });
}

// -- Shared state present in every domain store ----------------------------

/** Common error/loading state replicated in each domain store so slices can
 *  set({ error, isLoading }) without cross-domain writes. */
export interface CoreState {
  error: string | null;
  /** Structured error code from the Rust backend (`AppError::kind`). */
  errorKind: TauriErrorKind | null;
  isLoading: boolean;
  /** Per-action scoped error map — concurrent errors are independently tracked. */
  sliceErrors: Record<string, SliceError>;
}

// -- Domain store types --------------------------------------------------

/** Agents domain: personas, tools, executions, tests, lab, mini-player, health, budget, chat */
export type AgentStore = CoreState &
  PersonaSlice &
  ToolSlice &
  ExecutionSlice &
  TestSlice &
  LabSlice &
  MiniPlayerSlice &
  HealthCheckSlice &
  BudgetEnforcementSlice &
  ChatSlice &
  MatrixBuildSlice;

/** Overview domain: dashboard, messages, events, healing, memories, cron, alerts, persona health, process activity */
export type OverviewStore = CoreState &
  OverviewSlice &
  MessageSlice &
  EventSlice &
  HealingSlice &
  MemorySlice &
  CronAgentsSlice &
  AlertSlice &
  PersonaHealthSlice &
  ProcessActivitySlice;

/** Pipeline domain: triggers, teams, groups, recipes */
export type PipelineStore = CoreState &
  TriggerSlice &
  TeamSlice &
  GroupSlice &
  RecipeSlice;

/** Vault domain: credentials, databases, automations, rotation */
export type VaultStore = CoreState &
  CredentialSlice &
  DatabaseSlice &
  AutomationSlice &
  RotationSlice;

/** System domain: UI, cloud, GitLab, onboarding, tour, view-mode, dev-tools, network, setup */
export type SystemStore = CoreState &
  UiSlice &
  CloudSlice &
  GitLabSlice &
  OnboardingSlice &
  TourSlice &
  ViewModeSlice &
  DevToolsSlice &
  NetworkSlice &
  SetupSlice &
  AmbientContextSlice &
  ArtistSlice &
  ObsidianBrainSlice &
  ResearchLabSlice &
  TwinSlice;

