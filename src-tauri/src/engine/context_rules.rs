//! Context Rule Engine: pattern-based subscriptions for ambient context signals.
//!
//! Personas define context rules that match against the real-time context stream.
//! When a rule matches, it can trigger an execution, emit an event, or log the
//! match. This gives personas the ability to proactively respond to desktop
//! activity without explicit triggers.
//!
//! # Architecture
//!
//! ```text
//! ContextStream (broadcast) ─┬─► ContextRuleEngine
//!                             │     ├─ evaluates rules against each event
//!                             │     ├─ enforces cooldowns to prevent spam
//!                             │     └─ publishes persona_events for matches
//!                             └─► other subscribers
//! ```

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

use super::ambient_context::{AmbientContextHandle, ContextEvent, ContextStreamReceiver};

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

/// A pattern that a context rule matches against incoming context events.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContextPattern {
    /// Match events from these sources (empty = match all sources).
    /// Valid values: "clipboard", "file_watcher", "app_focus".
    pub sources: Vec<String>,
    /// Substring match against the event summary (empty = match any summary).
    /// Case-insensitive.
    pub summary_contains: String,
    /// Glob pattern to match against file paths (only for file_watcher events).
    /// Empty = match all file events.
    pub path_glob: String,
    /// Match only when the specified app is focused (empty = any app).
    /// Case-insensitive substring match against app_name.
    pub app_filter: String,
}

impl Default for ContextPattern {
    fn default() -> Self {
        Self {
            sources: Vec::new(),
            summary_contains: String::new(),
            path_glob: String::new(),
            app_filter: String::new(),
        }
    }
}

/// What happens when a context rule matches.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ContextAction {
    /// Publish a persona event that triggers an execution.
    TriggerExecution,
    /// Emit a Tauri event to the frontend (for UI notifications).
    EmitEvent,
    /// Log the match (useful for debugging rule patterns).
    Log,
}

/// A context rule: when a pattern matches, perform an action.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContextRule {
    /// Unique rule identifier.
    pub id: String,
    /// The persona that owns this rule.
    pub persona_id: String,
    /// Human-readable rule name.
    pub name: String,
    /// The pattern to match against context events.
    pub pattern: ContextPattern,
    /// The action to perform when the pattern matches.
    pub action: ContextAction,
    /// Whether this rule is currently active.
    pub enabled: bool,
    /// Minimum seconds between consecutive matches (prevents spam).
    pub cooldown_secs: u32,
}

/// Summary of a rule match (returned to frontend for display).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContextRuleMatch {
    /// The rule that matched.
    pub rule_id: String,
    /// The persona that owns the rule.
    pub persona_id: String,
    /// The rule name.
    pub rule_name: String,
    /// The event that triggered the match.
    pub event_summary: String,
    /// Unix timestamp of the match.
    pub matched_at: u64,
}

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

/// The context rule engine: manages rules and evaluates them against incoming
/// context events from the broadcast stream.
pub struct ContextRuleEngine {
    /// All registered context rules, keyed by rule ID.
    rules: HashMap<String, ContextRule>,
    /// Last match time per rule, for cooldown enforcement.
    last_match: HashMap<String, Instant>,
    /// Recent match log (bounded to last 50 matches).
    recent_matches: Vec<ContextRuleMatch>,
    /// Total matches since engine start.
    total_matches: u64,
}

impl ContextRuleEngine {
    pub fn new() -> Self {
        Self {
            rules: HashMap::new(),
            last_match: HashMap::new(),
            recent_matches: Vec::new(),
            total_matches: 0,
        }
    }

    /// Add or update a context rule.
    pub fn add_rule(&mut self, rule: ContextRule) {
        self.rules.insert(rule.id.clone(), rule);
    }

    /// Remove a context rule by ID.
    pub fn remove_rule(&mut self, rule_id: &str) -> bool {
        self.last_match.remove(rule_id);
        self.rules.remove(rule_id).is_some()
    }

