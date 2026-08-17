# Golden path — Entity picker

> Situation node: `ui-system` › `overlays` › `entity-picker` ·
> [situation spine](../situation-spine.md) · recurrence 17 · risk **medium** ·
> sides: **client** (upheld, and for a reason worth naming — §12.1) ·
> convergence: **diverged** (upheld on 3 of 6 clauses, inverted on 2, and the fleet
> converged on the *disease* on the sixth — §6) ·
> dimensions: **ui · function**
> Leaf definition: *"Finding and switching among existing entities of one kind."*
> `mergedFrom`: *Searchable entity picker* + *Entity switcher dropdown*
> Composed 2026-08-17 against `master` @ `50d736f6c`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (**1,989** `.tsx` excluding `__tests__`). Every
> raw `<select>` in the tree enumerated **three times** — once with the census rule's own pattern, once
> with an independent pattern after comment stripping, and once per-site with its option source
> extracted — settling the corpus at **64 sites in 47 files** and resolving the brief's 47 against the
> census's 46 (§12.3). **55 entity-picker surfaces** enumerated across two independent sweeps, each row
> carrying `file:line` for its option derivation, its narrowing, its disclosure, its
> current-value handling and its loading/empty/error branches. Every candidate census signal
> partitioned into violating vs compliant and hand-verified. All **162** census rules intersected
> against the final pattern at **site** level.
>
> **Measured by EXECUTING, not by reading.** The Chain Studio target rail was transcribed
> **statement for statement** — `attentionFor` (`personaStats.ts:197-208`), `healthyPersonas`
> (`useStudioComposer.ts:74`), `filteredTargets` (`StudioRails.tsx:179-181`), the render and its empty
> branch (`:210-222`), and `PersonaOptionCard` (`StudioOptionCards.tsx:58-77`) — into a **jsdom 29.1.1
> + React 19.2.6** harness loaded through the repo's own `node_modules`, and driven over the operator's
> **real 78 personas** read from a **read-only copy** of the live **347 MB `personas.db`**, copied
> 2026-08-17 12:43 UTC with the app running. The command palette's scorer
> (`commandPaletteUtils.ts:124-137`) and its four result caps were replayed verbatim over the real
> **78 personas · 25 credentials · 316 recipes · 8 teams**. The live files were never opened for write;
> **nothing was written anywhere**; the copies were deleted afterwards. Recorded substitutions: JSX →
> `React.createElement` (the harness has no build step); `PersonaIcon` reduced to a marker element;
> `Tooltip` omitted, because `Tooltip.tsx:205,310` renders its content only when `visible` — the
> description is **hover-only and not in the initial DOM**, which is the fact the row-ambiguity finding
> turns on. **The instrument was asserted before it was trusted** — the harness exits 2 if it mounts
> zero rows or reads fewer than ten personas.
>
> **`cargo` was not run.** Every backend claim is SQL replayed against the copy.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. Lineage checked in both directions.
> **Effective independent cohort: 3** (§6).
>
> **Settles:** which of the user's entities a chooser is allowed to leave out, what it owes the reader
> when it does, and what it must say when the thing already chosen is no longer there.

---

### Sibling boundaries, settled in prose

This leaf sits one door down from the corpus's largest UI path and shares call sites with four others.
The seams, each checked against the neighbour's own text:

- [**`dropdown-and-select`**](./dropdown-and-select.md) **owns the control; this owns the
  population.** That path (recurrence 110, high risk) settles *which primitive*, the keyboard model,
  the ARIA, the portal z-order, the option theming, and the three-state contract for
  connector-sourced options (its D7). **It never asks which records reach the option array.** This
  path asks exactly that, and nothing else: what the picker was given, what it left out, what it
  shows about each survivor, and what it does when the current value is not among them. Where the two
  touch — `ThemedSelect`, `Listbox`, `<select>` — this path cites the neighbour and does not
  re-prescribe. One correction is returned to it in §12.5.
- [**`filtering-and-search`**](./filtering-and-search.md) **owns a filter over a list already on
  screen; this owns a chooser.** The discriminator is what the control produces: a filter narrows
  what you are *looking at* and produces a view; a picker narrows what you can *choose* and produces
  an id. Fourteen surfaces were excluded from this leaf's population on exactly that test
  (`PersonaColumnFilter.tsx:19`, `MemoryFilterBar.tsx:38`, `ProjectFilter.tsx:70`,
  `ActivityFilters.tsx:79,92,106`, `CloudHistoryPanel.tsx:166`, `GitOpsVersionHistory.tsx:100`,
  `DeploymentHistoryTab.tsx:88`, `ArenaPanelColosseum.tsx:558`, …).
- [**`bulk-selection-actions`**](./bulk-selection-actions.md) **owns selecting many; this owns
  selecting one.** Its §0 measures a `pageSize={25}` select-all that acts on 78; this path's §0
  measures a *pick-one* list that offers 40 of 78. Its `unreconciled-selection-set` rule and this
  path's rule were intersected at site level: **zero collisions** (§9). Six surfaces were excluded
  here for being multi-select (`ExecutePersonaPicker.tsx:18-19`, `ResourcePicker.tsx:121-157`,
  `ComposerMessagingPickerModal.tsx:173-191`, `ContextPickerModal.tsx:34,40-47`,
  `ucPicker.tsx:43,55`, `useExportPicker.ts:163`) — and two of them are cited below as **exemplars**,
  because the best answers in the tree to this leaf's hardest questions happen to live in
  multi-select code.
- [**`long-list-rendering`**](./long-list-rendering.md) **owns how many rows may render; this owns
  which records may be offered.** Its §1 exclusion — *"a collection whose length is a property of the
  code"* — is **adopted verbatim** here rather than re-derived, and it is what removes colour, icon,
  language, transition, day-range, trigger-type and sort-order pickers from this population. Its
  `.slice(0, N)` census (**66 sites in 54 files, 27 disclosing nothing**) is **cited, not
  re-measured**; §0-B measures what four particular slices cost inside one picker.
- [**`view-state-persistence`**](./view-state-persistence.md) **owns the token that outlives the
  process; this owns the door it came in through.** Its finding — a persisted `activeProjectId` that
  production files act on and nothing reconciles on fetch — is where this leaf's §0-C ends up. The
  seam: it owns *storage and rehydration*; this owns *the moment of choosing and the moment of
  showing what was chosen*. Its rule keys on a `persist()` partialize entry; this one keys on a
  render expression. **Zero site collisions** (§9).
- [**`anchored-popover`**](./anchored-popover.md) owns positioning and outside-click dismissal for
  every floating surface including these. Not re-proposed.
- [**`catalog-browse-and-apply`**](./catalog-browse-and-apply.md) owns choosing a *template to
  install*; this owns choosing an *entity that already exists*. `TemplatePickerStep` sits on the
  seam and is reported here only for its 12→3 narrowing (§0-B), not for its install path.
- [**`empty-and-demo-states`**](./empty-and-demo-states.md) and
  [**`page-loading`**](./page-loading.md) own the three-state contract in general. This path states
  only the picker-specific *fourth* state the fleet's best member has and this repo does not
  (§6 clause 5).

---

## 0. The headline

**A chooser in this app is free to leave records out and free to say nothing about it, and both
freedoms are exercised. Executed against the operator's own database, the Chain Studio target rail
offers 40 of his 78 personas, and searching it for the exact name of any of the other 38 answers
`No targets match "Director"` — the picker denying, by name, a persona that exists. Of the 40 it does
offer, 28 are labelled with a string that another offered row also carries.**

### A — the rail hides 38 of 78, and its empty state blames the reader

`useStudioComposer.ts:74` is the whole narrowing:

```ts
const healthyPersonas = useMemo(() => personas.filter((p) => attentionFor(p) === null), [personas]);
```

`attentionFor` (`personaStats.ts:197-208`) returns non-null on three predicates: `setup_status ===
'needs_credentials'`, `enabled === false`, and `trust_score < 0.5`. Both rails consume it
(`StudioRails.tsx:74`, `:179`) and neither renders a count, a badge, a footnote or a toggle.

Harness, real rows:

```
personas rows in the table                    : 78
option rows that reach the DOM (empty query)  : 40
hidden, with nothing on screen saying so      : 38  (48.7%)
  by predicate                                : {"setup":29,"low_trust":7,"disabled":2}
```

Then the same component, driven once per persona with that persona's exact name in its search box:

```
names searched                                : 78
searches that returned at least one row       : 40
searches that returned "No targets match ..." : 38
distinct names that can never be found        : 8
  Director | QA Guardian (2) | Dev Clone (3) | T: Release Manager | T: Dev Clone | T: QA Guardian | …
  render(query="Director") -> rows=0 empty=true text="No targets match \"Director\""
```

`StudioRails.tsx:221-223` renders `tx(st.no_targets_match, { query })`. **The one sentence the
surface says about its own emptiness names the query, and the query is not the cause.** A reader who
types a name they can see elsewhere in the product is told the name does not match — which is the
strongest possible false negative, because it is phrased as a fact about their input.

**The predicate is editorial, not constitutive.** Nothing about a paused or unconfigured persona
makes it an invalid chain *target*: `commitLink` (`useStudioComposer.ts:89-110`) writes a `chain`
trigger whose target is a persona id, and a disabled persona simply does not run when the chain
fires. The picker is not preventing an error; it is expressing a preference. That distinction is
this leaf's centre and §2 turns it into a rule.

### B — four more narrowings, measured, none of them announced

| Surface | The narrowing | `file:line` | What it costs, on the real corpus |
|---|---|---:|---|
| Chain Studio rails | `attentionFor(p) === null` | `useStudioComposer.ts:74` | **38 of 78 personas** |
| Onboarding template picker | `getTrendingTemplates(STARTER_POOL)` then `prioritizeZeroCredential(reviews).slice(0, 3)` | `useOnboardingState.ts:22,207,228` | **12 fetched, 3 shown** — the first thing a new user ever picks from |
| GitHub repo selector | `'/user/repos?per_page=100&…'` | `GitHubRepoSelector.tsx:102` | repo 101 is unreachable, and the search box at `:178-180` filters **only the fetched page**, so searching for a truncated repo answers `no_repositories_found` (`:229-231`) |
| Codebase project picker | `listProjects('active')` | `CodebaseProjectPicker.tsx:49` | every non-active project invisible; the literal `'active'` is the entire policy |
| Radio station picker | `stations.filter((s) => !disabled.has(s.id))` | `StationPicker.tsx:47` | a hidden station **keeps playing** while its row is gone — the code says so at `:43-46` |

And the global command palette, whose caps are the `.slice(0, N)` family
[`long-list-rendering`](./long-list-rendering.md) counted, replayed verbatim
(`CommandPalette.tsx:235`, `:251`, `:260`, `:229`) over the real corpus:

```
corpus: personas 78 · credentials 25 · recipes 316 · teams 8
caps  : agents 20 · credentials 10 · templates 10 · settings 12
disclosure of a cap anywhere in CommandPalette.tsx / CommandPaletteResults.tsx: NONE

query | agents matched/shown | creds matched/shown | templates matched/shown | discarded
  "e"  |  78/20 |  23/10 | 309/10 | 370
  "a"  |  78/20 |  24/10 | 284/10 | 346
  "i"  |  78/20 |  21/10 | 295/10 | 354

over every 1-4 char prefix and every full name of every real record:
  distinct queries replayed                  : 807
  queries where a cap silently discarded hits: 494  (61.2%)
  total results discarded across those runs  : 42,733
```

