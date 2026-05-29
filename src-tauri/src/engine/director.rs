//! Director — a meta-persona that coaches every other persona in the app.
//!
//! The Director stands *outside* each persona, reads its shape + recent
//! behaviour + open issues + past user-decision memory, and emits prose
//! "coaching" verdicts into the existing Human Review layer
//! (`persona_manual_reviews`). Users approve or reject each verdict; those
//! decisions are captured back into `persona_memories` (category
//! `director_feedback`) so future cycles calibrate to the user's taste.
//!
//! # Phase 2 (this file)
//! - LLM evaluator: the Director **is** a persona whose `system_prompt` is
//!   `DIRECTOR_RUBRIC`. To evaluate a target we run the Director persona
//!   through the normal execution runner with a synthetic payload describing
//!   the target (identity + value/efficiency rollup + healing + memory sample
//!   + past verdicts), then parse `DIRECTOR_VERDICT: {...}` lines out of its
//!   output. The deterministic rule-based evaluator was retired — the LLM is
//!   now the sole verdict source.
//! - The Director's evaluation runs are real, fully-visible execution rows
//!   (cost-tracked, shown in the activity feed) — no special hiding.
//! - Verdicts route to `persona_manual_reviews` (severity info/warning/error);
//!   approve/reject feeds the human-feedback learning loop and the next
//!   cycle reads the prior verdicts + their disposition.
//! - Self-evaluation of the Director persona is always skipped.
//!
//! # Phase 3 (planned)
//! - Three-way verdict routing: info → `persona_messages`,
//!   warning → manual reviews, error + auto-fixable → `persona_healing_issues`
//!   + `ai_healing::apply_db_fixes`. Scheduler tick in `background.rs`.

use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{CreateManualReviewInput, Persona, PersonaExecution, ValueRollup};
use crate::db::repos::communication::manual_reviews;
use crate::db::repos::core::{memories, personas};
use crate::db::repos::execution::{executions, healing, metrics};
use crate::db::repos::resources::triggers;
use crate::db::DbPool;
use crate::error::AppError;
use crate::AppState;

use super::director_brain::{brain_enabled, read_brain_history, write_brain_note};

// ---------------------------------------------------------------------------
// Locked constants
// ---------------------------------------------------------------------------

/// Canonical name of the single system-owned Director persona. Combined with
/// `trust_origin='system'` this is the idempotency key for seeding.
pub const DIRECTOR_NAME: &str = "Director";

/// Short description shown in the persona list. Reads as news, not internals.
const DIRECTOR_DESCRIPTION: &str = "Watches every persona and suggests practical improvements. \
     Approve or dismiss its notes in your review queue — your decisions \
     teach it your taste.";

/// Bespoke Director icon (curated agent-icon catalog entry — a violet
/// compass-star). Resolved by `resolvePersonaIcon` / the agent-icon sprite.
const DIRECTOR_ICON: &str = "agent-icon:director";
const DIRECTOR_COLOR: &str = "#8b5cf6";

/// Locked best-practice rubric. Consumed by the Phase 2 LLM evaluator as the
/// Director persona's `system_prompt`. Phase 1 keeps this as a constant so
/// the shape is fixed when Phase 2 arrives; the deterministic evaluator does
/// not use it at runtime.
///
/// Rule: this constant is the single source of truth. Do not duplicate its
/// text into tests, docs, or UI strings.
pub const DIRECTOR_RUBRIC: &str = r#"You are the Director.

Your job is to coach every persona in this app toward being genuinely useful
to the person who installed it. A healthy persona is a necessity; a useful
persona is the target, and usefulness is subjective — it depends on what the
user wants from this specific persona, which you learn from their past
accept/reject decisions on your previous coaching notes.

For each persona you are asked about, you will receive:
1. The persona's identity (name, description, system_prompt).
2. A summary of its recent executions (how often it runs, success rate,
   failure patterns, cost).
3. Any open healing issues raised by the app.
4. A sample of its memories (facts the persona has learned).
5. Your own past verdicts on this persona and how the user responded
   (accepted / rejected / ignored).

First, output exactly ONE overall score line — ALWAYS, even when the persona is
healthy and you have no coaching to add:

DIRECTOR_SCORE: {"score":0-5,"summary":"<=140 chars: the one-line verdict on this persona's health + usefulness"}

Score guide: 5 = excellent, delivering value, nothing to improve; 4 = good, minor
polish possible; 3 = works but with real gaps; 2 = frequently failing or low
value; 1 = barely functional; 0 = broken or useless.

Next, if anything is genuinely working well, output between 0 and 3 wins —
short reinforcements of what's earning value. Wins are NOT noise; only emit
them when there's concrete evidence (e.g., a recent run delivered value, a
prior coaching note has been resolved, an expensive failure mode has stopped):

DIRECTOR_WIN: {"category":"prompt|health|triggers|credentials|memory|usefulness","note":"<=160 chars: what's working and the evidence"}

Coaching needs a different channel than reinforcement: emit wins for strengths,
verdicts for things to change. Don't restate a verdict as a win.

Then produce between 0 and 4 coaching verdicts. A verdict is prose. For each,
output a single JSON object on its own line prefixed with the literal marker
`DIRECTOR_VERDICT: ` so the app can parse it:

DIRECTOR_VERDICT: {"severity":"info|warning|error","category":"prompt|health|triggers|credentials|memory|usefulness","title":"<=60 chars imperative phrase","description":"1-3 sentences explaining the observation and why it matters","rationale":"concrete evidence from the context above","suggested_actions":["short prose suggestion","..."]}

Rules:
- The DIRECTOR_SCORE line is MANDATORY. Wins and coaching verdicts are both
  OPTIONAL: a healthy persona may yield the score line + zero wins + zero
  verdicts. Don't fabricate either to fill space.
- Prefer observations grounded in specific evidence over generic advice.
- Do NOT suggest prompt rewrites verbatim — describe the change shape and
  let the user author the actual text.
- Respect the user's past rejects. If they rejected a similar verdict
  before, do not re-emit it unless the context has materially changed.
- NEVER emit secrets, credential values, or full memory contents in the
  description or rationale. Reference them by name/count only.
"#;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Coaching severity. Mapped 1:1 onto the existing `persona_manual_reviews.severity`
/// column so the existing review UI renders it without changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum DirectorSeverity {
    Info,
    Warning,
    Error,
}

