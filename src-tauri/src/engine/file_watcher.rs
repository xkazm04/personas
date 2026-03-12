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
use std::sync::Arc;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::Mutex;

use crate::db::models::{CreatePersonaEventInput, TriggerConfig};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;

/// Raw FS event received from notify, before trigger matching.
pub struct RawFsEvent {
    pub kind: String,
    pub paths: Vec<String>,
}

/// Shared state for the file watcher.
pub struct FileWatcherState {
    watcher: Option<RecommendedWatcher>,
    registered: HashMap<String, HashSet<String>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watcher: None,
            registered: HashMap::new(),
        }
    }
}

/// Create the channel pair and initial state for the file watcher subscription.
#[allow(clippy::type_complexity)]
pub fn create_file_watcher() -> (
    Arc<Mutex<FileWatcherState>>,
    tokio::sync::mpsc::Sender<RawFsEvent>,
    Arc<Mutex<tokio::sync::mpsc::Receiver<RawFsEvent>>>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel(512);
    (
        Arc::new(Mutex::new(FileWatcherState::new())),
        tx,
        Arc::new(Mutex::new(rx)),
    )
}

/// Tick function called by the subscription loop.
pub async fn file_watcher_tick(
    pool: &DbPool,
    state: &Arc<Mutex<FileWatcherState>>,
    tx: &tokio::sync::mpsc::Sender<RawFsEvent>,
    rx: &Arc<Mutex<tokio::sync::mpsc::Receiver<RawFsEvent>>>,
) {
    // Load enabled file_watcher triggers once (SQL-filtered)
    let triggers = match trigger_repo::get_enabled_by_type(pool, "file_watcher") {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("file_watcher load error: {e}");
            return;
        }
    };

    // Phase 1: Reconcile watches using the pre-fetched triggers
    if let Err(e) = reconcile_watches(&triggers, state, tx).await {
        tracing::warn!("file_watcher reconcile error: {e}");
    }

    // Phase 2: Drain queued events
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

    // Phase 3: Match triggers to events (reusing already-loaded triggers)
    let fw_triggers: Vec<_> = triggers
        .iter()
        .map(|t| {
            let config = t.parse_config();
            (t.id.clone(), t.persona_id.clone(), t.use_case_id.clone(), config)
        })
        .collect();

    // Phase 4: Match and publish
    for raw in &raw_events {
        for (trigger_id, persona_id, use_case_id, config) in &fw_triggers {
            if !matches_trigger(config, &raw.kind, &raw.paths) {
                continue;
            }

            let event_type_str = if let TriggerConfig::FileWatcher { event_type, .. } = config {
                event_type.as_deref().unwrap_or("file_changed")
            } else {
                "file_changed"
            };

            let payload = serde_json::json!({
                "event_kind": raw.kind,
                "paths": raw.paths,
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
        }
    }
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

        // Check path prefix match
        let path_matches = paths.iter().any(|rp| {
            let rp_lower = rp.to_lowercase().replace('\\', "/");
            wpaths.iter().any(|wp| {
                rp_lower.starts_with(&wp.to_lowercase().replace('\\', "/"))
            })
        });
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
    triggers: &[crate::db::models::PersonaTrigger],
    state: &Arc<Mutex<FileWatcherState>>,
    tx: &tokio::sync::mpsc::Sender<RawFsEvent>,
) -> Result<(), String> {
    let mut state = state.lock().await;

    // Remove stale registrations
    let wanted_ids: HashSet<String> = triggers.iter().map(|t| t.id.clone()).collect();
    state.registered.retain(|k, _| wanted_ids.contains(k));

    // Create watcher if needed
    if state.watcher.is_none() && !triggers.is_empty() {
        let tx = tx.clone();
        let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let kind_str = match event.kind {
                    EventKind::Create(_) => "create",
                    EventKind::Modify(_) => "modify",
                    EventKind::Remove(_) => "delete",
                    _ => return,
                };
                let paths: Vec<String> = event.paths.iter()
                    .filter_map(|p| p.to_str().map(String::from))
                    .collect();
                if !paths.is_empty() {
                    let _ = tx.blocking_send(RawFsEvent {
                        kind: kind_str.into(),
                        paths,
                    });
                }
            }
        })
        .map_err(|e| format!("Failed to create file watcher: {e}"))?;

        state.watcher = Some(watcher);
    }

    // Collect registrations to apply
    let mut to_register: Vec<(String, HashSet<String>, RecursiveMode)> = Vec::new();
    for trigger in triggers {
        let config = trigger.parse_config();
        if let TriggerConfig::FileWatcher { watch_paths: Some(ref paths), recursive, .. } = config {
            let mode = if recursive.unwrap_or(true) {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            let path_set: HashSet<String> = paths.iter().cloned().collect();
            if state.registered.get(&trigger.id) != Some(&path_set) {
                to_register.push((trigger.id.clone(), path_set, mode));
            }
        }
    }

    // Apply registrations -- take watcher out temporarily to avoid double-borrow
    if !to_register.is_empty() {
        if let Some(mut watcher) = state.watcher.take() {
            for (trigger_id, path_set, mode) in to_register {
                for path in &path_set {
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

/// Simple glob matching for file name filters.
fn simple_glob_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let text = text.to_lowercase();

    if pattern.starts_with("*.") {
        let ext = &pattern[1..];
        if ext.contains('{') && ext.contains('}') {
            if let (Some(start), Some(end)) = (ext.find('{'), ext.find('}')) {
                let prefix = &ext[..start];
                let alternatives = &ext[start + 1..end];
                return alternatives.split(',').any(|alt| {
                    text.ends_with(&format!("{prefix}{}", alt.trim()))
                });
            }
        }
        return text.ends_with(ext);
    }

    pattern == text
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
}
