//! `personas-curator-project` - re-project Curator's plan without the app.
//!
//! **The seam this closes.** Her plan is a projection, and until now only the
//! running Tauri app could make one: `curator_plan_refresh` is a
//! `#[tauri::command]`. So a terminal driver (`/curator`) could dispatch her
//! work, settle it and read her ledger, but could not refresh the ranking those
//! dispatches came from - and after a large registry merge the plan stayed
//! ranked from the old corpus until somebody opened the window. Measured
//! 2026-09-28: 253 commits of drift produced a day of dispatches at roughly a 2%
//! yield, and the only remedy was a GUI.
//!
//! **It runs the app's own code, not a copy of it.** The three steps that matter
//! (reading the registry's instruments, projecting, and writing the plan) are
//! already free of Tauri: `commands::curator::instrument` spawns node through the
//! engine's subprocess chokepoint, `commands::curator::projection::project` is a
//! pure function, and the repos are `personas-db`. This binary is a `main` around
//! them. A Python re-implementation of the 1,300-line scoring function would have
//! been a second source of truth for the one number her whole loop is ranked on;
//! that is the thing not to build.
//!
//! It lives in `personas-engine` rather than beside the app, so building it pulls
//! core + db + engine and NOT the Tauri dependency tree: seconds rather than
//! minutes, which is the difference between a step a loop can take and one a
//! person schedules.
//!
//! # Usage
//!
//! ```text
//! personas-curator-project [--db-path <path>] [--registry <path>]
//! ```
//!
//! Prints one JSON object: the run id, the item count, whether the projection
//! differs from the one it superseded, and whether the instrument answered from
//! its five-minute cache. Exit 0 on a landed projection, non-zero with a
//! `{"ok":false,"error":…}` object otherwise.
//!
//! # Build
//!
//! ```text
//! cargo build --release -p personas-engine --bin personas-curator-project
//! ```

// A terminal binary: its output IS the interface, so the workspace-wide ban on
// printing is the deliberate exception here, exactly as in `daemon_bin.rs`.
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::path::PathBuf;
use std::process::ExitCode;

use personas_db::repos::curator as repo;
use personas_engine::curator::policy::{load_policy, registry_root_of};
use personas_engine::curator::{instrument, projection};

const EXIT_USAGE: u8 = 2;
const EXIT_FAILED: u8 = 1;

struct Args {
    db_path: Option<PathBuf>,
    registry: Option<PathBuf>,
}

fn parse() -> Result<Args, String> {
    let mut out = Args {
        db_path: None,
        registry: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--db-path" => {
                out.db_path = Some(PathBuf::from(it.next().ok_or("--db-path needs a value")?))
            }
            "--registry" => {
                out.registry = Some(PathBuf::from(it.next().ok_or("--registry needs a value")?))
            }
            "-h" | "--help" => return Err("usage".into()),
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(out)
}

/// Where the app keeps its database when nobody says otherwise.
///
/// Resolved the same way the app resolves it rather than read from a setting, so
/// this binary and the window agree about which database is hers even when the
/// window has never run on this machine.
fn default_db_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("com.personas.desktop"))
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share/com.personas.desktop"))
    }
}

fn fail(msg: impl std::fmt::Display) -> ExitCode {
    println!(
        "{}",
        serde_json::json!({ "ok": false, "error": msg.to_string() })
    );
    ExitCode::from(EXIT_FAILED)
}

