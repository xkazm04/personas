# Guided tour step

> Situation node: `client-runtime/flows-and-onboarding/guided-tour-step` ·
> [situation spine](../situation-spine.md) · recurrence **6** · risk **medium** ·
> sides `client` · convergence `converged` · dimensions ui · function · code-quality ·
> `twoSided: false`
>
> **Short form** (Mode 2 tiering: `risk: medium`, recurrence < 9). The quality
> core is unchanged — every count has two implementations, the published rule has
> a positive control that partitions its anchor, and precision is hand-verified.
>
> Composed 2026-08-17 against `master` @ `2a874e692`. Read in full: `tourSlice.ts`
> (1,671 lines), `GuidedTour.tsx`, `TourSpotlight.tsx`, `TourLauncher.tsx`,
> `dynamicTours.ts`, `tourAnchors.test.ts`, `gen-tour-anchors.mjs`,
> `tourAnchorManifest.json` (945 testids), `feature-doc-map.json`,
> `ObsidianBrainPage.tsx`. Instrumented: 4,399 source files, twice.

---

## §0 Headline

**This repo has two independent authorities on what a tour step may point at,
and they disagree on six anchors — every one of them in the Obsidian Brain
tour.** `tourAnchors.test.ts` is a substring scan of the whole source tree and
passes all **32** registry anchors, correctly, including the six that live as
values in a `const` map written specifically so a static scan could see them
(`ObsidianBrainPage.tsx:25-38`). `gen-tour-anchors.mjs` is six regexes that only
match an anchor in *attribute position*, and it cannot see that map — so those
six anchors are absent from `tourAnchorManifest.json`, and
`dynamicTours.ts:144` rejects any Athena-composed tour that names one.
**A hand-written tour points at anchors a machine-written tour is forbidden to
name, and nothing anywhere reports the disagreement.**

Second, measured by replay rather than reading: **the app does not record which
tour you were in.** `PersistedTourState` has a per-tour map and no active-tour
pointer, and hydration hardcodes `getting-started` (`tourSlice.ts:1318`,
`:1379`). A user six steps into the nine-step Teams tour who reloads is returned
to `getting-started` at step 0 with zero progress carried — the Teams record is
still on disk and nothing reads it. And a tour whose definition did *not* survive
the reload (every Athena-composed tour: the registry is a `globalThis` Map,
`tourSlice.ts:1014-1019`) is **marked 100 % complete on the next advance**,
because `[].every(…)` is `true` (`tourSlice.ts:1493`, executed).

---

## §2 The one way

**A tour step is a row in the registry plus an anchor that a machine verified,
and the registry is the only place any of it lives.** Concretely:

1. **Add the step to its `TourStepDef[]` array in `tourSlice.ts`** — `id`,
   `title`, `description`, `hint`, `nav`, `completeOn`, `subSteps`. Never build a
   parallel step list in a component; `GuidedTour.tsx` is a generic driver over
   `getActiveTourSteps(tourId)` and it should stay that way.
2. **Give the anchor an attribute-position literal.** `data-testid="x"` on the
   element you want haloed, in the component that renders it. Not a `const` map
   value, not a ternary arm, not an aliased prop — those three forms all render
   correctly, all pass the drift test, and all are invisible to the manifest
   generator (§7.B), so an anchor written that way silently becomes
   un-nameable by Athena.
3. **Add the completion event to `TOUR_EVENTS`, then use it as `completeOn`,
   then emit it.** All three, in one change. The union closes typos in both
   directions and closes nothing else: a declared event with no consumer, and a
   *producer* with no consumer, both compile (§7.D).
4. **If there is no code-detectable outcome, put the event in
   `EXPLORATION_TOUR_EVENTS`** and let the user press "I've explored this". Do
   not reach for a timer — the 5 s `setTimeout` that used to do this is
   documented at `tourSlice.ts:106-121` along with the Sentry reports that
   killed it.
