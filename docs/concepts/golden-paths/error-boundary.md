# Golden path — Error boundary

> Situation node: `client-runtime/client-errors/error-boundary` ·
> [situation spine](../situation-spine.md) · recurrence 23 · risk **medium** ·
> sides: **client** · convergence: **mixed** ·
> dimensions: **resilience · ui · function**
> Composed 2026-08-16 against `master` @ `b4a05049e`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` files under `src/`; **2,104** of them `.tsx`. Every
> `getDerivedStateFromError` / `componentDidCatch` implementation in the tree (**4** production, 1 in
> a test), every `*ErrorBoundary` JSX declaration (**46**, parsed with a tag-scanner rather than a
> line grep), every `<Suspense` site (**89** in 47 files), every direct `@sentry/*` importer (**21**).
> `ErrorBoundary.tsx`, `App.tsx`, `main.tsx`, `sectionRouter.tsx`, `PersonasPage.tsx`,
> `OverviewPage.tsx`, `ChartErrorBoundary.tsx`, `ThreeViewer.tsx`, `lazyRetry.ts`,
> `lazyRetry.test.tsx`, `crashPersistence.ts`, `sentry.ts`, `log.ts`, `silentCatch.ts`,
> `preloadErrorRecovery.ts` and `@sentry/react`'s own `errorboundary.js` / `error.js` read in full.
>
> **Measured by execution, not by reading.** Sixteen scratch renders were run through the repo's own
> vitest + jsdom harness: the shipped `ErrorBoundary` and `ChartErrorBoundary` were crashed for real,
> and `renderSectionRoute` (`sectionRouter.tsx:87-100`) and `SilentErrorBoundary` (`App.tsx:74-102`)
> were **transcribed verbatim** and replayed against a crashing child and a dead chunk. §0 publishes
> what the screen actually did. The probe files were deleted after the run — and their own presence
> is a §9 correction (they inflated the first census reading from 25 to 34).
>
> **And against live data.** The operator's `frontend_crashes` table was read from a **read-only copy**
> of the live 347 MB `personas.db` (copied 2026-08-16 22:45 UTC, never opened for write, **copy
> deleted**): **84 real frontend crashes** between 2026-05-25 and 2026-08-14, on version 1.1.0. No
> secret or user content is reproduced here — component names, message shapes and counts only.
>
> **`cargo` was not run.** The one Rust file cited (`crash_telemetry.rs`) is a static read.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It inverted one clause of my own draft, supplied
> the corpus's best negative evidence (a sibling that *deliberately* gave up framework boundaries and
> wrote down the invoice), and found the **strongest silence in the sweep**.
>
> **Settles:** where a boundary goes, what its fallback may touch, what "reset" actually does, what
> reaches the operator — and the three failure classes that never reach a boundary at all.
>
> **Does not settle:** which module becomes a chunk and how a chunk failure recovers — that is
> [`lazy-route-chunk`](./lazy-route-chunk.md), which owns the `raw-react-lazy` rule (105 sites) and
> the "a retry ladder cannot recover a cached module rejection" anti-pattern. This path cites it and
> does not re-derive it.

---

## 0. The headline

**This application has one error boundary instance for its entire content area, and it does not
forget.** Crash any section, then navigate anywhere else with the sidebar: the healthy section never
renders, and the crash card **retitles itself with the healthy section's name**.

`PersonasPage.tsx:404-406` is the whole mechanism:

```tsx
{/* AnimatePresence disabled — testing if framer-motion layout measurement causes freeze */}
<div className="flex-1 flex flex-col w-full min-w-0 overflow-y-hidden">
  {renderContent()}
