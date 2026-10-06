//! `chat_send` to Athena from a paired phone (PHASE2-SPEC 5.3, Athena path;
//! owner decision M18: Athena first).
//!
//! The command is a request to start ONE Athena turn; its reply is not part of
//! the command. The turn runs through the same Rust path the desktop panel uses
//! (`companion::session::send_turn`, behind `companion_send_message`), and both
//! the user's message and Athena's reply reach the phone as DATA, through the
//! Athena chat projection (`cloud::sync::athena_chat`) - which is why a
//! `chat_send` is refused while "Sync chats" is off: the phone would never see
//! an answer.
//!
//! # The contract (what the web signs and what it gets back)
//!
//! * Row: `command_type = 'chat_send'`, `persona_id = 'athena'`
//!   ([`ATHENA_PERSONA`]), and the envelope's `"persona":"athena"`. A
//!   `chat_send` naming any other persona is refused
//!   `unsupported_command_type` before the trust check (persona chat waits for
//!   its turn to move into Rust).
//! * `params` = `{"sessionId": "<Athena thread id>" | null, "message": "..."}`,
//!   read from the SIGNED envelope. `null` (or absent) starts a new thread. A
//!   named thread must exist and be active, else `not_found`.
//! * `message`: trimmed, non-empty (`empty_message`), at most
//!   [`MAX_MESSAGE_BYTES`] UTF-8 bytes (`message_too_long`).
//! * Other preconditions: "Sync chats" on (`chat_sync_off`); Athena switched on
//!   in Settings > Companions (`athena_off`).
//! * `result` on `completed` = `{"sessionId": "<thread id>", "userMessageId":
//!   "<episode id>" | null}`; `result_ref` = the thread id. The command
//!   completes when the turn STARTS. `userMessageId` is the id the message will
//!   carry in `synced_chat_messages`; it is `null` only when the thread was
//!   busy with an earlier turn for longer than [`START_WAIT`], in which case
//!   the message is queued behind it and still arrives as data. There is no
//!   `executionId`: an Athena turn is not a persona execution.
//!
//! The turn runs as the user's own (`TurnOrigin::User`), so it lands in the
//! transcript as what the user typed, and - as when he types at the desk - it
//! cancels that thread's pending autonomous continuation. Voice and recall
//! synthesis are off and autonomous mode is not started from a phone.

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::Duration;

use futures_util::FutureExt;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::cloud::remote_commands::{Effective, Outcome};
use crate::cloud::sync::athena_chat::{chats_enabled, is_syncable_thread_id};
use crate::companion::conversation;
use crate::companion::session;
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;
use crate::utils::extract_panic_message;
use crate::AppState;

pub(crate) use crate::cloud::sync::athena_chat::ATHENA_PERSONA;

/// The largest message a phone may send, in UTF-8 bytes (PHASE2-SPEC 2.2).
pub const MAX_MESSAGE_BYTES: usize = 8 * 1024;

/// How long the command waits for the turn to persist the user's message.
const START_WAIT: Duration = Duration::from_secs(5);
const START_POLL: Duration = Duration::from_millis(100);

/// Whether a `chat_send` row targets a recipient this desktop serves: Athena
/// only. Decided from the row before the trust check, so a persona chat is
/// refused the same way with or without a signature.
pub fn is_supported_target(persona_id: Option<&str>) -> bool {
    persona_id == Some(ATHENA_PERSONA)
}

/// A validated `chat_send`.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatSendPlan {
    /// `None` = start a new thread.
    pub session_id: Option<String>,
    pub message: String,
}

/// Every precondition of the contract above, from the database alone.
pub fn plan(
    pool: &DbPool,
    user_db: &UserDbPool,
    cmd: &Effective,
) -> Result<ChatSendPlan, AppError> {
    if !is_supported_target(cmd.persona_id.as_deref()) {
        return Err(AppError::Validation(
            "unsupported_command_type: chat_send is served for Athena only".into(),
        ));
    }
    if !chats_enabled(pool) {
        return Err(AppError::Validation("chat_sync_off".into()));
    }
    if !crate::commands::companions::athena_enabled(pool) {
        return Err(AppError::Validation("athena_off".into()));
    }
    let message = match cmd.params.get("message") {
        Some(Value::String(m)) => m.trim().to_string(),
        None | Some(Value::Null) => String::new(),
        Some(_) => return Err(AppError::Validation("bad_params".into())),
    };
    // The shared rule, with the contract's token as the refusal.
    personas_core::validation::require_non_empty("message", &message)
        .map_err(|_| AppError::Validation("empty_message".into()))?;
    if message.len() > MAX_MESSAGE_BYTES {
        return Err(AppError::Validation("message_too_long".into()));
    }
    let session_id = match cmd.params.get("sessionId") {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) => {
            if !is_syncable_thread_id(id) {
                return Err(AppError::NotFound(format!("Athena thread {id}")));
            }
            match conversation::get(user_db, id)? {
                Some(row) if row.status == "active" => Some(id.clone()),
                _ => return Err(AppError::NotFound(format!("Athena thread {id}"))),
            }
        }
        Some(_) => return Err(AppError::Validation("bad_params".into())),
    };
    Ok(ChatSendPlan {
        session_id,
        message,
    })
}

