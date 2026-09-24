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

use personas_core::models::Difficulty;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::DbPool;

/// Settings key storing the rules as a JSON array.
pub const MODEL_ROUTING_RULES_KEY: &str = "model_routing_rules";

/// Valid effort tiers (mirrors `modelCatalog.ts` EFFORT_LEVELS).
pub const EFFORT_LEVELS: &[&str] = &["low", "medium", "high", "xhigh"];

/// Is `effort` one of [`EFFORT_LEVELS`]? An effort value becomes a CLI argv
/// token (`--effort <v>`), so every door that forwards one checks it here
/// rather than trusting whatever a spec, a rule or a model wrote.
#[must_use]
pub fn is_valid_effort(effort: &str) -> bool {
    EFFORT_LEVELS.contains(&effort)
}

/// The difficulty routing table (spark `resource-aware-orchestration`): what a
/// charter's declared [`Difficulty`] buys when nothing more specific chose a
/// model. Returns `(model tier slug, effort)`; the slug is resolved to a
/// concrete id by `personas_engine::prompt::tier_slug_to_model_id` - the one
/// slug -> id map - so a model rename never touches this table.
///
/// Precedence, highest first (enforced by
/// `personas_engine::prompt::resolve_charter_model_choice`; operator decision
/// Q15, 2026-09-18): explicit `spec.modelOverride` > THIS table, for a charter
/// whose profile was DECLARED > the persona's own `model_profile` > the routing
/// cascade ([`resolve_for_persona`]) > the capability default. An untagged
/// charter never reaches this table.
///
/// The Charter editor draws this table (`DIFFICULTY_ROUTE` in
/// `src/features/agents/sub_responsibilities/libs/charterSpec.ts`); the test
/// `the_charter_editor_resource_tables_are_pinned_here` fails when they part.
#[must_use]
pub fn route_for_difficulty(d: Difficulty) -> (&'static str, &'static str) {
    match d {
        Difficulty::Light => ("haiku", "low"),
        Difficulty::Standard => ("sonnet", "medium"),
        Difficulty::Hard => ("opus", "high"),
    }
}

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

/// Provenance stamp for a rule written by an applied Self-Tuning proposal
/// (batch-3 learning grammar: every learned rule is auditable back to the
/// evidence that produced it). Hand-authored rules carry `None`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RuleProvenance {
    /// `policy_proposals.id` the operator approved.
    pub proposal_id: String,
    /// `PolicyEvidenceSnapshot.id` the proposal was derived from.
    pub evidence_snapshot_id: String,
    pub applied_at: String,
    /// Human-readable one-line claim recorded at apply time.
    pub claim: String,
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
    /// Present iff this rule was written by an applied Self-Tuning proposal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub provenance: Option<RuleProvenance>,
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
    crate::repos::core::settings::get(db, MODEL_ROUTING_RULES_KEY)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str::<Vec<ModelRoutingRule>>(&json).ok())
        .unwrap_or_default()
}

