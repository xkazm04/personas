//! **App master memory** — the pure half of recall-into-the-night and
//! episodic write-back (`kp/docs/concepts/app-master.md` §8).
//!
//! Before this module existed the App master started every night amnesiac: the
//! unattended fleet worker's prompt carried **no recall of any kind** (the
//! task_executor arm has injected project memory since the backlog-memory loop
//! shipped; the FLEET/unattended arm injected nothing), and the persona
//! **accumulated nothing** across nights — a refusal it was given on Monday was
//! re-attempted on Tuesday, and a merged proposal taught the project nothing.
//!
//! No new store. Both lanes already exist and are hardened, and this module
//! only decides *what text* goes in front of the model and *what sentence* is
//! written back:
//!
//! - **project lane** — `personas_db::repos::dev_memories` (idempotent on
//!   `(project, source_kind, source_id)`, importance 1–10, no tiers, no decay).
//!   Outlives any one tenure: it is a fact about the repository.
//! - **persona lane** — `personas_db::repos::core::memories` (tiers
//!   core/active/working/archive, decay, claims, operator UI), read through
//!   `get_for_injection_v2` + [`personas_db::memory_recall::pack_by_budget`].
//!
//! # Governance (registry `agent-memory` / memory-governance)
//!
//! Everything this module composes is deliberately bounded:
//!
//! * **Nothing here writes tier `core`.** Core is user-pinned and always
//!   injected; an agent that can promote its own beliefs to always-injected has
//!   no forgetting curve. Every persona row composed here lands in the default
//!   (`working`) tier and earns `active` through the existing lifecycle.
//! * **Nothing here writes `preference`, and nothing here writes a claim about
//!   a human.** Agent-inferred claims about the OWNER go through the existing
//!   memory *proposal* lane, never auto-commit.
//! * **Nothing here self-modifies rules.** The mandate, the forbidden classes
//!   and the gate commands are operator-stated data; a memory row describes what
//!   happened, never what is henceforth allowed.
//! * Importance stays low (2–4 on the 1–5 persona scale): these are
//!   observations competing for a recall budget, not instructions.
//!
//! Everything here is pure so the composition is testable without a database —
//! the call sites (`app_lib`'s dispatch, overnight tick, reconciler and
//! probation carry-out) do the I/O and hand this module rows.

use personas_db::models::{DevMemory, PersonaMemory};

// ---------------------------------------------------------------------------
// Recall — budgets
// ---------------------------------------------------------------------------

/// Project-memory rows offered to one unattended dispatch. Parity with the
/// task_executor arm (`commands::infrastructure::task_executor`), deliberately:
/// two arms of the same loop showing the same project a different amount of its
/// own memory is a difference nobody could explain.
pub const PROJECT_MEMORY_ROWS: i64 = 12;

/// Character cap on the rendered project block. Same parity argument.
pub const PROJECT_MEMORY_BUDGET_CHARS: usize = 1_500;

/// Core-tier rows read for an App-master dispatch. Core is small **by
/// contract** (user-pinned identity: mission, rung, owner, budget), so it is
/// rendered verbatim rather than packed.
pub const PERSONA_CORE_ROWS: i64 = 6;

/// Active-tier candidate rows fetched before packing. The row cap bounds the
/// query; [`PERSONA_ACTIVE_BUDGET_CHARS`] bounds what actually ships.
pub const PERSONA_ACTIVE_ROWS: i64 = 60;

/// Character cap on the packed active tier. A third of the runner's 6k budget:
/// this block rides *inside* a worker task text that also carries the idea and
/// the guardrails, and neither of those may be pushed out.
pub const PERSONA_ACTIVE_BUDGET_CHARS: usize = 2_000;

const PROJECT_HEADING: &str = "## Project memory";
const PERSONA_HEADING: &str = "## Your memory (App master)";

// ---------------------------------------------------------------------------
// Recall — block composition
// ---------------------------------------------------------------------------

/// The `## Project memory` block, or `None` when the project has learned
/// nothing yet. `rendered` is
/// [`personas_db::repos::dev_memories::render_for_prompt`]'s output — already
/// budget-capped, one `- [category] title: content` line per memory.
///
/// Empty in, `None` out: an empty labelled section reads to a model as "this
/// project has a memory and it is blank", which is a claim, and scaffolding for
/// nothing costs tokens on every dispatch of every unmandated project.
pub fn project_memory_block(rendered: &str) -> Option<String> {
    let body = rendered.trim_end();
    if body.is_empty() {
        return None;
    }
    Some(format!(
        "{PROJECT_HEADING}\n\nWhat this repository has already learned, constraints first. \
Background facts about the project — not tonight's task, and not permission to widen it.\n\n\
{body}\n"
    ))
}