5. **Register the step in `feature-doc-map.json`'s `onboardingFlows`** with its
   `tourEvent` and its `stepFile`, and list the flow id on the entry whose
   `sourceGlobs` cover the surface the step points at. Skip this and the Stop
   hook can never nag about your step; six live steps are in that position today
   (§7.C).
6. **Run `node scripts/docs/gen-tour-anchors.mjs` and commit both artifacts** —
   and read the diff, because today that command *removes* four entries as well
   as adding 127 (§7.B).
7. **Then stop.** Navigation, spotlighting, persistence, narration, the panel,
   the progress arc and the completion screen are all driven from the registry.
   The only per-step code you should ever write is a `stepFile` component, and
   only 5 of 41 steps have one.

**The step's copy is the one thing this prescription cannot yet route
correctly**: `title`/`description`/`hint`/`narration` are English literals in the
slice, and there are 432 of them (§7.E). Write them there because that is where
they go; know that you are writing English into a 14-locale app.

---

## §7 Deviations

### The population, counted twice

| Quantity | Impl 1 (structural: brace-match + evaluate the nine `TourStepDef[]` arrays) | Impl 2 (line regex) | Reconciled |
| --- | --- | --- | --- |
| tours in `TOUR_REGISTRY` | 9 | 9 | **9** |
| steps | 44 | — | **44** |
| distinct step ids | 41 | **50** | **41** — Impl 2's `^ {4}id: "…"` also matched the nine `TOUR_REGISTRY` entries' own ids. Disagreement resolved by opening all nine. |
| sub-steps | 129 | 129 | **129** |
| `highlightTestId` sites | 47 | 47 | **47** |
| distinct anchors | 32 | 32 | **32** |
| frozen English copy strings | 414 step-level + 18 registry-level | 432 | **432** |

Three step ids are shared between the Power and Starter getting-started tours
(`appearance-setup`, `credentials-intro`, `persona-creation`) — deliberately, so
`TIER_PARTNER` (`:1233`) can migrate progress across a tier switch. That is
correct and is why 44 steps yield 41 ids.

### 7.A — P0: the resume pointer does not exist, and the wrong tour resumes silently

`PersistedTourState` (`tourSlice.ts:1143-1153`) is `{version, tours: Record<TourId, …>}`.
There is no `activeTourId`. `createTourSlice` hardcodes
`const defaultTourId: TourId = "getting-started"` (`:1318`), reads *that* tour's
record (`:1319`), and initialises `tourActiveTourId: defaultTourId` (`:1379`).

Executed against a synthetic blob (`wbB-replay.mjs`, R1): a user at step 6 of 9
in `teams-orchestration` with six steps complete and `dismissed: true`, after a
reload, gets `tourActiveTourId: "getting-started"`, `currentStepIndex: 0`,
`tourStepCompleted: {}`, `tourDismissed: false`. **Their record is intact in
`guided-tour-state` and no code path reads it.** `TourLauncher` cannot recover it
either — it only ever launches `getting-started` / `getting-started-simple`
(`TourLauncher.tsx:25`); the only route back is Home → Learning →
`TourDetailModal`.

The index clamp at `:1326-1329`, which exists to survive a tour definition that
shrank between releases, is also applied only to the default tour (R4).

**Fix:** add `activeTourId` to `PersistedTourState` and bump `TOUR_STATE_VERSION`
to 5. Deferred — it changes what a live surface shows and discards existing
progress on the version bump.

### 7.B — P0: two anchor authorities, six disagreements, and a generator blind to three real authoring forms

`gen-tour-anchors.mjs` extracts with six regexes (`:66-73`) that require the
anchor in attribute position. Measured against the tree it scans (two
implementations, agreeing exactly):

| | derivable by the generator | committed in the manifest | drift |
| --- | --- | --- | --- |
| verbatim testids | **1,044** | 945 | **101 missing** |
| dynamic prefixes | **293** | 269 | **26 missing** |

101 + 26 = **127** — reproducing exactly the figure
[`client-rule-mirroring`](./client-rule-mirroring.md) §7 D5 published, and
decomposing it. The Rust twin `generated_tour_anchors.rs` holds 1,232 entries =
945 + 269 + 11 sidebar sections + 7 sub-tab setters: **the two artifacts are
byte-consistent with each other and 127 behind the tree**, which is D5's whole
point, re-measured on a different day at the same number.

