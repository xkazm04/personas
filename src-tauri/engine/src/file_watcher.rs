//! File watcher ambient trigger.
//!
//! Watches file system paths configured in `file_watcher` triggers and publishes
//! events when changes are detected. Uses the `notify` crate for cross-platform
//! file system events.
//!
//! Architecture: A single `RecommendedWatcher` watches all paths. FS events are
//! sent through an mpsc channel. On each tick, the subscription drains the channel
//! and matches events to triggers.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::Mutex;

use crate::ambient_context::AmbientContextHandle;
use crate::ambient_signal_repo;
use personas_db::models::{CreatePersonaEventInput, TriggerConfig};
use personas_db::repos::communication::events as event_repo;
use personas_db::repos::resources::triggers as trigger_repo;
use personas_db::DbPool;

/// Raw FS event received from notify, before trigger matching.
pub struct RawFsEvent {
    pub kind: String,
    pub paths: Vec<String>,
}

/// Default debounce window in milliseconds. During file-save bursts (IDE
/// auto-save, git operations) hundreds of FS events can arrive for the same
/// path in milliseconds. Events for a given path are suppressed for this
/// duration after the first trigger-match, reducing work from
/// O(burst_size × triggers) to O(unique_paths × triggers).
const DEBOUNCE_MS: u64 = 500;

/// Shared state for the file watcher.
pub struct FileWatcherState {
    watcher: Option<RecommendedWatcher>,
    registered: HashMap<String, HashSet<String>>,
    /// Tracks when each normalized path last caused a trigger publish.
    /// Used to suppress duplicate events within the debounce window.
    last_fired: HashMap<String, Instant>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watcher: None,
            registered: HashMap::new(),
            last_fired: HashMap::new(),
        }
    }
}

/// Create the channel pair and initial state for the file watcher subscription.
#[allow(clippy::type_complexity)]
pub fn create_file_watcher() -> (
    Arc<Mutex<FileWatcherState>>,
    tokio::sync::mpsc::Sender<RawFsEvent>,
    Arc<Mutex<tokio::sync::mpsc::Receiver<RawFsEvent>>>,
    Arc<AtomicU64>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel(4096);
    (
        Arc::new(Mutex::new(FileWatcherState::new())),
        tx,
        Arc::new(Mutex::new(rx)),
        Arc::new(AtomicU64::new(0)),
    )
}

