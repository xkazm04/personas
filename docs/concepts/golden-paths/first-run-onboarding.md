# First-run onboarding

> Situation node: `client-runtime/flows-and-onboarding/first-run-onboarding` ·
> [situation spine](../situation-spine.md) · recurrence **5** · risk **high** ·
> sides `client` · convergence `converged` · dimensions ui · function · resilience ·
> `twoSided: false`
>
> **Both spine labels tested. `sides: "client"` HOLDS, for a structural reason
> (§12.1). `convergence: "converged"` FAILS in the sharpest available way — the
> fleet converged on the *disease* (§5).**
>
> Composed 2026-08-17 against `master` @ `2a874e692`. Sweep: `src/features/onboarding/**`
> (26 files), `onboardingSlice.ts`, `tourSlice.ts`, `setupSlice.ts`, `systemStore.ts`,
> `App.tsx`, `main.tsx`, `routeSections.ts`, `home/sub_welcome/**`, `DesktopFooter.tsx`
> read in full; 4,397 production `.ts/.tsx` files walked by instrument; five sibling
> checkouts swept; the 2026-08-17 pre-purge database backup queried read-only.

---

## §0 Headline

**The flow's per-step progress is persisted in two places at once, and the one
thing that would let a user get back to it is persisted in neither — so a
reload after step 4 of 5 leaves every checkmark on disk and closes all three
doors to the room.** `onboardingActive` and `onboardingStep` are in-memory
fields (`onboardingSlice.ts:160-161`); `onboardingStepCompleted` is persisted
(`systemStore.ts:85`). A reload is not a dismiss, so `onboardingDismissedAtStep`
stays `null`; the footer's replay affordance needs it non-null
(`DesktopFooter.tsx:466`); the Home call-to-action needs `personas.length === 0`
(`WelcomeGetStarted.tsx:41`) and step 4 of the flow is *adopting a template*,
which creates a persona. Complete four of five steps, press F5, and the flow is
unreachable from anywhere in the product — with its own record of your progress
intact three keys away.

Underneath that: the app ships 14 locales and **0 lines that ask the operating
system which one to use**. `navigator.language` appears exactly twice in 4,397
production files (`main.tsx:48` a comment, `main.tsx:75` a read) and both belong
to the crash-screen fallback copy, which hardcodes 14 languages × 3 strings
inline rather than going through the catalog. The app-locale initializer is
`language: 'en'` (`i18nStore.ts:103`) and `preloadPersistedLocaleBeforeMount()`
returns immediately when the persisted locale is `en` (`main.tsx:175`) — which
on a first run it always is, because nothing has been persisted. **The 1.2 s
race the brief asked about never starts on a first run.** A first-run Japanese
user sees English until they find a picker whose own label is English.

---

## §1 Trigger

You are in this situation when you would say, or type, any of:

- "the app should walk a new user through setup the first time they open it"
- "how do I know if this is a first run?" / "has this user been here before?"
- "show the welcome modal only once"
- "reset onboarding so I can test it again"
- "the user skipped setup — how do they get back to it?"
- **The if-you-are-about-to-write-X test:** if you are about to write
  `localStorage.setItem('<something>-completed', 'true')`, or a component that
  early-returns on a persisted boolean named `*Completed` / `*Seen` / `*Done`,
  you are here.

Not this situation: a one-time *blocking legal/telemetry acceptance* — that is
[`first-use-consent-gate`](./first-use-consent-gate.md), which is about the
answer's shape rather than the sequence's. A wizard the user opens deliberately
is [`multi-step-flow`](./multi-step-flow.md). Spotlighting a feature is
[`guided-tour-step`](./guided-tour-step.md).

---

## §2 The one way

**Derive "is this a first run" from the data the app already has; persist only
the user's *decision to stop*, and persist the resume pointer in the same write
as the progress it points at.** Concretely, in this order:

1. **Compute the condition.** `isFirstRun = <primary entity count> === 0` — for
   this app, personas. Never a stored `hasOnboarded` boolean. A derived
   condition is self-healing: it comes back when the data goes away and it
   disappears the moment the user has succeeded by any route, including routes
   the flow never knew about. Brainiac's `isFirstRun({live, totals, view})` is
   the fleet's cleanest instance and stores nothing at all
   (`../brainiac/console/src/onboarding/first-run.ts:47-51`, 12 unit tests).
