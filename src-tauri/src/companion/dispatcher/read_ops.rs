//! Read ops: bounded, read-only detail lookups over the system DB, plus the
//! text-clipping helpers and the episode note that feeds a lookup's result
//! back into Athena's next turn.
//!
//! Moved verbatim out of the former single-file `dispatcher.rs`.

use rusqlite::params;

use super::catalog::{
    read_op_detail_budget, LIST_TEAMS_FOOTER_RESERVE, LIST_TEAMS_MAX_ROWS, READ_OP_DETAIL_CHARS,
    READ_OP_SUGGESTIONS,
};
use crate::db::UserDbPool;

// ─────────────────────────────────────────────────────────────────────────
// Read ops: bounded, read-only detail lookups (see `READ_OPS`)
// ─────────────────────────────────────────────────────────────────────────

/// Truncate on a char boundary with an ellipsis. Every read-op renderer
/// runs its final body through the cap so no single lookup can blow up the
/// next turn's context.
pub(super) fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    format!(
        "{}\u{2026}",
        crate::utils::text::truncate_on_char_boundary(s, max)
    )
}

/// Collapse to one short line (first non-empty line, truncated).
fn one_line(s: &str, max: usize) -> String {
    let first = s
        .split(['\n', '\r'])
        .map(str::trim)
        .find(|t| !t.is_empty())
        .unwrap_or("");
    clip(first, max)
}

/// Append the result of a read op as a System episode, so Athena reads it
/// at the top of her next turn. Same channel and same best-effort posture
/// as `note_dispatcher_rejection`: a failed insert degrades to "the op did
/// nothing", never to a broken turn.
pub(super) fn note_read_op_result(
    pool: &UserDbPool,
    session_id: &str,
    action: &str,
    query: &str,
    body: &str,
) {
    let target = if query.is_empty() {
        String::new()
    } else {
        format!(" for `{query}`")
    };
    let content = format!(
        "[lookup] Result of your `{action}`{target}:\n\n{body}\n\nUse these \
         exact values. If the answer says nothing was found, say so to the \
         user instead of guessing an id.",
        action = action,
        target = target,
        // Per-op, not a single global number: `describe_ship_milestone`
        // answers with a whole milestone and was losing its entire tail to a
        // cap sized for one-entity lookups. See `read_op_detail_budget`.
        body = clip(body, read_op_detail_budget(action)),
    );
    if let Err(e) = crate::companion::brain::episodic::append_episode(
        pool,
        session_id,
        crate::companion::brain::episodic::EpisodeRole::System,
        &content,
    ) {
        tracing::warn!(
            action = action,
            error = %e,
            "note_read_op_result: failed to append system episode"
        );
    }
}

/// Full detail for one persona, resolved by exact id, then exact
/// (case-insensitive) name, then a substring match on name.
pub(super) fn describe_persona(sys_db: &crate::db::DbPool, query: &str) -> String {
    let Ok(conn) = sys_db.get() else {
        return "database unavailable".to_string();
    };
    let like = format!("%{query}%");
    let row = conn.query_row(
        "SELECT p.id, p.name, COALESCE(p.description, ''), COALESCE(p.system_prompt, ''),
                COALESCE(p.model_profile, ''), p.enabled, COALESCE(t.name, '')
         FROM personas p
         LEFT JOIN persona_teams t ON t.id = p.home_team_id
         WHERE p.id = ?1 COLLATE NOCASE
            OR p.name = ?1 COLLATE NOCASE
            OR p.name LIKE ?2 COLLATE NOCASE
         ORDER BY CASE WHEN p.id = ?1 THEN 0 WHEN p.name = ?1 COLLATE NOCASE THEN 1 ELSE 2 END,
                  p.enabled DESC, p.updated_at DESC
         LIMIT 1",
        params![query, like],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)? != 0,
                r.get::<_, String>(6)?,
            ))
        },
    );
    let Ok((id, name, description, system_prompt, model_profile, enabled, team)) = row else {
        return not_found(
            &conn,
            "agent",
            query,
            "SELECT name FROM personas ORDER BY enabled DESC, updated_at DESC LIMIT ?1",
        );
    };
    let model = serde_json::from_str::<serde_json::Value>(&model_profile)
        .ok()
        .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(str::to_string))
        .unwrap_or_else(|| "default".to_string());
    format!(
        "**{name}**\n- persona_id: `{id}`  (use this verbatim)\n- enabled: {enabled}\n\
         - model: {model}\n- home team: {team}\n- description: {description}\n\
         - system prompt (excerpt): {prompt}",
        name = name,
        id = id,
        enabled = enabled,
        model = model,
        team = if team.is_empty() { "none" } else { &team },
        description = one_line(&description, 200),
        prompt = clip(system_prompt.trim(), 500),
    )
}

