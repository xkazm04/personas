//! `POST /dev-tools/reports` — a headless App Master's report, its screenshots,
//! and the approval it asks the operator for.
//!
//! A headless App Master runs from a terminal and never writes the app
//! database (`.claude/skills/appmaster`). What it has to SHOW the operator — a
//! finished piece of work, the screenshots that prove it, a decision it needs —
//! lands here as one `persona_reports` row plus, when asked, one
//! `persona_manual_reviews` row that points back at it.
//!
//! The shape below is a contract with the Reports / Approvals UI and must not
//! drift:
//!
//! ```json
//! report.metadata = {"projectId":"<id>","source":"headless-app-master",
//!                    "attachments":[{"path":"<abs path of the COPY>","caption":"..."}],
//!                    "attachmentsCleaned":false}
//! review.context_data = {"reportId":"<id>"}
//! ```
//!
//! **Attachments are copied, never referenced.** The caller names files in its
//! own project tree; those move, get rebased away, or vanish with a worktree.
//! Each one is copied into `<app data dir>/reports/<reportId>/NN-<basename>`,
//! the directory Tauri's asset protocol already serves (`$APPDATA/**` in
//! `tauri.conf.json`), and the copy's path is what the row records. When the
//! linked approval is decided, `manual_reviews::update_status` deletes that
//! directory and flips `attachmentsCleaned` (see
//! `reports::release_headless_attachments`).
//!
//! **Everything is checked before anything is written**, and a failure after
//! the first write undoes the earlier ones, so a replayed outbox entry finds
//! either the whole report or nothing.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::app_master_adopt::app_master_persona;
use super::headless_doors::{require_project, DoorError};
use crate::db::models::{CreateReportInput, PersonaReport};
use crate::db::repos::communication::manual_reviews;
use crate::db::repos::communication::reports;
use crate::db::repos::core::personas as personas_repo;
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;