/// Tick function called by the subscription loop.
///
/// `ambient_ctx` is `Some` for the windowed-app path (where ambient
/// fusion lives) and `None` for headless contexts. When provided, each
/// coalesced + debounced file event is pushed into the ambient
/// fusion's `push_file_change` capture site, gated by the in-memory
/// `file_changes_enabled` per-source toggle (Phase 2). The captured
/// signal also lands in the `ambient_signal` SQL projection so the
/// daemon-side bridge (Phase 3 c v3) carries file activity into
/// daemon-fired persona prompts.
pub async fn file_watcher_tick(
    pool: &DbPool,
    state: &Arc<Mutex<FileWatcherState>>,
    tx: &tokio::sync::mpsc::Sender<RawFsEvent>,
    rx: &Arc<Mutex<tokio::sync::mpsc::Receiver<RawFsEvent>>>,
    dropped: &Arc<AtomicU64>,
    ambient_ctx: Option<&AmbientContextHandle>,
) {
    // Report dropped events from channel overflow since last tick
    let dropped_count = dropped.swap(0, Ordering::Relaxed);
    if dropped_count > 0 {
        tracing::warn!(
            dropped_count,
            "file_watcher dropped {dropped_count} event(s) due to channel overflow — \
             consider reducing FS churn or check trigger polling interval"
        );
    }

    // Load enabled file_watcher triggers once (SQL-filtered)
    let triggers = match trigger_repo::get_enabled_by_type(pool, "file_watcher") {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("file_watcher load error: {e}");
            return;
        }
    };

    // Phase 1: Reconcile watches using the pre-fetched triggers
    if let Err(e) = reconcile_watches(&triggers, state, tx, dropped).await {
        tracing::warn!("file_watcher reconcile error: {e}");
    }

    // Phase 2: Drain queued events and coalesce by normalized path.
    // During FS bursts (IDE auto-save, git checkout) the same path appears
    // many times — coalescing reduces matching work from O(burst × triggers)
    // to O(unique_paths × triggers).
    let mut raw_events = Vec::new();
    {
        let mut receiver = rx.lock().await;
        while let Ok(evt) = receiver.try_recv() {
            raw_events.push(evt);
        }
    }

    if raw_events.is_empty() {
        return;
    }

    // Coalesce: keep one event per normalized path, with the latest event kind
    // and all unique kinds merged into the payload.
    let coalesced = coalesce_events(&raw_events);

    let debounce_window = Duration::from_millis(DEBOUNCE_MS);
    let now = Instant::now();

    // Filter out paths that fired within the debounce window
    let mut fw_state = state.lock().await;
    let coalesced: Vec<_> = coalesced
        .into_iter()
        .filter(|(norm_path, _, _)| {
            if let Some(last) = fw_state.last_fired.get(norm_path.as_str()) {
                now.duration_since(*last) >= debounce_window
            } else {
                true
            }
        })
        .collect();

    if coalesced.is_empty() {
        // Prune stale last_fired entries while we hold the lock
        prune_last_fired(&mut fw_state.last_fired, debounce_window, now);
        drop(fw_state);
        return;
    }

    // Release lock during trigger matching (CPU-bound) to avoid blocking
    // other file-watcher events. Re-acquire only for last_fired updates.
    drop(fw_state);

    // Phase 2.5: Push the coalesced+debounced events into ambient fusion
    // BEFORE trigger matching. Trigger matching narrows to specific globs
    // and event kinds; ambient should see every change in any path the
    // user has chosen to watch (the trigger registration is the user's
    // implicit consent for "Athena may notice this directory"). The
    // capture-site `push_file_change` checks `file_changes_enabled`, so a
    // user with file ambient turned off pays only the lock-acquire cost.
    if let Some(handle) = ambient_ctx {
        let mut ctx = handle.lock().await;
        for (_norm, kind, paths) in &coalesced {
            if let Some(sig) = ctx.push_file_change(kind, paths) {
                if let Err(e) = ambient_signal_repo::insert_signal(
                    pool,
                    &sig.id,
                    &sig.source,
                    &sig.summary,
                    sig.captured_at,
                    sig.redacted_content.as_deref(),
                ) {
                    tracing::warn!(
                        signal_id = %sig.id,
                        "ambient_signal insert (file_watcher) failed: {e}"
                    );
                }
            }
        }
    }

    // Phase 3: Match triggers to events (reusing already-loaded triggers)
    let now_utc = chrono::Utc::now();
    let fw_triggers: Vec<_> = triggers
        .iter()
        .filter(|t| t.is_within_active_window(now_utc))
        .map(|t| {
            let config = t.parse_config();
            (
                t.id.clone(),
                t.persona_id.clone(),
                t.use_case_id.clone(),
                config,
            )
        })
        .collect();

    // Phase 4: Match and publish (over coalesced, debounced events)
    let mut fired_paths: Vec<String> = Vec::new();
    for (norm_path, kind, paths) in &coalesced {
        let mut matched = false;
        for (trigger_id, persona_id, use_case_id, config) in &fw_triggers {
            if !matches_trigger(config, kind, paths) {
                continue;
            }

            let event_type_str = if let TriggerConfig::FileWatcher { event_type, .. } = config {
                event_type.as_deref().unwrap_or("file_changed")
            } else {
                "file_changed"
            };

            let payload = serde_json::json!({
                "event_kind": kind,
                "paths": paths,
            });

            let input = CreatePersonaEventInput {
                event_type: event_type_str.into(),
                source_type: "file_watcher".into(),
                project_id: None,
                source_id: Some(trigger_id.clone()),
                target_persona_id: Some(persona_id.clone()),
                payload: Some(serde_json::to_string(&payload).unwrap_or_default()),
                use_case_id: use_case_id.clone(),
            };

            if let Err(e) = event_repo::publish(pool, input) {
                tracing::warn!(trigger_id = %trigger_id, "file_watcher publish error: {e}");
            }
            matched = true;
        }
        if matched {
            fired_paths.push(norm_path.clone());
        }
    }

    // Re-acquire lock briefly for last_fired bookkeeping
    let mut fw_state = state.lock().await;
    for path in fired_paths {
        fw_state.last_fired.insert(path, now);
    }
    // Prune stale last_fired entries to prevent unbounded growth
    prune_last_fired(&mut fw_state.last_fired, debounce_window, now);
    drop(fw_state);
}

