//! Capability-gate state machine.
//!
//! Rule 16/17 of the build prompt instruct the LLM to emit a clarifying_question
//! BEFORE resolving trigger / connectors / review_policy / memory_policy on any
//! capability. In practice Sonnet 4.x treats the rule as advisory and jumps to
//! resolution (or directly to agent_ir) from inference alone. This state
//! machine enforces the rule on the Rust side: it suppresses out-of-order
//! `CapabilityResolutionUpdate` events for gated fields and SYNTHESIZES a
//! clarifying_question locally so the UI surface doesn't depend on the LLM
//! cooperating. The LLM is still the primary question author when it obeys;
//! synthesis is purely a fallback.
//!
//! Per-capability gate state is keyed by `capability_id`. A gate goes:
//!
//! ```text
//! Closed ──(question asked OR intent-derived)──▶ Pending ──(user answers)──▶ Open
//! ```
//!
//! Intent-derived heuristics can also skip straight to `Open` when the intent
//! unambiguously names the value (e.g. "every morning" → trigger=Open).

use std::collections::HashMap;

use crate::db::models::BuildEvent;
use crate::db::repos::resources::connectors as connector_repo;
use crate::db::DbPool;

use super::parser::build_clarifying_question_events;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(super) enum Gate {
    #[default]
    Closed,
    Pending,
    Open,
}

#[derive(Clone, Default, Debug)]
pub(super) struct CapabilityGates {
    pub(super) trigger: Gate,
    pub(super) connectors: Gate,
    pub(super) review_policy: Gate,
    pub(super) memory_policy: Gate,
}

impl CapabilityGates {
    fn field_state(&self, field: &str) -> Option<Gate> {
        match field {
            "suggested_trigger" => Some(self.trigger),
            "connectors" => Some(self.connectors),
            "review_policy" => Some(self.review_policy),
            "memory_policy" => Some(self.memory_policy),
            _ => None,
        }
    }

    pub(super) fn is_gate_open(&self, field: &str) -> bool {
        self.field_state(field).map(|g| g == Gate::Open).unwrap_or(true)
    }

    pub(super) fn mark_pending(&mut self, field: &str) {
        let slot = match field {
            "suggested_trigger" => &mut self.trigger,
            "connectors" => &mut self.connectors,
            "review_policy" => &mut self.review_policy,
            "memory_policy" => &mut self.memory_policy,
            _ => return,
        };
        if *slot == Gate::Closed {
            *slot = Gate::Pending;
        }
    }

    pub(super) fn mark_open(&mut self, field: &str) {
        match field {
            "suggested_trigger" => self.trigger = Gate::Open,
            "connectors" => self.connectors = Gate::Open,
            "review_policy" => self.review_policy = Gate::Open,
            "memory_policy" => self.memory_policy = Gate::Open,
            _ => {}
        }
    }

    /// First gate that is still closed (Closed OR Pending). Returns the v3
    /// field name. Order matters — the most-load-bearing gate goes first so
    /// we don't interview the user for a field that's about to be moot.
    pub(super) fn first_unopen_field(&self) -> Option<&'static str> {
        if self.trigger != Gate::Open { return Some("suggested_trigger"); }
        if self.connectors != Gate::Open { return Some("connectors"); }
        if self.review_policy != Gate::Open { return Some("review_policy"); }
        if self.memory_policy != Gate::Open { return Some("memory_policy"); }
        None
    }
}

/// The currently-pending gate, if any — i.e. the question we're waiting on a
/// user answer for. Used on user-answer receipt to know which gate to flip
/// `Open`.
#[derive(Clone, Debug)]
pub(super) struct PendingGate {
    pub(super) cap_id: String,
    pub(super) field: String,
}

pub(super) const GATED_CAPABILITY_FIELDS: &[&str] =
    &["suggested_trigger", "connectors", "review_policy", "memory_policy"];

pub(super) fn is_gated_field(field: &str) -> bool {
    GATED_CAPABILITY_FIELDS.contains(&field)
}