impl DirectorSeverity {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

/// Coaching category. Not persisted as a column — lives in review.context_data
/// so the UI can filter/group without a schema change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DirectorCategory {
    Prompt,
    Health,
    Triggers,
    Credentials,
    Memory,
    Usefulness,
}

impl DirectorCategory {
    fn as_str(self) -> &'static str {
        match self {
            Self::Prompt => "prompt",
            Self::Health => "health",
            Self::Triggers => "triggers",
            Self::Credentials => "credentials",
            Self::Memory => "memory",
            Self::Usefulness => "usefulness",
        }
    }
}

/// A single piece of coaching. Produced by an evaluator, routed into the
/// Human Review layer.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectorVerdict {
    pub target_persona_id: String,
    pub severity: DirectorSeverity,
    pub category: DirectorCategory,
    pub title: String,
    pub description: String,
    pub rationale: Option<String>,
    pub suggested_actions: Vec<String>,
}

/// One cycle's aggregate outcome, returned to the caller so the UI can show
/// "evaluated N personas, emitted M verdicts".
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectorReport {
    #[ts(type = "number")]
    pub evaluated_personas: i64,
    #[ts(type = "number")]
    pub verdicts_emitted: i64,
    #[ts(type = "number")]
    pub personas_skipped_no_executions: i64,
    pub generated_at: String,
}

/// Context a single persona is evaluated against. Assembled by
/// `gather_context`, consumed by a `DirectorEvaluator` impl.
#[allow(dead_code)] // recent_executions_limit / failure_count / avg_cost_usd / memory_count populated for evaluators that don't read them yet
pub struct PersonaEvaluationContext {
    pub persona: Persona,
    pub recent_executions_limit: usize,
    pub failure_count: usize,
    pub success_count: usize,
    pub total_executions: usize,
    pub latest_execution_id: Option<String>,
    pub avg_cost_usd: f64,
    pub open_healing_issues: usize,
    pub open_critical_healing: usize,
    pub trigger_count: usize,
    pub memory_count: usize,
    pub feedback_accepts: usize,
    pub feedback_rejects: usize,
    pub days_since_last_run: Option<i64>,
}

// ---------------------------------------------------------------------------
// LLM evaluator (Phase 2)
// ---------------------------------------------------------------------------
//
// The Director is itself a persona whose `system_prompt` is `DIRECTOR_RUBRIC`.
// To evaluate a target we run the Director persona through the normal
// execution runner with a synthetic payload describing the target, poll the
// run to a terminal state, and parse `DIRECTOR_VERDICT: {...}` marker lines out
// of its output. This reuses the whole execution stack (model resolution, cost
// tracking, the activity feed) — the evaluation is a real, fully-visible run.

/// Outer ceiling for polling a Director evaluation run to a terminal state.
/// The Director persona's own `timeout_ms` (5 min) bounds the run itself; this
/// is a little longer to absorb queue + finalize latency.
const DIRECTOR_RUN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(360);
const DIRECTOR_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(1500);

/// Window (days) of execution history summarised into the Director's payload.
const PAYLOAD_VALUE_WINDOW_DAYS: i64 = 30;

/// The literal prefix the rubric instructs the Director to emit before each
/// verdict's JSON object.
const VERDICT_MARKER: &str = "DIRECTOR_VERDICT:";

/// Max verdicts accepted from a single run (the rubric asks for 0–4; this is a
/// hard cap against a runaway response).
const MAX_VERDICTS_PER_RUN: usize = 6;

/// Shape of a single `DIRECTOR_VERDICT: {...}` JSON object. Severity/category
/// deserialize straight into the existing enums via their serde renames.
#[derive(Debug, Deserialize)]
struct RawVerdict {
    severity: DirectorSeverity,
    category: DirectorCategory,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    rationale: Option<String>,
    #[serde(default)]
    suggested_actions: Vec<String>,
}

/// Parse every `DIRECTOR_VERDICT: {json}` line out of the Director's output.
/// Malformed lines are skipped (logged) rather than failing the whole cycle —
/// one bad object should not discard the good verdicts in the same run.
pub fn parse_verdicts(output: &str, target_persona_id: &str) -> Vec<DirectorVerdict> {
    let mut out = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        let Some(idx) = trimmed.find(VERDICT_MARKER) else {
            continue;
        };
        let json_part = trimmed[idx + VERDICT_MARKER.len()..].trim();
        if json_part.is_empty() {
            continue;
        }
        match serde_json::from_str::<RawVerdict>(json_part) {
            Ok(raw) => out.push(DirectorVerdict {
                target_persona_id: target_persona_id.to_string(),
                severity: raw.severity,
                category: raw.category,
                title: raw.title,
                description: raw.description,
                rationale: raw.rationale,
                suggested_actions: raw.suggested_actions,
            }),
            Err(e) => {
                tracing::warn!(error = %e, line = %json_part, "Director: skipping malformed verdict line");
            }
        }
    }
    out
}

/// The literal prefix for the single overall-score line the rubric mandates.
const SCORE_MARKER: &str = "DIRECTOR_SCORE:";

#[derive(Debug, Deserialize)]
struct RawScore {
    score: i64,
    #[serde(default)]
    summary: String,
}

/// Parse the single `DIRECTOR_SCORE: {json}` line into (score 0-5, summary).
/// `None` if absent/malformed — the run still yields coaching verdicts; we
/// just won't write a score onto the execution.
fn parse_score(output: &str) -> Option<(i64, String)> {
    for line in output.lines() {
        let trimmed = line.trim();
        let Some(idx) = trimmed.find(SCORE_MARKER) else {
            continue;
        };
        let json_part = trimmed[idx + SCORE_MARKER.len()..].trim();
        if json_part.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<RawScore>(json_part) {
            return Some((raw.score.clamp(0, 5), raw.summary));
        }
    }
    None
}

/// The literal prefix for each optional "what's working" line the rubric may
/// emit (v2: wins channel alongside coaching verdicts).
const WIN_MARKER: &str = "DIRECTOR_WIN:";

/// Max wins accepted from a single run. The rubric asks for 0–3; this is a
/// hard cap against runaway emissions, mirroring `MAX_VERDICTS_PER_RUN`.
const MAX_WINS_PER_RUN: usize = 5;

/// A reinforcement note from the Director — what's working and why. Internal
/// to this module (rendered into `director_review_md`; not shipped as a
/// separate row, so no ts-rs export needed).
#[derive(Debug, Clone)]
pub(super) struct DirectorWin {
    pub category: DirectorCategory,
    pub note: String,
}