2. **Persist exactly one thing: refusal.** A user who closed the flow has made a
   decision and it must survive. Store it as a *value whose absence means "not
   yet asked"* — the step they left at, not `dismissed: true` — so the same
   field carries both "did they refuse" and "where do we resume". This repo
   already does this and it is right (`onboardingDismissedAtStep`,
   `onboardingSlice.ts:36`).
3. **Write the resume pointer in the same commit as the progress.** If
   `stepCompleted` is durable, `activeStep` and `active` must be durable too or
   the record is unreadable. This is the defect in §7.A: three fields of one
   record, split across two storage mechanisms and one memory-only pair.
4. **Give the flow an entry point that does not depend on the flow's own side
   effects.** A "resume setup" affordance that hides once the user has one
   persona cannot help a user who left at step 5 of 5 — because step 4 made the
   persona. Gate re-entry on `!completed`, never on the artifacts the flow
   produces.
5. **Negotiate the locale before the first paint of the first run.** Read
   `navigator.language`, narrow it to the supported set, write it to the locale
   store *before* React mounts, and only then race the section preload. There is
   no persisted answer on a first run, so the OS is the only signal available,
   and it is a good one.
6. **Do not create a second first-run surface.** Each one needs its own storage,
   its own re-entry, its own precedence rule against the others, and its own
   i18n route declaration. This repo has five (§7.B) and their precedence is
   documented in a README rather than expressed in code.

When two answers are genuinely both defensible — derive vs. persist — **derive
first and treat the persisted flag as a cache you are allowed to lose.** The
2026-08-17 purge is the argument: deleting every persona put this installation
back into a first-run-shaped state, and the parts of the product that *derived*
their first-run-ness correctly came back, while the parts holding a boolean did
not (§7.G).

---

## §3 Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `stores/slices/system/onboardingSlice.ts` — `startOnboarding` / `resumeOnboarding` / `reopenOnboarding` / `dismissOnboarding` | The four verbs. `dismiss` is a deferral that records the step; `reopen` is the escape hatch that makes Skip reversible. Do not add a fifth verb; these four cover the state machine. |
| `stores/systemStore.ts` `partialize` (`:61-100`) | The **one** durable channel for system-domain UI state. A slice that needs a field to survive a reload adds a line here. It does not open its own key. |
| `features/shared/chrome/DesktopFooter.tsx` — `OnboardingReplayFooterIcon` (`:458`) | The always-mounted re-entry affordance. Its docstring (`:442-457`) is the precedence contract in prose. |
| `features/onboarding/components/useOnboardingState.ts` | The data hook: template load phases (`loading \| loaded \| empty \| error`), desktop-discovery scan phases, an adoption dedupe ref. It is the model for how a first-run step handles a flaky backend — an explicit phase per failure, never a disabled button with no explanation. |
| `i18n/routeSections.ts` — `BASE_SECTIONS` | The list a surface must join if it mounts above the router. `consent` and `remote_approval` are there for exactly this reason (`:37-39`). `onboarding` is not, and that is §7.E. |
| `i18nStore` + `main.tsx preloadPersistedLocaleBeforeMount()` | The pre-mount locale channel. Everything a first-run locale decision needs is here; the decision itself is missing. |

**Do not reach for:** `setupSlice` / `SetupCards` — a 628-line role/tool/goal
wizard with zero render sites; see [`setup-checklist`](./setup-checklist.md) §7.A.

---

## §4 Steps

1. **Write the derived predicate first**, in one place, as a function, and unit
   test it. `isFirstRun(personaCount, completed)` — not an inline `||` chain
   copied into three components. Today the same predicate is spelled three
   different ways in three files (§7.C).
2. **Ask what a reload does, and answer it in the same commit.** For every field
   the flow reads, write down: durable or not. If `stepCompleted` is durable and
   `activeStep` is not, you have already shipped §7.A.
3. **Add the fields to `systemStore`'s `partialize`.** One key, one mechanism.
   *And then stop* — do not add a `persistX()` helper beside it. The store's
   `persist` middleware is already writing on every `set()`.
4. **Negotiate the locale in `main.tsx` before `mountReact`**, using the
   narrowing that `isLocaleCode` already provides, and only when nothing is
   persisted. Then let the existing 1.2 s race run — it will now have something
   to race for.
