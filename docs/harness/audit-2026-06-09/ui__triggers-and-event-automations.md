# UI Perfectionist — triggers-and-event-automations
> Total: 6
> Severity: 0 critical, 3 high, 2 medium, 1 low

## 1. Cloud webhook delete fires instantly with no confirmation — inconsistent with Smee's confirm-delete
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:302
- **Scenario**: In the Cloud Webhooks tab, clicking the trash icon on a webhook row immediately deletes the trigger (`handleDelete` → `cloudDeleteTrigger`) with no prompt and no undo. In the sibling Smee Relay tab, the same trash icon swaps to a two-step "Confirm / Cancel" pair (SmeeRelayTab.tsx:433-456) before deleting.
- **Root cause**: Two tabs that look and behave like siblings (status banner + add form + row list) diverge on the most destructive action. The Cloud tab never adopted the confirm pattern; deletion is a single un-guarded `onClick`.
- **Impact**: error-blind — a misclick destroys a deployed webhook trigger with no recovery, and the inconsistent interaction model between adjacent tabs erodes trust.
- **Fix sketch**: Mirror Smee's inline confirm: add `confirmDeleteId` state and render a Confirm/Cancel pair in place of the trash button when armed (lines 302-308). Ideally extract the shared pattern into a small `InlineConfirmDelete` so both tabs stay in lockstep.

## 2. Webhook builder shows no actual endpoint URL and no copy affordance
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/triggers/sub_triggers/configs/WebhookConfig.tsx:85
- **Scenario**: When a user picks the "webhook" trigger type in the builder, the only webhook-specific UI is the HMAC secret field plus a static one-line note (`t.triggers.webhook_url_note`). There is no display of the endpoint URL the webhook will be posted to, and therefore no copy-to-clipboard button — yet the Cloud Webhooks tab prominently shows and copies the URL for every row (CloudWebhooksTab.tsx:266-288).
- **Root cause**: The local webhook builder treats the URL as out-of-scope prose instead of a first-class, copyable field. The product already has the copy-URL affordance one tab over, so the builder reads as half-finished.
- **Impact**: confusion / error-blind — users configure a webhook trigger but have no way to learn or copy the URL to paste into the upstream service, defeating the trigger.
- **Fix sketch**: Render the resolved endpoint URL in a read-only mono field above the note, with the shared `CopyButton` (already imported in SmeeRelayTab). If the URL is only known post-create, show a clear "URL available after you create this trigger" empty/placeholder state instead of a bare sentence.

## 3. Cloud webhook copy buttons re-implement the shared CopyButton (inconsistent affordance)
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:278
- **Scenario**: Cloud Webhooks hand-rolls two copy controls — a Copy/Check icon button for the URL (lines 278-288) and a text "Secret"/"Copied" toggle (lines 289-301) — driven by a local `useKeyedCopyFlag`. The Smee tab next door uses the shared `<CopyButton>` (SmeeRelayTab.tsx:421), and WebhookConfig.tsx uses `useCopyToClipboard`. Three different copy implementations exist within one feature.
- **Root cause**: No single copy primitive is enforced; each surface reinvents the copied-state flash, tooltip, and icon swap with slightly different sizing (`w-3.5` icon vs CopyButton's own styling) and timing.
- **Impact**: inconsistency — copied-state feedback, hover, and focus rings differ subtly between adjacent rows/tabs, and the "Secret" text-button has no icon so it reads as a different control class than the URL copy.
- **Fix sketch**: Replace both bespoke buttons with the shared `<CopyButton>` (passing `text` + `tooltip`), adding a labeled variant for the secret. This unifies copied feedback, a11y labelling, and sizing across the feature.

## 4. Cron field legend is a misaligned, inaccessible row of decorative words
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/triggers/sub_triggers/TriggerScheduleConfig.tsx:214
- **Scenario**: Below the single cron text input, five evenly `gap-3`-spaced words (`min hour day month weekday`) are rendered. Because the input is one free-text field, the words do not line up under the five cron positions the user is typing, so they read as a floating caption rather than a legend, and they offer no per-field guidance.
- **Root cause**: The legend is presentational markup with no association to the input and no positional mapping — it neither aligns to the typed tokens nor is exposed as input help (`aria-describedby` points only to error/preview ids, not this legend).
- **Impact**: inaccessible / confusion — screen readers get five orphan words; sighted users get a legend that doesn't map to what they're editing.
- **Fix sketch**: Either monospace-align the five labels to the cron token columns (e.g. a 5-cell grid mirroring the expression), or replace with the human description (already shown at line 208) as the primary aid and demote the legend to `aria-describedby` help text wired to the input. At minimum give the legend `aria-hidden="true"` since the description already conveys meaning.

## 5. Async cron description & schedule preview update silently for screen-reader users
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/triggers/sub_triggers/TriggerScheduleConfig.tsx:208
- **Scenario**: After typing a cron expression, a 400ms-debounced backend call (TriggerAddForm.tsx:82-87) populates the human-readable description (line 208-212) and the next-runs timeline (line 262, `CronSchedulePreview`). A spinner appears at line 194 but the resulting validity/description text and the "next run" preview swap in with no live-region announcement.
- **Root cause**: The validation/preview region is purely visual. There is no `aria-live` wrapper, and the spinner has no `aria-label`/`role=status`, so non-sighted users get no feedback that their expression validated, what it means, or when it next runs.
- **Impact**: inaccessible / error-blind — a keyboard/SR user cannot tell whether the cron is valid or what schedule they just built.
- **Fix sketch**: Wrap the description + error + preview block in a `role="status" aria-live="polite"` container so the resolved description and "next run" are announced; give the loading spinner (line 194) `role="status"` with an accessible "Validating cron expression" label.

## 6. Composite "Operator" label hardcoded, options not exposed as a radio group
- **Severity**: low
- **Category**: accessibility
- **File**: src/features/triggers/sub_triggers/configs/CompositeConfig.tsx:69
- **Scenario**: The composite-trigger Operator selector renders three mutually-exclusive buttons (ALL/ANY/Sequence, lines 70-90). The label is `t.triggers.op_all_label ? 'Operator' : 'Operator'` — a no-op ternary that always yields the untranslated literal `'Operator'`, breaking i18n parity with every other label in the form. The three buttons also form a single-select set but carry no `role="radiogroup"`/`role="radio"`/`aria-checked`, unlike the TriggerTypeSelector which does it correctly (TriggerTypeSelector.tsx:33-51).
- **Root cause**: A copy-paste stub left a dead ternary, and the single-select button group was built as plain buttons rather than the established radiogroup pattern used elsewhere in the same feature.
- **Impact**: inaccessible / inconsistency — SR users hear three independent buttons with no group semantics or selected state; the label can never be localized.
- **Fix sketch**: Replace the ternary with a real translation key (e.g. `t.triggers.composite.operator_label`). Wrap the three buttons in `role="radiogroup"` with each as `role="radio" aria-checked={...}` plus arrow-key roving focus, matching TriggerTypeSelector.
