//! Memory reflection engine — synthesis of higher-level insights.
//!
//! Memory Engine v2 (docs/plans/memory-service.md). The existing curation
//! pass (`commands::core::memories::run_memory_review_pipeline`) only
//! re-scores and deletes; it never CONSOLIDATES. Ten related "learned"
//! memories about the same failure mode stay ten rows forever, competing
//! for the injection budget. Reflection closes that gap:
//!
//! 1. Fetch the persona's non-archived memories.
//! 2. Compute deterministic cluster hints (word-set Jaccard over
//!    title+content) so the LLM sees which memories are likely related —
//!    and so a cheaper model (the phase-2 cloud service runs this same
//!    pipeline on Qwen) doesn't have to discover structure from scratch.
//! 3. One-shot LLM pass proposing: `synthesize` actions (N sources → one
//!    durable insight, contradiction resolutions included) and `archive`
//!    actions (stale rows not worth keeping standalone).
//! 4. Everything lands as a `persona_memory_review_proposal` row —
//!    review-and-discard, never direct mutation. Apply lives in
//!    `commands::core::memories::apply_persona_memory_review_proposal`:
//!    synthesize = `create_synthesized` (with `derived_from` provenance)
//!    + archive sources; archive = reversible tier flip. `core` (user-
//!    pinned) is read-only context at every step.
//!
//! Two extensions on the same pipeline:
//!
//! - **Team reflection** (`run_team_memory_reflection`): reflects across
//!   ALL of a team's members at once and only synthesizes lessons held by
//!   ≥2 different members. Applied insights are published team-wide via
//!   `home_team_id` (one shared row replaces N per-member copies); the
//!   member copies archive with provenance intact.
//! - **Product-findings bridge**: alongside memory actions, the LLM
//!   extracts OPEN THREADS about the software the agents work on (bugs,
//!   debt, unresolved review findings) which land as `pending` rows in
//!   the dev-tools ideas backlog — that surface is already triage-gated,
//!   so the human approval gate is preserved. Findings never consume
//!   memories.

use std::io::ErrorKind;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::db::models::{normalize_category, PersonaMemory};
use crate::db::repos::core::memories as repo;
use crate::db::repos::core::memory_review_proposal::{
    self as proposal_repo, CreateProposalInput, ProposalEntry,
};
use crate::db::DbPool;
use crate::error::AppError;

/// Fewer memories than this and there is nothing to consolidate.
const MIN_MEMORIES_FOR_REFLECTION: usize = 5;

/// Cap on memories fed to the LLM (mirrors the curation pipeline's cap).
const REFLECTION_FETCH_LIMIT: i64 = 200;

/// Jaccard similarity threshold for cluster hints. Deliberately loose —
/// hints are advisory; the LLM makes the final grouping call.
const CLUSTER_SIMILARITY_THRESHOLD: f64 = 0.30;

/// Upper bound on proposed insights per pass, enforced after parse.
const MAX_INSIGHTS_PER_PASS: usize = 10;

/// CLI wall-clock cap. The first live audit (docs/harness/
/// reflect-eval-2026-07-10) saw a ~60-memory pass exceed the original
/// 4-minute cap once in three runs; 8 minutes gives headroom without
/// letting a hung CLI camp forever.
const CLI_TIMEOUT_SECS: u64 = 480;

/// Per-pass consumption cap: at most this fraction of the persona's
/// non-core pool may be consumed (synthesis sources + standalone
/// archives) in one reflection. Keeps each apply small enough to judge —
/// the first live audit consumed 56/61 in one pass, which was correct
/// but at the upper bound of reviewable. Deferred work simply lands in
/// the next pass.
const MAX_CONSUMPTION_RATIO: f64 = 0.6;

/// Per-memory content clamp for the reflection prompt. Trims prompt
/// size (the main CLI-latency driver) without losing the gist; the
/// classifier and apply path always operate on full stored content.
const MAX_PROMPT_CONTENT_CHARS: usize = 700;

/// Clamp a string to `max` characters on a char boundary, with a marker.
fn clamp_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let clipped: String = s.chars().take(max).collect();
    format!("{clipped}…[truncated]")
}

/// Cap on product findings promoted to the ideas backlog per pass.
const MAX_FINDINGS_PER_PASS: usize = 5;

/// Outcome of a reflection pass, pre-proposal.
pub struct ReflectionOutcome {
    pub proposal_id: String,
    pub reviewed: usize,
    pub entries: Vec<ProposalEntry>,
    pub summary: String,
    /// Product findings written to the dev-tools ideas backlog (pending,
    /// triage-gated there — independent of the memory proposal's fate).
    pub findings_created: usize,
}

