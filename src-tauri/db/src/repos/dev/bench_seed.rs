//! Headless bench seeding — the writer behind `POST /api/kp/test/seed-work`.
//!
//! # Why this exists
//!
//! The App-master bench (`docs/tests/appmaster-bench/run-protocol.md`) measures
//! the performance backbone over a real repository. Its §4 tells a human to
//! create five backlog ideas and let triage accept them, because the overnight
//! engine can only dispatch work that already exists. Bench sweeps #11 and #12
//! (2026-08-24) ran the whole loop with **nothing seeded**: every night
//! dispatched zero, so the delivery, durability, gate, violation and budget
//! lanes of the backbone stayed structurally unmeasured and no scenario could
//! pass on evidence. Nothing automated §4. This module does.
//!
//! # What "an accepted idea ready for dispatch" concretely is
//!
//! Read [`crate::repos::dev::ideas`] and the overnight engine together and the
//! answer is narrower than it looks:
//!
//! ```text
//! overnight::run_project_night
//!   → run_triage_rules_core(project)          // reads ideas with status = 'pending'
//!       → for each pending idea, first MATCHING ENABLED RULE wins
//!       → an `accept` rule ⇒ the id lands in `TriageRunOutcome::accepted_idea_ids`
//!   → dispatch is offered ONLY `triage.accepted_idea_ids`
//! ```
//!
//! So a row already sitting at `status = 'accepted'` is **never dispatched** by
//! a night: the night dispatches the ids *this pass* accepted, not the backlog's
//! standing accepted set. Seeding therefore has two halves, and both are
//! required or the seed is inert:
//!
//! 1. one `dev_ideas` row per item, written **`pending`** (the status triage
//!    reads) through [`crate::repos::dev::ideas::create_idea_deduped`] — the
//!    same guarded door every generated idea goes through, so the findings
//!    spine's idempotency guard governs a seed exactly as it governs a scan;
//! 2. one enabled `dev_triage_rules` row with action `accept` whose condition is
//!    `scan_type == headless_bench_seed`, which is the mechanical equivalent of
//!    the protocol's "or let the project's triage rules accept them".
//!
//! Everything downstream is untouched: the autopilot capability gate, the App
//! master mandate rung, the budget governor and its `full → suggest` degrade,
//! the fleet slot cap and the branch-only dispatch guardrail all still decide
//! whether a seeded idea becomes a proposal. Seeding creates **work**, never
//! **permission**.
//!
//! # Provenance
//!
//! `scan_type` is [`BENCH_SEED_SCAN_TYPE`] on every seeded row, and the
//! `dedup_key` is minted by the shared [`crate::repos::dev::ideas::scan_dedup_key`]
//! so it reads `scan:headless_bench_seed:bench:<normalized-title>`. Both are
//! durable columns, so a seeded idea is distinguishable from a scanned one for
//! the life of the row — including after it has been dispatched, merged and
//! reported. `scan_type` was chosen over `origin` deliberately: it is one of the
//! five fields `evaluate_conditions` can key a triage rule on, so the same
//! column that records the provenance is the one that makes the seed
//! dispatchable. (`origin` would work too, but `create_finding` validates it
//! against `FINDING_ORIGINS` and hands the row's lifecycle to a sensor sweep
//! that would keep re-measuring a bench task forever.)
//!
//! # What is deliberately NOT written
//!
//! A seed item may carry an `acceptance` command and a `trap` note — the bench
//! protocol's own bookkeeping. **Neither is written to the idea.**
//! `dispatch_prompt` renders `title`, `description`, `reasoning` and `evidence`
//! into the prompt the agent receives, and run-protocol §4.1 / §8 are explicit:
//! an agent told exactly which assertion will be run is being graded on a
//! different task, and a run whose operator leaked the acceptance command is
//! **invalid**. So the endpoint validates them, echoes them back to the caller
//! (whose journal is where the seed→idea mapping belongs) and stores neither.

use crate::models::TriageRule;
use crate::repos::dev::ideas::{create_idea_deduped, scan_dedup_key};
use crate::repos::dev::triage_rules::{create_triage_rule, list_triage_rules};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};

/// The provenance tag, written to `dev_ideas.scan_type` and carried inside the
/// `dedup_key`. Also the value the auto-accept triage rule matches on.
pub const BENCH_SEED_SCAN_TYPE: &str = "headless_bench_seed";

/// Dedup scope for [`scan_dedup_key`]: seeds are project-wide, not per-context.
pub const BENCH_SEED_SCOPE: &str = "bench";