**And the honest half, which inverts what the brief expected (§12.2):** a cap is not a reachability
failure here. Because `fuzzyScore` returns 100 for an exact match and the list is sorted descending,
**0 of 316 templates and 0 of 78 personas fail to surface when you type their exact full name.** The
cap costs *discovery*, not *reach*. That is a materially weaker charge than the rail's, and it is
worth stating precisely, because the two defects need different fixes: the rail needs to stop hiding,
the palette needs to say `+289 more`.

### C — the picker is where a ghost id is born, and the ghosts are real

`view-state-persistence` found a persisted `activeProjectId` that production files act on and nothing
reconciles. Re-measured here: **48 non-test files read `activeProjectId`** (49 including tests), and
the complete list of things that reconcile it is three entries long:

| Where | Line | What it actually covers |
|---|---|---|
| `useWorkspaceSwitch.ts` | `:38-46` | **The only real reconciler**, and it fires only on an explicit workspace switch |
| `devToolsProjectSlice.ts` | `:168` | Clears it when *this session* deletes that project |
| `LifecycleProjectPicker.tsx` | `:35-39` | Auto-selects `projects[0]` **only when the id is already falsy** — a stale non-null id is deliberately left alone |

`fetchProjects` (`devToolsProjectSlice.ts:98-106`) sets `projects` and never looks at
`activeProjectId`. The file that does the reconciling states the problem in its own header, and it is
the best sentence in this leaf:

> `useWorkspaceSwitch.ts:1-8` — *"The load-bearing part is the RE-VALIDATION: `activeProjectId` is
> persisted (systemStore partialize) and **is never checked against the workspace**, so switching
> workspaces while a foreign project stays active would leave every dev-tools surface acting on a
> project the user can no longer see."*

**Dangling ids are not hypothetical in this install.** Replayed in SQL over the copy, with a
namespace check the first pass lacked (§12.6):

```
distinct persona ids recorded somewhere in this database whose persona row no longer exists : 211
personas that DO exist                                                                      :  78

LIVE CONFIGURATION tables (a dead id here is a broken binding)      332 rows across 7 columns
  doc_status.project_id                     297 of 1901 rows ·   2 distinct dead ids
  memory_nodes.context_id                    13 of   16 rows ·  10 distinct dead ids
  dev_goals.context_id                        9 of   11 rows ·   4 distinct dead ids
  skill_registry.project_id                   6 of   71 rows ·   2 distinct dead ids
  persona_background_job.persona_id           2 of    2 rows ·   1 distinct dead id
HISTORY / AUDIT tables (naming a deleted row is legitimate there)  6,199 rows across 9 columns
```

**2.7 dead persona ids for every live persona.** So the question "what does the picker show when the
current value is not in the list" is not an edge case in this product; it is the common case, and the
answer measured across the 55 surfaces is *nothing* at 48 of them: `ThemedSelect.tsx:156` renders
`selectedOption?.label ?? placeholder`, so every one of its consumers renders a dead id as **unset**;
native-mode `ThemedSelect` (`:255-274`) renders it as a **blank box**; `PersonaSelector.tsx:50,86-91`
renders it as **"All personas"** — the widest possible scope, from the narrowest possible cause.

### D — what a row shows, measured as a controlled experiment inside one product

The operator's 78 personas contain **nine names that each occur exactly seven times, once per team**:

```
T: Solution Architect  rows=7  distinct teams=7      T: Release Manager  rows=7  distinct teams=7
T: Code Reviewer       rows=7  distinct teams=7      T: QA Guardian      rows=7  distinct teams=7
T: Security Sentinel   rows=7  distinct teams=7      T: Product Strategist rows=7 distinct teams=7
T: Docs Steward        rows=7  distinct teams=7      T: Dev Clone        rows=7  distinct teams=7
T: Visual Brand Asset Factory  rows=7  distinct teams=7
teams: Product & Engineering | SDLC — Local SEO Agency | SDLC — Medical Bill Negotiator |
       SDLC — ai-bookkeeper | SDLC2 — ai-paralegal | SDLC2 — Grant Writing |
       SDLC2 — Apprenticeship | SDLC2 — Immigration
```

**The team is the only thing that tells them apart.** Two pickers over that same collection, in the
same product, at the same moment:

| | Chain Studio rail — `PersonaOptionCard` (`StudioOptionCards.tsx:58-77`) | Command palette — `agentItem` (`commandPaletteUtils.ts:162-169`) |
|---|---|---|
| what the row renders | `PersonaIcon` + `{persona.name}` + a headless glyph | `label: p.name`, `description: groupMap[p.home_team_id]` |
| the description | inside a `Tooltip` — **hover only**, `Tooltip.tsx:205,310` | rendered in the row |
| **rows offered** | **40** | 78 |
| **distinct visible labels** | **16** | 78 |
| **rows not uniquely identified by what is shown** | **28 (70.0%)** | **0 (0.0%)** |

```
colliding labels on the rail: T: Solution Architect x7 | T: Code Reviewer x7 |
                              T: Security Sentinel x7 | T: Docs Steward x7
colliding labels whose DESCRIPTION is also identical: 4 of 4
```

The last line closes the escape hatch: the hover tooltip would not disambiguate them either, because
all seven copies of each name also share a description. **The rail is a 70%-ambiguous chooser whose
consequence is a chain wired to the wrong team's persona, and the fix is one field that the same
codebase already renders one folder away.** For contrast, the *template* rows in the palette are
12.7% ambiguous (40 of 316 share both name and category) — so the palette is not perfect either; it
is simply the one that carried the distinguishing fact where it had one.

### E — the denominators, measured twice, and the discrepancy resolved

The brief warned that adoption would swing on the denominator, as it did 6× on `tab-strip` and 6.9×
on `long-list-rendering`. Here it does not swing — but the raw-`<select>` corpus needed three
measurements to settle, and the disagreement was informative rather than cosmetic (§12.3):

| implementation | files | matches |
|---|---:|---:|
| the census rule's pattern, whole file, **no comment handling** | 51 | 69 |
| an independent pattern, block + line comments blanked | **47** | **64** |
| the census runner itself (`raw-select`, which excludes the primitive) | 46 | 63 |

