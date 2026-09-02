//! Template lookup — keyword similarity matching against the local template
//! catalog at `scripts/templates/`. Used by [`build_template_context`] to
//! inject a small "Reference Templates" section into the build prompt so the
//! LLM can pattern-match the user's intent against shipped persona templates.
//!
//! The index is loaded once and cached for the process lifetime — templates
//! don't change at runtime. Keyword extraction handles non-English intents by
//! falling back to substring scans for known service names ("gmail", "slack",
//! …) which are always written in ASCII regardless of the user's locale.
//!
//! ## Where the catalog is found (fixed 2026-09-02)
//!
//! This module used to open the bare relative path `scripts/templates`, which
//! resolves ONLY when the process CWD happens to be the repo root. Under
//! `tauri dev` the CWD is `src-tauri/`, and in a packaged build it is neither —
//! so `load_template_index` returned an empty vec and the prompt's "Reference
//! Templates" section silently vanished outside a repo-root run. The exact same
//! defect was found and fixed for the Presets gallery in
//! `personas_engine::team_preset_loader::templates_root`
//! (`src-tauri/engine/src/team_preset_loader.rs:63-97`), whose docblock names
//! this failure mode in as many words.
//!
//! **Why the resolver and not `include_str!`.** The other two precedents
//! (`engine/src/archetype_catalog.rs:23`, `src/engine/recipe_seed.rs:62`) embed
//! their catalog with `include_str!` — and both embed exactly ONE aggregate
//! file (`_archetypes.json`, `_recipe_seeds.json`). The template catalog is
//! **133 JSON files across 15 category directories** with no aggregate, so
//! embedding it would mean either hand-enumerating 133 `include_str!` paths
//! (silently stale the moment a template is added) or introducing a build-time
//! aggregation step. The resolver is the precedent that actually fits the
//! shape of this input.
//!
//! **What the resolver does and does not buy.** Candidate 3 is a
//! `CARGO_MANIFEST_DIR` anchor, so resolution no longer depends on the CWD at
//! all on a machine that has the repo checked out (dev, tests, a locally-built
//! app started from anywhere). It does NOT conjure a catalog on an end user's
//! machine: `scripts/templates` is not listed under `bundle.resources` in
//! `tauri.conf.json`, so a distributed installer ships no catalog for this
//! module to read. That remains open — see the module README — and is why the
//! missing-directory case now logs at `warn` exactly once instead of
//! disappearing into an empty `String::new()`.
//!
//! **No quality claim.** Restoring this section restores *parity* with a
//! repo-root run. The effect of the "Reference Templates" block on build
//! quality has never been measured here — there is no A/B, no eval, no rubric
//! score behind it. This fix asserts only that dev and shipped builds get the
//! same prompt, not that the prompt is better for having it.

/// Lightweight template index entry for similarity matching.
#[derive(Clone)]
struct TemplateEntry {
    name: String,
    description: String,
    category: String,
    service_flow: Vec<String>,
}

