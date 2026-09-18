//! Shared helpers that derive structured info from a persona or its tools.

use personas_core::types::ModelProfile;
use personas_db::models::PersonaToolDefinition;

/// Canonical tier-slug → model-id map for per-capability `model_override`
/// values baked by templates/recipes. Default tier (sonnet) is stored as
/// `null` on the capability and resolved by the caller's fallback chain.
///
/// Every arm reads `personas_core::model_ids`, the one door. It spelled the
/// three ids as bare literals until 2026-09-08, and the `opus` arm was then
/// two weeks stale: it handed out `claude-opus-4-8` after `claude-opus-5`
/// shipped, so every capability baked at the opus tier pinned a retired id.
pub fn tier_slug_to_model_id(slug: &str) -> Option<&'static str> {
    use personas_core::model_ids::{HAIKU_CURRENT, OPUS_CURRENT, SONNET_CURRENT};
    match slug.trim().to_ascii_lowercase().as_str() {
        "haiku" => Some(HAIKU_CURRENT),
        "sonnet" => Some(SONNET_CURRENT),
        "opus" => Some(OPUS_CURRENT),
        _ => None,
    }
}

/// The default-tier model for capability executions when neither the
/// capability (`model_override`) nor the persona (`model_profile`) names
/// one. The recipe bundle's tiering doctrine is "null = sonnet default";
/// without this fallback a profile-less persona silently rides the CLI
/// ACCOUNT default — observed live as opus-4-8[1m] on every team step,
/// the dominant fleet cost driver (2026-06-12 cost review).
pub const DEFAULT_CAPABILITY_MODEL: &str = personas_core::model_ids::DEFAULT_BALANCED;

/// Resolve a capability's `model_override` value into a ModelProfile.
/// Accepts BOTH shapes that exist in the wild:
///  - short tier slug baked by templates/recipes: `"haiku" | "sonnet" | "opus"`
///    (also tolerates a full `claude-*` model id string)
///  - full ModelProfile object set from the capability detail UI
/// Returns None for null/absent/unrecognized — callers fall back to the
/// persona profile, then [`DEFAULT_CAPABILITY_MODEL`].
pub fn resolve_use_case_model_override(mo: &serde_json::Value) -> Option<ModelProfile> {
    match mo {
        serde_json::Value::String(s) => {
            let id = tier_slug_to_model_id(s).map(str::to_string).or_else(|| {
                let t = s.trim();
                t.starts_with("claude-").then(|| t.to_string())
            })?;
            Some(ModelProfile {
                model: Some(id),
                ..ModelProfile::default()
            })
        }
        v @ serde_json::Value::Object(_) => {
            let mut profile: ModelProfile = serde_json::from_value(v.clone()).ok()?;

            // SECURITY: a capability-level override selects a MODEL. It never
            // carries a credential, and it must not name an unusable endpoint.
            //
            // The capability UI writes only {provider, model, base_url}
            // (`useCaseDetailHelpers.ts` MODEL_OPTIONS) — `auth_token` is
            // authored in exactly one place, the persona editor
            // (`useEditorSave.ts`), on the persona's OWN `model_profile`. But
            // this value is copied verbatim out of untrusted template JSON
            // (`template_adopt.rs`, `insert("model_override", mo.clone())`) and
            // out of LLM-authored `agent_ir` (`build_sessions.rs`), so a token
            // arriving here is smuggled by construction. Dropping it means an
            // override pointed at a foreign endpoint falls through to
            // `http_engine::secrets::resolve_api_key`, which refuses to attach
            // the user's stored key to a host they never configured — instead
            // of this override quietly becoming a second, unguarded way to set
            // the same two fields `model_profile` is now sanitized for.
            profile.auth_token = None;

            // `base_url` owns the scheme and authority of the request. Reject
            // one that is not a usable http(s) URL. Deliberately NOT a
            // private-address check: an override pointed at a local Ollama is
            // legitimate and must keep working.
            if let Some(raw) = profile.base_url.as_deref() {
                let trimmed = raw.trim();
                let usable = trimmed.is_empty()
                    || url::Url::parse(trimmed).is_ok_and(|u| {
                        matches!(u.scheme(), "http" | "https") && u.host_str().is_some()
                    });
                if !usable {
                    profile.base_url = None;
                }
            }

            Some(profile)
        }
        _ => None,
    }
}

/// Parse the model_profile JSON string into a ModelProfile struct.
/// Returns None if the input is None, empty, or invalid JSON.
pub fn parse_model_profile(json: Option<&str>) -> Option<ModelProfile> {
    let json_str = json?.trim();
    if json_str.is_empty() {
        return None;
    }
    serde_json::from_str::<ModelProfile>(json_str).ok()
}