All three are right. 51 counts four matches that live in comments and strings
(`parameterEditing.tsx`, `OllamaCloudPresets.ts`, `TwinPicker.tsx`, `eventTypeTaxonomy.ts`, plus one
of `ThemedSelect`'s two); 47 is the tree; 46 is the tree minus `ThemedSelect.tsx`, the primitive
itself. **The brief's 47 and the census's 46 were never in conflict.**

The leaf's own denominators:

| denominator | what it counts | count | narrows its options | discloses the narrowing |
|---|---|---:|---:|---:|
| **D1** — every raw `<select>` site | includes enum/preset selects | **64** in 47 files | — | — |
| **D2** — …whose `<option>`s are mapped from a data-determined collection | the entity selects inside D1 | **25** files | — | — |
| **D3** — every entity-picker surface, by hand-verified enumeration | the leaf | **55** (54 live, 1 dead) | **28** | **10**, of which **1** publishes a number that reveals what is missing |

**D3 is the number to quote for the prescription.** Its one full-credit member is
`usePickerFilters.ts:68-105`, whose per-facet counts are each computed against a base that excludes
*that facet* (`applyFilters(list, except)`, `:81-99`) so every filter shows what it would cost before
you apply it. One of fifty-five.

### The rest of the inventory

| | count |
|---|---:|
| entity-picker surfaces enumerated | **55** (54 live; `TwinPicker.tsx` has **zero importers**). Several files host two — `SlackBridgePickers.tsx` picks a persona *and* a credential; `SourceDefinitionInput.tsx` picks a project *and* a database credential |
| …that narrow their option set beyond the user's own search | **28** |
| …that narrow **and disclose it in any form at all** | **10** |
| …that disclose a **number** from which the reader can tell what is missing | **1** (`usePickerFilters.ts`) |
| …that distinguish loading vs fetch-failed vs genuinely-empty | **7** (one of them, `TableSelector.tsx`, has zero consumers) |
| …that detect a current value missing from the list | **7** |
| …that *tell the user* the current value is missing | **1** (`ResourcePicker.tsx:282-313`, and it is multi-select) |
| raw `<select>` sites / files | **64 / 47** (census baseline 46/63 excludes the primitive) |
| `ThemedSelectOption.description` — declared at `ThemedSelect.tsx:12`, read anywhere in that file | **0 times** |
| files that hand `ThemedSelect` a `description` it will drop | **12** (verified: `LifecycleProjectPicker.tsx:63`, `SourceDefinitionInput.tsx:329` — both pass `root_path`, the exact disambiguator for two same-named projects) |
| non-test files reading `activeProjectId` | **48** |
| …that reconcile it against the fetched list | **1** (`useWorkspaceSwitch.ts:38-46`) |
| census rules in the registry | **162** — **0** key on option-set membership, narrowing disclosure, or a current value's existence |
---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and the leaf's centre.** **A chooser may only leave out an option that would fail
> if chosen. Every other exclusion must remain visible.** The test is one question, asked out loud:
> *if the user picked the record you are hiding, would the operation be invalid?* If yes, the
> exclusion is part of the answer — hide it, and name the reason when the narrowed set is empty. If
> no, the exclusion is an opinion the picker is holding on the user's behalf, and it must be
> expressed as a **disabled option carrying its reason**, never as an absence.
> *Warrant: executed — a rail that excludes personas on a health predicate offers 40 of 78, and
> nothing about the excluded 38 would make the operation fail; and in the fleet the one repo that met
> this situation independently chose exactly the disabled-with-a-reason form, while the repo that
> built a hide-switch never turned it on at any call site.*
>
> **P2 — physics.** **A chooser that narrows must never let its empty state blame the query.** "No
> matches for X" is a claim about the reader's input. When the set is empty because of a predicate
> the reader did not write, that sentence is false, and it is false in the most expensive direction:
> it tells someone a record does not exist when they can see it elsewhere in the product.
> *Warrant: executed — searching a rail for the exact name of each of 78 real records returns
> `No targets match "<name>"` for 38 of them, 8 of which can never be found by any query; and the
> pickers in this tree that do it correctly split the empty state in two, one arm naming the search
> and one naming the scope.*
>
> **P3 — physics, and the one this leaf exists to say.** **A picker must show the fact that
> distinguishes two candidates, not the fact that names them.** Identity is not a label. The row's
> job is to let a reader choose correctly, which means carrying whichever field actually separates
> the options *in this user's data* — an owner, a scope, a path, a status, a time.
> *Warrant: measured as a controlled experiment inside one product — nine names each occur seven
> times, once per team; the picker whose row carries the team is 0% ambiguous over 78 rows, and the
> picker one folder away whose row carries only the name is 70% ambiguous over the 40 rows it offers,
> with the hover text unable to break the tie either. And two independent sibling repos converged on
> rows carrying four to seven distinguishing facts, one of them binding the picker's caption to the
> detail view's caption so the two cannot drift.*
>
> **P4 — physics.** **A chooser must be able to say "the thing you chose is gone."** A selected id is
> a reference to a row that can be deleted, renamed out of scope, or filtered away, and the reference
> outlives the row. Resolving it with an expression that coalesces absence into a default makes a
> dead reference indistinguishable from no reference — the two states that most need to be told apart.
> *Warrant: replayed in SQL over the live database — 211 distinct entity ids of one kind are recorded
> whose rows no longer exist, against 78 that do, and 332 rows in live configuration tables hold one.
> In the fleet, two repos independently invented a repair for this and **neither tells the user**; a
> third has the gap outright. Nobody in six codebases shows a "that item no longer exists" affordance.*
>
> **P5 — ergonomics.** **A chooser that caps its results owes the reader the count it discarded, and
> the count it prints must be the count it means.** A cap is a legitimate answer to a large corpus;
> silence about it is not. And a disclosed number that reports the post-cap length as the total is
> worse than no number, because it converts an omission into an assertion.
> *Warrant: replayed on real data — four caps in one surface discard results on 61.2% of realistic
> queries with no disclosure anywhere in the component or its renderer; one picker prints "All (N)"
> where N is the pre-filter length beside a post-filter list; and the one sibling in the fleet that
> announces a result count announces the capped one, so its announcement becomes false past its own
> limit.*
>
> **P6 — ergonomics.** **An option list from a fetch has four states, not three.** Loading,
> fetch-failed, you-have-none, and none-match-your-search are four different sentences with four
> different next actions, and collapsing any pair of them produces a specific, expensive mistake:
> collapsing failed into none makes people re-create records they already own.
> *Warrant: the repo's own code records that incident in a comment beside the fix; 48 of 55 surfaces
> here collapse at least two of the four; and the best member of the sibling cohort ships exactly
> four, having independently split empty-source from empty-after-filter.*
>
> **P7 — physics, and the reason this leaf keeps recurring.** **The narrowing and the disclosure must
> live at the same layer.** When the predicate is applied in a hook or a parent and the list is
> rendered in a child, the child cannot say what was removed and the parent cannot see that anything
> was hidden. Every silent narrowing measured here has that shape.
> *Warrant: the health predicate lives in a hook and both consuming rails render a filtered array
> with no access to the original; the one picker in the tree that discloses a real denominator
> computes the unnarrowed count in the same component that renders the list, in one line.*
>
> **Scale condition.** P1, P2 and P3 are invisible with five records and severe with fifty — they
> arrive exactly when the product succeeds. P4 arrives the first time anything is deleted. P5 arrives
> at the first cap. P6 arrives at the first failed fetch, and is the only one that can be observed on
> day one.

---

## 1. Trigger

- "Add a picker so they can choose which persona / credential / project / template this uses."
- "Let them switch the active project / workspace / team from the header."
- "Only show the ones that are ready / connected / healthy / not already used."
- "It says there are no matching agents, but I can see it right there."
- "Which one of these seven is it? They all say the same thing."
- "I deleted that project and now this dropdown just looks empty."
- "The picker is empty — is it still loading or do I have none?"

**If you are about to write** `entities.filter(...)` and hand the result to something the user
chooses from, **you are in this situation.** Also if you are about to write
`X.find((e) => e.id === value)?.name ?? placeholder`, or an empty state whose text interpolates a
search query, or a row whose only content is `{entity.name}`.

You are **not** in this situation when the collection's length is a property of the code rather than
of the data — a colour swatch grid, an icon set, a language list, a set of trigger types, a fixed
model catalog. That exclusion is [`long-list-rendering`](./long-list-rendering.md)'s and is adopted
verbatim. You are also not here for a **filter** over rows already on screen (that is
[`filtering-and-search`](./filtering-and-search.md)) or for **selecting many**
(that is [`bulk-selection-actions`](./bulk-selection-actions.md)).

---

## 2. The one way

**Give the picker the whole collection and let it disable what it must not offer; never hand it a
filtered array.** Concretely: (a) **choose the primitive by
[`dropdown-and-select`](./dropdown-and-select.md)'s rule, not this one** — that path owns the
control. (b) **Apply the one-question test to every predicate you are tempted to apply**: *would
picking this record fail?* If yes it is **constitutive** — exclude it, and when the narrowed set is
empty say **why** ("all personas are already deployed"), never "none found". If no it is
**editorial** — render the option **disabled with its reason on the row**, so the user learns the
record exists and what to do about it. (c) **Narrow and disclose at the same layer.** If a hook must
compute the predicate, have it return `{ all, offered, hiddenReason }`, not just the survivors — a
child handed an array cannot report what is missing from it. (d) **Put a distinguishing fact on the
row**: pick the field that actually separates *this user's* records, not the field that names them,
and prefer the same caption function the detail view uses so the two cannot drift. (e) **Resolve the
current value with a membership question, not a coalesce** — `list.some((x) => x.id === value)` —
and give absence its own render: the last-known label struck through, or a "no longer available"
row, plus a way to clear it. **Never `list.find(...)?.name ?? placeholder`**, which turns a dead
reference into "nothing selected". (f) **Render four states, not three**: loading, failed (with a
retry), you-have-none (with the CTA that creates one), none-match (with a clear-search action).
(g) **If you cap, print the discarded count where the rows stop** — `+289 more` — and make sure any
number you print is the pre-cap total, not the post-cap length. (h) **Then stop**: no second
"available" adjective invented per surface, no re-implementation of the same PAT list in three
files, no hand-typed id input beside a picker.

If you must get one right first: **(b)**. Every other clause is about telling the truth; that one is
about not withholding it, and it is the only clause whose violation is invisible to the person it
harms.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`triggers/sub_studio/routing/layouts/AddPersonaModal.tsx:82-83,:138,:249-262`** | **The reference call site.** `const availableCount = personas.filter(p => !alreadyActiveIds.has(p.id)).length` rendered as `` `${availableCount} available` ``; a **constitutive** exclusion (already connected); a per-group count `{ps.length}`; the team as a **group header** so the nine-way name collision resolves; and a two-armed empty state — search-empty with a *clear search* action (`:237-243`) vs scope-empty (`:245`). Copy this file. | 1 |
| **`vault/sub_catalog/components/picker/usePickerFilters.ts:81-105`** | **The only disclosure that is a number.** `applyFilters(list, except)` computes every facet's option counts against a base that excludes *that* facet, so each filter shows what it would cost before you apply it. This is P5 done properly and it is the hardest one to retrofit — build it in. | 1 |
| **`vault/sub_credentials/components/picker/ResourcePicker.tsx:229-238,:282-313`** | **The only surface in `src/` that tells the user a chosen record is gone.** `const stalePicks = st.fetched ? picked.filter((p) => !st.items.some((i) => i.id === p.id)) : []` — gated on `fetched` so a load or an error cannot false-flag — a banner listing each dead pick struck through, and an explicit **Drop stale** action. It is multi-select; the mechanism is not. | 1 |
| **`plugins/dev-tools/sub_projects/GitHubRepoSelector.tsx:184-188`** | **Rendering a value the list does not contain.** When the bound URL is not in the fetched page it parses owner/name out of the URL and shows that, with the reason in a comment. The general move: keep enough of the chosen record to render it without the list. | 1 |
| **`plugins/dev-tools/sub_workspaces/workspaceStore.ts:55-64`** | **`readActiveId(workspaces)`** — returns the stored id only if `workspaces.some((w) => w.id === activeId)`. The membership question in its correct form, at the store boundary where every reader benefits. | 1 |
| **`stores/slices/system/twinSlice.ts:339-343`** | **The strongest answer: do not store the id at all.** `activeTwinId` is *derived* from the fetched rows (`twinProfiles.find((t) => t.is_active)`), so it cannot dangle. Not in `systemStore`'s partialize. Where the active entity can be marked in the data, this removes P4 rather than handling it. | 1 |
| **`plugins/twin/sub_channels/ChannelsAtelier.tsx:83-86`** | **Auto-reconcile on scope change** — when the narrowed list has exactly one member select it, otherwise clear a value that is no longer in it. Three lines, and the only credential picker that does it. | 1 |
| **`agents/sub_connectors/components/connectors/CredentialPicker.tsx:86-89`** | **A row that carries the discriminator** — icon, `{cred.name}`, `{cred.service_type}`. Also [`dropdown-and-select`](./dropdown-and-select.md)'s `Listbox` exemplar; cited here for the third line only. | 1 |
| **`templates/components/SourceDefinitionInput.tsx:341-383`** | **Shape by cardinality**: zero → an explicit "you have no databases" alert with a CTA; one → a non-interactive card naming it; many → a searchable select. A picker with one option is not a picker. | 1 |
| **`vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx:39-44,:105-142`** | **The four-state option list**, with the incident that produced it recorded in the comment: when loading-failure and genuinely-empty rendered the same screen, users re-created projects they already had. Also [`dropdown-and-select`](./dropdown-and-select.md)'s D7 exemplar. | 1 |
| **`agents/sub_glyph/commandPanel/composer/ComposerEventPersonaList.tsx:49,:55,:76-78`** | **The two-armed empty state in its smallest form** — `personas.length === 0 ? "No other personas to listen to yet." : "No matches."` — plus a genuinely useful per-row fact: how many events that persona already subscribes to. | 1 |

**Explicitly NOT primitives:**

- **`ThemedSelectOption.description`.** Declared at `ThemedSelect.tsx:12` and **read nowhere in that
  file** — the trigger renders `selectedOption?.label ?? placeholder` (`:156`) and the option row
  renders `highlightMatch(opt.label, …)` (`:215`). Twelve files pass it; two of them
  (`LifecycleProjectPicker.tsx:63`, `SourceDefinitionInput.tsx:329`) pass `root_path`, which is
  exactly what tells two same-named projects apart. It is a disambiguation slot that silently
  discards its argument. §8 Gap 1.
- **`X.find((e) => e.id === value)?.name ?? placeholder`.** The subject of §9. It is not a lookup
  with a default; it is a lookup that has deleted its own error case.
- **A hook that returns only the survivors.** `healthyPersonas` is the shape; every consumer of it is
  structurally unable to satisfy P5 or P2.
- **A hand-typed id field beside a picker.** `ChannelsAtelier.tsx:214-216` binds a persona by
  free-text UUID input. Whatever the picker's shortcomings, this is not the workaround.

---

## 4. Steps

1. **Name the entity and get the whole collection.** One kind, one source. If the source is a store
   slice with no loading flag, fix that first — `credentialSlice.ts:33` exposes none, which is why
   roughly eight credential pickers cannot satisfy P6 no matter what they render
   ([`dropdown-and-select`](./dropdown-and-select.md) D7 root cause; not re-derived here).
2. **Apply the one-question test to every predicate.** Write the answer down in a comment next to the
   filter. `// constitutive: already a member, adding again is a no-op` or
   `// editorial: shown disabled with a reason`.
3. **Constitutive exclusions: filter, and name the reason in the empty arm.**
   `CloudDeploymentsPanel.tsx:115-117` is the pattern — the placeholder flips to "all deployed" when
   the narrowed list empties, so the reader learns the filter, not their bad luck.
4. **Editorial exclusions: do not filter.** Render the option `disabled` with the reason on the row.
   `SlackBridgePickers.tsx:52` already builds the reason string
   (`p.enabled ? undefined : ts.slack_bridge_persona_disabled`); the missing half is that other
   pickers drop the record instead of labelling it.
5. **Choose the row's discriminator by looking at real data, not at the type.** Ask: if this user has
   two of these, what differs? Team, path, service type, owner, updated-at. Render *that*. Reuse one
   caption function between the picker row and wherever the entity is shown next.
6. **Wire the current value as a membership question.** `list.some((x) => x.id === value)` decides
   which of three things you render: the resolved row, a "no longer available" row carrying the last
   known label plus a clear action, or the placeholder. Never let branches two and three be the same
   pixels.
7. **Render four states.** Loading; failed with retry; you-have-none with the create CTA;
   none-match with clear-search. Two of them are one `if` apart and are the pair that costs the most
   when merged.
8. **If you cap, print the remainder where the rows stop.** `+{total - shown} more`, computed from
   the pre-cap length.
9. **And then stop.** Do not invent a new adjective for "the ones we're offering" — this tree has
   `healthy`, `available`, `deployable`, `eligible`, `candidates`, `targetable`, `visible`,
   `importable`, and each means something different and says so nowhere. Do not re-implement the
   same scoped credential list a third time (`TeamList.tsx:97-105`, `ProjectModal.tsx:99-107`,
   `EditableProjectPipeline.tsx:42-45` are the same GitHub-PAT list written three times, all
   name-only, all collapsing a failed fetch into "you have none"). Do not add a free-text id input as
   an escape hatch.

### Can the type make the wrong call impossible? — asked before §9

Held against the seven qualifications in [the doctrine](../golden-path-doctrine.md).

**T1 — withhold the pre-filtered array. Make the picker take the collection plus a verdict function.**
The bad state is a call site handing a chooser an array from which records have already been removed.
Replace the `options: T[]` contract with:

```ts
options: T[];                                   // the WHOLE collection
unavailable?: (t: T) => string | null;          // non-null => rendered, disabled, with this reason
```

- **Q5/Q6 (withhold the dangerous freedom, not the answer) — the qualification that decides it, and
  it passes.** The dangerous freedom is *deleting a record from the list before the list is built*.
  Withholding it leaves every legitimate capability intact: constitutive exclusions still express
  themselves (return a reason and the row renders disabled), and the user still cannot pick them. It
  withholds the *invisibility*, not the *exclusion* — which is Q6's exact test. Compare the two forms
  that already ship: `SlackBridgePickers.tsx:52` computes a per-option reason and keeps the row;
  `useStudioComposer.ts:74` computes the same class of judgement and drops it. Same information, one
  API away.
- **Q1 (a type carries only what it encodes) — the honest limit, and it is large.** This closes §0-A
  and §0-D's cause. It says nothing about §0-B (the caps), §0-C (the dangling id), or P6 (the four
  states). It cannot: those are properties of a *different* value.
