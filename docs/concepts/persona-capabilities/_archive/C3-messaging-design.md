# C3 — Messaging & notification design (v3.2 draft)

> Drafted 2026-04-21 in response to the UC-picker feedback: messaging and
> notifications deserve a first-class adoption surface, co-located with the
> capability picker, covering (a) per-UC channel picking with vault
> auto-detection, (b) TitleBar notification subscriptions per event, and
> (c) sample-message previews with live test-delivery.
>
> This document captures the backend plumbing already in place, the gaps
> we need to close, and the schema changes required. The UX variants are
> prototyped separately in
> `src/features/templates/sub_generated/adoption/MessagingPickerDemo.tsx`.

---

## 1. What already works (today)

### 1.1 Persona row `notification_channels`

Column: `personas.notification_channels TEXT` (nullable, encrypted via
`persona_repo::encrypt_notification_channels`). Two legal shapes:

```jsonc
// Shape A — preferences object (legacy)
{
  "execution_completed": true,
  "manual_review": true,
  "new_message": true,
  "healing_issue": true
}

// Shape B — channels array (current)
[
  { "type": "slack",    "enabled": true, "credential_id": "...", "config": {"channel": "#team"} },
  { "type": "telegram", "enabled": true, "credential_id": "...", "config": {"chat_id": "..."} },
  { "type": "email",    "enabled": true, "credential_id": "...", "config": {"to": "me@co.com"} }
]
```

### 1.2 Dispatch pipeline (`src-tauri/src/engine/dispatch.rs`)

When a persona capability emits a `ProtocolMessage`:

- **`UserMessage`** → `messages` table insert → `message.created` Tauri event
  → `notify_new_message()` → OS notification **+** `deliver_to_channels()`
  fires async Slack/Telegram/Email delivery (only channels with
  `enabled: true`).
- **`ManualReview`** → `manual_reviews` table insert → `notify_manual_review()`
  same fanout.
- **`EmitEvent`** → `persona_events` table insert → frontend event
  stream. **No external channel delivery today.**

Per-UC override: `resolve_notification_channels()` already looks up
`design_context.use_cases[<uc_id>].notification_channels` first, falling
back to the persona-wide value. So UC-scoped channels work — templates
just need to declare them.

### 1.3 Builtin messaging connector

`scripts/connectors/builtin/local-messaging.json`:

- `name: "personas_messages"`, `category: "messaging"`,
  `categories: ["messaging", "in_app_notifications"]`
- `auth_type: "builtin"`, `always_active: true`
- Available on first launch with no credential input required.
- Writes go to the local `messages` table; the Messages tab reads them.

### 1.4 TitleBar notification store

`src/stores/notificationCenterStore.ts`:

- `localStorage`-backed, global (not persona-scoped), max 50 entries.
- `addNotification()` / `addProcessNotification()` push entries.
- Already fed by: pipeline events, process completions, failed-execution
  alerts (see commit `42f3af58`).
- Bell badge in `TitleBar.tsx` reads `unreadCount`.

---

## 2. The gaps

| Gap | Consequence |
|---|---|
| **No adoption UI for picking a messaging channel per UC.** The template's `notification_channels_default` is the final word. | Users can't swap in Slack/Telegram without hand-editing persona JSON after creation. |
| **No TitleBar subscription for persona events.** The persona emits `briefer.goal.at_risk` (example) and the event is written to `persona_events`, but nothing pushes it to `notificationCenterStore`. | The Bell can't surface capability-level alerts the user explicitly opted into. |
| **No sample-message field on templates.** There's `sample_input` for what a UC consumes but no `sample_output` for what it produces. | "Test the channel" button has nothing to send. |
| **No `test_channel_delivery` IPC.** | Users can't verify Slack webhook / Telegram chat_id until the first real execution fires — slow feedback. |
| **In-app messaging isn't guaranteed-on.** Templates that don't declare `notification_channels_default` silently skip delivery. | New users get a persona that "runs" but produces no visible output. |

---

## 3. Schema changes (v3.2)

### 3.1 Template — per-UC sample output

Add an optional `sample_output` block to each `use_cases[]` entry that the
adoption UI uses to preview what the UC produces. When
`message_composition: "combined"`, a single
`persona.sample_output` overrides per-UC samples.

```jsonc
"use_cases": [
  {
    "id": "uc_morning_briefing",
    ...
    "sample_output": {
      "title": "Morning Briefing — {{date}}",
      "body": "**Research highlights**\n- ...\n\n**Today's plan** (4 items)\n1. ...\n2. ...",
      "format": "markdown"     // "markdown" | "plaintext" | "blocks"
    }
  }
]
```

