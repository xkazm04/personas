//! QUEUE LANES: anonymous numbered strands of sequential work, round-robined.
//!
//! A lane is a 1-based label on a queued row. Two rows in the SAME lane never
//! interleave with each other — they run in the order they were queued; rows
//! in DIFFERENT lanes take turns. The operator's words were *"assigned
//! parallel lanes. Each lane should reorder in queue to last position after
//! each task"*, and "reorders to last position" is a round-robin fairness
//! rule stated over a list of lanes: once a lane has been served, it goes
//! behind every other lane that is waiting.
//!
//! # A lane GRANTS NOTHING
//!
//! It is an ORDERING DEVICE and only that, exactly as the band beside it is
//! one reserved seat and only that. A lane buys no extra slot, no exemption
//! from the depth cap, no exemption from the expiry reaper, and no term at
//! the admission door:
//!
//! * **The depth cap counts a laned row like any other.** Nothing here calls
//!   `queue::enqueue`; lanes are assigned to rows that are ALREADY queued, so
//!   `queue_has_room` has already refused them at the cap like anyone else.
//! * **The reaper still retires it.** `stale::queued_expiry_pass` selects on
//!   `queued_at_ms` and `queue::expire_dispatch` on state;
//!   [`super::registry::FleetRegistry::queued_in_order`]'s tuple deliberately
//!   does not carry a lane, so the reaper cannot see one even in principle.
//!   A test in `queue.rs` asserts that tuple's shape.
//! * **The door is unchanged.** `door_verdict_for` has no per-origin and no
//!   per-lane term.
//!
//! # Why this is not `fleet_autopilot.dispatch_order`, which was deleted
//!
//! The same note [`super::bands`] carries, for the same reviewer, because
//! this is the second member of that family and the question will be asked
//! again. **Read `engine/subscription/attention.rs:809` ("An operator-written
//! GLOBAL rank…") before changing anything here.** An operator-written global
//! dispatch rank lived from 2026-09-14 to 2026-09-17 and boot migration
//! **e37** deletes its setting row; its stated reason is the one that matters
//! here — *"one order, not a tick-side one that could disagree with it"*.
//!
//! | `dispatch_order` (retired) | the lane (here) |
//! |---|---|
//! | an absolute rank, written per row by the operator | an anonymous STRAND label; it says which rows are mutually sequential, never where any of them sits |
//! | consulted by the **tick**, beside the queue's own order | consulted **inside** `registry::renumber_queue`, which stays the only ranker |
//! | two orders that could disagree | one order; lanes are a **permutation** of the order that one ranker already produced |
//! | arbitrary values | a bounded label, `1..=8`, refused out of range (`queue_lanes::MAX_LANE`) |
//!
//! [`place_lanes`] is a permutation of its input — same length, same set of
//! ids — so `renumber_queue`'s `i + 1` stamping stays DENSE and 1-based
//! structurally rather than by assertion. A gap is not expressible, because
//! a rank IS the index into that vector.
//!
//! # The word "lane" already means three other things in this tree
//!
//! A reader who greps will hit all four, so they are named here:
//!
//! 1. `LanesBoard.tsx` — a Running / Queued / Parked **kanban column**.
//! 2. `laneOfState` — a **state bucket** feeding that board.
//! 3. "lane" throughout the Rust comments — *"a code path that writes session
//!    state"* (`registry.rs`'s state-door header: "every lane that decides a
//!    session's lifecycle state").
//! 4. **This one** — a queue strand.
//!
//! Identifiers here therefore say `queue lane` or carry a `lane_` prefix with
//! a `u32` type, never a bare `lane` holding a state or a column: the public
//! names are [`place_lanes`], [`lane_rotation`], [`note_lane_served`] and
//! [`served_tick_of`], and none of them is about a code path or a board
//! column.
//!
//! # The rotation's memory, and the trade in it
//!
//! Fairness has to remember which lane went last, and that memory is the one
//! new piece of state in this package: a monotonic **served tick** per lane,
//! held IN MEMORY ([`LANE_SERVED`]) and bumped when a laned row leaves
//! `Queued`. [`lane_rotation`] is then the present lanes sorted by served
//! tick ascending, then by lane number — so a lane nobody has served yet
//! (tick 0) sorts first, which is the same choice `attention.rs` makes for a
//! persona never served ("`None`, which sorts first").
//!
//! **A restart resets the rotation to plain lane order while the strands
//! themselves survive in the `fleet_sessions.lane` column.** That is chosen,
//! not overlooked. Persisting the tick would be a migration, a repo writer
//! and a second thing that can disagree with memory, bought for a TIE-BREAK
//! that is wrong for at most one round after a boot — after which the first
//! completion in each lane re-establishes the real order. The strand
//! assignment, which is the part an operator typed and would be furious to
//! lose, is already durable.
//!
//! Looked for first, and rejected with the evidence: the closest persisted
//! "least recently served" signal in the tree is the attention ledger's
//! `started_at` (`engine/subscription/attention.rs:820`), but it is keyed by
//! PERSONA, and a lane is deliberately anonymous — N rows of one persona may
//! sit in N lanes and one lane may hold N personas, so that column cannot
//! answer "which lane went last". `fleet_sessions` carries `queued_at_ms`,
//! `queue_rank`, `lane` and `reserved_band` and no per-lane timestamp of any
//! kind.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;

