/**
 * Shared types for the persona store slice architecture.
 * Each slice defines its own interface; PersonaStore is the intersection of all.
 */

// Re-export slice interfaces (consumers can import PersonaStore from here)
import type { PersonaSlice } from "./slices/personaSlice";
import type { ToolSlice } from "./slices/toolSlice";
import type { TriggerSlice } from "./slices/triggerSlice";
import type { ExecutionSlice } from "./slices/executionSlice";
import type { CredentialSlice } from "./slices/credentialSlice";
import type { OverviewSlice } from "./slices/overviewSlice";
import type { MessageSlice } from "./slices/messageSlice";
import type { EventSlice } from "./slices/eventSlice";
import type { HealingSlice } from "./slices/healingSlice";
import type { TeamSlice } from "./slices/teamSlice";
import type { GroupSlice } from "./slices/groupSlice";
import type { MemorySlice } from "./slices/memorySlice";
import type { UiSlice } from "./slices/uiSlice";
import type { TestSlice } from "./slices/testSlice";
import type { LabSlice } from "./slices/labSlice";
import type { CloudSlice } from "./slices/cloudSlice";
import type { GitLabSlice } from "./slices/gitlabSlice";
import type { DatabaseSlice } from "./slices/databaseSlice";
import type { RecipeSlice } from "./slices/recipeSlice";
import type { AutomationSlice } from "./slices/automationSlice";
import type { OnboardingSlice } from "./slices/onboardingSlice";
import type { CronAgentsSlice } from "./slices/cronAgentsSlice";
import type { MiniPlayerSlice } from "./slices/miniPlayerSlice";
import type { HealthCheckSlice } from "./slices/healthCheckSlice";
import type { TourSlice } from "./slices/tourSlice";
import type { BudgetEnforcementSlice } from "./slices/budgetEnforcementSlice";
import type { AlertSlice } from "./slices/alertSlice";

// ── Shared helper ──────────────────────────────────────────────────────
export function errMsg(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof err === "object" && err !== null && "error" in err) return String((err as any).error);
  return fallback;
}

// ── Combined store type ────────────────────────────────────────────────
export type PersonaStore = PersonaSlice &
  ToolSlice &
  TriggerSlice &
  ExecutionSlice &
  CredentialSlice &
  OverviewSlice &
  MessageSlice &
  EventSlice &
  HealingSlice &
  TeamSlice &
  GroupSlice &
  MemorySlice &
  UiSlice &
  TestSlice &
  LabSlice &
  CloudSlice &
  GitLabSlice &
  DatabaseSlice &
  RecipeSlice &
  AutomationSlice &
  OnboardingSlice &
  CronAgentsSlice &
  MiniPlayerSlice &
  HealthCheckSlice &
  TourSlice &
  BudgetEnforcementSlice &
  AlertSlice;
