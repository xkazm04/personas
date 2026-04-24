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
