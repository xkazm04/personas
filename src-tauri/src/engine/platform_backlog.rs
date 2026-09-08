//! Where a persona's `propose_backlog` item belongs: its OWN project, or the
//! Personas platform.
//!
//! ## The defect this exists for (measured live 2026-09-08)
//!
//! App Master personas run a daily self-review lane ("improve") whose output is
//! `propose_backlog` entries, and those entries landed on the persona's own
//! project — always. Across five managed bank repos, **11 of 36 accepted ideas
//! were defects of the PERSONAS PLATFORM**, not of the bank:
//!
//! | Filed title | Filed by |
//! |---|---|
//! | Bind capability parameters before dispatch — they arrive as literal `{{param.*}}` placeholders | 4 App Masters |
//! | Gate the improve lane on at least one completed prior episode | 4 App Masters |
//! | Harden attention-pass runner against the recurring AmbientContextFusion panic | 1 |
//! | Fix `personas_get` — broken column reference | 1 |
//! | Accepted ideas about the Personas app itself have no worktree that can deliver them | 1 |
//!
//! Each project's mechanical triage rule (risk < 3 → accept) accepted them, the
//! `accepted-idea-delivery` charter dispatched a fleet worker into the BANK
//! repository, and the worker ended `FLEET:BLOCKED` — "the fix is a 2-line
//! change at `personas/src-tauri/src/engine/execution.rs:77`" — because it
//! cannot reach the Personas repo. The last row in that table is one App Master
//! diagnosing the defect itself.
//!
//! ## The rule
//!
//! Classification is explicit and testable, never a vibe, and it has two doors:
//!
//! 1. **The persona says so.** `propose_backlog` carries an optional
//!    `target: "platform" | "project"` (default `project`), documented in the
//!    improve lane's own brief (`subscription::attention::build_improve_task`).
//! 2. **A deterministic keyword backstop** over the title + description, for the
//!    personas that do not say so. [`PLATFORM_KEYWORDS`] is the whole list.
//!
//! A platform item is filed on the platform project as a *platform escalation*
//! (`personas_db::repos::dev::ideas::file_platform_escalation`): tagged so no
//! automatic dispatcher picks it up, carrying every filer in `evidence`, and
//! deduplicated across personas so four witnesses are one item.

use personas_db::DbPool;

/// The `target` value that means "this is about the Personas app itself".
pub const TARGET_PLATFORM: &str = "platform";
/// The `target` value that means "my own project" — also the default when the
/// persona says nothing.
pub const TARGET_PROJECT: &str = "project";

/// App setting naming the `dev_projects` row that IS the Personas repo.
///
/// Checked before the path match so an operator whose checkout moved, or who
/// registered the repo under a symlink, can settle it once rather than fighting
/// a heuristic.
pub const PLATFORM_PROJECT_SETTING_KEY: &str = personas_db::settings_keys::PLATFORM_PROJECT_ID;

/// Whose backlog an item belongs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BacklogTarget {
    /// The persona's own project — the default, and the overwhelming majority.
    Project,
    /// The Personas platform.
    Platform,
}

/// Vocabulary that only appears in an item about the Personas platform.
///
/// **Every entry earns its place against a title measured on 2026-09-08** (the
/// table in this module's header); the token that catches each is named beside
/// it. Matched case-insensitively as a substring of `"<title>\n<description>"`.
///
/// The three generically-English concepts the brief named — *attention*,
/// *wake*, *charter* — are anchored as PHRASES rather than bare words. A bare
/// `attention` would route "this reconciliation break needs attention" to the
/// platform, and a bare `charter` would route a bank charter. The anchoring is
/// the only deviation from the literal token list, and it costs nothing: all
/// five measured titles still match.
pub const PLATFORM_KEYWORDS: &[&str] = &[
    // "Harden attention-pass runner against the recurring AmbientContextFusion panic"
    "attention loop",
    "attention pass",
    "attention-pass",
    "attention lane",
    // "Gate the improve lane on at least one completed prior episode"
    "improve lane",
    "decide lane",
    // The wake cycle that drives both lanes.
    "wake cycle",
    "next wake",
    "wake pass",
    // A persona's charter (`persona_responsibilities`), never a bank charter.
    "persona charter",
    "responsibility charter",
    // "Bind capability parameters before dispatch — they arrive as literal
    // {{param.*}} placeholders"
    "{{param",
    // "Fix personas_get — broken column reference". Both spellings, because
    // `personas_get` does not contain `persona_`.
    "persona_",
    "personas_",
    // The app's own surfaces and verbs.
    "dev-tools",
    "propose_backlog",
    "dev_ideas",
    // "Accepted ideas about the Personas app itself have no worktree that can
    // deliver them"
    "personas app",
    "personas platform",
    "personas repo",
    // A path into this repo — the shape the blocked fleet workers reported.
    "src-tauri",
];

