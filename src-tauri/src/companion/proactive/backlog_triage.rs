//! Athena's batch backlog triage — "Send to Athena" (plan Workstream 2).
//!
//! The unified Backlog can accumulate hundreds of pending `dev_ideas` from a
//! dozen sensors. Deciding them one card at a time is the bottleneck the whole
//! triage-unification effort exists to remove, so this module does what
//! `execution_review` does for finished executions: ONE headless decision over
//! a whole batch, on the micro tier (`model_routing::MICRO` — Sonnet@low),
//! returning a per-item accept/reject verdict with a reason.
//!
//! Three deliberate differences from `execution_review`:
//!
//!   1. **The user asked for it.** This is not a proactive tick — it is a
//!      button. There is no cursor, no dedupe window, no wake gate; the caller
//!      supplies exactly the ids it wants judged.
//!   2. **Verdicts are proposals, not effects.** Nothing is applied here. The
//!      command layer persists the parsed batch as a pending
//!      `companion_approval` row, so a verdict survives a restart and still
//!      needs a human click (or a per-item override) before it touches an idea.
//!   3. **Fail closed.** An id the model never returned a verdict for is
//!      REJECTED with `"no verdict returned"`, not silently accepted. A dropped
//!      line in an LLM response must never read as "a senior engineer approved
//!      this".
//!
//! Grounding: each distinct project in the batch contributes its settled
//! constraint/decision memories (`dev_memories::get_for_injection`) so a
//! rejection Athena already recorded ("we do not do X") keeps being honored
//! instead of being re-litigated every sweep.

use std::collections::HashMap;

use crate::db::models::DevIdea;
use crate::db::repos::dev_memories;
use crate::db::DbPool;
use crate::error::AppError;

/// Hard cap on one batch. Beyond this the prompt stops being a triage and
/// starts being a haystack — and the per-item reasons get lazy. Mirrors
/// `execution_review::MAX_BATCH_CANDIDATES` in spirit; the command layer
/// enforces the same number so the UI can report it before spending a turn.
pub const MAX_BATCH_IDEAS: usize = 30;

/// Per-project memory budget in the prompt. Enough for the handful of
/// constraints that actually change a verdict, small enough that a 30-item
/// batch spanning 5 projects doesn't drown the items themselves.
const MEMORY_CHAR_BUDGET: usize = 1000;

/// How many memory rows to pull per project before rendering (the renderer
/// truncates to [`MEMORY_CHAR_BUDGET`]; ordering is constraint-first).
const MEMORY_ROWS_PER_PROJECT: i64 = 12;

const DESCRIPTION_MAX: usize = 400;
const EVIDENCE_MAX: usize = 200;
/// Per-verdict reason cap. `pub` because the triage-verdicts ingest door
/// (`commands::infrastructure::dev_tools::triage_ingest`) enforces the same
/// cap on file-borne reasons.
pub const REASON_MAX: usize = 140;

/// One decided idea, as the approval row and the UI card consume it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BacklogVerdict {
    pub idea_id: String,
    /// Echoed so the approval row (in `user_db`) is legible on its own, without
    /// joining back to `dev_ideas` (a DIFFERENT pool).
    pub title: String,
    /// `accept` | `reject`.
    pub verdict: String,
    /// Why — concrete, ≤140 chars. Never empty (fail-closed items get a stock
    /// reason).
    pub reason: String,
}

/// The parsed outcome of one batch triage.
#[derive(Debug, Clone)]
pub struct BacklogTriageBatch {
    pub items: Vec<BacklogVerdict>,
    /// One-line batch summary — becomes the approval row's rationale.
    pub summary: String,
}

// ── the model's protocol object ─────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct TriageEnvelope {
    athena_backlog_triage: TriageDecision,
}

#[derive(Debug, serde::Deserialize)]
struct TriageDecision {
    #[serde(default)]
    items: Vec<RawVerdict>,
    #[serde(default)]
    summary: String,
}

#[derive(Debug, serde::Deserialize)]
struct RawVerdict {
    id: String,
    verdict: String,
    #[serde(default)]
    reason: String,
}

// ── prompt ─────────────────────────────────────────────────────────────────

fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}…")
}

/// Settled constraints/decisions per distinct project in the batch, rendered
/// once each. Best-effort: a project whose memories fail to load contributes
/// nothing rather than failing the triage.
fn gather_memories(db: &DbPool, ideas: &[DevIdea]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for idea in ideas {
        let Some(pid) = idea.project_id.as_deref().filter(|p| !p.is_empty()) else {
            continue;
        };
        if out.contains_key(pid) {
            continue;
        }
        let Ok(mem) = dev_memories::get_for_injection(db, pid, MEMORY_ROWS_PER_PROJECT) else {
            continue;
        };
        if let Some(rendered) = dev_memories::render_for_prompt(&mem, MEMORY_CHAR_BUDGET) {
            out.insert(pid.to_string(), rendered);
        }
    }
    out
}

