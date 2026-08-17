# Golden path — Swallowed error telemetry

> Situation node: `client-runtime/client-errors/swallowed-error-telemetry` · [situation spine](../situation-spine.md)
> One-sided (`sides: client`, `twoSided: false`) · recurrence **1,875** — the highest-recurrence unwritten leaf.
> Dimensions: **resilience · code-quality · function**.
> Composed 2026-08-14 against `master` @ `a53561963`. Sweep: 4,829 `.ts`/`.tsx` files walked, 2,752
> production catch sites classified by a brace-matching analyzer, cross-validated against the census
> engine (both counted **1,985** raw `catch` clauses, agreeing to zero). Corpus counts cite
> [`shared-facts.json`](../shared-facts.json) rather than re-deriving them.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells when this path is ingested.

> **Three of this leaf's stated premises are wrong, and the corrections are the most useful thing here.**
> (1) The brief expected `custom/no-silent-catch` to be warn-level and near-useless. It is **`"error"`**
> (`eslint.config.js:104`) and a full ESLint run returns **0 findings** — the empty-catch condition is
> *extinct*, and the rule is why. (2) The expected population of bare `catch {}` / `.catch(() => {})`
> does not exist: **0** empty catch blocks in `src/`, and the only literal `.catch(() => {})` in the repo
> is a RuleTester fixture (`src/test/eslint-rules/customRules.test.ts:366`). (3) `.claude/CLAUDE.md`
> still says the rule "warns"; that line is stale.
>
> The real defect is not the empty catch. It is the **non-empty** catch that reaches no telemetry door —
> **760 of them**, invisible to every gate in the repo.

## Trigger

- "This can fail but it shouldn't break the page" / "just swallow it, it's best-effort"
- "Why is this list empty?" / "the tab says no data but the backend is down"
- "It works on my machine — I have no idea why it failed for that user"
- "Add a fallback if the fetch fails" / "return null on error"
- "Sentry shows nothing for this bug report"
- "Should this be a toast or should we stay quiet?"

If you are about to type `catch {`, `.catch(() => {})`, `catch (e) { return [] }`,
`catch { setError('Failed to load') }`, `console.error(err)` inside a catch, or you are adding a
`try` around an `await` — you are in this situation.

## The one way

**A caught failure must leave a record that outlives the moment it happened, and choosing who hears
about it is a choice between named doors, not an `if` at the call site.** Never discard the error
value — bind it, always, even when you intend to continue; the value is the only evidence and once
dropped it cannot be recovered downstream. Then hand the bound value, unmodified, to exactly one of
two doors: the **user door** when a person is waiting on this operation and must be told it failed,
or the **operator door** when the work is background and the user should not be interrupted. Both
doors record; they differ only in whether they also interrupt. Pass a **stable call-site tag** with
it — a string naming the module and operation — so that N occurrences of the same failure aggregate
into one countable signal rather than N anonymous lines. Then stop: no local logging convention, no
bare `console.error`, no error state written to a component that nothing outside the component can
observe. **A failure that only reaches the screen is not recorded, and a failure that only reaches
the console is not recorded either** — the screen is cleared by the next render and the console is
cleared by the next reload. The decision that needs care is only ever *which door*; the decision of
*whether to record* has already been made, once, here.

### Convergence — which clauses are physics and which are this house's taste

Checked against three sibling codebases with no shared error-handling document
(`personas-web` Next.js · `brainiac` Rust+Postgres · `personas-cloud` Node services).

| Clause | Verdict | Sibling evidence |
|---|---|---|
| **A swallowed failure must leave a structured, identifying trail** | **PHYSICS** | Independently reinvented in all three, and three of four wrote the reasoning down unprompted. `brainiac` even converged on a *message format* that names what degraded: `"page read served but not recorded"` (`docs.rs:56`), `"demand ledger write failed (answer unaffected)"` (`demand.rs:83`). |
| **One chokepoint, so the call site cannot decide** | **PHYSICS in function, house convention in form** | Nobody wrote a `silentCatch(tag)`-shaped function. Everybody built *some* chokepoint: a `sentry_tracing::layer()` that makes every `tracing::error!` a Sentry event (`brainiac/main.rs:298`), an injected pino logger (`personas-cloud`), a shared degradation wrapper (`brainiac/console/demo-fallback.ts:26`). |
| **A string tag naming the call site** | **PHYSICS** | `personas-web` reinvented the payload without the helper: `tags: { scope: "useExecutionHeatmap" }` at 29 sites, tag value = the enclosing hook's name. `brainiac` carries the same identity as typed KV fields. |
| **User vs operator = a different door, not an `if`** | **PHYSICS — and the sibling made it a *type*** | `brainiac/http.rs:1908-1952`: `From<(StatusCode,String)>` (message shown) vs `internal(e)` (detail logged, client gets a constant). Repeated as enum variants at `mcp.rs:752-762` (`ToolError::Rejected` vs `::Internal`). The rule is written into `ErrorResponse`'s own doc comment. |
| **Swallows are counted and rolled up** | **CONVERGENT once** | `personas-cloud/metrics.ts:63,177,354` — Prometheus counters incremented *inside the catch body* (`dispatcher.ts:592-597`). Partial: only 1 of 5 fan-outs is counted. `personas-web` reinvented only the downstream half (quota caps, `warnedOnce`). |
| **A lint rule bans the empty catch** | **LOCAL CALIBRATION — mark it as such** | Zero reinventions in three repos, and the "they lacked the tooling" excuse is dead: `personas-web` wrote **five** bespoke ESLint AST rules and pointed none at catches; `brainiac` shipped a workspace-wide clippy gate (`unwrap_used`, opted into by all 8 crates) and aimed it at panics. `brainiac/console` went further and set `caughtErrors: "none"`, *disabling* the nearest stock check. |