/// The thread the turn runs in: the named one, or a new one.
pub fn resolve_thread(user_db: &UserDbPool, plan: &ChatSendPlan) -> Result<String, AppError> {
    match &plan.session_id {
        Some(id) => Ok(id.clone()),
        None => Ok(conversation::create(user_db, None, "user")?.id),
    }
}

/// The `completed` write of a started turn.
pub fn outcome(session_id: &str, user_message_id: Option<String>) -> Outcome {
    Outcome {
        result: json!({ "sessionId": session_id, "userMessageId": user_message_id }),
        execution_id: None,
        result_ref: Some(session_id.to_string()),
    }
}

/// The id of the first USER turn of `session_id` indexed after `after_rowid`
/// (see [`node_watermark`]), if one exists yet.
pub fn newest_user_turn_since(
    user_db: &UserDbPool,
    session_id: &str,
    after_rowid: i64,
) -> Result<Option<String>, AppError> {
    use rusqlite::OptionalExtension;
    let conn = user_db.get()?;
    Ok(conn
        .query_row(
            "SELECT id FROM companion_node \
             WHERE kind = 'episode' AND session_id = ?1 AND rowid > ?2 \
               AND file_path LIKE '%\\_user.md' ESCAPE '\\' \
             ORDER BY rowid ASC LIMIT 1",
            rusqlite::params![session_id, after_rowid],
            |r| r.get::<_, String>(0),
        )
        .optional()?)
}

/// The highest `companion_node` rowid now (0 when empty).
pub fn node_watermark(user_db: &UserDbPool) -> Result<i64, AppError> {
    let conn = user_db.get()?;
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(rowid), 0) FROM companion_node",
        [],
        |r| r.get(0),
    )?)
}