/// Decide whose backlog this item belongs on.
///
/// `declared` is the persona's own `target` field. It WINS: a persona that says
/// `"project"` about something the keywords would catch is making a judgement
/// the heuristic must not override — the heuristic exists for the personas that
/// say nothing. An unrecognised value is treated as absent rather than as an
/// error, because a dropped backlog item is worse than a misrouted one.
pub fn classify(declared: Option<&str>, title: &str, description: Option<&str>) -> BacklogTarget {
    match declared
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some(TARGET_PLATFORM) => return BacklogTarget::Platform,
        Some(TARGET_PROJECT) => return BacklogTarget::Project,
        _ => {}
    }
    let haystack = format!("{}\n{}", title, description.unwrap_or("")).to_ascii_lowercase();
    if PLATFORM_KEYWORDS.iter().any(|k| haystack.contains(k)) {
        BacklogTarget::Platform
    } else {
        BacklogTarget::Project
    }
}

/// The `dev_projects` row that IS the Personas repo, or `None`.
///
/// Two resolvers, in order:
/// 1. the [`PLATFORM_PROJECT_SETTING_KEY`] setting, when it names a row that
///    still exists (a stale id resolves to nothing rather than to a wrong
///    project);
/// 2. the project whose `root_path` is the checkout this binary was built from
///    (`companion::dev_mode::repo_root()` — compile-time `CARGO_MANIFEST_DIR/..`,
///    the same anchor `companion::projects::seed_default_project` registers the
///    Personas repo under).
///
/// Compared after normalising separators, trailing slashes and — on Windows,
/// where the filesystem is case-insensitive — case. An exact `root_path =`
/// lookup would miss `C:\Users\…\personas` against `C:/Users/…/personas`, which
/// is the same repo written by two different writers.
///
/// `None` is a real answer: the caller keeps the item on the home project and
/// tags it, rather than dropping it.
pub fn resolve_platform_project(pool: &DbPool) -> Option<String> {
    if let Ok(Some(id)) =
        personas_db::repos::core::settings::get(pool, PLATFORM_PROJECT_SETTING_KEY)
    {
        let id = id.trim();
        if !id.is_empty() && personas_db::repos::dev::projects::get_project_by_id(pool, id).is_ok()
        {
            return Some(id.to_string());
        }
        tracing::warn!(
            setting = PLATFORM_PROJECT_SETTING_KEY,
            "platform_backlog: the configured platform project does not exist — falling back to the path match"
        );
    }

    let root = normalize_path(&crate::companion::dev_mode::repo_root().to_string_lossy());
    if root.is_empty() {
        return None;
    }
    let projects = personas_db::repos::dev::projects::list_projects(pool, None).ok()?;
    projects
        .into_iter()
        .find(|p| normalize_path(&p.root_path) == root)
        .map(|p| p.id)
}

