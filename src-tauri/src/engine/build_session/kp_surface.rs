//! kp-hire surface enforcement — the DB glue around
//! [`personas_engine::kp_tool_surface`].
//!
//! The policy (what a kp hire's build may attach, and why) lives in the engine
//! crate as a pure function over `AgentIr`, where it is unit-tested. This file
//! is only the three things that cannot live there: reading the persona's typed
//! `kp_link` out of `design_context`, resolving which connectors bind no user
//! credential from the live catalog, and logging what was dropped.
//!
//! Called from exactly two places — the two points at which a build's tool and
//! connector sets are consumed:
//!
//! * `oneshot::run_test_pass`, before `run_tool_tests`, so the verification
//!   gate exercises the requested surface instead of holding on an invented
//!   one (the 2026-08-24 bench failure) — and so `run_tool_tests`'
//!   connector-driven credential injection never reaches an OAuth connector
//!   nobody asked for (bench sweep #23, 2026-08-26).
//! * `commands::design::build_sessions::promote_build_draft_inner`, before
//!   `prepare_tool_actions`, so the promoted persona is attached the same
//!   surface the gate verified. Filtering only at test time would have verified
//!   one set and shipped another.
//!
//! **A build with no `kp_link` is untouched.** [`apply_kp_tool_surface`]
//! returns `None` before mutating anything, which is every ordinary build in
//! the app.

use personas_engine::kp_tool_surface::{self, KpToolSurface, ToolSurfaceTrim};

use crate::db::models::{classify_connector, AgentIr, ConnectorClass};
use crate::db::DbPool;

/// Connector names the catalog says bind no user credential.
///
/// `ConnectorClass::ZeroConfig` (always-on local services) and
/// `ConnectorClass::GlobalProbe` (`codebase`, `twin`, `obsidian_memory`) both
/// resolve their readiness without a `persona_credentials` row, so they can
/// never reach the credential/OAuth validation the constraint exists to keep
/// off a hire's path — and an App master that lost `codebase` would lose the
/// project it was hired to own.
///
/// A catalog read failure yields an empty list, which makes the constraint
/// *stricter*, never looser: the engine still honours its own
/// `BASELINE_CONNECTORS`.
fn credential_free_connector_names(pool: &DbPool) -> Vec<String> {
    crate::db::repos::resources::connectors::get_all(pool)
        .unwrap_or_default()
        .into_iter()
        .filter(|c| {
            classify_connector(&c.name, c.metadata.as_deref()) != ConnectorClass::Credential
        })
        .map(|c| c.name)
        .collect()
}

/// Constrain `ir` to the tool + connector surface the kp hire asked for.
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

    let surface = KpToolSurface::from_design_context(persona.design_context.as_deref())?
        .with_credential_free_connectors(credential_free_connector_names(pool));
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
    //
    // Connectors first, and at `info` like the rest: a dropped connector is the
    // expensive one. Sweep #23 died on an unrequested Google connector's missing
    // OAuth secret, so "which connector went, and why" is the line an operator
    // reading the build log needs to find.
    for name in &trim.removed_connectors {
        tracing::info!(
            persona_id = %persona_id,
            stage = %stage,
            connector = %name,
            requested_connectors = ?surface.requested_connectors,
            "kp tool surface: DETACHED connector — outside the requested surface"
        );
    }
    for name in &trim.removed_flow_steps {
        tracing::info!(
            persona_id = %persona_id,
            stage = %stage,
            connector = %name,
            "kp tool surface: DETACHED service-flow step — outside the requested surface"
        );
    }
    for name in &trim.removed_tools {
        tracing::info!(
            persona_id = %persona_id,
            stage = %stage,
            tool = %name,
            "kp tool surface: DETACHED tool — outside the requested surface"
        );
    }
    // Distinct message on purpose: these were INSIDE the surface. Reading them
    // as "outside the requested surface" would send the next investigator to
    // `spec.connectors`, which is not where the answer is.
    for name in &trim.removed_duplicate_runners {
        tracing::info!(
            persona_id = %persona_id,
            stage = %stage,
            tool = %name,
            "kp tool surface: DETACHED duplicate command runner — one canonical runner is kept"
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
        removed_duplicate_runners = trim.removed_duplicate_runners.len(),
        removed_connectors = trim.removed_connectors.len(),
        removed_flow_steps = trim.removed_flow_steps.len(),
        remaining_tools = ir.tools.len(),
        remaining_connectors = ir.required_connectors.len(),
        requested_connectors = ?surface.requested_connectors,
        runs_commands = surface.runs_commands,
        "kp tool surface: constrained the build to the requested surface"
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
