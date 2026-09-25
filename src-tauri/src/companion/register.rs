//! Reply register: how long Athena's layer-one reply may be.
//!
//! Layer one of the layered voice is a short reply of at most N sentences,
//! with natural-language reference links into layer two (reports, decisions,
//! cards, sessions, jobs, memories). N starts at [`LAYER_ONE_BASE_SENTENCES`]
//! and adapts: the operator can pin it, and the reflection pass can move it
//! (`adjust_register` op), per scope. `scope = "default"` is the global
//! register; any other scope is a topic override.
//!
//! Contract: `docs/features/companion/layered-voice.md`. Storage:
//! `companion_reply_register` in the companion USER database (`COMPANION_SCHEMA`
//! in `src-tauri/db/src/lib.rs`), next to `companion_chat_card`.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::UserDbPool;
use crate::error::AppError;

/// The register a fresh install starts with, and the fallback when the
/// `default` row is missing or unreadable.
pub const LAYER_ONE_BASE_SENTENCES: u8 = 3;

/// Inclusive bounds the table's CHECK constraint also enforces.
pub const MIN_SENTENCES: u8 = 1;
pub const MAX_SENTENCES: u8 = 8;

/// The scope name of the global register.
pub const DEFAULT_SCOPE: &str = "default";

/// Who set a register row.
pub const VALID_SOURCES: &[&str] = &["operator", "reflection"];

/// Longest scope name accepted. A topic is a short label, not a sentence.
const MAX_SCOPE_CHARS: usize = 64;

/// Longest stored reason.
const MAX_REASON_CHARS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReplyRegisterRow {
    pub scope: String,
    #[ts(type = "number")]
    pub sentences: u8,
    /// `operator` | `reflection`.
    pub source: String,
    pub reason: Option<String>,
    pub updated_at: String,
}

/// The register the prompt composer applies this turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveRegister {
    /// The `default` row's value, or [`LAYER_ONE_BASE_SENTENCES`].
    pub default_sentences: u8,
    /// Every non-default scope, as `(scope, sentences)`, sorted by scope.
    pub overrides: Vec<(String, u8)>,
}

/// All register rows, `default` first, then topics alphabetically.
pub fn list(pool: &UserDbPool) -> Result<Vec<ReplyRegisterRow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT scope, sentences, source, reason, updated_at
           FROM companion_reply_register
          ORDER BY CASE WHEN scope = 'default' THEN 0 ELSE 1 END, scope",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let sentences: i64 = r.get("sentences")?;
            Ok(ReplyRegisterRow {
                scope: r.get("scope")?,
                // The CHECK constraint holds it to 1..=8; clamp rather than
                // trust, so a hand-edited row cannot wrap.
                sentences: sentences.clamp(MIN_SENTENCES as i64, MAX_SENTENCES as i64) as u8,
                source: r.get("source")?,
                reason: r.get("reason")?,
                updated_at: r.get("updated_at")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert or replace one scope's register.
pub fn upsert(
    pool: &UserDbPool,
    scope: &str,
    sentences: u8,
    source: &str,
    reason: Option<&str>,
) -> Result<(), AppError> {
    let scope = scope.trim();
    personas_core::validation::require_non_empty("reply register scope", scope)?;
    if scope.chars().count() > MAX_SCOPE_CHARS {
        return Err(AppError::Validation(format!(
            "reply register: scope exceeds {MAX_SCOPE_CHARS} characters"
        )));
    }
    if !(MIN_SENTENCES..=MAX_SENTENCES).contains(&sentences) {
        return Err(AppError::Validation(format!(
            "reply register: sentences must be {MIN_SENTENCES}..={MAX_SENTENCES}, got {sentences}"
        )));
    }
    if !VALID_SOURCES.contains(&source) {
        return Err(AppError::Validation(format!(
            "reply register: unknown source `{source}`"
        )));
    }
    let reason: Option<String> = reason
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(|r| r.chars().take(MAX_REASON_CHARS).collect());

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_reply_register (scope, sentences, source, reason, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(scope) DO UPDATE SET
             sentences  = excluded.sentences,
             source     = excluded.source,
             reason     = excluded.reason,
             updated_at = excluded.updated_at",
        params![scope, sentences as i64, source, reason],
    )?;
    Ok(())
}

/// The register to apply. Never fails: an unreadable table degrades to the
/// base register with no overrides, because a reply must still be composed.
pub fn effective(pool: &UserDbPool) -> EffectiveRegister {
    let rows = match list(pool) {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "reply register unreadable; using the base register");
            Vec::new()
        }
    };
    let mut default_sentences = LAYER_ONE_BASE_SENTENCES;
    let mut overrides = Vec::new();
    for row in rows {
        if row.scope == DEFAULT_SCOPE {
            default_sentences = row.sentences;
        } else {
            overrides.push((row.scope, row.sentences));
        }
    }
    overrides.sort_by(|a, b| a.0.cmp(&b.0));
    EffectiveRegister {
        default_sentences,
        overrides,
    }
}

