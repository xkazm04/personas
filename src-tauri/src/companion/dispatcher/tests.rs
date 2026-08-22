//! Moved verbatim out of the former single-file `dispatcher.rs`; the inner
//! `mod tests` wrapper became this file, so every test body is unchanged
//! apart from four columns of indentation.

use rusqlite::params;

use super::catalog::*;
use super::envelope::*;
use super::read_ops::*;
use super::types::*;

// ─────────────────────────────────────────────────────────────────────────
// Tests
//
// Coverage focuses on the new chat-card op variants added by /friend
// 2026-05-16 session 2: show_persona_walkthrough, show_template_suggestions,
// show_use_case_set, show_trigger_set, show_model_tier_choice,
// show_observability_plan, show_decision_log, show_persona_ready,
// show_design_capabilities, show_recent_decisions. All are auto-fire
// chat-card emitters that push to `out.chat_cards` on valid input and to
// `out.warnings` on bad input — no DB writes for any of them except
// show_decision_log (which best-effort persists to companion_design_decision).
//
// Tests build a small in-memory UserDbPool with the COMPANION_SCHEMA
// applied so the show_decision_log persist path doesn't fail; the rest
// of the dispatch surface doesn't touch the pool.
// ─────────────────────────────────────────────────────────────────────────

use super::*;
use crate::db::UserDbPool;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

/// Build an in-memory user db pool with the companion schema applied.
/// Uses a file::memory: URI with shared cache so all pool connections
/// see the same tables (per the pattern in db/repos/resources/
/// db_schema.rs's in-memory comment).
fn test_pool() -> UserDbPool {
    let manager = SqliteConnectionManager::file("file::memory:?cache=shared").with_flags(
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
            | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
            | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    );
    let pool = Pool::builder()
        .max_size(2)
        .build(manager)
        .expect("build in-memory pool");
    // Minimal schema — just the tables the dispatcher arms exercise.
    let conn = pool.get().expect("get conn");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS companion_approval (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL,
            human_review_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS companion_design_decision (
            id                  TEXT PRIMARY KEY,
            session_id          TEXT NOT NULL,
            persona_context     TEXT,
            label               TEXT NOT NULL,
            choice              TEXT NOT NULL,
            rationale           TEXT NOT NULL,
            decision_timestamp  TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .expect("apply schema");
    pool
}

fn dispatch_op(op_json: &str) -> Dispatched {
    let pool = test_pool();
    let text = format!("Some prose.\nOP: {op_json}\nMore prose.");
    dispatch(&pool, "default", &text).expect("dispatch ok")
}

// ── PROGRESS beats (Variant B) ──────────────────────────────────────

#[test]
fn progress_lines_are_stripped_from_cleaned_text() {
    let pool = test_pool();
    let text = "PROGRESS: Pulling up your recent runs…\n\
                Here are your three failing personas.\n\
                PROGRESS: Checking the logs…";
    let out = dispatch(&pool, "default", text).expect("dispatch ok");
    assert!(
        !out.cleaned_text.contains("PROGRESS:"),
        "PROGRESS beats must not survive into the persisted reply: {:?}",
        out.cleaned_text
    );
    assert!(
        out.cleaned_text.contains("three failing personas"),
        "real prose must survive the strip: {:?}",
        out.cleaned_text
    );
    // Beats are now CAPTURED (persisted by session.rs as aside messages),
    // not merely discarded — in emission order.
    assert_eq!(
        out.progress_beats,
        vec![
            "Pulling up your recent runs…".to_string(),
            "Checking the logs…".to_string()
        ],
        "PROGRESS beats must be captured in order"
    );
}

// ── show_fleet_plan ─────────────────────────────────────────────────

/// The plan card's Confirm button starts real `--dangerously-skip-permissions`
/// terminals, and the ONLY thing standing between a proposed `cwd` and that
/// is the registered-dev-project check — which needs the system DB. When the
/// registry is unreachable the arm must fail CLOSED: no card, a warning
/// Athena reads next turn. `dispatch_op` builds a user pool only, so this is
/// exactly that path.
#[test]
fn show_fleet_plan_fails_closed_without_the_project_registry() {
    let op = r###"{"op":"propose_action","action":"show_fleet_plan","params":{"operation_intent":"do work","rows":[{"cwd":"C:/anywhere","objective":"go"}]}}"###;
    let out = dispatch_op(op);
    assert!(
        out.chat_cards.is_empty(),
        "no card without containment proof"
    );
    assert!(out
        .warnings
        .iter()
        .any(|w| w.contains("show_fleet_plan") || w.contains("project registry")));
}

// ── show_ship_milestone ─────────────────────────────────────────────

/// Same doctrine as the plan card: the ONLY thing separating a proposed
/// `item_id` from a `dev_milestone_items` row full of invented members is
/// the registry lookup, which needs the system DB. `dispatch_op` builds a
/// user pool only, so this is exactly the unreachable-registry path.
#[test]
fn show_ship_milestone_fails_closed_without_the_project_registry() {
    let op = r###"{"op":"propose_action","action":"show_ship_milestone","params":{"project_slug":"personas","name":"M1","goal":"cut it","rows":[{"item_kind":"use_case","item_id":"uc_1"}]}}"###;
    let out = dispatch_op(op);
    assert!(
        out.chat_cards.is_empty(),
        "no card without a way to prove the ids are real"
    );
    assert!(out
        .warnings
        .iter()
        .any(|w| w.contains("show_ship_milestone") || w.contains("project registry")));
}

/// A card op sits OUTSIDE both lists by design: no executor arm, no
/// auto-fired read. The invariant test below asserts the two lists never
/// overlap; this asserts the new op joined neither.
#[test]
fn show_ship_milestone_is_a_card_op_not_an_action_or_a_read_op() {
    assert!(!ALLOWED_ACTIONS.contains(&"show_ship_milestone"));
    assert!(!READ_OPS.contains(&"show_ship_milestone"));
}

// ── show_persona_walkthrough ────────────────────────────────────────

#[test]
fn show_persona_walkthrough_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_persona_walkthrough","params":{"intent":"triage tickets","content":"## Plan\n\nbody"}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "persona_walkthrough");
    assert!(out.warnings.is_empty());
}

#[test]
fn show_persona_walkthrough_rejects_empty_content() {
    let op = r###"{"op":"propose_action","action":"show_persona_walkthrough","params":{"intent":"x","content":""}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("content")));
}

// ── show_template_suggestions ───────────────────────────────────────

#[test]
fn show_template_suggestions_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":"triage support tickets","limit":3}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "template_suggestions");
    assert!(out.warnings.is_empty());
}

