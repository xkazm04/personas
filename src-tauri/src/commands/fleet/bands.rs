//! A companion's RESERVED BAND in the dispatch queue.
//!
//! One companion holds one position in the queue, and that position does not
//! move when the queue is reordered around it. Curator's loop
//! (`commands/curator/tick.rs`) is the first and currently only holder: she
//! ticks every 60s and enqueues through the same door as everyone else, so on
//! a busy queue her own work can sit behind an operator's drag-and-drop
//! indefinitely. The band is what stops that.
//!
//! # Why this is not `fleet_autopilot.dispatch_order`, which was deleted
//!
//! **Read `engine/subscription/attention.rs` ("An operator-written GLOBAL
//! rank…") before changing anything here.** An operator-written global
//! dispatch rank lived from 2026-09-14 to 2026-09-17 and was retired when the
//! fleet queue took over ordering; boot migration **e37** deletes its setting
//! row. Its stated reason is the one that matters here: *"one order, not a
//! tick-side one that could disagree with it"*. A reviewer who remembers that
//! retirement will read this module as the same mistake coming back, so the
//! difference is written down rather than left to be re-derived:
//!
//! | `dispatch_order` (retired) | the band (here) |
//! |---|---|
//! | a rank for **any** persona, written by the operator | **one** reserved position, held by **one** companion |
//! | consulted by the **tick**, beside the queue's own order | consulted **inside** `registry::renumber_queue`, which stays the only ranker |
//! | two orders that could disagree | one order; the band decides a seat within it |
//! | arbitrary values, arbitrary rows | the band number is a **constant per companion** ([`CURATOR_BAND`]), never operator input, never a free field |
//!
//! Concretely: there is no second sort key and no second comparison anywhere.
//! `renumber_queue` still produces one dense 1-based order over the queued
//! rows; the only change is that one of the slots in it is spoken for. Every
//! other row keeps the relative order it would have had, exactly.
//!
//! # And it buys no privileges
//!
//! The queue became bounded in `c6a94d14a`, and a reservation that dodged
//! either half of that bound would be a privilege escalation, not a
//! reservation:
//!
//! * **The depth cap still refuses it.** The band is claimed AFTER
//!   `queue::admit` has already queued the row, so a reserved dispatch is
//!   counted by `queue_has_room` like any other and is refused at the cap
//!   like any other. Nothing here calls `enqueue`.
//! * **The reaper still retires it.** `stale::queued_expiry_pass` selects on
//!   `queued_at_ms` alone and `queue::expire_dispatch` on state alone;
//!   neither reads `reserved_band`, and nothing in this module asks them to.
//! * **The door is unchanged.** `door_verdict_for` has no per-origin and no
//!   per-band term, and `queue.rs` says every origin obeys the same rules.
//!
//! # Width one, and room for a second companion without a migration
//!
//! The band NUMBER is a constant per companion, so a second companion is a
//! second constant and nothing else: the column, the writer, the placement
//! and the claim are all already general over the number. What is
//! deliberately absent is any way to set a band that is not one of those
//! constants — the thin writer `queue_lanes::fleet_queue_reserve_band` exists
//! for the operator-facing surface, and this module is the only engine-side
//! caller. There is no general reservation system here and it is not
//! configurable; adding one would be re-creating `dispatch_order`.

use tauri::AppHandle;

use super::queue::{emit_queue_changed, persist_ranks, pool_of};
use super::registry::registry;
use crate::db::repos::fleet_sessions;

/// Curator's band: the head of the queue.
///
/// One, because her loop's whole complaint is being pushed behind work that
/// arrived later, and because a band in the middle would reserve a position
/// whose meaning changes with the queue's length. A second companion would
/// take `2`, and the rest of this module would not change.
pub const CURATOR_BAND: u32 = 1;

/// Claim `band` for a queued session: registry, column, re-rank, announce.
///
/// Returns whether the claim took. `false` is the ordinary outcome when the
/// band is already held by another waiting row, or when this row is no longer
/// queued — see [`super::registry::FleetRegistry::claim_band`] for the full
/// list. A refused claim is not an error: the row simply waits in its natural
/// position, which is what it would have done without a band at all.
///
/// Blocking (two small rusqlite writes). Called from the companion's own
/// background tick, never from an IPC worker.
pub fn claim(app: &AppHandle, session_id: &str, band: u32) -> bool {
    let Some(changed) = registry().claim_band(session_id, band) else {
        return false;
    };
    persist_bands(app, &changed);
    // The re-rank is what moves the row into its seat; without it the claim
    // would not take effect until some unrelated edit renumbered the queue.
    let ranks = registry().renumber_queue(&[]);
    persist_ranks(app, &ranks);
    emit_queue_changed(app, "reordered", Some(session_id));
    true
}

/// Release `band` from whoever holds it — the switch went off, so the
/// reservation must stop existing and the ranks must be dense exactly as they
/// are with no companion running at all.
///
/// Idempotent: with nobody holding the band it writes nothing and emits
/// nothing, which is what makes it safe to call on every tick of a disabled
/// companion.
pub fn release(app: &AppHandle, band: u32) {
    let changed = registry().release_band(band);
    if changed.is_empty() {
        return;
    }
    persist_bands(app, &changed);
    let ranks = registry().renumber_queue(&[]);
    persist_ranks(app, &ranks);
    emit_queue_changed(app, "reordered", None);
}

/// Write each changed session's band to its durable row, reading the value
/// back out of the registry so memory and column cannot disagree.
fn persist_bands(app: &AppHandle, changed: &[String]) {
    if changed.is_empty() {
        return;
    }
    let Some(pool) = pool_of(app) else { return };
    for id in changed {
        let band = registry().reserved_band_of(id);
        if let Err(err) = fleet_sessions::set_reserved_band(&pool, id, band) {
            tracing::warn!(session_id = %id, error = %err, "fleet queue: band write failed");
        }
    }
}
