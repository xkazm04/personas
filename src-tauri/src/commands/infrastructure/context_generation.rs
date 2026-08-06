//! Context Map generation via Claude CLI.
//!
//! Spawns a Claude CLI process with a codebase analysis prompt. The LLM
//! analyzes the project's file structure, identifies business-feature contexts,
//! and creates DevContextGroup + DevContext entries via protocol messages.
//! Progress is streamed to the frontend via Tauri events.

use std::panic::AssertUnwindSafe;
use std::sync::{Arc, LazyLock, Mutex};

use futures_util::FutureExt;
use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use super::cli_stderr::{push_stderr_line, snapshot_stderr};
use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::engine::inflight_guard::InflightGuard;
use crate::engine::parser::parse_stream_line;
use crate::engine::types::StreamLineType;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Extract a printable message from a panic payload returned by `catch_unwind`.
/// Mirrors the canonical pattern at `commands/execution/lab.rs::extract_panic_message`.
fn extract_panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&str>() {
        return s.to_string();
    }
    if let Some(s) = panic.downcast_ref::<String>() {
        return s.clone();
    }
    "unknown panic".to_string()
}

/// Per-project single-flight guard for context-map scans. Two concurrent
/// rescans of one project interleave `clear_project_context_map` (a full DELETE
/// of the project's contexts + groups) with each other's freshly-written rows,
/// leaving an arbitrary partial mix — or a near-empty map if a late clear lands
/// after the other run finished — silently destroying a hand-curated context
/// map and orphaning dev_goals/dev_kpis `context_id` references, all while still
/// reporting success. Mirrors INFLIGHT_TRIGGERS in commands/tools/automations.rs.
static CONTEXT_GEN_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

// =============================================================================
// Job state
// =============================================================================

/// What each context-scan job is scanning. The job record used to be a unit
/// struct, so a scan_id was opaque: given a project you could not ask "is a scan
/// already running, and over what?" — you could only poll an id you already
/// held. A client that lost a scan_id (or never saw it, e.g. a shell loop whose
/// POST output was swallowed) had no way to find out, so it relaunched and
/// scanned the same subtree twice. `list_scans_json` reads these fields.
#[derive(Clone, Default)]
struct ContextGenExtra {
    project_id: String,
    /// `None` = whole-tree scan. Mirrors the single-flight guard's scope key.
    subtree: Option<String>,
}

static CONTEXT_GEN_JOBS: BackgroundJobManager<ContextGenExtra> = BackgroundJobManager::new(
    "context-generation lock poisoned",
    event_name::CONTEXT_GEN_STATUS,
    event_name::CONTEXT_GEN_OUTPUT,
);

// =============================================================================
// Prompt
// =============================================================================

/// Optional delta-mode briefing for the LLM, derived from the per-file hash
/// cache. When present, the LLM is told exactly which files changed since the
/// last scan and instructed to update only contexts that touch them — much
/// cheaper than the full rescan flow above.
struct DeltaBriefing<'a> {
    added: &'a [String],
    modified: &'a [String],
    deleted: &'a [String],
    unchanged_count: i32,
}