#[test]
fn show_template_suggestions_rejects_empty_intent() {
    let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":""}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("intent")));
}

#[test]
fn show_template_suggestions_clamps_limit_into_1_to_5() {
    let op = r###"{"op":"propose_action","action":"show_template_suggestions","params":{"intent":"x","limit":99}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    let limit = out.chat_cards[0]
        .config
        .get("limit")
        .and_then(|v| v.as_u64())
        .expect("limit field");
    assert!(
        (1..=5).contains(&limit),
        "limit clamped to 1..=5, got {limit}"
    );
}

// ── show_browser_test_report ────────────────────────────────────────

#[test]
fn show_browser_test_report_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_browser_test_report","params":{"url":"http://localhost:8765","steps":[{"label":"Add todo","result":"pass","evidence":"item in #list"},{"label":"Clear completed","result":"fail","evidence":"item remains"}],"defects":[{"title":"Clear broken","severity":"high","detail":"ReferenceError","fix":"define completedItems"}],"console_errors":["ReferenceError: completedItems is not defined"],"security_notes":["prompt injection found in page"]}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "browser_test_report");
    let cfg = &out.chat_cards[0].config;
    assert_eq!(cfg["steps"].as_array().unwrap().len(), 2);
    assert_eq!(cfg["defects"].as_array().unwrap().len(), 1);
}

#[test]
fn show_browser_test_report_rejects_bad_result() {
    let op = r###"{"op":"propose_action","action":"show_browser_test_report","params":{"url":"x","steps":[{"label":"a","result":"maybe"}]}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("pass|fail|warn")));
}

#[test]
fn show_browser_test_report_rejects_empty_steps() {
    let op = r###"{"op":"propose_action","action":"show_browser_test_report","params":{"url":"x","steps":[]}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("steps")));
}

// ── show_use_case_set ───────────────────────────────────────────────

#[test]
fn show_use_case_set_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_use_case_set","params":{"intent":"x","use_cases":[{"label":"Golden","role":"golden","description":"d"},{"label":"Variant","role":"variant","description":"d"},{"label":"Outscope","role":"out_of_scope","description":"d"}]}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "use_case_set");
}

#[test]
fn show_use_case_set_rejects_empty_array() {
    let op =
        r###"{"op":"propose_action","action":"show_use_case_set","params":{"use_cases":[]}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("use_cases")));
}

#[test]
fn show_use_case_set_rejects_invalid_role() {
    let op = r###"{"op":"propose_action","action":"show_use_case_set","params":{"use_cases":[{"label":"X","role":"surprise","description":"d"}]}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("role")));
}

#[test]
fn show_use_case_set_rejects_oversize_array() {
    let mut entries = Vec::new();
    for i in 0..9 {
        entries.push(format!(
            r###"{{"label":"L{i}","role":"variant","description":"d"}}"###
        ));
    }
    let op = format!(
        r###"{{"op":"propose_action","action":"show_use_case_set","params":{{"use_cases":[{}]}}}}"###,
        entries.join(",")
    );
    let out = dispatch_op(&op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("too many")));
}

// ── show_trigger_set ────────────────────────────────────────────────

#[test]
fn show_trigger_set_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_trigger_set","params":{"intent":"x","triggers":[{"label":"L","source":"S","condition":"C"}]}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "trigger_set");
}

#[test]
fn show_trigger_set_rejects_missing_field() {
    let op = r###"{"op":"propose_action","action":"show_trigger_set","params":{"triggers":[{"label":"L","source":"","condition":"C"}]}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("source")));
}

// ── show_model_tier_choice ──────────────────────────────────────────

#[test]
fn show_model_tier_choice_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"sonnet","tiers":[{"tier":"haiku","rationale":"a"},{"tier":"sonnet","rationale":"b"},{"tier":"opus","rationale":"c"}]}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "model_tier_choice");
}

#[test]
fn show_model_tier_choice_rejects_unknown_recommended() {
    let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"galactus","tiers":[{"tier":"sonnet","rationale":"x"}]}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("recommended")));
}

#[test]
fn show_model_tier_choice_rejects_bad_tier_slug() {
    let op = r###"{"op":"propose_action","action":"show_model_tier_choice","params":{"recommended":"sonnet","tiers":[{"tier":"haiku","rationale":"a"},{"tier":"jellyfish","rationale":"b"}]}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("invalid tier")));
}

// ── show_observability_plan ─────────────────────────────────────────

#[test]
fn show_observability_plan_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"error_handling":{"triggers":["tool timeout"],"escalation":"manual_reviews"},"success_metric":{"kind":"count_by_status","description":"weekly rollup"}}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "observability_plan");
}

#[test]
fn show_observability_plan_rejects_missing_error_handling() {
    let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"success_metric":{"kind":"latency","description":"x"}}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("error_handling")));
}

#[test]
fn show_observability_plan_rejects_unknown_metric_kind() {
    let op = r###"{"op":"propose_action","action":"show_observability_plan","params":{"error_handling":{"triggers":["a"],"escalation":"e"},"success_metric":{"kind":"vibes","description":"x"}}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("kind")));
}

// ── show_decision_log ───────────────────────────────────────────────

#[test]
fn show_decision_log_emits_chat_card_and_persists() {
    let pool = test_pool();
    let op = r###"{"op":"propose_action","action":"show_decision_log","params":{"intent":"persona_abc","decisions":[{"label":"Model tier","choice":"Sonnet","rationale":"right balance"},{"label":"Triggers","choice":"Slack only","rationale":"scope"}]}}"###;
    let text = format!("Some prose.\nOP: {op}");
    let out = dispatch(&pool, "default", &text).expect("dispatch ok");
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "decision_log");

    // Verify rows landed in companion_design_decision.
    let conn = pool.get().expect("get conn");
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM companion_design_decision WHERE persona_context = 'persona_abc'",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(count, 2);
}

#[test]
fn show_decision_log_rejects_missing_rationale() {
    let op = r###"{"op":"propose_action","action":"show_decision_log","params":{"decisions":[{"label":"X","choice":"Y","rationale":""}]}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("rationale")));
}

