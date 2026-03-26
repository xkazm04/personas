/**
 * Types for the Persona Design Analysis system.
 * Used by the Design tab to drive LLM-based prompt generation.
 */

/** A question from the design engine asking for user clarification */
export interface DesignQuestion {
  question: string;
  options?: string[];
  context?: string;
}

/** Structured prompt section (identity, instructions, etc.) */
export interface StructuredPromptSection {
  key: string;
  label: string;
  content: string;
}

/** A structured highlight category from design analysis */
export interface DesignHighlight {
  category: string;
  icon: string;
  color: string;
  items: string[];
  section?: "identity" | "instructions" | "toolGuidance" | "examples" | "errorHandling" | string;
}

/** Enriched connector suggestion from design analysis */
export interface SuggestedConnector {
  name: string;
  setup_url?: string;
  setup_instructions?: string;
  oauth_type?: string;
  credential_fields?: Array<{
    key: string;
    label: string;
    type: "text" | "password" | "url";
    placeholder?: string;
    helpText?: string;
    required?: boolean;
  }>;
  related_tools?: string[];
  related_triggers?: number[];
  /** Functional role this connector fills (e.g., "chat_messaging", "project_tracking") */
  role?: string;
  /** Connector catalog category (e.g., "messaging", "development") */
  category?: string;
}

/** A step in the connector pipeline showing chronological service interactions */
export interface ConnectorPipelineStep {
  connector_name: string;  // matches suggested_connectors[].name
  action_label: string;    // e.g. "Watch alerts", "Notify group"
  order: number;           // 0-based chronological position
}

/**
 * Universal intermediate representation (IR) for agent specifications.
 *
 * Every creation and modification path in the system converges on this schema:
 *   input modality -> AgentIR -> apply(AgentIR)
 *
 * Sources: design chat, wizard compilation, workflow import, template catalog,
 * batch generation, intent compilation.
 *
 * Consumers: scoring, safety scan, variable substitution, adoption,
 * diff/merge/version/rollback, and compilation to runtime drafts.
 */
export interface AgentIR {
  structured_prompt: {
    identity: string;
    instructions: string;
    toolGuidance: string;
    examples: string;
    errorHandling: string;
    customSections: StructuredPromptSection[];
  };
  suggested_tools: string[];
  suggested_triggers: SuggestedTrigger[];
  full_prompt_markdown: string;
  summary: string;
  design_highlights?: DesignHighlight[];
  suggested_connectors?: SuggestedConnector[];
  suggested_notification_channels?: SuggestedNotificationChannel[];
  feasibility?: DesignTestResult;
  suggested_event_subscriptions?: SuggestedEventSubscription[];
  adoption_requirements?: AdoptionRequirement[];
  service_flow?: ConnectorPipelineStep[];
  /** Protocol capabilities detected from workflow node types (structured) */
  protocol_capabilities?: ProtocolCapability[];
  /** Pre-defined use-case-specific questions for template adoption */
  adoption_questions?: AdoptionQuestion[];
}

/** @deprecated Use {@link AgentIR} directly. Kept for backwards compatibility. */
export type DesignAnalysisResult = AgentIR;

/** A notification channel suggestion from design analysis */
export interface SuggestedNotificationChannel {
  type: "slack" | "telegram" | "email";
  description: string;
  required_connector: string;
  config_hints: Record<string, string>;
}

/** A trigger suggestion from design analysis */
export interface SuggestedTrigger {
  trigger_type: "manual" | "schedule" | "polling" | "webhook" | "event";
  config: Record<string, unknown>;
  description: string;
}

// -- Protocol Capabilities -----------------------------------------

/** Protocol message types an agent can use */
export type ProtocolType = 'manual_review' | 'user_message' | 'agent_memory' | 'emit_event';

/** A detected protocol capability with provenance context */
export interface ProtocolCapability {
  type: ProtocolType;
  label: string;
  /** How the capability was detected (node type match, keyword scan, etc.) */
  context: string;
}

