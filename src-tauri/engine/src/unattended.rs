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
//! The Overnight Portfolio Engine is no longer the only dispatcher with nobody
//! behind it. An **App Master** persona's attention loop spawns headless fleet
//! workers of exactly the same shape ([`app_master_run_label`] /
//! [`is_app_master_run`]), and on 2026-09-07 one of them ended its turn with
//! `FLEET:BLOCKED, backlog can't be drained by autopilot`, was parked
//! `awaiting_input`, and sat there for over an hour — the identical failure
//! sweep #18 recorded for the night, in a lane the night's tag could not see.
//! [`is_unattended_run`] is the predicate every "nobody is there to answer"
//! decision keys on now; `is_overnight_run` stays for the accounting that is
//! genuinely about a *night* (the ledger, the morning digest).
//!
//! - **The isolation half** — [`unattended_worktree_task_text`] is the variant
//!   for a worker that was *given* its branch in an isolated worktree
//!   ([`crate::unattended_worktree`]) instead of being told to go and make one
//!   in the operator's checkout. Sweep #23 (2026-08-26) is why: a worker
//!   obeyed rule 1 literally, ran `git checkout -b` in the shared tree, and
//!   left the operator's working copy and dev server on the agent's branch.
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

/// Rule 1 of [`UNATTENDED_DISPATCH_GUARDRAILS`] verbatim — the instruction to
/// go and make a branch, which is only safe in a checkout nobody else is
/// standing in.
///
/// It is a separate const so the worktree variant can replace exactly this
/// rule and inherit every other one; `the_two_guardrail_variants_share_one_tail`
/// fails the moment the two texts drift apart.
const RULE_1_MAKE_A_BRANCH: &str = "1. NEVER commit to the repository's default \
branch (main/master). Create and work on a dedicated branch named \
`autopilot/<short-slug>` before changing any file.\n";

/// Rule 1 for a worker that was **given** its branch, already checked out in
/// an isolated worktree.
///
/// The original rule 1 is a correct instruction and a dangerous one: an agent
/// obeying it in a shared checkout runs `git checkout -b` there, and a branch
/// switch is a whole-checkout event. Bench sweep #23 (2026-08-26) left an
/// operator's tree — and the `next dev` server running against it — sitting on
/// the agent's branch for the rest of the night. So the branch is created
/// *for* the worker now, and the rule that used to ask for one forbids the
/// command that would move anybody.
pub fn worktree_branch_rule(branch: &str, worktree_path: &str) -> String {
    format!(
        "1. You are ALREADY on branch `{branch}`, checked out in an ISOLATED git \
worktree at `{worktree_path}`, which is yours alone. Work and commit HERE. \
NEVER run `git checkout`, `git switch`, `git branch -m`, `git worktree add` or \
`git worktree remove`, and never `cd` out of this directory: the operator's own \
checkout shares this repository and a branch switch would move it under a human \
who is working in it. The dependency directories here (`node_modules`, `.venv`, \
`target`, …) are LINKS to that operator's real ones — use them, never install, \
upgrade or delete into them.\n"
    )
}

/// The guardrail block for a worker authoring in an isolated worktree: every
/// rule of [`UNATTENDED_DISPATCH_GUARDRAILS`] except rule 1, which becomes
/// [`worktree_branch_rule`].
pub fn unattended_worktree_guardrails(branch: &str, worktree_path: &str) -> String {
    UNATTENDED_DISPATCH_GUARDRAILS.replacen(
        RULE_1_MAKE_A_BRANCH,
        &worktree_branch_rule(branch, worktree_path),
        1,
    )
}

// ----------------------------------------------------------------------------
// The mandate half — a worker whose scope rung permits shipping
// ----------------------------------------------------------------------------

/// Rule 2 of [`UNATTENDED_DISPATCH_GUARDRAILS`] verbatim — the never-ship rule.
///
/// A separate const for the same reason [`RULE_1_MAKE_A_BRANCH`] is one: the
/// rung-aware variant replaces exactly this rule and inherits every other, and
/// `the_rung_variants_share_one_tail` fails the moment the two texts drift.
const RULE_2_NEVER_SHIP: &str = "2. Do NOT push, do NOT merge, do NOT open pull \
requests. Your branch is reviewed by a human in the morning.\n";