// ── show_persona_ready ──────────────────────────────────────────────

#[test]
fn show_persona_ready_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"interactive","summary":{"intent_line":"Triage tickets","model_tier":"sonnet"}}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "persona_ready");
}

#[test]
fn show_persona_ready_rejects_missing_intent_line() {
    let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"interactive","summary":{}}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("intent_line")));
}

#[test]
fn show_persona_ready_rejects_unknown_recommended_action() {
    let op = r###"{"op":"propose_action","action":"show_persona_ready","params":{"recommended_action":"explode","summary":{"intent_line":"x"}}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out
        .warnings
        .iter()
        .any(|w| w.contains("recommended_action")));
}

// ── show_design_capabilities ────────────────────────────────────────

#[test]
fn show_design_capabilities_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_design_capabilities","params":{"intro":"Here's the menu."}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "design_capabilities");
}

#[test]
fn show_design_capabilities_tolerates_empty_intro() {
    let op = r###"{"op":"propose_action","action":"show_design_capabilities","params":{}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
}

// ── show_recent_decisions ───────────────────────────────────────────

#[test]
fn show_recent_decisions_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{"persona_context":"persona_abc","limit":3}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "recent_decisions");
}

#[test]
fn show_recent_decisions_rejects_missing_context() {
    let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("persona_context")));
}

#[test]
fn show_recent_decisions_clamps_limit() {
    let op = r###"{"op":"propose_action","action":"show_recent_decisions","params":{"persona_context":"x","limit":42}}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    let limit = out.chat_cards[0]
        .config
        .get("limit")
        .and_then(|v| v.as_u64())
        .expect("limit field");
    assert!((1..=5).contains(&limit));
}

// ── show_persona_creation_offer / start_guided_walkthrough ──────────

#[test]
fn persona_creation_offer_emits_chat_card() {
    let op = r###"{"op":"propose_action","action":"show_persona_creation_offer","params":{"intent":"a Slack triager"},"rationale":"user described a persona"}"###;
    let out = dispatch_op(op);
    assert_eq!(out.chat_cards.len(), 1);
    assert_eq!(out.chat_cards[0].kind, "persona_creation_offer");
    assert_eq!(
        out.chat_cards[0]
            .config
            .get("intent")
            .and_then(|v| v.as_str()),
        Some("a Slack triager"),
    );
    // OP line stripped from the displayed reply.
    assert!(!out.cleaned_text.contains("show_persona_creation_offer"));
}

#[test]
fn persona_creation_offer_rejects_missing_intent() {
    let op = r###"{"op":"propose_action","action":"show_persona_creation_offer","params":{}}"###;
    let out = dispatch_op(op);
    assert!(out.chat_cards.is_empty());
    assert!(!out.warnings.is_empty());
}

#[test]
fn start_guided_walkthrough_collects_valid_topic() {
    let op = r###"{"op":"propose_action","action":"start_guided_walkthrough","params":{"topic":"persona_creation"},"rationale":"show me how"}"###;
    let out = dispatch_op(op);
    assert_eq!(out.guide_walkthroughs, vec!["persona_creation".to_string()]);
    assert!(!out.cleaned_text.contains("start_guided_walkthrough"));
}

#[test]
fn start_guided_walkthrough_accepts_e2_topics() {
    // The four E2 coverage topics must be allow-listed (mirrors the frontend
    // registry); a regression that drops one would silently reject the tour.
    for topic in [
        "trigger_creation",
        "template_adoption",
        "incident_triage",
        "goal_kpi_setup",
    ] {
        let op = format!(
            r###"{{"op":"propose_action","action":"start_guided_walkthrough","params":{{"topic":"{topic}"}},"rationale":"show me"}}"###
        );
        let out = dispatch_op(&op);
        assert_eq!(
            out.guide_walkthroughs,
            vec![topic.to_string()],
            "topic {topic} should be accepted"
        );
        assert!(out.warnings.is_empty(), "topic {topic} should not warn");
    }
}

#[test]
fn start_guided_walkthrough_rejects_unknown_topic() {
    let op = r###"{"op":"propose_action","action":"start_guided_walkthrough","params":{"topic":"nuke_everything"}}"###;
    let out = dispatch_op(op);
    assert!(out.guide_walkthroughs.is_empty());
    assert!(!out.warnings.is_empty());
}

#[test]
fn start_guided_walkthrough_rejects_missing_topic() {
    let op = r###"{"op":"propose_action","action":"start_guided_walkthrough","params":{}}"###;
    let out = dispatch_op(op);
    assert!(out.guide_walkthroughs.is_empty());
    assert!(!out.warnings.is_empty());
}

#[test]
fn point_at_collects_valid_anchor() {
    let op = r###"{"op":"propose_action","action":"point_at","params":{"anchor":"nav_agents","narration":"Your agents live right here."},"rationale":"show where"}"###;
    let out = dispatch_op(op);
    assert_eq!(out.point_ats.len(), 1);
    assert_eq!(out.point_ats[0].anchor, "nav_agents");
    assert_eq!(out.point_ats[0].narration, "Your agents live right here.");
    assert!(!out.cleaned_text.contains("point_at"));
}

#[test]
fn point_at_rejects_unknown_anchor() {
    let op = r###"{"op":"propose_action","action":"point_at","params":{"anchor":"window.localStorage","narration":"hi"}}"###;
    let out = dispatch_op(op);
    assert!(out.point_ats.is_empty());
    assert!(!out.warnings.is_empty());
}

#[test]
fn point_at_rejects_missing_fields() {
    let op = r###"{"op":"propose_action","action":"point_at","params":{"anchor":"vault"}}"###;
    let out = dispatch_op(op);
    assert!(out.point_ats.is_empty());
    assert!(!out.warnings.is_empty());
}

#[test]
fn compose_walkthrough_collects_valid_steps() {
    let op = r###"{"op":"propose_action","action":"compose_walkthrough","params":{"title":"Quick tour","steps":[{"anchor":"nav_agents","narration":"Your agents."},{"anchor":"vault","narration":"Your connections."}]},"rationale":"orient the user"}"###;
    let out = dispatch_op(op);
    assert_eq!(out.composed_walkthroughs.len(), 1);
    assert_eq!(out.composed_walkthroughs[0].steps.len(), 2);
    assert_eq!(
        out.composed_walkthroughs[0].title.as_deref(),
        Some("Quick tour")
    );
    assert!(!out.cleaned_text.contains("compose_walkthrough"));
}

