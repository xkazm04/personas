//! Synthetic sources for the POLL-DRIVEN half of the Monitor's load.
//!
//! The event half of the harness (`load_harness`) was the easy half: fleet
//! output and lifecycle flips are pushed, so a generator can emit them through
//! `app.emit` and the real transport carries them. The operator's actual peak is
//! not shaped like that. It is *"20 projects x 5 personas with autonomous life,
//! output as chat messages and reviews for triage"* — and both of those reach
//! the frontend by POLLING A DATABASE, not by event.
//!
//! ## The constraint that shaped this file
//!
//! The harness will not write rows into a real database. That was true when the
//! event generator was written and it is still true: a load run must not leave
//! residue in the operator's own channels or review queue, and a test that
//! requires a throwaway database is a test nobody runs against the app they
//! actually use.
//!
//! So the synthetic rows live HERE, in process memory, and are merged into the
//! two read commands at their return. Concretely: `list_team_channel` and
//! `list_manual_reviews` are both thin adapters (auth, then one read-model
//! call), and each gains a hook that splices this module's rows into the result.
//!
//! ## Why this is honest, and where it is not
//!
//! It IS the real path from the hook onward: real IPC command, real serialization,
//! real poll cadence, real store write, real subscriber fan-out, real render. The
//! frontend cannot tell these rows from database rows, which is the entire point
//! — a generator the UI can distinguish is measuring a different code path than
//! the one that will be under load.
//!
//! It is NOT the real path *before* the hook: no SQLite read, no query planning,
//! no disk. So a run using these sources measures **everything above the
//! database** and understates the backend's own cost. That is the correct trade
//! for deciding a RENDERER question — the thing under test is what happens to
//! 400 rows after they arrive — and it is the wrong instrument for deciding a
//! query question. Stated here so the number is never read as more than it is.
//!
//! ## What is gated, precisely
//!
//! THE HOOKS are compile-gated on `test-automation`, so the two lines that can
//! splice a synthetic row into a channel or a review queue do not exist in a
//! shipped binary — not "are disabled at runtime", do not exist.
//!
//! THIS MODULE is not gated, and that is deliberate rather than sloppy: it is
//! called unconditionally from `load_harness`, whose own gating had to be
//! removed in fe48e30e6 because `test_automation` registers the `/load/*`
//! routes unconditionally and `--features desktop` therefore stopped compiling.
//! Ungated-module + gated-hooks keeps every build compiling while preserving the
//! property that actually matters: with no feature, nothing can reach the
//! generated rows, and `channel_overlay`/`review_overlay` are dead code (marked
//! as such) rather than a live injection path.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::db::models::{ManualReviewStatus, PersonaManualReview};

use crate::commands::teams::team_channel::TeamChannelItem;

/// Per-team cap on retained synthetic messages. A run at 20 msgs/sec for ten
/// minutes would otherwise accumulate 12,000 rows per team and start measuring
/// this module's own allocator. The frontend's own merge window is 600.
const MAX_PER_TEAM: usize = 2_000;

/// Marks every synthetic row. Nothing keys behaviour off it — it exists so that
/// a human staring at a suspicious row in the UI, or at a bug report screenshot,
/// can tell in one glance that they are looking at generated traffic.
const SYNTH_PREFIX: &str = "loadgen-msg-";
const SYNTH_REVIEW_PREFIX: &str = "loadgen-rev-";

struct Sources {
    /// team_id -> synthetic messages, OLDEST FIRST (the read flips it).
    channels: Mutex<HashMap<String, Vec<TeamChannelItem>>>,
    reviews: Mutex<Vec<PersonaManualReview>>,
    /// Teams the app has actually asked about.
    ///
    /// Learned from the query rather than configured, and that is deliberate:
    /// the harness has no way to know the operator's real team ids, and asking
    /// the runner to pass them would make a run silently produce nothing the
    /// day a team is renamed. The first poll for a team returns real rows only
    /// and registers it; every tick after that can generate for it.
    known_teams: Mutex<Vec<String>>,
    /// Persona ids to attribute synthetic rows to. Supplied by the runner from
    /// the app's own state, so rows resolve to real names and colours in the UI
    /// instead of rendering as anonymous.
    persona_ids: Mutex<Vec<String>>,
    seq: AtomicU64,
    /// Rows served through the two hooks. The runner reads this to prove the
    /// synthetic load actually reached the frontend rather than assuming it.
    served_channel: AtomicUsize,
    served_reviews: AtomicUsize,
}

