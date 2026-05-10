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
//! Connectors are NOT scored in v1. The recipe's `connectors[]` field
//! lists credential-type requirements (e.g. `{type: "gmail",
//! auth_type: "oauth2"}`). E.2 (adoption command) will hydrate those
//! against the persona's wired credentials; E.1 stays focused on the
//! tool-name comparison so the scoring stays cheap and deterministic.

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
    /// serialized UC. Empty vec means the recipe has no tool
    /// requirements (vacuously eligible against any persona).
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
    let required = extract_required_tools(recipe);
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

    let state = if !missing_uncatalogued.is_empty() {
        RecipeEligibilityState::Incompatible
    } else if !missing_addable.is_empty() {
        RecipeEligibilityState::AdoptableWithSetup
    } else {
        // No required tools at all → Eligible (vacuous).
        // All required tools satisfied → Eligible.
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

/// Extract a recipe's required tool names from its `prompt_template`
/// (the serialized UC). Reads `tool_hints[]` first (post-2.2 canonical
/// signal); falls back to the top-level `tool_requirements` JSON
/// (older derivation path that some pre-2.2 recipes still carry).
///
/// Returns an empty Vec when nothing parseable is present — the
/// caller treats that as "no tool requirements" (vacuously Eligible).
fn extract_required_tools(recipe: &RecipeDefinition) -> Vec<String> {
    // Prefer tool_hints from the serialized UC.
    if let Ok(uc) = serde_json::from_str::<serde_json::Value>(&recipe.prompt_template) {
        if let Some(hints) = uc.get("tool_hints").and_then(|v| v.as_array()) {
            let names: Vec<String> = hints
                .iter()
                .filter_map(|h| h.as_str().map(|s| s.to_string()))
                .collect();
            if !names.is_empty() {
                return names;
            }
        }
    }
    // Fallback: top-level tool_requirements (legacy / hand-crafted recipes).
    if let Some(raw) = recipe.tool_requirements.as_deref() {
        if let Ok(arr) = serde_json::from_str::<Vec<String>>(raw) {
            return arr;
        }
    }
    Vec::new()
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
}
