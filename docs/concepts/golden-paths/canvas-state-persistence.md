# Golden path — Canvas state persistence

> Situation node: `product-surfaces` › `canvas-and-media` › `canvas-state-persistence` ·
> [situation spine](../situation-spine.md) · recurrence 5 · risk **high** ·
> sides: **client** — **contradicted** (§12.1: the persisted document has a *Rust
> reader* that is the second half of the contract, and the sharpest defect in this
> leaf lives entirely on that side) ·
> convergence: **converged** — **FAILED**, in the "splits by clause" mode
> (§6: 5-of-5 silence on the practice, and the one sibling that solved the
> reconcile clause solved it *better than this repo does*) ·
> dimensions: **function · resilience · performance · security**
> Leaf definition: *"Spatial layout and frontend-derived state surviving restart and two writers."*
> `mergedFrom`: *Layout document persistence* + *Derived-state publication*
> Composed 2026-08-17 against `master` @ `52b0a6ba8`.
>
> **Sweep.** All **4,801** `.ts`/`.tsx` under `src/` (**4,390** excluding tests) and all
> **963** `.rs` under `src-tauri/`. The whole Mastermind surface read — **98 files /
> 12,587 lines** under `src/features/teams/sub_mastermind/` — plus its Rust reader
> (`src-tauri/src/companion/canvas.rs`, 773 lines) and its prompt consumer
> (`companion/prompt.rs:1044-1126`). Every durable-write door in the frontend
> enumerated and classified. Every candidate signal partitioned violating-vs-compliant
> and hand-verified. Site-level intersection of the final pattern against **all 178**
> registry rules.
>
> **Measured by EXECUTING, not by reading.** Both `mastermind.layout.v1` and
> `mastermind.scene.v1` were read out of the operator's own database and joined
> against `dev_projects` **twice, by two implementations that share no code** — one
> structural (`JSON.parse` the document, walk its keys), one that never parses the
> document at all (pull every UUID-shaped token out of the raw `TEXT` and difference
> it against the id list). `freshness_note` / `published_age_hours`
> (`canvas.rs:327-345`), `resolve_scene_slug` (`:641-666`), `resolve_canvas_target`
> (`:584-629`) and `LinkLayer`'s endpoint resolution (`LinkLayer.tsx:23-26`) were
> transcribed statement-for-statement into Node and replayed against those rows.
>
> **⚠ The database is the 2026-08-17 PURGE BACKUP, not the live file.** On 2026-08-17
> the operator authorized a purge of **20,342 rows across 25 tables**. Measurements
> here come from
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`
> (347,054,080 B) and its `personas_data.db` sibling, copied read-only to a scratchpad.
> **Every finding below was ALSO re-run against the live file and is byte-identical
> there**, because `app_settings` and `dev_projects` were not in the cascade — this
> leaf's evidence survived the purge. Where a count differs between the two
> (`personas`: 78 → 1) it is labelled. Copies deleted after use; nothing was written.
>
> **`cargo` was not run.** Every Rust claim is a read plus a replay of the logic in Node.

---

## §0 — Headline

**The canvas persists eight island positions. Two of the eight are for projects that
do not exist.** Not because of the purge — `dev_projects` was never in it — but
because nothing in this repo has ever deleted a layout entry, and the surface's entire
response to a reference it cannot resolve is `return null`.

Executed against the operator's own `mastermind.layout.v1`, two independent
implementations agreeing exactly:

```
dev_projects rows                              : 14
layout positions                               :  8  ->  2 DANGLING (25%)
published scene projects (mastermind.scene.v1) : 14  ->  2 DANGLING (14.3%)
dangling ids                                   : 3ca0b3b9-…  c5cd79d2-…
their names, still carried in the snapshot     : "ai-bookkeeper", "ai-paralegal"
```

The second row is the one that matters, and it is not a rendering problem. The
published scene is a **derived-state publication**: the canvas is the only thing that
can compute it, so it writes what it derived into an app setting and a Rust reader
turns it into Athena's system prompt every turn (`prompt.rs:1046`). That reader has
two ways to resolve a project slug, and they disagree:

```
slug 3ca0b3b9-… (ai-bookkeeper):  resolve_scene_slug  ACCEPTS
                                  resolve_canvas_target REFUSES ("no registered project")
slug c5cd79d2-… (ai-paralegal):   resolve_scene_slug  ACCEPTS
                                  resolve_canvas_target REFUSES ("no registered project")
