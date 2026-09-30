//! What she announces.
//!
//! ## The defect this closes
//!
//! Measured 2026-09-25 against the operator's live database and process table:
//! her loop dispatched at 13:47, 17:38 and 20:46 UTC the same day, two of her
//! workers were running that minute, and the console said none of it. Not
//! because the loop was broken - it was working - but because
//! `useCuratorLoop` called `curator_runtime_get` once, on mount, and nothing
//! ever called it again. **The runtime strip was a photograph of the moment the
//! page was opened.**
//!
//! A poll would have fixed it and was declined, in the operator's own words:
//!
//! > "Changing states of queue items will be dynamically reflected in the UI,
//! > ideally listening events from Curator about success or another state. I
//! > would avoid polling."
//!
//! So the loop announces. One event name, six kinds, through the registry that
//! already carries `companions://status-changed` - not a second mechanism.
//!
//! ## Why the whole runtime rides on the event
//!
//! Because the alternative is a round trip during which the surface is showing
//! the stale answer anyway. The precedent is exact: `companions::emit_status`
//! ships the whole `CompanionsStatusDto` "so a listener never has to read
//! back". The cost is one [`super::runtime_snapshot`] per pulse - six DB reads
//! and a 200-row lane listing - at a rate bounded by her tick (one minute) and
//! by how often a worker actually starts or ends, which is single digits per
//! hour.
//!
//! The one thing it must not do is ship a runtime it did not measure. When the
//! snapshot fails the event still fires with `runtime: None`, because SOMETHING
//! moved and a surface that was not told goes back to being a photograph; the
//! client then re-reads. A zeroed stand-in - `running: 0`, `lane: "plan"` - is
//! the one answer that would be worse than no event at all.
//!
//! ## Best-effort, and that is the contract
//!
//! Every emit here is fire-and-forget after a write that has already committed,
//! exactly like `companions::emit_status`. A failed emit costs a stale strip
//! until the next pulse or the next mount; it never costs a lost dispatch, a
//! lost settle or a lost row.

use tauri::{AppHandle, Emitter};

use personas_core::events::{event_name, CuratorPulsePayload};

use crate::db::DbPool;

/// Announce that her observable state moved.
///
/// `kind` is one of [`personas_core::events::curator_pulse`]. Takes the reading
/// through [`super::runtime_snapshot`] - the SAME function `curator_runtime_get`
/// answers from - so the event and the command can never disagree about what
/// she is doing.
pub(crate) fn emit(app: &AppHandle, pool: &DbPool, kind: &'static str) {
    let runtime = match super::runtime_snapshot(pool) {
        Ok(runtime) => Some(runtime),
        Err(err) => {
            // Not a reason to stay silent. The listener is told that something
            // moved and that this app could not say what, which is the honest
            // pair; it re-reads rather than being handed a zero.
            tracing::warn!(
                error = %err,
                kind,
                "curator: her state moved but this app could not measure her runtime - the \
                 pulse carries no reading rather than a zeroed one"
            );
            None
        }
    };
    let payload = CuratorPulsePayload {
        kind: kind.to_string(),
        runtime,
    };
    if let Err(err) = app.emit(event_name::CURATOR_PULSE, &payload) {
        tracing::warn!(error = %err, kind, "curator: her pulse did not reach the app");
    }
}
