//! Project × registry coverage read model (docs/plans/registry-coverage-ui.md R1).
//!
//! **Everything here is a READER.** It parses the registry working copy
//! (`registry.yaml`, `catalog.json`, `librarian/projects.md`, git metadata) and
//! each managed project's consumer-side artifacts (`.ai/registry-map.json`,
//! `.personas/skill-registry.json`) and derives one `RegistryCoverage` document
//! per call. Nothing is written, nothing is ingested into SQLite — coverage is a
//! derived view (plan D2), and persisting it would create a second authority
//! that drifts.
//!
//! **Tolerance is the contract** (same posture as `hierarchy_read`): a missing
//! or malformed input becomes a `warnings` entry and the rest of the document
//! still computes. Only a genuine inability to look at all — a blank root — is
//! an `Err`. A root that is not a registry returns an honest empty whose
//! `source.reason` says why.
//!
//! **Absence is representable, never defaulted** (plan D2, the adherence
//! lesson): every field a signal can be missing from is an `Option`, and a debt
//! is only derived from evidence. The two debts that ARE about missing signal —
//! `not-in-registry` and `never-mapped` — are the deliberate exceptions.
//!
//! ## The YAML subset
//!
//! `registry.yaml` is parsed with a hand-rolled minimal reader (top-level
//! scalars + the names of the two-space-indented keys under `lanes:`), the same
//! no-yaml-crate decision `hierarchy_read`'s frontmatter parser made. Unknown
//! structure is ignored, exactly as the registry's own header demands of a
//! reader.
//!
//! ## "Forged from" is a substring check — documented as such
//!
//! `librarian/projects.md` is prose-adjacent (plan risk §3): the table rows are
//! the contract, the lineage sentence is free text. Detection is a
//! case-insensitive substring match for `forged from it` / `bundle was forged`
//! in the row's prose cell. That is deliberately dumb and deliberately visible:
//! if the registry later grows a structured projects file, this function is the
//! one that swaps.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The lanes whose last-commit dates form the registry-side staleness clock.
/// A registry may publish more (usage, signals, librarian); these four are the
/// ones a *project* consumes, so they are the clock that matters for coverage.
const CLOCK_LANES: [&str; 4] = ["knowledge", "skills", "practices", "memory"];

/// Consumer-side artifact: the knowledge join (`build-registry-map.mjs` output).
const REGISTRY_MAP_REL: &str = ".ai/registry-map.json";
/// Consumer-side artifact: this app's exported skill inventory.
const SKILL_REGISTRY_REL: &str = ".personas/skill-registry.json";

// ---------------------------------------------------------------------------
// Debt kinds — the string enum, documented once, spelled nowhere else
// ---------------------------------------------------------------------------

/// The project does not appear in `librarian/projects.md` (nor as any skill's
/// adopter). The no-signal debt for presence; when it fires, no other debt is
/// derived for the tile — everything downstream of presence is moot.
const DEBT_NOT_IN_REGISTRY: &str = "not-in-registry";
/// The project is in the registry but carries no `.ai/registry-map.json` —
/// the knowledge join has never been computed. The no-signal debt for the
/// applied dimension.
const DEBT_NEVER_MAPPED: &str = "never-mapped";
/// The registry map exists but was computed against bundle digests that have
/// since moved, or is older than the knowledge lane's last commit.
const DEBT_MAP_STALE: &str = "map-stale";
/// N adopted skills sit behind the lane version.
const DEBT_SKILLS_BEHIND: &str = "skills-behind";
/// The registry map carries pairs still in state `unknown` — matched, never
/// judged.
const DEBT_UNKNOWN_PAIRS: &str = "unknown-pairs";
/// Reserved for registry-only entries (a registry slug matching no managed
/// project). Defined here so the vocabulary has one home; the Rust side never
/// attaches it to a tile — the frontend renders it on `registryOnly` rows.
#[allow(dead_code)]
const DEBT_NAME_UNMATCHED: &str = "name-unmatched";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// One managed project, as the frontend knows it. The Rust side never reaches
/// into `dev_projects` for this command — the caller owns which projects are
/// on the board (and the DB joins for extraction happen frontend-side).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CoverageProjectIn {
    pub id: String,
    pub name: String,
    /// Absolute path of the project checkout on this machine. May be blank —
    /// that is a representable absence, not an error.
    pub root_path: String,
}

/// Result of asking "is this folder a registry?" — `valid: false` + `reason`
/// for a mere non-registry folder, never an `Err`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RegistryProbe {
    pub valid: bool,
    /// `name:` from `registry.yaml`.
    pub name: Option<String>,
    /// `registry.fullName` from `catalog.json` (e.g. `xkazm04/ai-registry`).
    pub full_name: Option<String>,
    /// Lane names declared under `lanes:` in `registry.yaml`.
    pub lanes: Vec<String>,
    /// Bundle names from `catalog.json` (`bundles[].name`).
    pub domains: Vec<String>,
    /// Short HEAD sha of the working copy, when git can read it.
    pub head_sha: Option<String>,
    /// Uncommitted changes present. A live working copy being dirty is normal
    /// and reported, never refused (plan risk §3).
    pub dirty: bool,
    /// Why `valid` is false. `None` when valid.
    pub reason: Option<String>,
}

/// Last commit touching one lane's directory. `None` when git could not answer
/// or the lane has no history — absence, not "fresh".
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LaneDate {
    pub lane: String,
    /// ISO-8601 committer date (`git log -1 --format=%cI`).
    pub last_commit: Option<String>,
}

/// One adopted skill, joined against the lane's current version.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillAdoption {
    pub skill: String,
    /// Version the adopter string pins. `None` for a `link` install — a link
    /// is live against the lane, there is no pinned copy to be behind.
    pub adopted_version: Option<String>,
    /// The lane's current version of the skill.
    pub lane_version: String,
    /// `link` | `plugin` | `pinned` — parsed from `<slug>@<rest>`.
    pub mechanism: String,
    /// True when a pinned/plugin version differs from the lane version.
    pub behind: bool,
}