#[derive(Debug, Deserialize)]
struct RawWin {
    category: DirectorCategory,
    #[serde(default)]
    note: String,
}

/// Parse every `DIRECTOR_WIN: {json}` line. Mirrors `parse_verdicts`: malformed
/// lines are skipped (logged), good lines are accepted. Capped at
/// `MAX_WINS_PER_RUN` to keep a runaway model from drowning the review.
pub(super) fn parse_wins(output: &str) -> Vec<DirectorWin> {
    let mut out = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        let Some(idx) = trimmed.find(WIN_MARKER) else {
            continue;
        };
        let json_part = trimmed[idx + WIN_MARKER.len()..].trim();
        if json_part.is_empty() {
            continue;
        }
        match serde_json::from_str::<RawWin>(json_part) {
            Ok(raw) if !raw.note.trim().is_empty() => out.push(DirectorWin {
                category: raw.category,
                note: raw.note,
            }),
            Ok(_) => {} // empty note — silently drop
            Err(e) => {
                tracing::warn!(error = %e, line = %json_part, "Director: skipping malformed win line");
            }
        }
        if out.len() >= MAX_WINS_PER_RUN {
            break;
        }
    }
    out
}

/// Render the Director's assessment (overall score + summary + wins + coaching
/// verdicts) as markdown for the execution's "Director" tab.
fn render_review_md(
    score: i64,
    summary: &str,
    wins: &[DirectorWin],
    verdicts: &[DirectorVerdict],
) -> String {
    let s = score.clamp(0, 5) as usize;
    let stars: String = "★".repeat(s) + &"☆".repeat(5 - s);
    let mut md = format!("## Director review — {stars} ({score}/5)\n\n");
    if !summary.is_empty() {
        md.push_str(summary);
        md.push_str("\n\n");
    }
    if !wins.is_empty() {
        md.push_str("### What's working\n\n");
        for w in wins {
            md.push_str(&format!("- _({})_ {}\n", w.category.as_str(), w.note));
        }
        md.push('\n');
    }
    if verdicts.is_empty() {
        if wins.is_empty() {
            md.push_str("_No coaching notes — the persona looks healthy._\n");
        } else {
            md.push_str("_No coaching needed beyond the wins above._\n");
        }
    } else {
        md.push_str("### Coaching\n\n");
        for v in verdicts {
            md.push_str(&format!(
                "#### {} _({} · {})_\n\n",
                v.title,
                v.severity.as_str(),
                v.category.as_str()
            ));
            if !v.description.is_empty() {
                md.push_str(&v.description);
                md.push_str("\n\n");
            }
            if let Some(r) = &v.rationale {
                md.push_str(&format!("**Evidence:** {r}\n\n"));
            }
            if !v.suggested_actions.is_empty() {
                md.push_str("**Suggested actions:**\n");
                for a in &v.suggested_actions {
                    md.push_str(&format!("- {a}\n"));
                }
                md.push('\n');
            }
        }
    }
    md
}

/// Char-safe truncation with an ellipsis. (Byte-slicing a multibyte boundary
/// panics — see the runner's safe-truncate incident.)
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}…")
}

/// Build the synthetic input payload the Director persona analyses. Mirrors the
/// five inputs the rubric promises: identity, execution summary (incl. the
/// value/efficiency rollup), open healing, a memory sample, and the Director's
/// own past verdicts on this persona + how the user responded.
fn build_director_payload(pool: &DbPool, ctx: &PersonaEvaluationContext, rollup: &ValueRollup) -> String {
    let p = &ctx.persona;
    let mut s = String::new();

    s.push_str(
        "Evaluate the persona below against your rubric and emit DIRECTOR_VERDICT lines. \
         Be specific to THIS persona's evidence; if it is healthy and useful with nothing \
         concrete to improve, emit zero verdicts.\n\n",
    );

    // 1. Identity
    s.push_str("## Persona identity\n");
    s.push_str(&format!("- Name: {}\n", p.name));
    if let Some(desc) = &p.description {
        s.push_str(&format!("- Description: {desc}\n"));
    }
    s.push_str(&format!(
        "- System prompt ({} chars): {}\n\n",
        p.system_prompt.trim().len(),
        truncate(p.system_prompt.trim(), 1200),
    ));

    // 2. Execution summary
    s.push_str("## Recent execution summary\n");
    s.push_str(&format!(
        "- Last {} runs: {} total, {} succeeded, {} failed\n",
        ctx.recent_executions_limit, ctx.total_executions, ctx.success_count, ctx.failure_count,
    ));
    if let Some(days) = ctx.days_since_last_run {
        s.push_str(&format!("- Days since last run: {days}\n"));
    }
    s.push_str(&format!("- Triggers configured: {}\n", ctx.trigger_count));
    s.push_str(&format!("- Avg cost/run: ${:.4}\n\n", ctx.avg_cost_usd));

    // 2b. Business-value + efficiency rollup
    s.push_str(&format!(
        "## Business value & model efficiency (last {} days, simulations excluded)\n",
        rollup.period_days,
    ));
    s.push_str(&format!(
        "- Outcomes: {} value_delivered, {} partial, {} precondition_failed, {} no_input_available, {} unassessed\n",
        rollup.value_delivered,
        rollup.partial,
        rollup.precondition_failed,
        rollup.no_input_available,
        rollup.unknown,
    ));
    s.push_str(&format!(
        "- Value-delivered rate (of assessed): {:.0}%\n",
        rollup.value_delivered_rate * 100.0,
    ));
    s.push_str(&format!("- Total cost: ${:.2}\n", rollup.total_cost_usd));
    match rollup.cost_per_value_delivered {
        Some(c) => s.push_str(&format!("- Cost per value-delivered run: ${c:.2}\n")),
        None => s.push_str("- Cost per value-delivered run: n/a (no run delivered value)\n"),
    }
    if !rollup.models.is_empty() {
        s.push_str("- Model efficiency (model: runs, cost, value-delivered):\n");
        for m in &rollup.models {
            s.push_str(&format!(
                "    - {}: {} runs, ${:.2}, {} value-delivered\n",
                m.model, m.executions, m.cost_usd, m.value_delivered,
            ));
        }
    }
    s.push('\n');

    // 3. Open healing
    s.push_str("## Open healing issues\n");
    s.push_str(&format!(
        "- {} open ({} critical)\n\n",
        ctx.open_healing_issues, ctx.open_critical_healing,
    ));

    // 4. Memory sample
    let memories = memories::get_by_persona(pool, &p.id, Some(8)).unwrap_or_default();
    s.push_str(&format!("## Memory sample ({} total)\n", ctx.memory_count));
    if memories.is_empty() {
        s.push_str("- (none)\n");
    } else {
        for m in memories.iter().take(8) {
            s.push_str(&format!("- [{}] {}\n", m.category, truncate(&m.content, 160)));
        }
    }
    s.push('\n');

    // 5. Past Director verdicts + their disposition
    let past = list_verdicts(pool, Some(p.id.as_str())).unwrap_or_default();
    s.push_str("## Your past verdicts on this persona\n");
    if past.is_empty() {
        s.push_str("- (none yet)\n");
    } else {
        for v in past.iter().take(10) {
            s.push_str(&format!("- [{}] \"{}\" ({})\n", v.status, v.title, v.category));
        }
        s.push_str(
            "Respect prior dispositions: do not re-emit a verdict the user already \
             resolved/rejected unless the situation has materially changed.\n",
        );
    }

    s
}

