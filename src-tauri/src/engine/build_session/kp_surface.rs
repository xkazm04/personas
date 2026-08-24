//! kp-hire tool-surface enforcement — the DB glue around
//! [`personas_engine::kp_tool_surface`].
//!
//! The policy (what a kp hire's build may attach, and why) lives in the engine
//! crate as a pure function over `AgentIr`, where it is unit-tested. This file
//! is only the two things that cannot live there: reading the persona's typed
//! `kp_link` out of `design_context`, and logging what was dropped.
//!
//! Called from exactly two places — the two points at which a build's tool set
//! is consumed:
//!
//! * `oneshot::run_test_pass`, before `run_tool_tests`, so the verification
//!   gate exercises the requested surface instead of holding on an invented
//!   one (the 2026-08-24 bench failure).
//! * `commands::design::build_sessions::promote_build_draft_inner`, before
//!   `prepare_tool_actions`, so the promoted persona is attached the same
//!   surface the gate verified. Filtering only at test time would have verified
//!   one set and shipped another.
//!
//! **A build with no `kp_link` is untouched.** [`apply_kp_tool_surface`]
//! returns `None` before mutating anything, which is every ordinary build in
//! the app.

use personas_engine::kp_tool_surface::{self, KpToolSurface, ToolSurfaceTrim};

use crate::db::models::AgentIr;
use crate::db::DbPool;

/// Constrain `ir` to the tool surface the kp hire asked for.
///
/// `stage` is a short label for the logs (`"verification"` / `"promote"`).
/// Returns `None` when this persona was not hired through kp — in that case
/// `ir` is not touched at all. Returns `Some(trim)` otherwise, including the
/// empty trim when the build was already inside its surface.
pub(crate) fn apply_kp_tool_surface(
    pool: &DbPool,
    persona_id: &str,
    ir: &mut AgentIr,
    stage: &str,
) -> Option<ToolSurfaceTrim> {
    // A read failure here must not fail the build: the constraint is a
    // narrowing, and a build that cannot read its own link is simply not
    // narrowed. Logged loudly so it does not read as "nothing to do".
    let persona = match crate::db::repos::core::personas::get_by_id(pool, persona_id) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(
                persona_id = %persona_id,
                stage = %stage,
                error = %e,
                "kp tool surface: could not load the persona — leaving the tool set unconstrained"
            );
            return None;
        }
    };

    let surface = KpToolSurface::from_design_context(persona.design_context.as_deref())?;
    let trim = kp_tool_surface::constrain_agent_ir(ir, &surface);

    if trim.is_empty() {
        tracing::debug!(
            persona_id = %persona_id,
            stage = %stage,
            connectors = ?surface.requested_connectors,
            "kp tool surface: build was already inside the requested surface"
        );
        return Some(trim);
    }

    // One line per detach — an over-provisioned build has to leave a trail that
    // names what was taken away, not just a count.
    for name in &trim.removed_tools {
        tracing::info!(
            persona_id = %persona_id,
            stage = %stage,
            tool = %name,
            "kp tool surface: DETACHED tool — outside the requested surface"
        );
    }
    for name in &trim.removed_tool_hints {
        tracing::info!(
            persona_id = %persona_id,
            stage = %stage,
            tool_hint = %name,
            "kp tool surface: DETACHED tool hint — outside the requested surface"
        );
    }
    tracing::info!(
        persona_id = %persona_id,
        stage = %stage,
        removed_tools = trim.removed_tools.len(),
        removed_tool_hints = trim.removed_tool_hints.len(),
        remaining_tools = ir.tools.len(),
        requested_connectors = ?surface.requested_connectors,
        runs_commands = surface.runs_commands,
        "kp tool surface: constrained the build to the requested tool surface"
    );

    if ir.tools.is_empty() {
        // Not an error — `run_tool_tests` reports an empty set as a defensible
        // pass. But a hire that asked for `["github"]` and produced nothing
        // that belongs to github is a real signal about the design pass, and
        // it must not disappear into a green promotion unremarked.
        tracing::warn!(
            persona_id = %persona_id,
            stage = %stage,
            requested_connectors = ?surface.requested_connectors,
            "kp tool surface: the constraint left ZERO tools — the design pass produced nothing inside the requested surface"
        );
    }

    Some(trim)
}
