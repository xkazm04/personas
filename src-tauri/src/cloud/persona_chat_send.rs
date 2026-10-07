//! `chat_send` to a PERSONA from a paired phone (PHASE2-SPEC 5.3, persona
//! path; owner decision M18: Athena first - `cloud::athena_send` - then
//! persona chat, which needed the turn hoisted into Rust first).
//!
//! The command is a request to start ONE persona chat turn; its reply is not
//! part of the command. The turn runs through the desktop's one turn path,
//! `commands::core::chat_turn::start` (the same call the desktop chat makes),
//! and both the user's message and the persona's reply reach the phone as
//! DATA, through the persona chat projection (`cloud::sync::persona_chat`) -
//! which is why a `chat_send` is refused while "Sync chats" is off.
//!
//! # The contract (what the web signs and what it gets back)
//!
//! * Row: `command_type = 'chat_send'`, `persona_id = <the persona's id>`, and
//!   the envelope's `"persona"` the same id.
//! * `params` = `{"sessionId": "<chat session id>" | null, "message": "..."}`,
//!   read from the SIGNED envelope. `null` (or absent) opens a new session
//!   (`chat-<ms>-<hex>`, in agent mode: the phone talks TO the agent). A named
//!   session must be one of this persona's (a context row or a message),
//!   else `not_found`; it continues in the mode it was stored with.
//! * `message`: trimmed, non-empty (`empty_message`), at most
//!   [`MAX_MESSAGE_BYTES`] UTF-8 bytes (`message_too_long`). A `message` or
//!   `sessionId` of the wrong JSON type is `bad_params`.
//! * Other preconditions, in this order: "Sync chats" on (`chat_sync_off`);
//!   the persona exists here (`not_found`). A paused persona is accepted
//!   (M21, below).
//! * `result` on `completed` = `{"sessionId", "userMessageId",
//!   "executionId"}`, and the row's `execution_id` column = the run. The
//!   command completes when the turn STARTS; the user row is already written
//!   by then (it reaches `synced_chat_messages` at the next pass) and the
//!   reply lands as an assistant row when the run completes. A run the engine
//!   refuses to start (the persona's project is switched off, its connectors
//!   need setup) fails the command with the engine's message, and the user
//!   row stays, as it does at the desk.
//! * The command id is the run's idempotency key.
//!
//! # Why a paused persona still chats (owner decision M21, 2026-10-07)
//!
//! Pause means the persona does not operate in its own role: its triggers,
//! schedules and event subscriptions stop. A `chat_send` is not the persona
//! acting on its own; it is the user asking it something, exactly as an
//! explicit `run_persona` is (which never checked the pause either), and the
//! desk's own chat runs a paused persona too. So the phone's turn runs, the
//! persona stays paused, and the two explicit verbs behave the same. The
//! spend is the same spend M17 already accepts for any paired `chat_send`.

use rusqlite::OptionalExtension;
use serde_json::{json, Value};

use crate::cloud::remote_commands::{Effective, Outcome};
use crate::cloud::sync::athena_chat::chats_enabled;
use crate::cloud::sync::persona_chat::is_syncable_session_id;
use crate::commands::core::chat_turn::{ChatTurnRequest, ChatTurnStarted};
use crate::db::DbPool;
use crate::error::AppError;

/// The largest message a phone may send, in UTF-8 bytes (PHASE2-SPEC 2.2);
/// the same bound as Athena's.
pub const MAX_MESSAGE_BYTES: usize = crate::cloud::athena_send::MAX_MESSAGE_BYTES;

/// A validated persona `chat_send`.
#[derive(Debug, Clone, PartialEq)]
pub struct PersonaChatPlan {
    pub persona_id: String,
    /// `None` = open a new session.
    pub session_id: Option<String>,
    pub message: String,
}

impl PersonaChatPlan {
    /// The turn to start. The mode is left to the turn: the session's stored
    /// mode, or agent for a new session.
    pub fn request(&self) -> ChatTurnRequest {
        ChatTurnRequest {
            session_id: self.session_id.clone(),
            message: self.message.clone(),
            mode: None,
        }
    }
}

/// Whether `session_id` is one of `persona_id`'s chat sessions.
fn session_belongs(pool: &DbPool, persona_id: &str, session_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let hit: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM chat_session_context WHERE session_id = ?1 AND persona_id = ?2 \
             UNION ALL \
             SELECT 1 FROM chat_messages WHERE session_id = ?1 AND persona_id = ?2 \
             LIMIT 1",
            rusqlite::params![session_id, persona_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(hit.is_some())
}

/// Every precondition of the contract above, from the database alone.
pub fn plan(pool: &DbPool, cmd: &Effective) -> Result<PersonaChatPlan, AppError> {
    if !chats_enabled(pool) {
        return Err(AppError::Validation("chat_sync_off".into()));
    }
    let message = match cmd.params.get("message") {
        Some(Value::String(m)) => m.trim().to_string(),
        None | Some(Value::Null) => String::new(),
        Some(_) => return Err(AppError::Validation("bad_params".into())),
    };
    let session_id = match cmd.params.get("sessionId") {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) => Some(id.clone()),
        Some(_) => return Err(AppError::Validation("bad_params".into())),
    };
    personas_core::validation::require_non_empty("message", &message)
        .map_err(|_| AppError::Validation("empty_message".into()))?;
    if message.len() > MAX_MESSAGE_BYTES {
        return Err(AppError::Validation("message_too_long".into()));
    }
    let persona_id = cmd.persona_id.clone().unwrap_or_default();
    // A missing id and an unknown one are the same answer: no such persona.
    // Its pause is not checked: a paused persona still takes a chat (M21).
    crate::db::repos::core::personas::get_by_id(pool, &persona_id)
        .map_err(|_| AppError::NotFound(format!("Persona {persona_id}")))?;
    if let Some(id) = session_id.as_deref() {
        if !is_syncable_session_id(id) || !session_belongs(pool, &persona_id, id)? {
            return Err(AppError::NotFound(format!("Chat session {id}")));
        }
    }
    Ok(PersonaChatPlan {
        persona_id,
        session_id,
        message,
    })
}

