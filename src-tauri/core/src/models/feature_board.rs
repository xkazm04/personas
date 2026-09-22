//! The Features board read model, and the scenario layer under a feature.
//!
//! Two ideas live here, and they are the same idea at two scales.
//!
//! **A feature is a slice through contexts, so a context has a ROLE.** Given
//! the features a project declares, every context is either `core` (some live
//! feature's slice covers it), `tests`, `platform`, or `unclaimed` - and
//! `unclaimed` is the interesting one, because it is the code nothing the
//! product claims to do goes through. [`derive_context_role`] is that rule as
//! one pure function: deterministic, no model, table-tested.
//!
//! **A feature is not uniform, so a feature has SCENARIOS.** A scenario is the
//! feature applied to one condition ("marketing candidates"), and a council
//! judges each in-scope one separately. An approval then reads as an ENVELOPE
//! - holds here, weak there, never measured over there - rather than a stamp
//! that hides a failing branch inside a mean.
//!
//! Three rules are stated here once so the app and the `/council` skill cannot
//! disagree about them, the way [`crate::models::round4`] pins the arithmetic:
//!
//! 1. **`proposed` is propose-then-adopt.** A scenario the council DISCOVERED
//!    enters as `proposed` and is excluded from every envelope computation
//!    until a person changes its scope. A member may propose; it may not
//!    promote, because a judge that also decides which branches count can
//!    always pass by narrowing the question.
//! 2. **Only `must_hold` binds**, at the scenario's declared floor or
//!    [`SCENARIO_DEFAULT_FLOOR`] when it declared none. The default is resolved
//!    at READ time ([`resolve_scenario_floor`]) and never written, so changing
//!    it moves every scenario that never named its own.
//! 3. **A scenario floor hit is ADVISORY until the judges are trusted.**
//!    Scenario scores come from a judged member, so while `trust_state` is not
//!    `trusted` a hit is recorded and loud and does not sink the run.
//!
//! [`aggregate_scenarios`] is the Rust mirror of the `/council` skill's
//! `aggregateScenarios` (`skills/council/scripts/lib/aggregate.mjs`, rule order
//! S1-S10, quoted on the function). It is the ONE implementation in this
//! process: the ingest door recomputes an incoming result's envelope with it
//! and refuses a disagreement, and the Features board computes the standing
//! envelope with it - so the page can never show a second answer.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::models::{CouncilSubjectState, COUNCIL_CONFIDENCES};

// ---------------------------------------------------------------------------
// Closed sets. Every one of these is a CHECK constraint in e43 as well.
// ---------------------------------------------------------------------------

/// `dev_use_case_scenarios.scope`. `proposed` is the only one that is not a
/// decision: it means a council named this branch and nobody has ruled on it.
pub const SCENARIO_SCOPES: [&str; 4] = ["proposed", "must_hold", "tracked", "out_of_scope"];
/// `dev_use_case_scenarios.source` - who put this scenario on the board.
pub const SCENARIO_SOURCES: [&str; 4] = ["operator", "council", "telemetry", "incident"];
/// `dev_council_scenario_results.state`. There is no `not_applicable`: a
/// scenario that does not apply is `out_of_scope` on the scenario row itself,
/// which is a standing fact rather than one run's finding.
pub const SCENARIO_RESULT_STATES: [&str; 2] = ["measured", "unmeasured"];
/// `dev_council_scenario_results.proof`, strongest first. The ladder is the
/// honesty rule: a model playing a marketing candidate is not a marketing
/// candidate, so `simulated` evidence can flag a weakness and cannot, alone,
/// certify a `must_hold` scenario.
pub const SCENARIO_PROOFS: [&str; 4] = ["observed", "replayed", "simulated", "claimed"];

/// The floor a scenario is held to when it declares none of its own.
/// Resolved at read time, never written - see [`resolve_scenario_floor`].
pub const SCENARIO_DEFAULT_FLOOR: f64 = 0.5;
/// The two scopes that move a number. `proposed` and `out_of_scope` never do.
pub const IN_SCOPE_SCENARIO_SCOPES: [&str; 2] = ["must_hold", "tracked"];

/// The four roles a context can hold relative to the features that exist.
pub const CONTEXT_ROLES: [&str; 4] = ["core", "tests", "platform", "unclaimed"];

