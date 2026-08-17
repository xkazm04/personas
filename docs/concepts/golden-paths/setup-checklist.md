# Setup checklist

> Situation node: `client-runtime/flows-and-onboarding/setup-checklist` ·
> [situation spine](../situation-spine.md) · recurrence **9** · risk **low** ·
> sides `client` · convergence `mixed` · dimensions function · ui · performance ·
> `twoSided: false` · mergedFrom *"Adoption checklist probes"* + *"Readiness
> completion score"*
>
> **Short form** (Mode 2 tiering: `risk: low`). The quality core is unchanged —
> two implementations per count, a positive control that partitions its anchor,
> private-registry validation, hand-verified precision, re-extraction from the
> finished document.
>
> Composed 2026-08-17 against `master` @ `2a874e692`. ~20 checklist / readiness
> surfaces enumerated; `setupSlice.ts`, `SetupCards.tsx`, `WelcomeLayout.tsx`,
> `useTwinReadiness.ts`, `passportDerive.ts`, `goldenStandard.ts`,
> `adoptionReadiness.ts`, `ExtractionMenu.tsx`, `powerMoves/*`,
> `OnboardingProgressBar.tsx` read directly. 4,397 production files instrumented,
> twice. Five sibling checkouts swept.

---

## §0 Headline

**The one probe in this repo that guards against a checklist lying is a comment
in a harvest menu, and the largest checklist in the tree has been unreachable
for 85 days after being deleted once for exactly that reason.**
`ExtractionMenu.tsx:57` writes `const complete = ratio.done === ratio.total &&
(ratio.pct ?? 0) >= 80` and explains itself — *"12/12 scopes on its own would
read as done even when every one of them was skimmed."* That is the whole
doctrine of this leaf in one line, and it appears once. Meanwhile
`home/sub_welcome/SetupCards.tsx` — 628 lines, a three-card Role → Tool → Goal
checklist with a stepper, per-card completion badges and cascade locking — has
**zero render sites**; its `dismissSetup()` action has **zero callers**, so its
`setupCompleted` flag can never become true; and the only two live writers of
its output are two `setSetupGoal('')` **clears** in `UnifiedBuildEntry.tsx`. It
was deleted on 2026-05-12 with the commit message *"refactor(home): delete
orphan SetupCards.tsx (625 LOC)"* and re-created at a new path twelve days later
by the home redesign, still orphaned, still persisting four fields into
`persona-ui-system` on every launch.

The generalisable finding underneath both: **a checklist is a claim about the
world, and this repo has two populations — one that re-asks the world and one
that remembers an answer.** Three families derive (twin readiness, the Passport
wall, the persona/connector resolvers). Everything on Home and in onboarding
latches. Of the latching ones, three can display "complete" with the condition
false, and **15 sites across the whole tree bind an all-done verdict to
`.every(…)` with no non-emptiness guard**, so an empty collection reports that
everything is finished.

---

## §2 The one way

**Compute each item's done-ness from live state every time the checklist
renders, and never store the answer.** Concretely:

1. **Write the probe as a pure function of fetched state**, not a boolean the UI
   sets when the user does something. `bio.trim().length >= BIO_MIN_CHARS`
   (`useTwinReadiness.ts:63`) is a probe; `done[id] = true` on click
   (`powerMovesStore.ts`) is a memory. A probe un-ticks when the user deletes
   the thing; a memory cannot, and the 2026-08-17 purge is what that costs.
2. **Guard every rollup against the empty set, and say what empty means.**
   `[].every(f)` is `true` and `0/0` is `NaN`. Decide deliberately whether "no
   items" is complete or unknown, write the guard, and if the answer is
   "complete", write the comment explaining why — the way
   `ConnectorReadiness.tsx:24` does (`if (statuses.length === 0) return 'ready'`,
   with four lines of rationale above it).
