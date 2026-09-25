//! Council read commands and **the one verdict door**.
//!
//! [`dev_tools_council_decide`] is the only writer of `dev_council_decisions`
//! anywhere in this process. Everything else here reads.
//!
//! The golden path this conforms to is
//! [`human-review-queue`](../../../../../docs/concepts/golden-paths/human-review-queue.md),
//! and its census rule `verdict-write-outside-door` anchors on `src/**` TS:
//! the door it names is `src/lib/decisions/rowWrites.ts`, a FRONTEND
//! compare-and-swap wrapper that reads the row back and refuses when what the
//! decider saw has moved. That door cannot be the whole story for a verdict
//! whose inputs are recomputed in Rust, so the compare-and-swap is enforced
//! HERE as well, against a digest the store itself computes - a frontend-only
//! check would be defeated by the management API, the MCP surface, or a second
//! window. The frontend wrapper stays the right place for the call; this is
//! the place that cannot be bypassed.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, State};

use super::council_ingest::emit_council_changed;
use crate::db::models::{
    CouncilDecision, CouncilMedia, CouncilOverlay, CouncilRunDetail, CouncilSubjectState,
    DevUseCase,
};
use crate::db::repos::dev::council as council_repo;
use crate::db::repos::dev::scenarios as scenario_repo;
use crate::db::repos::dev::use_cases as use_case_repo;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use personas_core::models::{COUNCIL_DECISIONS, USE_CASE_TIERS};

/// Longest rejection reason. A reason is read by whoever runs the next round,
/// so it is prose, not an essay.
const MAX_REASON: usize = 2000;

/// Where the council's own registry line and exported state live, relative to
/// the project root.
const COUNCILS_JSONL: [&str; 2] = [".ai", "councils.jsonl"];
const STATE_JSON: [&str; 3] = [".personas", "council", "state.json"];

/// Extensions the evidence canvas can render, and the mime each is served as.
/// An ALLOWLIST: the sniffing is by extension, so anything not named here is
/// refused rather than guessed at.
const MEDIA_TYPES: [(&str, &str); 7] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
];

/// Largest evidence file handed to the renderer. The bytes cross IPC as a JSON
/// array, so this cap is a renderer-memory decision, not a disk one.
const MAX_MEDIA_BYTES: u64 = 25 * 1024 * 1024;

