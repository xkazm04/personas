# C3 — Messaging prototype handoff (2026-04-21)

> End-of-session handoff for the messaging + notifications UX work. The
> Pipeline-Canvas prototype is wired into `UseCasePickerStep` behind a
> top-of-step switcher (Production | Pipeline). Next session should
> convert the prototype to a production component and implement the
> backend gaps so messaging works end-to-end.

---

## 1. Where we are (master)

- `docs/concepts/persona-capabilities/C3-messaging-design.md` — backend
  analysis + v3.2 schema proposal + UX principles.
- `src/features/templates/sub_generated/adoption/MessagingPickerShared.tsx`
  — mock vault credentials, sample messages per UC, mock
  `test_channel_delivery` IPC stub.
- `src/features/templates/sub_generated/adoption/MessagingPickerVariantC.tsx`
  — Pipeline-Canvas prototype. `@ts-nocheck`. Uses semantic tokens
  throughout (`typo-caption/body/code`, `ring-*`, `bg-primary/N`,
  `bg-brand-cyan/N`, `text-brand-*`, `focus-ring`).
- `src/features/templates/sub_generated/adoption/UseCasePickerStep.tsx`
  — switcher wrapper. Production = existing Neon picker; Pipeline =
  Variant C. Switcher + Continue CTA live here.
- Chip Rail (A) + Drawer Tabs (B) + Demo wrapper deleted —
  `d03285f5`.
- `financial-stocks-signaller.json` — `notification_channels_default`
  flipped to `type: "built-in"` so in-app is the explicit default.

### Commits in this session

```
5534ee7d feat(adoption): prototype 3 messaging + TitleBar UX variants for UC picker
3e51e49a feat(adoption): wire messaging prototype switcher into UC picker step
33d6a09f fix(adoption): replace lucide Slack import with Hash alias
d03285f5 refactor(adoption): drop Chip Rail + Drawer Tabs prototypes, tokenise Pipeline
9abffeff fix(adoption): themed focus ring + correct thumb/CTA colors on active states
93c3e67a fix(adoption): stronger cyan accent on active states in Pipeline prototype
(final)  fix(adoption): use ring-1 ring-primary/* instead of border+border-color
```

---

## 2. UX decisions locked

1. **Production and Pipeline will be combined.** The user explicitly
   wants to merge them — not pick one. Chip Rail and Drawer Tabs were
   rejected.
2. **In-app messaging is the always-on default.** Every persona starts
   with `{type: "built-in", enabled: true, use_case_ids: "*"}` even if
   the template didn't declare a `notification_channels_default`.
3. **Icon-centric messaging picker** — the current `messaging`-category
   vault credentials + the always-present `personas_messages` built-in
   render as a row of circular icons. Click toggles; long-press opens
   per-channel config popover.
4. **Per-event TitleBar subscriptions** — each UC's emit events appear
   as checkboxes; user opts into which should ping the TitleBar bell.
   Template authors pre-tick sensible defaults.
5. **Sample-message preview + test delivery** — each UC carries a
   `sample_output` that the Test Run button dispatches through the
   selected channels. Per-channel pass/fail is rendered inline.
6. **Triggers: time + event coexist.** Current
   `useCasePickerShared.ts` already supports both families being active
   simultaneously. Prototype must preserve this. The sub-state
   preservation (hour/weekday across preset switches) is also load-bearing.

---

## 3. Prototype styling learnings (apply in final component)

- **Never use `border` + `border-<color>` on dynamic active states.** The
  Tailwind v4 scanner occasionally misses the color modifier on first
  emission, leaving the element with a width-only border that defaults
  to `currentColor` → white outlines on dark theme. **Use `ring-1
  ring-<color>` or `ring-2 ring-<color>` instead** — the width and
  color are a single utility so they always travel together.
- **Every interactive button needs the `focus-ring` utility** (defined
  in `globals.css` as `@utility focus-ring` → `var(--focus-ring-color)`
  on `:focus-visible`). Without it, the browser's default white/blue
  outline fires on focus.