/// Full detail for one dev context, resolved the same way as a persona.
pub(super) fn describe_context(sys_db: &crate::db::DbPool, query: &str) -> String {
    let Ok(conn) = sys_db.get() else {
        return "database unavailable".to_string();
    };
    let like = format!("%{query}%");
    let row = conn.query_row(
        "SELECT c.id, c.name, COALESCE(c.description, ''), COALESCE(c.file_paths, '[]'),
                COALESCE(c.keywords, ''), COALESCE(g.name, ''), COALESCE(p.name, '')
         FROM dev_contexts c
         LEFT JOIN dev_context_groups g ON g.id = c.group_id
         LEFT JOIN dev_projects p ON p.id = c.project_id
         WHERE c.id = ?1 COLLATE NOCASE
            OR c.name = ?1 COLLATE NOCASE
            OR c.name LIKE ?2 COLLATE NOCASE
         ORDER BY CASE WHEN c.id = ?1 THEN 0 WHEN c.name = ?1 COLLATE NOCASE THEN 1 ELSE 2 END,
                  c.pinned DESC, c.updated_at DESC
         LIMIT 1",
        params![query, like],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        },
    );
    let Ok((id, name, description, file_paths, keywords, group, project)) = row else {
        return not_found(
            &conn,
            "dev context",
            query,
            "SELECT name FROM dev_contexts ORDER BY pinned DESC, updated_at DESC LIMIT ?1",
        );
    };
    let files: Vec<String> = serde_json::from_str::<Vec<String>>(&file_paths).unwrap_or_default();
    let file_count = files.len();
    let sample = files
        .iter()
        .take(8)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "**{name}**\n- context_id: `{id}`\n- project: {project}\n- group: {group}\n\
         - description: {description}\n- files: {file_count} ({sample})\n- keywords: {keywords}",
        name = name,
        id = id,
        project = if project.is_empty() {
            "unknown"
        } else {
            &project
        },
        group = if group.is_empty() {
            "ungrouped"
        } else {
            &group
        },
        description = one_line(&description, 260),
        file_count = file_count,
        sample = clip(&sample, 400),
        keywords = one_line(&keywords, 160),
    )
}

/// Full when-to-use for one installed skill. Disk-only, so this is the one
/// read op that still answers without the system DB (it just loses the
/// per-project skill directories).
pub(super) fn describe_skill(sys_db: Option<&crate::db::DbPool>, query: &str) -> String {
    let entries = match sys_db {
        Some(db) => crate::companion::prompt::scan_skill_index(db),
        None => Vec::new(),
    };
    let needle = query.to_lowercase();
    let hit = entries
        .iter()
        .find(|e| e.name.to_lowercase() == needle)
        .or_else(|| {
            entries
                .iter()
                .find(|e| e.name.to_lowercase().contains(&needle))
        });
    let Some(hit) = hit else {
        let names: Vec<&str> = entries
            .iter()
            .take(READ_OP_SUGGESTIONS)
            .map(|e| e.name.as_str())
            .collect();
        return format!(
            "No installed skill matches `{query}`. Installed skills include: {}. \
             Do not invent a skill name.",
            if names.is_empty() {
                "none found on disk".to_string()
            } else {
                names.join(", ")
            }
        );
    };
    let content = std::fs::read_to_string(&hit.path).unwrap_or_default();
    format!(
        "**{name}** ({scope})\n- invoke as: `/{name}`\n- description: {desc}\n\n{body}",
        name = hit.name,
        scope = hit.scope,
        desc = one_line(&hit.description, 240),
        body = clip(content.trim(), 900),
    )
}

