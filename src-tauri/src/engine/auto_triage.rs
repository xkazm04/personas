//! Second-pass LLM evaluator for the `auto_triage` review policy.
//!
//! When a capability declares `review_policy.mode = "auto_triage"`, an emitted
//! `manual_review` is intended to be evaluated against the persona's stated
//! `decision_principles` rather than queued for a human.
//!
//! The C5/C6 MVP made `auto_triage` stop falling through to `manual_review`
//! by storing the row and immediately marking it `Resolved` with a distinct
//! audit tag. That broke parity with `trust_llm` only in audit-tag space —
//! the row was still trusted unconditionally. This module replaces that
//! fast-path with a real second LLM round-trip:
//!
//!   1. The dispatcher creates the review row (status: `pending`).
//!   2. It calls [`spawn_evaluator_task`], which fires a tokio task with all
//!      necessary context cloned/owned — the dispatch loop is never blocked.
//!   3. The task loads the persona's `decision_principles` from
//!      `last_design_result`, builds a prompt, runs Claude CLI in single-turn
//!      mode, parses an `{verdict, reasoning}` JSON response, and updates
//!      the review row to `Approved` / `Rejected`.
//!   4. On any failure (CLI spawn, timeout, JSON parse) the task falls back
//!      to `Resolved` with a distinct audit tag — preserving the C6 MVP
//!      behaviour so a degraded evaluator never blocks a run.
//!
//! Audit tags emitted to `policy_events` (mirrors `policy_event.rs` doc):
//!   * `review.auto_triage.approved`  — LLM approved the agent's output.
//!   * `review.auto_triage.rejected`  — LLM rejected the agent's output.
//!   * `review.auto_triage.fallback`  — Evaluator failed; row auto-resolved
//!     as a degraded equivalent of the MVP.

use crate::db::models::ManualReviewStatus;
use crate::db::repos::communication::manual_reviews as review_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::policy_events as policy_events_repo;
use crate::db::DbPool;
use crate::engine::cli_process::CliProcessDriver;
use crate::engine::parser;
use crate::engine::prompt;
use crate::engine::types::StreamLineType;

const EVALUATOR_TIMEOUT_SECS: u64 = 120;

// ---------------------------------------------------------------------------
// Verdict types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoTriageVerdict {
    Approve,
    Reject,
}

impl AutoTriageVerdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::Reject => "reject",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoTriageDecision {
    pub verdict: AutoTriageVerdict,
    pub reasoning: String,
}

// ---------------------------------------------------------------------------
// Request — bundle the inputs the evaluator needs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct AutoTriageRequest {
    pub review_title: String,
    pub review_description: Option<String>,
    pub review_severity: Option<String>,
    pub review_context_data: Option<String>,
    pub review_suggested_actions: Option<String>,
    pub decision_principles: Vec<String>,
    pub principles: Vec<String>,
    pub constraints: Vec<String>,
    /// Per-capability `review_policy.context` rationale — one short sentence
    /// the build LLM emitted under §Phase C field #4. Optional; empty when
    /// absent.
    pub review_policy_context: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure helpers — prompt building, verdict parsing, principles extraction
// ---------------------------------------------------------------------------

const VERDICT_INSTRUCTION: &str = r#"Decide whether the manual_review payload should be APPROVED (the agent's output complies with the persona's decision principles and may proceed without human intervention) or REJECTED (the output materially violates one or more principles or constraints).

Respond with ONLY a single JSON object on one line, no code fences, no surrounding prose:
{"verdict": "approve" | "reject", "reasoning": "<one short sentence justifying the verdict>"}

The first character of your response MUST be `{`."#;