/// Convenience: resolve the routing model for a persona from persisted rules.
/// The `category` selector matches the persona's lowercase `template_category`
/// (e.g. `"development"`, `"finance"`) — the natural tiering dimension.
#[must_use]
pub fn resolve_for_persona(db: &DbPool, persona: &crate::models::Persona) -> Option<ResolvedModel> {
    let rules = load_rules(db);
    if rules.is_empty() {
        return None;
    }
    resolve(&rules, &persona.id, persona.template_category.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(
        persona_id: Option<&str>,
        category: Option<&str>,
        model: &str,
        effort: Option<&str>,
    ) -> ModelRoutingRule {
        ModelRoutingRule {
            r#match: RoutingMatch {
                persona_id: persona_id.map(str::to_string),
                category: category.map(str::to_string),
            },
            model: model.to_string(),
            effort: effort.map(str::to_string),
            provenance: None,
        }
    }

    #[test]
    fn persona_id_beats_category_beats_universal() {
        let rules = vec![
            rule(None, None, "haiku", Some("low")),       // universal
            rule(None, Some("research"), "sonnet", None), // category
            rule(Some("p1"), None, "opus", Some("high")), // specific
        ];
        // p1 in research → most specific wins.
        let r = resolve(&rules, "p1", Some("research")).unwrap();
        assert_eq!(r.model, "opus");
        assert_eq!(r.effort.as_deref(), Some("high"));
        // p2 in research → category wins.
        assert_eq!(
            resolve(&rules, "p2", Some("research")).unwrap().model,
            "sonnet"
        );
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
    fn difficulty_route_table_maps_each_band_to_a_valid_tier_and_effort() {
        assert_eq!(route_for_difficulty(Difficulty::Light), ("haiku", "low"));
        assert_eq!(
            route_for_difficulty(Difficulty::Standard),
            ("sonnet", "medium")
        );
        assert_eq!(route_for_difficulty(Difficulty::Hard), ("opus", "high"));
        for d in [Difficulty::Light, Difficulty::Standard, Difficulty::Hard] {
            assert!(is_valid_effort(route_for_difficulty(d).1));
        }
        assert!(!is_valid_effort("ultra"));
    }

    /// The tripwire for the five resource tables the Charter editor re-declares.
    ///
    /// `src/features/agents/sub_responsibilities/libs/charterSpec.ts` draws what
    /// a profile tag COSTS - the default profile, the machine and plan units,
    /// the token range of each effort band, the tier a difficulty routes to. No
    /// payload carries those numbers and no ts-rs binding can (they are method
    /// bodies, not shapes), so they exist twice: here and in `personas_core`,
    /// where they are enforced, and there, where they are drawn. The client
    /// cannot be the one to notice a change, because the change happens HERE.
    /// So the tripwire lives here too, per
    /// `docs/concepts/golden-paths/client-rule-mirroring.md` rung (e), "put the
    /// tripwire on the side that CHANGES" (precedents:
    /// `settings_keys.rs::the_settings_ui_steppers_bounds_are_pinned_here`,
    /// `core/src/types.rs`'s TERMINAL / ACTIVE pinning). It lives in THIS crate
    /// because this is the lowest one that sees all five: `route_for_difficulty`
    /// is here and `crate::models` is `personas_core::models`.
    ///
    /// Two halves. The first pins the Rust values, so a change fails with the
    /// name of the TypeScript constant to update. The second READS the
    /// TypeScript file and checks each table is spelled with the values Rust
    /// just produced, so editing only one side fails too - in either direction.
    ///
    /// **If this test fails, the Charter editor is now wrong.** Update the named
    /// constant in `charterSpec.ts` in the same change, then the numbers below.
    /// Do not just change the numbers below.
    #[test]
    fn the_charter_editor_resource_tables_are_pinned_here() {
        use crate::models::{EffortBand, GpuClass, MachineLoad, ProfileSource, ResourceProfile};

        const TS: &str = "src/features/agents/sub_responsibilities/libs/charterSpec.ts";
        // A tag spelled with the word the wire (and therefore the editor) uses.
        fn tag<T: serde::Serialize>(t: &T) -> String {
            serde_json::to_value(t)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .expect("a profile tag serializes to a word")
        }

        // -- 1. The Rust side, pinned ---------------------------------------
        let d = ResourceProfile::default();
        assert_eq!(
            (d.machine, d.gpu, d.difficulty, d.effort, d.pinned, d.source),
            (
                MachineLoad::Light,
                GpuClass::None,
                Difficulty::Standard,
                EffortBand::M,
                false,
                ProfileSource::Default
            ),
            "ResourceProfile::default changed - update DEFAULT_PROFILE_DRAFT in {TS}"
        );
        let machines = [
            MachineLoad::Light,
            MachineLoad::Moderate,
            MachineLoad::Heavy,
            MachineLoad::Exclusive,
        ];
        assert_eq!(
            machines.map(|m| m.units()),
            [1, 2, 4, 8],
            "MachineLoad::units changed - update MACHINE_UNITS in {TS}"
        );
        let bands = [EffortBand::S, EffortBand::M, EffortBand::L, EffortBand::Xl];
        assert_eq!(
            bands.map(|b| b.units()),
            [1, 2, 4, 8],
            "EffortBand::units changed - update EFFORT_UNITS in {TS}"
        );
        // Each edge is the FIRST token count of the next band.
        let edges: [u64; 3] = [50_000, 250_000, 1_000_000];
        for (i, edge) in edges.iter().enumerate() {
            assert_eq!(
                (
                    EffortBand::from_total_tokens(edge - 1),
                    EffortBand::from_total_tokens(*edge)
                ),
                (bands[i], bands[i + 1]),
                "EffortBand::from_total_tokens band edges changed - update \
                 EFFORT_TOKEN_RANGE in {TS}"
            );
        }
        let difficulties = [Difficulty::Light, Difficulty::Standard, Difficulty::Hard];
        assert_eq!(
            difficulties.map(route_for_difficulty),
            [("haiku", "low"), ("sonnet", "medium"), ("opus", "high")],
            "route_for_difficulty changed - update DIFFICULTY_ROUTE in {TS}"
        );

        // -- 2. The TypeScript side, read as text ---------------------------
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(TS);
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        // Whitespace, numeric separators and trailing commas are formatting.
        let squash = |s: &str| {
            s.chars()
                .filter(|c| !c.is_whitespace() && *c != '_')
                .collect::<String>()
                .replace(",}", "}")
        };
        let source = squash(&source);
        let table = |rows: Vec<String>| format!("{{{}}}", rows.join(","));
        let bound = |n: Option<u64>| n.map_or("null".to_string(), |n| n.to_string());

        let expected = [
            (
                "DEFAULT_PROFILE_DRAFT",
                format!(
                    "DEFAULT_PROFILE_DRAFT:ResourceProfileDraft={{machine:'{}',gpu:'{}',\
                     difficulty:'{}',effort:'{}',pinned:{}}}",
                    tag(&d.machine),
                    tag(&d.gpu),
                    tag(&d.difficulty),
                    tag(&d.effort),
                    d.pinned
                ),
            ),
            (
                "MACHINE_UNITS",
                format!(
                    "MACHINE_UNITS:Record<MachineLoad,number>={}",
                    table(
                        machines
                            .iter()
                            .map(|m| format!("{}:{}", tag(m), m.units()))
                            .collect()
                    )
                ),
            ),
            (
                "EFFORT_UNITS",
                format!(
                    "EFFORT_UNITS:Record<EffortBand,number>={}",
                    table(
                        bands
                            .iter()
                            .map(|b| format!("{}:{}", tag(b), b.units()))
                            .collect()
                    )
                ),
            ),
            (
                "EFFORT_TOKEN_RANGE",
                format!(
                    "}}>={}",
                    table(
                        bands
                            .iter()
                            .enumerate()
                            .map(|(i, b)| format!(
                                "{}:{{from:{},to:{}}}",
                                tag(b),
                                bound(i.checked_sub(1).map(|j| edges[j])),
                                bound(edges.get(i).copied())
                            ))
                            .collect()
                    )
                ),
            ),
            (
                "DIFFICULTY_ROUTE",
                format!(
                    "}}>={}",
                    table(
                        difficulties
                            .iter()
                            .map(|df| {
                                let (model, effort) = route_for_difficulty(*df);
                                format!("{}:{{model:'{model}',effort:'{effort}'}}", tag(df))
                            })
                            .collect()
                    )
                ),
            ),
        ];
        for (constant, needle) in expected {
            assert!(
                source.contains(&squash(constant)),
                "{constant} is gone from {TS} - this tripwire no longer guards it"
            );
            assert!(
                source.contains(&squash(&needle)),
                "{constant} in {TS} no longer says what Rust says. Expected (whitespace and \
                 numeric separators aside): {needle}"
            );
        }
    }

    #[test]
    fn validate_accepts_good_rules() {
        let rules = vec![rule(Some("p"), None, "claude-opus-5", Some("high"))];
        assert!(validate(&rules).is_empty());
    }
}