**This contradicted the conclusion I was heading for.** The measured 99.5%-vs-58.6% gap below is the
strongest in-repo evidence that a lint rule moves adoption, and I was going to lead with "so lint the
other half." Convergence says the lint rule is the one clause nobody else invented — so it belongs in
§9 (manifestation, does not travel) and must never be presented as doctrine. The clause that *does*
travel is the one above it: **one chokepoint, two doors, always a tag.** An adopting repo should
reach for a tracing layer, a middleware, or a wrapper type before it reaches for a linter.

## Mandated primitives

- **`src/lib/silentCatch.ts` — `silentCatch(context)`** (`:73`). The **operator door**. Returns
  `(err) => void`. Emits `log.warn` + a Sentry breadcrumb + `recordSwallow(context, msg, err)`. The
  only door wired into the aggregation layer. **1,271 catch sites.**
- **`src/lib/silentCatch.ts` — `silentCatchNull(context)`** (`:134`). Same, returning `null`, for
  `Promise.all` / data-fetch chains that need a fallback value. 9 sites.
- **`src/lib/silentCatch.ts` — `toastCatch(context, custom?)`** (`:102`). The **user door**. Breadcrumb
  + `log.warn` + a toast. **379 catch sites.** It does **not** call `recordSwallow` — see Gap 1.
- **`src/lib/silentCatch.ts` — `extractMessage(err)`** (`:21`). Never returns `"[object Object]"`;
  walks one level of `Error.cause`. The only sanctioned "error → text" helper for logs.
- **`src/stores/storeTypes.ts` — `reportError(err, fallback, set, { action })`** (`:100`). The
  **store door**: Sentry scope tags (`error.kind`, `error.action`) + an unconditional
  `Sentry.captureException` + slice state + a deduped toast. **292 call sites** — and the *only* door
  that reliably produces a Sentry **issue** rather than a breadcrumb.
- **`src/lib/silentFailureTelemetry.ts` — `recordSwallow(tag, message, err)`** (`:86`). Per-tag
  counters, a rollup every 100 swallows or 5 minutes, and a sampled `captureException`. Called only
  by `silentCatch` / `silentCatchNull`; never call it directly.
- **`eslint-rules/no-silent-catch.cjs`** — `"error"` (`eslint.config.js:104`). Flags a catch body with
  zero statements. **0 findings today.**
- **`eslint-rules/async-catch-requires-helper.cjs`** — `"warn"` (`eslint.config.js:114`). Requires a
  `.catch()` handler to be one of the three helpers, or an inline handler that invokes one as a
  top-level statement. **1 finding today.** Read its docstring before adding an exception — it already
  allows the `reject` forwarding pattern and the delegate-plus-recovery shape.

## Steps

1. **Bind the error. Always.** Write `catch (err)`, never `catch {`. This is the step with the highest
   payoff-to-effort ratio in the whole path: `catch {` destroys the value at the language level, so no
   later step is available to you without first editing the signature. **374 sites in this repo cannot
   comply with step 3 without this edit.**
2. **Decide who is waiting.** Is a person blocked on this operation right now? → user door. Is this a
   background refresh, a prefetch, a best-effort enrichment, a cleanup? → operator door. This is the
   only judgement call in the path; make it once, per call site, and never with an `if`.
3. **Hand the bound value to that door, with a tag.**
   `catch (err) { silentCatch('module:operation')(err); }` ·
   `catch (err) { toastCatch('module:operation')(err); }` ·
   `.catch(silentCatch('module:operation'))` for a promise chain ·
   `reportError(err, fallback, set, { action })` inside a Zustand slice.
   Tag format is `feature/file:operation` — it becomes the aggregation key, so keep it stable across
   refactors and never interpolate a variable into it.