fn build_context_generation_prompt(
    project_id: &str,
    project_name: &str,
    root_path: &str,
    existing_context_summary: Option<&str>,
    delta: Option<&DeltaBriefing<'_>>,
    subtree: Option<&str>,
    group_names: &[String],
) -> String {
    let mode_section = if let Some(summary) = existing_context_summary {
        let delta_section = if let Some(d) = delta {
            // Cap the rendered file lists so the prompt stays bounded on
            // commits that touch hundreds of files (mass refactors, lockfile
            // bumps, etc.). The LLM still sees the counts and the first N of
            // each category — enough to update contexts directionally.
            const MAX_PER_CATEGORY: usize = 80;
            let render = |label: &str, items: &[String]| -> String {
                if items.is_empty() {
                    return format!("- **{label}**: (none)\n");
                }
                let shown: Vec<&str> = items
                    .iter()
                    .take(MAX_PER_CATEGORY)
                    .map(String::as_str)
                    .collect();
                let suffix = if items.len() > MAX_PER_CATEGORY {
                    format!(" (+ {} more)", items.len() - MAX_PER_CATEGORY)
                } else {
                    String::new()
                };
                format!(
                    "- **{label}** ({n}{suffix}):\n{list}\n",
                    label = label,
                    n = items.len(),
                    suffix = suffix,
                    list = shown
                        .iter()
                        .map(|p| format!("  - {p}"))
                        .collect::<Vec<_>>()
                        .join("\n"),
                )
            };
            format!(
                r#"
### DELTA MODE — Only These Files Changed Since Last Scan

The codebase has **{unchanged} unchanged files**. Do NOT re-explore the whole
tree — focus exclusively on contexts that touch the file lists below.

{added_block}{modified_block}{deleted_block}
**Rules for delta mode:**
- For ADDED files: locate or create the appropriate context and append the file path.
- For MODIFIED files: re-read the file and update the owning context's description if
  its purpose has shifted. If file_paths is unchanged you may skip the context entirely.
- For DELETED files: emit a `context_map_update` that removes the path from `file_paths`.
  If a context's file list becomes empty, leave a note in `description` rather than dropping
  the context (the user will prune manually).
- Do NOT touch contexts whose listed files do not appear in any of the three lists above.
"#,
                unchanged = d.unchanged_count,
                added_block = render("ADDED", d.added),
                modified_block = render("MODIFIED", d.modified),
                deleted_block = render("DELETED", d.deleted),
            )
        } else {
            String::new()
        };

        format!(
            r#"
## RESCAN MODE — Existing Context Map

This project already has a context map. Review the existing contexts below and
**intelligently update** them rather than creating everything from scratch:

{summary}

### Rescan Rules
- Keep groups/contexts whose files still exist and mapping is still accurate
- Update file lists if new files appeared or old files were removed/renamed
- Add new contexts for newly discovered features
- Remove contexts whose files no longer exist
- Update descriptions if the code's purpose has evolved
- Output protocol messages ONLY for changes (new groups, new contexts, updated contexts)

To update an existing context, use:
```
{{"context_map_update": {{"context_id": "<id>", "description": "...", "file_paths": [...], "keywords": [...]}}}}
```
{delta_section}"#
        )
    } else {
        String::new()
    };

    // Subtree mode: the scan owns ONE directory and emits only its contexts.
    // This is what makes a large codebase mappable at all — ten of these run
    // concurrently, each with its own output stream, instead of one session
    // trying to emit five hundred protocol messages and quietly stopping at
    // fifty. Measured on this repo: one whole-tree session mapped 392 of ~4,400
    // hand-written files (9%); ten scoped passes mapped 82%.
    let existing_groups = if group_names.is_empty() {
        "(none yet — you are the first scan; create what the subtree needs)".to_string()
    } else {
        group_names
            .iter()
            .map(|g| format!("- {g}"))
            .collect::<Vec<_>>()
            .join("
")
    };
    let subtree_section = match subtree {
        Some(st) => format!(
            r#"
## GROUPS THAT ALREADY EXIST — reuse these before inventing one

{existing_groups}

Pick the closest fit from that list. Only create a new group when your subtree
introduces a domain genuinely absent above. Concurrent scans share this
taxonomy, and each scan inventing its own near-synonym is how a map ends up
with "Execution Engine" beside "Execution & Quality Data" (measured: 8 groups
became 50 across one sweep, because this list was not shown).

## SUBTREE SCOPE — you own `{st}` and nothing else

Map ONLY the files under `{st}`. Other scans own the rest of the repo and are
running right now, so anything you emit outside your scope collides with theirs.

- Every `file_paths` entry MUST start with `{st}/`. No exceptions.
- Do NOT emit a context for code outside `{st}`, however tempting the connection.
- Read outside your subtree freely to UNDERSTAND it — just never map it.
- Groups are shared across scans. Reuse an existing group name when one fits;
  create a new one only when your subtree genuinely introduces a domain no other
  scope would own.
- Granularity is a HARD BAND: one context per 10-30 files (sweet spot 15-20).
  A subtree of 300 files should produce something like 12-20 contexts, not 50.
- Align each context to a directory subtree: take the DEEPEST directory whose
  file count lands inside the band. Never fragment one module directory into
  several contexts, and never emit a context under 8 files — merge it into its
  sibling module instead (a genuinely isolated leaf directory is the only
  exception). Split only above 30 files, along child-directory lines.
"#,
            existing_groups = existing_groups,
        ),
        None => String::new(),
    };

    // Whole-tree exploration only. A delta scan already knows its file list, so
    // fanning out would spend subagent turns re-deriving a briefing it was
    // handed — and a delta run is meant to stay cheap. Subtree scans skip it too:
    // the scope is already small, and the parallelism now lives ABOVE this
    // session (many scoped scans) rather than inside it.
    let fanout_section = if delta.is_none() && subtree.is_none() {
        r#"
## Exploring in parallel

A full scan has to read the whole tree, and reading it one directory at a time
in this session is the slowest possible way to do it. Fan out instead: partition
the repo's top-level source directories into batches and dispatch one subagent
per batch with the Task tool, all in a single message so they run concurrently.
Give each subagent its batch, this document's context/group definitions, and ask
it to report back which candidate contexts it found — name, one-paragraph
description, the concrete file paths, keywords, entry points.

**Subagents recon; only YOU emit protocol messages.** Their output is a report
to you, not to the harness — nothing they print is read as a protocol message.
Wait for every batch, reconcile the reports into a single coherent map (merge
duplicates, split anything over 15 files, resolve files claimed by two contexts
so each lands in exactly one), and then emit the groups and contexts yourself.

Skip the fan-out for a small repo where one pass is obviously enough; the point
is coverage and speed, not ceremony.
"#
    } else {
        ""
    };

    format!(
        r#"# Context Map Generator

You are analyzing a codebase to create a **Context Map** — a structured inventory of business-feature contexts that maps the codebase into logical, domain-driven groups.

## Project Information
- **Project ID**: {project_id}
- **Project Name**: {project_name}
- **Root Path**: {root_path}
{mode_section}
{subtree_section}
## Your Task

1. **Explore the codebase** at the root path using the file system tools available to you.
2. **Identify business-feature contexts** — NOT architectural layers. Group by what the code DOES (e.g., "User Authentication", "Payment Processing", "Dashboard Analytics"), not by code structure (e.g., "components", "utils", "hooks").
3. **Create Context Groups** using the protocol messages below.
4. **Create Contexts** within each group, listing the relevant files, entry points, keywords, and tech stack.
{fanout_section}
## Context Group Guidelines
- Create 4-10 groups representing major **business domains** (not layers)
- **Naming**: Use Title Case, domain-oriented names (e.g., "User Authentication", "Payment Processing", "Analytics Dashboard"). Never use technical layer names like "Components", "Hooks", "Utils"
- Each group should have a color from: red, orange, amber, emerald, blue, indigo, violet, pink
- **domain (REQUIRED)**: the group's business role — EXACTLY one of: `feature` (user-facing capability), `infrastructure` (auth/logging/config/build/deploy/observability), `shared` (reusable primitives used across features), `integration` (external services / third-party / webhooks), `data` (persistence: schema/repositories/migrations)
- Groups should be mutually exclusive (a file should belong to only one context)

## Context Guidelines
- **Granularity (HARD BAND)**: Each context contains **10-30 related files** (sweet spot 15-20). Under 8 files → merge into the sibling module context; over 30 → split along child-directory lines. Align every context to a directory subtree — the DEEPEST directory whose file count fits the band — and never fragment one module directory into several contexts
- **Naming**: Use kebab-style descriptive names (e.g., "login-flow", "invoice-generation", "metric-aggregation")
- **Description (REQUIRED)**: Write 2-3 sentences explaining: (1) what business problem this code solves, (2) how it works at a high level, (3) key dependencies or data flows
- **file_paths**: JSON array of relative paths. Be precise — list individual files, not directories
- **entry_points**: The 1-3 files a developer would read first to understand this context
- **keywords**: 5-10 domain terms that would help search (e.g., "oauth", "jwt", "session", "login", "2fa")
- **db_tables**: If this context reads/writes database tables, list them (e.g., ["users", "sessions", "auth_tokens"])
- **api_surface**: If this context exposes or consumes APIs, describe them briefly (e.g., "POST /api/auth/login, GET /api/auth/session")
- **cross_refs**: List other context names this code depends on or is depended on by (e.g., ["user-profile", "notification-service"])
- **tech_stack**: Name the CONCRETE frameworks in play, read from the dependency manifest (package.json / Cargo.toml) — include meta-frameworks like Next.js or Nuxt explicitly when present (not just "React"), and append the major.minor version where the manifest states it (e.g., ["Next.js 15.3", "React 19.1", "TypeScript"])
- **category (REQUIRED)**: the context's primary technical layer — EXACTLY one of: `ui`, `api`, `lib`, `data`, `test`, `config`. NOTE: "integration" is a GROUP domain, NOT a context category — never use it here.
- **business_feature (REQUIRED)**: a short human-readable feature name (often similar to the context name, in Title Case)

## Protocol Messages

Output these JSON objects on their own lines in your response:

To create a context group:
```
{{"context_map_group": {{"project_id": "{project_id}", "name": "Group Name", "color": "amber", "domain": "feature"}}}}
```

To create a context within a group:
```
{{"context_map_context": {{"project_id": "{project_id}", "group_name": "Group Name", "name": "context-name", "description": "2-3 sentence description of business purpose, how it works, and key dependencies", "file_paths": ["src/foo.ts", "src/bar.ts"], "entry_points": ["src/foo.ts"], "keywords": ["authentication", "login"], "db_tables": ["users", "sessions"], "api_surface": "POST /api/auth/login", "cross_refs": ["user-profile"], "tech_stack": ["Next.js 15.3", "React 19.1", "TypeScript"], "category": "api", "business_feature": "User Authentication"}}}}
```

At the end, output a summary:
```
{{"context_map_summary": {{"groups_created": N, "contexts_created": N, "files_mapped": N}}}}
```

## Process
1. First, list the top-level directory structure
2. Read key files (package.json, Cargo.toml, README, etc.) to understand the project
3. Explore each major directory to understand its purpose
4. Design the context map groups
5. Output the group and context creation protocol messages
6. Output the summary

## Quality Rules
- Be thorough but efficient — read directory listings before diving into individual files
- Focus on source code directories, skip node_modules, target, dist, build, .git
- Each file should appear in exactly one context
- Prefer business-domain grouping over technical-layer grouping
- The file_paths in each context should be relative to the project root
- Every context MUST have a description — no empty or placeholder descriptions
- If a context has more than 15 files, split it into focused sub-contexts
- For each context, populate db_tables if it touches a database, api_surface if it exposes/calls APIs, and cross_refs for dependencies between contexts
- Use kebab-case for context names (e.g., "user-auth-flow" not "User Auth Flow")
- Use Title Case for group names (e.g., "User Management" not "user-management")
- Every context MUST set `category` (ui|api|lib|data|test|config) + `business_feature`; every group MUST set `domain` (feature|infrastructure|shared|integration|data). Use EXACTLY these enum values.

Begin by exploring the codebase structure."#
    )
}

// =============================================================================
// Protocol message parsing
// =============================================================================

#[derive(Debug)]
enum ContextMapProtocol {
    Group {
        project_id: String,
        name: String,
        color: String,
        domain: Option<String>,
    },
    Context {
        project_id: String,
        group_name: String,
        name: String,
        description: Option<String>,
        file_paths: Vec<String>,
        entry_points: Vec<String>,
        keywords: Vec<String>,
        db_tables: Vec<String>,
        api_surface: Option<String>,
        cross_refs: Vec<String>,
        tech_stack: Vec<String>,
        category: Option<String>,
        business_feature: Option<String>,
    },
    #[allow(dead_code)]
    Update {
        context_id: String,
        description: Option<String>,
        file_paths: Option<Vec<String>>,
        keywords: Option<Vec<String>>,
    },
    Summary {
        groups_created: i32,
        contexts_created: i32,
        files_mapped: i32,
    },
}

/// Canonical context taxonomy (parity with Vibeman). A context's technical
/// layer and a group's business domain — validated post-parse so an LLM that
/// emits a bogus value (e.g. "integration" as a context category — it's a group
/// domain) gets it dropped rather than persisted.
pub const CONTEXT_CATEGORIES: &[&str] = &["ui", "api", "lib", "data", "test", "config"];
pub const GROUP_DOMAINS: &[&str] = &["feature", "infrastructure", "shared", "integration", "data"];

pub fn normalize_category(s: Option<&str>) -> Option<String> {
    let v = s?.trim().to_lowercase();
    CONTEXT_CATEGORIES.contains(&v.as_str()).then_some(v)
}

pub fn normalize_domain(s: Option<&str>) -> Option<String> {
    let v = s?.trim().to_lowercase();
    GROUP_DOMAINS.contains(&v.as_str()).then_some(v)
}

fn parse_context_map_protocol(text: &str) -> Option<ContextMapProtocol> {
    let val: serde_json::Value = serde_json::from_str(text).ok()?;

    if let Some(group) = val.get("context_map_group") {
        return Some(ContextMapProtocol::Group {
            project_id: group.get("project_id")?.as_str()?.to_string(),
            name: group.get("name")?.as_str()?.to_string(),
            color: group
                .get("color")
                .and_then(|c| c.as_str())
                .unwrap_or("amber")
                .to_string(),
            domain: normalize_domain(group.get("domain").and_then(|d| d.as_str())),
        });
    }

    if let Some(ctx) = val.get("context_map_context") {
        let arr_to_vec = |key: &str| -> Vec<String> {
            ctx.get(key)
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default()
        };

        return Some(ContextMapProtocol::Context {
            project_id: ctx.get("project_id")?.as_str()?.to_string(),
            group_name: ctx.get("group_name")?.as_str()?.to_string(),
            name: ctx.get("name")?.as_str()?.to_string(),
            description: ctx
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string()),
            file_paths: arr_to_vec("file_paths"),
            entry_points: arr_to_vec("entry_points"),
            keywords: arr_to_vec("keywords"),
            db_tables: arr_to_vec("db_tables"),
            api_surface: ctx
                .get("api_surface")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            cross_refs: arr_to_vec("cross_refs"),
            tech_stack: arr_to_vec("tech_stack"),
            category: normalize_category(ctx.get("category").and_then(|v| v.as_str())),
            business_feature: ctx
                .get("business_feature")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }

    if let Some(upd) = val.get("context_map_update") {
        let opt_arr = |key: &str| -> Option<Vec<String>> {
            upd.get(key).and_then(|v| v.as_array()).map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
        };
        return Some(ContextMapProtocol::Update {
            context_id: upd.get("context_id")?.as_str()?.to_string(),
            description: upd
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string()),
            file_paths: opt_arr("file_paths"),
            keywords: opt_arr("keywords"),
        });
    }

    if let Some(summary) = val.get("context_map_summary") {
        return Some(ContextMapProtocol::Summary {
            groups_created: summary
                .get("groups_created")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
            contexts_created: summary
                .get("contexts_created")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
            files_mapped: summary
                .get("files_mapped")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
        });
    }

    None
}

/// Build a summary of existing contexts for rescan mode.
fn build_existing_context_summary(pool: &crate::db::DbPool, project_id: &str) -> Option<String> {
    let groups = repo::list_context_groups(pool, project_id).ok()?;
    let contexts = repo::list_contexts_by_project(pool, project_id, None).ok()?;
    if groups.is_empty() && contexts.is_empty() {
        return None;
    }

    // A pinned context is human-curated and preserved verbatim across a full
    // rescan (the DB never deletes it). Tell the model NOT to recreate or rename
    // pinned contexts — doing so would duplicate them alongside the surviving row.
    let line = |ctx: &crate::db::models::DevContext| -> String {
        let pin = if ctx.pinned {
            " [📌 PINNED — preserved verbatim; do NOT recreate, rename, or re-emit this context]"
        } else {
            ""
        };
        format!(
            "- **{}** (id: {}): {} | files: {}{}\n",
            ctx.name,
            ctx.id,
            ctx.description.as_deref().unwrap_or("no description"),
            ctx.file_paths,
            pin,
        )
    };

    let mut summary = String::new();
    if contexts.iter().any(|c| c.pinned) {
        summary.push_str(
            "\n> NOTE: contexts marked 📌 PINNED are human-curated and already \
preserved in the map. Do NOT re-emit, rename, or split them; leave their files \
to them and organize only the remaining, unpinned surface.\n",
        );
    }
    for group in &groups {
        summary.push_str(&format!(
            "\n### Group: {} (id: {}, color: {})\n",
            group.name, group.id, group.color
        ));
        let group_ctxs: Vec<_> = contexts
            .iter()
            .filter(|c| c.group_id.as_deref() == Some(&group.id))
            .collect();
        for ctx in group_ctxs {
            summary.push_str(&line(ctx));
        }
    }

    let ungrouped: Vec<_> = contexts.iter().filter(|c| c.group_id.is_none()).collect();
    if !ungrouped.is_empty() {
        summary.push_str("\n### Ungrouped Contexts\n");
        for ctx in ungrouped {
            summary.push_str(&line(ctx));
        }
    }

    Some(summary)
}

// =============================================================================
// Tauri commands
// =============================================================================

#[derive(Clone, Serialize)]
struct ContextGenSummary {
    scan_id: String,
    groups_created: i32,
    contexts_created: i32,
    files_mapped: i32,
    status: String,
    error: Option<String>,
}

#[tauri::command]
pub async fn dev_tools_scan_codebase(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
    root_path: String,
    delta_mode: Option<bool>,
    subtree: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    launch_context_scan(app, &state.db, &project, &root_path, delta_mode.unwrap_or(false), subtree.as_deref())
}

/// Launch a context-map scan for `project` as a background task. Shared by the
/// `dev_tools_scan_codebase` command and Athena's `register_project` auto-scan
/// (`commands/companion/approvals.rs`). Returns immediately with the scan_id; the
/// scan runs in a spawned task and emits CONTEXT_GEN_* events + an OS notification
/// on completion. `root_path` "" / "." falls back to the project's stored root_path.
pub(crate) fn launch_context_scan(
    app: tauri::AppHandle,
    pool: &crate::db::DbPool,
    project: &crate::db::models::DevProject,
    root_path: &str,
    delta_mode: bool,
    subtree: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    let project_id = project.id.clone();

    // Subtree scans must be able to run CONCURRENTLY — that is the entire point
    // of the mode. One session cannot emit a map for a large codebase: it runs
    // out of room and stops, and a scan that returns 49 valid contexts looks
    // exactly like a successful one. So the guard is keyed per SCOPE, not per
    // project: `src/features/agents` and `src-tauri/src/commands` hold separate
    // keys and never block each other, while a second scan of the SAME scope is
    // still refused (that one really would corrupt its own lazy clear).
    let guard_key = match subtree {
        Some(s) => format!("{project_id}::{s}"),
        None => project_id.clone(),
    };
    let scan_guard = CONTEXT_GEN_INFLIGHT.guard(&guard_key).ok_or_else(|| {
        AppError::Validation(match subtree {
            Some(s) => format!("A context scan is already running for {s} in project {project_id}"),
            None => format!("A context scan is already running for project {project_id}"),
        })
    })?;

    let scan_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    CONTEXT_GEN_JOBS.insert_running(
        scan_id.clone(),
        cancel_token.clone(),
        ContextGenExtra {
            project_id: project_id.clone(),
            subtree: subtree.map(|s| s.to_string()),
        },
    )?;
    CONTEXT_GEN_JOBS.set_status(&app, &scan_id, "running", None);

    // Resolve root path
    let resolved_root = if root_path == "." || root_path.is_empty() {
        project.root_path.clone()
    } else {
        root_path.to_string()
    };

    // Validate directory
    let root_dir = std::path::Path::new(&resolved_root);
    if !root_dir.is_dir() {
        CONTEXT_GEN_JOBS.set_status(
            &app,
            &scan_id,
            "failed",
            Some("Path is not a directory".to_string()),
        );
        return Err(AppError::Validation(format!(
            "Path is not a directory: {resolved_root}"
        )));
    }

    // Check for existing contexts (rescan mode)
    let existing_summary = build_existing_context_summary(pool, &project_id);
    let is_rescan = existing_summary.is_some();

    // Surface the scan on the persona-event bus (Live Stream) — covers BOTH
    // manual scans and triggered system-op scans. No target persona, so it
    // dispatches to nobody; it's just an observable lifecycle marker.
    crate::engine::system_ops::publish_context_scan_event(
        pool,
        "started",
        &project_id,
        &project.name,
        json!({ "delta_mode": delta_mode, "is_rescan": is_rescan }),
    );

    let app_handle = app.clone();
    let pool = pool.clone();
    let scan_id_for_task = scan_id.clone();
    let token_for_task = cancel_token;
    let project_name = project.name.clone();

    let subtree_owned = subtree.map(str::to_string);
    let app_handle_for_panic = app_handle.clone();
    let scan_id_for_panic = scan_id_for_task.clone();
    let pool_for_panic = pool.clone();
    let project_id_for_panic = project_id.clone();
    let project_name_for_panic = project_name.clone();

    tokio::spawn(async move {
        let work = AssertUnwindSafe(async move {
        // Hold the per-project single-flight guard for the task's whole life;
        // it releases on drop when this task ends (success, error, or cancel).
        let _scan_guard = scan_guard;
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Context generation cancelled by user".into()))
            }
            res = run_context_generation(
                &app_handle,
                &scan_id_for_task,
                &pool,
                &project_id,
                &project_name,
                &resolved_root,
                existing_summary.as_deref(),
                delta_mode,
                subtree_owned.as_deref(),
            ) => res
        };

        match result {
            Ok(summary) => {
                let is_warning = summary.status == "completed_with_warning";
                let status_str = if is_warning {
                    "completed_with_warning"
                } else {
                    "completed"
                };
                CONTEXT_GEN_JOBS.set_status(
                    &app_handle,
                    &scan_id_for_task,
                    status_str,
                    summary.error.clone(),
                );
                let _ = app_handle.emit(event_name::CONTEXT_GEN_COMPLETE, &summary);
                crate::engine::system_ops::publish_context_scan_event(
                    &pool,
                    "completed",
                    &project_id,
                    &project_name,
                    json!({
                        "status": status_str,
                        "groups_created": summary.groups_created,
                        "contexts_created": summary.contexts_created,
                        "files_mapped": summary.files_mapped,
                        "scan_id": scan_id_for_task,
                    }),
                );
                // OS notification
                let title = if is_warning {
                    "Context Map Ready (with warning)"
                } else {
                    "Context Map Ready"
                };
                let body = if is_warning {
                    format!(
                        "{}: {} groups, {} contexts mapped (scan exceeded timeout — partial results saved).",
                        project_name, summary.groups_created, summary.contexts_created,
                    )
                } else {
                    format!(
                        "{}: {} groups, {} contexts mapped.",
                        project_name, summary.groups_created, summary.contexts_created,
                    )
                };
                crate::notifications::send(&app_handle, title, &body);
            }
            Err(e) => {
                let msg = format!("{e}");
                CONTEXT_GEN_JOBS.set_status(
                    &app_handle,
                    &scan_id_for_task,
                    "failed",
                    Some(msg.clone()),
                );
                CONTEXT_GEN_JOBS.emit_line(
                    &app_handle,
                    &scan_id_for_task,
                    format!("[Error] {msg}"),
                );
                crate::engine::system_ops::publish_context_scan_event(
                    &pool,
                    "completed",
                    &project_id,
                    &project_name,
                    json!({ "status": "failed", "error": msg, "scan_id": scan_id_for_task }),
                );
                crate::notifications::send(
                    &app_handle,
                    "Context Scan Failed",
                    &format!("{project_name}: {msg}"),
                );
            }
        }
        })
        .catch_unwind()
        .await;

        if let Err(panic) = work {
            let msg = extract_panic_message(panic);
            tracing::error!(
                scan_id = %scan_id_for_panic,
                panic = %msg,
                "context-map generation task panicked — marking scan as failed"
            );
            CONTEXT_GEN_JOBS.set_status(&app_handle_for_panic, &scan_id_for_panic, "failed", Some(msg.clone()));
            CONTEXT_GEN_JOBS.emit_line(&app_handle_for_panic, &scan_id_for_panic, format!("[Error] {msg}"));
            crate::engine::system_ops::publish_context_scan_event(
                &pool_for_panic,
                "completed",
                &project_id_for_panic,
                &project_name_for_panic,
                json!({ "status": "failed", "error": msg, "scan_id": scan_id_for_panic }),
            );
            crate::notifications::send(
                &app_handle_for_panic,
                "Context Scan Failed",
                &format!("{project_name_for_panic}: internal error during scan"),
            );
        }
    });

    Ok(json!({ "scan_id": scan_id, "is_rescan": is_rescan, "delta_mode": delta_mode }))
}