/// Group domains that make their contexts `platform` rather than `unclaimed`.
pub const PLATFORM_DOMAINS: [&str; 3] = ["infrastructure", "shared", "data"];
/// Context categories that do the same, for a context whose group says nothing.
pub const PLATFORM_CATEGORIES: [&str; 3] = ["lib", "config", "data"];

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/// A context that holds a behavior's tests rather than the behavior.
///
/// Lives here rather than beside the use-case scan that first needed it,
/// because the Features board derives a context's role in the `db` crate and
/// the scan runs in `app_lib`: two copies of this predicate would be two
/// different answers to "is this a test context", and the board and the scan
/// would disagree about the same row.
pub fn is_test_context(name: &str) -> bool {
    let n = name.trim().to_lowercase();
    n.starts_with("tests-") || n.starts_with("test-") || n.ends_with("-tests")
}

/// Everything [`derive_context_role`] may look at. A struct rather than four
/// positional arguments, because three of them are `Option<&str>` and a
/// transposed pair would be invisible at the call site.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ContextRoleInputs<'a> {
    /// Whether any ACTIVE (non-archived) feature's slice covers this context.
    pub in_active_feature: bool,
    pub name: &'a str,
    /// `dev_contexts.category` - ui | api | lib | data | test | config.
    pub category: Option<&'a str>,
    /// The domain of the context's group, if it has one.
    pub group_domain: Option<&'a str>,
}

/// The role, derived. The ORDER is the rule:
///
/// 1. `core` - a live feature goes through here. Nothing else can outrank
///    that, including a test-looking name: a context a feature's slice claims
///    IS the product.
/// 2. `tests` - the category says so, or the name does.
/// 3. `platform` - the group's domain or the context's own category says this
///    is machinery rather than a product behaviour, so nobody should expect a
///    feature to claim it.
/// 4. `unclaimed` - and this is the finding. Code no declared feature reaches
///    and that is not tests and not platform is code the product does not
///    claim to need.
pub fn derive_context_role(inputs: &ContextRoleInputs<'_>) -> &'static str {
    if inputs.in_active_feature {
        return "core";
    }
    let category = inputs.category.map(str::trim).unwrap_or_default();
    if category.eq_ignore_ascii_case("test") || is_test_context(inputs.name) {
        return "tests";
    }
    let domain = inputs.group_domain.map(str::trim).unwrap_or_default();
    if PLATFORM_DOMAINS
        .iter()
        .any(|d| d.eq_ignore_ascii_case(domain))
        || PLATFORM_CATEGORIES
            .iter()
            .any(|c| c.eq_ignore_ascii_case(category))
    {
        return "platform";
    }
    "unclaimed"
}

/// S5: the floor a scenario is actually held to - its declared one, or
/// [`SCENARIO_DEFAULT_FLOOR`] when it declared none. Every scope resolves a
/// floor; only [`IN_SCOPE_SCENARIO_SCOPES`] can be measured against one, and
/// only `must_hold` can be FAILED by one.
pub fn resolve_scenario_floor(stored: Option<f64>) -> f64 {
    stored.unwrap_or(SCENARIO_DEFAULT_FLOOR)
}

/// One scenario as the PRODUCT declares it - a `dev_use_case_scenarios` row, or
/// one line of `state.json`. The scope lives here and nowhere else.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScenarioDeclaration {
    pub slug: String,
    pub title: String,
    pub axes: BTreeMap<String, String>,
    pub scope: String,
    /// As DECLARED. `None` means [`SCENARIO_DEFAULT_FLOOR`] applies.
    pub floor: Option<f64>,
}

/// One scenario as the value MEMBER reported it. Exactly the nine fields the
/// result contract carries: `scope`, `floor`, `floor_hit` and `advisory` are
/// derived from the declaration and are deliberately not in the file.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScenarioReport {
    pub slug: String,
    pub title: Option<String>,
    pub axes: Option<BTreeMap<String, String>>,
    /// 'measured' | 'unmeasured'
    pub state: String,
    pub score: Option<f64>,
    pub confidence: String,
    pub n: Option<i32>,
    pub proof: String,
    pub summary: String,
}

/// One scenario, declaration and report folded together.
#[derive(Debug, Clone, PartialEq)]
pub struct ScenarioFold {
    pub slug: String,
    pub title: String,
    pub axes: BTreeMap<String, String>,
    /// From the declaration ONLY. A discovered scenario reads `proposed`.
    pub scope: String,
    /// Resolved, never `None`.
    pub floor: f64,
    pub state: String,
    pub score: Option<f64>,
    pub confidence: String,
    pub n: Option<i32>,
    pub proof: String,
    pub summary: String,
    pub floor_hit: bool,
    pub advisory: bool,
}

