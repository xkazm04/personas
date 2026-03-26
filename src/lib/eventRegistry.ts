/**
 * Typed Tauri Event Registry.
 *
 * Single source of truth for every Tauri event name used between
 * Rust and React. Mirrors `src-tauri/src/engine/event_registry.rs`.
 *
 * ## Adding a new event
 * 1. Add the name constant to `EventName`.
 * 2. Add the payload type to `EventPayloadMap`.
 * 3. Use `typedListen()` / `typedEmit()` instead of raw `listen()` / `emit()`.
 */

import { listen, emit, type UnlistenFn, type Event } from '@tauri-apps/api/event';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { CircuitBreakerStatus } from '@/lib/bindings/CircuitBreakerStatus';
import type { CircuitTransitionEvent } from '@/lib/bindings/CircuitTransitionEvent';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { AuthStateResponse } from '@/lib/bindings/AuthStateResponse';

// ---------------------------------------------------------------------------
// Event name constants (keep in sync with Rust event_registry::event_name)
// ---------------------------------------------------------------------------

export const EventName = {
  // Execution core
  EXECUTION_OUTPUT: 'execution-output',
  EXECUTION_STATUS: 'execution-status',
  EXECUTION_EVENT: 'execution-event',
  EXECUTION_TRACE_SPAN: 'execution-trace-span',
  EXECUTION_TRACE: 'execution-trace',
  EXECUTION_HEARTBEAT: 'execution-heartbeat',
  EXECUTION_FILE_CHANGE: 'execution-file-change',
  EXECUTION_PROGRESS: 'execution-progress',
  EXECUTION_REVIEW_REQUEST: 'execution-review-request',

  // Queue
  QUEUE_STATUS: 'queue-status',

  // Auth
  AUTH_STATE_CHANGED: 'auth-state-changed',
  AUTH_ERROR: 'auth-error',

  // Healing
  HEALING_EVENT: 'healing-event',
  AI_HEALING_STATUS: 'ai-healing-status',
  AI_HEALING_OUTPUT: 'ai-healing-output',

  // Circuit breaker
  CIRCUIT_BREAKER_TRANSITION: 'circuit-breaker-transition',
  CIRCUIT_BREAKER_GLOBAL_TRIPPED: 'circuit-breaker-global-tripped',

  // Event bus
  EVENT_BUS: 'event-bus',

  // Messages
  MESSAGE_CREATED: 'message-created',

  // Design & review
  DESIGN_STATUS: 'design-status',
  DESIGN_OUTPUT: 'design-output',
  DESIGN_REVIEW_STATUS: 'design-review-status',
  DESIGN_REVIEW_OUTPUT: 'design-review-output',
  MANUAL_REVIEW_RESOLVED: 'manual-review-resolved',
  REVIEW_MESSAGE_ADDED: 'review-message-added',

  // Build session
  BUILD_SESSION_EVENT: 'build-session-event',
  BUILD_TEST_TOOL_RESULT: 'build-test-tool-result',

  // Test runner
  TEST_RUN_STATUS: 'test-run-status',
  N8N_TEST_STATUS: 'n8n-test-status',
  N8N_TEST_OUTPUT: 'n8n-test-output',

  // N8N transform
  N8N_TRANSFORM_STATUS: 'n8n-transform-status',
  N8N_TRANSFORM_OUTPUT: 'n8n-transform-output',
  N8N_TRANSFORM_SECTION: 'n8n-transform-section',

  // Template generation & adoption
  TEMPLATE_GENERATE_STATUS: 'template-generate-status',
  TEMPLATE_GENERATE_OUTPUT: 'template-generate-output',
  TEMPLATE_ADOPT_STATUS: 'template-adopt-status',
  TEMPLATE_ADOPT_OUTPUT: 'template-adopt-output',

  // Knowledge base
  KB_INGEST_PROGRESS: 'kb:ingest_progress',
  KB_INGEST_COMPLETE: 'kb:ingest_complete',
  KB_INGEST_ERROR: 'kb:ingest_error',

  // Credential automation
  AUTO_CRED_BROWSER_STATUS: 'auto-cred-browser-status',
  AUTO_CRED_BROWSER_PROGRESS: 'auto-cred-browser-progress',
  AUTO_CRED_OPEN_URL: 'auto-cred-open-url',

  // Credential design & negotiation
  CREDENTIAL_DESIGN_STATUS: 'credential-design-status',
  CREDENTIAL_DESIGN_OUTPUT: 'credential-design-output',
  CREDENTIAL_NEGOTIATION_STATUS: 'credential-negotiation-status',
  CREDENTIAL_NEGOTIATION_PROGRESS: 'credential-negotiation-progress',
  AUTOMATION_DESIGN_STATUS: 'automation-design-status',

  // Database query tools
  NL_QUERY_STATUS: 'nl-query-status',
  NL_QUERY_OUTPUT: 'nl-query-output',
  QUERY_DEBUG_STATUS: 'query-debug-status',
  QUERY_DEBUG_OUTPUT: 'query-debug-output',
  SCHEMA_PROPOSAL_STATUS: 'schema-proposal-status',
  SCHEMA_PROPOSAL_OUTPUT: 'schema-proposal-output',

  // Setup / installer
  SETUP_OUTPUT: 'setup-output',
  SETUP_STATUS: 'setup-status',

  // Context generation & idea scanning
  CONTEXT_GEN_STATUS: 'context-gen-status',
  CONTEXT_GEN_OUTPUT: 'context-gen-output',
  CONTEXT_GEN_COMPLETE: 'context-gen-complete',
  IDEA_SCAN_STATUS: 'idea-scan-status',
  IDEA_SCAN_OUTPUT: 'idea-scan-output',
  IDEA_SCAN_COMPLETE: 'idea-scan-complete',

  // Task executor
  TASK_EXEC_STATUS: 'task-exec-status',
  TASK_EXEC_OUTPUT: 'task-exec-output',
  TASK_EXEC_COMPLETE: 'task-exec-complete',

  // Recipe
  RECIPE_EXECUTION_STATUS: 'recipe-execution-status',
  RECIPE_GENERATION_STATUS: 'recipe-generation-status',
  RECIPE_VERSIONING_STATUS: 'recipe-versioning-status',

  // Rotation
  ROTATION_COMPLETED: 'rotation-completed',
  ROTATION_ANOMALY: 'rotation-anomaly',

  // Background monitoring
  OVERDUE_TRIGGERS_FIRED: 'overdue-triggers-fired',
  ZOMBIE_EXECUTIONS_DETECTED: 'zombie-executions-detected',
  AUTO_ROLLBACK_TRIGGERED: 'auto-rollback-triggered',
  SUBSCRIPTION_CRASHED: 'subscription-crashed',

  // Relay
  CLOUD_WEBHOOK_RELAY_STATUS: 'cloud-webhook-relay-status',
  SMEE_RELAY_STATUS: 'smee-relay-status',

  // Context rules
  CONTEXT_RULE_MATCH: 'context-rule-match',

  // Assertion results
  ASSERTION_RESULTS: 'assertion-results',

  // Pipeline
  PIPELINE_STATUS: 'pipeline-status',

  // P2P
  P2P_MANIFEST_SYNC_PROGRESS: 'p2p:manifest-sync-progress',
  NETWORK_SNAPSHOT_UPDATED: 'network:snapshot-updated',

  // Notification delivery
  NOTIFICATION_DELIVERY: 'notification-delivery',

  // Credential reauth (OAuth grant revoked)
  CREDENTIAL_REAUTH_REQUIRED: 'credential-reauth-required',

  // Share link (deep link received from OS)
  SHARE_LINK_RECEIVED: 'share-link-received',

  // System trace (frontend-only, emitted by systemTrace module)
  SYSTEM_TRACE_UPDATED: 'system-trace-updated',
} as const;

