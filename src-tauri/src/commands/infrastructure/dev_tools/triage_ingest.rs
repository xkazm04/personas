//! The ONE gated door a CLI triage-verdicts run comes back through.
//!
//! A skill session judges pending backlog ideas outside the app and writes
//! exactly one artifact —
//! `<repo>/.personas/triage-verdicts/runs/<id>/result.json` — and this command
//! is the only path from that file into the app. The session NEVER touches the
//! database, and this door NEVER touches `dev_ideas` either: it persists the
//! verdicts as a pending `backlog_apply_triage` approval (the exact row
//! `dev_tools_athena_triage_batch` writes), so the existing human-consent
//! doors — the Approvals card and the Backlog verdict card — apply them.
//!
//! Shape deliberately mirrors `ship_ingest.rs`: path-confined to the project's
//! own runs dir, size-capped, idempotent through an `ingested.json` marker.
//! Like the ship door it is version-checked and ALL-OR-NOTHING: any bad row
//! refuses the whole run with zero writes, because half a verdict batch
//! persisted as a proposal is a lie about what the run decided. Notably, the
//! verdict token here is STRICTER than `parse_items`' coerce-to-reject
//! leniency — an ambiguous token in a file refuses the run rather than quietly
//! becoming a rejection, because nobody is watching a file the way they watch
//! a live Athena turn.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::State;
use ts_rs::TS;

use crate::commands::companion::backlog_triage::insert_triage_approval;
use crate::companion::proactive::backlog_triage::{BacklogVerdict, MAX_BATCH_IDEAS, REASON_MAX};
use crate::db::models::DevIdea;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The only `schema_version` this door accepts. Bump ONLY together with the
/// producing skill's contract; an unknown version is refused rather than
/// best-effort parsed.
pub const TRIAGE_VERDICTS_RESULT_VERSION: u32 = 1;

/// Handshake directory and the run tree underneath it. One dir per run;
/// `result.json` inside; `ingested.json` written beside it once consumed.
const RUNS_REL: [&str; 3] = [".personas", "triage-verdicts", "runs"];

const MAX_RESULT_BYTES: u64 = 1_048_576;
/// Longest title echoed into the approval row. Generous — a `dev_ideas` title
/// is a headline, not a description.
const TITLE_MAX: usize = 300;
/// Longest `run_created_at` echoed into the summary. An ISO8601 timestamp is
/// ~25 chars; anything near this cap is not a timestamp.
const CREATED_AT_MAX: usize = 64;
/// Longest batch summary carried into the approval rationale. Mirrors the 200
/// the live Athena batch truncates its summary to.
const SUMMARY_MAX: usize = 200;

// ── result.json shape ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TriageRunResult {
    /// Absent is NOT tolerated — see [`TRIAGE_VERDICTS_RESULT_VERSION`].
    #[serde(default)]
    schema_version: Option<u32>,
    /// One-line batch rationale — becomes the approval row's rationale.
    #[serde(default)]
    summary: Option<String>,
    /// When the verdicts were computed. Optional; when present it is echoed
    /// into the summary so the operator confirming the approval sees the run's
    /// age — consent freshness starts at ingest, not at the run.
    #[serde(default)]
    run_created_at: Option<String>,
    #[serde(default)]
    items: Vec<TriageRunItem>,
}

/// Deliberately the approval-params item shape (`BacklogVerdict`'s camelCase
/// serde), so what the file says and what the approval row holds cannot drift.
#[derive(Debug, Deserialize)]
struct TriageRunItem {
    #[serde(rename = "ideaId", alias = "idea_id")]
    idea_id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    verdict: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

// ── what the door hands back ────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TriageVerdictsIngestSummary {
    pub run_dir: String,
    /// The pending `companion_approval` row holding these verdicts — the same
    /// row shape `dev_tools_athena_triage_batch` produces, confirmable through
    /// either existing door.
    pub approval_id: String,
    pub summary: String,
    pub items: Vec<BacklogVerdict>,
    pub accept_count: u32,
    pub reject_count: u32,
}

// ── validation (pure — no DB, no filesystem) ────────────────────────────────