/// Build the evaluator prompt. Pure — no I/O, suitable for unit tests.
pub fn build_evaluator_prompt(req: &AutoTriageRequest) -> String {
    let mut sections: Vec<String> = Vec::with_capacity(8);

    sections.push(
        "You are an auto-triage evaluator. A persona-driven agent emitted a manual_review request, and the capability is configured for auto_triage — meaning a human review is bypassed if the agent's output is consistent with the persona's stated decision principles.".to_string(),
    );

    if !req.decision_principles.is_empty() {
        sections.push(format!(
            "DECISION PRINCIPLES (the primary basis for your verdict):\n{}",
            bullet_list(&req.decision_principles)
        ));
    } else {
        sections.push(
            "DECISION PRINCIPLES: (none declared — defer to general principles and constraints below)".to_string(),
        );
    }

    if !req.principles.is_empty() {
        sections.push(format!(
            "PERSONA PRINCIPLES (cross-cutting rules — supporting context):\n{}",
            bullet_list(&req.principles)
        ));
    }

    if !req.constraints.is_empty() {
        sections.push(format!(
            "PERSONA CONSTRAINTS (hard limits — a violation is sufficient grounds for REJECT):\n{}",
            bullet_list(&req.constraints)
        ));
    }

    if let Some(ctx) = req
        .review_policy_context
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        sections.push(format!("CAPABILITY REVIEW POLICY RATIONALE:\n{ctx}"));
    }

    let mut payload = String::from("REVIEW PAYLOAD UNDER EVALUATION:\n");
    payload.push_str(&format!("- Title: {}\n", req.review_title.trim()));
    if let Some(d) = req
        .review_description
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        payload.push_str(&format!("- Description: {d}\n"));
    }
    if let Some(s) = req
        .review_severity
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        payload.push_str(&format!("- Severity: {s}\n"));
    }
    if let Some(ctx) = req
        .review_context_data
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        payload.push_str(&format!("- Context Data: {}\n", truncate(ctx, 4000)));
    }
    if let Some(actions) = req
        .review_suggested_actions
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        payload.push_str(&format!(
            "- Suggested Actions: {}\n",
            truncate(actions, 1500)
        ));
    }
    sections.push(payload.trim_end().to_string());

    sections.push(VERDICT_INSTRUCTION.to_string());

    sections.join("\n\n")
}

/// Parse a verdict response. Tolerates surrounding prose by extracting the
/// first balanced `{...}` block (mirrors `genome_critique::parse_rewrite_response`
/// and `eval::parse_llm_eval_response`). Pure — no I/O.
pub fn parse_verdict_response(raw: &str) -> Result<AutoTriageDecision, String> {
    #[derive(serde::Deserialize)]
    struct Verdict {
        verdict: String,
        #[serde(default)]
        reasoning: String,
    }

    let trimmed = raw.trim();
    let parsed: Option<Verdict> = serde_json::from_str(trimmed).ok().or_else(|| {
        let start = trimmed.find('{')?;
        let end = trimmed.rfind('}')?;
        if end <= start {
            return None;
        }
        serde_json::from_str(&trimmed[start..=end]).ok()
    });

    let Some(v) = parsed else {
        let head = &trimmed[..trimmed.len().min(500)];
        return Err(format!(
            "Failed to parse verdict JSON. Head (≤500 chars): {head}"
        ));
    };

    let verdict = match v.verdict.trim().to_ascii_lowercase().as_str() {
        "approve" | "approved" | "accept" | "accepted" | "ok" => AutoTriageVerdict::Approve,
        "reject" | "rejected" | "deny" | "denied" => AutoTriageVerdict::Reject,
        other => {
            return Err(format!("Unrecognised verdict value: {other:?}"));
        }
    };
    let reasoning = v.reasoning.trim().to_string();
    Ok(AutoTriageDecision { verdict, reasoning })
}

/// Extract `decision_principles`, `principles`, `constraints` from a persona's
/// `last_design_result` JSON. Pure — no DB. Returns empty vectors when fields
/// are missing or malformed.
///
/// Looks for the v3 shape: `{ "persona": { "decision_principles": [...],
/// "principles": [...], "constraints": [...] } }`. Falls back to top-level
/// fields when nested under `persona` is absent.
pub fn extract_principles_from_design_result(
    design_result_json: &str,
) -> (Vec<String>, Vec<String>, Vec<String>) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(design_result_json) else {
        return (Vec::new(), Vec::new(), Vec::new());
    };

    // Prefer the nested v3 shape; fall back to top-level legacy shape.
    let scope = v.get("persona").unwrap_or(&v);

    let dp = string_array(scope.get("decision_principles"));
    let p = string_array(scope.get("principles"));
    let c = string_array(scope.get("constraints"));
    (dp, p, c)
}

