# Connector-sourced options

> **Situation node:** `product-surfaces/authoring-and-catalogs/connector-sourced-options` ·
> spine `sides: "client"` · `twoSided: true` · `fusedAcrossSides: false` ·
> `convergence: "mixed"` · `risk: medium` · `recurrence: 4` ·
> dimensions: **ui · function · resilience · performance** ·
> merged from *"Connector-sourced option list"* ·
> spine `why`: *"Populating a picker by calling the user's own connected service at render time."*
>
> **Composed 2026-08-17** against `master @ 2a874e692`. **Short form** per the Mode-2
> tiering (`risk: medium`, `recurrence: 4`): spine header, §0 headline, compact §2,
> §7 deviations, §9 rule, §12 corrections. The quality core is unchanged — every count
> has two implementations, the rule ships with a partitioning positive control validated
> in a private registry, overlap is measured at site level against the final pattern, and
> precision is hand-verified.
>
> Sweep: 31 option-producing surfaces enumerated across `src/features/**` (12 opened and
> read in full), plus a whole-tree census of the failure-handling shape.

---

## §0 — Headline

**An option list sourced from a connector has at least five states and this repo ships it
as an array, so the failure states are spelled the same way as success-with-nothing.**
Across the tree, **44 files / 49 sites** handle a rejected fetch by writing the empty
array into state with nothing anywhere in the handler recording that it failed — against
**385 files / 936 sites** where a catch does give the failure an identity. In a picker
that difference is not cosmetic: an empty `<select>` is a dead end the user cannot act
on, and *"your credential is missing"*, *"the call failed"* and *"your account has none of
these"* need three different next actions.

**The repo already contains the complete answer, twice, and neither instance travelled.**
`useDynamicQuestionOptions` (`:12-41`) declares
`{ loading, ready, error, errorKind: 'no_credential' | 'fetch_failed' | null, items, waitingOnParent }`
and `DynamicSelectBody` (`QuestionnaireFormGridParts.tsx:56-218`) renders **six** distinct
arms off it — including hiding Retry when retrying cannot help, and a free-text fallback
so a broken connector does not block the flow. `ResourcePicker` reaches the same
conclusion by a different route, with a `fetched` flag (`:44`) that exists precisely so a
failed fetch is not mistaken for a real empty response (`:229`).

**The sharpest single instance sits inside the credential form itself.**
`ConnectorCredentialModal.tsx:55-82` hydrates a Twin-profile picker and coalesces the
`null` sentinel at the render site — `options: (twinProfiles ?? []).map(…)`. In-flight,
failed, and genuinely-empty are the same empty select. The code comment two lines above
states the intent and the gap in the same breath: *"If the load fails, we still render the
form (with an empty picker) **so the user can see what's broken**"* — and nothing renders
what is broken.

---

## §2 — The one way (compact)

**Return a state, not an array. The empty array must never be the carrier of meaning.**

Declare one discriminated state per option source and let the control render off it:

```ts
type OptionState<T> =
  | { kind: 'idle' }                                   // no credential chosen yet
  | { kind: 'waiting'; on: string }                    // a parent answer is missing
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: 'no_credential' | 'credential_failed' }
  | { kind: 'error'; message: string; retryable: true }
  | { kind: 'ready'; items: T[] };                     // `items` MAY be empty — that is a fact
```

Then, in order:

1. **Never write `[]` into the list on rejection.** The rejection gets its own field.
   `setItems([])` inside a `catch` destroys the only evidence the UI had.
2. **Never coalesce the loading sentinel at the render site.** `(x ?? []).map(…)` turns
   *"not loaded yet"* into *"there are none"*, and does it after the branch that could
   have said otherwise.
3. **Split "cannot" from "failed".** A missing or failed credential is not retryable — the
   correct affordance is *Add credential*, and offering Retry beside it is a loop the user
   can watch fail. `useDynamicQuestionOptions.ts:19-27` records this as a user-reported
   bug and `QuestionnaireFormGridParts.tsx:110-146` is the fix: `isMissingCredential` hides
   Retry and re-tones the Add button.
4. **`ready` with zero items is its own arm and says so in the service's words** —
   *"No repositories found in GitHub"*, not a blank list. `QuestionnaireFormGridParts.tsx:160-183`.
