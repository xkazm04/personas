# Golden path — Usage analytics

> Situation node: `product-surfaces/monitoring-surfaces/usage-analytics` ·
> [situation spine](../situation-spine.md) · recurrence 12 · risk **medium** ·
> sides: **client** · convergence: **converged** ·
> dimensions: **function · security · cost**
> Composed 2026-08-17 against `master` @ `6c97502d3`; every figure re-verified at
> `c7c153b57` after a concurrent session moved master mid-composition (see the
> denominator note below). Mode-2 batch
> (`product-surfaces/monitoring-surfaces`), shared measurement pass with
> [`dev-only-diagnostics`](./dev-only-diagnostics.md) and
> [`session-delta-digest`](./session-delta-digest.md).
>
> **Sweep.** The whole tracking layer read in full — `src/lib/analytics/`
> (`index.ts` 186, `sink.ts` 118, `activation.ts` 186, `navCatalog.ts` 130,
> `summary.ts` 58, plus its three test files), `src/lib/sentry.ts` (262),
> `src/lib/telemetryPreference.ts`, `src/lib/throttledStorage.ts`,
> `src/lib/execution/middleware/analyticsMiddleware.ts`, `src/main.tsx`'s boot
> block, and every nav-store slice under `src/stores/slices/`. Both usage
> dashboards (`src/features/overview/sub_usage/`, `sub_analytics/`) and the
> engine's `parser.rs` `result` arm. Denominators cited by id from
> [`shared-facts.json`](../shared-facts.json): `frontend.tsFiles` **4,829**,
> `frontend.tsxFiles` **2,104**, `rust.files` **963** — all three re-verified
> here by running the recorded instrument
> (`node scripts/docs/measure-shared-facts.mjs`, exit 0, **no `value` line
> changed**; only the `commit`/`measuredAt` stamps moved, and the file was
> restored rather than committed).
>
> **One of those denominators moved while this was being written, and it is worth
> recording.** A concurrent session landed `3a18dae54` / `c7c153b57` — *"delete
> the unreachable `sub_canvas` tree (29 files, 3,200 lines)"* — which takes
> `frontend.tsxFiles` from **2,104** to **2,083**. Every count in this document
> was re-run at the new HEAD and **none of them moved**; only the denominator
> did. Cite `2,083` for any `.tsx` claim taken after `c7c153b57`, and re-run
> `measure-shared-facts.mjs` rather than trusting either number — this is the
> third wave running in which a shared denominator drifted under a live
> composition.
>
> **Measured by executing, not by reading.**
>
> 1. **Read-only copies of both live SQLite files** (`personas.db` 347,054,080 B
>    and `personas_data.db` 17,502,208 B, copied 2026-08-17 16:37 with their
>    `-wal`/`-shm`; the live files were never opened for write). Queried through
>    **two independent drivers** — the `sqlite3` CLI and `better-sqlite3`
>    (`readonly: true`) — which agree on every figure below.
> 2. **The nav catalog's completeness claim was tested by inventory**, not by
>    reading: two independent scanners over `src/stores/` (one on the interface
>    declarations, one on the initial-state literals) enumerate the tab-shaped
>    nav fields that actually exist, and the result is differenced against
>    `TAB_DIMENSIONS`. Script: `gp-msurf-navdims.mjs` (scratch).
> 3. **The census runner was run in a private scratch registry** over the
>    candidate rule and its control, with the results in §9. The full registry
>    was not run.
> 4. **The convergence oracle** was swept across all five sibling checkouts, and
>    the cohort was established per-leaf before counting (§6.4).

---

## 0. The headline

**The pluggable analytics sink has four consumers and all four live inside its
own directory.** `getAnalyticsSink()` is called at exactly **4** production
sites — `analytics/index.ts:38`, `:43`, `:49` and `analytics/activation.ts:127`.
Every other telemetry emitter in the application is hard-wired to Sentry:
**18 `Sentry.capture(Message|Exception)(` calls across 12 files.** The switch
that is supposed to turn usage tracking off mid-session,
`applyTelemetrySink(false)` (`sink.ts:116`, reached from
`AccountSettings.tsx:52`), therefore silences **4 of 22** emit sites.

The bypass is published by the layer's own barrel. `analytics/index.ts:162`
re-exports `trackFeature` and `trackInteraction` **straight from `../sentry`**,
under the same names, eleven lines below the sink's own exports — so a caller
who correctly imports from `@/lib/analytics` gets the unswappable door.
`ExecutionDetail.tsx:24` does exactly that;
`useOnboardingState.ts:15` reaches past the barrel to `@/lib/sentry`. Both are
type-correct, lint-clean, and outside the seam. There is no import a caller
could have written that would have been wrong, and no gate that fires.

Beside it, the second claim: `navCatalog.ts`'s docstring says the catalog gives
*"Completeness — every section and tab dimension is tracked, so coverage can't
silently drift when a new tab is added to the store."* **Six do.** Two
independent scanners find **20** tab-shaped navigation fields in the nav stores
against the catalog's **14**; `artistTab`, `companionPluginTab`, `kpisTab`,
`obsidianBrainTab`, `pendingLifecycleSubTab` and `twinTab` exist and are not
registered. The mechanism built to prevent exactly this —
`exact<T>(Record<T, true>)` at `navCatalog.ts:69`, written because the previous
`satisfies readonly X[]` accepted subsets and *"missed `mastermind` and
`missions`"* — closes the **values** of a dimension and says nothing about which
**dimensions** exist. The omission did not stop; it moved one axis over. The
session summary's `tabsTotal` denominator is **104** where the reachable
population is **122** — every "ignored tabs" figure this app has ever emitted is
computed against **85.2%** of its own surface.

And the third: the rollup those numbers ride in flushes on **`beforeunload` and
nothing else** (`index.ts:149`), in a repository whose own storage module
registers **both** `pagehide` and `beforeunload` and explains in a comment that
*"pagehide is the recommended hook … on modern browsers and Tauri webviews;
beforeunload is a desktop fallback"* (`throttledStorage.ts:41-43`) — and that
module has **zero call sites in 4,829 files**, so the only `pagehide`
registration in the app is in code nobody imports. The answer exists in this
repo, forty lines of prose deep, and reaches nothing.

None of these three is a bug in the sense a test could catch. Each is a
**claim the code makes about itself in a docstring**, unenforced, and each is
false in the direction that flatters the claim.

---

## Principle (stack-free head)