#[tauri::command]
pub async fn dev_tools_cancel_scan_codebase(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    scan_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    if let Some(token) = CONTEXT_GEN_JOBS.get_cancel_token(&scan_id)? {
        token.cancel();
        CONTEXT_GEN_JOBS.set_status(&app, &scan_id, "cancelled", None);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn dev_tools_get_scan_codebase_status(
    state: State<'_, Arc<AppState>>,
    scan_id: String,
) -> Result<serde_json::Value, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let jobs = CONTEXT_GEN_JOBS.lock()?;
    if let Some(job) = jobs.get(&scan_id) {
        Ok(json!({
            "scan_id": scan_id,
            "status": job.status,
            "error": job.error,
            "lines": job.lines,
        }))
    } else {
        Ok(json!({ "scan_id": scan_id, "status": "not_found" }))
    }
}

/// HTTP-bridge accessor for a scan's status — mirrors
/// `dev_tools_get_scan_codebase_status` without the IPC `State`, for the
/// local_http `/dev-tools/scan-status/{id}` route.
pub(crate) fn scan_status_json(scan_id: &str) -> serde_json::Value {
    match CONTEXT_GEN_JOBS.lock() {
        Ok(jobs) => match jobs.get(scan_id) {
            Some(job) => json!({ "scan_id": scan_id, "status": job.status, "error": job.error, "lines": job.lines }),
            None => json!({ "scan_id": scan_id, "status": "not_found" }),
        },
        Err(_) => json!({ "scan_id": scan_id, "status": "error", "error": "scan registry lock poisoned" }),
    }
}

/// Every context scan this process knows about for one project, newest-agnostic
/// (the registry is a map, so order is not meaningful — callers should read
/// `status`). Powers `/dev-tools/scans/{project_id}`, whose reason for existing is
/// that a client which lost (or never saw) a scan_id previously had no way to ask
/// "is this subtree already being scanned?" and would relaunch it — paying twice
/// and producing two maps of the same tree.
///
/// `lines` is deliberately omitted: this is an index, and a completed scan's line
/// stream is thousands of entries. Poll `/scan-status/{id}` for one scan's detail.
pub(crate) fn list_scans_json(project_id: &str) -> serde_json::Value {
    match CONTEXT_GEN_JOBS.lock() {
        Ok(jobs) => {
            let mut scans: Vec<serde_json::Value> = jobs
                .iter()
                .filter(|(_, job)| job.extra.project_id == project_id)
                .map(|(id, job)| {
                    json!({
                        "scan_id": id,
                        "status": job.status,
                        "error": job.error,
                        // None = whole-tree. Matches the single-flight scope key.
                        "subtree": job.extra.subtree,
                        "lines": job.lines.len(),
                    })
                })
                .collect();
            // Stable output so a diff between two polls is readable.
            scans.sort_by(|a, b| a["scan_id"].as_str().cmp(&b["scan_id"].as_str()));
            let running = scans.iter().filter(|s| s["status"] == "running").count();
            json!({ "project_id": project_id, "running": running, "scans": scans })
        }
        Err(_) => {
            json!({ "project_id": project_id, "error": "scan registry lock poisoned", "scans": [] })
        }
    }
}

// =============================================================================
// Core generation logic
// =============================================================================

/// Trees that are NOT hand-written source and must never become contexts:
/// generated output, vendored deps, build artifacts, and translation data.
///
/// This list is shared by the coverage counter AND the write path on purpose.
/// They used to disagree — the counter excluded `section-locales` while nothing
/// stopped the scan from mapping it, so an i18n subtree scan swept 807 locale
/// JSON files into 15 contexts named `section-locales-ar`, `-bn`, … and the
/// coverage line read 5871%. One list, one meaning, both sides.
pub(crate) const NON_SOURCE_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "dist", "build",
    "bindings", "section-locales", "locales", ".claude", "coverage",
    // Python build/vendor trees. Added with `py` below: before Python was
    // mappable these could not appear, so their absence was harmless. Now that a
    // context may own `.py`, a vendored virtualenv or a __pycache__ tree would
    // otherwise become mappable for the first time.
    "__pycache__", ".venv", "venv", ".tox", ".pytest_cache", "site-packages", ".mypy_cache",
];