4. **If you also need local recovery, do both — door first.** The `async-catch-requires-helper`
   docstring sanctions exactly this: invoke the helper as a top-level statement of the handler, then
   reset your cache / update your state / return your fallback.
5. **If you are returning a fallback value, say so on the way out.** `return []` after a failed fetch
   renders as an empty state, which reads to the user as *"there is nothing here"* rather than
   *"we could not find out."* Either surface a degraded-state marker (see
   `useHealthCheck.ts:405-415` in Evidence) or use the user door.
6. **Stop.** No `console.error` in a catch, no second `extractMessage`, no per-feature logging
   convention, no error written only into component state.

### Can the type make the wrong call impossible? — answered

**Partly, and the part that matters is already done here.** The user/operator split *is* a type-level
choice in this repo: you pick `toastCatch` or `silentCatch`, two different imported symbols, exactly
as `brainiac` picks `From<(StatusCode,String)>` or `internal()`. That is the clause the sibling
independently arrived at, and Personas already has it. **Do not add a gate for it.**

**What a type cannot do here.** TypeScript has no `#[must_use]` for a caught binding, and
`catch {` is valid ES2019 by design, so "every catch reaches a door" is not expressible in the type
system. This is a genuine limit, not laziness — and it is why §9 exists at all for this leaf.

**What the primitive should do instead, and this is the actual headline fix.** The dominant defect is
not distributed across call sites; it is *one line in one file*. `toastCatch` — the door for failures
a human is actively waiting on — is the only door that never calls `recordSwallow`, so it can never
produce a Sentry event. Adding that one call fixes the observability of **379 call sites** at once.
**Prefer that over any gate.** A gate would count 379 correct usages as violations; the sites are not
wrong, the primitive is. Fix the primitive, then let §9 ratchet the genuinely-per-site defect
(the missing binding), which is the only part a call-site rule can legitimately own.

## Anti-patterns

- **`catch {` — the bindingless catch. 374 production sites.** Not a style preference: it makes every
  remedy in this document unreachable. `silentCatch(ctx)(err)`, `reportError(err, …)` and
  `Sentry.captureException(err)` all require an `err` that no longer exists. **116 of the 374 guard an
  `await`** — an IPC call, a fetch, a subprocess — where the discarded value was carrying the
  backend's typed `AppError` envelope (`kind`, `category`, `auto_fixable`) that
  [typed-error-contract](./typed-error-contract.md) computed at the source specifically so the
  frontend would not have to guess.
- **A failure that renders as an empty state.** `catch { setCompetitions([]) }`
  (`CompetitionList.tsx:59`), `catch { setStats([]) }` (`StrategyLeaderboard.tsx:17`),
  `catch { setActivity([]) }` (`BrokerPanel.tsx:106`). The user reads "no data"; the operator reads
  nothing. This is the single most damaging shape in the corpus because it is *indistinguishable from
  success* on both channels — and it converts a backend outage into a product that merely looks empty.
- **Telling the user and not telling Sentry. 297 sites.** `catch { addToast('Failed to update display
  name', 'error') }` (`IdentitySettings.tsx:44`, and four more in the same file). The toast is
  dismissed in five seconds and is then the only thing that ever knew. When the bug report arrives
  saying "it said failed", there is no trail.
- **`console.error(err)` as the record. 117 sites.** Sentry's default `breadcrumbsIntegration` does
  turn it into a breadcrumb — but a breadcrumb only leaves the machine if some *other* event is
  captured later in the same session. If nothing else fails, nothing is ever sent. It also carries no
  tag, so it cannot aggregate. `log.error` (`src/lib/log.ts:50`) is the same story: it is a
  `console.error` with a timestamp, not a transport.
- **A swallow inside a shared primitive.** `usePolling.ts:74` catches every polled fetch failure
  bindingless and backs off exponentially on the error count. **13 adopters** inherit a poller that
  goes quiet — not stops, *quiet* — when its endpoint dies permanently. One swallow, thirteen blind
  surfaces. See [polling-loop](./polling-loop.md).