/// Build the batch-triage prompt. `project_name` resolves a project id to a
/// display name (the caller owns the registry read); ids without a name fall
/// back to the id so grouping still reads.
pub fn build_backlog_triage_prompt(
    ideas: &[DevIdea],
    memories: &HashMap<String, String>,
    project_name: &HashMap<String, String>,
) -> String {
    let mut listing = String::new();
    for idea in ideas {
        let project = idea
            .project_id
            .as_deref()
            .map(|p| project_name.get(p).map(String::as_str).unwrap_or(p))
            .unwrap_or("(no project)");
        listing.push_str(&format!(
            "- id: {id}\n  project: {project}\n  origin: {origin}\n  category: {category}\n  \
             effort/impact/risk: {e}/{i}/{r}\n  title: {title}\n",
            id = idea.id,
            project = project,
            origin = idea.origin.as_deref().unwrap_or("idea_scanner"),
            category = idea.category,
            e = idea
                .effort
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".into()),
            i = idea
                .impact
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".into()),
            r = idea
                .risk
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".into()),
            title = idea.title.trim(),
        ));
        if let Some(d) = idea.description.as_deref().filter(|s| !s.trim().is_empty()) {
            listing.push_str(&format!(
                "  description: {}\n",
                truncate(d, DESCRIPTION_MAX)
            ));
        }
        if let Some(ev) = idea.evidence.as_deref().filter(|s| !s.trim().is_empty()) {
            listing.push_str(&format!("  evidence: {}\n", truncate(ev, EVIDENCE_MAX)));
        }
    }

    let mut memory_block = String::new();
    if !memories.is_empty() {
        memory_block.push_str("\nSETTLED CONSTRAINTS AND DECISIONS (per project — these are already decided; honor them):\n");
        let mut keys: Vec<&String> = memories.keys().collect();
        keys.sort();
        for pid in keys {
            let name = project_name.get(pid).map(String::as_str).unwrap_or(pid);
            memory_block.push_str(&format!("\n[{name}]\n{}", memories[pid]));
        }
    }

    format!(
        r#"You are **Athena**, the autonomous orchestrator of this Personas workspace, doing a batch triage of the development backlog. The user selected these items and asked for your verdict on each one. You are running headless — this is your only pass.

BACKLOG ITEMS ({count}):
{listing}{memory_block}

YOUR DOCTRINE — strict triage:
- **accept** ONLY what a senior engineer would actually schedule THIS MONTH: it is concrete, its value is legible, the effort is proportionate to the impact, and nothing in the settled constraints above rules it out. Acceptance means someone will spend real hours on it soon.
- **reject** everything else — and that is most of a backlog. Reject vague "improve X" items with no definition of done, speculative work with no evidence behind it, gold-plating, duplicates of an item already in this batch, anything a settled constraint already declined, and anything whose effort dwarfs its impact.
- A backlog that accepts everything is a backlog nobody trusts. Restraint is the job. If you are unsure, reject — a rejected idea can be re-raised with better evidence; an accepted one consumes a person's week.
- `reason`: ONE concrete sentence, at most {reason_max} characters, naming the specific thing that decided it ("no acceptance criteria — 'faster' is not measurable here", "duplicates item dev_xyz", "constraint: we do not add runtime deps for this"). Never generic filler like "not a priority" or "looks good".
- Emit EXACTLY ONE verdict per listed id, using the id verbatim. Do not invent ids. An id you omit is treated as a rejection.
- `summary`: one short line describing the batch outcome (e.g. "3 of 14 worth scheduling — most lack acceptance criteria").

Respond with any reasoning you need, then emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"athena_backlog_triage": {{"items": [{{"id": "<idea id>", "verdict": "accept"|"reject", "reason": "<≤{reason_max} chars>"}}], "summary": "<one line>"}}}}
"#,
        count = ideas.len(),
        listing = listing,
        memory_block = memory_block,
        reason_max = REASON_MAX,
    )
}

// ── parsing ────────────────────────────────────────────────────────────────