/// The App Master scope rung ([`crate::app_master::RUNG_BRANCH`]) at which a
/// worker may open a branch and a pull request on its own authority.
///
/// Duplicated as a plain integer rather than imported so this module stays the
/// pure prompt vocabulary it has always been; `the_pr_rung_matches_the_mandate`
/// pins the two together.
pub const RUNG_MAY_OPEN_PR: u8 = 2;

/// Rule 2 for a worker dispatched at [`RUNG_MAY_OPEN_PR`] or above.
///
/// The never-ship rule was written for the Overnight Portfolio Engine, whose
/// workers are anonymous fixes nobody asked for; an App Master at rung 2 holds
/// a mandate that explicitly permits "open branch/PR" and forbids only the
/// merge. Measured 2026-09-07: three delivery workers committed on their
/// branches and none pushed or opened a PR — obeying the prompt, which
/// contradicted the mandate and won, because it is the prompt.
///
/// The ceiling does not move: merge, a push to the default branch, branch
/// protection and CI stay forbidden here exactly as the mandate states them.
pub fn worktree_ship_rule(branch: &str, gh_authenticated: bool) -> String {
    let mut s = format!(
        "2. You MAY push your branch `{branch}` to the origin and open a pull \
request against the default branch with `gh pr create` (title, body with the \
checklist and evidence, base = default branch) when `gh` is authenticated; you \
may NOT merge, may NOT push to the default branch, may NOT change branch \
protection or CI. If `gh` is not authenticated, leave the branch ready and say \
so.\n"
    );
    if !gh_authenticated {
        s.push_str(
            "   `gh` is NOT authenticated on this machine — this was checked at \
dispatch, so do not spend a turn discovering it. Commit, leave the branch ready \
for review, and say in your final line that the PR was not opened.\n",
        );
    }
    s
}

/// [`unattended_worktree_guardrails`] with rule 2 decided by the dispatching
/// charter's scope rung. Below [`RUNG_MAY_OPEN_PR`] the text is byte-identical
/// to the rung-less variant.
pub fn unattended_worktree_guardrails_at_rung(
    branch: &str,
    worktree_path: &str,
    rung: u8,
    gh_authenticated: bool,
) -> String {
    let base = unattended_worktree_guardrails(branch, worktree_path);
    if rung < RUNG_MAY_OPEN_PR {
        return base;
    }
    base.replacen(
        RULE_2_NEVER_SHIP,
        &worktree_ship_rule(branch, gh_authenticated),
        1,
    )
}

/// Compose the full task text a headless unattended worker is seeded with.
pub fn unattended_task_text(prompt: &str) -> String {
    format!(
        "{}\n\n{}",
        prompt.trim_end(),
        UNATTENDED_DISPATCH_GUARDRAILS
    )
}

/// [`unattended_task_text`] for a worker spawned with its `cwd` inside a
/// prepared authoring worktree (`crate::unattended_worktree`).
pub fn unattended_worktree_task_text(prompt: &str, branch: &str, worktree_path: &str) -> String {
    format!(
        "{}\n\n{}",
        prompt.trim_end(),
        unattended_worktree_guardrails(branch, worktree_path)
    )
}