/// Which step of the charter model chain produced a value - kept on the result
/// so a log line (and a test) can say WHY a run got the model it got. Declared
/// in PRECEDENCE order, highest first (operator decision Q15, 2026-09-18).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelChoiceStep {
    /// The charter's explicit `spec.modelOverride`.
    Override,
    /// The difficulty routing table, from the charter's DECLARED profile.
    Difficulty,
    /// The persona's own `model_profile`.
    PersonaProfile,
    /// A `model_routing` cascade rule.
    Cascade,
    /// [`DEFAULT_CAPABILITY_MODEL`]; effort left to the spawn's own default.
    Default,
}

/// A charter's resolved `(model, effort)` and where each came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharterModelChoice {
    /// Never empty: the last step is a constant.
    pub model: String,
    /// `None` = nobody chose one; the spawn keeps its own default (the headless
    /// persona lane pins [`super::DEFAULT_EFFORT`], a fleet session the CLI's).
    pub effort: Option<String>,
    pub model_step: ModelChoiceStep,
    pub effort_step: ModelChoiceStep,
}

/// One step's contribution: a Claude model id and/or a valid effort.
fn step_values(model: Option<&str>, effort: Option<&str>) -> (Option<String>, Option<String>) {
    let model = model
        .and_then(|m| resolve_use_case_model_override(&serde_json::Value::String(m.to_string())))
        .and_then(|p| p.model)
        .filter(|m| !m.trim().is_empty());
    let effort = effort
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| personas_db::model_routing::is_valid_effort(e));
    (model, effort)
}

/// An explicit override read into a profile, accepting the THREE shapes that
/// reach the chain: a tier slug / `claude-*` id, a `ModelProfile` object, and
/// the compact JSON string of such an object (what the adoption door stores on
/// `spec.modelOverride` when the object names no `model`).
fn override_profile(mo: &serde_json::Value) -> Option<ModelProfile> {
    match mo {
        serde_json::Value::String(s) if s.trim_start().starts_with('{') => {
            let parsed = serde_json::from_str::<serde_json::Value>(s.trim()).ok()?;
            resolve_use_case_model_override(&parsed)
        }
        other => resolve_use_case_model_override(other),
    }
}

/// Is this profile routed by tier at all? A non-Anthropic (BYOM) profile is
/// not: tier slugs and `--effort` mean nothing to its endpoint, so neither the
/// difficulty table nor a cascade rule may touch it.
fn is_anthropic_profile(profile: Option<&ModelProfile>) -> bool {
    profile
        .and_then(|p| p.provider.as_deref())
        .map(|pr| pr.trim().is_empty() || pr.eq_ignore_ascii_case("anthropic"))
        .unwrap_or(true)
}

/// THE charter model chain (spark `resource-aware-orchestration`), one pure
/// function so the attention dispatcher, `execute_persona_inner` and the runner
/// floor cannot each grow their own order. Highest first (operator decision
/// Q15, 2026-09-18 - the charter's difficulty outranks the persona's model):
///
/// 1. explicit `spec.modelOverride` - a tier slug, a `claude-*` id, or the
///    compact JSON of a `ModelProfile` object (what the adoption door stores
///    when the object names no `model`); an object's `effort` SURVIVES, which
///    it did not before this function existed;
/// 2. the difficulty table, for a charter whose profile was DECLARED
///    (`difficulty` is `None` for an untagged charter, so an untagged fleet
///    keeps the persona's model exactly as before profiles existed). Until Q15
///    it sat BELOW the cascade rule, where it was inert for every persona with
///    a model set - which is nearly all of them;
/// 3. the persona's own `model_profile`;
/// 4. the `model_routing` cascade rule for the persona;
/// 5. [`DEFAULT_CAPABILITY_MODEL`], effort unset.
///
/// Model and effort cascade PER FIELD, independently, like the stylesheet
/// `model_routing` is modelled on: `modelOverride: "opus"` on a `hard` charter
/// runs opus at the table's `high`, because the override named a model and
/// said nothing about effort. Every effort is checked against
/// `model_routing::EFFORT_LEVELS` before it is returned - the value becomes an
/// argv token.
///
/// One exemption, shared with [`fill_profile_from_routing`] so the two chains
/// agree: a persona whose own profile names a non-Anthropic provider is never
/// routed by tier, so step 2 is skipped for it.
pub fn resolve_charter_model_choice(
    model_override: Option<&str>,
    persona_model_profile: Option<&str>,
    cascade: Option<&personas_db::model_routing::ResolvedModel>,
    difficulty: Option<personas_core::models::Difficulty>,
) -> CharterModelChoice {
    let from_override = model_override
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| override_profile(&serde_json::Value::String(s.to_string())))
        .map(|p| step_values(p.model.as_deref(), p.effort.as_deref()))
        .unwrap_or((None, None));
    let persona_profile = parse_model_profile(persona_model_profile);
    let tier_routed = is_anthropic_profile(persona_profile.as_ref());
    let from_persona = persona_profile
        .map(|p| {
            // A persona profile may name a BYOM model; it is the operator's
            // explicit choice and is kept verbatim rather than slug-filtered.
            let model = p.model.filter(|m| !m.trim().is_empty());
            (model, step_values(None, p.effort.as_deref()).1)
        })
        .unwrap_or((None, None));
    let from_cascade = cascade
        .map(|r| step_values(Some(&r.model), r.effort.as_deref()))
        .unwrap_or((None, None));
    let from_difficulty = difficulty
        .filter(|_| tier_routed)
        .map(|d| {
            let (slug, effort) = personas_db::model_routing::route_for_difficulty(d);
            step_values(Some(slug), Some(effort))
        })
        .unwrap_or((None, None));

    let steps = [
        (ModelChoiceStep::Override, from_override),
        (ModelChoiceStep::Difficulty, from_difficulty),
        (ModelChoiceStep::PersonaProfile, from_persona),
        (ModelChoiceStep::Cascade, from_cascade),
    ];
    let (model_step, model) = steps
        .iter()
        .find_map(|(step, (m, _))| m.clone().map(|m| (*step, m)))
        .unwrap_or_else(|| {
            (
                ModelChoiceStep::Default,
                DEFAULT_CAPABILITY_MODEL.to_string(),
            )
        });
    let (effort_step, effort) = steps
        .iter()
        .find_map(|(step, (_, e))| e.clone().map(|e| (*step, Some(e))))
        .unwrap_or((ModelChoiceStep::Default, None));
    CharterModelChoice {
        model,
        effort,
        model_step,
        effort_step,
    }
}