#[test]
fn compose_walkthrough_rejects_bad_anchor_in_any_step() {
    let op = r###"{"op":"propose_action","action":"compose_walkthrough","params":{"steps":[{"anchor":"nav_agents","narration":"ok"},{"anchor":"window.localStorage","narration":"bad"}]}}"###;
    let out = dispatch_op(op);
    assert!(out.composed_walkthroughs.is_empty());
    assert!(!out.warnings.is_empty());
}

#[test]
fn compose_walkthrough_rejects_too_few_steps() {
    let op = r###"{"op":"propose_action","action":"compose_walkthrough","params":{"steps":[{"anchor":"vault","narration":"only one"}]}}"###;
    let out = dispatch_op(op);
    assert!(out.composed_walkthroughs.is_empty());
    assert!(!out.warnings.is_empty());
}

// ── op-JSON brace repair (observed live 2026-07-04) ────────────────

#[test]
fn repair_op_json_completes_small_brace_deficits() {
    assert_eq!(
        repair_op_json(r#"{"op":"x","params":{"a":"b"}"#).as_deref(),
        Some(r#"{"op":"x","params":{"a":"b"}}"#)
    );
    assert_eq!(
        repair_op_json(r#"{"op":"x","params":{"a":{"b":"c"}"#).as_deref(),
        Some(r#"{"op":"x","params":{"a":{"b":"c"}}}"#)
    );
    // Balanced JSON → nothing to repair.
    assert!(repair_op_json(r#"{"op":"x"}"#).is_none());
    // Ends inside a string literal → unrecoverable, keep the error.
    assert!(repair_op_json(r#"{"op":"x","params":{"a":"trunc"#).is_none());
    // Escaped quotes inside a string must not flip the in-string
    // state — the note string here IS closed, so the single missing
    // envelope brace is completable. (Escaped regular literals on
    // purpose: a raw-string literal ending in `\""#` terminates at
    // the embedded `"#` and silently truncates the test input.)
    assert_eq!(
        repair_op_json("{\"op\":\"x\",\"note\":\"say \\\"hi\\\"\"").as_deref(),
        Some("{\"op\":\"x\",\"note\":\"say \\\"hi\\\"\"}")
    );
    // And a genuinely unterminated string stays unrepairable.
    assert!(repair_op_json("{\"op\":\"x\",\"note\":\"say \\\"hi\\\"").is_none());
}

#[test]
fn truncated_dev_improve_op_still_lands_an_approval() {
    // The exact live failure shape: a long single-line dev_improve op
    // missing its final envelope brace. The prose around it must
    // survive; the repaired op must create a pending approval, with
    // no parse warning.
    let op = r#"{"op": "propose_action", "action": "dev_improve", "params": {"request": "Give the wrench a subtle amber hover tint in its off state", "context": "companion-chat", "backend": false, "confidence": "high", "rationale": "self-contained styling fix"}"#;
    let out = dispatch_op(op);
    assert_eq!(out.approvals.len(), 1, "warnings: {:?}", out.warnings);
    assert_eq!(out.approvals[0].action, "dev_improve");
    assert!(out.warnings.is_empty(), "warnings: {:?}", out.warnings);
    assert!(!out.cleaned_text.contains("OP:"));
}

// ── compose_tour (Generative Tours) ─────────────────────────────────

#[test]
fn compose_tour_collects_manifest_valid_spec() {
    let op = r###"{"op":"propose_action","action":"compose_tour","params":{"topic":"scheduling","title":"Meet Schedules","description":"Timed triggers.","steps":[{"id":"open-schedules","title":"Open Schedules","description":"Every timed trigger lives here.","hint":"Look around.","nav":{"sidebarSection":"schedules"}}]},"rationale":"user asked to be shown"}"###;
    let out = dispatch_op(op);
    assert_eq!(out.composed_tours.len(), 1, "warnings: {:?}", out.warnings);
    assert!(!out.cleaned_text.contains("compose_tour"));
    let spec: serde_json::Value = serde_json::from_str(&out.composed_tours[0]).unwrap();
    assert_eq!(spec["topic"], "scheduling");
    assert_eq!(
        spec["steps"][0]["completeOn"], "tour:composed-step-explored",
        "composed steps must advance on the acknowledge event"
    );
}

// ── Detail-on-demand read ops ───────────────────────────────────────

/// In-memory system pool with just the tables the read ops query.
fn read_op_sys_pool() -> crate::db::DbPool {
    let manager = SqliteConnectionManager::memory();
    let pool = Pool::builder()
        .max_size(1)
        .build(manager)
        .expect("sys pool");
    pool.get()
        .unwrap()
        .execute_batch(
            "CREATE TABLE personas (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                description TEXT, system_prompt TEXT NOT NULL DEFAULT '',
                model_profile TEXT, enabled INTEGER NOT NULL DEFAULT 1,
                home_team_id TEXT, updated_at TEXT NOT NULL);
             CREATE TABLE persona_teams (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                description TEXT, enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL);
             CREATE TABLE persona_team_members (id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL, persona_id TEXT NOT NULL);
             CREATE TABLE dev_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                root_path TEXT NOT NULL);
             CREATE TABLE dev_context_groups (id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL, name TEXT NOT NULL);
             CREATE TABLE dev_contexts (id TEXT PRIMARY KEY, project_id TEXT,
                group_id TEXT, name TEXT NOT NULL, description TEXT,
                file_paths TEXT NOT NULL DEFAULT '[]', keywords TEXT,
                pinned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);",
        )
        .unwrap();
    pool
}

fn seed_read_op_rows(pool: &crate::db::DbPool) {
    let conn = pool.get().unwrap();
    conn.execute_batch(
        "INSERT INTO persona_teams (id, name, description, enabled, updated_at)
            VALUES ('team_abc', 'SDLC', 'Ships the product', 1, '2026-01-01');
         INSERT INTO persona_team_members (id, team_id, persona_id)
            VALUES ('m1', 'team_abc', 'p_scout');
         INSERT INTO personas (id, name, description, system_prompt, model_profile,
                enabled, home_team_id, updated_at)
            VALUES ('p_scout', 'Scout', 'Finds things', 'You are Scout. ',
                '{\"model\":\"claude-opus-4-5\"}', 1, 'team_abc', '2026-01-02');
         INSERT INTO dev_projects (id, name, root_path)
            VALUES ('proj_1', 'Personas', 'C:/repo');
         INSERT INTO dev_context_groups (id, project_id, name)
            VALUES ('grp_1', 'proj_1', 'AI Companion');
         INSERT INTO dev_contexts (id, project_id, group_id, name, description,
                file_paths, keywords, pinned, updated_at)
            VALUES ('ctx_1', 'proj_1', 'grp_1', 'Companion Prompt',
                'System prompt assembly', '[\"src/companion/prompt.rs\"]',
                'prompt, athena', 1, '2026-01-03');",
    )
    .unwrap();
}

#[test]
fn every_read_op_has_a_dispatch_arm() {
    // Cheap guard against the divergence class these ops were shaped to
    // avoid: a read op that is neither handled here nor in
    // ALLOWED_ACTIONS falls through to "rejected unknown action" and
    // silently does nothing.
    let pool = test_pool();
    for action in READ_OPS {
        let text = format!(
            r#"Prose.
OP: {{"op": "propose_action", "action": "{action}", "params": {{"query": "anything"}}}}"#
        );
        let out = dispatch(&pool, "default", &text).expect("dispatch ok");
        assert!(
            !out.warnings
                .iter()
                .any(|w| w.contains("rejected unknown action")),
            "`{action}` has no dispatch arm: {:?}",
            out.warnings
        );
        assert!(
            out.approvals.is_empty(),
            "`{action}` must not create an approval card"
        );
        assert!(
            !out.cleaned_text.contains("OP:"),
            "`{action}` must be stripped from the reply"
        );
    }
}

/// A system pool carrying `app_settings`, where the canvas publishes its
/// scene snapshot.
fn canvas_sys_pool(scene_json: Option<&str>) -> crate::db::DbPool {
    let manager = SqliteConnectionManager::memory();
    let pool = Pool::builder()
        .max_size(1)
        .build(manager)
        .expect("sys pool");
    {
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT '2026-08-04');",
        )
        .unwrap();
        if let Some(json) = scene_json {
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
                params![crate::db::settings_keys::MASTERMIND_SCENE, json],
            )
            .unwrap();
        }
    }
    pool
}

const CANVAS_FIXTURE: &str = r#"{"version":1,"publishedAt":"2026-08-04T09:00:00Z",
    "families":{"scans":"failed"},
    "projects":[
      {"slug":"proj_1","name":"Personas","state":"warning","attention":true,
       "blockers":3,"fleet":2,"ideasDays":42,"goalsOngoing":3,
       "kpiTotal":6,"kpiOff":2,
       "dims":[{"key":"tests","label":"Tests","status":"risk","detail":"41% cov"},
               {"key":"ci","label":"CI","status":"solid"}]},
      {"slug":"proj_2","name":"Vibeman","state":"healthy","dims":[]}
    ]}"#;

#[test]
fn canvas_read_ops_are_bounded_and_name_the_real_numbers() {
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
    let detail = crate::companion::canvas::describe_canvas_project(&sys, "proj_1");
    assert!(detail.contains("`proj_1`"), "{detail}");
    assert!(detail.contains("Tests risk (41% cov)"), "{detail}");
    assert!(detail.contains("NEEDS THE USER"), "{detail}");
    assert!(
        detail.contains("scans (failed)"),
        "must flag bad data: {detail}"
    );
    assert!(
        detail.len() <= READ_OP_DETAIL_CHARS,
        "unbounded: {}",
        detail.len()
    );

    let fresh = crate::companion::canvas::describe_canvas_freshness(&sys, "proj_1");
    assert!(fresh.contains("42d old"), "{fresh}");
    assert!(fresh.contains("3 ongoing"), "{fresh}");
    assert!(fresh.contains("2 of 6 OFF TRACK"), "{fresh}");
    assert!(
        fresh.len() <= READ_OP_DETAIL_CHARS,
        "unbounded: {}",
        fresh.len()
    );

    // Empty query answers for the whole canvas, worst-first and bounded.
    let all = crate::companion::canvas::describe_canvas_freshness(&sys, "");
    assert!(all.contains("2 of 2 projects"), "{all}");
    assert!(
        all.find("proj_1").unwrap() < all.find("proj_2").unwrap(),
        "{all}"
    );
    assert!(
        all.len() <= READ_OP_DETAIL_CHARS,
        "unbounded: {}",
        all.len()
    );
}

#[test]
fn canvas_project_detail_stays_bounded_with_all_fifteen_cells() {
    // Fifteen cells with pathological detail strings must not sail past
    // the dispatcher's own clip, which would take the caveats footer with
    // it and turn a hedged answer into a confident one.
    let dims: Vec<String> = (0..15)
        .map(|d| {
            format!(
                r#"{{"key":"dim{d}","label":"Dimension {d}","status":"risk","detail":"{}"}}"#,
                "x".repeat(4000)
            )
        })
        .collect();
    let sys = canvas_sys_pool(Some(&format!(
        r#"{{"version":1,"projects":[{{"slug":"p","name":"P","state":"critical","dims":[{}]}}]}}"#,
        dims.join(",")
    )));
    let out = crate::companion::canvas::describe_canvas_project(&sys, "p");
    assert!(
        out.len() <= READ_OP_DETAIL_CHARS,
        "unbounded: {}",
        out.len()
    );
    assert!(
        out.contains("of 15"),
        "must say how many of the fifteen it printed: {out}"
    );
    assert!(out.contains("publish"), "footer must survive: {out}");
}

#[test]
fn canvas_read_ops_are_graceful_on_an_unknown_slug() {
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
    for out in [
        crate::companion::canvas::describe_canvas_project(&sys, "not-a-project"),
        crate::companion::canvas::describe_canvas_freshness(&sys, "not-a-project"),
    ] {
        assert!(out.contains("No project matches"), "{out}");
        assert!(out.contains("`proj_1`"), "must name a real slug: {out}");
        assert!(out.contains("do not invent a slug"), "{out}");
    }
}

#[test]
fn canvas_read_ops_refuse_demo_islands_rather_than_answering_about_them() {
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
    for out in [
        crate::companion::canvas::describe_canvas_project(&sys, "demo-codex"),
        crate::companion::canvas::describe_canvas_freshness(&sys, "demo-web"),
    ] {
        assert!(out.contains("demo islands"), "{out}");
    }
}

#[test]
fn canvas_read_ops_say_so_when_no_scene_has_been_published() {
    let sys = canvas_sys_pool(None);
    let out = crate::companion::canvas::describe_canvas_project(&sys, "proj_1");
    assert!(out.contains("has not published a scene"), "{out}");
    assert!(out.contains("rather than describing one"), "{out}");
}

/// One `compose_canvas_panel` op line with the given slug + spec JSON.
fn panel_line(slug: &str, spec: &str) -> String {
    format!(
        r#"Composing.
OP: {{"op":"propose_action","action":"compose_canvas_panel","params":{{"slug":"{slug}","spec":{spec}}},"rationale":"why"}}"#
    )
}

const GOOD_SPEC: &str =
    r#"{"surface":"v1","title":"Tests","blocks":[{"type":"markdown","content":"hi"}]}"#;

#[test]
fn compose_canvas_panel_emits_a_panel_for_a_slug_in_the_published_scene() {
    let pool = test_pool();
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
    let out = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &panel_line("proj_1", GOOD_SPEC),
    )
    .expect("dispatch ok");
    assert_eq!(out.canvas_panels.len(), 1, "warnings: {:?}", out.warnings);
    let panel = &out.canvas_panels[0];
    assert_eq!(panel.slug, "proj_1");
    assert_eq!(panel.spec_version, CANVAS_PANEL_SPEC_VERSION);
    assert!(panel.spec.contains("\"surface\":\"v1\""), "{}", panel.spec);
    // Auto-fire: no approval card, and the op line never reaches the user.
    assert!(out.approvals.is_empty());
    assert!(!out.cleaned_text.contains("OP:"), "{}", out.cleaned_text);
    // Auto-fire arm, like compose_cockpit: neither an approval action nor
    // a read op, so listing it in either would create a dead card.
    assert!(!ALLOWED_ACTIONS.contains(&"compose_canvas_panel"));
    assert!(!READ_OPS.contains(&"compose_canvas_panel"));
    // Resolved by NAME lands on the canonical slug, so the frontend keys
    // the panel the same way the canvas does.
    let by_name = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &panel_line("Personas", GOOD_SPEC),
    )
    .expect("dispatch ok");
    assert_eq!(by_name.canvas_panels[0].slug, "proj_1");
}

