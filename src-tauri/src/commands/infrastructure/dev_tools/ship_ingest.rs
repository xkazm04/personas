//! The ONE gated door a `/ship-milestone` run comes back through (WP4).
//!
//! The operator chose a **skill** over an Athena op to execute a milestone,
//! knowing the trade: a CLI session is invisible to the app's progress surface
//! and writes no audit ledger. This module is the compensating control. The
//! skill writes exactly one artifact —
//! `<repo>/.personas/ship-milestone/runs/<id>/result.json` — and this command
//! is the only path from that file into `personas.db`. The session NEVER
//! touches the database.
//!
//! Shape deliberately mirrors `kpi_sim.rs::dev_tools_kpi_sim_ingest` (and the
//! retired workspace-harvest ingest): path-confined to the project's own
//! runs dir, size-capped, idempotent through an `ingested.json` marker, and
//! every write routed through the ordinary repo function
//! (`repo::set_milestone_item`) rather than SQL of its own.
//!
//! Two places it is deliberately STRICTER than its siblings:
//!
//! 1. **Version-checked, and it refuses rather than partially applying.** The
//!    harvest door skips bad rows and reports them, because a harvest row is an
//!    independent proposal. A milestone result is a *report on a cut* — half of
//!    it applied is a lie about what the run did. So the whole file is
//!    validated before a single row is written, and any structural problem
//!    fails the ingest with nothing changed.
//! 2. **It can only UPDATE existing members.** An item the milestone does not
//!    already hold is refused, never inserted. Work the run believes the
//!    milestone needs travels as `proposed_additions`, which this door only
//!    SURFACES — adding scope is an operator decision made in the Ship tab.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

use crate::db::models::DevMilestoneItem;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use personas_core::events::event_name;
use personas_db::DbPool;

/// The only `schema_version` this door accepts. Bump ONLY together with the
/// skill's own contract (`.claude/skills/ship-milestone/skill.md`); an unknown
/// version is refused rather than best-effort parsed, because a result written
/// against a contract we do not know is not a result we can trust row-wise.
pub const SHIP_MILESTONE_RESULT_VERSION: u32 = 1;

/// Handshake directory (already gitignored in managed repos) and the run tree
/// underneath it. One dir per run; `result.json` inside; `ingested.json`
/// written beside it once this door has consumed it.
const RUNS_REL: [&str; 3] = [".personas", "ship-milestone", "runs"];

const MAX_RESULT_BYTES: u64 = 1_048_576;
/// Per-item outcome rows. A milestone's cut is small by construction; anything
/// beyond this is a malformed result, not a big milestone.
const MAX_ITEM_OUTCOMES: usize = 100;
/// Proposed additions. Mirrors `FLEET_PLAN_MAX_ROWS` (8) for the same reason
/// `SHIP_MILESTONE_MAX_ROWS` does: the value of a proposal list is that the
/// operator READS every row before accepting any of it.
const MAX_PROPOSED_ADDITIONS: usize = 8;
/// Interview questions echoed back. Bounded so the marker stays readable.
const MAX_QUESTIONS: usize = 20;
/// Longest free-text field (a member description, an addition rationale).
/// Mirrors `FLEET_PLAN_OBJECTIVE_MAX` / `SHIP_MILESTONE_DESCRIPTION_MAX`.
const MAX_TEXT: usize = 1200;
/// Longest proposed-addition name. Mirrors `SHIP_MILESTONE_NAME_MAX`.
const MAX_NAME: usize = 300;

/// The two member kinds, mirroring the `dev_milestone_items.item_kind` CHECK.
/// KPIs are the outcome layer ABOVE a milestone and are never members of one.
const ITEM_KINDS: [&str; 2] = ["use_case", "goal"];

// ── result.json shape ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ShipRunResult {
    /// Absent is NOT tolerated — see [`SHIP_MILESTONE_RESULT_VERSION`].
    #[serde(default)]
    schema_version: Option<u32>,
    /// Optional self-identification. When present it must match the milestone
    /// being ingested, so a result dropped into the wrong run dir is caught.
    #[serde(default)]
    milestone_id: Option<String>,
    #[serde(default)]
    items: Vec<ShipRunItem>,
    #[serde(default)]
    proposed_additions: Vec<ShipRunAddition>,
    #[serde(default)]
    asked: Vec<ShipRunQuestion>,
    #[serde(default)]
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShipRunItem {
    item_kind: String,
    item_id: String,
    #[serde(default)]
    suggested_description: Option<String>,
    #[serde(default)]
    suggested_rating: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct ShipRunAddition {
    item_kind: String,
    name: String,
    #[serde(default)]
    rationale: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShipRunQuestion {
    question: String,
    #[serde(default)]
    answer: Option<String>,
}

// ── what the door hands back ────────────────────────────────────────────────

/// An addition the run believes the milestone needs. SURFACED ONLY — this door
/// never calls `set_milestone_item` for one of these.
#[derive(Debug, Clone, serde::Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ShipMilestoneProposedAddition {
    /// 'use_case' | 'goal'
    pub item_kind: String,
    pub name: String,
    pub rationale: Option<String>,
}

#[derive(Debug, Default, serde::Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ShipMilestoneIngestSummary {
    pub run_dir: String,
    pub milestone_id: String,
    /// Members that received at least one column write.
    pub items_updated: u32,
    pub ratings_set: u32,
    pub descriptions_set: u32,
    /// Members the run reported on but left unchanged (no rating, no
    /// description) — reported so a no-op run does not read as a failure.
    pub items_reported: u32,
    pub proposed_additions: Vec<ShipMilestoneProposedAddition>,
    /// What the run asked the operator, so the answers that shaped it are not
    /// lost with the terminal scrollback.
    pub questions_asked: Vec<String>,
    pub summary: Option<String>,
}