/// Render one persona memory as a single prompt line.
fn persona_line(m: &PersonaMemory) -> String {
    format!(
        "- **{}** _({} · importance {})_ — {}\n",
        m.title.trim(),
        m.category,
        m.importance,
        m.content.trim()
    )
}

/// The `## Your memory (App master)` block, or `None` when the persona has
/// accumulated nothing.
///
/// `core` is rendered verbatim (small by contract, always-include per MEMORY
/// CONTRACT (1)); `active` is expected to be the output of
/// [`personas_db::memory_recall::pack_by_budget`] and `omitted` its
/// `PackedRecall::omitted`. The omission line is not decoration: serving a
/// partial set silently reads as "this is everything you know", and an App
/// master that believes it has seen its whole memory will re-decide things it
/// already decided.
pub fn persona_memory_block(
    core: &[PersonaMemory],
    active: &[PersonaMemory],
    omitted: usize,
) -> Option<String> {
    if core.is_empty() && active.is_empty() {
        return None;
    }
    let mut out = String::from(PERSONA_HEADING);
    out.push_str(
        "\n\nWhat you have accumulated holding this app. Background — what you already \
tried, were refused, or decided. It does not replace tonight's task or the guardrails \
below it.\n",
    );
    if !core.is_empty() {
        out.push_str("\n### Core (always relevant)\n\n");
        for m in core {
            out.push_str(&persona_line(m));
        }
    }
    if !active.is_empty() {
        out.push_str("\n### Active (scored)\n\n");
        for m in active {
            out.push_str(&persona_line(m));
        }
    }
    if omitted > 0 {
        let plural = if omitted == 1 { "memory" } else { "memories" };
        out.push_str(&format!(
            "\n_[{omitted} lower-ranked active {plural} omitted to stay within the \
{PERSONA_ACTIVE_BUDGET_CHARS}-character memory budget.]_\n"
        ));
    }
    Some(out)
}

/// Compose the dispatch prompt an unattended worker is seeded with: the idea
/// first, then whichever recall blocks exist.
///
/// **Order is load-bearing.** The idea stays at the top (it is the task), the
/// memory follows as labelled background, and the caller then wraps the result
/// in `unattended::unattended_worktree_task_text`, which appends the guardrails
/// *last* — so the two things a worker must not lose (what to do, what it may
/// not do) bracket the recall rather than being buried by it.
///
/// With no blocks the return value is the prompt, byte for byte: a project that
/// has learned nothing dispatches exactly as it did before this existed.
pub fn compose_dispatch_prompt(
    prompt: &str,
    project_block: Option<&str>,
    persona_block: Option<&str>,
) -> String {
    let mut out = prompt.trim_end().to_string();
    for block in [project_block, persona_block].into_iter().flatten() {
        let block = block.trim_end();
        if block.is_empty() {
            continue;
        }
        out.push_str("\n\n");
        out.push_str(block);
    }
    out
}

// ---------------------------------------------------------------------------
// Write-back — the project lane (proposal episodes)
// ---------------------------------------------------------------------------

/// `dev_memories.source_kind` for every row the reconciler writes. Idempotency
/// is on `(project_id, source_kind, source_id)`, which is what makes a
/// re-reconcile — and the reconciler re-walks every known proposal every 30
/// minutes, forever — free.
pub const PROPOSAL_SOURCE_KIND: &str = "app_master_proposal";

/// A proposal's observed fate, as the reconciler witnessed it. Every variant
/// corresponds to something that actually happened on disk; nothing here is an
/// estimate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProposalEvent {
    /// The branch was recorded for the first time, carrying commits.
    Recorded { commits: usize },
    /// The branch's declared gates produced a tally at this tip.
    Gated {
        /// Short tip sha — part of the idempotency key, so a re-gate after the
        /// branch moves records a NEW tally instead of being suppressed as a
        /// duplicate of the old tip's.
        tip: String,
        passed: i64,
        /// Failures the proposal is answerable for (green on the baseline).
        failed: i64,
        /// Failures on commands already red on main — inherited debt, not this
        /// proposal's doing, and never written as its lesson.
        inherited_red: i64,
    },
    /// The tip was observed on the main branch.
    Merged { merge_sha: Option<String> },
    /// A merged proposal was reverted on the main branch.
    Reverted { revert_sha: String },
}

