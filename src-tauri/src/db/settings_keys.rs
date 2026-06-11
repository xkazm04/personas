//! Canonical settings key constants for the `app_settings` table.
//!
//! Use these instead of raw string literals to prevent typo-based key mismatches.
//!
//! ## Defaults and units
//!
//! Every key defined here is paired with a `<KEY>_DEFAULT` constant that holds
//! the fallback value used when the row is missing from `app_settings`. Consumers
//! MUST reference the `_DEFAULT` constant rather than hard-coding a literal, so
//! that "what does unset mean for this key?" has exactly one answer. Units are
//! encoded in the key name itself (`_DAYS`, `_MS`, ...) — do not rename a key
//! without also changing the unit.
//!
//! ## Validation
//!
//! - [`validate_key`] — rejects unknown keys and malformed prefix keys.
//! - [`validate_value`] — rejects malformed values for keys with a typed
//!   contract (numeric retention values, ms durations, ...).
//!
//! Both are enforced in [`crate::db::repos::core::settings::set`] so that the
//! repo layer cannot be bypassed by internal callers.

// =============================================================================
// Exact keys
// =============================================================================

/// Ollama Cloud API key (free tier models like Qwen3, GLM-5, Kimi K2.5).
pub const OLLAMA_API_KEY: &str = "ollama_api_key";

/// LiteLLM proxy base URL (e.g., `http://localhost:4000`).
pub const LITELLM_BASE_URL: &str = "litellm_base_url";

/// LiteLLM proxy master authentication key (`sk-...`).
pub const LITELLM_MASTER_KEY: &str = "litellm_master_key";

/// Active CLI engine: `"claude_code"` or `"codex_cli"`.
pub const CLI_ENGINE: &str = "cli_engine";

/// Event retention period in days. Events older than this are purged by the
/// cleanup subscription.
pub const EVENT_RETENTION_DAYS: &str = "event_retention_days";
/// Default retention in days for [`EVENT_RETENTION_DAYS`].
pub const EVENT_RETENTION_DAYS_DEFAULT: i64 = 30;

/// Execution retention period in days. Executions older than this are purged
/// by the background cleanup task.
pub const EXECUTION_RETENTION_DAYS: &str = "execution_retention_days";
/// Default retention in days for [`EXECUTION_RETENTION_DAYS`] (two months).
pub const EXECUTION_RETENTION_DAYS_DEFAULT: i64 = 60;

/// Per-persona ceiling for scheduled executions in a rolling hour.
pub const SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR: &str = "schedule_executions_per_persona_hour";
/// Default per-persona hourly ceiling for scheduled executions.
pub const SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR_DEFAULT: i64 =
    crate::engine::limits::SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR_DEFAULT;

/// Per-persona execution retention override (in months).
/// Key format: `execution_retention_months:<persona_id>`, value: number string.
/// When set, overrides the global retention for that persona.
#[allow(dead_code)]
pub const EXECUTION_RETENTION_MONTHS_PREFIX: &str = "execution_retention_months:";

/// Per-persona auto-rollback setting prefix. The full key is
/// `auto_rollback:<persona_id>`, with value `"true"` or `"false"`.
/// When enabled, the auto-rollback subscription checks whether the current
/// prompt version's error rate exceeds 2x the previous version's rate.
pub const AUTO_ROLLBACK_PREFIX: &str = "auto_rollback:";

/// Global default model profile (JSON-encoded ModelProfile).
/// Used as the lowest-priority fallback in the hierarchical config cascade:
/// global → workspace → agent.
pub const GLOBAL_MODEL_PROFILE: &str = "global_model_profile";

/// File watcher debounce window in milliseconds. Events for the same path
/// are suppressed for this duration after the first trigger match, reducing
/// CPU spikes during FS bursts (IDE auto-save, git operations).
#[allow(dead_code)]
pub const FILE_WATCHER_DEBOUNCE_MS: &str = "file_watcher_debounce_ms";
/// Default debounce window in milliseconds for [`FILE_WATCHER_DEBOUNCE_MS`].
#[allow(dead_code)]
pub const FILE_WATCHER_DEBOUNCE_MS_DEFAULT: u64 = 500;

/// Per-persona auto-optimization setting prefix. Key: `auto_optimize:<persona_id>`.
/// Value: JSON `{"enabled":true,"cron":"0 2 * * 0","min_score":80,"models":["sonnet"]}`.
/// When enabled, a weekly arena test runs and auto-improves the prompt if scores are below min_score.
pub const AUTO_OPTIMIZE_PREFIX: &str = "auto_optimize:";

/// Per-persona health watch setting prefix. Key: `health_watch:<persona_id>`.
/// Value: JSON `{"enabled":true,"interval_hours":6,"error_threshold":30}`.
/// When enabled, periodic health checks run and send notifications on degradation.
pub const HEALTH_WATCH_PREFIX: &str = "health_watch:";

