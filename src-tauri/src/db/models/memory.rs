use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Json;

// ============================================================================
// Memories
// ============================================================================

// -- Re-exports from the shared validation module ----------------------------
// Business rules live in crate::validation::memory. These re-exports keep the
// existing call sites working without changes.
pub use crate::validation::memory::MEMORY_CATEGORIES;

use crate::validation::contract::check as validate_check;
use crate::validation::memory as mv;

/// The default category assigned when none is provided.
pub const DEFAULT_MEMORY_CATEGORY: &str = "fact";

/// Validate that an importance score is within the allowed range (1–5).
pub fn validate_importance(value: i32) -> Result<i32, crate::error::AppError> {
    validate_check(mv::validate_importance(value))?;
    Ok(value)
}

/// Validate that `value` is one of the recognised memory categories.
pub fn validate_category(value: &str) -> Result<&str, crate::error::AppError> {
    validate_check(mv::validate_category(value))?;
    Ok(value)
}

/// Return `value` if it is a recognised category, otherwise [`DEFAULT_MEMORY_CATEGORY`].
pub fn normalize_category(value: &str) -> &'static str {
    match MEMORY_CATEGORIES.iter().find(|&&c| c == value) {
        Some(c) => c,
        None => DEFAULT_MEMORY_CATEGORY,
    }
}

/// Description metadata for a single memory category, exposed to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct MemoryCategoryInfo {
    /// Machine-readable key (e.g. "fact").
    pub key: String,
    /// Human-readable label (e.g. "Fact").
    pub label: String,
    /// Short explanation of when to use this category.
    pub description: String,
}

/// Build the full list of category metadata for the frontend.
pub fn all_category_info() -> Vec<MemoryCategoryInfo> {
    vec![
        MemoryCategoryInfo {
            key: "fact".into(),
            label: "Fact".into(),
            description: "Objective knowledge about the world or the agent's domain".into(),
        },
        MemoryCategoryInfo {
            key: "preference".into(),
            label: "Preference".into(),
            description: "User or stakeholder preferences that guide agent behaviour".into(),
        },
        MemoryCategoryInfo {
            key: "instruction".into(),
            label: "Instruction".into(),
            description: "Explicit rules or directives the agent must follow".into(),
        },
        MemoryCategoryInfo {
            key: "context".into(),
            label: "Context".into(),
            description: "Background information that helps the agent reason".into(),
        },
        MemoryCategoryInfo {
            key: "learned".into(),
            label: "Learned".into(),
            description: "Insights the agent derived from past executions".into(),
        },
        MemoryCategoryInfo {
            key: "constraint".into(),
            label: "Constraint".into(),
            description: "Hard limits such as rate-limits, compliance rules, or deadlines".into(),
        },
    ]
}