3. **Do not let a rollup outrank its own items.** If any item is not done, the
   score is not 100 %. A weighted sum capped with `Math.min(100, …)`, a target of
   zero scoring full credit, and an item excluded from the total are all ways to
   print 100 % over a false probe — and all three ship here (§7.C).
4. **Persist an id, never a display string.** If the checklist stores the user's
   answer at all, store the stable key. `SetupCards` stores the *localized
   label* and recovers the role by comparing it back against the current
   locale's labels (`:121`, `:187`, `:491`) — so a language switch orphans the
   saved answer, and the code says so in a comment rather than fixing it.
5. **Give every incomplete item a jump-to-fix that lands on the control.**
   The Passport wall's `ImproveCell` (`improve/ImproveCell.tsx:19-52`) is the
   full form: a cell is clickable only when an action applies to it, and the
   action opens the surface that fixes it. Half the surfaces here render a
   remediation *sentence* and no destination.
6. **Decide the disappearance rule up front, and derive it too.** "Hide when
   complete" and "stay visible and go green" are both defensible; a *third*
   flag that decides it independently of the items is not — `SetupCards`
   returns `null` on `setupCompleted`, which is decoupled from its own three
   values in both directions (`:582` vs `:319-323`).
7. **Then stop.** No new checklist primitive is needed and none should be
   written; the deviations below are all in the *derivation*, never in the
   rendering.

---

## §7 Deviations

### The population

Twenty checklist-shaped surfaces were enumerated. They split cleanly:

| | Surfaces | Done-ness |
| --- | --- | --- |
| **Derived** — re-asked every render | twin readiness (`useTwinReadiness.ts`, `readinessGaps.ts`, `CompleteTwinChecklist.tsx`, `ReadinessGapPopover.tsx`, `ProfilesAtelier.tsx`), the Passport wall (`passportRows.ts` ~26 rows + `passportDerive.ts` + `goldenStandard.ts` 13 dimensions), `usePersonaReadiness.ts`, `adoptionReadiness.ts`, `useBuild.ts` (8 Glyph cells), `capabilityHelpers.ts` (6 fields), `shipModel.ts`, `checkFieldCompleteness`, `ExtractionMenu.tsx` | a live expression |
| **Latched** — a stored answer | `OnboardingProgressBar` (5 steps), `SetupCards` (3 cards), Power Moves (12 quests), `HomeLearning` (9 tours) + `tourSlice`, `SetupStatusBadge` / `TeamReadinessChip` (a DB column), `StudioChecklistStepper` (backend-authored phases) | a persisted boolean |

**Every user-facing checklist on Home and in onboarding is in the second
column.** That is the shape of the problem, not a coincidence: those are the
surfaces whose items are *actions the user took*, and an action is easy to
remember and hard to re-probe.

### 7.A — P0: the largest checklist in the tree has no render site, and was deleted once for being one

`src/features/home/sub_welcome/SetupCards.tsx` — 628 lines, `export default
function SetupCards()` at `:574`. Measured with ripgrep across all of `src`, the
identifier appears in exactly five places: its own definition, three prose
comments (`setupSlice.ts:7,10,42`, `UnifiedBuildEntry.tsx:133`) and one docs
table (`onboarding/README.md:117`). `WelcomeLayout.tsx` renders
`SinceYouLeftBriefing`, `ResumeBanner`, `HeroHeader`, `WelcomeGetStarted`,
`NavigationGrid`, `LanguageCards` — and has **never referenced `SetupCards` in
any commit reachable from any ref** (`git log --all -S`, empty).

The history is the finding:

- **2026-05-12, `1632da4ec`** — *"refactor(home): delete orphan SetupCards.tsx
  (625 LOC)"*, removing `src/features/home/components/SetupCards.tsx`. Someone
  measured this exact thing and acted on it.
- **2026-05-24, `948be771a`** — *"feat(home): redesign Welcome/Cockpit/Learning
  + finish §C2 sub_\* split"* re-creates it at
  `src/features/home/sub_welcome/SetupCards.tsx`. Its parent
  (`2e610454`) does not contain the file. Still orphaned.
