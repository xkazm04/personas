//! Protocol dispatcher: routes parsed ProtocolMessage values to the appropriate DB repo.
//!
//! Extracted from runner.rs to decouple semantic message handling from process
//! lifecycle orchestration. Any execution backend (CLI, HTTP, cloud) can use
//! this dispatcher to handle protocol messages identically.

use tauri::{AppHandle, Emitter};

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
    pub app: &'a AppHandle,
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
    /// Cached quality-gate config — loaded lazily on first use, then reused for
    /// all subsequent protocol messages in this execution. Avoids O(messages)
    /// DB reads for config that rarely changes.
    quality_gate_cache: Option<QualityGateConfig>,
}

impl<'a> DispatchContext<'a> {
    /// Create a new dispatch context with a pre-loaded quality-gate config.
    ///
    /// The `gate_config` is shared across all protocol messages in the execution,
    /// avoiding repeated DB queries. Load it once with [`quality_gate::load`]
    #[allow(clippy::too_many_arguments)]
    /// before the message processing loop and pass the same `Arc` to every context.
    pub fn new(
        app: &'a AppHandle,
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
            app,
            pool,
            execution_id,
            persona_id,
            project_id,
            persona_name,
            notification_channels,
            logger,
            ops_mode: false,
            quality_gate_cache: gate_config,
        }
    }

    /// Return the cached quality-gate config, loading from DB on first call.
    fn quality_gate_config(&mut self) -> &QualityGateConfig {
        if self.quality_gate_cache.is_none() {
            self.quality_gate_cache = Some(quality_gate::load(self.pool));
        }
        self.quality_gate_cache.as_ref().unwrap()
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
                },
            ) {
                Ok(m) => {
                    ctx.logger.log(&format!(
                        "[MESSAGE] Created: {} ({})",
                        m.title.as_deref().unwrap_or("untitled"),
                        m.id
                    ));
                    let _ = ctx.app.emit(event_name::MESSAGE_CREATED, &m);
                    crate::notifications::notify_new_message(
                        ctx.app,
                        ctx.persona_name,
                        m.title.as_deref().unwrap_or("New message"),
                        ctx.notification_channels,
                    );
                }
                Err(e) => ctx.logger.log(&format!("[MESSAGE] Failed to create: {e}")),
            }
        }
        ProtocolMessage::PersonaAction {
            target,
            action,
            input,
        } => {
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
                    use_case_id: None,
                },
            ) {
                Ok(_) => ctx.logger.log(&format!(
                    "[EVENT] Published persona_action targeting '{target}'"
                )),
                Err(e) => ctx.logger.log(&format!("[EVENT] Failed to publish persona_action: {e}")),
            }
        }
        ProtocolMessage::EmitEvent { event_type, data } => {
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
                    event_type: event_type.clone(),
                    source_type: format!("persona:{}", safe_name),
                    source_id: Some(ctx.persona_id.to_string()),
                    target_persona_id: None,
                    project_id: Some(ctx.project_id.to_string()),
                    payload: data.as_ref().map(|d| d.to_string()),
                    use_case_id: None,
                },
            ) {
                Ok(_) => ctx.logger.log(&format!("[EVENT] Published custom event: {event_type}")),
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

            // Clamp importance to 1-10
            let clamped_importance = importance.map(|v| v.clamp(1, 10));
            match mem_repo::create(
                ctx.pool,
                CreatePersonaMemoryInput {
                    persona_id: ctx.persona_id.to_string(),
                    source_execution_id: Some(ctx.execution_id.to_string()),
                    title: title.clone(),
                    content: content.clone(),
                    category: category.clone(),
                    importance: clamped_importance,
                    tags: tags.as_ref().map(|t| crate::db::models::Json(t.clone())),
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
                },
            ) {
                Ok(r) => {
                    ctx.logger.log(&format!(
                        "[REVIEW] Created manual review: {} ({})",
                        title, r.id
                    ));
                    crate::notifications::notify_manual_review(
                        ctx.app,
                        ctx.persona_name,
                        title,
                        ctx.notification_channels,
                    );
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
        let _ = self.app.emit(event_name::EXECUTION_OUTPUT, event);
    }

    fn emit_structured_event(&self, event: &StructuredExecutionEvent) {
        let _ = self.app.emit(event_name::EXECUTION_EVENT, event);
    }

    fn emit_heartbeat(&self, event: &HeartbeatEvent) {
        let _ = self.app.emit(event_name::EXECUTION_HEARTBEAT, event);
    }

    fn finalize_status(&self, finalization: &StatusFinalization) {
        let _ = self.app.emit(
            event_name::EXECUTION_STATUS,
            finalization.to_status_event(),
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
}