5. **Do not disable the control into a dead end.** Where the underlying value can be typed,
   degrade to free text rather than to an empty picker: `QuestionnaireFormGridParts.tsx:149-155`
   (a text input under the error) and `SlackBridgePickers.tsx:105-121` (the select becomes a
   channel-id input with a three-way hint: `loading` / `load_failed` / `manual_hint`).
6. **Re-fetch when the credential changes, and guard the response.** Key the effect on the
   credential id; hold a request-id (`useDynamicQuestionOptions.ts:273-289`) or a
   `cancelled` flag so a slow first answer cannot overwrite a fast second one.
7. **Do not let a failed fetch silently invalidate the user's existing picks.**
   `ResourcePicker.tsx:225-231` computes `stalePicks` only when `fetched` is true, with the
   reason in the comment: *"so a transient zero-results state doesn't flag every pick as stale."*
8. **And then stop.** No second "hasOptions" boolean; the `kind` is the answer.

**The one site to copy** is `useDynamicQuestionOptions.ts` + `QuestionnaireFormGridParts.tsx`
read together — the hook owns the state and the component owns the six arms, and neither
knows anything about the other's internals.

**One interaction worth stating, because it crosses into the neighbouring leaf.** A picker
that gates its own fetch on a credential's health inherits that verdict's resolution.
`GitHubRepoSelector.tsx:97` does `if (!health.success) return;` — and `unverifiable` is
constructed with `success: true` (`healthcheck.rs:81`), so an unverifiable credential is
treated as usable while a *failed* one silently removes the dropdown with no message. Use
`readCredentialHealthState()` (`src/lib/credentials/healthState.ts:48`), never the raw
boolean. See [`connector-setup-panel`](./connector-setup-panel.md) §7.1.

---

## §7 — Deviations

### 7.1 The machine-measured population

Whole-tree census, two implementations (below, §12.2): **a `catch` handler whose only
state write is the empty array and which records no failure identity anywhere in the
handler** — **44 files / 49 sites**. The compliant half of the same anchor — a `catch`
that writes an error, a flag, or a toast — is **385 files / 936 sites**. So the repo's
dominant habit is correct and this is a **5%** tail, not a systemic failure. That matters
for the prescription: the fix is site-by-site, not a refactor.

### 7.2 Option sources that cannot distinguish failure from empty

Enumerated by a breadth pass over `src/features/**` and spot-verified by opening 12 of
them; every row below with a `✔` in the last column was read in full during composition.

