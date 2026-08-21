//! Unified connector-readiness resolver.
//!
//! The single source of truth for "is connector X ready for persona P?".
//! Replaces the two byte-identical `BUILTIN_LOCAL_CONNECTORS` allowlists and
//! the divergent `vault_missing_connectors` (promote) / `check_persona_
//! runnability` (adopt) logic — which used to disagree, so a persona could
//! pass adoption and then fail promote.
//!
//! Dispatch is driven by `ConnectorClass` (see `db::models::connector`):
//! - `ZeroConfig` → always ready.
//! - `Credential` → uniquely bindable to one concrete vault credential (exact
//!   service_type, else a category match). An ambiguous or absent match is
//!   NeedsSetup — EXCEPT for the connectors in `CLI_PROBE_CONNECTORS`, which
//!   fall back to "is the provider CLI on this machine authenticated?" (see
//!   below).
//! - `GlobalProbe` → a connector-specific probe against a backing local entity:
//!   a Dev Tools project (`codebase`), a Twin profile (`twin`), an Obsidian
//!   vault (`obsidian_memory`). Resolved globally — no per-persona binding.
//!
//! ## The CLI-auth fallback (Credential class only)
//!
//! Hosting / VCS providers (Vercel, Netlify, Cloudflare, Fly.io, Railway,
//! GitHub) are normally authed by running the vendor's own CLI once. Demanding
//! a second, hand-copied API token in the Vault before the connector counts as
//! ready is friction users refuse — so they skip the connector entirely. For
//! the connectors listed in `CLI_PROBE_CONNECTORS` the resolver therefore tries
//! a second path, strictly ordered:
//!
//! 1. A uniquely bound, usable Vault credential → `Ready`. This ALWAYS wins:
//!    it is the only mode that survives leaving this machine (CI, another
//!    device, a headless run).
//! 2. No credential resolves → probe the provider CLI (cached, ~5 min TTL):
//!    - exit 0 (authenticated) → `Ready`
//!    - binary present, probe fails → `NeedsSetup { CliLogin }` — the user runs
//!      e.g. `vercel login`, not a Vault round-trip
//!    - binary absent → `NeedsSetup { VaultCredential }` (unchanged
//!      pre-existing behavior)
//!
//! Readiness is recomputed often (every adopt, promote, credential mutation
//! and run gate), so the probe MUST NOT spawn a process per call — it is
//! memoised in a process-wide TTL cache and each probe carries a hard timeout.
//!
//! Full rationale: `docs/architecture/connector-classification.md`.

use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{
    classify_connector, cli_probe_spec, CliProbeSpec, ConnectorClass, CLI_PROBE_CONNECTORS,
};
use crate::db::DbPool;
use crate::error::AppError;

/// What kind of setup a not-ready connector needs — drives the remediation
/// the UI routes the user to (which is NOT always "Settings → Vault").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SetupKind {
    /// An API credential configured in Settings → Vault.
    VaultCredential,
    /// The provider's own CLI is installed on this machine but not
    /// authenticated — the fix is one interactive `<tool> login`, NOT a Vault
    /// round-trip. Only produced for `CLI_PROBE_CONNECTORS` connectors that
    /// have no bound credential. See the module header.
    CliLogin,
    /// A Dev Tools project registered (and, later, bound to the persona).
    DevProject,
    /// The Obsidian Brain vault configured.
    ObsidianVault,
    /// A Twin profile created in the Twin plugin.
    TwinProfile,
    /// The connector declaration is invalid or unrecognized — a blank/corrupted
    /// connector name, or a `GLOBAL_PROBE_CONNECTORS` entry whose probe arm was
    /// never wired in `connector_readiness`. No normal user-facing setup fixes
    /// it; it is the fail-closed sentinel that keeps a broken declaration from
    /// silently promoting a persona as ready.
    Misconfigured,
}

impl SetupKind {
    /// Short machine token for logs / UI routing. Matches the serde
    /// `snake_case` representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            SetupKind::VaultCredential => "vault_credential",
            SetupKind::CliLogin => "cli_login",
            SetupKind::DevProject => "dev_project",
            SetupKind::ObsidianVault => "obsidian_vault",
            SetupKind::TwinProfile => "twin_profile",
            SetupKind::Misconfigured => "misconfigured",
        }
    }

    /// One-line remediation hint — what the user does, and where.
    pub fn remediation(&self) -> &'static str {
        match self {
            SetupKind::VaultCredential => "add the credential in Settings → Vault",
            SetupKind::CliLogin => {
                "authenticate the provider CLI on this machine (run its login command)"
            }
            SetupKind::DevProject => "register a project in Dev Tools",
            SetupKind::ObsidianVault => "configure your vault in the Obsidian Brain plugin",
            SetupKind::TwinProfile => "create a Twin profile in the Twin plugin",
            SetupKind::Misconfigured => {
                "this connector is unrecognized or misconfigured — remove it or update the app"
            }
        }
    }
}

/// Remediation text specialized for one concrete connector.
///
/// `SetupKind::remediation()` is the generic, connector-agnostic line. For
/// `CliLogin` a generic "run its login command" is useless — the whole point
/// of the kind is that a single copy-pasteable command fixes it — so this
/// substitutes the connector's actual `login_cmd` (`vercel login`,
/// `gh auth login`, …). All other kinds pass through unchanged.
pub fn remediation_for(kind: SetupKind, connector: &str) -> String {
    match kind {
        SetupKind::CliLogin => match cli_probe_spec(connector) {
            Some(spec) => format!(
                "the {} CLI is installed but not signed in — run `{}`",
                spec.probe_program, spec.login_cmd
            ),
            None => kind.remediation().to_string(),
        },
        _ => kind.remediation().to_string(),
    }
}

/// Resolver verdict for one connector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Readiness {
    Ready,
    NeedsSetup { connector: String, kind: SetupKind },
}

impl Readiness {}

/// One concrete thing standing between a persona and a working run — a
/// connector that is not ready, plus where the user fixes it. Serialized
/// into `personas.setup_detail`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupBlocker {
    /// The connector name as the persona declares it.
    pub connector: String,
    /// What kind of setup it needs — drives UI routing.
    pub kind: SetupKind,
    /// Human-readable one-liner: the connector + its remediation hint.
    pub detail: String,
}

impl SetupBlocker {
    /// Build a blocker from a not-ready `Readiness`. Returns `None` for
    /// `Readiness::Ready`.
    pub fn from_readiness(readiness: &Readiness) -> Option<Self> {
        match readiness {
            Readiness::Ready => None,
            Readiness::NeedsSetup { connector, kind } => Some(SetupBlocker {
                connector: connector.clone(),
                kind: *kind,
                detail: format!("`{}` — {}", connector, remediation_for(*kind, connector)),
            }),
        }
    }
}

/// The honest, structured account of what a persona needs before it can
/// deliver value — serialized into the `personas.setup_detail` JSON column.
/// The flat `personas.setup_status` string remains the coarse execute-gate;
/// this carries the detail the UI routes on.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaSetup {
    /// Connectors / resources still needing setup. Empty = nothing blocks.
    pub blockers: Vec<SetupBlocker>,
    /// True when the persona has a non-`manual` trigger — it will run on
    /// its own. False means the user must invoke it.
    pub has_autonomous_trigger: bool,
    /// The wired trigger types (`schedule`, `polling`, `manual`, …).
    pub triggers: Vec<String>,
    /// A plain-language summary of what the persona needs and when it runs.
    pub preview: String,
}

/// Capabilities Claude Code provides natively (WebSearch, WebFetch, Bash,
/// File*, …). A template that lists one of these as a "connector" is just
/// declaring what the persona will do — no connector definition, no vault
/// entry. Matched case-insensitively against a connector's `name` or
/// `category`.
pub fn is_native_cli_capability(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "web_search"
            | "websearch"
            | "web_fetch"
            | "webfetch"
            | "web_scraping"
            | "web_scrape"
            | "web"
            | "code_execution"
            | "shell"
            | "bash"
            | "file_read"
            | "file_write"
            | "filesystem"
            | "rss"
            | "rss_feeds"
    )
}