/// Normalise a scope name the way every writer stores it: trimmed,
/// lower-cased, inner whitespace collapsed to one space. "Fleet  Updates" and
/// "fleet updates" are one topic, never two rows that disagree.
pub fn normalize_scope(scope: &str) -> String {
    scope
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Apply one `adjust_register` op (operator-asked in chat, or a reflection
/// proposal the operator approved). The dispatcher hands the op's raw JSON
/// values through; this is the one place they are validated, so the op and
/// the approval card cannot disagree about what a legal register is.
///
/// `sentences` is `i64` because it arrives from JSON: an out-of-range number
/// is a validation error here, never a silent wrap into `u8`. Returns the row
/// as stored.
pub fn apply_op(
    pool: &UserDbPool,
    scope: &str,
    sentences: i64,
    reason: Option<&str>,
    source: &str,
) -> Result<ReplyRegisterRow, AppError> {
    let scope = normalize_scope(scope);
    if !(MIN_SENTENCES as i64..=MAX_SENTENCES as i64).contains(&sentences) {
        return Err(AppError::Validation(format!(
            "reply register: sentences must be {MIN_SENTENCES}..={MAX_SENTENCES}, got {sentences}"
        )));
    }
    upsert(pool, &scope, sentences as u8, source, reason)?;
    list(pool)?
        .into_iter()
        .find(|r| r.scope == scope)
        .ok_or_else(|| {
            AppError::Internal(format!(
                "reply register: row `{scope}` missing right after its upsert"
            ))
        })
}

/// Most topic overrides the per-turn flag renders. A register is a handful of
/// topics; past this the flag would become a second rulebook.
const MAX_FLAG_OVERRIDES: usize = 8;

/// The one-line per-turn flag every turn carries:
/// `Layer one this turn: at most 3 sentences. Topic overrides: fleet updates 5.`
/// The RULES live in the static core (chat core / constitution, `# Layer
/// one`); this line only states the number, so the cached prefix never
/// changes when the register does.
pub fn layer_one_flag(reg: &EffectiveRegister) -> String {
    let mut s = format!(
        "\n\nLayer one this turn: at most {} sentence{}.",
        reg.default_sentences,
        if reg.default_sentences == 1 { "" } else { "s" }
    );
    if !reg.overrides.is_empty() {
        let topics: Vec<String> = reg
            .overrides
            .iter()
            .take(MAX_FLAG_OVERRIDES)
            .map(|(scope, n)| format!("{scope} {n}"))
            .collect();
        s.push_str(" Topic overrides: ");
        s.push_str(&topics.join(", "));
        s.push('.');
    }
    s.push('\n');
    s
}

// ---------------------------------------------------------------------------
// Reflection proposals: signals that the register is wrong for him.
// ---------------------------------------------------------------------------

/// How far back a proposal looks.
pub const SIGNAL_WINDOW_DAYS: i64 = 7;

/// How many matching asks in the window make a signal. One "tell me more" is
/// a conversation; three in a week is a register.
pub const MIN_ASK_SIGNALS: usize = 3;

/// Reports opened at or above this rate mean he wants the detail.
pub const REPORT_OPEN_RATE: f64 = 0.8;

/// Fewest reports in the window before the open rate means anything. Two of
/// two opened is not a habit.
pub const MIN_REPORTS_FOR_RATE: u32 = 3;

/// Episodes read per scan. A week of conversation fits comfortably; the cap
/// only bounds a pathological week.
const SIGNAL_SCAN_LIMIT: u32 = 600;

/// One conversation message as the detector reads it. Callers pass them
/// grouped by session, oldest-first within each.
#[derive(Debug, Clone)]
pub struct SignalMessage {
    pub session_id: String,
    /// `user` | `assistant` | `system`.
    pub role: String,
    pub content: String,
}

/// What the window says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RegisterSignals {
    /// User messages asking for more, each right after an assistant reply.
    pub more_asks: usize,
    /// User messages asking for less, each right after an assistant reply.
    pub less_asks: usize,
    /// Reports created in the window.
    pub reports_total: u32,
    /// Of those, how many he opened.
    pub reports_read: u32,
}

/// A register change the reflection pass may put in front of him. It goes
/// through the existing approval path as an `adjust_register` action with
/// [`RegisterProposal::params`]; nothing is applied until he approves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisterProposal {
    pub scope: String,
    pub sentences: u8,
    /// Stored on the row when approved.
    pub reason: String,
    /// The one honest sentence the approval card shows.
    pub rationale: String,
}

