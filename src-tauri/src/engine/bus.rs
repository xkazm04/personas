use crate::db::models::{PersonaEvent, PersonaEventSubscription, PersonaTrigger, TriggerConfig};

/// A matched subscription: an event matched to a persona that should execute.
#[derive(Debug, Clone, PartialEq)]
pub struct EventMatch {
    pub event_id: String,
    pub event_type: String,
    pub subscription_id: String,
    pub persona_id: String,
    pub payload: Option<String>,
    pub source_id: Option<String>,
    pub use_case_id: Option<String>,
}

// ---------------------------------------------------------------------------
// MatchableSubscription trait — unifies PersonaEventSubscription & PersonaTrigger
// ---------------------------------------------------------------------------

/// Trait abstracting the fields needed for event matching.
///
/// Implemented by both `PersonaEventSubscription` (legacy) and
/// `PersonaTrigger` (unified event_listener model) so that a single
/// generic `match_event` function handles both.
pub trait MatchableSubscription {
    /// Unique identifier for this subscription/trigger.
    fn subscription_id(&self) -> &str;
    /// The persona that owns this subscription.
    fn persona_id(&self) -> &str;
    /// Optional source wildcard filter (e.g. `"watcher-*"`).
    fn source_filter(&self) -> Option<&str>;
    /// Optional use-case identifier.
    fn use_case_id(&self) -> Option<&str>;
    /// Whether this subscription should be considered for matching.
    /// Returns `false` to skip (e.g. disabled, wrong trigger type).
    fn is_eligible(&self, event: &PersonaEvent) -> bool;
}

impl MatchableSubscription for PersonaEventSubscription {
    fn subscription_id(&self) -> &str {
        &self.id
    }
    fn persona_id(&self) -> &str {
        &self.persona_id
    }
    fn source_filter(&self) -> Option<&str> {
        self.source_filter.as_deref()
    }
    fn use_case_id(&self) -> Option<&str> {
        self.use_case_id.as_deref()
    }
    fn is_eligible(&self, event: &PersonaEvent) -> bool {
        self.enabled && self.event_type == event.event_type
    }
}

/// Wrapper that pairs a `PersonaTrigger` with its parsed `TriggerConfig`.
///
/// `PersonaTrigger::parse_config()` is not free — call it once per trigger
/// and wrap with this struct before passing into `match_event`.
pub struct ParsedTrigger<'a> {
    pub trigger: &'a PersonaTrigger,
    pub config: TriggerConfig,
}

impl<'a> ParsedTrigger<'a> {
    pub fn new(trigger: &'a PersonaTrigger) -> Self {
        Self {
            config: trigger.parse_config(),
            trigger,
        }
    }
}

impl MatchableSubscription for ParsedTrigger<'_> {
    fn subscription_id(&self) -> &str {
        &self.trigger.id
    }
    fn persona_id(&self) -> &str {
        &self.trigger.persona_id
    }
    fn source_filter(&self) -> Option<&str> {
        match &self.config {
            TriggerConfig::EventListener { source_filter, .. } => source_filter.as_deref(),
            _ => None,
        }
    }
    fn use_case_id(&self) -> Option<&str> {
        self.trigger.use_case_id.as_deref()
    }
    fn is_eligible(&self, _event: &PersonaEvent) -> bool {
        // Event-type filtering is done at the SQL layer for triggers;
        // we only need to confirm this is actually an EventListener config.
        matches!(&self.config, TriggerConfig::EventListener { .. })
    }
}

// ---------------------------------------------------------------------------
// Unified match_event
// ---------------------------------------------------------------------------

/// Match a single event against a list of matchable subscriptions.
///
/// Rules (applied uniformly for both legacy subscriptions and triggers):
/// 1. `is_eligible()` must return true (covers enabled check + event_type match)
/// 2. If `event.target_persona_id` is set, only that persona's subscriptions match
/// 3. If `source_filter()` is set, `event.source_id` must match (exact or wildcard)
pub fn match_event<T: MatchableSubscription>(
    event: &PersonaEvent,
    subscriptions: &[T],
) -> Vec<EventMatch> {
    subscriptions
        .iter()
        .filter(|sub| {
            if !sub.is_eligible(event) {
                return false;
            }

            // If event targets a specific persona, only that persona matches
            if let Some(ref target) = event.target_persona_id {
                if target != sub.persona_id() {
                    return false;
                }
            }

            // If subscription has a source filter, it must match
            if let Some(filter) = sub.source_filter() {
                if !source_filter_matches(filter, event.source_id.as_deref()) {
                    return false;
                }
            }

            true
        })
        .map(|sub| EventMatch {
            event_id: event.id.clone(),
            event_type: event.event_type.clone(),
            subscription_id: sub.subscription_id().to_string(),
            persona_id: sub.persona_id().to_string(),
            payload: event.payload.clone(),
            source_id: event.source_id.clone(),
            use_case_id: sub.use_case_id().map(String::from),
        })
        .collect()
}

/// Convenience wrapper: match event against `PersonaTrigger` slices directly.
///
/// Parses each trigger's config once, wraps in `ParsedTrigger`, then delegates
/// to the generic `match_event`. Keeps call-sites unchanged.
pub fn match_event_listeners(
    event: &PersonaEvent,
    listeners: &[PersonaTrigger],
) -> Vec<EventMatch> {
    let parsed: Vec<ParsedTrigger<'_>> = listeners.iter().map(ParsedTrigger::new).collect();
    match_event(event, &parsed)
}