/// Per-lane "when was this lane last served", as a monotonic tick rather than
/// a clock: the rotation only ever compares two of these, so a wall clock
/// would add a source of skew and buy nothing. `0` (absent) means never
/// served, and sorts first.
///
/// Process-local by design — see the module header for why it is not a
/// column.
static LANE_SERVED: OnceLock<Mutex<HashMap<u32, u64>>> = OnceLock::new();

/// The tick source. Bumped once per service event, so no two lanes can share
/// a tick and the rotation is a total order before the lane-number tiebreak
/// is even reached.
static SERVE_TICK: AtomicU64 = AtomicU64::new(0);

fn served() -> &'static Mutex<HashMap<u32, u64>> {
    LANE_SERVED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record that `queue_lane` was just served — a row carrying it LEFT
/// `Queued`.
///
/// **The one caller is the registry's state door** (`registry::
/// transition_inner`, the single seam every lifecycle lane writes state
/// through), on the `Queued → anything` edge of a row that holds a lane.
/// Bumping from the promotion path instead would miss the other two exits a
/// queued row has — cancellation and expiry — and a lane whose rows are all
/// cancelled would then keep its turn forever.
pub fn note_lane_served(queue_lane: u32) {
    let tick = SERVE_TICK.fetch_add(1, Ordering::Relaxed) + 1;
    let mut map = served().lock().unwrap_or_else(|e| e.into_inner());
    map.insert(queue_lane, tick);
}

/// The served tick of one lane; `0` when it has never been served.
///
/// **Test-only**, deliberately: an operator surface that wanted to explain a
/// rotation would read [`lane_rotation`], which is the ordering itself. A
/// bare tick has no meaning outside a comparison, and shipping an accessor
/// ahead of a caller is how this backend accumulated its unadopted
/// primitives.
#[cfg(test)]
pub fn served_tick_of(queue_lane: u32) -> u64 {
    let map = served().lock().unwrap_or_else(|e| e.into_inner());
    map.get(&queue_lane).copied().unwrap_or(0)
}

/// Serialises every test that touches the process-wide rotation.
///
/// `LANE_SERVED` and `SERVE_TICK` are deliberately one per process — that is
/// the whole point of a fairness memory — and cargo runs this crate's tests
/// as threads in ONE process, so two lane tests racing would each see the
/// other's bumps. Take this lock (and [`reset_served_ticks`]) in any test
/// whose expectations depend on the rotation.
#[cfg(test)]
pub static LANE_TEST_LOCK: Mutex<()> = Mutex::new(());