// ---------------------------------------------------------------------------
// Cluster hints (deterministic, no LLM)
// ---------------------------------------------------------------------------

fn word_set(m: &PersonaMemory) -> std::collections::HashSet<String> {
    format!("{} {}", m.title, m.content)
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2)
        .map(|w| w.to_string())
        .collect()
}

fn jaccard(a: &std::collections::HashSet<String>, b: &std::collections::HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f64;
    let union = (a.len() + b.len()) as f64 - inter;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// Single-linkage clustering over word-set Jaccard similarity. Returns
/// groups of ≥2 memory ids, largest first. O(n²) pairwise on ≤200 rows.
pub(crate) fn cluster_hints(memories: &[PersonaMemory]) -> Vec<Vec<String>> {
    let n = memories.len();
    let sets: Vec<_> = memories.iter().map(word_set).collect();
    // Union-find
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut Vec<usize>, i: usize) -> usize {
        let mut i = i;
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for i in 0..n {
        for j in (i + 1)..n {
            if jaccard(&sets[i], &sets[j]) >= CLUSTER_SIMILARITY_THRESHOLD {
                let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                if ri != rj {
                    parent[ri] = rj;
                }
            }
        }
    }
    let mut groups: std::collections::HashMap<usize, Vec<String>> =
        std::collections::HashMap::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(memories[i].id.clone());
    }
    let mut out: Vec<Vec<String>> = groups.into_values().filter(|g| g.len() >= 2).collect();
    out.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a[0].cmp(&b[0])));
    out
}

