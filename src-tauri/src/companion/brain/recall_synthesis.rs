//! Recall synthesis: when raw retrieval returns too many chunks to fit
//! coherently in the system prompt, fold them through a one-shot Claude
//! call that produces a focused "what matters this turn" briefing.
//!
//! The Sourabh Sharma blueprint flags raw-chunk injection as a production
//! failure mode: *"directly using fifteen memory chunks in the prompt does
//! not produce cohesive context."* Companion's retrieval can return up to
//! 43 chunks per turn (5 episodes + 12 vector + 8 doctrine + 6 facts + 6
//! procedurals + 8 goals + 6 backlog). This module is the synthesis layer
//! that compresses them into a short briefing.
//!
//! ## Discipline
//!
//! - **Off by default.** A synthesis call doubles the per-turn Claude cost
//!   on qualifying turns. The caller passes a `bool` (mirrors `voice_enabled`).
//! - **Budget-gated.** Even when enabled, synthesis only fires when the
//!   raw recall exceeds [`SYNTHESIS_TOKEN_THRESHOLD`]. Below the threshold,
//!   raw chunks are cheaper than a synthesis call.
//! - **Best-effort.** Any failure (timeout, JSON parse error, non-zero exit)
//!   falls through to raw chunks. Synthesis must never break a chat turn.
//! - **Ephemeral session.** Same pattern as `consolidation::call_claude_oneshot`:
//!   no `--resume`, focused user prompt, returns a typed JSON envelope. The
//!   chat session stays clean; synthesis is a separate mode of the same brain.
//!
//! ## Module layout
//!
//! - [`Briefing`] — the rendered output (summary + key_facts + salient_obligations)
//! - [`estimate_recall_tokens`] — char/4 estimator over a `Recall`
//! - [`synthesize_recall`] — async one-shot Claude call (ml feature)
//! - [`format_briefing_section`] — render a `Briefing` as a system-prompt section
//!
//! ## What this is NOT
//!
//! - Not a replacement for retrieval. Synthesis runs AFTER retrieval has
//!   produced a `Recall` — it summarizes; it doesn't fetch.
//! - Not a memory writer. The output is per-turn working memory; nothing
//!   is persisted to the brain.
//! - Not a streaming surface. The synthesis call completes before the chat
//!   turn starts; users don't see the briefing being generated.

use std::time::Duration;

use serde::{Deserialize, Serialize};

#[cfg(feature = "ml")]
use crate::companion::brain::oneshot::call_claude_text;
use crate::companion::brain::oneshot::{extract_json_span, preview};
use crate::companion::brain::retrieval::Recall;
use crate::error::AppError;

/// Token estimate above which synthesis is preferred over raw injection.
/// 5000 tokens of raw chunks dilutes context per the Sharma blueprint.
/// Below this, the cost of an extra Claude call outweighs the dilution
/// savings.
pub const SYNTHESIS_TOKEN_THRESHOLD: usize = 5000;

/// Wall-clock cap on the synthesis call. The chat turn can't proceed
/// until synthesis returns (or fails through to raw chunks). Generous
/// enough that a slow Opus call doesn't trip over the limit, tight
/// enough that a hung CLI doesn't hold the user's chat hostage.
const SYNTHESIS_TIMEOUT: Duration = Duration::from_secs(60);

/// One synthesized briefing — the output of a single synthesis pass.
/// Replaces the raw recall sections in the system prompt when present.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Briefing {
    /// 200-300 token narrative summary specific to the user's current
    /// message. Conveys what Athena should know about the user, projects,
    /// recent context, and active goals to respond well.
    pub summary: String,
    /// Up to 5 specific facts Athena should keep verbatim in mind for
    /// this turn (e.g., "user asked you to be terse last week — honor that").
    #[serde(default)]
    pub key_facts: Vec<String>,
    /// Up to 3 active goals or open promises that should bias the response.
    #[serde(default)]
    pub salient_obligations: Vec<String>,
}

/// Outer envelope the synthesis prompt asks Claude to emit. Keeping this
/// thin (one field) so future fields can be added without breaking the
/// envelope schema (any new field defaults out via `#[serde(default)]`).
#[derive(Debug, Deserialize)]
struct BriefingEnvelope {
    briefing: Briefing,
}

