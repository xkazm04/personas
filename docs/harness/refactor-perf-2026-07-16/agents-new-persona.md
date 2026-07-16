# agents/new_persona — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: Persona Authoring & Design | Files read: 11 | Missing: 0

## 1. Hardcoded English strings bypass i18n in Connectors and Policies panes
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/agents/sub_new_persona/capabilityView/panes/CapabilityConnectorsPane.tsx:53 (also :70), src/features/agents/sub_new_persona/capabilityView/panes/CapabilityPoliciesPane.tsx:64 (also :99)
- **Scenario**: A user running the app in any of the 14 non-English locales sees `aria-label="Remove"`, `placeholder="connector_name"`, and two `placeholder="Context"` strings in English while every sibling string in the same panes goes through `t.matrix_v3.*` / `t.common.*`.
- **Root cause**: Four literals were left inline instead of being added to the `matrix_v3` catalog when these panes were built; the rest of the capabilityView folder is fully translated.
- **Impact**: Visible copy inconsistency in localized builds and an untranslated screen-reader label; also breaks the folder's otherwise-clean i18n convention, so future copy edits miss these strings.
- **Fix sketch**: Add `capability_connector_placeholder`, `capability_context_placeholder`, and reuse an existing remove label (or add `capability_connector_remove`) to `matrix_v3` in `src/i18n`; replace the four literals with `t.matrix_v3.*`. The connector chip's remove `aria-label` should include the connector name (`Remove {name}`) for screen-reader disambiguation.

## 2. Review-mode label mapping duplicated across summary and policies pane
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_new_persona/capabilityView/CapabilityRowSummary.tsx:17-22 (dup of panes/CapabilityPoliciesPane.tsx:25-30)
- **Scenario**: Adding a fourth review mode (or renaming a key) requires editing the same triple-ternary in two files; miss one and the collapsed chip and the expanded pane disagree on the label.
- **Root cause**: The `ReviewPolicy["mode"] → t.matrix_v3.review_mode_*` mapping was written inline twice instead of living next to the other capability helpers in `capabilityHelpers.ts`.
- **Impact**: Small but real drift hazard between two views of the same field; pure maintenance cost, no runtime effect.
- **Fix sketch**: Add `reviewModeLabel(t: Translations, mode: ReviewPolicy["mode"]): string` (or a `Record<mode, keyof matrix_v3>` map) to `capabilityHelpers.ts` and call it from both `CapabilityRowSummary` and `CapabilityPoliciesPane`. While there, the duplicated `(trig.config ?? {}) as Record<string, unknown>` cast in `capabilityHelpers.ts:15` and `CapabilityTriggerPane.tsx:24` can share a tiny `triggerConfig(trig)` helper.

## 3. Title/summary inputs write to the global Zustand store on every keystroke
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_new_persona/capabilityView/CapabilityRowHeader.tsx:35 (also :42, and panes/CapabilityPoliciesPane.tsx:63,:98)
- **Scenario**: Typing a capability title fires `patchCapability` per keystroke. Each call runs `updateSessionInState` (immutable rebuild of the session + full `capabilities` record spread) and notifies every `useAgentStore` subscriber in the app — the store composes 11 slices and is subscribed from chat, execution, mini-player, health-check, etc. — so all their selectors re-execute per keypress. The persist middleware also re-runs partialize/serialize on each set.
- **Root cause**: Controlled inputs are bound directly to store state with no local draft or debounce; the store write path (session rebuild + global notify) is designed for discrete actions, not keystroke-frequency events.
- **Impact**: Bounded but repeated waste on a hot interactive path (fast typists = ~10 sets/sec each triggering N selector evaluations and a persist cycle). Downstream re-renders are mostly avoided by granular selectors (`s.buildCapabilities[id]` keeps other rows' references stable — verified), so the cost is selector churn + object churn, not visible jank today; it grows with every new store subscriber.
- **Fix sketch**: Keep keystrokes in local `useState` and commit to the store on blur/Enter, or wrap the store write in a ~300ms debounce (the codebase already has this pattern queued as the `useDebounceContextSave` refactor idea — reuse that hook here for title, summary, and the two policy `context` inputs). No behavior change needed beyond commit timing.