// ---------------------------------------------------------------------------
// LLM output shape
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct InsightSpec {
    title: String,
    content: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    importance: Option<i32>,
    #[serde(default)]
    source_ids: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ArchiveSpec {
    id: String,
    #[serde(default)]
    reason: Option<String>,
}

/// An open thread about the PRODUCT the agents work on (not about the
/// agents' own behavior) — promoted to the dev-tools ideas backlog.
#[derive(Debug, serde::Deserialize)]
struct ProductFindingSpec {
    title: String,
    #[serde(default)]
    description: Option<String>,
    /// `bug` | `debt` | `followup` — advisory label folded into the idea.
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    source_ids: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ReflectionOutput {
    #[serde(default)]
    insights: Vec<InsightSpec>,
    #[serde(default)]
    archive: Vec<ArchiveSpec>,
    #[serde(default)]
    product_findings: Vec<ProductFindingSpec>,
    #[serde(default)]
    summary: Option<String>,
}

/// Extract the outermost brace-balanced JSON object from LLM output that
/// may carry prose or markdown fences around it. String- and escape-aware.
///
/// Thin wrapper over the shared `safe_json::extract_balanced_object` (kept
/// as a distinct `pub(crate)` name for call-site stability; see
/// refactor-bughunt-2026-07-10, tauri-engine-3-10 #8).
pub(crate) fn extract_json_object(s: &str) -> Option<String> {
    super::safe_json::extract_balanced_object(s).map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

fn build_reflection_prompt(
    memories: &[PersonaMemory],
    core_ids: &[String],
    clusters: &[Vec<String>],
    instructions: Option<&str>,
    // Some((roster id→name)) switches the prompt into TEAM mode: memories
    // carry their owning persona, and synthesis requires cross-member
    // convergence.
    team_roster: Option<&std::collections::HashMap<String, String>>,
) -> Result<String, AppError> {
    let entries: Vec<serde_json::Value> = memories
        .iter()
        .map(|m| {
            let mut v = serde_json::json!({
                "id": m.id,
                "title": m.title,
                "content": clamp_chars(&m.content, MAX_PROMPT_CONTENT_CHARS),
                "category": m.category,
                "importance": m.importance,
                "tier": m.tier,
                "access_count": m.access_count,
                "created_at": m.created_at,
            });
            if team_roster.is_some() {
                v["persona_id"] = serde_json::Value::String(m.persona_id.clone());
            }
            v
        })
        .collect();
    let memories_json = serde_json::to_string_pretty(&entries)
        .map_err(|e| AppError::Internal(format!("Serialize memories: {e}")))?;
    let clusters_json = serde_json::to_string(clusters)
        .map_err(|e| AppError::Internal(format!("Serialize clusters: {e}")))?;
    let core_json = serde_json::to_string(core_ids)
        .map_err(|e| AppError::Internal(format!("Serialize core ids: {e}")))?;
    let guidance_block = instructions
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("\n\nAdditional guidance from operator:\n{s}\n"))
        .unwrap_or_default();

    let (mode_intro, team_block) = match team_roster {
        Some(roster) => {
            let roster_json = serde_json::to_string(roster)
                .map_err(|e| AppError::Internal(format!("Serialize roster: {e}")))?;
            (
                "You are running a TEAM memory REFLECTION pass in Personas, an agent management platform. The memories below belong to the MEMBERS of one team (each carries its owning persona_id). Your job is to find lessons the team has learned REDUNDANTLY — the same knowledge held by two or more different members — and consolidate each into ONE team-shared insight that every member will see, replacing the per-member copies.",
                format!("\n\nTeam roster (persona_id → name):\n{roster_json}\n\nTEAM RULES:\n- Synthesize ONLY when the source_ids span >= 2 DIFFERENT persona_id values — a lesson one member holds alone is not team knowledge; leave it untouched.\n- The insight content must be phrased team-neutrally (no \"I\"; it will be injected into every member's context).\n- Do not merge role-specific knowledge (e.g. a reviewer-only checklist) with implementer knowledge just because the topic matches — team knowledge is what EVERY member should act on."),
            )
        }
        None => (
            "You are running a memory REFLECTION pass for an AI agent persona in Personas, an agent management platform. Reflection consolidates many raw memories into fewer, more durable insights so the agent's limited memory budget carries maximum knowledge.",
            String::new(),
        ),
    };

    Ok(format!(
        r#"{mode_intro}

Candidate related groups (deterministic similarity hints — advisory, you decide the real grouping):
{clusters_json}

PINNED (core-tier) memory ids — read-only context. NEVER list them in source_ids or archive:
{core_json}{team_block}

Respond with ONLY a JSON object (no markdown fences, no prose):
{{"insights":[{{"title":"...","content":"...","category":"learned","importance":3,"source_ids":["id1","id2"],"reason":"..."}}],
 "archive":[{{"id":"...","reason":"..."}}],
 "product_findings":[{{"title":"...","description":"...","kind":"bug","source_ids":["id1"],"reason":"..."}}],
 "summary":"one short paragraph describing what this reflection found"}}

Rules:
- An insight MUST cite >= 2 source_ids and must only state what those sources support — never invent facts. On apply, the sources are archived and replaced by the insight, so the insight content must fully preserve what still matters.
- Synthesize when several memories describe the same lesson, pattern, preference, or fact at different levels of detail: write the single best current version.
- When two memories CONTRADICT, write the correct/current fact as an insight citing both, and say in reason which one won and why (newer, more specific, or confirmed by access patterns).
- category ∈ fact | preference | instruction | context | learned | constraint. importance ∈ 1..5 (5 = critical).
- Propose "archive" only for memories that are stale or redundant on their own; prefer synthesize when the content is worth keeping in consolidated form.
- CARRY OPEN THREADS: any unresolved finding, open backlog item, pending PR status, standing veto, or unconfirmed fix mentioned in a source MUST survive verbatim (or tighter) in an insight that cites it — open threads NEVER count as redundant and must not be silently dropped.
- Keep each insight's content focused and under ~120 words; split unrelated themes into separate insights instead of one mega-memory.
- Consolidate INCREMENTALLY: consume at most ~60% of the non-pinned memories in this pass — prioritize the highest-value clusters and leave the rest for a future pass (over-budget insights are dropped automatically).
- At most {MAX_INSIGHTS_PER_PASS} insights. If nothing is worth consolidating, return empty arrays — an empty reflection is a valid result.
- PRODUCT FINDINGS (separate from memory actions; they consume nothing): extract open threads about the SOFTWARE the agent works on — unresolved bugs, known debt, unconfirmed fixes, review findings never closed. Each needs a specific actionable title, a description with enough context to act without reading the memories, and the source_ids it came from. Do NOT report the agent's own process lessons here, and do NOT report items the sources say are already fixed/closed. At most {MAX_FINDINGS_PER_PASS}; an empty array is the common correct answer.
{guidance_block}
Memories:
{memories_json}"#
    ))
}

// ---------------------------------------------------------------------------
// CLI one-shot (mirrors the curation pipeline's spawn contract)
// ---------------------------------------------------------------------------

async fn run_claude_oneshot(prompt: &str) -> Result<String, AppError> {
    let (program, mut args) = crate::engine::cli_process::claude_cli_invocation();
    args.extend(
        ["-p", "-", "--max-turns", "1", "--dangerously-skip-permissions"]
            .iter()
            .map(|s| s.to_string()),
    );
    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Guarantee the CLI child is killed if this future is dropped for any
        // reason other than the timeout branch below (app shutdown, task
        // cancellation, an outer timeout) — matches CliProcessDriver's safety
        // net (see cli_process.rs) which this ad-hoc spawn otherwise bypasses.
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE");
    // Reflection runs on the Claude monthly subscription only — never bill
    // the API account (strip any inherited/injected ANTHROPIC_* auth).
    for key in crate::engine::cli_process::CLI_SUBSCRIPTION_RESERVED_ENV {
        cmd.env_remove(key);
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn CLI: {e}"))
        }
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write prompt to CLI stdin: {e}")))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to close CLI stdin: {e}")))?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("No stdout".into()))?;
    let mut reader = BufReader::new(stdout);
    let mut full_output = String::new();
    let cli_timeout = std::time::Duration::from_secs(CLI_TIMEOUT_SECS);
    let read_result = tokio::time::timeout(cli_timeout, async {
        let mut line = String::new();
        while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            full_output.push_str(&line);
            line.clear();
        }
    })
    .await;
    if read_result.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(AppError::Internal(format!(
            "Memory reflection timed out after {} minutes",
            CLI_TIMEOUT_SECS / 60
        )));
    }
    let _ = child.wait().await;
    if full_output.trim().is_empty() {
        return Err(AppError::Internal("CLI produced no output".into()));
    }
    Ok(full_output)
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/// Validate + map raw LLM output into proposal entries. Pure — unit-tested
/// without a DB or CLI. `memories` is the fetched candidate set; core-tier
/// ids are excluded from sources/archive here as defence-in-depth (the
/// prompt already forbids them, and the apply path guards again).
fn classify_reflection_output(
    output: ReflectionOutput,
    memories: &[PersonaMemory],
    require_cross_member: bool,
) -> (Vec<ProposalEntry>, String) {
    let by_id: std::collections::HashMap<&str, &PersonaMemory> =
        memories.iter().map(|m| (m.id.as_str(), m)).collect();
    let is_actionable =
        |id: &str| by_id.get(id).map(|m| m.tier != "core").unwrap_or(false);

    let mut entries: Vec<ProposalEntry> = Vec::new();
    let mut consumed: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Per-pass consumption budget over the non-core pool: keeps a single
    // apply small enough to judge; over-budget insights are deferred to a
    // future pass (the memories stay in the pool, so nothing is lost).
    let actionable_total = memories.iter().filter(|m| m.tier != "core").count();
    let consumption_budget =
        ((actionable_total as f64) * MAX_CONSUMPTION_RATIO).ceil() as usize;
    let mut deferred_by_budget = 0usize;

    for insight in output.insights.into_iter().take(MAX_INSIGHTS_PER_PASS) {
        let sources: Vec<String> = insight
            .source_ids
            .iter()
            .filter(|id| is_actionable(id))
            .cloned()
            .collect();
        if sources.len() < 2 {
            continue; // hallucinated/core/unknown sources — not a valid synthesis
        }
        if insight.title.trim().is_empty() || insight.content.trim().is_empty() {
            continue;
        }
        if require_cross_member {
            // Team mode: a valid team insight must consolidate knowledge
            // held by >= 2 DIFFERENT members — otherwise it belongs to the
            // owning persona's own reflection, not the team's.
            let distinct_owners: std::collections::HashSet<&str> = sources
                .iter()
                .filter_map(|s| by_id.get(s.as_str()).map(|m| m.persona_id.as_str()))
                .collect();
            if distinct_owners.len() < 2 {
                continue;
            }
        }
        let newly_consumed = sources.iter().filter(|s| !consumed.contains(*s)).count();
        if consumed.len() + newly_consumed > consumption_budget {
            deferred_by_budget += 1;
            continue;
        }
        let importance = insight.importance.unwrap_or(3).clamp(1, 5);
        let category = normalize_category(insight.category.as_deref().unwrap_or("learned"));
        consumed.extend(sources.iter().cloned());
        entries.push(ProposalEntry {
            memory_id: sources[0].clone(),
            title: insight.title.trim().to_string(),
            // Score is the curation-era 1–10 display scale; map importance up.
            score: importance * 2,
            reason: insight.reason.unwrap_or_default(),
            action: "synthesize".to_string(),
            new_importance: Some(importance),
            new_title: Some(insight.title.trim().to_string()),
            new_content: Some(insight.content.trim().to_string()),
            new_category: Some(category.to_string()),
            source_ids: Some(sources),
        });
    }

    for arch in output.archive {
        if !is_actionable(&arch.id) || consumed.contains(&arch.id) {
            continue; // unknown/core, or already consumed by a synthesis
        }
        if consumed.len() + 1 > consumption_budget {
            deferred_by_budget += 1;
            continue; // archives count against the same per-pass budget
        }
        let title = by_id
            .get(arch.id.as_str())
            .map(|m| m.title.clone())
            .unwrap_or_default();
        consumed.insert(arch.id.clone());
        entries.push(ProposalEntry {
            memory_id: arch.id,
            title,
            score: 2,
            reason: arch.reason.unwrap_or_default(),
            action: "archive".to_string(),
            new_importance: None,
            new_title: None,
            new_content: None,
            new_category: None,
            source_ids: None,
        });
    }

    let mut summary = output
        .summary
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "Reflection proposed {} insight(s) and {} archive action(s).",
                entries.iter().filter(|e| e.action == "synthesize").count(),
                entries.iter().filter(|e| e.action == "archive").count()
            )
        });
    if deferred_by_budget > 0 {
        summary.push_str(&format!(
            " ({deferred_by_budget} action(s) deferred by the per-pass consumption cap — run reflection again to continue.)"
        ));
    }
    (entries, summary)
}