    /// List all rules for a specific persona.
    pub fn list_rules(&self, persona_id: &str) -> Vec<ContextRule> {
        self.rules
            .values()
            .filter(|r| r.persona_id == persona_id)
            .cloned()
            .collect()
    }

    /// List all registered rules.
    pub fn all_rules(&self) -> Vec<ContextRule> {
        self.rules.values().cloned().collect()
    }

    /// Get recent match history.
    pub fn recent_matches(&self) -> &[ContextRuleMatch] {
        &self.recent_matches
    }

    /// Total match count since engine start.
    pub fn total_matches(&self) -> u64 {
        self.total_matches
    }

    /// Evaluate all enabled rules against a context event.
    /// Returns a list of matches (rule ID + match info).
    pub fn evaluate(&mut self, event: &ContextEvent) -> Vec<ContextRuleMatch> {
        let now = Instant::now();
        let ts = event.timestamp;
        let mut matches = Vec::new();

        for rule in self.rules.values() {
            if !rule.enabled {
                continue;
            }

            // Cooldown check
            if let Some(last) = self.last_match.get(&rule.id) {
                if now.duration_since(*last).as_secs() < rule.cooldown_secs as u64 {
                    continue;
                }
            }

            if !Self::pattern_matches(&rule.pattern, event) {
                continue;
            }

            // Match found
            let m = ContextRuleMatch {
                rule_id: rule.id.clone(),
                persona_id: rule.persona_id.clone(),
                rule_name: rule.name.clone(),
                event_summary: event.summary.clone(),
                matched_at: ts,
            };
            self.last_match.insert(rule.id.clone(), now);
            matches.push(m);
        }

        // Record matches
        for m in &matches {
            self.total_matches += 1;
            self.recent_matches.push(m.clone());
        }

        // Trim recent matches to last 50
        if self.recent_matches.len() > 50 {
            let excess = self.recent_matches.len() - 50;
            self.recent_matches.drain(..excess);
        }

        matches
    }

    /// Check if a pattern matches a context event.
    fn pattern_matches(pattern: &ContextPattern, event: &ContextEvent) -> bool {
        // Source filter
        if !pattern.sources.is_empty()
            && !pattern
                .sources
                .iter()
                .any(|s| s.eq_ignore_ascii_case(&event.source))
        {
            return false;
        }

        // Summary contains (case-insensitive)
        if !pattern.summary_contains.is_empty() {
            let summary_lower = event.summary.to_lowercase();
            if !summary_lower.contains(&pattern.summary_contains.to_lowercase()) {
                return false;
            }
        }

        // Path glob filter (for file_watcher events)
        if !pattern.path_glob.is_empty() && event.source == "file_watcher" {
            if event.paths.is_empty() {
                return false;
            }
            let opts = glob::MatchOptions {
                case_sensitive: false,
                ..Default::default()
            };
            let any_match = event.paths.iter().any(|path| {
                let normalised = path.replace('\\', "/");
                glob::Pattern::new(&pattern.path_glob)
                    .map(|p| p.matches_with(&normalised, opts))
                    .unwrap_or(false)
            });
            if !any_match {
                return false;
            }
        }

        // App filter (for app_focus events or checking active app)
        if !pattern.app_filter.is_empty() {
            if let Some(ref app) = event.app_name {
                if !app
                    .to_lowercase()
                    .contains(&pattern.app_filter.to_lowercase())
                {
                    return false;
                }
            } else {
                // No app info and filter requires one — skip non-app_focus events
                // unless the pattern explicitly allows them via empty sources
                if event.source != "app_focus" {
                    // App filter only blocks app_focus events; other sources pass through
                }
            }
        }

        true
    }
}

/// Shared handle to the context rule engine.
pub type ContextRuleEngineHandle = Arc<Mutex<ContextRuleEngine>>;

/// Create a new context rule engine handle.
pub fn create_context_rule_engine() -> ContextRuleEngineHandle {
    Arc::new(Mutex::new(ContextRuleEngine::new()))
}

// ---------------------------------------------------------------------------
// Context rule subscription tick
// ---------------------------------------------------------------------------

