//! The registry's topology as the Council page draws it.
//!
//! **Everything here is a READER**, with the same posture as its neighbour
//! [`registry_coverage`](super::registry_coverage): it parses the registry
//! working copy's generated indexes (`knowledge/<domain>/index.json` and the
//! `taxonomy.json` beside each) and derives one [`RegistryGalaxy`] per call.
//! Nothing is written and nothing is persisted - a stored copy of the corpus
//! would be a second authority that drifts from the checkout it was copied
//! from, and the checkout is the only thing anybody edits.
//!
//! Three rules earn their place:
//!
//! 1. **Bounded decode.** Each index is read only after its size is checked
//!    against [`MAX_INDEX_BYTES`]; software-engineering's is 1.4 MB today and
//!    nothing stops it growing (census `unbounded-foreign-decode`).
//! 2. **Typed all the way out.** The indexes are parsed into named structs and
//!    the command returns named structs - never a `serde_json::Value` on the
//!    wire (census `untyped-command-payload`).
//! 3. **Three different failures, told apart.** A blank or unpaired root and a
//!    root with no `knowledge/` are `AppError`s carrying the remedy. ONE domain
//!    whose index is missing, oversized or malformed is skipped with a
//!    `tracing::warn!` and the rest of the corpus still returns. Only when
//!    EVERY domain failed does the read become an error rather than an empty
//!    galaxy - an empty answer to a failed read is the lie
//!    `failure-not-empty-success` names.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use super::registry_coverage::{git_head_short, probe_registry_root};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The lane every bundle is published into.
const KNOWLEDGE_LANE: &str = "knowledge";
/// Per-index read cap. The largest real index is ~1.4 MB; this is the refusal
/// point, not the expectation.
const MAX_INDEX_BYTES: u64 = 8 * 1024 * 1024;
/// Trigger phrases carried per technique. Two is what a tooltip and a search
/// index need; the rest is in the bundle, which is one click away.
const MAX_USE_WHEN: usize = 2;
/// Where a subject whose index names no category is filed. A bucket, not a
/// guess: the subject is shown, and its homelessness is visible.
const UNCATEGORIZED: &str = "uncategorized";

/// Slug segments that are initialisms and stay upper-case. Without this the
/// page reads "Llm Observability" and "Ui Controls", which is not a product.
const INITIALISMS: [&str; 15] = [
    "llm", "ui", "ux", "ci", "cd", "api", "sql", "mcp", "p2p", "ipc", "pii", "hitl", "kpi", "cx",
    "rtl",
];

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GalaxyTotals {
    pub domains: u32,
    pub categories: u32,
    pub subjects: u32,
    pub techniques: u32,
    pub applications: u32,
    pub laws: u32,
}

/// One technique as the galaxy draws it: a satellite of its subject.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GalaxyTechnique {
    pub slug: String,
    pub laws: Vec<String>,
    /// Up to two trigger phrases, for search and the tooltip.
    pub use_when: Vec<String>,
}

/// One registry subject: a star.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GalaxySubject {
    pub slug: String,
    pub title: String,
    pub subcategory: Option<String>,
    pub status: String,
    pub revision: Option<i32>,
    pub changed_at: Option<String>,
    pub applications: u32,
    pub techniques: Vec<GalaxyTechnique>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GalaxyCategory {
    pub id: String,
    pub title: String,
    pub subjects: Vec<GalaxySubject>,
}

/// A law is the only cross-subject edge the corpus has.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GalaxyLaw {
    pub slug: String,
    pub statement: String,
    /// `subject/technique` addresses.
    pub techniques: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GalaxyDomain {
    pub slug: String,
    pub title: String,
    pub categories: Vec<GalaxyCategory>,
    pub laws: Vec<GalaxyLaw>,
}

/// The registry's topology as the Council page draws it. DERIVED on every
/// read from the registry checkout and never persisted: a stored copy would be
/// a second authority that drifts.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RegistryGalaxy {
    pub registry_root: String,
    pub head_sha: Option<String>,
    pub totals: GalaxyTotals,
    pub domains: Vec<GalaxyDomain>,
}

// ---------------------------------------------------------------------------
// index.json / taxonomy.json - the subset this reader takes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct IndexFile {
    #[serde(default)]
    subjects: BTreeMap<String, IndexSubject>,
    #[serde(default)]
    laws: BTreeMap<String, IndexLaw>,
}