/// Run the Director persona to evaluate `ctx.persona` and return parsed
/// verdicts. The Director runs as a real (fully-visible) execution; we poll it
/// to a terminal state and parse its output. Returns an empty vec (logged) if
/// the run fails or emits nothing parseable — there is no deterministic
/// fallback (Phase 2 retired the rule-based evaluator wholesale).
async fn evaluate_with_llm(
    state: &Arc<AppState>,
    app: tauri::AppHandle,
    director_id: &str,
    ctx: &PersonaEvaluationContext,
) -> Result<Vec<DirectorVerdict>, AppError> {
    let rollup = metrics::get_value_rollup(
        &state.db,
        Some(PAYLOAD_VALUE_WINDOW_DAYS),
        Some(ctx.persona.id.as_str()),
    )?;
    let mut payload = build_director_payload(&state.db, ctx, &rollup);

    // Long-term memory (Brain): when enabled + a vault is configured, fold prior
    // Director notes for this persona into the payload so coaching compounds.
    let brain_on = brain_enabled(&state.db);
    if brain_on {
        if let Some(history) = read_brain_history(&state.db, &ctx.persona.name) {
            payload.push_str(
                "\n\n## Prior coaching from your long-term memory (Brain)\nUse this to build on past advice and avoid repeating yourself:\n\n",
            );
            payload.push_str(&truncate(&history, 4000));
            payload.push('\n');
        }
    }

    let spawned = crate::commands::execution::executions::execute_persona_inner(
        state,
        app,
        director_id.to_string(),
        /* trigger_id */ None,
        Some(payload),
        /* use_case_id */ None,
        /* continuation */ None,
        /* idempotency_key */ None,
        /* is_simulation */ false,
    )
    .await?;

    let Some(exec) = await_execution_terminal(&state.db, &spawned.id).await else {
        tracing::warn!(
            director_run = %spawned.id,
            target = %ctx.persona.id,
            "Director run did not reach a terminal state within the timeout",
        );
        return Ok(Vec::new());
    };

    let output = exec.output_data.unwrap_or_default();
    if output.trim().is_empty() {
        tracing::warn!(director_run = %exec.id, status = %exec.status, "Director run produced no output");
        return Ok(Vec::new());
    }

    let mut verdicts = parse_verdicts(&output, &ctx.persona.id);
    verdicts.truncate(MAX_VERDICTS_PER_RUN);
    // v2: also parse the optional "wins" channel — reinforcements alongside
    // coaching verdicts. Cap is enforced by `parse_wins`.
    let wins = parse_wins(&output);

    // Overall 0-5 score + rendered markdown → written onto the reviewed (target)
    // execution so the activity Verdict column + Director tab can read it.
    // Coaching verdicts continue to route to manual_reviews (the caller does
    // that). Wins are reinforcement-only — they live in the rendered markdown,
    // not in the review queue. Only write when a score line was actually emitted.
    if let (Some(exec_id), Some((score, summary))) =
        (ctx.latest_execution_id.as_deref(), parse_score(&output))
    {
        let md = render_review_md(score, &summary, &wins, &verdicts);
        if let Err(e) = executions::set_director_review(&state.db, exec_id, score, &md) {
            tracing::warn!(error = %e, execution = %exec_id, "Director: failed to persist review score");
        }
        // Write the review into the Brain vault as durable long-term memory.
        if brain_on {
            write_brain_note(&state.db, &ctx.persona.id, &ctx.persona.name, &md);
        }
    }

    Ok(verdicts)
}

// Brain long-term-memory helpers live in `super::director_brain` since v2 —
// `brain_enabled`, `read_brain_history`, `write_brain_note` are imported at the
// top of this file alongside the evaluator's other dependencies.

/// Poll an execution row until it reaches a terminal state or the timeout
/// elapses. Returns the final row (terminal if we got there, last-seen
/// otherwise; `None` only if the row can't be read at the deadline).
async fn await_execution_terminal(pool: &DbPool, execution_id: &str) -> Option<PersonaExecution> {
    let start = std::time::Instant::now();
    loop {
        match executions::get_by_id(pool, execution_id) {
            Ok(ex) if ex.state().is_terminal() => return Some(ex),
            Ok(ex) if start.elapsed() >= DIRECTOR_RUN_TIMEOUT => return Some(ex),
            Err(_) if start.elapsed() >= DIRECTOR_RUN_TIMEOUT => return None,
            _ => {}
        }
        tokio::time::sleep(DIRECTOR_POLL_INTERVAL).await;
    }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/// Idempotent: returns the Director persona id. Creates it the first time
/// this function is called on a fresh DB. Safe to call on every app boot.
pub fn ensure_director_persona(pool: &DbPool) -> Result<String, AppError> {
    let conn = pool.get()?;

    // Idempotency key: unique (name, trust_origin='system') pair.
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM personas \
             WHERE name = ?1 AND trust_origin = 'system' LIMIT 1",
            params![DIRECTOR_NAME],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        // Migrate the icon for Directors seeded before the bespoke icon landed
        // (they carry the legacy "compass" lucide name → fallback render).
        let _ = conn.execute(
            "UPDATE personas SET icon = ?1 WHERE id = ?2 AND (icon IS NULL OR icon = 'compass')",
            params![DIRECTOR_ICON, id],
        );
        return Ok(id);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO personas
         (id, project_id, name, description, system_prompt, icon, color,
          enabled, sensitive, headless, max_concurrent, timeout_ms,
          trust_level, trust_origin, trust_score, created_at, updated_at)
         VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6,
                 1, 0, 0, 1, 300000,
                 'verified', 'system', 1.0, ?7, ?7)",
        params![
            id,
            DIRECTOR_NAME,
            DIRECTOR_DESCRIPTION,
            DIRECTOR_RUBRIC,
            DIRECTOR_ICON,
            DIRECTOR_COLOR,
            now,
        ],
    )?;

    tracing::info!(director_id = %id, "Seeded system-owned Director persona");
    Ok(id)
}

