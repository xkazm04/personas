# Golden path — Error message resolution

> Situation node: `client-runtime/client-errors/error-message-resolution` · [situation spine](../situation-spine.md)
> Recurrence **47**. Dimensions: **ui · function · code-quality · resilience**.
> Composed 2026-08-14 against `master` @ `e76646f7d`. Sweep: ~50 tool calls, 42 files read,
> plus two programmatic corpora — **3,539** `AppError::X(..)` constructions and **47**
> `ValidationError::new(..)` messages parsed out of **963** git-tracked Rust files, and the three
> resolution tables extracted from TypeScript with the compiler AST (never grepped).
> `.claude/worktrees/**` excluded from every count (three stale copies of `src-tauri` live there and
> would inflate the Rust corpus ~4×); the file list is `git ls-files`, so `.gitignore` does the excluding.
> Every number below was produced by **two independent implementations** that agree — see §9.
> **Deviations** is a fix backlog; it migrates to `violating` cells when this path is ingested.

Shared counts cited from [`shared-facts.json`](../shared-facts.json) @ `211d519bb`:
963 Rust files, 4,829 `.ts`/`.tsx` files under `src`, 1,135 lint warnings / 0 errors.

---

## Where this path stops and its neighbours start

Three paths touch the same wire. The boundaries are drawn by *what each one decides*:

| Path | Owns |
|---|---|
| [`typed-error-contract.md`](./typed-error-contract.md) | **The wire shape.** Which `AppError` variant a failure becomes, what the envelope carries (`error` / `kind` / `category` / `auto_fixable` / `failover_eligible` / `details`), and that the rejection value crosses the FFI un-stringified. |
| **this path** | **The mapping from a raw error to the sentence a user reads.** Which rule claims a given wire string, in what order, what happens when nothing claims it, and whether the sentence that renders is the one someone wrote for that failure. |
| [`i18n-string-authoring.md`](./i18n-string-authoring.md) | **The catalog.** That the sentence lives in `en.json` under a key, that all 14 locales have it, and that no English literal renders in a translated UI. |

The seam that matters: **`typed-error-contract` guarantees a `kind` arrives; `i18n-string-authoring`
guarantees a sentence exists; this path is the only thing that decides which sentence goes with which
error — and it is the only one of the three with no gate on it.** A `kind` that reaches the client
and a translated sentence that exists in all 14 locales still produce the wrong output if the table
in the middle picks the wrong row, and §7 shows that it picks the wrong row **30 times out of 65**.

---

## 1. Trigger

You are in this situation when you say or type any of:

- "the toast just says *Something went wrong*" / "why is this error so generic?"
- "add a friendly message for this failure" / "this error needs a better suggestion"
- "the user sees a raw Rust error" / "there's a SQL table name in the toast"
- "map this backend error to something actionable"
- "why does a DNS failure say *Review the highlighted fields*?"

**The if-you-are-about-to-write-X test.** You are in this situation if you are about to write any of:

```
{ match: '…', error: { message: …, suggestion: … } }      // a new registry rule
{ match: '…', keyPrefix: '…', category: '…' }             // a new translated rule
if (raw.includes('…')) return { friendly: …, suggestion: … }   // a local ladder
setError(err instanceof Error ? err.message : String(err))     // no resolution at all
setError(extractMessage(err))                                   // extraction ≠ resolution
```

If you are picking the `AppError` **variant**, you are in `typed-error-contract`. If you are
adding the **key** to `en.json`, you are in `i18n-string-authoring`. If you are deciding **which
sentence** — you are here.

---

## 2. The one way

**Resolve on the machine discriminant the producer already sent, and let prose matching be the
explicitly-labelled fallback for values that have no discriminant.** Concretely, in this repo: the
backend computes `kind` and `category` at the source and ships them beside the message
(`error.rs:160-230`), so the resolver's signature must accept the **rejection value**, not a string —
`resolveErrorTranslated(t, err: unknown)`, narrowing with `isTauriError(err)` and selecting the copy
table by `err.kind` **before** any substring runs. Within a kind, order rules most-specific-first and
give every kind an explicit default, so the generic sentence is the *last arm of its own kind* and
never a competitor to a specific rule from a different one. Author exactly one such table for the
whole app; a second ladder anywhere else is a second registry, and the two will disagree within a
release. When nothing matches, do **not** invent a sentence — render the producer's own message and
mark it unresolved so the difference between "we recognised this" and "we did not" is visible to the
user, to Sentry, and to the next person who reads the toast.

If you can only do one thing: **make the generic rule the last arm of its own bucket, not a global
competitor.** That single change reclaims 29 of the 30 rules that cannot fire today.

---

## 3. Mandated primitives

**Use these. Do not invent a fourth table.**

- **`src/i18n/useTranslatedError.ts` — `resolveErrorTranslated(t, raw)`** (`:170`). The **only**
  sanctioned producer of user-facing error words. 65 rules, keyed to `error_registry` prefixes in
  `en.json`, CI-gated for key presence by `scripts/i18n/check-error-registry-parity.mjs`.
- **`src/i18n/useTranslatedError.ts` — `friendlySeverityTranslated(t, sev)`** (`:230`). The
  translated severity label. Its untranslated twin `friendlySeverity` (`errorRegistry.ts:716`) is
  the pre-i18n original.
- **`src/lib/types/tauriError.ts` — `isTauriError(err)` + `TauriErrorKind`** (`:20-65`). The
  narrowing guard and the 21-member discriminant. **This is what the copy table should be keyed on.**
- **`src/lib/errors/errorRegistry.ts` — `FriendlyError` / `FriendlyErrorCategory`** (`:22-48`). The
  output shape: `{ message, suggestion, category, action? }`. `category` is the actionability
  verdict — `user_action` | `recoverable` | `system` | `unclassified`.
- **`src/lib/errors/errorRegistry.ts` — `extractAuthorizeUrl(raw)`** (`:667`). The one sanctioned
  parse *out of* a message, and only because `TauriErrorResponse` does not declare `details` yet
  (see Gaps 4).
- **`src/lib/errors/errorPipeline.ts` — `classifyErrorFull(raw)`** (`:97`). The memoised three-layer
  funnel; carries the **navigation action** (`explanation.action`) that `resolveErrorTranslated`
  does not.
- **`src/features/shared/chrome/ToastContainer.tsx:55-78`.** The single renderer all 393
  `toastCatch` and 294 `reportError` surfacings converge on. Read `:77-78` before touching anything
  in this path — `matched = friendly.category !== 'unclassified'` is the line that decides whether
  the user sees the registry's sentence or the producer's.
- **`src/lib/utils/apiError.ts:105-137` — `classifyError(err, fallback)`.** The **precedent**:
  `isTauriError(err)` → `TRANSIENT_KINDS` / `PERMANENT_KINDS` by `kind`, regex ladder only as an
  explicit fallback for non-IPC values. It already does for *retry policy* exactly what §2 asks for
  *copy*. Copy this structure; do not invent one.

**Never reach for these when producing user copy:**

- `resolveError(raw)` (`errorRegistry.ts:637`) — the pre-i18n original. Hardcoded English.
- `getErrorExplanation(msg)` / `ERROR_PATTERNS` (`errorExplanation.ts:48,122`) — 19 patterns with
  English `summary` / `guidance` **and English action-button labels**. Use it only for the nav
  action, never for the sentence.