/// Extract the `{"athena_backlog_triage": {...}}` object. Same tolerant
/// brace-matching scan as `execution_review::parse_exec_triage` — the model
/// often narrates before the protocol line, and a corrected second emission
/// should win, so the LAST valid occurrence is the one returned.
fn parse_backlog_triage(blob: &str) -> Option<TriageDecision> {
    let marker = "\"athena_backlog_triage\"";
    let mut result = None;
    let mut search_from = 0;
    while let Some(rel) = blob[search_from..].find(marker) {
        let marker_pos = search_from + rel;
        search_from = marker_pos + marker.len();
        let Some(open) = blob[..marker_pos].rfind('{') else {
            continue;
        };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            if let Ok(env) = serde_json::from_str::<TriageEnvelope>(&blob[open..open + close + 1]) {
                result = Some(env.athena_backlog_triage);
            }
        }
    }
    result
}

/// Merge the model's verdicts onto the batch it was asked about.
///
/// - Unknown ids are dropped with a warning (a hallucinated id must not create
///   a phantom row in the approval params).
/// - A verdict token that is not exactly `accept` degrades to `reject` — an
///   ambiguous token is not consent.
/// - An id the model never mentioned FAILS CLOSED to `reject` with
///   `"no verdict returned"`.
///
/// Output order always mirrors the input order, so the card reads like the
/// table the user selected from.
pub fn merge_verdicts(ideas: &[DevIdea], raw: &[(String, String, String)]) -> Vec<BacklogVerdict> {
    let mut by_id: HashMap<&str, (&str, &str)> = HashMap::new();
    let known: std::collections::HashSet<&str> = ideas.iter().map(|i| i.id.as_str()).collect();
    for v in raw {
        if !known.contains(v.0.as_str()) {
            tracing::warn!(id = %v.0, "backlog_triage: dropping verdict for unknown idea id");
            continue;
        }
        by_id.insert(v.0.as_str(), (v.1.as_str(), v.2.as_str()));
    }

    ideas
        .iter()
        .map(|idea| match by_id.get(idea.id.as_str()) {
            Some((verdict, reason)) => {
                let accepted = verdict.trim().eq_ignore_ascii_case("accept");
                let reason = truncate(reason, REASON_MAX);
                BacklogVerdict {
                    idea_id: idea.id.clone(),
                    title: idea.title.clone(),
                    verdict: if accepted { "accept" } else { "reject" }.to_string(),
                    reason: if reason.is_empty() {
                        if accepted {
                            "worth scheduling".to_string()
                        } else {
                            "no reason given".to_string()
                        }
                    } else {
                        reason
                    },
                }
            }
            None => {
                tracing::warn!(id = %idea.id, "backlog_triage: no verdict returned — failing closed to reject");
                BacklogVerdict {
                    idea_id: idea.id.clone(),
                    title: idea.title.clone(),
                    verdict: "reject".to_string(),
                    reason: "no verdict returned".to_string(),
                }
            }
        })
        .collect()
}

// ── entry point ────────────────────────────────────────────────────────────