/// Which fields the explicit override NAMED - the only thing a declared
/// difficulty yields to on the execution path.
///
/// `execute_persona_inner` and the runner fold the override into the persona's
/// profile before routing runs, so by then "opus, from the override" and "opus,
/// the persona's own model" are the same string. The difficulty step outranks
/// one and not the other, so the caller says which fields the override supplied.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OverrideNamed {
    pub model: bool,
    pub effort: bool,
}

impl OverrideNamed {
    /// Read it off the override value itself (any of the three shapes
    /// [`resolve_charter_model_choice`] accepts). `None`, `null` and an
    /// unrecognized value name nothing. An effort outside
    /// `model_routing::EFFORT_LEVELS` names nothing either - the same filter
    /// the fleet chain applies, so the two agree on what an override said.
    pub fn of(model_override: Option<&serde_json::Value>) -> Self {
        let Some(p) = model_override.and_then(override_profile) else {
            return Self::default();
        };
        Self {
            model: p.model.as_deref().is_some_and(|m| !m.trim().is_empty()),
            effort: step_values(None, p.effort.as_deref()).1.is_some(),
        }
    }
}

/// The EXECUTION-path half of the charter model chain. `execute_persona_inner`
/// and the runner resolve the override and the persona's own profile themselves
/// (the legacy use-case override may be a BYOM object with a provider and
/// endpoint, which [`resolve_charter_model_choice`]'s argv-safe filter would
/// wrongly drop) and hand the merged result in as `profile`. This applies the
/// rest of the chain in the SAME order the fleet path walks (Q15):
///
/// * step 2, the DECLARED difficulty, REPLACES the model and the effort - per
///   field, and only a field the override did not name (`named`). It outranks
///   the persona's own profile, which is why this is no longer a pure fill;
/// * step 4, the `model_routing` cascade rule, fills what is still EMPTY.
///
/// A non-Anthropic profile is returned untouched - tier slugs and `--effort`
/// mean nothing to a BYOM endpoint. With no declared difficulty and no rule the
/// profile is returned as it came, so an untagged, unruled charter still
/// reaches the caller's own sonnet floor exactly as before. Idempotent: the
/// runner re-applies it to a profile `execute_persona_inner` already routed.
pub fn fill_profile_from_routing(
    profile: Option<ModelProfile>,
    named: OverrideNamed,
    cascade: Option<&personas_db::model_routing::ResolvedModel>,
    difficulty: Option<personas_core::models::Difficulty>,
) -> Option<ModelProfile> {
    if !is_anthropic_profile(profile.as_ref()) {
        return profile;
    }
    let (table_model, table_effort) = difficulty
        .map(|d| {
            let (slug, effort) = personas_db::model_routing::route_for_difficulty(d);
            step_values(Some(slug), Some(effort))
        })
        .unwrap_or((None, None));
    let (rule_model, rule_effort) = cascade
        .map(|r| step_values(Some(&r.model), r.effort.as_deref()))
        .unwrap_or((None, None));

    let mut routed = profile.clone().unwrap_or_default();
    if let Some(m) = table_model.filter(|_| !named.model) {
        routed.model = Some(m);
    }
    if let Some(e) = table_effort.filter(|_| !named.effort) {
        routed.effort = Some(e);
    }
    let model_missing = routed
        .model
        .as_deref()
        .map(|m| m.trim().is_empty())
        .unwrap_or(true);
    if model_missing && rule_model.is_some() {
        routed.model = rule_model;
    }
    if routed.effort.is_none() {
        routed.effort = rule_effort;
    }
    // Nothing routed: hand back exactly what came in (`None` stays `None`, so
    // the caller's sonnet floor still sees a profile-less persona).
    if routed == profile.clone().unwrap_or_default() {
        return profile;
    }
    Some(routed)
}