impl ProposalEvent {
    /// The `source_id` token for this event — `<branch>:<event>`, with the gate
    /// tip folded into the event token so per-tip tallies each get their own
    /// idempotent row.
    fn token(&self) -> String {
        match self {
            Self::Recorded { .. } => "recorded".into(),
            Self::Gated { tip, .. } => format!("gates@{}", short_sha(tip)),
            Self::Merged { .. } => "merged".into(),
            Self::Reverted { .. } => "reverted".into(),
        }
    }
}

fn short_sha(sha: &str) -> &str {
    let n = sha.len().min(7);
    &sha[..n]
}

/// One row ready for `dev_memories::record`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectMemoryDraft {
    /// `decision` or `constraint` — the two categories `get_for_injection`
    /// orders first, in that order.
    pub category: &'static str,
    pub title: String,
    pub content: String,
    /// 1–10 (the project lane's scale, wider than the persona lane's 1–5).
    pub importance: i32,
    /// `<branch>:<event>` — the idempotency key's second half.
    pub source_id: String,
}

/// Compose the project-memory row for one observed proposal event.
///
/// Importance ranks by *what the next dispatch needs to know first*: a revert
/// (8) is a lesson about work that was accepted and then taken back, a gate
/// failure the proposal is answerable for (7) is a repeatable mistake, a merge
/// (6) is a durable fact about the repository, a green tally (5) is a fact with
/// no lesson in it, and a newly recorded branch (4) is bookkeeping.
///
/// Content is one factual sentence. No adjective claims a quality nobody
/// measured, and an inherited red is named as inherited — a proposal must never
/// carry the repository's pre-existing debt as its own lesson.
pub fn proposal_memory(branch: &str, event: &ProposalEvent) -> ProjectMemoryDraft {
    let source_id = format!("{branch}:{}", event.token());
    let (category, importance, title, content) = match event {
        ProposalEvent::Recorded { commits } => (
            "decision",
            4,
            format!("Proposal opened: {branch}"),
            format!(
                "The App master opened proposal branch `{branch}` carrying {commits} commit(s). \
Branch-only: nothing was pushed or merged."
            ),
        ),
        ProposalEvent::Gated {
            tip,
            passed,
            failed,
            inherited_red,
        } => {
            let counted = passed + failed;
            let inherited = if *inherited_red > 0 {
                format!(
                    " {inherited_red} further command(s) were already red on the main branch and \
are inherited debt, not this proposal's."
                )
            } else {
                String::new()
            };
            if *failed > 0 {
                (
                    "constraint",
                    7,
                    format!("Gates failed on {branch}"),
                    format!(
                        "The repository's declared gates ran against `{branch}` at {} and \
{failed} of {counted} counted command(s) failed on gates that were green on main — those \
failures are the proposal's own.{inherited} Do not offer this branch for review until they \
are green.",
                        short_sha(tip)
                    ),
                )
            } else {
                (
                    "decision",
                    5,
                    format!("Gates green on {branch}"),
                    format!(
                        "The repository's declared gates ran against `{branch}` at {} and all \
{counted} counted command(s) passed.{inherited}",
                        short_sha(tip)
                    ),
                )
            }
        }
        ProposalEvent::Merged { merge_sha } => {
            let at = match merge_sha.as_deref().filter(|s| !s.trim().is_empty()) {
                Some(sha) => format!(" at merge commit {}", short_sha(sha)),
                // The reconciler records an undatable landing honestly rather
                // than inventing a sha; the memory says the same thing.
                None => " (landing commit not identifiable)".to_string(),
            };
            (
                "decision",
                6,
                format!("Proposal merged: {branch}"),
                format!(
                    "A human merged proposal branch `{branch}` into the main branch{at}. The \
approach it took is one this repository accepted."
                ),
            )
        }
        ProposalEvent::Reverted { revert_sha } => (
            "constraint",
            8,
            format!("Proposal reverted: {branch}"),
            format!(
                "Proposal branch `{branch}` was merged and then REVERTED on the main branch by \
{}. Merging is not acceptance: do not re-propose this approach without first establishing why \
it was taken back.",
                short_sha(revert_sha)
            ),
        ),
    };
    ProjectMemoryDraft {
        category,
        title,
        content,
        importance,
        source_id,
    }
}