- **Filled primary buttons keep `text-white`** (not `text-background`)
  — that's the pattern the Neon picker uses for its Continue CTA and
  it works across all themes.
- **Toggle-switch thumbs keep `bg-white`** (not `bg-foreground`) —
  thumbs are universally light across both dark and light themes; using
  `bg-foreground` inverts the contrast.
- **Semantic typo tokens only:** `typo-caption | typo-body |
  typo-body-lg | typo-heading | typo-heading-lg | typo-code`. Raw
  `text-xs/sm/lg/[Npx]` bypass the theme layer.
- **Active states need real visual weight.** `bg-card-bg +
  border-card-border` (alpha 0.05–0.10) is too subtle for a toggle — it
  reads as "no change". Use `ring-1 ring-primary/40 bg-primary/5
  shadow-elevation-2` or the Neon gradient pattern.

---

## 4. Backend gaps — next session's priority

### 4.1 Schema changes (template side)

- **Template — `use_cases[].sample_output: {title, body, format}`**:
  what a successful run looks like. When `message_composition:
  "combined"`, a single `persona.sample_output` overrides. Required so
  the Test Run button has something to send.
- **Template — `event_subscriptions[].notify_titlebar: boolean`**:
  pre-populated by template authors, user-overridable at adoption.
  Each emit event is either a recommended bell ping or off by default.

### 4.2 Persona row `notification_channels` — shape v2

Keep the existing array shape, add:

- `type: "built-in"` — in-app Messages inbox (formalised).
- `type: "titlebar"` — NEW. Writes to `notificationCenterStore` via a
  new Tauri event.
- `use_case_ids: string[] | "*"` — scoping; `"*"` = persona-wide.
- `event_filter: string[]` — optional filter on emit event types.
  Mainly for `titlebar` but available to slack/email too.

### 4.3 Backend glue

1. `src-tauri/src/engine/dispatch.rs::resolve_notification_channels()`
   — already scopes by `use_case_id`. Extend to:
   - Respect `use_case_ids: ["*"]` as "all UCs".
   - Apply `event_filter` when the protocol message is `EmitEvent` or
     when a `UserMessage` was produced in an event-chained execution.
2. `src-tauri/src/notifications.rs::deliver_to_channels()` — two new
   branches:
   - `"built-in"` → no-op at delivery time (the `messages` insert
     already happened upstream in dispatch).
   - `"titlebar"` → emit a new Tauri event
     `titlebar-notification` with `{persona_id, persona_name,
     use_case_id, event_type, title, body, priority}`. Frontend bridge
     subscribes and calls `notificationCenterStore.addNotification()`.
3. **New IPC `test_channel_delivery(spec, sample) →
   TestDeliveryResult[]`** — routes through the same `deliver_*`
   functions so the Test Run button works end-to-end.
4. Frontend bridge file — `src/lib/eventBridge.titlebarNotifications.ts`
   — `listen('titlebar-notification', …)` → store. Import it once from
   `App.tsx` so the listener is global.

### 4.4 Persona metadata propagation

When the user confirms the adoption, `save_adoption_answers` already
carries the questionnaire answers + credential bindings. Extend the
payload to include `messaging_channels: [...]` (the new channel specs
with `use_case_ids` + `event_filter` + resolved credential_ids) and
`titlebar_event_subscriptions: [...]` so the promote path can write
them to the persona row.

Files to touch:

- `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx`
  — extend the `save_adoption_answers` invoke with the new fields.
- `src-tauri/src/commands/design/build_sessions.rs::save_adoption_answers`
  — accept + persist the new fields.
- `src-tauri/src/engine/compiler.rs` and `bundle.rs` — include the new
  fields on the persona row when a template promotes.

### 4.5 Execution integration

Once channels are written to `personas.notification_channels`:

- `dispatch.rs` already reads it via `resolve_notification_channels()`.
- `notifications.rs::deliver_to_channels()` handles slack/telegram/email
  today; the new `"built-in"` + `"titlebar"` branches hook into it.
- The `messages` table already has a `use_case_id` column (see
  `dispatch.rs:239`) — per-UC scoping will land naturally.
- Verify that the `event_filter` scoping doesn't break the
  always-current-UC UserMessage delivery — `UserMessage` is UC-scoped
  by virtue of the execution's `use_case_id`; event_filter is opt-in.

---

## 5. Prototype → production conversion plan

1. **Decide the trigger layout.** Production Neon has a rich trigger
   family (daily-at-hour, weekly-on-weekday, event-listen with
   dropdown). My prototype used 5 compact chips. Merge: keep Neon's
   trigger family controls, but lay them out vertically in the
   "Trigger" zone of the Pipeline so the visual dataflow survives.
2. **Lift state from local to shared.** My prototype owns
   `channelStates`, `triggerByUc`, `enabled` locally. Move into
   `MatrixAdoptionView` so the promote path can serialize them, and
   feed them through props the same way Neon receives
   `triggerSelections`.
3. **Replace mocks with real sources.**
   - `MOCK_MESSAGING_CHANNELS` →
     `useVaultStore.credentials.filter(c =>
     connectorCategoryTags(c.service_type).includes('messaging'))`
     plus the built-in `personas_messages` pinned first.
   - `SAMPLE_MESSAGE_BY_UC` → `template.use_cases[].sample_output`
     (once the v3.2 schema change lands; until then, fall back to a
     generic `{title: uc.name, body: uc.capability_summary}`).
   - `MOCK_EMIT_EVENTS_BY_UC` →
     `template.use_cases[].event_subscriptions.filter(s => s.direction
     === 'emit')`.
   - `mockTestDelivery()` → `invokeWithTimeout('test_channel_delivery',
     {channel_spec, sample_title, sample_body})`.
4. **Drop the switcher** in `UseCasePickerStep.tsx` — restore minimal
   passthrough, delete `MessagingPickerShared.tsx` +
   `MessagingPickerVariantC.tsx`.
5. **Composition-aware layout.** When
   `persona.message_composition === 'combined'`, collapse per-UC
   channel selectors into one persona-wide channel row (like
   financial-stocks-signaller's intent). The Pipeline still renders per
   UC, but the channel zone is shared.

---

## 6. Template-author follow-up

Once the v3.2 fields exist, update the 107 templates to add:

- `use_cases[].sample_output` — realistic per-UC examples. Can be
  delegated to parallel agents similar to the v3.1 pass.
- `event_subscriptions[].notify_titlebar` — template authors pre-tick
  events worth interrupting the user for. Conservative defaults:
  every `*.error` → off (covered by execution-failed bell already),
  `*.at_risk` / `*.sector_shift` / `*.buy` / `*.sell` → on,
  `*.delivered` / `*.completed` → off.

---

## 7. Open questions to resolve

1. **Persist `notification_channels` encrypted?** Today it's encrypted
   via `persona_repo::encrypt_notification_channels`. The new shape
   still contains credential_ids (not plaintext secrets), so
   encryption stays the same. Confirm no extra PII gets added.
2. **Do disabled UCs still fire the TitleBar?** No — disabled UCs
   produce no events, so no bell entries. Make this the rule in
   `resolve_notification_channels()`.
3. **Test-delivery rate limiting?** A user hitting Test repeatedly
   could hammer external APIs. Debounce at 1 req/sec per channel in
   `test_channel_delivery`.
4. **Persisted bell subscriptions survive persona edits?** When the
   user edits an existing persona, the bell subscriptions should
   round-trip through the design_context. Verify on the edit path
   (`MatrixCommandCenter` or similar) once the fields land.

---

## 8. Context budget note

End of session at ~78% context. Next session starts fresh and can
tackle the backend + schema work cleanly without the prototype churn
carrying forward.
