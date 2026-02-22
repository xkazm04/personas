/**
 * Frontend-only types not generated from Rust bindings.
 * Includes model configuration, credential templates, and notification channels.
 */

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

export type PersonaExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "incomplete";

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

export interface DesignContext {
  files: DesignFile[];
  references: string[];
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