export type EventNameValue = (typeof EventName)[keyof typeof EventName];

// ---------------------------------------------------------------------------
// Payload type map
// ---------------------------------------------------------------------------

/** Payload shapes for each event, keyed by the event name string. */
export interface EventPayloadMap {
  // Execution core
  [EventName.EXECUTION_OUTPUT]: { execution_id: string; line: string };
  [EventName.EXECUTION_STATUS]: {
    execution_id: string;
    status: string;
    error?: string;
    duration_ms?: number;
    cost_usd?: number;
  };
  [EventName.EXECUTION_EVENT]: { type: string; execution_id: string; [key: string]: unknown };
  [EventName.EXECUTION_TRACE_SPAN]: {
    execution_id: string;
    span: TraceSpan;
    event_type: string;
  };
  [EventName.EXECUTION_TRACE]: ExecutionTrace;
  [EventName.EXECUTION_HEARTBEAT]: {
    execution_id: string;
    elapsed_ms: number;
    silence_ms: number;
  };
  [EventName.EXECUTION_FILE_CHANGE]: {
    execution_id: string;
    path: string;
    change_type: string;
  };
  [EventName.EXECUTION_PROGRESS]: { execution_id: string; progress: Record<string, unknown> };
  [EventName.EXECUTION_REVIEW_REQUEST]: {
    execution_id: string;
    reviews: unknown[];
  };