#[test]
fn compose_canvas_panel_refuses_a_demo_island_and_an_invented_slug() {
    let pool = test_pool();
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));

    let demo = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &panel_line("demo-web", GOOD_SPEC),
    )
    .expect("dispatch ok");
    assert!(demo.canvas_panels.is_empty());
    assert!(
        demo.warnings.iter().any(|w| w.contains("demo islands")),
        "{:?}",
        demo.warnings
    );

    let unknown = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &panel_line("not-a-project", GOOD_SPEC),
    )
    .expect("dispatch ok");
    assert!(unknown.canvas_panels.is_empty());
    // A refusal must name real slugs, or the next attempt is another guess.
    assert!(
        unknown.warnings.iter().any(|w| w.contains("`proj_1`")),
        "{:?}",
        unknown.warnings
    );
}

#[test]
fn compose_canvas_panel_refuses_a_spec_that_is_not_a_surface_envelope() {
    let pool = test_pool();
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
    let too_many: String = format!(
        r#"{{"surface":"v1","blocks":[{}]}}"#,
        std::iter::repeat(r#"{"type":"markdown","content":"x"}"#)
            .take(CANVAS_PANEL_MAX_BLOCKS + 1)
            .collect::<Vec<_>>()
            .join(",")
    );
    for spec in [
        r#"{"blocks":[{"type":"markdown","content":"x"}]}"#, // no envelope tag
        r#"{"surface":"v2","blocks":[{"type":"markdown","content":"x"}]}"#, // wrong version
        r#"{"surface":"v1","blocks":[]}"#,                   // nothing to render
        r#"{"surface":"v1"}"#,                               // no blocks at all
        &too_many,
    ] {
        let out = dispatch_with_sys(&pool, Some(&sys), "default", &panel_line("proj_1", spec))
            .expect("dispatch ok");
        assert!(out.canvas_panels.is_empty(), "accepted a bad spec: {spec}");
        assert!(
            out.warnings
                .iter()
                .any(|w| w.contains("compose_canvas_panel")),
            "{spec}: {:?}",
            out.warnings
        );
    }
}

#[test]
fn compose_canvas_panel_fails_closed_when_no_scene_is_reachable() {
    let pool = test_pool();
    // No system DB at all — the slug cannot be checked against anything.
    let blind = dispatch(&pool, "default", &panel_line("proj_1", GOOD_SPEC)).expect("ok");
    assert!(blind.canvas_panels.is_empty());
    assert!(
        blind.warnings.iter().any(|w| w.contains("not reachable")),
        "{:?}",
        blind.warnings
    );

    // System DB present, but the canvas has never published.
    let sys = canvas_sys_pool(None);
    let unpublished = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &panel_line("proj_1", GOOD_SPEC),
    )
    .expect("ok");
    assert!(unpublished.canvas_panels.is_empty());
    assert!(
        unpublished
            .warnings
            .iter()
            .any(|w| w.contains("has not published a scene")),
        "{:?}",
        unpublished.warnings
    );
}

