//! The two read doors that touch the product repo itself: a screenshot out of
//! the store's `shots/` directory, and one item commit out of git.
//!
//! Both are ports of bp's routes (`shots/[...path]/route.ts`, `commits/[sha]/route.ts`
//! plus `release.server.ts commitDiff`) and keep their refusals: a path that
//! could leave `<store>/shots` is `Forbidden`, and a sha that no proposal of the
//! store carries is `Forbidden`, so neither door can be used to read an
//! arbitrary file or an arbitrary git object of the repo.

use std::path::{Path, PathBuf};

use crate::db::models::{LensScanCommitDiff, LensScanCommitFile};
use crate::db::repos::dev::lens_scan::{item_commits, match_item_commit, store_dir, CommitMatch};
use crate::engine::git_checkpoint::run_git_blocking;
use crate::error::AppError;

/// The most patch lines a commit diff carries (`lines` still counts them all).
const DIFF_LINES: usize = 2000;
/// The largest screenshot or recording the door will hand over.
const MAX_SHOT_BYTES: u64 = 64 * 1024 * 1024;
const SHOT_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "webm"];

fn forbidden() -> AppError {
    AppError::Forbidden("path outside the shots directory".into())
}

/// One segment of a shot path: no separators, drive colons, NUL, `.`, `..` or
/// empty parts, and not absolute.
fn safe_segment(seg: &str) -> bool {
    !seg.is_empty()
        && seg != "."
        && seg != ".."
        && !seg.contains(['\\', '/', ':', '\0'])
        && !Path::new(seg).is_absolute()
}

/// `base/segs...`, or `None` when the result would leave `base`.
fn within(base: &Path, segs: &[&str]) -> Option<PathBuf> {
    let mut full = base.to_path_buf();
    for seg in segs {
        full.push(seg);
    }
    let rel = full.strip_prefix(base).ok()?;
    (!rel.as_os_str().is_empty()
        && rel
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_))))
    .then_some(full)
}

/// The file a `shots` row's `path` names, checked twice: lexically
/// (`safe_segment`) and again after symlinks are resolved, so a link inside
/// `shots/` that points out is refused. `path` is relative to the store
/// directory (`shots/<run>/<feature>-<theme>-<size>.png`); the leading
/// `shots/` is optional.
pub(super) fn resolve_shot(root: &Path, path: &str) -> Result<PathBuf, AppError> {
    let segs: Vec<&str> = path.split('/').collect();
    if segs.iter().any(|s| !safe_segment(s)) {
        return Err(forbidden());
    }
    let shots = store_dir(root).join("shots");
    // A full Shot.path (`shots/...`) is tried as given, then without the leading `shots`.
    let mut tries: Vec<&[&str]> = vec![&segs];
    if segs[0] == "shots" && segs.len() > 1 {
        tries.push(&segs[1..]);
    }
    let mut file = None;
    for attempt in tries {
        let candidate = within(&shots, attempt).ok_or_else(forbidden)?;
        if candidate.exists() {
            file = Some(candidate);
            break;
        }
    }
    let file = file.ok_or_else(|| AppError::NotFound(format!("no such shot: {path}")))?;
    // Symlinks: the real file must still sit under the real shots directory.
    let real_shots = std::fs::canonicalize(&shots)
        .map_err(|_| AppError::NotFound("this product has no shots directory".into()))?;
    let real = std::fs::canonicalize(&file)
        .map_err(|_| AppError::NotFound(format!("no such shot: {path}")))?;
    if real == real_shots || !real.starts_with(&real_shots) {
        return Err(forbidden());
    }
    Ok(real)
}

/// The bytes of a screenshot or recording, after `resolve_shot`'s checks.
pub(super) fn read_shot(root: &Path, path: &str) -> Result<Vec<u8>, AppError> {
    let real = resolve_shot(root, path)?;
    let ext = real
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if !SHOT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::Validation("not an image or video".into()));
    }
    let meta = std::fs::metadata(&real)?;
    if !meta.is_file() {
        return Err(AppError::NotFound(format!("no such shot: {path}")));
    }
    if meta.len() > MAX_SHOT_BYTES {
        return Err(AppError::Validation(format!(
            "a shot is at most {} MB",
            MAX_SHOT_BYTES / (1024 * 1024)
        )));
    }
    Ok(std::fs::read(&real)?)
}