// ── validation (pure — no DB, no filesystem) ────────────────────────────────

/// One member update, resolved against the milestone's real membership.
#[derive(Debug, Clone, PartialEq)]
struct ResolvedUpdate {
    item_kind: String,
    item_id: String,
    /// The member's CURRENT bucket, replayed unchanged. This door annotates a
    /// cut; it never re-buckets one.
    bucket: String,
    description: Option<String>,
    rating: Option<i32>,
}

#[derive(Debug, Default)]
struct ValidatedRun {
    updates: Vec<ResolvedUpdate>,
    reported_only: u32,
    additions: Vec<ShipMilestoneProposedAddition>,
    questions: Vec<String>,
    summary: Option<String>,
}

fn trimmed(s: &str, max: usize, what: &str) -> Result<String, AppError> {
    let t = s.trim();
    if t.is_empty() {
        return Err(AppError::Validation(format!("{what} is empty")));
    }
    if t.chars().count() > max {
        return Err(AppError::Validation(format!(
            "{what} is longer than {max} characters"
        )));
    }
    Ok(t.to_string())
}

/// Parse + fully validate a result against the milestone's real membership.
///
/// Returns `Err` on ANY structural problem, leaving the caller nothing to
/// partially apply. This is the whole reason the function is separate from the
/// write loop below.
fn validate_ship_result(
    raw: &str,
    milestone_id: &str,
    members: &[DevMilestoneItem],
) -> Result<ValidatedRun, AppError> {
    let result: ShipRunResult = serde_json::from_str(raw)
        .map_err(|e| AppError::Validation(format!("result.json is not valid: {e}")))?;

    match result.schema_version {
        Some(v) if v == SHIP_MILESTONE_RESULT_VERSION => {}
        Some(v) => {
            return Err(AppError::Validation(format!(
                "result.json declares schema_version {v}; this app understands {SHIP_MILESTONE_RESULT_VERSION} — refusing to ingest"
            )))
        }
        None => {
            return Err(AppError::Validation(format!(
                "result.json has no schema_version (expected {SHIP_MILESTONE_RESULT_VERSION}) — refusing to ingest"
            )))
        }
    }

    if let Some(claimed) = result.milestone_id.as_deref().map(str::trim) {
        if !claimed.is_empty() && claimed != milestone_id {
            return Err(AppError::Validation(format!(
                "result.json reports on milestone {claimed}, not {milestone_id}"
            )));
        }
    }

    if result.items.len() > MAX_ITEM_OUTCOMES {
        return Err(AppError::Validation(format!(
            "result.json carries {} item outcomes (cap {MAX_ITEM_OUTCOMES})",
            result.items.len()
        )));
    }
    if result.proposed_additions.len() > MAX_PROPOSED_ADDITIONS {
        return Err(AppError::Validation(format!(
            "result.json proposes {} additions (cap {MAX_PROPOSED_ADDITIONS})",
            result.proposed_additions.len()
        )));
    }

    let mut out = ValidatedRun::default();
    let mut seen: Vec<(String, String)> = Vec::new();

    for (i, it) in result.items.iter().enumerate() {
        let kind = it.item_kind.trim();
        if !ITEM_KINDS.contains(&kind) {
            return Err(AppError::Validation(format!(
                "items[{i}]: unknown item_kind `{kind}` (expected use_case or goal)"
            )));
        }
        let id = it.item_id.trim();
        if id.is_empty() {
            return Err(AppError::Validation(format!(
                "items[{i}]: item_id is empty"
            )));
        }
        let key = (kind.to_string(), id.to_string());
        if seen.contains(&key) {
            return Err(AppError::Validation(format!(
                "items[{i}]: {kind} {id} appears twice"
            )));
        }
        seen.push(key);

        // The membership guard. An item the milestone does not hold is a
        // PROPOSAL, and proposals do not come through this arm.
        let Some(member) = members
            .iter()
            .find(|m| m.item_kind == kind && m.item_id == id)
        else {
            return Err(AppError::Validation(format!(
                "items[{i}]: {kind} {id} is not a member of this milestone — report it under proposed_additions instead"
            )));
        };

        if let Some(r) = it.suggested_rating {
            if !(1..=5).contains(&r) {
                return Err(AppError::Validation(format!(
                    "items[{i}]: suggested_rating {r} is outside 1..5"
                )));
            }
        }
        let description = match it.suggested_description.as_deref() {
            Some(d) => Some(trimmed(
                d,
                MAX_TEXT,
                &format!("items[{i}].suggested_description"),
            )?),
            None => None,
        };

        if description.is_none() && it.suggested_rating.is_none() {
            out.reported_only += 1;
            continue;
        }
        out.updates.push(ResolvedUpdate {
            item_kind: kind.to_string(),
            item_id: id.to_string(),
            bucket: member.bucket.clone(),
            description,
            rating: it.suggested_rating,
        });
    }

    for (i, a) in result.proposed_additions.iter().enumerate() {
        let kind = a.item_kind.trim();
        if !ITEM_KINDS.contains(&kind) {
            return Err(AppError::Validation(format!(
                "proposed_additions[{i}]: unknown item_kind `{kind}`"
            )));
        }
        let name = trimmed(&a.name, MAX_NAME, &format!("proposed_additions[{i}].name"))?;
        let rationale = match a.rationale.as_deref() {
            Some(r) => Some(trimmed(
                r,
                MAX_TEXT,
                &format!("proposed_additions[{i}].rationale"),
            )?),
            None => None,
        };
        out.additions.push(ShipMilestoneProposedAddition {
            item_kind: kind.to_string(),
            name,
            rationale,
        });
    }

    out.questions = result
        .asked
        .iter()
        .take(MAX_QUESTIONS)
        .map(
            |q| match q.answer.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
                Some(a) => format!("{} → {}", q.question.trim(), a),
                None => q.question.trim().to_string(),
            },
        )
        .filter(|s| !s.is_empty())
        .collect();
    out.summary = result
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(MAX_TEXT).collect());

    Ok(out)
}