/// Where an approval holds, where it is weak, and where nobody looked.
///
/// Every scenario lands in EXACTLY ONE bucket, which is what makes this an
/// envelope rather than five overlapping lists.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoardEnvelope {
    pub holds: Vec<String>,
    pub weak: Vec<String>,
    pub unmeasured: Vec<String>,
    pub out_of_scope: Vec<String>,
    pub proposed: Vec<String>,
}

/// Everything [`aggregate_scenarios`] produces.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScenarioAggregate {
    pub scenarios: Vec<ScenarioFold>,
    pub envelope: BoardEnvelope,
    /// One line per floor hit, advisory or binding.
    pub must_address: Vec<String>,
    /// Slugs whose floor hit BINDS - the list that turns an outcome to `fail`.
    pub binding_floor_hits: Vec<String>,
    pub advisory_floor_hits: Vec<String>,
}

/// Fold the product's DECLARED scenarios and the member's REPORTED ones into
/// one per-scenario view plus the envelope.
///
/// **The Rust mirror of the skill's `aggregateScenarios`.** Pure: same inputs,
/// same output, no clock, no filesystem. The rule order below is the contract
/// and is quoted from `skills/council/scripts/lib/aggregate.mjs` - do not
/// reorder without changing both.
///
/// - **S1.** Index declared by `slug`, first wins; index reported the same way.
///   (A duplicate is refused at the door before it reaches here.)
/// - **S2.** The set is every declared slug in declared order, then every
///   reported slug that was not declared, in reported order. A reported slug
///   with no declaration is DISCOVERED and reads scope `proposed`.
/// - **S3.** `scope` comes from the declaration only. Unknown or missing reads
///   `proposed`.
/// - **S4.** `state` is `measured` only when the report says `measured` AND
///   carries a numeric score; otherwise `unmeasured` with `score: None` -
///   never `0.0`, for the same reason an unmeasured dimension is not zero.
///   A measured score outside 0..1 is CLAMPED.
/// - **S5.** `floor` = the declared floor when it is a number, else
///   [`SCENARIO_DEFAULT_FLOOR`].
/// - **S6.** `floor_hit` = scope `must_hold` AND state `measured` AND
///   score < floor. `tracked` never hits a floor; `proposed` and
///   `out_of_scope` never compute one.
/// - **S7.** `advisory` = `floor_hit` AND `trust_state != "trusted"`. Note the
///   conjunction: advisory is only ever true on a row whose floor was HIT.
/// - **S8.** Envelope buckets, one scenario in exactly one: `proposed` ->
///   proposed; `out_of_scope` -> out_of_scope; in scope and unmeasured ->
///   unmeasured; in scope and measured -> holds when score >= the BUCKET floor
///   else weak. The bucket floor is the scenario's floor for `must_hold` and a
///   FLAT [`SCENARIO_DEFAULT_FLOOR`] for `tracked` - a tracked branch is
///   watched, not governed by a declared floor.
/// - **S9.** Every floor hit, advisory or binding, produces exactly one
///   `must_address` line: `Scenario <title> is below its floor (<score> <
///   <floor>)`.
/// - **S10.** The proof ladder is RECORDED and is not enforced here. "This is
///   only simulated" belongs in the scenario's `summary`; turning it into a
///   gate would be this instrument deciding what counts as evidence, which is
///   the member's job and the person's.
pub fn aggregate_scenarios(
    declared: &[ScenarioDeclaration],
    reported: &[ScenarioReport],
    trust_state: &str,
) -> ScenarioAggregate {
    // S1 - first wins, in both lists.
    let mut decl: BTreeMap<&str, &ScenarioDeclaration> = BTreeMap::new();
    let mut decl_order: Vec<&str> = Vec::new();
    for d in declared {
        if d.slug.is_empty() || decl.contains_key(d.slug.as_str()) {
            continue;
        }
        decl.insert(d.slug.as_str(), d);
        decl_order.push(d.slug.as_str());
    }
    let mut rep: BTreeMap<&str, &ScenarioReport> = BTreeMap::new();
    let mut rep_order: Vec<&str> = Vec::new();
    for r in reported {
        if r.slug.is_empty() || rep.contains_key(r.slug.as_str()) {
            continue;
        }
        rep.insert(r.slug.as_str(), r);
        rep_order.push(r.slug.as_str());
    }

    // S2 - declared order, then the discovered ones in reported order.
    let slugs: Vec<&str> = decl_order
        .iter()
        .copied()
        .chain(rep_order.iter().copied().filter(|s| !decl.contains_key(s)))
        .collect();

    let mut out = ScenarioAggregate::default();
    for slug in slugs {
        let d = decl.get(slug).copied();
        let r = rep.get(slug).copied();

        // S3
        let scope = d
            .map(|d| d.scope.as_str())
            .filter(|s| SCENARIO_SCOPES.contains(s))
            .unwrap_or("proposed")
            .to_string();

        // S4
        let mut state = r
            .map(|r| r.state.as_str())
            .filter(|s| SCENARIO_RESULT_STATES.contains(s))
            .unwrap_or("unmeasured")
            .to_string();
        let mut score = r.and_then(|r| r.score);
        if state == "measured" {
            match score {
                None => state = "unmeasured".to_string(),
                Some(s) => score = Some(s.clamp(0.0, 1.0)),
            }
        }
        if state != "measured" {
            score = None;
        }

        // S5 / S6 / S7
        let floor = resolve_scenario_floor(d.and_then(|d| d.floor));
        let floor_hit =
            scope == "must_hold" && state == "measured" && score.is_some_and(|s| s < floor);
        let advisory = floor_hit && trust_state != "trusted";

        let title = d
            .map(|d| d.title.as_str())
            .filter(|t| !t.is_empty())
            .or_else(|| r.and_then(|r| r.title.as_deref()).filter(|t| !t.is_empty()))
            .unwrap_or(slug)
            .to_string();
        let axes = d
            .map(|d| d.axes.clone())
            .filter(|a| !a.is_empty())
            .or_else(|| r.and_then(|r| r.axes.clone()))
            .unwrap_or_default();

        // S8 - exactly one bucket.
        if scope == "proposed" {
            out.envelope.proposed.push(slug.to_string());
        } else if scope == "out_of_scope" {
            out.envelope.out_of_scope.push(slug.to_string());
        } else if state != "measured" {
            out.envelope.unmeasured.push(slug.to_string());
        } else {
            // A tracked branch is WATCHED, not governed by a declared floor,
            // so its bucket boundary is the flat default even when the row
            // carries a number of its own.
            let bucket_floor = if scope == "must_hold" {
                floor
            } else {
                SCENARIO_DEFAULT_FLOOR
            };
            if score.is_some_and(|s| s >= bucket_floor) {
                out.envelope.holds.push(slug.to_string());
            } else {
                out.envelope.weak.push(slug.to_string());
            }
        }

        // S9
        if floor_hit {
            out.must_address.push(format!(
                "Scenario {title} is below its floor ({} < {floor})",
                score.unwrap_or_default()
            ));
            if advisory {
                out.advisory_floor_hits.push(slug.to_string());
            } else {
                out.binding_floor_hits.push(slug.to_string());
            }
        }

        out.scenarios.push(ScenarioFold {
            slug: slug.to_string(),
            title,
            axes,
            scope,
            floor,
            state,
            score,
            confidence: r
                .map(|r| r.confidence.as_str())
                .filter(|c| COUNCIL_CONFIDENCES.contains(c))
                .unwrap_or("low")
                .to_string(),
            n: r.and_then(|r| r.n).filter(|n| *n >= 1),
            proof: r
                .map(|r| r.proof.as_str())
                .filter(|p| SCENARIO_PROOFS.contains(p))
                .unwrap_or("claimed")
                .to_string(),
            summary: r.map(|r| r.summary.clone()).unwrap_or_default(),
            floor_hit,
            advisory,
        });
    }
    out
}

