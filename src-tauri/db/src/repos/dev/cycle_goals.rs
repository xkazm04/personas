//! Autopilot **cycles** as `dev_goals` rows.
//!
//! Every autopilot dispatch of a persona into a project is one cycle, and a
//! cycle is a goal: the row the worker's brief names, the row its write-back
//! files the next plan against, and the row the Goals tab shows. Nothing new
//! is stored — a cycle goal is an ordinary `dev_goals` row whose description
//! opens with a **marker** naming the persona and the cycle number:
//!
//! ```text
//! [cycle:<persona_id>:<n>]
//! <what this cycle is for>
//! ```
//!
//! The marker is the whole join. [`claim_cycle_goal`] finds the newest OPEN
//! marked goal of a persona in a project and sets it `in-progress` (cycle 1 is
//! created when none exists); the write-back door files the successor as an
//! OPEN goal marked `n+1` with `parent_goal_id` = the current cycle
//! ([`file_successor_cycle_goal`]); the harvest on the worker's `finished`
//! closes the current cycle `done` ([`close_cycle_goal`]) and re-enqueues the
//! persona on the successor it finds ([`find_successor_cycle_goal`]).
//!
//! Every status write goes through [`super::goals::update_goal`] — the same
//! door the UI and the App Master write-back use, with the same status
//! folding — never a raw `UPDATE`.

use crate::models::DevGoal;
use crate::DbPool;
use personas_core::error::AppError;

use super::goals as repo;

/// The marker's opening token.
const MARKER_OPEN: &str = "[cycle:";

/// `[cycle:<persona_id>:<n>]` — the first line of a cycle goal's description.
pub fn cycle_marker(persona_id: &str, cycle_index: i64) -> String {
    format!("{MARKER_OPEN}{}:{cycle_index}]", persona_id.trim())
}

/// A cycle goal's description: the marker line, then the plan text (trimmed;
/// an empty plan leaves the marker alone).
pub fn cycle_description(persona_id: &str, cycle_index: i64, plan: &str) -> String {
    let plan = plan.trim();
    if plan.is_empty() {
        cycle_marker(persona_id, cycle_index)
    } else {
        format!("{}\n{plan}", cycle_marker(persona_id, cycle_index))
    }
}

/// The `(persona_id, cycle_index)` a goal's description opens with, or
/// `None` for a goal that is not a cycle. Pure; lenient about leading
/// whitespace, strict about the shape.
pub fn parse_cycle_marker(description: Option<&str>) -> Option<(String, i64)> {
    let head = description?.trim_start();
    let rest = head.strip_prefix(MARKER_OPEN)?;
    let end = rest.find(']')?;
    let body = &rest[..end];
    let (persona_id, n) = body.rsplit_once(':')?;
    if persona_id.is_empty() {
        return None;
    }
    let n: i64 = n.parse().ok()?;
    if n < 1 {
        return None;
    }
    Some((persona_id.to_string(), n))
}

/// The plan text under the marker — the description with its first line
/// removed. Empty when the goal has no plan or is not a cycle.
pub fn cycle_plan_text(description: Option<&str>) -> String {
    let Some(d) = description else {
        return String::new();
    };
    match parse_cycle_marker(Some(d)) {
        Some(_) => d
            .trim_start()
            .split_once('\n')
            .map(|(_, rest)| rest.trim().to_string())
            .unwrap_or_default(),
        None => d.trim().to_string(),
    }
}

/// The title a cycle goal is created with: `"<persona> · cycle n"`.
pub fn cycle_title(persona_name: &str, cycle_index: i64) -> String {
    format!("{} · cycle {cycle_index}", persona_name.trim())
}

/// The newest cycle goal of `persona_id` in `project_id` with `status`
/// (`open` / `in-progress` / …), by `created_at` then `order_index`, or
/// `None`. One project read; the marker is parsed in Rust rather than
/// matched by `LIKE`, so a persona id containing `%` or `_` cannot widen it.
fn newest_cycle_goal_with_status(
    pool: &DbPool,
    project_id: &str,
    persona_id: &str,
    status: &str,
) -> Result<Option<DevGoal>, AppError> {
    let mut goals: Vec<DevGoal> = repo::list_goals_by_project(pool, project_id, Some(status))?
        .into_iter()
        .filter(|g| {
            parse_cycle_marker(g.description.as_deref())
                .is_some_and(|(pid, _)| pid == persona_id.trim())
        })
        .collect();
    goals.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.order_index.cmp(&b.order_index))
    });
    Ok(goals.pop())
}