**And the manifest is also four entries *ahead*.** Two testids
(`daily-goals-create`, `studio-chat-input`) and two prefixes (`companion-strip-`,
`mm-category-`) are in the committed allow-list and are **no longer derivable**,
because the code moved to a form the generator cannot read:

| Anchor | How it is written now | Which regex fails |
| --- | --- | --- |
| `daily-goals-create` | `data-testid={editing ? 'daily-goals-save' : 'daily-goals-create'}` (`DailyGoalsModal.tsx:140`) | `data-testid=\{'(…)'\}` requires the closing brace after the quote |
| `studio-chat-input` | `inputTestId="studio-chat-input"` (`StudioChatInput.tsx:172`) | `testId="…"` is not a substring — the alias capitalises the `T` |
| the six Obsidian panels | `OBSIDIAN_PANEL_TESTID` const map at `ObsidianBrainPage.tsx:33-38`, consumed at `:58` as `data-testid={MAP[tab]}` | no regex matches a computed member expression |

So running the generator today **narrows the allow-list**, and the four it drops
are anchors that render. The Obsidian six are the live cost: the Brain tour uses
them at `tourSlice.ts:797, :812, :828, :843, :858, :873, :888` (7 sites, 6
distinct), and `isKnownAnchor()` (`dynamicTours.ts:44-48`) returns `false` for
every one — so a composed tour naming any Obsidian panel is rejected outright
(`:144`, `:190`: one bad step rejects the whole tour). **Athena cannot compose a
walkthrough of the plugin whose own hand-written tour is eight steps long.**

The comment at `ObsidianBrainPage.tsx:25-30` is the sharpest part: the const map
exists *because* "a template literal is invisible to a source-text search and is
exactly how this drift went undetected before." The author fixed the drift test
and did not know there was a second scanner with different rules.

Upstream: `gen-tour-anchors.mjs` is registered in no codegen task and has no
`--check` mode — [`codegen-task-registration`](./codegen-task-registration.md)
§7.A and the `unverifiable-generated-artifact` census rule already own that.
What is new here is that its blindness has a *direction*: it under-reports the
allow-list Athena is validated against, which fails closed and is therefore
invisible — nobody files a bug when a feature they never tried is refused.

### 7.C — P1: the tour-flow registry is incomplete in both directions

`feature-doc-map.json`'s `onboardingFlows` declares **38** flows against **41**
live step ids:

- **6 live steps are registered nowhere** — `first-execution`, and the five
  Obsidian tab steps `obsidian-{sync,browse,graph,cloud,revitalize}-tab`. A step
  with no registry entry cannot appear in any entry's `onboardingFlows` array,
  so `check-doc-sync.mjs`'s onboarding check can never name it. **This is the
  binding-drift shape**: an absence, invisible to a gate that only looks at what
  changed.
- **3 registry entries name no live step** — `desktop-discovery`,
  `obsidian-tab-walk`, `template-picker`. These nag about flows that do not
  exist; two of the three have a real `stepFile`, so the reminder points at a
  component that is not a tour step.
- **Only 17 of the 37 doc-map entries declare `onboardingFlows` at all.** For
  the other 20, a source change can never trigger the onboarding half of the
  Stop hook regardless of what it touches.

### 7.D — P1: the event union closes typos and not orphans, in both directions

`TOUR_EVENTS` (`:52-102`) is a 37-member union, added expressly so that "a typo
in any of these strings used to fail open" becomes a build error (`:38-51`). It
does that. It does not close either orphan direction, and both exist:

- **A producer with no consumer.** `tour:persona-draft-ready` is emitted at
  `storeBusWiring.ts:116` on the build session's `draft_ready` phase, and is the
  `completeOn` of **no step**. `emitTourEvent` (`:1530-1538`) compares it against
  the current step and drops it. A real signal, wired end to end, arriving
  nowhere.
