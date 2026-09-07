//! The **decision lane** — what an App Master does on every wake.
//!
//! The other four attention lanes answer *"is there a thing to do"* and pick it
//! by a fixed rule. `advance` in particular rotates: least-recently-advanced
//! charter, one dispatch, every tick, forever. That is a schedule, not a
//! judgment — it cannot notice that three of a project's five charters are
//! irrelevant this week, cannot use two free slots when it has them, and
//! cannot remember between wakes what it already covered.
//!
//! This module is the judgment. For a persona holding at least one
//! **project-bound** charter (the App Master shape), the loop gathers what it
//! owns and what the project looks like right now, asks the persona's OWN model
//! one bounded question — *which of my responsibilities moves this project this
//! wake, and why* — and dispatches the answer, up to the persona's free
//! concurrency.
//!
//! Everything here except [`gather`] is a **pure function** over owned data, so
//! the contract (prompt shape, JSON parse, capacity cap, priority order) is
//! testable without a database, a model, or a clock. The impure halves live in
//! [`super::attention`]: `gather` reads, and the executor calls and dispatches.
//!
//! Behind `autonomous_attention_loop` like the rest of the loop — this module
//! runs only from a tick that already passed that gate.

use personas_core::models::ResponsibilityPacing;

/// Hard bound on one dispatch reason echoed back into the ledger.
const MAX_REASON_CHARS: usize = 400;
/// Hard bound on one dispatch brief appended to the charter's task text.
const MAX_BRIEF_CHARS: usize = 1200;
/// Hard bound on the coverage note carried to the next wake. Stated in the
/// prompt AND enforced here — a model that ignores the limit must not be able
/// to grow a charter's `spec` without bound, one wake at a time.
pub(crate) const MAX_NOTE_CHARS: usize = 300;
/// How many undispatched ideas are named in the prompt. The COUNT is always
/// stated; the titles are a sample, and the prompt says so.
pub(crate) const MAX_NAMED_IDEAS: usize = 10;

/// How many asks ONE wake may put to the operator.
///
/// A wake that raises four questions has not decided anything; it has forwarded
/// its whole situation. Three is already generous for a loop that wakes every
/// few hours, and the cap is what stops a blocked persona from filling the
/// review queue one wake at a time.
pub(crate) const MAX_ASKS: usize = 3;
/// Hard bound on one ask's title — it becomes a manual review's title.
pub(crate) const MAX_ASK_TITLE_CHARS: usize = 120;
/// Hard bound on one ask's `why` — it becomes the review's description.
pub(crate) const MAX_ASK_WHY_CHARS: usize = 400;
/// How many backlog ideas one ask may name.
pub(crate) const MAX_ASK_IDEA_IDS: usize = 10;
/// How many options one ask may offer, and how long each may be. Not stated in
/// the brief that asked for this field, but an unbounded option list is an
/// unbounded `suggested_actions` blob, and every other string on this wire is
/// bounded.
pub(crate) const MAX_ASK_OPTIONS: usize = 6;
pub(crate) const MAX_ASK_OPTION_CHARS: usize = 120;

/// The operator is asked to accept (or reject) named backlog items.
pub(crate) const ASK_ACCEPT_IDEAS: &str = "accept_ideas";
/// The operator is asked to choose between options only they can choose between.
pub(crate) const ASK_DECISION: &str = "decision";
/// The operator is asked to remove an obstacle (access, a credential, a gate).
pub(crate) const ASK_UNBLOCK: &str = "unblock";

/// `context_data.source` on every review an ask mints.
///
/// The Director stamps `"director"` here and `manual_reviews::update_status`
/// branches on it, so an ask needs its own marker rather than borrowing that
/// one: these rows must reach the operator's queue without being treated as
/// coaching to synthesize into a memory.
pub(crate) const ASK_SOURCE: &str = "app_master_ask";

/// The three actions an `accept_ideas` ask always offers. The resolve path keys
/// on these exact strings, so they are a contract, not copy.
pub(crate) const ASK_ACCEPT_ACTION: &str = "Accept the listed ideas";
pub(crate) const ASK_REJECT_ACTION: &str = "Reject them";
pub(crate) const ASK_LATER_ACTION: &str = "Decide later";

/// Floor on the sleep a plan may choose for itself, in minutes.
///
/// A persona that asks to wake in one minute is not pacing itself, it is
/// spinning: every wake costs a model call, and the work it dispatched cannot
/// have finished. The bound is a CLAMP rather than a rejection — a plan whose
/// only fault is an over-eager number is still a plan, and throwing away its
/// dispatch list over its sleep would be a worse answer than pacing it.
pub(crate) const MIN_NEXT_WAKE_MINUTES: u32 = 10;
/// Ceiling on the same choice. Four hours is already long enough that the
/// operator would rather switch the persona off than wait; beyond it the
/// persona has effectively resigned without saying so.
pub(crate) const MAX_NEXT_WAKE_MINUTES: u32 = 240;

// ── Inputs ────────────────────────────────────────────────────────────────

/// How far the charter's LAST dispatch actually got.
///
/// The ledger row for a dispatch closes at SPAWN, with verdict `dispatched` —
/// which is a statement about starting, not about finishing. Cycle 1 measured
/// what that costs: at 01:33 UTC CandiDate deferred its KPI charter as "still
/// in flight" when the fleet session had reported `FLEET:DONE` twenty-five
/// minutes earlier. The ledger was not wrong, it was just silent about the
/// half the decision needed. This carries the worker's own end state back.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LastDispatch {
    /// When the dispatch was opened (the ledger row's `started_at`).
    pub at: String,
    /// `fleet` (a headless session in an authoring worktree) or `execution`.
    pub worker: String,
    /// [`DISPATCH_RUNNING`] | [`DISPATCH_FINISHED`] | [`DISPATCH_FAILED`] |
    /// [`DISPATCH_UNKNOWN`]. `unknown` is a real answer — the row may have been
    /// pruned — and must never be read as "still running".
    pub state: String,
    /// What the worker declared, when it declared anything. Bounded.
    pub summary: Option<String>,
}

/// The worker has not reported an end yet.
pub(crate) const DISPATCH_RUNNING: &str = "running";
/// The worker declared it was done.
pub(crate) const DISPATCH_FINISHED: &str = "finished";
/// The worker stopped without declaring done.
pub(crate) const DISPATCH_FAILED: &str = "failed";
/// The worker's row could not be found — pruned, or never persisted.
pub(crate) const DISPATCH_UNKNOWN: &str = "unknown";

/// Hard bound on a last-dispatch summary carried into the prompt.
pub(crate) const MAX_DISPATCH_SUMMARY_CHARS: usize = 200;

/// One charter as the decision sees it — flattened out of
/// `PersonaResponsibility` + the ledger so the prompt renderer and the parser
/// share one shape and neither needs a database.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DecisionCharter {
    pub id: String,
    pub title: String,
    /// 1 (highest) .. 5. `None` means the operator declared no order and the
    /// persona should use its judgment — NOT "middling".
    pub priority: Option<u8>,
    pub recipe_slug: Option<String>,
    /// The recipe description's `need` — why the charter exists.
    pub need: Option<String>,
    /// The recipe description's `core_action` — the judgment at its centre.
    pub core_action: Option<String>,
    pub interval_minutes: Option<i64>,
    pub max_runs_per_day: Option<i64>,
    pub quiet_hours: Option<String>,
    pub pacing: Option<ResponsibilityPacing>,
    /// Newest non-refused ledger `started_at` for this charter, any lane.
    pub last_started_at: Option<String>,
    /// The verdict that row closed with (`dispatched` / `failed` / …).
    pub last_verdict: Option<String>,
    /// Where the last DECIDED dispatch of this charter actually got to.
    /// `None` = it has never been dispatched by the decision lane.
    pub last_dispatch: Option<LastDispatch>,
    /// This charter's runs author code in a real repository, so a dispatch
    /// must go to an isolated worktree rather than the operator's checkout.
    pub writes_code: bool,
    /// The charter's autonomy rung (`persona_responsibilities.scope_rung`) —
    /// `0` read, `1` retry, `2` open branch/PR
    /// (`personas_engine::app_master::RUNG_*`).
    ///
    /// Carried here for the DISPATCHER, not for the prompt: the worktree task
    /// text a code charter is seeded with states what the worker may ship, and
    /// until 2026-09-07 it stated the Overnight engine's never-ship rule at
    /// every rung — so a rung-2 App Master was told not to open the pull
    /// request its own mandate permits. Not rendered into the decision prompt:
    /// the mandate is already in the persona's Core sections, and repeating it
    /// as a per-charter line would invite the model to reason about its own
    /// ceiling.
    pub scope_rung: u8,
    /// The model a dispatch of THIS charter must run on, resolved through the
    /// same chain the execution path walks (`spec.modelOverride` → the
    /// persona's `model_profile` → the capability default). Never empty.
    ///
    /// Carried per charter rather than taken from [`DecisionContext::model`]
    /// because that one is the roster-wide answer for the DECISION call, and
    /// the fleet lane has no `execute_persona_inner` to resolve it later: it
    /// spawns a CLI, and a CLI with no `--model` rides the operator's account
    /// default. Measured in cycles 2-3 (2026-09-07): every App Master worker
    /// ran on the account default instead of its charter's Opus, and three of
    /// them burned the operator's own subscription to a limit.
    ///
    /// Not rendered into the prompt — it is an instruction to the dispatcher,
    /// not a fact the decision reasons about.
    pub dispatch_model: String,
    /// The project this charter is bound to, when it is bound to one.
    pub project_id: Option<String>,
}

/// How many in-flight tasks are named in the prompt.
pub(crate) const MAX_NAMED_IN_FLIGHT: usize = 10;

/// One `running`/`queued` task the project already has under way.
///
/// The undispatched-idea sensor goes quiet the moment a task row exists, which
/// tells the decision that something WAS dispatched but nothing about whether
/// it is still going. Without this the same charter looks equally dispatchable
/// on the next wake, and the loop's own worker becomes invisible to it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct InFlightTask {
    /// The backlog idea this task was promoted from, when it was promoted from
    /// one. `None` for a task somebody created directly.
    pub idea_id: Option<String>,
    pub title: String,
    /// When the run actually started; `None` for a task still `queued`.
    pub started_at: Option<String>,
}