A usage-analytics layer answers one question — *which parts of this product are
used, and which are ignored* — and it is the only kind of instrumentation whose
output is **a denominator**. An error tracker that misses an error under-reports.
A usage tracker that misses a surface reports that surface as **unused**, which
is not a smaller truth but an opposite one: it is the input to a decision to
delete the feature.

That asymmetry sets four requirements, none of them about transport.

**One. Derive the tracked surface from the artifact that defines it.** Not from
a list beside it. A catalog that enumerates what to track is a second source of
truth for what exists, and the drift between them is invisible by construction:
the missing entry produces no event, and no event is exactly what "ignored"
looks like. If a registry, a router, a union or a schema already enumerates the
surfaces, the analytics denominator must be *computed from that thing*, and the
computation must fail loudly when it computes nothing.

**Two. There is exactly one door out.** Every event — nav, interaction,
conversion, rollup, error-shaped telemetry that carries usage information —
leaves through one function whose body consults the consent answer. Not a
convention, not a base class, not a lint rule: one function, and no reachable
unguarded alternative. The moment a second door exists, the consent switch
becomes a claim about the doors somebody remembered.

**Three. The event vocabulary is closed and the property values are
low-cardinality by type.** A usage event is a *shape*, not a message. Free text,
identifiers, and anything a user typed are not "PII risk to be scrubbed later" —
they are a category error that also destroys the aggregate, because a dimension
with unbounded cardinality has no counts.

**Four. A rollup is durable state, not a farewell.** Anything computed over a
session and emitted at the end must be written somewhere that survives the
process. Every runtime's "the page is going away" event is best-effort, and on
desktop shells it is a different event than on the web, chosen by the shell.
Betting the whole session's data on one listener firing is betting the
measurement on the runtime's shutdown path.

Everything else — which vendor, which transport, sampling, batching — is
replaceable. These four are the ones that make the numbers mean what the
dashboard says they mean.

---

## 1. Trigger

You are in this situation when you catch yourself typing or saying:

- "we should track how many people actually open this tab"
- "add an event when the user completes onboarding / creates their first X"
- "which features is nobody using?" — this is the question the leaf exists for,
  and the one most often answered from data that cannot answer it
- "just fire a Sentry message / a PostHog event here, it's one line"
- "we need an activation funnel / time-to-value / a K-factor"
- **the "if you are about to write X" test:** if you are about to write
  `track(...)`, `capture...(...)`, `analytics.event(...)` or any
  `<vendor>.<verb>(` inside a feature module, stop — you are adding a door.

You are **not** in this situation when the value is a *product* metric derived
from your own tables (runs today, cost this month, error rate). That is
[`metric-tile`](./metric-tile.md) and
[`metric-definition`](./metric-definition.md). The discriminator: usage
analytics measures **the user's interaction with the software**; a product
metric measures **the work the software did**. The first has no row in your
database until you write one; the second already does.

---

## 2. The one way

**Compute the tracked surface from the registry that already defines it, emit
through one function that owns the consent check, close the event vocabulary
with a type, and give the rollup a durable home before you give it a
listener.** Concretely: (a) derive the denominator — `SECTIONS`,
`TAB_DIMENSIONS`, whatever enumerates your surfaces — from the navigation
registry / router / union that the application itself dispatches on, never from
a hand-maintained parallel array, and make the derivation *fail loudly* when it
yields zero; (b) declare the event names once as a `const` object and export
`type Event = (typeof EVENTS)[keyof typeof EVENTS]`, so an emit site cannot
invent a name and a dashboard cannot drift from the code; (c) type the payload
as identifiers only — a closed union for the dimension, `string | number |
boolean` for properties — and validate the emitted value against the closed set
at the emit site, because the type that closed the *declaration* does not reach
the *emission* once the value has been read out of a store by string key;
(d) put the consent check **inside the single emit function**, so there is no
unguarded entry point to forget, and do not re-export the raw vendor helpers
from the same barrel — withholding the dangerous door is the whole mechanism
(doctrine Q5), and handing it back beside the safe one is how this repo lost it;
(e) write the one-shot latch for a conversion **after** the send succeeds, never
before, or "we sent it" and "we chose not to send it" become the same permanent
state; (f) persist the session rollup incrementally to durable storage and treat
the unload listener as an optimisation, registering **both** `pagehide` and
`beforeunload` where the shell's choice is not yours to make.

If two answers seem correct for the transport, reach for the one whose *check is
inside the function*, not the one whose check is a swappable object — an object
you can swap is an object a caller can route around, and this codebase proves it
with 18 call sites.

---

## 3. Mandated primitives

Use these. Do not invent a second one.

| Primitive | What it gives you |
| --- | --- |
| `lib/analytics/sink.ts` `getAnalyticsSink()` / `setAnalyticsSink()` / `applyTelemetrySink()` | The one transport seam. `feature` / `interaction` / `session` / `conversion`, each a closed payload type. **Every new emitter goes through this and only this.** |
| `lib/analytics/navCatalog.ts` `SECTIONS` | The section denominator, **derived** from `NAV_SECTIONS` (`lib/navigation/registry.ts`). This half of the catalog is correct and is the model for the other half. |
| `lib/analytics/navCatalog.ts` `exact<T>(map: Record<T, true>)` | The exhaustive value-set helper. A `Record<Union, true>` makes both an omission and a stale extra a compile error, where `satisfies readonly T[]` makes neither. Use it for every enumerated value set in the catalog. |
| `lib/analytics/summary.ts` `buildSessionSummary(counts)` | The pure visited/ignored diff against the full catalog. Side-effect-free, unit-tested without a DOM. **This is the file to copy** — it is the only part of the layer whose correctness is a property of its type signature. |
| `lib/analytics/activation.ts` `ACTIVATION_FUNNEL` / `ActivationStep` | The closed conversion vocabulary — `as const` array plus a derived union, so an ordinal cannot drift from a name. |
| `lib/analytics/activation.ts` `markActivation(step)` | One-shot per install, returns whether it fired. Use it for every "first time the user reached value" milestone. |
| `lib/telemetryPreference.ts` `isTelemetryEnabled()` | The consent answer. Two call sites exist in 4,829 files; that is the problem, not the design. |
| `lib/navigation/registry.ts` `NAV_SECTIONS` / `passesGates` | The registry the denominator is derived from. If you add a surface, you add it here, and the analytics denominator follows for free. |

**Do not** import `trackFeature` / `trackInteraction` / `trackConversion` /
`trackSessionSummary` from `@/lib/sentry` or `@/lib/analytics`. They are the raw
Sentry adapters; the barrel re-exporting them (`index.ts:162`) is §7 D1 and is
the deviation, not the interface.

---

## 4. Steps