- **Q3 (a type nobody constructs constrains nothing) — passes, but only for the primitive's own
  consumers.** `ThemedSelect` has 77 usages across 44 files and `Listbox` 13; a prop added there
  reaches 90 call sites. It does **not** reach the 28 hand-rolled pickers in this leaf's population,
  which is why T1 is a prescription for new code plus a migration, not a one-line default change of
  the kind [`long-list-rendering`](./long-list-rendering.md)'s T1 was.
- **Q7 (relaxing a requirement is inert where the caller supplies the bad value voluntarily) —
  the qualification that shapes it.** Nobody forces `useStudioComposer` to filter. So the lever is
  not "make `options` required" (it already is); it is to make the filtered array *unspellable at the
  boundary* — the picker computes availability itself from a function it was handed, and there is no
  parameter through which a shortened array can arrive with its shortening unrecorded.

**T2 — YES, and it is smaller and lands sooner: make the current value's absence a state you must
name.** The bad state is `find(...)?.label ?? placeholder`. The type edit is at one primitive:

```ts
// ThemedSelect / Listbox trigger
const chosen = options.find((o) => o.value === value);
type Chosen<T> = { kind: 'none' } | { kind: 'present'; option: T } | { kind: 'missing'; value: string };
```

- **Q2 (requiredness is orthogonal to closedness).** This is the closedness edit, and it is the whole
  win. `selectedOption` is already `T | undefined`; making it required changes nothing, because
  `undefined` is legitimate for "nothing selected". Splitting `undefined` into `none` and `missing`
  is what the primitive cannot currently say.
- **Q4 (a type anyone can construct authenticates nothing) — passes, because nobody constructs it.**
  It is produced inside the primitive from `options` and `value`; a caller cannot forge a `present`
  for a record that is not in the list.
- **Q1.** Closes §0-C at the two shared primitives and their 90 call sites. Does not reach the 28
  hand-rolls, and does not reach the *store*, which is where the ghost actually persists — a picker
  that renders "no longer available" still leaves 48 files reading a dead `activeProjectId`. That
  half belongs to [`view-state-persistence`](./view-state-persistence.md), and the honest statement
  is that this leaf can make the ghost *visible* and cannot make it *go away*.

**T3 — NO for the caps (§0-B), and the reason is instructive.** A cap is a relation between two
numbers — how many matched and how many rendered — and the second is produced by a `.slice()` inside
a render expression whose input length is discarded at the same moment. No signature spans it. This
is the same shape as [`long-list-rendering`](./long-list-rendering.md)'s T2 refusal (the soundness of
a sort is a relation between two orderings held at two layers), reached independently from a
different leaf, which is some evidence the shape is general: **a type cannot encode a relation
between a value and a value that no longer exists.**

**Fix the primitive before pointing a gate at it.** T2 is the cheaper of the two and it is what makes
§9's rule *fixable*: today, a developer told "don't coalesce the lookup" has nothing correct to reach
for, because `ThemedSelect` gives them exactly one answer and it is the wrong one.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A predicate that hides records the user could legitimately pick** | Executed: 38 of 78 personas withheld from a chain-target rail, none of which would make the chain invalid. `useStudioComposer.ts:74`. §7 D1. |
| **An empty state that interpolates the search query when the search is not the cause** | Executed: the exact name of 38 real personas returns `No targets match "<name>"`. The reader is told a fact about their input that is false. `StudioRails.tsx:165-167,:221-223`. §7 D1. |
| **A row whose only content is the entity's name** | Executed: 28 of 40 offered rows carry a label another offered row also carries; nine names occur seven times each, once per team. `StudioOptionCards.tsx:73`. §7 D2. |
| **Putting the discriminator in a tooltip** | `Tooltip.tsx:205,310` renders content only on hover, so it is not in the DOM, not in a screenshot, and not reachable by scanning. And here it would not have helped: 4 of 4 colliding label groups share a description too. §7 D2. |
| **`X.find((e) => e.id === value)?.name ?? placeholder`** | A dead reference renders as "nothing selected". **26 sites in 25 files.** At `PersonaSelector.tsx:50,86-91` the fallback is *"All personas"*, so a deleted persona silently widens the scope to everything. §7 D3, §9. |
| **A native `<select value={id}>` with no membership guard** | Renders a blank box for an id with no matching `<option>`. `ThemedSelect.tsx:255-274`; live at `SystemEventCommitModal.tsx:68`, `SourceControlStep.tsx:82`. §7 D3. |
| **Collapsing a failed fetch into the empty state** | `.catch(...)` → `setX([])` → "you have none". `ExecutePersonaPicker.tsx:36-39`, `TeamList.tsx:105`, `ProjectModal.tsx:107`, `useBrainConnection.ts:72`, `useRadioState.ts:63-66`. The repo's own comment records users re-creating records they already owned (`CodebaseProjectPicker.tsx:39-43`). §7 D4. |
| **A denominator computed on the wrong array** | `PersonaSelectorModal.tsx:125` renders `All ({personas.length})` above a list of `filtered` — the number contradicts the rows the moment anyone types. A wrong number is worse than none (P5). §7 D5. |
| **A cap with no remainder** | Four caps in one component discard results on 61.2% of realistic queries and 42,733 results across them, with no `+N more` anywhere. `CommandPalette.tsx:235,251,260`; `CommandPaletteResults.tsx` has no disclosure at all. §7 D5. |
| **A fetch-side cap the client search cannot see past** | `per_page=100` with a client-side search box: searching for record 101 answers "no repositories found". `GitHubRepoSelector.tsx:102,178-180,229-231`. §7 D5. |
| **Narrowing in a hook and rendering in a child** | The child has no access to the unnarrowed array, so it *cannot* disclose even if its author wanted to. This is P7 and it is upstream of most of D1. |
| **A new adjective per surface** | `healthy`, `available`, `deployable`, `eligible`, `candidates`, `targetable`, `visible`, `importable` — eight words for "the ones we decided to offer", none defined anywhere. §7 D6. |
| **The same scoped list written three times** | Three independent GitHub-PAT pickers with the same predicate, the same silent failure and the same name-only row. Two PATs are indistinguishable in all three. §7 D6. |
| **A picker that offers exactly one option** | Not a choice; it is a confirmation. `SourceDefinitionInput.tsx:346-362` gets this right by swapping to a static card; most do not. |
| **A free-text id input beside the picker** | `ChannelsAtelier.tsx:214-216` binds a persona by hand-typed UUID. The escape hatch is evidence the picker failed, not a fix. |

---

## 6. Evidence

**The ONE file to copy: `src/features/triggers/sub_studio/routing/layouts/AddPersonaModal.tsx`.**

```tsx
// :82-83 — the denominator, computed in the component that renders the list (P7)
const availableCount = personas.filter(p => !alreadyActiveIds.has(p.id)).length;
// :138
<p>{`${availableCount} available`}</p>

// :50-58 — one filter, three predicates, each of them constitutive or user-driven
const filtered = useMemo(() => personas.filter(p => {
  if (alreadyActiveIds.has(p.id)) return false;          // constitutive: adding twice is a no-op
  if (selectedGroupId && p.home_team_id !== selectedGroupId) return false;   // the user's own chip
  if (q && !p.name.toLowerCase().includes(q) && !(p.description ?? '').toLowerCase().includes(q)) return false;
  return true;
}), [personas, alreadyActiveIds, selectedGroupId, search]);

// :249-262 — the team as a GROUP HEADER, with its own count: this is what makes
// nine seven-way name collisions readable without touching the row (P3)
{!selectedGroupId && (<div>…<span>{group.name}</span><span className="ml-auto">{ps.length}</span></div>)}

// :232-247 — two empty arms, not one (P2)
{search ? (<><span>{t.triggers.no_matching_personas_found}</span>
            <button onClick={() => setSearch('')}>{t.triggers.clear_search_label}</button></>)
        : 'All personas are already connected'}
```

Four decisions worth copying: **(1)** the denominator is computed where the list is rendered, so it
cannot go stale relative to it; **(2)** every predicate is either constitutive or something the user
turned on; **(3)** the discriminating fact rides on the group header rather than the row, which costs
nothing and resolves the collisions; **(4)** the empty state distinguishes "your search matched
nothing" — with the action that fixes it — from "there is nothing left to add", which is a completely
different sentence.

**Its two blemishes, named so the copy does not carry them:** the strings at `:132`, `:245`, `:213`
and `:257` are hardcoded English (`'Add Persona'`, `'All personas are already connected'`, `'All'`,
`'Ungrouped'`), against the i18n rule in `.claude/CLAUDE.md`; and the row still renders only
`{p.name}` (`:278`), so the group header is doing all the disambiguating work — inside a group filter
the collisions would return.

**Secondary exemplars, each for one clause:**

