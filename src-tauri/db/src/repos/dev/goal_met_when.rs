//! `dev_goals.met_when` read side (migration `e67_mandate_envelope`): the
//! conditions a mandate intent names for "met", for the Accept card's
//! checklist (spark `mandate-lanes`, WP6).
//!
//! The column is JSON, `NULL` = no conditions. The read is lenient per field
//! and strict about the whole: a field of the wrong shape is dropped with a
//! warning (it names no condition), but text that is not a JSON object at all
//! is reported as `unreadable`, so the card can say "could not be read" rather
//! than the false "no conditions set".

use rusqlite::OptionalExtension;
use serde_json::Value;

use crate::models::{CouncilDepth, GoalMetWhen, MetWhen};
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// Parse a stored `met_when`. `Ok(None)` = no condition named; `Err(())` =
/// the text is not a JSON object.
fn parse(raw: &str, goal_id: &str) -> Result<Option<MetWhen>, ()> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(None);
    }
    let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(trimmed) else {
        tracing::warn!(goal_id, "goal_met_when: met_when is not a JSON object");
        return Err(());
    };
    let text = |k: &str| match obj.get(k) {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Some(Value::String(_)) | Some(Value::Null) | None => None,
        Some(other) => {
            tracing::warn!(goal_id, field = k, value = %other, "goal_met_when: field dropped");
            None
        }
    };
    let uat = match obj.get("uat") {
        // `true` = "a UAT is required" without naming it.
        Some(Value::Bool(true)) => Some(String::new()),
        Some(Value::Bool(false)) => None,
        _ => text("uat"),
    };
    let council = match text("council").as_deref() {
        Some("full") => Some(CouncilDepth::Full),
        Some("lite") => Some(CouncilDepth::Lite),
        Some(other) => {
            tracing::warn!(
                goal_id,
                council = other,
                "goal_met_when: unknown council depth dropped"
            );
            None
        }
        None => None,
    };
    let met = MetWhen {
        uat,
        kpi_id: text("kpiId"),
        council,
    };
    Ok((!met.is_empty()).then_some(met))
}

/// The met-when of one goal. `Ok(None)` when no such goal exists.
pub fn get(pool: &DbPool, goal_id: &str) -> Result<Option<GoalMetWhen>, AppError> {
    timed_query!("dev_goals", "goal_met_when::get", {
        let conn = pool.conn("goal_met_when::get")?;
        let row: Option<(Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT met_when, charter_id FROM dev_goals WHERE id = ?1",
                [goal_id],
                |r| Ok((r.get("met_when")?, r.get("charter_id")?)),
            )
            .optional()?;
        Ok(row.map(|(raw, charter_id)| {
            let parsed = raw
                .as_deref()
                .map(|r| parse(r, goal_id))
                .unwrap_or(Ok(None));
            GoalMetWhen {
                goal_id: goal_id.to_string(),
                charter_id,
                unreadable: parsed.is_err(),
                met_when: parsed.unwrap_or(None),
            }
        }))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::dev::{goals, projects};

    fn goal(pool: &DbPool) -> String {
        let p = projects::create_project(
            pool,
            "MetWhen",
            "/tmp/met-when",
            None,
            None,
            None,
            None,
            None,
        )
        .expect("project");
        goals::create_goal(pool, &p.id, "Ship it", None, None, None, None, None)
            .expect("goal")
            .id
    }

    fn set(pool: &DbPool, id: &str, raw: Option<&str>) {
        pool.conn("goal_met_when test")
            .unwrap()
            .execute(
                "UPDATE dev_goals SET met_when = ?1 WHERE id = ?2",
                rusqlite::params![raw, id],
            )
            .unwrap();
    }

    #[test]
    fn null_means_no_conditions_never_an_empty_list() {
        let pool = crate::init_test_db().unwrap();
        let id = goal(&pool);
        let got = get(&pool, &id).unwrap().unwrap();
        assert_eq!(got.met_when, None);
        assert!(!got.unreadable);
        set(&pool, &id, Some("{}"));
        assert_eq!(get(&pool, &id).unwrap().unwrap().met_when, None);
    }

    #[test]
    fn every_condition_reads() {
        let pool = crate::init_test_db().unwrap();
        let id = goal(&pool);
        set(
            &pool,
            &id,
            Some(r#"{"uat":"Sign in on a fresh install","kpiId":"k1","council":"full"}"#),
        );
        let met = get(&pool, &id).unwrap().unwrap().met_when.unwrap();
        assert_eq!(met.uat.as_deref(), Some("Sign in on a fresh install"));
        assert_eq!(met.kpi_id.as_deref(), Some("k1"));
        assert_eq!(met.council, Some(CouncilDepth::Full));
    }

    #[test]
    fn uat_true_is_required_without_a_name_and_bad_fields_drop() {
        let pool = crate::init_test_db().unwrap();
        let id = goal(&pool);
        set(
            &pool,
            &id,
            Some(r#"{"uat":true,"kpiId":7,"council":"maybe"}"#),
        );
        let met = get(&pool, &id).unwrap().unwrap().met_when.unwrap();
        assert_eq!(met.uat.as_deref(), Some(""));
        assert_eq!(met.kpi_id, None);
        assert_eq!(met.council, None);
    }

    #[test]
    fn text_that_is_not_an_object_is_unreadable_not_empty() {
        let pool = crate::init_test_db().unwrap();
        let id = goal(&pool);
        set(&pool, &id, Some("[1,2]"));
        let got = get(&pool, &id).unwrap().unwrap();
        assert!(got.unreadable);
        assert_eq!(got.met_when, None);
    }

    #[test]
    fn an_unknown_goal_is_none() {
        let pool = crate::init_test_db().unwrap();
        assert!(get(&pool, "nope").unwrap().is_none());
    }
}