/// Synonym map for connector role names emitted by templates that don't match
/// a `connector_definitions.category` literally (e.g. `image_generation` →
/// `ai`). `codebase` is intentionally NOT mapped here anymore — it is a
/// first-class `BoundCredential` connector resolved via its Dev Tools project
/// probe, not guessed at via a `source_control` category match.
pub fn normalize_connector_role(name: &str) -> &str {
    match name.trim().to_ascii_lowercase().as_str() {
        "image_generation" | "image" | "image_ai" | "media_generation" => "ai",
        "llm" | "language_model" => "ai",
        "inbox" | "mail" => "email",
        "chat" | "notifications" => "messaging",
        "docs" | "wiki" | "documents" => "knowledge_base",
        "files" | "fs" | "object_storage" => "storage",
        "metrics" | "observability" | "errors" => "monitoring",
        "tasks" | "issues" => "project_management",
        _ => name,
    }
}

/// Load a connector's `metadata` JSON blob from `connector_definitions`.
/// `None` when the connector is not a registered definition (an ad-hoc role
/// label, or a native capability) — the classifier then defaults it to the
/// `Credential` class.
fn load_connector_metadata(conn: &Connection, name: &str) -> Option<String> {
    conn.query_row(
        "SELECT metadata FROM connector_definitions WHERE LOWER(name) = LOWER(?1) LIMIT 1",
        rusqlite::params![name],
        |row| row.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

/// `codebase` probe — ready when at least one active Dev Tools project
/// exists. The codebase connector resolves its project globally at runtime,
/// so any active project satisfies it.
fn has_dev_project(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM dev_projects WHERE status = 'active' LIMIT 1",
        [],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

/// `twin` probe — ready when at least one Twin profile exists. The twin
/// connector resolves the active twin globally at runtime.
fn has_twin_profile(conn: &Connection) -> bool {
    conn.query_row("SELECT 1 FROM twin_profiles LIMIT 1", [], |_| Ok(true))
        .unwrap_or(false)
}

/// `obsidian_memory` global-singleton probe — ready when the Obsidian Brain
/// vault config setting exists and carries a non-empty vault path.
fn has_obsidian_vault(conn: &Connection) -> bool {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            rusqlite::params![crate::db::settings_keys::OBSIDIAN_BRAIN_CONFIG],
            |row| row.get(0),
        )
        .ok();
    let Some(raw) = value else {
        return false;
    };
    // The blob carries a vault path under one of a couple of historical
    // key spellings — accept either, require non-empty.
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .map(|v| {
            let path = v
                .get("vault_path")
                .or_else(|| v.get("vaultPath"))
                .and_then(|p| p.as_str())
                .unwrap_or("");
            !path.trim().is_empty()
        })
        .unwrap_or(false)
}

// ============================================================================
// Provider-CLI auth probe (the Credential-class fallback)
// ============================================================================

/// Hard ceiling on one probe invocation. A provider CLI that hasn't answered
/// in this long is killed — readiness resolution runs on the UI's critical
/// path and must never hang on a CLI waiting at an interactive prompt.
const CLI_PROBE_TIMEOUT: Duration = Duration::from_secs(4);

/// How long a probe verdict is trusted. Long enough that the many readiness
/// recomputes in a single user action all hit the cache; short enough that a
/// `vercel login` the user just ran is picked up without restarting the app.
const CLI_PROBE_TTL: Duration = Duration::from_secs(300);

/// Windows `CREATE_NO_WINDOW` — keeps the probe from flashing a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The three distinguishable outcomes of an auth probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliProbeResult {
    /// The binary ran and reported an authenticated session (exit 0).
    Authed,
    /// The binary exists but the probe failed / timed out — needs `login`.
    Unauthed,
    /// The binary is not installed on this machine.
    Absent,
}

impl CliProbeResult {
    pub fn binary_present(self) -> bool {
        !matches!(self, CliProbeResult::Absent)
    }
    pub fn authed(self) -> bool {
        matches!(self, CliProbeResult::Authed)
    }
}

/// Cache entry: when it was taken (monotonic, for TTL) + wall-clock (for the
/// UI's `checkedAt`) + the verdict.
#[derive(Debug, Clone, Copy)]
struct CachedProbe {
    at: Instant,
    checked_at: chrono::DateTime<chrono::Utc>,
    result: CliProbeResult,
}

type ProbeCache = HashMap<String, CachedProbe>;

fn probe_cache() -> &'static Mutex<ProbeCache> {
    static CACHE: OnceLock<Mutex<ProbeCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Whether the stderr of a failed probe says the program itself is missing.
/// On Windows the probe goes through `cmd /C`, which always spawns
/// successfully — so the "binary absent" signal has to be read out of the
/// shell's own error text (or its 9009 exit code) rather than a spawn error.
fn stderr_means_absent(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    s.contains("is not recognized")
        || s.contains("not recognized as an internal")
        || s.contains("command not found")
        || s.contains("no such file or directory")
}

/// Build the probe command for this platform.
///
/// On Windows the npm-installed provider CLIs are `.cmd` shims, which
/// `CreateProcess` (and therefore `Command::new("vercel")`) cannot execute —
/// so the probe is routed through `cmd /C`, with `CREATE_NO_WINDOW` so no
/// console flashes on the user's screen.
fn build_probe_command(spec: &CliProbeSpec) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.arg("/C").arg(spec.probe_program).args(spec.probe_args);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new(spec.probe_program);
        c.args(spec.probe_args);
        c
    };
    // stdin closed so a CLI that would prompt fails fast instead of blocking;
    // stdout discarded (we only need the exit code); stderr kept for the
    // binary-absent detection above.
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    cmd
}

/// Run one provider-CLI auth probe. Blocking, bounded by `CLI_PROBE_TIMEOUT`.
///
/// This is the ONLY function in the resolver that spawns a process, and it is
/// never called directly by `connector_readiness` — always through
/// `cached_cli_probe`, so the TTL cache stands between it and the many
/// readiness recomputes per user action.
pub fn run_cli_probe(spec: &CliProbeSpec) -> CliProbeResult {
    let mut child = match build_probe_command(spec).spawn() {
        Ok(child) => child,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return CliProbeResult::Absent,
        Err(e) => {
            tracing::debug!(
                connector = spec.name,
                error = %e,
                "connector-readiness: CLI probe failed to spawn"
            );
            return CliProbeResult::Absent;
        }
    };

    let deadline = Instant::now() + CLI_PROBE_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    // Present but hanging — almost always an interactive
                    // prompt. Kill it and report "needs login": actionable,
                    // and it can never wedge the readiness path.
                    let _ = child.kill();
                    let _ = child.wait();
                    tracing::debug!(
                        connector = spec.name,
                        "connector-readiness: CLI probe timed out; treating as unauthenticated"
                    );
                    return CliProbeResult::Unauthed;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return CliProbeResult::Unauthed,
        }
    };

    if status.success() {
        return CliProbeResult::Authed;
    }

    // Non-zero: distinguish "not installed" from "not signed in".
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        use std::io::Read;
        let _ = pipe.read_to_string(&mut stderr);
    }
    // cmd.exe's "command not found" exit code.
    if status.code() == Some(9009) || stderr_means_absent(&stderr) {
        CliProbeResult::Absent
    } else {
        CliProbeResult::Unauthed
    }
}

/// TTL-cached `run_cli_probe`. Returns a fresh cache hit without spawning
/// anything; otherwise probes once and memoises the verdict.
pub fn cached_cli_probe(spec: &CliProbeSpec) -> CliProbeResult {
    if let Ok(cache) = probe_cache().lock() {
        if let Some(entry) = cache.get(spec.name) {
            if entry.at.elapsed() < CLI_PROBE_TTL {
                return entry.result;
            }
        }
    }
    let result = run_cli_probe(spec);
    if let Ok(mut cache) = probe_cache().lock() {
        cache.insert(
            spec.name.to_string(),
            CachedProbe {
                at: Instant::now(),
                checked_at: chrono::Utc::now(),
                result,
            },
        );
    }
    result
}

/// Read the cached verdict for a connector without probing. `None` = no entry
/// or the entry has aged out.
fn peek_cli_probe(name: &str) -> Option<CachedProbe> {
    let cache = probe_cache().lock().ok()?;
    let entry = cache.get(name)?;
    if entry.at.elapsed() < CLI_PROBE_TTL {
        Some(*entry)
    } else {
        None
    }
}

/// Drop cached probe verdicts — one connector, or (with `None`) all of them.
/// The next readiness pass re-probes.
pub fn evict_cli_probe_cache(connector: Option<&str>) {
    if let Ok(mut cache) = probe_cache().lock() {
        match connector {
            Some(name) => {
                let name_l = name.trim().to_ascii_lowercase();
                cache.retain(|k, _| !k.eq_ignore_ascii_case(&name_l));
            }
            None => cache.clear(),
        }
    }
}