| Site | What to copy |
|---|---|
| `vault/sub_catalog/components/picker/usePickerFilters.ts:81-105` | **P5 done properly.** `applyFilters(list, except)` — each facet's counts computed against a base excluding that facet, so the numbers say what a filter *would* cost. Rendered at `:114,:121,:140,:147,:162-165,:176,:183`. |
| `vault/sub_credentials/components/picker/ResourcePicker.tsx:229-238,:282-313` | **P4 done properly, and the only instance in the repo.** `stalePicks` gated on `st.fetched` (so a load or an error cannot false-flag), a banner naming each dead pick, and a *Drop stale* action. Also the only picker here with a true tri-state list (`:275-280`, `:330-334`, `:335-339`). |
| `plugins/dev-tools/sub_workspaces/useWorkspaceSwitch.ts:1-8,:38-46` | **The problem statement and its repair in one file.** The header names the defect in plain prose; `switchWorkspace` re-points the active project into the new scope or clears it. |
| `stores/slices/system/twinSlice.ts:339-343` | **Deriving the active id from the data instead of storing it.** The only place in the repo where P4 cannot occur, because there is no stored reference to dangle. |
| `agents/sub_glyph/commandPanel/composer/ComposerEventPersonaList.tsx:49` | **The two-armed empty state in one ternary** — the cheapest correct answer to P2 in the tree. |
| `templates/components/SourceDefinitionInput.tsx:341-383` | **Shape by cardinality** — zero / one / many are three different controls, not three states of one control. |
| `plugins/dev-tools/sub_overview/OverviewParts.tsx:425-470` | **A dependent picker that discloses its dependency.** The Sentry project select's placeholder says which of "pick an org first" / "loading" / "no projects in this org" applies, and `:400-420` keeps a manual-slug fallback so a discovery failure never dead-ends. |

**Tests: none.** `forms/__tests__/` contains `ChatInputBar`, `FormErrorSummary`, `NumberStepper`,
`Slider` and `useAsyncFieldValidation`. There is no test anywhere for a picker's narrowing, its
disclosure, its empty-state arms, or what it renders for a value that is not in its options.

### Convergence — 5 sibling repos, effective cohort 3

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.**

**Lineage, checked in both directions.** No component name from this repo's picker stack
(`ThemedSelect`, `CredentialPicker`, `PersonaSelector`, `CommandPalette`, `useAnchoredPortalPosition`,
`DispatchChooser`) appears in any sibling; `Listbox` occurs only as the ARIA role string. No shared
comment text, magic constant or error string in picker code. Two exclusions apply:

- **`personas-cloud` is structurally absent and a downstream consumer.** It contains **zero `.tsx`
  files**, and `packages/orchestrator/src/index.ts:48` reads `data/personas.db` directly. It cannot
  converge or diverge on a UI clause, and a reader of this repo's data is not a second opinion about
  this repo.
- **`brainiac` abstains.** Its console ships one native `<select>` primitive
  (`console/src/components/ui/Input.tsx:152-184`) and no entity picker. Report as silence, not
  agreement.
- **`personas-web` is a partial consumer.** Its dashboard scope bar renders *this repo's* personas
  (`DashboardScopeBar.tsx:18` pulls `usePersonaStore`), so its **persona-picking** verdicts are
  weakly independent. Its **guide-search combobox** is a different problem domain and counts fully.
- `ascent` carries one self-declared port of this repo's dev-inspector overlay
  (`_dev-inspector/DevInspector.tsx:6`, *"mirrors the personas desktop app"*) — **not** picker code,
  so its picker verdicts stand.

