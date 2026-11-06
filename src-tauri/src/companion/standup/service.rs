//! The standup's app-facing operations: one function per verb, each taking the
//! `AppHandle`, so the Tauri commands (`commands/companion/standup.rs`) and the
//! terminal client's HTTP doors (`local_http::standup`) are both one-call
//! adapters over the same code. Database work runs on a blocking thread; every
//! write emits `standup://updated` (`StandupUpdatedPayload`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use personas_core::events::{event_name, StandupUpdatedPayload};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;
use crate::AppState;

use super::model::{AwayRules, Standup, StandupEvent, StandupItemPatch, StandupSummary};
use super::plan::{self, ProjectSeed};
use super::{arm, plan_import, propose, report};

/// Tell every listener a revision moved. They re-read it with
/// `standup_current`; the standup never rides on the event.
pub fn emit_updated(app: &AppHandle, standup_id: &str) {
    let payload = StandupUpdatedPayload {
        standup_id: standup_id.to_string(),
    };
    if let Err(e) = app.emit(event_name::STANDUP_UPDATED, payload) {
        tracing::warn!(standup_id, error = %e, "standup: updated event not emitted");
    }
}

fn pools(app: &AppHandle) -> (DbPool, UserDbPool) {
    let state = app.state::<Arc<AppState>>();
    (state.db.clone(), state.user_db.clone())
}

