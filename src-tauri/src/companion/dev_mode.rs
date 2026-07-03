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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

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

// ── dev-op registry ─────────────────────────────────────────────────────
//
// In-process metadata for in-flight dev_improve operations, keyed by the
// operative-memory op id. The reflection reconciler reads it on op
// completion (workspace to diff, backend → merge handshake) and the
// dev_merge executor consumes it. In-process only: an app restart loses
// the map, matching operative memory itself — the worktree + branch
// survive on disk and can be merged manually, which the reflection card
// mentions. Durable markers are the documented Phase-4 hardening.

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

fn dev_ops() -> &'static Mutex<HashMap<String, DevOpMeta>> {
    static M: OnceLock<Mutex<HashMap<String, DevOpMeta>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn register_dev_op(op_id: &str, meta: DevOpMeta) {
    dev_ops()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(op_id.to_string(), meta);
}

pub fn get_dev_op(op_id: &str) -> Option<DevOpMeta> {
    dev_ops()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(op_id)
        .cloned()
}

pub fn remove_dev_op(op_id: &str) -> Option<DevOpMeta> {
    dev_ops()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(op_id)
}

// ── git helpers (worktree + merge handshake) ────────────────────────────

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

/// The merge half of the handshake: fast-forward the main checkout onto
/// the dev branch, then clean up the worktree. `--ff-only` on purpose —
/// if master moved since the dispatch, we refuse and tell the user to
/// merge manually rather than auto-resolving into their live checkout.
pub fn merge_dev_branch(meta: &DevOpMeta) -> Result<String, String> {
    let root = repo_root();
    let Some(branch) = meta.branch.as_deref() else {
        return Err("this dev op has no worktree branch (frontend run — nothing to merge)".into());
    };
    // Refuse while the session left uncommitted work behind.
    let dirty = run_git(&meta.workspace, &["status", "--porcelain"]).unwrap_or_default();
    if !dirty.trim().is_empty() {
        return Err(format!(
            "worktree has uncommitted changes ({} path(s)) — resolve or commit them first",
            dirty.lines().filter(|l| !l.trim().is_empty()).count()
        ));
    }
    run_git(&root, &["merge", "--ff-only", branch]).map_err(|e| {
        format!(
            "fast-forward merge of `{branch}` failed ({e}). The main checkout has probably \
             moved since the dispatch — merge manually (`git merge {branch}`), then remove \
             the worktree."
        )
    })?;
    let sha = run_git(&root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();
    // Cleanup is best-effort — a failure leaves a stale worktree, not a
    // broken merge. Plain remove (no --force): a dirty tree was already
    // refused above.
    let mut notes = String::new();
    if let Err(e) = run_git(&root, &["worktree", "remove", &meta.workspace.to_string_lossy()]) {
        notes.push_str(&format!("\n⚠ worktree remove failed: {e}"));
    }
    if let Err(e) = run_git(&root, &["branch", "-d", branch]) {
        notes.push_str(&format!("\n⚠ branch delete failed: {e}"));
    }
    Ok(format!("merged `{branch}` → `{sha}`{notes}"))
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

    #[test]
    fn dev_op_registry_roundtrip() {
        let meta = DevOpMeta {
            request: "r".into(),
            backend: true,
            workspace: PathBuf::from("."),
            branch: Some("athena-dev-x".into()),
            fleet_session_id: "s".into(),
        };
        register_dev_op("op-test-roundtrip", meta);
        assert!(get_dev_op("op-test-roundtrip").is_some());
        assert!(remove_dev_op("op-test-roundtrip").is_some());
        assert!(get_dev_op("op-test-roundtrip").is_none());
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
