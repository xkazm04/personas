//! A project's OWN context map, declared rather than derived.
//!
//! The code scan (`context_generation.rs`) asks an LLM to read a tree of source
//! files and invent contexts from it. That is the right default for a codebase.
//! It has nothing to say about a project made of documents: measured 2026-09-08
//! over six bank repositories whose whole substance is `governance.yaml`,
//! `docs/*.md`, `tools/*.sh` and a 39-line hello-world server, the scan reported
//! **0 contexts** — and every persona chartered on that project then spent a run
//! re-diagnosing the same fault, because nothing anywhere could say "this is my
//! map".
//!
//! There was no door to say it either. `context_fingerprints.rs:18` reads
//! contexts from the DB and explicitly never from `context-map.json`;
//! `context_map_export.rs` WRITES that file from the DB; `POST
//! /dev-tools/export-context-map` re-writes it. Nothing read it back, so the
//! map was a one-way export and a project could only ever receive Personas'
//! opinion of itself.
//!
//! This module is the read direction, and the rule that makes it safe:
//!
//! > **A `context-map.json` is the project's declaration when it is git-TRACKED
//! > *and* carries the top-level marker `"declared": true`. Anything else at
//! > that path is Personas' own export and is ignored.**
//!
//! **Both halves are load-bearing, and the marker is the one that matters.**
//! Tracked-ness alone is not authority: plenty of projects commit the file the
//! export generates — **Personas' own repository does** — and treating mere
//! presence as a declaration would silence that repo's scan and refuse its
//! export, which is a regression and not a feature. The export **never writes
//! the marker**, so a committed export artifact can never be mistaken for a
//! statement of authority, and a project opts in by one deliberate edit. The
//! tracked half still matters on top of it: a *generated* file is untracked, so
//! requiring the commit keeps a stray local edit from steering the scan.
//!
//! `git ls-files --error-unmatch` answers the tracked half ("did somebody commit
//! this?"), costs one short subprocess, and degrades to "not declared" on any
//! repo where git is absent.
//!
//! A file that claims authority is validated against the export's own schema
//! before anything is written: a malformed one is a typed `AppError::Validation`
//! naming the offending field, never a silent fall-back to the code scan. A
//! declaration with zero contexts is still authoritative — it declares
//! emptiness, and the scan must not answer it by guessing. A file WITHOUT the
//! marker is not validated at all — it is simply not this module's business.

use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;

use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::context_generation::{group_key, CONTEXT_CATEGORIES, GROUP_DOMAINS};

/// The declared map's filename at the project root — the same path
/// `context_map_export` writes, deliberately: a project declares by committing
/// the file Personas would otherwise generate.
pub const DECLARED_MAP_FILE: &str = "context-map.json";

/// The top-level key a project sets to `true` to claim authority over its own
/// context map. Absent from everything `context_map_export` writes, by
/// construction — that is what keeps a committed export from reading back as a
/// declaration.
pub const DECLARATION_MARKER: &str = "declared";

/// One group as declared. `color`/`domain` are optional; everything the export
/// emits round-trips.
#[derive(Debug, Clone)]
pub struct DeclaredGroup {
    /// The export's own `id`, kept ONLY to resolve a context's `group_id` back
    /// to a group name. Never written — group identity here is the name.
    pub id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub domain: Option<String>,
}

