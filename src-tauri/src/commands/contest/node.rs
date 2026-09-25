//! Running the instrument: `node <script> <args>` in the contest's project
//! root, and the lookups that find node, the instrument and the vault.
//!
//! The spawn itself goes through the `cli_process` chokepoint
//! ([`capture_output`]): argv as an array, a chosen (not inherited) env,
//! `CREATE_NO_WINDOW`, both pipes drained concurrently, the whole run bounded
//! by a timeout with an explicit kill + reap. Modelled on `webbuild::bun::run`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use personas_core::types::CliArgs;

use crate::db::repos::core::settings as settings_repo;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::cli_process::capture_output;
use crate::error::AppError;

/// init / plan / collect / aggregate / verdict / refine.
pub const STEP_TIMEOUT: Duration = Duration::from_secs(120);
/// visual-pass.mjs (a headless browser over every variant, two viewports).
pub const VISUAL_TIMEOUT: Duration = Duration::from_secs(600);

/// What a finished node run left behind.
#[derive(Debug, Clone)]
pub struct NodeOutput {
    pub status: Option<i32>,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

impl NodeOutput {
    /// The reason a failed step shows, from stderr (else stdout): the first
    /// error line (`Error: …` from an uncaught throw, `contest: …` from the
    /// instrument's `die`) plus the line after it (the throw site); else the
    /// last lines. An uncaught throw prints the message first and then stack
    /// frames and `Node.js vX`, so a plain tail is all frames.
    pub fn tail(&self) -> String {
        let src = if self.stderr.trim().is_empty() {
            &self.stdout
        } else {
            &self.stderr
        };
        let lines: Vec<&str> = src.lines().filter(|l| !l.trim().is_empty()).collect();
        match lines.iter().position(|l| is_error_line(l)) {
            Some(i) => {
                let end = (i + 2).min(lines.len());
                tail_lines(&lines[i..end].join("\n"), 2, 600)
            }
            None => tail_lines(src, 6, 600),
        }
    }
}

/// `^(\w*Error\b|contest:)`: a JS error's message line, or the instrument's `die`.
fn is_error_line(line: &str) -> bool {
    if line.starts_with("contest:") {
        return true;
    }
    // The leading word run; it ends at a non-word char, which is the `\b`.
    let word: String = line
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    word.ends_with("Error")
}

pub fn tail_lines(text: &str, lines: usize, max_chars: usize) -> String {
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = all.len().saturating_sub(lines);
    let joined = all[start..].join("\n");
    if joined.chars().count() <= max_chars {
        return joined;
    }
    let skip = joined.chars().count() - max_chars;
    joined.chars().skip(skip).collect()
}

/// The node binary name the runner spawns. `tokio::process::Command` resolves
/// it on PATH (and adds `.exe` on Windows), exactly like `node` in a shell.
const NODE: &str = "node";

/// Is `node` on PATH? The probe idiom `system/health.rs` uses (via
/// `binary_probe`), run off the async runtime because it blocks.
pub async fn node_available() -> bool {
    let probe = tokio::task::spawn_blocking(|| {
        crate::commands::infrastructure::system::binary_probe::command_exists_in_path(NODE)
    });
    match probe.await {
        Ok(found) => found,
        Err(e) => {
            // A panicked probe is reported, not read as "node missing" silently.
            if e.is_panic() {
                tracing::error!("contest: the node probe panicked");
            }
            false
        }
    }
}

/// Variables the instrument may need beyond the chokepoint's inherited set.
const PASSTHROUGH_ENV: &[&str] = &["PLAYWRIGHT_BROWSERS_PATH", "NODE_PATH"];

/// Run `node <script> <args…>` in `cwd`, bounded by `timeout`. A non-zero exit
/// is an outcome (`success == false`), not an error; spawn failure and timeout
/// are errors.
pub async fn run_node_script(
    script: &Path,
    args: &[String],
    cwd: &Path,
    timeout: Duration,
) -> Result<NodeOutput, AppError> {
    let mut argv = vec![script.to_string_lossy().into_owned()];
    argv.extend(args.iter().cloned());
    let cli_args = CliArgs {
        command: NODE.to_string(),
        args: argv,
        env_overrides: PASSTHROUGH_ENV
            .iter()
            .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
            .collect(),
        env_removals: Vec::new(),
        cwd: Some(cwd.to_path_buf()),
    };
    let out = capture_output(&cli_args, timeout)
        .await
        .map_err(|e| AppError::Internal(format!("node {}: {e}", script.display())))?;
    Ok(NodeOutput {
        status: out.status.code(),
        success: out.status.success(),
        stdout: out.stdout,
        stderr: out.stderr,
    })
}

/// Run a script and turn a non-zero exit into an error carrying its tail.
pub async fn run_node_checked(
    script: &Path,
    args: &[String],
    cwd: &Path,
    timeout: Duration,
) -> Result<NodeOutput, AppError> {
    let out = run_node_script(script, args, cwd, timeout).await?;
    if !out.success {
        let step = args.first().map(String::as_str).unwrap_or("script");
        return Err(AppError::Internal(format!(
            "contest {step} failed (exit {}): {}",
            out.status
                .map(|c| c.to_string())
                .unwrap_or_else(|| "?".into()),
            out.tail()
        )));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

const INSTRUMENT_REL: [&str; 4] = ["skills", "contest", "scripts", "contest.mjs"];

/// `registry.local` out of a `.ai/manifest.yaml` text: the `local:` key of the
/// top-level `registry:` block. A deliberately small reader — the manifest's
/// own contract says unknown fields must be ignored, and this reads one key.
pub fn manifest_registry_local(yaml: &str) -> Option<String> {
    let mut in_registry = false;
    for line in yaml.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim_start().starts_with('#') || trimmed.trim().is_empty() {
            continue;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if !indented {
            in_registry = trimmed.trim() == "registry:";
            continue;
        }
        if in_registry {
            if let Some(v) = trimmed.trim().strip_prefix("local:") {
                let v = v.split(" #").next().unwrap_or(v).trim();
                let v = v.trim_matches(|c| c == '"' || c == '\'');
                return (!v.is_empty()).then(|| v.to_string());
            }
        }
    }
    None
}

/// The resolution ladder, inputs injected so it is testable:
/// `$AI_REGISTRY_DIR` → the project's `.ai/manifest.yaml` `registry.local`
/// (relative to the project root) → the `contest.instrument_path` setting.
/// Each candidate must exist as a file.
pub fn resolve_instrument_from(
    project_root: &Path,
    env_registry: Option<PathBuf>,
    setting: Option<String>,
) -> Option<PathBuf> {
    let under = |registry: PathBuf| {
        let mut p = registry;
        for seg in INSTRUMENT_REL {
            p.push(seg);
        }
        p
    };
    if let Some(dir) = env_registry {
        let p = under(dir);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(yaml) = std::fs::read_to_string(project_root.join(".ai").join("manifest.yaml")) {
        if let Some(local) = manifest_registry_local(&yaml) {
            let base = Path::new(&local);
            let dir = if base.is_absolute() {
                base.to_path_buf()
            } else {
                project_root.join(base)
            };
            let p = under(dir);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    setting
        .map(|s| PathBuf::from(s.trim()))
        .filter(|p| p.is_file())
}

/// The instrument for a project, or `None` (the environment probe names it).
pub fn resolve_instrument(db: &DbPool, project_root: &Path) -> Option<PathBuf> {
    let setting = settings_repo::get(db, settings_keys::CONTEST_INSTRUMENT_PATH)
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty());
    resolve_instrument_from(
        project_root,
        std::env::var_os("AI_REGISTRY_DIR").map(PathBuf::from),
        setting,
    )
}

pub fn require_instrument(db: &DbPool, project_root: &Path) -> Result<PathBuf, AppError> {
    resolve_instrument(db, project_root).ok_or_else(|| {
        AppError::Validation(
            "the contest instrument (contest.mjs) was not found: set registry.local in the \
             project's .ai/manifest.yaml, $AI_REGISTRY_DIR, or the contest.instrument_path setting"
                .into(),
        )
    })
}

/// `visual-pass.mjs`, beside the instrument.
pub fn visual_pass_script(instrument: &Path) -> PathBuf {
    instrument.with_file_name("visual-pass.mjs")
}

/// Playwright resolvable from the project (`<root>/node_modules/playwright`).
pub fn playwright_available(project_root: &Path) -> bool {
    project_root
        .join("node_modules")
        .join("playwright")
        .join("package.json")
        .is_file()
}

// ---------------------------------------------------------------------------
// The vault
// ---------------------------------------------------------------------------

/// The vault candidates of `.claude/contest/config.md` front matter
/// (`vault: ["a", "b"]` or `vault: a`), and its `vault_subdir`.
pub fn config_vault(text: &str) -> (Vec<String>, Option<String>) {
    let text = text.replace("\r\n", "\n");
    let Some(rest) = text.strip_prefix("---\n") else {
        return (Vec::new(), None);
    };
    let front = rest.split("\n---").next().unwrap_or("");
    let mut vaults = Vec::new();
    let mut subdir = None;
    for line in front.lines() {
        if let Some(v) = line.strip_prefix("vault:") {
            let v = v.trim();
            if let Some(inner) = v.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
                vaults.extend(
                    inner
                        .split(',')
                        .map(|s| s.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
                        .filter(|s| !s.is_empty()),
                );
            } else {
                let v = v.trim_matches(|c| c == '"' || c == '\'');
                if !v.is_empty() {
                    vaults.push(v.to_string());
                }
            }
        } else if let Some(v) = line.strip_prefix("vault_subdir:") {
            let v = v.trim().trim_matches(|c| c == '"' || c == '\'');
            if !v.is_empty() {
                subdir = Some(v.to_string());
            }
        }
    }
    (vaults, subdir)
}

/// The vault root `init --vault` gets: the first EXISTING candidate named in
/// the project's `.claude/contest/config.md`, else `<root>/.contest`.
pub fn resolve_vault(project_root: &Path) -> (PathBuf, String) {
    let (candidates, subdir) = std::fs::read_to_string(
        project_root
            .join(".claude")
            .join("contest")
            .join("config.md"),
    )
    .map(|t| config_vault(&t))
    .unwrap_or_default();
    let vault = candidates
        .iter()
        .map(|c| {
            let p = Path::new(c);
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                project_root.join(p)
            }
        })
        .find(|p| p.is_dir())
        .unwrap_or_else(|| project_root.join(".contest"));
    (vault, subdir.unwrap_or_else(|| "Contest".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_registry_local_from_the_manifest() {
        let yaml = "schema: ai-manifest\nrepo:\n  name: personas\n  local: nope\n# c\nregistry:\n  remote: github:x/y\n  local: ../ai-registry  # the checkout\nknowledge:\n  domains: [a]\n";
        assert_eq!(
            manifest_registry_local(yaml).as_deref(),
            Some("../ai-registry")
        );
        assert_eq!(manifest_registry_local("repo:\n  local: x\n"), None);
        assert_eq!(
            manifest_registry_local("registry:\n  local: \"C:/reg\"\n").as_deref(),
            Some("C:/reg")
        );
    }

    #[test]
    fn instrument_resolution_ladder() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        let registry = tmp.path().join("reg");
        let script = registry.join("skills/contest/scripts/contest.mjs");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(&script, "//").unwrap();
        std::fs::create_dir_all(project.join(".ai")).unwrap();

        // nothing configured
        assert_eq!(resolve_instrument_from(&project, None, None), None);
        // the manifest's registry.local, relative to the project root
        std::fs::write(
            project.join(".ai/manifest.yaml"),
            "registry:\n  local: ../reg\n",
        )
        .unwrap();
        let got = resolve_instrument_from(&project, None, None).unwrap();
        assert!(got.ends_with("skills/contest/scripts/contest.mjs"));
        // $AI_REGISTRY_DIR wins
        let other = tmp.path().join("other");
        let other_script = other.join("skills/contest/scripts/contest.mjs");
        std::fs::create_dir_all(other_script.parent().unwrap()).unwrap();
        std::fs::write(&other_script, "//").unwrap();
        assert_eq!(
            resolve_instrument_from(&project, Some(other.clone()), None),
            Some(other_script.clone())
        );
        // an env dir with no instrument falls through to the manifest
        assert!(resolve_instrument_from(&project, Some(tmp.path().join("x")), None).is_some());
        // the setting is the last rung
        std::fs::write(
            project.join(".ai/manifest.yaml"),
            "registry:\n  local: ../nope\n",
        )
        .unwrap();
        assert_eq!(
            resolve_instrument_from(
                &project,
                None,
                Some(other_script.to_string_lossy().into_owned())
            ),
            Some(other_script)
        );
        assert_eq!(
            resolve_instrument_from(&project, None, Some("Z:/no/such.mjs".into())),
            None
        );
    }

    #[test]
    fn vault_candidates_first_existing_wins_else_project_contest() {
        let (v, sub) =
            config_vault("---\nvault: [\"C:/a\", 'b']\nvault_subdir: Contest\n---\n# x\n");
        assert_eq!(v, vec!["C:/a".to_string(), "b".to_string()]);
        assert_eq!(sub.as_deref(), Some("Contest"));
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join(".claude/contest")).unwrap();
        std::fs::write(
            root.join(".claude/contest/config.md"),
            "---\nvault: [\"Z:/elsewhere/.contest\", \"vaultdir\"]\n---\n",
        )
        .unwrap();
        assert_eq!(resolve_vault(root).0, root.join(".contest"));
        std::fs::create_dir_all(root.join("vaultdir")).unwrap();
        assert_eq!(resolve_vault(root).0, root.join("vaultdir"));
    }

    /// Captured 2026-09-25: `contest.mjs init` with a repeated participant.
    const UNCAUGHT_THROW: &str = "file:///C:/reg/skills/contest/scripts/lib/participants.mjs:32
    if (seen.has(p.id)) throw new Error(`participant \"${spec}\" repeats \"${p.id}\" - add #label to run the same seat twice`);
                              ^

Error: participant \"claude:opus@high\" repeats \"claude-opus_high\" - add #label to run the same seat twice
    at parseParticipants (file:///C:/reg/skills/contest/scripts/lib/participants.mjs:32:31)
    at Object.init (file:///C:/reg/skills/contest/scripts/contest.mjs:168:24)
    at file:///C:/reg/skills/contest/scripts/contest.mjs:582:30
    at ModuleJob.run (node:internal/modules/esm/module_job:413:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:660:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.12.0
";

    #[test]
    fn a_failed_step_shows_the_error_line_not_the_stack() {
        let out = NodeOutput {
            status: Some(1),
            success: false,
            stdout: String::new(),
            stderr: UNCAUGHT_THROW.into(),
        };
        let tail = out.tail();
        assert!(
            tail.contains("repeats \"claude-opus_high\""),
            "the error line is missing: {tail}"
        );
        assert!(!tail.contains("Node.js v24"), "{tail}");
        // A die() message is one `contest:` line.
        let died = NodeOutput {
            stderr:
                "contest: C:/v/contests/x.md exists - pass --force to rewrite the contest note\n"
                    .into(),
            ..out.clone()
        };
        assert!(died.tail().starts_with("contest: "), "{}", died.tail());
        // No error line: the last lines, as before.
        let plain = NodeOutput {
            stderr: "a\nb\n".into(),
            ..out
        };
        assert_eq!(plain.tail(), "a\nb");
    }

    #[test]
    fn tail_keeps_the_last_nonblank_lines() {
        assert_eq!(tail_lines("a\n\nb\nc\n", 2, 100), "b\nc");
        assert_eq!(tail_lines("abcdef", 5, 3), "def");
    }
}

/// Drives the REAL instrument (init → plan → collect → status) against a temp
/// project, when node is on PATH and a registry checkout is found. Skips
/// (loudly) otherwise on a dev machine, and FAILS under `CI`, whose rust-tests
/// job clones the registry (ci.yml) — it must never pass vacuously.
#[cfg(test)]
mod instrument_tests {
    use super::*;
    use crate::commands::contest::arena::{self, ArenaPaths, ManifestFile};
    use crate::commands::contest::record::{self, RunEnd, SeatIdentity};

    fn find_instrument() -> Option<PathBuf> {
        if let Some(dir) = std::env::var_os("AI_REGISTRY_DIR") {
            let p = PathBuf::from(dir).join("skills/contest/scripts/contest.mjs");
            if p.is_file() {
                return Some(p);
            }
        }
        let mut dir = Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        while let Some(d) = dir {
            let p = d.join("ai-registry/skills/contest/scripts/contest.mjs");
            if p.is_file() {
                return Some(p);
            }
            dir = d.parent().map(Path::to_path_buf);
        }
        None
    }

    #[derive(serde::Deserialize)]
    struct Plan {
        timeout_min: f64,
        seats: Vec<PlanSeat>,
    }
    #[derive(serde::Deserialize)]
    struct PlanSeat {
        id: String,
        spec: String,
        engine: String,
        model: String,
        effort: String,
        cwd: String,
        log_dir: String,
        prompt: String,
    }

    /// A missing prerequisite (node, the registry checkout): a loud skip on a
    /// dev machine, a FAILURE under CI - where a skip would mean the only
    /// instrument-contract test never runs.
    fn missing_prerequisite(ci: bool, why: &str) -> Result<(), String> {
        if ci {
            return Err(format!(
                "{why} - under CI this contract test must run, not skip \
                 (clone the ai-registry and set AI_REGISTRY_DIR)"
            ));
        }
        eprintln!("skipping: {why}");
        Ok(())
    }

    #[test]
    fn a_missing_instrument_fails_under_ci_and_skips_elsewhere() {
        assert!(missing_prerequisite(true, "no registry").is_err());
        assert!(missing_prerequisite(false, "no registry").is_ok());
    }

    #[tokio::test]
    async fn init_plan_collect_status_against_the_real_instrument() {
        let ci = std::env::var_os("CI").is_some();
        if !node_available().await {
            missing_prerequisite(ci, "node is not on PATH").unwrap();
            return;
        }
        let Some(instrument) = find_instrument() else {
            missing_prerequisite(ci, "no ai-registry checkout with contest.mjs found").unwrap();
            return;
        };
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("proj");
        std::fs::create_dir_all(&root).unwrap();
        let brief = tmp.path().join("brief.md");
        std::fs::write(&brief, "## The idea\nA test.\n").unwrap();
        let arena_root = arena::arena_root(&root);
        let s = |x: &str| x.to_string();
        let init = vec![
            s("init"),
            s("--id"),
            s("wp2-test"),
            s("--title"),
            s("WP2 test"),
            s("--brief"),
            brief.to_string_lossy().into_owned(),
            s("--participants"),
            s("claude:opus@high,grok:grok-4.6@low#b"),
            s("--variants"),
            s("2"),
            s("--timeout-min"),
            s("7"),
            s("--arena"),
            arena_root.to_string_lossy().into_owned(),
            s("--vault"),
            root.join(".contest").to_string_lossy().into_owned(),
            s("--project"),
            s("proj"),
        ];
        run_node_checked(&instrument, &init, &root, STEP_TIMEOUT)
            .await
            .unwrap();
        let paths = ArenaPaths::new(&root, "wp2-test").unwrap();
        let c: arena::ContestFile = arena::read_json(&paths.contest_json()).unwrap();
        assert_eq!(c.participants.len(), 2);
        assert_eq!(c.variants, 2);

        let id_args = |step: &str| {
            vec![
                s(step),
                s("--id"),
                s("wp2-test"),
                s("--arena"),
                arena_root.to_string_lossy().into_owned(),
            ]
        };
        let mut plan_args = id_args("plan");
        plan_args.extend([s("--kind"), s("participants")]);
        let out = run_node_checked(&instrument, &plan_args, &root, STEP_TIMEOUT)
            .await
            .unwrap();
        let plan: Plan = serde_json::from_str(out.stdout.trim()).unwrap();
        assert_eq!(plan.timeout_min, 7.0);
        assert_eq!(plan.seats.len(), 2);
        let seat = &plan.seats[1];
        assert_eq!(seat.id, "grok-grok-4.6_low-b");
        assert_eq!(seat.spec, "grok:grok-4.6@low#b");
        assert_eq!(arena::parse_seat_spec(&seat.spec).unwrap().id, seat.id);
        assert!(Path::new(&seat.cwd).is_dir(), "the seat workspace exists");
        assert!(Path::new(&seat.log_dir).ends_with(format!("runs/{}", seat.id)));
        assert!(!seat.prompt.is_empty());

        // Our record.json in the skill's schema is what `status` / `collect` read.
        for seat in &plan.seats {
            let who = SeatIdentity {
                id: seat.id.clone(),
                spec: seat.spec.clone(),
                engine: seat.engine.clone(),
                model: seat.model.clone(),
                effort: seat.effort.clone(),
            };
            let end = RunEnd {
                finished_without_capture: true,
                wall_s: Some(1.5),
                ..RunEnd::default()
            };
            let (rec, _) = record::build_record(&who, &end, record::iso_now());
            arena::write_json(&paths.record_json(&seat.id), &rec).unwrap();
        }
        let status = run_node_checked(&instrument, &id_args("status"), &root, STEP_TIMEOUT)
            .await
            .unwrap();
        assert_eq!(
            status.stdout.matches("completed").count(),
            2,
            "{}",
            status.stdout
        );

        run_node_checked(&instrument, &id_args("collect"), &root, STEP_TIMEOUT)
            .await
            .unwrap();
        let m: ManifestFile = arena::read_json(&paths.manifest_json()).unwrap();
        assert_eq!(m.entries.len(), 2);
        assert!(m
            .entries
            .values()
            .all(|e| e.variants.len() == 2 && e.variants.iter().all(|v| !v.present)));
        let blind: std::collections::BTreeMap<String, String> =
            arena::read_json(&paths.blind_map_json()).unwrap();
        assert_eq!(blind.len(), 2);
    }
}