</div>
```

`renderContent()` is a switch whose every branch returns `<ErrorBoundary …>` — 20 declarations in
that file plus `renderSectionRoute`'s (`sectionRouter.tsx:94`), covering all 10 rail sections and
every sub-route. Same element type, same position, **no `key`** → React reconciles them as **one
instance**, and `hasError` is instance state.

Replayed against a verbatim transcription of `renderSectionRoute`:

| step | what the screen showed |
|---|---|
| mount section A (crashing) | `Something unexpected happened in **SectionA**` — correct |
| click through to section B (healthy) | `Something unexpected happened in **SectionB**` — **section B never rendered, and it is blamed for section A's crash** |
| same shape with `key={section}` added | section B's content, immediately |

The name in the card is `this.props.name` re-read at render time (`ErrorBoundary.tsx:135-137`), while
`componentDidCatch` already persisted the crash under the *old* name (`:50`). **The screen and the
crash log name two different components, and the crash log is the one that is right.**

**46 boundary declarations in 18 files. `key` or `resetKeys`: 0 of 46.**

### Then look at what the fallback offers you instead

`ErrorBoundary`'s card has a **Go to Dashboard** button. It calls `this.props.onGoHome?.()` and then
`onReset()` (`ErrorBoundary.tsx:98-111`). **21 of the 34 shared-boundary declarations pass
`onGoHome`; 13 do not** — and at those 13 the optional call is a no-op, so the button is
byte-for-byte "Try Again" with a different label. Executed:

```
renders after crash                    : 3
after clicking "Go to Dashboard"       : renders = 5 · still on the fallback · location unchanged
after clicking "Try Again"             : renders = 7 · still on the fallback
```

On the operator's live install, **7 of the 84 recorded crashes landed on exactly those cards**
(`Dashboard` ×2, `Overview/patterns` ×3, `Overview/executions` ×1, `Overview/manual-review` ×1).

And the crashes that land there are the kind reset cannot fix. Of 37 distinct boundary-caught
messages on this install, six are plain `ReferenceError`s — `readinessSkew is not defined` (×3),
`RescanConfirmButton is not defined` (×3), `pageErr is not defined` (×2), `SegmentedTabs is not
defined` (×2), `midVariant is not defined`, `useTranslation is not defined`. **A missing import is
deterministic: "Try Again" re-runs the same module and lands on the same card, forever.**

### And nothing above the boundary ever hears about it

Executed: with an inner boundary present, the root boundary's `getDerivedStateFromError` fires
**0 times**. That is the point of a boundary — and it is also the whole telemetry story, because:

| implementation | sites | Sentry **event** | Sentry breadcrumb | durable crash log |
|---|---:|---|---|---|
| `feedback/ErrorBoundary` | **34** | ✗ | ✗ | ✅ `persistCrash` → localStorage + SQLite |
| `ChartErrorBoundary` (`sub_usage/ChartErrorBoundary.tsx:31`) | **9** | ✗ | ✗ | ✗ |
| `SilentErrorBoundary` (`App.tsx:86`) | **2** | ✗ | ✗ | ✗ |
| `ViewerErrorBoundary` (`ThreeViewer.tsx:109`) | **1** | ✗ | ✅ (`silentCatch` adds a *breadcrumb*, not an event) | ✗ |
| `Sentry.withErrorBoundary(App)` (`main.tsx:190`) | 1 (root) | ✅ | — | ✗ |

**Zero of the 46 in-tree boundary declarations produce a Sentry event.** `createLogger(...).error` is
`console.error` and nothing else (`log.ts:36-38, 62-67`); `Sentry.init` declares no
`captureConsoleIntegration` (`sentry.ts:200-261`), so a boundary's log line becomes at most a
breadcrumb on some *later* event that, by construction, will not be this one.

The single boundary that does report files its reports as **handled**:

```js
const handled = this.props.handled != null ? this.props.handled : !!this.props.fallback;
```
— `node_modules/@sentry/react/build/cjs/errorboundary.js:38`

`main.tsx:190-238` passes a `fallback` and no `handled`, so **every whole-app white-screen is
reported to Sentry as `handled: true`** and never touches crash-free-sessions. The one metric that
would tell the operator the app is blanking in the field is structurally unable to move.

### The three failure classes no boundary catches — and they are 29% of real crashes

Executed inside a live boundary:

| throw site | boundary caught it | escaped to the caller | UI |
|---|---|---|---|
| `onClick={() => { throw }}` | **no** | no | unchanged |
| `setTimeout(() => { throw })` | **no** | — | unchanged |
| `Promise.reject(...)` unhandled | **no** | — | unchanged |

`main.tsx:104-142` covers all three with `window.onerror` + `unhandledrejection` → logger + Sentry +
`persistCrash`. That is **telemetry, not UI** — the user sees nothing at all. On the live install
**24 of 84 crashes (29%) arrived through those two handlers rather than a boundary**, including six
chunk-load failures. Nothing in the app renders anything for them.

### The one thing that is genuinely excellent here

`persistCrash` (`crashPersistence.ts:78-130`) sanitizes the message, the stack **and** the component
stack through `sanitizeErrorMessage` plus two crash-specific passes (URL query/fragment stripping,
stack-argument redaction), then writes to localStorage **and** to SQLite via
`report_frontend_crash` (`crash_telemetry.rs:67`), surfaced in-app at
`SystemHealthPanel.tsx:117` → `CrashLogsSection.tsx:59`. **No sibling repo has any of this.** It is
also how §0 was measured — a golden path that could only be written because the boundary kept
receipts.

Its one hole is 40 lines away in the same file. The **Copy report for support** button
(`ErrorBoundary.tsx:113-122`) assembles `error.message` + `error.stack` + `componentStack` and puts
them on the clipboard **with no sanitizer at all**. Executed with a synthetic error carrying a query
string:

```
clipboard payload contains the raw query string : true
persisted-crash entry contains it               : false
```

Same component, same error, same instant — one channel redacted, one not, and the unredacted one is
the one whose entire purpose is to be pasted somewhere else.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics. A boundary is a latch, not a filter: it has memory, and its memory outlives the
> failure.** Whatever decides *what renders underneath* must also decide *when the latch clears*. If
> the subtree is chosen by a route, a tab or an id, the boundary must be given a fresh identity when
> that value changes — otherwise a healthy surface inherits the previous surface's crash, and the
> user has no way to know the two are unrelated.
> *Warrant: independently hit and documented in two sibling repos, which shipped two different fixes
> (a route-derived reset key; a compared `resetKeys` array) with no shared document. State-only reset
> that cannot re-mount is the majority behaviour — 3 of the 4 React siblings.*
>
> **P2 — physics. The blast radius is chosen when you place the boundary, not when it fires.** One
> boundary over N siblings is a decision that all N vanish together. Placing it at the switch is
> right; placing it above the switch means the switch cannot escape it, and placing it below means
> the switch is unprotected.
> *Warrant: measured here at 15 components behind one boundary; across six codebases, per-panel
> boundaries exist once and per-chart/per-table boundaries exist in one repo only.*
>
> **P3 — physics. A fallback runs inside a tree that has just proved it can throw.** Everything the
> fallback needs must be reachable without the thing that broke — no hook that reads app state, no
> deep dereference into a lazily-parsed translation tree, no formatting of the failed value. A
> fallback that throws does not fail locally: it escalates to the *parent* boundary, and if there is
> none the whole tree unmounts to nothing.
> *Warrant: executed — a throwing fallback with no parent boundary leaves an empty DOM and rethrows
> into the caller of `render()`. The riskiest fallback found in six codebases both calls a hook and
> walks a three-level translation path.*
>
> **P4 — physics. "Try again" is a recovery only for a non-deterministic failure.** For a missing
> import, a bad prop, or a module whose load already failed and was cached, reset re-runs the same
> code and returns to the same card. An automatic retry ladder against a deterministic failure spends
> all its attempts in milliseconds and then stops, silently.
> *Warrant: executed — a 5 s/15 s/45 s three-attempt ladder against a cached module rejection
> produced four catches and **zero** additional load attempts. On a live install, six distinct crash
> signatures are `X is not defined`.*
>
> **P5 — ergonomics. Every escape a fallback offers must actually leave.** A button naming a
> destination that it cannot reach is worse than no button, because the user stops looking for
> another way out. If the host did not supply a way home, do not render the offer.
> *Warrant: 13 of 34 declarations here; 7 real crashes landed on one.*
>
> **P6 — physics. A boundary that catches is a boundary that hides.** Nothing above it — including
> the crash reporter — will see that error again. Coverage and observability trade directly against
> each other unless the boundary reports for itself.
> *Warrant: executed at 0 root-boundary invocations while an inner boundary is present. Across six
> codebases, exactly one boundary implementation reports to an error tracker.*
>
> **P7 — physics. A boundary catches render and lifecycle only.** Event handlers, timers, and
> rejected promises never reach it — and that is most of an application's failure surface. Covering
> them needs a *different mechanism*, and covering them for telemetry is not covering them for the
> user.
> *Warrant: executed, all three classes invisible to the boundary. **0 of 5 sibling repos install any
> global handler at all**, the strongest silence in the sweep; and 29% of this install's real crashes
> arrived through that route.*
>
> **P8 — ergonomics. Report from the state you captured, not from props you re-read.** A fallback
> that renders live props renames itself when the surrounding tree changes, and then confidently
> misattributes the failure.
> *Warrant: executed — the card renamed itself to the healthy section, while the durable crash record
> written at catch time kept the correct name.*
>
> **Scale condition.** P3, P5 and P7 are wrong on day one, at a single boundary. P1 and P8 bite the
> first time two surfaces share a boundary position — which is the first time you add a router. P2
> and P6 bite when the boundary count grows past one. P4 bites the first time a failure is
> deterministic, which on the evidence here is most of the time.

---

## 1. Trigger

- "This tab crashed and now the whole app is a grey card."
- "I clicked away and it's *still* showing the error."
- "Wrap it in an error boundary so it doesn't take the page down."
- "Retry doesn't do anything."
- "The chart blew up on a NaN — can we just hide that one tile?"
- "Why is this crash not in Sentry?"

**If you are about to write** `getDerivedStateFromError`, `componentDidCatch`, `<ErrorBoundary>`, or
a `<Suspense>` around a component whose module is fetched at runtime — **you are in this situation.**

You are **not** in this situation for a failed *fetch* (that is
[`partial-failure-read-envelope`](./partial-failure-read-envelope.md) and
[`error-surfacing-policy`](./error-surfacing-policy.md)); for choosing what a chunk is or how it
recovers ([`lazy-route-chunk`](./lazy-route-chunk.md)); or for a caught exception you are about to
turn into a message ([`error-message-resolution`](./error-message-resolution.md)).

### Boundaries with the adjacent leaves

- [**`lazy-route-chunk`**](./lazy-route-chunk.md) owns **what becomes a chunk, and chunk recovery**
  — including that a boundary reset cannot re-import a cached rejection, and the three in-repo
  comments that claim otherwise. This path owns **the boundary as an object**: where it goes, what its
  fallback may touch, when its latch clears, and who hears about it. The two meet at
  `sectionRouter.tsx`, which is the exemplar for both.
- [**`error-surfacing-policy`**](./error-surfacing-policy.md) owns **toast vs banner vs inline** for a
  failure you caught. This path owns the failure you *didn't* catch — the one that already killed the
  subtree that would have rendered the banner.
- [**`swallowed-error-telemetry`**](./swallowed-error-telemetry.md) owns **whether a background
  rejection leaves a trace**. Its `bindingless-catch-on-io` rule cannot see any of this leaf: a
  boundary has no `catch` clause. §0's telemetry table is that path's question asked of a place it
  does not look.
- [**`partial-failure-read-envelope`**](./partial-failure-read-envelope.md) owns **a source that
  didn't answer**. This path owns **a render that didn't finish**. Its §8 Gap 1 (the loading doctrine
  has three states and needs a fourth) is the same hole from the data side; §8 Gap 4 here is the
  render side.
- [**`first-use-consent-gate`**](./first-use-consent-gate.md) owns **whether telemetry may leave the
  device**. §0's `handled: true` finding is downstream of its `consent-bypassing-telemetry-import`
  rule, not a duplicate of it: the root boundary is consent-gated *by accident* (no `Sentry.init` →
  no client → the capture is inert), which is the right outcome from the wrong mechanism.
- [**`secret-and-pii-redaction`**](./secret-and-pii-redaction.md) owns **the redactor**. This path
  owns **the two channels a crashed component opens** — one of which it does not visit (§7 D6).
- [**`panic-isolation`**](./panic-isolation.md) is the backend mirror: a task that dies without
  taking the process with it. Its `unobservable-detached-task` rule (86 files) and P6 here are the
  same principle on two runtimes — *isolation without a report is deletion*.

## 2. The one way

**Put the boundary at the place that chooses the subtree, give it a `key` derived from that choice,
and give its fallback nothing to depend on except the error and a way out.** Concretely: (a) declare
it **at the switch** — the router, the tab bar, the `.map()` that renders N panels — never inside the
surface it protects and never so far above the switch that the switch cannot escape it; (b) **key it
with whatever the switch varies** (`key={section}`, `key={tab}`, `key={row.id}`), because the latch
is instance state and a new choice deserves a new instance — this is the single edit that would have
prevented §0, and 0 of 46 declarations here have it; (c) **hand it a way home** (`onGoHome`) and, if
you cannot, **do not render the offer** — a button that names a destination it cannot reach is worse
than the absence of a button; (d) **keep the fallback dependency-free**: no store read, no hook that
can suspend or throw, no deep dereference into a lazily-parsed translation tree; the app root's
fallback shows the shape — a static per-language copy table keyed off `navigator.language`, chosen
*because* the translation layer may be the thing that threw; (e) **report from the boundary itself**,
because nothing above it will get a second chance — one call, at catch time, carrying the component
name, the message, the stack and the component stack, through the same sanitizer the rest of the app
uses; (f) **capture what you report and render what you captured** — never re-read live props into
the card, or it will rename itself; (g) **do not build a retry ladder** — a timer that re-renders the
same subtree is a recovery only for a failure that was transient, and the measured majority are not;
one user-initiated reset is honest, an automatic ladder is a lie with a schedule; (h) **cover the
async gap separately and deliberately** — one `window.onerror` and one `unhandledrejection` listener,
installed before React mounts, feeding the *same* report path; do not pretend the boundary covers
them. Then stop: do not nest a second boundary to catch the first one's fallback, do not render
`null` on a surface the user is looking at, and do not add a boundary you have no intention of
reporting from.

If you must get one right first: **(b)**. (c), (d) and (e) each fail loudly or visibly. (b) fails as
a *correct-looking card about the wrong component*, and there is no signal — not a log, not an event,
not a support ticket — by which anyone learns the section they are looking at is fine.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/features/shared/components/feedback/ErrorBoundary.tsx:33` — `<ErrorBoundary name onReset onGoHome>` | **the one boundary to reach for.** Chunk-aware copy (`isChunkLoadError` → a *Reload App* button, `:96,:157-166`), a 14-locale card, a details disclosure that is collapsed by default so the raw stack is not on screen, and `persistCrash` at catch time. **34 declarations.** Its gaps are §8 Gaps 1–3. |
| `src/lib/utils/crashPersistence.ts:78` — `persistCrash(label, error, componentStack?)` | **the report call, and the best thing in this leaf.** Sanitizes message + stack + component stack (`sanitizeCrashString`, `:22-32`), writes localStorage (bounded to 20, with a sessionStorage fallback on quota) **and** SQLite via `report_frontend_crash`. Fire-and-forget; never blocks recovery. Call it from every boundary you write. |
| `src/features/overview/components/health/CrashLogsSection.tsx:59` + `SystemHealthPanel.tsx:117` | **where the reports surface.** `readCrashLogs()` merges the localStorage and sessionStorage halves and trims. The loop is closed in-app, with no third party involved. |
| `src/main.tsx:104-142` — `window.onerror` + `unhandledrejection` | **the async-gap cover (P7).** Registered synchronously before React mounts, so no early crash is lost; suppresses the known Tauri `send was called before connect` storm (`:127`); defers Sentry behind a `sentryReady` flag so a pre-init crash still logs and persists. **0 of 5 sibling repos have any equivalent.** |
| `src/main.tsx:50-80` — `ERROR_BOUNDARY_COPY` / `errorBoundaryCopy()` | **the dependency-free fallback (P3), and the reasoning is in the comment**: *"this renders when the React tree itself crashed, so `useTranslation()` may be unsafe here (the translation provider could be the thing that threw)."* 14 languages as a static object, `navigator.language` in a `try`, English on anything unknown. Copy this shape for any top-level fallback. |
| `src/lib/lazyRetry.ts:12` — `isChunkLoadError(error)` | **the one branch a fallback should take on the error's identity.** Three engines' message shapes; tolerates non-`Error` input. It is what turns a generic card into *"reloading usually fixes it"* plus a button that does. |
| `src/lib/recovery/preloadErrorRecovery.ts:36` — `installPreloadErrorRecovery()` | **automatic chunk recovery in production builds**, throttled at 30 s against reload loops, fully injectable for tests. Not a boundary — it fires before one would. See [`lazy-route-chunk`](./lazy-route-chunk.md) §8 Gap 4 for its dev-mode absence. |
| `src/features/personas/sectionRouter.tsx:87-100` — `renderSectionRoute(section, onGoHome, fallback?)` | **the factory, and the place to fix ten sites with one line.** It already owns the `ErrorBoundary → Suspense → Component` order and threads `onGoHome`. Add `key={section}` inside it and every rail section becomes non-sticky permanently, with nothing for a caller to forget (§4, *type over gate*). |

