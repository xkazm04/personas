//! Match a `TeamAssignmentStep` to a (persona, use_case) pair from the team
//! roster — Phase B's resolution layer.
//!
//! Three strategies share one entry point so the orchestrator can stay
//! strategy-agnostic:
//!
//! - **`manual`** — Phase A baseline. The composer already chose
//!   `assigned_persona_id` + `assigned_use_case_id`. This branch trusts that
//!   and just confirms the persona is still eligible (the orchestrator's
//!   pre-flight covers this; matching is a passthrough here).
//!
//! - **`embedding`** — Phase B1. Local fastembed cosine match. Embeds the
//!   step description against each eligible candidate's
//!   `DesignUseCase.capability_summary || description`. Highest cosine wins;
//!   trust_score breaks ties.
//!
//! - **`llm_eval`** — Phase B2. One Sonnet call per step (NOT per candidate)
//!   feeding the team roster + step. Returns `(persona_id, use_case_id,
//!   confidence, rationale)`. Used as auto-fallback when the embedding path
//!   yields confidence below `EMBEDDING_FALLBACK_CONFIDENCE` AND the team
//!   has more than one eligible candidate.
//!
//! The candidate set is always filtered through the orchestrator's
//! `check_persona_eligible` first (enabled + setup_status='ready' +
//! trust_level != Revoked), so a returned match is always actionable.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;

use crate::db::models::{DesignContextData, Persona};
use crate::error::AppError;

#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;

#[cfg(not(feature = "ml"))]
pub struct EmbeddingManager;

// ----------------------------------------------------------------------------
// Tunables
// ----------------------------------------------------------------------------

/// Below this cosine the embedding strategy is considered uncertain.
/// When the user opted into `embedding` matching and the strategy returns
/// confidence below this floor, the orchestrator may fall back to `llm_eval`
/// for the affected step (when LLM eval is available + worth the cost).
pub const EMBEDDING_FALLBACK_CONFIDENCE: f64 = 0.45;

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/// A persona + one of its enabled use_cases. Built by `extract_candidates`
/// after applying the eligibility filter.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub persona_id: String,
    pub persona_name: String,
    pub trust_score: f64,
    pub use_case_id: String,
    pub use_case_title: String,
    /// `capability_summary || description` — the text the embedding / LLM
    /// strategies actually compare against.
    pub corpus: String,
    /// Optional advisory tool list from the use case. Surfaced to the LLM
    /// eval prompt as context; ignored by the embedding strategy.
    pub tool_hints: Vec<String>,
}

/// The result of resolving a step's (persona, use_case).
#[derive(Debug, Clone)]
pub struct MatchResult {
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub confidence: Option<f64>,
    pub rationale: Option<String>,
}

// ----------------------------------------------------------------------------
// Candidate extraction
// ----------------------------------------------------------------------------

/// Build the candidate list for a team from a pre-filtered persona slice.
/// A persona with N enabled use_cases produces N candidates. Personas with
/// no enabled use_cases produce one fallback candidate using the persona's
/// `description` field as the corpus.
pub fn extract_candidates(team_personas: &[Persona]) -> Vec<Candidate> {
    let mut out = Vec::new();
    for persona in team_personas {
        let ctx: DesignContextData = persona.parsed_design_context();
        let mut emitted = 0usize;
        if let Some(use_cases) = ctx.use_cases.as_ref() {
            for uc in use_cases {
                // Phase C1 enabled toggle — skip explicit-false; treat absent / true as on.
                if uc.enabled == Some(false) {
                    continue;
                }
                let corpus = match (uc.capability_summary.as_ref(), &uc.description) {
                    (Some(summary), _) if !summary.trim().is_empty() => summary.clone(),
                    (_, d) if !d.trim().is_empty() => d.clone(),
                    _ => uc.title.clone(),
                };
                out.push(Candidate {
                    persona_id: persona.id.clone(),
                    persona_name: persona.name.clone(),
                    trust_score: persona.trust_score,
                    use_case_id: uc.id.clone(),
                    use_case_title: uc.title.clone(),
                    corpus,
                    tool_hints: uc.tool_hints.clone().unwrap_or_default(),
                });
                emitted += 1;
            }
        }
        // Fallback: persona has no enabled use_cases — let it still be matchable
        // against the step description, using its own description as corpus.
        if emitted == 0 {
            let corpus = persona
                .description
                .clone()
                .filter(|d| !d.trim().is_empty())
                .unwrap_or_else(|| persona.name.clone());
            out.push(Candidate {
                persona_id: persona.id.clone(),
                persona_name: persona.name.clone(),
                trust_score: persona.trust_score,
                use_case_id: String::new(),
                use_case_title: String::new(),
                corpus,
                tool_hints: Vec::new(),
            });
        }
    }
    out
}