#[derive(Debug)]
struct ValidatedTriage {
    items: Vec<BacklogVerdict>,
    summary: String,
    accept_count: u32,
    reject_count: u32,
}

/// Parse + fully validate a result against the ideas it names.
///
/// `ideas` is the caller's by-id load of every `ideaId` the file mentions; an
/// id absent from the map is refused as not found. Returns `Err` on ANY bad
/// row, leaving the caller nothing to partially persist — ship-milestone
/// strictness, and stricter than the live batch path on the verdict token:
/// only the exact lowercase `accept` / `reject` pass.
fn validate_triage_result(
    raw: &str,
    project_id: &str,
    ideas: &HashMap<String, DevIdea>,
) -> Result<ValidatedTriage, AppError> {
    let result: TriageRunResult = serde_json::from_str(raw)
        .map_err(|e| AppError::Validation(format!("result.json is not valid: {e}")))?;

    match result.schema_version {
        Some(v) if v == TRIAGE_VERDICTS_RESULT_VERSION => {}
        Some(v) => {
            return Err(AppError::Validation(format!(
                "result.json declares schema_version {v}; this app understands {TRIAGE_VERDICTS_RESULT_VERSION} — refusing to ingest"
            )))
        }
        None => {
            return Err(AppError::Validation(format!(
                "result.json has no schema_version (expected {TRIAGE_VERDICTS_RESULT_VERSION}) — refusing to ingest"
            )))
        }
    }

    if result.items.is_empty() {
        return Err(AppError::Validation(
            "result.json carries no items — nothing to ingest".into(),
        ));
    }
    if result.items.len() > MAX_BATCH_IDEAS {
        return Err(AppError::Validation(format!(
            "result.json carries {} items (cap {MAX_BATCH_IDEAS} — the same batch cap the live triage enforces)",
            result.items.len()
        )));
    }

    let mut out: Vec<BacklogVerdict> = Vec::with_capacity(result.items.len());
    let mut seen: Vec<&str> = Vec::new();
    let mut accept_count = 0u32;
    let mut reject_count = 0u32;

    for (i, it) in result.items.iter().enumerate() {
        let id = it.idea_id.trim();
        if id.is_empty() {
            return Err(AppError::Validation(format!("items[{i}]: ideaId is empty")));
        }
        if seen.contains(&id) {
            return Err(AppError::Validation(format!(
                "items[{i}]: idea {id} appears twice — refusing the run"
            )));
        }
        seen.push(id);

        // Verdict token — EXACT. `parse_items`' coerce-to-reject leniency is
        // for a payload this app wrote itself; a file token we do not
        // recognize means the producer and this door disagree on the
        // contract, and that refuses the run.
        let verdict = match it.verdict.as_deref().map(str::trim) {
            Some("accept") => "accept",
            Some("reject") => "reject",
            Some(other) => {
                return Err(AppError::Validation(format!(
                    "items[{i}] ({id}): verdict must be exactly `accept` or `reject`, got `{other}` — refusing the run"
                )))
            }
            None => {
                return Err(AppError::Validation(format!(
                    "items[{i}] ({id}): verdict is missing — refusing the run"
                )))
            }
        };

        let reason = it.reason.as_deref().map(str::trim).unwrap_or_default();
        if reason.is_empty() {
            return Err(AppError::Validation(format!(
                "items[{i}] ({id}): reason is empty — a verdict without a why is not reviewable"
            )));
        }
        if reason.chars().count() > REASON_MAX {
            return Err(AppError::Validation(format!(
                "items[{i}] ({id}): reason is longer than {REASON_MAX} characters"
            )));
        }

        // The idea must exist, still be undecided, and belong to the
        // ingesting project — a verdict on someone else's backlog, or on a
        // row a human already decided, refuses the whole run.
        let Some(idea) = ideas.get(id) else {
            return Err(AppError::Validation(format!(
                "items[{i}]: idea {id} not found — refusing the run"
            )));
        };
        if idea.status != "pending" {
            return Err(AppError::Validation(format!(
                "items[{i}]: idea {id} is already `{}` — a file verdict must never overwrite a decision",
                idea.status
            )));
        }
        if idea.project_id.as_deref() != Some(project_id) {
            return Err(AppError::Validation(format!(
                "items[{i}]: idea {id} belongs to project {}, not the ingesting project",
                idea.project_id.as_deref().unwrap_or("(none)")
            )));
        }

        let title = match it.title.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(t) if t.chars().count() > TITLE_MAX => {
                return Err(AppError::Validation(format!(
                    "items[{i}] ({id}): title is longer than {TITLE_MAX} characters"
                )))
            }
            // Echo the idea's own title when the file omits it, so the
            // approval row stays legible on its own (it lives in a DIFFERENT
            // pool from dev_ideas).
            Some(t) => t.to_string(),
            None => idea.title.clone(),
        };

        if verdict == "accept" {
            accept_count += 1;
        } else {
            reject_count += 1;
        }
        out.push(BacklogVerdict {
            idea_id: id.to_string(),
            title,
            verdict: verdict.to_string(),
            reason: reason.to_string(),
        });
    }

    let mut summary = match result.summary.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => s.chars().take(SUMMARY_MAX).collect::<String>(),
        None => format!(
            "{accept_count} accepted, {reject_count} rejected of {} verdicts (ingested from result.json)",
            out.len()
        ),
    };
    // Consent freshness starts at ingest — surface the run's own age so the
    // operator confirming the approval knows how stale the verdicts are.
    if let Some(ts) = result
        .run_created_at
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.chars().count() <= CREATED_AT_MAX)
    {
        summary.push_str(&format!(" (verdicts computed at {ts})"));
    }

    Ok(ValidatedTriage {
        items: out,
        summary,
        accept_count,
        reject_count,
    })
}