### 3.2 Template — TitleBar opt-ins

Each UC's `event_subscriptions[]` entry gains optional
`notify_titlebar`:

```jsonc
"event_subscriptions": [
  {
    "event_type": "briefer.goal.at_risk",
    "direction": "emit",
    "description": "...",
    "notify_titlebar": true     // default false — user opts in at adoption
  },
  {
    "event_type": "briefer.morning.delivered",
    "direction": "emit",
    "description": "...",
    "notify_titlebar": false    // don't spam the bell on every run
  }
]
```

Template authors set sensible defaults; the adoption UI surfaces each
emit-event with a toggle so the user can override.

### 3.3 Persona — notification_channels shape v2

Extend the array shape with:

- `type: "built-in"` — in-app Messages inbox (existing behavior when
  `personas_messages` is the channel; formalized as a first-class type).
- `type: "titlebar"` — new. Pushes to `notificationCenterStore` via a
  dedicated Tauri event.
- `use_case_ids: string[] | "*"` — scoping. `"*"` = persona-wide.
- `event_filter: string[]` — when present, only these event types
  trigger delivery for this channel. Applies primarily to `titlebar`
  type; for slack/email it's an opt-in filter so users can route
  e.g. `stocks.signals.buy` to a different channel than the weekly
  briefing.

```jsonc
[
  {
    "type": "built-in",
    "enabled": true,
    "use_case_ids": "*"
  },
  {
    "type": "slack",
    "enabled": true,
    "credential_id": "...",
    "config": { "channel": "#signals" },
    "use_case_ids": ["uc_signals"],
    "event_filter": ["stocks.signals.buy", "stocks.signals.sell"]
  },
  {
    "type": "titlebar",
    "enabled": true,
    "use_case_ids": ["uc_signals", "uc_congressional_scan"],
    "event_filter": ["stocks.signals.buy", "stocks.congress.sector_shift"]
  }
]
```

### 3.4 Backend glue

1. **`dispatch.rs::resolve_notification_channels()`** — already scopes
   by `use_case_id`. Extend to:
   - Honor `use_case_ids: ["*"]` as "all UCs".
   - Honor `event_filter` — pass the triggering event type in when the
     protocol message is an `EmitEvent` or the `UserMessage` was
     produced by a specific event chain.
2. **`notifications.rs::deliver_to_channels()`** — add two branches:
   - `"built-in"` → no-op for the delivery step (the `messages` table
     insert already happened upstream in `dispatch`).
   - `"titlebar"` → emit a new Tauri event `titlebar-notification`
     with `{persona_id, persona_name, use_case_id, event_type, title,
     body, priority}`. The frontend bridge subscribes and calls
     `notificationCenterStore.addNotification()`.
3. **New IPC: `test_channel_delivery`** —
   `Args { channel_spec: Channel, sample_title, sample_body }`. Routes
   through the same `deliver_slack` / `deliver_telegram` /
   `deliver_email` / titlebar functions. Returns
   `{success: bool, latency_ms, error?: string}`. Used by the "Test"
   button in the picker.

### 3.5 Frontend bridge

New file `src/lib/eventBridge.titlebarNotifications.ts` (or extend
existing eventBridge.ts):

```typescript
listen<TitlebarNotificationPayload>('titlebar-notification', (e) => {
  useNotificationCenterStore.getState().addNotification({
    pipelineId: 0,
    projectId: null,
    status: 'success',
    ref: `persona:${e.payload.persona_id}`,
    webUrl: `/personas/${e.payload.persona_id}?uc=${e.payload.use_case_id}`,
    title: e.payload.title,
    message: e.payload.body,
  });
});
```

---

## 4. UX principles

1. **In-app is the always-on default.** Every persona's channels array
   starts with `{type: "built-in", enabled: true, use_case_ids: "*"}`.
   Users see a working Messages inbox from day one.

2. **Vault-driven channel picker.** Templates never hardcode "Slack" or
   "Telegram" — they reference the `messaging` category and the picker
   enumerates healthy messaging credentials (plus the always-present
   built-in).

3. **Icon-centric, one-click add.** A row of circular connector icons
   for the messaging category (built-in + each vault credential).
   Clicking toggles channel inclusion for the active UC; long-press
   opens config (channel name, chat id, etc.).

