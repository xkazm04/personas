# Bug Hunter — Triggers & Event Registry

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: triggers-event-registry | Group: Triggers & Events

## 1. Live-stream status updates are silently dropped — events freeze on their first-seen status
- **Severity**: High
- **Category**: Silent failure / Event registry desync
- **File**: `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:76` (with `src-tauri/src/db/cdc.rs:252`)
- **Scenario**: An event is published (INSERT → `pending`), the bus claims it (`processing`), then marks it `delivered`/`failed`/`dead_letter` via `update_status`. The user watches the Live Stream expecting the row's status chip to advance.
- **Root cause**: CDC only fetches and emits the *full* `PersonaEvent` row on `CdcAction::Insert` (`cdc.rs:252`). Every subsequent **UPDATE** (status transitions) falls through to the lightweight `CdcNotification { action, table, rowid }` branch (`cdc.rs:281-293`), emitted on the **same `event-bus` channel**. The LiveStreamTab listener guards with `if (!evt?.id || !evt?.event_type) return;` (line 76) and discards the notification — but that notification was the *only* signal that the row changed. The in-place replace path at lines 115-119 (`eventIdIndex.current.has(e.id)`) therefore never runs for real status changes.
- **Impact**: The "live" stream is success theater: rows are stuck at `pending`/`processing` forever, the status-filter dropdown is unreliable, and the `getRowAccent` color never reflects failures. The code comments in `commands/communication/events.rs:207,324` ("CDC auto-emits on persona_events UPDATE") are actively misleading — UPDATEs emit only a rowid the frontend cannot consume.
- **Fix sketch**: In `cdc.rs`, fetch + emit the full `PersonaEvent` for `persona_events` on **both** Insert and Update (drop the `== Insert` condition), or emit status updates on a distinct channel the UI handles. Backfilling the full row on UPDATE makes the existing replace-in-place branch (LiveStreamTab:115) work as intended.

## 2. No cycle/depth guard on event-driven trigger chains — a self-emitting persona is an unbounded event amplifier
- **Severity**: Critical
- **Category**: Edge case / Latent failure (cyclic trigger, unbounded growth)
- **File**: `src-tauri/src/engine/background.rs:799` (`event_bus_tick`), `src-tauri/src/engine/bus.rs:147` (`match_event`)
- **Scenario**: Persona A subscribes to `task.done` and, when it runs, its execution emits `task.done` (or a chain: A emits X → B subscribes to X and emits Y → A subscribes to Y). Self-scoping (`bus.rs:171-185`) blocks A from matching *its own* event only when there is no `source_filter`; the moment a wildcard/explicit `source_filter` or a second persona is involved, the cycle is live.
- **Root cause**: `event_bus_tick` matches → dispatches → the dispatched execution publishes new events → next tick re-claims them. There is **no per-event chain-depth counter, visited-set, or cycle breaker** anywhere in the claim/match/dispatch path. `chain_cascades_total` (background.rs:101) only *counts* hops for metrics; it never caps them. The cross-team bleed guard (`bus.rs:222`) suppresses *team-boundary* fan-out but does nothing for a same-team or single-persona loop.
- **Impact**: A misconfigured (or LLM-authored) recipe creates a runaway loop that publishes events every 2s tick, spawns executions burning tokens/CPU, and grows `persona_events` without bound until rate-limiting (`event_source_max`, events.rs:66) or the DLQ incidentally throttles it. Self-inflicted DoS; the only backstop is the per-source rate limiter, which is a blunt instrument and per-`source_type`, not per-chain.
- **Fix sketch**: Thread a `chain_depth` / `root_event_id` through the payload (the trace infra already carries `chain_trace_id`), reject dispatch past a max depth, and dead-letter the event with a "chain depth exceeded" reason. Optionally detect `(persona_id, event_type)` re-entry within one chain.

