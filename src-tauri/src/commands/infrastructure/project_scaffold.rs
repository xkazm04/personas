//! **One-step repository + project creation** — `git init` a new repository in
//! a dedicated folder, scaffold the smallest honest skeleton, and register it
//! as a Personas project assigned to a workspace, in a single unattended call.
//!
//! # Why this exists
//!
//! `POST /dev-tools/projects` registers a directory that **already exists**
//! (`canonical_project_root` refuses anything else), and every `git init` in
//! the tree before this module was test-fixture code. So the Grand
//! Simulation's opening move — an Architect starting from an EMPTY workspace
//! and creating six repositories — had no door: something outside the app had
//! to make the folders first, and nothing tied a folder to a workspace.
//! `docs/architecture/grand-simulation.md` §3 records it as gap **G6**.
//!
//! # Where the repositories go
//!
//! `<root>/<workspace-slug>/<project-name>`, where `root` is, in order:
//!
//! 1. the request's own `root` (an absolute directory the caller names),
//! 2. the `simulation_projects_root` setting,
//! 3. `<app data dir>/sim` — the default, beside the authoring worktrees, for
//!    the same reason they live there: outside every managed repository, so
//!    nothing a scaffold writes can be swept into somebody's `git add -A`.
//!
//! (`PERSONAS_DATA_DIR` overrides the app data dir, exactly as
//! [`crate::commands::infrastructure::dev_tools::authoring_worktrees_root`]
//! honours it, so a parallel test instance scaffolds into its own tree.)
//!
//! # The one git door
//!
//! Every subprocess here goes through [`personas_engine::app_master_gates::git`]
//! — the repo's existing bounded, cwd-scoped git helper that
//! `unattended_worktree` already runs every worktree operation through. There
//! is no `Command::new("git")` in this file.
//!
//! # Idempotency, and what it refuses
//!
//! A target directory that exists and is **not empty** is a refusal (400 with
//! the path) — with one exception: if the folder already carries a
//! `.personas/project.json` that resolves to a real project (or to a project
//! whose old folder is gone, which the marker heals), the call is idempotent
//! and returns **the same project** with `created: false`. That is what
//! `register_project` already does for a re-registration, and refusing it here
//! would make this door less honest than the one it wraps.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use personas_engine::app_master_gates::git;

use crate::db::models::DevProject;
use crate::db::project_identity::{resolve_identity, IdentityResolution};
use crate::db::repos::core::settings as settings_repo;
use crate::db::repos::workspaces::org as ws_repo;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Directory under the app data dir that holds scaffolded repositories when no
/// root is configured. Sibling of `AUTHORING_WORKTREES_DIRNAME`.
pub const SIMULATION_PROJECTS_DIRNAME: &str = "sim";

/// Identity stamped on the scaffold commit when the machine has none
/// configured. An unattended `git commit` with no `user.email` aborts, and
/// aborting a scaffold over a missing global config would be a worse outcome
/// than a commit that says plainly who made it.
const SCAFFOLD_AUTHOR_NAME: &str = "Personas";
const SCAFFOLD_AUTHOR_EMAIL: &str = "personas@localhost";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// The skeleton to write beside the README and `.gitignore`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectTemplate {
    /// README + `.gitignore` only.
    #[default]
    Empty,
    /// `Cargo.toml` + `src/main.rs` — a dependency-free hello server.
    RustService,
    /// `package.json` + `src/index.ts` — a `node:http` hello server.
    NodeService,
    /// `pyproject.toml` + `src/<name>/__init__.py` — an `http.server` hello.
    PythonService,
}

/// The creation request.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRepositoryInput {
    /// A `dev_workspaces` id, or a name. A name that matches no workspace
    /// **creates** one — the Architect starts from an empty app and should not
    /// need a second call to have somewhere to put the first project.
    pub workspace: String,
    /// The repository's folder name and the project's display name.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default, alias = "tech_stack", skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tech_stack: Option<String>,
    /// Defaults to `empty`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub template: Option<ProjectTemplate>,
    /// An absolute directory that replaces the configured simulation root for
    /// this call. The workspace slug and project name are still appended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub root: Option<String>,
}