**Do NOT build:** a second boundary class because the shared one "does too much" (there are already
four, and three of them report nothing); a boundary that renders `null` on a surface the user is
looking at (§7 D3); an automatic retry ladder (§7 D4); a fallback that calls `useTranslation()` at
the app root (`main.tsx` explains why); a `catch` in an event handler that sets a component-level
`hasError` flag — that is [`error-surfacing-policy`](./error-surfacing-policy.md)'s inline banner,
not a boundary, and conflating them is how P7 gets forgotten.

## 4. Steps

1. **Find the switch.** Whatever chooses the subtree — a `sidebarSection`, a `tab`, a `row.id`. If
   there is no switch, the boundary goes at the top of the surface and steps 2 and 6 are trivial.
2. **Declare the boundary at the switch, outside the `Suspense`.** `ErrorBoundary → Suspense →
   Component`, in that order. Suspense catches the pending promise; only the boundary catches the
   rejection.
3. **Key it with the switch value.** `<ErrorBoundary key={section} …>`. One prop. This is the step
   this repo skipped 46 times out of 46, and §0 is the cost.
4. **Decide the blast radius out loud (P2).** Everything inside this boundary disappears together;
   write the reason in a comment if it is more than one component. `App.tsx:356-362` is the model —
   it names the trade it made and calls per-item isolation a follow-up.
5. **Pass `onGoHome` — or delete the offer.** If the host cannot navigate, the card must not claim
   it can.
6. **Report at catch time, once.** `persistCrash(name, error, errorInfo.componentStack)`. Capture the
   name into state in the same call if the card will display it (P8).
7. **Write the fallback against the error and nothing else.** If it needs copy, it may use the
   translation layer *only* when the boundary is below the layer that provides it; at or above that
   layer, use a static table. If it renders the stack, put it behind a collapsed disclosure — the
   shipped card does.
8. **Branch on `isChunkLoadError` and offer a reload.** Reset cannot fix a module that already failed
   to load; a reload can.
9. **Cover the async gap once, globally, not per-boundary** (P7) — and be explicit in review that
   handler/timer/promise failures are *not* covered by anything you just wrote.
10. **Test the boundary you shipped, not a mock of it.** One render that throws, one click on every
    button in the fallback, one assertion that the button did what it says. The repo's only
    boundary test uses a local 12-line mock (§8 Gap 5).
11. **And then stop.** Do not nest a boundary to protect the fallback, do not add a timer, do not
    render `null` on a visible surface, and do not add a boundary you will not report from.

### Can the type make the wrong call impossible? — asked before §9

**For the latch: yes, and it is one line inside a factory that already exists.** The bad state is
*"a boundary instance survived the thing it was scoped to."* Hold the candidates against the seven
qualifications:

- A **required `resetKey` prop** on `ErrorBoundary` fails **Q4** (*a type anyone can construct
  authenticates nothing*): `resetKey="x"` type-checks and changes nothing. It is a required prop that
  encodes a promise, not a constraint.
- **Withholding is the answer (Q5), and `renderSectionRoute` is already the withholding door.** It
  takes the `section` and returns the mounted subtree; callers never touch `<ErrorBoundary>` at all.
  Move `key={section}` *inside* it and the dangerous freedom — deciding whether to reset — is not
  handed back. **10 of the 46 sites become correct-by-construction with one line, and no future caller
  can forget.** This is the same shape as `personas-web`'s `createLazySection`, whose factory scores
  22/22 against 2/31 for its hand-rolled siblings.
- **Q6** (*withhold the dangerous freedom, not the answer*): the factory still takes the section, so
  nothing about the feature is withheld — only the reset decision.
- **Q3** (*a type nobody constructs constrains nothing*): safe — `renderSectionRoute` has 5 call
  sites in `PersonasPage.tsx` covering all 10 rail sections, and `SECTION_ROUTES` already carries a
  `satisfies Record<RoutableSection, SectionRoute>` guard that fails the typecheck when a section is
  added without a route.
- **Q7** (*withholding a requirement only helps when the requirement forced the bad value*): not
  applicable — nothing forces the bad value; the defect is omission at the construction site, which
  is exactly what a factory removes.
- The remaining **20 declarations in `PersonasPage.tsx`** are *not* reachable by that factory (they
  are sub-route branches, not rail sections), so for them the honest answer is a `key` at the call
  site and a ratchet — which is what §9 is for.

**For the async gap: no, and this is a "types cannot reach" case.** React's design excludes event
handlers, timers and promise rejections from boundaries; no signature change reaches a `throw` inside
a `setTimeout` callback. The answer is a *mechanism* (a global listener feeding the same report path),
and the repo already has it. Saying so is the finding.

**For "the fallback can throw": no type, and a lint rule would be guessing.** Whether
`useTranslation()` is safe depends on where the boundary sits relative to the provider — a question no
signature and no AST can answer. The answer is doctrine (P3) plus the `main.tsx` exemplar.

**And one destination needs fixing before any gate points at it** (contract, fifth §9 failure mode):
`ErrorBoundary` has **no `resetKeys` prop and no test**, and its `onGoHome` is **optional**, which is
what makes 13 of its 34 call sites render a dead button. Routing more callers to the primitive while
the primitive's own default is a lying button just multiplies the defect.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A boundary at a switch with no `key`** | The latch outlives the crash. Executed: the healthy section never renders and the card **renames itself to the healthy section**. 46 of 46 declarations here. §7 D1. |
| **A fallback button naming a destination the host never wired** | It silently degrades to "Try Again". 13 of 34 sites; 7 real crashes landed on one. §7 D2. |
| **A boundary that renders `null` on a visible surface** | The failure becomes indistinguishable from "this feature isn't here". Executed: the container's `innerHTML` is `""` — no card, no button, no signal. `App.tsx:351,:363` cover 15 components this way. §7 D3. |
| **An automatic retry ladder** | For the dominant, deterministic failures it re-runs the same code on a schedule. Executed against a cached module rejection: 4 catches, **0** additional load attempts, then silence forever. §7 D4. |
| **A fallback that calls a hook or walks a translation path** | It throws inside the boundary's own render and escalates to the parent — or, with no parent, unmounts everything. Executed: `render()` rethrows to the caller and the DOM is left empty. §7 D5. |
| **`console.error` as a boundary's report** | It is a breadcrumb at best, and only if some *other* event ships later. 45 of 46 declarations. §0. |
| **Relying on the root boundary to see inner crashes** | Executed at 0 invocations. Adding a boundary *removes* an error from telemetry unless the boundary reports for itself. |
| **`Sentry.ErrorBoundary` with a `fallback` and no `handled`** | Every white-screen is filed as `handled: true` and crash-free-sessions never moves. `errorboundary.js:38`. |
| **Rendering `error.message` raw in the fallback** | The app root does this (`main.tsx:218`) while the shared card deliberately hides it behind a disclosure. Two policies for the same payload; the more exposed one is at the more public surface. §7 D6. |
| **Copying an unsanitized crash report to the clipboard** | Executed: the clipboard payload keeps a URL query string that the sibling `persistCrash` call, 40 lines away, strips. §7 D6. |
| **Reading `this.props` in the card instead of the state you captured** | The card misattributes the crash the moment anything around it changes. §0, P8. |
| **A boundary around the data-fetching component instead of the render** | Catches nothing: a rejected fetch is not a render throw (P7). That is [`partial-failure-read-envelope`](./partial-failure-read-envelope.md)'s leaf. |
| **"We have an error boundary, so the app can't white-screen"** | It can: via a throwing fallback (§7 D5), via chrome mounted outside every boundary (§7 D7), or via any of the three async classes (P7). |

## 6. Evidence

**The one site to copy: `src/features/personas/sectionRouter.tsx:87-100` — plus the one-line fix it
is missing.**

```tsx
export function renderSectionRoute(
  section: RoutableSection,
  onGoHome: () => void,
  fallback: ReactNode = SectionFallback,
): ReactNode {
  const { Component, boundaryName } = SECTION_ROUTES[section];
  return (
    <ErrorBoundary onGoHome={onGoHome} name={boundaryName}>   {/* + key={section} */}
      <Suspense fallback={fallback}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}
```

