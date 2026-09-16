//! Backlog and task-history reads for the MCP surface.
//!
//! A persona whose charters are backlog-centred (deliver accepted ideas, file
//! findings, steward KPIs) had no verb to read its own project's ideas or the
//! tasks dispatched from them: everything it knew about the backlog arrived as
//! prose inside its prompt, so it could not check a filing against the existing
//! items for duplicates or confirm that a dispatched item ever ran. These three
//! verbs are that read, and nothing else: every one is read-only and routes
//! through the same `dev_ideas` / `dev_tasks` repository functions the app uses.
//!
//! Project resolution is the context tools' own ([`super::tools::resolve_context_project`]):
//! a persona pinned to a project reads that project, otherwise `project_id`,
//! `project_root`, or the first registered project.

use serde_json::{json, Value};

use super::db::McpDbPool;
use super::tools::resolve_context_project;
use crate::db::models::{DevIdea, DevTask};
use crate::db::repos::dev::{ideas, tasks};

const IDEAS_DEFAULT_LIMIT: i64 = 50;
const IDEAS_MAX_LIMIT: i64 = 100;
const TASKS_DEFAULT_LIMIT: usize = 20;
const TASKS_MAX_LIMIT: usize = 50;
/// A task's `error` can be a whole CLI transcript tail; a list row carries the
/// start of it (flagged as truncated) and `personas_get_idea` is where the reader
/// goes for the whole of it.
const LIST_ERROR_BYTES: usize = 400;

pub(super) fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "personas_list_ideas",
            "description": "List a project's backlog (dev ideas), newest first: id, title, status, category, effort/impact/risk (null = unrated), priority, origin and created_at. Use to check a new filing against existing items, or to see what is pending, accepted or rejected. Read-only.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Project id. Ignored when this run is pinned to a project; defaults to the first project otherwise." },
                    "status": { "type": "string", "description": "Optional status filter, e.g. pending, accepted, rejected, archived" },
                    "limit": { "type": "number", "description": "Max results (default 50, max 100)" }
                }
            }
        }),
        json!({
            "name": "personas_get_idea",
            "description": "Get one backlog idea in full (description, reasoning, evidence, rejection reason, goal) plus the latest task dispatched from it, if any. Accepts a full id or an unambiguous prefix of at least 8 characters. Read-only.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "idea_id": { "type": "string", "description": "The idea id, or a prefix of at least 8 characters" }
                },
                "required": ["idea_id"]
            }
        }),
        json!({
            "name": "personas_list_tasks",
            "description": "List a project's dispatched tasks (task history), newest first: id, source idea id, status, branch, error (truncated), started/completed timestamps and duration. Use to see which dispatched items failed or never ran. Read-only.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Project id. Ignored when this run is pinned to a project; defaults to the first project otherwise." },
                    "status": { "type": "string", "description": "Optional status filter, e.g. queued, running, completed, failed, cancelled" },
                    "since": { "type": "string", "description": "Optional ISO-8601 timestamp: only tasks created at or after it" },
                    "limit": { "type": "number", "description": "Max results (default 20, max 50)" }
                }
            }
        }),
    ]
}

fn opt_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// A capped copy of `s` and whether anything was removed. The flag rides in the
/// payload beside the text (`error_truncated`) rather than an ellipsis spliced
/// into it, so a reader can ask whether it is looking at the whole error.
fn cap(s: &str, max_bytes: usize) -> (String, bool) {
    let capped = personas_core::utils::text::truncate_on_char_boundary(s, max_bytes);
    (capped.to_string(), capped.len() < s.len())
}

/// Wall-clock milliseconds between two RFC3339 stamps, when both parse.
fn duration_ms(started: Option<&str>, completed: Option<&str>) -> Option<i64> {
    let start = chrono::DateTime::parse_from_rfc3339(started?).ok()?;
    let end = chrono::DateTime::parse_from_rfc3339(completed?).ok()?;
    Some((end - start).num_milliseconds())
}

