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
//!   - `Credential`   → a `persona_credentials` row of that service_type
//!                      (or a category-synonym match).
//!   - `GlobalProbe`  → a connector-specific probe against a backing local
//!                      entity: a Dev Tools project (`codebase`), a Twin
//!                      profile (`twin`), an Obsidian vault (`obsidian_
//!                      memory`). Resolved globally — no per-persona binding.
//!
//! Full rationale: `docs/architecture/connector-classification.md`.

use rusqlite::Connection;

use crate::db::models::{classify_connector, ConnectorClass};

/// What kind of setup a not-ready connector needs — drives the remediation
/// the UI routes the user to (which is NOT always "Settings → Vault").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetupKind {
    /// An API credential configured in Settings → Vault.
    VaultCredential,
    /// A Dev Tools project registered (and, later, bound to the persona).
    DevProject,
    /// The Obsidian Brain vault configured.
    ObsidianVault,
    /// A Twin profile created in the Twin plugin.
    TwinProfile,
}

impl SetupKind {
    /// Short machine token for logs / UI routing.
    pub fn as_str(&self) -> &'static str {
        match self {
            SetupKind::VaultCredential => "vault_credential",
            SetupKind::DevProject => "dev_project",
            SetupKind::ObsidianVault => "obsidian_vault",
            SetupKind::TwinProfile => "twin_profile",
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

/// True when the vault holds a credential for `service_type`, or for a
/// category-synonym of it. The vault (`persona_credentials`) is global —
/// keyed by `service_type`, not scoped per persona.
fn vault_has_credential(conn: &Connection, name: &str) -> bool {
    let exact: bool = conn
        .query_row(
            "SELECT 1 FROM persona_credentials WHERE LOWER(service_type) = LOWER(?1) LIMIT 1",
            rusqlite::params![name],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if exact {
        return true;
    }
    // Category-synonym fallback: the vault has a credential whose connector
    // category matches the (normalized) role this connector names.
    let normalized = normalize_connector_role(name).to_ascii_lowercase();
    conn.query_row(
        "SELECT 1
         FROM connector_definitions cd
         JOIN persona_credentials pc ON LOWER(pc.service_type) = LOWER(cd.name)
         WHERE LOWER(cd.category) = ?1
         LIMIT 1",
        rusqlite::params![normalized],
        |_| Ok(true),
    )
    .unwrap_or(false)
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
        return Readiness::Ready;
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
            if vault_has_credential(conn, name) {
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
            // A connector in GLOBAL_PROBE_CONNECTORS with no probe wired
            // here yet — be lenient rather than hard-fail.
            _ => Readiness::Ready,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal in-memory schema — only the tables the resolver probes.
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE connector_definitions (name TEXT, metadata TEXT);
             CREATE TABLE persona_credentials (service_type TEXT);
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
        conn.execute(
            "INSERT INTO persona_credentials (service_type) VALUES ('notion')",
            [],
        )
        .unwrap();
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
}
