//! DEV MODE — Athena's self-development loop (debug builds only).
//!
//! When the wrench toggle in the companion header is on (and this is a
//! debug build), Athena treats the running app's own source checkout as
//! a workspace: her prompt gains a self-model addendum with the project
//! context-map index so feature-talk resolves to code areas, and she may
//! propose `dev_improve` dispatches — coding CLI sessions at the repo
//! root, always approval-gated (they never auto-fire), with a reflection
//! turn after each run and a merge handshake for backend work.
//!
//! Design: docs/tests/athena/dev-mode-direction.md. This module owns the
//! pieces shared by the prompt assembler (addendum) and the `dev_improve`
//! executor (repo root + context resolution): keeping them together means
//! the paths Athena is *taught* and the paths the executor *resolves*
//! can't drift apart.

use std::path::PathBuf;

use crate::db::DbPool;

/// The repo root of the source checkout this binary was built from.
/// Compile-time derived (CARGO_MANIFEST_DIR/..) — correct exactly in the
/// dev-build-from-checkout scenario dev mode is gated to, and mirrors
/// `dev_session::resolve_repo_root` (the retired wrench-send pipeline).
pub fn repo_root() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
}

/// One resolved context from `context-map.json`.
pub struct ResolvedContext {
    pub name: String,
    pub group: String,
    pub description: String,
    pub file_paths: Vec<String>,
}

fn load_context_map() -> Option<serde_json::Value> {
    let path = repo_root().join("context-map.json");
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Resolve a context slug (the `name` field, e.g. `agent-connectors`)
/// to its file list + description. Used by the `dev_improve` executor so
/// the dispatched coding session gets DETERMINISTIC paths from the map,
/// never model-recalled ones. Slug matching is case-insensitive.
pub fn resolve_context(slug: &str) -> Option<ResolvedContext> {
    let map = load_context_map()?;
    let contexts = map.get("contexts")?.as_array()?;
    let want = slug.trim().to_ascii_lowercase();
    contexts.iter().find_map(|c| {
        let name = c.get("name")?.as_str()?;
        if name.to_ascii_lowercase() != want {
            return None;
        }
        Some(ResolvedContext {
            name: name.to_string(),
            group: c
                .get("group")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            description: c
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            file_paths: c
                .get("file_paths")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|p| p.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
        })
    })
}

/// Compact one-line-per-context index for the prompt addendum. ~49 lines;
/// descriptions clipped so the whole block stays cheap. Returns `None`
/// when context-map.json is missing/unparseable (the addendum degrades
/// gracefully — Athena can still dispatch with `files_hint` only).
pub fn context_map_index() -> Option<String> {
    let map = load_context_map()?;
    let contexts = map.get("contexts")?.as_array()?;
    let mut out = String::new();
    for c in contexts {
        let (Some(name), Some(group)) = (
            c.get("name").and_then(|v| v.as_str()),
            c.get("group").and_then(|v| v.as_str()),
        ) else {
            continue;
        };
        let desc = c
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let clipped = clip_sentence(desc, 110);
        out.push_str(&format!("- `{name}` ({group}): {clipped}\n"));
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

// ── dev-op ledger (durable, Phase 4) ────────────────────────────────────
//
// One `companion_dev_op` row per dev_improve operation, keyed by the
// operative-memory op id. Durable on purpose: backend work inherently
// causes an app restart (merge → dev-server rebuild), and the in-process
// registry this replaced lost the merge handshake across exactly that
// restart. The reflection reconciler reads a row on op completion, the
// dev_merge executor consumes it, boot recovery sweeps orphaned rows,
// and Phase 5 reads the same table as the experiment ledger.
//
// Status lifecycle: dispatched → completed (session exited, reflection
// spawned; backend rows await the merge handshake) → merged | closed;
// `interrupted` marks a dispatched row whose session died with an app
// restart (workspace + branch survive on disk).

#[derive(Debug, Clone)]
pub struct DevOpMeta {
    /// The improvement request, verbatim from the approved dispatch.
    pub request: String,
    /// True = Rust/src-tauri work → isolated worktree + merge handshake.
    pub backend: bool,
    /// Where the coding session works (repo root, or the worktree).
    pub workspace: PathBuf,
    /// Worktree branch name (backend runs only).
    pub branch: Option<String>,
    /// The fleet session driving the change.
    pub fleet_session_id: String,
}

pub fn register_dev_op(
    pool: &crate::db::UserDbPool,
    op_id: &str,
    meta: &DevOpMeta,
) -> Result<(), crate::error::AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_dev_op (op_id, request, backend, workspace, branch, fleet_session_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            op_id,
            meta.request,
            meta.backend as i32,
            meta.workspace.to_string_lossy(),
            meta.branch,
            meta.fleet_session_id,
        ],
    )?;
    Ok(())
}

fn row_to_meta(row: &rusqlite::Row<'_>) -> rusqlite::Result<DevOpMeta> {
    Ok(DevOpMeta {
        request: row.get("request")?,
        backend: row.get::<_, i32>("backend")? != 0,
        workspace: PathBuf::from(row.get::<_, String>("workspace")?),
        branch: row.get("branch")?,
        fleet_session_id: row.get("fleet_session_id")?,
    })
}

/// Fetch a dev op regardless of status (callers gate on their own
/// preconditions — dev_merge's real guards are the dirty-tree check and
/// the ff-only merge, not the status token). Best-effort `None` on any
/// DB error.
pub fn get_dev_op(pool: &crate::db::UserDbPool, op_id: &str) -> Option<DevOpMeta> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT request, backend, workspace, branch, fleet_session_id
         FROM companion_dev_op WHERE op_id = ?1",
        rusqlite::params![op_id],
        |row| row_to_meta(row),
    )
    .ok()
}

