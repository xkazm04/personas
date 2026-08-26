//! Unattended (overnight) dispatch vocabulary — the two halves of "a night
//! that dispatches must be able to dispatch again tomorrow".
//!
//! Both halves exist because of one observed failure (bench sweep #18,
//! 2026-08-25): an App-master night refused its dispatch with *"no free fleet
//! live slots tonight"* while the fleet was doing nothing. The in-memory
//! registry held an `ascent` session parked `awaiting_input` for days, a
//! previous bench-dispatched worker parked `awaiting_input` because it ended
//! its turn with a question nobody can answer in headless mode, one genuinely
//! `running` session and a few finished-but-not-exited rows. Every one of
//! those counted against the four-slot unattended budget, and the soft-cap
//! sweeper deliberately never evicts `AwaitingInput`, so the parked tickets
//! would have starved every future night.
//!
//! - **The behavioural half** — [`UNATTENDED_DISPATCH_GUARDRAILS`] tells the
//!   dispatched worker outright that nobody is there: finish, never ask.
//! - **The structural half** — an overnight-spawned session is *tagged*
//!   ([`overnight_run_label`] / [`is_overnight_run`]) so the fleet sweeper can
//!   treat `awaiting_input` on it as terminal, and the night's own slot
//!   arithmetic ([`holds_overnight_slot`]) stops counting a parked ticket as
//!   live work.
//!
//! Everything here is pure and lives in `personas-engine` rather than beside
//! its call sites in `app_lib` so it is actually reachable by `cargo test`.

// ============================================================================
// The behavioural half — the prompt block
// ============================================================================

/// Guardrail block appended to every UNATTENDED fleet dispatch prompt (the
/// Overnight Portfolio Engine is the only caller that sets `unattended`).
///
/// Rules 1–4 are the original branch-only safety contract: overnight work
/// never touches a repo's default branch. Rules 5–6 are the finish-don't-ask
/// contract — without them a worker that hits an ambiguity politely asks and
/// then sits in `awaiting_input` until a human arrives, which at 03:00 means
/// forever, and which (before the slot rule below) also cost the next night a
/// fleet slot.
pub const UNATTENDED_DISPATCH_GUARDRAILS: &str = "\
--- Unattended dispatch guardrails (Overnight Portfolio Engine) ---\n\
You are running UNATTENDED overnight. Hard rules:\n\
1. NEVER commit to the repository's default branch (main/master). Create and \
work on a dedicated branch named `autopilot/<short-slug>` before changing any file.\n\
2. Do NOT push, do NOT merge, do NOT open pull requests. Your branch is \
reviewed by a human in the morning.\n\
3. Do NOT run destructive commands (force-push, reset --hard on shared \
branches, deletions outside your change scope).\n\
4. If the fix requires a decision you cannot verify from the evidence, stop \
and summarize instead of guessing.\n\
5. NOBODY IS THERE. This session is headless and unattended: no human and no \
orchestrator will read a question tonight. NEVER end your turn with a \
question, an options list, or a request for confirmation or permission. A \
turn that ends in a question parks this session until a human arrives and \
delivers nothing.\n\
6. Blocked is a RESULT, not a wait. If you cannot proceed, leave the branch in \
a reviewable state, state the blocker in one line — `FLEET:BLOCKED — <what \
you need and who can decide it>` — and END THE TURN. Do not ask for the \
missing input; the morning human reads your line and decides.\n\
When done, end your final message with `FLEET:DONE — <one-line summary>` (or \
the `FLEET:BLOCKED` line from rule 6). Either way, finish the turn.";

/// Compose the full task text a headless unattended worker is seeded with.
pub fn unattended_task_text(prompt: &str) -> String {
    format!(
        "{}\n\n{}",
        prompt.trim_end(),
        UNATTENDED_DISPATCH_GUARDRAILS
    )
}

// ============================================================================
// The structural half — tagging an overnight-spawned session
// ============================================================================

/// Sentinel prefix stamped into a fleet session's `run_label` when the
/// Overnight Portfolio Engine spawns it. The fleet already carries
/// `run_id`/`run_label` on every session (`commands::fleet::run`), so the tag
/// costs no new column, no new registry field and no new persistence path —
/// and it survives a restart because the label is persisted with the row.
///
/// The colon is load-bearing: it keeps a human run someone names "overnight
/// cleanup" from being swept as a machine-dispatched one.
pub const OVERNIGHT_RUN_LABEL_PREFIX: &str = "overnight:";

