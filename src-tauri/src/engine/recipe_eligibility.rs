//! Stage E.1 — recipe eligibility scoring.
//!
//! Pure-logic core that decides whether a recipe can be adopted into a
//! given persona. Three states mirror the recipe-redesign agreement
//! (`project_recipe_redesign` memory, 2026-05-02):
//!
//! - **Eligible** — the persona already has every required tool wired,
//!   so adoption is one-click.
//! - **AdoptableWithSetup** — the persona is missing some tools but
//!   they all exist in the global catalog; adoption needs a "wire X
//!   first" guided path.
//! - **Incompatible** — at least one required tool is not in the
//!   catalog at all (different tier / platform / retired). The card
//!   should be dimmed with a reason.
//!
//! Inputs come pre-extracted by the caller:
//! - `recipe.prompt_template` (the serialized UC JSON, set by Stage B
//!   Phase 1b's derive). We re-parse it here to read `tool_hints[]` —
//!   that field is the canonical tool requirement signal in the
//!   post-2.2 catalog.
//! - The persona's wired tools (Vec<PersonaToolDefinition>) and the
//!   global catalog (Vec<PersonaToolDefinition>).
//!
//! Scoring is name-based: a recipe says `tool_hints: ["file_read",
//! "gmail_search"]` and we check against `PersonaToolDefinition.name`.
//! If a future recipe adds id-based requirements, extend the parsing
//! pass; the scoring algorithm doesn't care which side of the
//! comparison the strings come from.
//!
//! Connectors are not *name-scored* against the persona's wired
//! credentials in v1 — that hydration lives in E.2 (adoption). But their
//! PRESENCE is honest input to the verdict: a recipe whose only declared
//! requirement is a connector (e.g. `{type: "gmail", auth_type:
//! "oauth2"}` or a `"gmail"` slug) and that carries NO tool signal must
//! NOT score `Eligible`. That would be a false green light — the card
//! promises one-click adopt, the user adopts, and the persona has no
//! matching credential so it fails on first run. Such
//! no-tool-signal-but-connectored recipes are downgraded to
//! `AdoptableWithSetup` (see the state pick below). Full
//! connector-vs-wired-credential scoring remains an E.2/future
//! enhancement.
//!
//! INVARIANT: `Eligible` means "every modelled requirement this gate can
//! verify is satisfied". For that to be meaningful, derivation MUST
//! populate `tool_hints[]` for any recipe whose capability depends on
//! tools — an unpopulated `tool_hints[]` is read as "no tool signal", not
//! "no requirements". A recipe with neither `tool_hints[]` nor
//! `connectors[]` is genuinely requirement-free and stays vacuously
//! `Eligible`.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{PersonaToolDefinition, RecipeDefinition};

/// Three-state eligibility per the recipe-redesign agreement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RecipeEligibilityState {
    Eligible,
    AdoptableWithSetup,
    Incompatible,
}

/// Output of a single recipe-vs-persona scoring run. Carries the lists
/// the UI needs to render the "wire X first" hint without a second IPC
/// round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeEligibility {
    pub recipe_id: String,
    pub persona_id: String,
    pub state: RecipeEligibilityState,
    /// Tool names the recipe declares via `tool_hints[]` in its
    /// serialized UC. Empty vec means the recipe declares no tool
    /// requirements — vacuously eligible against any persona ONLY when it
    /// also declares no `connectors[]`. A no-tool-signal recipe that DOES
    /// declare connectors is downgraded to `AdoptableWithSetup` (see the
    /// module-level INVARIANT), so an empty `required_tools` no longer
    /// implies `Eligible` on its own.
    pub required_tools: Vec<String>,
    /// Required tools the persona already has wired.
    pub satisfied_tools: Vec<String>,
    /// Required tools the persona is missing BUT that exist in the
    /// global catalog. Adoption can route through a guided "wire X
    /// first" prompt for each.
    pub missing_tools_addable: Vec<String>,
    /// Required tools that are not in the catalog at all. These are
    /// the show-stoppers — no setup path can resolve them.
    pub missing_tools_uncatalogued: Vec<String>,
}