// ---------------------------------------------------------------------------
// Write-back — the persona lane (night + probation episodes)
// ---------------------------------------------------------------------------

/// One row ready for `memories::batch_create`. Tier is deliberately absent:
/// `batch_create` writes the default (`working`) tier and the existing
/// lifecycle promotes what earns promotion. Nothing composed here may reach
/// `core`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonaMemoryDraft {
    /// `learned` or `constraint`. Never `preference` — see the module doc.
    pub category: &'static str,
    pub title: String,
    pub content: String,
    /// 1–5 (persona-lane scale). Kept at 2–4: observations, not instructions.
    pub importance: i32,
    pub tags: Vec<String>,
}

/// Why a night refused to dispatch, when it refused for a reason tomorrow needs
/// to know. Both are *standing* refusals — the mandate rung and the monthly
/// budget do not change overnight — which is exactly what makes them worth a
/// `constraint` row rather than a line in a log nobody re-reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NightRefusal {
    /// The App master mandate's scope rung is below what authoring needs.
    Mandate,
    /// The budget governor refused (hire budget or app-wide ceiling).
    Budget,
}

/// What one finished night's ledger row says, as the memory composer needs it.
#[derive(Debug, Clone)]
pub struct NightOutcome<'a> {
    pub project_name: &'a str,
    /// The ledger's night key (`YYYY-MM-DD`), which also keeps consecutive
    /// nights from colliding in the write-path content dedup.
    pub night: &'a str,
    pub dispatched: usize,
    pub accepted: usize,
    pub blocked_reason: Option<&'a str>,
    /// The governor degraded this project `full` → `suggest`.
    pub degraded: bool,
    pub refusal: Option<NightRefusal>,
}

/// Longest refusal sentence carried into a memory. The blocked reason is an
/// operator-facing paragraph; a memory row competes for a recall budget.
const MAX_REASON_CHARS: usize = 400;

fn clip(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() <= MAX_REASON_CHARS {
        return s.to_string();
    }
    let mut out: String = s.chars().take(MAX_REASON_CHARS).collect();
    out.push('…');
    out
}

/// Compose what a finished night taught the App master.
///
/// Always one `learned` row (importance 2 — a night is an observation, and the
/// decay curve should let a quiet one fade). Plus, when the night was refused
/// by the mandate or the budget, one `constraint` row (importance 3) carrying
/// WHY: that is the row that stops tomorrow's night from re-attempting a thing
/// it was already refused, which is the whole reason episodic capture is worth
/// its write.
pub fn night_memory_rows(outcome: &NightOutcome<'_>) -> Vec<PersonaMemoryDraft> {
    let tags = vec!["night".to_string(), outcome.project_name.to_string()];
    let mut summary = format!(
        "Night {} on {}: {} proposal(s) dispatched from {} accepted idea(s).",
        outcome.night, outcome.project_name, outcome.dispatched, outcome.accepted
    );
    if let Some(reason) = outcome.blocked_reason {
        summary.push_str(&format!(" Dispatch was blocked: {}", clip(reason)));
    }
    if outcome.degraded {
        summary.push_str(" Autopilot was degraded full → suggest by the budget governor.");
    }
    let mut rows = vec![PersonaMemoryDraft {
        category: "learned",
        title: format!("Night {} on {}", outcome.night, outcome.project_name),
        content: summary,
        importance: 2,
        tags: tags.clone(),
    }];

    if let Some(refusal) = outcome.refusal {
        let reason = outcome.blocked_reason.map(clip).unwrap_or_default();
        let (what, guidance) = match refusal {
            NightRefusal::Mandate => (
                "the App master mandate",
                "The mandate is operator-stated data and does not change overnight. Do not \
re-attempt authoring on this project until the owner raises the rung; escalate instead of \
retrying.",
            ),
            NightRefusal::Budget => (
                "the budget governor",
                "A cap-hit pauses, it does not complete. Do not re-attempt dispatch on this \
project this month without a new ceiling — unmeasured spend is not free spend.",
            ),
        };
        rows.push(PersonaMemoryDraft {
            category: "constraint",
            title: format!("{} refused the night on {}", what, outcome.project_name),
            content: format!(
                "On {}, {} refused this project's unattended dispatch. {reason} {guidance}",
                outcome.night, what
            ),
            importance: 3,
            tags,
        });
    }
    rows
}

