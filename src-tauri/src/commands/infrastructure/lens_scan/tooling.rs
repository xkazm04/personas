//! Finding lens-scan and running its `store.mjs`, plus who signs a write.
//!
//! The store's transition rules have exactly one owner, lens-scan's own
//! scripts. Personas reads the store itself (`personas_db::repos::dev::lens_scan`)
//! and writes ONLY by running `store.mjs` here, as bp's `release.server.ts`
//! does: argv array only (never a shell string), a chosen environment, a 30 s
//! bound, and the store's exit code mapped to a typed error.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use personas_core::types::CliArgs;
use serde::de::DeserializeOwned;

use crate::commands::contest::node::manifest_registry_local;
use crate::db::models::LensScanIdentity;
use crate::db::repos::dev::lens_scan::{store_dir, store_file};
use crate::engine::cli_process::capture_output;
use crate::error::AppError;

/// One `store.mjs` call may take this long.
const STORE_TIMEOUT: Duration = Duration::from_secs(30);
/// `gh api user` may take this long.
const GH_TIMEOUT: Duration = Duration::from_secs(5);
/// After a failed `gh` lookup, writes sign as the fallback for this long
/// before `gh` is asked again.
const GH_RETRY_AFTER: Duration = Duration::from_secs(60);
/// Most ids one decide / triage / execute call may name.
pub(super) const MAX_IDS: usize = 200;
const MAX_NOTE_CHARS: usize = 4000;
/// Who signs a write when `gh` cannot say.
pub(super) const FALLBACK_BY: &str = "user:personas";

// ---------------------------------------------------------------------------
// Input validation (the doors accept nothing the argv could misread)
// ---------------------------------------------------------------------------

/// `[A-Za-z0-9._:-]+`, not starting with `-` (a leading dash would read as a flag).
pub(super) fn is_safe_token(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

/// 1..=200 ids, each a safe token.
pub(super) fn validate_ids(ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() || ids.len() > MAX_IDS {
        return Err(AppError::Validation(format!(
            "name 1 to {MAX_IDS} ids (got {})",
            ids.len()
        )));
    }
    if let Some(bad) = ids.iter().find(|id| !is_safe_token(id)) {
        return Err(AppError::Validation(format!(
            "id {bad:?} must match [A-Za-z0-9._:-]+ and not start with '-'"
        )));
    }
    Ok(())
}

/// A blank note is no note; one that store.mjs's flag parser would read as a
/// flag (`--...`) or that is absurdly long is refused.
pub(super) fn clean_note(note: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(note) = note.map(str::trim).filter(|n| !n.is_empty()) else {
        return Ok(None);
    };
    if note.starts_with("--") {
        return Err(AppError::Validation(
            "a note must not start with '--'".into(),
        ));
    }
    if note.chars().count() > MAX_NOTE_CHARS || note.contains('\0') {
        return Err(AppError::Validation(format!(
            "a note is at most {MAX_NOTE_CHARS} characters"
        )));
    }
    Ok(Some(note.to_string()))
}

// ---------------------------------------------------------------------------
// Where lens-scan lives
// ---------------------------------------------------------------------------

/// lens-scan's `scripts/` directory (it holds `store.mjs` and `drive.mjs`).
#[derive(Debug, Clone)]
pub(super) struct LensScanScripts {
    dir: PathBuf,
}

impl LensScanScripts {
    pub(super) fn store(&self) -> PathBuf {
        self.dir.join("store.mjs")
    }
    pub(super) fn drive(&self) -> PathBuf {
        self.dir.join("drive.mjs")
    }
}

/// A canonical path without the Windows `\\?\` verbatim prefix (node and the
/// dock console both read the plain form).
pub(super) fn plain(path: &Path) -> PathBuf {
    let canon = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = canon.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => canon,
    }
}

fn scripts_in(dir: PathBuf) -> Option<LensScanScripts> {
    dir.join("store.mjs")
        .is_file()
        .then(|| LensScanScripts { dir: plain(&dir) })
}