/// The project's `.ai/registry-map.json`, summarised. `exists: false` (all
/// counts zero) when the project root is readable but the file is absent.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RegistryMapState {
    pub exists: bool,
    /// File mtime, ISO-8601. `None` when absent or unreadable.
    pub mtime: Option<String>,
    pub conformant: u32,
    pub deviation: u32,
    pub not_applicable: u32,
    pub unknown: u32,
    /// True when any bundle digest recorded in the map differs from the
    /// catalog's current `contentHash` for that domain — the map was judged
    /// against a bundle that has since moved.
    pub digest_stale: bool,
}

/// Dimension (a): is the project in the registry at all.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CoveragePresence {
    pub in_registry: bool,
    /// Domains the `librarian/projects.md` row relates the project to.
    pub domains: Vec<String>,
    /// The row's prose claims a bundle was forged from this project.
    /// **Substring check** — see the module docs.
    pub forged_from: bool,
}

/// Dimension (c): what the registry's artifacts are applied into the project.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CoverageApplied {
    pub skills_adopted: u32,
    pub skills_behind: u32,
    pub skills_detail: Vec<SkillAdoption>,
    /// `None` when the project's root path is blank or unreadable — no
    /// filesystem signal at all, as opposed to "looked and found nothing".
    pub registry_map: Option<RegistryMapState>,
}

/// Dimension (d): the two clocks, side by side. Both optional — a clock with
/// no signal renders as "no signal", never as a time.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CoverageStaleness {
    /// Max of the consumer-side artifact mtimes (registry-map,
    /// skill-registry). The frontend joins DB clocks (harvest, adoption) on
    /// top — Rust carries only the filesystem half.
    pub project_last_action: Option<String>,
    /// Max per-lane last-commit date — when the registry last moved.
    pub registry_last_move: Option<String>,
}

/// One derived debt. `kind` is one of the `DEBT_*` constants above; `detail`
/// is human-readable evidence.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CoverageDebt {
    pub kind: String,
    pub detail: String,
}

/// One project's coverage tile.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CoverageTile {
    pub project_id: String,
    pub project_name: String,
    /// The registry slug the project matched, when it matched one (plan D3
    /// normalization — no fuzzy matching).
    pub slug: Option<String>,
    pub presence: CoveragePresence,
    /// Always `null` from Rust. Dimension (b) — extraction — joins app-DB
    /// state (`workspace_harvest_coverage`) on the frontend; the registry half
    /// of extraction is `presence.forged_from`. The field exists so the wire
    /// shape names all four dimensions.
    pub extraction: Option<()>,
    pub applied: CoverageApplied,
    pub staleness: CoverageStaleness,
    pub debts: Vec<CoverageDebt>,
}

/// A registry project slug no managed project matched (plan D3: rendered, not
/// guessed away).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RegistryOnlyProject {
    pub slug: String,
    pub domains: Vec<String>,
}

/// Where the coverage came from — `present: false` + `reason` when the root is
/// not a registry, so an empty grid is explainable rather than mysterious.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CoverageSource {
    pub present: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RegistryCoverage {
    /// `name:` from `registry.yaml`.
    pub registry_name: Option<String>,
    pub head_sha: Option<String>,
    pub dirty: bool,
    /// `generatedAt` from `catalog.json`.
    pub generated_at: Option<String>,
    pub lane_dates: Vec<LaneDate>,
    pub tiles: Vec<CoverageTile>,
    pub registry_only: Vec<RegistryOnlyProject>,
    pub warnings: Vec<String>,
    pub source: CoverageSource,
}

impl RegistryCoverage {
    /// The honest empty state: no tiles, and a `source` that says why.
    fn empty(reason: String) -> Self {
        Self {
            registry_name: None,
            head_sha: None,
            dirty: false,
            generated_at: None,
            lane_dates: Vec::new(),
            tiles: Vec::new(),
            registry_only: Vec::new(),
            warnings: Vec::new(),
            source: CoverageSource {
                present: false,
                reason: Some(reason),
            },
        }
    }
}

// ---------------------------------------------------------------------------
// registry.yaml — minimal hand-rolled subset
// ---------------------------------------------------------------------------

/// What this reader takes from `registry.yaml`: the top-level `name:` scalar
/// and the lane names declared under `lanes:`. Everything else is ignored, as
/// the file's own compatibility guarantee requires of a reader.
#[derive(Debug, Default, PartialEq, Eq)]
struct RegistryYaml {
    name: Option<String>,
    lanes: Vec<String>,
}

/// Strip a trailing ` # comment` (whitespace before the `#` required, same
/// rule as the frontmatter parser's).
fn strip_comment(s: &str) -> &str {
    let bytes = s.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if *b != b'#' || i == 0 {
            continue;
        }
        let mut start = i;
        while start > 0 && bytes[start - 1].is_ascii_whitespace() {
            start -= 1;
        }
        if start < i {
            return &s[..start];
        }
    }
    s
}