// `render_active_capabilities` (Phase C1's `## Active Capabilities` roster
// over design_context.useCases) was RETIRED in spark `agent-manifest-rebase`
// WP2: the `## Responsibilities` roster in `core_section.rs` renders every
// active charter — e19 minted one per legacy use case — so the design-context
// menu would only duplicate it. The fingerprint below still reads
// design_context: the use-case rows remain the toggle surface until the WP4
// adoption cutover.

/// Fingerprint of the persona's currently-enabled capabilities.
///
/// Used by the session pool cache key so toggling a capability invalidates
/// warm sessions. Stable under reordering: use case ids are sorted before
/// being joined. Returns empty string when design_context is absent / empty
/// so personas without capabilities don't carry bogus hash input.
///
/// Phase C1. See `docs/concepts/persona-capabilities/03-runtime.md` §3.
pub fn active_capabilities_fingerprint(design_context: Option<&str>) -> String {
    let Some(dc_json) = design_context else {
        return String::new();
    };
    let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) else {
        return String::new();
    };
    let Some(use_cases) = crate::design_context::pick_use_cases_array(&dc) else {
        return String::new();
    };

    let mut entries: Vec<String> = use_cases
        .iter()
        .filter(|uc| uc.get("enabled").and_then(|v| v.as_bool()) != Some(false))
        .filter_map(|uc| {
            let id = uc.get("id").and_then(|v| v.as_str())?;
            let title = uc.get("title").and_then(|v| v.as_str()).unwrap_or("");
            Some(format!("{}@{}", id, title))
        })
        .collect();
    entries.sort();
    entries.join("|")
}

/// Fingerprint of the persona's living-agent Core (`personas.core_profile`).
///
/// Sibling of [`active_capabilities_fingerprint`] for the session-pool config
/// hash: combine BOTH at the `session_pool::compute_config_hash` call sites
/// (e.g. `format!("{}|{}", active_capabilities_fingerprint(..),
/// core_fingerprint(..))`) so a dial edit invalidates warm sessions the same
/// way a capability toggle does. Returns `""` for an absent/blank core so
/// personas without a Core contribute exactly the hash input they do today.
///
/// Content-hash (FNV-1a-64) rather than the raw JSON: the fingerprint lands
/// in log lines and cache keys, and the core can be multiple KB of prose.
pub fn core_fingerprint(core_profile: Option<&str>) -> String {
    match core_profile.map(str::trim) {
        None | Some("") => String::new(),
        Some(cp) => format!("core:{:016x}", super::budget::fnv1a_64(cp.as_bytes())),
    }
}

/// Phase C5b — render the per-capability generation policy as natural-language
/// bullet points the LLM can act on. Returns an empty Vec when the JSON object
/// has no recognised fields, so the caller can skip the surrounding header.
///
/// This is the SOFT layer of the two-layer enforcement model. The HARD layer
/// is `engine::dispatch::testable::resolve_generation_policy` which silently
/// drops protocol messages that violate the policy — required because LLMs
/// occasionally ignore even explicit instructions.
pub fn render_generation_policy_lines(settings: Option<&serde_json::Value>) -> Vec<String> {
    let Some(s) = settings.filter(|v| !v.is_null()) else {
        return Vec::new();
    };
    let mut lines = Vec::new();

    if let Some(v) = s.get("memories").and_then(|v| v.as_str()) {
        if v.eq_ignore_ascii_case("off") {
            lines.push(
                "Do not write to agent memory for this capability. The persona has memories \
                 from other capabilities; do not extend them from this run."
                    .to_string(),
            );
        }
    }
    if let Some(v) = s.get("reviews").and_then(|v| v.as_str()) {
        match v.to_ascii_lowercase().as_str() {
            "off" => lines.push(
                "Do not request manual review for this capability. Resolve uncertainty \
                 with your own best judgment and proceed."
                    .to_string(),
            ),
            "trust_llm" | "trustllm" | "trust-llm" => lines.push(
                "Trust your own judgment for this capability. If you would normally \
                 request manual review, proceed instead — your decisions will not be queued \
                 for human approval."
                    .to_string(),
            ),
            _ => {}
        }
    }
    if let Some(v) = s.get("events").and_then(|v| v.as_str()) {
        if v.eq_ignore_ascii_case("off") {
            lines.push(
                "Do not emit events for this capability. Other personas will not be \
                 notified of your actions on this run."
                    .to_string(),
            );
        }
    }
    if let Some(map) = s.get("event_aliases").and_then(|v| v.as_object()) {
        let pairs: Vec<String> = map
            .iter()
            .filter_map(|(k, v)| v.as_str().map(|tgt| format!("{} → {}", k, tgt)))
            .collect();
        if !pairs.is_empty() {
            lines.push(format!(
                "When emitting events, use these renamed names: {}",
                pairs.join(", ")
            ));
        }
    }

    lines
}

