use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;
use crate::models::responsibility::ResponsibilityOutcome;

// ============================================================================
// Recipe Definitions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeDefinition {
    pub id: String,
    pub project_id: String,
    pub credential_id: Option<String>,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub output_contract: Option<String>,
    pub tool_requirements: Option<String>,
    pub credential_requirements: Option<String>,
    pub model_preference: Option<String>,
    pub sample_inputs: Option<String>,
    pub tags: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
    // 2026-05-09 — Stage B Phase 1a: provenance for template-derived recipes.
    // Set by the derive_recipes_from_template flow (Phase 1b); NULL for
    // user-authored recipes. The (source_template_id, source_use_case_id)
    // pair is unique-indexed (partial, NULL-tolerant).
    pub source_template_id: Option<String>,
    pub source_use_case_id: Option<String>,
    pub source_use_case_name: Option<String>,
    pub source_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateRecipeInput {
    pub credential_id: Option<String>,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub output_contract: Option<String>,
    pub tool_requirements: Option<String>,
    pub credential_requirements: Option<String>,
    pub model_preference: Option<String>,
    pub sample_inputs: Option<String>,
    pub tags: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    // 2026-05-09 — Stage B Phase 1a: only the derive_recipes_from_template
    // flow should set these; user-facing create paths leave them None.
    pub source_template_id: Option<String>,
    pub source_use_case_id: Option<String>,
    pub source_use_case_name: Option<String>,
    pub source_version: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateRecipeInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub prompt_template: Option<String>,
    pub input_schema: Option<String>,
    pub output_contract: Option<String>,
    pub tool_requirements: Option<String>,
    pub credential_requirements: Option<String>,
    pub model_preference: Option<String>,
    pub sample_inputs: Option<String>,
    pub tags: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    // 2026-05-09 — Stage B Phase 1a: only the derive_recipes_from_template
    // flow should bump source_version + source_use_case_name when a template
    // author edits a UC. source_template_id and source_use_case_id should be
    // immutable post-creation; not exposed here.
    pub source_use_case_name: Option<String>,
    pub source_version: Option<String>,
}

// ============================================================================
// Persona <-> Recipe Links
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaRecipeLink {
    pub id: String,
    pub persona_id: String,
    pub recipe_id: String,
    pub sort_order: i32,
    pub config: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaRecipeLinkInput {
    pub persona_id: String,
    pub recipe_id: String,
    pub sort_order: Option<i32>,
    pub config: Option<String>,
}

// ============================================================================
// Recipe Generation (from description)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GenerateRecipeDraftInput {
    pub credential_id: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeDraft {
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub tags: Option<String>,
    pub example_result: Option<String>,
    pub sample_inputs: Option<String>,
}

// ============================================================================
// Recipe Execution (Test Runner)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeExecutionInput {
    pub recipe_id: String,
    pub input_data: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeExecutionResult {
    pub recipe_id: String,
    pub recipe_name: String,
    pub rendered_prompt: String,
    pub llm_output: Option<String>,
    pub input_data: std::collections::HashMap<String, serde_json::Value>,
    pub executed_at: String,
}

// ============================================================================
// Recipe Versions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeVersion {
    pub id: String,
    pub recipe_id: String,
    pub version_number: i32,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub sample_inputs: Option<String>,
    pub description: Option<String>,
    pub changes_summary: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeVersionDraft {
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub sample_inputs: Option<String>,
    pub description: Option<String>,
    pub changes_summary: Option<String>,
}

// ============================================================================
// Recipe Derivation (Stage B Phase 1b)
// ============================================================================

/// Outcome of deriving a single use case from a template into a recipe row.
/// `Created` — no recipe existed for `(template_id, use_case_id)`; a new one was inserted.
/// `Updated` — a recipe existed but the use case content changed; row was updated and `source_version` bumped.
/// `Unchanged` — a recipe existed and the use case content is unchanged; nothing written.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum DeriveAction {
    Created,
    Updated,
    Unchanged,
}

/// Per-use-case result returned by `derive_recipes_from_template`. The caller
/// can aggregate these into a migration log for idempotency verification.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeriveResult {
    pub use_case_id: String,
    pub use_case_name: Option<String>,
    pub recipe_id: String,
    pub action: DeriveAction,
    pub source_version: String,
}