// ---------------------------------------------------------------------------
// Product-findings bridge (reflection → dev-tools ideas backlog)
// ---------------------------------------------------------------------------

/// Normalize a title for soft duplicate detection against existing ideas.
fn normalize_title(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Resolve the dev project linked to a team (`dev_projects.team_id`, no FK).
fn resolve_project_for_team(pool: &DbPool, team_id: &str) -> Option<String> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT id FROM dev_projects WHERE team_id = ?1 LIMIT 1",
        rusqlite::params![team_id],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// Write validated product findings to the dev-tools ideas backlog as
/// `pending` rows (that surface is triage-gated — accept/reject there is
/// the human approval). Soft-deduped against existing pending + accepted
/// idea titles; respects the backlog saturation cap. Returns rows created.
///
/// Best-effort by design: a failure here must never fail the reflection
/// pass (the memory proposal is the primary output).
fn write_product_findings(
    pool: &DbPool,
    project_id: Option<&str>,
    findings: Vec<ProductFindingSpec>,
    memories: &[PersonaMemory],
    origin: &str,
) -> usize {
    use crate::db::repos::dev_tools as dev_repo;

    if findings.is_empty() {
        return 0;
    }
    let known_ids: std::collections::HashSet<&str> =
        memories.iter().map(|m| m.id.as_str()).collect();

    // Backlog saturation: mirror the idea scanner's discipline — don't pour
    // findings into a queue nobody is draining.
    let pending = match dev_repo::list_ideas(pool, project_id, Some("pending"), None, Some(crate::engine::dispatch::IDEA_BACKLOG_CAP + 1), None) {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "reflection findings: pending-ideas lookup failed; skipping bridge");
            return 0;
        }
    };
    if pending.len() as i64 >= crate::engine::dispatch::IDEA_BACKLOG_CAP {
        tracing::info!(
            pending = pending.len(),
            "reflection findings skipped — ideas backlog saturated"
        );
        return 0;
    }
    let mut seen_titles: std::collections::HashSet<String> =
        pending.iter().map(|i| normalize_title(&i.title)).collect();
    if let Ok(accepted) = dev_repo::list_ideas(pool, project_id, Some("accepted"), None, Some(200), None) {
        seen_titles.extend(accepted.iter().map(|i| normalize_title(&i.title)));
    }

    let mut created = 0usize;
    for f in findings.into_iter().take(MAX_FINDINGS_PER_PASS) {
        let title = f.title.trim();
        if title.is_empty() || seen_titles.contains(&normalize_title(title)) {
            continue;
        }
        let sources: Vec<&str> = f
            .source_ids
            .iter()
            .map(String::as_str)
            .filter(|id| known_ids.contains(id))
            .collect();
        if sources.is_empty() {
            continue; // no verifiable provenance — don't file it
        }
        let kind = f.kind.as_deref().unwrap_or("followup");
        let description = format!(
            "{}\n\n[{kind}] Surfaced by memory reflection ({origin}); source memories: {}",
            f.description.as_deref().unwrap_or("").trim(),
            sources.join(", ")
        );
        match dev_repo::create_idea(
            pool,
            project_id,
            None,
            "memory_reflection",
            Some("technical"),
            title,
            Some(description.trim()),
            f.reason.as_deref(),
            None, // pending
            None,
            None,
            None,
            None,
            None,
        ) {
            Ok(_) => {
                seen_titles.insert(normalize_title(title));
                created += 1;
            }
            Err(e) => {
                tracing::warn!(error = %e, title, "reflection findings: create_idea failed");
            }
        }
    }
    created
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