/// Claim the cycle a dispatch is about to run: the newest OPEN cycle goal of
/// the persona in the project, set `in-progress` (and `started_at` stamped
/// when it has none); or, with no open cycle, a NEW cycle created
/// `in-progress` with `objective` as its plan text — **cycle 1** for a
/// persona that never ran here, else one past the highest cycle it ever had
/// (a lineage that lost its plan resumes its numbering, not the count).
/// Returns the goal and its cycle index.
///
/// An `in-progress` cycle that already exists (the previous worker is still
/// running, or died without a harvest) is NOT claimed again — the caller's
/// duplicate guard (a queued or live autopilot row for the persona) is what
/// prevents two workers on one cycle, and a stranded `in-progress` cycle is a
/// row for the operator to see, not one to silently reopen.
pub fn claim_cycle_goal(
    pool: &DbPool,
    persona_id: &str,
    persona_name: &str,
    project_id: &str,
    objective: &str,
) -> Result<(DevGoal, i64), AppError> {
    personas_core::validation::require_non_empty("cycle persona_id", persona_id)?;
    let persona_id = persona_id.trim();
    if let Some(open) = newest_cycle_goal_with_status(pool, project_id, persona_id, "open")? {
        let (_, n) = parse_cycle_marker(open.description.as_deref())
            .expect("filtered on a parseable marker");
        let started_at = match open.started_at {
            Some(_) => None,
            None => Some(Some(chrono::Utc::now().to_rfc3339())),
        };
        let claimed = repo::update_goal(
            pool,
            &open.id,
            None,
            None,
            Some("in-progress"),
            None,
            None,
            None,
            started_at.as_ref().map(|o| o.as_deref()),
            None,
            None,
        )?;
        return Ok((claimed, n));
    }
    let next = highest_cycle_index(pool, project_id, persona_id)? + 1;
    let title = cycle_title(persona_name, next);
    let description = cycle_description(persona_id, next, objective);
    let goal = repo::create_goal(
        pool,
        project_id,
        &title,
        Some(&description),
        None,
        Some("in-progress"),
        None,
        None,
    )?;
    // `create_goal` has no `started_at` input; the claim stamps it the way the
    // reuse branch does, through the same door.
    let goal = repo::update_goal(
        pool,
        &goal.id,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(Some(&chrono::Utc::now().to_rfc3339())),
        None,
        None,
    )?;
    Ok((goal, next))
}

/// The highest cycle index the persona ever had in the project, any status;
/// 0 when it never ran here.
fn highest_cycle_index(pool: &DbPool, project_id: &str, persona_id: &str) -> Result<i64, AppError> {
    Ok(repo::list_goals_by_project(pool, project_id, None)?
        .iter()
        .filter_map(|g| parse_cycle_marker(g.description.as_deref()))
        .filter(|(pid, _)| pid == persona_id)
        .map(|(_, n)| n)
        .max()
        .unwrap_or(0))
}