/// What the call did.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProjectRepository {
    /// The registered row, as `POST /dev-tools/projects` would have returned it.
    pub project: DevProject,
    /// Canonical absolute path of the repository.
    pub repository_path: String,
    /// The workspace the project is now assigned to.
    pub workspace_id: String,
    /// True when this call created the repository. False when the folder
    /// already held a registered project and the call only re-registered and
    /// re-assigned it.
    pub created: bool,
    /// True when this call minted the workspace row.
    pub workspace_created: bool,
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/// Lowercase, ASCII-alphanumeric-or-dash slug of a workspace name, used as the
/// directory between the root and the project. Never empty — a name made
/// entirely of separators falls back to `workspace`, because a slug that
/// collapses to nothing would silently scaffold one level too high.
fn slugify(raw: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true; // leading dashes are suppressed
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "workspace".to_string()
    } else {
        trimmed.to_string()
    }
}

/// A project name has to be usable as ONE directory component: this is the
/// head of a path the caller controls, so it is validated here rather than
/// left to `create_dir_all` to interpret.
fn validate_project_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    personas_core::validation::require_non_empty("name", name)?;
    if name == "." || name == ".." {
        return Err(AppError::Validation(format!(
            "name must be a directory name, not {name:?}"
        )));
    }
    if name.starts_with('.') {
        return Err(AppError::Validation(
            "name cannot start with '.' — a dotted folder is hidden from every listing the \
             project appears in"
                .into(),
        ));
    }
    if let Some(bad) = name
        .chars()
        .find(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || *c < ' ')
    {
        return Err(AppError::Validation(format!(
            "name cannot contain {bad:?} — it is one directory component, not a path"
        )));
    }
    Ok(name.to_string())
}

/// A Python package identifier for `src/<pkg>/__init__.py`.
fn python_package(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    if out.starts_with(|c: char| c.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

// ---------------------------------------------------------------------------
// Where the repositories go
// ---------------------------------------------------------------------------

/// Resolve the root under which repositories are scaffolded. See the module
/// header for the three-step order.
///
/// `app` is consulted ONLY for the last step, which is why the service below
/// takes an already-resolved root: everything downstream of here is testable
/// without a Tauri handle.
fn simulation_projects_root(
    app: &AppHandle,
    pool: &DbPool,
    requested: Option<&str>,
) -> Result<PathBuf, AppError> {
    if let Some(raw) = requested {
        // A `root` that is present but blank is a caller mistake, not "use the
        // default" — those are two different intentions and only one of them
        // was written, so this refuses rather than guessing.
        personas_core::validation::require_non_empty("root", raw)?;
        let p = PathBuf::from(raw.trim());
        if !p.is_absolute() {
            return Err(AppError::Validation(format!(
                "root must be an absolute directory: {raw}"
            )));
        }
        return Ok(p);
    }
    if let Some(configured) = settings_repo::get(pool, settings_keys::SIMULATION_PROJECTS_ROOT)? {
        let t = configured.trim();
        if !t.is_empty() {
            return Ok(PathBuf::from(t));
        }
    }
    if let Ok(dir) = std::env::var("PERSONAS_DATA_DIR") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir.trim()).join(SIMULATION_PROJECTS_DIRNAME));
        }
    }
    app.path()
        .app_data_dir()
        .map(|p| p.join(SIMULATION_PROJECTS_DIRNAME))
        .map_err(|e| AppError::Internal(format!("app data directory unavailable: {e}")))
}

/// Strip the Windows verbatim prefix `canonicalize` prepends — it round-trips
/// through `Path` but leaks into `context-map.json`, `CLAUDE.md` and every UI
/// surface that shows a project path. Same treatment `canonical_project_root`
/// gives the register route's input.
fn canonical_display(path: &Path) -> Result<String, AppError> {
    let p = path
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("canonicalize {}: {e}", path.display())))?;
    let s = p.to_string_lossy().to_string();
    const VERBATIM: &str = "\\\\?\\";
    Ok(s.strip_prefix(VERBATIM).map(str::to_string).unwrap_or(s))
}