- **A justifying comment instead of a record.** `no-silent-catch`'s own message already rejects this
  ("a comment-only justification is not enough — the next person debugging in production needs the
  breadcrumb, not the comment"). The sibling repos converged on the comment convention and *not* on
  the telemetry — `personas-cloud` has 17 `catch { /* best effort */ }` sites that emit nothing. The
  comment is for the reader of the code; the breadcrumb is for the reader of the incident.
- **Interpolating a variable into the context tag.** `silentCatch(\`load:${id}\`)` gives every entity
  its own aggregation bucket, so `recordSwallow`'s per-tag counter never reaches its sampling
  threshold and the rollup's top-N is all noise. The tag names the *operation*, not the *instance*.
- **Re-deriving the swallow rate locally.** A `failureCount` ref next to a catch is `recordSwallow`
  re-implemented without the rollup, the sampling, or the HMR-durable singleton.

## Evidence

**Adoption is excellent on one syntactic form and mediocre on the other, and the gap is the finding.**

| Form | Reaches a door | Rate | Gated by |
|---|---:|---:|---|
| `.catch(handler)` | 828 / 832 | **99.5%** | `async-catch-requires-helper` (warn) |
| `try { } catch { }` | 1,125 / 1,920 | **58.6%** | nothing — `no-silent-catch` only sees *empty* bodies |

Same repo, same authors, same concept, two spellings of one operation, **±41 points**. Both existing
rules are AST rules over the same file set; the only structural difference is that one visits
`CallExpression` on `.catch` and the other visits `CatchClause` but returns early unless the body has
zero statements. Nothing about try/catch makes it intrinsically harder to instrument — the corpus
contains 547 try/catch bodies that call `silentCatch` correctly.

> Two rival explanations, both measured and both insufficient. **Ergonomics:** the doors are curried
> for `.catch`, so try/catch needs the double-call `silentCatch('x')(err)` — but that shape appears
> **1,108 times**, so the friction plainly did not stop people. **Control flow:** 373 try/catch sites
> guard `JSON.parse` or Web Storage, where failure is arguably expected rather than exceptional —
> removing all of them still only lifts try/catch to ~63%. The gate difference is what is left.

- **`src/features/agents/sub_health/useHealthCheck.ts:405-415` — copy this one.** The best
  swallow in the repo, and the only site that does all three things: routes the error to
  `silentCatch('useHealthCheck:configWarnings')`, degrades to a fallback so the rest of the check
  still runs, **and pushes an info-severity issue into the result so the user can see the score is
  incomplete**. It is step 5 of this path, implemented. The file header (`:1-22`) states the
  three-step policy as a written contract for future sub-checks.
- `src/lib/silentCatch.ts:73-88` — the operator door. Note the ordering: raw message and stack are
  logged *before* any rewrite, and `recordSwallow` is last so it can never throw into the caller.
- `src/lib/silentFailureTelemetry.ts:1-18` — read this header before touching the aggregation. It
  states the design constraint that made 250+ call sites adopt telemetry with zero call-site edits:
  the helpers call `recordSwallow` internally.
- `src/stores/storeTypes.ts:114-119` — `Sentry.withScope` + `setTag('error.kind')` +
  `captureException`, unconditional. The only unconditional event producer in the frontend.
- `src/lib/utils/parseJson.ts:2-9` — the canonical **legitimate** bindingless catch.
  `parseJsonOrDefault(json, fallback)` names the fallback in its own signature, so a parse failure is
  the documented contract, not an error. This is the shape §9 deliberately does not gate.
- `eslint-rules/async-catch-requires-helper.cjs:29-41` — the docstring that already solved the hardest
  design question in this space (how to allow local recovery without allowing a bypass). The
  `CatchClause` rule proposed in §9 should reuse its `bodyDelegatesToHelper` logic verbatim.

## Deviations found

**Measured at `a53561963`. Test files excluded throughout (72 catch sites).**

### P0 — the user-visible door cannot produce a Sentry event (1 defect, 379 sites)

`toastCatch` (`silentCatch.ts:102-132`) emits `log.warn` + `Sentry.addBreadcrumb` + a toast. It does
**not** call `recordSwallow`. Its two siblings, 30 lines above and below it, both do (`:86`, `:145`).
A breadcrumb is not telemetry on its own — it is attached to the *next* captured event, so if nothing
else in the session fails, it never leaves the machine.

**Consequence: the failures a human is actively waiting on are the ones operators are least likely to
ever see.** The 1,271 background swallows are aggregated and sampled; the 379 user-facing ones are
not counted anywhere. This inverts the priority you would choose deliberately.

### P1 — 760 try/catch bodies reach no door at all (across 440 files)

| Outcome | try/catch | `.catch` | total | share |
|---|---:|---:|---:|---:|
| Sentry **event** (`reportError` / `captureException`) | 291 | 1 | 292 | 10.6% |
| Sentry **breadcrumb** (`silentCatch` 1,271 · `toastCatch` 379 · `silentCatchNull` 9 · raw 2) | 834 | 827 | 1,661 | 60.4% |
| `console` / `log.*` only | 117 | 0 | 117 | 4.3% |
| rethrow / reject (not the swallow site) | 35 | 0 | 35 | 1.3% |
| **user sees it, Sentry is blind** | 296 | 1 | 297 | **10.8%** |
| **nobody learns anything** | 347 | 3 | 350 | **12.7%** |
| **total production catch sites** | **1,920** | **832** | **2,752** | |

Only **10.6%** of catch sites can raise a Sentry issue on their own. Cross-check on the denominator:
the census engine and an independent brace-matching analyzer both counted 1,985 raw `catch` clauses
(1,982 after 3 doc-comment matches are excluded) — agreement to zero.

### P2 — the aggregation sampler almost never fires (1 defect, 1,280 sites)

`recordSwallow`'s sampled `captureException` (`silentFailureTelemetry.ts:139-169`) requires
`stat.count % 25 === 0`. But `flushRollup` (`:206`) calls `state.tags.clear()`, so `stat.count` is
**per-window**, not cumulative — and a window closes at 100 swallows or 5 minutes
(`SWALLOW_ROLLUP_MAX`, `SWALLOW_ROLLUP_INTERVAL_MS`).

**Net effect: a tag must constitute ≥25% of all swallows in a single window to ever produce an
event.** A path failing 20 times per window, forever, produces zero Sentry issues indefinitely. The
60-second global cool-down (`:154`) then caps the survivors at one per minute. The rollup breadcrumb
still fires, so the data exists — it just has the same "only ships if something else fails" problem.

### P3 — the error value is destroyed at the catch site (374 sites / 263 files)

Bindingless `catch {`, by what the `try` was guarding:

| Guarding | Sites | Assessment |
|---|---:|---|
| `JSON.parse` of local / user-authored text | 168 | mostly legitimate — failure is the function's contract |
| **an `await` (IPC, fetch, subprocess)** | **116** | **violation** — sampled precision 8/8 |
| pure sync work | 60 | mixed |
| Web Storage | 30 | mostly legitimate (quota / private mode) |

Named sites in the await set: `IdentitySettings.tsx:44,54,67,76,85` (five user-facing toasts, zero
telemetry) · `ContextMapHealth.tsx:91,103,117` · `PrBridge.tsx:231,242,253,289,328` ·
`DeadLetterTab.tsx:167,327,354,408` · `useRemediationEvaluator.ts:92` (a credential remediation
silently skipped with `continue`) · `useSchemaProposal.ts:125` (counts consecutive errors while
discarding every cause) · `usePolling.ts:74` (the shared primitive, 13 adopters) ·
`useTrainingSession.ts:152` (substitutes fabricated fallback Q&A pairs on failure).

### P4 — every error toast renders English in all 14 locales (675 sites)

Verified, corrected, and **not this path's to fix** — it belongs to the leaf
`error-message-resolution` (recurrence 47). Recorded here because the toast is frequently the *only*
record these failures produce, so its quality is this path's concern.

`typed-error-contract.md` states **684**; the correct figures are **680** call sites (388 `toastCatch`
+ 292 `reportError`) and **675** that actually emit a toast (5 `reportError` sites pass
`severity: 'state'`). The 684 came from summing two greps with inconsistent exclusion rules — one kept
the function definition and two JSDoc examples, the other kept one JSDoc example.

**The qualitative claim is stronger than stated.** `ToastContainer.tsx:59` is
`friendly?.message ?? toast.message`, and `resolveError` always returns a non-empty English string —
so `toast.message` is **unconditionally discarded for every error toast**. That includes the 49
`toastCatch` sites that deliberately pass an already-translated `customMessage`: a Czech string
matches no English rule, falls through to `GENERIC_FALLBACK`, and the user sees *"Something went
wrong."* **Supplying the correct translation makes the output worse.** (`ERROR_RULES` is **62**, not
the 63 that doc states — the 63rd `match:` is the interface field declaration at `errorRegistry.ts:52`.)

