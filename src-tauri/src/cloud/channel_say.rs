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
//!   is `message_too_long` - refused, never cut. The bound is on the INPUT:
//!   masking can make the stored body longer than it.
//! * Then, in order: the persona exists here, else `not_found`; it is the
//!   App Master a headless loop reads ([`is_loop_read_master`]: it holds a
//!   non-retired charter bound to a project, and for at least one such project
//!   it is the newest persona named `App Master%` with a charter bound there),
//!   else `not_app_master`. The loop is the engine (operator decision
//!   2026-10-08) and it reads one persona per project, so a say to any other
//!   charter holder would be written where nobody reads it.
//! * A cap per paired controller: when that controller already has
//!   [`SAY_CAP`] or more says written in the last [`SAY_WINDOW_MINUTES`]
//!   minutes (counted from the database, any persona, this command's own row
//!   excluded), the say is `rate_limited`. A poll reads up to 50 rows, so
//!   without it one paired key could write 50 operator-voiced rows per poll.
//!   A say approved at the desk (no controller) is not capped.
//! * Effect: credential-looking tokens are masked with the sync redactor
//!   (`cloud::sync::redact::redact_text`, as `review_decide` does for phone
//!   notes), then ONE row is written through
//!   `team_channel::create_persona_channel_message` with `author_kind 'user'`,
//!   no `reply_to`, not failed, and `id` = the command id. A phone's row
//!   carries `author_id` = the controller id and `author_label` = `phone: <the
//!   trust list's name>` (`phone` when it has none); it is what the cap
//!   counts. A desk-approved row carries neither. A re-delivered command
//!   writes nothing: if that id is already this
//!   persona's user message, the command completes with `changed: false`. The
//!   desk's channel view is told through `PERSONA_CHANNEL_MESSAGE`.
//! * It starts NO execution: never `dispatch_channel_followup`, never
//!   `execute_persona_inner` (operator decision 2026-10-08: the in-app masters
//!   stay off and the headless loop is the engine).
//! * Completed: `{"messageId", "changed"}`, `result_ref` = the message id, no
//!   `execution_id`.

use serde_json::{json, Value};

use crate::cloud::remote_commands::{Authority, Effective, Outcome};
use crate::cloud::sync::redact::redact_text;
use crate::cloud::trust;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::team_channel as channel_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// The longest message a phone may say, in characters, after the trim.
pub const MAX_MESSAGE_CHARS: usize = 2000;

/// The most says one paired controller may have written in the last
/// [`SAY_WINDOW_MINUTES`]; one more is `rate_limited`.
pub const SAY_CAP: i64 = 10;

/// The sliding window of [`SAY_CAP`], in minutes.
pub const SAY_WINDOW_MINUTES: i64 = 10;

/// A validated `channel_say`, ready to write.
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelSayPlan {
    /// The App Master persona the message is for.
    pub persona_id: String,
    /// The row id: the command id.
    pub message_id: String,
    /// The trimmed, masked body.
    pub body: String,
    /// The paired controller that said it; `None` when approved at the desk.
    pub author_id: Option<String>,
    /// `phone: <controller name>` (or `phone`) with a controller, else `None`.
    pub author_label: Option<String>,
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

/// The author of a phone's say, `(controller id, label)`, once its cap allows
/// one more; `None` for a say approved at the desk, which is never capped.
fn phone_author(
    pool: &DbPool,
    cmd: &Effective,
    authority: &Authority,
) -> Result<Option<(String, String)>, AppError> {
    let Authority::Paired { controller_id, .. } = authority else {
        return Ok(None);
    };
    let said = channel_repo::count_user_messages_by_author_since(
        pool,
        controller_id,
        SAY_WINDOW_MINUTES,
        &cmd.id,
    )?;
    if said >= SAY_CAP {
        return Err(AppError::Validation("rate_limited".into()));
    }
    let label = trust::load_controllers(pool)
        .into_iter()
        .find(|c| c.controller_id.eq_ignore_ascii_case(controller_id))
        .map(|c| c.name.trim().to_string())
        .filter(|name| !name.is_empty())
        .map_or_else(|| "phone".to_string(), |name| format!("phone: {name}"));
    Ok(Some((controller_id.clone(), label)))
}

/// Whether `persona_id` is the App Master a headless loop reads for at least
/// one project.
///
/// The headless loop reads ONE persona per project:
/// `.claude/skills/appmaster/lib/dbread.mjs` `masterPersona` (lines 130-139)
/// takes the newest persona (`created_at`) whose name is `LIKE 'App Master%'`
/// among those holding a charter (of any status) bound to the project. This is
/// that rule, plus the persona's own charter on that project being
/// non-retired. On an exact `created_at` tie, where `masterPersona`'s pick is
/// unspecified, each of the tied personas passes.
pub(crate) fn is_loop_read_master(pool: &DbPool, persona_id: &str) -> Result<bool, AppError> {
    let read: bool = pool.get()?.query_row(
        "SELECT EXISTS (
           SELECT 1
           FROM persona_responsibilities mine
           JOIN personas me ON me.id = mine.persona_id
           WHERE mine.persona_id = ?1
             AND mine.status != 'retired'
             AND TRIM(COALESCE(mine.project_id, '')) != ''
             AND me.name LIKE 'App Master%'
             AND NOT EXISTS (
               SELECT 1 FROM personas newer
               WHERE newer.name LIKE 'App Master%'
                 AND newer.created_at > me.created_at
                 AND newer.id IN (
                   SELECT r.persona_id FROM persona_responsibilities r
                   WHERE r.project_id = mine.project_id))
         ) AS is_read",
        [persona_id],
        |r| r.get("is_read"),
    )?;
    Ok(read)
}