/// Extensions a context may legitimately own — hand-written CODE only.
///
/// Deliberately narrower than `incremental_scan::SOURCE_EXTENSIONS` (the walker
/// that decides what the model gets to READ): config and data formats
/// (`toml`/`yaml`/`json`/`md`) are worth showing a model for background, but a
/// context that CLAIMS them maps description rather than implementation — and
/// locale JSON is exactly how a subtree scan once produced 15 `section-locales-*`
/// contexts and a 5871% coverage line.
///
/// Non-TS/Rust languages were missing here while `incremental_scan` accepted
/// them, so the scan showed the model e.g. Python, let it build correct contexts,
/// and then dropped every one of them as "non-source" (a Python-majority repo
/// silently mapped to nothing and still reported success). Keep this list in step
/// with `incremental_scan::SOURCE_EXTENSIONS` minus the data/doc formats.
pub(crate) const SOURCE_EXTS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "swift", "c", "cpp",
    "cc", "h", "hpp", "cs", "rb", "php", "scala", "lua", "ex", "exs", "vue", "svelte", "sql",
    "css", "scss",
];

/// Is this repo-relative path something a context is allowed to claim?
pub(crate) fn is_mappable_path(path: &str) -> bool {
    let norm = path.replace('\\', "/");
    let mut segments: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    // The last segment is the FILENAME; everything before it is a directory.
    let Some(file_name) = segments.pop() else {
        return false;
    };
    // Reject hidden DIRECTORIES the same way `count_source_files` does. The two
    // used to disagree: the counter skipped every hidden dir while this side
    // skipped only the named ones, so a model-emitted path under `.next/`,
    // `.github/` or `.turbo/` passed the write filter yet was absent from the
    // denominator — coverage above 100%, from the very divergence the
    // NON_SOURCE_DIRS comment above claims to have closed. One meaning, both sides.
    //
    // `.` and `..` are path noise, not hidden dirs — a model that emits
    // `./app/x.ts` means `app/x.ts`, and rejecting it would strand real source.
    // The rule deliberately does NOT apply to the filename: a dotfile like
    // `.eslintrc.js` is a real hand-written file, and the counter accepts it too
    // (it only tests `starts_with('.')` on directory entries).
    if segments
        .iter()
        .any(|seg| (seg.starts_with('.') && *seg != "." && *seg != "..") || NON_SOURCE_DIRS.contains(seg))
    {
        return false;
    }
    let norm = file_name;
    // Extension match is case-insensitive: a `.PY`/`.TSX` file is the same source
    // file, and rejecting it would silently strand it exactly like `.py` was.
    match norm.rsplit_once('.') {
        Some((_, ext)) => {
            let lower = ext.to_ascii_lowercase();
            SOURCE_EXTS.contains(&lower.as_str())
        }
        None => false,
    }
}

