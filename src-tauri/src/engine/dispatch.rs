//! Protocol dispatcher: routes parsed ProtocolMessage values to the appropriate DB repo.
//!
//! Extracted from runner.rs to decouple semantic message handling from process
//! lifecycle orchestration. Any execution backend (CLI, HTTP, cloud) can use
//! this dispatcher to handle protocol messages identically.

use tauri::{AppHandle, Emitter};

use crate::db::models::{
    CreateManualReviewInput, CreateMessageInput, CreatePersonaEventInput, CreatePersonaMemoryInput,
};
use crate::db::repos::communication::{
    events as event_repo, manual_reviews as review_repo, messages as msg_repo,
};
use crate::db::repos::core::memories as mem_repo;
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
}

/// Route a single protocol message to the appropriate DB repo and emit events.
///
/// This is the core dispatch function. It handles all 6 protocol message types:
/// - `UserMessage` → messages repo + frontend event + OS notification
/// - `PersonaAction` → events repo (persona_action event type)
/// - `EmitEvent` → events repo (custom event type)
/// - `AgentMemory` → memories repo
/// - `ManualReview` → manual_reviews repo + OS notification
/// - `ExecutionFlow` → logged only (stored at execution completion)
pub fn dispatch(ctx: &mut DispatchContext<'_>, msg: &ProtocolMessage) {
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
                },
            ) {
                Ok(m) => {
                    ctx.logger.log(&format!(
                        "[MESSAGE] Created: {} ({})",
                        m.title.as_deref().unwrap_or("untitled"),
                        m.id
                    ));
                    let _ = ctx.app.emit("message-created", &m);
                    crate::notifications::notify_new_message(
                        ctx.app,
                        ctx.persona_name,
                        m.title.as_deref().unwrap_or("New message"),
                        ctx.notification_channels,
                    );
                }
                Err(e) => ctx.logger.log(&format!("[MESSAGE] Failed to create: {}", e)),
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
                    source_type: "persona".to_string(),
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
                    "[EVENT] Published persona_action targeting '{}'",
                    target
                )),
                Err(e) => ctx.logger.log(&format!("[EVENT] Failed to publish persona_action: {}", e)),
            }
        }
        ProtocolMessage::EmitEvent { event_type, data } => {
            match event_repo::publish(
                ctx.pool,
                CreatePersonaEventInput {
                    event_type: event_type.clone(),
                    source_type: "persona".to_string(),
                    source_id: Some(ctx.persona_id.to_string()),
                    target_persona_id: None,
                    project_id: Some(ctx.project_id.to_string()),
                    payload: data.as_ref().map(|d| d.to_string()),
                    use_case_id: None,
                },
            ) {
                Ok(_) => ctx.logger.log(&format!("[EVENT] Published custom event: {}", event_type)),
                Err(e) => ctx.logger.log(&format!("[EVENT] Failed to publish: {}", e)),
            }
        }
        ProtocolMessage::AgentMemory {
            title,
            content,
            category,
            importance,
            tags,
        } => {
            match mem_repo::create(
                ctx.pool,
                CreatePersonaMemoryInput {
                    persona_id: ctx.persona_id.to_string(),
                    source_execution_id: Some(ctx.execution_id.to_string()),
                    title: title.clone(),
                    content: content.clone(),
                    category: category.clone(),
                    importance: *importance,
                    tags: tags.as_ref().map(|t| serde_json::json!(t).to_string()),
                },
            ) {
                Ok(m) => ctx.logger.log(&format!("[MEMORY] Stored: {} ({})", title, m.id)),
                Err(e) => ctx.logger.log(&format!("[MEMORY] Failed to store: {}", e)),
            }
        }
        ProtocolMessage::ManualReview {
            title,
            description,
            severity,
            context_data,
            suggested_actions,
        } => {
            match review_repo::create(
                ctx.pool,
                CreateManualReviewInput {
                    execution_id: ctx.execution_id.to_string(),
                    persona_id: ctx.persona_id.to_string(),
                    title: title.clone(),
                    description: description.clone(),
                    severity: severity.clone(),
                    context_data: context_data.clone(),
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
                Err(e) => ctx.logger.log(&format!("[REVIEW] Failed to create: {}", e)),
            }
        }
        ProtocolMessage::ExecutionFlow { .. } => {
            // Execution flows are handled at the top level, not here
            ctx.logger.log("[FLOW] Execution flow captured (will be stored on completion)");
        }
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
