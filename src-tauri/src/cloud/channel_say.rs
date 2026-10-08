//! `channel_say` from a paired phone: the operator speaks into an App Master's
//! channel (operator weekend item E, 2026-10-08).
//!
//! The operator's voice to an App Master is a `team_channel_messages` row with
//! `author_kind = 'user'` and `persona_id` = the master persona. The in-app
//! master reads it, and the headless master reads it at its next wake
//! (`.claude/skills/appmaster/lib/dbread.mjs` `operatorChannelSince`:
//! `persona_id = ? AND author_kind = 'user'`). Until this verb only the desk
//! wrote one (`post_persona_channel_message`).
//!
//! # The contract (what the web signs and what it gets back)
//!
//! * Row: `command_type = 'channel_say'`, `persona_id` = the App Master
//!   persona, and the envelope's `"persona"` the same id. Verified like every
//!   v1 verb (`cloud::trust::check`), and the command executed is parsed FROM
//!   the signed envelope.
//! * `params` = exactly `{"message": "..."}`. A missing or non-string message
//!   is `bad_params`. The message is trimmed; empty is `empty_message`; more
//!   than [`MAX_MESSAGE_CHARS`] characters (`chars().count()` after the trim)
//!   is `message_too_long` - refused, never cut.
//! * Then, in order: the persona exists here, else `not_found`; it is an App
//!   Master (holds at least one non-retired charter bound to a project or a
//!   workspace, `engine::subscription::is_app_master`), else
//!   `not_app_master`.
//! * Effect: credential-looking tokens are masked with the sync redactor
//!   (`cloud::sync::redact::redact_text`, as `review_decide` does for phone
//!   notes), then ONE row is written through
//!   `team_channel::create_persona_channel_message` with `author_kind 'user'`,
//!   no author id or label, no `reply_to`, not failed, and `id` = the command
//!   id. A re-delivered command writes nothing: if that id is already this
//!   persona's user message, the command completes with `changed: false`. The
//!   desk's channel view is told through `PERSONA_CHANNEL_MESSAGE`.
//! * It starts NO execution: never `dispatch_channel_followup`, never
//!   `execute_persona_inner` (operator decision 2026-10-08: the in-app masters
//!   stay off and the headless loop is the engine).
//! * Completed: `{"messageId", "changed"}`, `result_ref` = the message id, no
//!   `execution_id`.

use serde_json::{json, Value};

use crate::cloud::remote_commands::{Effective, Outcome};
use crate::cloud::sync::redact::redact_text;
use crate::db::repos::core::{personas as persona_repo, responsibilities};
use crate::db::repos::resources::team_channel as channel_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// The longest message a phone may say, in characters, after the trim.
pub const MAX_MESSAGE_CHARS: usize = 2000;

/// A validated `channel_say`, ready to write.
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelSayPlan {
    /// The App Master persona the message is for.
    pub persona_id: String,
    /// The row id: the command id.
    pub message_id: String,
    /// The trimmed, masked body.
    pub body: String,
}

/// The trimmed message, or the refusal token for the params.
fn message_of(params: &Value) -> Result<String, AppError> {
    let Some(raw) = params.get("message").and_then(Value::as_str) else {
        return Err(AppError::Validation("bad_params".into()));
    };
    let message = raw.trim();
    personas_core::validation::require_non_empty("message", message)
        .map_err(|_| AppError::Validation("empty_message".into()))?;
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(AppError::Validation("message_too_long".into()));
    }
    Ok(message.to_string())
}

/// Every precondition of the contract above, from the database alone.
pub fn plan(pool: &DbPool, cmd: &Effective) -> Result<ChannelSayPlan, AppError> {
    let message = message_of(&cmd.params)?;
    let persona_id = cmd.persona_id.as_deref().unwrap_or_default().trim();
    if persona_id.is_empty() {
        return Err(AppError::NotFound("Persona".into()));
    }
    let persona = persona_repo::get_by_id(pool, persona_id)?;
    let charters = responsibilities::list_by_persona(pool, &persona.id, false)?;
    let refs: Vec<_> = charters.iter().collect();
    if !crate::engine::subscription::is_app_master(&refs) {
        return Err(AppError::Validation("not_app_master".into()));
    }
    Ok(ChannelSayPlan {
        persona_id: persona.id,
        message_id: cmd.id.clone(),
        body: redact_text(&message),
    })
}

/// The `completed` result for the message `id`.
pub fn outcome(id: &str, changed: bool) -> Outcome {
    Outcome {
        result: json!({ "messageId": id, "changed": changed }),
        execution_id: None,
        result_ref: Some(id.to_string()),
    }
}