/// Returns the Director persona id (assuming it has been seeded). Cheap
/// lookup by name+origin; Phase 2 may cache this.
pub fn get_director_persona_id(pool: &DbPool) -> Result<String, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT id FROM personas \
         WHERE name = ?1 AND trust_origin = 'system' LIMIT 1",
        params![DIRECTOR_NAME],
        |row| row.get(0),
    )
    .map_err(|_| AppError::NotFound("Director persona".into()))
}

// ---------------------------------------------------------------------------
// Context gathering
// ---------------------------------------------------------------------------

const DIRECTOR_FEEDBACK_CATEGORY: &str = "director_feedback";
const CONTEXT_EXECUTION_WINDOW: i64 = 20;
const CONTEXT_MEMORY_WINDOW: i64 = 50;

/// Assemble the evaluation context for a single target persona.
pub fn gather_context(
    pool: &DbPool,
    target_persona_id: &str,
) -> Result<PersonaEvaluationContext, AppError> {
    let persona = personas::get_by_id(pool, target_persona_id)?;
    let recent =
        executions::get_by_persona_id(pool, target_persona_id, Some(CONTEXT_EXECUTION_WINDOW))?;

    let total_executions = recent.len();
    let (success_count, failure_count) = recent.iter().fold((0usize, 0usize), |(s, f), e| match e
        .status
        .as_str()
    {
        "completed" | "success" | "succeeded" => (s + 1, f),
        "failed" | "error" | "timeout" => (s, f + 1),
        _ => (s, f),
    });

    let latest_execution_id = recent.first().map(|e| e.id.clone());

    let total_cost: f64 = recent.iter().map(|e| e.cost_usd).sum();
    let avg_cost_usd = if total_executions > 0 {
        total_cost / total_executions as f64
    } else {
        0.0
    };

    let days_since_last_run = recent.first().and_then(|e| {
        let ref_time = e.completed_at.as_deref().unwrap_or(&e.created_at);
        chrono::DateTime::parse_from_rfc3339(ref_time)
            .ok()
            .map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_days())
    });

    let healing_issues = healing::get_all(pool, Some(target_persona_id), Some("open"))?;
    let open_healing_issues = healing_issues.len();
    let open_critical_healing = healing_issues
        .iter()
        .filter(|h| h.severity.eq_ignore_ascii_case("critical") || h.is_circuit_breaker)
        .count();

    let trigger_rows = triggers::get_by_persona_id(pool, target_persona_id)?;
    let trigger_count = trigger_rows.len();

    let memories = memories::get_by_persona(pool, target_persona_id, Some(CONTEXT_MEMORY_WINDOW))?;
    let memory_count = memories.len();

    // Past Director feedback memories — tallied for Phase 2 few-shot, but also
    // informs the deterministic evaluator's "should we repeat this verdict?"
    // check once that lands.
    let (feedback_accepts, feedback_rejects) =
        memories.iter().fold((0usize, 0usize), |(a, r), m| {
            if m.category != DIRECTOR_FEEDBACK_CATEGORY {
                return (a, r);
            }
            let content_lower = m.content.to_lowercase();
            if content_lower.contains("\"outcome\":\"accepted\"") {
                (a + 1, r)
            } else if content_lower.contains("\"outcome\":\"rejected\"") {
                (a, r + 1)
            } else {
                (a, r)
            }
        });

    Ok(PersonaEvaluationContext {
        persona,
        recent_executions_limit: CONTEXT_EXECUTION_WINDOW as usize,
        failure_count,
        success_count,
        total_executions,
        latest_execution_id,
        avg_cost_usd,
        open_healing_issues,
        open_critical_healing,
        trigger_count,
        memory_count,
        feedback_accepts,
        feedback_rejects,
        days_since_last_run,
    })
}

// ---------------------------------------------------------------------------
// Cycle runners
// ---------------------------------------------------------------------------

/// Run one Director cycle against a single target persona. Returns the number
/// of verdicts emitted (0 is the healthy outcome). Async because the LLM
/// evaluator runs the Director persona through the execution runner.
pub async fn run_director_cycle_for(
    state: &Arc<AppState>,
    app: tauri::AppHandle,
    target_persona_id: &str,
) -> Result<i64, AppError> {
    let director_id = get_director_persona_id(&state.db)?;
    if target_persona_id == director_id {
        // Never evaluate yourself.
        return Ok(0);
    }

    let ctx = gather_context(&state.db, target_persona_id)?;

    // A persona with NO executions cannot anchor a manual review (FK requires
    // execution_id) and there is nothing to analyse — skip silently.
    if ctx.latest_execution_id.is_none() {
        return Ok(0);
    }

    let verdicts = evaluate_with_llm(state, app, &director_id, &ctx).await?;
    route_verdicts(&state.db, &ctx, &verdicts)?;
    Ok(verdicts.len() as i64)
}