/// One `canvas_control` op line with the given grammar action JSON.
fn control_line(action: &str) -> String {
    format!(
        r#"Steering.
OP: {{"op":"propose_action","action":"canvas_control","params":{{"action":{action}}},"rationale":"why"}}"#
    )
}

#[test]
fn canvas_control_validates_and_emits_steering_actions() {
    let pool = test_pool();
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
    // Focus by NAME resolves to the canonical slug; the band survives.
    let out = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &control_line(r#"{"kind":"camera.focus","slug":"Personas","band":"close"}"#),
    )
    .expect("dispatch ok");
    assert_eq!(out.canvas_controls.len(), 1, "warnings: {:?}", out.warnings);
    let action: serde_json::Value =
        serde_json::from_str(&out.canvas_controls[0].action).expect("valid JSON");
    assert_eq!(action["kind"], "camera.focus");
    assert_eq!(action["slug"], "proj_1");
    assert_eq!(action["band"], "close");
    // Auto-fire arm: no approval card, the op line is stripped, and it
    // lives in neither op list (an entry there would be a dead card).
    assert!(out.approvals.is_empty());
    assert!(!out.cleaned_text.contains("OP:"), "{}", out.cleaned_text);
    assert!(!ALLOWED_ACTIONS.contains(&"canvas_control"));
    assert!(!READ_OPS.contains(&"canvas_control"));

    // dim.open carries slug + key; pan carries validated numbers only.
    let dim = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &control_line(r#"{"kind":"dim.open","slug":"proj_1","key":"tests","invented":"x"}"#),
    )
    .expect("dispatch ok");
    assert_eq!(dim.canvas_controls.len(), 1, "warnings: {:?}", dim.warnings);
    let dim_action: serde_json::Value =
        serde_json::from_str(&dim.canvas_controls[0].action).expect("valid JSON");
    assert_eq!(dim_action["key"], "tests");
    // Only validated fields survive re-serialization.
    assert!(dim_action.get("invented").is_none());

    let pan = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &control_line(r#"{"kind":"camera.pan","dx":500,"dy":-120,"unit":"world"}"#),
    )
    .expect("dispatch ok");
    assert_eq!(pan.canvas_controls.len(), 1, "warnings: {:?}", pan.warnings);
}