/// 2026-05-06 — extended renderer that walks the whole use_case to derive
/// policy lines from BOTH `generation_settings` (explicit runtime override)
/// AND the build-time IR fields `review_policy.mode` / `memory_policy.enabled`.
/// Mirrors the precedence in `dispatch::pick_generation_policy`: explicit
/// settings win, but when absent we fall back to the IR fields the build
/// LLM actually writes.
///
/// Why two functions instead of replacing the original: the original
/// signature is on the public surface (used by tests and other callers).
/// This adds a richer entry point without breaking those.
pub fn render_capability_policy_lines(use_case: &serde_json::Value) -> Vec<String> {
    let mut lines = render_generation_policy_lines(use_case.get("generation_settings"));

    // Track which keys were already covered by generation_settings so the
    // fallback doesn't double-emit.
    let settings = use_case.get("generation_settings");
    let memories_explicit = settings.and_then(|s| s.get("memories")).is_some();
    let reviews_explicit = settings.and_then(|s| s.get("reviews")).is_some();

    // memory_policy.enabled fallback
    if !memories_explicit {
        if let Some(enabled) = use_case
            .get("memory_policy")
            .and_then(|v| v.get("enabled"))
            .and_then(|v| v.as_bool())
        {
            if !enabled {
                lines.push(
                    "Do not write to agent memory for this capability. \
                     The persona has memories from other capabilities; do not extend them from this run.".to_string(),
                );
            }
        }
    }

    // review_policy.mode fallback. The "always" mode is the meaningful
    // one to surface — without an explicit instruction the LLM treats
    // routine completions as not requiring review (per templates.rs:180).
    // For mode=always we want every output to be flagged.
    if !reviews_explicit {
        if let Some(mode) = use_case
            .get("review_policy")
            .and_then(|v| v.get("mode"))
            .and_then(|v| v.as_str())
        {
            match mode.to_ascii_lowercase().as_str() {
                "never" => lines.push(
                    "Do not request manual review for this capability. \
                     Resolve uncertainty with your own best judgment and proceed."
                        .to_string(),
                ),
                "always" => lines.push(
                    "Always emit a `manual_review` protocol message for every output of \
                     this capability before delivering it. The user has explicitly required \
                     human approval — never skip this step, even for routine completions. \
                     Use severity \"medium\" unless the output is high-impact (severity \"high\"). \
                     Include the proposed output in the description so the reviewer can decide \
                     without re-running the capability."
                        .to_string(),
                ),
                "auto_triage" | "autotriage" | "auto-triage" => lines.push(
                    "Emit a `manual_review` for outputs you would normally flag. The runtime \
                     spawns an automated triage evaluator that judges each review against the \
                     persona's decision_principles and resolves it without blocking on a human. \
                     Use this freely — it is not a queue, it is a transparency record."
                        .to_string(),
                ),
                _ => {}
            }
        }
    }

    lines
}

/// Build documentation string for a single tool definition.
pub fn build_tool_documentation(tool: &PersonaToolDefinition) -> String {
    let mut doc = format!("### {}\n{}\n", tool.name, tool.description);
    doc.push_str(&format!("**Category**: {}\n", tool.category));

    if tool.script_path.is_empty() {
        // N8n-imported tools: no script file, use built-in Bash tool with curl
        if let Some(ref guide) = tool.implementation_guide {
            doc.push_str("**Implementation Guide**:\n");
            doc.push_str(guide);
            doc.push('\n');
        } else {
            doc.push_str("**Implementation**: Use the Bash tool with `curl` to call the API. Credentials are available as environment variables (e.g. `$GOOGLE_ACCESS_TOKEN`).\n");
        }
    } else {
        doc.push_str(&format!(
            "**Usage**: npx tsx \"{}\" --input '<JSON>'\n",
            tool.script_path
        ));
    }

    if let Some(ref schema) = tool.input_schema {
        doc.push_str(&format!("**Input Schema**: {schema}\n"));
    }
    if let Some(ref cred_type) = tool.requires_credential_type {
        doc.push_str(&format!(
            "**Requires Credential**: {cred_type} (available as env var)\n"
        ));
    }
    doc
}

