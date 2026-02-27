/**
 * Frontend-only types not generated from Rust bindings.
 * Includes model configuration, credential templates, and notification channels.
 */

// ── Sidebar Tree ──────────────────────────────────────────────────────

import type { DbPersona, DbPersonaGroup } from "./types";

export interface GroupNode {
  kind: 'group';
  group: DbPersonaGroup;
  children: DbPersona[];
}

export interface UngroupedNode {
  kind: 'ungrouped';
  children: DbPersona[];
}

export type SidebarNode = GroupNode | UngroupedNode;

export type SidebarDragType = 'persona' | 'group';

export interface SidebarDragData {
  type: SidebarDragType;
  personaId?: string;
  groupId?: string;
}

/** Build a tree of sidebar nodes from flat groups + personas arrays. */
export function buildSidebarTree(
  groups: DbPersonaGroup[],
  personas: DbPersona[],
): SidebarNode[] {
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);

  const groupMap = new Map<string, DbPersona[]>();
  for (const g of sortedGroups) groupMap.set(g.id, []);
  const ungrouped: DbPersona[] = [];

  for (const p of personas) {
    const gid = p.group_id;
    if (gid && groupMap.has(gid)) {
      groupMap.get(gid)!.push(p);
    } else {
      ungrouped.push(p);
    }
  }

  const nodes: SidebarNode[] = sortedGroups.map((group) => ({
    kind: 'group' as const,
    group,
    children: groupMap.get(group.id) ?? [],
  }));

  nodes.push({ kind: 'ungrouped', children: ungrouped });

  return nodes;
}

// ── Model Configuration ────────────────────────────────────────────────

export type ModelProvider = "anthropic" | "ollama" | "litellm" | "custom";

export interface ModelProfile {
  model?: string;
  provider?: ModelProvider;
  base_url?: string;
  auth_token?: string;
}

// ── Notification Channels ──────────────────────────────────────────────

export type NotificationChannelType = "slack" | "telegram" | "email";

export interface NotificationChannel {
  type: NotificationChannelType;
  enabled: boolean;
  credential_id?: string;
  config: Record<string, string>;
}

// ── Credential Templates ───────────────────────────────────────────────

export interface CredentialTemplate {
  id: string;
  name: string;
  label: string;
  icon_url?: string;
  color: string;
  category: string;
  fields: CredentialTemplateField[];
  healthcheck_config?: {
    description: string;
    endpoint?: string;
    method?: string;
  };
  services: CredentialTemplateService[];
  events: CredentialTemplateEvent[];
}

export interface CredentialTemplateField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "select";
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
}

export interface CredentialTemplateService {
  toolName: string;
  label: string;
}

export interface CredentialTemplateEvent {
  id: string;
  name: string;
  description: string;
  config_fields?: CredentialTemplateField[];
}

// ── Trigger Types ──────────────────────────────────────────────────────

export type PersonaTriggerType = "manual" | "schedule" | "polling" | "webhook";

// ── Execution Status ───────────────────────────────────────────────────
// Re-export the canonical ExecutionState from the execution module.
// PersonaExecutionStatus is kept as an alias for backward compatibility.
export type { ExecutionState as PersonaExecutionStatus } from "@/lib/execution/executionState";

// ── Healing Issue Types ────────────────────────────────────────────────

export type HealingIssueSeverity = "low" | "medium" | "high" | "critical";
export type HealingIssueCategory = "performance" | "reliability" | "security" | "cost" | "quality";
export type HealingIssueStatus = "detected" | "analyzing" | "resolved" | "ignored";

// ── Manual Review Types ────────────────────────────────────────────────

export type ManualReviewSeverity = "info" | "warning" | "critical";
export type ManualReviewStatus = "pending" | "approved" | "rejected";

// ── Event Types ────────────────────────────────────────────────────────

export type PersonaEventType = "execution_completed" | "execution_failed" | "manual_review" | "user_message" | "persona_action" | "emit_event" | "custom";
export type PersonaEventSourceType = "persona" | "user" | "system" | "scheduler";
export type PersonaEventStatus = "pending" | "processed" | "failed";

// ── Credential Service Types ───────────────────────────────────────────

export type CredentialServiceType = "api_key" | "oauth" | "webhook" | "smtp" | "custom";

// ── Memory Categories ──────────────────────────────────────────────────

export type PersonaMemoryCategory = "fact" | "preference" | "instruction" | "context" | "learned" | "custom";

// ── Design Context Types ──────────────────────────────────────────────

export type DesignFileType = "api-spec" | "schema" | "mcp-config" | "other";

export interface DesignFile {
  name: string;
  content: string;
  type: DesignFileType;
}

/** Design files and URL references provided as context during design analysis. */
export interface DesignFilesSection {
  files: DesignFile[];
  references: string[];
}

/**
 * @deprecated Use `DesignFilesSection` instead. Kept as alias for backward compatibility.
 */
export type DesignContext = DesignFilesSection;

/** A single use-case extracted from design results. */
export interface DesignUseCase {
  id: string;
  title: string;
  description: string;
  category?: string;
  execution_mode?: "e2e" | "mock" | "non_executable";
  sample_input?: Record<string, unknown> | null;
  time_filter?: UseCaseTimeFilter;
  input_schema?: UseCaseInputField[];
  suggested_trigger?: UseCaseSuggestedTrigger;
  model_override?: ModelProfile;
  notification_channels?: NotificationChannel[];
  event_subscriptions?: UseCaseEventSubscription[];
}

export interface UseCaseTimeFilter {
  field: string;
  default_window: string;
  description: string;
}

export interface UseCaseInputField {
  key: string;
  type: "text" | "number" | "select" | "boolean";
  label: string;
  default?: unknown;
  options?: string[];
}

export interface UseCaseSuggestedTrigger {
  type: "schedule" | "polling" | "webhook" | "manual";
  cron?: string;
  description: string;
}

export interface UseCaseEventSubscription {
  event_type: string;
  source_filter?: string;
  enabled: boolean;
}

/**
 * Typed envelope for the `design_context` JSON column.
 * Three independent sections that can evolve separately:
 * - `designFiles` — files & references for the AI design prompt
 * - `credentialLinks` — connector name → credential ID mappings
 * - `useCases` — structured workflow descriptions from design results
 * - `summary` — optional human-readable summary (legacy compat)
 */
export interface DesignContextData {
  designFiles?: DesignFilesSection;
  credentialLinks?: Record<string, string>;
  useCases?: DesignUseCase[];
  summary?: string;
}

// ── Flow Diagram Types ────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: "start" | "end" | "action" | "decision" | "connector" | "event" | "error";
  label: string;
  detail?: string;
  connector?: string;
  request_data?: string;
  response_data?: string;
  error_message?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  variant?: "default" | "yes" | "no" | "error";
}

export interface UseCaseFlow {
  id: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}
