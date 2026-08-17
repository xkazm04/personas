# Golden path — Node canvas

> Situation node: `product-surfaces` › `canvas-and-media` › `node-canvas` ·
> [situation spine](../situation-spine.md) · recurrence 20 · risk **medium** ·
> sides: **client** — **CONTRADICTED**, and not in the usual direction (§12.1) ·
> convergence: **mixed** — **UPHELD**, read per clause: physics on one, this repo ahead on two, the
> fleet converged on the *disease* on three, and one sibling **independently reinvented this leaf's
> headline defect** (§6). Second spine convergence label the corpus has held. ·
> dimensions: **ui · performance · function · code-quality**
> Leaf definition: *"A pannable, zoomable node-and-edge board with layout, selection and filtering."*
> `mergedFrom`: *Entity relationship graph* + *Node-link graph canvas* + *Infinite canvas surface* +
> *Definition flow visualization*
> Composed 2026-08-17 against `master` @ `6c97502d3`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/`, plus the Rust that reads what a canvas writes
> (`engine/src/team_handoff.rs`, `db/src/repos/resources/teams.rs`,
> `src/commands/design/team_synthesis.rs`, `src/engine/llm_topology.rs`,
> `src/commands/infrastructure/dev_tools/portfolio.rs`). The import graph of all 4,829 files was
> **resolved** (`@/` + relative, index files included) and reachability computed from
> `src/main.tsx` + `src/App.tsx`, because one of this leaf's two canvases turns out to be
> unreachable and no amount of reading finds that. Every candidate census signal partitioned into
> violating vs compliant and hand-verified. All **167** registry rules intersected against the final
> pattern at **site** level.
>
> **Measured by EXECUTING, not by reading.** `useIslandDrag` (`:42-78`), `GroupLayer`'s group drag
> (`:73-104`), `CanvasShell`'s `createLink` / `islandAt` / `onIslandTap` (`:340-372`), its
> `onTidy` / `onUndoTidy` (`:427-479`), `MastermindPage`'s `onIslandCommit` (`:617-618`),
> `layoutStore`'s `loadPositions` / `savePositions` (`:336-343`), `deriveScene`'s `deriveEdges`
> (`:76-96`), and `useAutoTeam`'s `removeMember` (`:240-255`) were transcribed into a **jsdom 29.1.1**
> harness — `tidyLayout.ts` and `hex.ts` were not transcribed at all but **compiled by the repo's own
> TypeScript and executed as shipped** — and driven over the operator's **real 14-project Mastermind
> scene, his 8 stored island positions, his 8 teams / 64 members / 70 edges, and his 41-row
> cross-project similarity matrix**, all read from a **read-only copy** of the live **347 MB
> `personas.db`**, copied 2026-08-17 with the app running. The live files were never opened for
> write; **nothing was written anywhere**; the copies were deleted afterwards. Recorded substitutions
> are listed at the end of §0.
>
> **`cargo` was not run.** Every backend claim is either SQL replayed against the copy or a read of
> the statement that issues it.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened, nine clauses each. Lineage checked in both
> directions **by commit date**, and it **inverted**: this repo's canvas was ported *from* `vibeman`,
> not to it (§6). **Effective independent cohort: 2**, with a confound that limits what any of it can
> mean (§6, §12.8).
>
> **Settles:** what a node canvas is allowed to let a user draw, what it owes them about what they
> drew, and what has to be true before an edge on a canvas means anything at all.

> **Post-publication note — 2026-08-17.** This leaf had **two** implementations. One of
> them — `teams/sub_canvas/`, the @xyflow/react trigger/event-chaining board (29 files, a
> 27-action reducer, an optimizer, a dry-run debugger) — was deleted in `78e9bff68` after
> `npm run orphans` put its transitive closure at 0; `TeamCanvas.tsx` had documented it as
> orphaned and it shipped anyway. **The Mastermind canvas survives and is out of bounds for
> deletion** (operator, 2026-08-17). Citations below to `teams/sub_canvas/**` — including
> `teamConstants.tsx:15-16` — are history. The §12.1 finding that this repo's canvas is
> *inherited, not authored* is unaffected: it was about provenance, not reachability.

---

### Sibling boundaries, settled in prose

This leaf sits between the corpus's most confident UI path and its most confident backend one, and
the seams matter more here than usual, because three neighbours have already measured code inside
`sub_mastermind/`.

- [**`drag-reorder`**](./drag-reorder.md) **owns the gesture; this owns the board.** That path
  (recurrence 42) explicitly annexed free-canvas positioning — *"Free canvas positioning (`x`/`y` on
  a plane, no rank) sits at the edge. It is included"* — and it is right to: identity-vs-index,
  commit-once-on-release, what a cancelled drag persists, and the keyboard path are all its
  questions, and its §7-F already measured the **five independent pointer-drag implementations in
  `sub_mastermind/lib/`** and named `GroupLayer.tsx` as the one missing a travel threshold. **None of
  that is re-derived here.** This path starts where a single item's move ends: *which nodes are on
  the board, whether an edge between two of them is legal, what the camera does, and whether anything
  downstream reads the graph.* One correction is returned to it in §12.4.
- [**`canvas-state-persistence`**](../situation-spine.md) (unwritten, recurrence 5, risk **high**)
  **owns the document that outlives the process**; this owns the moment of editing. Settled here so
  the next composer inherits a boundary rather than a negotiation: **that leaf owns
  `mastermind.layout.v1` as a document** — its versioning, its `parseLayout` tolerate-and-drop, its
  500 ms coalescing write-through, its localStorage migration, and the two-writer contract with
  Athena (`layoutStore.ts:1-31`, and it is the best-documented store in the tree). **This leaf owns
  what an edit means before it is written**: whether the operation was legal, whether the user can
  see what it did, and whether it can be taken back. Where they touch — `savePositions`,
  `saveGroups`, `saveLinks` — this path cites the store and prescribes nothing about its durability.
  §0-B's Tidy/Undo finding is deliberately on this side of the line, because it is a defect in the
  *operation*, not the storage: undo restores the coordinates perfectly and still leaves the board in
  a state the user cannot get out of.
- [**`view-state-persistence`**](./view-state-persistence.md) owns the token that survives a restart.
  Its sweep found **zero** canvas viewport state (its own §0 boundary matrix covers scroll offset;
  the word *zoom* does not appear in it), and this path confirms why: **no canvas camera in this repo
  is persisted anywhere** (§0-D). That is a silence its instrument could not have seen, and it is
  reported here rather than filed against it.
- [**`long-list-rendering`**](./long-list-rendering.md) **owns how many rows may render; this owns
  how many nodes may be on the plane.** Its §1 exclusion — *"a collection whose length is a property
  of the code"* — is **adopted verbatim**, and it is what removes flow diagrams over a fixed step
  list, the onboarding progress bar and the preset blueprint previews from this population. Its
  viewport-culling question and this leaf's are the same question with different geometry, and
  `CanvasShell.tsx:245-317` is the tree's answer to the 2D form: cull to the visible world rect plus
  a margin, then mount in waves ordered by distance to the viewport centre. Cited, not re-measured.
- [**`multi-step-orchestration`**](./multi-step-orchestration.md) **owns the DAG the engine walks;
  this owns the DAG the user draws.** Its §0.3 — *"0 of 1,488 live steps has more than one
  dependency; every one of the 383 runs is a linked list"* — is **confirmed independently here**
  (§0-C) and given the other half it was missing: the canvas layer **can** express fan-in, does
  express it 14 times in the operator's own data, and the wiring turns it into an OR-join. Its rule
  keys on a Rust state literal; this one on a TSX handler signature. **Zero site collisions** (§9).
- [**`entity-picker`**](./entity-picker.md)'s `missing-current-entity-rendered-as-unset` rule cites
  `CanvasShell.tsx:878` as one of its three consequence sites. That citation is **confirmed as a
  pattern match and refuted as a live defect** in §12.2 — with the reason, which is worth more than
  the site was.
- [**`bulk-selection-actions`**](./bulk-selection-actions.md) owns selecting many. It never becomes
  relevant here: **no canvas in this repo has multi-select** (§0-E).
- [**`delete-semantics`**](./delete-semantics.md) owns what a destructive door owes the user in
  general. §7-D5 reports the three canvas doors that owe it something and cites rather than
  re-prescribes.

---

## 0. The headline

**This repo has two node-and-edge canvases. The one the user can reach draws edges that nothing
executes, validates nothing when it draws them, and — executed against the operator's own database —
renders a board of 14 nodes and 0 edges, for two independent reasons. The one whose edges the engine
really does compile into runtime wiring has had no user interface since 2026-05-23: 28 of its 29
files are unreachable from the app entry point, while 55 of its 70 edges remain compiled into live
rows in `persona_triggers` — every one of the 55 `chain` triggers in the operator's database is one
of them.**

### A — the fully-validated edge door has no caller, and the caller-facing edge door validates nothing

`teams::create_connection` (`db/src/repos/resources/teams.rs:505-624`) is the best graph-edit door in
the tree, and it is not close. Inside one `BEGIN IMMEDIATE` transaction it rejects a self-loop
(`:516-520`), verifies both endpoints belong to the named team (`:535-563`), rejects a duplicate edge
(`:566-580`), and runs a real cycle check over the existing non-feedback edges via
`NamedTopologyGraph::has_cycle` (`:582-614`). The comment at `:524-528` names the race it is
defending against by hand, because `persona_team_connections` has no `UNIQUE` constraint.

Its consumers, measured over the resolved import graph:

```
frontend callers of createTeamConnection / deleteTeamConnection / updateTeamConnection
  in src/features/**                          : 0
  in src/stores/slices/pipeline/teamSlice.ts  : 3 actions, fully written, optimistic + rollback + a
                                                team-switch staleness guard  ->  0 consumers
  anywhere in src/                            : 1  (useAutoTeam.ts:169, an LLM topology generator)
```

The canvas those actions were built for is `src/features/teams/sub_canvas/**`. Reachability from
`src/main.tsx` + `src/App.tsx` over the resolved import graph of all 4,829 files:

```
files under features/teams/sub_canvas/  : 29
reachable from the app entry            :  1   (libs/CanvasDragContext.tsx, imported by PersonasPage)
unreachable                             : 28   (every node, every edge, the reducer, the debugger,
                                                the optimizer, the assistant, the alignment guides)
```

`TeamCanvas.tsx:3-13` says so in its own header — *"the /prototype round (2026-05-23) replaced the
React Flow DAG canvas with the Split Studio … those files are now orphaned and slated for removal"* —
and the follow-up cleanup has not happened. The filename is still `TeamCanvas.tsx`; it renders a
roster.

The canvas the user *can* reach is the Mastermind board, and its edge door is three lines:

```ts
// CanvasShell.tsx:340-345
const createLink = (from: string, to: string) => {
  const l: UserLink = { id: canvasId('l'), from, to, label: '', dashed: false, color: LINK_PALETTE[0], author: 'user' };
  commitLinks([...links, l]);
```

Driven in the harness over the operator's real 14 islands, every ordered pair, twice:

```
ordered pairs driven                        : 392
links created                               : 364      distinct (from,to) pairs: 182
SELF-EDGES created                          :   0      (the tap flow cancels — CanvasShell.tsx:370)
DUPLICATE edges created                     : 182      of 182 repeat attempts  (100%)
graph contains a CYCLE                      : true     (there is no cycle check on this path)
drag-release ON the source island           :   0 links, 0 self-edges, 14 releases into empty water
```

So the two doors are exact inverses:

| | `CanvasShell.createLink` — reachable | `teams::create_connection` — unreachable |
|---|---|---|
| self-edge | prevented, **incidentally** (`islandAt(p, exclude)` withholds the source; the tap flow cancels) | rejected explicitly, `:516` |
| duplicate | **no** — 182 of 182 | rejected, `:566-580` |
| cycle | **no** | rejected, `:582-614` |
| endpoints exist | **no** | verified, `:535-563` |
| concurrency | n/a | `BEGIN IMMEDIATE`, `:530-532` |
| **the engine executes it** | **no** | **yes** — `team_handoff.rs:63-186` |

**The repo's best answer to this leaf's hardest question is behind a door nobody can open, and the
door everyone uses answers none of it.** That inversion is the leaf.

### B — the reachable canvas renders zero edges, for two independent reasons, and neither is visible

`deriveEdges` (`deriveScene.ts:76-96`) is the entire edge source for the Mastermind board. It reads
two collections out of the cross-project metadata blob and keys both against the island slug set.
Replayed verbatim over the operator's real blob (`dev_tools_cross_project_metadata`, 46,105 bytes,
generated 2026-07-23):

```
islands (projects)                                          : 14
similarity_matrix rows                                      : 41
  ...whose endpoints resolve in the ISLAND KEY SPACE        :  0  of 41
  ...whose endpoints resolve in the PROJECT-NAME space      : 41  of 41
  ...at or above the 0.5 gate (deriveScene.ts:89)           :  0      max similarity in the corpus: 0.07
relations rows                                              :  0      (cross_project_relations: 0 rows)
------------------------------------------------------------------
derived edges rendered                                      :  0
user-drawn links in the layout document                     :  0
TOTAL EDGES ON A 14-NODE NODE-AND-EDGE CANVAS               :  0
```

The two halves of `deriveEdges` consume **two different key spaces**, and the producer says so:
`portfolio.rs:381-382,:425-426` writes `similarity_matrix.source` from the project's **name**, while
`portfolio.rs:80` writes `relations.source` from `r.source_project_id`, an **id**. `Island.slug` is
the passport identity slug — a project id at 12 of the operator's 14 islands. So the half with data
cannot match, and the half that could match has never had a row.

Even if the key spaces agreed, the `0.5` threshold would reject all 41: **the maximum Jaccard
similarity across the operator's whole portfolio is 0.07.** Two independent causes, and the surface
distinguishes neither of them from "these projects are unrelated". A canvas whose defining feature is
edges is rendering none, and says nothing.

### C — the graph can express fan-in; the engine has never executed a join

`multi-step-orchestration` measured the engine end. This is the canvas end, over the same install.

```
teams with a topology                         :   7      (identical 9-member shape, machine-authored)
edges                                         :  70      sequential 56 · feedback 14
self-edges                                    :   0
duplicate (team, source, target)              :   0
edges with a dangling endpoint                :   0
back-edges (cycles) over non-feedback edges   :   0
nodes with IN-DEGREE > 1  (a fan-in / join)   :  14      2 per team
nodes with degree 0 (never send, never receive):  7      1 per team
```

The graph is clean — because `create_connection` refuses everything else. But what the runtime does
with the 14 fan-ins is not what the picture says. `wire_team_handoff` (`team_handoff.rs:104-186`)
creates **one chain trigger per edge** on the target and **one listener per target**
(`handoff_event_type` is `team_handoff.<target>`, `:57-59`, deliberately per-target *"so a fan-in
target needs only one receiver even with multiple inbound edges"*). The target therefore fires when
**any** upstream completes. **A converging pair of arrows on the canvas is an OR-join in the
engine — a race, not a join.** And downstream of that, over the operator's real execution history:

```
team_assignment_steps                         : 1,488
  depends_on length 0                         :   383
  depends_on length 1                         : 1,105
  depends_on length >1                        :     0
```

Confirmed independently of the neighbour leaf, by parsing the column rather than by reading its
prose. **A user can draw a diamond. The engine has never run one, and the wiring would race it if
they did.**

Wiring coverage of the 70 drawn edges, replayed against the live `persona_triggers` (351 rows):

```
non-feedback edges                            : 56
  fully wired (chain trigger + listener)      : 55
  wired at neither end                        :  1      8403367e… "T: Solution Architect" -> "T: Dev Clone",
                                                        team "SDLC — Medical Bill Negotiator"
feedback edges                                : 14      never wired, by design (team_handoff.rs:105-108)
------------------------------------------------------
drawn edges with NO runtime effect            : 15  of 70  (21.4%)
```

### D — what the canvas lets you set, against what the runtime reads

Every column of `persona_team_connections`, checked against the `SELECT` in `wire_team_handoff`
(`:86-89`) and against `build_condition` (`:203-214`):

| The canvas can express | Live rows | The engine reads it |
|---|---:|---|
| edge direction S → T | 70 | **yes** |
| `connection_type: sequential` | 56 | yes → `{"type":"success"}` |
| `connection_type: conditional` | 0 | yes → parses `condition` as JSON |
| `connection_type: parallel` | 0 | **NO — byte-identical to `sequential`.** `build_condition` branches only on `"conditional"`; the doc comment at `:201-202` says so. It is a colour (`teamConstants.tsx:16`, `#10b981`, strokeWidth 3). |
| `connection_type: feedback` | 14 | as **skip** — 20% of the drawn graph |
| `condition` (JSON predicate) | 0 | only when `connection_type === "conditional"`; set it on a sequential edge and it is silently discarded |
| `label` | **70 of 70 non-null** — e.g. *"reviewed changes to audit (code_review.completed)"* | **NO.** The string `label` does not occur once in `team_handoff.rs`. |
| node `position_x` / `position_y` | 64 rows | **NO** |

**Four edge types render as four distinct strokes and the engine distinguishes two.** Every edge in
the operator's database carries a hand-written label describing what flows across it, and the wiring
never selects the column.

And the layout the canvas exists to capture, in the same table:

```
persona_team_members                          : 64 rows, 0 NULL positions
distinct position_x values                    : {0, 240, 480, 720, 960, 1200}
distinct position_y values                    : {0, 120, 320}
positions that are a multiple of 20           : 64 / 64
members sharing an exact position with another member of the SAME team : 6  (3 pairs, all at 240,120)
persona_teams.canvas_data                     : NULL on 8 of 8 teams
```

Every position is on the seed grid. **No node in the executable graph has ever been moved**, because
since 2026-05-23 there has been nothing to move it with — and three pairs of nodes are drawn exactly
on top of each other.

### E — the camera, the undo, and the selection, executed

**Undo restores the coordinates and destroys the operation.** `onTidy` (`CanvasShell.tsx:427-470`)
snapshots every island's position, arranges the board with `tidyLayout`, and offers a single-level
`onUndoTidy` (`:472-479`). Both write through `onIslandCommit`, which is
`savePositions({ ...loadPositions(), [slug]: { x, y } })` (`MastermindPage.tsx:617-618`). And
`tidyLayout` treats **an entry in the positions map as a pin** (`CanvasShell.tsx:436`,
`tidyLayout.ts:129`). Executed over the operator's real 14 islands and his real 8 stored positions:

```
pinned (islands with a stored position) BEFORE tidy : 8 of 14
islands actually moved by tidy                      : 6
pinned AFTER tidy                                   : 14
pinned AFTER undo                                   : 14      (coordinates restored EXACTLY)
islands newly pinned by pressing UNDO               : 6
islands a SECOND tidy can move, after that undo     : 0 of 14
```

**Undo is not the inverse of Tidy.** It restores every coordinate perfectly and converts six derived
positions into six user pins, and because pins are what Tidy is forbidden to move, the feature the
user just undid is now permanently inert. Nothing on screen says the board changed state; the button
simply stops doing anything, forever, and there is no affordance anywhere that unpins an island.

**The camera is reinvented per surface and persisted nowhere.** Six independent 2D pan/zoom cameras
exist in `src/`, no two agreeing on a zoom range:

| Camera | Clamp | Wheel binding |
|---|---|---|
| `teams/sub_mastermind/lib/useCanvasCamera.ts:152,:163` | `MIN_Z 0.06 · MAX_Z 3` | native, `{ passive: false }` |
| `overview/sub_patterns/graph/useGraphCanvas.ts:90,:103` | `MIN_K 0.22 · MAX_K 4` | native, `{ passive: false }` |
| `plugins/dev-tools/sub_projects/TeamGraphPreview.tsx:174` | `MIN_SCALE 0.5 · MAX_SCALE 4` | **React synthetic `onWheel`** |
| `plugins/artist/sub_gallery/Gallery2D.tsx:267` | `MIN_ZOOM 1 · MAX_ZOOM 5` | **React synthetic `onWheel`** |
| `plugins/drive/components/DriveImageLightbox.tsx:268` | `MIN_ZOOM 1 · MAX_ZOOM 8` | **React synthetic `onWheel`** |
| `plugins/artist/sub_media_studio/TimelinePanel.tsx:232` | `MIN_ZOOM/MAX_ZOOM`, 1-D | **React synthetic `onWheel`** |

None is in `shared/`. **None is persisted** — `useCanvasCamera.ts:65` starts every mount at
`{ x: 0, y: 0, z: 0.5 }`, and no `partialize` entry, `localStorage` key or settings row anywhere in
the tree holds a viewport. The operator's eight dragged islands survive a restart; where he was
looking does not. And three of those cameras call `preventDefault()` inside a handler React
registers passively, which is §9.

**Selection is single-node or absent.** `CanvasShell` holds `hover`, `kbFocus` and `linkSource`;
there is no `Set` of selected ids and no marquee anywhere in the file. `bulk-selection-actions` never
becomes relevant to a canvas in this repo.

**The one thing this canvas does better than anything else in the fleet** is keyboard navigation:
`kbNav.ts` is real spatial navigation — a directional cone with a perpendicular weight, falling back
to nearest so *"a sparse or single-column map can never trap the cursor"* — and `CanvasShell.tsx:912-914`
announces the move through an `sr-only` `aria-live` region. Copy it.

### F — the denominators

| denominator | what it counts | count |
|---|---|---:|
| **D1** — every `.ts`/`.tsx` under `src/` | the sweep | **4,829** |
| **D2** — files matching a node-and-edge signature mechanically (`@xyflow/react`, or nodes+edges+a plane+a line element) | implementation B | **19 in 12 directories** |
| **D3** — node-canvas **surfaces**, hand-verified, implementation A | **the leaf** | **9** |
| **D4** — …that are **read-only viewers** (no move, no edge create, no delete) | | **7 of 9** |
| **D5** — …where the user can **move a node** | | **1** (Mastermind) |
| **D6** — …where the user can **create an edge** | | **1** (Mastermind — and its edges are executed by nothing) |
| **D7** — …where the user can **delete a node** | | **1** (`MemoriesPageGraph.tsx:247`; Mastermind can *hide* an island, not delete it) |
| **D8** — …that pan and zoom | | **3**, via **3 independent cameras** (6 in the repo counting the media surfaces), **0 shared, 0 persisted** |
| **D9** — …whose layout is stored rather than recomputed every render | | **3** (Mastermind's doc; the two preset previews read `member.x/y`; `TeamGraphPreview` reads `position_x/y`) |
| **D10** — canvas edits with a confirmation | | **0** of 3 destructive doors |
| **D11** — canvas edits with an undo | | **1** (Tidy only, single-level, and §0-E) |
| **D12** — tests asserting a node drag, an edge creation, or a canvas mutation of any kind | | **0**. `useIslandDrag`, `createLink`, `GroupLayer`, `NoteLayer`, `LinkLayer` appear in **zero** test files. |
| **D13** — census rules keying on canvas, graph, node/edge, drag, pointer, zoom/pan, viewport or undo | | **0 of 167** |
| **D14** — `@xyflow/react` importing files / files rendering `<ReactFlow` | | **11 / 1** — 8 of the 11 are in the orphaned tree |
| **D15** — `@dnd-kit/core`, declared at `package.json:106` | imported under `src/` | **0** |

**D2 vs D3 is a 2.1× swing and the disagreement is instructive.** The mechanical signal over-counts
(it splits one canvas into six files: the node, the edge, the ghost edge, the reducer, the guides) and
**under-counts** the surfaces whose edges are drawn as `<path d={…}>` with no word `edge` in the file
(`GraphCanvas.tsx`, `MemoriesPageGraph.tsx`, `ChannelMap.tsx`). Quote **9**; a file count is not a
surface count on this leaf, because a canvas is a directory.

> **Substitutions recorded.** JSX omitted — every handler transcribed is a plain function and was
> called directly; React refs replaced by `{ current: <a real jsdom `SVGGElement`> }`, so
> `setAttribute('transform', …)` was executed against a real DOM node; `useEventCallback` omitted (it
> returns the same function); the layout store replaced by its own two-line body
> (`layoutStore.ts:336-343`) **with the 500 ms debounce removed**, because the debounce decides *when*
> a write lands and not *what* it writes, and the leaf next door owns *when*. `tidyLayout.ts` and
> `hex.ts` were **not** transcribed — they were compiled by the repo's own `typescript` and executed
> as shipped. The harness exits 2 if the scene holds fewer than ten projects, if the layout document
> is absent, or if either compiled module fails to produce a function.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and the leaf's centre.** **An edge is a claim, and the surface that lets a user
> draw one must be the surface whose edges are honoured.** A node canvas is not a diagram; it is an
> authoring tool for a relation something downstream consumes. If the drawing surface and the
> executing surface are different artifacts, they will drift, and the drift is invisible from both
> ends — the drawer sees a picture that behaves, the executor sees a graph nobody is editing.
> *Warrant: executed — one codebase holds two node canvases; the one that validates every edge
> against a real topological check has had zero user-facing callers for three months while its 70
> edges keep firing, and the one the user can reach creates duplicates at a 100% rate, admits cycles,
> and is read by nothing.*
>
> **P2 — physics.** **Validate an edge where it is drawn, not where it is run.** Legality — no
> self-loop, no duplicate, no cycle, both endpoints present — is a property of the graph, which means
> it is knowable at the moment of the gesture, when the user is looking at the thing they just did.
> Deferring it to the writer means the refusal arrives without a cursor near it, and deferring it to
> the executor means it never arrives at all.
> *Warrant: executed — the door that validates lives in the database layer, so its five refusals
> reach the one caller as five thrown errors that are individually swallowed and reported only as a
> smaller count; the door that does not validate is the one attached to a pointer.*
>
> **P3 — physics, and the one worth the most.** **Every property the canvas lets a user set on a
> node or an edge must be read by whatever executes the graph — or the canvas must not offer it.** An
> unread property is worse than a missing feature, because the user has been invited to express
> something and told nothing about its being discarded. A distinct stroke is a promise of distinct
> behaviour.
> *Warrant: measured — four edge types render as four distinct strokes and the executor distinguishes
> two of them; a per-edge free-text label is present on 100% of the live rows and the executor's
> query does not select the column; a per-edge condition is honoured only under one of the four
> types, silently.*
>
> **P4 — physics, and the least obvious.** **A canvas that derives its edges from a foreign
> identifier must prove the identifiers match, and must never let "no edges" mean two things.** Zero
> edges because nothing is related and zero edges because the join failed are the same picture. The
> canvas has to be able to say which.
> *Warrant: executed — a node-and-edge board renders 0 edges over 14 nodes for two simultaneous and
> independent reasons: the relation source is keyed by name while the nodes are keyed by id, so 0 of
> 41 candidate edges resolve; and the strength threshold is 7× the highest value the corpus contains.
> Neither is distinguishable on screen from a portfolio with no relationships.*
>
> **P5 — function.** **Undo must restore the state the operation replaced, including the properties
> that decide what future operations may do.** Restoring the values while promoting derived state to
> authored state is not an undo; it is a second, invisible edit whose effect is to disable the
> feature.
> *Warrant: executed — a one-shot arrange followed by its own undo restores 14 of 14 coordinates
> exactly and takes the count of user-pinned nodes from 8 to 14, after which the arrange can move 0
> of 14 nodes and no affordance exists to reverse the pinning.*
>
> **P6 — ergonomics, and the transfer failure.** **A canvas camera is a primitive, not a
> per-surface decision.** Pan, zoom-to-cursor, the clamp, and the platform detail that makes a wheel
> gesture actually work are one problem with one answer, and every surface that re-answers it gets a
> different feel and re-acquires the same platform bug.
> *Warrant: measured — six independent 2D cameras in one codebase, six different zoom ranges, none in
> the shared layer; the two that live in a hook are the two that bind the wheel in the only way the
> browser honours, and the four written inline are the four that do not — including one whose comment
> states the exact failure it is failing to prevent.*
>
> **P7 — ergonomics.** **A destructive canvas edit needs either a confirmation or an undo, and one
> of the two is not optional.** On a canvas the target is small, the pointer is already moving, and
> the object carries the user's own arrangement work — the three conditions under which an accidental
> click is most likely and most expensive.
> *Warrant: measured — three destructive doors (delete a zone, delete a link, delete a note), zero
> confirmations, zero undo coverage; one of them fires on `pointerdown` rather than click, so it
> cannot be aborted by dragging off the target; and the same directory reaches for the repo's
> confirm-dialog primitive for a **reversible** bulk revert.*
>
> **P8 — code-quality.** **A relation authored as a pair of array positions must be converted to
> identities at the first boundary it crosses, and never converted back.** An index is a statement
> about an array at an instant; a graph outlives the array.
> *Warrant: executed — the only path in this app that can create an executable edge carries its
> endpoints as `source_index`/`target_index` from the model's output through the type system to the
> UI; the rebase arithmetic that keeps it correct is right for 63 of 63 real single removals, and a
> second removal carrying a pre-rebase index produces a different graph in 189 of 504 pairs.*
>
> **Scale condition.** P1 and P3 arrive the moment a second consumer of the graph exists. P2 arrives
> at the first cycle. P4 arrives the first time the two sides are generated by different code. P5
> arrives on the first press of undo. P6 arrives at the second canvas. P7 arrives at the first
> mis-click, and P8 at the first removal.

---

## 1. Trigger

- "Show these as a graph so you can see what connects to what."
- "Let them lay out the pipeline / team / dependency map on a canvas."
- "Make the board pannable and zoomable."
- "Drag from this node to that one to connect them."
- "Arrange / tidy / auto-layout the map."
- "Why does the diagram show an arrow there when it doesn't actually run?"
- "The graph is empty — are there really no relationships?"

**If you are about to write** an array of `{ id, x, y }` and an array of `{ from, to }` and render
both in one coordinate space, **you are in this situation.** Also if you are about to write
`transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}`, or `onWheel`, or `<ReactFlow
nodes={…} edges={…}>`, or a function that takes two node ids and appends an edge.

You are **not** in this situation when the node set's length is a property of the code rather than of
the data — a fixed five-step flow diagram, an onboarding progress rail, a preset blueprint preview.
That exclusion is [`long-list-rendering`](./long-list-rendering.md)'s and is adopted verbatim. You
are not here for **the gesture** that moves one item — that is
[`drag-reorder`](./drag-reorder.md), which owns identity-vs-index, commit-on-release and the keyboard
path. You are not here for **how the layout survives a restart** — that is `canvas-state-persistence`.
And a kanban board is not a canvas: its columns are code-determined and
[`drag-reorder`](./drag-reorder.md) already owns `KanbanBoard`.

---

## 2. The one way

**Draw the graph the executor reads, validate every edge at the gesture, and render nothing the
executor ignores.** Concretely: (a) **Name the consumer before you name the node type.** If a
scheduler, compiler or runtime walks this graph, the canvas edits *its* rows — not a parallel
annotation document that happens to look the same. If nothing consumes it, say so on the surface;
"this is a sketch" is honest and "this is a pipeline" is not. (b) **Put the legality check in a
function both the gesture and the writer call**, and make it return a *reason*, not a boolean:
self-edge, duplicate, would-create-a-cycle, endpoint-gone. Run it on hover so the drop target refuses
before the release, and run it again in the transaction that writes. (c) **Audit the edge and node
properties against the executor's read.** Every stroke style, every dropdown value, every label field
must map to something the consumer selects; delete the ones that do not, or mark them
*annotation-only* in the UI. (d) **Derive edges only from identifiers in the node key space, and
assert it** — when a join yields zero, distinguish "no relations" from "no matches" and say which,
because they render identically. (e) **Take the camera from one shared primitive**: pan by pointer
capture, zoom-to-cursor bound through a native listener with `{ passive: false }`, one clamp, and an
imperative transform during the gesture so the world does not re-render. (f) **Make undo restore
provenance, not just values** — if a position's *existence* means "the user pinned this", undo must
delete the entries it created, not write them. (g) **Every destructive canvas door gets a
confirmation or an undo**, on `click`, never on `pointerdown`. (h) **Carry identity, not indices**,
from the first boundary the graph crosses. (i) **Then stop**: no second camera, no free-text id field
beside the canvas, no fourth edge type nothing reads.

If you must get one right first: **(a)**. Every other clause is about telling the truth about the
graph; that one is about the graph being real, and it is the only clause whose violation cannot be
seen from inside either half.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`db/src/repos/resources/teams.rs:505-624` `create_connection`** | **The reference edge door**, and the only complete one in six repositories: self-loop rejected, both endpoints proved to belong to the team, duplicate rejected, cycle rejected through a real topological check, all inside `BEGIN IMMEDIATE` with the race named in the comment. Copy this function's *shape* into any language. | **1** (`useAutoTeam.ts:169`) |
| **`teams/sub_mastermind/lib/kbNav.ts`** | **Spatial keyboard navigation** — a directional cone with `PERP_WEIGHT`, falling back to nearest so the cursor can never be trapped. Paired with the `aria-live` announcement at `CanvasShell.tsx:912-914`. The only keyboard-operable canvas in the fleet. | 1 |
| **`teams/sub_mastermind/lib/useCanvasCamera.ts`** | **The camera done right**: pointer-capture pan, zoom-to-cursor accumulated to one commit per animation frame (`:200-204`), a quantised zoom band so islands re-render ~12 times per doubling instead of once per frame, a `useLayoutEffect` re-assertion against a mid-pan reconcile, and the wheel bound natively with `{ passive: false }` — with the reason in the comment at `:82-87`. **It is feature-local; promote it to `shared/hooks` as `useCanvasCamera` and route the other five through it.** | 1 |
| **`teams/sub_mastermind/lib/tidyLayout.ts`** | **A one-shot, deterministic, relation-aware arrange** — bounded spring-electrical pass, bounded overlap resolution, no `Date`, no `Math.random`, slug-sorted iteration, a hashed tie-break for coincident points, and pinned nodes as fixed anchors. No idle simulation. This is the answer to "auto-layout" in a codebase with an animation-austerity rule. | 1 |
| **`CanvasShell.tsx:245-317`** | **2D viewport culling with mount waves** — cull to the visible world rect plus a margin, then mount in waves ordered by distance to the viewport centre, with a budget that only grows. [`long-list-rendering`](./long-list-rendering.md)'s problem in two dimensions. | 1 |
| **`teams/sub_mastermind/lib/useIslandDrag.ts:28`** | `onCommit(slug, x, y)` — **a move expressed as identity plus world coordinates, with no index and no neighbour anywhere in the signature.** The 4 px threshold that separates a click from a drag, and exactly one commit on release. Owned by [`drag-reorder`](./drag-reorder.md) §7-F, which says extract it; cited here because it is the shape P8 asks for. | 4 in-directory reimplementations |
| **`personas_core::topology_graph::NamedTopologyGraph`** | `has_cycle()` over `(&[String], &[(&str,&str)])`. The check exists, is generic, and has **one** caller. | 1 |
| **`engine/src/team_handoff.rs:63-186`** | **The graph→runtime compiler**, and it is idempotent: re-running skips edges already wired by matching on the plaintext `source_persona_id`. If your canvas has an executor, this is the shape — a repair pass, not a one-shot. | 1 |

**Explicitly NOT primitives:**

- **`src/features/teams/sub_canvas/**`.** 28 of 29 files unreachable from the app entry point since
  2026-05-23. It contains the repo's only React Flow canvas, its only node context menu, its only
  edge legend, its only alignment guides and its only dry-run debugger. Do not import from it; do not
  copy from it without checking whether the API it targets still exists.
- **`@dnd-kit/core`.** Declared at `package.json:106`, **imported by 0 of 4,829 files.**
  [`drag-reorder`](./drag-reorder.md) says the same thing from the other side.
- **`CanvasShell.createLink`** (`:340-345`). Not an edge door; an array append. See §0-A.
- **`BlueprintConnection`** (`src/lib/bindings/BlueprintConnection.ts`):
  `{ source_index: number, target_index: number, connection_type: string }`. **A relation type with no
  identity in it at all.** §4-T1.
- **A second camera.** There are six. See §0-E.

---

## 4. Steps

1. **Name the consumer of the graph, in writing, before anything else.** Who walks these edges — a
   scheduler, a compiler, a prompt assembler, nobody? Write the answer in the component header.
   `team_handoff.rs:1-31` is what that header looks like when the answer is "the trigger engine",
   and it is the reason that graph's semantics are knowable at all.
2. **Get the node set from the same place the consumer does.** If the executor reads
   `persona_team_connections`, the canvas edits `persona_team_connections`. A parallel document is
   how §0-A happened.
3. **Write one `edgeVerdict(graph, from, to, type)` returning a reason or `null`,** and call it
   from three places: the drop target's hover state, the create handler, and the transaction that
   writes. The four reasons are not negotiable — self, duplicate, cycle, missing endpoint — and the
   third one is the one everybody skips.
4. **Audit properties against the executor's `SELECT`.** Open the query the consumer runs. Any field
   the canvas offers that is not in it is either a bug in the consumer or a lie in the canvas. Fix
   one of the two before shipping the control. `label` on 70 of 70 rows against a query that does not
   select it is what happens otherwise.
5. **If edges are derived rather than drawn, assert the key spaces.** One line —
   `if (candidates.length && matched === 0) reportKeyMismatch()` — turns §0-B's two silent causes into
   a visible one. Then give the empty state two arms: *"no relationships recorded"* vs *"N candidate
   relationships did not resolve"*.
6. **Take the camera from the shared hook.** Pointer-capture pan, zoom-to-cursor,
   `addEventListener('wheel', h, { passive: false })` — **never a React `onWheel` prop if the handler
   calls `preventDefault`**, which is §9. One clamp for the app.
7. **Cull by geometry, not by count.** Compute the visible world rect, add a margin covering a
   render-free pan, mount in waves ordered by distance to the viewport centre.
8. **Make undo an inverse.** Snapshot what an operation *reads* as well as what it writes. If the
   presence of a key means something (pinned, authored, user-owned), the undo must restore the
   presence, which usually means deleting entries rather than writing them.
9. **Confirm or undo every destructive door**, bound to `click`.
10. **And then stop.** Do not add a fourth edge type before the executor reads the third. Do not add a
    free-text id field beside the canvas. Do not write a second camera. Do not leave a superseded
    canvas in the tree — 28 unreachable files is the cost of the last time.

### Can the type make the wrong call impossible? — asked before §9

Held against the seven qualifications in [the doctrine](../golden-path-doctrine.md).

**T1 — YES, and it is the cheapest edit in this document: put identity into `BlueprintConnection`.**
The bad state is a relation whose endpoints are positions in an array that is about to change.

```ts
// today — src/lib/bindings/BlueprintConnection.ts
export type BlueprintConnection = { source_index: number, target_index: number, connection_type: string };
// proposed
export type BlueprintConnection = { source_key: string, target_key: string, connection_type: string };
```

- **Q5/Q6 (withhold the dangerous freedom, not the answer) — passes, and this is the qualification
  that decides it.** The dangerous freedom is *addressing a graph endpoint by a position that another
  edit can invalidate*. Withholding it costs nothing the feature needs: the model is already asked to
  emit a member list, so it can emit a key per member and reference it, exactly as `useIslandDrag`
  hands back `(slug, x, y)` and never an index. The answer — *which two things are connected* — is
  preserved in full.
- **Q7 (relaxing a requirement is inert where the caller supplies the bad value voluntarily) — the
  one that shapes the edit.** Nobody forces `useAutoTeam` to rebase indices; it does so because the
  type it was handed leaves it no choice. The lever is therefore not to make anything required, it is
  to make the index **unspellable at the boundary** — remove the field, and the six lines of rebase
  arithmetic at `useAutoTeam.ts:246-252` become `connections.filter(c => keep.has(c.source_key) && keep.has(c.target_key))`.
- **Q3 (a type nobody constructs constrains nothing) — passes.** `BlueprintConnection` is
  constructed at **4 sites** (`team_synthesis.rs:47-48,:640-644,:669-677`, `llm_topology.rs:32-33,:202`)
  and consumed at 3 in TypeScript. All 7 are in this leaf's blast radius, which is small enough to
  land in one change.
- **Q1 (a type carries only what it encodes) — the honest limit, and it is large.** This closes P8
  and nothing else. It says nothing about P1 (which canvas is wired), P3 (unread properties), P4 (the
  key spaces), P5 (undo) or P6 (the camera). Those live in five different values.
- **Measured, so the claim is not theoretical:** the existing arithmetic is *correct*. Executed over
  the operator's 7 real topologies, all 63 single-member removals produce byte-identical graphs to an
  identity-based ground truth. **The type edit is not a bug fix — it is the removal of a question.**
  Two removals where the second carries a pre-rebase index diverge in **189 of 504 pairs (37.5%)**,
  and the only thing standing between the current code and that is React re-rendering between two
  clicks.

**T2 — YES for edge legality, and it is a newtype, not a field.** The bad state is an edge object
that exists without having been checked. Make the collection accept only a proved edge:

```ts
type Verdict = { ok: true; edge: ValidEdge } | { ok: false; reason: 'self' | 'duplicate' | 'cycle' | 'missing-endpoint' };
declare function proposeEdge(graph: Graph, from: NodeId, to: NodeId, type: EdgeType): Verdict;
// and: commitLinks(links: ValidEdge[])   — ValidEdge is not constructible outside proposeEdge
```

- **Q4 (a type anyone can construct authenticates nothing) — the qualification this must survive, and
  it survives only under one condition.** `ValidEdge` must have a private brand and no public
  constructor; a structural TypeScript type with the same fields is a comment, exactly as
  `UserDb(state.db.clone())` was. In TypeScript that means a unique symbol brand and a module that
  does not export the constructor.
- **Q2 (requiredness is orthogonal to closedness).** Making `createLink`'s parameters required
  changes nothing — they already are. The closedness is the whole win: today `UserLink` is a plain
  interface any call site can build, and the harness built 364 of them in a loop.
- **Where it does not reach — and this is doctrine item 5, the serialization boundary.** The brand
  survives until `JSON.stringify(doc)` at `layoutStore.ts:252`, and a document read back at
  `parseLayout` (`:205-224`) is *cast*, not proved. So the type protects the session and not the
  document; the document needs a validation pass on hydrate, which is
  `canvas-state-persistence`'s to write.

**T3 — NO for P3 (unread properties), and the reason is worth stating.** "The executor reads every
property the canvas offers" is a relation between a TypeScript type and a SQL `SELECT` list in
another language, and no type spans it. This is the same refusal
[`long-list-rendering`](./long-list-rendering.md) reached for the soundness of a sort and
[`entity-picker`](./entity-picker.md) reached for a cap — **a type cannot encode a relation between a
value and a value it never meets** — reached here from a third direction, which is now enough
independent sightings to call it general. The instrument for P3 is not a type and not a census rule;
it is a **test that asserts the executor's projection covers the canvas's editable field set**, and
§9 specifies it.

**Fix the type before pointing a gate at it.** T1 is a seven-site edit and removes a whole class of
question; §9's rule is a ratchet on a different concern entirely, and says so.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Two canvases over one graph — one that draws, one that runs** | Executed: 28 of 29 files of the executing canvas are unreachable; its 70 edges still fire chain triggers daily; the reachable canvas's edges are read by nothing. Neither half can see the other's state. §7 D1. |
| **An edge door that is an array append** | Executed: 182 of 182 repeat connect gestures create a duplicate; a cycle is reachable; there is no reason string anywhere because there is no check. `CanvasShell.tsx:340-345`. §7 D2. |
| **Validating an edge only in the writer** | The five refusals in `create_connection` reach the one caller as five thrown errors, each `silentCatch`ed (`useAutoTeam.ts:176`) and reported only as a smaller `connectionCount`. The user is never told which edge their blueprint lost, or why. §7 D3. |
| **An edge property the executor does not select** | `label` non-null on 70 of 70 rows; the string does not occur in `team_handoff.rs`. `connection_type: 'parallel'` renders a distinct 3px green stroke and compiles to the same predicate as `sequential`. §7 D4. |
| **Deriving edges from a foreign key space with no assertion** | Executed: 0 of 41 similarity rows resolve because the producer writes names and the canvas keys ids; the threshold would have rejected all 41 anyway. A 14-node node-and-edge canvas renders 0 edges and says nothing. `deriveScene.ts:76-96`, `portfolio.rs:80,:381-382,:425-426`. §7 D5. |
| **An undo that writes where the operation read** | Executed: Tidy→Undo restores 14 of 14 coordinates and takes user-pinned nodes from 8 to 14, after which Tidy can move 0 of 14. `CanvasShell.tsx:436,:472-479`. §7 D6. |
| **A camera per surface** | Six independent 2D cameras, six zoom ranges (`0.06–3`, `0.22–4`, `0.5–4`, `1–5`, `1–8`, 1-D), none shared, none persisted. §7 D7. |
| **`onWheel` + `preventDefault`** | React registers `wheel` **passively** at the root, so `preventDefault` is a no-op and the container scrolls instead of the canvas zooming. Three sites, one of which has a comment stating the exact failure it is failing to prevent (`TeamGraphPreview.tsx:175-177`). §9. |
| **A destructive canvas door on `pointerdown`** | `GroupLayer.tsx:224` deletes a user-drawn zone from a `pointerdown` on an 8px circle — no confirmation, no undo, and not abortable by dragging off. The same directory uses `ConfirmDialog` for a *reversible* bulk revert. §7 D8. |
| **A relation addressed by array index** | `BlueprintConnection` carries `source_index`/`target_index` and no identity, across a ts-rs boundary, into a UI whose whole job is removing members from that array. Correct today by six lines of rebase arithmetic; 37.5% of two-removal sequences diverge if one index is stale. §4-T1. |
| **A canvas with no keyboard path** | Not a defect here — `kbNav.ts` + the `aria-live` region at `CanvasShell.tsx:912-914` is the fleet's best answer. Listed so an adopter does not skip it: **an off-screen node is not in the DOM** under viewport culling, so keyboard navigation must move the *camera*, not the focus ring. `CanvasShell.tsx:386-389` says exactly that. |
| **Leaving the superseded canvas in the tree** | 28 unreachable files, ~2,300 lines, still importing `@xyflow/react` — the whole reason `PersonasPage.tsx:11-15` carries a comment explaining that it deep-imports rather than using the barrel, to avoid pulling a React Flow runtime into the app bundle. Dead code with a live cost. §7 D1. |

---

## 6. Evidence

**The ONE file to copy: `src/features/teams/sub_mastermind/lib/` — as a directory, not a file.** Its
camera (`useCanvasCamera.ts`), its culling (`CanvasShell.tsx:245-317`), its keyboard navigation
(`kbNav.ts`), its deterministic arrange (`tidyLayout.ts`) and its drag contract
(`useIslandDrag.ts:28`) are, individually, the best implementations of those five problems in six
repositories. What it does not have is a consumer for its edges, a legality check, a real undo, or a
confirmation on any of its three delete buttons — which is precisely the shape of this leaf: **the
hard parts are solved and the meaningful parts are not.**

```ts
// useIslandDrag.ts:28 — the move, expressed with no index anywhere in the signature
onCommit: (slug: string, x: number, y: number) => void;

// useCanvasCamera.ts:82-87,:163 — the wheel bound the one way the browser honours
//   "Wheel must be a native non-passive listener: React's synthetic onWheel is
//    passive by default, and a zoom that cannot preventDefault scrolls the …"
svgEl.addEventListener('wheel', onWheel, { passive: false });

// CanvasShell.tsx:386-389 — the fact an adopter will get wrong
//   "an off-screen island is not in the DOM (viewport culling + the mount
//    waves), so nothing here may look for a node" — focus moves the CAMERA

// teams.rs:516-614 — the edge door, four refusals in one transaction
if (source_member_id == target_member_id) { return Err(Validation("Self-loop not allowed…")) }
…  if exists { return Err(Validation("Duplicate connection…")) }
…  if graph.has_cycle() { return Err(Validation("This connection would create a cycle. Use
       connection_type \"feedback\" for intentional back-edges.")) }
```

That last error string is the best sentence in this leaf: it refuses, gives the reason, and names the
legal way to express what the user was trying to say. **Nothing on the reachable canvas can produce a
sentence like it, because nothing on the reachable canvas checks anything.**

**Secondary exemplars, each for one clause:**

| Site | What to copy |
|---|---|
| `db/src/repos/resources/teams.rs:505-624` | **P2 done properly** — four refusals with reasons, in one `BEGIN IMMEDIATE`, with the concurrency hazard named in prose at `:524-528`. |
| `engine/src/team_handoff.rs:1-31,:63-186` | **P1's other half** — a graph→runtime compiler that is a *repair pass*: idempotent, re-runnable, reporting `edges_total / edges_wired / skipped_existing`. Its header states which visual property maps to which runtime row, which is the audit P3 asks for, written down. |
| `teams/sub_mastermind/lib/tidyLayout.ts:1-14,:129` | **A deterministic one-shot arrange**, with the pinned-anchor decision and the "an include-pinned variant would drop this guard" note left at the exact line. |
| `teams/sub_mastermind/lib/kbNav.ts:20-27` | **The only keyboard-navigable canvas in the fleet**, with the trap-avoidance fallback documented. |
| `CanvasShell.tsx:319-332` | **The gesture/commit split**: `camRef` for live gesture math, `cam` state for render, and `persist: false` for a live drag frame so memory updates without scheduling a write. |
| `plugins/dev-tools/sub_projects/TeamGraphPreview.tsx:56-58` | **A layout empty state that names the cause** — *"If all members are at (0, 0)…"*. The only canvas in the tree that anticipates a degenerate stored layout. |

**Tests: nine files, and zero of them touch a mutation.** `useCanvasCamera.test.ts` is the only test
in `src/` that simulates a pointer event on a canvas, and it tests the *camera*. `tidyLayout.test.ts`,
`kbNav.test.ts`, `layoutStore.test.ts`, `layoutAuthorship.test.ts`, `persistence.test.ts`,
`canvasActionStore.test.ts`, `mapModel.test.ts` and `graphEdges.test.ts` cover layout math, keyboard
geometry, persistence round-trips and edge *modelling*. **`useIslandDrag`, `createLink`, `GroupLayer`,
`NoteLayer` and `LinkLayer` appear in zero test files** — the entire mutation surface of the one
editable canvas is untested, and the two `.tsx` island tests stub `onIslandCommit` as a noop
(`farIslandBody.test.tsx:20`, `midLanes.test.tsx:153`). Four layout functions
(`computeGraphLayout`, `computeNexusLayout`, `buildGraph`, `computeClusterPositions`) appear in no
test at all. There is no test anywhere that a graph the user can draw is a graph the engine can run —
which is this document's entire §0.

### Convergence — 5 siblings swept, 9 clauses, effective independent cohort 2

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist, all five were opened, none is a git fork of this repo** (each sibling's
root commit was tested for reachability from `personas` HEAD; all five negative).

**Lineage — checked by commit date, and it INVERTED the assumed direction.** The campaign has been
treating `vibeman` as a peer and, where lineage was suspected, assuming this repo was the ancestor.
[`schema-driven-form`](./schema-driven-form.md) dated that wrong once already; this leaf dates it
wrong again, on the canvas itself:

> **`vibeman` commit `2953479a`, 2026-02-16 18:25 — "feat(personas): add Team Canvas UI for
> multi-agent pipeline design"** — added `TeamCanvas.tsx`, `team/PersonaNode.tsx`,
> `team/ConnectionEdge.tsx`, `team/TeamToolbar.tsx` **inside vibeman**, and pulled in
> `@xyflow/react` two minutes later. **This repo's first commit is 2026-02-17 09:12**, ~15 hours
> later, and its `ConnectionEdge.tsx` / `PersonaNode.tsx` land on 2026-02-19 in a commit titled
> *"Add personas-desktop application source code"*. The identity is textual, not structural: the same
> import line, the same destructured prop list in the same order, `borderRadius: 12`, and the
> `TYPE_STYLES` quartet including `conditional: { stroke: '#f59e0b', strokeDasharray: '6 3',
> strokeWidth: 2 }` — which is alive today at
> `teams/sub_canvas/libs/teamConstants.tsx:15`.

**And the ancestor finished the job this repo started.** `vibeman` deleted its copy on 2026-06-15;
this repo deleted the *host* on 2026-05-23 and left the 28 parts. Both repos now carry
`@xyflow/react` in `package.json` with almost nothing importing it — vibeman at **zero** imports, this
repo at 11 files of which 8 are unreachable. **Two repos, one author, the same library, the same
abandonment, and only one of them cleaned up.**

**The cohort, and the confound.** `personas-cloud` is excluded — self-declared port
(`eventProcessor.ts:30` *"Ported from desktop engine/background.rs::event_bus_tick()"*), reads
`data/personas.db` directly (`orchestrator/src/index.ts:48`), and has no frontend at all.
`vibeman` is excluded **as a canvas witness**: it is the *origin* of this repo's canvas, so agreement
is one decision wearing two coats — although its three *current* canvases are independent d3 work
(`MatrixDiagramView` 2026-01-27 and `ZoomableCanvas` 2026-02-01 both predate this repo entirely) and
its findings are reported for their content. `ascent` has no canvas and contributes a silence.
`personas-web`'s `src/components/sections/team-canvas/` is a **name collision** — 39 lines of
marketing wrapper with zero drag, edge or click handlers — but its `src/components/flow-composer/` is
a genuine, independently written, hand-rolled SVG canvas. **Effective independent cohort: 2**
(`personas-web`'s flow composer, `brainiac`'s CortexMap).

> **And a confound the corpus should carry upward, because it bounds every convergence result in this
> campaign: all six repositories have the same author.** "Independent" here has always meant
> independent *code*, never independent *judgment*. A 3-of-3 agreement in this fleet is one
> developer's habit measured three times. That does not make the results useless — a habit repeated
> under three different constraint sets is still evidence about the constraints — but it means
> **agreement is the weakest signal available here and cost, failure and inversion are the strong
> ones**, which is what the doctrine already says for other reasons.

| Clause | Verdict |
|---|---|
| **C1 — is there a node-and-edge canvas?** | **3 of 5.** `personas-web` (`flow-composer/`, hand-rolled SVG), `brainiac` (`CortexMap.tsx`, read-only), `vibeman` (**three**: `ArchitecturePlayground`, `MatrixDiagramView`+`ZoomableCanvas`, `GoalConstellation`). `personas-cloud` and `ascent`: **absent**, searched by name and by nine libraries. |
| **C2 — what a node drag commits: index or identity?** | **PHYSICS, 3 of 3, and it upholds P8.** `personas-web`: `use-flow-composer.ts:111`, `n.id === dragNode`. `vibeman`: `ArchitecturePlayground.tsx:61`, `{ type: 'MOVE_NODE'; nodeId: string; x; y }`. This repo: `onCommit(slug, x, y)`. **Not one array index in the cohort.** The one index-addressed relation in six repositories is this repo's `BlueprintConnection` — §12.3. |
| **C3 — is layout persisted?** | **Personas is AHEAD, and it is the only one.** This repo writes a versioned document to the DB. `personas-web` encodes the graph into the **URL hash** (`use-flow-composer.ts:53-66`, debounced 500 ms) — a shareable-link answer worth stealing. `vibeman` persists **nothing** in all three canvases (`useArchitectureData.ts:150-151` hardcodes `x: 0, y: 0` and recomputes; the constellation re-randomises per mount). `brainiac` stores only a selected node id. |
| **C4 — is the viewport persisted?** | **Converged on the disease: 0 of 3**, and 0 of 6 counting this repo. `vibeman`'s `ZoomableCanvas.tsx:130` holds the transform in `useState`; its one consumer drives a zoom-percentage badge. Nobody in six codebases can reopen a board where they left it. §8 Gap 6. |
| **C5 — what edge creation validates** | **SPLIT, and this repo is simultaneously the fleet's best and its worst.** `personas-web` (`:150-176`): self ✓, duplicate ✓ *with a comment about two queued clicks*, cycle structurally impossible (bipartite), endpoints partial. `vibeman` (`ArchitecturePlayground.tsx:111-127`): self ✓, duplicate ✓ but direction-sensitive (A→B and B→A both persist), **cycle detected only post-hoc** by a DFS in `playgroundValidation.ts:68-130` that gates a button while the cyclic edge is drawn anyway, endpoints ✗ — and both refusals are **silent**, the reducer just resets to `'select'`. **This repo's `create_connection` is the only door in six codebases that rejects a cycle at creation time — and it is unreachable; the door that is reachable checks nothing.** |
| **C6 — undo** | **Converged on the disease: 0 of 3.** No snapshot stack, no command log, not even single-level, anywhere. `vibeman` binds Escape/Delete/Backspace and leaves Ctrl+Z unbound (`:591-607`) while persisting nothing — a destroyed layout there is unrecoverable. **This repo's Tidy undo is the fleet's only undo of any kind**, which is what makes §0-E's defect worth fixing rather than deleting. |
| **C7 — confirmation before a destructive canvas edit** | **Converged on the disease: 0 of 3.** `personas-web`'s `FlowLegend.tsx:10` advertises *"Hover node to delete"* — a hover-revealed one-click destructive control that cascade-deletes the node's wires (`:141-144`). `vibeman` has four unguarded paths and zero matches for `confirm(` / `ConfirmDialog` / "Are you sure". |
| **C8 — is the drawn graph executed?** | **The finding of the sweep, and it makes P1 physics: `vibeman` independently built the same defect.** `ArchitecturePlayground` is a complete graph editor with a prominent **"Generate Plan ▶"** button (`:663-670`) whose `onGeneratePlan?` prop **is never passed by its only mount site** (`OverviewLayout.tsx:111-115`) — and neither are `existingNodes`/`existingEdges`, so the `LOAD_EXISTING` path (`:465-489`) is dead too and the editor always opens empty. Every property it lets a user set (`integrationType`, `protocol`, `dataFlow`, `framework`) is read by nothing outside the component, and two of them are not even on the validation type. **Two codebases, two finished node editors, both disconnected from the thing that was supposed to consume them, discovered independently.** `personas-web` is honest about being a picture — its terminal affordance is a CTA to this app. |
| **C9 — does the canvas disclose what it hides?** | **0 of 3, the shape [`entity-picker`](./entity-picker.md) named.** `brainiac` is worse than silent: `CortexMap.tsx:153` renders the literal string `"50 hubs · 7 teams (mock)"` over hardcoded synthetic data, and caps neighbours undisclosed at `cortex-data.ts:188` `.slice(0, 4)`. `vibeman`'s `Graph.ts:135-165` **counts** its dropped edges and exposes `droppedEdgeCount` — **no UI reads it**. The fleet's one good instance is `vibeman`'s `MatrixTierAggregate.tsx:73` (`{aggregate.nodeCount} projects` + *"Zoom in for node details"*), and it is on the semantic-zoom path only. |

**Net: `convergence: mixed` HOLDS, read per clause** — physics on C2, the fleet ahead of this repo on
nothing, this repo ahead on C3 and C6, the fleet converged on the *disease* on C4, C7 and C9, and C8
independently reinventing this leaf's headline. It is the second spine convergence label the corpus
has upheld, and — like the first — it only holds because the cohort was established before the
clauses were counted. §12.8.

---

## 7. Deviations

### The population — 9 surfaces, hand-verified, every column checked at a `file:line`

| # | Surface | Nodes / edges from | Layout | Move | Edge create | Delete | Pan+zoom | Select | Undo |
|---|---|---|---|:-:|:-:|:-:|:-:|---|:-:|
| 1 | **Mastermind** `sub_mastermind/lib/CanvasShell.tsx:111` | passports + `deriveEdges` / `useLayoutLinks` | spiral `hex.ts:25` **+ stored doc** | **yes** `useIslandDrag.ts:20` | **yes** `:340` | links/notes/groups (**not islands** — hidden only, `MastermindPage.tsx:680`) | **yes** `useCanvasCamera.ts:59` | single (hover + `kbFocus` + `linkSource`) | Tidy only |
| 2 | **Pattern Nexus** `sub_patterns/graph/PatternGraphHost.tsx:47` | prop + `listPatternEdges` IPC `:124` | computed `PatternGraphNexus.tsx:105` | no | no | no | **yes** `useGraphCanvas.ts:51` | single `:72` | no |
| 3 | **Credential graph** `vault/sub_dependencies/GraphCanvas.tsx:35` | `buildCredentialGraph` | computed `graphLayout.ts:43` | no | no | no | **no** | single, toggling `:34` | no |
| 4 | **Research graph** `research-lab/sub_graph/GraphPanel.tsx:31` | store slices `:36-40` | fixed columns `graphLayout.ts:36` | no (`nodesDraggable={false}` `:173`) | no (`nodesConnectable={false}` `:174`) | no | React Flow `:178` | single `:52` | no |
| 5 | **Memories constellation** `sub_memories/components/MemoriesPageGraph.tsx:27` | store; edges **derived** `:91,:309-324` | computed `:272-307` | no | no | **node delete** `:247` | no | single, toggling `:46` | no |
| 6 | **Channel map** `fleet/monitor/channels/map/ChannelMap.tsx:56` | `listTeamMembers` + `listTeamConnections` `:79` | `buildConstellation` `mapModel.ts:97` | no | no | no | no (fixed `viewBox` `:179`) | **none** — click drills out `:249` | no |
| 7 | **Team graph preview** `dev-tools/sub_projects/TeamGraphPreview.tsx:61` | props | **stored** `position_x/y` `:102-103`, fit-projected | no | no | no | **yes** `:174` | none | no |
| 8 | **Preset connection graph** `presetStudio/PresetConnectionGraph.tsx:57` | `preset.members/connections` | **stored** `(m.x, m.y)` `:102`, fit-projected | no | no | no | no | multi (`selectedRoles: Set` `:25`) | no |
| 9 | **Preset graph adapter** `templates/sub_presets/PresetGraphAdapter.tsx:32` | `preset.members/connections` | **stored**, same math as 7/8 (deliberately duplicated, `:15-20`) | no | no | no | no | none | no |

**Seven of nine are read-only viewers.** Exactly one surface can move a node, exactly one can create
an edge, and they are the same one — the one whose edges nothing executes.

**Excluded, with the test applied:** `obsidian-brain/sub_graph/GraphPanel.tsx` and
`companion/BrainViewer.tsx` (`grep -c "<svg"` = **0** in both — stat tiles and lists named "graph");
`sub_knowledge/KnowledgeGraphDashboard.tsx` (a virtualized list);
`ResearchProjectListCartograph.tsx` (a categorical scatter — positions are axis-derived, **no edges
at all**); `templates/sub_diagrams/FlowDiagram.tsx` (the closest call: it computes a real BFS
layering from an edge set at `:59-102`, but nodes get no 2D coordinates — layers are flex rows and no
edge is drawn between any *pair*, only one connector between consecutive layers at `:132-148`, so it
is a layered list); `triggers/sub_studio/TriggerStudioCanvas.tsx` (20 lines, renders a row ledger; its
`GhostCables.tsx` draws "cables" as a `→` glyph in a flex row); `negotiatorStepGraph.ts` (no renderer
exists — its three consumers resolve an ordered step *list*).

### D1 — the executing canvas has been unreachable for three months; the drawing canvas is read by nothing

`src/features/teams/sub_canvas/**` — 28 of 29 files unreachable from `src/main.tsx`/`App.tsx`.
`TeamCanvas.tsx:3-13` documents the removal and the un-done cleanup. `teamSlice.ts:238-304` holds
three fully-written, optimistic, rollback-guarded connection actions with **zero consumers**.
`teams::create_connection`, the best edge door in the repo, is reachable from the UI only through
`useAutoTeam` — an LLM blueprint applier. **A user of this application cannot draw an executable edge
by hand.** All 70 edges in the operator's database were machine-authored.

### D2 — `createLink` is an array append

`CanvasShell.tsx:340-345`. No duplicate check (182 of 182), no cycle check (a cycle was constructed in
the harness), no endpoint-existence check, no reason string. The self-edge case is prevented, but
*incidentally* — `islandAt(p, exclude)` at `:348-357` withholds the source from the drop search, and
`onIslandTap` at `:370` treats a second tap on the source as a cancel. Neither is a check; both are
consequences of other decisions, and either could be undone by a refactor that meant nothing by it.

### D3 — a refused edge disappears

`useAutoTeam.ts:168-177` wraps each `createTeamConnection` in `try/catch` → `silentCatch`. The comment
above it (`:155-162`) is honest about why — one bad edge must not abort the whole build — and stops
one step short: the count is corrected and **the user is never told which edges were refused or
why**, even though the backend produced four distinct, user-facing reason strings. On the operator's
current topologies the three index guards fire **0 times** (self-index 0, out-of-range 0, duplicate
0), so the swallowing is currently inert — and unobservable by construction.

### D4 — properties the executor does not read

`persona_team_connections.label`: non-null on **70 of 70** rows, carrying real content
(*"security-cleared changes (security.scan.completed)"*); the identifier `label` appears **0 times**
in `team_handoff.rs`. `connection_type: 'parallel'`: a distinct 3 px `#10b981` stroke
(`teamConstants.tsx:16`) compiling to the identical predicate as `sequential`
(`team_handoff.rs:203-214`). `condition`: honoured only when the type is `conditional`, silently
discarded otherwise; 0 live rows use it. `position_x`/`position_y`: 64 rows, read by no engine code.

### D5 — a 14-node node-and-edge canvas renders 0 edges and says nothing

`deriveScene.ts:76-96` against `portfolio.rs:80` (id-keyed `relations`, 0 rows) and
`portfolio.rs:381-382,:425-426` (name-keyed `similarity_matrix`, 41 rows, 0 resolving). Threshold
`0.5` at `deriveScene.ts:89` against a corpus maximum of `0.07`. Two independent causes; the surface
distinguishes neither from an unrelated portfolio.

### D6 — Tidy's undo pins the board

`CanvasShell.tsx:436` reads `Object.keys(loadPositions())` as the pinned set; `:472-479` restores by
calling `onIslandCommit` for **every** slug in the snapshot; `MastermindPage.tsx:617-618` writes a
key per call. Executed: pinned 8 → 14, second Tidy moves 0 of 14, and there is no unpin affordance in
the tree. **The minimal fix is one line** — snapshot which slugs *had* an override and `delete` the
rest on undo — and it changes runtime behaviour, so it is a note, not an apply.

### D7 — six cameras

`useCanvasCamera.ts` (`0.06–3`), `useGraphCanvas.ts` (`0.22–4`), `TeamGraphPreview.tsx` (`0.5–4`),
`Gallery2D.tsx` (`1–5`), `DriveImageLightbox.tsx` (`1–8`), `TimelinePanel.tsx` (1-D). None in
`shared/`. None persisted — no `partialize` entry, storage key or settings row in the tree holds a
viewport, so every canvas opens at its default framing on every visit.

### D8 — three destructive doors, zero confirmations, one Tidy-only undo

`GroupLayer.tsx:224` (`onPointerDown` → `onDelete(g.id)` on an 8 px circle), `LinkEditor.tsx:71`,
`NoteEditor.tsx:98`. `AthenaPanel.tsx:117` and `AthenaRevertControl.tsx:40` in the same directory use
`ConfirmDialog` — for reverting Athena's own annotations, which is the *reversible* operation.
See [`delete-semantics`](./delete-semantics.md) for the general contract; the canvas-specific point
is that `pointerdown` removes even the drag-off escape a `click` binding would have given.

### D9 — a filter prop that is passed and never read

`GraphCanvas.tsx:13-14` declares `filteredNodes` and `filteredEdges` in its props interface;
`CredentialRelationshipGraph.tsx:155-156` passes both; **`GraphCanvas.tsx:35` does not destructure
either.** The filter works only by dimming (`:83-87`), so a "filtered" credential graph still renders
every node and every edge at reduced opacity, and the component's own type advertises a narrowing it
does not perform. Same family as
[`entity-picker`](./entity-picker.md)'s `ThemedSelectOption.description` — **a declared slot that
silently discards its argument** — which is now the third sighting of that shape in the corpus and
probably deserves a name.

### D10 — smaller items

- `persona_team_connections` has no `UNIQUE(team_id, source_member_id, target_member_id)`; the
  duplicate check is application-level inside a transaction, and `incremental.rs:947-961` had to
  de-duplicate the table once already before adding an index.
- 3 pairs of team members sit at exactly `(240, 120)` — nodes drawn on top of each other in the
  layout the orphaned canvas would render.
- 7 of 64 team members (one per team) have degree 0: they neither receive nor emit a handoff, and
  nothing on any surface reports it.
- 102 of 1,306 nodes in the workspace pattern graph (1,326 edges, all `rel = 'governs'`, 0 cycles, 0
  self-edges, 0 dangling) and 12 of 32 memory nodes are likewise isolated.
- `BlueprintPreview.tsx:46` keys rows as `` `${member.persona_id}-${i}` `` — an index in the key of
  the one list whose entire purpose is removal from the middle.

---

## 8. Gaps

1. **There is no shared canvas layer.** `src/features/shared/components/` has ~115 primitives and not
   one of them is a camera, a node, an edge, a marquee or a graph. Every canvas in this repo starts
   from an empty file, which is why there are six cameras and one keyboard implementation.
2. **`@xyflow/react` is a graph library with one rendered surface.** `<ReactFlow` appears **once** in
   4,829 files (`research-lab/sub_graph/GraphPanel.tsx:161`), and that surface is a read-only viewer
   — `nodesDraggable={false}` (`:173`), `nodesConnectable={false}` (`:174`), `edgesFocusable={false}`
   (`:175`), and **there is no `onConnect` handler anywhere in `src/`**. Eleven files import the
   package; **eight of them are in the orphaned tree**. The library that would answer most of this
   leaf is installed, paid for in bundle size, and used for a graph nobody can edit. `vibeman` reached
   the same end state and deleted the imports; this repo kept them (§6).
3. **A canvas cannot express a join.** Even with fan-in drawn, `wire_team_handoff` compiles it to one
   listener per target, so the semantics are OR. There is no AND-join anywhere in the engine, and
   [`multi-step-orchestration`](./multi-step-orchestration.md) shows the step layer has never carried
   a second dependency either. Whatever a user draws, the runtime is a linked list.
4. **No canvas has multi-select**, so no canvas can express a group operation on nodes; the Mastermind
   board's `GroupRect` is a *geometric* group (membership is "centre inside the rectangle",
   `GroupLayer.tsx:82`, `CanvasShell.tsx:439-441`), which means moving a node out of a box silently
   removes it from the group with no record that it was ever in one.
5. **Undo is per-feature and single-level.** There is no command stack, no snapshot ring, and no
   concept of a canvas transaction. Any operation that touches several objects — Tidy, a group drag
   carrying its members, Athena composing a zone — is unreversible except by the one bespoke undo
   Tidy owns.
6. **The camera cannot be restored.** Not a gap in `view-state-persistence` — a gap here: the camera
   is a `useState` inside a hook with no key, no serializer and no place to put one. Restoring it
   needs a *view identity* (which board, which scope) that no canvas in the tree currently has.

---

## 9. The missing gate

**The condition the signal is a proxy for, stated stack-free so an adopting repo can re-derive its
own:** *a canvas binds its zoom gesture through the framework's synthetic event system, and then asks
the browser to suppress the default scroll — which the framework's own registration has already made
impossible.* The general shape is **a call whose effect depends on how the listener was registered,
made at a site that cannot see the registration.** In this stack the registration is React's; in
another it will be a passive-by-default option, a delegated handler, or a framework's own wheel
abstraction. Re-derive the proxy; do not port the pattern.

Why this one and not the leaf's larger defects: §0's headline findings are all **absences and
relations** — a canvas with no consumer, an executor that does not select a column, an undo that is
not an inverse, two key spaces that disagree — and the doctrine is explicit that the census ratchets
what is *present* and cannot assert an absence or a relation between two values it never sees
together. This condition is present, countable, hand-verifiable, and it is one of the two mechanics
the leaf is named for.

```json
{
  "id": "unpreventable-wheel-zoom",
  "goldenPath": "docs/concepts/golden-paths/node-canvas.md",
  "title": "A zoom/scroll gesture is bound through React's synthetic onWheel and calls preventDefault — which React registers passively at the root, so the browser ignores it and scrolls the container instead",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": ":\\s*(?:React\\.WheelEvent(?:\\s*<[^<>]{0,80}>)?|ReactWheelEvent(?:\\s*<[^<>]{0,80}>)?|WheelEvent\\s*<[^<>]{0,80}>)\\s*\\)\\s*=>\\s*\\{[\\s\\S]{0,300}?\\.preventDefault\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A handler whose parameter is typed as REACT's WheelEvent (namespaced `React.WheelEvent`, aliased on import, or given a type argument -- the DOM's global `WheelEvent` is not generic, which is the discriminator) and which calls preventDefault inside its first 300 characters. React attaches `wheel` at the root container as a PASSIVE listener, so preventDefault in a synthetic wheel handler is a no-op and the browser scrolls the nearest scrollable ancestor instead of letting the surface zoom. PROXY FOR the stack-free condition: a gesture whose suppression of the default depends on a registration the call site cannot see. MEASURED 2026-08-17 @ 6c97502d3 over 4,829 files: 3 violations in 3 files, against 2 sites that bind the same gesture natively with `{ passive: false }` -- and those 2 are the repo's only two canvas cameras that live in a hook. The partition is complete: 4 React-synthetic wheel handlers exist in the tree, 3 call preventDefault (violating) and 1 does not (DriveImageLightbox.tsx:268, residue); 2 DOM-typed handlers exist and both are registered non-passively (compliant). The strongest single piece of evidence is TeamGraphPreview.tsx:175-177, a node-and-edge graph canvas whose handler comment reads `Without preventDefault the outer modal's overflow-y-auto eats the wheel and the user can't zoom -- they just scroll the modal body` immediately above a preventDefault that cannot run; useCanvasCamera.ts:82-87 in the same repo documents exactly why. This is a transfer failure, not ignorance: the answer exists here, in a comment, and did not cross a directory boundary. The leading `:` anchors on the parameter's type annotation so an untyped inline handler is deliberately out of scope -- stated recall limit, see the golden path.",
    "$measured": "2026-08-17 @ 6c97502d3 -- reproduced through scripts/census/run-census.mjs in a private scratch registry (files 3 / matches 3) and through a second, independently written scanner over the same 4,829 files (3 / 3). Site-level intersection against all 167 registry rules: ZERO collisions. Whole-registry runtime for the rule: ~1.8 s."
  },
  "baseline": { "files": 3, "matches": 3 },
  "floor": 4000
}
```

**Mechanism:** the census runner (`npm run census` reports, `npm run census:check` gates, and the
`golden-path-census` pre-push job runs it). No new script — this is a countable signal, which is what
the registry exists for.

**How it fails loudly if its own precondition is absent:** `floor: 4000` against the 4,829 files the
walk sees, so a broken root, a renamed `src/` or an extensions list that stops describing the repo
fails rather than reporting zero. A rule matching zero files anywhere fails structurally, a stale
`exclude` fails, a rise fails, and a **drop without `--update` fails** — which matters here, because
the fix (move the binding to `addEventListener(… { passive: false })`) *removes* the match, and a
silent drop is a broken matcher far more often than it is fixed code.

**Allowlist: none, deliberately.** There is no legitimate reason to call `preventDefault` in a React
synthetic wheel handler; the call either does nothing or the author has misunderstood the
registration. A handler that genuinely only wants to *observe* the wheel does not call it — which is
exactly the residue site, and it is correctly not matched.

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "unpreventable-wheel-zoom-positive-control",
  "goldenPath": "docs/concepts/golden-paths/node-canvas.md",
  "title": "CONTROL — the same gesture bound the one way the browser honours",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "addEventListener\\s*\\(\\s*['\"]wheel['\"][^;]{0,220}?passive\\s*:\\s*false",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The compliant binding for the SAME gesture: a native wheel listener registered non-passively, where preventDefault actually suppresses the scroll. 2 matches in 2 files (useCanvasCamera.ts:163, useGraphCanvas.ts:103), against the violating form's 3 in 3, and NO file contains both. The partition is what makes the finding legible: the two compliant sites are the two canvas cameras that were extracted into hooks, and both carry a comment explaining the passive-listener hazard; the three violating sites are all written inline at the surface. A control returning ~0 would mean this codebase has no idea how to do it right, and the finding would be ignorance rather than transfer."
  },
  "floor": 4000
}
```

Run in the private scratch registry alongside the rule: **2 files / 2 matches**. Complete partition of
every wheel handler in the tree:

```
React-synthetic wheel handlers (typed param)   : 4
  ...calling preventDefault  -> VIOLATING      : 3
  ...not calling it          -> residue        : 1   DriveImageLightbox.tsx:268
DOM-typed wheel handlers                       : 2
  ...registered { passive: false } -> COMPLIANT: 2
-------------------------------------------------
total wheel handlers                           : 6
```

### Gates I rejected, with numbers

- **"A relation appended to a collection with no membership check."** The condition is D2, this
  leaf's second-best clause. **1 match in 4,829 files**
  (`EventRenameModal.tsx:116`, `[...prev, { from: '', to: '' }]`) — and it is a *form row*, not a
  graph edge. The census cannot express "must be zero" and a one-site rule with a false positive is a
  ratchet on nothing. Rejected; D2 is recorded as a deviation and answered by §4-T2's brand instead.
- **"A 2D camera held in local component state."** 4 matches in 4 files, and **2 of the 4 are this
  leaf's own exemplars** (`useCanvasCamera.ts:65`, `useGraphCanvas.ts:56`) — the doctrine's named
  worst case, a gate firing on correct content. There is no way to phrase "a camera that is not the
  shared camera" while the shared camera does not exist. Rejected; D7 stands as a deviation and §3
  prescribes the extraction.
- **The same rule with the type argument optional.** Measured through the real runner: **5 files / 5
  matches**, and **2 of the 5 were `useCanvasCamera.ts:152` and `useGraphCanvas.ts:90`** — handlers
  typed `(e: WheelEvent)` where `WheelEvent` is the DOM global, passed straight to
  `addEventListener(… { passive: false })`. Precision 3/5 = 60%, and the two false positives are the
  two files the document holds up as correct. The fix is the discriminator now in the shipped
  pattern: **the DOM's `WheelEvent` takes no type argument and React's does**, so requiring either an
  explicit `React.`/alias qualification or a type argument separates them exactly. §12.5.

### What the census fundamentally cannot gate here

Five of this leaf's eight principles are outside the instrument, and saying so is part of the answer:

- **P1 (the drawing canvas is the executing canvas) is a reachability fact**, not a text pattern. What
  finds it is what found it here: **resolve the import graph and compute reachability from the
  entry points**, then list modules that no reachable module imports. That is ~60 lines of Node, it
  is the same instrument the doctrine's "inventory of what should exist" argument keeps arriving at
  (orphan bindings, unregistered queues, and now orphan canvases), and **this repo does not have
  it.** Specify it once, in `scripts/`, and it serves several leaves.
- **P3 (unread properties) is a cross-language relation** between an editable field set and a SQL
  projection. The instrument is a **test**: enumerate the columns the canvas can write, enumerate the
  columns the executor selects, and assert the first is a subset of the second — ~40 lines, one
  assertion, and it would have caught `label` and `parallel` on the day each shipped.
- **P4 (key spaces) is a runtime relation between two value sets.** No static pattern can tell
  `have.has(s.source)` returning 0 from a genuinely empty graph. The instrument is the **assertion in
  the code**, per §4 step 5 — which is also what makes it visible to the user, so it is worth more
  than a gate.
- **P5 (undo is an inverse) needs execution.** It is a property of two operations composed, and the
  harness in §0-E is the shape: apply, undo, and assert the *whole* state — including the sets other
  operations read — is equal. ~25 lines of Vitest per reversible operation.
- **P7 (confirmation or undo) is an absence**, and the doctrine is explicit that the census cannot
  assert one. §7 D8's inventory is the substitute and had to be built by reading.

**The one instrument worth building** is the orphan-module inventory. It is cheap, it is general, it
is the only thing that finds a canvas nobody renders, and its absence is why 28 files, ~2,300 lines
and a graph library survived three months of green `npm run check`.

---

## 12. Corrections to the brief

**12.1 — `sides: "client"` CONTRADICTED, and the correction is not "it was both".** This is the
eighth contradiction, and it belongs with the seventh rather than the first six: the leaf's **best
artifact, its four hardest facts and its most important deviation are all on the server.** The edge
door worth copying is Rust (`teams.rs:505-624`); the compiler that gives an edge meaning is Rust
(`team_handoff.rs`); the proof that four edge types are two is a Rust `if`; the proof that the canvas
renders zero edges is a Rust producer writing names where the client keys ids. The client half is
real and is where the census rule lives — a wheel binding is DOM, and the server never sees the DOM,
which is the same structural reason
[`long-list-rendering`](./long-list-rendering.md) and [`bulk-selection-actions`](./bulk-selection-actions.md)
gave for their upholdings. But a client-scoped brief would have found six cameras and missed every
finding in §0. **Report as: contradicted, eighth time; the correct label is `both`, and the spine
already carries `twoSided: true` on this node, so the contradiction is internal to the spine — the
same internal inconsistency the ledger has now recorded several times.**

**12.2 — the primed `CanvasShell.tsx:878` lead is CONFIRMED as a pattern match and REFUTED as a live
defect, and the reason strengthens the rule that found it.** The site is real:
`groups.find((g) => g.id === id)?.label ?? ''` is exactly
[`entity-picker`](./entity-picker.md)'s `missing-current-entity-rendered-as-unset` shape. But the
empty string never reaches a user: `MastermindPage.tsx:987` renders
`name={dispatchGroup.label || t.mastermind.group_untitled}` — *"Untitled group"* — and the dispatch
payload is `slugs`, passed **by value** at `:878` and never re-derived from the id, so a group deleted
mid-gesture cannot misdirect the job. **A coalesce is dangerous exactly when the coalesced value is
load-bearing; here it is decorative and the payload is captured.** That does not weaken the rule — it
sharpens what a match means. Suggested amendment to `entity-picker`'s §9 description: note that of its
three named consequence sites, this one is guarded downstream, so the rule's precision on
*shape* is not its precision on *harm*. The other two (`SlackBridgePickers.tsx:101`,
`PersonaSelector.tsx:86-91`) were not re-checked here.

**12.3 — "a canvas is where absolute indices go to die — find the population" is CONFIRMED, and the
population is not where the brief expected.** Two independent enumerations of every
move/drop/reorder/connect callback signature in 4,829 files found **63 declarations in 50 files**, of
which **exactly 1 is index-only**: `ReferenceBoard.tsx:231 onReorder: (toIndex: number)` — the site
[`drag-reorder`](./drag-reorder.md) already measured. **Every canvas move API in the tree carries
identity**: `onIslandCommit(slug, x, y)` (three declarations plus the hook), `onCommit(dir, itemId)`,
`onItemMove(itemId, targetStatus)`. The canvas layer has *already* withheld the index everywhere, and
the sole survivor is a board.
**The real population is one layer up, in the graph-authoring path**, and it is the only path that can
create an executable edge: `BlueprintConnection = { source_index, target_index, connection_type }`
crosses ts-rs with no identity in it, produced at `team_synthesis.rs:47-48,:640-644,:669-677` and
`llm_topology.rs:32-33,:202`, consumed at `useAutoTeam.ts:165-166`, and rebased by hand at
`:246-252`. Executed over the operator's 7 real topologies: **63 of 63 single removals are correct**,
and **189 of 504 two-removal sequences diverge if the second index is stale**. So the honest report is
*not* "another `ReferenceBoard`" — it is **"the arithmetic is right, and the type makes it necessary
to be right, seven sites at a time."**

**12.4 — a correction returned to [`drag-reorder`](./drag-reorder.md).** Its §7-F table lists five
pointer-drag implementations in `sub_mastermind/lib/` and scores `useCanvasCamera.ts` as having a 4 px
threshold, `onPointerCancel` and commit-on-release — treating it as a fifth instance of the same
shape. **It is a different animal and the difference matters for its own prescription.** The other
four commit an *object's* position and are candidates for the `usePointerDrag` extraction it
proposes; `useCanvasCamera` commits the *viewport*, has no object, and carries three concerns none of
the others has — a `camRef` that is deliberately out of sync with `cam` during a pan
(`:65-71`), a quantised zoom band, and a **native non-passive wheel listener** which is this leaf's
§9. Extracting all five through one hook parameterised only on "what it commits" would either drop
the wheel binding or push it into four call sites that do not need it. Suggested amendment: split
§7-F's table into *four object drags* (extract) and *one camera* (promote separately, as §3 here
prescribes).

**12.5 — a correction to my own instrument, and it hit the doctrine's named worst case.** The first
form of the census pattern made the type argument optional, so `(e: WheelEvent)` matched. Run through
the real runner it reported **5 files / 5 matches** — and **2 of the 5 were `useCanvasCamera.ts:152`
and `useGraphCanvas.ts:90`, the two files this document holds up as the correct answer.** `WheelEvent`
there is the DOM global, handed to `addEventListener(… { passive: false })`. Precision 3/5; a gate
firing on the exemplars. It was caught only because a second, independently written scanner produced
**3** where the runner produced **5**, and the disagreement was the finding rather than a nuisance —
had both implementations shared the optional-generic assumption they would have agreed at 5 and the
rule would have shipped pointing at its own §6. The discriminator now in the shipped pattern is
principled rather than a patch: **the DOM's `WheelEvent` is not generic and React's is**, so requiring
a `React.` qualification, an import alias, or a type argument separates the two type systems exactly.
Stated recall limit: an inline untyped handler (`onWheel={(e) => { e.preventDefault(); … }}`) is not
matched; there are **0** such sites today, and all 4 JSX `onWheel=` props in the tree pass a named,
typed handler.

**12.6 — the brief's "0 of 1,488 orchestration steps has more than one dependency" is CONFIRMED
independently, and the canvas half inverts what it implies.** Re-parsed from the column rather than
inherited: `{0: 383, 1: 1,105, >1: 0}` over 1,488 rows. The brief asked me to say, with numbers,
whether the canvas can express a DAG the engine has never executed. **It can, and it does, in the
operator's own database: 14 nodes across 7 teams have in-degree > 1.** But the sharper finding is that
the gap is not "canvas ahead of engine" — it is that **the wiring layer between them silently changes
the semantics**: `handoff_event_type` is per *target*, so N inbound edges produce N chain triggers and
**one** listener, and the target fires on whichever upstream finishes first. The picture says join;
the runtime says race; and the step layer downstream has never been handed a second dependency to
test either reading. That is three layers disagreeing about one arrow, and no surface anywhere
reports it.

**12.7 — the brief's "the repo has a chain/matrix editor and a Studio; measure what a saved graph can
express versus what the runtime reads" is answered, and the framing needed one correction.** There is
no chain/matrix *editor* on `master`. `PersonaMatrix` is history; the Trigger Studio
(`sub_studio/`) is a two-rail patchbay, not a canvas — it composes one `chain` trigger at a time and
has no plane, no camera and no node positions, so it is [`entity-picker`](./entity-picker.md)'s
territory (which measured it) and not this leaf's. The Build Studio is a wizard. **The two node
canvases are Mastermind and the orphaned `sub_canvas`**, and the expressiveness table is §0-D.

**12.8 — `convergence: mixed` UPHELD, read per clause — the second spine convergence label the corpus
has held — and the lineage direction the brief and the campaign both had backwards.** The ledger stood
at one upholding ([`ai-draft-preview-apply`](./ai-draft-preview-apply.md)) against thirteen failures.
This is the second, and like the first it holds only because the cohort was established *before* the
clauses were counted: physics on C2 (identity, 3 of 3), Personas ahead on C3 and C6, the fleet
converged on the *disease* on C4, C7 and C9, and C8 independently reinventing this leaf's headline
defect.

Two corrections ride with it, and both go upward rather than into this document:

- **The direction is inverted, again.** `vibeman` commit `2953479a` (2026-02-16 18:25) created
  `TeamCanvas.tsx` / `PersonaNode.tsx` / `ConnectionEdge.tsx` **in vibeman**, fifteen hours before
  this repository's first commit; the shared `#f59e0b` / `'6 3'` / `borderRadius: 12` constants are
  still in `teams/sub_canvas/libs/teamConstants.tsx:15`. **This repo's canvas is inherited, not
  invented**, which means its orphaned React Flow tree is a *hand-me-down* that outlived its own
  deletion in the ancestor by two months. `schema-driven-form` found the same inversion on a different
  file; two independent sightings should retire the assumption that Personas is upstream of vibeman.
- **The confound that bounds every convergence result this campaign has produced: all six
  repositories have one author.** Independence here has always been independence of *code*, never of
  *judgment*. A 3-of-3 agreement in this fleet is one developer's habit measured three times under
  three constraint sets. The doctrine already prefers cost and failure over agreement for other
  reasons; this is a third reason, and it is structural rather than incidental. **Recommend adding it
  to §5 of the doctrine as a standing caveat on every cohort count the corpus has published.**

**12.10 — the primed commit SHA was stale, exactly as [`long-list-rendering`](./long-list-rendering.md)
§12.11 warned.** The brief's context carried `2a874e692`, and this document was headed with it through
the whole draft. `git cat-file -e 2a874e692:scripts/census/rules.json` returns *"exists on disk, but
not in `2a874e692`"* — **the census registry postdates the SHA that four sibling documents claim to
have been composed against**, and it is now five. Corrected to `6c97502d3`, which is `master` at the
moment of composition, in the header and in the rule's `$measured`. The failure is inherited, not
committed here, and the fix is one line in each brief: *read HEAD, do not carry the session-start
status forward.*

**12.11 — two sibling defects, reported and not edited, per the runbook.** `vibeman`'s
`ArchitecturePlayground` is a finished graph editor whose "Generate Plan" button invokes a prop its
only mount site never passes (`OverviewLayout.tsx:111-115`), and whose `Graph.ts:135-165` counts its
own dropped edges into a `droppedEdgeCount` getter that no UI reads. `brainiac`'s `CortexMap.tsx:153`
renders `"50 hubs · 7 teams (mock)"` over hardcoded synthetic data (`cortex-data.ts:90-100`,
`memory_id: "m-demo"`) with an undisclosed `.slice(0, 4)` neighbour cap at `:188`. Findings about
sibling repos are reported, never edited.

---

*Re-extraction check, per the doctrine: the two fenced JSON blocks above were extracted from this
finished file and re-run through `scripts/census/run-census.mjs --rules <private scratch registry>`
after the document was written. The rule reproduced `files 3 / matches 3` against its declared
baseline and the control reproduced `files 2 / matches 2`, identical to the pre-publication run; the
document is LF, and the extractor found both fences. The private registry and the database copy were
deleted afterwards. The full registry was NOT run — that is the orchestrator's step.*

**12.9 — a silence worth reporting upward, because two neighbouring leaves could not have seen it.**
[`view-state-persistence`](./view-state-persistence.md) measured 6 homes for view state and 520 scroll
containers, and its instrument never encountered a viewport, because a camera is not a scroll offset
and lives in no store. [`long-list-rendering`](./long-list-rendering.md) measured how many rows may
render and never encountered culling by geometry. **Between them they cover every list surface in the
app and neither can see a canvas at all** — which is a small demonstration that the spine's
`canvas-and-media` group is genuinely a separate territory rather than a re-cut of `lists-and-tables`,
and that its second leaf (`canvas-state-persistence`, risk **high**, still unwritten) owns real
ground nobody else is covering.