**Effective independent cohort: 3** (vibeman, ascent, personas-web's guide search), plus one weak
(personas-web's persona picker) and two abstentions.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **A picker may hide options on a quality predicate** | **CONVERGED NEGATIVE, and `ascent` is AHEAD — P1's warrant** | Nobody in the cohort ships a health-predicate that silently hides. **vibeman built the switch and never turned it on:** `ProviderSelector.tsx:75-81` filters to configured providers behind `showAllProviders=false`, and **no caller passes false** (`LLMInputForm.tsx:182` passes `true`); its *shipped* behaviour discloses instead — `:129` a `"(Not configured)"` tooltip, `:166` opacity-50. **ascent invented P1 outright:** `ScanComparePicker.tsx:60,87` renders `disabled={s.id === afterId}` with the rationale in the header comment `:3-7`, and `PrRepoTable.tsx:69-90` folds by predicate behind a labelled `<details>` — *"{N} more repos with healthier signals"*, which is the exclusion, the count and the reason in one string. Personas is the only member of the fleet that hides. |
| 2 | **Cap and disclose** | **THE FLEET CONVERGED ON THE DISEASE — 0 of 3 disclose *in a picker*, while 2 of 3 independently wrote the idiom elsewhere** | vibeman: `ScanResultsModal.tsx:35,:247` `"Showing X of Y files"`; `BuildErrorResults.tsx:61,388`. ascent: `TeamAdoption.tsx:56` `"+N more teams"`; `contributors/page.tsx:114` `"Showing top 50 of N"`. **Neither wired it to a picker**, and ascent's picker cap lives at the data layer (`scans-read.ts:405`, `report/compare/page.tsx:84` `limit: 60`) where the UI cannot see it. personas-web is worse than silent: `lib/guide-search.ts:49,:106` caps at 15 and `SearchResultsPopover.tsx:106-108` **prints the post-cap number as the total**. This is the doctrine's "perfect agreement on an omission" shape with a twist — the fleet has the answer, in the same codebases, applied to tables and not to choosers. |
| 3 | **Reconcile a stale selected id** | **PHYSICS on the repair (2 of 3 independent reinventions) — SILENCE on telling the user (0 of 6)** | vibeman `stores/clientProjectStore.ts:239-253` `_verifyAndRestoreProject` → `getProject(id)` absent ⇒ `localStorage.removeItem(ACTIVE_PROJECT_KEY)` ⇒ fall back to `projects[0]` (`:230-237`). ascent `lib/db/scans-read.ts:436-437` builds a `Set` of ids and honours `?a=` only if present, with the rule in a comment `:433-435` — *"Honor requested ids only when they belong to this repo's scan set."* **Both repair silently**; ascent even leaves the bogus id in the URL. personas-web has the gap outright: `DashboardScopeBar.tsx:53-56` `personas.find(...) ?? null` renders "All personas" while the store keeps filtering by the dead id — **the same defect as `PersonaSelector.tsx:86-91`, arrived at independently, which is the strongest evidence in this document that the coalescing idiom is a trap rather than a slip.** Nobody in six codebases shows the user that the thing they chose is gone. |
| 4 | **A row carries distinguishing facts** | **PHYSICS (2 of 3, independently, and one of them went further)** | vibeman `ProjectSelectionItem.tsx:41-108` — name, type badge, port, "Connected to: X", "N connected projects", git repo + branch, run script: **seven facts**. ascent `WhatChangedParts.tsx:13-22` — a shared `scanCaption` of `score · level · timeAgo · engineProvider · latest`, with the comment stating *why* it is shared: **"so the dropdown and the diff headline can't drift"** — an anti-drift rule this repo has nowhere. personas-web adds match-provenance badges (`SearchResultsPopover.tsx:88-100`) nobody else has, while its own persona row is name-only (`DashboardScopeBar.tsx:134-136`). |
| 5 | **Loading / failed / empty as distinct screens** | **ascent is AHEAD OF THE FRAMING — it ships four** | `InstallationRepos.tsx:44` loading skeleton, `:45-49` error with `role="alert"`, `:50-63` empty-source with a recovery deep-link, and `:113-115` **empty-after-filter as a distinct fourth screen**. vibeman (`UniversalSelect.tsx:237-246,:345-348`) and personas-web (`SearchResultsPopover.tsx:48-52,:53-56`) both stopped at two and **both omitted error, independently**. P6 is written as four because a sibling proved four is the real number. |
| 6 | **Search inside the picker announces its result count** | **personas-web ALONE and AHEAD — and its number is wrong** | `SearchCombobox.tsx:146-152` — `aria-live="polite"` sr-only *"N results for {query}"* / *"No topics found for X"*, full combobox ARIA at `:157-162`, visible count at `SearchResultsPopover.tsx:106-108`. **The announced count is the capped 15**, so past 15 matches the announcement asserts a falsehood — clause 2 and clause 6 colliding inside one component. vibeman and ascent both shipped a search box and both skipped the count. Personas has an `aria-live` result count inside `Listbox` (`Listbox.tsx:184-188`) and **1 of 13 `Listbox` call sites enables `searchable`**, so the mechanism exists and is unreachable at almost every picker. |

**Summary: the label `diverged` holds, on 3 of 6 clauses** — hiding on a predicate (Personas alone),
disclosure of caps in a picker (nobody, but two siblings have the idiom next door), and telling the
user about a dead reference (nobody). It is **inverted on 2**: rich rows and stale-id repair are
things the fleet independently reinvented and Personas mostly did not, so on those the fleet is
converged and *this repo* is the outlier. And on clause 5 the framing itself was wrong: three states
is not the answer, four is.

### The composition defect with a neighbouring path — offered upward

[`long-list-rendering`](./long-list-rendering.md) §2(g) prescribes *"print what is shown against what
exists"*, and [`filtering-and-search`](./filtering-and-search.md) owns facet counts. Follow both
inside a picker that also narrows editorially, and you get a surface that prints
`showing 40 of 40` — a true statement about the array it was handed and a false one about the user's
data. **A denominator is only honest if it is taken before the last narrowing, and neither
neighbouring path says which array to count.** The instance is live: `SwitcherBreadcrumb.tsx:129`
renders `{scoped.length}` beside a list of workspace-scoped projects, which reads as a project count
and is a scope count. The rule this leaf adds: **the denominator belongs to the collection, not to
the array in hand.**
---

## 7. Deviations

Totals: **D1** · 28 narrowing pickers, 18 disclosing nothing. **D2** · 28 of 40 offered rows
ambiguous at one picker; 48 name-only option rows across the tree. **D3** · 24 coalesced
current-value lookups in 23 files (§9's population). **D4** · 5 pickers where a failed fetch renders
as "you have none". **D5** · 4 uncounted caps in one component plus 3 more elsewhere; 1 denominator
computed on the wrong array. **D6** · 8 adjectives, 3 duplicate PAT pickers, 1 dead picker.
**D7** · `ThemedSelectOption.description` declared and never rendered.

### D1 — 28 pickers narrow; 18 say nothing · **executed**

The one to fix first is the Chain Studio rail, because its predicate is editorial and its empty
state is a false statement:

- `useStudioComposer.ts:74` — `personas.filter((p) => attentionFor(p) === null)`. Executed: **40 of
  78**. Consumed at `StudioRails.tsx:74` (sources) and `:179` (targets); neither can disclose,
  because neither has the unnarrowed array (P7).
- `StudioRails.tsx:165-167`, `:221-223` — `tx(st.no_targets_match, { query })` is the only sentence
  either rail says about emptiness, and it renders even when `query` is `''`.
- **Note, not a fix** (the operator uses this daily): the minimal correct change is to keep offering
  all 78 and pass `attentionFor(p)?.label` down to `PersonaOptionCard` as a `disabledReason`, which
  the card can render beside the name — `SlackBridgePickers.tsx:52` already builds exactly this
  string for a different picker.

The other undisclosed narrowings, each with its line:

| Picker | Predicate | Line |
|---|---|---|
| `CreateTriggerForm` | deployed personas only | `CloudSchedulesPanel.tsx:45-53` → `CreateTriggerForm.tsx:59-61` |
| `CloudWebhooksTab` | not-yet-deployed only | `CloudWebhooksTab.tsx:129,:204-208` |
| `CodebaseProjectPicker` | `listProjects('active')` | `:49` |
| `DevToolsProjectDropdown` | `listProjects(status)` from a prop | `:52` |
| `RecipePicker` | `!linkedRecipeIds.has(r.id)` | `:23` |
| `TemplatePickerStep` | `STARTER_POOL = 12` then `.slice(0, 3)` | `useOnboardingState.ts:22,207,228` |
| `GitHubRepoSelector` | `per_page=100` | `:102` |
| `StationPicker` | `!disabled.has(s.id)` | `:47` |
| `CredentialPicker` (connectors) | `credentials.filter(c => c.service_type === connectorName)`, and `[]` for an unrecognised connector | `ChannelList.tsx:50-53` |
| `SlackBridgePickers` (persona) | `p.home_team_id === teamId` | `useTeamSlackBridge.ts:54-57` |
| `SlackBridgePickers` (credential) | slack service types | same file |
| `VaultConnectorPicker` | `connectorCategoryTags(...).includes(category)` | `CredentialPickerCards.tsx:93-94` |
| `SourceDefinitionInput` (db) | `category === 'database'` | `:148-155` |
| `GatewayMembersModal` | self + gateway + existing members | `:113-121` |
| 3× GitHub PAT | `serviceType === 'github' \|\| 'github_actions'` | `TeamList.tsx:101` · `ProjectModal.tsx:103` · `EditableProjectPipeline.tsx:42-45` |
| `SkillInstallModal` | no workspace scope at all — offers every project | `:35` |

The ten that do disclose, ranked by how much they actually tell you:
`usePickerFilters.ts:81-105` (per-facet counts against an except-base — the only real one) ·
`AddPersonaModal.tsx:83,:138` (`N available`) · `SwitcherBreadcrumb.tsx:129` (`{scoped.length}`, but
see §6's composition note) · `WorkspaceTabs.tsx:63,:82,:88-93` (all/per-tab/unassigned counts) ·
`StationPicker.tsx:172-174` (per-group counts, no hidden count) · `StudioTabBar.tsx:201,:231,:259`
(headings + a per-row *"Not Next.js"*) · `CloudDeploymentsPanel.tsx:115-117` (placeholder flips to
`all_deployed`) · `GatewayMembersModal.tsx:291-294` (`no_eligible`) · `ChannelsAtelier.tsx:207`
(label suffix when zero) · `teamStudioShared.tsx:129,:202-206` (a draft hint, no count).

### D2 — the name-only row · **executed**

- `StudioOptionCards.tsx:71-75` — `PersonaIcon` + `{persona.name}` + a headless glyph. Executed
  against the real 78: **40 rows, 16 distinct labels, 28 (70.0%) not uniquely identified**, and 4 of
  4 colliding groups also share a description, so the hover tooltip (`Tooltip.tsx:205,310`) cannot
  break the tie either. The consequence is a chain wired to another team's persona.
- **48 name-only option rows** across the tree, from a scan of every `.map(` producing a row keyed by
  `x.id` with a choice handler: the only entity field rendered is `name`/`title`/`slug`. The worst
  are the ones over collections that genuinely collide: `PersonaSelectorModal.tsx:130`,
  `CreateTriggerForm.tsx:59`, `CloudDeploymentsPanel.tsx:118`, `BundleExportDialog.tsx:437`,
  `ExposureManager.tsx:173`, `AlertRulesPanel.tsx:128`, `SkillInstallModal.tsx:138` (installs into a
  repo without showing which repo), `SourceControlStep.tsx:84,:100`,
  `PersonaIconPickerModal.tsx:331`, `MoveToWorkspaceButton.tsx:57`.
- **139 sites in 131 files render two or more facts** — so the majority idiom in this codebase is
  already correct, and the name-only rows are a minority that clusters on exactly the collections
  that collide.

### D3 — 24 lookups that cannot report absence · **§9's population**

`X.find((e) => e.id === value)?.<identity> ?? <fallback>` — one expression, no binding, nowhere an
absence arm could live. **24 sites in 23 files:**

`QuickAnswerReviewStepper.tsx:63` · `useUnifiedTriage.ts:493` · `AutomationCard.tsx:39` ·
`AutomationConditionStep.tsx:101` · `DispatchPanel.tsx:79` · `DashboardHomeMissionControl.tsx:132` ·
`AlertRulesPanel.tsx:177` · `ContextMapPage.tsx:83` · `useContextRuntime.ts:116` ·
`EditableProjectPipeline.tsx:40` · `EditableProjectPipeline.tsx:41` · `skillsManagerRows.ts:88` ·
`SkillInstallModal.tsx:82` · `CrewFoundryPanel.tsx:104` · `FactoryObservabilityTab.tsx:59` ·
`ShipMilestoneComposer.tsx:148` · `KpiDetailModal.tsx:45` · `CanvasShell.tsx:878` ·
`TeamCanvas.tsx:37` · `SlackBridgePickers.tsx:101` · `studioDraftModel.ts:90` ·
`SystemEventAutomationsPanel.tsx:34` · `PendingTriggerApprovals.tsx:33` ·
`useSidebarAgentActivity.ts:63`

Three worth naming individually:

- `CanvasShell.tsx:878` — `onDispatchGroupFleet(slugs, groups.find((g) => g.id === id)?.label ?? '')`.
  A deleted group **dispatches a fleet job with an empty label**; the operation proceeds.
- `SlackBridgePickers.tsx:101` — `onChange({ channel: v, channelName: channelItems.find((i) => i.id === v)?.label ?? null })`.
  Writes a dangling channel id with a null name into saved config.
- `studioDraftModel.ts:90` — `personas.find((p) => p.id === id)?.name ?? 'Unknown persona'`. The
  **mildest** member: it at least names the absence. It is also hardcoded English, and it is the only
  one of the 24 that a reader could act on.

**Not matched by the rule but the same defect, recorded so the population is honest** (§9 states the
recall limit): `PersonaSelector.tsx:50` binds the lookup to a const and then renders
`showAll ? t.common.all_personas : placeholder` at `:86-91` — a deleted persona reads as **"All
personas"**, the widest scope in the product. `useWorkspaceSwitch.ts:29` and dozens more use
`?? null`, which is honest inside a hook and only becomes this defect at the render site.

### D4 — a failed fetch renders as "you have none"

`ExecutePersonaPicker.tsx:36-39` (`.catch` → `silentCatch` → `setPersonas([])` → `s.execute_no_personas`) ·
`TeamList.tsx:105` · `ProjectModal.tsx:107` · `useBrainConnection.ts:72` (→ `BrainAtelier.tsx:143-144`
says "no KBs found") · `useRadioState.ts:63-66` (→ `RadioFooter.tsx:572` renders `null`, so the error
is not merely mislabelled, it is invisible). `RecipePicker.tsx:75` is a fourth variety: it computes
`recipes.length === linkedRecipeIds.size`, which is `0 === 0` before the store has fetched, and
renders **"all linked"** over an unfetched store.

### D5 — caps and denominators

- `CommandPalette.tsx:235,:251,:260,:229` — four caps (20/10/10/12), **zero disclosure** in the
  component or in `CommandPaletteResults.tsx`. Executed: 494 of 807 realistic queries lose results;
  42,733 results discarded across them.
- `GitHubRepoSelector.tsx:102` — `per_page=100` with a client-side search box.
- `useOnboardingState.ts:228` — `.slice(0, 3)` of 12 fetched, on the first picker a user ever sees.
- `PersonaSelectorModal.tsx:125` — `All ({personas.length})` above a list of `filtered`. **A
  denominator computed on a different array than the rows it sits above.**

### D6 — eight adjectives, three copies, one dead file

- The vocabulary for "the ones we're offering", none of it defined: `healthyPersonas`
  (`useStudioComposer.ts:74`), `availablePersonas` (`TeamToolbar.tsx:28`), `deployablePersonas`
  (`CloudDeploymentsPanel.tsx:66`), `eligibleCreds` (`GatewayMembersModal.tsx:113`), `candidates`
  (`teamStudioShared.tsx:123`), `targetable` (`FleetBroadcastModal.tsx:63`), `visible`
  (`MemoryActionCard.tsx:63`), `importable` (`StudioTabBar.tsx:73`).
- The GitHub-PAT list, three times, three predicates that nearly agree:
  `TeamList.tsx:97-105` · `ProjectModal.tsx:99-107` · `EditableProjectPipeline.tsx:42-45`
  (the third additionally reads `metadata.platform_type`, `useOverviewData.ts:35-41`). All three are
  name-only, so a personal PAT and an org PAT are indistinguishable in all three.
- `plugins/twin/shared/TwinPicker.tsx` — **zero importers**, and it has the richest picker row in the
  repo (`:250` name, `:253` role, `:255` relative `updated_at`). The best row in the tree is in the
  one file nothing renders.

### D7 — a disambiguation slot that discards its argument

`ThemedSelect.tsx:12` declares `description?: string` on `ThemedSelectOption`. The string
`description` occurs **exactly once** in that 282-line file — the declaration. The trigger renders
`selectedOption?.label ?? placeholder` (`:156`); the option row renders
`highlightMatch(opt.label, …)` (`:215`). Twelve files pass a `description`; two of them pass the
project's `root_path` (`LifecycleProjectPicker.tsx:63`, `SourceDefinitionInput.tsx:329`) — the exact
field that separates two projects with the same name. **The primitive accepts P3's answer and drops
it on the floor.** This is upstream of every `ThemedSelect`-based row in D2.

### D8 — cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **`persona_triggers.persona_id` and `persona_team_members.persona_id` hold ZERO dangling ids**
  (351 and 64 non-null rows). The tables with foreign keys are clean; the ghosts live in tables
  without them. So the dangling-id problem is a *schema* problem where the schema was allowed to be
  one, not a universal one — which is worth knowing before proposing a UI-only fix.
- **The command palette's caps do not make any record unreachable by exact name** — 0 of 316
  templates and 0 of 78 personas. The brief's framing implied a reachability failure; it is a
  discovery failure. §12.2.
- **`attentionFor`'s unit bug is currently inert.** `trust_score < 0.5` is written against a 0–100
  column, but the live distribution is bimodal — 7 rows at exactly `0` and 71 rows at `≥ 58.5` — so
  `< 0.5` and a correct `< 50` select **the identical 7 rows**. The bug is real and latent, not live.
  §12.4.
- **`personas.project_id` and `recipe_definitions.project_id` are NOT dangling.** Both hold the
  literal string `'default'` — a different id space. A first pass counted them as 78/78 and 316/316
  dangling. §12.6.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **No shared primitive can express an unavailable option.** Neither `ThemedSelect` (native or
   filterable) nor `Listbox` has a per-option `disabled` + reason. `ThemedSelectOption` is
   `{ value, label, description?, iconUrl?, iconColor? }` (`ThemedSelect.tsx:9-13`) and `description`
   is not rendered (D7). So P1's prescription — *render it disabled with its reason* — currently has
   **no primitive to land in**, and every author who wants it must hand-roll. **This is upstream of
   D1 and it is the single fix that unblocks the most of this leaf.** §4 T1 is the edit.
2. **No shared primitive can express a missing current value.** `ThemedSelect.tsx:156` and
   `Listbox`'s trigger both resolve `options.find(...)` and fall to the placeholder. There is no
   third render arm, so §4 T2 cannot be adopted at a call site — it has to be added to the primitive
   first.
3. **The credential store cannot distinguish loading from failed from empty.**
   `credentialSlice.ts:33` uses `createCachedFetch({ ttlMs, rethrow: true })` and exposes no
   `credentialsLoading`; `credentials` is `[]` before the fetch and after a failure. Every
   credential-backed picker is *structurally* unable to satisfy P6.
   ([`dropdown-and-select`](./dropdown-and-select.md) D7 found this and called it the highest-leverage
   fix in that leaf; it is the same fix here, so it should be done once and credited to both.)
4. **Nothing reconciles a persisted entity id on fetch.** `devToolsProjectSlice.ts:98-106` sets
   `projects` and never inspects `activeProjectId`; 48 files read it. A picker can render "no longer
   available" and the other 47 readers will still fetch against a dead id. **The picker can make the
   ghost visible; only the store can make it go away**, and that half belongs to
   [`view-state-persistence`](./view-state-persistence.md).
5. **`Listbox`'s search is opt-in and almost nobody opts in.** It ships a type-ahead header with an
   `aria-live` result count (`Listbox.tsx:157-188`) — the mechanism personas-web is *ahead* of the
   fleet for having — and **1 of 13 call sites passes `searchable`**. The count exists and is
   unreachable at 12 of 13 pickers.
6. **A dependent picker has no shared shape.** `OverviewParts.tsx:425-470` (org → project) and
   `useDynamicQuestionOptions.ts`'s `waitingOnParent` (`:12-31`) each solve "this picker's options
   depend on that picker's value" separately. The second is a real contract with nobody else using it.
7. **The census cannot see the interesting half of this leaf** — see §9.

---

## 9. The missing gate

### Existing rules checked first, by reading each definition rather than its title

All **162** rules in `scripts/census/rules.json` were intersected against the final pattern at
**site** level (±1 line), not file level, per the doctrine. Read in full before that, because their
titles suggested overlap:

- **`unreconciled-selection-set`** ([`bulk-selection-actions`](./bulk-selection-actions.md), 9 files
  / 15) — keys on a **selection Set** that nothing reconciles. Different value (a set, not a scalar),
  different site (a store/state declaration, not a render expression). **0 shared files.**
- **`durable-view-token-with-no-rehydrate-arm`**
  ([`view-state-persistence`](./view-state-persistence.md), 2 files / 19) — keys on an own-line entry
  in a zustand `persist()` partialize whitelist. Its site is the store; mine is the render.
  **0 shared files.**
- **`unchecked-destination-id-assertion`** ([`navigation-destination`](./navigation-destination.md),
  19 files / 54) — an id asserted at a navigation door. **0 site collisions.**
- **`absent-entity-count-as-zero`** ([`aggregate-count-display`](./aggregate-count-display.md),
  30 files / 40) — shares **1 file**, **0 sites**.
- **`raw-select`** ([`dropdown-and-select`](./dropdown-and-select.md), 46 files / 63) — shares
  **1 file**, **0 sites**. It counts the *control*; this counts the *value the control shows*.
- **`unbounded-shared-table-render`**, **`tabstrip-with-no-declared-panel`**,
  **`unread-catalog-install-outcome`**, **`code-unit-monogram`**, **`stateless-disclosure-control`** —
  each shares at most 1 file, **0 sites**.

**Total across all 162 rules: 26 rules touch at least one of my 25 candidate files; ZERO produce a
site collision.** The territory is unclaimed.

### Measurement

Two independent implementations, then the census runner itself.

| implementation | files | matches |
|---|---:|---:|
| scratch scanner, block + line comments blanked, whole-file matching | 25 | 26 |
| the census engine (`run-census.mjs --rules <private scratch registry>`), with the two nav excludes | **23** | **24** |

The difference is exactly the two `exclude` entries. **The baseline reproduced identically on
re-extraction from this finished document** (see the re-extraction note at the end of this section).

**Precision, hand-verified site by site.** All 26 raw matches were opened. **24 are entity lookups**
(a persona, project, credential, team, context, use case, KPI, group, or Slack channel — rows that
can be deleted). **2 resolve a route/tab id against a code-determined constant**
(`Sidebar.tsx:216` over the nav registry, `useBreadcrumbTrail.ts:92` over sub-tab literals) where the
collection's members cannot disappear; both are excluded by path with that reason, taking precision
to **100% of what the gate reports**, from 92.3% raw.

**Recall, stated honestly.** The rule sees only the **inline** form. The same defect written as a
named const — `const selected = personas.find(...)` then `selected ? … : placeholder` several lines
later — is invisible to it. A scan of that broader form found **129 candidate sites in 101 files**,
of which perhaps a third are this leaf's; the pattern's precision there was too poor to gate
(see *Gates I rejected*). So this rule is a **ratchet on the idiom that cannot be fixed in place**,
not a census of the condition. `PersonaSelector.tsx:86-91` — arguably the worst instance in the
repo — is **not** counted by it.

**What the signal is a proxy for, stated for the next repo:** *a chooser resolves what is currently
chosen, and the expression it uses cannot distinguish "the record is gone" from "nothing is
chosen".* A repo on another stack should re-derive its own proxy for that condition and must not
port this pattern — `?.` and `??` are TypeScript's spelling of a general mistake.

### The rule

```json
{
  "id": "missing-current-entity-rendered-as-unset",
  "goldenPath": "docs/concepts/golden-paths/entity-picker.md",
  "title": "A picker resolves its current entity by id and renders its absence as if nothing were selected",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?<![A-Z0-9_])\\.find\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)\\s*\\)?\\s*=>\\s*\\1\\s*\\.\\s*id\\s*===[^;{}]{1,80}?\\)\\s*\\?\\.\\s*(?:name|title|label|full_name|display_name|displayName|root_path|service_type|serviceType|slug)\\s*\\?\\?",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An entity is looked up by id inside a collection and its identity field is read through `?.` and coalesced with `??` in the SAME expression. There is no binding, so there is nowhere an absence arm could live: a value whose row is gone renders byte-identically to `nothing is selected`. PROXY FOR the stack-free condition: a chooser is showing what is currently chosen, and it cannot tell `this entity no longer exists` from `you have not chosen`. WHY THIS IS NOT HYPOTHETICAL, MEASURED BY REPLAYING THE OPERATOR'S LIVE DATABASE: 211 distinct persona ids are recorded somewhere in it whose persona row no longer exists, against 78 that do -- 2.7 dead references per live entity -- and 332 rows in LIVE CONFIGURATION tables (not audit logs) hold an id whose row is gone. The leading `(?<![A-Z0-9_])` excludes SCREAMING_SNAKE receivers, whose members are literals in the code and therefore cannot be deleted. Consequences at three of the sites: CanvasShell.tsx:878 dispatches a fleet job with an empty group label; SlackBridgePickers.tsx:101 writes a dangling channel id with a null name into saved config; PersonaSelector.tsx:86-91 (NOT matched -- it uses the named form, see the recall note in the golden path) renders a deleted persona as `All personas`. The compliant idiom -- `.some(x => x.id === value)`, i.e. asking WHETHER the value is still in the set -- exists at 50 sites in 38 files, and only 2 files do both."
  },
  "exclude": [
    {
      "path": "src/features/shared/chrome/sidebar/Sidebar.tsx",
      "reason": "resolves a ROUTE id against the code-determined nav registry (SIDEBAR_SECTIONS), not a fetched entity; an unknown route falling back to the Overview label is the deliberate default, not a dangling row"
    },
    {
      "path": "src/hooks/navigation/useBreadcrumbTrail.ts",
      "reason": "same shape over the nav sub-tab constants — the collection is a literal in the code, so its members cannot be deleted out from under the id"
    }
  ],
  "baseline": { "files": 23, "matches": 24 },
  "floor": 4000
}
```

**Mechanism:** the census runner (`npm run census` reports, `npm run census:check` gates, and the
`golden-path-census` pre-push job runs it). No new script — this is a countable signal, which is
exactly what the registry exists for.

**How it fails loudly if its own precondition is absent:** `floor: 4000` against the 4,829 files the
walk currently sees, so a broken root, a renamed `src/`, or an extensions list that stops describing
the repo fails rather than reporting zero. A rule that matches zero files anywhere fails
structurally, a stale `exclude` fails, a rise fails, and a **drop without `--update` fails** — which
matters here, because the fix for this defect (binding the lookup and adding an arm) *removes* the
match, and a silent drop is a broken matcher far more often than it is fixed code.

**Performance:** 1.9 s over 4,829 files. The bounded `[^;{}]{1,80}?` prevents the nested-quantifier
backtracking the doctrine warns about, and the one lookbehind is fixed-width.

**This rule should be DELETED, not baselined at 0, once §4 T2 lands.** If the shared primitives grow
a `missing` arm, the correct call-site idiom stops being spellable this way and the count should go
to zero; the census cannot express "must be zero", so the rule is retired at that point.

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "missing-current-entity-rendered-as-unset-positive-control",
  "goldenPath": "docs/concepts/golden-paths/entity-picker.md",
  "title": "CONTROL — the compliant form at the same anchors: the surface asks whether the id is still in the collection",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?<![A-Z0-9_])\\.some\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)\\s*\\)?\\s*=>\\s*\\1\\s*\\.\\s*id\\s*===",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The same question -- is this id still in this collection -- asked in the form that CAN answer no. 38 files / 50 matches, against the violating form's 23/24, and only 2 files contain both. The partition is the evidence: the compliant idiom is neither rare nor exotic in this codebase (workspaceStore.ts:60, PersonaIconPickerModal.tsx:97 and ResourcePicker.tsx:230 all use it correctly to reconcile a chosen entity); the violating sites are not people who lacked the tool, they are people who reached for the shorter expression."
  },
  "floor": 4000
}
```

Run in the private scratch registry alongside the rule: **38 files / 50 matches**. The partition is
the point — 23 files ask the question in a form that cannot answer *no*, 38 in a form that can, and
**2 files do both**, which rules out "this codebase does not know the compliant idiom".

### Gates I rejected, with numbers

- **"An option array narrowed by a predicate, in a file that never reads the source's length."**
  30 candidate sites, 25 violating / 5 compliant. Hand-verified: after removing narrowings over
  SCREAMING_SNAKE constants (7), **8 of the remaining 18 are entity pickers — 44% precision.**
  Rejected at the same number an earlier composer rejected at. Restricting the pick-one shape to
  `<option>` lifted precision to 100% but shrank the population to 5 sites — **and 3 of those 5
  (`CloudDeploymentsPanel`, `GatewayMembersModal`, `TextLane`) name their narrowing's reason in the
  empty arm, so the gate would have fired on this leaf's own exemplars.** A gate that fires on
  correct content is worse than no gate.
- **"A name-only option row."** 92 sites / 81 files violating against 139 / 131 compliant — a healthy
  partition, and the condition is P3, this leaf's best clause. Rejected on precision: ~48 of the 92
  are over code-determined sets (`tab.label`, `theme.label`, `opt.label`), and several of the rest
  are filters and tab strips owned by neighbouring paths. **Worse, it is unfixable as stated:**
  whether a name is enough depends on whether *this user's* records collide, which is a property of
  the data and not of the source. The correct instrument is not a census rule — it is a **test that
  renders the picker over a fixture containing two same-named records and asserts the rows differ.**
  That test does not exist for any picker in this repo and is specified in §6's "Tests: none".
- **"A named-const id lookup with no absence arm."** 129 violating / 114 compliant across 172 files.
  Precision poor (test files, general-purpose lookups, non-picker code), and the negative lookahead
  needed to express "the file never notices" is a whole-file scan whose result flips on unrelated
  edits. Rejected; its true positives are recorded in D3's tail instead.

### What the census fundamentally cannot gate here, and what to build instead

Four of this leaf's seven principles are outside the instrument, and saying so is part of the answer:

- **P1 (constitutive vs editorial) is a semantic judgement.** No pattern can tell
  `!alreadyMembers.has(p.id)` from `attentionFor(p) === null`; they are the same expression shape and
  opposite verdicts. What *can* be mechanised is a **convention**: require a one-line
  `// constitutive:` / `// editorial:` comment on any `.filter(` feeding an option array, and gate
  the comment. That is a lint rule with an autofix-able message, not a census rule, and it is the
  honest form of §4 step 2.