/// What one of the persona's projects looks like right now — the facts a
/// decision needs that the charter list cannot supply.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ProjectSnapshot {
    pub project_id: String,
    pub project_name: Option<String>,
    /// Accepted ideas with no `dev_tasks` row — decisions nobody acted on.
    pub undispatched_idea_count: usize,
    /// Up to [`MAX_NAMED_IDEAS`] of them, as `(id, title)`.
    pub undispatched_ideas: Vec<(String, String)>,
    /// Up to [`MAX_NAMED_IN_FLIGHT`] tasks already `running` or `queued`.
    pub in_flight_tasks: Vec<InFlightTask>,
    pub pending_idea_count: usize,
    pub context_count: usize,
    /// Newest `dev_contexts.updated_at` — how fresh the context map is.
    pub context_newest_at: Option<String>,
    /// Contexts carrying zero ACTIVE KPI. `None` = not measured (say so in
    /// the prompt rather than printing a 0 nobody computed).
    pub kpi_coverage_gap: Option<usize>,
}

/// An ask this persona already put to the operator that nobody has answered.
///
/// Carried into the prompt so a blocked persona does not re-ask the same
/// question every wake, and re-used by the executor as the duplicate-suppression
/// key — one shape, so the rule the prompt states and the rule the code enforces
/// cannot drift apart.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct OpenAsk {
    /// The `persona_manual_reviews` row this ask is waiting in.
    pub review_id: String,
    pub kind: String,
    pub title: String,
    /// How long it has been waiting. Computed by the gatherer against the same
    /// clock stamped on [`DecisionContext::now_utc`], so the renderer stays a
    /// pure function and never reads a clock of its own. `None` = the row's
    /// timestamp could not be parsed; the prompt then prints no age at all.
    pub age_minutes: Option<i64>,
}

/// Everything the decision is allowed to know.
#[derive(Debug, Clone, Default)]
pub(crate) struct DecisionContext {
    pub persona_id: String,
    pub persona_name: String,
    /// `personas.max_concurrent` (`<= 0` = unlimited, the queue's convention).
    pub max_concurrent: i32,
    /// The model this persona thinks with, resolved at plan time through the
    /// SAME chain a dispatched run uses (charter `spec.modelOverride` → the
    /// persona's own `model_profile` → the capability default), so the
    /// decision and the work it orders never run on different models by
    /// accident. Not rendered into the prompt — it IS the call.
    pub model: String,
    /// Slots this persona may fill RIGHT NOW — already the minimum of its own
    /// remaining concurrency and the engine's global capacity. Filled by the
    /// executor immediately before the call, never at plan time: a figure
    /// measured minutes earlier is not capacity, it is a guess.
    pub free_capacity: usize,
    /// This persona's own executions running right now, out of the live
    /// tracker. Printed beside [`Self::free_capacity`] so the persona is told
    /// WHY it has the capacity it has.
    pub running_executions: usize,
    /// This persona's own fleet workers still holding a slot. The half that was
    /// invisible until 2026-09-07 — a code charter dispatches a headless fleet
    /// session and no execution, so a persona reading only the tracker saw two
    /// workers in the fleet grid and "2 free" in its own prompt.
    pub running_fleet: usize,
    /// The wall clock at gather time, RFC-3339 UTC. Carried rather than read
    /// inside the renderer so [`render_decision_prompt`] stays a pure function
    /// of its context — and so a prompt in a ledger can be reproduced exactly.
    /// Empty means the clock was not read; the prompt then prints no time at
    /// all rather than a fabricated one.
    pub now_utc: String,
    pub charters: Vec<DecisionCharter>,
    pub projects: Vec<ProjectSnapshot>,
    /// Asks this persona has already put to the operator and nobody has
    /// answered yet.
    pub open_asks: Vec<OpenAsk>,
}

// ── Output ────────────────────────────────────────────────────────────────

/// One charter the plan wants run this wake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecisionItem {
    pub charter_id: String,
    /// Why this one, this wake — echoed into the ledger so a human reading the
    /// ledger sees the persona's own argument, not just an id.
    pub reason: String,
    /// What specifically to do, appended to the charter's standing task text.
    pub brief: String,
}

/// One charter the plan deliberately left for later.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecisionDeferral {
    pub charter_id: String,
    pub reason: String,
}

/// One question the plan puts to the operator, because it is the operator's to
/// answer.
///
/// The loop's own ceiling, measured 2026-09-07: an App Master whose delivery
/// charter is starved by an un-triaged backlog can dispatch nothing useful and
/// has, until now, had exactly one way to say so — a 300-character coverage note
/// addressed to its own next wake. This is the other direction of that channel.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct OperatorAsk {
    /// [`ASK_ACCEPT_IDEAS`] | [`ASK_DECISION`] | [`ASK_UNBLOCK`]. Anything else
    /// the model writes is read as [`ASK_DECISION`] — see [`normalize_ask_kind`].
    pub kind: String,
    pub title: String,
    /// Why the loop cannot move without this. Becomes the review's description.
    pub why: String,
    /// Backlog idea ids the ask is about, as the model wrote them: full uuids or
    /// the 8-char prefixes the app prints. Resolved against `dev_ideas` by the
    /// caller, which drops what does not resolve.
    pub idea_ids: Vec<String>,
    /// The choices the operator is being offered, when the ask offers choices.
    pub options: Vec<String>,
}

/// A parsed, bounded, capacity-capped plan.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DecisionPlan {
    pub dispatch: Vec<DecisionItem>,
    pub defer: Vec<DecisionDeferral>,
    /// What this wake needs a person to decide. At most [`MAX_ASKS`].
    pub asks: Vec<OperatorAsk>,
    /// The plan's message to its own next wake.
    pub note: Option<String>,
    /// How long the persona chose to sleep before waking again, in minutes,
    /// already clamped to [`MIN_NEXT_WAKE_MINUTES`]..=[`MAX_NEXT_WAKE_MINUTES`].
    /// `None` = the plan said nothing, so the previous choice stands.
    pub next_wake_minutes: Option<u32>,
    /// Charter ids the model named that do not exist on this persona. Kept
    /// rather than silently discarded: a plan that invents ids is a plan that
    /// did not read the roster, and the ledger should show that it happened.
    pub dropped_unknown: Vec<String>,
    /// How many dispatch entries were cut by the capacity cap.
    pub trimmed_for_capacity: usize,
}

/// Why a model reply could not become a plan. Every variant is a reason to
/// fall back to the deterministic single dispatch, never to dispatch nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DecisionError {
    /// The model returned nothing (or only whitespace).
    Empty,
    /// No JSON object could be found in the reply.
    NoJson(String),
    /// A JSON object was found but did not deserialize.
    Malformed(String),
    /// The model asked for work, but EVERY charter it named is unknown — it
    /// was not reading the roster, so nothing it said can be trusted.
    NoKnownCharters(Vec<String>),
}

impl std::fmt::Display for DecisionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => f.write_str("the decision call returned no text"),
            Self::NoJson(p) => write!(f, "no JSON object in the decision reply: {p}"),
            Self::Malformed(e) => write!(f, "decision reply did not parse: {e}"),
            Self::NoKnownCharters(ids) => write!(
                f,
                "the decision named only charters this persona does not hold: {}",
                ids.join(", ")
            ),
        }
    }
}

// ── The wire shape (deserialize only) ─────────────────────────────────────

#[derive(serde::Deserialize)]
struct WireItem {
    /// The prompt asks for `charterId`; `charter_id` is accepted too because a
    /// model that reads the surrounding Rust-ish vocabulary sometimes reaches
    /// for snake_case, and rejecting a plan over a separator would be a
    /// needless fallback.
    #[serde(rename = "charterId", alias = "charter_id")]
    charter_id: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    brief: Option<String>,
}

#[derive(serde::Deserialize)]
struct WireAsk {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    why: Option<String>,
    /// `ideaIds` is what the prompt asks for; `idea_ids` is accepted for the
    /// same reason `charter_id` is.
    #[serde(rename = "ideaIds", alias = "idea_ids", default)]
    idea_ids: Vec<String>,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(serde::Deserialize)]
struct WirePlan {
    #[serde(default)]
    dispatch: Vec<WireItem>,
    #[serde(default)]
    defer: Vec<WireItem>,
    /// Absent (the common case) is an empty list, never a parse failure: a plan
    /// with nothing to ask is the normal plan.
    #[serde(default)]
    asks: Vec<WireAsk>,
    #[serde(default)]
    note: Option<String>,
    /// Deliberately `serde_json::Value` rather than `Option<u32>`: a model that
    /// answers `"30 minutes"` or `22.5` must lose only its sleep choice, not
    /// the whole plan. A typed field would make the entire reply Malformed and
    /// send a perfectly good dispatch list to the deterministic fallback.
    #[serde(rename = "nextWakeMinutes", alias = "next_wake_minutes", default)]
    next_wake_minutes: Option<serde_json::Value>,
}

// ── Parse ─────────────────────────────────────────────────────────────────

