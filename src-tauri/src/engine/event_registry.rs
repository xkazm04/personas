//! Typed Tauri event registry.
//!
//! Single source of truth for every event name emitted between Rust and React.
//! Each variant carries its event name as a `&'static str` via [`TauriEvent::NAME`],
//! and the payload type is enforced by the generic on [`emit_event`].
//!
//! ## Adding a new event
//! 1. Add a variant to [`TauriEventName`].
//! 2. Add a corresponding entry in the [`event_name!`] block.
//! 3. Define (or reuse) a payload struct that derives `Serialize`.
//! 4. Register the (name, payload) pair via [`impl TauriEvent for YourPayload`].
//! 5. The TypeScript side picks up the new name from `src/lib/eventRegistry.ts`.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

macro_rules! event_names {
    ($($const_name:ident => $str:literal),* $(,)?) => {
        /// Compile-time event name constants.
        ///
        /// Use these instead of raw string literals so typos become compile errors.
        #[allow(dead_code)]
        pub mod event_name {
            $(pub const $const_name: &str = $str;)*
        }

        /// All registered event names (for diagnostics / exhaustiveness checks).
        #[allow(dead_code)]
        pub const ALL_EVENT_NAMES: &[&str] = &[$($str),*];
    };
}

event_names! {
    // Execution core
    EXECUTION_OUTPUT           => "execution-output",
    EXECUTION_STATUS           => "execution-status",
    EXECUTION_EVENT            => "execution-event",
    EXECUTION_TRACE_SPAN       => "execution-trace-span",
    EXECUTION_TRACE            => "execution-trace",
    EXECUTION_HEARTBEAT        => "execution-heartbeat",
    EXECUTION_FILE_CHANGE      => "execution-file-change",
    EXECUTION_PROGRESS         => "execution-progress",
    EXECUTION_REVIEW_REQUEST   => "execution-review-request",

    // Queue
    QUEUE_STATUS               => "queue-status",

    // Auth
    AUTH_STATE_CHANGED         => "auth-state-changed",
    AUTH_ERROR                 => "auth-error",

    // Healing
    HEALING_EVENT              => "healing-event",
    HEALING_ISSUE_UPDATED      => "healing-issue-updated",
    AUTO_FIX_COMPLETED         => "auto-fix-completed",
    AI_HEALING_STATUS          => "ai-healing-status",
    AI_HEALING_OUTPUT          => "ai-healing-output",

    // Circuit breaker
    CIRCUIT_BREAKER_TRANSITION       => "circuit-breaker-transition",
    CIRCUIT_BREAKER_GLOBAL_TRIPPED   => "circuit-breaker-global-tripped",

    // Event bus
    EVENT_BUS                  => "event-bus",

    // Messages
    MESSAGE_CREATED            => "message-created",

    // Design & review
    DESIGN_STATUS              => "design-status",
    DESIGN_OUTPUT              => "design-output",
    DESIGN_REVIEW_STATUS       => "design-review-status",
    DESIGN_REVIEW_OUTPUT       => "design-review-output",
    MANUAL_REVIEW_RESOLVED     => "manual-review-resolved",
    REVIEW_MESSAGE_ADDED       => "review-message-added",

    // Build session
    BUILD_SESSION_EVENT        => "build-session-event",
    BUILD_TEST_TOOL_RESULT     => "build-test-tool-result",

    // Test runner
    TEST_RUN_STATUS            => "test-run-status",
    N8N_TEST_STATUS            => "n8n-test-status",
    N8N_TEST_OUTPUT            => "n8n-test-output",

    // N8N transform
    N8N_TRANSFORM_STATUS       => "n8n-transform-status",
    N8N_TRANSFORM_OUTPUT       => "n8n-transform-output",
    N8N_TRANSFORM_SECTION      => "n8n-transform-section",

    // Template generation & adoption
    TEMPLATE_GENERATE_STATUS   => "template-generate-status",
    TEMPLATE_GENERATE_OUTPUT   => "template-generate-output",
    TEMPLATE_ADOPT_STATUS      => "template-adopt-status",
    TEMPLATE_ADOPT_OUTPUT      => "template-adopt-output",

    // Knowledge base
    KB_INGEST_PROGRESS         => "kb:ingest_progress",
    KB_INGEST_COMPLETE         => "kb:ingest_complete",
    KB_INGEST_ERROR            => "kb:ingest_error",

    // Credential automation
    AUTO_CRED_BROWSER_STATUS   => "auto-cred-browser-status",
    AUTO_CRED_BROWSER_PROGRESS => "auto-cred-browser-progress",
    AUTO_CRED_OPEN_URL         => "auto-cred-open-url",

    // Credential design & negotiation
    CREDENTIAL_DESIGN_STATUS       => "credential-design-status",
    CREDENTIAL_DESIGN_OUTPUT       => "credential-design-output",
    CREDENTIAL_NEGOTIATION_STATUS  => "credential-negotiation-status",
    CREDENTIAL_NEGOTIATION_PROGRESS => "credential-negotiation-progress",
    AUTOMATION_DESIGN_STATUS       => "automation-design-status",

    // Database query tools
    NL_QUERY_STATUS            => "nl-query-status",
    NL_QUERY_OUTPUT            => "nl-query-output",
    QUERY_DEBUG_STATUS         => "query-debug-status",
    QUERY_DEBUG_OUTPUT         => "query-debug-output",
    SCHEMA_PROPOSAL_STATUS     => "schema-proposal-status",
    SCHEMA_PROPOSAL_OUTPUT     => "schema-proposal-output",

    // Setup / installer
    SETUP_OUTPUT               => "setup-output",
    SETUP_STATUS               => "setup-status",

    // Context generation & idea scanning
    CONTEXT_GEN_STATUS         => "context-gen-status",
    CONTEXT_GEN_OUTPUT         => "context-gen-output",
    CONTEXT_GEN_COMPLETE       => "context-gen-complete",
    IDEA_SCAN_STATUS           => "idea-scan-status",
    IDEA_SCAN_OUTPUT           => "idea-scan-output",
    IDEA_SCAN_COMPLETE         => "idea-scan-complete",

    // Task executor
    TASK_EXEC_STATUS           => "task-exec-status",
    TASK_EXEC_OUTPUT           => "task-exec-output",
    TASK_EXEC_COMPLETE         => "task-exec-complete",

    // Artist creative session
    ARTIST_SESSION_STATUS      => "artist-session-status",
    ARTIST_SESSION_OUTPUT      => "artist-session-output",
    ARTIST_SESSION_COMPLETE    => "artist-session-complete",

    // Media Studio export
    MEDIA_EXPORT_STATUS        => "media-export-status",
    MEDIA_EXPORT_OUTPUT        => "media-export-output",
    MEDIA_EXPORT_PROGRESS      => "media-export-progress",
    MEDIA_EXPORT_COMPLETE      => "media-export-complete",

    // Recipe
    RECIPE_EXECUTION_STATUS    => "recipe-execution-status",
    RECIPE_GENERATION_STATUS   => "recipe-generation-status",
    RECIPE_VERSIONING_STATUS   => "recipe-versioning-status",

    // Rotation
    ROTATION_COMPLETED         => "rotation-completed",
    ROTATION_ANOMALY           => "rotation-anomaly",

    // Background monitoring
    OVERDUE_TRIGGERS_FIRED     => "overdue-triggers-fired",
    ZOMBIE_EXECUTIONS_DETECTED => "zombie-executions-detected",
    AUTO_ROLLBACK_TRIGGERED    => "auto-rollback-triggered",
    SUBSCRIPTION_CRASHED       => "subscription-crashed",

    // Relay
    CLOUD_WEBHOOK_RELAY_STATUS => "cloud-webhook-relay-status",
    SMEE_RELAY_STATUS          => "smee-relay-status",

    // Context rules
    CONTEXT_RULE_MATCH         => "context-rule-match",

    // Clipboard watcher (ambient agent)
    CLIPBOARD_ERROR_DETECTED   => "clipboard-error-detected",

    // Assertion results
    ASSERTION_RESULTS          => "assertion-results",

    // Pipeline
    PIPELINE_STATUS            => "pipeline-status",
    PIPELINE_CYCLE_WARNING     => "pipeline-cycle-warning",
    PIPELINE_APPROVAL_NEEDED   => "pipeline-approval-needed",

    // P2P
    P2P_MANIFEST_SYNC_PROGRESS => "p2p:manifest-sync-progress",
    NETWORK_SNAPSHOT_UPDATED   => "network:snapshot-updated",

    // Notification delivery
    NOTIFICATION_DELIVERY      => "notification-delivery",

    // Credential reauth (OAuth grant revoked)
    CREDENTIAL_REAUTH_REQUIRED => "credential-reauth-required",

    // Share link (deep link received from OS)
    SHARE_LINK_RECEIVED        => "share-link-received",

    // Engine fallback (unrecognized engine setting)
    ENGINE_FALLBACK            => "engine-fallback",

    // CLI version warning (Claude Code CLI below minimum required version)
    CLI_VERSION_WARNING        => "cli-version-warning",

    // Persona health (push-based summary refresh signal)
    PERSONA_HEALTH_CHANGED     => "persona-health-changed",

    // Process activity (unified lifecycle signal for background processes)
    PROCESS_ACTIVITY           => "process-activity",

    // Titlebar notification (persona message delivery — v3.2 DELIV-02)
    TITLEBAR_NOTIFICATION      => "titlebar-notification",
}