// ── path confinement ────────────────────────────────────────────────────────

fn runs_root(root: &Path) -> PathBuf {
    RUNS_REL
        .iter()
        .fold(root.to_path_buf(), |p, seg| p.join(seg))
}

/// Resolve the run dir, refusing anything outside the project's own runs tree.
/// An arbitrary path would let a crafted call read foreign files.
fn resolve_run_dir(root: &Path, run_dir: Option<String>) -> Result<PathBuf, AppError> {
    let Some(d) = run_dir else {
        return crate::commands::infrastructure::skill_runs::newest_ingestable_run(&runs_root(root)).ok_or_else(|| {
            AppError::Validation(
                "No un-ingested run found under .personas/ship-milestone/runs/ — run /ship-milestone first"
                    .into(),
            )
        });
    };
    let canon = PathBuf::from(&d)
        .canonicalize()
        .map_err(|e| AppError::Validation(format!("Run dir not readable: {e}")))?;
    let canon_root = runs_root(root).canonicalize().map_err(|_| {
        AppError::Validation("No .personas/ship-milestone/runs directory in this repo yet".into())
    })?;
    if !canon.starts_with(&canon_root) {
        return Err(AppError::Validation(
            "Run dir must be inside the project's .personas/ship-milestone/runs/".into(),
        ));
    }
    Ok(canon)
}

// ── the door ────────────────────────────────────────────────────────────────

/// Ingest a finished `/ship-milestone` run into the milestone it reports on.
///
/// `run_dir` optional — defaults to the newest un-ingested run. Guards, in
/// order: path confinement · 1 MiB size cap · `schema_version` match · full
/// validation before any write · idempotency marker. Per-member writes go
/// through `repo::set_milestone_item` with the member's EXISTING bucket, so an
/// ingest can annotate a cut but never reshape it. Proposed additions come
/// back in the summary and are not applied.
#[tauri::command]
pub async fn dev_tools_ship_milestone_ingest(
    state: State<'_, Arc<AppState>>,
    milestone_id: String,
    run_dir: Option<String>,
) -> Result<ShipMilestoneIngestSummary, AppError> {
    require_auth(&state).await?;
    ingest_ship_milestone(&state.db, &milestone_id, run_dir)
}