/// Whether `id` is already a row, and if so whether it is this persona's own
/// operator message (a re-delivery). A row of that id that is anything else
/// is a conflict, never adopted as ours.
fn existing(pool: &DbPool, plan: &ChannelSayPlan) -> Result<Option<bool>, AppError> {
    match channel_repo::get(pool, &plan.message_id) {
        Ok(m) => Ok(Some(
            m.author_kind == "user" && m.team_id == format!("persona:{}", plan.persona_id),
        )),
        Err(AppError::Database(rusqlite::Error::QueryReturnedNoRows)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Plan, then write the one row. `changed` is false when the command id was
/// already written (a re-delivered command). The caller emits the refresh
/// event when `changed` is true; nothing here starts an execution.
pub fn execute(pool: &DbPool, cmd: &Effective) -> Result<Outcome, AppError> {
    let plan = plan(pool, cmd)?;
    match existing(pool, &plan)? {
        Some(true) => return Ok(outcome(&plan.message_id, false)),
        Some(false) => {
            return Err(AppError::Internal(format!(
                "channel_say: id {} is already another message",
                plan.message_id
            )))
        }
        None => {}
    }
    let written = channel_repo::create_persona_channel_message(
        pool,
        channel_repo::CreatePersonaChannelMessageInput {
            id: Some(plan.message_id.clone()),
            persona_id: plan.persona_id.clone(),
            author_kind: "user".into(),
            author_id: None,
            author_label: None,
            body: plan.body.clone(),
            reply_to: None,
            failed: false,
        },
    );
    match written {
        Ok((id, _at)) => Ok(outcome(&id, true)),
        // Lost a race with a concurrent delivery of the same command between
        // the check and the insert: the row that stands is ours.
        Err(e) => match existing(pool, &plan)? {
            Some(true) => Ok(outcome(&plan.message_id, false)),
            _ => Err(match e {
                // The repo's own texts are not this verb's tokens.
                AppError::Validation(m) => AppError::Internal(m),
                other => other,
            }),
        },
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::models::{CreatePersonaInput, ResponsibilityCadence, ResponsibilityOutcome};
    use crate::db::repos::core::responsibilities::CreateResponsibilityInput;

    fn cmd(id: &str, persona: &str, params: Value) -> Effective {
        Effective {
            id: id.into(),
            command_type: "channel_say".into(),
            persona_id: Some(persona.into()),
            params,
            prompt: None,
        }
    }

    fn persona(pool: &DbPool, name: &str) -> String {
        persona_repo::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
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
        .id
    }

    /// One active charter on `persona`, bound to `project` (or unbound).
    pub(crate) fn charter(pool: &DbPool, persona: &str, project: Option<&str>) {
        let outcomes = vec![ResponsibilityOutcome {
            id: "o1".into(),
            statement: "The project ships".into(),
            success_criteria: vec!["it ships".into()],
        }];
        responsibilities::create(
            pool,
            CreateResponsibilityInput {
                persona_id: persona,
                title: "Run the project",
                domain: "general",
                outcomes: &outcomes,
                objectives: &[],
                scope_rung: 1,
                refusal_classes: &[],
                approval_gates: &[],
                owner: "",
                cadence: &ResponsibilityCadence::default(),
                budget_monthly_usd: None,
                tenure: &Default::default(),
                status: "active",
                project_id: project,
                workspace_id: None,
                source: "operator",
                connectors: &[],
                procedure: "",
                spec: &Default::default(),
            },
        )
        .unwrap();
    }

    /// A persona holding one project-bound charter.
    fn setup() -> (DbPool, String) {
        let pool = crate::db::init_test_db().unwrap();
        let p = persona(&pool, "App Master");
        charter(&pool, &p, Some("proj_web"));
        (pool, p)
    }

    fn reason(r: Result<Outcome, AppError>) -> String {
        match r {
            Err(AppError::Validation(m)) => m,
            Err(AppError::NotFound(_)) => "not_found".into(),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    /// The headless master's read (`dbread.mjs` `operatorChannelSince`).
    pub(crate) fn operator_rows(pool: &DbPool, persona: &str) -> Vec<(String, String)> {
        read_operator_rows(pool, persona).unwrap()
    }

    fn read_operator_rows(pool: &DbPool, persona: &str) -> Result<Vec<(String, String)>, AppError> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, body FROM team_channel_messages
             WHERE persona_id = ?1 AND author_kind = 'user' ORDER BY created_at",
        )?;
        let rows = stmt.query_map([persona], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Every `persona_executions` row, whoever wrote it.
    pub(crate) fn execution_count(pool: &DbPool) -> Result<i64, AppError> {
        Ok(pool
            .get()?
            .query_row("SELECT COUNT(*) FROM persona_executions", [], |r| r.get(0))?)
    }

    const ID: &str = "8f2b4c1e-5d6a-4e7b-9c0d-1a2b3c4d5e6f";

    #[test]
    fn a_say_writes_one_operator_row_with_the_command_id() {
        let (pool, p) = setup();
        let o = execute(
            &pool,
            &cmd(ID, &p, json!({ "message": "  ship E first  " })),
        )
        .unwrap();
        assert_eq!(o.result, json!({ "messageId": ID, "changed": true }));
        assert_eq!(o.result_ref.as_deref(), Some(ID));
        assert_eq!(o.execution_id, None);
        assert_eq!(
            operator_rows(&pool, &p),
            vec![(ID.to_string(), "ship E first".to_string())]
        );
        let row = channel_repo::get(&pool, ID).unwrap();
        assert_eq!(row.author_id, None);
        assert_eq!(row.reply_to, None);
    }

    #[test]
    fn a_redelivered_say_writes_nothing_and_reports_unchanged() {
        let (pool, p) = setup();
        let c = cmd(ID, &p, json!({ "message": "once" }));
        execute(&pool, &c).unwrap();
        let again = execute(&pool, &c).unwrap();
        assert_eq!(again.result, json!({ "messageId": ID, "changed": false }));
        assert_eq!(operator_rows(&pool, &p).len(), 1);
    }

    #[test]
    fn an_id_already_held_by_another_message_is_never_adopted() {
        let (pool, p) = setup();
        let other = persona(&pool, "Other master");
        charter(&pool, &other, Some("proj_other"));
        execute(&pool, &cmd(ID, &other, json!({ "message": "theirs" }))).unwrap();
        let e = execute(&pool, &cmd(ID, &p, json!({ "message": "mine" }))).unwrap_err();
        assert!(matches!(e, AppError::Internal(_)), "{e:?}");
        assert!(operator_rows(&pool, &p).is_empty());
    }

    #[test]
    fn a_persona_without_a_bound_charter_is_not_an_app_master() {
        let pool = crate::db::init_test_db().unwrap();
        let plain = persona(&pool, "Plain");
        assert_eq!(
            reason(execute(&pool, &cmd(ID, &plain, json!({ "message": "hi" })))),
            "not_app_master"
        );
        charter(&pool, &plain, None);
        assert_eq!(
            reason(execute(&pool, &cmd(ID, &plain, json!({ "message": "hi" })))),
            "not_app_master",
            "an unbound charter is not enough"
        );
        assert!(operator_rows(&pool, &plain).is_empty());
    }

    #[test]
    fn an_unknown_or_missing_persona_is_not_found() {
        let (pool, _) = setup();
        let send = |c: Effective| reason(execute(&pool, &c));
        assert_eq!(
            send(cmd(ID, "no-such-persona", json!({ "message": "hi" }))),
            "not_found"
        );
        let mut none = cmd(ID, "x", json!({ "message": "hi" }));
        none.persona_id = None;
        assert_eq!(send(none), "not_found");
    }

    #[test]
    fn the_params_refuse_with_their_tokens() {
        let (pool, p) = setup();
        let send = |v: Value| reason(execute(&pool, &cmd(ID, &p, v)));
        for bad in [
            json!({}),
            json!({ "message": 7 }),
            json!({ "message": null }),
        ] {
            assert_eq!(send(bad.clone()), "bad_params", "{bad}");
        }
        assert_eq!(send(json!({ "message": "   \n " })), "empty_message");
        assert!(operator_rows(&pool, &p).is_empty());
    }

    #[test]
    fn the_bound_is_2000_characters_refused_never_cut() {
        let (pool, p) = setup();
        // Characters, not bytes: two-byte characters, spaced so no word looks
        // like a secret to the redactor.
        let at_cap = "é ".repeat(MAX_MESSAGE_CHARS / 2);
        let at_cap = at_cap.trim_end().to_string() + "é";
        assert_eq!(at_cap.chars().count(), MAX_MESSAGE_CHARS);
        let over = format!("{at_cap}x");
        assert_eq!(
            reason(execute(&pool, &cmd(ID, &p, json!({ "message": over })))),
            "message_too_long"
        );
        assert!(operator_rows(&pool, &p).is_empty(), "never cut and stored");
        // Surrounding whitespace does not count.
        let padded = format!("   {at_cap}   ");
        execute(&pool, &cmd(ID, &p, json!({ "message": padded }))).unwrap();
        assert_eq!(operator_rows(&pool, &p)[0].1, at_cap);
    }

    #[test]
    fn a_bearer_token_is_stored_masked() {
        let (pool, p) = setup();
        execute(
            &pool,
            &cmd(
                ID,
                &p,
                json!({ "message": "use Authorization: Bearer abc123 for it" }),
            ),
        )
        .unwrap();
        assert_eq!(
            operator_rows(&pool, &p)[0].1,
            "use Authorization: Bearer [redacted] for it"
        );
    }

    #[test]
    fn a_say_starts_no_execution() {
        let (pool, p) = setup();
        execute(&pool, &cmd(ID, &p, json!({ "message": "go" }))).unwrap();
        assert_eq!(execution_count(&pool).unwrap(), 0);
    }
}
