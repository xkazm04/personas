//! The commands Measure runs when a step's `params.commands` is `null`: read
//! from the repo's own manifests, never invented.
//!
//! - `package.json` scripts: `check` (Check), `lint` (Lint), the first of
//!   `typecheck` / `tsc` / `type-check` (Typecheck), `test` (Test), the first of
//!   `coverage` / `test:coverage` (Coverage), each run through the package
//!   manager whose lockfile is present (`pnpm-lock.yaml` -> pnpm, `yarn.lock`
//!   -> yarn, else npm).
//! - A `Cargo.toml` at the root, else under `src-tauri/`: `cargo clippy` (Lint)
//!   and `cargo test` (Test), with `--manifest-path` when it is not at the root.
//!
//! A command's `id` is the slug of its script name (or of `cargo clippy` /
//! `cargo test`), so history and dedup keys stay put when the runner changes.
//! Which step a command belongs to is decided by its kind ([`step_of`]).

use std::path::Path;

use crate::db::models::{LifecycleGateCommand, LifecycleGateKind};

use super::detect::MAX_READ_BYTES;

/// The step a command of `kind` is measured under: `gate` or `tests`.
pub fn step_of(kind: LifecycleGateKind) -> &'static str {
    match kind {
        LifecycleGateKind::Lint
        | LifecycleGateKind::Typecheck
        | LifecycleGateKind::Check
        | LifecycleGateKind::Other => "gate",
        LifecycleGateKind::Test | LifecycleGateKind::Coverage => "tests",
    }
}

/// The kinds measured under `step_id` (empty for any other step).
pub fn kinds_of(step_id: &str) -> &'static [LifecycleGateKind] {
    match step_id {
        "gate" => &[
            LifecycleGateKind::Lint,
            LifecycleGateKind::Typecheck,
            LifecycleGateKind::Check,
            LifecycleGateKind::Other,
        ],
        "tests" => &[LifecycleGateKind::Test, LifecycleGateKind::Coverage],
        _ => &[],
    }
}

/// Lowercase ASCII alphanumerics, every other run collapsed to one `-`.
pub fn slug(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// What the manifests say, read once. Separate from the reads so the mapping
/// is testable without a tree.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Manifests {
    /// Script names from `package.json`, in file order.
    pub scripts: Vec<String>,
    /// `npm` | `pnpm` | `yarn`.
    pub runner: &'static str,
    /// `Some("")` for a root `Cargo.toml`, `Some("src-tauri/Cargo.toml")` for a
    /// nested one, `None` without either.
    pub cargo_manifest: Option<&'static str>,
}

/// Read the manifests under `root`. A missing or unreadable file reads as
/// absent.
pub fn read_manifests(root: &Path) -> Manifests {
    let scripts = read_capped(&root.join("package.json"))
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| {
            v.get("scripts")
                .and_then(|s| s.as_object())
                .map(|o| o.keys().cloned().collect::<Vec<_>>())
        })
        .unwrap_or_default();
    let runner = if root.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if root.join("yarn.lock").is_file() {
        "yarn"
    } else {
        "npm"
    };
    let cargo_manifest = if root.join("Cargo.toml").is_file() {
        Some("")
    } else if root.join("src-tauri").join("Cargo.toml").is_file() {
        Some("src-tauri/Cargo.toml")
    } else {
        None
    };
    Manifests {
        scripts,
        runner,
        cargo_manifest,
    }
}

fn read_capped(path: &Path) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    file.take(MAX_READ_BYTES).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// The detected command list, gate kinds first then test kinds.
pub fn commands_from(m: &Manifests) -> Vec<LifecycleGateCommand> {
    const SCRIPT_KINDS: [(&[&str], LifecycleGateKind); 5] = [
        (&["check"], LifecycleGateKind::Check),
        (&["lint"], LifecycleGateKind::Lint),
        (
            &["typecheck", "tsc", "type-check"],
            LifecycleGateKind::Typecheck,
        ),
        (&["test"], LifecycleGateKind::Test),
        (&["coverage", "test:coverage"], LifecycleGateKind::Coverage),
    ];
    let mut out: Vec<LifecycleGateCommand> = Vec::new();
    for (names, kind) in SCRIPT_KINDS {
        if let Some(name) = names.iter().find(|n| m.scripts.iter().any(|s| s == *n)) {
            out.push(LifecycleGateCommand {
                id: slug(name),
                command: format!("{} run {name}", m.runner),
                kind,
                budget_ms: None,
            });
        }
    }
    if let Some(manifest) = m.cargo_manifest {
        let suffix = if manifest.is_empty() {
            String::new()
        } else {
            format!(" --manifest-path {manifest}")
        };
        for (verb, kind) in [
            ("clippy", LifecycleGateKind::Lint),
            ("test", LifecycleGateKind::Test),
        ] {
            let base = format!("cargo {verb}");
            out.push(LifecycleGateCommand {
                id: slug(&base),
                command: format!("{base}{suffix}"),
                kind,
                budget_ms: None,
            });
        }
    }
    out.sort_by_key(|c| step_of(c.kind) != "gate");
    out
}