// ---------------------------------------------------------------------------
// Row models
// ---------------------------------------------------------------------------

/// One scenario: a feature applied to one condition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FeatureScenario {
    pub id: String,
    pub use_case_id: String,
    pub slug: String,
    pub title: String,
    /// Axis -> value, e.g. `{"candidate_family":"marketing"}`. A flat map of
    /// strings; the door refuses anything nested.
    pub axes: BTreeMap<String, String>,
    /// 'proposed' | 'must_hold' | 'tracked' | 'out_of_scope'
    pub scope: String,
    /// 'operator' | 'council' | 'telemetry' | 'incident'
    pub source: String,
    /// As DECLARED, so the row can say "nobody set one". `None` resolves to
    /// [`SCENARIO_DEFAULT_FLOOR`] wherever a floor is actually applied - see
    /// [`resolve_scenario_floor`]. Kept nullable here because this is the row
    /// the `state.json` export writes, and the skill's own S5 needs to see the
    /// same absence the store holds.
    pub floor: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

/// What one council round found for one scenario.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CouncilScenarioResult {
    pub id: String,
    pub run_id: String,
    pub scenario_id: String,
    /// 'measured' | 'unmeasured'
    pub state: String,
    /// `None` unless `state` is `measured`. Never `0.0` for "we did not look".
    pub score: Option<f64>,
    /// 'low' | 'med' | 'high'
    pub confidence: String,
    /// How many runs or turns the score rests on. `None` when the member did
    /// not say, which is not the same as one.
    pub n: Option<i32>,
    /// 'observed' | 'replayed' | 'simulated' | 'claimed'
    pub proof: String,
    pub floor_hit: bool,
    /// A floor hit that is RECORDED and does not sink the run, because the
    /// member that raised it has not earned the authority yet.
    pub advisory: bool,
    pub summary: String,
}