5. **Declare the flow's i18n section in `BASE_SECTIONS`** if the surface mounts
   in `App.tsx` above the router. If it is route-local, put it on that route.
   The one thing that is never correct is mounting at the root and declaring on
   one route.
6. **Wire re-entry before you wire the flow.** `WelcomeGetStarted.tsx:11-15`
   records what happens otherwise, in its own docstring: *"the 5-step onboarding
   overlay had no entry point — nothing called `startOnboarding()`, so a
   first-timer landed on a bare module grid."* The identical failure is sitting
   in a sibling repo right now (§5).

---

## §5 The convergence oracle — the fleet converged on the disease, twice

Cohort established for this leaf, at measurement time: `personas-cloud` has
**zero `.tsx` files** and no HTTP UI — structurally N/A, not silent.
`personas-web` is a **port** (identical component file names `TourIntroCard.tsx`
/ `TourLauncher.tsx`, identical import specifier `@/i18n/useTranslation`,
identical 14-locale set, and `src/data/guide/getLocalized.ts:4-8` names the
parent pattern out loud). So the effective independent cohort is **three**:
`brainiac`, `vibeman`, `ascent` — plus `personas-web` as a *port* whose losses
are evidence about the original.

### 5.1 First-run detection — the label is upheld, and it points away from us

| Repo | Mechanism | Independent? |
| --- | --- | --- |
| **brainiac** | **Derived, no flag anywhere.** `console/src/onboarding/first-run.ts:47-51` — `(totals.canonical ?? 0) === 0`. Three guards documented at `:34-46`, 12 unit tests, escape hatch `?view=charts` (`:19`). | yes |
| **ascent** | **Derived.** `src/app/onboarding/page.tsx:20` `installations.length > 0`; `:37` `getOrgRollup(...).scannedCount > 0`. Its only storage is a *resume snapshot*, `sessionStorage`, and it is **the only versioned key in the cohort** — `OnboardingFlow.model.ts:22` `RESUME_KEY = "ascent:onboarding:v1"`. | yes |
| **vibeman** | **Persisted booleans, unversioned.** `src/stores/onboardingStore.ts:212` zustand `persist({ name: 'onboarding-storage' })` with **no `version:`** ⇒ version 0, no migrate — a step-id rename silently orphans every user's progress. | yes |
| **personas-web** (port) | `TourLauncher.tsx:10` `STORAGE_KEY = "personas-tour-seen"`, no version, value `"1"`; it gates **a pulsing ring**, not content. | port |
| **Personas** | **Both.** Derived (`personas.length > 0`) *and* persisted (`onboarding-state-v1` + `persona-ui-system`). | — |

**Two of three independent siblings derive it and both wrote down why; the one
that persists it does so unversioned.** That is a real convergence and it is the
first spine `convergence` label this composer expected to fail and did not — but
read §12.2 before calling it upheld, because *what* they converged on is not
what this repo does.

### 5.2 Locale on first paint — 0 of 5, a perfect agreement on an omission

`brainiac`, `vibeman` and `ascent` have **no i18n at all** (measured: zero i18n
libraries in any `package.json` across the five). `personas-web` has the full
14-locale apparatus and hardcodes `language: "en"` (`src/stores/i18nStore.ts:72`)
with no `navigator.language` and no `Accept-Language` negotiation — and then
disables the switcher in production entirely (`:41-42`, `:88-90`), describing
its own 170 translated files as *"dormant infrastructure"*
(`src/data/guide/getLocalized.ts:4-8`).

**Nobody in the cohort asks the operating system what language the user speaks.**
Per the doctrine, perfect agreement on an omission is evidence the situation is
universal and evidence *against* an answer existing to adopt. The prescription in
§2.5 is therefore engineering judgment, not a fleet practice — say so when
adopting it.

### 5.3 The strongest single artifact: a first-run flow with no entry point, in two repos