### P5 — documented policy violated in the file that documents it (1 site)

`useHealthCheck.ts` opens with a 22-line written error policy — *"Route the error through
`silentCatch` so Sentry gets a breadcrumb. An empty `catch {}` is never acceptable"* — and applies it
correctly at `:405`. The file's **main** check at `:448` then does
`catch (err) { const msg = err instanceof Error ? err.message : String(err); setError(msg); }` —
no `silentCatch`, no tag, and the `instanceof Error` ladder that
[typed-error-contract](./typed-error-contract.md) documents as the repo's most-replicated defect.
If a written policy in the same file does not hold, prose is not the mechanism.

### Boundary with the adjacent leaves — settled explicitly

- **[`typed-error-contract`](./typed-error-contract.md)** (recurrence 2,562, `sides: both`) owns
  **what the error *is*** — which `AppError` variant, which `kind`, what the envelope carries, and how
  the frontend narrows it. This path owns **whether any record of it survives the catch block.** The
  two meet at exactly one point: the bound error value. `typed-error-contract` is why that value is
  worth keeping (it carries a backend-computed taxonomy); this path is why you must not drop it.
  Non-overlap test: a perfectly-typed `AppError` discarded by `catch {` is 100% compliant with that
  path and 0% compliant with this one. Rule of thumb — if the question is *"which variant / which
  message"*, it is theirs; if it is *"does anyone find out"*, it is ours.