/// Rough char-based token estimate. We don't ship a tokenizer with the
/// app; charcount/4 is the standard ballpark for English text and is good
/// enough for budget gating (off by 20% on either side is fine — the
/// threshold is not a hard cliff).
pub fn estimate_recall_tokens(r: &Recall) -> usize {
    let mut chars: usize = 0;
    // Episodes: role + timestamp + content. Add 16 chars overhead per item
    // for the role + created_at metadata that gets rendered.
    for ep in &r.episodes {
        chars = chars.saturating_add(ep.content.len() + 16);
    }
    // Doctrine hits: file_path + content.
    for d in &r.doctrine {
        chars = chars.saturating_add(d.content.len() + d.file_path.len() + 8);
    }
    // Facts: key + value + scope/importance/confidence overhead.
    for f in &r.facts {
        chars = chars.saturating_add(f.value.len() + f.key.len() + 16);
    }
    // Procedurals: trigger + behavior + scope overhead.
    for p in &r.procedurals {
        chars = chars.saturating_add(p.trigger.len() + p.behavior.len() + 16);
    }
    // Goals: description + title + status overhead.
    for g in &r.goals {
        chars = chars.saturating_add(g.description.len() + g.title.len() + 16);
    }
    // Backlog: summary + kind/source overhead.
    for b in &r.backlog {
        chars = chars.saturating_add(b.summary.len() + 16);
    }
    chars / 4
}

/// Synthesize a `Recall` into a focused briefing via an ephemeral
/// Claude one-shot call. Mirrors the
/// [`consolidation::call_claude_oneshot`](crate::companion::brain::consolidation)
/// shape: no `--resume`, focused user prompt, JSON envelope return,
/// timeout-bounded.
///
/// On any error (spawn, write, read, timeout, non-zero exit, JSON parse),
/// returns `Err(AppError)`. Callers MUST tolerate failure and fall through
/// to raw recall — synthesis is an optimization, not a correctness
/// requirement.
#[cfg(feature = "ml")]
pub async fn synthesize_recall(recall: &Recall, query: &str) -> Result<Briefing, AppError> {
    let prompt = build_synthesis_prompt(recall, query);
    call_claude_oneshot(&prompt).await
}

/// Render a briefing as a system-prompt section. Replaces the raw
/// facts/goals/procedurals/episodes/backlog blocks. Uses a different
/// header ("# What matters this turn") so the chat model can tell at a
/// glance that this is synthesized context, not raw recall.
pub fn format_briefing_section(b: &Briefing) -> String {
    let mut s = String::with_capacity(
        b.summary.len()
            + b.key_facts.iter().map(|x| x.len() + 4).sum::<usize>()
            + b.salient_obligations
                .iter()
                .map(|x| x.len() + 4)
                .sum::<usize>()
            + 256,
    );
    s.push_str("\n\n# What matters this turn (synthesized)\n\n");
    s.push_str(b.summary.trim());
    if !b.key_facts.is_empty() {
        s.push_str("\n\n## Key facts\n\n");
        for f in &b.key_facts {
            s.push_str("- ");
            s.push_str(f.trim());
            s.push('\n');
        }
    }
    if !b.salient_obligations.is_empty() {
        s.push_str("\n## Salient obligations\n\n");
        for o in &b.salient_obligations {
            s.push_str("- ");
            s.push_str(o.trim());
            s.push('\n');
        }
    }
    s
}

// ── Internals ──────────────────────────────────────────────────────────

fn build_synthesis_prompt(recall: &Recall, query: &str) -> String {
    let mut p = String::with_capacity(8 * 1024);
    p.push_str(
        "You are a context summarizer for Athena, a personal AI companion. \
         The user just sent a message; below is everything Athena's memory \
         system retrieved as potentially relevant. Most of it isn't directly \
         useful for this turn — your job is to compress it into a focused \
         briefing Athena can use without drowning in detail.\n\n",
    );
    p.push_str("# User's current message\n\n");
    p.push_str(query.trim());
    p.push_str("\n\n");

    if !recall.episodes.is_empty() {
        p.push_str("# Recent conversation episodes (oldest first)\n\n");
        for ep in &recall.episodes {
            p.push_str(&format!(
                "## {} — {}\n\n{}\n\n",
                ep.role, ep.created_at, ep.content
            ));
        }
    }
    if !recall.facts.is_empty() {
        p.push_str("# Known facts about the user/projects/world\n\n");
        for f in &recall.facts {
            p.push_str(&format!(
                "- [{scope}/{key}, imp {imp}] {value}\n",
                scope = f.scope,
                key = f.key,
                imp = f.importance,
                value = f.value.trim().replace('\n', " "),
            ));
        }
        p.push('\n');
    }
    if !recall.goals.is_empty() {
        p.push_str("# Active goals\n\n");
        for g in &recall.goals {
            p.push_str(&format!("- {}: {}\n", g.title.trim(), g.description.trim()));
        }
        p.push('\n');
    }
    if !recall.procedurals.is_empty() {
        p.push_str("# Behavioral rules Athena follows\n\n");
        for r in &recall.procedurals {
            p.push_str(&format!(
                "- when {} → {}\n",
                r.trigger.trim(),
                r.behavior.trim(),
            ));
        }
        p.push('\n');
    }
    if !recall.backlog.is_empty() {
        p.push_str("# Open commitments / capability gaps\n\n");
        for b in &recall.backlog {
            p.push_str(&format!("- [{}] {}\n", b.kind, b.summary.trim()));
        }
        p.push('\n');
    }
    if !recall.doctrine.is_empty() {
        p.push_str("# Reference docs (curated)\n\n");
        for d in &recall.doctrine {
            p.push_str(&format!(
                "## {}\n\n{}\n\n",
                d.file_path,
                d.content.trim()
            ));
        }
    }

    p.push_str(
        "\n# Output\n\nReturn ONLY a JSON object of this shape, nothing else, no prose, no fencing:\n\n\
         {\n  \"briefing\": {\n    \"summary\": \"<200-300 token narrative specific to the user's current message>\",\n    \"key_facts\": [\"<verbatim fact>\", ...],\n    \"salient_obligations\": [\"<active goal or open promise>\", ...]\n  }\n}\n\n\
         Rules:\n\
         - summary: 200-300 tokens, narrative, specific to the user's current message\n\
         - key_facts: up to 5 verbatim facts that should bias this turn's response\n\
         - salient_obligations: up to 3 active goals/promises that matter now\n\
         - Drop anything that doesn't help with the user's current message\n\
         - If no recall is relevant, return empty arrays and a one-line summary\n\
         - Start with `{` and end with `}`. No code fences.\n",
    );
    p
}

