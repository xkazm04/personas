//! Import of the terminal standup's file plan (`/athena --standup` file mode).
//!
//! While the app is open the terminal standup is a CLIENT of the app's plan
//! (the `/companion/standup/*` doors in `local_http::standup`). Only while the
//! app is closed does it keep file mode and write
//! `~/.personas/standup/<YYYY-MM-DD>/PLAN.json`. The next time the app reads
//! its standup, the newest such file that is younger than every revision the
//! app holds becomes a DRAFT revision (never armed: the operator arms it on
//! the page). See `service::import_terminal_plan_once` for where it runs.
//!
//! The file's shape is the terminal's (`.claude/skills/athena/SKILL.md`):
//! `{date, armed:[{slug, direction, push:{remote,branch}|null}], off:[{slug,
//! why}], awayRules}`. `awayRules` there is free prose, so it is NOT mapped
//! onto the typed classes: the import keeps the default away rules and takes
//! only the named push targets.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::db::UserDbPool;
use crate::error::AppError;

use super::model::{
    PushTarget, Standup, StandupItem, StandupItemKind, StandupItemState, StandupStatus,
    StandupWindow,
};
use super::plan::{self, ProjectSeed};

#[derive(Debug, Deserialize)]
pub struct TerminalPlan {
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub armed: Vec<TerminalArmed>,
    #[serde(default)]
    pub off: Vec<TerminalOff>,
}

#[derive(Debug, Deserialize)]
pub struct TerminalArmed {
    pub slug: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub push: Option<TerminalPush>,
}

#[derive(Debug, Deserialize)]
pub struct TerminalPush {
    pub remote: String,
    pub branch: String,
}

#[derive(Debug, Deserialize)]
pub struct TerminalOff {
    pub slug: String,
    #[serde(default)]
    pub why: Option<String>,
}

/// `~/.personas/standup`.
pub fn default_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".personas").join("standup"))
}

/// The newest `<YYYY-MM-DD>/PLAN.json` under `root`, with its mtime (epoch ms).
pub fn newest_plan_file(root: &Path) -> Option<(PathBuf, i64)> {
    let mut dated: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| chrono::NaiveDate::parse_from_str(n, "%Y-%m-%d").is_ok())
        })
        .collect();
    dated.sort();
    dated.into_iter().rev().find_map(|dir| {
        let file = dir.join("PLAN.json");
        let modified = std::fs::metadata(&file).ok()?.modified().ok()?;
        let ms = modified
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .and_then(|d| i64::try_from(d.as_millis()).ok())?;
        Some((file, ms))
    })
}

fn norm(s: &str) -> String {
    s.trim().to_ascii_lowercase().replace([' ', '_'], "-")
}

/// A terminal slug -> a registered project: by name, or by its root folder.
fn resolve<'a>(slug: &str, projects: &'a [ProjectSeed]) -> Option<&'a ProjectSeed> {
    let want = norm(slug);
    projects.iter().find(|p| {
        norm(&p.name) == want
            || Path::new(&p.root.replace('\\', "/"))
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| norm(n) == want)
    })
}

/// The items and push targets a terminal plan describes, plus the slugs no
/// registered project answers to.
pub fn build_items(
    terminal: &TerminalPlan,
    projects: &[ProjectSeed],
    device_id: &str,
) -> (Vec<StandupItem>, Vec<PushTarget>, Vec<String>) {
    let source = terminal.date.as_deref().unwrap_or("undated");
    let mut items = Vec::new();
    let mut pushes = Vec::new();
    let mut unresolved = Vec::new();
    for (i, a) in terminal.armed.iter().enumerate() {
        let Some(p) = resolve(&a.slug, projects) else {
            unresolved.push(a.slug.clone());
            continue;
        };
        let mut item = plan::seed_item(&p.id, device_id, i32::try_from(i).unwrap_or(i32::MAX));
        let direction = a.direction.trim();
        if direction.is_empty() {
            item.evidence =
                format!("Named in the terminal standup ({source}) without a direction.");
        } else {
            item.state = StandupItemState::Edited;
            item.chosen = Some(direction.to_string());
            item.window = StandupWindow::Any;
            item.evidence = format!("Imported from the terminal standup PLAN.json ({source}).");
        }
        if let Some(push) = &a.push {
            pushes.push(PushTarget {
                project_id: p.id.clone(),
                remote: push.remote.clone(),
                branch: push.branch.clone(),
            });
        }
        items.push(item);
    }
    let base = i32::try_from(items.len()).unwrap_or(i32::MAX);
    for (i, o) in terminal.off.iter().enumerate() {
        // One `off` row can list several slugs ("a, b, c").
        for slug in o.slug.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let Some(p) = resolve(slug, projects) else {
                unresolved.push(slug.to_string());
                continue;
            };
            if items
                .iter()
                .any(|it| it.project_id.as_deref() == Some(p.id.as_str()))
            {
                continue;
            }
            let mut item = plan::seed_item(
                &p.id,
                device_id,
                base.saturating_add(i32::try_from(i).unwrap_or(0)),
            );
            item.state = StandupItemState::Skipped;
            item.evidence = format!(
                "Off in the terminal standup ({source}): {}",
                o.why.as_deref().unwrap_or("no reason given")
            );
            items.push(item);
        }
    }
    (items, pushes, unresolved)
}