/// What a caller may set on a scenario. `id` absent means create.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpsertScenarioInput {
    /// `None` creates; `Some` updates that row and refuses if it is gone.
    pub id: Option<String>,
    pub use_case_id: String,
    /// Derived from `title` when absent or blank.
    pub slug: Option<String>,
    pub title: String,
    pub axes: BTreeMap<String, String>,
    pub scope: String,
    /// Stored as given. `None` on `must_hold` means the default floor applies.
    pub floor: Option<f64>,
}

// ---------------------------------------------------------------------------
// The board read model - ONE read for the whole page
// ---------------------------------------------------------------------------

/// The Features page, in one payload.
///
/// Everything the page draws comes from here: a project will carry 50-100
/// features over 200+ contexts, and a per-feature round trip would be a
/// hundred IPC calls to paint one screen.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FeatureBoard {
    pub project_id: String,
    pub project_name: String,
    pub totals: FeatureBoardTotals,
    pub groups: Vec<BoardGroup>,
    pub contexts: Vec<BoardContext>,
    pub features: Vec<BoardFeature>,
    /// The project has features but NOT ONE context link, so nothing has ever
    /// been sliced. The page must say "not scanned" rather than drawing 200
    /// unclaimed contexts and implying the codebase is abandoned.
    pub never_scanned: bool,
}