/// Advance a dev op's status (best-effort — a miss is a warn, never a
/// blocker). Terminal statuses stamp `finished_at`; a Some(commit) also
/// records the run's resulting commit for the ledger.
pub fn mark_dev_op(
    pool: &crate::db::UserDbPool,
    op_id: &str,
    status: &str,
    commit_sha: Option<&str>,
) {
    let Ok(conn) = pool.get() else { return };
    let finished = matches!(status, "completed" | "merged" | "closed" | "interrupted");
    let res = conn.execute(
        "UPDATE companion_dev_op
         SET status = ?2,
             commit_sha = COALESCE(?3, commit_sha),
             finished_at = CASE WHEN ?4 THEN datetime('now') ELSE finished_at END
         WHERE op_id = ?1",
        rusqlite::params![op_id, status, commit_sha, finished],
    );
    if let Err(e) = res {
        tracing::warn!(op_id, status, error = %e, "dev_mode: mark_dev_op failed");
    }
}

/// All rows still in `dispatched` — after an app restart these are
/// orphans (fleet PTY children die with the process). Boot recovery
/// sweeps them into `interrupted` + a proactive card.
pub fn list_dispatched_dev_ops(pool: &crate::db::UserDbPool) -> Vec<(String, DevOpMeta)> {
    let Ok(conn) = pool.get() else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT op_id, request, backend, workspace, branch, fleet_session_id
         FROM companion_dev_op WHERE status = 'dispatched' ORDER BY created_at ASC",
    ) else {
        return Vec::new();
    };
    stmt.query_map([], |row| Ok((row.get::<_, String>("op_id")?, row_to_meta(row)?)))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// The workspace's current HEAD short SHA — the run's resulting commit
/// for the ledger. Best-effort.
pub fn latest_commit_short(workspace: &std::path::Path) -> Option<String> {
    run_git(workspace, &["log", "-1", "--format=%h"]).ok().filter(|s| !s.is_empty())
}

// ── experiment harness (Phase 5) ────────────────────────────────────────
//
// The same `companion_dev_op` table doubles as the experiment ledger: the
// UI reads recent rows + aggregate metrics, and the user rates each run
// (`user_verdict` = "up" | "down"). Over days of use this is the signal
// that tells whether dev mode is actually earning its keep — dispatch→
// commit rate, rescue rate, and the thumbs ratio.

/// One row for the ledger UI. Superset of [`DevOpMeta`] with the lifecycle
/// columns the meta struct omits (status, verdict, timestamps).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOpLedgerEntry {
    pub op_id: String,
    pub request: String,
    pub backend: bool,
    pub status: String,
    pub commit_sha: Option<String>,
    pub branch: Option<String>,
    /// `"up"` | `"down"` | `None` (unrated).
    pub user_verdict: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

/// Aggregate counters over the whole ledger — the experiment scoreboard.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOpMetrics {
    /// Every dispatch ever logged.
    pub total: u32,
    /// Still `dispatched` (a session in flight, or an unswept orphan).
    pub in_flight: u32,
    /// Backend runs applied to the live checkout via the merge handshake.
    pub merged: u32,
    /// Frontend runs that finished (main-checkout edits, no merge step).
    pub closed: u32,
    /// Runs an app restart killed mid-flight (needed rescue).
    pub interrupted: u32,
    /// Rows that landed a commit (`commit_sha` present) — dispatch→commit.
    pub landed_commit: u32,
    pub thumbs_up: u32,
    pub thumbs_down: u32,
}

/// The combined ledger payload the UI fetches in one call.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOpLedger {
    pub entries: Vec<DevOpLedgerEntry>,
    pub metrics: DevOpMetrics,
}

