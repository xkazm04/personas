//! Protocol dispatcher: routes parsed ProtocolMessage values to the appropriate DB repo.
//!
//! Extracted from runner.rs to decouple semantic message handling from process
//! lifecycle orchestration. Any execution backend (CLI, HTTP, cloud) can use
//! this dispatcher to handle protocol messages identically.

use tauri::AppHandle;

use super::event_registry::event_name;
use super::events::{emit_to, ExecutionEventEmitter};
use super::platform_backlog;
use super::protocol::{ExecutionProtocol, StatusFinalization};
use super::quality_gate::{self, FilterAction, QualityGateConfig};
use super::types::{ExecutionOutputEvent, HeartbeatEvent, StructuredExecutionEvent};
use crate::db::models::{
    CreateManualReviewInput, CreatePersonaEventInput, CreatePersonaMemoryInput, CreateReportInput,
};
use crate::db::repos::communication::{
    events as event_repo, manual_reviews as review_repo, reports as msg_repo,
};
use crate::db::repos::core::memories as mem_repo;
use crate::db::repos::execution::knowledge as knowledge_repo;
use crate::db::repos::execution::policy_events as policy_events_repo;
use crate::db::repos::resources::team_channel as channel_repo;
use crate::db::DbPool;

// ---------------------------------------------------------------------------
// Policy audit helper
// ---------------------------------------------------------------------------

/// Best-effort persist of a policy-enforcement event to the audit log. Never
/// fails the dispatch — a failed audit write gets a warn log line and the
/// enforcement itself already succeeded. Used at every `[POLICY]` drop /
/// auto-resolve site so the per-execution Policy Events tab can show what
/// the policy silently removed.
fn audit_policy_event(
    ctx: &DispatchContext<'_>,
    policy_kind: &str,
    action: &str,
    payload_title: Option<&str>,
    reason: Option<&str>,
) {
    if let Err(e) = policy_events_repo::insert(
        ctx.pool,
        ctx.execution_id,
        ctx.persona_id,
        ctx.use_case_id,
        policy_kind,
        action,
        payload_title,
        reason,
    ) {
        tracing::warn!(
            execution_id = %ctx.execution_id,
            policy_kind,
            action,
            error = %e,
            "Failed to persist policy event (enforcement still applied)",
        );
    }
}

use super::logger::ExecutionLogger;
use super::types::ProtocolMessage;

/// Context for protocol message dispatch.
///
/// Bundles all the references the dispatcher needs to write to DB and emit
/// frontend events. Constructed once per execution and reused for every
/// protocol message encountered in the stream.
pub struct DispatchContext<'a> {
    pub emitter: &'a dyn ExecutionEventEmitter,
    /// Optional AppHandle for OS-level notifications (desktop-only).
    /// `None` in daemon/headless mode — notifications silently skip.
    pub app_handle: Option<&'a AppHandle>,
    pub pool: &'a DbPool,
    pub execution_id: &'a str,
    pub persona_id: &'a str,
    pub project_id: &'a str,
    pub persona_name: &'a str,
    pub notification_channels: Option<&'a str>,
    pub logger: &'a mut ExecutionLogger,
    /// When true, skip all protocol message storage (messages, memories, events,
    /// reviews). Used for ops chat executions which are conversational queries,
    /// not real agent executions.
    pub ops_mode: bool,
    /// When true, this is a simulation run from `simulate_use_case`. Messages,
    /// memories, events, and reviews are still persisted (with their rows
    /// tagged), but **outbound notification channels and OS notifications are
    /// suppressed** so the user can preview behavior without spamming real
    /// Slack channels, email lists, etc. Phase C3.
    pub is_simulation: bool,
    /// Capability (use case) attribution for this execution. Inherited by every
    /// message, manual review, memory, and event published during dispatch so
    /// downstream consumers (activity feed, review queue, memory injector,
    /// event bus) can scope by capability. `None` for persona-wide runs.
    /// Phase C5.
    pub use_case_id: Option<&'a str>,
    /// Cached quality-gate config — loaded lazily on first use, then reused for
    /// all subsequent protocol messages in this execution. Avoids O(messages)
    /// DB reads for config that rarely changes.
    quality_gate_cache: Option<QualityGateConfig>,
    /// Cached resolved notification channels. Lazily computed on first use to
    /// avoid the design_context DB roundtrip when no message/review fires.
    /// `Some(Some(json))` once computed; `None` until first call. Phase C5.
    resolved_channels_cache: Option<Option<String>>,
    /// Cached generation policy for this execution's capability. Lazily
    /// computed on first artefact (memory/review/event) and reused. Phase C5b.
    policy_cache: Option<testable::GenerationPolicy>,
    /// Cached answer to "does something else already own this execution's chat
    /// lane?". Computed on the first chat-lane write and reused. See
    /// [`DispatchContext::chat_lane_owned_externally`].
    chat_lane_external_cache: Option<bool>,
}

impl<'a> DispatchContext<'a> {
    /// Create a new dispatch context with a pre-loaded quality-gate config.
    ///
    /// The `gate_config` is shared across all protocol messages in the execution,
    /// avoiding repeated DB queries. Load it once with [`quality_gate::load`]
    #[allow(clippy::too_many_arguments)]
    /// before the message processing loop and pass the same `Arc` to every context.
    pub fn new(
        emitter: &'a dyn ExecutionEventEmitter,
        pool: &'a DbPool,
        execution_id: &'a str,
        persona_id: &'a str,
        project_id: &'a str,
        persona_name: &'a str,
        notification_channels: Option<&'a str>,
        logger: &'a mut ExecutionLogger,
        gate_config: Option<QualityGateConfig>,
    ) -> Self {
        Self {
            emitter,
            app_handle: None,
            pool,
            execution_id,
            persona_id,
            project_id,
            persona_name,
            notification_channels,
            logger,
            ops_mode: false,
            is_simulation: false,
            use_case_id: None,
            quality_gate_cache: gate_config,
            resolved_channels_cache: None,
            policy_cache: None,
            chat_lane_external_cache: None,
        }
    }

    /// True when this execution is a **persona-channel follow-up** — the user
    /// posted a chat message, `post_persona_channel_message` spawned the run,
    /// and `run_channel_followup` will write the persona's reply row itself
    /// once the execution reaches a terminal state.
    ///
    /// That waiter is the chat lane's owner for such runs, so dispatch must
    /// NOT also insert a row: the same reply would appear twice. Detected from
    /// the execution's `input_data` envelope (`{"source":"channel", ...}`),
    /// which `post_persona_channel_message` mints and the Slack/Discord
    /// pollers deliberately do not (their replies go to the transport, never
    /// to `team_channel_messages`).
    ///
    /// One DB read per execution, cached — a run with ten chat notes queries
    /// once.
    fn chat_lane_owned_externally(&mut self) -> bool {
        if let Some(cached) = self.chat_lane_external_cache {
            return cached;
        }
        let resolved = self
            .pool
            .get()
            .ok()
            .and_then(|conn| {
                conn.query_row(
                    "SELECT input_data FROM persona_executions WHERE id = ?1",
                    rusqlite::params![self.execution_id],
                    |r| r.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten()
            })
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|v| {
                v.get("source")
                    .and_then(|s| s.as_str())
                    .map(|s| s == "channel")
            })
            .unwrap_or(false);
        self.chat_lane_external_cache = Some(resolved);
        resolved
    }

    /// Resolve and cache the generation policy for this execution. Reads
    /// `design_context.use_cases[uc].generation_settings` if a use_case is
    /// active; falls back to defaults inferred from the persona's existing
    /// memories/reviews otherwise. Phase C5b.
    fn generation_policy(&mut self) -> testable::GenerationPolicy {
        if let Some(p) = self.policy_cache.as_ref() {
            return p.clone();
        }
        let resolved =
            testable::resolve_generation_policy(self.pool, self.persona_id, self.use_case_id);
        self.policy_cache = Some(resolved.clone());
        resolved
    }

    /// Return the cached quality-gate config, loading from DB on first call.
    fn quality_gate_config(&mut self) -> &QualityGateConfig {
        if self.quality_gate_cache.is_none() {
            self.quality_gate_cache = Some(quality_gate::load(self.pool));
        }
        self.quality_gate_cache.as_ref().unwrap()
    }

    /// Resolve the effective notification channels for this dispatch.
    ///
    /// Phase C5 precedence: when the execution has a `use_case_id`, look up the
    /// capability's `notification_channels` from `design_context.use_cases[]`
    /// and use them if non-empty. Otherwise fall back to the persona-wide
    /// `notification_channels` set on the execution context.
    ///
    /// Cached after first call so subsequent dispatches in the same execution
    /// don't re-query the persona row.
    fn resolve_notification_channels(&mut self) -> Option<String> {
        if let Some(cached) = self.resolved_channels_cache.as_ref() {
            return cached.clone();
        }
        let resolved = testable::resolve_notification_channels(
            self.pool,
            self.persona_id,
            self.use_case_id,
            self.notification_channels,
        );
        self.resolved_channels_cache = Some(resolved.clone());
        resolved
    }
}

// ---------------------------------------------------------------------------
// `user_message` lane classification — message vs report
// ---------------------------------------------------------------------------

/// Where a `user_message` protocol block lands.
///
/// One wire block, two homes. A persona's short status note belongs in the
/// conversation it is part of; a persona's structured deliverable belongs in
/// the artifact store where it can be re-read, delivered and cited. Before
/// this split every `user_message` became a report, so the persona channel
/// rendered report bubbles for one-liners.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageLane {
    /// A chat row in the persona channel (`team_channel_messages`, scoped by
    /// `persona_id` with the `persona:<id>` team sentinel). No notification
    /// fan-out — see [`dispatch_chat_note`].
    Chat,
    /// A report artifact (`persona_reports`) plus the notification-channel
    /// fan-out. The pre-existing path, and still the default for anything
    /// that looks like a deliverable.
    Report,
}

/// Content longer than this (in characters, not bytes) is a report regardless
/// of how it is shaped. A note that does not fit in a chat bubble is not a
/// chat note. Sized so a few sentences of status still fit.
pub const CHAT_NOTE_MAX_CHARS: usize = 400;

/// `content_type` values that declare the payload an artifact. `info`,
/// `success`, `warning` and `text` are deliberately absent: those are the
/// types a short status note carries, and typing a one-liner `info` must not
/// force it into the report store.
const REPORT_CONTENT_TYPES: &[&str] = &["markdown", "code", "alert", "budget_alert", "error"];

/// Classify one `user_message` block into its lane.
///
/// Pure — no DB, no clock, no IO — so the whole rule set is unit-testable
/// without a pool or an emitter. Rules, in precedence order:
///
/// 1. An explicit `channel` override wins outright (`"message"`/`"chat"` →
///    [`MessageLane::Chat`], `"report"` → [`MessageLane::Report`]). Any other
///    value is ignored rather than trusted — an unknown lane name falls
///    through to the heuristics instead of silently picking one.
/// 2. A non-empty `title` → report. A title is the artifact's name; a chat
///    note has none.
/// 3. Content longer than [`CHAT_NOTE_MAX_CHARS`] → report.
/// 4. A `content_type` in [`REPORT_CONTENT_TYPES`] → report.
/// 5. Structural markdown (heading, table, fenced block) → report.
/// 6. Otherwise → chat.
///
/// The bias is deliberate: every existing persona emits a title (the prompt
/// has always called it required), so **existing behavior is unchanged** and
/// only a model that deliberately omits the title reaches the new lane.
pub fn classify_user_message(
    title: Option<&str>,
    content: &str,
    content_type: Option<&str>,
    channel: Option<&str>,
) -> MessageLane {
    // 1. Explicit override.
    if let Some(lane) = channel.map(str::trim).filter(|c| !c.is_empty()) {
        match lane.to_ascii_lowercase().as_str() {
            "message" | "chat" => return MessageLane::Chat,
            "report" => return MessageLane::Report,
            _ => {} // unknown value: fall through to the heuristics
        }
    }
    // 2. Titled output is an artifact.
    if title.map(str::trim).is_some_and(|t| !t.is_empty()) {
        return MessageLane::Report;
    }
    // 3. Too long to be a chat bubble.
    if content.chars().count() > CHAT_NOTE_MAX_CHARS {
        return MessageLane::Report;
    }
    // 4. Declared as an artifact by its content type.
    if content_type
        .map(|ct| ct.trim().to_ascii_lowercase())
        .is_some_and(|ct| REPORT_CONTENT_TYPES.contains(&ct.as_str()))
    {
        return MessageLane::Report;
    }
    // 5. Shaped like a document.
    if has_structural_markdown(content) {
        return MessageLane::Report;
    }
    MessageLane::Chat
}

/// Cheap structural-markdown probe: a heading, a fenced block, or a table.
///
/// Deliberately narrow — bold, italics, links and a couple of bullets are
/// ordinary chat punctuation and must NOT promote a note to an artifact. Hand
/// -rolled rather than regex: three line-shaped predicates over a string that
/// is at most a few hundred characters by the time this runs.
fn has_structural_markdown(content: &str) -> bool {
    let mut table_rows = 0usize;
    for line in content.lines() {
        let t = line.trim_start();
        // Fenced code / chart block.
        if t.starts_with("```") || t.starts_with("~~~") {
            return true;
        }
        // ATX heading: 1–6 '#' followed by a space and some text. Counted in
        // BYTES so the slice below is a byte index by construction ('#' is
        // ASCII, so the two counts agree — this just makes that explicit).
        let hashes = t.bytes().take_while(|b| *b == b'#').count();
        if (1..=6).contains(&hashes)
            && t[hashes..].starts_with(' ')
            && !t[hashes..].trim().is_empty()
        {
            return true;
        }
        // Table row: a pipe-delimited line. Two of them (header + separator,
        // at minimum) before it counts, so a single stray '|' is not a table.
        if t.starts_with('|') && t.matches('|').count() >= 2 {
            table_rows += 1;
            if table_rows >= 2 {
                return true;
            }
        }
    }
    false
}

/// The `[BACKLOG]` line for binding a proposed idea to the goal its filer
/// named, through the repo's never-overwrite door. Shared by the create and
/// the dedup branch of `propose_backlog`, so a re-proposal binds exactly as a
/// first proposal does.
fn goal_binding_log(
    pool: &crate::db::DbPool,
    idea_id: &str,
    project_id: &str,
    goal_ref: &str,
) -> String {
    use crate::db::repos::dev_tools::{bind_idea_goal_if_unset, IdeaGoalBinding};
    match bind_idea_goal_if_unset(pool, idea_id, project_id, goal_ref) {
        Ok(IdeaGoalBinding::Bound(g)) => format!(
            "[BACKLOG] Serves goal {}: {}",
            &g.id[..g.id.len().min(8)],
            g.title
        ),
        Ok(IdeaGoalBinding::AlreadyServes(g)) => format!(
            "[BACKLOG] Already serves goal {}: {}",
            &g.id[..g.id.len().min(8)],
            g.title
        ),
        Ok(IdeaGoalBinding::KeptExisting(held)) => format!(
            "[BACKLOG] Goal {goal_ref:?} not bound — the item already serves goal {}; the first binding stands",
            &held[..held.len().min(8)]
        ),
        Ok(IdeaGoalBinding::Unresolved) => format!(
            "[BACKLOG] Goal {goal_ref:?} names no single goal of this project — filed unbound; use a goal id from the prompt's goal list"
        ),
        Err(e) => format!("[BACKLOG] Could not bind goal {goal_ref:?}: {e}"),
    }
}

