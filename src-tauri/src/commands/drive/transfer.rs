//! Drive transfers: duplicate, import from OS paths, export to an OS folder,
//! and the absolute-path resolver the native drag-out hands to the OS.
//!
//! WIRE CONTRACT (drive-finder spark, 2026-09-17). Bytes never cross IPC:
//! import and export copy on the Rust side from / to absolute OS paths the
//! dialog plugin returned. None of these commands destroy data, so none is
//! privileged (`drive_delete` stays the only privileged drive command).
//!
//! Shape: each command resolves the root, calls one pure `*_impl(root, …)`
//! that only knows `&Path`, then emits persona events for what landed. The
//! impls are what the tests drive — an `AppHandle` is not constructible there.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use ts_rs::TS;

use crate::commands::credentials::auth_detect::strip_verbatim_prefix;
use crate::error::AppError;

use super::{
    build_entry, copy_dir_recursive, drive_event, emit_added_for_subtree, emit_drive_event,
    is_bookkeeping, managed_root, meta, resolve_safe, to_relative_display, DriveEntry,
    MAX_WRITE_BYTES,
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveTransferFailure {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveTransferReport {
    /// Top-level items copied successfully.
    pub added: u32,
    /// Names refused because a single file exceeded MAX_WRITE_BYTES.
    pub too_large: Vec<String>,
    /// Names that failed for any other reason, with the reason.
    pub failed: Vec<DriveTransferFailure>,
}

impl DriveTransferReport {
    fn fail(&mut self, name: impl Into<String>, reason: impl Into<String>) {
        self.failed.push(DriveTransferFailure {
            name: name.into(),
            reason: reason.into(),
        });
    }
}

/// Beyond this many `copy N` siblings the name is refused rather than
/// probed forever.
const MAX_COPY_SUFFIX: u32 = 1000;

const REASON_ALREADY_IN_DRIVE: &str = "already in Drive";
const REASON_SYMLINK: &str = "symlinks are not imported";

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/// `(stem, ext)` on the LAST dot of a file name; folders and dot-files
/// (`.env`) have no extension. `archive.tar.gz` → `("archive.tar", "gz")`.
fn split_ext(name: &str, is_dir: bool) -> (&str, Option<&str>) {
    if is_dir {
        return (name, None);
    }
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], Some(&name[i + 1..])),
        _ => (name, None),
    }
}

/// First free sibling of `name` in `dir`: `<stem> copy.<ext>`, then
/// `<stem> copy 2.<ext>`, … (`<name> copy`, `<name> copy 2` for folders and
/// extension-less files). "Free" is judged with `symlink_metadata` so a
/// dangling symlink still counts as taken.
pub(super) fn next_copy_name(dir: &Path, name: &str, is_dir: bool) -> Result<PathBuf, AppError> {
    let (stem, ext) = split_ext(name, is_dir);
    for n in 1..=MAX_COPY_SUFFIX {
        let base = if n == 1 {
            format!("{stem} copy")
        } else {
            format!("{stem} copy {n}")
        };
        let candidate = match ext {
            Some(e) => format!("{base}.{e}"),
            None => base,
        };
        let path = dir.join(candidate);
        if std::fs::symlink_metadata(&path).is_err() {
            return Ok(path);
        }
    }
    Err(AppError::Validation(format!(
        "Too many copies of {name} (limit {MAX_COPY_SUFFIX})"
    )))
}

