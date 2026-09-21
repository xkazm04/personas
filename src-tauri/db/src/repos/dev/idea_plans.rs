//! The `dev_ideas.plan` column — the execution plan an analysing model leaves
//! for an executing model.
//!
//! **Why this is not in `ideas.rs`.** The plan is an e41 column
//! (`migrations/incremental/e41_backlog_contract.rs:61`) that the `DevIdea`
//! mapper deliberately does NOT carry: the model lives in `personas_core` and
//! `row_to_idea` (`ideas.rs:8`) predates the column, so every existing reader
//! of an idea is blind to it. Until this module the column was **write-only** —
//! `file_idea` serialised a plan in (`ideas.rs:1009`) and nothing in the tree
//! ever read one back, which is why the executor still demanded a plan FROM the
//! worker it had already handed one to.
//!
//! Reading it as its own typed lookup rather than widening `DevIdea` keeps the
//! cost where it belongs: only the prompt builder pays for deserialising a plan,
//! and the ~40 call sites that list ideas do not.

use crate::models::IdeaPlan;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension};

/// The plan filed with a backlog item, or `None`.
///
/// `None` covers all three of: no such item, an item filed before the plan
/// contract, and an item whose producer filed no plan. A caller renders a plan
/// when there is one and falls back to its old behaviour when there is not, so
/// the three are not worth distinguishing — and a missing item is emphatically
/// not an error here: the prompt builder degrades, it does not refuse.
///
/// Stored JSON that no longer parses is logged and treated as absent. A plan is
/// an optimisation of the prompt, never a precondition for running the work.
pub fn get_idea_plan(pool: &DbPool, idea_id: &str) -> Result<Option<IdeaPlan>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::get_idea_plan", {
        let conn = pool.get()?;
        let raw: Option<Option<String>> = conn
            .query_row(
                "SELECT plan FROM dev_ideas WHERE id = ?1",
                params![idea_id],
                // By NAME, never by index: an additive migration shifts every
                // positional read below it and the wrong TEXT column still
                // type-checks.
                |r| r.get::<_, Option<String>>("plan"),
            )
            .optional()?;
        // No `return` inside the macro body: it would jump past the
        // `record_query` call and silently drop this query's timing.
        Ok(match raw.flatten() {
            None => None,
            Some(json) => match serde_json::from_str::<IdeaPlan>(&json) {
                Ok(plan) => Some(plan),
                Err(e) => {
                    tracing::warn!(idea_id, error = %e,
                        "dev_ideas.plan did not parse; treating as absent");
                    None
                }
            },
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{BacklogSource, IdeaDraft, PlanStep};
    use crate::repos::dev::ideas::file_idea;
    use crate::repos::dev::projects::create_project;

    fn pool() -> DbPool {
        crate::init_test_db().expect("init_test_db")
    }

    fn project(pool: &DbPool) -> String {
        create_project(pool, "Proj", "/tmp/proj", None, None, None, None, None)
            .expect("project")
            .id
    }

    fn draft(project_id: &str, title: &str) -> IdeaDraft {
        let mut d = IdeaDraft::new(project_id.to_string(), BacklogSource::Manual, title);
        d.description = Some("body".into());
        d
    }

    #[test]
    fn a_filed_plan_round_trips_through_the_reader() {
        let pool = pool();
        let pid = project(&pool);
        let mut d = draft(&pid, "Plan me");
        d.plan = Some(IdeaPlan {
            steps: vec![PlanStep {
                n: 1,
                action: "Clamp the backoff at 1s".into(),
                files: vec!["src/retry.rs".into()],
                done_when: "the zero-backoff test passes".into(),
            }],
        });
        let idea = file_idea(&pool, d).expect("file").expect("row");

        let plan = get_idea_plan(&pool, &idea.id)
            .expect("read")
            .expect("the plan the producer filed");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].action, "Clamp the backoff at 1s");
        assert_eq!(plan.steps[0].files, vec!["src/retry.rs".to_string()]);
        assert_eq!(plan.steps[0].done_when, "the zero-backoff test passes");
        assert!(plan.is_actionable());
    }

    #[test]
    fn an_item_with_no_plan_and_an_item_that_does_not_exist_both_read_as_absent() {
        let pool = pool();
        let pid = project(&pool);
        let idea = file_idea(&pool, draft(&pid, "No plan"))
            .expect("file")
            .expect("row");
        assert!(get_idea_plan(&pool, &idea.id).expect("read").is_none());
        assert!(get_idea_plan(&pool, "no-such-idea")
            .expect("read")
            .is_none());
    }
}