/// Run `f` over the two pools on a blocking thread (rusqlite never runs on
/// the IPC worker).
async fn blocking<T, F>(app: &AppHandle, what: &'static str, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(DbPool, UserDbPool) -> Result<T, AppError> + Send + 'static,
{
    let (db, user_db) = pools(app);
    tauri::async_runtime::spawn_blocking(move || f(db, user_db))
        .await
        .map_err(|e| AppError::Internal(format!("standup {what}: worker join failed: {e}")))?
}

/// The registered, switched-on projects a standup plans over.
pub fn project_seeds(db: &DbPool) -> Result<Vec<ProjectSeed>, AppError> {
    Ok(
        crate::db::repos::dev_tools::list_projects(db, Some("active"))?
            .into_iter()
            .filter(|p| p.enabled)
            .map(|p| ProjectSeed {
                id: p.id,
                name: p.name,
                root: p.root_path,
            })
            .collect(),
    )
}

/// This device's id (v1 always plans for this device).
fn device_id(db: &DbPool) -> String {
    crate::cloud::sync::cursor::resolve_device_id(db)
}

static IMPORT_TRIED: AtomicBool = AtomicBool::new(false);

/// Import the terminal standup's newest `PLAN.json` as a draft revision, at
/// most once per process: on the first standup read after boot (current or
/// open, from the page or a door). An isolated instance (`PERSONAS_DATA_DIR`)
/// never imports the operator's terminal plan. Failures are logged; the read
/// goes on.
fn import_terminal_plan_once(db: &DbPool, user_db: &UserDbPool) -> Option<String> {
    if IMPORT_TRIED.swap(true, Ordering::SeqCst) {
        return None;
    }
    if crate::local_http::isolated_handshake_path().is_some() {
        return None;
    }
    let root = plan_import::default_root()?;
    let (file, mtime) = plan_import::newest_plan_file(&root)?;
    let result = project_seeds(db).and_then(|projects| {
        plan_import::import_file(
            user_db,
            &file,
            mtime,
            &device_id(db),
            chrono::Utc::now().timestamp_millis(),
            &projects,
        )
    });
    match result {
        Ok(Some(s)) => {
            tracing::info!(standup_id = %s.id, file = %file.display(), "standup: imported the terminal plan as a draft");
            Some(s.id)
        }
        Ok(None) => None,
        Err(e) => {
            tracing::warn!(file = %file.display(), error = %e, "standup: terminal plan not imported");
            None
        }
    }
}

/// The live standup (newest draft or armed revision), if any.
pub async fn current(app: &AppHandle) -> Result<Option<Standup>, AppError> {
    let (imported, current) = blocking(app, "current", |db, user_db| {
        let imported = import_terminal_plan_once(&db, &user_db);
        Ok((imported, plan::current(&user_db)?))
    })
    .await?;
    if let Some(id) = imported {
        emit_updated(app, &id);
    }
    Ok(current)
}

/// Open a standup: revision 1, the live draft, or revision n+1 of the armed
/// plan (`plan::open`).
pub async fn open(app: &AppHandle) -> Result<Standup, AppError> {
    let (imported, (s, created)) = blocking(app, "open", |db, user_db| {
        let imported = import_terminal_plan_once(&db, &user_db);
        let projects = project_seeds(&db)?;
        let opened = plan::open(
            &user_db,
            &device_id(&db),
            chrono::Utc::now().timestamp_millis(),
            &projects,
        )?;
        Ok((imported, opened))
    })
    .await?;
    if let Some(id) = imported.filter(|id| *id != s.id) {
        emit_updated(app, &id);
    }
    if created {
        emit_updated(app, &s.id);
    }
    Ok(s)
}

/// Start the proposal job (returns at once with the revision as it is).
pub async fn propose(app: &AppHandle, standup_id: &str) -> Result<Standup, AppError> {
    let id = standup_id.to_string();
    let s = blocking(app, "propose", move |_db, user_db| {
        plan::require(&user_db, &id)
    })
    .await?;
    if s.status != super::model::StandupStatus::Draft {
        return Err(AppError::Validation(format!(
            "standup {} is not a draft; proposals are asked for while it is being decided",
            s.id
        )));
    }
    propose::spawn(app.clone(), s.id.clone());
    Ok(s)
}

/// Apply one item patch to a draft.
pub async fn update_item(
    app: &AppHandle,
    standup_id: &str,
    patch: StandupItemPatch,
) -> Result<Standup, AppError> {
    let id = standup_id.to_string();
    let s = blocking(app, "update_item", move |_db, user_db| {
        plan::patch_item(&user_db, &id, &patch)
    })
    .await?;
    emit_updated(app, &s.id);
    Ok(s)
}

/// Replace a draft's away rules.
pub async fn set_away_rules(
    app: &AppHandle,
    standup_id: &str,
    rules: AwayRules,
) -> Result<Standup, AppError> {
    let id = standup_id.to_string();
    let s = blocking(app, "set_away_rules", move |_db, user_db| {
        plan::set_away_rules(&user_db, &id, &rules)
    })
    .await?;
    emit_updated(app, &s.id);
    Ok(s)
}

/// Pass the go-gate (idempotent per revision). Refused items stay on the plan;
/// their reasons are `stop` events of the revision (`standup_events`).
pub async fn arm(app: &AppHandle, standup_id: &str) -> Result<Standup, AppError> {
    let out = arm::arm(app, standup_id).await?;
    if out.newly_armed {
        if !out.refused.is_empty() || !out.failed.is_empty() {
            tracing::info!(
                standup_id,
                refused = ?out.refused,
                failed = ?out.failed,
                "standup: armed with items not carried out"
            );
        }
        if let Some(parent) = out.standup.parent_id.as_deref() {
            emit_updated(app, parent);
        }
        emit_updated(app, &out.standup.id);
    }
    Ok(out.standup)
}

/// End a revision and store its final report. Ending a draft amendment also
/// ends the armed revision it amends: the standup as a whole is over.
pub async fn end(app: &AppHandle, standup_id: &str) -> Result<Standup, AppError> {
    let id = standup_id.to_string();
    let (s, ended) = blocking(app, "end", move |db, user_db| {
        let s = plan::require(&user_db, &id)?;
        let mut ended = Vec::new();
        let mut targets = vec![s.clone()];
        if s.status == super::model::StandupStatus::Draft {
            if let Some(parent) = s.parent_id.as_deref().map(|p| plan::get(&user_db, p)).transpose()?.flatten() {
                if parent.status == super::model::StandupStatus::Armed {
                    targets.push(parent);
                }
            }
        }
        let now = chrono::Utc::now().timestamp_millis();
        for t in targets {
            if t.status == super::model::StandupStatus::Ended {
                continue;
            }
            let built = match report::build_with(&user_db, &db, &t.id) {
                Ok(r) => Some(r),
                Err(e) => {
                    tracing::warn!(standup_id = %t.id, error = %e, "standup: report not built; ending without one");
                    None
                }
            };
            if plan::mark_ended(&user_db, &t.id, now, built.as_ref())? {
                ended.push(t.id);
            }
        }
        Ok((plan::require(&user_db, &id)?, ended))
    })
    .await?;
    for id in ended {
        emit_updated(app, &id);
    }
    Ok(s)
}

/// A revision's away acts, newest first.
pub async fn events(
    app: &AppHandle,
    standup_id: &str,
    limit: i32,
) -> Result<Vec<StandupEvent>, AppError> {
    let id = standup_id.to_string();
    blocking(app, "events", move |_db, user_db| {
        plan::list_events(&user_db, &id, limit)
    })
    .await
}

/// Past revisions, newest first.
pub async fn history(app: &AppHandle, limit: i32) -> Result<Vec<StandupSummary>, AppError> {
    blocking(app, "history", move |_db, user_db| {
        plan::history(&user_db, limit)
    })
    .await
}

/// The title of an item's "Talk it through" conversation. Deterministic, so a
/// second click reuses the thread instead of opening another.
fn discuss_title(project_name: &str, item_id: &str) -> String {
    let short: String = item_id.trim_start_matches("sti_").chars().take(6).collect();
    format!("Standup: {project_name} ({short})")
}

/// The seed Athena's thread opens with: the project, what moved and the
/// directions on the card, as one self-contained assistant turn.
fn discuss_seed(project_name: &str, item: &super::model::StandupItem) -> String {
    let mut text = format!("Let's talk through {project_name} for this standup.");
    if !item.evidence.trim().is_empty() {
        text.push_str(&format!("\n\nWhat moved: {}", item.evidence.trim()));
    }
    if !item.proposals.is_empty() {
        text.push_str("\n\nThe directions I proposed:");
        for p in &item.proposals {
            let mark = if p.recommended { " (my pick)" } else { "" };
            text.push_str(&format!("\n- {}{mark}: {}", p.text, p.rationale));
        }
    }
    if let Some(c) = item.chosen.as_deref() {
        text.push_str(&format!("\n\nOn the card now: {c}"));
    }
    text.push_str("\n\nTell me what you want this project to reach, and I'll put the agreed direction back on the card.");
    text
}

/// Open (or reuse) the Athena conversation bound to one item, the way the
/// forward-to-Athena flow opens a context-bound thread: its own `forwarded`
/// conversation (never the current one), seeded with the item's project,
/// evidence and proposals as an assistant turn. Returns the conversation id.
pub async fn discuss(app: &AppHandle, standup_id: &str, item_id: &str) -> Result<String, AppError> {
    let (sid, iid) = (standup_id.to_string(), item_id.to_string());
    blocking(app, "discuss", move |db, user_db| {
        let s = plan::require(&user_db, &sid)?;
        let item = s
            .plan
            .items
            .iter()
            .find(|i| i.id == iid)
            .ok_or_else(|| AppError::NotFound(format!("Standup item {iid} in {sid}")))?;
        let project_name = match item.project_id.as_deref() {
            Some(pid) => crate::db::repos::dev_tools::get_project_by_id(&db, pid)
                .map(|p| p.name)
                .unwrap_or_else(|_| pid.to_string()),
            None => "an agent change".to_string(),
        };
        let title = discuss_title(&project_name, &item.id);
        let existing = crate::companion::conversation::list(&user_db, false)?
            .into_iter()
            .find(|c| c.title.as_deref() == Some(title.as_str()));
        if let Some(c) = existing {
            return Ok(c.id);
        }
        let conv = crate::companion::conversation::create(&user_db, Some(&title), "forwarded")?;
        crate::companion::brain::episodic::append_episode(
            &user_db,
            &conv.id,
            crate::companion::brain::episodic::EpisodeRole::Assistant,
            &discuss_seed(&project_name, item),
        )?;
        Ok(conv.id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discuss_title_is_stable_per_item() {
        assert_eq!(
            discuss_title("alpha", "sti_abcdef1234"),
            "Standup: alpha (abcdef)"
        );
        assert_eq!(
            discuss_title("alpha", "sti_abcdef1234"),
            discuss_title("alpha", "sti_abcdef1234")
        );
    }

    #[test]
    fn discuss_seed_carries_evidence_proposals_and_choice() {
        let mut item = plan::seed_item("p1", "d", 0);
        item.evidence = "last: a1 fix".into();
        item.proposals = vec![super::super::model::DirectionProposal {
            id: "a".into(),
            text: "Ship it".into(),
            rationale: "ready".into(),
            recommended: true,
        }];
        item.chosen = Some("Ship it".into());
        let seed = discuss_seed("alpha", &item);
        assert!(seed.contains("What moved: last: a1 fix"));
        assert!(seed.contains("- Ship it (my pick): ready"));
        assert!(seed.contains("On the card now: Ship it"));
    }
}