- **85 days later** it is still there, still orphaned, and `setupSlice.ts:9`
  still says *"Live consumers (verified 2026-05-05)"* — a verification stamp
  dated **seven days before the deletion that proved it wrong.**

Downstream consequences, all live:

- **`dismissSetup()` has zero callers.** `setupCompleted` can therefore never
  become `true` — and the slice documents the opposite (`:41-43`: *"True once
  the user has dismissed the setup cards (clicked X or finished the stepper)"*).
  The stepper's X calls `onClose` → `setStepperOpen(false)` (`:361`); Finish
  commits the three drafts and calls `onClose` (`:337`). Neither dismisses.
- **`setSetupRole` / `setSetupTool` have zero live callers** outside the orphan.
  The only live writers of `setupGoal` are `UnifiedBuildEntry.tsx:259` and
  `:405`, both `setSetupGoal('')` — **the app can clear this value and cannot
  set it.**
- **Four fields are still persisted** on every launch (`systemStore.ts:88-91`),
  and `UnifiedBuildEntry.tsx:139-146` still reads `setupGoal` to pre-fill the
  agent-build intent box while onboarding or a tour is active. So a user who
  used the cards before 2026-05-12 still has a value in `persona-ui-system` that
  silently seeds their build intent today. **A deleted feature's persisted
  output still drives a live surface** — the exact hazard
  [`view-state-persistence`](./view-state-persistence.md) describes, in its
  purest form: the writer no longer exists and the reader does.

**Deferred, not applied.** Deleting the component is a zero-consumer deletion and
would be allowed; deleting the four persisted fields is not, because
`UnifiedBuildEntry` reads one of them and the operator may have a live value.
The correct order is: delete `SetupCards.tsx`, delete the two dead setters and
`dismissSetup`, keep `setupGoal` and its two clears until the read at
`UnifiedBuildEntry.tsx:146` is retired, then drop all four from `partialize`.

### 7.B — P1: 15 all-done verdicts that are `true` for an empty collection

Two implementations agreeing exactly on membership (63 `.every(` sites in 4,397
production files, `onlyIn1` and `onlyIn2` both empty; one guardedness
disagreement, resolved by hand at `ScheduleTimeline.tsx:39` — a deep-equality
helper where vacuous truth is correct). Narrowed to verdict-shaped bindings, the
census rule in §9 reports **15 violating and 16 compliant, partitioning all 31**.

The ones that reach a user:

| Site | What empty produces |
| --- | --- |
| `stores/slices/system/tourSlice.ts:1493` | a tour whose steps cannot be resolved is **marked 100 % complete** and badged done — executed, see [`guided-tour-step`](./guided-tour-step.md) §7.F |
| `onboarding/components/GuidedTour.tsx:89` | the same tour's panel shows its **completion screen** |
| `overview/components/health/useHealthChecks.ts:87` | zero resolved health sections → `hasIssues = false` → **the health surface reports healthy on no data** |
| `overview/components/health/StatusIndicators.tsx:18` | a section with no checks renders the "inactive/info" dot |
| `agents/sub_deployment/.../CloudConnectionForm.tsx:161` | a diagnostics run that produced no steps reads as **all passed** |
| `lib/harness/orchestrator.ts:215` | an area with zero features reports `pass` |
| `overview/sub_manual-review/.../ReviewFocusFlow.tsx:177` | an empty decision set is "all decided" |
| `hooks/design/credential/negotiatorStepGraph.ts:55` | a step with no fields is "filled" |
| `agents/quick-answer/triage/triageAdapters.ts:1002` | a card with no answerable fields is deferred; the comment above reasons carefully about the *mixed* case and never mentions the empty one |
| `shared/components/forms/TableSelector.tsx:47` | select-all inverts on an empty list — **and the same file guards the sibling verdict correctly at `:59`** |

`TableSelector.tsx` is the argument for the gate in one file: two verdicts, ten
lines apart, one guarded and one not, written by the same person on the same day.

### 7.C — P1: four ways to print 100 % over a false probe

1. **A vacuous early return.** `adoptionReadiness.ts:56` — `if
   (structuredCategories.length === 0) return 100;` and again at `:66`/`:69` for
   an empty connector list. A template whose connector spec fails to parse
   scores **Ready**. `readinessTier` (`:74-78`) then maps 100 → "Ready", so the
   worst-understood templates present as the best-prepared.
2. **A target of zero scoring full credit.** `goldenStandard.ts:127` — `const
   progress = target > 0 ? Math.min(1, current / target) : 1;`. A solo-project
   archetype whose `evals.target` is 0 scores 100 % of the evals dimension with
   zero evals. The rubric is 13 weighted dimensions
   (`goldenStandard.ts:26-99`), so this silently inflates `goldenPct`.
3. **A capped sum with an excluded dimension.** `passportDerive.ts:206-217`
   (`autoScore`) and `:250-257` (`prodScore`) are `Math.min(100, Σ …)`, and the
   `designSystem` dimension is deliberately left out of `autoScore` with the
   reasoning at `:196-200`. A wall can read 100 while a listed row is red. The
   wall does carry `autoBlockers` / `prodBlockers` (`:260-271`) as the honest
   gap list — which is the right mitigation and is why this is P1 and not P0.
4. **Counting the click instead of the outcome.** `PowerMovesPanel.tsx:18` —
   `POWER_MOVES.filter((m) => done[m.id] || tried[m.id]).length` over 12 quests.
   `tried` is set by pressing "Try it". **12/12 is reachable without configuring
   anything**, and only 1 of the 12 has a `detect()` probe at all
   (`registry.ts:133-136`), which is skipped once `done` (`usePowerMoveDetection`
   `:38`) and never un-set (`:29-31`: *"once earned, a move stays done"*).

### 7.D — P1: the checklist persists a translated string as its key

`SetupCards.tsx` stores `setupRole` as `setup[role.labelKey]` — the **localized
label** (`:121`, `:129`) — and recovers the role definition by comparing the
stored string back against the current locale's labels (`ToolStep` `:187`,
`SetupCardItem` `:491`). Switch language after answering and: the card title
still shows the old-locale string (`:487` `displayTitle = value`), the role
illustration disappears (`roleDef` is `undefined`), and step 2 offers **zero**
tools (`tools = roleDef?.tools ?? []`).

