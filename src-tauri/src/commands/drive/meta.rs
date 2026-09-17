//! Drive tag index — Finder-style colour labels + named tags.
//!
//! WIRE CONTRACT (fixed by the drive-finder spark, 2026-09-17):
//! the index lives INSIDE the sandbox at `<root>/.drive-meta.json`, is owned
//! by Rust, and is a declared bookkeeping exclusion for every walker
//! (list / tree / search / recent / storage). Builtin ids are
//! `label:<color>`; user tags are `tag:<uuid>`.
//!
//! ON-DISK FORMAT (`version: 1`):
//! `{ "version": 1, "vocab": [DriveTag...], "labels": { "<rel_path>": ["<tag_id>", ...] } }`
//! — `DriveMeta` minus `warning`, which is transient. Keys are forward-slash
//! paths relative to the root with no leading slash. Every write is
//! tmp + rename under a process-wide mutex; a pure read never creates the
//! file. A file that cannot be parsed is moved aside to
//! `.drive-meta.json.corrupt-<UTC stamp>` and a fresh index is returned with
//! `warning` set, so one bad byte never bricks the drive.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use ts_rs::TS;

use crate::error::AppError;

use super::{
    build_entry, managed_root, resolve_safe, to_relative_display, DriveEntry, DriveEntryKind,
};

/// Name of the index file at the sandbox root. Excluded from every listing.
pub const META_FILENAME: &str = ".drive-meta.json";