- `categoryLabel(category)` (`errorTaxonomy.ts:328`) — 11 hardcoded English labels.

---

## 4. Steps

1. **Do not stringify at the catch.** `catch (err)` — hand `err` itself onward. `extractMessage(err)`
   is for *logs*; it is not a resolution step, and calling it first is what makes every step below
   impossible (§7.A).
2. **Narrow, then select the bucket.** `if (isTauriError(err))` → the copy table is indexed by
   `err.kind`. For non-IPC values (a JS exception, a `fetch` failure, CLI stderr) fall through to the
   prose ladder and *say so in the code*, because that is the branch where all the fragility lives.
3. **Within the bucket, order most-specific-first, and put the bucket's own generic LAST.** The
   ordering rule is not "specific before generic in the file" — it is "a rule may only be preceded by
   rules that are strictly narrower than it." A generic that can be preceded by nothing narrower
   belongs at the end of its bucket.
4. **Ask whether the primitive's signature can make the wrong order unrepresentable** (see §4a).
   Answer this *before* writing §9.
5. **Give every bucket a default sentence, and make it required.** A `Record<TauriErrorKind, …>` with
   all 21 keys mandatory is a compile error to leave incomplete; a `Partial<Record<…>>` is not.
   `KIND_TO_CATEGORY` (`errorTaxonomy.ts:50`) is declared `Partial` and is missing
   `device_group_conflict` today — that is the mistake this step prevents.
6. **Author the sentence for the failure, not for the variant.** "Some input values are invalid.
   Review the highlighted fields" is the correct copy for a form submit and wrong for the 1,436
   things `AppError::Validation` actually carries. If you cannot write a sentence that is true of
   every producer in the bucket, the bucket is too coarse — that is a `typed-error-contract` finding
   (a missing variant), and you should raise it rather than write vaguer copy.
7. **Add the `_message` and `_suggestion` keys to `en.json` and translate all 14 locales**
   (`i18n-string-authoring`), then run `npm run check:i18n:strict` and
   `node scripts/i18n/check-error-registry-parity.mjs`.
8. **Prove the rule fires on the string the backend actually sends.** Not on a hand-written
   approximation of it. `AppError::Validation("x")` renders `"Validation error: x"`; a fixture of
   `"x"` proves nothing. §9 is entirely about this step.
9. **Then stop.** No local ladder, no second table, no `if (msg.includes(...))` in a component.

### 4a. Can the signature make the wrong call impossible? — answered

The contract asks this above §9, so here is the direct answer. **Yes, twice, and both are cheap.**

**(i) Make the table's shape carry the ordering invariant.** Today both tables are
`Array<{ match, … }>` — a flat ordered list where "generic last" is a convention a reviewer must
enforce by eye, and where a new rule appended at the end is *invisibly* dead if any earlier matcher
is broader. Replace with:

```ts
type CopyTable = Record<TauriErrorKind, { rules: Rule[]; fallbackKey: string }>;
```

The `Record` (not `Partial<Record>`) is exhaustive: omitting a kind is a compile error. The required
`fallbackKey` makes "this bucket has no generic" unrepresentable — so the generic never needs to be
*in* the ordered list, which is the only reason it can shadow anything. **This single change makes 29
of the 30 unreachable rules reachable, structurally**, because every one of them is shadowed by a
generic belonging to a *different* bucket than the rule (`"Validation"` claiming `ocr_file_too_large`,
`circular_chain`, `empty_bundle`, the entire build-pipeline validator block). Cross-bucket shadowing
becomes impossible by construction; only within-bucket ordering is left to review, and that is a
handful of rules per bucket rather than 65 in one list.