/// Normalize a path for dedup: lowercase + forward slashes.
fn normalize_path(p: &str) -> String {
    p.to_lowercase().replace('\\', "/")
}

/// Coalesce raw FS events by normalized path. Returns
/// `(normalized_path, latest_kind, original_paths)` tuples, one per unique path.
fn coalesce_events(raw: &[RawFsEvent]) -> Vec<(String, String, Vec<String>)> {
    let mut map: HashMap<String, (String, Vec<String>)> = HashMap::new();
    for evt in raw {
        for path in &evt.paths {
            let norm = normalize_path(path);
            map.entry(norm)
                .and_modify(|(kind, _)| {
                    // Keep the latest event kind (last write wins)
                    *kind = evt.kind.clone();
                })
                .or_insert_with(|| (evt.kind.clone(), vec![path.clone()]));
        }
    }
    map.into_iter()
        .map(|(norm, (kind, paths))| (norm, kind, paths))
        .collect()
}

/// Remove `last_fired` entries older than 2× the debounce window to prevent
/// unbounded growth. Entries within the window are kept for active debouncing.
fn prune_last_fired(last_fired: &mut HashMap<String, Instant>, debounce: Duration, now: Instant) {
    let prune_threshold = debounce * 2;
    last_fired.retain(|_, t| now.duration_since(*t) < prune_threshold);
}

fn matches_trigger(config: &TriggerConfig, kind: &str, paths: &[String]) -> bool {
    if let TriggerConfig::FileWatcher {
        watch_paths: Some(ref wpaths),
        events,
        glob_filter,
        ..
    } = config
    {
        // Check event kind filter
        if let Some(ref event_kinds) = events {
            if !event_kinds.is_empty() && !event_kinds.iter().any(|e| e == kind) {
                return false;
            }
        }

        // Check the event lies inside a watched path (directory boundary, so
        // `/proj` does not claim events from its sibling `/proj-x`).
        let path_matches = paths
            .iter()
            .any(|rp| wpaths.iter().any(|wp| path_is_within(rp, wp)));
        if !path_matches {
            return false;
        }

        // Check glob filter
        if let Some(ref glob) = glob_filter {
            let glob_matches = paths.iter().any(|rp| {
                let filename = std::path::Path::new(rp)
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or("");
                simple_glob_match(glob, filename)
            });
            if !glob_matches {
                return false;
            }
        }

        true
    } else {
        false
    }
}

