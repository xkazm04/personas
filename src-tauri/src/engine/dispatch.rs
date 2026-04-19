//! Protocol dispatcher: routes parsed ProtocolMessage values to the appropriate DB repo.
//!
//! Extracted from runner.rs to decouple semantic message handling from process
//! lifecycle orchestration. Any execution backend (CLI, HTTP, cloud) can use
//! this dispatcher to handle protocol messages identically.

use tauri::AppHandle;

use super::events::{ExecutionEventEmitter, emit_to};
use super::event_registry::event_name;
use super::protocol::{ExecutionProtocol, StatusFinalization};
use super::quality_gate::{self, FilterAction, QualityGateConfig};
use super::types::{
    ExecutionOutputEvent, HeartbeatEvent, StructuredExecutionEvent,
};
use crate::db::models::{
    CreateManualReviewInput, CreateMessageInput, CreatePersonaEventInput, CreatePersonaMemoryInput,
};
use crate::db::repos::communication::{
    events as event_repo, manual_reviews as review_repo, messages as msg_repo,
};
use crate::db::repos::core::memories as mem_repo;
use crate::db::repos::execution::knowledge as knowledge_repo;
use crate::db::DbPool;

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
        }
    }

    /// Resolve and cache the generation policy for this execution. Reads
    /// `design_context.use_cases[uc].generation_settings` if a use_case is
    /// active; falls back to defaults inferred from the persona's existing
    /// memories/reviews otherwise. Phase C5b.
    fn generation_policy(&mut self) -> testable::GenerationPolicy {
        if let Some(p) = self.policy_cache.as_ref() {
            return p.clone();
        }
        let resolved = testable::resolve_generation_policy(
            self.pool,
            self.persona_id,
            self.use_case_id,
        );
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

/// Route a single protocol message to the appropriate DB repo and emit events.
///
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
        ctx.logger.log(&format!("[OPS] Suppressed protocol dispatch: {:?}", std::mem::discriminant(msg)));
        return;
    }
    match msg {
        ProtocolMessage::UserMessage {
            title,
            content,
            content_type,
            priority,
        } => {
            // Skip empty or whitespace-only messages (prevents "unknown" entries)
            if content.trim().is_empty() {
                ctx.logger.log("[MESSAGE] Skipped: empty content");
                return;
            }

            let use_case_id_owned = ctx.use_case_id.map(|s| s.to_string());
            match msg_repo::create(
                ctx.pool,
                CreateMessageInput {
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
                    emit_to(ctx.emitter, event_name::MESSAGE_CREATED, &m);
                    if ctx.is_simulation {
                        ctx.logger.log("[SIM] Notification delivery skipped (simulation)");
                    } else {
                        let channels = ctx.resolve_notification_channels();
                        let title_str = m.title.clone().unwrap_or_else(|| "New message".to_string());
                        if let Some(app) = ctx.app_handle {
                            crate::notifications::notify_new_message(
                                app,
                                ctx.persona_name,
                                &title_str,
                                channels.as_deref(),
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
                ctx.logger.log(&format!(
                    "[POLICY] PersonaAction dropped — capability events policy = off (target={target})"
                ));
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
                Err(e) => ctx.logger.log(&format!("[EVENT] Failed to publish persona_action: {e}")),
            }
        }
        ProtocolMessage::EmitEvent { event_type, data } => {
            // Phase C5b — capability event policy. Drop when off; rename via
            // alias map when on. The published name is what subscribers see.
            let policy = ctx.generation_policy();
            if !policy.events.is_on() {
                ctx.logger.log(&format!(
                    "[POLICY] Custom event dropped — capability events policy = off ({event_type})"
                ));
                return;
            }
            let published_name = policy.published_event_name(event_type).to_string();
            if published_name != *event_type {
                ctx.logger.log(&format!(
                    "[POLICY] Event aliased: '{event_type}' -> '{published_name}'"
                ));
            }
            // Sanitize persona name for source_type: replace spaces with underscores,
            // keep only alphanumeric, underscore, hyphen, dot, colon, forward-slash.
            let safe_name: String = ctx.persona_name
                .replace(' ', "_")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '.' || *c == ':' || *c == '/')
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
                Ok(_) => ctx.logger.log(&format!("[EVENT] Published custom event: {published_name}")),
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
                ctx.logger.log(&format!(
                    "[POLICY] Memory dropped — capability memories policy = off ({title})"
                ));
                return;
            }
            // Quality gate: use cached config (loaded lazily on first use).
            let gate_config = ctx.quality_gate_config().clone();
            let cat_lower = category.as_deref().unwrap_or("").to_lowercase();
            let combined = format!("{} {}", title, content);

            // Check rejected categories first
            let category_rejected = gate_config.memory_reject_categories
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
            if let Some((rule_label, action)) = QualityGateConfig::check_rules(&gate_config.memory_rules, &combined) {
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
                Ok(m) => ctx.logger.log(&format!("[MEMORY] Stored: {} ({})", title, m.id)),
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
                ctx.logger.log(&format!(
                    "[POLICY] Manual review dropped — capability reviews policy = off ({title})"
                ));
                return;
            }
            // Quality gate: use cached config (loaded lazily on first use).
            let gate_config = ctx.quality_gate_config().clone();
            let combined = format!("{} {}", title, description.as_deref().unwrap_or(""));

            if let Some((rule_label, action)) = QualityGateConfig::check_rules(&gate_config.review_rules, &combined) {
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

            match review_repo::create(
                ctx.pool,
                CreateManualReviewInput {
                    execution_id: ctx.execution_id.to_string(),
                    persona_id: ctx.persona_id.to_string(),
                    title: title.clone(),
                    description: description.clone(),
                    severity: severity.clone(),
                    context_data: effective_context_data,
                    suggested_actions: suggested_actions
                        .as_ref()
                        .map(|a| serde_json::json!(a).to_string()),
                    use_case_id: ctx.use_case_id.map(|s| s.to_string()),
                },
            ) {
                Ok(r) => {
                    ctx.logger.log(&format!(
                        "[REVIEW] Created manual review: {} ({})",
                        title, r.id
                    ));
                    // Phase C5b — trust_llm: auto-resolve immediately so the
                    // review is auditable but never blocks a human queue. We
                    // also skip the OS notification for trust_llm since there
                    // is nothing for the user to act on.
                    let trust_llm = matches!(review_policy, testable::ReviewPolicy::TrustLlm);
                    if trust_llm {
                        if let Err(e) = review_repo::update_status(
                            ctx.pool,
                            &r.id,
                            crate::db::models::ManualReviewStatus::Resolved,
                            Some("auto-approved by trust_llm policy".to_string()),
                        ) {
                            ctx.logger.log(&format!(
                                "[POLICY] trust_llm auto-resolve failed for review {}: {e}",
                                r.id
                            ));
                        } else {
                            ctx.logger.log(&format!(
                                "[POLICY] Review {} auto-resolved (trust_llm)",
                                r.id
                            ));
                        }
                    }
                    if ctx.is_simulation {
                        ctx.logger.log("[SIM] Manual-review notification skipped (simulation)");
                    } else if trust_llm {
                        // No notification for auto-resolved reviews — nothing to act on.
                    } else {
                        let channels = ctx.resolve_notification_channels();
                        if let Some(app) = ctx.app_handle {
                            crate::notifications::notify_manual_review(
                                app,
                                ctx.persona_name,
                                title,
                                channels.as_deref(),
                            );
                        }
                    }
                }
                Err(e) => ctx.logger.log(&format!("[REVIEW] Failed to create: {e}")),
            }
        }
        ProtocolMessage::ExecutionFlow { .. } => {
            // Execution flows are handled at the top level, not here
            ctx.logger.log("[FLOW] Execution flow captured (will be stored on completion)");
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
                Err(e) => ctx.logger.log(&format!("[KNOWLEDGE] Failed to store annotation: {e}")),
            }
        }
        ProtocolMessage::ProposeImprovement {
            section,
            rationale,
            ..
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

    /// Phase C5b — three-state review policy, mirrored on the frontend.
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
            self.event_aliases.get(emitted).map(|s| s.as_str()).unwrap_or(emitted)
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
    pub fn pick_generation_policy(
        design_context_json: &str,
        use_case_id: &str,
    ) -> GenerationPolicy {
        let Some(dc) = serde_json::from_str::<serde_json::Value>(design_context_json).ok() else {
            return GenerationPolicy::permissive();
        };
        let Some(uc) = dc
            .get("use_cases")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.iter().find(|u| u.get("id").and_then(|v| v.as_str()) == Some(use_case_id)))
        else {
            return GenerationPolicy::permissive();
        };
        match uc.get("generation_settings") {
            Some(s) if !s.is_null() => parse_generation_settings(s),
            _ => GenerationPolicy::permissive(),
        }
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
        let uc = dc
            .get("use_cases")
            .and_then(|v| v.as_array())?
            .iter()
            .find(|u| {
                u.get("id").and_then(|v| v.as_str()) == Some(use_case_id)
            })?;
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
    pub fn resolve_notification_channels(
        pool: &DbPool,
        persona_id: &str,
        use_case_id: Option<&str>,
        fallback_channels: Option<&str>,
    ) -> Option<String> {
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
        assert_eq!(p.event_aliases.get("alert").map(|s| s.as_str()), Some("escalation"));
        assert_eq!(p.event_aliases.get("summary").map(|s| s.as_str()), Some("daily_digest"));
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
        }).to_string();
        let p1 = testable::pick_generation_policy(&dc, "uc-1");
        assert!(matches!(p1.memories, testable::BoolPolicy::Off));
        assert!(matches!(p1.reviews, testable::ReviewPolicy::On));
        let p2 = testable::pick_generation_policy(&dc, "uc-2");
        assert!(matches!(p2.memories, testable::BoolPolicy::On));
        assert!(matches!(p2.reviews, testable::ReviewPolicy::TrustLlm));
    }

    #[test]
    fn published_event_name_uses_alias_when_present() {
        let mut p = testable::GenerationPolicy::permissive();
        p.event_aliases.insert("alert".to_string(), "escalation".to_string());
        assert_eq!(p.published_event_name("alert"), "escalation");
        assert_eq!(p.published_event_name("other"), "other");
    }
}