/// Fold a filesystem path to the form two writers of the same path agree on:
/// `\` → `/`, no trailing slash, lowercased.
///
/// Lowercasing is correct on Windows (the only platform where two casings name
/// one directory) and harmless elsewhere in practice — a repo registered twice
/// under two casings on a case-sensitive filesystem is not a state this
/// resolver can be wrong about, because the second registration would have been
/// a different checkout anyway.
fn normalize_path(p: &str) -> String {
    p.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

/// The provenance record one filing attaches to a platform escalation: WHO
/// raised it and WHAT they work on.
///
/// The escalation is deduplicated across personas, so this is the only place
/// the four witnesses of a four-times-filed defect survive. `title` is the
/// filer's own wording, which the dedup key deliberately normalises away.
pub fn filing(
    persona_id: &str,
    persona_name: &str,
    home_project_id: Option<&str>,
    home_project_name: Option<&str>,
    title: &str,
) -> serde_json::Value {
    serde_json::json!({
        "source": "propose_backlog",
        "personaId": persona_id,
        "personaName": persona_name,
        "projectId": home_project_id,
        "projectName": home_project_name,
        "title": title,
        "filedAt": chrono::Utc::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A persona that marks its own item is believed, keywords or not.
    #[test]
    fn a_self_marked_platform_item_routes_to_the_platform() {
        assert_eq!(
            classify(Some("platform"), "Something entirely domain-shaped", None),
            BacklogTarget::Platform
        );
        assert_eq!(
            classify(Some("  PLATFORM "), "Something else", None),
            BacklogTarget::Platform,
            "trimmed and case-insensitive"
        );
    }

    /// …and a persona that says `project` is believed too — the heuristic is a
    /// backstop for silence, not an override of a judgement.
    #[test]
    fn an_explicit_project_target_wins_over_the_keywords() {
        assert_eq!(
            classify(
                Some("project"),
                "Persona charter for the payments desk",
                None
            ),
            BacklogTarget::Project
        );
    }

    /// Every title measured on 2026-09-08 is caught by the backstop.
    #[test]
    fn the_measured_titles_all_route_to_the_platform() {
        for title in [
            "Bind capability parameters before dispatch — they arrive as literal {{param.*}} placeholders",
            "Gate the improve lane on at least one completed prior episode",
            "Harden attention-pass runner against the recurring AmbientContextFusion panic",
            "Fix personas_get — broken column reference",
            "Accepted ideas about the Personas app itself have no worktree that can deliver them",
        ] {
            assert_eq!(
                classify(None, title, None),
                BacklogTarget::Platform,
                "not caught: {title}"
            );
        }
    }

    /// The description is read too — a plain title with a Personas-shaped body
    /// is still a platform item.
    #[test]
    fn the_description_is_part_of_the_haystack() {
        assert_eq!(
            classify(
                None,
                "Two-line fix",
                Some("the fix is at personas/src-tauri/src/engine/execution.rs:77")
            ),
            BacklogTarget::Platform
        );
    }

    /// The case the whole rule must not break: a real bank-domain item stays on
    /// the persona's own project.
    #[test]
    fn a_bank_domain_item_stays_on_the_home_project() {
        for title in [
            "SEPA pacs.008 validation",
            "Reconciliation break needs attention before the 09:00 cutoff",
            "Publish the deposit account charter to the customer portal",
            "Wake the nightly batch earlier so settlement clears by 06:00",
        ] {
            assert_eq!(
                classify(None, title, None),
                BacklogTarget::Project,
                "misrouted: {title}"
            );
        }
    }

    #[test]
    fn paths_fold_across_separator_case_and_trailing_slash() {
        assert_eq!(
            normalize_path("C:\\Users\\me\\kiro\\Personas\\"),
            normalize_path("c:/users/me/kiro/personas")
        );
    }

    /// The setting wins, and a stale id does not resolve to a wrong project.
    #[test]
    fn the_setting_resolves_the_platform_project_and_a_stale_id_does_not() {
        let pool = personas_db::init_test_db().unwrap();
        let platform = personas_db::repos::dev::projects::create_project(
            &pool,
            "Personas",
            "/somewhere/not/the/build/root",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(
            resolve_platform_project(&pool),
            None,
            "nothing configured and no project at the build root"
        );

        personas_db::repos::core::settings::set(&pool, PLATFORM_PROJECT_SETTING_KEY, &platform.id)
            .unwrap();
        assert_eq!(resolve_platform_project(&pool), Some(platform.id.clone()));

        personas_db::repos::core::settings::set(
            &pool,
            PLATFORM_PROJECT_SETTING_KEY,
            "no-such-project",
        )
        .unwrap();
        assert_eq!(
            resolve_platform_project(&pool),
            None,
            "a stale id resolves to nothing, never to some other project"
        );
    }

    /// The path resolver finds the repo this binary was built from, however the
    /// registering writer spelled the separators.
    #[test]
    fn the_build_root_resolves_the_platform_project_across_separator_spelling() {
        let pool = personas_db::init_test_db().unwrap();
        let root = crate::companion::dev_mode::repo_root()
            .to_string_lossy()
            .replace('\\', "/");
        let platform = personas_db::repos::dev::projects::create_project(
            &pool, "Personas", &root, None, None, None, None, None,
        )
        .unwrap();
        assert_eq!(resolve_platform_project(&pool), Some(platform.id));
    }
}