#[tauri::command]
pub async fn dev_tools_council_list_subjects(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<Vec<CouncilSubjectState>, AppError> {
    require_auth(&state).await?;
    council_repo::list_subject_states(&state.db, project_id.as_deref())
}

#[tauri::command]
pub async fn dev_tools_council_get_run(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<CouncilRunDetail, AppError> {
    require_auth(&state).await?;
    council_repo::get_run_detail(&state.db, &run_id)
}

/// Council signal per registry subject, across every project in the store.
///
/// The galaxy's overlay. A registry subject no council has landed on has no
/// row at all - the page must be able to say "never councilled", which a zero
/// row cannot.
#[tauri::command]
pub async fn dev_tools_council_overlay(
    state: State<'_, Arc<AppState>>,
) -> Result<CouncilOverlay, AppError> {
    require_auth(&state).await?;
    council_repo::council_overlay(&state.db)
}

/// Read ONE evidence file from inside a run's own directory.
///
/// The same door discipline as [`super::council_ingest`], for the same reason:
/// `run_id` and `rel_path` both arrive from the renderer, and the run dir is an
/// arbitrary absolute path in a managed repo that Tauri's asset protocol
/// deliberately cannot reach. Five refusals, and every one of them is a way a
/// path can leave the directory it was supposed to stay in:
///
/// 1. `rel_path` must be relative. An absolute path ignores the base entirely.
/// 2. Both sides are canonicalized before they are compared, so `..`, a
///    symlink out, and Windows' short names all resolve to the real location
///    BEFORE the prefix test - a textual check would pass all three.
/// 3. The resolved path must still be inside the run dir.
/// 4. The extension must be one this surface can actually render. An allowlist,
///    not a denylist: a new dangerous extension must be added to be refused,
///    and that is backwards.
/// 5. The file must be under [`MAX_MEDIA_BYTES`]. The bytes cross IPC as JSON
///    numbers, so an unbounded read is an unbounded renderer allocation.
#[tauri::command]
pub async fn dev_tools_council_read_media(
    state: State<'_, Arc<AppState>>,
    run_id: String,
    rel_path: String,
) -> Result<CouncilMedia, AppError> {
    require_auth(&state).await?;
    let run = council_repo::get_run(&state.db, &run_id)?
        .ok_or_else(|| AppError::NotFound(format!("Council run {run_id} not found")))?;
    // The handle is bound and awaited: a panic inside the read surfaces as
    // this command's error rather than as a request that never answers.
    let read =
        tokio::task::spawn_blocking(move || read_run_media(Path::new(&run.run_dir), &rel_path))
            .await;
    read.map_err(|e| AppError::Internal(format!("council media join error: {e}")))?
}

/// Body of [`dev_tools_council_read_media`], minus the IPC envelope - so the
/// five refusals can be driven without a Tauri runtime.
pub(crate) fn read_run_media(run_dir: &Path, rel_path: &str) -> Result<CouncilMedia, AppError> {
    personas_core::validation::require_non_empty("Evidence path", rel_path)?;
    let rel = PathBuf::from(rel_path);
    if rel.is_absolute() {
        return Err(AppError::Validation(
            "Evidence is addressed by a path relative to its own run directory".into(),
        ));
    }
    let canon_root = run_dir.canonicalize().map_err(|e| {
        AppError::NotFound(format!(
            "This run's directory is no longer readable ({e}) - re-ingest the run"
        ))
    })?;
    let canon = canon_root
        .join(&rel)
        .canonicalize()
        .map_err(|e| AppError::NotFound(format!("No such evidence file: {e}")))?;
    if !canon.starts_with(&canon_root) {
        return Err(AppError::Forbidden(
            "Evidence must live inside the run's own directory".into(),
        ));
    }

    let ext = canon
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    let Some((_, mime)) = MEDIA_TYPES.iter().find(|(e, _)| *e == ext) else {
        return Err(AppError::Validation(format!(
            "`.{ext}` is not evidence this surface can show (png, jpg, jpeg, webp, gif, mp4, webm)"
        )));
    };

    let meta = std::fs::metadata(&canon)
        .map_err(|e| AppError::NotFound(format!("Evidence file not readable: {e}")))?;
    if meta.len() > MAX_MEDIA_BYTES {
        return Err(AppError::Validation(format!(
            "That evidence file is {} bytes (cap {MAX_MEDIA_BYTES}) - too large to hand to the renderer",
            meta.len()
        )));
    }
    let bytes = std::fs::read(&canon)
        .map_err(|e| AppError::Internal(format!("Evidence file could not be read: {e}")))?;
    Ok(CouncilMedia {
        mime: (*mime).to_string(),
        bytes,
    })
}

/// Promote or demote a feature. Only a `major` feature reaches the human gate;
/// a `standard` one stops at `machine_pass`.
#[tauri::command]
pub async fn dev_tools_set_use_case_tier(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    use_case_id: String,
    tier: String,
) -> Result<DevUseCase, AppError> {
    require_auth(&state).await?;
    if !USE_CASE_TIERS.contains(&tier.as_str()) {
        return Err(AppError::Validation(format!(
            "Unknown tier `{tier}` (expected major or standard)"
        )));
    }
    let updated = use_case_repo::set_use_case_tier(&state.db, &use_case_id, &tier)?;
    // The tier is an INPUT to the derived state (`machine_pass` is ready plus
    // standard), so a promotion moves the ledger even though no council ran.
    emit_council_changed(&app, &updated.project_id);
    Ok(updated)
}

/// Record a human's verdict on a council run.
///
/// Five refusals, in order, and each one exists because of a way this can go
/// wrong that nothing downstream could detect:
///
/// 1. The run must exist and belong to the subject named.
/// 2. `saw_digest` must equal the run's current digest AND the run must be the
///    subject's latest - the compare-and-swap. A decision taken on a page that
///    has since moved is a decision about something else.
/// 3. The run's outcome must be `ready`. A human may not approve a run the
///    council itself refused to escort.
/// 4. A `use_case` subject must be tier `major`. A standard feature does not
///    reach this gate at all, and letting one through here would make the tier
///    a suggestion. An `architecture` subject has no tier and always qualifies.
/// 5. A `rejected` decision must carry a non-blank reason. The reason is the
///    entire value of a rejection to whoever runs the next round.
///
/// After the write, two best-effort exports: the registry line and the
/// project's `state.json`. Both are `tracing::warn!` on failure and neither
/// rolls the decision back - the decision is the durable fact, and a file the
/// app could not write is a file the next decision rewrites anyway.
#[tauri::command]
pub async fn dev_tools_council_decide(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    subject_id: String,
    run_id: String,
    decision: String,
    reason: Option<String>,
    saw_digest: String,
) -> Result<CouncilDecision, AppError> {
    require_auth(&state).await?;
    let recorded = decide_council(
        &state.db,
        &subject_id,
        &run_id,
        &decision,
        reason.as_deref(),
        &saw_digest,
    )?;
    if let Some(subject) = council_repo::get_subject(&state.db, &subject_id)? {
        emit_council_changed(&app, &subject.project_id);
    }
    Ok(recorded)
}

/// Body of [`dev_tools_council_decide`], minus the IPC envelope and the emit.
///
/// Separate so the five refusals can be driven in a test without a Tauri
/// runtime - a rule that only exists inside a `#[tauri::command]` is a rule
/// nothing can exercise, and these five are the whole gate.
pub(crate) fn decide_council(
    pool: &personas_db::DbPool,
    subject_id: &str,
    run_id: &str,
    decision: &str,
    reason: Option<&str>,
    saw_digest: &str,
) -> Result<CouncilDecision, AppError> {
    if !COUNCIL_DECISIONS.contains(&decision) {
        return Err(AppError::Validation(format!(
            "Unknown decision `{decision}` (expected approved or rejected)"
        )));
    }
    // A blank reason and an absent one are the same thing here, and both are
    // refused on a rejection - so the emptiness test lives in the shared
    // vocabulary and this code only decides whether a reason was required.
    let reason: Option<String> = reason
        .map(str::trim)
        .filter(|r| personas_core::validation::require_non_empty("reason", r).is_ok())
        .map(str::to_string);
    if let Some(r) = reason.as_deref() {
        if r.chars().count() > MAX_REASON {
            return Err(AppError::Validation(format!(
                "A reason longer than {MAX_REASON} characters is a document, not a reason"
            )));
        }
    }
    if decision == "rejected" && reason.is_none() {
        return Err(AppError::Validation(
            "A rejection needs a reason: it is the only thing the next round has to work from"
                .into(),
        ));
    }

    let detail = council_repo::get_run_detail(pool, run_id)?;
    if detail.run.subject_id != subject_id {
        return Err(AppError::Validation(format!(
            "Run {run_id} does not belong to subject {subject_id}"
        )));
    }
    // The compare-and-swap. Both halves are needed: the digest catches a run
    // whose verdicts were re-ingested, and `is_latest` catches a NEWER run
    // landing beside the one the decider has open.
    if !detail.is_latest || detail.saw_digest != saw_digest {
        return Err(AppError::Validation(
            "The council moved since you looked - reload the run before deciding".into(),
        ));
    }
    if detail.run.outcome != "ready" {
        return Err(AppError::Validation(format!(
            "This run's outcome is `{}`; only a run the council escorted (`ready`) \
             reaches your decision",
            detail.run.outcome
        )));
    }
    if detail.subject.kind == "use_case" {
        let tier = detail
            .subject
            .use_case_id
            .as_deref()
            .and_then(|id| use_case_repo::get_use_case(pool, id).ok())
            .map(|u| u.tier)
            .unwrap_or_else(|| "standard".to_string());
        if tier != "major" {
            return Err(AppError::Validation(
                "Only a major feature reaches the council's gate - promote it first".into(),
            ));
        }
    }

    let recorded = council_repo::insert_decision(
        pool,
        subject_id,
        run_id,
        decision,
        reason.as_deref(),
        saw_digest,
    )?;

    // --- the two best-effort exports ---------------------------------------
    // Neither may roll the decision back: the decision is the durable fact,
    // and a file the app could not write is one the next decision rewrites.
    if let Ok(project) = repo::get_project_by_id(pool, &detail.subject.project_id) {
        let root = PathBuf::from(&project.root_path);
        append_registry_line(&root, &detail, &recorded);
        export_state_json(pool, &root, &detail.subject.project_id);
    }
    Ok(recorded)
}

/// Append one line to `<repo>/.ai/councils.jsonl`.
///
/// **Techniques cross the registry boundary only where `proof == "execution"`.**
/// A technique a member merely INSPECTED or was told about is an opinion, and
/// the registry's own doctrine is that a technique with no executed proof
/// behind it is a wiki page. Filtering here rather than at the collector is
/// deliberate: the collector cannot see the proof field, so a claim that
/// leaves this function is a claim the registry will believe.
fn append_registry_line(root: &Path, detail: &CouncilRunDetail, decision: &CouncilDecision) {
    let mut techniques: Vec<String> = Vec::new();
    for v in &detail.verdicts {
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(&v.payload_json) else {
            continue;
        };
        let Some(list) = payload.get("techniques").and_then(|t| t.as_array()) else {
            continue;
        };
        for t in list {
            if t.get("proof").and_then(|p| p.as_str()) != Some("execution") {
                continue;
            }
            let (Some(subject), Some(technique)) = (
                t.get("subject").and_then(|s| s.as_str()),
                t.get("technique").and_then(|s| s.as_str()),
            ) else {
                continue;
            };
            let slug = format!("{subject}/{technique}");
            if !techniques.contains(&slug) {
                techniques.push(slug);
            }
        }
    }

    let line = json!({
        "ts": decision.decided_at,
        "subject_kind": detail.subject.kind,
        "slug": detail.subject.slug,
        "decision": decision.decision,
        "round_no": detail.run.round_no,
        "subjects": [detail.subject.slug],
        "techniques": techniques,
    });

    let path = COUNCILS_JSONL
        .iter()
        .fold(root.to_path_buf(), |p, seg| p.join(seg));
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!(path = %path.display(), error = %e, "council: could not open the registry lane");
            return;
        }
    }
    let body = format!("{line}\n");
    let appended = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, body.as_bytes()));
    if let Err(e) = appended {
        // Loud, not fatal: the decision is already durable, and this line is a
        // signal the registry collects, not the record itself.
        tracing::warn!(path = %path.display(), error = %e, "council: could not append the registry line");
    }
}