const META_VERSION: u32 = 1;
const MAX_TAG_NAME_LEN: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum DriveTagColor {
    Red,
    Orange,
    Yellow,
    Green,
    Blue,
    Purple,
    Gray,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveTag {
    /// `label:<color>` for the seven builtins, `tag:<uuid>` for user tags.
    pub id: String,
    /// Display name. Builtins carry the colour token name; the UI localises.
    pub name: String,
    pub color: DriveTagColor,
    /// Builtins cannot be deleted or renamed.
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveMeta {
    pub version: u32,
    pub vocab: Vec<DriveTag>,
    /// rel_path (forward slashes) -> tag ids applied to that entry.
    pub labels: BTreeMap<String, Vec<String>>,
    /// Set when the index file was unreadable and moved aside.
    pub warning: Option<String>,
}

/// What actually lands on disk: `DriveMeta` without the transient `warning`.
#[derive(Serialize, Deserialize)]
struct DiskIndex {
    version: u32,
    vocab: Vec<DriveTag>,
    labels: BTreeMap<String, Vec<String>>,
}

// ---------------------------------------------------------------------------
// Builtins
// ---------------------------------------------------------------------------

const BUILTINS: [(&str, &str, DriveTagColor); 7] = [
    ("label:red", "Red", DriveTagColor::Red),
    ("label:orange", "Orange", DriveTagColor::Orange),
    ("label:yellow", "Yellow", DriveTagColor::Yellow),
    ("label:green", "Green", DriveTagColor::Green),
    ("label:blue", "Blue", DriveTagColor::Blue),
    ("label:purple", "Purple", DriveTagColor::Purple),
    ("label:gray", "Gray", DriveTagColor::Gray),
];

fn builtin_tags() -> Vec<DriveTag> {
    BUILTINS
        .iter()
        .map(|(id, name, color)| DriveTag {
            id: (*id).to_string(),
            name: (*name).to_string(),
            color: *color,
            builtin: true,
        })
        .collect()
}

fn is_builtin_id(id: &str) -> bool {
    BUILTINS.iter().any(|(bid, _, _)| *bid == id)
}

fn fresh_index() -> DriveMeta {
    DriveMeta {
        version: META_VERSION,
        vocab: builtin_tags(),
        labels: BTreeMap::new(),
        warning: None,
    }
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/// Normalise a rel_path into the index's key form: forward slashes, no
/// leading or trailing slash, no `.`/empty segments.
fn normalize_key(rel: &str) -> String {
    rel.replace('\\', "/")
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != ".")
        .collect::<Vec<_>>()
        .join("/")
}

/// True when `key` is `prefix` itself or lives under `prefix/`.
fn key_in_subtree(key: &str, prefix: &str) -> bool {
    key == prefix
        || key
            .strip_prefix(prefix)
            .is_some_and(|tail| tail.starts_with('/'))
}

/// `from/a/b` → `to/a/b` (and `from` → `to`). Caller guarantees
/// `key_in_subtree(key, from)`.
fn rekey(key: &str, from: &str, to: &str) -> String {
    let tail = &key[from.len()..];
    if to.is_empty() {
        tail.trim_start_matches('/').to_string()
    } else {
        format!("{to}{tail}")
    }
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/// Process-wide lock so two commands never interleave a read-modify-write.
fn index_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn index_path(root: &Path) -> PathBuf {
    root.join(META_FILENAME)
}

/// Move an unreadable index aside and return a fresh one carrying the reason.
fn move_aside(path: &Path, reason: &str) -> DriveMeta {
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let aside = path.with_file_name(format!("{META_FILENAME}.corrupt-{stamp}"));
    let mut meta = fresh_index();
    match std::fs::rename(path, &aside) {
        Ok(()) => {
            tracing::warn!(
                ?path,
                ?aside,
                reason,
                "drive meta: index unreadable, moved aside"
            );
            let aside_name = aside
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            meta.warning = Some(format!(
                "Tag index was unreadable and moved aside to {aside_name}: {reason}"
            ));
        }
        Err(e) => {
            tracing::warn!(
                ?path,
                reason,
                error = %e,
                "drive meta: index unreadable and could not be moved aside"
            );
            meta.warning = Some(format!(
                "Tag index was unreadable ({reason}) and could not be moved aside: {e}"
            ));
        }
    }
    meta
}

/// Re-seed builtins (canonical order, canonical fields), keep user tags in
/// file order, scrub label sets down to known ids.
fn hydrate(disk: DiskIndex) -> DriveMeta {
    let mut vocab = builtin_tags();
    for tag in disk.vocab {
        if is_builtin_id(&tag.id) || vocab.iter().any(|t| t.id == tag.id) {
            continue;
        }
        vocab.push(DriveTag {
            builtin: false,
            ..tag
        });
    }
    let mut meta = DriveMeta {
        version: META_VERSION,
        vocab,
        labels: BTreeMap::new(),
        warning: None,
    };
    for (key, ids) in disk.labels {
        let key = normalize_key(&key);
        if key.is_empty() {
            continue;
        }
        let ids = meta.filter_ids(ids.iter().map(String::as_str));
        if !ids.is_empty() {
            meta.labels.insert(key, ids);
        }
    }
    meta
}

/// Read the index without touching the lock. Never creates the file.
fn load_index(root: &Path) -> DriveMeta {
    let path = index_path(root);
    if !path.exists() {
        return fresh_index();
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return move_aside(&path, &format!("read failed: {e}")),
    };
    let disk: DiskIndex = match serde_json::from_str(&text) {
        Ok(d) => d,
        Err(e) => return move_aside(&path, &format!("parse failed: {e}")),
    };
    if disk.version != META_VERSION {
        return move_aside(&path, &format!("unsupported version {}", disk.version));
    }
    hydrate(disk)
}

/// Pretty JSON, tmp + rename. The tmp name starts with `META_FILENAME` so it
/// is bookkeeping for every walker even if a crash leaves it behind.
fn save_index(root: &Path, meta: &DriveMeta) -> Result<(), AppError> {
    let disk = DiskIndex {
        version: META_VERSION,
        vocab: meta.vocab.clone(),
        labels: meta.labels.clone(),
    };
    let text = serde_json::to_string_pretty(&disk)?;
    let path = index_path(root);
    let tmp = path.with_file_name(format!("{META_FILENAME}.tmp-{}", std::process::id()));
    std::fs::write(&tmp, text)?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Lock, load, mutate, save-if-changed. The closure returns `true` when it
/// changed something worth persisting.
fn with_index<F>(root: &Path, f: F) -> Result<DriveMeta, AppError>
where
    F: FnOnce(&mut DriveMeta) -> Result<bool, AppError>,
{
    let _guard = index_lock();
    let mut meta = load_index(root);
    if f(&mut meta)? {
        save_index(root, &meta)?;
    }
    Ok(meta)
}

// ---------------------------------------------------------------------------
// Pure mutations on a loaded index
// ---------------------------------------------------------------------------

impl DriveMeta {
    /// Keep only known ids, ordered as the vocab orders them, deduped.
    fn filter_ids<'a>(&self, ids: impl Iterator<Item = &'a str>) -> Vec<String> {
        let wanted: Vec<&str> = ids.collect();
        self.vocab
            .iter()
            .filter(|t| wanted.contains(&t.id.as_str()))
            .map(|t| t.id.clone())
            .collect()
    }

    fn has_tag(&self, id: &str) -> bool {
        self.vocab.iter().any(|t| t.id == id)
    }

    /// Returns true when the label set changed.
    fn set_labels(&mut self, key: &str, ids: &[String]) -> bool {
        let ids = self.filter_ids(ids.iter().map(String::as_str));
        if ids.is_empty() {
            self.labels.remove(key).is_some()
        } else if self.labels.get(key) == Some(&ids) {
            false
        } else {
            self.labels.insert(key.to_string(), ids);
            true
        }
    }

    fn upsert_tag(&mut self, tag: DriveTag) -> Result<(), AppError> {
        if tag.builtin || is_builtin_id(&tag.id) {
            return Err(AppError::Validation(
                "Builtin labels cannot be edited".into(),
            ));
        }
        let name = tag.name.trim().to_string();
        if name.is_empty() {
            return Err(AppError::Validation("Tag name cannot be empty".into()));
        }
        if name.chars().count() > MAX_TAG_NAME_LEN {
            return Err(AppError::Validation(format!(
                "Tag name is longer than {MAX_TAG_NAME_LEN} characters"
            )));
        }
        let id = if tag.id.starts_with("tag:") && tag.id.len() > 4 {
            tag.id
        } else {
            format!("tag:{}", uuid::Uuid::new_v4())
        };
        let lower = name.to_lowercase();
        if self
            .vocab
            .iter()
            .any(|t| !t.builtin && t.id != id && t.name.to_lowercase() == lower)
        {
            return Err(AppError::Validation(format!(
                "A tag named '{name}' already exists"
            )));
        }
        let next = DriveTag {
            id,
            name,
            color: tag.color,
            builtin: false,
        };
        match self.vocab.iter_mut().find(|t| t.id == next.id) {
            Some(slot) => *slot = next,
            None => self.vocab.push(next),
        }
        Ok(())
    }

    fn delete_tag(&mut self, id: &str) -> Result<(), AppError> {
        if is_builtin_id(id) {
            return Err(AppError::Validation(
                "Builtin labels cannot be deleted".into(),
            ));
        }
        let before = self.vocab.len();
        self.vocab.retain(|t| t.id != id);
        if self.vocab.len() == before {
            return Err(AppError::NotFound(format!("No such tag: {id}")));
        }
        for ids in self.labels.values_mut() {
            ids.retain(|t| t != id);
        }
        self.labels.retain(|_, ids| !ids.is_empty());
        Ok(())
    }
}

/// Everything labelled `tag_id`, pruning keys whose path has vanished.
fn tagged_entries(root: &Path, tag_id: &str) -> Result<Vec<DriveEntry>, AppError> {
    let mut out = Vec::new();
    with_index(root, |meta| {
        if !meta.has_tag(tag_id) {
            return Err(AppError::NotFound(format!("No such tag: {tag_id}")));
        }
        let mut vanished = Vec::new();
        for (key, ids) in &meta.labels {
            if !ids.iter().any(|t| t == tag_id) {
                continue;
            }
            let abs = root.join(key);
            if !abs.exists() {
                vanished.push(key.clone());
                continue;
            }
            match build_entry(root, &abs) {
                Ok(entry) => out.push(entry),
                Err(e) => {
                    tracing::warn!(key, error = %e, "drive meta: tagged entry unreadable")
                }
            }
        }
        for key in &vanished {
            meta.labels.remove(key);
        }
        Ok(!vanished.is_empty())
    })?;
    // Same comparator as `drive_list`: folders first, then case-insensitive name.
    out.sort_by(|a, b| match (a.kind, b.kind) {
        (DriveEntryKind::Folder, DriveEntryKind::File) => std::cmp::Ordering::Less,
        (DriveEntryKind::File, DriveEntryKind::Folder) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

// ---------------------------------------------------------------------------
// Hooks for file mutations — never fail the caller
// ---------------------------------------------------------------------------

/// Run a label-index edit as a side effect of a file operation: a no-op when
/// the index file does not exist, and every error becomes a warning because a
/// tag-index hiccup must never fail the file operation that triggered it.
fn hook<F>(root: &Path, what: &str, f: F)
where
    F: FnOnce(&mut DriveMeta) -> bool,
{
    if !index_path(root).exists() {
        return;
    }
    if let Err(e) = with_index(root, |meta| Ok(f(meta))) {
        tracing::warn!(what, error = %e, "drive meta: label index update failed");
    }
}

/// Collect the keys at or under `prefix`.
fn subtree_keys(meta: &DriveMeta, prefix: &str) -> Vec<String> {
    meta.labels
        .keys()
        .filter(|k| key_in_subtree(k, prefix))
        .cloned()
        .collect()
}

/// Rename/move: move the key for `from_rel` and every key under it to `to_rel`.
pub(super) fn rekey_labels(root: &Path, from_rel: &str, to_rel: &str) {
    let (from, to) = (normalize_key(from_rel), normalize_key(to_rel));
    if from.is_empty() || from == to {
        return;
    }
    hook(root, "rekey", |meta| {
        let keys = subtree_keys(meta, &from);
        for key in &keys {
            if let Some(ids) = meta.labels.remove(key) {
                meta.labels.insert(rekey(key, &from, &to), ids);
            }
        }
        !keys.is_empty()
    });
}

/// Copy: duplicate the key for `from_rel` and every key under it at `to_rel`.
pub(super) fn copy_labels(root: &Path, from_rel: &str, to_rel: &str) {
    let (from, to) = (normalize_key(from_rel), normalize_key(to_rel));
    if from.is_empty() || from == to {
        return;
    }
    hook(root, "copy", |meta| {
        let keys = subtree_keys(meta, &from);
        for key in &keys {
            if let Some(ids) = meta.labels.get(key).cloned() {
                meta.labels.insert(rekey(key, &from, &to), ids);
            }
        }
        !keys.is_empty()
    });
}

/// Hard delete: drop the key for `rel` and every key under it.
pub(super) fn drop_labels(root: &Path, rel: &str) {
    let target = normalize_key(rel);
    if target.is_empty() {
        return;
    }
    hook(root, "drop", |meta| {
        let keys = subtree_keys(meta, &target);
        for key in &keys {
            meta.labels.remove(key);
        }
        !keys.is_empty()
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn drive_meta_get(app: AppHandle) -> Result<DriveMeta, AppError> {
    let root = managed_root(&app)?;
    let _guard = index_lock();
    Ok(load_index(&root))
}

#[tauri::command]
pub fn drive_tags_set(
    app: AppHandle,
    rel_path: String,
    tag_ids: Vec<String>,
) -> Result<DriveMeta, AppError> {
    let root = managed_root(&app)?;
    let abs = resolve_safe(&root, &rel_path)?;
    if !abs.exists() {
        return Err(AppError::NotFound(format!("Not found: {rel_path}")));
    }
    let key = to_relative_display(&root, &abs);
    if key.is_empty() {
        return Err(AppError::Validation(
            "The drive root cannot be tagged".into(),
        ));
    }
    with_index(&root, |meta| Ok(meta.set_labels(&key, &tag_ids)))
}

#[tauri::command]
pub fn drive_tag_upsert(app: AppHandle, tag: DriveTag) -> Result<DriveMeta, AppError> {
    let root = managed_root(&app)?;
    with_index(&root, |meta| meta.upsert_tag(tag).map(|()| true))
}

#[tauri::command]
pub fn drive_tag_delete(app: AppHandle, tag_id: String) -> Result<DriveMeta, AppError> {
    let root = managed_root(&app)?;
    with_index(&root, |meta| meta.delete_tag(&tag_id).map(|()| true))
}

#[tauri::command]
pub fn drive_tagged(app: AppHandle, tag_id: String) -> Result<Vec<DriveEntry>, AppError> {
    let root = managed_root(&app)?;
    tagged_entries(&root, &tag_id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root() -> PathBuf {
        let base =
            std::env::temp_dir().join(format!("personas-drive-meta-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        fs::canonicalize(&base).unwrap()
    }

    fn user_tag(name: &str) -> DriveTag {
        DriveTag {
            id: String::new(),
            name: name.to_string(),
            color: DriveTagColor::Blue,
            builtin: false,
        }
    }

    fn add_tag(root: &Path, name: &str) -> String {
        let meta = with_index(root, |m| m.upsert_tag(user_tag(name)).map(|()| true)).unwrap();
        let wanted = name.trim();
        meta.vocab
            .iter()
            .find(|t| t.name == wanted)
            .unwrap()
            .id
            .clone()
    }

    fn set(root: &Path, key: &str, ids: &[&str]) -> DriveMeta {
        let ids: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
        with_index(root, |m| Ok(m.set_labels(key, &ids))).unwrap()
    }

    #[test]
    fn fresh_index_seeds_seven_builtins_without_creating_file() {
        let root = temp_root();
        let meta = load_index(&root);
        assert_eq!(meta.version, 1);
        assert_eq!(meta.vocab.len(), 7);
        assert!(meta
            .vocab
            .iter()
            .all(|t| t.builtin && t.id.starts_with("label:")));
        assert_eq!(meta.vocab[0].name, "Red");
        assert!(meta.labels.is_empty());
        assert!(meta.warning.is_none());
        assert!(!index_path(&root).exists());
    }

    #[test]
    fn valid_file_round_trips_and_reseeds_missing_builtins() {
        let root = temp_root();
        fs::write(
            index_path(&root),
            r#"{"version":1,"vocab":[{"id":"tag:abc","name":"Work","color":"green","builtin":false}],"labels":{"/docs\\a.txt":["tag:abc","label:red","bogus"]}}"#,
        )
        .unwrap();
        let meta = load_index(&root);
        assert!(meta.warning.is_none());
        assert_eq!(meta.vocab.len(), 8);
        assert_eq!(meta.vocab[7].id, "tag:abc");
        assert_eq!(
            meta.labels.get("docs/a.txt").unwrap(),
            &vec!["label:red".to_string(), "tag:abc".to_string()]
        );
        save_index(&root, &meta).unwrap();
        let text = fs::read_to_string(index_path(&root)).unwrap();
        assert!(!text.contains("warning"));
        let again = load_index(&root);
        assert_eq!(again.vocab, meta.vocab);
        assert_eq!(again.labels, meta.labels);
    }

    #[test]
    fn corrupt_file_is_moved_aside_with_warning() {
        let root = temp_root();
        fs::write(index_path(&root), "{ not json").unwrap();
        let meta = load_index(&root);
        assert_eq!(meta.vocab.len(), 7);
        assert!(meta.warning.as_deref().unwrap().contains("moved aside"));
        assert!(!index_path(&root).exists());
        let aside: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(".drive-meta.json.corrupt-"))
            .collect();
        assert_eq!(aside.len(), 1);
        assert!(super::super::is_bookkeeping(&aside[0]));
    }

    #[test]
    fn wrong_version_is_moved_aside() {
        let root = temp_root();
        fs::write(index_path(&root), r#"{"version":2,"vocab":[],"labels":{}}"#).unwrap();
        let meta = load_index(&root);
        assert!(meta.warning.as_deref().unwrap().contains("version 2"));
    }

    #[test]
    fn tags_set_dedupes_drops_unknown_and_removes_empty() {
        let root = temp_root();
        let id = add_tag(&root, "Work");
        let meta = set(&root, "a.txt", &[&id, "label:red", "nope", "label:red"]);
        assert_eq!(
            meta.labels["a.txt"],
            vec!["label:red".to_string(), id.clone()]
        );
        let meta = set(&root, "a.txt", &["nope"]);
        assert!(!meta.labels.contains_key("a.txt"));
        let meta = set(&root, "a.txt", &[]);
        assert!(!meta.labels.contains_key("a.txt"));
    }

    #[test]
    fn tag_upsert_assigns_id_rejects_builtin_and_duplicate() {
        let root = temp_root();
        let id = add_tag(&root, "  Work  ");
        assert!(id.starts_with("tag:"));
        let meta = load_index(&root);
        assert_eq!(meta.vocab.last().unwrap().name, "Work");

        let dup = with_index(&root, |m| m.upsert_tag(user_tag("work")).map(|()| true));
        assert!(matches!(dup, Err(AppError::Validation(_))));

        let builtin = with_index(&root, |m| {
            m.upsert_tag(DriveTag {
                id: "label:red".into(),
                name: "Crimson".into(),
                color: DriveTagColor::Red,
                builtin: true,
            })
            .map(|()| true)
        });
        assert!(matches!(builtin, Err(AppError::Validation(_))));

        let empty = with_index(&root, |m| m.upsert_tag(user_tag("   ")).map(|()| true));
        assert!(matches!(empty, Err(AppError::Validation(_))));

        // Editing itself keeps the id and does not collide with itself.
        let renamed = with_index(&root, |m| {
            m.upsert_tag(DriveTag {
                id: id.clone(),
                name: "Work".into(),
                color: DriveTagColor::Purple,
                builtin: false,
            })
            .map(|()| true)
        })
        .unwrap();
        let tag = renamed.vocab.iter().find(|t| t.id == id).unwrap();
        assert_eq!(tag.color, DriveTagColor::Purple);
        assert_eq!(renamed.vocab.len(), 8);
    }

    #[test]
    fn tag_delete_rejects_builtin_and_scrubs_labels() {
        let root = temp_root();
        let id = add_tag(&root, "Work");
        set(&root, "a.txt", &[&id]);
        set(&root, "b.txt", &[&id, "label:blue"]);

        let builtin = with_index(&root, |m| m.delete_tag("label:red").map(|()| true));
        assert!(matches!(builtin, Err(AppError::Validation(_))));
        let missing = with_index(&root, |m| m.delete_tag("tag:missing").map(|()| true));
        assert!(matches!(missing, Err(AppError::NotFound(_))));

        let meta = with_index(&root, |m| m.delete_tag(&id).map(|()| true)).unwrap();
        assert_eq!(meta.vocab.len(), 7);
        assert!(!meta.labels.contains_key("a.txt"));
        assert_eq!(meta.labels["b.txt"], vec!["label:blue".to_string()]);
    }

    #[test]
    fn rekey_moves_key_and_subtree() {
        let root = temp_root();
        set(&root, "docs", &["label:red"]);
        set(&root, "docs/a.txt", &["label:green"]);
        set(&root, "docs2/x.txt", &["label:gray"]);
        rekey_labels(&root, "/docs", "archive/old");
        let meta = load_index(&root);
        assert_eq!(meta.labels["archive/old"], vec!["label:red".to_string()]);
        assert_eq!(
            meta.labels["archive/old/a.txt"],
            vec!["label:green".to_string()]
        );
        assert_eq!(meta.labels["docs2/x.txt"], vec!["label:gray".to_string()]);
        assert!(!meta.labels.contains_key("docs"));
    }

    #[test]
    fn copy_duplicates_and_drop_removes_subtree() {
        let root = temp_root();
        set(&root, "docs", &["label:red"]);
        set(&root, "docs/a.txt", &["label:green"]);
        copy_labels(&root, "docs", "copy");
        let meta = load_index(&root);
        assert_eq!(meta.labels.len(), 4);
        assert_eq!(meta.labels["copy/a.txt"], vec!["label:green".to_string()]);
        drop_labels(&root, "docs");
        let meta = load_index(&root);
        assert_eq!(meta.labels.len(), 2);
        assert!(meta.labels.keys().all(|k| k.starts_with("copy")));
    }

    #[test]
    fn hooks_are_noops_without_index_file() {
        let root = temp_root();
        rekey_labels(&root, "a", "b");
        copy_labels(&root, "a", "b");
        drop_labels(&root, "a");
        assert!(!index_path(&root).exists());
    }

    #[test]
    fn tagged_skips_vanished_path_and_prunes_it() {
        let root = temp_root();
        fs::write(root.join("b.txt"), "b").unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();
        fs::create_dir_all(root.join("zed")).unwrap();
        set(&root, "a.txt", &["label:red"]);
        set(&root, "b.txt", &["label:red", "label:blue"]);
        set(&root, "zed", &["label:red"]);
        set(&root, "gone.txt", &["label:red"]);

        let entries = tagged_entries(&root, "label:red").unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["zed", "a.txt", "b.txt"]);
        assert!(!load_index(&root).labels.contains_key("gone.txt"));

        let blue = tagged_entries(&root, "label:blue").unwrap();
        assert_eq!(blue.len(), 1);
        assert!(matches!(
            tagged_entries(&root, "tag:nope"),
            Err(AppError::NotFound(_))
        ));
    }
}