/// Extract a per-UC `review_policy.context` rationale from a persona's
/// `last_design_result` JSON for a given `use_case_id`. Pure — no DB.
pub fn extract_review_policy_context(
    design_result_json: &str,
    use_case_id: &str,
) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(design_result_json).ok()?;
    let cases = v.get("use_cases").and_then(|x| x.as_array())?;
    let uc = cases
        .iter()
        .find(|u| u.get("id").and_then(|i| i.as_str()) == Some(use_case_id))?;
    uc.get("review_policy")
        .and_then(|rp| rp.get("context"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// Async LLM call
// ---------------------------------------------------------------------------

/// Spawn the Claude CLI in single-turn print mode and pipe the prompt to
/// stdin. Returns the raw assistant text (or an error on timeout / spawn
/// failure). Mirrors `genome_critique::run_critique_cli`.
async fn run_evaluator_cli(prompt_text: &str) -> Result<String, String> {
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let mut driver = CliProcessDriver::spawn_temp_no_stderr(&cli_args, "personas-auto-triage")
        .map_err(|e| format!("Failed to spawn evaluator CLI: {e}"))?;
    driver.write_stdin(prompt_text.as_bytes()).await;

    let mut assistant_text = String::new();
    let timeout = tokio::time::Duration::from_secs(EVALUATOR_TIMEOUT_SECS);
    driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            if let StreamLineType::AssistantText { text } = line_type {
                assistant_text.push_str(&text);
                assistant_text.push('\n');
            }
        })
        .await
        .map_err(|e| format!("Evaluator CLI timed out or failed: {e}"))?;

    let _ = driver.finish().await;
    Ok(assistant_text)
}

/// End-to-end: build prompt, run CLI, parse verdict.
pub async fn evaluate(req: &AutoTriageRequest) -> Result<AutoTriageDecision, String> {
    let prompt_text = build_evaluator_prompt(req);
    let raw = run_evaluator_cli(&prompt_text).await?;
    parse_verdict_response(&raw)
}

// ---------------------------------------------------------------------------
// Spawn helper — fire-and-forget background evaluator + DB updates
// ---------------------------------------------------------------------------

/// Owned snapshot of everything the spawned evaluator task needs. Captured
/// at dispatch time so the task is independent of the dispatcher's lifetimes.
#[derive(Debug, Clone)]
pub struct SpawnedEvaluatorContext {
    pub pool: DbPool,
    pub review_id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub review_title: String,
    pub review_description: Option<String>,
    pub review_severity: Option<String>,
    pub review_context_data: Option<String>,
    pub review_suggested_actions: Option<String>,
}

/// Spawn a tokio task that runs the evaluator and finalises the review row.
///
/// The task is fully self-contained — it loads `persona.last_design_result`
/// itself (so the dispatch loop doesn't pay the DB roundtrip on the hot path),
/// runs the LLM, and updates the review status. On any failure it falls back
/// to `Resolved` with a `review.auto_triage.fallback` policy_event so the
/// run is never blocked by a degraded evaluator.
pub fn spawn_evaluator_task(ctx: SpawnedEvaluatorContext) {
    tokio::spawn(async move {
        run_and_finalize(ctx).await;
    });
}

async fn run_and_finalize(ctx: SpawnedEvaluatorContext) {
    // Load principles + per-UC rationale on the spawned task to keep the
    // dispatch loop hot-path free of this DB hit.
    let (decision_principles, principles, constraints, review_policy_context) =
        load_principles_and_context(&ctx);

    let request = AutoTriageRequest {
        review_title: ctx.review_title.clone(),
        review_description: ctx.review_description.clone(),
        review_severity: ctx.review_severity.clone(),
        review_context_data: ctx.review_context_data.clone(),
        review_suggested_actions: ctx.review_suggested_actions.clone(),
        decision_principles,
        principles,
        constraints,
        review_policy_context,
    };

    match evaluate(&request).await {
        Ok(decision) => apply_verdict(&ctx, decision),
        Err(err) => apply_fallback(&ctx, &err),
    }
}