/// Run ONE headless batch triage over `ideas`.
///
/// `db` is the main pool (project memories live there); `user_db` is the
/// companion pool the turn ledger writes to. Deliberately takes no
/// `AppHandle` — nothing here emits, navigates or spawns a turn; the caller
/// owns everything with a side effect.
pub async fn run_backlog_triage_batch(
    db: &DbPool,
    user_db: &crate::db::UserDbPool,
    ideas: &[DevIdea],
    project_name: &HashMap<String, String>,
) -> Result<BacklogTriageBatch, AppError> {
    if ideas.is_empty() {
        return Err(AppError::Validation(
            "backlog triage: no ideas to judge".into(),
        ));
    }
    let memories = gather_memories(db, ideas);
    let prompt = build_backlog_triage_prompt(ideas, &memories, project_name);

    let (blob, turn_id) =
        crate::companion::athena_reaction::cli_text_tracked(prompt, user_db, "backlog_triage")
            .await?;

    let Some(decision) = parse_backlog_triage(&blob) else {
        if let Some(tid) = &turn_id {
            crate::companion::turn_ledger::update_outcome(
                user_db,
                tid,
                r#"{"parse_failure":true}"#,
            );
        }
        return Err(AppError::Internal(
            "Athena returned no usable triage verdict for this batch. Try again with fewer items."
                .into(),
        ));
    };

    let raw: Vec<(String, String, String)> = decision
        .items
        .iter()
        .map(|v| (v.id.trim().to_string(), v.verdict.clone(), v.reason.clone()))
        .collect();
    let items = merge_verdicts(ideas, &raw);

    let accepts = items.iter().filter(|i| i.verdict == "accept").count();
    let rejects = items.len() - accepts;
    if let Some(tid) = &turn_id {
        let outcome = serde_json::json!({
            "items": items.len(),
            "accept": accepts,
            "reject": rejects,
        })
        .to_string();
        crate::companion::turn_ledger::update_outcome(user_db, tid, &outcome);
    }

    let summary = {
        let s = decision.summary.trim();
        if s.is_empty() {
            format!(
                "{accepts} accepted, {rejects} rejected of {} items",
                items.len()
            )
        } else {
            truncate(s, 200)
        }
    };

    Ok(BacklogTriageBatch { items, summary })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_idea(id: &str, title: &str) -> DevIdea {
        DevIdea {
            id: id.into(),
            project_id: Some("proj-1".into()),
            context_id: None,
            scan_type: "idea_scanner".into(),
            category: "technical".into(),
            title: title.into(),
            description: Some("do the thing".into()),
            reasoning: None,
            status: "pending".into(),
            effort: Some(3),
            impact: Some(8),
            risk: Some(2),
            priority: None,
            provider: None,
            model: None,
            rejection_reason: None,
            origin: None,
            use_case_id: None,
            evidence: None,
            dedup_key: None,
            verify_state: None,
            verify_checked_at: None,
            verify_evidence: None,
            created_at: "2026-07-01T00:00:00Z".into(),
            updated_at: "2026-07-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn parses_verdicts_after_prose() {
        let blob = r#"Let me think about these.
{"athena_backlog_triage": {"items": [{"id": "a", "verdict": "accept", "reason": "clear win"}, {"id": "b", "verdict": "reject", "reason": "no acceptance criteria"}], "summary": "1 of 2"}}
trailing chatter"#;
        let d = parse_backlog_triage(blob).expect("parses");
        assert_eq!(d.items.len(), 2);
        assert_eq!(d.summary, "1 of 2");
    }

    #[test]
    fn last_occurrence_wins() {
        let blob = r#"{"athena_backlog_triage":{"items":[{"id":"a","verdict":"accept"}]}}
correction: {"athena_backlog_triage":{"items":[{"id":"a","verdict":"reject","reason":"changed my mind"}]}}"#;
        let d = parse_backlog_triage(blob).expect("parses");
        assert_eq!(d.items[0].verdict, "reject");
    }

    #[test]
    fn ignores_other_protocols() {
        assert!(parse_backlog_triage(r#"{"athena_exec_triage":{"groups":[]}}"#).is_none());
    }

    #[test]
    fn missing_ids_fail_closed_to_reject() {
        let ideas = vec![mk_idea("a", "A"), mk_idea("b", "B")];
        let raw = vec![("a".into(), "accept".into(), "clear win".into())];
        let merged = merge_verdicts(&ideas, &raw);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].verdict, "accept");
        assert_eq!(merged[1].verdict, "reject");
        assert_eq!(merged[1].reason, "no verdict returned");
    }

    #[test]
    fn unknown_ids_are_dropped_and_ambiguous_verdicts_reject() {
        let ideas = vec![mk_idea("a", "A")];
        let raw = vec![
            ("ghost".into(), "accept".into(), "hallucinated".into()),
            ("a".into(), "maybe".into(), "unsure".into()),
        ];
        let merged = merge_verdicts(&ideas, &raw);
        assert_eq!(merged.len(), 1, "hallucinated id must not create a row");
        assert_eq!(
            merged[0].verdict, "reject",
            "non-`accept` token is not consent"
        );
    }

    #[test]
    fn reasons_are_capped_and_never_empty() {
        let ideas = vec![mk_idea("a", "A"), mk_idea("b", "B")];
        let raw = vec![
            ("a".into(), "accept".into(), "x".repeat(400)),
            ("b".into(), "reject".into(), "   ".into()),
        ];
        let merged = merge_verdicts(&ideas, &raw);
        assert!(merged[0].reason.chars().count() <= REASON_MAX + 1);
        assert_eq!(merged[1].reason, "no reason given");
    }

    #[test]
    fn prompt_lists_every_item_and_its_project_memories() {
        let ideas = vec![mk_idea("a", "Add retry"), mk_idea("b", "Improve things")];
        let mut mem = HashMap::new();
        mem.insert(
            "proj-1".to_string(),
            "- [constraint] No new deps: keep it stdlib\n".to_string(),
        );
        let mut names = HashMap::new();
        names.insert("proj-1".to_string(), "Personas".to_string());
        let p = build_backlog_triage_prompt(&ideas, &mem, &names);
        assert!(p.contains("id: a"));
        assert!(p.contains("id: b"));
        assert!(p.contains("Personas"));
        assert!(p.contains("No new deps"));
        assert!(p.contains("athena_backlog_triage"));
    }
}
