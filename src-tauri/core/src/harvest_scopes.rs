//! Harvest scopes — the TERRITORY layer of the practice-harvest engine.
//!
//! ## Why this exists
//!
//! The first harvest engine sent one agent at a whole repository with a
//! ~15-item cap and the instruction "prefer a small number of high-signal
//! practices over volume". On a large codebase that brief is satisfiable
//! without reading the codebase: the cheapest way to find "the repo's real
//! conventions" is to read the root config files and stop. A measured run on
//! this repository did exactly that — ~11 tool calls over 8,568 tracked files,
//! 14 items, every one of them from `eslint.config.js` / `lefthook.yml` /
//! `scripts/` / `build.rs`, and not one from the 236 mapped contexts of actual
//! feature code. The run was not failing; it was complying.
//!
//! A scope is the fix: a named, bounded territory with real paths, assigned to
//! ONE session. An agent that owns `Execution & Orchestration` cannot satisfy
//! its brief by reading `.eslintrc`, and a coverage row can say — per scope —
//! whether the territory has ever been read. Volume then becomes a *reported*
//! property instead of an unmeasured one.
//!
//! ## Derivation
//!
//! 1. `context-map.json` (Personas' own context scan) when present: one scope
//!    per GROUP. Groups are the right granularity — a group is a few hundred
//!    files, which one session can genuinely read; the 236 individual contexts
//!    would be 236 sessions.
//! 2. Otherwise a generic walk: group files by their first two path segments,
//!    keep the largest, and lump the tail. Member repos are arbitrary projects,
//!    so the fallback may never assume a Personas-shaped layout.
//!
//! Either way `repo-global` is always emitted: root configs, CI, hooks and
//! scripts are a legitimate territory — they are simply not the WHOLE repo,
//! which is the mistake this module exists to prevent.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use walkdir::WalkDir;

/// Directories that are never anyone's territory.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    "coverage",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".turbo",
    ".cache",
    "gen",
];

/// Walk ceiling. A pathological repo must not turn `prepare` into a full-disk
/// crawl; the scope shape is stable long before this many files.
const MAX_WALK_FILES: usize = 40_000;

/// Most scopes we will ever emit from the generic fallback (plus `repo-global`
/// and `other`). More than this and the fan-out costs more than it discovers.
const MAX_FALLBACK_SCOPES: usize = 12;

/// A scope small enough to be noise on its own gets folded into `other`.
const MIN_FALLBACK_SCOPE_FILES: usize = 8;

/// Source extensions that count toward a scope's weight. Lockfiles, images and
/// snapshots inflate a directory without giving an agent anything to read.
const SOURCE_EXTS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "rb", "php", "cs",
    "swift", "c", "h", "cpp", "hpp", "sql", "vue", "svelte", "toml", "yaml", "yml",
];

/// One assignable territory. Serialized straight into `snapshot.json`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HarvestScope {
    /// Stable slug — the dedup key for dispatch and the coverage primary key.
    /// Stable across runs so coverage survives a re-scan.
    pub id: String,
    pub label: String,
    /// `group` (from the context map) | `directory` (generic walk) | `global`.
    pub kind: &'static str,
    /// Where the agent should read. Directory prefixes, not a file list — a
    /// 587-entry file list in the prompt would cost more than it informs.
    pub paths: Vec<String>,
    /// Weight, for ordering the fan-out and for honest coverage reporting.
    pub file_count: usize,
    /// Context names inside this group, when the context map supplied them —
    /// the agent's index into its own territory.
    pub contexts: Vec<String>,
}

/// The always-present tooling scope. Emitted first because it is the cheapest
/// to harvest and the most likely to already be covered.
fn global_scope(root: &Path) -> HarvestScope {
    const CANDIDATES: &[&str] = &[
        "package.json",
        "Cargo.toml",
        "eslint.config.js",
        ".eslintrc.js",
        ".eslintrc.json",
        "lefthook.yml",
        ".pre-commit-config.yaml",
        "tsconfig.json",
        "vite.config.ts",
        "Makefile",
        "justfile",
        "Dockerfile",
        "docker-compose.yml",
        ".github",
        ".gitlab-ci.yml",
        "scripts",
        "CLAUDE.md",
        "CONTRIBUTING.md",
    ];
    let paths: Vec<String> = CANDIDATES
        .iter()
        .filter(|c| root.join(c).exists())
        .map(|c| (*c).to_string())
        .collect();
    HarvestScope {
        id: "repo-global".into(),
        label: "Repo-wide tooling, gates and conventions".into(),
        kind: "global",
        file_count: paths.len(),
        paths,
        contexts: Vec::new(),
    }
}