#[cfg(test)]
mod model_override_provenance_tests {
    use super::resolve_use_case_model_override;
    use serde_json::json;

    #[test]
    fn drops_a_token_smuggled_through_a_capability_override() {
        let mo = json!({
            "provider": "qwen",
            "model": "qwen3-max",
            "base_url": "https://attacker.tld/v1",
            "auth_token": "dummy",
        });
        let p = resolve_use_case_model_override(&mo).expect("object override resolves");
        assert_eq!(
            p.auth_token, None,
            "a use-case override never carries a credential"
        );
        // The endpoint itself survives — refusing to attach the STORED key to it
        // is `http_engine::secrets`' job, not this function's.
        assert_eq!(p.base_url.as_deref(), Some("https://attacker.tld/v1"));
    }

    #[test]
    fn keeps_a_local_inference_override() {
        let mo = json!({ "provider": "ollama", "model": "llama3", "base_url": "http://127.0.0.1:11434/v1" });
        let p = resolve_use_case_model_override(&mo).expect("resolves");
        assert_eq!(p.base_url.as_deref(), Some("http://127.0.0.1:11434/v1"));
    }

    #[test]
    fn drops_an_unusable_base_url() {
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "http://",
            "not a url",
        ] {
            let p = resolve_use_case_model_override(&json!({ "model": "m", "base_url": bad }))
                .expect("resolves");
            assert_eq!(p.base_url, None, "{bad} must be dropped");
        }
    }

    #[test]
    fn tier_slugs_are_unaffected() {
        let p = resolve_use_case_model_override(&json!("haiku")).expect("slug resolves");
        assert_eq!(p.model.as_deref(), Some("claude-haiku-4-5-20251001"));
        assert_eq!(p.auth_token, None);
    }
}

#[cfg(test)]
mod charter_model_choice_tests {
    use super::{
        fill_profile_from_routing, resolve_charter_model_choice, ModelChoiceStep, OverrideNamed,
        DEFAULT_CAPABILITY_MODEL,
    };
    use personas_core::model_ids::{HAIKU_CURRENT, OPUS_CURRENT, SONNET_CURRENT};
    use personas_core::models::Difficulty;
    use personas_core::types::ModelProfile;
    use personas_db::model_routing::ResolvedModel;

    fn cascade(model: &str, effort: Option<&str>) -> ResolvedModel {
        ResolvedModel {
            model: model.to_string(),
            effort: effort.map(str::to_string),
        }
    }

    /// Q15 (2026-09-18): override > DECLARED difficulty > persona profile >
    /// cascade rule > default.
    #[test]
    fn charter_model_precedence_override_beats_difficulty_beats_cascade_beats_default() {
        let rule = cascade("sonnet", Some("low"));
        // 1. override wins the model over everything below it.
        let c =
            resolve_charter_model_choice(Some("opus"), None, Some(&rule), Some(Difficulty::Light));
        assert_eq!(c.model, OPUS_CURRENT);
        assert_eq!(c.model_step, ModelChoiceStep::Override);
        // 2. no override: the declared difficulty beats the cascade rule, for
        //    the model AND the effort.
        let c = resolve_charter_model_choice(None, None, Some(&rule), Some(Difficulty::Hard));
        assert_eq!(c.model, OPUS_CURRENT);
        assert_eq!(c.model_step, ModelChoiceStep::Difficulty);
        assert_eq!(c.effort.as_deref(), Some("high"));
        assert_eq!(c.effort_step, ModelChoiceStep::Difficulty);
        // 2b. an UNDECLARED charter leaves the rule in charge.
        let c = resolve_charter_model_choice(None, None, Some(&rule), None);
        assert_eq!(c.model, SONNET_CURRENT);
        assert_eq!(c.model_step, ModelChoiceStep::Cascade);
        assert_eq!(c.effort.as_deref(), Some("low"));
        // 3. no rule: the declared difficulty routes.
        let c = resolve_charter_model_choice(None, None, None, Some(Difficulty::Hard));
        assert_eq!(
            (c.model.as_str(), c.effort.as_deref()),
            (OPUS_CURRENT, Some("high"))
        );
        assert_eq!(c.model_step, ModelChoiceStep::Difficulty);
        let c = resolve_charter_model_choice(None, None, None, Some(Difficulty::Light));
        assert_eq!(
            (c.model.as_str(), c.effort.as_deref()),
            (HAIKU_CURRENT, Some("low"))
        );
        // 4. nothing declared anywhere: the capability default, effort unset.
        let c = resolve_charter_model_choice(None, None, None, None);
        assert_eq!(c.model, DEFAULT_CAPABILITY_MODEL);
        assert_eq!(c.effort, None);
        assert_eq!(c.model_step, ModelChoiceStep::Default);
        assert_eq!(c.effort_step, ModelChoiceStep::Default);
    }

