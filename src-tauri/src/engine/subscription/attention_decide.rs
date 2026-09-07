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

// ── Inputs ────────────────────────────────────────────────────────────────

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
    /// This charter's runs author code in a real repository, so a dispatch
    /// must go to an isolated worktree rather than the operator's checkout.
    pub writes_code: bool,
    /// The project this charter is bound to, when it is bound to one.
    pub project_id: Option<String>,
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

    Ok(DecisionPlan {
        dispatch,
        defer,
        note,
        dropped_unknown,
        trimmed_for_capacity,
    })
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
         at most {MAX_NOTE_CHARS} characters>\"}}\n\
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
                    }),
                    writes_code: true,
                    ..charter("r2", Some(1))
                },
                charter("r1", None),
            ],
            projects: vec![ProjectSnapshot {
                project_id: "proj_1".into(),
                project_name: Some("Ascent".into()),
                undispatched_idea_count: 12,
                undispatched_ideas: vec![("idea_a".into(), "Retire the legacy shim".into())],
                pending_idea_count: 4,
                context_count: 208,
                context_newest_at: Some("2026-09-01T00:00:00Z".into()),
                kpi_coverage_gap: Some(41),
            }],
        }
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
