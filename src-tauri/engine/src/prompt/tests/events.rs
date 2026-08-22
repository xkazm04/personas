use super::super::*;
use super::test_persona;

// ==============================================================
// Event routing tests (S1 + S2 from docs/design/event-routing-proposal.md)
//
// These tests lock in the contract that a persona's prompt can see
// the firing event_type and route on it via structured_prompt.eventHandlers.
// ==============================================================

/// Baseline: a plain payload (no `_event` wrapper) still works and still
/// does NOT show a Triggering Event section. Ensures backwards compatibility
/// — legacy dispatch callers that pass raw payloads continue to work.
#[test]
fn test_baseline_legacy_payload_no_event_section() {
    let persona = test_persona();
    let legacy_input = serde_json::json!({ "ticker": "AAPL", "price": 192.50 });
    let prompt = assemble_prompt(
        &persona,
        &[],
        Some(&legacy_input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(!prompt.contains("## Triggering Event"));
    // Legacy path must still render the persona identity.
    assert!(prompt.contains("# Persona: Test Agent"));
}

/// S1 contract: when `_event` metadata is in input_data, the prompt shows
/// a `## Triggering Event` section with the event_type, source_type, and
/// source_id. This is what teaches the persona which event fired it.
#[test]
fn test_s1_event_metadata_renders_triggering_event_section() {
    let persona = test_persona();
    let event_input = serde_json::json!({
        "_event": {
            "event_type": "stock.signal.strong_buy",
            "source_type": "persona:Financial_Signaller",
            "source_id": "persona-financial-123",
            "source_persona_id": "persona-financial-123",
        },
        "payload": { "ticker": "AAPL", "price": 192.50, "signal_strength": 0.87 }
    });
    let prompt = assemble_prompt(
        &persona,
        &[],
        Some(&event_input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(
        prompt.contains("## Triggering Event"),
        "prompt missing Triggering Event header: {prompt}"
    );
    assert!(
        prompt.contains("stock.signal.strong_buy"),
        "prompt missing event_type literal: {prompt}"
    );
    assert!(
        prompt.contains("persona-financial-123"),
        "prompt missing source persona id: {prompt}"
    );
}

/// S2 contract: when structured_prompt.eventHandlers exists and the firing
/// event has a matching key, the handler text appears in a `## Event Handlers`
/// section with a "Currently firing" callout for the active handler.
#[test]
fn test_s2_event_handlers_section_highlights_firing_handler() {
    let mut persona = test_persona();
    persona.structured_prompt = Some(
        serde_json::json!({
            "identity": "I am a stock alert bot.",
            "instructions": "React to market signals.",
            "eventHandlers": {
                "stock.signal.strong_buy": "Compose an email alert with ticker and price.",
                "stock.signal.sell": "Compose a sell alert and archive the position.",
                "_default": "Log the event and request manual review."
            }
        })
        .to_string(),
    );

    let input = serde_json::json!({
        "_event": { "event_type": "stock.signal.strong_buy", "source_id": "p1" },
        "payload": { "ticker": "AAPL" }
    });
    let prompt = assemble_prompt(
        &persona,
        &[],
        Some(&input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## Event Handlers"));
    assert!(prompt.contains("Currently firing"));
    assert!(prompt.contains("stock.signal.strong_buy"));
    assert!(prompt.contains("Compose an email alert with ticker and price."));
    // Full list of handlers is still present so the persona sees its full repertoire.
    assert!(prompt.contains("stock.signal.sell"));
    assert!(prompt.contains("Compose a sell alert and archive the position."));
    // `_default` never appears as a normal list entry.
    assert!(!prompt.contains("- **`_default`**"));
}

/// S2 contract: when the firing event has NO matching handler key but a
/// `_default` key exists, the default handler text is highlighted instead.
#[test]
fn test_s2_event_handlers_falls_back_to_default() {
    let mut persona = test_persona();
    persona.structured_prompt = Some(
        serde_json::json!({
            "identity": "Generic handler.",
            "instructions": "Handle events.",
            "eventHandlers": {
                "known.event": "Known handler.",
                "_default": "Unknown event — log and review."
            }
        })
        .to_string(),
    );

    let input = serde_json::json!({
        "_event": { "event_type": "some.unknown.event" },
        "payload": {}
    });
    let prompt = assemble_prompt(
        &persona,
        &[],
        Some(&input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## Event Handlers"));
    assert!(prompt.contains("some.unknown.event"));
    assert!(prompt.contains("Unknown event — log and review."));
}

/// S2 contract: when there are no eventHandlers in the structured_prompt,
/// the section is omitted entirely. Personas built before this feature
/// keep working exactly as before.
#[test]
fn test_s2_no_event_handlers_section_when_absent() {
    let mut persona = test_persona();
    persona.structured_prompt = Some(
        serde_json::json!({
            "identity": "Legacy persona.",
            "instructions": "Do things."
        })
        .to_string(),
    );

    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(!prompt.contains("## Event Handlers"));
}

/// S2 contract: when eventHandlers exists but no event is currently firing
/// (e.g. manual invocation), the full list is rendered WITHOUT the
/// "Currently firing" callout so the persona knows its repertoire.
#[test]
fn test_s2_event_handlers_list_without_firing_event() {
    let mut persona = test_persona();
    persona.structured_prompt = Some(
        serde_json::json!({
            "identity": "Multi-event persona.",
            "instructions": "Do things.",
            "eventHandlers": {
                "event.one": "Handle one.",
                "event.two": "Handle two."
            }
        })
        .to_string(),
    );

    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## Event Handlers"));
    assert!(!prompt.contains("Currently firing"));
    assert!(prompt.contains("event.one"));
    assert!(prompt.contains("Handle one."));
    assert!(prompt.contains("event.two"));
    assert!(prompt.contains("Handle two."));
}
