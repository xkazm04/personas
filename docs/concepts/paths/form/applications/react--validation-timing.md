---
layer: application
subject: form
technique: validation-timing
stack: react
---

# validateOn + the two validation hooks — timing policy in this repo

The technique's whole schedule is implemented in three shared pieces under
`src/features/shared/components/forms/`, plus one heavy consumer that shows
the submit backstop done by hand.

## The visibility gate: `validateOn` / `forceValidation`

`FormField.tsx` gates error *visibility*, not error *computation*
(`ValidateOn`, `:34-46`; the gate itself, `:158-161`):

```ts
const errorVisible =
  !!error &&
  (validateOn === 'change' || forceValidation || (validateOn === 'blur' && hasInteracted));
```

- Default is `'blur'` — no negative feedback on a pristine field. The
  `hasInteracted` bit is set only when focus leaves the *whole* field wrapper
  (`:231-237` checks `relatedTarget` containment, so tabbing from the input
  to its adornment button does not count as blur) — a real implementation of
  "the settling point is leaving the field", including the composite-control
  subtlety.
- After first blur the gate behaves like `'change'`: the error clears on the
  keystroke that fixes it — reward-early-punish-late in four lines.
- `forceValidation` is the submit backstop's lever: the parent flips it true
  on a submit attempt and every gated error surfaces at once.

## Debounced local rules: `useFieldValidation.ts`

`{ validate, debounceMs = 400 }` → `{ validationState, error, onChange }`.
The stale-answer guard is a monotonic sequence: each fired validation takes
`++seqRef.current` and a result is dropped unless `seq === seqRef.current`
(`:63-67`) — the technique's "pin the result to the value asked about",
implemented as last-writer-wins. State enters `'validating'` immediately on
the keystroke (`:59`), so the spinner is steady across a burst of typing.

## Async availability: `useAsyncFieldValidation.ts`

The advisory tier (`idle | checking | available | taken`), deliberately
distinct from the blocking `ValidationState`:

- Debounce 350ms; below `minLength` resets to `idle` — don't ask about
  values the local rules already reject.
- Supersession is an `AbortController` per keystroke (`cancelPending`,
  `:80-89`; the check receives the signal, `:112-119`) — stronger than a
  sequence stamp because in-flight IPC/network work is actually cancelled,
  not just ignored.
- Every keystroke re-enters `checking` rather than bouncing through `idle`
  (`:109`, and the doc comment at `:53-56` states it as intent) — the
  no-flicker rule the technique adopted upward from this file.
- **Fail-open** (`:128-134`): a thrown check resets to `idle` so a network
  hiccup never blocks the user; save-time validation stays the backstop.
  This honors "advisory at the edge, enforced at the center" — but note it
  renders could-not-check as *nothing* rather than as "couldn't verify",
  a silent variant the technique asks to be one notch louder.
- `suggestAlternativeName(base, taken)` (`:151-160`) feeds the amber "try X"
  suggestion line.

Reference consumer: `src/features/teams/sub_teamWorkspace/CreateTeamForm.tsx:69-91`
builds the `FieldAvailability` with caller-owned translated messages.

## The submit backstop, by hand: `CredentialEditForm.tsx`

`src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx`
implements the composite policy without `FormField`'s gate: a `touched` map,
blur validates and marks touched (`:114-125`), change revalidates **only if
already touched** (`:101-111`), and submit runs `validateAll` over the full
set while force-touching every field (`validate()`, `:127-132`) before
`onSave`/`onHealthcheck`/`onOAuthConsent` may proceed (`:134-136`). That is
the technique's table, hand-rolled correctly — and also a private copy of it
(its sibling `EditFormFields.tsx:54` even exports a hook that *shadows the
shared hook's name* with a different contract, plus hardcoded English
messages at `:58,:64,:67`).

## Deviations on file (measured, 2026-08-13 census)

- **`validateOn` and `forceValidation` have zero call sites outside the
  primitive's own folder.** The wild corpus is bimodal — every-keystroke red
  (`PersonaSettingsTab.tsx:107` recomputes `aria-invalid` per render) or
  nothing-until-the-backend-toast (`CreateTriggerForm.tsx:138`,
  `WebhookSubscriptionsPanel.tsx:179`) — the two failure modes the policy
  exists to prevent, at 100% market share.
- **Submit gates diverge from the error predicate** in ~70
  `disabled={!x.trim()}` sites; `CloudConnectionForm.tsx:119` gates Connect
  while ignoring the very `urlValidation.error` its field displays.
- `CreateTeamForm.tsx:189` submits regardless of `status === 'taken'` —
  defensible as "advisory tier stays advisory," except no backend uniqueness
  check exists, so the duplicate is simply created (the "enforced at the
  center" half is missing; filed against the backend, not this form).

Full census: `docs/concepts/golden-paths/form-field-and-validation.md`.
