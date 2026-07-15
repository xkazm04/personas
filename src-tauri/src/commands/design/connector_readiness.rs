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
            if resolve_ready_credential(conn, name).is_some() {
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

/// Extract the connector names a persona declares, from its `design_context`
/// (`useCases[].connectors` + `summary.connectors`) and `last_design_result`
/// (`required_connectors` / `suggested_connectors`). Mirrors the runtime
/// extraction in `engine::runner::credentials::inject_design_context_credentials`
/// so a recompute sees exactly the connector set the runner would inject for.
/// De-duplicated, trimmed, blanks dropped.
pub fn persona_declared_connectors(persona: &crate::db::models::Persona) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut push = |raw: &str, names: &mut Vec<String>| {
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
    let blockers: Vec<SetupBlocker> = missing.iter().filter_map(SetupBlocker::from_readiness).collect();

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
    let mut push = |id: String, ids: &mut Vec<String>| {
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
                                    obj.values()
                                        .any(|val| val.as_str() == Some(credential_id))
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
    // 2. The last healthcheck must not have failed.
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