// ---------------------------------------------------------------------------
// Typed emit helper
// ---------------------------------------------------------------------------

/// Emit a typed event to the frontend. The event name is derived from the
/// constant, ensuring compile-time correctness.
///
/// ```rust,ignore
/// use crate::engine::event_registry::{emit_event, event_name};
/// emit_event(&app, event_name::EXECUTION_OUTPUT, &my_payload);
/// ```
pub fn emit_event<P: Serialize + Clone>(app: &AppHandle, event: &str, payload: &P) {
    let _ = app.emit(event, payload.clone());
}

/// Emit a [`PersonaEvent`] to the frontend event bus (`event-bus` channel).
///
/// Logs a warning if the emit fails. This is the canonical way to push events
/// to the React event-bus listener — prefer this over raw `app.emit()` calls.
pub fn emit_event_bus(app: &AppHandle, event: &crate::db::models::PersonaEvent) {
    if let Err(e) = app.emit(event_name::EVENT_BUS, event.clone()) {
        tracing::warn!(event_id = %event.id, error = %e, "Failed to emit event-bus event");
    }
}

/// Like [`emit_event`] but propagates the emit error instead of swallowing it.
#[allow(dead_code)]
pub fn try_emit_event<P: Serialize + Clone>(
    app: &AppHandle,
    event: &str,
    payload: &P,
) -> Result<(), tauri::Error> {
    app.emit(event, payload.clone())
}

// ---------------------------------------------------------------------------
// Re-export payload types for convenient single-import
// ---------------------------------------------------------------------------

#[allow(unused_imports)]
pub use super::types::{
    ExecutionOutputEvent, ExecutionStatusEvent, QueueStatusEvent,
    HeartbeatEvent, StructuredExecutionEvent, HealingEventPayload,
    HealingIssueUpdatedEvent, AiHealingStatusEvent,
};
#[allow(unused_imports)]
pub use super::failover::{CircuitTransitionEvent, CircuitBreakerStatus};
#[allow(unused_imports)]
pub use super::auto_rollback::AutoRollbackEvent;
#[allow(unused_imports)]
pub use super::background::{
    SubscriptionCrashEvent, OverdueTriggersEvent, ZombieExecutionEvent,
};
#[allow(unused_imports)]
pub use super::trace::TraceSpanEvent;