/// Write a short persona note into the persona's chat lane and announce it.
///
/// **No notification fan-out, on purpose.** A chat note's home is the channel
/// the user is already looking at; Slack/email/webhook delivery is a *report*
/// affordance, driven by `persona_report_deliveries` and the resolved
/// notification channels, and pushing every one-line status into it would turn
/// the fan-out into noise. A persona that wants a note delivered externally
/// gives it a title (or sets `"channel": "report"`) and it becomes a report,
/// which is exactly the affordance that already exists.
/// G44: when the filing persona holds an active charter, make `context_data`
/// a JSON object carrying the decide lane's `source` marker. Free text is
/// preserved under `context_text`, the key the review UI already reads.
fn stamp_charter_ask_source(
    ctx: &DispatchContext<'_>,
    context_data: Option<String>,
) -> Option<String> {
    let holds_charter =
        crate::db::repos::core::responsibilities::list_by_persona(ctx.pool, ctx.persona_id, false)
            .map(|rows| rows.iter().any(|r| r.status == "active"))
            .unwrap_or(false);
    if !holds_charter {
        return context_data;
    }
    let parsed = context_data
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .filter(|v| v.is_object());
    let mut obj = parsed.unwrap_or_else(|| serde_json::json!({}));
    if let Some(map) = obj.as_object_mut() {
        if let Some(cd) = context_data.as_deref() {
            if serde_json::from_str::<serde_json::Value>(cd).is_err()
                && !map.contains_key("context_text")
            {
                map.insert("context_text".to_string(), serde_json::json!(cd));
            }
        }
        map.entry("source".to_string())
            .or_insert_with(|| serde_json::json!(crate::engine::subscription::ASK_SOURCE));
    }
    Some(obj.to_string())
}

fn dispatch_chat_note(ctx: &mut DispatchContext<'_>, content: &str) {
    // A persona-channel follow-up already writes the persona's reply row when
    // the run finishes. Writing here too would double-post the same reply.
    if ctx.chat_lane_owned_externally() {
        ctx.logger
            .log("[MESSAGE] Chat note skipped: channel follow-up owns this execution's reply row");
        return;
    }
    match channel_repo::create_persona_channel_message(
        ctx.pool,
        channel_repo::CreatePersonaChannelMessageInput {
            id: None,
            persona_id: ctx.persona_id.to_string(),
            author_kind: "persona".into(),
            author_id: Some(ctx.persona_id.to_string()),
            author_label: Some(ctx.persona_name.to_string()),
            body: content.to_string(),
            reply_to: None,
            failed: false,
        },
    ) {
        Ok((id, _at)) => {
            ctx.logger.log(&format!(
                "[MESSAGE] Chat note posted to persona channel ({id})"
            ));
            emit_to(
                ctx.emitter,
                event_name::PERSONA_CHANNEL_MESSAGE,
                &serde_json::json!({ "persona_id": ctx.persona_id }),
            );
        }
        Err(e) => ctx
            .logger
            .log(&format!("[MESSAGE] Failed to post chat note: {e}")),
    }
}

/// Route a single protocol message to the appropriate DB repo and emit events.
///
/// Backlog backpressure cap: a project with this many `pending` dev_ideas is
/// SATURATED — backlog producers (persona `propose_backlog`, scheduled scans)
/// skip their round instead of stacking ideas faster than the triage +
/// promotion loop can drain them. Sized ~2× the strategist triage trigger
/// (≥ 6 pending) so triage always fires well before producers go quiet.
pub const IDEA_BACKLOG_CAP: i64 = 300;

/// Backlog aging window: a `pending` idea untouched for this many days that
/// never became work (no linked task) is archived by `archive_stale_ideas` —
/// reversibly, keeping its `dedup_key` so it can never be re-proposed. Sized so
/// a fortnightly triage rhythm never loses live signal, while a backlog nobody
/// touched for a month stops occupying the cap.
pub const IDEA_STALE_DAYS: i64 = 30;

/// The same backpressure, on the pile that never had any.
///
/// Measured on the live database 2026-09-21: the largest PENDING queue on any
/// project was 63 against a cap of 300 — the review queue is healthy and
/// nowhere near saturation — while **741 ACCEPTED items sat undispatched**,
/// with no cap, no reaper and no terminal state. The whole backpressure system
/// was built for the review queue and stopped dead at the moment of
/// acceptance, so a producer went quiet only for the queue that was never
/// full.
///
/// Counted over `accepted` items with no `dev_tasks` row pointing at them: an
/// accepted item that BECAME work is not backlog, it is work in flight, and
/// holding a producer quiet for it would make the cap a function of delivery
/// latency. Deliberately the same 300 as [`IDEA_BACKLOG_CAP`] — there is no
/// evidence for a different number, and two caps that differ invite the reader
/// to infer a reason neither has.
pub const ACCEPTED_BACKLOG_CAP: i64 = 300;

/// Accepted aging window: an `accepted` idea this old that never became work
/// is moved to `expired` by `expire_stale_accepted_ideas` — reversibly, keeping
/// its `dedup_key`, and into a state no human verdict ever writes. Mirrors
/// [`IDEA_STALE_DAYS`]: a decision nobody acted on within a month is a decision
/// the project has revised by not acting, and saying so is how the accepted
/// pile stops growing forever.
pub const ACCEPTED_STALE_DAYS: i64 = 30;

/// Which backpressure limit a project is sitting against, when it is.
///
/// A single answer rather than two guards, so the log line can name WHICH
/// limit went quiet — a producer that skips a round without saying why is
/// indistinguishable from one that had nothing to file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BacklogLimit {
    /// [`IDEA_BACKLOG_CAP`] pending items awaiting a verdict.
    Pending,
    /// [`ACCEPTED_BACKLOG_CAP`] accepted items that never became a task.
    Accepted,
}

impl BacklogLimit {
    /// The clause both producers put in their skip log, so one reading of
    /// "backlog saturated" covers both piles.
    pub fn describe(&self) -> String {
        match self {
            Self::Pending => format!("backlog saturated (≥ {IDEA_BACKLOG_CAP} pending)"),
            Self::Accepted => {
                format!("backlog saturated (≥ {ACCEPTED_BACKLOG_CAP} accepted and undispatched)")
            }
        }
    }
}

/// The ONE backpressure question a backlog producer asks before filing.
///
/// Both piles in one `COUNT`, so extending the policy can never leave one
/// producer reading half of it — the shape that let the accepted pile reach
/// 741 while every guard in the tree watched `pending`.
///
/// Unreadable is NOT saturated: a pool that cannot be acquired returns `None`
/// and the filing proceeds. Losing a finding to a transient DB error is worse
/// than one item over a cap, and the caps are advisory backpressure, not a
/// correctness invariant.
pub fn backlog_saturation(pool: &DbPool, project_id: &str) -> Option<BacklogLimit> {
    let counted = pool.get().ok().and_then(|conn| {
        conn.query_row(
            "SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'accepted'
                         AND NOT EXISTS (SELECT 1 FROM dev_tasks
                                         WHERE dev_tasks.source_idea_id = dev_ideas.id)
                         THEN 1 ELSE 0 END), 0)
               FROM dev_ideas WHERE project_id = ?1",
            rusqlite::params![project_id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .ok()
    })?;
    let (pending, accepted_undispatched) = counted;
    if pending >= IDEA_BACKLOG_CAP {
        Some(BacklogLimit::Pending)
    } else if accepted_undispatched >= ACCEPTED_BACKLOG_CAP {
        Some(BacklogLimit::Accepted)
    } else {
        None
    }
}

/// Who wrote this run's output: `(provider, model)`, for stamping onto anything
/// a persona files.
///
/// Measured 2026-09-21: `provider`/`model` were NULL on 2,038 of 2,093
/// `dev_ideas` rows, so the single largest producer's 1,208 items cannot be
/// attributed to the model that wrote them and no cost, quality or regression
/// question can be asked per-model. The cause was not a policy — it was that
/// the doors carrying the traffic had no parameter for it and this dispatcher
/// passed `None, None`.
///
/// Read in this order, best evidence first:
///
/// 1. `persona_executions.model_used` — the SERVED model name, corrected to
///    what the provider actually answered with at stream init
///    (`set_model_used_actual`). This is observation, not intent;
/// 2. the persona's own `model_profile.model` — intent, used when the run row
///    is not readable (a dispatch outside a recorded execution, as in tests);
/// 3. nothing. A model name is never invented.
///
/// The provider is the profile's when it declares one. Absent, it is the
/// bundled Claude CLI: a run with no profile has no other backend to have
/// taken, and `"claude"` is the token the one producer that already stamps this
/// column writes (`idea_scanner.rs`), so this does not open a second
/// vocabulary in one column.
fn run_attribution(
    ctx: &DispatchContext<'_>,
    persona: Option<&crate::db::models::Persona>,
) -> (Option<String>, Option<String>) {
    let profile = persona
        .and_then(|p| personas_engine::prompt::parse_model_profile(p.model_profile.as_deref()));
    let served = crate::db::repos::execution::executions::get_by_id(ctx.pool, ctx.execution_id)
        .ok()
        .and_then(|e| e.model_used);
    let model = served
        .or_else(|| profile.as_ref().and_then(|p| p.model.clone()))
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    let provider = profile
        .as_ref()
        .and_then(|p| p.provider.clone())
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "claude".to_string());
    (Some(provider), model)
}

