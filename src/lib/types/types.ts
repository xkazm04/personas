/**
 * Frontend types for the Persona Agent System.
 * Bridges Rust ts-rs bindings to the shapes components expect.
 */

// ── Re-export Rust binding types with Db-prefixed aliases ──────────────
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

// Alias re-exports for compatibility with source component code
export type DbPersona = Persona;
export type DbPersonaToolDefinition = PersonaToolDefinition;
export type DbPersonaTool = PersonaTool;
export type DbPersonaTrigger = PersonaTrigger;
export type DbPersonaExecution = PersonaExecution;
export type DbPersonaCredential = PersonaCredential;
export type DbCredentialEvent = CredentialEvent;
export type DbPersonaEvent = PersonaEvent;
export type DbPersonaEventSubscription = PersonaEventSubscription;
export type DbPersonaMetricsSnapshot = PersonaMetricsSnapshot;
export type DbPersonaPromptVersion = PersonaPromptVersion;
export type DbPersonaHealingIssue = PersonaHealingIssue;
export type DbPersonaGroup = PersonaGroup;
export type DbPersonaMemory = PersonaMemory;
export type DbPersonaTeam = PersonaTeam;
export type DbPersonaTeamMember = PersonaTeamMember;
export type DbPersonaDesignReview = PersonaDesignReview;
export type DbConnectorDefinition = RawConnectorDefinition;

// Also re-export the raw binding types by their original names
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

// ── Frontend Enriched Types ────────────────────────────────────────────

/** Persona with associated tools, triggers, and event subscriptions */
export interface PersonaWithDetails extends Persona {
  tools: PersonaToolDefinition[];
  triggers: PersonaTrigger[];
  subscriptions?: PersonaEventSubscription[];
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
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Map a raw PersonaCredential to CredentialMetadata (strip encrypted fields) */
export function toCredentialMetadata(c: PersonaCredential): CredentialMetadata {
  let parsedMetadata: Record<string, unknown> | null = null;
  if (c.metadata) {
    try {
      parsedMetadata = JSON.parse(c.metadata) as Record<string, unknown>;
    } catch {
      parsedMetadata = null;
    }
  }

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

  return {
    id: c.id,
    name: c.name,
    service_type: c.service_type,
    metadata: c.metadata,
    healthcheck_last_success: lastSuccess,
    healthcheck_last_message: lastMessage,
    healthcheck_last_tested_at: lastTestedAt,
    healthcheck_last_success_at: lastSuccessAt,
    last_used_at: c.last_used_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

/** Parsed frontend connector definition (JSON fields pre-parsed) */
export interface ConnectorDefinition {
  id: string;
  name: string;
  label: string;
  icon_url: string | null;
  color: string;
  category: string;
  fields: CredentialTemplateField[];
  healthcheck_config: { description: string; endpoint?: string; method?: string } | null;
  services: { toolName: string; label: string }[];
  events: CredentialTemplateEvent[];
  metadata: Record<string, unknown> | null;
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

// ── Navigation Types ───────────────────────────────────────────────────

export type SidebarSection = "overview" | "personas" | "events" | "credentials" | "design-reviews" | "team" | "cloud";
export type EditorTab = "prompt" | "executions" | "settings";
export type OverviewTab = "system-check" | "executions" | "manual-review" | "messages" | "usage" | "events" | "observability" | "realtime" | "memories" | "budget";
export type TemplateTab = "builtin" | "n8n" | "generated";

// ── Analytics Types ────────────────────────────────────────────────────

export interface ToolUsageSummary {
  tool_name: string;
  total_invocations: number;
  unique_executions: number;
  unique_personas: number;
}

export interface ToolUsageOverTime {
  date: string;
  tool_name: string;
  invocations: number;
}

export interface PersonaUsageSummary {
  persona_id: string;
  persona_name: string;
  persona_icon: string | null;
  persona_color: string | null;
  total_invocations: number;
  unique_tools: number;
}

// ── Execution Output Types ─────────────────────────────────────────────

export interface ExecutionOutputLine {
  line?: string;
  done?: boolean;
  status?: string;
}

// ── Persona Info Mixin (shared across enriched types) ──────────────────

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

// ── Enriched Types (with persona info for global views) ────────────────

export interface ManualReviewItem extends WithPersonaInfo {
  id: string;
  execution_id: string;
  review_type: string;
  content: string;
  severity: string;
  status: string;
  reviewer_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface GlobalExecution extends PersonaExecution, WithPersonaInfo {}

export interface PersonaMessage extends RawPersonaMessage, WithPersonaInfo {}
