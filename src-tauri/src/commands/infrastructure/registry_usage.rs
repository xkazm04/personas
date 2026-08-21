//! Contribute this installation's skill-usage counts to a knowledge registry.
//!
//! The registry's `usage/` lane (its `docs/usage-lane.md`) takes one file per
//! contributing installation and aggregates them into `catalog.json`. This is
//! the Personas writer for that lane.
//!
//! ## Local count first
//!
//! Nothing here counts anything. `skill_usage_events` has been counting
//! invocations locally all along; this reads a 30-day window of it and writes
//! the aggregate. The registry never sees an event, only a total.
//!
//! ## Aggregate only — the privacy contract
//!
//! The registry is PUBLIC and its gate rejects anything that looks like a path,
//! a URL or an address. So the query deliberately groups by `skill_name` ALONE,
//! dropping `project_id` on the floor: "which of my repos ran this" is a fact
//! about one organization's fleet, and the registry only needs "how often was
//! this skill reached for". Writing the per-project breakdown would be both a
//! leak and a gate failure — the shape enforces the rule rather than relying on
//! the caller to remember it.
//!
//! ## Piggyback, never a commit of its own
//!
//! This command only WRITES the file into the working copy. Committing it is the
//! share task's job, alongside the skill it was already committing. A commit
//! whose only content is a count is noise in a repo people read, and it would
//! turn every skill run into a git write.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// The window the contributed counts cover. Matches the registry lane's own
/// `windowDays` and the 30-day figure the app already reports everywhere else.
const WINDOW_DAYS: i64 = 30;

/// `[a-z0-9][a-z0-9-]*`, which is what the registry gate requires of both the
/// contributor id and the filename stem. Returns `None` when nothing usable
/// survives — the caller must not invent an id, because a colliding id makes two
/// installations overwrite each other's file.
fn slugify(raw: &str) -> Option<String> {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in raw.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !out.is_empty() && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_end_matches('-').to_string();
    if trimmed.is_empty() || !trimmed.starts_with(|c: char| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some(trimmed)
}

/// Write `<clone_path>/usage/<contributor>.json`. Returns the number of skills
/// reported.
///
/// `contributor` is slugified here and the file is named from the RESULT, so the
/// gate's "contributor must equal the filename stem" rule cannot be violated by
/// a caller passing something unslugged.
#[tauri::command]
pub fn dev_tools_write_registry_usage(
    state: State<'_, Arc<AppState>>,
    clone_path: String,
    contributor: String,
) -> Result<usize, AppError> {
    require_auth_sync(&state)?;

    let slug = slugify(&contributor).ok_or_else(|| {
        AppError::Validation(format!(
            "contributor \"{contributor}\" has no usable slug — the registry requires [a-z0-9][a-z0-9-]*"
        ))
    })?;

    let root = PathBuf::from(clone_path.trim());
    if root.as_os_str().is_empty() || !root.is_dir() {
        return Err(AppError::Validation(format!(
            "no registry working copy at \"{}\" — pair the registry before contributing usage",
            root.display()
        )));
    }

    // GROUP BY skill_name only. See the module header: the absence of
    // `project_id` here is the privacy contract, not an oversight.
    let conn = state.db.get()?;
    let mut stmt = conn.prepare(
        "SELECT skill_name, COUNT(*), MAX(occurred_at)
           FROM skill_usage_events
          WHERE event = 'invoke'
            AND occurred_at >= datetime('now', ?1)
          GROUP BY skill_name
          ORDER BY skill_name",
    )?;
    let rows = stmt.query_map([format!("-{WINDOW_DAYS} days")], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;

    let mut skills = serde_json::Map::new();
    for (name, invokes, last_used) in rows.flatten() {
        let mut entry = serde_json::Map::new();
        entry.insert("invokes".into(), json!(invokes));
        // SQLite's `datetime()` yields `YYYY-MM-DD HH:MM:SS`; the lane wants
        // ISO-8601, and the gate checks it.
        if let Some(ts) = last_used {
            entry.insert(
                "lastUsed".into(),
                json!(format!("{}Z", ts.trim().replace(' ', "T"))),
            );
        }
        skills.insert(name, serde_json::Value::Object(entry));
    }
    let count = skills.len();

    let doc = json!({
        "schema": "rkb-usage/1",
        "contributor": slug,
        "app": "personas",
        "generatedAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "windowDays": WINDOW_DAYS,
        "skills": skills,
    });

    let dir = root.join("usage");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Internal(format!("create usage dir: {e}")))?;
    let pretty = serde_json::to_string_pretty(&doc)
        .map_err(|e| AppError::Internal(format!("serialize usage file: {e}")))?;
    std::fs::write(dir.join(format!("{slug}.json")), format!("{pretty}\n"))
        .map_err(|e| AppError::Internal(format!("write usage file: {e}")))?;

    Ok(count)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn slugify_produces_ids_the_registry_gate_accepts() {
        assert_eq!(slugify("Dev Box").as_deref(), Some("dev-box"));
        assert_eq!(slugify("team_A/2").as_deref(), Some("team-a-2"));
        assert_eq!(slugify("  spaced  out  ").as_deref(), Some("spaced-out"));
        // Must start with an alphanumeric — a leading separator is stripped by
        // construction rather than producing "-foo", which the gate rejects.
        assert_eq!(slugify("--lead").as_deref(), Some("lead"));
    }

    #[test]
    fn slugify_refuses_rather_than_inventing_an_id() {
        // Nothing usable survives. Returning a fallback like "personas" here
        // would let two installations collide on one filename and silently
        // overwrite each other's contribution.
        assert_eq!(slugify(""), None);
        assert_eq!(slugify("///"), None);
        assert_eq!(slugify("日本語"), None);
    }
}
