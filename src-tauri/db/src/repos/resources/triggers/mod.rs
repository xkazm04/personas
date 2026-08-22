//! Trigger repositories, split by lifecycle.
//!
//! This tree replaces the single 3,761-line `repos::resources::triggers`
//! module, which mixed two lifecycles that are written at wildly different
//! rates: trigger *definitions* (authored once, read forever) and trigger
//! *firing state* (rewritten on every scheduler tick). Each child owns one
//! coherent set of tables (see the module-level notes below); nothing here is
//! a rewrite — the functions are the same ones `triggers.rs` held, moved
//! verbatim to the module that owns the tables they touch.
//!
//! The module path is unchanged, so `repos::resources::triggers::…` call sites
//! keep resolving through the re-export block at the bottom of this file while
//! they are migrated wave by wave.

/// `persona_triggers` — the definition row itself: validation, config
/// encryption, arming, CRUD, the orphan sweep, and the paired Fix 4a
/// auto-listener rows that are written in lock-step with it.
pub mod definitions;
/// The persona <-> event binding: `event_listener` triggers plus
/// `personas.structured_prompt.eventHandlers`, and the four-store event-type
/// rename that rewrites both.
pub mod event_wiring;
/// `pending_trigger_fires` and `composite_trigger_fires` — the durable record
/// that a trigger fired, and what is still waiting on a human.
pub mod fires;
/// The scheduler hot path: dispatch lookups, the compare-and-swap claim,
/// schedule-pointer advances, and `schedule_missed_runs` side-state.
pub mod scheduling;

// The shared row shape for `persona_triggers`, plus the three CRUD entry points
// generated from it. These live at the root of the tree rather than in a child
// because `row_mapper!` emits a bare `fn` -- there is no visibility parameter to
// widen -- and `scheduling` needs the same mapper `definitions` does. A private
// item declared here is reachable from every child as `super::row_to_trigger`,
// which is exactly the pre-split relationship. `get_by_id` / `get_all` /
// `delete` keep the path they had.
use crate::models::PersonaTrigger;

row_mapper!(row_to_trigger -> PersonaTrigger {
    id, persona_id, trigger_type, config,
    enabled [bool], status,
    last_triggered_at, next_trigger_at,
    trigger_version [opt_i32],
    created_at, updated_at, use_case_id,
    unattended_mode,
});

crud_get_by_id!(
    PersonaTrigger,
    "persona_triggers",
    "Trigger",
    row_to_trigger
);
crud_get_all!(
    PersonaTrigger,
    "persona_triggers",
    row_to_trigger,
    "created_at DESC"
);
crud_delete!("persona_triggers");

// SHIM: retire in W4 once callers migrate.
//
// Every item below kept the path `repos::resources::triggers::<name>` before
// the split. Re-exporting the children here holds that path stable so no
// caller had to change in this wave.
pub use definitions::*;
pub use event_wiring::*;
pub use fires::*;
pub use scheduling::*;

// The pre-split module carried one `mod tests` block spanning every domain in
// the file (definition CRUD, the arming refusal, auto-listener policy, the
// link/unlink handler transaction, the event-type rename, and the pending-fire
// / schedule-pointer CAS races). It is kept whole rather than shredded across
// the children — only its `use super::*` reaches through the globs above.
#[cfg(test)]
mod cross_domain_tests;
