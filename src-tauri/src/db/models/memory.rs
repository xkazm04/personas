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
// (1) **Tier semantics + promotion authority.** Tier is a string column with
//     FOUR legal values, ALL live. (An earlier revision of this contract
//     called working/archive "deprecated / retired" while `run_lifecycle`
//     actively used them — that drift is resolved here; this list is the one
//     authoritative story and matches the code.)
//       - `"core"` — user-pinned identity/principles. Always injected,
//         persona-wide, NEVER decays (see (6)), never auto-modified by any
//         batch/lifecycle path.
//       - `"active"` — the scored hot set. Injected via the decay-aware
//         ranking in (6); capped at ACTIVE_CAP by `run_lifecycle`
//         (overflow archived).
//       - `"working"` — probationary intake tier. Injected alongside active
//         (same scoring); `run_lifecycle` promotes working → active at
//         access_count >= 5 and archives working rows >30 days old with
//         zero accesses.
//       - `"archive"` — retired. Never injected, still searchable;
//         reversible via `update_tier(id, "active")`.
//     Promotion to `"core"` is a USER-INITIATED action only —
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
// (6) **Active-tier injection ranking decays with access recency.** The
//     active/working injection sort in `get_for_injection_v2` is NOT the
//     monotonic `importance DESC, access_count DESC, created_at DESC` it once
//     was — that ranking let a memory injected hundreds of times pin itself
//     to the top forever (every injection incremented access_count, which
//     raised its rank, which got it injected again). The sort key is now:
//
//         score = importance * 10.0
//               + min(access_count, 9) / (1.0 + age_days / 7.0)
//         age_days = julianday('now')
//                  - julianday(COALESCE(last_accessed_at, created_at))
//         ORDER BY score DESC, created_at DESC
//
//     Properties (all load-bearing):
//       - **Importance strictly dominates.** The access term is capped at 9
//         (< the 10-point importance step), so decay only reorders memories
//         WITHIN an importance level — it can never demote an importance-4
//         memory below an importance-3 one. This keeps the user/AI-assigned
//         importance signal authoritative.
//       - **Access weight is time-windowed** (hyperbolic, ~7-day half-life):
//         a memory accessed today counts its (capped) access_count at full
//         strength; at 7 days it counts half; at 70 days ~9%. A stale
//         heavy-hitter (access_count=500, untouched for months) therefore
//         ranks below a fresh, moderately-used memory of equal importance.
//       - **Core NEVER decays.** The core tier keeps its own sort
//         (importance DESC, created_at DESC) and is always injected —
//         user-pinned is sacred.
//       - `run_lifecycle`'s ACTIVE_CAP overflow-archival deliberately keeps
//         the simpler monotonic ordering (changing which rows get archived
//         is a lifecycle behavior change, out of scope for the injection
//         ranking); revisit if the cap starts evicting fresh memories.
//
// (7) **Active-tier recall can be TASK-RELEVANT (ml builds only).** The value
//     ranking in (6) is task-blind: a run about invoices injects the same
//     "most valuable" active memories as a run about tweets. Under
//     `#[cfg(feature = "ml")]`, recall blends a semantic similarity to the
//     run's task context into the active-tier ranking. The moving parts:
//       - **Storage.** `repos::core::memories::{ensure_memory_vec_table,
//         embed_and_store_memory, search_similar_memories, backfill_memory_embeddings,
//         delete_memory_embeddings}` maintain a vec0 side-table
//         `persona_memory_embedding(memory_id, embedding float[384])`
//         (AllMiniLML6V2Q, the model the app already ships). It lives in the
//         **user DB** pool — the one where sqlite-vec is registered before the
//         pool is built (`db::init_user_db`) — NOT the main `personas.db` pool
//         whose connections open pre-registration. Created at runtime
//         (`CREATE VIRTUAL TABLE IF NOT EXISTS`, latched), mirroring
//         `companion::brain::embeddings`; NO migration.
//       - **Score.** `engine::memory_recall::pack_by_budget_relevance` ranks by
//         `final = value_score × (1 + relevance_weight × similarity)`, where
//         `value_score` is the unchanged `decay_score` (importance × category
//         half-life × access boost), `similarity ∈ [0,1]` comes from
//         `similarity_from_distance` over the KNN L2 distance, and
//         `relevance_weight = DEFAULT_RELEVANCE_WEIGHT` (0.6). Two load-bearing
//         bounds: **similarity 0 is a no-op** (un-embedded / off-topic /
//         below-floor memories rank EXACTLY as the value-only pack, so a
//         partially-indexed corpus degrades gracefully and relevance can only
//         PROMOTE never demote); and **the lift is bounded to `1 + weight`**, so
//         relevance reorders memories of comparable value but cannot overtake a
//         peer worth more than `1.6×` on value alone — importance keeps the last
//         word across real value gaps.
//       - **Relevance floor.** `engine::memory_recall::pack_by_budget_task_aware`
//         (the embed→KNN→floor→blend orchestrator a caller with an embedder +
//         user-DB pool swaps in for `pack_by_budget`) applies
//         `crate::retrieval::filter_by_distance_floor` with
//         `crate::retrieval::MAX_VECTOR_DISTANCE` before building the similarity
//         map, so off-topic hits are dropped (contribute similarity 0), not
//         merely down-weighted — an off-topic run injects the value-ranked set,
//         never irrelevant-but-close padding. Any embedding failure inside the
//         orchestrator falls back to the value-only pack: task-aware recall is
//         an enhancement, never a new failure mode for prompt assembly.
//       - **Write path.** `repos::core::memories::create_with_embedding` is
//         `create` + best-effort embed (log-and-continue — an embedding failure
//         NEVER fails the memory write); `backfill_memory_embeddings` is the
//         idempotent, batched repair pass for rows created before indexing
//         existed or whose write-path embed failed.
//       - **Unchanged by construction.** Core pinning (core is packed
//         separately and never enters `pack_by_budget_relevance`), the 6k-char
//         budget, and greedy whole-entry packing/omission are identical to the
//         value-only path. Non-ml builds keep calling `pack_by_budget` and
//         behave exactly as (6) describes.
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
    /// Memory tier: "core" (user-pinned, always injected, never decays),
    /// "active" (scored hot set, decay-aware ranking — MEMORY CONTRACT (6)),
    /// "working" (probationary intake; auto-promoted/archived by
    /// `run_lifecycle`), "archive" (never injected, searchable only).
    /// See MEMORY CONTRACT (1) for the full tier semantics and promotion
    /// authority — `core` is user-initiated only.
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
    /// Workspace-scoped injection anchor. Memories with `home_team_id =
    /// Some(T)` are shared with every persona whose `home_team_id = T` — when
    /// such a persona runs, the injection path fetches its own memories AND
    /// every memory attributed to T, regardless of author. `None` means
    /// persona-private (the default). This replaced the retired `group_id`
    /// scope in the Groups→Teams consolidation (Phase 5).
    ///
    /// MEMORY CONTRACT (5): no FK by design — mirrors (2) for use_case_id.
    /// Populated by the groups_to_teams data migration; the ONE sanctioned
    /// runtime writer is `repos::core::memories::create_synthesized`, used
    /// by team reflection to publish a cross-member insight to the whole
    /// team (the insight is still authored by ONE persona — `persona_id`
    /// stays NOT NULL).
    #[serde(default)]
    pub home_team_id: Option<String>,
    /// Reflection provenance: ids of the source memories a synthesized
    /// insight was derived from. `None` for organic (non-synthesized)
    /// memories. No FK by design — sources are archived on synthesis and
    /// may later be deleted without erasing the insight's lineage. Written
    /// only by the reflection apply path
    /// (`repos::core::memories::create_synthesized`).
    #[serde(default)]
    pub derived_from: Option<Json<Vec<String>>>,
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
}