/// One context as declared. The field set is the export's, so a project can
/// take a generated `context-map.json`, edit it, commit it, and have it read
/// back unchanged.
#[derive(Debug, Clone, Default)]
pub struct DeclaredContext {
    pub name: String,
    pub group: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub business_feature: Option<String>,
    pub file_paths: Vec<String>,
    pub entry_points: Vec<String>,
    pub keywords: Vec<String>,
    pub db_tables: Vec<String>,
    pub cross_refs: Vec<String>,
    pub tech_stack: Vec<String>,
    pub api_surface: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct DeclaredMap {
    pub groups: Vec<DeclaredGroup>,
    pub contexts: Vec<DeclaredContext>,
}

/// What applying a declaration did. Reported rather than summed into the scan's
/// generic counters so an operator can tell a declared map from a derived one
/// in the scan log.
#[derive(Debug, Clone, Default)]
pub struct DeclarationSummary {
    pub groups_upserted: usize,
    pub contexts_upserted: usize,
    /// Previously-declared contexts absent from this declaration. Only rows
    /// carrying `source = 'declared'` are ever pruned — a derived context is
    /// never deleted by a declaration, because the declaration says what the
    /// project owns, not what Personas may forget.
    pub contexts_pruned: usize,
    pub files_declared: usize,
}

// =============================================================================
// Reading
// =============================================================================

/// Is `<root>/context-map.json` committed to git?
///
/// `false` for: no such file, not a git repository, git not installed, or the
/// file present but untracked (which is exactly what the export leaves behind).
/// Bounded to one short `git` invocation, mirroring `context_map_export`'s
/// `git_provenance`. **Not authority on its own** — see `is_declared_map`.
fn is_tracked(root: &Path) -> bool {
    if !root.join(DECLARED_MAP_FILE).is_file() {
        return false;
    }
    // `ls-files --error-unmatch` exits non-zero (→ None) for an untracked path
    // and echoes the path (→ Some) for a tracked one. Through the module
    // family's one sync git door, not a second spawn site of our own.
    super::context_map_export::git_capture(
        root,
        &["ls-files", "--error-unmatch", "--", DECLARED_MAP_FILE],
    )
    .is_some()
}

/// Does this file text claim authority — top-level `"declared": true`?
///
/// Deliberately total and quiet: anything that is not parseable JSON, is not an
/// object, or lacks the marker simply does not claim authority. Nothing about a
/// project's ordinary export artifact should be able to produce an error here,
/// because the answer for that file is just "no".
fn declares_authority(raw: &str) -> bool {
    serde_json::from_str::<Value>(raw)
        .ok()
        .as_ref()
        .and_then(|v| v.get(DECLARATION_MARKER))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Is there a declaration at `root` — tracked AND marked?
///
/// This is the predicate the export asks before overwriting the file, and the
/// scan asks before believing it. A committed export artifact (no marker) is
/// `false` on both counts: it keeps being exported, and it never steers a scan.
pub fn is_declared_map(root: &Path) -> bool {
    if !is_tracked(root) {
        return false;
    }
    std::fs::read_to_string(root.join(DECLARED_MAP_FILE))
        .map(|raw| declares_authority(&raw))
        .unwrap_or(false)
}

/// The project's declaration, or `None` when it has not made one.
///
/// `None` covers every "this is not a declaration" case, including a tracked
/// file with no marker and a tracked file that is not even JSON — mere presence
/// must never be able to silence a scan.
///
/// `Err` means the project DID claim authority (`"declared": true`) and the
/// declaration is unusable — the caller must refuse, not fall back. Silently
/// deriving from code over a malformed declaration would answer a project's
/// explicit statement about itself with a guess, and look identical to success.
pub fn read_declared_map(root: &Path) -> Result<Option<DeclaredMap>, AppError> {
    if !is_tracked(root) {
        return Ok(None);
    }
    let path = root.join(DECLARED_MAP_FILE);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        tracing::warn!(
            root = %root.display(),
            "context-map.json is tracked but unreadable; not treating it as a declaration"
        );
        return Ok(None);
    };
    if !declares_authority(&raw) {
        // Not a declaration — the ordinary case for every project that simply
        // committed the export's output. Only a file that cannot even be parsed
        // is worth a line, because that one is a broken artifact either way.
        if serde_json::from_str::<Value>(&raw).is_err() {
            tracing::warn!(
                root = %root.display(),
                "context-map.json is tracked but not valid JSON; treating it as an export artifact, not a declaration"
            );
        }
        return Ok(None);
    }
    parse_declared_map(&raw).map(Some)
}

fn invalid(field: &str, what: &str) -> AppError {
    AppError::Validation(format!("{DECLARED_MAP_FILE}: {field} {what}"))
}

fn string_field(obj: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// A declared JSON array of strings. Absent or null → empty. Anything else that
/// is not an array of strings is a refusal naming the field, because a context
/// whose `file_paths` is a bare string is a mistake worth telling the author
/// about rather than reading as zero files.
fn string_array(
    obj: &serde_json::Map<String, Value>,
    key: &str,
    field: &str,
) -> Result<Vec<String>, AppError> {
    match obj.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => {
            let mut out = Vec::with_capacity(items.len());
            for (i, item) in items.iter().enumerate() {
                let s = item
                    .as_str()
                    .ok_or_else(|| invalid(&format!("{field}.{key}[{i}]"), "must be a string"))?;
                let s = s.trim();
                if !s.is_empty() {
                    out.push(s.to_string());
                }
            }
            Ok(out)
        }
        Some(_) => Err(invalid(
            &format!("{field}.{key}"),
            "must be an array of strings",
        )),
    }
}

/// Validate a declaration against the export schema documented at the top of
/// `context_map_export.rs`. Pure — the whole point is that a project can be
/// told what is wrong with its file without a scan, a database or a filesystem.
///
/// The `"declared": true` marker is NOT required here. On the file path the
/// caller has already checked it (`read_declared_map`); on the route path the
/// body is a declaration by construction — a caller that POSTs to
/// `…/contexts/{id}/declare` has declared by the act of calling it.
pub fn parse_declared_map(raw: &str) -> Result<DeclaredMap, AppError> {
    let doc: Value = serde_json::from_str(raw)
        .map_err(|e| invalid("document", &format!("is not valid JSON: {e}")))?;
    let doc = doc
        .as_object()
        .ok_or_else(|| invalid("document", "must be a JSON object at the root"))?;

    // `contexts` is REQUIRED and must be an array. An empty array is legal and
    // meaningful: the project declares that it has no contexts yet.
    let contexts_raw = match doc.get("contexts") {
        Some(Value::Array(items)) => items,
        None => return Err(invalid("contexts", "is required (use [] to declare none)")),
        Some(_) => return Err(invalid("contexts", "must be an array")),
    };

    let mut groups = Vec::new();
    match doc.get("groups") {
        None | Some(Value::Null) => {}
        Some(Value::Array(items)) => {
            for (i, item) in items.iter().enumerate() {
                let field = format!("groups[{i}]");
                let obj = item
                    .as_object()
                    .ok_or_else(|| invalid(&field, "must be an object"))?;
                let name = string_field(obj, "name").ok_or_else(|| {
                    invalid(&format!("{field}.name"), "is required and non-empty")
                })?;
                let domain = string_field(obj, "domain");
                if let Some(d) = domain.as_deref() {
                    if !GROUP_DOMAINS.contains(&d) {
                        return Err(invalid(
                            &format!("{field}.domain"),
                            &format!("\"{d}\" is not one of {}", GROUP_DOMAINS.join("|")),
                        ));
                    }
                }
                groups.push(DeclaredGroup {
                    id: string_field(obj, "id"),
                    name,
                    color: string_field(obj, "color"),
                    domain,
                });
            }
        }
        Some(_) => return Err(invalid("groups", "must be an array")),
    }

    // A context may name its group either way round — `group` (the name, what a
    // human writes) or `group_id` (what the export emits alongside it).
    let by_id: HashMap<&str, &str> = groups
        .iter()
        .filter_map(|g| g.id.as_deref().map(|id| (id, g.name.as_str())))
        .collect();
    let declared_names: Vec<String> = groups.iter().map(|g| group_key(&g.name)).collect();

    let mut contexts = Vec::with_capacity(contexts_raw.len());
    for (i, item) in contexts_raw.iter().enumerate() {
        let field = format!("contexts[{i}]");
        let obj = item
            .as_object()
            .ok_or_else(|| invalid(&field, "must be an object"))?;
        let name = string_field(obj, "name")
            .ok_or_else(|| invalid(&format!("{field}.name"), "is required and non-empty"))?;

        let category = string_field(obj, "category");
        if let Some(c) = category.as_deref() {
            if !CONTEXT_CATEGORIES.contains(&c) {
                return Err(invalid(
                    &format!("{field}.category"),
                    &format!("\"{c}\" is not one of {}", CONTEXT_CATEGORIES.join("|")),
                ));
            }
        }

        let group = match string_field(obj, "group") {
            Some(g) => Some(g),
            None => string_field(obj, "group_id")
                .and_then(|id| by_id.get(id.as_str()).map(|n| (*n).to_string())),
        };
        if let Some(g) = group.as_deref() {
            if !declared_names.contains(&group_key(g)) {
                return Err(invalid(
                    &format!("{field}.group"),
                    &format!("\"{g}\" is not declared in `groups`"),
                ));
            }
        }

        contexts.push(DeclaredContext {
            name,
            group,
            description: string_field(obj, "description"),
            category,
            business_feature: string_field(obj, "business_feature"),
            file_paths: string_array(obj, "file_paths", &field)?,
            entry_points: string_array(obj, "entry_points", &field)?,
            keywords: string_array(obj, "keywords", &field)?,
            db_tables: string_array(obj, "db_tables", &field)?,
            cross_refs: string_array(obj, "cross_refs", &field)?,
            tech_stack: string_array(obj, "tech_stack", &field)?,
            api_surface: string_field(obj, "api_surface"),
        });
    }

    Ok(DeclaredMap { groups, contexts })
}

// =============================================================================
// Writing
// =============================================================================

fn json_array(items: &[String]) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    serde_json::to_string(items).ok()
}