// ── path confinement (mirrors ship_ingest.rs) ───────────────────────────────

fn runs_root(root: &Path) -> PathBuf {
    RUNS_REL
        .iter()
        .fold(root.to_path_buf(), |p, seg| p.join(seg))
}

/// Newest run dir with a `result.json` and no `ingested.json`.
fn find_ingestable_run(root: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(runs_root(root))
        .ok()?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() || !p.join("result.json").is_file() || p.join("ingested.json").is_file()
            {
                return None;
            }
            let t = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((t, p))
        })
        .collect();
    candidates.sort_by_key(|b| std::cmp::Reverse(b.0));
    candidates.into_iter().map(|(_, p)| p).next()
}

/// Resolve the run dir, refusing anything outside the project's own runs tree.
/// An arbitrary path would let a crafted call read foreign files.
fn resolve_run_dir(root: &Path, run_dir: Option<String>) -> Result<PathBuf, AppError> {
    let Some(d) = run_dir else {
        return find_ingestable_run(root).ok_or_else(|| {
            AppError::Validation(
                "No un-ingested run found under .personas/triage-verdicts/runs/ — run the triage skill first"
                    .into(),
            )
        });
    };
    let canon = PathBuf::from(&d)
        .canonicalize()
        .map_err(|e| AppError::Validation(format!("Run dir not readable: {e}")))?;
    let canon_root = runs_root(root).canonicalize().map_err(|_| {
        AppError::Validation("No .personas/triage-verdicts/runs directory in this repo yet".into())
    })?;
    if !canon.starts_with(&canon_root) {
        return Err(AppError::Validation(
            "Run dir must be inside the project's .personas/triage-verdicts/runs/".into(),
        ));
    }
    Ok(canon)
}

// ── the door ────────────────────────────────────────────────────────────────

/// Ingest a finished triage-verdicts run as a pending `backlog_apply_triage`
/// approval for the project it reports on.
///
/// `run_dir` optional — defaults to the newest un-ingested run. Guards, in
/// order: path confinement · 1 MiB size cap · `schema_version` match · full
/// validation before any write (all-or-nothing) · idempotency marker. The one
/// write goes through [`insert_triage_approval`] — the exact function the live
/// Athena batch uses — so the payload, id shape, kind and session are
/// byte-identical and both existing confirm doors just work. `dev_ideas` is
/// never touched here.
#[tauri::command]
pub async fn dev_tools_triage_verdicts_ingest(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    run_dir: Option<String>,
) -> Result<TriageVerdictsIngestSummary, AppError> {
    require_auth(&state).await?;
    ingest_triage_verdicts(&state.db, &state.user_db, &project_id, run_dir)
}