  // Queue
  [EventName.QUEUE_STATUS]: {
    execution_id: string;
    persona_id: string;
    action: string;
    position?: number;
    queue_depth: number;
  };

  // Auth
  [EventName.AUTH_STATE_CHANGED]: AuthStateResponse;
  [EventName.AUTH_ERROR]: { error: string };

  // Healing
  [EventName.HEALING_EVENT]: Record<string, unknown>;
  [EventName.AI_HEALING_STATUS]: {
    execution_id: string;
    persona_id: string;
    phase: string;
    diagnosis?: string;
    fixes_applied?: string[];
    should_retry?: boolean;
  };
  [EventName.AI_HEALING_OUTPUT]: {
    execution_id: string;
    persona_id: string;
    line: string;
  };

  // Circuit breaker
  [EventName.CIRCUIT_BREAKER_TRANSITION]: CircuitTransitionEvent;
  [EventName.CIRCUIT_BREAKER_GLOBAL_TRIPPED]: CircuitBreakerStatus;

  // Event bus
  [EventName.EVENT_BUS]: PersonaEvent;

  // Messages
  [EventName.MESSAGE_CREATED]: PersonaMessage;

  // Design & review
  [EventName.DESIGN_STATUS]: Record<string, unknown>;
  [EventName.DESIGN_OUTPUT]: { line: string };
  [EventName.DESIGN_REVIEW_STATUS]: Record<string, unknown>;
  [EventName.DESIGN_REVIEW_OUTPUT]: Record<string, unknown>;
  [EventName.MANUAL_REVIEW_RESOLVED]: Record<string, unknown>;
  [EventName.REVIEW_MESSAGE_ADDED]: Record<string, unknown>;

  // Build session
  [EventName.BUILD_SESSION_EVENT]: {
    type: string;
    session_id: string;
    [key: string]: unknown;
  };
  [EventName.BUILD_TEST_TOOL_RESULT]: Record<string, unknown>;

  // Test runner
  [EventName.TEST_RUN_STATUS]: Record<string, unknown>;
  [EventName.N8N_TEST_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.N8N_TEST_OUTPUT]: { job_id: string; line: string };

  // N8N transform
  [EventName.N8N_TRANSFORM_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.N8N_TRANSFORM_OUTPUT]: { job_id: string; line: string };
  [EventName.N8N_TRANSFORM_SECTION]: { transformId: string; section: Record<string, unknown> };

  // Template generation & adoption
  [EventName.TEMPLATE_GENERATE_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.TEMPLATE_GENERATE_OUTPUT]: { job_id: string; line: string };
  [EventName.TEMPLATE_ADOPT_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.TEMPLATE_ADOPT_OUTPUT]: { job_id: string; line: string };

  // Knowledge base
  [EventName.KB_INGEST_PROGRESS]: Record<string, unknown>;
  [EventName.KB_INGEST_COMPLETE]: Record<string, unknown>;
  [EventName.KB_INGEST_ERROR]: { jobId: string; error: string };

  // Credential automation
  [EventName.AUTO_CRED_BROWSER_STATUS]: { session_id: string; status: string };
  [EventName.AUTO_CRED_BROWSER_PROGRESS]: {
    session_id: string;
    type: string;
    message: string;
  };
  [EventName.AUTO_CRED_OPEN_URL]: { session_id: string; url: string };

  // Credential design & negotiation (BackgroundJob pattern)
  [EventName.CREDENTIAL_DESIGN_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.CREDENTIAL_DESIGN_OUTPUT]: { job_id: string; line: string };
  [EventName.CREDENTIAL_NEGOTIATION_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.CREDENTIAL_NEGOTIATION_PROGRESS]: { job_id: string; line: string };
  [EventName.AUTOMATION_DESIGN_STATUS]: { job_id: string; status: string; error?: string };

  // Database query tools (BackgroundJob pattern)
  [EventName.NL_QUERY_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.NL_QUERY_OUTPUT]: { job_id: string; line: string };
  [EventName.QUERY_DEBUG_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.QUERY_DEBUG_OUTPUT]: { job_id: string; line: string };
  [EventName.SCHEMA_PROPOSAL_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.SCHEMA_PROPOSAL_OUTPUT]: { job_id: string; line: string };

  // Setup
  [EventName.SETUP_OUTPUT]: { install_id: string; line: string };
  [EventName.SETUP_STATUS]: { install_id: string; status: string };