// ---------------------------------------------------------------------------
// Commit diff
// ---------------------------------------------------------------------------

fn is_hex_sha(s: &str) -> bool {
    (7..=40).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// One `git show` of `sha`, no pager, colour, external diff or textconv, paths
/// unquoted. Through the app's one git argv owner (hardening flags, working
/// directory, no console window).
fn git_show(root: &Path, sha: &str, tail: &[&str]) -> Result<String, AppError> {
    let mut args = vec![
        "-c",
        "core.quotepath=off",
        "--no-pager",
        "show",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
    ];
    args.extend_from_slice(tail);
    args.push(sha);
    run_git_blocking(root, &args).map_err(|e| {
        if e.contains("bad object") || e.contains("unknown revision") || e.contains("bad revision")
        {
            AppError::NotFound(format!("git has no commit {sha}"))
        } else {
            AppError::Internal(format!("git show: {e}"))
        }
    })
}

/// `<sha>\n<message>\0\n\n<stat>` -> (sha, message, stat).
fn split_head(head: &str) -> (String, String, String) {
    let cut = head.find('\0');
    let top = cut.map_or(head, |i| &head[..i]);
    let (full, message) = match top.split_once('\n') {
        Some((a, b)) => (a.trim(), b.trim_end()),
        None => (top.trim(), ""),
    };
    let stat = cut
        .map(|i| {
            head[i + 1..]
                .trim_start_matches(['\n', '\r', ' ', '\t'])
                .trim_end()
        })
        .unwrap_or("");
    (full.to_string(), message.to_string(), stat.to_string())
}

/// `<add>\t<del>\t<path>` lines; a binary file's `-` counts read 0.
fn parse_numstat(numstat: &str) -> Vec<LensScanCommitFile> {
    numstat
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let (add, del, path) = (parts.next()?, parts.next()?, parts.next()?);
            let count = |s: &str| match s {
                "-" => Some(0),
                n => n.parse::<u64>().ok(),
            };
            Some(LensScanCommitFile {
                path: path.to_string(),
                add: count(add)?,
                del: count(del)?,
            })
        })
        .collect()
}

/// The patch cut at `DIFF_LINES`, and the full line count.
fn cut_patch(patch: &str) -> (String, u64, bool) {
    let all = patch.trim_start_matches('\n').trim_end_matches('\n');
    if all.is_empty() {
        return (String::new(), 0, false);
    }
    let lines: Vec<&str> = all.split('\n').collect();
    let truncated = lines.len() > DIFF_LINES;
    let kept = if truncated {
        &lines[..DIFF_LINES]
    } else {
        &lines[..]
    };
    (kept.join("\n"), lines.len() as u64, truncated)
}