/// Body of [`dev_tools_ship_milestone_ingest`], minus the IPC envelope.
pub(crate) fn ingest_ship_milestone(
    pool: &crate::db::DbPool,
    milestone_id: &str,
    run_dir: Option<String>,
) -> Result<ShipMilestoneIngestSummary, AppError> {
    let milestone = repo::get_milestone_by_id(pool, milestone_id)?;
    let project = repo::get_project_by_id(pool, &milestone.project_id)?;
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

    let members = repo::list_milestone_items(pool, milestone_id)?;
    // Validate EVERYTHING before writing anything — a milestone report half
    // applied misdescribes what the run did.
    let run = validate_ship_result(&raw, milestone_id, &members)?;

    let mut summary = ShipMilestoneIngestSummary {
        run_dir: dir.to_string_lossy().into_owned(),
        milestone_id: milestone_id.to_string(),
        items_reported: run.reported_only,
        proposed_additions: run.additions,
        questions_asked: run.questions,
        summary: run.summary,
        ..Default::default()
    };

    for u in &run.updates {
        // The ordinary repo function, with the member's own bucket replayed —
        // never SQL of this module's own, never a bucket change.
        repo::set_milestone_item(
            pool,
            milestone_id,
            &u.item_kind,
            &u.item_id,
            &u.bucket,
            u.description.as_deref().map(Some),
            u.rating.map(Some),
        )?;
        summary.items_updated += 1;
        if u.description.is_some() {
            summary.descriptions_set += 1;
        }
        if u.rating.is_some() {
            summary.ratings_set += 1;
        }
    }

    // Idempotency marker. Carries the proposals too, so an operator who closes
    // the panel can still find what the run suggested.
    let marker = json!({
        "ingested_at": chrono::Utc::now().to_rfc3339(),
        "schema_version": SHIP_MILESTONE_RESULT_VERSION,
        "milestone_id": milestone_id,
        "items_updated": summary.items_updated,
        "ratings_set": summary.ratings_set,
        "descriptions_set": summary.descriptions_set,
        "proposed_additions": summary.proposed_additions
            .iter()
            .map(|a| json!({ "item_kind": a.item_kind, "name": a.name }))
            .collect::<Vec<_>>(),
    });
    if let Err(e) = std::fs::write(
        dir.join("ingested.json"),
        serde_json::to_vec_pretty(&marker).unwrap_or_default(),
    ) {
        // Loud, not fatal: the writes already landed, and set_milestone_item is
        // an idempotent upsert, so a re-ingest of the same file is harmless.
        tracing::warn!(run = %dir.display(), error = %e, "could not write ship-milestone ingest marker");
    }

    tracing::info!(
        milestone = %milestone_id,
        updated = summary.items_updated,
        proposed = summary.proposed_additions.len(),
        "ingested ship-milestone run"
    );
    Ok(summary)
}

// ── The ticker's half of the door ───────────────────────────────────────────

/// The newest un-ingested run under this project's ship-milestone runs tree, or
/// `None`.
///
/// Separate from [`resolve_run_dir`] on purpose: that function turns "no run"
/// into an `AppError::Validation` because a COMMAND has a caller who asked for
/// one, while the sweeper visits every linked note every 30 s and "no run" is
/// the ordinary answer. Reading the idle case off an error STRING would be a
/// warn-per-tick per note, forever.
pub(crate) fn newest_ship_run_dir(root: &Path) -> Option<PathBuf> {
    crate::commands::infrastructure::skill_runs::newest_ingestable_run(&runs_root(root))
}

/// Stamp a refusal marker beside a result this door could not use.
///
/// `ingest_ship_milestone` writes `ingested.json` only on success, so without
/// this a malformed `result.json` would be re-read, re-parsed and re-refused on
/// every tick for as long as the file exists. The marker records WHY, so the
/// operator can read it instead of hunting the log.
fn write_failed_marker(dir: &Path, milestone_id: &str, reason: &str) {
    let payload = json!({
        "ingested_at": chrono::Utc::now().to_rfc3339(),
        "schema_version": SHIP_MILESTONE_RESULT_VERSION,
        "milestone_id": milestone_id,
        "outcome": "failed",
        "reason": reason,
    });
    if let Err(e) = std::fs::write(
        dir.join("ingested.json"),
        serde_json::to_vec_pretty(&payload).unwrap_or_default(),
    ) {
        tracing::warn!(run = %dir.display(), error = %e, "ship ingest: could not write refusal marker");
    }
}

/// One note in the ship lane whose repo we know where to look in.
struct ScopedNote {
    note_id: String,
    milestone_id: String,
    root_path: String,
}

/// Notes that are a milestone's brief, still live, in a project with a path.
fn scoped_notes(pool: &DbPool) -> Result<Vec<ScopedNote>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT n.id AS note_id, n.milestone_id AS milestone_id, p.root_path AS root_path
           FROM dev_notes n
           JOIN dev_projects p ON p.id = n.project_id
          WHERE n.status IN ('scoped', 'cut')
            AND n.milestone_id IS NOT NULL
            AND p.root_path IS NOT NULL AND p.root_path != ''",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ScopedNote {
            note_id: row.get("note_id")?,
            milestone_id: row.get("milestone_id")?,
            root_path: row.get("root_path")?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

/// Called from the fleet stale ticker, right after the Notepad sweep.
///
/// The `/ship-milestone` skill writes its result into the repo and the app has
/// no other channel back; this is the same watcher the Notepad already has, for
/// the other run kind. **Nothing here may fail the tick**: every note is
/// independent and every failure is a `warn` plus a refusal marker, so one bad
/// file in one repo costs exactly that one note.
pub fn sweep_pending_ship_ingests(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    // The payload's `status` is typed `NoteStatus` on the client
    // (`src/lib/eventRegistry.ts:1170`), so it carries the note's REAL status
    // read back after the ingest — never a token invented for this call site.
    let db = state.db.clone();
    let mut emit = |note_id: &str| {
        let status = repo::get_note(&db, note_id)
            .map(|n| n.status.as_str())
            .unwrap_or("scoped");
        if let Err(e) = app.emit(
            event_name::NOTEPAD_NOTE_CHANGED,
            json!({ "noteId": note_id, "status": status }),
        ) {
            tracing::warn!(event = event_name::NOTEPAD_NOTE_CHANGED, error = %e, "notepad: note-changed emit failed");
        }
    };
    sweep_ship_ingests_core(&state.db, &mut emit);
}