The code knows: `:118-120` — *"The store persists the localized role label;
comparison is consistent within a single locale. Locale-switching after setup is
an existing pre-condition issue tracked separately."* In a 14-locale app with a
language picker on the same page (`WelcomeLayout.tsx:66`), "consistent within a
single locale" is not a property this surface has. The fix is `role.id`, which
already exists (`:28`, `:37`, `:46`) and is never stored.

Latent only because §7.A means nothing renders it — but the pattern is the one
to name, because it is what a future checklist will copy from the file that is
still in the tree.

### 7.E — P2: a progress bar destroyed by the progress it measures

`OnboardingProgressBar.tsx:26` — `if (onboardingCompleted || personas.length > 0)
return null;`. Step 4 of the five-step flow it renders is `adopt`, which creates
a persona. So the bar shows 3/5, the user adopts a template — the flow's own
success — and the bar vanishes with two steps left. The rollup itself is honest
(`:30-31`, `completedCount / 5`, rendered as both `{n}/5` and a percentage
bar); the *visibility* predicate is derived from an artifact the checklist
produces. §2.6.

### 7.F — the exemplar, and the oracle

**The one site to copy is `overview/sub_patterns/ExtractionMenu.tsx:57`:**

```
const complete = ratio.done === ratio.total && (ratio.pct ?? 0) >= 80;
```

