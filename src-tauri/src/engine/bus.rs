use crate::db::models::{PersonaEvent, PersonaEventSubscription};

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

/// Match a single event against a list of subscriptions.
///
/// Rules:
/// 1. subscription.event_type must equal event.event_type
/// 2. If subscription.source_filter is set, event.source_id must match (exact or wildcard)
/// 3. If event.target_persona_id is set, only that persona's subscriptions match
/// 4. subscription.enabled must be true
pub fn match_event(
    event: &PersonaEvent,
    subscriptions: &[PersonaEventSubscription],
) -> Vec<EventMatch> {
    subscriptions
        .iter()
        .filter(|sub| {
            // Must be enabled
            if !sub.enabled {
                return false;
            }

            // Must match event type
            if sub.event_type != event.event_type {
                return false;
            }

            // If event targets a specific persona, only that persona matches
            if let Some(ref target) = event.target_persona_id {
                if target != &sub.persona_id {
                    return false;
                }
            }

            // If subscription has a source filter, it must match
            if let Some(ref filter) = sub.source_filter {
                if !source_filter_matches(filter, event.source_id.as_deref()) {
                    return false;
                }
            }

            true
        })
        .map(|sub| EventMatch {
            event_id: event.id.clone(),
            event_type: event.event_type.clone(),
            subscription_id: sub.id.clone(),
            persona_id: sub.persona_id.clone(),
            payload: event.payload.clone(),
            source_id: event.source_id.clone(),
            use_case_id: sub.use_case_id.clone(),
        })
        .collect()
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

    fn make_event(event_type: &str) -> PersonaEvent {
        PersonaEvent {
            id: "evt-1".into(),
            project_id: "default".into(),
            event_type: event_type.into(),
            source_type: "test".into(),
            source_id: None,
            target_persona_id: None,
            payload: Some(r#"{"key":"value"}"#.into()),
            status: "pending".into(),
            error_message: None,
            processed_at: None,
            created_at: "2026-01-15T10:00:00Z".into(),
            use_case_id: None,
        }
    }

    fn make_sub(persona_id: &str, event_type: &str) -> PersonaEventSubscription {
        PersonaEventSubscription {
            id: format!("sub-{}", persona_id),
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
}