/// Performance digest configuration (JSON-encoded DigestConfig).
/// Controls cadence (daily/weekly), enabled state, and notification channels.
pub const PERFORMANCE_DIGEST: &str = "performance_digest";

/// ISO 8601 timestamp of the last performance digest delivery.
pub const PERFORMANCE_DIGEST_LAST: &str = "performance_digest_last";

/// Quality-gate configuration (JSON-encoded QualityGateConfig).
/// Controls which substring patterns cause AgentMemory and ManualReview
/// messages to be rejected, tagged, or warned during dispatch.
pub const QUALITY_GATE_CONFIG: &str = "quality_gate_config";

/// Model override for smart search template ranking.
/// Value: model ID string.
pub const SMART_SEARCH_MODEL: &str = "smart_search_model";
/// Default model ID for [`SMART_SEARCH_MODEL`] when unset.
pub const SMART_SEARCH_MODEL_DEFAULT: &str = "claude-haiku-4-5-20251001";

/// Model override for the LLM-assisted semantic vault lint.
/// Value: model ID string.
pub const SEMANTIC_LINT_MODEL: &str = "semantic_lint_model";
/// Default model ID for [`SEMANTIC_LINT_MODEL`] when unset.
pub const SEMANTIC_LINT_MODEL_DEFAULT: &str = "claude-haiku-4-5-20251001";

/// ISO 8601 timestamp of the last completed daily credential healthcheck sweep.
/// Written by the in-process `CredentialHealthcheckSubscription` to gate the
/// sweep to once per 24h (replaces the old per-Vault-visit frontend auto-test).
pub const CREDENTIAL_HEALTHCHECK_LAST: &str = "credential_healthcheck_last";

/// Whether the weekly health digest is enabled. Value: `"true"` or `"false"`.
pub const HEALTH_DIGEST_ENABLED: &str = "health_digest_enabled";

/// ISO 8601 timestamp of the last health digest run.
pub const HEALTH_DIGEST_LAST_RUN: &str = "health_digest_last_run";

/// JSON-encoded notification preferences (healing severity thresholds).
pub const NOTIFICATION_PREFS: &str = "notification_prefs";

/// JSON-encoded CLI engine capability map (which operations each provider supports).
pub const ENGINE_CAPABILITIES: &str = "engine_capabilities";

/// BYOM (Bring Your Own Model) policy configuration (JSON-encoded ByomPolicy).
pub const BYOM_POLICY: &str = "byom_policy";

/// GitLab pipeline notification preferences (JSON-encoded).
pub const GITLAB_PIPELINE_NOTIFICATION_PREFS: &str = "gitlab_pipeline_notification_prefs";

/// Obsidian Brain vault configuration (JSON-encoded ObsidianVaultConfig).
pub const OBSIDIAN_BRAIN_CONFIG: &str = "obsidian_brain_config";

/// Knowledge-mirror opt-in flags (JSON-encoded ObsidianMirrorConfig): which
/// internal stores mirror into the Obsidian vault. All default false.
pub const OBSIDIAN_MIRROR_CONFIG: &str = "obsidian_mirror_config";

/// Saved Obsidian vault list (JSON-encoded Vec<ObsidianVaultConfig>). The
/// user's quick-switch roster shown in the Brain plugin's "Saved vaults"
/// sidebar. Lived in webview localStorage until 2026-06-10, which silently
/// dropped the list whenever the webview profile was cleared — moved into
/// app_settings so it survives app sessions like the active config does.
pub const OBSIDIAN_BRAIN_SAVED_VAULTS: &str = "obsidian_brain_saved_vaults";

/// Dev-tools cross-project metadata cache (JSON-encoded).
/// Written by `infrastructure::dev_tools` to surface multi-project context to
/// agents connecting via the management API.
pub const DEV_TOOLS_CROSS_PROJECT_METADATA: &str = "dev_tools_cross_project_metadata";

/// Stamped version number of the canonical companion `constitution.md` content
/// last installed on disk. Used by `companion::disk::ensure_initialized` to
/// gate per-version upgrades so a user's edits aren't replayed-over on every
/// app start (the legacy marker-based check did exactly that). Value: a
/// non-negative integer matching `CONSTITUTION_VERSION` in
/// `companion::templates`.
pub const COMPANION_CONSTITUTION_VERSION: &str = "companion_constitution_version";

/// Onboarding-quest activation checklist state (JSON-encoded).
/// Tracks which first-run milestones the user has completed (create persona,
/// connect credential, run persona, save memory, schedule trigger, try recipe,
/// share deployment), plus pill UI state (dismissed, completed_at). Read at
/// app start to render the persistent quest pill bottom-right; written when
/// the user dismisses the pill or completes a milestone.
pub const ONBOARDING_QUEST_STATE: &str = "onboarding_quest_state";