/// The ladder, inputs injected so it is testable: `$AI_REGISTRY_DIR`, then the
/// product's `.ai/manifest.yaml` `registry.local` (relative to the product
/// root; precedent `contest/node.rs`), then `~/.claude/skills/lens-scan`
/// through realpath (bp's order).
pub(super) fn locate_scripts_from(
    root: &Path,
    env_registry: Option<PathBuf>,
    home: Option<PathBuf>,
) -> Option<LensScanScripts> {
    let under =
        |registry: PathBuf| scripts_in(registry.join("skills").join("lens-scan").join("scripts"));
    if let Some(found) = env_registry.and_then(under) {
        return Some(found);
    }
    if let Ok(yaml) = std::fs::read_to_string(root.join(".ai").join("manifest.yaml")) {
        if let Some(local) = manifest_registry_local(&yaml) {
            let base = Path::new(&local);
            let registry = if base.is_absolute() {
                base.to_path_buf()
            } else {
                root.join(base)
            };
            if let Some(found) = under(registry) {
                return Some(found);
            }
        }
    }
    home.and_then(|h| {
        scripts_in(
            h.join(".claude")
                .join("skills")
                .join("lens-scan")
                .join("scripts"),
        )
    })
}

/// lens-scan for a product, or a `NotFound` that names what is missing.
pub(super) fn locate_scripts(root: &Path) -> Result<LensScanScripts, AppError> {
    let env_registry = std::env::var_os("AI_REGISTRY_DIR").map(PathBuf::from);
    locate_scripts_from(root, env_registry, dirs::home_dir()).ok_or_else(|| {
        AppError::NotFound(format!(
            "lens-scan not found: set registry.local in {}/.ai/manifest.yaml or install the skill at ~/.claude/skills/lens-scan",
            root.display()
        ))
    })
}

/// Fail early, by name, when node is not on PATH.
pub(super) async fn require_node() -> Result<(), AppError> {
    if crate::commands::contest::node::node_available().await {
        Ok(())
    } else {
        Err(AppError::ProcessSpawn(
            "node was not found on PATH (lens-scan's scripts run on node)".into(),
        ))
    }
}

// ---------------------------------------------------------------------------
// store.mjs
// ---------------------------------------------------------------------------

/// The argv tail of a decide / triage call.
pub(super) fn store_args(
    ids: &[String],
    decision: &str,
    by: &str,
    note: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--ids".to_string(),
        ids.join(","),
        "--decision".to_string(),
        decision.to_string(),
        "--by".to_string(),
        by.to_string(),
    ];
    if let Some(note) = note {
        args.push("--note".into());
        args.push(note.to_string());
    }
    args
}

/// stderr's last meaningful line, minus node's experimental-feature noise and
/// store.mjs's `store: ` prefix.
fn why(stderr: &str, code: Option<i32>) -> String {
    stderr
        .lines()
        .map(str::trim)
        .rfind(|l| {
            !l.is_empty() && !l.contains("ExperimentalWarning") && !l.contains("--trace-warnings")
        })
        .map(|l| l.strip_prefix("store: ").unwrap_or(l).to_string())
        .unwrap_or_else(|| match code {
            Some(c) => format!("exit {c}"),
            None => "no exit code".to_string(),
        })
}