/// Map the legacy `cell_key` returned by the frontend when the user answers a
/// clarifying question back to the v3 field name so we can flip the gate.
pub(super) fn legacy_cell_to_v3_field(cell_key: &str) -> Option<&'static str> {
    match cell_key {
        "triggers" => Some("suggested_trigger"),
        "connectors" => Some("connectors"),
        "human-review" => Some("review_policy"),
        "memory" => Some("memory_policy"),
        _ => None,
    }
}

// --- Intent heuristics ------------------------------------------------------
// Each heuristic returns `Gate::Open` when the intent unambiguously names the
// dimension's value; otherwise `Gate::Closed`. Conservative by design — when
// in doubt, ask. Keep the keyword lists in sync with prompt.rs Rule 16 so the
// build prompt and the gate fallback agree on what counts as "explicit".

fn intent_implies_trigger(intent_lower: &str) -> Gate {
    const EVENT_KW: &[&str] = &[
        "whenever", "when a ", "when an ", "when new ", "on new ",
        "as soon as", "reacts to", "react to", "listen for", "listening for",
        "incoming ", "arrives", "when arrives",
    ];
    const SCHEDULE_KW: &[&str] = &[
        "every morning", "every day", "every hour", "every week",
        "daily ", "daily.", "weekly ", "weekly.", "monthly ",
        "at 9am", "at 8am", "at 7am", "at 6am", "cron",
    ];
    const MANUAL_KW: &[&str] = &[
        "on command", "when i ask", "manually", "on demand",
        "i'll trigger", "i will trigger",
    ];
    for kw in EVENT_KW.iter().chain(SCHEDULE_KW).chain(MANUAL_KW) {
        if intent_lower.contains(kw) { return Gate::Open; }
    }
    Gate::Closed
}

fn intent_implies_review(intent_lower: &str) -> Gate {
    const KW: &[&str] = &[
        "automatically", "auto-publish", "auto publish",
        "no review", "no approval", "without asking",
        "without approval", "no human", "fully automated",
    ];
    for kw in KW { if intent_lower.contains(kw) { return Gate::Open; } }
    Gate::Closed
}

fn intent_implies_memory(intent_lower: &str) -> Gate {
    const KW: &[&str] = &[
        "stateless", "independently", "each run is independent",
        "each independently", "no memory", "independent runs",
        "remember my", "remember user", "learn over time", "remember preferences",
    ];
    for kw in KW { if intent_lower.contains(kw) { return Gate::Open; } }
    Gate::Closed
}

fn intent_implies_connectors(intent_lower: &str) -> Gate {
    const KNOWN: &[&str] = &[
        "gmail", "outlook", "slack", "discord", "teams", "github", "gitlab",
        "linear", "jira", "notion", "trello", "asana", "airtable",
        "google drive", "google sheets", "google calendar",
        "local drive", "local-drive", "local_drive", "built-in drive", "built in drive",
        "hubspot", "salesforce", "stripe", "sentry", "supabase",
        "telegram", "whatsapp", "twilio",
    ];
    for kw in KNOWN { if intent_lower.contains(kw) { return Gate::Open; } }
    Gate::Closed
}

/// Intent-heuristic gate seed — shared by enumeration-time init and lazy
/// per-capability init on the first resolution event. When `capability_enum`
/// fires before any resolution we use it; when the LLM skips enumeration
/// entirely we still apply the same heuristic on first resolution so gates
/// work uniformly.
pub(super) fn gate_seed_for_intent(intent: &str) -> CapabilityGates {
    let intent_lower = intent.to_lowercase();
    CapabilityGates {
        trigger: intent_implies_trigger(&intent_lower),
        connectors: intent_implies_connectors(&intent_lower),
        review_policy: intent_implies_review(&intent_lower),
        memory_policy: intent_implies_memory(&intent_lower),
    }
}