1. **Find the artifact that already enumerates your surfaces.** In this repo it
   is `NAV_SECTIONS` for sections and the `*Tab` unions in `lib/types/types.ts`
   for tabs. If none exists, build *that* first; a usage denominator maintained
   by hand is a denominator that is wrong within one sprint.
2. **Derive the denominator from it, and assert the derivation.** `SECTIONS =
   NAV_SECTIONS.map(e => e.id)` is right. Add a check that fails when the derived
   set is empty — an analytics layer that silently tracks nothing looks exactly
   like a product nobody uses.
3. **Declare the dimension's value set with `exact<T>(Record<T, true>)`,** never
   `satisfies readonly T[]`. The `Record` requires every union member as a key.
4. **Register the dimension itself.** This is the step this repo skipped six
   times. Before you ship a tab, ask whether the analytics catalog names its
   *dimension key*, not just its values. Today the honest answer requires the
   inventory in §9; there is no type that will tell you.
5. **Emit through the sink.** `getAnalyticsSink().feature({ section, tab,
   action })`. Validate `tab` against `dim.values` before you send — the closed
   type stopped at the declaration and the value you are holding came out of a
   store by string key.
6. **For a milestone, call `markActivation(step)` — and stop.** It reads the
   persisted set, dedupes, emits, and returns whether it fired. Do not add your
   own "have we sent this" flag; do not call the sink's `conversion` directly.
7. **For the rollup, accumulate into durable storage as you go,** then register
   *both* `pagehide` and `beforeunload` as a best-effort final flush. The
   listener is not the mechanism; it is the last chance.
8. **Then stop.** Do not add a per-feature counter, a second catalog, a
   `useAnalytics()` hook, or a `trackX` helper in your feature folder. The four
   payload types on `AnalyticsSink` are the whole vocabulary; if your event does
   not fit one of them, the missing thing is a fifth method on the sink, added
   once, not a new door.

---

## 5. Anti-patterns

**Re-exporting the raw vendor helper from the layer's own barrel.** The failure
mode is not that someone bypasses the seam deliberately — it is that the correct
import path *offers* the bypass. `index.ts:162` publishes `trackFeature` and
`trackInteraction` from `../sentry` alongside `getAnalyticsSink`, so
`import { trackInteraction } from '@/lib/analytics'` is the natural thing to
write and is the unswappable door. Doctrine Q5 in reverse: the layer withheld the
dangerous value in `sink.ts` and handed it back in `index.ts`.

**A hand-maintained catalog of what to track.** The failure mode is that the
missing entry is *silent in the direction of your conclusion*: an untracked
surface reports as ignored, and "ignored" is the finding you were looking for.
No test fails, no event is malformed, and the dashboard is confidently wrong.

**`satisfies readonly Union[]` for an enumerated value set.** It type-checks a
subset. The failure mode is a value that exists in the union, never appears in
the catalog, and is therefore counted as neither visited nor ignored — it simply
is not in the denominator. This repo already paid for this twice (`mastermind`,
`missions`) and fixed it in one file.

**Writing the one-shot latch before the send.** `writeReached(reached)` then
`sink.conversion(...)` makes a failed send permanent. The failure mode is
specific and silent: with telemetry toggled off, the sink is `noopSink`, the
call "succeeds", the latch is durable, and that install's `persona_created` can
never be reported even after the user opts back in.

**Betting the rollup on one unload event.** The failure mode is invisible by
construction: the data you did not get looks identical to the sessions that
produced no data. You cannot detect it from the telemetry, because the detector
would be the telemetry.

**Putting the consent check outside the emit function.** A boolean consulted at
boot (`main.tsx:304`) and a swappable object consulted at emit are two different
guarantees, and only the second survives a mid-session change. Neither survives
a caller that never touches either.

**Sending a value read out of a state object by string key without checking it
against the closed set.** `readTab(state, dim.key)` returns `string | undefined`;
`dim.values` is right there and is never consulted. The failure mode arrives with
a persisted view-state from an older build (see
[`view-state-persistence`](./view-state-persistence.md)) — the writer and the
reader are different builds of the same program, and no type spans them.

**Assuming an unobservable pipeline is a working pipeline.** `sentry.ts:196`
gates the DSN on `import.meta.env.PROD`, so no developer has ever seen an event
from this layer. Every defect in §7 is downstream of that: the layer is
unfalsifiable in the only environment anyone runs it in.

---

## 6. Evidence

### 6.1 The site to copy

**`src/lib/analytics/summary.ts` (58 lines).** `buildSessionSummary(counts)`
takes a bag of counts and diffs it against the *full* catalog, returning
`sectionsVisited`/`sectionsIgnored`/`tabsVisited`/`tabsIgnored` plus both totals.
It is pure, it is unit-tested without a DOM or a vendor
(`summary.test.ts`), and it is the only file in the layer whose correctness does
not depend on anything outside its arguments. Everything it computes is exactly
as right as the catalog it is handed — which is the point, and is why §7 D2 is a
catalog defect and not a summary defect.

Second site, for the vocabulary: **`activation.ts:30-41`** —
`ACTIVATION_FUNNEL` as a `const` array, `ActivationStep` derived from it, and
`ordinalOf` derived from its index. Four steps, one declaration, and the ordinal
a dashboard groups by cannot drift from the name.

### 6.2 The parts that are right, stated so the deviations are legible

| Claim | Verified how | Result |
| --- | --- | --- |
| `SECTIONS` is derived, not hand-listed | `navCatalog.ts:60` reads `NAV_SECTIONS.map(e => e.id)` | correct, and it is the model for the tab half |
| the four funnel steps all have a caller | `markActivation` call sites enumerated across `src/` | **4/4 covered** — `shared` ×3, `imported` ×2, `execution_completed` ×1, `persona_created` ×1 |
| no phantom dimensions in the catalog | inventory diff (§9) | **0** — every declared dimension exists in a store |
| the sink's payload types carry no free text | `sink.ts:20-68` read in full | correct — `section`/`tab`/`action`/`category`/`label`/`step`/`ordinal`/`installId` and a `Record<string, number>` |
| `cost_usd` on executions is real | replayed on a copy of `personas.db` | **$2,036.26 over 1,970 priced rows of 2,188** |

### 6.3 The database, measured

Both drivers agree.