/// What a finished `store.mjs <op>` means: exit 0 is its JSON; exit 2 is bad
/// input (`Validation`); exit 1 is a refusal, whose JSON (with `skipped[]`) is
/// the answer when it printed one; anything else is `Internal` naming the op.
pub(super) fn interpret_store<T: DeserializeOwned>(
    op: &str,
    code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> Result<T, AppError> {
    let parsed = || serde_json::from_str::<T>(stdout.trim());
    match code {
        Some(0) => parsed().map_err(|e| {
            AppError::Internal(format!("store.mjs {op}: answered no usable JSON: {e}"))
        }),
        Some(2) => Err(AppError::Validation(why(stderr, code))),
        Some(1) => parsed().map_err(|_| {
            AppError::Internal(format!("store.mjs {op}: refused: {}", why(stderr, code)))
        }),
        _ => Err(AppError::Internal(format!(
            "store.mjs {op}: {}",
            why(stderr, code)
        ))),
    }
}

/// `node --no-warnings store.mjs --db <store> <op> <args>` in the store
/// directory, with a chosen environment and a 30 s bound.
pub(super) async fn run_store<T: DeserializeOwned>(
    scripts: &LensScanScripts,
    root: &Path,
    op: &'static str,
    args: &[String],
) -> Result<T, AppError> {
    let mut argv = vec![
        "--no-warnings".to_string(),
        scripts.store().to_string_lossy().into_owned(),
        "--db".to_string(),
        store_file(root).to_string_lossy().into_owned(),
        op.to_string(),
    ];
    argv.extend(args.iter().cloned());
    let cli = CliArgs {
        command: "node".to_string(),
        args: argv,
        env_overrides: Vec::new(),
        env_removals: Vec::new(),
        cwd: Some(store_dir(root)),
    };
    let out = capture_output(&cli, STORE_TIMEOUT).await.map_err(|e| {
        if e.contains("did not answer within") {
            AppError::Internal(format!("store.mjs {op}: {e}"))
        } else {
            AppError::ProcessSpawn(format!("node: {e}"))
        }
    })?;
    interpret_store(op, out.status.code(), &out.stdout, &out.stderr)
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/// A GitHub login: 1-39 of `[A-Za-z0-9-]`, not starting with `-`.
pub(super) fn is_github_login(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 39
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// What the next identity lookup should do.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum IdentityStep {
    /// A login was resolved earlier in this process.
    Cached(String),
    /// A recent lookup failed: sign as the fallback without asking again yet.
    Fallback,
    /// Ask `gh`.
    Probe,
}

/// The identity cache. It remembers a SUCCESS for the life of the process and
/// a failure only as a timestamp, so a transient `gh` outage is retried (at
/// most once a minute) instead of frozen into a `OnceLock`.
#[derive(Default)]
pub(super) struct IdentityCache {
    login: Option<String>,
    failed_at: Option<Instant>,
}

impl IdentityCache {
    pub(super) fn step(&self, now: Instant) -> IdentityStep {
        if let Some(login) = &self.login {
            return IdentityStep::Cached(login.clone());
        }
        match self.failed_at {
            Some(at) if now.duration_since(at) < GH_RETRY_AFTER => IdentityStep::Fallback,
            _ => IdentityStep::Probe,
        }
    }
    pub(super) fn record(&mut self, found: Option<String>, now: Instant) {
        match found {
            Some(login) => {
                self.login = Some(login);
                self.failed_at = None;
            }
            None => self.failed_at = Some(now),
        }
    }
}

static IDENTITY: Mutex<Option<IdentityCache>> = Mutex::new(None);

fn gh_identity(login: &str) -> LensScanIdentity {
    LensScanIdentity {
        by: format!("user:{login}"),
        source: "gh".into(),
    }
}

fn fallback_identity() -> LensScanIdentity {
    LensScanIdentity {
        by: FALLBACK_BY.into(),
        source: "fallback".into(),
    }
}

/// `gh api user --jq .login`, with the few variables `gh` itself reads for its
/// login (`GH_TOKEN`, `GITHUB_TOKEN`, `GH_HOST`) passed on explicitly.
async fn ask_gh() -> Option<String> {
    let cli = CliArgs {
        command: "gh".to_string(),
        args: vec!["api".into(), "user".into(), "--jq".into(), ".login".into()],
        env_overrides: ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST"]
            .iter()
            .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
            .collect(),
        env_removals: Vec::new(),
        cwd: None,
    };
    let out = capture_output(&cli, GH_TIMEOUT).await.ok()?;
    let login = out.stdout.trim();
    (out.status.success() && is_github_login(login)).then(|| login.to_string())
}

/// Who signs a write: `user:<gh login>`, else `user:personas`. The lock is
/// never held across the `gh` call.
pub(super) async fn resolve_identity() -> LensScanIdentity {
    let step = {
        let guard = IDENTITY.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .as_ref()
            .map_or(IdentityStep::Probe, |c| c.step(Instant::now()))
    };
    match step {
        IdentityStep::Cached(login) => gh_identity(&login),
        IdentityStep::Fallback => fallback_identity(),
        IdentityStep::Probe => {
            let found = ask_gh().await;
            let mut guard = IDENTITY.lock().unwrap_or_else(|e| e.into_inner());
            guard
                .get_or_insert_with(IdentityCache::default)
                .record(found.clone(), Instant::now());
            found.map_or_else(fallback_identity, |l| gh_identity(&l))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{LensScanDecideResult, LensScanTriageResult};

    fn strings(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn ids_are_bounded_and_token_shaped() {
        assert!(validate_ids(&strings(&["a1", "k-des-3", "x.y:z_1"])).is_ok());
        assert!(validate_ids(&[]).is_err());
        let many: Vec<String> = (0..201).map(|i| format!("p{i}")).collect();
        assert!(validate_ids(&many).is_err());
        let max: Vec<String> = (0..200).map(|i| format!("p{i}")).collect();
        assert!(validate_ids(&max).is_ok());
        for bad in [
            "", "a b", "a,b", "-x", "--db", "a;b", "a\nb", "é", "a/b", "a\\b",
        ] {
            assert!(
                matches!(validate_ids(&strings(&[bad])), Err(AppError::Validation(_))),
                "{bad:?} must be refused"
            );
        }
    }

    #[test]
    fn notes_are_trimmed_and_flag_shaped_notes_refused() {
        assert_eq!(clean_note(None).unwrap(), None);
        assert_eq!(clean_note(Some("   ")).unwrap(), None);
        assert_eq!(clean_note(Some(" keep ")).unwrap(), Some("keep".into()));
        assert!(clean_note(Some("--db /x")).is_err());
        assert!(clean_note(Some(&"x".repeat(4001))).is_err());
        assert_eq!(
            clean_note(Some("-1 is fine")).unwrap(),
            Some("-1 is fine".into())
        );
    }

    #[test]
    fn store_argv_is_an_array_with_the_note_last() {
        let a = store_args(&strings(&["a", "b"]), "accept", "user:me", Some("why"));
        assert_eq!(
            a,
            [
                "--ids",
                "a,b",
                "--decision",
                "accept",
                "--by",
                "user:me",
                "--note",
                "why"
            ]
        );
        let a = store_args(&strings(&["a"]), "approve", "user:me", None);
        assert_eq!(a.len(), 6);
    }

    #[test]
    fn exit_codes_map_to_typed_errors_and_refusals_keep_their_json() {
        let ok = r#"{"decision":"approved","by":"user:me","decided":["a"],"skipped":[{"id":"b","status":"not-found"}]}"#;
        let r: LensScanDecideResult = interpret_store("decide", Some(0), ok, "").unwrap();
        assert_eq!(r.decided, ["a"]);
        assert_eq!(r.skipped[0].status, "not-found");

        let bad = interpret_store::<LensScanDecideResult>(
            "decide",
            Some(2),
            "",
            "(node:1) ExperimentalWarning: SQLite is an experimental feature\nstore: unknown decision \"x\"\n",
        );
        assert!(matches!(bad, Err(AppError::Validation(m)) if m == "unknown decision \"x\""));

        // exit 1 with the store's JSON: the answer, skipped reasons intact
        let refused = r#"{"decision":"reopened","by":"user:me","triaged":[],"skipped":[{"id":"p","status":"proposed","reason":"no-prior-status"}],"packs_triaged":[]}"#;
        let r: LensScanTriageResult = interpret_store("triage", Some(1), refused, "").unwrap();
        assert_eq!(r.skipped[0].reason.as_deref(), Some("no-prior-status"));
        assert!(r.packs_reopened.is_none());

        // exit 1 without JSON: Internal, naming the operation
        let e = interpret_store::<LensScanTriageResult>("triage", Some(1), "", "store: boom")
            .unwrap_err();
        assert!(
            matches!(&e, AppError::Internal(m) if m.contains("store.mjs triage") && m.contains("boom"))
        );
        // other exits and a missing code
        assert!(matches!(
            interpret_store::<LensScanTriageResult>("triage", Some(9), "", ""),
            Err(AppError::Internal(m)) if m.contains("exit 9")
        ));
        assert!(interpret_store::<LensScanTriageResult>("triage", None, "", "").is_err());
        // exit 0 with garbage
        assert!(
            interpret_store::<LensScanTriageResult>("triage", Some(0), "not json", "").is_err()
        );
    }

    #[test]
    fn identity_caches_success_but_never_freezes_a_failure() {
        let t0 = Instant::now();
        let mut c = IdentityCache::default();
        assert_eq!(c.step(t0), IdentityStep::Probe);
        c.record(None, t0);
        assert_eq!(c.step(t0 + Duration::from_secs(30)), IdentityStep::Fallback);
        assert_eq!(
            c.step(t0 + Duration::from_secs(61)),
            IdentityStep::Probe,
            "a failure is retried after a minute"
        );
        c.record(Some("octocat".into()), t0 + Duration::from_secs(61));
        assert_eq!(
            c.step(t0 + Duration::from_secs(5000)),
            IdentityStep::Cached("octocat".into())
        );
    }

    #[test]
    fn github_logins_are_shaped_strictly() {
        assert!(is_github_login("xkazm04"));
        assert!(is_github_login("a-b-1"));
        for bad in ["", "-a", "a b", "a/b", "user:x", &"a".repeat(40)] {
            assert!(!is_github_login(bad), "{bad:?}");
        }
    }

    #[test]
    fn locating_lens_scan_follows_env_then_manifest_then_home() {
        let tmp = std::env::temp_dir().join(format!("ls_locate_{}", uuid::Uuid::new_v4()));
        let make = |registry: &Path| {
            let d = registry.join("skills/lens-scan/scripts");
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("store.mjs"), "").unwrap();
        };
        let env_reg = tmp.join("env-registry");
        let man_reg = tmp.join("man-registry");
        let root = tmp.join("product");
        let home = tmp.join("home");
        std::fs::create_dir_all(root.join(".ai")).unwrap();
        std::fs::write(
            root.join(".ai/manifest.yaml"),
            "registry:\n  local: ../man-registry\n",
        )
        .unwrap();
        let home_skill = home.join(".claude/skills/lens-scan/scripts");
        std::fs::create_dir_all(&home_skill).unwrap();
        std::fs::write(home_skill.join("store.mjs"), "").unwrap();

        // nothing registered: home wins
        let got = locate_scripts_from(&root, None, Some(home.clone())).unwrap();
        assert!(got.store().ends_with("store.mjs"));
        assert!(got.dir.to_string_lossy().contains(".claude"));
        // the manifest's registry is missing the skill: still home
        std::fs::create_dir_all(&man_reg).unwrap();
        let got = locate_scripts_from(&root, None, Some(home.clone())).unwrap();
        assert!(got.dir.to_string_lossy().contains(".claude"));
        // manifest registry (relative to the root) beats home
        make(&man_reg);
        let got = locate_scripts_from(&root, None, Some(home.clone())).unwrap();
        assert!(got.dir.to_string_lossy().contains("man-registry"));
        // env beats the manifest
        make(&env_reg);
        let got = locate_scripts_from(&root, Some(env_reg.clone()), Some(home)).unwrap();
        assert!(got.dir.to_string_lossy().contains("env-registry"));
        // nowhere: None
        assert!(locate_scripts_from(&tmp.join("elsewhere"), None, None).is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
