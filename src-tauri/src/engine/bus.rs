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

            // Self-scoping: when an event was emitted by a persona (source_type
            // starts with "persona:"), it only matches subscriptions belonging to
            // the SAME persona — unless the subscription has an explicit
            // source_filter that opts into cross-persona events. Without this,
            // two personas with the same event subscriptions (e.g. both subscribe
            // to "stock.signal.strong_buy") would trigger each other's runs.
            if event.source_type.starts_with("persona:") {
                if let Some(filter) = sub.source_filter() {
                    // Subscription has an explicit source_filter → honour it
                    // (allows cross-persona event routing when intentional)
                    if !source_filter_matches(filter, event.source_id.as_deref()) {
                        return false;
                    }
                } else {
                    // No source_filter → default to self-scoping: only the
                    // emitting persona's own subscriptions match.
                    match event.source_id.as_deref() {
                        Some(source_pid) if source_pid != sub.persona_id() => return false,
                        _ => {}
                    }
                }
            } else {
                // Non-persona events (system, webhook, scheduler, etc.): apply
                // source_filter if set, otherwise allow all matching subscriptions.
                if let Some(filter) = sub.source_filter() {
                    if !source_filter_matches(filter, event.source_id.as_deref()) {
                        return false;
                    }
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

/// Phase C4 — collapse `(persona_id, use_case_id)` duplicates within a match
/// set, preferring capability-scoped matches over persona-wide ones for the
/// same persona.
///
/// Rules:
/// 1. Matches with distinct `(persona_id, use_case_id)` pairs are all kept —
///    one persona can still run multiple capability-scoped handlers for the
///    same event (different capabilities handle different aspects).
/// 2. If a persona has **both** a capability-scoped match (`use_case_id = Some`)
///    and a persona-wide match (`use_case_id = None`), the persona-wide match
///    is dropped. Rationale: the author scoped a capability to this event on
///    purpose; firing the persona-wide handler on top would double-dispatch.
/// 3. If the only match for a persona is persona-wide, it is kept.
///
/// Preserves insertion order of survivors so callers still see a stable
/// dispatch sequence.
pub fn prefer_capability_scoped(matches: Vec<EventMatch>) -> Vec<EventMatch> {
    use std::collections::HashSet;

    // First pass: remember which personas have at least one capability-scoped match.
    let mut personas_with_scoped: HashSet<String> = HashSet::new();
    for m in &matches {
        if m.use_case_id.is_some() {
            personas_with_scoped.insert(m.persona_id.clone());
        }
    }

    // Second pass: drop persona-wide matches for personas that have a scoped one,
    // and dedupe on `(persona_id, use_case_id)` so the same capability-scoped
    // subscription doesn't fire twice through the legacy+trigger merge path.
    let mut seen: HashSet<(String, Option<String>)> = HashSet::new();
    let mut out = Vec::with_capacity(matches.len());
    for m in matches {
        if m.use_case_id.is_none() && personas_with_scoped.contains(&m.persona_id) {
            continue;
        }
        let key = (m.persona_id.clone(), m.use_case_id.clone());
        if seen.insert(key) {
            out.push(m);
        }
    }
    out
}

/// Convenience wrapper: match event against `PersonaTrigger` slices directly.
///
/// Parses each trigger's config once, wraps in `ParsedTrigger`, then delegates
/// to the generic `match_event`. Keeps call-sites unchanged.
#[allow(dead_code)]
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
            trigger_version: 0,
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

    // -- Self-scoping tests (persona-emitted events) ---------------------

    fn make_persona_event(event_type: &str, emitting_persona_id: &str) -> PersonaEvent {
        PersonaEvent {
            id: "evt-p".into(),
            project_id: "default".into(),
            event_type: event_type.into(),
            source_type: format!("persona:{}", emitting_persona_id),
            source_id: Some(emitting_persona_id.into()),
            target_persona_id: None,
            payload: None,
            status: PersonaEventStatus::Pending,
            error_message: None,
            processed_at: None,
            created_at: "2026-01-15T10:00:00Z".into(),
            use_case_id: None,
            retry_count: 0,
        }
    }

    #[test]
    fn test_self_scoping_same_persona_matches() {
        let event = make_persona_event("stock.signal.strong_buy", "p1");
        let subs = vec![make_sub("p1", "stock.signal.strong_buy")];
        let matches = match_event(&event, &subs);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].persona_id, "p1");
    }

    #[test]
    fn test_self_scoping_different_persona_blocked() {
        let event = make_persona_event("stock.signal.strong_buy", "p1");
        let subs = vec![
            make_sub("p1", "stock.signal.strong_buy"),
            make_sub("p2", "stock.signal.strong_buy"),
        ];
        let matches = match_event(&event, &subs);
        // Only p1 matches — p2 is blocked by self-scoping
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].persona_id, "p1");
    }

    #[test]
    fn test_self_scoping_explicit_source_filter_allows_cross_persona() {
        let event = make_persona_event("task_completed", "p1");
        let mut sub = make_sub("p2", "task_completed");
        // Explicit source_filter opts into receiving events from p1
        sub.source_filter = Some("p1".into());
        let matches = match_event(&event, &[sub]);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].persona_id, "p2");
    }

    #[test]
    fn test_self_scoping_wildcard_source_filter_allows_cross_persona() {
        let event = make_persona_event("task_completed", "p1");
        let mut sub = make_sub("p2", "task_completed");
        sub.source_filter = Some("p*".into());
        let matches = match_event(&event, &[sub]);
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_non_persona_events_still_broadcast() {
        // System/webhook events (source_type != "persona:*") broadcast to all subscribers
        let event = make_event("webhook_received");
        let subs = vec![
            make_sub("p1", "webhook_received"),
            make_sub("p2", "webhook_received"),
        ];
        let matches = match_event(&event, &subs);
        assert_eq!(matches.len(), 2);
    }

    // -- Phase C4: capability-scoped preference --------------------------

    fn make_match(persona_id: &str, use_case_id: Option<&str>, sub_id: &str) -> EventMatch {
        EventMatch {
            event_id: "evt-1".into(),
            event_type: "file_changed".into(),
            subscription_id: sub_id.into(),
            persona_id: persona_id.into(),
            payload: None,
            source_id: None,
            use_case_id: use_case_id.map(str::to_string),
        }
    }

    #[test]
    fn prefer_scoped_keeps_capability_match_over_persona_wide_for_same_persona() {
        let scoped = make_match("p1", Some("uc_a"), "sub-scoped");
        let wide = make_match("p1", None, "sub-wide");
        let out = prefer_capability_scoped(vec![wide.clone(), scoped.clone()]);
        assert_eq!(out.len(), 1, "persona-wide dropped when a scoped match exists");
        assert_eq!(out[0].subscription_id, "sub-scoped");
        assert_eq!(out[0].use_case_id.as_deref(), Some("uc_a"));
    }

    #[test]
    fn prefer_scoped_keeps_multiple_capabilities_for_same_persona() {
        let a = make_match("p1", Some("uc_a"), "sub-a");
        let b = make_match("p1", Some("uc_b"), "sub-b");
        let out = prefer_capability_scoped(vec![a, b]);
        assert_eq!(out.len(), 2, "different capabilities dispatch independently");
    }

    #[test]
    fn prefer_scoped_keeps_persona_wide_when_no_scoped_exists() {
        let wide = make_match("p1", None, "sub-wide");
        let out = prefer_capability_scoped(vec![wide]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].use_case_id, None);
    }

    #[test]
    fn prefer_scoped_preference_is_per_persona() {
        // p1 has both scoped + wide → wide dropped.
        // p2 has only wide → wide kept.
        let matches = vec![
            make_match("p1", None, "p1-wide"),
            make_match("p1", Some("uc_x"), "p1-scoped"),
            make_match("p2", None, "p2-wide"),
        ];
        let out = prefer_capability_scoped(matches);
        let subs: Vec<&str> = out.iter().map(|m| m.subscription_id.as_str()).collect();
        assert!(subs.contains(&"p1-scoped"));
        assert!(subs.contains(&"p2-wide"));
        assert!(!subs.contains(&"p1-wide"));
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn prefer_scoped_dedupes_same_capability_merged_from_legacy_and_trigger_sources() {
        // Simulates the case where the same capability has both a legacy
        // persona_event_subscription row and a new event_listener trigger;
        // both match the event → merge would double-fire without dedup.
        let m1 = make_match("p1", Some("uc_a"), "legacy-sub");
        let m2 = make_match("p1", Some("uc_a"), "trigger-row");
        let out = prefer_capability_scoped(vec![m1, m2]);
        assert_eq!(out.len(), 1, "same (persona, use_case) dedupes");
        assert_eq!(out[0].subscription_id, "legacy-sub", "first wins (stable order)");
    }

    #[test]
    fn prefer_scoped_preserves_insertion_order() {
        let matches = vec![
            make_match("pZ", Some("uc_1"), "first"),
            make_match("pA", Some("uc_1"), "second"),
        ];
        let out = prefer_capability_scoped(matches);
        assert_eq!(out[0].subscription_id, "first");
        assert_eq!(out[1].subscription_id, "second");
    }
}