fn parse_registry_yaml(raw: &str) -> RegistryYaml {
    let mut out = RegistryYaml::default();
    let mut in_lanes = false;
    for line in raw.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.trim_start().starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if indent == 0 {
            // A new top-level key closes the lanes block.
            in_lanes = line.trim_end() == "lanes:";
            if in_lanes {
                continue;
            }
            if let Some(rest) = line.strip_prefix("name:") {
                let v = strip_comment(rest).trim();
                if !v.is_empty() {
                    out.name = Some(v.trim_matches('"').trim_matches('\'').to_string());
                }
            }
            continue;
        }
        if !in_lanes || indent != 2 {
            // Only DIRECT children of `lanes:` are lane names; deeper keys
            // (`path:`, `resolution:` …) are lane properties, not lanes.
            continue;
        }
        let body = line.trim();
        if let Some(key) = body.strip_suffix(':') {
            if !key.is_empty()
                && key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            {
                out.lanes.push(key.to_string());
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// catalog.json — defensive Value walk
// ---------------------------------------------------------------------------

/// One skill row from `catalog.json`, reduced to what coverage needs.
#[derive(Debug, Clone)]
struct CatalogSkill {
    name: String,
    version: String,
    /// Raw adopter strings, e.g. `personas@plugin:1.0.0`, `pof@1.7`, `x@link`.
    adopters: Vec<String>,
}

#[derive(Debug, Default)]
struct Catalog {
    generated_at: Option<String>,
    full_name: Option<String>,
    skills: Vec<CatalogSkill>,
    /// bundle name → contentHash (when present).
    bundle_hashes: BTreeMap<String, String>,
}

fn parse_catalog(raw: &str) -> Result<Catalog, String> {
    let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let mut out = Catalog {
        generated_at: v
            .get("generatedAt")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        full_name: v
            .pointer("/registry/fullName")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        ..Catalog::default()
    };
    for s in v
        .get("skills")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
    {
        let Some(name) = s.get("name").and_then(|x| x.as_str()) else {
            continue; // a nameless skill row cannot be joined against anything
        };
        out.skills.push(CatalogSkill {
            name: name.to_string(),
            version: s
                .get("version")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            adopters: s
                .get("adopters")
                .and_then(|x| x.as_array())
                .into_iter()
                .flatten()
                .filter_map(|a| a.as_str().map(|s| s.to_string()))
                .collect(),
        });
    }
    for b in v
        .get("bundles")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
    {
        if let (Some(name), Some(hash)) = (
            b.get("name").and_then(|x| x.as_str()),
            b.get("contentHash").and_then(|x| x.as_str()),
        ) {
            out.bundle_hashes.insert(name.to_string(), hash.to_string());
        }
    }
    Ok(out)
}

/// Parse one adopter string `<slug>@<rest>` where `rest` is a version, the
/// literal `link`, or `plugin:<version>`. Returns
/// `(slug, mechanism, adopted_version)`; `None` for a string with no `@`.
fn parse_adopter(s: &str) -> Option<(String, String, Option<String>)> {
    let (slug, rest) = s.split_once('@')?;
    if slug.is_empty() || rest.is_empty() {
        return None;
    }
    let (mechanism, version) = if rest == "link" {
        // A link is live against the lane — there is no pinned copy to drift.
        ("link".to_string(), None)
    } else if let Some(v) = rest.strip_prefix("plugin:") {
        ("plugin".to_string(), Some(v.to_string()))
    } else {
        ("pinned".to_string(), Some(rest.to_string()))
    };
    Some((slug.to_string(), mechanism, version))
}

// ---------------------------------------------------------------------------
// librarian/projects.md — the table rows
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct RegistryProjectRow {
    slug: String,
    domains: Vec<String>,
    forged_from: bool,
}

/// Backtick-wrapped tokens in a cell (`` `recruiting`, `software-engineering` ``).
fn backticked(cell: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = cell;
    while let Some(open) = rest.find('`') {
        let tail = &rest[open + 1..];
        let Some(close) = tail.find('`') else { break };
        let token = tail[..close].trim();
        if !token.is_empty() {
            out.push(token.to_string());
        }
        rest = &tail[close + 1..];
    }
    out
}

/// Parse the markdown table in `librarian/projects.md`. Rows are the contract;
/// header and separator rows are skipped; a row with fewer than three cells is
/// tolerated (missing cells read as empty).
fn parse_projects_md(raw: &str) -> Vec<RegistryProjectRow> {
    let mut out = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('|') {
            continue;
        }
        let cells: Vec<&str> = trimmed
            .trim_matches('|')
            .split('|')
            .map(|c| c.trim())
            .collect();
        let first = cells.first().copied().unwrap_or("");
        // Header ("Project") and separator ("---") rows are structure.
        if first.is_empty()
            || first.eq_ignore_ascii_case("project")
            || first.chars().all(|c| c == '-' || c == ':' || c == ' ')
        {
            continue;
        }
        let slug = first.trim_matches('`').trim().to_string();
        if slug.is_empty() {
            continue;
        }
        let domains = backticked(cells.get(1).copied().unwrap_or(""));
        // Substring check, documented in the module docs. `forged from it`
        // deliberately requires the `it` so "Not yet forged from" stays false.
        let prose = cells.get(2).copied().unwrap_or("").to_lowercase();
        let forged_from = prose.contains("forged from it") || prose.contains("bundle was forged");
        out.push(RegistryProjectRow {
            slug,
            domains,
            forged_from,
        });
    }
    out
}

// ---------------------------------------------------------------------------
// Git — CLI, read-only
// ---------------------------------------------------------------------------

/// Run a git subcommand in `dir`. `None` when git is unavailable or the
/// command failed — the caller records a warning and carries on; coverage
/// without git metadata is degraded, not broken.
fn git_read(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git_head_short(dir: &Path) -> Option<String> {
    git_read(dir, &["rev-parse", "--short", "HEAD"]).filter(|s| !s.is_empty())
}

fn git_dirty(dir: &Path) -> Option<bool> {
    git_read(dir, &["status", "--porcelain"]).map(|s| !s.is_empty())
}

fn git_lane_date(dir: &Path, lane: &str) -> Option<String> {
    git_read(
        dir,
        &["log", "-1", "--format=%cI", "--", &format!("{lane}/")],
    )
    .filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// Consumer-side artifacts
// ---------------------------------------------------------------------------

fn mtime_iso(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339())
}

/// Read and summarise a project's `.ai/registry-map.json`.
///
/// The observed shape (`rkb-registry-map/1`, from
/// `ai-registry/scripts/build-registry-map.mjs`): `bundleDigests` maps
/// domain → digest-or-null, `contexts[]` rows each carry `subjects[]` pairs
/// whose `state` is `unknown | conformant | deviation | not-applicable`.
/// Parsed defensively — every field individually optional, unrecognised
/// states counted as `unknown` (unjudged is the honest bucket for a state
/// this reader does not know).
fn read_registry_map(
    project_root: &Path,
    bundle_hashes: &BTreeMap<String, String>,
    warnings: &mut Vec<String>,
    project_name: &str,
) -> RegistryMapState {
    let path = project_root.join(REGISTRY_MAP_REL);
    if !path.is_file() {
        return RegistryMapState {
            exists: false,
            mtime: None,
            conformant: 0,
            deviation: 0,
            not_applicable: 0,
            unknown: 0,
            digest_stale: false,
        };
    }
    let mtime = mtime_iso(&path);
    let parsed: Option<serde_json::Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let Some(v) = parsed else {
        warnings.push(format!(
            "{project_name}: {REGISTRY_MAP_REL} exists but could not be parsed — pair states read as absent"
        ));
        return RegistryMapState {
            exists: true,
            mtime,
            conformant: 0,
            deviation: 0,
            not_applicable: 0,
            unknown: 0,
            digest_stale: false,
        };
    };

    let (mut conformant, mut deviation, mut not_applicable, mut unknown) = (0u32, 0u32, 0u32, 0u32);
    for row in v
        .get("contexts")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
    {
        for pair in row
            .get("subjects")
            .and_then(|x| x.as_array())
            .into_iter()
            .flatten()
        {
            match pair
                .get("state")
                .and_then(|x| x.as_str())
                .unwrap_or("unknown")
            {
                "conformant" => conformant += 1,
                "deviation" => deviation += 1,
                "not-applicable" => not_applicable += 1,
                _ => unknown += 1,
            }
        }
    }

    // Digest staleness: any recorded digest that differs from the catalog's
    // current hash for the same domain. A `null` recorded digest (the map was
    // built before the bundle had one) is NOT evidence of staleness — no
    // signal produces no debt.
    let mut digest_stale = false;
    if let Some(digests) = v.get("bundleDigests").and_then(|x| x.as_object()) {
        for (domain, recorded) in digests {
            let (Some(recorded), Some(current)) = (recorded.as_str(), bundle_hashes.get(domain))
            else {
                continue;
            };
            if recorded != current.as_str() {
                digest_stale = true;
            }
        }
    }

    RegistryMapState {
        exists: true,
        mtime,
        conformant,
        deviation,
        not_applicable,
        unknown,
        digest_stale,
    }
}

// ---------------------------------------------------------------------------
// Slug matching (plan D3 — normalization only, no fuzz)
// ---------------------------------------------------------------------------

fn normalize_slug(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c == ' ' || c == '_' { '-' } else { c })
        .collect()
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

fn probe_registry_root(path: &str) -> RegistryProbe {
    let invalid = |reason: String| RegistryProbe {
        valid: false,
        name: None,
        full_name: None,
        lanes: Vec::new(),
        domains: Vec::new(),
        head_sha: None,
        dirty: false,
        reason: Some(reason),
    };

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return invalid("No folder was given.".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.is_dir() {
        return invalid(format!("\"{}\" is not a directory.", root.display()));
    }
    let yaml_path = root.join("registry.yaml");
    if !yaml_path.is_file() {
        return invalid(format!(
            "\"{}\" carries no registry.yaml — a registry declares itself there.",
            root.display()
        ));
    }
    let yaml = match std::fs::read_to_string(&yaml_path) {
        Ok(raw) => parse_registry_yaml(&raw),
        Err(e) => return invalid(format!("registry.yaml could not be read: {e}")),
    };

    // catalog.json is optional for a probe — a registry mid-build is still a
    // registry. Its absence just means fullName/domains stay unknown.
    let catalog = std::fs::read_to_string(root.join("catalog.json"))
        .ok()
        .and_then(|raw| parse_catalog(&raw).ok());
    let (full_name, domains) = match catalog {
        Some(c) => (c.full_name, c.bundle_hashes.keys().cloned().collect()),
        None => (None, Vec::new()),
    };

    RegistryProbe {
        valid: true,
        name: yaml.name,
        full_name,
        lanes: yaml.lanes,
        domains,
        head_sha: git_head_short(&root),
        dirty: git_dirty(&root).unwrap_or(false),
        reason: None,
    }
}

// ---------------------------------------------------------------------------
// The coverage build
// ---------------------------------------------------------------------------

fn build_coverage(registry_root: &Path, projects: &[CoverageProjectIn]) -> RegistryCoverage {
    if !registry_root.is_dir() {
        return RegistryCoverage::empty(format!(
            "No folder at \"{}\" — link the registry to a working copy on this machine.",
            registry_root.display()
        ));
    }
    let yaml_path = registry_root.join("registry.yaml");
    if !yaml_path.is_file() {
        return RegistryCoverage::empty(format!(
            "\"{}\" carries no registry.yaml, so it is not a registry working copy.",
            registry_root.display()
        ));
    }

    let mut warnings: Vec<String> = Vec::new();

    let yaml = match std::fs::read_to_string(&yaml_path) {
        Ok(raw) => parse_registry_yaml(&raw),
        Err(e) => {
            warnings.push(format!("registry.yaml could not be read: {e}"));
            RegistryYaml::default()
        }
    };

    let catalog = match std::fs::read_to_string(registry_root.join("catalog.json")) {
        Ok(raw) => match parse_catalog(&raw) {
            Ok(c) => c,
            Err(e) => {
                warnings.push(format!(
                    "catalog.json could not be parsed ({e}) — skill adoption and bundle digests read as absent"
                ));
                Catalog::default()
            }
        },
        Err(_) => {
            warnings.push(
                "catalog.json is missing — skill adoption and bundle digests read as absent"
                    .to_string(),
            );
            Catalog::default()
        }
    };

    let rows = match std::fs::read_to_string(registry_root.join("librarian").join("projects.md")) {
        Ok(raw) => {
            let rows = parse_projects_md(&raw);
            if rows.is_empty() {
                warnings.push(
                    "librarian/projects.md carries no table rows — presence reads as absent"
                        .to_string(),
                );
            }
            rows
        }
        Err(_) => {
            warnings
                .push("librarian/projects.md is missing — presence reads as absent".to_string());
            Vec::new()
        }
    };

    // Git metadata. Absence degrades (warning), never aborts.
    let head_sha = git_head_short(registry_root);
    let dirty = git_dirty(registry_root);
    if head_sha.is_none() {
        warnings.push(
            "git could not read the registry HEAD — sha, dirtiness and lane dates are absent"
                .to_string(),
        );
    }
    let lane_dates: Vec<LaneDate> = CLOCK_LANES
        .iter()
        .map(|lane| LaneDate {
            lane: (*lane).to_string(),
            last_commit: if head_sha.is_some() {
                git_lane_date(registry_root, lane)
            } else {
                None
            },
        })
        .collect();
    let knowledge_last_commit = lane_dates
        .iter()
        .find(|l| l.lane == "knowledge")
        .and_then(|l| l.last_commit.clone());
    // ISO-8601 with a stable offset format compares lexically within the same
    // offset; the registry's own commits are what these come from, so a plain
    // max over the strings is the same simple clock the plan asks for.
    let registry_last_move = lane_dates
        .iter()
        .filter_map(|l| l.last_commit.clone())
        .max();

    // Adopters, grouped by normalized project slug.
    let mut adoptions_by_slug: BTreeMap<String, Vec<SkillAdoption>> = BTreeMap::new();
    for skill in &catalog.skills {
        for raw in &skill.adopters {
            let Some((slug, mechanism, adopted_version)) = parse_adopter(raw) else {
                warnings.push(format!(
                    "catalog.json: adopter \"{raw}\" on skill \"{}\" is not <slug>@<rest> — ignored",
                    skill.name
                ));
                continue;
            };
            let behind = matches!(&adopted_version, Some(v) if v != &skill.version);
            adoptions_by_slug
                .entry(normalize_slug(&slug))
                .or_default()
                .push(SkillAdoption {
                    skill: skill.name.clone(),
                    adopted_version,
                    lane_version: skill.version.clone(),
                    mechanism,
                    behind,
                });
        }
    }

    let row_by_slug: BTreeMap<String, &RegistryProjectRow> =
        rows.iter().map(|r| (normalize_slug(&r.slug), r)).collect();

    // Tiles — one per managed project the caller handed in.
    let mut matched_slugs: std::collections::BTreeSet<String> = Default::default();
    let mut tiles: Vec<CoverageTile> = Vec::new();
    for p in projects {
        let norm = normalize_slug(&p.name);
        let row = row_by_slug.get(&norm).copied();
        let adoptions = adoptions_by_slug.get(&norm).cloned().unwrap_or_default();
        // Presence: the projects.md table is canonical; an adopter slug with
        // no table row still evidences presence (plan D4 sources: table ∪
        // adopter slugs).
        let in_registry = row.is_some() || !adoptions.is_empty();
        if in_registry {
            matched_slugs.insert(norm.clone());
        }

        let project_root = PathBuf::from(p.root_path.trim());
        let root_readable = !p.root_path.trim().is_empty() && project_root.is_dir();
        let registry_map = if root_readable {
            Some(read_registry_map(
                &project_root,
                &catalog.bundle_hashes,
                &mut warnings,
                &p.name,
            ))
        } else {
            if !p.root_path.trim().is_empty() {
                warnings.push(format!(
                    "{}: project root \"{}\" is not a directory on this machine — consumer-side artifacts read as absent",
                    p.name, p.root_path
                ));
            }
            None
        };
        let skill_registry_mtime = if root_readable {
            mtime_iso(&project_root.join(SKILL_REGISTRY_REL))
        } else {
            None
        };

        let skills_behind = adoptions.iter().filter(|a| a.behind).count() as u32;
        let map_mtime = registry_map.as_ref().and_then(|m| m.mtime.clone());
        let project_last_action = [map_mtime.clone(), skill_registry_mtime]
            .into_iter()
            .flatten()
            .max();

        // Debts — each one evidenced, none defaulted (plan D5).
        let mut debts: Vec<CoverageDebt> = Vec::new();
        if !in_registry {
            debts.push(CoverageDebt {
                kind: DEBT_NOT_IN_REGISTRY.to_string(),
                detail: format!(
                    "\"{}\" appears neither in librarian/projects.md nor as any skill's adopter.",
                    p.name
                ),
            });
        } else {
            // Everything below presumes presence; for an absent project the
            // not-in-registry debt subsumes them.
            let never_mapped = !registry_map.as_ref().is_some_and(|m| m.exists);
            if root_readable && never_mapped {
                debts.push(CoverageDebt {
                    kind: DEBT_NEVER_MAPPED.to_string(),
                    detail: format!(
                        "No {REGISTRY_MAP_REL} — the knowledge join has never been computed."
                    ),
                });
            }
            if let Some(m) = registry_map.as_ref().filter(|m| m.exists) {
                let mtime_behind = matches!(
                    (&m.mtime, &knowledge_last_commit),
                    (Some(mt), Some(kc)) if mt.as_str() < kc.as_str()
                );
                if m.digest_stale || mtime_behind {
                    debts.push(CoverageDebt {
                        kind: DEBT_MAP_STALE.to_string(),
                        detail: if m.digest_stale {
                            "The map was judged against bundle digests that have since moved."
                                .to_string()
                        } else {
                            "The map is older than the knowledge lane's last commit.".to_string()
                        },
                    });
                }
                if m.unknown > 0 {
                    debts.push(CoverageDebt {
                        kind: DEBT_UNKNOWN_PAIRS.to_string(),
                        detail: format!(
                            "{} matched pairs still carry state \"unknown\".",
                            m.unknown
                        ),
                    });
                }
            }
            if skills_behind > 0 {
                debts.push(CoverageDebt {
                    kind: DEBT_SKILLS_BEHIND.to_string(),
                    detail: format!("{skills_behind} adopted skills sit behind the lane version."),
                });
            }
        }

        tiles.push(CoverageTile {
            project_id: p.id.clone(),
            project_name: p.name.clone(),
            slug: row
                .map(|r| r.slug.clone())
                .or_else(|| adoptions_by_slug.contains_key(&norm).then(|| norm.clone())),
            presence: CoveragePresence {
                in_registry,
                domains: row.map(|r| r.domains.clone()).unwrap_or_default(),
                forged_from: row.is_some_and(|r| r.forged_from),
            },
            extraction: None,
            applied: CoverageApplied {
                skills_adopted: adoptions.len() as u32,
                skills_behind,
                skills_detail: adoptions,
                registry_map,
            },
            staleness: CoverageStaleness {
                project_last_action,
                registry_last_move: registry_last_move.clone(),
            },
            debts,
        });
    }

    // Registry rows no managed project matched.
    let registry_only: Vec<RegistryOnlyProject> = rows
        .iter()
        .filter(|r| !matched_slugs.contains(&normalize_slug(&r.slug)))
        .map(|r| RegistryOnlyProject {
            slug: r.slug.clone(),
            domains: r.domains.clone(),
        })
        .collect();

    RegistryCoverage {
        registry_name: yaml.name,
        head_sha,
        dirty: dirty.unwrap_or(false),
        generated_at: catalog.generated_at,
        lane_dates,
        tiles,
        registry_only,
        warnings,
        source: CoverageSource {
            present: true,
            reason: None,
        },
    }
}

// ---------------------------------------------------------------------------
// Cache — single-slot, keyed by the inputs that can change the answer
// ---------------------------------------------------------------------------

/// (registry_root, HEAD sha, catalog.json mtime, projects-input hash) →
/// coverage. One slot: in practice there is one registry, and the per-project
/// file reads it skips re-doing are the expensive git-adjacent part.
/// Everything created names its reaper: the slot is overwritten on the next
/// distinct key, so it can never grow.
type CoverageCacheSlot = Option<(String, Arc<RegistryCoverage>)>;
static COVERAGE_CACHE: OnceLock<Mutex<CoverageCacheSlot>> = OnceLock::new();

fn coverage_cache_key(registry_root: &Path, projects: &[CoverageProjectIn]) -> String {
    let head = git_head_short(registry_root).unwrap_or_default();
    let catalog_mtime = std::fs::metadata(registry_root.join("catalog.json"))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default();
    let mut projects_key = String::new();
    for p in projects {
        projects_key.push_str(&p.id);
        projects_key.push('\u{1}');
        projects_key.push_str(&p.name);
        projects_key.push('\u{1}');
        projects_key.push_str(&p.root_path);
        projects_key.push('\u{2}');
    }
    format!(
        "{}\u{0}{head}\u{0}{catalog_mtime}\u{0}{projects_key}",
        registry_root.to_string_lossy()
    )
}

fn cached_coverage(registry_root: &Path, projects: &[CoverageProjectIn]) -> Arc<RegistryCoverage> {
    let key = coverage_cache_key(registry_root, projects);
    let cache = COVERAGE_CACHE.get_or_init(|| Mutex::new(None));
    {
        let guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((k, v)) = guard.as_ref() {
            if *k == key {
                return Arc::clone(v);
            }
        }
    }
    // A dirty working copy can change content under an unchanged HEAD; the
    // per-project artifacts can too. The key deliberately does NOT try to
    // capture those — a stale read here costs one refresh click, and chasing
    // every mtime would rebuild the exact per-call cost the cache removes.
    // The build is cheap enough (a few file reads + git) that recomputing on
    // any key change is fine.
    let built = Arc::new(build_coverage(registry_root, projects));
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some((key, Arc::clone(&built)));
    built
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Ask whether a local folder is a registry working copy. A non-registry
/// folder is `valid: false` + `reason` — never an `Err`; the operator is
/// browsing, and browsing into the wrong folder is not a fault.
#[tauri::command]
pub async fn dev_tools_registry_probe(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<RegistryProbe, AppError> {
    require_auth(&state).await?;
    tokio::task::spawn_blocking(move || probe_registry_root(&path))
        .await
        .map_err(|e| AppError::Internal(format!("registry probe join error: {e}")))
}

/// Compute the Project × registry coverage read model.
///
/// A blank `registry_root` is a `Validation` error (the caller asked for
/// nothing); a root that exists but is not a registry is an honest empty with
/// `source.reason`. Everything else degrades into `warnings`.
#[tauri::command]
pub async fn dev_tools_registry_coverage(
    state: State<'_, Arc<AppState>>,
    registry_root: String,
    projects: Vec<CoverageProjectIn>,
) -> Result<RegistryCoverage, AppError> {
    require_auth(&state).await?;
    let trimmed = registry_root.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "No registry root was given — link a registry first.".to_string(),
        ));
    }
    let coverage =
        tokio::task::spawn_blocking(move || cached_coverage(Path::new(&trimmed), &projects))
            .await
            .map_err(|e| AppError::Internal(format!("registry coverage join error: {e}")))?;

    tracing::debug!(
        tiles = coverage.tiles.len(),
        registry_only = coverage.registry_only.len(),
        warnings = coverage.warnings.len(),
        present = coverage.source.present,
        "registry coverage read"
    );

    Ok((*coverage).clone())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(id: &str, name: &str, root: &str) -> CoverageProjectIn {
        CoverageProjectIn {
            id: id.to_string(),
            name: name.to_string(),
            root_path: root.to_string(),
        }
    }

    // -- fixture registry ---------------------------------------------------

    // NOTE: a normal string, not `\`-continued lines — Rust's `\<newline>`
    // continuation strips the next line's leading whitespace, which silently
    // deletes exactly the indentation this fixture exists to exercise.
    const FIXTURE_YAML: &str = "# comment line\nregistry: 1\nname: fixture-registry\ntitle: Fixture registry\nlanes:\n  knowledge:\n    path: knowledge/\n    depth: nested\n  skills:\n    path: skills/\n  practices:\n    path: practices/  # trailing comment\n  memory:\n    path: memory/\nguarantees:\n  write_path: pull-request\n";

    fn fixture_catalog() -> String {
        serde_json::json!({
            "generatedAt": "2026-08-18T00:00:00Z",
            "registry": { "fullName": "acme/fixture-registry" },
            "skills": [
                { "name": "alpha", "version": "1.2", "adopters": ["personas@1.2", "pof@1.0"] },
                { "name": "beta", "version": "2.0", "adopters": ["personas@link"] },
                { "name": "gamma", "version": "1.0.0", "adopters": ["personas@plugin:1.0.0", "not-an-adopter"] }
            ],
            "bundles": [
                { "name": "software-engineering", "contentHash": "sha256:aaaa" },
                { "name": "recruiting", "contentHash": "sha256:bbbb" }
            ]
        })
        .to_string()
    }

    const FIXTURE_PROJECTS_MD: &str = "\
# Connected projects\n\
\n\
| Project | Domains it relates to | What it is |\n\
| --- | --- | --- |\n\
| `personas` | `software-engineering` | The `software-engineering` bundle was forged from it. |\n\
| `pof` | `game-production`, `software-engineering` | A companion. A wave forged from it sits unmerged. |\n\
| `orphan-project` | `recruiting` | Not yet forged from; nothing consumes it. |\n";

    fn write_fixture_registry(dir: &Path) {
        std::fs::write(dir.join("registry.yaml"), FIXTURE_YAML).unwrap();
        std::fs::write(dir.join("catalog.json"), fixture_catalog()).unwrap();
        std::fs::create_dir_all(dir.join("librarian")).unwrap();
        std::fs::write(
            dir.join("librarian").join("projects.md"),
            FIXTURE_PROJECTS_MD,
        )
        .unwrap();
    }

    fn write_registry_map(project_dir: &Path, json: &serde_json::Value) {
        let dir = project_dir.join(".ai");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("registry-map.json"), json.to_string()).unwrap();
    }

    // -- registry.yaml subset ----------------------------------------------

    #[test]
    fn yaml_subset_reads_name_and_direct_lane_children_only() {
        let y = parse_registry_yaml(FIXTURE_YAML);
        assert_eq!(y.name.as_deref(), Some("fixture-registry"));
        // `path:`/`depth:` are 4-space lane properties, `guarantees:` closes
        // the block — none of them may leak in as lanes.
        assert_eq!(y.lanes, vec!["knowledge", "skills", "practices", "memory"]);
    }

    // -- adopter strings ----------------------------------------------------

    #[test]
    fn adopter_string_parse_table() {
        assert_eq!(
            parse_adopter("x@1.2"),
            Some(("x".into(), "pinned".into(), Some("1.2".into())))
        );
        assert_eq!(
            parse_adopter("x@link"),
            Some(("x".into(), "link".into(), None))
        );
        assert_eq!(
            parse_adopter("x@plugin:1.0.0"),
            Some(("x".into(), "plugin".into(), Some("1.0.0".into())))
        );
        assert_eq!(parse_adopter("no-at-sign"), None);
        assert_eq!(parse_adopter("@rest"), None);
        assert_eq!(parse_adopter("slug@"), None);
    }

    // -- projects.md --------------------------------------------------------

    #[test]
    fn projects_md_rows_domains_and_forged_from_substring() {
        let rows = parse_projects_md(FIXTURE_PROJECTS_MD);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].slug, "personas");
        assert_eq!(rows[0].domains, vec!["software-engineering"]);
        assert!(rows[0].forged_from, "\"bundle was forged\" must match");
        assert_eq!(
            rows[1].domains,
            vec!["game-production", "software-engineering"]
        );
        assert!(rows[1].forged_from, "\"forged from it\" must match");
        // "Not yet forged from;" must NOT match — the `it` is load-bearing.
        assert!(!rows[2].forged_from);
    }

    // -- full fixture parse + matching + debts ------------------------------

    #[test]
    fn fixture_full_parse_matching_and_debts() {
        let tmp = tempfile::tempdir().expect("tempdir");
        write_fixture_registry(tmp.path());

        // Project roots: `personas` has a registry map with one of everything
        // plus a stale digest; `pof` has a root but no map; `Extra Project`
        // (normalizes to extra-project) is not in the registry at all.
        let personas_dir = tmp.path().join("proj-personas");
        std::fs::create_dir_all(&personas_dir).unwrap();
        write_registry_map(
            &personas_dir,
            &serde_json::json!({
                "schema": "rkb-registry-map/1",
                "domains": ["software-engineering"],
                "bundleDigests": { "software-engineering": "sha256:OLD" },
                "contexts": [
                    { "context": "c1", "subjects": [
                        { "subject": "s1", "state": "conformant" },
                        { "subject": "s2", "state": "deviation" },
                        { "subject": "s3", "state": "not-applicable" },
                        { "subject": "s4", "state": "unknown" },
                        { "subject": "s5" }
                    ]}
                ]
            }),
        );
        let pof_dir = tmp.path().join("proj-pof");
        std::fs::create_dir_all(&pof_dir).unwrap();

        let projects = vec![
            proj("p1", "Personas", personas_dir.to_str().unwrap()),
            proj("p2", "pof", pof_dir.to_str().unwrap()),
            proj("p3", "Extra Project", ""),
        ];
        let cov = build_coverage(tmp.path(), &projects);

        assert!(cov.source.present);
        assert_eq!(cov.registry_name.as_deref(), Some("fixture-registry"));
        assert_eq!(cov.generated_at.as_deref(), Some("2026-08-18T00:00:00Z"));
        assert_eq!(cov.lane_dates.len(), CLOCK_LANES.len());
        // The fixture is not a git repo: sha absent + a warning, never a crash.
        assert!(cov.head_sha.is_none());
        assert!(cov.warnings.iter().any(|w| w.contains("git")));
        // The malformed adopter string is warned about, not fatal.
        assert!(cov.warnings.iter().any(|w| w.contains("not-an-adopter")));

        // -- tile: Personas (normalization "Personas" -> "personas") --------
        let personas = &cov.tiles[0];
        assert_eq!(personas.slug.as_deref(), Some("personas"));
        assert!(personas.presence.in_registry);
        assert!(personas.presence.forged_from);
        assert_eq!(personas.presence.domains, vec!["software-engineering"]);
        assert!(personas.extraction.is_none());
        // alpha@1.2 (in sync), beta@link, gamma@plugin:1.0.0 (in sync).
        assert_eq!(personas.applied.skills_adopted, 3);
        assert_eq!(personas.applied.skills_behind, 0);
        let link = personas
            .applied
            .skills_detail
            .iter()
            .find(|a| a.skill == "beta")
            .unwrap();
        assert_eq!(link.mechanism, "link");
        assert!(link.adopted_version.is_none());
        assert!(!link.behind);
        let map = personas.applied.registry_map.as_ref().unwrap();
        assert!(map.exists);
        assert_eq!(
            (
                map.conformant,
                map.deviation,
                map.not_applicable,
                map.unknown
            ),
            (1, 1, 1, 2) // the state-less pair counts as unknown
        );
        assert!(
            map.digest_stale,
            "sha256:OLD vs sha256:aaaa must read stale"
        );
        assert!(map.mtime.is_some());
        assert_eq!(personas.staleness.project_last_action, map.mtime);
        let kinds: Vec<&str> = personas.debts.iter().map(|d| d.kind.as_str()).collect();
        assert!(kinds.contains(&DEBT_MAP_STALE));
        assert!(kinds.contains(&DEBT_UNKNOWN_PAIRS));
        assert!(!kinds.contains(&DEBT_NEVER_MAPPED));
        assert!(!kinds.contains(&DEBT_NOT_IN_REGISTRY));

        // -- tile: pof — behind on alpha (1.0 vs 1.2), never mapped ---------
        let pof = &cov.tiles[1];
        assert!(pof.presence.in_registry);
        assert_eq!(pof.applied.skills_adopted, 1);
        assert_eq!(pof.applied.skills_behind, 1);
        let m = pof.applied.registry_map.as_ref().unwrap();
        assert!(!m.exists);
        let kinds: Vec<&str> = pof.debts.iter().map(|d| d.kind.as_str()).collect();
        assert!(kinds.contains(&DEBT_NEVER_MAPPED));
        assert!(kinds.contains(&DEBT_SKILLS_BEHIND));

        // -- tile: absent project -------------------------------------------
        let extra = &cov.tiles[2];
        assert!(!extra.presence.in_registry);
        assert!(extra.slug.is_none());
        assert!(
            extra.applied.registry_map.is_none(),
            "blank root path is no signal"
        );
        assert_eq!(extra.debts.len(), 1);
        assert_eq!(extra.debts[0].kind, DEBT_NOT_IN_REGISTRY);

        // -- registryOnly ---------------------------------------------------
        assert_eq!(cov.registry_only.len(), 1);
        assert_eq!(cov.registry_only[0].slug, "orphan-project");
        assert_eq!(cov.registry_only[0].domains, vec!["recruiting"]);
    }

    #[test]
    fn malformed_catalog_warns_and_continues() {
        let tmp = tempfile::tempdir().expect("tempdir");
        write_fixture_registry(tmp.path());
        std::fs::write(tmp.path().join("catalog.json"), "{ not json").unwrap();

        let cov = build_coverage(tmp.path(), &[proj("p1", "personas", "")]);
        assert!(
            cov.source.present,
            "a broken catalog degrades, never empties"
        );
        assert!(cov.warnings.iter().any(|w| w.contains("catalog.json")));
        assert!(cov.generated_at.is_none());
        // Presence still works from projects.md alone.
        assert!(cov.tiles[0].presence.in_registry);
        assert_eq!(cov.tiles[0].applied.skills_adopted, 0);
    }

    #[test]
    fn non_registry_root_is_honest_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cov = build_coverage(tmp.path(), &[]);
        assert!(!cov.source.present);
        assert!(cov
            .source
            .reason
            .as_deref()
            .unwrap()
            .contains("registry.yaml"));
        assert!(cov.tiles.is_empty());

        let missing = tmp.path().join("does-not-exist");
        let cov = build_coverage(&missing, &[]);
        assert!(!cov.source.present);
        assert!(cov.source.reason.is_some());
    }

    #[test]
    fn probe_answers_valid_and_invalid_without_err() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let p = probe_registry_root(tmp.path().to_str().unwrap());
        assert!(!p.valid);
        assert!(p.reason.as_deref().unwrap().contains("registry.yaml"));

        let p = probe_registry_root("");
        assert!(!p.valid);

        write_fixture_registry(tmp.path());
        let p = probe_registry_root(tmp.path().to_str().unwrap());
        assert!(p.valid);
        assert_eq!(p.name.as_deref(), Some("fixture-registry"));
        assert_eq!(p.full_name.as_deref(), Some("acme/fixture-registry"));
        assert_eq!(p.lanes, vec!["knowledge", "skills", "practices", "memory"]);
        assert_eq!(p.domains, vec!["recruiting", "software-engineering"]);
        assert!(p.reason.is_none());
    }

    #[test]
    fn slug_normalization() {
        assert_eq!(normalize_slug("  Personas Web "), "personas-web");
        assert_eq!(normalize_slug("systedo_case"), "systedo-case");
        assert_eq!(normalize_slug("pof"), "pof");
    }

    // -- floors test against the REAL registry ------------------------------

    /// Where the real registry checkout lives on the operator's machines.
    /// Overridable so the test travels; skipped (loudly) when absent, because
    /// CI boxes do not carry the checkout.
    fn real_registry_root() -> Option<PathBuf> {
        let root = match std::env::var_os("PERSONAS_REGISTRY_ROOT") {
            Some(v) => PathBuf::from(v),
            None => PathBuf::from(r"C:\Users\mkdol\dolla\ai-registry"),
        };
        if root.join("registry.yaml").is_file() {
            Some(root)
        } else {
            eprintln!(
                "SKIP real_registry_floors: no registry at {} (set PERSONAS_REGISTRY_ROOT to point at a checkout)",
                root.display()
            );
            None
        }
    }

    /// Floors, not exact counts: the registry grows, and a test that pins
    /// today's numbers fails on every healthy commit. These floors only drop
    /// if the registry loses projects, skills, or its git history — all worth
    /// a loud failure.
    #[test]
    fn real_registry_floors() {
        let Some(root) = real_registry_root() else {
            return;
        };
        let cov = build_coverage(&root, &[proj("p1", "personas", "")]);
        assert!(cov.source.present, "reason: {:?}", cov.source.reason);
        assert!(cov.head_sha.is_some(), "the real checkout is a git repo");
        assert_eq!(cov.registry_name.as_deref(), Some("ai-registry"));
        assert!(cov.generated_at.is_some());

        // >=5 registry project slugs (tiles' matches + registry-only rows).
        let matched = cov.tiles.iter().filter(|t| t.presence.in_registry).count();
        let slugs = matched + cov.registry_only.len();
        assert!(
            slugs >= 5,
            "expected >=5 registry project slugs, got {slugs}"
        );

        // >=20 skills visible through adoption join: count distinct skills in
        // the catalog via a direct parse (the coverage document only carries
        // adopted ones).
        let catalog = parse_catalog(
            &std::fs::read_to_string(root.join("catalog.json")).expect("catalog.json reads"),
        )
        .expect("catalog.json parses");
        assert!(
            catalog.skills.len() >= 20,
            "expected >=20 skills, got {}",
            catalog.skills.len()
        );

        // Lane dates: knowledge + skills must have real history.
        for lane in ["knowledge", "skills"] {
            let d = cov
                .lane_dates
                .iter()
                .find(|l| l.lane == lane)
                .and_then(|l| l.last_commit.as_ref());
            assert!(d.is_some(), "lane {lane} must carry a last-commit date");
        }

        // The personas tile: in the registry, forged-from, with adopted skills.
        let personas = &cov.tiles[0];
        assert!(personas.presence.in_registry);
        assert!(personas.presence.forged_from);
        assert!(personas.applied.skills_adopted >= 1);
    }
}