- **P2 (the empty state blaming the query) needs the runtime.** The defect is that a *branch* renders
  when a *different* branch's cause is active. Static text cannot see it. What finds it is the
  harness this document used: render the picker over a fixture, type an excluded record's exact name,
  assert the message does not name the query. **~30 lines of Vitest per picker**, and it caught the
  headline here in one run.
- **P5's honesty (a denominator computed on the right array) is a relation between two lengths**, and
  the wrong one is spelled identically to the right one (`PersonaSelectorModal.tsx:125` is
  `personas.length`; the correct value is `filtered.length`, and both are legal, in scope, and
  correctly typed).
- **P6's four states cannot be asserted by absence.** The census ratchets what is present; "this
  component has no error branch" is an absence, and the doctrine is explicit that the instrument
  cannot express one. The inventory in §7 D4 is the substitute, and it had to be built by reading.

**The one instrument worth building** is the picker-fixture test: a shared helper that mounts a
picker over a fixture with (a) two records sharing a name, (b) one record the picker's predicate
excludes, and (c) a `value` whose record is absent, and asserts three things — the two rows render
differently, the excluded record is either offered-disabled or its absence is disclosed, and the
missing value renders as missing rather than as unset. It is the only mechanism that reaches P1, P2,
P3 and P4 at once, and this document's §0 is a hand-built instance of it.