/// Drains incoming context events from the broadcast receiver and evaluates
/// all registered rules. Matched rules publish persona events and/or emit
/// Tauri events to the frontend.
pub async fn context_rule_tick(
    rule_engine: &ContextRuleEngineHandle,
    rx: &Arc<Mutex<ContextStreamReceiver>>,
    pool: &crate::db::DbPool,
    app: &tauri::AppHandle,
) {
    use tauri::Emitter;

    // Drain all available events from the broadcast receiver
    let mut events = Vec::new();
    {
        let mut receiver = rx.lock().await;
        loop {
            match receiver.try_recv() {
                Ok(event) => events.push(event),
                Err(tokio::sync::broadcast::error::TryRecvError::Empty) => break,
                Err(tokio::sync::broadcast::error::TryRecvError::Lagged(n)) => {
                    tracing::warn!(
                        lagged = n,
                        "Context rule subscriber lagged — {} events dropped",
                        n
                    );
                    break;
                }
                Err(tokio::sync::broadcast::error::TryRecvError::Closed) => break,
            }
        }
    }

    if events.is_empty() {
        return;
    }

    // Evaluate rules against each event
    let mut engine = rule_engine.lock().await;
    for event in &events {
        let matches = engine.evaluate(event);
        for m in matches {
            // Look up the full rule to determine the action
            let action = engine
                .rules
                .get(&m.rule_id)
                .map(|r| r.action.clone())
                .unwrap_or(ContextAction::Log);

            match action {
                ContextAction::TriggerExecution => {
                    // Publish a persona event so the event bus picks it up
                    let input = crate::db::models::CreatePersonaEventInput {
                        event_type: "context_rule_match".to_string(),
                        source_type: "context_rule".to_string(),
                        project_id: None,
                        source_id: Some(m.rule_id.clone()),
                        target_persona_id: Some(m.persona_id.clone()),
                        payload: serde_json::to_string(&m).ok(),
                        use_case_id: None,
                    };
                    if let Err(e) =
                        crate::db::repos::communication::events::publish(pool, &input)
                    {
                        tracing::error!(
                            rule_id = %m.rule_id,
                            "Failed to publish context rule event: {}",
                            e
                        );
                    }
                    tracing::info!(
                        rule = %m.rule_name,
                        persona = %m.persona_id,
                        event = %m.event_summary,
                        "Context rule triggered execution"
                    );
                }
                ContextAction::EmitEvent => {
                    let _ = app.emit("context-rule-match", &m);
                    tracing::debug!(
                        rule = %m.rule_name,
                        "Context rule emitted frontend event"
                    );
                }
                ContextAction::Log => {
                    tracing::info!(
                        rule = %m.rule_name,
                        persona = %m.persona_id,
                        event = %m.event_summary,
                        "Context rule matched (log action)"
                    );
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(source: &str, summary: &str) -> ContextEvent {
        ContextEvent {
            source: source.to_string(),
            summary: summary.to_string(),
            timestamp: 1000,
            paths: Vec::new(),
            app_name: None,
            window_title: None,
        }
    }

    fn make_rule(id: &str, persona_id: &str, pattern: ContextPattern) -> ContextRule {
        ContextRule {
            id: id.to_string(),
            persona_id: persona_id.to_string(),
            name: format!("Rule {id}"),
            pattern,
            action: ContextAction::Log,
            enabled: true,
            cooldown_secs: 0,
        }
    }

    #[test]
    fn test_basic_match() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(make_rule(
            "r1",
            "p1",
            ContextPattern {
                sources: vec!["clipboard".to_string()],
                ..Default::default()
            },
        ));

        let event = make_event("clipboard", "Clipboard: text (42 chars)");
        let matches = engine.evaluate(&event);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].rule_id, "r1");
    }

    #[test]
    fn test_source_filter_miss() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(make_rule(
            "r1",
            "p1",
            ContextPattern {
                sources: vec!["clipboard".to_string()],
                ..Default::default()
            },
        ));

        let event = make_event("app_focus", "Focused: Code.exe");
        let matches = engine.evaluate(&event);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_summary_contains() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(make_rule(
            "r1",
            "p1",
            ContextPattern {
                summary_contains: "Code.exe".to_string(),
                ..Default::default()
            },
        ));

        let event = make_event("app_focus", "Focused: Code.exe — main.rs");
        let matches = engine.evaluate(&event);
        assert_eq!(matches.len(), 1);

        let event2 = make_event("app_focus", "Focused: chrome.exe");
        let matches2 = engine.evaluate(&event2);
        assert!(matches2.is_empty());
    }

    #[test]
    fn test_path_glob() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(make_rule(
            "r1",
            "p1",
            ContextPattern {
                sources: vec!["file_watcher".to_string()],
                path_glob: "*.rs".to_string(),
                ..Default::default()
            },
        ));

        let mut event = make_event("file_watcher", "File modify: main.rs");
        event.paths = vec!["main.rs".to_string()];
        let matches = engine.evaluate(&event);
        assert_eq!(matches.len(), 1);

        let mut event2 = make_event("file_watcher", "File modify: app.tsx");
        event2.paths = vec!["app.tsx".to_string()];
        let matches2 = engine.evaluate(&event2);
        assert!(matches2.is_empty());
    }

    #[test]
    fn test_cooldown() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(ContextRule {
            cooldown_secs: 300, // 5 minutes
            ..make_rule(
                "r1",
                "p1",
                ContextPattern {
                    sources: vec!["clipboard".to_string()],
                    ..Default::default()
                },
            )
        });

        let event = make_event("clipboard", "Clipboard: text (42 chars)");

        // First match should succeed
        let matches = engine.evaluate(&event);
        assert_eq!(matches.len(), 1);

        // Second match should be blocked by cooldown
        let matches2 = engine.evaluate(&event);
        assert!(matches2.is_empty());
    }

    #[test]
    fn test_disabled_rule() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(ContextRule {
            enabled: false,
            ..make_rule(
                "r1",
                "p1",
                ContextPattern {
                    sources: vec!["clipboard".to_string()],
                    ..Default::default()
                },
            )
        });

        let event = make_event("clipboard", "Clipboard: text (42 chars)");
        let matches = engine.evaluate(&event);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_list_rules() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(make_rule("r1", "p1", Default::default()));
        engine.add_rule(make_rule("r2", "p1", Default::default()));
        engine.add_rule(make_rule("r3", "p2", Default::default()));

        let p1_rules = engine.list_rules("p1");
        assert_eq!(p1_rules.len(), 2);

        let p2_rules = engine.list_rules("p2");
        assert_eq!(p2_rules.len(), 1);
    }

    #[test]
    fn test_remove_rule() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(make_rule("r1", "p1", Default::default()));
        assert!(engine.remove_rule("r1"));
        assert!(!engine.remove_rule("r1")); // already removed
        assert!(engine.all_rules().is_empty());
    }

    #[test]
    fn test_recent_matches_bounded() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(make_rule(
            "r1",
            "p1",
            ContextPattern {
                sources: vec!["clipboard".to_string()],
                ..Default::default()
            },
        ));

        // Push 60 events to exceed the 50-match buffer
        for i in 0..60 {
            let event = make_event("clipboard", &format!("Clip {i}"));
            engine.evaluate(&event);
        }

        assert_eq!(engine.recent_matches().len(), 50);
        assert_eq!(engine.total_matches(), 60);
    }

    #[test]
    fn test_wildcard_sources_match_all() {
        let mut engine = ContextRuleEngine::new();
        engine.add_rule(make_rule(
            "r1",
            "p1",
            ContextPattern {
                sources: Vec::new(), // empty = match all
                ..Default::default()
            },
        ));

        for source in &["clipboard", "file_watcher", "app_focus"] {
            let event = make_event(source, "test");
            let matches = engine.evaluate(&event);
            assert_eq!(matches.len(), 1, "Should match source: {}", source);
        }
    }
}