/// Score a single recipe against a persona's wired tools and the
/// global tool catalog. Pure function — no DB, no IPC, no allocations
/// beyond the output Vecs.
pub fn score_recipe_eligibility(
    recipe: &RecipeDefinition,
    persona_id: &str,
    persona_tools: &[PersonaToolDefinition],
    catalog: &[PersonaToolDefinition],
) -> RecipeEligibility {
    let required = match extract_required_tools(recipe) {
        RequiredTools::Resolved(tools) => tools,
        RequiredTools::Unreadable(reason) => {
            // A recipe that *declares* tool requirements we cannot parse must not be
            // treated as requirement-free — that would mark it Eligible and let the
            // adoption flow auto-link it with incomplete tool wiring. Surface a hard
            // blocker: Incompatible, with the parse reason carried in
            // `missing_tools_uncatalogued` so the adoption hard-stop and the catalog
            // UI both report a concrete cause rather than silently succeeding.
            return RecipeEligibility {
                recipe_id: recipe.id.clone(),
                persona_id: persona_id.to_string(),
                state: RecipeEligibilityState::Incompatible,
                required_tools: Vec::new(),
                satisfied_tools: Vec::new(),
                missing_tools_addable: Vec::new(),
                missing_tools_uncatalogued: vec![reason],
            };
        }
    };
    let persona_names: HashSet<&str> =
        persona_tools.iter().map(|t| t.name.as_str()).collect();
    let catalog_names: HashSet<&str> =
        catalog.iter().map(|t| t.name.as_str()).collect();

    let mut satisfied: Vec<String> = Vec::new();
    let mut missing_addable: Vec<String> = Vec::new();
    let mut missing_uncatalogued: Vec<String> = Vec::new();

    for tool in required.iter() {
        let name = tool.as_str();
        if persona_names.contains(name) {
            satisfied.push(tool.clone());
        } else if catalog_names.contains(name) {
            missing_addable.push(tool.clone());
        } else {
            missing_uncatalogued.push(tool.clone());
        }
    }

    // Connector (credential) requirements the recipe declares. v1 does not
    // name-score these against the persona's wired credentials, but their
    // *presence* keeps a no-tool-signal recipe from claiming a false
    // `Eligible` (see module-level docs + INVARIANT).
    let required_connectors = extract_required_connectors(recipe);

    let state = if !missing_uncatalogued.is_empty() {
        RecipeEligibilityState::Incompatible
    } else if !missing_addable.is_empty() {
        RecipeEligibilityState::AdoptableWithSetup
    } else if required.is_empty() && !required_connectors.is_empty() {
        // No tool-name signal at all, but the recipe declares connector
        // (credential) requirements this gate cannot verify in v1. Downgrade
        // from the vacuous `Eligible` to `AdoptableWithSetup` so neither the
        // UI nor the adoption flow promises one-click for a persona that has
        // no matching credential and would fail on first run.
        RecipeEligibilityState::AdoptableWithSetup
    } else {
        // Either every declared tool is satisfied, or the recipe declares no
        // requirements at all (no tools AND no connectors) → genuinely Eligible.
        RecipeEligibilityState::Eligible
    };

    RecipeEligibility {
        recipe_id: recipe.id.clone(),
        persona_id: persona_id.to_string(),
        state,
        required_tools: required,
        satisfied_tools: satisfied,
        missing_tools_addable: missing_addable,
        missing_tools_uncatalogued: missing_uncatalogued,
    }
}

/// Outcome of reading a recipe's declared tool requirements.
enum RequiredTools {
    /// Successfully resolved the required tool names. An empty Vec means
    /// the recipe genuinely declares no tool requirements (vacuously
    /// eligible against any persona).
    Resolved(Vec<String>),
    /// A field that *declares* tool requirements was present but could not
    /// be read into a usable name list — a structurally-broken `tool_hints`
    /// shape, or a `tool_requirements` value that isn't valid JSON. The
    /// required-tool set is unknown, so the recipe must be blocked rather
    /// than silently treated as requirement-free. Carries a human-readable
    /// reason.
    Unreadable(String),
}