/// Turn a model reply into a plan this loop is willing to act on.
///
/// In order: find the JSON (fences tolerated), deserialize, drop entries naming
/// a charter this persona does not hold, dedupe by charter id keeping the first
/// mention, stable-sort so charters carrying an explicit `priority` lead (by
/// priority ascending) while the rest keep the model's own order, bound every
/// string, and finally cut the dispatch list to `free_capacity`.
///
/// `charters` supplies both the id allowlist and the priorities — one argument
/// instead of two that could disagree.
pub(crate) fn parse_decision(
    raw: &str,
    charters: &[DecisionCharter],
    free_capacity: usize,
) -> Result<DecisionPlan, DecisionError> {
    if raw.trim().is_empty() {
        return Err(DecisionError::Empty);
    }
    let span = crate::companion::brain::oneshot::extract_json_span(raw, "app-master decision")
        .map_err(|e| DecisionError::NoJson(e.to_string()))?;
    let wire: WirePlan =
        serde_json::from_str(span).map_err(|e| DecisionError::Malformed(e.to_string()))?;

    let priority_of = |id: &str| -> Option<u8> {
        charters
            .iter()
            .find(|c| c.id == id)
            .and_then(|c| c.priority)
    };
    let known = |id: &str| charters.iter().any(|c| c.id == id);

    let mut dropped_unknown: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut dispatch: Vec<DecisionItem> = Vec::new();
    let mut named_any = false;

    for item in wire.dispatch {
        let Some(id) = item.charter_id.map(|s| s.trim().to_string()) else {
            continue;
        };
        if id.is_empty() {
            continue;
        }
        named_any = true;
        if !known(&id) {
            if !dropped_unknown.contains(&id) {
                dropped_unknown.push(id);
            }
            continue;
        }
        if seen.contains(&id) {
            continue; // first mention wins
        }
        seen.push(id.clone());
        dispatch.push(DecisionItem {
            reason: bound(item.reason.unwrap_or_default().trim(), MAX_REASON_CHARS),
            brief: bound(item.brief.unwrap_or_default().trim(), MAX_BRIEF_CHARS),
            charter_id: id,
        });
    }

    // A plan that named work and got every id wrong is not a plan.
    if named_any && dispatch.is_empty() && !dropped_unknown.is_empty() {
        return Err(DecisionError::NoKnownCharters(dropped_unknown));
    }

    // Stable: explicit priorities lead in ascending order; absent priorities
    // keep the order the model gave them. `sort_by_key` is stable, so a charter
    // with no declared priority never overtakes one that has it, and two
    // charters at the same priority stay in the model's order.
    dispatch.sort_by_key(|i| match priority_of(&i.charter_id) {
        Some(p) => (0u8, p),
        None => (1u8, 0),
    });

    let trimmed_for_capacity = dispatch.len().saturating_sub(free_capacity);
    dispatch.truncate(free_capacity);

    let mut deferred_seen: Vec<String> = Vec::new();
    let mut defer: Vec<DecisionDeferral> = Vec::new();
    for item in wire.defer {
        let Some(id) = item.charter_id.map(|s| s.trim().to_string()) else {
            continue;
        };
        if id.is_empty() || !known(&id) || deferred_seen.contains(&id) {
            if !id.is_empty() && !known(&id) && !dropped_unknown.contains(&id) {
                dropped_unknown.push(id);
            }
            continue;
        }
        deferred_seen.push(id.clone());
        defer.push(DecisionDeferral {
            reason: bound(item.reason.unwrap_or_default().trim(), MAX_REASON_CHARS),
            charter_id: id,
        });
    }

    let note = wire
        .note
        .map(|n| bound(n.trim(), MAX_NOTE_CHARS))
        .filter(|n| !n.is_empty());

    let next_wake_minutes = wire.next_wake_minutes.as_ref().and_then(clamp_next_wake);

    let asks = parse_asks(wire.asks);

    Ok(DecisionPlan {
        dispatch,
        defer,
        asks,
        note,
        next_wake_minutes,
        dropped_unknown,
        trimmed_for_capacity,
    })
}

/// Read the ask list: bound every string, cap every list, drop what says
/// nothing.
///
/// An ask with no title is dropped — a review with no title is a row nobody can
/// read, and there is nothing left to ask about. Everything else is kept and
/// trimmed to size: this channel exists because the persona had no way to speak
/// at all, so the bar for keeping what it said is low and the bar for what it
/// may write into the operator's queue is fixed.
fn parse_asks(wire: Vec<WireAsk>) -> Vec<OperatorAsk> {
    let mut asks: Vec<OperatorAsk> = Vec::new();
    for a in wire {
        if asks.len() >= MAX_ASKS {
            break;
        }
        let title = bound(a.title.unwrap_or_default().trim(), MAX_ASK_TITLE_CHARS);
        if title.is_empty() {
            continue;
        }
        let kind = normalize_ask_kind(a.kind.as_deref());
        // Dedupe within the wake as well as against what is already open: a
        // model that names the same question twice asked once.
        if asks
            .iter()
            .any(|x| x.kind == kind && same_ask_title(&x.title, &title))
        {
            continue;
        }
        let mut idea_ids: Vec<String> = Vec::new();
        for raw in a.idea_ids {
            if idea_ids.len() >= MAX_ASK_IDEA_IDS {
                break;
            }
            let id = raw.trim().to_ascii_lowercase();
            if id.is_empty() || idea_ids.contains(&id) {
                continue;
            }
            idea_ids.push(id);
        }
        let options: Vec<String> = a
            .options
            .into_iter()
            .map(|o| bound(o.trim(), MAX_ASK_OPTION_CHARS))
            .filter(|o| !o.is_empty())
            .take(MAX_ASK_OPTIONS)
            .collect();
        asks.push(OperatorAsk {
            kind,
            title,
            why: bound(a.why.unwrap_or_default().trim(), MAX_ASK_WHY_CHARS),
            idea_ids,
            options,
        });
    }
    asks
}

/// Read an ask's `kind`, leniently.
///
/// An unrecognised (or absent) kind becomes [`ASK_DECISION`] rather than
/// dropping the ask: `decision` is the generic "a person must choose", so the
/// operator still sees the question and only the automatic verdict-application
/// of [`ASK_ACCEPT_IDEAS`] is withheld — which is the safe direction to err.
fn normalize_ask_kind(raw: Option<&str>) -> String {
    match raw.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
        ASK_ACCEPT_IDEAS => ASK_ACCEPT_IDEAS.to_string(),
        ASK_UNBLOCK => ASK_UNBLOCK.to_string(),
        _ => ASK_DECISION.to_string(),
    }
}

/// Whether two ask titles name the same question. Case- and whitespace-
/// insensitive, because a model re-asking a question rarely reproduces its own
/// punctuation exactly and an operator would read both rows as one.
pub(crate) fn same_ask_title(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Whether this ask is already sitting unanswered in the operator's queue.
///
/// Keyed on `kind` + `title`, which is what the operator actually sees; the
/// `why` and the idea list may legitimately be re-worded between wakes without
/// making it a different question.
pub(crate) fn ask_is_open(ask: &OperatorAsk, open: &[OpenAsk]) -> bool {
    open.iter()
        .any(|o| o.kind == ask.kind && same_ask_title(&o.title, &ask.title))
}

/// Read the plan's sleep choice, clamped into the bounds the prompt states.
///
/// Anything that is not a JSON integer — a string, a float, `null`, an object —
/// is IGNORED (returns `None`, "the plan said nothing"), never coerced: a model
/// that answered `"soon"` did not choose 0 minutes, and a value invented here
/// would be indistinguishable downstream from one the persona meant.
fn clamp_next_wake(raw: &serde_json::Value) -> Option<u32> {
    let n = raw.as_i64()?;
    Some(n.clamp(
        i64::from(MIN_NEXT_WAKE_MINUTES),
        i64::from(MAX_NEXT_WAKE_MINUTES),
    ) as u32)
}

/// The persona's most recent sleep choice, across the charters it holds.
///
/// `write_back_pacing` stamps the SAME value on every charter the decision
/// considered — it is the persona's choice, not the charter's — so in practice
/// they agree. They can still disagree after a charter is added, retired, or
/// edited between wakes, and "newest" is the only defensible tiebreak: the
/// stamp carrying the latest `lastDecidedAt` is the one the persona meant last.
/// A charter with a choice but no stamp sorts oldest rather than being dropped.
///
/// Takes `(last_decided_at, next_wake_minutes)` pairs instead of a charter type
/// so the admission ladder (which holds `PersonaResponsibility`) and the prompt
/// (which holds [`DecisionCharter`]) read the same rule from one place.
pub(crate) fn newest_next_wake_minutes<'a>(
    pacings: impl IntoIterator<Item = (Option<&'a str>, Option<u32>)>,
) -> Option<u32> {
    pacings
        .into_iter()
        .filter_map(|(decided_at, minutes)| minutes.map(|m| (decided_at.unwrap_or(""), m)))
        .max_by(|a, b| a.0.cmp(b.0))
        .map(|(_, m)| m)
}

/// The same read over a decision context's own charters.
pub(crate) fn context_next_wake_minutes(charters: &[DecisionCharter]) -> Option<u32> {
    newest_next_wake_minutes(charters.iter().map(|c| {
        (
            c.pacing.as_ref().and_then(|p| p.last_decided_at.as_deref()),
            c.pacing.as_ref().and_then(|p| p.next_wake_minutes),
        )
    }))
}

/// The persona's most recent coverage note, across the charters it holds.
///
/// Same newest-wins rule as [`newest_next_wake_minutes`], and for the same
/// reason: `write_back_pacing` stamps ONE note on every charter the decision
/// considered, so in practice they agree, and the only case where they disagree
/// — a charter added or retired between wakes — is settled by whichever stamp
/// carries the latest `lastDecidedAt`.
///
/// Takes `(last_decided_at, coverage_note)` pairs rather than a charter type so
/// the state route (which holds `PersonaResponsibility`) and this module read
/// one rule from one place. A blank note is not a note.
pub(crate) fn newest_coverage_note<'a>(
    pacings: impl IntoIterator<Item = (Option<&'a str>, Option<&'a str>)>,
) -> Option<String> {
    pacings
        .into_iter()
        .filter_map(|(decided_at, note)| {
            note.map(str::trim)
                .filter(|n| !n.is_empty())
                .map(|n| (decided_at.unwrap_or(""), n))
        })
        .max_by(|a, b| a.0.cmp(b.0))
        .map(|(_, n)| n.to_string())
}

/// The recipe whose runs deliver ONE accepted backlog idea. A dispatch of this
/// charter is the only one that has an idea to write back about, which is why
/// it is the only one that mints a `dev_tasks` row at dispatch time.
pub(crate) const ACCEPTED_IDEA_DELIVERY_SLUG: &str = "accepted-idea-delivery";

/// Pull the idea id a decision's own words name, if any.
///
/// The decision prompt lists undispatched ideas as `- <id>: <title>`, so a plan
/// that picked one usually echoes the id — sometimes the full uuid, sometimes
/// the 8-char prefix the app prints everywhere. Both are accepted; a full uuid
/// wins over a bare prefix when both appear.
///
/// Pure and deliberately permissive: this only produces a CANDIDATE. The caller
/// resolves it against `dev_ideas` scoped to the project, so a hex-looking word
/// that is not an id simply fails to resolve and costs nothing. Being strict
/// here instead would mean rejecting the real id whenever the model wrapped it
/// in punctuation.
pub(crate) fn extract_idea_id_token(text: &str) -> Option<String> {
    let is_hex = |c: char| c.is_ascii_hexdigit();
    let looks_like_uuid = |t: &str| {
        t.len() == 36
            && t.char_indices().all(|(i, c)| {
                if [8, 13, 18, 23].contains(&i) {
                    c == '-'
                } else {
                    is_hex(c)
                }
            })
    };

    let mut prefix: Option<String> = None;
    for raw in text.split(|c: char| !(is_hex(c) || c == '-')) {
        let tok = raw.trim_matches('-');
        if tok.is_empty() {
            continue;
        }
        if looks_like_uuid(tok) {
            return Some(tok.to_ascii_lowercase());
        }
        // A bare prefix: 8..32 hex chars, no dashes. Shorter than 8 is not
        // something anybody printed, and longer than 32 is not a uuid's hex.
        if prefix.is_none() && (8..=32).contains(&tok.len()) && tok.chars().all(is_hex) {
            prefix = Some(tok.to_ascii_lowercase());
        }
    }
    prefix
}