/// One item commit as the ledger's compare panel shows it. The sha must be one
/// a proposal of the store carries (`commit_sha` or `result_sha`, or a prefix
/// either way); anything else is `Forbidden`.
pub(super) fn commit_diff(root: &Path, sha: &str) -> Result<LensScanCommitDiff, AppError> {
    if !is_hex_sha(sha) {
        return Err(AppError::Validation(
            "sha must be 7-40 hex characters".into(),
        ));
    }
    let known = item_commits(root)?;
    let full = match match_item_commit(&known, sha) {
        CommitMatch::One(full) => full,
        CommitMatch::None => {
            return Err(AppError::Forbidden(format!(
                "{sha} is not an item commit of this product"
            )))
        }
        CommitMatch::Ambiguous(n) => {
            return Err(AppError::Validation(format!(
                "{sha} is ambiguous: {n} item commits start with it"
            )))
        }
    };
    let head = git_show(root, &full, &["--stat=200", "--format=%H%n%B%x00"])?;
    let numstat = git_show(root, &full, &["--numstat", "--format="])?;
    let patch = git_show(root, &full, &["--format=", "--unified=3"])?;
    let (sha, message, stat) = split_head(&head);
    let (patch, lines, truncated) = cut_patch(&patch);
    Ok(LensScanCommitDiff {
        sha,
        message,
        stat,
        files: parse_numstat(&numstat),
        patch,
        lines,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::dev::lens_scan::test_support::make_store;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let d = std::env::temp_dir().join(format!("ls_files_{tag}_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&d).unwrap();
            Self(d)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A product root with `shots/r1/a.png` and a secret OUTSIDE `shots/`.
    fn product() -> Scratch {
        let s = Scratch::new("shot");
        let shots = store_dir(&s.0).join("shots").join("r1");
        std::fs::create_dir_all(&shots).unwrap();
        std::fs::write(shots.join("a.png"), b"\x89PNG-bytes").unwrap();
        std::fs::write(shots.join("note.txt"), b"text").unwrap();
        std::fs::write(store_dir(&s.0).join("secret.png"), b"secret").unwrap();
        s
    }

    #[test]
    fn a_shot_is_read_with_or_without_the_shots_prefix() {
        let p = product();
        assert_eq!(read_shot(&p.0, "shots/r1/a.png").unwrap(), b"\x89PNG-bytes");
        assert_eq!(read_shot(&p.0, "r1/a.png").unwrap(), b"\x89PNG-bytes");
        assert!(matches!(
            read_shot(&p.0, "r1/missing.png"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            read_shot(&p.0, "r1/note.txt"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn paths_that_could_leave_the_shots_directory_are_forbidden() {
        let p = product();
        let abs = store_dir(&p.0)
            .join("secret.png")
            .to_string_lossy()
            .into_owned();
        for bad in [
            "..",
            "../secret.png",
            "shots/../secret.png",
            "r1/../../secret.png",
            "./r1/a.png",
            "r1/./a.png",
            ".",
            "",
            "/etc/passwd",
            "/r1/a.png",
            "r1//a.png",
            "r1/a.png/",
            "C:/Windows/win.ini",
            "C:\\Windows\\win.ini",
            "r1\\a.png",
            "r1/a\0.png",
            &abs,
        ] {
            assert!(
                matches!(read_shot(&p.0, bad), Err(AppError::Forbidden(_))),
                "{bad:?} must be Forbidden, got {:?}",
                read_shot(&p.0, bad).map(|b| b.len())
            );
        }
    }

    #[test]
    fn a_link_inside_shots_that_points_out_is_forbidden() {
        let p = product();
        let outside = Scratch::new("outside");
        std::fs::write(outside.0.join("leak.png"), b"leak").unwrap();
        let shots = store_dir(&p.0).join("shots");
        let link_dir = shots.join("linkdir");
        let link_file = shots.join("leak.png");
        let made_dir = make_dir_link(&outside.0, &link_dir);
        let made_file = make_file_link(&outside.0.join("leak.png"), &link_file);
        assert!(
            made_dir || made_file,
            "this machine allowed neither a symlink nor a junction: the symlink case is unproven"
        );
        if made_dir {
            assert!(matches!(
                read_shot(&p.0, "shots/linkdir/leak.png"),
                Err(AppError::Forbidden(_))
            ));
        }
        if made_file {
            assert!(matches!(
                read_shot(&p.0, "leak.png"),
                Err(AppError::Forbidden(_))
            ));
        }
    }

    #[cfg(unix)]
    fn make_dir_link(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(unix)]
    fn make_file_link(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    fn make_dir_link(target: &Path, link: &Path) -> bool {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return true;
        }
        // A junction needs no privilege; mklink is a cmd builtin. Through the
        // app's subprocess chokepoint, like every other child.
        let cli = personas_core::types::CliArgs {
            command: "cmd".to_string(),
            args: vec![
                "/C".into(),
                "mklink".into(),
                "/J".into(),
                link.to_string_lossy().into_owned(),
                target.to_string_lossy().into_owned(),
            ],
            env_overrides: Vec::new(),
            env_removals: Vec::new(),
            cwd: None,
        };
        tauri::async_runtime::block_on(crate::engine::cli_process::capture_output(
            &cli,
            std::time::Duration::from_secs(10),
        ))
        .map(|o| o.status.success())
        .unwrap_or(false)
    }
    #[cfg(windows)]
    fn make_file_link(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }

    #[test]
    fn commit_diff_parts_are_parsed_like_bp() {
        let (sha, msg, stat) =
            split_head("abc123\nsubject\n\nbody line\n\0\n\n a.txt | 2 +-\n 1 file changed\n");
        assert_eq!(sha, "abc123");
        assert_eq!(msg, "subject\n\nbody line");
        assert_eq!(stat, "a.txt | 2 +-\n 1 file changed");
        let files = parse_numstat("3\t1\tsrc/a b.ts\n-\t-\timg.png\n");
        assert_eq!(files.len(), 2);
        assert_eq!(
            (files[0].add, files[0].del, files[0].path.as_str()),
            (3, 1, "src/a b.ts")
        );
        assert_eq!((files[1].add, files[1].del), (0, 0));
        let big: String = (0..2500).map(|i| format!("l{i}\n")).collect();
        let (patch, lines, truncated) = cut_patch(&format!("\n{big}"));
        assert_eq!((lines, truncated), (2500, true));
        assert_eq!(patch.lines().count(), 2000);
        assert_eq!(cut_patch(""), (String::new(), 0, false));
        assert!(is_hex_sha("abcdef1") && !is_hex_sha("abcdef") && !is_hex_sha("zzzzzzz"));
        assert!(!is_hex_sha(&"a".repeat(41)));
    }

    /// A product with a real git repo whose one commit is carried by a proposal.
    fn product_with_commit() -> (Scratch, String) {
        let s = Scratch::new("git");
        run_git_blocking(&s.0, &["init", "-q"]).unwrap();
        std::fs::write(
            s.0.join("a.txt"),
            "one
two
",
        )
        .unwrap();
        run_git_blocking(&s.0, &["add", "a.txt"]).unwrap();
        run_git_blocking(
            &s.0,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t.invalid",
                "commit",
                "-q",
                "-m",
                "item commit",
                "-m",
                "body text",
            ],
        )
        .unwrap();
        let sha = run_git_blocking(&s.0, &["rev-parse", "HEAD"]).unwrap();
        // The store: a throwaway v3 file whose one proposal carries the commit.
        let conn = make_store(&s.0, 3);
        conn.execute(
            "INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at, commit_sha)              VALUES ('p1', 'r1', 'f', 'dev', 't', 'fix', 'done', 'x', 'x', ?1)",
            rusqlite::params![sha],
        )
        .unwrap();
        (s, sha)
    }

    #[test]
    fn an_item_commit_is_shown_and_any_other_sha_is_forbidden() {
        let (p, sha) = product_with_commit();
        let d = commit_diff(&p.0, &sha[..10]).unwrap();
        assert_eq!(d.sha, sha);
        assert!(d.message.starts_with("item commit") && d.message.contains("body text"));
        assert!(d.stat.contains("a.txt"));
        assert_eq!(d.files.len(), 1);
        assert_eq!(
            (d.files[0].path.as_str(), d.files[0].add, d.files[0].del),
            ("a.txt", 2, 0)
        );
        assert!(d.patch.contains("+one") && !d.truncated && d.lines > 0);

        // a sha git has but no proposal carries: refused before git is asked
        let other = "0123456789abcdef0123456789abcdef01234567";
        assert!(matches!(
            commit_diff(&p.0, other),
            Err(AppError::Forbidden(_))
        ));
        // not hex / too short
        assert!(matches!(
            commit_diff(&p.0, "HEAD"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            commit_diff(&p.0, "abc"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            commit_diff(&p.0, "--output=x"),
            Err(AppError::Validation(_))
        ));
    }
}