- **A member with neither.** `tour:plugin-enabled` appears twice in the slice
  (`:72` in the union, `:137` in `EXPLORATION_TOUR_EVENTS`) and nowhere else in
  `src`. It is emitted by nothing and consumed by nothing.

`tour:composed-step-explored` is the third member with no static consumer and it
is **correct** — it is `COMPOSED_STEP_EVENT` for dynamic tours
(`dynamicTours.ts:32, :129`). Distinguishing those three is why the count of
"unused events" is 2 and not 3.

### 7.E — P1: 432 English strings, and the count two published paths give are both partly wrong

`tourSlice.ts` holds **432** user-facing English literals across
`title`/`description`/`hint`/`narration`/`label`, at 9 tours × 2 + 44 steps ×
(title, description, hint, ±narration) + 129 sub-steps × (label, hint). Both
implementations land on 432 by different routes (structural walk: 414 + 18
registry; line regex: 432 directly).

- [`multi-step-flow`](./multi-step-flow.md) §7 D1 — *"432 user-facing strings
  frozen inside tourSlice.ts"* — **confirmed exactly.**
- [`i18n-string-authoring`](./i18n-string-authoring.md) §7.C — *"**53 tour
  steps** and **~350** English copy strings"* — **both numbers need correcting.**
  There are **44** steps; 53 is the number of `title:` literals, which is 44
  steps + 9 registry entries. And 350 undercounts by 82, because it does not
  count the 129 sub-step `label`s. See §12.2.

`en.json`'s `onboarding` section has **174** keys, all translated into 13
locales, and not one of them is a step title — while `GuidedTour.tsx` renders
`{tourDef.title}` at `:457` and `{tx(t.onboarding.tour_step_of, …)}` at `:458`,
adjacent lines, one raw and one localized. That framing is
`i18n-string-authoring`'s and it is right; only the arithmetic moves.

There is a second, quieter half: those 174 translated keys **do not load on 10
of the 11 routes**, because `onboarding` is declared only on `home` while the
tour mounts above the router. See
[`first-run-onboarding`](./first-run-onboarding.md) §7.E.

### 7.F — P2: a tour whose definition did not survive the reload is badged complete

