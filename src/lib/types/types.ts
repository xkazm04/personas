/**
 * Frontend types for the Persona Agent System.
 * Bridges Rust ts-rs bindings to the shapes components expect.
 */

// -- Re-export Rust binding types --------------
import type { Persona } from "@/lib/bindings/Persona";
import type { PersonaToolDefinition } from "@/lib/bindings/PersonaToolDefinition";
import type { PersonaTool } from "@/lib/bindings/PersonaTool";
import type { PersonaTrigger } from "@/lib/bindings/PersonaTrigger";
import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { PersonaCredential } from "@/lib/bindings/PersonaCredential";
import type { CredentialEvent } from "@/lib/bindings/CredentialEvent";
import type { PersonaEvent } from "@/lib/bindings/PersonaEvent";
import type { PersonaEventSubscription } from "@/lib/bindings/PersonaEventSubscription";
import type { PersonaMessage as RawPersonaMessage } from "@/lib/bindings/PersonaMessage";
import type { PersonaMetricsSnapshot } from "@/lib/bindings/PersonaMetricsSnapshot";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";
import type { PersonaGroup } from "@/lib/bindings/PersonaGroup";
import type { PersonaMemory } from "@/lib/bindings/PersonaMemory";
import type { PersonaTeam } from "@/lib/bindings/PersonaTeam";
import type { PersonaTeamMember } from "@/lib/bindings/PersonaTeamMember";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { ConnectorDefinition as RawConnectorDefinition } from "@/lib/bindings/ConnectorDefinition";
import { parseJsonOrDefault } from "@/lib/utils/parseJson";

export type {
  Persona,
  PersonaToolDefinition,
  PersonaTool,
  PersonaTrigger,
  PersonaExecution,
  PersonaCredential,
  CredentialEvent,
  PersonaEvent,
  PersonaEventSubscription,
  PersonaMetricsSnapshot,
  PersonaPromptVersion,
  PersonaHealingIssue,
  PersonaGroup,
  PersonaMemory,
  PersonaTeam,
  PersonaTeamMember,
  PersonaDesignReview,
  RawConnectorDefinition,
};

// -- Frontend Enriched Types --------------------------------------------

/** Persona with associated tools, triggers, and event subscriptions */
export interface PersonaWithDetails extends Persona {
  tools: PersonaToolDefinition[];
  triggers: PersonaTrigger[];
  subscriptions?: PersonaEventSubscription[];
  automations?: import("@/lib/bindings/PersonaAutomation").PersonaAutomation[];
  /** Non-empty when one or more sub-resource queries failed during load. */
  warnings?: string[];
}

