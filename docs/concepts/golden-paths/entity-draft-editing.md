# Golden path — Entity draft editing

> Situation node: `client-runtime/mutations-and-editing/entity-draft-editing` ·
> [situation spine](../situation-spine.md) · recurrence **27** · risk high ·
> dimensions **function · resilience · ui · code-quality** · sides **client**.
> Composed 2026-08-15 from a ground-truth sweep against `master`.
>
> **Sweep size.** All **15** `Update*Input` bindings in `src/lib/bindings/` parsed and every one of
> their **125 fields** classified by requiredness and by nullability depth — twice, by two independent
> implementations that reconcile exactly. All **40** production call sites of the 13 entity-update API
> functions enumerated by AST walk and classified (inline literal / hoisted payload). All **4,829**
> `.ts`/`.tsx` files walked by the census engine. The three client spellings of one column
> (`persona_credentials.metadata`) and the four client spellings of one column
> (`persona_triggers.next_trigger_at`) were **replayed verbatim in node** against a **read-only copy of
> the live database** (347 MB, 244 tables, 25 credentials, 351 triggers) — the loss numbers in §7 are
> executed, not argued. Plus **55** draft-reseed effects hand-classified, **17** dirty-flag
> computations, **3** navigate-away protections and **3** persisted drafts. **No `cargo` was run** —
> every Rust claim is static and traceable to a file read during composition.
>
> **A convergence sweep** ran read-only against all five siblings — `brainiac` (Rust + Next console),
> `personas-cloud` (TS, headless — the server personas-web calls), `personas-web` (Next + Supabase),
> `vibeman` (Next + Tauri + better-sqlite3) and `ascent` (Next + Prisma). All five exist and all five
> were swept. It **split this path's subject in three**: the diff-not-record prescription was
> independently reinvented in **4 of 5** by four different mechanisms (physics); the required-field
> trap was independently fallen into in **2 of 5** with documented data loss (physics, and it
> correlates with something this document did not expect); and the navigate-away guard has **zero
> trace in any of the five** (house convention — labelled as such in §2). Every load-bearing sibling
> claim is cited at `file:line` in §6.
>
> **This document reports a measurement that failed.** The live database was queried expecting to
> confirm the trigger defect and **could not**, for a reason that turned out to be the most important
> finding here. See the box in §7.
>
> The **Deviations** section is a fix backlog and contains **two live, shipped, data-destroying
> defect families across 7 call sites**, neither previously known.

## Scope — what this path owns, and the seam with `partial-update-semantics`

[partial-update-semantics](./partial-update-semantics.md) owns the **wire and SQL shape** of a partial
update: whether a field is `Option<T>` or `Option<Option<T>>`, whether it carries `double_option`,
whether the `SET` clause can bind NULL. That path is correct and its conclusions are load-bearing
inputs here; this document re-verified its central mechanism (`serde_util.rs:24-30`,
`macros.rs:45-51`) rather than citing it from memory.

**This path owns the client half: the draft.** The in-memory copy of an entity between "loaded" and
"saved" — how it is seeded, how it knows it is dirty, what happens when the entity changes underneath
it, and **which keys the client decides to put on the wire.** The sibling asks *what does `null` mean
in this slot*; this one asks *why is the client naming that slot at all.*

The seam is real and the measurement proves it: the backend's three-state mechanism is applied
correctly **39 times** across 8 structs, and every defect in §7 is a client that filled in a blank.
**Not one of them is a backend bug.**

**Not this path:** the generated type's flattening of `Option<Option<T>>` to `T | null | null` is
[partial-update-semantics](./partial-update-semantics.md) §7. Whether the write reports that the row
existed is [repository-crud-surface](./repository-crud-surface.md). Whether a stale response
overwrites a newer one is [stale-response-guard](./stale-response-guard.md). Where the draft's
*form controls* come from is [form-field-and-validation](./form-field-and-validation.md).

## 1 Trigger

- "I only changed the name and it wiped everything else"
- "How do I build the payload for this save?" / "what do I pass for the fields I'm not changing?"
- "The form reset itself while I was typing" / "my edits disappeared when it refreshed"
- "Does anything warn me if I navigate away with unsaved changes?"
- "Two tabs edited the same thing — who wins?"
- "The save failed and I lost ten minutes of work"

If you are about to type `const [x, setX] = useState(entity.field)`, a `useEffect` that calls
`setX(entity.field)`, an object literal handed to an `update*(…)` call, or the words *dirty*,
*draft*, *baseline* or *unsaved* — you are in this situation.

## 2 The one way

**Hold two copies — `draft` and `baseline` — seed both from the entity exactly once per entity
identity, and send the DIFF, never the draft.** The baseline is the entity as it was when you loaded
it; the draft is the baseline plus the user's edits; the payload is the set of keys where they
differ, and nothing else. Seed with `useState(() => build(entity))` and reseed only inside a `useEffect`
whose body short-circuits unless the **identity** changed (`prevIdRef.current !== entity.id`) or the
field is untouched — an effect keyed on the entity *object* re-runs on every background refetch and
overwrites what the user is typing, which is the single most common defect in this leaf (**38 of 55**
reseed effects in this repo, §7). Compute `isDirty` from `draft ≠ baseline`, never from a boolean
that every `onChange` sets, and hand that flag to `useUnsavedGuard` so navigation and window-close
are intercepted — **that last clause is a house convention, not doctrine: no sibling repo has any
navigate-away guard for an entity draft at all** (§6). On save, build the payload by **omitting**
every key you are not changing — omission
is the only spelling of "leave alone" that survives the IPC boundary — then advance `baseline` to the
saved value and leave `draft` alone. On failure, change nothing: keep the draft, keep the dirty flag,
surface the real error. Then stop: the entity is the server's, the draft is the user's, and the only
thing that crosses between them is a diff.