/// Batch cycle. Iterates enabled user personas (skipping the Director itself),
/// evaluates each via the LLM evaluator, returns an aggregate report. Runs are
/// sequential — each Director evaluation is a real persona run, so this is
/// rate-limited by nature.
pub async fn run_director_cycle_batch(
    state: &Arc<AppState>,
    app: tauri::AppHandle,
    max_personas: Option<i64>,
) -> Result<DirectorReport, AppError> {
    let director_id = get_director_persona_id(&state.db)?;
    // Scope: the Director only coaches STARRED personas (set via the star
    // toggle in the personas table). Empty scope ⇒ a no-op cycle.
    let enabled = personas::get_starred(&state.db)?;

    let mut evaluated = 0i64;
    let mut emitted = 0i64;
    let mut skipped = 0i64;

    for (idx, p) in enabled.iter().enumerate() {
        if let Some(cap) = max_personas {
            if idx as i64 >= cap {
                break;
            }
        }
        if p.id == director_id {
            continue;
        }

        let ctx = match gather_context(&state.db, &p.id) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(persona_id = %p.id, error = %e, "Director: failed to gather context, skipping");
                continue;
            }
        };

        // A persona with NO executions cannot anchor a manual review (FK
        // constraint requires execution_id). Tally the skip so the report is
        // honest; Phase 3 will switch those to `persona_messages` (no FK).
        if ctx.latest_execution_id.is_none() {
            skipped += 1;
            continue;
        }

        match evaluate_with_llm(state, app.clone(), &director_id, &ctx).await {
            Ok(verdicts) => {
                route_verdicts(&state.db, &ctx, &verdicts)?;
                evaluated += 1;
                emitted += verdicts.len() as i64;
            }
            Err(e) => {
                tracing::warn!(persona_id = %p.id, error = %e, "Director: LLM evaluation failed, skipping");
            }
        }
    }

    Ok(DirectorReport {
        evaluated_personas: evaluated,
        verdicts_emitted: emitted,
        personas_skipped_no_executions: skipped,
        generated_at: chrono::Utc::now().to_rfc3339(),
    })
}

// ---------------------------------------------------------------------------
// Verdict routing
// ---------------------------------------------------------------------------

/// Phase 1 routing: every verdict becomes a `persona_manual_reviews` row.
/// Phase 3 will split routing by severity.
fn route_verdicts(
    pool: &DbPool,
    ctx: &PersonaEvaluationContext,
    verdicts: &[DirectorVerdict],
) -> Result<(), AppError> {
    let Some(anchor_execution_id) = ctx.latest_execution_id.clone() else {
        return Ok(());
    };

    for v in verdicts {
        // context_data carries the source marker + category + rationale +
        // suggested_actions so the review UI can render them without a
        // schema change. Review table already stores suggested_actions as a
        // free-form TEXT — we re-use it for the prose action bullets.
        let context_json = serde_json::json!({
            "source": "director",
            "category": v.category.as_str(),
            "rationale": v.rationale,
            "feedback_accepts_so_far": ctx.feedback_accepts,
            "feedback_rejects_so_far": ctx.feedback_rejects,
        });
        let suggested_json = serde_json::json!({
            "actions": v.suggested_actions,
        });

        let input = CreateManualReviewInput {
            execution_id: anchor_execution_id.clone(),
            persona_id: v.target_persona_id.clone(),
            title: v.title.clone(),
            description: Some(v.description.clone()),
            severity: Some(v.severity.as_str().to_string()),
            context_data: Some(context_json.to_string()),
            suggested_actions: Some(suggested_json.to_string()),
            use_case_id: None,
        };

        if let Err(e) = manual_reviews::create(pool, input) {
            tracing::warn!(persona_id = %v.target_persona_id, error = %e, "Director: failed to create review");
        }
    }

    Ok(())
}

/// List Director-sourced manual reviews, optionally filtered to a single
/// target persona. Reads the unified `persona_manual_reviews` table and
/// keeps only rows whose `context_data.source == "director"`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectorVerdictRow {
    pub review_id: String,
    pub persona_id: String,
    pub severity: String,
    pub category: String,
    pub title: String,
    pub description: Option<String>,
    pub rationale: Option<String>,
    pub suggested_actions: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub execution_id: String,
}

pub fn list_verdicts(
    pool: &DbPool,
    persona_id: Option<&str>,
) -> Result<Vec<DirectorVerdictRow>, AppError> {
    let conn = pool.get()?;

    let (sql, params_vec): (&str, Vec<String>) = match persona_id {
        Some(pid) => (
            "SELECT id, persona_id, severity, title, description, context_data, \
                    suggested_actions, status, created_at, execution_id
             FROM persona_manual_reviews
             WHERE persona_id = ?1
               AND context_data LIKE '%\"source\":\"director\"%'
             ORDER BY created_at DESC",
            vec![pid.to_string()],
        ),
        None => (
            "SELECT id, persona_id, severity, title, description, context_data, \
                    suggested_actions, status, created_at, execution_id
             FROM persona_manual_reviews
             WHERE context_data LIKE '%\"source\":\"director\"%'
             ORDER BY created_at DESC LIMIT 200",
            vec![],
        ),
    };

    let mut stmt = conn.prepare(sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        let context_json: Option<String> = row.get("context_data")?;
        let actions_json: Option<String> = row.get("suggested_actions")?;

        let (category, rationale) = context_json
            .as_deref()
            .and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
            .map(|v| {
                let cat = v
                    .get("category")
                    .and_then(|x| x.as_str())
                    .unwrap_or("usefulness")
                    .to_string();
                let rat = v
                    .get("rationale")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                (cat, rat)
            })
            .unwrap_or_else(|| ("usefulness".to_string(), None));

        let suggested_actions: Vec<String> = actions_json
            .as_deref()
            .and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
            .and_then(|v| {
                v.get("actions").and_then(|x| x.as_array()).map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
            })
            .unwrap_or_default();

        Ok(DirectorVerdictRow {
            review_id: row.get("id")?,
            persona_id: row.get("persona_id")?,
            severity: row.get("severity")?,
            category,
            title: row.get("title")?,
            description: row.get("description")?,
            rationale,
            suggested_actions,
            status: row.get("status")?,
            created_at: row.get("created_at")?,
            execution_id: row.get("execution_id")?,
        })
    })?;

    let results: Vec<DirectorVerdictRow> = rows.filter_map(|r| r.ok()).collect();
    Ok(results)
}

