//! Director — a meta-persona that coaches every other persona in the app.
//!
//! The Director stands *outside* each persona, reads its shape + recent
//! behaviour + open issues + past user-decision memory, and emits prose
//! "coaching" verdicts into the existing Human Review layer
//! (`persona_manual_reviews`). Users approve or reject each verdict; those
//! decisions are captured back into `persona_memories` (category
//! `director_feedback`) so future cycles calibrate to the user's taste.
//!
//! # Phase 1 (this file)
//! - Deterministic evaluator only (rule-based over existing signals)
//! - Verdicts route to `persona_manual_reviews` (severity info/warning/error)
//! - Batch-capable; currently invoked manually per-persona or over all enabled
//! - Self-evaluation of the Director persona is always skipped
//!
//! # Phase 2 (planned)
//! - LLM evaluator: swap `DeterministicEvaluator` for a `PromptEvaluator`
//!   that spawns the Director persona through the normal execution runner
//!   with `DIRECTOR_RUBRIC` as its system prompt and the gathered context as
//!   the CLI stdin payload. Approve/reject on reviews writes feedback
//!   memories that the next cycle reads as few-shot.
//!
//! # Phase 3 (planned)
//! - Three-way verdict routing: info → `persona_messages`,
//!   warning → manual reviews, error + auto-fixable → `persona_healing_issues`
//!   + `ai_healing::apply_db_fixes`. Scheduler tick in `background.rs`.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{CreateManualReviewInput, Persona, PersonaTrustOrigin};
use crate::db::repos::communication::manual_reviews;
use crate::db::repos::core::{memories, personas};
use crate::db::repos::execution::{executions, healing};
use crate::db::repos::resources::triggers;
use crate::db::DbPool;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Locked constants
// ---------------------------------------------------------------------------

/// Canonical name of the single system-owned Director persona. Combined with
/// `trust_origin='system'` this is the idempotency key for seeding.
pub const DIRECTOR_NAME: &str = "Director";

/// Short description shown in the persona list. Reads as news, not internals.
const DIRECTOR_DESCRIPTION: &str =
    "Watches every persona and suggests practical improvements. \
     Approve or dismiss its notes in your review queue — your decisions \
     teach it your taste.";

/// Icon (lucide name) and accent color for the Director persona row.
const DIRECTOR_ICON: &str = "compass";
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

Produce between 0 and 4 coaching verdicts. A verdict is prose, not a score.
For each verdict output a single JSON object on its own line prefixed with
the literal marker `DIRECTOR_VERDICT: ` so the app can parse it:

DIRECTOR_VERDICT: {"severity":"info|warning|error","category":"prompt|health|triggers|credentials|memory|usefulness","title":"<=60 chars imperative phrase","description":"1-3 sentences explaining the observation and why it matters","rationale":"concrete evidence from the context above","suggested_actions":["short prose suggestion","..."]}

Rules:
- Silence is a valid response. If the persona is healthy AND you see no
  concrete way to improve its usefulness, emit zero verdicts.
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
// Evaluator trait
// ---------------------------------------------------------------------------

/// An evaluator turns a gathered context into zero or more verdicts.
/// Phase 1 ships a `DeterministicEvaluator`. Phase 2 will add a
/// `PromptEvaluator` that drives the Director persona through the CLI runner.
pub trait DirectorEvaluator {
    fn evaluate(&self, ctx: &PersonaEvaluationContext) -> Vec<DirectorVerdict>;
}

/// Rule-based evaluator. Cheap, deterministic, catches the objective class of
/// issues that do not need an LLM to spot.
pub struct DeterministicEvaluator;