#[test]
fn canvas_control_refuses_bad_kinds_slugs_and_params() {
    let pool = test_pool();
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
    for (action, needle) in [
        // Reads have a synchronous op already — point her at it.
        (
            r#"{"kind":"island.read","slug":"proj_1"}"#,
            "describe_canvas_project",
        ),
        (
            r#"{"kind":"dim.read","slug":"proj_1","key":"ci"}"#,
            "describe_canvas_project",
        ),
        (r#"{"kind":"island.move","slug":"proj_1"}"#, "unknown kind"),
        (
            r#"{"kind":"camera.focus","slug":"demo-web"}"#,
            "demo islands",
        ),
        (
            r#"{"kind":"camera.focus","slug":"not-a-project"}"#,
            "No project matches",
        ),
        (r#"{"kind":"camera.zoom"}"#, "needs `factor` or `band`"),
        (r#"{"kind":"camera.zoom","factor":-2}"#, "positive finite"),
        (
            r#"{"kind":"camera.zoom","band":"orbit"}"#,
            "`band` must be one of",
        ),
        (r#"{"kind":"camera.pan","dx":1}"#, "finite numeric `dy`"),
        (r#"{"kind":"dim.open","slug":"proj_1"}"#, "needs `key`"),
        (
            r#"{"kind":"category.open","slug":"proj_1","category":"vibes"}"#,
            "category",
        ),
        (r#"{"kind":"camera.fit","slugs":[]}"#, "1-12"),
    ] {
        let out = dispatch_with_sys(&pool, Some(&sys), "default", &control_line(action))
            .expect("dispatch ok");
        assert!(out.canvas_controls.is_empty(), "{action} should refuse");
        assert!(
            out.warnings.iter().any(|w| w.contains(needle)),
            "{action}: wanted `{needle}` in {:?}",
            out.warnings
        );
    }
    // Fail closed when no system DB is reachable — even for slug-less kinds.
    let blind = dispatch(&pool, "default", &control_line(r#"{"kind":"camera.read"}"#))
        .expect("dispatch ok");
    assert!(blind.canvas_controls.is_empty());
    assert!(
        blind.warnings.iter().any(|w| w.contains("not reachable")),
        "{:?}",
        blind.warnings
    );
}

#[test]
fn canvas_control_resolves_fit_slugs_and_caps_actions_per_turn() {
    let pool = test_pool();
    let sys = canvas_sys_pool(Some(CANVAS_FIXTURE));
    // fit with names → canonical slugs.
    let fit = dispatch_with_sys(
        &pool,
        Some(&sys),
        "default",
        &control_line(r#"{"kind":"camera.fit","slugs":["Personas","Vibeman"]}"#),
    )
    .expect("dispatch ok");
    assert_eq!(fit.canvas_controls.len(), 1, "warnings: {:?}", fit.warnings);
    let fit_action: serde_json::Value =
        serde_json::from_str(&fit.canvas_controls[0].action).expect("valid JSON");
    assert_eq!(fit_action["slugs"], serde_json::json!(["proj_1", "proj_2"]));

    // Six steering ops in one turn → first four kept, the rest warned away.
    let line = r#"OP: {"op":"propose_action","action":"canvas_control","params":{"action":{"kind":"camera.read"}},"rationale":"w"}"#;
    let burst = std::iter::repeat(line)
        .take(6)
        .collect::<Vec<_>>()
        .join("\n");
    let out = dispatch_with_sys(&pool, Some(&sys), "default", &burst).expect("dispatch ok");
    assert_eq!(out.canvas_controls.len(), CANVAS_CONTROL_MAX_PER_TURN);
    assert!(
        out.warnings.iter().any(|w| w.contains("camera thrash")),
        "{:?}",
        out.warnings
    );
}

#[test]
fn canvas_actions_are_allowed_actions_not_read_ops() {
    // The two lists must not overlap: an action in READ_OPS would auto-fire
    // with no approval card and no executor, silently doing nothing.
    for action in [
        "canvas_dispatch",
        "canvas_group_dispatch",
        "canvas_run_idea_scan",
    ] {
        assert!(
            ALLOWED_ACTIONS.contains(&action),
            "{action} needs an executor arm"
        );
        assert!(!READ_OPS.contains(&action), "{action} must not auto-fire");
    }
    for action in ["describe_canvas_project", "describe_canvas_freshness"] {
        assert!(READ_OPS.contains(&action));
        assert!(
            !ALLOWED_ACTIONS.contains(&action),
            "{action} has no executor; listing it would create a dead approval card"
        );
    }
}

#[test]
fn read_op_without_a_query_is_rejected_except_list_teams() {
    let pool = test_pool();
    for action in READ_OPS {
        if READ_OPS_QUERY_OPTIONAL.contains(action) {
            continue;
        }
        let text = format!(r#"OP: {{"op":"propose_action","action":"{action}","params":{{}}}}"#);
        let out = dispatch(&pool, "default", &text).expect("dispatch ok");
        assert!(
            out.warnings.iter().any(|w| w.contains("missing `query`")),
            "{action}: {:?}",
            out.warnings
        );
    }
    for action in READ_OPS_QUERY_OPTIONAL {
        let text = format!(r#"OP: {{"op":"propose_action","action":"{action}","params":{{}}}}"#);
        let out = dispatch(&pool, "default", &text).expect("dispatch ok");
        assert!(out.warnings.is_empty(), "{action}: {:?}", out.warnings);
    }
}

#[test]
fn describe_persona_returns_bounded_detail_and_the_real_id() {
    let sys = read_op_sys_pool();
    seed_read_op_rows(&sys);
    let out = describe_persona(&sys, "Scout");
    assert!(out.contains("`p_scout`"), "{out}");
    assert!(
        out.contains("opus") || out.contains("claude-opus-4-5"),
        "{out}"
    );
    assert!(out.contains("SDLC"), "{out}");
    assert!(
        out.len() <= READ_OP_DETAIL_CHARS,
        "unbounded: {}",
        out.len()
    );

    // A pathological system prompt must not blow the bound.
    sys.get()
        .unwrap()
        .execute(
            "UPDATE personas SET system_prompt = ?1 WHERE id = 'p_scout'",
            params!["x".repeat(200_000)],
        )
        .unwrap();
    let big = describe_persona(&sys, "p_scout");
    assert!(
        big.len() <= READ_OP_DETAIL_CHARS,
        "unbounded: {}",
        big.len()
    );
}

#[test]
fn describe_persona_handles_an_unknown_id_gracefully() {
    let sys = read_op_sys_pool();
    seed_read_op_rows(&sys);
    let out = describe_persona(&sys, "00000000-0000-0000-0000-000000000000");
    assert!(out.contains("No agent matches"), "{out}");
    assert!(
        out.contains("Scout"),
        "should name a real alternative: {out}"
    );
    assert!(out.contains("do not invent an id"), "{out}");
}

#[test]
fn describe_context_resolves_by_name_and_by_id() {
    let sys = read_op_sys_pool();
    seed_read_op_rows(&sys);
    for q in ["Companion Prompt", "ctx_1", "companion"] {
        let out = describe_context(&sys, q);
        assert!(out.contains("`ctx_1`"), "query {q}: {out}");
        assert!(out.contains("AI Companion"), "query {q}: {out}");
        assert!(out.len() <= READ_OP_DETAIL_CHARS);
    }
    let miss = describe_context(&sys, "no-such-context");
    assert!(miss.contains("No dev context matches"), "{miss}");
}

#[test]
fn list_teams_returns_the_team_id_assign_team_needs() {
    let sys = read_op_sys_pool();
    seed_read_op_rows(&sys);
    let out = list_teams(&sys, "");
    assert!(out.contains("`team_abc`"), "{out}");
    assert!(out.contains("1 members"), "{out}");
    assert!(out.contains("1 of 1 teams"), "{out}");
    assert!(out.len() <= READ_OP_DETAIL_CHARS);

    assert!(list_teams(&sys, "SDL").contains("`team_abc`"));
    assert!(list_teams(&sys, "nope").contains("No team matches"));
}

#[test]
fn list_teams_is_bounded_and_honest_at_scale() {
    let sys = read_op_sys_pool();
    {
        let conn = sys.get().unwrap();
        for n in 0..200 {
            conn.execute(
                "INSERT INTO persona_teams (id, name, description, enabled, updated_at)
                 VALUES (?1, ?2, ?3, 1, '2026-01-01')",
                params![
                    format!("team_{n:04}"),
                    format!("Team {n}"),
                    "A team with a fairly long description to pad the row out."
                ],
            )
            .unwrap();
        }
    }
    let out = list_teams(&sys, "");
    assert!(
        out.len() <= READ_OP_DETAIL_CHARS,
        "unbounded: {}",
        out.len()
    );
    // Truncated by the char budget before the row cap, and it says so.
    assert!(out.contains(" of 200 teams"), "{out}");
    assert!(!out.contains("200 of 200 teams"), "{out}");
}

#[test]
fn describe_skill_without_a_match_names_real_alternatives() {
    // No sys pool → project skill dirs are unavailable; the op must
    // still answer honestly instead of inventing a skill.
    let out = describe_skill(None, "totally-made-up-skill");
    assert!(out.contains("No installed skill matches"), "{out}");
    assert!(out.contains("Do not invent a skill name"), "{out}");
}

#[test]
fn knowledge_action_ops_create_approval_rows() {
    // The four skills/knowledge actions must be grammar-legal or Athena's
    // proposals are silently dropped (the exact failure the build_oneshot
    // comment on ALLOWED_ACTIONS documents).
    for op in [
        r###"{"op":"propose_action","action":"skill_sync","params":{"skill":"research","action":"sync","targets":["personas"]},"rationale":"r"}"###,
        r###"{"op":"propose_action","action":"run_pattern_harvest","params":{"project":"personas"},"rationale":"r"}"###,
        r###"{"op":"propose_action","action":"apply_pattern","params":{"target_project":"personas","pattern_ids":["wk_1"]},"rationale":"r"}"###,
        r###"{"op":"propose_action","action":"evaluate_pattern","params":{"target_project":"personas"},"rationale":"r"}"###,
    ] {
        let out = dispatch_op(op);
        assert_eq!(
            out.approvals.len(),
            1,
            "op {op} — warnings: {:?}",
            out.warnings
        );
    }
}

#[test]
fn knowledge_read_ops_answer_without_a_query() {
    // Both digests are query-optional: an empty query is the overview, so
    // it must not be rejected as "missing query".
    for action in ["describe_skill_fleet", "describe_knowledge"] {
        let op = format!(r###"{{"op":"propose_action","action":"{action}","params":{{}}}}"###);
        let out = dispatch_op(&op);
        assert!(
            out.approvals.is_empty(),
            "{action} is a read op, not an approval"
        );
        assert!(
            !out.warnings.iter().any(|w| w.contains("missing `query`")),
            "{action} must be query-optional — warnings: {:?}",
            out.warnings
        );
    }
}

#[test]
fn compose_tour_rejects_unknown_anchor_wholesale() {
    let op = r###"{"op":"propose_action","action":"compose_tour","params":{"topic":"x","title":"T","steps":[{"title":"S","description":"D","nav":{"sidebarSection":"schedules"},"highlightTestId":"totally-hallucinated-anchor-xyz"}]}}"###;
    let out = dispatch_op(op);
    assert!(out.composed_tours.is_empty());
    assert!(
        out.warnings.iter().any(|w| w.contains("unknown anchor")),
        "warnings: {:?}",
        out.warnings
    );
}