fn is_empty_dir(path: &Path) -> Result<bool, AppError> {
    let mut entries = std::fs::read_dir(path)
        .map_err(|e| AppError::Internal(format!("read {}: {e}", path.display())))?;
    Ok(entries.next().is_none())
}

// ---------------------------------------------------------------------------
// The skeletons
// ---------------------------------------------------------------------------

/// `(relative path, contents)` for everything the template writes, README and
/// `.gitignore` included. Pure, so the shape of a scaffold is pinned by a test
/// rather than by running git.
fn template_files(
    template: ProjectTemplate,
    name: &str,
    description: Option<&str>,
    workspace_name: &str,
    today: &str,
) -> Vec<(String, String)> {
    let readme = {
        let mut s = format!("# {name}\n\n");
        if let Some(d) = description.map(str::trim).filter(|d| !d.is_empty()) {
            s.push_str(d);
            s.push_str("\n\n");
        }
        s.push_str(&format!(
            "created by Personas on {today} for workspace {workspace_name}\n"
        ));
        s
    };

    let common_ignore = "# Personas keeps .personas/project.json TRACKED on purpose: it is what\n\
                         # lets a moved checkout heal and what refuses a clone collision.\n\
                         .DS_Store\n\
                         .env\n\
                         .env.local\n";

    let mut files = vec![("README.md".to_string(), readme)];

    match template {
        ProjectTemplate::Empty => {
            files.push((".gitignore".to_string(), common_ignore.to_string()));
        }
        ProjectTemplate::RustService => {
            files.push((
                ".gitignore".to_string(),
                format!("{common_ignore}/target\n"),
            ));
            files.push((
                "Cargo.toml".to_string(),
                format!(
                    "[package]\n\
                     name = \"{pkg}\"\n\
                     version = \"0.1.0\"\n\
                     edition = \"2021\"\n\n\
                     # No dependencies on purpose: the skeleton has to build and run on a\n\
                     # machine with no network. Add a real HTTP stack when there is a real\n\
                     # route to serve.\n\
                     [dependencies]\n",
                    pkg = python_package(name)
                ),
            ));
            files.push((
                "src/main.rs".to_string(),
                format!(
                    "//! {name} — a hello server, and nothing it does not do yet.\n\n\
                     use std::io::{{BufRead, BufReader, Write}};\n\
                     use std::net::TcpListener;\n\n\
                     fn main() -> std::io::Result<()> {{\n\
                     \x20   let addr = std::env::var(\"ADDR\").unwrap_or_else(|_| \"127.0.0.1:8080\".to_string());\n\
                     \x20   let listener = TcpListener::bind(&addr)?;\n\
                     \x20   println!(\"{name} listening on http://{{addr}}\");\n\
                     \x20   for stream in listener.incoming() {{\n\
                     \x20       let mut stream = stream?;\n\
                     \x20       // Drain the request line so the client is not left writing\n\
                     \x20       // into a socket nobody read.\n\
                     \x20       let mut line = String::new();\n\
                     \x20       BufReader::new(&stream).read_line(&mut line)?;\n\
                     \x20       let body = \"{name} is up\\n\";\n\
                     \x20       write!(\n\
                     \x20           stream,\n\
                     \x20           \"HTTP/1.1 200 OK\\r\\nContent-Type: text/plain\\r\\nContent-Length: {{}}\\r\\nConnection: close\\r\\n\\r\\n{{}}\",\n\
                     \x20           body.len(),\n\
                     \x20           body\n\
                     \x20       )?;\n\
                     \x20   }}\n\
                     \x20   Ok(())\n\
                     }}\n"
                ),
            ));
        }
        ProjectTemplate::NodeService => {
            files.push((
                ".gitignore".to_string(),
                format!("{common_ignore}node_modules/\ndist/\n"),
            ));
            files.push((
                "package.json".to_string(),
                format!(
                    "{{\n\
                     \x20 \"name\": \"{slug}\",\n\
                     \x20 \"version\": \"0.1.0\",\n\
                     \x20 \"private\": true,\n\
                     \x20 \"type\": \"module\",\n\
                     \x20 \"scripts\": {{\n\
                     \x20   \"start\": \"node --experimental-strip-types src/index.ts\"\n\
                     \x20 }}\n\
                     }}\n",
                    slug = slugify(name)
                ),
            ));
            files.push((
                "src/index.ts".to_string(),
                format!(
                    "// {name} — a hello server, and nothing it does not do yet.\n\
                     import {{ createServer }} from \"node:http\";\n\n\
                     const port = Number(process.env.PORT ?? 8080);\n\n\
                     createServer((_req, res) => {{\n\
                     \x20 res.writeHead(200, {{ \"Content-Type\": \"text/plain\" }});\n\
                     \x20 res.end(\"{name} is up\\n\");\n\
                     }}).listen(port, () => {{\n\
                     \x20 console.log(`{name} listening on http://127.0.0.1:${{port}}`);\n\
                     }});\n"
                ),
            ));
        }
        ProjectTemplate::PythonService => {
            let pkg = python_package(name);
            files.push((
                ".gitignore".to_string(),
                format!("{common_ignore}__pycache__/\n.venv/\ndist/\n*.egg-info/\n"),
            ));
            files.push((
                "pyproject.toml".to_string(),
                format!(
                    "[project]\n\
                     name = \"{slug}\"\n\
                     version = \"0.1.0\"\n\
                     requires-python = \">=3.11\"\n\
                     # No dependencies on purpose — see the Rust template's note.\n\
                     dependencies = []\n\n\
                     [build-system]\n\
                     requires = [\"setuptools>=68\"]\n\
                     build-backend = \"setuptools.build_meta\"\n\n\
                     [tool.setuptools.packages.find]\n\
                     where = [\"src\"]\n",
                    slug = slugify(name)
                ),
            ));
            files.push((
                format!("src/{pkg}/__init__.py"),
                format!(
                    "\"\"\"{name} — a hello server, and nothing it does not do yet.\"\"\"\n\n\
                     import os\n\
                     from http.server import BaseHTTPRequestHandler, HTTPServer\n\n\
                     BODY = b\"{name} is up\\n\"\n\n\n\
                     class Handler(BaseHTTPRequestHandler):\n\
                     \x20   def do_GET(self):  # noqa: N802 - stdlib naming\n\
                     \x20       self.send_response(200)\n\
                     \x20       self.send_header(\"Content-Type\", \"text/plain\")\n\
                     \x20       self.send_header(\"Content-Length\", str(len(BODY)))\n\
                     \x20       self.end_headers()\n\
                     \x20       self.wfile.write(BODY)\n\n\n\
                     def main() -> None:\n\
                     \x20   port = int(os.environ.get(\"PORT\", \"8080\"))\n\
                     \x20   print(f\"{name} listening on http://127.0.0.1:{{port}}\")\n\
                     \x20   HTTPServer((\"127.0.0.1\", port), Handler).serve_forever()\n"
                ),
            ));
        }
    }

    files
}

