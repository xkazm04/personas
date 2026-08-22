use super::*;
use crate::eval::{WEIGHT_OUTPUT_QUALITY, WEIGHT_PROTOCOL_COMPLIANCE, WEIGHT_TOOL_ACCURACY};

#[test]
fn truncate_chars_never_panics_on_multibyte_boundary() {
    // A 4-byte emoji straddling every byte index up to the char limit is the
    // exact condition that made `&s[..n]` panic. Counting chars must be safe.
    let s = "😀".repeat(50); // 50 chars, 200 bytes
    for n in 0..=60 {
        let out = truncate_chars(&s, n);
        assert_eq!(out.chars().count(), n.min(50));
        assert!(s.starts_with(&out));
    }
}

#[test]
fn truncate_chars_keeps_short_strings_whole() {
    assert_eq!(truncate_chars("hello", 2000), "hello");
    assert_eq!(truncate_chars("", 500), "");
    // Smart quotes / em-dashes are multibyte too — must pass through intact.
    let mixed = "“café” — 你好 🚀";
    assert_eq!(truncate_chars(mixed, 2000), mixed);
}

/// REGRESSION (UAT 2026-07-20): the scenario cache key must be STABLE across
/// a prompt change, so every version of a persona is graded on one scenario
/// set and the Δ column compares like with like. When the prompt was in the
/// key, a version-scoped measure (which swaps the version's prompt onto the
/// persona) regenerated the exam and the Δ subtracted scores from different
/// questions.
#[test]
fn scenario_cache_key_is_stable_across_prompt_changes() {
    let mut p = personas_db::models::Persona {
        id: "persona-1".into(),
        ..Default::default()
    };
    p.system_prompt = "v1 system prompt".into();
    p.structured_prompt = Some("{\"instructions\":\"v1\"}".into());
    let k1 = scenario_cache_key(&p, &[], None);

    // Simulate a version-scoped measure swapping v2's prompt onto the persona.
    p.system_prompt = "v2 system prompt — materially different".into();
    p.structured_prompt = Some("{\"instructions\":\"v2 rewritten\"}".into());
    let k2 = scenario_cache_key(&p, &[], None);

    assert_eq!(k1, k2, "prompt text must not change the scenario cache key");
}

/// The key must still discriminate on the axes that legitimately change the
/// exam: persona identity, the tool surface, and the use-case filter.
#[test]
fn scenario_cache_key_discriminates_persona_tools_and_filter() {
    let p1 = personas_db::models::Persona {
        id: "a".into(),
        ..Default::default()
    };
    let p2 = personas_db::models::Persona {
        id: "b".into(),
        ..Default::default()
    };
    assert_ne!(
        scenario_cache_key(&p1, &[], None),
        scenario_cache_key(&p2, &[], None),
        "different personas must get different scenario sets"
    );
    assert_ne!(
        scenario_cache_key(&p1, &[], None),
        scenario_cache_key(&p1, &[], Some("uc-1")),
        "a use-case filter must change the scenario set"
    );
}

// -- Direction 1: unscoped-arena attribution --------------------------------

fn insert_version(conn: &rusqlite::Connection, id: &str, persona_id: &str, num: i32, tag: &str) {
    conn.execute(
        "INSERT INTO persona_prompt_versions (id, persona_id, version_number, tag, created_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        rusqlite::params![id, persona_id, num, tag],
    )
    .unwrap();
}

/// The `production`-tagged version is the active one even when a later
/// version has a higher number — matching `LabVersionsTable`'s rule so
/// unscoped arena results attribute to the same version the UI calls live.
#[test]
fn resolve_active_version_prefers_production_then_highest_number() {
    let pool = personas_db::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    // Insert with FK checks off so we don't need to materialise a full persona.
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    let pid = "persona-arena-attr";
    insert_version(&conn, "v1", pid, 1, "experimental");
    insert_version(&conn, "v2", pid, 2, "production");
    insert_version(&conn, "v3", pid, 3, "experimental");
    drop(conn);
    assert_eq!(
        resolve_active_version(&pool, pid),
        Some(("v2".to_string(), 2))
    );
}

