//! Workspace sync — pure, transport-free foundation for encrypted cross-device
//! persona continuity (ADR 2026-05-24-cross-device-persona-continuity).
//!
//! This module is **deliberately not gated behind the `p2p` feature**: it holds
//! only the data model, canonical serialization, content hashing, and the
//! conflict-resolution merge algorithm. None of that needs networking, so it
//! compiles and unit-tests in lite/default builds. The QUIC transport, protocol
//! messages, and E2E encryption that actually move these snapshots between
//! devices live under `engine/p2p/` (Stage 3+) and stay `#[cfg(feature = "p2p")]`.
//!
//! The merge mirrors the codebase's mature, tested sync pattern in
//! `commands/obsidian_brain/conflict.rs` (`three_way_compare`): a three-way
//! comparison against a recorded base hash, with lucky-convergence detection.
//! Where Obsidian surfaces true conflicts for manual resolution, cross-device
//! sync is the *same user* on both ends, so a divergent conflict is auto-resolved
//! by last-writer-wins (later `updated_at`; ties broken by device id) — no manual
//! conflict UI is required for the common case.
//!
//! Stage 1 ships this module's data model + algorithm with full unit-test
//! coverage but no production caller yet — the QUIC sync handler and the
//! `personas::update()` merge hook that consume it land in Stage 3+ (see ADR
//! 2026-05-24-cross-device-persona-continuity). `allow(dead_code, unused_imports)`
//! documents that this is intentional foundation, not abandoned code; the lint is
//! restored implicitly once Stage 3 references these items.
#![allow(dead_code, unused_imports)]

pub mod crypto;
pub mod merge;
pub mod snapshot;

pub use crypto::{open_snapshot, seal_snapshot, SealedPayload, SyncKey};
pub use merge::{merge_entity, SyncWinner, WorkspaceEntity, WorkspaceMergeOutcome};
pub use snapshot::{
    MemorySnapshot, PersonaWorkspaceSnapshot, SyncSnapshot, TriggerSnapshot,
};