async fn reconcile_watches(
    triggers: &[personas_db::models::PersonaTrigger],
    state: &Arc<Mutex<FileWatcherState>>,
    tx: &tokio::sync::mpsc::Sender<RawFsEvent>,
    dropped: &Arc<AtomicU64>,
) -> Result<(), String> {
    let mut state = state.lock().await;

    let wanted_ids: HashSet<String> = triggers.iter().map(|t| t.id.clone()).collect();

    // Drop watcher entirely when no triggers remain
    if triggers.is_empty() {
        if state.watcher.is_some() {
            state.watcher = None;
            state.registered.clear();
            tracing::debug!("file_watcher: all triggers removed, watcher dropped");
        }
        return Ok(());
    }

    // Create watcher if needed
    if state.watcher.is_none() {
        let tx = tx.clone();
        let dropped = Arc::clone(dropped);
        let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let kind_str = match event.kind {
                    EventKind::Create(_) => "create",
                    EventKind::Modify(_) => "modify",
                    EventKind::Remove(_) => "delete",
                    _ => return,
                };
                let paths: Vec<String> = event
                    .paths
                    .iter()
                    .filter_map(|p| p.to_str().map(String::from))
                    .collect();
                if !paths.is_empty()
                    && tx
                        .try_send(RawFsEvent {
                            kind: kind_str.into(),
                            paths,
                        })
                        .is_err()
                {
                    dropped.fetch_add(1, Ordering::Relaxed);
                }
            }
        })
        .map_err(|e| format!("Failed to create file watcher: {e}"))?;

        state.watcher = Some(watcher);
    }

    // Collect registrations to apply, tracking changed triggers for stale-path diffing
    let mut to_register: Vec<(String, HashSet<String>, RecursiveMode)> = Vec::new();
    let mut changed_triggers: Vec<(String, HashSet<String>)> = Vec::new();
    for trigger in triggers {
        let config = trigger.parse_config();
        if let TriggerConfig::FileWatcher {
            watch_paths: Some(ref paths),
            recursive,
            ..
        } = config
        {
            let mode = if recursive.unwrap_or(true) {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            let path_set: HashSet<String> = paths.iter().cloned().collect();
            if state.registered.get(&trigger.id) != Some(&path_set) {
                changed_triggers.push((trigger.id.clone(), path_set.clone()));
                to_register.push((trigger.id.clone(), path_set, mode));
            }
        }
    }

    // Compute which old paths are truly stale (not needed by any remaining trigger)
    let stale_paths = compute_stale_paths(&state.registered, &wanted_ids, &changed_triggers);

    // Remove stale registrations from HashMap
    state.registered.retain(|k, _| wanted_ids.contains(k));

    // Apply unwatches and new registrations
    if !stale_paths.is_empty() || !to_register.is_empty() {
        if let Some(mut watcher) = state.watcher.take() {
            // Unwatch stale paths first
            for path in &stale_paths {
                let p = PathBuf::from(path);
                if let Err(e) = watcher.unwatch(&p) {
                    tracing::debug!(path = %path, "Unwatch (non-critical): {e}");
                }
            }
            if !stale_paths.is_empty() {
                tracing::debug!(
                    count = stale_paths.len(),
                    "file_watcher: unwatched stale paths"
                );
            }

            // Apply new registrations
            for (trigger_id, path_set, mode) in to_register {
                for path in &path_set {
                    // The one place every file_watcher trigger reaches, whatever
                    // door created it (template, import, build, IPC).
                    if let Some(reason) = crate::path_safety::watch_path_refusal(path) {
                        tracing::warn!(trigger_id = %trigger_id, path = %path, "Watch refused: {reason}");
                        continue;
                    }
                    let p = PathBuf::from(path);
                    if p.exists() {
                        if let Err(e) = watcher.watch(&p, mode) {
                            tracing::warn!(trigger_id = %trigger_id, path = %path, "Watch error: {e}");
                        }
                    }
                }
                state.registered.insert(trigger_id, path_set);
            }
            state.watcher = Some(watcher);
        }
    }

    Ok(())
}