/// The counters above the board. Every one is `i32`: these reach a TS `number`,
/// and a `bigint` field would break every arithmetic use of it (census
/// `bigint-binding-field`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FeatureBoardTotals {
    pub contexts: i32,
    pub groups: i32,
    pub features: i32,
    pub majors: i32,
    pub core: i32,
    pub platform: i32,
    pub tests: i32,
    pub unclaimed: i32,
    /// Features whose council state is `ready` AND tier `major` - the ones
    /// sitting at a human gate right now.
    pub waiting_on_you: i32,
    /// Council state in fail / stalled / rejected / approved_drifted.
    pub in_trouble: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoardGroup {
    pub id: String,
    pub name: String,
    pub domain: Option<String>,
    pub context_count: i32,
    /// Distinct features whose slice reaches any context of this group.
    pub feature_count: i32,
    /// Not one context of this group is `core`. A whole group no feature
    /// reaches is a different finding from a single unclaimed context.
    pub untouched: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoardContext {
    pub id: String,
    pub name: String,
    pub group_id: Option<String>,
    pub category: Option<String>,
    /// 'core' | 'tests' | 'platform' | 'unclaimed' - see
    /// [`derive_context_role`].
    pub role: String,
    /// The features that claim this context, by slug.
    pub feature_slugs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoardFeature {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    /// 'user_flow' | 'capability' | 'integration' | 'ops'
    pub kind: String,
    /// 'major' | 'standard'
    pub tier: String,
    pub context_ids: Vec<String>,
    /// The distinct groups this feature's slice crosses.
    pub group_ids: Vec<String>,
    pub primary_context_id: Option<String>,
    /// `None` when no council has ever judged this feature - which is NOT the
    /// same as a council that found nothing.
    pub council: Option<CouncilSubjectState>,
    /// The LATEST run's verdicts, one per rubric dimension.
    pub verdicts: Vec<BoardVerdict>,
    /// Every round, oldest first.
    pub history: Vec<BoardRound>,
    pub scenarios: Vec<BoardScenario>,
    /// Where this feature's approval holds, is weak, and was never looked at.
    /// `None` when the feature declares no scenarios and no run reported any -
    /// which is not an empty envelope, it is no envelope. Computed by
    /// [`aggregate_scenarios`], the same function the ingest door recomputes
    /// an incoming result with, so the page cannot show a second answer.
    pub envelope: Option<BoardEnvelope>,
    /// 30-day LLM spend attributed to this feature. `None` everywhere today:
    /// `dev_llm_spend` carries no use-case dimension, and a join invented here
    /// would be a number with nothing behind it.
    pub spend30d_usd: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoardVerdict {
    pub dimension: String,
    /// 'mechanical' | 'judged' | 'mixed'
    pub kind: String,
    /// 'measured' | 'unmeasured' | 'not_applicable' | 'carried'
    pub state: String,
    pub score: Option<f64>,
    /// From the pinned rubric constants, not from the row: the weight is what
    /// the app believes, and a stored copy would drift from it silently.
    pub weight: f64,
    pub floor: Option<f64>,
    pub floor_hit: bool,
    pub advisory: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoardRound {
    pub round_no: i32,
    pub overall: Option<f64>,
    /// 'ready' | 'fail' | 'incomplete' | 'stalled'
    pub outcome: String,
    pub finished_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoardScenario {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub axes: BTreeMap<String, String>,
    /// 'proposed' | 'must_hold' | 'tracked' | 'out_of_scope'
    pub scope: String,
    /// 'operator' | 'council' | 'telemetry' | 'incident'
    pub source: String,
    /// RESOLVED, not declared: a scenario that named no floor reads
    /// [`SCENARIO_DEFAULT_FLOOR`] here. Every scope resolves one; only
    /// `must_hold` is failed by it.
    pub floor: f64,
    /// The latest run's result for this scenario, if any run measured it.
    pub latest: Option<BoardScenarioResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BoardScenarioResult {
    pub run_id: String,
    /// 'measured' | 'unmeasured'
    pub state: String,
    pub score: Option<f64>,
    pub confidence: String,
    pub n: Option<i32>,
    /// 'observed' | 'replayed' | 'simulated' | 'claimed'
    pub proof: String,
    pub floor_hit: bool,
    pub advisory: bool,
    pub summary: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn role(
        in_feature: bool,
        name: &str,
        category: Option<&str>,
        domain: Option<&str>,
    ) -> &'static str {
        derive_context_role(&ContextRoleInputs {
            in_active_feature: in_feature,
            name,
            category,
            group_domain: domain,
        })
    }

    /// The whole rule as one table, ordering included.
    #[test]
    fn the_context_role_table() {
        // core outranks everything, including a test-looking name and a
        // platform domain: a context a live feature goes through IS product.
        assert_eq!(
            role(true, "checkout-api", Some("api"), Some("feature")),
            "core"
        );
        assert_eq!(
            role(true, "tests-checkout", Some("test"), Some("shared")),
            "core"
        );

        // tests, by category and by name.
        assert_eq!(
            role(false, "checkout-api", Some("test"), Some("feature")),
            "tests"
        );
        assert_eq!(role(false, "tests-checkout", None, None), "tests");
        assert_eq!(role(false, "test-harness", None, None), "tests");
        assert_eq!(role(false, "pipeline-tests", None, None), "tests");

        // platform, by group domain...
        for domain in PLATFORM_DOMAINS {
            assert_eq!(
                role(false, "vault-crypto", Some("api"), Some(domain)),
                "platform",
                "{domain}"
            );
        }
        // ...and by the context's own category.
        for category in PLATFORM_CATEGORIES {
            assert_eq!(
                role(false, "vault-crypto", Some(category), Some("feature")),
                "platform",
                "{category}"
            );
        }

        // and the finding: reached by nothing, not tests, not machinery.
        assert_eq!(
            role(false, "checkout-api", Some("ui"), Some("feature")),
            "unclaimed"
        );
        assert_eq!(role(false, "checkout-api", None, None), "unclaimed");
    }

    /// A `test` category and a test-shaped name are the same answer, and
    /// neither is reached while the context is claimed.
    #[test]
    fn a_claimed_test_context_is_still_core() {
        assert!(is_test_context("tests-companion-voice"));
        assert!(is_test_context("Test-Harness"));
        assert!(is_test_context("pipeline-tests"));
        assert!(!is_test_context("voice-interview-api"));
        assert!(!is_test_context("contest-runner"));
    }

    /// S5: every scope resolves a floor, and an undeclared one is the default.
    #[test]
    fn an_undeclared_floor_resolves_to_the_default() {
        assert_eq!(resolve_scenario_floor(None), 0.5);
        assert_eq!(resolve_scenario_floor(Some(0.7)), 0.7);
    }

    fn declare(slug: &str, scope: &str, floor: Option<f64>) -> ScenarioDeclaration {
        ScenarioDeclaration {
            slug: slug.to_string(),
            title: format!("{slug} candidates"),
            axes: [("family".to_string(), slug.to_string())]
                .into_iter()
                .collect(),
            scope: scope.to_string(),
            floor,
        }
    }

    fn report(slug: &str, state: &str, score: Option<f64>) -> ScenarioReport {
        ScenarioReport {
            slug: slug.to_string(),
            title: None,
            axes: None,
            state: state.to_string(),
            score,
            confidence: "med".to_string(),
            n: Some(4),
            proof: "simulated".to_string(),
            summary: "s".to_string(),
        }
    }

    /// S2: declared order first, then the discovered ones in reported order.
    #[test]
    fn the_scenario_set_is_declared_order_then_discovered() {
        let declared = vec![
            declare("it", "must_hold", None),
            declare("marketing", "tracked", None),
        ];
        let reported = vec![
            report("hr", "measured", Some(0.9)),
            report("marketing", "measured", Some(0.8)),
        ];
        let agg = aggregate_scenarios(&declared, &reported, "uncalibrated");
        assert_eq!(
            agg.scenarios
                .iter()
                .map(|s| s.slug.as_str())
                .collect::<Vec<_>>(),
            vec!["it", "marketing", "hr"]
        );
        // S3: a member may propose, not promote.
        assert_eq!(agg.scenarios[2].scope, "proposed");
        assert_eq!(agg.envelope.proposed, vec!["hr".to_string()]);
        // A declared scenario nobody reported is unmeasured, not absent.
        assert_eq!(agg.scenarios[0].state, "unmeasured");
        assert_eq!(agg.scenarios[0].score, None);
        assert_eq!(agg.envelope.unmeasured, vec!["it".to_string()]);
    }

    /// S6 + S7, and the asymmetry the whole layer turns on: a hit is loud and
    /// inert while the judges are uncalibrated, and binds once they are
    /// trusted. `advisory` is NEVER true on a row whose floor was not hit.
    #[test]
    fn a_must_hold_floor_hit_is_advisory_until_the_judges_are_trusted() {
        let declared = vec![declare("marketing", "must_hold", None)];
        let reported = vec![report("marketing", "measured", Some(0.3))];

        let loose = aggregate_scenarios(&declared, &reported, "uncalibrated");
        assert!(loose.scenarios[0].floor_hit);
        assert!(loose.scenarios[0].advisory);
        assert_eq!(loose.binding_floor_hits, Vec::<String>::new());
        assert_eq!(loose.advisory_floor_hits, vec!["marketing".to_string()]);

        let strict = aggregate_scenarios(&declared, &reported, "trusted");
        assert!(strict.scenarios[0].floor_hit);
        assert!(
            !strict.scenarios[0].advisory,
            "a trusted judge's floor binds"
        );
        assert_eq!(strict.binding_floor_hits, vec!["marketing".to_string()]);

        // A row that cleared its floor is neither hit nor advisory, at either
        // trust state - advisory describes a SUPPRESSED objection, not a mood.
        let clean = aggregate_scenarios(
            &declared,
            &[report("marketing", "measured", Some(0.9))],
            "uncalibrated",
        );
        assert!(!clean.scenarios[0].floor_hit);
        assert!(!clean.scenarios[0].advisory);
    }

    /// S6 + S8: `tracked` never HITS a floor, and its bucket boundary is a
    /// flat 0.5 even when the row declares a floor of its own.
    #[test]
    fn a_tracked_scenario_never_hits_a_floor_and_buckets_at_a_flat_half() {
        // Declares 0.9, scores 0.7: no hit, and it HOLDS, because 0.7 >= 0.5.
        let agg = aggregate_scenarios(
            &[declare("marketing", "tracked", Some(0.9))],
            &[report("marketing", "measured", Some(0.7))],
            "trusted",
        );
        assert!(!agg.scenarios[0].floor_hit, "tracked never gates");
        assert!(agg.binding_floor_hits.is_empty());
        assert_eq!(agg.envelope.holds, vec!["marketing".to_string()]);
        assert_eq!(
            agg.scenarios[0].floor, 0.9,
            "the declared floor is still recorded"
        );

        // Under the flat half it is weak - still not a hit.
        let weak = aggregate_scenarios(
            &[declare("marketing", "tracked", Some(0.9))],
            &[report("marketing", "measured", Some(0.4))],
            "trusted",
        );
        assert!(!weak.scenarios[0].floor_hit);
        assert_eq!(weak.envelope.weak, vec!["marketing".to_string()]);

        // A must_hold with the same numbers DOES hit, at its own floor.
        let bound = aggregate_scenarios(
            &[declare("marketing", "must_hold", Some(0.9))],
            &[report("marketing", "measured", Some(0.7))],
            "trusted",
        );
        assert!(bound.scenarios[0].floor_hit);
        assert_eq!(bound.envelope.weak, vec!["marketing".to_string()]);
    }

    /// S8: one scenario, exactly one bucket - and the two out-of-play scopes
    /// land in their own whatever their state.
    #[test]
    fn every_scenario_lands_in_exactly_one_bucket() {
        let declared = vec![
            declare("it", "must_hold", None),
            declare("marketing", "must_hold", None),
            declare("ops", "tracked", None),
            declare("legacy", "out_of_scope", None),
            declare("hr", "proposed", None),
        ];
        let reported = vec![
            report("it", "measured", Some(0.9)),
            report("marketing", "measured", Some(0.3)),
            report("ops", "unmeasured", None),
            report("legacy", "measured", Some(0.1)),
            report("hr", "measured", Some(1.0)),
        ];
        let e = aggregate_scenarios(&declared, &reported, "uncalibrated").envelope;
        assert_eq!(e.holds, vec!["it".to_string()]);
        assert_eq!(e.weak, vec!["marketing".to_string()]);
        assert_eq!(e.unmeasured, vec!["ops".to_string()]);
        assert_eq!(
            e.out_of_scope,
            vec!["legacy".to_string()],
            "measured, and still out of play"
        );
        assert_eq!(
            e.proposed,
            vec!["hr".to_string()],
            "a proposal moves nothing"
        );

        let total = e.holds.len()
            + e.weak.len()
            + e.unmeasured.len()
            + e.out_of_scope.len()
            + e.proposed.len();
        assert_eq!(total, 5, "one bucket each, no scenario twice and none lost");
    }

    /// S9: one line per hit, advisory or binding, in the exact wording the
    /// skill emits - a consumer diffing the two must see the same string.
    #[test]
    fn a_floor_hit_produces_one_must_address_line() {
        let agg = aggregate_scenarios(
            &[declare("marketing", "must_hold", None)],
            &[report("marketing", "measured", Some(0.3))],
            "uncalibrated",
        );
        assert_eq!(
            agg.must_address,
            vec!["Scenario marketing candidates is below its floor (0.3 < 0.5)".to_string()]
        );
    }

    /// S4: a report claiming `measured` with no score reads as unmeasured
    /// rather than as a zero, and a score outside 0..1 is clamped.
    #[test]
    fn a_measured_report_with_no_score_is_not_a_zero() {
        let declared = vec![declare("marketing", "must_hold", None)];
        let agg = aggregate_scenarios(
            &declared,
            &[report("marketing", "measured", None)],
            "trusted",
        );
        assert_eq!(agg.scenarios[0].state, "unmeasured");
        assert_eq!(agg.scenarios[0].score, None);
        assert!(
            !agg.scenarios[0].floor_hit,
            "nothing was measured to be below"
        );
        assert_eq!(agg.envelope.unmeasured, vec!["marketing".to_string()]);

        let clamped = aggregate_scenarios(
            &declared,
            &[report("marketing", "measured", Some(1.5))],
            "trusted",
        );
        assert_eq!(clamped.scenarios[0].score, Some(1.0));
    }

    /// S10: the proof ladder is recorded and gates nothing. `simulated`
    /// evidence on a must-hold branch that clears its floor still holds.
    #[test]
    fn the_proof_ladder_is_recorded_and_never_gates() {
        let mut r = report("marketing", "measured", Some(0.9));
        r.proof = "claimed".into();
        let agg = aggregate_scenarios(&[declare("marketing", "must_hold", None)], &[r], "trusted");
        assert_eq!(agg.scenarios[0].proof, "claimed");
        assert_eq!(agg.envelope.holds, vec!["marketing".to_string()]);
        assert!(agg.binding_floor_hits.is_empty());
    }

    /// Neither side declares anything: the fold is empty, which is how a
    /// pre-scenario result stays byte-identical to what it always was.
    #[test]
    fn nothing_declared_and_nothing_reported_folds_to_nothing() {
        let agg = aggregate_scenarios(&[], &[], "uncalibrated");
        assert!(agg.scenarios.is_empty());
        assert_eq!(agg.envelope, BoardEnvelope::default());
        assert!(agg.must_address.is_empty());
    }
}