/// Upsert a declaration into `dev_context_groups` / `dev_contexts`, stamping
/// every context it owns with `source = 'declared'`.
///
/// Matching is by NAME on both tables (case-folded through `group_key`, the
/// same normaliser the scan's own group resolution uses), so re-declaring is
/// idempotent and never mints a second copy of a context an operator has since
/// re-pointed at a different group.
///
/// What it deliberately does NOT do: delete derived contexts. A declaration
/// states what the project owns; it is not a mandate to erase the scan's
/// history. Only previously-DECLARED contexts absent from this declaration are
/// pruned, which is what makes an emptied declaration observable.
pub fn apply_declared_map(
    pool: &DbPool,
    project_id: &str,
    map: &DeclaredMap,
) -> Result<DeclarationSummary, AppError> {
    let mut summary = DeclarationSummary::default();

    // ---- groups -------------------------------------------------------------
    let existing_groups = repo::list_context_groups(pool, project_id)?;
    let mut group_ids: HashMap<String, String> = existing_groups
        .iter()
        .map(|g| (group_key(&g.name), g.id.clone()))
        .collect();

    for g in &map.groups {
        let key = group_key(&g.name);
        match group_ids.get(&key) {
            Some(id) => {
                repo::update_context_group(
                    pool,
                    id,
                    Some(&g.name),
                    g.color.as_deref(),
                    None,
                    None,
                    None,
                    None,
                    g.domain.as_deref().map(Some),
                )?;
            }
            None => {
                let created = repo::create_context_group(
                    pool,
                    project_id,
                    &g.name,
                    g.color.as_deref(),
                    None,
                    None,
                    g.domain.as_deref(),
                )?;
                group_ids.insert(key, created.id);
            }
        }
        summary.groups_upserted += 1;
    }

    // ---- contexts -----------------------------------------------------------
    let existing = repo::list_contexts_by_project(pool, project_id, None)?;
    let existing_by_name: HashMap<String, String> = existing
        .iter()
        .map(|c| (group_key(&c.name), c.id.clone()))
        .collect();
    let sources = repo::get_context_sources(pool, project_id)?;

    let mut declared_keys = Vec::with_capacity(map.contexts.len());
    for c in &map.contexts {
        let key = group_key(&c.name);
        declared_keys.push(key.clone());
        summary.files_declared += c.file_paths.len();

        let file_paths = serde_json::to_string(&c.file_paths)
            .map_err(|e| AppError::Internal(format!("serialize declared file_paths: {e}")))?;
        let group_id = c
            .group
            .as_deref()
            .and_then(|g| group_ids.get(&group_key(g)).cloned());

        let id = match existing_by_name.get(&key) {
            Some(id) => {
                repo::update_context(
                    pool,
                    id,
                    Some(&c.name),
                    Some(c.description.as_deref()),
                    Some(&file_paths),
                    Some(json_array(&c.entry_points).as_deref()),
                    Some(json_array(&c.db_tables).as_deref()),
                    Some(json_array(&c.keywords).as_deref()),
                    Some(c.api_surface.as_deref()),
                    Some(json_array(&c.cross_refs).as_deref()),
                    Some(json_array(&c.tech_stack).as_deref()),
                    Some(c.category.as_deref()),
                    Some(c.business_feature.as_deref()),
                )?;
                if let Some(gid) = group_id.as_deref() {
                    repo::move_context_to_group(pool, id, Some(gid))?;
                }
                id.clone()
            }
            None => {
                let created = repo::create_context(
                    pool,
                    project_id,
                    &c.name,
                    group_id.as_deref(),
                    c.description.as_deref(),
                    Some(&file_paths),
                    json_array(&c.entry_points).as_deref(),
                    json_array(&c.db_tables).as_deref(),
                    json_array(&c.keywords).as_deref(),
                    c.api_surface.as_deref(),
                    json_array(&c.cross_refs).as_deref(),
                    json_array(&c.tech_stack).as_deref(),
                    c.category.as_deref(),
                    c.business_feature.as_deref(),
                )?;
                created.id
            }
        };
        repo::set_context_source(pool, &id, Some(repo::CONTEXT_SOURCE_DECLARED))?;
        summary.contexts_upserted += 1;
    }

    for c in &existing {
        let is_declared_row = sources
            .get(&c.id)
            .is_some_and(|s| s == repo::CONTEXT_SOURCE_DECLARED);
        if is_declared_row
            && !declared_keys.contains(&group_key(&c.name))
            && repo::delete_context(pool, &c.id)?
        {
            summary.contexts_pruned += 1;
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;

    fn seed_project(pool: &DbPool, root: &str) -> String {
        repo::create_project(pool, "declared-demo", root, None, None, None, None, None)
            .expect("seed project")
            .id
    }

    /// A project's declaration: the export's shape PLUS the authority marker.
    const MINIMAL: &str = r#"{
        "version": 2,
        "declared": true,
        "groups": [{"id": "g1", "name": "Governance", "color": "amber", "domain": "data"}],
        "contexts": [
            {"name": "charter", "group": "Governance", "category": "config",
             "description": "The bank's written rules.",
             "file_paths": ["governance.yaml", "docs/charter.md"]}
        ]
    }"#;

    /// What the EXPORT writes — the same shape with no marker. Personas' own
    /// repository commits a file of exactly this kind, which is the case the
    /// marker exists to keep out of the read path.
    const EXPORTED: &str = r#"{
        "version": 2,
        "generator": "personas-context-scan",
        "groups": [{"id": "g1", "name": "Governance"}],
        "contexts": [{"name": "charter", "group": "Governance", "file_paths": ["a.md"]}]
    }"#;

    // ---- parsing ------------------------------------------------------------

    #[test]
    fn parses_the_export_shape() {
        let map = parse_declared_map(MINIMAL).expect("valid");
        assert_eq!(map.groups.len(), 1);
        assert_eq!(map.contexts.len(), 1);
        assert_eq!(map.contexts[0].file_paths.len(), 2);
        assert_eq!(map.contexts[0].group.as_deref(), Some("Governance"));
    }

    #[test]
    fn a_context_may_name_its_group_by_id() {
        let raw = r#"{"groups":[{"id":"g1","name":"Tooling"}],
                      "contexts":[{"name":"scripts","group_id":"g1"}]}"#;
        let map = parse_declared_map(raw).expect("valid");
        assert_eq!(map.contexts[0].group.as_deref(), Some("Tooling"));
    }

    #[test]
    fn zero_contexts_is_a_valid_declaration_of_emptiness() {
        let map = parse_declared_map(r#"{"contexts": []}"#).expect("valid");
        assert!(map.contexts.is_empty());
    }

    #[test]
    fn malformed_declarations_name_the_field() {
        let cases = [
            ("[]", "document"),
            ("{}", "contexts"),
            (r#"{"contexts": {}}"#, "contexts"),
            (r#"{"contexts": [{}]}"#, "contexts[0].name"),
            (
                r#"{"contexts":[{"name":"x","category":"integration"}]}"#,
                "contexts[0].category",
            ),
            (
                r#"{"contexts":[{"name":"x","file_paths":"docs/a.md"}]}"#,
                "contexts[0].file_paths",
            ),
            (
                r#"{"contexts":[{"name":"x","group":"Nope"}]}"#,
                "contexts[0].group",
            ),
            (
                r#"{"groups":[{"name":"G","domain":"ui"}],"contexts":[]}"#,
                "groups[0].domain",
            ),
            ("not json", "document"),
        ];
        for (raw, field) in cases {
            let err = parse_declared_map(raw).expect_err("must refuse");
            let msg = err.to_string();
            assert!(
                matches!(err, AppError::Validation(_)),
                "{raw} → not a Validation error: {msg}"
            );
            assert!(
                msg.contains(field),
                "{raw} → message must name {field}: {msg}"
            );
        }
    }

    // ---- authority ----------------------------------------------------------

    /// A git repo built by `git init`, so tracked and untracked are the real
    /// distinction and not a stand-in for one.
    fn git_repo(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("personas-decl-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        // Through the same one git door the production path uses. `git add`
        // prints nothing on success, so the `None` it returns is not a failure —
        // these calls are driven for their effect on the index.
        git(&dir, &["init"]);
        git(&dir, &["config", "user.email", "t@example.com"]);
        git(&dir, &["config", "user.name", "t"]);
        dir
    }

    fn git(dir: &std::path::Path, args: &[&str]) {
        let _ = super::super::context_map_export::git_capture(dir, args);
    }

    #[test]
    fn an_untracked_map_is_not_a_declaration() {
        let dir = git_repo("untracked");
        std::fs::write(dir.join(DECLARED_MAP_FILE), MINIMAL).expect("write");
        assert!(!is_declared_map(&dir));
        assert!(read_declared_map(&dir).expect("no error").is_none());
    }

    /// **The regression this marker exists to prevent.** Personas' own
    /// repository commits the file its export writes. Tracked-ness alone would
    /// make that file authoritative — silencing that repo's scan and refusing
    /// its export. Without the marker it stays exactly what it is: an artifact.
    #[test]
    fn a_tracked_export_artifact_is_not_a_declaration() {
        let dir = git_repo("tracked-export");
        std::fs::write(dir.join(DECLARED_MAP_FILE), EXPORTED).expect("write");
        git(&dir, &["add", DECLARED_MAP_FILE]);
        assert!(is_tracked(&dir), "the file IS committed");
        assert!(
            !is_declared_map(&dir),
            "…and committing it is still not a claim of authority"
        );
        assert!(read_declared_map(&dir).expect("no error").is_none());
    }

    /// A tracked file that is not even JSON must not be able to silence a scan
    /// either — a half-written export is a broken artifact, not a declaration.
    #[test]
    fn a_tracked_unparseable_map_is_ignored_rather_than_fatal() {
        let dir = git_repo("tracked-garbage");
        std::fs::write(dir.join(DECLARED_MAP_FILE), "{ nope").expect("write");
        git(&dir, &["add", DECLARED_MAP_FILE]);
        assert!(!is_declared_map(&dir));
        assert!(read_declared_map(&dir).expect("no error").is_none());
    }

    #[test]
    fn a_tracked_marked_map_is_authoritative_and_a_malformed_one_refuses() {
        let dir = git_repo("tracked");
        std::fs::write(dir.join(DECLARED_MAP_FILE), MINIMAL).expect("write");
        git(&dir, &["add", DECLARED_MAP_FILE]);
        assert!(is_declared_map(&dir));
        assert!(read_declared_map(&dir).expect("no error").is_some());

        // Still claiming authority, now unusable: a refusal, never a silent
        // fallback — the project said this file speaks for it.
        std::fs::write(
            dir.join(DECLARED_MAP_FILE),
            r#"{"declared": true, "contexts": {}}"#,
        )
        .expect("write");
        let err = read_declared_map(&dir).expect_err("must refuse");
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        assert!(err.to_string().contains("contexts"), "{err}");
    }

    #[test]
    fn a_missing_map_is_not_a_declaration() {
        let dir = git_repo("absent");
        assert!(!is_declared_map(&dir));
    }

    #[test]
    fn the_marker_must_be_exactly_true() {
        assert!(declares_authority(r#"{"declared": true, "contexts": []}"#));
        for raw in [
            r#"{"contexts": []}"#,
            r#"{"declared": false, "contexts": []}"#,
            r#"{"declared": "true", "contexts": []}"#,
            r#"{"declared": 1, "contexts": []}"#,
            "not json",
            "[]",
        ] {
            assert!(!declares_authority(raw), "{raw} must not claim authority");
        }
    }

    // ---- applying -----------------------------------------------------------

    #[test]
    fn applying_upserts_with_declared_provenance_and_is_idempotent() {
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool, "/tmp/declared-demo");
        let map = parse_declared_map(MINIMAL).expect("valid");

        let first = apply_declared_map(&pool, &project, &map).expect("apply");
        assert_eq!(first.groups_upserted, 1);
        assert_eq!(first.contexts_upserted, 1);
        assert_eq!(first.files_declared, 2);

        let contexts = repo::list_contexts_by_project(&pool, &project, None).expect("list");
        assert_eq!(contexts.len(), 1);
        assert_eq!(contexts[0].category.as_deref(), Some("config"));
        assert!(
            contexts[0].group_id.is_some(),
            "context landed in its group"
        );
        let sources = repo::get_context_sources(&pool, &project).expect("sources");
        assert_eq!(
            sources.get(&contexts[0].id).map(String::as_str),
            Some(repo::CONTEXT_SOURCE_DECLARED)
        );

        // Re-declaring the same map must not mint a second copy.
        apply_declared_map(&pool, &project, &map).expect("re-apply");
        assert_eq!(
            repo::list_contexts_by_project(&pool, &project, None)
                .expect("list")
                .len(),
            1
        );
    }

    /// End to end over a real `git init` tree: a committed, MARKED file is what
    /// makes a declaration, and the contexts it produces are stamped `declared`
    /// — the property every consumer downstream reads.
    #[test]
    fn a_committed_marked_map_becomes_declared_contexts() {
        let dir = git_repo("e2e");
        std::fs::write(dir.join(DECLARED_MAP_FILE), MINIMAL).expect("write");
        git(&dir, &["add", DECLARED_MAP_FILE]);

        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool, &dir.to_string_lossy());
        let declared = read_declared_map(&dir)
            .expect("read")
            .expect("a declaration");
        apply_declared_map(&pool, &project, &declared).expect("apply");

        let contexts = repo::list_contexts_by_project(&pool, &project, None).expect("list");
        assert_eq!(contexts.len(), 1, "the committed map is the map");
        assert_eq!(contexts[0].name, "charter");
        let sources = repo::get_context_sources(&pool, &project).expect("sources");
        assert_eq!(
            sources.get(&contexts[0].id).map(String::as_str),
            Some(repo::CONTEXT_SOURCE_DECLARED)
        );
    }

    #[test]
    fn an_emptied_declaration_prunes_declared_rows_but_never_derived_ones() {
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool, "/tmp/declared-empty");
        apply_declared_map(
            &pool,
            &project,
            &parse_declared_map(MINIMAL).expect("valid"),
        )
        .expect("apply");
        // A context the SCAN produced — no provenance stamp.
        repo::create_context(
            &pool,
            &project,
            "derived-one",
            None,
            None,
            Some("[\"src/a.rs\"]"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("derived context");

        let empty = parse_declared_map(r#"{"contexts": []}"#).expect("valid");
        let summary = apply_declared_map(&pool, &project, &empty).expect("apply empty");
        assert_eq!(summary.contexts_upserted, 0);
        assert_eq!(summary.contexts_pruned, 1);

        let left = repo::list_contexts_by_project(&pool, &project, None).expect("list");
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].name, "derived-one");
    }
}
