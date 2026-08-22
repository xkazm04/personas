//! The `<root>/<skill>/runs/<id>/` ingest convention, in one place.
//!
//! Every CLI skill that hands work back to the app writes numbered run
//! directories under its own runs root, marks a finished one with `result.json`,
//! and marks an already-imported one with `ingested.json`. The ingest command
//! then has to answer one of two questions: *which run should I import next?*
//! (ship-milestone, triage-verdicts, kpi-sim) or *which runs are still
//! outstanding?* (practice-harvest, where a scope fan-out produces one run per
//! territory).
//!
//! Those four commands each carried their own copy of the same directory walk,
//! differing only in how the runs root was spelled and — for the harvest — in
//! the sort direction. The walk lives here now; the runs root is a parameter.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Every directory directly under `runs_dir` that holds a `result.json` and no
/// `ingested.json`, paired with its mtime. Unsorted — the caller decides order.
///
/// An unreadable `runs_dir` (missing, or a permission error) yields an empty
/// list rather than an error: "no runs yet" and "cannot look" are the same
/// answer to every caller here.
fn candidates(runs_dir: &Path) -> Vec<(SystemTime, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(runs_dir) else {
        return Vec::new();
    };
    entries
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
        .collect()
}

/// Newest un-ingested run directly under `runs_dir`, or `None` if there is none.
pub fn newest_ingestable_run(runs_dir: &Path) -> Option<PathBuf> {
    let mut c = candidates(runs_dir);
    c.sort_by_key(|b| std::cmp::Reverse(b.0));
    c.into_iter().map(|(_, p)| p).next()
}

/// Every un-ingested run directly under `runs_dir`, **oldest first**.
///
/// Oldest-first is deliberate for batch ingest: a partially-failing batch still
/// advances rather than re-attempting the same newest run forever.
pub fn ingestable_runs_oldest_first(runs_dir: &Path) -> Vec<PathBuf> {
    let mut c = candidates(runs_dir);
    c.sort_by_key(|a| a.0);
    c.into_iter().map(|(_, p)| p).collect()
}