/// Rewrite `<repo>/.personas/council/state.json` from the store.
///
/// Rewritten wholesale rather than patched, so the file is always a statement
/// about the project's CURRENT verdicts - a patched file would accumulate rows
/// for subjects that no longer exist and quietly become a second, older truth.
///
/// Two lists, and they answer different questions. `subjects` is what a human
/// CONCLUDED. `scenarios` is what the product DECLARES its branches are, which
/// is the half the `/council` skill reads: the scopes and floors a run is
/// folded against live here and never in the result the member writes, because
/// a judge that may also decide which branches count can always pass by
/// narrowing the question. Every scenario is exported, `proposed` ones
/// included, so the skill can see a branch it named last round and report on
/// it again before anybody has adopted it.
pub(crate) fn export_state_json(pool: &personas_db::DbPool, root: &Path, project_id: &str) {
    let states = match council_repo::list_subject_states(pool, Some(project_id)) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(project = %project_id, error = %e, "council: could not read the subjects to export");
            return;
        }
    };
    let subjects: Vec<serde_json::Value> = states
        .iter()
        // Only a DECIDED subject belongs in this file: it exports what a human
        // concluded, not what the machine is still working through.
        .filter(|s| {
            matches!(
                s.state.as_str(),
                "approved" | "approved_drifted" | "rejected"
            )
        })
        .map(|s| {
            json!({
                "kind": s.kind,
                "slug": s.slug,
                "decision": if s.state == "rejected" { "rejected" } else { "approved" },
                "reason": s.rejection_reason,
                "decided_at": s.decided_at,
                "round_no": s.round_no,
            })
        })
        .collect();

    // The subject slug a scenario belongs to, so the skill can filter the one
    // list down to the subject it is judging. A scenario whose feature has no
    // council subject yet is still exported: the first round is exactly when
    // the declared branches matter most, and it has no subject until it lands.
    let subject_of_use_case: std::collections::BTreeMap<&str, &str> = states
        .iter()
        .filter_map(|s| s.use_case_id.as_deref().map(|uc| (uc, s.slug.as_str())))
        .collect();
    let slug_of_use_case = |use_case_id: &str| -> Option<String> {
        subject_of_use_case
            .get(use_case_id)
            .map(|s| (*s).to_string())
            .or_else(|| {
                use_case_repo::get_use_case(pool, use_case_id)
                    .ok()
                    .map(|u| u.slug)
            })
    };
    let scenarios: Vec<serde_json::Value> = match scenario_repo::list_scenarios_for_project(
        pool, project_id,
    ) {
        Ok(rows) => rows
            .iter()
            .filter_map(|s| {
                slug_of_use_case(&s.use_case_id).map(|subject_slug| {
                    json!({
                        "subject_slug": subject_slug,
                        "slug": s.slug,
                        "title": s.title,
                        "axes": s.axes,
                        "scope": s.scope,
                        // As DECLARED. `null` is what tells the skill's own
                        // S5 to apply its default, and writing 0.5 here
                        // would freeze today's default into every repo.
                        "floor": s.floor,
                    })
                })
            })
            .collect(),
        Err(e) => {
            tracing::warn!(project = %project_id, error = %e, "council: could not read the scenarios to export");
            Vec::new()
        }
    };

    let path = STATE_JSON
        .iter()
        .fold(root.to_path_buf(), |p, seg| p.join(seg));
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!(path = %path.display(), error = %e, "council: could not open the state lane");
            return;
        }
    }
    let body = json!({ "schema_version": 1, "subjects": subjects, "scenarios": scenarios });
    if let Err(e) = std::fs::write(&path, serde_json::to_vec_pretty(&body).unwrap_or_default()) {
        tracing::warn!(path = %path.display(), error = %e, "council: could not rewrite state.json");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::dev::council::{NewRun, NewVerdict};
    use crate::db::repos::dev::use_cases::create_use_case;
    use personas_db::DbPool;

    /// The real gate, called by its real name. The `#[tauri::command]` above
    /// is this plus `require_auth` plus an emit, so every refusal these tests
    /// drive is the one a caller meets.
    fn decide(
        pool: &DbPool,
        subject_id: &str,
        run_id: &str,
        decision: &str,
        reason: Option<&str>,
        saw_digest: &str,
    ) -> Result<CouncilDecision, AppError> {
        decide_council(pool, subject_id, run_id, decision, reason, saw_digest)
    }

    fn a_run(subject_id: &str, round: i32, outcome: &str, dir: &str) -> NewRun {
        NewRun {
            subject_id: subject_id.to_string(),
            round_no: round,
            supersedes_run_id: None,
            rubric_version: "feature-v1".into(),
            trust_state: "uncalibrated".into(),
            outcome: outcome.into(),
            overall: Some(0.72),
            coverage: 1.0,
            head_sha: "abc".into(),
            span_digest: "d".into(),
            spanned_paths_json: "[]".into(),
            hard_failures_json: "[]".into(),
            must_address_json: "[]".into(),
            summary: "s".into(),
            run_dir: dir.into(),
            started_at: None,
            finished_at: None,
        }
    }

    /// A throwaway project root, so the decide door's two best-effort exports
    /// write inside a directory this test owns rather than into the real tree.
    fn tmp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "council-cmd-{tag}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// A project, a MAJOR feature, its subject and a ready round 1.
    fn gate_ready() -> (DbPool, String, String, String) {
        let pool = crate::db::init_test_db().unwrap();
        let root = tmp_root("gate").to_string_lossy().into_owned();
        let project =
            repo::create_project(&pool, "P", &root, None, None, None, None, None).unwrap();
        let uc = create_use_case(
            &pool,
            &project.id,
            "Checkout",
            None,
            "capability",
            None,
            &[],
            Some("active"),
            "scan",
            None,
        )
        .unwrap();
        use_case_repo::set_use_case_tier(&pool, &uc.id, "major").unwrap();
        let (subject, _) = council_repo::upsert_subject(
            &pool,
            &project.id,
            "use_case",
            "checkout",
            "Checkout",
            Some(&uc.id),
        )
        .unwrap();
        let run = council_repo::insert_run(
            &pool,
            &a_run(&subject.id, 1, "ready", "/runs/r1"),
            &[NewVerdict {
                dimension: "value".into(),
                kind: "judged".into(),
                state: "measured".into(),
                score: Some(0.8),
                confidence: "med".into(),
                floor: Some(0.4),
                floor_hit: false,
                advisory: true,
                payload_json: json!({
                    "techniques": [
                        { "subject": "quality-gates", "technique": "gating-floors", "proof": "execution" },
                        { "subject": "quality-gates", "technique": "wishful-thinking", "proof": "claim" }
                    ]
                })
                .to_string(),
            }],
        )
        .unwrap();
        (pool, project.id, subject.id, run.id)
    }

    fn digest(pool: &DbPool, run_id: &str) -> String {
        council_repo::get_run_detail(pool, run_id)
            .unwrap()
            .saw_digest
    }

    #[test]
    fn a_clean_approval_is_recorded() {
        let (pool, _p, subject_id, run_id) = gate_ready();
        let d = digest(&pool, &run_id);
        let recorded = decide(&pool, &subject_id, &run_id, "approved", None, &d).unwrap();
        assert_eq!(recorded.decision, "approved");
        assert_eq!(recorded.saw_digest, d);
        let states = council_repo::list_subject_states(&pool, None).unwrap();
        assert_eq!(states[0].state, "approved");
    }

    #[test]
    fn a_rejection_without_a_reason_is_refused() {
        let (pool, _p, subject_id, run_id) = gate_ready();
        let d = digest(&pool, &run_id);
        for blank in [None, Some(""), Some("   ")] {
            let err = decide(&pool, &subject_id, &run_id, "rejected", blank, &d)
                .unwrap_err()
                .to_string();
            assert!(err.contains("needs a reason"), "{err}");
        }
        let ok = decide(
            &pool,
            &subject_id,
            &run_id,
            "rejected",
            Some("the value case is not made"),
            &d,
        )
        .unwrap();
        assert_eq!(ok.reason.as_deref(), Some("the value case is not made"));
    }

    /// The compare-and-swap, both halves.
    #[test]
    fn a_stale_digest_and_a_newer_run_are_both_refused() {
        let (pool, _p, subject_id, run_id) = gate_ready();
        let err = decide(
            &pool,
            &subject_id,
            &run_id,
            "approved",
            None,
            "not-the-digest",
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("moved since you looked"), "{err}");

        // A correct digest on a run that is no longer the latest.
        let d = digest(&pool, &run_id);
        council_repo::insert_run(&pool, &a_run(&subject_id, 2, "ready", "/runs/r2"), &[]).unwrap();
        let err = decide(&pool, &subject_id, &run_id, "approved", None, &d)
            .unwrap_err()
            .to_string();
        assert!(err.contains("moved since you looked"), "{err}");
    }

    #[test]
    fn only_a_ready_run_reaches_the_gate() {
        let pool = crate::db::init_test_db().unwrap();
        let root = tmp_root("arch").to_string_lossy().into_owned();
        let project =
            repo::create_project(&pool, "P", &root, None, None, None, None, None).unwrap();
        let (subject, _) = council_repo::upsert_subject(
            &pool,
            &project.id,
            "architecture",
            "redesign",
            "Redesign",
            None,
        )
        .unwrap();
        let run = council_repo::insert_run(&pool, &a_run(&subject.id, 1, "fail", "/runs/r1"), &[])
            .unwrap();
        let d = digest(&pool, &run.id);
        let err = decide(&pool, &subject.id, &run.id, "approved", None, &d)
            .unwrap_err()
            .to_string();
        assert!(err.contains("outcome is `fail`"), "{err}");
    }

    #[test]
    fn a_standard_feature_does_not_reach_the_gate() {
        let (pool, _p, subject_id, run_id) = gate_ready();
        let uc_id = council_repo::get_subject(&pool, &subject_id)
            .unwrap()
            .unwrap()
            .use_case_id
            .unwrap();
        use_case_repo::set_use_case_tier(&pool, &uc_id, "standard").unwrap();
        let d = digest(&pool, &run_id);
        let err = decide(&pool, &subject_id, &run_id, "approved", None, &d)
            .unwrap_err()
            .to_string();
        assert!(err.contains("promote it first"), "{err}");
    }

    /// An architecture subject has no tier and is never gated on one.
    #[test]
    fn an_architecture_subject_needs_no_tier() {
        let pool = crate::db::init_test_db().unwrap();
        let root = tmp_root("arch").to_string_lossy().into_owned();
        let project =
            repo::create_project(&pool, "P", &root, None, None, None, None, None).unwrap();
        let (subject, _) = council_repo::upsert_subject(
            &pool,
            &project.id,
            "architecture",
            "redesign",
            "Redesign",
            None,
        )
        .unwrap();
        let run = council_repo::insert_run(&pool, &a_run(&subject.id, 1, "ready", "/runs/r1"), &[])
            .unwrap();
        let d = digest(&pool, &run.id);
        assert!(decide(&pool, &subject.id, &run.id, "approved", None, &d).is_ok());
    }

    #[test]
    fn a_second_decision_supersedes_and_leaves_the_first_intact() {
        let (pool, _p, subject_id, run_id) = gate_ready();
        let d = digest(&pool, &run_id);
        let first = decide(&pool, &subject_id, &run_id, "rejected", Some("not yet"), &d).unwrap();
        let second = decide(&pool, &subject_id, &run_id, "approved", None, &d).unwrap();
        assert_eq!(
            second.supersedes_decision_id.as_deref(),
            Some(first.id.as_str())
        );
        let ledger = council_repo::list_decisions(&pool, &subject_id).unwrap();
        assert_eq!(ledger.len(), 2);
        assert_eq!(
            ledger
                .iter()
                .find(|x| x.id == first.id)
                .unwrap()
                .reason
                .as_deref(),
            Some("not yet")
        );
    }

    /// Only a technique whose proof is EXECUTION crosses the registry
    /// boundary. A claim is an opinion and the registry counts none.
    #[test]
    fn the_registry_line_carries_only_executed_techniques() {
        let (pool, _p, subject_id, run_id) = gate_ready();
        let d = digest(&pool, &run_id);
        let recorded = decide(&pool, &subject_id, &run_id, "approved", None, &d).unwrap();
        let detail = council_repo::get_run_detail(&pool, &run_id).unwrap();

        let tmp = std::env::temp_dir().join(format!(
            "council-registry-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        append_registry_line(&tmp, &detail, &recorded);

        let jsonl =
            std::fs::read_to_string(COUNCILS_JSONL.iter().fold(tmp.clone(), |p, s| p.join(s)))
                .unwrap();
        let line: serde_json::Value = serde_json::from_str(jsonl.trim()).unwrap();
        assert_eq!(line["decision"], "approved");
        assert_eq!(line["slug"], "checkout");
        assert_eq!(line["round_no"], 1);
        assert_eq!(
            line["techniques"],
            json!(["quality-gates/gating-floors"]),
            "a claim is not a proof"
        );

        // Appending, not rewriting: a second decision adds a second line.
        append_registry_line(&tmp, &detail, &recorded);
        let jsonl =
            std::fs::read_to_string(COUNCILS_JSONL.iter().fold(tmp.clone(), |p, s| p.join(s)))
                .unwrap();
        assert_eq!(jsonl.trim().lines().count(), 2);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ----- the evidence reader -----

    /// A run directory with one screenshot, one text file and a sibling
    /// directory OUTSIDE it holding a secret.
    fn media_tree() -> (PathBuf, PathBuf) {
        let base = tmp_root("media");
        let run_dir = base.join("runs").join("r1");
        std::fs::create_dir_all(&run_dir).unwrap();
        std::fs::write(run_dir.join("shot.png"), b"\x89PNG\r\n\x1a\nfake").unwrap();
        std::fs::write(run_dir.join("notes.md"), b"# notes").unwrap();
        std::fs::write(base.join("secret.png"), b"not yours").unwrap();
        (base, run_dir)
    }

    #[test]
    fn evidence_is_served_only_from_inside_the_run_directory() {
        let (base, run_dir) = media_tree();

        let ok = read_run_media(&run_dir, "shot.png").unwrap();
        assert_eq!(ok.mime, "image/png");
        assert_eq!(ok.bytes.len(), 12);

        // Escape by traversal - canonicalized before the prefix test, so the
        // file that exists one level up is still refused.
        let err = read_run_media(&run_dir, "../secret.png")
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("inside the run's own directory") || err.contains("No such evidence"),
            "{err}"
        );

        // An absolute path ignores the base entirely.
        let absolute = base.join("secret.png").to_string_lossy().into_owned();
        let err = read_run_media(&run_dir, &absolute).unwrap_err().to_string();
        assert!(err.contains("relative to its own run directory"), "{err}");
        let err = read_run_media(&run_dir, "  ").unwrap_err().to_string();
        assert!(err.contains("Evidence path cannot be empty"), "{err}");

        // An allowlist, so a file this surface cannot render is refused even
        // though it is right there in the run dir.
        let err = read_run_media(&run_dir, "notes.md")
            .unwrap_err()
            .to_string();
        assert!(err.contains("not evidence this surface can show"), "{err}");

        // A file that is not there is absent, not forbidden.
        let err = read_run_media(&run_dir, "missing.png")
            .unwrap_err()
            .to_string();
        assert!(err.contains("No such evidence"), "{err}");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn an_oversized_evidence_file_is_refused_before_it_is_read() {
        let base = tmp_root("bigmedia");
        let run_dir = base.join("r");
        std::fs::create_dir_all(&run_dir).unwrap();
        let path = run_dir.join("huge.mp4");
        let f = std::fs::File::create(&path).unwrap();
        f.set_len(MAX_MEDIA_BYTES + 1).unwrap();
        drop(f);

        let err = read_run_media(&run_dir, "huge.mp4")
            .unwrap_err()
            .to_string();
        assert!(err.contains("too large to hand to the renderer"), "{err}");

        // The same extension under the cap is served.
        std::fs::write(run_dir.join("small.webm"), b"clip").unwrap();
        assert_eq!(
            read_run_media(&run_dir, "small.webm").unwrap().mime,
            "video/webm"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn state_json_exports_only_decided_subjects() {
        let (pool, project_id, subject_id, run_id) = gate_ready();
        let tmp = std::env::temp_dir().join(format!(
            "council-state-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&tmp).unwrap();

        // Before any decision the file lists nothing.
        export_state_json(&pool, &tmp, &project_id);
        let path = STATE_JSON.iter().fold(tmp.clone(), |p, s| p.join(s));
        let body: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(body["schema_version"], 1);
        assert_eq!(body["subjects"].as_array().unwrap().len(), 0);

        let d = digest(&pool, &run_id);
        decide(
            &pool,
            &subject_id,
            &run_id,
            "rejected",
            Some("the value case is not made"),
            &d,
        )
        .unwrap();
        export_state_json(&pool, &tmp, &project_id);
        let body: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let subjects = body["subjects"].as_array().unwrap();
        assert_eq!(subjects.len(), 1);
        assert_eq!(subjects[0]["decision"], "rejected");
        assert_eq!(subjects[0]["reason"], "the value case is not made");
        assert_eq!(subjects[0]["kind"], "use_case");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// The half the `/council` skill actually reads: the DECLARED branches,
    /// with their scopes and their floors as declared. A `proposed` one is
    /// exported too - the first round is exactly when a branch nobody has
    /// adopted still needs reporting on.
    #[test]
    fn state_json_exports_every_declared_scenario_with_its_subject() {
        let (pool, project_id, subject_id, _run_id) = gate_ready();
        let use_case_id = council_repo::get_subject(&pool, &subject_id)
            .unwrap()
            .unwrap()
            .use_case_id
            .unwrap();
        scenario_repo::upsert_scenario(
            &pool,
            &crate::db::models::UpsertScenarioInput {
                id: None,
                use_case_id: use_case_id.clone(),
                slug: None,
                title: "Marketing candidates".into(),
                axes: [("candidate_family".to_string(), "marketing".to_string())]
                    .into_iter()
                    .collect(),
                scope: "must_hold".into(),
                floor: None,
            },
            "marketing",
        )
        .unwrap();
        scenario_repo::create_discovered_scenario(
            &pool,
            &use_case_id,
            "hr",
            "HR candidates",
            &Default::default(),
        )
        .unwrap();

        let tmp = tmp_root("state-scenarios");
        export_state_json(&pool, &tmp, &project_id);
        let path = STATE_JSON.iter().fold(tmp.clone(), |p, s| p.join(s));
        let body: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        let scenarios = body["scenarios"].as_array().unwrap();
        assert_eq!(scenarios.len(), 2, "the proposal is exported too");
        let marketing = scenarios.iter().find(|s| s["slug"] == "marketing").unwrap();
        assert_eq!(marketing["subject_slug"], "checkout");
        assert_eq!(marketing["scope"], "must_hold");
        assert_eq!(
            marketing["floor"],
            serde_json::Value::Null,
            "as DECLARED - writing 0.5 would freeze today's default into the repo"
        );
        assert_eq!(marketing["axes"]["candidate_family"], "marketing");
        let hr = scenarios.iter().find(|s| s["slug"] == "hr").unwrap();
        assert_eq!(hr["scope"], "proposed");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