// ── An ask, as a review row ───────────────────────────────────────────────

/// The `persona_manual_reviews` row an ask becomes, computed without a
/// database so the mapping is testable on its own.
///
/// Deliberately NOT `CreateManualReviewInput`: that type also carries the
/// execution/persona anchors and the team-step links, which are the caller's
/// facts, not the ask's. This is only the part the ask decides.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AskReview {
    pub title: String,
    pub description: String,
    pub severity: String,
    /// A JSON object string, ready for `context_data`.
    pub context_data: String,
    /// A JSON array string, ready for `suggested_actions` — the shape
    /// `engine::dispatch` writes for a runtime review, which is what the review
    /// UI reads.
    pub suggested_actions: String,
}

/// Turn one ask into the review row the operator will read.
///
/// `resolved_ideas` are `(full id, title)` pairs the caller has already looked
/// up; ids that did not resolve are simply absent, so the description never
/// promises an item nobody can find. Pure — the caller owns every lookup.
pub(crate) fn ask_to_review(
    ask: &OperatorAsk,
    persona_id: &str,
    project_id: Option<&str>,
    project_name: Option<&str>,
    resolved_ideas: &[(String, String)],
) -> AskReview {
    let project_label = project_name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .or_else(|| project_id.map(str::trim).filter(|p| !p.is_empty()));
    let title = match project_label {
        Some(label) => format!("App Master {label}: {}", ask.title),
        // No project to name is not a reason to drop the prefix — the operator
        // still needs to know which surface is speaking.
        None => format!("App Master: {}", ask.title),
    };

    let mut description = ask.why.trim().to_string();
    if !resolved_ideas.is_empty() {
        if !description.is_empty() {
            description.push_str("\n\n");
        }
        description.push_str("Ideas:\n");
        for (id, idea_title) in resolved_ideas {
            // The 8-char prefix is what the app prints everywhere else, so it
            // is what the operator can match against the backlog.
            let short: String = id.chars().take(8).collect();
            description.push_str(&format!("- {short}: {}\n", idea_title.trim()));
        }
        // One trailing newline is noise in a description field.
        while description.ends_with('\n') {
            description.pop();
        }
    }

    let actions: Vec<String> = if ask.kind == ASK_ACCEPT_IDEAS {
        // Fixed, because the resolve path keys on these exact strings. A model
        // wording its own options here would silently disarm the verdicts.
        vec![
            ASK_ACCEPT_ACTION.to_string(),
            ASK_REJECT_ACTION.to_string(),
            ASK_LATER_ACTION.to_string(),
        ]
    } else {
        ask.options.clone()
    };

    let context_data = serde_json::json!({
        "source": ASK_SOURCE,
        "personaId": persona_id,
        "projectId": project_id,
        "kind": ask.kind,
        "ideaIds": resolved_ideas.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
        // The ask's OWN title, unprefixed. The duplicate check compares this
        // rather than the row's title so it never has to un-build the
        // `App Master <project>: ` prefix — and so a project rename between
        // wakes does not turn one open question into two.
        "askTitle": ask.title,
    })
    .to_string();

    AskReview {
        title,
        description,
        severity: "info".to_string(),
        context_data,
        suggested_actions: serde_json::json!(actions).to_string(),
    }
}

/// Char-bounded truncation on a char boundary (the loop's existing helper is
/// byte-budgeted; this one counts characters because the limits above are
/// stated to the model in characters).
fn bound(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
}

// ── Prompt ────────────────────────────────────────────────────────────────