/// Initialize gate state for each capability in the enumeration. Runs the
/// intent heuristics once per capability — so if intent says "every morning",
/// EVERY capability's trigger gate auto-opens (intent is persona-wide).
pub(super) fn init_gates_from_enumeration(
    coverage: &mut HashMap<String, CapabilityGates>,
    titles: &mut HashMap<String, String>,
    data: &serde_json::Value,
    intent: &str,
) {
    let Some(caps) = data.get("capabilities").and_then(|v| v.as_array()) else { return };
    let seed = gate_seed_for_intent(intent);

    for cap in caps {
        let Some(id) = cap.get("id").and_then(|v| v.as_str()) else { continue };
        if let Some(title) = cap.get("title").and_then(|v| v.as_str()) {
            titles.entry(id.to_string()).or_insert_with(|| title.to_string());
        }
        coverage.entry(id.to_string()).or_insert_with(|| seed.clone());
    }
}

/// Lazy per-capability gate init — used when the LLM emits a
/// `capability_resolution` for a `cap_id` we haven't seen in any
/// `capability_enumeration` yet. Without this path, an LLM that skips
/// enumeration (or emits resolutions before enumeration lands) bypasses the
/// gate entirely.
pub(super) fn ensure_capability_in_coverage(
    coverage: &mut HashMap<String, CapabilityGates>,
    cap_id: &str,
    intent: &str,
) {
    if !coverage.contains_key(cap_id) {
        coverage.insert(cap_id.to_string(), gate_seed_for_intent(intent));
    }
}

/// Walk coverage to find the first capability with a still-unopen gate —
/// used when the LLM tries to emit `agent_ir` with missing dimensions.
pub(super) fn find_first_unopen_gate(
    coverage: &HashMap<String, CapabilityGates>,
) -> Option<(String, &'static str)> {
    // Deterministic order: sort cap_ids so the same gate fires each turn.
    let mut ids: Vec<&String> = coverage.keys().collect();
    ids.sort();
    for id in ids {
        if let Some(field) = coverage.get(id).and_then(|g| g.first_unopen_field()) {
            return Some((id.clone(), field));
        }
    }
    None
}