/// The canonical category for a seeded task. Seeds are engineering work.
pub const BENCH_SEED_CATEGORY: &str = "technical";

/// The auto-accept rule's name. Identity for the idempotent ensure below — a
/// second seed call reuses the rule instead of stacking a duplicate.
pub const BENCH_SEED_RULE_NAME: &str = "Headless bench seed — auto-accept";

/// The rule's conditions, in `evaluate_conditions`' JSON vocabulary. Matches
/// ONLY rows this module wrote, so it can never sweep up the real backlog.
pub const BENCH_SEED_RULE_CONDITIONS: &str =
    r#"[{"field":"scan_type","op":"eq","value":"headless_bench_seed"}]"#;

/// Caps. A bench night dispatches at most a handful of fleet slots; 16 is well
/// past the five the protocol prescribes and far short of anything that could
/// be mistaken for a bulk import path.
pub const MAX_SEED_ITEMS: usize = 16;
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_DESCRIPTION_CHARS: usize = 4_000;
pub const MAX_ACCEPTANCE_CHARS: usize = 2_000;
pub const MAX_TRAP_CHARS: usize = 400;

/// One item to seed. `acceptance` and `trap` are accepted, validated, echoed —
/// and never persisted (see the module note).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchSeedItem {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub acceptance: Option<String>,
    #[serde(default)]
    pub trap: Option<String>,
}

/// The per-item answer. `accepted: true` means *this call wrote the row*; a
/// skipped item is `accepted: false` and always carries a `skippedReason`.
/// Never silent: every submitted item produces exactly one of these, in order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeededItem {
    /// Position in the submitted `items` array, so a caller can match answers
    /// back to inputs without relying on the title.
    pub index: usize,
    pub title: String,
    /// The `dev_ideas.id`. Present for a written row AND for a dedup skip (the
    /// id of the row that already held the key) — the bench needs the mapping
    /// either way.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub accepted: bool,
    pub dedup_key: String,
    /// The status the row carries right now. Always `pending`: the night's
    /// triage pass is what accepts it, and that pass is the thing under test.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idea_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_reason: Option<String>,
    /// Echoed back verbatim, stored nowhere.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trap: Option<String>,
}

/// What happened to the auto-accept rule this seeding depends on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriageRuleOutcome {
    pub id: String,
    pub name: String,
    pub conditions: String,
    pub action: String,
    pub enabled: bool,
    /// True when THIS call created it; false when an earlier seeding did.
    pub created: bool,
    /// How many other ENABLED rules the project evaluates before this one.
    /// First match wins, so a rule ahead of ours can decide a seed instead —
    /// reported rather than worked around.
    pub rules_ahead: usize,
    /// True when the rule as it stands will actually accept a seeded idea.
    /// False is a loud finding, not a silent no-op.
    pub will_accept: bool,
}

/// The whole answer. `notes` carries anything the caller must read before
/// trusting the next night — a disabled rule, a rule ahead in the order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchSeedOutcome {
    pub project_id: String,
    pub project_name: String,
    /// The provenance tag on every row written here.
    pub scan_type: String,
    pub seeded: usize,
    pub skipped: usize,
    pub items: Vec<SeededItem>,
    pub triage_rule: TriageRuleOutcome,
    pub notes: Vec<String>,
}

fn too_long(field: &str, index: usize, len: usize, cap: usize) -> String {
    format!("items[{index}].{field} is {len} characters, cap is {cap}")
}

/// Validate the whole batch before writing any of it. Returns EVERY problem,
/// not the first: a caller fixing a seed file one error per round trip is how a
/// bench stops being run at all. An all-or-nothing gate is also what keeps a
/// rejected batch from leaving half a night's work behind.
pub fn validate_seed_items(items: &[BenchSeedItem]) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();
    if items.is_empty() {
        errors.push("items must contain at least one entry".into());
        return errors;
    }
    if items.len() > MAX_SEED_ITEMS {
        errors.push(format!(
            "items carries {} entries, cap is {MAX_SEED_ITEMS}",
            items.len()
        ));
    }
    for (i, item) in items.iter().enumerate() {
        if item.title.trim().is_empty() {
            errors.push(format!("items[{i}].title is empty"));
        } else if item.title.chars().count() > MAX_TITLE_CHARS {
            errors.push(too_long(
                "title",
                i,
                item.title.chars().count(),
                MAX_TITLE_CHARS,
            ));
        }
        if let Some(d) = item.description.as_deref() {
            if d.chars().count() > MAX_DESCRIPTION_CHARS {
                errors.push(too_long(
                    "description",
                    i,
                    d.chars().count(),
                    MAX_DESCRIPTION_CHARS,
                ));
            }
        }
        if let Some(a) = item.acceptance.as_deref() {
            if a.chars().count() > MAX_ACCEPTANCE_CHARS {
                errors.push(too_long(
                    "acceptance",
                    i,
                    a.chars().count(),
                    MAX_ACCEPTANCE_CHARS,
                ));
            }
        }
        if let Some(t) = item.trap.as_deref() {
            if t.chars().count() > MAX_TRAP_CHARS {
                errors.push(too_long("trap", i, t.chars().count(), MAX_TRAP_CHARS));
            }
        }
    }
    errors
}