/// Start the turn on Athena's own path and wait (at most [`START_WAIT`]) for
/// it to persist the user's message. The turn itself runs on, detached, inside
/// a panic boundary; when it ends the sync loop is woken so the reply reaches
/// the phone within one pass.
pub async fn start_turn(
    app: &AppHandle,
    state: &Arc<AppState>,
    session_id: &str,
    message: &str,
) -> Result<Option<String>, AppError> {
    let user_db = state.user_db.clone();
    let watermark = node_watermark(&user_db)?;
    // As when he types at the desk: his message stops this thread's
    // autonomous continuation (other threads keep theirs).
    session::cancel_pending_autonomy(session_id);

    let app_c = app.clone();
    let user_db_c = Arc::new(state.user_db.clone());
    let sys_db = Arc::new(state.db.clone());
    #[cfg(feature = "ml")]
    let embedder = state.embedding_manager.clone();
    let thread = session_id.to_string();
    let text = message.to_string();
    tauri::async_runtime::spawn(async move {
        let turn = AssertUnwindSafe(async move {
            session::send_turn(
                &app_c,
                user_db_c,
                sys_db,
                #[cfg(feature = "ml")]
                embedder,
                text,
                session::TurnOrigin::User,
                false,
                false,
                false,
                thread,
            )
            .await
        })
        .catch_unwind()
        .await;
        match turn {
            Ok(Ok(_)) => {}
            // `send_turn` already wrote its failure row to the turn ledger.
            Ok(Err(e)) => tracing::warn!(error = %e, "remote chat_send: Athena turn failed"),
            Err(panic) => tracing::error!(
                panic = %extract_panic_message(panic),
                "remote chat_send: Athena turn panicked"
            ),
        }
        // The reply (or nothing, on failure) is now on disk: sync it.
        crate::cloud::sync::notify_dirty();
    });

    let deadline = tokio::time::Instant::now() + START_WAIT;
    loop {
        if let Some(id) = newest_user_turn_since(&user_db, session_id, watermark)? {
            return Ok(Some(id));
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(None);
        }
        tokio::time::sleep(START_POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn pools(chats_on: bool) -> (DbPool, UserDbPool) {
        let pool = crate::db::init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        settings::set(
            &pool,
            settings_keys::CLOUD_SYNC_CHATS_ENABLED,
            if chats_on { "true" } else { "false" },
        )
        .unwrap();
        (pool, user)
    }

    fn reason(r: Result<ChatSendPlan, AppError>) -> String {
        match r {
            Err(AppError::Validation(m)) => m,
            Err(AppError::NotFound(_)) => "not_found".into(),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn only_athena_is_a_supported_target() {
        assert!(is_supported_target(Some("athena")));
        assert!(!is_supported_target(Some("0b9c2f4e-persona")));
        assert!(!is_supported_target(None));
    }

    #[test]
    fn a_new_thread_message_plans_and_resolves_to_a_fresh_thread() {
        let (pool, user) = pools(true);
        let p = plan(
            &pool,
            &user,
            &cmd(
                "athena",
                json!({ "sessionId": null, "message": "  hi there  " }),
            ),
        )
        .unwrap();
        assert_eq!(
            p,
            ChatSendPlan {
                session_id: None,
                message: "hi there".into()
            }
        );
        let thread = resolve_thread(&user, &p).unwrap();
        assert!(thread.starts_with("conv_"), "{thread}");
        assert_eq!(
            outcome(&thread, Some("ep_1".into())).result,
            json!({ "sessionId": thread, "userMessageId": "ep_1" })
        );
    }

    #[test]
    fn a_named_thread_must_exist_and_be_active() {
        let (pool, user) = pools(true);
        conversation::ensure_system_conversations(&user).unwrap();
        let ok = plan(
            &pool,
            &user,
            &cmd(
                "athena",
                json!({ "sessionId": "default", "message": "hello" }),
            ),
        )
        .unwrap();
        assert_eq!(ok.session_id.as_deref(), Some("default"));
        for missing in ["conv_nope", "a&b"] {
            assert_eq!(
                reason(plan(
                    &pool,
                    &user,
                    &cmd("athena", json!({ "sessionId": missing, "message": "x" }))
                )),
                "not_found"
            );
        }
    }

    #[test]
    fn the_preconditions_refuse_with_their_tokens() {
        let (pool, user) = pools(true);
        let send = |p: Value| reason(plan(&pool, &user, &cmd("athena", p)));
        assert_eq!(send(json!({ "message": "   " })), "empty_message");
        assert_eq!(send(json!({})), "empty_message");
        assert_eq!(
            send(json!({ "message": "x".repeat(MAX_MESSAGE_BYTES + 1) })),
            "message_too_long"
        );
        assert!(plan(
            &pool,
            &user,
            &cmd(
                "athena",
                json!({ "message": "x".repeat(MAX_MESSAGE_BYTES) })
            )
        )
        .is_ok());
        assert_eq!(send(json!({ "message": 5 })), "bad_params");
        assert_eq!(
            send(json!({ "message": "x", "sessionId": 3 })),
            "bad_params"
        );
        assert!(reason(plan(
            &pool,
            &user,
            &cmd("persona-1", json!({ "message": "x" }))
        ))
        .starts_with("unsupported_command_type"));

        let (off, user_off) = pools(false);
        assert_eq!(
            reason(plan(
                &off,
                &user_off,
                &cmd("athena", json!({ "message": "x" }))
            )),
            "chat_sync_off"
        );

        settings::set(&pool, settings_keys::ATHENA_ENABLED, "false").unwrap();
        assert_eq!(send(json!({ "message": "x" })), "athena_off");
    }

    #[test]
    fn the_new_user_turn_is_found_above_the_watermark() {
        let (_pool, user) = pools(true);
        let insert = |id: &str, role: &str| -> Result<usize, AppError> {
            Ok(user.get()?.execute(
                "INSERT INTO companion_node (id, kind, session_id, file_path, content_hash, body_excerpt) \
                 VALUES (?1, 'episode', 'default', ?2, 'h', 'x')",
                rusqlite::params![id, format!("episodes/2026/10/06/{id}_{role}.md")],
            )?)
        };
        insert("ep_before", "user").unwrap();
        let mark = node_watermark(&user).unwrap();
        assert_eq!(
            newest_user_turn_since(&user, "default", mark).unwrap(),
            None
        );
        insert("ep_reply", "assistant").unwrap();
        insert("ep_mine", "user").unwrap();
        assert_eq!(
            newest_user_turn_since(&user, "default", mark)
                .unwrap()
                .as_deref(),
            Some("ep_mine")
        );
    }
}
