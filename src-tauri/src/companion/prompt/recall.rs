//! Where the recalled conversation comes from, in both feature builds: the
//! embedding-backed lane when `ml` is on, the keyword (BM25) lane otherwise —
//! and the optional synthesis pass over the result.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use super::build::EmbedderArg;
use crate::companion::brain::recall_synthesis::Briefing;
#[cfg(feature = "ml")]
use crate::companion::brain::recall_synthesis::{self, SYNTHESIS_TOKEN_THRESHOLD};
use crate::companion::brain::retrieval;
use crate::companion::brain::retrieval::Recall;
use crate::db::UserDbPool;

/// ml build: embedding-backed hybrid retrieval when an embedder is
/// configured, falling back to the embedder-free keyword lane otherwise.
#[cfg(feature = "ml")]
pub(super) async fn recall_for(
    user_db: &UserDbPool,
    embedder: EmbedderArg<'_>,
    session_id: &str,
    query: &str,
) -> Recall {
    match embedder {
        Some(emb) => retrieval::retrieve(user_db, emb, session_id, query)
            .await
            .unwrap_or_default(),
        None => retrieval::retrieve_keyword(user_db, session_id, query),
    }
}

/// non-ml build (the one that ships): no embedder type exists at all, so
/// retrieval is the keyword (BM25) lane over `companion_fts` plus the
/// always-include tiers.
///
/// This used to be a local `manual_recall` that duplicated
/// `retrieval::retrieve`'s non-ml arm with the caps hard-coded as literals —
/// a silent fork which meant `retrieval`'s own non-ml arm was unreachable
/// code, and any fix applied there (including adding doctrine to recall)
/// would never have run. Both arms now go through `retrieval`.
#[cfg(not(feature = "ml"))]
pub(super) async fn recall_for(
    user_db: &UserDbPool,
    _embedder: EmbedderArg<'_>,
    session_id: &str,
    query: &str,
) -> Recall {
    retrieval::retrieve(user_db, session_id, query)
        .await
        .unwrap_or_default()
}

/// The six memory sections of the system prompt, rendered from a [`Recall`],
/// in [`compose`](super::compose)'s order, under `budget_chars`.
///
/// **The point is that it is the same renderer.** A harness that wants to score
/// what Athena's memory would have put in front of the model must see the block
/// `compose` builds — the same `format_*` functions, the same section headers,
/// the same citation shapes — not a plausible reconstruction of it. The one
/// thing that differs is where the budget comes from: `compose` spends
/// `EPISODE_RENDER_BUDGET` on episodes as a share of the `recall` block's
/// 40,000, while a caller here states a total and the episodes take whatever
/// the other five sections leave.
///
/// The trailing truncation is a backstop, not the mechanism: the episode cut
/// already happened inside `format_episodes_within`, and
/// `fit_trailing_to_render` deliberately admits one entry even when it cannot
/// fit (dropping the whole current context to respect a budget is a worse
/// failure than overshooting it). This keeps the caller's stated ceiling
/// honest anyway.
#[cfg(feature = "memory-sim")]
pub fn render_memory_block(recall: &Recall, budget_chars: usize) -> String {
    use super::memory::{
        format_backlog, format_doctrine, format_episodes_within, format_facts, format_goals,
        format_procedurals,
    };

    let mut tail = String::new();
    tail.push_str(&format_doctrine(&recall.doctrine));
    tail.push_str(&format_facts(&recall.facts));
    tail.push_str(&format_goals(&recall.goals));
    tail.push_str(&format_procedurals(&recall.procedurals));
    tail.push_str(&format_backlog(&recall.backlog));

    let episode_budget = budget_chars.saturating_sub(tail.chars().count());
    let mut out = format_episodes_within(&recall.episodes, episode_budget);
    out.push_str(&tail);

    if out.chars().count() > budget_chars {
        out = out.chars().take(budget_chars).collect();
    }
    out
}

/// Recall synthesis: when the user has opted in AND raw recall exceeds
/// the budget, ask Claude to synthesize a focused briefing that replaces
/// the raw chunks. Best-effort throughout: any failure (timeout, JSON
/// parse, non-zero exit) falls through to raw chunks so synthesis never
/// breaks a chat turn. ml-feature gated — non-ml builds never synthesize.
#[cfg(feature = "ml")]
pub(super) async fn synthesize_if_enabled(
    user_db: &UserDbPool,
    recall: &Recall,
    query: &str,
    enabled: bool,
) -> Option<Briefing> {
    if enabled && recall_synthesis::estimate_recall_tokens(recall) > SYNTHESIS_TOKEN_THRESHOLD {
        match recall_synthesis::synthesize_recall(user_db, recall, query).await {
            Ok(b) => {
                tracing::info!(
                    summary_chars = b.summary.len(),
                    key_facts = b.key_facts.len(),
                    obligations = b.salient_obligations.len(),
                    "companion: recall synthesis succeeded"
                );
                Some(b)
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "companion: recall synthesis failed; falling through to raw chunks"
                );
                None
            }
        }
    } else {
        None
    }
}

#[cfg(not(feature = "ml"))]
pub(super) async fn synthesize_if_enabled(
    _user_db: &UserDbPool,
    _recall: &Recall,
    _query: &str,
    _enabled: bool,
) -> Option<Briefing> {
    None
}