`registerDynamicTour` writes into `globalThis.__personasDynamicTours`
(`:1014-1019`) — in memory, and by design ("Module-level rather than store state
so the resolution helpers stay synchronous"). Progress for `athena-*` ids *is*
persisted and carefully carried across persist cycles (`:1354-1359`). So after a
reload the app holds a composed tour's cursor and cannot resolve its steps.

Executed (`wbB-replay.mjs`, R2): with `getActiveTourSteps()` returning `[]`,
`advanceTour` computes `nextIndex (1) >= steps.length (0)` → `allDone =
[].every(…)` → **`true`** → `finishTour()` → `tourCompleted: true`,
`tourStepCompleted: {}`, and `tourCompletionMap[id] = true`. The Learning
board's `{completed}/{total}` counter then includes it. R2b shows the same for
any static tour id removed from `TOUR_REGISTRY` between releases.

The render side has the identical defect at `GuidedTour.tsx:89` —
`const allCompleted = visibleSteps.every((s) => completedSteps[s.id] ?? false)`
over the same empty array — so the panel shows its completion screen for a tour
it could not load. Two independent code paths, one vacuous truth. Both are
matched by the census rule this leaf shares with
[`setup-checklist`](./setup-checklist.md) §9.

### 7.G — P2: the anchor-drift gate's corpus is loose by construction, and today it costs nothing

`tourAnchors.test.ts` builds its corpus from every `.ts/.tsx` under `src`
excluding `*.test.*`, `*.spec.*` and `tourSlice.ts` (`:49-59`), then passes an
anchor on `corpus.includes(anchor)` (`:78`). At least six files in that corpus
merely *name* anchors without rendering them: `tourConstants.ts`,
`test/automation/bridge.ts`, `companion/guidance/anchorCatalog.ts`,
`companion/guidance/walkthroughs.ts`, `companion/chat/athenaChatNavigation.ts`,
`home/sub_learning/powerMoves/registry.ts`. An anchor named only there would
pass.

**Measured, and the answer is a cleared claim: 32 of 32 anchors pass with those
six files removed from the corpus — 0 anchors depend on a declaration-only
hit.** The looseness is latent. Recorded because a cleared claim is worth as much
as a confirmed one, and because the fix is three lines (extend the exclusion
list) and buys a real guarantee cheaply.

The two anchors with no direct attribute site — `design-subtab-use-cases`,
`editor-tab-lab` — are correctly accepted by the test's rule 2: they render via
`data-testid={`design-subtab-${tab.id}`}` (`DesignHub.tsx:79`, with
`{ id: 'use-cases' }` at `:46`) and `data-testid={`editor-tab-${tab.id}`}`
(`EditorTabBar.tsx:111`, with `{ id: 'lab' }` at `:19`). This is where my two
implementations disagreed and hand-verification decided it — see §12.3.

### 7.H — the convergence oracle, and it is the good direction for once

Effective independent cohort for this leaf: **three** (`brainiac`, `vibeman`,
`ascent`; `personas-cloud` has zero `.tsx` files; `personas-web` is a port —
identical `TourIntroCard.tsx` / `TourLauncher.tsx` file names, identical
`@/i18n/useTranslation` import specifier, identical 14-locale set).

- `brainiac`: no in-app tour at all. `vibeman`: none — no anchor attribute
  convention exists in the repo.
- `ascent`: hand-rolled, `data-tour="…"`, **6 steps against 4 anchor sites** —
  steps 2 and 6 both re-use `modules-nav` because their own pages have no
  anchor. No build-time validation; `useTourEngine.ts:69` polls
  `tries++ < 120` then gives up silently.
- `personas-web` (port): hand-rolled, `data-tour-diagram="…"`, ~20 anchor sites,
  **no build-time validation** — and `tour-script.ts:83` says the mitigation out
  loud: *"May appear only after lazy hydration; the spotlight polls until it
  exists."* Two of ~20 anchors are covered by an e2e assertion.

**Personas is the only repo in the cohort with build-time tour-anchor
validation, and it is the one practice the port dropped.** Stated as
self-comparison: this is the corpus's second sighting of the
port-lost-the-safety-mechanism shape (the first was the scheduler's
compare-and-set) and it is the strongest argument in this document for §2.2 —
the mechanism reads like bookkeeping, so a careful engineer did not carry it
across. Keep it, and fix its blind spots rather than trusting it blindly.

---

## §9 Rule or decline

### 9.1 Declined: a census rule on anchor drift

The condition is *"every anchor a tour names is derivable by the generator."*
That is an **inventory** comparison between two artifacts, not a count of
something present, and the census explicitly cannot express it. It is also
already gated — badly in one direction, well in another — by two existing
instruments, and the honest §9 is to fix those rather than add a third.

I checked for overlap and am not proposing rules against:
`unverifiable-generated-artifact` (scripts, 10 files — already owns
`gen-tour-anchors.mjs`'s missing `--check`), `frozen-ui-copy-constant`
(62 files / 818 matches — already covers §7.E's 432 literals; a tour-specific
rule would be a strict subset at the site level), `comment-kept-cross-language-mirror`
(37 files), `raw-web-storage` (72 files).

### 9.2 Specified instead: three edits to instruments that already exist

1. **`gen-tour-anchors.mjs` — add three extraction forms** (a `const` map whose
   name matches `/TESTID|TEST_ID/`, ternary arms inside `data-testid={…}`, and
   `[A-Za-z]+TestId="…"`), then add `--check`. This is the edit that makes the
   two authorities agree; it converts 127 + 4 of drift into a diff a human reads
   once.
2. **`tourAnchors.test.ts` — extend the corpus exclusion** from
   `["tourSlice.ts"]` to include the six declaration-only files in §7.G, so the
   gate proves a *render* rather than a mention. Costs nothing today (32/32
   still pass) and closes the hole before it opens.
3. **A registry-completeness assertion**, wherever `check-doc-sync.mjs` already
   parses `feature-doc-map.json`: import `TOUR_REGISTRY`, diff the step ids
   against `Object.keys(onboardingFlows)` both ways, and **exit 2 if either the
   registry or the tour list comes back empty** — the fail-loud precondition,
   because a scanner that silently sees zero steps passes forever. Today it
   reports 6 and 3 (§7.C).

### 9.3 Published: the shared rule, owned next door

The one countable condition this leaf produces is the vacuous completion in
§7.F, and it is not tour-specific — it is the same defect as a checklist
reporting 100 % with nothing in it. The rule is published in
[`setup-checklist`](./setup-checklist.md) §9 as **`vacuous-all-done-verdict`**
(baseline 15 files / 15 matches; positive control 16/16; the pair partitions all
31 `const all*/is*/has*/every* = … .every(` bindings in `src`). Two of its 15
sites are this leaf's: `tourSlice.ts:1493` and `GuidedTour.tsx:89`.

**Prefer the type over both.** The generalisable fix is to stop `advanceTour`
from being able to ask an empty array a question: make the resolver total —
`getActiveTourSteps(id): NonEmptyArray<TourStepDef> | null` — so an unresolvable
tour is a `null` the caller must handle, not a `[]` that answers `true` to
everything. That removes §7.F at both sites permanently; the census rule is the
ratchet that holds the line until it lands.

---

## §12 Corrections

### 12.1 `convergence: "converged"` — FAILS, direction inverted (15th test, 15th failure)

Zero of three independent siblings has a validated tour anchor; two of the two
that have tours at all ship a silent poll-and-give-up. The label points at a
practice **only this repo has**, so a brief that read `converged` as "the fleet
agrees, adopt the common shape" would have adopted the disease. `sides: "client"`
holds, for the same structural reason as
[`first-run-onboarding`](./first-run-onboarding.md) §12.1 — the server never sees
the DOM the spotlight queries.

### 12.2 A correction owed to [`i18n-string-authoring`](./i18n-string-authoring.md) §7.C

Its two headline numbers for `tourSlice.ts` are *"53 tour steps"* and *"~350
English copy strings"*. Measured twice: **44 steps** (53 is `title:` literals =
44 steps + 9 `TOUR_REGISTRY` entries) and **432 strings** (350 omits the 129
sub-step `label`s). The section's argument is unaffected and its framing of the
adjacent-lines defect at `GuidedTour.tsx:457-458` is exactly right — but a later
brief will carry those numbers forward, and 432 is also the number
[`multi-step-flow`](./multi-step-flow.md) §7 D1 independently published, so the
corpus currently disagrees with itself by 82.

### 12.3 A correction to my own first measurement, and it is the doctrine's own trap

My first implementation replicated `gen-tour-anchors.mjs`'s regexes verbatim —
deliberately, to measure drift against its own algorithm — and reported **"7
tour anchor sites are dead in the tree."** They are not dead; they are the six
Obsidian panel anchors, and they render.

**A measurement whose instrument is a copy of the thing under test inherits its
blind spots and reports them as facts about the world.** The second
implementation used a different question (does this literal appear, quoted,
anywhere) and found them immediately. The doctrine's "two passes can agree
because both searched the same wrong place" has a sharper form here: *one pass
WAS the wrong place.* The disagreement between the two is what produced §7.B,
which is a better finding than the false one it replaced.

The reverse also happened in the same run and is worth recording: Impl 2
reported `design-subtab-use-cases` and `editor-tab-lab` as having no render
site, because they are template-interpolated and it searched for quoted
literals. Neither implementation was right alone; both false negatives were
resolved by opening the file.

### 12.4 On the brief's lead

The brief asked whether the tour-flow registry is complete, on the hypothesis
that "a flow registered nowhere is invisible to that gate by construction."
**Confirmed, and the gap runs both ways**: 6 live steps unregistered, 3 registry
entries with no step, and 20 of 37 doc-map entries declaring no flows at all
(§7.C). The brief did not anticipate the second, larger authority gap — the
manifest — which is where the live cost is.
