# Golden path — error surfacing policy

> Leaf `error-surfacing-policy` · domain `client-runtime` / subdomain `client-errors` ·
> recurrence 90 · `sides: client`
> Composed 2026-08-14 against `master` @ `58d82e608`. Sweep: 4,829 files walked by the census
> engine; 4,416 non-test `.ts`/`.tsx` files and 963 `.rs` files measured directly; 2,119
> error-handling doors, 4,223 Rust error-construction sites, 127 registry matchers and 25 wire
> variants executed rather than read. Convergence oracle run against `personas-web`,
> `personas-cloud` and `brainiac`.

---

## 0. Two things in the brief this path was handed, corrected before anything else

**The brief said `brainiac` makes the user-vs-operator distinction a type — `internal()` versus a
`From` impl. The polarity is backwards, and the correction makes the claim stronger.** In
`brainiac/crates/brainiac-server/src/mcp.rs:85-107` the `From<anyhow::Error>` and `From<sqlx::Error>`
impls both produce `ToolError::Internal` — the **operator-only** variant. Every `?` in a tool body
therefore lands in the silent bucket by construction; making a failure user-visible requires
explicitly calling `rejected(msg)` (17 sites, against 39 `invalid(` and an uncounted majority of
implicit `?`). The safe default is silence toward the user and user-facing is opt-in. That is the
part worth stealing. Note also that the REST-side twin (`http.rs:1909-1959`) is *not* type-enforced —
it is a struct with two constructors and 14 direct literal constructions — so if this shape is
adopted, adopt the **enum**, not the struct.

**The brief said `brainiac`'s redaction layer exists because of a real breach. It does not, and it is
not on the error path.** `redact.rs:1-15` names its own cause: a **UAT finding (H4, run 2026-07-13)**,
self-discovered in a trial, added by `909d13e` under the message "close the harms the UAT trial
found". Every call site is memory ingestion or provenance serving; it scrubs exactly one log line.
`brainiac` has **no error-message redaction at all** — it does not need one, because `internal()` and
`ToolError::Internal` mean no raw error string can reach a caller in the first place. Structural
prevention instead of scrubbing. Do not codify "add a redaction layer to the error path"; codify the
thing that makes it unnecessary.

---

## 1. Trigger

You are in this situation when you are about to type any of:

- "should this show a toast, or just log it?"
- "the fetch failed — what do I render?"
- `.catch(toastCatch(…))` — or `.catch(silentCatch(…))`, which is the same decision made the other way
- "is this error worth interrupting the user for?"
- "this failed but the user can't do anything about it"
- `reportError(err, 'Failed to …', set)` — whose default surfaces the failure **twice**