#[derive(Debug, Deserialize)]
struct IndexSubject {
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    subcategory: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    revision: Option<i32>,
    #[serde(default, rename = "changedAt")]
    changed_at: Option<String>,
    #[serde(default)]
    techniques: Vec<IndexTechnique>,
    #[serde(default)]
    applications: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct IndexTechnique {
    #[serde(default)]
    slug: String,
    #[serde(default)]
    laws: Vec<String>,
    #[serde(default)]
    use_when: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct IndexLaw {
    #[serde(default)]
    statement: String,
    #[serde(default)]
    techniques: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct TaxonomyFile {
    #[serde(default)]
    categories: Vec<TaxonomyCategory>,
}

#[derive(Debug, Deserialize)]
struct TaxonomyCategory {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: Option<String>,
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/// A slug in Title Case, with known initialisms kept upper-case.
///
/// The naive form renders "Llm Observability" and "Api Contract", which is how
/// a design reference reads and not how a product does. The list is explicit
/// rather than heuristic on length: `cd` and `ux` are initialisms, `io` and
/// `db` are not in this corpus, and guessing would get both wrong eventually.
fn title_case(slug: &str) -> String {
    slug.split(['-', '_', ' '])
        .filter(|p| !p.is_empty())
        .map(|part| {
            let lower = part.to_lowercase();
            if INITIALISMS.contains(&lower.as_str()) {
                return lower.to_uppercase();
            }
            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

/// Read one bounded file. `Err` carries the reason a caller can put in a
/// warning; nothing here decides whether that is fatal.
fn read_bounded(path: &Path, cap: u64) -> Result<String, String> {
    let meta = std::fs::metadata(path)
        .map_err(|e| format!("{} could not be read: {e}", path.display()))?;
    if meta.len() > cap {
        return Err(format!(
            "{} is {} bytes (cap {cap}) - refusing to decode it",
            path.display(),
            meta.len()
        ));
    }
    std::fs::read_to_string(path).map_err(|e| format!("{} could not be read: {e}", path.display()))
}

/// Category ids in the order `taxonomy.json` declares them. Empty when the
/// file is absent or unreadable - the caller then falls back to id order,
/// which is stable even though it is not the curator's order.
fn taxonomy_order(domain_dir: &Path) -> (Vec<String>, BTreeMap<String, String>) {
    let path = domain_dir.join("taxonomy.json");
    let Ok(raw) = read_bounded(&path, MAX_INDEX_BYTES) else {
        return (Vec::new(), BTreeMap::new());
    };
    let Ok(parsed) = serde_json::from_str::<TaxonomyFile>(&raw) else {
        tracing::warn!(path = %path.display(), "galaxy: taxonomy.json did not parse - categories fall back to id order");
        return (Vec::new(), BTreeMap::new());
    };
    let mut order = Vec::new();
    let mut titles = BTreeMap::new();
    for c in parsed.categories {
        if c.id.is_empty() {
            continue;
        }
        if let Some(t) = c.title.filter(|t| !t.trim().is_empty()) {
            titles.insert(c.id.clone(), t);
        }
        order.push(c.id);
    }
    (order, titles)
}

/// One domain, or the reason it could not be read.
fn build_domain(domain_dir: &Path, slug: &str) -> Result<GalaxyDomain, String> {
    let index_path = domain_dir.join("index.json");
    let raw = read_bounded(&index_path, MAX_INDEX_BYTES)?;
    let parsed: IndexFile = serde_json::from_str(&raw)
        .map_err(|e| format!("{} did not parse: {e}", index_path.display()))?;

    let (order, titles) = taxonomy_order(domain_dir);

    // Group subjects by the category their OWN index row declares - the
    // taxonomy supplies order and display titles, never membership, so a
    // subject the taxonomy forgot is still drawn.
    let mut by_category: BTreeMap<String, Vec<GalaxySubject>> = BTreeMap::new();
    for (subject_slug, s) in parsed.subjects {
        let category = s
            .category
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .unwrap_or(UNCATEGORIZED)
            .to_string();
        let techniques = s
            .techniques
            .into_iter()
            .filter(|t| !t.slug.is_empty())
            .map(|t| GalaxyTechnique {
                slug: t.slug,
                laws: t.laws,
                use_when: t.use_when.into_iter().take(MAX_USE_WHEN).collect(),
            })
            .collect();
        by_category
            .entry(category)
            .or_default()
            .push(GalaxySubject {
                title: title_case(&subject_slug),
                slug: subject_slug,
                subcategory: s.subcategory.filter(|x| !x.trim().is_empty()),
                // A status the index does not carry is `unknown`, which is a
                // state; defaulting it to `forged` would promote it.
                status: s.status.unwrap_or_else(|| "unknown".to_string()),
                revision: s.revision,
                changed_at: s.changed_at,
                applications: s.applications.len() as u32,
                techniques,
            });
    }
    for subjects in by_category.values_mut() {
        subjects.sort_by(|a, b| a.slug.cmp(&b.slug));
    }

    // Taxonomy order first, then whatever the taxonomy did not name, by id.
    let mut categories: Vec<GalaxyCategory> = Vec::new();
    for id in &order {
        if let Some(subjects) = by_category.remove(id) {
            categories.push(GalaxyCategory {
                title: titles.get(id).cloned().unwrap_or_else(|| title_case(id)),
                id: id.clone(),
                subjects,
            });
        }
    }
    for (id, subjects) in by_category {
        categories.push(GalaxyCategory {
            title: titles.get(&id).cloned().unwrap_or_else(|| title_case(&id)),
            id,
            subjects,
        });
    }

    let laws = parsed
        .laws
        .into_iter()
        .map(|(slug, l)| GalaxyLaw {
            slug,
            statement: l.statement,
            techniques: l.techniques,
        })
        .collect();

    Ok(GalaxyDomain {
        slug: slug.to_string(),
        title: title_case(slug),
        categories,
        laws,
    })
}

/// Domain slugs, by directory listing, sorted. The lane is the authority on
/// which bundles exist; a `catalog.json` that has not caught up would hide a
/// bundle that is right there on disk.
fn domain_dirs(knowledge: &Path) -> Vec<(PathBuf, String)> {
    let Ok(entries) = std::fs::read_dir(knowledge) else {
        return Vec::new();
    };
    let mut out: Vec<(PathBuf, String)> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| e.path().join("index.json").is_file())
        .map(|e| (e.path(), e.file_name().to_string_lossy().into_owned()))
        .collect();
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out
}

fn build_galaxy(registry_root: &Path) -> Result<RegistryGalaxy, AppError> {
    let knowledge = registry_root.join(KNOWLEDGE_LANE);
    if !knowledge.is_dir() {
        return Err(AppError::Validation(format!(
            "\"{}\" carries no {KNOWLEDGE_LANE}/ lane - pair a registry checkout that publishes bundles.",
            registry_root.display()
        )));
    }

    let dirs = domain_dirs(&knowledge);
    if dirs.is_empty() {
        return Err(AppError::NotFound(format!(
            "No bundle index found under \"{}\" - run the registry's build-index script in that checkout.",
            knowledge.display()
        )));
    }

    let attempted = dirs.len();
    let mut domains: Vec<GalaxyDomain> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for (dir, slug) in dirs {
        match build_domain(&dir, &slug) {
            Ok(d) => domains.push(d),
            Err(reason) => {
                // One bad bundle is not a broken corpus. It is named in the
                // log and the other nine still draw.
                tracing::warn!(domain = %slug, reason = %reason, "galaxy: domain skipped");
                failures.push(format!("{slug}: {reason}"));
            }
        }
    }
    if domains.is_empty() {
        // Every domain failed. An empty galaxy here would read as "the
        // registry is empty", which is a different and false statement.
        return Err(AppError::External(format!(
            "All {attempted} registry bundles failed to read: {}",
            failures.join("; ")
        )));
    }

    let mut totals = GalaxyTotals {
        domains: domains.len() as u32,
        ..Default::default()
    };
    for d in &domains {
        totals.laws += d.laws.len() as u32;
        totals.categories += d.categories.len() as u32;
        for c in &d.categories {
            totals.subjects += c.subjects.len() as u32;
            for s in &c.subjects {
                totals.techniques += s.techniques.len() as u32;
                totals.applications += s.applications;
            }
        }
    }

    Ok(RegistryGalaxy {
        registry_root: registry_root.to_string_lossy().into_owned(),
        head_sha: git_head_short(registry_root),
        totals,
        domains,
    })
}

// ---------------------------------------------------------------------------
// Cache - one slot, keyed on what can change the answer
// ---------------------------------------------------------------------------

/// (root, HEAD sha, newest `knowledge/*/index.json` mtime) -> galaxy. One slot:
/// in practice there is one registry, and the page re-reads it on every
/// navigation. Overwritten on the next distinct key, so it names its reaper.
type GalaxyCacheSlot = Option<(String, Arc<RegistryGalaxy>)>;
static GALAXY_CACHE: OnceLock<Mutex<GalaxyCacheSlot>> = OnceLock::new();

fn galaxy_cache_key(registry_root: &Path) -> String {
    let head = git_head_short(registry_root).unwrap_or_default();
    let newest = domain_dirs(&registry_root.join(KNOWLEDGE_LANE))
        .iter()
        .filter_map(|(dir, _)| std::fs::metadata(dir.join("index.json")).ok())
        .filter_map(|m| m.modified().ok())
        .filter_map(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .max()
        .unwrap_or_default();
    format!(
        "{}\u{0}{head}\u{0}{newest}",
        registry_root.to_string_lossy()
    )
}

fn cached_galaxy(registry_root: &Path) -> Result<Arc<RegistryGalaxy>, AppError> {
    let key = galaxy_cache_key(registry_root);
    let cache = GALAXY_CACHE.get_or_init(|| Mutex::new(None));
    {
        let guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((k, v)) = guard.as_ref() {
            if *k == key {
                return Ok(Arc::clone(v));
            }
        }
    }
    // Deliberately NOT caching the failure: a `Result` in a process-global
    // slot freezes the first attempt's error for the life of the process, and
    // the usual cause here (a half-written index) clears by itself.
    let built = Arc::new(build_galaxy(registry_root)?);
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some((key, Arc::clone(&built)));
    Ok(built)
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/// Derive the registry's topology from the paired checkout.
///
/// A blank root, a root that is not a registry, and a registry with no
/// readable bundle are three different `AppError`s, each carrying what to do
/// about it. A single unreadable bundle is not any of them.
#[tauri::command]
pub async fn dev_tools_registry_galaxy(
    state: State<'_, Arc<AppState>>,
    registry_root: String,
) -> Result<RegistryGalaxy, AppError> {
    require_auth(&state).await?;
    let trimmed = registry_root.trim().to_string();
    // A blank root and a folder that is not a registry are BOTH answered by
    // the probe, which already names each case ("No folder was given.", "…
    // carries no registry.yaml"). This command's contribution is the remedy
    // sentence after it - so there is one emptiness rule for a registry path
    // in this tree rather than a second one written out here.
    let galaxy = tokio::task::spawn_blocking(move || {
        let probe = probe_registry_root(&trimmed);
        if !probe.valid {
            return Err(AppError::Validation(format!(
                "{} Pair a registry checkout before opening the galaxy.",
                probe
                    .reason
                    .unwrap_or_else(|| { "That folder is not a registry checkout.".to_string() })
            )));
        }
        cached_galaxy(Path::new(&trimmed))
    })
    .await
    .map_err(|e| AppError::Internal(format!("registry galaxy join error: {e}")))??;

    tracing::debug!(
        domains = galaxy.totals.domains,
        subjects = galaxy.totals.subjects,
        techniques = galaxy.totals.techniques,
        "registry galaxy read"
    );
    Ok((*galaxy).clone())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_registry(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "galaxy-{tag}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(p.join(KNOWLEDGE_LANE)).unwrap();
        p
    }

    fn write_domain(root: &Path, slug: &str, index: &str, taxonomy: Option<&str>) {
        let dir = root.join(KNOWLEDGE_LANE).join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.json"), index).unwrap();
        if let Some(t) = taxonomy {
            std::fs::write(dir.join("taxonomy.json"), t).unwrap();
        }
    }

    fn good_index() -> String {
        json!({
            "meta": { "subjects": 2 },
            "subjects": {
                "ui-controls": {
                    "category": "input-and-editing",
                    "subcategory": null,
                    "status": "forged",
                    "revision": 7,
                    "changedAt": "2026-08-30",
                    "techniques": [
                        { "slug": "keyboard-first", "laws": ["never-trap-focus"],
                          "use_when": ["a", "b", "c"] }
                    ],
                    "applications": [{ "stack": "react" }, { "stack": "process" }]
                },
                "api-contract": {
                    "category": "shell-and-navigation",
                    "status": "forged",
                    "revision": 2,
                    "changedAt": "2026-07-01",
                    "techniques": [
                        { "slug": "typed-payloads", "laws": [], "use_when": [] },
                        { "slug": "versioned-doors", "laws": [], "use_when": ["x"] }
                    ],
                    "applications": []
                }
            },
            "laws": {
                "never-trap-focus": {
                    "statement": "Focus leaves every surface it enters.",
                    "techniques": ["ui-controls/keyboard-first"]
                }
            }
        })
        .to_string()
    }

    fn good_taxonomy() -> String {
        json!({
            "categories": [
                { "id": "shell-and-navigation", "title": "Shell & navigation", "order": 1,
                  "subjects": ["api-contract"] },
                { "id": "input-and-editing", "title": "Input & editing", "order": 2,
                  "subjects": ["ui-controls"] }
            ]
        })
        .to_string()
    }

    #[test]
    fn a_slug_becomes_a_title_and_initialisms_stay_shouting() {
        assert_eq!(title_case("llm-observability"), "LLM Observability");
        assert_eq!(title_case("ui-controls"), "UI Controls");
        assert_eq!(title_case("api-contract"), "API Contract");
        assert_eq!(title_case("p2p-networking"), "P2P Networking");
        assert_eq!(title_case("hitl-approval"), "HITL Approval");
        assert_eq!(title_case("software-engineering"), "Software Engineering");
        // A word that merely CONTAINS an initialism is left alone.
        assert_eq!(title_case("api-llm-cx"), "API LLM CX");
        assert_eq!(title_case("uix"), "Uix");
        assert_eq!(title_case(""), "");
    }

    #[test]
    fn a_malformed_domain_is_skipped_and_the_rest_still_returns() {
        let root = tmp_registry("mixed");
        write_domain(&root, "good-domain", &good_index(), Some(&good_taxonomy()));
        write_domain(&root, "broken-domain", "{ this is not json", None);

        let galaxy = build_galaxy(&root).unwrap();
        assert_eq!(galaxy.domains.len(), 1, "the broken bundle is skipped");
        assert_eq!(galaxy.domains[0].slug, "good-domain");
        assert_eq!(galaxy.totals.domains, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn categories_follow_the_taxonomy_and_fall_back_to_id_order() {
        let root = tmp_registry("order");
        write_domain(&root, "d", &good_index(), Some(&good_taxonomy()));
        let ordered = build_galaxy(&root).unwrap();
        let ids: Vec<&str> = ordered.domains[0]
            .categories
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        assert_eq!(ids, ["shell-and-navigation", "input-and-editing"]);
        assert_eq!(ordered.domains[0].categories[0].title, "Shell & navigation");
        let _ = std::fs::remove_dir_all(&root);

        // Without a taxonomy the order is the ids', not the map's arrival
        // order - stable, and visibly not the curator's.
        let root = tmp_registry("noorder");
        write_domain(&root, "d", &good_index(), None);
        let plain = build_galaxy(&root).unwrap();
        let ids: Vec<&str> = plain.domains[0]
            .categories
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        assert_eq!(ids, ["input-and-editing", "shell-and-navigation"]);
        assert_eq!(plain.domains[0].categories[0].title, "Input And Editing");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn totals_are_computed_and_use_when_is_capped() {
        let root = tmp_registry("totals");
        write_domain(&root, "d", &good_index(), Some(&good_taxonomy()));
        let galaxy = build_galaxy(&root).unwrap();
        assert_eq!(galaxy.totals.domains, 1);
        assert_eq!(galaxy.totals.categories, 2);
        assert_eq!(galaxy.totals.subjects, 2);
        assert_eq!(galaxy.totals.techniques, 3);
        // Computed from the arrays, never read from `meta`.
        assert_eq!(galaxy.totals.applications, 2);
        assert_eq!(galaxy.totals.laws, 1);

        let subject = galaxy.domains[0]
            .categories
            .iter()
            .flat_map(|c| &c.subjects)
            .find(|s| s.slug == "ui-controls")
            .unwrap();
        assert_eq!(subject.title, "UI Controls");
        assert_eq!(subject.applications, 2);
        assert_eq!(subject.revision, Some(7));
        assert_eq!(
            subject.techniques[0].use_when,
            vec!["a".to_string(), "b".to_string()],
            "two triggers, never three"
        );
        assert_eq!(
            galaxy.domains[0].laws[0].techniques,
            vec!["ui-controls/keyboard-first".to_string()],
            "a law's addresses are carried verbatim"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_oversized_index_is_skipped_rather_than_decoded() {
        let root = tmp_registry("oversize");
        write_domain(&root, "good-domain", &good_index(), None);
        let dir = root.join(KNOWLEDGE_LANE).join("fat-domain");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("index.json"),
            vec![b' '; (MAX_INDEX_BYTES + 1) as usize],
        )
        .unwrap();

        let galaxy = build_galaxy(&root).unwrap();
        assert_eq!(galaxy.domains.len(), 1);
        assert_eq!(galaxy.domains[0].slug, "good-domain");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The three whole-read failures are errors with a remedy, never an empty
    /// galaxy that reads as "the registry is empty".
    #[test]
    fn a_failed_read_is_an_error_not_an_empty_galaxy() {
        let no_lane = tmp_registry("nolane");
        std::fs::remove_dir_all(no_lane.join(KNOWLEDGE_LANE)).unwrap();
        let err = build_galaxy(&no_lane).unwrap_err().to_string();
        assert!(err.contains("knowledge/ lane"), "{err}");
        let _ = std::fs::remove_dir_all(&no_lane);

        let empty = tmp_registry("empty");
        let err = build_galaxy(&empty).unwrap_err().to_string();
        assert!(err.contains("No bundle index"), "{err}");
        let _ = std::fs::remove_dir_all(&empty);

        let all_bad = tmp_registry("allbad");
        write_domain(&all_bad, "a", "nope", None);
        write_domain(&all_bad, "b", "also nope", None);
        let err = build_galaxy(&all_bad).unwrap_err().to_string();
        assert!(err.contains("All 2 registry bundles failed"), "{err}");
        let _ = std::fs::remove_dir_all(&all_bad);
    }

    /// A subject whose index names no category is still drawn, in a bucket
    /// whose name says it is one.
    #[test]
    fn a_subject_without_a_category_is_still_drawn() {
        let root = tmp_registry("nocat");
        write_domain(
            &root,
            "d",
            &json!({
                "subjects": { "lonely": { "status": "draft", "techniques": [], "applications": [] } },
                "laws": {}
            })
            .to_string(),
            None,
        );
        let galaxy = build_galaxy(&root).unwrap();
        assert_eq!(galaxy.domains[0].categories[0].id, UNCATEGORIZED);
        assert_eq!(galaxy.domains[0].categories[0].subjects[0].slug, "lonely");
        assert_eq!(galaxy.totals.subjects, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The real registry on this machine, when it is there. Floors rather than
    /// exact counts: the corpus grows, and a test that pinned it would fail
    /// for the wrong reason. Skipped (not failed) when unpaired - a test that
    /// needs a sibling checkout is not a gate on a machine without one.
    #[test]
    fn real_registry_floors_and_payload_size() {
        let candidates = [
            PathBuf::from("../../ai-registry"),
            PathBuf::from("C:/Users/kazda/kiro/ai-registry"),
        ];
        let Some(root) = candidates
            .into_iter()
            .find(|p| p.join(KNOWLEDGE_LANE).is_dir())
        else {
            eprintln!("no paired ai-registry checkout - skipping");
            return;
        };
        let galaxy = build_galaxy(&root).unwrap();
        assert!(galaxy.totals.domains >= 5, "{:?}", galaxy.totals);
        assert!(galaxy.totals.subjects >= 200, "{:?}", galaxy.totals);
        assert!(galaxy.totals.techniques >= 1000, "{:?}", galaxy.totals);
        assert!(galaxy.totals.laws >= 5, "{:?}", galaxy.totals);
        // Every domain must carry at least one category, or the grouping is
        // broken rather than the corpus flat.
        for d in &galaxy.domains {
            assert!(!d.categories.is_empty(), "{} has no categories", d.slug);
        }
        let bytes = serde_json::to_vec(&galaxy).unwrap().len();
        eprintln!(
            "galaxy payload: {} bytes ({:.0} KB) for {:?}",
            bytes,
            bytes as f64 / 1024.0,
            galaxy.totals
        );
    }
}