// ============================================================================
// Recipe v3 — the registry artifact (craftsman knowledge)
// ============================================================================
//
// Contract: `scripts/templates/_RECIPE_V3_SPEC.md`.
//
// A v3 recipe is MASTERY, not configuration: the best current knowledge of how
// one kind of work is done well. Everything that binds it to one installation
// (which connector, which trigger, which credentials, which persona) happens at
// ADOPTION and lands on the charter (`PersonaResponsibility`), never here. That
// is why this type carries connector TYPES and a RECOMMENDED trigger rather
// than a connector id and a cron.
//
// `RecipeDefinition` above is the DB row (`recipe_definitions`); `RecipeSpec`
// is the payload its `prompt_template` column holds from seed-bundle version 3
// onward (see `src-tauri/src/engine/recipe_seed.rs`).

/// The four things a reader needs about a recipe, always in this order.
/// v2 mixed one-liners, sequences and paragraphs into one `procedure` string;
/// splitting them is the point.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeDescription {
    /// Why the work exists, as a claim about what goes wrong without it.
    #[serde(default)]
    pub need: String,
    /// What the work starts from (data, artifacts, signals).
    #[serde(default)]
    pub input: String,
    /// The judgment at the centre, one or two sentences.
    #[serde(default)]
    pub core_action: String,
    /// What exists in the world when it is done well.
    #[serde(default)]
    pub output: String,
}

/// One step of the COARSE shape of the work — for a reader and a diagram, not
/// for a machine. Deliberately NOT the `use_case_flow` graph this replaced:
/// linear, branch-free, no edges, no conditions. If it needs a branch it is a
/// runbook and it does not belong on a recipe.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeActivity {
    pub id: String,
    /// A phrase, not an instruction.
    #[serde(default)]
    pub label: String,
    /// `observe` | `decide` | `act` | `deliver`.
    #[serde(default)]
    pub kind: String,
}

/// A recommendation about WHEN the work wants to run. Never a binding: no
/// cron, no interval, no event name. The adopter assigns the real trigger.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeTriggerRecommendation {
    /// `event` | `time` | `self_paced`.
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub rationale: String,
}

/// Concrete-solution knowledge: what was learned mapping this recipe onto ONE
/// specific connector. The only place a connector id may appear on a recipe.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeExample {
    #[serde(default)]
    pub title: String,
    /// The concrete connector id (e.g. `deepgram`).
    #[serde(default)]
    pub connector: String,
    /// The catalog category that connector was chosen for.
    #[serde(default)]
    pub connector_type: String,
    #[serde(default)]
    pub notes: String,
}

/// Where the recipe's content came from, so a consolidation is auditable.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeProvenance {
    /// v2 recipe ids this recipe supersedes or absorbed.
    #[serde(default)]
    pub from_recipes: Vec<String>,
    /// Template ids whose designed responsibilities fed it.
    #[serde(default)]
    pub from_templates: Vec<String>,
    /// The v2 seed row's `source_template_id`, carried verbatim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_template_id: Option<String>,
}

/// One named ROLE a connector plays in the work.
///
/// A flat type list cannot say "two connectors of this type, in different
/// roles": a code-review recipe needs a local checkout AND a hosted review
/// surface, both `source_control`. Roles say it. When a recipe declares none,
/// every declared type is one role whose name IS the type — which is why the
/// existing `credential_bindings` seam (keyed by type) keeps working unchanged
/// in the common case.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeConnectorRole {
    /// Unique within the recipe; the key adoption binds against.
    pub role: String,
    /// A connector catalog category, same vocabulary as `connector_types`.
    #[serde(rename = "type", default)]
    pub connector_type: String,
    /// What this connector is FOR, in one phrase.
    #[serde(default)]
    pub note: String,
}

/// One connector role as ADOPTION left it: the role, the type it wanted, and
/// the concrete connector bound to it — or `None`, which is a question the
/// adopter still owes an answer to and never a silent default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CharterConnectorBinding {
    pub role: String,
    #[serde(default)]
    pub connector_type: String,
    /// `None` = unresolved. The charter's `connectors` allowlist is a runtime
    /// gate, so an unbound role binds NOTHING rather than guessing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connector: Option<String>,
}