fn load_principles_and_context(
    ctx: &SpawnedEvaluatorContext,
) -> (Vec<String>, Vec<String>, Vec<String>, Option<String>) {
    let Ok(persona) = persona_repo::get_by_id(&ctx.pool, &ctx.persona_id) else {
        return (Vec::new(), Vec::new(), Vec::new(), None);
    };
    let Some(json) = persona.last_design_result.as_deref() else {
        return (Vec::new(), Vec::new(), Vec::new(), None);
    };
    let (dp, p, c) = extract_principles_from_design_result(json);
    let rpc = ctx
        .use_case_id
        .as_deref()
        .and_then(|uc| extract_review_policy_context(json, uc));
    (dp, p, c, rpc)
}

fn apply_verdict(ctx: &SpawnedEvaluatorContext, decision: AutoTriageDecision) {
    // The evaluator ran async; while the LLM was thinking a human may have
    // resolved this review (or GC may have removed it). Only Pending → verdict
    // is a legitimate transition here. If the review already left Pending the
    // human decision wins — apply nothing (the update_status CAS keys on the
    // CURRENT status, so it would otherwise happily overwrite the human's
    // resolution, and the Resolved fallback below would clobber it too).
    match review_repo::get_by_id(&ctx.pool, &ctx.review_id) {
        Ok(review) if review.status == ManualReviewStatus::Pending => {}
        Ok(review) => {
            tracing::info!(
                review_id = %ctx.review_id,
                current = %review.status.as_str(),
                verdict = decision.verdict.as_str(),
                "auto_triage verdict superseded — review already resolved; dropping verdict",
            );
            return;
        }
        Err(e) => {
            tracing::info!(
                review_id = %ctx.review_id,
                error = %e,
                "auto_triage could not load review (likely GC'd) — dropping verdict",
            );
            return;
        }
    }

    let (status, audit_tag) = match decision.verdict {
        AutoTriageVerdict::Approve => (ManualReviewStatus::Approved, "review.auto_triage.approved"),
        AutoTriageVerdict::Reject => (ManualReviewStatus::Rejected, "review.auto_triage.rejected"),
    };
    let note = format!(
        "auto_triage LLM verdict: {} — {}",
        decision.verdict.as_str(),
        if decision.reasoning.is_empty() {
            "(no reasoning provided)"
        } else {
            decision.reasoning.as_str()
        }
    );
    if let Err(e) =
        review_repo::update_status(&ctx.pool, &ctx.review_id, status, Some(note.clone()))
    {
        tracing::warn!(
            review_id = %ctx.review_id,
            verdict = decision.verdict.as_str(),
            error = %e,
            "auto_triage evaluator could not transition review status — falling back to Resolved",
        );
        // Try to land *something* so the row doesn't sit in pending forever.
        let _ = review_repo::update_status(
            &ctx.pool,
            &ctx.review_id,
            ManualReviewStatus::Resolved,
            Some(format!(
                "auto_triage update_status failure ({}) — original verdict: {}",
                e,
                decision.verdict.as_str()
            )),
        );
        record_policy_event(
            ctx,
            "review.auto_triage.fallback",
            "auto_resolved",
            &format!("update_status({}) failed: {e}", decision.verdict.as_str()),
        );
        return;
    }
    record_policy_event(
        ctx,
        audit_tag,
        match decision.verdict {
            AutoTriageVerdict::Approve => "approved",
            AutoTriageVerdict::Reject => "rejected",
        },
        &note,
    );
}

fn apply_fallback(ctx: &SpawnedEvaluatorContext, error: &str) {
    let note = format!("auto_triage evaluator failed — auto-resolved as fallback: {error}");
    if let Err(e) = review_repo::update_status(
        &ctx.pool,
        &ctx.review_id,
        ManualReviewStatus::Resolved,
        Some(note.clone()),
    ) {
        tracing::warn!(
            review_id = %ctx.review_id,
            error = %e,
            original_failure = error,
            "auto_triage fallback update_status also failed — review stays in pending",
        );
    }
    record_policy_event(ctx, "review.auto_triage.fallback", "auto_resolved", &note);
}

fn record_policy_event(
    ctx: &SpawnedEvaluatorContext,
    policy_kind: &str,
    action: &str,
    reason: &str,
) {
    if let Err(e) = policy_events_repo::insert(
        &ctx.pool,
        &ctx.execution_id,
        &ctx.persona_id,
        ctx.use_case_id.as_deref(),
        policy_kind,
        action,
        Some(&ctx.review_title),
        Some(reason),
    ) {
        tracing::warn!(
            review_id = %ctx.review_id,
            policy_kind,
            action,
            error = %e,
            "auto_triage policy_event insert failed",
        );
    }
}