/// Compute which previously-watched paths are no longer needed by any trigger.
///
/// Returns the set of paths that should be `unwatch()`-ed. A path is stale when:
/// - Its owning trigger was deleted (`removed_trigger_paths`)
/// - Its owning trigger changed watch_paths (`changed_trigger_old_paths`)
///   …AND the path is not still required by another trigger in `active_paths`.
fn compute_stale_paths(
    registered: &HashMap<String, HashSet<String>>,
    wanted_ids: &HashSet<String>,
    changed_triggers: &[(String, HashSet<String>)],
) -> HashSet<String> {
    let mut stale: HashSet<String> = HashSet::new();

    // Paths from triggers that no longer exist
    for (trigger_id, paths) in registered {
        if !wanted_ids.contains(trigger_id) {
            stale.extend(paths.iter().cloned());
        }
    }

    // Old paths from triggers whose path set changed
    for (trigger_id, _new_paths) in changed_triggers {
        if let Some(old_paths) = registered.get(trigger_id) {
            stale.extend(old_paths.iter().cloned());
        }
    }

    // Build active set: paths still registered (excluding changed triggers) + new paths from changes
    let changed_ids: HashSet<&str> = changed_triggers.iter().map(|(id, _)| id.as_str()).collect();
    let mut active: HashSet<String> = HashSet::new();
    for (trigger_id, paths) in registered {
        if wanted_ids.contains(trigger_id) && !changed_ids.contains(trigger_id.as_str()) {
            active.extend(paths.iter().cloned());
        }
    }
    for (_, new_paths) in changed_triggers {
        active.extend(new_paths.iter().cloned());
    }

    stale.retain(|p| !active.contains(p));
    stale
}