static SOURCES: OnceLock<Sources> = OnceLock::new();

fn sources() -> &'static Sources {
    SOURCES.get_or_init(|| Sources {
        channels: Mutex::new(HashMap::new()),
        reviews: Mutex::new(Vec::new()),
        known_teams: Mutex::new(Vec::new()),
        persona_ids: Mutex::new(Vec::new()),
        seq: AtomicU64::new(0),
        served_channel: AtomicUsize::new(0),
        served_reviews: AtomicUsize::new(0),
    })
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // A poisoned lock here is a cache, not an invariant: the harness would
    // rather serve slightly stale synthetic rows than take the app down mid-run.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_rfc3339() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ---------------------------------------------------------------------------
// Configuration, called from the generator
// ---------------------------------------------------------------------------

pub fn set_persona_ids(ids: Vec<String>) {
    *lock(&sources().persona_ids) = ids;
}

/// The teams the generator may produce chatter for.
pub fn known_teams() -> Vec<String> {
    lock(&sources().known_teams).clone()
}

/// Remove every synthetic row and forget the learned teams.
pub fn clear() {
    lock(&sources().channels).clear();
    lock(&sources().reviews).clear();
    lock(&sources().known_teams).clear();
    sources().served_channel.store(0, Ordering::Relaxed);
    sources().served_reviews.store(0, Ordering::Relaxed);
}

/// `(channel rows served, review rows served)` since the last `clear`.
pub fn served() -> (usize, usize) {
    (
        sources().served_channel.load(Ordering::Relaxed),
        sources().served_reviews.load(Ordering::Relaxed),
    )
}

