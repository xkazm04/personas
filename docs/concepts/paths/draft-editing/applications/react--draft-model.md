---
layer: application
subject: draft-editing
technique: draft-model
stack: react
---

# Draft model — React persona editor

The reference manifestation is the persona editor's draft stack:
`src/features/agents/sub_editor/libs/PersonaDraft.ts` (the buffer type and
its field semantics), `hooks/useEditorDraft.ts` (construction, patch door,
lifecycle), and `src/api/agents/personas.ts` (the apply side's operation
union). It is the surface the legacy census called "the only surface in
the repo that gets all five halves right" — and the one that had the
incidents; the fix comments are still in place.

## Construction as explicit projection

`buildDraft(persona)` (`PersonaDraft.ts:81-134`) is the projection
function: it fills defaults (`persona.timeout_ms ?? DEFAULT_PERSONA_TIMEOUT_MS`,
`persona.color || DEFAULT_PERSONA_COLOR`), migrates the storage shape into
the edit shape (the persisted `model_profile` JSON blob is parsed into
flat editable fields — `selectedModel`, `baseUrl`, `promptCachePolicy`),
and returns a flat, scalar `PersonaDraft` deliberately unlike the wire
type. Edit shape ≠ storage shape, held apart on purpose.

The corrupt-source rule is implemented exactly as the technique
prescribes: when `model_profile` fails to parse, `buildDraft` falls back
to defaults for display, and `checkModelProfileIntegrity`
(`PersonaDraft.ts:146-160`) drives `suppressModelSave` in
`useEditorDraft.ts:34-43` — the debounced autosave for `MODEL_KEYS` is
paused so the reset defaults cannot clobber the still-recoverable raw
JSON, and a banner tells the user to re-select a model to unblock. The
warning comment at `PersonaDraft.ts:100-109` names the failure this
prevents.

## Baseline, patch door, identity

`useEditorDraft.ts:17-28` seeds both copies (`useState(() => buildDraft…)`
plus `baseline`) and exposes the single patch door:

```ts
const patch = useCallback((updates: Partial<PersonaDraft>) => {
  setDraft((prev) => ({ ...prev, ...updates }));
}, []);
```

Note it *replaces* the draft object — the value-snapshot precondition the
save-group's in-flight comparison depends on.

The reseed effect (`useEditorDraft.ts:67-88`) is identity-guarded:
`if (selectedPersona.id === prevPersonaIdRef.current) return;`. The
comment documents the incident that earned the guard — the store replaces
the persona object after every autosave round-trip, and an object-keyed
reseed "wiped the undo history (Ctrl+Z dead across autosaves) and
clobbered keystrokes typed since the save snapshot". Switching personas
constructs a fresh draft and clears history; it never rebases the buffer.
Cross-entity bleed is further blocked by `capturePersonaToken` in
`useEditorSave.ts:117-157`, which tags undo entries with the persona id
at capture time and re-checks `isStillCurrent()` after every await.

## Apply as intent-derived diff

Call sites never author payloads. `PersonaOperation`
(`api/agents/personas.ts:320-330`) is a discriminated union of intents —
`UpdateSettings`, `SwitchModel`, … — each carrying only the fields that
intent touches; `operationToPartial` (`:333`) and `buildUpdateInput`
(`:415`) derive the wire payload, and `PersonaUpdatePayload` (`:377-395`)
is the one type in the repo that distinguishes skip-`null` from
clear-`null`. The result, measured by the legacy census: 13 clearable
fields, ~39 call sites, **zero** blank-filled-payload deviations on this
surface — while the surfaces that let call sites build payloads by hand
(credentials, triggers) carried all seven data-loss sites
(`docs/concepts/golden-paths/entity-draft-editing.md` §7).

The clean-marking side lives in `useEditorSave.ts:159-189`: each
`perform*Save` advances the baseline only after the IPC call resolves,
only for its own key group (`pickKeys(d, SETTINGS_KEYS)`), and bails
without touching state if the selected persona changed during the await.

## Known gaps (documented, not silently diverged)

- `draftChanged` (`PersonaDraft.ts:73-79`) compares with `!==` — reference
  equality per key. It is correct only because `PersonaDraft` is flat and
  scalar; that precondition is undocumented at the definition (legacy
  census §8 gap 4).
- Nothing generic exists: `useEditorDraft` is welded to
  `useAgentStore.selectedPersona`, so the other ~18 entity drafts in the
  repo re-derive the pattern by hand — adoption, not invention, is the
  standing failure mode.