Five decisions worth copying: (1) the boundary is declared **at the router**, so the switch can
escape it; (2) the order is `ErrorBoundary → Suspense → Component`, so a chunk rejection has
somewhere to land; (3) `onGoHome` is a **required parameter of the factory**, so the escape hatch
cannot be omitted the way it is at the 13 hand-written sites; (4) `boundaryName` travels in the route
table, so the crash log gets a stable, greppable identity rather than a file path; (5) the whole
shape is one function, which is why fixing (b) for ten sections is one line rather than ten edits.

**The fallback to copy for anything at or above the provider layer: `src/main.tsx:50-80`.**

```ts
// This renders when the React tree itself crashed, so useTranslation() may be
// unsafe here (the translation provider could be the thing that threw). A static
// lookup against navigator.language covers the 14 supported locales …
function errorBoundaryCopy(): ErrorBoundaryCopy {
  try { return ERROR_BOUNDARY_COPY[(navigator.language || "en").slice(0,2).toLowerCase()] ?? EN_ERROR_COPY; }
  catch { return EN_ERROR_COPY; }
}
```

P3 in nine lines, with the reasoning written down. The `try` around `navigator.language` is not
paranoia — it is the same discipline applied one level deeper.

**The report call to copy: `src/lib/utils/crashPersistence.ts:78-130`** — sanitize, then localStorage
(bounded, with a quota fallback), then the backend, fire-and-forget. And the durable half is what
made §0 measurable: 84 real crashes over 81 days, with component names, versions and timestamps.

**Also exemplary:**

- `src/App.tsx:356-362` — the clearest *why this blast radius* comment in the repo, including the
  admission that per-overlay isolation is a follow-up. Its `render()` is still `null` (§7 D3), so it
  is exemplary as **reasoning**, not as implementation.
- `src/lib/lazyRetry.ts:52-60` — a primitive that documents its own **removed** v1 and why. The
  boundary's behaviour is downstream of that decision.
- `src/main.tsx:120-127` — an `unhandledrejection` handler that suppresses one known-benign message
  by exact string match, with the reason and the blast radius (*"tens of thousands of log lines"*) in
  the comment. A named suppression is a decision; a bare `return` is not.

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** `personas-cloud` has **zero `.tsx` files and
no `react` dependency** — it is a structural silence on every clause, not an oversight, so
React-requiring clauses are scored n/4 with the verdict stated as n/5.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A hand-rolled class boundary gets independently reinvented** | **PHYSICS 4/4** | `personas-web/src/components/dashboard/DashboardErrorBoundary.tsx:41`; `brainiac/console/app/console/ModuleBoundary.tsx:24`; `vibeman/src/components/ErrorBoundary.tsx:27` + `IntegrationErrorBoundary.tsx:50`; `ascent/src/components/report/ReportErrorBoundary.tsx:32`. |
| 2 | **`react-error-boundary`, `Sentry.ErrorBoundary`, react-router `errorElement`** | **SILENCE 0/5 for the package** | Nobody imports a boundary library. Personas is the only repo in the cohort using `Sentry.withErrorBoundary` — at exactly one site. Every other boundary in six codebases is hand-written. |
| 3 | **⚠ Reset that cannot re-mount** | **PHYSICS AS A DEFECT 3/4** | State-only reset at `personas-web/DashboardErrorBoundary.tsx:91`, `vibeman/ErrorBoundary.tsx:55`, `vibeman/errors/ErrorBoundary.tsx:117`. Only `brainiac` uses a true `key` bump (`console/app/console/page.tsx:105`, plus a keyed `<Suspense key={m}>`). |
| 4 | **⚠ THE SHARPEST — the boundary latch surviving a navigation** | **PHYSICS, and hit independently twice** | `personas-web/docs/harness/bug-test-scan-2026-06-19/dashboard-shell-chrome-realtime.md:29-32`: *"React keeps the same boundary instance across client-side route navigations… the healthy home route renders the fallback."* Fixed with `resetKey={pathname}`. `ascent` hit the same thing and fixed it differently, with a compared `resetKeys` array (`ReportErrorBoundary.tsx:14-17,42-48`) — and **wrote down the mechanism this repo needs**: *"reset() alone only re-renders the boundary with the SAME, still-cached server output, so a SERVER-thrown error re-throws immediately and looks unrecoverable"* (`RouteError.tsx:39-42`). **Two codebases, two independent fixes, no shared document. Personas has the bug and neither fix, at 46 of 46 sites.** |
| 5 | **⚠ A fallback that can itself throw** | **MINORITY 1/4 — and Personas is the second** | `personas-web/DashboardErrorBoundary.tsx:123-125,141,177` calls `useTranslation()` (which reads a Zustand store, `useTranslation.ts:51`) *and* walks `t.dashboard.errorBoundary.title` inside the fallback. `ErrorBoundary.tsx:89` here does the same class of thing; `ChartErrorBoundary.tsx:44` walks `en.overview.chart_error.chart_unavailable` on a lazily-parsing proxy. **`main.tsx`'s static copy table is the cohort's only fallback that deliberately avoids it, and its comment says why.** |
| 6 | **⚠ The fallback renders the raw message/stack to the user** | **PHYSICS AS A DEFECT 2/4** | `vibeman/ErrorBoundary.tsx:114,137` renders `{error.name}: {error.message}` **and the component stack**, unconditionally; `brainiac/RouteError.tsx:25` renders `{error}` in production. `ascent` renders only `error.digest`. Personas' shared card hides the stack behind a collapsed disclosure — and its **app-root** card renders `error.message` unconditionally (`main.tsx:218`), so it is on both sides of its own line. |
| 7 | **Boundary → error tracker** | **MINORITY 1/4, and Personas is BELOW it** | Only `personas-web` reports from a boundary — with `Sentry.setContext` + a **PII-scrubbing** capture (`src/lib/sentry-pii.ts`, a 17-key denylist) and a `MAX_RETRIES = 3` suppression added after a documented incident (below). `brainiac`'s `Boundary` has **no `componentDidCatch` at all**. `vibeman` ships a full `sentryProvider.ts` that **no boundary calls**. Personas: 0 of 46. |
| 8 | **A consent check before a boundary reports** | **SILENCE 0/5** | No sibling gates boundary telemetry on consent; all gate on DSN presence only. Personas gates `initSentry` on `isTelemetryEnabled()` (`main.tsx:304`) — **ahead, but by side effect**: the boundary itself asks nothing, it is the absent client that makes the capture inert. |
| 9 | **A durable, local, in-app crash log** | **SILENCE 0/5 — PERSONAS AHEAD** | No sibling persists a crash anywhere the user or operator can read it offline. `persistCrash` → localStorage + SQLite → `CrashLogsSection` has no analogue in the cohort. It is also the only reason §0 could be measured against reality rather than reasoned about. |
| 10 | **A global `unhandledrejection` / `onerror` handler (P7)** | **SILENCE 0/5 — PERSONAS AHEAD, and the strongest silence in the sweep** | Zero `unhandledrejection`, zero `window.onerror`, zero `addEventListener('error')` across all five. The only `addEventListener("error")` found is on an `<audio>` element. `personas-web` and `brainiac` get async coverage *implicitly* from `@sentry/nextjs`' default global handlers — telemetry only. **No repo in six routes an async failure into the boundary's UI.** |
| 11 | **Per-chart / per-table boundary granularity** | **SILENCE 0/5 for charts — PERSONAS AHEAD** | `personas-web` has 9 bare `dynamic()` charts and `ascent` 3, none boundaried. `vibeman` has exactly one panel-level boundary, and its fallback is `null`. `ChartErrorBoundary`'s 9 sites are the cohort's only per-chart isolation — and it reports nothing and is English-only (§7 D8). |
| 12 | **A `lazyRetry`-style wrapper / any `ChunkLoadError` handling** | **SILENCE 0/5 — PERSONAS AHEAD** | No sibling has a retry-import helper, a `ChunkLoadError` branch, or a comment about a stale chunk. (Outside the sweep, `auto-invoicer/src/components/layout/ChunkErrorBoundary.tsx` has one — so the pattern exists in the wider fleet, just not in these five.) |

**Physics — keep as doctrine:** clauses 1, 3, 4, 6 (the last three as defects).
**Reported as silence:** clauses 2, 8, 10, 12 — and clause 10 is the one to act on, because the
silence is not "nobody needs it", it is "everybody has the hole".
**Personas is ahead of all five siblings** on clauses 9, 10, 11 and 12 — and **behind** on 4, 5 and 7,
which are the three that decide what a user and an operator actually experience. Being ahead on
plumbing and behind on the latch is simultaneously true, and §0 is what that combination feels like.

> **The strongest external result is clause 4, and it is not agreement — it is the same bug, found
> twice, fixed twice, by strangers.** `personas-web` found it in a scan and fixed it with
> `resetKey={pathname}`; `ascent` found it independently and fixed it with a compared `resetKeys`
> array, writing the mechanism into a comment. Two stacks, two fixes, no shared document. That is the
> best available evidence that P1 is physics rather than house taste — and Personas, which has the
> largest boundary population of the six, has neither fix at any of 46 sites.

> **The negative evidence is `brainiac`, and it is instructive in the opposite direction.** It
> collapsed nine module routes into one and therefore **lost** framework-native `error.tsx`
> boundaries — then wrote down what it bought back: *"Collapsing to one route would have collapsed
> that too — every module sharing a single boundary, so one bad `detected_at` white-screens the whole
> console. That regression is not worth the URL"* (`ModuleBoundary.tsx:4-13`). It rebuilt per-module
> isolation by hand with a real `key={m}` bump, and its own bug log records the incident that taught
> it: a malformed timestamp white-screened a whole board because that route was *"one of only two
> module routes lacking an `error.tsx`"*. **A boundary given up deliberately, replaced consciously,
> and paid for in a documented outage — the cohort's clearest statement that P2 is a decision, not a
> default.**