/// Phase 5 v1: persisted global gate for the Claude CLI session-resume
/// awareness feature. Set by the SetupPanel desktop-awareness toggle;
/// read by both the windowed runner (in-memory `AmbientContextFusion`
/// state seeded on startup is in-process) and the daemon runner (queries
/// this row directly because it can't see the in-memory state cross-
/// process). Stored as `"true"` / `"false"` strings.
pub const CLI_SESSION_AWARENESS_ENABLED: &str = "cli_session_awareness_enabled";

/// Whether Athena's autonomous mode is currently toggled on. The chat
/// header toggle is frontend Zustand state, but the backend-side
/// proactive scheduler (which runs without any frontend call) needs an
/// independent source of truth to decide whether to spawn self-initiated
/// reasoning turns (execution review, etc.). The toggle writes this row;
/// the scheduler reads it. Stored as `"true"` / `"false"` strings.
pub const COMPANION_AUTONOMOUS_MODE: &str = "companion_autonomous_mode";

/// Whether the autonomous MESSAGE triage leg of the proactive tick may,
/// unattended, read the Overview → Messages inbox the way Athena resolves
/// human reviews: a batched headless decision classifies each unread
/// persona message as `done` (routine — marked read with an audit
/// annotation), `digest` (business value — folded into one aggregated
/// proactive card, then marked read) or `attention` (stays UNREAD for the
/// user to read personally + desktop notification). High/urgent-priority
/// messages can never be auto-`done` (code-level guard). Requires
/// [`COMPANION_AUTONOMOUS_MODE`] to also be on. Default OFF — opt-in.
/// Read by `companion::proactive::message_triage`. Stored `"true"`/`"false"`.
pub const AUTONOMOUS_MESSAGE_TRIAGE: &str = "autonomous_message_triage";
/// Default for [`AUTONOMOUS_MESSAGE_TRIAGE`] — off (opt-in autonomy).
pub const AUTONOMOUS_MESSAGE_TRIAGE_DEFAULT: bool = false;

/// Cursor for the autonomous message-triage leg: the ISO8601 `created_at`
/// of the newest `persona_messages` row already triaged. Unlike the
/// exec-review cursor it advances only past the batch actually processed
/// (oldest-first), so a backlog drains progressively instead of being
/// skipped. Free-form timestamp value (no typed validation).
pub const COMPANION_MSG_TRIAGE_CURSOR: &str = "companion_msg_triage_cursor";

/// Cursor for the autonomous execution-review leg (Goal 2): the ISO8601
/// timestamp of the newest `persona_executions` row the reviewer has
/// already considered. Each proactive tick reviews only rows created
/// after this and advances it, so reviews never repeat and history isn't
/// backfilled. Free-form timestamp value (no typed validation).
pub const COMPANION_EXEC_REVIEW_CURSOR: &str = "companion_exec_review_cursor";

/// Whether the Director may use the Obsidian Brain vault as long-term memory:
/// read prior coaching notes before a review + write a verdict note after.
/// Additionally gated on the vault being configured. Stored `"true"`/`"false"`.
pub const DIRECTOR_BRAIN_ENABLED: &str = "director_brain_enabled";

/// Global monthly cost ceiling in USD. Drives the Settings → Limits tab
/// progress bar and warning state. Stage 1 is informational-only; Stage 2
/// will gate execution dispatch when this is set and the running month
/// crosses it. Stored as a decimal string (e.g. `"50.00"`). The literal
/// `"0"` is treated as "no ceiling" by all consumers.
pub const MONTHLY_COST_CEILING_USD: &str = "monthly_cost_ceiling_usd";
/// Default monthly cost ceiling in USD. `0.0` means no ceiling.
pub const MONTHLY_COST_CEILING_USD_DEFAULT: f64 = 0.0;

/// Whether the autonomous goal-advancement tick may, unattended, turn a
/// goal-linked team's active goal into a running `team_assignment`. Default OFF
/// — nothing spends tokens autonomously until the user opts in from Settings.
/// Read by `engine::subscription::GoalAdvanceSubscription`. Stored
/// `"true"` / `"false"`.
pub const AUTONOMOUS_GOAL_ADVANCEMENT: &str = "autonomous_goal_advancement";
/// Default for [`AUTONOMOUS_GOAL_ADVANCEMENT`] — off (opt-in autonomy).
pub const AUTONOMOUS_GOAL_ADVANCEMENT_DEFAULT: bool = false;

/// Whether the autonomous assignment-retry tick may, unattended, resume a team
/// assignment that soft-paused at `awaiting_review` because a step failed for a
/// RETRYABLE reason (Claude session/usage limit or rate limit) — resetting the
/// failed steps and re-running them once the quota window has likely recovered.
/// Bounded by a per-step retry cap + backoff and gated per-persona by
/// `design_context.repeat_on_failure` (default ON). Default OFF — opt-in. Read
/// by `engine::subscription::AssignmentAutoResumeSubscription`. Stored
/// `"true"` / `"false"`.
pub const AUTONOMOUS_ASSIGNMENT_RETRY: &str = "autonomous_assignment_retry";
/// Default for [`AUTONOMOUS_ASSIGNMENT_RETRY`] — off (opt-in autonomy).
pub const AUTONOMOUS_ASSIGNMENT_RETRY_DEFAULT: bool = false;

