/**
 * UnifiedRoutingView — thin public entry point.
 *
 * Left as a re-export so the one consumer (EventCanvas) keeps its existing
 * import path. The implementation now lives in `./routing/` as a set of
 * small, single-responsibility files. See routing/RoutingView.tsx.
 *
 * THE SUBSCRIPTION-DIRECTION GAP (applies to row derivation in
 * routingHelpers.buildEventRows — kept here because this is where future
 * maintainers land first):
 *
 * `persona_event_subscriptions` rows have NO direction field. Templates
 * write publish-intent events into them with descriptions saying
 * "Emitted when..." (see scripts/templates/.../*.json — the field
 * `suggested_event_subscriptions` is a misnomer; in many templates the
 * listed events are what the persona PUBLISHES). The build session at
 * build_sessions.rs:799 defaults `direction = "subscribe"`, so every
 * templated event is stored as a listener — even ones the persona never
 * receives (e.g. `agent_memory`, a protocol message, not a dispatched
 * event). The runtime at engine/background.rs:655-665 then dispatches
 * subscriptions AS LISTENERS, so these dead-listener rows just sit there.
 *
 * To recover the user's mental model we infer direction per subscription:
 *   • Catalog event_type                                 → listener
 *   • source_id of any recent event matches sub.persona  → emitter
 *   • source_id of any recent event ≠ sub.persona         → listener
 *   • No event history at all                             → emitter
 */
export { RoutingView as UnifiedRoutingView } from './routing';