> **And `personas-web` is the counter-example that keeps P4 honest.** Its retry cap exists because of
> a measured incident: Retry → same children → throw → `componentDidCatch` → capture → repeat, *"this
> can fire 10+ Sentry events per second until the user closes the tab. There is no rate limit, no max
> retries"* (`docs/harness/bug-hunt-2026-05-10/layout-navigation-page-shell.md:45`). So a retry
> affordance is not merely useless against a deterministic crash — **wired to a reporter, it is an
> amplifier.** Personas is accidentally protected from that specific outcome by the very defect in
> §0's telemetry table: its boundaries report to nobody.

## 7. Deviations

Every entry is live on `master` @ `b4a05049e` and was verified by reading the file, by executing the
component, or against a read-only copy of the operator's database.

### D1 — 46 boundary declarations, 0 keyed; one instance for the whole content area

`PersonasPage.tsx:404-406` renders `{renderContent()}` inside an unkeyed `<div>` with
`AnimatePresence` explicitly disabled (`:403`). Every branch of `renderContent()` returns
`<ErrorBoundary>` — 20 in that file plus `sectionRouter.tsx:94` for the 10 rail sections — at the
same position with the same type. React reconciles them as **one instance**. Executed in §0.

Consequences, in order of how badly they read:

1. A crash in any section is shown for **every** section until the user clicks the card's own button
   or restarts the app. Sidebar navigation, the command palette and breadcrumbs all fail to clear it.
2. The card renames itself, because `name` is read at render (`ErrorBoundary.tsx:135-137`) while the
   crash was persisted under the previous name (`:50`).
3. `OverviewPage.tsx:76` — `<ErrorBoundary name={\`Overview/${overviewTab}\`}>` — is the one site
   where the boundary's *own identity* is a function of the switch, and it still has no key. It is
   saved by an **ancestor**: `motion.div key={overviewTab}` at `:68`. **That is luck, not design** —
   the protection lives in an animation wrapper, and deleting the animation (as `PersonasPage:403`
   already did for its own) silently reintroduces the bug.

**Fix:** `key={section}` inside `renderSectionRoute` (10 sites, one line — §4); `key` at the 20
`PersonasPage` branches; and a `resetKeys` prop on the primitive for anyone who cannot key the
element. Precision note for §9: the census signal is tag-local and **cannot see an ancestor key**, so
`OverviewPage.tsx:76` is a stated-condition match that is not currently sticky. It is listed on
purpose.

### D2 — "Go to Dashboard" is a no-op at 13 of 34 sites

`ErrorBoundary.tsx:98-111`:

```ts
const handleGoHome = () => {
  try {
    onGoHome?.();     // <- optional. 13 call sites pass nothing.
    onReset();
  } catch {
    window.location.hash = '#/';
    window.location.reload();
  }
};
```

With `onGoHome` undefined nothing throws, so the `catch` — the only branch that actually navigates —
never runs, and `onReset()` makes the button identical to "Try Again". Executed in §0.

The 13: `DashboardWithSubtabs.tsx:10`, `OverviewPage.tsx:76`, `ArtistPage.tsx:48,:68`,
`CompanionPluginPage.tsx:41`, `DrivePage.tsx:630`, `ObsidianBrainPage.tsx:59`,
`ResearchLabPage.tsx:39`, `DesignReviewsPage.tsx:77,:91,:96,:101,:116`.

**7 of the 84 real crashes on this install landed there** (`Dashboard` ×2, `Overview/patterns` ×3,
`Overview/executions` ×1, `Overview/manual-review` ×1) — and one of them was
`useTranslation is not defined`, a `ReferenceError` that reset can never clear.

**Fix, in order of strength:** make `onGoHome` **required** on the primitive (34 call sites, all in
10 files); or render the button only when `onGoHome` is supplied; or fall through to the hard
`location.hash` navigation when it is absent. The third is two lines and fixes all 13 today.

### D3 — 15 components behind two boundaries that render `null`

`App.tsx:351` (`BackgroundServices`) and `:363` (`GlobalOverlays`: healing toast, alert toasts, tour,
tour spotlight, onboarding overlay, tour handoff, mini-player, command palette, notification centre,
share-link handler, companion panel, orb layer, guide layer, fleet grid, fleet bootstrap — **15
components**). `SilentErrorBoundary.render()` is `hasError ? null : children` (`:101`). Executed: the
container's `innerHTML` after a crash is `""`.

For `BackgroundServices` — which renders nothing anyway — `null` is correct and the docstring says
so. For `GlobalOverlays` it is not: the command palette, the notification centre and the toast
overlays are surfaces the user goes looking for, and their absence is indistinguishable from "this
build doesn't have that". One crashing sibling removes all 15 — verified by executing the same shape
with five children, one of which throws: `innerHTML === ""`.

Neither boundary calls `persistCrash`, so **none of these failures can appear in the 84** — the
operator's crash log has a structural blind spot exactly where the silent boundary is.

**Fix:** split the two groups (the comment at `:356-362` already proposes it), keep `null` for
`BackgroundServices`, and give the overlay group a minimal visible affordance plus a `persistCrash`
call. [`lazy-route-chunk`](./lazy-route-chunk.md) §7 G owns the chunk half of this deviation; this
entry owns the render-crash half and the missing report.

### D4 — a retry ladder that cannot retry

`App.tsx:78-95` — `MAX_RETRIES = 3`, `BACKOFF_MS = [5_000, 15_000, 45_000]`, `setState({hasError:
false, retryCount: +1})` on each timer. Transcribed verbatim and replayed against a `lazyRetry`
overlay whose import always rejects:

| t | boundary catches | import attempts |
|---:|---:|---:|
| 2 s | 1 | 2 |
| 8 s | 2 | **2** |
| 28 s | 3 | **2** |
| 88 s | 4 | **2** |

**Three scheduled retries produced zero additional load attempts**, because the underlying `lazy`
holds one stable instance and replays its cached rejection (`lazyRetry.ts:52-60`, and the repo's own
regression test asserts it at `lazyRetry.test.tsx:143`). After ~65 s the ladder gives up and the DOM
is `""` for the rest of the session. The same is true for the *render*-crash case whenever the crash
is deterministic, which on this install is the majority.