- **`error-surfacing-policy`** (90, unwritten) owns *which* surface — toast vs inline banner vs
  per-row marker. This path is deliberately silent on that choice and requires only that whichever
  surface you pick, a durable record is made alongside it.
- **`error-message-resolution`** (47, unwritten) owns turning a raw error into localized, actionable
  words. P4 above is its backlog, parked here with the corrected number.
- **`structured-logging`** (105, `sides: both`) owns log shape and volume. This path stops at
  "a record was made"; what that record looks like on disk is theirs.

### Out of scope: the Rust half — and why, plus what was found anyway

This leaf is `sides: "client"`, `twoSided: false`, so the backend is **not** this document's to
prescribe, and folding it in would produce the half-a-path failure the contract warns about. It was
measured regardless, because the brief asked whether it belongs here, and the answer needs evidence:

**1,128 `let _ = …` sites across 249 files, 93.5% with no `tracing::` call within two lines.** Roughly
**396** discard a database write (70 raw SQL + 42 `ddl_step` + 284 repo-layer) and **163** discard a
Tauri event emission. `event_registry.rs:36-38` — inside the module documented as the single source of
truth for event names — is `pub fn emit_event(...) { let _ = app.emit(event, payload.clone()); }`,
industrializing the discard across 21 call sites; the logging sibling `emit_event_bus` sits 8 lines
below with 9 callers, and the propagating `try_emit_event` is `#[allow(dead_code)]` with **zero**.
There is **no gate**: no `[lints]` table in any of the 5 `Cargo.toml`, no `clippy.toml`, no
`#![deny]`. CI's `cargo clippy -- -D warnings` is *structurally incapable* of seeing this, because
`let _ =` is the language's sanctioned suppression of `unused_must_use`, and the two clippy lints
that would catch it (`let_underscore_must_use`, `let_underscore_untyped`) are allow-by-default and
cannot be promoted by `-D warnings`.

The wave-1 claim checks out verbatim: `incremental.rs:5040-5059` is a tombstone dated 2026-08-13 for
three `ALTER TABLE executions ADD COLUMN pending_auth_*` statements that targeted a table that does
not exist (it is `persona_executions`) and failed on every boot since 2026-04-08, swallowed by
`let _ = ddl_step(…)`. **15 `ADD COLUMN` statements are still discarded this way.**

**Route it to:** [`boot-migration-step`](./boot-migration-step.md) (recurrence 168 — already written,
and already owns "whether a failing step aborts startup or is logged") for the DDL half, and
`structured-logging` (105) for the emit/repo-write half. It is a bigger, quieter surface than the
frontend's and deserves its own composition rather than an annex to this one.

## Gaps in the primitive

1. **`toastCatch` does not aggregate.** One missing `recordSwallow(context, msg, err)` call at
   `silentCatch.ts:131`. This is the highest-leverage line in the leaf: it makes 379 user-facing
   failures countable without touching a call site. Blocked on nothing.
2. **`recordSwallow`'s sampler resets its own counter.** `flushRollup` clears `state.tags`, so the
   `% 25` threshold is evaluated against a per-window count. Fix: keep a cumulative `totalCount`
   per tag across windows (clear only the window fields), or move sampling to a first-seen +
   exponential schedule (1st, 2nd, 4th, 8th…) which surfaces a newly-broken path immediately instead
   of never.
3. **There is no uncurried door.** All three helpers return `(err) => void`, which is `.catch`-shaped;
   a try/catch body must write `silentCatch('x')(err)` — 1,108 times so far. A `swallow(context, err)`
   / `report(context, err)` overload would let the more common syntactic form read as naturally as
   the less common one. (Ergonomics, not correctness — the measurement above shows friction is not
   what caused the 41-point gap.)
4. **No door expresses "degraded, and the user can see that it is degraded."** Step 5 has no
   primitive: `useHealthCheck.ts:405-415` hand-rolls it in eleven lines. A
   `degradedCatch(context, onDegrade)` — breadcrumb + rollup + a caller-supplied marker — would turn
   the corpus's worst shape (a failure rendering as an empty state) into a one-liner. This is the
   most valuable missing primitive in the leaf.
5. **`silentCatch` cannot distinguish "expected" from "unexpected".** A `JSON.parse` fallback and a
   dead IPC endpoint enter the same funnel, so the rollup's top-N is diluted by working-as-intended
   parse failures. An `expected: true` option (breadcrumb, no rollup, no sampling) would let the 168
   legitimate parse guards adopt a door without polluting the signal.