/// The run label an overnight dispatch opens for one project's night.
pub fn overnight_run_label(project_name: &str) -> String {
    let name = project_name.trim();
    if name.is_empty() {
        OVERNIGHT_RUN_LABEL_PREFIX.to_string()
    } else {
        format!("{OVERNIGHT_RUN_LABEL_PREFIX} {name}")
    }
}

/// True when a fleet session's `run_label` says the Overnight Portfolio
/// Engine spawned it — i.e. there is provably no operator behind it.
pub fn is_overnight_run(run_label: Option<&str>) -> bool {
    run_label
        .map(|l| l.trim_start().starts_with(OVERNIGHT_RUN_LABEL_PREFIX))
        .unwrap_or(false)
}

/// How long an overnight-tagged session may sit in `awaiting_input` before
/// both the sweeper and the slot arithmetic accept that nobody is coming.
///
/// 30 minutes rather than the fleet's 6-minute staleness cutoff: those two
/// cutoffs answer different questions. Staleness asks "is this process still
/// producing output" (a fast, reversible judgement); this asks "is anyone
/// going to answer this question" — and the honest answer for an unattended
/// spawn is *no*, at any age. The half hour exists only so that Athena, or an
/// operator who happens to be awake, keeps a real chance to answer first;
/// after it, silence is the answer.
pub const OVERNIGHT_AWAITING_SLOT_CUTOFF_SECS: i64 = 30 * 60;

/// Longest question text carried into a `state_reason`. The reason string
/// ships in events, the debug log and the durable `fleet_sessions` row.
const MAX_QUESTION_CHARS: usize = 200;

/// Marker opening a `state_reason` written by the unanswered-question sweep.
///
/// Deliberately NOT the `Task complete: ` prefix `mark_finished` writes: the
/// run harvest (`commands::fleet::run::summary_from_reason`) reads that prefix
/// as a *declared* `FLEET:DONE` summary, and a session that ended on a
/// question declared nothing. This reason reports what happened; it never
/// paraphrases an outcome the session did not claim.
pub const UNANSWERED_FINISH_PREFIX: &str = "Ended unattended: asked for input nobody could answer";

/// The `state_reason` for an overnight worker auto-finished on an unanswered
/// question. The question is preserved verbatim (truncated) so the morning
/// review can see exactly what was asked — it is never answered here.
pub fn unanswered_finish_reason(question: Option<&str>) -> String {
    match question.map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) => {
            let mut q: String = q.chars().take(MAX_QUESTION_CHARS).collect();
            if q.chars().count() < question.map(|s| s.trim().chars().count()).unwrap_or(0) {
                q.push('…');
            }
            format!("{UNANSWERED_FINISH_PREFIX} — {q}")
        }
        None => format!("{UNANSWERED_FINISH_PREFIX} (no question text captured)"),
    }
}

// ============================================================================
// Slot arithmetic for an unattended night
// ============================================================================

/// Fallback concurrent-session budget when the frontend has not pushed a
/// live-slot cap (cap 0 = "uncapped" for humans; unattended never is).
pub const FALLBACK_NIGHT_LIVE_CAP: u64 = 4;

/// Hard per-project-per-night dispatch cap — bounds the unattended spend ramp
/// independently of fleet slots.
pub const MAX_DISPATCH_PER_PROJECT_PER_NIGHT: usize = 3;

/// Does a session in `state_token`, idle for `idle_ms`, hold a fleet slot
/// **against an unattended dispatch**?
///
/// This is deliberately a different question from the production soft cap
/// (`commands::fleet::stale::live_slot_evictions`), which asks "may I evict
/// this to make room" and answers *never* for `AwaitingInput` — evicting a
/// session a human is mid-answer on would lose work. That rule is correct and
/// is untouched. But "must not be evicted" is not the same claim as "is doing
/// live work", and the night was reading the first as the second.
///
/// - `running` / `spawning` — genuinely live work. Occupies, always.
/// - `awaiting_input` — occupies only while the question is *fresh*. Past
///   [`OVERNIGHT_AWAITING_SLOT_CUTOFF_SECS`] it is a parked ticket, and since
///   the soft-cap sweeper never evicts it, counting it would let one
///   unanswered question starve every future night. (The companion sweep
///   finishes overnight-tagged ones outright; this rule also covers the
///   *human* session parked days ago, which nothing may touch but which is
///   not work either.)
/// - `idle` / `stale` — resting with a resumable transcript. These are exactly
///   what `free_slot_for_spawn` hibernates before a spawn, so they yield their
///   slot mechanically rather than blocking the dispatch.
/// - `finished` — declared its task complete. Orchestration and the
///   limit-retry lane already leave it alone; it is a row awaiting disposal.
/// - `hibernated` / `exited` — no process at all.
///
/// An unknown token (a state written by a newer build) counts as occupied:
/// over-counting costs a night one dispatch, under-counting spends money.
pub fn holds_overnight_slot(state_token: &str, idle_ms: i64, awaiting_cutoff_ms: i64) -> bool {
    match state_token {
        "running" | "spawning" => true,
        "awaiting_input" => idle_ms < awaiting_cutoff_ms,
        "idle" | "stale" | "finished" | "hibernated" | "exited" => false,
        _ => true,
    }
}