**Fix:** delete the ladder, or gate it on a predicate that can distinguish transient from
deterministic (`isChunkLoadError` is exactly such a predicate, and its answer here is "do not retry —
reload"). A ladder with no such predicate is a delay before silence.

### D5 — the shared fallback can throw, and one level up there is nothing to catch it

`ErrorFallback` (`ErrorBoundary.tsx:76-214`) calls `useTranslation()` (`:89`), `useState` (`:90`) and
`useCopyToClipboard()` (`:91`), and dereferences **ten** `t.common.*` paths. `useTranslation` returns
a `Proxy` that lazily parses a JSON section on first property access. So a crash caused by the i18n
layer — which has happened here: `useTranslation is not defined`, recorded 2026-08-14 under component
`Dashboard` — is the exact case where the fallback's own first render walks the thing that broke.

Executed, both arms:

| arrangement | result |
|---|---|
| throwing fallback **with** a parent boundary | the parent catches; the child boundary's own error is what surfaces |
| throwing fallback with **no** parent boundary | `render()` **rethrows into the caller** and the DOM is left as `<div></div>` — a blank app |

In this app the parent exists — `Sentry.withErrorBoundary(App)` — so the failure mode is a
**whole-app static card instead of a section card**, which is a degradation, not a blank. That is
survivable and it is not free: the blast radius silently jumps from one section to the entire
application, and the root card is the one that renders `error.message` raw (D6).

`ChartErrorBoundary.tsx:44` has the same property one layer lower — `en.overview.chart_error.chart_unavailable`
on the lazily-parsing `en` proxy — with no boundary of its own beneath the route.

**Fix:** hoist the copy the shared card needs into a static per-language table (the `main.tsx` shape),
or read it once at construction and store it. It is ~10 strings.

### D6 — two channels for the same crash payload, 40 lines apart, one redacted

| channel | `ErrorBoundary.tsx` | sanitized? |
|---|---|---|
| `persistCrash(name, error, componentStack)` → localStorage + SQLite | `:50` | ✅ `sanitizeCrashString` — URL query/fragment stripped, stack args redacted, `sanitizeErrorMessage` applied |
| `handleReport()` → `copy(text)` → the system clipboard | `:113-122` | ❌ **nothing** — raw `error.message`, raw `error.stack`, raw `componentStack` |

Executed with a synthetic error carrying a query string: the clipboard payload keeps it; the
persisted row does not. The button is labelled *"Copy report for support"* — its **entire purpose** is
that the content leaves the machine, which makes it the one of the two that most needed the sanitizer
that the other one has.

Two adjacent, smaller members of the same family:

- `main.tsx:218` renders `{error instanceof Error ? error.message : copy.generic}` unconditionally in
  the app-root card, while the shared card puts the stack behind a collapsed *For developers*
  disclosure (`:188-209`). Same repo, same concept, opposite policies, and the unconditional one is at
  the more visible surface.
- `@sentry/react` puts the component stack in `scope.setContext("react", { componentStack })`
  (`error.js:33`). `sentry.ts`'s `beforeSend` scrubs `event.message`, `event.exception.values[].value`
  and `event.breadcrumbs[].message` — **`event.contexts` is not among them.** This is doctrine §6
  measured again: the most detailed payload lands in the one field the scrubber does not visit. The
  same structural gap [`structured-logging`](./structured-logging.md) found for `event.tags` and
  `event.contexts` on the Rust side.

**Fix:** one call — `sanitizeErrorMessage` (or `sanitizeCrashString`, which is already written) on the
clipboard text. `secret-and-pii-redaction` owns the redactor; this is a missing call site.

### D7 — 15 components mounted at App root outside every boundary

Between `Sentry.withErrorBoundary(App)` and the first inner boundary, `App.tsx:306-421` mounts, with
nothing in between: `TitleBar`, `FleetActivityStrip`, `FirstUseConsentModal`, `UpdateBanner`,
`CliReadinessBanner`, `ChartGradientDefs`, **`ToastContainer`**, `LiveChannelOverlay`,
`ResourcePickerHost`, `RemoteApprovalPrompt`, `PairApprovalModal`, `ShortcutCheatSheet`,
`WorkspaceShortcuts`, `KeyboardNavMode`, `NavHistoryShortcuts` — plus six providers
(`Profiler`, `VibeThemeProvider`, `AppKeyboardProvider`, `ModalStackProvider`, `MotionConfig`,
`AriaLiveProvider`) whose own render is equally unprotected.

A render crash in any of them replaces the entire application with the 40-line static card. The
sharpest is `ToastContainer`: **the app's error-*surfacing* channel is itself the least protected
thing in the tree**, and a crash in it removes every other error's ability to be reported to the user.

**Fix:** one `SilentErrorBoundary`-style wrapper per chrome cluster — with a report call — is a small,
mechanical change. Do not use a `null` fallback for `TitleBar` (a Tauri window with no title bar has
no close button).

### D8 — `ChartErrorBoundary`: 9 sites, English-only, reports nothing, retries pointlessly

`sub_usage/ChartErrorBoundary.tsx`. Executed:

- Fallback text is `Chart unavailable` from `en.overview.chart_error.chart_unavailable` — the **`en`
  shim**, not `t`, so it is English in a 14-language app — plus a **hardcoded `Retry` literal at
  `:51`**, which is a live `custom/no-hardcoded-jsx-text` condition inside an error path.
- `componentDidCatch` calls `logger.error` only (`:32`). No `persistCrash`, no Sentry. **Nine chart
  tiles can fail on this install without leaving any trace the operator can read.**
- Retry is `setState({hasError:false})` (`:36`). Measured against a permanently-broken chart: the
  child renders **3 times per crash** and **9 times after three retries**, ending on the same card.

For contrast, the shared `ErrorBoundary`'s equivalent surface is fully localized: all 10
`common.error_boundary_*` / `try_again` / `reload_app` / `go_to_dashboard` / `copy_report` /
`for_developers` / `no_stack_trace` keys are present in **all 14 locales**, verified against
`src/i18n/locales/*.json`.

**Fix:** route it through `useTranslation()` (it renders below the provider, unlike the app root), add
`persistCrash`, and add a `title` naming the chart so nine identical *"Chart unavailable"* tiles are
distinguishable.

### D9 — `UnifiedTable`: 17 render sites, 0 in a file that declares a boundary

Every one of the 17 sits under a *route* boundary, so a malformed row takes the whole page rather than
the table. This is the render-side twin of
[`partial-failure-read-envelope`](./partial-failure-read-envelope.md) §8 Gap 1 (the loading doctrine
has three states and no fourth for error): that path needs an `error` **prop** on `UnifiedTable`; this
one needs the table to be *survivable* when a cell renderer throws. `ChartErrorBoundary` proves the
per-widget pattern works and is cheap — it is simply not applied to the other half of the data surface.

**Fix:** the same three-line boundary around `UnifiedTable`'s body, with the table header and its
chrome kept outside it, so a bad row degrades to "these rows could not be displayed" under a live
header.

### D10 — React renders a throwing child **3 times** before the fallback wins

Measured with the shipped boundary and a deterministic throw: the child's render body executes
**3×** per crash (`9×` after three `ChartErrorBoundary` retries). React logs the reason itself —
*"There was an error during concurrent rendering but React was able to recover by instead
synchronously rendering the entire root."* **One crashed leaf causes a full synchronous re-render of
the root**, and any side effect written in a render body runs three times.

Not a defect to fix; a fact to design against. It is also why a retry ladder is more expensive than it
looks (D4): each attempt costs three renders of the failing subtree plus a synchronous root pass.

### D11 — the shipped boundary has no test

`grep` over every `*.test.ts(x)` in `src/` returns exactly one file referencing a boundary:
`lazyRetry.test.tsx` — and it uses a **local 12-line mock** (`RetryBoundary`, `:58-71`), not
`feedback/ErrorBoundary`. So the component with 34 render sites, four buttons, a chunk branch and a
persistence side effect has **zero coverage**, and every finding in §0, D2 and D5 was reachable by a
first render.

There is also no ESLint rule anywhere in `eslint-rules/` (21 rules) touching boundaries, and
`CATALOG.md:94` describes the component as *"Called when the user clicks 'Go to dashboard'"* — the
generator picked up the `onGoHome` prop's JSDoc as the component's description, because
`ErrorBoundary.tsx` carries no `@catalog` tag.

## 8. Gaps

1. **`ErrorBoundary` has no `resetKeys` prop.** The interface is
   `{children, name?, onReset?, onGoHome?}` (`:12-21`). A caller who wants the boundary to clear when
   the surface changes must reach for React's `key`, which is not discoverable from the component's
   own signature and is not mentioned in its docstring. Both siblings that hit this bug solved it
   *inside* their boundary (`resetKey`, `resetKeys`), which is why their fix survived; a `key` at the
   call site is correct but invisible to the next reader.
2. **`onGoHome` is optional, and optionality is what makes the button lie.** Making it required is a
   34-site edit across 10 files and removes D2 permanently. The `renderSectionRoute` factory already
   demonstrates the pattern — it takes `onGoHome` as a positional parameter, so its 10 sections cannot
   omit it.
3. **The fallback is not injectable.** `ErrorBoundary` always renders `ErrorFallback`. A chart tile, a
   modal and a full page need three different shapes, which is precisely why three more boundary
   classes exist. A `fallback?: (error, reset) => ReactNode` prop would let all three collapse into
   one implementation — and would let the *reporting* live in one place instead of four (§0's table
   is four independent decisions about telemetry, three of which were "none").
4. **There is no error state in the loading doctrine.** [`docs/design/overview-loading.md`](../../design/overview-loading.md)'s
   five laws and `UnifiedTable`'s three-state body have no fourth state, and neither does
   `RouteChunkSkeleton`. A `Suspense` fallback shows *pending*; a boundary shows *crashed*; nothing in
   the shared vocabulary shows *this part is missing and the rest is fine*. That is the same hole
   [`partial-failure-read-envelope`](./partial-failure-read-envelope.md) §8 Gaps 1–2 found from the
   data side, and it is why D3 chose `null` and D9 chose nothing.
5. **No boundary in the tree is tested, and the one test that looks like it is, isn't** (D11). A
   `RuleTester`-style fixture is not the answer here; three `@testing-library/react` renders are — the
   probes that produced §0 were 40 lines each.
6. **Nothing routes an async failure into a boundary's UI, in any of six codebases** (clause 10). The
   mechanism is well understood — a store that `window.onerror` writes to and a subscriber that raises
   a card — and nobody has built it. `main.tsx:104-142` already has the listeners and already computes
   the context; publishing to a store would be ~15 lines. Stated as a gap rather than a deviation
   because there is no primitive to be non-compliant with.
7. **`handled: true` is `@sentry/react`'s default whenever a `fallback` is supplied**
   (`errorboundary.js:38`) and is therefore easy to inherit without deciding. Passing
   `handled={false}` at `main.tsx:190` is a one-word change that makes whole-app crashes count as
   crashes. Flagged, not applied: it changes what the operator's Sentry dashboard reports, and that is
   his call.

## 9. The missing gate

**The condition:** *an error boundary whose latched failure state can be cleared only from inside the
crashed subtree's own fallback — nothing outside it (a fresh identity when the surface changes, a
host-supplied way home) can clear it — so the boundary outlives the failure and a healthy surface
inherits a stranger's crash.*

**The signal (a proxy, and stated as one):** an `*ErrorBoundary` JSX opening tag whose attribute list
contains none of `key`, `resetKey(s)`, `onGoHome`, `onReset`. This keys on the shape the condition
wears **in this repo**, where boundaries are hand-written class components rendered as JSX with a
props-based escape hatch. **An adopting repo must re-derive its own proxy** — `ascent` and
`personas-web` wear the compliant form as `resetKeys={[repo]}` and `resetKey={pathname}` (which this
pattern *would* catch), but `brainiac` wears it as `key={m}` on a `<Suspense>` **one element below**
the boundary, and a Next.js repo wears the whole leaf as an `error.tsx` file that has no JSX tag to
match at all.

**The mechanism: a census rule.** The runner exists (`scripts/census/`) and implements the fail-loud
contract, so this path writes no script.

**Where it executes:** `npm run census:check` is part of `npm run check`, which the agent runs before
opening a PR, and of the `golden-path-census` pre-push job. That matters here: `ci.yml` is red on 10
pre-existing failures, so **a gate that only runs in CI runs nowhere.** This one runs on the
developer's machine before the branch leaves it.

**Precision, hand-verified 25/25 on the stated condition.** Every match was opened. All 25 are a
boundary declaration with no external reset path. On the stricter question *"is this a live defect"*:

- **13 are the `Go to Dashboard` no-op** (D2), the sharpest and the ones with 7 real crashes behind
  them.
- **9 are `ChartErrorBoundary`**, which accepts no reset props at all — they are true instances of the
  condition and cannot comply without changing the primitive (§8 Gap 3). Listed on purpose: excluding
  them would hide the reason the condition exists.
- **2 are `SilentErrorBoundary`**, where a `null` fallback means there is no button to click, so
  "cleared only from inside the fallback" collapses to "never cleared by a user at all" (D3).
- **1 is `ViewerErrorBoundary`**, a 3D-model viewer whose fallback is a static card — the mildest of
  the 25, and the closest to an acceptable exception.
- **1 — `OverviewPage.tsx:76` — is currently protected by an ancestor `motion.div key={overviewTab}`**
  and is therefore not sticky today. It is the one match where the stated condition holds and the
  worst consequence does not. It is **listed on purpose**, because the protection lives in an
  animation wrapper that a sibling file (`PersonasPage.tsx:403`) has already deleted for itself once.

