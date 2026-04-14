//! Graph-aware operations over an Obsidian vault.
//!
//! These commands power the new "Obsidian Memory" connector and the Graph tab
//! in the Obsidian Brain plugin. Search, backlink walking, MOC detection, and
//! daily-journal authoring all share a single helper: walk every `.md` file
//! under the active vault, extract titles + wikilinks, and answer the query
//! against that in-memory map.
//!
//! Phase 1 deliberately keeps the implementation simple — substring search +
//! wikilink regex. A future revision can mount an embedding index in front of
//! the same surface without changing call sites.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{Local, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[cfg(feature = "desktop")]
use notify::{event::EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::get_config_or_err;

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultLinkRef {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultMocEntry {
    pub path: String,
    pub title: String,
    pub outgoing_link_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultStats {
    pub total_notes: u32,
    pub total_links: u32,
    pub orphan_count: u32,
    pub moc_count: u32,
    pub daily_note_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DailyNoteRef {
    pub path: String,
    pub date: String,
    pub created: bool,
}

// ── Vault index (in-memory walk) ────────────────────────────────────

struct NoteEntry {
    path: PathBuf,
    title: String,
    body: String,
    outgoing: Vec<String>,
}

fn wikilink_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\[\[([^\]\|#]+)(?:[#\|][^\]]*)?\]\]").expect("wikilink regex")
    })
}

fn walk_vault(vault_root: &Path) -> Vec<NoteEntry> {
    fn walk(dir: &Path, out: &mut Vec<NoteEntry>, depth: u32) {
        if depth > 12 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                walk(&path, out, depth + 1);
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let body = match std::fs::read_to_string(&path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let title = name.trim_end_matches(".md").to_string();
            let outgoing = wikilink_re()
                .captures_iter(&body)
                .filter_map(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
                .collect();
            out.push(NoteEntry {
                path,
                title,
                body,
                outgoing,
            });
        }
    }
    let mut out = Vec::new();
    walk(vault_root, &mut out, 0);
    out
}

fn build_backlink_map(notes: &[NoteEntry]) -> HashMap<String, Vec<usize>> {
    let mut map: HashMap<String, Vec<usize>> = HashMap::new();
    for (idx, note) in notes.iter().enumerate() {
        let seen: HashSet<&str> = note.outgoing.iter().map(|s| s.as_str()).collect();
        for target in seen {
            map.entry(target.to_lowercase()).or_default().push(idx);
        }
    }
    map
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            current.extend(ch.to_lowercase());
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// Compute TF-IDF scores for each note against the query terms.
///
/// `tf` is per-document term frequency. `idf` is `ln((N + 1) / (df + 1)) + 1`
/// (smoothed Robertson IDF — the +1s avoid division-by-zero on rare terms in
/// small vaults). Title hits get a flat +5 boost so a query like "stoicism"
/// surfaces a `Stoicism MOC.md` note even when its body never repeats the term.
fn tfidf_scores(notes: &[NoteEntry], query_terms: &[String]) -> Vec<f32> {
    let doc_count = notes.len().max(1) as f32;
    let mut doc_freq: HashMap<String, u32> = HashMap::new();
    let tokenized: Vec<HashMap<String, u32>> = notes
        .iter()
        .map(|n| {
            let mut tf: HashMap<String, u32> = HashMap::new();
            for tok in tokenize(&n.body) {
                *tf.entry(tok).or_insert(0) += 1;
            }
            for tok in tf.keys() {
                *doc_freq.entry(tok.clone()).or_insert(0) += 1;
            }
            tf
        })
        .collect();

    let idf: HashMap<&String, f32> = query_terms
        .iter()
        .map(|term| {
            let df = *doc_freq.get(term).unwrap_or(&0) as f32;
            let val = ((doc_count + 1.0) / (df + 1.0)).ln() + 1.0;
            (term, val)
        })
        .collect();

    tokenized
        .iter()
        .enumerate()
        .map(|(i, tf)| {
            let title_lc = notes[i].title.to_lowercase();
            let mut score = 0.0_f32;
            for term in query_terms {
                let f = *tf.get(term).unwrap_or(&0) as f32;
                score += f * idf.get(term).copied().unwrap_or(0.0);
                if title_lc.contains(term) {
                    score += 5.0;
                }
            }
            score
        })
        .collect()
}

fn snippet_for(body: &str, query_lc: &str) -> String {
    let body_lc = body.to_lowercase();
    let Some(pos) = body_lc.find(query_lc) else {
        return body.chars().take(160).collect();
    };
    let start = pos.saturating_sub(60);
    let end = (pos + query_lc.len() + 100).min(body.len());
    let mut s = body[start..end].replace('\n', " ");
    if start > 0 {
        s.insert_str(0, "…");
    }
    if end < body.len() {
        s.push('…');
    }
    s
}

fn ensure_within_vault(vault_root: &Path, target: &Path) -> Result<(), AppError> {
    let canonical_root = vault_root.canonicalize().unwrap_or(vault_root.to_path_buf());
    let canonical_target = target.canonicalize().unwrap_or(target.to_path_buf());
    if !canonical_target.starts_with(&canonical_root) {
        return Err(AppError::Validation(
            "Path is outside the configured vault".into(),
        ));
    }
    Ok(())
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn obsidian_graph_search(
    state: State<'_, Arc<AppState>>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<VaultSearchHit>, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_root = Path::new(&config.vault_path);

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let query_lc = trimmed.to_lowercase();
    let query_terms = tokenize(&query_lc);
    if query_terms.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(25).min(100) as usize;

    let notes = walk_vault(vault_root);
    let scores = tfidf_scores(&notes, &query_terms);
    let mut hits: Vec<VaultSearchHit> = notes
        .iter()
        .enumerate()
        .filter_map(|(i, n)| {
            let s = scores[i];
            if s <= 0.0 {
                return None;
            }
            Some(VaultSearchHit {
                path: n.path.to_string_lossy().to_string(),
                title: n.title.clone(),
                snippet: snippet_for(&n.body, &query_lc),
                score: (s * 100.0).round() / 100.0,
            })
        })
        .collect();
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(limit);
    Ok(hits)
}

#[tauri::command]
pub fn obsidian_graph_outgoing_links(
    state: State<'_, Arc<AppState>>,
    note_path: String,
) -> Result<Vec<VaultLinkRef>, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_root = Path::new(&config.vault_path);
    let target = Path::new(&note_path);
    ensure_within_vault(vault_root, target)?;

    let body = std::fs::read_to_string(target)
        .map_err(|e| AppError::Validation(format!("Failed to read note: {e}")))?;

    let notes = walk_vault(vault_root);
    let title_index: HashMap<String, &NoteEntry> = notes
        .iter()
        .map(|n| (n.title.to_lowercase(), n))
        .collect();

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for cap in wikilink_re().captures_iter(&body) {
        if let Some(m) = cap.get(1) {
            let raw = m.as_str().trim();
            let key = raw.to_lowercase();
            if !seen.insert(key.clone()) {
                continue;
            }
            if let Some(note) = title_index.get(&key) {
                out.push(VaultLinkRef {
                    path: note.path.to_string_lossy().to_string(),
                    title: note.title.clone(),
                });
            } else {
                out.push(VaultLinkRef {
                    path: String::new(),
                    title: raw.to_string(),
                });
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn obsidian_graph_backlinks(
    state: State<'_, Arc<AppState>>,
    note_path: String,
) -> Result<Vec<VaultLinkRef>, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_root = Path::new(&config.vault_path);
    let target = Path::new(&note_path);
    ensure_within_vault(vault_root, target)?;

    let title = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if title.is_empty() {
        return Ok(Vec::new());
    }

    let notes = walk_vault(vault_root);
    let backlink_map = build_backlink_map(&notes);

    let Some(idxs) = backlink_map.get(&title) else {
        return Ok(Vec::new());
    };
    Ok(idxs
        .iter()
        .filter_map(|i| notes.get(*i))
        .map(|n| VaultLinkRef {
            path: n.path.to_string_lossy().to_string(),
            title: n.title.clone(),
        })
        .collect())
}

#[tauri::command]
pub fn obsidian_graph_list_orphans(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<VaultLinkRef>, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_root = Path::new(&config.vault_path);

    let notes = walk_vault(vault_root);
    let backlink_map = build_backlink_map(&notes);
    let limit = limit.unwrap_or(50).min(500) as usize;

    let mut out = Vec::new();
    for note in &notes {
        if !backlink_map.contains_key(&note.title.to_lowercase()) {
            out.push(VaultLinkRef {
                path: note.path.to_string_lossy().to_string(),
                title: note.title.clone(),
            });
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn obsidian_graph_list_mocs(
    state: State<'_, Arc<AppState>>,
    min_links: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<VaultMocEntry>, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_root = Path::new(&config.vault_path);

    let min_links = min_links.unwrap_or(8) as usize;
    let limit = limit.unwrap_or(20).min(100) as usize;

    let notes = walk_vault(vault_root);
    let mut entries: Vec<VaultMocEntry> = notes
        .iter()
        .filter(|n| n.outgoing.len() >= min_links)
        .map(|n| VaultMocEntry {
            path: n.path.to_string_lossy().to_string(),
            title: n.title.clone(),
            outgoing_link_count: n.outgoing.len() as u32,
        })
        .collect();
    entries.sort_by(|a, b| b.outgoing_link_count.cmp(&a.outgoing_link_count));
    entries.truncate(limit);
    Ok(entries)
}

#[tauri::command]
pub fn obsidian_graph_stats(
    state: State<'_, Arc<AppState>>,
) -> Result<VaultStats, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_root = Path::new(&config.vault_path);

    let notes = walk_vault(vault_root);
    let backlink_map = build_backlink_map(&notes);
    let total_links: u32 = notes.iter().map(|n| n.outgoing.len() as u32).sum();
    let orphan_count = notes
        .iter()
        .filter(|n| !backlink_map.contains_key(&n.title.to_lowercase()))
        .count() as u32;
    let moc_count = notes.iter().filter(|n| n.outgoing.len() >= 8).count() as u32;

    static DATE_RE: OnceLock<Regex> = OnceLock::new();
    let date_re = DATE_RE.get_or_init(|| Regex::new(r"^\d{4}-\d{2}-\d{2}").expect("date regex"));
    let daily_note_count = notes
        .iter()
        .filter(|n| date_re.is_match(&n.title))
        .count() as u32;

    Ok(VaultStats {
        total_notes: notes.len() as u32,
        total_links,
        orphan_count,
        moc_count,
        daily_note_count,
    })
}

// ── Daily journal authoring ─────────────────────────────────────────

fn resolve_daily_note_path(vault_root: &Path, date: &NaiveDate) -> (PathBuf, String) {
    let date_str = date.format("%Y-%m-%d").to_string();
    let folder = vault_root.join("Daily");
    let file = folder.join(format!("{}.md", date_str));
    (file, date_str)
}

#[tauri::command]
pub fn obsidian_graph_append_daily_note(
    state: State<'_, Arc<AppState>>,
    date: Option<String>,
    section: Option<String>,
    body: String,
) -> Result<DailyNoteRef, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_root = Path::new(&config.vault_path);

    let parsed_date = match date.as_deref() {
        Some(s) => NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|e| AppError::Validation(format!("Invalid date '{s}': {e}")))?,
        None => Local::now().date_naive(),
    };

    let (file_path, date_str) = resolve_daily_note_path(vault_root, &parsed_date);
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Validation(format!("Failed to create Daily folder: {e}")))?;
    }

    let created = !file_path.exists();
    if created {
        let header = format!("# {}\n\n", date_str);
        std::fs::write(&file_path, header)
            .map_err(|e| AppError::Validation(format!("Failed to create daily note: {e}")))?;
    }

    let mut existing = std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Validation(format!("Failed to read daily note: {e}")))?;
    if !existing.ends_with('\n') {
        existing.push('\n');
    }
    if let Some(s) = section.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if !existing.contains(&format!("## {}", s)) {
            existing.push_str(&format!("\n## {}\n\n", s));
        } else {
            existing.push('\n');
        }
    } else {
        existing.push('\n');
    }
    existing.push_str(body.trim_end());
    existing.push('\n');

    std::fs::write(&file_path, &existing)
        .map_err(|e| AppError::Validation(format!("Failed to write daily note: {e}")))?;

    Ok(DailyNoteRef {
        path: file_path.to_string_lossy().to_string(),
        date: date_str,
        created,
    })
}

#[tauri::command]
pub fn obsidian_graph_write_meeting_note(
    state: State<'_, Arc<AppState>>,
    title: String,
    attendees: Option<Vec<String>>,
    body: String,
) -> Result<VaultLinkRef, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_root = Path::new(&config.vault_path);

    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Err(AppError::Validation("Meeting note title is required".into()));
    }
    let safe_title: String = trimmed_title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let file_name = format!("{} - {}.md", date_str, safe_title.trim());
    let folder = vault_root.join("Meetings");
    std::fs::create_dir_all(&folder)
        .map_err(|e| AppError::Validation(format!("Failed to create Meetings folder: {e}")))?;
    let file_path = folder.join(&file_name);

    let mut md = String::new();
    md.push_str("---\n");
    md.push_str(&format!("title: \"{}\"\n", trimmed_title.replace('"', "'")));
    md.push_str(&format!("date: \"{}\"\n", date_str));
    md.push_str("type: \"meeting-note\"\n");
    if let Some(list) = attendees.as_ref().filter(|l| !l.is_empty()) {
        md.push_str("attendees:\n");
        for name in list {
            md.push_str(&format!("  - \"{}\"\n", name.replace('"', "'")));
        }
    }
    md.push_str("---\n\n");
    md.push_str(&format!("# {}\n\n", trimmed_title));
    if let Some(list) = attendees.as_ref().filter(|l| !l.is_empty()) {
        md.push_str("**Attendees:** ");
        let linked: Vec<String> = list.iter().map(|n| format!("[[{}]]", n)).collect();
        md.push_str(&linked.join(", "));
        md.push_str("\n\n");
    }
    md.push_str(body.trim_end());
    md.push('\n');

    std::fs::write(&file_path, md)
        .map_err(|e| AppError::Validation(format!("Failed to write meeting note: {e}")))?;

    Ok(VaultLinkRef {
        path: file_path.to_string_lossy().to_string(),
        title: trimmed_title.to_string(),
    })
}

// ── File watcher ────────────────────────────────────────────────────
//
// The watcher runs in a background thread and emits a Tauri event whenever
// markdown files in the active vault change. The frontend listens to refresh
// stats/sync log without manual polling. Switching vaults stops the previous
// watcher and starts a new one bound to the new path. Events are debounced
// at 1 second to avoid storms during bulk edits.

#[cfg(feature = "desktop")]
struct WatcherHandle {
    _watcher: RecommendedWatcher,
    vault_path: PathBuf,
}

#[cfg(feature = "desktop")]
static WATCHER: OnceLock<Mutex<Option<WatcherHandle>>> = OnceLock::new();

#[cfg(feature = "desktop")]
fn watcher_slot() -> &'static Mutex<Option<WatcherHandle>> {
    WATCHER.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultChangedEvent {
    pub vault_path: String,
    pub changed_paths: Vec<String>,
}

pub const VAULT_CHANGED_EVENT: &str = "obsidian:vault-changed";

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn obsidian_graph_start_watcher(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_path = PathBuf::from(&config.vault_path);
    if !vault_path.exists() {
        return Err(AppError::Validation(format!(
            "Vault path does not exist: {}",
            vault_path.display()
        )));
    }

    let slot = watcher_slot();
    let mut guard = slot.lock().map_err(|_| AppError::Internal("watcher mutex poisoned".into()))?;

    // No-op if we're already watching this exact path
    if let Some(existing) = guard.as_ref() {
        if existing.vault_path == vault_path {
            return Ok(());
        }
    }
    // Drop the previous watcher (if any) before installing the new one.
    *guard = None;

    let app_for_thread = app.clone();
    let vault_clone = vault_path.clone();
    let pending: Arc<Mutex<(Vec<PathBuf>, Option<Instant>)>> = Arc::new(Mutex::new((Vec::new(), None)));
    let pending_for_callback = pending.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        // Only care about file mutations to .md notes
        let interesting = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        );
        if !interesting {
            return;
        }
        let md_paths: Vec<PathBuf> = event
            .paths
            .into_iter()
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
            .collect();
        if md_paths.is_empty() {
            return;
        }
        let mut state = pending_for_callback.lock().expect("pending mutex");
        for p in md_paths {
            if !state.0.contains(&p) {
                state.0.push(p);
            }
        }
        state.1 = Some(Instant::now());
    })
    .map_err(|e| AppError::Internal(format!("Failed to create watcher: {e}")))?;

    watcher
        .watch(&vault_path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Internal(format!("Failed to watch vault: {e}")))?;

    // Debounce thread — flushes pending events 1s after the last hit.
    let debounce_pending = pending.clone();
    let debounce_vault = vault_clone.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let to_emit: Option<Vec<PathBuf>> = {
                let mut state = debounce_pending.lock().expect("pending mutex");
                match state.1 {
                    Some(last) if last.elapsed() >= Duration::from_secs(1) => {
                        let drained = std::mem::take(&mut state.0);
                        state.1 = None;
                        if drained.is_empty() {
                            None
                        } else {
                            Some(drained)
                        }
                    }
                    _ => None,
                }
            };
            if let Some(paths) = to_emit {
                let payload = VaultChangedEvent {
                    vault_path: debounce_vault.to_string_lossy().to_string(),
                    changed_paths: paths
                        .into_iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect(),
                };
                let _ = app_for_thread.emit(VAULT_CHANGED_EVENT, payload);
            }
        }
    });

    *guard = Some(WatcherHandle {
        _watcher: watcher,
        vault_path,
    });
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn obsidian_graph_stop_watcher(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let slot = watcher_slot();
    let mut guard = slot.lock().map_err(|_| AppError::Internal("watcher mutex poisoned".into()))?;
    *guard = None;
    Ok(())
}

#[cfg(not(feature = "desktop"))]
#[tauri::command]
pub fn obsidian_graph_start_watcher(
    _state: State<'_, Arc<AppState>>,
    _app: AppHandle,
) -> Result<(), AppError> {
    Err(AppError::Validation(
        "File watcher requires the desktop feature build".into(),
    ))
}

#[cfg(not(feature = "desktop"))]
#[tauri::command]
pub fn obsidian_graph_stop_watcher(_state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    Ok(())
}