/// Interpret a JSON value as a list of tool-name strings. The canonical
/// `tool_hints` shape is an array of strings; this enforces it.
///
/// - `Some(names)` when the value is an array whose every element is a
///   string (blank entries are skipped; an empty array yields `Some(vec![])`).
/// - `None` when the value isn't an array, or contains any non-string
///   element — i.e. the field is present but structurally unusable.
fn parse_tool_name_array(value: &serde_json::Value) -> Option<Vec<String>> {
    let arr = value.as_array()?;
    let mut names = Vec::with_capacity(arr.len());
    for item in arr {
        let s = item.as_str()?; // any non-string element ⇒ corrupt shape
        let s = s.trim();
        if !s.is_empty() {
            names.push(s.to_string());
        }
    }
    Some(names)
}

/// Extract a recipe's required tool names from its `prompt_template`
/// (the serialized UC). Reads `tool_hints[]` first (post-2.2 canonical
/// signal); falls back to the top-level `tool_requirements` JSON
/// (older derivation path that some pre-2.2 recipes still carry).
///
/// Returns `Resolved(vec![])` when no tool-requirement field is declared —
/// the caller treats that as "no tool requirements" (vacuously Eligible).
/// Returns `Unreadable` when a field *is* declared but cannot be parsed,
/// so the caller can surface a blocker instead of defaulting to
/// no-requirements (which would let a corrupt recipe auto-adopt with
/// incomplete tool wiring).
///
/// A `prompt_template` that isn't a JSON object is **not** corruption: plain
/// text / legacy prompts simply carry no `tool_hints` signal, so we fall
/// through to `tool_requirements`. Likewise a `tool_requirements` value that
/// is valid JSON but not a string array (e.g. a legacy object array produced
/// by older derivation) is preserved as historical "no string requirements"
/// behavior rather than flipping long-standing recipes to Incompatible — only
/// genuinely unparseable content is treated as a blocker.
fn extract_required_tools(recipe: &RecipeDefinition) -> RequiredTools {
    // --- Path 1: tool_hints from the serialized UC (canonical signal) ---
    let mut tool_hints_corrupt = false;
    if let Ok(serde_json::Value::Object(uc)) =
        serde_json::from_str::<serde_json::Value>(&recipe.prompt_template)
    {
        if let Some(hints) = uc.get("tool_hints") {
            match parse_tool_name_array(hints) {
                Some(names) if !names.is_empty() => return RequiredTools::Resolved(names),
                // An explicitly empty tool_hints array means "no hints here" —
                // fall through to the legacy field rather than blocking.
                Some(_) => {}
                // Present but not an array of name strings → corrupt canonical
                // signal. Don't block yet: a valid `tool_requirements` fallback
                // can still salvage the recipe.
                None => tool_hints_corrupt = true,
            }
        }
    }

    // --- Path 2: legacy top-level tool_requirements JSON ---
    if let Some(raw) = recipe.tool_requirements.as_deref() {
        let trimmed = raw.trim();
        // A blank / explicit-null value declares nothing.
        if !trimmed.is_empty() && trimmed != "null" {
            match serde_json::from_str::<serde_json::Value>(trimmed) {
                Ok(value) => {
                    if let Some(names) = parse_tool_name_array(&value) {
                        return RequiredTools::Resolved(names);
                    }
                    // Valid JSON, but not a tool-name array (e.g. a legacy object
                    // array). Preserve historical behavior — treat as "no string
                    // requirements" — rather than hard-blocking established recipes.
                }
                // Present but not parseable JSON at all → genuine corruption.
                Err(_) => {
                    return RequiredTools::Unreadable(format!(
                        "recipe {} declares tool_requirements that are not valid JSON",
                        recipe.id
                    ));
                }
            }
        }
    }

    // Neither path produced a usable requirement set. If the only signal we saw
    // was a structurally-broken tool_hints field, surface it as a blocker;
    // otherwise the recipe genuinely declares no tool requirements.
    if tool_hints_corrupt {
        return RequiredTools::Unreadable(format!(
            "recipe {} declares a tool_hints field that is not an array of tool-name strings",
            recipe.id
        ));
    }

    // No tool-requirement field declared. This is "no tool signal", NOT
    // necessarily "no requirements": the scorer still inspects `connectors[]`
    // (via `extract_required_connectors`) before deciding Eligible vs
    // AdoptableWithSetup. See the module-level INVARIANT.
    RequiredTools::Resolved(Vec::new())
}