// ---------------------------------------------------------------------------
// Internal utility helpers
// ---------------------------------------------------------------------------

fn string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(arr) = value.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn bullet_list(items: &[String]) -> String {
    items
        .iter()
        .map(|s| format!("- {s}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push_str("...[truncated]");
        out
    }
}

// ---------------------------------------------------------------------------
// Tests — pure helpers only. The async CLI path is exercised in integration
// tests that spawn the real Claude CLI; unit tests stay deterministic.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> AutoTriageRequest {
        AutoTriageRequest {
            review_title: "Outbound email draft for Q4 budget".to_string(),
            review_description: Some(
                "Drafted reply to CFO; flagging for human glance.".to_string(),
            ),
            review_severity: Some("medium".to_string()),
            review_context_data: Some(r#"{"recipient":"cfo@example.com"}"#.to_string()),
            review_suggested_actions: Some("Send as drafted".to_string()),
            decision_principles: vec![
                "When uncertain, prefer understatement.".to_string(),
                "Never auto-send to executives without disclaimer.".to_string(),
            ],
            principles: vec!["Direct, lightly wry, never alarmist.".to_string()],
            constraints: vec!["Never auto-reply.".to_string()],
            review_policy_context: Some(
                "Outbound exec replies should match the persona's understatement bias.".to_string(),
            ),
        }
    }

    #[test]
    fn build_evaluator_prompt_includes_all_sections() {
        let req = sample_request();
        let p = build_evaluator_prompt(&req);

        assert!(p.contains("DECISION PRINCIPLES"));
        assert!(p.contains("When uncertain, prefer understatement."));
        assert!(p.contains("PERSONA PRINCIPLES"));
        assert!(p.contains("PERSONA CONSTRAINTS"));
        assert!(p.contains("Never auto-reply."));
        assert!(p.contains("CAPABILITY REVIEW POLICY RATIONALE"));
        assert!(p.contains("REVIEW PAYLOAD UNDER EVALUATION"));
        assert!(p.contains("Outbound email draft for Q4 budget"));
        assert!(p.contains("\"verdict\""));
        // Final character of the instruction tells the model to start with `{`
        assert!(p.contains("MUST be `{`"));
    }

    #[test]
    fn build_evaluator_prompt_handles_missing_principles() {
        let mut req = sample_request();
        req.decision_principles.clear();
        req.principles.clear();
        req.constraints.clear();
        req.review_policy_context = None;
        req.review_description = None;
        req.review_severity = None;
        req.review_context_data = None;
        req.review_suggested_actions = None;

        let p = build_evaluator_prompt(&req);
        // Decision principles fallback line must appear when nothing is declared.
        assert!(p.contains("DECISION PRINCIPLES: (none declared"));
        // Optional sections must be omitted entirely when absent.
        assert!(!p.contains("PERSONA PRINCIPLES"));
        assert!(!p.contains("PERSONA CONSTRAINTS"));
        assert!(!p.contains("CAPABILITY REVIEW POLICY RATIONALE"));
        assert!(!p.contains("- Description:"));
        assert!(!p.contains("- Severity:"));
        assert!(!p.contains("- Context Data:"));
        assert!(!p.contains("- Suggested Actions:"));
        assert!(p.contains("REVIEW PAYLOAD UNDER EVALUATION"));
    }

    #[test]
    fn parse_verdict_response_accepts_clean_json() {
        let raw = r#"{"verdict":"approve","reasoning":"matches understatement principle"}"#;
        let d = parse_verdict_response(raw).unwrap();
        assert_eq!(d.verdict, AutoTriageVerdict::Approve);
        assert_eq!(d.reasoning, "matches understatement principle");
    }

    #[test]
    fn parse_verdict_response_accepts_reject() {
        let raw = r#"{"verdict": "reject", "reasoning": "violates auto-reply constraint"}"#;
        let d = parse_verdict_response(raw).unwrap();
        assert_eq!(d.verdict, AutoTriageVerdict::Reject);
        assert!(d.reasoning.contains("auto-reply"));
    }

    #[test]
    fn parse_verdict_response_extracts_from_surrounding_prose() {
        let raw = r#"Here is my evaluation:

{"verdict":"approve","reasoning":"all good"}

Done."#;
        let d = parse_verdict_response(raw).unwrap();
        assert_eq!(d.verdict, AutoTriageVerdict::Approve);
    }

    #[test]
    fn parse_verdict_response_tolerates_synonyms() {
        for syn in ["approved", "ACCEPT", "accepted", "ok"] {
            let raw = format!(r#"{{"verdict":"{syn}","reasoning":"x"}}"#);
            let d = parse_verdict_response(&raw).unwrap();
            assert_eq!(d.verdict, AutoTriageVerdict::Approve, "synonym {syn}");
        }
        for syn in ["rejected", "deny", "DENIED"] {
            let raw = format!(r#"{{"verdict":"{syn}","reasoning":"x"}}"#);
            let d = parse_verdict_response(&raw).unwrap();
            assert_eq!(d.verdict, AutoTriageVerdict::Reject, "synonym {syn}");
        }
    }

    #[test]
    fn parse_verdict_response_rejects_unknown_verdict() {
        let raw = r#"{"verdict":"maybe","reasoning":"unsure"}"#;
        assert!(parse_verdict_response(raw).is_err());
    }

    #[test]
    fn parse_verdict_response_rejects_unparseable() {
        let raw = "Sorry, I cannot evaluate this.";
        let err = parse_verdict_response(raw).unwrap_err();
        assert!(err.contains("Failed to parse verdict JSON"));
    }

    #[test]
    fn parse_verdict_response_handles_missing_reasoning() {
        let raw = r#"{"verdict":"approve"}"#;
        let d = parse_verdict_response(raw).unwrap();
        assert_eq!(d.verdict, AutoTriageVerdict::Approve);
        assert_eq!(d.reasoning, "");
    }

    #[test]
    fn extract_principles_from_design_result_v3_shape() {
        let json = serde_json::json!({
            "persona": {
                "decision_principles": ["When uncertain, prefer understatement."],
                "principles": ["Direct, lightly wry."],
                "constraints": ["Never auto-reply."],
            }
        })
        .to_string();
        let (dp, p, c) = extract_principles_from_design_result(&json);
        assert_eq!(dp, vec!["When uncertain, prefer understatement."]);
        assert_eq!(p, vec!["Direct, lightly wry."]);
        assert_eq!(c, vec!["Never auto-reply."]);
    }

    #[test]
    fn extract_principles_from_design_result_legacy_top_level() {
        let json = serde_json::json!({
            "decision_principles": ["a"],
            "principles": ["b"],
            "constraints": ["c"],
        })
        .to_string();
        let (dp, p, c) = extract_principles_from_design_result(&json);
        assert_eq!(dp, vec!["a"]);
        assert_eq!(p, vec!["b"]);
        assert_eq!(c, vec!["c"]);
    }

    #[test]
    fn extract_principles_from_design_result_missing_returns_empty() {
        let json = "{}";
        let (dp, p, c) = extract_principles_from_design_result(json);
        assert!(dp.is_empty());
        assert!(p.is_empty());
        assert!(c.is_empty());
    }

    #[test]
    fn extract_principles_from_design_result_invalid_json_returns_empty() {
        let (dp, p, c) = extract_principles_from_design_result("not json");
        assert!(dp.is_empty());
        assert!(p.is_empty());
        assert!(c.is_empty());
    }

    #[test]
    fn extract_review_policy_context_finds_matching_uc() {
        let json = serde_json::json!({
            "use_cases": [
                { "id": "uc_one", "review_policy": { "mode": "auto_triage", "context": "be conservative" } },
                { "id": "uc_two", "review_policy": { "mode": "always" } }
            ]
        })
        .to_string();
        assert_eq!(
            extract_review_policy_context(&json, "uc_one"),
            Some("be conservative".to_string())
        );
        assert_eq!(extract_review_policy_context(&json, "uc_two"), None);
        assert_eq!(extract_review_policy_context(&json, "uc_missing"), None);
    }
}