**(ii) Make the resolver's parameter the envelope, not a string.** `resolveErrorTranslated(t, raw:
string)` *cannot* consult the discriminant; the type forbids it. Widening to `err: unknown` (and
deriving `raw` internally) is what lets step 2 exist at all. Measured cost: **17 edit points** — 13
call sites, `toastCatch`, `reportError`, `classifyErrorFull`'s signature, and one new optional field
on `StandardToast` (`toastStore.ts:10` declares `message: string`, so the envelope is *structurally*
unable to reach the renderer today).

The remaining constraint genuinely cannot be typed away: **the discriminant is not fine-grained
enough to pick a sentence.** 21 kinds against 66 authored copy pairs, with one kind (`validation`)
covering 1,436 of 3,539 construction sites. Making copy selection total would need either ~36 more
`AppError` variants or a `code` field — a `typed-error-contract` change of real size. So: type away
the ordering (cheap, closes 29 of 30) and gate what is left (§9).

---

## 5. Anti-patterns

- **Flattening the envelope before classifying.** `extractMessage(err)` returns `obj.error` — the
  Display string — and drops `kind`, `category`, `auto_fixable`, `failover_eligible` in the same
  expression (`silentCatch.ts:38-44`). Every downstream decision is then a substring guess at
  information that was on the wire one function earlier. *Failure mode: the app re-derives, worse,
  what the backend computed exactly.*
- **Appending a new rule to the end of an ordered table.** The end of the list is where rules go to
  die. `ERROR_KEY_MAP`'s generic `'Validation'` sits at index 24 of 65; every one of the 40 rules
  after it is shadowed for any producer wrapped in `AppError::Validation`, which is 40.6% of all
  constructions. *Failure mode: the rule is added, the key is translated into 14 locales, the parity
  gate goes green, and the sentence never renders.*
- **Matching a variant name instead of its Display string.** `NetworkOffline` is the Rust identifier;
  the wire carries `"Network offline: …"`. Three rules shipped this way and were dead from the day
  they were written. *Failure mode: the rule looks right in review because it names the right thing.*
  Repaired — see §6 — but **`auth_invalid` still has it** (§7.D).
- **A rule whose literal contains an earlier rule's literal.** `'timed out'` at index 2 claims
  `'OAuth authorization timed out'` at index 6 in **both** tables. *Failure mode: undetectable by
  reading either rule; only visible by reading both.*
- **A second error→copy ladder in a feature.** `CredentialDesignHelpers.ts:262-319` is a 57-line
  registry with its own i18n keys, its own ordering, and its own generic. *Failure mode: two tables
  answer the same question and drift; the one nobody remembers wins because it runs first.*
- **Two hand-synced tables.** `ERROR_RULES` and `ERROR_KEY_MAP` each carry a comment telling the
  reader to keep them in lock-step. They agree on **content** (all 62 matchers present in both,
  categories identical 62/62) and disagree on **order** (308 pairwise inversions), which is the half
  no reviewer checks. *Failure mode: the diff looks like a faithful copy.*
- **Extraction mistaken for resolution.** `setError(extractMessage(err))` uses the sanctioned
  extractor and still shows the user `"Validation error: interval_seconds must be at least 60"`.
  *Failure mode: it passes every gate aimed at `String(err)`.*
- **A test fixture that approximates the wire.** See §9 — this is the single reason the whole defect
  class survived a green suite.
- **Inventing a sentence for an unmatched error.** A generic sentence for an unrecognised failure is
  strictly worse than the producer's own: it destroys the only diagnostic the user could paste into a
  bug report, and it makes "unrecognised" and "recognised but unhelpful" look identical.

---

## 6. Evidence

**Copy this one:** `src/lib/utils/apiError.ts:105-137`. It is the only place in the repo that
resolves anything about an error the way §2 prescribes — narrow with `isTauriError`, branch on
`kind` through two explicit `ReadonlySet<TauriErrorKind>`s, and fall through to a regex ladder *only*
for non-IPC values, with a comment saying so. It decides retry policy rather than copy, but the
structure transfers unchanged; `classifyError`'s body is the shape `resolveErrorTranslated` should
have.

- `src/i18n/useTranslatedError.ts:170-227` — the resolver. Note `:193`: the `?? raw` fallback when an
  i18n key is missing is correct and deliberate (raw beats `undefined`), and it is why
  `check-error-registry-parity.mjs` must stay green.
- `src/i18n/useTranslatedError.ts:207-220` — the chain into the English registry for keymap misses.
  A good instinct with a measured blind spot: it only runs when **no** keymap rule matched, so a rule
  shadowed by `'Validation'` can never reach it (§7.C).
- `src/features/shared/chrome/ToastContainer.tsx:77-78` — `matched = friendly.category !==
  'unclassified'` / `displayMessage = matched ? friendly.message : toast.message`. **This is the
  repo's best error-resolution decision.** It makes the unmatched case render the producer's own
  string rather than an invented one, and it is the shape the convergence oracle found independently
  in `brainiac` (§Convergence).
- `src/features/shared/chrome/ToastContainer.tsx:116` — `line-clamp-3 break-words`. The clamp exists
  *because* `:78` can render an unbounded machine string. Resolution and layout are coupled; a path
  that adds the first without the second ships a toast that grows to fill the screen.
- `src/features/triggers/lib/triggerError.ts:26-37` — `triggerErrorPresentation(kind)`, an
  exhaustive `switch` over a discriminant with a `_exhaustive: never` arm. It routes *surface*
  (that belongs to `error-surfacing-policy`), but it is the repo's only worked example of the
  exhaustiveness discipline §4a(i) asks for, and adding a kind without classifying it fails the
  build.
- `src/features/settings/sub_devices/lib/pairingRefusal.ts` — `isTauriError` → `err.kind` first,
  message markers only for refusals that have no variant yet, each with a comment saying so. The
  honest form of prose matching.
- `src-tauri/core/src/error.rs:160-230` — the `Serialize` impl. The whole contract this path depends
  on: `kind` computed at `:181-205`, `category` at `:211`.
- `src-tauri/core/src/validation/contract.rs:37-50` — `check(errors)`. **Read this before adding any
  validator rule.** It is what turns every `ValidationError::new(field, rule, message)` into
  `AppError::Validation(message)`, i.e. what prepends `"Validation error: "` to all 47 of them.
- `scripts/i18n/check-error-registry-parity.mjs` — CI-wired, self-documenting, and correct about the
  thing it checks. Its limits are §9's starting point.

---

## 7. Deviations found

**Measured at `e76646f7d`. Every count reproduced by two independent implementations (§9.0).**

### A. The discriminant is computed, shipped, and discarded one function before it could be used

This is the question the brief asked, and it measures as follows.

The backend serialises `{ error, kind, category, auto_fixable, failover_eligible }` (+ `details` for
`authorization_required`). `extractMessage(err)` (`silentCatch.ts:21-55`) reduces that object to a
string by the third `if`:

```ts
if (typeof obj.message === "string" && obj.message) return obj.message;  // absent on the envelope
if (typeof obj.error === "string" && obj.error) return obj.error;        // ← the Display string
```

There is no branch for `kind`. From that expression onward the four typed fields do not exist. The
flatten happens inside the two doors, so it is **two functions, not 687 call sites**:

| Door | Flattens at | Call sites |
|---|---|---|
| `toastCatch(ctx)` | `silentCatch.ts:104` (`extractMessage`) then `:109` (`classifyErrorFull(msg)`) | **393** across 198 files |
| `reportError(...)` | `storeTypes.ts` (`errMsg`) → `storeBus.emit('toast', { message })` | **294** |

Downstream measurements of the consequence:

| Fact | Measured |
|---|---|
| `classifyUnknownErrorFull(err)` — the only envelope-aware pipeline entry point | **0 callers.** The only three occurrences in the repo are its own definition and two golden-path docs describing it. |
| Files that mention `isTauriError` at all | **10** of 4,829 |
| `Toast.message` type | `string` (`toastStore.ts:10`) — the renderer *cannot* receive an envelope |
| `resolveErrorTranslated`'s first data parameter | `raw: string | null | undefined` — the resolver *cannot* consult a discriminant |

**What resolving on the discriminant would actually buy, measured — and what it would not.** The
honest answer has two halves, and the optimistic half is the smaller one.

*It fixes classification completely.* 12 of the 21 variants have **no rule in either table keyed on
their Display prefix** — `Database error:`, `IO error:`, `Execution error:`, `Authentication error:`,
`Cloud error:`, `GitLab error:`, `Process spawn error:`, `Serialization error:`, `Connection pool
error:`, `Device group conflict:`, and the two empty-prefix passthroughs `Internal` / `External`.
Every construction of those variants resolves to the generic fallback today. Keyed on `kind` instead,
all 21 are total by construction, and `auth`/`forbidden`/`network_offline`/`rate_limited` stop
depending on whether someone remembered to also write the Display-string alternative into a regex.

*It does not fix specificity.* `kind` has 21 values; the product has authored **66** distinct copy
pairs, and one kind — `validation` — covers **1,436 of 3,539** constructions (40.6%). Keying copy on
`kind` alone would *reduce* specificity: the 22 hand-written build-pipeline sentences would all
collapse into one `validation` sentence, which is exactly what already happens (§7.C) and exactly
what the authors were trying to escape. **So `kind` is the right index for the bucket and the wrong
index for the sentence.** The prescription in §2 and the type change in §4a(i) reflect that: kind
selects the bucket; an ordered, narrower-only sub-table selects the sentence within it; the bucket's
required default catches the rest.

*Cost.* 17 edit points (§4a(ii)). No new dependency, no migration of the 1,436 Rust sites, and it
composes with `typed-error-contract` Gap 1 (`classifyErrorFull(err: unknown)`), which is the same
signature change from the other side.

### B. Registry coverage, weighted by what the backend really constructs

Two denominators are defensible and they give different answers. Both are reported because the
sibling paths cite the first and the second is the more honest one.

| Denominator | Total | Unmatched → fallback | Share |
|---|---:|---:|---:|
| **`AppError::X` textual references** (incl. bare match arms; the denominator `error-surfacing-policy.md:256` uses) | 4,230 | **2,383** | **56.3%** |
| **`AppError::X(..)` constructions** (an error actually being produced) | 3,531 | **1,669** | **47.3%** |

The first row **reproduces the sibling path's headline exactly** — it published 2,378 / 56.3% against
1,845 resolving, and I measure 2,383 / 56.3% against 1,847 at a later commit. Confirmed, independently,
by a different extractor.

The second row is the one to quote going forward, and the gap between them is worth naming: the
reference count is inflated by match arms in classification code. `AppError::Database` has **706**
textual references and **134** constructions — a 5.3× spread, because `error.rs`, `tool_outcome.rs`
and the healing engine all `match` on it. A match arm is not an error being shown to anyone.

**Of the resolving half, the generic validation rule takes three quarters:**

| | English path (`ERROR_RULES`) | Translated path (`ERROR_KEY_MAP`) |
|---|---:|---:|
| constructions matched | 1,862 | 1,862 |
| …claimed by the single generic `Validation` rule | **1,386 (74.4%)** | **1,424 (76.5%)** |
| `AppError::Validation` sites landing on generic copy | 1,386 of 1,436 (96.5%) | **1,424 of 1,436 (99.2%)** |

So the sibling's framing holds and sharpens: **the largest class of user-facing error copy in this
app is one sentence** — *"Some input values are invalid. / Review the highlighted fields and correct
any errors."* — rendered for `Validation error: Cannot read image header`, `Validation error: File is
too large for OCR (25 MB)`, `Validation error: Circular chain detected: A → B → A`, and 1,421 others.
There are no highlighted fields.

> **Correction to the routing brief and to `error-surfacing-policy.md:163`.** Both say "15 of 25 wire
> variants match no registry rule." **`AppError` has 21 variants** (`error.rs:12-96`), yielding 20
> distinct non-empty Display prefixes plus one empty prefix shared by `Internal` and `External`. The
> figure 25 is not reproducible from `error.rs` by any counting I could construct. The correct
> statement is **12 of 21 (57%)**. The conclusion is unchanged and slightly stronger by share.

### C. 30 of 65 rules in the table that actually renders can never fire

This is the finding no earlier pass had. `ToastContainer` resolves through
`resolveErrorTranslated` (`:65`), so `ERROR_KEY_MAP` — not `ERROR_RULES` — is the table users see.

Method: build the full producer corpus (3,531 renderable `AppError::X(..)` wire strings + 47
`ValidationError::new` messages wrapped as `"Validation error: …"` by `contract::check`), run the
**shipped** resolvers over it, and mark a rule dead when ≥1 producer's string matches it in isolation
and 0 producers reach it through the ordered table.

| Table | Rules | Shadowed by an earlier rule | Unreachable by literal containment | **Total unreachable** |
|---|---:|---:|---:|---:|
| `ERROR_KEY_MAP` (renders) | 65 | 29 | 1 | **30 (46%)** |
| `ERROR_RULES` (English original) | 62 | 9 | 1 | **10 (16%)** |

The 29 shadowed keymap rules, with their real producers:

| # | keyPrefix | producers | claimed first by |
|---:|---|---:|---|
| 25 | `body_too_large` | 1 (`api_proxy.rs:821`) | `Validation` |
| 26 | `ocr_file_too_large` | 2 (`ocr/mod.rs:196,486`) | `Validation` |
| 28 | `circular_chain` | 2 (`db/chain.rs:913,976`) | `Validation` |
| 30 | `connection_limit` | 2 (`p2p/connection.rs:232,332`) | `Validation` |
| 33 | `inactive` | 1 (`tools/automations.rs:165`) | `Validation` |
| 34 | `no_webhook` | 1 (`automation_runner.rs:32`) | `Validation` |
| 35 | `no_credential` | 1 (`automation_runner.rs:693`) | `Validation` |
| 36 | `empty_bundle` | 1 (`network/bundle.rs:83`) | `Validation` |
| 37 | `invalid_bundle` | 1 (`data_portability.rs:4975`) | `Validation` |
| 38–44 | `interval_too_fast`, `interval_not_number`, `webhook_missing_secret`, `smee_url_invalid`, `schedule_missing_timing`, `invalid_trigger_type`, `polling_url_blocked` | 10 (`validation/trigger.rs`) | `Validation` |
| 45 | `build_no_agent_ir` | 2 (`build_sessions.rs:2677`, `:780`) | `Validation` |
| 46 | `agent_ir_parse` | 5 (`build_sessions.rs`) | `Validation` |
| 47 | `design_result_parse` | 2 (`build_sessions.rs:762`) | `Validation` |
| 49 | `build_session_gone` | 1 (`build_sessions.rs:2656`) | `/NotFound\|Not found:/` |
| 50 | `build_nothing_to_promote` | 1 (`build_simulate.rs:229`) | `Validation` |
| 51 | `name_invalid` | **31** | `Validation` |
| 52–58 | `system_prompt_empty`, `prompt_too_large`, `max_turns_range`, `max_concurrent_range`, `timeout_range`, `budget_value_invalid`, `importance_range` | 10 (`validation/persona.rs`, `validation/memory.rs`) | `Validation` |

Plus, in **both** tables:

| # | rule | why |
|---:|---|---|
| 6 | `oauth_timeout` — `'OAuth authorization timed out'` | rule 2 is `'timed out'`, a strict substring. Unreachable for every possible input, independent of any producer. |

**The mechanism is a single positional difference between two tables that are otherwise identical.**
The generic `'Validation'` matcher sits at **index 44 of 62** in `ERROR_RULES` and at **index 24 of
65** in `ERROR_KEY_MAP`. The 2026-05 pass that added the build-pipeline validators *inserted* them
before the generic in `errorRegistry.ts` and *appended* them after it in `useTranslatedError.ts`. Both
diffs read as faithful copies. Neither reviewer had a reason to check position.

**Consequence, measured.** The two paths disagree on **61 of 3,578 producers (1.7%)**, and every
disagreement runs the same direction — the English table finds the specific sentence, the rendering
table falls to the generic:

```
Validation error: interval_seconds must be at least 60
  resolveError()           → "Polling can't run more than once per minute."
  resolveErrorTranslated() → "Some input values are invalid."      ← what the user sees