/// Files one report may carry. A report is read by a person; a dozen
/// screenshots is already a lot to look at before deciding.
pub const MAX_ATTACHMENTS: usize = 12;
/// Largest file copied. A screen recording past this is not a proof anyone
/// watches, and the copies are kept until the decision.
pub const MAX_ATTACHMENT_BYTES: u64 = 8 * 1024 * 1024;
/// What a report may carry, by extension: images and short recordings the
/// Reports UI renders, PDFs, and markdown. An ALLOWLIST — anything else is
/// refused rather than guessed at.
const ATTACHMENT_EXTENSIONS: [&str; 10] = [
    "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "pdf", "md", "markdown",
];
/// The severities the review surfaces render (the union of what the live
/// table holds and what the Approvals UI colours).
const REVIEW_SEVERITIES: [&str; 6] = ["info", "low", "medium", "high", "warning", "critical"];
/// Reports post as markdown: the body is rendered by the Reports document view
/// either way, and `markdown` is a content type the dispatcher already files
/// as a report rather than a chat note.
const REPORT_CONTENT_TYPE: &str = "markdown";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostReportInput {
    pub project_id: String,
    /// Defaults to the project's App Master persona.
    #[serde(default)]
    pub persona_id: Option<String>,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<AttachmentInput>,
    #[serde(default)]
    pub approval: Option<ApprovalInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub path: String,
    #[serde(default)]
    pub caption: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalInput {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    /// `info` when absent.
    #[serde(default)]
    pub severity: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPosted {
    pub report_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    /// The row as written, when THIS call wrote it — the route emits it as
    /// `report-created` so an open Reports list shows it. `None` on a replay
    /// that found the report already there.
    #[serde(skip)]
    pub created: Option<PersonaReport>,
}

/// Where the door reads attachments from and copies them to.
#[derive(Debug, Clone)]
pub struct ReportRoots {
    /// The app data directory (Tauri's `app_data_dir`, where the database
    /// lives). Copies go under `<this>/reports/<reportId>/`.
    pub app_data_dir: PathBuf,
    /// The user's `~/.personas` tree — one of the places an attachment may be
    /// read FROM, beside every registered project root.
    pub personas_home: Option<PathBuf>,
}

/// One attachment that passed every check, ready to copy.
#[derive(Debug)]
struct CheckedAttachment {
    source: PathBuf,
    file_name: String,
    caption: Option<String>,
}

fn non_blank(field: &str, value: &str) -> Result<(), DoorError> {
    if value.trim().is_empty() {
        return Err(DoorError::BadRequest(format!(
            "`{field}` must not be empty"
        )));
    }
    Ok(())
}

/// Strip the verbatim prefix `canonicalize` adds on Windows so two canonical
/// forms of one directory compare equal however each was produced.
fn canonical(p: &Path) -> Option<PathBuf> {
    let c = p.canonicalize().ok()?;
    let s = c.to_string_lossy();
    Some(match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => c,
    })
}

/// The directories an attachment may be read from: the `~/.personas` tree and
/// every registered project root that exists on disk.
fn readable_roots(pool: &DbPool, roots: &ReportRoots) -> Result<Vec<PathBuf>, DoorError> {
    let mut out: Vec<PathBuf> = roots
        .personas_home
        .as_deref()
        .and_then(canonical)
        .into_iter()
        .collect();
    for project in repo::list_projects(pool, None)? {
        if let Some(root) = canonical(Path::new(&project.root_path)) {
            out.push(root);
        }
    }
    Ok(out)
}

fn check_attachment(
    a: &AttachmentInput,
    readable: &[PathBuf],
) -> Result<CheckedAttachment, DoorError> {
    let raw = a.path.trim();
    non_blank("attachments[].path", raw)?;
    let Some(source) = canonical(Path::new(raw)) else {
        return Err(DoorError::BadRequest(format!(
            "attachment `{raw}` is not an existing file"
        )));
    };
    if !source.is_file() {
        return Err(DoorError::BadRequest(format!(
            "attachment `{raw}` is not a file"
        )));
    }
    if !readable.iter().any(|root| source.starts_with(root)) {
        return Err(DoorError::BadRequest(format!(
            "attachment `{raw}` is outside every allowed root (the ~/.personas tree or a registered project root)"
        )));
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ATTACHMENT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(DoorError::BadRequest(format!(
            "attachment `{raw}`: `.{ext}` is not one of {ATTACHMENT_EXTENSIONS:?}"
        )));
    }
    let len = std::fs::metadata(&source)
        .map_err(|e| DoorError::BadRequest(format!("attachment `{raw}` is not readable: {e}")))?
        .len();
    if len > MAX_ATTACHMENT_BYTES {
        return Err(DoorError::BadRequest(format!(
            "attachment `{raw}` is {len} bytes (cap {MAX_ATTACHMENT_BYTES})"
        )));
    }
    let file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .ok_or_else(|| DoorError::BadRequest(format!("attachment `{raw}` has no file name")))?;
    Ok(CheckedAttachment {
        source,
        file_name,
        caption: a
            .caption
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .map(str::to_string),
    })
}

/// The persona the report is filed under: the named one, or the project's App
/// Master. 404 for a named persona that does not exist; 409 when none was named
/// and the project has no App Master to default to.
fn resolve_persona(pool: &DbPool, input: &PostReportInput) -> Result<String, DoorError> {
    if let Some(id) = input.persona_id.as_deref() {
        return Ok(personas_repo::get_by_id(pool, id)?.id);
    }
    app_master_persona(pool, &input.project_id)?
        .map(|p| p.id)
        .ok_or_else(|| {
            DoorError::Conflict(format!(
                "project {} has no App Master persona to file the report under; name `personaId`",
                input.project_id
            ))
        })
}

/// Undo a half-written report: the copies, then the row. Best-effort and
/// logged; the error the caller is already returning is the one that matters.
fn undo_report(pool: &DbPool, report_id: &str, dir: Option<&Path>) {
    if let Some(dir) = dir {
        if dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(dir) {
                tracing::warn!(report_id, dir = %dir.display(), error = %e,
                    "headless report: could not remove the copies of a report being undone");
            }
        }
    }
    if let Err(e) = reports::delete(pool, report_id) {
        tracing::warn!(report_id, error = %e, "headless report: could not delete a report being undone");
    }
}