fn main() -> ExitCode {
    let args = match parse() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("personas-curator-project: {e}");
            eprintln!("usage: personas-curator-project [--db-path <path>] [--registry <path>]");
            return ExitCode::from(EXIT_USAGE);
        }
    };

    let app_data_dir = match args.db_path.clone() {
        // A path to the FILE is accepted and its parent used, because that is
        // what a caller has in hand; `init_db` wants the directory.
        Some(p) if p.is_file() => match p.parent() {
            Some(d) => d.to_path_buf(),
            None => return fail(format!("{} has no parent directory", p.display())),
        },
        Some(p) => p,
        None => match default_db_dir() {
            Some(d) => d,
            None => return fail("could not resolve the app data directory"),
        },
    };
    if !app_data_dir.join("personas.db").exists() {
        return fail(format!(
            "no personas.db under {} - this machine has no Curator to project",
            app_data_dir.display()
        ));
    }

    let pool = match personas_db::init_db(&app_data_dir, None) {
        Ok(p) => p,
        Err(e) => return fail(format!("could not open the database: {e}")),
    };

    let root = match args.registry {
        Some(r) => r,
        None => match registry_root_of(&pool) {
            Ok(r) => r,
            Err(e) => return fail(e),
        },
    };
    if !root.is_dir() {
        return fail(format!("{} is not a directory", root.display()));
    }

    // The instrument is async because it spawns up to four node processes. A
    // current-thread runtime is enough: this binary does one thing and exits.
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => return fail(format!("could not start a runtime: {e}")),
    };

    let reading = match rt.block_on(instrument::read(&root)) {
        Ok(r) => r,
        Err(e) => return fail(format!("the registry's instruments did not answer: {e}")),
    };
    let from_cache = reading.from_cache;
    let reading = reading.value;

    let now = chrono::Utc::now().to_rfc3339();
    let run_id = uuid::Uuid::new_v4().to_string();
    let policy = load_policy(&pool);
    let streaks = match repo::idle_streaks(&pool) {
        Ok(s) => s,
        Err(e) => return fail(format!("her saturation streaks could not be read: {e}")),
    };

    let projected = projection::project(&reading, &policy, &streaks, &now);

    // The projection's two alarms are REPORTED rather than swallowed, and
    // neither fails the run - the same call the app's command makes. A plan
    // missing one clause is still worth landing; refusing here would leave the
    // operator with no plan at all and no way to see why.
    for miss in &projected.unmatched {
        eprintln!(
            "unrecognised clause on {}: {}",
            miss.subject_id, miss.sentence
        );
    }
    for subject in &projected.arithmetic_disagreements {
        eprintln!(
            "clause weights do not sum to the scan's own points on {subject} - the matcher and \
             the registry's scoring have drifted"
        );
    }

    // Read BEFORE the insert supersedes it, so "did anything move" compares
    // against the run this one replaces rather than against nothing.
    let before = repo::current_plan(&pool);
    let plan = match repo::insert_plan(&pool, &run_id, &projected.run, &projected.items) {
        Ok(p) => p,
        Err(e) => return fail(format!("the projection could not be landed: {e}")),
    };
    let changed = match before {
        Ok(Some(prev)) => Some(fingerprint(&prev) != fingerprint(&plan)),
        Ok(None) => Some(true),
        // UNKNOWN, not "unchanged": the comparison could not be made.
        Err(_) => None,
    };

    println!(
        "{}",
        serde_json::json!({
            "ok": true,
            "run_id": run_id,
            "items": plan.items.len(),
            "changed": changed,
            "from_cache": from_cache,
            "registry": root.to_string_lossy(),
            "unmatched_clauses": projected.unmatched.len(),
            "arithmetic_disagreements": projected.arithmetic_disagreements.len(),
        })
    );
    ExitCode::SUCCESS
}

/// What "the same projection" means, mirrored from the app's own comparison:
/// the ranked subjects with the points, engine and dominant clause that rank
/// them. Deliberately not the item ids (a run mints fresh ones), not the states
/// (they move as her workers land) and no timestamp.
fn fingerprint(plan: &personas_core::models::CuratorPlan) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(plan.items.len() * 48);
    for item in &plan.items {
        let _ = write!(
            out,
            "{}\u{1f}{}\u{1f}{:?}\u{1f}{:?}\u{1e}",
            item.subject_id, item.points, item.engine, item.dominant_reason
        );
    }
    out
}