## 3. "No subscribers" is recorded as `Delivered`, not `Skipped` — masking dead/misrouted triggers
- **Severity**: Medium
- **Category**: Silent failure / Success theater
- **File**: `src-tauri/src/engine/background.rs:896-905`
- **Scenario**: A persona's trigger subscribes to `code-review.completed`, but events are emitted as `code_review.done` (different *words*, not just separators — canonicalization in `bus.rs:76` won't unify them). No subscription matches.
- **Root cause**: When `matches.is_empty()`, the tick logs `info!` and calls `update_status(... Delivered ...)` (line 902), incrementing `events_delivered`. The model defines a purpose-built `PersonaEventStatus::Skipped` ("No matching subscribers — event was intentionally skipped", `event.rs:26`) and the lifecycle explicitly allows `Pending → Skipped` (`event.rs:85`), but the bus never uses it for this path.
- **Impact**: An event that reached *zero* consumers is indistinguishable in the DB/UI from one successfully delivered to N personas. The `events_delivered` metric and the Live Stream both report green for a silently-dropped event, so a broken trigger condition (typo'd event type, wrong `source_filter`) never surfaces — exactly the "trigger condition never matching" failure the registry exists to make visible. The `Skipped` status and its filter option (`LiveStreamTab.tsx:33`) are dead code.
- **Fix sketch**: Use `PersonaEventStatus::Skipped` for the no-match branch and track a separate `events_skipped` counter; surface skipped counts in the stream stats so misrouted events are visible.

## 4. CatalogCard subscribe/unsubscribe has no in-flight guard or error feedback — double-clicks and failed toggles silently desync
- **Severity**: High
- **Category**: Race condition / Silent failure
- **File**: `src/features/triggers/sub_shared/CatalogCard.tsx:50-51`
- **Scenario**: User clicks "Subscribe". The IPC `create_subscription` round-trip (events.rs:106 → dual-write transaction in repo) takes time; the user clicks again, or clicks then immediately clicks the now-"Subscribed" button to unsubscribe.
- **Root cause**: The button's `onClick` fires `isSubscribed ? onUnsubscribe : onSubscribe` with **no disabled/pending state and no debounce**. `isSubscribed` is a prop driven by parent state that only flips after the async call resolves, so during the round-trip the button still reflects the *old* state. Two rapid clicks fire two `create_subscription` calls (idempotent via `INSERT OR IGNORE`, events repo:1195 — so that direction is saved) or a subscribe+unsubscribe race whose final DB state depends on completion order, not click order. There is also no error path: if the command throws (rate limit, DB error), the UI shows no feedback and the optimistic toggle (if any in the parent) is left wrong.
- **Impact**: Users can create/destroy the paired `event_listener` trigger in an order that leaves the persona subscribed in the UI but not the DB (or vice versa) — a subscription that "looks on but never fires," or "looks off but keeps firing." Combined with finding #1, the operator has no reliable signal of the true subscription state.
- **Fix sketch**: Add an `isPending` state that disables the button during the round-trip and only flips `isSubscribed` on resolve; surface command errors (toast/inline) so a failed toggle reverts the UI rather than lying.

## 5. EventCanvas backfills only the latest 1000 events for type discovery — older event types silently absent from the canvas palette
- **Severity**: Low
- **Category**: Edge case / Latent failure (registry desync)
- **File**: `src/features/triggers/sub_builder/EventCanvas.tsx:31`
- **Scenario**: The canvas calls `listEvents(1000)` to "discover all event types in the bus — including ones with no current listener" (comment, line 27-28). On a busy install the most-recent 1000 events are dominated by a few high-frequency types (e.g. `execution-status` floods), so a rare-but-real event type emitted >1000 events ago is not in the result.
- **Root cause**: Type discovery is derived from a fixed-size *recent-events* window (`get_recent`, events repo:313, `ORDER BY created_at DESC LIMIT 1000`) rather than from a `SELECT DISTINCT event_type` query or the authoritative `ALL_EVENT_NAMES` registry (`event_registry.rs:33`). The window is also pruned by the 30-day `cleanup` sweep (events repo:454), so any type not emitted in the last 1000 events / 30 days vanishes from the discovery set.
- **Impact**: A user building a trigger on the canvas cannot wire up an event type that exists in the system but hasn't fired recently — the "browse the event registry" promise is incomplete and non-deterministic (the available palette shifts with traffic). Triggers can only be built for currently-hot event types.
- **Fix sketch**: Discover types via a dedicated `SELECT DISTINCT event_type FROM persona_events` (cheap, indexable) unioned with the static `ALL_EVENT_NAMES` registry, rather than scraping a recent-events page.