/// Simple matching: exact match or prefix wildcard (trailing `*`).
fn source_filter_matches(filter: &str, source_id: Option<&str>) -> bool {
    let source = match source_id {
        Some(s) => s,
        None => return false, // No source_id can't match a filter
    };

    if let Some(prefix) = filter.strip_suffix('*') {
        source.starts_with(prefix)
    } else {
        source == filter
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::PersonaEventStatus;

    fn make_event(event_type: &str) -> PersonaEvent {
        PersonaEvent {
            id: "evt-1".into(),
            project_id: "default".into(),
            event_type: event_type.into(),
            source_type: "test".into(),
            source_id: None,
            target_persona_id: None,
            payload: Some(r#"{"key":"value"}"#.into()),
            status: PersonaEventStatus::Pending,
            error_message: None,
            processed_at: None,
            created_at: "2026-01-15T10:00:00Z".into(),
            use_case_id: None,
            retry_count: 0,
        }
    }

    fn make_sub(persona_id: &str, event_type: &str) -> PersonaEventSubscription {
        PersonaEventSubscription {
            id: format!("sub-{persona_id}"),
            persona_id: persona_id.into(),
            event_type: event_type.into(),
            source_filter: None,
            enabled: true,
            created_at: "2026-01-15T10:00:00Z".into(),
            updated_at: "2026-01-15T10:00:00Z".into(),
            use_case_id: None,
        }
    }

    #[test]
    fn test_match_by_event_type() {
        let event = make_event("file_changed");
        let subs = vec![make_sub("p1", "file_changed")];
        let matches = match_event(&event, &subs);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].persona_id, "p1");
        assert_eq!(matches[0].event_id, "evt-1");
    }

    #[test]
    fn test_no_match_different_type() {
        let event = make_event("file_changed");
        let subs = vec![make_sub("p1", "build_complete")];
        let matches = match_event(&event, &subs);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_match_with_source_filter_exact() {
        let mut event = make_event("webhook_received");
        event.source_id = Some("watcher-1".into());
        let mut sub = make_sub("p1", "webhook_received");
        sub.source_filter = Some("watcher-1".into());
        let matches = match_event(&event, &[sub]);
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_no_match_source_filter_mismatch() {
        let mut event = make_event("webhook_received");
        event.source_id = Some("watcher-2".into());
        let mut sub = make_sub("p1", "webhook_received");
        sub.source_filter = Some("watcher-1".into());
        let matches = match_event(&event, &[sub]);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_match_source_filter_wildcard() {
        let mut event = make_event("webhook_received");
        event.source_id = Some("watcher-42".into());
        let mut sub = make_sub("p1", "webhook_received");
        sub.source_filter = Some("watcher-*".into());
        let matches = match_event(&event, &[sub]);
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_match_with_target_persona() {
        let mut event = make_event("file_changed");
        event.target_persona_id = Some("p2".into());
        let subs = vec![make_sub("p1", "file_changed"), make_sub("p2", "file_changed")];
        let matches = match_event(&event, &subs);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].persona_id, "p2");
    }

    #[test]
    fn test_disabled_subscription_skipped() {
        let event = make_event("file_changed");
        let mut sub = make_sub("p1", "file_changed");
        sub.enabled = false;
        let matches = match_event(&event, &[sub]);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_multiple_subscriptions_match() {
        let event = make_event("file_changed");
        let subs = vec![
            make_sub("p1", "file_changed"),
            make_sub("p2", "file_changed"),
            make_sub("p3", "build_complete"),
        ];
        let matches = match_event(&event, &subs);
        assert_eq!(matches.len(), 2);
    }

    // -- Event listener trigger tests ---------------------------------

    fn make_listener(persona_id: &str, listen_event_type: &str, source_filter: Option<&str>) -> PersonaTrigger {
        let config = serde_json::json!({
            "listen_event_type": listen_event_type,
            "source_filter": source_filter,
        });
        PersonaTrigger {
            id: format!("trig-{persona_id}"),
            persona_id: persona_id.into(),
            trigger_type: "event_listener".into(),
            config: Some(serde_json::to_string(&config).unwrap()),
            enabled: true,
            status: "active".into(),
            last_triggered_at: None,
            next_trigger_at: None,
            created_at: "2026-01-15T10:00:00Z".into(),
            updated_at: "2026-01-15T10:00:00Z".into(),
            use_case_id: None,
        }
    }

    #[test]
    fn test_event_listener_match() {
        let event = make_event("file_changed");
        let listeners = vec![make_listener("p1", "file_changed", None)];
        let matches = match_event_listeners(&event, &listeners);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].persona_id, "p1");
    }

    #[test]
    fn test_event_listener_source_filter_wildcard() {
        let mut event = make_event("deploy");
        event.source_id = Some("prod-us-east".into());
        let listeners = vec![make_listener("p1", "deploy", Some("prod-*"))];
        let matches = match_event_listeners(&event, &listeners);
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_event_listener_source_filter_mismatch() {
        let mut event = make_event("deploy");
        event.source_id = Some("staging-1".into());
        let listeners = vec![make_listener("p1", "deploy", Some("prod-*"))];
        let matches = match_event_listeners(&event, &listeners);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_event_listener_target_persona_filter() {
        let mut event = make_event("file_changed");
        event.target_persona_id = Some("p2".into());
        let listeners = vec![
            make_listener("p1", "file_changed", None),
            make_listener("p2", "file_changed", None),
        ];
        let matches = match_event_listeners(&event, &listeners);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].persona_id, "p2");
    }
}