/// Whether the autonomous review-triage tick may, unattended, resolve
/// `persona_manual_reviews` pending past a grace window — so the accept/reject
/// learning loop (which writes team/persona memory) keeps turning without a
/// human in the seat. Conservative policy (auto-approves only below a severity
/// threshold; leaves critical findings for a human). Default OFF — opt-in. Read
/// by `engine::subscription::ManualReviewAutoTriageSubscription`. Stored
/// `"true"` / `"false"`.
pub const AUTONOMOUS_REVIEW_TRIAGE: &str = "autonomous_review_triage";
/// Default for [`AUTONOMOUS_REVIEW_TRIAGE`] — off (opt-in autonomy).
pub const AUTONOMOUS_REVIEW_TRIAGE_DEFAULT: bool = false;

/// Whether the autonomous review triager may ALSO auto-approve HIGH/critical
/// severity reviews — but ONLY ones that match a safe technical-status allowlist
/// (red build / lint / code-review change-request / missing dependency /
/// mis-sequenced handoff) AND match NO business/policy denylist marker (PHI,
/// production, pricing, irreversible/destructive, secrets). Genuine
/// business/policy decisions are NEVER auto-approved; any unrecognised
/// high-severity item stays pending for a human. Requires
/// [`AUTONOMOUS_REVIEW_TRIAGE`] to also be on — a distinct, riskier opt-in beyond
/// low/medium triage. Read by `ManualReviewAutoTriageSubscription`. Default OFF.
/// Stored `"true"` / `"false"`.
pub const AUTONOMOUS_REVIEW_TRIAGE_HIGH: &str = "autonomous_review_triage_high";
/// Default for [`AUTONOMOUS_REVIEW_TRIAGE_HIGH`] — off (opt-in autonomy).
pub const AUTONOMOUS_REVIEW_TRIAGE_HIGH_DEFAULT: bool = false;

/// Whether the autonomous backlog-to-goal tick may, unattended, keep the
/// goal-advance loop self-sustaining: when a goal-linked project has run out of
/// open goals (the loop would otherwise idle), promote that project's single
/// best PENDING backlog idea (highest impact, lowest risk, lowest effort) into a
/// new `dev_goals` row and mark the idea accepted. One goal per idling project
/// per tick — flood-safe. Default OFF — opt-in. Read by
/// `engine::subscription::BacklogToGoalSubscription`. Stored `"true"`/`"false"`.
pub const AUTONOMOUS_BACKLOG_TO_GOAL: &str = "autonomous_backlog_to_goal";
/// Default for [`AUTONOMOUS_BACKLOG_TO_GOAL`] — off (opt-in autonomy).
pub const AUTONOMOUS_BACKLOG_TO_GOAL_DEFAULT: bool = false;

/// G7 — the last link of the self-sustaining loop: when a goal-managed project
/// is FULLY idle (no open goals AND no pending backlog ideas — the backlog ran
/// dry), run an idea scan to replenish it (`dev_tools` idea scanner,
/// architecture-analyst agent). One project per tick, per-project cooldown of
/// 20h via the `dev_scans` history — scans spawn a paid CLI agent (~$1-3), so
/// this is deliberately the slowest wheel. Default OFF — opt-in. Read by
/// `engine::subscription::IdeaReplenishSubscription`. Stored `"true"`/`"false"`.
pub const AUTONOMOUS_IDEA_SCAN: &str = "autonomous_idea_scan";
/// Default for [`AUTONOMOUS_IDEA_SCAN`] — off (opt-in autonomy).
pub const AUTONOMOUS_IDEA_SCAN_DEFAULT: bool = false;

/// Roster redesign — the Product Strategist's backlog-triage job: when a
/// goal-managed project has enough pending ideas with unranked items, run a
/// strategist CLI pass that RANKS the next-up queue (writes
/// `dev_ideas.priority`; promotion prefers ranked) and REJECTS low-value items
/// (reason → shared team constraint memory + scanner suppression). One project
/// per tick, 24h per-project cooldown via `dev_scans` (scan_type
/// `backlog-triage`). Default OFF — opt-in. Read by
/// `engine::subscription::BacklogTriageSubscription`. Stored `"true"`/`"false"`.
pub const AUTONOMOUS_BACKLOG_TRIAGE: &str = "autonomous_backlog_triage";
/// Default for [`AUTONOMOUS_BACKLOG_TRIAGE`] — off (opt-in autonomy).
pub const AUTONOMOUS_BACKLOG_TRIAGE_DEFAULT: bool = false;