/// Resolve whether `connector_name` is ready.
///
/// All connector classes resolve against global state — the vault, the Dev
/// Tools project list, the Twin profile list, the Obsidian vault config, and
/// (for `CLI_PROBE_CONNECTORS`) the provider CLIs installed on this machine —
/// so there is no per-persona parameter.
pub fn connector_readiness(conn: &Connection, connector_name: &str) -> Readiness {
    connector_readiness_with_probe(conn, connector_name, cached_cli_probe)
}

/// `connector_readiness` with the CLI probe injected.
///
/// Unit tests pass a stub so they never touch a real `vercel` / `gh` binary
/// (which would make the suite depend on the developer's machine state), and
/// so they can count invocations to assert the cache is respected.
pub fn connector_readiness_with_probe<P>(
    conn: &Connection,
    connector_name: &str,
    probe: P,
) -> Readiness
where
    P: Fn(&CliProbeSpec) -> CliProbeResult,
{
    let name = connector_name.trim();
    if name.is_empty() {
        // A blank/whitespace connector name is a corrupted template
        // declaration, not a ready connector. Fail closed so it surfaces as a
        // blocker rather than silently promoting the persona as ready.
        return Readiness::NeedsSetup {
            connector: name.to_string(),
            kind: SetupKind::Misconfigured,
        };
    }
    // Native runtime capabilities are never connectors needing setup.
    if is_native_cli_capability(name) {
        return Readiness::Ready;
    }

    let metadata = load_connector_metadata(conn, name);
    let needs = |kind: SetupKind| Readiness::NeedsSetup {
        connector: name.to_string(),
        kind,
    };

    match classify_connector(name, metadata.as_deref()) {
        ConnectorClass::ZeroConfig => Readiness::Ready,
        ConnectorClass::Credential => {
            // Phase 2 (build-readiness redesign): a Credential connector is
            // ready only if it is *uniquely bindable* to one concrete vault
            // credential. "A credential of this kind exists" is too weak —
            // an ambiguous match (2+ candidates) is a user choice the build
            // must surface, and a persona promoted with an unbindable
            // connector executes blind. `resolve_one_credential` returns
            // Some only for an unambiguous bind.
            if resolve_ready_credential(conn, name).is_some() {
                return Readiness::Ready;
            }
            // No credential resolved. For a hosting / VCS provider whose CLI
            // can hold the auth (see the module header), an authenticated CLI
            // on THIS machine is an equally real capability — but strictly a
            // fallback, because it does not travel to CI or another device.
            match cli_probe_spec(name) {
                Some(spec) => match probe(spec) {
                    CliProbeResult::Authed => Readiness::Ready,
                    CliProbeResult::Unauthed => needs(SetupKind::CliLogin),
                    // No CLI installed → the Vault is still the only route.
                    CliProbeResult::Absent => needs(SetupKind::VaultCredential),
                },
                None => needs(SetupKind::VaultCredential),
            }
        }
        ConnectorClass::GlobalProbe => match name.to_ascii_lowercase().as_str() {
            "codebase" => {
                if has_dev_project(conn) {
                    Readiness::Ready
                } else {
                    needs(SetupKind::DevProject)
                }
            }
            "twin" => {
                if has_twin_profile(conn) {
                    Readiness::Ready
                } else {
                    needs(SetupKind::TwinProfile)
                }
            }
            "obsidian_memory" => {
                if has_obsidian_vault(conn) {
                    Readiness::Ready
                } else {
                    needs(SetupKind::ObsidianVault)
                }
            }
            // A connector in GLOBAL_PROBE_CONNECTORS with no probe wired here
            // is a maintenance slip — the const array (connector.rs) and these
            // arms are hand-synced. Fail closed: a persona must not be promoted
            // ready off a probe we cannot run. The
            // `every_global_probe_connector_has_a_probe_arm` test makes this
            // arm unreachable for shipped connectors.
            _ => needs(SetupKind::Misconfigured),
        },
    }
}

/// Resolve a batch of connector names, returning only the not-ready ones.
/// The promote path and the adoption pre-flight both call this.
pub fn missing_connectors<I, S>(conn: &Connection, connector_names: I) -> Vec<Readiness>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    connector_names
        .into_iter()
        .filter_map(|name| match connector_readiness(conn, name.as_ref()) {
            Readiness::Ready => None,
            other => Some(other),
        })
        .collect()
}

/// Assemble the human-readable `preview` line for a `PersonaSetup`.
fn assemble_preview(
    blockers: &[SetupBlocker],
    trigger_types: &[String],
    has_autonomous: bool,
) -> String {
    let run = if trigger_types.is_empty() {
        "No trigger is wired — it has no way to run yet.".to_string()
    } else if has_autonomous {
        let kinds: Vec<&str> = trigger_types
            .iter()
            .filter(|t| t.as_str() != "manual")
            .map(|s| s.as_str())
            .collect();
        format!("Runs automatically on its {} trigger.", kinds.join(" / "))
    } else {
        "Runs only when you start it yourself — no automatic trigger is wired.".to_string()
    };
    if blockers.is_empty() {
        format!("Connectors resolved. {run}")
    } else {
        let needs: Vec<String> = blockers.iter().map(|b| b.detail.clone()).collect();
        format!(
            "Needs setup before it can deliver value: {}. {run}",
            needs.join("; ")
        )
    }
}

/// Build the structured `PersonaSetup` written to `personas.setup_detail`.
/// `blockers` is the not-ready connector set (from `missing_connectors`);
/// `trigger_types` is the persona's wired trigger types.
pub fn build_persona_setup(
    blockers: Vec<SetupBlocker>,
    trigger_types: Vec<String>,
) -> PersonaSetup {
    let has_autonomous_trigger = trigger_types.iter().any(|t| t.as_str() != "manual");
    let preview = assemble_preview(&blockers, &trigger_types, has_autonomous_trigger);
    PersonaSetup {
        blockers,
        has_autonomous_trigger,
        triggers: trigger_types,
        preview,
    }
}

/// Extract the connector names a persona declares, from its `design_context`
/// (`useCases[].connectors` + `summary.connectors`) and `last_design_result`
/// (`required_connectors` / `suggested_connectors`). Mirrors the runtime
/// extraction in `engine::runner::credentials::inject_design_context_credentials`
/// so a recompute sees exactly the connector set the runner would inject for.
/// De-duplicated, trimmed, blanks dropped.
pub fn persona_declared_connectors(persona: &crate::db::models::Persona) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let push = |raw: &str, names: &mut Vec<String>| {
        let n = raw.trim();
        if !n.is_empty() && !names.iter().any(|e: &String| e.eq_ignore_ascii_case(n)) {
            names.push(n.to_string());
        }
    };

    if let Some(dc) = persona.design_context.as_deref() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(dc) {
            // useCases[].connectors (camelCase promote / snake_case dry-run).
            if let Some(use_cases) = crate::engine::design_context::pick_use_cases_array(&parsed) {
                for uc in use_cases {
                    if let Some(conns) = uc.get("connectors").and_then(|v| v.as_array()) {
                        for c in conns {
                            if let Some(name) = c.as_str() {
                                push(name, &mut names);
                            } else if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                                push(name, &mut names);
                            }
                        }
                    }
                }
            }
            // summary.connectors (alternate pattern).
            if let Some(conns) = parsed
                .get("summary")
                .and_then(|s| s.get("connectors"))
                .and_then(|v| v.as_array())
            {
                for c in conns {
                    if let Some(name) = c.as_str() {
                        push(name, &mut names);
                    } else if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                        push(name, &mut names);
                    }
                }
            }
        }
    }

    if let Some(ldr) = persona.last_design_result.as_deref() {
        if let Ok(dr) = serde_json::from_str::<serde_json::Value>(ldr) {
            for key in ["required_connectors", "suggested_connectors"] {
                if let Some(conns) = dr.get(key).and_then(|v| v.as_array()) {
                    for c in conns {
                        if let Some(name) = c.as_str() {
                            push(name, &mut names);
                        } else if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                            push(name, &mut names);
                        }
                    }
                }
            }
        }
    }

    names
}

/// Live readiness for the execution gate: the not-ready connectors a persona
/// currently has, computed fresh from vault / probe state rather than trusting
/// the cached `setup_status` column. Empty = safe to run.
///
/// The column is written only at adopt / promote / credential-mutation
/// (Direction 1) — any future writer that forgets to recompute re-introduces
/// staleness. Gating on this live check makes the run gate itself honest: a
/// `ready` column with an actually-missing credential is blocked, and a
/// `needs_credentials` column whose connectors are now fine is allowed.
/// Bounded to this persona's declared connector set (one resolver pass; each
/// Credential connector runs a handful of indexed local-SQLite lookups).
pub fn persona_live_blockers(
    conn: &Connection,
    persona: &crate::db::models::Persona,
) -> Vec<Readiness> {
    let connectors = persona_declared_connectors(persona);
    missing_connectors(conn, connectors.iter())
}

