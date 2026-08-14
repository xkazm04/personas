# Golden path — Form field and validation

> Situation node: `ui-system/controls-and-forms/form-field-and-validation` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a repo-wide ground-truth sweep (~55 direct tool calls
> plus two parallel corpus sweeps — the raw-field frontend corpus and the
> Rust/IPC validation-authority corpus), against `master` @ `f7676ab82`.
> Dimensions: **ui · function · code-quality · resilience**.
> `twoSided: false` — this path prescribes the client field. But see
> **§ Where the authority actually lives**: for credentials, connectors,
> external API keys and knowledge bases the client field is the *only*
> validation that exists anywhere in the product, which changes what
> "client-side" is allowed to mean here.
> Every count below was produced by grep over `src/**/*.tsx` (or the named Rust
> tree), not estimated. `.claude/worktrees/**` excluded.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

**Adjacent leaves — cross-reference, do not absorb.**
`ui-system/controls-and-forms/schema-driven-form` owns rendering fields from a
runtime schema (`SchemaFormFields.tsx`, `CredentialTemplateForm.tsx`,
`PresetQuestionnaireForm.tsx`) — this path owns the *one field* those renderers
should emit. `dropdown-and-select` owns `ThemedSelect` / `Listbox` internals —
this path only states the contract a select must honour to sit inside a
`FormField` (and records, in Gaps #3, that it currently doesn't).
`raw-json-editor` owns textarea-as-JSON. `button` owns the submit control
itself; this path owns what gates it.

## Trigger

- "Add a name / description / URL / API-key field to this modal."
- "Show an error when the name is empty" / "this should turn red if the URL is bad."
- "Warn the user if that team name is already taken."
- "The Create button should stay disabled until the form is valid."
- "Add a character limit to this field" / "the label should say it's required."
- "Why does clicking the label not focus the input?"

If you are about to type `<label`, `<input type="text"`, `<textarea`,
`className={INPUT_FIELD}`, `htmlFor=`, `aria-invalid`, `aria-describedby`,
`const [error, setError] = useState`, `text-red-400` under an input, or
`disabled={!name.trim()}` — you are in this situation.

## The one way

Render every labelled control as `<FormField>` with the **render-prop child**, and
let it own identity, association and error presentation: `FormField` mints a
`useId()`-scoped `id`, hands you `{ id, 'aria-invalid', 'aria-describedby' }`,
wires `htmlFor` to it, and renders the error as `role="alert"` — spread those
props onto whatever control you render inside. Gate error *visibility* with the
default `validateOn="blur"` (never validate on the first keystroke) and flip
`forceValidation` to `true` at submit so every error surfaces at once; on any
form longer than three fields wrap the fields in `<FormErrorProvider>` and put a
`<FormErrorSummary />` at the top so submit produces a jump-to-field banner
instead of an error the user has to scroll for. Derive the submit gate from the
**same** predicate that produces the errors — never from a second, looser
`!x.trim()` expression — and pass `value` + `maxLength` so a length cap exists at
all. Reach for `useFieldValidation` when the rule is a debounced pass/fail on the
value, and `useAsyncFieldValidation` + the `availability` prop when the question
is "is this name already taken". Then stop: no `<label htmlFor>`, no local `id`
string, no `useState` for `touched`, no `text-red-400` paragraph, no local
`Field` / `LabeledInput` / `FormRow` wrapper — the repo already has nineteen of
those and they are the deviation, not the shortcut.

## Mandated primitives

- **`shared/components/forms/FormField.tsx`** — `FormField` + `FormFieldProps` +
  `FormFieldInputProps` + `ValidateOn` + `FieldAvailability`. The canonical
  wrapper (347 lines). Label + required asterisk + `hint` + `helpText` + error +
  availability line + char budget, with the `validateOn` gate at `:158-161`,
  a11y props minted at `:176-180`, error-registry registration at `:187-198`,
  shake-on-error at `:201-214`, and the `role="alert"` error paragraph at
  `:276-284`.
- **`.../forms/useFieldValidation.ts`** — `useFieldValidation({ validate,
  debounceMs = 400, minLength = 1 })` → `{ validationState, error, onChange }`.
  Sequence-guarded against stale async results (`:67`), timer cleared on unmount
  (`:86-90`). Feed `validationState` and `error` straight into `FormField`.
- **`.../forms/useAsyncFieldValidation.ts`** — `useAsyncFieldValidation({ check,
  debounceMs = 350, minLength = 1 })` → `{ status, suggestion, onChange, reset }`.
  `AbortController`-cancelled (`:112-119`), and **fails open** — a thrown check
  resets to `idle` rather than blocking the user (`:128-134`). Ships
  `suggestAlternativeName(base, taken)` at `:151`.
- **`.../forms/FormErrorContext.tsx`** — `FormErrorProvider` + `useFormErrors` +
  `useFormErrorRegistry`. Two contexts on purpose (`:38-39`) so adding an error
  re-renders only the banner, not every field.
- **`.../forms/FormErrorSummary.tsx`** — `role="alert"` banner listing every
  registered error as a button that `scrollIntoView` + `focus({ preventScroll })`
  the offending input (`:27-36`). Fully translated via
  `t.common.form_error_summary_title_{one,other}`.
- **`.../forms/PasswordToggleField.tsx`** — the control to render **inside**
  `FormField` for any secret. Spreads `{...rest}` onto the input (`:99`) so
  `FormField`'s a11y props reach it; adds show/hide plus an 8s auto-remask
  (`:61-78`).
- **`.../forms/FormFieldGroup.tsx`** — collapsible section header with a
  `completionCount/completionTotal` badge, for forms long enough to need
  progressive disclosure.
- **`.../forms/SettingRow.tsx`** — the label+description+toggle row. Use this,
  not a `FormField` wrapping a checkbox.
- **`@/lib/utils/designTokens`** — `INPUT_FIELD` (`:103`), `INPUT_FIELD_ERROR`
  (`:107`), `inputFieldClass(hasError)` (`:111`), `FORM_FIELD_GAP` (`:91`).
  The control's className. `FormField` does **not** apply these for you — see
  Gaps #1.
- **`@/i18n/useTranslation`** — every `label`, `hint`, `helpText`, `placeholder`
  and error message is `t.section.key`. No exceptions.

## Steps

1. **Wrap in `FormField` and use the render-prop form.**
   `<FormField label={t.x.name} required>{(p) => <input {...p} … />}</FormField>`.
   The object form (`children` as a plain node) exists for legacy call sites and
   silently drops the a11y wiring — never start there.
2. **Spread `{...inputProps}` onto the control, first.** Anything you spread
   after it can clobber `id` / `aria-describedby`.
3. **Give the control its className from the tokens** —
   `className={inputFieldClass(!!error)}` for a field that can error,
   `className={INPUT_FIELD}` otherwise. For a textarea append `resize-y` +
   `min-h-*` (see `DailyGoalsModal.tsx:120`). For a secret, render
   `<PasswordToggleField {...p} …/>` instead of `<input>`.
4. **Pick the validation shape.** Pure/synchronous rule → compute `error`
   yourself and pass it. Debounced rule over the value (URL shape, JSON parse,
   length) → `useFieldValidation`, then pass both `validationState` and `error`.
   "Is this taken" → `useAsyncFieldValidation`, then build a `FieldAvailability`
   `{ status, message }` where **you** own the i18n of the message
   (`CreateTeamForm.tsx:79-91` is the reference shape).
5. **Leave `validateOn` at its default `'blur'`.** Set `'change'` only for a
   field the user is actively watching (a password-strength meter). Set
   `'submit'` only on a form of one or two fields.
6. **Thread `forceValidation`.** Hold a `submitted` boolean in the form; set it
   `true` in the submit handler before the guard; pass it to every `FormField`.
   This is what makes "user pressed Create and nothing happened" impossible.
7. **On a form of four or more fields, wrap in `<FormErrorProvider>` and render
   `<FormErrorSummary className="mb-3" />` above the first field.** Zero code
   beyond those two lines — fields register themselves.
8. **Cap the length.** Pass `value` + `maxLength` to `FormField` *and*
   `maxLength` to the control. You get the progressive `120/200` budget meter
   free. Only 9 of the 177 files holding a text field do this today.
9. **Derive the submit gate from the error set, not from a second expression.**
   `const errors = useMemo(() => validate(state), [state])` →
   `disabled={Object.keys(errors).length > 0 || busy}` and pass
   `error={errors.name}` down. One predicate, two consumers.
10. **Translate everything, then run `npm run check:i18n:strict`.** New keys go
    in `src/i18n/locales/en.json` and into all 13 other locales in the same
    commit (`translate-extract` → subagents → `translate-merge`).
11. **Stop.** No `<label>`, no `htmlFor`, no hand-minted DOM id, no `touched`
    state, no `text-red-400` paragraph, no `aria-invalid` you wrote yourself, no
    local `Field` component.

## Anti-patterns

- **`<div><label className="…">{t.x}</label><input className={INPUT_FIELD}/></div>`
  — the repo's dominant idiom and its dominant bug.** A `<label>` that neither
  wraps its control nor carries `htmlFor` is inert: clicking it does nothing, and
  a screen reader reads an unnamed edit box. **120 single-line orphan labels
  across 49 files**; repo-wide 346 `<label>` occurrences against 46 `htmlFor`.
  `FormField`'s render-prop makes this class of bug unrepresentable.
- **Hand-minting a DOM id for `aria-describedby`.** Every hand-rolled error
  association in the repo uses a hardcoded global id —
  `'persona-name-error'` (`PersonaSettingsTab.tsx:113`), `'interval-error'`
  (`TriggerScheduleConfig.tsx:88`), `'composite-conditions-error'`
  (`CompositeConfig.tsx:41`), `'schema-form-error'` (`SchemaFormFields.tsx:54`).
  Two instances of the surface on screen → duplicate ids → the wrong field is
  described. `useId()` exists precisely for this and `FormField` already calls it.
- **Building a local field wrapper.** Nineteen exist (table below). The worst is
  `plugins/research-lab/shared/FormField.tsx` — a **file with the same name as
  the primitive**, exporting `Field`/`TextField`/`TextAreaField`/`SelectField`
  with **no `error` prop anywhere in the module**, consumed by 7 research-lab
  forms that are therefore structurally incapable of showing a field error.
- **Validating on every keystroke.** `PersonaSettingsTab.tsx:107` computes
  `aria-invalid={draft.name.trim() === ''}` per render, so the field goes red the
  instant the user selects-all-and-retypes. `FieldCaptureRow.tsx:63` recomputes a
  border glow per keystroke. This is the combative-form failure mode
  `validateOn: 'blur'` was written to prevent — and **zero call sites pass
  `validateOn` or `forceValidation`**.
- **The opposite: no validation until the IPC fails.** `CreateTriggerForm.tsx:138`
  gates only on `!createPersonaId`; a malformed cron reaches the backend and
  returns as an English toast built at `:38`. `WebhookSubscriptionsPanel.tsx:179`
  accepts any non-empty string as a webhook URL. `GoalEditorModal.tsx:275` has no
  error UI at all. A toast is not field validation: it is unanchored, it doesn't
  say *which* field, and (see below) it is not translated.
- **Two definitions of "valid" in one form.** `CreateApiKeyDialog.tsx:228` gates
  on `!name.trim() || totalScopeCount === 0` while `handleSubmit:80` enforces an
  extra rule — the button is enabled and the click fails.
  `AddKpiModal.tsx:129` vs `:134` gate the manual and AI paths on different
  predicates for the same form.
- **An error paragraph parked at the bottom of the modal.**
  `CreateApiKeyDialog.tsx:211`, `AddKpiModal.tsx:121`. No `role="alert"`, no
  `aria-invalid`, not adjacent to the cause. This is exactly what
  `FormErrorProvider` + `FormErrorSummary` render correctly — and they have
  **zero adopters**.
- **`error` as a boolean that only tints a border.**
  `RecipeAdoptionModal.tsx:270`, `ChannelsAtelier.tsx:381`. The user sees that
  something is wrong and never learns what.
- **Re-declaring the input class string.** `INPUT_FIELD` is imported by 41
  files; at least four more re-type it —
  `research-lab/shared/FormField.tsx:3` (`FIELD_CLASS`, `rounded-card`),
  `addKpiPrimitives.tsx:30` (`INPUT`, `rounded-xl`),
  `FieldCaptureRow.tsx:127` (inline, `rounded-modal`),
  `templates/…/QuickAddCredentialModal.tsx:354`. Four different input radii ship
  today.
- **Hardcoded English in a validation message.** `EditFormFields.tsx:58,64,67`
  builds `` `${field.label} is required` `` while
  `t.vault.credential_forms.name_required = "{label} is required"` **already
  exists** and is used 40 lines away in a sibling file. `PersonaSettingsTab.tsx:113`
  ships `Name is required` behind an explicit
  `// eslint-disable-next-line custom/no-hardcoded-jsx-text`.
- **Shadowing a shared export.** `EditFormFields.tsx:54` exports a hook named
  `useFieldValidation` with a different contract from
  `shared/components/forms/useFieldValidation.ts`. An import auto-complete
  collision waiting to happen.
- **Putting the hint inside the `<label>`.** `WebhookSubscriptionsPanel.tsx:317`,
  `:330` — the accessible name becomes the label plus the entire hint sentence.
- **Reaching for a `<form onSubmit>` — or rather, not.** Only **5 files** in
  `src/features/**` contain `<form`. Everything else is a button with `onClick`,
  so Enter does not submit and native `required` never fires. Keep the
  button-driven shape (it is the house style) but that is exactly why
  `forceValidation` has to be threaded manually.

## Evidence

**Adoption: 4 non-test files import `FormField`, rendering 8 fields total** —
against 177 files containing a text-type input and 119 containing a `<textarea>`.
Every other form primitive is worse: `FormErrorProvider`/`FormErrorSummary`,
`FormFieldGroup`, `useShakeError` and `validateOn`/`forceValidation` have
**zero** adopters outside `shared/components/forms/` and its tests.

- **`teams/sub_teamWorkspace/CreateTeamForm.tsx:98-113` — the ONE site to copy.**
  Render-prop child, `{...inputProps}` spread first, `required`, translated
  label and placeholder, `INPUT_FIELD`, and a fully-wired
  `useAsyncFieldValidation` → `FieldAvailability` with a caller-owned i18n
  message (`:69-91`) and `suggestAlternativeName`. Copy this shape. It is not
  perfect — its submit gate at `:189` and its three hand-rolled label blocks at
  `:127`, `:141`, `:157` are listed as deviations below — but the field itself
  is the reference.
- `agents/sub_deployment/components/cloud/CloudConnectionForm.tsx:83-101` — the
  reference for **blocking** validation: `useFieldValidation` with a translated
  validator (`:42-55`) feeding both `validationState` and `error`. Copy the
  hook wiring; do not copy its submit gate (`:119`), which ignores the error.
- `agents/sub_deployment/components/cloud/CloudConnectionForm.tsx:103-113` — the
  reference for a secret field: `PasswordToggleField` **inside** the render prop,
  receiving `{...inputProps}`.
- `plugins/companion/DailyGoalsModal.tsx:102-129` — the reference for a
  `<textarea>` field and for the char budget (`value` + `maxLength` on both the
  `FormField` and the control), plus a submit predicate (`:75-77`) that is
  genuinely derived from the drafts rather than invented at the button.
- `overview/sub_patterns/graph/CreatePlaybookModal.tsx:90-122` — three fields in
  one modal, `hint` used correctly, `valid` at `:46` computed once and consumed
  once at `:157`.
- `triggers/sub_triggers/configs/buildTriggerConfig.ts:42-95` — the best
  *form-level* validator in the repo: a pure function taking `(state, t)`,
  returning `{ ok: false, error }` with every message from
  `t.triggers.build_validation.*`. This is the right predicate — it is simply
  wired to a banner instead of to fields, which is the `FormErrorProvider` gap.
- `shared/components/forms/FormField.tsx:158-161` — the whole `validateOn`
  doctrine in four lines: an error is only *visible* on change, on force, or
  after first blur.
- `shared/components/forms/useAsyncFieldValidation.ts:128-134` — fail-open
  availability. A network hiccup must never block a save; save-time validation
  stays the backstop.
- `shared/components/forms/__tests__/FormErrorSummary.test.tsx` and
  `__tests__/useAsyncFieldValidation.test.ts` — the only two tests in the forms
  layer. `FormField.tsx` itself and `useFieldValidation.ts` have **none**.

## Deviations found

### P0 — shared-layer defects (fix first; upstream of every call site)

| Path | What's wrong |
|---|---|
| `lib/utils/designTokens.ts:103` | `INPUT_FIELD` uses `rounded-xl` (12px) while `.claude/Design.md:216` and `globals.css:383` declare `--radius-input: 0.5rem` (8px) for "inputs, selects, textareas". `custom/no-raw-radius-classes` exempts `designTokens` by name (`no-raw-radius-classes.cjs:47`), so the token that defines every input in the app is the one file the radius gate cannot see. **Every canonical input in Personas renders at card radius.** |
| `lib/utils/designTokens.ts:107` | `INPUT_FIELD_ERROR` drops `focus-ring` and substitutes `focus-visible:outline-none focus-visible:ring-2` — an errored field gets a box-shadow ring, a valid field gets an `outline` (`globals.css:11-16`). Two focus mechanisms for one control. |
| `lib/utils/designTokens.ts:103` | `INPUT_FIELD` composes `focus-ring` (outline-based) with `focus-visible:ring-offset-1 ring-offset-background` — `ring-offset-*` only affects `ring-*`, so both classes are inert. |
| `forms/FormField.tsx:271` | **`FormField` never applies the error styling to the control.** It knows `effectiveError` and renders the message, but `inputProps` carries no className, so the red border requires the caller to independently call `inputFieldClass(!!error)`. **All 4 adopters pass a plain `INPUT_FIELD` — not one errored field in the repo shows a red border.** `inputFieldClass` has exactly 1 call site repo-wide (`PersonaSettingsTab.tsx:109`). |
| `forms/FormField.tsx:269` | The `hint` paragraph has **no `id`** and is never referenced by `aria-describedby` (`:168-174` chains error → availability → helpText only). Two props do nearly the same job and only one is announced. |
| `forms/CharBudget.tsx:59` | `aria-label={`${value} of ${max} characters used`}` — **hardcoded English inside an `aria-live="polite"` region in a shared primitive**. Every screen-reader announcement of the budget is English in all 14 locales. |
| `forms/ThemedSelect.tsx:147` | In `filterable` mode the trigger `<button>` receives only `aria-label` — no `id`, `aria-describedby`, `aria-invalid`, `aria-expanded`, `aria-haspopup` or `role="combobox"` (grep for those in the file returns nothing outside the native branch at `:255-271`). So `<FormField>{(p) => <ThemedSelect {...p} filterable/>}</FormField>` silently discards the entire a11y contract. |
| `forms/FormField.tsx` · `useFieldValidation.ts` | **No tests.** The `validateOn` gate, the registry lifecycle, the shake, the success-pop and the debounce/sequence guard have zero regression coverage. |
| `shared/components/CATALOG.md:112,116,128` | `DesignInput`, `FormFieldGroup` and `ThemedSelect` have no `@catalog` tag, so the catalog CLAUDE.md mandates consulting describes `ThemedSelect` as *"Extra wrapper classes (width, margin, etc."* — a truncated fragment of an unrelated prop comment. Only 2 of the 34 files in `forms/` carry a `@catalog` tag. |

### Shadow primitives and local field wrappers — 19 files

| Path:line | Component | Defect |
|---|---|---|
| `plugins/research-lab/shared/FormField.tsx:12,35,62,86` | `Field` / `TextField` / `TextAreaField` / `SelectField` | **Same filename as the primitive.** Own `useId`, own `FIELD_CLASS` (`:3`, `rounded-card`, `focus:outline-none`). **No `error` prop in the module** — 7 research-lab forms cannot show a field error. |
| `vault/sub_credentials/components/forms/FieldCaptureRow.tsx:39` | `FieldCaptureRow` | Closest clone (`:73-93` and `:132-136` mirror `FormField.tsx:243-295`). **Derives its DOM id from label text** (`:59`) → collides on duplicate labels, breaks on non-Latin labels. Error `<p>` at `:133` has **no `role="alert"`**. Hardcoded `'Select...'` at `:106`. Inline input class at `:127` with `rounded-modal`. |
| `vault/sub_credentials/components/forms/EditFormFields.tsx:54` | `useFieldValidation` | **Shadows the shared hook's name.** Its three messages (`:58,:64,:67`) are hardcoded English despite `t.vault.credential_forms.name_required` existing. |
| `triggers/sub_triggers/configs/TriggerFieldGroup.tsx:13` | `TriggerFieldGroup` | Label has no `htmlFor` (`:19`); `errorId` (`:9,:25`) is caller-supplied, so the `aria-describedby` wiring is delegated to every call site and forgotten in about half. |
| `vault/sub_catalog/components/schemas/SchemaFormFields.tsx:40` | `SchemaNameField` | Own `useId` but `aria-describedby` points at the hardcoded global `'schema-form-error'` (`:54`) rendered in a *different file* (`CredentialSchemaForm.tsx:229`). |
| `teams/sub_factory/addKpiPrimitives.tsx:30,38` | `INPUT` + `Label` | Fifth copy of the input class (`rounded-xl`); `htmlFor` is **optional** on `Label`, and `AddKpiModal.tsx:66,74,78` omit it. |
| `templates/sub_recipes/components/RecipeAdoptionModal.tsx:257` | `BindingField` | The "label" is a `<span>` (`:260`); `error` is a boolean that only tints (`:270`). Hardcoded `required` badge at `:262`. |
| `plugins/twin/sub_identity/IdentityAtelier.tsx:311` · `sub_tone/ToneConsole.tsx:294` · `sub_channels/ChannelsAtelier.tsx:381` · `sub_channels/ReplyOutbox.tsx:372` | `Field` / `FieldCell` / `FieldGroup` / `Field` | **Four different label wrappers in one plugin.** None has an error slot, an id, or any aria. |
| `agents/sub_lab/use-cases/StructuredField.tsx:16,33` | `StructuredField` | Orphan `<label>` per branch next to `ThemedSelect` / `NumberStepper`; no id, no error. |
| `templates/sub_generated/adoption/QuickAddCredentialModal.tsx:354` | `CredentialField` | Duplicates the vault's own `FieldCaptureRow` for the identical concept. |
| `templates/sub_presets/PresetQuestionnaireForm.tsx:245` · `agents/quick-answer/triage/deck/QuestionPanel.tsx:61` | `QuestionField` ×2 | Two unrelated components with the same name. |
| `agents/sub_new_persona/capabilityView/CapabilityAddModal.tsx:27` · `teams/sub_teamWorkspace/teamStudio/slackBridge/SlackBridgePickers.tsx:9` · `overview/sub_incidents/components/IncidentDetailModal.tsx:353` | `FieldRow` / `Field` / `Field` | Three more one-off wrappers. |
| `plugins/artist/sub_media_studio/toolbar/fields.tsx:11,39` | `NumField` / `RangeField` | Local labelled-numeric wrappers. |

### Orphan labels — 120 occurrences across 49 files

Measured as `<label …>…</label>` opening and closing on one line with no
`htmlFor` — a label that cannot be wrapping its control. **0 of the 120 contain a
control**, so this is a clean set, not a heuristic. Worst files:

| Path | Orphan labels | Note |
|---|---|---|
| `agents/sub_connectors/components/automation/AutomationConditionStep.tsx:61,66,97,111,…` | 8 | Labels styled as section headings; the name input at `:62` has no `id`; `deployError` (`:37`) is rendered nowhere near a field. |
| `settings/sub_appearance/components/CustomThemeCreator.tsx` | 6 | |
| `overview/sub_patterns/CreatePracticeModal.tsx:75,84,93,101,112,124` | 6 | In a `grid-cols-[140px_1fr]`, so the labels are grid *siblings* — no input has an `id`. **Zero error UI**; failures surface only as `toastCatch('workspaces:createPractice')` (`:63`), a raw internal debug string shown to the user. |
| `triggers/sub_studio/system_ops/SystemEventCommitModal.tsx:177,185,…` | 5 | Cron input's only format hint is the hardcoded placeholder `"0 3 * * 1"`; the `!canCreate` gate (`:235`) never checks cron shape. |
| `plugins/dev-tools/sub_overview/OverviewParts.tsx` | 5 | |
| `settings/sub_network/components/ExposureManager.tsx` · `recipes/sub_editor/components/RecipeEditor.tsx` · `overview/sub_memories/components/CreateMemoryForm.tsx` · `agents/sub_settings/components/PersonaSettingsTab.tsx:146,176,194,219` · `agents/sub_lab/use-cases/StructuredField.tsx` · `agents/sub_connectors/components/automation/AutomationTriggerStep.tsx` | 4 each | `PersonaSettingsTab` is the sharpest case — it uses `htmlFor` correctly at `:98`, `:117`, `:129` and then omits it four times in the same component. |
| `vault/sub_credentials/components/features/EventConfigSubPanels.tsx` · `settings/sub_network/components/BundleExportDialog.tsx` · `settings/sub_byom/components/ByomRoutingRules.tsx` · `settings/sub_api_keys/components/CreateApiKeyDialog.tsx:125` | 3 each | `CreateApiKeyDialog`'s hint `<p>` at `:136` is also unlinked. |
| `agents/sub_deployment/components/cloud/CreateTriggerForm.tsx:52,67,99` · `vault/sub_credentials/components/import/ImportSyncConfig.tsx:41,56` · `teams/sub_goals/GoalEditorModal.tsx:189,234` · `templates/draft-editor/DraftIdentityTab.tsx:55,73` · `vault/sub_catalog/components/forms/TemplateFormBody.tsx:100` · `teams/sub_teamWorkspace/CreateTeamForm.tsx:127,141,157` | 2–3 each | `GoalEditorModal` also uses `htmlFor` correctly at `:157`/`:174` in the same file. `CreateTeamForm` — the exemplary site — hand-rolls three of them beside its two `FormField`s. `ImportSyncConfig`'s four provider-specific formats exist only as rotating placeholders (`:47-50`) that vanish on type. |

### Errors that exist but are not wired — 8 `aria-invalid` sites for ~300 inputs

`aria-invalid` appears 18 times in 10 files; `aria-describedby` 17 times in 9.
Two of those files are the primitive and `ColorPicker`.

- `settings/sub_api_keys/components/CreateApiKeyDialog.tsx:211` — error is a
  floating div at the bottom of a scroll area. No `role="alert"`, no
  `aria-invalid`, not adjacent to its cause.
- `teams/sub_factory/AddKpiModal.tsx:121` — the modal's only error surface,
  attached to nothing.
- `triggers/sub_triggers/configs/CompositeConfig.tsx:41` — a hardcoded
  `aria-describedby='composite-conditions-error'` applied to **every row of a
  `.map()`** (`:28`), so N inputs point at one id.
- `triggers/sub_triggers/TriggerScheduleConfig.tsx:88` — error `<p
  id="interval-error">` with no `role="alert"`; the interval input at `:70` has
  no `id` despite the file being one of the 10 that use `aria-invalid`.
- `vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx:111` vs `:180` —
  the "name required" validation error and an arbitrary **IPC failure** write to
  the same state slot, so a backend outage turns the name input `aria-invalid`
  and reads as a name problem.
- `agents/sub_connectors/components/automation/AutomationConditionStep.tsx:37` —
  `deployError` arrives as a prop and is rendered far from any field.
- `plugins/twin/sub_channels/ChannelsAtelier.tsx:381` ·
  `templates/sub_recipes/components/RecipeAdoptionModal.tsx:270` — border tint
  only, no message.
- `overview/sub_patterns/CreatePracticeModal.tsx` · `teams/sub_goals/GoalEditorModal.tsx` —
  no error UI at all in either modal.

### Validation timing — bimodal, and neither mode is the prescribed one

`validateOn` and `forceValidation` have **zero call sites**. Every raw field is
either every-keystroke or nothing-until-the-IPC-fails.

- Every keystroke: `agents/sub_settings/components/PersonaSettingsTab.tsx:107`
  (`aria-invalid` recomputed per render) · `vault/…/FieldCaptureRow.tsx:63`
  (`computeValidationGlow` per keystroke) ·
  `triggers/sub_triggers/configs/CompositeConfig.tsx:37` (error cleared on
  change, *set* by a different component on submit — timing split across a
  component boundary).
- Nothing until failure: `agents/sub_deployment/components/cloud/CreateTriggerForm.tsx:138`
  · `settings/sub_notifications/components/WebhookSubscriptionsPanel.tsx:179`
  (any non-empty string accepted as a webhook URL) ·
  `teams/sub_goals/GoalEditorModal.tsx:275` ·
  `triggers/sub_studio/system_ops/SystemEventCommitModal.tsx:235`.

### Submit gating — 70 `disabled={!x.trim()}` expressions across 65 files

- `settings/sub_api_keys/components/CreateApiKeyDialog.tsx:228` vs `:80` — the
  gate is looser than the handler; the click fails.
- `teams/sub_factory/AddKpiModal.tsx:129` vs `:134` — two predicates, one form.
- `agents/sub_deployment/components/cloud/CloudConnectionForm.tsx:119` — gates on
  `!url.trim() || !apiKey.trim()` and **ignores `urlValidation.error`**, so
  Connect is clickable while the field shows a red URL error. At the repo's
  second-best call site.
- `teams/sub_teamWorkspace/CreateTeamForm.tsx:189` — gates on `!newName.trim()`
  and ignores `nameCheck.status === 'taken'`; the availability line is advisory
  only (defensible, but undocumented — and since no backend uniqueness check
  exists, the duplicate is created).
- `templates/sub_recipes/components/RecipeAdoptionModal.tsx:159` — `disabled={!canAdopt}`
  means the user can never reach the state (`showErrors`) that reveals which
  binding is missing.
- `agents/sub_deployment/components/cloud/CreateTriggerForm.tsx:138` ·
  `teams/sub_goals/GoalEditorModal.tsx:275` — gate on one field, submit N.

### i18n

- Fully-untranslated form surfaces: `teams/sub_factory/AddKpiModal.tsx` (no
  `useTranslation` import at all — "Add a KPI", "Name", "Description", "Unit",
  "Baseline", "Target", "Cancel", "Create KPI" and every placeholder) ·
  `teams/sub_factory/addKpiPrimitives.tsx` ·
  `teams/sub_factory/factoryPrimitives.tsx:234,239,245,315`.
- `triggers/sub_triggers/configs/CompositeConfig.tsx:69` —
  `label={t.triggers.op_all_label ? 'Operator' : 'Operator'}`. A dead ternary
  that reads an i18n key **only as a truthiness probe** and always renders the
  English literal. `:71-74` hardcodes `'ALL (AND)'`, `'All conditions must
  match'`, `'ANY (OR)'`, `'Sequence'`.
- `triggers/sub_triggers/TriggerScheduleConfig.tsx:65,94,106,110` — hardcoded
  English interleaved with `t.triggers.*` inside one sentence
  ("Approximately … run(s)"), so word order is untranslatable.
- `vault/…/EditFormFields.tsx:58,64,67` · `agents/…/PersonaSettingsTab.tsx:113`
  (behind an eslint-disable) · `vault/…/FieldCaptureRow.tsx:106` (`'Select...'`)
  · `templates/…/RecipeAdoptionModal.tsx:262` · `templates/draft-editor/DraftIdentityTab.tsx:17-19,95`
  · `agents/…/CreateTriggerForm.tsx:38,91,149`.
- **`shared/components/forms/CharBudget.tsx:59`** — the only one inside a shared
  primitive, and therefore the only one that is untranslated on *every* correct
  adoption of this path.
- **Six typography tokens are in use on `<label>` elements**: `typo-caption`
  (112), `typo-body` (83), `typo-label` (36), `typo-heading` (15), `typo-code`
  (5), `typo-title` (1). `FormField` uses `typo-heading`; the token literally
  named `typo-label` is used by 36. Migrating to the primitive will visibly
  change 195 labels — see Gaps #6.

### Where the authority actually lives — the backend half nobody can rely on

The leaf is `twoSided: false`, but the client field cannot be prescribed
honestly without this. Verified against `src-tauri/`:

- **A good shared Rust validator exists, in the wrong crate and with thin
  adoption.** `src-tauri/core/src/validation/` (mod 266 lines, persona 569,
  trigger 462, contract 123, chat 101, memory 62), re-exported at
  `src-tauri/src/lib.rs:49`. Only **11 references across 5 repo files**;
  `repos/core/memories.rs:22` re-implements `strip_html_tags` rather than
  importing it.
- **`ValidationError { field, rule, message }` is `#[ts(export)]`
  (`contract.rs:9-19`) and `src/lib/bindings/ValidationError.ts` is committed —
  and imported by zero files in `src/`.** `contract.rs:37-49` throws the
  structure away before it crosses IPC, flattening multi-field errors into one
  `"; "`-joined sentence. `get_validation_rules`
  (`commands/core/validation.rs:11`) exposes the rule catalog over IPC and has
  **zero frontend callers**. The infrastructure for backend-driven field errors
  is fully built and fully unused.
- **For the entities most in need, there is no backend authority at all.**
  `create_credential` (`commands/credentials/crud.rs:35`) validates only the JSON
  shape of the secret blob (`:55`) — `input.name` is cloned at `:68` and inserted
  unchecked. Same for `update_credential` (`:137`),
  `create_external_api_key` (`credentials/external_api_keys.rs:21`),
  `create_knowledge_base` (`credentials/vector_kb.rs:49`), and
  `add_team_member` / `update_team_member` (`teams/teams.rs:106,:128`).
  Personas and triggers validate at the command layer; teams, workspaces,
  projects, playbooks, chat and memories validate at the **repo** layer.
- **The database is not a backstop.** `personas.name` (`db/src/migrations/schema.rs:15`),
  `persona_teams.name` (`:446`), `persona_credentials.name` (`:162`) and
  `dev_projects.name` (`:1103`) are all `TEXT NOT NULL` with **no `UNIQUE`**, and
  SQLite's `NOT NULL` does not reject `''`. There is **no `CHECK(length(name) > 0)`
  anywhere**; the 17 `CHECK` constraints in `schema.rs` are all enum/status
  columns. Uniqueness is imperative in exactly three repos
  (`resources/connectors.rs:115-128`, `dev_tools.rs:7421`,
  `dev_workspaces.rs:3005-3011` — the last being the only one that catches
  `ConstraintViolation` correctly).
- **A backend validation error reaches the user as untranslated English.**
  `AppError::Validation(String)` → `invokeWithTimeout` rethrows unchanged
  (`tauriInvoke.ts:534`) → `toastCatch` (`silentCatch.ts:100-130`) →
  `ToastContainer.tsx:55` calls `classifyErrorFull` → the **untranslated**
  `resolveError` (`errorRegistry.ts:637`). `resolveErrorTranslated`
  (`useTranslatedError.ts:170`) exists and has the matching keys
  (`:139` `name_invalid`, `:141` `prompt_too_large`) but is only called by five
  hand-wired Vault components. Unmatched messages are replaced by
  `GENERIC_FALLBACK` — "Something went wrong." — losing all specificity.
  414 `AppError::Validation(format!` sites exist; `src/i18n/CONTRACT.md:52`
  explicitly requires codes, not sentences.
- Rust strings that leak internals to users:
  `commands/teams/teams.rs:80-82` names a **database column**
  (`dev_projects.team_id`) in user-facing copy;
  `commands/credentials/crud.rs:55` interpolates a raw `serde_json` parser
  message. Neither is translated.
- Rust validation tests: 13 in `validation/trigger.rs:282`, 5 in
  `validation/persona.rs:516`, **0 in `contract.rs` / `chat.rs` / `memory.rs` /
  `mod.rs`**. `contract::check()` — the funnel every domain validator passes
  through, including the multi-error join — is untested.

> **The sentence that changes how you build the client field:** for credentials,
> connectors, external API keys and knowledge bases, the `FormField` you are
> writing is the *only* validation in the product. Treat it as authoritative,
> not cosmetic — and file a backend gap rather than assuming one exists.

## Gaps in the primitive

1. **`FormField` cannot style its own control.** It owns the error state but the
   red border is the caller's job via `inputFieldClass(!!error)` — a coupling
   nobody honours (1 call site repo-wide, and 0 of the 4 `FormField` adopters).
   **Fix:** pass `inputProps.className` (merged, caller-overridable) or expose
   `hasError` in the render-prop payload. This single gap is why an errored
   `FormField` looks identical to a valid one.
2. **No `id` prop.** `useId()` only. A test that wants a stable label→control
   assertion, or a caller that must point an external `aria-controls` at the
   field, has no way in. `FieldCaptureRow` reinvented ids from label text
   partly for this reason.
3. **`FormField` cannot wrap the repo's own select.** `ThemedSelect` in
   `filterable` mode — the mode used by `CreateTeamForm.tsx:142`,
   `CreatePlaybookModal.tsx:138` and most call sites — accepts none of
   `id`/`aria-describedby`/`aria-invalid`. `Listbox` takes a `renderTrigger`
   render-prop with no aria pass-through, and `AccessibleToggle` accepts only
   `label` (as `aria-label`), no `id`. So the prescription "wrap every labelled
   control" currently only holds for `<input>`, `<textarea>`,
   `PasswordToggleField` and native-mode `ThemedSelect`. **Cross-leaf fix** —
   belongs to `dropdown-and-select`, but this path is blocked on it.
4. **`hint` is not announced.** No `id`, absent from the `aria-describedby`
   chain (`:168-174`). And `hint` vs `helpText` is an undocumented distinction
   (above the control vs below it) that call sites get wrong.
5. **No form-level orchestration.** `FormErrorProvider` collects errors but
   nothing owns "the form is valid" — every caller re-derives it at the button,
   which is why the submit-gate divergences above exist. A
   `useFormErrors().length === 0` submit gate is possible today and used by
   nobody; a `useFormValidity()` convenience would make it the obvious path.
6. **The label type ramp is a migration blocker.** `FormField` renders
   `typo-heading`; the corpus uses `typo-caption` (112), `typo-body` (83) and
   `typo-label` (36) far more. Adopting the primitive changes the look of 195
   labels. Either accept a deliberate visual reset, or add a `labelTone` prop —
   but decide, because "the primitive looks wrong here" is currently a rational
   reason not to adopt.
7. **No shared validation-message vocabulary.** `src/i18n/locales/en.json`
   `common` holds 7 form keys (`required`, `field_checking_availability`,
   `field_name_available`, `field_name_taken`,
   `field_name_taken_suggestion`, `form_error_summary_title_{one,other}`) — and
   **no generic `field_required` / `field_invalid_url` / `field_too_long`**.
   So every hand-rolled validator invents its own English string. Adding
   `common.validation.*` and a `t`-taking `validators.ts` (the
   `buildTriggerConfig.ts:42` shape, but per-field) removes the reason those
   strings exist.
8. **`zod ^4.3.6` is a production dependency with one import in `src/`**
   (`shared/components/surface/surfaceSpec.ts`), unrelated to forms. The
   bundle cost is already paid; a schema→`Record<field,error>` adapter feeding
   `FormField` is nearly free. `src/lib/validation/` is *not* form validation —
   it is `credentialCoverage.ts` + `eventPayloads.ts`.
9. **Zero length caps.** `maxLength` appears in 9 of the 177 text-field files.
   `FormField`'s budget meter is opt-in and effectively unused, and there is no
   `CHECK` constraint behind it — an unbounded paste reaches SQLite.
10. **Zero enforcement.** 21 custom ESLint rules exist —
    `custom/enforce-base-modal` for modals, `custom/prefer-status-badge` for
    badges, `custom/prefer-numeric` for numbers — and **none** covers labels,
    fields or validation. `.claude/conventions.json` lists "form field" under
    `reuse.doNotHandRoll` with **no `enforcedBy`**, unlike its modal/typography/
    radius siblings. See below.
11. **Zero tests, on either side of the boundary.** No test for `FormField`, for
    `useFieldValidation`, or for any of the 21 custom ESLint rules
    (`eslint-rules/` contains no `*.test.*`). And `contract::check()` in Rust is
    equally untested.

## The missing gate

Every deviation above shipped under a green `npm run check`. The catalog says
"don't hand-roll a form field", `CLAUDE.md:161` says it, `Design.md:302` says
it, `docs/refactor/shared-component-reuse.md:31` says it, and
`.claude/conventions.json` says it — and there are 4 adopters and 19 shadow
wrappers. Documentation did not hold this line and will not.

**Signal — `custom/require-labelled-control` (the primary rule).**
A `JSXElement` named `label` whose opening and closing tags are on the same line
and which has no `htmlFor` attribute. Measured on the real corpus:
**120 matches across 49 files, of which 0 contain a nested control** — a
single-line `<label>` cannot be wrapping anything, so the false-positive rate is
zero by construction. This is as clean as `role="columnheader"` was for tables.
The autofix-adjacent message names the primitive:
*"A `<label>` with no `htmlFor` names nothing. Use `forms/FormField` with the
render-prop child, which mints the id and wires `htmlFor` / `aria-describedby`
for you."*

**Signal — `custom/no-hand-rolled-field-wrapper` (the secondary rule).**
A module-scope function component whose props include **both** `label: string`
and one of `error` / `helpText` / `hint`, and whose JSX contains a `<label>` or
an `<input>`. Catches all 19 shadow wrappers including
`research-lab/shared/FormField.tsx` and `FieldCaptureRow`, and — the point —
catches the *twentieth* before it lands. A cheaper first cut, if AST work must
be deferred: any file other than `shared/components/forms/FormField.tsx` that
declares a component matching `/^(Form)?Field|LabeledInput|FormRow|InputRow$/`.

**Mechanism.** Two rules in `eslint-rules/`, registered in `eslint.config.js`.
Ship them at **`"error"`, not `"warn"`**. This is load-bearing, but **not for the
reason originally given here** (corrected 2026-08-14): this section cited a
"~10,086-warning baseline" from `CLAUDE.md`, which measurement put at **1,135
warnings in 246 files** — wrong by ~9×. The real reason is stronger and
count-independent: `npm run check` runs `eslint src/` with **no `--max-warnings`**,
so it exits 0 with any number of warnings, and the pre-commit hook runs
`--quiet --max-warnings 99999`, which suppresses warnings before counting them.
**A warn-level rule enforces nothing at either gate by construction.**
Error-level is affordable because both
rules have small, enumerable violation sets. They run on `pre-commit`
(`lefthook.yml` `eslint-staged`, `*.{ts,tsx}`) and in CI via
`npm run check` → `eslint src/`.

**Allowlist — named, finite, and expiring.**
1. `src/features/shared/components/forms/**` — the primitives themselves.
2. `SettingRow.tsx` — a sanctioned sibling (label + toggle, no text control).
3. The 49 orphan-label files and 19 wrapper files, enumerated **by path in the
   rule file** as a migration allowlist, each with a one-line reason. Not a glob.
   The list only ever shrinks; a new file cannot be added without editing the
   rule, which is a reviewable diff.
4. Genuinely wrapping labels (`<label><input/></label>`) are not matched at all —
   they are correct and need no exception.

**How it fails loudly if its own precondition is absent.** This repo has shipped
gates that ran green while checking nothing, and `eslint-rules/` currently has
**12 of the 21 custom rules carry `RuleTester` coverage in `src/test/eslint-rules/customRules.test.ts` (verified: 12 `ruleTester.run` calls, 12 distinct rules); **9 have none**** — so a rule that silently stops matching is
the default outcome, not a hypothetical.

- Add `eslint-rules/__tests__/require-labelled-control.test.mjs` using
  `RuleTester` with the real fixtures (a same-line orphan, a same-line
  `htmlFor` label, a wrapping label, a `FormField` render-prop). If the rule
  stops matching orphans, the test fails — not the lint run.
- Add a **registration assertion**: a Vitest case that imports
  `eslint.config.js` and asserts `rules['custom/require-labelled-control'] ===
  'error'` and `rules['custom/no-hand-rolled-field-wrapper'] === 'error'`. The
  failure mode this repo actually suffers is a rule authored and never wired;
  this catches exactly that.
- Add a **floor assertion**, the piece that makes it loud: a check script
  asserting the allowlist file lists **at most 49 label files and at most 19
  wrapper files**, and that every listed path still exists. If someone deletes a
  file, the entry goes stale and the script fails; if someone widens the
  allowlist to make a build pass, the count fails. A ratchet that only tightens.
- Add the missing **`FormField` unit test** in the same change —
  `validateOn='blur'` hides the error until blur, `forceValidation` reveals it,
  the render-prop child receives `id` + `aria-invalid` + `aria-describedby`, and
  the error paragraph carries `role="alert"`. Without it, the rule can route
  everyone to a primitive whose central behaviour has no coverage.

**What a gate cannot reach, and must be handled as doctrine instead.** Two of
this path's most consequential deviations are invisible to any linter: a submit
gate derived from a *different* predicate than the errors
(`CreateApiKeyDialog.tsx:228`, `CloudConnectionForm.tsx:119`), and a client field
that is the product's only validation because the backend has none
(`create_credential`). The first is a PR-review item — add
*"submit gate and error set come from one predicate"* to the PR self-review list
in `.claude/CLAUDE.md`. The second belongs in the backend's own leaf; the
mechanical half of it **is** gateable and should be filed there: a Rust test
asserting that every `#[tauri::command]` taking a `name: String` calls
`validation::require_non_empty`.


> **Evaluator correction (2026-08-13):** this document originally stated that
> `eslint-rules/` has no tests at all. That is wrong — the suite lives at
> `src/test/eslint-rules/customRules.test.ts`, not in `eslint-rules/__tests__`,
> and covers 12 of the 21 rules. The gate's third assertion still stands: the
> two rules proposed here must ship with fixtures, because 9 rules today have
> none and nothing detects that.