/// Render the persona's standing question. Pure: same context, same string.
///
/// The prompt states four things the parser then enforces, so the model is
/// never surprised by a rule it was not told: the priority rule, the capacity,
/// the exact charter ids it may name, and the one-JSON-object output contract.
pub(crate) fn render_decision_prompt(ctx: &DecisionContext) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "You are {}, and this is your wake. You hold standing responsibilities \
         (charters) over the project(s) below.\n\n\
         YOUR STANDING QUESTION: which of my responsibilities moves this project \
         forward this wake, and why?\n\n",
        ctx.persona_name
    ));

    // --- Where in time this wake sits ---
    //
    // Every other instant in this prompt is an absolute timestamp, so without
    // a "now" the persona cannot tell a dispatch that started four minutes ago
    // from one that started four hours ago — and elapsed time is exactly what
    // its own pacing choice is about. Printed only when the clock was actually
    // read (the loop's own rule about figures it did not measure).
    let now = ctx.now_utc.trim();
    let chosen_sleep = context_next_wake_minutes(&ctx.charters);
    if !now.is_empty() {
        s.push_str(&format!("RIGHT NOW (UTC): {now}\n"));
    }
    if let Some(minutes) = chosen_sleep {
        s.push_str(&format!(
            "You chose to sleep {minutes} minutes after your last wake.\n"
        ));
    }
    if !now.is_empty() || chosen_sleep.is_some() {
        s.push('\n');
    }

    // --- The rules, before the data ---
    s.push_str("HOW TO DECIDE\n");
    s.push_str(
        "- PRIORITY: a charter with an explicit priority (1 = highest .. 5 = lowest) \
         is ordered ahead of one without. A charter with NO priority is not \
         low-priority — it means nobody ranked it and the judgment is yours.\n",
    );
    s.push_str(
        "- COVERAGE: read each charter's `lastDecidedAt` / `lastDispatchedAt` / \
         `coverageNote`. That is your own memory from previous wakes. Do not \
         re-run what you just ran, and do not starve what you keep deferring.\n",
    );
    s.push_str(&format!(
        "- CAPACITY: you may dispatch AT MOST {} charter(s) this wake ({}; {} \
         execution(s) and {} fleet worker(s) of yours are running). \
         Naming more is not an error — anything past the limit is dropped, \
         highest priority first — but it wastes the slot you actually have. \
         Dispatching FEWER, or none, is a legitimate answer.\n",
        ctx.free_capacity,
        if ctx.max_concurrent > 0 {
            format!("your parallel capacity is {}", ctx.max_concurrent)
        } else {
            "your parallel capacity is unlimited; this is the engine's free slots".to_string()
        },
        // The breakdown, not just the total: a persona that is told only "1
        // free" has to guess which of its workers is holding the other slot,
        // and until 2026-09-07 the honest answer was that the engine did not
        // know either — a code charter's fleet worker was in nobody's count.
        ctx.running_executions,
        ctx.running_fleet,
    ));
    s.push_str(
        "- IN FLIGHT: a charter whose `last dispatch` is `finished` or `failed` is NOT in \
         flight — read its summary before deciding. Only `running` means a worker of \
         yours is still going; `unknown` means its record is gone, not that it is alive. \
         The same goes for a project's `in flight` tasks: those are already under way, \
         so do not re-dispatch them.\n",
    );
    s.push_str(&format!(
        "- YOUR NEXT WAKE: `nextWakeMinutes` chooses how long you sleep before \
         you are asked this question again. Sleep SHORT ({MIN_NEXT_WAKE_MINUTES}-20) \
         when you dispatched work you must check on, or when work is waiting that \
         you could not start this wake. Sleep LONG (60-{MAX_NEXT_WAKE_MINUTES}) \
         when everything you own is already in flight, or nothing is due yet. \
         Omit the field to keep your current pacing. Anything outside \
         {MIN_NEXT_WAKE_MINUTES}-{MAX_NEXT_WAKE_MINUTES} is pulled back into it.\n"
    ));
    s.push_str(&format!(
        "- ASK WHEN BLOCKED: if what would move the project is a decision only the \
         operator can take (accepting backlog items, choosing between options, \
         granting access), put ONE ask in `asks` naming the exact items or \
         options, instead of sleeping on it. Do not ask for what you can decide \
         yourself. Do not repeat an ask that is still open. At most {MAX_ASKS} \
         asks; `kind` is `{ASK_ACCEPT_IDEAS}`, `{ASK_DECISION}` or \
         `{ASK_UNBLOCK}`.\n"
    ));
    s.push_str(
        "- EVERY charter must appear exactly once, in `dispatch` or in `defer`. \
         A deferral with a reason is a decision; silence is not.\n\n",
    );

    // --- What is already with the operator ---
    //
    // Printed before the charters because it is a CONSTRAINT on the answer, not
    // a fact to reason from: an ask the operator has not answered yet must not
    // be asked again, and a persona that cannot see its open asks will re-raise
    // one every wake for as long as it stays blocked.
    if !ctx.open_asks.is_empty() {
        s.push_str("ALREADY WITH THE OPERATOR (do not ask these again)\n");
        for a in &ctx.open_asks {
            s.push_str(&format!(
                "- [{}] {}{}\n",
                a.kind,
                a.title,
                match a.age_minutes {
                    Some(m) => format!(" — waiting {m} minute(s)"),
                    None => String::new(),
                }
            ));
        }
        s.push('\n');
    }

    // --- The charters ---
    s.push_str("YOUR CHARTERS\n");
    if ctx.charters.is_empty() {
        s.push_str("(none — dispatch nothing)\n");
    }
    for c in &ctx.charters {
        s.push_str(&format!("- id: {}\n  title: {}\n", c.id, c.title));
        s.push_str(&format!(
            "  priority: {}\n",
            match c.priority {
                Some(p) => p.to_string(),
                None => "none declared — your judgment".to_string(),
            }
        ));
        if let Some(slug) = &c.recipe_slug {
            s.push_str(&format!("  recipe: {slug}\n"));
        }
        if let Some(need) = c.need.as_deref().filter(|n| !n.trim().is_empty()) {
            s.push_str(&format!("  need: {need}\n"));
        }
        if let Some(action) = c.core_action.as_deref().filter(|a| !a.trim().is_empty()) {
            s.push_str(&format!("  core action: {action}\n"));
        }
        let cadence = [
            c.interval_minutes.map(|m| format!("every {m}m at most")),
            c.max_runs_per_day.map(|n| format!("{n} runs/day cap")),
            c.quiet_hours.clone().map(|q| format!("quiet {q}")),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        if !cadence.is_empty() {
            s.push_str(&format!("  cadence: {}\n", cadence.join(", ")));
        }
        match &c.pacing {
            Some(p) => {
                s.push_str(&format!(
                    "  coverage: last decided {}, last dispatched {}\n",
                    p.last_decided_at.as_deref().unwrap_or("never"),
                    p.last_dispatched_at.as_deref().unwrap_or("never"),
                ));
                if let Some(note) = p.coverage_note.as_deref().filter(|n| !n.trim().is_empty()) {
                    s.push_str(&format!("  your note from last wake: {note}\n"));
                }
            }
            None => s.push_str("  coverage: never decided on\n"),
        }
        s.push_str(&format!(
            "  last run: {}{}\n",
            c.last_started_at.as_deref().unwrap_or("never"),
            c.last_verdict
                .as_deref()
                .map(|v| format!(" ({v})"))
                .unwrap_or_default(),
        ));
        if let Some(d) = &c.last_dispatch {
            s.push_str(&format!(
                "  last dispatch: {} {}{}\n",
                d.at,
                d.state,
                d.summary
                    .as_deref()
                    .filter(|x| !x.trim().is_empty())
                    .map(|x| format!(" — {x}"))
                    .unwrap_or_default(),
            ));
        }
        if c.writes_code {
            s.push_str(
                "  note: this charter authors code. Its run is dispatched into an \
                 ISOLATED git worktree on its own branch — never the operator's \
                 checkout — so say what to change, not where to stand.\n",
            );
        }
    }
    s.push('\n');

    // --- The project(s) ---
    s.push_str("PROJECT STATE\n");
    if ctx.projects.is_empty() {
        s.push_str("(no project state could be read this wake)\n");
    }
    for p in &ctx.projects {
        s.push_str(&format!(
            "- {} ({})\n",
            p.project_name.as_deref().unwrap_or("unnamed project"),
            p.project_id
        ));
        s.push_str(&format!(
            "  accepted ideas with no task: {} · pending ideas: {}\n",
            p.undispatched_idea_count, p.pending_idea_count
        ));
        if !p.undispatched_ideas.is_empty() {
            let shown = p.undispatched_ideas.len();
            s.push_str(&format!(
                "  oldest {} of them:\n",
                if shown < p.undispatched_idea_count {
                    format!("{shown} (of {})", p.undispatched_idea_count)
                } else {
                    shown.to_string()
                }
            ));
            for (id, title) in &p.undispatched_ideas {
                s.push_str(&format!("    - {id}: {title}\n"));
            }
        }
        if p.in_flight_tasks.is_empty() {
            s.push_str("  in flight: nothing\n");
        } else {
            s.push_str(&format!(
                "  in flight ({} task(s) — DO NOT RE-DISPATCH these):\n",
                p.in_flight_tasks.len()
            ));
            for t in &p.in_flight_tasks {
                s.push_str(&format!(
                    "    - {}{} (started {})\n",
                    t.title,
                    t.idea_id
                        .as_deref()
                        .map(|i| format!(" [idea {i}]"))
                        .unwrap_or_default(),
                    t.started_at.as_deref().unwrap_or("not yet — queued"),
                ));
            }
        }
        s.push_str(&format!(
            "  context map: {} context(s), newest {}\n",
            p.context_count,
            p.context_newest_at.as_deref().unwrap_or("unknown")
        ));
        match p.kpi_coverage_gap {
            Some(n) => s.push_str(&format!("  contexts with no active KPI: {n}\n")),
            None => s.push_str("  KPI coverage: not measured this wake\n"),
        }
    }
    s.push('\n');

    // --- The output contract ---
    s.push_str(&format!(
        "ANSWER WITH ONE JSON OBJECT AND NOTHING ELSE — no prose before or after, \
         no code fence:\n\
         {{\"dispatch\":[{{\"charterId\":\"<one of the ids above>\",\
         \"reason\":\"why this one, this wake\",\
         \"brief\":\"what specifically to do\"}}],\
         \"defer\":[{{\"charterId\":\"...\",\"reason\":\"why it waits\"}}],\
         \"asks\":[{{\"kind\":\"{ASK_ACCEPT_IDEAS}\",\
         \"title\":\"<the question, at most {MAX_ASK_TITLE_CHARS} characters>\",\
         \"why\":\"<why the loop cannot move without it, at most \
         {MAX_ASK_WHY_CHARS} characters>\",\
         \"ideaIds\":[\"<ids copied from the list above>\"],\
         \"options\":[\"<what the operator may choose>\"]}}],\
         \"note\":\"<what your next wake should know about coverage, \
         at most {MAX_NOTE_CHARS} characters>\",\
         \"nextWakeMinutes\":<integer {MIN_NEXT_WAKE_MINUTES}-{MAX_NEXT_WAKE_MINUTES}, \
         or omit this field>}}\n\
         `dispatch` may be empty, and so may `asks` — omit `asks` entirely when \
         nothing needs a person. Charter ids must be copied exactly from the \
         list above; an invented id is dropped.\n"
    ));
    s
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn charter(id: &str, priority: Option<u8>) -> DecisionCharter {
        DecisionCharter {
            id: id.into(),
            title: format!("Charter {id}"),
            priority,
            ..Default::default()
        }
    }

    fn roster() -> Vec<DecisionCharter> {
        vec![
            charter("r1", None),
            charter("r2", Some(1)),
            charter("r3", Some(3)),
            charter("r4", None),
        ]
    }

    // -- parse: fences and JSON extraction ---------------------------------

    #[test]
    fn parse_strips_fences_and_surrounding_prose() {
        let raw = "Here is my plan.\n```json\n{\"dispatch\":[{\"charterId\":\"r1\",\
                   \"reason\":\"because\",\"brief\":\"do it\"}],\"defer\":[],\
                   \"note\":\"covered r1\"}\n```\nThat's all.";
        let plan = parse_decision(raw, &roster(), 3).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r1");
        assert_eq!(plan.dispatch[0].reason, "because");
        assert_eq!(plan.dispatch[0].brief, "do it");
        assert_eq!(plan.note.as_deref(), Some("covered r1"));

        // Bare object, no fence, no prose.
        let bare = "{\"dispatch\":[{\"charterId\":\"r2\"}]}";
        let plan = parse_decision(bare, &roster(), 3).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        // snake_case is accepted as well as the camelCase the prompt asks for.
        let snake = "{\"dispatch\":[{\"charter_id\":\"r2\"}]}";
        assert_eq!(
            parse_decision(snake, &roster(), 3)
                .expect("parses")
                .dispatch[0]
                .charter_id,
            "r2"
        );
        // Absent reason/brief are empty strings, not a parse failure — the
        // dispatch still carries the charter's own standing task text.
        assert_eq!(plan.dispatch[0].reason, "");
        assert_eq!(plan.dispatch[0].brief, "");
    }

    #[test]
    fn parse_rejects_empty_and_unparseable_replies() {
        assert_eq!(parse_decision("", &roster(), 3), Err(DecisionError::Empty));
        assert_eq!(
            parse_decision("   \n  ", &roster(), 3),
            Err(DecisionError::Empty)
        );
        assert!(matches!(
            parse_decision("I could not decide, sorry.", &roster(), 3),
            Err(DecisionError::NoJson(_))
        ));
        assert!(matches!(
            parse_decision("{\"dispatch\": \"not an array\"}", &roster(), 3),
            Err(DecisionError::Malformed(_))
        ));
    }

    // -- parse: unknown ids -------------------------------------------------

    #[test]
    fn parse_drops_unknown_charter_ids_but_keeps_the_known_ones() {
        let raw = "{\"dispatch\":[{\"charterId\":\"nope\"},{\"charterId\":\"r1\"}],\
                   \"defer\":[{\"charterId\":\"ghost\",\"reason\":\"x\"},\
                   {\"charterId\":\"r3\",\"reason\":\"later\"}]}";
        let plan = parse_decision(raw, &roster(), 5).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r1");
        assert_eq!(plan.defer.len(), 1);
        assert_eq!(plan.defer[0].charter_id, "r3");
        // Both invented ids are recorded so the ledger shows it happened.
        assert_eq!(plan.dropped_unknown, vec!["nope", "ghost"]);
    }

    #[test]
    fn parse_refuses_a_plan_whose_every_dispatch_id_is_invented() {
        let raw = "{\"dispatch\":[{\"charterId\":\"nope\"},{\"charterId\":\"also-nope\"}]}";
        assert_eq!(
            parse_decision(raw, &roster(), 5),
            Err(DecisionError::NoKnownCharters(vec![
                "nope".into(),
                "also-nope".into()
            ])),
            "a plan that named work and got every id wrong was not reading the roster"
        );
        // …but an EMPTY dispatch list is a legitimate answer, not a failure.
        let plan = parse_decision(
            "{\"dispatch\":[],\"note\":\"nothing worth a slot\"}",
            &roster(),
            5,
        )
        .expect("empty dispatch is a decision");
        assert!(plan.dispatch.is_empty());
        assert_eq!(plan.note.as_deref(), Some("nothing worth a slot"));
    }

    // -- parse: dedupe ------------------------------------------------------

    #[test]
    fn parse_dedupes_by_charter_id_keeping_the_first_mention() {
        let raw = "{\"dispatch\":[{\"charterId\":\"r1\",\"reason\":\"first\"},\
                   {\"charterId\":\"r1\",\"reason\":\"second\"},\
                   {\"charterId\":\" r1 \",\"reason\":\"third, padded\"}]}";
        let plan = parse_decision(raw, &roster(), 5).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].reason, "first");
    }

    // -- parse: capacity ----------------------------------------------------

    #[test]
    fn parse_caps_dispatch_to_free_capacity_and_reports_the_trim() {
        let raw = "{\"dispatch\":[{\"charterId\":\"r1\"},{\"charterId\":\"r4\"},\
                   {\"charterId\":\"r3\"}]}";
        let plan = parse_decision(raw, &roster(), 2).expect("parses");
        assert_eq!(plan.dispatch.len(), 2);
        assert_eq!(plan.trimmed_for_capacity, 1);

        // Zero capacity dispatches nothing but still parses — the deferrals and
        // the coverage note are still worth writing back.
        let plan = parse_decision(raw, &roster(), 0).expect("parses");
        assert!(plan.dispatch.is_empty());
        assert_eq!(plan.trimmed_for_capacity, 3);
    }

    /// The operator's rule is "at most 2 parallel sessions per project", and a
    /// wake with one fleet worker already in the air has ONE slot left — no
    /// matter how many charters the model names. The dispatch is bounded twice
    /// (the prompt states the number, the parser enforces it) and this is the
    /// half that does not depend on the model reading its instructions.
    #[test]
    fn a_plan_naming_four_charters_dispatches_one_when_a_fleet_worker_holds_a_slot() {
        // max_concurrent = 2, one active fleet worker, no executions
        // → `decide_capacity_from` yields free = 1.
        let free_capacity = 1;
        let raw = "{\"dispatch\":[{\"charterId\":\"r1\"},{\"charterId\":\"r2\"},\
                   {\"charterId\":\"r3\"},{\"charterId\":\"r4\"}]}";
        let plan = parse_decision(raw, &roster(), free_capacity).expect("parses");
        assert_eq!(plan.dispatch.len(), 1, "one slot, one dispatch");
        assert_eq!(plan.trimmed_for_capacity, 3);
        // …and the one it keeps is the highest priority named, not the first.
        assert_eq!(plan.dispatch[0].charter_id, "r2", "priority 1");
    }

    // -- parse: priority ordering -------------------------------------------

    #[test]
    fn parse_puts_explicit_priorities_first_and_leaves_the_rest_in_model_order() {
        // Model order: r1 (none), r3 (prio 3), r4 (none), r2 (prio 1).
        let raw = "{\"dispatch\":[{\"charterId\":\"r1\"},{\"charterId\":\"r3\"},\
                   {\"charterId\":\"r4\"},{\"charterId\":\"r2\"}]}";
        let plan = parse_decision(raw, &roster(), 10).expect("parses");
        let ids: Vec<&str> = plan
            .dispatch
            .iter()
            .map(|i| i.charter_id.as_str())
            .collect();
        assert_eq!(
            ids,
            vec!["r2", "r3", "r1", "r4"],
            "priority 1 then 3, then the unranked pair in the order the model gave them"
        );

        // And the cap is applied AFTER the sort, so a capacity of 1 keeps the
        // highest-priority charter rather than whichever the model listed first.
        let plan = parse_decision(raw, &roster(), 1).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r2");
    }

    // -- parse: bounds ------------------------------------------------------

    #[test]
    fn parse_bounds_every_string_it_carries_forward() {
        let long = "x".repeat(5_000);
        let raw = serde_json::json!({
            "dispatch": [{ "charterId": "r1", "reason": long, "brief": long }],
            "defer": [{ "charterId": "r2", "reason": long }],
            "note": long,
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 5).expect("parses");
        assert_eq!(plan.dispatch[0].reason.chars().count(), MAX_REASON_CHARS);
        assert_eq!(plan.dispatch[0].brief.chars().count(), MAX_BRIEF_CHARS);
        assert_eq!(plan.defer[0].reason.chars().count(), MAX_REASON_CHARS);
        assert_eq!(
            plan.note.as_ref().unwrap().chars().count(),
            MAX_NOTE_CHARS,
            "an unbounded note would grow the charter's spec one wake at a time"
        );
    }

    // -- parse: the plan's own next wake -----------------------------------

    #[test]
    fn parse_reads_and_clamps_the_plans_chosen_next_wake() {
        let plan_for = |v: &str| {
            parse_decision(
                &format!("{{\"dispatch\":[{{\"charterId\":\"r1\"}}],\"nextWakeMinutes\":{v}}}"),
                &roster(),
                3,
            )
            .expect("parses")
            .next_wake_minutes
        };

        // In range: taken as given.
        assert_eq!(plan_for("15"), Some(15));
        assert_eq!(plan_for("240"), Some(MAX_NEXT_WAKE_MINUTES));
        assert_eq!(plan_for("10"), Some(MIN_NEXT_WAKE_MINUTES));

        // Out of range: CLAMPED, never rejected — the dispatch list survives.
        assert_eq!(plan_for("1"), Some(MIN_NEXT_WAKE_MINUTES));
        assert_eq!(plan_for("0"), Some(MIN_NEXT_WAKE_MINUTES));
        assert_eq!(plan_for("-30"), Some(MIN_NEXT_WAKE_MINUTES));
        assert_eq!(plan_for("100000"), Some(MAX_NEXT_WAKE_MINUTES));

        // The clamp never costs the plan its work.
        let plan = parse_decision(
            "{\"dispatch\":[{\"charterId\":\"r1\"}],\"nextWakeMinutes\":100000}",
            &roster(),
            3,
        )
        .expect("parses");
        assert_eq!(plan.dispatch.len(), 1, "a silly sleep is not a bad plan");

        // snake_case is accepted here too, same as `charter_id`.
        assert_eq!(
            parse_decision("{\"dispatch\":[],\"next_wake_minutes\":90}", &roster(), 3)
                .expect("parses")
                .next_wake_minutes,
            Some(90)
        );
    }

    #[test]
    fn parse_ignores_a_next_wake_that_is_not_an_integer() {
        for v in [
            "\"30 minutes\"",
            "\"30\"",
            "22.5",
            "null",
            "{\"minutes\":30}",
            "[30]",
            "true",
        ] {
            let plan = parse_decision(
                &format!("{{\"dispatch\":[{{\"charterId\":\"r1\"}}],\"nextWakeMinutes\":{v}}}"),
                &roster(),
                3,
            )
            .expect("a bad sleep value must not cost the plan its dispatch");
            assert_eq!(
                plan.next_wake_minutes, None,
                "{v} is not a choice — the previous pacing stands"
            );
            assert_eq!(plan.dispatch.len(), 1, "for {v}");
        }

        // An absent field is the same: silence, not zero.
        assert_eq!(
            parse_decision("{\"dispatch\":[]}", &roster(), 3)
                .expect("parses")
                .next_wake_minutes,
            None
        );
    }

    #[test]
    fn newest_next_wake_takes_the_most_recent_stamp() {
        // The newest stamp wins even when it is not the largest number.
        assert_eq!(
            newest_next_wake_minutes([
                (Some("2026-09-06T10:00:00Z"), Some(200)),
                (Some("2026-09-07T02:00:00Z"), Some(15)),
                (Some("2026-09-05T10:00:00Z"), Some(90)),
            ]),
            Some(15)
        );
        // A charter carrying no choice at all is skipped, not counted as zero.
        assert_eq!(
            newest_next_wake_minutes([
                (Some("2026-09-07T02:00:00Z"), None),
                (Some("2026-09-06T10:00:00Z"), Some(60)),
            ]),
            Some(60)
        );
        // A choice with no stamp sorts oldest but is still an answer.
        assert_eq!(newest_next_wake_minutes([(None, Some(45))]), Some(45));
        assert_eq!(
            newest_next_wake_minutes([(None, Some(45)), (Some("2026-01-01T00:00:00Z"), Some(20))]),
            Some(20)
        );
        // Nothing anywhere is None, never a default.
        assert_eq!(newest_next_wake_minutes([(Some("x"), None)]), None);
        assert_eq!(newest_next_wake_minutes([]), None);
    }

    // -- parse: the asks ----------------------------------------------------

    /// The whole point of the channel: a plan that dispatched nothing still
    /// carries a question, and every field survives the parse intact.
    #[test]
    fn parse_reads_an_ask_beside_an_empty_dispatch() {
        let raw = serde_json::json!({
            "dispatch": [],
            "asks": [{
                "kind": "accept_ideas",
                "title": "27 ideas are waiting on your triage",
                "why": "delivery starves without accepts",
                "ideaIds": ["297f6ba4", "DEADBEEF12"],
                "options": ["Accept all", "Let me pick"],
            }],
            "note": "operator-blocked",
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 3).expect("parses");
        assert!(plan.dispatch.is_empty());
        assert_eq!(plan.asks.len(), 1);
        let a = &plan.asks[0];
        assert_eq!(a.kind, ASK_ACCEPT_IDEAS);
        assert_eq!(a.title, "27 ideas are waiting on your triage");
        assert_eq!(a.why, "delivery starves without accepts");
        // Ids are normalised to lower case so the DB prefix match is not
        // case-dependent — the same rule `extract_idea_id_token` follows.
        assert_eq!(a.idea_ids, vec!["297f6ba4", "deadbeef12"]);
        assert_eq!(a.options, vec!["Accept all", "Let me pick"]);

        // snake_case rides too, and an absent `asks` is an empty list, never a
        // parse failure.
        let snake = "{\"dispatch\":[],\"asks\":[{\"kind\":\"unblock\",\"title\":\"t\",\
                     \"idea_ids\":[\"aabbccdd\"]}]}";
        assert_eq!(
            parse_decision(snake, &roster(), 3).expect("parses").asks[0].idea_ids,
            vec!["aabbccdd"]
        );
        assert!(parse_decision("{\"dispatch\":[]}", &roster(), 3)
            .expect("parses")
            .asks
            .is_empty());
    }

    #[test]
    fn parse_bounds_every_part_of_an_ask() {
        let long = "x".repeat(5_000);
        let raw = serde_json::json!({
            "dispatch": [],
            "asks": [{
                "kind": "accept_ideas",
                "title": long,
                "why": long,
                // 14 ids, one blank, one repeated, one padded.
                "ideaIds": ["a1", "", "  b2  ", "b2", "c3", "d4", "e5", "f6",
                            "g7", "h8", "i9", "j10", "k11", "l12"],
                "options": (0..12).map(|i| format!("option {i}")).collect::<Vec<_>>(),
            }],
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 3).expect("parses");
        let a = &plan.asks[0];
        assert_eq!(a.title.chars().count(), MAX_ASK_TITLE_CHARS);
        assert_eq!(a.why.chars().count(), MAX_ASK_WHY_CHARS);
        assert_eq!(
            a.idea_ids.len(),
            MAX_ASK_IDEA_IDS,
            "an unbounded id list is an unbounded lookup fan-out"
        );
        assert!(!a.idea_ids.iter().any(|i| i.is_empty()));
        assert_eq!(
            a.idea_ids.iter().filter(|i| *i == "b2").count(),
            1,
            "a repeated id is one id"
        );
        assert_eq!(a.options.len(), MAX_ASK_OPTIONS);

        // And a wake may raise at most MAX_ASKS questions.
        let many = serde_json::json!({
            "dispatch": [],
            "asks": (0..9).map(|i| serde_json::json!({ "title": format!("q{i}") }))
                .collect::<Vec<_>>(),
        })
        .to_string();
        assert_eq!(
            parse_decision(&many, &roster(), 3)
                .expect("parses")
                .asks
                .len(),
            MAX_ASKS
        );
    }

    /// An ask with no title is nothing to show a person; an unrecognised kind
    /// is still a question and must not cost the operator the question.
    #[test]
    fn parse_drops_titleless_asks_and_reads_an_unknown_kind_as_a_decision() {
        let raw = serde_json::json!({
            "dispatch": [],
            "asks": [
                { "kind": "accept_ideas", "title": "   ", "why": "no title" },
                { "kind": "escalate", "title": "Which vendor?" },
                { "title": "And this one has no kind at all" },
                // A same kind+title repeat inside one wake asked once.
                { "kind": "decision", "title": "which vendor?" },
            ],
        })
        .to_string();
        let plan = parse_decision(&raw, &roster(), 3).expect("parses");
        assert_eq!(plan.asks.len(), 2, "{:?}", plan.asks);
        assert_eq!(plan.asks[0].kind, ASK_DECISION);
        assert_eq!(plan.asks[0].title, "Which vendor?");
        assert_eq!(plan.asks[1].kind, ASK_DECISION);
    }

    #[test]
    fn an_open_ask_is_recognised_across_case_and_padding() {
        let open = vec![OpenAsk {
            review_id: "rev1".into(),
            kind: ASK_ACCEPT_IDEAS.into(),
            title: "27 ideas are waiting".into(),
            age_minutes: Some(120),
        }];
        assert!(ask_is_open(
            &ask(ASK_ACCEPT_IDEAS, "  27 IDEAS are waiting "),
            &open
        ));
        // A different kind is a different question, even under the same title.
        assert!(!ask_is_open(
            &ask(ASK_UNBLOCK, "27 ideas are waiting"),
            &open
        ));
        assert!(!ask_is_open(
            &ask(ASK_ACCEPT_IDEAS, "something else"),
            &open
        ));
        assert!(!ask_is_open(&ask(ASK_ACCEPT_IDEAS, "anything"), &[]));
    }

    // -- the ask → review mapping ------------------------------------------

    #[test]
    fn an_accept_ideas_ask_becomes_a_review_the_operator_can_act_on() {
        let a = OperatorAsk {
            kind: ASK_ACCEPT_IDEAS.into(),
            title: "27 ideas are waiting on your triage".into(),
            why: "Delivery starves without accepts.".into(),
            idea_ids: vec!["297f6ba4".into()],
            // Options the model wrote are DELIBERATELY ignored for this kind.
            options: vec!["Sure, whatever".into()],
        };
        let ideas = vec![
            (
                "297f6ba4-1c2d-4e5f-8a9b-0c1d2e3f4a5b".to_string(),
                "Retire the legacy shim".to_string(),
            ),
            (
                "aabbccdd-0000-0000-0000-000000000000".to_string(),
                "Ship the retry helper".to_string(),
            ),
        ];
        let r = ask_to_review(&a, "p1", Some("proj_1"), Some("Ascent"), &ideas);

        assert_eq!(
            r.title, "App Master Ascent: 27 ideas are waiting on your triage",
            "the operator must see which surface is speaking"
        );
        assert_eq!(r.severity, "info");
        assert!(r
            .description
            .starts_with("Delivery starves without accepts."));
        assert!(
            r.description.contains("- 297f6ba4: Retire the legacy shim"),
            "the ideas are named by the prefix the app prints: {}",
            r.description
        );
        assert!(r.description.contains("- aabbccdd: Ship the retry helper"));
        assert!(!r.description.ends_with('\n'));

        // The three actions the resolve path keys on — not the model's wording.
        let actions: Vec<String> = serde_json::from_str(&r.suggested_actions).expect("json array");
        assert_eq!(
            actions,
            vec![ASK_ACCEPT_ACTION, ASK_REJECT_ACTION, ASK_LATER_ACTION]
        );

        let ctx: serde_json::Value = serde_json::from_str(&r.context_data).expect("json object");
        assert_eq!(ctx["source"], ASK_SOURCE);
        assert_eq!(ctx["personaId"], "p1");
        assert_eq!(ctx["projectId"], "proj_1");
        assert_eq!(ctx["kind"], ASK_ACCEPT_IDEAS);
        assert_eq!(
            ctx["askTitle"], "27 ideas are waiting on your triage",
            "the unprefixed title is what the duplicate check compares"
        );
        assert_eq!(
            ctx["ideaIds"],
            serde_json::json!([
                "297f6ba4-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
                "aabbccdd-0000-0000-0000-000000000000"
            ]),
            "context_data carries the RESOLVED ids — the resolve path acts on \
             these, so an unresolved id must never reach it"
        );
    }

    #[test]
    fn a_decision_ask_offers_the_options_it_was_given() {
        let a = OperatorAsk {
            kind: ASK_DECISION.into(),
            title: "Postgres or SQLite?".into(),
            why: "Both work; the cost profile differs.".into(),
            idea_ids: vec![],
            options: vec!["Postgres".into(), "SQLite".into()],
        };
        let r = ask_to_review(&a, "p1", Some("proj_1"), None, &[]);
        // No project NAME falls back to the id rather than dropping the prefix.
        assert_eq!(r.title, "App Master proj_1: Postgres or SQLite?");
        assert_eq!(r.description, "Both work; the cost profile differs.");
        let actions: Vec<String> = serde_json::from_str(&r.suggested_actions).expect("json array");
        assert_eq!(actions, vec!["Postgres", "SQLite"]);

        // …and with no project at all the prefix still names the speaker.
        let r = ask_to_review(&a, "p1", None, None, &[]);
        assert_eq!(r.title, "App Master: Postgres or SQLite?");
    }

    // -- the newest coverage note ------------------------------------------

    #[test]
    fn newest_coverage_note_takes_the_most_recent_non_blank_stamp() {
        assert_eq!(
            newest_coverage_note([
                (Some("2026-09-06T10:00:00Z"), Some("older")),
                (Some("2026-09-07T02:00:00Z"), Some("newest")),
                (Some("2026-09-05T10:00:00Z"), Some("oldest")),
            ])
            .as_deref(),
            Some("newest")
        );
        // A blank note is not a note, so it never wins by being newest.
        assert_eq!(
            newest_coverage_note([
                (Some("2026-09-07T02:00:00Z"), Some("   ")),
                (Some("2026-09-06T10:00:00Z"), Some("the real one")),
            ])
            .as_deref(),
            Some("the real one")
        );
        assert_eq!(newest_coverage_note([(Some("x"), None)]), None);
        assert_eq!(newest_coverage_note([]), None);
    }

    #[test]
    fn bound_cuts_on_a_char_boundary() {
        // 4 multi-byte chars; cutting at 2 must not split a code point.
        assert_eq!(bound("äöüß", 2), "äö");
        assert_eq!(bound("äöüß", 9), "äöüß");
    }

    // -- prompt -------------------------------------------------------------

    fn ctx_fixture() -> DecisionContext {
        DecisionContext {
            persona_id: "p1".into(),
            persona_name: "Ascent Master".into(),
            max_concurrent: 3,
            free_capacity: 2,
            running_executions: 0,
            running_fleet: 1,
            now_utc: "2026-09-07T02:30:00+00:00".into(),
            // Through the one door for model ids — a dated literal here would
            // rot the fixture the day the id retires.
            model: personas_core::model_ids::DEFAULT_STRONG.into(),
            charters: vec![
                DecisionCharter {
                    priority: Some(1),
                    recipe_slug: Some("keep-docs-honest".into()),
                    need: Some("docs drift from shipped behaviour".into()),
                    core_action: Some("compare docs to code".into()),
                    interval_minutes: Some(60),
                    pacing: Some(ResponsibilityPacing {
                        last_decided_at: Some("2026-09-06T10:00:00Z".into()),
                        last_dispatched_at: None,
                        coverage_note: Some("docs charter deferred twice".into()),
                        next_wake_minutes: Some(45),
                    }),
                    writes_code: true,
                    last_dispatch: Some(LastDispatch {
                        at: "2026-09-06T10:00:00Z".into(),
                        worker: "fleet".into(),
                        state: DISPATCH_FINISHED.into(),
                        summary: Some("shipped the parser".into()),
                    }),
                    ..charter("r2", Some(1))
                },
                charter("r1", None),
            ],
            projects: vec![ProjectSnapshot {
                project_id: "proj_1".into(),
                project_name: Some("Ascent".into()),
                undispatched_idea_count: 12,
                undispatched_ideas: vec![("idea_a".into(), "Retire the legacy shim".into())],
                in_flight_tasks: vec![InFlightTask {
                    idea_id: Some("idea_b".into()),
                    title: "Wire the connector".into(),
                    started_at: Some("2026-09-07T01:00:00Z".into()),
                }],
                pending_idea_count: 4,
                context_count: 208,
                context_newest_at: Some("2026-09-01T00:00:00Z".into()),
                kpi_coverage_gap: Some(41),
            }],
            open_asks: Vec::new(),
        }
    }

    fn ask(kind: &str, title: &str) -> OperatorAsk {
        OperatorAsk {
            kind: kind.into(),
            title: title.into(),
            why: "because".into(),
            ..Default::default()
        }
    }

    #[test]
    fn prompt_shows_in_flight_work_and_the_last_dispatch_outcome() {
        let p = render_decision_prompt(&ctx_fixture());

        // The rule, stated before the data — the same discipline the priority
        // and capacity rules follow.
        assert!(p.contains("is NOT in flight"));
        assert!(p.contains("do not re-dispatch them"));

        // The charter's last dispatch, with the state and what it declared.
        assert!(
            p.contains("last dispatch: 2026-09-06T10:00:00Z finished — shipped the parser"),
            "cycle 1 deferred a charter as in-flight 25 minutes after its \
             session reported done; the prompt must carry the end state:\n{p}"
        );
        // A charter never dispatched by the decide lane says nothing at all,
        // rather than an invented "unknown".
        assert_eq!(
            p.matches("last dispatch:").count(),
            1,
            "only the charter that HAS one reports one"
        );

        // The project's own in-flight work.
        assert!(p.contains("in flight (1 task(s)"));
        assert!(p.contains("Wire the connector [idea idea_b] (started 2026-09-07T01:00:00Z)"));
    }

    #[test]
    fn a_project_with_nothing_running_says_so_explicitly() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].in_flight_tasks.clear();
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("in flight: nothing"),
            "a measured empty is not the same as an absent line"
        );
    }

    #[test]
    fn a_queued_in_flight_task_says_it_has_not_started() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].in_flight_tasks = vec![InFlightTask {
            idea_id: None,
            title: "Sweep the census".into(),
            started_at: None,
        }];
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("Sweep the census (started not yet — queued)"));
        assert!(!p.contains("[idea "), "no idea id means no bracket at all");
    }

    // -- idea-id extraction (pure) ------------------------------------------

    #[test]
    fn extract_idea_id_prefers_a_full_uuid_and_accepts_a_printed_prefix() {
        let uuid = "297f6ba4-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
        assert_eq!(
            extract_idea_id_token(&format!("Deliver idea {uuid} on its own branch.")),
            Some(uuid.to_string())
        );
        // The 8-char prefix the app prints everywhere.
        assert_eq!(
            extract_idea_id_token("Deliver the accepted idea 297f6ba4 (the retry helper)."),
            Some("297f6ba4".into())
        );
        // A full uuid beats a bare prefix even when the prefix comes first.
        assert_eq!(
            extract_idea_id_token(&format!("deadbeef … but really {uuid}")),
            Some(uuid.to_string())
        );
        // Case is normalised so the DB prefix match is not case-dependent.
        assert_eq!(
            extract_idea_id_token("idea 297F6BA4"),
            Some("297f6ba4".into())
        );
    }

    #[test]
    fn extract_idea_id_returns_nothing_when_the_brief_names_no_id() {
        assert_eq!(extract_idea_id_token(""), None);
        assert_eq!(
            extract_idea_id_token("Review the overview dashboard and tighten its loading states."),
            None
        );
        // Too short to be anything anybody printed.
        assert_eq!(extract_idea_id_token("see face and bad"), None);
    }

    #[test]
    fn prompt_states_the_priority_rule_capacity_and_every_charter_id() {
        let p = render_decision_prompt(&ctx_fixture());

        // The standing question and the persona's own name.
        assert!(p.contains("which of my responsibilities moves this project"));
        assert!(p.contains("Ascent Master"));

        // The priority rule, including what an ABSENT priority means — the
        // half a model gets wrong if you only tell it "1 is highest".
        assert!(p.contains("1 = highest"));
        assert!(p.contains("nobody ranked it and the judgment is yours"));
        assert!(p.contains("none declared — your judgment"), "for r1");
        assert!(p.contains("priority: 1"), "for r2");

        // Capacity, as a number the parser will actually enforce.
        assert!(p.contains("AT MOST 2 charter(s)"));
        assert!(p.contains("your parallel capacity is 3"));

        // Every charter id is present and copyable.
        assert!(p.contains("id: r1"));
        assert!(p.contains("id: r2"));

        // Coverage memory from the previous wake.
        assert!(p.contains("docs charter deferred twice"));
        assert!(p.contains("last decided 2026-09-06T10:00:00Z"));
        assert!(p.contains("last dispatched never"));
        assert!(p.contains("coverage: never decided on"), "for r1");

        // Project state, including the numbers.
        assert!(p.contains("accepted ideas with no task: 12"));
        assert!(p.contains("pending ideas: 4"));
        assert!(p.contains("idea_a: Retire the legacy shim"));
        assert!(p.contains("208 context(s)"));
        assert!(p.contains("contexts with no active KPI: 41"));

        // The code-authoring charter is told where its run will stand.
        assert!(p.contains("ISOLATED git worktree"));

        // The output contract, matching what `parse_decision` reads.
        assert!(p.contains("ONE JSON OBJECT"));
        assert!(p.contains("\"charterId\""));
        assert!(p.contains("\"dispatch\""));
        assert!(p.contains("\"defer\""));
        assert!(p.contains(&MAX_NOTE_CHARS.to_string()));
    }

    /// The CAPACITY line must show the persona WHERE its missing slots went.
    /// Before 2026-09-07 a fleet worker was in nobody's count, so a persona
    /// could read "2 free" while two of its own workers were on screen in the
    /// fleet grid — and the only thing keeping it to its limit was its own
    /// reading of the ledger.
    #[test]
    fn prompt_breaks_capacity_down_into_executions_and_fleet_workers() {
        let mut ctx = ctx_fixture();
        ctx.max_concurrent = 2;
        ctx.free_capacity = 1;
        ctx.running_executions = 0;
        ctx.running_fleet = 1;
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains(
                "AT MOST 1 charter(s) this wake (your parallel capacity is 2; 0 \
                 execution(s) and 1 fleet worker(s) of yours are running)"
            ),
            "{p}"
        );

        // Both halves are printed, including an idle one — "0 of each" is the
        // statement that nothing is holding a slot, which is not the same as
        // saying nothing.
        let mut ctx = ctx_fixture();
        ctx.running_executions = 2;
        ctx.running_fleet = 0;
        let p = render_decision_prompt(&ctx);
        assert!(
            p.contains("2 execution(s) and 0 fleet worker(s) of yours are running"),
            "{p}"
        );
    }

    #[test]
    fn prompt_never_prints_a_figure_it_did_not_measure() {
        let mut ctx = ctx_fixture();
        ctx.projects[0].kpi_coverage_gap = None;
        ctx.projects[0].context_newest_at = None;
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("KPI coverage: not measured this wake"));
        assert!(!p.contains("contexts with no active KPI: 0"));
        assert!(p.contains("newest unknown"));
    }

    #[test]
    fn prompt_is_honest_about_unlimited_concurrency_and_an_empty_roster() {
        let mut ctx = ctx_fixture();
        ctx.max_concurrent = 0;
        ctx.charters.clear();
        ctx.projects.clear();
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("parallel capacity is unlimited"));
        assert!(p.contains("(none — dispatch nothing)"));
        assert!(p.contains("(no project state could be read this wake)"));
    }

    /// The persona cannot reason about elapsed time without a "now", and it
    /// cannot pace itself without seeing what it last chose.
    #[test]
    fn prompt_shows_the_clock_and_the_sleep_the_persona_last_chose() {
        let p = render_decision_prompt(&ctx_fixture());
        assert!(
            p.contains("RIGHT NOW (UTC): 2026-09-07T02:30:00+00:00"),
            "{p}"
        );
        assert!(
            p.contains("You chose to sleep 45 minutes after your last wake."),
            "{p}"
        );

        // The rule and the field are both stated, with the same bounds the
        // parser enforces.
        assert!(p.contains("`nextWakeMinutes`"));
        assert!(p.contains("Omit the field to keep your current pacing"));
        assert!(
            p.contains("\"nextWakeMinutes\""),
            "the JSON skeleton carries it"
        );
        assert!(p.contains(&MIN_NEXT_WAKE_MINUTES.to_string()));
        assert!(p.contains(&MAX_NEXT_WAKE_MINUTES.to_string()));
    }

    #[test]
    fn prompt_prints_no_clock_and_no_sleep_it_was_not_given() {
        let mut ctx = ctx_fixture();
        ctx.now_utc = String::new();
        for c in &mut ctx.charters {
            if let Some(p) = c.pacing.as_mut() {
                p.next_wake_minutes = None;
            }
        }
        let p = render_decision_prompt(&ctx);
        assert!(!p.contains("RIGHT NOW"), "an unread clock prints nothing");
        assert!(
            !p.contains("You chose to sleep"),
            "no previous choice is not a choice of zero"
        );
        // The RULE still stands — it is what asks for the next one.
        assert!(p.contains("YOUR NEXT WAKE"));
    }

    /// The rule and the field must both be stated, or a persona that is blocked
    /// on a person has been told to ask and given nowhere to put the ask.
    #[test]
    fn prompt_states_the_ask_rule_and_the_ask_field() {
        let p = render_decision_prompt(&ctx_fixture());
        assert!(p.contains("ASK WHEN BLOCKED"), "{p}");
        assert!(p.contains("Do not ask for what you can decide yourself"));
        assert!(p.contains("Do not repeat an ask that is still open"));
        assert!(p.contains(ASK_ACCEPT_IDEAS));
        assert!(p.contains(ASK_UNBLOCK));
        // The JSON skeleton the parser actually reads.
        assert!(p.contains("\"asks\""));
        assert!(p.contains("\"ideaIds\""));
        assert!(p.contains("omit `asks` entirely when nothing needs a person"));
    }

    /// "Do not repeat an ask that is still open" is only actionable if the
    /// persona can see which asks ARE still open.
    #[test]
    fn prompt_lists_the_asks_already_with_the_operator() {
        let mut ctx = ctx_fixture();
        ctx.open_asks = vec![
            OpenAsk {
                review_id: "rev1".into(),
                kind: ASK_ACCEPT_IDEAS.into(),
                title: "27 ideas are waiting on your triage".into(),
                age_minutes: Some(310),
            },
            OpenAsk {
                review_id: "rev2".into(),
                kind: ASK_UNBLOCK.into(),
                title: "Grant push access to origin".into(),
                age_minutes: None,
            },
        ];
        let p = render_decision_prompt(&ctx);
        assert!(p.contains("ALREADY WITH THE OPERATOR (do not ask these again)"));
        assert!(
            p.contains(
                "- [accept_ideas] 27 ideas are waiting on your triage — waiting 310 minute(s)"
            ),
            "{p}"
        );
        // An age nobody could compute prints no age, not a fabricated zero.
        assert!(
            p.contains("- [unblock] Grant push access to origin\n"),
            "{p}"
        );
        assert!(!p.contains("waiting 0 minute(s)"));

        // With nothing open the section is absent entirely rather than an
        // empty heading the model has to interpret.
        assert!(!render_decision_prompt(&ctx_fixture()).contains("ALREADY WITH THE OPERATOR"));
    }

    #[test]
    fn prompt_is_pure() {
        let ctx = ctx_fixture();
        assert_eq!(render_decision_prompt(&ctx), render_decision_prompt(&ctx));
    }

    /// The prompt and the parser must agree about the id vocabulary: every id
    /// the prompt shows is one the parser accepts, and the JSON skeleton the
    /// prompt prints is one the parser reads.
    #[test]
    fn prompt_and_parser_agree_on_the_contract() {
        let ctx = ctx_fixture();
        let _ = render_decision_prompt(&ctx);
        let reply = serde_json::json!({
            "dispatch": [{ "charterId": "r2", "reason": "highest priority", "brief": "sweep docs" }],
            "defer": [{ "charterId": "r1", "reason": "covered last wake" }],
            "note": "r1 deferred once",
        })
        .to_string();
        let plan = parse_decision(&reply, &ctx.charters, ctx.free_capacity).expect("parses");
        assert_eq!(plan.dispatch.len(), 1);
        assert_eq!(plan.dispatch[0].charter_id, "r2");
        assert_eq!(plan.defer.len(), 1);
        assert!(plan.dropped_unknown.is_empty());
    }
}