/// Read a recipe's declared connector (credential) requirements from its
/// serialized UC `connectors[]`. Mirrors the frontend `recipeAdapter`: each
/// element is either a slug string (`"gmail"`) or an object carrying a
/// `name`/`type` field (`{type: "gmail", auth_type: "oauth2"}`). Blank and
/// unrecognised elements are skipped.
///
/// Returns the resolved connector slugs. An empty result means the recipe
/// declares no (recognisable) connector requirement. Exposed `pub(crate)` so
/// the adoption flow can name the connectors in its "needs setup" message.
pub(crate) fn extract_required_connectors(recipe: &RecipeDefinition) -> Vec<String> {
    let Ok(serde_json::Value::Object(uc)) =
        serde_json::from_str::<serde_json::Value>(&recipe.prompt_template)
    else {
        // A plain-text / non-object prompt_template carries no UC connectors.
        return Vec::new();
    };
    let Some(arr) = uc.get("connectors").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|c| match c {
            serde_json::Value::String(s) => {
                let s = s.trim();
                (!s.is_empty()).then(|| s.to_string())
            }
            // Object shape: prefer `name`, fall back to `type` (the
            // credential-type form documented at the top of this module).
            serde_json::Value::Object(o) => o
                .get("name")
                .or_else(|| o.get("type"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn td(name: &str) -> PersonaToolDefinition {
        PersonaToolDefinition {
            id: format!("td-{name}"),
            name: name.to_string(),
            category: "test".to_string(),
            description: String::new(),
            script_path: String::new(),
            input_schema: None,
            output_schema: None,
            requires_credential_type: None,
            implementation_guide: Some("noop".to_string()),
            is_builtin: true,
            created_at: "2026-05-09T00:00:00Z".to_string(),
            updated_at: "2026-05-09T00:00:00Z".to_string(),
        }
    }

    fn recipe(id: &str, prompt_template: &str, tool_requirements: Option<&str>) -> RecipeDefinition {
        RecipeDefinition {
            id: id.to_string(),
            project_id: "default".to_string(),
            credential_id: None,
            use_case_id: None,
            name: id.to_string(),
            description: None,
            category: None,
            prompt_template: prompt_template.to_string(),
            input_schema: None,
            output_contract: None,
            tool_requirements: tool_requirements.map(|s| s.to_string()),
            credential_requirements: None,
            model_preference: None,
            sample_inputs: None,
            tags: None,
            icon: None,
            color: None,
            is_builtin: true,
            created_at: "2026-05-09T00:00:00Z".to_string(),
            updated_at: "2026-05-09T00:00:00Z".to_string(),
            source_template_id: None,
            source_use_case_id: None,
            source_use_case_name: None,
            source_version: None,
        }
    }

    #[test]
    fn vacuous_eligibility_with_no_tool_hints() {
        let r = recipe("r1", r#"{"id":"uc","title":"X"}"#, None);
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
        assert!(result.required_tools.is_empty());
    }

    #[test]
    fn fully_wired_persona_is_eligible() {
        let r = recipe(
            "r1",
            r#"{"id":"uc","tool_hints":["file_read","gmail_search"]}"#,
            None,
        );
        let persona_tools = vec![td("file_read"), td("gmail_search"), td("notion_search")];
        let catalog = persona_tools.clone();
        let result = score_recipe_eligibility(&r, "p1", &persona_tools, &catalog);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
        assert_eq!(result.satisfied_tools, vec!["file_read", "gmail_search"]);
        assert!(result.missing_tools_addable.is_empty());
    }

    #[test]
    fn missing_but_catalogued_is_adoptable_with_setup() {
        let r = recipe(
            "r1",
            r#"{"id":"uc","tool_hints":["file_read","gmail_search"]}"#,
            None,
        );
        let persona_tools = vec![td("file_read")];
        let catalog = vec![td("file_read"), td("gmail_search")];
        let result = score_recipe_eligibility(&r, "p1", &persona_tools, &catalog);
        assert_eq!(result.state, RecipeEligibilityState::AdoptableWithSetup);
        assert_eq!(result.satisfied_tools, vec!["file_read"]);
        assert_eq!(result.missing_tools_addable, vec!["gmail_search"]);
        assert!(result.missing_tools_uncatalogued.is_empty());
    }

    #[test]
    fn uncatalogued_required_tool_is_incompatible() {
        let r = recipe(
            "r1",
            r#"{"id":"uc","tool_hints":["file_read","exotic_tool"]}"#,
            None,
        );
        let persona_tools = vec![td("file_read")];
        let catalog = vec![td("file_read")]; // exotic_tool not catalogued
        let result = score_recipe_eligibility(&r, "p1", &persona_tools, &catalog);
        assert_eq!(result.state, RecipeEligibilityState::Incompatible);
        assert_eq!(result.missing_tools_uncatalogued, vec!["exotic_tool"]);
    }

    #[test]
    fn incompatible_takes_precedence_over_addable() {
        // Mix of missing-but-catalogued AND missing-and-uncatalogued.
        // The presence of any uncatalogued tool flips state to Incompatible.
        let r = recipe(
            "r1",
            r#"{"id":"uc","tool_hints":["catalogued_missing","uncatalogued"]}"#,
            None,
        );
        let persona_tools: Vec<PersonaToolDefinition> = vec![];
        let catalog = vec![td("catalogued_missing")];
        let result = score_recipe_eligibility(&r, "p1", &persona_tools, &catalog);
        assert_eq!(result.state, RecipeEligibilityState::Incompatible);
        assert_eq!(result.missing_tools_addable, vec!["catalogued_missing"]);
        assert_eq!(result.missing_tools_uncatalogued, vec!["uncatalogued"]);
    }

    #[test]
    fn fallback_to_top_level_tool_requirements_when_prompt_template_lacks_hints() {
        let r = recipe(
            "r1",
            r#"{"id":"uc","title":"no hints field here"}"#,
            Some(r#"["file_read"]"#),
        );
        let persona_tools = vec![td("file_read")];
        let catalog = persona_tools.clone();
        let result = score_recipe_eligibility(&r, "p1", &persona_tools, &catalog);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
        assert_eq!(result.required_tools, vec!["file_read"]);
    }

    #[test]
    fn malformed_prompt_template_falls_through_gracefully() {
        // Prompt template isn't valid JSON — extraction returns empty,
        // recipe is vacuously Eligible. Defensive: a corrupted recipe
        // shouldn't drag the whole catalog into "Incompatible" land.
        let r = recipe("r1", "not valid json {{", None);
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
        assert!(result.required_tools.is_empty());
    }

    #[test]
    fn empty_tool_hints_array_does_not_block_fallback() {
        // tool_hints present but empty → fallback should consider
        // top-level tool_requirements next.
        let r = recipe(
            "r1",
            r#"{"id":"uc","tool_hints":[]}"#,
            Some(r#"["file_read"]"#),
        );
        let persona_tools = vec![td("file_read")];
        let catalog = persona_tools.clone();
        let result = score_recipe_eligibility(&r, "p1", &persona_tools, &catalog);
        assert_eq!(result.required_tools, vec!["file_read"]);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
    }

    #[test]
    fn corrupt_tool_requirements_json_blocks_as_incompatible() {
        // tool_requirements is declared but is not parseable JSON (truncated).
        // Previously this silently returned no requirements → Eligible → the
        // recipe could auto-adopt with incomplete tool wiring. Now it blocks.
        let r = recipe("r1", "a plain-text prompt, not a UC", Some(r#"["file_read""#));
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::Incompatible);
        assert!(result.required_tools.is_empty());
        assert_eq!(result.missing_tools_uncatalogued.len(), 1);
        assert!(result.missing_tools_uncatalogued[0].contains("tool_requirements"));
    }

    #[test]
    fn corrupt_tool_hints_shape_blocks_as_incompatible() {
        // tool_hints is present but a string, not an array — a corrupt canonical
        // signal with no fallback → block rather than vacuously Eligible.
        let r = recipe("r1", r#"{"id":"uc","tool_hints":"file_read"}"#, None);
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::Incompatible);
        assert_eq!(result.missing_tools_uncatalogued.len(), 1);
        assert!(result.missing_tools_uncatalogued[0].contains("tool_hints"));
    }

    #[test]
    fn tool_hints_with_non_string_entries_blocks() {
        // An array containing non-string entries is a corrupt shape.
        let r = recipe("r1", r#"{"id":"uc","tool_hints":["file_read",123]}"#, None);
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::Incompatible);
    }

    #[test]
    fn valid_json_wrong_shape_tool_requirements_stays_eligible() {
        // A legacy object-array tool_requirements is valid JSON but not a
        // string array. Preserve historical "no string requirements" behavior —
        // do NOT flip established recipes to Incompatible.
        let r = recipe(
            "r1",
            "plain prompt",
            Some(r#"[{"name":"file_read","category":"io"}]"#),
        );
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
        assert!(result.required_tools.is_empty());
        assert!(result.missing_tools_uncatalogued.is_empty());
    }

    #[test]
    fn null_or_empty_tool_requirements_is_not_corrupt() {
        for raw in [Some("null"), Some(""), Some("   "), None] {
            let r = recipe("r1", "plain prompt", raw);
            let result = score_recipe_eligibility(&r, "p1", &[], &[]);
            assert_eq!(
                result.state,
                RecipeEligibilityState::Eligible,
                "raw={raw:?} should be treated as no requirements"
            );
        }
    }

    #[test]
    fn corrupt_tool_hints_overridden_by_valid_tool_requirements() {
        // A broken tool_hints field must not block when a valid tool_requirements
        // fallback can still resolve the requirement set — only a true
        // both-paths-failed case blocks.
        let r = recipe(
            "r1",
            r#"{"id":"uc","tool_hints":5}"#,
            Some(r#"["file_read"]"#),
        );
        let persona_tools = vec![td("file_read")];
        let catalog = persona_tools.clone();
        let result = score_recipe_eligibility(&r, "p1", &persona_tools, &catalog);
        assert_eq!(result.required_tools, vec!["file_read"]);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
    }

    #[test]
    fn no_tool_signal_with_connectors_is_adoptable_with_setup_not_eligible() {
        // The core false-green-light fix: a recipe whose only declared
        // requirement is a connector (credential), with NO tool_hints, must
        // NOT score Eligible — it can't be verified, so it isn't one-click.
        let r = recipe("r1", r#"{"id":"uc","connectors":["gmail"]}"#, None);
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::AdoptableWithSetup);
        assert!(result.required_tools.is_empty());
    }

    #[test]
    fn no_tool_signal_with_object_shape_connectors_is_adoptable_with_setup() {
        // Connectors may be objects ({type, auth_type}) rather than slug
        // strings — both shapes must trigger the downgrade.
        let r = recipe(
            "r1",
            r#"{"id":"uc","connectors":[{"type":"gmail","auth_type":"oauth2"}]}"#,
            None,
        );
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::AdoptableWithSetup);
    }

    #[test]
    fn satisfied_tools_with_connectors_still_eligible() {
        // Genuine tool overlap must still report Eligible even when the recipe
        // also declares connectors — only the *no-tool-signal* case downgrades.
        let r = recipe(
            "r1",
            r#"{"id":"uc","tool_hints":["file_read"],"connectors":["gmail"]}"#,
            None,
        );
        let persona_tools = vec![td("file_read")];
        let catalog = persona_tools.clone();
        let result = score_recipe_eligibility(&r, "p1", &persona_tools, &catalog);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
    }

    #[test]
    fn no_tool_signal_and_empty_connectors_stays_vacuously_eligible() {
        // No tools AND no connectors → genuinely requirement-free → Eligible.
        let r = recipe("r1", r#"{"id":"uc","connectors":[]}"#, None);
        let result = score_recipe_eligibility(&r, "p1", &[], &[]);
        assert_eq!(result.state, RecipeEligibilityState::Eligible);
        assert!(result.required_tools.is_empty());
    }
}