6. **A breadcrumb only ships if something else fails.** Structural to Sentry, not to this repo, and
   worth stating plainly because it is the assumption most often got wrong: `addBreadcrumb` is not a
   transport. Only `captureException` is. Everything in the "breadcrumb" row of the P1 table is
   invisible in a session that has no other captured event.
7. **No lint rule can see a `CatchClause` body's telemetry today.** `no-silent-catch` returns early
   unless the body is empty; `async-catch-requires-helper` never visits `CatchClause`. The 760
   doorless bodies sit exactly in the gap between two rules that each stop one step short. See §9.

## The missing gate

The two existing gates are good and one of them is *finished* — `no-silent-catch` is at `"error"` with
0 findings, which is what a successful gate looks like. Neither can see the actual defect. Three
pieces, in descending order of value.

**Before any of it: land Gap 1.** One line in `silentCatch.ts` fixes 379 sites. A gate that counted
those sites would be 379 false positives against a primitive defect. *Fix the primitive first;
gate only what remains per-site.*

### 1. `custom/catch-requires-helper` — ESLint rule, `"warn"` → `"error"`

- **Signal.** A `CatchClause` whose body contains no call to a sanctioned door
  (`silentCatch` / `silentCatchNull` / `toastCatch` / `reportError` / `Sentry.captureException` /
  `Sentry.addBreadcrumb`) as a top-level statement, and no `ThrowStatement`. **760 findings today.**
  This is the condition itself, not a proxy — which is why it must be an AST rule and not a census
  regex: the body's extent needs brace matching, which a regex cannot do.
- **Mechanism.** A third rule in `eslint-rules/`, reusing `async-catch-requires-helper.cjs`'s
  `bodyDelegatesToHelper` / `localHelperImportNames` logic verbatim — that file has already solved
  aliased imports, bound handlers, and the delegate-plus-local-recovery shape. `RuleTester` fixtures
  go in `src/test/eslint-rules/customRules.test.ts` beside the existing two rules' cases.
- **Allowlist.** No path allowlist. Per-site `// eslint-disable-next-line` **with a reason** for the
  legitimate parse-or-default shape (`parseJson.ts:6` is the model). Expect ~200 of the 760.
- **Severity.** Ships `"warn"` (760 sites is a migration), flips to `"error"` when the count reaches
  the allowlist floor. **The flip is not optional and the reason is count-independent:**
  `npm run check` runs `eslint src/` with **no `--max-warnings`**, so it exits 0 regardless; the
  pre-commit hook runs `--quiet --max-warnings 99999`, and `--quiet` discards warnings before they
  can be counted. **A warn-level rule enforces nothing at either gate, at any baseline size.** It
  still changes behaviour through editor squiggles at authoring time — which is exactly what
  `async-catch-requires-helper` demonstrates at 99.5% adoption while sitting at `"warn"` — but that
  is adoption pressure, not enforcement. Put the flip date in the rule's JSDoc.
- **How it fails loudly if its own precondition vanishes.** The rule must assert it visited at least
  one `CatchClause` per lint run over `src/` — a refactor to `Result`-style returns, or a parser
  change that stops producing `CatchClause` nodes, would otherwise read as a completed migration.
  Pair it with the census rule below, whose `floor` fails on exactly that.

### 2. Census rule `bindingless-catch-on-io` — the ratchet

**Publish-only; do NOT edit `scripts/census/rules.json` — the orchestrator merges this block.**