/// Count hand-written source files under `root`, optionally narrowed to a
/// subtree, so the completion line can state coverage instead of a bare count.
///
/// Deliberately excludes generated output (`src/lib/bindings` is ~950 ts-rs
/// files on this repo) and vendored trees — counting those would depress the
/// percentage and make the warning meaningless. Returns `None` if the tree
/// cannot be walked; a missing figure is better than a wrong one.
fn count_source_files(root: &str, subtree: Option<&str>) -> Option<usize> {

    let base = match subtree {
        Some(st) => std::path::Path::new(root).join(st),
        None => std::path::PathBuf::from(root),
    };
    if !base.is_dir() {
        return None;
    }
    let mut count = 0usize;
    let mut stack = vec![base];
    // Bound the walk so a pathological tree cannot stall the completion line.
    let mut budget = 200_000usize;
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            if budget == 0 {
                return Some(count);
            }
            budget -= 1;
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if path.is_dir() {
                if !name.starts_with('.') && !NON_SOURCE_DIRS.contains(&name.as_ref()) {
                    stack.push(path);
                }
            } else if path
                .extension()
                .and_then(|e| e.to_str())
                // Case-insensitive, matching is_mappable_path — otherwise a
                // `.PY` file counts on one side and not the other.
                .is_some_and(|e| SOURCE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
            {
                count += 1;
            }
        }
    }
    Some(count)
}

/// Delete only the contexts that live ENTIRELY inside `subtree`, so a
/// subtree rescan replaces its own scope without touching anything else.
///
/// "Entirely" is the safety property that matters: a context spanning the
/// boundary (some files inside the subtree, some outside) is LEFT ALONE. Deleting
/// it would silently drop the outside files from the map, and the scanning
/// session — which was only shown its own subtree — has no way to recreate them.
/// Such a context is reported instead, because a boundary-spanning context is a
/// signal the subtree split was drawn in the wrong place.
///
/// Groups are never deleted: they are shared across subtrees, and an empty group
/// is harmless where a missing one breaks every context that referenced it.
fn stale_subtree_contexts(
    pool: &crate::db::DbPool,
    project_id: &str,
    subtree: &str,
) -> (Vec<String>, usize) {
    let contexts = repo::list_contexts_by_project(pool, project_id, None).unwrap_or_default();
    // Compare with forward slashes both sides — file_paths are stored
    // repo-relative with `/` regardless of host platform.
    let prefix = format!("{}/", subtree.trim_end_matches('/').replace('\\', "/"));
    let (mut stale, mut straddling) = (Vec::new(), 0usize);
    for c in contexts {
        let paths: Vec<String> = serde_json::from_str(&c.file_paths).unwrap_or_default();
        if paths.is_empty() {
            continue;
        }
        let inside = paths
            .iter()
            .filter(|p| p.replace('\\', "/").starts_with(&prefix))
            .count();
        if inside == paths.len() {
            stale.push(c.id.clone());
        } else if inside > 0 {
            straddling += 1;
        }
    }
    (stale, straddling)
}