/// The pointer a minted charter keeps back to the recipe it came from, so a
/// lesson learned in the field can be proposed back into the registry artifact.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRef {
    pub slug: String,
    #[serde(default)]
    pub version: String,
}

/// The v3 recipe payload. Every non-`id` field is `#[serde(default)]` so a
/// partially authored v3 object still parses — completeness is
/// [`RecipeSpec::validate`]'s job, not serde's, and a reviewed corpus lands
/// field by field.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSpec {
    /// Stable uuid, unchanged from v2 — the seed row id.
    pub id: String,
    /// kebab-case; the registry folder name.
    #[serde(default)]
    pub slug: String,
    /// AREA + ACTIVITY, unambiguous on its own in a list of 200.
    #[serde(default)]
    pub title: String,
    /// semver; `0.x` = seed knowledge that matures with use.
    #[serde(default)]
    pub version: String,
    /// `seed` | `maturing` | `proven`.
    #[serde(default)]
    pub status: String,
    /// `<domain>/<topic>` in the registry lane.
    #[serde(default)]
    pub path: String,
    /// The closed 16-family domain vocabulary, unchanged from v2.
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub description: RecipeDescription,
    /// 3..=8 coarse steps. See [`RecipeActivity`].
    #[serde(default)]
    pub activities: Vec<RecipeActivity>,
    /// Claims about the world, with how anyone could tell. The same type the
    /// charter carries, so adoption copies rather than translates.
    #[serde(default)]
    pub outcomes: Vec<ResponsibilityOutcome>,
    /// 40-90 words of judgment. Never numbered steps, never a tool order.
    #[serde(default)]
    pub guidance: String,
    /// Connector catalog `categories` values (`transcription`, `analytics`,
    /// ...), NEVER a connector id and never `desktop`. When
    /// [`Self::connector_roles`] is non-empty this is the DERIVED flat list:
    /// the distinct types of the roles.
    #[serde(default)]
    pub connector_types: Vec<String>,
    /// Named roles, when the work needs more than one connector of the same
    /// type. Optional; see [`RecipeConnectorRole`] and
    /// [`Self::effective_roles`].
    #[serde(default)]
    pub connector_roles: Vec<RecipeConnectorRole>,
    #[serde(default)]
    pub recommended_trigger: RecipeTriggerRecommendation,
    /// What adoption must learn from the adopter, and why.
    #[serde(default)]
    pub personalization_needs: Vec<String>,
    /// Things adoption must install or verify before the first run.
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// The knobs, unchanged from v2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub input_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub examples: Vec<RecipeExample>,
    /// Append-only; promoted from charter memory by proposal.
    #[serde(default)]
    pub lessons: Vec<String>,
    #[serde(default)]
    pub provenance: RecipeProvenance,
}

/// The `kind` vocabulary for [`RecipeActivity`].
pub const RECIPE_ACTIVITY_KINDS: &[&str] = &["observe", "decide", "act", "deliver"];
/// The `status` vocabulary for [`RecipeSpec`].
pub const RECIPE_STATUSES: &[&str] = &["seed", "maturing", "proven"];
/// The `kind` vocabulary for [`RecipeTriggerRecommendation`].
pub const RECIPE_TRIGGER_KINDS: &[&str] = &["event", "time", "self_paced"];
/// Fewer than this and the shape of the work is not visible.
pub const RECIPE_MIN_ACTIVITIES: usize = 3;
/// More than this and it has become a runbook.
pub const RECIPE_MAX_ACTIVITIES: usize = 8;
/// Never a connector type: every agent has desktop access, so declaring it
/// would make an unbindable requirement out of a universal capability.
pub const RECIPE_FORBIDDEN_CONNECTOR_TYPE: &str = "desktop";

