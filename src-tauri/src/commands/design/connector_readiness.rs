//! Unified connector-readiness resolver.
//!
//! The single source of truth for "is connector X ready for persona P?".
//! Replaces the two byte-identical `BUILTIN_LOCAL_CONNECTORS` allowlists and
//! the divergent `vault_missing_connectors` (promote) / `check_persona_
//! runnability` (adopt) logic — which used to disagree, so a persona could
//! pass adoption and then fail promote.
//!
//! Dispatch is driven by `ConnectorClass` (see `db::models::connector`):
//!   - `ZeroConfig`   → always ready.
//!   - `Credential`   → uniquely bindable to one concrete vault credential
//!                      (exact service_type, else a category match). An
//!                      ambiguous or absent match is NeedsSetup.
//!   - `GlobalProbe`  → a connector-specific probe against a backing local
//!                      entity: a Dev Tools project (`codebase`), a Twin
//!                      profile (`twin`), an Obsidian vault (`obsidian_
//!                      memory`). Resolved globally — no per-persona binding.
//!
//! Full rationale: `docs/architecture/connector-classification.md`.

use std::collections::HashMap;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{classify_connector, ConnectorClass};

/// What kind of setup a not-ready connector needs — drives the remediation
/// the UI routes the user to (which is NOT always "Settings → Vault").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SetupKind {
    /// An API credential configured in Settings → Vault.
    VaultCredential,
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
            SetupKind::DevProject => "register a project in Dev Tools",
            SetupKind::ObsidianVault => {
                "configure your vault in the Obsidian Brain plugin"
            }
            SetupKind::TwinProfile => "create a Twin profile in the Twin plugin",
            SetupKind::Misconfigured => {
                "this connector is unrecognized or misconfigured — remove it or update the app"
            }
        }
    }
}

/// Resolver verdict for one connector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Readiness {
    Ready,
    NeedsSetup { connector: String, kind: SetupKind },
}

impl Readiness {
    pub fn is_ready(&self) -> bool {
        matches!(self, Readiness::Ready)
    }
}

/// One concrete thing standing between a persona and a working run — a
/// connector that is not ready, plus where the user fixes it. Serialized
/// into `personas.setup_detail`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
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
                detail: format!("`{}` — {}", connector, kind.remediation()),
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

/// Resolve whether `connector_name` is ready.
///
/// All connector classes resolve against global state — the vault, the Dev
/// Tools project list, the Twin profile list, the Obsidian vault config —
/// so there is no per-persona parameter.
pub fn connector_readiness(conn: &Connection, connector_name: &str) -> Readiness {
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
            if resolve_one_credential(conn, name).is_some() {
                Readiness::Ready
            } else {
                needs(SetupKind::VaultCredential)
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
pub fn resolve_credential_links<I, S>(conn: &Connection, connector_names: I) -> HashMap<String, String>
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal in-memory schema — only the tables the resolver probes.
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE connector_definitions (name TEXT, metadata TEXT, category TEXT);
             CREATE TABLE persona_credentials (id TEXT, service_type TEXT);
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

    #[test]
    fn zero_config_connector_is_ready() {
        let conn = test_db();
        def(&conn, "local_drive", r#"{"is_builtin":true,"always_active":true}"#);
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
    fn obsidian_memory_empty_vault_path_is_not_ready() {
        let conn = test_db();
        def(&conn, "obsidian_memory", r#"{"always_active":false}"#);
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![
                crate::db::settings_keys::OBSIDIAN_BRAIN_CONFIG,
                r#"{"vault_path":""}"#
            ],
        )
        .unwrap();
        assert!(!connector_readiness(&conn, "obsidian_memory").is_ready());
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
        let missing = missing_connectors(&conn, ["local_drive", "notion", "codebase", "web_search"]);
        // local_drive (zero-config) + web_search (native) are ready; notion +
        // codebase are not.
        assert_eq!(missing.len(), 2);
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
        def(&conn, "codebase", r#"{"always_active":true,"connection_mode":"desktop_bridge"}"#);
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

    #[test]
    fn credential_connector_with_ambiguous_candidates_needs_setup() {
        // Phase 2: two `email`-category credentials → not uniquely bindable.
        // Readiness must be NeedsSetup so the build asks which one, rather
        // than promoting `ready` off a connector it can't unambiguously wire.
        let conn = test_db();
        def(&conn, "email", r#"{"auth_type":"api_key"}"#);
        def_cat(&conn, "gmail", r#"{"auth_type":"api_key"}"#, "email");
        def_cat(&conn, "outlook", r#"{"auth_type":"api_key"}"#, "email");
        cred(&conn, "c1", "gmail");
        cred(&conn, "c2", "outlook");
        assert!(!connector_readiness(&conn, "email").is_ready());
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