/// Body of [`dev_tools_triage_verdicts_ingest`], minus the IPC envelope.
/// Needs BOTH pools: ideas live in `db`, approvals in `user_db` (the
/// pool-split invariant `commands::companion::backlog_triage` documents).
pub(crate) fn ingest_triage_verdicts(
    db: &crate::db::DbPool,
    user_db: &crate::db::UserDbPool,
    project_id: &str,
    run_dir: Option<String>,
) -> Result<TriageVerdictsIngestSummary, AppError> {
    let project = repo::get_project_by_id(db, project_id)?;
    let root = PathBuf::from(&project.root_path);

    let dir = resolve_run_dir(&root, run_dir)?;
    if dir.join("ingested.json").is_file() {
        return Err(AppError::Validation(format!(
            "Run {} was already ingested",
            dir.display()
        )));
    }

    let result_path = dir.join("result.json");
    let meta = std::fs::metadata(&result_path)
        .map_err(|e| AppError::Validation(format!("result.json not readable: {e}")))?;
    if meta.len() > MAX_RESULT_BYTES {
        return Err(AppError::Validation(format!(
            "result.json is {} bytes (cap {MAX_RESULT_BYTES}) — refusing to ingest",
            meta.len()
        )));
    }
    let raw = std::fs::read_to_string(&result_path)
        .map_err(|e| AppError::Validation(format!("result.json not readable: {e}")))?;

    // Load every idea the file names (a cheap pre-parse; the validator
    // re-parses and is the authority on every rule). Ids that fail to load
    // stay absent from the map and the validator refuses them by name.
    let pre: TriageRunResult = serde_json::from_str(&raw)
        .map_err(|e| AppError::Validation(format!("result.json is not valid: {e}")))?;
    let mut ideas: HashMap<String, DevIdea> = HashMap::new();
    for it in &pre.items {
        let id = it.idea_id.trim();
        if id.is_empty() || ideas.contains_key(id) {
            continue;
        }
        if let Ok(idea) = repo::get_idea_by_id(db, id) {
            ideas.insert(idea.id.clone(), idea);
        }
    }

    // Validate EVERYTHING before writing anything — half a verdict batch
    // persisted as a proposal misdescribes what the run decided.
    let run = validate_triage_result(&raw, project_id, &ideas)?;

    // The ONE write: the same pending-approval row the live Athena batch
    // persists. No dev_ideas writes — consent stays with the existing doors.
    let approval_id = insert_triage_approval(user_db, &run.summary, &run.items)?;

    // Idempotency marker. Loud, not fatal: the approval already landed, and a
    // re-ingest of the same file would only create a second pending proposal
    // for a human to decline — annoying, never destructive.
    let marker = json!({
        "ingested_at": chrono::Utc::now().to_rfc3339(),
        "schema_version": TRIAGE_VERDICTS_RESULT_VERSION,
        "approval_id": approval_id,
    });
    if let Err(e) = std::fs::write(
        dir.join("ingested.json"),
        serde_json::to_vec_pretty(&marker).unwrap_or_default(),
    ) {
        tracing::warn!(run = %dir.display(), error = %e, "could not write triage-verdicts ingest marker");
    }

    tracing::info!(
        project = %project_id,
        approval = %approval_id,
        accepts = run.accept_count,
        rejects = run.reject_count,
        "ingested triage-verdicts run as pending approval"
    );
    Ok(TriageVerdictsIngestSummary {
        run_dir: dir.to_string_lossy().into_owned(),
        approval_id,
        summary: run.summary,
        items: run.items,
        accept_count: run.accept_count,
        reject_count: run.reject_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT: &str = "proj-1";

    fn mk_idea(id: &str, title: &str, status: &str, project_id: Option<&str>) -> DevIdea {
        DevIdea {
            id: id.into(),
            project_id: project_id.map(Into::into),
            context_id: None,
            scan_type: "idea_scanner".into(),
            category: "technical".into(),
            title: title.into(),
            description: Some("do the thing".into()),
            reasoning: None,
            status: status.into(),
            effort: Some(3),
            impact: Some(8),
            risk: Some(2),
            priority: None,
            provider: None,
            model: None,
            rejection_reason: None,
            origin: None,
            use_case_id: None,
            evidence: None,
            dedup_key: None,
            verify_state: None,
            verify_checked_at: None,
            verify_evidence: None,
            created_at: "2026-08-01T00:00:00Z".into(),
            updated_at: "2026-08-01T00:00:00Z".into(),
        }
    }

    fn ideas() -> HashMap<String, DevIdea> {
        let mut m = HashMap::new();
        m.insert(
            "a".to_string(),
            mk_idea("a", "Add retry", "pending", Some(PROJECT)),
        );
        m.insert(
            "b".to_string(),
            mk_idea("b", "Cache the probe", "pending", Some(PROJECT)),
        );
        m
    }

    #[test]
    fn accepts_a_well_formed_result_and_echoes_the_run_age() {
        let raw = r#"{
            "schema_version": 1,
            "summary": "1 of 2 worth scheduling",
            "run_created_at": "2026-08-09T22:00:00Z",
            "items": [
              { "ideaId": "a", "title": "Add retry", "verdict": "accept", "reason": "clear win, bounded scope" },
              { "ideaId": "b", "verdict": "reject", "reason": "no acceptance criteria" }
            ]
        }"#;
        let run = validate_triage_result(raw, PROJECT, &ideas()).unwrap();
        assert_eq!(run.items.len(), 2);
        assert_eq!(run.accept_count, 1);
        assert_eq!(run.reject_count, 1);
        // Omitted title falls back to the idea's own, so the approval row
        // stays legible without joining back to dev_ideas.
        assert_eq!(run.items[1].title, "Cache the probe");
        assert!(
            run.summary.contains("1 of 2 worth scheduling"),
            "{}",
            run.summary
        );
        assert!(
            run.summary
                .contains("verdicts computed at 2026-08-09T22:00:00Z"),
            "{}",
            run.summary
        );
    }

    #[test]
    fn refuses_a_result_with_no_schema_version() {
        let raw = r#"{ "items": [ { "ideaId": "a", "verdict": "accept", "reason": "x" } ] }"#;
        let err = validate_triage_result(raw, PROJECT, &ideas())
            .unwrap_err()
            .to_string();
        assert!(err.contains("no schema_version"), "{err}");
    }

    #[test]
    fn refuses_an_unknown_schema_version() {
        let raw = r#"{ "schema_version": 99, "items": [ { "ideaId": "a", "verdict": "accept", "reason": "x" } ] }"#;
        let err = validate_triage_result(raw, PROJECT, &ideas())
            .unwrap_err()
            .to_string();
        assert!(err.contains("99"), "{err}");
        assert!(err.contains("refusing to ingest"), "{err}");
    }

    #[test]
    fn refuses_any_verdict_token_that_is_not_exactly_accept_or_reject() {
        // NOT parse_items' coerce-to-reject: an ambiguous file token refuses
        // the whole run, including a row that would otherwise be fine.
        for bad in ["Accept", "maybe", "skip", ""] {
            let raw = format!(
                r#"{{ "schema_version": 1, "items": [
                     {{ "ideaId": "a", "verdict": "accept", "reason": "fine" }},
                     {{ "ideaId": "b", "verdict": "{bad}", "reason": "hmm" }} ] }}"#
            );
            assert!(
                validate_triage_result(&raw, PROJECT, &ideas()).is_err(),
                "token `{bad}` must refuse the run"
            );
        }
    }

    #[test]
    fn refuses_a_duplicate_idea_id() {
        let raw = r#"{ "schema_version": 1, "items": [
            { "ideaId": "a", "verdict": "accept", "reason": "x" },
            { "ideaId": "a", "verdict": "reject", "reason": "y" } ] }"#;
        let err = validate_triage_result(raw, PROJECT, &ideas())
            .unwrap_err()
            .to_string();
        assert!(err.contains("appears twice"), "{err}");
    }

    #[test]
    fn refuses_a_batch_over_the_cap() {
        let rows = (0..MAX_BATCH_IDEAS + 1)
            .map(|i| format!(r#"{{ "ideaId": "id-{i}", "verdict": "reject", "reason": "r" }}"#))
            .collect::<Vec<_>>()
            .join(",");
        let raw = format!(r#"{{ "schema_version": 1, "items": [{rows}] }}"#);
        let err = validate_triage_result(&raw, PROJECT, &ideas())
            .unwrap_err()
            .to_string();
        assert!(err.contains("cap"), "{err}");
    }

    #[test]
    fn refuses_an_empty_batch() {
        let raw = r#"{ "schema_version": 1, "items": [] }"#;
        assert!(validate_triage_result(raw, PROJECT, &ideas()).is_err());
    }

    #[test]
    fn refuses_a_non_pending_idea_naming_its_actual_status() {
        let mut m = ideas();
        m.insert(
            "c".to_string(),
            mk_idea("c", "Old one", "accepted", Some(PROJECT)),
        );
        let raw = r#"{ "schema_version": 1, "items": [
            { "ideaId": "c", "verdict": "reject", "reason": "stale" } ] }"#;
        let err = validate_triage_result(raw, PROJECT, &m)
            .unwrap_err()
            .to_string();
        assert!(err.contains("c"), "{err}");
        assert!(err.contains("accepted"), "{err}");
    }

    #[test]
    fn refuses_an_idea_from_another_project() {
        let mut m = ideas();
        m.insert(
            "d".to_string(),
            mk_idea("d", "Foreign", "pending", Some("proj-2")),
        );
        let raw = r#"{ "schema_version": 1, "items": [
            { "ideaId": "d", "verdict": "accept", "reason": "good" } ] }"#;
        let err = validate_triage_result(raw, PROJECT, &m)
            .unwrap_err()
            .to_string();
        assert!(err.contains("proj-2"), "{err}");
    }

    #[test]
    fn refuses_an_unknown_idea() {
        let raw = r#"{ "schema_version": 1, "items": [
            { "ideaId": "ghost", "verdict": "accept", "reason": "x" } ] }"#;
        let err = validate_triage_result(raw, PROJECT, &ideas())
            .unwrap_err()
            .to_string();
        assert!(err.contains("ghost"), "{err}");
        assert!(err.contains("not found"), "{err}");
    }

    #[test]
    fn refuses_an_oversize_reason_and_an_empty_one() {
        let long = "x".repeat(REASON_MAX + 1);
        let raw = format!(
            r#"{{ "schema_version": 1, "items": [ {{ "ideaId": "a", "verdict": "accept", "reason": "{long}" }} ] }}"#
        );
        let err = validate_triage_result(&raw, PROJECT, &ideas())
            .unwrap_err()
            .to_string();
        assert!(err.contains("longer than"), "{err}");

        let raw = r#"{ "schema_version": 1, "items": [ { "ideaId": "a", "verdict": "accept", "reason": "  " } ] }"#;
        assert!(validate_triage_result(raw, PROJECT, &ideas()).is_err());
    }

    #[test]
    fn path_confinement_rejects_a_run_dir_outside_the_runs_tree() {
        let tmp = std::env::temp_dir().join(format!("triage-ingest-{}", std::process::id()));
        let runs = runs_root(&tmp);
        let inside = runs.join("2026-08-10-1200");
        std::fs::create_dir_all(&inside).unwrap();
        let outside = tmp.join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();

        assert!(resolve_run_dir(&tmp, Some(inside.to_string_lossy().into_owned())).is_ok());
        let err = resolve_run_dir(&tmp, Some(outside.to_string_lossy().into_owned()))
            .unwrap_err()
            .to_string();
        assert!(err.contains("must be inside"), "{err}");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