/// Import `file` (modified at `mtime_ms`) as a draft revision, when it is
/// younger than every revision the app holds. A live DRAFT wins (the operator
/// is mid-edit; the file is left alone). A live ARMED revision gets the import
/// as revision n+1, with the parent's cards for projects the file does not
/// name. Returns the created draft, if any.
pub fn import_file(
    pool: &UserDbPool,
    file: &Path,
    mtime_ms: i64,
    device_id: &str,
    now_ms: i64,
    projects: &[ProjectSeed],
) -> Result<Option<Standup>, AppError> {
    if plan::latest_opened_at(pool)?.is_some_and(|latest| latest >= mtime_ms) {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(file)
        .map_err(|e| AppError::Internal(format!("standup import: read {}: {e}", file.display())))?;
    let terminal: TerminalPlan = serde_json::from_str(&raw).map_err(|e| {
        AppError::Validation(format!(
            "standup import: {} is not a standup plan: {e}",
            file.display()
        ))
    })?;
    let (mut items, pushes, unresolved) = build_items(&terminal, projects, device_id);
    if !unresolved.is_empty() {
        tracing::info!(?unresolved, file = %file.display(), "standup import: slugs with no registered project were left out");
    }
    let current = plan::current(pool)?;
    if current
        .as_ref()
        .is_some_and(|c| c.status == StandupStatus::Draft)
    {
        tracing::info!(file = %file.display(), "standup import: a draft is open; the terminal plan is not imported over it");
        return Ok(None);
    }
    let parent = current.filter(|c| c.status == StandupStatus::Armed);
    // Cards the file does not mention: the parent's, else a fresh one each.
    let next = items.iter().map(|i| i.priority).max().unwrap_or(-1) + 1;
    let mut extra = 0;
    for p in projects {
        let named = items.iter().any(|i| {
            i.kind == StandupItemKind::Direction && i.project_id.as_deref() == Some(p.id.as_str())
        });
        if named {
            continue;
        }
        let carried = parent.as_ref().and_then(|par| {
            par.plan
                .items
                .iter()
                .find(|i| {
                    i.kind == StandupItemKind::Direction
                        && i.project_id.as_deref() == Some(p.id.as_str())
                })
                .cloned()
        });
        items.push(carried.unwrap_or_else(|| plan::seed_item(&p.id, device_id, next + extra)));
        extra += 1;
    }
    let mut rules = parent
        .as_ref()
        .map(|p| p.away_rules.clone())
        .unwrap_or_else(plan::default_away_rules);
    for t in pushes {
        if !rules.push_targets.contains(&t) {
            rules.push_targets.push(t);
        }
    }
    let draft = plan::new_revision(parent.as_ref(), items, rules, device_id, now_ms);
    let conn = pool.get()?;
    plan::insert_in(&conn, &draft)?;
    Ok(Some(draft))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "date": "2026-10-30",
      "planPath": "C:/x/PLAN.md",
      "armed": [
        {"slug": "castlecontrol", "direction": "Fix desktop styles; finish e2e", "say": "say.md",
         "push": {"remote": "origin", "branch": "main", "repo": "C:/Spooky/CastleControl"}},
        {"slug": "unknown-thing", "direction": "whatever", "push": null}
      ],
      "off": [
        {"slug": "kp", "why": "not named"},
        {"slug": "devsecops, ascent", "why": "not named"}
      ],
      "awayRules": {"delegate": ["reversible scope inside a brief"], "park": ["money"]}
    }"#;

    fn projects() -> Vec<ProjectSeed> {
        vec![
            ProjectSeed {
                id: "cc".into(),
                name: "Castle Control".into(),
                root: "C:/Spooky/CastleControl".into(),
            },
            ProjectSeed {
                id: "kp".into(),
                name: "kp".into(),
                root: "C:/kiro/kp".into(),
            },
            ProjectSeed {
                id: "pw".into(),
                name: "personas-web".into(),
                root: "C:/kiro/personas-web".into(),
            },
        ]
    }

    fn write_sample(dir: &Path, date: &str) -> PathBuf {
        let d = dir.join(date);
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("PLAN.json");
        std::fs::write(&f, SAMPLE).unwrap();
        f
    }

    #[test]
    fn a_sample_plan_imports_as_a_draft_revision() {
        let pool = crate::db::init_test_user_db().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        write_sample(tmp.path(), "2026-10-29");
        let newest = write_sample(tmp.path(), "2026-10-30");
        std::fs::create_dir_all(tmp.path().join("tools")).unwrap();

        let (file, mtime) = newest_plan_file(tmp.path()).unwrap();
        assert_eq!(file, newest);
        let draft = import_file(&pool, &file, mtime, "dev-1", mtime + 1, &projects())
            .unwrap()
            .expect("imported");
        assert_eq!(draft.revision, 1);
        assert_eq!(draft.status, StandupStatus::Draft);

        let cc = draft
            .plan
            .items
            .iter()
            .find(|i| i.project_id.as_deref() == Some("cc"))
            .unwrap();
        assert_eq!(cc.state, StandupItemState::Edited);
        assert_eq!(cc.chosen.as_deref(), Some("Fix desktop styles; finish e2e"));
        let kp = draft
            .plan
            .items
            .iter()
            .find(|i| i.project_id.as_deref() == Some("kp"))
            .unwrap();
        assert_eq!(kp.state, StandupItemState::Skipped);
        let pw = draft
            .plan
            .items
            .iter()
            .find(|i| i.project_id.as_deref() == Some("pw"))
            .unwrap();
        assert_eq!(
            pw.state,
            StandupItemState::Proposed,
            "an unnamed project gets a fresh card"
        );
        assert_eq!(
            draft.plan.items.len(),
            3,
            "the unregistered slug is left out"
        );
        assert_eq!(
            draft.away_rules.push_targets,
            vec![PushTarget {
                project_id: "cc".into(),
                remote: "origin".into(),
                branch: "main".into()
            }]
        );
        assert_eq!(
            draft.away_rules.delegate,
            plan::default_away_rules().delegate
        );

        // Idempotent: the draft is younger than the file now.
        assert!(
            import_file(&pool, &file, mtime, "dev-1", mtime + 2, &projects())
                .unwrap()
                .is_none()
        );
        assert_eq!(plan::history(&pool, 10).unwrap().len(), 1);
    }

    #[test]
    fn an_open_draft_is_never_imported_over() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (draft, _) = plan::open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let f = write_sample(tmp.path(), "2026-10-30");
        assert!(import_file(&pool, &f, 5_000, "dev-1", 6_000, &projects())
            .unwrap()
            .is_none());
        assert_eq!(plan::current(&pool).unwrap().unwrap().id, draft.id);
    }

    #[test]
    fn an_armed_plan_gets_the_import_as_revision_n_plus_one() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (first, _) = plan::open(&pool, "dev-1", 1_000, &projects(), None).unwrap();
        assert!(plan::claim_armed(&pool, &first.id, 1_100).unwrap());
        let tmp = tempfile::tempdir().unwrap();
        let f = write_sample(tmp.path(), "2026-10-30");
        let draft = import_file(&pool, &f, 5_000, "dev-1", 6_000, &projects())
            .unwrap()
            .unwrap();
        assert_eq!(draft.revision, 2);
        assert_eq!(draft.parent_id.as_deref(), Some(first.id.as_str()));
        let pw_parent = first
            .plan
            .items
            .iter()
            .find(|i| i.project_id.as_deref() == Some("pw"))
            .unwrap();
        assert!(
            draft.plan.items.iter().any(|i| i.id == pw_parent.id),
            "the parent's card is carried"
        );
    }
}
