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
    /// The wall clock at gather time, RFC-3339 UTC. Carried rather than read
    /// inside the renderer so [`render_decision_prompt`] stays a pure function
    /// of its context — and so a prompt in a ledger can be reproduced exactly.
    /// Empty means the clock was not read; the prompt then prints no time at
    /// all rather than a fabricated one.
    pub now_utc: String,
    pub charters: Vec<DecisionCharter>,
    pub projects: Vec<ProjectSnapshot>,
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

/// A parsed, bounded, capacity-capped plan.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DecisionPlan {
    pub dispatch: Vec<DecisionItem>,
    pub defer: Vec<DecisionDeferral>,
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
struct WirePlan {
    #[serde(default)]
    dispatch: Vec<WireItem>,
    #[serde(default)]
    defer: Vec<WireItem>,
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

    Ok(DecisionPlan {
        dispatch,
        defer,
        note,
        next_wake_minutes,
        dropped_unknown,
        trimmed_for_capacity,
    })
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
        "- CAPACITY: you may dispatch AT MOST {} charter(s) this wake ({}). \
         Naming more is not an error — anything past the limit is dropped, \
         highest priority first — but it wastes the slot you actually have. \
         Dispatching FEWER, or none, is a legitimate answer.\n",
        ctx.free_capacity,
        if ctx.max_concurrent > 0 {
            format!("your parallel capacity is {}", ctx.max_concurrent)
        } else {
            "your parallel capacity is unlimited; this is the engine's free slots".to_string()
        }
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
    s.push_str(
        "- EVERY charter must appear exactly once, in `dispatch` or in `defer`. \
         A deferral with a reason is a decision; silence is not.\n\n",
    );

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
         \"note\":\"<what your next wake should know about coverage, \
         at most {MAX_NOTE_CHARS} characters>\",\
         \"nextWakeMinutes\":<integer {MIN_NEXT_WAKE_MINUTES}-{MAX_NEXT_WAKE_MINUTES}, \
         or omit this field>}}\n\
         `dispatch` may be empty. Charter ids must be copied exactly from the \
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
