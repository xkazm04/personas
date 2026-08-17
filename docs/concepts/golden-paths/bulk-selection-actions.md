# Golden path — Bulk selection actions

> Situation node: `client-runtime` › `mutations-and-editing` › `bulk-selection-actions` ·
> [situation spine](../situation-spine.md) · recurrence 20 · risk **medium** ·
> sides: **client** (upheld — see §12.1, the first leaf in this batch where it holds) ·
> convergence: **mixed** (upheld, 3 physics / 2 alone / 1 silence) ·
> dimensions: **ui · function · resilience**
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` under `src/`, walked three times by three different
> matchers. Every multi-item selection container in the tree enumerated (**42** declarations across
> **35** files by a declaration-side scanner; **31** files by the census anchor); every "select all"
> construction enumerated from the opposite end (**18** in 11 files); every `onSelectAll` /
> `onToggleSelectAll` consumer of the shared grid header (**7**). All **1,585** registered Tauri
> commands checked for a mutation whose scope is a filter rather than an id list (**0**). All of
> `src/stores/**` searched for a multi-item user selection (**0** — every one of the 31 is
> component-local `useState`). Read in full: `PersonaOverviewPage.tsx`, `PersonaOverviewActions.tsx`,
> `PersonaOverviewFilters.tsx`, `DataGrid.tsx`, `FacetedDecisionTable.tsx`, `facetedTableModel.ts`,
> `KnowledgeTree.tsx`, `ManualReviewList.tsx`, `useLayeredList.ts`, `useManualReviewQueue.ts`,
> `DeadLetterTab.tsx`, `BacklogPanel.tsx`, `DispatchPanel.tsx`, `ExecutionList.tsx`, `useDrive.ts`,
> `FleetBroadcastModal.tsx`, `ProjectManagerPage.tsx`, `useExportPicker.ts`,
> `MemoriesPageDense.tsx`, `personaSlice.ts`, `db/src/repos/communication/manual_reviews.rs`.
>
> **Measured by EXECUTION, not by reading.** Three real selection surfaces were transcribed
> verbatim into a **jsdom + React 19 harness** — the same `useState`/`useEffect`/`useMemo` semantics
> the app runs — and driven against rows read from a **read-only copy** of the operator's live
> `personas.db` (347 MB, copied 2026-08-17 02:22 UTC with the app running, `engine-leader.lock`
> live). The live file was never opened for write; **no bulk action was invoked against anything**;
> the copy was deleted afterwards. The harness mounts (A) `PersonaOverviewPage`'s selection block
> over its real `usePersonaListFilters` pipeline and `DataGrid`'s real page slice, over the real 78
> personas; (B) `KnowledgeTree` × `FacetedDecisionTable` × `DataGrid` over the real 1,306
> `workspace_knowledge` rows; (C) `ManualReviewList` over `useLayeredList` driven by the **real
> keyset SQL transcribed from `manual_reviews.rs:632-676`**, over the real 194 reviews. Every number
> in §0 came out of that harness or out of the census runner.
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. `personas-cloud` has **no selection UI at all**
> (0 hits), and per the standing correction it and `personas-web` are one system, so the effective
> independent cohort for this leaf is **4**. Lineage checked: no identifier, comment or constant
> from this repo's selection code appears in any sibling.
>
> **Settles:** what "select all" means, what happens to a selection when the list moves under it,
> and whether the set the action receives is the set the user chose.

---

## 0. The headline

**The user ticks a box above twenty-five rows and one hundred and twenty ids leave the building.
Executed, three ways, on the operator's own data:**

| surface | rows the user can SEE | ids the action receives | |
|---|---:|---:|---|
| **Agents → All Personas**, one click on the header checkbox | **25** (`DataGrid pageSize={25}`) | **78** selected → **77** to `bulk_delete_personas` | **3.12×** |
| **Workspace → Knowledge Library**, one click on the same header checkbox, standing inside the `frontend/components` branch | **25** on the page, **107** in the branch | **1,306** | **52.2×** / **12.2×** |
| **Overview → Reviews**, select 3 scrolled pages, then any single-row verdict | **40** after the reload | **120** iterated, **40** called, **80 silently reported as approved** | — |

Nothing here is a count bug. Every number rendered on screen is arithmetically correct about the
thing it names. **The defect is that the number and the action are computed from two different
derivations of one selection, and only one of them was ever reconciled with reality.**

### A — Agents: the checkbox is unlabelled and the page is a lie about its own scope

`PersonaOverviewPage.tsx:307-309` hands `DataGrid` `pageSize={25}` and `onSelectAll={handleSelectAll}`.
`handleSelectAll` (`:180-182`) is `new Set(filteredData.map((p) => p.id))` — **the whole filtered
set**, every page. `DataGrid` renders that control at `:257-277` as a bare 16 px `<div onClick>`
with a tick inside: **no label, no count, no `role`, no `aria-checked`, no text of any kind**, sitting
directly above a body that is `data.slice((page-1)*25, …)` (`:227-231`).

Harness, real data:

```
personas in store ........................ 78
filteredData (default view) .............. 78
rows the user can SEE (page 1) ........... 25
after ONE click on the header checkbox ... 78 selected     -> 3.12x
  ids selected that are NOT on the page .. 53
bulk_delete_personas would receive ....... 77 ids   ("Delete 77 agents")
```

**That is the same 77.** [`dry-run-preview` §0](./dry-run-preview.md) executed what those 77 ids do:
**15,958 rows across 20 tables**, of which 15,881 are in tables the confirmation never names. That
path owns the blast radius of the number. **This one owns where the number came from: one click on
an unlabelled square above a 25-row page.** Put the two together and the sentence is: *a control
with no text on it, whose scope is 3.12× what is visible, is the front door to the largest
destructive operation in the product.*

### B — Knowledge Library: the select-all population is computed two components above the checkbox

This is the sharpest structural finding in the leaf, and it is invisible from inside any one file.

`KnowledgeTree.tsx:197-204` computes the select-all population and writes the doctrine over it:

```ts
// Everything the current filters expose, so select-all means "all of what I
// am looking at" — not all of what happens to be on this page.
const selectablePendingIds = useMemo(
  () => items.filter((i) => pending(i) && filterRow(i)).map((i) => i.id),
  [items, pending, filterRow],
);
```

`filterRow` (`:150-159`) is status × kind × project. But the checkbox that calls
`setSelected(new Set(selectablePendingIds))` is rendered by `DataGrid`, **inside**
`FacetedDecisionTable`, whose row set is three further narrowings the parent cannot see
(`FacetedDecisionTable.tsx:123-128`):

```ts
const branch   = itemsUnderGroup(items, getGroupPath, selected);   // the topic tree on the left
const searched = searchItems(branch, query, searchHaystack);       // the search box above the table
const filtered = searched.filter(filterRow);                       // <- the ONLY one the parent shares
// …then DataGrid pages it at 25.
```

Harness, over the real 1,306 `workspace_knowledge` rows:

```
branch = "frontend/components"
  rows in the table ...................... 107
  rows the user can SEE (page 1 of 25) ... 25
  after ONE click on the header checkbox . 1,306 selected
    -> ids selected OUTSIDE the branch ... 1,199

search = "cache"
  rows in the table ...................... 86
  after ONE click .......................... 1,306 selected
    -> ids that do NOT match the search .. 1,220
```

**The comment is right about the page and wrong about the branch and the search**, and it is wrong
because `selectablePendingIds` is computed one component above the control that consumes it. Then:

```
select-all inside "frontend/components", THEN change the project filter:
  selection pruned? ...................... NO — unchanged at 1,306
  rows now visible ....................... 0
  bulk('adopt') would send ............... 1,306 ids
  ...of which INVISIBLE to the user ...... 1,306
```

`bulk` (`:215-224`) is `await onBulkDecide([...selected], decision)` — the raw Set, no membership
test. **The brief asked whether any surface can act on an id the user can no longer see. This one
can act on 1,306 of them while showing an empty table.**

> **Live vs latent, stated plainly.** `workspace_knowledge` holds 1,164 `adopted` / 118 `rejected` /
> 24 `deprecated` and **0 undecided**, so `pending()` is false for every row and the bulk surface is
> currently unreachable — the B numbers are a **counterfactual over the real corpus with the status
> gate neutralised**. The scoping arithmetic is a property of the code, not of that column; the
> harvest pipeline that produced these 1,306 rows writes new ones as `observed`, so the surface
> re-arms the next time a scan runs.

### C — Reviews: a selection that outlives the rows it names, and is reported as success

`ManualReviewList` is keyset-paginated: `useManualReviewQueue.ts:18` is `PAGE_SIZE = 40`, scrolled by
an `IntersectionObserver` that **appends** (`useLayeredList.ts:155`). `reload()` — which every
single-row verdict calls (`:216`, `:221`, `:236`, `:239`) — goes to `runFirstLoad`, which
**replaces** the rows with page 1 (`:129`). `selectedIds` is reset on a **filter** change
(`ManualReviewList.tsx:168`) and on nothing else.

`handleBulkAction` (`:243-265`) then does:

```ts
const ids = Array.from(selectedIds);
const results = await Promise.allSettled(ids.map((id) => {
  const review = reviewMap.get(id);
  if (!review) return Promise.resolve();        // :249  <- a no-op that resolves
  return resolveReviewRow(review, status);
}));
const failed = results.filter((r) => r.status === 'rejected').length;   // a resolve() is not a rejection
```

Harness, real 194 rows, real keyset SQL:

```
L1 first page ............................ 40
after two scroll pages ................... 120 rows loaded
user selects every loaded row ............ 120 selected
then any single-row verdict calls reloadQueue():
  rows now loaded ........................ 40
  selection pruned? ...................... NO — still 120
  the bulk bar NOW says .................. 40
  the confirm sentence renders ........... "Approve 40 reviews?"
  handleBulkAction iterates .............. 120 ids
    -> real resolveReviewRow calls ....... 40
    -> silent Promise.resolve() .......... 80   reported approved, never touched
```

**The count and the action are in the same file, 78 lines apart, and disagree.** `:267`
(`activeSelectionCount`) filters the selection through `selectablePendingIds`; `:246` does not filter
it at all. The one that is displayed is right; the one that acts is wrong; and the id that fell out
of the window is not merely skipped — `Promise.resolve()` is not a rejection, so it is **counted as
approved** and the toast at `:259` fires for `0 failed`.

### The denominator

| | count |
|---|---:|
| `.ts`/`.tsx` files under `src/` | **4,829** |
| multi-item selection containers declared (`Set` or `string[]`, select-ish name) | **42** in 35 files |
| …declared as a `Set` (the census anchor, both implementations agree) | **31** files |
| …that live in a **zustand store** | **0** |
| …**reconciled** against the live rows somewhere after the declaration | **17** |
| …**never reconciled**, and handed raw to an action | **9** (§9's population) |
| …excluded as a fixed option set / reconciled by lookup instead of membership | **2** |
| …that never leave the component | **3** |
| "select all" constructions (`setSel(new Set(X.map(…)))`) | **18** in 11 files |
| …**page-scoped** | **0** |
| …**filter-scoped**, i.e. wider than what is rendered | **18** |
| …that render a **number or label on the control** | **0** |
| Tauri commands whose mutation scope is a **filter** rather than an id list | **0** |
| …whose scope is a **hardcoded server predicate with no scope parameter at all** (`delete_all_*`) | **3** |
| selections **pruned when the source refetches** | **3** — `PersonaOverviewPage`, `FleetBroadcastModal`, `DeadLetterTab` |
| …in the five sibling repos | **0** |
| single-entity selections validated against a refetch | **1** (`personaSlice.ts:139-143`) |

**The app knows the rule for N = 1 and applies it nowhere for N > 1.** `personaSlice.fetchPersonas`
carries the comment *"Validate persisted selection -- clear if the persona was deleted"* and drops
the id plus its detail cache. Twenty-eight of the thirty-one multi-item selections get nothing of
the kind.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and the leaf's centre.** **A selection is a claim about rows, and rows move. The
> set that acts must be re-derived from the rows that exist at the moment of acting, not read out of
> the box the user ticked.** Every list under a selection is refetched, refiltered, repaged,
> searched, sorted or mutated by somebody else, and a set of ids has no way to notice any of it.
> *Warrant: executed — a selection of 120 survives a refetch that leaves 40 rows loaded, and the
> action reports the missing 80 as done; a selection of 1,306 survives a filter change that leaves 0
> rows visible, and the action sends all 1,306.*
>
> **P2 — physics, and the one that decides the UI.** **"Select all" must state its own scope on the
> control, because the scope is never the thing the eye is resting on.** Page, filtered set, whole
> result set and "everything the server would match" are four different populations, and the control
> is a checkbox with room for a number. A control that does not say which one it means will be read
> as "the rows I can see", which it never is.
> *Warrant: 18 of 18 select-all constructions here are wider than the rendered rows and 0 carry a
> label; the one repo in the cohort whose control prints its own population ("select all 137") is
> also the only one whose surrounding chrome distinguishes "on page" from "in all".*
>
> **P3 — physics.** **One derivation, used by both the number and the deed.** If the count beside
> the button and the list inside the handler are two expressions, they are two programs, and the
> only question is when they part. The compliant shape is a single named value that the label reads
> and the handler passes.
> *Warrant: executed — a count expression that prunes and an action expression that does not, in one
> file 78 lines apart, disagreeing by 3× on real data; and, from the other direction, the two places
> in this tree where the label and the argument are literally the same expression are the two places
> with no divergence to find.*
>
> **P4 — physics.** **A partial failure must leave exactly the failures selected.** The whole value
> of a selection is that it is aimed; clearing it on the way into the action destroys the only
> record of what the user meant, and clearing it on the way out destroys the retry. Drop the ones
> that landed; keep the ones that did not.
> *Warrant: independently reinvented in two codebases with no shared document, both with the reason
> written in a comment; and inverted here at the most destructive door in the product, which clears
> the selection **before** awaiting a call whose return value names every item that failed.*
>
> **P5 — physics.** **Never key a selection, an anchor or a cursor by position in a filtered list.**
> An index survives a refilter and points at a stranger; an id survives it and points at nothing,
> which is a state you can detect.
> *Warrant: two sibling repos reached this independently and both wrote the reason down — one for a
> shift-click anchor, one for a keyboard cursor — and each stores an id and resolves it to a fresh
> index at use time. It is P1 one level down, and it is the only part of this leaf the fleet has
> fully internalised.*
>
> **P6 — ergonomics.** **The ceremony must scale with how much of the selection the operator can
> see.** Acting on the one row under the cursor needs no confirmation; acting on a set that extends
> past the viewport needs one, and the confirmation's job is to state the part that is off screen.
> *Warrant: one repo in the cohort makes exactly this distinction in code, with the reason on the
> line ("one item fires straight away — it is on screen"); and the widest selection measured here
> reaches an unlabelled control with no confirmation of scope at all.*
>
> **P7 — ergonomics, and the one nobody has.** **An operation whose scope is a rule rather than a
> list must show the rule.** Where the action is "everything matching X", X is the selection, and a
> user looking at a filtered view will read X as their filter. If the rule is not the filter on
> screen, saying so is the entire job.
> *Warrant: three doors in this tree take neither ids nor a filter — their scope is a predicate
> compiled into the server that the client cannot name, and the surface that fires one of them is
> sitting behind a category filter that the predicate ignores.*
>
> **Scale condition.** P1 and P3 are wrong on day one at any size, and only *visible* once the list
> is bigger than one page. P2 bites the first time the list exceeds the viewport. P4 bites the first
> time one item of N is refused. P5 bites the first time a filter changes between two clicks. P6 and
> P7 are what stop a correct implementation from still surprising the user.

---

## 1. Trigger

- "Add checkboxes and a bulk action bar."
- "Put a select-all in the header."
- "Bulk delete / bulk approve / bulk archive / bulk retry the selected rows."
- "It said it approved 40 but three are still in the queue."
- "I filtered the list, hit the action, and it did something to rows I wasn't looking at."
- "Keep the selection when the list refreshes." / "Clear the selection when the list refreshes."

**If you are about to write** `useState<Set<string>>` for anything a user ticks, or an
`onSelectAll`, or `[...selected]` / `Array.from(selected)` as an argument to anything, **you are in
this situation.** Likewise if you are about to render a count next to a bulk button, or to give a
paginated table a header checkbox.

You are **not** in this situation for a multi-select over a **fixed option set** — model names,
scopes, channel kinds, filter chips. Nothing can leave that collection, so there is nothing to
reconcile; 3 of this repo's 31 selection Sets are that, and they are exempted by name in §9.

### Boundaries with the adjacent leaves

The seam test: **is the question WHAT THE SET IS, what the set's effect will be, what the answer
looks like afterwards, or where the number came from?** Only the first is this path.

| Territory | Owner | Do not restate |
|---|---|---|
| The **effect** of acting on the set — cascades, blast radius, preview→apply tokens, whether the preview is the same computation as the action | [`dry-run-preview`](./dry-run-preview.md) | It owns **what 77 ids do** (15,958 rows in 20 tables). This path owns **how 77 became the number** — one click above a 25-row page. Its §0 and this §0 are two halves of one sentence about the same dialog, measured a day apart by different composers from different ends. |
| The **shape of the answer** for a caller-supplied id list — per-item outcomes, reason tokens, caps, what the plural inherits from the singular | [`bulk-command-variant`](./bulk-command-variant.md) | It owns **the command**; explicitly, in its own §1: *"`bulk-selection-actions` owns the checkbox strip and the action bar. This path owns what happens after the button is pressed."* Accepted and reciprocated. §6 (i) is the composition defect between us: its per-item outcome is the exact data P4 needs, and the two surfaces that produce it well are the two this path also grades highest. |
| A **verdict per item** staged in a component and collapsed at the commit | [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) | It owns **a `Record<id, verdict>`**; this owns **a `Set<id>`**. Its §9 names its own blind spot as *"a `Set<string>` of accepted ids… a two-valued verdict where absence is the rejection, which is P2's failure mode with no vocabulary to grep"* — **that Set is this leaf**, and §9 below is the instrument it asked for. Measured: 0 site overlap between the two rules. |
| Where a rendered count comes from — page vs source, `?? 0`, `N of M` | [`aggregate-count-display`](./aggregate-count-display.md) | It owns **the number's provenance**. This owns **the number's relationship to the set the handler passes**. Its §0 (a dialog saying 100 that deletes 6,535) is cited in §7 D6, not re-derived; what is new there is that the same button ignores the category filter the user is standing behind. |
| Whether the destructive action is gated at all, the modal, the typed-name ceremony | [`informed-consent-gate`](./informed-consent-gate.md) | It owns **the gate**. P6 is the one clause of this path that touches it, and only to say the gate's threshold should be a function of how much of the set is off screen. |
| Whether a client predicate agrees with the server rule it mirrors | [`client-rule-mirroring`](./client-rule-mirroring.md) | Every `selectable*Ids` predicate is one of its mirrors — `KnowledgeTree`'s `pending()`, `ManualReviewList`'s `status === 'pending'`, `ProjectManagerPage`'s `status !== 'archived'`. §7 D3 hands it three live pairs. |
| Rows leaving because the sweep deleted them | [`retention-and-pruning`](./retention-and-pruning.md) · [`delete-semantics`](./delete-semantics.md) | They own **why a row is gone**; this owns **what the selection does about it**. |
| Optimistic removal of the acted-on rows | [`optimistic-update`](./optimistic-update.md) | `applyOutcome`'s row removal is its territory; `applyOutcome`'s **selection** update is this one's. |

---

## 2. The one way

**Derive the set twice from the same expression — once for the label and once for the handler — and
make that expression an intersection with the rows on screen.** Concretely: (a) **keep the selection
as ids, never indices, and never in a store** — it is view state and it must die with the view.
(b) **Prune it whenever the source collection changes**, in a `useEffect` keyed on the rendered
rows, returning the previous Set unchanged when nothing was dropped so it cannot loop. (c) **Compute
one `visibleSelection` value** — `rows.filter((r) => selected.has(r.id))` or
`[...selected].filter((id) => rowIds.has(id))` — and let the button's count, the button's disabled
state and the handler's argument all read *that*, never `selected.size` and never `[...selected]`.
(d) **Make "select all" mean the filtered result set, not the page** — that is what every codebase
in the fleet chose and it is right — **and then print the number on the control**: `Select all 78`,
not an unlabelled square. (e) **Say what is off screen before acting**: if `visibleSelection.length`
exceeds what the viewport can hold, the confirmation states the total and the fact that most of it
is not visible. (f) **Snapshot the ids at the moment the confirmation opens** and act on the
snapshot, so the set cannot change between the sentence and the deed. (g) **On the way out, drop
only the ids the server said landed and keep the rest selected** — the per-item outcome
[`bulk-command-variant`](./bulk-command-variant.md) mandates is exactly this data; do not clear the
selection before awaiting, and do not clear it unconditionally after. (h) **Where the scope is a
server predicate rather than a list, render the predicate** — "deletes every memory that is not
core-tier, ignoring the filters above" — because the user cannot see it and will assume it is their
filter.

If you must get one right first: **(c)**. (b) is the cheapest and (d) is the most visible, but every
other defect in §7 is downstream of the label and the handler being two expressions.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:227-236` + `:558`,`:568`** — `filteredIds` → `visibleSelectedCount` → the button argument | **The reference shape, and the only complete one.** `filteredIds = new Set(filtered.map(e => e.id))`; `visibleSelectedCount` counts `selected` through it; and the two action buttons pass `Array.from(selected).filter((id) => filteredIds.has(id))` — **the label and the argument are the same predicate, written twice, three lines apart.** P3, satisfied by construction. | 1 |
| **`DeadLetterTab.tsx:155-171`** — the prune inside `loadEvents` | *"Drop selections for ids that are no longer in the queue."* Six lines, inside the fetch itself, so the selection cannot outlive a refetch. P1. | 3 tree-wide |
| **`DeadLetterTab.tsx:295-303`** — `applyOutcome` | **P4, exactly.** `setEvents(prev => prev.filter(e => !succeeded.has(e.id)))` and `setSelected(…keep every id NOT in succeeded…)` — the successes leave the list, the failures stay selected, and the next click is already aimed. Independently reinvented in `brainiac` (§6 clause 4). | 1 |
| **`src/features/plugins/fleet/FleetBroadcastModal.tsx:68-85`** — the prune, with the reason | The comment **is this leaf's thesis**: *"Without this the Set retains dead ids: the 'N targets' counter overstates the real audience and the send loop iterates ids that can only fail. Returning the previous Set unchanged when nothing was pruned avoids a render loop."* Copy the code *and* the last sentence — the unchanged-return is what keeps a prune effect from looping. | 1 |
| **`src/features/overview/sub_manual-review/components/backlog/BacklogPanel.tsx:159-167`** — `targetRows` | **The act-time intersection, with its scoping rule stated:** *"operate on the SELECTION when there is one, otherwise on everything currently visible. 'Visible' means after the effort/risk filter and the sort — what the user is looking at, not what the server happens to hold."* | 1 |
| **`BacklogPanel.tsx:75-83`** — `athenaIds` / `queueIds` snapshots | **§2 (f) already written down, twice.** *"Snapshot of the ids sent to Athena… the card never re-reads the selection, so changing it mid-review is harmless"* and *"The modal walks a SNAPSHOT of the ordering taken when it opened. Recomputing from the live rows would re-sort the queue under the cursor the moment a verdict changes a row's status, and 'next' would stop meaning next."* | 1 |
| **`src/features/plugins/drive/hooks/useDrive.ts:384-389`** | **Scope the selection to the thing it is about.** *"Clear selection + kind filter on navigation — both are scoped to the folder you're looking at."* The cheapest correct answer when a selection cannot survive a context switch: destroy it deliberately. | 1 |
| **`src/stores/slices/agents/personaSlice.ts:139-143`** | The N = 1 form of P1, done right: a persisted selection validated against the refetched list and dropped with its detail cache when the entity is gone. **This is what the 28 unreconciled multi-selections are missing, and it is nine lines.** | 1 |
| **`src/features/shared/components/display/DataGrid.tsx:210-222`** | `Escape` clears the selection while the bulk toolbar is up — the only keyboard affordance for un-aiming a selection in the app, and it is in the shared primitive where it belongs. | all `DataGrid` bulk users |

**Explicitly NOT primitives:**

- **`DataGrid`'s `onSelectAll`** (`:114-116`, `:257-277`). It is a **`() => void`** — the primitive
  hands the consumer no scope, no page, no row list, and renders no label. Every one of its callers
  therefore invents the population, and every one of them invented "the whole filtered set" while
  the primitive was busy paginating. See §4 T1: this signature is the single edit with the widest
  reach in the leaf.
- **`FacetedDecisionTable`'s selection pass-throughs** (`:81-87`). `isRowSelected`, `selectAll`,
  `onSelectAll` and `selectedCount` are forwarded straight to `DataGrid` — so a component that owns
  **three** narrowings its parent cannot see (branch, search, page) forwards the parent's answer to
  "what is selected" without touching it. §7 D2.
- **`ConfirmDialog` / `ConfirmDestructiveModal`.** Correct consent gates with `body: string`. They
  cannot know whether the number in the sentence came from the same expression as the argument, and
  [`dry-run-preview` §8 Gap 6](./dry-run-preview.md) already owns the ask for a plan-shaped confirm.
- **`useLayeredList`.** A good pagination primitive that **replaces its rows on `reload()`**
  (`:129`) and exposes no signal that it did. Any selection held above it is silently orphaned. §8
  Gap 2.

---

## 4. Steps

1. **Name the rendered rows once.** Whatever the user is looking at after every filter, search,
   branch and sort — call it `rows`. If two components each apply part of the narrowing, the
   selection logic belongs in the lower one, beside the last narrowing. `KnowledgeTree` puts it in
   the higher one and that is D2.
2. **Hold the selection as a `Set` of ids in the component that owns `rows`.** Not indices (P5), not
   a store — 0 of 31 use a store and that is correct: a selection that survives navigation is a
   selection nobody can see.
3. **Prune on every change of `rows`.** A `useEffect` keyed on `rows` that intersects and **returns
   the previous Set unchanged when nothing dropped** (`FleetBroadcastModal.tsx:74-84` is the
   reference). If the selection cannot meaningfully survive the change, clear it deliberately and
   say why (`useDrive.ts:384`).
4. **Define `visibleSelection` — one value, used everywhere.** `rows.filter(r => selected.has(r.id))`.
   The count on the bar, the `disabled` predicate, the confirmation's `{count}` and the handler's
   argument all read this. **If you type `selected.size` inside a JSX label and `[...selected]`
   inside a handler in the same component, you have already shipped D1.**
5. **Ask whether the type can make the wrong call impossible — before you write the gate.** Here it
   can, at the primitive's signature; see below.
6. **Give select-all the filtered set and a label with the number in it.** `Select all {rows.length}`.
   If the list is paged or windowed, also say what is loaded versus what matches — `brainiac` prints
   `{matched} of {total} on page · {total} in all` and it costs one span.
7. **Snapshot on confirm.** The ids go into state when the dialog opens; the handler reads the
   snapshot, not the live Set.
8. **Await the per-item outcome and subtract.** `setSelected(prev => prev minus outcome.succeeded)`.
   Never `setSelected(new Set())` before the `await`, and never unconditionally after.
9. **If the scope is a server predicate, print the predicate** and disable every filter control that
   the predicate ignores, or say in the sentence that it is ignored.
10. **And then stop.** Do not persist the selection, do not add a second count derived a second way,
    do not re-filter inside the handler with a *different* predicate than the label used, and do not
    let the primitive's `onSelectAll` decide the population for you — it cannot.

### Can the type make the wrong call impossible? — asked before §9

**Two answers, and the first is a five-word edit with the widest blast radius in the leaf.**

**T1 — YES, for the select-all population, and it is the primitive's signature.** The bad state is
`onSelectAll?: () => void` (`DataGrid.tsx:116`). A callback that receives nothing cannot be wrong
about the page, because it was never told there is one — so every consumer reinvents the population
from whatever array is in scope, and all 18 of them reinvented the same wrong one. The closed form
hands the consumer what only the primitive knows:

```ts
onSelectAll?: (scope: { page: readonly T[]; all: readonly T[] }) => void;
```

Held against the seven qualifications:

- **Q3 (a type nobody constructs constrains nothing).** **The qualification that decides it, and it
  passes.** There are **7** `onSelectAll` / `onToggleSelectAll` call sites in 4,829 files. Seven is
  reachable; the edit lands in one afternoon. A generic `Selection<T>` wrapper across all 31
  containers does not meet Q3 and is a refactor, not a type.
- **Q5/Q6 (withhold the dangerous freedom, not the answer).** The dangerous freedom is *choosing the
  population out of ambient scope*. Withhold it by supplying both populations explicitly, so the
  consumer must name which one it meant. Do **not** withhold the id list — `KanbanBoard.onItemMove`'s
  lesson is that withholding the wrong half breaks the feature.
- **Q1 (a type carries only what it encodes).** Honest limit: this closes *which population*, and
  encodes nothing about whether the selection is later reconciled (§2 b/c) or what happens on
  partial failure (§2 g). Those are three separate edits and no signature reaches them. That is why
  this path's prescription is eight clauses.
- **Q7 (relaxing a requirement is inert where the caller supplies the bad value voluntarily).** It
  applies and points the same way: nothing *forced* `filteredData.map` — the author volunteered it
  because it was the array in scope. So the type must *supply* the alternatives, not merely permit
  them.

**And the destination needs fixing before a gate points at it** (contract, fifth §9 failure mode).
Routing callers to `DataGrid`'s select-all is worth little while `DataGrid` renders that control as
an **unlabelled 16 px `<div>`** with no `role`, no `aria-checked`, no `aria-label` and no count
(`:262-275`) — a primitive that concentrates the concern and then hides the answer. **Make the
control print its own population by default**, and the whole class of "I thought it meant this page"
disappears at 7 call sites instead of 18.

**T2 — NO for "is this selection still real", and the reason is the leaf's own finding.** No type
distinguishes a `Set<string>` whose ids are all present from one whose ids are gone; both are
`Set<string>`. A branded `RowIds<T>` would be forgeable by anyone with a `Set` (Q4) and would say
nothing about *when* it was checked, which is the entire property. **Freshness is not a type, it is
a relation between two values at a time** — and that is precisely why §9's rule keys on the
*absence of the reconciliation*, and why §8 Gap 1 is a relation the census cannot express.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A header select-all above a paginated body** | The control the eye reads as "these rows" selects every page. Executed: **78 selected, 25 visible, 53 off screen**, feeding the product's most destructive door. `PersonaOverviewPage.tsx:180-182` + `DataGrid.tsx:227-231`. §7 D1. |
| **A select-all population computed above the component that does the narrowing** | The parent shares one of four filters. Executed: **1,306 selected, 107 in the branch, 25 on the page** — and the comment above it claims the opposite. `KnowledgeTree.tsx:197-204`. §7 D2. |
| **`selected.size` in the label and `[...selected]` in the handler** | Two derivations of one selection. Executed: the bar says 40 and the loop iterates 120. `ManualReviewList.tsx:246` vs `:267`. §7 D4. |
| **A lookup miss inside the action treated as success** | `if (!review) return Promise.resolve()` — a `Promise.allSettled` counts that as fulfilled, so 80 untouched reviews are reported approved and `failed` is 0. `ManualReviewList.tsx:249`. §7 D4. |
| **A selection never pruned when the list refetches** | It outlives the rows it names. **28 of 31 containers**; 0 of 5 sibling repos prune either. §7 D2, D3, D5. |
| **`setSelected(new Set())` before `await`ing the action** | Destroys the retry target before knowing whether there is one — and the very call being awaited returns `Vec<BulkDeleteOutcome>` naming every item that failed. `PersonaOverviewActions.tsx:116`. §7 D5. |
| **`setSelected(new Set())` unconditionally after a loop that counted failures** | Same, one line later. `PersonaOverviewActions.tsx:158`, `:182`; `ProjectManagerPage.tsx:126`. |
| **A bulk loop with no `catch`, launched as `void (async () => …)()`** | The first failure aborts the remaining items **and** becomes an unhandled rejection; the selection was cleared on the line above, so the untouched remainder is neither acted on, nor selected, nor named. `BacklogPanel.tsx:142-153`. §7 D7. |
| **An index into a filtered list as an anchor or cursor** | Refilter and it points at a stranger. Not present here — both sibling repos that hit it fixed it by keying on the id, with the reason written down (§6 clause 5). Named so it stays fixed. |
| **A destructive action whose scope is a server predicate, behind a filter the predicate ignores** | The user reads their own filter as the scope. `MemoriesPageDense.tsx:250` sits under a `categoryFilters` chip row and fires `delete_all_memories`, whose scope is `WHERE tier != 'core'`. §7 D6. |
| **A selection in a store** | Survives navigation and re-aims itself at a surface nobody is looking at. **0 occurrences — this repo already got it right**, recorded so it stays that way. |
| **Intersecting at act time but not telling anyone** | Fail-closed and silent: the button says N, the action does M < N, and nothing reports the difference. `DispatchPanel.tsx:115` vs `:221`, `ExecutionList.tsx:312`. Better than acting on ghosts, still a lie. §7 D3. |

---

## 6. Evidence

**The ONE site to copy: `src/features/triggers/sub_dead_letter/DeadLetterTab.tsx` — three blocks,
about twenty lines.**

```ts
// (1) prune, inside the fetch — :159-167
const data = await listDeadLetterEvents(100);
setEvents(data);
setSelected((prev) => {
  // Drop selections for ids that are no longer in the queue.
  const ids = new Set(data.map((e) => e.id));
  const next = new Set<string>();
  for (const id of prev) if (ids.has(id)) next.add(id);
  return next;
});

// (2) ONE derivation for the label AND the argument — :227-236, :558
const filteredIds = useMemo(() => new Set(filtered.map((e) => e.id)), [filtered]);
const visibleSelectedCount = useMemo(() => { let n = 0; for (const id of selected) if (filteredIds.has(id)) n++; return n; }, …);
…
{tx(t.triggers.dead_letter_bulk_retry, { count: visibleSelectedCount })}
onClick={() => void runBulkRetry(Array.from(selected).filter((id) => filteredIds.has(id)))}

// (3) partial failure keeps the failures aimed — :295-303
const applyOutcome = (outcome: BulkDeadLetterOutcome) => {
  const succeeded = new Set(outcome.succeeded);
  setEvents((prev) => prev.filter((e) => !succeeded.has(e.id)));
  setSelected((prev) => { const next = new Set<string>(); for (const id of prev) if (!succeeded.has(id)) next.add(id); return next; });
};
```

Four decisions worth copying: (1) the prune lives **inside the fetch**, so there is no window where
the selection and the rows disagree; (2) `filteredIds.has(id)` is written **twice, three lines
apart** — once to count and once to pass — which is the cheapest possible implementation of P3 and
the only one in the tree; (3) `runBulkRetry` narrows once more by a client-side precondition
(`retry_count < maxManualRetries`) **before** the call, so the server's refusal set and the client's
prediction are visibly the same rule (handed to
[`client-rule-mirroring`](./client-rule-mirroring.md)); (4) `applyOutcome` subtracts the successes
rather than clearing.

> **Live-input caveat, stated rather than buried.** `persona_events` holds **0 `dead_letter` rows**
> on this install, so the best implementation of this leaf currently has nothing to select — while
> the three weakest (78 personas, 1,306 knowledge items, 194 reviews) all have real inputs.
> **Quality is inversely correlated with live population here**, exactly as
> [`bulk-command-variant`](./bulk-command-variant.md) found for the same file. That is an argument
> for copying it outward, not for discounting it.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `FleetBroadcastModal.tsx:68-85` | **The prune effect, with the reason and the loop-guard.** *"the 'N targets' counter overstates the real audience and the send loop iterates ids that can only fail"* — plus `return pruned ? next : prev`, which is what keeps the effect from re-rendering forever. |
| `BacklogPanel.tsx:159-167` | **The act-time intersection with its scoping rule in prose** — selection-or-visible, and "visible" defined as post-filter, post-sort, *"not what the server happens to hold"*. |
| `BacklogPanel.tsx:75-83` | **Two snapshots and two reasons.** A verdict card that never re-reads the selection; a modal that walks a frozen ordering so "next" keeps meaning next. §2 (f), already shipped. |
| `useDrive.ts:384-389` | **Deliberate destruction as a valid answer** when a selection cannot survive a context change. |
| `personaSlice.ts:139-143` | **The N = 1 form of the whole path** — validate the persisted selection against the refetch, drop the id *and* its cache. |
| `DataGrid.tsx:210-222` | `Escape` clears the selection, in the shared primitive, only while the bulk toolbar is mounted. |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** `personas-cloud` has **no multi-item
selection anywhere** (0 hits over `packages/**`) — a full silence — and per the standing correction
it and `personas-web` are one system, so **the effective independent cohort is 4**. Lineage: no
shared identifier, comment or constant; nothing below is a port agreeing with its original.

Selection inventory outside this repo: **personas-web 2, brainiac 1, vibeman 5, ascent 5,
personas-cloud 0.**

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **"Select all" means the filtered result set, never the page** | **PHYSICS (4/4 of the repos that have one)** | personas-web `selectAll` → `pendingInFiltered` (`useReviewBulkActions.ts:98-100`); brainiac → `matched` (`ReviewWorklist.tsx:496`); vibeman → `filteredPlans.filter(p => p.status !== 'running')` (`ImplementationPlansManager.tsx:101-108`); ascent → `rows.map(r => r.fullName)` (`RepoLeaderboard.tsx:82-85`). **Nobody chose the page.** Personas: 18 of 18. The prescription in §2 (d) is not a preference — it is what six codebases independently landed on. |
| 2 | **…and it must therefore SAY how many, on the control** | **`brainiac` ALONE (1/4), and Personas is behind it** | `ReviewWorklist.tsx:500`: a real `<Button>` reading **`select all {matched.length}`**, next to `{matched.length} of {promotions.length}{!scope.whole && " on page · {scope.total} in all"}` (`:490-493`) — the page/whole distinction printed in words. Personas' equivalent is `DataGrid.tsx:262-275`: an unlabelled `<div onClick>`. vibeman and ascent use a bare `<input type="checkbox">`; personas-web an icon button. **The one repo that names the population is the one where the answer cannot surprise you.** |
| 3 | **Nobody prunes the selection when the rows move** | **PHYSICS AS AN ABSENCE (4/4 silent) — and PERSONAS IS THE ONLY REPO THAT HAS ONE** | Zero prune effects in any sibling. vibeman `ImplementationPlansManager` refetches on a debounced search (`:64-83`) and never touches `selectedIds`; ascent `RepoLeaderboard` re-sorts under the selection and says so approvingly (*"Selection state is keyed by fullName, so re-sorting the rows never disturbs which repos are ticked"* — correct for a sort, silent for a refetch); brainiac's rail refreshes and `selected` survives. Personas has **three** (`PersonaOverviewPage.tsx:162`, `FleetBroadcastModal.tsx:74`, `DeadLetterTab.tsx:159`), two of them with the reason written down. **Personas is ahead of the fleet on the single hardest half of this leaf, at 3 of 31.** |
| 4 | **Partial failure keeps the failures selected** | **PHYSICS (2 independent inventions, both with the reason in a comment)** | brainiac `ReviewWorklist.tsx:290-296`: *"Drop the decided rows from the selection; keep the refused ones so the operator can see what stayed and act on it"* — `for (const r of out.rows) if (r.ok) next.delete(r.id)`. Personas `DeadLetterTab.tsx:295-303`, the identical algorithm, no shared document. personas-web reaches the same place through a different door (`failedIds` + a Retry button, `BulkResultToast.tsx`). ascent `RepoLeaderboard.tsx:105` clears only on success. **vibeman clears unconditionally.** So does Personas at its most destructive door (§7 D5). |
| 5 | **An index into a filtered list is unstable — key by id** | **PHYSICS (2 independent, both wrote down WHY)** | personas-web `useReviewBulkActions.ts:35-37`: *"Shift-click anchor stored as the review id (string) so filter changes, sorting, or new reviews arriving via polling can't make the cached index point at a different row. Resolve to a fresh index at click time"* — plus an effect at `:49-58` that **forgets the anchor when its row leaves the filtered view**. brainiac `ReviewWorklist.tsx:179-181` + `:232-236`: *"The cursor is the focused promotion's id — never its row index… a refresh (or a filter) that removes it lands at the front of the rail rather than on a stranger's claim at the same index."* **Two teams, two languages of reasoning, the same sentence.** And the tell: both fixed the *anchor* and neither generalised it to the *selection* sitting beside it. |
| 6 | **Ceremony scales with what the operator can see** | **`brainiac` ALONE (1/4)** | `ReviewWorklist.tsx:306-311`: `needsConfirm(selected.size)` — *"One item fires straight away (it is on screen); more than one arms a confirmation first"*, and the keyboard path at `:288-296` signs the one focused claim with no dialog *"because the operator is looking at exactly it"*. That is P6 in code. Nothing in Personas conditions a confirmation on how much of the selection is visible. |
| 7 | **When the server truncates, the ORDER of the id list decides who gets dropped** | **`ascent` ALONE (1/4) — and inapplicable here, which is itself the finding** | `PracticeApply.tsx:71-75`: *"gapRepos is ordered highest-score-first (least needy), so the repos most in need of remediation are LAST. The server keeps the first MAX_BATCH repos it receives when truncating, so send the neediest first — otherwise the cap would silently drop exactly the repos the rollout should fix."* This hazard cannot arise in Personas because **all five of its caps refuse rather than truncate** ([`bulk-command-variant` §6 clause 6](./bulk-command-variant.md)) — a design choice made for a different reason that closed this one for free. Worth recording before somebody adds a truncating cap. |
| 8 | **The selection lives in the component, never a global store** | **PHYSICS (5/5, including Personas)** | 0 multi-item selections in `src/stores/**` here, in vibeman's zustand slices, in brainiac's console state, in personas-web's stores, or in ascent. Six codebases, no exceptions, no document. The one thing about this leaf nobody gets wrong. |
| 9 | **A generic "selection over rows" primitive** | **SILENCE — 0 of 6** | Every one of the 31 here and the 13 across the cohort hand-rolls `toggle` / `toggleAll` / `clear` as three inline callbacks. ascent's `useOnboardingFlow`, brainiac's `toggleSel`, vibeman's `handleToggleSelect` and this repo's `toggleSelect` are byte-similar six-line closures. **Nobody has written `useRowSelection(rows, getId)`** — which is §8 Gap 3 and the single highest-leverage thing anyone in the fleet could build for this leaf. |

**Physics — keep as doctrine:** clauses 1, 3 (as an absence), 4, 5, 8.
**Reported as one-repo-alone:** clauses 2, 6 (brainiac), 7 (ascent).
**Reported as silence:** clause 9 (nobody has a selection primitive), and `personas-cloud` having no
multi-item selection at all.
**Personas is ahead** on clause 3 (the only repo in six that prunes a selection, and the only one
with the reason written down) and **behind** on clause 2 (an unlabelled control where brainiac
prints the number) and clause 6.

### The composition defects with the neighbouring paths — offered upward

**(i) with [`bulk-command-variant`](./bulk-command-variant.md).** Its P1 mandates a per-item outcome;
this path's P4 mandates that the outcome be subtracted from the selection. **They compose into a
trap that is live in this tree right now.** `bulk_delete_personas` returns `Vec<BulkDeleteOutcome>`
with three statuses — that path's exemplar — and `PersonaOverviewActions.tsx:116` runs
`setSelectedIds(new Set())` **on the line before** the `await` that produces it. The outcome type is
perfect, the identity of every failed item is on the wire, and the consumer has already thrown away
the only place that data could go. **Producing the per-item shape and being able to use it are two
different achievements, and this is the second one failing while the first succeeds.** The one-line
clause both paths need: *a per-item outcome is only useful to a caller that still knows what it
asked for — never clear the selection before the await.*

**(ii) with [`dry-run-preview`](./dry-run-preview.md).** Its §0 and this §0 are the same dialog from
two ends, composed a day apart. Its prescription — *compute the blast radius and put it in the
confirmation* — and this one's — *state how much of the selection is off screen* — are both correct
and **both are about the same sentence, which today contains neither.** A composition worth stating:
the blast-radius number is a function of the set, so **the set must be frozen before the radius is
computed, and the radius must be recomputed if the set changes.** Its preview→apply token
(`apply_bundle_import`, the only one in six repos) is the mechanism; §2 (f)'s snapshot is the same
idea one layer up, and neither path had noticed they are the same idea.

**(iii) with [`selective-per-item-verdicts`](./selective-per-item-verdicts.md).** Its §9 explicitly
names the `Set<string>` as the half of the condition its rule cannot see: *"a two-valued verdict
where absence is the rejection, which is this leaf's P2 failure mode with no vocabulary to grep"*.
§9 below is that instrument, and the two rules are measured at **0 site overlap** — its anchor is
`useState<Record<string, …Verdict>>`, mine is `useState<Set<…>>`, and they partition the space
cleanly. Together they cover both shapes a multi-item decision takes in this repo.

**(iv) with [`aggregate-count-display`](./aggregate-count-display.md).** Its rule owns a count read
out of a lookup and defaulted to zero; this one owns a count read off a selection that no longer
matches the rows. **Neither can see the other's sites (0 overlap, measured), and both are the same
disease**: a number rendered from a value nobody re-checked against the source. Offered upward as a
shared clause: *every displayed count should name the expression that produced it, and that
expression should be the same one the action uses.*

---

## 7. Deviations

Every entry is live on `master` @ `2a874e692`, verified by reading the file and — where a number is
quoted — by replay in the jsdom harness against a read-only copy of the operator's database.
**Nothing here was applied.** Per the campaign's standing rule, anything that changes what a live
surface does to a selection is a note.

### D1 — the Agents select-all is 3.12× the visible page and its control has no text on it · **executed**

`PersonaOverviewPage.tsx:307-309` + `:180-182` + `DataGrid.tsx:227-231`, `:257-277`.

Measured above: 78 filtered, 25 rendered, **78 selected on one click, 53 of them off screen**, 77
handed to `bulk_delete_personas`. The control is a `<div onClick={onSelectAll}>` with a checkmark
`<svg>` — no `role`, no `aria-checked`, no `aria-label`, no count. A keyboard user cannot reach it
at all.

This page is otherwise the **second-best** selection implementation in the tree: it prunes on filter
change (`:162-168`, and the harness confirms the prune fires — `statusFilter → 'building'` takes
78 → 2), and `handleBatchMoveToGroup` deliberately keeps the selection with the reason written
(`:141-142`). The defect is entirely in the two things it inherited from the primitive: the
population and the silence.

**Fix (note):** `onSelectAll: (scope: { page, all }) => void` (§4 T1) and a labelled control. Seven
call sites.

### D2 — `KnowledgeTree`'s select-all is computed above three narrowings it cannot see · **executed, the leaf's structural finding**

`KnowledgeTree.tsx:197-204` vs `FacetedDecisionTable.tsx:123-128`.

`selectablePendingIds` knows about status, kind and project. The table it feeds also applies the
**topic-tree branch** (`itemsUnderGroup`, `facetedTableModel.ts:80-90`), the **search box**
(`searchItems`, `:97-105`) and a **25-row page**. Measured over the real 1,306 rows: 1,306 selected
against 107 in the branch (12.2×) and 25 on the page (52.2×); with a search of `cache`, 1,306
selected against 86 matching rows.

And `bulk` (`:215-224`) sends `[...selected]` with no intersection, while `selected` is pruned by
nothing. Replayed: select-all inside a branch, then change the project filter → **0 rows visible,
1,306 ids sent, 1,306 of them invisible.**

The comment at `:197-198` — *"so select-all means 'all of what I am looking at' — not all of what
happens to be on this page"* — is the correct doctrine attached to code that cannot implement it,
because the three missing filters live in a child component. **This is the shape to remember: a
correct intention, one component too high.**

**Fix (note):** move the selection into `FacetedDecisionTable` beside `rows`, or have it call back
with `rows` (§4 T1). Currently latent (0 undecided rows); re-arms on the next harvest scan.

### D3 — three surfaces intersect at act time and never say they did · **the silent-narrowing family**

| site | the label says | the handler sends |
|---|---|---|
| `DispatchPanel.tsx:221` / `:115` | `{count: selectedIds.size}` | `rows.filter(r => selectedIds.has(r.id))` |
| `ExecutionList.tsx` bulk toolbar / `:312` | `bulkSelected.size` | `executions.filter(row => bulkSelected.has(row.id))` |
| `UnifiedDeploymentDashboard.tsx:177-179` | `selectedRows.length` | the same intersection — **the one that also derives its label from it, and is therefore correct** |

The first two are fail-closed and mute: the button says N, the action does M ≤ N, nobody is told.
`ExecutionList` is the live one — `executions` (`:136-139`) drops simulation rows when
`showSimulations` is off, so a failed simulation selected via `handleSelectAllFailed` (`:290-295`)
stays in `bulkSelected`, leaves `executions`, keeps inflating the count, and is silently not rerun.
`DispatchPanel` additionally computes `fleetEligible = selectedIds.size - blocked.length` (`:112`)
— arithmetic over the *unpruned* selection.

`fleetBlockedRows(rows, selectedIds)` and `selectablePendingIds` are also three client mirrors of
server refusal rules; handed to [`client-rule-mirroring`](./client-rule-mirroring.md).

**Fix (note):** `const visibleSelection = rows.filter(...)` above both, per §2 (c). Three files,
three lines each.

### D4 — `ManualReviewList` counts one set and acts on another, and calls the difference a success · **executed**

`ManualReviewList.tsx:246` vs `:267`, with `:249` as the amplifier. Measured above: bar 40, sentence
40, loop 120, real calls 40, **80 silently reported approved**.

Three compounding facts: (1) `selectedIds` is reset on `[filter, sourceFilter, selectedPersonaId]`
(`:168`) and on nothing else — not on `reload()`, not on a page append; (2) `useLayeredList.reload()`
**replaces** rows with page 1 (`useLayeredList.ts:129`) and every single-row verdict calls it; (3)
the miss branch resolves rather than rejects, so `Promise.allSettled`'s `failed` count is
structurally unable to see it.

Currently **latent**: `persona_manual_reviews` holds 174 `approved` + 20 `resolved` and **0
`pending`**, and both the row checkbox (`ReviewInboxPanel.tsx:117`) and the bulk bar
(`BulkActionBar.tsx:26`) are gated on pending, so the surface is unreachable today. It is latent
because the operator's queue is empty, not because anything prevents it — 47 of the 194 rows were
processed through this component.

**Fix (note):** prune on `reviewQueue.rows`, derive one `visibleSelection`, and make the miss branch
`Promise.reject(new Error('row-not-loaded'))` so it lands in `failed` instead of in the success
count.

### D5 — the most destructive door clears its selection before awaiting the outcome that names the failures

`PersonaOverviewActions.tsx:112-119`:

```ts
onConfirm: async () => {
  setSelectedIds(new Set());        // :116
  await runBulkDelete(ids);         // :117 — returns Vec<BulkDeleteOutcome>
}
```

`runBulkDelete` (`:80-95`) reads `deleted` / `protected` / `failed` out of the per-item outcome and
folds them into `{ deleted, skipped: protectedCount + failed }` for the toast. So the identity of
every refused persona arrives, is counted, and is discarded — into a UI that no longer has a
selection to restore. `handleBatchArchive` (`:158`) and `handleBatchRestore` (`:182`) clear
unconditionally after their loops, having tracked `ok` and `firstErr`. `ProjectManagerPage.tsx:126`
does the same after counting `ok` / `fail`.

**This is the composition defect with [`bulk-command-variant`](./bulk-command-variant.md) made
concrete** (§6 (i)): that path's exemplar return type, wasted by its own consumer.

**Fix (note):** `setSelectedIds(prev => new Set([...prev].filter(id => !deletedIds.has(id))))` after
the await. One line, and it is the fix `DeadLetterTab.tsx:295-303` already ships.

### D6 — a delete-all fired from behind a filter the predicate ignores

`MemoriesPageDense.tsx:250` renders the Delete-all button under a `categoryFilters` chip row
(`:77`, `:130-131`, `:305`), and `:387-393` confirms with `{count: memories.length}` then calls
`deleteAllMemories()` — whose scope is `DELETE FROM persona_memories WHERE tier != 'core'`
(`db/src/repos/core/memories.rs:1046-1058`), a predicate with **no scope parameter of any kind**.

[`aggregate-count-display` §0](./aggregate-count-display.md) owns the number (100 shown, 6,535
deleted) and [`dry-run-preview`](./dry-run-preview.md) owns the report (the returned `usize` is
discarded at `:392`). **What is this leaf's is the set:** the user is standing behind a category
filter, the button sits inside that filtered view, and the filter is not in the predicate and cannot
be. Three doors have this shape — `delete_all_memories`, `delete_all_messages`,
`delete_all_manual_reviews` — and all three are **0-parameter commands**, so no client can narrow
them and no client can preview them. P7.

**Fix (note):** state the predicate in the confirmation, in words, including the fact that the
filters above do not apply.

### D7 — a bulk loop that clears first, has no `catch`, and stops at the first failure

`BacklogPanel.tsx:142-153`:

```ts
const ids = [...selectedIds];
setSelectedIds(new Set());
void (async () => {
  for (const id of ids) {
    await (verdict === 'accept' ? queue.accept(id) : queue.reject(id));
  }
})();
```

Three defects in nine lines: the selection is cleared before any work happens; there is no
`try/catch`, so the first rejection **aborts the remaining ids** and surfaces as an unhandled
promise rejection rather than a toast; and the `void (async () => …)()` means the caller cannot even
await the outcome. A batch of 20 that fails at item 6 leaves 14 untouched, unnamed and unselected.

Panel is otherwise the third-best in the tree — `targetRows` (`:159-167`) is the act-time
intersection done right, and `setStatus` (`:115-119`) clears deliberately on a filter change.

**Fix (note):** `Promise.allSettled` over the ids, subtract the fulfilled ones from the selection,
toast the rejected count.

### D8 — nine selections that nothing anywhere reconciles · **§9's population**

`KnowledgeTree.tsx:83` · `ProjectManagerPage.tsx:94` · `ContextPickerModal.tsx:34` ·
`useDrive.ts:259` · `SyncPanel.tsx:40` · `BundleExportDialog.tsx:73` · `useExportPicker.ts:78-84`
(seven containers in one hook) · `DataLinksPopover.tsx:45` · `ChronologyAdoptionView.tsx:707`.

Each declares a selection `Set`, hands it to an action as `[...sel]` / `Array.from(sel)` / `for
(const id of sel)`, and contains **no membership test against the live rows anywhere after the
declaration**. `useDrive` is the sharpest of the nine after `KnowledgeTree`: `selectAll` (`:537-539`)
selects `entries` — the unfiltered directory listing — while the grid renders `visibleEntries`
(`:553`, search + kind filter), and although the selection is cleared on **navigation** (`:384-389`,
correctly, with the reason) it is not touched by a **refresh**, so a file another process deleted
stays selected and reaches `moveManyInto` / the delete dialog.

**Fix (note):** the shared hook from §8 Gap 3. Nine call sites is the argument for building it once.

### D9 — cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"The prune effect leaves a window where the batch bar shows a stale count."** It does not, in
  practice. Replayed in the harness: `setView({statusFilter:'building'})` and the very next read of
  `selectedIds` is already 2, because React flushes the passive effect before the next event can be
  dispatched. The prune is sound; the defect at that surface is the *population*, not the timing.
- **"`ManualReviewList` never prunes at all."** It resets on filter/persona change (`:168`) — a hard
  reset, which loses work but is safe. The defect is narrower and worse than "no prune": it resets
  on the three inputs that *cannot* orphan an id and does nothing on the two that can (`reload`,
  `loadMore`).
- **"Selection state should move into a store so it survives navigation."** Refuted by the oracle
  and by the tree: **0 of 6 codebases do this**, and the one persisted single-entity selection in
  this repo needs nine lines of validation on every refetch to stay honest (`personaSlice.ts:139`).
  A selection that outlives its view is P1 with a longer fuse.
- **"`CompetitionCard` has the unreconciled defect."** It does not. `compareSelected` is capped at 2
  by its own toggle (`:71-78`) and the use site reconciles by **lookup with a null guard** —
  `detail.slots.find(...)` then `if (!leftSlot || !rightSlot) return null` (`:316-319`). This is §2
  (c) satisfied in a shape no membership-based matcher can see, and it is why the rule in §9 carries
  it as a named exclusion rather than a violation.
- **"Somewhere in the app, select-all means the page."** No. **18 of 18** select-all constructions
  are filter-scoped, and so are all four sibling implementations. The hazard in this repo is
  exclusively that select-all is **wider** than the rendered rows, never narrower — which is the
  opposite of the intuition the brief and I both started with.

---

## 8. Gaps

**Gap 1 — "Is this selection still real?" is a relation between two values at a time, and no type
and no gate can hold it.** A `Set<string>` whose ids all exist and one whose ids are all gone are
the same value of the same type. Freshness is not a property of the selection; it is a property of
the *last comparison*, which is an event. The reachable answers are structural — prune at the
fetch, intersect at the act — and §9's rule can only see whether the code *contains* one of those
shapes, never whether it ran at the right moment. **D4 is the proof: `ManualReviewList` contains a
reconciliation, passes the gate, and acts on 120 ids while displaying 40.**

**Gap 2 — `useLayeredList` silently truncates its own rows and tells nobody.** `reload()` →
`runFirstLoad()` → `setRows(page.rows)` (`:129`) takes a 120-row scrolled list back to 40, with no
callback, no version counter, no `onRowsReplaced`, and no way for a consumer holding a selection to
learn that it happened. Every consumer that pages *and* selects inherits D4 for free. A four-line
fix — bump an epoch on `runFirstLoad` and expose it — would let any selection above it prune. **The
primitive is the right shape and is missing the one signal its consumers need.**

**Gap 3 — there is no `useRowSelection`, in this repo or in any of the five siblings.** Thirty-one
hand-rolled `toggle` / `toggleAll` / `clear` triples here, thirteen more across the cohort, byte-
similar, none shared. The hook is perhaps forty lines:

```ts
function useRowSelection<T>(rows: readonly T[], getId: (row: T) => string) {
  // prunes on `rows`, returns `{ selected, visibleSelection, count, toggle,
  // toggleAll, clear, applyOutcome }` — where `visibleSelection` is THE value
  // the label and the handler both read, and `applyOutcome(succeededIds)`
  // subtracts rather than clears.
}
```

It closes P1, P3 and P4 by construction at 31 sites and makes §9's rule obsolete, which is the
correct fate for a ratchet. **This is the single highest-leverage artifact named anywhere in this
document**, and §6 clause 9 says nobody in six codebases has built it.

**Gap 4 — nothing in the app can say "and 53 of these are off screen".** There is no shared
affordance for the difference between a selection and a viewport; `DataGrid`'s bulk toolbar renders
`selectedCount` and stops. brainiac prints `{matched} of {total} on page · {total} in all` in one
span (§6 clause 2) and that is the whole answer. Until it exists, P2 and P6 are prose.

**Gap 5 — the census cannot express three of the four things that matter here.** "The label and the
handler are two different expressions" is a relation; "the prune runs at the right moment" is a
temporal property; "the confirmation states what is off screen" is an absence. The census ratchets a
count of something present, and the only present thing in this leaf is the **absence of any
reconciliation in a file that has a selection** — which is what §9 counts, and which by construction
cannot see the three files where a reconciliation exists and is not the one the action uses.

---

## 9. The missing gate

**The condition, stated stack-free:** *a set of item identities chosen by a human is handed to an
action without ever being re-derived against the items that currently exist — so the action can
operate on things the user can no longer see, and the count shown beside the button is not the count
acted upon.*

**The signal (a proxy, and stated as one):** a **component-scoped `Set` selection container** whose
module contains, after the declaration, a raw hand-off (`[...sel]` / `Array.from(sel)` /
`for (const id of sel)`) and **no set-membership filter or prune loop at all**. This keys on the
shape the condition wears **in this repo**, where a selection is a React `useState<Set<string>>` and
a reconciliation is a `.filter(x => set.has(…))` or a `for … if (set.has(…))`. **An adopting repo
must re-derive its own proxy** — a Vue `ref(new Set())`, a checkbox array in a form POST, a
server-rendered multi-select, a `Signal<string[]>` — none of which this pattern can see.

**The mechanism: a census rule.** The runner exists (`scripts/census/`) and implements the fail-loud
contract, so this path writes no script.

**Where it executes:** `npm run census:check` runs inside `npm run check` **and** as the
`golden-path-census` **pre-push** job (`lefthook.yml:74-75`). That matters: `ci.yml` is red on 10
pre-existing failures, so a gate that only runs in CI runs nowhere. This one fails the push.

**The population partitions, and the residual is named.** Anchor = every file declaring a
multi-item selection `Set` (**31**):

| | files | matches |
|---|---:|---:|
| **anchor** — a component-scoped multi-item selection `Set` | **31** | — |
| ↳ **violating** — raw hand-off, no reconciliation after the declaration | **9** | **15** |
| ↳ **compliant** — reconciles against the live rows (the positive control) | **17** | 17 |
| ↳ **excluded, by name and with reasons** | **2** | — |
| ↳ **residual** — the selection never leaves the component (a view filter, an option picker) | **3** | — |

9 + 17 + 2 + 3 = 31, exactly. The residual three are `usePanelRunState.ts` (model/effort pickers),
`MonitorChannelGrid.tsx` (a channel *view* filter with no action) and `CreateApiKeyDialog.tsx`
(scope checkboxes) — no action, nothing to reconcile.

**Precision, hand-verified 9/9 files on the stated condition** — every match opened. On the stricter
question *"can this act on an id the user can no longer see"* it is **8/9**: `ContextPickerModal`
selects context *names* round-tripped into a skill config, so a vanished context yields a stale
string rather than a wrong write. The weakest included site is `useExportPicker` (7 of the 15
matches, one hook): its lists are loaded once per modal open and can only go stale if another
session writes — included deliberately, because "another session writes" is the normal condition on
a machine that runs four CLI agents at once.

**Two independent implementations agreed on the anchor and DISAGREED on the partition — which is the
more useful result.** Implementation #2 is a standalone Node walker that tests reconciliation
**file-wide** rather than after the declaration, and models the hand-off only as a spread. Both
found **31** anchor files and both reported **9 violating**. *They disagreed about which 9, on four
files:*

- #2 called `ChronologyAdoptionView.tsx` compliant. Hand-verified against the census: its two
  `.filter(x => set.has(…))` occurrences are at `:436` and `:460` — a duplicate-event guard and a
  name dedupe on unrelated collections, **247 and 271 lines above** the selection at `:707`. The
  census is right; a reconciliation of a *different* collection is not a reconciliation.
- #2 missed `ProjectManagerPage.tsx` entirely, because its bulk-archive hand-off is
  `for (const id of selectedIds)` (`:119`) rather than a spread. The census is right.
- #2 flagged `CreateTwinWizard` and `CompetitionCard`, which the census carries as named exclusions
  (a fixed enum; a reconciliation-by-lookup). Both hand-verified.

**Two implementations agreeing on a count is not soundness: these agreed on 31 and on 9 and were
still describing different sets.** That is the doctrine's warning reproduced on a third leaf, and it
is why the four disagreements were each opened by hand rather than averaged.

**Existing rules checked for overlap first — at the SITE level, against the FINAL pattern, by
re-running every committed rule's own pattern and intersecting.** All 152 rules were run; the 88
whose roots and extensions can reach `src/**/*.{ts,tsx}` are compared:

| neighbour rule | its files | **site** overlap with my 15 | **file** overlap with my 9 |
|---|---:|---:|---:|
| `hand-rolled-disabled-state` (`design-token-usage`) | 361 | **0** | 4 (44%) — a styling rule with 815 matches |
| `typo-token-overpainted` · `native-title-tooltip` | 824 / 571 | **0** | 3 each |
| `bindingless-catch-on-io` · `call-site-text-match` · `illegible-foreground-alpha` | 84 / 56 / 183 | **0** | 2 each |
| `read-failure-as-empty-value` · `widthless-collection-fanout` · `raw-web-storage` · `raw-select` · 8 others | 32 / 35 / 77 / 46 | **0** | 1 each |
| **`staged-verdict-map-collapsed`** ([`selective-per-item-verdicts`](./selective-per-item-verdicts.md)) | 3 | **0** | **0** |
| **`absent-entity-count-as-zero`** ([`aggregate-count-display`](./aggregate-count-display.md)) | 30 | **0** | **0** |
| **`unconsented-irreversible-door`** ([`informed-consent-gate`](./informed-consent-gate.md)) | 12 | **0** | **0** |
| `snapshot-replace-rollback` · `verdict-write-outside-door` · `unaddressable-agent-spawn` · 70 others | — | **0** | **0** |

**Site overlap is 0 against every rule in the registry.** The largest *file* overlap is 4 of 9 with
a 361-file styling rule that matches `disabled:opacity-*` classes — co-location, not duplication.
The three nearest neighbours by subject are at **0 files and 0 sites**, and the reason is
structural: `staged-verdict-map-collapsed` anchors on `useState<Record<string, …Verdict>>` and this
anchors on `useState<Set<…>>`; they partition the two shapes a multi-item decision takes.

**Disclosed recall gap — and it contains this document's own headline.** The pattern asks *"is there
a reconciliation in this file"*, not *"is the reconciliation on the path to the action"*. So it
**cannot see D4** — `ManualReviewList` reconciles at `:267` for the label, does not at `:246` for the
action, and scores **compliant**. It also cannot see D1 or D2, where the reconciliation exists and
the *select-all population* is wrong. True recall over surfaces carrying this condition is roughly
**9 of 13**. The three it misses are the three worst, which is the honest thing to say about a
signal keyed on presence when the condition is a relation (§8 Gap 1). It also cannot see a selection
expressed as `useState<string[]>` (7 more containers), a `useReducer`, or a selection lifted into a
store (0 today, and clause 8 says keep it that way).

**How it fails loudly if its own precondition is absent** — executed against the working tree in a
private scratch registry, exit codes captured directly, never through a pipe:

```
baseline (9 files / 15 matches; control 17/17)   -> exit 0
floor 6000 > 4829 walked                         -> exit 1   "THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"
pattern -> a token appearing nowhere             -> exit 1   "matched zero files anywhere"
roots renamed away                               -> exit 1
extensions -> .svelte                            -> exit 1
exclude path renamed to a missing file           -> exit 1   "the exemption is stale"
exclude reason shortened to "x"                  -> exit 1   "needs a real reason"
goldenPath removed                               -> exit 1   "missing grounding"
baseline deflated (a rise)                       -> exit 1
baseline inflated (a silent drop)                -> exit 1
positive control given a baseline                -> exit 1   "must NOT carry a baseline"
GATE POINTED AT THE COMPLIANT FORM               -> exit 1   files 9 -> 17, matches 15 -> 17
```

The last row is the control's real job: **the two counts must move in opposite directions.** If
`unreconciled-selection-set` falls while the control stays flat, a selection surface was *deleted*
rather than reconciled, and a ratchet would otherwise have recorded that as progress.

**Validated standalone** with
`node scripts/census/run-census.mjs --rules <scratchpad>/rules-bulk-selection-actions-bsa9x.json --check`
— a filename unique to this composer, because siblings share the scratchpad — and **the full
registry was not run** (doctrine §4). **Re-extracted from this finished document and re-run:
identical, 9/15 and 17/17 over 9,658 file-visits against a floor of 4,000.**

```json
{
  "rules": [
    {
      "id": "unreconciled-selection-set",
      "goldenPath": "docs/concepts/golden-paths/bulk-selection-actions.md",
      "title": "A multi-item selection Set reaches an action without ever being reconciled against the rows currently on screen",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "const\\s*\\[\\s*(?:[A-Za-z_$][\\w$]*)?(?:[Ss]elect(?:ed|ion)|[Cc]hecked|[Pp]icked)[\\w$]*\\s*,\\s*set[A-Za-z_$][\\w$]*\\s*\\]\\s*=\\s*useState[^;\\n]{0,90}?(?:Set\\s*<|new\\s+Set)(?=[\\s\\S]*(?:(?:\\[\\s*\\.\\.\\.\\s*|Array\\s*\\.\\s*from\\s*\\(\\s*)(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?(?:[A-Za-z_$][\\w$]*)?(?:[Ss]elect(?:ed|ion)|[Cc]hecked|[Pp]icked)[\\w$]*\\s*(?:\\]|\\))(?!\\s*(?:\\.\\s*filter\\b|\\[))|for\\s*\\(\\s*const\\s+[A-Za-z_$][\\w$]*\\s+of\\s+(?:[A-Za-z_$][\\w$]*)?(?:[Ss]elect(?:ed|ion)|[Cc]hecked|[Pp]icked)[\\w$]*\\s*\\)))(?![\\s\\S]*(?:\\.\\s*filter\\s*\\(\\s*\\(?\\s*[A-Za-z_$][\\w$]*\\s*\\)?\\s*=>\\s*[^;{}\\n]{0,100}\\.\\s*has\\s*\\(|for\\s*\\(\\s*const\\s+[A-Za-z_$][\\w$]*\\s+of\\s+[A-Za-z_$][\\w$]*\\s*\\)\\s*\\{?[\\s\\S]{0,180}?if\\s*\\(\\s*!?\\s*[A-Za-z_$][\\w$]*\\s*\\.\\s*has\\s*\\())",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A component-scoped MULTI-ITEM SELECTION Set (useState<Set<...>> / useState(new Set()) bound to a select-ish name) that (a) is handed to an action RAW - spread, Array.from, or iterated with for..of - and (b) has NO set-membership reconciliation anywhere after its declaration: no `.filter(x => someSet.has(...))` and no `for (const id of prev) if (someSet.has(id))` prune loop. PROXY FOR the stack-free condition: a set of item identities chosen by a human is handed to an action without ever being re-derived against the items that currently exist, so the action can operate on things the user can no longer see and the count beside the button is not the count acted upon. MEASURED 2026-08-17 at 2a874e692: 9 files / 15 matches across 4829 .ts/.tsx files under src, EVERY MATCH OPENED (precision 9/9 files on the stated condition; 8/9 on the stricter 'can it act on an invisible id' - ContextPickerModal.tsx:34 selects context NAMES round-tripped into a skill config, so a vanished context yields a stale string rather than a wrong write). THE POPULATION PARTITIONS EXACTLY: the anchor (any component-scoped multi-item selection Set) matches 31 files = 9 violating + 17 compliant (the positive control) + 2 excluded below + 3 residual whose selection never leaves the component (usePanelRunState.ts model/effort pickers, MonitorChannelGrid.tsx a channel VIEW filter with no action, CreateApiKeyDialog.tsx scope checkboxes). MEASURED BY EXECUTION, not by reading: three of these surfaces were transcribed verbatim into a jsdom + React 19 harness and driven against rows from a READ-ONLY COPY of the operator's live personas.db (347 MB, copied 2026-08-17 02:22 UTC with the app running, never opened for write, deleted after). (1) KnowledgeTree.tsx:83 - selected is never pruned and bulk() at :215-224 sends `[...selected]` raw; over the real 1,306 workspace_knowledge rows, ONE click on the header checkbox selects 1,306 while the topic branch holds 107 and the DataGrid page shows 25 (52.2x the visible rows, 1,199 outside the branch), because selectablePendingIds (:199-202) is computed in KnowledgeTree while the BRANCH, the SEARCH BOX and the PAGE are applied one component lower in FacetedDecisionTable.tsx:123-128; then switching the project filter leaves 0 rows visible and bulk('adopt') still sends all 1,306, every one of them invisible. (2) ProjectManagerPage.tsx:94 - bulkArchive iterates `for (const id of selectedIds)` (:119) with no intersection against the rendered projects. (3) useDrive.ts:259 - selectAll (:537-539) selects `entries`, the UNFILTERED directory listing, while the grid renders visibleEntries (:553, search + kind filter); the selection is cleared on navigation (:384-389, correctly, with the reason written) but NOT on a refresh, so a path another process deleted stays selected and reaches moveManyInto. (4) useExportPicker.ts:78-84 - seven selection Sets over fetched entity lists, all handed raw at :377-383 to export_selective; the weakest included site, kept deliberately because 'another session writes' is the normal condition on this machine. (5) SyncPanel.tsx:40, (6) BundleExportDialog.tsx:73, (7) DataLinksPopover.tsx:45, (8) ChronologyAdoptionView.tsx:707. TWO INDEPENDENT IMPLEMENTATIONS AGREED ON THE ANCHOR (31 files) AND ON THE COUNT (9 violating) AND DESCRIBED DIFFERENT SETS: implementation #2 is a standalone Node walker that tests reconciliation FILE-WIDE rather than after the declaration and models the hand-off only as a spread. It called ChronologyAdoptionView.tsx compliant - hand-verified against this rule, its two `.filter(x => set.has(...))` sites are at :436 and :460, a duplicate-event guard and a name dedupe on UNRELATED collections 247 and 271 lines ABOVE the selection at :707 - and it missed ProjectManagerPage.tsx entirely because that hand-off is a for..of. AGREEING ON A COUNT IS NOT SOUNDNESS: these agreed on 31 and on 9 and were still describing different sets. ZERO SITE OVERLAP with all 152 committed rules, re-measured by re-running each neighbour's own pattern and intersecting - not assumed. The three nearest by subject are at 0 files AND 0 sites: `staged-verdict-map-collapsed` (selective-per-item-verdicts.md) anchors on useState<Record<string, ...Verdict>> where this anchors on useState<Set<...>>, and that path's section 9 names this Set as the half of the condition it CANNOT see; `absent-entity-count-as-zero` (aggregate-count-display.md) owns a count defaulted to 0 from a lookup miss; `unconsented-irreversible-door` (informed-consent-gate.md) owns whether the door is gated at all. The largest FILE overlap in the registry is 4 of 9 with `hand-rolled-disabled-state` (361 files, 815 matches, a styling rule) at unrelated lines - co-location, not duplication. DISCLOSED RECALL GAP, and it contains this document's own headline: the pattern asks whether a reconciliation EXISTS IN THE FILE, not whether it is on the path to the action, so it CANNOT SEE ManualReviewList.tsx, which reconciles at :267 to compute the label and does not at :246 to compute the argument - executed, the bulk bar renders 'Approve 40 reviews?' while handleBulkAction iterates 120 ids, calls resolveReviewRow on 40, and reports the other 80 as approved because the miss branch is `if (!review) return Promise.resolve()` (:249) and Promise.allSettled counts a resolve as success. It equally cannot see PersonaOverviewPage.tsx, where the prune is correct and the SELECT-ALL POPULATION is wrong (one click selects 78 above a 25-row DataGrid page, 53 of them off screen, 77 handed to bulk_delete_personas - which dry-run-preview.md measured at 15,958 rows across 20 tables). True recall over surfaces carrying this condition is about 9 of 13, and the misses are the three worst - which is the honest thing to say about a signal keyed on PRESENCE when the condition is a RELATION between two values at a time (section 8 Gap 1). It also cannot see useState<string[]> selections (7 more containers), a useReducer, or a selection lifted into a store (0 today, and 5 of 5 sibling repos also keep selections component-local - the one thing about this leaf nobody gets wrong). PRECONDITION (must be re-derived per repo): this repo expresses a selection as a React useState Set and a reconciliation as `.filter(x => set.has(...))` or a for..of prune. A repo whose selection is a Vue ref, a checkbox array in a form POST, a Signal<string[]>, or a server-rendered multi-select scores a structural zero here while carrying the condition at scale - measured in the sibling checkouts, where 13 such surfaces exist across personas-web, brainiac, vibeman and ascent, NONE of them prunes a selection at all, and none would match this pattern. Do NOT silence a match by wrapping the spread in a `.filter()` that tests something other than row membership, by renaming the state, or by deleting the bulk action while leaving the checkboxes: the honest fixes are the prune effect (FleetBroadcastModal.tsx:68-85, which writes down why) plus ONE `visibleSelection` value that the label and the handler both read (DeadLetterTab.tsx:227-236 and :558, the reference implementation and the only place in the tree where the count and the argument are the same predicate)."
      },
      "exclude": [
        {
          "path": "src/features/plugins/twin/sub_profiles/CreateTwinWizard.tsx",
          "reason": "selectedChannels is a fixed enum of twin channel kinds rendered from a module constant, not fetched rows - there is no collection an id can leave, so the condition cannot occur; 3 of this repo's 31 selection Sets are option pickers of this kind and this is the only one that also spreads into a call"
        },
        {
          "path": "src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionCard.tsx",
          "reason": "compareSelected is capped at 2 by its own toggle (:71-78) and the use site reconciles by LOOKUP instead of by membership - detail.slots.find(...) for each of the two ids followed by an explicit `if (!leftSlot || !rightSlot) return null` (:316-319), which is this rule's condition satisfied in a shape a membership-based matcher cannot see; if that null guard is ever removed this exemption must go with it"
        }
      ],
      "baseline": { "files": 9, "matches": 15 },
      "floor": 4000
    },
    {
      "id": "unreconciled-selection-set-positive-control",
      "goldenPath": "docs/concepts/golden-paths/bulk-selection-actions.md",
      "title": "POSITIVE CONTROL - the selection reconciled against the live rows",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "const\\s*\\[\\s*(?:[A-Za-z_$][\\w$]*)?(?:[Ss]elect(?:ed|ion)|[Cc]hecked|[Pp]icked)[\\w$]*\\s*,\\s*set[A-Za-z_$][\\w$]*\\s*\\]\\s*=\\s*useState[^;\\n]{0,90}?(?:Set\\s*<|new\\s+Set)(?=[\\s\\S]*(?:\\.\\s*filter\\s*\\(\\s*\\(?\\s*[A-Za-z_$][\\w$]*\\s*\\)?\\s*=>\\s*[^;{}\\n]{0,100}\\.\\s*has\\s*\\(|for\\s*\\(\\s*const\\s+[A-Za-z_$][\\w$]*\\s+of\\s+[A-Za-z_$][\\w$]*\\s*\\)\\s*\\{?[\\s\\S]{0,180}?if\\s*\\(\\s*!?\\s*[A-Za-z_$][\\w$]*\\s*\\.\\s*has\\s*\\())",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL - the COMPLIANT form of the same condition, over the same roots and extensions and off the same anchor: a component-scoped multi-item selection Set that IS reconciled against the live rows somewhere after its declaration, by a membership filter (`rows.filter(r => selected.has(r.id))` or `[...selected].filter(id => rowIds.has(id))`) or by a prune loop (`for (const id of prev) if (liveIds.has(id))`). Measured 2026-08-17 at 2a874e692: 17 matches in 17 files, against the violating rule's 9 files / 15 matches. THIS IS A PARTITION, NOT A RATIO: the shared anchor matches 31 files, and 9 violating + 17 compliant + 2 excluded + 3 residual (a selection that never leaves the component) = 31 exactly. THE REFERENCE MEMBER is DeadLetterTab.tsx:135, the only place in the tree where the number on the button and the argument to the handler are THE SAME PREDICATE: `filteredIds = new Set(filtered.map(e => e.id))` (:227), `visibleSelectedCount` counts `selected` through it (:232-236), and both action buttons pass `Array.from(selected).filter(id => filteredIds.has(id))` (:558, :568) - written twice, three lines apart. It also prunes inside its own fetch (:159-167, 'Drop selections for ids that are no longer in the queue') and subtracts rather than clears on partial failure (:295-303), which is the same algorithm brainiac's ReviewWorklist.tsx:290-296 reinvented independently with the reason in a comment. Two other members carry the reason in prose: FleetBroadcastModal.tsx:41 ('Without this the Set retains dead ids: the N targets counter overstates the real audience and the send loop iterates ids that can only fail') and BacklogPanel.tsx:74 (targetRows at :159-167, 'operate on the SELECTION when there is one, otherwise on everything currently visible'). A MATCH HERE IS NOT A CERTIFICATE: ManualReviewList.tsx:102 sits in this control and is the document's headline defect - its membership filter at :267 computes the LABEL and its action at :246 spreads the raw Set, so the bar says 40 and the loop iterates 120. Membership of this control means a reconciliation EXISTS in the file, never that the action uses it; that relation is section 8 Gap 1 and no census rule can express it. Carries NO baseline by construction: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved (scripts/census/lib/engine.mjs exempts a -positive-control id; merge-published-rules.mjs skips it; verified by deliberately adding one, which exits 1). THE TWO COUNTS MUST MOVE IN OPPOSITE DIRECTIONS: if unreconciled-selection-set falls while this stays flat, a selection surface was DELETED rather than reconciled, and the ratchet would otherwise have recorded that as progress - verified by pointing the violating rule's id at this pattern, which moves 9 -> 17 files and 15 -> 17 matches and exits 1."
      },
      "exclude": [],
      "floor": 4000
    }
  ]
}
```

### The type, alongside the ratchet

The gate counts an **absence in a file**. Three things it cannot reach, in descending importance:

- **The relation between the label and the argument** (§8 Gap 1) — D4, the headline, scores
  compliant here. Only a test that constructs one row set and drives both the label expression and
  the handler can see it.
- **The select-all population** — D1 and D2, both in files that reconcile correctly. The fix is
  **T1's signature change at the primitive** (`onSelectAll: (scope) => void` plus a labelled
  control), which reaches 7 call sites and makes the population unrepresentable-by-omission. Propose
  the type; this rule is the ratchet that holds the line until it lands.
- **Fix the destination before ratcheting the callers** (contract: *a gate on reaching a destination
  is only as good as the destination's defaults*). Routing people to `DataGrid`'s select-all is
  worth little while that control renders as an unlabelled `<div>` with no `role` and no count. Add
  the label first, or the gate routes people to a primitive that is still the reason they were wrong.

**And the instrument that would retire this rule** is not a regex: it is `useRowSelection(rows,
getId)` from §8 Gap 3. Forty lines, 31 call sites, closes P1, P3 and P4 by construction — at which
point this rule should be **deleted**, not baselined at zero.

---

## 12. Corrections to the brief

1. **`sides: "client"` is CORRECT — the first time in this campaign, and the reason it holds is
   worth as much as the four failures.** The doctrine records four consecutive leaves whose
   `sides: "client"` was contradicted by their own measurement, each finding the headline defect on
   the server, and concludes the field is "anti-correlated with where the answer lives". **On this
   leaf it holds cleanly.** Every deviation is in `.tsx`; the exemplar to copy is `.tsx`; the
   census rule's roots are `src/**` and its population is 100% client. The reason is structural and
   generalises: **the server never sees a selection.** All 1,585 registered commands were checked
   and **not one takes a filter as a mutation scope** — the id list is assembled entirely on the
   client, and the three doors that do not take ids (`delete_all_*`) take *nothing*, so there is no
   server-side selection concept to be wrong about. A leaf is genuinely one-sided when the concept
   itself does not cross the boundary. `convergence: mixed` also holds (3 physics, 2 one-repo-alone,
   1 silence), which makes this the second spine label the corpus has upheld and the first `sides`.
2. **The brief's four questions are all answered, and the fourth is answered "neither".** *Does
   select-all mean the page or the result set?* — the result set, 18 of 18 here and 4 of 4 in the
   cohort, and **the hazard is that it is wider than what is rendered, never narrower**, which is
   the opposite of the intuition I started with. *What happens to ids that leave the filter?* —
   nothing, in 28 of 31. *Can a selection outlive the rows it names?* — yes, executed at 1,306 ids
   over 0 visible rows. *Is the action's input the ids or a server-re-evaluated predicate?* — **it
   is always the ids, and that is not the good half of the dichotomy the brief implied.** The three
   doors that are predicate-scoped take no scope parameter at all, so they are worse than either
   option: the client cannot narrow them, cannot preview them, and cannot even name the rule
   (§7 D6, P7).
3. **"Cite `dry-run-preview`'s 15,958 rows, do not re-derive." Cited — and the two paths turn out to
   be describing the same click.** Its §0 measures what 77 ids do; this §0 measures how 77 became
   the number: one press on an unlabelled 16 px square above a 25-row page, selecting 3.12× what is
   visible. Neither composer knew the other half. **The pair is the campaign's clearest instance of
   the corpus feeding itself a lead**, and it is worth noting that the neighbouring path could not
   have found this and this path could not have found that.
4. **"`selective-per-item-verdicts` owns the per-item verdict; 258 verdicts, 0 recoverable."**
   Correct and cited — and that path's §9 **explicitly requested this instrument**, naming the
   `Set<string>` of accepted ids as the half of the condition its own rule cannot see. §9 delivers
   it at 0 site overlap with its rule. Recorded because a brief that primes a composer with a
   neighbour's *disclosed recall gap* is the highest-value form of priming this campaign has found.
5. **The brief's framing "what the action receives" is one word short.** The action receives *ids*;
   what makes this leaf hard is that **the label and the action are two derivations of one
   selection**, and a document that only asks about the argument misses the half where the argument
   is right and the sentence beside it is wrong (D3) or the sentence is right and the argument is
   wrong (D4). The leaf's real subject is the *pair*, which is why P3 exists and why §9's rule
   cannot see the worst instance of it.
6. **"Measure whether any surface can act on an id the user can no longer see." Yes — and the more
   useful measurement is the one that says how far the app is from the fix.** 9 surfaces can act on
   invisible ids; 3 prune; 17 reconcile somewhere. But the fleet number is starker: **0 of 5 sibling
   repos prune a selection at all**, and Personas is the only codebase in six with a prune effect,
   with the reason written down, twice. The brief expected a defect list. Half the finding is that
   this repo is ahead of everyone on the hard half and behind `brainiac` on the easy one — printing
   the number on the checkbox.
7. **A methodological correction to my own first pass, and it is the doctrine's own warning caught
   in the act.** My first census candidate keyed on the raw hand-off alone and reported **41 matches
   in 21 files**; hand-reading them found roughly half were `Array.from(sel)[0]` (a single-item
   read), a prop pass-through, or a pure derivation over a static option catalogue — ~50% precision,
   below the 22%/44% the corpus has correctly declined at, on a rule that *looked* clean in the
   report. The finished pattern is a three-way conjunction (declaration ∧ raw hand-off ∧ no
   reconciliation) at 9/9 hand-verified. **The lesson is the one the doctrine added on 2026-08-16
   from the other direction: measure precision against the FINAL pattern, by opening every match,
   because an intermediate signal can report a bigger, cleaner-looking number for a rule you are not
   going to ship.**
8. **And a second one that cost me the partition.** My verification walker and the census rule
   **agreed on the anchor (31 files) and on the violation count (9) and were describing different
   sets of 9.** The cause: the walker tested reconciliation file-wide; the rule tests it after the
   declaration. Hand-verification resolved all four disagreements in the rule's favour —
   `ChronologyAdoptionView`'s two membership filters are dedupe guards on unrelated collections 247
   lines above the selection, and `ProjectManagerPage`'s hand-off is a `for…of` the walker did not
   model. **Two implementations agreeing on a count is not soundness; two implementations agreeing
   on a count *and on the anchor it came from* is still not soundness.** Confirming the doctrine's
   rule from a third leaf, with a new sharpening: independence requires differing on *scope*, not
   only on direction of entry.