/// Every precondition of the contract above, from the database alone.
pub fn plan(
    pool: &DbPool,
    cmd: &Effective,
    authority: &Authority,
) -> Result<ChannelSayPlan, AppError> {
    let message = message_of(&cmd.params)?;
    let persona_id = cmd.persona_id.as_deref().unwrap_or_default().trim();
    if persona_id.is_empty() {
        return Err(AppError::NotFound("Persona".into()));
    }
    let persona = persona_repo::get_by_id(pool, persona_id)?;
    if !is_loop_read_master(pool, &persona.id)? {
        return Err(AppError::Validation("not_app_master".into()));
    }
    let author = phone_author(pool, cmd, authority)?;
    Ok(ChannelSayPlan {
        persona_id: persona.id,
        message_id: cmd.id.clone(),
        body: redact_text(&message),
        author_label: author.as_ref().map(|(_, label)| label.clone()),
        author_id: author.map(|(id, _)| id),
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
pub fn execute(pool: &DbPool, cmd: &Effective, authority: &Authority) -> Result<Outcome, AppError> {
    let plan = plan(pool, cmd, authority)?;
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
            author_id: plan.author_id.clone(),
            author_label: plan.author_label.clone(),
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
    use crate::db::repos::core::responsibilities::{self, CreateResponsibilityInput};

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
        charter_in(pool, persona, project, None, "active");
    }

    /// Make the harness persona `persona` an App Master the loop reads for
    /// `project`: named `App Master`, with an active charter bound there.
    pub(crate) fn app_master(pool: &DbPool, persona: &str, project: &str) {
        pool.get()
            .unwrap()
            .execute(
                "UPDATE personas SET name = 'App Master' WHERE id = ?1",
                [persona],
            )
            .unwrap();
        charter(pool, persona, Some(project));
    }

    /// One charter on `persona`, bound as given, in `status`.
    fn charter_in(
        pool: &DbPool,
        persona: &str,
        project: Option<&str>,
        workspace: Option<&str>,
        status: &str,
    ) {
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
                status,
                project_id: project,
                workspace_id: workspace,
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

    /// A say approved at the desk: no controller, never capped.
    fn desk(pool: &DbPool, c: &Effective) -> Result<Outcome, AppError> {
        execute(pool, c, &Authority::OperatorApproved)
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

    /// The row's `(author_id, author_label)`.
    pub(crate) fn author_of(pool: &DbPool, id: &str) -> (Option<String>, Option<String>) {
        pool.get()
            .unwrap()
            .query_row(
                "SELECT author_id, author_label FROM team_channel_messages WHERE id = ?1",
                [id],
                |r| Ok((r.get("author_id")?, r.get("author_label")?)),
            )
            .unwrap()
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
        let o = desk(
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
        desk(&pool, &c).unwrap();
        let again = desk(&pool, &c).unwrap();
        assert_eq!(again.result, json!({ "messageId": ID, "changed": false }));
        assert_eq!(operator_rows(&pool, &p).len(), 1);
    }

    #[test]
    fn an_id_already_held_by_another_message_is_never_adopted() {
        let (pool, p) = setup();
        let other = persona(&pool, "App Master (other)");
        charter(&pool, &other, Some("proj_other"));
        desk(&pool, &cmd(ID, &other, json!({ "message": "theirs" }))).unwrap();
        let e = desk(&pool, &cmd(ID, &p, json!({ "message": "mine" }))).unwrap_err();
        assert!(matches!(e, AppError::Internal(_)), "{e:?}");
        assert!(operator_rows(&pool, &p).is_empty());
    }

    #[test]
    fn a_persona_without_a_bound_charter_is_not_an_app_master() {
        let pool = crate::db::init_test_db().unwrap();
        let plain = persona(&pool, "Plain");
        assert_eq!(
            reason(desk(&pool, &cmd(ID, &plain, json!({ "message": "hi" })))),
            "not_app_master"
        );
        charter(&pool, &plain, None);
        assert_eq!(
            reason(desk(&pool, &cmd(ID, &plain, json!({ "message": "hi" })))),
            "not_app_master",
            "an unbound charter is not enough"
        );
        assert!(operator_rows(&pool, &plain).is_empty());
    }

    fn born(pool: &DbPool, persona: &str, at: &str) {
        pool.get()
            .unwrap()
            .execute(
                "UPDATE personas SET created_at = ?1 WHERE id = ?2",
                [at, persona],
            )
            .unwrap();
    }

    fn says(pool: &DbPool, persona: &str, id: &str) -> String {
        match desk(pool, &cmd(id, persona, json!({ "message": "hi" }))) {
            Ok(_) => "accepted".into(),
            other => reason(other),
        }
    }

    #[test]
    fn only_the_newest_app_master_of_a_project_is_read() {
        let pool = crate::db::init_test_db().unwrap();
        let older = persona(&pool, "App Master");
        let newer = persona(&pool, "App Master v2");
        charter(&pool, &older, Some("proj_web"));
        charter(&pool, &newer, Some("proj_web"));
        born(&pool, &older, "2026-10-01T09:00:00.000Z");
        born(&pool, &newer, "2026-10-05T09:00:00.000Z");

        assert_eq!(says(&pool, &older, &say_id(1)), "not_app_master");
        assert!(operator_rows(&pool, &older).is_empty());
        assert_eq!(says(&pool, &newer, &say_id(2)), "accepted");

        // The older one is still read for a project nobody newer holds.
        charter(&pool, &older, Some("proj_docs"));
        assert_eq!(says(&pool, &older, &say_id(3)), "accepted");
    }

    #[test]
    fn a_retired_charter_does_not_make_a_persona_read() {
        let pool = crate::db::init_test_db().unwrap();
        let p = persona(&pool, "App Master");
        charter_in(&pool, &p, Some("proj_web"), None, "retired");
        assert_eq!(says(&pool, &p, &say_id(1)), "not_app_master");
    }

    #[test]
    fn a_persona_bound_only_to_a_workspace_is_refused() {
        let pool = crate::db::init_test_db().unwrap();
        let p = persona(&pool, "App Master");
        charter_in(&pool, &p, None, Some("ws_studio"), "active");
        // The engine's wider rule calls it an App Master; no loop reads it.
        let charters = responsibilities::list_by_persona(&pool, &p, false).unwrap();
        let refs: Vec<_> = charters.iter().collect();
        assert!(crate::engine::subscription::is_app_master(&refs));
        assert_eq!(says(&pool, &p, &say_id(1)), "not_app_master");
    }

    #[test]
    fn a_bound_persona_not_named_app_master_is_refused() {
        let pool = crate::db::init_test_db().unwrap();
        let p = persona(&pool, "Release Captain");
        charter(&pool, &p, Some("proj_web"));
        assert_eq!(says(&pool, &p, &say_id(1)), "not_app_master");
        assert!(operator_rows(&pool, &p).is_empty());
    }

    #[test]
    fn an_unknown_or_missing_persona_is_not_found() {
        let (pool, _) = setup();
        let send = |c: Effective| reason(desk(&pool, &c));
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
        let send = |v: Value| reason(desk(&pool, &cmd(ID, &p, v)));
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
            reason(desk(&pool, &cmd(ID, &p, json!({ "message": over })))),
            "message_too_long"
        );
        assert!(operator_rows(&pool, &p).is_empty(), "never cut and stored");
        // Surrounding whitespace does not count.
        let padded = format!("   {at_cap}   ");
        desk(&pool, &cmd(ID, &p, json!({ "message": padded }))).unwrap();
        assert_eq!(operator_rows(&pool, &p)[0].1, at_cap);
    }

    #[test]
    fn a_bearer_token_is_stored_masked() {
        let (pool, p) = setup();
        desk(
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

    const CTL: &str = "0c2b9a8f-7e6d-4c5b-8a49-3827160f5e4d";

    /// A say from the paired controller `ctl`.
    fn phone(pool: &DbPool, c: &Effective, ctl: &str) -> Result<Outcome, AppError> {
        let authority = Authority::Paired {
            controller_id: ctl.into(),
            valid_until: chrono::Utc::now() + chrono::Duration::seconds(60),
        };
        execute(pool, c, &authority)
    }

    fn pair(pool: &DbPool, ctl: &str, name: &str) {
        trust::add_controller(
            pool,
            trust::Controller {
                controller_id: ctl.into(),
                name: name.into(),
                public_key: "unused-by-the-cap".into(),
                created_at: "2026-10-08T09:00:00Z".into(),
                revoked: false,
                revoked_at: None,
            },
        )
        .unwrap();
    }

    fn say_id(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }

    fn backdate(pool: &DbPool, id: &str, modifier: &str) {
        pool.get()
            .unwrap()
            .execute(
                "UPDATE team_channel_messages SET created_at = datetime('now', ?1) WHERE id = ?2",
                rusqlite::params![modifier, id],
            )
            .unwrap();
    }

    #[test]
    fn a_phone_say_carries_the_controller_as_its_author() {
        let (pool, p) = setup();
        pair(&pool, CTL, "  Pixel 9  ");
        phone(
            &pool,
            &cmd(ID, &p, json!({ "message": "from the phone" })),
            CTL,
        )
        .unwrap();
        assert_eq!(channel_repo::get(&pool, ID).unwrap().author_kind, "user");
        assert_eq!(
            author_of(&pool, ID),
            (Some(CTL.into()), Some("phone: Pixel 9".into()))
        );
        // The headless master still reads it as the operator's voice.
        assert_eq!(operator_rows(&pool, &p).len(), 1);

        // A controller missing from the trust list is labelled plainly.
        phone(
            &pool,
            &cmd(&say_id(1), &p, json!({ "message": "again" })),
            "c-unlisted",
        )
        .unwrap();
        assert_eq!(author_of(&pool, &say_id(1)).1.as_deref(), Some("phone"));

        // A desk-approved say carries no author at all.
        desk(&pool, &cmd(&say_id(2), &p, json!({ "message": "desk" }))).unwrap();
        assert_eq!(author_of(&pool, &say_id(2)), (None, None));
    }

    #[test]
    fn a_controller_is_capped_at_ten_says_in_ten_minutes() {
        let (pool, p) = setup();
        for n in 0..SAY_CAP as usize {
            phone(&pool, &cmd(&say_id(n), &p, json!({ "message": "go" })), CTL).unwrap();
        }
        let eleventh = cmd(&say_id(99), &p, json!({ "message": "one more" }));
        assert_eq!(reason(phone(&pool, &eleventh, CTL)), "rate_limited");
        assert_eq!(
            operator_rows(&pool, &p).len(),
            SAY_CAP as usize,
            "nothing written"
        );

        // A re-delivery of a say already written still settles unchanged.
        let o = phone(&pool, &cmd(&say_id(0), &p, json!({ "message": "go" })), CTL).unwrap();
        assert_eq!(o.result["changed"], json!(false));

        // The cap is per controller, and the desk is never capped.
        phone(&pool, &eleventh, "another-phone").unwrap();
        desk(&pool, &cmd(&say_id(98), &p, json!({ "message": "desk" }))).unwrap();

        // The window slides: once a say is older than ten minutes, one more fits.
        backdate(&pool, &say_id(1), "-11 minutes");
        phone(
            &pool,
            &cmd(&say_id(97), &p, json!({ "message": "later" })),
            CTL,
        )
        .unwrap();
        assert_eq!(
            reason(phone(
                &pool,
                &cmd(&say_id(96), &p, json!({ "message": "x" })),
                CTL
            )),
            "rate_limited"
        );
    }

    #[test]
    fn a_say_starts_no_execution() {
        let (pool, p) = setup();
        desk(&pool, &cmd(ID, &p, json!({ "message": "go" }))).unwrap();
        assert_eq!(execution_count(&pool).unwrap(), 0);
    }
}