// =============================================================================
// MEMORY CONTRACT — load-bearing invariants for the long-term memory store
// =============================================================================
//
// Three independent invariants used to live only in developer heads. They are
// codified here so a future contributor can reason about tier + scope + access
// without grepping the brain/companion code paths.
//
// (1) **Tier promotion authority.** Tier is a string column with three legal
//     values: `"core"` (always injected, persona-wide identity), `"active"`
//     (the scored hot set), and `"working"` / `"archive"` (deprecated /
//     retired). Promotion to `"core"` is a USER-INITIATED action only —
//     `repos::core::memories::set_tier(persona_id, memory_id, "core")` is the
//     single legal entry point and is reachable only from
//     `commands/overview/memories.rs::set_memory_tier`, which is bound to an
//     explicit "Pin to Core" UI affordance. The auto-lifecycle path
//     (`run_lifecycle`) ONLY promotes working → active (access_count >= 5)
//     and archives `working` rows older than 30 days; it never touches core.
//     Programmatic promotion to core from any other code path is a contract
//     violation.
//
// (2) **`use_case_id` behaviour on use_case deletion.** The column was
//     intentionally added WITHOUT a foreign-key reference (see
//     `migrations/incremental.rs` Phase C5). Rationale: deleting a use case
//     should NOT erase the memories it produced; the user may still want to
//     read them, and the cost of carrying orphan attributions is one-cell
//     dangling text per row. The injection paths
//     (`get_for_injection_v2`, scope predicate at `WHERE (use_case_id = ?
//     OR use_case_id IS NULL)`) treat an orphan `use_case_id` as
//     "capability-scoped to a use_case nobody is asking about" — the row
//     simply never matches any future capability filter and only surfaces
//     when the caller passes `None` filtered by `use_case_id IS NULL`
//     (which it doesn't). Net effect: orphans are functionally archived
//     until the user explicitly re-attributes them via the editor.
//     Importantly, **core-tier memories ignore use_case_id entirely** —
//     the SELECT for the core tier does not include the use_case scope
//     predicate, so promoting a memory to core makes its capability
//     attribution irrelevant for injection purposes.
//
// (3) **`access_count` / `last_accessed_at` ownership.** These columns are
//     incremented EXCLUSIVELY by `repos::core::memories::increment_access_batch`,
//     which is the only writer in the codebase. The single legitimate caller
//     is the prompt-injection hot path (`engine::prompt::*`) right before
//     it serializes a memory into the system prompt. Every other read path
//     (memory editor, overview list, capability picker) MUST NOT increment
//     these — a casual `SELECT *` should never touch counters. Test fixtures
//     that need to simulate access call `increment_access_batch` directly
//     so the audit trail remains consistent.
//
// (4) **`importance` bounds.** Enforced at three layers, in increasing order
//     of cheapness:
//       - Frontend forms clamp to 1..=5.
//       - `validate_importance` rejects out-of-range values at the repo
//         boundary (`AppError::Validation`).
//       - The DB carries a `CHECK (importance BETWEEN 1 AND 5)` trigger
//         (see `migrations/helpers::install_persona_memory_invariants`),
//         so a future direct-SQL bypass also fails closed.
//
// (5) **`group_id` is a SECOND scope (alongside `use_case_id`).** Added
//     2026-05-22 to make PersonaGroups carry shared learning, not just
//     shared instructions. Semantics mirror (2): no FK by design — deleting
//     a group leaves orphan group_id attributions in place; injection treats
//     orphans as "shared with a group nobody is in", so the row is
//     functionally archived until re-attributed. `persona_id` stays NOT
//     NULL — a group-scoped memory is still authored by ONE persona, just
//     surfaced to all of that persona's group peers at injection time.
//     Stage 1 (this column) ships the schema; Stage 2 will extend
//     `get_for_injection_v2` to OR-in `group_id = ?` when the running
//     persona has `group_id IS NOT NULL`.
//
// Any change to these rules must update this block and the cited entry
// points together.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMemory {
    pub id: String,
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: String,
    pub source_execution_id: Option<String>,
    /// Importance score on a 1–5 scale:
    /// - 1: Low — minor or ephemeral detail
    /// - 2: Below average — limited ongoing relevance
    /// - 3: Normal (default) — standard operational knowledge
    /// - 4: High — frequently useful context
    /// - 5: Critical — essential knowledge for agent operation
    ///
    /// See MEMORY CONTRACT (4): bounds enforced at the DB layer via trigger.
    pub importance: i32,
    pub tags: Option<Json<Vec<String>>>,
    /// Memory tier: "core" (always injected), "active" (selected by scoring),
    /// "archive" (never injected, searchable only). See MEMORY CONTRACT (1)
    /// for promotion authority — `core` is user-initiated only.
    pub tier: String,
    /// How many times this memory has been injected into a prompt.
    /// MEMORY CONTRACT (3): only `increment_access_batch` writes this column.
    pub access_count: i32,
    /// Last time this memory was injected into a prompt (ISO 8601).
    /// MEMORY CONTRACT (3): paired with `access_count` and only written by
    /// `increment_access_batch`.
    pub last_accessed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Capability (use case) attribution. Memories with `use_case_id = Some(_)`
    /// are scoped to that capability for injection (active/working tier).
    /// `None` means persona-wide; injected for any execution. Core-tier memories
    /// are always persona-wide regardless of this column. Phase C5.
    ///
    /// MEMORY CONTRACT (2): no FK constraint by design. A use_case deletion
    /// leaves orphan attributions in place; the row is functionally archived
    /// for injection until re-attributed.
    #[serde(default)]
    pub use_case_id: Option<String>,
    /// Group attribution. Memories with `group_id = Some(_)` are shared with
    /// every persona that belongs to that group — when persona X (a member
    /// of group Y) runs, the injection path will fetch X's own memories AND
    /// every memory where `group_id = Y`, regardless of which group member
    /// authored it. `None` means persona-private (default — existing rows
    /// pre-2026-05-22 are private by definition).
    ///
    /// MEMORY CONTRACT (5): no FK by design — mirrors (2) for use_case_id.
    /// Stage 1 (column live, injection path not yet wired); Stage 2 will
    /// wire injection.
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaMemoryInput {
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub source_execution_id: Option<String>,
    pub importance: Option<i32>,
    pub tags: Option<Json<Vec<String>>>,
    #[serde(default)]
    pub use_case_id: Option<String>,
    /// Optional group attribution — memories with this set are shared with
    /// every persona in the same group. See MEMORY CONTRACT (5).
    #[serde(default)]
    pub group_id: Option<String>,
}