| Table / column | Value |
| --- | --- |
| `persona_executions` rows | **2,188** |
| `SUM(input_tokens)` | **0** |
| `SUM(output_tokens)` | **0** |
| `SUM(cache_read_tokens)` | **648,406,049** |
| `SUM(cache_creation_tokens)` | **26,029,682** |
| `SUM(cost_usd)` | **$2,036.26** (1,970 rows non-zero) |
| newest `created_at` | **2026-06-26T16:34:02Z** — 52 days before this composition |
| `dev_llm_spend` rows / tokens / cost | **89** / **16,750 in, 1,002,226 out** / **$118.07** |

The two zero columns and the two populated ones are set three lines apart in the
same match arm: `parser.rs:340-341` reads `total_input_tokens` /
`total_output_tokens` from the **top level** of the CLI `result` line, while
`:347-353` read the cache figures from **inside `usage`** first. That chain is
[`execution-trace-instrumentation`](./execution-trace-instrumentation.md) §7 D2's
finding and is cited, not re-derived.

What this leaf adds is the second row of that table. **`dev_llm_spend` records
real token counts, in the same database, written by a different producer.** The
application does not lack the capability to read `usage.input_tokens`; the
working implementation simply never crossed a module boundary — the same shape
doctrine §5 names for the fleet ("a solved problem that did not cross a component
boundary"), observed here *inside one repository*.

### 6.4 Convergence — cohort established first, then counted

**Cohort for this leaf: 3 independent, not 5.** `personas-web` is disqualified
twice over (a port of this repo's code *and* a reader of its tables — the
lineage rule and the dependent rule, both from doctrine §5); `vibeman` is an
ancestor by default and carries no analytics module at all. That leaves
`brainiac`, `personas-cloud`, `ascent`.

- **`personas-cloud`: silence.** No analytics module, no funnel, no event
  vocabulary.
- **`ascent`: not the same problem.** `src/lib/db/badge-analytics.ts` is a table
  of badge impressions — product data it owns, not instrumentation of its own
  UI. Reported as *not applicable*, not as agreement.
- **`brainiac`: independent reinvention, and it is the strongest result here.**
  `console/src/analytics/` (400 lines across 6 files) arrives at three of this
  path's four requirements by a different route, in a different stack:
  - **The vocabulary is closed by a type.** `config.ts:63-69` declares
    `FUNNEL = { landingView, signupComplete, activation } as const` and
    `type FunnelEvent = (typeof FUNNEL)[keyof typeof FUNNEL]` — structurally
    identical to `ACTIVATION_FUNNEL` / `ActivationStep` here, written for the same
    reason and stated in the same words: *"named once so the tracker call sites
    and the Plausible goal configuration cannot drift."* Two repos, two stacks,
    one mechanism. **Physics.**
  - **Property values are typed low-cardinality**, with the reason in prose:
    `EventProps = Record<string, string | number | boolean>`, *"never free
    text"*, and *"the funnel can never become a per-person record."* Converged
    with `sink.ts`'s payload types.
  - **The consent/enablement check is INSIDE the emit function.**
    `track.ts:22-24` — `if (!analyticsEnabled()) return;` is the first line of
    the only exported function. There is no unguarded alternative to import.
    This is the clause Personas gets wrong, and the sibling that gets it right
    got it right by **withholding the second door**, which is doctrine Q5
    measured in a second codebase.
- **And one inversion, which is the most valuable datum in the sweep.**
  `brainiac/console/src/analytics/config.ts:1-13` records a written decision
  *against* the design Personas shipped: it chose a cookieless tool precisely so
  that *"no consent banner is required"*, and warns that *"swapping in a tool
  that persists a visitor id in a cookie or in localStorage invalidates that
  position and REQUIRES the privacy page and the consent answer to change with
  it."* Personas' `install_id` is exactly that — a random visitor identifier
  persisted in `localStorage` (`activation.ts:19,67-80`) and attached to every
  conversion as `conv.install_id` (`sentry.ts:146`). A sibling considered this
  trade-off explicitly and declined it, naming the consequence. Per doctrine §5,
  *cost, failure and inversion are the strongest evidence the oracle produces* —
  stronger than agreement, and not explainable by shared authorship.

**Verdict on the spine's `convergence: converged` label: it holds on two clauses
and fails on one, and the field cannot say so.** Closed vocabulary and
low-cardinality properties are reinvented independently (physics). The consent
seam is *not* converged — it is one repo doing it right and this one doing it
wrong. And the identifier clause is an active disagreement between two repos with
the reasoning written down on the other side. This is the fourteenth
`convergence` label tested by the corpus; counting it as a failure of the
single-enum encoding (a verdict that splits by clause cannot be one word) makes
**14 tested / 14 that a single value could not carry**, which is the same
conclusion `cross-device-pairing` reached from a different leaf.

---

## 7. Deviations

Every entry was verified at a `file:line` during this composition.

### D1 — The swappable sink has 4 consumers; the app has 22 emit sites

`getAnalyticsSink()` production call sites, enumerated in `src/` (4,829 files):

```
src/lib/analytics/index.ts:38     feature  (section visit)
src/lib/analytics/index.ts:43     feature  (tab switch)
src/lib/analytics/index.ts:49     session  (rollup)
src/lib/analytics/activation.ts:127  conversion
```

Four, all inside `src/lib/analytics/`. Against them, **18
`Sentry.capture(Message|Exception)(` calls in 12 files** — `sentry.ts` ×4,
`useByomSettings.ts` ×2, `main.tsx` ×2, `tourSlice.ts` ×2, and one each in
`useOnboardingState.ts`, `useCreateTemplateSnapshot.ts`, `useAutoUpdater.ts`,
`analyticsMiddleware.ts`, `silentFailureTelemetry.ts`, `alertSlice.ts`,
`researchLabSlice.ts`, `storeTypes.ts`.

`sink.ts:104-118` documents the intent precisely: *"Turning telemetry OFF routes
usage events to `noopSink` so tracking stops immediately — no restart needed."*
Its own scope note is honest about half the gap (*"Scope: usage analytics
only"*). What it does not say is that **`lib/execution/middleware/
analyticsMiddleware.ts` is a usage-analytics emitter by name** — it tags
`event_type: 'execution_telemetry'` at `:23` and calls `Sentry.captureMessage`
at `:32`, entirely outside the sink.

**Root cause, and it is one line.** `index.ts:162`:

```ts
export { trackFeature, trackInteraction } from '../sentry';
```

The barrel that exists to concentrate the concern re-exports the unconcentrated
door under the same names, eleven lines above `getAnalyticsSink`. Both consumers
of `trackInteraction` are therefore correct-looking and wrong:
`ExecutionDetail.tsx:24` imports it from `@/lib/analytics`;
`useOnboardingState.ts:15` imports it from `@/lib/sentry`. Neither is a mistake a
reviewer would flag.

**Note, not applied.** The fix is to delete the re-export and route both callers
through the sink — a behaviour change to what leaves the device, on a live
install. Filed for
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md).

### D2 — Six navigation dimensions exist and are not in the catalog; the denominator sees 85.2% of its own surface

Measured by inventory, two implementations:

| implementation | tab-shaped nav fields found |
| --- | --- |
| A — interface declarations (`  fooTab: FooTab;`) in `src/stores/**` | **20** |
| B — initial-state literals (`  fooTab: "welcome" as FooTab,`) | **19** |
| union | **20** |
| declared in `TAB_DIMENSIONS` (`navCatalog.ts:109-124`) | **14** |

The implementations disagree on exactly one field and the disagreement is
informative: `pendingLifecycleSubTab` (`uiSlice.ts:147`) is
`'setup' | 'competitions' | 'tracking' | null` with a `null` default, so it has
no string initialiser for B to see. It is a pending-navigation intent rather than
a current-tab dimension, so the honest count is **6 unregistered including it, 5
excluding it**; both numbers are reported because the classification is a
judgement and the reader should be able to disagree with mine.

Unregistered, with the site each was found at:

| dimension | declared at | values | in catalog? |
| --- | --- | ---: | --- |
| `artistTab` | `stores/slices/system/artistSlice.ts:74` | 3 | no |
| `companionPluginTab` | `stores/slices/system/companionPluginSlice.ts:114` | — | no |
| `kpisTab` | `stores/slices/system/uiSlice.ts:94` | 2 | no |
| `obsidianBrainTab` | `stores/slices/system/obsidianBrainSlice.ts:6` | 6 | no |
| `pendingLifecycleSubTab` | `stores/slices/system/uiSlice.ts:147` | 3+null | no |
| `twinTab` | `stores/slices/system/twinSlice.ts:55` | 7 | no |

Phantoms — declared in the catalog with no store field — are **0**, which is
worth stating: the catalog is *stale in one direction only*, and that direction
is the one that makes the product look less used than it is.

**The denominator consequence.** Summing the declared value sets gives
`tabsTotal` = **104**. Summing every `*Tab` union in `lib/types/types.ts` whose
field exists in a nav store gives **122**. So `104 / 122 = 85.2%`, and the 18
missing values are `obsidianBrainTab` 6, `twinTab` 7, `artistTab` 3, `kpisTab` 2.
Every `tabs_ignored_count` and `tabs_total` this app has ever emitted
(`sentry.ts:171-172`) is computed against that.

**The sharpest form of it.** `pluginTab` *is* registered, with all 9 values
including `artist`, `obsidian-brain`, `twin` and `companion`. Two of the six
plugin sub-tab dimensions — `devToolsTab`, `researchLabTab` — are registered.
Four are not. The catalog does not miss a *kind* of surface; it misses four
members of a kind it already tracks twice.

**Why the existing type could not catch it (doctrine Q1).** `navCatalog.ts:62-69`
documents its own hard-won fix:

> *"Unlike the previous `satisfies readonly X[]` guards — which accept SUBSETS,
> and therefore missed `mastermind` and `missions` when those tabs shipped — a
> Record requires EVERY union member as a key, so both an omission and a stale
> extra are compile errors."*

That is correct and it works — for the **values of a registered dimension**.
`TAB_DIMENSIONS` itself is a plain `readonly TabDimension[]` literal, and nothing
requires it to be exhaustive over the store's fields, because *there is no union
of tab dimension keys to be exhaustive over*. **A required prop carries only
what it actually encodes.** The omission did not stop; it moved from the value
axis to the dimension axis, where the same author's fix does not reach.

### D3 — The rollup's only drain is the fallback listener, and the module that knows better has zero call sites

`analytics/index.ts:149`:

```ts
window.addEventListener('beforeunload', flushSessionSummary);
```

`lib/throttledStorage.ts:41-43`:

```ts
// pagehide is the recommended hook for "tab is going away" on modern browsers
// and Tauri webviews; beforeunload is a desktop fallback.
window.addEventListener("pagehide", flushAll);
window.addEventListener("beforeunload", flushAll);
```

Two modules in one `src/lib/`, one registering both events with a comment
explaining which one works in this shell, the other registering only the one the
comment calls the fallback. And `createThrottledLocalStorage` — the only
`pagehide` registration in the tree — has **zero call sites in 4,829 files**
(verified here; the fact was first recorded by
[`hmr-safe-singletons`](./hmr-safe-singletons.md) §7 and by
[`client-state-persistence`](./client-state-persistence.md)). So at runtime this
application registers `pagehide` **nowhere**.

The general form — *no pending write in this app survives a window close* — is
[`debounced-autosave`](./debounced-autosave.md) §7 P1-2 and is cited, not
re-derived. What is specific to this leaf is the consequence: the session summary
is the only artifact that carries `sectionsIgnored` and `tabsIgnored`. Per-visit
events answer "what was used"; **only the rollup answers the question the leaf
exists for**, and it is the one thing riding on the listener.

It is also undetectable from the data. A session whose rollup never flushed and a
session in which the user visited nothing produce the same absence.

### D4 — The one-shot latch is written before the send

`activation.ts:121-134`:

```ts
export function markActivation(step: ActivationStep): boolean {
  const reached = readReached();
  if (reached.has(step)) return false;
  reached.add(step);
  writeReached(reached);          // <- durable, first
  try {
    getAnalyticsSink().conversion({ step, ordinal: ordinalOf(step), installId: getInstallId() });
  } catch (err) {
    silentCatch('activation:markActivation')(err);
  }
  ...
}
```

The latch is persisted to `localStorage` before the emit, and the emit's failure
is swallowed. The precise live case: `applyTelemetrySink(false)`
(`AccountSettings.tsx:52`) installs `noopSink`, whose `conversion` is `() => {}`.
A user who turns telemetry off, then creates their first persona
(`personaSlice.ts:352`), has `persona_created` written to
`personas.activation_reached` forever, and turning telemetry back on cannot
recover it — `markActivation` returns `false` at line 123 for the rest of the
install's life.

Four steps × one install is a small absolute number, and that is the point: the
activation funnel's *entire population* is one row per install per step. A
silently dropped conversion is not noise in an aggregate; it is a missing
denominator entry in the metric the funnel exists to compute.

**Note, not applied** — reordering changes what is emitted on a live install.

### D5 — The privacy guarantee is asserted three times and enforced nowhere

Three docstrings state it. `index.ts:14-16`: *"only section/tab identifier
strings are tracked — no user IDs, no persona content, no credentials."*
`sink.ts:14-17`: *"events carry only section/tab/action identifier strings."*
`activation.ts:11-14`: *"the only identifier is a random, opaque `install_id`."*

The emit path that would have to hold that line:

```ts
function readTab(state: NavState, key: string): string | undefined {   // :69
  const v = (state as unknown as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}
...
function emitTabVisit(dim: TabDimension, value: string): void {        // :42
  getAnalyticsSink().feature({ section: dim.section, tab: value, action: 'tab_switch' });
```

`dim.values` — the closed set that `exact<T>()` was built to guarantee — is
consulted by `summary.ts:40` to build the denominator and by **nothing else in
the codebase**. The value that is *sent* is whatever string sat under that key in
the store.

Today this leaks nothing: all 14 registered dimensions are string unions of
literals. It is listed as a deviation because the guarantee is prose over an
untyped read, and the failure arrives from a direction the layer does not
control — a persisted view-state written by a different build of the program (see
[`view-state-persistence`](./view-state-persistence.md), whose measured case is
**51 members removed from 18 view-state unions across 156 revisions**). The
one-line fix is `if (!dim.values.includes(value)) return;`, and it converts the
docstring into a mechanism.

There is a second, live half. The event's contents ride to Sentry as **tags**
(`sentry.ts:98-101, 118-121, 143-146, 165-167`) and **extras**
(`:168-181`), and `beforeSend` (`:215-253`) visits `message`,
`exception.values[].value` and `breadcrumbs[].message` — not `tags`, not `extra`.
That field-coverage condition is
[`telemetry-scrubbing`](./telemetry-scrubbing.md)'s leaf and its census rule
`unscrubbed-telemetry-side-field`; it is cited here because it is the reason
this layer's privacy claim cannot be delegated to the scrubber.

### D6 — The layer is unobservable in every build a developer runs

`sentry.ts:194-198`:

```ts
const dsn = import.meta.env.PROD
  ? (import.meta.env.VITE_SENTRY_DSN as string | undefined)
  : undefined;
```

Deliberate and correct as a *privacy* decision — local errors must never ship.
Its cost for this leaf is total: the only sink is Sentry, Sentry has no DSN in
dev, so **no developer has ever observed an event this layer produced**. D1's
four-of-twenty-two, D2's missing six and D3's unfired rollup are all conditions
that a single afternoon of watching the event stream would have surfaced, and no
afternoon of watching is possible.

This is the structural reason a usage-analytics layer needs a **second sink in
development** — the `sink.ts` docstring's own "Option B: a local-first SQLite
sink" — not as a future feature but as the thing that makes the layer
falsifiable. See §8.

### D7 — `initAnalytics` subscribes to two stores; the catalog names two, and 4 of the 6 unregistered dimensions live in a third place

`LAZY_STORE_ATTACHERS` (`index.ts:79-100`) has exactly one entry (`overview`).
`NavStore` (`navCatalog.ts:40`) is `'system' | 'overview'`. That closed type is
correct for what it names — and `artistTab`, `obsidianBrainTab`, `twinTab` and
`companionPluginTab` all live in **slices of the system store** that the eager
`SYSTEM_TAB_DIMENSIONS` subscription would have picked up for free. They are not
missing because they are hard to reach. They are missing because nobody wrote
the row.

That is worth separating from D2 because it changes the fix: this is not a
plumbing gap, it is four lines of catalog, and the reason to state it is that
"we'd need to subscribe to another store" is the plausible-sounding wrong reason
someone will give for not fixing D2.

### D8 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"The activation funnel has steps with no caller."** False. All four —
  `imported`, `persona_created`, `execution_completed`, `shared` — have at least
  one production call site; `shared` has three.
- **"`SECTIONS` is hand-maintained like `TAB_DIMENSIONS`."** False.
  `navCatalog.ts:60` derives it from `NAV_SECTIONS`. The section half of the
  catalog is exemplary and is why §3 mandates it.
- **"The catalog contains stale entries."** False. **0 phantoms** — every
  declared dimension resolves to a real store field.
- **"`cost_usd` is as broken as the token columns."** False, and the contrast is
  the finding: **$2,036.26 across 1,970 of 2,188 rows**, from the same `result`
  line, parsed correctly at `parser.rs:339`.
- **"The consent check happens at module scope / unconditionally."** False, and
  it corrects two neighbours — see §12.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **`AnalyticsSink` cannot express a durable rollup.** Its `session(summary)`
   is fire-and-forget at the end of a session. Nothing in the interface lets an
   implementation accumulate, checkpoint, or recover a partial session — so D3 is
   not a call-site mistake, it is the shape of the type. A `sink.beginSession()`
   / `sink.observe()` pair, or a sink that owns its own storage, is the missing
   capability.
2. **Nothing in the type system can require `TAB_DIMENSIONS` to be exhaustive**,
   because the thing it must be exhaustive over — "the set of tab-shaped fields
   on the nav stores" — is not a type. It is a *property of the store's shape*,
   discoverable only by inventory. This is doctrine's fourth "where types cannot
   reach": **a thing that was never declared**. No signature is short a parameter
   and no enum is short a variant; six rows are simply absent. It is also why §9
   is a decline plus a specification for an inventory instrument.
3. **The sink cannot see events it does not receive.** `applyTelemetrySink` can
   only silence what routes through `getAnalyticsSink()`. Making it a real kill
   switch requires either a consent-aware facade at `src/lib/sentry.ts` (which is
   [`first-use-consent-gate`](./first-use-consent-gate.md)'s prescription, and its
   census rule `consent-bypassing-telemetry-import` ratchets toward it) or
   `Sentry.close()`, which has **0** call sites.
4. **`install_id` cannot be both a funnel key and absent.** Sequencing
   conversions into a funnel needs a stable per-install identifier; not persisting
   one is what `brainiac` chose, and it costs the funnel. This is a genuine
   trade-off with a written argument on each side (§6.4), not a defect — but the
   privacy docstrings should say which side this repo picked and why, and they
   currently describe only the identifier's opacity.
5. **No primitive answers "was this session's rollup delivered?"** — and no
   telemetry can, because the detector would share the failure. This needs a
   local counter (a durable "rollups started" vs "rollups flushed") outside the
   telemetry path.

---

## Prefer a type over a gate

Held against all seven qualifications.

- **Q1 — a required prop carries only what it encodes.** This is D2's whole
  mechanism. `exact<T>(Record<T, true>)` is a correctly-closed type that made
  omissions on the value axis impossible and moved them, undiminished, to the
  dimension axis. Any proposed type here must be checked against *which* axis it
  closes.
- **Q2 — requiredness ≠ closedness.** Making `TabDimension.values` required
  changes nothing; it already is. The gap is that `TAB_DIMENSIONS` is a list, and
  a list has no exhaustiveness obligation.
- **Q3 — count the construction sites.** `AnalyticsSink` has **2**
  implementations (`sentrySink`, `noopSink`) and **4** consumers. A type that
  constrains sink implementations constrains almost nothing; the population that
  matters is the 18 emitters that never touch it.
- **Q4 — a type anyone can construct authenticates nothing.** A branded
  `TrackedTab` newtype would be minted by the same `readTab` cast that is the
  defect (`index.ts:70` is already `as unknown as Record<string, unknown>`).
- **Q5 — withholding beats requiring**, and this leaf is the cleanest instance in
  the batch. Not exporting `trackFeature`/`trackInteraction` from
  `analytics/index.ts` removes the only door 2 of 2 external callers took. It
  also has an external control: `brainiac`'s `track()` withholds the unguarded
  path and its consent check cannot be routed around (§6.4).
- **Q6 — withhold the dangerous freedom, not the answer.** Withhold the *raw
  vendor helper*, not the ability to emit. Deleting the re-export while keeping
  the sink's four methods gives callers everything they need.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value
  voluntarily.** Applies to D5: no widening of `FeatureVisitEvent['tab']` helps,
  because the caller *has* a legal `string`. The fix is a membership check at the
  emit site, which is a guard, not a type — because the value crossed out of a
  typed store through an index signature, and no type reaches through a cast the
  module wrote itself.

**Verdict.** One type change is clearly correct and cheap: **delete
`export { trackFeature, trackInteraction } from '../sentry'` at
`analytics/index.ts:162`.** That single deletion makes D1's most common form
unrepresentable through the layer's own barrel and is the one edit here with an
external warrant. Everything else in §7 is either an inventory problem (D2, D7 —
no type reaches it) or a runtime-ordering problem (D3, D4 — a type cannot
express "after the await succeeded").

---

## 9. The missing gate

**This path declines to add a census rule, and the numbers are below.** Per the
contract, the signal a gate keys on is a **manifestation**; an adopting repo must
re-derive its own. What travels is the *condition*: **a usage event leaves the
process through a door the consent switch does not own, and the surface catalog
that supplies the denominator has no exhaustiveness obligation.**

### 9.1 The rules that already exist here, named

Checked before proposing anything:

| rule | owner | why it is close |
| --- | --- | --- |
| `consent-bypassing-telemetry-import` | [`first-use-consent-gate`](./first-use-consent-gate.md) | 19 files: a module imports `@sentry/*` and never consults `isTelemetryEnabled()`. |
| `unscrubbed-telemetry-side-field` | [`telemetry-scrubbing`](./telemetry-scrubbing.md) | 12 files / 19 matches: a value on a Sentry record in a field `beforeSend` never visits. |
| `unflushable-debounced-write` | [`debounced-autosave`](./debounced-autosave.md) | 7 files / 9: a scheduled durable write with no drain. |
| `absent-entity-count-as-zero` | [`aggregate-count-display`](./aggregate-count-display.md) | 30 files / 40: an absent count rendered as none. |

### 9.2 The candidate, measured, and why it was refused

`telemetry-emit-outside-the-swappable-sink` — `Sentry.capture(Message|Exception)(`
under `src/`, `.ts`/`.tsx`. Run in a private scratch registry
(`gp-msurf-scratch-rules2.json`), full registry not run:

```
telemetry-emit-outside-the-swappable-sink                    12 files / 18 matches
telemetry-emit-outside-the-swappable-sink-positive-control    2 files /  4 matches
walked 4,829 files, floor 4,000
```

The control is `getAnalyticsSink()\s*\.` — the compliant form — and it partitions
cleanly: **18 violating vs 4 compliant, with no site in both.** By separation
alone it is a good rule.

**It was refused on overlap.** Nine of its twelve files are already matched by
`consent-bypassing-telemetry-import`: `useByomSettings.ts`, `tourSlice.ts`,
`useOnboardingState.ts`, `useCreateTemplateSnapshot.ts`, `useAutoUpdater.ts`,
`silentFailureTelemetry.ts`, `alertSlice.ts`, `researchLabSlice.ts`,
`storeTypes.ts`. **75% file overlap** — and of the three that do not overlap, two
(`src/lib/sentry.ts`, `src/main.tsx`) are that rule's own named `exclude`
entries, leaving exactly **one genuinely new file**,
`lib/execution/middleware/analyticsMiddleware.ts`. Doctrine §4 records a decline
at 83% file overlap and calls it correct; 75% with one new file is the same
call. A second ratchet over the same population buys a rename of the reason, not
a new finding.

Site-level overlap is technically **0%**, because the existing rule is
file-anchored at index 0 and mine matches call expressions. That number is
misleading and is reported so nobody quotes it: the doctrine's instruction to
measure at the site level exists to stop file overlap from *understating*
duplication, not to launder it away when the two rules have different anchors
over the same files.

### 9.3 The other two candidates, also measured, also refused

**`setTag` with a non-literal value.** Already measured *and declined* by
`telemetry-scrubbing` (its §9 table: "6 files / 25 … 14 of the 25 are in
`sentry.ts` itself … a gate whose majority is `setTag('feature.section',
section)` fires on correct content"). Re-measured here at **25 sites / 6 files**
— identical. Not re-proposed; recorded so the next composer does not spend the
measurement again.

**`latch-written-before-the-effect-it-guards`** (D4's shape, generalised): a
durable "done" write followed within 320 characters by an emit/report/track call.
Measured over `src/` with the shared `stripComments` instrument:
**3 matches in 3 files, of which 1 is real** (`activation.ts:125`). The other two
are a last-edited breadcrumb and a crash-buffer write. **33% precision,
hand-verified**, against a compliant control that also returns 3. Below every
refusal threshold the doctrine records (22%, 44%, ≤71%). Refused.

### 9.4 What would actually catch D2 — and it is not a census rule

The census ratchets a count of something **present**. D2 is an **absence
relative to an inventory**: six dimensions that were never declared. Doctrine §4
states the limit and the fourth "where types cannot reach" states the same thing
from the type side. So the honest §9 is a decline **plus a specification for a
different instrument**, in the tradition of `check-csp-hosts.mjs`:

**`scripts/check-nav-analytics-coverage.mjs`**

- **Signal (this stack's manifestation).** Enumerate every state field matching
  `/^[a-z][A-Za-z0-9]*Tab$/` declared in a slice under `src/stores/slices/`, by
  **two passes** — the interface declaration and the initial-state literal — and
  difference the union against the `key` values in
  `navCatalog.ts`'s `TAB_DIMENSIONS`.
- **Condition it is a proxy for (this is what travels):** *the set of surfaces
  the analytics denominator enumerates is not derived from the set the
  application actually navigates between.*
- **Mechanism.** A node script in `scripts/run-codegen.mjs`'s `prebuild` preset
  and in `npm run check`. Non-zero exit on any unregistered dimension.
- **Allowlist.** A `reason`-bearing entry per intentional omission. Today it
  would carry exactly one candidate — `pendingLifecycleSubTab`, a pending-nav
  intent rather than a current tab — and forcing that judgement to be written
  down is most of the value.
- **How it fails loudly when its own precondition is absent.** **Exit 2 if
  either pass finds fewer than 10 tab fields, or if the two passes disagree by
  more than one field.** Both floors are calibrated on today's measurement (20
  and 19). Without them, a rename of the `*Tab` convention silently turns the
  checker into a green no-op — which is precisely how `check-csp-hosts.mjs`
  reported zero hosts twice.
- **Why the two passes are load-bearing and not belt-and-braces.** They already
  disagreed once, on `pendingLifecycleSubTab`, and the disagreement is the only
  reason its classification got examined at all.

A second, cheaper assertion belongs beside it and needs no new script: **a unit
test that `SECTIONS.length > 0` and `TAB_DIMENSIONS.length > 0`.** `summary.test.ts`
today asserts structural invariants over whatever the catalog contains; it passes
over an empty catalog, and an empty catalog reports every surface as ignored.

**No fenced census rule is published by this document.** The decline is the §9.

---

## 12. Corrections to the brief

**1. The brief's headline lead was already owned by a neighbour, and re-deriving
it would have been the wrong work.** The brief said *"every run in history
records 0 tokens on 2,188/2,188 rows against $2,036.26 of real spend
(`parser.rs:340-341` — cite, don't re-derive)"*. Correct, and correctly fenced —
[`execution-trace-instrumentation`](./execution-trace-instrumentation.md) §7 D2
already measured the whole chain from the parser to `TraceSummary.tsx`. The
figures were re-verified on a fresh copy (2,188 / 0 / 0 / 648,406,049 /
26,029,682 / $2,036.26) and are unchanged. **What was left to find was the other
half:** `dev_llm_spend` holds **89 rows with 16,750 input and 1,002,226 output
tokens** written by a different producer in the same database, so the repo's
problem is transfer between modules, not a missing capability. That is this
leaf's contribution and it is in §6.3.

**2. The brief's "nine tile positions show false numbers across ≥7,318 renders"
and "all 10 `SchedulerStats` counters render nowhere" belong to two other
leaves, and I did not re-measure either.** The tile figures are
[`metric-tile`](./metric-tile.md)'s territory (its D1–D10 enumerate them); the
scheduler counters are [`stall-watchdog`](./stall-watchdog.md) §7 D3 (*"10 of 10
scheduler throughput counters and 14 of 14 health fields have zero readers"*).
`CostBreakdownBar` having never rendered is
`execution-trace-instrumentation` D11. All four are cited. A brief that leads a
composer to four already-published findings is a brief whose leaf boundary needs
restating, which §1's *"not this situation"* paragraph now does.

**3. Two published paths misstate this repo's Sentry-init mechanism, and the
error is the doctrine's "false premise whose conclusion survives".**
[`informed-consent-gate`](./informed-consent-gate.md):342 and
[`first-use-consent-gate`](./first-use-consent-gate.md):308 both write that
`personas-web`'s `sentry.client.config.ts:3 → src/lib/sentry.ts:18` *"calls
`Sentry.init({...})` unconditionally at module scope, **exactly as `main.tsx:304`
does here**"*.

`main.tsx:304` is:

```ts
  if (isTelemetryEnabled()) {
```

It is the consent gate itself. `Sentry.init` in this repo is at
`src/lib/sentry.ts:200`, inside `initSentry(appVersion)`, called at
`main.tsx:306` **inside that `if`** — not at module scope, and not
unconditionally. (`first-use-consent-gate` gets this right in its own §0 table,
which records *"`Sentry.init(` call sites in `src/` | 1 (`lib/sentry.ts:200`)"* —
so the document contradicts itself 174 lines apart.)

**The conclusion survives, on a different mechanism.** Telemetry does boot before
the user has answered — because `isTelemetryEnabled()` is
`localStorage.getItem(TELEMETRY_KEY) !== "false"`
(`telemetryPreference.ts:14-20`), which returns `true` on absence *and* on a
storage throw. It is an opt-out default-on gate, not an absent gate. That
distinction matters for the fix: "move the init inside a consent check" is
already done, and the real work is the default and the withdrawal path.

Correction owed to both documents; not applied here, because they belong to other
composers and the campaign's rule is to correct a claim in the path that carries
it.

**4. The spine's `convergence: converged` label splits by clause and cannot be
reported as one word.** Two clauses are physics (closed event vocabulary,
low-cardinality properties — independently reinvented in `brainiac`), one is a
silence-plus-inversion (the consent seam: 1 of 3 independent siblings does it
right, and this repo is not that one), and one is an active written disagreement
(the persisted visitor id). Reported per doctrine as a label the field could not
carry rather than as a label that failed.

**5. The spine's `sides: "client"` holds for this leaf, and the mechanism is
worth naming.** Every deviation in §7 is client-side: the sink, the catalog, the
rollup, the latch, the DSN gate. The reason is structural and matches the two
prior upholdings — *the server never sees the navigation*. A section visit exists
only as a store transition inside the webview; there is no IPC call, no row, and
nothing the Rust side could have observed. The one server-adjacent fact in this
document (`dev_llm_spend` vs `persona_executions`) is inherited from a neighbour
and is not this leaf's condition. That makes **3 upholdings of `sides` and 7
contradictions**, and all three upholdings are leaves whose subject lives in the
DOM or in client-only state.

**6. A citation in a neighbour has drifted by nine lines, caused by that
neighbour's own edit.** [`sync-reconciliation-and-conflicts`](./sync-reconciliation-and-conflicts.md)
cites `project_tracking/push.rs:306` for the wall-clock watermark advance. The
statement is at **`:315`** today, because the comment block that path prompted
(`:301-314`, which names that very document) was inserted above it. Noted for the
batch's third document, which owns that file — see
[`session-delta-digest`](./session-delta-digest.md) §12.