/// Athena autonomous CHANNEL REACTIONS: when on, Athena observes each
/// goal-managed team's dev events (PR opened, QA bounce, QA fix-loop cap-out,
/// goal shipped, high/critical incident) and posts a reasoned reaction —
/// with an explicit decision rationale — into the team channel
/// (author_kind='athena'), escalating cap-outs/incidents to the user. Lets the
/// user SEE Athena's decisions throughout development. Deterministic decision
/// rules (no LLM in the tick — doctrine), 1 reaction/team/tick (restraint),
/// deduped against her last post. Default OFF — opt-in. Read by
/// `engine::subscription::AthenaChannelReactionSubscription`.
pub const AUTONOMOUS_ATHENA_REACTIONS: &str = "autonomous_athena_reactions";
/// Default for [`AUTONOMOUS_ATHENA_REACTIONS`] — off (opt-in autonomy).
pub const AUTONOMOUS_ATHENA_REACTIONS_DEFAULT: bool = false;

/// Athena autonomous REVIEW RESOLUTION: when on (and channel reactions are
/// on), Athena doesn't just react to a parked `awaiting_review` cap-out — she
/// RESOLVES it with a three-way decision: APPROVE acceptable work (posts her
/// assessment as an inject-directive to the QA persona + grants exactly one
/// extra QA round via the auto-resume machinery — QA keeps sole merge
/// authority), transform into an INCIDENT when the blocker is access/
/// credential/external-shaped (Incidents lifecycle + escalation-close), or
/// ESCALATE to the human (channel + notification, the reactions-only
/// behavior). One resolution per assignment (the `athena_review_resolution`
/// assignment event is the guard); re-parked assignments escalate to human.
/// Default OFF — opt-in. Read by `companion::athena_reaction`.
pub const AUTONOMOUS_ATHENA_REVIEW_RESOLUTION: &str = "autonomous_athena_review_resolution";
/// Default for [`AUTONOMOUS_ATHENA_REVIEW_RESOLUTION`] — off (opt-in autonomy).
pub const AUTONOMOUS_ATHENA_REVIEW_RESOLUTION_DEFAULT: bool = false;

/// KPI → Goal derivation: when on, an ACTIVE KPI that is OFF TRACK (pace-based,
/// freshly measured, no open derived goal, re-measured since the last derived
/// goal completed) derives ONE goal for the project's team via a headless
/// decision (skip is a legitimate outcome). The goal rides the normal
/// GoalAdvance loop. Default OFF — opt-in. Read by
/// `engine::subscription::KpiGoalDerivationSubscription`.
pub const AUTONOMOUS_KPI_GOAL_DERIVATION: &str = "autonomous_kpi_goal_derivation";
/// Default for [`AUTONOMOUS_KPI_GOAL_DERIVATION`] — off (opt-in autonomy).
pub const AUTONOMOUS_KPI_GOAL_DERIVATION_DEFAULT: bool = false;

/// When `"true"`, the Director runs a focused coaching evaluation on a persona
/// whose recent team work shows a STORM (a burst of step failures / QA
/// change-requests). Default OFF — opt-in. Read by
/// `engine::subscription::DirectorStormSubscription`. The coaching is bridged
/// into the team channel (C3). Stored `"true"`/`"false"`.
pub const AUTONOMOUS_DIRECTOR_STORM: &str = "autonomous_director_storm";
/// Default for [`AUTONOMOUS_DIRECTOR_STORM`] — off (opt-in autonomy).
pub const AUTONOMOUS_DIRECTOR_STORM_DEFAULT: bool = false;

/// Global cap on the number of executions that may run concurrently across ALL
/// personas. Read ONCE at engine construction (see
/// `crate::engine::ExecutionEngine::new`) and seeded into the
/// `ConcurrencyTracker` via `set_global_max_concurrent`. Runtime hot-reload is
/// intentionally NOT supported for P0 — changing this requires an app restart.
/// Stored as a positive-integer string; clamped to
/// [`MAX_PARALLEL_EXECUTIONS_MIN`]..=[`MAX_PARALLEL_EXECUTIONS_MAX`]. (The
/// `GLOBAL_MAX_CONCURRENT` const in engine/queue.rs is only the no-pool/test
/// fallback; this setting's default is authoritative at runtime.)
pub const MAX_PARALLEL_EXECUTIONS: &str = "max_parallel_executions";
/// Default global concurrency cap when the row is unset (or invalid).
pub const MAX_PARALLEL_EXECUTIONS_DEFAULT: usize = 10;
/// Minimum accepted cap. 0 would deadlock the queue (nothing could ever admit),
/// so the floor is 1 (fully serialized execution).
pub const MAX_PARALLEL_EXECUTIONS_MIN: usize = 1;
/// Upper guard rail for the configured global cap. Conservative ceiling; raise
/// only after auditing DB pool size / provider rate limits / memory headroom.
/// Also the FleetActivityStrip's bar count maxes out here (it renders one bar
/// per slot), so keep this aligned with `STRIP_SLOTS` in fleetStripModel.ts.
pub const MAX_PARALLEL_EXECUTIONS_MAX: usize = 20;