/// Recent dev ops, newest first, capped at `limit`. Best-effort — an
/// empty vec on any DB error.
pub fn list_dev_ops(pool: &crate::db::UserDbPool, limit: u32) -> Vec<DevOpLedgerEntry> {
    let Ok(conn) = pool.get() else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT op_id, request, backend, status, commit_sha, branch, user_verdict,
                created_at, finished_at
         FROM companion_dev_op ORDER BY created_at DESC, rowid DESC LIMIT ?1",
    ) else {
        return Vec::new();
    };
    stmt.query_map(rusqlite::params![limit], |row| {
        Ok(DevOpLedgerEntry {
            op_id: row.get("op_id")?,
            request: row.get("request")?,
            backend: row.get::<_, i32>("backend")? != 0,
            status: row.get("status")?,
            commit_sha: row.get("commit_sha")?,
            branch: row.get("branch")?,
            user_verdict: row.get("user_verdict")?,
            created_at: row.get("created_at")?,
            finished_at: row.get("finished_at")?,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

/// Aggregate scoreboard over the whole table. Best-effort — a zeroed
/// [`DevOpMetrics`] on any DB error.
pub fn dev_op_metrics(pool: &crate::db::UserDbPool) -> DevOpMetrics {
    let Ok(conn) = pool.get() else {
        return DevOpMetrics::default();
    };
    conn.query_row(
        "SELECT
            COUNT(*),
            SUM(status = 'dispatched'),
            SUM(status = 'merged'),
            SUM(status = 'closed'),
            SUM(status = 'interrupted'),
            SUM(commit_sha IS NOT NULL),
            SUM(user_verdict = 'up'),
            SUM(user_verdict = 'down')
         FROM companion_dev_op",
        [],
        |row| {
            // SUM over an empty set is NULL → default 0.
            let g = |i: usize| -> u32 { row.get::<_, Option<i64>>(i).ok().flatten().unwrap_or(0).max(0) as u32 };
            Ok(DevOpMetrics {
                total: g(0),
                in_flight: g(1),
                merged: g(2),
                closed: g(3),
                interrupted: g(4),
                landed_commit: g(5),
                thumbs_up: g(6),
                thumbs_down: g(7),
            })
        },
    )
    .unwrap_or_default()
}

/// Record (or clear) the user's verdict on a dev op. `verdict` must be
/// `"up"`, `"down"`, or `None` to clear. Rejects anything else so the UI
/// can't write a junk token the metrics query then ignores.
pub fn set_verdict(
    pool: &crate::db::UserDbPool,
    op_id: &str,
    verdict: Option<&str>,
) -> Result<(), crate::error::AppError> {
    if let Some(v) = verdict {
        if v != "up" && v != "down" {
            return Err(crate::error::AppError::Validation(format!(
                "dev op verdict must be \"up\", \"down\", or null (got {v:?})"
            )));
        }
    }
    let conn = pool.get()?;
    let n = conn.execute(
        "UPDATE companion_dev_op SET user_verdict = ?2 WHERE op_id = ?1",
        rusqlite::params![op_id, verdict],
    )?;
    if n == 0 {
        return Err(crate::error::AppError::Validation(format!(
            "no dev op row matches `{op_id}`"
        )));
    }
    Ok(())
}

/// Boot recovery (Phase 4): rows still `dispatched` at startup are
/// orphans — fleet PTY children die with the app process, so their
/// sessions are gone but the workspace (and a backend run's branch +
/// commits) survive on disk. Mark them `interrupted` and surface one
/// proactive card per op telling the user what survived and what their
/// options are. The `(kind, ref=op_id)` dedupe makes a re-fire across
/// boots harmless. Returns the number of ops swept.
pub fn recover_interrupted_dev_ops(
    pool: &crate::db::UserDbPool,
    app: &tauri::AppHandle,
) -> usize {
    let orphans = list_dispatched_dev_ops(pool);
    if orphans.is_empty() {
        return 0;
    }
    // Liveness check — live-caught defect 2026-07-04: companion_init can
    // re-run while a dispatched session is STILL WORKING (panel remount /
    // page reload re-invokes it), and the first sweep marked a 5-second-old
    // op `interrupted` mid-run. A session present in the fleet registry is
    // not an orphan, whatever the ledger row says.
    let live: std::collections::HashSet<String> = crate::commands::fleet::registry::registry()
        .list_dto()
        .into_iter()
        .map(|s| s.id)
        .collect();
    let mut swept = 0;
    for (op_id, meta) in orphans {
        if live.contains(&meta.fleet_session_id) {
            continue;
        }
        // Capture what survived before flipping the status.
        let commit = latest_commit_short(&meta.workspace);
        mark_dev_op(pool, &op_id, "interrupted", commit.as_deref());
        swept += 1;

        let req_clip: String = {
            let mut s: String = meta.request.chars().take(90).collect();
            if meta.request.chars().count() > 90 {
                s.push('…');
            }
            s
        };
        let survives = if meta.backend {
            format!(
                "Its worktree survives at `{}` (branch `{}`{}) — if the work was committed, \
                 the dev_merge handshake still applies it (op_id `{op_id}`); otherwise \
                 redispatch or remove the worktree.",
                meta.workspace.to_string_lossy(),
                meta.branch.as_deref().unwrap_or("?"),
                match &commit {
                    Some(c) => format!(", HEAD `{c}`"),
                    None => String::new(),
                },
            )
        } else {
            "It ran in the main checkout — any edits it made are still in the working tree \
             (uncommitted work shows in `git status`); redispatch if the change didn't land."
                .to_string()
        };
        let nudge = crate::companion::proactive::Nudge {
            trigger_kind: "dev_interrupted".to_string(),
            trigger_ref: Some(op_id.clone()),
            message: format!(
                "Dev run “{req_clip}” was interrupted by an app restart — its coding session \
                 died with the process. {survives}"
            ),
        };
        match crate::companion::proactive::enqueue_external(pool, &nudge) {
            Ok(Some(msg)) => {
                if let Err(e) = crate::companion::proactive::mark_delivered(pool, &msg.id) {
                    tracing::warn!(id = %msg.id, error = %e, "dev recovery: mark_delivered failed");
                }
                let delivered = crate::companion::proactive::ProactiveMessage {
                    status: "delivered".into(),
                    ..msg
                };
                let payload = crate::commands::companion::proactive::ProactiveDelivery {
                    messages: vec![delivered],
                };
                use tauri::Emitter;
                if let Err(e) = app.emit(
                    crate::commands::companion::proactive::PROACTIVE_EVENT,
                    payload,
                ) {
                    tracing::warn!(error = %e, op_id = %op_id, "dev recovery: proactive emit failed");
                }
            }
            Ok(None) => {} // deduped — already surfaced for this op
            Err(e) => tracing::warn!(error = %e, op_id = %op_id, "dev recovery: enqueue failed"),
        }
    }
    if swept > 0 {
        tracing::info!(swept, "dev_mode: swept interrupted dev op(s) at boot");
    }
    swept
}

/// Containment prerequisite, self-healing: `validate_fleet_cwd` requires
/// the repo to be a registered Dev Tools project before a dev session may
/// be dispatched into it. Called from the addendum path (i.e. whenever
/// dev mode is actually in use) so the user never hits the unregistered
/// footgun mid-conversation. Idempotent — one SELECT when already
/// registered. Best-effort: registration failure only warns; the
/// executor's validate still errors clearly at dispatch time.
pub fn ensure_repo_registered(sys_db: &DbPool) {
    let root = repo_root();
    let root_str = root.to_string_lossy().to_string();
    match crate::db::repos::dev_tools::get_project_by_path(sys_db, &root_str) {
        Ok(Some(_)) => {}
        Ok(None) => {
            match crate::db::repos::dev_tools::create_project(
                sys_db,
                "personas",
                &root_str,
                Some("Personas desktop app — auto-registered by Athena dev mode (containment for dev_improve dispatches)"),
                None,
                None,
                None,
                None,
            ) {
                Ok(p) => tracing::info!(project_id = %p.id, "dev_mode: auto-registered the app repo as a Dev Tools project"),
                Err(e) => tracing::warn!(error = %e, "dev_mode: repo auto-registration failed"),
            }
        }
        Err(e) => tracing::warn!(error = %e, "dev_mode: project lookup failed"),
    }
}

// ── git helpers (worktree + merge handshake) ────────────────────────────

/// Run `git -C <cwd>` with the given args and capture its output.
///
/// On success (zero exit status) returns the trimmed stdout. On failure
/// returns an `Err` whose string prefers the trimmed stderr, falling back
/// to the trimmed stdout when stderr is empty. A failure to spawn `git`
/// itself surfaces as an `Err` describing the spawn error.
fn run_git(cwd: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|e| format!("git spawn failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// Create an isolated worktree for a backend dev run. Branch + dir both
/// `athena-dev-<id>`; the dir lives under `.claude/worktrees/` (inside
/// the repo root, so fleet cwd containment still passes). Never touches
/// the main checkout's working tree.
pub fn create_dev_worktree(id: &str) -> Result<(PathBuf, String), String> {
    let root = repo_root();
    let branch = format!("athena-dev-{id}");
    let rel = format!(".claude/worktrees/athena-dev-{id}");
    let path = root.join(&rel);
    if path.exists() {
        return Err(format!("worktree dir already exists: {rel}"));
    }
    run_git(&root, &["worktree", "add", &rel, "-b", &branch])
        .map_err(|e| format!("git worktree add failed: {e}"))?;
    Ok((path, branch))
}

/// Recent-work evidence for the reflection turn: last commits (+stat)
/// and whether the tree was left dirty. Best-effort — a git failure
/// yields a note instead of blocking the reflection.
pub fn workspace_evidence(workspace: &std::path::Path) -> String {
    let log = run_git(workspace, &["log", "--oneline", "--stat", "-3"])
        .unwrap_or_else(|e| format!("(git log unavailable: {e})"));
    let dirty = run_git(workspace, &["status", "--porcelain"])
        .map(|s| {
            let n = s.lines().filter(|l| !l.trim().is_empty()).count();
            if n == 0 {
                "clean (all work committed)".to_string()
            } else {
                format!("{n} uncommitted path(s) left in the tree")
            }
        })
        .unwrap_or_else(|e| format!("(git status unavailable: {e})"));
    format!("Recent commits:\n{log}\n\nWorking tree: {dirty}")
}

/// Node-tooling lockfiles a dispatched session's `npx`/`npm`/`pnpm` can
/// rewrite as a side effect — noise, not the change under review. The
/// merge path restores them to HEAD before judging the tree dirty (live
/// finding 2026-07-04: a run's `npx` drifted the worktree lockfile and
/// blocked the handshake).
const LOCKFILE_NOISE: &[&str] = &["pnpm-lock.yaml", "package-lock.json", "yarn.lock"];

/// Restore any drifted lockfile-noise paths in `workspace` to their
/// committed HEAD state (index + working tree). Best-effort and idempotent:
/// `git checkout HEAD -- <f>` is a no-op when the file is unchanged and
/// errors (ignored) when it doesn't exist. Committed lockfile changes are
/// untouched — this only discards *uncommitted* drift.
fn restore_lockfile_noise(workspace: &std::path::Path) {
    for f in LOCKFILE_NOISE {
        let _ = run_git(workspace, &["checkout", "HEAD", "--", f]);
    }
}

/// How many commits `tip` is ahead of `base` (`git rev-list --count
/// base..tip`). `None` on any git failure — callers treat that as "don't
/// know, don't auto-apply".
fn commits_ahead(cwd: &std::path::Path, base: &str, tip: &str) -> Option<usize> {
    run_git(cwd, &["rev-list", "--count", &format!("{base}..{tip}")])
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

/// The merge half of the handshake: apply the dev branch to the main
/// checkout, then clean up the worktree. Thin wrapper over
/// [`apply_dev_branch`] with the real repo root; kept separate so the
/// apply logic is testable against a throwaway repo.
pub fn merge_dev_branch(meta: &DevOpMeta) -> Result<String, String> {
    let Some(branch) = meta.branch.as_deref() else {
        return Err("this dev op has no worktree branch (frontend run — nothing to merge)".into());
    };
    apply_dev_branch(&repo_root(), &meta.workspace, branch)
}

/// Apply `branch` (checked out in `workspace`, a worktree under `root`)
/// onto `root`'s live HEAD, then remove the worktree + branch.
///
/// Strategy: fast-forward when master hasn't moved since the dispatch
/// (the clean case). When master has diverged — the COMMON case in this
/// repo, where parallel sessions move master constantly — fall back to a
/// **cherry-pick** IFF the branch is exactly one commit ahead of the live
/// checkout (a focused dev run). Anything larger stays a manual merge so
/// we never auto-resolve a nontrivial history into the user's tree. A
/// cherry-pick conflict aborts cleanly and refuses with guidance.
///
/// Lockfile-noise drift in the worktree is restored to HEAD first, so a
/// session's `npx` side effects don't masquerade as uncommitted work.
pub fn apply_dev_branch(
    root: &std::path::Path,
    workspace: &std::path::Path,
    branch: &str,
) -> Result<String, String> {
    // Tolerate node-tooling lockfile drift before judging the tree dirty.
    restore_lockfile_noise(workspace);

    // Refuse while the session left REAL uncommitted work behind.
    let dirty = run_git(workspace, &["status", "--porcelain"]).unwrap_or_default();
    if !dirty.trim().is_empty() {
        return Err(format!(
            "worktree has uncommitted changes ({} path(s)) — resolve or commit them first:\n{}",
            dirty.lines().filter(|l| !l.trim().is_empty()).count(),
            dirty.trim(),
        ));
    }

    // Fast-forward is the clean case (master unmoved since dispatch).
    let strategy = match run_git(root, &["merge", "--ff-only", branch]) {
        Ok(_) => "fast-forward",
        Err(ff_err) => match commits_ahead(root, "HEAD", branch) {
            // Focused single-commit run → cherry-pick onto the moved master.
            Some(1) => {
                apply_single_commit(root, branch).map_err(|e| {
                    format!(
                        "fast-forward failed ({ff_err}) and the cherry-pick fallback also \
                         failed ({e}). Merge manually at the repo root (`git merge {branch}`, \
                         or `git cherry-pick <sha>`), then remove the worktree."
                    )
                })?;
                "cherry-pick"
            }
            // Zero commits (nothing to apply) or many (too much to auto-apply).
            other => {
                let n = other.map(|n| n.to_string()).unwrap_or_else(|| "?".into());
                return Err(format!(
                    "fast-forward merge of `{branch}` failed ({ff_err}) and the branch is {n} \
                     commit(s) ahead of the live checkout — {}. The main checkout moved since \
                     the dispatch; merge manually (`git merge {branch}`), then remove the \
                     worktree.",
                    if other == Some(0) {
                        "nothing to apply"
                    } else {
                        "too much to auto-apply safely"
                    }
                ));
            }
        },
    };

    let sha = run_git(root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();
    // Cleanup is best-effort — a failure leaves a stale worktree, not a
    // broken merge. A cherry-pick leaves the branch un-merged from git's
    // view (new commit ≠ branch tip), so force-delete in that case only.
    let mut notes = String::new();
    if let Err(e) = run_git(root, &["worktree", "remove", &workspace.to_string_lossy()]) {
        notes.push_str(&format!("\n⚠ worktree remove failed: {e}"));
    }
    let del_flag = if strategy == "cherry-pick" { "-D" } else { "-d" };
    if let Err(e) = run_git(root, &["branch", del_flag, branch]) {
        notes.push_str(&format!("\n⚠ branch delete failed: {e}"));
    }
    Ok(format!("applied `{branch}` → `{sha}` ({strategy}){notes}"))
}

/// Cherry-pick `branch`'s tip commit onto the live HEAD. On conflict,
/// abort so the working tree is left clean (no half-applied pick).
fn apply_single_commit(root: &std::path::Path, branch: &str) -> Result<(), String> {
    match run_git(root, &["cherry-pick", branch]) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = run_git(root, &["cherry-pick", "--abort"]);
            Err(e)
        }
    }
}

/// Task prompt for the dispatched coding session. Assembled Rust-side so
/// the paths come deterministically from the context map (never from the
/// model's memory of the codebase).
pub fn build_task_prompt(
    request: &str,
    context: Option<&ResolvedContext>,
    files_hint: Option<&str>,
    backend: bool,
) -> String {
    let mut p = String::new();
    p.push_str(
        "You are a coding agent working on the Personas desktop app — dispatched by Athena, \
         the app's companion, at the user's approval. Implement the change below: focused, \
         minimal, aligned with the conventions in this repo's CLAUDE.md.\n\n",
    );
    p.push_str(&format!("## The change\n\n{request}\n\n"));
    if let Some(ctx) = context {
        p.push_str(&format!(
            "## Where (from the project context map — start here, verify by reading)\n\nContext `{}` ({}): {}\n",
            ctx.name, ctx.group, ctx.description
        ));
        if !ctx.file_paths.is_empty() {
            const CAP: usize = 40;
            p.push_str("\nFiles in this context:\n");
            for f in ctx.file_paths.iter().take(CAP) {
                p.push_str(&format!("- {f}\n"));
            }
            if ctx.file_paths.len() > CAP {
                p.push_str(&format!("- …and {} more\n", ctx.file_paths.len() - CAP));
            }
        }
        p.push('\n');
    }
    if let Some(hint) = files_hint.filter(|h| !h.trim().is_empty()) {
        p.push_str(&format!("Additional hint from Athena: {hint}\n\n"));
    }
    p.push_str(
        "## Discipline\n\n\
         - Read the relevant files before editing; keep the change scoped to what was asked.\n\
         - Commit your work as one or more atomic commits with clear messages. NEVER push, \
         never `git stash`, never `git add -A` — stage the specific files you changed.\n\
         - Don't run full test suites or rebuild the app; targeted checks (a single test, \
         `npx tsc --noEmit`) are fine if quick.\n\
         - If the request is unclear or riskier than it looks, implement the smallest safe \
         first step and say what you'd do next — don't guess big.\n\
         - Finish with a 2-4 sentence summary: what changed, which files, anything the \
         reviewer should look at.\n\
         - Then END THE SESSION: run /exit as your final action. You are an unattended \
         dispatch — a session left open parks as awaiting-input and stalls the reflection \
         that reports your work. (Live finding 2026-07-04: the first dispatched session sat \
         open 10+ minutes after committing.)\n",
    );
    if backend {
        p.push_str(
            "\nYou are in an ISOLATED GIT WORKTREE — the running app is not affected by your \
             edits. Your commits stay on this branch until the user approves the merge, so \
             commit everything before finishing (uncommitted work blocks the merge).\n",
        );
    } else {
        p.push_str(
            "\nYou are in the LIVE checkout of a running dev app: frontend edits hot-reload \
             immediately. Stay within `src/` (frontend) — if the change turns out to need \
             Rust/`src-tauri` edits, STOP and report that instead of editing (backend \
             changes go through an isolated worktree dispatch).\n",
        );
    }
    p
}

/// First sentence, or a char-boundary-safe prefix with an ellipsis.
fn clip_sentence(s: &str, max: usize) -> String {
    let first = s.split_once(". ").map(|(a, _)| a).unwrap_or(s);
    if first.chars().count() <= max {
        first.to_string()
    } else {
        let mut out: String = first.chars().take(max).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_sentence_takes_first_sentence_and_respects_char_boundaries() {
        assert_eq!(clip_sentence("Short. Rest is dropped.", 100), "Short");
        // Multi-byte safety: clipping must land on a char boundary.
        let long = "č".repeat(200);
        let clipped = clip_sentence(&long, 10);
        assert_eq!(clipped.chars().count(), 11); // 10 + ellipsis
    }

    #[test]
    fn context_index_and_resolution_read_the_real_map() {
        // The repo's own context-map.json is the fixture — the module is
        // dev-build-only, so the checkout is guaranteed present.
        let idx = context_map_index().expect("context-map.json should parse");
        assert!(idx.lines().count() >= 20, "expected a rich context index");
        // Every line is the compact `- \`slug\` (Group): desc` shape.
        assert!(idx.lines().all(|l| l.starts_with("- `")));

        // Resolve the first slug listed in the index round-trip.
        let first_slug = idx
            .lines()
            .next()
            .and_then(|l| l.split('`').nth(1))
            .expect("index line carries a slug");
        let ctx = resolve_context(first_slug).expect("index slug must resolve");
        assert!(!ctx.file_paths.is_empty(), "resolved context lists files");
        // Case-insensitive matching.
        assert!(resolve_context(&first_slug.to_ascii_uppercase()).is_some());
        assert!(resolve_context("no-such-context-slug").is_none());
    }

    #[test]
    fn task_prompt_encodes_the_workspace_policy() {
        let backend = build_task_prompt("Fix the thing", None, None, true);
        assert!(backend.contains("ISOLATED GIT WORKTREE"));
        assert!(backend.contains("NEVER push"));
        let frontend = build_task_prompt("Fix the thing", None, Some("src/App.tsx"), false);
        assert!(frontend.contains("LIVE checkout"));
        assert!(frontend.contains("src/App.tsx"));
        // Frontend runs must be told to STOP on Rust scope creep.
        assert!(frontend.contains("STOP and report"));
        // Both must self-terminate — an open interactive session parks as
        // awaiting-input and stalls the reflection (live finding 2026-07-04).
        assert!(backend.contains("/exit"));
        assert!(frontend.contains("/exit"));
    }

    fn test_pool() -> crate::db::UserDbPool {
        use r2d2_sqlite::SqliteConnectionManager;
        let manager = SqliteConnectionManager::memory();
        let pool = r2d2::Pool::builder().max_size(1).build(manager).unwrap();
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE companion_dev_op (
                    op_id            TEXT PRIMARY KEY,
                    request          TEXT NOT NULL,
                    backend          INTEGER NOT NULL DEFAULT 1,
                    workspace        TEXT NOT NULL,
                    branch           TEXT,
                    fleet_session_id TEXT NOT NULL,
                    status           TEXT NOT NULL DEFAULT 'dispatched',
                    commit_sha       TEXT,
                    user_verdict     TEXT,
                    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
                    finished_at      TEXT
                );",
            )
            .unwrap();
        pool
    }

    #[test]
    fn dev_op_ledger_roundtrip_and_lifecycle() {
        let pool = test_pool();
        let meta = DevOpMeta {
            request: "r".into(),
            backend: true,
            workspace: PathBuf::from("."),
            branch: Some("athena-dev-x".into()),
            fleet_session_id: "s".into(),
        };
        register_dev_op(&pool, "op-1", &meta).unwrap();
        let got = get_dev_op(&pool, "op-1").expect("row lands");
        assert!(got.backend);
        assert_eq!(got.branch.as_deref(), Some("athena-dev-x"));

        // dispatched rows show up for boot recovery…
        assert_eq!(list_dispatched_dev_ops(&pool).len(), 1);
        // …until a status transition takes them out of the sweep.
        mark_dev_op(&pool, "op-1", "completed", Some("abc1234"));
        assert!(list_dispatched_dev_ops(&pool).is_empty());
        // Meta stays fetchable after completion — dev_merge reads it
        // across the restart window.
        assert!(get_dev_op(&pool, "op-1").is_some());
        // COALESCE keeps the recorded commit when a later mark passes None.
        mark_dev_op(&pool, "op-1", "merged", None);
        let conn = pool.get().unwrap();
        let (status, sha): (String, Option<String>) = conn
            .query_row(
                "SELECT status, commit_sha FROM companion_dev_op WHERE op_id='op-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "merged");
        assert_eq!(sha.as_deref(), Some("abc1234"));
    }

    #[test]
    fn ledger_metrics_verdict_and_ordering() {
        let pool = test_pool();
        let meta = |backend: bool| DevOpMeta {
            request: "r".into(),
            backend,
            workspace: PathBuf::from("."),
            branch: backend.then(|| "athena-dev-x".into()),
            fleet_session_id: "s".into(),
        };
        // a: backend, merged w/ commit · b: frontend, closed w/ commit ·
        // c: backend, still dispatched (in flight, no commit).
        register_dev_op(&pool, "a", &meta(true)).unwrap();
        mark_dev_op(&pool, "a", "merged", Some("aaa1111"));
        register_dev_op(&pool, "b", &meta(false)).unwrap();
        mark_dev_op(&pool, "b", "closed", Some("bbb2222"));
        register_dev_op(&pool, "c", &meta(true)).unwrap();

        let m = dev_op_metrics(&pool);
        assert_eq!(m.total, 3);
        assert_eq!(m.merged, 1);
        assert_eq!(m.closed, 1);
        assert_eq!(m.in_flight, 1);
        assert_eq!(m.interrupted, 0);
        assert_eq!(m.landed_commit, 2);

        set_verdict(&pool, "a", Some("up")).unwrap();
        set_verdict(&pool, "b", Some("down")).unwrap();
        assert!(set_verdict(&pool, "a", Some("meh")).is_err(), "junk token rejected");
        assert!(set_verdict(&pool, "ghost", Some("up")).is_err(), "no-row rejected");
        // Clearing back to null is allowed.
        set_verdict(&pool, "b", None).unwrap();

        let m = dev_op_metrics(&pool);
        assert_eq!(m.thumbs_up, 1);
        assert_eq!(m.thumbs_down, 0);

        // Newest-first, capped; ties broken by insert order (rowid).
        let list = list_dev_ops(&pool, 2);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].op_id, "c", "most-recent insert leads");
        let a = list_dev_ops(&pool, 10)
            .into_iter()
            .find(|e| e.op_id == "a")
            .unwrap();
        assert_eq!(a.user_verdict.as_deref(), Some("up"));
        assert_eq!(a.status, "merged");
        assert_eq!(a.commit_sha.as_deref(), Some("aaa1111"));
        assert!(a.backend);
    }

    // ── git-backed merge-strategy tests (temp throwaway repos) ──────────

    static SCRATCH_N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn t_commit(cwd: &std::path::Path, msg: &str) {
        run_git(
            cwd,
            &[
                "-c",
                "user.email=dev@test",
                "-c",
                "user.name=dev",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-m",
                msg,
            ],
        )
        .expect("commit");
    }

    /// Fresh repo with an `a.txt` base commit + local identity config.
    fn t_fresh_repo() -> PathBuf {
        let n = SCRATCH_N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("personas-devmerge-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.email", "dev@test"]).unwrap();
        run_git(&root, &["config", "user.name", "dev"]).unwrap();
        std::fs::write(root.join("a.txt"), "base\n").unwrap();
        run_git(&root, &["add", "a.txt"]).unwrap();
        t_commit(&root, "base");
        root
    }

    /// Add an `athena-dev-t` worktree + one committed dev change to `a.txt`.
    fn t_worktree(root: &std::path::Path) -> (PathBuf, String) {
        let branch = "athena-dev-t".to_string();
        let wt = root.join(".claude/worktrees/athena-dev-t");
        run_git(root, &["worktree", "add", &wt.to_string_lossy(), "-b", &branch]).unwrap();
        std::fs::write(wt.join("a.txt"), "base\ndev-change\n").unwrap();
        run_git(&wt, &["add", "a.txt"]).unwrap();
        t_commit(&wt, "dev change");
        (wt, branch)
    }

    #[test]
    fn apply_dev_branch_fast_forwards_when_master_unmoved() {
        if !git_available() {
            return;
        }
        let root = t_fresh_repo();
        let (wt, branch) = t_worktree(&root);
        let out = apply_dev_branch(&root, &wt, &branch).expect("ff applies");
        assert!(out.contains("fast-forward"), "got: {out}");
        // `.contains` (not byte-equality) — Windows autocrlf may rewrite \n→\r\n.
        assert!(
            std::fs::read_to_string(root.join("a.txt")).unwrap().contains("dev-change"),
            "dev change landed on master"
        );
        assert!(!wt.exists(), "worktree removed");
        assert!(
            run_git(&root, &["rev-parse", "--verify", &branch]).is_err(),
            "branch deleted"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn apply_dev_branch_cherry_picks_when_master_diverged() {
        if !git_available() {
            return;
        }
        let root = t_fresh_repo();
        let (wt, branch) = t_worktree(&root);
        // Diverge master with an independent commit.
        std::fs::write(root.join("b.txt"), "on-master\n").unwrap();
        run_git(&root, &["add", "b.txt"]).unwrap();
        t_commit(&root, "master moves");

        let out = apply_dev_branch(&root, &wt, &branch).expect("cherry-pick applies");
        assert!(out.contains("cherry-pick"), "got: {out}");
        // Both the dev change and the divergent master commit are present.
        assert!(
            std::fs::read_to_string(root.join("a.txt")).unwrap().contains("dev-change"),
            "dev change cherry-picked onto master"
        );
        assert!(root.join("b.txt").exists());
        assert!(!wt.exists(), "worktree removed");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn apply_dev_branch_refuses_multi_commit_divergence() {
        if !git_available() {
            return;
        }
        let root = t_fresh_repo();
        let (wt, branch) = t_worktree(&root);
        // Second dev commit → branch is 2 ahead → not auto-applicable.
        std::fs::write(wt.join("a.txt"), "base\ndev-change\nmore\n").unwrap();
        run_git(&wt, &["add", "a.txt"]).unwrap();
        t_commit(&wt, "second dev change");
        // Diverge master so ff can't apply.
        std::fs::write(root.join("b.txt"), "on-master\n").unwrap();
        run_git(&root, &["add", "b.txt"]).unwrap();
        t_commit(&root, "master moves");

        let err = apply_dev_branch(&root, &wt, &branch).unwrap_err();
        assert!(err.contains("2 commit"), "got: {err}");
        assert!(wt.exists(), "worktree preserved for manual merge");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn apply_dev_branch_refuses_real_uncommitted_work() {
        if !git_available() {
            return;
        }
        let root = t_fresh_repo();
        let (wt, branch) = t_worktree(&root);
        std::fs::write(wt.join("a.txt"), "base\ndev-change\nuncommitted\n").unwrap();
        let err = apply_dev_branch(&root, &wt, &branch).unwrap_err();
        assert!(err.contains("uncommitted"), "got: {err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn apply_dev_branch_tolerates_lockfile_drift() {
        if !git_available() {
            return;
        }
        let root = t_fresh_repo();
        // Track a lockfile at base so it's inherited by the worktree.
        std::fs::write(root.join("pnpm-lock.yaml"), "v1\n").unwrap();
        run_git(&root, &["add", "pnpm-lock.yaml"]).unwrap();
        t_commit(&root, "add lockfile");
        let (wt, branch) = t_worktree(&root);
        // A dispatched session's node tooling drifts the lockfile (uncommitted).
        std::fs::write(wt.join("pnpm-lock.yaml"), "v2-drifted-by-npx\n").unwrap();

        // Drift alone must NOT block the merge — it's restored to HEAD first.
        let out = apply_dev_branch(&root, &wt, &branch).expect("lockfile drift tolerated");
        assert!(out.contains("fast-forward"), "got: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }
}

/// DEV MODE prompt addendum — empty unless the toggle is on AND this is
/// a debug build (`chat::dev_mode_enabled`). Teaches the self-model, the
/// context-map index, and the `dev_improve` op with its ground rules:
/// never auto-fires, checkout policy (frontend → main checkout / backend
/// → worktree + merge handshake), and the post-run reflection contract.
pub fn addendum_if_enabled(sys_db: &DbPool) -> String {
    if !crate::commands::companion::chat::dev_mode_enabled(sys_db) {
        return String::new();
    }
    // Self-healing containment: dev mode in use → the repo must be a
    // registered Dev Tools project or dispatches will bounce.
    ensure_repo_registered(sys_db);
    let root = repo_root();
    let root_str = root.to_string_lossy().replace('\\', "/");
    let index_block = context_map_index()
        .map(|idx| format!("\n## Feature → code map (context index)\n\n{idx}"))
        .unwrap_or_else(|| {
            "\n## Feature → code map\n\n(context-map.json unavailable — dispatch with \
             `files_hint` and let the coding session locate the code.)\n"
                .to_string()
        });

    format!(
        r#"

# DEV MODE — this app is your own code, and you may improve it

Michal flipped the wrench in your header: you are running from your own
source checkout at `{root_str}`. The Personas desktop app — including
you, Athena (the `companion` Rust modules and the companion React
surfaces) — is built from that repo. In this mode his messages will mix
NORMAL requests (answer, act via your usual ops) with DEVELOPMENT
requests: fix a bug he just hit, adjust a feature you two are
discussing, improve your own behavior.

## The dev_improve op

When a message is a development request, propose a coding dispatch:

    OP: {{"op": "propose_action", "action": "dev_improve", "params": {{"request": "<the change, phrased for a coding agent — what/where/acceptance>", "context": "<context slug from the map below, if one fits>", "files_hint": "<optional: specific files/symbols you're confident about>", "backend": <true if the change needs Rust/src-tauri edits, else false>, "confidence": "high|medium|low", "rationale": "<one line: why this change, and why this scope>"}}}}

Ground rules — these are hard policy, not suggestions:
- **Every dev_improve is an approval card.** It NEVER auto-fires, in any
  mode; Michal clicks each dispatch. Frame `request` so it stands alone.
- **One request = one focused change.** If the ask is really a project,
  say so and propose `write_backlog_item` instead — don't dispatch an
  open-ended rewrite.
- **`backend` drives the workspace.** `false` (frontend/`src/**` only):
  the session works in the MAIN checkout and edits go live via hot
  reload — tell Michal to just try it when it lands. `true` (any
  `src-tauri/**` / Rust change): the session works in an ISOLATED git
  worktree so the running app is undisturbed; nothing applies until the
  MERGE HANDSHAKE — after your reflection, Michal explicitly approves
  when to merge + rebuild, so you two synchronize update expectations.
  When unsure, set `backend: true` — the safe side.
- **Reflection is part of every dev operation.** When the dispatched
  session finishes you'll be woken to review what it did (diff summary,
  files, commit). Report the outcome honestly — what changed, risk you
  see, whether to merge (backend) or what to try (frontend). If the run
  failed or drifted from the request, say so plainly and propose the
  next step; never gloss a bad run.
- **Ambiguity check.** If a message could be either a product action or
  a code change ("make the orb bigger" — setting vs code?), ask one
  short clarifying line before proposing the dispatch.
- Requests about *your own* behavior (prompt, memory, proactivity,
  orb) are legitimate dev_improve targets — your code lives in
  `src-tauri/src/companion/**` and `src/features/plugins/companion/**`.

## The merge handshake (backend runs)

A backend run's commits sit on an isolated branch until Michal decides
the moment to apply them. When — after your reflection — he agrees,
propose:

    OP: {{"op": "propose_action", "action": "dev_merge", "params": {{"op_id": "<the dev operation id from the reflection>", "rationale": "<one line: what merging applies>"}}}}

Approving it fast-forwards the live checkout onto the dev branch and
removes the worktree; the dev server rebuild follows, so tell him to
expect an app restart right after. Never propose dev_merge before the
reflection, and never when the run left uncommitted work (the merge
refuses; say what needs resolving instead).
{index_block}"#
    )
}