The test: **if you are about to choose between `toastCatch` and `silentCatch`, you are here.** The
adjacent path that owns those two doors ([`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md))
requires that you pick one and records the result; it explicitly declines to tell you *which*. This
document is that missing half.

### Boundaries with the three adjacent paths, stated so the seams are testable

- **[`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md)** owns *whether any durable
  record survives the catch block*, and it names this leaf as the owner of the surface choice
  ("`error-surfacing-policy` (90, unwritten) owns *which* surface … This path is deliberately silent
  on that choice"). It also declares one thing ungatable: *"No machine can decide whether a given
  failure should interrupt the user."* **That is correct and this path does not contradict it.** §9
  gates a strictly narrower, syntactic fact — whether the user pressed anything before the failure
  occurred — and leaves the semantic residue exactly where that path left it.
  Non-overlap test: a background prefetch failure handed to `silentCatch` with a stable tag is 100%
  compliant with that path **and** 100% compliant with this one; the same failure handed to
  `toastCatch` with an equally perfect Sentry trail is still 100% compliant with that path and
  violates §2 here.
- **[`typed-error-contract.md`](./typed-error-contract.md)** owns *what the error is on the wire* —
  which `AppError` variant, which `kind`, what the envelope carries. This path consumes that
  contract and asks one question of it that the contract does not answer: **is this failure
  actionable by the person looking at the screen?** The envelope already carries `category`,
  `auto_fixable` and `failover_eligible` (`src-tauri/core/src/error.rs:206-214`) and **no frontend
  call site branches on any of them** (§7.C). Non-overlap test: a perfectly-typed, perfectly-narrowed
  `AppError::NetworkOffline` is 100% compliant with that path and, rendered as a red five-second
  toast telling the user to check a connection they already know is down, violates §2 here.
- **[`toasts.md`](./toasts.md)** owns *the toast as a UI surface* — tone, duration, priority, ARIA,
  stacking, what the words may be. It starts, in its own words, "one step later: given that a human
  is being told, what does the telling look like." This path is one step **earlier**: whether a
  human is told at all. Its §7.E deliberately refused to gate the guard-clause class
  (`if (!title.trim()) addToast(…)`) at 50% measured precision; that class is *pre-work* validation
  and remains theirs. This path's class is *post-work*: work was attempted, it failed, and nobody
  asked for it. Non-overlap test: a beautifully-toned, correctly-timed, perfectly-translated
  four-second warning toast reporting that a background SLA refresh failed is 100% compliant with
  `toasts.md` and 0% compliant with this one.

---

## 2. The one way

**Interrupt the user only for a failure they caused and can answer; record everything else without
interrupting anyone.** Ask two questions in order, and only two. *Did the user just do something?* If
no — a mount fetch, a poll, a prefetch, a background sync — the answer is never a toast: render the
failure **inside the surface that was loading**, because that surface already owns a loading state
and therefore already owns a failure state, and if there is no surface, use `silentCatch(context)`
and let the operator find it. If yes — a click, a submit, a keypress — then ask *can they do
anything about it?* If yes, surface it where the remedy is: on the field, on the row, on the control
they pressed, with the toast reserved for work whose surface has already closed. If no, they are
still owed the failure, because they are waiting on it, but say what happens next rather than what
broke. **Never let a failure be silent and consequential at the same time** — if a write the user
requested did not happen, they must be able to tell, and the worst outcome in this repo is not a
missing toast but a UI that runs its success path anyway (§7.D). And **an expected non-event is not a
failure**: an aborted request, a superseded fetch, a closed panel and a disconnected socket are
excluded from **both** the user surface and the error telemetry — they are noise for both audiences,
which is the one clause every sibling repo with a UI reinvented independently.

---

## 3. Mandated primitives

| Primitive | Path | What it gives you |
|---|---|---|
| `toastCatch(context, customMessage?)` | `@/lib/silentCatch` | The **user door**. Emits `log.warn` + a Sentry breadcrumb with the raw string and the funnel category, then a 5 s error toast. Use only when the user is waiting and the surface that would have shown the result is gone. |
| `silentCatch(context)` / `silentCatchNull(context)` | `@/lib/silentCatch` | The **operator door**. Breadcrumb + `recordSwallow` aggregation. The default for anything the user did not initiate. |
| `reportError(err, fallback, set, { severity, action })` | `@/stores/storeTypes` | The **slice door**. The only door that captures an unconditional Sentry *event*, the only one with toast dedupe (5 s per identical message), and the only one that can write inline slice state and toast from a single call. Its `severity` option is a **destination**, not a severity — see §8.1. |
| `resolveErrorTranslated(t, raw)` | `@/i18n/useTranslatedError` | Raw string → `{ message, suggestion, category, action? }`, localized. **`category` is the actionability verdict this path is about**: `user_action` \| `recoverable` \| `system` \| `unclassified`. |
| `classifyErrorFull(raw)` | `@/lib/errors/errorPipeline` | Memoized single pass over all three classifiers. Carries `explanation.action`, the navigation the user would need. |
| `useRenderTriggerError(error)` | `@/features/triggers/lib/triggerError` | **The reference implementation of this entire path.** `triggerErrorPresentation(kind)` decides toast-vs-inline *from the error kind*, and every trigger consumer inherits one decision. |
| `noteFailure(source, message)` | `useUnifiedTriage.ts:519` | Per-source inline failure ledger — the shape to copy when one surface aggregates several independent fetches. |

Do **not** reach for `useToastStore.getState().addToast(msg, 'error')` directly. It is the only user
door with neither telemetry nor dedupe, and it is 160 of the 837 user-visible doors.

---

## 4. Steps

1. **Name who asked.** Before choosing a door, answer out loud: did a person press something to
   cause this call? An effect body, an interval, a `useEffect` on a dependency change and a
   subscription callback all mean **no**.
2. **If nobody asked, do not interrupt.** Render the failure in the surface's own body. The
   component already has `setLoading(true)`; give it a sibling error branch. If it has no body worth
   filling, `silentCatch('feature:operation')` and stop.
3. **If somebody asked, find the remedy's location.** A bad field value belongs on the field
   (`forms/FormField`); a failed row action belongs on the row; a failed action on a control that is
   still mounted belongs on that control (`buttons/AsyncButton` + an inline message). A toast is what
   is left when the surface has closed.
4. **Classify before you interrupt.** Run the raw string through `resolveErrorTranslated(t, raw)` and
   read `category`. `system` means the user cannot fix it and `recoverable` means it will retry —
   both warrant a *statement of what happens next*, never an instruction the user cannot follow.
   Only `user_action` may carry an imperative.
5. **Exclude the non-events.** `AbortError`, a cancelled/superseded request, an unmounted component
   and a closed connection return early — before the door, so they reach neither the user nor Sentry.
6. **Never surface twice by accident.** If you set inline state *and* call a door that toasts, the
   user gets two reports of one failure. `reportError`'s default (`severity: "both"`, 283 of 293
   sites) does exactly this — pass `"state"` when the surface already shows it.
7. **And then stop.** Tone, duration, priority, ARIA urgency, stacking and the overflow chip are all
   decided by `toastStore` — that is `toasts.md`'s territory and passing extra arguments opts out of
   a policy rather than configuring one.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and it is worth more than the gate.** See §8.1 and §10.

---

## 5. Anti-patterns

- **A red toast for a mount fetch.** The user opened a panel; the panel knows how to say "couldn't
  load this". Putting it in the opposite corner for five seconds instead means the panel shows an
  empty state that lies and the explanation self-destructs. *18 sites, §7.A.*
- **An instruction the user cannot follow.** "Review the highlighted fields and correct any errors"
  for a DNS resolution failure. Nothing is highlighted; there is nothing to correct. *1,466
  construction sites route here, §7.B.*
- **The raw backend string as the message.** `"Database error: UNIQUE constraint failed:
  personas.name"` is an operator artefact. It names a table. *15 of 25 wire variants, §7.B.*
- **A silent failure with a visible success path.** The delete failed, the modal closed, the list
  refreshed. The user believes it worked. *§7.D — the most severe class in this document.*
- **Interrupting the user and telling no one else.** `toastCatch` never produces a Sentry event and
  never calls `recordSwallow`; `silentCatch` at least samples one. Asserting a failure matters
  enough to interrupt a person, and then keeping no evidence, is incoherent. *§7.E.*
- **Choosing severity by which helper you imported.** Five severity vocabularies exist and none of
  them decides whether to surface. *§7.C.*
- **`if (isBackground) { … } else { … }` at the call site.** The choice is between two named doors
  (`swallowed-error-telemetry.md` §2). If you are writing a conditional, you are re-deciding a policy
  that has already been decided.

---

## 6. Evidence

**The one site to copy: `src/features/triggers/lib/triggerError.ts:39-58`.**
`useRenderTriggerError` routes on `triggerErrorPresentation(error.kind)` — the *kind* decides toast
versus inline, once, and every trigger consumer inherits it. It is the only place in 4,416 files
where the surfacing decision is made by classification rather than by which import the author
reached for.

Also exemplary:

- `src/features/agents/quick-answer/triage/useUnifiedTriage.ts:519` — `noteFailure(source, message)`
  gives four independent fetches four independent inline failure states in one deck. (It *also*
  toasts, which is the redundancy §9 removes; the ledger half is the part to copy.)
- `src/features/plugins/companion/BrainViewer.tsx:610-620` — `setError(…)` for the user **and**
  `silentCatch('companion_save_identity')` for the operator, in the same catch. Both audiences
  served, neither interrupted unnecessarily.
- `src/features/plugins/fleet/FleetSessionCard.tsx:118-131` — an optimistic rename **reverted on
  failure**, so the surface itself reports the failure by returning to the truth.
- `src/features/teams/sub_goals/GoalDetailDrawer.tsx:425-432` — `silentCatch` with a comment
  explaining that the store already toasted, so a second surface would be a duplicate. The reasoning
  is written down, which is why it survives review.
- `src/stores/storeTypes.ts:97-98,142-151` — the only toast dedupe in the repo: 5 s per identical
  message, with bounded eviction.
- `src-tauri/core/src/error.rs:144-153` — `sanitize_error_message` strips absolute paths before an
  error crosses the IPC boundary. The right instinct, applied to three of twenty-one variants.

---

## 7. Deviations found

### 7.A The user is interrupted about work they did not ask for — 18 sites / 15 files

391 `toastCatch` call sites. Classifying each by walking back to the construct that owns its
callback: **348 are reached from a handler** (a click, a submit, a `useCallback`) — those are correct
and this path defends them. **26 are reached from a `useEffect` or a timer.** Adding
`addToast(_, 'error')` inside effect bodies and excluding three files whose effect is a bridge for a
user action (§9) gives the census population: **18 matches across 15 files**, every one hand-audited.

The sharpest instances:

| Site | What the user did | What they get |
|---|---|---|
| `useUnifiedTriage.ts:500,533,557,583` | opened the triage deck | up to **four** simultaneous red toasts from one effect group — and `MAX_VISIBLE_TOASTS` is 3, so the fourth becomes a "+1" chip |
| `SLADashboard.tsx:37` | changed a day-range dropdown | "Failed to load SLA metrics" in the corner, while the panel it belongs to shows a loading state that resolves to nothing |
| `ExecutionsTab.tsx:28` | opened a credential's audit tab | "Failed to load audit history", five seconds, gone |
| `CredentialEditForm.tsx:76` | opened a form | "Failed to check vault status" — a fact about the vault, in the corner, while they type |
| `useConnectorStatuses.ts:91` | selected a persona | "Failed to load credentials. Connector statuses may be incomplete." |

**Every one of these components already owns a loading state.** The failure state is one branch away
in a surface the user is already looking at.

**The counter-measurement, which matters more than the defect.** Running the identical matcher with
the destination inverted to the *compliant* doors (`silentCatch`, `silentCatchNull`, `noteFailure`,
an inline error setter) scores **295 matches across 241 files**. So **94.3% of effect-reached
failures already go somewhere non-interrupting.** This is a residue, not a systemic failure, and the
document should not pretend otherwise.

### 7.B The friendly-copy registry is a lottery, and its biggest winner resolves to a falsehood

Since `c90a7e731` (today), `ToastContainer.tsx:77-78` renders the caller's raw string whenever the
classification is `unclassified`. That change is **correct** — it rescued 54 caller-authored messages
that previously all rendered "Something went wrong." — and it made the registry's coverage
load-bearing for the first time.

Measured by executing all **65 `ERROR_KEY_MAP` matchers and all 62 `ERROR_RULES` matchers** against
the Display template of every wire-facing thiserror variant (21 in `AppError`, plus the 4 in
`CryptoError`, which reaches the wire through `From<CryptoError> for AppError → Internal`
(`crypto.rs:437-441`)) — testing the **prefix the variant guarantees**, not a lucky payload:

- **10 of 25 resolve. 15 do not.**
- Unresolved: `Database`, `Pool`, `Io`, `Serde`, `Execution`, `ProcessSpawn`, `Auth`, `Cloud`,
  `GitLab`, `DeviceGroupConflict`, `Internal`, `External`, `CryptoError::{Encrypt, KeyManagement,
  Base64}`.

> **The brief's figure of 17 of 25 is the pre-repair number and used realistic payloads.** Measured
> after today's repair of the three dead matchers, on the guaranteed prefix alone, it is **15**. Both
> methods are defensible; they answer different questions. The prefix method answers the one that
> matters for policy: *what does this variant guarantee the user will see?*

Weighted by what the backend actually constructs — **4,223 non-test `AppError::` references across
963 Rust files** — **2,378 (56.3%) emit a prefix that matches nothing** and now render verbatim.

**And the resolved half is worse than the unresolved half.** Of the 1,845 resolving references,
**1,466 (79.5%) are `AppError::Validation`**, which matches the substring `Validation` and renders:

> *"Some input values are invalid." / "Review the highlighted fields and correct any errors."*

Sampled real emitters of that variant: `"Zapier hook DNS resolution failed: {e}"`,
`"Failed to read daily note: {e}"`, `"Invalid Ed25519 public key: {e}"`,
`"skill_sync publish: unknown project"`, `"Cannot extract host from Neon connection string"`. **The
largest single class of user-facing error copy in this app instructs the user to correct fields that
do not exist.** This is the exact failure this leaf owns: not that the words are wrong (that is
`i18n-string-authoring`), not that the envelope is wrong (that is `typed-error-contract`), but that
the *policy decision* — is this the user's to fix? — was never made.

Against convergence this is a **violation of the one clause all three siblings reinvented**: internal
faults get a constant message and the detail goes to the log. `sanitize_error_message`
(`error.rs:144-153`) strips absolute paths only, and only for `Database`/`Io`/`Internal`; hostnames,
SQL identifiers, table names and ids pass through. Sentry's `scrubPii` runs in
`beforeSend`/`beforeBreadcrumb` — the telemetry path, never the toast.

### 7.C The actionability taxonomy exists, is populated, and nothing reads it

`FriendlyErrorCategory` (`errorRegistry.ts:22`) is a four-way **actionability** verdict with a
docstring that states the policy in plain words: `system` = "backend / environment problem the user
cannot fix"; `recoverable` = "transient or self-healing"; `user_action` = "requires the user to fix
something". Every resolved error carries it. Distribution across the two matcher tables:

| category | ERROR_RULES | ERROR_KEY_MAP | meaning |
|---|---:|---:|---|
| `user_action` | 38 | 41 | the user can fix it |
| `recoverable` | 17 | 17 | it retries; no action needed |
| `system` | 7 | 7 | the user cannot fix it |
| `unclassified` | 1 | 1 | unknown |

**Zero call sites branch on it.** `grep -E "category === '(system|user_action|recoverable|unclassified)'"`
over `src/` returns nothing. `ToastContainer.tsx:77` reads it exactly once, to answer "did *anything*
match" — never "should this be shown, and how". So **24 of 63 rules (38%) declare that there is
nothing for the user to do, and all 24 produce the same red, assertive, five-second interrupt as the
38 that declare there is.**

Five severity vocabularies coexist, and none of them governs surfacing:

1. `FriendlyErrorCategory` — 4 values, actionability, **0 consumers**.
2. `ErrorSeverity` in `errorExplanation.ts:30` — `critical|warning|info`, **1 consumer**
   (`ErrorExplanationCard.tsx:46`).
3. `errorTaxonomy`'s `ErrorCategory` + `defaultSeverity` — `info`→`critical`.
4. Toast tone — `success|error|warning` (`toastStore.ts:36`).
5. Healing severity — `critical|high|medium|low` (`toastStore.ts:41`).

Is severity chosen consistently or per-author? **Neither.** It is chosen by *which door the author
imported*: `toastCatch` is always tone `error`, always 5,000 ms, always ARIA-assertive, regardless of
whether the underlying category says the user cannot act. The author never makes a severity decision
at all.

**Convergence says do not fix this with a sixth taxonomy.** Severity schemes scored **0/3** across the
siblings — `brainiac` uses tracing's four levels (error 17 / warn 31 / info 75 / debug 1),
`personas-cloud` uses pino's five (fatal 2 / error 48 / warn 43 / info 87 / debug 12),
`personas-web` has four disjoint hand-rolled vocabularies and an effectively binary result. Three
repos, three incompatible schemes, no convergence. The fix is to make the **existing** category an
input to surfacing (§10), not to invent a taxonomy.

### 7.D Actionable failures that are silent — and the false-success class

1,278 `silentCatch` tags carry a string literal. 204 are unambiguously background. 86 name a mutation
verb and are not background; **54 of those have no user-visible surface within ±12 lines.**

**That 54 is an upper bound and this document does not claim it.** Twelve were hand-audited: **5
confirmed, 5 refuted, 2 borderline** — so the real population is on the order of **~24**. The refuted
five are worth naming, because they are the compliant shapes (`BrainViewer.tsx:616` sets inline error
*and* swallows; `GoalDetailDrawer.tsx:431` documents that the store already toasted;
`FleetSessionCard.tsx:128` reverts an optimistic patch; `memoryActions.ts:75` and
`updateHistory.ts:44` are `localStorage` writes with an in-memory backup).

The five confirmed:

| Site | The failure | What the user sees |
|---|---|---|
| **`ActivityModals.tsx:90`** | `deleteMessage` rejects | **the modal closes and the list refreshes — the success path runs anyway.** The message is still there and the user has no reason to think otherwise |
| `AlertRulesPanel.tsx:332,333` | toggle / delete an alert rule | nothing at all |
| `PocketVoicePanel.tsx:104-113` | delete a cloned voice | the dialog closes, `refresh()` is skipped (it sits after the throwing call), the row stays |
| `SensorySignalsModal.tsx:83-90` | delete a sensory signal | `refresh()` runs, the row stays, no explanation |
| `FactoryShell.tsx:76-86` | debounced autosave of typed KPI thresholds, pros and cons | the typing is silently not persisted |

`ActivityModals.tsx:90` is the worst shape in this document: **a silent failure paired with a visible
success.** A missing toast loses information; a success path that runs on a rejected promise
manufactures a false belief. §2's "never silent and consequential at the same time" exists for this
line.

### 7.E The door that interrupts the user produces the least operator evidence

Counting all 2,119 error-handling doors in `src/`:

| Destination | Doors | Share |
|---|---:|---:|
| **Silent** — `silentCatch` 1,268 + `silentCatchNull` 9 | **1,277** | 60.3% |
| **User-visible** — `toastCatch` 389 + `addToast(_, 'error')` 160 + `reportError` toast path 288 | **837** | 39.5% |
| **Inline state only** — `reportError({ severity: 'state' })` | **5** | 0.2% |

`reportError` splits 283 default (`"both"` — inline **and** toast) / 5 `"toast"` / 5 `"state"`. Zero
sites pass `"both"` explicitly, so 283 authors surfaced the same failure twice without choosing to.

Now the telemetry each door produces:

- `reportError` — `Sentry.captureException` **unconditionally**, outside every branch
  (`storeTypes.ts:115-120`). 293 sites.
- explicit `Sentry.captureException` — 9 sites.
- `silentCatch` — breadcrumb, plus a *sampled* event: every 25th hit of one tag, with a 60 s global
  floor (`silentFailureTelemetry.ts:32-34,151-156`).
- **`toastCatch` — a `log.warn` and a `level: 'warning'` breadcrumb. Never an event. Never
  `recordSwallow`.** (`silentCatch.ts:102-136`.)

So **302 of 2,119 doors (14.3%) produce a Sentry event**, and the 389 doors that interrupt a human
produce strictly less evidence than the 1,277 that deliberately do not. A warning breadcrumb uploads
only if an unrelated *error* event fires later in the same session — so "we logged it" frequently
means nobody will ever see it. The mechanism is
[`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md) §P0's to fix and is still open; the
**policy** consequence is this document's: interrupting a person is an assertion that the failure
matters, and this repo makes that assertion at the one door that keeps no proof.

### 7.F Expected non-events are not excluded — the one clause every sibling reinvented

Convergence scored this **2/2 applicable — physics**: `brainiac` types timeouts into a 504
(`api.ts:109`), `personas-web` returns 499 for `AbortError` with the reasoning written down
(`stream/route.ts:31-40`: *"not a real failure, don't bother the client with a body it can't parse and
don't pollute Sentry with non-actionable noise"*).

In Personas:

- **`AbortError` is guarded at 12 sites across 8 files** — all local, all hand-retyped, never
  extracted (`AddSourceForm.tsx:76`, `arxivClient.ts:88`, `crossrefClient.ts:103`,
  `ArxivSearchModal.tsx:63`, `useAsyncFieldValidation.ts:129`, …). The same repetition
  `personas-web` shows, and the same absence of a helper.
- **Offline is not handled at all.** No `navigator.onLine`, no `window.addEventListener('offline')`,
  no banner anywhere in `src/`. Losing connectivity produces `AppError::NetworkOffline` → a red,
  assertive, five-second toast reading *"You appear to be offline. Check your internet connection and
  try again."* — repeated per failed call, undeduped, telling the user something their OS already
  told them. `brainiac` solves precisely this with a **persistent** `<ApiOffline />` / `<DemoBanner />`
  and no toast library at all.

### 7.G Dedupe covers 34% of the user-visible doors

`reportError` holds the only general dedupe: 5 s per identical message with bounded eviction
(`storeTypes.ts:97-98,142-151`) — 288 of 837 user-visible doors (**34.4%**). `toastCatch` and
`addToast` have none. Healing toasts dedupe by `issueId` (`toastStore.ts:162`), which is a different
mechanism for a different reason.

The interaction with 7.F is the failure mode: an offline burst arrives through the doors *without*
dedupe, at 5 s each, into a stack that shows 3 and counts the rest.

### 7.H What this path CLEARED

Three things the brief or the obvious reading would predict, which the measurement refutes:

- **"Most failures are hidden."** No — 39.5% of doors surface to the user, and 94.3% of
  effect-reached failures already route to a non-interrupting destination. The problem is
  concentrated, not diffuse.
- **"Severity is chosen inconsistently per author."** No — it is not chosen at all. Tone, duration
  and ARIA urgency follow deterministically from which helper was imported. There is no per-author
  variance to normalize, which is why a style guide would change nothing.
- **"The 54 silent mutations are a backlog."** No — hand-auditing 12 refuted 5 of them outright. The
  honest number is ~24, and five of the refutations are exemplary code that a naive sweep would have
  "fixed" into duplicate surfacing.

---

## 8. Gaps in the primitives

### 8.1 `reportError`'s `severity` parameter is a destination wearing a severity's name

```ts
options?: { severity?: "toast" | "state" | "both"; … }   // storeTypes.ts:104-109
```

Its values are surfaces. Its default is `"both"`, and **283 of 293 call sites take the default** — so
the single most-used door in the repo answers this leaf's question implicitly, in the direction of
"surface it twice", 96.6% of the time. Renaming it `surface` and making it **required** would force
283 authors to state the answer once, at the only place in the codebase where both surfaces are
reachable from one call. This is the highest-value change this document proposes.

### 8.2 There is no primitive for "this surface failed to load"

`toasts.md` §7.E measured the cause: reaching a toast is one line from anywhere
(`useToastStore.getState().addToast(…)`); reaching an inline error is a `useState`, a render branch
and a placement decision. `UnifiedTable` takes `isLoading` and `data` and gives a three-state body —
it takes **no `error`**. `RouteChunkSkeleton` has no failure variant. `feedback/ScenarioEmptyState`
exists but "empty" and "failed" are different states. Until a `SurfaceError` primitive is as cheap as
`addToast`, §7.A will regrow.

### 8.3 `resolveErrorTranslated` returns the actionability verdict and no way to act on it

`category` is computed and handed back. There is no `surfaceFor(category)`, no `shouldInterrupt(…)`,
nothing that turns the verdict into a decision. The taxonomy is a comment with a type annotation.

### 8.4 Two matcher tables must be edited in lock-step, by hand

`ERROR_RULES` (62) and `ERROR_KEY_MAP` (65) carry the same patterns and the same categories in two
files, with "keep the two in sync" written in both. That is how three matchers came to reference
PascalCase Rust variant names that never appear on the wire, and stayed dead until today.

### 8.5 `AppError::Validation` and `AppError::Internal` are 67% of all construction sites

1,466 + 1,371 of 4,223. Neither carries any signal about whether the user can act. As long as the two
dominant variants are semantically empty, no frontend policy can be better than a guess — this is
`typed-error-contract.md`'s to fix, recorded here with the number it costs on screen.

---

## 9. The missing gate

**Manifestation layer** ([`golden-path-contract.md:34-60`](../golden-path-contract.md)). The warning
must be loud here: the convergence oracle found **zero** lint or CI gates on error-surfacing policy in
any of the three siblings — `personas-web` ships five bespoke ESLint AST rules and points none at
errors (and sets `caughtErrorsIgnorePattern: "^_"`, actively permitting discard); `brainiac` ships a
workspace-wide clippy gate and aims it at panics; `personas-cloud` has none. **Nobody has
independently invented gating this.** The condition below travels; the rule does not.

### The semantic condition, stated stack-free

**C1 — a failure the user did not solicit is delivered as a transient, self-erasing interruption,
from a surface that owns a loading state and could have rendered it inline.** The user pressed
nothing; the surface that was loading is still on screen; the report is placed somewhere else and
deleted after five seconds. *Precondition here:* this repo starts unsolicited work in `useEffect` and
funnels transient notifications through `toastCatch(ctx)` / `addToast(msg, 'error')`. A repo that
fetches in a router loader, a server component, or a query library's `onError` has the same condition
in different syntax and scores **zero**. Both UI-bearing siblings score zero for a second reason:
neither has a toast library at all.

**This is deliberately narrower than "is this failure important."**
[`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md) §3 declared that ungatable and was
right. *Solicited-versus-unsolicited* is syntactic — it is decidable from the construct that owns the
callback, with no judgement about the failure itself. The judgement residue stays where that path
left it.

### Conditions deliberately NOT gated, each with the measurement

- **C2 — an actionable mutation that fails silently (§7.D).** The regex heuristic found 54; hand
  auditing 12 confirmed 5 and **refuted 5**, i.e. ~45% precision. The contract forbids a
  mostly-false-positive gate, and `toasts.md` C2 and `swallowed-error-telemetry.md` both refused at
  50% and ~70% respectively. **Refusing is the finding**, and it is load-bearing: the five
  refutations are *correct* code (inline error + swallow; a documented "the store already toasted";
  an optimistic revert) that a gate would have pushed into duplicate surfacing. The five confirmed
  sites go to the backlog as named fixes, not as a ratchet.
- **C3 — a toast whose resolved `category` is `system` or `recoverable` (§7.C).** The category is
  computed at *runtime* from a string the static text does not contain. Not regex-reachable, and an
  AST rule cannot evaluate 127 matchers either. This is a **unit test** — assert that
  `resolveErrorTranslated` for each `system` rule yields no imperative — plus the type change in §10.
- **C4 — wire variants with no registry rule (§7.B, 15 of 25).** Genuinely checkable, but it is a
  *cross-language mirror* check between `error.rs` and two TS tables, which is exactly
  [`typed-error-contract.md`](./typed-error-contract.md) §9's `scripts/check-error-contract.mjs`.
  **Not adding a second counter for a signal an adjacent path already proposes to count.**
- **C5 — the raw error string as toast copy.** Already counted by `raw-error-as-toast-message`
  (12 files / 20 matches, `toasts.md`) and `discarded-toast-copy` (49 / 94,
  `i18n-string-authoring.md`). Checked before writing anything: **this path adds no counter to
  either.**
- **C6 — `toastCatch` producing no Sentry event (§7.E).** A property of one function, not of any call
  site. It is a one-line fix in `silentCatch.ts` owned by `swallowed-error-telemetry.md` §P0, not a
  gate.
- **C7 — missing `AbortError` / offline exclusion (§7.F).** Gating an *absence* means asserting that
  every fetch has a guard, which would fire on all 391 sites and mean nothing. The right instrument
  is the shared helper that does not exist yet (Gap 8.2).

### The rule — validated

```json
{
  "rules": [
    {
      "id": "unsolicited-failure-as-toast",
      "goldenPath": "docs/concepts/golden-paths/error-surfacing-policy.md",
      "title": "A failure the user did not ask for, delivered as a transient interruption",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\buse(?:Layout)?Effect\\s*\\(\\s*(?:\\(\\s*\\)|\\w+|async\\s*\\(\\s*\\))\\s*=>\\s*\\{(?:(?!\\buse(?:Layout)?Effect\\s*\\(|\\buseCallback\\s*\\(|\\bconst\\s+\\w+\\s*=\\s*(?:async\\s*)?\\()[\\s\\S]){0,900}?(?:toastCatch\\(|addToast\\((?:(?!addToast\\()[\\s\\S]){0,160}?,\\s*['\"]error['\"])",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "an error toast reached from the body of a useEffect/useLayoutEffect without crossing a nested function boundary on the way. PROXY FOR the stack-free condition: the app decided to do the work, the work failed, and the user - who pressed nothing - is interrupted by a transient, auto-dismissing, corner-anchored surface reporting a failure they did not request, from a component that already owns a loading state and could have rendered it inline. The effect anchor is load-bearing and is what makes this a fact rather than a taste judgement: a handler-reached toast answers a question the user asked and is CORRECT - 348 of 391 toastCatch sites are handler-reached and are deliberately NOT matched. The tempered middle, which refuses to cross `const x = (`, `const x = async (`, `useCallback(` or a second `useEffect(`, is what keeps precision high: without it the same scan reports 3 extra matches whose toast lives in a sibling function defined after the effect (IncidentDiagnosisCard.tsx:27 and BrowserBridgePanel.tsx:33 are the canonical false positives it removes). PRECISION measured by auditing ALL 21 raw matches rather than a sample: 18 true positives, 3 excluded by name below. POSITIVE CONTROL: the identical pattern with only the destination inverted to the compliant doors (silentCatch / silentCatchNull / noteFailure / an inline error setter) scores 295 matches across 241 files, a 16x separation, so the pattern discriminates on the destination and not on `is this an effect body`; that control FAILS against this rule's baseline, as it must. RECALL is deliberately partial: a surface whose loading flag lives in a Zustand slice fetches through the same effect but is counted only when the toast is lexically inside the effect body. Legal destinations, in order: (1) render the failure INSIDE the surface that was loading - it already owns the loading state, so it owns the failure state, and useUnifiedTriage.ts:519 `noteFailure(source, message)` is the reference implementation; (2) where the surface has no body of its own, a persistent inline banner, never a toast; (3) silentCatch(context) when the fetch is advisory and the user loses nothing they can see. PRECONDITION (must be re-derived per repo): this repo starts unsolicited work in useEffect and funnels transient notifications through toastCatch(ctx) / addToast(msg, 'error'). A repo that fetches in a router loader, a server component, or a query library's onError has the SAME condition wearing different syntax and scores ZERO here. Both UI-bearing siblings audited for this path score zero for a second reason: neither personas-web nor brainiac has a toast library at all, and brainiac routes every unreachable-server read to a persistent <ApiOffline /> or <DemoBanner /> instead."
      },
      "exclude": [
        {
          "path": "src/hooks/utility/timing/useDebouncedSave.ts",
          "reason": "the effect is a DEBOUNCE of work the user initiated by typing, not an unsolicited fetch - the user is owed the failure. It additionally sets `lastError` for the inline surface before toasting, which is the shape this path prescribes"
        },
        {
          "path": "src/features/triggers/lib/triggerError.ts",
          "reason": "useRenderTriggerError IS this path's policy implemented - `triggerErrorPresentation(error.kind) === 'toast'` routes by error kind, and the effect is only the render-to-toast bridge for a failure the user already caused. The one place in the repo that decides surfacing by classification rather than by which door was imported"
        },
        {
          "path": "src/features/triggers/sub_studio/useStudioComposer.ts",
          "reason": "the effect reacts to `armedSource` and `armedSystemOp`, both set by a click, and rejects an invalid combination - a validation verdict on a user action, not a background failure. Excluding the whole file is the cost of a file-granular exclude list and is accepted here because the file contains exactly one toast"
        }
      ],
      "baseline": { "files": 15, "matches": 18 },
      "floor": 4000
    }
  ]
}
```

### Validation — reproduced, fault-injected, and positive-controlled

Run standalone against a private rules file (never against `scripts/census/rules.json`, per the
contract's concurrent-writer warning):

```
node scripts/census/run-census.mjs --rules <private>.json --check --verbose
```

| Check | Result |
|---|---|
| Baseline reproduces | `OK` — 15 files / 18 matches / 4,829 walked / floor 4,000 · **exit 0** |
| Runtime | ~1.4 s for the rule alone; no variable-length lookbehind, all anchors forward-chained and bounded |
| Fault: baseline `matches` 18→17 (a new violation) | `[drift] matches rose 17 -> 18 (+1)` · **exit 1** |
| Fault: baseline 19/16 (a silent drop) | `[drift] files dropped 16 -> 15`, `matches dropped 19 -> 18` · **exit 1** |
| Fault: `roots` → a non-existent dir | `[structural] walked 0 files but floor is 4000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` + `zero-matches` + 3 stale-exclude failures · **exit 1** |
| Fault: an extra exclude that matches nothing | `[structural] exclude "src/does/not/exist.ts" matched no file` · **exit 1** |
| **Positive control** — identical anchors, destination inverted to the compliant doors, violating baseline retained | **295 matches / 241 files** vs 18/15 · `[drift] matches rose 18 -> 295 (+277)` · **exit 1** |

The positive control is the load-bearing one. A 16× separation between the violating and compliant
destinations, from a pattern that differs only in its final alternation, is the evidence that the
count measures the *destination* rather than "how many effect bodies exist". A first attempt at this
control was mis-escaped through shell argv, produced an invalid RegExp and "failed" for the wrong
reason (`0 rule(s)`); it was rewritten as a file and re-run. **Census patterns go in a file, never in
bash argv** — MSYS mangles the backslashes.

### How it fails loudly if its own precondition is absent

The `floor: 4000` assertion means a repo whose `roots`/`extensions` no longer describe it reports
"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN" rather than a clean run. The `zero-matches`
structural check means a port to a repo with no `useEffect`-plus-toast idiom fails immediately
instead of baselining at 0 — which is the correct outcome, because the condition is present there in
different syntax and this proxy cannot see it.

---

## 10. Type over gate — the answer

**Yes, and the type change is worth more than the gate.** Three moves, in value order:

1. **Make the surface choice required, not defaulted.** Rename `reportError`'s `severity` to
   `surface` and drop the default. 283 of 293 call sites currently answer this leaf's central
   question by not answering it, and the compiler can force each one to answer. This is the same
   move `brainiac` made structurally: there, the `From` impls land in the **operator** variant, so
   anything that bubbles implicitly is silent-by-construction and user-facing must be typed out by
   hand (`mcp.rs:85-107`). One repo out of three, so **local calibration rather than physics** — but
   it is the only implementation among the three that makes the 3/3 converged clause impossible to
   violate, and that is a strong reason to steal the shape despite n=1.
2. **Make the actionability verdict an input rather than a comment.** `resolveErrorTranslated`
   already computes `category`; give the resolved error a `surface: 'toast' | 'inline' | 'silent'`
   derived from it, so that a `system` or `recoverable` classification cannot produce a five-second
   red imperative. This uses the taxonomy that already exists; it does **not** add a sixth. The
   convergence verdict on severity taxonomies is **0/3 — do not codify one**.
3. **Make "this surface failed" as cheap as "toast this".** Give `UnifiedTable` an `error` prop
   beside `isLoading`, and `RouteChunkSkeleton` a failure variant (Gap 8.2). §7.A is 18 authors
   taking the one-line path because the correct path costs a `useState`, a branch and a layout
   decision. A gate that ratchets 18→0 without this will be fought at every site.

The gate is the ratchet that holds the line until (1) and (3) land. It is not the fix.

---

## Backlog

| # | Item | Where | Size |
|---|---|---|---|
| 1 | `ActivityModals.tsx:90` runs the success path on a rejected delete | `sub_activity/ActivityModals.tsx` | S |
| 2 | Four remaining confirmed silent mutations (§7.D) | AlertRulesPanel, PocketVoicePanel, SensorySignalsModal, FactoryShell | S |
| 3 | `reportError`: rename `severity`→`surface`, make it required | `stores/storeTypes.ts` + 293 sites | L |
| 4 | 18 unsolicited toasts → inline surface state | §7.A table | M |
| 5 | `UnifiedTable` `error` prop; `RouteChunkSkeleton` failure variant | `shared/components` | M |
| 6 | Shared `isExpectedNonEvent(err)` helper; 12 hand-rolled `AbortError` guards route through it | `lib/errors/` | S |
| 7 | Persistent offline banner; stop toasting `NetworkOffline` per call | new — mirrors `brainiac`'s `<ApiOffline />` | M |
| 8 | `surfaceFor(category)` on the resolved error (§10.2) | `i18n/useTranslatedError.ts` | M |
| 9 | Registry rules for the 15 unmatched wire variants — routed to `typed-error-contract.md` §9's mirror gate, not duplicated here | cross-path | M |