impl RegisterProposal {
    /// The `params` of the `adjust_register` approval action, in the op's own
    /// shape (`{"scope","sentences","reason"}`), so the executor reads a
    /// reflection proposal and a chat op identically.
    pub fn params(&self) -> serde_json::Value {
        serde_json::json!({
            "scope": self.scope,
            "sentences": self.sentences,
            "reason": self.reason,
        })
    }
}

fn more_detail_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        // INVARIANT: a literal pattern that compiles; the detector tests run it.
        regex::Regex::new(r"(?i)more detail|tell me more|\bexpand\b|explain more|go deeper")
            .expect("literal regex")
    })
}

fn less_detail_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        // INVARIANT: a literal pattern that compiles; the detector tests run it.
        regex::Regex::new(r"(?i)\bshorter\b|too long|\btl;?dr\b").expect("literal regex")
    })
}

/// Count the ask signals in `messages` as `(more, less)`. Only a user message
/// that directly follows an assistant reply in the same session counts: "tell
/// me more" as an opener is a request about a topic, not a verdict on the
/// reply before it.
pub fn count_ask_signals(messages: &[SignalMessage]) -> (usize, usize) {
    let (mut more, mut less) = (0, 0);
    let mut prev: Option<&SignalMessage> = None;
    for m in messages {
        let follows_reply =
            matches!(prev, Some(p) if p.session_id == m.session_id && p.role == "assistant");
        if m.role == "user" && follows_reply {
            let wants_more = more_detail_re().is_match(&m.content);
            let wants_less = less_detail_re().is_match(&m.content);
            // A message asking for both is noise, not a verdict.
            if wants_more && !wants_less {
                more += 1;
            } else if wants_less && !wants_more {
                less += 1;
            }
        }
        prev = Some(m);
    }
    (more, less)
}

/// Decide whether the signals justify a proposal against the current
/// register. Pure: the DB half is [`propose_from_recent`].
///
/// More: at least [`MIN_ASK_SIGNALS`] "more detail" asks, or reports opened at
/// [`REPORT_OPEN_RATE`] or above (over at least [`MIN_REPORTS_FOR_RATE`]).
/// Less: at least [`MIN_ASK_SIGNALS`] "shorter" asks. Both at once is a
/// contradiction and proposes nothing. A proposal moves the default register
/// one sentence, never past the bounds.
pub fn proposal_from_signals(
    current: &EffectiveRegister,
    signals: &RegisterSignals,
) -> Option<RegisterProposal> {
    let rate_says_more = signals.reports_total >= MIN_REPORTS_FOR_RATE
        && f64::from(signals.reports_read) / f64::from(signals.reports_total) >= REPORT_OPEN_RATE;
    let wants_more = signals.more_asks >= MIN_ASK_SIGNALS || rate_says_more;
    let wants_less = signals.less_asks >= MIN_ASK_SIGNALS;
    let now = current.default_sentences;
    match (wants_more, wants_less) {
        (true, false) if now < MAX_SENTENCES => {
            let mut evidence = Vec::new();
            if signals.more_asks >= MIN_ASK_SIGNALS {
                evidence.push(format!(
                    "{} times this week you asked for more right after a reply",
                    signals.more_asks
                ));
            }
            if rate_says_more {
                evidence.push(format!(
                    "you opened {} of my last {} reports",
                    signals.reports_read, signals.reports_total
                ));
            }
            let reason = evidence.join("; ");
            Some(RegisterProposal {
                scope: DEFAULT_SCOPE.to_string(),
                sentences: now + 1,
                rationale: format!(
                    "Let my short replies run to {} sentences instead of {now}: {reason}.",
                    now + 1
                ),
                reason,
            })
        }
        (false, true) if now > MIN_SENTENCES => {
            let reason = format!(
                "{} times this week you asked for shorter right after a reply",
                signals.less_asks
            );
            Some(RegisterProposal {
                scope: DEFAULT_SCOPE.to_string(),
                sentences: now - 1,
                rationale: format!(
                    "Keep my short replies to {} sentences instead of {now}: {reason}.",
                    now - 1
                ),
                reason,
            })
        }
        _ => None,
    }
}