/// Recent Director scores per persona, oldest→newest. Empty arrays when a
/// persona has no scored executions. Used by the personas-table trend
/// sparkline so a glance shows whether coaching is moving the needle.
pub fn list_score_trends(
    pool: &DbPool,
    persona_ids: &[String],
    limit: i64,
) -> Result<HashMap<String, Vec<i64>>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT director_score FROM persona_executions \
         WHERE persona_id = ?1 AND director_score IS NOT NULL \
         ORDER BY created_at DESC LIMIT ?2",
    )?;
    let mut out: HashMap<String, Vec<i64>> = HashMap::with_capacity(persona_ids.len());
    for pid in persona_ids {
        let rows = stmt.query_map(params![pid, limit], |row| row.get::<_, i64>(0))?;
        let mut scores: Vec<i64> = rows.filter_map(|r| r.ok()).collect();
        scores.reverse();
        out.insert(pid.clone(), scores);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Portfolio analytics (command center)
// ---------------------------------------------------------------------------
//
// Composes existing aggregates — `metrics::get_value_rollup` (fleet + per
// persona), `personas::get_starred`, and the score-trend query — into a single
// payload for the Director command center. No new SQL aggregation: the
// value-rollup that Phase 2 only ever fed to the LLM is finally surfaced.

/// One persona in the Director's coaching scope, with its latest verdict score,
/// recent trend, and value signal. Powers the command-center roster and the
/// Overview score distribution.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectorRosterEntry {
    pub persona_id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// Latest `director_score` (0-5); `None` when never reviewed.
    #[ts(type = "number | null")]
    pub latest_score: Option<i64>,
    /// Recent score history, oldest→newest (for the sparkline).
    #[ts(type = "number[]")]
    pub score_trend: Vec<i64>,
    /// `value_delivered_rate` over the window (0.0 when nothing assessed).
    pub value_delivered_rate: f64,
    #[ts(type = "number")]
    pub total_executions: i64,
    /// ISO timestamp of the most recent scored review; `None` when never reviewed.
    pub last_reviewed_at: Option<String>,
}

/// Count of in-scope personas whose latest score falls in this 0-5 band. Always
/// emitted for every band 0..=5 so the distribution bar has stable buckets.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectorScoreBand {
    #[ts(type = "number")]
    pub score: i64,
    #[ts(type = "number")]
    pub count: i64,
}

/// Portfolio-level Director analytics for the command center: the whole-fleet
/// value rollup, the in-scope roster, the latest-score distribution, and
/// headline counts. Composed entirely from existing aggregates.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectorPortfolio {
    /// Whole-fleet value rollup (all personas, not only starred) — the
    /// Director's domain is the whole fleet's value, so the headline KPIs are
    /// fleet-wide.
    pub rollup: ValueRollup,
    /// One entry per starred (in-scope) persona.
    pub roster: Vec<DirectorRosterEntry>,
    /// Latest-score histogram across in-scope personas (always 6 bands 0..=5).
    pub score_distribution: Vec<DirectorScoreBand>,
    #[ts(type = "number")]
    pub in_scope: i64,
    #[ts(type = "number")]
    pub reviewed: i64,
    #[ts(type = "number")]
    pub unreviewed: i64,
    /// Mean latest-score across reviewed in-scope personas; `None` when none
    /// have been reviewed yet.
    pub avg_score: Option<f64>,
    #[ts(type = "number")]
    pub period_days: i64,
}