/// Total synthetic rows currently held, for the status readout.
pub fn held() -> (usize, usize) {
    let ch = lock(&sources().channels).values().map(Vec::len).sum();
    let rv = lock(&sources().reviews).len();
    (ch, rv)
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const CHATTER: [&str; 8] = [
    "Picked up the failing contract test — the fixture drifted from the schema.",
    "Draft is ready for review; I kept the migration reversible.",
    "Blocked on a credential scope. Requesting the human gate.",
    "Rolled the retry budget back to 3; the 5th attempt never once succeeded.",
    "Handing off: the API surface is stable, the docs are not.",
    "Found the regression — it predates this branch by two commits.",
    "Shipped. Watching the error rate for the next ten minutes.",
    "This needs a decision I should not make alone.",
];

/// Append `n` chat messages, spread across the teams the app has asked about.
///
/// Returns how many were actually written — zero until the frontend has polled
/// at least one team, which is a real and visible state rather than a silent
/// no-op (the runner reports `heldChannel` so a run that generated nothing
/// cannot be mistaken for a run the UI absorbed).
pub fn push_messages(n: usize, rand: &mut impl FnMut() -> u64) -> usize {
    let teams = known_teams();
    if teams.is_empty() || n == 0 {
        return 0;
    }
    let personas = lock(&sources().persona_ids).clone();
    let at = now_rfc3339();
    let mut map = lock(&sources().channels);
    let mut written = 0usize;
    for _ in 0..n {
        let r = rand();
        let team = &teams[(r as usize) % teams.len()];
        let seq = sources().seq.fetch_add(1, Ordering::Relaxed);
        let persona = if personas.is_empty() {
            None
        } else {
            Some(personas[(r >> 8) as usize % personas.len()].clone())
        };
        let item = TeamChannelItem {
            id: format!("{SYNTH_PREFIX}{seq:08}"),
            kind: "persona".to_string(),
            at: at.clone(),
            persona_id: persona,
            label: "message".to_string(),
            body: Some(CHATTER[(r >> 16) as usize % CHATTER.len()].to_string()),
            assignment_id: None,
            step_id: None,
            extra: None,
            reply_to: None,
            deliberation_id: None,
            importance: None,
            consumers: None,
        };
        let bucket = map.entry(team.clone()).or_default();
        bucket.push(item);
        if bucket.len() > MAX_PER_TEAM {
            let over = bucket.len() - MAX_PER_TEAM;
            bucket.drain(0..over);
        }
        written += 1;
    }
    written
}

const REVIEW_TITLES: [&str; 6] = [
    "Approve the schema migration before it runs against prod",
    "Persona wants to widen a credential scope",
    "Retry budget exhausted — approve a manual re-run?",
    "Draft response needs a human read before it goes out",
    "Two personas disagree on the rollout order",
    "Confirm this deletion is intended",
];
const SEVERITIES: [&str; 3] = ["info", "warning", "critical"];

/// Hold exactly `target` synthetic pending reviews. Idempotent: raising the
/// number appends, lowering it truncates, so a ramp step does not churn the
/// whole queue and reset every unread watermark the UI is holding.
pub fn set_reviews(target: usize, rand: &mut impl FnMut() -> u64) {
    let personas = lock(&sources().persona_ids).clone();
    let mut rows = lock(&sources().reviews);
    if rows.len() > target {
        rows.truncate(target);
        return;
    }
    let at = now_rfc3339();
    while rows.len() < target {
        let r = rand();
        let seq = sources().seq.fetch_add(1, Ordering::Relaxed);
        rows.push(PersonaManualReview {
            id: format!("{SYNTH_REVIEW_PREFIX}{seq:08}"),
            execution_id: format!("loadgen-exec-{seq:08}"),
            persona_id: personas
                .get((r as usize) % personas.len().max(1))
                .cloned()
                .unwrap_or_else(|| "loadgen-persona".to_string()),
            title: REVIEW_TITLES[(r >> 8) as usize % REVIEW_TITLES.len()].to_string(),
            description: Some(
                "Generated by the load harness. Deciding it resolves nothing real.".to_string(),
            ),
            severity: SEVERITIES[(r >> 16) as usize % SEVERITIES.len()].to_string(),
            context_data: None,
            suggested_actions: None,
            status: ManualReviewStatus::Pending,
            reviewer_notes: None,
            resolved_at: None,
            created_at: at.clone(),
            updated_at: at.clone(),
            use_case_id: None,
            assignment_id: None,
            step_id: None,
        });
    }
}

// ---------------------------------------------------------------------------
// The two read hooks
// ---------------------------------------------------------------------------

/// Synthetic messages for one channel poll, newest first.
///
/// Honours `before` (the cursor) and the lens filter, because the frontend pages
/// this list and a source that ignored the cursor would hand the same rows back
/// forever — the reader would scroll and never move, which is a far more
/// confusing artefact than no synthetic rows at all.
// Reached ONLY from the feature-gated hook in `commands::teams::team_channel`,
// so without `test-automation` it is legitimately dead — which is the point.
#[cfg_attr(not(feature = "test-automation"), allow(dead_code))]
pub fn channel_overlay(
    team_id: &str,
    limit: i64,
    before: Option<&str>,
    kinds: Option<&[String]>,
) -> Vec<TeamChannelItem> {
    // Register the team on every poll, not just the first: the workspace can
    // add one mid-run.
    {
        let mut known = lock(&sources().known_teams);
        if !known.iter().any(|t| t == team_id) {
            known.push(team_id.to_string());
        }
    }
    // These are chat messages, so they belong to the `message` lens only. A
    // step- or memory-lensed read must not see them, or the Monitor's
    // deliberation and memory views would fill with chatter that is not there.
    if let Some(k) = kinds {
        if !k.iter().any(|s| s == "message") {
            return Vec::new();
        }
    }
    let map = lock(&sources().channels);
    let Some(bucket) = map.get(team_id) else {
        return Vec::new();
    };
    let mut out: Vec<TeamChannelItem> = bucket
        .iter()
        .rev()
        .filter(|i| before.is_none_or(|c| i.at.as_str() < c))
        .take(limit.max(0) as usize)
        .cloned()
        .collect();
    sources()
        .served_channel
        .fetch_add(out.len(), Ordering::Relaxed);
    out.shrink_to_fit();
    out
}

/// Synthetic pending reviews for one review poll.
///
/// Only ever added to a PENDING read. A caller asking for approved or rejected
/// rows is reconciling history, and answering that with rows that were never
/// decided would corrupt the very counts the surface exists to report.
// Reached ONLY from the feature-gated hook in `commands::design::reviews`.
#[cfg_attr(not(feature = "test-automation"), allow(dead_code))]
pub fn review_overlay(status: Option<&str>) -> Vec<PersonaManualReview> {
    if !matches!(status, None | Some("pending")) {
        return Vec::new();
    }
    let rows = lock(&sources().reviews).clone();
    sources()
        .served_reviews
        .fetch_add(rows.len(), Ordering::Relaxed);
    rows
}
