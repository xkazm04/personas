# UI Perfectionist — personal-twin
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. "Approve & log" sends AS the user with zero confirmation weight
- **Severity**: critical
- **Category**: accessibility
- **File**: src/features/plugins/twin/sub_channels/ReplyOutbox.tsx:239
- **Scenario**: The whole premise of the outbox is "a twin acts as you" — the panel header even promises "review it, then approve to log it as a sent message." Yet the primary destructive-equivalent action (recording an OUTBOUND message attributed to the user/contact) fires on a single click of "Approve & log" with no confirmation step. By contrast, *removing a channel* (ChannelsAtelier.tsx:355) and *removing a voice* (VoiceAtelier.tsx:372) both gate behind `ConfirmDialog`. The lowest-stakes action (delete a config row) is guarded; the highest-stakes action (commit a message in the user's name) is not.
- **Root cause**: `handleApprove` is wired directly to `onClick` with no intermediate confirm/preview-of-attribution. The emerald accent gives visual weight but no interaction friction.
- **Impact**: error-blind — a mis-clicked Approve silently mis-attributes a "sent" record to a real contact handle, exactly the failure the frozen `draftContext` code was added to prevent. There is no undo.
- **Fix sketch**: Route Approve through the existing `ConfirmDialog` (already imported across this folder), surfacing the frozen `draftContext.channel → contactHandle` tuple in the dialog body ("Log this as a message you sent to `@handle` on Discord? This cannot be undone."). Reuse the same `danger`/confirm pattern as ChannelsAtelier so the affordance reads consistently.

## 2. Memory/fact/reflection deletes destroy data on a single click — no confirm
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/plugins/twin/sub_brain/DistilledFactsPanel.tsx:253
- **Scenario**: The trash icon on each distilled fact (DistilledFactsPanel.tsx:253) and each reflection (ReflectionsPanel.tsx:186) deletes the row immediately on click — no dialog, no undo toast. Reflections are explicitly described in-code as "frozen-at-write … audit value"; losing one to a stray click is unrecoverable. Meanwhile sibling features (channels, voice) all confirm before delete, so the twin surface is internally inconsistent about how dangerous "trash" is.
- **Root cause**: `handleDelete` calls the API directly from the icon's `onClick`; the `ConfirmDialog` pattern used elsewhere in the same plugin was not applied here.
- **Impact**: error-blind / inconsistent — destructive actions behave differently across tabs of the same feature; the most permanent data (audit reflections, provenance-backed facts) has the weakest guard.
- **Fix sketch**: Gate both deletes behind `ConfirmDialog danger` (or at minimum a confirm + undo toast), matching ChannelsAtelier.tsx:355. Centralize so all twin "trash" buttons share one confirm flow.

## 3. ToneConsole uses native `window.confirm()` instead of the themed ConfirmDialog
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/plugins/twin/sub_tone/ToneConsole.tsx:78
- **Scenario**: Deleting a tone override pops a raw OS `confirm()` dialog — unstyled, blocking, left-aligned OK/Cancel — in the middle of an otherwise polished dark-themed atelier. Every other destructive action in this plugin (channels, voice) uses the in-app `ConfirmDialog` component, so this one dialog breaks the visual language entirely. In a Tauri desktop shell a native confirm is especially jarring.
- **Root cause**: `if (!confirm(t.tone.removeConfirm.replace('{channel}', ch))) return;` — a leftover shortcut never migrated to `ConfirmDialog`.
- **Impact**: inconsistency — the destructive-confirm experience is non-uniform and visually off-brand within the same feature.
- **Fix sketch**: Replace the `confirm()` with the imported `ConfirmDialog` (add a `confirmRemove: channelId | null` state like ChannelsAtelier already does), so tone, channel, and voice deletions all read identically.

## 4. Inline form errors are not announced or visually anchored
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/plugins/twin/sub_channels/ReplyOutbox.tsx:253
- **Scenario**: When draft generation or approval fails, the message renders as a plain `<p className="typo-caption text-red-400">` at the bottom of the card (ReplyOutbox.tsx:253), and the same pattern repeats in ChannelsAtelier.tsx:215 (`formError`). It carries no `role="alert"`/`aria-live`, so screen-reader and keyboard users get no notification, and a long form pushes the error below the fold where it's easy to miss after clicking the top-of-card "Approve".
- **Root cause**: Errors are rendered as static paragraphs with no live region and no proximity to the triggering button.
- **Impact**: inaccessible / error-blind — failures can pass unnoticed; the user re-clicks thinking nothing happened.
- **Fix sketch**: Wrap inline errors in a `role="alert"` (polite live region) element placed adjacent to the action row, with an error icon for sighted users. Apply the same treatment to the shared `formError`/`localError` paragraphs across the plugin.

## 5. Per-file re-declaration of Field/Stat/KPI/MethodCard primitives
- **Severity**: medium
- **Category**: component-extraction
- **File**: src/features/plugins/twin/sub_channels/ReplyOutbox.tsx:258
- **Scenario**: The same tiny presentational helpers are hand-rolled in nearly every twin file with subtly different markup: a labelled-field wrapper as `Field` (ReplyOutbox.tsx:258), `FieldGroup` (ChannelsAtelier.tsx:369), `FieldCell` (ToneConsole.tsx:270), and inline `<label>` blocks in CreateTwinWizard/VoiceAtelier; plus `Stat` (ChannelsAtelier.tsx:378), `Tile` (ToneConsole.tsx:259), and `KpiCell` (VoiceAtelier.tsx:505) — three near-identical "big number + overline label" stat tiles. The overline micro-label string (`text-[10px] uppercase tracking-[0.16em]`) is even copy-pasted (and ToneConsole calls this drift out in a comment at line 24).
- **Root cause**: No shared `TwinField` / `TwinStatTile` primitives; each atelier reimplements the same label+input and stat patterns, so spacing/casing already diverge (`space-y-1` vs `space-y-1.5`, `text-[9px]` vs `text-[10px]` labels).
- **Impact**: inconsistency / unpolished — guarantees ongoing visual drift and multiplies the surface for the a11y/confirm fixes above.
- **Fix sketch**: Extract `TwinField` (label + optional required/warn + children) and `TwinStatTile` (value + overline label + accent) into `twin/shared/`, then replace `Field`/`FieldGroup`/`FieldCell` and `Stat`/`Tile`/`KpiCell` with them. The existing `TwinStat.tsx` in `shared/` suggests this consolidation was already intended.

## 6. Wizard step progress is hidden from assistive tech and lacks per-step validation feedback
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/plugins/twin/sub_profiles/CreateTwinWizard.tsx:189
- **Scenario**: The 4-dot step indicator is marked `aria-hidden` (CreateTwinWizard.tsx:189), and only the visual "Step X of 4" text conveys position — but it isn't an `aria-live` region, so advancing steps is silent to screen readers. Separately, the only gating message is the disabled Next button on step 1; when a required field (e.g. name) is empty the Next button just sits disabled with no explanation of *why*, and there is no error/validation copy on later steps. Step 4's two big buttons also have no busy/disabled visual distinction beyond opacity while `submitting`.
- **Root cause**: Progress is purely decorative markup; validation relies solely on `disabled` state with no associated helper text or `aria-describedby`.
- **Impact**: inaccessible / confusion — keyboard/SR users can't tell what step they're on or why they can't continue.
- **Fix sketch**: Give the wizard body an `aria-live="polite"` step announcement, make the dot indicator carry an accessible label (e.g. `aria-label="Step 2 of 4"` on the container instead of hiding it), and show a short inline hint near the disabled Next ("Add a name to continue") tied via `aria-describedby`.