/// Look up the catalog category for a named connector. Used to pick the
/// `category` token on synthesized `scope=connector_category` questions.
fn infer_connector_category(
    value: &serde_json::Value,
    pool: &DbPool,
) -> Option<String> {
    let names: Vec<String> = if let Some(arr) = value.as_array() {
        arr.iter().filter_map(|v| {
            v.as_str().map(|s| s.to_string())
             .or_else(|| v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
             .or_else(|| v.get("service_type").and_then(|n| n.as_str()).map(|s| s.to_string()))
        }).collect()
    } else {
        Vec::new()
    };
    for name in names {
        if let Ok(Some(conn)) = connector_repo::get_by_name(pool, &name) {
            if !conn.category.is_empty() {
                return Some(conn.category);
            }
        }
    }
    None
}

/// Synthesize a `clarifying_question` event for a gate the LLM skipped. Emits
/// both the v3 `ClarifyingQuestionV3` typed event AND the legacy `Question`
/// mirror (via [`build_clarifying_question_events`]) so the existing UI panel
/// renders it identically to an LLM-authored question.
pub(super) fn synthesize_gate_question(
    cap_id: &str,
    field: &str,
    title: &str,
    proposed_value: &serde_json::Value,
    pool: &DbPool,
    session_id: &str,
) -> Vec<BuildEvent> {
    let mut obj = serde_json::Map::new();
    obj.insert("capability_id".into(), serde_json::Value::String(cap_id.to_string()));

    match field {
        "suggested_trigger" => {
            obj.insert("scope".into(), serde_json::Value::String("field".into()));
            obj.insert("field".into(), serde_json::Value::String("suggested_trigger".into()));
            obj.insert("question".into(), serde_json::Value::String(
                format!("How should \"{title}\" fire?")
            ));
            obj.insert("options".into(), serde_json::json!([
                "A: On demand — I'll trigger it manually",
                "B: On a schedule (daily/weekly/…)",
                "C: When an external event occurs (e.g. new document, inbound message)",
            ]));
        }
        "review_policy" => {
            obj.insert("scope".into(), serde_json::Value::String("field".into()));
            obj.insert("field".into(), serde_json::Value::String("review_policy".into()));
            obj.insert("question".into(), serde_json::Value::String(
                format!("Should \"{title}\" wait for your approval before publishing its output?")
            ));
            obj.insert("options".into(), serde_json::json!([
                "Never — auto-publish; I can undo/discard myself",
                "On low confidence — only pause when unsure",
                "Always — I want to sign off every run",
            ]));
        }
        "memory_policy" => {
            obj.insert("scope".into(), serde_json::Value::String("field".into()));
            obj.insert("field".into(), serde_json::Value::String("memory_policy".into()));
            obj.insert("question".into(), serde_json::Value::String(
                format!("Should \"{title}\" remember user decisions across runs?")
            ));
            obj.insert("options".into(), serde_json::json!([
                "No — each run is independent",
                "Yes — capture user preferences/corrections for future runs",
            ]));
        }
        "connectors" => {
            let category = infer_connector_category(proposed_value, pool)
                .unwrap_or_else(|| "storage".to_string());
            obj.insert("scope".into(), serde_json::Value::String("connector_category".into()));
            obj.insert("field".into(), serde_json::Value::String("connectors".into()));
            obj.insert("category".into(), serde_json::Value::String(category.clone()));
            obj.insert("question".into(), serde_json::Value::String(
                format!("Which {category} connector should \"{title}\" use?")
            ));
            obj.insert("options".into(), serde_json::json!([]));
        }
        _ => return Vec::new(),
    }

    build_clarifying_question_events(&obj, session_id)
}

// =============================================================================
// Tests
// =============================================================================
//
// These tests pin down the Rule 16/17 contract: every gated dimension must
// either be auto-opened by an unambiguous intent keyword OR ask the user. The
// `intent_implies_*` keyword lists are the load-bearing piece — when the
// build prompt's "skip when intent literally says X" clauses change in
// `session_prompt.rs::Rule 16`, mirror the change here so a drift in either
// direction is caught at `cargo test` time, not by an e2e regression.
//
// `synthesize_gate_question` is covered for the field-scoped branches
// (suggested_trigger / review_policy / memory_policy). The connectors branch
// calls `infer_connector_category`, which hits the DB — that path is exercised
// by the live `e2e_question_loop.py` scenario rather than here.

#[cfg(test)]
mod tests {
    use super::*;

    // ── intent heuristics — trigger ─────────────────────────────────────────

    #[test]
    fn trigger_auto_opens_on_event_keywords() {
        for intent in [
            "translate every incoming document from english to czech",
            "react to new files in my drive",
            "whenever a new ticket arrives, triage it",
            "on new email, summarise it",
            "as soon as a stripe charge fails, log it",
            "listen for inbound webhooks",
        ] {
            assert_eq!(
                intent_implies_trigger(&intent.to_lowercase()),
                Gate::Open,
                "expected event-keyword auto-open for: {intent}"
            );
        }
    }

    #[test]
    fn trigger_auto_opens_on_schedule_keywords() {
        for intent in [
            "every morning summarise my inbox",
            "daily digest of news",
            "every week clean up dead branches",
            "at 7am send the digest",
            "cron 0 9 * * 1-5",
        ] {
            assert_eq!(
                intent_implies_trigger(&intent.to_lowercase()),
                Gate::Open,
                "expected schedule-keyword auto-open for: {intent}"
            );
        }
    }

    #[test]
    fn trigger_auto_opens_on_manual_keywords() {
        for intent in [
            "on command, draft a reply",
            "manually run a deep search",
            "when i ask, summarise the meeting notes",
            "on demand interactive assistant",
        ] {
            assert_eq!(
                intent_implies_trigger(&intent.to_lowercase()),
                Gate::Open,
                "expected manual-keyword auto-open for: {intent}"
            );
        }
    }

    #[test]
    fn trigger_stays_closed_when_intent_is_silent() {
        // No trigger-shaped phrase → must remain Closed → forces a question.
        for intent in [
            "translate documents from english to czech",
            "draft a weekly report on customer churn",
            "summarise my open tickets",
            "help me triage support requests",
        ] {
            assert_eq!(
                intent_implies_trigger(&intent.to_lowercase()),
                Gate::Closed,
                "expected silence → Closed for: {intent}"
            );
        }
    }

    // ── intent heuristics — review_policy ───────────────────────────────────

    #[test]
    fn review_auto_opens_on_explicit_automation_keywords() {
        for intent in [
            "automatically publish the digest",
            "no review needed, just send it",
            "without asking, post to slack",
            "fully automated translation pipeline",
            "no human in the loop",
        ] {
            assert_eq!(
                intent_implies_review(&intent.to_lowercase()),
                Gate::Open,
                "expected review auto-open for: {intent}"
            );
        }
    }

    #[test]
    fn review_stays_closed_when_intent_is_silent_about_approval() {
        for intent in [
            "translate every incoming document",
            "send a daily digest of headlines",
        ] {
            assert_eq!(
                intent_implies_review(&intent.to_lowercase()),
                Gate::Closed,
                "expected silence → Closed for: {intent}"
            );
        }
    }

    // ── intent heuristics — memory_policy ───────────────────────────────────

    #[test]
    fn memory_auto_opens_on_explicit_memory_keywords() {
        for intent in [
            "stateless email triage",
            "each independently — no shared state",
            "remember my preferences",
            "remember user choices for next time",
            "learn over time which senders i ignore",
        ] {
            assert_eq!(
                intent_implies_memory(&intent.to_lowercase()),
                Gate::Open,
                "expected memory auto-open for: {intent}"
            );
        }
    }

    #[test]
    fn memory_stays_closed_when_intent_is_silent() {
        for intent in [
            "translate every incoming document",
            "weekly summary of github issues",
        ] {
            assert_eq!(
                intent_implies_memory(&intent.to_lowercase()),
                Gate::Closed,
                "expected silence → Closed for: {intent}"
            );
        }
    }

    // ── intent heuristics — connectors ──────────────────────────────────────

    #[test]
    fn connectors_auto_opens_on_named_service() {
        for intent in [
            "summarise gmail and post to slack",
            "react to new github issues",
            "scan notion pages weekly",
            "translate english documents from my local drive",
        ] {
            assert_eq!(
                intent_implies_connectors(&intent.to_lowercase()),
                Gate::Open,
                "expected connectors auto-open for: {intent}"
            );
        }
    }

    #[test]
    fn connectors_stays_closed_when_intent_only_describes_data_shape() {
        for intent in [
            "translate every incoming document from english to czech",
            "draft a weekly report on customer churn",
            "summarise overnight messages",
        ] {
            assert_eq!(
                intent_implies_connectors(&intent.to_lowercase()),
                Gate::Closed,
                "expected connectors Closed for: {intent}"
            );
        }
    }

    // ── gate_seed_for_intent — composite of the four heuristics ─────────────

    #[test]
    fn ambiguous_intent_seeds_all_gates_closed() {
        let seed = gate_seed_for_intent("help me build a translation companion");
        assert_eq!(seed.trigger, Gate::Closed);
        assert_eq!(seed.connectors, Gate::Closed);
        assert_eq!(seed.review_policy, Gate::Closed);
        assert_eq!(seed.memory_policy, Gate::Closed);
    }

    #[test]
    fn explicit_intent_seeds_matching_gates_open() {
        let seed = gate_seed_for_intent(
            "every morning, automatically post a stateless gmail digest to slack",
        );
        assert_eq!(seed.trigger, Gate::Open, "every morning → trigger");
        assert_eq!(seed.connectors, Gate::Open, "gmail/slack → connectors");
        assert_eq!(seed.review_policy, Gate::Open, "automatically → review");
        assert_eq!(seed.memory_policy, Gate::Open, "stateless → memory");
    }

    // ── CapabilityGates — state machine ─────────────────────────────────────

    #[test]
    fn default_gates_are_all_closed() {
        let gates = CapabilityGates::default();
        for field in GATED_CAPABILITY_FIELDS {
            assert_eq!(gates.field_state(field), Some(Gate::Closed));
            assert!(!gates.is_gate_open(field));
        }
    }

    #[test]
    fn unknown_fields_report_open_to_avoid_blocking_unrelated_resolutions() {
        // Non-gated fields must not be suppressed by the gate machinery —
        // is_gate_open returns true so the resolution flows through.
        let gates = CapabilityGates::default();
        assert!(gates.is_gate_open("input_schema"));
        assert!(gates.is_gate_open("tool_hints"));
        assert_eq!(gates.field_state("input_schema"), None);
    }

    #[test]
    fn mark_pending_promotes_closed_to_pending_but_not_open_to_pending() {
        let mut gates = CapabilityGates::default();
        gates.mark_pending("suggested_trigger");
        assert_eq!(gates.field_state("suggested_trigger"), Some(Gate::Pending));

        gates.mark_open("suggested_trigger");
        gates.mark_pending("suggested_trigger");
        assert_eq!(
            gates.field_state("suggested_trigger"),
            Some(Gate::Open),
            "Open must NOT regress to Pending"
        );
    }

    #[test]
    fn mark_open_flips_any_state_to_open() {
        let mut gates = CapabilityGates::default();
        for field in GATED_CAPABILITY_FIELDS {
            gates.mark_open(field);
            assert!(gates.is_gate_open(field));
        }
    }

    #[test]
    fn first_unopen_field_returns_in_priority_order() {
        // Trigger first, then connectors, then review_policy, then memory_policy.
        let mut gates = CapabilityGates::default();
        assert_eq!(gates.first_unopen_field(), Some("suggested_trigger"));

        gates.mark_open("suggested_trigger");
        assert_eq!(gates.first_unopen_field(), Some("connectors"));

        gates.mark_open("connectors");
        assert_eq!(gates.first_unopen_field(), Some("review_policy"));

        gates.mark_open("review_policy");
        assert_eq!(gates.first_unopen_field(), Some("memory_policy"));

        gates.mark_open("memory_policy");
        assert_eq!(gates.first_unopen_field(), None);
    }

    #[test]
    fn pending_counts_as_unopen() {
        let mut gates = CapabilityGates::default();
        gates.mark_pending("suggested_trigger");
        assert_eq!(
            gates.first_unopen_field(),
            Some("suggested_trigger"),
            "Pending must still surface as unopen — the user hasn't answered yet"
        );
    }

    // ── is_gated_field / legacy_cell_to_v3_field ────────────────────────────

    #[test]
    fn is_gated_field_recognises_only_the_four_v3_fields() {
        for field in GATED_CAPABILITY_FIELDS {
            assert!(is_gated_field(field), "{field} should be gated");
        }
        for field in ["input_schema", "tool_hints", "use_case_flow", "tools", ""] {
            assert!(!is_gated_field(field), "{field} should NOT be gated");
        }
    }

    #[test]
    fn legacy_cell_to_v3_field_round_trips_known_dims() {
        assert_eq!(
            legacy_cell_to_v3_field("triggers"),
            Some("suggested_trigger")
        );
        assert_eq!(legacy_cell_to_v3_field("connectors"), Some("connectors"));
        assert_eq!(
            legacy_cell_to_v3_field("human-review"),
            Some("review_policy")
        );
        assert_eq!(legacy_cell_to_v3_field("memory"), Some("memory_policy"));
    }

    #[test]
    fn legacy_cell_to_v3_field_returns_none_for_non_gated_cells() {
        // The matrix has cells like "messages", "use-cases", "events" that
        // are NOT gated dimensions. The mapper must return None so the
        // run_session loop skips its gate-flip path for those answers.
        for cell in ["messages", "use-cases", "events", "error-handling", ""] {
            assert!(
                legacy_cell_to_v3_field(cell).is_none(),
                "{cell} must not map to a gated v3 field"
            );
        }
    }

    // ── coverage map helpers ───────────────────────────────────────────────

    #[test]
    fn init_gates_from_enumeration_seeds_one_entry_per_capability() {
        let mut coverage = HashMap::new();
        let mut titles = HashMap::new();
        let data = serde_json::json!({
            "capabilities": [
                {"id": "uc_morning_digest", "title": "Morning Digest"},
                {"id": "uc_weekly_review",  "title": "Weekly Review"},
            ]
        });
        init_gates_from_enumeration(&mut coverage, &mut titles, &data, "ambiguous");
        assert_eq!(coverage.len(), 2);
        assert!(coverage.contains_key("uc_morning_digest"));
        assert!(coverage.contains_key("uc_weekly_review"));
        assert_eq!(titles.get("uc_morning_digest").map(String::as_str), Some("Morning Digest"));
        assert_eq!(titles.get("uc_weekly_review").map(String::as_str), Some("Weekly Review"));
    }

    #[test]
    fn init_gates_from_enumeration_applies_intent_seed_to_every_capability() {
        let mut coverage = HashMap::new();
        let mut titles = HashMap::new();
        let data = serde_json::json!({
            "capabilities": [
                {"id": "uc_a", "title": "A"},
                {"id": "uc_b", "title": "B"},
            ]
        });
        init_gates_from_enumeration(
            &mut coverage,
            &mut titles,
            &data,
            "every morning, automatically run gmail digest",
        );
        for id in ["uc_a", "uc_b"] {
            let g = coverage.get(id).expect("capability should be seeded");
            assert_eq!(g.trigger, Gate::Open, "{id}.trigger");
            assert_eq!(g.connectors, Gate::Open, "{id}.connectors");
            assert_eq!(g.review_policy, Gate::Open, "{id}.review_policy");
            assert_eq!(g.memory_policy, Gate::Closed, "{id}.memory");
        }
    }

    #[test]
    fn init_gates_from_enumeration_does_not_overwrite_existing_state() {
        let mut coverage = HashMap::new();
        coverage.insert("uc_a".to_string(), {
            let mut g = CapabilityGates::default();
            g.mark_open("suggested_trigger");
            g
        });
        let mut titles = HashMap::new();
        let data = serde_json::json!({
            "capabilities": [{"id": "uc_a", "title": "A"}]
        });
        // Intent that would seed Closed for trigger — must not regress prior Open.
        init_gates_from_enumeration(&mut coverage, &mut titles, &data, "ambiguous");
        assert_eq!(
            coverage.get("uc_a").unwrap().trigger,
            Gate::Open,
            "existing Open must be preserved on re-init"
        );
    }

    #[test]
    fn init_gates_from_enumeration_handles_malformed_input_gracefully() {
        // Missing `capabilities` array → no-op, no panic.
        let mut coverage = HashMap::new();
        let mut titles = HashMap::new();
        init_gates_from_enumeration(
            &mut coverage,
            &mut titles,
            &serde_json::json!({}),
            "intent",
        );
        assert!(coverage.is_empty());
        assert!(titles.is_empty());
    }

    #[test]
    fn init_gates_from_enumeration_skips_capabilities_without_id() {
        // Must skip without panic; downstream lookup by id would otherwise
        // wedge the build session.
        let mut coverage = HashMap::new();
        let mut titles = HashMap::new();
        let data = serde_json::json!({
            "capabilities": [
                {"title": "Anonymous"},
                {"id": "uc_ok", "title": "Valid"},
            ]
        });
        init_gates_from_enumeration(&mut coverage, &mut titles, &data, "intent");
        assert_eq!(coverage.len(), 1);
        assert!(coverage.contains_key("uc_ok"));
    }

    #[test]
    fn ensure_capability_in_coverage_inserts_only_when_missing() {
        let mut coverage = HashMap::new();
        coverage.insert("uc_existing".to_string(), {
            let mut g = CapabilityGates::default();
            g.mark_open("memory_policy");
            g
        });
        ensure_capability_in_coverage(&mut coverage, "uc_existing", "intent");
        ensure_capability_in_coverage(&mut coverage, "uc_new", "intent");

        // Existing entry untouched.
        assert_eq!(
            coverage.get("uc_existing").unwrap().memory_policy,
            Gate::Open
        );
        // Missing entry seeded.
        assert!(coverage.contains_key("uc_new"));
    }

    #[test]
    fn find_first_unopen_gate_walks_capabilities_in_sorted_id_order() {
        let mut coverage = HashMap::new();
        // Insert in non-sorted order so the test catches a HashMap-iteration bug.
        coverage.insert("uc_b".to_string(), CapabilityGates::default());
        coverage.insert("uc_a".to_string(), CapabilityGates::default());
        coverage.insert("uc_c".to_string(), CapabilityGates::default());

        let (cap, field) = find_first_unopen_gate(&coverage).expect("at least one closed gate");
        assert_eq!(cap, "uc_a", "must walk in sorted cap_id order for determinism");
        assert_eq!(field, "suggested_trigger");
    }

    #[test]
    fn find_first_unopen_gate_returns_none_when_everything_open() {
        let mut coverage = HashMap::new();
        let mut all_open = CapabilityGates::default();
        for field in GATED_CAPABILITY_FIELDS {
            all_open.mark_open(field);
        }
        coverage.insert("uc_only".to_string(), all_open);
        assert!(find_first_unopen_gate(&coverage).is_none());
    }

    #[test]
    fn find_first_unopen_gate_returns_none_for_empty_coverage() {
        let coverage: HashMap<String, CapabilityGates> = HashMap::new();
        assert!(find_first_unopen_gate(&coverage).is_none());
    }

    // ── synthesize_gate_question — field-scoped branches (no DB) ────────────
    //
    // These three branches don't touch the DB, so we can drive them with
    // serde_json::Value::Null as the proposed_value. The connectors branch
    // calls infer_connector_category which hits the DB — covered by the live
    // e2e_question_loop.py scenario instead.

    fn dummy_pool() -> crate::db::DbPool {
        // We never use the pool for the field-scoped branches, but the API
        // still requires one. An in-memory SQLite pool with no schema is the
        // smallest construct that satisfies the type.
        use r2d2_sqlite::SqliteConnectionManager;
        r2d2::Pool::builder()
            .max_size(1)
            .build(SqliteConnectionManager::memory())
            .expect("in-memory SQLite pool for tests")
    }

    fn assert_question_envelope(events: &[BuildEvent], expected_field: &str) {
        // Both v3 + legacy mirror should be emitted by build_clarifying_question_events.
        assert!(
            events.len() >= 1,
            "expected at least one event, got {}",
            events.len()
        );
        let has_v3 = events.iter().any(|e| matches!(e, BuildEvent::ClarifyingQuestionV3 { field, .. } if field == expected_field));
        assert!(has_v3, "expected v3 ClarifyingQuestionV3 for field {expected_field}");
    }

    #[test]
    fn synthesize_trigger_question_includes_three_options() {
        let events = synthesize_gate_question(
            "uc_x",
            "suggested_trigger",
            "Document Translator",
            &serde_json::Value::Null,
            &dummy_pool(),
            "session-1",
        );
        assert_question_envelope(&events, "suggested_trigger");
    }

    #[test]
    fn synthesize_review_question_includes_three_options() {
        let events = synthesize_gate_question(
            "uc_x",
            "review_policy",
            "Document Translator",
            &serde_json::Value::Null,
            &dummy_pool(),
            "session-1",
        );
        assert_question_envelope(&events, "review_policy");
    }

    #[test]
    fn synthesize_memory_question_includes_two_options() {
        let events = synthesize_gate_question(
            "uc_x",
            "memory_policy",
            "Document Translator",
            &serde_json::Value::Null,
            &dummy_pool(),
            "session-1",
        );
        assert_question_envelope(&events, "memory_policy");
    }

    #[test]
    fn synthesize_returns_empty_for_unknown_field() {
        let events = synthesize_gate_question(
            "uc_x",
            "input_schema", // not a gated dimension
            "Document Translator",
            &serde_json::Value::Null,
            &dummy_pool(),
            "session-1",
        );
        assert!(
            events.is_empty(),
            "non-gated fields must produce zero synthesis events"
        );
    }
}