/// Reports created in the last `days`, and how many of them he opened, as
/// `(total, read)`.
pub fn report_read_counts(pool: &UserDbPool, days: i64) -> Result<(u32, u32), AppError> {
    let conn = pool.get()?;
    let since = crate::companion::brain::sim_clock::days_ago_sql(days);
    let (total, read): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END), 0)
           FROM companion_chat_card
          WHERE kind = 'report' AND created_at >= ?1",
        params![since],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((total.max(0) as u32, read.max(0) as u32))
}

/// Gather the last [`SIGNAL_WINDOW_DAYS`] of signals and return a proposal if
/// they justify one. The caller owns what happens next (an approval card with
/// action `adjust_register` and [`RegisterProposal::params`]); this function
/// writes nothing.
pub fn propose_from_recent(pool: &UserDbPool) -> Result<Option<RegisterProposal>, AppError> {
    let since = (crate::companion::brain::sim_clock::now()
        - chrono::Duration::days(SIGNAL_WINDOW_DAYS))
    .format("%Y-%m-%dT%H:%M:%SZ")
    .to_string();
    let mut messages: Vec<SignalMessage> =
        crate::companion::brain::episodic::list_conversation_after(
            pool,
            &since,
            SIGNAL_SCAN_LIMIT,
        )?
        .into_iter()
        .map(|e| SignalMessage {
            session_id: e.session_id,
            role: e.role,
            content: e.content,
        })
        .collect();
    // The read is oldest-first across every conversation; the detector needs
    // each session's run contiguous. A stable sort keeps time order inside it.
    messages.sort_by(|a, b| a.session_id.cmp(&b.session_id));
    let (more_asks, less_asks) = count_ask_signals(&messages);
    let (reports_total, reports_read) = report_read_counts(pool, SIGNAL_WINDOW_DAYS)?;
    Ok(proposal_from_signals(
        &effective(pool),
        &RegisterSignals {
            more_asks,
            less_asks,
            reports_total,
            reports_read,
        },
    ))
}

// ---------------------------------------------------------------------------
// The reflection hook: file a proposal as an approval card, weekly.
// ---------------------------------------------------------------------------

/// Days between two reflection passes.
const REFLECTION_INTERVAL_DAYS: i64 = 7;

/// The approval action a reflection proposal is filed under. The executor
/// (`execute_adjust_register`) applies it with source `reflection`.
const ADJUST_REGISTER_ACTION: &str = "adjust_register";