async fn run_context_generation(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    project_name: &str,
    root_path: &str,
    existing_summary: Option<&str>,
    delta_mode: bool,
    subtree: Option<&str>,
) -> Result<ContextGenSummary, AppError> {
    let is_rescan = existing_summary.is_some();

    // A full rescan DELETEs unpinned contexts and recreates them under fresh
    // ids, which cascades away the use-case slice and NULLs context-scoped
    // KPIs. Capture those links by context NAME now; `reconcile_links` restores
    // them once the new map is written. Delta rescans never delete contexts, so
    // reconciliation there is an idempotent no-op.
    let link_snapshot = if is_rescan {
        repo::snapshot_context_links(pool, project_id).unwrap_or_default()
    } else {
        repo::ContextLinkSnapshot::default()
    };

    // ---- Delta-mode branch ----------------------------------------------------
    // Compute the delta first so we can:
    //   (a) short-circuit when nothing changed since the last successful scan,
    //   (b) feed the LLM only the changed files (saves tokens vs full rescan),
    //   (c) preserve the existing context_map (don't clear it — we're updating).
    // Cache absence falls back to the legacy full-scan path so first scans behave
    // exactly as before.
    let delta_for_prompt = if delta_mode && is_rescan {
        let cached = repo::get_file_hashes(pool, project_id).unwrap_or_default();
        let root_owned = std::path::PathBuf::from(root_path);
        let walked = tokio::task::spawn_blocking(move || {
            super::incremental_scan::walk_project_files(&root_owned)
        })
        .await
        .map_err(|e| AppError::Internal(format!("delta walk join: {e}")))?
        .ok();

        match walked {
            Some(current) if !cached.is_empty() => {
                let delta = super::incremental_scan::compute_delta(&cached, &current);
                if delta.is_empty() {
                    CONTEXT_GEN_JOBS.emit_line(
                        app,
                        scan_id,
                        format!(
                            "[Milestone] Delta scan: no source changes detected since last scan ({} files unchanged). Skipping LLM call.",
                            delta.unchanged_count
                        ),
                    );
                    return Ok(ContextGenSummary {
                        scan_id: scan_id.to_string(),
                        groups_created: 0,
                        contexts_created: 0,
                        files_mapped: 0,
                        status: "completed".to_string(),
                        error: None,
                    });
                }
                CONTEXT_GEN_JOBS.emit_line(
                    app,
                    scan_id,
                    format!(
                        "[Milestone] Delta scan: {} added, {} modified, {} deleted ({} unchanged).",
                        delta.added.len(),
                        delta.modified.len(),
                        delta.deleted.len(),
                        delta.unchanged_count,
                    ),
                );
                Some(delta)
            }
            _ => {
                CONTEXT_GEN_JOBS.emit_line(
                    app,
                    scan_id,
                    "[Milestone] Delta mode requested but cache is empty — running full scan and seeding cache.".to_string(),
                );
                None
            }
        }
    } else {
        None
    };

    // Legacy rescan path: the old map is cleared LAZILY — only once the LLM
    // produces its first group/context (see `map_cleared` in the stream loop) —
    // so a rescan that fails before producing anything (CLI missing, non-zero
    // exit, user cancel, zero/garbage output) leaves the hand-curated map intact
    // instead of destroying it up-front. Skipped entirely for delta rescans,
    // where existing IDs must stay live.
    if is_rescan && delta_for_prompt.is_none() {
        CONTEXT_GEN_JOBS.emit_line(
            app,
            scan_id,
            "[Milestone] Rescan: regenerating context map (old map kept until fresh output arrives)..."
                .to_string(),
        );
    }

    let mode_label = if delta_for_prompt.is_some() {
        "Delta-rescanning"
    } else if is_rescan {
        "Rescanning"
    } else {
        "Scanning"
    };
    CONTEXT_GEN_JOBS.emit_line(
        app,
        scan_id,
        format!("[Milestone] {mode_label} codebase: {project_name}..."),
    );

    // Build the prompt. In delta mode we KEEP existing_summary so the LLM has
    // the context IDs to update; in legacy rescan we drop it (cleared above).
    // In first-scan mode both are None.
    let (summary_for_prompt, briefing) = if let Some(ref delta) = delta_for_prompt {
        let briefing = DeltaBriefing {
            added: &delta.added,
            modified: &delta.modified,
            deleted: &delta.deleted,
            unchanged_count: delta.unchanged_count,
        };
        (existing_summary, Some(briefing))
    } else {
        (None, None)
    };
    let prompt_text = build_context_generation_prompt(
        project_id,
        project_name,
        root_path,
        summary_for_prompt,
        briefing.as_ref(),
        subtree,
        &repo::list_context_groups(pool, project_id)
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect::<Vec<_>>(),
    );

    // Spawn CLI in the project root so Claude can explore it. Subscription
    // auth is enforced unconditionally by spawn_headless_claude.
    let exec_dir = std::path::PathBuf::from(root_path);
    let mut child = crate::engine::cli_process::spawn_headless_claude(
        prompt_text,
        "claude-sonnet-4-6",
        &[],
        Some(&exec_dir),
        true,
    )?;

    CONTEXT_GEN_JOBS.emit_line(
        app,
        scan_id,
        "[Milestone] Claude CLI started. Analyzing codebase...",
    );

    // Capture stderr into a bounded ring buffer AND tee it to the live log
    // panel so the user can see auth errors / rate-limit notices / missing
    // config in real time. The buffer is also attached to any Err this scan
    // returns, turning an opaque "generation timed out" into actionable detail.
    let stderr_ring: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let ring = stderr_ring.clone();
        let app_clone = app.clone();
        let scan_id_clone = scan_id.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                push_stderr_line(&ring, &line);
                CONTEXT_GEN_JOBS.emit_line(&app_clone, &scan_id_clone, format!("[stderr] {line}"));
            }
        });
    }

    // Stream stdout line by line
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut group_name_to_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut groups_created = 0i32;
    let mut contexts_created = 0i32;
    let mut files_mapped = 0i32;
    let mut unique_files: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Protocol messages arrive TWICE. The CLI runs with `--verbose`, which makes
    // it emit each assistant turn both as a JSON event and as a plain-text line
    // (documented in CLAUDE.md for output display); `extract_display_text`
    // returns text for both, so every `context_map_context` was parsed and
    // INSERTed twice. Live result: 250 duplicate context names with identical
    // file lists, and a slot count that was exactly 2.0x distinct on every scan
    // — that suspicious precision is what exposed it. Dedupe by name within the
    // scan; a context emitted twice is one context either way.
    let mut seen_contexts: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Lazy clear: only wipe the existing map once the run produces its first real
    // output, so a failed/empty rescan can't destroy the curated map up-front.
    //
    // A SUBTREE scan must never take this path. `clear_project_context_map`
    // deletes the whole project's contexts and groups — run concurrently across
    // ten subtrees, the first one to emit would wipe the nine others' work while
    // still reporting success. Subtree scans clear only their own scope instead
    // (see `clear_subtree_contexts` below), and never touch groups, which are
    // shared across scopes by design.
    let needs_lazy_clear = is_rescan && delta_for_prompt.is_none() && subtree.is_none();
    let mut map_cleared = false;
    let mut subtree_cleared = false;
    let mut subtree_stale_ids: Vec<String> = Vec::new();

    // Extended to 30 minutes to handle large codebases.
    // If timeout fires but contexts were already committed, the scan is treated
    // as a partial success (see check below after the loop).
    let timeout_duration = std::time::Duration::from_secs(1800);
    let spend_ctx = crate::db::repos::llm_spend::SpendCtx {
        source: "scanner",
        trigger_kind: "context_gen",
        model: Some("claude-sonnet-4-6"),
        project_id: Some(project_id),
        persona_id: None,
    };
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            // tiger #1: record the headless spend `result` line (no-op otherwise).
            crate::db::repos::llm_spend::observe_line(pool, &spend_ctx, &line);

            if let Some(text) = extract_display_text(&line) {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }

                // Record the model's prose to the bounded ring but do NOT stream
                // it over IPC. This is the bulk of a scan's output (Claude's
                // reasoning between tool calls) and the live overlay only needs
                // the high-level milestones below — the user asked for
                // "working/done", not the running log. The full text stays
                // inspectable via the status snapshot.
                CONTEXT_GEN_JOBS.record_line(scan_id, trimmed.to_string());

                // Parse protocol messages from assistant output
                for proto_line in trimmed.lines() {
                    let proto_trimmed = proto_line.trim();
                    if let Some(protocol) = parse_context_map_protocol(proto_trimmed) {
                        match protocol {
                            ContextMapProtocol::Group { project_id: pid, name, color, domain } => {
                                if let (Some(st), false) = (subtree, subtree_cleared) {
                                    subtree_cleared = true;
                                    // Mark, do NOT delete. The old rows stay until this
                                    // scan has actually produced a map worth swapping in
                                    // — see the retire step after the stream loop.
                                    let (stale, straddling) = stale_subtree_contexts(pool, project_id, st);
                                    let gone = stale.len();
                                    subtree_stale_ids = stale;
                                    CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!(
                                        "[Milestone] Subtree {st}: {gone} existing context(s) marked for replacement."
                                    ));
                                    if straddling > 0 {
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!(
                                            "[Warning] {straddling} context(s) span the {st} boundary and were left untouched —                                              they hold files this scan cannot see, so the subtree split may be drawn wrong."
                                        ));
                                    }
                                }
                                if needs_lazy_clear && !map_cleared {
                                    let _ = repo::clear_project_context_map(pool, project_id);
                                    map_cleared = true;
                                    CONTEXT_GEN_JOBS.emit_line(app, scan_id, "[Milestone] First fresh output — cleared old map, swapping in new.".to_string());
                                }
                                // Groups are shared across concurrent subtree scans, and
                                // `create_context_group` does not upsert on name — three
                                // concurrent scans each emitting "Automation & Pipelines"
                                // produced three groups with that name (observed live,
                                // 2026-07-29: seven duplicates). Adopt an existing
                                // same-named group instead; only create when none exists.
                                let existing = repo::list_context_groups(pool, &pid)
                                    .unwrap_or_default()
                                    .into_iter()
                                    .find(|g| g.name == name);
                                let created = match existing {
                                    Some(g) => {
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Reused] Group: {name}"));
                                        Ok(g)
                                    }
                                    None => repo::create_context_group(pool, &pid, &name, Some(&color), None, None, domain.as_deref()),
                                };
                                match created {
                                    Ok(group) => {
                                        group_name_to_id.insert(name.clone(), group.id.clone());
                                        groups_created += 1;
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Created] Group: {name}"));
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "Failed to create context group: {name}");
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Warn] Group '{name}': {e}"));
                                    }
                                }
                            }
                            ContextMapProtocol::Context {
                                project_id: pid, group_name, name, description,
                                file_paths, entry_points, keywords, db_tables,
                                api_surface, cross_refs, tech_stack,
                                category, business_feature,
                            } => {
                                // See `seen_contexts`: every protocol message is
                                // delivered twice, so the second sighting must not
                                // become a second row.
                                if !seen_contexts.insert(name.clone()) {
                                    continue;
                                }
                                if needs_lazy_clear && !map_cleared {
                                    let _ = repo::clear_project_context_map(pool, project_id);
                                    map_cleared = true;
                                    CONTEXT_GEN_JOBS.emit_line(app, scan_id, "[Milestone] First fresh output — cleared old map, swapping in new.".to_string());
                                }
                                // Drop anything outside the source surface before it
                                // is stored — see NON_SOURCE_DIRS. A context whose
                                // files were ALL non-source (the `section-locales-ar`
                                // shape) is not a context at all, so skip it entirely
                                // rather than writing an empty one.
                                let dropped = file_paths.len();
                                let file_paths: Vec<String> =
                                    file_paths.into_iter().filter(|p| is_mappable_path(p)).collect();
                                let dropped = dropped - file_paths.len();
                                if file_paths.is_empty() {
                                    CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!(
                                        "[Skipped] Context: {name} — every path was generated or non-source"
                                    ));
                                    continue;
                                }
                                if dropped > 0 {
                                    CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!(
                                        "[Trimmed] Context: {name} — dropped {dropped} generated/non-source path(s)"
                                    ));
                                }
                                let group_id = group_name_to_id.get(&group_name).cloned();
                                let file_count = file_paths.len() as i32;
                                let fp_json = serde_json::to_string(&file_paths).unwrap_or_else(|_| "[]".into());
                                let ep_json = serde_json::to_string(&entry_points).unwrap_or_else(|_| "[]".into());
                                let kw_json = serde_json::to_string(&keywords).unwrap_or_else(|_| "[]".into());
                                let db_json = if db_tables.is_empty() { None } else { Some(serde_json::to_string(&db_tables).unwrap_or_else(|_| "[]".into())) };
                                let cr_json = if cross_refs.is_empty() { None } else { Some(serde_json::to_string(&cross_refs).unwrap_or_else(|_| "[]".into())) };
                                let ts_json = serde_json::to_string(&tech_stack).unwrap_or_else(|_| "[]".into());

                                match repo::create_context(
                                    pool, &pid, &name, group_id.as_deref(), description.as_deref(),
                                    Some(&fp_json), Some(&ep_json), db_json.as_deref(), Some(&kw_json), api_surface.as_deref(), cr_json.as_deref(), Some(&ts_json),
                                    category.as_deref(), business_feature.as_deref(),
                                ) {
                                    Ok(_) => {
                                        contexts_created += 1;
                                        files_mapped += file_count;
                                        // `files_mapped` sums path SLOTS across contexts, and
                                        // the model routinely files one path under several
                                        // contexts — live run reported "176 of 88 files (200%)".
                                        // Coverage must be judged on DISTINCT paths.
                                        unique_files.extend(file_paths.iter().cloned());
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Created] Context: {name} ({file_count} files)"));
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "Failed to create context: {name}");
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Warn] Context '{name}': {e}"));
                                    }
                                }
                            }
                            ContextMapProtocol::Update { context_id, description, file_paths, keywords } => {
                                let fp_json = file_paths.map(|fp| serde_json::to_string(&fp).unwrap_or_else(|_| "[]".into()));
                                let kw_json = keywords.map(|kw| serde_json::to_string(&kw).unwrap_or_else(|_| "[]".into()));
                                match repo::update_context(
                                    pool, &context_id,
                                    None, // name
                                    description.as_ref().map(|d| Some(d.as_str())),
                                    fp_json.as_deref(),
                                    None, None,
                                    kw_json.as_ref().map(|k| Some(k.as_str())),
                                    None, None, None,
                                    None, None, // category, business_feature
                                ) {
                                    Ok(_) => {
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Updated] Context: {context_id}"));
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "Failed to update context: {context_id}");
                                    }
                                }
                            }
                            ContextMapProtocol::Summary { groups_created: g, contexts_created: c, files_mapped: f } => {
                                CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Summary] {g} groups, {c} contexts, {f} files mapped"));
                            }
                        }
                    }
                }
            } else {
                // Surface tool usage and result events
                let (line_type, _) = parse_stream_line(&line);
                match line_type {
                    StreamLineType::AssistantToolUse { tool_name, input_preview } => {
                        let preview =
                            crate::utils::text::truncate_on_char_boundary(&input_preview, 100);
                        // Tool lines are short (≤~130 bytes) and are the only
                        // signal of liveness during Claude's exploration phase —
                        // keep them on the live stream so the overlay doesn't
                        // look frozen. The verbose *prose* (recorded above) is the
                        // volume hog we keep off IPC, not these.
                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Tool] {tool_name}: {preview}"));
                    }
                    StreamLineType::Result { .. } => {
                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, "[Milestone] Analysis complete.");
                    }
                    _ => {}
                }
            }
        }
    })
    .await;

    // On timeout, kill the child explicitly to avoid zombie processes.
    if stream_result.is_err() {
        let _ = child.kill().await;
    }
    let wait_result = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;

    let timed_out = stream_result.is_err();

    // Smart timeout handling: if any work was committed, treat the scan as a
    // partial success rather than a hard failure. The user can see the contexts
    // in the database, so reporting "failed" would be misleading.
    if timed_out {
        if groups_created > 0 || contexts_created > 0 {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!(
                    "[Warning] Scan timed out after 30 minutes but {groups_created} groups and {contexts_created} contexts were created. Treating as partial success."
                ),
            );
            // Persist hashes even on partial success — better to under-detect
            // changes next time than to over-trigger full rescans.
            persist_scan_hashes(app, scan_id, pool, project_id, root_path).await;
            reconcile_links(app, scan_id, pool, project_id, &link_snapshot);
            write_harness_docs(app, scan_id, pool, project_id, root_path);
            return Ok(ContextGenSummary {
                scan_id: scan_id.to_string(),
                groups_created,
                contexts_created,
                files_mapped,
                status: "completed_with_warning".to_string(),
                error: Some(
                    "Scan exceeded 30-minute timeout but partial results were saved".to_string(),
                ),
            });
        }
        // Attach captured stderr so the user can attribute the timeout — an
        // auth error / rate limit / CLI crash produces stderr long before the
        // 30-minute timeout fires, and we now surface it instead of dropping it.
        let stderr_tail = snapshot_stderr(&stderr_ring);
        let detail = if stderr_tail.is_empty() {
            String::from("Context generation timed out after 30 minutes with no contexts created (no Claude CLI stderr captured)")
        } else {
            format!(
                "Context generation timed out after 30 minutes with no contexts created. Claude CLI stderr (last {} bytes):\n{stderr_tail}",
                stderr_tail.len()
            )
        };
        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Error] {detail}"));
        return Err(AppError::Internal(detail));
    }

    // Fast-failure path: if the CLI exited non-zero AND we have nothing to show
    // for it, treat it as a failure even though stdout closed normally before
    // the timeout — and attach the captured stderr so the user can see the
    // cause (expired credentials, rate limit, crash) instead of a silent
    // "completed with 0 contexts" success.
    if let Ok(Ok(status)) = wait_result {
        if !status.success() && groups_created == 0 && contexts_created == 0 {
            let stderr_tail = snapshot_stderr(&stderr_ring);
            let detail = if stderr_tail.is_empty() {
                format!(
                    "Claude CLI exited with status {} and produced no contexts (no stderr captured)",
                    status.code().unwrap_or(-1)
                )
            } else {
                format!(
                    "Claude CLI exited with status {} and produced no contexts. stderr (last {} bytes):\n{stderr_tail}",
                    status.code().unwrap_or(-1),
                    stderr_tail.len()
                )
            };
            CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Error] {detail}"));
            return Err(AppError::Internal(detail));
        }
    }

    // Retire the previous generation ONLY now, with the new map already written.
    // The clear used to fire the moment the first group arrived, so a scan that
    // then died left the subtree gutted — measured: `src/features/agents` went
    // from 442 mapped files to 5 when its CLI child was killed and the run hit
    // the 30-minute timeout having created 0 contexts. Deleting last means the
    // worst case is a duplicate generation (repairable) instead of an empty one
    // (not).
    if !subtree_stale_ids.is_empty() {
        if contexts_created == 0 {
            CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!(
                "[Kept] Scan produced no contexts — left all {} existing context(s) in place.",
                subtree_stale_ids.len()
            ));
        } else {
            let mut retired = 0usize;
            for id in &subtree_stale_ids {
                if repo::delete_context(pool, id).unwrap_or(false) {
                    retired += 1;
                }
            }
            CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!(
                "[Replaced] Retired {retired} superseded context(s) after writing {contexts_created} new one(s)."
            ));
        }
    }

    CONTEXT_GEN_JOBS.emit_line(
        app,
        scan_id,
        format!(
            "[Complete] Created {groups_created} groups, {contexts_created} contexts, {files_mapped} files mapped"
        ),
    );

    // Coverage assertion. `files_mapped` has always been reported and never
    // checked against anything, which is how this project ran for months on a
    // map covering 9% of its own source while every surface treated it as
    // complete. A scan that maps a fraction of the tree is not a successful
    // scan; it is a scan that ran out of room. Say so, in the line the operator
    // actually reads.
    if let Some(total) = count_source_files(root_path, subtree) {
        let scope = subtree.unwrap_or("the repository");
        if total > 0 {
            // The numerator must be measured over the SAME scope as the
            // denominator. A subtree scan legitimately emits a few paths
            // outside its scope (a preserved straddling context still owns
            // them), and counting those against a subtree-only total produced
            // "317 of 311 (102%)" — a number that cannot mean anything.
            let distinct = match subtree {
                Some(st) => {
                    let prefix = format!("{}/", st.trim_end_matches('/').replace('\\', "/"));
                    unique_files
                        .iter()
                        .filter(|p| p.replace('\\', "/").starts_with(&prefix))
                        .count()
                }
                None => unique_files.len(),
            };
            let pct = (distinct as f64 / total as f64) * 100.0;
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!(
                    "[Coverage] Mapped {distinct} of {total} source files in {scope} ({pct:.0}%){}",
                    if files_mapped as usize > unique_files.len() {
                        format!(
                            " — {} path slots for {} distinct paths, so the map assigns {} extra slot(s) to files that sit in more than one context",
                            files_mapped,
                            unique_files.len(),
                            files_mapped as usize - unique_files.len()
                        )
                    } else { String::new() }
                ),
            );
            // Two-thirds is the line between "some judgement was applied about
            // what deserves a context" and "this stopped early".
            if pct < 66.0 {
                CONTEXT_GEN_JOBS.emit_line(
                    app,
                    scan_id,
                    format!(
                        "[Warning] Coverage is low ({pct:.0}%). {} Re-run scoped to smaller subtrees \
                         so each scan has room to emit its whole map.",
                        if subtree.is_some() {
                            "This subtree still did not finish."
                        } else {
                            "One session cannot emit a map for a codebase this size."
                        }
                    ),
                );
            }
        }
    }

    // Snapshot the live source tree into the per-file hash cache so the next
    // scan can run in delta mode. Always overwrites — anything missing from
    // the live snapshot is dropped (deleted files don't accumulate).
    persist_scan_hashes(app, scan_id, pool, project_id, root_path).await;

    // Bounded self-heal: drop file_paths that no longer exist on disk so the
    // exported map can't route a CLI to a deleted file. This is ktx's
    // referential-integrity auto-prune, minus the hard abort — a scan must
    // never fail here; it just tidies before publishing.
    prune_dangling_file_paths(app, scan_id, pool, project_id, root_path);

    // Restore the use-case slice + context-scoped KPIs the rebuild detached.
    reconcile_links(app, scan_id, pool, project_id, &link_snapshot);

    // Ask the detector. A whole-tree scan rebuilds the map wholesale, which is
    // exactly when a reference can start naming nothing — and the audit that
    // catches it has existed, tested and registered, with zero callers. Advisory:
    // it reports on the stream and never fails the scan.
    if subtree.is_none() {
        report_context_audit(app, scan_id, pool, project_id);
    }

    // Write the server-free harness docs (context-map.json + managed CLAUDE.md
    // section) into the managed project so a CLI opened there sees the map.
    write_harness_docs(app, scan_id, pool, project_id, root_path);

    Ok(ContextGenSummary {
        scan_id: scan_id.to_string(),
        groups_created,
        contexts_created,
        files_mapped,
        status: "completed".to_string(),
        error: None,
    })
}