fn raise_approval(
    pool: &DbPool,
    persona_id: &str,
    report_id: &str,
    approval: &ApprovalInput,
    severity: &str,
) -> Result<String, DoorError> {
    let review = manual_reviews::create_unanchored(
        pool,
        manual_reviews::UnanchoredReviewInput {
            persona_id,
            title: approval.title.trim(),
            description: approval.description.as_deref(),
            severity,
            context_data: Some(&serde_json::json!({ "reportId": report_id }).to_string()),
        },
    )?;
    Ok(review.id)
}

/// The door. See the module header for the contract.
pub fn post_report(
    pool: &DbPool,
    input: &PostReportInput,
    roots: &ReportRoots,
) -> Result<ReportPosted, DoorError> {
    // ── validate everything first ───────────────────────────────────────
    require_project(pool, &input.project_id)?;
    non_blank("title", &input.title)?;
    non_blank("content", &input.content)?;
    let persona_id = resolve_persona(pool, input)?;

    if input.attachments.len() > MAX_ATTACHMENTS {
        return Err(DoorError::BadRequest(format!(
            "{} attachments (cap {MAX_ATTACHMENTS})",
            input.attachments.len()
        )));
    }
    let checked: Vec<CheckedAttachment> = if input.attachments.is_empty() {
        Vec::new()
    } else {
        let readable = readable_roots(pool, roots)?;
        input
            .attachments
            .iter()
            .map(|a| check_attachment(a, &readable))
            .collect::<Result<_, _>>()?
    };

    let severity = match input.approval.as_ref() {
        Some(a) => {
            non_blank("approval.title", &a.title)?;
            let s = a
                .severity
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("info")
                .to_ascii_lowercase();
            if !REVIEW_SEVERITIES.contains(&s.as_str()) {
                return Err(DoorError::BadRequest(format!(
                    "approval.severity `{s}` is not one of {REVIEW_SEVERITIES:?}"
                )));
            }
            Some(s)
        }
        None => None,
    };

    // ── write ───────────────────────────────────────────────────────────
    let asked_at = chrono::Utc::now();
    let metadata = serde_json::json!({
        "projectId": input.project_id,
        "source": reports::HEADLESS_REPORT_SOURCE,
        "attachments": [],
        "attachmentsCleaned": false,
    });
    let report = reports::create(
        pool,
        CreateReportInput {
            persona_id: persona_id.clone(),
            execution_id: None,
            title: Some(input.title.trim().to_string()),
            content: input.content.clone(),
            content_type: Some(REPORT_CONTENT_TYPE.into()),
            priority: None,
            metadata: Some(metadata.to_string()),
            thread_id: None,
            use_case_id: None,
        },
    )?;

    // `reports::create` hands back an EXISTING row for the same persona, title
    // and content on the same day — which is exactly what replaying an outbox
    // entry that already landed produces. Treat it as that replay: keep the
    // first copies, and only raise the approval if the first attempt's is
    // missing.
    let replay = chrono::DateTime::parse_from_rfc3339(&report.created_at)
        .map(|t| t.with_timezone(&chrono::Utc) < asked_at)
        .unwrap_or(false);
    if replay {
        let review_id = match (input.approval.as_ref(), severity.as_deref()) {
            (Some(approval), Some(severity)) => {
                match manual_reviews::find_by_report_id(pool, &report.id)? {
                    Some(existing) => Some(existing.id),
                    None => Some(raise_approval(
                        pool,
                        &persona_id,
                        &report.id,
                        approval,
                        severity,
                    )?),
                }
            }
            _ => None,
        };
        return Ok(ReportPosted {
            report_id: report.id,
            review_id,
            created: None,
        });
    }

    let dir = roots
        .app_data_dir
        .join(reports::HEADLESS_REPORTS_DIR)
        .join(&report.id);
    if !checked.is_empty() {
        let copied = (|| -> Result<Vec<serde_json::Value>, std::io::Error> {
            std::fs::create_dir_all(&dir)?;
            let mut out = Vec::with_capacity(checked.len());
            for (i, a) in checked.iter().enumerate() {
                let dest = dir.join(format!("{:02}-{}", i + 1, a.file_name));
                std::fs::copy(&a.source, &dest)?;
                let mut entry = serde_json::Map::new();
                entry.insert(
                    "path".into(),
                    serde_json::Value::String(dest.to_string_lossy().into_owned()),
                );
                if let Some(c) = &a.caption {
                    entry.insert("caption".into(), serde_json::Value::String(c.clone()));
                }
                out.push(serde_json::Value::Object(entry));
            }
            Ok(out)
        })();
        let entries = match copied {
            Ok(entries) => entries,
            Err(e) => {
                undo_report(pool, &report.id, Some(&dir));
                return Err(DoorError::Internal(format!(
                    "could not copy the attachments into {}: {e}",
                    dir.display()
                )));
            }
        };
        let mut patch = serde_json::Map::new();
        patch.insert("attachments".into(), serde_json::Value::Array(entries));
        if let Err(e) = reports::merge_metadata(pool, &report.id, &patch) {
            undo_report(pool, &report.id, Some(&dir));
            return Err(e.into());
        }
    }

    let review_id = match (input.approval.as_ref(), severity.as_deref()) {
        (Some(approval), Some(severity)) => {
            match raise_approval(pool, &persona_id, &report.id, approval, severity) {
                Ok(id) => Some(id),
                Err(e) => {
                    undo_report(pool, &report.id, Some(&dir));
                    return Err(e);
                }
            }
        }
        _ => None,
    };

    let created = reports::get_by_id(pool, &report.id).ok();
    Ok(ReportPosted {
        report_id: report.id,
        review_id,
        created,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{CreatePersonaInput, ManualReviewStatus};
    use personas_db::init_test_db;

    /// A scratch tree per test: a registered project root holding the files
    /// a master would attach, and an app data dir the copies go to.
    struct Fixture {
        pool: DbPool,
        project_id: String,
        project_root: PathBuf,
        roots: ReportRoots,
        base: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    fn fixture(with_app_master: bool) -> Fixture {
        let pool = init_test_db().unwrap();
        let base = std::env::temp_dir().join(format!("headless-report-{}", uuid::Uuid::new_v4()));
        let project_root = base.join("ascent");
        let app_data_dir = base.join("app-data");
        std::fs::create_dir_all(project_root.join("shots")).unwrap();
        std::fs::create_dir_all(&app_data_dir).unwrap();
        let project_id = crate::db::repos::dev::projects::create_project(
            &pool,
            "ascent",
            &project_root.to_string_lossy(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .id;
        if with_app_master {
            persona(&pool, "App Master ascent", Some(&project_id));
        }
        Fixture {
            pool,
            project_id,
            project_root,
            roots: ReportRoots {
                app_data_dir,
                personas_home: None,
            },
            base,
        }
    }

    fn persona(pool: &DbPool, name: &str, pinned_to: Option<&str>) -> String {
        personas_repo::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "sp".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: pinned_to
                    .map(|p| serde_json::json!({ "devProjectId": p }).to_string()),
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    fn file(f: &Fixture, rel: &str, bytes: &[u8]) -> String {
        let p = f.project_root.join(rel);
        std::fs::write(&p, bytes).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn input(f: &Fixture) -> PostReportInput {
        PostReportInput {
            project_id: f.project_id.clone(),
            persona_id: None,
            title: "Checkout ships".into(),
            content: "## What changed\n\nThe checkout flow.".into(),
            attachments: Vec::new(),
            approval: None,
        }
    }

    fn attachment(path: String, caption: Option<&str>) -> AttachmentInput {
        AttachmentInput {
            path,
            caption: caption.map(str::to_string),
        }
    }

    fn approval(severity: Option<&str>) -> Option<ApprovalInput> {
        Some(ApprovalInput {
            title: "Ship checkout?".into(),
            description: Some("Two screenshots attached".into()),
            severity: severity.map(str::to_string),
        })
    }

    fn metadata(pool: &DbPool, report_id: &str) -> serde_json::Value {
        let row = reports::get_by_id(pool, report_id).unwrap();
        serde_json::from_str(row.metadata.as_deref().unwrap()).unwrap()
    }

    fn report_count(pool: &DbPool) -> i64 {
        reports::get_total_count(pool).unwrap()
    }

    /// The whole contract the Reports / Approvals UI reads: the copies, the
    /// metadata keys, the review pointing back.
    #[test]
    fn a_report_copies_its_attachments_and_raises_the_approval() {
        let f = fixture(true);
        let shot = file(&f, "shots/after.png", b"\x89PNG fake");
        let notes = file(&f, "notes.md", b"# notes");
        let mut body = input(&f);
        body.attachments = vec![
            attachment(shot.clone(), Some("after the fix")),
            attachment(notes, None),
        ];
        body.approval = approval(None);

        let out = post_report(&f.pool, &body, &f.roots).unwrap();
        let review_id = out.review_id.clone().expect("an approval was asked for");
        assert!(out.created.is_some(), "a fresh report is emitted");

        let row = reports::get_by_id(&f.pool, &out.report_id).unwrap();
        assert_eq!(row.content_type, "markdown");
        assert_eq!(row.execution_id, None);
        assert_eq!(row.title.as_deref(), Some("Checkout ships"));

        let dir = f.roots.app_data_dir.join("reports").join(&out.report_id);
        let first = dir.join("01-after.png");
        let second = dir.join("02-notes.md");
        assert_eq!(std::fs::read(&first).unwrap(), b"\x89PNG fake");
        assert_eq!(std::fs::read(&second).unwrap(), b"# notes");
        assert!(
            Path::new(&shot).is_file(),
            "the source is copied, never moved"
        );

        assert_eq!(
            metadata(&f.pool, &out.report_id),
            serde_json::json!({
                "projectId": f.project_id,
                "source": "headless-app-master",
                "attachments": [
                    { "path": first.to_string_lossy(), "caption": "after the fix" },
                    { "path": second.to_string_lossy() },
                ],
                "attachmentsCleaned": false,
            })
        );

        let review = manual_reviews::get_by_id(&f.pool, &review_id).unwrap();
        assert_eq!(review.execution_id, None, "no run raised it");
        assert_eq!(review.severity, "info", "the default severity");
        assert_eq!(review.status, ManualReviewStatus::Pending);
        assert_eq!(review.persona_id, row.persona_id);
        let ctx: serde_json::Value =
            serde_json::from_str(review.context_data.as_deref().unwrap()).unwrap();
        assert_eq!(ctx, serde_json::json!({ "reportId": out.report_id }));

        let wire = serde_json::to_value(&out).unwrap();
        assert_eq!(
            wire,
            serde_json::json!({ "reportId": out.report_id, "reviewId": review_id })
        );
    }

    /// Deciding the approval deletes the copies and says so on the report,
    /// through `update_status`, the chokepoint every resolution path shares.
    #[test]
    fn deciding_the_approval_releases_the_copies() {
        let f = fixture(true);
        let mut body = input(&f);
        body.attachments = vec![attachment(file(&f, "shots/a.png", b"a"), None)];
        body.approval = approval(Some("high"));
        let out = post_report(&f.pool, &body, &f.roots).unwrap();
        let dir = f.roots.app_data_dir.join("reports").join(&out.report_id);
        assert!(dir.is_dir());

        manual_reviews::update_status(
            &f.pool,
            out.review_id.as_deref().unwrap(),
            ManualReviewStatus::Rejected,
            Some("not yet".into()),
        )
        .unwrap();

        assert!(!dir.exists(), "the report dir is gone after the decision");
        let meta = metadata(&f.pool, &out.report_id);
        assert_eq!(meta["attachmentsCleaned"], serde_json::json!(true));
        assert!(meta["cleanedAt"].as_str().is_some_and(|s| !s.is_empty()));
        assert_eq!(
            meta["attachments"].as_array().map(Vec::len),
            Some(1),
            "the record of what was attached stays"
        );
    }

    /// The stale-review sweep resolves without anyone deciding; the copies go
    /// then too, so an unanswered approval does not keep files forever.
    #[test]
    fn an_approval_that_ages_out_releases_the_copies_too() {
        let f = fixture(true);
        let mut body = input(&f);
        body.attachments = vec![attachment(file(&f, "shots/a.png", b"a"), None)];
        body.approval = approval(None);
        let out = post_report(&f.pool, &body, &f.roots).unwrap();
        let dir = f.roots.app_data_dir.join("reports").join(&out.report_id);

        let future = (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339();
        assert_eq!(
            manual_reviews::gc_stale_pending(&f.pool, &future)
                .unwrap()
                .len(),
            1
        );
        assert!(!dir.exists());
        assert_eq!(
            metadata(&f.pool, &out.report_id)["attachmentsCleaned"],
            serde_json::json!(true)
        );
    }

    /// An outbox entry replayed after it already landed finds the same report
    /// and the same approval, and copies nothing twice.
    #[test]
    fn a_replay_returns_the_report_and_approval_that_already_landed() {
        let f = fixture(true);
        let mut body = input(&f);
        body.attachments = vec![attachment(file(&f, "shots/a.png", b"a"), None)];
        body.approval = approval(None);
        let first = post_report(&f.pool, &body, &f.roots).unwrap();
        let again = post_report(&f.pool, &body, &f.roots).unwrap();
        assert_eq!(again.report_id, first.report_id);
        assert_eq!(again.review_id, first.review_id);
        assert!(again.created.is_none(), "a replay emits nothing new");
        assert_eq!(report_count(&f.pool), 1);
        let reviews = manual_reviews::get_all(&f.pool, None).unwrap();
        assert_eq!(reviews.len(), 1, "one approval, not two");
        let dir = f.roots.app_data_dir.join("reports").join(&first.report_id);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn a_report_without_attachments_or_approval_is_just_a_report() {
        let f = fixture(true);
        let out = post_report(&f.pool, &input(&f), &f.roots).unwrap();
        assert_eq!(out.review_id, None);
        assert_eq!(
            serde_json::to_value(&out).unwrap(),
            serde_json::json!({ "reportId": out.report_id }),
            "no reviewId key when no approval was asked for"
        );
        assert!(!f.roots.app_data_dir.join("reports").exists());
        assert_eq!(
            metadata(&f.pool, &out.report_id)["attachments"],
            serde_json::json!([])
        );
    }

    #[test]
    fn a_named_persona_is_used_and_must_exist() {
        let f = fixture(false);
        let mut body = input(&f);
        body.persona_id = Some("no-such-persona".into());
        assert!(matches!(
            post_report(&f.pool, &body, &f.roots),
            Err(DoorError::NotFound(_))
        ));
        let named = persona(&f.pool, "Release scribe", None);
        body.persona_id = Some(named.clone());
        let out = post_report(&f.pool, &body, &f.roots).unwrap();
        assert_eq!(
            reports::get_by_id(&f.pool, &out.report_id)
                .unwrap()
                .persona_id,
            named
        );
    }

    #[test]
    fn no_persona_and_no_app_master_is_a_conflict() {
        let f = fixture(false);
        assert!(matches!(
            post_report(&f.pool, &input(&f), &f.roots),
            Err(DoorError::Conflict(_))
        ));
        assert_eq!(report_count(&f.pool), 0);
    }

    type Mutate = Box<dyn Fn(&mut PostReportInput)>;

    fn attaching(path: String) -> Mutate {
        Box::new(move |b| b.attachments = vec![attachment(path.clone(), None)])
    }

    /// Every refusal named in the contract, each with nothing written.
    #[test]
    fn every_refusal_writes_nothing() {
        let f = fixture(true);
        let elsewhere =
            std::env::temp_dir().join(format!("not-a-root-{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&elsewhere, b"x").unwrap();
        let big = file(
            &f,
            "shots/big.png",
            &vec![0u8; (MAX_ATTACHMENT_BYTES + 1) as usize],
        );
        let exe = file(&f, "tool.exe", b"MZ");
        let ok = file(&f, "shots/ok.png", b"ok");
        let missing = f
            .project_root
            .join("gone.png")
            .to_string_lossy()
            .into_owned();
        let a_dir = f.project_root.join("shots").to_string_lossy().into_owned();

        let bad_request = |e: &DoorError| matches!(e, DoorError::BadRequest(_));
        let not_found = |e: &DoorError| matches!(e, DoorError::NotFound(_));
        let cases: Vec<(&str, Mutate, &dyn Fn(&DoorError) -> bool)> = vec![
            (
                "unknown project",
                Box::new(|b| b.project_id = "nope".into()),
                &not_found,
            ),
            (
                "empty title",
                Box::new(|b| b.title = "  ".into()),
                &bad_request,
            ),
            (
                "empty content",
                Box::new(|b| b.content = String::new()),
                &bad_request,
            ),
            (
                "outside every root",
                attaching(elsewhere.to_string_lossy().into_owned()),
                &bad_request,
            ),
            ("missing file", attaching(missing), &bad_request),
            ("a directory", attaching(a_dir), &bad_request),
            ("over 8 MB", attaching(big), &bad_request),
            ("not an allowed extension", attaching(exe), &bad_request),
            (
                "more than 12",
                Box::new(move |b| {
                    b.attachments = (0..=MAX_ATTACHMENTS)
                        .map(|_| attachment(ok.clone(), None))
                        .collect()
                }),
                &bad_request,
            ),
            (
                "an approval without a title",
                Box::new(|b| {
                    b.approval = Some(ApprovalInput {
                        title: " ".into(),
                        description: None,
                        severity: None,
                    })
                }),
                &bad_request,
            ),
            (
                "an unknown severity",
                Box::new(|b| b.approval = approval(Some("urgent"))),
                &bad_request,
            ),
        ];
        for (name, mutate, expected) in cases {
            let mut body = input(&f);
            mutate(&mut body);
            match post_report(&f.pool, &body, &f.roots) {
                Err(e) => assert!(expected(&e), "{name}: wrong refusal {e:?}"),
                Ok(out) => panic!("{name}: accepted as {}", out.report_id),
            }
        }
        assert_eq!(report_count(&f.pool), 0, "no refusal wrote a report");
        assert!(manual_reviews::get_all(&f.pool, None).unwrap().is_empty());
        assert!(!f.roots.app_data_dir.join("reports").exists());
        let _ = std::fs::remove_file(&elsewhere);
    }

    /// The ~/.personas tree is a readable root beside the project roots.
    #[test]
    fn a_file_under_the_personas_home_is_accepted() {
        let mut f = fixture(true);
        let home = f.base.join("dot-personas");
        std::fs::create_dir_all(home.join("headless-masters")).unwrap();
        let shot = home.join("headless-masters").join("run.png");
        std::fs::write(&shot, b"png").unwrap();
        f.roots.personas_home = Some(home);
        let mut body = input(&f);
        body.attachments = vec![attachment(shot.to_string_lossy().into_owned(), None)];
        let out = post_report(&f.pool, &body, &f.roots).unwrap();
        assert!(f
            .roots
            .app_data_dir
            .join("reports")
            .join(&out.report_id)
            .join("01-run.png")
            .is_file());
    }

    #[test]
    fn the_body_is_camel_case_and_optional_keys_may_be_absent() {
        let b: PostReportInput = serde_json::from_str(
            r#"{"projectId":"p","title":"T","content":"C",
                "attachments":[{"path":"x.png"}],"approval":{"title":"A"}}"#,
        )
        .unwrap();
        assert!(b.persona_id.is_none());
        assert_eq!(b.attachments[0].caption, None);
        assert_eq!(b.approval.as_ref().unwrap().severity, None);
        let b: PostReportInput =
            serde_json::from_str(r#"{"projectId":"p","title":"T","content":"C"}"#).unwrap();
        assert!(b.attachments.is_empty() && b.approval.is_none());
    }
}