/// Compose what a probation decision taught the App master.
///
/// One `learned` row at importance 4 — the highest this module writes, and
/// still below the 4–5 band the decay-forgetting pass exempts by operator
/// intent. A probation verdict is the single most consequential thing that
/// happens to a tenure; it should survive a long quiet stretch.
///
/// `verdict` is kp's three-valued backbone verdict where the decision path had
/// one; `None` renders as *not recorded*, never as a pass. `unmeasured` is the
/// backbone rules that had no reading — an `incomplete` verdict is only
/// actionable if the holder can see WHAT was not measured, so the list is
/// carried verbatim rather than summarised into a count.
pub fn probation_memory_row(
    project_name: &str,
    decision: &str,
    verdict: Option<&str>,
    unmeasured: &[String],
) -> PersonaMemoryDraft {
    let verdict_txt = match verdict.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) => format!("backbone verdict `{v}`"),
        None => "no backbone verdict recorded at decision time".to_string(),
    };
    let unmeasured_txt = if unmeasured.is_empty() {
        "Every backbone rule had a reading.".to_string()
    } else {
        format!(
            "Backbone rules with NO reading: {}. Those are coverage gaps, not zeros — nothing \
about them was proven either way.",
            unmeasured.join(", ")
        )
    };
    PersonaMemoryDraft {
        category: "learned",
        title: format!("Probation decision on {project_name}: {decision}"),
        content: format!(
            "The probation review on {project_name} was decided `{decision}` from a \
{verdict_txt}. {unmeasured_txt}"
        ),
        importance: 4,
        tags: vec!["probation".to_string()],
    }
}

// ---------------------------------------------------------------------------
// Small helpers the call sites share
// ---------------------------------------------------------------------------

/// The ids of the persona memories a dispatch actually injected — what
/// `increment_access_batch` must be called with. The access counters ARE the
/// decay signal (`memory_recall::decay_score` anchors age at `last_accessed_at`
/// and boosts on `access_count`), so skipping this write does not merely lose a
/// statistic: it starves decay, and every injected memory ages as if it had
/// never been used.
pub fn injected_ids(core: &[PersonaMemory], active: &[PersonaMemory]) -> Vec<String> {
    core.iter()
        .chain(active.iter())
        .map(|m| m.id.clone())
        .collect()
}