fn write_files(dir: &Path, files: &[(String, String)]) -> Result<(), AppError> {
    for (rel, body) in files {
        let target = dir.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("create {}: {e}", parent.display())))?;
        }
        std::fs::write(&target, body)
            .map_err(|e| AppError::Internal(format!("write {}: {e}", target.display())))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The git leg
// ---------------------------------------------------------------------------

fn git_failed(op: &str, e: String) -> AppError {
    AppError::ProcessSpawn(format!("scaffold {op}: {e}"))
}

/// A blocking leg died. `JoinError` is either a panic or a cancellation, and
/// which one it was is the whole content of the failure — its `Display` is
/// not. Every `spawn_blocking` below reads `is_panic()` at the call site so
/// the outcome is a value the caller can act on rather than a task that
/// vanished.
fn leg_failed(leg: &str, panicked: bool) -> AppError {
    if panicked {
        AppError::Internal(format!("scaffold {leg}: the blocking task panicked"))
    } else {
        AppError::Internal(format!("scaffold {leg}: the blocking task was cancelled"))
    }
}

/// `git init` + one commit, through the repo's own git door.
async fn init_repository(dir: &Path, name: &str) -> Result<(), AppError> {
    // `--initial-branch=main` so the branch is a decision this door made and
    // not whatever the machine's `init.defaultBranch` happens to be.
    git(dir, &["init", "--initial-branch=main"])
        .await
        .map_err(|e| git_failed("git init", e))?;

    // An unattended commit with no identity aborts. Only fill one in when the
    // machine has none, so an operator's own config keeps authoring.
    let has_identity = git(dir, &["config", "--get", "user.email"])
        .await
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    if !has_identity {
        git(dir, &["config", "user.email", SCAFFOLD_AUTHOR_EMAIL])
            .await
            .map_err(|e| git_failed("git config user.email", e))?;
        git(dir, &["config", "user.name", SCAFFOLD_AUTHOR_NAME])
            .await
            .map_err(|e| git_failed("git config user.name", e))?;
    }

    git(dir, &["add", "-A"])
        .await
        .map_err(|e| git_failed("git add", e))?;
    // `-c commit.gpgsign=false`: a globally-signed commit prompts for a
    // passphrase, and an unattended call has nobody to answer it. Same reason
    // `unattended_worktree`'s own fixtures set it.
    git(
        dir,
        &[
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            &format!("chore: scaffold {name}"),
        ],
    )
    .await
    .map_err(|e| git_failed("git commit", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/// What the blocking pre-flight resolved: where to scaffold, into which
/// workspace, and whether there is anything to scaffold at all.
struct Plan {
    workspace_id: String,
    workspace_name: String,
    workspace_created: bool,
    dir: PathBuf,
    /// `false` when the folder already holds a registered project.
    scaffold: bool,
}

/// Blocking leg 1: resolve or create the workspace, compute the directory, and
/// decide between "scaffold" and "this is already a project".
fn plan(
    pool: &DbPool,
    input: &CreateProjectRepositoryInput,
    name: &str,
    root: &Path,
) -> Result<Plan, AppError> {
    let requested_ws = input.workspace.trim();
    personas_core::validation::require_non_empty("workspace", requested_ws)?;

    let existing = ws_repo::list_workspaces(pool)?
        .into_iter()
        .find(|w| w.id == requested_ws || w.name.eq_ignore_ascii_case(requested_ws));
    let (workspace, workspace_created) = match existing {
        Some(w) => (w, false),
        None => (
            ws_repo::create_workspace(pool, requested_ws, None, None, false)?,
            true,
        ),
    };

    let dir = root.join(slugify(&workspace.name)).join(name);

    let scaffold = if dir.exists() {
        if is_empty_dir(&dir)? {
            true
        } else {
            // A folder that already IS a project is the idempotent case; a
            // folder with anything else in it is the caller's mistake.
            let display = canonical_display(&dir)?;
            match resolve_identity(pool, &display)? {
                IdentityResolution::Existing(_) | IdentityResolution::Relocated(_) => false,
                IdentityResolution::Fresh => {
                    return Err(AppError::Validation(format!(
                        "{display} already exists and is not empty"
                    )))
                }
            }
        }
    } else {
        true
    };

    Ok(Plan {
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        workspace_created,
        dir,
        scaffold,
    })
}

/// Blocking leg 2: register the repository as a project and put it in the
/// workspace. `register_project` writes `.personas/project.json`.
fn register(
    pool: &DbPool,
    input: &CreateProjectRepositoryInput,
    name: &str,
    root_path: &str,
    workspace_id: &str,
) -> Result<DevProject, AppError> {
    let project = crate::db::project_identity::register_project(
        pool,
        name,
        root_path,
        input.description.as_deref(),
        None,
        input.tech_stack.as_deref(),
        None,
        None,
    )?;
    ws_repo::assign_project(pool, &project.id, Some(workspace_id))
}

/// Create the repository and the project. Resolves the root (the one step that
/// needs the Tauri handle) and hands off to [`create_in_root`].
pub async fn create_project_repository_inner(
    app: AppHandle,
    pool: DbPool,
    input: CreateProjectRepositoryInput,
) -> Result<CreatedProjectRepository, AppError> {
    let root = {
        let (app, pool, requested) = (app, pool.clone(), input.root.clone());
        tokio::task::spawn_blocking(move || {
            simulation_projects_root(&app, &pool, requested.as_deref())
        })
        .await
        .map_err(|e| leg_failed("root", e.is_panic()))??
    };
    create_in_root(pool, input, root).await
}

/// Three legs: a blocking pre-flight, the async git/filesystem work, and a
/// blocking registration — so no rusqlite call ever runs on an async worker and
/// no `git` call ever runs on the blocking pool holding a connection.
pub(crate) async fn create_in_root(
    pool: DbPool,
    input: CreateProjectRepositoryInput,
    root: PathBuf,
) -> Result<CreatedProjectRepository, AppError> {
    let name = validate_project_name(&input.name)?;

    let planned = {
        let (pool, input, name, root) = (pool.clone(), input.clone(), name.clone(), root);
        tokio::task::spawn_blocking(move || plan(&pool, &input, &name, &root))
            .await
            .map_err(|e| leg_failed("plan", e.is_panic()))??
    };

    if planned.scaffold {
        std::fs::create_dir_all(&planned.dir)
            .map_err(|e| AppError::Internal(format!("create {}: {e}", planned.dir.display())))?;
        let files = template_files(
            input.template.unwrap_or_default(),
            &name,
            input.description.as_deref(),
            &planned.workspace_name,
            &chrono::Utc::now().format("%Y-%m-%d").to_string(),
        );
        write_files(&planned.dir, &files)?;
        init_repository(&planned.dir, &name).await?;
    }

    let repository_path = canonical_display(&planned.dir)?;
    let project = {
        let (pool, input, name, path, ws) = (
            pool,
            input,
            name,
            repository_path.clone(),
            planned.workspace_id.clone(),
        );
        tokio::task::spawn_blocking(move || register(&pool, &input, &name, &path, &ws))
            .await
            .map_err(|e| leg_failed("register", e.is_panic()))??
    };

    Ok(CreatedProjectRepository {
        project,
        repository_path,
        workspace_id: planned.workspace_id,
        created: planned.scaffold,
        workspace_created: planned.workspace_created,
    })
}

/// Tauri adapter for [`create_project_repository_inner`]. The HTTP route
/// `POST /dev-tools/projects/create` calls the same function.
#[tauri::command]
pub async fn create_project_repository(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    input: CreateProjectRepositoryInput,
) -> Result<CreatedProjectRepository, AppError> {
    require_auth(&state).await?;
    let pool = state.db.clone();
    create_project_repository_inner(app, pool, input).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_one_safe_directory_component() {
        assert_eq!(slugify("Bank"), "bank");
        assert_eq!(slugify("Grand Simulation"), "grand-simulation");
        assert_eq!(slugify("  a//b  "), "a-b");
        // A name that collapses to nothing must NOT scaffold one level up.
        assert_eq!(slugify("///"), "workspace");
        assert_eq!(slugify(""), "workspace");
    }

    #[test]
    fn a_project_name_is_one_directory_component() {
        assert_eq!(validate_project_name(" bank-core ").unwrap(), "bank-core");
        for bad in ["", "   ", ".", "..", ".hidden", "a/b", "a\\b", "a:b", "a*"] {
            assert!(
                validate_project_name(bad).is_err(),
                "{bad:?} should be refused"
            );
        }
    }

    #[test]
    fn python_packages_are_identifiers() {
        assert_eq!(python_package("bank-core"), "bank_core");
        assert_eq!(python_package("2fast"), "_2fast");
    }

    #[test]
    fn every_template_writes_a_readme_that_names_its_workspace() {
        for t in [
            ProjectTemplate::Empty,
            ProjectTemplate::RustService,
            ProjectTemplate::NodeService,
            ProjectTemplate::PythonService,
        ] {
            let files = template_files(t, "bank-core", Some("the ledger"), "Bank", "2026-09-07");
            let readme = &files
                .iter()
                .find(|(p, _)| p == "README.md")
                .expect("a README")
                .1;
            assert!(readme.contains("# bank-core"));
            assert!(readme.contains("the ledger"));
            assert!(
                readme.contains("created by Personas on 2026-09-07 for workspace Bank"),
                "{readme}"
            );
            assert!(
                files.iter().any(|(p, _)| p == ".gitignore"),
                "{t:?} must carry a .gitignore"
            );
            let expected = match t {
                ProjectTemplate::Empty => 2,
                _ => 4,
            };
            assert_eq!(files.len(), expected, "{t:?} wrote {files:?}");
        }
    }

    // -----------------------------------------------------------------
    // End-to-end, against a REAL `git init` in a temp directory.
    //
    // A mock git would pin our belief about git rather than git's behaviour —
    // the same discipline `unattended_worktree`'s own fixtures follow. The
    // database is `init_test_db()`; nothing here writes a CREATE TABLE.
    // -----------------------------------------------------------------

    use crate::db::repos::workspaces::org as test_ws_repo;
    use personas_db::init_test_db;

    /// A fresh directory under the OS temp dir; removed on drop.
    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir()
                .join(format!("personas_scaffold_{tag}_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            // Windows keeps `.git` objects read-only; a failed removal must not
            // fail the test that already passed.
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn input(name: &str, template: ProjectTemplate) -> CreateProjectRepositoryInput {
        CreateProjectRepositoryInput {
            workspace: "Bank".into(),
            name: name.into(),
            description: Some("the ledger".into()),
            tech_stack: Some("rust".into()),
            template: Some(template),
            root: None,
        }
    }

    #[tokio::test]
    async fn creates_a_repository_a_project_a_marker_and_a_workspace_assignment() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("create");

        let out = create_in_root(
            pool.clone(),
            input("bank-core", ProjectTemplate::RustService),
            root.0.clone(),
        )
        .await
        .unwrap();

        assert!(out.created, "the first call scaffolds");
        assert!(out.workspace_created, "and mints the workspace it named");
        assert_eq!(out.project.name, "bank-core");

        // The directory is <root>/<workspace-slug>/<name>.
        let dir = PathBuf::from(&out.repository_path);
        assert!(
            dir.ends_with(PathBuf::from("bank").join("bank-core")),
            "{dir:?}"
        );

        // A real repository with a real commit.
        assert!(dir.join(".git").is_dir(), "git init ran");
        let log = git(&dir, &["log", "--oneline", "-1"]).await.unwrap();
        assert!(log.contains("chore: scaffold bank-core"), "{log}");

        // The scaffold's own files, and the README's provenance line.
        assert!(dir.join("Cargo.toml").is_file());
        assert!(dir.join("src/main.rs").is_file());
        assert!(dir.join(".gitignore").is_file());
        let readme = std::fs::read_to_string(dir.join("README.md")).unwrap();
        assert!(readme.contains("# bank-core"), "{readme}");
        assert!(readme.contains("for workspace Bank"), "{readme}");

        // The identity marker `register_project` writes.
        let marker = crate::db::project_identity::read_marker(&dir).expect("a marker");
        assert_eq!(marker.id, out.project.id);

        // The workspace assignment, read back from the row rather than from
        // the response we just built.
        assert_eq!(
            out.project.workspace_id.as_deref(),
            Some(out.workspace_id.as_str())
        );
        let members = test_ws_repo::list_workspace_projects(&pool, &out.workspace_id).unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].id, out.project.id);

        // The one-team-per-project invariant still holds through this door.
        assert!(
            out.project.team_id.is_some(),
            "register_project minted a team"
        );
    }

    /// The second call finds a folder that is NOT empty — but it carries the
    /// marker, so `register_project` heals it and this door returns THE SAME
    /// project rather than the 400 a stranger's folder would earn.
    #[tokio::test]
    async fn a_second_call_returns_the_same_project_not_a_refusal() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("idem");

        let first = create_in_root(
            pool.clone(),
            input("bank-core", ProjectTemplate::Empty),
            root.0.clone(),
        )
        .await
        .unwrap();
        let second = create_in_root(
            pool.clone(),
            input("bank-core", ProjectTemplate::Empty),
            root.0.clone(),
        )
        .await
        .unwrap();

        assert_eq!(second.project.id, first.project.id, "no duplicate project");
        assert!(!second.created, "nothing was scaffolded the second time");
        assert!(!second.workspace_created, "the workspace was reused");
        assert_eq!(second.workspace_id, first.workspace_id);
    }

    /// A folder that exists, is not empty, and is NOT a project is the
    /// caller's mistake — refused, with the path in the message.
    #[tokio::test]
    async fn a_non_empty_stranger_directory_is_refused_with_its_path() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("occupied");
        let occupied = root.0.join("bank").join("bank-core");
        std::fs::create_dir_all(&occupied).unwrap();
        std::fs::write(occupied.join("someones-work.txt"), "not ours").unwrap();

        let err = create_in_root(
            pool,
            input("bank-core", ProjectTemplate::Empty),
            root.0.clone(),
        )
        .await
        .expect_err("a non-empty stranger folder must be refused");

        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
        let msg = err.to_string();
        assert!(msg.contains("bank-core"), "names the path: {msg}");
        assert!(msg.contains("not empty"), "says why: {msg}");
        // …and the file it refused to scaffold over is untouched.
        assert!(occupied.join("someones-work.txt").is_file());
    }

    /// The protection tag, driven through THIS door: a project created here,
    /// its workspace tagged, then both deletes refused.
    #[tokio::test]
    async fn a_protected_workspace_refuses_the_project_and_workspace_deletes() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("protect");
        let out = create_in_root(
            pool.clone(),
            input("bank-core", ProjectTemplate::Empty),
            root.0.clone(),
        )
        .await
        .unwrap();

        use crate::db::repos::workspaces::protection;

        // Unprotected first: the doors are open, so the refusal below is the
        // tag's doing and not some unrelated guard.
        {
            let conn = crate::db::PoolExt::conn(&pool, "test:scaffold_protection").unwrap();
            protection::ensure_project_deletable(&conn, &out.project.id).unwrap();
            protection::ensure_workspace_deletable(&conn, &out.workspace_id).unwrap();
        }

        protection::set_workspace_protection(&pool, &out.workspace_id, true).unwrap();

        let project_err =
            crate::db::repos::dev::projects::delete_project(&pool, &out.project.id).unwrap_err();
        assert!(
            project_err
                .to_string()
                .contains("protected as the last working version"),
            "{project_err}"
        );
        let ws_err = test_ws_repo::delete_workspace(&pool, &out.workspace_id).unwrap_err();
        assert!(
            ws_err
                .to_string()
                .contains("protected as the last working version"),
            "{ws_err}"
        );
        // The team door too — a project's team is where its charters hang.
        let team_id = out.project.team_id.clone().expect("a team");
        let team_err = crate::db::repos::resources::teams::delete(&pool, &team_id).unwrap_err();
        assert!(
            team_err
                .to_string()
                .contains("protected as the last working version"),
            "{team_err}"
        );

        // Nothing was deleted on the way to those refusals.
        assert!(crate::db::repos::dev_tools::get_project_by_id(&pool, &out.project.id).is_ok());
        assert!(test_ws_repo::get_workspace_by_id(&pool, &out.workspace_id).is_ok());

        // Clearing the tag re-opens the door.
        protection::set_workspace_protection(&pool, &out.workspace_id, false).unwrap();
        assert!(crate::db::repos::dev::projects::delete_project(&pool, &out.project.id).unwrap());
    }

    #[test]
    fn the_template_names_arrive_over_the_wire_in_kebab_case() {
        let parsed: CreateProjectRepositoryInput = serde_json::from_str(
            r#"{"workspace":"Bank","name":"bank-core","template":"rust-service","tech_stack":"rust"}"#,
        )
        .unwrap();
        assert_eq!(parsed.template, Some(ProjectTemplate::RustService));
        // The snake_case alias exists so the documented HTTP body and the
        // camelCase Tauri payload are the same struct.
        assert_eq!(parsed.tech_stack.as_deref(), Some("rust"));
    }
}