// ----------------------------------------------------------------------------
// Embedding strategy (Phase B1) — fastembed cosine, gated by ml feature
// ----------------------------------------------------------------------------

#[cfg(feature = "ml")]
pub async fn match_via_embedding(
    embedder: &Arc<EmbeddingManager>,
    step_description: &str,
    candidates: &[Candidate],
) -> Result<MatchResult, AppError> {
    if candidates.is_empty() {
        return Err(AppError::Validation(
            "No eligible candidates for embedding match".into(),
        ));
    }

    // Single batch call: [step] + each candidate corpus, so we get all vectors
    // from one model invocation instead of N+1.
    let mut texts: Vec<String> = Vec::with_capacity(candidates.len() + 1);
    texts.push(step_description.to_string());
    for c in candidates {
        texts.push(c.corpus.clone());
    }
    let vectors = embedder.embed_batch(&texts).await?;
    if vectors.len() != candidates.len() + 1 {
        return Err(AppError::Internal(format!(
            "Embedding batch returned {} vectors for {} inputs",
            vectors.len(),
            candidates.len() + 1
        )));
    }

    let step_vec = &vectors[0];
    let mut best: Option<(usize, f64)> = None;
    for (idx, cand_vec) in vectors[1..].iter().enumerate() {
        let cosine = cosine_similarity(step_vec, cand_vec);
        // Trust-score tie-break: nudges identical-cosine candidates toward
        // the more-trusted persona without overpowering the semantic signal.
        let composite = cosine as f64 + (candidates[idx].trust_score * 1e-4);
        match best {
            Some((_, current)) if composite <= current => {}
            _ => best = Some((idx, composite)),
        }
    }
    let (idx, _) = best.expect("non-empty candidate list");
    let winner = &candidates[idx];
    let raw_cosine = cosine_similarity(step_vec, &vectors[idx + 1]);
    Ok(MatchResult {
        persona_id: winner.persona_id.clone(),
        use_case_id: if winner.use_case_id.is_empty() {
            None
        } else {
            Some(winner.use_case_id.clone())
        },
        confidence: Some(raw_cosine as f64),
        rationale: Some(format!(
            "embedding cosine={:.3} (persona={}, capability={})",
            raw_cosine, winner.persona_name, winner.use_case_title
        )),
    })
}

#[cfg(not(feature = "ml"))]
pub async fn match_via_embedding(
    _embedder: &Arc<EmbeddingManager>,
    _step_description: &str,
    _candidates: &[Candidate],
) -> Result<MatchResult, AppError> {
    Err(AppError::Validation(
        "Embedding matching requires the 'ml' build feature (use llm_eval or manual instead)"
            .into(),
    ))
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0f32;
    let mut na = 0f32;
    let mut nb = 0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = (na.sqrt()) * (nb.sqrt());
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

// ----------------------------------------------------------------------------
// LLM-eval strategy (Phase B2) — Sonnet via ClaudeProvider one-shot
// ----------------------------------------------------------------------------

/// The JSON shape Sonnet is asked to emit when scoring candidates.
/// Matches the eval/parse loop in `parse_llm_match_response`.
#[derive(Debug, Deserialize)]
pub(crate) struct LlmMatchResponse {
    pub persona_id: String,
    pub use_case_id: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub rationale: Option<String>,
}

/// Builds the prompt fed to the one-shot Sonnet call. Public for testability.
pub fn build_llm_match_prompt(step_title: &str, step_description: &str, candidates: &[Candidate]) -> String {
    let roster = candidates
        .iter()
        .map(|c| {
            let tools = if c.tool_hints.is_empty() {
                String::new()
            } else {
                format!(" — preferred tools: {}", c.tool_hints.join(", "))
            };
            format!(
                "- persona_id={} use_case_id={} | {} / {} — {}{}",
                c.persona_id, c.use_case_id, c.persona_name, c.use_case_title, c.corpus, tools
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"You are routing a single task to the best agent on a team.

## Step
Title: {step_title}
Description: {step_description}

## Eligible candidates
{roster}

## Response
Respond with ONLY a JSON object on a single line:
{{"persona_id": "<id>", "use_case_id": "<id or null>", "confidence": <0.0-1.0>, "rationale": "<one short sentence>"}}

Pick exactly one candidate from the list above. The use_case_id must match the candidate's use_case_id (or null only if the candidate's use_case_id was empty). The confidence is your own assessment of fit, not a vote — be honest and lower it when the match is weak."#
    )
}

/// Extract the JSON object Sonnet returns. Tolerates leading/trailing chatter
/// since Claude sometimes wraps replies in prose despite the "ONLY a JSON
/// object" instruction.
pub fn parse_llm_match_response(raw: &str) -> Result<LlmMatchResponse, AppError> {
    let trimmed = raw.trim();
    if let Ok(parsed) = serde_json::from_str::<LlmMatchResponse>(trimmed) {
        return Ok(parsed);
    }
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            if let Ok(parsed) = serde_json::from_str::<LlmMatchResponse>(&trimmed[start..=end]) {
                return Ok(parsed);
            }
        }
    }
    Err(AppError::Internal(format!(
        "LLM match returned unparseable response: {}",
        &trimmed[..trimmed.len().min(300)]
    )))
}