/// [`read_manifests`] then [`commands_from`].
pub fn detect_commands(root: &Path) -> Vec<LifecycleGateCommand> {
    commands_from(&read_manifests(root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use LifecycleGateKind as K;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(p, body).expect("write");
    }

    fn ids(cmds: &[LifecycleGateCommand]) -> Vec<(&str, &str, K)> {
        cmds.iter()
            .map(|c| (c.id.as_str(), c.command.as_str(), c.kind))
            .collect()
    }

    #[test]
    fn npm_scripts_map_to_kinds_gate_first() {
        let dir = tempfile::tempdir().expect("tmp");
        write(
            dir.path(),
            "package.json",
            r#"{"scripts":{"test":"vitest","lint":"eslint .","tsc":"tsc","test:coverage":"vitest --coverage","dev":"vite"}}"#,
        );
        write(dir.path(), "package-lock.json", "{}");
        let got = detect_commands(dir.path());
        assert_eq!(
            ids(&got),
            vec![
                ("lint", "npm run lint", K::Lint),
                ("tsc", "npm run tsc", K::Typecheck),
                ("test", "npm run test", K::Test),
                ("test-coverage", "npm run test:coverage", K::Coverage),
            ]
        );
        assert!(got.iter().all(|c| c.budget_ms.is_none()));
    }

    #[test]
    fn a_pnpm_lockfile_picks_pnpm_and_typecheck_wins_over_tsc() {
        let dir = tempfile::tempdir().expect("tmp");
        write(
            dir.path(),
            "package.json",
            r#"{"scripts":{"check":"x","typecheck":"tsc","tsc":"tsc","coverage":"c"}}"#,
        );
        write(dir.path(), "pnpm-lock.yaml", "");
        assert_eq!(
            ids(&detect_commands(dir.path())),
            vec![
                ("check", "pnpm run check", K::Check),
                ("typecheck", "pnpm run typecheck", K::Typecheck),
                ("coverage", "pnpm run coverage", K::Coverage),
            ]
        );
    }

    #[test]
    fn a_yarn_lockfile_picks_yarn() {
        let m = Manifests {
            scripts: vec!["lint".into()],
            runner: "yarn",
            cargo_manifest: None,
        };
        assert_eq!(commands_from(&m)[0].command, "yarn run lint");
    }

    #[test]
    fn a_nested_cargo_manifest_gets_a_manifest_path() {
        let dir = tempfile::tempdir().expect("tmp");
        write(dir.path(), "src-tauri/Cargo.toml", "[package]\nname='x'\n");
        assert_eq!(
            ids(&detect_commands(dir.path())),
            vec![
                (
                    "cargo-clippy",
                    "cargo clippy --manifest-path src-tauri/Cargo.toml",
                    K::Lint
                ),
                (
                    "cargo-test",
                    "cargo test --manifest-path src-tauri/Cargo.toml",
                    K::Test
                ),
            ]
        );
    }

    #[test]
    fn a_root_cargo_manifest_runs_bare() {
        let dir = tempfile::tempdir().expect("tmp");
        write(dir.path(), "Cargo.toml", "[package]\nname='x'\n");
        let got = detect_commands(dir.path());
        assert_eq!(got[0].command, "cargo clippy");
        assert_eq!(got[1].command, "cargo test");
    }

    #[test]
    fn no_manifest_detects_nothing() {
        let dir = tempfile::tempdir().expect("tmp");
        assert!(detect_commands(dir.path()).is_empty());
        write(dir.path(), "package.json", "{not json");
        assert!(detect_commands(dir.path()).is_empty());
    }

    #[test]
    fn slugs_and_step_mapping() {
        assert_eq!(slug("test:coverage"), "test-coverage");
        assert_eq!(slug("  Cargo  Clippy "), "cargo-clippy");
        for k in [K::Lint, K::Typecheck, K::Check, K::Other] {
            assert_eq!(step_of(k), "gate");
            assert!(kinds_of("gate").contains(&k));
        }
        for k in [K::Test, K::Coverage] {
            assert_eq!(step_of(k), "tests");
            assert!(kinds_of("tests").contains(&k));
        }
        assert!(kinds_of("docs").is_empty());
    }
}