/// Body of [`sweep_pending_ship_ingests`], with the emission factored out so the
/// whole sweep is testable without a `tauri::AppHandle` — the same split
/// `sweep_notepad_runs_core` uses.
///
/// Returns how many runs it ingested, which is what the test asserts on and
/// what makes "a second sweep is a no-op" a statement rather than a hope.
pub(crate) fn sweep_ship_ingests_core(pool: &DbPool, on_change: &mut dyn FnMut(&str)) -> u32 {
    let mut ingested = 0u32;
    let notes = match scoped_notes(pool) {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!(error = %e, "ship ingest: could not list scoped notes");
            return ingested;
        }
    };

    for note in notes {
        let root = PathBuf::from(&note.root_path);
        // The idle case, and it is the overwhelmingly common one. Silent.
        let Some(dir) = newest_ship_run_dir(&root) else {
            continue;
        };
        if !dir.join("result.json").is_file() {
            continue;
        }

        let run_dir = dir.to_string_lossy().into_owned();
        match ingest_ship_milestone(pool, &note.milestone_id, Some(run_dir.clone())) {
            Ok(summary) => {
                let summary_json = serde_json::to_string(&summary).ok();
                close_note_run(pool, &note.note_id, summary_json.as_deref(), Some(&run_dir));
                if let Some(raw) = summary_json.as_deref() {
                    if let Err(e) = repo::set_result_json(pool, &note.note_id, raw) {
                        tracing::warn!(note = %note.note_id, error = %e, "ship ingest: could not store the run report on the note");
                    }
                }
                ingested += 1;
                on_change(&note.note_id);
                tracing::info!(
                    note = %note.note_id,
                    milestone = %note.milestone_id,
                    updated = summary.items_updated,
                    "ship ingest: swept a milestone run into its brief"
                );
            }
            Err(e) => {
                // The file exists and this door refuses it. Mark it so the next
                // tick moves on, and say why in the marker AND the log.
                tracing::warn!(note = %note.note_id, milestone = %note.milestone_id, run = %run_dir, error = %e, "ship ingest: refused a milestone run");
                write_failed_marker(&dir, &note.milestone_id, &e.to_string());
            }
        }
    }
    ingested
}