/// Slugify a group/directory name into a stable scope id.
fn slug(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "scope".into()
    } else {
        out
    }
}

/// Collapse a group's file list to the directory prefixes worth naming. Two
/// segments is the sweet spot: `src/features` is useless (everything is there),
/// `src/features/agents/editor/panels` is noise.
fn dir_prefixes(files: &[String], depth: usize, max: usize) -> Vec<String> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for f in files {
        let norm = f.replace('\\', "/");
        let segs: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
        if segs.len() <= 1 {
            continue;
        }
        let take = depth.min(segs.len() - 1);
        *counts.entry(segs[..take].join("/")).or_default() += 1;
    }
    let mut v: Vec<(String, usize)> = counts.into_iter().collect();
    // Biggest first, then lexical so the output is deterministic.
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.into_iter().take(max).map(|(p, _)| p).collect()
}

/// One context row, normalized across both context-map schema versions.
struct MappedContext {
    group: String,
    name: String,
    files: Vec<String>,
}

/// Read contexts out of either context-map schema.
///
/// **v1** (`generator` absent, pre-2026-07-30) nested contexts inside groups and
/// used camelCase: `groups[].contexts[].filePaths`.
///
/// **v2** (`generator: personas-context-scan`, `version: 2`) flattens contexts to
/// the top level in snake_case — `contexts[].file_paths` — with `groups[]`
/// reduced to metadata and the owning group named on each context (`group`).
///
/// Both are read because a checkout can hold either: the map is git-tracked and
/// only rewritten when a scan runs, so a repo that has not rescanned since the
/// generator changed still carries v1. Silently returning no scopes for v1 would
/// drop every group territory and fall back to the generic directory walk —
/// which is exactly what happened on 2026-07-30 when the first v2 map landed.
fn read_mapped_contexts(map: &serde_json::Value) -> Vec<MappedContext> {
    let str_list = |v: Option<&serde_json::Value>| -> Vec<String> {
        v.and_then(|x| x.as_array())
            .into_iter()
            .flatten()
            .filter_map(|p| p.as_str().map(str::to_string))
            .collect()
    };

    // v2: flat `contexts[]`, each naming its group.
    if let Some(flat) = map.get("contexts").and_then(|v| v.as_array()) {
        if !flat.is_empty() {
            return flat
                .iter()
                .map(|c| MappedContext {
                    group: c
                        .get("group")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Ungrouped")
                        .to_string(),
                    name: c.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    files: str_list(c.get("file_paths")),
                })
                .collect();
        }
    }

    // v1: contexts nested under groups.
    map.get("groups")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .flat_map(|g| {
            let group = g.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            g.get("contexts")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .map(move |c| MappedContext {
                    group: group.clone(),
                    name: c.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    files: str_list(c.get("filePaths")),
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Scopes from Personas' own context map: one per group.
fn scopes_from_context_map(raw: &str) -> Option<Vec<HarvestScope>> {
    let map: serde_json::Value = serde_json::from_str(raw).ok()?;
    let mapped = read_mapped_contexts(&map);
    if mapped.is_empty() {
        return None;
    }
    // Group the normalized contexts by their owning group name.
    let mut by_group: std::collections::BTreeMap<String, (Vec<String>, Vec<String>)> =
        std::collections::BTreeMap::new();
    for c in mapped {
        if c.group.is_empty() {
            continue;
        }
        let e = by_group.entry(c.group).or_default();
        if !c.name.is_empty() {
            e.1.push(c.name);
        }
        e.0.extend(c.files);
    }

    let mut out = Vec::new();
    for (label, (files, names)) in by_group {
        if files.is_empty() {
            continue;
        }
        out.push(HarvestScope {
            id: format!("group:{}", slug(&label)),
            label: label.clone(),
            kind: "group",
            paths: dir_prefixes(&files, 3, 12),
            file_count: files.len(),
            contexts: names,
        });
    }
    if out.is_empty() {
        None
    } else {
        // Largest territory first: the fan-out wave should start where the
        // unread surface is biggest, not alphabetically.
        out.sort_by(|a, b| b.file_count.cmp(&a.file_count).then(a.id.cmp(&b.id)));
        Some(out)
    }
}

/// Generic fallback for repos with no context map — group by the first two
/// path segments. Never assumes a Personas-shaped layout.
fn scopes_from_walk(root: &Path) -> Vec<HarvestScope> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut seen = 0usize;
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            !e.file_type().is_dir()
                || !e
                    .file_name()
                    .to_str()
                    .map(|n| SKIP_DIRS.contains(&n) || n.starts_with('.') && n != "." )
                    .unwrap_or(false)
        })
        .filter_map(Result::ok)
    {
        if seen >= MAX_WALK_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let ext_ok = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| SOURCE_EXTS.contains(&e))
            .unwrap_or(false);
        if !ext_ok {
            continue;
        }
        seen += 1;
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let norm = rel.to_string_lossy().replace('\\', "/");
        let segs: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
        // Root-level files belong to repo-global, not to a territory.
        if segs.len() <= 1 {
            continue;
        }
        let take = 2.min(segs.len() - 1);
        *counts.entry(segs[..take].join("/")).or_default() += 1;
    }

    let mut v: Vec<(String, usize)> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let mut out = Vec::new();
    let mut tail_files = 0usize;
    let mut tail_paths: Vec<String> = Vec::new();
    for (path, n) in v {
        if out.len() < MAX_FALLBACK_SCOPES && n >= MIN_FALLBACK_SCOPE_FILES {
            out.push(HarvestScope {
                id: format!("dir:{}", slug(&path)),
                label: path.clone(),
                kind: "directory",
                paths: vec![path],
                file_count: n,
                contexts: Vec::new(),
            });
        } else {
            tail_files += n;
            if tail_paths.len() < 12 {
                tail_paths.push(path);
            }
        }
    }
    // The tail is named, not dropped: an unnamed remainder is exactly the
    // blind spot this module exists to remove.
    if tail_files > 0 {
        out.push(HarvestScope {
            id: "dir:other".into(),
            label: "Everything else".into(),
            kind: "directory",
            paths: tail_paths,
            file_count: tail_files,
            contexts: Vec::new(),
        });
    }
    out
}

/// Derive the assignable territories for a repo. Always returns at least
/// `repo-global`, so dispatch never has an empty plan.
pub fn derive_scopes(root: &Path) -> Vec<HarvestScope> {
    let mut scopes = vec![global_scope(root)];
    let mapped = std::fs::read_to_string(root.join("context-map.json"))
        .ok()
        .and_then(|raw| scopes_from_context_map(&raw));
    match mapped {
        Some(mut s) => scopes.append(&mut s),
        None => scopes.append(&mut scopes_from_walk(root)),
    }
    scopes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_stable_and_id_safe() {
        assert_eq!(slug("Core Libraries & State"), "core-libraries-state");
        assert_eq!(slug("Backend Engine & Runtime"), "backend-engine-runtime");
        assert_eq!(slug("src-tauri/src"), "src-tauri-src");
        assert_eq!(slug("!!!"), "scope");
    }

    #[test]
    fn context_map_yields_one_scope_per_group_largest_first() {
        let raw = r#"{"groups":[
            {"name":"Small Group","contexts":[
                {"name":"a","filePaths":["src/a/one.ts","src/a/two.ts"]}
            ]},
            {"name":"Big Group","contexts":[
                {"name":"b","filePaths":["src/b/one.ts","src/b/two.ts","src/b/three.ts"]},
                {"name":"c","filePaths":["src-tauri/src/c/x.rs"]}
            ]}
        ]}"#;
        let s = scopes_from_context_map(raw).expect("scopes");
        assert_eq!(s.len(), 2);
        // Largest territory leads the fan-out.
        assert_eq!(s[0].id, "group:big-group");
        assert_eq!(s[0].file_count, 4);
        assert_eq!(s[0].contexts, vec!["b".to_string(), "c".to_string()]);
        assert_eq!(s[1].id, "group:small-group");
        // Paths are directory prefixes, never the raw file list.
        assert!(s[0].paths.iter().all(|p| !p.ends_with(".ts")));
    }

    /// The v2 map (generator `personas-context-scan`, 2026-07-30 onward) flattens
    /// contexts to the top level in snake_case. Reading only the v1 shape made
    /// `scopes_from_context_map` return None the moment a repo rescanned, which
    /// silently dropped every group territory and fell back to the directory
    /// walk — orphaning the harvest-coverage rows keyed on `group:<slug>`.
    #[test]
    fn reads_the_v2_flat_schema_and_groups_by_group_name() {
        let raw = r#"{
            "version": 2,
            "generator": "personas-context-scan",
            "groups": [
                {"id":"g1","name":"Agent Platform","domain":"feature","context_count":2},
                {"id":"g2","name":"Execution Engine","domain":"feature","context_count":1}
            ],
            "contexts": [
                {"name":"ai-director","group":"Agent Platform","file_paths":["src/a/one.ts","src/a/two.ts"]},
                {"name":"lab","group":"Agent Platform","file_paths":["src/b/three.ts"]},
                {"name":"runner","group":"Execution Engine","file_paths":["src-tauri/src/r/x.rs"]}
            ]
        }"#;
        let s = scopes_from_context_map(raw).expect("v2 map must yield scopes");
        assert_eq!(s.len(), 2, "one scope per group, not per context");
        let agent = s.iter().find(|x| x.id == "group:agent-platform").expect("agent platform");
        assert_eq!(agent.file_count, 3, "files summed across the group's contexts");
        assert_eq!(agent.contexts, vec!["ai-director".to_string(), "lab".to_string()]);
        // Largest territory still leads the fan-out.
        assert_eq!(s[0].id, "group:agent-platform");
    }

    /// v1 must keep working: a repo that has not rescanned since the generator
    /// changed still carries the nested camelCase shape on disk.
    #[test]
    fn still_reads_the_v1_nested_schema() {
        let raw = r#"{"groups":[
            {"name":"Legacy Group","contexts":[
                {"name":"old","filePaths":["src/legacy/a.ts","src/legacy/b.ts"]}
            ]}
        ]}"#;
        let s = scopes_from_context_map(raw).expect("v1 map must still yield scopes");
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].id, "group:legacy-group");
        assert_eq!(s[0].file_count, 2);
    }

    #[test]
    fn context_map_group_with_no_files_is_not_a_scope() {
        let raw = r#"{"groups":[{"name":"Empty","contexts":[{"name":"a","filePaths":[]}]}]}"#;
        assert!(scopes_from_context_map(raw).is_none());
    }

    #[test]
    fn malformed_context_map_falls_through_to_none() {
        assert!(scopes_from_context_map("not json").is_none());
        assert!(scopes_from_context_map(r#"{"nope":1}"#).is_none());
    }

    #[test]
    fn dir_prefixes_rank_by_weight_and_dedup() {
        let files: Vec<String> = vec![
            "src/features/a.ts".into(),
            "src/features/b.ts".into(),
            "src/lib/c.ts".into(),
        ];
        let p = dir_prefixes(&files, 2, 10);
        assert_eq!(p, vec!["src/features".to_string(), "src/lib".to_string()]);
    }

    /// Guards the actual regression: a repo the size of this one must produce
    /// MANY territories, so no single session can claim the whole codebase.
    #[test]
    fn a_large_context_map_produces_many_bounded_scopes() {
        let mut groups = String::from("[");
        for g in 0..12 {
            let files: Vec<String> = (0..40)
                .map(|f| format!("\"src/area{g}/mod{f}/file.ts\""))
                .collect();
            groups.push_str(&format!(
                "{{\"name\":\"Group {g}\",\"contexts\":[{{\"name\":\"c{g}\",\"filePaths\":[{}]}}]}},",
                files.join(",")
            ));
        }
        groups.pop();
        groups.push(']');
        let raw = format!("{{\"groups\":{groups}}}");
        let s = scopes_from_context_map(&raw).expect("scopes");
        assert_eq!(s.len(), 12);
        assert!(s.iter().all(|x| x.file_count == 40));
        // Ids are unique — they are the coverage primary key.
        let ids: std::collections::HashSet<&str> = s.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids.len(), 12);
    }

    #[test]
    fn derive_always_emits_global_even_for_an_empty_dir() {
        let dir = std::env::temp_dir().join(format!("harvest-scope-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = derive_scopes(&dir);
        assert_eq!(s[0].id, "repo-global");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