| # | Option source | Fetch | On rejection | Loading arm | Verified |
|---|---|---|---|---|---|
| 1 | Twin-profile picker inside the credential modal | `ConnectorCredentialModal.tsx:59` | `silentCatch`, sentinel stays `null`, `?? []` at `:75` | **none** | ✔ |
| 2 | GitHub Actions repo select (automation wizard) | `useAutomationSetup.ts:146` | `silentCatchNull` → `setGithubRepos(repos ?? [])` at `:150` | yes | ✔ |
| 3 | Zapier zap select (same wizard) | `useAutomationSetup.ts:159` | `setZapierZaps([])` at `:164` | yes | ✔ |
| 4 | GitHub repo dropdown (Dev Tools project form) | `GitHubRepoSelector.tsx:99` | `silentCatch` only; `hasSelector` stays `false` | yes | ✔ |
| 5 | KPI wizard metric-type radiogroup | `KPIConnectWizard.tsx:90` | `toastCatch`; `types` stays `[]` | see §7.3 | ✔ |
| 6 | KPI wizard matching-credential list | `KPIConnectWizard.tsx:98` | catch returns `[]` **without calling `setMatches`** (`:103-106`) | see §7.3 | ✔ |
| 7 | Skill context picker | `useContextPickerData.ts:49-62` | see §7.3 | see §7.3 | ✔ |
| 8 | Source-definition codebase + database tabs | `SourceDefinitionInput.tsx:119` | `silentCatch` → `setProjects([])` at `:126`; `projectsLoaded` set in `.finally` for both outcomes | **none** | ✔ |
| 9 | Lifecycle project picker | `LifecycleProjectPicker.tsx:30` → `devToolsProjectSlice.ts:98-105` | store sets a global error the component never reads; `projects.length === 0` renders the create-CTA | **none** — the CTA flashes during the fetch | ✔ |
| 10 | GitLab deploy target-project select | `GitLabDeployModal.tsx:49` → `gitlabSlice.ts:263-270` | store sets `gitlabError`; **the modal never reads it** | **none** | |
| 11 | Add-KPI connector select | `useAddKpi.ts:54` | `silentCatch`, `creds` stays `[]` | **none** | |
| 12 | Passport env-connector candidates | `envConnectors.ts:76-92` | `setCredentials([])` | **none** for candidates | |
| 13 | Passport connector tool tiles | `ConnectorSection.tsx:33` | `setCandidates([])` — settles the `null` loading sentinel to the same value as success | yes | |
| 14 | Data-links project multiselect | `DataLinksPopover.tsx:36` | `setOthers([])`, overwriting the `null` sentinel | — | |
| 15 | Export selection picker (8 parallel scopes) | `useExportPicker.ts:98-133` | **each** call independently `.catch(silentCatch) → []`; rows are then preselected (`:163-167`) | one flag for all eight | |
| 16 | API-key execute-scope persona picker | `ExecutePersonaPicker.tsx:32` | `setPersonas([])` at `:36` | yes (`null` sentinel) | |
| 17 | Twin brain "link existing knowledge base" | `useBrainConnection.ts:72` | bare `catch { setAllKbs([]) }` — no logging at all | **none** | |
| 18 | Drive knowledge-base picker | `useDriveKnowledge.ts:45` | `setAvailable(false); setKnowledgeBases([])` | — | |
| 19 | Twin channel credential select | `ChannelsAtelier.tsx:74` | store-backed, no per-control error | **none** | |
| 20 | Skill-contexts modal | `SkillContextsModal.tsx:29` | `setRows([])` | `null` sentinel, then `(rows ?? [])` at `:34` | ✔ |
| 21 | Skills-workbench dispatch list | `skillsWorkbenchData.ts:148` | `setInstalled([])` | yes | |
| 22 | Use-case picker event types | `useUcPickerState.ts:72-78` | `silentCatch`, list shrinks silently | **none** — degrades onto static fallbacks | |
| 23 | Trigger Test-tab event select | `TestTab.tsx:45,:49` | both catches shrink the merged option list | **none** | |

**Eight sources do it correctly** and are the evidence for §2: `ResourcePicker` (`:44`,
`:101-104`, `:229`, `:275`, `:315`, `:337`), `SlackBridgePickers` (`:117-121`),
`useDynamicQuestionOptions` + `DynamicSelectBody`, `ConnectorTableScopeRow` (`:108`,
`:112`, `:122`), `TableSelector` (`:114`, `:120`, `:126`), `DevToolsProjectDropdown`
(`:134`, `:139`), `CodebaseProjectPicker` (`:113`, `:142`, and the comment at `:40-44`
naming the prior bug), `GatewayMembersModal` (`:98-99`).

### 7.3 Three failure modes worse than an empty list

**(a) A permanent spinner where the spinner renders nothing.**
`KPIConnectWizard.tsx:225` is `{types.length === 0 && <LoadingSpinner size="sm" />}` and
`:232` is `matches == null ? <LoadingSpinner size="sm" /> : …`. `feedback/LoadingSpinner`
renders **`null`** — it emits only an `sr-only` `role="status"` when given a `label`, and
none is given at either site. So after `listKpiMetricTypes()` rejects, the radiogroup is
not a spinner: it is a **zero-pixel region**, permanently, with a single toast already
dismissed. The matching-credential list is the same shape and additionally can never
leave it — the catch at `:103-106` returns `[]` **without calling `setMatches`**, so the
`matches == null` sentinel is never cleared.

**(b) A `Promise.all` with no rejection path at all.**
`useContextPickerData.ts:47-62` composes three calls; only the third carries a `.catch`.
There is no `.catch` and no `.finally` on the `Promise.all`, and `setLoading(false)` lives
inside the `.then`. If `listContextGroups` or `listContexts` rejects, `loading` stays
`true` for the lifetime of the component and the rejection is unhandled.