4. **TitleBar subscriptions are per-event.** The adoption UI shows each
   UC's `event_subscriptions[].emit` list as a checkbox column. User
   picks which events should ping the Bell. Template authors pre-tick
   the ones that make sense.

5. **Sample messages are first-class.** The picker shows a preview
   card rendered from the UC's `sample_output`. A `Send test` button
   dispatches the sample to the selected channels so the user sees
   what shows up in Slack / Telegram / the bell before the persona
   runs for real.

6. **Cross-UC events are discoverable.** When a UC uses
   `trigger = event`, the event dropdown lists events emitted by any
   UC in the template, regardless of enablement — users can wire
   cross-capability chains even with the emitter UC disabled. (This is
   what the current picker does; the prototypes preserve it.)

7. **Time + event triggers coexist.** Time and Event are independent
   families; a UC can have both. Switching time presets
   (daily → hourly → daily) preserves hour-of-day and weekday across
   the round trip. (Already in `useCasePickerShared.ts`; the prototypes
   must not regress this.)

---

## 5. UX prototype variants

See `src/features/templates/sub_generated/adoption/MessagingPickerDemo.tsx`
for the switchable variants. High-level shape of each:

### Variant A — Chip Rail

Compact single-card layout per UC. Horizontal chip rail below each
capability's description contains:

- Trigger chips (Manual / Hourly / Daily / Weekly / Event) — familiar.
- A divider.
- Channel icons (built-in always first; vault credentials appended).
  Click = toggle; long-press = config popover.
- A "Bell" icon that opens a small popover listing emit-events for
  this UC with checkbox toggles.
- A "Test" button. Sends the UC's `sample_output` to the active
  channels.

Pros: compact, fits many UCs on one screen, minimal chrome.
Cons: dense; advanced config is behind long-press or secondary menus.

### Variant B — Drawer Tabs

UC cards are collapsed by default, showing just title + on/off +
trigger-summary line. Click to expand into a 4-tab drawer:

- **Trigger** — the time/event family controls (current behavior).
- **Channels** — icon grid with built-in + vault credentials; config
  form for whichever is selected.
- **Notifications** — per-event checkbox list with help text;
  "Preview bell notification" button.
- **Preview** — rendered `sample_output` with a "Send test" button
  that dispatches to the selected channels.

Pros: progressive disclosure; each concern has breathing room.
Cons: one UC open at a time; more clicks.

### Variant C — Pipeline Canvas

Each UC is a horizontal pipeline showing 4 visual zones:

```
[ Trigger ] ─▶ [ Use Case ] ─▶ [ Channels ] ─▶ [ Notifications ]
```

Trigger zone has time/event pills. Channel zone shows icons stacked
with a + button to add. Notifications zone shows bell + counter for
opted-in events. All zones are in-place editable (no drawers). A
single "Test run" button at the bottom renders the sample through the
full pipeline so the user sees the Slack post preview, the bell toast,
and the inbox entry — all at once.

Pros: mental model matches the runtime dataflow; most visual.
Cons: widest layout; some UCs have sparse channel/notification
zones and look empty.

---

## 6. Scope split

**Prototype pass (this session):** build all three variants as
`@ts-nocheck` preview files with mocked vault credentials, a mocked
sample message, and a tab switcher so the user can compare. Wire them
to the current `TriggerSelection` / `UseCaseOption` shapes so the
picker state semantics carry over when one wins.

**Deferred to implementation pass (future session):**
- Schema changes on templates (add `sample_output`, `notify_titlebar`).
- Backend extensions (new channel types, event_filter, test_channel IPC,
  frontend bridge).
- Normalizer changes in `template_v3.rs` to pass the new fields through.
- Template-author pass to add `sample_output` to the 107 templates.

---

## 7. Open questions

1. **Should TitleBar notifications persist across app restarts?** They
   do today (localStorage, 50-item ring buffer). Probably yes — so a
   late-night `briefer.goal.at_risk` isn't lost when the user wakes up.
2. **Should event_filter apply to `UserMessage` deliveries too?** Or
   only to `EmitEvent`? Lean toward "only EmitEvent"; user-facing
   messages should always land in configured channels.
3. **Sample output per UC or per template-wide "combined" briefing?**
   When `message_composition: "combined"`, a single
   `persona.sample_output` fits better than per-UC samples.
4. **Multi-channel fanout at test time?** The Test button should show
   per-channel success/failure inline (Slack ✓, Telegram ✗ "invalid
   chat_id"). Clear spec for the IPC response.
