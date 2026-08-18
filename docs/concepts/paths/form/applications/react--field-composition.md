---
layer: application
subject: form
technique: field-composition
stack: react
---

# FormField — how this repo's React side realizes the field unit

The canonical field composition is `FormField` at
`src/features/shared/components/forms/FormField.tsx` (347 lines). It is the
label + control + hint + error/advisory/budget unit of the technique, and its
central move is the **render-prop child**: the component mints a `useId()`-
scoped id family (`fieldId`/`errorId`/`helpId`/`availId`, `:144-148`) and hands
the control exactly the wiring it needs:

```tsx
<FormField label={t.x.name} required error={errors.name} forceValidation={submitted}>
  {(inputProps) => <input {...inputProps} value={v} onChange={…} className={INPUT_FIELD} />}
</FormField>
```

`inputProps` is `{ id, 'aria-invalid'?, 'aria-describedby'? }` (`:176-180`);
the label carries `htmlFor={fieldId}` (`:250`); the error paragraph renders
with `role="alert"` and `id={errorId}` (`:276-284`). Spread `inputProps`
**first** so later props can't clobber the wiring. The plain-node child form
exists for legacy call sites and silently drops all of this — never start
there.

## The prioritized feedback slot, verbatim

The technique's "one slot with a priority order" is literal code: the feedback
row at `:273-295` renders `effectiveError` **else** the availability line
**else** `helpText`, and `aria-describedby` follows the same chain
(`:168-174`) — error → availability → help. The advisory tier
(`FieldAvailability`, `:15-25`) is visually distinct from the blocking tier
(spinner → emerald check → amber suggestion, in `AvailabilityLine` `:312-347`,
`aria-live="polite"` so outcomes announce without stealing focus).

## Specialized controls, and which keep the contract

- **`PasswordToggleField`** (same folder) is the secret control: spreads
  `{...rest}` onto its input so `FormField`'s wiring reaches it, adds
  reveal/conceal with an 8s auto-remask. Render it *inside* the render prop.
- **`AccessibleToggle`** is a real switch: `role="switch"`, `aria-checked`,
  keyboard activation on Enter/Space, and an `sr-only` on/off state
  (`AccessibleToggle.tsx:39-59`). But it accepts only `aria-label` — no `id`
  — so it cannot sit inside `FormField`'s wiring; `SettingRow` is the
  sanctioned label+toggle row instead.
- **`Listbox`** owns a searchable option list with an `aria-live` result
  count (`Listbox.tsx:185`) and `role="listbox"` (`:206,:219`) — but its
  `renderTrigger` render-prop passes no aria through to the trigger, and
  **`ThemedSelect` in `filterable` mode accepts none of
  `id`/`aria-describedby`/`aria-invalid`**, so wrapping it in `FormField`
  silently discards the contract. This is the primitive-boundary gap the
  legacy census filed as its Gap #3.
- **`KeyValueEditor`** is the structured-collection control (JSON object ⇄
  rows, with a lossy-round-trip guard via `lastEmittedRef`,
  `KeyValueEditor.tsx:58-71`). It deviates from the technique on row
  identity: rows are addressed and updated **by array index**
  (`updateRow`/`removeRow`, `:80-91`), the positional identity the standard
  bans for collections that support remove.

## Adoption reality (measured, 2026-08-13 census)

The primitive is correct and almost unused: **4 non-test adopters rendering 8
fields**, against 177 files holding a text input — and **19 local field
wrappers**, the worst being `src/features/plugins/research-lab/shared/FormField.tsx`,
a file with the *same name* as the primitive and **no error prop in the
module**. 120 single-line orphan `<label>`s (no `htmlFor`, wrapping nothing)
across 49 files are the dominant idiom the render-prop makes unrepresentable.
Full tables in `docs/concepts/golden-paths/form-field-and-validation.md`.

## Known shortfalls against the standard (kept, not hidden)

- **The control never shows its error.** `FormField` renders the message but
  passes no className into `inputProps`, and `inputFieldClass(!!error)` has
  one call site repo-wide — so not one errored field in the app draws a red
  border. The unit knows; the control doesn't say.
- **`hint` is unannounced**: rendered at `:269` with no `id`, absent from the
  described-by chain — two guidance props, only one reaches assistive tech.
- **No `id` prop**: `useId()` only, so nothing external can point
  `aria-controls` (or a test) at the field deterministically.
- **`CharBudget.tsx:59`** hardcodes English inside an `aria-live` region — the
  one untranslated string that ships on every *correct* adoption.