/// Shared tail of both pipelines: prompt → CLI → parse → classify →
/// proposal + product-findings bridge.
async fn run_reflection_core(
    pool: &DbPool,
    memories: &[PersonaMemory],
    instructions: Option<&str>,
    team: Option<(&str, &std::collections::HashMap<String, String>)>,
    project_id: Option<String>,
    persona_id: Option<&str>,
) -> Result<ReflectionOutcome, AppError> {
    let core_ids: Vec<String> = memories
        .iter()
        .filter(|m| m.tier == "core")
        .map(|m| m.id.clone())
        .collect();
    let clusterable: Vec<PersonaMemory> = memories
        .iter()
        .filter(|m| m.tier != "core")
        .cloned()
        .collect();
    let clusters = match team {
        // Team mode: only clusters spanning >= 2 members are useful hints.
        Some(_) => {
            let by_id: std::collections::HashMap<&str, &PersonaMemory> =
                clusterable.iter().map(|m| (m.id.as_str(), m)).collect();
            cluster_hints(&clusterable)
                .into_iter()
                .filter(|group| {
                    let owners: std::collections::HashSet<&str> = group
                        .iter()
                        .filter_map(|id| by_id.get(id.as_str()).map(|m| m.persona_id.as_str()))
                        .collect();
                    owners.len() >= 2
                })
                .collect()
        }
        None => cluster_hints(&clusterable),
    };

    let prompt = build_reflection_prompt(
        memories,
        &core_ids,
        &clusters,
        instructions,
        team.map(|(_, roster)| roster),
    )?;
    let raw = run_claude_oneshot(&prompt).await?;
    let json_str = extract_json_object(&raw)
        .ok_or_else(|| AppError::Internal("Failed to parse reflection output as JSON".into()))?;
    let mut output: ReflectionOutput = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in reflection output: {e}")))?;

    let findings = std::mem::take(&mut output.product_findings);
    let (entries, mut summary) =
        classify_reflection_output(output, memories, team.is_some());

    let proposal_id = proposal_repo::create(
        pool,
        CreateProposalInput {
            persona_id,
            // threshold is a curation concept; 0 marks "not score-gated".
            threshold: 0,
            instructions,
            entries: &entries,
            summary: Some(&summary),
            team_id: team.map(|(tid, _)| tid),
        },
    )?;

    let origin = match team {
        Some((tid, _)) => format!("team {tid}"),
        None => format!("persona {}", persona_id.unwrap_or("?")),
    };
    let findings_created =
        write_product_findings(pool, project_id.as_deref(), findings, memories, &origin);
    if findings_created > 0 {
        summary.push_str(&format!(
            " ({findings_created} product finding(s) filed to the ideas backlog for triage.)"
        ));
    }

    Ok(ReflectionOutcome {
        proposal_id,
        reviewed: memories.len(),
        entries,
        summary,
        findings_created,
    })
}