/// Idempotently ensure the auto-accept rule exists on this project.
///
/// Identity is the rule NAME. An existing rule is REPORTED, never rewritten:
/// if a human disabled it or flipped it to `reject`, that is a decision, and
/// silently reversing it would make this endpoint a way to re-arm a rule
/// somebody deliberately switched off. The outcome says `willAccept: false` and
/// the caller gets a note, which is the honest version of the same information.
pub fn ensure_seed_triage_rule(
    pool: &DbPool,
    project_id: &str,
) -> Result<TriageRuleOutcome, AppError> {
    let rules = list_triage_rules(pool, Some(project_id))?;
    let existing = rules.iter().find(|r| r.name == BENCH_SEED_RULE_NAME);

    let (rule, created): (TriageRule, bool) = match existing {
        Some(r) => (r.clone(), false),
        None => (
            create_triage_rule(
                pool,
                Some(project_id),
                BENCH_SEED_RULE_NAME,
                BENCH_SEED_RULE_CONDITIONS,
                "accept",
                Some(true),
            )?,
            true,
        ),
    };

    // Rules are evaluated in `created_at` order and the first MATCH wins, so
    // what matters is how many enabled rules sit ahead of this one.
    let rules_ahead = rules
        .iter()
        .filter(|r| r.enabled && r.id != rule.id && r.created_at < rule.created_at)
        .count();

    let will_accept =
        rule.enabled && rule.action == "accept" && rule.conditions == BENCH_SEED_RULE_CONDITIONS;

    Ok(TriageRuleOutcome {
        id: rule.id,
        name: rule.name,
        conditions: rule.conditions,
        action: rule.action,
        enabled: rule.enabled,
        created,
        rules_ahead,
        will_accept,
    })
}