/// Rendered-project-memory convenience: `dev_memories::render_for_prompt` takes
/// the rows and the budget, and this pairs it with [`project_memory_block`] so
/// a call site is one line and the budget cannot drift between arms.
pub fn project_block_from_rows(rows: &[DevMemory]) -> Option<String> {
    personas_db::repos::dev_memories::render_for_prompt(rows, PROJECT_MEMORY_BUDGET_CHARS)
        .as_deref()
        .and_then(project_memory_block)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem(id: &str, title: &str, category: &str, importance: i32) -> PersonaMemory {
        PersonaMemory {
            id: id.into(),
            persona_id: "p1".into(),
            title: title.into(),
            content: format!("content of {title}"),
            category: category.into(),
            source_execution_id: None,
            importance,
            tags: None,
            tier: "active".into(),
            access_count: 0,
            last_accessed_at: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            use_case_id: None,
            home_team_id: None,
            derived_from: None,
            open_claim_count: 0,
            fact_key: None,
        }
    }

    // -- recall: presence / absence ------------------------------------------

    #[test]
    fn nothing_learned_means_no_block_at_all() {
        // Scaffolding for nothing is worse than nothing: an empty labelled
        // section is a claim, and it costs tokens on every dispatch.
        assert!(project_memory_block("").is_none());
        assert!(project_memory_block("   \n  ").is_none());
        assert!(persona_memory_block(&[], &[], 0).is_none());
        // …and the composed prompt is then byte-identical to the input.
        let prompt = "Fix the flaky retry test.";
        assert_eq!(compose_dispatch_prompt(prompt, None, None), prompt);
    }

    #[test]
    fn project_block_is_present_and_labelled_when_the_project_has_learned() {
        let block =
            project_memory_block("- [constraint] Do not delete tests: repair, never delete.\n")
                .expect("a non-empty render produces a block");
        assert!(block.starts_with(PROJECT_HEADING));
        assert!(block.contains("Do not delete tests"));
        // Labelled as background, not as a task or a permission.
        assert!(block.contains("not tonight's task"));
    }

    #[test]
    fn persona_block_renders_core_verbatim_and_announces_omissions() {
        let core = vec![mem("c1", "Mission", "fact", 5)];
        let active = vec![mem("a1", "Gate suite is slow", "learned", 3)];
        let block = persona_memory_block(&core, &active, 4).expect("block");
        assert!(block.starts_with(PERSONA_HEADING));
        assert!(block.contains("### Core (always relevant)"));
        assert!(block.contains("**Mission**"));
        assert!(block.contains("### Active (scored)"));
        assert!(block.contains("**Gate suite is slow**"));
        // The honesty line: a partial set never reads as the whole memory.
        assert!(block.contains("4 lower-ranked active memories omitted"));
        // Singular is not "1 memories".
        let one = persona_memory_block(&core, &active, 1).unwrap();
        assert!(one.contains("1 lower-ranked active memory omitted"));
        // No omissions ⇒ no omission line.
        let none = persona_memory_block(&core, &active, 0).unwrap();
        assert!(!none.contains("omitted"));
    }

    #[test]
    fn a_core_only_persona_still_gets_a_block() {
        let core = vec![mem("c1", "Mission", "fact", 5)];
        let block = persona_memory_block(&core, &[], 0).expect("core alone is a block");
        assert!(block.contains("### Core"));
        assert!(!block.contains("### Active"));
    }

    // -- recall: ordering + budget -------------------------------------------

    #[test]
    fn the_idea_stays_first_and_memory_never_displaces_it() {
        let project =
            project_memory_block("- [constraint] Never touch the gate config.\n").unwrap();
        let persona = persona_memory_block(&[mem("c1", "Mission", "fact", 5)], &[], 0).unwrap();
        let text =
            compose_dispatch_prompt("Fix the flaky retry test.", Some(&project), Some(&persona));
        // The task is the first thing the worker reads…
        assert!(text.starts_with("Fix the flaky retry test."));
        // …then project memory, then persona memory — and the caller appends
        // the guardrails after this, so both ends are intact.
        let p = text.find(PROJECT_HEADING).expect("project block present");
        let q = text.find(PERSONA_HEADING).expect("persona block present");
        assert!(p < q, "project memory precedes persona memory");
        assert!(text.find("Fix the flaky").unwrap() < p);
    }

    #[test]
    fn either_block_may_be_absent_independently() {
        let project = project_memory_block("- [decision] Ship behind a flag.\n").unwrap();
        let only_project = compose_dispatch_prompt("Task.", Some(&project), None);
        assert!(only_project.contains(PROJECT_HEADING));
        assert!(!only_project.contains(PERSONA_HEADING));

        let persona =
            persona_memory_block(&[], &[mem("a1", "Tried and failed", "learned", 3)], 0).unwrap();
        let only_persona = compose_dispatch_prompt("Task.", None, Some(&persona));
        assert!(!only_persona.contains(PROJECT_HEADING));
        assert!(only_persona.contains(PERSONA_HEADING));
    }

    #[test]
    fn the_persona_block_respects_its_character_budget() {
        // The pack is what enforces the budget; this pins that the block built
        // from a packed set stays inside it plus the fixed markup, so the
        // guardrails can never be pushed out of a worker's context by memory.
        let now = chrono::Utc::now();
        let candidates: Vec<PersonaMemory> = (0..40)
            .map(|i| {
                let mut m = mem(&format!("a{i}"), &format!("learning {i}"), "learned", 3);
                m.content = "x".repeat(300);
                m
            })
            .collect();
        let packed = personas_db::memory_recall::pack_by_budget(
            candidates,
            PERSONA_ACTIVE_BUDGET_CHARS,
            now,
        );
        assert!(packed.omitted > 0, "40 × 300 chars must not all fit in 2k");
        let block = persona_memory_block(&[], &packed.selected, packed.omitted).unwrap();
        // Budget + per-entry markup + the header/omission prose.
        assert!(
            block.len() < PERSONA_ACTIVE_BUDGET_CHARS + 1_200,
            "block was {} chars",
            block.len()
        );
    }

    #[test]
    fn injected_ids_covers_both_tiers() {
        let core = vec![mem("c1", "Mission", "fact", 5)];
        let active = vec![
            mem("a1", "One", "learned", 3),
            mem("a2", "Two", "learned", 3),
        ];
        assert_eq!(injected_ids(&core, &active), vec!["c1", "a1", "a2"]);
        assert!(injected_ids(&[], &[]).is_empty());
    }

    // -- write-back: the project lane ----------------------------------------

    #[test]
    fn proposal_events_get_distinct_idempotency_keys() {
        let b = "autopilot/fix-retry";
        let recorded = proposal_memory(b, &ProposalEvent::Recorded { commits: 2 });
        let merged = proposal_memory(b, &ProposalEvent::Merged { merge_sha: None });
        let reverted = proposal_memory(
            b,
            &ProposalEvent::Reverted {
                revert_sha: "abcdef1234".into(),
            },
        );
        assert_eq!(recorded.source_id, "autopilot/fix-retry:recorded");
        assert_eq!(merged.source_id, "autopilot/fix-retry:merged");
        assert_eq!(reverted.source_id, "autopilot/fix-retry:reverted");
        // Distinct keys ⇒ a re-reconcile writes each fate exactly once, and one
        // fate never overwrites another.
        let keys = [&recorded.source_id, &merged.source_id, &reverted.source_id];
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), 3);
    }

    #[test]
    fn a_regate_after_the_branch_moves_is_a_new_row_not_a_suppressed_duplicate() {
        let b = "autopilot/fix-retry";
        let first = proposal_memory(
            b,
            &ProposalEvent::Gated {
                tip: "1111111aaaa".into(),
                passed: 3,
                failed: 0,
                inherited_red: 0,
            },
        );
        let second = proposal_memory(
            b,
            &ProposalEvent::Gated {
                tip: "2222222bbbb".into(),
                passed: 2,
                failed: 1,
                inherited_red: 0,
            },
        );
        assert_eq!(first.source_id, "autopilot/fix-retry:gates@1111111");
        assert_ne!(first.source_id, second.source_id);
    }

    #[test]
    fn importance_ranks_a_revert_above_a_merge_and_a_failure_above_a_pass() {
        let b = "autopilot/x";
        let recorded = proposal_memory(b, &ProposalEvent::Recorded { commits: 1 });
        let green = proposal_memory(
            b,
            &ProposalEvent::Gated {
                tip: "aaaaaaa".into(),
                passed: 4,
                failed: 0,
                inherited_red: 0,
            },
        );
        let red = proposal_memory(
            b,
            &ProposalEvent::Gated {
                tip: "aaaaaaa".into(),
                passed: 1,
                failed: 3,
                inherited_red: 0,
            },
        );
        let merged = proposal_memory(
            b,
            &ProposalEvent::Merged {
                merge_sha: Some("ccccccc1".into()),
            },
        );
        let reverted = proposal_memory(
            b,
            &ProposalEvent::Reverted {
                revert_sha: "ddddddd1".into(),
            },
        );
        assert_eq!(recorded.importance, 4);
        assert_eq!(green.importance, 5);
        assert_eq!(merged.importance, 6);
        assert_eq!(red.importance, 7);
        assert_eq!(reverted.importance, 8);
        // A revert is a lesson; a merge is a fact.
        assert_eq!(reverted.category, "constraint");
        assert_eq!(red.category, "constraint");
        assert_eq!(merged.category, "decision");
        assert_eq!(green.category, "decision");
    }

    #[test]
    fn inherited_red_is_named_as_inherited_never_as_the_proposals_fault() {
        let m = proposal_memory(
            "autopilot/x",
            &ProposalEvent::Gated {
                tip: "aaaaaaa".into(),
                passed: 2,
                failed: 0,
                inherited_red: 3,
            },
        );
        // Nothing the proposal is answerable for failed, so this is not a
        // constraint against it…
        assert_eq!(m.category, "decision");
        // …and the debt is attributed to the repository, in words.
        assert!(m.content.contains("already red on the main branch"));
        assert!(m.content.contains("inherited debt"));
    }

    #[test]
    fn an_undatable_merge_says_so_instead_of_inventing_a_sha() {
        let m = proposal_memory("autopilot/x", &ProposalEvent::Merged { merge_sha: None });
        assert!(m.content.contains("landing commit not identifiable"));
        let m2 = proposal_memory(
            "autopilot/x",
            &ProposalEvent::Merged {
                merge_sha: Some("".into()),
            },
        );
        assert!(m2.content.contains("landing commit not identifiable"));
    }

    // -- write-back: the persona lane ----------------------------------------

    #[test]
    fn a_plain_night_writes_one_low_importance_learned_row() {
        let rows = night_memory_rows(&NightOutcome {
            project_name: "kp",
            night: "2026-08-27",
            dispatched: 2,
            accepted: 3,
            blocked_reason: None,
            degraded: false,
            refusal: None,
        });
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].category, "learned");
        assert_eq!(rows[0].importance, 2);
        assert_eq!(rows[0].tags, vec!["night".to_string(), "kp".to_string()]);
        assert!(rows[0].content.contains("2 proposal(s) dispatched"));
        // The night key is in the content, so two identical nights are not
        // collapsed by the write-path content dedup.
        assert!(rows[0].content.contains("2026-08-27"));
    }

    #[test]
    fn a_refused_night_also_writes_the_constraint_that_stops_tomorrow_retrying() {
        for (refusal, needle) in [
            (NightRefusal::Mandate, "raises the rung"),
            (NightRefusal::Budget, "does not complete"),
        ] {
            let rows = night_memory_rows(&NightOutcome {
                project_name: "kp",
                night: "2026-08-27",
                dispatched: 0,
                accepted: 4,
                blocked_reason: Some("the mandate grants rung 0; authoring needs rung 2"),
                degraded: matches!(refusal, NightRefusal::Budget),
                refusal: Some(refusal),
            });
            assert_eq!(rows.len(), 2);
            let c = &rows[1];
            assert_eq!(c.category, "constraint");
            assert_eq!(c.importance, 3);
            assert!(c.content.contains(needle), "missing guidance: {needle}");
            // The WHY is carried, not paraphrased away.
            assert!(c.content.contains("authoring needs rung 2"));
        }
    }

    #[test]
    fn a_long_blocked_reason_is_clipped_not_carried_whole() {
        let long = "x".repeat(2_000);
        let rows = night_memory_rows(&NightOutcome {
            project_name: "kp",
            night: "2026-08-27",
            dispatched: 0,
            accepted: 1,
            blocked_reason: Some(&long),
            degraded: false,
            refusal: None,
        });
        assert!(rows[0].content.chars().count() < MAX_REASON_CHARS + 200);
        assert!(rows[0].content.ends_with('…'));
    }

    #[test]
    fn a_probation_row_names_the_unmeasured_rules_and_never_reads_them_as_zero() {
        let unmeasured = vec!["delivery".to_string(), "gate pass rate".to_string()];
        let m = probation_memory_row("kp", "extended", Some("incomplete"), &unmeasured);
        assert_eq!(m.category, "learned");
        assert_eq!(m.importance, 4);
        assert_eq!(m.tags, vec!["probation".to_string()]);
        assert!(m.content.contains("`extended`"));
        assert!(m.content.contains("`incomplete`"));
        assert!(m.content.contains("delivery, gate pass rate"));
        assert!(m.content.contains("coverage gaps, not zeros"));
    }

    #[test]
    fn a_missing_verdict_is_said_not_defaulted_to_a_pass() {
        let m = probation_memory_row("kp", "activated", None, &[]);
        assert!(m.content.contains("no backbone verdict recorded"));
        assert!(!m.content.contains("`pass`"));
        assert!(m.content.contains("Every backbone rule had a reading."));
    }

    // -- governance ----------------------------------------------------------

    #[test]
    fn nothing_this_module_composes_is_core_or_a_preference() {
        // memory-governance: the agent may not promote its own beliefs to
        // always-injected, and may not auto-commit a `preference` (which in
        // this store is a claim about a person).
        let mut drafts = night_memory_rows(&NightOutcome {
            project_name: "kp",
            night: "2026-08-27",
            dispatched: 0,
            accepted: 1,
            blocked_reason: Some("budget"),
            degraded: true,
            refusal: Some(NightRefusal::Budget),
        });
        drafts.push(probation_memory_row("kp", "retired", Some("fail"), &[]));
        for d in &drafts {
            assert!(
                matches!(d.category, "learned" | "constraint"),
                "unexpected category {}",
                d.category
            );
            assert!(
                (2..=4).contains(&d.importance),
                "importance {}",
                d.importance
            );
        }
        // The project lane only ever writes the two categories its injection
        // query orders first.
        for event in [
            ProposalEvent::Recorded { commits: 1 },
            ProposalEvent::Merged { merge_sha: None },
            ProposalEvent::Reverted {
                revert_sha: "a".into(),
            },
        ] {
            let d = proposal_memory("autopilot/x", &event);
            assert!(matches!(d.category, "decision" | "constraint"));
        }
    }
}