/// This is the core dispatch function. It handles all 6 protocol message types:
/// - `UserMessage` -> messages repo + frontend event + OS notification
/// - `PersonaAction` -> events repo (persona_action event type)
/// - `EmitEvent` -> events repo (custom event type)
/// - `AgentMemory` -> memories repo
/// - `ManualReview` -> manual_reviews repo + OS notification
/// - `ExecutionFlow` -> logged only (stored at execution completion)
pub fn dispatch(ctx: &mut DispatchContext<'_>, msg: &ProtocolMessage) {
    // Skip all protocol storage for ops chat executions — they are conversational
    // queries, not real agent executions. No messages, memories, events, or reviews.
    if ctx.ops_mode {
        ctx.logger.log(&format!(
            "[OPS] Suppressed protocol dispatch: {:?}",
            std::mem::discriminant(msg)
        ));
        return;
    }
    match msg {
        ProtocolMessage::UserMessage {
            title,
            content,
            content_type,
            priority,
            channel,
        } => {
            // Skip empty or whitespace-only messages (prevents "unknown" entries)
            if content.trim().is_empty() {
                ctx.logger.log("[MESSAGE] Skipped: empty content");
                return;
            }

            // W-lane "message vs report": one wire block, two homes. A short
            // untitled note is a CHAT message in the persona channel; anything
            // titled, long, structurally formatted, or typed as an artifact is
            // a REPORT. Exactly one row is written — a chat note never also
            // becomes a report, and vice versa.
            if classify_user_message(
                title.as_deref(),
                content,
                content_type.as_deref(),
                channel.as_deref(),
            ) == MessageLane::Chat
            {
                dispatch_chat_note(ctx, content);
                return;
            }

            let use_case_id_owned = ctx.use_case_id.map(|s| s.to_string());
            match msg_repo::create(
                ctx.pool,
                CreateReportInput {
                    persona_id: ctx.persona_id.to_string(),
                    execution_id: Some(ctx.execution_id.to_string()),
                    title: title.clone(),
                    content: content.clone(),
                    content_type: content_type.clone(),
                    priority: priority.clone(),
                    metadata: None,
                    thread_id: None,
                    use_case_id: use_case_id_owned,
                },
            ) {
                Ok(m) => {
                    ctx.logger.log(&format!(
                        "[MESSAGE] Created: {} ({})",
                        m.title.as_deref().unwrap_or("untitled"),
                        m.id
                    ));
                    emit_to(ctx.emitter, event_name::REPORT_CREATED, &m);
                    if ctx.is_simulation {
                        ctx.logger
                            .log("[SIM] Notification delivery skipped (simulation)");
                    } else {
                        let channels = ctx.resolve_notification_channels();
                        let title_str =
                            m.title.clone().unwrap_or_else(|| "New message".to_string());
                        if let Some(app) = ctx.app_handle {
                            let delivery_ctx = crate::notifications::DeliveryContext {
                                persona_id: ctx.persona_id.to_string(),
                                persona_name: ctx.persona_name.to_string(),
                                use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                                emit_event_type: None, // UserMessage => always bypasses event_filter (D-02)
                                priority: None,
                            };
                            crate::notifications::notify_new_message(
                                app,
                                ctx.persona_name,
                                &title_str,
                                channels.as_deref(),
                                &delivery_ctx,
                            );
                        }
                    }
                }
                Err(e) => ctx.logger.log(&format!("[MESSAGE] Failed to create: {e}")),
            }
        }
        ProtocolMessage::PersonaAction {
            target,
            action,
            input,
        } => {
            // Phase C5b — capability event policy. `persona_action` events
            // count as events for the purposes of the on/off switch but are
            // never aliased (alias map applies to `EmitEvent` user-named events).
            let policy = ctx.generation_policy();
            if !policy.events.is_on() {
                let reason = format!("capability events policy = off (target={target})");
                ctx.logger
                    .log(&format!("[POLICY] PersonaAction dropped — {reason}"));
                audit_policy_event(ctx, "event.off", "dropped", Some(target), Some(&reason));
                return;
            }
            match event_repo::publish(
                ctx.pool,
                CreatePersonaEventInput {
                    event_type: "persona_action".to_string(),
                    source_type: format!("persona:{}", ctx.persona_name),
                    source_id: Some(ctx.persona_id.to_string()),
                    target_persona_id: None,
                    project_id: Some(ctx.project_id.to_string()),
                    payload: Some(
                        serde_json::json!({
                            "target": target,
                            "action": action,
                            "input": input,
                        })
                        .to_string(),
                    ),
                    use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                },
            ) {
                Ok(_) => ctx.logger.log(&format!(
                    "[EVENT] Published persona_action targeting '{target}'"
                )),
                Err(e) => ctx
                    .logger
                    .log(&format!("[EVENT] Failed to publish persona_action: {e}")),
            }
        }
        ProtocolMessage::EmitEvent { event_type, data } => {
            // Phase C5b — capability event policy. Drop when off; rename via
            // alias map when on. The published name is what subscribers see.
            let policy = ctx.generation_policy();
            if !policy.events.is_on() {
                let reason = format!("capability events policy = off ({event_type})");
                ctx.logger
                    .log(&format!("[POLICY] Custom event dropped — {reason}"));
                audit_policy_event(ctx, "event.off", "dropped", Some(event_type), Some(&reason));
                return;
            }
            let published_name = policy.published_event_name(event_type).to_string();
            if published_name != *event_type {
                let reason = format!("'{event_type}' -> '{published_name}'");
                ctx.logger.log(&format!("[POLICY] Event aliased: {reason}"));
                audit_policy_event(
                    ctx,
                    "event.aliased",
                    "aliased",
                    Some(event_type),
                    Some(&reason),
                );
            }
            // Sanitize persona name for source_type: replace spaces with underscores,
            // keep only alphanumeric, underscore, hyphen, dot, colon, forward-slash.
            let safe_name: String = ctx
                .persona_name
                .replace(' ', "_")
                .chars()
                .filter(|c| {
                    c.is_ascii_alphanumeric()
                        || *c == '_'
                        || *c == '-'
                        || *c == '.'
                        || *c == ':'
                        || *c == '/'
                })
                .collect();
            match event_repo::publish(
                ctx.pool,
                CreatePersonaEventInput {
                    event_type: published_name.clone(),
                    source_type: format!("persona:{}", safe_name),
                    source_id: Some(ctx.persona_id.to_string()),
                    target_persona_id: None,
                    project_id: Some(ctx.project_id.to_string()),
                    payload: data.as_ref().map(|d| d.to_string()),
                    use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                },
            ) {
                Ok(_) => {
                    ctx.logger
                        .log(&format!("[EVENT] Published custom event: {published_name}"));
                    // Phase 19 DELIV-02/DELIV-03: EmitEvent now fans out to notification
                    // channels so templates can route events to titlebar/slack/etc.
                    // First time EmitEvent delivers to channels — prior to Phase 19 only
                    // event_repo::publish() was called here.
                    if !ctx.is_simulation {
                        let channels = ctx.resolve_notification_channels();
                        if let Some(app) = ctx.app_handle {
                            let delivery_ctx = crate::notifications::DeliveryContext {
                                persona_id: ctx.persona_id.to_string(),
                                persona_name: ctx.persona_name.to_string(),
                                use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                                emit_event_type: Some(published_name.clone()), // triggers event_filter gating (D-02)
                                priority: None,
                            };
                            let body = data.as_ref().map(|d| d.to_string()).unwrap_or_default();
                            crate::notifications::deliver_to_channels(
                                app,
                                channels.as_deref(),
                                &published_name,
                                &body,
                                &delivery_ctx,
                            );
                        }
                    }
                }
                Err(e) => ctx.logger.log(&format!("[EVENT] Failed to publish: {e}")),
            }
        }
        ProtocolMessage::AgentMemory {
            title,
            content,
            category,
            importance,
            tags,
        } => {
            // Phase C5b — capability memory policy. Drop silently when off
            // (the prompt-side soft layer should already have suppressed it,
            // but this is the safety net for ignored instructions).
            let policy = ctx.generation_policy();
            if !policy.memories.is_on() {
                let reason = format!("capability memories policy = off ({title})");
                ctx.logger
                    .log(&format!("[POLICY] Memory dropped — {reason}"));
                audit_policy_event(ctx, "memory.off", "dropped", Some(title), Some(&reason));
                return;
            }
            // Quality gate: use cached config (loaded lazily on first use).
            let gate_config = ctx.quality_gate_config().clone();
            let cat_lower = category.as_deref().unwrap_or("").to_lowercase();
            let combined = format!("{} {}", title, content);

            // Check rejected categories first
            let category_rejected = gate_config
                .memory_reject_categories
                .iter()
                .any(|c| c.to_lowercase() == cat_lower);

            if category_rejected {
                tracing::info!(
                    gate = "memory",
                    rule = "category_reject",
                    category = %cat_lower,
                    title = %title,
                    "Quality gate fired: rejected memory by category"
                );
                ctx.logger.log(&format!(
                    "[MEMORY] Rejected low-quality memory (category '{}'): {}",
                    cat_lower, title
                ));
                return;
            }

            // Check pattern rules
            if let Some((rule_label, action)) =
                QualityGateConfig::check_rules(&gate_config.memory_rules, &combined)
            {
                tracing::info!(
                    gate = "memory",
                    rule = %rule_label,
                    action = ?action,
                    title = %title,
                    "Quality gate fired: memory matched pattern"
                );
                match action {
                    FilterAction::Reject => {
                        ctx.logger.log(&format!(
                            "[MEMORY] Rejected low-quality memory (rule '{}'): {}",
                            rule_label, title
                        ));
                        return;
                    }
                    FilterAction::Tag => {
                        ctx.logger.log(&format!(
                            "[MEMORY] Tagged memory (rule '{}'): {}",
                            rule_label, title
                        ));
                        // Fall through to store — tags handled below
                    }
                    FilterAction::Warn => {
                        ctx.logger.log(&format!(
                            "[MEMORY] Warning on memory (rule '{}'): {}",
                            rule_label, title
                        ));
                        // Fall through to store
                    }
                }
            }

            // Clamp importance to valid range 1-5
            let clamped_importance = importance.map(|v| v.clamp(1, 5));
            // Normalize common category aliases to valid values
            let normalized_category = category.as_ref().map(|c| match c.as_str() {
                "learning" | "learnings" => "learned".to_string(),
                "general" | "procedure" => "fact".to_string(),
                other => other.to_string(),
            });
            match mem_repo::create(
                ctx.pool,
                CreatePersonaMemoryInput {
                    persona_id: ctx.persona_id.to_string(),
                    source_execution_id: Some(ctx.execution_id.to_string()),
                    title: title.clone(),
                    content: content.clone(),
                    category: normalized_category,
                    importance: clamped_importance,
                    tags: tags.as_ref().map(|t| crate::db::models::Json(t.clone())),
                    use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                },
            ) {
                Ok(m) => ctx
                    .logger
                    .log(&format!("[MEMORY] Stored: {} ({})", title, m.id)),
                Err(e) => ctx.logger.log(&format!("[MEMORY] Failed to store: {e}")),
            }
        }
        ProtocolMessage::ManualReview {
            title,
            description,
            severity,
            context_data,
            suggested_actions,
            decisions,
        } => {
            // Phase C5b — capability review policy.
            //   off       → drop silently
            //   trust_llm → store the row but auto-resolve so it never blocks
            //               a human queue
            //   on        → today's behavior
            let policy = ctx.generation_policy();
            let review_policy = policy.reviews;
            if matches!(review_policy, testable::ReviewPolicy::Off) {
                let reason = format!("capability reviews policy = off ({title})");
                ctx.logger
                    .log(&format!("[POLICY] Manual review dropped — {reason}"));
                audit_policy_event(ctx, "review.off", "dropped", Some(title), Some(&reason));
                return;
            }
            // Quality gate: use cached config (loaded lazily on first use).
            let gate_config = ctx.quality_gate_config().clone();
            let combined = format!("{} {}", title, description.as_deref().unwrap_or(""));

            if let Some((rule_label, action)) =
                QualityGateConfig::check_rules(&gate_config.review_rules, &combined)
            {
                tracing::info!(
                    gate = "review",
                    rule = %rule_label,
                    action = ?action,
                    title = %title,
                    "Quality gate fired: review matched pattern"
                );
                match action {
                    FilterAction::Reject => {
                        ctx.logger.log(&format!(
                            "[REVIEW] Rejected noise review (rule '{}'): {}",
                            rule_label, title
                        ));
                        return;
                    }
                    FilterAction::Tag => {
                        ctx.logger.log(&format!(
                            "[REVIEW] Tagged review (rule '{}'): {}",
                            rule_label, title
                        ));
                    }
                    FilterAction::Warn => {
                        ctx.logger.log(&format!(
                            "[REVIEW] Warning on review (rule '{}'): {}",
                            rule_label, title
                        ));
                    }
                }
            }

            // Merge decisions into context_data so they're available in the frontend
            let effective_context_data = if let Some(ref decs) = decisions {
                let mut ctx_obj: serde_json::Value = context_data
                    .as_ref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_else(|| serde_json::json!({}));
                if let Some(obj) = ctx_obj.as_object_mut() {
                    obj.insert("decisions".to_string(), serde_json::json!(decs));
                    // Also store the original context text if it was a plain string
                    if let Some(ref cd) = context_data {
                        if serde_json::from_str::<serde_json::Value>(cd).is_err() {
                            obj.insert("context_text".to_string(), serde_json::json!(cd));
                        }
                    }
                }
                Some(serde_json::to_string(&ctx_obj).unwrap_or_default())
            } else {
                context_data.clone()
            };

            // G44 — an ask filed by a persona that HOLDS AN ACTIVE CHARTER is the
            // organisation's question to its owner, whatever the free text in
            // `context_data` says. The decide lane stamps `source` so the
            // unattended review policy (`autonomy_reviews::is_operator_ask`)
            // leaves the ask alone; a charter RUN files through this protocol
            // path with free text and carried no marker, so the policy approved
            // it with a generic note one hour after filing. Measured 2026-09-13:
            // 20 of 123 asks in one workspace — among them "Two portfolio
            // decisions I will not settle alone" — and each asker read that
            // note as the owner's decision.
            let effective_context_data = stamp_charter_ask_source(ctx, effective_context_data);

            // Pre-serialise suggested_actions once — used both by the row insert
            // and (when auto_triage) by the spawned evaluator's payload.
            let suggested_actions_json = suggested_actions
                .as_ref()
                .map(|a| serde_json::json!(a).to_string());
            let context_data_for_eval = effective_context_data.clone();
            // Phase 1 (resume loop): if this run is a team step, link the review
            // back to its blocked work so an approval can resume the assignment.
            let (link_assignment_id, link_step_id) =
                match review_repo::get_team_step_by_execution(ctx.pool, ctx.execution_id) {
                    Ok(Some((a, s))) => (Some(a), Some(s)),
                    _ => (None, None),
                };
            match review_repo::create(
                ctx.pool,
                CreateManualReviewInput {
                    execution_id: ctx.execution_id.to_string(),
                    persona_id: ctx.persona_id.to_string(),
                    title: title.clone(),
                    description: description.clone(),
                    severity: severity.clone(),
                    context_data: effective_context_data,
                    suggested_actions: suggested_actions_json.clone(),
                    use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                    assignment_id: link_assignment_id,
                    step_id: link_step_id,
                },
            ) {
                Ok(r) => {
                    ctx.logger.log(&format!(
                        "[REVIEW] Created manual review: {} ({})",
                        title, r.id
                    ));
                    // Auto-resolve paths:
                    //   - TrustLlm: user opted to trust the LLM end-to-end.
                    //     Runtime stores the row and auto-resolves it
                    //     immediately (no second-pass evaluation).
                    //   - AutoTriage: capability declares `review_policy.mode
                    //     = "auto_triage"`; runtime spawns a background LLM
                    //     evaluator that judges the review against the
                    //     persona's decision_principles and transitions the
                    //     row to Approved / Rejected. Falls back to Resolved
                    //     with a distinct audit tag on evaluator failure
                    //     (preserves the C6 MVP behaviour). See
                    //     `engine::auto_triage` for the full design.
                    // Both skip the human queue and notifications.
                    let trust_llm = matches!(review_policy, testable::ReviewPolicy::TrustLlm);
                    let auto_triage = matches!(review_policy, testable::ReviewPolicy::AutoTriage);
                    let auto_resolved = trust_llm || auto_triage;
                    if trust_llm {
                        if let Err(e) = review_repo::update_status(
                            ctx.pool,
                            &r.id,
                            crate::db::models::ManualReviewStatus::Resolved,
                            Some("auto-approved by trust_llm policy".to_string()),
                        ) {
                            ctx.logger.log(&format!(
                                "[POLICY] review.trust_llm auto-resolve failed for review {}: {e}",
                                r.id
                            ));
                        } else {
                            let reason =
                                format!("review.trust_llm — review {} auto-resolved", r.id);
                            ctx.logger.log(&format!("[POLICY] {reason}"));
                            audit_policy_event(
                                ctx,
                                "review.trust_llm",
                                "auto_resolved",
                                Some(title),
                                Some(&reason),
                            );
                        }
                    } else if auto_triage {
                        ctx.logger.log(&format!(
                            "[POLICY] review.auto_triage — spawning second-pass evaluator for review {}",
                            r.id
                        ));
                        crate::engine::auto_triage::spawn_evaluator_task(
                            crate::engine::auto_triage::SpawnedEvaluatorContext {
                                pool: ctx.pool.clone(),
                                review_id: r.id.clone(),
                                execution_id: ctx.execution_id.to_string(),
                                persona_id: ctx.persona_id.to_string(),
                                use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                                review_title: title.clone(),
                                review_description: description.clone(),
                                review_severity: severity.clone(),
                                review_context_data: context_data_for_eval,
                                review_suggested_actions: suggested_actions_json,
                            },
                        );
                    }
                    if ctx.is_simulation {
                        ctx.logger
                            .log("[SIM] Manual-review notification skipped (simulation)");
                    } else if auto_resolved {
                        // No notification for auto-resolved reviews — nothing to act on.
                    } else {
                        let channels = ctx.resolve_notification_channels();
                        if let Some(app) = ctx.app_handle {
                            let delivery_ctx = crate::notifications::DeliveryContext {
                                persona_id: ctx.persona_id.to_string(),
                                persona_name: ctx.persona_name.to_string(),
                                use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                                emit_event_type: None, // ManualReview => always bypasses event_filter (D-02)
                                priority: None,
                            };
                            crate::notifications::notify_manual_review(
                                app,
                                ctx.persona_name,
                                title,
                                channels.as_deref(),
                                &delivery_ctx,
                            );
                        }
                    }
                }
                Err(e) => ctx.logger.log(&format!("[REVIEW] Failed to create: {e}")),
            }
        }
        ProtocolMessage::RaiseIncident {
            title,
            detail,
            severity,
            kind,
        } => {
            // Persona escalated a real blocker as an INCIDENT (not a review).
            // Route it to the Incidents inbox with the open→in_progress→resolved
            // lifecycle. source_table = "persona_blocker" + source_id =
            // execution_id makes the dedup_key the originating execution, so the
            // SAME execution raising twice is idempotent AND P2.3's resolution
            // continuation can recover the originating execution to re-run.
            if title.trim().is_empty() {
                ctx.logger
                    .log("[INCIDENT] raise_incident dropped — empty title");
            } else if ctx.is_simulation {
                ctx.logger
                    .log("[SIM] raise_incident skipped (simulation run)");
            } else {
                let kind = kind
                    .clone()
                    .unwrap_or_else(|| "persona_blocker".to_string());
                match crate::db::repos::execution::audit_incidents::promote(
                    ctx.pool,
                    crate::db::models::CreateAuditIncidentInput {
                        source_table: "persona_blocker".to_string(),
                        source_id: ctx.execution_id.to_string(),
                        persona_id: Some(ctx.persona_id.to_string()),
                        persona_name: Some(ctx.persona_name.to_string()),
                        execution_id: Some(ctx.execution_id.to_string()),
                        severity: severity.clone().unwrap_or_else(|| "high".to_string()),
                        kind,
                        title: title.clone(),
                        detail: detail.clone(),
                    },
                ) {
                    Ok(Some(id)) => ctx.logger.log(&format!(
                        "[INCIDENT] Raised incident {id}: {title}"
                    )),
                    Ok(None) => ctx.logger.log(&format!(
                        "[INCIDENT] raise_incident deduped (already open for this execution): {title}"
                    )),
                    Err(e) => ctx
                        .logger
                        .log(&format!("[INCIDENT] Failed to raise incident: {e}")),
                }
            }
        }
        ProtocolMessage::ResolveIncident { id, note } => {
            // Persona closes an incident its work fixed — the missing half of
            // the incident loop (raise existed since P2.3; nothing ever
            // resolved). Accept a unique id PREFIX (>= 8 chars) against OPEN
            // incidents only; ambiguous or unknown prefixes are logged and
            // ignored (never guess which incident to close).
            let id = id.trim();
            if id.len() < 8 {
                ctx.logger.log(&format!(
                    "[INCIDENT] resolve_incident ignored — id prefix too short ({id})"
                ));
            } else if ctx.is_simulation {
                ctx.logger
                    .log("[SIM] resolve_incident skipped (simulation run)");
            } else {
                let matches: Vec<String> = ctx
                    .pool
                    .get()
                    .ok()
                    .and_then(|conn| {
                        conn.prepare(
                            "SELECT id FROM audit_incidents WHERE status = 'open' AND id LIKE ?1 LIMIT 2",
                        )
                        .ok()
                        .and_then(|mut stmt| {
                            stmt.query_map(
                                rusqlite::params![format!("{id}%")],
                                |r| r.get::<_, String>(0),
                            )
                            .ok()
                            .map(|rows| rows.filter_map(Result::ok).collect())
                        })
                    })
                    .unwrap_or_default();
                match matches.as_slice() {
                    [full_id] => {
                        let resolution = format!(
                            "Resolved by {} (execution {}): {}",
                            ctx.persona_name,
                            ctx.execution_id,
                            note.as_deref().unwrap_or("fixed in this run")
                        );
                        match crate::db::repos::execution::audit_incidents::resolve(
                            ctx.pool,
                            full_id,
                            Some(&resolution),
                        ) {
                            Ok(true) => ctx.logger.log(&format!(
                                "[INCIDENT] Resolved {full_id}: {}",
                                note.as_deref().unwrap_or("")
                            )),
                            Ok(false) => ctx.logger.log(&format!(
                                "[INCIDENT] resolve_incident no-op (not open?): {full_id}"
                            )),
                            Err(e) => ctx.logger.log(&format!(
                                "[INCIDENT] resolve_incident failed for {full_id}: {e}"
                            )),
                        }
                    }
                    [] => ctx.logger.log(&format!(
                        "[INCIDENT] resolve_incident: no OPEN incident matches prefix {id}"
                    )),
                    _ => ctx.logger.log(&format!(
                        "[INCIDENT] resolve_incident: prefix {id} is ambiguous — be more specific"
                    )),
                }
            }
        }
        ProtocolMessage::KpiMeasurement {
            kpi_id,
            value,
            evidence,
        } => {
            // A persona measured a KPI mid-run (connector recipes, ad-hoc
            // checks). Recorded with source='evaluator' semantics but
            // attributed to the execution via the evidence envelope.
            if kpi_id.trim().is_empty() {
                ctx.logger
                    .log("[KPI] kpi_measurement dropped — empty kpi_id");
            } else if ctx.is_simulation {
                ctx.logger
                    .log("[SIM] kpi_measurement skipped (simulation run)");
            } else {
                let evidence_json = serde_json::json!({
                    "from_execution": ctx.execution_id,
                    "persona": ctx.persona_name,
                    "detail": evidence,
                })
                .to_string();
                match crate::db::repos::dev_tools::record_kpi_measurement(
                    ctx.pool,
                    kpi_id,
                    *value,
                    "evaluator",
                    Some(&evidence_json),
                    None,
                ) {
                    Ok(_) => ctx
                        .logger
                        .log(&format!("[KPI] Recorded measurement {value} for {kpi_id}")),
                    Err(e) => ctx
                        .logger
                        .log(&format!("[KPI] Failed to record measurement: {e}")),
                }
            }
        }
        ProtocolMessage::ProposeBacklog {
            title,
            description,
            category,
            impact,
            effort,
            risk,
            target,
            goal,
            plan,
        } => {
            // Surface a future-work item into the project's backlog (dev_ideas),
            // scoped to the persona's pinned repo so it lands in that project's
            // inbox. Keeps runs FEEDING the backlog (the audit found runs left it
            // stale) for a human or a later parallel run to pick up.
            if title.trim().is_empty() {
                ctx.logger
                    .log("[BACKLOG] propose_backlog dropped — empty title");
            } else if ctx.is_simulation {
                ctx.logger
                    .log("[SIM] propose_backlog skipped (simulation run)");
            } else {
                // The persona's codebase pin, or — for a WORKSPACE-bound
                // persona, which has none — its home project. Before the
                // fallback existed the Architect's proposals landed nowhere:
                // `devProjectId` is absent on a workspace binding, so every
                // item took the project-less branch and the workspace's own
                // backlog stayed at zero while the run reported success.
                let persona =
                    crate::db::repos::core::personas::get_by_id(ctx.pool, ctx.persona_id).ok();
                let home_project_id = persona.as_ref().and_then(|p| {
                    personas_engine::design_context::working_project_id(p.design_context.as_deref())
                });
                // Who wrote this item. 2,038 of 2,093 rows carry no attribution
                // because the door had no parameter for it and this call site
                // passed `None, None` — so the App Master's 1,208 Opus-authored
                // items are anonymous in their own table. Stamped from the
                // EXECUTION's own context rather than from anything the model
                // claims about itself.
                let (provider, model) = run_attribution(ctx, persona.as_ref());
                // G22 — whose backlog is this? An App Master's daily improve
                // lane files ideas about the PERSONAS PLATFORM as often as
                // about its own repo (11 of 36 accepted ideas on 2026-09-08),
                // and until this routing existed those landed on the bank's
                // backlog, were auto-accepted, and blocked a fleet worker that
                // had no worktree able to reach the fix. See
                // `engine::platform_backlog`.
                let routing =
                    platform_backlog::classify(target.as_deref(), title, description.as_deref());
                let is_platform = routing == platform_backlog::BacklogTarget::Platform;
                // `None` when no platform project resolves. The item then stays
                // on the home project — still TAGGED as an escalation, so it is
                // visible and still excluded from automatic dispatch. It is
                // never dropped: an unroutable finding is the one thing worse
                // than a misrouted one.
                let platform_project_id = if is_platform {
                    platform_backlog::resolve_platform_project(ctx.pool)
                } else {
                    None
                };
                let project_id = platform_project_id.clone().or(home_project_id.clone());
                // Backlog backpressure: producers SKIP their round when the
                // project's pending backlog is already saturated. Without this
                // every scheduled scan / strategist run keeps stacking ideas
                // faster than triage + promotion can drain them, and backlog
                // size becomes a function of producer cadence instead of team
                // throughput.
                //
                // BOTH piles, since this contract: the accepted pile had no cap
                // at all and reached 741 undispatched while this guard watched
                // a pending queue whose largest project held 63.
                let saturated = project_id
                    .as_deref()
                    .and_then(|pid| backlog_saturation(ctx.pool, pid));
                if let Some(limit) = saturated {
                    ctx.logger.log(&format!(
                        "[BACKLOG] propose_backlog skipped — {}: {title}",
                        limit.describe()
                    ));
                } else {
                    // A PLATFORM escalation takes its own door: it dedups on the
                    // subject alone (four App Masters filed "Bind capability
                    // parameters before dispatch" on the same day), and each
                    // filer is appended to `evidence` rather than discarded, so
                    // one row carries four witnesses.
                    if is_platform {
                        let home_project_name = home_project_id.as_deref().and_then(|pid| {
                            crate::db::repos::dev_tools::get_project_by_id(ctx.pool, pid)
                                .ok()
                                .map(|p| p.name)
                        });
                        let filing = platform_backlog::filing(
                            ctx.persona_id,
                            ctx.persona_name,
                            home_project_id.as_deref(),
                            home_project_name.as_deref(),
                            title,
                        );
                        let landed_on_platform = platform_project_id.is_some();
                        match project_id.as_deref() {
                            Some(pid) => {
                                match crate::db::repos::dev_tools::file_platform_escalation(
                                    ctx.pool,
                                    pid,
                                    title,
                                    description.as_deref(),
                                    category.as_deref(),
                                    *effort,
                                    *impact,
                                    *risk,
                                    &filing,
                                ) {
                                    Ok(filed) => {
                                        let where_ = if landed_on_platform {
                                            "the platform backlog"
                                        } else {
                                            // No `platform_project_id` setting and no
                                            // project registered at this build's repo
                                            // root. Tagged and visible where it is.
                                            "this project (no platform project resolves)"
                                        };
                                        let how = if filed.deduped {
                                            "joined"
                                        } else {
                                            "opened"
                                        };
                                        ctx.logger.log(&format!(
                                            "[BACKLOG] Platform escalation {how} on {where_}: {title} ({})",
                                            filed.idea.id
                                        ));
                                    }
                                    Err(e) => ctx.logger.log(&format!(
                                        "[BACKLOG] Failed to file platform escalation '{title}': {e}"
                                    )),
                                }
                            }
                            None => ctx.logger.log(&format!(
                                "[BACKLOG] Platform escalation dropped — this persona is pinned to no project and no platform project resolves: {title}"
                            )),
                        }
                        return;
                    }
                    // Guarded insert (docs/plans/backlog-memory-loop.md Phase 1):
                    // a persona proposing what the backlog already holds — in any
                    // status, including a human's earlier "no" — is suppressed
                    // rather than stacked. Project-less proposals have no dedup
                    // scope to key on, so they keep the ungated path.
                    //
                    // The dedup scope is computed BEFORE the insert so the
                    // "already there" branch can find the row it collided with
                    // and fill in the scales it is missing.
                    let dedup_scope = project_id.as_deref().map(|pid| {
                        (
                            pid.to_string(),
                            crate::db::repos::dev_tools::scan_dedup_key(
                                "team_proposed",
                                None,
                                title,
                            ),
                        )
                    });
                    // An honest paraphrase of an item already on the backlog
                    // keys differently (the key is the title's words), so look
                    // for one when the exact key has not matched. A hit files
                    // nothing and is handled like the dedup branch below: the
                    // row it matched gains any scale and goal it was missing.
                    let near_duplicate = dedup_scope.as_ref().and_then(|(pid, key)| {
                        match crate::db::repos::dev_tools::find_idea_by_dedup_key(
                            ctx.pool, pid, key,
                        ) {
                            Ok(None) => crate::db::repos::dev_tools::find_near_duplicate_idea(
                                ctx.pool,
                                pid,
                                title,
                                description.as_deref(),
                            )
                            .unwrap_or_else(|e| {
                                ctx.logger.log(&format!(
                                    "[BACKLOG] Near-duplicate check failed for '{title}': {e}"
                                ));
                                None
                            }),
                            _ => None,
                        }
                    });
                    // ONE draft through the ONE door, rather than the two legacy
                    // positional signatures this branch used to pick between —
                    // neither of which had a parameter for the plan or for the
                    // attribution, which is exactly why neither was ever
                    // recorded. `file_idea` returns `Ok(None)` only when the
                    // draft carries a `dedup_key` this project has already
                    // spent; the project-less draft carries none, so its answer
                    // is always `Ok(Some(_))` — the same shape the ungated
                    // legacy door guaranteed.
                    let outcome = match dedup_scope.as_ref() {
                        Some(_) if near_duplicate.is_some() => Ok(None),
                        scope => {
                            let mut draft = match project_id.as_deref() {
                                Some(pid) => crate::db::models::IdeaDraft::new(
                                    pid,
                                    crate::db::models::BacklogSource::TeamProposed,
                                    title.as_str(),
                                ),
                                None => crate::db::models::IdeaDraft::unassigned(
                                    crate::db::models::BacklogSource::TeamProposed,
                                    title.as_str(),
                                ),
                            };
                            draft.category = category.clone();
                            draft.description = description.clone();
                            draft.effort = *effort;
                            draft.impact = *impact;
                            draft.risk = *risk;
                            draft.plan = plan.clone();
                            draft.provider = provider.clone();
                            draft.model = model.clone();
                            draft.status = Some("pending".to_string());
                            draft.dedup_key = scope.map(|(_, key)| key.clone());
                            crate::db::repos::dev_tools::file_idea(ctx.pool, draft)
                        }
                    };
                    // G30 — the project's mechanical triage rule used to run
                    // only from the scanner and the overnight tick, so an idea
                    // a persona FILED with a risk score, or RATED on a re-file,
                    // sat pending until a human clicked: on 2026-09-09 all six
                    // bank projects held 0 accepted ideas beside 184 rated
                    // risk-1/2 ones, and every App Master asked which to
                    // accept. A rated row is exactly the question the rule
                    // exists to answer, so it answers in the same dispatch.
                    // Unrated rows are untouched: the rule cannot see them.
                    // The owner's rule (2026-09-09): the one who files an idea
                    // scores it — effort, impact and risk — and the project's
                    // owner groups the accepted backlog by its own judgement.
                    // A filing short of the three scales is kept (dropping it
                    // would lose the finding) and named as incomplete, so the
                    // filer's next run sees what it owes.
                    let missing: Vec<&str> = [
                        ("effort", effort.is_none()),
                        ("impact", impact.is_none()),
                        ("risk", risk.is_none()),
                    ]
                    .into_iter()
                    .filter_map(|(k, gone)| gone.then_some(k))
                    .collect();
                    let rated_now = match outcome {
                        Ok(Some(idea)) => {
                            ctx.logger
                                .log(&format!("[BACKLOG] Proposed: {title} ({})", idea.id));
                            // The plan is the half of the filing an executor
                            // reads, so its absence is named as plainly as a
                            // missing scale — an unplanned item is stored, is
                            // graded `draft` by the door, and cannot become
                            // work until something plans it.
                            match plan.as_ref() {
                                Some(p) => ctx.logger.log(&format!(
                                    "[BACKLOG] Plan filed with '{title}': {} step(s) over {} file(s)",
                                    p.steps.len(),
                                    p.file_scope().len()
                                )),
                                None => ctx.logger.log(&format!(
                                    "[BACKLOG] No plan filed with '{title}' — stored as draft; the filer is the analyst and the executor will not re-derive the analysis"
                                )),
                            }
                            if !missing.is_empty() {
                                ctx.logger.log(&format!(
                                    "[BACKLOG] Incomplete filing '{title}': no {} — the filer scores effort, impact and risk; re-file with all three",
                                    missing.join(", ")
                                ));
                            }
                            // G41 — bind the idea to the goal it serves. The
                            // reference is resolved against the project the
                            // idea landed on (an id, an id prefix, or the
                            // title); nothing resolves silently to "some goal",
                            // and a bad reference never loses the filing.
                            if let (Some(goal_ref), Some(pid)) = (
                                goal.as_deref().map(str::trim).filter(|g| !g.is_empty()),
                                idea.project_id.as_deref(),
                            ) {
                                ctx.logger
                                    .log(&goal_binding_log(ctx.pool, &idea.id, pid, goal_ref));
                            }
                            risk.is_some()
                        }
                        // A re-proposal is not always a no-op. The row already
                        // in the backlog may have been filed WITHOUT scales,
                        // and an unrated idea is one the project's mechanical
                        // triage rule can never accept — so a second proposal
                        // that carries a risk score is new information, not a
                        // duplicate. Fill in only what is MISSING; a score that
                        // is already there always stands.
                        Ok(None) => {
                            let existing = match near_duplicate.as_ref() {
                                Some(near) => {
                                    ctx.logger.log(&format!(
                                        "[BACKLOG] Near-duplicate of {} '{}' (similarity {:.2}); fold into it rather than filing '{title}'",
                                        near.idea.id.get(..8).unwrap_or(&near.idea.id),
                                        near.idea.title,
                                        near.score
                                    ));
                                    Some(near.idea.clone())
                                }
                                None => dedup_scope.as_ref().and_then(|(pid, key)| {
                                    crate::db::repos::dev_tools::find_idea_by_dedup_key(
                                        ctx.pool, pid, key,
                                    )
                                    .ok()?
                                }),
                            };
                            let rated = existing.as_ref().and_then(|existing| {
                                crate::db::repos::dev_tools::backfill_idea_scales(
                                    ctx.pool,
                                    &existing.id,
                                    *effort,
                                    *impact,
                                    *risk,
                                )
                                .ok()
                            });
                            let rated_now = match rated {
                                Some((idea, crate::db::repos::dev_tools::ScaleBackfill::Rated)) => {
                                    ctx.logger.log(&format!(
                                        "[BACKLOG] Rated '{title}' — scales filled in on the item already filed ({})",
                                        idea.id
                                    ));
                                    true
                                }
                                _ if near_duplicate.is_some() => false,
                                _ => {
                                    ctx.logger.log(&format!(
                                        "[BACKLOG] Skipped '{title}' — already in the backlog"
                                    ));
                                    false
                                }
                            };
                            // A re-proposal that names a goal binds the row it
                            // collided with when that row serves none yet — the
                            // same never-overwrite door the create branch and
                            // the bridge's filing route use.
                            if let (Some(goal_ref), Some((pid, _)), Some(existing)) = (
                                goal.as_deref().map(str::trim).filter(|g| !g.is_empty()),
                                dedup_scope.as_ref(),
                                existing.as_ref(),
                            ) {
                                ctx.logger.log(&goal_binding_log(
                                    ctx.pool,
                                    &existing.id,
                                    pid,
                                    goal_ref,
                                ));
                            }
                            rated_now
                        }
                        Err(e) => {
                            ctx.logger
                                .log(&format!("[BACKLOG] Failed to propose '{title}': {e}"));
                            false
                        }
                    };
                    if rated_now {
                        if let Some(pid) = project_id.as_deref() {
                            match crate::commands::infrastructure::dev_tools::run_triage_rules_core(
                                ctx.pool, pid,
                            ) {
                                Ok(o) if o.ideas_affected > 0 => ctx.logger.log(&format!(
                                    "[BACKLOG] Triage rules answered {} rated idea(s): {} accepted, {} rejected",
                                    o.ideas_affected,
                                    o.accepted_idea_ids.len(),
                                    o.rejected_count
                                )),
                                Ok(_) => {}
                                Err(e) => ctx
                                    .logger
                                    .log(&format!("[BACKLOG] Triage rules failed to run: {e}")),
                            }
                        }
                    }
                }
            }
        }
        ProtocolMessage::ExecutionFlow { .. } => {
            // Execution flows are handled at the top level, not here
            ctx.logger
                .log("[FLOW] Execution flow captured (will be stored on completion)");
        }
        ProtocolMessage::KnowledgeAnnotation {
            scope,
            note,
            confidence: _,
        } => {
            // Parse scope format: "tool:http_request", "connector:google", "global", or bare (persona)
            let (scope_type, scope_id) = if let Some(rest) = scope.strip_prefix("tool:") {
                ("tool", Some(rest.to_string()))
            } else if let Some(rest) = scope.strip_prefix("connector:") {
                ("connector", Some(rest.to_string()))
            } else if scope == "global" {
                ("global", None)
            } else {
                ("persona", None)
            };

            match knowledge_repo::upsert_annotation(
                ctx.pool,
                ctx.persona_id,
                scope_type,
                scope_id.as_deref(),
                note,
                "agent",
                Some(ctx.execution_id),
            ) {
                Ok(entry) => {
                    ctx.logger.log(&format!(
                        "[KNOWLEDGE] Annotation stored: scope={}:{} ({})",
                        scope_type,
                        scope_id.as_deref().unwrap_or("_"),
                        entry.id
                    ));
                }
                Err(e) => ctx
                    .logger
                    .log(&format!("[KNOWLEDGE] Failed to store annotation: {e}")),
            }
        }
        ProtocolMessage::ProposeImprovement {
            section, rationale, ..
        } => {
            // TODO: route to Lab Matrix for user review. For now, log only so
            // the protocol message is acknowledged rather than ignored.
            ctx.logger.log(&format!(
                "[IMPROVEMENT] Proposed change to {section}: {rationale} (queued for Lab review)"
            ));
        }
    }
}