/// Forget every served tick. **Test-only**: production has exactly one
/// process-wide rotation and a reset in it would be a fairness bug, not a
/// feature. Boot gets the same effect for free, by the state not existing.
#[cfg(test)]
pub fn reset_served_ticks() {
    served().lock().unwrap_or_else(|e| e.into_inner()).clear();
}

/// The order in which the lanes PRESENT in `lanes` take their turns: served
/// tick ascending, then lane number ascending.
///
/// Every present lane appears exactly once, so [`place_lanes`]'s
/// "absent from the rotation" fallback is a contract for its own direct
/// callers (and its tests) rather than something this path can reach.
pub fn lane_rotation(lanes: &[Option<u32>]) -> Vec<u32> {
    let mut present: Vec<u32> = Vec::new();
    for lane in lanes.iter().flatten() {
        if !present.contains(lane) {
            present.push(*lane);
        }
    }
    let ticks = served().lock().unwrap_or_else(|e| e.into_inner());
    present.sort_by_key(|lane| (ticks.get(lane).copied().unwrap_or(0), *lane));
    present
}

/// Round-robin the laned rows through the positions they already occupy,
/// taking lanes in `rotation` order.
///
/// `lanes[i]` is the queue lane of `order[i]`. The result is a PERMUTATION of
/// `order` — same length, same ids — which is what keeps the caller's `i + 1`
/// stamping dense and 1-based no matter what the lanes say. Mirrors
/// `registry::place_reserved_bands` deliberately: both are pure, both are a
/// permutation, and `renumber_queue` composes them in that order.
///
/// **A row with `lane = None` never moves.** Only the indices that laned rows
/// currently occupy change hands; an unlaned row keeps its exact absolute
/// position and is completely undisturbed. That is the property that makes
/// lanes an opt-in overlay rather than a rewrite of everybody's queue, and it
/// is asserted directly in the tests.
///
/// The edge cases, each DECIDED here rather than left to fall out:
///
/// * **An empty rotation.** Not an error and not a no-op: every present lane
///   is "absent from the rotation" and the fallback below applies, so the
///   result is a plain round-robin in ascending lane order. That is the
///   rotation a fresh process has anyway (no lane has been served, so
///   [`lane_rotation`] sorts purely by lane number), which makes the two
///   agree instead of giving `&[]` a special meaning.
/// * **A single lane.** A NO-OP, necessarily: one lane's rows are taken in
///   their natural order and written back into the slots they already
///   occupied, in that order. Round-robin over one strand is that strand.
/// * **Every row laned.** The slots are `0..len`, so the output is a pure
///   round-robin over the whole queue.
/// * **Lane numbers with gaps** (1, 4, 9). Legal. Lanes are LABELS, not
///   indices — nothing here builds an array over them, and lane 9 with lanes
///   1 and 4 present is three strands, not nine.
/// * **A lane in `rotation` that no row carries.** Skipped; it contributes no
///   turn.
/// * **A lane a row carries that `rotation` omits.** Served after every
///   rotated lane, in ascending lane order. Never dropped: a row on the floor
///   would break the permutation and therefore the density of the ranks, so
///   the tests assert the output length and the output SET of ids both equal
///   the input's.
/// * **A `rotation` with duplicates.** First occurrence wins; the repeats are
///   ignored rather than granting a lane two turns per round.
pub fn place_lanes(order: Vec<String>, lanes: &[Option<u32>], rotation: &[u32]) -> Vec<String> {
    let len = order.len();
    if len == 0 || lanes.iter().take(len).all(Option::is_none) {
        return order;
    }
    // The positions that change hands, and the per-lane strands that will
    // fill them. `strands` is a Vec of (lane, indices) rather than a map so
    // the "ascending lane" fallback below is a sort and not a second pass.
    let mut slots: Vec<usize> = Vec::new();
    let mut strands: Vec<(u32, Vec<usize>)> = Vec::new();
    for (i, lane) in lanes.iter().enumerate().take(len) {
        let Some(lane) = *lane else { continue };
        slots.push(i);
        match strands.iter_mut().find(|(l, _)| *l == lane) {
            Some((_, rows)) => rows.push(i),
            None => strands.push((lane, vec![i])),
        }
    }
    // Turn order: the rotation first (deduped, present lanes only), then
    // every remaining lane in ascending order.
    let mut turn_order: Vec<u32> = Vec::with_capacity(strands.len());
    for lane in rotation {
        if turn_order.contains(lane) {
            continue;
        }
        if strands.iter().any(|(l, _)| l == lane) {
            turn_order.push(*lane);
        }
    }
    let mut leftover: Vec<u32> = strands
        .iter()
        .map(|(l, _)| *l)
        .filter(|l| !turn_order.contains(l))
        .collect();
    leftover.sort_unstable();
    turn_order.extend(leftover);
    // Walk the turn order in rounds, taking one unconsumed row per lane per
    // round. A drained lane is skipped in later rounds, so an uneven split
    // degrades to the long lane's natural order — which is exactly what "the
    // other strands have nothing left to interleave" should look like.
    let mut taken: Vec<usize> = vec![0; turn_order.len()];
    let mut sequence: Vec<usize> = Vec::with_capacity(slots.len());
    while sequence.len() < slots.len() {
        let before = sequence.len();
        for (t, lane) in turn_order.iter().enumerate() {
            let Some((_, rows)) = strands.iter().find(|(l, _)| l == lane) else {
                continue;
            };
            if let Some(i) = rows.get(taken[t]) {
                taken[t] += 1;
                sequence.push(*i);
            }
        }
        // Defensive: every round either places a row or every strand is
        // drained, and the loop condition then cannot be true. Breaking
        // rather than looping forever if that ever stops holding — a hung
        // renumber under the registry lock would freeze the whole fleet.
        if sequence.len() == before {
            break;
        }
    }
    debug_assert_eq!(
        sequence.len(),
        slots.len(),
        "every laned row takes exactly one slot"
    );
    let mut out = order;
    let rotated: Vec<String> = sequence.iter().map(|i| out[*i].clone()).collect();
    for (slot, id) in slots.into_iter().zip(rotated) {
        out[slot] = id;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hold the rotation still for a test that reads or writes served ticks.
    fn rotation_guard() -> std::sync::MutexGuard<'static, ()> {
        let g = LANE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_served_ticks();
        g
    }

    /// `place_lanes` over ids named for their natural position.
    fn placed(ids: &[&str], lanes: &[Option<u32>], rotation: &[u32]) -> Vec<String> {
        let order: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
        let out = place_lanes(order.clone(), lanes, rotation);
        assert_eq!(out.len(), order.len(), "a permutation keeps the length");
        let mut a: Vec<&String> = out.iter().collect();
        let mut b: Vec<&String> = order.iter().collect();
        a.sort();
        b.sort();
        assert_eq!(a, b, "a permutation keeps the SET of ids - nobody dropped");
        out
    }

    #[test]
    fn two_lanes_alternate() {
        // Natural order is lane 1 three deep, then lane 2 three deep; the
        // round-robin interleaves them.
        let out = placed(
            &["a1", "a2", "a3", "b1", "b2", "b3"],
            &[Some(1), Some(1), Some(1), Some(2), Some(2), Some(2)],
            &[1, 2],
        );
        assert_eq!(out, vec!["a1", "b1", "a2", "b2", "a3", "b3"]);
    }

    #[test]
    fn an_uneven_split_degrades_to_the_long_lanes_natural_order() {
        let out = placed(
            &["a1", "a2", "a3", "a4", "b1"],
            &[Some(1), Some(1), Some(1), Some(1), Some(2)],
            &[1, 2],
        );
        // One alternation, then lane 2 is drained and lane 1 simply continues
        // in the order it was queued in.
        assert_eq!(out, vec!["a1", "b1", "a2", "a3", "a4"]);
    }

    #[test]
    fn unlaned_rows_hold_their_exact_absolute_positions() {
        // Slots 1 and 3 are unlaned and must come back untouched; only slots
        // 0, 2 and 4 change hands.
        let out = placed(
            &["a1", "free1", "a2", "free2", "b1"],
            &[Some(1), None, Some(1), None, Some(2)],
            &[2, 1],
        );
        assert_eq!(out[1], "free1", "an unlaned row never moves");
        assert_eq!(out[3], "free2", "an unlaned row never moves");
        // Lane 2 goes first this rotation, so it takes the first laned slot.
        assert_eq!(out, vec!["b1", "free1", "a1", "free2", "a2"]);
    }

    #[test]
    fn a_single_lane_is_a_no_op() {
        let ids = ["x", "y", "z"];
        let out = placed(&ids, &[Some(3), Some(3), Some(3)], &[3]);
        assert_eq!(out, ids.to_vec());
        // ...and with unlaned rows mixed in, still a no-op.
        let out = placed(&["x", "free", "y"], &[Some(3), None, Some(3)], &[3]);
        assert_eq!(out, vec!["x", "free", "y"]);
    }

    #[test]
    fn an_empty_rotation_is_ascending_lane_order_not_a_no_op() {
        let out = placed(
            &["b1", "a1", "b2", "a2"],
            &[Some(2), Some(1), Some(2), Some(1)],
            &[],
        );
        assert_eq!(out, vec!["a1", "b1", "a2", "b2"]);
    }

    #[test]
    fn lane_numbers_with_gaps_are_labels_not_indices() {
        let out = placed(&["p", "q", "r"], &[Some(9), Some(4), Some(1)], &[]);
        // Three strands, served 1 then 4 then 9 - not nine strands, and no
        // array indexed by 9.
        assert_eq!(out, vec!["r", "q", "p"]);
    }

    #[test]
    fn a_lane_absent_from_the_rotation_goes_after_the_rotated_ones() {
        let out = placed(&["a1", "b1", "c1"], &[Some(1), Some(2), Some(3)], &[3]);
        // Lane 3 is rotated, so it goes first; lanes 1 and 2 follow in
        // ascending order. Nobody is dropped.
        assert_eq!(out, vec!["c1", "a1", "b1"]);
    }

    #[test]
    fn a_rotation_naming_an_absent_lane_or_repeating_one_is_harmless() {
        let out = placed(
            &["a1", "a2", "b1"],
            &[Some(1), Some(1), Some(2)],
            &[7, 1, 1, 2],
        );
        // Lane 7 contributes no turn; lane 1 does not get two turns a round.
        assert_eq!(out, vec!["a1", "b1", "a2"]);
    }

    #[test]
    fn no_lanes_at_all_is_the_identity() {
        let out = placed(&["a", "b", "c"], &[None, None, None], &[1, 2]);
        assert_eq!(out, vec!["a", "b", "c"]);
        assert_eq!(place_lanes(Vec::new(), &[], &[1]), Vec::<String>::new());
    }

    #[test]
    fn a_lane_just_served_goes_behind_a_lane_never_served() {
        let _guard = rotation_guard();
        let lanes = [Some(1), Some(2), Some(3)];
        assert_eq!(
            lane_rotation(&lanes),
            vec![1, 2, 3],
            "nobody served yet: ascending lane number"
        );
        note_lane_served(1);
        assert_eq!(
            lane_rotation(&lanes),
            vec![2, 3, 1],
            "lane 1 went last, so it goes behind the two that never went"
        );
        note_lane_served(3);
        assert_eq!(lane_rotation(&lanes), vec![2, 1, 3]);
        note_lane_served(2);
        assert_eq!(
            lane_rotation(&lanes),
            vec![1, 3, 2],
            "served order 1,3,2 is now the rotation, oldest first"
        );
        assert!(served_tick_of(2) > served_tick_of(3));
        assert_eq!(served_tick_of(8), 0, "a lane never served has no tick");
    }

    #[test]
    fn the_rotation_only_names_lanes_that_are_present() {
        let _guard = rotation_guard();
        note_lane_served(5);
        assert_eq!(lane_rotation(&[Some(2), None, Some(2)]), vec![2]);
        assert!(lane_rotation(&[None, None]).is_empty());
    }
}
