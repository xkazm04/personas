//! Declarative model-routing cascade (fabro "model stylesheet" lesson, F10).
//!
//! Fabro routes each workflow node to a model via a CSS-like stylesheet whose
//! rules apply by selector specificity. Personas has no node graph, but the same
//! *specificity cascade* maps cleanly onto persona model selection: a list of
//! rules, each matching by `persona_id` (most specific), `category`, or universal
//! (least specific), resolving to a `(model, effort)`. This lets an operator say
//! "all `research` personas use opus, utility ones use haiku, this one uses
//! sonnet" without editing each persona's `model_profile` — the foundation the
//! per-use-case `_recipe_seeds.json` tiering wants to grow into.
//!
//! Precedence (highest wins, mirroring fabro "explicit node attr beats stylesheet"):
//!   explicit `persona.model_profile.model` > persona_id rule > category rule > universal rule.
//! Resolution here only fills the model when the persona has NO explicit one.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::DbPool;

/// Settings key storing the rules as a JSON array.
pub const MODEL_ROUTING_RULES_KEY: &str = "model_routing_rules";

/// Valid effort tiers (mirrors `modelCatalog.ts` EFFORT_LEVELS).
const EFFORT_LEVELS: &[&str] = &["low", "medium", "high", "xhigh"];

/// What a rule matches against. An all-`None` match is the universal default.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RoutingMatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub persona_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub category: Option<String>,
}

/// One routing rule: a selector + the model/effort it resolves to.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoutingRule {
    #[serde(default)]
    pub r#match: RoutingMatch,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub effort: Option<String>,
}

/// The result of resolving the cascade for a persona.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedModel {
    pub model: String,
    pub effort: Option<String>,
}

/// Specificity of a match: persona_id (3) > category (2) > universal (0).
fn specificity(m: &RoutingMatch) -> u8 {
    if m.persona_id.is_some() {
        3
    } else if m.category.is_some() {
        2
    } else {
        0
    }
}

/// Does a rule's selector apply to this persona?
fn rule_applies(m: &RoutingMatch, persona_id: &str, category: Option<&str>) -> bool {
    if let Some(want) = &m.persona_id {
        if want != persona_id {
            return false;
        }
    }
    if let Some(want) = &m.category {
        if category != Some(want.as_str()) {
            return false;
        }
    }
    true
}

/// Resolve the winning rule for a persona. Highest specificity wins; later rules
/// win ties (last-declared wins, mirroring CSS source order).
#[must_use]
pub fn resolve(
    rules: &[ModelRoutingRule],
    persona_id: &str,
    category: Option<&str>,
) -> Option<ResolvedModel> {
    let mut best: Option<(&ModelRoutingRule, u8)> = None;
    for rule in rules {
        if !rule_applies(&rule.r#match, persona_id, category) {
            continue;
        }
        let spec = specificity(&rule.r#match);
        match best {
            // `>=` so a later rule of equal specificity wins the tie.
            Some((_, bspec)) if spec >= bspec => best = Some((rule, spec)),
            None => best = Some((rule, spec)),
            _ => {}
        }
    }
    best.map(|(rule, _)| ResolvedModel {
        model: rule.model.clone(),
        effort: rule.effort.clone(),
    })
}

/// Validate a rule set, returning human-readable diagnostics (empty = valid).
/// Catches blank models and unknown effort tiers before a run hits them.
#[must_use]
pub fn validate(rules: &[ModelRoutingRule]) -> Vec<String> {
    let mut diags = Vec::new();
    for (i, rule) in rules.iter().enumerate() {
        if rule.model.trim().is_empty() {
            diags.push(format!("rule {i}: model must not be empty"));
        }
        if let Some(effort) = &rule.effort {
            if !EFFORT_LEVELS.contains(&effort.as_str()) {
                diags.push(format!(
                    "rule {i}: unknown effort '{effort}' (expected one of {EFFORT_LEVELS:?})"
                ));
            }
        }
    }
    diags
}

/// Load the persisted rule set (empty when unset or malformed).
#[must_use]
pub fn load_rules(db: &DbPool) -> Vec<ModelRoutingRule> {
    crate::db::repos::core::settings::get(db, MODEL_ROUTING_RULES_KEY)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str::<Vec<ModelRoutingRule>>(&json).ok())
        .unwrap_or_default()
}

/// Convenience: resolve the routing model for a persona from persisted rules.
/// The `category` selector matches the persona's lowercase `template_category`
/// (e.g. `"development"`, `"finance"`) — the natural tiering dimension.
#[must_use]
pub fn resolve_for_persona(db: &DbPool, persona: &crate::db::models::Persona) -> Option<ResolvedModel> {
    let rules = load_rules(db);
    if rules.is_empty() {
        return None;
    }
    resolve(&rules, &persona.id, persona.template_category.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(persona_id: Option<&str>, category: Option<&str>, model: &str, effort: Option<&str>) -> ModelRoutingRule {
        ModelRoutingRule {
            r#match: RoutingMatch {
                persona_id: persona_id.map(str::to_string),
                category: category.map(str::to_string),
            },
            model: model.to_string(),
            effort: effort.map(str::to_string),
        }
    }

    #[test]
    fn persona_id_beats_category_beats_universal() {
        let rules = vec![
            rule(None, None, "haiku", Some("low")),          // universal
            rule(None, Some("research"), "sonnet", None),    // category
            rule(Some("p1"), None, "opus", Some("high")),    // specific
        ];
        // p1 in research → most specific wins.
        let r = resolve(&rules, "p1", Some("research")).unwrap();
        assert_eq!(r.model, "opus");
        assert_eq!(r.effort.as_deref(), Some("high"));
        // p2 in research → category wins.
        assert_eq!(resolve(&rules, "p2", Some("research")).unwrap().model, "sonnet");
        // p3 uncategorized → universal.
        assert_eq!(resolve(&rules, "p3", None).unwrap().model, "haiku");
    }

    #[test]
    fn no_match_returns_none() {
        let rules = vec![rule(Some("only-this"), None, "opus", None)];
        assert!(resolve(&rules, "other", None).is_none());
    }

    #[test]
    fn later_rule_wins_specificity_tie() {
        let rules = vec![
            rule(None, Some("x"), "first", None),
            rule(None, Some("x"), "second", None),
        ];
        assert_eq!(resolve(&rules, "p", Some("x")).unwrap().model, "second");
    }

    #[test]
    fn validate_flags_blank_model_and_bad_effort() {
        let rules = vec![
            rule(None, None, "", None),
            rule(Some("p"), None, "opus", Some("ultra")),
        ];
        let diags = validate(&rules);
        assert_eq!(diags.len(), 2);
        assert!(diags[0].contains("model must not be empty"));
        assert!(diags[1].contains("unknown effort"));
    }

    #[test]
    fn validate_accepts_good_rules() {
        let rules = vec![rule(Some("p"), None, "claude-opus-4-8", Some("high"))];
        assert!(validate(&rules).is_empty());
    }
}