impl RecipeSpec {
    /// Every way this recipe falls short of the v3 contract, not just the
    /// first — one rejection can tell an author about all of its problems.
    ///
    /// `known_connector_categories` is the connector catalog's own plural
    /// `categories` vocabulary. It is a parameter rather than a lookup because
    /// the catalog lives in `personas-db`, one crate above this one; callers
    /// pass `personas_db::connector_categories::KNOWN_CONNECTOR_CATEGORIES`.
    pub fn validation_errors(&self, known_connector_categories: &[&str]) -> Vec<String> {
        let mut errors = Vec::new();

        if self.title.trim().is_empty() {
            errors.push("title is empty".to_string());
        }
        if !RECIPE_STATUSES.contains(&self.status.as_str()) {
            errors.push(format!(
                "status '{}' is not one of: {}",
                self.status,
                RECIPE_STATUSES.join(", ")
            ));
        }

        let count = self.activities.len();
        if !(RECIPE_MIN_ACTIVITIES..=RECIPE_MAX_ACTIVITIES).contains(&count) {
            errors.push(format!(
                "activities has {count} entries; the contract is {RECIPE_MIN_ACTIVITIES} to {RECIPE_MAX_ACTIVITIES}"
            ));
        }
        for (idx, activity) in self.activities.iter().enumerate() {
            if activity.id.trim().is_empty() {
                errors.push(format!("activities[{idx}] has no id"));
            }
            if activity.label.trim().is_empty() {
                errors.push(format!("activities[{idx}] has no label"));
            }
            if !RECIPE_ACTIVITY_KINDS.contains(&activity.kind.as_str()) {
                errors.push(format!(
                    "activities[{idx}] kind '{}' is not one of: {}",
                    activity.kind,
                    RECIPE_ACTIVITY_KINDS.join(", ")
                ));
            }
        }

        if !RECIPE_TRIGGER_KINDS.contains(&self.recommended_trigger.kind.as_str()) {
            errors.push(format!(
                "recommendedTrigger.kind '{}' is not one of: {}",
                self.recommended_trigger.kind,
                RECIPE_TRIGGER_KINDS.join(", ")
            ));
        }

        for (idx, raw) in self.connector_types.iter().enumerate() {
            let ct = raw.trim();
            if ct.is_empty() {
                errors.push(format!("connectorTypes[{idx}] is empty"));
                continue;
            }
            if ct == RECIPE_FORBIDDEN_CONNECTOR_TYPE {
                errors.push(
                    "connectorTypes carries 'desktop', which is never a connector type: every agent has desktop access"
                        .to_string(),
                );
                continue;
            }
            if !known_connector_categories.contains(&ct) {
                errors.push(format!(
                    "connectorTypes[{idx}] '{ct}' is not a connector catalog category"
                ));
            }
        }

        let mut seen_roles: Vec<&str> = Vec::new();
        for (idx, role) in self.connector_roles.iter().enumerate() {
            let name = role.role.trim();
            if name.is_empty() {
                errors.push(format!("connectorRoles[{idx}] has no role name"));
            } else if seen_roles.contains(&name) {
                // Roles are the binding KEY. Two roles with one name means one
                // of them can never be bound, and which one is arbitrary.
                errors.push(format!("connectorRoles has a duplicate role '{name}'"));
            } else {
                seen_roles.push(name);
            }

            let rt = role.connector_type.trim();
            if rt.is_empty() {
                errors.push(format!("connectorRoles[{idx}] has no type"));
            } else if rt == RECIPE_FORBIDDEN_CONNECTOR_TYPE {
                errors.push(format!(
                    "connectorRoles[{idx}] type is 'desktop', which is never a connector type"
                ));
            } else if !known_connector_categories.contains(&rt) {
                errors.push(format!(
                    "connectorRoles[{idx}] type '{rt}' is not a connector catalog category"
                ));
            }
        }

        // `connector_types` is DERIVED when roles are present. Letting the two
        // drift would give the offer list and the role list different answers
        // about what this recipe needs.
        if !self.connector_roles.is_empty() {
            let mut from_roles: Vec<&str> = Vec::new();
            for role in &self.connector_roles {
                let rt = role.connector_type.trim();
                if !rt.is_empty() && !from_roles.contains(&rt) {
                    from_roles.push(rt);
                }
            }
            let mut declared: Vec<&str> = Vec::new();
            for t in &self.connector_types {
                let t = t.trim();
                if !t.is_empty() && !declared.contains(&t) {
                    declared.push(t);
                }
            }
            from_roles.sort_unstable();
            declared.sort_unstable();
            if from_roles != declared {
                errors.push(format!(
                    "connectorTypes {declared:?} is not the distinct type set of connectorRoles {from_roles:?}"
                ));
            }
        }

        errors
    }