/** Credential metadata (without encrypted data) */
export interface CredentialMetadata {
  id: string;
  name: string;
  service_type: string;
  metadata: string | null;
  healthcheck_last_success: boolean | null;
  healthcheck_last_message: string | null;
  healthcheck_last_tested_at: string | null;
  healthcheck_last_success_at: string | null;
  oauth_refresh_count: number;
  oauth_last_refresh_at: string | null;
  oauth_token_expires_at: string | null;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Map a raw PersonaCredential to CredentialMetadata (strip encrypted fields) */
export function toCredentialMetadata(c: PersonaCredential): CredentialMetadata {
  const parsedMetadata = parseJsonOrDefault<Record<string, unknown> | null>(c.metadata, null);

  const lastSuccess = typeof parsedMetadata?.healthcheck_last_success === "boolean"
    ? parsedMetadata.healthcheck_last_success
    : null;
  const lastMessage = typeof parsedMetadata?.healthcheck_last_message === "string"
    ? parsedMetadata.healthcheck_last_message
    : null;
  const lastTestedAt = typeof parsedMetadata?.healthcheck_last_tested_at === "string"
    ? parsedMetadata.healthcheck_last_tested_at
    : null;
  const lastSuccessAt = typeof parsedMetadata?.healthcheck_last_success_at === "string"
    ? parsedMetadata.healthcheck_last_success_at
    : null;
  const oauthRefreshCount = typeof parsedMetadata?.oauth_refresh_count === "number"
    ? parsedMetadata.oauth_refresh_count
    : 0;
  const oauthLastRefreshAt = typeof parsedMetadata?.oauth_last_refresh_at === "string"
    ? parsedMetadata.oauth_last_refresh_at
    : null;
  const oauthTokenExpiresAt = typeof parsedMetadata?.oauth_token_expires_at === "string"
    ? parsedMetadata.oauth_token_expires_at
    : null;
  const usageCount = typeof parsedMetadata?.usage_count === "number"
    ? parsedMetadata.usage_count
    : 0;

  return {
    id: c.id,
    name: c.name,
    service_type: c.service_type,
    metadata: c.metadata,
    healthcheck_last_success: lastSuccess,
    healthcheck_last_message: lastMessage,
    healthcheck_last_tested_at: lastTestedAt,
    healthcheck_last_success_at: lastSuccessAt,
    oauth_refresh_count: oauthRefreshCount,
    oauth_last_refresh_at: oauthLastRefreshAt,
    oauth_token_expires_at: oauthTokenExpiresAt,
    usage_count: usageCount,
    last_used_at: c.last_used_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

/**
 * Shared connector shape used by both builtin JSON definitions and
 * Rust-backed ConnectorDefinition.  Single source of truth for the
 * fields every connector must carry.
 */
export interface ConnectorDefinitionBase {
  id: string;
  name: string;
  label: string;
  icon_url?: string | null;
  color: string;
  category: string;
  fields: CredentialTemplateField[];
  healthcheck_config: Record<string, unknown> | null;
  services: { toolName: string; label: string }[];
  events: CredentialTemplateEvent[];
  metadata: Record<string, unknown> | null;
}

/** Parsed frontend connector definition (JSON fields pre-parsed) */
export interface ConnectorDefinition extends ConnectorDefinitionBase {
  /** Narrowed healthcheck with typed description field. */
  healthcheck_config: { description: string; endpoint?: string; method?: string } | null;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

/** Parse raw connector from Rust binding into frontend ConnectorDefinition */
export function parseConnectorDefinition(raw: RawConnectorDefinition): ConnectorDefinition {
  return {
    id: raw.id,
    name: raw.name,
    label: raw.label,
    icon_url: raw.icon_url,
    color: raw.color,
    category: raw.category,
    fields: safeJsonParse(raw.fields, []),
    healthcheck_config: raw.healthcheck_config ? safeJsonParse(raw.healthcheck_config, null) : null,
    services: safeJsonParse(raw.services, []),
    events: safeJsonParse(raw.events, []),
    metadata: raw.metadata ? safeJsonParse(raw.metadata, null) : null,
    is_builtin: raw.is_builtin,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return fallback;
  }
}

/** Credential template field definition */
export interface CredentialTemplateField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "select";
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
}

/** Credential template event definition */
export interface CredentialTemplateEvent {
  id: string;
  name: string;
  description: string;
  config_fields?: CredentialTemplateField[];
}

/** An auth method available for a connector (PAT, OAuth, MCP, etc.) */
export interface ConnectorAuthMethod {
  id: string;
  label: string;
  type: 'credential' | 'mcp' | 'oauth';
  is_default?: boolean;
  /** MCP: npm package name (e.g., "@supabase/mcp-server-supabase") */
  package?: string;
  /** MCP: transport type */
  transport?: 'stdio' | 'sse';
  /** MCP: suggested environment variables */
  suggested_env?: Record<string, string>;
}

/** Extract auth methods from connector metadata, with backward-compatible fallback. */
export function getAuthMethods(connector: ConnectorDefinition): ConnectorAuthMethod[] {
  const meta = (connector.metadata ?? {}) as Record<string, unknown>;
  if (Array.isArray(meta.auth_methods) && meta.auth_methods.length > 0) {
    return meta.auth_methods as ConnectorAuthMethod[];
  }
  const label = typeof meta.auth_type_label === 'string' ? meta.auth_type_label : 'Credential';
  const id = typeof meta.auth_type === 'string' ? meta.auth_type : 'default';
  return [{ id, label, type: 'credential', is_default: true }];
}

// -- Navigation Types ---------------------------------------------------

export type SidebarSection = "home" | "overview" | "personas" | "events" | "credentials" | "design-reviews" | "plugins" | "schedules" | "settings";
export type HomeTab = "welcome" | "roadmap" | "system-check" | "learning";
export type EditorTab = "activity" | "matrix" | "use-cases" | "prompt" | "lab" | "connectors" | "settings" | "chat" | "assertions";
export type OverviewTab = "home" | "executions" | "manual-review" | "messages" | "events" | "knowledge" | "sla" | "health" | "observability" | "leaderboard";
export type TemplateTab = "n8n" | "generated";
export type CloudTab = "cloud" | "gitlab" | "unified";
export type SettingsTab = "account" | "appearance" | "notifications" | "engine" | "byom" | "portability" | "network" | "admin" | "config" | "quality-gates";
export type DevToolsTab = "overview" | "projects" | "context-map" | "idea-scanner" | "idea-triage" | "task-runner" | "lifecycle" | "skills";
export type AgentTab = "all" | "create" | "team" | "cloud";
export type PluginTab = "browse" | "dev-tools" | "doc-signing" | "ocr" | "artist" | "obsidian-brain" | "research-lab";
export type ResearchLabTab = "dashboard" | "projects" | "literature" | "hypotheses" | "experiments" | "findings" | "reports";
export type ObsidianBrainTab = "setup" | "sync" | "browse" | "cloud";
export type ArtistTab = "blender" | "gallery" | "media-studio";
export type EventBusTab = "builder" | "studio" | "shared" | "live-stream" | "rate-limits" | "test" | "smee-relay" | "cloud-webhooks" | "dead-letter";

export type CliEngine = "claude_code" | "ollama";

// -- Analytics Types (re-exported from ts-rs bindings) ---------------------

export type { ToolUsageSummary } from "@/lib/bindings/ToolUsageSummary";
export type { ToolUsageOverTime } from "@/lib/bindings/ToolUsageOverTime";
export type { PersonaUsageSummary } from "@/lib/bindings/PersonaUsageSummary";

// -- Execution Output Types ---------------------------------------------

export interface ExecutionOutputLine {
  line?: string;
  done?: boolean;
  status?: string;
}

// -- Persona Info Mixin (shared across enriched types) ------------------

export interface WithPersonaInfo {
  persona_name?: string;
  persona_icon?: string;
  persona_color?: string;
}

/** Build a persona lookup map and enrich records that have a persona_id field. */
export function enrichWithPersona<T extends { persona_id: string }>(
  records: T[],
  personas: { id: string; name: string; icon: string | null; color: string | null }[],
): (T & WithPersonaInfo)[] {
  const personaMap = new Map(personas.map((p) => [p.id, p]));
  return records.map((r) => {
    const p = personaMap.get(r.persona_id);
    return {
      ...r,
      persona_name: p?.name,
      persona_icon: p?.icon ?? undefined,
      persona_color: p?.color ?? undefined,
    };
  });
}

// -- Enriched Types (with persona info for global views) ----------------

export interface ManualReviewItem extends WithPersonaInfo {
  id: string;
  persona_id: string;
  execution_id: string;
  review_type: string;
  content: string;
  severity: string;
  status: string;
  reviewer_notes: string | null;
  context_data: string | null;
  suggested_actions: string | null;
  title: string;
  created_at: string;
  resolved_at: string | null;
  /** Where this review originated -- 'local' (default) or 'cloud'. */
  source?: 'local' | 'cloud';
}

export interface GlobalExecution extends PersonaExecution, WithPersonaInfo {}

export interface PersonaMessage extends RawPersonaMessage, WithPersonaInfo {}