/// Re-attach the links a full rescan detached, keyed by context name. Never
/// fails a scan: a reconciliation error is reported on the stream and the map
/// still publishes.
fn reconcile_links(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    snapshot: &repo::ContextLinkSnapshot,
) {
    if snapshot.is_empty() {
        return;
    }
    match repo::reconcile_context_links(pool, project_id, snapshot) {
        Ok(report) if report.relinked > 0 || report.dropped > 0 => {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!(
                    "[Milestone] Reconciled context links: {} restored, {} dropped (context no longer exists)",
                    report.relinked, report.dropped
                ),
            );
        }
        Ok(_) => {}
        Err(e) => {
            tracing::error!("context link reconciliation failed: {e}");
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!("[Warning] Could not reconcile use-case / KPI context links: {e}"),
            );
        }
    }
}

/// Walk the project root + replace `dev_context_file_hashes` for this project.
/// Errors are logged but do NOT fail the scan — a missing hash cache just means
/// the next scan falls back to a full rescan, which is the legacy behavior.
async fn persist_scan_hashes(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    root_path: &str,
) {
    let root_owned = std::path::PathBuf::from(root_path);
    let walk_result = tokio::task::spawn_blocking(move || {
        super::incremental_scan::walk_project_files(&root_owned)
    })
    .await;

    let entries = match walk_result {
        Ok(Ok(e)) => e,
        Ok(Err(e)) => {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!("[Warn] Hash cache walk failed: {e}. Next scan will be a full rescan."),
            );
            return;
        }
        Err(e) => {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!("[Warn] Hash cache walk panicked: {e}. Next scan will be a full rescan."),
            );
            return;
        }
    };

    let entry_tuples: Vec<(String, String, i64)> = entries
        .into_iter()
        .map(|e| (e.path, e.sha256, e.size_bytes))
        .collect();
    let count = entry_tuples.len();
    match repo::replace_file_hashes(pool, project_id, &entry_tuples) {
        Ok(n) => {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!("[Cache] Wrote {n} file hashes (out of {count} walked)."),
            );
        }
        Err(e) => {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!(
                    "[Warn] Failed to persist hash cache: {e}. Next scan will be a full rescan."
                ),
            );
        }
    }
}