/// Fleet occupancy as an unattended night must count it: the number of
/// sessions that [`holds_overnight_slot`] says are genuinely holding a slot.
/// `sessions` yields `(state_token, idle_ms)` pairs.
pub fn overnight_live_occupancy<'a, I>(sessions: I, awaiting_cutoff_ms: i64) -> u64
where
    I: IntoIterator<Item = (&'a str, i64)>,
{
    sessions
        .into_iter()
        .filter(|(token, idle_ms)| holds_overnight_slot(token, *idle_ms, awaiting_cutoff_ms))
        .count() as u64
}

/// How many sessions the night may actually spawn: bounded by free fleet
/// slots (cap − occupancy, with the unattended fallback when the cap is
/// unset) AND the per-project nightly maximum AND how many ideas want
/// dispatching.
pub fn dispatch_capacity(live_slot_cap: u64, live_sessions: u64, want: usize) -> usize {
    let cap = if live_slot_cap == 0 {
        FALLBACK_NIGHT_LIVE_CAP
    } else {
        live_slot_cap
    };
    let free = cap.saturating_sub(live_sessions) as usize;
    want.min(free).min(MAX_DISPATCH_PER_PROJECT_PER_NIGHT)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CUTOFF_MS: i64 = OVERNIGHT_AWAITING_SLOT_CUTOFF_SECS * 1000;
    const FRESH: i64 = 60 * 1000; // asked a minute ago
    const OLD: i64 = 3 * 60 * 60 * 1000; // asked three hours ago

    // -- the behavioural half -------------------------------------------------

    #[test]
    fn unattended_prompt_forbids_ending_on_a_question() {
        let g = UNATTENDED_DISPATCH_GUARDRAILS;
        // The branch-only contract survives intact.
        assert!(g.contains("NEVER commit to the repository's default branch"));
        assert!(g.contains("Do NOT push"));
        // …and the finish-don't-ask contract is present, in both directions.
        assert!(g.contains("NOBODY IS THERE"));
        assert!(g.contains("NEVER end your turn with a question"));
        assert!(g.contains("FLEET:BLOCKED"));
        assert!(g.contains("END THE TURN"));
        assert!(g.contains("FLEET:DONE"));
    }

    #[test]
    fn dispatched_worker_task_text_carries_the_block() {
        let text = unattended_task_text("Fix the flaky retry test.");
        assert!(text.starts_with("Fix the flaky retry test."));
        assert!(text.contains(UNATTENDED_DISPATCH_GUARDRAILS));
        assert!(text.contains("NEVER end your turn with a question"));
    }

    // -- the structural half --------------------------------------------------

    #[test]
    fn overnight_sessions_are_tagged_and_only_they_match() {
        let label = overnight_run_label("kp");
        assert_eq!(label, "overnight: kp");
        assert!(is_overnight_run(Some(&label)));
        assert!(is_overnight_run(Some(&overnight_run_label("  "))));
        // An operator's own run is never swept as machine-dispatched.
        assert!(!is_overnight_run(Some("overnight cleanup")));
        assert!(!is_overnight_run(Some("perfect round 9")));
        assert!(!is_overnight_run(None));
    }

    #[test]
    fn the_finish_reason_never_claims_a_completion() {
        let r = unanswered_finish_reason(Some("Should I bump the minor or the major version?"));
        assert!(r.starts_with(UNANSWERED_FINISH_PREFIX));
        assert!(r.contains("bump the minor or the major version"));
        // The run harvest reads ONLY `Task complete: ` as a declared summary —
        // an auto-finished session must not look like one that declared done.
        assert!(!r.starts_with("Task complete: "));
        assert!(!r.contains("Task complete: "));
        // No question captured is said, not invented.
        assert!(unanswered_finish_reason(None).contains("no question text captured"));
        assert!(unanswered_finish_reason(Some("   ")).contains("no question text captured"));
        // Long questions are bounded, and say that they were cut.
        let long = "x".repeat(500);
        let r = unanswered_finish_reason(Some(&long));
        assert!(r.chars().count() < 300);
        assert!(r.ends_with('…'));
    }

    // -- slot arithmetic ------------------------------------------------------

    #[test]
    fn only_genuinely_live_work_holds_an_overnight_slot() {
        assert!(holds_overnight_slot("running", OLD, CUTOFF_MS));
        assert!(holds_overnight_slot("spawning", OLD, CUTOFF_MS));
        // A question asked a minute ago may still be answered.
        assert!(holds_overnight_slot("awaiting_input", FRESH, CUTOFF_MS));
        // One asked hours ago is a parked ticket, not work.
        assert!(!holds_overnight_slot("awaiting_input", OLD, CUTOFF_MS));
        // Exactly at the cutoff it has already lapsed.
        assert!(!holds_overnight_slot(
            "awaiting_input",
            CUTOFF_MS,
            CUTOFF_MS
        ));
        // Resting / terminal rows do not block a dispatch.
        for token in ["idle", "stale", "finished", "hibernated", "exited"] {
            assert!(!holds_overnight_slot(token, FRESH, CUTOFF_MS), "{token}");
        }
        // An unknown state counts, so a newer build cannot cause overspend.
        assert!(holds_overnight_slot("teleporting", FRESH, CUTOFF_MS));
    }

    #[test]
    fn occupancy_ignores_stale_awaiting_input_sessions() {
        // The exact registry population from bench sweep #18.
        let fleet = [
            ("awaiting_input", OLD),   // `ascent`, parked for days
            ("awaiting_input", OLD),   // bench worker that ended on a question
            ("running", 5_000),        // one genuinely working kp session
            ("finished", 10 * 60_000), // finished-but-not-exited
            ("idle", 40 * 60_000),
        ];
        assert_eq!(overnight_live_occupancy(fleet, CUTOFF_MS), 1);
        // Before the rule, all five counted and the night refused.
        assert_eq!(dispatch_capacity(0, 5, 3), 0);
        // After it, the same night dispatches its full per-project allowance.
        assert_eq!(
            dispatch_capacity(0, overnight_live_occupancy(fleet, CUTOFF_MS), 3),
            3
        );
    }

    #[test]
    fn a_busy_fleet_still_bounds_the_night() {
        // Four genuinely running sessions fill the unattended fallback cap.
        let busy = [
            ("running", 1_000),
            ("running", 1_000),
            ("spawning", 0),
            ("running", 1_000),
        ];
        assert_eq!(overnight_live_occupancy(busy, CUTOFF_MS), 4);
        assert_eq!(dispatch_capacity(0, 4, 3), 0);
        // And a fresh question does hold its slot while it is fresh.
        let mixed = [("running", 1_000), ("awaiting_input", FRESH)];
        assert_eq!(overnight_live_occupancy(mixed, CUTOFF_MS), 2);
        assert_eq!(dispatch_capacity(0, 2, 3), 2);
    }

    #[test]
    fn dispatch_capacity_is_min_of_all_bounds() {
        // Free slots bound it.
        assert_eq!(dispatch_capacity(10, 9, 5), 1);
        // Fleet full → zero.
        assert_eq!(dispatch_capacity(4, 4, 5), 0);
        assert_eq!(dispatch_capacity(4, 9, 5), 0);
        // The per-night cap bounds it even with a huge fleet.
        assert_eq!(
            dispatch_capacity(100, 0, 50),
            MAX_DISPATCH_PER_PROJECT_PER_NIGHT
        );
        // Want bounds it.
        assert_eq!(dispatch_capacity(100, 0, 1), 1);
        // Cap 0 = frontend "uncapped" → unattended fallback applies.
        assert_eq!(
            dispatch_capacity(0, 0, 50),
            (FALLBACK_NIGHT_LIVE_CAP as usize).min(MAX_DISPATCH_PER_PROJECT_PER_NIGHT)
        );
        assert_eq!(dispatch_capacity(0, FALLBACK_NIGHT_LIVE_CAP, 5), 0);
    }
}