```json
{"rules":[
  {
    "id": "bindingless-catch-on-io",
    "goldenPath": "docs/concepts/golden-paths/swallowed-error-telemetry.md",
    "title": "I/O failure caught without binding the error, so no record of it is possible",
    "roots": ["src"],
    "extensions": [".ts", ".tsx"],
    "signal": {
      "pattern": "\\btry\\s*\\{(?:(?!\\btry\\s*\\{)[\\s\\S]){0,1500}?\\bawait\\b[\\s\\S]{0,1500}?\\}\\s*catch\\s*\\{(?!\\s*\\})",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a try block that AWAITS something, closed by a parameterless `catch {` with a non-empty body. PROXY FOR the stack-free condition: an I/O failure is handled at a site that has destroyed the only evidence of it, so no telemetry is reachable without first changing the handler's signature. The bindingless form is load-bearing and is what makes this a fact rather than a taste judgement - `catch {}` cannot call silentCatch(ctx)(err), reportError(err, ...) or Sentry.captureException(err) at all, because there is no `err`. The `await` conjunct is what keeps precision high: it restricts the rule to I/O (IPC, fetch, filesystem, subprocess), whose failure carries the backend-computed AppError envelope that typed-error-contract exists to produce. The 258 bindingless catches guarding SYNCHRONOUS work are deliberately NOT matched - 168 guard JSON.parse of local or user-authored text, where parse failure is the function's documented contract rather than an error (src/lib/utils/parseJson.ts:6 is the canonical legitimate shape). Measured precision on a deterministic spread sample of the await subset: 8/8 true positives; the broad all-bindingless variant measured ~30% false positives and was rejected for that reason. Line attribution points at the `try`, not the `catch`, because the match starts there. PRECONDITION (must be re-derived per repo): this repo writes async work as `try { await f() } catch { ... }` using ES2019 optional catch binding. A repo that always binds the error and then ignores it has the SAME condition wearing different syntax, and this pattern scores ZERO while the condition is present at full scale - the failure the portability test measured for tables.md and form-field-and-validation.md. Legal destinations: bind the error and hand it to silentCatch(context) / toastCatch(context) from @/lib/silentCatch, or reportError(err, fallback, set, { action }) from @/stores/storeTypes."
    },
    "exclude": [
      {
        "path": "src/test/**",
        "reason": "the test-automation harness at src/test/automation/bridge.ts drives the live app through deliberately-failing paths; a swallow there is a fixture, not a production blind spot"
      },
      {
        "path": "**/__tests__/**",
        "reason": "test files legitimately await a rejecting fixture and discard it to assert the surrounding behaviour rather than the error"
      },
      {
        "path": "**/*.test.ts",
        "reason": "test files legitimately await a rejecting fixture and discard it to assert the surrounding behaviour rather than the error"
      },
      {
        "path": "**/*.test.tsx",
        "reason": "test files legitimately await a rejecting fixture and discard it to assert the surrounding behaviour rather than the error"
      }
    ],
    "baseline": { "files": 84, "matches": 122 },
    "floor": 4000
  }
]}
```

**Validated standalone before publishing** (own rules file, unique filename, never against
`rules.json`). `--check` exits **0** at `files 84 / matches 122`; all four excludes match live files
(14 / 336 / 56 / 5). Fault injections, each run against the real tree:

| Fault induced | Exit | Message |
|---|---:|---|
| pattern replaced with a token that matches nothing | **1** | `matched zero files anywhere` |
| `floor` raised to 99999 | **1** | `THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `roots` renamed `src` → `app` | **1** | `walked 0 files but floor is 4000` |
| an `exclude` entry pointed at a deleted file | **1** | `matched no file. The exemption is stale` |
| baseline pinned 1 low (a violation lands) | **1** under `--check`, 0 under report | `matches rose 121 -> 122 (+1)` |
| baseline pinned high (silent drop) | **1** under `--check` | `matches dropped 200 -> 122 (-78)` |
| `exclude` entry with no `reason` | **1** | `needs a real "reason"` |
| **a real violation appended to `src/lib/utils/parseJson.ts`** | **1** under `--check` | `matches rose 122 -> 123 (+1)` |

The last row is the one that matters: an actual `try { await … } catch { return null }` written into
a real source file moved the count by exactly 1 and failed the gate; reverting it returned the tree to
exit 0 with no residue.

### 3. What was deliberately left ungated, and why

- **The 258 bindingless catches guarding synchronous work.** A rule over all 374 measured ~30% false
  positives on a spread sample — 168 are `JSON.parse` of user-authored or streamed text where
  returning a fallback is the function's contract, and `parseJson.ts` is the sanctioned shape.
  **Refusing here is the finding**, per the contract's rule that a mostly-false-positive gate must not
  be written. The AST rule in piece 1 covers them at warn-level with a per-site disable, which is the
  right instrument for a judgement call.
- **`console.error` in a catch.** Only **14** literal matches; the 117-site figure is dominated by the
  repo's own `log.warn` / `log.error`, which `silentCatch` itself calls. A rule banning it would fire
  on the primitive.
- **Whether the chosen door is the *right* door.** No machine can decide whether a given failure
  should interrupt the user. That is the one genuine judgement in this path, and it is where the
  `toastCatch`/`silentCatch` split already puts it — at a type-level choice between two imports,
  which is the shape `brainiac` independently arrived at. Leave it there.
- **The whole Rust surface.** Out of leaf scope (`sides: client`); routed above.

### 4. A note for any repo adopting this path

Take §2, §5 and the *intent* of this section. **Do not take the ESLint rule** — the convergence check
found zero sibling reinventions of "lint the empty catch" across three codebases, two of which
demonstrably could have written one and chose other targets. Re-derive your own instrument for the
same condition: a tracing-subscriber layer that makes logging *be* reporting (`brainiac`), an injected
logger the call site cannot avoid (`personas-cloud`), or counters incremented inside the catch body
(`personas-cloud/metrics.ts`) are all better-attested mechanisms than a linter.