```

`resolve_scene_slug` validates against the **snapshot**, deliberately —
`canvas.rs:636-637` says so: *"Validating against the same snapshot she read keeps the
vocabulary closed."* That reasoning is correct about hallucination and wrong about
staleness, because the snapshot is not a vocabulary, it is a **cache**, and this one
was last written **2026-08-07T08:29:23.228Z**. Replaying `freshness_note` verbatim at
composition time:

```
freshness_note(scene) = "published 248 hours ago"
```

Ten days. It is *disclosed* — the footer says so, honestly, in every prompt — and it is
**never refused**. Nothing anywhere in `canvas.rs` compares that number to a threshold;
`published_age_hours` is read by exactly one caller, `freshness_note`, which
`format!`s it into prose. So the model is handed a portfolio of 14 projects, told
truthfully that it is ten days old, and given a `compose_canvas_panel` door that
accepts two slugs whose rows are gone — while the door next to it, for the same
slugs, refuses.

**The two-writers half of this leaf is, by contrast, the best answer in the repo, and
it is not close.** `layoutStore.ts` keeps **one** mutable copy, hands views a
`useSyncExternalStore` subscription instead of a snapshot (`useLayout.ts`), and makes
the out-of-band writer await hydration before it writes
(`useCanvasPanelBridge.ts:40-42`: *"The store must be hydrated before a write, or the
panel would be saved onto an empty doc and clobber the user's layout on flush"*). The
convergence sweep found **no sibling that persists a spatial layout at all** — 5 of 5
silent — so there is nothing in the fleet to compare it to. This document's §2 is
mostly a description of what `sub_mastermind/lib/` already does; its §7 is what that
directory's discipline did not reach.

The one clause where the fleet is **ahead of us** is the one this leaf is named for.
`ascent/src/components/launch/mergeStars.ts:17` — `if (!f) continue; // gone upstream —
remove the dead star instead of letting the list only ever grow` — plus a
transient-blip guard four lines above it (`:12`, `if (fresh.length === 0) return prev`).
Ascent applies that to an in-memory fetch merge. Personas applies nothing to a document
on disk.

---

## §1 — Trigger

You are in this situation when you would say, or type, any of:

1. *"Save where the user dragged these nodes so the board looks the same tomorrow."*
2. *"The canvas needs to remember which items are hidden / collapsed / grouped."*
3. *"Athena should be able to see what the canvas is showing"* — or any variant of
   *publish what the frontend derived so something else can read it*.
4. *"Two things write this layout — the user and an agent — how do I stop them
   clobbering each other?"*
5. *"Should the zoom level come back when they reopen the page?"*
6. **The if-you-are-about-to-write-X test:** if you are about to write
   `useState(() => JSON.parse(localStorage.getItem(KEY)))`, or
   `setAppSetting(KEY, JSON.stringify(myDoc))`, or a `Record<entityId, …>` that will
   outlive the process — you are here.

You are **not** here if the value is derived from data you re-fetch anyway (a fit-to-
bounds camera, a computed force layout). That is not persistence, that is a pure
function, and the fleet is unanimous that it should stay one — see §6.

---

## §2 — The one way

**Give the durable document exactly one in-memory copy, let every view *subscribe* to
that copy rather than snapshot it, make every writer await hydration before it writes,
and — the part this repo has not done — reconcile every entity id in the document
against the table that owns it, on the read, every time.**

Concretely, in the order you will need them:

**(a) Decide what is durable *before* you decide where it lives.** Spatial arrangement
the user authored is durable. Camera, selection and focus are not — they are derived
from the content and should be re-fitted on open. This repo gets that split right and
so does every sibling (§6); do not persist a viewport.

**(b) One key, one versioned document, not five keys.** `layoutStore.ts:1-6` records
the migration from five machine-local `localStorage` keys to one versioned JSON
document in `app_settings`, and that is the right shape: a single write is atomic
against itself, a single read cannot half-hydrate, and the `version` **field** moves
while the key stays stable (`:37-43`). Register the key in the Rust allow-list
(`src-tauri/db/src/settings_keys.rs:236`) — the app refuses unregistered keys, which is
what stops a durable document being invented in a component.

**(c) Parse defensively, and let every version parse.** `parseLayout`
(`:205-224`) never throws, coerces each field to its expected shape, and treats a
malformed document as empty. Unknown envelope versions are **dropped, not retained**
(`SUPPORTED_PANEL_SPEC_VERSIONS`, `:44-48`, `parsePanels`, `:184-200`) — tolerate-and-drop,
never a poison value a renderer has to defend against. Attribution migrations may only
*add* provenance, never take an object away from its owner (`coerceAuthor`, `:164-169`).

**(d) The store is the one mutable copy; views subscribe.** Export a
`subscribe` + a memoised snapshot getter per field and bind them with
`useSyncExternalStore` (`useLayout.ts`). **Never `useState(loadX())`.** A snapshot taken
at mount can only be right until someone else writes, and this surface has a second
writer by design. This is §9's gate.

**(e) Writes are read-modify-write against the store, never against a render closure.**
`MastermindPage.tsx:617-618` is the whole pattern in two lines:

```ts
const onIslandCommit = (slug: string, x: number, y: number) =>
  savePositions({ ...loadPositions(), [slug]: { x, y } });