/// The team roster: `assign_team` needs a `team_id`, and teams were
/// deliberately left out of the always-on prompt index, so this op is the
/// only path to one. An empty query lists everything (bounded); a
/// non-empty one filters by name substring.
/// `list_runner_tasks` — what is already on the Dev Runner queue.
///
/// The runner is the OTHER execution lane. Athena could dispatch Fleet
/// sessions all day while a task for the same work sat queued on the Run Desk,
/// because she had no way to see it. `query` optionally filters by project
/// name/id substring. Read-only, bounded, and it names the empty case rather
/// than returning a blank body a model would read as an error.
pub(super) fn list_runner_tasks(sys_db: &crate::db::DbPool, query: &str) -> String {
    let tasks = match crate::db::repos::dev_tools::list_tasks(sys_db, None, None) {
        Ok(t) => t,
        Err(e) => return format!("Run Desk unavailable: {e}"),
    };
    // Only the live half of the queue is decision-relevant — a completed task
    // is history, and history is what the ledger is for.
    let want = query.to_ascii_lowercase();
    let live: Vec<_> = tasks
        .iter()
        .filter(|t| matches!(t.status.as_str(), "queued" | "running"))
        .filter(|t| {
            want.is_empty()
                || t.title.to_ascii_lowercase().contains(&want)
                || t.project_id
                    .as_deref()
                    .is_some_and(|p| p.to_ascii_lowercase().contains(&want))
        })
        .take(20)
        .collect();
    if live.is_empty() {
        return "Dev Runner queue: nothing queued or running.".to_string();
    }
    let mut out = format!("Dev Runner queue — {} live task(s):\n", live.len());
    for t in live {
        out.push_str(&format!(
            "- [{}] {} ({}%{})\n",
            t.status,
            t.title,
            t.progress_pct,
            t.project_id
                .as_deref()
                .map(|p| format!(", project {}", &p[..p.len().min(8)]))
                .unwrap_or_default(),
        ));
    }
    out
}

pub(super) fn list_teams(sys_db: &crate::db::DbPool, query: &str) -> String {
    let Ok(conn) = sys_db.get() else {
        return "database unavailable".to_string();
    };
    let like = if query.is_empty() {
        "%".to_string()
    } else {
        format!("%{query}%")
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT t.id, t.name, COALESCE(t.description, ''), t.enabled,
                (SELECT COUNT(*) FROM persona_team_members m WHERE m.team_id = t.id)
         FROM persona_teams t
         WHERE t.name LIKE ?1 COLLATE NOCASE
         ORDER BY t.enabled DESC, t.updated_at DESC",
    ) else {
        return "team lookup failed".to_string();
    };
    let Ok(rows) = stmt.query_map(params![like], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)? != 0,
            r.get::<_, i64>(4)?,
        ))
    }) else {
        return "team lookup failed".to_string();
    };
    let all: Vec<_> = rows.flatten().collect();
    if all.is_empty() {
        return if query.is_empty() {
            "No teams exist yet. `assign_team` has no valid target; suggest \
             creating a team first."
                .to_string()
        } else {
            format!("No team matches `{query}`. Re-run `list_teams` with no query to see them all.")
        };
    }
    let total = all.len();
    // Bounded twice over: a row cap AND a character cap. The row cap alone
    // is not enough — 25 teams with long names and descriptions still blow
    // the detail budget, and a body clipped after the fact would lose the
    // "N of M" line that keeps the answer honest.
    let mut body = String::new();
    let mut shown = 0usize;
    for (id, name, description, enabled, members) in all.iter().take(LIST_TEAMS_MAX_ROWS) {
        let row = format!(
            "- **{name}** `{id}` · {members} members{off} · {desc}\n",
            name = name.trim(),
            id = id,
            members = members,
            off = if *enabled { "" } else { " · DISABLED" },
            desc = one_line(description, 70),
        );
        if body.len() + row.len() + LIST_TEAMS_FOOTER_RESERVE > READ_OP_DETAIL_CHARS {
            break;
        }
        body.push_str(&row);
        shown += 1;
    }
    format!(
        "{body}\n_{shown} of {total} teams. The `id` is the `team_id` \
         `assign_team` expects; re-run `list_teams` with a name filter to \
         narrow it._",
        body = body,
        shown = shown,
        total = total,
    )
}

/// Shared miss path: say plainly that nothing matched, then offer a few
/// real names so the next attempt is grounded instead of invented.
///
/// Takes the caller's live `Connection` rather than the pool on purpose:
/// the miss path runs while the caller still holds its connection, and
/// asking a size-1 pool for a second one just stalls until the checkout
/// timeout and then silently produces no suggestions at all.
fn not_found(conn: &rusqlite::Connection, kind: &str, query: &str, suggest_sql: &str) -> String {
    let names: Vec<String> = (|| {
        let mut stmt = conn.prepare(suggest_sql).ok()?;
        let rows = stmt
            .query_map(params![READ_OP_SUGGESTIONS as i64], |r| {
                r.get::<_, String>(0)
            })
            .ok()?;
        Some(rows.flatten().collect::<Vec<String>>())
    })()
    .unwrap_or_default();
    if names.is_empty() {
        format!("No {kind} matches `{query}`, and none exist yet.")
    } else {
        format!(
            "No {kind} matches `{query}`. Existing ones include: {}. Ask the \
             user which they meant; do not invent an id.",
            names.join(", ")
        )
    }
}