— with the comment that "12/12 scopes on its own would read as done even when
every one of them was skimmed." It is the only place in the tree where someone
wrote down that a count reaching its denominator is not the same as the work
being done, and then encoded a second condition. Every other rollup here trusts
its own arithmetic.

**Convergence.** Effective independent cohort: **three** (`brainiac`, `vibeman`,
`ascent`; `personas-cloud` has zero `.tsx` files; `personas-web` is a port and
its only "checklist" is a documentation MDX block). Result is genuinely
`mixed` — the spine label's least falsifiable value, so this is not a strong
upholding:

- **`ascent` derives, and wrote the doctrine down**:
  `OnboardingChecklist.tsx:3-6` — *"Completion is derived from signals the app
  already has … pure orchestration, no new backend."* Two call sites, both
  derived from `listWatchedRepos()`. **And it ships one hardcoded
  `{ label: "View cross-repo analysis", done: false }`** (`OnboardingFlow.model.ts:69`),
  so its rollup can never reach 100 %. The best derivation in the fleet still
  has a lie in it — which is the argument for §2.3 rather than against §2.1.
- **`vibeman` latches booleans back-filled from polled queries**
  (`useOnboardingConditions.ts:71,97,137` fetch `/api/contexts`, `/api/ideas`,
  `/api/goals`; `onboardingStore.ts` stores the result), with `resetOnboarding`
  (`:162`) exposed in no UI. A tick that cannot un-tick when the data is
  deleted — the worst of both halves.
- **`vibeman` also ships a second, dead checklist**:
  `src/components/onboarding/{ModuleProgressBar,NextActionBanner,ProgressCelebration}.tsx`,
  806 LOC, exported from `index.ts:9-18` and imported by nothing, sitting beside
  the mounted one. **That is §7.A's exact shape in a second repo.** Under the
  one-author confound this is weak evidence about physics and strong evidence
  about *ergonomics*: a checklist is a self-contained component with no
  compile-time consumer, so nothing tells the author it stopped being rendered.
  Two repos, same author, same orphan, neither noticed.
- **`brainiac`** has no scored checklist at all — its first-run page is a
  three-item *instruction* list with no done markers (`FirstRun.tsx:106-134`),
  deliberately, because the page disappears wholesale when `canonical > 0`.
  A silence, reported as a silence: the cheapest way to avoid a lying checklist
  is not to have one.

---

## §9 The published rule

### 9.1 `vacuous-all-done-verdict`

**Condition the signal is a proxy for:** an all-done / all-ready verdict
computed by a universal quantifier over a collection that may be empty, where
the empty case is not handled. The signal keys on this repo's idiom —
`const all*/is*/has*/every* = … .every(` — and an adopting repo must re-derive
its own proxy for the same condition (§9.3).

```json
{
  "id": "vacuous-all-done-verdict",
  "goldenPath": "docs/concepts/golden-paths/setup-checklist.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bconst\\s+(?:all|is|has|every)[A-Za-z0-9_$]*\\s*=\\s*(?![^;\\n]{0,100}(?:\\.length|\\bhas[A-Z]|\\bsize\\b))[^;\\n]{0,100}?\\.every\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An all-done / all-ready verdict bound with .every() and no non-emptiness guard in the same statement. [].every(f) is true, so an empty collection reports 'everything is finished': a tour with no resolvable steps is badged complete, a health panel with no checks reports OK, a diagnostics run that produced no steps reads as passed."
  },
  "exclude": [],
  "baseline": { "files": 15, "matches": 15 },
  "floor": 4000
}
```