/// Run the full reflection pipeline for one persona and write the result
/// as a `pending_review` proposal. Returns `Ok(None)` when the persona has
/// too few memories to reflect over.
pub async fn run_memory_reflection(
    pool: &DbPool,
    persona_id: &str,
    instructions: Option<&str>,
) -> Result<Option<ReflectionOutcome>, AppError> {
    // Non-archived memories; the "!archive" sentinel also filters raw
    // session-capture rows via build_memory_filters.
    let memories = repo::get_all(
        pool,
        Some(persona_id),
        None,
        None,
        Some(repo::TIER_NON_ARCHIVED),
        Some(REFLECTION_FETCH_LIMIT),
        Some(0),
        None,
        None,
    )?;
    let non_core = memories.iter().filter(|m| m.tier != "core").count();
    if non_core < MIN_MEMORIES_FOR_REFLECTION {
        return Ok(None);
    }

    // Product findings land in the project of the persona's home team.
    let project_id = crate::db::repos::core::personas::get_by_id(pool, persona_id)
        .ok()
        .and_then(|p| p.home_team_id)
        .and_then(|tid| resolve_project_for_team(pool, &tid));

    run_reflection_core(pool, &memories, instructions, None, project_id, Some(persona_id))
        .await
        .map(Some)
}

/// Team reflection: consolidate lessons held redundantly by ≥2 members of
/// `team_id` into team-shared insights. Membership = union of the explicit
/// roster (`persona_team_members`) and personas whose `home_team_id` is the
/// team. Returns `Ok(None)` when the team's combined pool is too small.
pub async fn run_team_memory_reflection(
    pool: &DbPool,
    team_id: &str,
    instructions: Option<&str>,
) -> Result<Option<ReflectionOutcome>, AppError> {
    // Roster: explicit members ∪ home-team personas (the app's canonical
    // "belongs to team T" union — see commands/companion/approvals.rs).
    let member_ids: Vec<String> = {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id FROM personas WHERE home_team_id = ?1
             UNION
             SELECT persona_id FROM persona_team_members WHERE team_id = ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![team_id], |r| r.get::<_, String>(0))?;
        rows.filter_map(Result::ok).collect()
    };
    if member_ids.len() < 2 {
        return Ok(None); // team knowledge needs at least two members
    }
    let roster: std::collections::HashMap<String, String> =
        crate::db::repos::core::personas::get_by_ids(pool, &member_ids)?
            .into_iter()
            .map(|p| (p.id, p.name))
            .collect();

    // Combined pool: members' active/working memories (core = per-persona
    // identity, archive = retired — both excluded), best-first, capped so
    // the prompt stays bounded on large teams.
    let mut memories: Vec<PersonaMemory> = repo::get_all_by_persona_ids(pool, &member_ids)?
        .into_iter()
        .filter(|m| m.tier == "active" || m.tier == "working")
        .collect();
    memories.sort_by(|a, b| {
        b.importance
            .cmp(&a.importance)
            .then(b.access_count.cmp(&a.access_count))
            .then(b.created_at.cmp(&a.created_at))
    });
    memories.truncate(REFLECTION_FETCH_LIMIT as usize);
    if memories.len() < MIN_MEMORIES_FOR_REFLECTION {
        return Ok(None);
    }

    let project_id = resolve_project_for_team(pool, team_id);
    run_reflection_core(
        pool,
        &memories,
        instructions,
        Some((team_id, &roster)),
        project_id,
        None,
    )
    .await
    .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem(id: &str, tier: &str, title: &str, content: &str) -> PersonaMemory {
        PersonaMemory {
            id: id.into(),
            persona_id: "p1".into(),
            title: title.into(),
            content: content.into(),
            category: "learned".into(),
            source_execution_id: None,
            importance: 3,
            tags: None,
            tier: tier.into(),
            access_count: 0,
            last_accessed_at: None,
            created_at: "2026-07-01T00:00:00Z".into(),
            updated_at: "2026-07-01T00:00:00Z".into(),
            use_case_id: None,
            home_team_id: None,
            derived_from: None,
            open_claim_count: 0,
        }
    }

    #[test]
    fn extract_json_object_handles_fences_and_strings() {
        let raw = "Here you go:\n```json\n{\"a\": \"br{ace} in \\\" string\", \"b\": {\"c\": 1}}\n```";
        let got = extract_json_object(raw).unwrap();
        let v: serde_json::Value = serde_json::from_str(&got).unwrap();
        assert_eq!(v["b"]["c"], 1);
    }

    #[test]
    fn cluster_hints_groups_similar_memories() {
        let ms = vec![
            mem("a", "active", "API rate limit hit on GitHub", "GitHub API rate limit 5000 requests per hour exceeded during sync"),
            mem("b", "active", "GitHub rate limiting again", "Hit the GitHub API rate limit of 5000 requests per hour on repository sync"),
            mem("c", "active", "User prefers dark theme", "The user always switches the dashboard to dark theme on login"),
        ];
        let clusters = cluster_hints(&ms);
        assert_eq!(clusters.len(), 1);
        let mut g = clusters[0].clone();
        g.sort();
        assert_eq!(g, vec!["a", "b"]);
    }

    #[test]
    fn classify_drops_core_and_single_source_insights() {
        let ms = vec![
            mem("a", "active", "t1", "c1"),
            mem("b", "active", "t2", "c2"),
            mem("core1", "core", "pinned", "pinned content"),
        ];
        let out = ReflectionOutput {
            insights: vec![
                InsightSpec {
                    title: "Valid insight".into(),
                    content: "Merged knowledge".into(),
                    category: Some("learned".into()),
                    importance: Some(4),
                    source_ids: vec!["a".into(), "b".into()],
                    reason: Some("same lesson".into()),
                },
                InsightSpec {
                    title: "Invalid — core source".into(),
                    content: "x".into(),
                    category: None,
                    importance: None,
                    source_ids: vec!["core1".into(), "a".into()],
                    reason: None,
                },
                InsightSpec {
                    title: "Invalid — unknown source".into(),
                    content: "x".into(),
                    category: None,
                    importance: None,
                    source_ids: vec!["ghost".into(), "b".into()],
                    reason: None,
                },
            ],
            archive: vec![
                ArchiveSpec { id: "core1".into(), reason: None },
                ArchiveSpec { id: "a".into(), reason: Some("consumed by synthesis".into()) },
            ],
            product_findings: vec![],
            summary: None,
        };
        let (entries, _summary) = classify_reflection_output(out, &ms, false);
        // 1 valid synthesize; core-sourced + unknown-sourced dropped;
        // archive of core dropped; archive of consumed source dropped.
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, "synthesize");
        assert_eq!(entries[0].new_importance, Some(4));
        assert_eq!(
            entries[0].source_ids.as_deref(),
            Some(&["a".to_string(), "b".to_string()][..])
        );
    }

    fn mem_owned(id: &str, persona: &str, title: &str, content: &str) -> PersonaMemory {
        let mut m = mem(id, "active", title, content);
        m.persona_id = persona.into();
        m
    }

    #[test]
    fn team_mode_requires_cross_member_sources() {
        let ms = vec![
            mem_owned("a", "p1", "lesson", "same lesson content"),
            mem_owned("b", "p1", "lesson again", "same lesson restated"),
            mem_owned("c", "p2", "lesson too", "same lesson from other member"),
            mem_owned("d", "p2", "unrelated", "different topic entirely"),
        ];
        let insight = |title: &str, srcs: &[&str]| InsightSpec {
            title: title.into(),
            content: "merged".into(),
            category: None,
            importance: None,
            source_ids: srcs.iter().map(|s| s.to_string()).collect(),
            reason: None,
        };
        let out = ReflectionOutput {
            insights: vec![
                insight("single-member — rejected in team mode", &["a", "b"]),
                insight("cross-member — accepted", &["b", "c"]),
            ],
            archive: vec![],
            product_findings: vec![],
            summary: Some("s".into()),
        };
        let (entries, _) = classify_reflection_output(out, &ms, true);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "cross-member — accepted");
    }

    #[test]
    fn normalize_title_collapses_case_and_whitespace() {
        assert_eq!(
            normalize_title("  Fix   Rate-Limit LEAK "),
            "fix rate-limit leak"
        );
    }

    #[test]
    fn classify_defers_insights_beyond_consumption_budget() {
        // 4 actionable memories → budget = ceil(4 × 0.6) = 3. Two 2-source
        // insights: the first fits (2 ≤ 3), the second would push consumption
        // to 4 > 3 and must be deferred; the standalone 1-memory archive
        // still fits exactly (2 + 1 = 3).
        let ms = vec![
            mem("a", "active", "t1", "c1"),
            mem("b", "active", "t2", "c2"),
            mem("c", "active", "t3", "c3"),
            mem("d", "active", "t4", "c4"),
        ];
        let insight = |title: &str, s1: &str, s2: &str| InsightSpec {
            title: title.into(),
            content: "merged".into(),
            category: None,
            importance: None,
            source_ids: vec![s1.into(), s2.into()],
            reason: None,
        };
        let out = ReflectionOutput {
            insights: vec![insight("first", "a", "b"), insight("second", "c", "d")],
            archive: vec![ArchiveSpec { id: "c".into(), reason: None }],
            product_findings: vec![],
            summary: Some("s".into()),
        };
        let (entries, summary) = classify_reflection_output(out, &ms, false);
        assert_eq!(
            entries.len(),
            2,
            "first insight + in-budget archive pass; second insight defers"
        );
        assert_eq!(entries[0].title, "first");
        assert_eq!(entries[1].action, "archive");
        assert!(
            summary.contains("deferred by the per-pass consumption cap"),
            "summary must surface the deferral: {summary}"
        );
    }

    #[test]
    fn clamp_chars_is_boundary_safe() {
        assert_eq!(clamp_chars("short", 10), "short");
        let clamped = clamp_chars(&"é".repeat(20), 5);
        assert!(clamped.starts_with("ééééé") && clamped.ends_with("…[truncated]"));
    }

    #[test]
    fn classify_normalizes_bad_category_and_clamps_importance() {
        let ms = vec![mem("a", "active", "t1", "c1"), mem("b", "active", "t2", "c2")];
        let out = ReflectionOutput {
            insights: vec![InsightSpec {
                title: "T".into(),
                content: "C".into(),
                category: Some("wisdom".into()),
                importance: Some(11),
                source_ids: vec!["a".into(), "b".into()],
                reason: None,
            }],
            archive: vec![],
            product_findings: vec![],
            summary: Some("s".into()),
        };
        let (entries, summary) = classify_reflection_output(out, &ms, false);
        assert_eq!(entries[0].new_category.as_deref(), Some("fact")); // default fallback
        assert_eq!(entries[0].new_importance, Some(5));
        assert_eq!(summary, "s");
    }
}