**(c) A silent contract fallback that looks like an empty account.**
`src/api/devTools/devTools.ts:75` declares `listProjects` as
`safeInvoke<DevProject[]>([], "dev_tools_list_projects")`, which returns `[]` for an
**unregistered command** (`src/lib/utils/tauri/safeInvoke.ts:64-72`). Rows 8 and 9 above
render *"no projects — click create"* for that case too. The `safeInvoke` regex was
already hardened once for exactly this class of bug (see the historical-bug comment at
`:20-42`); the remaining gap is that its consumers give the fallback no visual identity.

### 7.4 The loading sentinel erased at the render site

Six sites in the tree write `(x ?? []).map(`. Hand-verified, **two** are this leaf's
defect — a nullable *fetch* sentinel coalesced before the branch that could have reported
it:

| Site | Verdict |
|---|---|
| `ConnectorCredentialModal.tsx:75` | **true positive** — `twinProfiles: TwinProfile[] \| null`; `null` means in-flight **or** failed |
| `SkillContextsModal.tsx:34` | **true positive** — `rows: SkillContextRow[] \| null` from a fetch whose catch also writes `[]` |
| `BrokerPanel.tsx:76` | partial — a row list, not an option list; an empty-state block renders above it |
| `VaultConnectorPicker.tsx:84` | false positive — `suggested` is an optional *prop* of ambient hints; absence is legitimate |
| `dispatchModel.ts:83` | false positive — `signals: … \| null` is a deliberate parameter contract, documented at `:74-76` |
| `test/automation/bridge.ts:2335` | false positive — a test-harness parameter |

That is **2/6**, and it is why this shape is *not* the rule this path ships (§9).

### 7.5 Smaller notes

- `useDynamicQuestionOptions` is the exemplar and has one internal inconsistency: its
  `vault` (`:216-220`) and `scope` (`:159-162`) branches set an error when the result is
  empty, while the **IPC branch sets `ready: true` unconditionally** on resolve
  (`:290-300`). The consumer covers it with a `ready && items.length === 0` arm
  (`QuestionnaireFormGridParts.tsx:160`), so nothing is broken — but the hook alone does
  not distinguish it, and a second consumer would inherit the gap.
- The same hook reads `c.healthcheck_last_success === false` directly at `:95`, `:143`,
  `:196`. The semantics happen to be right (it keeps `unverifiable` and `untested`
  eligible), and `readCredentialHealthState()` exists to make that intent explicit
  (`healthState.ts:30-41`). Three raw reads, one of the exact comparisons that path was
  extracted to replace.
- `GitHubRepoSelector.tsx:130` passes a hardcoded English `label="Loading repositories"`
  into `LoadingSpinner` beside a translated text label — an i18n miss on a string that is
  screen-reader-only.

---

## §9 — The rule

**A type would be better and it does not reach far enough here.** Making `OptionState` a
discriminated union removes the defect wherever a source *adopts* it — but the census is
being asked to find the sources that never declared a state at all, and doctrine item 4
under "where types cannot reach" covers exactly that: *a thing that was never declared*
has no signature to constrain. The countable footprint is the **handler**, not the type.

**Condition the signal is a proxy for:** *a rejected read is recorded as an empty result,
so the UI cannot tell "we could not ask" from "the answer is none".* A repo adopting this
path writes its own proxy — this one keys on JavaScript `catch` bodies and React setter
naming, and would find nothing in a Rust or Python codebase.

Anchor: a `catch` handler for a list-producing read. **Violating** = the handler's only
state write is `setX([])` and no error identity is recorded anywhere in it.
**Compliant** = the handler writes an error, a failure flag, or a toast. The two halves
partition the anchor.

```json
{
  "id": "failure-written-as-empty-list",
  "goldenPath": "docs/concepts/golden-paths/connector-sourced-options.md",
  "title": "A rejected fetch handled by writing the empty list into state, with nothing recording that it failed",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "catch\\s*(?:\\(\\s*[^)]{0,60}\\)|\\{)(?![\\s\\S]{0,240}?(?:set[A-Za-z]{0,20}(?:Error|Failed|Kind)|addToast|toastCatch|reportError|setStatus))[^}]{0,200}?\\bset[A-Z][\\w$]*\\s*\\(\\s*\\[\\s*\\]\\s*\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A catch handler whose only state write is an empty array, and which sets no error/failure identity anywhere in the handler. The rejection becomes indistinguishable from an empty result."
  },
  "baseline": { "files": 44, "matches": 49 },
  "floor": 4000
}
```