/// Run the reply-register reflection pass if it is due and put its proposal,
/// if any, in front of him as ONE pending `adjust_register` approval, then
/// emit the registered approvals event (`event_name::COMPANION_APPROVALS`,
/// the same wire name `profile_synthesis::propose_identity_update` emits). Best-effort: called from the proactive tick next to
/// `maybe_run_synthesis`; a failure logs and is swallowed.
///
/// Not gated by `companion_profile_synthesis`: that toggle guards a CLI call
/// that rewrites identity text. This pass is deterministic, costs one local
/// read, and only files a card he must approve.
pub fn maybe_propose_register(
    user_db: &UserDbPool,
    sys_db: &crate::db::DbPool,
    app: &tauri::AppHandle,
) {
    use tauri::Emitter;
    match run_reflection_pass(user_db, sys_db) {
        Ok(Some(created)) => {
            if let Err(e) = app.emit(
                crate::engine::event_registry::event_name::COMPANION_APPROVALS,
                vec![created],
            ) {
                tracing::warn!(error = %e, "register reflection: approvals event emit failed");
            }
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(error = %e, "register reflection: pass failed"),
    }
}

/// The pass without the event: cadence gate, stamp, pending-dedupe, proposal,
/// insert. Returns the approval it filed, if any.
fn run_reflection_pass(
    user_db: &UserDbPool,
    sys_db: &crate::db::DbPool,
) -> Result<Option<crate::companion::dispatcher::CreatedApproval>, AppError> {
    use crate::companion::brain::sim_clock;
    use crate::db::repos::core::settings;
    use crate::db::settings_keys as keys;

    // Cadence: at most once per REFLECTION_INTERVAL_DAYS. An unparseable
    // stamp counts as "never ran".
    if let Some(last) = settings::get(sys_db, keys::COMPANION_REGISTER_REFLECTION_LAST)? {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&last) {
            let age = sim_clock::now() - dt.with_timezone(&chrono::Utc);
            if age.num_days() < REFLECTION_INTERVAL_DAYS {
                return Ok(None);
            }
        }
    }
    // Stamp NOW, before the work, so a failing read cannot re-fire every tick.
    settings::set(
        sys_db,
        keys::COMPANION_REGISTER_REFLECTION_LAST,
        &sim_clock::now().to_rfc3339(),
    )?;

    // One open proposal at a time: a second card would ask the same question.
    let pending: bool = user_db.get()?.query_row(
        "SELECT EXISTS(SELECT 1 FROM companion_approval
                        WHERE status = 'pending'
                          AND json_extract(payload, '$.action') = ?1)",
        params![ADJUST_REGISTER_ACTION],
        |r| r.get(0),
    )?;
    if pending {
        return Ok(None);
    }

    let Some(proposal) = propose_from_recent(user_db)? else {
        return Ok(None);
    };
    insert_register_approval(user_db, &proposal).map(Some)
}