/// With no production tag, the highest `version_number` wins.
#[test]
fn resolve_active_version_falls_back_to_highest_number() {
    let pool = personas_db::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    let pid = "persona-no-prod";
    insert_version(&conn, "a1", pid, 1, "experimental");
    insert_version(&conn, "a2", pid, 5, "experimental");
    insert_version(&conn, "a3", pid, 3, "archived");
    drop(conn);
    assert_eq!(
        resolve_active_version(&pool, pid),
        Some(("a2".to_string(), 5))
    );
}

/// A persona with no prompt versions stays version-less — we never invent an
/// id (the acceptance's explicit NULL-preserving case).
#[test]
fn resolve_active_version_none_when_no_versions() {
    let pool = personas_db::init_test_db().unwrap();
    assert_eq!(resolve_active_version(&pool, "persona-empty"), None);
}

// -- Direction 2: best-value must not be awarded on hardcoded-zero cost -----

fn ranking(model: &str, value_score: i64, cost_unknown: bool) -> serde_json::Value {
    serde_json::json!({ "model_id": model, "value_score": value_score, "cost_unknown": cost_unknown })
}

/// A cost-unknown model (Ollama, hardcoded-zero cost) posts the top raw
/// value_score but must never win best-value — the cost-known runner-up does.
#[test]
fn best_value_skips_cost_unknown_models() {
    let rankings = vec![
        ranking("ollama-local", 100, true),
        ranking("sonnet", 72, false),
        ranking("haiku", 88, false),
    ];
    assert_eq!(best_value_model(&rankings), "haiku");
}

/// When every candidate is cost-unknown there is no honest best-value winner.
#[test]
fn best_value_unknown_when_all_cost_unknown() {
    let rankings = vec![ranking("ollama-a", 90, true), ranking("ollama-b", 95, true)];
    assert_eq!(best_value_model(&rankings), "unknown");
}

/// Ollama is the documented cost-unknown provider; everything else is known.
#[test]
fn provider_cost_known_only_for_non_ollama() {
    assert!(!provider_cost_is_known(
        personas_core::types::providers::OLLAMA
    ));
    assert!(provider_cost_is_known("anthropic"));
    assert!(provider_cost_is_known("qwen"));
}

// -- Direction 3: bounded engine / prompt cancellation ----------------------

/// The cell concurrency cap is a sane small positive number, not accidentally
/// zero (which would deadlock the semaphore) or unbounded.
#[test]
fn lab_cell_concurrency_is_bounded() {
    assert!(LAB_CELL_CONCURRENCY >= 1 && LAB_CELL_CONCURRENCY <= 8);
}

/// `await_cancel` resolves promptly once the flag flips — this is what lets a
/// running cell notice cancellation within the poll window.
#[tokio::test]
async fn await_cancel_resolves_when_flag_set() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let flag = std::sync::Arc::new(AtomicBool::new(false));
    let f = flag.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        f.store(true, Ordering::Release);
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), await_cancel(&flag))
        .await
        .expect("await_cancel should resolve shortly after the flag is set");
}

/// The biased cancel-race prefers cancellation over an in-flight execution,
/// so a cell is abandoned (and its CLI child dropped/killed) immediately on
/// cancel instead of blocking on the multi-minute CLI timeout.
#[tokio::test]
async fn cancel_race_wins_over_slow_execution() {
    use std::sync::atomic::AtomicBool;
    let flag = std::sync::Arc::new(AtomicBool::new(true)); // already cancelled
    let result: Result<(), String> =
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            tokio::select! {
                biased;
                _ = await_cancel(&flag) => Err("Cancelled".to_string()),
                _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => Ok(()),
            }
        })
        .await
        .expect("cancel branch must win well before the 30s execution stub");
    assert_eq!(result, Err("Cancelled".to_string()));
}

// -- Direction 2: sandbox-aware scoring -------------------------------------