fn idea_row(i: &DevIdea) -> Value {
    json!({
        "id": i.id,
        "title": i.title,
        "status": i.status,
        "category": i.category,
        "effort": i.effort,
        "impact": i.impact,
        "risk": i.risk,
        "priority": i.priority,
        "origin": i.origin,
        "goal_id": i.goal_id,
        "created_at": i.created_at,
    })
}

fn task_row(t: &DevTask, error_cap: Option<usize>) -> Value {
    let (error, error_truncated) = match (t.error.as_deref(), error_cap) {
        (None, _) => (None, false),
        (Some(e), None) => (Some(e.to_string()), false),
        (Some(e), Some(max)) => {
            let (text, cut) = cap(e, max);
            (Some(text), cut)
        }
    };
    json!({
        "id": t.id,
        "idea_id": t.source_idea_id,
        "title": t.title,
        "status": t.status,
        "branch": t.worktree_branch,
        "attempt": t.attempt,
        "error": error,
        "error_truncated": error_truncated,
        "created_at": t.created_at,
        "started_at": t.started_at,
        "completed_at": t.completed_at,
        "duration_ms": duration_ms(t.started_at.as_deref(), t.completed_at.as_deref()),
    })
}

fn to_text(v: &Value) -> Result<String, String> {
    serde_json::to_string_pretty(v).map_err(|e| format!("Serialize error: {e}"))
}

pub(super) fn handle_list_ideas(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let project_id = {
        let conn = pool.get()?;
        resolve_context_project(&conn, args)?
    };
    let limit = args
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(IDEAS_DEFAULT_LIMIT)
        .clamp(1, IDEAS_MAX_LIMIT);
    let rows = ideas::list_ideas(
        pool.pool(),
        Some(&project_id),
        opt_str(args, "status"),
        None,
        Some(limit),
        None,
    )
    .map_err(|e| format!("Query error: {e}"))?;
    to_text(&json!({
        "project_id": project_id,
        "count": rows.len(),
        "ideas": rows.iter().map(idea_row).collect::<Vec<_>>(),
    }))
}

pub(super) fn handle_get_idea(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let id_ref = opt_str(args, "idea_id").ok_or("idea_id is required")?;
    let idea = ideas::find_idea_by_id_or_prefix(pool.pool(), id_ref)
        .map_err(|e| format!("Query error: {e}"))?
        .ok_or_else(|| {
            format!(
                "No idea matches {id_ref} (a prefix must be at least 8 characters and match exactly one idea)"
            )
        })?;
    let latest_task = tasks::latest_task_for_idea(pool.pool(), &idea.id)
        .map_err(|e| format!("Query error: {e}"))?;

    let mut out = idea_row(&idea);
    if let Value::Object(map) = &mut out {
        map.insert("project_id".into(), json!(idea.project_id));
        map.insert("description".into(), json!(idea.description));
        map.insert("reasoning".into(), json!(idea.reasoning));
        map.insert("evidence".into(), json!(idea.evidence));
        map.insert("rejection_reason".into(), json!(idea.rejection_reason));
        map.insert("scan_type".into(), json!(idea.scan_type));
        map.insert("updated_at".into(), json!(idea.updated_at));
        map.insert(
            "latest_task".into(),
            latest_task
                .as_ref()
                .map_or(Value::Null, |t| task_row(t, None)),
        );
    }
    to_text(&out)
}

pub(super) fn handle_list_tasks(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let project_id = {
        let conn = pool.get()?;
        resolve_context_project(&conn, args)?
    };
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .map_or(TASKS_DEFAULT_LIMIT, |n| n as usize)
        .clamp(1, TASKS_MAX_LIMIT);
    let since = opt_str(args, "since");
    // `list_tasks` is newest-first and unbounded; the window and the cap are
    // applied here, over the one project's rows.
    let rows = tasks::list_tasks(pool.pool(), Some(&project_id), opt_str(args, "status"))
        .map_err(|e| format!("Query error: {e}"))?;
    let rows: Vec<Value> = rows
        .iter()
        // `Option::is_none_or` is stable since 1.82 and this crate declares MSRV 1.80.
        .filter(|t| since.map_or(true, |s| t.created_at.as_str() >= s))
        .take(limit)
        .map(|t| task_row(t, Some(LIST_ERROR_BYTES)))
        .collect();
    to_text(&json!({
        "project_id": project_id,
        "count": rows.len(),
        "tasks": rows,
    }))
}