/// Whether each team-member persona execution runs inside its own per-execution
/// git worktree (on branch `personas/exec/<execution_id>`) instead of the shared
/// per-persona scratch dir. Default OFF — opt-in only, because it mutates the
/// pinned repo's `.git` (adds a worktree + a branch) on every isolated run.
/// When ON, the runner redirects the spawned CLI's cwd AND `CODEBASE_ROOT_PATH`
/// to the worktree, so two concurrent executions against the SAME repo don't
/// clobber each other. On completion the worktree is removed but the branch is
/// LEFT for review (no auto-merge). Read by `engine::runner::run_execution`.
/// Stored `"true"` / `"false"`.
pub const EXECUTION_WORKTREE_ISOLATION: &str = "execution_worktree_isolation";
/// Default for [`EXECUTION_WORKTREE_ISOLATION`] — off (opt-in isolation).
pub const EXECUTION_WORKTREE_ISOLATION_DEFAULT: bool = false;

/// Whether desktop → cloud dashboard sync is enabled. Value: `"true"` / `"false"`.
/// Default off; the user opts in from Settings. Read by the background sync loop.
pub const CLOUD_SYNC_ENABLED: &str = "cloud_sync_enabled";

/// Stable per-device id used to tag synced rows with their origin. Minted as a
/// UUID on first sync and persisted here. Value: free-form UUID string.
pub const CLOUD_SYNC_DEVICE_ID: &str = "cloud_sync_device_id";

/// RFC3339 timestamp of the last successful cloud sync pass. Value: free-form.
pub const CLOUD_SYNC_LAST_AT: &str = "cloud_sync_last_at";

/// Lifetime count of rows pushed to the cloud across all passes (monotonic).
/// Surfaced in the Settings sync panel. Value: a non-negative integer string.
pub const CLOUD_SYNC_TOTAL_ROWS: &str = "cloud_sync_total_rows";

/// Per-table incremental sync watermark. Full key: `cloud_sync_cursor:<table>`
/// (e.g. `cloud_sync_cursor:executions`), value: RFC3339 timestamp.
pub const CLOUD_SYNC_CURSOR_PREFIX: &str = "cloud_sync_cursor:";

/// Exact keys allowed in the settings store.
const ALLOWED_KEYS: &[&str] = &[
    OLLAMA_API_KEY,
    LITELLM_BASE_URL,
    LITELLM_MASTER_KEY,
    CLI_ENGINE,
    EVENT_RETENTION_DAYS,
    EXECUTION_RETENTION_DAYS,
    SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR,
    GLOBAL_MODEL_PROFILE,
    FILE_WATCHER_DEBOUNCE_MS,
    PERFORMANCE_DIGEST,
    PERFORMANCE_DIGEST_LAST,
    CREDENTIAL_HEALTHCHECK_LAST,
    QUALITY_GATE_CONFIG,
    SMART_SEARCH_MODEL,
    SEMANTIC_LINT_MODEL,
    HEALTH_DIGEST_ENABLED,
    HEALTH_DIGEST_LAST_RUN,
    NOTIFICATION_PREFS,
    ENGINE_CAPABILITIES,
    BYOM_POLICY,
    GITLAB_PIPELINE_NOTIFICATION_PREFS,
    OBSIDIAN_BRAIN_CONFIG,
    OBSIDIAN_MIRROR_CONFIG,
    OBSIDIAN_BRAIN_SAVED_VAULTS,
    DEV_TOOLS_CROSS_PROJECT_METADATA,
    COMPANION_CONSTITUTION_VERSION,
    ONBOARDING_QUEST_STATE,
    CLI_SESSION_AWARENESS_ENABLED,
    COMPANION_AUTONOMOUS_MODE,
    COMPANION_EXEC_REVIEW_CURSOR,
    AUTONOMOUS_MESSAGE_TRIAGE,
    COMPANION_MSG_TRIAGE_CURSOR,
    DIRECTOR_BRAIN_ENABLED,
    MONTHLY_COST_CEILING_USD,
    AUTONOMOUS_GOAL_ADVANCEMENT,
    AUTONOMOUS_ASSIGNMENT_RETRY,
    AUTONOMOUS_REVIEW_TRIAGE,
    AUTONOMOUS_REVIEW_TRIAGE_HIGH,
    AUTONOMOUS_BACKLOG_TO_GOAL,
    AUTONOMOUS_IDEA_SCAN,
    AUTONOMOUS_BACKLOG_TRIAGE,
    AUTONOMOUS_ATHENA_REACTIONS,
    AUTONOMOUS_ATHENA_REVIEW_RESOLUTION,
    AUTONOMOUS_KPI_GOAL_DERIVATION,
    AUTONOMOUS_DIRECTOR_STORM,
    MAX_PARALLEL_EXECUTIONS,
    EXECUTION_WORKTREE_ISOLATION,
    CLOUD_SYNC_ENABLED,
    CLOUD_SYNC_DEVICE_ID,
    CLOUD_SYNC_LAST_AT,
    CLOUD_SYNC_TOTAL_ROWS,
];

