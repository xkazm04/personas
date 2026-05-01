//! System-prompt composition for the companion's CLI session.
//!
//! Three layers, fed to Claude every turn:
//!   1. Constitution — static character + voice + provenance contract.
//!   2. Identity — evolving self-model from `identity.md`.
//!   3. Working context — observability digest + retrieved memory.
//!
//! Phase 2: the working context now includes
//!   - The observability digest (current state of the Personas app)
//!   - Hybrid retrieval (recent + semantic, see brain::retrieval)
//!
//! Phase 3 will add provenance footers, BM25 fusion, and graph traversal.

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use crate::companion::brain::episodic;
use crate::companion::brain::retrieval;
use crate::companion::disk;
use crate::companion::observability;
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Build the full system prompt.
///
/// `query` is the user's current message — used to seed retrieval. Pass
/// an empty string for non-retrieval prompts (e.g., reflection cycles).
#[cfg(feature = "ml")]
pub async fn build_system_prompt(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    embedder: Option<&Arc<EmbeddingManager>>,
    session_id: &str,
    query: &str,
) -> Result<String, AppError> {
    let root = disk::brain_root()?;
    let constitution =
        fs::read_to_string(root.join("constitution.md")).unwrap_or_else(|_| String::new());
    let identity =
        fs::read_to_string(root.join("identity.md")).unwrap_or_else(|_| String::new());

    // Observability — best-effort.
    let observability_md = observability::build(sys_db)
        .ok()
        .as_ref()
        .map(observability::format_for_prompt)
        .unwrap_or_default();

    // Retrieved memory.
    let recalled = match embedder {
        Some(emb) => retrieval::retrieve(user_db, emb, session_id, query)
            .await
            .unwrap_or_default(),
        None => episodic::list_recent(user_db, session_id, 20).unwrap_or_default(),
    };

    let transcript = format_transcript(&recalled);

    Ok(compose(&constitution, &identity, &observability_md, &transcript))
}

#[cfg(not(feature = "ml"))]
pub async fn build_system_prompt(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    session_id: &str,
    _query: &str,
) -> Result<String, AppError> {
    let root = disk::brain_root()?;
    let constitution =
        fs::read_to_string(root.join("constitution.md")).unwrap_or_else(|_| String::new());
    let identity =
        fs::read_to_string(root.join("identity.md")).unwrap_or_else(|_| String::new());

    let observability_md = observability::build(sys_db)
        .ok()
        .as_ref()
        .map(observability::format_for_prompt)
        .unwrap_or_default();

    let recent = episodic::list_recent(user_db, session_id, 20).unwrap_or_default();
    let transcript = format_transcript(&recent);

    Ok(compose(&constitution, &identity, &observability_md, &transcript))
}

fn format_transcript(recalled: &[episodic::Episode]) -> String {
    if recalled.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Recalled conversation (oldest first)\n\n");
    for ep in recalled {
        s.push_str(&format!(
            "## {} — {}\n\n{}\n\n",
            ep.role, ep.created_at, ep.content
        ));
    }
    s
}

fn compose(constitution: &str, identity: &str, observability_md: &str, transcript: &str) -> String {
    let mut out = String::with_capacity(
        constitution.len() + identity.len() + observability_md.len() + transcript.len() + 128,
    );
    out.push_str(constitution);
    if !identity.is_empty() {
        out.push_str("\n\n# Identity (live, evolves)\n\n");
        out.push_str(identity);
    }
    out.push_str(observability_md);
    out.push_str(transcript);
    out
}