/// Whether the event path `path` is `watched` itself or lies under it.
/// Case- and separator-insensitive, with a `/` boundary.
fn path_is_within(path: &str, watched: &str) -> bool {
    let path = path.to_lowercase().replace('\\', "/");
    let watched = watched.to_lowercase().replace('\\', "/");
    let watched = watched.trim_end_matches('/');
    path == watched
        || path
            .strip_prefix(watched)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Case-insensitive glob matching for the file-name filter.
///
/// Accepts a comma-separated list (`*.py, *.{ts,tsx}, Dockerfile`, the
/// field's own placeholder), `{a,b}` alternation, and `*` / `?` anywhere.
fn simple_glob_match(pattern: &str, text: &str) -> bool {
    let text: Vec<char> = text.to_lowercase().chars().collect();
    split_top_level_commas(&pattern.to_lowercase())
        .iter()
        .flat_map(|alt| expand_braces(alt))
        .any(|p| wildcard_match(&p.chars().collect::<Vec<_>>(), &text))
}

/// Split on commas that are not inside `{...}`; trims and drops empties.
fn split_top_level_commas(pattern: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut cur = String::new();
    for ch in pattern.chars() {
        match ch {
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                out.push(std::mem::take(&mut cur));
                continue;
            }
            _ => {}
        }
        cur.push(ch);
    }
    out.push(cur);
    out.into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Expand the first `{a,b}` group (recursively); a pattern without one is
/// returned as is.
fn expand_braces(pattern: &str) -> Vec<String> {
    let Some(open) = pattern.find('{') else {
        return vec![pattern.to_string()];
    };
    let Some(close) = pattern[open..].find('}').map(|i| open + i) else {
        return vec![pattern.to_string()];
    };
    let (head, tail) = (&pattern[..open], &pattern[close + 1..]);
    pattern[open + 1..close]
        .split(',')
        .flat_map(|opt| expand_braces(&format!("{head}{}{tail}", opt.trim())))
        .collect()
}

/// `*` matches any run (including empty), `?` exactly one char.
fn wildcard_match(pattern: &[char], text: &[char]) -> bool {
    let (mut p, mut t) = (0usize, 0usize);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, t));
            p += 1;
        } else if let Some((sp, st)) = star {
            p = sp + 1;
            t = st + 1;
            star = Some((sp, st + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|&c| c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_glob_py() {
        assert!(simple_glob_match("*.py", "main.py"));
        assert!(!simple_glob_match("*.py", "main.rs"));
    }

    #[test]
    fn test_simple_glob_brace() {
        assert!(simple_glob_match("*.{ts,tsx}", "App.tsx"));
        assert!(simple_glob_match("*.{ts,tsx}", "index.ts"));
        assert!(!simple_glob_match("*.{ts,tsx}", "style.css"));
    }

    #[test]
    fn test_simple_glob_exact() {
        assert!(simple_glob_match("Dockerfile", "Dockerfile"));
        assert!(!simple_glob_match("Dockerfile", "Makefile"));
    }

    /// The pattern field's own placeholder offers `*.py, *.{ts,tsx}, Dockerfile`,
    /// and `*` / `test_*.py` are ordinary globs. Each of these used to fall
    /// through to an exact-string compare and never fire.
    #[test]
    fn test_glob_lists_and_inner_wildcards() {
        let cases = [
            ("*.py, *.{ts,tsx}, Dockerfile", "App.tsx", true),
            ("*.py, *.{ts,tsx}, Dockerfile", "Dockerfile", true),
            ("*.py, *.{ts,tsx}, Dockerfile", "style.css", false),
            ("*", "anything.txt", true),
            ("test_*.py", "test_api.py", true),
            ("test_*.py", "api_test.py", false),
            ("report-??.csv", "report-07.csv", true),
            ("report-??.csv", "report-7.csv", false),
            ("{Makefile,Dockerfile}", "dockerfile", true),
        ];
        let wrong: Vec<_> = cases
            .iter()
            .filter(|(p, t, want)| simple_glob_match(p, t) != *want)
            .collect();
        assert!(
            wrong.is_empty(),
            "{} of {} wrong: {wrong:?}",
            wrong.len(),
            cases.len()
        );
    }

    fn watcher_config(watch: &str) -> TriggerConfig {
        TriggerConfig::FileWatcher {
            watch_paths: Some(vec![watch.to_string()]),
            events: None,
            recursive: Some(true),
            glob_filter: None,
            event_type: None,
            payload: None,
        }
    }

    /// A watch on `/home/u/proj` must not fire for its sibling `/home/u/proj-x`,
    /// which only shares a name prefix (the shared notify watcher delivers both
    /// trees' events when another trigger watches the sibling).
    #[test]
    fn test_watch_path_match_respects_directory_boundary() {
        let cfg = watcher_config("/home/u/proj");
        assert!(matches_trigger(
            &cfg,
            "modify",
            &["/home/u/proj/a.rs".into()]
        ));
        assert!(matches_trigger(&cfg, "modify", &["/home/u/proj".into()]));
        assert!(!matches_trigger(
            &cfg,
            "modify",
            &["/home/u/proj-x/a.rs".into()]
        ));
        assert!(!matches_trigger(
            &cfg,
            "modify",
            &["/home/u/project/a.rs".into()]
        ));

        let trailing = watcher_config("C:\\Users\\u\\proj\\");
        assert!(matches_trigger(
            &trailing,
            "create",
            &["C:\\Users\\u\\proj\\a.txt".into()]
        ));
        assert!(!matches_trigger(
            &trailing,
            "create",
            &["C:\\Users\\u\\proj2\\a.txt".into()]
        ));
    }

    #[test]
    fn test_stale_paths_trigger_removed() {
        let mut registered = HashMap::new();
        registered.insert("t1".into(), HashSet::from(["/a".into(), "/b".into()]));
        registered.insert("t2".into(), HashSet::from(["/c".into()]));

        // t1 deleted, t2 remains
        let wanted = HashSet::from(["t2".into()]);
        let stale = compute_stale_paths(&registered, &wanted, &[]);
        assert!(stale.contains("/a"));
        assert!(stale.contains("/b"));
        assert!(!stale.contains("/c"));
    }

    #[test]
    fn test_stale_paths_shared_path_not_unwatched() {
        let mut registered = HashMap::new();
        registered.insert(
            "t1".into(),
            HashSet::from(["/shared".into(), "/only_t1".into()]),
        );
        registered.insert("t2".into(), HashSet::from(["/shared".into()]));

        // t1 deleted, t2 remains — /shared must NOT be stale
        let wanted = HashSet::from(["t2".into()]);
        let stale = compute_stale_paths(&registered, &wanted, &[]);
        assert!(stale.contains("/only_t1"));
        assert!(!stale.contains("/shared"));
    }

    #[test]
    fn test_stale_paths_trigger_paths_changed() {
        let mut registered = HashMap::new();
        registered.insert(
            "t1".into(),
            HashSet::from(["/old_a".into(), "/keep".into()]),
        );

        // t1 changes paths: /old_a → /new_a, keeps /keep
        let wanted = HashSet::from(["t1".into()]);
        let changed = vec![(
            "t1".into(),
            HashSet::from(["/new_a".into(), "/keep".into()]),
        )];
        let stale = compute_stale_paths(&registered, &wanted, &changed);
        assert!(stale.contains("/old_a"));
        assert!(!stale.contains("/keep"));
        assert!(!stale.contains("/new_a"));
    }

    #[test]
    fn test_stale_paths_no_changes() {
        let mut registered = HashMap::new();
        registered.insert("t1".into(), HashSet::from(["/a".into()]));

        let wanted = HashSet::from(["t1".into()]);
        let stale = compute_stale_paths(&registered, &wanted, &[]);
        assert!(stale.is_empty());
    }

    #[test]
    fn test_stale_paths_all_removed() {
        let mut registered = HashMap::new();
        registered.insert("t1".into(), HashSet::from(["/a".into()]));
        registered.insert("t2".into(), HashSet::from(["/b".into()]));

        let wanted = HashSet::new();
        let stale = compute_stale_paths(&registered, &wanted, &[]);
        assert_eq!(stale.len(), 2);
        assert!(stale.contains("/a"));
        assert!(stale.contains("/b"));
    }

    #[test]
    fn test_watcher_state_new() {
        let state = FileWatcherState::new();
        assert!(state.watcher.is_none());
        assert!(state.registered.is_empty());
        assert!(state.last_fired.is_empty());
    }

    #[test]
    fn test_coalesce_deduplicates_same_path() {
        let events = vec![
            RawFsEvent {
                kind: "modify".into(),
                paths: vec!["/src/main.rs".into()],
            },
            RawFsEvent {
                kind: "modify".into(),
                paths: vec!["/src/main.rs".into()],
            },
            RawFsEvent {
                kind: "modify".into(),
                paths: vec!["/src/main.rs".into()],
            },
        ];
        let coalesced = coalesce_events(&events);
        assert_eq!(coalesced.len(), 1);
        assert_eq!(coalesced[0].1, "modify");
    }

    #[test]
    fn test_coalesce_keeps_distinct_paths() {
        let events = vec![
            RawFsEvent {
                kind: "modify".into(),
                paths: vec!["/src/a.rs".into()],
            },
            RawFsEvent {
                kind: "create".into(),
                paths: vec!["/src/b.rs".into()],
            },
        ];
        let coalesced = coalesce_events(&events);
        assert_eq!(coalesced.len(), 2);
    }

    #[test]
    fn test_coalesce_last_kind_wins() {
        let events = vec![
            RawFsEvent {
                kind: "create".into(),
                paths: vec!["/src/file.rs".into()],
            },
            RawFsEvent {
                kind: "modify".into(),
                paths: vec!["/src/file.rs".into()],
            },
        ];
        let coalesced = coalesce_events(&events);
        assert_eq!(coalesced.len(), 1);
        assert_eq!(coalesced[0].1, "modify");
    }

    #[test]
    fn test_coalesce_normalizes_backslashes() {
        let events = vec![
            RawFsEvent {
                kind: "modify".into(),
                paths: vec!["C:\\src\\file.rs".into()],
            },
            RawFsEvent {
                kind: "modify".into(),
                paths: vec!["c:/src/file.rs".into()],
            },
        ];
        let coalesced = coalesce_events(&events);
        assert_eq!(coalesced.len(), 1);
    }

    #[test]
    fn test_prune_last_fired_removes_old() {
        let mut map = HashMap::new();
        let now = Instant::now();
        let debounce = Duration::from_millis(500);
        // This entry is older than 2× debounce → should be pruned
        map.insert("/old".into(), now - Duration::from_secs(2));
        // This entry is recent → should be kept
        map.insert("/recent".into(), now - Duration::from_millis(100));
        prune_last_fired(&mut map, debounce, now);
        assert!(!map.contains_key("/old"));
        assert!(map.contains_key("/recent"));
    }
}