/// Prefix patterns for per-persona dynamic keys (e.g. `auto_rollback:<persona_id>`).
///
/// ## Contract for prefix keys
///
/// Every key matching a prefix in this list MUST be of the form
/// `<prefix><non-empty persona_id>` where the suffix contains only ASCII
/// alphanumerics plus `-` and `_`. Empty suffixes (`"auto_rollback:"` alone)
/// and suffixes containing whitespace, colons, or other punctuation are
/// rejected by [`validate_key`] so that downstream subscriptions can safely
/// strip the prefix and use the suffix as a persona_id.
const ALLOWED_PREFIXES: &[&str] = &[
    EXECUTION_RETENTION_MONTHS_PREFIX,
    AUTO_ROLLBACK_PREFIX,
    AUTO_OPTIMIZE_PREFIX,
    HEALTH_WATCH_PREFIX,
    CLOUD_SYNC_CURSOR_PREFIX,
];

/// Returns true if `suffix` is a syntactically acceptable persona_id-shaped
/// suffix for a prefix key. Requires non-empty ASCII alphanumerics plus `-`/`_`.
fn is_valid_prefix_suffix(suffix: &str) -> bool {
    !suffix.is_empty()
        && suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Returns `Ok(())` if the key is in the allow-list (exact match) or is a
/// well-formed prefix key (`prefix:<non-empty persona_id>`).
/// Returns `Err` with a descriptive message otherwise.
pub fn validate_key(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        return Ok(());
    }
    for prefix in ALLOWED_PREFIXES {
        if let Some(suffix) = key.strip_prefix(*prefix) {
            if suffix.is_empty() {
                return Err(format!(
                    "settings key '{key}' is missing the <persona_id> suffix after prefix '{prefix}'"
                ));
            }
            if !is_valid_prefix_suffix(suffix) {
                return Err(format!(
                    "settings key '{key}' has an invalid persona_id suffix after prefix '{prefix}' \
                     (allowed: ASCII alphanumerics, '-', '_')"
                ));
            }
            return Ok(());
        }
    }
    Err(format!("unknown settings key: {key}"))
}