**Two independent implementations reconcile at 25 / 16 files — after disagreeing, and the
disagreement is the finding.** Implementation #1 is a standalone tag-scanner over `src/**/*.tsx`
(2,104 files) that partitions every `*ErrorBoundary` opening tag; #2 is the census regex. The first
run disagreed — 34/19 vs 25/16 — and the cause was that **my own scratch probe files were in `src/`
and the census counted the instrument**. The independent scanner had excluded them by name and the
census had not. After deleting the probes both read **25 matches / 16 files** for the rule and
**21 / 2** for the control, partitioning all **46** declarations across **18** files with no
remainder. *A measurement that includes the measuring apparatus is the client-side twin of the
`head -3` truncation the doctrine already warns about.*

**Known recall limits, stated so nobody trusts the rule further than it goes:**
- The attribute window is `[^>]*`, which stops at the first `>`. A prop whose value is an **arrow
  function** (`onGoHome={() => goHome()}`) contains `=>` and would truncate the window early, so a
  reset prop written *after* an arrow-function prop would be missed. **No current call site has one**
  — all 21 compliant tags pass bare identifiers — and the alternative (`(?:[^>]|=>)*`) is an ambiguous
  nested quantifier the doctrine forbids. A bounded false-negative was preferred to an unrunnable
  pattern.
- It is **tag-local and cannot see an ancestor key** (D1, `OverviewPage.tsx:76`). No regex can; that
  needs an AST walk, and an ESLint rule is the right host if this ever needs to be exact.
- It cannot see a boundary declared by a **higher-order component** — `Sentry.withErrorBoundary(App)`
  at `main.tsx:190` is invisible to it, which is correct here (the root boundary has no switch beneath
  it) and would not be correct in a repo that wraps routes that way.

**The positive control partitions the same 46, and its shape is the finding.** Pointed at the
**compliant** form over the same roots and extension, it returns **21 matches in 2 files** —
`PersonasPage.tsx` (20) and `sectionRouter.tsx` (1). So the population is **25 unresettable (16 files)
: 21 resettable (2 files)**, and the two must move in opposite directions as the codebase improves. If
`unresettable-error-boundary` falls and the control does not rise, a boundary was **deleted** rather
than wired — and deleting a boundary is exactly the wrong way to make this number go down.

**The intersection of the two file sets is zero**, and that is itself the structure of the problem:
**every resettable boundary in this application is in one of the two router files, and every boundary
written anywhere else is unresettable.** The escape hatch is a property of the two files that were
designed, not of the component that was reused.

**The stronger requirement cannot be gated, and saying so is part of the answer.** The condition that
actually produced §0 is *"no `key`, no `resetKeys`"* — and that is **46 of 46**, with **0** compliant
instances. A census rule for it would have no positive control (a control matching zero files exits 1
by construction, `engine.mjs:264-274`), and the doctrine is explicit that **the census cannot assert an
absence**. So the ratchet is set on the narrower, partitionable condition, and the 46/46 absence is
recorded here, in D1, and in §4 as a *type* change — a `key` inside `renderSectionRoute`, which no
ratchet would ever have moved.

**How it fails loudly if its own precondition is absent:** `floor: 1800` against a live walk of 2,104
`src/**/*.tsx`, so a broken glob or a moved root fails rather than reporting zero; a rule matching zero
files anywhere is a structural failure in the runner; and a **drop** without `--update` is fatal.

**What the gate cannot do:**
- It cannot see the **telemetry** hole (§0). A boundary that reports to nobody has no distinguishing
  token — `logger.error` is the correct call in a thousand other places. The honest instrument for
  that is a review question, or an ESLint rule over `componentDidCatch` bodies, which is §8 Gap 5's
  territory.
- It cannot see the **async gap** (P7), which is an absence of code, not a presence.
- It cannot see a **fallback that can throw** (D5), which depends on where the boundary sits relative
  to a provider — a fact no matcher has.
- It counts a *declaration shape*, not a *behaviour*. It cannot know that `ViewerErrorBoundary`'s
  single site is mild and `DashboardWithSubtabs.tsx:10`'s is not.

