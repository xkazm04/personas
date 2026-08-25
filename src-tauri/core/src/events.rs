//! Event-name constants — the single source of truth for every event name
//! emitted between Rust and React.
//!
//! Split out of `engine::event_registry` in crate-split step 4b. The typed
//! `emit_event` helper stays in the engine because it needs `tauri::AppHandle`;
//! these constants do not, and both `db::cdc` and `db::repos` name events, so
//! the table had to sit below the data layer.
//!
//! ## Adding a new event
//! 1. Add an entry to the [`event_names!`] block below.
//! 2. Define (or reuse) a payload struct that derives `Serialize`.
//! 3. Register the (name, payload) pair via `impl TauriEvent` in
//!    `engine::event_registry`.
//! 4. The TypeScript side picks up the new name from `src/lib/eventRegistry.ts`.

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

    // Team assignments (orchestration Phase A)
    TEAM_ASSIGNMENT_PROGRESS   => "team-assignment-progress",

    // Messages
    REPORT_CREATED            => "report-created",
    // Persona channel (channels-v2 W4): fired after a user post lands and
    // again after the persona's reply/failure row lands, so the frontend
    // refreshes the persona conversation. Payload: { persona_id }.
    PERSONA_CHANNEL_MESSAGE   => "persona-channel-message",

    // Design & review
    DESIGN_STATUS              => "design-status",
    DESIGN_OUTPUT              => "design-output",
    DESIGN_REVIEW_STATUS       => "design-review-status",
    DESIGN_REVIEW_OUTPUT       => "design-review-output",
    MANUAL_REVIEW_RESOLVED     => "manual-review-resolved",
    REVIEW_DISPATCH_BLOCKED    => "review-dispatch-blocked",
    REVIEW_MESSAGE_ADDED       => "review-message-added",
    // Persona event-bus signals published when a human review is resolved
    // (by the user OR by Athena). Personas subscribe to drive event-orchestrated
    // continuation after an approval/rejection. Dynamic in code via
    // `format!("review_decision.{status}")`; registered here for discoverability.
    REVIEW_DECISION_APPROVED   => "review_decision.approved",
    REVIEW_DECISION_REJECTED   => "review_decision.rejected",
    REVIEW_DECISION_RESOLVED   => "review_decision.resolved",
    // Published when an incident is resolved (by the user or Athena). Personas
    // subscribe to drive event-orchestrated continuation of the blocked work.
    // Dynamic in code via `format!("incident_resolved")`; registered here for
    // discoverability + the Rust<->TS parity gate.
    INCIDENT_RESOLVED          => "incident_resolved",

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
    TEAM_PRESET_ADOPT_PROGRESS => "team-preset-adopt-progress",

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
    // Dev-tools context-scan lifecycle, published to the persona-event BUS
    // (not the direct context-gen channel) so it surfaces in the Live Stream.
    DEV_TOOLS_CONTEXT_SCAN_STARTED   => "dev_tools.context_scan_started",
    DEV_TOOLS_CONTEXT_SCAN_COMPLETED => "dev_tools.context_scan_completed",
    // Ship planner live-refresh signal. Emitted by `db::cdc` for a write to ANY
    // of the four Ship tables (dev_goals, dev_milestones, dev_milestone_items,
    // dev_use_cases), whoever the writer was — an Athena approval executor, a
    // Fleet session through the management API, the CLI ingest door, or the
    // Ship tab itself. ONE name for four tables on purpose: the frontend's unit
    // of invalidation is the Ship slice, not a table, and the payload (the
    // `CdcEvent` itself: `{action, table, rowid}`) already carries `table` for
    // any listener that wants to filter.
    //
    // The rowid is deliberately NOT resolved to an id in Rust: that costs a
    // query per write and is impossible on DELETE, which is the unbind-a-goal
    // case the planner most needs to see.
    DEV_TOOLS_SHIP_CHANGED     => "dev-tools-ship-changed",
    // The findings loop's SIGNAL events (docs/plans/dev-findings-loop.md). A sensor
    // raised a finding, or a verdict landed on one that shipped. Published on every
    // create_finding / set_finding_verify_state — i.e. from the repo, so no caller
    // can forget to emit and silently starve a route. These are what the dispatch
    // ops (Task Runner vs Fleet) route off.
    SIGNAL_RAISED                    => "signal.raised",
    SIGNAL_VERIFIED                  => "signal.verified",
    // Findings-loop system-op requests (engine/system_ops.rs re-exports these):
    // a scheduled `health_ingest` op asks the app to sweep sensors + verify
    // shipped findings; a `signal_dispatch_*` op asks for work to start on one.
    HEALTH_INGEST_REQUESTED          => "health-ingest-requested",
    SIGNAL_DISPATCH_REQUESTED        => "signal-dispatch-requested",
    IDEA_SCAN_STATUS           => "idea-scan-status",
    IDEA_SCAN_OUTPUT           => "idea-scan-output",
    IDEA_SCAN_COMPLETE         => "idea-scan-complete",
    // Workspace divergence pass (cross-project practice synthesis)
    DIVERGENCE_SCAN_STATUS     => "divergence-scan-status",
    DIVERGENCE_SCAN_OUTPUT     => "divergence-scan-output",
    // Adoption verification (does an adopted practice still hold in the repo?)
    VERIFY_SCAN_STATUS         => "verify-scan-status",
    VERIFY_SCAN_OUTPUT         => "verify-scan-output",
    KPI_SCAN_STATUS            => "kpi-scan-status",
    KPI_SCAN_OUTPUT            => "kpi-scan-output",
    KPI_SCAN_COMPLETE          => "kpi-scan-complete",
    // Use-case proposal scan (behavioral slice layer under the context map)
    USE_CASE_SCAN_STATUS       => "use-case-scan-status",
    USE_CASE_SCAN_OUTPUT       => "use-case-scan-output",
    USE_CASE_SCAN_COMPLETE     => "use-case-scan-complete",
    // KPI measurement compose/propose (Factory measurement setup)
    KPI_COMPOSE_STATUS         => "kpi-compose-status",
    KPI_COMPOSE_OUTPUT         => "kpi-compose-output",

    // Task executor
    TASK_EXEC_STATUS           => "task-exec-status",
    TASK_EXEC_OUTPUT           => "task-exec-output",
    TASK_EXEC_COMPLETE         => "task-exec-complete",

    // Twin Training Studio (background batch question/answer generation)
    TWIN_STUDIO_STATUS         => "twin-studio-status",
    TWIN_STUDIO_OUTPUT         => "twin-studio-output",
    TWIN_STUDIO_PROGRESS       => "twin-studio-progress",
    TWIN_STUDIO_COMPLETE       => "twin-studio-complete",

    // Auto-run scheduler (drains backlog respecting goal-DAG)
    AUTO_RUN_STATUS            => "auto-run-status",
    AUTO_RUN_COMPLETE          => "auto-run-complete",

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
    EXECUTIONS_SILENT_DETECTED => "executions-silent-detected",
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
    // Payload: the full Vec<DevicePairingRequest> of pairings awaiting a
    // decision. Sent as the whole list (not a delta) so a listener that missed
    // an earlier event still converges on the right state.
    DEVICE_PAIRING_REQUESTED   => "network:device-pairing-requested",
    // Payload: the single `RemoteJob` row that just changed (created, acked,
    // progressed, finished). Emitted on BOTH roles, so one listener drives the
    // "I asked" and "I was asked" halves of the UI. Fired only on a genuine
    // state change — a note redelivered after a reconnect is applied silently.
    REMOTE_JOB_UPDATED         => "network:remote-job-updated",
    // Payload: `RemoteJobTurnEvent` — the answering turn for a job another
    // paired device asked THIS one to run, started or finished. That turn runs
    // with `suppress_chat`, so this is the ONLY signal the frontend gets; the
    // ambient orb notice hangs off it. Distinct from REMOTE_JOB_UPDATED, which
    // is the durable `remote_jobs` row changing on both roles.
    //
    // Emitted from `companion::remote_jobs` via
    // `companion::session::REMOTE_JOB_TURN_EVENT`, which is the `p2p`-gated
    // const holding this same string.
    REMOTE_JOB_TURN            => "companion://remote-job-turn",

    // Notification delivery
    NOTIFICATION_DELIVERY      => "notification-delivery",

    // Credential reauth (OAuth grant revoked)
    CREDENTIAL_REAUTH_REQUIRED => "credential-reauth-required",

    // Credential reauth resolved (grant restored via successful re-auth/recapture)
    CREDENTIAL_REAUTH_RESOLVED => "credential-reauth-resolved",

    // Share link (deep link received from OS)
    SHARE_LINK_RECEIVED        => "share-link-received",

    // Gallery import (personas://import/<slug> deep link received from OS)
    GALLERY_IMPORT_REQUESTED   => "gallery-import-requested",

    // Referral (personas://ref/<code> deep link received from OS)
    REFERRAL_RECEIVED          => "referral-received",

    // Cloud-app pairing request (personas://pair deep link or POST /pair/request)
    PAIRING_REQUESTED          => "pairing-requested",

    // Engine fallback (unrecognized engine setting)
    ENGINE_FALLBACK            => "engine-fallback",

    // CLI version warning (Claude Code CLI below minimum required version)
    CLI_VERSION_WARNING        => "cli-version-warning",

    // Persona health (push-based summary refresh signal)
    PERSONA_HEALTH_CHANGED     => "persona-health-changed",

    // SLA reliability breach (published to the persona-event BUS by
    // `engine::sla_breach` on the execution-completion path; zero-config
    // thresholds, one enter-event + one recovery per episode).
    SLA_BREACH_OPENED          => "sla.breach.opened",
    SLA_BREACH_RECOVERED       => "sla.breach.recovered",

    // Process activity (unified lifecycle signal for background processes)
    PROCESS_ACTIVITY           => "process-activity",

    // Titlebar notification (persona message delivery — v3.2 DELIV-02)
    TITLEBAR_NOTIFICATION      => "titlebar-notification",

    // One-shot build terminal phase reached (Promoted | Failed). Frontend
    // listener adds an entry to the notification bell with a deep-link to
    // the persona's draft so the user can review what landed.
    BUILD_ONESHOT_TERMINAL     => "build-oneshot-terminal",

    // Obsidian Brain — Revitalize (background vault memory optimization)
    OBSIDIAN_REVITALIZE_STATUS => "obsidian-revitalize-status",
    OBSIDIAN_REVITALIZE_OUTPUT => "obsidian-revitalize-output",

    // Fleet plugin (DEV-only Claude Code session aggregator)
    FLEET_SESSION_OUTPUT       => "fleet-session-output",
    FLEET_SESSION_STATE        => "fleet-session-state",
    FLEET_SESSION_EXITED       => "fleet-session-exited",
    FLEET_REGISTRY_CHANGED     => "fleet-registry-changed",
}