    /// The roles adoption binds against: the declared [`Self::connector_roles`]
    /// when there are any, otherwise one synthesized role per declared type
    /// whose NAME is the type — which is what makes the pre-existing
    /// type-keyed `credential_bindings` seam keep working untouched for the
    /// common (role-less) recipe. `desktop` and blanks are dropped: they are
    /// not bindings anyone can make, so they are not questions either.
    pub fn effective_roles(&self) -> Vec<RecipeConnectorRole> {
        if !self.connector_roles.is_empty() {
            return self
                .connector_roles
                .iter()
                .filter(|r| {
                    let t = r.connector_type.trim();
                    !t.is_empty()
                        && t != RECIPE_FORBIDDEN_CONNECTOR_TYPE
                        && !r.role.trim().is_empty()
                })
                .cloned()
                .collect();
        }
        let mut out: Vec<RecipeConnectorRole> = Vec::new();
        for raw in &self.connector_types {
            let t = raw.trim();
            if t.is_empty() || t == RECIPE_FORBIDDEN_CONNECTOR_TYPE {
                continue;
            }
            if out.iter().any(|r| r.role == t) {
                continue;
            }
            out.push(RecipeConnectorRole {
                role: t.to_string(),
                connector_type: t.to_string(),
                note: String::new(),
            });
        }
        out
    }

    /// [`Self::validation_errors`] as one `AppError::Validation`.
    pub fn validate(&self, known_connector_categories: &[&str]) -> Result<(), AppError> {
        // Matched on the empty SLICE rather than tested with `.is_empty()`:
        // the two spellings are equivalent, and this one does not read as the
        // open-coded emptiness refusal the census gates against
        // (`hand-rolled-emptiness-refusal`) — this is a whole-object validator
        // reporting every problem, not a missing-field guard.
        match self
            .validation_errors(known_connector_categories)
            .as_slice()
        {
            [] => Ok(()),
            errors => {
                let name = match self.slug.trim() {
                    "" => self.id.as_str(),
                    slug => slug,
                };
                Err(AppError::Validation(format!(
                    "Recipe '{name}' is not valid v3: {}",
                    errors.join("; ")
                )))
            }
        }
    }

    /// Whether a raw `prompt_template` payload is a v3 recipe rather than a v2
    /// charter (`procedure` string) or a v1 use case. Structural, like every
    /// other payload probe on this path: a v3 payload is the only one that
    /// carries an `activities` array AND a `description` OBJECT — v1 and v2
    /// both carry `description` as a string when they carry it at all.
    pub fn looks_like_v3(payload: &serde_json::Value) -> bool {
        payload.get("activities").is_some_and(|a| a.is_array())
            && payload.get("description").is_some_and(|d| d.is_object())
    }

    /// The recipe's own pointer, for stamping on a minted charter.
    pub fn recipe_ref(&self) -> RecipeRef {
        RecipeRef {
            slug: if self.slug.is_empty() {
                self.id.clone()
            } else {
                self.slug.clone()
            },
            version: self.version.clone(),
        }
    }
}

#[cfg(test)]
mod v3_tests {
    use super::*;

    const CATEGORIES: &[&str] = &["analytics", "social", "transcription", "desktop"];

    fn activity(id: &str, kind: &str) -> RecipeActivity {
        RecipeActivity {
            id: id.to_string(),
            label: format!("Do the {id} part"),
            kind: kind.to_string(),
        }
    }

    fn valid() -> RecipeSpec {
        RecipeSpec {
            id: "3f1d0f2e-0000-4000-8000-000000000001".to_string(),
            slug: "web-analytics-performance-review".to_string(),
            title: "Web analytics performance review".to_string(),
            version: "0.1.0".to_string(),
            status: "seed".to_string(),
            path: "sales_marketing/web-analytics".to_string(),
            domain: "sales_marketing".to_string(),
            activities: vec![
                activity("collect", "observe"),
                activity("compare", "decide"),
                activity("flag", "act"),
            ],
            connector_types: vec!["analytics".to_string(), "social".to_string()],
            recommended_trigger: RecipeTriggerRecommendation {
                kind: "self_paced".to_string(),
                rationale: "The review is worth doing when the numbers move.".to_string(),
            },
            ..Default::default()
        }
    }