/// Recompute `setup_status` + `setup_detail` for ONE persona from CURRENT
/// vault / credential / probe state and persist both columns.
///
/// The persisted `setup_status`/`setup_detail` are otherwise written only at
/// adopt and promote — so deleting or editing a bound credential AFTER promote
/// left a persona stuck at `setup_status='ready'` with a `credentialLinks`
/// entry pointing at a dead id: it passed the run gate then executed blind.
/// This is the honest recompute the credential-mutation hooks call.
///
/// Bounded to one persona (one persona read + one triggers query + the
/// per-connector resolver, all against the local SQLite). `setup_status` is a
/// two-value gate (`ready` / `needs_credentials`); this flips it honestly.
pub fn recompute_persona_setup(pool: &DbPool, persona_id: &str) -> Result<(), AppError> {
    let persona = crate::db::repos::core::personas::get_by_id(pool, persona_id)?;
    let connectors = persona_declared_connectors(&persona);

    let conn = pool.get()?;
    let missing = missing_connectors(&conn, connectors.iter());
    let blockers: Vec<SetupBlocker> = missing
        .iter()
        .filter_map(SetupBlocker::from_readiness)
        .collect();

    // Wired trigger types drive the `preview` / `has_autonomous_trigger`
    // fields. A credential mutation never changes triggers, but recomputing
    // them keeps `setup_detail` internally consistent and avoids depending on
    // a possibly-NULL prior `setup_detail`.
    let trigger_types: Vec<String> = {
        let mut stmt =
            conn.prepare("SELECT trigger_type FROM persona_triggers WHERE persona_id = ?1")?;
        let rows = stmt.query_map([persona_id], |row| row.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let new_status = if blockers.is_empty() {
        "ready"
    } else {
        "needs_credentials"
    };
    let setup = build_persona_setup(blockers, trigger_types);
    let setup_json = serde_json::to_string(&setup)
        .map_err(|e| AppError::Internal(format!("serialize setup_detail: {e}")))?;

    conn.execute(
        "UPDATE personas SET setup_status = ?1, setup_detail = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![
            new_status,
            setup_json,
            chrono::Utc::now().to_rfc3339(),
            persona_id
        ],
    )?;
    tracing::info!(
        persona_id = %persona_id,
        setup_status = %new_status,
        "connector-readiness: recomputed persona setup after credential mutation"
    );
    Ok(())
}

/// Recompute `setup_status` for every persona whose readiness could have been
/// affected by a mutation (delete / field-edit) to `credential_id`.
///
/// The affected set is the UNION of:
///  - the existing dependents scan (`audit_log::get_dependents` — structural
///    tool→connector→service_type links + observed audit-log usage), and
///  - personas whose `design_context.credentialLinks` map references this exact
///    credential id (the precise on-target set — a link pointing at the id
///    that was just deleted/edited).
///
/// Best-effort and bounded: failures are logged, never propagated, so a
/// credential mutation never fails because a downstream recompute hit a snag.
/// Call AFTER the mutation is committed for edits; for a delete, capture the
/// dependents BEFORE the row is gone (see `credential_dependent_persona_ids`).
pub fn recompute_setup_for_credential_dependents(pool: &DbPool, credential_id: &str) {
    let ids = credential_dependent_persona_ids(pool, credential_id);
    for pid in ids {
        if let Err(e) = recompute_persona_setup(pool, &pid) {
            tracing::warn!(
                persona_id = %pid,
                credential_id = %credential_id,
                error = %e,
                "connector-readiness: failed to recompute persona setup after credential mutation"
            );
        }
    }
}

/// Gather the ids of personas affected by a mutation to `credential_id` — the
/// union described on `recompute_setup_for_credential_dependents`. Split out so
/// the delete path can capture the set BEFORE the credential row is removed
/// (`audit_log::get_dependents` reads the credential's `service_type`).
pub fn credential_dependent_persona_ids(pool: &DbPool, credential_id: &str) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let push = |id: String, ids: &mut Vec<String>| {
        if !id.is_empty() && !ids.contains(&id) {
            ids.push(id);
        }
    };

    // Reuse the sanctioned dependents scan (structural + observed).
    match crate::db::repos::resources::audit_log::get_dependents(pool, credential_id) {
        Ok(deps) => {
            for d in deps {
                push(d.persona_id, &mut ids);
            }
        }
        Err(e) => tracing::warn!(
            credential_id = %credential_id,
            error = %e,
            "connector-readiness: get_dependents failed while gathering recompute set"
        ),
    }

    // Precise on-target set: personas whose credentialLinks map references this
    // exact credential id. A substring pre-filter narrows the row scan; the
    // JSON parse confirms the id appears as a credentialLinks *value* (not an
    // incidental substring elsewhere in design_context).
    if let Ok(conn) = pool.get() {
        let like = format!("%{credential_id}%");
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id, design_context FROM personas \
             WHERE design_context LIKE ?1",
        ) {
            if let Ok(rows) = stmt.query_map([&like], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            }) {
                for (pid, dc) in rows.flatten() {
                    let references = dc
                        .as_deref()
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                        .and_then(|v| {
                            v.get("credentialLinks")
                                .and_then(|l| l.as_object())
                                .map(|obj| {
                                    obj.values().any(|val| val.as_str() == Some(credential_id))
                                })
                        })
                        .unwrap_or(false);
                    if references {
                        push(pid, &mut ids);
                    }
                }
            }
        }
    }

    ids
}

/// Find the single concrete vault credential a `Credential`-class connector
/// should bind to. An exact `service_type` match wins; otherwise the
/// connector name is treated as a role and matched against the
/// `connector_definitions.category` of the user's credentials.
///
/// Returns `None` when there is no candidate OR more than one — an ambiguous
/// bind (e.g. role `ai` with both ElevenLabs and Leonardo in the vault) must
/// be a user choice, not a guess. The build surfaces that as a
/// scope-clarifying question rather than picking arbitrarily.
fn resolve_one_credential(conn: &Connection, connector_name: &str) -> Option<String> {
    let name = connector_name.trim();
    if name.is_empty() {
        return None;
    }
    // 1. Exact service_type match — the connector name IS a concrete
    //    credential service_type (`notion`, `gmail`, …).
    let exact: Vec<String> = conn
        .prepare("SELECT id FROM persona_credentials WHERE LOWER(service_type) = LOWER(?1)")
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map([name], |r| r.get::<_, String>(0))
                .ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();
    if exact.len() == 1 {
        return Some(exact[0].clone());
    }
    if exact.len() > 1 {
        return None; // ambiguous — user must pick
    }
    // 2. Category match — the connector name is an abstract role (`crm`,
    //    `email`, `knowledge_base`); bind it to the user's credential whose
    //    connector category matches the (normalized) role.
    let role = normalize_connector_role(name).to_ascii_lowercase();
    let by_category: Vec<String> = conn
        .prepare(
            "SELECT pc.id
             FROM persona_credentials pc
             JOIN connector_definitions cd ON LOWER(cd.name) = LOWER(pc.service_type)
             WHERE LOWER(cd.category) = ?1",
        )
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map([role], |r| r.get::<_, String>(0))
                .ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();
    if by_category.len() == 1 {
        return Some(by_category[0].clone());
    }
    None
}

/// Readiness-only refinement of `resolve_one_credential`: a `Credential`
/// connector is *Ready* only if it binds to a credential that is actually
/// usable — at least one non-empty field value and a last healthcheck that did
/// not fail. A zero-field (`data: {}`) or last-failed credential is still
/// *bindable* for editing/execution (so `resolve_one_credential` /
/// `resolve_credential_links` are unchanged), but must not promote a persona to
/// Ready or it executes blind (bug-hunt 2026-06-07 #4).
fn resolve_ready_credential(conn: &Connection, connector_name: &str) -> Option<String> {
    let id = resolve_one_credential(conn, connector_name)?;
    if credential_is_usable(conn, &id) {
        Some(id)
    } else {
        None
    }
}

/// Parse a credential-related timestamp tolerantly. Rust writes RFC3339 (via
/// `to_rfc3339()`), but `credential_fields.updated_at` defaults to SQLite's
/// `datetime('now')` format (`YYYY-MM-DD HH:MM:SS`, UTC, no offset). Returns
/// `None` for anything we can't confidently parse so callers fail safe.
fn parse_credential_ts(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&chrono::Utc));
    }
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|naive| chrono::DateTime::from_naive_utc_and_offset(naive, chrono::Utc))
}