```json
{
  "id": "failure-written-as-empty-list-positive-control",
  "goldenPath": "docs/concepts/golden-paths/connector-sourced-options.md",
  "title": "COMPLIANT: a catch that gives the failure its own identity",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "catch\\s*(?:\\(\\s*[^)]{0,60}\\)|\\{)[\\s\\S]{0,240}?(?:set[A-Za-z]{0,20}(?:Error|Failed|Kind)|addToast|toastCatch|reportError)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "Compliant half of the same anchor: the rejection writes an error/flag the UI can branch on."
  },
  "floor": 4000
}
```

**Validation.** Private scratch registry only, never the full registry: violating
**44 files / 49 matches**, control **385 files / 936 matches**, 4,801 files walked,
floor 4,000, exit 0. Re-extracted from this document after writing and re-run —
identical.

**Hand-verified precision: 12/12 on the sample opened** (`CompetitionList.tsx:59`,
`StrategyLeaderboard.tsx:17`, `KpiProposalsPanel.tsx:45`, `useAnnotationData.ts:54` read
in full; `ReauthBanner.tsx:110`, `CredentialTemplateForm.tsx:129`, `EventHistoryModal.tsx:33`,
`useSubscribedFeeds.ts:22`, `CloudWebhooksTab.tsx:98`, `PresetLibraryPage.tsx:45`,
`SourceDefinitionInput.tsx:126`, `PresetStudio.tsx:36` read from the extracted handler
body). No false positives in the sample.

**The `[^}]` in the pattern is load-bearing and was earned.** The first draft used
`[\s\S]{0,220}`, which walked past the closing brace of the catch and paired a
`catch(silentCatch(…))` with a `setX([])` belonging to a *later statement* — 6 false
positives, including `boardShared.tsx:149`, `GraphPanel.tsx:106` and
`skillsManagerData.ts:104`. Forbidding an intervening `}` took the count from **50/55 to
44/49** and removed all six. This is the doctrine's *"check that your matcher composes,
not just that it counts"*, met head-on.

**Site-level overlap against the FINAL pattern: zero.** Measured against all **195**
registered rules. The nearest conceptual neighbour is
`read-failure-as-empty-value` (owned by
[`partial-failure-read-envelope`](./partial-failure-read-envelope.md), baseline 32 files /
68 matches), which targets a catch that **returns** `[]`/`null`/`0` from a
name-matched read; this rule targets a catch that **writes** `[]` into React state. File
overlap is **3 of my 44 files**, site overlap **0 of 49**. Of the seven inventory files I
checked explicitly, `read-failure-as-empty-value` covers exactly one
(`useAutomationSetup.ts`) and misses `ConnectorCredentialModal.tsx`, `useAddKpi.ts`,
`useBrainConnection.ts`, `ExecutePersonaPicker.tsx`, `SourceDefinitionInput.tsx` and
`GitHubRepoSelector.tsx`.

**How it fails loudly.** It inherits the census runner's structural assertions: a walk
under `floor: 4000` fails, zero matches anywhere fails, an unannounced drop fails. The
control has no `baseline` by design — the merger skips controls and `validateRule` rejects
one that carries a baseline. **If this condition ever reaches zero the rule must be
deleted, not baselined at 0**; the census cannot express "must be zero".

**Prevalence, stated as doctrine now requires.** This is neither a 0% nor a 100%
condition: violating **44** files against a compliant **385** files on the same anchor
(~10% of handlers). The control returns a large non-zero number, so a zero from it in a
future run means the pattern broke, not that the repo converged.

**What the census still cannot gate here.** Three of §7.3's findings are absences and
none is countable: a `Promise.all` with no rejection path (7.3b) is the *absence* of a
`.catch`; a picker with no loading arm is the absence of a branch; and `safeInvoke`'s
unregistered-command fallback (7.3c) is a correct call site whose *consumer* is missing a
case. The instrument that would catch 7.3b is an ESLint rule on `Promise.all(…).then(…)`
with no sibling `.catch`/`.finally` — structural, AST-shaped, and therefore ESLint's job
rather than the census's, per the contract's split.