/// `dir/name` when free, otherwise the next `copy` sibling.
fn free_target(dir: &Path, name: &str, is_dir: bool) -> Result<PathBuf, AppError> {
    let plain = dir.join(name);
    if std::fs::symlink_metadata(&plain).is_err() {
        Ok(plain)
    } else {
        next_copy_name(dir, name, is_dir)
    }
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn os_string(path: &Path) -> String {
    strip_verbatim_prefix(path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

/// Copies `rel_path` beside itself under the next `copy` name and carries its
/// labels across. Returns the entry plus whether a subtree was copied.
fn duplicate_impl(root: &Path, rel_path: &str) -> Result<(DriveEntry, bool), AppError> {
    let src = resolve_safe(root, rel_path)?;
    if src == root {
        return Err(AppError::Validation(
            "The Drive root cannot be duplicated".into(),
        ));
    }
    if !src.exists() {
        return Err(AppError::NotFound(format!("Source not found: {rel_path}")));
    }
    let parent = src
        .parent()
        .ok_or_else(|| AppError::Validation("Drive path has no parent directory".into()))?;
    let is_dir = src.is_dir();
    let dst = next_copy_name(parent, &file_name_of(&src), is_dir)?;
    if is_dir {
        copy_dir_recursive(&src, &dst)?;
    } else {
        std::fs::copy(&src, &dst)?;
    }
    let entry = build_entry(root, &dst)?;
    meta::copy_labels(root, rel_path, &entry.path);
    Ok((entry, is_dir))
}

/// `name copy.ext`, then `name copy 2.ext`, … Folders duplicate recursively;
/// tags in the index are copied to the new key.
#[tauri::command]
pub fn drive_duplicate(app: AppHandle, rel_path: String) -> Result<DriveEntry, AppError> {
    let root = managed_root(&app)?;
    let (entry, was_dir) = duplicate_impl(&root, &rel_path)?;
    emit_drive_event(
        &app,
        drive_event::ADDED,
        &entry.path,
        Some(serde_json::json!({ "from_path": rel_path, "copied": true })),
    );
    if was_dir {
        emit_added_for_subtree(&app, &root, &root.join(&entry.path), &rel_path);
    }
    Ok(entry)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/// One top-level item that landed inside the drive; the command turns these
/// into `drive.document.added` events.
struct Landed {
    /// Drive-relative display path of the new node.
    rel: String,
    is_dir: bool,
    /// Where it came from (absolute OS path), for the event payload.
    from: String,
}

/// Recursive import copier. Unlike `copy_dir_recursive` this one is
/// policy-bearing: it skips bookkeeping/clutter names, refuses to follow
/// symlinks, caps every file at `MAX_WRITE_BYTES`, and keeps going after a
/// bad item so a folder with one oversized file still lands the rest.
fn import_tree(src: &Path, dst: &Path, report: &mut DriveTransferReport) -> Result<(), AppError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_bookkeeping(&name) {
            continue;
        }
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(&name);
        if ty.is_symlink() {
            report.fail(name, REASON_SYMLINK);
        } else if ty.is_dir() {
            import_tree(&from, &to, report)?;
        } else if entry.metadata()?.len() > MAX_WRITE_BYTES as u64 {
            report.too_large.push(name);
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Validates one OS path against the sandbox; `Err` is the row's reason.
fn import_source(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let given = PathBuf::from(raw);
    if !given.is_absolute() {
        return Err("path must be absolute".into());
    }
    let meta = std::fs::symlink_metadata(&given).map_err(|_| "not found".to_string())?;
    if meta.file_type().is_symlink() {
        return Err(REASON_SYMLINK.into());
    }
    let src = std::fs::canonicalize(&given).map_err(|e| format!("unreadable: {e}"))?;
    if src.starts_with(root) {
        return Err(REASON_ALREADY_IN_DRIVE.into());
    }
    if root.starts_with(&src) {
        return Err("contains the Drive".into());
    }
    if is_bookkeeping(&file_name_of(&src)) {
        return Err("bookkeeping file".into());
    }
    Ok(src)
}

/// Copies one validated source into `dest`. `Ok(None)` = refused for size.
fn import_one(
    src: &Path,
    dest: &Path,
    name: &str,
    is_dir: bool,
    report: &mut DriveTransferReport,
) -> Result<Option<PathBuf>, AppError> {
    let dst = free_target(dest, name, is_dir)?;
    if is_dir {
        import_tree(src, &dst, report)?;
    } else {
        if std::fs::metadata(src)?.len() > MAX_WRITE_BYTES as u64 {
            return Ok(None);
        }
        std::fs::copy(src, &dst)?;
    }
    Ok(Some(dst))
}

fn import_paths_impl(
    root: &Path,
    paths: &[String],
    dest_rel: &str,
) -> Result<(DriveTransferReport, Vec<Landed>), AppError> {
    let dest = resolve_safe(root, dest_rel)?;
    if !dest.is_dir() {
        return Err(AppError::NotFound(format!(
            "Destination folder not found: {dest_rel}"
        )));
    }
    let mut report = DriveTransferReport::default();
    let mut landed = Vec::new();
    for raw in paths {
        let src = match import_source(root, raw) {
            Ok(p) => p,
            Err(reason) => {
                report.fail(file_name_of(Path::new(raw)), reason);
                continue;
            }
        };
        let name = file_name_of(&src);
        let is_dir = src.is_dir();
        match import_one(&src, &dest, &name, is_dir, &mut report) {
            Ok(None) => report.too_large.push(name),
            Ok(Some(dst)) => {
                report.added += 1;
                landed.push(Landed {
                    rel: to_relative_display(root, &dst),
                    is_dir,
                    from: os_string(&src),
                });
            }
            Err(e) => report.fail(name, e.to_string()),
        }
    }
    Ok((report, landed))
}

/// Copy absolute OS paths (files or folders) into `dest_rel`.
#[tauri::command]
pub fn drive_import_paths(
    app: AppHandle,
    paths: Vec<String>,
    dest_rel: String,
) -> Result<DriveTransferReport, AppError> {
    let root = managed_root(&app)?;
    let (report, landed) = import_paths_impl(&root, &paths, &dest_rel)?;
    for item in &landed {
        emit_drive_event(
            &app,
            drive_event::ADDED,
            &item.rel,
            Some(serde_json::json!({ "from_path": item.from, "imported": true })),
        );
        if item.is_dir {
            emit_added_for_subtree(&app, &root, &root.join(&item.rel), &item.from);
        }
    }
    Ok(report)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

fn export_dest(root: &Path, dest_dir: &str) -> Result<PathBuf, AppError> {
    let given = PathBuf::from(dest_dir);
    if !given.is_absolute() {
        return Err(AppError::Validation(
            "Export destination must be an absolute path".into(),
        ));
    }
    let dest = std::fs::canonicalize(&given)
        .map_err(|_| AppError::NotFound(format!("Export destination not found: {dest_dir}")))?;
    if !dest.is_dir() {
        return Err(AppError::Validation(
            "Export destination must be a folder".into(),
        ));
    }
    if dest.starts_with(root) {
        return Err(AppError::Validation(
            "Export destination is inside the Drive; use copy or move instead".into(),
        ));
    }
    Ok(dest)
}

fn export_to_impl(
    root: &Path,
    rel_paths: &[String],
    dest_dir: &str,
) -> Result<DriveTransferReport, AppError> {
    let dest = export_dest(root, dest_dir)?;
    let mut report = DriveTransferReport::default();
    for rel in rel_paths {
        let src = match resolve_safe(root, rel) {
            Ok(p) => p,
            Err(e) => {
                report.fail(rel, e.to_string());
                continue;
            }
        };
        if src == root {
            report.fail(rel, "the Drive root cannot be exported");
            continue;
        }
        if !src.exists() {
            report.fail(rel, "not found");
            continue;
        }
        let name = file_name_of(&src);
        let is_dir = src.is_dir();
        let outcome = free_target(&dest, &name, is_dir).and_then(|dst| {
            if is_dir {
                copy_dir_recursive(&src, &dst)
            } else {
                std::fs::copy(&src, &dst).map(|_| ()).map_err(Into::into)
            }
        });
        match outcome {
            Ok(()) => report.added += 1,
            Err(e) => report.fail(rel, e.to_string()),
        }
    }
    Ok(report)
}

/// Copy drive entries out to an absolute OS directory. Collisions get the
/// `name copy` suffix rather than overwriting. No drive events: nothing
/// inside the drive changed.
#[tauri::command]
pub fn drive_export_to(
    app: AppHandle,
    rel_paths: Vec<String>,
    dest_dir: String,
) -> Result<DriveTransferReport, AppError> {
    let root = managed_root(&app)?;
    export_to_impl(&root, &rel_paths, &dest_dir)
}

// ---------------------------------------------------------------------------
// Drag-out
// ---------------------------------------------------------------------------

fn abs_paths_impl(root: &Path, rel_paths: &[String]) -> Result<Vec<String>, AppError> {
    rel_paths
        .iter()
        .map(|rel| {
            let abs = resolve_safe(root, rel)?;
            if !abs.exists() {
                return Err(AppError::NotFound(format!("Not found: {rel}")));
            }
            Ok(os_string(&abs))
        })
        .collect()
}

/// Absolute paths for a set of drive entries (for the native drag-out).
/// Native separators, verbatim prefix stripped — the drag plugin hands these
/// straight to the OS.
#[tauri::command]
pub fn drive_abs_paths(app: AppHandle, rel_paths: Vec<String>) -> Result<Vec<String>, AppError> {
    let root = managed_root(&app)?;
    abs_paths_impl(&root, &rel_paths)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "personas-drive-transfer-{tag}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&base).unwrap();
        fs::canonicalize(&base).unwrap()
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn name(p: &Path) -> String {
        file_name_of(p)
    }

    fn os(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    /// Seed `.drive-meta.json` with builtin-labelled keys.
    fn seed_labels(root: &Path, labels: &[(&str, &str)]) {
        let map: BTreeMap<&str, Vec<&str>> = labels.iter().map(|(k, id)| (*k, vec![*id])).collect();
        let json = serde_json::json!({ "version": 1, "vocab": [], "labels": map });
        fs::write(root.join(meta::META_FILENAME), json.to_string()).unwrap();
    }

    fn read_labels(root: &Path) -> BTreeMap<String, Vec<String>> {
        let text = fs::read_to_string(root.join(meta::META_FILENAME)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        serde_json::from_value(v["labels"].clone()).unwrap()
    }

    #[test]
    fn next_copy_name_sequence() {
        let dir = temp_dir("names");
        write(&dir.join("a.txt"), b"1");
        assert_eq!(
            name(&next_copy_name(&dir, "a.txt", false).unwrap()),
            "a copy.txt"
        );
        write(&dir.join("a copy.txt"), b"1");
        assert_eq!(
            name(&next_copy_name(&dir, "a.txt", false).unwrap()),
            "a copy 2.txt"
        );
        write(&dir.join("a copy 2.txt"), b"1");
        assert_eq!(
            name(&next_copy_name(&dir, "a.txt", false).unwrap()),
            "a copy 3.txt"
        );
        // No extension.
        assert_eq!(
            name(&next_copy_name(&dir, "README", false).unwrap()),
            "README copy"
        );
        // Dot-file: the leading dot is not an extension separator.
        assert_eq!(
            name(&next_copy_name(&dir, ".env", false).unwrap()),
            ".env copy"
        );
        // Only the LAST dot counts.
        assert_eq!(
            name(&next_copy_name(&dir, "archive.tar.gz", false).unwrap()),
            "archive.tar copy.gz"
        );
        // Folders keep their dots.
        assert_eq!(
            name(&next_copy_name(&dir, "v1.0", true).unwrap()),
            "v1.0 copy"
        );
        fs::create_dir(dir.join("v1.0 copy")).unwrap();
        assert_eq!(
            name(&next_copy_name(&dir, "v1.0", true).unwrap()),
            "v1.0 copy 2"
        );
    }

    #[test]
    fn duplicate_file_copies_bytes_and_labels() {
        let root = temp_dir("dup-file");
        write(&root.join("docs/notes.md"), b"hello");
        seed_labels(&root, &[("docs/notes.md", "label:red")]);

        let (entry, was_dir) = duplicate_impl(&root, "docs/notes.md").unwrap();
        assert!(!was_dir);
        assert_eq!(entry.path, "docs/notes copy.md");
        assert_eq!(fs::read(root.join("docs/notes copy.md")).unwrap(), b"hello");
        let labels = read_labels(&root);
        assert_eq!(labels["docs/notes copy.md"], vec!["label:red".to_string()]);
        assert_eq!(labels["docs/notes.md"], vec!["label:red".to_string()]);

        // Second duplicate of the same source takes the next free name.
        let (again, _) = duplicate_impl(&root, "docs/notes.md").unwrap();
        assert_eq!(again.path, "docs/notes copy 2.md");
    }

    #[test]
    fn duplicate_folder_copies_subtree_and_nested_labels() {
        let root = temp_dir("dup-folder");
        write(&root.join("proj/a.txt"), b"a");
        write(&root.join("proj/sub/b.txt"), b"b");
        seed_labels(
            &root,
            &[("proj", "label:blue"), ("proj/sub/b.txt", "label:green")],
        );

        let (entry, was_dir) = duplicate_impl(&root, "proj").unwrap();
        assert!(was_dir);
        assert_eq!(entry.path, "proj copy");
        assert_eq!(fs::read(root.join("proj copy/sub/b.txt")).unwrap(), b"b");
        let labels = read_labels(&root);
        assert_eq!(labels["proj copy"], vec!["label:blue".to_string()]);
        assert_eq!(
            labels["proj copy/sub/b.txt"],
            vec!["label:green".to_string()]
        );
    }

    #[test]
    fn duplicate_rejects_root_and_missing() {
        let root = temp_dir("dup-reject");
        assert!(matches!(
            duplicate_impl(&root, ""),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            duplicate_impl(&root, "nope.txt"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn import_counts_and_lists_oversized_inside_folder() {
        let root = temp_dir("import-root");
        let outside = temp_dir("import-src");
        write(&outside.join("bundle/ok.txt"), b"fine");
        write(&outside.join("bundle/nested/also.txt"), b"fine");
        write(&outside.join("bundle/.DS_Store"), b"clutter");
        let big = outside.join("bundle/huge.bin");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_WRITE_BYTES as u64 + 1).unwrap();
        drop(f);
        write(&outside.join("single.txt"), b"one");
        fs::create_dir_all(root.join("inbox")).unwrap();

        let paths = vec![
            os(&outside.join("bundle")),
            os(&outside.join("single.txt")),
            os(&outside.join("missing.txt")),
        ];
        let (report, landed) = import_paths_impl(&root, &paths, "inbox").unwrap();
        assert_eq!(report.added, 2);
        assert_eq!(report.too_large, vec!["huge.bin".to_string()]);
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].name, "missing.txt");
        assert_eq!(report.failed[0].reason, "not found");
        assert!(root.join("inbox/bundle/ok.txt").exists());
        assert!(root.join("inbox/bundle/nested/also.txt").exists());
        assert!(!root.join("inbox/bundle/huge.bin").exists());
        assert!(!root.join("inbox/bundle/.DS_Store").exists());
        assert!(root.join("inbox/single.txt").exists());
        assert_eq!(landed.len(), 2);
        assert_eq!(landed[0].rel, "inbox/bundle");
        assert!(landed[0].is_dir);
        assert_eq!(landed[1].rel, "inbox/single.txt");
        assert!(!landed[1].from.starts_with(r"\\?\"));

        // Re-importing the same file lands beside the first under a copy name.
        let (report, landed) = import_paths_impl(&root, &paths[1..2], "inbox").unwrap();
        assert_eq!(report.added, 1);
        assert_eq!(landed[0].rel, "inbox/single copy.txt");

        // A top-level oversized file is a `too_large` row, not `added`.
        let (report, landed) = import_paths_impl(&root, &[os(&big)], "inbox").unwrap();
        assert_eq!(report.added, 0);
        assert!(landed.is_empty());
        assert_eq!(report.too_large, vec!["huge.bin".to_string()]);
    }

    #[test]
    fn import_rejects_paths_inside_the_sandbox_and_bad_dest() {
        let root = temp_dir("import-self");
        write(&root.join("mine.txt"), b"x");
        let (report, landed) = import_paths_impl(&root, &[os(&root.join("mine.txt"))], "").unwrap();
        assert_eq!(report.added, 0);
        assert!(landed.is_empty());
        assert_eq!(report.failed[0].name, "mine.txt");
        assert_eq!(report.failed[0].reason, REASON_ALREADY_IN_DRIVE);
        assert!(root.join("mine.txt").exists());
        assert!(!root.join("mine copy.txt").exists());

        // An ancestor of the sandbox would recurse into itself.
        let parent = root.parent().unwrap();
        let (report, _) = import_paths_impl(&root, &[os(parent)], "").unwrap();
        assert_eq!(report.failed[0].reason, "contains the Drive");

        // A relative OS path is a row, not a crash.
        let (report, _) = import_paths_impl(&root, &["relative.txt".into()], "").unwrap();
        assert_eq!(report.failed[0].reason, "path must be absolute");

        // The destination itself must exist inside the sandbox.
        assert!(matches!(
            import_paths_impl(&root, &[], "no-such-folder"),
            Err(AppError::NotFound(_))
        ));
        assert!(import_paths_impl(&root, &[], "../out").is_err());
    }

    #[test]
    fn export_refuses_dest_inside_sandbox_and_suffixes_on_collision() {
        let root = temp_dir("export-root");
        write(&root.join("report.pdf"), b"pdf");
        write(&root.join("kit/a.txt"), b"a");
        fs::create_dir_all(root.join("inner")).unwrap();

        assert!(matches!(
            export_to_impl(&root, &["report.pdf".into()], &os(&root.join("inner"))),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            export_to_impl(&root, &["report.pdf".into()], "relative/dir"),
            Err(AppError::Validation(_))
        ));

        let dest = temp_dir("export-dest");
        write(&dest.join("report.pdf"), b"existing");
        let report = export_to_impl(
            &root,
            &[
                "report.pdf".into(),
                "kit".into(),
                "ghost.txt".into(),
                "".into(),
            ],
            &os(&dest),
        )
        .unwrap();
        assert_eq!(report.added, 2);
        assert_eq!(report.failed.len(), 2);
        assert_eq!(report.failed[0].name, "ghost.txt");
        assert_eq!(report.failed[0].reason, "not found");
        assert_eq!(fs::read(dest.join("report.pdf")).unwrap(), b"existing");
        assert_eq!(fs::read(dest.join("report copy.pdf")).unwrap(), b"pdf");
        assert_eq!(fs::read(dest.join("kit/a.txt")).unwrap(), b"a");
        // Nothing inside the drive changed.
        assert!(!root.join("report copy.pdf").exists());
    }

    #[test]
    fn abs_paths_are_native_and_verified() {
        let root = temp_dir("abs");
        write(&root.join("f/x.txt"), b"x");
        let out = abs_paths_impl(&root, &["f/x.txt".into()]).unwrap();
        assert_eq!(out.len(), 1);
        assert!(Path::new(&out[0]).is_absolute());
        assert!(!out[0].starts_with(r"\\?\"));
        assert!(Path::new(&out[0]).exists());
        assert!(matches!(
            abs_paths_impl(&root, &["f/missing.txt".into()]),
            Err(AppError::NotFound(_))
        ));
    }
}