/// The `completed` write of a started turn. The run goes in the row's
/// `execution_id` column too, so the phone can follow it in
/// `synced_executions` ("thinking") until the reply lands.
pub fn outcome(started: &ChatTurnStarted) -> Outcome {
    Outcome {
        result: json!({
            "sessionId": started.session_id,
            "userMessageId": started.user_message.id,
            "executionId": started.execution_id,
        }),
        execution_id: Some(started.execution_id.clone()),
        result_ref: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{ChatRole, CreateChatMessageInput, CreatePersonaInput};
    use crate::db::repos::core::settings;
    use crate::db::settings_keys;

    fn cmd(persona: &str, params: Value) -> Effective {
        Effective {
            id: "c1".into(),
            command_type: "chat_send".into(),
            persona_id: Some(persona.into()),
            params,
            prompt: None,
        }
    }

    fn setup(chats_on: bool) -> (DbPool, String) {
        let pool = crate::db::init_test_db().unwrap();
        settings::set(
            &pool,
            settings_keys::CLOUD_SYNC_CHATS_ENABLED,
            if chats_on { "true" } else { "false" },
        )
        .unwrap();
        let persona = crate::db::repos::core::personas::create(
            &pool,
            CreatePersonaInput {
                name: "Phone chat persona".into(),
                system_prompt: "You are a test persona.".into(),
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
        .id;
        (pool, persona)
    }

    fn reason(r: Result<PersonaChatPlan, AppError>) -> String {
        match r {
            Err(AppError::Validation(m)) => m,
            Err(AppError::NotFound(_)) => "not_found".into(),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_new_session_message_plans_with_the_trimmed_text() {
        let (pool, p) = setup(true);
        let plan = plan(
            &pool,
            &cmd(&p, json!({ "sessionId": null, "message": "  hi  " })),
        )
        .unwrap();
        assert_eq!(
            plan,
            PersonaChatPlan {
                persona_id: p,
                session_id: None,
                message: "hi".into()
            }
        );
        assert!(plan.request().mode.is_none(), "the turn picks the mode");
    }

    #[test]
    fn a_named_session_must_be_this_personas() {
        let (pool, p) = setup(true);
        crate::db::repos::communication::chat::create(
            &pool,
            CreateChatMessageInput {
                persona_id: p.clone(),
                session_id: "chat-1-aaaa0001".into(),
                role: ChatRole::User,
                content: "earlier".into(),
                execution_id: None,
                metadata: None,
            },
        )
        .unwrap();
        let ok = plan(
            &pool,
            &cmd(
                &p,
                json!({ "sessionId": "chat-1-aaaa0001", "message": "again" }),
            ),
        )
        .unwrap();
        assert_eq!(ok.session_id.as_deref(), Some("chat-1-aaaa0001"));
        for missing in ["chat-2-bbbb0002", "a&b"] {
            assert_eq!(
                reason(plan(
                    &pool,
                    &cmd(&p, json!({ "sessionId": missing, "message": "x" }))
                )),
                "not_found"
            );
        }
    }

    #[test]
    fn the_preconditions_refuse_with_their_tokens() {
        let (pool, p) = setup(true);
        let send = |v: Value| reason(plan(&pool, &cmd(&p, v)));
        assert_eq!(send(json!({ "message": "   " })), "empty_message");
        assert_eq!(send(json!({})), "empty_message");
        assert_eq!(
            send(json!({ "message": "x".repeat(MAX_MESSAGE_BYTES + 1) })),
            "message_too_long"
        );
        assert!(plan(
            &pool,
            &cmd(&p, json!({ "message": "x".repeat(MAX_MESSAGE_BYTES) }))
        )
        .is_ok());
        assert_eq!(send(json!({ "message": 5 })), "bad_params");
        assert_eq!(
            send(json!({ "message": "x", "sessionId": 3 })),
            "bad_params"
        );
        assert_eq!(
            reason(plan(
                &pool,
                &cmd("no-such-persona", json!({ "message": "x" }))
            )),
            "not_found"
        );

        // M21: a paused persona still takes an explicit chat.
        crate::db::repos::core::personas::set_enabled(&pool, &p, false).unwrap();
        assert!(plan(&pool, &cmd(&p, json!({ "message": "x" }))).is_ok());

        let (off, p_off) = setup(false);
        assert_eq!(
            reason(plan(&off, &cmd(&p_off, json!({ "message": "x" })))),
            "chat_sync_off"
        );
    }
}
