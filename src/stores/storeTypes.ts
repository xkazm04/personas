/**
 * Shared types for the persona store slice architecture.
 * Each slice defines its own interface; PersonaStore is the intersection of all.
 */

// Re-export slice interfaces (consumers can import PersonaStore from here)
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

// â”€â”€ Shared helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function errMsg(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof err === "object" && err !== null && "error" in err) return String((err as any).error);
  return fallback;
}

// â”€â”€ Combined store type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