**Existing rules checked for overlap before proposing this one — file overlap re-measured, not
assumed** (each neighbour's own pattern re-run over `src/` and its file set intersected with my 16):

| neighbour rule | its files | overlap with my 16 | why it is a different condition |
|---|---:|---:|---|
| `raw-react-lazy` ([`lazy-route-chunk`](./lazy-route-chunk.md)) | 38 | **5 (31%)** | The nearest neighbour, and the only meaningful overlap. Its anchor is a `lazy(` **call**; mine is a boundary **tag**. It asks *"can this chunk recover?"*; this asks *"can this boundary be cleared?"* The five shared files (`App.tsx`, `ArtistPage`, `CompanionPluginPage`, `ObsidianBrainPage`, `ResearchLabPage`) are files that do both things, not files where the two rules see the same line. |
| `bindingless-catch-on-io` ([`swallowed-error-telemetry`](./swallowed-error-telemetry.md)) | 86 | **0 (0%)** | Requires a `catch {` with no binding. A boundary has no catch clause at all — disjoint by construction. |
| `unresolved-error-as-inline-copy` ([`error-message-resolution`](./error-message-resolution.md)) | 90 | **0 (0%)** | Counts a raw error rendered as copy. Adjacent leaf, adjacent concern, zero shared files. |
| `local-empty-state` ([`empty-and-demo-states`](./empty-and-demo-states.md)) | 40 | **0 (0%)** | Counts authored "nothing here" components; this counts the boundary that replaced them with a crash card. |
| `unsolicited-failure-as-toast` ([`error-surfacing-policy`](./error-surfacing-policy.md)) | 18 | **0 (0%)** | A toast raised for a failure nobody asked about. Different surface, different moment. |
| `consent-bypassing-telemetry-import` ([`first-use-consent-gate`](./first-use-consent-gate.md)) | 20 | **0 (0%)** | Counts `@sentry` importers that never consult consent. Zero of my 16 files import Sentry — which *is* §0's telemetry finding, arriving as a zero. |
| `read-failure-as-empty-value` ([`partial-failure-read-envelope`](./partial-failure-read-envelope.md)) | 32 | **0 (0%)** | A failed read laundered into an empty value. Its leaf is a source that didn't answer; mine is a render that didn't finish. |
| `hand-rolled-spinner` ([`inline-busy-state`](./inline-busy-state.md)) | 184 | **1 (6%)** | Incidental — `ThreeViewer.tsx` has a loading spinner and a viewer boundary. |

The largest overlap is 31%, well under the 83% that got a previous gate correctly declined, and it is
across leaves rather than within one.

```json
{
  "id": "unresettable-error-boundary",
  "goldenPath": "docs/concepts/golden-paths/error-boundary.md",
  "title": "Error boundary declared with no way out but the button that re-runs the crash",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<[A-Za-z0-9_]*ErrorBoundary(?![A-Za-z0-9_])(?![^>]*\\b(?:key|resetKeys?|onGoHome|onReset)\\s*=)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An error-boundary JSX declaration whose attribute list carries NONE of key / resetKey(s) / onGoHome / onReset. PROXY FOR the stack-free condition: a boundary's latched failure state can be cleared ONLY from inside the crashed subtree's own fallback, so the boundary outlives the failure and a healthy surface inherits a stranger's crash. WHAT THE MATCH COSTS, executed rather than reasoned: renderSectionRoute (src/features/personas/sectionRouter.tsx:87-100) was transcribed VERBATIM into a jsdom render. Crash section A -> the card correctly reads 'Something unexpected happened in SectionA'. Navigate to a HEALTHY section B -> section B never renders and the SAME latched card now reads 'Something unexpected happened in SectionB', because `name` is re-read from props at render time (ErrorBoundary.tsx:135-137) while componentDidCatch already persisted the crash under the OLD name (:50) — the screen and the crash log name two different components and the crash log is right. Adding key={section} recovers section B immediately. This is not hypothetical: PersonasPage.tsx:404-406 renders {renderContent()} inside an UNKEYED div with AnimatePresence explicitly disabled (:403), and every branch of renderContent() returns <ErrorBoundary> at that one position — so 20 sub-routes plus all 10 rail sections share ONE boundary instance. Second executed cost: ErrorBoundary's 'Go to Dashboard' button calls this.props.onGoHome?.() then onReset() (:98-111); with onGoHome undefined nothing throws, the catch branch that actually navigates never runs, and the button is byte-for-byte 'Try Again' with a different label — renders went 3 -> 5 -> 7 across the two clicks with the location unchanged. 13 of the 34 shared-boundary sites are that shape, and 7 of the 84 real crashes in the operator's live frontend_crashes table (2026-05-25..2026-08-14, read from a read-only copy) landed on one of them. PRECISION 25/25 on the stated condition, every match opened: 13 Go-to-Dashboard no-ops, 9 ChartErrorBoundary sites whose primitive accepts no reset prop at all (they are true instances and cannot comply without changing the primitive — listed on purpose, because excluding them hides why the condition exists), 2 SilentErrorBoundary sites whose null fallback means there is no button to click at all, and 1 ViewerErrorBoundary, the mildest. ONE match — OverviewPage.tsx:76 — is protected today by an ANCESTOR motion.div key={overviewTab} (:68) that this tag-local pattern cannot see; it is listed on purpose, because that protection lives in an animation wrapper which a sibling file (PersonasPage.tsx:403) has already deleted for itself once. TWO INDEPENDENT IMPLEMENTATIONS RECONCILE AT 25/16 — after disagreeing at 34/19 vs 25/16, because the composer's own scratch probe files were sitting in src/ and the census was counting the instrument; the standalone scanner excluded them by name and the census did not. Deleting them made both read 25/16 for this rule and 21/2 for the control, partitioning all 46 declarations across 18 files with no remainder. KNOWN RECALL LIMIT: the attribute window is [^>]* and stops at the first '>', so a reset prop written AFTER an arrow-function prop value (which contains '=>') would be missed. No current call site has one — all 21 compliant tags pass bare identifiers — and the alternative (?:[^>]|=>)* is an ambiguous nested quantifier the doctrine forbids, so a bounded false negative was preferred to an unrunnable pattern. It is also blind to a boundary installed by a higher-order component (Sentry.withErrorBoundary at main.tsx:190), which is correct here and would not be in a repo that wraps routes that way. WHAT THIS RULE CANNOT SEE: the STRONGER requirement — no key and no resetKeys, which is 46 of 46 with ZERO compliant instances — cannot be gated at all, because a control matching zero files exits 1 by construction (scripts/census/lib/engine.mjs:264-274) and the census cannot assert an absence; that half is a TYPE (key={section} inside renderSectionRoute, one line, 10 sites correct-by-construction) and no ratchet would ever have moved it. It also cannot see that 0 of 46 boundaries produce a Sentry event, cannot see the async gap (an absence of code), and cannot see a fallback that can itself throw (which depends on where the boundary sits relative to a provider). PORTABILITY WARNING, earned from the convergence sweep: ascent wears the compliant form as resetKeys={[repo]} and personas-web as resetKey={pathname} (both would match this pattern), but brainiac wears it as key={m} on a <Suspense> ONE ELEMENT BELOW the boundary (console/app/console/page.tsx:105-106), and a Next.js App Router repo wears this whole leaf as an error.tsx FILE with no JSX tag to match at all. An adopting repo must re-key on its own idiom. Do NOT silence a match by deleting the boundary — that is how coverage goes down while the count improves, which is what the positive control exists to catch."
  },
  "exclude": [],
  "baseline": { "files": 16, "matches": 25 },
  "floor": 1800
}
```

```json
{
  "id": "unresettable-error-boundary-positive-control",
  "goldenPath": "docs/concepts/golden-paths/error-boundary.md",
  "title": "Positive control — boundaries that DO carry an external reset path",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<[A-Za-z0-9_]*ErrorBoundary(?![A-Za-z0-9_])[^>]*\\b(?:key|resetKeys?|onGoHome|onReset)\\s*=",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the COMPLIANT form of the same condition, over the same root and extension: an error-boundary declaration that CAN be cleared from outside the crashed subtree, via a fresh identity (key / resetKey / resetKeys) or a host-supplied escape (onGoHome / onReset). Returns 21 matches in 2 files against the violating rule's 25 in 16, and the two sets PARTITION all 46 error-boundary declarations in the tree with no remainder — so the counts must move in OPPOSITE directions as the codebase improves. If unresettable-error-boundary falls while this stays flat, a boundary was DELETED rather than wired, and deleting a boundary is the one way to improve this number that makes the application worse. THE NUMBER IS ITSELF THE FINDING, twice over. (1) The intersection of the two file sets is ZERO: every resettable boundary in a 4,829-file application lives in one of two router files — PersonasPage.tsx (20) and sectionRouter.tsx (1) — and every boundary written anywhere else is unresettable. The escape hatch is a property of the two files that were designed, not of the component that was reused. (2) All 21 compliant matches comply via onGoHome only: key / resetKey / resetKeys appear on ZERO of the 46 declarations, so this control is currently measuring the weaker half of the compliant form. If the §4 type change lands (key={section} inside renderSectionRoute, sectionRouter.tsx:94), those sites will satisfy BOTH halves and this control rises without the violating rule moving — which is the correct signal and must not be read as drift. Carries no baseline by construction: a ratchet is monotone-downward and would fail the build every time adoption improved."
  },
  "exclude": [],
  "floor": 1800
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <private scratch registry>`,
never against the shared `rules.json`; the runner reports **25 matches / 16 files** for the rule and
**21 / 2** for the control, over **4,208 file-visits** (2 × 2,104). **Re-extracted from this document
and re-run, with identical counts.**

### The type, alongside the ratchet

The gate counts **declarations**. The fix that reaches §0 is a **type**, and it is one line in a
factory that already exists:

- **`key={section}` inside `renderSectionRoute`** (`sectionRouter.tsx:94`). Ten rail sections become
  correct-by-construction and no future caller can forget, because callers never see the boundary
  (doctrine Q5: withholding beats requiring — and Q4 is why a required `resetKey: string` prop would
  not have worked, since `resetKey="x"` type-checks and authenticates nothing).
- **`onGoHome` made required** on `ErrorBoundary` — 34 call sites, 10 files — which removes D2
  permanently. Or, two lines today: render the button only when the host supplied a handler.
- **Fix the destination before ratcheting the callers** (contract, fifth §9 failure mode). Routing
  more code to `feedback/ErrorBoundary` while its `onGoHome` is optional, its `resetKeys` prop does
  not exist, and its fallback calls three hooks just multiplies §0. §8 Gaps 1–3 are that work.

## 12. Corrections to the brief

1. **"A killed dev server once left `React.lazy` caching rejected chunks forever; `lazyRetry` + a
   boundary were the fix. Measure whether every lazy route is covered." — the premise is half right
   and the measurement was already owned.** `lazyRetry` does **not** fix the caching: executed, raw
   `lazy` performs 1 import and `lazyRetry` performs 2 (one immediate retry at +1.5 s), and **neither
   re-imports after a boundary reset or after a full unmount-and-remount**. That is deliberate and
   documented (`lazyRetry.ts:52-60`); the actual recovery is the **Reload App** button, which only the
   shared `ErrorBoundary` renders. Coverage of lazy routes is
   [`lazy-route-chunk`](./lazy-route-chunk.md)'s leaf and its `raw-react-lazy` rule (105 sites) — I
   re-measured the shape and deliberately did not re-derive the count. **The uncovered surface that is
   this leaf's** is different and was not in the brief: 15 components at App root outside every
   boundary (D7), and 17 `UnifiedTable` sites with no boundary nearer than the route (D9).
2. **"21 direct `@sentry/*` importers, 21 emitting, 1 consulting consent" — confirmed, and my first
   instrument said 20.** My emit-detector matched `captureException|captureMessage|withScope|addBreadcrumb|setContext|setTag`
   and missed `Sentry.metrics.count(...)` at `onboardingSlice.ts:96`. **The brief was right and my
   vocabulary was short** — the doctrine's *"a vocabulary-based signal's recall is bounded by its
   author's word list"*, arriving as a correction to me rather than to the brief. The number that
   matters for this leaf is a different one and is worse: **0 of 46 boundary declarations emit
   anything to Sentry**, and the single root boundary that does files every whole-app crash as
   `handled: true`.
3. **"`scrubPii` gained credential patterns on 2026-08-16" — confirmed, and it does not reach this
   leaf's worst channel.** `beforeSend` scrubs `event.message`, `event.exception.values[].value` and
   `event.breadcrumbs[].message`; `@sentry/react` puts the component stack in
   `scope.setContext("react", …)` (`error.js:33`), i.e. `event.contexts`, which `beforeSend` does not
   touch. And the boundary's *other* export channel — the clipboard (`ErrorBoundary.tsx:113-122`) —
   has **no sanitizer at all**, while `persistCrash` 40 lines above it has three passes. Executed:
   same error, same instant, one channel redacted and one not (D6).
4. **"68 reads launder a failure into an empty value … `UnifiedTable` has no `error` prop … the five
   laws have no fourth state" — confirmed, and this leaf is the *other half* of the same gap.** That
   path needs `UnifiedTable` to be able to *say* a read failed; this one needs the table to *survive*
   a cell renderer that throws. Both are downstream of the same missing state, which is why §8 Gap 4
   names it once and points at both. I did not re-derive the 68 or the 17.
5. **"whether reset actually re-mounts" — yes for a plain child, and the answer is misleading on its
   own.** Executed: a child that throws on its first mounts and then succeeds **does** recover on
   "Try Again" (mounts 3 → 4, content rendered). So reset is a real remount. The problem is that it is
   a remount of *the same code*, and the crashes that actually happen here are deterministic — six
   distinct `X is not defined` signatures in the live table. **"Does reset re-mount?" is the wrong
   question; "is this failure transient?" is the right one**, and nothing in the fallback asks it
   except the chunk branch.
6. **"whether any fallback can itself throw" — yes, and the escalation is worse than I expected in one
   direction and better in another.** Executed: a throwing fallback with **no** parent boundary makes
   `render()` rethrow **into the caller** and leaves the DOM empty. In this app the parent exists, so
   the real consequence is a silent jump in blast radius from one section to the whole application —
   and the app-root card is the one that renders `error.message` raw. So: not a blank screen here, but
   the degradation is invisible and lands on the more exposed of the two cards.
7. **"convergence: mixed" — confirmed, and the oracle inverted one clause of my draft.** I had written
   the async-gap coverage (`window.onerror` + `unhandledrejection`) as a Personas *deviation* —
   telemetry without UI. It is that, and it is also **0 of 5 in the siblings**: nobody has the
   listeners at all, and nobody in six codebases routes an async failure into a boundary's UI. So the
   correct reading is **Personas ahead on the mechanism, and the whole cohort silent on the
   destination** — which turned a deviation into §8 Gap 6. I only caught it because the oracle brief
   demanded silences be reported as silences rather than skipped.
8. **A correction to my own instrument, offered because the doctrine asks for it.** The first census
   run reported **34 matches / 19 files** and I would have baselined it. The extra 9 came from my own
   scratch probe files, which were sitting in `src/lib/` (vitest's `include` is `src/**/*.test.{ts,tsx}`,
   so an instrument for this leaf has to live inside the population it measures). The independent
   scanner had excluded them by filename and the census had not, and **the disagreement was the only
   signal** — each number was internally consistent and neither was obviously wrong. Deleting the
   probes reconciled both at 25/16. The general form is the doctrine's `head -3` lesson in a new
   costume: *an instrument that runs inside its own denominator will be counted by it.*