/// Resolve a step's assignee by asking Sonnet to pick from the candidates.
/// Single CLI subprocess; bounded by `timeout_secs`.
pub async fn match_via_llm_eval(
    step_title: &str,
    step_description: &str,
    candidates: &[Candidate],
    timeout_secs: u64,
) -> Result<MatchResult, AppError> {
    use crate::engine::cli_process::CliProcessDriver;
    use crate::engine::parser;
    use crate::engine::prompt;
    use crate::engine::types::StreamLineType;

    if candidates.is_empty() {
        return Err(AppError::Validation(
            "No eligible candidates for llm_eval match".into(),
        ));
    }

    let prompt_text = build_llm_match_prompt(step_title, step_description, candidates);
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let mut driver = CliProcessDriver::spawn_temp_no_stderr(&cli_args, "personas-assignment-match")
        .map_err(|e| AppError::Internal(format!("Failed to spawn LLM match: {e}")))?;
    driver.write_stdin(prompt_text.as_bytes()).await;
    let _ = driver.close_stdin().await;

    let mut assistant_text = String::new();
    let timeout = tokio::time::Duration::from_secs(timeout_secs);
    driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            if let StreamLineType::AssistantText { text } = line_type {
                assistant_text.push_str(&text);
                assistant_text.push('\n');
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("LLM match timeout/failure: {e}")))?;
    let _ = driver.finish().await;

    let parsed = parse_llm_match_response(&assistant_text)?;
    // Validate the persona_id returned is one of the offered candidates — Sonnet
    // sometimes hallucinates an id that wasn't on the list.
    let valid = candidates
        .iter()
        .any(|c| c.persona_id == parsed.persona_id);
    if !valid {
        return Err(AppError::Internal(format!(
            "LLM returned persona_id '{}' that was not in the candidate list",
            parsed.persona_id
        )));
    }
    Ok(MatchResult {
        persona_id: parsed.persona_id,
        use_case_id: parsed.use_case_id,
        confidence: parsed.confidence,
        rationale: parsed.rationale.or_else(|| Some("llm_eval".into())),
    })
}

// ----------------------------------------------------------------------------
// Auto-decompose (Phase B3) — Sonnet generates ordered steps from a goal
// ----------------------------------------------------------------------------

/// Step proposal returned by `decompose_goal`. The frontend wraps these
/// into editable composer rows before the user submits.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DecomposedStep {
    pub title: String,
    pub description: String,
    pub suggested_persona_id: Option<String>,
    pub suggested_use_case_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DecomposeResponse {
    steps: Vec<DecomposedStep>,
}