---

## §12 — Corrections

### 12.1 The brief's framing was right and the answer is already in the repo

The brief posed this leaf as the sibling of `external-operation-explorer`: *"when a form's
options come from a connector rather than from a static list, what happens before the
connector is ready? An option list that is empty because the credential is missing looks
identical to one that is empty because the account has no resources."*

**Confirmed as a defect at 23 of 31 sources — and refuted as a repo-wide characterisation.**
This codebase contains a complete, documented, user-bug-driven answer
(`errorKind: 'no_credential' | 'fetch_failed'`), a second independent one
(`ResourcePicker`'s `fetched` flag), and the machine census puts the compliant handler
shape ahead **385 files to 44**. The finding is **transfer, not ignorance** — the same
shape the doctrine records for `entity-picker`, where a solved problem failed to cross a
component boundary. The prescription is therefore *"route people to the two instances that
already exist"*, not *"invent a state machine"*.

### 12.2 Two implementations, and the disagreement was in the matcher

Both counts were produced twice.

- **Implementation A** (bespoke walker, whole-file `matchAll`, four candidate patterns
  measured side by side) established the candidate set and its prevalences:
  `(x ?? []).map(` at 6/6; `options={… ?? []}` at 2/2; `useState<T[] | null>(null)` at
  43 files / 49 sites; `useState<T[]>([])` at 205 files / 285 sites.
- **Implementation B** (a second walker with a different traversal order and a
  separately-authored regex, plus a negative lookahead for error-recording) produced the
  shipped rule. The two agreed on the shape and **disagreed on the count — 55 vs 49** —
  because A's window crossed statement boundaries. Opening the six differing sites showed
  A was wrong at all six. The `[^}]` constraint is the reconciliation.

Recording it because the disagreement was *small* and the larger number was the plausible
one; a single implementation would have shipped 55 with an unexamined 11% false-positive
rate.

### 12.3 A brief lead corrected: `LoadingSpinner` here is worse than "a spinner"

The brief flagged `null-spinner-busy-state` (50 files / 68 matches, from
[`manual-test-fire`](./manual-test-fire.md)) and asked for a site-level check before
publishing anything overlapping it. **Zero overlap** — this path's rule matches `catch`
bodies, not JSX ternaries.

But the check turned up something the neighbouring rule cannot see, and it belongs to this
leaf: **`KPIConnectWizard.tsx:225` and `:232` do not match `null-spinner-busy-state`
either**, because one is `&&`-guarded and the other's false branch opens with an
identifier rather than `<`. They are nonetheless the same defect in its worst form — a
`LoadingSpinner` standing in for a *failed* option fetch, rendering nothing, forever. The
broader under-reporting of that rule (a further 27 files / 30 matches in the
Prettier-wrapped `? (` form, plus 6 in the `&&` form) is documented with its numbers in
[`connector-setup-panel`](./connector-setup-panel.md) §12.3, which is the sibling
document from this same wave.

### 12.4 The `sides: "client"` label holds here, and for the structural reason

The spine says `sides: "client"`; the same node says `twoSided: true`. For this leaf the
`"client"` half is the honest one: every deviation in §7, the exemplars in §2, the census
rule, its control and its floor are frontend TypeScript. The backend's contribution is
`discover_connector_resources` / `list_connector_resources` returning a list or an error,
which is the correct contract and is not where anything goes wrong. **The mechanism is
that the option list is a rendering decision — the server never sees which of five states
the picker is in** — the same structural reason the doctrine records for the two upheld
`"client"` labels (`bulk-selection-actions`, `long-list-rendering`: *the server never sees
the DOM*). This is a third upholding, and it is worth as much as the seven contradictions.

The `convergence: "mixed"` label, by contrast, is **untestable for this leaf**: the
situation requires an app that calls a *user's own* third-party service to fill a form
control, and per the sibling sweep run for
[`connector-setup-panel`](./connector-setup-panel.md) §10, none of the five sibling
checkouts holds third-party credentials on a user's behalf at all. Silence, and it is the
same silence — reported as silence, not read as a verdict.
