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

use serde::{Deserialize, Serialize};

#[cfg(feature = "ml")]
use crate::companion::brain::oneshot::{self, call_claude_text};
#[cfg(feature = "ml")]
use crate::db::UserDbPool;

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
pub async fn synthesize_recall(
    pool: &UserDbPool,
    recall: &Recall,
    query: &str,
) -> Result<Briefing, AppError> {
    let prompt = build_synthesis_prompt(recall, query);
    call_claude_oneshot(pool, &prompt).await
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

/// Spawn/stream/timeout plumbing lives in
/// [`oneshot::call_claude_text`](crate::companion::brain::oneshot::call_claude_text);
/// this wrapper owns only the synthesis-specific model choice and typed
/// envelope parsing.
///
/// Default to opus for synthesis quality; the call is rare (only fires
/// above the budget threshold) and a poor synthesis worse than raw
/// chunks. If costs are a concern, swap to sonnet here.
#[cfg(feature = "ml")]
async fn call_claude_oneshot(pool: &UserDbPool, prompt: &str) -> Result<Briefing, AppError> {
    let text = call_claude_text(
        pool,
        prompt,
        "claude-opus-4-8",
        oneshot::leg::RECALL_SYNTHESIS,
        SYNTHESIS_TIMEOUT,
    )
    .await?;
    parse_envelope(&text)
}

// ── Tests ───────────────────────────────────────────────────────────────
