//! Op dispatcher — extracts `{"op": ...}` JSON proposals from Athena's
//! reply text, validates them against the allowed set, and creates rows
//! in `companion_approval` for the UI to render as approval cards.
//!
//! Phase 3 op set (write-only proposals; read-only inspection comes from
//! the observability digest):
//!   - propose_action { action: "run_persona", params: { persona_id, input? }, rationale }
//!   - propose_action { action: "resolve_human_review", params: { review_id, decision, comment? }, rationale }
//!
//! Discipline: ops are message-level. The dispatcher scans the finalized
//! assistant text after the turn ends — no agentic mid-turn loop. The
//! assistant text Athena renders is the *cleaned* text with the JSON
//! lines stripped; approval cards render in their place.
//!
//! ## Layout
//!
//! Split out of the former single-file `dispatcher.rs` (4,545 lines) along
//! the seams the file already had — what an op *is*, what an op is *allowed*
//! to be, the walk that turns text into ops, and the three side-effect
//! surfaces that walk reaches. No logic moved with it:
//!
//! - [`types`] — the payload structs the chat layer receives
//!   ([`Dispatched`], [`ChatCard`], [`PointAt`], …) and the canvas spec
//!   version / block limits that describe their shape.
//! - [`catalog`] — the allow-lists: every action, read op, route, lab mode,
//!   guided topic and guidance anchor Athena may name. An op outside these
//!   tables never reaches a write.
//! - [`envelope`] — the `{"op": …}` wire shape and the bounded brace repair
//!   for op-shaped lines that fail to parse.
//! - [`dispatch`] — [`dispatch`] / [`dispatch_with_sys`]: the line walk and
//!   the arm-per-op body. **Ordering inside `dispatch_with_sys` is
//!   behaviour**, so it moved as one unbroken block.
//! - [`canvas_control`] — validation for the `canvas_control` op against the
//!   kind/band/category allow-lists.
//! - [`read_ops`] — the bounded read-only lookups (`describe_*`, `list_*`)
//!   over the system DB, their clipping helpers, and the episode note that
//!   feeds a result back into Athena's next turn.
//! - [`approvals`] — the two user-DB writes: the `companion_approval` row,
//!   and the System episode a rejected `use_connector` leaves behind.
//!
//! Everything stays reachable as `crate::companion::dispatcher::X`; the
//! re-exports below preserve the pre-split surface exactly.

mod approvals;
mod canvas_control;
mod catalog;
mod dispatch;
mod envelope;
mod read_ops;
mod types;

#[cfg(test)]
mod tests;

pub(crate) use catalog::*;
pub use dispatch::*;
pub use types::*;