`ascent` ran a documented three-way bake-off of onboarding directions
(`OnboardingLab.tsx`, deleted in `9e263bc`; its docstring: *"once a direction
wins, the switcher is removed and the winning tour is triggered from a real entry
point (a 'Take the tour' CTA)"*). The switcher was removed. The checklist won.
**`git grep -i "take the tour"` → 0 hits**, and the survivor is still gated to
`DEMO_ORG_SLUG` (`src/app/org/[slug]/layout.tsx:207`) with `useState(false)` and
no storage key.

This repo shipped the identical failure and fixed it — `WelcomeGetStarted.tsx`
exists *because* `startOnboarding()` had no caller. **Two repos, one author, the
same failure reached independently, one repaired and one not.** Under the
doctrine's weighting that is *failure* evidence, the strongest class, and it is
why §4.6 says wire re-entry before you wire the flow.

### 5.4 What this repo is ahead on, stated as self-comparison

`onboardingDismissedAtStep` — dismiss-as-deferral rather than dismiss-as-boolean
— has **no counterpart in any sibling**. `ascent` keeps a resume snapshot but in
`sessionStorage` (gone on relaunch); `vibeman` has `resetOnboarding` and exposes
it in no UI; `personas-web` stores a bare `"1"`. Personas is the only repo in
the cohort whose refusal record can be resumed from. Copy that, not the rest.

---

## §6 Evidence

**The one site to copy: `src/stores/slices/system/onboardingSlice.ts:231-239`
(`dismissOnboarding`).** It records *where*, not *whether*; it tracks a metric
with the step as an attribute; and it deliberately does not set
`onboardingCompleted`, so the decision stays reversible. Three lines that get
the hardest part of this leaf right.

Also exemplary:

- `useOnboardingState.ts:191-246` — a first-run data load with four explicit
  phases and a *fallback* backend path, so a new user on a flaky network gets a
  Retry rather than a dead Continue button. Both paths are counted into Sentry
  with the source attribute (`:60-66`), so "which door served the templates" is
  answerable after the fact.
- `useOnboardingState.ts:32-40` `prioritizeZeroCredential` — a stable partition
  that floats zero-connector templates to the front so a brand-new user can
  reach an artifact with no vault setup. Value before configuration, in nine
  lines.
- `systemStore.ts:144-171` — the rehydrate guard that discards an
  `onboardingDismissedAtStep` whose id no longer exists and re-cleans
  `onboardingStepCompleted` against `ONBOARDING_STEPS`. This is the
  cross-build-boundary repair arm that [`view-state-persistence`](./view-state-persistence.md)
  found missing on 27 other unions. It is present here and it is correct.
- `DesktopFooter.tsx:442-457` — the re-entry docstring. It is the clearest
  statement of the precedence contract anywhere in the tree; it belongs in code
  (§7.B).

---

## §7 Deviations

### 7.A — P0: complete four of five steps, reload, and the flow is unreachable from every door

Three fields of one record, three fates:

| Field | Durable? | Where |
| --- | --- | --- |
| `onboardingStepCompleted` | **yes** | `systemStore.ts:85` (`persona-ui-system`) |
| `onboardingCompleted` | **yes, twice** | `systemStore.ts:83` **and** `onboardingSlice.ts:109` (`onboarding-state-v1`) |
| `onboardingDismissedAtStep` | **yes, twice** | `systemStore.ts:84` **and** `onboarding-state-v1` |
| `onboardingActive` | **no** | `onboardingSlice.ts:160` |
| `onboardingStep` | **no** | `onboardingSlice.ts:161` |

A reload mid-flow therefore leaves: `active=false` (overlay gone),
`step="discover"` (reset to the initial value, not the user's),
`stepCompleted` fully preserved, `dismissedAtStep=null` (a reload is not a
dismiss), `completed=false`. Now walk the three re-entry doors:

- `OnboardingReplayFooterIcon` (`DesktopFooter.tsx:465-467`) —
  `canResume = !completed && dismissedAtStep != null` → **false**;
  `canReopen = completed` → **false**. Hidden.
- `WelcomeGetStarted` (`:41`) — `if (isLoading || personaCount > 0 || onboardingCompleted) return null`.
  Step 4 of the flow is `adopt`, which creates a persona. After step 4,
  `personaCount > 0` → **hidden**.
- `OnboardingProgressBar` (`:26-28`) — needs `onboardingActive` → **hidden**.

**Fix:** add `onboardingActive` and `onboardingStep` to `systemStore.ts`'s
`partialize`, and change the footer's `canResume` to
`!completed && (dismissedAtStep != null || anyStepCompleted)`. Deferred, not
applied — it changes what a live surface shows.

### 7.B — P0: five first-run surfaces, five storage answers, and the precedence rule lives in a README

| # | Surface | "Have I done this?" | Substrate |
| --- | --- | --- | --- |
| 1 | `FirstUseConsentModal` (`App.tsx:334`) | `hasUserConsented()` | localStorage, keyed by consent version |
| 2 | Onboarding overlay (`App.tsx:369`) | `onboardingCompleted \|\| personas.length > 0` | localStorage ×2 **+ derived** |
| 3 | Guided tour (`App.tsx:367`) | `tourCompleted` / per-tour map | localStorage `guided-tour-state`, `version: 4` |
| 4 | Tour handoff offer (`App.tsx:370`) | `tourHandoffOffered` | localStorage `onboarding-state-v1` |
| 5 | Power Moves (`home/sub_learning/powerMoves/`) | `done[id] \|\| tried[id]` | localStorage `power-moves-progress` |

Five surfaces, **four distinct localStorage keys**, one of them versioned in a
field, one versioned in its key name, two unversioned. Zero of the five are in
the database — so all five reset if the WebView profile is cleared and none of
them survives a device change, which
[`first-use-consent-gate`](./first-use-consent-gate.md) §7.D already recorded
for surface 1 and which generalises to all five.

The precedence rule between them is real and it is prose:
`TourLauncher.tsx:13-16` — *"Onboarding modal owns the screen — see precedence
contract in `src/features/onboarding/README.md`"* — enforced by one
`if (… || onboardingActive) return null`. Nothing enforces the other nine
pairwise orderings.

### 7.C — P1: the derived half of the first-run predicate is written three ways

- `onboardingSlice.ts:175` — `get().onboardingCompleted || storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS).length > 0`
- `WelcomeGetStarted.tsx:41` — `isLoading || personaCount > 0 || onboardingCompleted`
- `OnboardingProgressBar.tsx:26` — `onboardingCompleted || personas.length > 0`

Three spellings, three data paths (`storeBus` accessor, a `useAgentStore`
selector, a different `useAgentStore` selector), and only one of them accounts
for the in-flight fetch. The first will early-return during the initial persona
fetch and the third will flash. The slice's own comment at `:104-106` names this
race — *"the `startOnboarding` guard races `fetchPersonas`"* — and the fix it
describes (persistence) does not address the race at all; it addresses a
different symptom. Extract one `isFirstRun()` and call it three times.

### 7.D — P1: the same slice is persisted twice, by two mechanisms, with two failure modes

`onboardingSlice.ts:100-142` opens `onboarding-state-v1` and hand-rolls
load/save for `{completed, dismissedAtStep, tourHandoffOffered}`. Two of those
three fields are **already** in `systemStore`'s `partialize` (`:83-84`). So each
write happens twice and each read happens twice, in a fixed order: the slice's
initializers read `onboarding-state-v1` at construction (`:165`, `:169`, `:170`
— **three separate `localStorage.getItem` + `JSON.parse` round trips for one
object**), and zustand's rehydrate then overwrites two of the three from
`persona-ui-system`. The hand-rolled writer swallows its failures
(`silentCatch`, `:140`); the middleware's does not go through the same path. A
partial failure diverges the two copies silently and the *winner is always*
`persona-ui-system`, which is not the copy the slice's comment treats as
authoritative.

[`client-state-persistence`](./client-state-persistence.md) §7.E already lists
this class ("slices of a persisted store writing their own key — 3"). What is
new here is the field-level overlap — **2 of 3 duplicated, 1 of 3 unique** — and
the read-order that decides ties. `tourHandoffOffered` is the only field that
genuinely needs the second key, and it needs it for no reason; adding one line
to `partialize` retires 43 lines of hand-rolled persistence.

### 7.E — P1: the first-run surfaces mount above the router and declare their strings on one route

`GuidedTour`, `OnboardingOverlay` and `TourHandoffOffer` are rendered by
`App.tsx:367-370`, above any route. `TourLauncher` and
`OnboardingReplayFooterIcon` live in the always-mounted footer. Between them,
**16 files reference `t.onboarding.*` (160 references), plus
`features/shared/chrome/DesktopFooter.tsx`.** The `onboarding` section is
declared in `ROUTE_SECTIONS.home` and nowhere else (`routeSections.ts:57`).

`routeSections.ts:1-15` states the consequence in its own header: *"a section
listed nowhere here is NEVER fetched in a non-English locale … an undeclared
section renders English forever, in every locale, with no signal."* So on **10
of the 11 routes**, in any of the 13 non-English locales, all 174 `onboarding`
keys resolve to English — including the footer's "Resume setup" and the entire
tour panel chrome. `consent` and `remote_approval` are in `BASE_SECTIONS`
precisely because they mount at the root (`:36-39`); `onboarding` was not given
the same treatment.

[`translation-completeness`](./translation-completeness.md) §7 D1 counts 26
section/route pairs in this condition across 17 sections. **`onboarding` is not
among the 17** — this is a 27th pair and a new section, owed upstream.

### 7.F — P1: 14 locales, and the only code that reads the OS locale is the crash screen

Measured over 4,397 production files, two implementations agreeing: **2
occurrences of `navigator.language`, both in `main.tsx`, both serving
`ERROR_BOUNDARY_COPY`** (`:56-71`) — a 14-language × 3-string table hardcoded
inline, explicitly bypassing the catalog because *"the translation provider
could be the thing that threw"* (`:46-47`). That reasoning is correct. The
inversion is that it makes the **least-rendered surface in the app the only one
that knows what language the user speaks.**

The app-locale path: `i18nStore.ts:103` `language: 'en'`;
`main.tsx:149-159` `readPersistedLocale()` returns `"en"` when
`personas-i18n-storage` is absent; `main.tsx:175`
`if (language === "en") return;` — so on a genuine first run the preload, the
1.2 s timeout and the whole section-warming machinery are skipped, correctly and
uselessly. The first non-English paint problem this code was written to solve
cannot occur on the run where it matters most, because the code never learns
there is a problem.

**Fix:** in `readPersistedLocale()`, when nothing is persisted, narrow
`navigator.language` through the existing `isLocaleCode` and return it; write it
into `i18nStore` before mount. Deferred — it changes what a live surface shows,
for every user, on next launch.

### 7.G — P2: the 2026-08-17 purge put this installation back into a half-first-run state, and the halves disagree

All 78 personas were deleted on 2026-08-17. Every predicate in §7.C has a
`personas.length > 0` term, and that term is now `false` on this machine. What
each surface does next depends only on which *stored* boolean it also consults:

| Surface | Post-purge behaviour |
| --- | --- |
| `startOnboarding()` (`:175`) | the persona guard no longer blocks; only `onboardingCompleted` does |
| `WelcomeGetStarted` (`:41`) | the first-run CTA band **returns** unless `onboardingCompleted` is set |
| `OnboardingProgressBar` (`:26`) | would render again if the flow were re-entered |
| `TourLauncher` (`:23`) | unaffected — keyed on `tourCompleted` only |
| Power Moves `usedCount` | unaffected — a persisted latch, never re-derived |

So a data deletion reverts the derived half of first-run and not the stored
half, and the product's answer to "is this person new?" is now **partly yes**.
This is not a bug the purge introduced; it is a pre-existing seam the purge
*exposed*, which is the argument for §2.1. **These row counts are historical as
of 2026-08-17 and unreproducible against the live file** — measured against
`purge-backup-2026-08-17/personas.db`, copied read-only.

### 7.H — P2: the prose source→docs table names a directory that does not exist

`.claude/CLAUDE.md:489` maps `src/features/home/**`, `src/features/simple-mode/**`
→ `docs/features/home.md`. **`src/features/simple-mode` does not exist** (`ls`
exits 2; no directory under `src` matches `*simple*`). The *authoritative* map is
fine — `feature-doc-map.json`'s home entry carries `sourceGlobs:
["src/features/home/**"]` and nothing else, so the Stop hook is unaffected. What
is wrong is the prose quick-reference every agent is instructed to read, which
has drifted from the JSON it summarises, and which sends a reader looking for a
feature directory that was never there. Applied: documentation, corrected in
place.

The same home entry declares `onboardingFlows: ["desktop-discovery"]` — one of
the three registry flows that name no live tour step (see
[`guided-tour-step`](./guided-tour-step.md) §7.C). So the one onboarding nag
attached to the Home surface points at a flow the tour registry does not have.

---

## §8 Gaps — what the primitives genuinely cannot do

1. **localStorage is per-WebView-origin and the app has a database.** No
   first-run answer survives a profile clear, and none is portable across
   devices, even though the app ships cross-device pairing. This is not a
   primitive limitation so much as an unmade choice — but moving these five keys
   to SQLite means a first-run read now depends on the backend being up, which
   is why nobody has. State the trade-off before proposing the move.
2. **A derived predicate cannot distinguish "never started" from "finished and
   then deleted everything."** Brainiac's `?view=charts` escape hatch
   (`first-run.ts:19`) is the honest answer: derive by default, and give the
   user one click to say "I know, show me the empty product." This repo has no
   equivalent.
3. **The locale cannot be negotiated before the storage layer is readable.** If
   `localStorage` throws (the case `probeTourStorage` exists for), the persisted
   locale is unreadable and `navigator.language` is the *only* signal — which is
   an argument for §2.5, not against it.
4. **`onboardingStepCompleted` is a `Record<OnboardingStep, boolean>` written by
   a build that may not be the build that reads it.** `systemStore.ts:165-170`
   re-cleans it against `ONBOARDING_STEPS` on rehydrate, which handles a removed
   step but silently reports an *added* step as incomplete. That is the correct
   trade-off and it is worth knowing you made it.

---

## §9 The missing gate

### 9.1 What a gate here would have to catch, and why it cannot

The three highest-severity findings in §7 are all **absences**:

- 7.A — a field that is *not* in `partialize`.
- 7.E — a section that is *not* in `BASE_SECTIONS`.
- 7.F — a call to `navigator.language` that does *not* exist.

The census ratchets a count of something present; it cannot assert that
something is absent, and a rule that must be zero fails structurally. So the
honest §9 for this leaf is **one rule declined and one instrument specified.**

### 9.2 Declined: a census rule on first-run latches

The natural signal — a persisted one-time boolean — keys on `localStorage`, and
`raw-web-storage` already matches the bare identifier `localStorage` /
`sessionStorage` anywhere in `src` (**72 files / 186 matches**). Every site my
rule would report is a subset of its sites, at the site level, not merely the
file level. Per the doctrine's overlap rule that is a decline, and the decline is
worth more than the rule: **the reason this leaf's defects are invisible is not
that nobody counted the writes — it is that `partialize` and `BASE_SECTIONS` are
lists nothing compares against a domain.**

I also checked, and am not proposing rules overlapping:
`durable-view-token-with-no-rehydrate-arm` (persisted tokens without a repair
arm — 2 files / 19 matches; it keys on the `partialize` block itself and would
be the right host for a *widened* version, see 9.4), `asserted-definition-blob`
(`JSON.parse` of a persisted blob — 15 files), `frozen-ui-copy-constant`
(62 files / 818 matches — already covers the untranslated-copy family),
`unchecked-destination-id-assertion`, and `unverifiable-generated-artifact`.

### 9.3 Specified: `check-first-run-reachability.mjs` — an inventory, not a diff

The condition is *"every field a mounted first-run surface reads is either
durable or provably re-derivable"*. That needs an inventory of what should
exist, which is the shape the doctrine says a diff cannot see. Specification:

- **Input A** — the fields listed in `systemStore.ts`'s `partialize` (parse the
  object literal).
- **Input B** — the fields each `src/features/onboarding/**` component and
  `DesktopFooter`'s replay icon read from `useSystemStore`.
- **Assert** — every field in B that appears in a `return null` guard is in A,
  *or* is derived from a store the app refetches on boot.
- **Fail loudly if its own precondition is absent:** exit 2 when the
  `partialize` parse yields fewer than 20 fields, or when input B yields zero
  guards. `check-csp-hosts.mjs` exists because of exactly this class, and it
  reported zero twice before its exit-2 guard was added.

A second, cheaper assertion belongs in the same script: **every i18n section
referenced by a component rendered from `App.tsx` above the router is in
`BASE_SECTIONS`.** Input is `App.tsx`'s root-level JSX plus a `t.<section>.`
scan of the transitive imports; it would report `onboarding` today (§7.E) and
nothing else.

### 9.4 The type that would beat both

`partialize` returns a free-form object literal, so omitting a field is
spellable. Make it total: type the return as
`Required<Pick<SystemStore, PersistedSystemKey>>` where `PersistedSystemKey` is
an explicit union maintained beside the slice interfaces. Adding a field to a
slice that belongs in the union then fails to compile until it is listed.
This is the Q5 form — *withhold the freedom to omit* — and unlike a gate it
cannot be satisfied by a stale allowlist. It does not reach §7.E or §7.F
(different boundaries), and it is the only one of the three that a type reaches
at all.

---

## §12 Corrections

### 12.1 `sides: "client"` — tested, and it **holds**, for a nameable reason

Every deviation in §7, the exemplar in §6, the declined rule and the specified
instrument are client-side. The backend contributes nothing: there is no
first-run row, no server-side "has this user onboarded", and `companion_tours`
— the only onboarding-adjacent table — holds **0 rows** in the 2026-08-17
backup. The mechanism, which is what the doctrine asks for when a label
survives: **first-run-ness here is a property of an installation's local
storage, and the server has no installation.** Same family as the two prior
upholdings (`bulk-selection-actions`, `long-list-rendering` — *the server never
sees the DOM*); this one is *the server never sees the profile.* That takes the
tested-and-upheld `sides: "client"` count from 2 to 3 against 7 contradictions.

### 12.2 `convergence: "converged"` — FAILS, and the failure is the useful part

Fourteenth `converged` label tested; fourteenth failure. The mode is one the
ledger already names — **the fleet converged on the disease** — and it appears
*twice on one leaf*, which is new:

- **Locale negotiation: 0 of 5.** Nobody asks the OS. Perfect agreement on an
  omission.
- **First-run detection: the label's direction is inverted.** Two of three
  independent siblings converge on *deriving* the predicate — which is what this
  repo does **not** do (it does both, and the stored half is what breaks). A
  brief that read `converged` as "Personas already agrees with the fleet" would
  have skipped the finding that produced §0.

### 12.3 Two claims in my own brief, corrected

- **"`setup-checklist` most likely lives in `src/features/home/**` and/or
  `src/features/simple-mode/**`."** `src/features/simple-mode` **does not
  exist**; the reference traces to `.claude/CLAUDE.md:489` (§7.H). The `home`
  half is right but incomplete — see [`setup-checklist`](./setup-checklist.md).
- **"`preloadPersistedLocaleBeforeMount()` is bounded by a 1.2 s timeout … so
  what does a first-run non-English user actually see on first paint?"** The
  timeout is real and it is **not reachable on a first run**: `main.tsx:175`
  returns before the race when the locale is `en`, and on a first run it always
  is. The brief's framing implied the flash was a *timing* problem; it is a
  *negotiation* problem, and the fix is 3 lines upstream of the race (§7.F).

### 12.4 A correction owed to a published path

[`translation-completeness`](./translation-completeness.md) **§7 D1** — "26
section/route pairs render English on a cold start · 17 sections · 121 files".
The `onboarding` section is a **27th pair and an 18th section**, and it is the
worst-shaped instance of the class in the tree, because the surfaces that use it
mount above the router in `App.tsx` and therefore render on *all* routes while
the section is declared on one. Recommend adding `onboarding` to that path's
inventory and to `BASE_SECTIONS`.

### 12.5 A correction owed to a subagent finding I nearly published

An assisting sweep reported that `onboardingStepCompleted` is **in-memory only**,
having read `PersistedOnboarding` (`onboardingSlice.ts:111-115`) and found it
absent. It is persisted — `systemStore.ts:85`. The slice's own hand-rolled
record is not the record; the store's `partialize` is. I had drafted §7.A around
the wrong field before checking `systemStore.ts`, and the *real* finding turned
out to be sharper than the wrong one: the fields that are lost are `active` and
`step`, which no one thought of as progress at all. **Reading a slice's own
persistence helper and concluding what is durable is exactly the mistake §7.D
describes** — when a slice of a persisted store opens a second key, the second
key looks authoritative and is not.

---

*Measured 2026-08-17. Instruments and raw output:
`scratchpad/wbB-flows/wbB-anchors-implA.mjs`, `wbB-anchors-implB.mjs`,
`wbB-registry.mjs`, `wbB-replay.mjs`, `wbB-every.mjs`. Database claims come from
`%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`, copied and
queried read-only; the copy has been deleted.*
