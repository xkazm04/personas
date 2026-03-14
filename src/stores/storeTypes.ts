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
import type { ViewModeSlice } from "./slices/system/viewModeSlice";
import type { DevToolsSlice } from "./slices/system/devToolsSlice";
import type { NetworkSlice } from "./slices/network/networkSlice";
import type { SetupSlice } from "./slices/system/setupSlice";
import type { ChatSlice } from "./slices/agents/chatSlice";
import type { MatrixBuildSlice } from "./slices/agents/matrixBuildSlice";
import type { RotationSlice } from "./slices/vault/rotationSlice";

// -- Shared helpers ------------------------------------------------------
export function errMsg(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof err === "object" && err !== null && "error" in err) return String((err as any).error);
  return fallback;
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
export function reportError(
  err: unknown,
  fallback: string,
  set: (partial: { error: string }) => void,
  options?: {
    severity?: "toast" | "state" | "both";
    stateUpdates?: Record<string, unknown>;
  },
): string {
  const { severity = "both", stateUpdates } = options ?? {};
  const message = errMsg(err, fallback);

  if (severity !== "toast") {
    set({ error: message, ...stateUpdates } as { error: string });
  }
  if (severity !== "state") {
    // Lazy import to avoid circular dependency at module load time
    const { useToastStore } = require("@/stores/toastStore");
    useToastStore.getState().addToast(message, "error");
  }
  return message;
}

// -- Shared state present in every domain store ----------------------------

/** Common error/loading state replicated in each domain store so slices can
 *  set({ error, isLoading }) without cross-domain writes. */
export interface CoreState {
  error: string | null;
  isLoading: boolean;
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

/** Overview domain: dashboard, messages, events, healing, memories, cron, alerts */
export type OverviewStore = CoreState &
  OverviewSlice &
  MessageSlice &
  EventSlice &
  HealingSlice &
  MemorySlice &
  CronAgentsSlice &
  AlertSlice;

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
  SetupSlice;