/// Bounded self-heal run at scan completion: for each context, drop any
/// `file_paths` entry that no longer exists on disk, then persist the pruned
/// list. Files are checked by real filesystem existence (not walk membership)
/// so a legitimately-mapped non-source file is never falsely pruned. Never
/// fails the scan — every error is logged and swallowed. The pruned-count is
/// surfaced on the live stream so the maintainer sees the map was tidied.
///
/// Portable methodics note (phase 2 / Vibeman): the contract is "a published
/// context map contains no reference to a path that isn't on disk." Any scanner
/// can honor it with this same post-scan prune.
fn prune_dangling_file_paths(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    root_path: &str,
) {
    let contexts = match repo::list_contexts_by_project(pool, project_id, None) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "self-heal: list contexts failed; skipping prune");
            return;
        }
    };
    let root = std::path::PathBuf::from(root_path);
    let mut files_pruned = 0usize;
    let mut contexts_touched = 0usize;

    for c in &contexts {
        let files: Vec<String> = match serde_json::from_str(&c.file_paths) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(context_id = %c.id, error = %e, "self-heal: unparseable file_paths; skipping prune for this context");
                continue;
            }
        };
        if files.is_empty() {
            continue;
        }
        let kept: Vec<String> = files
            .iter()
            .filter(|f| root.join(f).exists())
            .cloned()
            .collect();
        if kept.len() == files.len() {
            continue;
        }
        files_pruned += files.len() - kept.len();
        contexts_touched += 1;
        let kept_json = serde_json::to_string(&kept).unwrap_or_else(|_| "[]".into());
        if let Err(e) = repo::update_context(
            pool,
            &c.id,
            None,
            None,
            Some(&kept_json),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ) {
            tracing::warn!(error = %e, context = %c.name, "self-heal: prune update failed");
        }
    }

    if files_pruned > 0 {
        CONTEXT_GEN_JOBS.emit_line(
            app,
            scan_id,
            format!(
                "[Heal] Pruned {files_pruned} dangling file path(s) from {contexts_touched} context(s) before publishing."
            ),
        );
    }
}

/// Run the advisory context audit and put its verdict on the scan stream, where
/// the operator already reads `[Coverage]` and `[Heal]`.
///
/// Advisory by contract (`context_audit.rs:4-5`): a governance scanner that can
/// fail a save is a scanner people disable. So this only ever reports — an
/// error here is a warning line, and the scan publishes either way. The verdict
/// is retained in the job's output ring (readable via scan-status) and mirrored
/// to the tracing log, so it survives the window closing.
fn report_context_audit(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
) {
    match super::context_audit::audit_from_db(pool, project_id) {
        Ok(report) => {
            let line = super::context_audit::summarize(&report);
            tracing::info!(project_id, audit = %line, "post-scan context audit");
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!(
                    "[{}] {line}",
                    if report.balanced { "Audit" } else { "Audit — attention" }
                ),
            );
            if report.totals.unresolved_cross_refs > 0 {
                CONTEXT_GEN_JOBS.emit_line(
                    app,
                    scan_id,
                    format!(
                        "[Audit] {} cross-ref(s) name a context that does not exist. Every agent \
                         navigating by this map reads them as real. Run the cross-ref repair \
                         (dry run first) or fix them on the Context Map.",
                        report.totals.unresolved_cross_refs
                    ),
                );
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "post-scan context audit failed");
            CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Warning] Context audit skipped: {e}"));
        }
    }
}

/// Write the project-side harness docs (`context-map.json` + the managed
/// `CLAUDE.md` section) so a CLI working directly in the managed project sees
/// the context map without Personas running. Best-effort: a failure here is
/// logged but never fails a scan that already committed contexts to the DB.
fn write_harness_docs(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    root_path: &str,
) {
    match super::context_map_export::write_context_map_artifacts(pool, project_id, root_path) {
        Ok(n) => {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!("[Harness] Wrote context-map.json ({n} contexts) + CLAUDE.md section."),
            );
        }
        Err(e) => {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!("[Warn] Failed to write harness docs: {e}. Contexts are still in the DB."),
            );
        }
    }
    // Backlog awareness for repo-side scan skills — same best-effort contract.
    if let Err(e) = super::context_map_export::write_backlog_digest(pool, project_id, root_path) {
        CONTEXT_GEN_JOBS.emit_line(
            app,
            scan_id,
            format!("[Warn] Failed to write backlog digest: {e}."),
        );
    }
    // Granularity report — the observable guard against micro-context drift
    // (the 2026-08 map converged at 769 contexts averaging 5 files because the
    // old prompt asked for 5-15). Band: 10-30 files per context.
    if let Ok(contexts) = repo::list_contexts_by_project(pool, project_id, None) {
        let count = |pred: &dyn Fn(usize) -> bool| {
            contexts
                .iter()
                .filter(|c| {
                    let n = serde_json::from_str::<Vec<String>>(&c.file_paths)
                        .map(|v| v.len())
                        .unwrap_or(0);
                    pred(n)
                })
                .count()
        };
        let under = count(&|n| n < 10);
        let over = count(&|n| n > 30);
        let total = contexts.len();
        CONTEXT_GEN_JOBS.emit_line(
            app,
            scan_id,
            format!(
                "[Harness] Granularity: {}/{} contexts inside the 10-30 file band ({} under, {} over).",
                total - under - over,
                total,
                under,
                over
            ),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // `is_mappable_path` is the whole gate between "the model proposed a context"
    // and "that context reaches the database". It had no tests, and a too-narrow
    // extension list silently discarded every Python context on a real project
    // while the scan still reported success. These pin both halves: the languages
    // a context may own, and the trees it may never claim.

    #[test]
    fn accepts_hand_written_source_across_languages() {
        for p in [
            "app/page.tsx",
            "src/lib.rs",
            "pipeline/jobfit/pipeline.py",
            "scripts/build.mjs",
            "scripts/legacy.cjs",
            "cmd/server/main.go",
            "src/Main.java",
            "app/globals.css",
            "styles/theme.scss",
            "db/migrate.sql",
            "src/App.vue",
        ] {
            assert!(is_mappable_path(p), "{p} should be mappable");
        }
    }

    #[test]
    fn rejects_generated_vendored_and_locale_trees() {
        for p in [
            "node_modules/react/index.js",
            "src/lib/bindings/DevKpi.ts",
            "public/section-locales/ar/common.ts",
            "target/debug/build.rs",
            "dist/bundle.js",
            "coverage/lcov-report/index.js",
        ] {
            assert!(!is_mappable_path(p), "{p} must not be mappable");
        }
    }

    #[test]
    fn rejects_python_vendor_trees_now_that_py_is_mappable() {
        // These only became reachable when `py` joined SOURCE_EXTS.
        for p in [
            ".venv/lib/site-packages/requests/api.py",
            "pipeline/__pycache__/cached.py",
            "venv/bin/activate.py",
            ".tox/py311/lib/thing.py",
        ] {
            assert!(!is_mappable_path(p), "{p} must not be mappable");
        }
    }

    #[test]
    fn rejects_data_and_doc_formats() {
        // Deliberately narrower than the walker's read-list: claiming these maps
        // description rather than implementation, and locale JSON is how a subtree
        // scan once produced 15 `section-locales-*` contexts.
        for p in ["messages/en.json", "README.md", "Cargo.toml", "ci.yaml"] {
            assert!(!is_mappable_path(p), "{p} must not be mappable");
        }
    }

    #[test]
    fn hidden_directories_are_rejected_on_both_sides() {
        // The counter skips every hidden dir; this side used to skip only the
        // named ones, which let paths in and pushed coverage above 100%.
        for p in [".next/server/page.js", ".github/scripts/release.mjs", ".turbo/out.js"] {
            assert!(!is_mappable_path(p), "{p} must not be mappable");
        }
    }

    #[test]
    fn path_noise_and_dotfiles_survive() {
        // A leading `./` means the same file; rejecting it would strand real source.
        assert!(is_mappable_path("./app/page.tsx"));
        assert!(is_mappable_path("app//page.tsx"));
        // Windows separators are normalized before the segment walk.
        assert!(is_mappable_path(r"app\features\hiring\board.tsx"));
        // A dotted FILENAME is a real hand-written file — the hidden rule is for
        // directories only, matching count_source_files.
        assert!(is_mappable_path(".eslintrc.js"));
    }

    #[test]
    fn extension_match_is_case_insensitive() {
        assert!(is_mappable_path("legacy/OLD.PY"));
        assert!(is_mappable_path("app/Page.TSX"));
    }

    #[test]
    fn extensionless_and_empty_paths_are_rejected() {
        assert!(!is_mappable_path("Makefile"));
        assert!(!is_mappable_path("LICENSE"));
        assert!(!is_mappable_path(""));
    }
}