/// Spawn/stream/timeout plumbing lives in
/// [`oneshot::call_claude_text`](crate::companion::brain::oneshot::call_claude_text);
/// this wrapper owns only the synthesis-specific model choice and typed
/// envelope parsing.
///
/// Default to opus for synthesis quality; the call is rare (only fires
/// above the budget threshold) and a poor synthesis worse than raw
/// chunks. If costs are a concern, swap to sonnet here.
#[cfg(feature = "ml")]
async fn call_claude_oneshot(prompt: &str) -> Result<Briefing, AppError> {
    let text = call_claude_text(
        prompt,
        "claude-opus-4-8",
        "recall synthesis",
        SYNTHESIS_TIMEOUT,
    )
    .await?;
    parse_envelope(&text)
}

fn parse_envelope(text: &str) -> Result<Briefing, AppError> {
    let json = extract_json_span(text, "recall synthesis reply")?;
    let envelope: BriefingEnvelope = serde_json::from_str(json).map_err(|e| {
        AppError::Internal(format!(
            "recall synthesis JSON parse failed: {e}; got: {}",
            preview(json, 200)
        ))
    })?;
    Ok(envelope.briefing)
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::brain::backlog::BacklogItem;
    use crate::companion::brain::episodic::Episode;
    use crate::companion::brain::goals::Goal;
    use crate::companion::brain::procedural::Procedural;
    use crate::companion::brain::retrieval::DoctrineHit;
    use crate::companion::brain::semantic::Fact;

    fn make_episode(content: &str) -> Episode {
        Episode {
            id: "ep_test".into(),
            session_id: "default".into(),
            role: "user".into(),
            content: content.into(),
            created_at: "2026-05-09T00:00:00Z".into(),
            file_path: "episodes/test.md".into(),
        }
    }

    fn make_fact(value: &str) -> Fact {
        Fact {
            id: "fact_test".into(),
            scope: "user".into(),
            key: "test".into(),
            value: value.into(),
            importance: 3,
            confidence: 0.9,
            sources: vec!["ep_test".into()],
            supersedes_id: None,
            contradicts_id: None,
            created_at: "2026-05-09T00:00:00Z".into(),
            updated_at: "2026-05-09T00:00:00Z".into(),
            last_seen_at: "2026-05-09T00:00:00Z".into(),
            file_path: "semantic/user/fact_test.md".into(),
        }
    }

    fn make_doctrine(file_path: &str, content: &str) -> DoctrineHit {
        DoctrineHit {
            file_path: file_path.into(),
            content: content.into(),
        }
    }

    fn make_recall(
        episodes: Vec<Episode>,
        doctrine: Vec<DoctrineHit>,
        facts: Vec<Fact>,
    ) -> Recall {
        Recall {
            episodes,
            doctrine,
            facts,
            procedurals: Vec::new(),
            goals: Vec::new(),
            backlog: Vec::new(),
        }
    }

    #[test]
    fn token_estimator_increases_with_content() {
        let small = make_recall(vec![make_episode("hi")], Vec::new(), Vec::new());
        let large = make_recall(
            vec![make_episode(&"x".repeat(4000))],
            Vec::new(),
            Vec::new(),
        );
        assert!(estimate_recall_tokens(&large) > estimate_recall_tokens(&small));
    }

    #[test]
    fn token_estimator_empty_recall_is_zero() {
        let r = make_recall(Vec::new(), Vec::new(), Vec::new());
        assert_eq!(estimate_recall_tokens(&r), 0);
    }

    #[test]
    fn token_estimator_below_threshold_for_small_recall() {
        // 5 short episodes + 6 short facts is roughly the cold-start
        // shape — must stay well under the synthesis threshold so we
        // don't fire synthesis for every minor turn.
        let episodes = (0..5)
            .map(|_| make_episode("a short user message"))
            .collect();
        let facts = (0..6).map(|_| make_fact("a short fact")).collect();
        let r = make_recall(episodes, Vec::new(), facts);
        assert!(estimate_recall_tokens(&r) < SYNTHESIS_TOKEN_THRESHOLD);
    }

    #[test]
    fn token_estimator_above_threshold_for_dense_recall() {
        // A pessimistic recall — long episodes + long doctrine hits — must
        // exceed the threshold so synthesis kicks in. With chars/4 as the
        // estimator and a 5000-token cap, we need ~20K chars of content.
        // 10 episodes × 2000 chars + 8 doctrine × 1500 chars ≈ 32K chars
        // ≈ 8K tokens — comfortably above the threshold and representative
        // of a real long-running brain's recall on a busy turn.
        let episode_text = "x".repeat(2000);
        let doctrine_text = "y".repeat(1500);
        let episodes = (0..10).map(|_| make_episode(&episode_text)).collect();
        let doctrine = (0..8)
            .map(|_| make_doctrine("docs/x.md", &doctrine_text))
            .collect();
        let r = make_recall(episodes, doctrine, Vec::new());
        let tokens = estimate_recall_tokens(&r);
        assert!(
            tokens > SYNTHESIS_TOKEN_THRESHOLD,
            "expected dense recall (~8K tokens) > {SYNTHESIS_TOKEN_THRESHOLD} threshold; got {tokens}",
        );
    }

    #[test]
    fn format_briefing_with_facts_and_obligations() {
        let b = Briefing {
            summary: "User just asked about deploys; recent context is the Friday lab failure.".into(),
            key_facts: vec![
                "User prefers terse responses on Fridays.".into(),
                "Two lab agents have been failing since 2026-05-08.".into(),
            ],
            salient_obligations: vec!["Follow up on the lab failure investigation.".into()],
        };
        let out = format_briefing_section(&b);
        assert!(out.contains("# What matters this turn (synthesized)"));
        assert!(out.contains("User prefers terse responses on Fridays."));
        assert!(out.contains("Salient obligations"));
        assert!(out.contains("lab failure investigation"));
    }

    #[test]
    fn format_briefing_minimal_no_arrays() {
        let b = Briefing {
            summary: "Nothing relevant in recall.".into(),
            key_facts: Vec::new(),
            salient_obligations: Vec::new(),
        };
        let out = format_briefing_section(&b);
        assert!(out.contains("Nothing relevant in recall."));
        assert!(!out.contains("Key facts"));
        assert!(!out.contains("Salient obligations"));
    }

    #[test]
    fn parse_envelope_accepts_clean_json() {
        let s = r#"{"briefing":{"summary":"hello","key_facts":["a","b"],"salient_obligations":["c"]}}"#;
        let b = parse_envelope(s).unwrap();
        assert_eq!(b.summary, "hello");
        assert_eq!(b.key_facts.len(), 2);
        assert_eq!(b.salient_obligations.len(), 1);
    }

    #[test]
    fn parse_envelope_strips_code_fence() {
        let s = "```json\n{\"briefing\":{\"summary\":\"hi\"}}\n```";
        let b = parse_envelope(s).unwrap();
        assert_eq!(b.summary, "hi");
        assert!(b.key_facts.is_empty());
    }

    #[test]
    fn parse_envelope_tolerates_preface_and_suffix() {
        let s = "Here is the briefing:\n{\"briefing\":{\"summary\":\"yes\"}}\nthanks";
        let b = parse_envelope(s).unwrap();
        assert_eq!(b.summary, "yes");
    }

    #[test]
    fn parse_envelope_rejects_no_json() {
        let s = "I refuse to comply";
        assert!(parse_envelope(s).is_err());
    }

    // Suppress unused-warning for the structural Procedural / BacklogItem
    // imports — they're used to confirm the field-name contract this
    // module relies on (`trigger`/`behavior`/`summary`/`kind`).
    #[allow(dead_code)]
    fn _field_contract_check(_: &Procedural, _: &BacklogItem, _: &Goal) {}
}
