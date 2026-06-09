# Audit Fix Wave 11 — Programmatic labeling & ARIA state (Tier-3 highs)

> 5 commits, all 6 findings closed (recipes #2 spans 5 controls; reviews #6 spans 4). 0 deferred.
> Theme: controls that are visually labeled but not *programmatically* — labels with no `htmlFor`, icon-only buttons with at most a `title`, and toggles whose selected state lives only in a color tint. Screen-reader and keyboard users get "button" with no name and no state.
> Baseline preserved: `tsc --noEmit` 0; eslint 0 errors (warnings only — intentional inline aria-labels + pre-existing).
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `5ecf41e45` | credential-vault #2 — field label not tied to input | `vault/sub_credentials/components/forms/FieldCaptureRow.tsx` |
| `27f4b6714` | persona-authoring #2 — identity labels not tied to inputs | `agents/sub_settings/components/PersonaSettingsTab.tsx` |
| `b3e7a7de6` | dev-ideas #4 — triage filters unnamed + color-only active | `plugins/dev-tools/sub_triage/EffortRiskFilter.tsx` |
| `20bb11f28` | recipes #2 — icon-only buttons rely on `title` only | `recipes/{sub_list/RecipeCard,sub_playground/RecipePlaygroundModal,sub_editor/SchemaFieldBuilder,sub_editor/TagChipInput,sub_list/RecipeList}` |
| `8a597f212` | reviews #6 — verdict/selection state invisible to AT | `overview/sub_manual-review/{ReviewDetailPanel,ReviewInboxPanel,ManualReviewList,FocusedDecisionCard}` |

## What was fixed

1. **credential-vault #2** — `FieldCaptureRow`'s visible `<label>` had no `htmlFor`, so clicking it didn't focus the field and AT didn't announce the name. Wired the already-derived `fieldId`: `htmlFor` on the label, `id` on the input and the `ThemedSelect`.
2. **persona-authoring #2** — the name/description labels and the icon-picker button were bare-text labels with no pairing. Added `id`+`htmlFor` for name and description, and `id`/`htmlFor` + `aria-label` for the icon button (mirroring the in-scope parameter-card pattern). (persona-authoring #1, the name-validation critical, was already closed in Wave 7.)
3. **dev-ideas #4** — the effort/risk preset buttons were icon-only (label only in `title`) and the selected preset was color-only. Added `aria-label` + `aria-pressed` to each, and a `ring-2 ring-inset ring-current/40` on the active one so selection is perceivable without color.
4. **recipes #2** — the card quick-test/edit/settings/delete buttons, the playground close, the schema-field delete, the tag-chip remove, and the quick-test dismiss were icon-only with at most a `title`. Added `aria-label` to each (reusing the existing `t.recipes.*` strings on the card; concise labels for the rest); `title` kept for the mouse tooltip.
5. **reviews #6** — the accept/reject verdict toggles (and `FocusedDecisionCard`'s buttons) conveyed selected state by tint only; the inbox selection control was an icon button with no role/checked/name; the icon-only "Delete all" had only a `title`. Added `aria-pressed` to the verdict toggles, `role="checkbox"` + `aria-checked` + `aria-label` to the selection button, and `aria-label` to Delete all.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint` (staged) | 0 errors (warnings only, baseline) |
| `cargo check` | n/a (no Rust this wave) |

## Deferred

None — all findings in this theme were additive attribute changes (no behavior change), so all shipped.

## Patterns reinforced (catalogue, continued)

40. **A visible label is not a programmatic one.** A `<label>` needs `htmlFor` pointing at the control's `id` (or wrap the control). Without it, clicking the label doesn't focus the field and AT reads the input nameless — even though it "looks" labeled. Many components already derive an id (`fieldId`, `useId()`) and just fail to apply it.
41. **`title` is not an accessible name.** Icon-only buttons need `aria-label`; `title` is an unreliable accessible name and invisible to keyboard users. Keep `title` for the mouse tooltip, add `aria-label` for the name. Reuse the string already in `title`.
42. **A toggle needs `aria-pressed`; a selectable item needs `aria-checked`.** Visual ring/tint state is invisible to AT. Pair every visual selected/pressed state with the matching ARIA state attribute (and a non-color cue for sighted users — a ring/border-weight bump).
43. **Custom form components usually spread props.** `ThemedSelect` accepted `id` (and `aria-*`) because it forwards to the underlying `<select>` — when a wrapper already takes `aria-invalid`/`className`, an `id` almost always passes too. Verify with `tsc`, but don't assume you must reach the raw element.

## Cumulative status

| Tier | Waves | Theme | Closed |
|---|---|---|---|
| 1 | 1–6 | Reliability criticals | 33/41 C |
| 2 | 7–9 | UI criticals | 16/19 C |
| 3 | 10 | Color-only status (highs) | 5/6 H |
| 3 | 11 | Programmatic labeling (highs) | 6/6 H |
| | | **Criticals fixed** | **49** |
| | | **Highs fixed (Tier-3)** | **11** |

Tier-3 remaining: ~158 highs. Next natural a11y wave: **keyboard reachability** (hover-only actions with no focus path — companion Stop #3, team-memory row #4, recipes focus treatment #3, use-cases focus #3, fleet session-switch #3). Then the non-a11y high themes (duplicated component markup ~25, error-blind/missing-state highs, hardcoded-i18n ~10, token/contrast drift ~15).