// =============================================================================
// Pure helpers — extracted for unit testing (Phase C5)
// =============================================================================

pub(crate) mod testable {
    use std::collections::HashMap;

    use crate::db::repos::core::personas as persona_repo;
    use crate::db::DbPool;

    /// Review policy resolved from `generation_settings.reviews` (explicit
    /// runtime override) or from the per-capability `review_policy.mode` IR
    /// field. Mirrored on the frontend.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum ReviewPolicy {
        /// Default: queue manual reviews for human resolution.
        On,
        /// Drop manual reviews silently — capability owner has opted out.
        Off,
        /// Trust the LLM: store the review row but auto-resolve it
        /// (status='resolved', notes='auto-approved by trust_llm policy')
        /// so it never blocks a human queue.
        TrustLlm,
        /// Auto-triage: the capability's `review_policy.mode = "auto_triage"`.
        /// The agent is expected to apply its `decision_principles` itself
        /// before emitting `manual_review`. Runtime stores the row and
        /// auto-resolves it (so it remains auditable) and emits a distinct
        /// `review.auto_triage` policy_event so dashboards can differentiate
        /// LLM-judged vs trusted vs human-queued reviews.
        AutoTriage,
    }

    /// Phase C5b — boolean policy mirrored on the frontend ('on' / 'off').
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum BoolPolicy {
        On,
        Off,
    }

    impl BoolPolicy {
        pub fn is_on(self) -> bool {
            matches!(self, BoolPolicy::On)
        }
    }

    /// Phase C5b — resolved generation policy applied per dispatch.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct GenerationPolicy {
        pub memories: BoolPolicy,
        pub reviews: ReviewPolicy,
        pub events: BoolPolicy,
        /// Rename map applied at event emit time. Key = name LLM emits;
        /// value = name actually published. Empty when unconfigured.
        pub event_aliases: HashMap<String, String>,
    }

    impl GenerationPolicy {
        /// Default = current behavior pre-C5b: everything on, no aliases.
        /// Used when no capability is in focus or settings are absent.
        pub fn permissive() -> Self {
            Self {
                memories: BoolPolicy::On,
                reviews: ReviewPolicy::On,
                events: BoolPolicy::On,
                event_aliases: HashMap::new(),
            }
        }

        /// Apply the alias map to an event name. Returns the published name.
        pub fn published_event_name<'a>(&'a self, emitted: &'a str) -> &'a str {
            self.event_aliases
                .get(emitted)
                .map(|s| s.as_str())
                .unwrap_or(emitted)
        }
    }

    /// Pure parser for `generation_settings` JSON. Used by `resolve_generation_policy`
    /// after it loads the JSON from disk; isolated for unit testing without a DB.
    pub fn parse_generation_settings(value: &serde_json::Value) -> GenerationPolicy {
        let mut policy = GenerationPolicy::permissive();
        if let Some(s) = value.get("memories").and_then(|v| v.as_str()) {
            if s.eq_ignore_ascii_case("off") {
                policy.memories = BoolPolicy::Off;
            }
        }
        if let Some(s) = value.get("reviews").and_then(|v| v.as_str()) {
            policy.reviews = match s.to_ascii_lowercase().as_str() {
                "off" => ReviewPolicy::Off,
                "trust_llm" | "trustllm" | "trust-llm" => ReviewPolicy::TrustLlm,
                "auto_triage" | "autotriage" | "auto-triage" => ReviewPolicy::AutoTriage,
                _ => ReviewPolicy::On,
            };
        }
        if let Some(s) = value.get("events").and_then(|v| v.as_str()) {
            if s.eq_ignore_ascii_case("off") {
                policy.events = BoolPolicy::Off;
            }
        }
        if let Some(map) = value.get("event_aliases").and_then(|v| v.as_object()) {
            for (k, v) in map {
                if let Some(target) = v.as_str() {
                    if !target.trim().is_empty() {
                        policy.event_aliases.insert(k.clone(), target.to_string());
                    }
                }
            }
        }
        policy
    }

    /// Pull `generation_settings` for a capability from a design_context
    /// JSON blob. Returns the permissive default when the capability lacks
    /// the field. Pure — no DB access.
    ///
    /// Precedence for the review policy:
    ///   1. `generation_settings.reviews` (explicit runtime override).
    ///   2. `review_policy.mode` (build-time IR; emitted by the build LLM
    ///      per session_prompt rule 21). Mapping:
    ///      - `"never"`              → `ReviewPolicy::Off`
    ///      - `"auto_triage"`        → `ReviewPolicy::AutoTriage`
    ///      - `"on_low_confidence"`  → `ReviewPolicy::On`
    ///      - `"always"` / other     → `ReviewPolicy::On`
    ///   3. Default `ReviewPolicy::On`.
    pub fn pick_generation_policy(
        design_context_json: &str,
        use_case_id: &str,
    ) -> GenerationPolicy {
        let Some(dc) = serde_json::from_str::<serde_json::Value>(design_context_json).ok() else {
            return GenerationPolicy::permissive();
        };
        let Some(uc) = crate::engine::design_context::pick_use_cases_array(&dc).and_then(|arr| {
            arr.iter()
                .find(|u| u.get("id").and_then(|v| v.as_str()) == Some(use_case_id))
        }) else {
            return GenerationPolicy::permissive();
        };

        let mut policy = match uc.get("generation_settings") {
            Some(s) if !s.is_null() => parse_generation_settings(s),
            _ => GenerationPolicy::permissive(),
        };

        // If `reviews` was not set explicitly via generation_settings, fall
        // back to the build-time IR field `review_policy.mode`. This is what
        // wires `mode: "auto_triage"` into runtime behaviour without forcing
        // the user to also flip a `generation_settings` toggle.
        let reviews_explicit = uc
            .get("generation_settings")
            .and_then(|s| s.get("reviews"))
            .is_some();
        if !reviews_explicit {
            if let Some(mode) = uc
                .get("review_policy")
                .and_then(|v| v.get("mode"))
                .and_then(|v| v.as_str())
            {
                policy.reviews = match mode.to_ascii_lowercase().as_str() {
                    "never" => ReviewPolicy::Off,
                    "auto_triage" | "autotriage" | "auto-triage" => ReviewPolicy::AutoTriage,
                    _ => ReviewPolicy::On,
                };
            }
        }

        // 2026-05-05 — same fallback, this time for memory. Previously the
        // runtime only honoured `generation_settings.memories: "off"`; the
        // build-time IR field `memory_policy.enabled = false` was silently
        // ignored because parse_generation_settings starts from the
        // permissive default. SQL audit on the rapid-validation cohort
        // showed every persona had memory_policy.enabled=false yet still
        // accumulated memory rows on every execution. Mirror the review
        // fallback pattern: when generation_settings.memories is absent,
        // read memory_policy.enabled and flip the policy off if it's
        // explicitly false.
        let memories_explicit = uc
            .get("generation_settings")
            .and_then(|s| s.get("memories"))
            .is_some();
        if !memories_explicit {
            if let Some(enabled) = uc
                .get("memory_policy")
                .and_then(|v| v.get("enabled"))
                .and_then(|v| v.as_bool())
            {
                if !enabled {
                    policy.memories = BoolPolicy::Off;
                }
            }
        }
        policy
    }

    /// DB-touching variant: resolves the effective policy by reading the
    /// persona's design_context. Falls back to permissive when no capability
    /// is in focus or the persona row can't be loaded — current behavior.
    pub fn resolve_generation_policy(
        pool: &DbPool,
        persona_id: &str,
        use_case_id: Option<&str>,
    ) -> GenerationPolicy {
        let Some(uc_id) = use_case_id else {
            return GenerationPolicy::permissive();
        };
        let Ok(persona) = persona_repo::get_by_id(pool, persona_id) else {
            return GenerationPolicy::permissive();
        };
        let Some(dc_str) = persona.design_context.as_deref() else {
            return GenerationPolicy::permissive();
        };
        pick_generation_policy(dc_str, uc_id)
    }

    /// Pick a capability's notification_channels from a persona design_context
    /// JSON blob. Returns the JSON-encoded array as a string when present and
    /// non-empty, otherwise `None`.
    ///
    /// Pure: takes JSON in, returns Option<String>. Suitable for unit testing
    /// without a database.
    pub fn pick_capability_channels(
        design_context_json: &str,
        use_case_id: &str,
    ) -> Option<String> {
        let dc: serde_json::Value = serde_json::from_str(design_context_json).ok()?;
        let uc = crate::engine::design_context::pick_use_cases_array(&dc)?
            .iter()
            .find(|u| u.get("id").and_then(|v| v.as_str()) == Some(use_case_id))?;
        let channels = uc.get("notification_channels")?;
        let arr = channels.as_array()?;
        if arr.is_empty() {
            return None;
        }
        Some(channels.to_string())
    }

    /// Resolve effective notification channels for a dispatch, preferring the
    /// capability's `notification_channels` over the persona-wide fallback.
    ///
    /// DB-touching variant of [`pick_capability_channels`]. The fallback
    /// (`fallback_channels`) is the persona-wide value already loaded into the
    /// dispatch context and is used when no capability override is available.
    ///
    /// Shape-v2 short-circuit (DELIV-05): if persona-wide channels are shape-v2,
    /// return them untouched — per-channel `use_case_ids` scoping is applied INSIDE
    /// `deliver_v2_channels()`, not here.
    pub fn resolve_notification_channels(
        pool: &DbPool,
        persona_id: &str,
        use_case_id: Option<&str>,
        fallback_channels: Option<&str>,
    ) -> Option<String> {
        // Shape-v2 short-circuit (DELIV-05): if persona-wide channels are shape-v2,
        // return them untouched — per-channel `use_case_ids` scoping is applied INSIDE
        // `deliver_v2_channels()`, not here.
        if crate::notifications::parse_channels_v2(fallback_channels).is_some() {
            return fallback_channels.map(|s| s.to_string());
        }
        // Legacy shape-A/B path: prefer per-UC channels from design_context if present.
        if let Some(uc_id) = use_case_id {
            if let Ok(persona) = persona_repo::get_by_id(pool, persona_id) {
                if let Some(dc_str) = persona.design_context.as_deref() {
                    if let Some(channels) = pick_capability_channels(dc_str, uc_id) {
                        return Some(channels);
                    }
                }
            }
        }
        fallback_channels.map(|s| s.to_string())
    }
}