  // Context gen & idea scan (BackgroundJob pattern)
  [EventName.CONTEXT_GEN_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.CONTEXT_GEN_OUTPUT]: { job_id: string; line: string };
  [EventName.CONTEXT_GEN_COMPLETE]: Record<string, unknown>;
  [EventName.IDEA_SCAN_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.IDEA_SCAN_OUTPUT]: { job_id: string; line: string };
  [EventName.IDEA_SCAN_COMPLETE]: Record<string, unknown>;

  // Task executor (BackgroundJob pattern)
  [EventName.TASK_EXEC_STATUS]: { job_id: string; status: string; error?: string };
  [EventName.TASK_EXEC_OUTPUT]: { job_id: string; line: string };
  [EventName.TASK_EXEC_COMPLETE]: { task_id: string; output_lines: number };

  // Recipe
  [EventName.RECIPE_EXECUTION_STATUS]: { recipe_id: string; status: string };
  [EventName.RECIPE_GENERATION_STATUS]: { recipe_id: string; status: string };
  [EventName.RECIPE_VERSIONING_STATUS]: { recipe_id: string; status: string };

  // Rotation
  [EventName.ROTATION_COMPLETED]: { credential_id: string; status: string; timestamp: string };
  [EventName.ROTATION_ANOMALY]: {
    credential_id: string;
    anomaly_type: string;
    remediation: string;
  };

  // Background monitoring
  [EventName.OVERDUE_TRIGGERS_FIRED]: { trigger_ids: string[] };
  [EventName.ZOMBIE_EXECUTIONS_DETECTED]: { zombie_ids: string[]; count: number };
  [EventName.AUTO_ROLLBACK_TRIGGERED]: {
    personaId: string;
    personaName: string;
    fromVersion: number;
    toVersion: number;
    currentErrorRate: number;
    previousErrorRate: number;
  };
  [EventName.SUBSCRIPTION_CRASHED]: {
    name: string;
    panic_message: string;
    consecutive_panics: number;
  };

  // Relay
  [EventName.CLOUD_WEBHOOK_RELAY_STATUS]: Record<string, unknown>;
  [EventName.SMEE_RELAY_STATUS]: Record<string, unknown>;

  // Context rules
  [EventName.CONTEXT_RULE_MATCH]: Record<string, unknown>;

  // Assertion results
  [EventName.ASSERTION_RESULTS]: Record<string, unknown>;

  // Pipeline
  [EventName.PIPELINE_STATUS]: Record<string, unknown>;

  // P2P
  [EventName.P2P_MANIFEST_SYNC_PROGRESS]: {
    sync_id: string;
    synced: number;
    total: number;
  };
  [EventName.NETWORK_SNAPSHOT_UPDATED]: {
    status: import('@/api/network/discovery').NetworkStatusInfo;
    health: import('@/api/network/discovery').ConnectionHealth;
    discoveredPeers: import('@/api/network/discovery').DiscoveredPeer[];
    messagingMetrics: import('@/api/network/discovery').MessagingMetrics;
    connectionMetrics: import('@/api/network/discovery').ConnectionMetricsSnapshot;
    manifestSyncMetrics: import('@/api/network/discovery').ManifestSyncMetrics;
  };

  // Notification delivery
  [EventName.NOTIFICATION_DELIVERY]: {
    channelType: string;
    success: boolean;
    latencyMs: number;
    error: string | null;
    consecutiveFailures: number;
  };

  // Credential reauth (OAuth grant revoked)
  [EventName.CREDENTIAL_REAUTH_REQUIRED]: {
    credentialId: string;
    credentialName: string;
    serviceType: string;
    reason: string;
  };

  // Share link
  [EventName.SHARE_LINK_RECEIVED]: {
    url: string;
  };

  // System trace
  [EventName.SYSTEM_TRACE_UPDATED]: {
    trace_id: string;
    operation_type: string;
    event_type: 'started' | 'span_update' | 'completed';
  };
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

/**
 * Type-safe wrapper around Tauri's `listen()`.
 *
 * ```ts
 * const unlisten = await typedListen(EventName.EXECUTION_OUTPUT, (payload) => {
 *   // payload is typed as { execution_id: string; line: string }
 *   console.log(payload.line);
 * });
 * ```
 */
export function typedListen<K extends keyof EventPayloadMap>(
  event: K,
  handler: (payload: EventPayloadMap[K], raw: Event<EventPayloadMap[K]>) => void,
): Promise<UnlistenFn> {
  return listen<EventPayloadMap[K]>(event, (e) => {
    handler(e.payload, e);
  });
}

/**
 * Type-safe wrapper around Tauri's `emit()`.
 */
export function typedEmit<K extends keyof EventPayloadMap>(
  event: K,
  payload: EventPayloadMap[K],
): Promise<void> {
  return emit(event, payload);
}