---

## 12. Corrections to the brief

**12.1 — `sides: "client"` UPHELD, and the mechanism is worth recording.** The ledger stood at seven
contradictions to two upholdings before this leaf, and both upholdings were DOM leaves. This one
upholds for a *different* structural reason and it is stronger: **the option set is a decision, and
the decision is made in the client.** The server hands over rows; every narrowing measured here —
`attentionFor`, `'active'`, `per_page=100`'s client-side search, `STARTER_POOL`, the four palette
caps — is applied after the data arrives, by code the server never sees. The one server-side
narrowing in the whole sweep (`listProjects(status)`, `CodebaseProjectPicker.tsx:49`) is a *client*
literal choosing which server call to make. Two backend facts do appear (§0-C's 211 dead ids, and
Gap 4's missing reconciliation on fetch) and neither is this leaf's answer — the first is evidence
that the client's question matters, and the second belongs to a neighbouring leaf by its own
statement. **Report as: upheld, third time, and the first non-DOM reason.**

**12.2 — the brief's `CommandPalette.tsx:235` lead is confirmed as a cap and REFUTED as a
reachability failure.** The caps are real (20/10/10/12), undisclosed (grep for `more`/`showing`/a
denominator in `CommandPalette.tsx` and `CommandPaletteResults.tsx`: **zero hits**), and they bite on
**494 of 807** realistic queries, discarding **42,733** results. But replayed over the real corpus,
**0 of 316 templates and 0 of 78 personas fail to surface when you type their exact full name**,
because `fuzzyScore` returns 100 on an exact match and the list sorts descending. The palette's
defect is P5, not P1 — and the distinction changes the fix from "stop capping" to "print the
remainder". A measurement that agreed with the brief would have been easy to publish here and would
have been wrong.

**12.3 — the raw-`<select>` denominator: the brief's 47 and the census's 46 are both right, and a
third number, 51, is what a careless measurement produces.** Measured three ways: the census pattern
with no comment handling gives **51 files / 69 matches**; an independent pattern with block and line
comments blanked gives **47 / 64**; the census runner, which additionally excludes `ThemedSelect.tsx`
as the primitive itself, gives **46 / 63**. The four extra files in the first are matches inside
comments and strings (`parameterEditing.tsx`, `OllamaCloudPresets.ts`, `TwinPicker.tsx`,
`eventTypeTaxonomy.ts`). **No adoption number swung**; what swung was the count of an artefact, and
only because comment handling was omitted. Also worth extending: of the 64 sites, **only 25 files**
have `<option>`s mapped from a data-determined collection — so the raw-select corpus and this leaf's
population overlap on about half, and quoting 47 as an entity-picker number would be a 1.9× overstatement.

**12.4 — the primed `trust_score` lead is confirmed as a unit bug and CORRECTED on its data.** The
brief said *"a 0–100 column whose minimum real value is 58.5"*. Measured on the live table:
`MIN(trust_score) = 0`, `MAX = 100`, and **7 rows sit at exactly 0**; 58.5 is the minimum *non-zero*
value. The distribution is bimodal with nothing between 0.5 and 50 — so `trust_score < 0.5` and a
correct `trust_score < 50` select **the identical 7 rows**, and all 7 are `T: Product Strategist`
records created within three minutes of each other on 2026-06-05 that have never been scored.
**The unit bug is real and currently inert**, and the label it produces (`'Low trust'`,
`personaStats.ts:205`) means "never scored", not "scored low". It becomes live the moment any persona
scores between 0.5 and 50 — at which point the rail will treat a genuinely low-trust persona as
healthy, the exact inverse of the intended behaviour. The 49% figure is unaffected: **40 of 78**
survive, confirmed by two independent replays (a SQL predicate and the jsdom harness), and the split
is `setup: 29 · low_trust: 7 · disabled: 2`.

**12.5 — a correction returned to [`dropdown-and-select`](./dropdown-and-select.md).** Its Gaps #1
enumerates what `filterable` mode drops (`id`, `aria-invalid`, `aria-describedby`, `required`,
`name`, `form`) and frames it as an accessibility/`FormField` problem. It misses that
**`ThemedSelectOption.description` is dropped in BOTH modes** — declared at `ThemedSelect.tsx:12`,
referenced nowhere else in the file. That is not an a11y gap; it is a **usability** gap, and it is
this leaf's P3. Twelve files pass it, two of them passing the project `root_path` that distinguishes
same-named projects. Suggested amendment: add `description` to that path's Gaps #1 list with the note
that it fails silently in native mode too, since a native `<option>` has nowhere to put it.

**12.6 — a correction to my own first measurement, published because the failure mode is the
doctrine's.** A first pass over the live database reported `personas.project_id` as **78 of 78
dangling** and `recipe_definitions.project_id` as **316 of 316**. Both columns hold the literal
string `'default'` — a **different id space**, not a dead row. The premise ("this column references
`dev_projects.id`") was false, the conclusion ("dangling ids are rampant") happened to survive on
other evidence, and it would have been published as a headline. The corrected instrument checks that
a column's values are shaped like the parent's ids before counting, reports what it skipped, and
separates append-only history (where naming a deleted row is legitimate) from live configuration.
Corrected figures: **332 dangling rows in 7 live-configuration columns**, **6,199 in 9
history/audit columns**, and **211 distinct dead persona ids against 78 live personas** — which is
the number worth quoting, and it is stronger than the wrong one because it is about a collection a
picker actually offers.

**12.7 — a second correction to my own instrument, hitting the trap the contract documents by
name.** The per-`<select>` option-source extractor initially scanned **line by line** and reported
**4 sites in 3 files**. The contract's rule — *"Match against whole file content, never
line-by-line"* — exists for exactly this: `<select` followed by a newline fails a
`(?=[\s>/])` lookahead applied per line. Whole-file matching returned **64 sites in 47 files**, a
**16× difference**, and the line-based version read as a plausible "the repo barely uses raw
selects". Recording it because the contract's warning is about the *pattern*; the same failure
arrives through the *harness*, and reads as good news both times.

**12.8 — the brief's "name-only chip with a decorative icon is a failure mode" is CONFIRMED and
quantified, and the quantification changes the prescription.** The corpus's prototype doctrine states
it as taste; measured here it is arithmetic. The failure is not "a name-only row is thin"; it is
that **a name-only row is only wrong when the user's data collides**, and whether it collides is
invisible from the source. 139 sites in this repo render two or more facts and 48 render one — and
the 48 are not obviously worse code. The one that matters is worse *only because* nine persona names
each occur seven times in this particular database. **So the prescription cannot be "always render
two facts"; it has to be "render the field that separates this user's records", plus a test that
proves it over a colliding fixture** — which is why §9's second rejected gate is rejected and why the
one instrument worth building is a fixture test, not a pattern.

**12.9 — the brief's `view-state-persistence` lead is confirmed and its count re-measured.** That
path reported *"a ghost `activeProjectId` that 46 production files act on"*. Re-measured 2026-08-17:
**48 non-test files, 49 including tests**. And the extension this leaf owes it: **exactly one** of
those 48 reconciles the id (`useWorkspaceSwitch.ts:38-46`), it fires only on an explicit workspace
switch, and the file's own header states the defect in prose. Two better models exist in the same
repo and neither is used for projects: `workspaceStore.ts:55-64` asks the membership question at the
store boundary, and `twinSlice.ts:339-343` **derives** the active id from the fetched rows so it
cannot dangle at all.

**12.10 — the convergence label `diverged` HOLDS, but only when read per clause, which is the
thirteenth demonstration that one enum field cannot carry this verdict.** Three clauses diverge
(Personas alone in hiding on a predicate; nobody discloses a cap in a picker; nobody tells the user a
chosen record is gone). Two are **inverted** — rich rows and stale-id repair are fleet physics that
Personas mostly lacks, so on those *this repo* is the outlier rather than the fleet. And one is the
doctrine's "converged on the disease" shape with a new twist worth adding upward: **two independent
siblings wrote the disclosure idiom for tables in the same codebases where their pickers disclose
nothing.** That is not an omission the fleet has never solved — it is a solved problem that did not
cross a component boundary, which is a materially different finding from "nobody knows how", and an
oracle that only counts agreement reads them the same.

**12.11 — the brief's TSX-generic warning was live and cost nothing, because the final pattern has no
angle brackets.** Two intermediate candidates did (`<option[^>]*value=`), and `<Listbox<Persona>`
would have closed them at its own `>`. Recorded because the warning was correct and the escape was
luck: the pattern that survived is delimited by `.find(` and `??`, neither of which appears inside a
type argument.

---

*Re-extraction check, per the doctrine: the two fenced JSON blocks above were extracted from this
finished file and re-run through `scripts/census/run-census.mjs --rules <private scratch registry>`
after the document was written. The rule reproduced `files 23 / matches 24` against its declared
baseline and the control reproduced `files 38 / matches 50`, identical to the pre-publication run.
The private registry and the database copies were deleted afterwards. The full registry was NOT run —
that is the orchestrator's step.*