```

**15 distinct hand-authored sentences are unreachable in every locale, English included:**

> "Polling can't run more than once per minute." · "The polling interval isn't a valid number." ·
> "This webhook trigger is missing its signing secret." · "The webhook source URL needs to come from
> smee.io." · "Scheduled triggers need either a cron expression or a polling interval." · "The build
> picked a trigger type the runtime doesn't recognise." · "The polling URL was rejected for safety." ·
> "The persona name needs work." · "The persona's system prompt is empty." · "The agent's prompt is
> too long." · "The turn limit is outside the allowed range." · "The concurrency limit is out of
> range." · "The timeout is outside the allowed range." · "The budget value isn't valid." · "Memory
> importance is out of range."

**i18n cost of the dead half** (boundary note for `i18n-string-authoring`): 30 unreachable rules ×
2 keys × 14 locales = **840 translated strings that can never render**, all of them currently passing
`check:i18n:strict` and `check-error-registry-parity`. Both gates are correct about what they check;
neither can see that the rule is dead.

### D. A rule matching a token that does not exist, and the token that does

The brief asked me to look for the "dead on arrival" shape elsewhere after the
`NetworkOffline`/`NotFound`/`RateLimited` repair. **The repair is confirmed** — all three now carry
the Display alternative in both tables (`/NetworkOffline|Network offline:/` etc.) and now claim 10,
287 and 13 construction sites respectively. **And there is one more, of the same species:**

- **`'Auth token missing or invalid'`** (`errorRegistry.ts:103`, `useTranslatedError.ts:74`). This
  literal appears **nowhere in the repo** outside the two registries and one test fixture. I searched
  290,146 string literals across 5,500 git-tracked source files; zero producers in Rust, zero in TS.
- **The string that *is* produced** is `"IPC authentication failed: invalid session token"`
  (`src-tauri/src/ipc_auth.rs:650`), which `tauriInvoke.ts:546` already special-cases by substring.
  It matches **no rule in either table** and resolves to `"Something went wrong."`

So the app has authored copy for an auth failure it never emits, and no copy for the auth failure it
does. Two other rules look like orphans to a static scan and are **cleared** on inspection:
`interval_seconds must be at least \d+` and `Build session [\w-]+ disappeared while waiting` are
`format!` templates whose placeholders resolve at runtime (`trigger.rs:100`,
`build_sessions.rs:2657`) — they are dead for the reason in §7.C, not this one.

**Also cleared:** I suspected orphan `error_registry` keys (copy with no rule to reach it). There are
none — 66 `_message`/`_suggestion` prefixes against 65 rules + the generic, exactly balanced. The one
apparent extra is `_comment_adoption_answers_rejected_message`, a translator-note key, not a rule.

### E. The fallback is not distinguishable from a matched generic — for the user

| | matched generic | unmatched |
|---|---|---|
| `category` | `user_action` (from the `Validation` rule) | `unclassified` |
| `ToastContainer` `matched` flag | `true` | `false` |
| what renders | *"Some input values are invalid."* + suggestion | the producer's own string, clamped to 3 lines |

In **code** the two are cleanly distinguishable, and `ToastContainer.tsx:77` uses that distinction
correctly. In the **product** they are not: a user who sees "Some input values are invalid" for a DNS
failure has no way to know the app classified it, and — worse — has lost the diagnostic string
entirely, whereas the *unmatched* user still has something to paste into a bug report. **The matched
generic is the strictly worse of the two outcomes**, and it is the one that fires 1,424 times.

Sentry sees both: `recordResolveBreadcrumb(raw, keyPrefix ?? '_unmatched')`
(`useTranslatedError.ts:191,225`) tags them differently. So the data to fix this exists in telemetry
and nothing consumes it.

### F. A second registry inside a feature

`src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts:262-319` —
`translateHealthcheckMessage(raw, t, tx)`. 57 lines, its own ordered ladder over `raw.includes(...)`,
its own HTTP-status switch, its own i18n keys under `t.vault.design_helpers.hc_*`, and its own
generic. It answers exactly the question this path owns, correctly and independently, for one
feature.

It is not the only one, but it is the largest. The full set of local error→copy ladders (AST-measured,
excluding test harnesses): **7 matches across 5 files** — `CredentialDesignHelpers.ts:267`,
`ErrorPhase.tsx:20,30,35`, `TestReportModal.tsx:633,634`, `useUrlImport.ts:86`,
`useBrainConnection.ts:92`.

`errorExplanation.ts`'s `ERROR_PATTERNS` (19 rules) is the sanctioned third table, and it is
*entirely English* — `summary`, `guidance`, and the action-button labels ("Go to Vault", "Edit
Triggers", "Persona Settings") which render at `ToastContainer.tsx:136` in all 14 locales. It is
mandated in §3 for the nav action only, and that restriction is the whole reason.

### G. 123 user-facing error surfaces render an unresolved machine string

Measured on the **non-toast** surfaces this path also owns — inline banners, panels, cards:
`set*Error(...)` receiving a raw-error expression, **123 matches across 87 files** (§9 rule).
Distribution: 99 `x instanceof Error ? x.message : …`, 21 `extractMessage(…)` / `errMsg(…)`, 3
`String(err)`.

The 21 helper-adopted sites are the important ones. They have already done what
`typed-error-contract` §9.1 asks (use the sanctioned extractor) and the user still reads
`"Validation error: interval_seconds must be at least 60"`. **Fixing extraction does not fix
resolution**; that is the seam between the two paths, and it is why this is a separate signal rather
than a duplicate.

The compliant shape exists in three files — store the raw string in state, resolve at render
(`AthenaFleetPlanCard.tsx:116` → `:169`, `AthenaShipMilestoneCard.tsx:101` → `:177`,
`KPIConnectWizard.tsx:137`). They are the §9 allowlist and the pattern to copy.

### H. Adoption of the sanctioned resolver

`resolveErrorTranslated` is called from **13 files**. `ToastContainer` is one of them and covers the
transient surface app-wide; the other 12 cover a handful of panels. Against **87 files** setting
unresolved error state and **475** `addToast(` sites, that is the adoption gap this path exists to
close.

---

## 8. Gaps in the primitive

1. **The resolver's signature forbids the correct implementation.** `resolveErrorTranslated(t, raw:
   string)` cannot narrow to `isTauriError` because the envelope never arrives. Everything in §7.A is
   downstream of this one parameter type. Fix: `err: unknown`, derive `raw` internally. Blocked on
   nothing; 17 edit points.
2. **`Toast.message: string`.** Even with (1) fixed, the transient surface — the largest consumer —
   would still resolve from a string, because the store's shape drops the envelope at `addToast`.
   Needs an optional `envelope?: TauriErrorResponse` on `StandardToast`.
3. **A flat ordered array cannot express "this rule is narrower than that one."** Ordering is the
   invariant and the type carries none of it. §4a(i) is the fix; until it lands, ordering is a
   review-by-eye obligation that has already failed twice in this file.
4. **`TauriErrorResponse` has no `details` field**, so `authorization_required`'s structured payload
   is invisible and `extractAuthorizeUrl` has to re-parse the consent URL out of the message
   (`errorRegistry.ts:667`) — the exact thing `details` was added to avoid. (Also
   `typed-error-contract` Gap 4; recorded here because the re-parse lives in *this* path's primitive.)
5. **21 kinds cannot address 66 sentences.** The discriminant is too coarse to be the copy key on its
   own (§7.A). Closing this needs new `AppError` variants or a `code` field — a
   `typed-error-contract` change. Until then a within-bucket prose ladder is unavoidable, and this
   path's job is to keep it *small and bucketed* rather than global and ordered by hand.
6. **`classifyCache` is keyed on the raw string** (`errorPipeline.ts:74`), so folding translation into
   the pipeline requires `${locale}::${raw}` or a clear-on-locale-change. ~10 lines, but it must land
   in the same commit or a language switch renders stale copy.
7. **Nothing measures registry effectiveness in production.** The breadcrumbs distinguish
   `_unmatched` from a `keyPrefix` (`useTranslatedError.ts:191,225`) and nothing aggregates them, so
   "which shapes are we missing" and "which rules never fire in the field" are both answerable from
   data the app already emits and answered by nobody.
8. **`friendly.category` has no consumer.** Four values, computed on every resolution, and the only
   read anywhere is `ToastContainer.tsx:77`'s `!== 'unclassified'` — a boolean's worth of a four-way
   verdict. (`error-surfacing-policy` owns turning it into a surfacing decision.)

---

## 9. The missing gate

### 9.0 First: how these numbers were produced (the contract's two-implementation rule)

Every figure in §7 was produced twice, by deliberately different methods, and the two agree:

- **Implementation 1** — TypeScript **compiler AST** walk over `errorRegistry.ts`,
  `useTranslatedError.ts` and `errorExplanation.ts` to extract the rule arrays as data, plus a
  hand-written comment/string-aware Rust scanner that captures `AppError::X(..)` arguments with
  balanced-delimiter matching, then a re-implementation of the matcher semantics.
- **Implementation 2** — `ts.transpileModule` + `vm` to **execute the shipped `resolveError` and
  `resolveErrorTranslated`** against the same corpus, with a `Proxy` `t` that returns
  `@@<keyPrefix>_message@@` sentinels so the winning rule is observable.

Result: **3,531 / 3,531 agreement** on the English path, 0 disagreements. This matters because
implementation 1 could have got a regex flag or the `String.includes` vs `RegExp.test` split wrong,
and implementation 2 cannot — it *is* the production code.

The §9 signal below was likewise measured twice (regex through the real census engine vs. a
TypeScript AST extractor). They disagreed by 5 matches in 4 files; **the regex was right and the AST
was under-counting** — it missed member-call forms (`stream.setError(`, `flow.setError(`,
`store.setSendError(`) and one `a || b` argument. Recorded because the contract's warning is usually
told the other way round.

### 9.1 What would have caught this — and why nothing did

**The gate that was missing is a test whose corpus comes from the producer, not from the author's
memory of the producer.**

`src/i18n/__tests__/useTranslatedError.test.ts:52-59` is titled *"translates a previously
English-only build-pipeline validator"*:

```ts
const res = resolveErrorTranslated(t, 'interval_seconds must be at least 60');
expect(res.message).toBe('Polling is too frequent.');   // ✅ passes
```

It passes. The wire string is `"Validation error: interval_seconds must be at least 60"` — because
`ValidationError::new` messages go through `contract::check` (`contract.rs:42`) into
`AppError::Validation`, whose `#[error("Validation error: {0}")]` template always prepends the
prefix. With the real string, the same call returns the generic validation copy. **The test proves
the feature works on a string the backend has never sent.**

`errorRegistry.test.ts:22-35` has the same defect at scale: its 12-case table uses `'NetworkOffline'`
(wire: `"Network offline: …"`), `'NotFound: persona 123'` (wire: `"Not found: …"`), `'Validation: name
too short'` (wire: `"Validation error: …"`), `'Circular chain detected between A and B'` (wire:
`"Validation error: Circular chain detected: …"`). Two of those four now resolve differently against
the real string. The file's own header says it pins "their ORDER (most-specific-first)" — and it
cannot, because none of its inputs carry the prefix that makes ordering matter.

The three shipped gates all pass and all check something else:

| Gate | Checks | Blind to |
|---|---|---|
| `check-error-registry-parity.mjs` (CI) | every `keyPrefix` has `_message` + `_suggestion` in `en.json` | whether the rule can fire |
| `check:i18n:strict` (pre-commit) | all 14 locales have every key | ditto — it faithfully translated 840 strings that can never render |
| `errorRegistry.test.ts` / `useTranslatedError.test.ts` | resolution over hand-written fixtures | the fixtures are not the wire |

### 9.2 Gate 1 (primary) — `scripts/check-error-resolution.mjs`: the reachability test

**Not a census rule. Deliberately.** The census engine matches one regex against whole file content
and counts occurrences; it has no way to express "rule B is preceded by rule A whose matcher is
broader," because that is a relation between two matches, and expressing it would need either
variable-length lookbehind (banned — one such rule cost 73 seconds) or a second pass the engine does
not have. **Refusing to census-gate this is the finding**, and the correct mechanism is the one
already prototyped above:

Wire into `npm run check` next to `check:error-registry`. Four assertions, each with a precondition
self-check that fails the script when its parser stops finding things.

- **(a) Build the producer corpus from Rust, not from fixtures.** Parse `#[error("…")]` templates out
  of `src-tauri/core/src/error.rs`; scan git-tracked `.rs` for `AppError::X(literal|format!)` and for
  `ValidationError::new(_, _, literal|format!)`; render each into its wire string.
  **Self-check:** ≥ 3,000 wire strings and ≥ 18 variant templates, or exit 1 with *"the parser found
  N — the Rust shape changed; fix the parser, do not lower the floor."*
- **(b) Every rule must be reachable.** Execute both tables over the corpus. For each rule, if ≥1
  corpus string matches it in isolation and 0 reach it in order, **fail and name the rule that
  claimed it.** Today: 29 failures in `ERROR_KEY_MAP`, 9 in `ERROR_RULES`.
  **Self-check:** the corpus must claim ≥ 30 distinct rules, or the executor is broken.
- **(c) No rule may be shadowed by containment.** For every pair (i < j) of string matchers, fail if
  `rules[j].match.includes(rules[i].match)`. Pure text, no corpus needed, catches `oauth_timeout`
  today and every future one for free. This is the assertion `errorRegistry.test.ts`'s header claims
  to make.
- **(d) The two tables must agree on content *and order*.** Assert the matcher lists are equal as
  sequences after removing keymap-only entries, **and** that the relative order of every shared
  matcher is identical. Today: 3 extra + 308 inversions. If the tables are merged (see below) this
  assertion deletes itself, which is the right outcome.

**Allowlist:** none. A shadowed rule is never intentional; if a rule is genuinely obsolete, delete it.

**How it fails loudly if its own precondition vanishes:** the (a) self-check is the whole answer —
this gate's failure mode is "the Rust extractor stopped matching and every rule looks reachable
because the corpus is empty." A corpus floor of 3,000 sits just under the measured 3,578 rather than
4× below it (the mistake `tauri-command-error-envelope.test.ts:132` makes with `>= 400` against 1,673).

**Prefer the type over this gate where possible.** §4a(i)'s `Record<TauriErrorKind, {rules,
fallbackKey}>` makes assertion (b)'s cross-bucket cases unrepresentable — 29 of 30 — and (d)
unnecessary if the two tables become one. Ship the type change as the fix; keep (b) and (c) as the
ratchet that holds within-bucket ordering, which no type can enforce.

### 9.3 Gate 2 (census) — `unresolved-error-as-inline-copy`

**Checked against the existing registry first, as instructed.** Three adjacent rules exist and none
covers this condition: `raw-error-as-toast-message` (toasts.md) anchors on `addToast(`;
`discarded-toast-copy` (i18n-string-authoring.md) anchors on English literals passed to toast
helpers; `unsolicited-failure-as-toast` (error-surfacing-policy.md) anchors on `useEffect` → toast.
**All three are toast-anchored.** This one anchors on `set*Error(` — the inline surfaces (banners,
panels, cards) that 87 files use and no rule looks at. Zero anchor overlap by construction.

It deliberately *includes* the `extractMessage` / `errMsg` forms, which is what keeps it
non-redundant with `typed-error-contract` §9.1's proposed `no-stringly-error-extraction`: 21 of the
123 matches have already adopted the sanctioned extractor and still hand the user a machine sentence.
Their remedy leaves this defect intact.

**Signal.** A user-facing error state setter whose first argument *begins* with a raw-error
expression. **Precision audited on a systematic 15-site sample (every 6th file): 15/15 genuine** —
each sets a `string | null` state that is rendered directly (`{error}`, `<InlineErrorBanner
message={loadError}/>`) or returned from a hook to a consumer that does. The only non-genuine shape
found across all 90 raw-matching files is "store raw, resolve at render", which is *correct* and is
excluded by name (3 files, 3 matches). Multiline is handled: the argument routinely wraps to the next
line, and the engine matches whole file content. Runtime 0.8s over 4,826 files; forward-anchored, no
lookbehind.

```json
{
  "id": "unresolved-error-as-inline-copy",
  "goldenPath": "docs/concepts/golden-paths/error-message-resolution.md",
  "title": "A machine-authored error string pushed into user-facing state with no resolution step",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bset[A-Za-z0-9_$]*(?:Error|Err|Failure)[A-Za-z0-9_$]*\\(\\s*(?:extractMessage\\(|errMsg\\(|String\\(\\s*(?:e|err|error|ex)\\s*\\)|(?:e|err|error|ex)\\s+instanceof\\s+Error\\s*\\?|(?:e|err|error|ex)\\.message\\b)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "the FIRST argument of a user-facing error-state setter BEGINS with a raw-error expression - extractMessage(err), errMsg(err, ..), String(err), an `err instanceof Error ?` ternary, or err.message - so the sentence the user reads is whatever the producer emitted, with no resolution step in between. PROXY FOR the stack-free condition: a surface that shows the user a failure renders the machine's sentence rather than the product's, which is simultaneously an untranslated string in a 14-locale app, an unbounded string in a bounded layout, and a lost opportunity to say what the user should do. ANCHORED ON THE DESTINATION, NOT THE EXTRACTION SHAPE, and that is what makes it non-redundant with typed-error-contract.md's proposed custom/no-stringly-error-extraction rule: 21 of these 123 matches have ALREADY adopted the sanctioned extractor (extractMessage/errMsg) and still hand the user 'Validation error: interval_seconds must be at least 60' (shape split of the 123: 99 `instanceof Error` ternaries, 21 helper calls, 3 String(err)). Fixing extraction does not fix resolution. It is also disjoint from all three existing toast rules (raw-error-as-toast-message, discarded-toast-copy, unsolicited-failure-as-toast), every one of which anchors on addToast(/toastCatch(; this one anchors on set*Error( and covers the INLINE surfaces - banners, panels, cards - which 87 files use and no existing rule inspects. BOTH COUNTS PRODUCED TWICE as the contract requires: this regex through the real census engine reports 126 matches / 90 files raw, and an independent TypeScript-AST extractor (CallExpression whose callee matches the setter shape and whose first argument is a raw-error node) reports 121 / 86; the 5-match gap was audited and the REGEX is the correct one - the AST missed member-call forms (stream.setError, flow.setError, store.setSendError at useDesignAnalysis.ts:239,260, useCredentialDesign.ts:128, athenaChatSend.ts:128) and one `extractMessage(err) || fallback` argument. PRECISION audited on a systematic every-6th-file sample of 15 sites: 15/15 genuine, each setting a `string | null` state rendered directly into UI or returned from a hook to a consumer that renders it. The 3 excluded files below are the ONLY non-genuine shape found across all 90 raw-matching files. WHY THIS MATTERS NOW: ToastContainer.tsx:77-78 was changed on 2026-08-14 to prefer the caller's string when the classification is 'unclassified', and 1,669 of 3,531 AppError constructions (47.3%) classify as unclassified, so unresolved strings now reach users verbatim on the transient surface too. Measured against a corpus of 3,531 real AppError Display strings plus 47 ValidationError::new messages, both parsed from the Rust source: the shipped resolvers return the generic fallback for 47.3% and the single generic 'Validation' sentence for a further 40%. PRECONDITION (measured, must be re-derived per repo): this repo spells user-facing error state as a `const [x, setXError] = useState<string|null>` hook and spells raw extraction as extractMessage/errMsg/`instanceof Error` ternaries. A repo that stores an error OBJECT in state and resolves at render - which is the COMPLIANT shape here, see the excludes - scores zero while being correct; a repo using a query library's `error` field or a router errorElement has the same condition wearing different syntax and also scores zero. brainiac has neither shape: its console throws a typed ApiError and every describe() switches on e.status, so it scores zero for the right reason. LEGAL FIX, in order: (1) store the rejection VALUE (or the raw string) in state and call resolveErrorTranslated(t, raw) at the render site - AthenaFleetPlanCard.tsx:116 -> :169 is the reference implementation and is why it is excluded below; (2) where the surface is not a component, resolve through getActiveTranslations() before setting state; (3) where the error genuinely has no authored copy, render it verbatim ON PURPOSE by checking `category === 'unclassified'` first, so 'we did not recognise this' is a decision rather than an accident."
  },
  "exclude": [
    {
      "path": "src/features/plugins/companion/fleet/AthenaFleetPlanCard.tsx",
      "reason": "the COMPLIANT shape and this path's reference implementation - :116 stores the raw string in state and :169 renders resolveErrorTranslated(t, error).message, which is resolution at the edge rather than no resolution at all"
    },
    {
      "path": "src/features/plugins/companion/ship/AthenaShipMilestoneCard.tsx",
      "reason": "same compliant shape - :101 stores the raw string, :177 renders resolveErrorTranslated(t, error).message at the edge"
    },
    {
      "path": "src/features/teams/sub_kpis/KPIConnectWizard.tsx",
      "reason": "compliant - :137 is `extractMessage(err) || resolveErrorTranslated(t, null).message`, i.e. the resolver supplies the fallback sentence when the producer had nothing to say; the file imports resolveErrorTranslated for exactly this"
    }
  ],
  "baseline": { "files": 87, "matches": 123 },
  "floor": 4000
}
```

### 9.4 The positive control

The same setter anchor pointed at the **compliant** argument shapes. If the violation pattern were
keying on "is this an error setter" rather than on the argument, the two would score alike. They do
not: **123 vs 13, a 9.5× separation.** The control fails against the violation rule's baseline, as it
must, and it carries no baseline of its own.

```json
{
  "id": "unresolved-error-as-inline-copy-positive-control",
  "goldenPath": "docs/concepts/golden-paths/error-message-resolution.md",
  "title": "POSITIVE CONTROL - the same setter anchor pointed at RESOLVED copy, which must not be counted",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bset[A-Za-z0-9_$]*(?:Error|Err|Failure)[A-Za-z0-9_$]*\\(\\s*(?:resolveErrorTranslated\\(|resolveError\\(|tx\\(\\s*t\\.|t\\.[a-z_]+\\.[a-z_]+)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. Identical setter anchor to unresolved-error-as-inline-copy, with only the ARGUMENT inverted to the compliant forms - resolveErrorTranslated(t, raw), a tx(t.section.key, {..}) interpolation, or a bare t.section.key. It exists to prove the violation pattern discriminates on what is being handed to the setter and not merely on 'this identifier looks like an error setter'. Measured 2026-08-14: 13 matches across 10 files, against the violation rule's 123 across 87 - a 9.5x separation. It therefore FAILS against that rule's baseline, which is the point. Deliberately carries NO baseline: a control counts COMPLIANT code, so ratcheting it would fail the build every time adoption improved. One match is itself a finding rather than clean code - useDryRun.ts:41 uses the UNTRANSLATED resolveError, which renders English in all 14 locales; that defect belongs to typed-error-contract.md's no-restricted-imports proposal, not here, and it is left in the control to keep the control honest about what it measures."
  },
  "floor": 4000
}
```

### 9.5 What cannot be gated

No machine can decide whether *"Some input values are invalid"* is the right sentence for
`Validation error: Cannot read image header`. That is judgment, and it is where the largest share of
this path's real damage sits — 1,424 renderings of one sentence. The nearest mechanical proxy is a
ratchet on concentration: assert that no single rule's share of resolved constructions rises above
its current 76.5%. That is a ratchet, not a gate, and it should be labelled as one; the real fix is
new `AppError` variants, which belongs to `typed-error-contract`.

---

## Convergence check

Three sibling codebases were read for independent reinvention. **The result contradicts part of what
I would otherwise have written, and the contradiction is the most useful thing in this section.**

### Confirmed as physics — resolve on a discriminant, never on prose

`brainiac`'s Next.js console maps errors to friendly copy in five `describe(e)` functions
(`app/console/modules/{reviews,standards,skills,disputes}/actions.ts`, `docs/[slug]/actions.ts`).
**Substring rules over error prose: 0. Discriminant branches: 11.** A repo with no shared document
and no shared author reached §2's prescription on its own. That is the strongest evidence available
that the prescription is not local taste.

`personas-web` has the same shape at one site (`CustomFeatureRequest.tsx:45`: two `res.status`
branches plus a fallback) and nowhere else.

### Confirmed as physics — render the producer's sentence when nothing matched

`brainiac`'s unmatched branch is `` `API error ${e.status}: ${e.message}` `` — the backend's own
sentence, tagged. The matched branches are hand-written with no prefix. **So a matched generic and an
unmatched fallback are distinguishable to the user by the presence of the prefix**, which is exactly
what §7.E finds this repo lacks. `brainiac` contains no "Something went wrong" string at all. Its
`ApiOffline.tsx:30` even renders the raw error dimly beside a fixed operator-facing headline rather
than hiding it.

`ToastContainer.tsx:77-78`'s `matched` flag is the same instinct, reinvented here five days ago. The
piece this repo is missing is the *marker* — `brainiac` makes "we did not recognise this" visible;
Personas makes it silent.

### Confirmed as physics — and it inverts the defect, not the fix

**`brainiac` emits a machine discriminant and its own client throws it away.** `http.rs:1885-1902`
serialises `{ error, code }` on every REST error, pins it in a test, and publishes it in
`openapi.json` — and `console/src/lib/api.ts:114-131` parses `parsed.error` and **discards `code`**.
`personas-web/src/lib/api.ts:120` is worse: `await res.text()` on the unparsed body, so the cloud's
`{"error":"Persona not found"}` reaches the UI as the literal string `API 404: {"error":"Persona not
found"}`, braces and all, and `DashboardErrorBanner.tsx:31` renders it in production.

So the exact defect §7.A describes — *a discriminant computed at the source and dropped by the client
one function before render* — has been **independently reinvented in three codebases**. That is not a
Personas mistake; it is what happens by default when the client's error type is `string`. It is also
the strongest argument for §4a(ii): the only structural difference between the repos that keep the
discriminant and the ones that lose it is whether the type on the receiving side can hold it.

`personas-web/src/app/api/roadmap/route.ts:19` is the one place in either web repo that reads a
discriminant (`error.code` from Supabase). It logs it and drops it.

### Confirmed — the user/operator split as a type, and the direction of its default

I re-verified this myself rather than trusting the brief or the earlier correction. **The brief is
right.** `brainiac`'s `ToolError` (`crates/brainiac-server/src/mcp.rs:85-95`) has three arms —
`InvalidParams` and `Rejected` (user-visible) and `Internal(anyhow::Error)` (operator). **Both
blanket `From` impls land on `Internal`** (`mcp.rs:97-107`), so a bare `?` on any DB or `anyhow`
error auto-converts to the operator arm; the user-visible arms are reachable only through explicit
`invalid()` / `rejected()` constructors. The operator arm renders a *fixed generic* — *"brainiac hit
an internal error handling this call; it has been logged"* (`mcp.rs:747-764`) — never the raw string,
never nothing.

The REST half achieves the same posture by a different mechanism worth recording: `HttpError`
(`http.rs:1909`) has **no** `From<sqlx::Error>` or `From<anyhow::Error>` at all, so `?` on a raw error
*does not compile*; every handler must call `internal(e)` (`http.rs:1950`) explicitly, and there are
**294** such call sites. Refusing to provide the conversion is a stronger guarantee than defaulting
it.

**Personas has no equivalent.** `sanitize_error_message` (`error.rs:144`) strips absolute paths from
three variants and nothing else — not table names, not hostnames, not SQL. So
`"Database error: UNIQUE constraint failed: personas.name"` is a user-facing string here and would be
`"internal error"` in `brainiac`. Naming that is `typed-error-contract`'s job (it is a variant/wire
decision); this path's stake is narrower and follows from §7.E: **an unmatched error should render
the producer's sentence, and that prescription is only safe if the producer's sentence is safe to
show.** Two of the three siblings enforce that at the type level. Personas enforces it nowhere. The
honest form of §2's last clause in this repo is therefore *"render the producer's own message"* **and
a `typed-error-contract` deviation for every variant where that is not safe.**

### Contradicts me — i18n on error copy is a house convention, not doctrine

**Not one of the three siblings translates error copy.** `brainiac` has no i18n machinery in either
half — no `next-intl`, no `rust-i18n`, no `Accept-Language`, all error strings inline English.
`personas-cloud` has none. `personas-web` has 15 locales that cover the error *chrome*
(`errorPage.*`, `dashboard.errorBoundary.*`, `errorGeneric`) and never the dynamic string — and
several of its error keys are still English in all 14 non-EN locales (`*.ts:399`, `:526`, `:554`).

So the requirement that every resolved sentence be translated — the thing that makes this repo run
two tables and 140 `error_registry` keys in each of 14 locales — **has no trace anywhere else and should be marked a
house convention rather than doctrine.** It is a correct convention for a 14-locale desktop product;
it is not physics, and a sibling adopting this path in a single-locale app should drop the whole
translated-table half and keep §2, §4a and §9.

And the earned lesson applies squarely here: **convergence measures discoverability, not whether a
requirement is real.** The i18n requirement is genuinely real for this product and genuinely absent
everywhere else; the discriminant-discarding defect is genuinely everywhere and genuinely a defect.
Convergence separated those two correctly, and it would have been wrong to read either result as a
verdict on necessity.

### Contradicts me — duplication of the copy table is the norm, not the exception

I wrote §5's "a second ladder anywhere else is a second registry" as a prohibition. `brainiac` has
**five** near-identical `describe(e)` functions with no shared table, and calls out the duplication
nowhere. `personas-web` has ~8 per-site fallbacks. So "one table" is a claim about *this* codebase's
scale (475 `addToast` sites, 87 inline surfaces, 14 locales), not a universal. In a five-surface app
the duplication is cheap and the abstraction is not. Marked as scale-conditional.

---

## Appendix — reproduction

Nothing in this document requires `cargo`. All Rust facts come from parsing the source.

```bash
# rule tables, as data (TypeScript compiler AST)
node -e "…ts.createSourceFile('src/lib/errors/errorRegistry.ts'…)"   # → 62 / 65 / 19 rules

# the producer corpus
git ls-files "*.rs"                     # 963 files; excludes .claude/worktrees/** via .gitignore
#  → 3,539 AppError::X(..) constructions, 4,230 AppError::X references, 47 ValidationError::new

# resolution, using the SHIPPED resolvers
#  ts.transpileModule + vm, with a Proxy `t` returning @@<keyPrefix>_message@@ sentinels
#  → 1,669/3,531 unmatched · 30/65 keymap rules unreachable · 61/3,578 cross-table disagreements

npm run census -- --rule unresolved-error-as-inline-copy   # → 87 files / 123 matches
```

The three numbers most worth re-deriving before citing this document elsewhere: **30 of 65**
(unreachable rules in the rendering table), **47.3%** (constructions that render verbatim), and
**76.5%** (share of resolved constructions taken by one sentence).