```

**(f) The second writer awaits hydration.** An out-of-band write that lands before the
document has loaded will serialize an empty document over the user's board on the next
flush. `useCanvasPanelBridge.ts:41-42` awaits `hydrateLayout()` first, and says why.

**(g) Debounce the write-through, and separate "paint" from "persist".**
`saveGroups(g, persist = false)` (`:348-354`) updates memory and subscribers so the
canvas follows the pointer, and schedules no DB write until release. One drop, one
write; a burst coalesces (`WRITE_DEBOUNCE_MS = 500`).

**(h) RECONCILE ON READ. This is the clause the repo is missing.** Every id in the
document is a reference to a row that can be deleted while the app is closed, by a
different surface, or by a cascade. So on hydrate — once you have the live entity list
— **drop entries whose entity is gone, and write the pruned document back**. Copy
`ascent/src/components/launch/mergeStars.ts:11-18` exactly, including its guard: an
*empty* authoritative list means the fetch failed, not that everything was deleted, so
no-op rather than prune. Without (h), (a)–(g) build a perfectly-coherent document that
slowly fills with references to nothing.

**(i) If you publish derived state for another consumer, publish a *contract*, not a
blob — and give the reader a refusal, not just a disclosure.** Stamp the publish time
at **write** time so it cannot defeat the content dedupe (`scenePublish.ts:146-149`),
carry the per-family load *status* (the one thing the reader could never re-derive),
refuse to publish a demo/placeholder scene at all, and then **on the reading side pick
a staleness horizon past which the snapshot is not answered from.** Disclosure is the
right thing to do *in addition*; it is not a substitute, because a consumer that can
read "248 hours ago" and still act on the row will.

---

## §3 — Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `teams/sub_mastermind/lib/layoutStore.ts` | The reference durable-document store: one versioned doc, hydrate-once, sync getters, subscriber notification, debounced write-through, IPC→localStorage degradation, a test-only reset (`__resetLayoutStoreForTests`). |
| `teams/sub_mastermind/lib/useLayout.ts` | The six `useSyncExternalStore` bindings. **This is what you import in a component — never `loadPositions()` into `useState`.** |
| `api/system/settings` → `getAppSetting` / `setAppSetting` | The durable door. Key must be registered in `src-tauri/db/src/settings_keys.rs`. |
| `src-tauri/db/src/settings_keys.rs` | The allow-list. `MASTERMIND_LAYOUT` (`:236`), `MASTERMIND_SCENE` (`:250`), each with a registration test (`:1282`, `:1296`). |
| `teams/sub_mastermind/lib/scenePublish.ts` | The reference derived-state publisher: pure payload builder, debounce, content dedupe with the timestamp deliberately outside the compared body, refusal to publish the demo scene, best-effort failure that clears the memo so the next derive retries. |
| `src-tauri/src/companion/canvas.rs` | The reader half of that contract, and the place §7.1 and §7.2 must be fixed. |
| `teams/sub_mastermind/lib/focusStore.ts` | The pattern for state that is deliberately **not** durable: an external store for a *request* (focus a project), with a monotonic `seq` so re-focusing the same target still reads as new. |
| `lib/silentCatch` → `silentCatch()` | Every storage failure path. A full or blocked storage must never break a canvas. |

**Explicitly NOT a primitive here:** `zustand/persist` + `partialize`. It is the right
answer for *view tokens* (see [`view-state-persistence`](./view-state-persistence.md))
and the wrong one for a spatial document with a second, non-React writer — the layout
store's whole reason for existing is that Athena writes it from a Tauri event listener
mounted app-wide, outside any React tree that a store hook would live in.

---

## §4 — Steps

1. **Name the lifetime out loud.** Session, surface, or restart? Only "restart" comes
   here. Camera and selection are not restart-scoped — stop.
2. **Declare the key in `settings_keys.rs`** and add its registration test. The
   allow-list is what stops durable documents being invented ad hoc.
3. **Write the document interface with an explicit `version: number` field** and a
   `SUPPORTED_*_VERSIONS` set for any nested envelope you do not own.
4. **Write `parseX(raw: string | null)` that cannot throw** and returns `null` for
   "absent or unusable", so hydration can distinguish it from "present and empty".
5. **Ask whether the primitive's signature can make the wrong call impossible** —
   before you reach for §9. Here it partly can: `positionsSnapshot()` returning a
   *stable container* is what makes `useSyncExternalStore` correct, and not exporting
   a mutable reference is what stops a caller corrupting the doc. It cannot reach the
   dangling-id case; see §8.1 for why, with the doctrine's two boundaries named.
6. **Hydrate once, at the page gate**, and hold the canvas back until it lands
   (`MastermindPage.tsx:283-294`, `:840`) so sync initializers read the hydrated doc.
7. **Reconcile.** With the live entity list in hand, prune dead ids and write back —
   guarded by "an empty list means the fetch failed". *(Not implemented; §7.3.)*
8. **Bind every view through `useSyncExternalStore`.** And then stop — the store owns
   invalidation, notification and the flush.
9. **If something else must read what you derived**, publish it with §2(i)'s five
   properties and give the reader a horizon.

---

## §5 — Anti-patterns

- **`useState(loadPositions())` / `useState(() => JSON.parse(localStorage.getItem(K)))`.**
  *Failure mode:* the component now owns a private copy of a shared value. A write from
  anywhere else — the agent, a sibling component, a different tab of the same
  document — updates the store and the copy does not move. Nothing crashes; the two
  just disagree, and the next commit from the stale copy serializes the stale value
  back over the fresh one. **16 sites, 12 files — §9.**
- **A `storage` event listener as the re-sync arm.** *Failure mode:* the HTML
  `storage` event does not fire in the document that wrote the value. In a
  single-WebView desktop app there is no other document, so the listener can never
  fire. `DesktopFooter.tsx:330-336` has exactly this, with the comment *"(e.g. from
  another tab)"* — and its actual co-writer, `Sidebar.tsx:30`, is in the same document.
  The repair looks like the fix and is inert.
- **Persisting the camera.** *Failure mode:* the user reopens onto empty sea. Positions
  in the operator's real document run from `x = -4,603` to `x = +2,746`; a restored
  `{x: 0, y: 0, z: 0.5}` shows none of them. Fit to content instead
  (`CanvasShell.tsx:183-188`). 5 of 5 siblings agree (§6).
- **Blind whole-document overwrite from a never-refreshed copy.** *Failure mode:*
  every field you did not touch is rewritten from a snapshot taken at hydration. Safe
  here *only* because the store is the single copy in the renderer; it stops being safe
  the moment a second process writes the same key.
- **Treating a published snapshot as a vocabulary.** *Failure mode:* §0. Validating a
  slug against a cache constrains hallucination and licenses staleness. Validate
  *identity* against the snapshot if you must, but resolve *action targets* against the
  owning table — `resolve_canvas_target` is right and `resolve_scene_slug` is one
  freshness check short.
- **Disclosing an age instead of enforcing one.** *Failure mode:* the footer is honest
  and the row is acted on anyway. `freshness_note` is good work; it needs a sibling
  that returns `None` past a horizon.
- **Rendering `null` for an unresolvable reference and calling it handled.**
  `LinkLayer.tsx:26` — `if (!a || !b) return null;`. *Failure mode:* the object is
  invisible, therefore uneditable (its label pill, the only affordance that could
  delete it, is inside the same `return null`), therefore immortal. Replayed: a link
  with one dead endpoint renders 0 of 1 and stays in the document forever.
- **`<LoadingSpinner>` as the cold-load state of the whole surface.**
  `MastermindPage.tsx:860` is the entire non-ready branch of the canvas, and
  `LoadingSpinner` renders `null` (or an `sr-only` span with a `label`, which is this
  call site). The canvas region is **visually blank** for the hydrate + first-passport
  window. Two i18n keys exist to name a state nobody can see. See
  [`page-loading`](./page-loading.md) — a fetch must never leave the chrome unrendered.

---

## §6 — Evidence, and the convergence oracle

### The site to copy

**`src/features/teams/sub_mastermind/lib/layoutStore.ts` + `useLayout.ts` +
`useCanvasPanelBridge.ts`.** Read all three; they are one answer split across three
files, and the third is the one people forget. `useLayout.ts:1-7` states the doctrine
in its own words:

> *"These replace the one-shot `useState(loadGroups)` initializers the canvas used to
> open with: a snapshot taken at mount can only ever be right until someone else
> writes… With `useSyncExternalStore` there is exactly ONE copy of the layout."*

### Convergence — the label is `converged`, and it fails

Cohort established at composition time, per leaf. All five checkouts exist. **Effective
independent cohort for this leaf: 4** — `personas-cloud` has no UI at all (5 commits,
last 2026-03-23; `packages/` + a Python facade, zero `.tsx` files), so it cannot hold an
opinion about persisting a layout.

| repo | spatial surface | pan/zoom | user-arranged | **positions persisted** | viewport persisted | reconcile on miss |
| --- | --- | --- | --- | --- | --- | --- |
| **personas** | Mastermind canvas | ✅ hand-rolled camera | ✅ drag | ✅ `mastermind.layout.v1` | ❌ (fit on open) | ❌ **no prune** |
| vibeman | `ZoomableCanvas`, `GoalConstellation`, `SystemMap` | ✅ d3.zoom | ✅ drag (fix released on end) | ❌ **none** | ❌ `zoomIdentity` | n/a |
| personas-web | `KnowledgeClusterGraph` | ❌ | ❌ computed | ❌ **none** | ❌ | drop-on-miss ×2 |
| brainiac | Cortex Map / Star Chart | ❌ fixed `viewBox` | ❌ hash-derived | ❌ **none** (only the lens id) | ❌ | validate-or-default |
| ascent | Fleet Map constellation | ❌ fixed 120×120 | ❌ phyllotaxis | ❌ **none** | ❌ | ✅ **best in family** |

**The label fails in the mode the doctrine calls "splits by clause", and it splits
three ways:**

1. **On persisting a layout at all: a 5-of-5 SILENCE.** No sibling persists a spatial
   arrangement. Per the doctrine, silence stays a strong signal and it is *not* a
   verdict — it means nobody else has needed it, which is exactly true: Personas is the
   only one of the six with a board a user arranges by hand. So this half of the path
   is a **house convention**, not physics, and is labelled as such.
2. **On persisting the viewport: 5 of 5 agree with us by NOT doing it.** vibeman resets
   to `d3.zoomIdentity` (`ZoomableCanvas.tsx:183-188`); everyone else has no viewport.
   This is the one clause with fleet support, and it is support for an *omission*, so
   per the doctrine (*"always ask what the siblings agreed to do"*) it is read as: a
   camera is cheap to re-derive and nobody has ever missed it.
3. **On reconciling a reference to a deleted entity: Personas is BEHIND, and the
   evidence is a sibling that wrote the reasoning down.**
   `ascent/src/components/launch/mergeStars.ts:3-18` drops entities that vanished
   upstream *and* no-ops on an empty authoritative list because *"nuking the whole
   constellation on a transient blip is far worse than briefly keeping stale stars"*.
   That is a *cost* finding, the strongest class the oracle produces, and it is
   pointed at us. Two more siblings guard the same read (`KnowledgeClusterSvg.tsx:36,59`;
   `StarChartView.tsx:120`), though for a derived map where the miss cannot survive.

**Lineage, checked before counting anything as corroboration.** Not one cited file is
a port. Zero hits for every port marker (`hydrateLayout`, `savePositions`,
`mastermind.layout.v1`, `WRITE_DEBOUNCE_MS`) across all five. Mechanisms differ
absolutely: vibeman is `d3.zoom`/`zoomIdentity` and this repo has **zero** `d3.zoom`
occurrences. **And the direction runs the other way on dates:** vibeman's
`ZoomableCanvas.tsx` is a single commit dated 2026-02-01, **5.5 months before**
`CanvasShell.tsx` (2026-07-22) and `layoutStore.ts` (2026-07-23) — it cannot be a port
of something that did not exist. ascent's `fleetMapStars.ts` (2026-06-09) predates this
repo's phyllotaxis (`graphLayout.ts`, 2026-06-18) by nine days and its FNV-1a jitter
(`GraphChrome.tsx`, 2026-08-09) by two months, with different normalizations and
different comments in all three — one author retyping a known idiom, not a copy.

`brainiac`, `ascent` and `vibeman` are all **consumers** of this repo's tooling
(`context-map.json`, `.claude/skills/`), which does not disqualify them here: none of
them reads this repo's *layout* decision.

### Two incidental fleet findings, reported because they cost nothing to state

`vibeman` declares `@xyflow/react ^12.10.1` and `personas-web` declares
`react-virtuoso ^4.18.6`; **both have zero imports** in their `src/`. Install weight and
audit surface for nothing. *(Sibling repos: report, never edit.)*

---

## §7 — Deviations

**7.1 — `src-tauri/src/companion/canvas.rs:641-666` — `resolve_scene_slug` accepts
slugs whose rows are gone.** Executed: both dangling ids are ACCEPTED by
`resolve_scene_slug` and REFUSED by `resolve_canvas_target` (`:584-629`) in the same
module, on the same data, in the same process. The docstring's reason for the split
(*"composing a panel touches no repository and starts nothing"*) is sound for
hallucination and silent about staleness. **Fix:** keep the snapshot as the vocabulary,
add a `dev_projects` existence probe before returning `Ok(p.slug)`, and refuse with the
same "name real alternatives" shape the miss branch already uses. *(Behaviour-changing —
deferred, §11.)*

**7.2 — `canvas.rs:327-345` + `:349-366` — the freshness note has no horizon.**
`published_age_hours` has exactly one caller and it `format!`s the number. Replayed at
composition time: **`"published 248 hours ago"`**, and the scene is nonetheless the
basis of `format_scene_digest` (`prompt.rs:1046`), `describe_canvas_project`
(`canvas.rs:400`), `describe_canvas_freshness` (`:480`) and `resolve_scene_slug`. **Fix:**
a `SCENE_STALE_AFTER_HOURS` constant, and `load_scene` returning `None` past it so every
surface falls through to the honest `no_scene_line()` it already has. *(Deferred, §11.)*

**7.3 — `layoutStore.ts` — no prune path exists anywhere.** Enumerated: `savePositions`
replaces the whole map and has no per-key delete; `saveHidden` can only remove a slug
the user can still *see* in the sidebar, so a hidden project that is later deleted can
never be un-hidden; `removeAthenaPanel` (`:394-401`) is the only removal door in the
module and it is keyed by a slug someone must still know. Measured cost today: **2 of 8
positions (25%)**. Unbounded — nothing ever shrinks. **Fix:** §2(h). *(Deferred, §11.)*

**7.4 — `LinkLayer.tsx:26` — an unresolvable link renders `null` and stays forever.**
Replayed: 1 persisted link with one dead endpoint → 0 rendered, 1 retained. Because the
midpoint label pill (`:47-62`) is the only way to open the editor and it is inside the
same early return, the object is unreachable through the UI. Groups (`GroupLayer`) and
notes (`NoteLayer`) are not affected — they carry no entity reference. **Fix:** the
prune in §2(h) removes the cause; until then, render an unresolvable link as a stub with
its editor reachable.

**7.5 — `MastermindPage.tsx:860` — the canvas cold-load renders nothing.**
`<LoadingSpinner label={…} />` is the entire `else` branch of `:840`, and
`LoadingSpinner.tsx:12-19` returns an `sr-only` `<span role="status">` for a labelled
call and `null` otherwise. Sighted users get a blank bordered rectangle for the whole
hydrate + first-passport window. **Fix:** a geometry-matched ghost under the permanent
chrome, per [`page-loading`](./page-loading.md). *(Applies to the same population
[`inline-busy-state`](./inline-busy-state.md) §9 already partitions — see §12.4.)*

**7.6 — 16 mount-time snapshots of durable state, 12 files.** The condition §2(d)
forbids, enumerated and hand-read; full list and the gate in §9. The Mastermind
directory is *clean* — it holds **9 of the 25** compliant `useSyncExternalStore`
sites and none of the 16 violating ones.

**7.7 — `positions` is the only durable id-keyed collection in the document with an
add path and no remove path, and it is also the only one nothing validates.** `hidden`
is a `string[]` with the same latent growth; `athenaPanels` at least has
`removeAthenaPanel`. None of the three is ever checked against `dev_projects`.

**7.8 — `TeamCanvas.tsx:9-16` carries a stale comment describing deleted files.** It
says the old edge-wiring canvas *"(sub_canvas/, canvas/, AutoTeam) … files are now
orphaned and slated for removal in a follow-up cleanup"*. That cleanup landed on
2026-08-17 (`78e9bff68`, 29 files / 3,281 deletions). Comment-only; safe to apply.

---

## §8 — Gaps

**8.1 — No type reaches the dangling reference, and the doctrine already names both
reasons.** The id is a `string` key inside a JSON blob in a `TEXT` column, so it is
past the **serialization boundary** (doctrine §1, *"no type reaches inside a serialized
blob… the storage shape is upstream of every type you could add above it"*). And its
writer and its reader are different *runs* of the program with a project deletion in
between, so it is also past the **temporal boundary** (doctrine §1 item 6, as
[`view-state-persistence`](./view-state-persistence.md) reached it: *"the type the
writer used may no longer exist when the reader runs"*). A branded `ProjectId` newtype
would be satisfied by every one of the 8 keys in the real document, including the 2
dangling ones, because they are all well-formed UUIDs of deleted rows. **This is the
case where a gate genuinely earns its place** — and §9 explains why the gate that would
earn it here is *not* a census rule.

**8.2 — The census cannot express this leaf's largest finding, because it is an
absence.** "No code anywhere reconciles a persisted id against its table" and "no
reader refuses a stale snapshot" are both statements about what does *not* exist. The
census ratchets a count of something present. This is the same shape that produced
`scripts/check-csp-hosts.mjs`; §9 specifies the analogous instrument.

**8.3 — `mastermind.scene.v1` has exactly one writer and it only runs while one page is
mounted.** `MastermindPage.tsx:654-660` publishes on a settle timer; nothing else ever
writes the key. So the snapshot's freshness is a function of *whether the operator
visited Teams → Mastermind*, which is not a property any consumer can influence. A
horizon (7.2) makes that honest; it does not make it fresh. A backend re-derive is
explicitly declined and the declination is well argued (`canvas.rs:3-25`) — that
reasoning stands, and it is precisely *why* the horizon is required rather than
optional.

**8.4 — The store degrades to `localStorage` on IPC failure and never returns.**
`ipcAvailable` (`layoutStore.ts:102`) is a one-way latch: one failed `setAppSetting`
routes every subsequent write to `localStorage` for the rest of the session, with no
retry and no user-visible signal. Correct as a *never-crash* choice; it means a
transient IPC failure silently downgrades durability for the session.

**8.5 — Nothing flushes the debounced write on teardown.** A drag committed within
500 ms of the window closing is lost. Already ratcheted by
[`debounced-autosave`](./debounced-autosave.md)'s `unflushable-debounced-write`, whose
`\bwrite\w*Now\s*\(` arm matches both `writeThroughNow(` (`layoutStore.ts:271`) and
`writeNow(` (`scenePublish.ts:176`) — verified, not assumed. No new gate needed.

---

## §9 — The missing gate

### What is gated: the mount snapshot

**Signal.** A `useState` whose initializer *is* a durable read — a lazy arrow reaching
`localStorage.getItem` / `sessionStorage.getItem` / `getAppSetting(` / a `load*()`
persistence helper, **or** the bare-reference form `useState(loadX)`.

**The condition it is a proxy for, stated stack-free so an adopting repo can re-derive
its own proxy:** *durable state is copied into a component-local variable at mount, so
the component owns a private copy that no later write to the durable store can reach.*

**Measured 2026-08-17 @ `52b0a6ba8`: 16 matches across 12 of 4,801 `.ts`/`.tsx` files.
ALL SIXTEEN OPENED AND HAND-READ — precision 16/16.**

```
src/features/agents/quick-answer/triage/deck/useDeckControls.tsx:129
src/features/agents/quick-answer/triage/useUnifiedTriage.ts:408
src/features/overview/sub_incidents/components/IncidentsInbox.tsx:86,91,100,107,115
src/features/plugins/drive/components/DriveSidebar.tsx:54
src/features/plugins/gitlab/components/PipelineNotificationPrefs.tsx:46
src/features/plugins/twin/variants/TwinVariantTabs.tsx:35
src/features/shared/chrome/DesktopFooter.tsx:325
src/features/shared/chrome/sidebar/Sidebar.tsx:23
src/features/shared/components/display/ColumnResize.tsx:41
src/features/teams/sub_goals/GoalViewExplainer.tsx:15
src/features/teams/sub_teamMemory/components/panel/TeamMemoryPanel.tsx:50
src/features/triggers/sub_studio/useStudioComposer.ts:35
```

**The most instructive match is `DesktopFooter.tsx:325`, and it is the reason the rule
does not simply exempt anything with a listener.** It *has* a re-sync arm —
`window.addEventListener('storage', handler)` at `:334`, commented *"Stay in sync when
Sidebar itself changes localStorage (e.g. from another tab)"*. The `storage` event does
not fire in the document that wrote the value, and its actual co-writer
(`Sidebar.tsx:30`) is in the **same** document of a single-WebView desktop app. The
guard is inert by construction, and it is the shape a fix would take, so a rule that
credited it would report green on the site it most needs to see.

**Positive control — and it partitions.** Same anchors, pointed at the compliant
expression: `useSyncExternalStore(` → **25 matches / 16 files**. `id` ends
`-positive-control`, **no `baseline`** (the merger skips controls). The partition is
legible: the leaf's own directory holds **9 of the 25** compliant sites
(`useLayout.ts` ×7, `focusStore.ts:70`, `canvasActionStore.ts:205`) and **0 of the 16**
violating ones — the exemplar is where the doctrine says it is.

**Site-level overlap against the FINAL pattern, against all 178 registry rules:
ZERO shared sites.** Computed with each rule's own pattern and comment-stripping over
the 12 matched files. File-level overlap is real and expected — `raw-web-storage` shares
**8 of 12 files** — and that is precisely the doctrine's *"file overlap understates"*
caveat running in the useful direction: `raw-web-storage` anchors on the
`localStorage` identifier and counts a *storage access*; this anchors on the `useState`
and counts a *snapshot*. Same lines, different offsets, different defect. Highest other
file-overlaps: `native-title-tooltip` 5/12, `typo-token-overpainted` 3/12.

```json
{
  "id": "mount-snapshot-of-durable-state",
  "goldenPath": "docs/concepts/golden-paths/canvas-state-persistence.md",
  "title": "Durable state copied into component state by a mount-time initializer",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "useState\\s*(?:<[^;()]{0,140}>)?\\s*\\(\\s*(?:\\bload[A-Z][\\w$]*\\s*\\)|\\(\\s*\\)\\s*=>\\s*(?:(?!\\buseState\\b|=>)[\\s\\S]){0,200}?(?:(?:window\\s*\\.\\s*)?(?:local|session)Storage\\s*\\.\\s*getItem|\\bgetAppSetting\\s*\\(|\\bload[A-Z][\\w$]*\\s*\\())",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A useState whose INITIALIZER is a durable read — either the bare-reference form `useState(loadX)` or a lazy arrow `() => …` that reaches localStorage.getItem / sessionStorage.getItem / getAppSetting( / a load*() persistence helper within 200 chars and before any second useState. PROXY FOR the stack-free condition: durable state is copied into a component-local variable at mount, so the component owns a private copy that no later write to the durable store can reach; the two then disagree silently, and the next commit built from the stale copy serializes it back over the fresh value. THE REPO STATES THIS DEFECT IN ITS OWN WORDS at src/features/teams/sub_mastermind/lib/useLayout.ts:1-7 — 'These replace the one-shot useState(loadGroups) initializers the canvas used to open with: a snapshot taken at mount can only ever be right until someone else writes' — which is also why the bare-reference alternative is in the pattern: that is the exact form the exemplar's comment names. MEASURED 2026-08-17 at 52b0a6ba8: 16 matches across 12 of 4801 .ts/.tsx files, ALL SIXTEEN OPENED AND HAND-READ (precision 16/16). THE MOST INSTRUCTIVE MATCH IS DesktopFooter.tsx:325 AND IT IS WHY THE RULE DOES NOT EXEMPT A LISTENER: it HAS a re-sync arm at :334, window.addEventListener('storage', handler), commented 'Stay in sync when Sidebar itself changes localStorage (e.g. from another tab)' — but the HTML storage event does not fire in the document that WROTE the value, and its real co-writer Sidebar.tsx:30 is in the SAME document of a single-WebView desktop app, so the repair is inert by construction and a rule that credited it would report green on the site it most needs to see. IncidentsInbox.tsx contributes 5 of the 16 (:86 filters, :91 sort, :100 last-seen, :107 group mode, :115 collapsed groups) and its only 'subscribe' hits are an unrelated storeBus channel at :174. POSITIVE CONTROL PARTITIONS THE ANCHOR: useSyncExternalStore( returns 25 matches / 16 files, of which NINE are in this leaf's own directory (useLayout.ts x7, focusStore.ts:70, canvasActionStore.ts:205) while ZERO of the 16 violating sites are — the exemplar and the deviations do not overlap at all. SITE-LEVEL OVERLAP AGAINST ALL 178 REGISTRY RULES IS ZERO, computed with each rule's own pattern over the 12 matched files; file-level overlap with raw-web-storage is 8 of 12 and is EXPECTED AND NOT A COLLISION — that rule anchors on the localStorage identifier and counts a storage ACCESS, this anchors on useState and counts a SNAPSHOT, so they report the same lines for different defects with different fixes. LEGAL FIX: expose subscribe + a stable snapshot getter from the persistence module and bind with useSyncExternalStore (the six bindings in useLayout.ts are the template); or, where the value genuinely has no second writer, say so at the call site. DO NOT silence a match by hoisting the read into a variable above the useState, by renaming the loader, or by adding a storage-event listener — all three preserve the private copy exactly. KNOWN RECALL LIMITS, STATED: (a) a read hoisted to module scope and passed in has no useState anchor; (b) the 200-char bound drops an initializer with a long preamble; (c) useReducer with a lazy init is not covered — zero such sites exist today. PRECONDITION (re-derive per repo, do NOT port): this repo reads durable state through localStorage.getItem / getAppSetting / hand-written load*() helpers and subscribes through useSyncExternalStore. A repo whose durability idiom is redux-persist, a cookie, or a URL search param must key on its own. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on zero matches, BY DESIGN — DELETE the rule then, do not baseline it at 0."
  },
  "exclude": [
    { "path": "**/__tests__/**", "reason": "test fixtures legitimately seed component state from a stubbed store" },
    { "path": "**/*.test.ts", "reason": "test fixtures legitimately seed component state from a stubbed store" },
    { "path": "**/*.test.tsx", "reason": "test fixtures legitimately seed component state from a stubbed store" },
    { "path": "src/test/**", "reason": "the test harness constructs storage state directly" }
  ],
  "baseline": { "files": 12, "matches": 16 },
  "floor": 4000
}
```

```json
{
  "id": "mount-snapshot-of-durable-state-positive-control",
  "goldenPath": "docs/concepts/golden-paths/canvas-state-persistence.md",
  "title": "Durable state read through a subscription instead of a mount snapshot",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "useSyncExternalStore\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL for mount-snapshot-of-durable-state: the COMPLIANT expression of the same concern — the component subscribes to the one copy instead of taking a private one. 25 matches / 16 files at 52b0a6ba8, NINE of them in this leaf's own directory (useLayout.ts x7, focusStore.ts:70, canvasActionStore.ts:205) and ZERO overlapping the 16 violating sites. A control that collapses toward zero means the rule has stopped discriminating between the two ways this repo reads shared state."
  },
  "exclude": [
    { "path": "**/__tests__/**", "reason": "mirrors the violating rule's exclusions so the partition is measured over one population" },
    { "path": "**/*.test.ts", "reason": "mirrors the violating rule's exclusions so the partition is measured over one population" },
    { "path": "**/*.test.tsx", "reason": "mirrors the violating rule's exclusions so the partition is measured over one population" },
    { "path": "src/test/**", "reason": "mirrors the violating rule's exclusions so the partition is measured over one population" }
  ],
  "floor": 4000
}
```

### What is NOT gated, and the instrument that would be

**The dangling reference is not gateable by counting, and I decline to pretend
otherwise.** The four adjacent rules that already ratchet this defect class each cover a
*different medium* and none can see a JSON document in `app_settings`:

| rule | medium it covers | can it see `mastermind.layout.v1`? |
| --- | --- | --- |
| `missing-current-entity-rendered-as-unset` | a picker's `.find(…)?.name ??` render expression | no |
| `unreconciled-selection-set` | a component-scoped `useState<Set<…>>` | no |
| `durable-view-token-with-no-rehydrate-arm` | a zustand `persist()` `partialize` field | no |
| `raw-web-storage` | the `localStorage`/`sessionStorage` identifier | no — the store reaches storage through `setAppSetting` |

A fifth rule keyed on whole-document `setAppSetting` writers would have a **population
of 4** (`layoutStore.ts:255`, `scenePublish.ts:151`, `useEngineCapabilities.ts:98`,
`appearanceMirror.ts:166`), which cannot support a defensible precision claim, and a
ratchet on four sites is a ratchet on one refactor.

**Specify the different instrument instead** — a `scripts/check-durable-references.mjs`
in the shape of `check-csp-hosts.mjs`, because this is an
allowlist-covers-a-set condition:

1. Enumerate the registered durable-document keys from `settings_keys.rs` (the
   allow-list is already the inventory — *"only an inventory of what should exist finds
   it"*, doctrine §2).
2. For each, a declared extractor: which JSON paths hold entity ids and which table owns
   them (`positions` keys → `dev_projects.id`; `links[].from|to` → same;
   `athenaPanels` keys → same).
3. Join against the database and **exit 2 when a key yields zero ids** — the
   precondition, so the checker cannot silently measure nothing, which is the failure
   `check-csp-hosts.mjs` hit twice.
4. Report dangling references per key. It is a *report*, not a ratchet: the count is a
   property of the operator's data, not of the code, so it must never gate CI.

**And prefer the fix to the instrument.** §2(h)'s reconcile-on-hydrate makes the
condition unreachable rather than counted, and the implementation to copy is 25 lines
long and lives in `ascent/src/components/launch/mergeStars.ts`.

### `resolve_scene_slug` — not gated either, and why

One site. A rule anchored on a single function is a rule anchored on a filename. The
right instrument is the **type**: make `resolve_scene_slug` return the same
`CanvasTarget` that `resolve_canvas_target` returns, so the compiler forbids a
snapshot-resolved slug being handed to an action door. That is a signature change and
is deferred with 7.1.

---

## §10 — Verification performed

- `npm run census --rules <private scratch registry unique to this composer>` — the two
  rules only. **The full registry was NOT run** (doctrine §4). Both rules re-extracted
  from this finished document and re-run: **12 files / 16 matches** and **16 files / 25
  matches**, identical.
- Every count produced twice. The census engine's `scanRule` and a **bespoke** walker
  sharing no code (own directory walk, own comment stripper, own line arithmetic). The
  two agreed on 4,801/4,390 file populations, on 16/12, and on 25/16.
  **They disagreed once, and the disagreement is §12.2.**
- All 16 violating and all 25 control sites opened.
- Site-level overlap against all 178 registry rules, each with its own pattern.
- `npx tsc --noEmit` not run — this document changes no code.

---

## §11 — Deferred fixes

Per the campaign's no-destructive-applies rule, 7.1 / 7.2 / 7.3 / 7.4 all change what a
live surface shows or what an action door accepts while the operator is using the app.
They are written to
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) rather than applied.
7.8 (a stale source comment) and 7.5's documentation are safe and are the only
code-adjacent edits this composition proposes.

---

## §12 — Corrections

**12.1 — `sides: "client"` is contradicted, and the correction is not "it was both" —
it is that the client half is the *healthy* half.** The eighth contradiction in the
ledger. This leaf's client-side implementation is the reference this document tells you
to copy; its two unfixed defects (7.1, 7.2) are **both in Rust**, in a file the spine's
label would have scoped a composer away from. A `client`-scoped brief would have found
a well-built store, written a short document, and missed a stale-cache action door
entirely. Per the ledger's own note: sometimes the label is incomplete and sometimes it
is inverted — here it is **inverted**.

**12.2 — My two implementations disagreed, and the disagreement was the finding.** The
bespoke walker reported **21 matches / 18 files** for the snapshot condition; the census
pattern reported **13 / 10**, then **16 / 12** after widening. The bespoke pass was
wrong: its regex allowed `[\s\S]` to run past the `useState` call into later statements,
so `useState(false); … useEffect(() => { … loadX(` counted as one match. Six of its 21
were that. The three the *census* pass was missing were real and were recovered by
adding the bare-reference branch `useState(loadX)` — the exact form
`useLayout.ts:2` names in prose. **Neither number was right; the reconciliation was.**

**12.3 — The brief's lead was right about the medium and wrong about the mechanism.**
It asked me to establish "SQLite column? Zustand persist? localStorage?" — the answer is
**all three, in that order of authority**: one `app_settings` row is the source of
truth, five legacy `localStorage` keys are a one-time migration source left as a stale
backup (`layoutStore.ts:18-20`), and a single `localStorage` key is the IPC-unavailable
fallback. Zustand `persist` is **not** involved and its `partialize` gate
(`durable-view-token-with-no-rehydrate-arm`) is therefore structurally blind to the
largest durable spatial document in the app.

**12.4 — Two published paths carry a count that today's deletion invalidated, and the
delta is exactly the deleted tree.** [`inline-busy-state.md`](./inline-busy-state.md)
(`:35`, `:157`) and [`idempotent-invocation.md`](./idempotent-invocation.md) (`:1078`)
both state **252** `<LoadingSpinner>` call sites. Measured at `78e9bff68^`: **252**.
Measured at `HEAD`: **247**. The deleted `sub_canvas` tree held exactly those 5
(`PipelineControls.tsx`, `TeamToolbar.tsx`, `AssistantInput.tsx`,
`AssistantMessages.tsx`). `inline-busy-state`'s *partition* is unaffected in kind — 21
labelled, 75 in a busy ternary, 152 + 4 standalone — but the arithmetic no longer sums.
**Re-measure before citing.**

**12.5 — Four published paths cite `sub_canvas` files that no longer exist**, deleted
2026-08-17 in `78e9bff68` (29 files, 3,281 deletions):

| path | section | citation | state |
| --- | --- | --- | --- |
| [`anchored-popover.md`](./anchored-popover.md) | `:720` | `teams/sub_canvas/components/edges/EdgeDeleteTooltip.tsx` | **deleted** |
| [`tooltip.md`](./tooltip.md) | `:145`, `:562`, `:563` | `EdgeDeleteTooltip.tsx`, `ConnectionLegend.tsx`, `PipelineControls.tsx` | **all three deleted** |
| [`rendering-untrusted-content.md`](./rendering-untrusted-content.md) | `:223` | `teams/sub_canvas/components/nodes/StickyNoteNode.tsx:150` | **deleted** |
| [`node-canvas.md`](./node-canvas.md) | `§0`, `:138-143`, `:543`, `:764`, `:844`, `:1191`, `:1206` | the whole "28 of 29 unreachable" finding | **resolved by deletion** |

`node-canvas.md`'s is the happy case: its §7 recommendation was carried out, and the
deletion is that document working. `tooltip.md:563`'s row is the one that needs
arithmetic — it lists a set of "mouse-only hover surfaces — migrate" and **2 of its
entries are gone**, which moves any baseline derived from it. `dev-only-diagnostics.md:9`
and `usage-analytics.md:31` quote the *recommendation* to delete the tree and are
correct as history.

**12.6 — The brief told me the Mastermind canvas is out of bounds for deletion. It is
also out of bounds for *suspicion*, and I checked rather than assumed.**
`npm run orphans` at `HEAD` reports **758 orphans**; **none** of the 98 files under
`sub_mastermind/` is among them. `MastermindPage.tsx` is reachable from `App.tsx`, the
layout store has 4 test files covering hydration, migration, authorship and the debounce,
and its Rust reader has 7 unit tests. This is live, tested, load-bearing code and the
operator's correction was right.

**12.7 — A code comment states a measurement without a date and no longer reproduces.**
Not in this leaf but found while measuring its neighbour, and recorded here because it
is the same failure the doctrine warns about:
`athenaChatWindow.ts:32-42` says *"Measured on the live default thread: 50 loaded
messages contain **6 user messages**"*. Replayed against the operator's real brain on
2026-08-17: **13 user, 33 assistant, 4 system** — 26%, not 12%. The comment's
*conclusion* survives (the message cap still hides more than the round boundary: 17 vs
7) but its number does not. Detail in
[`streaming-chat-transcript.md`](./streaming-chat-transcript.md) §12.

**12.9 — ⚠ A rule published in this same wave will be silently lost, and the contract
document is why.** I published my §9 fence as ` ```jsonc `, following
[`golden-path-contract.md`](../golden-path-contract.md)`:131`, which shows the census
rule block in exactly that language. **The merger cannot see it.**
`scripts/census/lib/instruments/extractFences.mjs:53-57` matches the info string
**exactly** and says so in a comment — *"a prefix match would make a `json5` or
`jsonc` block merge as a census rule, which is a behaviour change dressed up as
leniency."* Re-extracting from my own finished document returned **0 fences, 0 rules**,
which is indistinguishable from a document that published none. Caught, and my fences
are now ` ```json ` (re-extracted: 2 rules, baselines reproduce exactly).

**Auditing every published path for the same trap found one live casualty.** Six
`jsonc` fences carry a rule `id`; four are in the registry (`local-empty-state`,
`raw-react-lazy`, `silent-row-skip`, `deferred-read-then-write` — merged before the
extractor tightened, or by hand). **Two are not:**

```
setup-checklist.md  ->  "vacuous-all-done-verdict"                  *** NOT IN REGISTRY ***
setup-checklist.md  ->  "vacuous-all-done-verdict-positive-control" *** NOT IN REGISTRY ***
```

`docs/concepts/golden-paths/setup-checklist.md` is **untracked** — a sibling composer's
document from this same 2026-08-17 wave, complete and unmerged. When the orchestrator
runs `merge-published-rules.mjs` over it, it will report zero rules and that composer's
measurement will vanish with no error. **Two corrections owed:** change that document's
two fences to ` ```json `, and fix `golden-path-contract.md:131` — the contract is
teaching every composer to publish in a language its own merger refuses.

**12.8 — Personas is ahead of the fleet on the two-writers clause, stated as
self-comparison.** No sibling has a second programmatic writer against a user-arranged
document, so there is nothing to compare `useCanvasPanelBridge.ts:40-42` to. It is
labelled a **house convention**, not doctrine — per the oracle's rule that a
prescription with no trace anywhere else is local calibration until something
rediscovers it.