/// Insert one pending `adjust_register` approval carrying the proposal
/// (the same INSERT as `profile_synthesis::insert_identity_approval`).
fn insert_register_approval(
    pool: &UserDbPool,
    proposal: &RegisterProposal,
) -> Result<crate::companion::dispatcher::CreatedApproval, AppError> {
    // The full 122-bit UUID, not a 12-hex truncation: an approval id is a primary
    // key in a table that only grows (docs/concepts/golden-paths/id-generation.md).
    let id = format!("appr_{}", uuid::Uuid::new_v4().simple());
    let params_value = proposal.params();
    let payload = serde_json::json!({
        "action": ADJUST_REGISTER_ACTION,
        "params": params_value,
        "rationale": proposal.rationale,
    })
    .to_string();
    pool.get()?.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', NULL, ?4)",
        params![
            id,
            crate::companion::session::DEFAULT_SESSION_ID,
            payload,
            crate::companion::brain::sim_clock::now_sql()
        ],
    )?;
    Ok(crate::companion::dispatcher::CreatedApproval {
        id,
        action: ADJUST_REGISTER_ACTION.to_string(),
        params_json: params_value.to_string(),
        rationale: proposal.rationale.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool() -> Result<UserDbPool, AppError> {
        crate::db::init_test_user_db()
    }

    #[test]
    fn register_is_base_when_empty() -> Result<(), AppError> {
        let pool = pool()?;
        assert!(list(&pool)?.is_empty());
        assert_eq!(
            effective(&pool),
            EffectiveRegister {
                default_sentences: LAYER_ONE_BASE_SENTENCES,
                overrides: Vec::new(),
            }
        );
        Ok(())
    }

    #[test]
    fn register_upsert_replaces_and_orders_default_first() -> Result<(), AppError> {
        let pool = pool()?;
        upsert(&pool, "zeta", 5, "reflection", Some("long answers wanted"))?;
        upsert(&pool, "default", 2, "operator", None)?;
        upsert(&pool, "alpha", 4, "operator", Some("  "))?;
        upsert(&pool, "default", 3, "reflection", Some("back to base"))?;

        let rows = list(&pool)?;
        let scopes: Vec<&str> = rows.iter().map(|r| r.scope.as_str()).collect();
        assert_eq!(scopes, ["default", "alpha", "zeta"]);
        assert_eq!(rows[0].sentences, 3);
        assert_eq!(rows[0].source, "reflection");
        assert_eq!(rows[0].reason.as_deref(), Some("back to base"));
        // A blank reason is stored as absent, not as an empty string.
        assert_eq!(rows[1].reason, None);

        let eff = effective(&pool);
        assert_eq!(eff.default_sentences, 3);
        assert_eq!(
            eff.overrides,
            vec![("alpha".to_string(), 4), ("zeta".to_string(), 5)]
        );
        Ok(())
    }

    #[test]
    fn register_upsert_rejects_out_of_contract_values() -> Result<(), AppError> {
        let pool = pool()?;
        assert!(upsert(&pool, "default", 0, "operator", None).is_err());
        assert!(upsert(&pool, "default", 9, "operator", None).is_err());
        assert!(upsert(&pool, "default", 3, "athena", None).is_err());
        assert!(upsert(&pool, "   ", 3, "operator", None).is_err());
        assert!(upsert(&pool, &"x".repeat(65), 3, "operator", None).is_err());
        assert!(list(&pool)?.is_empty());
        Ok(())
    }

    #[test]
    fn register_table_check_constraint_holds_without_the_validator() -> Result<(), AppError> {
        let pool = pool()?;
        let conn = pool.get()?;
        let bad_count = conn.execute(
            "INSERT INTO companion_reply_register (scope, sentences, source) VALUES ('x', 12, 'operator')",
            [],
        );
        assert!(bad_count.is_err());
        let bad_source = conn.execute(
            "INSERT INTO companion_reply_register (scope, sentences, source) VALUES ('x', 3, 'athena')",
            [],
        );
        assert!(bad_source.is_err());
        Ok(())
    }

    #[test]
    fn register_apply_op_validates_normalises_and_returns_the_row() -> Result<(), AppError> {
        let pool = pool()?;
        // Out of range, including a JSON number that would wrap a u8.
        for bad in [0_i64, 9, -1, 259] {
            assert!(apply_op(&pool, "default", bad, None, "operator").is_err());
        }
        assert!(apply_op(&pool, "   ", 3, None, "operator").is_err());
        assert!(apply_op(&pool, "default", 3, None, "athena").is_err());
        assert!(list(&pool)?.is_empty(), "a rejected op writes nothing");

        let row = apply_op(
            &pool,
            "  Fleet   Updates ",
            5,
            Some("he asked for more on fleet updates"),
            "operator",
        )?;
        assert_eq!(row.scope, "fleet updates");
        assert_eq!(row.sentences, 5);
        assert_eq!(row.source, "operator");
        // Same topic, other spelling: one row, replaced.
        apply_op(&pool, "fleet updates", 4, None, "reflection")?;
        let rows = list(&pool)?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sentences, 4);
        Ok(())
    }

    #[test]
    fn register_flag_states_the_number_and_the_overrides() -> Result<(), AppError> {
        let pool = pool()?;
        assert_eq!(
            layer_one_flag(&effective(&pool)),
            "\n\nLayer one this turn: at most 3 sentences.\n"
        );
        upsert(&pool, "default", 1, "operator", None)?;
        assert_eq!(
            layer_one_flag(&effective(&pool)),
            "\n\nLayer one this turn: at most 1 sentence.\n"
        );
        upsert(&pool, "default", 2, "operator", None)?;
        upsert(&pool, "fleet updates", 5, "operator", None)?;
        upsert(&pool, "briefs", 6, "reflection", None)?;
        assert_eq!(
            layer_one_flag(&effective(&pool)),
            "\n\nLayer one this turn: at most 2 sentences. Topic overrides: briefs 6, fleet updates 5.\n"
        );
        Ok(())
    }

    fn msg(session: &str, role: &str, content: &str) -> SignalMessage {
        SignalMessage {
            session_id: session.into(),
            role: role.into(),
            content: content.into(),
        }
    }

    #[test]
    fn register_signals_count_only_asks_right_after_a_reply() {
        let msgs = vec![
            // An opener is a topic request, not a verdict: not counted.
            msg("a", "user", "tell me more about the vault"),
            msg("a", "assistant", "It holds credentials."),
            msg("a", "user", "Tell me more"),
            msg("a", "assistant", "Sure."),
            msg("a", "user", "can you go deeper on that?"),
            msg("a", "assistant", "Here."),
            msg("a", "user", "tl;dr please"),
            msg("a", "assistant", "Short."),
            // Both at once is noise.
            msg("a", "user", "shorter, but tell me more about X"),
            msg("a", "system", "[fleet] something"),
            // Follows a system row, not a reply: not counted.
            msg("a", "user", "expand"),
            // A new session: the previous session's reply does not carry over.
            msg("b", "user", "more detail please"),
            msg("b", "assistant", "Ok."),
            msg("b", "user", "That was too long."),
            // `expanded` is not `expand`.
            msg("b", "assistant", "Ok."),
            msg("b", "user", "I expanded the tab"),
        ];
        assert_eq!(count_ask_signals(&msgs), (2, 2));
    }

    fn reg(n: u8) -> EffectiveRegister {
        EffectiveRegister {
            default_sentences: n,
            overrides: Vec::new(),
        }
    }

    #[test]
    fn register_proposal_needs_a_signal_and_respects_the_bounds() {
        let none = RegisterSignals::default();
        assert_eq!(proposal_from_signals(&reg(3), &none), None);

        let more = RegisterSignals {
            more_asks: 3,
            ..Default::default()
        };
        let p = proposal_from_signals(&reg(3), &more).expect("three asks propose");
        assert_eq!((p.scope.as_str(), p.sentences), ("default", 4));
        assert!(p.reason.contains("3 times"));
        assert_eq!(
            p.params(),
            serde_json::json!({"scope":"default","sentences":4,"reason":p.reason})
        );
        assert_eq!(proposal_from_signals(&reg(MAX_SENTENCES), &more), None);

        // Two asks are a conversation, not a register.
        let two = RegisterSignals {
            more_asks: 2,
            ..Default::default()
        };
        assert_eq!(proposal_from_signals(&reg(3), &two), None);

        // Reports opened: 4 of 5 is 80%, enough; 2 of 2 is too few to mean it.
        let opened = RegisterSignals {
            reports_total: 5,
            reports_read: 4,
            ..Default::default()
        };
        let p = proposal_from_signals(&reg(3), &opened).expect("80% opened proposes");
        assert_eq!(p.sentences, 4);
        assert!(p.rationale.contains("4 of my last 5 reports"));
        let few = RegisterSignals {
            reports_total: 2,
            reports_read: 2,
            ..Default::default()
        };
        assert_eq!(proposal_from_signals(&reg(3), &few), None);

        let less = RegisterSignals {
            less_asks: 4,
            ..Default::default()
        };
        assert_eq!(
            proposal_from_signals(&reg(3), &less).map(|p| p.sentences),
            Some(2)
        );
        assert_eq!(proposal_from_signals(&reg(MIN_SENTENCES), &less), None);

        // Contradicting signals propose nothing.
        let both = RegisterSignals {
            more_asks: 3,
            less_asks: 3,
            ..Default::default()
        };
        assert_eq!(proposal_from_signals(&reg(3), &both), None);
    }

    #[test]
    fn register_report_read_counts_reads_report_cards_only() -> Result<(), AppError> {
        let pool = pool()?;
        assert_eq!(report_read_counts(&pool, 7)?, (0, 0));
        let conn = pool.get()?;
        for (id, kind, status) in [
            ("r1", "report", "read"),
            ("r2", "report", "unread"),
            ("r3", "report", "read"),
            ("c1", "fleet_plan", "read"),
        ] {
            conn.execute(
                "INSERT INTO companion_chat_card (id, conversation_id, kind, status) VALUES (?1, 'default', ?2, ?3)",
                params![id, kind, status],
            )?;
        }
        drop(conn);
        assert_eq!(report_read_counts(&pool, 7)?, (3, 2));
        Ok(())
    }

    // --- the reflection hook -------------------------------------------------

    /// Three opened reports in the window: the "more" signal, so a proposal.
    fn seed_read_reports(pool: &UserDbPool) -> Result<(), AppError> {
        let conn = pool.get()?;
        for id in ["rr1", "rr2", "rr3"] {
            conn.execute(
                "INSERT INTO companion_chat_card (id, conversation_id, kind, status) VALUES (?1, 'default', 'report', 'read')",
                params![id],
            )?;
        }
        Ok(())
    }

    /// `(status, payload)` of every `adjust_register` approval.
    fn register_approvals(pool: &UserDbPool) -> Result<Vec<(String, String)>, AppError> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT status, payload FROM companion_approval
              WHERE json_extract(payload, '$.action') = 'adjust_register'",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn days_ago_rfc3339(days: i64) -> String {
        (crate::companion::brain::sim_clock::now() - chrono::Duration::days(days)).to_rfc3339()
    }

    #[test]
    fn register_reflection_files_the_proposal_as_one_adjust_register_approval(
    ) -> Result<(), AppError> {
        let user_db = pool()?;
        let sys_db = crate::db::init_test_db()?;
        seed_read_reports(&user_db)?;

        let created = run_reflection_pass(&user_db, &sys_db)?.expect("a proposal is filed");
        assert_eq!(created.action, "adjust_register");
        let rows = register_approvals(&user_db)?;
        assert_eq!(rows.len(), 1);
        let (status, payload) = &rows[0];
        assert_eq!(status, "pending");
        let payload: serde_json::Value = serde_json::from_str(payload)?;
        assert_eq!(payload["action"], "adjust_register");
        // The params are the proposal's own op shape; the executor reads them
        // exactly like a chat op.
        assert_eq!(payload["params"]["scope"], "default");
        assert_eq!(payload["params"]["sentences"], 4);
        assert!(payload["params"]["reason"]
            .as_str()
            .is_some_and(|s| !s.is_empty()));
        assert!(payload["rationale"].as_str().is_some_and(|s| !s.is_empty()));
        assert_eq!(payload["params"].to_string(), created.params_json);
        // It proposes; it never applies.
        assert_eq!(
            effective(&user_db).default_sentences,
            LAYER_ONE_BASE_SENTENCES
        );
        Ok(())
    }

    #[test]
    fn register_reflection_runs_at_most_once_a_week() -> Result<(), AppError> {
        use crate::db::repos::core::settings;
        use crate::db::settings_keys as keys;
        let user_db = pool()?;
        let sys_db = crate::db::init_test_db()?;
        seed_read_reports(&user_db)?;

        // Ran two days ago: not due, nothing filed, stamp untouched.
        let recent = days_ago_rfc3339(2);
        settings::set(&sys_db, keys::COMPANION_REGISTER_REFLECTION_LAST, &recent)?;
        assert!(run_reflection_pass(&user_db, &sys_db)?.is_none());
        assert!(register_approvals(&user_db)?.is_empty());
        assert_eq!(
            settings::get(&sys_db, keys::COMPANION_REGISTER_REFLECTION_LAST)?.as_deref(),
            Some(recent.as_str())
        );

        // Ran eight days ago: due, files, and stamps.
        let old = days_ago_rfc3339(8);
        settings::set(&sys_db, keys::COMPANION_REGISTER_REFLECTION_LAST, &old)?;
        assert!(run_reflection_pass(&user_db, &sys_db)?.is_some());
        let stamp =
            settings::get(&sys_db, keys::COMPANION_REGISTER_REFLECTION_LAST)?.expect("stamped");
        assert_ne!(stamp, old);

        // Straight after: the fresh stamp holds the next tick off.
        assert!(run_reflection_pass(&user_db, &sys_db)?.is_none());
        assert_eq!(register_approvals(&user_db)?.len(), 1);
        Ok(())
    }

    #[test]
    fn register_reflection_skips_while_one_is_pending() -> Result<(), AppError> {
        use crate::db::repos::core::settings;
        use crate::db::settings_keys as keys;
        let user_db = pool()?;
        let sys_db = crate::db::init_test_db()?;
        seed_read_reports(&user_db)?;
        let open_payload = serde_json::json!({
            "action": "adjust_register",
            "params": {"scope": "default", "sentences": 2, "reason": "earlier"},
            "rationale": "earlier",
        })
        .to_string();
        user_db.get()?.execute(
            "INSERT INTO companion_approval (id, session_id, kind, payload, status, created_at)
             VALUES ('appr_open', 'default', 'op_execute', ?1, 'pending', datetime('now'))",
            params![open_payload],
        )?;
        assert!(run_reflection_pass(&user_db, &sys_db)?.is_none());
        assert_eq!(register_approvals(&user_db)?.len(), 1, "no second card");

        // Once he has answered it, the next due pass may file again.
        user_db.get()?.execute(
            "UPDATE companion_approval SET status = 'rejected' WHERE id = 'appr_open'",
            [],
        )?;
        settings::set(
            &sys_db,
            keys::COMPANION_REGISTER_REFLECTION_LAST,
            &days_ago_rfc3339(8),
        )?;
        assert!(run_reflection_pass(&user_db, &sys_db)?.is_some());
        let rows = register_approvals(&user_db)?;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows.iter().filter(|r| r.0 == "pending").count(), 1);
        Ok(())
    }
}