pub fn build_decompose_prompt(goal: &str, candidates: &[Candidate]) -> String {
    let roster = candidates
        .iter()
        .map(|c| {
            format!(
                "- persona_id={} use_case_id={} | {} / {} — {}",
                c.persona_id, c.use_case_id, c.persona_name, c.use_case_title, c.corpus
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"You are decomposing a team-level goal into an ordered checklist
of steps for an AI agent team that ships working software.

## Goal
{goal}

## Team roster (every step must be assignable to one of these)
{roster}

## Required pipeline shape (CRITICAL)
The steps run SEQUENTIALLY — each step consumes the previous step's output, so
order matters. A goal is only delivered when code is actually WRITTEN, so the
checklist MUST contain an IMPLEMENTATION step that produces the code/tests, and
it MUST come BEFORE any review / test / security / docs step. Never produce a
checklist that reviews, security-scans, or documents work that no prior step
implemented — that is the most common failure and wastes the whole run.

Follow this canonical order (include the steps that fit the goal; always include
implement AND the QA test+merge step):
1. (optional) Scope / design — an architect produces a short plan/ADR + task breakdown.
2. REQUIRED — Implement — the engineer / builder / "Dev Clone" persona writes the
   actual code + tests for the increment and opens a PR (this is the step that
   delivers value).
3. (optional) Review — a reviewer checks the IMPLEMENTED change.
4. (optional) Security — INCLUDE this step whenever the increment touches auth,
   sessions, permissions, PII/PHI, payments/billing, secrets/credentials, file
   uploads, or external input parsing — the security persona scans the
   IMPLEMENTED change. Skip it only for changes that clearly touch none of those.
4b. (optional) UX review — for USER-FACING increments (UI, flows, onboarding,
   copy), the UX persona reviews the implemented change for flow clarity,
   accessibility, and consistency.
5. REQUIRED — QA test + merge — the QA persona tests the opened PR in an isolated
   worktree and MERGES it (or requests changes). Without this step the PR strands
   open and the goal is not actually delivered — the work only counts when it is
   on the main branch.
6. (optional) Release — when the increment ships user-visible value, the release
   persona bumps the version + CHANGELOG directly on the base branch AFTER the
   merge (mechanical lane — no PR).
7. (optional) Docs — a docs persona updates docs for the MERGED change.

Assign the implementation step to the roster entry whose capability is building/
coding/engineering (the engineer or "Dev Clone"), and the QA test+merge step to
the QA / quality-guardian roster entry. Assign each other step to the roster
entry whose capability text best matches it.

## Response
Respond with ONLY a JSON object on a single line, no markdown:
{{"steps": [
  {{"title": "<short imperative title>",
    "description": "<one-sentence description of what this step must accomplish, written so the assigned agent can act on it standalone>",
    "suggestedPersonaId": "<one of the persona_ids above>",
    "suggestedUseCaseId": "<the matching use_case_id from the same line, or null>"}}
]}}

Aim for 2-5 steps, in execution order (the engine chains them so step N depends
on step N-1). The first step has no dependencies; every later step consumes the
prior step's output."#
    )
}

pub async fn decompose_goal(
    goal: &str,
    candidates: &[Candidate],
    timeout_secs: u64,
) -> Result<Vec<DecomposedStep>, AppError> {
    use crate::engine::cli_process::CliProcessDriver;
    use crate::engine::parser;
    use crate::engine::prompt;
    use crate::engine::types::StreamLineType;

    if candidates.is_empty() {
        return Err(AppError::Validation(
            "Cannot decompose a goal — the team has no eligible personas".into(),
        ));
    }

    let prompt_text = build_decompose_prompt(goal, candidates);
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let mut driver = CliProcessDriver::spawn_temp_no_stderr(&cli_args, "personas-assignment-decompose")
        .map_err(|e| AppError::Internal(format!("Failed to spawn decompose: {e}")))?;
    driver.write_stdin(prompt_text.as_bytes()).await;
    let _ = driver.close_stdin().await;

    let mut assistant_text = String::new();
    let timeout = tokio::time::Duration::from_secs(timeout_secs);
    driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            if let StreamLineType::AssistantText { text } = line_type {
                assistant_text.push_str(&text);
                assistant_text.push('\n');
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("Decompose timeout/failure: {e}")))?;
    let _ = driver.finish().await;

    let trimmed = assistant_text.trim();
    let parsed: DecomposeResponse = if let Ok(p) = serde_json::from_str::<DecomposeResponse>(trimmed) {
        p
    } else if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        serde_json::from_str(&trimmed[start..=end]).map_err(|e| {
            AppError::Internal(format!("Decompose JSON parse error: {e}"))
        })?
    } else {
        return Err(AppError::Internal(format!(
            "Decompose returned unparseable response: {}",
            &trimmed[..trimmed.len().min(300)]
        )));
    };

    if parsed.steps.is_empty() {
        return Err(AppError::Internal(
            "Decompose returned zero steps — refine the goal".into(),
        ));
    }
    // Validate every suggested_persona_id appears in the candidate list. If
    // it doesn't, drop the suggestion (let the user pick manually) rather
    // than emit a bogus id.
    let allowed: std::collections::HashSet<&str> =
        candidates.iter().map(|c| c.persona_id.as_str()).collect();
    let cleaned = parsed
        .steps
        .into_iter()
        .map(|mut s| {
            if let Some(ref pid) = s.suggested_persona_id {
                if !allowed.contains(pid.as_str()) {
                    s.suggested_persona_id = None;
                    s.suggested_use_case_id = None;
                }
            }
            s
        })
        .collect();
    Ok(cleaned)
}

// Suppress unused-import warning when ml feature is off — the no-ml stub
// uses `Arc` only in its signature, which is fine; nothing else to silence.
#[allow(dead_code)]
fn _hint() -> serde_json::Value {
    json!({})
}