/// Whether a stored credential has the substance required to count as ready:
/// at least one field carrying an actual value, `healthcheck_last_success`
/// is not an explicit `Some(false)`, and the last success did not PREDATE the
/// most recent field edit (a stale success validated values that have since
/// changed). A never-probed credential (`None`) is allowed — it is not presumed
/// broken — but an empty, last-failed, or stale-success one is not.
fn credential_is_usable(conn: &Connection, credential_id: &str) -> bool {
    // 1. Must have at least one field carrying a value. An empty `data: {}`
    //    credential creates zero `credential_fields` rows; a field cleared to
    //    "" has an empty `encrypted_value`.
    let field_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM credential_fields \
             WHERE credential_id = ?1 AND encrypted_value != ''",
            [credential_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if field_count == 0 {
        return false;
    }
    // 2. The last healthcheck must not have FAILED.
    //
    // Gating semantics are deliberately three-valued (see `HealthProbeState` in
    // engine/healthcheck.rs):
    //   - failed        → `healthcheck_last_success == Some(false)` → BLOCKS (below)
    //   - verified      → `Some(true)`  → allowed
    //   - unverifiable  → `Some(true)`  → allowed  ← IMPORTANT
    // "Unverifiable" (a connector with no live probe of any kind) is recorded as
    // a non-error success, so it lands in the same `Some(true)` bucket as a
    // genuinely verified probe and therefore does NOT block execution. The vault
    // renders it distinctly (neutral, not a green check), but readiness must not
    // treat "we couldn't probe it" as "it's broken" — that would wrongly gate
    // every stored-only credential (SSH keys, connection strings, …). Only an
    // explicit probe FAILURE demotes a credential here.
    let metadata: Option<String> = conn
        .query_row(
            "SELECT metadata FROM persona_credentials WHERE id = ?1",
            [credential_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten();
    let ledger = crate::db::models::CredentialLedger::parse(metadata.as_deref());
    if ledger.healthcheck_last_success == Some(false) {
        return false;
    }

    // 3. Staleness ordering: if the fields were edited AFTER the last successful
    //    healthcheck, that success validated values that no longer exist —
    //    don't promote to Ready until a fresh probe. Conservative: only demote
    //    when BOTH timestamps parse AND the fields are strictly newer; a parse
    //    miss keeps the success-based verdict rather than over-rejecting.
    if let Some(success_at) = ledger
        .healthcheck_last_success_at
        .as_deref()
        .and_then(parse_credential_ts)
    {
        let fields_at = conn
            .query_row(
                "SELECT MAX(updated_at) FROM credential_fields WHERE credential_id = ?1",
                [credential_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .as_deref()
            .and_then(parse_credential_ts);
        if let Some(fields_at) = fields_at {
            if fields_at > success_at {
                return false;
            }
        }
    }

    true
}

/// Resolve, for every `Credential`-class connector in `connector_names`, the
/// concrete vault credential it should bind to — a `connectorName ->
/// credentialId` map written into `design_context.credentialLinks`, which the
/// execution runtime honours when injecting credentials.
///
/// `ZeroConfig` / `GlobalProbe` connectors carry no vault credential and are
/// skipped. A `Credential` connector with zero or multiple candidate
/// credentials is left unbound (the build surfaces a scope-clarifying
/// question rather than guessing).
///
/// Without this, an abstract role like `crm` declared by a template — with
/// no covering vault-category adoption question — reaches runtime unbound,
/// and the persona executes with no credential at all.
pub fn resolve_credential_links<I, S>(
    conn: &Connection,
    connector_names: I,
) -> HashMap<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut links = HashMap::new();
    for name in connector_names {
        let name = name.as_ref().trim();
        if name.is_empty() || links.contains_key(name) {
            continue;
        }
        let metadata = load_connector_metadata(conn, name);
        if classify_connector(name, metadata.as_deref()) != ConnectorClass::Credential {
            continue;
        }
        if let Some(credential_id) = resolve_one_credential(conn, name) {
            links.insert(name.to_string(), credential_id);
        }
    }
    links
}

// ============================================================================
// Tauri command surface — provider-CLI auth visibility
// ============================================================================

/// One row of "what does this machine's provider-CLI situation look like?".
/// Purely diagnostic: the readiness resolver reads the same cache directly.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeStatus {
    /// The connector name (`vercel`, `github`, …).
    pub connector: String,
    /// The command the user runs to authenticate (`vercel login`, …).
    pub login_command: String,
    /// Whether the provider CLI is installed on this machine.
    pub binary_present: bool,
    /// Whether it reported an authenticated session.
    pub authed: bool,
    /// RFC3339 timestamp of the probe this verdict came from.
    pub checked_at: String,
}

fn cli_probe_status_row(spec: &CliProbeSpec) -> CliProbeStatus {
    // Prefer a live cache entry (no spawn); probe only on a cold/stale slot.
    let (result, checked_at) = match peek_cli_probe(spec.name) {
        Some(entry) => (entry.result, entry.checked_at),
        None => {
            let result = cached_cli_probe(spec);
            let at = peek_cli_probe(spec.name)
                .map(|e| e.checked_at)
                .unwrap_or_else(chrono::Utc::now);
            (result, at)
        }
    };
    CliProbeStatus {
        connector: spec.name.to_string(),
        login_command: spec.login_cmd.to_string(),
        binary_present: result.binary_present(),
        authed: result.authed(),
        checked_at: checked_at.to_rfc3339(),
    }
}

/// Report the provider-CLI auth state for every `CLI_PROBE_CONNECTORS` entry.
/// Served from the TTL cache — a cold entry costs one bounded probe.
#[tauri::command]
pub async fn connector_cli_probe_status(
    state: tauri::State<'_, std::sync::Arc<crate::AppState>>,
) -> Result<Vec<CliProbeStatus>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    Ok(CLI_PROBE_CONNECTORS
        .iter()
        .map(cli_probe_status_row)
        .collect())
}

/// Drop cached probe verdicts and re-probe. `connector: None` refreshes all.
/// This is what the user hits after running `vercel login` in a terminal —
/// without it they would wait out the TTL.
#[tauri::command]
pub async fn connector_cli_probe_refresh(
    state: tauri::State<'_, std::sync::Arc<crate::AppState>>,
    connector: Option<String>,
) -> Result<Vec<CliProbeStatus>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    match connector
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(name) => {
            let spec = cli_probe_spec(name).ok_or_else(|| {
                AppError::Validation(format!(
                    "connector_cli_probe_refresh: `{name}` has no provider-CLI probe"
                ))
            })?;
            evict_cli_probe_cache(Some(spec.name));
            Ok(vec![cli_probe_status_row(spec)])
        }
        None => {
            evict_cli_probe_cache(None);
            Ok(CLI_PROBE_CONNECTORS
                .iter()
                .map(cli_probe_status_row)
                .collect())
        }
    }
}

// -- Batch readiness for browsing surfaces -----------------------------------

/// The authoritative verdict for ONE connector, in the shape a browsing
/// surface (the template gallery, compare view, card preview) renders.
///
/// This exists because the gallery used to compute its own readiness in
/// TypeScript as `installed && has_credential`, which disagrees with this
/// module BY CONSTRUCTION: a `ZeroConfig` connector has no credential and
/// read as not-ready, and a `Credential` connector with a stored-but-
/// unbindable credential read as ready. The card said "ready", adoption
/// succeeded, and then the run gate (`persona_live_blockers`) blocked it.
/// One resolver, one verdict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorReadinessEntry {
    /// The connector name as it was requested (trimmed).
    pub connector: String,
    /// `true` iff the resolver returned `Readiness::Ready`.
    pub ready: bool,
    /// What kind of setup it needs. `None` when ready. Language-agnostic —
    /// the UI maps the token to a localized remediation line.
    pub kind: Option<SetupKind>,
}

/// De-duplicate a requested connector list case-insensitively, dropping blanks
/// and preserving first-seen order. The resolver treats names case-
/// insensitively, so asking twice for `Notion` and `notion` is one question.
fn dedupe_connector_names<I, S>(names: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut out: Vec<String> = Vec::new();
    for raw in names {
        let n = raw.as_ref().trim();
        if n.is_empty() {
            continue;
        }
        if !out.iter().any(|e| e.eq_ignore_ascii_case(n)) {
            out.push(n.to_string());
        }
    }
    out
}