/// Build a `ScoreResult` from just the three sub-scores + eval method; the
/// rest is irrelevant to the verdict/composite paths under test.
fn score(ta: Option<i32>, oq: Option<i32>, pc: Option<i32>, method: &str) -> ScoreResult {
    ScoreResult {
        tool_accuracy: ta,
        output_quality: oq,
        protocol_compliance: pc,
        output_preview: None,
        tool_calls_actual: None,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0.0,
        duration_ms: 0,
        error_message: None,
        rationale: None,
        suggestions: None,
        eval_method: Some(method.to_string()),
        events: Vec::new(),
    }
}

/// The regression this direction fixes: a sandbox cell carries no
/// `tool_accuracy` (the agent was told not to call real tools), so the old
/// `unwrap_or(0)` composite scored output_quality 80 / protocol 80 as
/// `0*0.4 + 80*0.4 + 80*0.2 = 48` → below the 50 threshold → a spurious
/// "failed". Renormalising over the present weights scores it 80 → "passed".
#[test]
fn verdict_status_sandbox_cell_not_auto_failed_on_missing_tool_accuracy() {
    let s = score(None, Some(80), Some(80), "llm");
    assert_eq!(
        verdict_status(&s),
        "passed",
        "a strong sandbox cell must not fail just because tool_accuracy is absent",
    );
}

/// Real-tool cells (all three sub-scores present) are unchanged: the
/// renormalised composite over the full weight base equals the previous
/// weighted sum, so the pass/fail boundary is identical.
#[test]
fn verdict_status_real_cell_scoring_unchanged() {
    // 40*0.4 + 40*0.4 + 40*0.2 = 40 → below 50 → failed (was failed before).
    assert_eq!(
        verdict_status(&score(Some(40), Some(40), Some(40), "llm")),
        "failed"
    );
    // 60*0.4 + 60*0.4 + 60*0.2 = 60 → passed (was passed before).
    assert_eq!(
        verdict_status(&score(Some(60), Some(60), Some(60), "llm")),
        "passed"
    );
    // Mixed real cell straddling the boundary: 0*0.4 + 90*0.4 + 90*0.2 = 54
    // → passed; the zero here is a real judged tool_accuracy, not an absence.
    assert_eq!(
        verdict_status(&score(Some(0), Some(90), Some(90), "llm")),
        "passed"
    );
}

/// A degraded evaluation (timeout / heuristic fallback) is still
/// "inconclusive" regardless of the sub-scores — the sandbox change does not
/// weaken that guard.
#[test]
fn verdict_status_degraded_eval_still_inconclusive() {
    assert_eq!(
        verdict_status(&score(None, Some(80), Some(80), "heuristic_fallback")),
        "inconclusive",
    );
    assert_eq!(
        verdict_status(&score(Some(90), Some(90), Some(90), "timeout")),
        "inconclusive",
    );
}

/// A cell with no sub-scores at all is inconclusive, never a spurious
/// "failed".
#[test]
fn verdict_status_no_subscores_is_inconclusive() {
    assert_eq!(
        verdict_status(&score(None, None, None, "llm")),
        "inconclusive"
    );
}

/// The renormalisation math: absent tool_accuracy reweights output_quality
/// and protocol over their own base (0.4 + 0.2), so 80/80 → 80, while
/// full-coverage renormalises to the same value as the plain weighted sum.
#[test]
fn renormalized_composite_reweights_present_scores() {
    // Sandbox: ta absent → (80*0.4 + 80*0.2) / 0.6 = 80.
    let sandbox = renormalized_composite(None, Some(80.0), Some(80.0)).unwrap();
    assert!((sandbox - 80.0).abs() < 1e-9, "got {sandbox}");
    // Full coverage equals the canonical weighted sum.
    let full = renormalized_composite(Some(50.0), Some(80.0), Some(90.0)).unwrap();
    let expected = 50.0 * WEIGHT_TOOL_ACCURACY
        + 80.0 * WEIGHT_OUTPUT_QUALITY
        + 90.0 * WEIGHT_PROTOCOL_COMPLIANCE;
    assert!(
        (full - expected).abs() < 1e-9,
        "got {full}, expected {expected}"
    );
    // Nothing present → None.
    assert_eq!(renormalized_composite(None, None, None), None);
}
