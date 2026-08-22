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