/// Resolve a batch of connector names through the authoritative resolver.
/// Pure over the `Connection` so unit tests can exercise it without Tauri.
pub fn connector_readiness_entries<I, S>(
    conn: &Connection,
    names: I,
) -> Vec<ConnectorReadinessEntry>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    dedupe_connector_names(names)
        .into_iter()
        .map(|name| match connector_readiness(conn, &name) {
            Readiness::Ready => ConnectorReadinessEntry {
                connector: name,
                ready: true,
                kind: None,
            },
            Readiness::NeedsSetup { kind, .. } => ConnectorReadinessEntry {
                connector: name,
                ready: false,
                kind: Some(kind),
            },
        })
        .collect()
}

/// Batch-resolve connector readiness for a browsing surface.
///
/// ONE call per data change — the gallery renders many cards over a shared
/// connector vocabulary, so per-card IPC would be an N+1 against a resolver
/// that can spawn (cached, bounded) provider-CLI probes. `async` keeps that
/// probe work off the webview's main thread, matching
/// `connector_cli_probe_status`.
///
/// Names are de-duplicated case-insensitively; blanks are dropped. The result
/// is NOT positionally aligned with the request — callers look entries up by
/// name.
#[tauri::command]
pub async fn connector_readiness_batch(
    state: tauri::State<'_, std::sync::Arc<crate::AppState>>,
    connectors: Vec<String>,
) -> Result<Vec<ConnectorReadinessEntry>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let conn = state.db.get()?;
    Ok(connector_readiness_entries(&conn, connectors))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal in-memory schema — only the tables the resolver probes.
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE connector_definitions (name TEXT, metadata TEXT, category TEXT);
             CREATE TABLE persona_credentials (id TEXT, service_type TEXT, metadata TEXT);
             CREATE TABLE credential_fields (credential_id TEXT, encrypted_value TEXT, updated_at TEXT);
             CREATE TABLE dev_projects (id TEXT, status TEXT);
             CREATE TABLE twin_profiles (id TEXT);
             CREATE TABLE app_settings (key TEXT, value TEXT);",
        )
        .unwrap();
        conn
    }

    fn def(conn: &Connection, name: &str, metadata: &str) {
        conn.execute(
            "INSERT INTO connector_definitions (name, metadata) VALUES (?1, ?2)",
            rusqlite::params![name, metadata],
        )
        .unwrap();
    }

    /// Register a connector definition with a category (for binding tests).
    fn def_cat(conn: &Connection, name: &str, metadata: &str, category: &str) {
        conn.execute(
            "INSERT INTO connector_definitions (name, metadata, category) VALUES (?1, ?2, ?3)",
            rusqlite::params![name, metadata, category],
        )
        .unwrap();
    }

    /// Add a vault credential row.
    fn cred(conn: &Connection, id: &str, service_type: &str) {
        conn.execute(
            "INSERT INTO persona_credentials (id, service_type) VALUES (?1, ?2)",
            rusqlite::params![id, service_type],
        )
        .unwrap();
    }

    /// Give a vault credential row actual substance — a non-empty
    /// `credential_fields` value — so `credential_is_usable` treats it as
    /// ready rather than an empty shell.
    fn field(conn: &Connection, credential_id: &str, value: &str) {
        conn.execute(
            "INSERT INTO credential_fields (credential_id, encrypted_value, updated_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![credential_id, value, "2026-01-01 00:00:00"],
        )
        .unwrap();
    }

    #[test]
    fn zero_config_connector_is_ready() {
        let conn = test_db();
        def(
            &conn,
            "local_drive",
            r#"{"is_builtin":true,"always_active":true}"#,
        );
        assert_eq!(connector_readiness(&conn, "local_drive"), Readiness::Ready);
    }

    #[test]
    fn native_capability_is_ready_without_a_definition() {
        let conn = test_db();
        assert_eq!(connector_readiness(&conn, "web_search"), Readiness::Ready);
    }

    #[test]
    fn credential_connector_needs_a_vault_row() {
        let conn = test_db();
        def(&conn, "notion", r#"{"auth_type":"api_key"}"#);
        match connector_readiness(&conn, "notion") {
            Readiness::NeedsSetup { kind, .. } => assert_eq!(kind, SetupKind::VaultCredential),
            other => panic!("expected NeedsSetup, got {other:?}"),
        }
        cred(&conn, "notion-cred-1", "notion");
        field(&conn, "notion-cred-1", "secret-api-key");
        assert_eq!(connector_readiness(&conn, "notion"), Readiness::Ready);
    }

    #[test]
    fn codebase_needs_a_dev_project() {
        let conn = test_db();
        def(
            &conn,
            "codebase",
            r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#,
        );
        // No project — not ready, and the kind routes to Dev Tools.
        match connector_readiness(&conn, "codebase") {
            Readiness::NeedsSetup { kind, .. } => assert_eq!(kind, SetupKind::DevProject),
            other => panic!("expected NeedsSetup, got {other:?}"),
        }
        // An active project satisfies it.
        conn.execute(
            "INSERT INTO dev_projects (id, status) VALUES ('p1', 'active')",
            [],
        )
        .unwrap();
        assert_eq!(connector_readiness(&conn, "codebase"), Readiness::Ready);
    }

    #[test]
    fn twin_needs_a_twin_profile() {
        let conn = test_db();
        def(&conn, "twin", r#"{"is_builtin":true,"always_active":true}"#);
        match connector_readiness(&conn, "twin") {
            Readiness::NeedsSetup { kind, .. } => assert_eq!(kind, SetupKind::TwinProfile),
            other => panic!("expected NeedsSetup, got {other:?}"),
        }
        conn.execute("INSERT INTO twin_profiles (id) VALUES ('t1')", [])
            .unwrap();
        assert_eq!(connector_readiness(&conn, "twin"), Readiness::Ready);
    }

    #[test]
    fn obsidian_memory_needs_a_vault_config() {
        let conn = test_db();
        def(
            &conn,
            "obsidian_memory",
            r#"{"is_builtin":true,"always_active":false,"connection_mode":"desktop_bridge"}"#,
        );
        match connector_readiness(&conn, "obsidian_memory") {
            Readiness::NeedsSetup { kind, .. } => assert_eq!(kind, SetupKind::ObsidianVault),
            other => panic!("expected NeedsSetup, got {other:?}"),
        }
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![
                crate::db::settings_keys::OBSIDIAN_BRAIN_CONFIG,
                r#"{"vault_path":"/home/u/vault"}"#
            ],
        )
        .unwrap();
        assert_eq!(
            connector_readiness(&conn, "obsidian_memory"),
            Readiness::Ready
        );
    }

    #[test]
    fn codebases_aggregate_is_ready_with_zero_projects() {
        let conn = test_db();
        def(
            &conn,
            "codebases",
            r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#,
        );
        assert_eq!(connector_readiness(&conn, "codebases"), Readiness::Ready);
    }

    #[test]
    fn missing_connectors_returns_only_not_ready() {
        let conn = test_db();
        def(&conn, "local_drive", r#"{"always_active":true}"#);
        def(&conn, "notion", r#"{"auth_type":"api_key"}"#);
        def(&conn, "codebase", r#"{"always_active":true}"#);
        let missing =
            missing_connectors(&conn, ["local_drive", "notion", "codebase", "web_search"]);
        // local_drive (zero-config) + web_search (native) are ready; notion +
        // codebase are not.
        assert_eq!(missing.len(), 2);
    }

    // --- Batch entries (the browsing-surface projection) ---

    fn entry<'a>(
        entries: &'a [ConnectorReadinessEntry],
        name: &str,
    ) -> &'a ConnectorReadinessEntry {
        entries
            .iter()
            .find(|e| e.connector.eq_ignore_ascii_case(name))
            .unwrap_or_else(|| panic!("no entry for `{name}` in {entries:?}"))
    }

    /// The two cases the retired TS heuristic (`installed && has_credential`)
    /// provably got WRONG, both directions, in one pass:
    ///   - zero-config + native + aggregate connectors have no credential, so
    ///     the heuristic called them not-ready → the gallery hid working
    ///     templates behind a "Setup needed" badge.
    ///   - a credential row with no usable field is "installed && has
    ///     credential" to the heuristic → the card said Ready and the run gate
    ///     then blocked the persona.
    #[test]
    fn batch_entries_fix_both_directions_of_the_retired_heuristic() {
        let conn = test_db();
        // Zero-config: builtin + always_active, no credential anywhere.
        def(
            &conn,
            "local_drive",
            r#"{"is_builtin":true,"always_active":true}"#,
        );
        // Aggregate: `codebases` (plural) resolves ready with zero projects,
        // unlike the singular `codebase` global probe.
        def(
            &conn,
            "codebases",
            r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#,
        );
        // Credential connector with a credential ROW but no usable field —
        // the heuristic's false "ready".
        def(&conn, "notion", r#"{"auth_type":"api_key"}"#);
        cred(&conn, "notion-empty", "notion");

        let entries = connector_readiness_entries(
            &conn,
            ["local_drive", "codebases", "web_search", "notion"],
        );
        assert_eq!(entries.len(), 4);

        // Heuristic said not-ready (no credential); the resolver says ready.
        assert!(
            entry(&entries, "local_drive").ready,
            "zero-config must be ready"
        );
        assert!(
            entry(&entries, "codebases").ready,
            "aggregate must be ready"
        );
        assert!(
            entry(&entries, "web_search").ready,
            "native capability must be ready without a definition row"
        );
        assert!(entry(&entries, "local_drive").kind.is_none());

        // Heuristic said ready (a credential row exists); the resolver says no.
        let notion = entry(&entries, "notion");
        assert!(!notion.ready, "shell credential must not read as ready");
        assert_eq!(notion.kind, Some(SetupKind::VaultCredential));
    }

    #[test]
    fn batch_entries_dedupe_case_insensitively_and_drop_blanks() {
        let conn = test_db();
        def(
            &conn,
            "local_drive",
            r#"{"is_builtin":true,"always_active":true}"#,
        );
        let entries =
            connector_readiness_entries(&conn, ["local_drive", "Local_Drive", "  ", "\t"]);
        assert_eq!(entries.len(), 1, "one question per connector: {entries:?}");
        assert_eq!(entries[0].connector, "local_drive");
    }

    #[test]
    fn batch_entries_carry_the_routing_kind_for_each_not_ready_class() {
        let conn = test_db();
        def(&conn, "notion", r#"{"auth_type":"api_key"}"#);
        def(
            &conn,
            "codebase",
            r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#,
        );
        let entries = connector_readiness_entries(&conn, ["notion", "codebase"]);
        assert_eq!(
            entry(&entries, "notion").kind,
            Some(SetupKind::VaultCredential)
        );
        assert_eq!(
            entry(&entries, "codebase").kind,
            Some(SetupKind::DevProject)
        );
    }

    // --- Phase 1: credential-link resolution ---

    #[test]
    fn abstract_role_binds_to_the_single_category_credential() {
        // Template declares connector `crm`; the user has one `attio`
        // credential whose connector category is `crm`. The role binds.
        let conn = test_db();
        def(&conn, "crm", r#"{"auth_type":"api_key"}"#);
        def_cat(&conn, "attio", r#"{"auth_type":"api_key"}"#, "crm");
        cred(&conn, "cred-attio-1", "attio");
        let links = resolve_credential_links(&conn, ["crm"]);
        assert_eq!(links.get("crm"), Some(&"cred-attio-1".to_string()));
    }

    #[test]
    fn exact_service_type_binds_directly() {
        let conn = test_db();
        def(&conn, "notion", r#"{"auth_type":"api_key"}"#);
        cred(&conn, "cred-notion-1", "notion");
        let links = resolve_credential_links(&conn, ["notion"]);
        assert_eq!(links.get("notion"), Some(&"cred-notion-1".to_string()));
    }

    #[test]
    fn ambiguous_role_is_left_unbound() {
        // Role `ai` matches two vault credentials (ElevenLabs + Leonardo) —
        // an arbitrary pick would be wrong, so the connector stays unbound
        // and the build surfaces a scope-clarifying question instead.
        let conn = test_db();
        def(&conn, "ai", r#"{"auth_type":"api_key"}"#);
        def_cat(&conn, "elevenlabs", r#"{"auth_type":"api_key"}"#, "ai");
        def_cat(&conn, "leonardo_ai", r#"{"auth_type":"api_key"}"#, "ai");
        cred(&conn, "c1", "elevenlabs");
        cred(&conn, "c2", "leonardo_ai");
        let links = resolve_credential_links(&conn, ["ai"]);
        assert!(!links.contains_key("ai"));
    }

    #[test]
    fn zero_config_and_global_probe_connectors_are_not_bound() {
        // ZeroConfig (local_drive) and GlobalProbe (codebase) carry no vault
        // credential — they must never appear in the credential-link map.
        let conn = test_db();
        def(&conn, "local_drive", r#"{"always_active":true}"#);
        def(
            &conn,
            "codebase",
            r#"{"always_active":true,"connection_mode":"desktop_bridge"}"#,
        );
        let links = resolve_credential_links(&conn, ["local_drive", "codebase"]);
        assert!(links.is_empty());
    }

    #[test]
    fn unbindable_credential_connector_is_omitted() {
        // A Credential connector with no matching vault credential is simply
        // absent from the map (Phase 2 promote-gating flags it; Phase 4 asks).
        let conn = test_db();
        def(&conn, "hubspot", r#"{"auth_type":"api_key"}"#);
        let links = resolve_credential_links(&conn, ["hubspot"]);
        assert!(links.is_empty());
    }

    // --- Fail-closed defaults (this requirement) ---

    #[test]
    fn blank_connector_name_is_not_ready() {
        // A blank/whitespace connector name is a corrupted declaration, not a
        // ready connector — it must fail closed instead of promoting blind.
        let conn = test_db();
        for blank in ["", "   ", "\t", "\n "] {
            match connector_readiness(&conn, blank) {
                Readiness::NeedsSetup { kind, .. } => {
                    assert_eq!(kind, SetupKind::Misconfigured)
                }
                other => panic!("expected NeedsSetup(Misconfigured) for blank name, got {other:?}"),
            }
        }
    }

    // --- Direction 1: readiness reacts to credential mutation ---

    #[test]
    fn declared_connectors_extracted_from_design_context_and_last_design_result() {
        // useCases[].connectors (objects) + summary.connectors (strings) +
        // last_design_result.required/suggested_connectors, de-duplicated
        // case-insensitively.
        let mut persona = crate::db::models::Persona::default();
        persona.design_context = Some(
            r#"{
                "useCases":[{"connectors":[{"name":"notion"},{"name":"gmail"}]}],
                "summary":{"connectors":["Notion","slack"]}
            }"#
            .to_string(),
        );
        persona.last_design_result = Some(
            r#"{"required_connectors":["hubspot"],"suggested_connectors":[{"name":"gmail"}]}"#
                .to_string(),
        );
        let names = persona_declared_connectors(&persona);
        let lower: Vec<String> = names.iter().map(|n| n.to_ascii_lowercase()).collect();
        assert!(lower.contains(&"notion".to_string()));
        assert!(lower.contains(&"gmail".to_string()));
        assert!(lower.contains(&"slack".to_string()));
        assert!(lower.contains(&"hubspot".to_string()));
        // `Notion` (summary) must not duplicate `notion` (useCases).
        assert_eq!(
            lower.iter().filter(|n| n.as_str() == "notion").count(),
            1,
            "connector names must de-duplicate case-insensitively"
        );
    }

    #[test]
    fn declared_connectors_empty_when_no_design_context() {
        let persona = crate::db::models::Persona::default();
        assert!(persona_declared_connectors(&persona).is_empty());
    }

    // --- Direction 3: gate on live readiness ---

    #[test]
    fn live_blockers_ignore_stale_column_and_reflect_actual_state() {
        // A persona whose design_context declares `notion`. With no vault
        // credential the live gate reports a blocker regardless of what the
        // cached column says (stale-ready → blocked). Adding a usable
        // credential clears it (stale-needs → allowed).
        let conn = test_db();
        def(&conn, "notion", r#"{"auth_type":"api_key"}"#);
        let mut persona = crate::db::models::Persona::default();
        persona.design_context =
            Some(r#"{"useCases":[{"connectors":[{"name":"notion"}]}]}"#.to_string());

        // Column claims ready, but the connector is actually missing → blocked.
        persona.setup_status = "ready".to_string();
        assert_eq!(persona_live_blockers(&conn, &persona).len(), 1);

        // Column claims needs_credentials, but the connector is actually fine
        // → no live blocker (the gate would allow the run).
        cred(&conn, "notion-cred", "notion");
        field(&conn, "notion-cred", "secret");
        persona.setup_status = "needs_credentials".to_string();
        assert!(persona_live_blockers(&conn, &persona).is_empty());
    }

    #[test]
    fn live_blockers_empty_for_persona_with_no_connectors() {
        let conn = test_db();
        let persona = crate::db::models::Persona::default();
        assert!(persona_live_blockers(&conn, &persona).is_empty());
    }

    // --- CLI-auth readiness fallback (Credential class) ---

    use std::cell::Cell;

    /// A stub probe: always returns `result`, and counts invocations. Keeps
    /// the suite off the developer's real `vercel` / `gh` binaries.
    fn stub_probe(
        result: CliProbeResult,
        calls: &Cell<usize>,
    ) -> impl Fn(&CliProbeSpec) -> CliProbeResult + '_ {
        move |_spec| {
            calls.set(calls.get() + 1);
            result
        }
    }

    /// Register `vercel` as an ordinary API connector definition.
    fn vercel_def(conn: &Connection) {
        def(conn, "vercel", r#"{"auth_type":"api_key"}"#);
    }

    #[test]
    fn bound_credential_wins_over_the_cli_probe() {
        // A usable Vault credential is the CI-capable mode and must always be
        // the first path — the probe must not even run.
        let conn = test_db();
        vercel_def(&conn);
        cred(&conn, "vercel-cred", "vercel");
        field(&conn, "vercel-cred", "token");

        let calls = Cell::new(0usize);
        let readiness = connector_readiness_with_probe(
            &conn,
            "vercel",
            stub_probe(CliProbeResult::Unauthed, &calls),
        );

        assert_eq!(readiness, Readiness::Ready);
        assert_eq!(
            calls.get(),
            0,
            "a bound credential must short-circuit the CLI probe"
        );
    }

    #[test]
    fn authed_cli_makes_a_credential_connector_ready() {
        let conn = test_db();
        vercel_def(&conn);
        let calls = Cell::new(0usize);
        assert_eq!(
            connector_readiness_with_probe(
                &conn,
                "vercel",
                stub_probe(CliProbeResult::Authed, &calls)
            ),
            Readiness::Ready
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn installed_but_unauthed_cli_asks_for_login_not_the_vault() {
        let conn = test_db();
        vercel_def(&conn);
        let calls = Cell::new(0usize);
        match connector_readiness_with_probe(
            &conn,
            "vercel",
            stub_probe(CliProbeResult::Unauthed, &calls),
        ) {
            Readiness::NeedsSetup { kind, .. } => assert_eq!(kind, SetupKind::CliLogin),
            other => panic!("expected NeedsSetup(CliLogin), got {other:?}"),
        }
    }

    #[test]
    fn absent_cli_falls_back_to_the_vault_credential_kind() {
        // Unchanged pre-existing behavior: no CLI, no credential → Vault.
        let conn = test_db();
        vercel_def(&conn);
        let calls = Cell::new(0usize);
        match connector_readiness_with_probe(
            &conn,
            "vercel",
            stub_probe(CliProbeResult::Absent, &calls),
        ) {
            Readiness::NeedsSetup { kind, .. } => assert_eq!(kind, SetupKind::VaultCredential),
            other => panic!("expected NeedsSetup(VaultCredential), got {other:?}"),
        }
    }

    #[test]
    fn non_cli_connectors_never_reach_the_probe() {
        // `notion` has no CLI-auth path — the probe must not be consulted.
        let conn = test_db();
        def(&conn, "notion", r#"{"auth_type":"api_key"}"#);
        let calls = Cell::new(0usize);
        match connector_readiness_with_probe(
            &conn,
            "notion",
            stub_probe(CliProbeResult::Authed, &calls),
        ) {
            Readiness::NeedsSetup { kind, .. } => assert_eq!(kind, SetupKind::VaultCredential),
            other => panic!("expected NeedsSetup(VaultCredential), got {other:?}"),
        }
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn cli_login_blocker_names_the_actual_login_command() {
        // The generic remediation ("run its login command") is useless; the
        // blocker detail must carry the copy-pasteable command.
        let readiness = Readiness::NeedsSetup {
            connector: "fly_io".to_string(),
            kind: SetupKind::CliLogin,
        };
        let blocker = SetupBlocker::from_readiness(&readiness).unwrap();
        assert!(
            blocker.detail.contains("flyctl auth login"),
            "expected the login command in the blocker detail, got: {}",
            blocker.detail
        );
    }

    #[test]
    fn probe_cache_is_respected_within_the_ttl() {
        // The real cache sits in `cached_cli_probe`, which readiness calls per
        // connector. Two consecutive resolutions must cost ONE probe.
        evict_cli_probe_cache(None);
        let spec = cli_probe_spec("railway").unwrap();

        // Prime the cache with `Authed`. No CI machine (and essentially no dev
        // box) has an authenticated `railway` CLI, so a verdict of `Authed`
        // coming back can ONLY have come from the cache — that is the real
        // observation, not a self-incremented counter.
        {
            let mut cache = probe_cache().lock().unwrap();
            cache.insert(
                spec.name.to_string(),
                CachedProbe {
                    at: Instant::now(),
                    checked_at: chrono::Utc::now(),
                    result: CliProbeResult::Authed,
                },
            );
        }
        for _ in 0..3 {
            assert_eq!(
                cached_cli_probe(spec),
                CliProbeResult::Authed,
                "a fresh cache entry must be served without spawning a process"
            );
        }

        // An expired entry is not served.
        {
            let mut cache = probe_cache().lock().unwrap();
            cache.insert(
                spec.name.to_string(),
                CachedProbe {
                    at: Instant::now() - CLI_PROBE_TTL - Duration::from_secs(1),
                    checked_at: chrono::Utc::now(),
                    result: CliProbeResult::Authed,
                },
            );
        }
        assert!(
            peek_cli_probe(spec.name).is_none(),
            "an aged-out entry must not be served"
        );

        // Eviction clears it outright.
        evict_cli_probe_cache(Some("railway"));
        assert!(peek_cli_probe(spec.name).is_none());
    }

    #[test]
    fn stderr_absence_detection_covers_both_shells() {
        assert!(stderr_means_absent(
            "'vercel' is not recognized as an internal or external command"
        ));
        assert!(stderr_means_absent("bash: gh: command not found"));
        assert!(!stderr_means_absent(
            "Error: No existing credentials found. Please run `vercel login`."
        ));
    }

    #[test]
    fn every_cli_probe_connector_produces_a_cli_login_kind() {
        // The table (connector.rs) and this resolver are hand-synced. Every
        // entry must actually reach the CliLogin arm — a name that classified
        // as something other than Credential would silently lose the fallback.
        let conn = test_db();
        let calls = Cell::new(0usize);
        for spec in CLI_PROBE_CONNECTORS {
            def(&conn, spec.name, r#"{"auth_type":"api_key"}"#);
            match connector_readiness_with_probe(
                &conn,
                spec.name,
                stub_probe(CliProbeResult::Unauthed, &calls),
            ) {
                Readiness::NeedsSetup { kind, .. } => assert_eq!(
                    kind,
                    SetupKind::CliLogin,
                    "`{}` did not reach the CLI-auth fallback",
                    spec.name
                ),
                other => panic!(
                    "expected NeedsSetup(CliLogin) for `{}`, got {other:?}",
                    spec.name
                ),
            }
        }
    }

    #[test]
    fn every_global_probe_connector_has_a_probe_arm() {
        // GLOBAL_PROBE_CONNECTORS (connector.rs) and the GlobalProbe match arms
        // in `connector_readiness` are kept in sync BY HAND. If someone adds a
        // probe connector to the const array without wiring its arm here, the
        // `_ => Misconfigured` fallthrough fires. Against an empty DB — where no
        // backing entity exists — every *wired* probe reports its own specific
        // SetupKind (DevProject / TwinProfile / ObsidianVault), while an
        // *unwired* one reports Misconfigured. Asserting none is Misconfigured
        // makes the const-array / match-arm desync a test failure, not a
        // silently-broken persona.
        use crate::db::models::GLOBAL_PROBE_CONNECTORS;
        let conn = test_db();
        for connector in GLOBAL_PROBE_CONNECTORS {
            match connector_readiness(&conn, connector) {
                Readiness::NeedsSetup { kind, .. } => assert_ne!(
                    kind,
                    SetupKind::Misconfigured,
                    "GLOBAL_PROBE_CONNECTORS entry `{connector}` has no probe arm in \
                     connector_readiness — add a match arm resolving its backing entity",
                ),
                Readiness::Ready => panic!(
                    "probe connector `{connector}` resolved Ready against an empty DB — its \
                     probe should report NeedsSetup while its backing entity is absent",
                ),
            }
        }
    }
}
