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

/// Outcome of a reflection pass, pre-proposal.
pub struct ReflectionOutcome {
    pub proposal_id: String,
    pub reviewed: usize,
    pub entries: Vec<ProposalEntry>,
    pub summary: String,
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

#[derive(Debug, serde::Deserialize)]
struct ReflectionOutput {
    #[serde(default)]
    insights: Vec<InsightSpec>,
    #[serde(default)]
    archive: Vec<ArchiveSpec>,
    #[serde(default)]
    summary: Option<String>,
}

/// Extract the outermost brace-balanced JSON object from LLM output that
/// may carry prose or markdown fences around it. String- and escape-aware.
pub(crate) fn extract_json_object(s: &str) -> Option<String> {
    let start = s.find('{')?;
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(s[start..=i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

fn build_reflection_prompt(
    memories: &[PersonaMemory],
    core_ids: &[String],
    clusters: &[Vec<String>],
    instructions: Option<&str>,
) -> Result<String, AppError> {
    let entries: Vec<serde_json::Value> = memories
        .iter()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "title": m.title,
                "content": m.content,
                "category": m.category,
                "importance": m.importance,
                "tier": m.tier,
                "access_count": m.access_count,
                "created_at": m.created_at,
            })
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

    Ok(format!(
        r#"You are running a memory REFLECTION pass for an AI agent persona in Personas, an agent management platform. Reflection consolidates many raw memories into fewer, more durable insights so the agent's limited memory budget carries maximum knowledge.

Candidate related groups (deterministic similarity hints — advisory, you decide the real grouping):
{clusters_json}

PINNED (core-tier) memory ids — read-only context. NEVER list them in source_ids or archive:
{core_json}

Respond with ONLY a JSON object (no markdown fences, no prose):
{{"insights":[{{"title":"...","content":"...","category":"learned","importance":3,"source_ids":["id1","id2"],"reason":"..."}}],
 "archive":[{{"id":"...","reason":"..."}}],
 "summary":"one short paragraph describing what this reflection found"}}

Rules:
- An insight MUST cite >= 2 source_ids and must only state what those sources support — never invent facts. On apply, the sources are archived and replaced by the insight, so the insight content must fully preserve what still matters.
- Synthesize when several memories describe the same lesson, pattern, preference, or fact at different levels of detail: write the single best current version.
- When two memories CONTRADICT, write the correct/current fact as an insight citing both, and say in reason which one won and why (newer, more specific, or confirmed by access patterns).
- category ∈ fact | preference | instruction | context | learned | constraint. importance ∈ 1..5 (5 = critical).
- Propose "archive" only for memories that are stale or redundant on their own; prefer synthesize when the content is worth keeping in consolidated form.
- At most {MAX_INSIGHTS_PER_PASS} insights. If nothing is worth consolidating, return empty arrays — an empty reflection is a valid result.
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
        .stderr(std::process::Stdio::piped());
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
    let cli_timeout = std::time::Duration::from_secs(240);
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
        return Err(AppError::Internal(
            "Memory reflection timed out after 4 minutes".into(),
        ));
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
) -> (Vec<ProposalEntry>, String) {
    let by_id: std::collections::HashMap<&str, &PersonaMemory> =
        memories.iter().map(|m| (m.id.as_str(), m)).collect();
    let is_actionable =
        |id: &str| by_id.get(id).map(|m| m.tier != "core").unwrap_or(false);

    let mut entries: Vec<ProposalEntry> = Vec::new();
    let mut consumed: std::collections::HashSet<String> = std::collections::HashSet::new();

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

    let summary = output
        .summary
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "Reflection proposed {} insight(s) and {} archive action(s).",
                entries.iter().filter(|e| e.action == "synthesize").count(),
                entries.iter().filter(|e| e.action == "archive").count()
            )
        });
    (entries, summary)
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
    let clusters = cluster_hints(&clusterable);

    let prompt = build_reflection_prompt(&memories, &core_ids, &clusters, instructions)?;
    let raw = run_claude_oneshot(&prompt).await?;
    let json_str = extract_json_object(&raw)
        .ok_or_else(|| AppError::Internal("Failed to parse reflection output as JSON".into()))?;
    let output: ReflectionOutput = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in reflection output: {e}")))?;

    let (entries, summary) = classify_reflection_output(output, &memories);

    let proposal_id = proposal_repo::create(
        pool,
        CreateProposalInput {
            persona_id: Some(persona_id),
            // threshold is a curation concept; 0 marks "not score-gated".
            threshold: 0,
            instructions,
            entries: &entries,
            summary: Some(&summary),
        },
    )?;

    Ok(Some(ReflectionOutcome {
        proposal_id,
        reviewed: memories.len(),
        entries,
        summary,
    }))
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
            summary: None,
        };
        let (entries, _summary) = classify_reflection_output(out, &ms);
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
            summary: Some("s".into()),
        };
        let (entries, summary) = classify_reflection_output(out, &ms);
        assert_eq!(entries[0].new_category.as_deref(), Some("fact")); // default fallback
        assert_eq!(entries[0].new_importance, Some(5));
        assert_eq!(summary, "s");
    }
}