    #[test]
    fn a_complete_recipe_validates() {
        assert!(valid().validate(CATEGORIES).is_ok());
    }

    #[test]
    fn a_partial_v3_object_still_parses() {
        // Only `id` is required by serde — a reviewed corpus lands field by
        // field, and a half-authored recipe must be readable to be finished.
        let spec: RecipeSpec = serde_json::from_str(r#"{"id":"abc"}"#).expect("partial parses");
        assert_eq!(spec.id, "abc");
        assert!(spec.activities.is_empty());
        // ...but it does not validate.
        assert!(!spec.validation_errors(CATEGORIES).is_empty());
    }

    #[test]
    fn activity_count_is_bounded_at_both_ends() {
        let mut spec = valid();
        spec.activities.truncate(2);
        assert!(spec
            .validation_errors(CATEGORIES)
            .iter()
            .any(|e| e.contains("activities has 2 entries")));

        let mut spec = valid();
        while spec.activities.len() <= RECIPE_MAX_ACTIVITIES {
            spec.activities.push(activity("more", "act"));
        }
        assert!(spec
            .validation_errors(CATEGORIES)
            .iter()
            .any(|e| e.contains("activities has 9 entries")));
    }

    #[test]
    fn vocabularies_are_closed() {
        let mut spec = valid();
        spec.status = "draft".into();
        spec.activities[0].kind = "branch".into();
        spec.recommended_trigger.kind = "cron".into();
        let errors = spec.validation_errors(CATEGORIES);
        assert!(errors.iter().any(|e| e.starts_with("status 'draft'")));
        assert!(errors.iter().any(|e| e.contains("kind 'branch'")));
        assert!(errors
            .iter()
            .any(|e| e.contains("recommendedTrigger.kind 'cron'")));
    }

    #[test]
    fn connector_types_must_be_catalog_categories_and_never_desktop() {
        let mut spec = valid();
        spec.connector_types = vec![
            "analytics".into(),
            "deepgram".into(),
            "desktop".into(),
            String::new(),
        ];
        let errors = spec.validation_errors(CATEGORIES);
        // 'deepgram' is a connector id, not a category — the exact demotion v3
        // exists to enforce.
        assert!(errors
            .iter()
            .any(|e| e.contains("'deepgram' is not a connector catalog category")));
        // 'desktop' IS a catalog category, and is still refused.
        assert!(errors.iter().any(|e| e.contains("carries 'desktop'")));
        assert!(errors
            .iter()
            .any(|e| e.contains("connectorTypes[3] is empty")));
    }

    // -- connector roles (spec amendment 2026-09-06) ------------------------

    fn role(name: &str, ty: &str) -> RecipeConnectorRole {
        RecipeConnectorRole {
            role: name.to_string(),
            connector_type: ty.to_string(),
            note: String::new(),
        }
    }

    #[test]
    fn two_roles_of_the_same_type_are_legal_and_validate() {
        let mut spec = valid();
        spec.connector_types = vec!["social".into()];
        spec.connector_roles = vec![
            role("draft_surface", "social"),
            role("review_surface", "social"),
        ];
        assert!(
            spec.validate(CATEGORIES).is_ok(),
            "{:?}",
            spec.validation_errors(CATEGORIES)
        );
    }

    #[test]
    fn duplicate_role_names_are_rejected() {
        let mut spec = valid();
        spec.connector_types = vec!["social".into()];
        spec.connector_roles = vec![role("surface", "social"), role("surface", "social")];
        assert!(spec
            .validation_errors(CATEGORIES)
            .iter()
            .any(|e| e.contains("duplicate role 'surface'")));
    }

    #[test]
    fn a_role_type_must_be_a_catalog_category_and_never_desktop() {
        let mut spec = valid();
        spec.connector_types = vec!["deepgram".into(), "desktop".into()];
        spec.connector_roles = vec![role("a", "deepgram"), role("b", "desktop")];
        let errors = spec.validation_errors(CATEGORIES);
        assert!(errors
            .iter()
            .any(|e| e.contains("connectorRoles[0] type 'deepgram'")));
        assert!(errors
            .iter()
            .any(|e| e.contains("connectorRoles[1] type is 'desktop'")));
    }

    #[test]
    fn connector_types_must_be_the_derived_type_set_when_roles_are_present() {
        let mut spec = valid();
        // roles say social; the flat list still says analytics + social.
        spec.connector_roles = vec![role("surface", "social")];
        assert!(spec
            .validation_errors(CATEGORIES)
            .iter()
            .any(|e| e.contains("is not the distinct type set of connectorRoles")));
    }

    #[test]
    fn a_role_less_recipe_gets_one_role_per_type_named_after_the_type() {
        let spec = valid();
        let roles = spec.effective_roles();
        assert_eq!(roles.len(), 2);
        assert_eq!(roles[0].role, "analytics");
        assert_eq!(roles[0].connector_type, "analytics");
        assert_eq!(roles[1].role, "social");
    }

    #[test]
    fn effective_roles_drop_desktop_and_blanks_rather_than_asking_about_them() {
        let mut spec = valid();
        spec.connector_types = vec!["analytics".into(), "desktop".into(), "  ".into()];
        assert_eq!(spec.effective_roles().len(), 1);

        spec.connector_roles = vec![
            role("a", "analytics"),
            role("b", "desktop"),
            role("", "social"),
        ];
        let roles = spec.effective_roles();
        assert_eq!(roles.len(), 1, "got {roles:?}");
        assert_eq!(roles[0].role, "a");
    }

    #[test]
    fn the_role_wire_key_for_its_type_is_plain_type() {
        let json = serde_json::to_value(role("local_checkout", "source_control")).unwrap();
        assert_eq!(
            json.get("type").and_then(|v| v.as_str()),
            Some("source_control")
        );
        assert!(json.get("connectorType").is_none(), "{json}");
        let back: RecipeConnectorRole =
            serde_json::from_value(serde_json::json!({"role":"r","type":"social"})).unwrap();
        assert_eq!(back.connector_type, "social");
    }

    #[test]
    fn every_problem_is_reported_not_just_the_first() {
        let spec = RecipeSpec {
            id: "x".into(),
            ..Default::default()
        };
        let errors = spec.validation_errors(CATEGORIES);
        assert!(errors.len() >= 4, "got {errors:?}");
        let message = spec.validate(CATEGORIES).unwrap_err().to_string();
        assert!(message.contains("title is empty"), "{message}");
    }

    #[test]
    fn v3_is_told_apart_from_v2_and_v1_payloads_structurally() {
        let v3 = serde_json::json!({
            "id": "r", "activities": [], "description": { "need": "n" }
        });
        let v2 = serde_json::json!({
            "id": "uc_x", "title": "X", "procedure": "Do the thing.", "spec": {}
        });
        let v1 = serde_json::json!({
            "id": "uc_x", "title": "X", "description": "A sentence."
        });
        assert!(RecipeSpec::looks_like_v3(&v3));
        assert!(!RecipeSpec::looks_like_v3(&v2));
        assert!(!RecipeSpec::looks_like_v3(&v1));
    }

    #[test]
    fn recipe_ref_falls_back_to_the_id_when_no_slug_was_authored() {
        let mut spec = valid();
        assert_eq!(spec.recipe_ref().slug, "web-analytics-performance-review");
        spec.slug = String::new();
        assert_eq!(spec.recipe_ref().slug, spec.id);
    }

    #[test]
    fn the_wire_shape_is_camel_case() {
        let json = serde_json::to_value(valid()).unwrap();
        for key in [
            "connectorTypes",
            "recommendedTrigger",
            "personalizationNeeds",
        ] {
            assert!(json.get(key).is_some(), "missing {key} in {json}");
        }
        let desc = serde_json::to_value(RecipeDescription::default()).unwrap();
        assert!(desc.get("coreAction").is_some(), "{desc}");
    }
}