/// File the successor of cycle `current` — an OPEN goal titled
/// `"<persona> · cycle n+1"`, marked `n+1`, with `parent_goal_id = current.id`
/// and `plan` under its marker. Idempotent per cycle: a second filing while
/// the successor is still open **amends** it (title, plan) rather than
/// creating a sibling, so a worker that files twice leaves one next cycle.
///
/// Refuses (`Validation`) a `current` that carries no marker, or an empty
/// `title` — an empty plan is the "no plan was filed" case the harvest reads
/// as `cycle_plan_empty`, and it must not be created as a goal that says
/// nothing.
pub fn file_successor_cycle_goal(
    pool: &DbPool,
    current: &DevGoal,
    persona_name: &str,
    title: &str,
    plan: &str,
) -> Result<DevGoal, AppError> {
    let Some((persona_id, n)) = parse_cycle_marker(current.description.as_deref()) else {
        return Err(AppError::Validation(format!(
            "goal {} is not an autopilot cycle (its description carries no [cycle:…] marker)",
            current.id
        )));
    };
    // An empty title is "no plan was filed", which the harvest reads as
    // `cycle_plan_empty`; it must not become a goal that says nothing.
    personas_core::validation::require_non_empty("next_cycle.title", title)?;
    let title = title.trim();
    let next = n + 1;
    // The stored title keeps the cycle numbering in front and the worker's
    // own title after it, so a Goals list reads "Master · cycle 3 — Harden
    // the settlement path" in order.
    let stored_title = format!("{} — {title}", cycle_title(persona_name, next));
    let description = cycle_description(&persona_id, next, plan);
    if let Some(existing) = find_successor_cycle_goal(pool, current)? {
        return repo::update_goal(
            pool,
            &existing.id,
            Some(&stored_title),
            Some(Some(&description)),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
    }
    repo::create_goal(
        pool,
        &current.project_id,
        &stored_title,
        Some(&description),
        None,
        Some("open"),
        None,
        Some(&current.id),
    )
}

/// The OPEN successor of `current`: a child goal (`parent_goal_id`) marked
/// for the same persona at `n+1`. `None` when nothing was filed. A successor
/// that already moved past `open` (claimed by a later tick) is not returned —
/// it is no longer waiting to be enqueued.
pub fn find_successor_cycle_goal(
    pool: &DbPool,
    current: &DevGoal,
) -> Result<Option<DevGoal>, AppError> {
    let Some((persona_id, n)) = parse_cycle_marker(current.description.as_deref()) else {
        return Ok(None);
    };
    let mut children: Vec<DevGoal> = repo::list_child_goals(pool, &current.id)?
        .into_iter()
        .filter(|g| repo::normalize_goal_status(&g.status) == "open")
        .filter(|g| {
            parse_cycle_marker(g.description.as_deref())
                .is_some_and(|(pid, m)| pid == persona_id && m == n + 1)
        })
        .collect();
    children.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(children.pop())
}

/// Close a cycle: status `done`, `completed_at` stamped now. Through
/// `update_goal`, like every other status write. A goal already `done` keeps
/// its original `completed_at`.
pub fn close_cycle_goal(pool: &DbPool, goal_id: &str) -> Result<DevGoal, AppError> {
    let goal = repo::get_goal_by_id(pool, goal_id)?;
    if repo::goal_status_is_complete(&goal.status) {
        return Ok(goal);
    }
    repo::update_goal(
        pool,
        goal_id,
        None,
        None,
        Some("done"),
        None,
        None,
        None,
        None,
        Some(Some(&chrono::Utc::now().to_rfc3339())),
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn project(pool: &DbPool, name: &str) -> String {
        crate::repos::dev::projects::create_project(
            pool,
            name,
            &format!("C:/tmp/{name}"),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("project")
        .id
    }

    #[test]
    fn the_marker_round_trips_and_rejects_the_rest() {
        let m = cycle_marker("p-1", 3);
        assert_eq!(m, "[cycle:p-1:3]");
        assert_eq!(parse_cycle_marker(Some(&m)), Some(("p-1".into(), 3)));
        assert_eq!(
            parse_cycle_marker(Some("  [cycle:abc:12]\nplan text")),
            Some(("abc".into(), 12))
        );
        // A persona id with a colon in it: the LAST colon splits the number.
        assert_eq!(
            parse_cycle_marker(Some("[cycle:a:b:2]")),
            Some(("a:b".into(), 2))
        );
        for bad in [
            None,
            Some(""),
            Some("plain goal"),
            Some("[cycle:p-1]"),
            Some("[cycle::3]"),
            Some("[cycle:p-1:0]"),
            Some("[cycle:p-1:x]"),
            Some("[cycle:p-1:3"),
            Some("text [cycle:p-1:3]"),
        ] {
            assert_eq!(parse_cycle_marker(bad), None, "{bad:?}");
        }
        assert_eq!(
            cycle_plan_text(Some("[cycle:p:1]\n  do the thing  \nthen this")),
            "do the thing  \nthen this"
        );
        assert_eq!(cycle_plan_text(Some("[cycle:p:1]")), "");
        assert_eq!(cycle_plan_text(Some(" plain ")), "plain");
        assert_eq!(cycle_description("p", 2, "  "), "[cycle:p:2]");
        assert_eq!(cycle_description("p", 2, " x "), "[cycle:p:2]\nx");
    }

    #[test]
    fn claim_creates_cycle_one_then_reuses_the_open_one() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "cycle-app");

        let (first, n) = claim_cycle_goal(&pool, "persona-a", "Master A", &pid, "keep it green")?;
        assert_eq!(n, 1);
        assert_eq!(first.title, "Master A · cycle 1");
        assert_eq!(first.status, "in-progress");
        assert!(first.started_at.is_some(), "the claim stamps started_at");
        assert_eq!(
            first.description.as_deref(),
            Some("[cycle:persona-a:1]\nkeep it green")
        );

        // The OPEN reuse path: a filed successor is what the next claim takes.
        let successor =
            file_successor_cycle_goal(&pool, &first, "Master A", "Harden it", "the plan")?;
        assert_eq!(successor.status, "open");
        assert_eq!(successor.parent_goal_id.as_deref(), Some(first.id.as_str()));
        assert_eq!(successor.title, "Master A · cycle 2 — Harden it");
        assert_eq!(
            successor.description.as_deref(),
            Some("[cycle:persona-a:2]\nthe plan")
        );

        let (claimed, n) = claim_cycle_goal(&pool, "persona-a", "Master A", &pid, "ignored")?;
        assert_eq!(n, 2);
        assert_eq!(
            claimed.id, successor.id,
            "the open successor is the one claimed"
        );
        assert_eq!(claimed.status, "in-progress");
        assert!(claimed.started_at.is_some());

        // Another persona in the same project has its own lineage.
        let (other, n) = claim_cycle_goal(&pool, "persona-b", "Master B", &pid, "b's charter")?;
        assert_eq!(n, 1);
        assert_ne!(other.id, claimed.id);
        assert_eq!(other.title, "Master B · cycle 1");
        Ok(())
    }

    #[test]
    fn a_successor_is_filed_once_and_amended_on_a_second_filing() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "cycle-file");
        let (current, _) = claim_cycle_goal(&pool, "p", "P", &pid, "obj")?;
        assert!(find_successor_cycle_goal(&pool, &current)?.is_none());

        let a = file_successor_cycle_goal(&pool, &current, "P", "First plan", "one")?;
        let b = file_successor_cycle_goal(&pool, &current, "P", "Second plan", "two")?;
        assert_eq!(a.id, b.id, "a second filing amends, never a sibling");
        assert_eq!(b.title, "P · cycle 2 — Second plan");
        assert_eq!(b.description.as_deref(), Some("[cycle:p:2]\ntwo"));
        assert_eq!(repo::list_child_goals(&pool, &current.id)?.len(), 1);
        assert_eq!(
            find_successor_cycle_goal(&pool, &current)?.map(|g| g.id),
            Some(b.id.clone())
        );

        // An empty title is a refusal, not a goal that says nothing.
        let err = file_successor_cycle_goal(&pool, &current, "P", "  ", "x").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        // A goal without a marker cannot have a cycle successor.
        let plain = repo::create_goal(&pool, &pid, "Plain", None, None, None, None, None)?;
        let err = file_successor_cycle_goal(&pool, &plain, "P", "t", "x").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        Ok(())
    }

    #[test]
    fn closing_a_cycle_marks_it_done_once() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "cycle-close");
        let (current, _) = claim_cycle_goal(&pool, "p", "P", &pid, "obj")?;
        let done = close_cycle_goal(&pool, &current.id)?;
        assert_eq!(done.status, "done");
        let stamp = done.completed_at.clone();
        assert!(stamp.is_some());
        let again = close_cycle_goal(&pool, &current.id)?;
        assert_eq!(
            again.completed_at, stamp,
            "a second close keeps the first stamp"
        );
        // A closed cycle is not claimable; with no successor filed the next
        // claim continues the NUMBERING (cycle 2), not the lineage.
        let (fresh, n) = claim_cycle_goal(&pool, "p", "P", &pid, "obj")?;
        assert_eq!(
            n, 2,
            "no open cycle left: numbering resumes past the highest"
        );
        assert_ne!(fresh.id, current.id);
        assert_eq!(fresh.title, "P · cycle 2");
        assert_eq!(fresh.parent_goal_id, None, "a resumed cycle has no parent");
        Ok(())
    }
}