/// Close the note's open `ship_milestone` run, or record one that was never
/// opened (the operator ran the skill without dispatching from the pad).
fn close_note_run(
    pool: &crate::db::DbPool,
    note_id: &str,
    summary_json: Option<&str>,
    run_dir: Option<&str>,
) {
    let existing = repo::newest_running_run(pool, note_id, "ship_milestone")
        .unwrap_or_else(|e| {
            tracing::warn!(note = %note_id, error = %e, "ship ingest: could not read the note's open run");
            None
        });
    let run_id = match existing {
        Some(run) => run.id,
        None => match repo::record_run_start(pool, note_id, "ship_milestone", None, None) {
            Ok(run) => run.id,
            Err(e) => {
                tracing::warn!(note = %note_id, error = %e, "ship ingest: could not open a run row for an undispatched run");
                return;
            }
        },
    };
    if let Err(e) = repo::complete_run(pool, &run_id, "completed", summary_json, run_dir) {
        tracing::warn!(note = %note_id, run = %run_id, error = %e, "ship ingest: run row left open");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(kind: &str, id: &str, bucket: &str) -> DevMilestoneItem {
        DevMilestoneItem {
            milestone_id: "m1".into(),
            item_kind: kind.into(),
            item_id: id.into(),
            bucket: bucket.into(),
            added_after_cut: false,
            order_index: 0,
            created_at: "2026-08-04T00:00:00Z".into(),
            description: None,
            rating: None,
        }
    }

    fn members() -> Vec<DevMilestoneItem> {
        vec![
            member("use_case", "uc-a", "core"),
            member("goal", "g-1", "later"),
        ]
    }

    #[test]
    fn accepts_a_well_formed_result_and_replays_the_existing_bucket() {
        let raw = r#"{
            "schema_version": 1,
            "milestone_id": "m1",
            "items": [
              { "item_kind": "use_case", "item_id": "uc-a", "changed": "wired the door",
                "suggested_rating": 4, "suggested_description": "ships behind the flag" },
              { "item_kind": "goal", "item_id": "g-1", "changed": "nothing yet" }
            ],
            "proposed_additions": [
              { "item_kind": "use_case", "name": "Retry on 429", "rationale": "found while working" }
            ],
            "asked": [ { "question": "Target state?", "answer": "beta" } ],
            "summary": "one member advanced"
        }"#;
        let run = validate_ship_result(raw, "m1", &members()).unwrap();
        assert_eq!(run.updates.len(), 1);
        // The bucket comes from the MEMBER, never from the file.
        assert_eq!(run.updates[0].bucket, "core");
        assert_eq!(run.updates[0].rating, Some(4));
        // A member reported on with neither field is not a write.
        assert_eq!(run.reported_only, 1);
        assert_eq!(run.additions.len(), 1);
        assert_eq!(run.questions, vec!["Target state? → beta"]);
        assert_eq!(run.summary.as_deref(), Some("one member advanced"));
    }

    #[test]
    fn refuses_an_unknown_schema_version() {
        let raw = r#"{ "schema_version": 99, "items": [] }"#;
        let err = validate_ship_result(raw, "m1", &members())
            .unwrap_err()
            .to_string();
        assert!(err.contains("99"), "{err}");
        assert!(err.contains("refusing to ingest"), "{err}");
    }

    #[test]
    fn refuses_a_result_with_no_schema_version() {
        let raw = r#"{ "items": [] }"#;
        assert!(validate_ship_result(raw, "m1", &members()).is_err());
    }

    #[test]
    fn refuses_malformed_json_rather_than_applying_the_readable_part() {
        let raw = r#"{ "schema_version": 1, "items": [ { "item_kind": "use_case" "#;
        assert!(validate_ship_result(raw, "m1", &members()).is_err());
    }

    #[test]
    fn one_bad_row_refuses_the_whole_run() {
        // Row 0 is perfectly good; row 1 rates outside 1..5. Nothing is
        // returned for either — the caller has nothing to partially apply.
        let raw = r#"{
            "schema_version": 1,
            "items": [
              { "item_kind": "use_case", "item_id": "uc-a", "suggested_rating": 5 },
              { "item_kind": "goal", "item_id": "g-1", "suggested_rating": 9 }
            ]
        }"#;
        let err = validate_ship_result(raw, "m1", &members())
            .unwrap_err()
            .to_string();
        assert!(err.contains("outside 1..5"), "{err}");
    }

    #[test]
    fn refuses_an_item_that_is_not_a_member() {
        let raw = r#"{ "schema_version": 1,
            "items": [ { "item_kind": "use_case", "item_id": "uc-ghost", "suggested_rating": 3 } ] }"#;
        let err = validate_ship_result(raw, "m1", &members())
            .unwrap_err()
            .to_string();
        assert!(err.contains("not a member"), "{err}");
        assert!(err.contains("proposed_additions"), "{err}");
    }

    #[test]
    fn refuses_a_result_reporting_on_another_milestone() {
        let raw = r#"{ "schema_version": 1, "milestone_id": "m2", "items": [] }"#;
        assert!(validate_ship_result(raw, "m1", &members()).is_err());
    }

    #[test]
    fn refuses_a_kpi_as_a_milestone_item() {
        let raw = r#"{ "schema_version": 1,
            "items": [ { "item_kind": "kpi", "item_id": "k-1", "suggested_rating": 3 } ] }"#;
        let err = validate_ship_result(raw, "m1", &members())
            .unwrap_err()
            .to_string();
        assert!(err.contains("unknown item_kind"), "{err}");
    }

    #[test]
    fn caps_item_outcomes_and_proposed_additions() {
        let rows = (0..MAX_ITEM_OUTCOMES + 1)
            .map(|i| format!(r#"{{ "item_kind": "use_case", "item_id": "uc-{i}" }}"#))
            .collect::<Vec<_>>()
            .join(",");
        let raw = format!(r#"{{ "schema_version": 1, "items": [{rows}] }}"#);
        assert!(validate_ship_result(&raw, "m1", &members()).is_err());

        let adds = (0..MAX_PROPOSED_ADDITIONS + 1)
            .map(|i| format!(r#"{{ "item_kind": "goal", "name": "add {i}" }}"#))
            .collect::<Vec<_>>()
            .join(",");
        let raw = format!(r#"{{ "schema_version": 1, "proposed_additions": [{adds}] }}"#);
        assert!(validate_ship_result(&raw, "m1", &members()).is_err());
    }

    #[test]
    fn proposed_additions_are_surfaced_never_turned_into_updates() {
        let raw = r#"{ "schema_version": 1, "items": [],
            "proposed_additions": [
              { "item_kind": "use_case", "name": "Rate limiting", "rationale": "the run hit it" },
              { "item_kind": "goal", "name": "Close the audit gap" }
            ] }"#;
        let run = validate_ship_result(raw, "m1", &members()).unwrap();
        assert!(run.updates.is_empty(), "additions must never become writes");
        assert_eq!(run.additions.len(), 2);
    }

    #[test]
    fn path_confinement_rejects_a_run_dir_outside_the_runs_tree() {
        let tmp = std::env::temp_dir().join(format!("ship-ingest-{}", std::process::id()));
        let runs = runs_root(&tmp);
        let inside = runs.join("2026-08-04-1200");
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

/// End-to-end over a real pool + a real run dir: the two properties that only
/// show up once the door actually writes — updates land through
/// `set_milestone_item` (bucket and creep flag survive), and a second ingest of
/// the same run is refused.
#[cfg(test)]
mod door_tests {
    use super::*;
    use crate::db::DbPool;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:ship_ingest_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("pool");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
            crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    fn write_run(root: &Path, name: &str, body: &str) -> PathBuf {
        let dir = runs_root(root).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("result.json"), body).unwrap();
        dir
    }

    #[test]
    fn updates_go_through_set_milestone_item_and_a_rerun_is_refused() {
        let pool = test_pool();
        let tmp = std::env::temp_dir().join(format!(
            "ship-door-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let root = tmp.to_string_lossy().into_owned();

        let project =
            repo::create_project(&pool, "P", &root, None, None, None, None, None).unwrap();
        let ms =
            repo::create_milestone(&pool, &project.id, "v1", Some("ship it"), None, None, None)
                .unwrap();
        // Member joins BEFORE the cut, in `later`. Both facts must survive.
        repo::set_milestone_item(&pool, &ms.id, "use_case", "uc-a", "later", None, None).unwrap();
        repo::update_milestone(&pool, &ms.id, None, None, None, Some("active"), None, None)
            .unwrap();

        write_run(
            &tmp,
            "2026-08-04-1200",
            r#"{ "schema_version": 1, "items": [
                 { "item_kind": "use_case", "item_id": "uc-a",
                   "suggested_rating": 2, "suggested_description": "sensors disagree" } ],
                 "proposed_additions": [ { "item_kind": "goal", "name": "Add a retry budget" } ] }"#,
        );

        let summary = ingest_ship_milestone(&pool, &ms.id, None).unwrap();
        assert_eq!(summary.items_updated, 1);
        assert_eq!(summary.ratings_set, 1);
        assert_eq!(summary.descriptions_set, 1);
        // Surfaced, not applied: the milestone still holds exactly one member.
        assert_eq!(summary.proposed_additions.len(), 1);

        let items = repo::list_milestone_items(&pool, &ms.id).unwrap();
        assert_eq!(
            items.len(),
            1,
            "a proposed addition must never become a member"
        );
        assert_eq!(items[0].rating, Some(2));
        assert_eq!(items[0].description.as_deref(), Some("sensors disagree"));
        // Proof the write went through set_milestone_item's upsert rather than
        // an insert of this module's own: the bucket is untouched and the
        // pre-cut membership did not get re-flagged as creep.
        assert_eq!(items[0].bucket, "later");
        assert!(!items[0].added_after_cut);

        // Idempotency: the marker refuses the second pass.
        let err = ingest_ship_milestone(&pool, &ms.id, None)
            .unwrap_err()
            .to_string();
        assert!(err.contains("No un-ingested run"), "{err}");
        let dir = runs_root(&tmp).join("2026-08-04-1200");
        let err = ingest_ship_milestone(&pool, &ms.id, Some(dir.to_string_lossy().into_owned()))
            .unwrap_err()
            .to_string();
        assert!(err.contains("already ingested"), "{err}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_malformed_run_changes_nothing() {
        let pool = test_pool();
        let tmp = std::env::temp_dir().join(format!(
            "ship-door-bad-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let root = tmp.to_string_lossy().into_owned();
        let project =
            repo::create_project(&pool, "P", &root, None, None, None, None, None).unwrap();
        let ms = repo::create_milestone(&pool, &project.id, "v1", None, None, None, None).unwrap();
        repo::set_milestone_item(&pool, &ms.id, "use_case", "uc-a", "core", None, None).unwrap();

        // Row 0 is valid, row 1 is not. Nothing may land.
        write_run(
            &tmp,
            "2026-08-04-1300",
            r#"{ "schema_version": 1, "items": [
                 { "item_kind": "use_case", "item_id": "uc-a", "suggested_rating": 5 },
                 { "item_kind": "use_case", "item_id": "uc-ghost", "suggested_rating": 5 } ] }"#,
        );
        assert!(ingest_ship_milestone(&pool, &ms.id, None).is_err());
        let items = repo::list_milestone_items(&pool, &ms.id).unwrap();
        assert_eq!(items[0].rating, None, "a refused run must apply nothing");
        // No marker written, so a corrected result can be re-ingested.
        assert!(!runs_root(&tmp)
            .join("2026-08-04-1300")
            .join("ingested.json")
            .is_file());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}

/// The ticker's half of the door: a scoped note whose repo holds a finished
/// `/ship-milestone` run.
///
/// Three properties, and the second is the one a sweeper gets wrong:
/// the run lands on the FIRST pass; the second pass is a no-op (the marker);
/// and a result this door refuses gets a marker of its own, so it is not
/// re-parsed and re-refused every thirty seconds forever.
#[cfg(test)]
mod sweeper_tests {
    use super::*;
    use crate::db::models::NoteStatus;
    use crate::db::DbPool;

    /// The production-shaped pool (`STANDARD_PRAGMAS`, foreign keys ON, the
    /// whole migration chain), so what this proves about cascades and FK
    /// refusals is proved under the rules the app runs on.
    fn test_pool() -> DbPool {
        crate::db::init_test_db().expect("test db")
    }

    fn tmp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "ship-sweep-{tag}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_run(root: &Path, name: &str, body: &str) -> PathBuf {
        let dir = runs_root(root).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("result.json"), body).unwrap();
        dir
    }

    /// A project + an active milestone + the note that is its brief, scoped.
    fn seeded(pool: &DbPool, root: &Path) -> (String, String) {
        let root = root.to_string_lossy().into_owned();
        let project = repo::create_project(pool, "P", &root, None, None, None, None, None).unwrap();
        let ms = repo::create_milestone(pool, &project.id, "v1", None, None, None, None).unwrap();
        repo::set_milestone_item(pool, &ms.id, "use_case", "uc-a", "core", None, None).unwrap();
        let note = repo::create_note(pool, "The brief", Some(&project.id)).unwrap();
        let note = repo::link_milestone(pool, &note.id, Some(&ms.id)).unwrap();
        assert_eq!(note.status, NoteStatus::Scoped);
        (note.id, ms.id)
    }

    #[test]
    fn a_finished_run_lands_once_and_the_second_sweep_does_nothing() {
        let pool = test_pool();
        let tmp = tmp_root("ok");
        let (note_id, _ms_id) = seeded(&pool, &tmp);
        let dir = write_run(
            &tmp,
            "2026-09-15-1000",
            r#"{ "schema_version": 1, "items": [
                 { "item_kind": "use_case", "item_id": "uc-a",
                   "suggested_rating": 4, "suggested_description": "wired" } ],
                 "summary": "one member advanced" }"#,
        );

        let mut changed: Vec<String> = Vec::new();
        let n = sweep_ship_ingests_core(&pool, &mut |id| changed.push(id.to_string()));
        assert_eq!(n, 1);
        assert_eq!(changed, vec![note_id.clone()]);
        assert!(dir.join("ingested.json").is_file());

        // The cut took the annotation.
        let items = repo::list_milestone_items(&pool, &_ms_id).unwrap();
        assert_eq!(items[0].rating, Some(4));

        // The ledger row is closed, carries the run dir, and the note carries
        // the report.
        let runs = repo::list_runs(&pool, &note_id).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].kind, "ship_milestone");
        assert_eq!(runs[0].status, "completed");
        assert_eq!(
            runs[0].run_dir.as_deref(),
            Some(dir.to_string_lossy().as_ref())
        );
        assert!(runs[0]
            .summary_json
            .as_deref()
            .unwrap()
            .contains("one member advanced"));
        assert!(repo::get_note(&pool, &note_id)
            .unwrap()
            .result_json
            .unwrap()
            .contains("itemsUpdated"));

        // Second pass: the marker is the idempotency spine.
        let mut changed2: Vec<String> = Vec::new();
        let n = sweep_ship_ingests_core(&pool, &mut |id| changed2.push(id.to_string()));
        assert_eq!(n, 0, "a second sweep must be a no-op");
        assert!(changed2.is_empty());
        assert_eq!(repo::list_runs(&pool, &note_id).unwrap().len(), 1);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// `ingest_ship_milestone` writes no marker when it refuses, so without the
    /// sweeper's own refusal marker a malformed file is re-read every tick for
    /// as long as it exists. This is the test that pins that.
    #[test]
    fn a_refused_run_is_marked_so_it_is_not_re_read_every_tick() {
        let pool = test_pool();
        let tmp = tmp_root("bad");
        let (note_id, ms_id) = seeded(&pool, &tmp);
        let dir = write_run(
            &tmp,
            "2026-09-15-1100",
            r#"{ "schema_version": 1, "items": [
                 { "item_kind": "use_case", "item_id": "uc-ghost", "suggested_rating": 5 } ] }"#,
        );

        let n = sweep_ship_ingests_core(&pool, &mut |_| {});
        assert_eq!(n, 0, "a refused run is not an ingest");
        assert!(
            dir.join("ingested.json").is_file(),
            "the refusal must be marked"
        );
        assert!(repo::list_runs(&pool, &note_id).unwrap().is_empty());
        assert_eq!(
            repo::list_milestone_items(&pool, &ms_id).unwrap()[0].rating,
            None
        );

        // And the next tick walks past it rather than re-refusing.
        let n = sweep_ship_ingests_core(&pool, &mut |_| {});
        assert_eq!(n, 0);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// The idle case — every tick, for every linked note, forever. It must
    /// touch nothing and say nothing.
    #[test]
    fn a_note_with_no_run_is_silently_skipped() {
        let pool = test_pool();
        let tmp = tmp_root("idle");
        let (note_id, _) = seeded(&pool, &tmp);
        assert_eq!(sweep_ship_ingests_core(&pool, &mut |_| {}), 0);
        assert!(repo::list_runs(&pool, &note_id).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// An UNLINKED note is not this sweeper's business, however many runs its
    /// repo holds — the milestone is what a ship result reports on.
    #[test]
    fn an_unlinked_note_is_not_swept() {
        let pool = test_pool();
        let tmp = tmp_root("unlinked");
        let root = tmp.to_string_lossy().into_owned();
        let project =
            repo::create_project(&pool, "P", &root, None, None, None, None, None).unwrap();
        repo::create_note(&pool, "just a note", Some(&project.id)).unwrap();
        write_run(&tmp, "2026-09-15-1200", r#"{ "schema_version": 1 }"#);

        assert_eq!(sweep_ship_ingests_core(&pool, &mut |_| {}), 0);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