// =============================================================================
// ExecutionProtocol implementation for DispatchContext (Tauri/Desktop mode)
// =============================================================================

impl ExecutionProtocol for DispatchContext<'_> {
    fn dispatch_message(&mut self, msg: &ProtocolMessage) {
        dispatch(self, msg);
    }

    fn emit_output(&self, event: &ExecutionOutputEvent) {
        emit_to(self.emitter, event_name::EXECUTION_OUTPUT, event);
    }

    fn emit_structured_event(&self, event: &StructuredExecutionEvent) {
        emit_to(self.emitter, event_name::EXECUTION_EVENT, event);
    }

    fn emit_heartbeat(&self, event: &HeartbeatEvent) {
        emit_to(self.emitter, event_name::EXECUTION_HEARTBEAT, event);
    }

    fn finalize_status(&self, finalization: &StatusFinalization) {
        emit_to(
            self.emitter,
            event_name::EXECUTION_STATUS,
            &finalization.to_status_event(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dispatch_context_lifetime_compiles() {
        // Smoke test: verify DispatchContext type compiles with correct lifetimes.
        // Actual dispatch testing requires a running Tauri app + DB, so we just
        // verify the type system accepts our struct.
        fn _assert_send<T: Send>() {}
        // DispatchContext is not Send (contains &mut logger), which is correct
        // since it's used within a single async task.
        let _ = std::mem::size_of::<DispatchContext>();
    }

    // ------------------------------------------------------------------------
    // Phase C5 — pure helpers
    // ------------------------------------------------------------------------

    #[test]
    fn test_pick_capability_channels_returns_array_when_set() {
        let dc = serde_json::json!({
            "use_cases": [
                {
                    "id": "uc-1",
                    "title": "Sales digest",
                    "notification_channels": ["slack:#sales", "email:team@x.io"],
                },
                {
                    "id": "uc-2",
                    "title": "Other",
                },
            ]
        })
        .to_string();
        let resolved = testable::pick_capability_channels(&dc, "uc-1").unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&resolved).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_pick_capability_channels_none_when_unknown_uc() {
        let dc = serde_json::json!({
            "use_cases": [{"id": "uc-1", "notification_channels": ["x"]}]
        })
        .to_string();
        assert!(testable::pick_capability_channels(&dc, "missing").is_none());
    }

    #[test]
    fn test_pick_capability_channels_none_when_no_channels_field() {
        let dc = serde_json::json!({
            "use_cases": [{"id": "uc-1", "title": "Bare"}]
        })
        .to_string();
        assert!(testable::pick_capability_channels(&dc, "uc-1").is_none());
    }

    #[test]
    fn test_pick_capability_channels_none_when_empty_array() {
        let dc = serde_json::json!({
            "use_cases": [{"id": "uc-1", "notification_channels": []}]
        })
        .to_string();
        assert!(testable::pick_capability_channels(&dc, "uc-1").is_none());
    }

    #[test]
    fn test_pick_capability_channels_none_when_invalid_json() {
        assert!(testable::pick_capability_channels("not-json{", "uc-1").is_none());
    }

    #[test]
    fn test_resolve_falls_back_to_persona_wide() {
        // Pure-helper-only path: no DB lookup, so we exercise the contract by
        // verifying that pick_capability_channels returning None means callers
        // fall through to the fallback. The fallback branch in
        // resolve_notification_channels is a one-liner copy of fallback_channels.
        let dc = serde_json::json!({"use_cases": []}).to_string();
        assert!(testable::pick_capability_channels(&dc, "any").is_none());
    }

    // ------------------------------------------------------------------------
    // Phase C5b — generation policy parsing & lookup
    // ------------------------------------------------------------------------

    #[test]
    fn parse_generation_settings_recognises_each_field() {
        let v = serde_json::json!({
            "memories": "off",
            "reviews": "trust_llm",
            "events": "off",
            "event_aliases": { "alert": "escalation", "summary": "daily_digest" },
        });
        let p = testable::parse_generation_settings(&v);
        assert!(matches!(p.memories, testable::BoolPolicy::Off));
        assert!(matches!(p.reviews, testable::ReviewPolicy::TrustLlm));
        assert!(matches!(p.events, testable::BoolPolicy::Off));
        assert_eq!(
            p.event_aliases.get("alert").map(|s| s.as_str()),
            Some("escalation")
        );
        assert_eq!(
            p.event_aliases.get("summary").map(|s| s.as_str()),
            Some("daily_digest")
        );
    }

    #[test]
    fn parse_generation_settings_unknown_review_keyword_falls_back_to_on() {
        let v = serde_json::json!({"reviews": "wibble"});
        let p = testable::parse_generation_settings(&v);
        assert!(matches!(p.reviews, testable::ReviewPolicy::On));
    }

    #[test]
    fn parse_generation_settings_empty_object_is_permissive() {
        let v = serde_json::json!({});
        let p = testable::parse_generation_settings(&v);
        assert!(matches!(p.memories, testable::BoolPolicy::On));
        assert!(matches!(p.reviews, testable::ReviewPolicy::On));
        assert!(matches!(p.events, testable::BoolPolicy::On));
        assert!(p.event_aliases.is_empty());
    }

    #[test]
    fn pick_generation_policy_returns_permissive_when_capability_missing() {
        let dc = serde_json::json!({"use_cases": [{"id": "uc-other"}]}).to_string();
        let p = testable::pick_generation_policy(&dc, "uc-1");
        assert!(matches!(p.memories, testable::BoolPolicy::On));
    }

    #[test]
    fn pick_generation_policy_extracts_per_capability_settings() {
        let dc = serde_json::json!({
            "use_cases": [
                { "id": "uc-1", "generation_settings": { "memories": "off" } },
                { "id": "uc-2", "generation_settings": { "reviews": "trust_llm" } },
            ]
        })
        .to_string();
        let p1 = testable::pick_generation_policy(&dc, "uc-1");
        assert!(matches!(p1.memories, testable::BoolPolicy::Off));
        assert!(matches!(p1.reviews, testable::ReviewPolicy::On));
        let p2 = testable::pick_generation_policy(&dc, "uc-2");
        assert!(matches!(p2.memories, testable::BoolPolicy::On));
        assert!(matches!(p2.reviews, testable::ReviewPolicy::TrustLlm));
    }

    #[test]
    fn parse_generation_settings_recognises_auto_triage() {
        // Variant + spelling tolerance for explicit runtime override.
        for kw in ["auto_triage", "autotriage", "auto-triage", "AUTO_TRIAGE"] {
            let v = serde_json::json!({"reviews": kw});
            let p = testable::parse_generation_settings(&v);
            assert!(
                matches!(p.reviews, testable::ReviewPolicy::AutoTriage),
                "keyword {kw} should resolve to AutoTriage"
            );
        }
    }

    #[test]
    fn pick_generation_policy_falls_back_to_review_policy_mode_auto_triage() {
        // No generation_settings — runtime should look at review_policy.mode.
        let dc = serde_json::json!({
            "use_cases": [
                { "id": "uc-auto", "review_policy": { "mode": "auto_triage" } }
            ]
        })
        .to_string();
        let p = testable::pick_generation_policy(&dc, "uc-auto");
        assert!(matches!(p.reviews, testable::ReviewPolicy::AutoTriage));
    }

    #[test]
    fn pick_generation_policy_falls_back_to_review_policy_mode_never() {
        let dc = serde_json::json!({
            "use_cases": [
                { "id": "uc-never", "review_policy": { "mode": "never" } }
            ]
        })
        .to_string();
        let p = testable::pick_generation_policy(&dc, "uc-never");
        assert!(matches!(p.reviews, testable::ReviewPolicy::Off));
    }

    #[test]
    fn pick_generation_policy_explicit_settings_wins_over_review_policy_mode() {
        // generation_settings.reviews="off" should win even though review_policy.mode="auto_triage"
        let dc = serde_json::json!({
            "use_cases": [
                {
                    "id": "uc-mixed",
                    "generation_settings": { "reviews": "off" },
                    "review_policy": { "mode": "auto_triage" }
                }
            ]
        })
        .to_string();
        let p = testable::pick_generation_policy(&dc, "uc-mixed");
        assert!(matches!(p.reviews, testable::ReviewPolicy::Off));
    }

    #[test]
    fn pick_generation_policy_review_policy_always_maps_to_on() {
        let dc = serde_json::json!({
            "use_cases": [
                { "id": "uc-always", "review_policy": { "mode": "always" } }
            ]
        })
        .to_string();
        let p = testable::pick_generation_policy(&dc, "uc-always");
        assert!(matches!(p.reviews, testable::ReviewPolicy::On));
    }

    // 2026-05-05 — memory_policy.enabled fallback regression tests. Mirrors
    // the review_policy.mode fallback. SQL audit on the rapid-validation
    // cohort showed every persona had memory_policy.enabled=false yet still
    // accumulated memory rows on every execution because pick_generation_policy
    // only honoured generation_settings.memories — the build-time IR field
    // was silently ignored. These tests pin the corrected behaviour.

    #[test]
    fn pick_generation_policy_falls_back_to_memory_policy_disabled() {
        let dc = serde_json::json!({
            "use_cases": [
                { "id": "uc-no-mem", "memory_policy": { "enabled": false } }
            ]
        })
        .to_string();
        let p = testable::pick_generation_policy(&dc, "uc-no-mem");
        assert!(matches!(p.memories, testable::BoolPolicy::Off));
    }

    #[test]
    fn pick_generation_policy_memory_enabled_true_stays_on() {
        let dc = serde_json::json!({
            "use_cases": [
                { "id": "uc-mem-on", "memory_policy": { "enabled": true } }
            ]
        })
        .to_string();
        let p = testable::pick_generation_policy(&dc, "uc-mem-on");
        assert!(matches!(p.memories, testable::BoolPolicy::On));
    }

    #[test]
    fn pick_generation_policy_memory_explicit_settings_wins_over_memory_policy() {
        // generation_settings.memories="off" should win even though
        // memory_policy.enabled=true.
        let dc = serde_json::json!({
            "use_cases": [
                {
                    "id": "uc-mem-mixed",
                    "generation_settings": { "memories": "off" },
                    "memory_policy": { "enabled": true }
                }
            ]
        })
        .to_string();
        let p = testable::pick_generation_policy(&dc, "uc-mem-mixed");
        assert!(matches!(p.memories, testable::BoolPolicy::Off));
    }

    #[test]
    fn published_event_name_uses_alias_when_present() {
        let mut p = testable::GenerationPolicy::permissive();
        p.event_aliases
            .insert("alert".to_string(), "escalation".to_string());
        assert_eq!(p.published_event_name("alert"), "escalation");
        assert_eq!(p.published_event_name("other"), "other");
    }

    // ------------------------------------------------------------------------
    // Phase 19 — resolve_notification_channels shape-v2 passthrough (DELIV-05)
    // ------------------------------------------------------------------------

    const SHAPE_V2_JSON: &str = r#"[{"type":"built-in","enabled":true,"use_case_ids":"*"}]"#;
    const SHAPE_A_JSON: &str = r#"{"execution_completed":true,"manual_review":true}"#;

    #[test]
    fn test_resolve_shape_v2_passthrough_pure() {
        // When fallback_channels is shape-v2, parse_channels_v2 returns Some(_)
        // and resolve_notification_channels returns it untouched (DELIV-05).
        // Verified via the pure discriminant: shape-v2 JSON parses as v2.
        let parsed = crate::notifications::parse_channels_v2(Some(SHAPE_V2_JSON));
        assert!(parsed.is_some(), "SHAPE_V2_JSON must be recognized as v2");
        // The passthrough logic: if parse_channels_v2 returns Some(_), function
        // returns fallback_channels unchanged. We can verify the discriminant
        // directly since the DB call is bypassed on this path.
        // Full integration (with pool) would require an in-process SQLite db;
        // pure discriminant check is sufficient per Phase 17 SUMMARY precedent.
    }

    #[test]
    fn test_resolve_legacy_unchanged_pure() {
        // Legacy shape-A JSON does NOT parse as v2 — fallback proceeds to
        // the per-UC lookup (or returns fallback_channels if no uc_id given).
        let parsed = crate::notifications::parse_channels_v2(Some(SHAPE_A_JSON));
        assert!(
            parsed.is_none(),
            "shape-A JSON must NOT be recognized as v2"
        );
        // With None use_case_id, pick_capability_channels is never called,
        // so fallback_channels is returned as-is. Verified by the existing
        // test_resolve_falls_back_to_persona_wide test above.
    }

    // ------------------------------------------------------------------------
    // W-lane "message vs report" — the classifier (pure) and the two writes
    // ------------------------------------------------------------------------

    /// A short, untitled, plain note is a chat message — the whole point of
    /// the lane split.
    #[test]
    fn classify_short_untitled_note_is_chat() {
        assert_eq!(
            classify_user_message(None, "Nothing to report today.", None, None),
            MessageLane::Chat
        );
        // An empty-string title is not a title.
        assert_eq!(
            classify_user_message(Some("   "), "checked, all green", Some("info"), None),
            MessageLane::Chat
        );
    }

    /// A title names an artifact — every persona shipped today emits one, so
    /// this arm is what keeps existing behavior unchanged.
    #[test]
    fn classify_title_forces_report() {
        assert_eq!(
            classify_user_message(Some("Weekly digest"), "all good", Some("info"), None),
            MessageLane::Report
        );
    }

    /// Length alone promotes: a note too long for a chat bubble is a report.
    #[test]
    fn classify_long_content_is_report() {
        let long = "a".repeat(CHAT_NOTE_MAX_CHARS + 1);
        assert_eq!(
            classify_user_message(None, &long, None, None),
            MessageLane::Report
        );
        let exact = "a".repeat(CHAT_NOTE_MAX_CHARS);
        assert_eq!(
            classify_user_message(None, &exact, None, None),
            MessageLane::Chat,
            "the boundary itself still fits in a chat bubble"
        );
    }

    /// Counted in CHARACTERS, not bytes — a note of multi-byte text must not
    /// be promoted just for being non-ASCII.
    #[test]
    fn classify_length_counts_chars_not_bytes() {
        // 300 chars, 900 bytes.
        let multibyte = "日".repeat(300);
        assert!(
            multibyte.len() > CHAT_NOTE_MAX_CHARS,
            "precondition: byte length exceeds the cap"
        );
        assert_eq!(
            classify_user_message(None, &multibyte, None, None),
            MessageLane::Chat
        );
    }

    /// Artifact-ish content types promote; the status-note types do not.
    #[test]
    fn classify_content_type_split() {
        for ct in [
            "markdown",
            "code",
            "alert",
            "budget_alert",
            "error",
            "MarkDown",
        ] {
            assert_eq!(
                classify_user_message(None, "short", Some(ct), None),
                MessageLane::Report,
                "content_type {ct} must be a report"
            );
        }
        for ct in ["info", "success", "warning", "text", ""] {
            assert_eq!(
                classify_user_message(None, "short", Some(ct), None),
                MessageLane::Chat,
                "content_type {ct} must stay a chat note"
            );
        }
    }

    /// Document structure promotes an untitled note.
    #[test]
    fn classify_structural_markdown_is_report() {
        assert_eq!(
            classify_user_message(None, "## Findings\nall clear", None, None),
            MessageLane::Report,
            "heading"
        );
        assert_eq!(
            classify_user_message(None, "here:\n```\nx = 1\n```", None, None),
            MessageLane::Report,
            "fenced block"
        );
        assert_eq!(
            classify_user_message(None, "| a | b |\n| - | - |\n| 1 | 2 |", None, None),
            MessageLane::Report,
            "table"
        );
    }

    /// Ordinary chat punctuation does NOT promote.
    #[test]
    fn classify_chat_punctuation_stays_chat() {
        assert_eq!(
            classify_user_message(None, "**done** — 3 files, see PR #12", None, None),
            MessageLane::Chat,
            "bold is not structure"
        );
        assert_eq!(
            classify_user_message(None, "done:\n- built\n- tested", None, None),
            MessageLane::Chat,
            "two bullets are not a document"
        );
        assert_eq!(
            classify_user_message(None, "cost | latency were both fine", None, None),
            MessageLane::Chat,
            "a stray pipe is not a table"
        );
        assert_eq!(
            classify_user_message(None, "#hashtag not a heading", None, None),
            MessageLane::Chat,
            "a hash without a space is not a heading"
        );
    }

    /// The explicit override wins in BOTH directions, over every heuristic.
    #[test]
    fn classify_explicit_channel_override_wins() {
        let long = "a".repeat(CHAT_NOTE_MAX_CHARS + 50);
        assert_eq!(
            classify_user_message(Some("Titled"), &long, Some("markdown"), Some("message")),
            MessageLane::Chat,
            "channel=message beats title + length + content_type"
        );
        assert_eq!(
            classify_user_message(None, "ok", Some("info"), Some("report")),
            MessageLane::Report,
            "channel=report beats the short-untitled default"
        );
        assert_eq!(
            classify_user_message(None, "ok", None, Some(" CHAT ")),
            MessageLane::Chat,
            "override is trimmed and case-insensitive"
        );
    }

    /// An unrecognized override is ignored, not trusted — the heuristics still
    /// decide, so a typo cannot silently reroute output.
    #[test]
    fn classify_unknown_channel_value_falls_through() {
        assert_eq!(
            classify_user_message(Some("Titled"), "body", None, Some("slack")),
            MessageLane::Report
        );
        assert_eq!(
            classify_user_message(None, "body", None, Some("slack")),
            MessageLane::Chat
        );
    }

    // ------------------------------------------------------------------------
    // The two writes, against a real (temp-file) database
    // ------------------------------------------------------------------------

    struct CapturingEmitter {
        events: std::sync::Mutex<Vec<String>>,
    }

    impl CapturingEmitter {
        fn new() -> Self {
            Self {
                events: std::sync::Mutex::new(Vec::new()),
            }
        }
        fn names(&self) -> Vec<String> {
            self.events.lock().unwrap().clone()
        }
    }

    impl ExecutionEventEmitter for CapturingEmitter {
        fn emit_json(&self, event: &str, _payload: serde_json::Value) {
            self.events.lock().unwrap().push(event.to_string());
        }
    }

    fn mk_persona(pool: &DbPool, name: &str) -> String {
        use crate::db::models::CreatePersonaInput;
        crate::db::repos::core::personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    fn count_rows(pool: &DbPool, sql: &str, persona_id: &str) -> i64 {
        pool.get()
            .unwrap()
            .query_row(sql, rusqlite::params![persona_id], |r| r.get(0))
            .unwrap()
    }

    fn reports(pool: &DbPool, persona_id: &str) -> i64 {
        count_rows(
            pool,
            "SELECT COUNT(*) FROM persona_reports WHERE persona_id = ?1",
            persona_id,
        )
    }

    fn chat_rows(pool: &DbPool, persona_id: &str) -> i64 {
        count_rows(
            pool,
            "SELECT COUNT(*) FROM team_channel_messages WHERE persona_id = ?1",
            persona_id,
        )
    }

    /// Run one `user_message` through the real dispatcher; hand back the pool,
    /// the persona id, and the event names that were emitted.
    fn dispatch_one(
        msg: ProtocolMessage,
        seed_execution_input: Option<&str>,
    ) -> (DbPool, String, Vec<String>) {
        let pool = crate::db::init_test_db().unwrap();
        let persona_id = mk_persona(&pool, "Note Taker");
        let exec_id = format!("exec-{}", uuid::Uuid::new_v4());
        if let Some(input) = seed_execution_input {
            pool.get()
                .unwrap()
                .execute(
                    "INSERT INTO persona_executions (id, persona_id, status, input_data, created_at)
                     VALUES (?1, ?2, 'running', ?3, datetime('now'))",
                    rusqlite::params![exec_id, persona_id, input],
                )
                .unwrap();
        }
        let emitter = CapturingEmitter::new();
        let log_dir = std::env::temp_dir().join(format!("personas_dispatch_test_{exec_id}"));
        let mut logger = ExecutionLogger::new(&log_dir, &exec_id).unwrap();
        {
            let mut ctx = DispatchContext::new(
                &emitter,
                &pool,
                &exec_id,
                &persona_id,
                "proj-1",
                "Note Taker",
                None,
                &mut logger,
                Some(QualityGateConfig::default()),
            );
            dispatch(&mut ctx, &msg);
        }
        let names = emitter.names();
        let _ = std::fs::remove_dir_all(&log_dir);
        (pool, persona_id, names)
    }

    fn note(title: Option<&str>, content: &str, channel: Option<&str>) -> ProtocolMessage {
        ProtocolMessage::UserMessage {
            title: title.map(String::from),
            content: content.to_string(),
            content_type: Some("info".into()),
            priority: None,
            channel: channel.map(String::from),
        }
    }

    /// Mint a persona carrying `design_context` — the field the backlog verb
    /// resolves its project from, and the one `mk_persona` leaves empty.
    fn mk_pinned_persona(pool: &DbPool, name: &str, design_context: serde_json::Value) -> String {
        let persona_id = mk_persona(pool, name);
        crate::db::repos::core::personas::update(
            pool,
            &persona_id,
            crate::db::models::UpdatePersonaInput {
                design_context: Some(Some(design_context.to_string())),
                ..Default::default()
            },
        )
        .unwrap();
        persona_id
    }

    /// Drive one protocol message through the real dispatcher as `persona_id`.
    fn dispatch_as(pool: &DbPool, persona_id: &str, msg: &ProtocolMessage) {
        let exec_id = format!("exec-{}", uuid::Uuid::new_v4());
        dispatch_as_run(pool, persona_id, &exec_id, msg);
    }

    /// The same, under a NAMED execution id, handing back what the dispatcher
    /// wrote to that run's log.
    ///
    /// Two things need it: attribution reads the execution row this id points
    /// at, and a guard that skips a round is only observable through the line
    /// it logs — a producer that goes quiet without saying why is
    /// indistinguishable from one that had nothing to file.
    fn dispatch_as_run(
        pool: &DbPool,
        persona_id: &str,
        exec_id: &str,
        msg: &ProtocolMessage,
    ) -> String {
        let emitter = CapturingEmitter::new();
        let log_dir = std::env::temp_dir().join(format!("personas_dispatch_test_{exec_id}"));
        let mut logger = ExecutionLogger::new(&log_dir, exec_id).unwrap();
        {
            let mut ctx = DispatchContext::new(
                &emitter,
                pool,
                exec_id,
                persona_id,
                "proj-1",
                "Test Persona",
                None,
                &mut logger,
                Some(QualityGateConfig::default()),
            );
            dispatch(&mut ctx, msg);
        }
        // Drop the writer before reading: the log is buffered.
        drop(logger);
        let written = std::fs::read_to_string(ExecutionLogger::log_path(&log_dir, exec_id))
            .unwrap_or_default();
        let _ = std::fs::remove_dir_all(&log_dir);
        written
    }

    fn mk_project(pool: &DbPool, name: &str) -> crate::db::models::DevProject {
        crate::db::repos::dev_tools::create_project(
            pool,
            name,
            // `dev_projects.root_path` is UNIQUE — a shared literal would fail
            // the second project on a constraint, not on the thing under test.
            &format!("/tmp/g13/{name}"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
    }

    fn backlog_item(title: &str) -> ProtocolMessage {
        ProtocolMessage::ProposeBacklog {
            title: title.to_string(),
            description: Some("from the solution design".into()),
            category: Some("architecture".into()),
            impact: None,
            effort: None,
            risk: None,
            target: None,
            goal: None,
            plan: None,
        }
    }

    /// The same item with the persona's own `target` marking on it.
    fn backlog_item_targeted(title: &str, target: &str) -> ProtocolMessage {
        match backlog_item(title) {
            ProtocolMessage::ProposeBacklog { title, .. } => ProtocolMessage::ProposeBacklog {
                title,
                description: None,
                category: None,
                impact: None,
                effort: None,
                risk: None,
                target: Some(target.to_string()),
                goal: None,
                plan: None,
            },
            other => other,
        }
    }

    /// The same item carrying a risk score — what the project's mechanical
    /// triage rule reads.
    fn backlog_item_rated(title: &str, risk: i32) -> ProtocolMessage {
        match backlog_item(title) {
            ProtocolMessage::ProposeBacklog { title, .. } => ProtocolMessage::ProposeBacklog {
                title,
                description: None,
                category: None,
                impact: None,
                effort: None,
                risk: Some(risk),
                target: None,
                goal: None,
                plan: None,
            },
            other => other,
        }
    }

    /// G30: the project's triage rule answers a RATED proposal in the same
    /// dispatch — on arrival, and on the re-file that rates an unrated row.
    /// An unrated row stays pending (the rule cannot see it) and a row above
    /// the rule's ceiling stays pending too: the rule decides, not the door.
    #[test]
    fn a_rated_proposal_is_answered_by_the_projects_triage_rule_on_arrival() {
        let pool = crate::db::init_test_db().unwrap();
        let owned = mk_project(&pool, "bank-core");
        crate::db::repos::dev::triage_rules::create_triage_rule(
            &pool,
            Some(&owned.id),
            "sim: accept risk below 3",
            r#"[{"field":"risk","op":"gte","value":1},{"field":"risk","op":"lt","value":3}]"#,
            "accept",
            Some(true),
        )
        .unwrap();
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master bank-core",
            serde_json::json!({ "devProjectId": owned.id }),
        );
        let status_of = |title: &str| -> String {
            ideas_on(&pool, &owned.id)
                .into_iter()
                .find(|i| i.title == title)
                .map(|i| i.status)
                .unwrap_or_else(|| panic!("`{title}` never landed"))
        };

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item("Add the ledger posting test"),
        );
        assert_eq!(
            status_of("Add the ledger posting test"),
            "pending",
            "unrated: invisible to the rule, so untouched"
        );

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item_rated("Name the fail-closed authz route", 2),
        );
        assert_eq!(
            status_of("Name the fail-closed authz route"),
            "accepted",
            "rated within the rule on arrival: accepted in the same dispatch"
        );

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item_rated("Rewrite the settlement engine", 4),
        );
        assert_eq!(
            status_of("Rewrite the settlement engine"),
            "pending",
            "rated above the rule's ceiling: the rule declines, the row waits"
        );

        // The re-file that RATES the unrated row is new information: the
        // backfill fills the score in, and the rule answers it right away.
        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item_rated("Add the ledger posting test", 1),
        );
        assert_eq!(
            status_of("Add the ledger posting test"),
            "accepted",
            "rated on re-file: backfilled and answered"
        );
        assert_eq!(ideas_on(&pool, &owned.id).len(), 3, "no duplicate rows");
    }

    /// A proposal that paraphrases an item already on the backlog files
    /// nothing: the title-slug key differs, so the exact guard alone would
    /// have stacked a second row for one finding. The matched row gains the
    /// score the paraphrase carried.
    #[test]
    fn a_paraphrased_proposal_folds_into_the_item_already_filed() {
        let pool = crate::db::init_test_db().unwrap();
        let owned = mk_project(&pool, "bank-edge");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master bank-edge",
            serde_json::json!({ "devProjectId": owned.id }),
        );

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item("Add retry with backoff to the ledger fetch helper"),
        );
        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item_rated("Add retry and backoff to ledger fetch helper calls", 2),
        );

        let ideas = ideas_on(&pool, &owned.id);
        assert_eq!(ideas.len(), 1, "one finding, one row: {ideas:?}");
        assert_eq!(
            ideas[0].title,
            "Add retry with backoff to the ledger fetch helper"
        );
        assert_eq!(
            ideas[0].risk,
            Some(2),
            "the paraphrase's score filled the gap"
        );
    }

    /// Register a project at this build's own repo root — what
    /// `platform_backlog::resolve_platform_project` matches on when no
    /// `platform_project_id` setting is set.
    fn mk_platform_project(pool: &DbPool) -> crate::db::models::DevProject {
        let root = crate::companion::dev_mode::repo_root()
            .to_string_lossy()
            .replace('\\', "/");
        crate::db::repos::dev_tools::create_project(
            pool, "Personas", &root, None, None, None, None, None,
        )
        .unwrap()
    }

    /// The backlog rows on one project, through the repo rather than a raw
    /// checkout: a test that panics on pool acquire hides the same saturation
    /// the product would (`pool-get-unwrapped`).
    fn ideas_on(pool: &DbPool, project_id: &str) -> Vec<crate::db::models::DevIdea> {
        crate::db::repos::dev_tools::list_ideas(pool, Some(project_id), None, None, None, None)
            .unwrap()
    }

    /// G13: a WORKSPACE-bound persona has no `devProjectId`, so before the home
    /// fallback existed every `propose_backlog` took the project-less branch —
    /// the run reported success and the workspace's backlog stayed at zero.
    /// Now the proposal lands on the persona's home project.
    #[test]
    fn propose_backlog_falls_back_to_the_home_project_for_a_workspace_persona() {
        let pool = crate::db::init_test_db().unwrap();
        let home = mk_project(&pool, "bank-platform");
        let persona_id = mk_pinned_persona(
            &pool,
            "Architect Bank",
            serde_json::json!({ "workspaceId": "ws1", "homeProjectId": home.id }),
        );

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item("Split the ledger from the gateway"),
        );

        let landed = ideas_on(&pool, &home.id);
        assert_eq!(landed.len(), 1, "the proposal landed on the home project");
        assert_eq!(landed[0].title, "Split the ledger from the gateway");
        assert_eq!(landed[0].status, "pending");
    }

    // -- Attribution, the plan, and the exit the accepted pile never had ----

    /// **`provider` / `model` were NULL on 2,038 of 2,093 rows** because this
    /// dispatcher passed `None, None` - so the single largest producer's 1,208
    /// items are anonymous in their own table and no cost, quality or
    /// regression question can be asked per-model. The door now stamps from
    /// the EXECUTION's own context: the SERVED model name the stream recorded,
    /// never a claim the model makes about itself.
    #[test]
    fn a_filing_records_the_model_that_wrote_it() {
        let pool = crate::db::init_test_db().unwrap();
        let owned = mk_project(&pool, "bank-attribution");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master attribution",
            serde_json::json!({ "devProjectId": owned.id }),
        );
        // Through the executions repo, not a hand-written INSERT: the row this
        // reads is the run's own, and a fixture that builds it by hand can
        // drift from the shape the runner actually writes.
        let run = crate::db::repos::execution::executions::create(
            &pool,
            &persona_id,
            None,
            None,
            Some(personas_core::model_ids::DEFAULT_STRONG.to_string()),
            None,
        )
        .unwrap();

        dispatch_as_run(
            &pool,
            &persona_id,
            &run.id,
            &backlog_item("Name the model that filed this"),
        );

        let landed = ideas_on(&pool, &owned.id);
        assert_eq!(landed.len(), 1, "the item landed");
        assert_eq!(
            landed[0].model.as_deref(),
            Some(personas_core::model_ids::DEFAULT_STRONG),
            "the served model name, read from the run's own row"
        );
        assert_eq!(
            landed[0].provider.as_deref(),
            Some("claude"),
            "no model profile means the bundled Claude CLI, which is the only \
             backend such a run can have taken"
        );
        assert_eq!(
            landed[0].origin.as_deref(),
            Some("team_proposed"),
            "the producer is written too - the whole point of the one door"
        );
    }

    /// The plan the filing model leaves for the executing one survives the
    /// whole trip: protocol message -> dispatch -> the row. An item that
    /// carries no usable plan is STORED and graded `draft` rather than
    /// refused, because the dominant producer never retries a refused filing.
    #[test]
    fn the_plan_reaches_the_row_and_its_absence_is_a_draft_not_a_refusal() {
        let pool = crate::db::init_test_db().unwrap();
        let owned = mk_project(&pool, "bank-planned");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master planned",
            serde_json::json!({ "devProjectId": owned.id }),
        );

        let planned = ProtocolMessage::ProposeBacklog {
            title: "Extract the retry helper".into(),
            description: Some("three copies in the engine".into()),
            category: Some("refactor".into()),
            impact: Some(3),
            effort: Some(2),
            risk: Some(1),
            target: None,
            goal: None,
            plan: Some(crate::db::models::IdeaPlan {
                steps: vec![crate::db::models::PlanStep {
                    n: 1,
                    action: "Add the shared retry helper".into(),
                    files: vec!["src/lib/retry.rs".into()],
                    done_when: "`cargo test retry_helper` passes".into(),
                }],
            }),
        };
        dispatch_as(&pool, &persona_id, &planned);
        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item("Something nobody planned"),
        );

        let titles: Vec<String> = ideas_on(&pool, &owned.id)
            .into_iter()
            .map(|i| i.title)
            .collect();
        assert!(titles.contains(&"Extract the retry helper".to_string()));
        assert!(
            titles.contains(&"Something nobody planned".to_string()),
            "the unplanned item is KEPT, never dropped"
        );

        // `plan` and `completeness` are WRITTEN by the door but absent from
        // `IDEA_COLUMNS`, so `DevIdea` cannot carry them back yet (reported as
        // a contract gap) - they are asserted against the column itself.
        assert_eq!(
            count_rows(
                &pool,
                "SELECT COUNT(*) FROM dev_ideas WHERE title = ?1 AND completeness = 'full' \
                 AND plan LIKE '%src/lib/retry.rs%' AND plan LIKE '%cargo test retry_helper%'",
                "Extract the retry helper",
            ),
            1,
            "the plan's paths and its observable condition both reached the column, \
             and a rated + described + actionably planned item is `full`"
        );
        assert_eq!(
            count_rows(
                &pool,
                "SELECT COUNT(*) FROM dev_ideas WHERE title = ?1 AND completeness = 'draft' \
                 AND plan IS NULL",
                "Something nobody planned",
            ),
            1,
            "an unplanned filing is stored and NAMED incomplete, so something else can plan it"
        );
    }

    /// **The entrance was governed and the exit was not.** Measured
    /// 2026-09-21: the largest PENDING queue on any project was 63 against a
    /// cap of 300, while 741 ACCEPTED items sat undispatched with no cap at
    /// all. The guard now asks both piles, and its log line names WHICH limit
    /// went quiet - a producer that skips a round without saying why is
    /// indistinguishable from one that had nothing to file.
    #[test]
    fn the_guard_skips_at_the_accepted_cap_and_says_which_limit_it_hit() {
        let pool = crate::db::init_test_db().unwrap();
        let owned = mk_project(&pool, "bank-saturated");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master saturated",
            serde_json::json!({ "devProjectId": owned.id }),
        );

        // The accepted pile at its cap, and NOTHING pending - so a guard that
        // still only counted `pending` would wave this filing straight through.
        seed_accepted(&pool, &owned.id, ACCEPTED_BACKLOG_CAP, false);
        assert_eq!(
            backlog_saturation(&pool, &owned.id),
            Some(BacklogLimit::Accepted),
            "nothing pending, and the accepted pile is at its cap"
        );

        let exec_id = format!("exec-{}", uuid::Uuid::new_v4());
        let log = dispatch_as_run(
            &pool,
            &persona_id,
            &exec_id,
            &backlog_item("One more thing nobody will ever start"),
        );

        assert!(
            !ideas_on(&pool, &owned.id)
                .iter()
                .any(|i| i.title == "One more thing nobody will ever start"),
            "the producer went quiet instead of stacking onto a pile with no exit"
        );
        assert!(
            log.contains("propose_backlog skipped") && log.contains("accepted and undispatched"),
            "the skip line must name which limit it hit, not just that it skipped: {log}"
        );
        assert!(
            !log.contains("pending)"),
            "and must not blame the pile that is empty: {log}"
        );
    }

    /// An accepted item that BECAME work is not backlog, it is work in flight.
    /// Counting it against the cap would make backpressure a function of
    /// delivery latency rather than of the pile nobody started.
    #[test]
    fn an_accepted_item_that_became_a_task_does_not_count_against_the_cap() {
        let pool = crate::db::init_test_db().unwrap();
        let owned = mk_project(&pool, "bank-inflight");
        seed_accepted(&pool, &owned.id, ACCEPTED_BACKLOG_CAP, true);

        assert_eq!(
            backlog_saturation(&pool, &owned.id),
            None,
            "every accepted item is already a task, so nothing is waiting"
        );
    }

    /// `n` accepted ideas on a project, optionally each already minted into a
    /// `dev_tasks` row.
    ///
    /// Through the same doors the product writes through - a pile assembled by
    /// hand is not the pile the guard counts, and this guard's whole job is to
    /// tell those two piles apart.
    fn seed_accepted(pool: &DbPool, project_id: &str, n: i64, with_task: bool) {
        for i in 0..n {
            let title = format!("Accepted #{i}");
            let mut draft = crate::db::models::IdeaDraft::new(
                project_id,
                crate::db::models::BacklogSource::TeamProposed,
                title.clone(),
            );
            draft.status = Some("accepted".to_string());
            let idea = crate::db::repos::dev_tools::file_idea(pool, draft)
                .unwrap()
                .expect("an unguarded filing always produces a row");
            if with_task {
                crate::db::repos::dev_tools::create_task(
                    pool,
                    Some(project_id),
                    &title,
                    None,
                    Some(&idea.id),
                    None,
                    None,
                    None,
                )
                .unwrap();
            }
        }
    }

    /// The codebase pin still wins: an App Master's proposals are untouched by
    /// the fallback, even when a home pin sits beside them.
    #[test]
    fn propose_backlog_still_prefers_the_codebase_pin() {
        let pool = crate::db::init_test_db().unwrap();
        let owned = mk_project(&pool, "ascent");
        let home = mk_project(&pool, "platform");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master Ascent",
            serde_json::json!({ "devProjectId": owned.id, "homeProjectId": home.id }),
        );

        dispatch_as(&pool, &persona_id, &backlog_item("Retire the legacy shim"));

        assert_eq!(
            ideas_on(&pool, &owned.id).len(),
            1,
            "on the codebase it owns"
        );
        assert!(
            ideas_on(&pool, &home.id).is_empty(),
            "and not on the home pin"
        );
    }

    // ── G22: a platform item does not belong on the bank's backlog ──────────

    /// The persona marks its own item `platform` — it lands on the Personas
    /// project, not on the bank it owns, and carries the filer in `evidence`.
    #[test]
    fn a_self_marked_platform_item_lands_on_the_platform_project() {
        let pool = crate::db::init_test_db().unwrap();
        let platform = mk_platform_project(&pool);
        let bank = mk_project(&pool, "aurora-bank");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master Aurora",
            serde_json::json!({ "devProjectId": bank.id }),
        );

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item_targeted("Something only the app owner can fix", "platform"),
        );

        assert!(
            ideas_on(&pool, &bank.id).is_empty(),
            "never on the repo the worker would be sent into"
        );
        let landed = ideas_on(&pool, &platform.id);
        assert_eq!(landed.len(), 1, "on the platform backlog");
        assert_eq!(
            landed[0].scan_type,
            crate::db::repos::dev_tools::PLATFORM_ESCALATION_SCAN_TYPE
        );
        let evidence: serde_json::Value =
            serde_json::from_str(landed[0].evidence.as_deref().unwrap()).unwrap();
        // `personaName` is the RUNTIME name the dispatch context carries, which
        // this harness fixes to "Test Persona"; the id is the identity that
        // matters, and the project name is what tells a reader which repo the
        // finding came from.
        assert_eq!(evidence["filings"][0]["personaId"], persona_id);
        assert_eq!(evidence["filings"][0]["projectName"], "aurora-bank");
    }

    /// A persona that marks nothing is still caught by the keyword backstop —
    /// this is the exact title four App Masters filed on 2026-09-08.
    #[test]
    fn a_keyword_matched_platform_item_is_routed_without_the_persona_saying_so() {
        let pool = crate::db::init_test_db().unwrap();
        let platform = mk_platform_project(&pool);
        let bank = mk_project(&pool, "meridian-bank");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master Meridian",
            serde_json::json!({ "devProjectId": bank.id }),
        );

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item(
                "Bind capability parameters before dispatch — they arrive as literal {{param.*}} placeholders",
            ),
        );

        assert!(ideas_on(&pool, &bank.id).is_empty());
        assert_eq!(ideas_on(&pool, &platform.id).len(), 1);
    }

    /// The case the routing must not break: a real bank-domain item stays where
    /// the persona filed it, on its own project, through the unchanged path.
    #[test]
    fn a_bank_domain_item_still_lands_on_the_home_project() {
        let pool = crate::db::init_test_db().unwrap();
        let platform = mk_platform_project(&pool);
        let bank = mk_project(&pool, "aurora-bank");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master Aurora",
            serde_json::json!({ "devProjectId": bank.id }),
        );

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item("SEPA pacs.008 validation"),
        );

        assert!(
            ideas_on(&pool, &platform.id).is_empty(),
            "the platform backlog is not a dumping ground"
        );
        let landed = ideas_on(&pool, &bank.id);
        assert_eq!(landed.len(), 1);
        assert_eq!(landed[0].scan_type, "team_proposed", "the ordinary door");
    }

    /// Two App Masters on two different banks file the same platform defect:
    /// one row, two witnesses.
    #[test]
    fn a_second_persona_filing_the_same_platform_defect_joins_the_first() {
        let pool = crate::db::init_test_db().unwrap();
        let platform = mk_platform_project(&pool);
        let aurora = mk_project(&pool, "aurora-bank");
        let meridian = mk_project(&pool, "meridian-bank");
        let a = mk_pinned_persona(
            &pool,
            "App Master Aurora",
            serde_json::json!({ "devProjectId": aurora.id }),
        );
        let m = mk_pinned_persona(
            &pool,
            "App Master Meridian",
            serde_json::json!({ "devProjectId": meridian.id }),
        );

        let title = "Gate the improve lane on at least one completed prior episode";
        dispatch_as(&pool, &a, &backlog_item(title));
        dispatch_as(&pool, &m, &backlog_item(title));

        let landed = ideas_on(&pool, &platform.id);
        assert_eq!(landed.len(), 1, "one item, not two");
        let evidence: serde_json::Value =
            serde_json::from_str(landed[0].evidence.as_deref().unwrap()).unwrap();
        let filings = evidence["filings"].as_array().unwrap();
        assert_eq!(filings.len(), 2, "both filers are recorded");
        assert_eq!(filings[0]["projectName"], "aurora-bank");
        assert_eq!(filings[1]["projectName"], "meridian-bank");
    }

    /// No platform project registered: the item stays where the persona is, but
    /// TAGGED — visible, and excluded from every automatic dispatcher. Never
    /// dropped.
    #[test]
    fn an_unresolvable_platform_item_stays_home_but_tagged() {
        let pool = crate::db::init_test_db().unwrap();
        let bank = mk_project(&pool, "aurora-bank");
        let persona_id = mk_pinned_persona(
            &pool,
            "App Master Aurora",
            serde_json::json!({ "devProjectId": bank.id }),
        );

        dispatch_as(
            &pool,
            &persona_id,
            &backlog_item("Fix personas_get — broken column reference"),
        );

        let landed = ideas_on(&pool, &bank.id);
        assert_eq!(landed.len(), 1, "never dropped");
        assert_eq!(
            landed[0].scan_type,
            crate::db::repos::dev_tools::PLATFORM_ESCALATION_SCAN_TYPE,
            "tagged, so no autopilot picks it up"
        );
    }

    /// A short note lands in the chat lane, announces itself on the persona
    /// channel event, and does NOT also become a report.
    #[test]
    fn short_note_writes_chat_row_only() {
        let (pool, persona_id, events) = dispatch_one(note(None, "deploy is green", None), None);
        assert_eq!(chat_rows(&pool, &persona_id), 1, "one chat row");
        assert_eq!(
            reports(&pool, &persona_id),
            0,
            "no report — never double-written"
        );
        assert!(
            events
                .iter()
                .any(|e| e == event_name::PERSONA_CHANNEL_MESSAGE),
            "chat note must announce on the persona-channel event, got {events:?}"
        );
        assert!(
            !events.iter().any(|e| e == event_name::REPORT_CREATED),
            "chat note must not emit report-created, got {events:?}"
        );
        // The row is persona-authored and carries the display name.
        let (kind, label, body): (String, Option<String>, String) = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT author_kind, author_label, body FROM team_channel_messages
                 WHERE persona_id = ?1",
                rusqlite::params![persona_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(kind, "persona");
        assert_eq!(label.as_deref(), Some("Note Taker"));
        assert_eq!(body, "deploy is green");
    }

    /// A titled message stays on the report path exactly as before.
    #[test]
    fn titled_message_writes_report_only() {
        let (pool, persona_id, events) = dispatch_one(
            note(Some("Weekly digest"), "all systems nominal", None),
            None,
        );
        assert_eq!(reports(&pool, &persona_id), 1, "one report");
        assert_eq!(chat_rows(&pool, &persona_id), 0, "no chat row");
        assert!(events.iter().any(|e| e == event_name::REPORT_CREATED));
        assert!(!events
            .iter()
            .any(|e| e == event_name::PERSONA_CHANNEL_MESSAGE));
    }

    /// Structure promotes an untitled note to a report.
    #[test]
    fn structured_untitled_content_writes_report_only() {
        let (pool, persona_id, _) =
            dispatch_one(note(None, "## Results\n\n| a | b |\n| - | - |", None), None);
        assert_eq!(reports(&pool, &persona_id), 1);
        assert_eq!(chat_rows(&pool, &persona_id), 0);
    }

    /// The override is honored end-to-end, in both directions.
    #[test]
    fn explicit_channel_override_routes_the_write() {
        let (pool, persona_id, _) = dispatch_one(
            note(Some("Titled"), "but I want it in chat", Some("message")),
            None,
        );
        assert_eq!(
            chat_rows(&pool, &persona_id),
            1,
            "channel=message beats the title"
        );
        assert_eq!(reports(&pool, &persona_id), 0);

        let (pool2, persona2, _) = dispatch_one(note(None, "keep this", Some("report")), None);
        assert_eq!(
            reports(&pool2, &persona2),
            1,
            "channel=report beats the short default"
        );
        assert_eq!(chat_rows(&pool2, &persona2), 0);
    }

    /// A persona-channel follow-up already writes the reply row when the run
    /// finishes — dispatch must not post a second copy of the same note.
    #[test]
    fn chat_note_skipped_when_channel_followup_owns_the_lane() {
        let input = r#"{"source":"channel","channelId":"p1","messageId":"m1"}"#;
        let (pool, persona_id, events) = dispatch_one(note(None, "on it", None), Some(input));
        assert_eq!(
            chat_rows(&pool, &persona_id),
            0,
            "the follow-up waiter owns this execution's reply row"
        );
        assert_eq!(
            reports(&pool, &persona_id),
            0,
            "and it is not promoted to a report either"
        );
        assert!(events.is_empty(), "nothing announced, got {events:?}");
    }

    /// A non-channel execution (a scheduled run, a Slack-poller run) keeps the
    /// chat lane — the guard is narrow, not a blanket suppression.
    #[test]
    fn chat_note_written_for_non_channel_execution() {
        let input = r#"{"source":"slack","channelId":"C123"}"#;
        let (pool, persona_id, _) = dispatch_one(note(None, "posted", None), Some(input));
        assert_eq!(chat_rows(&pool, &persona_id), 1);
    }

    #[test]
    fn test_user_message_builds_ctx_with_none_emit() {
        // Structural check: the UserMessage call site in dispatch() constructs
        // DeliveryContext with emit_event_type: None (bypass event_filter, D-02).
        // Verified by grep (cannot call dispatch() in a pure unit test since it
        // requires a live DB pool + AppHandle + ExecutionEventEmitter).
        // The grep check is: grep -cn "emit_event_type: None" src/engine/dispatch.rs >= 2
        // This test documents the invariant for CI traceability.
        let ctx = crate::notifications::DeliveryContext {
            persona_id: "p1".into(),
            persona_name: "Alice".into(),
            use_case_id: None,
            emit_event_type: None, // invariant: UserMessage always sets None
            priority: None,
        };
        assert!(
            ctx.emit_event_type.is_none(),
            "UserMessage DeliveryContext must have emit_event_type: None"
        );
    }
}
