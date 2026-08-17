# Golden path — Scroll and resize affordances

> Situation node: `ui-system/layout-and-navigation/scroll-and-resize-affordances` · [situation spine](../situation-spine.md)
> recurrence **18** · risk **LOW** · sides **client** · convergence **mixed** · `twoSided: false`
> dimensions: **ui · performance · function**
> Leaf definition: *"edge shadows, scroll restoration and a bounded draggable splitter."*
> Merged from **Scroll affordances** + **Drag-to-resize panel**.
> Composed 2026-08-17 against `master` @ `2edb8d694`. **Short form** (spine header, §0, §2, §7, §9, §12)
> per the runbook's Mode 2 tiering — this leaf is `risk: low`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (`shared-facts.json#frontend.tsFiles`, re-verified
> this session by an independent walk: 4,829; **4,425** production). Read in full:
> `hooks/utility/interaction/{useScrollRestoration,useScrollShadow}.ts`,
> `shared/components/display/{ColumnResize,ScrollShadowContainer,UnifiedTable,GroupedVirtualList}.tsx`,
> `shared/components/layout/ContentLayout.tsx`,
> `shared/components/layout/settings/useSectionScrollSpy.ts`,
> `shared/chrome/sidebar/Sidebar.tsx`,
> `overview/sub_manual-review/components/ReviewInboxPanel.tsx`,
> `teams/sub_teamMemory/components/panel/TeamMemoryPanel.tsx`,
> `agents/sub_executions/components/runner/ExecutionTerminal.tsx`,
> `agents/sub_executions/libs/useRunnerExecution.ts`,
> `agents/sub_lab/use-cases/useUseCaseExecution.ts`,
> `plugins/artist/sub_media_studio/TimelineClip.tsx`,
> `teams/sub_mastermind/lib/GroupLayer.tsx`, `plugins/drive/hooks/useScrollShadows.ts`,
> `plugins/drive/components/DriveFileList.tsx`, `settings/components/SettingsPage.tsx`,
> `templates/sub_generated/gallery/cards/TemplateVirtualList.tsx`.
>
> **Measured by executing, not by reading.** One jsdom 29.1.1 + React 19.2.6 harness (the repo's own
> versions, through the repo's `node_modules`) with `SettingsPage.tsx:29-92` transcribed **statement
> for statement**, including its sweep predicate. One substitution, recorded: `motion.div` → `div`,
> which is sound because the question under test is *DOM node identity across a re-render* and
> `motion.div` renders a real `div` at the same position. That replay produced §0 and §7 D1; reading
> the file produced neither, because the thing being tested is not in the file — it is in what React
> does with it.
>
> **Two independent implementations of every count**, one of them going through `matchJsxTags` from
> `scripts/census/lib/instruments/` so a generic-typed component's `>` cannot close a tag early. They
> disagreed by 5% on the headline population; §12.2 says why, and reports both.

---

## 0. Headline

**A scroll offset lives on a DOM node, so its lifetime is the node's lifetime — and nothing in this
codebase declares what a node's lifetime is. The settings surface makes that concrete and absurd: the
same user gesture, leaving a settings tab and coming back, preserves the scroll position at 29
seconds and discards it at 31.**

Executed against the real mount logic (`SettingsPage.tsx:24-64`, transcribed verbatim):

```
{"case":"switch away (within 30s idle window)","accountNodeStillInDom":true,
 "sameNodeIdentity":true,"scrollTopNow":1234}
{"case":"switch back (within 30s)","sameNodeIdentity":true,"scrollTopRestored":1234}

{"case":"sweep predicate replayed","mountedAt29s":["account","appearance"],
 "mountedAt31s":["appearance"],"accountSurvives29s":true,"accountSurvives31s":false}

{"case":"switch away past 30s, then back","nodeRemovedDuringAbsence":true,
 "sameNodeIdentity":false,"scrollTopAfterReturn":0,"offsetLost":true}
```

Nothing here is a bug in `SettingsPage`. Its idle-unmount is a deliberate, well-commented memory
optimisation (`:43-45`), and keeping inactive tabs alive under `opacity: 0` is a deliberate transition
choice (`:75-83`). The two decisions were made for unrelated reasons and their *product* is a
retention policy for scroll position measured in wall-clock seconds, which no one specified and no
one can see.

**That is the inversion, and it generalises past this one surface.** Two things a user cares about
have opposite default lifetimes and the code never says which it wanted:

| | where it lives | lifetime | survives a tab switch? |
| --- | --- | --- | --- |
| scroll offset | on the DOM node (`el.scrollTop`) | **CSS lifetime** — as long as the node is in the tree, however it is painted | yes, if the node is hidden; no, if it is unmounted |
| the content that was scrolled | in a component | **conditional lifetime** — as long as the branch renders | no |

So a surface that hides with `opacity`/`hidden` keeps a position it never asked to keep, and a
surface that hides with `{cond && …}` loses one it never asked to lose. **The population is
lopsided in exactly the direction that makes this invisible:**

| | count |
| --- | --- |
| scroll containers declared in an open tag (`overflow-{y-,x-,}auto\|scroll`) | **563 across 462 files** |
| …same class, counted over whole file content (superset — §12.2) | **594 across 476 files** |
| `useScrollRestoration` **hook** call sites | **4** |
| surfaces that pass it a key through the shared primitives' `scrollRestoreKey` prop | **2** |
| independent scroll-position memories in the tree | **3** |
| explicit "go back to the top" resets in application code | **2** |
| files that render **any** edge-shadow affordance | **11 of 462** (2.4%) |

And on the resize half, one number says most of it: **`role="separator"` appears once in 4,829
files.** Ten `cursor-*-resize` affordances, one of which declares what it is, and **zero** of which
can be operated from a keyboard.

---

## 2. The one way

**Decide whether the affordance's state is allowed to outlive its DOM node, say so at the call site,
and pick the mechanism that already has that lifetime — then let a primitive own the listener.**
Concretely: (a) for a scroll position, ask *"if the user leaves this surface and comes back, should
they be where they were?"* If yes, pass a `scrollRestoreKey` — the key must encode everything that
makes this a different context (route + entity + tab + the filters that define "where you are"),
because `useScrollRestoration` treats a key it has never seen as a new context and jumps to the top,
which is the correct behaviour and only correct if the key is honest. If no, do nothing — but write
the "no" down, because the default is not "no", it is "whatever the parent's paint strategy happens
to be". (b) Never hand-roll the memory: `useScrollRestoration` from
`@/hooks/utility/interaction/useScrollRestoration` returns a **callback ref**, which is the whole
reason it exists — list containers are rendered conditionally after data loads, and a plain effect
misses the late mount. Attach it, pass the virtualizer's `parentRef` as `forwardRef`, and stop.
(c) For an edge shadow, wrap in `ScrollShadowContainer` or take `useScrollShadow(ref)`; do not
re-derive `scrollTop > 1` per surface. (d) For a drag-resize, **scope the drag to the element with
`setPointerCapture`, not to `document`** — the browser then delivers every subsequent move to that
element and tears the capture down on `lostpointercapture`, so an unmount cannot strand a listener
and no `document.body.style.cursor` needs restoring. Give the handle `role="separator"`,
`aria-orientation`, `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, a `tabIndex`, and arrow-key
handling: a splitter with no keyboard path is not a smaller feature, it is an inoperable one.
(e) Clamp on **both** sides and persist through the same door as every other view value —
`localStorage` under a namespaced key if it is chrome, the store's `partialize` if it is view state —
and pick one, because this repo currently has both and a third option ("nothing") in three visually
identical splitters.

> **Composes with two neighbours, and one of the compositions is a trap.**
> [`view-state-persistence`](./view-state-persistence.md) says to decide a value's lifetime out loud
> before choosing its home. That is upstream of everything here, and its §7 D12 already records that
> `useScrollRestoration.ts:36-37` cites two singletons that do not exist. **The trap:**
> [`long-list-rendering`](./long-list-rendering.md) prescribes bounding a list with `rowHeight` on
> `UnifiedTable`, and `scrollRestoreKey` is one of the three props that
> [its §7 D2](./long-list-rendering.md) measured as **silently inert without `rowHeight`**. So a
> surface can follow this path's (a) and get nothing, because a prop it passed is read only on the
> other branch. Pass both or neither; passing `scrollRestoreKey` alone is a no-op that reads as a
> decision.

---

## 7. Deviations

Eleven. D1 was executed; the rest were measured. Nothing was applied — every fix here changes what a
live surface does under the operator's hands.

### D1 — the same gesture has two scroll outcomes, and the discriminator is wall-clock time · executed

`SettingsPage.tsx:24` (`IDLE_UNMOUNT_MS = 30_000`), `:27` (`SWEEP_INTERVAL_MS = 5_000`), `:50-61`
(the predicate), `:79-81` (the paint strategy). Harness output in §0. Not one of the 13 settings
panels passes a `scrollRestoreKey`, and none can — none of them renders a shared list primitive at
the panel root; the scroll box is `ContentBody` (`ContentLayout.tsx:260`), which takes no such prop.

The surface where this hurts most is `ApiKeysSettings.tsx` (572 lines, one unindexed scroll,
`SettingsScaffold` not adopted — see [`settings-panel-scaffold`](./settings-panel-scaffold.md) §7 D4).

### D2 — 563 scroll containers, 4 hook call sites, 2 surfaces that pass a key

The 4 `useScrollRestoration` call sites:

| site | key |
| --- | --- |
| `shared/components/display/UnifiedTable.tsx:532` | the optional `scrollRestoreKey` prop |
| `shared/components/display/UnifiedTable.tsx:738` | the optional `scrollRestoreKey` prop |
| `shared/components/display/GroupedVirtualList.tsx:148` | the optional `scrollRestoreKey` prop |
| `templates/sub_generated/gallery/cards/TemplateVirtualList.tsx:88` | a literal — `` `templates/gallery|ai=${…}` `` |

Three of the four are inside shared primitives and are inert unless a consumer opts in. Consumers
that opt in, in the whole tree — **two**:

- `overview/sub_activity/components/GlobalExecutionList.tsx:269,438` — a four-part key
  (`route|status|model|persona`), the exemplar to copy.
- `overview/sub_events/components/EventLogList.tsx:458` — a five-part key.

The hook's own docstring (`:28-31`) explicitly blesses the inert wiring: *"`undefined` … makes the
hook inert — it still forwards the node, so it is safe to wire unconditionally into a shared
component and only pass a key where restoration is wanted."* That is a correct design decision and it
is also why adoption is 2. **A capability that is free to wire and optional to use converges on
unused**, and nothing counts the surfaces that wanted it.

### D3 — three independent scroll-position memories, none aware of the others

| implementation | storage | scope | file |
| --- | --- | --- | --- |
| `useScrollRestoration` | `Map` on `globalThis.__personasScrollPositions__` | app-wide, keyed | `hooks/utility/interaction/useScrollRestoration.ts:38-42` |
| the sidebar's L2 rail | `useRef(new Map())` | one component instance | `shared/chrome/sidebar/Sidebar.tsx:88,93-103` |
| Drive's file list | `recallScroll` / `rememberScroll`, keyed by path | one plugin | `plugins/drive/components/DriveFileList.tsx:325,738` |

The sidebar's is the interesting one: `Sidebar.tsx:93-103` implements the *entire* semantics of the
shared hook — save the outgoing key's offset, restore the incoming one's, defer a frame so the
content exists — in eleven lines, including the `requestAnimationFrame` retry the shared hook
generalises to a 40-frame budget (`useScrollRestoration.ts:46`). It is a correct, independent
reinvention living four directories from the primitive.

### D4 — 2 explicit scroll resets, 20 tail-follows, and no shared answer for either

Whole-tree, production only:

| | count |
| --- | --- |
| `scrollTop = 0` | **2** — `plugins/companion/orb/OrbQuickInputBar.tsx:55`, and `useScrollRestoration.ts:95` (the primitive itself) |
| `scrollTo({ top: 0 … })` | **1** — `agents/quick-answer/triage/deck/useDeckDialog.tsx:112` (the `Home` key) |
| `scrollTop = …scrollHeight` (follow the tail) | **20 across 18 files** |
| `scrollIntoView(…)` | **20 across 19 files** |

So the app resets to top **once** in application code and pins to the bottom **twenty times**, and
the twenty are eighteen separate implementations of "a terminal that follows output". Exactly one of
them handles the case the others do not: `plugins/companion/useChatScroll.ts:9-13` documents that the
panel *used to* force `scrollTop = scrollHeight` on every message and now only does so when the user
is already at the bottom (`:63`). Seventeen files still do the unconditional thing, which is the
behaviour that yanks a user out of scrollback mid-read.

### D5 — one splitter in ten declares what it is; none can be used without a mouse

Ten `cursor-*-resize` occurrences across 9 files. Classified by hand:

| | site | primitive? | `role="separator"` | keyboard |
| --- | --- | --- | --- | --- |
| handle | `shared/components/display/ColumnResize.tsx:139` (tag opens `:125`) | **is the primitive** | **yes** (`:126-127`) | no |
| handle | `overview/sub_manual-review/…/ReviewInboxPanel.tsx:160` | hand-rolled (`:68-94`) | no | no |
| handle | `teams/sub_teamMemory/…/TeamMemoryPanel.tsx:148` | hand-rolled | no | no |
| handle | `agents/sub_executions/components/runner/ExecutionTerminal.tsx:84` | hand-rolled ×2 (D6) | no | no |
| handle | `plugins/artist/sub_media_studio/TimelineClip.tsx:161`, `:182` | hand-rolled | no | no |
| container cursor | `GlobalExecutionList.tsx:429`, `IncidentsInbox.tsx:494`, `MessageList.tsx:339`, `UnifiedTable.tsx:572` | — | n/a | n/a |

Plus one the class-based sweep cannot see: `teams/sub_mastermind/lib/GroupLayer.tsx:149-150` sets
`cursor: 'nwse-resize'` as an inline style on an SVG node. That miss is recorded rather than
patched-over, because it bounds the recall of every class-keyed instrument in this leaf including the
one in §9.

`role="separator"` total in 4,829 files: **1**. `aria-valuenow` on any of the ten: **0**.
`tabIndex` or `onKeyDown` on any of the ten: **0**. The shared primitive is the only one that
declares its role and it still cannot be moved with the keyboard, so **"use the shared primitive"
does not fix this** — the destination is missing the thing too. That is the contract's fifth
gate-failure mode (a gate that points at a broken destination), arriving here in its mildest form:
the primitive is better than the alternatives on three axes and equal to them on the one a
screen-reader user needs.

### D6 — two copies of the terminal-resize drag, with different bounds and different lifetimes

`ExecutionTerminal.tsx:83-84` is one component driven by two independent hooks:

| host | clamp | listener teardown |
| --- | --- | --- |
| `agents/sub_executions/libs/useRunnerExecution.ts:155,172` | `Math.max(120, Math.min(900, …))` | has a `useEffect` cleanup (`:177-182`) |
| `agents/sub_lab/use-cases/useUseCaseExecution.ts:122,131` | `Math.max(120, Math.min(700, …))` | none — removal only inside `onUp` (`:125-129`) |

Same handle, same gesture, maximum height 900 in one surface and 700 in the other, and only one of
the two survived the fix. Neither height is persisted (`useRunnerState.ts:63` `useState(400)`;
`useUseCaseExecution.ts:37` `useState(300)`), so both reset on every remount.

### D7 — the shared resize primitive is the one with no maximum, and it leaks

`ColumnResize.tsx:74` — `Math.max(MIN_COLUMN_WIDTH, Math.round(drag.startWidth + delta))`. `MIN` is
64 (`:19`); **there is no `Math.min`**. A column can be dragged wider than the viewport, pushing every
other column out of the grid template, and the only recovery is knowing that double-clicking the
divider resets it (`:137`, undocumented in the UI).

Separately, `:86-87` attaches `pointermove`/`pointerup` to `window` and removes them **only** inside
`handleUp` (`:78-79`). There is no `useEffect` cleanup, so a drag interrupted by an unmount strands a
`pointermove` handler on `window` for the life of the session. Because this is the shared primitive,
the behaviour is inherited by `UnifiedTable` and by all three Overview grid tables
(`IncidentTableHeader.tsx:56,70,84,98`; `GlobalExecutionList.tsx:288-330`; `MessageList.tsx:219-253`).

### D8 — five of nine drag loops are subscribed to the gesture, not to the component

The census rule in §9 counts these. Split by host:

| | sites |
| --- | --- |
| move-listener added **inside a `useEffect`** (React guarantees teardown) | 4 — `ExecutionMiniPlayer.tsx:219`, `TimelineScrubber.tsx:58`, `DriveImageLightbox.tsx:259`, `TeamMemoryPanel.tsx:84` |
| move-listener added **inside a gesture handler** (teardown depends on the up-event firing) | 5 — `useRunnerExecution.ts:172`, `useUseCaseExecution.ts:131`, `ReviewInboxPanel.tsx:92`, `ColumnResize.tsx:86`, `lib/dev/DevInspector.tsx:118` |

Against **13 `setPointerCapture` sites across 12 files** that express the same gesture element-locally
and cannot strand anything: `teams/sub_mastermind/lib/{CanvasShell.tsx:378,486, GroupLayer.tsx:76,
NoteLayer.tsx:27, useCanvasCamera.ts:176, useIslandDrag.ts:45}`,
`plugins/artist/sub_media_studio/{TimelineClip.tsx:85, TimelinePanel.tsx:280, TextLane.tsx:205}`,
`plugins/artist/sub_gallery/Gallery2D.tsx:281`, `plugins/companion/orb/athenaOrbGesture.ts:65`,
`overview/sub_patterns/graph/useGraphCanvas.ts:130`,
`plugins/dev-tools/sub_projects/TeamGraphPreview.tsx:217`.

**Zero overlap between the two sets** — not one file does both. This repo has already converged on
the right answer in its canvas/timeline surfaces and has not carried it to its splitters. Same shape
as D3: the answer exists, four directories away.

### D9 — three visually identical splitters, three different persistence answers

| splitter | persisted? | where |
| --- | --- | --- |
| `TeamMemoryPanel.tsx:82` | yes | `localStorage['team-memory-panel-width']` (`:15`) |
| `ColumnResize.tsx:56` | yes | `localStorage['table-col-widths:<tableId>']` (`:20`) |
| `ReviewInboxPanel.tsx:52` | **no** | `useState<number \| null>(null)` — discarded on unmount |
| both terminal heights (D6) | **no** | `useState` |

`systemStore.ts`'s `partialize` holds **64 keys and not one `*Width`/`*Height`**, so none of this goes
through the store's persistence at all. Two `localStorage` schemes, no shared prefix helper, and two
surfaces that forget.

### D10 — the edge-shadow affordance is at 2.4%, and a plugin wrote a second copy of it

`useScrollShadow` (`hooks/utility/interaction/useScrollShadow.ts:10`) and its wrapper
`ScrollShadowContainer` are used by **7 files**; `plugins/drive/hooks/useScrollShadows.ts:13` is an
independent second hook (plural name) used by 3 more Drive files. **11 of the 462 files that declare
a scroll container render any shadow.** The 451 others give the user no signal that content continues
below the fold.

Worth recording as *good*: `useScrollShadow.ts:31-33` carries a comment explaining that a
`MutationObserver` was removed because it caused a render→mutate→setState→render loop. That is a
documented negative result sitting in the primitive, and it is why the second copy in Drive is a cost
— whoever wrote it did not get that comment.

### D11 — cleared claims

- **`useScrollRestoration`'s `globalThis` key is not an HMR hazard of the kind
  [`hmr-safe-singletons`](./hmr-safe-singletons.md) catalogues.** It is a `Map` with per-key values
  and no one-way latch; a stale copy is at worst a forgotten offset. The comment at `:36-37` citing
  `executionBuffers`/`eventBus` is wrong about both names — already recorded as
  `view-state-persistence` §7 D12, not re-claimed here.
- **`TeamMemoryPanel`'s always-on `window` listeners are not a leak.** `:84-85` subscribes for every
  mounted panel and gates on `draggingRef`, with a real `useEffect` cleanup (`:86-89`). It is more
  listeners than necessary, not an unbounded number.
- **`TimelineClip`'s trims are bounded on both sides** (`:106-111`) and persist through the
  composition document. Checked because two adjacent handles in a media timeline are where an
  unbounded drag usually is.
- **`UnifiedTable.tsx:587` deliberately omits the handle on the last column.** Read as a bug, then
  read the grid template (`:517`) — the last column absorbs the remainder, so a divider on it would
  have nothing to resize against. Correct as written.

---

## 9. The gate

One rule, validated standalone in a composer-private scratch registry
(`rules-uilayoutnav-2be17a89.json` — filename unique to this composer, per the doctrine's
shared-scratchpad warning), hand-verified, positive-controlled, fault-injected six ways, then
re-extracted from this document and re-run to identical numbers.

**The condition it is a proxy for, stated so another repo can re-derive its own signal:** *a
continuous drag's subscription lifetime is bound to the gesture completing rather than to the element
that owns the gesture.* In this stack that manifests as a `document`/`window` move-listener; in a
stack with a different event model it will manifest differently, and the gate travels no further than
the manifestation.

```json
{
  "id": "document-scoped-drag-loop",
  "goldenPath": "docs/concepts/golden-paths/scroll-and-resize-affordances.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:document|window)\\s*\\.\\s*addEventListener\\s*\\(\\s*['\"](?:pointer|mouse|touch)move['\"]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a continuous-drag move listener attached straight to document or window. PROXY FOR the stack-free condition: a drag's subscription lifetime is bound to the gesture completing rather than to the element that owns the gesture, so the listener outlives an interrupted drag and the affordance owns no teardown of its own. The compliant expression of the same gesture is element-scoped pointer capture, which the browser tears down on lostpointercapture."
  },
  "baseline": { "files": 9, "matches": 9 },
  "floor": 4000
}
```

```json
{
  "id": "document-scoped-drag-loop-positive-control",
  "goldenPath": "docs/concepts/golden-paths/scroll-and-resize-affordances.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\.\\s*setPointerCapture\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the same drag gesture expressed element-locally. If this returns ~0 the gate is not discriminating between the two ways this repo drives a drag."
  },
  "floor": 4000
}
```

**Baseline, as run:** gate **9 files / 9 matches**; control **12 files / 13 matches**. The control
partitions the drag surface cleanly — **0 site overlap and 0 file overlap** between the two sets
(D8), so the pattern is discriminating between the repo's two idioms rather than counting all drags.

**Overlap, measured at SITE level against the FINAL pattern of every one of the 172 registered
rules** (not file level, not against an intermediate draft — both mistakes are recorded in the
doctrine):

```
--- drag rule site overlap against EVERY registered rule ---
(done — any rule not listed has zero site overlap)
```

Zero, against all 172. The nearest neighbour by construction is `hand-rolled-outside-click`
(`anchored-popover`, 46 files / 47 matches), which anchors on the same `addEventListener` call
against `mousedown|pointerdown`. Re-run this session: **48 sites, 0 shared with this rule, 0 shared
files.** The two rules partition the document-level pointer surface between them — press events to
the popover leaf, move events here — which is the outcome you want from adjacent gates and is not
something either author arranged.

**Fault injection — six ways, all verified by exit code, never through a pipe:**

| injection | expected | `exit` |
| --- | --- | --- |
| 4 synthetic violations (`document.` / `window.` / spaced / with options) in an isolated tree | all 4 match | 4/4 ✓ |
| 6 near-misses in the same file (`el.addEventListener('pointermove')`, `pointerdown`, `pointerup`, `keydown`, `scroll`, `node.onpointermove =`) | none match | 0/6 ✓ |
| a comment line containing the exact violating text | ignored | ignored ✓ (runner reported `1 match(es) ignored on comment-only lines`) |
| baseline 99, actual 4 (silent drop) | fail | `1` |
| baseline 2, actual 4 (rise) | fail | `1` |
| baseline 4, actual 4 | pass | `0` |
| empty tree (floor + zero-match assertions) | fail | `1` |
| real repo, as published | pass | `0` |

**Recorded while doing this:** the first fault-injection run reported `DRIFT` in its output and
`exit=0`, because I had piped the runner through `sed` to strip ANSI codes — **the pipe's exit code
replaced the runner's**, which is the exact failure the runbook documents. It was caught only because
the printed word contradicted the printed number. Verify by exit code, and do not put anything
between the runner and `$?`.

**What this gate does NOT catch, said plainly.** It is a subscription-shape gate, not a leak gate. All
9 matches are the same *shape*; only **5** are the actual leak (D8), because 4 subscribe inside a
`useEffect` whose cleanup React runs. Separating those two would require joining an
`addEventListener` to its enclosing function, and the runner matches one regex against whole file
content — the join is not expressible. Two consequences, both accepted deliberately: precision is
**9/9 for the stated condition** ("a drag is driven from document/window instead of from the
element") and **5/9 for the narrower leak reading, so do not quote it as a leak count**; and the four
compliant-teardown sites are still worth ratcheting, because a `useEffect`-hosted global move
listener fires for every pointer move in the window whether or not a drag is in progress.

Two conditions this leaf could not gate at all, specified for whoever builds the instrument:

- **A splitter with no keyboard path.** `role="separator"` appears once; a rule keyed on its
  *absence* is an absence assertion, which the census cannot express by construction. The signal
  wants an ESLint rule with an AST: *a JSX element whose className matches `cursor-*-resize` and
  which has a pointer/mouse-down handler must also carry `role="separator"`, `tabIndex`, and
  `onKeyDown`.* An attempted regex form scored **5/9 precision** (4 of its 9 matches were the
  `isResizing ? 'cursor-col-resize'` class on a *container*, not a handle) and additionally missed
  every handle whose open tag contains an inline arrow function — see §12.3.
- **A scroll container that wanted restoration and got none.** 563 containers, 2 keys. There is no
  textual difference between a container that should restore and one that should not; the difference
  is a product decision. This is the doctrine's "an inventory of what should exist" case, and the
  honest instrument is a design review, not a matcher.

---

## 12. Corrections

### 12.1 — to the brief: the population is bigger than primed, and the "3 explicit resets" was 2

The brief primed **"520 scroll-container occurrences vs 3 explicit resets"** and
**"`useScrollRestoration` used at 4 sites, only 3 passing a key"**. Measured at `2edb8d694`:

| primed | measured | note |
| --- | --- | --- |
| 520 occurrences | **594** occurrences / 476 files (whole-file) · **563** / 462 (open tags) | §12.2 |
| 3 explicit resets | **2** `scrollTop = 0` (one of which is the primitive) + **1** `scrollTo({top:0})` | so **2** in application code |
| 4 hook sites, 3 passing a key | **4** hook sites; **1** passes a literal key, **3** forward an optional prop; **2** consumers pass one | the "3" and the "2" count different things |

The last row is the one that matters. Counting *hook call sites* and counting *surfaces that
actually restore* give 3 and 2, and the gap is the shared-primitive indirection: `UnifiedTable`
calls the hook twice and `GroupedVirtualList` once, all three with a prop that defaults to
`undefined`. The number a reader wants is **2**.

### 12.2 — my two implementations disagreed by 5%, and both are right about different things

Whole-file regex: **594 / 476.** `matchJsxTags` over open tags: **563 / 462.** Delta **31
occurrences / 14 files**, and the tag scanner is the *smaller* one — the opposite of the direction
the instrument's own recorded bug produces (a generic's `>` closing a tag early makes a scanner
*under*-count, and it did, but not for that reason here).

The 31 are overflow classes that are not inside a JSX open tag: class strings assembled into a
`const` and spread in later, `clsx`-style conditional fragments, and prose in comments about scroll
behaviour. Some of those are real scroll containers and some are not, which is why both numbers
appear in §0 rather than a reconciled one. **The honest statement is a range with the method
attached** — "563 open tags, 594 occurrences" — not an average, and not whichever one supports the
argument.

### 12.3 — I hit the `matchJsxTags` bug from the other side, in a hand-rolled pattern, exactly as documented

Building the declined §9 splitter gate, I wrote a control meant to find handles that **do** declare
`role="separator"`:

```
<[A-Za-z][^<>]{0,600}?role\s*=\s*["']separator["'][^<>]{0,600}?cursor-(?:col|row|ew|ns)-resize
```

It returned **0**, against a known-true site (`ColumnResize.tsx:125-139`). The cause is in the
instrument's header verbatim: `[^<>]` cannot cross `onPointerDown={(e) => {`, because `=>` contains
a `>`. So the control said "no compliant handle exists" when the compliant handle was the file I had
open.

The direction of the error is what makes it expensive, and it is worse than the recorded case. The
violating pattern (`…cursor-*-resize` with no `role=`) matched **9** — and it excluded
`ColumnResize.tsx` *for the wrong reason*: not because the tag carries `role="separator"`, but
because the same arrow function broke the same character class. A pattern that gets the right answer
by a mechanism it does not know about will get the wrong answer the moment someone changes
`onPointerDown={handleResize}` to `onPointerDown={(e) => handleResize(e)}`, and nothing will report
it. That is why §9 declines the splitter gate rather than shipping it at 5/9: the precision number
was bad, and the pattern was *unsound* on top of being imprecise.

Ship the `document`-scoped rule instead — its delimiters are quotes and parentheses, and no JSX is
involved.

### 12.4 — the leaf's own spine label, and one primed lead that inverted

`sides: "client"` **holds**, and for the structural reason the doctrine records for the two other
upholdings: *the server never sees the DOM.* Every finding in this document — the offset, the node
lifetime, the listener, the clamp, the ARIA — is a property of a tree the backend has no
representation of. The spine also marks this leaf `twoSided: false`, which is consistent, and that
consistency is worth noting because the two sibling leaves in this batch both carry `twoSided: true`
against client-only findings.

`convergence: mixed` was **not tested** — the short-form tier does not include the sibling sweep, and
a partial one produces the sort of unestablished-cohort ratio the doctrine says to distrust.
Recorded as untested rather than omitted.

The primed lead that inverted: I was briefed to own *"what resizes, what restores scroll, and the
CSS-vs-component lifetime split"*, with the implication that the split is the finding. The split is
real (§0) but it is not the deviation — **it is the mechanism**. The deviation is that the split is
never *declared*, and the sharpest evidence for that is not a scroll container at all: it is
`SettingsPage`'s 30-second sweep, a memory optimisation in a different feature that silently
became this leaf's retention policy. A brief scoped to "affordances" would not have looked there.

### 12.5 — a prescription owed upward, about composition

§2 (b) tells you to pass `scrollRestoreKey`. [`long-list-rendering`](./long-list-rendering.md) §7 D2
established that `scrollRestoreKey` is **inert without `rowHeight`** on `UnifiedTable`. Two
individually-correct paths compose into a surface that passes a prop, reads as having made a
decision, and restores nothing — the doctrine's §6 hazard, found here rather than reasoned about.
It is called out inline in §2 so a reader following this path cannot miss it, and it is reported here
so the neighbour's author knows a second path now depends on that fact.
