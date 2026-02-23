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
import type { ObservabilitySlice } from "./slices/observabilitySlice";
import type { HealingSlice } from "./slices/healingSlice";
import type { TeamSlice } from "./slices/teamSlice";
import type { GroupSlice } from "./slices/groupSlice";
import type { MemorySlice } from "./slices/memorySlice";
import type { UiSlice } from "./slices/uiSlice";
import type { TestSlice } from "./slices/testSlice";
import type { CloudSlice } from "./slices/cloudSlice";
import type { GitLabSlice } from "./slices/gitlabSlice";

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
  ObservabilitySlice &
  HealingSlice &
  TeamSlice &
  GroupSlice &
  MemorySlice &
  UiSlice &
  TestSlice &
  CloudSlice &
  GitLabSlice;