```json
{
  "id": "vacuous-all-done-verdict-positive-control",
  "goldenPath": "docs/concepts/golden-paths/setup-checklist.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bconst\\s+(?:all|is|has|every)[A-Za-z0-9_$]*\\s*=\\s*[^;\\n]{0,100}(?:\\.length|\\bhas[A-Z][A-Za-z0-9_$]*|\\bsize)[^;\\n]{0,40}&&[^;\\n]{0,100}?\\.every\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the compliant form: the same verdict binding, guarded by a non-emptiness test (.length, .size, or a named has* flag) before .every(). Violating + compliant partitions every `const all*/is*/has*/every* = … .every(` binding in src."
  },
  "exclude": [],
  "floor": 4000
}
```

**Validation** (private scratch registry, this rule and its control only; the
full registry was not run):

- `vacuous-all-done-verdict` — **15 files / 15 matches**, 4,801 files walked,
  floor 4,000.
- `vacuous-all-done-verdict-positive-control` — **16 files / 16 matches**.
- **The control partitions the anchor**: 15 + 16 = **31**, which is every
  `const all*/is*/has*/every* = … .every(` binding in `src`. `TableSelector.tsx`
  appears in both (`:47` violating, `:59` compliant), which is the partition
  working at site level rather than file level.

**Hand-verified precision: 13/15.** All fifteen were opened. The two false
positives are `overview/sub_knowledge/components/KnowledgeRow.tsx:80` and
`templates/sub_presets/PresetQuestionnaireForm.tsx:395`, both guarded by an
early return in the **previous** statement (`if (x.length === 0) return null;`).
That shape is structurally out of reach for a same-statement pattern, and
widening the window to reach it re-admits the false-negative direction — an
earlier draft of this pattern scored 13/17 (76.5 %) before `has[A-Z]`-flag
guards (`MessageDetailModal.tsx:886`, `CredentialPortability.tsx:62`) were moved
from the violating side to the control, where they belong.

**Overlap.** Measured at site level against the final patterns, not a draft.
Zero site overlap with any of the 178 registry rules. The nearest neighbours
were checked and are disjoint: `staged-verdict-map-collapsed` (3 files, keys on
`useState<Record<string, Verdict>>`), `unreportable-bulk-outcome` (Rust),
`estimate-typed-as-measurement` (11 files, keys on identifier names),
`unbounded-shared-table-render` (12 files).

**How it fails loudly if its own precondition is absent:** the runner's `floor`
of 4,000 fails the run when the walk sees fewer files than that (measured 4,801),
and a rule matching zero files anywhere is a structural failure. A silent drop
also fails — which matters here, because the natural "fix" is to rename the
variable rather than add the guard.

**This rule must be deleted, not baselined at 0, if it ever reaches zero.** The
census cannot express "must be zero"; a rule with no matches fails structurally.

### 9.2 Prefer the type — three of the fifteen become unspellable

A gate counts this; a signature removes it. Two forms, both available here:

- **A total resolver.** `getActiveTourSteps(id): NonEmptyArray<TourStepDef> | null`
  instead of `TourStepDef[]` makes `tourSlice.ts:1493` and `GuidedTour.tsx:89`
  fail to compile — the caller must handle "no steps" rather than receive `[]`
  that answers `true` to everything. Q5 form: withhold the dangerous value, do
  not demand a guard.
- **A checklist helper that owns the empty case.**
  `allDone<T>(items: T[], p: (t: T) => boolean): boolean` returning
  `items.length > 0 && items.every(p)` concentrates the decision once. But note
  **Q1**: it encodes only *non-emptiness*, not *sufficiency* — it would not have
  produced `ExtractionMenu.tsx:57`'s `pct >= 80` second condition, which is the
  actually interesting guard. A helper is the floor, not the answer.

Neither type reaches §7.C's four inflation modes: those live in arithmetic
(`Math.min(100, …)`, `target > 0 ? … : 1`, an excluded dimension, a click
standing in for an outcome), and the compiler has nothing to say about a number.
That is where the census rule genuinely earns its place, and it is also why §9
does not claim to cover the leaf.

### 9.3 What an adopting repo should re-derive

The signal above keys on `const all…= ….every(`. `ascent`'s equivalent defect is
`{ done: false }` written as a literal in a step array
(`OnboardingFlow.model.ts:69`); `vibeman`'s is a persisted `completedSteps`
record with a `resetOnboarding` nobody can call. **Neither would match this
pattern, and both are the same condition.** Per the contract's manifestation
rule, port the intent — *find the place where done-ness stops being a question
about the world* — and write your own proxy.

---

## §12 Corrections

### 12.1 `convergence: "mixed"` — holds, weakly, and the label is the wrong instrument

Two of three independent siblings have a checklist; they disagree with each
other (derived vs latched) and each carries a defect the other does not.
`mixed` is technically correct and carries no information: it is the value a
label takes when the clauses point different ways, which is the condition
[`cross-device-pairing`](./cross-device-pairing.md) already showed a single enum
field cannot express. Counting this as an upholding would be generous; report it
as *the label did not mislead*, which is a lower bar than the one
[`ai-draft-preview-apply`](./ai-draft-preview-apply.md) cleared.

`sides: "client"` holds. Two surfaces read a **server-authored** verdict
(`SetupStatusBadge` reads the persona's `setup_status` column;
`StudioChecklistStepper` renders backend-authored phase statuses) — but in both
cases the client's contribution is rendering, and the derivation defect this
leaf is about is entirely client-side.

### 12.2 Corrections to my own brief

- **"`setup-checklist` most likely lives in `src/features/home/**` and/or
  `src/features/simple-mode/**`."** `src/features/simple-mode` **does not
  exist**. The reference is live in `.claude/CLAUDE.md:489`'s prose
  source→docs table; the authoritative `feature-doc-map.json` does not carry it,
  so nothing is mis-gated — the drift is between the map and the summary of the
  map that agents are told to read. Applied as a docs correction; see
  [`first-run-onboarding`](./first-run-onboarding.md) §7.H.
- **"A checklist that derives 'done' from a query is a different (and better)
  shape than one that persists a boolean — establish which this is."** It is
  **both, and the split is not random**: it tracks whether the item is a
  *property of the data* (twin bio length, connector presence, KPI count → all
  derived) or an *act the user performed* (pressed Try it, completed a tour step
  → all latched). The second class is the one that cannot un-tick, and the
  purge is what shows the difference.
- **"If any checklist/tour step keys off 'has ≥1 persona', it just reverted."**
  Confirmed, and the reverted set is small and specific: `OnboardingProgressBar.tsx:26`
  and `WelcomeGetStarted.tsx:41` (both `personas.length > 0`), plus
  `startOnboarding`'s guard. **None of the latched checklists reverted** —
  Power Moves, tour completion and `HomeLearning` are all persisted booleans
  that the purge could not reach. So the purge did not break the checklists; it
  demonstrated that the derived ones are the only ones telling the truth. Row
  counts are historical as of 2026-08-17 and unreproducible against the live
  file; measured against
  `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`, copied
  read-only and since deleted.

### 12.3 A correction to an assisting measurement

A sweep reported `OnboardingProgressBar`'s `onboardingStepCompleted` as
"in-memory only", having read `PersistedOnboarding` in `onboardingSlice.ts` and
found it absent. It **is** persisted, at `systemStore.ts:85`. The slice's
hand-rolled second key is not the record. Corrected in
[`first-run-onboarding`](./first-run-onboarding.md) §7.D, where the two-writer
problem is the finding.

### 12.4 A correction to this document's own first pass

The first version of §7.B reported **40 unguarded `.every(` sites of 63**. That
number is real and useless: it counts every `.every(` in the tree, including
deep-equality helpers where vacuous truth is correct, `some`/`every` pairs, and
array comparisons. Narrowing to *verdict-shaped bindings* took it to 15 with
86.7 % hand-verified precision. **A signal that fires on correct content is
worse than no gate**, and the first pass would have shipped 63 % noise.
