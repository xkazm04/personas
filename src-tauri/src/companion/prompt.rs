//! System-prompt composition for the companion's CLI session.
//!
//! Three layers, fed to Claude every turn:
//!   1. Constitution — static character + voice + provenance contract.
//!      Read from `~/.personas/companion-brain/constitution.md` (which is a
//!      first-run copy of the embedded template).
//!   2. Identity — evolving self-model from
//!      `~/.personas/companion-brain/identity.md`. Edited by reflection
//!      cycles and by the user directly.
//!   3. Working context — last N=20 episodes oldest-first. This re-orients
//!      Athena across CLI session restarts (the CLI's own --resume holds
//!      the same context implicitly, but we still inject so the prompt is
//!      self-sufficient if the resumed session has been auto-compacted).
//!
//! Phase 2 will extend (3) with hybrid retrieval (graph + vector + BM25)
//! plus the observability digest.

use std::fs;

use crate::companion::brain::episodic;
use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

const RECENT_TURNS_LIMIT: u32 = 20;

/// Build the full system prompt for the companion's next CLI turn.
pub fn build_system_prompt(pool: &UserDbPool, session_id: &str) -> Result<String, AppError> {
    let root = disk::brain_root()?;

    let constitution =
        fs::read_to_string(root.join("constitution.md")).unwrap_or_else(|_| String::new());
    let identity = fs::read_to_string(root.join("identity.md")).unwrap_or_else(|_| String::new());

    let recent = episodic::list_recent(pool, session_id, RECENT_TURNS_LIMIT).unwrap_or_default();
    let mut transcript = String::new();
    if !recent.is_empty() {
        transcript.push_str("\n\n# Recent conversation (oldest first)\n\n");
        for ep in &recent {
            transcript.push_str(&format!("## {} — {}\n\n{}\n\n", ep.role, ep.created_at, ep.content));
        }
    }

    let mut out = String::with_capacity(constitution.len() + identity.len() + transcript.len() + 64);
    out.push_str(&constitution);
    if !identity.is_empty() {
        out.push_str("\n\n# Identity (live, evolves)\n\n");
        out.push_str(&identity);
    }
    out.push_str(&transcript);
    Ok(out)
}