#[cfg(test)]
mod tests {
    use super::super::tools::call_tool;
    use super::McpDbPool;
    use crate::db::repos::dev::{ideas, projects, tasks};
    use serde_json::{json, Value};

    fn ok_json(out: &Value) -> Value {
        assert_eq!(out["isError"], json!(false), "tool failed: {out}");
        serde_json::from_str(out["content"][0]["text"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn backlog_and_task_history_reads() {
        let pool = McpDbPool::from_pool(crate::db::init_test_db().expect("init_test_db"));
        let project = projects::create_project(
            pool.pool(),
            "Bank",
            "/tmp/bank-mcp-backlog",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let pid = project.id.clone();

        let accepted = ideas::create_idea(
            pool.pool(),
            Some(&pid),
            None,
            "manual",
            Some("functionality"),
            "Accepted item",
            Some("the body"),
            None,
            Some("accepted"),
            Some(2),
            Some(4),
            Some(1),
            None,
            None,
        )
        .unwrap();
        ideas::create_idea(
            pool.pool(),
            Some(&pid),
            None,
            "manual",
            Some("functionality"),
            "Pending unrated item",
            None,
            None,
            Some("pending"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let all = ok_json(&call_tool(
            "personas_list_ideas",
            &json!({ "project_id": pid }),
            &pool,
        ));
        assert_eq!(all["count"], json!(2));
        let pending = ok_json(&call_tool(
            "personas_list_ideas",
            &json!({ "project_id": pid, "status": "pending" }),
            &pool,
        ));
        assert_eq!(pending["count"], json!(1));
        assert_eq!(
            pending["ideas"][0]["risk"],
            Value::Null,
            "unrated stays null"
        );

        let task = tasks::create_task(
            pool.pool(),
            Some(&pid),
            "Deliver it",
            None,
            Some(&accepted.id),
            None,
            None,
            None,
        )
        .unwrap();
        tasks::update_task(
            pool.pool(),
            &task.id,
            None,
            None,
            Some("failed"),
            None,
            None,
            None,
            Some(Some("gate red")),
            Some(Some("2026-09-16T10:00:00+00:00")),
            Some(Some("2026-09-16T10:00:05+00:00")),
        )
        .unwrap();

        // A prefix resolves, and the latest task rides along.
        let got = ok_json(&call_tool(
            "personas_get_idea",
            &json!({ "idea_id": &accepted.id[..8] }),
            &pool,
        ));
        assert_eq!(got["id"], json!(accepted.id));
        assert_eq!(got["description"], json!("the body"));
        assert_eq!(got["latest_task"]["status"], json!("failed"));
        assert_eq!(got["latest_task"]["duration_ms"], json!(5000));

        let failed = ok_json(&call_tool(
            "personas_list_tasks",
            &json!({ "project_id": pid, "status": "failed" }),
            &pool,
        ));
        assert_eq!(failed["count"], json!(1));
        assert_eq!(failed["tasks"][0]["idea_id"], json!(accepted.id));
        assert_eq!(failed["tasks"][0]["error"], json!("gate red"));

        let future = ok_json(&call_tool(
            "personas_list_tasks",
            &json!({ "project_id": pid, "since": "2999-01-01T00:00:00Z" }),
            &pool,
        ));
        assert_eq!(future["count"], json!(0), "since excludes older tasks");

        let missing = call_tool("personas_get_idea", &json!({ "idea_id": "short" }), &pool);
        assert_eq!(missing["isError"], json!(true));
    }
}