/// Resolve the repo's `scripts/templates` root, robust to the process
/// working directory.
///
/// Mirrors `personas_engine::team_preset_loader::templates_root`
/// (`src-tauri/engine/src/team_preset_loader.rs:83`) — the same defect
/// (a bare relative path that only resolves from the repo root) was fixed
/// there first for the Presets gallery. This is a SECOND copy rather than a
/// call: that function is private to the `personas-engine` crate, and making
/// it `pub` is outside this change's write set. Consolidating the two into one
/// exported resolver is the right follow-up.
///
/// Candidates, first existing directory wins:
///   1. `scripts/templates`                       (CWD = repo root)
///   2. `../scripts/templates`                    (CWD = `src-tauri/`, `tauri dev`)
///   3. `{CARGO_MANIFEST_DIR}/../scripts/templates`
///      (compile-time anchor. `CARGO_MANIFEST_DIR` for `app_lib` IS the
///      `src-tauri` dir, so its parent is the repo root — this candidate is an
///      absolute path and therefore independent of the CWD entirely.)
///
/// Returns `None` when none exist, so the caller can say so once at `warn`
/// instead of silently returning an empty index.
fn templates_root() -> Option<std::path::PathBuf> {
    let candidates = [
        std::path::PathBuf::from("scripts/templates"),
        std::path::PathBuf::from("../scripts/templates"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("scripts")
            .join("templates"),
    ];
    candidates.into_iter().find(|c| c.is_dir())
}

/// Read the lightweight index (name, description, category, service_flow) out
/// of every `<category>/*.json` under `dir`. Category directories whose name
/// starts with `_` are internal bundles (`_archetypes.json`,
/// `_team_presets/`, …) and are skipped.
fn read_template_index(dir: &std::path::Path) -> Vec<TemplateEntry> {
    let mut entries = Vec::new();
    if let Ok(categories) = std::fs::read_dir(dir) {
        for cat_entry in categories.flatten() {
            let cat_path = cat_entry.path();
            if !cat_path.is_dir()
                || cat_path
                    .file_name()
                    .map(|n| n.to_string_lossy().starts_with('_'))
                    .unwrap_or(true)
            {
                continue;
            }
            if let Ok(files) = std::fs::read_dir(&cat_path) {
                for file_entry in files.flatten() {
                    let fp = file_entry.path();
                    if fp.extension().map(|e| e == "json").unwrap_or(false) {
                        if let Ok(content) = std::fs::read_to_string(&fp) {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                                entries.push(TemplateEntry {
                                    name: val
                                        .get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    description: val
                                        .get("description")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    category: val
                                        .get("category")
                                        .and_then(|v| v.as_array())
                                        .and_then(|a| a.first())
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    service_flow: val
                                        .get("service_flow")
                                        .and_then(|v| v.as_array())
                                        .map(|a| {
                                            a.iter()
                                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                                .collect()
                                        })
                                        .unwrap_or_default(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    entries
}

/// Load template index from `scripts/templates/` — reads only the lightweight
/// fields (name, description, category, service_flow) from each JSON file.
/// Results are cached in-process after the first load, so the warn below is
/// emitted at most once per process by construction.
fn load_template_index() -> Vec<TemplateEntry> {
    static CACHE: std::sync::LazyLock<Vec<TemplateEntry>> = std::sync::LazyLock::new(|| {
        let Some(dir) = templates_root() else {
            tracing::warn!(
                "Template catalog not found (tried 'scripts/templates', '../scripts/templates' \
                 and the CARGO_MANIFEST_DIR anchor) — the build prompt's 'Reference Templates' \
                 section will be empty for this process"
            );
            return vec![];
        };
        let entries = read_template_index(&dir);
        tracing::info!(
            "Template index loaded: {} entries from {} (cached)",
            entries.len(),
            dir.display()
        );
        entries
    });
    CACHE.clone()
}

/// Extract keywords from text: word splitting + known service name scanning.
///
/// For non-English intents, standard word splitting may fail (CJK has no
/// spaces, Arabic is joined), but service names like "Gmail", "Notion",
/// "Slack" are always written in ASCII regardless of language. The service
/// name scan finds these as substrings, ensuring template matching works for
/// all languages.
fn extract_keywords(text: &str) -> Vec<String> {
    let stopwords: std::collections::HashSet<&str> = [
        "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
        "from", "is", "it", "that", "this", "be", "are", "was", "were", "been", "have", "has",
        "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can",
        "shall", "i", "me", "my", "we", "our", "you", "your", "they", "their", "want", "need",
        "like", "make", "create", "build", "agent", "bot",
    ]
    .into_iter()
    .collect();

    // Standard word extraction (works for space-delimited languages).
    let mut keywords: Vec<String> = text
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2 && !stopwords.contains(w))
        .map(|s| s.to_string())
        .collect();

    // Service name substring scan — finds "gmail" inside "Gmailのメール" etc.
    // Sources the canonical name list from the connector registry snapshot
    // (refreshed from DB on connector CRUD), supplemented by a small fallback
    // set so template matching still works when the snapshot is empty
    // (uninitialized at startup, or under unit tests with no DB).
    const FALLBACK_SERVICES: &[&str] = &[
        "gmail",
        "outlook",
        "notion",
        "slack",
        "discord",
        "trello",
        "jira",
        "asana",
        "github",
        "gitlab",
        "linear",
        "airtable",
        "google",
        "sheets",
        "drive",
        "calendar",
        "teams",
        "zoom",
        "hubspot",
        "salesforce",
        "stripe",
        "shopify",
        "sentry",
        "supabase",
        "clickup",
        "attio",
        "telegram",
        "whatsapp",
        "twilio",
        "sendgrid",
        "calcom",
    ];
    let text_lower = text.to_lowercase();
    let registry = crate::engine::api_proxy::connector_keyword_snapshot();
    let services_iter: Box<dyn Iterator<Item = String>> = if registry.is_empty() {
        Box::new(FALLBACK_SERVICES.iter().map(|s| s.to_string()))
    } else {
        Box::new(registry.into_iter())
    };
    for svc in services_iter {
        if text_lower.contains(svc.as_str()) && !keywords.contains(&svc) {
            keywords.push(svc);
        }
    }

    keywords
}

/// Find the top N templates most similar to the given intent by keyword
/// overlap score.
fn find_similar_templates<'a>(
    intent: &str,
    templates: &'a [TemplateEntry],
    top_n: usize,
) -> Vec<&'a TemplateEntry> {
    let intent_kw = extract_keywords(intent);
    if intent_kw.is_empty() {
        return vec![];
    }

    let mut scored: Vec<(usize, &TemplateEntry)> = templates
        .iter()
        .map(|t| {
            let text = format!(
                "{} {} {} {}",
                t.name,
                t.description,
                t.category,
                t.service_flow.join(" ")
            );
            let tmpl_kw = extract_keywords(&text);
            let score = intent_kw.iter().filter(|kw| tmpl_kw.contains(kw)).count();
            (score, t)
        })
        .collect();

    scored.sort_by_key(|b| std::cmp::Reverse(b.0));
    scored
        .into_iter()
        .filter(|(score, _)| *score > 0)
        .take(top_n)
        .map(|(_, t)| t)
        .collect()
}

/// Build a "Reference Templates" section for the build prompt from matched
/// templates. Returns an empty string when no template scores above zero so
/// the prompt isn't padded with a useless heading.
pub(super) fn build_template_context(intent: &str) -> String {
    let templates = load_template_index();
    if templates.is_empty() {
        return String::new();
    }

    let matches = find_similar_templates(intent, &templates, 3);
    if matches.is_empty() {
        return String::new();
    }

    let mut section = String::from("## Reference Templates\nThe following existing templates are similar to the user's intent. Use them as inspiration for dimension values, tool configurations, and service flows. Adapt — don't copy verbatim.\n\n");
    for (i, t) in matches.iter().enumerate() {
        section.push_str(&format!(
            "### Reference {}: {} ({})\n{}\nServices: {}\n\n",
            i + 1,
            t.name,
            t.category,
            t.description,
            t.service_flow.join(", "),
        ));
    }
    section
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `std::env::set_current_dir` is process-global, so any test that moves
    /// the CWD must serialise against every other one. One lock, held for the
    /// few microseconds the resolver needs.
    static CWD_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// The regression this file was fixed for: from a working directory that is
    /// NOT the repo root (which is every packaged run, and `tauri dev` too),
    /// the catalog must still resolve and the index must be non-empty.
    #[test]
    fn resolves_catalog_from_a_non_repo_root_cwd() {
        let _guard = CWD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let original = std::env::current_dir().expect("cwd readable");

        let tmp = std::env::temp_dir().join("lotJ-templates-root-probe");
        std::fs::create_dir_all(&tmp).expect("temp dir");
        // Canonicalise: on Windows TEMP is often a short (8.3) path and the
        // restore below must land on the same directory we left.
        std::env::set_current_dir(&tmp).expect("chdir into temp");

        let resolved = templates_root();
        let entries = resolved.as_deref().map(read_template_index);

        std::env::set_current_dir(&original).expect("chdir back");
        drop(std::fs::remove_dir(&tmp));

        let resolved = resolved.expect(
            "templates_root() must resolve from a non-repo-root CWD — this is the whole \
             point of the CARGO_MANIFEST_DIR anchor",
        );
        assert!(
            resolved.is_absolute(),
            "from a foreign CWD only the compile-time anchor can match, and that one is \
             absolute; got {}",
            resolved.display()
        );
        let entries = entries.expect("index read");
        assert!(
            !entries.is_empty(),
            "the resolved catalog at {} produced zero entries — resolution succeeded but the \
             read did not",
            resolved.display()
        );
    }

    /// A missing directory must produce an honest empty index, never a panic.
    #[test]
    fn missing_catalog_directory_yields_an_empty_index() {
        let missing = std::env::temp_dir().join("lotJ-templates-does-not-exist");
        assert!(read_template_index(&missing).is_empty());
    }

    /// The prompt section is built from the same index the resolver returns —
    /// with the catalog present, a service-shaped intent must produce a
    /// non-empty "Reference Templates" block.
    #[test]
    fn prompt_section_is_populated_when_the_catalog_resolves() {
        // Same lock as the chdir test above: a relative candidate resolved here
        // is read later, so a sibling test moving the CWD in between turns this
        // into a zero-entry read. (It did, on the first run of this test.)
        let _guard = CWD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let Some(dir) = templates_root() else {
            panic!("catalog must resolve in-tree");
        };
        let templates = read_template_index(&dir);
        assert!(!templates.is_empty(), "catalog read produced no entries");
        let matches = find_similar_templates("automate my gmail inbox triage", &templates, 3);
        assert!(
            !matches.is_empty(),
            "an intent naming a shipped service matched nothing in {} templates",
            templates.len()
        );
    }
}