/** Phase of the design analysis lifecycle.
 * Canonical FSM definition lives in `@/lib/fsm` (`designPhaseFSM`). */
export type { DesignPhaseState as DesignPhase } from '@/lib/fsm';

/** Result of a design feasibility test */
export interface DesignTestResult {
  confirmed_capabilities: string[];
  issues: string[];
  overall_feasibility: "ready" | "partial" | "blocked";
}

/** An event subscription suggestion from design analysis */
export interface SuggestedEventSubscription {
  event_type: string;
  source_filter?: Record<string, unknown>;
  description: string;
}

/** A requirement that must be fulfilled during template adoption */
export interface AdoptionRequirement {
  key: string;
  label: string;
  description: string;
  type: "text" | "select" | "cron" | "url" | "email" | "number" | "json";
  required: boolean;
  default_value?: string;
  options?: string[];
  source: "connector" | "trigger" | "channel";
}

/** A pre-defined question for template adoption, tied to specific use cases or connectors */
export interface AdoptionQuestion {
  id: string;
  question: string;
  type: 'text' | 'select' | 'boolean';
  options?: string[];
  default?: string;
  context?: string;
  /** Which use case flow IDs this question applies to (shown when those use cases are selected) */
  use_case_ids?: string[];
  /** Which connector names this question is relevant to */
  connector_names?: string[];
  /** Category for grouping: 'domain', 'configuration', 'quality', 'credentials', 'human_in_the_loop', 'memory', 'notifications' */
  category?: string;
  /** Which matrix dimension this question configures (e.g., 'connectors', 'use-cases', 'triggers') */
  dimension?: string;
}

/** Readiness status for a connector in a template */
export interface ConnectorReadinessStatus {
  connector_name: string;
  installed: boolean;
  has_credential: boolean;
  health: "ready" | "missing" | "unhealthy" | "unknown";
}

// -- Intent Compiler Extensions ------------------------------------

/** Use case generated by the intent compiler */
export interface IntentUseCase {
  id: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  sample_input: Record<string, unknown>;
  expected_behavior: string;
  execution_mode: "e2e" | "mock";
  time_filter?: string | null;
}

/** Model recommendation from the intent compiler */
export interface IntentModelRecommendation {
  recommended_model: "haiku" | "sonnet" | "opus";
  reasoning: string;
  estimated_cost_per_run_usd: number;
  complexity_level: "simple" | "moderate" | "complex";
  quality_requirements: string;
}

/** Test scenario generated by the intent compiler */
export interface IntentTestScenario {
  id: string;
  name: string;
  category: "happy_path" | "edge_case" | "error_handling" | "performance";
  input: Record<string, unknown>;
  expected_outcome: string;
  assertions: string[];
}

/** Extended design result from the intent compiler (superset of AgentIR) */
export interface IntentCompilationResult extends AgentIR {
  intent_statement?: string;
  use_cases?: IntentUseCase[];
  model_recommendation?: IntentModelRecommendation;
  test_scenarios?: IntentTestScenario[];
}

// -- Design Conversations ------------------------------------------

/** A single message in a persistent design conversation thread */
export interface DesignConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** UI rendering hint: instruction, feedback, question, answer, result, error */
  messageType?: string;
  timestamp: string;
}

/** A persistent design conversation that accumulates multi-turn context */
export interface DesignConversation {
  id: string;
  personaId: string;
  title: string;
  status: "active" | "completed" | "abandoned";
  /** JSON-serialized DesignConversationMessage[] */
  messages: string;
  lastResult?: string;
  createdAt: string;
  updatedAt: string;
}

/** Helper to parse the messages JSON string from a DesignConversation.
 *  Returns null when the JSON is corrupt/unparseable so callers can
 *  distinguish "no messages" from "parse failure" and avoid overwriting. */
export function parseConversationMessages(messagesJson: string): DesignConversationMessage[] | null {
  try {
    return JSON.parse(messagesJson) as DesignConversationMessage[];
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return null;
  }
}