impl DirectorEvaluator for DeterministicEvaluator {
    fn evaluate(&self, ctx: &PersonaEvaluationContext) -> Vec<DirectorVerdict> {
        let mut out = Vec::new();
        let pid = ctx.persona.id.clone();

        // Rule 1 — Open critical healing
        if ctx.open_critical_healing > 0 {
            out.push(DirectorVerdict {
                target_persona_id: pid.clone(),
                severity: DirectorSeverity::Error,
                category: DirectorCategory::Health,
                title: "Resolve critical healing issues".to_string(),
                description: format!(
                    "This persona has {} open critical healing {}. \
                     Leaving these unresolved blocks progress because the app \
                     will keep retrying the same failure pattern.",
                    ctx.open_critical_healing,
                    if ctx.open_critical_healing == 1 { "issue" } else { "issues" },
                ),
                rationale: Some(format!(
                    "{} critical issues in persona_healing_issues (status='open')",
                    ctx.open_critical_healing,
                )),
                suggested_actions: vec![
                    "Open the Health tab and triage each critical issue.".into(),
                    "If the root cause is an expired credential, rotate it first.".into(),
                ],
            });
        }

        // Rule 2 — Broader open healing (warning tier)
        if ctx.open_critical_healing == 0 && ctx.open_healing_issues >= 3 {
            out.push(DirectorVerdict {
                target_persona_id: pid.clone(),
                severity: DirectorSeverity::Warning,
                category: DirectorCategory::Health,
                title: "Backlog of healing issues is piling up".to_string(),
                description: format!(
                    "There are {} open healing issues (none critical). A \
                     steady accumulation usually means the same failure mode \
                     is recurring and a config adjustment would stop it.",
                    ctx.open_healing_issues,
                ),
                rationale: Some(format!(
                    "{} open rows in persona_healing_issues",
                    ctx.open_healing_issues,
                )),
                suggested_actions: vec![
                    "Group the issues by category and fix the most frequent one first.".into(),
                ],
            });
        }

        // Rule 3 — No triggers AND no recent runs → likely dormant
        if ctx.trigger_count == 0 && ctx.total_executions == 0 {
            out.push(DirectorVerdict {
                target_persona_id: pid.clone(),
                severity: DirectorSeverity::Info,
                category: DirectorCategory::Triggers,
                title: "Persona has no triggers and has never run".to_string(),
                description: "Without a trigger or a manual run, this persona \
                     contributes nothing. Either add a trigger (schedule, webhook, \
                     file watch) or archive it to reduce noise in the grid."
                    .to_string(),
                rationale: Some("trigger_count=0 AND total_executions=0".into()),
                suggested_actions: vec![
                    "Add at least one trigger, or disable the persona to hide it from the grid.".into(),
                ],
            });
        }

        // Rule 4 — Has run before but hasn't run in 30+ days → stale
        if let Some(days) = ctx.days_since_last_run {
            if days >= 30 && ctx.total_executions > 0 {
                out.push(DirectorVerdict {
                    target_persona_id: pid.clone(),
                    severity: DirectorSeverity::Info,
                    category: DirectorCategory::Usefulness,
                    title: "Persona has gone quiet".to_string(),
                    description: format!(
                        "No executions in {} days. If you still need this \
                         persona, a missing/disabled trigger is the usual cause. \
                         If you do not need it, archive it.",
                        days,
                    ),
                    rationale: Some(format!("days_since_last_run={}", days)),
                    suggested_actions: vec![
                        "Check the trigger list for disabled/broken entries.".into(),
                        "If obsolete, disable the persona.".into(),
                    ],
                });
            }
        }

        // Rule 5 — Success rate < 50% on a meaningful sample
        if ctx.total_executions >= 5 {
            let total = ctx.total_executions as f64;
            let success_rate = ctx.success_count as f64 / total;
            if success_rate < 0.5 {
                out.push(DirectorVerdict {
                    target_persona_id: pid.clone(),
                    severity: DirectorSeverity::Warning,
                    category: DirectorCategory::Health,
                    title: "Success rate is below 50%".to_string(),
                    description: format!(
                        "Only {} of the last {} executions succeeded ({:.0}%). \
                         Repeated failures usually point to a prompt that is \
                         too ambitious for the bound tools, or a missing credential.",
                        ctx.success_count, ctx.total_executions, success_rate * 100.0,
                    ),
                    rationale: Some(format!(
                        "success={}, total={}, rate={:.2}",
                        ctx.success_count, ctx.total_executions, success_rate,
                    )),
                    suggested_actions: vec![
                        "Open the last failed execution and read the error.".into(),
                        "Narrow the persona's scope to match what its tools can actually do.".into(),
                    ],
                });
            }
        }

        // Rule 6 — Very short system_prompt (< 120 chars) AND non-trivial usage
        if ctx.persona.system_prompt.trim().len() < 120 && ctx.total_executions >= 3 {
            out.push(DirectorVerdict {
                target_persona_id: pid.clone(),
                severity: DirectorSeverity::Info,
                category: DirectorCategory::Prompt,
                title: "System prompt is very short".to_string(),
                description: "A short prompt often leaves the agent guessing about \
                     tone, audience, and stop-conditions. Adding a sentence on \
                     *who this persona is for* and *what 'done' looks like* typically \
                     improves usefulness more than any other change."
                    .to_string(),
                rationale: Some(format!(
                    "system_prompt length = {} chars",
                    ctx.persona.system_prompt.trim().len(),
                )),
                suggested_actions: vec![
                    "Add a one-sentence audience line.".into(),
                    "Add a 'this task is done when …' line.".into(),
                ],
            });
        }

        out
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
    let recent = executions::get_by_persona_id(pool, target_persona_id, Some(CONTEXT_EXECUTION_WINDOW))?;

    let total_executions = recent.len();
    let (success_count, failure_count) = recent.iter().fold((0usize, 0usize), |(s, f), e| {
        match e.status.as_str() {
            "completed" | "success" | "succeeded" => (s + 1, f),
            "failed" | "error" | "timeout" => (s, f + 1),
            _ => (s, f),
        }
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
    let (feedback_accepts, feedback_rejects) = memories.iter().fold((0usize, 0usize), |(a, r), m| {
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
/// of verdicts emitted (0 is the healthy outcome).
pub fn run_director_cycle_for(
    pool: &DbPool,
    target_persona_id: &str,
) -> Result<i64, AppError> {
    let director_id = get_director_persona_id(pool)?;
    if target_persona_id == director_id {
        // Never evaluate yourself.
        return Ok(0);
    }

    let ctx = gather_context(pool, target_persona_id)?;

    let evaluator = DeterministicEvaluator;
    let verdicts = evaluator.evaluate(&ctx);

    route_verdicts(pool, &ctx, &verdicts)?;
    Ok(verdicts.len() as i64)
}

/// Batch cycle. Iterates enabled user personas (skipping the Director itself),
/// evaluates each, returns an aggregate report.
pub fn run_director_cycle_batch(
    pool: &DbPool,
    max_personas: Option<i64>,
) -> Result<DirectorReport, AppError> {
    let director_id = get_director_persona_id(pool)?;
    let enabled = personas::get_enabled(pool)?;

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

        let ctx = match gather_context(pool, &p.id) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(persona_id = %p.id, error = %e, "Director: failed to gather context, skipping");
                continue;
            }
        };

        // A persona with NO executions cannot anchor a manual review (FK
        // constraint requires execution_id). Tally the skip so the report is
        // honest; Phase 3 will switch those to `persona_messages` which does
        // not have the FK.
        if ctx.latest_execution_id.is_none() {
            // Still count "no triggers + no executions" advice since those
            // don't need an execution anchor — but for Phase 1 we can't emit
            // them either without the FK. Count as skipped.
            skipped += 1;
            continue;
        }

        let evaluator = DeterministicEvaluator;
        let verdicts = evaluator.evaluate(&ctx);
        route_verdicts(pool, &ctx, &verdicts)?;

        evaluated += 1;
        emitted += verdicts.len() as i64;
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
    let param_refs: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
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
                v.get("actions")
                    .and_then(|x| x.as_array())
                    .map(|arr| {
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

    let results: Vec<DirectorVerdictRow> = rows
        .filter_map(|r| r.ok())
        .collect();

    let _ = PersonaTrustOrigin::System; // keep the import live for future use
    Ok(results)
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
        use crate::db::models::{HealthStatus, PersonaHealth, PersonaTrustLevel};
        Persona {
            id: "p-1".into(),
            project_id: "default".into(),
            name: "T".into(),
            description: None,
            system_prompt: system_prompt.into(),
            structured_prompt: None,
            last_design_result: None,
            design_context: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 300_000,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            notification_channels: None,
            parameters: None,
            trust_level: PersonaTrustLevel::default(),
            trust_origin: PersonaTrustOrigin::User,
            trust_verified_at: None,
            trust_score: 0.0,
            source_review_id: None,
            template_category: None,
            group_id: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            health: PersonaHealth {
                status: HealthStatus::Healthy,
                last_execution_status: None,
                last_execution_at: None,
                avg_duration_ms: None,
                success_rate: 1.0,
                consecutive_failures: 0,
                sparkline_data: vec![],
            },
        }
    }

    #[test]
    fn healthy_persona_emits_zero_verdicts() {
        let mut ctx = ctx_baseline(dummy_persona(
            "You are a helpful assistant that drafts weekly summary reports \
             for the operations team. A task is done when the summary has \
             been posted to the shared channel and no one has flagged errors.",
        ));
        ctx.total_executions = 10;
        ctx.success_count = 10;
        ctx.trigger_count = 1;
        ctx.days_since_last_run = Some(2);

        let out = DeterministicEvaluator.evaluate(&ctx);
        assert_eq!(out.len(), 0, "healthy persona should produce no verdicts");
    }

    #[test]
    fn critical_healing_emits_error_verdict() {
        let mut ctx = ctx_baseline(dummy_persona("short"));
        ctx.total_executions = 10;
        ctx.success_count = 10;
        ctx.trigger_count = 1;
        ctx.open_healing_issues = 2;
        ctx.open_critical_healing = 2;

        let out = DeterministicEvaluator.evaluate(&ctx);
        assert!(out.iter().any(|v| v.severity == DirectorSeverity::Error
            && v.category == DirectorCategory::Health));
    }

    #[test]
    fn low_success_rate_emits_warning() {
        let mut ctx = ctx_baseline(dummy_persona(
            "You are a helpful assistant that drafts weekly summary reports \
             with enough detail to satisfy the ops team's review.",
        ));
        ctx.total_executions = 10;
        ctx.success_count = 3;
        ctx.failure_count = 7;
        ctx.trigger_count = 1;
        ctx.days_since_last_run = Some(1);

        let out = DeterministicEvaluator.evaluate(&ctx);
        assert!(out.iter().any(|v| v.severity == DirectorSeverity::Warning
            && v.category == DirectorCategory::Health));
    }

    #[test]
    fn short_prompt_with_usage_emits_info() {
        let mut ctx = ctx_baseline(dummy_persona("Be helpful."));
        ctx.total_executions = 5;
        ctx.success_count = 5;
        ctx.trigger_count = 1;
        ctx.days_since_last_run = Some(2);

        let out = DeterministicEvaluator.evaluate(&ctx);
        assert!(out.iter().any(|v| v.category == DirectorCategory::Prompt));
    }

    #[test]
    fn dormant_persona_emits_info() {
        let mut ctx = ctx_baseline(dummy_persona(
            "You are a helpful assistant that drafts weekly summary reports \
             with enough detail to satisfy the ops team's review.",
        ));
        // never run, no triggers
        let out = DeterministicEvaluator.evaluate(&ctx);
        assert!(out.iter().any(|v| v.category == DirectorCategory::Triggers));
    }
}