    #[test]
    fn charter_model_persona_profile_sits_between_difficulty_and_cascade() {
        let rule = cascade("opus", Some("high"));
        let profile = format!(r#"{{"model":"{HAIKU_CURRENT}"}}"#);
        // Undeclared: the persona's own model beats the rule.
        let c = resolve_charter_model_choice(None, Some(&profile), Some(&rule), None);
        assert_eq!(c.model, HAIKU_CURRENT);
        assert_eq!(c.model_step, ModelChoiceStep::PersonaProfile);
        // The profile named no effort, so the next step that has one supplies it.
        assert_eq!(c.effort.as_deref(), Some("high"));
        assert_eq!(c.effort_step, ModelChoiceStep::Cascade);
        // Declared: the difficulty outranks the persona's own model.
        let c = resolve_charter_model_choice(
            None,
            Some(&profile),
            Some(&rule),
            Some(Difficulty::Standard),
        );
        assert_eq!(c.model, SONNET_CURRENT);
        assert_eq!(c.model_step, ModelChoiceStep::Difficulty);
        assert_eq!(c.effort.as_deref(), Some("medium"));
        let c = resolve_charter_model_choice(Some("sonnet"), Some(&profile), None, None);
        assert_eq!(c.model, SONNET_CURRENT);
    }

    /// The three cases the operator's decision is stated in (Q15).
    #[test]
    fn charter_model_declared_difficulty_outranks_the_persona_model() {
        let opus_persona = format!(r#"{{"model":"{OPUS_CURRENT}","effort":"xhigh"}}"#);
        // persona opus + declared light => haiku / low, both fields.
        let c =
            resolve_charter_model_choice(None, Some(&opus_persona), None, Some(Difficulty::Light));
        assert_eq!(
            (c.model.as_str(), c.effort.as_deref()),
            (HAIKU_CURRENT, Some("low"))
        );
        assert_eq!(c.model_step, ModelChoiceStep::Difficulty);
        assert_eq!(c.effort_step, ModelChoiceStep::Difficulty);
        // persona opus + UNDECLARED => opus, at the persona's own effort.
        let c = resolve_charter_model_choice(None, Some(&opus_persona), None, None);
        assert_eq!(
            (c.model.as_str(), c.effort.as_deref()),
            (OPUS_CURRENT, Some("xhigh"))
        );
        assert_eq!(c.model_step, ModelChoiceStep::PersonaProfile);
        // charter override sonnet + declared hard => sonnet; the override named
        // no effort, so the effort comes from the difficulty (`high`), not from
        // the persona below it.
        let c = resolve_charter_model_choice(
            Some("sonnet"),
            Some(&opus_persona),
            None,
            Some(Difficulty::Hard),
        );
        assert_eq!(
            (c.model.as_str(), c.effort.as_deref()),
            (SONNET_CURRENT, Some("high"))
        );
        assert_eq!(c.model_step, ModelChoiceStep::Override);
        assert_eq!(c.effort_step, ModelChoiceStep::Difficulty);
        // ...and an override that DOES carry an effort keeps it.
        let mo = format!(r#"{{"model":"{SONNET_CURRENT}","effort":"low"}}"#);
        let c = resolve_charter_model_choice(
            Some(&mo),
            Some(&opus_persona),
            None,
            Some(Difficulty::Hard),
        );
        assert_eq!(
            (c.model.as_str(), c.effort.as_deref()),
            (SONNET_CURRENT, Some("low"))
        );
        assert_eq!(c.effort_step, ModelChoiceStep::Override);
        // A BYOM persona is never routed by tier, declared or not.
        let byom = r#"{"provider":"ollama","model":"llama3"}"#;
        let c = resolve_charter_model_choice(None, Some(byom), None, Some(Difficulty::Light));
        assert_eq!(c.model, "llama3");
        assert_eq!(c.model_step, ModelChoiceStep::PersonaProfile);
    }

    #[test]
    fn charter_model_effort_survives_an_object_override() {
        // The adoption door stores an object override that names no usable
        // model string as its compact JSON; its effort used to be dropped.
        let mo = format!(r#"{{"model":"{OPUS_CURRENT}","effort":"xhigh"}}"#);
        let c = resolve_charter_model_choice(Some(&mo), None, None, Some(Difficulty::Light));
        assert_eq!(c.model, OPUS_CURRENT);
        assert_eq!(c.effort.as_deref(), Some("xhigh"));
        assert_eq!(c.effort_step, ModelChoiceStep::Override);
        // An effort-only object keeps its effort and lets the model fall through.
        let c = resolve_charter_model_choice(
            Some(r#"{"effort":"high"}"#),
            None,
            None,
            Some(Difficulty::Light),
        );
        assert_eq!(c.model, HAIKU_CURRENT);
        assert_eq!(c.effort.as_deref(), Some("high"));
    }

    #[test]
    fn charter_model_effort_outside_the_vocabulary_never_reaches_an_argv() {
        let c = resolve_charter_model_choice(
            Some(r#"{"model":"opus","effort":"--dangerously-skip"}"#),
            None,
            Some(&cascade("sonnet", Some("ultra"))),
            None,
        );
        assert_eq!(c.effort, None);
        // A slug override on a tagged charter borrows the table's effort.
        let c = resolve_charter_model_choice(Some("opus"), None, None, Some(Difficulty::Hard));
        assert_eq!(c.effort.as_deref(), Some("high"));
        assert_eq!(c.effort_step, ModelChoiceStep::Difficulty);
    }

    #[test]
    fn charter_model_execution_chain_walks_the_same_order_as_the_fleet_chain() {
        let none = OverrideNamed::default();
        // Nothing resolved above, charter declared `hard`: the table sets both.
        let p =
            fill_profile_from_routing(None, none, None, Some(Difficulty::Hard)).expect("routed");
        assert_eq!(p.model.as_deref(), Some(OPUS_CURRENT));
        assert_eq!(p.effort.as_deref(), Some("high"));
        // The PERSONA's own model and effort are below the difficulty: replaced.
        let persona = ModelProfile {
            model: Some(OPUS_CURRENT.to_string()),
            effort: Some("xhigh".into()),
            ..Default::default()
        };
        let p =
            fill_profile_from_routing(Some(persona.clone()), none, None, Some(Difficulty::Light))
                .expect("routed");
        assert_eq!(p.model.as_deref(), Some(HAIKU_CURRENT));
        assert_eq!(p.effort.as_deref(), Some("low"));
        // ...and an UNDECLARED charter leaves the persona exactly as it was.
        let p = fill_profile_from_routing(Some(persona.clone()), none, None, None).expect("kept");
        assert_eq!(p, persona);
        // A model the OVERRIDE named is above the difficulty: kept; the effort
        // it did not name comes from the table.
        let overridden = ModelProfile {
            model: Some(SONNET_CURRENT.to_string()),
            ..Default::default()
        };
        let named = OverrideNamed::of(Some(&serde_json::json!("sonnet")));
        assert_eq!(
            named,
            OverrideNamed {
                model: true,
                effort: false
            }
        );
        let p = fill_profile_from_routing(Some(overridden), named, None, Some(Difficulty::Hard))
            .expect("kept");
        assert_eq!(p.model.as_deref(), Some(SONNET_CURRENT));
        assert_eq!(p.effort.as_deref(), Some("high"));
        // The difficulty beats a cascade rule; the rule fills only what is empty.
        let rule = cascade("haiku", Some("low"));
        let p = fill_profile_from_routing(None, none, Some(&rule), Some(Difficulty::Hard))
            .expect("routed");
        assert_eq!(p.model.as_deref(), Some(OPUS_CURRENT));
        assert_eq!(p.effort.as_deref(), Some("high"));
        let p = fill_profile_from_routing(None, none, Some(&rule), None).expect("filled");
        assert_eq!(p.model.as_deref(), Some(HAIKU_CURRENT));
        assert_eq!(p.effort.as_deref(), Some("low"));
        // Untagged and unruled: untouched, so the caller's sonnet floor decides.
        assert!(fill_profile_from_routing(None, none, None, None).is_none());
        // A BYOM profile is never routed by tier.
        let byom = ModelProfile {
            provider: Some("ollama".into()),
            ..Default::default()
        };
        let p = fill_profile_from_routing(Some(byom), none, None, Some(Difficulty::Hard))
            .expect("kept");
        assert_eq!((p.model, p.effort), (None, None));
        // Idempotent: the runner re-applies it to what the command already routed.
        let once = fill_profile_from_routing(None, none, None, Some(Difficulty::Light));
        let twice = fill_profile_from_routing(once.clone(), none, None, Some(Difficulty::Light));
        assert_eq!(once, twice);
    }

    #[test]
    fn charter_model_override_named_reads_all_three_shapes() {
        let named = |v: serde_json::Value| OverrideNamed::of(Some(&v));
        assert_eq!(OverrideNamed::of(None), OverrideNamed::default());
        assert_eq!(named(serde_json::Value::Null), OverrideNamed::default());
        assert_eq!(
            named(serde_json::json!("not-a-model")),
            OverrideNamed::default()
        );
        assert!(named(serde_json::json!("opus")).model);
        let obj = named(serde_json::json!({ "effort": "high" }));
        assert_eq!((obj.model, obj.effort), (false, true));
        // The compact-JSON string the adoption door stores on a charter.
        let compact = named(serde_json::json!(r#"{"model":"opus","effort":"bogus"}"#));
        assert_eq!((compact.model, compact.effort), (true, false));
    }
}