/// [`unattended_worktree_task_text`] for a worker dispatched under a scope
/// rung — the App Master's code-charter lane.
///
/// Below [`RUNG_MAY_OPEN_PR`] this is byte-identical to
/// [`unattended_worktree_task_text`] (pinned by
/// `a_low_rung_worker_reads_exactly_the_legacy_text`). At or above it, rule 2
/// becomes [`worktree_ship_rule`] so the prompt stops contradicting the
/// mandate the persona was hired under.
pub fn unattended_worktree_task_text_at_rung(
    prompt: &str,
    branch: &str,
    worktree_path: &str,
    rung: u8,
    gh_authenticated: bool,
) -> String {
    format!(
        "{}\n\n{}",
        prompt.trim_end(),
        unattended_worktree_guardrails_at_rung(branch, worktree_path, rung, gh_authenticated)
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

/// Sentinel prefix stamped into a fleet session's `run_label` when an App
/// Master persona's decide lane dispatches a headless worker into an isolated
/// authoring worktree (`attention::run_decision_lane`).
///
/// The colon carries the same weight it does in [`OVERNIGHT_RUN_LABEL_PREFIX`]:
/// it keeps a human run somebody named "app master notes" from being swept as a
/// machine dispatch.
pub const APP_MASTER_RUN_LABEL_PREFIX: &str = "app-master:";

/// The run label an App Master persona's wake opens for its dispatch burst.
///
/// No space after the colon — the persona id is the entire tail. The shape is
/// the dispatcher's, not this module's invention; it is written down here so
/// the tag and the predicate that reads it cannot drift, which is exactly how
/// the App Master lane ended up invisible to a sweeper written for the night.
pub fn app_master_run_label(persona_id: &str) -> String {
    format!("{APP_MASTER_RUN_LABEL_PREFIX}{}", persona_id.trim())
}

/// True when a fleet session's `run_label` says an App Master persona's
/// attention loop spawned it — headless, in a worktree of its own, with no
/// operator behind it.
pub fn is_app_master_run(run_label: Option<&str>) -> bool {
    run_label
        .map(|l| l.trim_start().starts_with(APP_MASTER_RUN_LABEL_PREFIX))
        .unwrap_or(false)
}

/// True when **nobody is there to answer** this session: a machine dispatched
/// it, either as the Overnight Portfolio Engine's night work or as an App
/// Master wake's charter.
///
/// This is the predicate for every sweeper and slot decision whose reasoning is
/// "a question asked here reaches an empty room". Decisions that are genuinely
/// about a *night* — the night ledger, the morning digest, the per-project
/// nightly dispatch cap — stay on [`is_overnight_run`], because widening those
/// would make an App Master wake spend the night's budget.
pub fn is_unattended_run(run_label: Option<&str>) -> bool {
    is_overnight_run(run_label) || is_app_master_run(run_label)
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

/// How long an APP MASTER-tagged session may sit in `awaiting_input` before the
/// sweeper accepts that nobody is coming.
///
/// Fifteen minutes, half the night's, and the halving is not a taste call — the
/// two cutoffs are sized by who might still arrive. The night's half hour buys
/// a window for Athena or an operator who happens to be awake at 03:00; a
/// persona's wake fires during the working day against a fleet the operator can
/// see, so anyone who was going to answer has already had their chance by the
/// time the ticker has run thirty times.
///
/// The cost of waiting longer is not symmetric either. An App Master persona
/// runs at `personas.max_concurrent` — normally **2** — and its next wake is
/// minutes away, so a parked worker is a large fraction of a small budget held
/// against a question that will never be answered. Measured 2026-09-07: one
/// `FLEET:BLOCKED` worker held a slot for over an hour. Fifteen minutes is
/// still long enough that a worker mid-permission-prompt (the one
/// `awaiting_input` a human really does resolve) is not swept out from under
/// the hand reaching for it.
pub const APP_MASTER_AWAITING_SLOT_CUTOFF_SECS: i64 = 15 * 60;

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
///   finishes unattended-tagged ones outright — overnight and App Master
///   alike, each on its own cutoff; this rule also covers the
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

    #[test]
    fn the_two_guardrail_variants_share_one_tail() {
        // The worktree variant is the shared block with rule 1 swapped. If the
        // literal in the big const is ever edited without editing
        // `RULE_1_MAKE_A_BRANCH`, the replace becomes a no-op and this fails —
        // which is the whole reason the rule is a separate const.
        assert!(UNATTENDED_DISPATCH_GUARDRAILS.contains(RULE_1_MAKE_A_BRANCH));
        let g = unattended_worktree_guardrails("autopilot/fix-a", "C:/data/worktrees/p/fix-a");
        assert_ne!(g, UNATTENDED_DISPATCH_GUARDRAILS);
        // Everything that is not rule 1 survives, verbatim.
        for rule in [
            "2. Do NOT push",
            "3. Do NOT run destructive commands",
            "4. If the fix requires a decision",
            "NOBODY IS THERE",
            "FLEET:BLOCKED",
            "FLEET:DONE",
        ] {
            assert!(g.contains(rule), "missing: {rule}");
        }
    }

    #[test]
    fn a_worktree_worker_is_told_it_already_has_its_branch_and_must_not_switch() {
        let g = unattended_worktree_guardrails("autopilot/fix-a", "C:/data/worktrees/p/fix-a");
        // The instruction that made an agent run `git checkout -b` in the
        // operator's own checkout (bench sweep #23) is GONE, not merely
        // qualified.
        assert!(!g.contains(RULE_1_MAKE_A_BRANCH));
        assert!(!g.contains("Create and work on a dedicated branch"));
        // …replaced by where it already is, and what it must never run.
        assert!(g.contains("ALREADY on branch `autopilot/fix-a`"));
        assert!(g.contains("C:/data/worktrees/p/fix-a"));
        assert!(g.contains("NEVER run `git checkout`"));
        assert!(g.contains("git switch"));
        // The borrowed environment is shared with the operator — say so.
        assert!(g.contains("never install"));

        let text = unattended_worktree_task_text(
            "Fix the flaky retry test.",
            "autopilot/fix-a",
            "C:/data/worktrees/p/fix-a",
        );
        assert!(text.starts_with("Fix the flaky retry test."));
        assert!(text.contains("ALREADY on branch"));
    }

    // -- the mandate half (scope rung) ---------------------------------------

    #[test]
    fn the_rung_variants_share_one_tail() {
        // Same contract as `the_two_guardrail_variants_share_one_tail`: if the
        // literal in the big const is edited without editing
        // `RULE_2_NEVER_SHIP`, the replace silently becomes a no-op and a
        // rung-2 worker would keep reading "do NOT open pull requests".
        assert!(UNATTENDED_DISPATCH_GUARDRAILS.contains(RULE_2_NEVER_SHIP));
        // And the shared const itself is UNTOUCHED — the Overnight Portfolio
        // Engine still dispatches anonymous fixes that may never ship.
        assert!(UNATTENDED_DISPATCH_GUARDRAILS.contains("do NOT open pull requests"));
        assert!(!UNATTENDED_DISPATCH_GUARDRAILS.contains("gh pr create"));
        assert!(!unattended_task_text("Fix it.").contains("gh pr create"));
    }

    #[test]
    fn the_pr_rung_matches_the_mandate() {
        // The engine's own ladder is the authority; this module carries the
        // number as a literal so it stays pure prompt vocabulary.
        assert_eq!(RUNG_MAY_OPEN_PR, crate::app_master::RUNG_BRANCH);
    }

    #[test]
    fn a_low_rung_worker_reads_exactly_the_legacy_text() {
        for rung in [0u8, 1] {
            for gh in [true, false] {
                assert_eq!(
                    unattended_worktree_task_text_at_rung(
                        "Fix the flaky retry test.",
                        "autopilot/fix-a",
                        "C:/data/worktrees/p/fix-a",
                        rung,
                        gh,
                    ),
                    unattended_worktree_task_text(
                        "Fix the flaky retry test.",
                        "autopilot/fix-a",
                        "C:/data/worktrees/p/fix-a",
                    ),
                    "rung {rung} / gh {gh} must be byte-identical to the legacy text"
                );
            }
        }
    }

    #[test]
    fn a_rung_two_worker_may_open_the_pull_request_but_never_merge() {
        let text = unattended_worktree_task_text_at_rung(
            "Deliver idea 297f6ba4.",
            "autopilot/deliver-297f6ba4",
            "C:/data/worktrees/p/deliver",
            RUNG_MAY_OPEN_PR,
            true,
        );
        assert!(text.starts_with("Deliver idea 297f6ba4."));
        // The instruction that made three delivery workers stop at a commit is
        // GONE, not merely qualified.
        assert!(!text.contains("do NOT open pull requests"));
        assert!(!text.contains("Do NOT push, do NOT merge"));
        // …replaced by the mandate's own ceiling.
        assert!(text.contains("gh pr create"));
        assert!(text.contains("push your branch `autopilot/deliver-297f6ba4`"));
        assert!(text.contains("may NOT merge"));
        assert!(text.contains("may NOT push to the default branch"));
        assert!(text.contains("branch protection"));
        // gh IS authenticated here — do not tell the worker otherwise.
        assert!(!text.contains("NOT authenticated on this machine"));
        // Rule 1 and everything after rule 2 survive untouched.
        for rule in [
            "ALREADY on branch `autopilot/deliver-297f6ba4`",
            "NEVER run `git checkout`",
            "3. Do NOT run destructive commands",
            "4. If the fix requires a decision",
            "NOBODY IS THERE",
            "FLEET:BLOCKED",
            "FLEET:DONE",
        ] {
            assert!(text.contains(rule), "missing: {rule}");
        }
    }

    #[test]
    fn an_unauthenticated_gh_is_stated_rather_than_discovered() {
        let text = unattended_worktree_task_text_at_rung(
            "Deliver idea 297f6ba4.",
            "autopilot/deliver-297f6ba4",
            "C:/data/worktrees/p/deliver",
            RUNG_MAY_OPEN_PR,
            false,
        );
        assert!(text.contains("`gh` is NOT authenticated on this machine"));
        assert!(text.contains("say in your final line that the PR was not opened"));
        // The permission itself is still stated — the rung did not change.
        assert!(text.contains("gh pr create"));
        assert!(text.contains("may NOT merge"));
        // A rung above 2 is not a lower ceiling: it reads the same rule.
        assert_eq!(
            unattended_worktree_guardrails_at_rung("b", "p", 9, false),
            unattended_worktree_guardrails_at_rung("b", "p", RUNG_MAY_OPEN_PR, false),
        );
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
    fn app_master_sessions_are_tagged_and_only_they_match() {
        let label = app_master_run_label("p-web-master");
        // The shape the dispatcher writes: no space, the persona id is the tail.
        assert_eq!(label, "app-master:p-web-master");
        assert!(is_app_master_run(Some(&label)));
        assert!(is_app_master_run(Some(&app_master_run_label(""))));
        // An operator's own run is never swept as machine-dispatched.
        assert!(!is_app_master_run(Some("app master notes")));
        assert!(!is_app_master_run(Some("perfect round 9")));
        assert!(!is_app_master_run(None));
        // The two tags do not bleed into each other.
        assert!(!is_overnight_run(Some(&label)));
        assert!(!is_app_master_run(Some(&overnight_run_label("kp"))));
    }

    #[test]
    fn an_unattended_run_is_either_dispatcher_and_nothing_else() {
        assert!(is_unattended_run(Some(&overnight_run_label("kp"))));
        assert!(is_unattended_run(Some(&app_master_run_label("p1"))));
        // Everything a human could have named stays outside.
        for human in ["overnight cleanup", "app master notes", "perfect round 9"] {
            assert!(!is_unattended_run(Some(human)), "{human}");
        }
        assert!(!is_unattended_run(None));
    }

    #[test]
    fn the_app_master_cutoff_is_shorter_than_the_nights() {
        assert_eq!(APP_MASTER_AWAITING_SLOT_CUTOFF_SECS, 15 * 60);
        assert!(APP_MASTER_AWAITING_SLOT_CUTOFF_SECS < OVERNIGHT_AWAITING_SLOT_CUTOFF_SECS);
    }

    #[test]
    fn a_parked_app_master_worker_stops_holding_a_slot_at_its_own_cutoff() {
        const AM_CUTOFF_MS: i64 = APP_MASTER_AWAITING_SLOT_CUTOFF_SECS * 1000;
        // The observed session: parked `awaiting_input` for over an hour.
        let parked_ms = 65 * 60 * 1000;
        assert!(!holds_overnight_slot(
            "awaiting_input",
            parked_ms,
            AM_CUTOFF_MS
        ));
        // …and it would have lapsed on the night's cutoff too — the tag is what
        // was missing, not the arithmetic.
        assert!(!holds_overnight_slot(
            "awaiting_input",
            parked_ms,
            CUTOFF_MS
        ));
        // Fresh still holds: a permission prompt a human is walking toward.
        assert!(holds_overnight_slot("awaiting_input", FRESH, AM_CUTOFF_MS));
        // …but 20 minutes in, the App Master lapses where the night still waits.
        let twenty_min = 20 * 60 * 1000;
        assert!(!holds_overnight_slot(
            "awaiting_input",
            twenty_min,
            AM_CUTOFF_MS
        ));
        assert!(holds_overnight_slot(
            "awaiting_input",
            twenty_min,
            CUTOFF_MS
        ));
        // Once the sweeper has finished it, no cutoff matters any more.
        assert!(!holds_overnight_slot("finished", FRESH, AM_CUTOFF_MS));
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