/// Validate that the value is well-formed for keys with a typed contract.
/// Keys without a typed contract accept any value (the 64 KB limit is enforced
/// separately at the command layer).
///
/// Currently validates:
/// - `EVENT_RETENTION_DAYS`, `EXECUTION_RETENTION_DAYS` → non-negative integer (u32 range)
/// - `SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR` → positive integer (u32 range)
/// - `FILE_WATCHER_DEBOUNCE_MS` → non-negative integer (u32 range, milliseconds)
pub fn validate_value(key: &str, value: &str) -> Result<(), String> {
    match key {
        EVENT_RETENTION_DAYS | EXECUTION_RETENTION_DAYS => {
            value.parse::<u32>().map(|_| ()).map_err(|_| {
                format!("value for '{key}' must be a non-negative integer (days), got {value:?}")
            })
        }
        SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR => match value.parse::<u32>() {
            Ok(n) if n > 0 => Ok(()),
            _ => Err(format!(
                "value for '{key}' must be a positive integer (executions per hour), got {value:?}"
            )),
        },
        MAX_PARALLEL_EXECUTIONS => match value.parse::<usize>() {
            Ok(n) if n >= MAX_PARALLEL_EXECUTIONS_MIN && n <= MAX_PARALLEL_EXECUTIONS_MAX => Ok(()),
            _ => Err(format!(
                "value for '{key}' must be an integer between {MAX_PARALLEL_EXECUTIONS_MIN} and {MAX_PARALLEL_EXECUTIONS_MAX}, got {value:?}"
            )),
        },
        FILE_WATCHER_DEBOUNCE_MS => value.parse::<u32>().map(|_| ()).map_err(|_| {
            format!(
                "value for '{key}' must be a non-negative integer (milliseconds), got {value:?}"
            )
        }),
        COMPANION_CONSTITUTION_VERSION => value.parse::<u32>().map(|_| ()).map_err(|_| {
            format!("value for '{key}' must be a non-negative integer (version), got {value:?}")
        }),
        CLI_SESSION_AWARENESS_ENABLED
        | COMPANION_AUTONOMOUS_MODE
        | CLOUD_SYNC_ENABLED
        | AUTONOMOUS_MESSAGE_TRIAGE
        | AUTONOMOUS_GOAL_ADVANCEMENT
        | AUTONOMOUS_ASSIGNMENT_RETRY
        | AUTONOMOUS_REVIEW_TRIAGE
        | AUTONOMOUS_BACKLOG_TO_GOAL
        | AUTONOMOUS_IDEA_SCAN
        | AUTONOMOUS_BACKLOG_TRIAGE
        | AUTONOMOUS_ATHENA_REACTIONS
        | AUTONOMOUS_ATHENA_REVIEW_RESOLUTION
        | AUTONOMOUS_KPI_GOAL_DERIVATION
        | AUTONOMOUS_DIRECTOR_STORM
        | EXECUTION_WORKTREE_ISOLATION => {
            match value {
                "true" | "false" => Ok(()),
                _ => Err(format!(
                    "value for '{key}' must be the literal string 'true' or 'false', got {value:?}"
                )),
            }
        }
        MONTHLY_COST_CEILING_USD => match value.parse::<f64>() {
            Ok(n) if n.is_finite() && n >= 0.0 => Ok(()),
            _ => Err(format!(
                "value for '{key}' must be a non-negative decimal USD amount, got {value:?}"
            )),
        },
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_key_accepted() {
        assert!(validate_key("cli_engine").is_ok());
        assert!(validate_key("byom_policy").is_ok());
        assert!(validate_key("health_digest_enabled").is_ok());
        assert!(validate_key("dev_tools_cross_project_metadata").is_ok());
    }

    #[test]
    fn well_formed_prefix_key_accepted() {
        assert!(validate_key("auto_rollback:abc-123").is_ok());
        assert!(validate_key("health_watch:some_persona_42").is_ok());
        assert!(validate_key("execution_retention_months:xyz").is_ok());
    }

    #[test]
    fn bare_prefix_rejected() {
        // No suffix → not a valid per-persona key.
        assert!(validate_key("auto_rollback:").is_err());
        assert!(validate_key("health_watch:").is_err());
        assert!(validate_key("auto_optimize:").is_err());
    }

    #[test]
    fn malformed_prefix_suffix_rejected() {
        // Whitespace, additional colons, and punctuation are not allowed in persona_id suffixes.
        assert!(validate_key("auto_rollback:bad id").is_err());
        assert!(validate_key("auto_rollback:bad:id").is_err());
        assert!(validate_key("auto_rollback:bad/id").is_err());
    }

    #[test]
    fn unknown_key_rejected() {
        assert!(validate_key("evil_key").is_err());
        assert!(validate_key("").is_err());
        assert!(validate_key("cli_engine_extra").is_err());
    }

    #[test]
    fn max_parallel_executions_key_and_value_validation() {
        assert!(validate_key(MAX_PARALLEL_EXECUTIONS).is_ok());
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, "1").is_ok());
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, "5").is_ok());
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, "20").is_ok());
        // 0 would deadlock the queue -> rejected; over the ceiling -> rejected.
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, "0").is_err());
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, "21").is_err());
        // Non-integer / negative / blank / padded -> rejected.
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, "5x").is_err());
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, "-1").is_err());
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, "").is_err());
        assert!(validate_value(MAX_PARALLEL_EXECUTIONS, " 5 ").is_err());
    }

    #[test]
    fn execution_worktree_isolation_key_and_value_validation() {
        assert!(validate_key(EXECUTION_WORKTREE_ISOLATION).is_ok());
        assert!(validate_value(EXECUTION_WORKTREE_ISOLATION, "true").is_ok());
        assert!(validate_value(EXECUTION_WORKTREE_ISOLATION, "false").is_ok());
        // Only the literal bool strings are accepted.
        assert!(validate_value(EXECUTION_WORKTREE_ISOLATION, "1").is_err());
        assert!(validate_value(EXECUTION_WORKTREE_ISOLATION, "yes").is_err());
        assert!(validate_value(EXECUTION_WORKTREE_ISOLATION, "").is_err());
        assert!(!EXECUTION_WORKTREE_ISOLATION_DEFAULT);
    }

    #[test]
    fn numeric_value_validation() {
        assert!(validate_value(EVENT_RETENTION_DAYS, "30").is_ok());
        assert!(validate_value(EVENT_RETENTION_DAYS, "0").is_ok());
        assert!(validate_value(EVENT_RETENTION_DAYS, "30d").is_err());
        assert!(validate_value(EVENT_RETENTION_DAYS, "").is_err());
        assert!(validate_value(EVENT_RETENTION_DAYS, " 30 ").is_err());
        assert!(validate_value(EXECUTION_RETENTION_DAYS, "-5").is_err());
        assert!(validate_value(FILE_WATCHER_DEBOUNCE_MS, "500").is_ok());
        assert!(validate_value(FILE_WATCHER_DEBOUNCE_MS, "500ms").is_err());
    }

    #[test]
    fn unknown_keys_skip_value_validation() {
        // Keys without a typed contract accept any value shape.
        assert!(validate_value(CLI_ENGINE, "whatever").is_ok());
        assert!(validate_value(BYOM_POLICY, "{malformed").is_ok());
    }

    #[test]
    fn monthly_cost_ceiling_accepts_non_negative_decimals() {
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "0").is_ok());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "0.0").is_ok());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "50").is_ok());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "50.00").is_ok());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "1234.56").is_ok());
    }

    #[test]
    fn monthly_cost_ceiling_rejects_invalid() {
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "-5").is_err());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "nan").is_err());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "inf").is_err());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "abc").is_err());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, "").is_err());
        assert!(validate_value(MONTHLY_COST_CEILING_USD, " 5 ").is_err());
    }
}
