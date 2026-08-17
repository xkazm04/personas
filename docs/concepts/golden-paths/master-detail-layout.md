# Master-detail layout

> Situation node: `ui-system/layout-and-navigation/master-detail-layout` · situation spine
> `sides: client` · `twoSided: false` · recurrence 4 · risk **medium** · spine label
> `convergence: diverged`. Dimensions: ui · function. Spine's own framing: *"A list beside
> a detail pane with a sensible narrow fallback."*
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. **Short form** (spine header, §0, §2,
> §7, §9, §12) per the batched-tail runbook; the quality core is unchanged.
>
> **Sweep.** All **4,801** `.ts`/`.tsx` files under `src/` walked by four purpose-built
> scanners — a state-shape pass (anchored on `useState`), a resolve pass (anchored on
> `.find(x => x.id === <selection>)` and deliberately *not* on `useState`), a site-level
> miss-classifier, and a reconcile-effect detector. **The first two disagreed by 49 files
> and that disagreement is §0.2.** Read in full: `ExecutionDetailModal/ExecutionDetailContent.tsx`,
> `PatternsPanel.tsx`, `ProfilesAtelier.tsx`, `CredentialTemplateForm.tsx`,
> `CredentialRelationshipGraph.tsx`, `TeamCanvas.tsx`, `ToneAtelier.tsx`,
> `TrainingAtelier.tsx`, `useOnboardingState.ts`, `useSkillTraceModel.ts`,
> `LabVersionsTable.tsx`, `GoalsMissions.tsx`.
>
> **The 2026-08-17 purge — 20,342 rows across 25 tables, including all 78 personas, all
> 351 triggers, 6,535 memories and 2,188 executions — makes "the selected item no longer
> exists" the *ordinary* case in this application today**, not a hypothetical. Counts that
> depend on those rows are historical and were taken from
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`. Counts of source
> code are current.
>
> Convergence oracle: all five sibling checkouts swept read-only.

---

## §0 — The headline

**Ninety-one places in this app resolve a selected id against a list. Fifteen of the
seventy-four files that hold one can survive the selected item disappearing. The other
fifty-nine guard the render, so nothing crashes and nothing is reported — the detail pane
simply empties, the list highlights nothing, and clicking the same row again does nothing,
because the id in state already equals the id you clicked.**

Two things this document does **not** claim, because both were measured and refuted:

- **Selection-by-index is not the problem here.** Across 4,801 files, selection state
  typed `number` appears **4** times and exactly **one** is a genuine positional selection
  (`plugins/artist/sub_gallery/Gallery3D.tsx:114`, a 3-D carousel, where position *is* the
  identity). The other three are a dollar amount, a star rating and a drag counter. This
  **confirms** [`matrix-and-cell-grid`](./matrix-and-cell-grid.md)'s finding of
  selection-by-position at 0 of 16 grids, on a different anchor and a 300× larger
  population. Reported as confirmation, not manufactured into a defect.
- **There is no unguarded resolve.** My strictest classifier flagged 9 sites as having no
  guard. I opened all 9. **Precision 0/9** — every one is guarded, just not on the line the
  regex looked at (`if (!node || node.kind !== 'credential') return null` on the next line;
  `?.name ?? 'Team'` on the same line past the window; `if (!activeTwinId || !activeTwin)
  return <TwinEmptyState/>` thirty lines down). The app does not crash on a missing
  selection. §9 is built on what that measurement leaves standing.

### §0.1 — The three behaviours, counted at the site

| behaviour | sites (of 91) | files (of 74) |
|---|---:|---:|
| **re-derive the effective selection from the current list** — `find(…) ?? list[0]`, `find(…) ? sel : list[0]` | **8** | 8 |
| **reconcile in an effect** — a `useEffect` keyed on the collection that clears or re-points the selection | — | 7 |
| guard to `null` / `undefined` at the resolve and render nothing | 28 + 4 inline | — |
| non-null asserted (`!`) | 2 | — |
| handling exists somewhere else in the file, or nowhere | 49 | — |
| **union: has *any* mechanism for the item disappearing** | — | **15** |
| **no mechanism at all** | — | **59** |

The 59 are not all defects: some resolve against a module-level `const` array that cannot
shrink (`ToneAtelier.tsx:195`'s `CHANNELS`, `TriggerTypeSelector.tsx:23`), and for those
the miss is unreachable. The ones that matter are the ones resolving against a **fetched,
refetching** collection, which is most of `dev-tools`, `twin`, `vault` and `overview`.

### §0.2 — The two scanners disagreed by 49 files, and the disagreement is the finding

Impl A anchored on a `useState` declaration whose name contains a selection word, then
looked for a `.find(…)` in the same file: **25 files**. Impl B anchored on the `.find(…)`
alone and asked only whether the compared variable was selection-named: **74 files, 91
sites**.

The 49 files impl A missed are the ones where **the selection does not live in the
component**. It lives in a Zustand store (`useSystemStore((s) => s.activeTwinId)` —
`ToneAtelier.tsx:71`, `TrainingAtelier.tsx:50`, `ProfilesAtelier.tsx`, `TwinPicker.tsx`,
`useTwinReadiness.ts`, the whole twin surface), or in `workspaceStore.ts:261`,
`companionStore.ts:1394`, `personaSlice.ts:46`, or it arrives as a prop.

That matters beyond arithmetic. **A selection in a store outlives the component that set
it** — it survives navigation away and back, and it survives the list it points into being
refetched or emptied. Every property this document measures gets *worse* when the
selection is store-held, and a scanner anchored on `useState` is blind to exactly those
cases. Had I published impl A's 25, the headline would have been two-thirds too small and
would have excluded the riskiest third.

### §0.3 — Thirty-three selections are object snapshots, and eleven of those are database rows

`useState<T | null>` where `T` is a selection:

| shape | count |
|---|---:|
| `T` is a primitive (an id) | **61** |
| `T` is an object (a snapshot) | **33** |

Of the 33, **11 name a ts-rs binding type** — `PersonaExecution`, `PersonaEvent`,
`PersonaMemory`, `PersonaManualReview`, `PersonaMessage`, `PersonaDesignReview`,
`DirectorRosterEntry`, `MetricAnomaly`, `PersonaHealingIssue`, `SkillEntry`,
`DesignConversation` — i.e. a row that came from the database and can be deleted by
anything. Three more (`GlobalExecution`, `CredentialMetadata`, `RealtimeEvent`) are
server-derived shapes without a binding file. The remaining ~19 are static unions
(`GlyphDimension`, `TriggerCategory`, `RolePreset`, `TourDef`) where a snapshot is fine.

`agents/sub_activity/ActivityModals.tsx` holds **five** of them in one component —
`selectedExecution`, `selectedEvent`, `selectedMemory`, `selectedReview`, `selectedMessage`
— each a full row, none re-derived. A snapshot cannot go stale by being wrong about
identity; it goes stale by being **right about an identity that no longer exists**. On
2026-08-17 that became 20,342 rows at once.

### §0.4 — There is no URL, so there is no free answer

**0 of 74** master-detail surfaces put the selected id in a URL. That is not 74 oversights:
`package.json` declares no router (`react-router`, `@tanstack/react-router`, `wouter`: all
absent), and `useSearchParams` / `useParams` appear **0 times in 4,801 files**. Navigation
is a Zustand key resolved by [`navigation-destination`](./navigation-destination.md).

So the two answers the fleet's server-rendered repos reach for — `ascent`'s
membership-checked `?a=` param and `brainiac`'s *"URL as the single source of truth"* — are
structurally unavailable here, and the question of where a selection lives is
[`view-state-persistence`](./view-state-persistence.md)'s, not a routing question. §2
prescribes accordingly.

### §0.5 — The loading half is already won

**1 of 74** files contains a blanking `if (loading) return …` above its list
(`vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx`). `docs/design/overview-loading.md`'s
law 1 — *a fetch never hides rendered rows* — holds at 73 of 74 measured sites. For
comparison, the same detector run over `vibeman` by the convergence sweep returns **64
sites across 56 files**, with `docs/page.tsx:84` throwing away an entire rendered
master-detail on every project switch. This repo's loading doctrine is doing its job and
this path has nothing to add to it.

---

## §2 — The one way

**Store the id, derive everything else, and validate the id against the current list on
every render — never in an effect.** Concretely:

1. **State holds `selectedId: string | null` and nothing else.** Never the object.
   A snapshot is a copy of a row taken at click time; it cannot notice that the row was
   edited, and it cannot notice that the row was deleted. If the detail pane needs the
   row, it derives it.
2. **Derive the *effective* id during render, from the raw id and the live list:**

   ```ts
   const selectedId = useMemo(
     () => (rawId && items.some((i) => i.id === rawId) ? rawId : items[0]?.id ?? null),
     [rawId, items],
   );
   const selected = useMemo(
     () => items.find((i) => i.id === selectedId) ?? null,
     [items, selectedId],
   );
   ```

   **Keep `rawId` — do not overwrite it.** This is the clause that does the work: filter
   the list and the pane falls back gracefully; *clear* the filter and the user's original
   pick comes back, because nothing ever wrote over it. The best implementation of this in
   the fleet is `personas-web/src/app/dashboard/reviews/ReviewsSplitPane.tsx:61-65`, and
   it is better than anything in this repo (§12.4).
3. **Never reconcile in a `useEffect`.** An effect runs *after* the render that already
   showed the broken state, it needs the collection in its dependency array (which makes
   it fire on every refetch), and it writes state — so it competes with the user's own
   click. Seven files here do it; every one of them could be a `useMemo`. The
   auto-select-first must be a **fallback in a derivation**, never a `setState`, or it
   will fight the user the first time a refetch lands between click and render.
4. **Say something when the selection is gone.** Falling back to `items[0]` is right for a
   picker (a channel rail, an auth method) and wrong for a detail pane the user
   deliberately opened: silently swapping in a different record is worse than an empty
   state. For a detail pane, render `ScenarioEmptyState` with the reason — *deleted*,
   *filtered out*, *not in this project* — which is information the derivation already has
   (`rawId != null && !items.some(...)`) and currently throws away.
5. **Fetch the detail by id when the detail is more than the list row.** Deriving from the
   list array is correct and cheap when the row *is* the detail. When the pane needs more
   (steps, logs, a transcript), fetch by `selectedId` with its own loading state, keep the
   list rendered, and follow `overview-loading`'s law 1 — the detail's fetch must not blank
   the list, and the list's refetch must not blank the detail.
6. **Narrow fallback: one layout, one flag.** Below the breakpoint the surface becomes
   list-**or**-detail: `selectedId == null` shows the list, non-null shows the detail with
   a back affordance that sets it to `null`. `teams/sub_teamWorkspace/TeamCanvas.tsx:33-44`
   already has exactly this shape at every width (`if (!selectedTeamId) return <TeamList/>`
   plus `onBack={() => selectTeam(null)}`) and is the local model to copy.
7. **Put the id where its lifetime says it belongs**, per
   [`view-state-persistence`](./view-state-persistence.md): component state if it should
   die on unmount, a store slice if it should survive navigation, persisted only if it
   should survive a restart — and if it is persisted, clause 2's membership check is what
   stops a rehydrated id from a deleted entity rendering an empty pane on launch.

---

## §7 — Deviations

**D1 — P1: 59 of 74 master-detail files have no mechanism for the selected item
disappearing.** §0.1. The user-visible result is not a crash — it is a dead surface: an
empty detail pane, no row highlighted, and a re-click on the same row that does nothing
because `selectedId === row.id` already. The purge makes this reachable on almost every
surface in the app today.

**D2 — P1: 11 selections hold a ts-rs binding row as an object snapshot.**
`ActivityModals.tsx` (×5), `GlobalExecutionList.tsx`, `LlmCallsTable.tsx`,
`useEventLog.ts`, `MemoriesPageDense.tsx`, `MemoriesPageGraph.tsx`, `MessageList.tsx`,
`useHealingPanelState.ts`, `useAnomalyDrilldown.ts`, `DirectorCoachingTab.tsx`,
`useSkillData.ts`. Each keeps rendering a row that may have been deleted or edited, and
none can tell. This is the same defect the convergence sweep found in
`personas-web` (5 surfaces) and `vibeman` (2) — see §12.4.

**D3 — P1: seven files reconcile the selection in a `useEffect` keyed on the
collection.** `PersonaLayoutView.tsx`, `useOnboardingState.ts:253-260`,
`KnowledgeApprovalsPanel.tsx`, `ContextMapPage.tsx`, `LifecycleProjectPicker.tsx`,
`useTrainingSession.ts`, `useAdoptionDimensionModel.tsx` (+ `GoalsMissions.tsx:124`, which
does both). Every one is correct-but-late: it renders the broken frame first, then fixes
it. All seven are expressible as the `useMemo` of §2.2. Not urgent, but it is the shape
that turns into a fight with the user the moment an auto-select-first is added beside it.

**D4 — P2: `ExecutionDetailContent.tsx:90` is the exemplar and it is one line long.**

```ts
const effectiveSection = sections.find((s) => s.id === activeSection) ? activeSection : (sections[0]?.id ?? 'json');
```

Membership-checked, derived at render, falls back, cannot fight the user. It is used for a
tab strip inside a modal, and nothing else in the repo copies it. **Route new work here
before writing anything new.** Two more sites have the right shape on a different anchor:
`PatternsPanel.tsx:71` (`workspaces.find(…) ?? workspaces[0] ?? null`, with a comment
explaining the sentinel) and `ProfilesAtelier.tsx:162`.

**D5 — P2: zero surfaces expose the selection anywhere addressable.** §0.4. A consequence
worth stating plainly: **no master-detail view in this application can be linked to,
restored after a crash, or reproduced in a bug report.**
[`cross-surface-deep-link`](./cross-surface-deep-link.md) owns the arrival mechanism and
already prescribes resolving-on-landing; the missing half is that these 74 surfaces never
*publish* a selection for it to arrive at.

**D6 — P3: one genuine selection-by-index, and it is defensible.**
`Gallery3D.tsx:114` (`selectedIndex: number | null`) selects a position in a 3-D carousel.
Recorded so that a future sweep counting `selectedIndex` does not report it as the
positional-selection defect this repo does not have.

**D7 — P3: one blanking loading branch.** `CodebaseProjectPicker.tsx` returns before its
list on `isLoading`. Fix per `overview-loading` law 1 when that file is next touched; it is
1 of 74 and the doctrine already owns it.

---

## §9 — The gate: declined, with numbers

**Declined, and the strongest reason is a measurement that came out the *right* way.**

**1. The defect is an absence, and the census ratchets presences.** The condition worth
gating is *nothing re-derives the effective selection from the current list* — 59 of 74
files. The doctrine is explicit (§4): the census "cannot assert an ABSENCE… it ratchets a
count of something present." A rule that counted `.find(sel)` sites would count the
**correct** ones alongside the incorrect ones, since the exemplar (D4) contains a
`.find(sel)` too.

**2. The nearest countable proxies were measured and all three failed.**

| candidate | violating | control | why declined |
|---|---:|---:|---|
| a selection setter taking a bare object (`setSelectedX(row)`) vs an id (`setSelectedX(row.id)`) | 93 | 45 | hand-read the first 25: `setActiveProject(projectId)`, `setActiveTab(tab)`, `setActiveDim(dim)`, `setActiveRunId(runId)`, `setSelectedConnectorTables(nextTables)` — the argument is *already* an id or a non-entity value in most matches. Precision well under 50%. **A gate that fires on correct content is worse than no gate.** |
| `useState<ObjectType \| null>` for a selection | 33 | 61 (`useState<primitive \| null>`) | the partition is clean and the direction is right, but ~19 of the 33 hold **static unions** (`GlyphDimension`, `TriggerCategory`, `RolePreset`, `TourDef`) where a snapshot is correct → ~42% precision. Narrowing it to the 11 binding types requires inlining a hand-picked name list, and the doctrine's own warning applies: a vocabulary derived from imagination distorts both precision and recall. Deriving it from `src/lib/bindings/` (1,035 filenames) is the right instrument and is not a regex. |
| an unguarded `.find(sel)` (no `!x` / `x &&` / `x?.` nearby) | 9 | — | **hand-verified precision 0/9.** Every flagged site is guarded elsewhere. The condition does not exist in this tree. |

**3. The anchor is already occupied.**
[`entity-picker`](./entity-picker.md)'s `missing-current-entity-rendered-as-unset` sits on
`.find((x) => x.id === …)` with a `?.<label> ??` tail (baseline **23 files / 24 matches**,
same roots `src`, same extensions). [`bulk-selection-actions`](./bulk-selection-actions.md)'s
`unreconciled-selection-set` (**9 files / 15 matches**) owns the multi-select half of the
same idea. Any rule I wrote on the single-selection `.find` anchor would overlap the first
at roughly 24 of 91 sites while adding no discrimination the second does not already have
for sets.

**Prefer a type over a gate — and here a type reaches two of the three defects.** Held
against the qualifications:

- **Q5 (withholding beats requiring)** — make the detail component's prop `selectedId:
  string`, never `item: T`. A component that is not given the object cannot render a stale
  one, which removes D2 entirely. This is the same result the doctrine records for
  `KanbanBoard.onItemMove(itemId, targetStatus)` → 1/1 correct versus
  `ReferenceBoard.onReorder(toIndex)` → 0/1.
- **Q6 (withhold the dangerous freedom, not the answer)** — the freedom to withhold is
  *holding a copy*; the answer (which record) still travels, as an id.
- **Q1 (a required prop carries only what it encodes)** is the limit, and it is why this is
  a decline rather than a fix: a `selectedId: string` prop closes *what is held* and says
  nothing about *whether it still resolves*. D1 needs the derivation of §2.2, and there is
  no type that forces a caller to write a `useMemo`.
- **Q3** passes (74 files construct these), **Q4** and **Q7** do not apply.

**The instrument that would work, if one is wanted later.** Not a census rule — an ESLint
rule, because the condition is structural: *a `useState`/store read whose name matches a
selection vocabulary, whose value flows into a `.find`/`.some` over a variable that is
itself a `useState`/query result, in a component with no `useMemo` or `useEffect`
depending on that same collection and writing that same selection.* That is an AST
question with an autofix (wrap in the §2.2 `useMemo`), which is exactly the split
`inline-busy-state.md` §9 describes: **ESLint reports the shape, the census ratchets the
count.** It is out of scope for a short-form path and is recorded here so the next author
does not re-derive the decline.

---

## §12 — Corrections

**12.1 — To my brief: the id-vs-index prediction was right, and the reason to state it is
that it makes the *real* defect visible.** The brief said *"today's `matrix-and-cell-grid`
found selection-by-position at 0 of 16 grids, so expect the id form here too, and if you
find it, say so as a confirmation rather than manufacturing a defect."* Confirmed at a much
larger scale: **1 genuine positional selection in 4,801 files**, and it is a 3-D carousel.
But the confirmation is load-bearing rather than decorative — because selection is by id
everywhere, the failure mode is not "the wrong row" but "**no** row", and that is a failure
that produces no exception, no Sentry event and no visible error. An app that had got the
id/index question wrong would at least crash.

**12.2 — To my brief: "what shows when the selected item disappears" has a sharper answer
than expected, and it is not a crash.** I built a classifier for unguarded resolves,
it returned 9, and hand-verification returned **0/9**. Every one was guarded — by
`if (!node || …) return null` on the following line, by `?.name ?? 'Team'` past my window,
by `if (!activeTwinId || !activeTwin) return <TwinEmptyState/>` thirty lines below. The
honest finding is therefore **the opposite of the one I set out to measure**: this repo
guards the miss with near-total consistency and then does *nothing else with it*. The
defect is the silence after the guard, not the absence of the guard — and no instrument
that looks for missing guards would ever have found it.

**12.3 — To my own first pass: a file-level detector reported category (a) at 8 files and
was wrong about 2 of the 5 I checked.** `LabVersionsTable.tsx:119` and
`GoalsMissions.tsx:129` are `?? null` guards, not fallbacks; they matched because another
line in the same file matched, and my detector asked the file, not the site. Re-run at the
site: **8 sites** genuinely re-derive, and the file/site counts happen to coincide at 8 for
a different reason. Recorded because it is the doctrine's site-vs-file rule biting inside a
document, not just in an overlap table — **a file-level detector answers a different
question than the one you asked, and the answer looks plausible.**

**12.4 — The spine's `convergence: diverged` label: upheld, and this is the fifteenth
label tested. It is also the first `diverged` the corpus has tested.** Effective cohort:
**4 of 5** — `personas-cloud` contains zero `.tsx`/`.jsx` files (headless Node + a Python
facade), which is a correct silence, not a gap.

The four that have UIs genuinely diverge, and the split is architectural rather than
stylistic:

| repo | selection lives in | miss handled by | loading blanks the list |
|---|---|---|---:|
| `personas-web` | component state (1 of 3 in the URL) | **derived-with-fallback, during render** (`ReviewsSplitPane.tsx:61-65`) | 1 (route-level auth gate) |
| `ascent` | the **URL**, resolved server-side with a membership check (`SegmentsSection.tsx:98-101`) | non-nullable by construction (`?? dims[0]!`) | **0** |
| `brainiac` | the **URL only** — zero `selectedId` in the whole console; master and detail are separate routes and a missing slug calls `notFound()` | a real 404 | **0** |
| `vibeman` | stores + component state + 2 object snapshots + `currentIndex` walking a fetched array | a store clear on *delete only* (`collectiveMemoryStore.ts:154`) | **64 sites / 56 files** |

Four repos, four different homes for the same value, and outcomes that differ by an order
of magnitude. `diverged` is correct. **Say the mechanism, per the doctrine's rule for a
label that holds:** the two repos that put selection in the URL are the two that render on
the server, where the URL is the only state that survives the request. The two that hold
it in client state are the two SPAs. The label is tracking a rendering-architecture
boundary, not a taste.

**12.5 — The fleet's best answer is in `personas-web`, and it is better than anything
here.** `ReviewsSplitPane.tsx:61-65` computes validity in a `useMemo` **during render**,
falls back to `filtered[0]?.id ?? null`, and — the clause this repo has nowhere —
**preserves `selectedIdRaw` untouched**, so clearing a filter restores the user's original
pick. It polls every 15 seconds (`usePolling(fetchReviews, 15_000)`), which replaces every
object identity in the list on every tick, and the detail pane does not flicker because it
is re-derived by id. The convergence sweep also confirms it is **not** a port of this
repo's `QueriesTab.tsx` — that file re-validates in the *setter*, which is the weaker
shape. §2.2 is written from `personas-web`, not from here.

**12.6 — `sides: "client"` holds, and the mechanism is the one the doctrine already
names.** Every deviation, every candidate signal and the whole prescription are client
state. The server never sees which row a user has selected — the same structural reason
that made the label hold for `bulk-selection-actions` and `long-list-rendering`. The
adjacent server-side question ("was the row deleted?") belongs to whichever surface deleted
it, not here; this path's job is to notice.

**12.7 — Personas is ahead of the fleet on the loading half and behind it on the
derivation half.** Stated as self-comparison. Ahead: **1 blanking `if (loading) return`
in 74 master-detail files**, against `vibeman`'s 64 across 56 — `docs/design/overview-loading.md`
is measurably holding a line that the fleet's largest UI does not have. Behind: 8 of 91
sites re-derive the effective selection, and the one-line exemplar
(`ExecutionDetailContent.tsx:90`) is used for a modal's tab strip and copied by nothing.
The repo solved the harder problem (never hide rendered rows during a fetch) and left the
easier one (validate the selection against the rows you did render) unsolved 59 times.