/// Assemble the command-center portfolio. `days` clamps the value-rollup window
/// (1..=365, default handled by the caller). Best-effort per-persona rollups: a
/// single persona's failed rollup degrades that row to zeroed value, never the
/// whole call.
pub fn director_portfolio(pool: &DbPool, days: i64) -> Result<DirectorPortfolio, AppError> {
    let days = days.clamp(1, 365);

    // Fleet-wide rollup — reuses the persona_id=None path.
    let rollup = metrics::get_value_rollup(pool, Some(days), None)?;

    let starred = personas::get_starred(pool)?;
    let ids: Vec<String> = starred.iter().map(|p| p.id.clone()).collect();

    // Batched score trends (oldest→newest) for every in-scope persona.
    let trends = list_score_trends(pool, &ids, 12)?;

    let conn = pool.get()?;
    let mut last_reviewed_stmt = conn.prepare(
        "SELECT MAX(created_at) FROM persona_executions \
         WHERE persona_id = ?1 AND director_score IS NOT NULL",
    )?;

    let mut roster: Vec<DirectorRosterEntry> = Vec::with_capacity(starred.len());
    for p in &starred {
        let score_trend = trends.get(&p.id).cloned().unwrap_or_default();
        let latest_score = score_trend.last().copied();
        let last_reviewed_at: Option<String> = last_reviewed_stmt
            .query_row(params![p.id], |row| row.get::<_, Option<String>>(0))
            .unwrap_or(None);
        // Per-persona value signal; degrade to zeros if the rollup query fails.
        let (value_delivered_rate, total_executions) =
            match metrics::get_value_rollup(pool, Some(days), Some(&p.id)) {
                Ok(r) => (r.value_delivered_rate, r.total_executions),
                Err(_) => (0.0, 0),
            };
        roster.push(DirectorRosterEntry {
            persona_id: p.id.clone(),
            name: p.name.clone(),
            icon: p.icon.clone(),
            color: p.color.clone(),
            latest_score,
            score_trend,
            value_delivered_rate,
            total_executions,
            last_reviewed_at,
        });
    }

    // Latest-score distribution across the 6 bands.
    let mut band_counts = [0i64; 6];
    let mut reviewed = 0i64;
    let mut score_sum = 0i64;
    for entry in &roster {
        if let Some(s) = entry.latest_score {
            let idx = s.clamp(0, 5) as usize;
            band_counts[idx] += 1;
            reviewed += 1;
            score_sum += s.clamp(0, 5);
        }
    }
    let score_distribution: Vec<DirectorScoreBand> = (0..=5)
        .map(|score| DirectorScoreBand {
            score,
            count: band_counts[score as usize],
        })
        .collect();

    let in_scope = roster.len() as i64;
    let unreviewed = in_scope - reviewed;
    let avg_score = if reviewed > 0 {
        Some(score_sum as f64 / reviewed as f64)
    } else {
        None
    };

    Ok(DirectorPortfolio {
        rollup,
        roster,
        score_distribution,
        in_scope,
        reviewed,
        unreviewed,
        avg_score,
        period_days: days,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_baseline(persona: Persona) -> PersonaEvaluationContext {
        PersonaEvaluationContext {
            persona,
            recent_executions_limit: 20,
            failure_count: 0,
            success_count: 0,
            total_executions: 0,
            latest_execution_id: None,
            avg_cost_usd: 0.0,
            open_healing_issues: 0,
            open_critical_healing: 0,
            trigger_count: 0,
            memory_count: 0,
            feedback_accepts: 0,
            feedback_rejects: 0,
            days_since_last_run: None,
        }
    }

    fn dummy_persona(system_prompt: &str) -> Persona {
        use crate::db::models::{PersonaGatewayExposure, PersonaTrustLevel, PersonaTrustOrigin};
        Persona {
            id: "p-1".into(),
            project_id: "default".into(),
            name: "T".into(),
            description: None,
            system_prompt: system_prompt.into(),
            structured_prompt: None,
            last_design_result: None,
            last_test_report: None,
            design_context: None,
            home_team_id: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            starred: false,
            max_concurrent: 1,
            timeout_ms: 300_000,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            notification_channels: None,
            parameters: None,
            gateway_exposure: PersonaGatewayExposure::default(),
            trust_level: PersonaTrustLevel::default(),
            trust_origin: PersonaTrustOrigin::User,
            trust_verified_at: None,
            trust_score: 0.0,
            source_review_id: None,
            template_category: None,
            cli_awareness_enabled: false,
            langfuse_export_enabled: true,
            setup_status: "ready".to_string(),
            setup_detail: None,
            disabled_dims_json: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn parse_verdicts_extracts_valid_lines() {
        let output = "Preamble about the persona.\n\
DIRECTOR_VERDICT: {\"severity\":\"warning\",\"category\":\"usefulness\",\"title\":\"Tighten the scope\",\"description\":\"Most runs report no_input_available.\",\"rationale\":\"12/20 no_input\",\"suggested_actions\":[\"Add a precondition check\"]}\n\
Trailing prose.\n\
DIRECTOR_VERDICT: {\"severity\":\"info\",\"category\":\"prompt\",\"title\":\"Add a done-line\",\"suggested_actions\":[]}\n";
        let v = parse_verdicts(output, "p-1");
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].target_persona_id, "p-1");
        assert_eq!(v[0].severity, DirectorSeverity::Warning);
        assert_eq!(v[0].category, DirectorCategory::Usefulness);
        assert_eq!(v[0].suggested_actions.len(), 1);
        assert_eq!(v[1].category, DirectorCategory::Prompt);
        assert_eq!(v[1].description, ""); // defaulted when absent
    }

    #[test]
    fn parse_verdicts_skips_malformed_keeps_valid() {
        let output = "DIRECTOR_VERDICT: {this is not json}\n\
DIRECTOR_VERDICT: {\"severity\":\"error\",\"category\":\"health\",\"title\":\"Resolve breaker\"}\n";
        let v = parse_verdicts(output, "p-2");
        assert_eq!(v.len(), 1, "malformed line skipped, valid one kept");
        assert_eq!(v[0].severity, DirectorSeverity::Error);
        assert_eq!(v[0].category, DirectorCategory::Health);
        assert!(v[0].suggested_actions.is_empty());
        assert!(v[0].rationale.is_none());
    }

    #[test]
    fn parse_verdicts_none_without_marker() {
        assert!(parse_verdicts("regular output, no verdict markers", "p-3").is_empty());
    }

    #[test]
    fn parse_score_extracts_and_clamps() {
        let out = "preamble\nDIRECTOR_SCORE: {\"score\":5,\"summary\":\"Delivering value, no action needed.\"}\nmore";
        let (score, summary) = parse_score(out).expect("score present");
        assert_eq!(score, 5);
        assert_eq!(summary, "Delivering value, no action needed.");
        // out-of-range clamps to 0..=5
        assert_eq!(parse_score("DIRECTOR_SCORE: {\"score\":9}").unwrap().0, 5);
        assert!(parse_score("no score line here").is_none());
    }

    #[test]
    fn render_review_md_healthy_has_stars_and_no_notes() {
        let md = render_review_md(5, "All good.", &[], &[]);
        assert!(md.contains("★★★★★"));
        assert!(md.contains("(5/5)"));
        assert!(md.contains("No coaching notes"));
    }

    #[test]
    fn parse_wins_extracts_valid_lines_and_skips_malformed() {
        let out = "preamble\n\
DIRECTOR_WIN: {\"category\":\"usefulness\",\"note\":\"Value-delivered rate climbed from 40% to 75% this week.\"}\n\
DIRECTOR_WIN: {not json}\n\
DIRECTOR_WIN: {\"category\":\"prompt\",\"note\":\"\"}\n\
DIRECTOR_WIN: {\"category\":\"health\",\"note\":\"Open healing issues went to zero.\"}\n";
        let wins = parse_wins(out);
        assert_eq!(wins.len(), 2, "malformed + empty-note skipped, two kept");
        assert_eq!(wins[0].category, DirectorCategory::Usefulness);
        assert!(wins[0].note.starts_with("Value-delivered rate"));
        assert_eq!(wins[1].category, DirectorCategory::Health);
        assert!(parse_wins("no win markers here at all").is_empty());
    }

    #[test]
    fn render_review_md_with_wins_renders_strengths_section() {
        let wins = vec![DirectorWin {
            category: DirectorCategory::Usefulness,
            note: "Run delivered actionable summary on first try.".to_string(),
        }];
        let md = render_review_md(4, "Solid run.", &wins, &[]);
        assert!(md.contains("What's working"));
        assert!(md.contains("actionable summary"));
        assert!(md.contains("No coaching needed beyond the wins"));
    }

    #[test]
    fn truncate_is_char_safe_on_multibyte() {
        // Byte-slicing index 3 here would split the 3-byte '≤' and panic.
        assert_eq!(truncate("≤≤≤≤≤", 3), "≤≤≤…");
    }

    #[test]
    fn truncate_noop_when_short() {
        assert_eq!(truncate("hello", 10), "hello");
    }

    #[test]
    fn build_payload_includes_value_and_efficiency_sections() {
        let pool = crate::db::init_test_db().expect("init test db");
        let mut ctx = ctx_baseline(dummy_persona(
            "You are a weekly ops summary assistant. Done = summary posted.",
        ));
        ctx.total_executions = 12;
        ctx.success_count = 9;
        ctx.failure_count = 3;
        ctx.trigger_count = 1;
        ctx.days_since_last_run = Some(1);

        let rollup = ValueRollup {
            period_days: 30,
            total_executions: 12,
            assessed_executions: 10,
            value_delivered: 6,
            partial: 2,
            precondition_failed: 1,
            no_input_available: 1,
            unknown: 2,
            value_delivered_rate: 0.6,
            total_cost_usd: 1.20,
            cost_per_value_delivered: Some(0.20),
            models: vec![crate::db::models::ModelValueShare {
                model: "claude-opus-4-7".into(),
                executions: 12,
                cost_usd: 1.20,
                value_delivered: 6,
            }],
        };

        let payload = build_director_payload(&pool, &ctx, &rollup);
        assert!(payload.contains("## Persona identity"));
        assert!(payload.contains("Business value & model efficiency"));
        assert!(payload.contains("Value-delivered rate"));
        assert!(payload.contains("claude-opus-4-7"));
        assert!(payload.contains("DIRECTOR_VERDICT"));
    }
}