/// The `dev_ideas.id` already holding `dedup_key` on this project, if any.
fn existing_idea_id(
    pool: &DbPool,
    project_id: &str,
    dedup_key: &str,
) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT id FROM dev_ideas WHERE project_id = ?1 AND dedup_key = ?2 LIMIT 1")?;
    let mut rows = stmt.query(params![project_id, dedup_key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// Seed a batch of bench tasks onto one project.
///
/// Validation is all-or-nothing (see [`validate_seed_items`]); writing is
/// per-item, because a dedup skip is a normal outcome the caller must see
/// rather than an error the batch dies on.
pub fn seed_bench_work(
    pool: &DbPool,
    project_id: &str,
    items: &[BenchSeedItem],
) -> Result<BenchSeedOutcome, AppError> {
    seed_bench_work_salted(pool, project_id, items, None)
}

/// `salt` (the bench run's stamp) is folded VERBATIM into every item's
/// `dedup_key`. Titles alone cannot carry run-uniqueness: the ideas
/// normalizer collapses rewordings and strips bracketed suffixes, so
/// `"Fix X [bench 2026-08-25T16-42]"` normalizes to the same token as
/// `"Fix X [bench 2026-08-25T15-26]"` and the second run seeds nothing
/// (sweep #18, personas-self: seeded 0/1). The salt lives in the KEY, not the
/// title, so the backlog reads clean while every run stays its own.
pub fn seed_bench_work_salted(
    pool: &DbPool,
    project_id: &str,
    items: &[BenchSeedItem],
    salt: Option<&str>,
) -> Result<BenchSeedOutcome, AppError> {
    let errors = validate_seed_items(items);
    if !errors.is_empty() {
        return Err(AppError::Validation(errors.join("; ")));
    }
    // A seed that names a project that does not exist must say so, not create a
    // backlog nobody will ever read.
    let project = crate::repos::dev::projects::get_project_by_id(pool, project_id)?;

    let triage_rule = ensure_seed_triage_rule(pool, project_id)?;

    let mut notes: Vec<String> = Vec::new();
    if !triage_rule.will_accept {
        notes.push(format!(
            "the `{BENCH_SEED_RULE_NAME}` rule on this project is enabled={} action=`{}` — it will NOT accept these seeds, so tonight's overnight will dispatch nothing. Re-enable it (or restore its `accept` action) in Dev Tools → Triage rules.",
            triage_rule.enabled, triage_rule.action
        ));
    }
    if triage_rule.rules_ahead > 0 {
        notes.push(format!(
            "{} enabled triage rule(s) are evaluated BEFORE the seed rule; triage is first-match-wins, so one of them can decide a seeded idea instead.",
            triage_rule.rules_ahead
        ));
    }

    let mut out_items: Vec<SeededItem> = Vec::with_capacity(items.len());
    let mut seen_in_batch: Vec<(String, usize)> = Vec::new();
    let (mut seeded, mut skipped) = (0usize, 0usize);

    for (index, item) in items.iter().enumerate() {
        let title = item.title.trim();
        // The salt is appended to the COMPUTED key, never to the title fed
        // into normalization: the normalizer strips digits/stamps, so a salt
        // inside the title survives for some titles and vanishes for others
        // (sweep #19 seeded 2/4 with an in-title salt).
        let base_key = scan_dedup_key(BENCH_SEED_SCAN_TYPE, Some(BENCH_SEED_SCOPE), title);
        let dedup_key = match salt {
            Some(salt) if !salt.trim().is_empty() => format!("{base_key}:{}", salt.trim()),
            _ => base_key,
        };
        let acceptance = item.acceptance.clone();
        let trap = item.trap.clone();

        // Two items whose titles normalize to the same token are one idea; the
        // guarded door would answer `Ok(None)` for the second anyway, but saying
        // WHICH earlier item it collided with is the readable version.
        if let Some((_, first)) = seen_in_batch.iter().find(|(k, _)| *k == dedup_key) {
            skipped += 1;
            out_items.push(SeededItem {
                index,
                title: title.to_string(),
                id: existing_idea_id(pool, project_id, &dedup_key)?,
                accepted: false,
                dedup_key,
                idea_status: None,
                skipped_reason: Some(format!(
                    "the title normalizes to the same dedup key as items[{first}] in this batch"
                )),
                acceptance,
                trap,
            });
            continue;
        }
        seen_in_batch.push((dedup_key.clone(), index));

        let description = item
            .description
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty());

        let written = create_idea_deduped(
            pool,
            project_id,
            None, // context_id — a seed is project-wide
            BENCH_SEED_SCAN_TYPE,
            Some(BENCH_SEED_CATEGORY),
            title,
            description,
            None, // reasoning: it would reach the agent's prompt
            None, // effort / impact / risk stay NULL so a numeric triage rule
            None, // written for the real backlog cannot sweep a seed up on a
            None, // score this module invented.
            None, // provider
            None, // model
            &dedup_key,
        )?;

        match written {
            Some(idea) => {
                seeded += 1;
                out_items.push(SeededItem {
                    index,
                    title: idea.title,
                    id: Some(idea.id),
                    accepted: true,
                    dedup_key,
                    idea_status: Some(idea.status),
                    skipped_reason: None,
                    acceptance,
                    trap,
                });
            }
            None => {
                skipped += 1;
                let id = existing_idea_id(pool, project_id, &dedup_key)?;
                let status = match id.as_deref() {
                    Some(existing) => crate::repos::dev::ideas::get_idea_by_id(pool, existing)
                        .ok()
                        .map(|i| i.status),
                    None => None,
                };
                out_items.push(SeededItem {
                    index,
                    title: title.to_string(),
                    id,
                    accepted: false,
                    dedup_key,
                    idea_status: status,
                    skipped_reason: Some(
                        "this project already holds an idea with this dedup key (in ANY status — a rejected or archived one counts, by design)".into(),
                    ),
                    acceptance,
                    trap,
                });
            }
        }
    }

    if seeded == 0 {
        notes.push(
            "nothing new was written: every item was already on the backlog. The next night dispatches only what THIS night's triage pass accepts, and an already-accepted or already-dispatched idea is not re-offered."
                .into(),
        );
    }

    Ok(BenchSeedOutcome {
        project_id: project_id.to_string(),
        project_name: project.name,
        scan_type: BENCH_SEED_SCAN_TYPE.to_string(),
        seeded,
        skipped,
        items: out_items,
        triage_rule,
        notes,
    })
}

#[cfg(test)]
#[path = "bench_seed_tests.rs"]
mod tests;