**Never hand an update API an object literal that names a field the user did not edit.** The
generated `Update*Input` types make this *feel* mandatory — **114 of 125 fields are required** — and
that feeling is exactly the trap: for the **39** fields that carry `double_option`, the `null` you
type to satisfy the compiler means **CLEAR THIS COLUMN**. Widen the API signature instead (§"Prefer a
type over a gate").

### The two failure modes, and why fixing one does not fix the other

A client that will not send a diff has only two ways to build a payload, and **both lose data**:

| | **Mode A — fill in the blanks** | **Mode B — read-modify-write** |
|---|---|---|
| Shape | name every field; put `null` in the ones you aren't changing | read the current value, merge your change, send the whole thing back |
| Why it happens | the generated type requires every field | the field is a JSON blob and you only want one key of it |
| Failure | `null` on a `double_option` field is **clear**, not skip — the column is erased | the value you read is the client's copy, which is **older than the server's** — every write that landed in between is erased |
| Detected by | a type change (`Partial<>`, `?:`) makes it a compile error | **nothing** — it is type-correct, lint-clean, and looks careful |
| In this repo | 7 call sites, §7 P0-1 and P0-2 | 2 call sites, §7 P1-1 — **and the `Partial<>` fix does not touch them** |

**This is the load-bearing result of this document.** The campaign's two previously-known defects
(`AutomationsSection`, `TeamWorkspacePane`) were both Mode A, both fixed by widening to
`Partial<Update*Input>`. That fix is correct and should be finished. But it is **not** the answer to
this leaf, because Mode B survives it untouched — verified by replay, below. The answer is to stop
letting call sites author payloads at all.

## 3 Mandated primitives

All of these exist in this repo today. None needs to be built.

| Primitive | What it gives you |
|---|---|
| `features/agents/sub_editor/hooks/useEditorDraft` | the reference draft/baseline pair, with the identity-guarded reseed (`:67-88`) and a comment naming the bug it fixes |
| `features/agents/sub_editor/libs/PersonaDraft` → `draftChanged(draft, baseline, keys)` (`:73-79`) | dirty as a **derived** value: `keys.some(k => draft[k] !== baseline[k])` |
| `features/agents/sub_editor/libs/EditorDocument` → `useEditorDirty(tab, isDirty, save)` (`:294`) | an aggregator so a multi-tab editor has ONE dirty flag, read via `useSyncExternalStore` (`:349`) |
| `hooks/utility/interaction/useUnsavedGuard` | `beforeunload` + sidebar-nav interception + Save/Discard/Stay resolution. **The only unsaved-data guard in the app** |
| `features/shared/components/overlays/UnsavedChangesModal` | the modal that guard resolves through |
| `api/agents/personas` → `PersonaOperation` (`:320-330`), `operationToPartial` (`:333`), `buildUpdateInput` (`:415`) | the payload builder you must copy: a **discriminated union of intents**, each variant carrying only the fields that intent touches |
| `api/vault/credentials` → `patchCredentialMetadata` (`:29-30`) → `repo::patch_metadata_atomic` (`credentials.rs:743-759`) | server-side merge of a JSON blob inside a transaction — the correct answer to Mode B, already exposed to the client |
| `features/vault/.../forms/CredentialEditForm` (`:84-94`) | per-field reseed guard via `editedFieldsRef` — reseeds only fields the user has not touched |
| `features/shared/components/display/InlineEditableText` (`:79-82`) | the two-line version of the same idea: `if (!editing) setDraft(value)` |

## 4 Steps

1. **Seed both copies once.** `const [draft, setDraft] = useState(() => build(entity))` and
   `const [baseline, setBaseline] = useState(draft)`. A lazy initializer, not `useState(build(entity))`.
2. **Guard the reseed.** If you need a reseed effect at all, make its body short-circuit:
   `if (entity.id === prevIdRef.current) return;`. Keying the dep array on `[entity.id]` is second
   best (7 sites do this); keying on `[entity]` or `[entity.field]` is the defect (38 sites).
   If the entity can update *while the user edits a different field*, use the per-field guard
   (`CredentialEditForm:84-94`) instead of an identity guard.
3. **Derive dirty; never store it.** `draftChanged(draft, baseline, KEYS)`. A boolean set by every
   `onChange` cannot un-dirty itself when the user types a value back, and it survives a reseed that
   silently reverted the edit — `IdentityAtelier.tsx:42` does both at once.
4. **Wire the guard.** `const guard = useUnsavedGuard(isDirty, { onSave, onDiscard })` and render
   `<UnsavedChangesModal isOpen={guard.isOpen} onAction={guard.resolve} />`. Two lines. **Only two
   surfaces in the app do this.**
5. **Build the payload as a diff, and do not write it by hand.** Define an operation union for the
   entity (`PersonaOperation` is the template) and a single `operationToPartial` that maps each intent
   to its keys. The save handler picks an intent; it never names a field.
6. **If the column is a JSON blob, do not merge it on the client.** Send the patch and let the
   server merge inside a transaction — `patchCredentialMetadata` for credentials. A client-side
   `{...parsed, myKey}` round-trip erases every key written since your last load.
7. **Advance the baseline only on success**, to the value the server returned — not to the draft.
   The server may normalise, and the next diff must be against what is actually stored.
8. **On failure, touch nothing.** No reset, no close, no navigate. Surface the resolved error.
   `RecipeEditor.tsx:118-131` goes one better and copies the serialized draft to the clipboard.
9. **And then stop.** Do not add a debounce, a retry, or an autosave until the diff is correct —
   an autosave over a full-object payload multiplies the blast radius by its frequency.

## 5 Anti-patterns

- **`{ name: trimmed, serviceType: null, encryptedData: null, iv: null, metadata: null, … }`** —
  filling the required fields with `null` to satisfy the compiler. *Failure:* the `double_option`
  fields read `null` as **clear**. This is the shape of every P0 in §7 and it is what a type-correct
  developer writes when the type lies. 7 live sites.
- **A `useEffect` that reseeds state from an entity object.** *Failure:* the store replaces the object
  after every save round-trip and after every background refetch, so the effect fires and overwrites
  the characters typed since. 38 sites; `useEditorDraft.ts:73-77` documents the exact symptom it
  cost ("Ctrl+Z dead across autosaves … clobbered keystrokes typed since the save snapshot").
- **`{...JSON.parse(entity.blob), myKey: value}` sent back as the whole blob.** *Failure:* a lost
  update. Not a race you can shrink — the client's copy is as old as its last fetch, and background
  engines write this column continuously. Measured loss: **3 of 18 keys** (§7 P1-1).
- **`const [isDirty, setIsDirty] = useState(false)` set true by every handler.** *Failure:* it cannot
  detect that the user typed the original value back, and a reseed that reverts the draft leaves it
  stuck true — or, worse, the reseed clears it (`IdentityAtelier.tsx:42`) and the guard stops guarding
  while the edits are gone.
- **`Record<string, unknown>` as an update signature.** *Failure:* it deletes the type question rather
  than answering it. `triggerSlice.ts:116` does this and then hardcodes `next_trigger_at: null` on
  line 156, which is P0-2.
- **Trusting a comment over the deserializer.** Four comments in this tree assert that `null` means
  "do not change" on fields where it means clear. *Failure:* prose does not deserialize. Read the
  struct.
- **Closing a modal on a dirty draft with no prompt.** *Failure:* `BaseModal`'s Escape (`:201`) and
  backdrop (`:283`) both call `onClose()` unconditionally; there is no `canClose` hook. Every draft
  inside a modal is one stray Escape from gone.
- **Persisting a draft with no invalidation.** *Failure:* `trigger_studio_draft_v1` validates only
  `version === 1`; a link to a deleted persona degrades to the string `'Unknown persona'`
  (`studioDraftModel.ts:90`) and is never pruned.

## 6 Evidence

**Copy this one:** `src/features/agents/sub_editor/hooks/useEditorDraft.ts` together with
`libs/useEditorSave.ts` and `libs/PersonaDraft.ts`. It is the only surface in the repo that gets all
five halves right — two copies (`:20-21`), identity-guarded reseed (`:67-88`), derived dirty
(`useEditorSave.ts:104-105`), an intent union rather than a field bag
(`api/agents/personas.ts:320-333`), and failure-preserves-draft (`useEditorSave.ts` bails before
touching `setDraft`/`setBaseline`). It is also the surface that **had the incident** — the fix comments
are still in place — which is why it is worth copying rather than admiring.

Other sites worth reading, each for one thing:

| Site | What it gets right |
|---|---|
| `src/api/agents/personas.ts:377-395` | `PersonaUpdatePayload = Omit<T, Nullable> & Partial<Pick<T, Nullable>>` — the only type in the repo that says which `null`s are dangerous |
| `src/api/agents/personas.ts:398-415` | `buildUpdateInput`'s doc comment is the best written account of this defect in the tree, including why the meaning of every `null` *silently inverted* when `double_option` was introduced |
| `src/features/vault/.../forms/CredentialEditForm.tsx:84-94` | per-field reseed guard — the strongest of the three guard techniques |
| `src/features/recipes/sub_editor/components/RecipeEditor.tsx:118-131` | save-failure handling: real error message + draft to clipboard, with the rationale in the comment |
| `src/features/vault/shared/hooks/health/useCredentialHealth.ts:183` | the **only** client that patches a JSON blob through the server-side atomic merge instead of round-tripping it |
| `src/api/recipes/recipes.ts:102-121` | the **only** optimistic-lock token sent from the client (`expectedUpdatedAt`), with the rationale written down |
| `src/features/teams/.../TeamWorkspacePane.tsx:119-145` | the post-incident conditional-spread diff, and a comment that corrects two earlier wrong comments |

### Convergence — what five sibling repos independently did

Read-only sweep of `brainiac`, `personas-cloud`, `personas-web`, `vibeman`, `ascent`. All five exist;
none was modified. **Which clauses of §2 are physics and which are local taste:**

**PHYSICS — send a diff, not a record. Independently reinvented in 4 of 5, by four unrelated
mechanisms, with no shared document between them.**

| Repo | Mechanism |
|---|---|
| `brainiac` | `StandardUpdateRequest` is 6 fields, **all `Option<String>`** (`crates/brainiac-server/src/library.rs:969-984`), and the console computes the diff client-side in a dedicated `editablePatch()` (`console/app/console/modules/standards/triage.ts:37-55`) |
| `personas-cloud` | `PersonaUpdateSchema` is 15 fields, **all `.optional()`**, plus **`.strict()`** (`packages/orchestrator/src/schemas.ts:124-140`) — so a client POSTing back the entity it just loaded gets a **400**, because `id`/`createdAt`/`updatedAt` aren't in the schema |
| `vibeman` | a `value !== undefined` filter in the SQL `SET` builder (`src/app/db/repositories/repository.utils.ts:158`) |
| `ascent` | `Partial<Pick<…>>` on two surfaces (`src/lib/db/org-skills.ts:178`, `BacklogItemRow.tsx:71`) |

**`personas-cloud`'s `.strict()` is the strongest answer found anywhere**, and it is a *type* answer,
not a gate: it makes the full-entity payload structurally impossible rather than merely discouraged.
It is the cross-repo evidence for this document's "Prefer a type over a gate" conclusion.

`brainiac`'s motivation is worth stealing and is one nobody here articulated: it sends minimal patches
because *"the backend mints a revision for a wording change, so re-submitting identical prose would
inflate the rule's history with revisions that revised nothing."* Audit-history pollution, not
payload size. It also splits the two types on purpose — `RuleDraft` has three **required** strings
(the form always renders three controls) while the wire type `StandardUpdate` is all-optional
(`triage.ts:22-26`). **Draft shape ≠ patch shape**, held apart deliberately. That is exactly the
distinction the 15 `Update*Input` types here collapse.

**PHYSICS — the required-field trap. Independently fallen into in 2 of 5, with documented casualties.**
`ascent`'s `OrgBranding` (`src/lib/db/branding.ts:10-14`) makes three fields required, the route
coerces absent → `null` (`api/org/branding/route.ts:38-42`), and the repo's own audit records the
symptom: *"Orgs get silently pinned to `#2563eb`."* Its `OrgLlmConfigInput` (`org-llm.ts:30-45`) does
it again — omitting `provider` **resets it to `"bedrock"`**. `personas-web`'s
`updateEvent(id, { status, metadata? })` (`src/lib/api.ts:230-237`) makes `status` required 50 lines
above an all-optional `updateSubscription` (`:280-288`) that gets it right.

> **The correlation the sweep found, which this document did not predict: the trap appears where the
> entity feels like "a form" and not like "a record."** Every instance — `OrgBranding`,
> `OrgLlmConfigInput`, `updateEvent` — is a small flat settings blob. Where the entity is a
> first-class record with a lifecycle (a standard, a persona, a goal), all five repos reached for
> optional fields unprompted. That predicts this repo's own distribution: the clean surface is
> **personas** (a record) and the three defect families are **credentials, triggers and rotation
> policies** — the surfaces whose editors are settings forms. Treat "this is just a settings form" as
> the risk signal it is.

**PHYSICS, inverted — the absent-vs-null question is unsolved almost everywhere.** Four of five hit
it and none noticed. `brainiac`'s `.or_else()` (`standards.rs:358`) makes `rationale` permanently
unclearable; `personas-cloud`'s `??` chain (`httpApi.ts:555-576`) makes 13 fields unclearable, while
its own `updateSubscription` uses **three different absent-vs-null policies within six lines**
(`db.ts:985-990`). Only two places in five repos name the distinction in a type:
`.nullable().optional()` (`schemas.ts:126-139`) and `sourceFilter?: string | null`
(`personas-web/src/lib/api.ts:283`). This repo's `double_option` + `PersonaUpdatePayload` is,
comparatively, the most explicit treatment in the family — which is worth knowing before "fixing" it.

**PHYSICS — the optimistic-concurrency near-miss, replicated.** `brainiac` (`docs.rs:629-644`) and
`ascent` (`plan.ts:333-362`, `scans-recommendations.ts:116-125`) each independently built a
compare-and-set whose pre-image is read **server-side, in the same request, microseconds earlier** —
then wrote a 409 message promising to catch edits made since the client loaded the page. `ascent` even
defined the `expected` parameter that would close it and **no client ever passes it**. A CAS against a
pre-image you read yourself is a transaction-isolation fix wearing a concurrency-control error
message. **Personas is the only one of the six repos with a genuine client-supplied precondition** —
`expectedUpdatedAt` (`api/recipes/recipes.ts:102-121`), captured client-side at
`RecipeVersionsTab.tsx:68`. It is one endpoint, and it is more than anyone else has.

**SILENCES, reported as silences:**

- **No form library in any of the five.** `react-hook-form`, `formik`, `@tanstack/react-form`,
  `final-form`: zero imports, zero call sites, absent from every `package.json`. Five independent
  chances to reach for the obvious library; five refusals. Hand-rolled `useState` per field is the
  universal answer, so this document's hand-rolled prescription is not a local eccentricity.
- **No navigate-away guard for an entity draft in any of the five.** personas-web 0, brainiac 0,
  personas-cloud 0 (headless), ascent 0, vibeman 0 (its one `beforeunload`,
  `cliExecutionManager.ts:150`, closes SSE connections). `ascent` ships a bug report *documenting the
  absence*: *"the form has no concept of a clean vs modified state"*
  (`docs/harness/bug-ui-scan-2026-07-09/org-branding-white-label.md:29`). **Step 4 of §2 is therefore
  a house convention, not doctrine** — Personas is ahead of every sibling here, and an adopting repo
  should treat it as optional.
- **No draft persistence with staleness invalidation anywhere.** `ascent`'s
  `ascent:onboarding:v1` has a version string in the key and nothing else; `vibeman` has none at all
  (though `src/stores/utils/persistence.ts:99-155` provides an unused `'session_work'` category with
  TTL and `migrate` whose docstring describes exactly this use case).
- **No shared runtime validation schema across the client/server boundary in any of the five.** The
  closest is `brainiac` sharing *types* by OpenAPI codegen (`console/src/lib/types.ts:1-15`).
  `vibeman` runs three parallel validation systems of which one route file uses zod — and zod is a
  **phantom dependency** there, absent from `package.json` and resolved transitively.

**The finding that generalises past this leaf, because it replicated three times:** the correct
abstraction gets built and then bypassed. `personas-web`'s `commitOptimisticUpdate` — a per-id mutex
plus a CAS rollback guard, the best draft machinery in that repo (`personaStore.ts:180-225`) — has
**zero call sites**. So does `vibeman`'s `withValidation` (`withValidation.ts:19-48`) and its
`UpdateProjectRequest extends Partial<CreateProjectRequest>` (`types/api.ts:190-193`), while three
live paths re-declare the same optional bag at **three different widths (5 / 17 / 22 fields)**. This
repo has the identical disease and this document measured it independently: `patchCredentialMetadata`
has 1 consumer of the 3 sites that need it, `useUnsavedGuard` has 2 of ~13, `useEditorDraft` has 1 of
18. **Adoption, not invention, is the failure mode** — which is why §9's gate targets the call sites
rather than proposing another primitive.

**One idea to steal.** `ascent`'s write returns what was *actually stored* (`branding.ts:43-50`) so
the client can diff submitted-vs-stored and warn (`BrandingSettings.tsx:29-39`). It surfaces a
silently-sanitised or silently-dropped field without any shared schema. Every update command here
already returns the updated entity; nothing compares it to what was sent.

## 7 Deviations found

### P0-1 — shipped, live, destroys OAuth and healthcheck state on a rename

`persona_credentials.metadata` is `Option<Option<String>>` with `double_option`
(`core/src/models/credential.rs:95-96`), written by `push_field_param!(input.metadata, "metadata", …,
clone)` (`db/src/repos/resources/credentials.rs:381-382`), which binds `Some(None)` as **SQL NULL**.
The command layer passes it straight through (`commands/credentials/crud.rs:178-184`). Three client
sites send `metadata: null`:

| Path | Defect |
|---|---|
| `src/features/vault/shared/hooks/useCredentialRename.ts:48-55` | **Renaming a credential clears its entire metadata column.** |
| `src/features/vault/sub_databases/SchemaManagerModal.tsx:58-65` | Same, from the database-credential rename. |
| `src/stores/slices/vault/credentialSlice.ts:189-196` | Same, on **every** store-level credential update — the slice hardcodes `metadata: null` for all callers. |

**Executed, not argued.** Replaying `double_option` + `push_field_param!(clone)` against the real
metadata blob of a live credential (values never read; key names only):

```
row: "Google Calendar OAuth (imported)"   metadata keys on server = 18

SPELLING 3  updateCredential(id, {metadata: null})
   metadata after : SQL NULL (column cleared)
   keys LOST      : 18 -> healthcheck_results, healthcheck_last_success,
      healthcheck_last_success_at, anomaly_score, oauth_token_expires_at,
      oauth_refresh_count, oauth_last_refresh_at, oauth_predicted_lifetime_secs,
      oauth_refresh_backoff_until, oauth_refresh_fail_count, needs_reauth,
      needs_reauth_at, usage_count, last_used_at, healthcheck_last_message,
      healthcheck_last_tested_at, healthcheck_last_state, oauth_token_lifetime_secs
```

**The consequence is a known, previously-fixed production bug being reintroduced by a rename.**
`crud.rs:124-127` explains why `oauth_token_expires_at` must be stamped: *"without this the proactive
refresh engine's staleness guard skips the credential and the 1-hour access token dies un-refreshed
(the daily-401)."* Renaming an OAuth credential deletes that field. The same write also destroys
`oauth_refresh_backoff_until` and `needs_reauth`.

The repo defends this column everywhere except here: `refuse_corrupt_metadata`
(`credentials.rs:626-638`) exists to *"[refuse] to overwrite unreadable credential metadata; aborting
write to avoid destroying the ledger"* — and a `Some(None)` from the client bypasses it entirely,
because there is no read to fail.

**Fix:** widen `updateCredential` to `Partial<UpdateCredentialInput>` (mirroring
`api/agents/automations.ts:55` and `api/pipeline/teams.ts:40`) and delete the five placeholder keys
from each of the three call sites. Replay of the corrected payload: **0 keys lost.**

### P0-2 — shipped, live, silently and permanently stops a schedule from firing

`persona_triggers.next_trigger_at` is `Option<Option<String>>` with `double_option`
(`core/src/models/trigger.rs:510-511`). Four client sites send `next_trigger_at: null`:
`useScheduleActions.ts:112` (edit a schedule's cron), `useScheduleActions.ts:134` (pause/resume),
`useAutomationSuggestions.ts:85` (arm a mined route), and `triggerSlice.ts:156` (every trigger update
routed through the pipeline store, including `TriggerListItem.tsx:47,54`).

**There is a guard against exactly this, and the client defeats it.** `triggers.rs:449-450` reads:

```rust
let schedule_changed = input.trigger_type.is_some() || input.config.is_some();
if schedule_changed && input.next_trigger_at.is_none() { /* recompute from cron */ }
```

`input.next_trigger_at` is `Option<Option<String>>`. An explicit `null` deserializes to `Some(None)`,
and `Some(None).is_none()` is **false** — so the recompute is skipped, while
`push_field_param!(…, clone)` at `:425-432` writes the column to NULL. The guard was written for the
outer `None` that a client sending a full object never produces.

`get_due` (`triggers.rs:1590-1596`) selects `WHERE t.status = 'active' AND t.next_trigger_at IS NOT
NULL AND t.next_trigger_at <= ?1`. `background.rs:2418` is the **only** source of triggers for the
scheduler tick, and **there is no repair sweep** — nothing anywhere queries for
`next_trigger_at IS NULL`. A NULLed schedule is permanently dead.

Replaying the four payloads verbatim against the repo's own logic:

```
row before: next_trigger_at = 2026-08-16T09:00:00Z   (fires: true)

useScheduleActions.ts:112  editSchedule (user changes the cron)
   SET columns : config, next_trigger_at    schedule_changed: true  recompute ran: false
   next_trigger_at : NULL        get_due picks up : NO  <-- never fires again
useScheduleActions.ts:134  toggleEnabled (pause / resume)
   SET columns : next_trigger_at            schedule_changed: false recompute ran: false
   next_trigger_at : NULL        get_due picks up : NO  <-- never fires again
triggerSlice.ts:152  TriggerListItem config edit
   SET columns : config, next_trigger_at    schedule_changed: true  recompute ran: false
   next_trigger_at : NULL        get_due picks up : NO  <-- never fires again

THE FIX — omit the key entirely: { config }
   SET columns : config                     schedule_changed: true  recompute ran: TRUE
   next_trigger_at : <recomputed from cron>  get_due picks up : YES
```

**Editing a schedule's cron expression turns the schedule off. So does pausing and resuming it.** The
UI reports success in both cases (`toast_updated_schedule`, `toast_resumed`).

> ### ⚠ The measurement that failed, and why it matters more than the one that succeeded
>
> I queried the live database expecting to count the damage. **32 schedule triggers; 30 have
> `next_trigger_at IS NULL`; 10 of the 12 enabled ones do.** That looks like overwhelming confirmation
> and I nearly reported it as such.
>
> It is not confirmation. Every one of those 10 rows has `updated_at == created_at`,
> `trigger_version = 0` and `last_triggered_at IS NULL` — they were **never updated at all**. They were
> born NULL, by a different (creation-time) path. The 20 disabled ones carry an `updated_at` written
> as `2026-06-10 08:13` with a space rather than the `T` that every Rust write produces — a bulk SQL
> migration, not this defect.
>
> **The database cannot distinguish a cleared column from one that was never set, because NULL is
> both.** That is not a quirk of this table; it is the general consequence of the type defect this
> leaf is about. When "leave alone" and "clear" collapse into one value on the wire, they also
> collapse into one value at rest — so the damage is *unauditable after the fact*. You cannot write
> the query that finds the victims. This is the strongest available argument for fixing the type
> rather than adding monitoring, and I would not have found it if the query had simply agreed with me.
>
> The P0 above therefore rests on code-reading plus deterministic replay — which is stronger evidence
> than the row counts would have been, since the replay shows the mechanism and the counts would only
> have shown a correlation.

### P1-1 — the lost update that `Partial<>` does not fix

`useCredentialTags.ts:26-34` and `PlaygroundHeader.tsx:39-47` add a tag by calling
`buildMetadataWithTags(credential, nextTags)` (`credentialTags.ts:34-39`), which does
`{...parseMetadata(credential.metadata), tags}` and `JSON.stringify`s the result — a **client-side
read-modify-write of an 18-key blob**, where the read is the React prop, i.e. the store's copy from
the last `listCredentials`. The healthcheck engine, the OAuth refresh engine and the rotation engine
all write this column server-side in the meantime.

Replay, with three keys having landed server-side since the client's load:

```
SPELLING 2  updateCredential(id, {metadata: buildMetadataWithTags(cred, tags)})
   metadata after : 16 keys
   keys LOST      : 3 -> oauth_token_expires_at, oauth_refresh_count, healthcheck_last_state

SPELLING 4  the Partial<> fix (key omitted)      keys LOST : 0   <-- but the tag is not saved either
```

**`Partial<Update*Input>` cannot help here**, because these sites are *not* filling in a blank — they
are deliberately sending `metadata`, and they must. Widening the type leaves this defect exactly where
it is. The fix is different in kind: use `patchCredentialMetadata` (`api/vault/credentials.ts:29-30`),
which forwards to `repo::patch_metadata_atomic` (`credentials.rs:743-759`) and merges inside a
transaction. **That primitive already exists, is already exposed to the client, and has exactly one
consumer** (`useCredentialHealth.ts:183`) out of three sites that need it.

> One column, one feature, **three** client spellings — atomic server merge (1 site), client-side blob
> round-trip (2 sites), and `null` (3 sites). The correct one is the least used.

### P2 — latent: the same shape where it does not bite yet

`RecipeInputSection.tsx:54` names **15 of 15** fields to change one, with 14 `null`s.
`WebhookSubscriptionsPanel.tsx:138` names 7 of 7 to toggle `enabled`.
`RecipeEditor.tsx:100-108` and `RotationActivePolicy.tsx:147` and `remediationExecutor.ts:45` do the
same at smaller scale. `UpdateRecipeInput`, `UpdateNotificationSubscriptionInput` and
`UpdateRotationPolicyInput` currently have **zero** `double_option` fields, so every one of those
`null`s is harmlessly read as "skip". **They are one `#[serde(default, deserialize_with =
"double_option")]` away from being P0s**, and whoever adds that attribute will be editing a Rust file
and will not see these call sites.

### Structural — the type surface

Measured twice, independently, reconciling **exactly**:

- **114 of 125 fields (91.2%) across the 15 `Update*Input` bindings are REQUIRED.** Only two types
  (`UpdateExposedResourceInput`, `UpdateTrustedPeerInput`) have optional fields, and they are the two
  with **zero** `double_option` fields — i.e. optionality is present exactly where it is least needed.
- **39 fields carry `double_option`**, concentrated in 6 types: `UpdatePersonaInput` 13,
  `UpdateAutomationInput` 9, `UpdateTeamInput` 8, `UpdateToolDefinitionInput` 4,
  `UpdateConnectorDefinitionInput` 3, `UpdateCredentialInput` 1, `UpdateTriggerInput` 1.
- **Of 15 API adapters, 2 are widened to `Partial<>`** (automations, teams — both added *after* their
  incidents), **1 has a bespoke correct type** (personas), and **12 pass the raw generated type**.
  The three defect families in §7 all sit behind raw adapters.
- **40 production call sites** of the 13 entity-update functions: **27 inline object literals**,
  **12 hoisted payload variables**, 1 other.
- **Zero deviations on the persona surface** despite it having the most `double_option` fields (13)
  and the most call sites (~39). Every path — store, API, icon assignment, lifecycle, fan-out — goes
  through `buildUpdateInput` or `operationToPartial`. **The surface that was burned is the only clean
  one**, which is the adoption story this whole document is arguing from.

### Structural — the draft lifecycle

- **55 reseed effects across 48 files.** Split: **38 clobber** (dep is the entity object or a field of
  it, no guard), **7 id-only**, **10 guarded**. Of the 38, **18 are genuine entity drafts** — the rest
  are derived UI state. Worst shape: `AnnotationEditor.tsx:39` keys on five separate entity *fields*.
  `TeamWorkspacePane.tsx:69` keys on `[team]` **and** its own save calls `fetchTeams()`, so every save
  round-trip reseeds the form it just saved.
- **17 dirty-flag computations using 7 mutually incompatible mechanisms** — baseline-key compare,
  external registry, field-by-field `!==` against the live store entity, `JSON.stringify` deep compare
  (1 site), a custom `policyEqual`, a boolean set by every `onChange` (3 sites), and one derived from
  a save-state flag. No two editors share a mechanism unless they share a hook.
- **3 navigate-away protections in the entire app** — which is 3 more than any of the five sibling
  repos has (§6), so read this row as an incomplete rollout of a house convention rather than as
  falling behind a standard. `useUnsavedGuard` has **2 consumers**
  (`EditorBody.tsx:85`, `ByomSettings.tsx:36`); the third is a bespoke confirm in
  `TeamStudioSplitVariant.tsx:61-64`. At least **11 editing surfaces have none**, including the recipe
  editor, Chain Studio, `CredentialEditForm`, project settings and five settings panels. Of the four
  `beforeunload` handlers in the tree, exactly one guards unsaved data; the other three flush
  analytics and storage.
- **3 persisted drafts, 0 invalidation.** `trigger_studio_draft_v1` (`studioDraftModel.ts:51`) keeps a
  full link graph and prunes nothing; `companionStore.ts:1382` persists per-conversation drafts and its
  own `clearDraft` (`:300`) **has zero call sites repo-wide**; `ConversationComposer.tsx:48-63` keys a
  draft by `teamId` and clears only when the text empties.
- **Conflict detection: 1 site.** `api/recipes/recipes.ts:102-121` sends `expectedUpdatedAt` as an
  optimistic-lock token, plus one CAS module for decision rows (`lib/decisions/rowWrites.ts`).
  **`expected_version`, `expectedVersion`, `if_match` and `etag` appear nowhere else in `src/`.** All
  seven entity editors named in this leaf are last-write-wins with no token. Reported as a silence,
  because it is one.
- **Save-failure retention: clean.** 232 save-shaped `try/catch` blocks; **0** discard the draft. This
  is the one dimension of the leaf the repo already gets right everywhere, and it is worth saying so.

### Second pass — what is upstream of all of it

Re-reading the deviations together: 12 raw adapters, 7 blank-filled payloads, 2 blob round-trips, 38
unguarded reseeds and 3 navigate-away guards are not independent lapses.

> **The client is asked to produce a value for every field, and it has no idea which fields the user
> touched — because nothing in the code ever recorded that.**

The baseline is the missing object. Where a baseline exists (`useEditorDraft`), the diff is
computable, dirty is derivable, the guard has something true to guard, the reseed knows what it would
destroy, and the payload writes itself. Where it does not, every one of those five becomes a separate
hand-rolled decision — which is exactly the 7-mechanism, 3-guard, 12-adapter spread measured above.
`Partial<Update*Input>` makes the wrong payload *legal to omit*; a baseline makes the right payload
*the only one you can compute*. That is why the fix ranked first below is not the type widening.

**And the convergence sweep predicts exactly where the baseline will be missing.** Two sibling repos
fell into the required-field trap independently, and in every instance the entity was a small flat
settings blob rather than a record with a lifecycle (§6). This repo's distribution is the same:
**personas** — the surface with the most `double_option` fields, the most call sites and a full
draft/baseline hook — has **zero** deviations, while **credentials, triggers and rotation policies**
carry all seven. Those three are edited through settings forms, and a settings form does not feel
like it needs a baseline, because it does not feel like it is editing a record. It is.

## 8 Gaps in the primitive

1. **There is no `useEntityDraft`.** `useEditorDraft` is the right design and it is welded to
   `useAgentStore.selectedPersona` — it takes no arguments and returns persona-shaped state. Nothing
   generic exists, so all 18 real entity drafts re-derive it. This is the single highest-value
   extraction in this document and it is ~40 lines.
2. **`useUnsavedGuard` guards the sidebar and the window, and nothing else.** It subscribes to
   `useSystemStore.sidebarSection` (and opt-in `settingsTab`). A modal close, a tab switch inside a
   page, a route change that is not a sidebar section, and an entity switch within the same surface
   are all unguarded. The persona editor needed a **second, separate** mechanism
   (`personaSlice.ts:466-473`) for the entity-switch case.
3. **`BaseModal` cannot refuse to close.** `src/lib/ui/BaseModal.tsx` exposes `isOpen`/`onClose` with
   no `canClose` or `onBeforeClose`; Escape (`:201`) and backdrop click (`:283`) call `onClose()`
   unconditionally. Every draft rendered in a modal is structurally unprotectable without forking it.
4. **`draftChanged` compares with `!==`.** Reference equality per key, so an object- or array-valued
   draft field is permanently dirty. It works only because `PersonaDraft` is deliberately flat and
   scalar — an undocumented precondition on the one dirty primitive that is otherwise correct.
5. **No client-side merge primitive for JSON blob columns.** `patch_credential_metadata` exists for
   *one* column on *one* table. `team_config`, `canvas_data`, `parameters`, `disabled_dims_json`,
   `model_profile` and the trigger `config` are all blobs that clients round-trip whole, and each
   would need its own command. A generic `patch_json_column(table, id, column, patch)` is refused for
   good reason (it is an arbitrary-write primitive), so the gap is real rather than lazy.
6. **Nothing relates a generated `Update*Input` to the fields a form actually renders.** The 15
   bindings are regenerated from Rust; the drafts are hand-written interfaces
   (`PersonaDraft`, local `useState` clusters). A field added to the Rust struct appears in the binding
   and in nobody's draft, and a field removed leaves a dead draft key. There is no check either way.
7. **A ratchet cannot see a hoisted payload.** 12 of 40 production call sites build the payload into a
   variable first (`RecipeEditor.tsx:100-108` is a blank-filled payload spelled this way). Any signal
   anchored on the call site is blind to them by construction — see §9.
8. **The three-state contract has no client-side test anywhere.** `api/__tests__/personas.test.ts`
   exercises `updatePersona`, but nothing asserts that an omitted key stays omitted through
   `buildUpdateInput`, and nothing asserts a payload does *not* contain a key. The `PERSONA_NULLABLE_FIELDS`
   list is 13 hand-maintained strings that no tool checks against `core/src/models/persona.rs`.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), answered before §9 is written, and held against all
six qualifications.

**The brief asked whether `Partial<T>` is the right type. Measured answer: it is necessary, it is not
sufficient, and it is not the primary fix.**

`Partial<Update*Input>` is correct as far as it goes — replay confirms an omitted key reaches Rust as
the outer `None` and leaves the column alone, and it turns all 7 blank-filled payloads into deletable
lines. Finish that migration (10 adapters remain). But three measurements say it is not the answer to
*this* leaf:

1. **It does not touch Mode B.** The 2 blob round-trip sites are type-correct before and after
   (§7 P1-1, 3 keys lost either way).
2. **It makes the two opposite meanings of `null` look identical.** Under `Partial<T>`, `name?: string
   | null` and `metadata?: string | null` are the same type, yet `name: null` means *skip* and
   `metadata: null` means *destroy*. `PersonaUpdatePayload` — `Omit<T, Nullable> &
   Partial<Pick<T, Nullable>>` (`personas.ts:393-395`) — is strictly better precisely because it keeps
   them visibly different. It is also hand-maintained and drifts (Gap 8).
3. **A permissive payload type still lets the call site author a payload**, and authoring is where all
   40 sites make their mistake.

**A sibling has already run the experiment on the strongest available type.** `personas-cloud`'s
`PersonaUpdateSchema` is all-optional **plus `.strict()`** (`packages/orchestrator/src/schemas.ts:124-140`),
so a client that POSTs back the entity it just loaded is rejected with a **400** — `id`, `createdAt`,
`updatedAt` and `webhookSecret` are not in the schema. That is Mode A made *structurally
unrepresentable* rather than merely discouraged, and it is the closest thing in the family to the
answer. Its TypeScript equivalent — an update type that is all-optional **and** cannot contain the
identity/audit fields — is worth adding to `Partial<Update*Input>` when the migration lands, because
`Partial<T>` alone still happily accepts a spread of the whole entity.

**The primary fix is to withhold the payload, not to widen it.** Ship a generic
`useEntityDraft(entity, { keys })` returning `{ draft, patch, isDirty, changedKeys, save }`, where
`save()` computes `diff(baseline, draft)` internally and the caller **never receives a payload object
to fill in**. Pair it with the operation union (`PersonaOperation`) at the API edge so an intent
carries only its own fields. Together these make every defect in §7 unrepresentable: you cannot put
`metadata` in a rename because a rename op has no `metadata` field, and you cannot send an unchanged
key because you never touch the payload.

Held against the six qualifications:

1. **A required prop carries only what it actually encodes.** Violated at scale here: 114 required
   fields, of which the caller genuinely means about one. The requiredness encodes *"ts-rs emitted a
   union"*, not *"this operation needs this field"*.
2. **Requiredness is orthogonal to closedness.** Confirmed sharply. `UpdateCredentialInput` is
   maximally *required* and maximally *open* — any of its 7 keys accepts `null`, and one of those
   nulls is destructive. Requiring every field bought exactly nothing in safety and cost three P0s.
3. **A type nobody constructs constrains nothing.** `PersonaUpdatePayload` is the strongest type here
   and it is constructed by exactly one function; that is *why* the persona surface has zero
   deviations. Contrast `UpdateTriggerInput`, whose store wrapper is typed `Record<string, unknown>`
   (`triggerSlice.ts:116`) — the generated type is not constructed by anyone on the path that matters,
   so it constrains nothing.
4. **A type anyone can construct authenticates nothing.** All 27 inline literals are hand-built object
   literals; the type checks their *shape* and can say nothing about whether the values were the
   user's or the compiler's.
5. **Withholding beats requiring — with a refinement this leaf earns.** The known bugs were caused by
   *requiring* every field and fixed by *withholding* the requirement, which supports the
   qualification. But the measurement adds a condition: **withholding the requirement removed Mode A
   and left Mode B untouched, at the same two files' worth of severity.** So — *withholding a
   requirement only helps when the requirement was the thing forcing the bad value.* Where the caller
   supplies the bad value voluntarily (a stale blob it genuinely intends to send), relaxing the type
   is inert. Do not read qualification 5 as "make it optional and move on".
6. **Withhold the dangerous freedom, not the answer.** The dangerous freedom here is precisely
   **authoring the payload object**; the answer is the field values, which the user must obviously
   still supply. `useEntityDraft` withholds the former and takes the latter through `patch()`. This is
   the qualification that picks the fix: `Partial<>` withholds a *requirement*, which is the wrong
   thing to withhold; the draft hook withholds *construction*, which is the right one.

**Where a type cannot reach.** Nothing in the type system can detect that a reseed effect's dependency
array is the entity object (Gap; it is a lint concern, not a type concern), that a persisted draft has
gone stale against a changed entity, or that a save is last-write-wins. Optimistic concurrency needs a
token on the wire — `expectedUpdatedAt` (`recipes.ts:102-121`) is the shape, and extending it is a
schema change, not a type change.

## 9 The missing gate

**The condition, stack-free:** *a client sends a stored field a value it did not get from the user* —
either a placeholder it invented to satisfy a type, or a stale copy it read earlier. No signal can see
the second half (it is type-correct and shape-correct), so the gate targets the first.

**The signal, and what it is a proxy for.** An `update*(…)` call whose inline object literal carries
**two or more properties whose entire value is the literal `null`**. Two is the discriminating
threshold, not an arbitrary one: **one** `null` is a plausible deliberate clear; **two or more** is a
caller filling in blanks it was required to name. This is a proxy for "the payload is a record, not a
diff" — and the proxy is stack-specific, as the contract requires. A repo whose update takes one
request body, or that spells the tri-state as `.nullable().optional()`, or that patches through an ORM
has the same condition wearing markup this pattern cannot see, and would score a structural zero.

**Precision: 12/12, hand-verified.** Every match was opened. Two false-positive families found during
tuning are excluded **by construction**, not by allowlist:

- **Local state setters.** `updateStatus(name, { testing: true, result: null })`
  (`useConnectorStatuses.ts:109,241`) is React state, and `result: null` is a real value. Excluded by
  tempering the pre-brace span with `[^;{}>]`, which refuses an arrow-function body (`=> {`) — this
  also removes `updateSessionInState(state, id, (sess) => {…})` in `matrixBuildSlice.ts` (3 matches).
- **Ternary else-branches.** `targetValue: typeof tv === 'number' ? tv : null` reads as `tv : null` to
  a naive `\w+\s*:\s*null`. Excluded by requiring each null property to be delimited by the object's
  `{` or a `,`, which a ternary's `?` is not (`KpiSimSuggestions.tsx:109`).

**Positive control — mandatory, and it discriminates.** The identical anchors pointed at the
**compliant** form (an `update*` payload literal containing no `null` at all) match **105 times across
56 files**. So the rule keys on the blank-filling shape, not on the token `update`: **12 violating vs
105 compliant, i.e. 10.3% of inline update payloads are blank-filled.** The control deliberately
carries **no `baseline`** — a ratchet is monotone-downward and a rule counting compliant code would
fail the build every time adoption improved; `merge-published-rules.mjs:66` skips it by construction.

**Disclosed recall gaps — both real, both structural:**

1. **Hoisted payloads are invisible.** 12 of 40 production call sites build the payload into a
   variable and pass the identifier (`RecipeEditor.tsx:108` is a blank-filled payload spelled exactly
   this way). No call-site-anchored signal can see them. This is a ~30% blind spot and no tightening
   of this pattern closes it — it needs type information, i.e. an ESLint rule with the checker.
2. **Placeholders spelled as an expression are invisible.** `triggerSlice.ts:152-157` — a **live P0** —
   writes `trigger_type: (updates.trigger_type as string) ?? null` and
   `config: … ? … : null`, with only `next_trigger_at: null` bare. One bare null, so the two-null
   threshold misses it. Loosening to one null recovers it at a cost of 2 false positives out of 17
   (88% precision), which the contract's *"a gate that fires on correct content is worse than no
   gate"* rules out. **The gate is therefore explicitly not the whole enforcement; §7 P0-2 must be
   fixed by hand.**

**Why this is a census rule and not an ESLint rule.** The countable signal is textual and the mechanism
wanted is a ratchet. The *better* instrument is an ESLint rule with type information that flags any
property in an update payload whose value is `null` and whose declared type has two `null` union
members — that closes both recall gaps and can autofix by deleting the property. It is worth building
and it is not this. Until it exists, the census holds the line.

**How it fails loudly.** Inherited from the runner: a walk seeing fewer than `floor` files fails
("matcher broken, not codebase clean"); zero matches anywhere fails; a count that *drops* without the
baseline being updated fails, because a silent drop is a broken matcher more often than fixed code.

**This rule cannot express "must be zero", and it should be zero.** All 12 matches are removable
without exception — `Partial<Update*Input>` on the adapter plus deleting the placeholder keys. When
the count reaches 0 the runner will fail structurally on zero-matches **by design**: at that point
**delete the rule, do not baseline it at 0**, and rely on the type (§"Prefer a type over a gate") which
by then makes the shape uncompilable.

**Validated standalone before publication**, in a composer-private registry, then re-extracted from
this document and re-run — both runs report `files 9 / matches 12` for the rule and `files 56 /
matches 105` for the control, over 4,829 files walked against a floor of 3,000.

```json
{
  "id": "blank-filled-update-payload",
  "goldenPath": "docs/concepts/golden-paths/entity-draft-editing.md",
  "title": "A client update payload names fields the user never edited and fills them with a literal null, so the wire carries the client's placeholder instead of the user's diff",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bupdate[A-Z]\\w*\\s*\\([^;{}>]{0,160}\\{(?:[^{}]{0,700}?,)?\\s*\\w+\\s*:\\s*null\\s*,(?:[^{}]{0,700}?,)?\\s*\\w+\\s*:\\s*null\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "an update*(...) call whose INLINE object-literal argument carries two or more properties whose entire value is the literal `null`. PROXY FOR the stack-free condition: a client sends a stored field a value it did not get from the user - a placeholder invented to satisfy a type that requires every field - so the payload is a record of the client's state rather than a diff of the user's edits. TWO is the discriminating threshold and is not arbitrary: one null is a plausible deliberate clear, two or more is blank-filling. EXECUTED, not argued: replaying serde_util.rs:24-30 (double_option) and macros.rs:45-51 (push_field_param!(.., clone)) against a real 18-key metadata blob from a read-only copy of the live database shows `metadata: null` clears all 18 keys (including oauth_token_expires_at, whose absence reintroduces the daily-401 documented at commands/credentials/crud.rs:124-127) while the same payload with the key OMITTED loses zero; and replaying triggers.rs:425-432 + 449-450 shows `next_trigger_at: null` writes SQL NULL *and* defeats the recompute guard, because that guard tests input.next_trigger_at.is_none() and an explicit null deserializes to Some(None), whose is_none() is false - after which get_due (triggers.rs:1590-1596, the only source of scheduler work, with no repair sweep anywhere) can never select the row again. Measured 2026-08-15 at HEAD: 12 matches across 9 files, ALL TWELVE OPENED AND CONFIRMED (precision 12/12), commentMatchesSkipped 0, over 4829 files walked. Reconciles with two independent AST/text implementations that agreed exactly on the 7 sites nulling a double_option field. TWO FALSE-POSITIVE FAMILIES ARE EXCLUDED BY CONSTRUCTION rather than by allowlist: (a) local React state setters - updateStatus(name, {testing: true, result: null}) at features/agents/sub_connectors/libs/useConnectorStatuses.ts:109,241, where result: null is a real value - are removed by tempering the pre-brace span with [^;{}>], which refuses an arrow-function body (`=> {`) and also removes updateSessionInState(state, id, (sess) => {..}) in stores/slices/agents/matrixBuildSlice.ts (3 matches); (b) ternary else-branches - `targetValue: typeof tv === 'number' ? tv : null` at features/teams/sub_kpis/KpiSimSuggestions.tsx:109 reads as `tv : null` to a naive matcher - are removed by requiring every null property to be delimited by the object's `{` or a `,`, which a ternary's `?` is not. NOT EVERY MATCH IS A LIVE BUG AND THE RULE DOES NOT CLAIM SO. The 12 break down exactly: SIX null a field carrying #[serde(default, deserialize_with = \"double_option\")] and destroy data today - useCredentialRename.ts:48, SchemaManagerModal.tsx:58 and credentialSlice.ts:189 clear persona_credentials.metadata; useScheduleActions.ts:112, useScheduleActions.ts:134 and useAutomationSuggestions.ts:85 clear persona_triggers.next_trigger_at. TWO are the lost-update sites - useCredentialTags.ts:26 and PlaygroundHeader.tsx:39 null only plain Option<T> fields (harmless) but round-trip the metadata blob from a stale client copy, which the type widening does NOT fix (see the golden path's P1-1; replay loses 3 of 18 keys). FOUR are latent - useScheduleActions.ts:195 and :229 null only plain-Option fields, and RecipeInputSection.tsx:54 (names 15 of 15 fields to change one) and WebhookSubscriptionsPanel.tsx:138 (names 7 of 7 to toggle a boolean) target types with ZERO double_option fields, so every null is read as skip. Those four are one serde attribute away from being data-loss bugs, and whoever adds that attribute will be editing a Rust file and will not see these call sites. 6 + 2 + 4 = 12. It is a RATCHET on a construction that is removable in every case. DISCLOSED RECALL GAPS, both structural: (1) 12 of the 40 production call sites hoist the payload into a variable and pass the identifier - recipes/sub_editor/components/RecipeEditor.tsx:108 is a blank-filled payload spelled exactly that way - and no call-site-anchored signal can see them, a ~30% blind spot that needs type information to close; (2) a placeholder spelled as an expression rather than a bare literal is invisible - stores/slices/pipeline/triggerSlice.ts:152-157 is a LIVE data-loss site with only one bare null (`next_trigger_at: null`) beside `?? null` and `? : null` siblings, and loosening the threshold to one null recovers it only at 88% precision (2 FPs of 17), which is worse than no gate. PRECONDITION (must be re-derived per repo): this repo names its mutation functions update<Entity>, passes a plain object literal as the payload argument, and generates required-everything update types via ts-rs, so the blank-filling is visible as text. A repo that takes one request body per endpoint, spells the tri-state as zod .nullable().optional(), or patches through an ORM has the SAME condition wearing markup this pattern cannot see and scores a structural zero. POSITIVE CONTROL: the identical anchors pointed at the COMPLIANT form (an update* payload literal containing no null at all) match 105 times across 56 files, so the rule discriminates on the blank-filling shape rather than on the token `update` - 10.3% of inline update payloads are blank-filled and 89.7% are not. LEGAL FIX, in order: (1) widen the api adapter to Partial<Update*Input> - src/api/agents/automations.ts:55 and src/api/pipeline/teams.ts:40 are the shape to copy, and their doc comments explain why omission is the only correct spelling of leave-alone - then delete the placeholder keys at the call site; (2) for a JSON blob column do NOT round-trip it from the client, send a patch and let the server merge in a transaction - src/api/vault/credentials.ts:29-30 -> db/src/repos/resources/credentials.rs:743-759 is the primitive and features/vault/shared/hooks/health/useCredentialHealth.ts:183 its only consumer; (3) the durable fix is an operation union so an intent carries only its own fields - src/api/agents/personas.ts:320-333, whose surface has 13 double_option fields, ~39 call sites and ZERO deviations. Do NOT silence a match by hoisting the same object into a variable (that hides it from the rule without fixing it) or by replacing `null` with `undefined` (JSON.stringify drops it, which happens to be correct, but the next author will read the two as interchangeable and they are not). END OF LIFE: this rule is designed to reach zero - all 12 are removable. When it does the runner fails structurally on zero-matches BY DESIGN: DELETE the rule then, do not baseline it at 0."
  },
  "baseline": { "files": 9, "matches": 12 },
  "floor": 3000
}
```

```json
{
  "id": "blank-filled-update-payload-positive-control",
  "goldenPath": "docs/concepts/golden-paths/entity-draft-editing.md",
  "title": "POSITIVE CONTROL - the same anchors pointed at the COMPLIANT form: an update payload that names only the fields it changes",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bupdate[A-Z]\\w*\\s*\\([^;{}>]{0,160}\\{(?:(?!\\bnull\\b)[^{}]){1,700}?\\}",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The identical call-site anchors and the identical arrow-body tempering as blank-filled-update-payload, pointed at an inline update* payload literal that contains no `null` anywhere - i.e. a caller that named only the fields it is changing. Exists to prove the gate discriminates on the blank-filling SHAPE rather than on the token `update`: measured 2026-08-15 at HEAD it matches 105 times across 56 files against the gate's 12 across 9, so 89.7% of inline update payloads in this repo are already compliant and the gate is not simply counting update calls. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved, and scripts/census/merge-published-rules.mjs:66 skips baseline-less rules by construction while engine.mjs:377 exempts a `-positive-control` id from the baseline requirement. If this control's count ever collapses toward the gate's, the anchors have broken and BOTH numbers are meaningless - that is the failure this control exists to make visible."
  },
  "floor": 3000
}
```
