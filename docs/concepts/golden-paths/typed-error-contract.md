# Golden path — Typed error contract

> **Corrections pass — 2026-08-13.** Applied after the wave-1 expert review
> (`REVIEW-wave1.md`). Command counts across the corpus disagreed (1,649 /
> 1,657 / 1,661 / 1,666) because each composer counted with a slightly
> different grep; the authoritative figure, measured once with
> `grep -rn --include=*.rs -o '#\[tauri::command' src-tauri | wc -l`, is
> **1,673**, and every occurrence below now reads that. Any §9 floor
> assertion seeded from the old number must be re-derived from 1,673.

> Situation node: `backend-runtime/contract-and-validation/typed-error-contract` · [situation spine](../situation-spine.md)
> Two-sided (`sides: both`, `fusedAcrossSides: true`) · recurrence **2,562** — the highest-recurrence leaf in the corpus.
> Dimensions: **ui · resilience · function · code-quality**.
> Composed 2026-08-13 from a ground-truth sweep (~35 tool calls) against `master` @ `7bb572e2b`.
> `src-tauri/target/**`, `.claude/worktrees/**` and `src/i18n/section-locales/**` excluded from all counts.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

## Trigger

- "This command can fail — what do I return?" / "which `AppError` variant is this?"
- "Show the user a proper message when this fails" / "the toast just says `[object Object]`"
- "Retry this automatically" / "should this count toward the circuit breaker?"
- "Branch the UI on *this specific* failure" (missing credential vs. offline vs. rate-limited)
- "Add a new failure mode to the taxonomy" / "the dashboard is burying everything under Unknown"
- "Translate this error message"

If you are about to type `Result<T, String>`, `AppError::Internal(`, `.map_err(|e| e.to_string())`,
`err instanceof Error ? err.message : String(err)`, `catch (e) { setError(String(e)) }`,
`error.includes('rate limit')`, or a new arm in either `classify_error` ladder — you are in this situation.

## The one way

**One error type crosses the FFI and it is `AppError`.** Backend: every `#[tauri::command]` returns
`Result<T, AppError>`; pick the variant that names the failure's *cause* — `Auth`, `NetworkOffline`,
`RateLimited`, `Forbidden`, `NotFound`, `ProcessSpawn`, `Validation` — and reach for `Internal` /
`External` only when the message genuinely comes from somewhere you do not control. Wrap third-party
`String` errors at the command boundary, not three layers down. `AppError`'s `Serialize` impl then
computes the whole taxonomy at the source and ships `{ error, kind, category, auto_fixable,
failover_eligible }` (+ `details` for `AuthorizationRequired`). Frontend: **pass the rejection value
through, never a string.** Do not call `.message`, do not `String(err)`, do not regex the text.
Narrow with `isTauriError(err)` and branch on `err.kind` (structural, stable) or `err.category`
(backend-computed — prefer it over re-deriving); use `errMsg(err, fallback)` when you need text for a
log. Surface through exactly one door: `toastCatch(context)` for anything the user is waiting on,
`silentCatch(context)` for background work, and render the user-facing words only via
`resolveErrorTranslated(t, raw)`. Then stop: no local error taxonomy, no message-matching, no second
copy of the ladder. If you find yourself writing `if (msg.includes(...))` on the frontend, the answer
is a new `AppError` variant on the backend — that is what "typed" buys.

## Mandated primitives

**Rust (`src-tauri/core/src/`)**

- **`error.rs` — `AppError`** (21 variants, 231 lines). `#[derive(thiserror::Error)]` for the message,
  a hand-written `Serialize` impl (`:160-230`) for the IPC envelope. `sanitize_error_message` (`:144`)
  strips absolute paths from `Database` / `Io` / `Internal` before they leave the process.
- **`error.rs` — `AppError::category()`** (`:112-139`). The authoritative variant → `ErrorCategory`
  map. Typed variants map directly; `Internal` / `External` / `RetryExhausted` carry arbitrary
  provider text so they fall through to the string ladder.
- **`error_taxonomy.rs` — `ErrorCategory`** (11 variants, `#[ts(export)]`, snake_case serde). The
  single classification vocabulary shared by healing, failover, drift and the frontend.
- **`error_taxonomy.rs` — `classify_error(msg, timed_out, session_limit)`** (`:141-305`). The string
  ladder, tuned against real Claude Code CLI / Anthropic stderr shapes. `Unknown` is meant to stay an
  honest signal.
- **`error_taxonomy.rs` — `is_auto_fixable` / `is_failover_eligible` / `is_technical_failure` /
  `default_severity` / `db_category`**. The only sanctioned predicates. `is_failover_eligible`
  (`:363`) is the guard on the provider circuit-breaker entry *and* the wire hint — one predicate,
  two consumers, by design.

**TypeScript**

- **`src/lib/types/tauriError.ts` — `TauriErrorKind` + `TauriErrorResponse` + `isTauriError(err)`.**
  The narrowing guard. This is the first thing any `catch` should call.
- **`src/lib/errorTaxonomy.ts` — `classifyUnknownError(err)`** (`:255`). Prefers the backend
  `category`, falls back to `classifyKind(err.kind)`, then to the string ladder. The only function
  that resolves the envelope in priority order.
- **`src/lib/errorTaxonomy.ts` — `isAutoFixable` / `isFailoverEligible` / `defaultSeverity`.** Mirrors
  of the Rust predicates.
- **`src/stores/storeTypes.ts` — `errMsg(err, fallback)` / `errKind(err)` / `reportError(...)`.** The
  store-side door: Sentry scope tags (`error.kind`, `error.action`), slice state, deduped toast.
- **`src/lib/silentCatch.ts` — `toastCatch(context, custom?)` / `silentCatch(context)` /
  `silentCatchNull(context)` / `extractMessage(err)`.** The component-side doors. Breadcrumb before
  rewrite; `recordSwallow` rollup on the silent paths.
- **`src/i18n/useTranslatedError.ts` — `resolveErrorTranslated(t, raw)` / `friendlySeverityTranslated(t, sev)`.**
  The **only** sanctioned producer of user-facing error words. 68 rules, gated against `en.json` by
  `npm run check:error-registry`.
- **`src/i18n/useTranslation.ts` — `getActiveTranslations()`** (`:310`, 49 adopters). Lets a non-React
  module reach `t` — so "the pipeline can't translate, it isn't a component" is not true.
- **`src/features/vault/sub_credentials/components/gateway/PendingAuthModal.tsx` —
  `extractPendingAuthDetails(err)`** (`:169`). Narrows the `authorization_required` `details` payload.
- **`src/__tests__/structural/tauri-command-error-envelope.test.ts`** — the Rust-half gate. Read its
  header before adding a command.

## Steps

**Backend**

1. **Declare `-> Result<T, AppError>`.** Never `String`. The structural test enforces this; its
   allowlist is shrink-only.
2. **Pick the variant by cause, not by convenience.** Ask "what would the user do about this?" —
   `Auth`/`Forbidden`/`OAuthRevoked`/`KeyringLost` → fix a credential; `NetworkOffline` → check the
   connection; `RateLimited` → wait; `Validation` → fix the input; `NotFound` → the row is gone;
   `ProcessSpawn`/`Execution` → the tool failed. If two fit, pick the one whose `category` produces
   the right `auto_fixable` / `failover_eligible` answer — that is the field with teeth.
3. **Wrap foreign `String` errors at the command boundary** with `.map_err(AppError::Validation)` (or
   `Execution` / `External` / `ProcessSpawn` as the semantics demand). One `map_err` at the top beats
   `Internal` propagated from the bottom.
4. **If a failure needs structured data in the UI, add a struct variant**, not a parseable message —
   `AuthorizationRequired { credential_id, tool_name, authorize_url }` is the pattern, and extend the
   `Serialize` impl's `details` branch to carry it.
5. **If you add a variant:** add its `kind` string arm, its `category()` arm, the `TauriErrorKind`
   member, the `KIND_TO_CATEGORY` entry, and a `PARITY_FIXTURES` pair on **both** sides — in the same
   commit. Five edits; nothing today tells you if you miss one (see §9).
6. **If you add a ladder arm**, mirror it into `src/lib/errorTaxonomy.ts` byte-for-byte and add the
   fixture to both `PARITY_FIXTURES` lists.

**Frontend**

7. **`catch (err)` — do not transform it.** No `.message`, no `String()`, no template literal. The
   rejection value is a plain object; `err instanceof Error` is `false` and `String(err)` is
   `"[object Object]"`.
8. **Narrow, then branch on `kind`.** `if (isTauriError(err) && err.kind === 'device_group_conflict')`.
   Fall back to message markers only for refusals the backend has *not* given a variant, and let
   anything unrecognised render the backend's own message verbatim rather than an invented one.
9. **Hand the raw value to one door** — `toastCatch(ctx)` (user-visible), `silentCatch(ctx)`
   (background), `reportError(err, fallback, set, { action })` (store action). Never a bare
   `.catch(() => {})`; `custom/no-silent-catch` is **error**-level and
   `custom/async-catch-requires-helper` warns on any non-helper handler.
10. **Render words only through `resolveErrorTranslated(t, raw)`.** Never `resolveError`,
    never `categoryLabel`, never `friendlySeverity` — those three are the untranslated originals.
11. **Consume `auto_fixable` / `failover_eligible` instead of re-deriving.** If you are calling
    `isAutoFixable(classifyError(msg))` on a value that came from IPC, you are recomputing a boolean
    that arrived on the wire.
12. **Stop.** No feature-local error enum, no `ERROR_PATTERNS` copy, no `severity` heuristic, no
    second `extractMessage`.

## Anti-patterns

- **`err instanceof Error ? err.message : String(err)`** — the single most-replicated defect in the
  repo (**176 sites**, 130 under `src/features/**`). Against the envelope both branches are wrong:
  it is not an `Error`, so you get the literal string `"[object Object]"` — and several of these
  sites push that value straight into UI state. `errMsg()` exists precisely for this.
- **Classifying the message when the category is on the wire.** `toastCatch` reduces the envelope to
  a string (`extractMessage`) and then re-derives the category with the TS ladder. The backend
  already did that work, with more information, at the source.
- **Reaching for `AppError::Internal` as the default.** Its `category()` re-runs the string ladder on
  its own message — it is the `Unknown` bucket wearing a typed jacket. 1,339 sites.
- **Typing everything as `Validation`.** 1,437 sites. `Validation` means *the caller sent bad input*.
  `AppError::Validation("Cannot read image header: {e}")` is an IO failure; `Validation("Cannot rename
  root")` is a `Forbidden`. Mistyping here silently sets severity `low` and suppresses retry.
- **Adding a ladder arm on one side.** The two `classify_error` implementations are hand-mirrored and
  the "parity test" duplicates its fixture data rather than comparing the two files — a Rust-only arm
  plus a Rust-only fixture ships green through both suites.
- **Message-matching on the frontend for something the backend knows.** Every
  `msg.includes('rate limit')` on the TS side is a variant that was not created. `pairingRefusal.ts`
  is the honest version of this: eight markers, each anchored on a distinctive Rust phrase, with a
  comment saying they exist *only* because those refusals have no variant yet.
- **Writing state nobody reads.** `reportError` populates `errorKind` on every one of its 293 calls
  and `sliceErrors[action]` on 18 — neither is read by a single component.
- **Rendering the untranslated registry.** `resolveError`, `categoryLabel` and `friendlySeverity`
  return hardcoded English. They are the pre-i18n originals kept for back-compat, not the API.
- **A bare `catch {}` or `.catch(() => {})`** — `no-silent-catch` is error-level; a comment-only
  justification explicitly does not clear the bar.
- **Inventing a fourth `ErrorSeverity`.** There are already three incompatible ones (below). Reuse
  `errorTaxonomy`'s.

## Evidence

**Adoption of the backend half is excellent:** of **1,673** `#[tauri::command]` functions, **1,614**
return `Result<_, AppError>` (97.2%), **15** are infallible, and **32** return `Result<_, String>` —
all 32 in `commands/fleet/`, all three files allowlisted with a written reason. The frontend half is
where the contract stops.

- `src-tauri/core/src/error.rs:160-230` — the `Serialize` impl. The whole contract in 70 lines:
  sanitize, `kind`, backend-computed `category`, two derived booleans, optional `details`.
- `src-tauri/core/src/error.rs:112-139` — `category()`. Note the deliberate split: typed variants map
  directly, the three free-form ones fall through to the shared ladder.
- **`src-tauri/engine/src/tool_outcome.rs:107-125` — the exemplary Rust *consumer*.** `classify_app_error`
  matches on variants and quarantines exactly the three passthrough variants into `classify_message`.
  This is what "match the variant; sniff the string only where the variant is a passthrough" looks like.
- `src-tauri/src/engine/mcp_tools.rs:938` — the exemplary *producer* of a structured variant:
  `AppError::AuthorizationRequired { credential_id, tool_name, authorize_url }` instead of a message
  the frontend would have to parse.
- `src-tauri/db/src/repos/resources/owned_devices.rs:252` — a repo-layer function that raises a
  dedicated variant (`DeviceGroupConflict`) rather than a generic bail, with the decision table in
  the doc comment at `:297`.
- `src-tauri/src/engine/failover.rs:73-88` — `is_failover_eligible` as the breaker guard, plus a
  counter + `tracing::debug!` on every unclassified error so `Unknown` growth is observable.
- **`src/features/settings/sub_devices/lib/pairingRefusal.ts:78-95` — copy this one.** The only site
  in the repo that gets the frontend half right: `isTauriError` → `err.kind` first ("classify it
  structurally and never on message text"), message markers only for refusals with no variant,
  `unknown` renders the backend's message verbatim.
- `src/lib/errorTaxonomy.ts:255-259` — `classifyUnknownError`: envelope `category` → `kind` map →
  string ladder, in that order. The correct resolution sequence.
- `src/lib/utils/apiError.ts:100-130` — kind-first retry classification (`TRANSIENT_KINDS` /
  `PERMANENT_KINDS`) with the regex ladder as an explicit fallback for non-IPC values.
- `src/__tests__/structural/tauri-command-error-envelope.test.ts` — **the model gate.** Shrink-only
  allowlist with per-entry reasons, a documented fix procedure in the header, and a self-check
  (`allCommands.length >= 400`) so the scanner cannot go vacuously green.
- `scripts/i18n/check-error-registry-parity.mjs` — CI-wired (`ci.yml:125`) gate proving every
  `ERROR_KEY_MAP.keyPrefix` has `_message` + `_suggestion` keys in `en.json`.

## Deviations found

**38 deviations across 7 categories.** Counts are exact greps against `7bb572e2b`.

### P0 — the root cause: the envelope is computed, shipped, and thrown away (5)

Every user-facing error in this app takes the same route, and that route discards the typed payload
on its first step:

| Path | What's wrong |
|---|---|
| `src/lib/silentCatch.ts:104-109` | `toastCatch` does `extractMessage(err)` → **string**, then `classifyErrorFull(msg)` — the TS string ladder. The envelope's backend-computed `category`, `auto_fixable` and `failover_eligible` are gone before classification starts. **391 call sites.** |
| `src/stores/storeTypes.ts:112` | `reportError` does `errMsg(err, fallback)` → **string** → `storeBus.emit('toast', { message })`. **293 call sites.** Same loss. |
| `src/features/shared/chrome/ToastContainer.tsx:55` | The renderer that all 684 of the above converge on calls `classifyErrorFull(toast.message)` — string in, English out. |
| `src/lib/errors/errorPipeline.ts:107-111` | `classifyUnknownErrorFull` — the **only** envelope-aware entry point — has **zero callers**, and is broken: `raw = err instanceof Error ? err.message : String(err)` yields `"[object Object]"` for the envelope, and `memoizedClassify` then keys the cache on that string, so the *first* structured error's classification would be returned for every subsequent one. |
| `src/lib/errorTaxonomy.ts:88` vs `:255` | Two entry points; the app uses the string-only one at all 3 `classifyErrorFull` sites and the envelope-aware one at 2 (`personaSlice.ts:204,:238`). |

Everything below is downstream of this: **the surfacing doors are string-typed**, so a mirrored
string ladder has to exist on the frontend, has to be kept byte-identical by hand, and the four typed
wire fields have nothing to attach to.

### Envelope fields with no consumer (6)

| Field / state | Reads |
|---|---|
| `auto_fixable` | **0** in application code — only the type declaration (`tauriError.ts:50`) and a test header. |
| `failover_eligible` | **0**. Same. |
| `category` | **1** (`errorTaxonomy.ts:256`). |
| `details` (`AuthorizationRequired`) | Not declared on `TauriErrorResponse` at all, so `isTauriError()` narrows it away. |
| `PendingAuthModal.tsx` + `extractPendingAuthDetails` (`:169`) | **0 importers.** The entire just-in-time OAuth consent surface is dead: 5 Rust producers, a struct variant, a `details` branch in the serializer, a modal — and nothing catches it. The only live handler is `ERROR_KEY_MAP`'s `authorization_required` rule, which re-parses the URL **out of the message string** — exactly what `details` was added to avoid. |
| `CoreState.errorKind` · `CoreState.sliceErrors` | `errorKind` written by all 293 `reportError` calls, read by **0** components. `sliceErrors` written by 18 of them; `useSliceError` / `useAllSliceErrors` (`src/hooks/useSliceError.ts`) have **0 adopters** — the only two occurrences of the name in the repo are the declaration and its own JSDoc example. |

### The `"[object Object]"` hazard (5)

- **176 sites** of `X instanceof Error ? X.message : String(X)` (130 under `src/features/**`); 216
  sites of the broader `: String(<errvar>)` shape. Against `invokeWithTimeout`'s rejection — a plain
  object, re-thrown unmodified (`tauriInvoke.ts:534`) — both branches are wrong.
- Straight-to-UI examples: `agents/sub_executions/components/runner/ExecutionPreviewPanel.tsx:31`
  (`setError(...)`), `agents/sub_executions/detail/inspector/useTraceData.ts:100`,
  `agents/sub_deployment/components/cloud/CreateTriggerForm.tsx:38`,
  `agents/sub_editor/libs/useEditorSave.ts:140`.
- Only **48** `errMsg(` and **22** `extractMessage(` adopters against those 176.
- **`errMsg` silently drops bare-string rejections.** `storeTypes.ts:71-77` handles `Error`,
  `TauriErrorResponse`, and `{ error }` objects — a plain `string` falls through to `return fallback`.
  So every one of the 32 allowlisted fleet commands has its actual error message discarded;
  `fleetSlice.ts:240` shows the user "Failed to load Fleet sessions" and nothing else.
- **The two extractors disagree.** `extractMessage` (`silentCatch.ts:22`) handles strings, walks one
  level of `Error.cause`, and prefers `message` over `error`; `errMsg` does none of the three and
  prefers `error`. Same input, two different strings, depending on which door you picked.

### Untranslated user-facing error text — 14 locales, English errors (7)

The bridge exists, is CI-gated, and is not on the path.

| Path | What's wrong |
|---|---|
| `src/features/shared/chrome/ToastContainer.tsx:55,:92,:94` | Renders `friendly.message` / `friendly.suggestion` from `classifyErrorFull` → `resolveError` → **hardcoded English**. This one component is the funnel for all 684 surfacings, so **every error toast in the app is English in every locale.** It already calls `useTranslation()` at `:48` — `t` is in scope and simply is not passed to a resolver. |
| `src/features/shared/chrome/ToastContainer.tsx:176` | `friendlySeverity(toast.severity)` — the untranslated twin of `friendlySeverityTranslated`. |
| `src/lib/errors/errorRegistry.ts` | 63 `ERROR_RULES`, each with an English `message` + `suggestion`. |
| `src/lib/errors/errorExplanation.ts:48-104` | 20 `ERROR_PATTERNS` with English `summary` + `guidance` **and English action button labels** ("Go to Vault", "Edit Triggers", "Persona Settings") — rendered as `navAction.label` at `ToastContainer.tsx:112`. |
| `src/lib/errorTaxonomy.ts:328-342` | `categoryLabel()` — 11 hardcoded English labels, consumed by `errorPipeline` and `personaSlice.ts:22`. |
| `src/i18n/useTranslatedError.ts` (`resolveErrorTranslated`) | **11 files** call it, app-wide (2 more only name it in a comment: `errorRegistry.ts:675`, `useCredentialNegotiator.ts:74`). **Zero** in `src/features/agents/**` — confirmed against the whole 303-file agents slice. 8 of the 11 are in `vault/sub_catalog` or `plugins/companion`. |
| `src/features/agents/sub_executions/libs/useDryRun.ts` | The one feature file that calls the untranslated `resolveError` directly. |

None of this is caught by `custom/no-hardcoded-jsx-text` — the strings live in const tables, not JSX
literals, so the i18n lint rule cannot see them.

### Rust — which variant a failure becomes (5)

**3,534 `AppError::X(` construction sites.** Distribution:

| Variant | Sites | Share |
|---|---:|---:|
| `Validation` | 1,437 | 40.7% |
| `Internal` | 1,339 | 37.9% |
| `NotFound` | 287 | 8.1% |
| `Database` | 133 | 3.8% |
| `Execution` | 88 | 2.5% |
| everything else (16 variants) | 250 | 7.1% |

- **78.6% of all typed errors are one of the two least informative variants.** `Internal`'s category
  is derived by re-running the string ladder on its own message; `Validation` is a fixed
  `C::Validation` regardless of what actually broke.
- **`AppError::NotFound` → `ErrorCategory::ProviderNotFound`** (`error.rs:116`). That category has
  `default_severity` = **`Critical`** and `is_failover_eligible` = **`true`**. So all 287 domain
  404s — "persona not found", "credential not found", "build session not found" — are reported to
  the frontend as a *provider outage*, at the highest severity, marked eligible for provider
  failover. `KIND_TO_CATEGORY` mirrors it (`errorTaxonomy.ts:52`), so the fallback path agrees.
  `errorTaxonomy.ts:112-121` documents this exact over-escalation **for the string ladder** and says
  fixing it needs a paired Rust change; the *typed* arm has the same defect with no note and no ticket.
- **`Io` / `Database` / `Pool` → `ApiError`** (`error.rs:126-130`). A disk-full or a locked SQLite
  file is reported as an API error, `high` severity, not failover-eligible. `tool_outcome.rs:114`
  disagrees with its own crate and maps `Io` to `Transport, retryable`.
- Mistyped samples: `AppError::Validation("Cannot read image header: {e}")` (an IO failure),
  `AppError::Validation("Cannot rename root")` (a `Forbidden`).
- `failover.rs:74` re-runs `classify_error_str` on the message even where an `AppError` variant is in
  hand — string-first inside the engine too.

### Mirror drift with no gate (7)

| Path | What's wrong |
|---|---|
| `src/lib/errorTaxonomy.ts:50-71` | `KIND_TO_CATEGORY` has **20** entries; `TauriErrorKind` has **21**. Missing: **`device_group_conflict`**. Rust maps that variant to `Validation`; `classifyKind('device_group_conflict')` returns `'unknown'`. Live impact is masked only because `err.category ?? …` prefers the wire value. |
| `error_taxonomy.rs:759-808` ↔ `errorTaxonomy.parity.test.ts:13-59` | 43 fixtures **duplicated by hand**. The TS test never reads the Rust file; the Rust test never reads the TS file. Each asserts its own ladder against its own copy of the data — so a one-sided ladder change plus a one-sided fixture add passes both suites. **A gate that cannot detect the drift it exists to detect.** |
| `useTranslatedError.ts:66` ↔ `errorRegistry.ts:60` | 68 `keyPrefix` entries vs 63 `ERROR_RULES`. Both files instruct the reader to keep them "in sync" / "in lock-step"; `check:error-registry` only validates keyPrefix → `en.json`, never rule ↔ rule. |
| `src/lib/errorTaxonomy.ts:5` · `errorTaxonomy.parity.test.ts:5` | Both cite `src-tauri/src/engine/error_taxonomy.rs` — **the file does not exist** (real path: `src-tauri/core/src/error_taxonomy.rs`). The parity test's own "keep this in sync with `<file>`" instruction points at nothing. |
| `src/__tests__/structural/tauri-command-error-envelope.test.ts:5` | Cites `src-tauri/src/error.rs` — also gone (real: `src-tauri/core/src/error.rs`). |
| `src/features/settings/sub_devices/lib/pairingRefusal.ts:12` | "`AppError` carries only `{ error, kind }` over IPC" — three fields stale, and it is the justification the file gives for message-matching. |
| `.claude/CLAUDE.md` (Error Handling §) | Says `custom/no-silent-catch` "warns". It is `"error"` (`eslint.config.js:104`). Under-selling a real gate. |

### Vocabulary collisions (3)

- **Three exported `classifyError`** with three different signatures and return types:
  `errorTaxonomy.ts:88` (`string → ErrorCategory`), `apiError.ts:100` (`unknown → ApiError`),
  `failover.rs:73` (`&str → Option<ErrorCategory>`) — plus `error_taxonomy::classify_error`. An
  import-site typo produces a compiling, wrong program.
- **Three `ErrorSeverity` types**: `errorTaxonomy.ts:34` (`info|low|medium|high|critical`),
  `apiError.ts:13` (`transient|permanent|unknown`), `errorExplanation.ts:30`
  (`critical|warning|info`). `errorPipeline.ts` has to alias one as `TaxonomySeverity` to hold two of
  them in the same interface.
- **Two "category" vocabularies on one object**: `ClassifiedError.category` is an `ErrorCategory`
  (11 values) while `ClassifiedError.friendly.category` is a `FriendlyErrorCategory` (4 values).

## Gaps in the primitive

1. **`ClassifiedError` cannot represent a typed error.** `classifyErrorFull(raw: string)` takes a
   string, so the pipeline is *structurally* incapable of carrying `kind` / `details` / the wire
   booleans. This is the gap that produces the entire P0 section. The fix is a signature change:
   `classifyErrorFull(err: unknown)`, with `raw` derived internally via `extractMessage`.
2. **Translation is not reachable from the pipeline — except it is.** The stated reason
   `errorPipeline` uses the English registry is that it is not a React module. But
   `getActiveTranslations()` (`useTranslation.ts:310`) exists and has 49 adopters. The gap is real
   only for the **memo cache**: `classifyCache` is keyed on the raw string, so once translation is
   folded in the key must become `${locale}::${raw}` or the cache must clear on locale change.
   Roughly a 10-line change, blocked on nothing.
3. **`errMsg` has no string arm.** One missing `if (typeof err === 'string') return err;` is why 32
   fleet commands' messages vanish. `extractMessage` already has it — the two should be one function.
4. **`TauriErrorResponse` has no `details` field**, so the one structured variant that carries
   per-error data is invisible to the type system and `extractPendingAuthDetails` has to re-narrow
   from `unknown`. A `details?: Record<string, unknown>` (or a discriminated union on `kind`) closes it.
5. **No variant expresses "the caller asked for a row that isn't there" separately from "the provider
   is missing."** Both are `NotFound → ProviderNotFound → critical + failover-eligible`. This needs a
   new `ErrorCategory::ResourceNotFound` (non-critical, non-failover) on both sides — and the same
   change fixes the documented string-ladder over-escalation at `errorTaxonomy.ts:112-121`.
6. **`AppError` cannot carry a cause chain.** Only `#[from]` conversions preserve the source
   (`rusqlite`, `r2d2`, `io`, `serde_json`); every `AppError::Internal(format!("…: {e}"))` flattens the
   cause into text, which is why the string ladder has to exist at all.
7. **The taxonomy has no "user cancelled" category.** `AppError::Internal("Export cancelled")` is
   classified `Unknown`, severity `medium`, and toasts as an error.
8. **`Unknown` growth is observable in Rust and invisible in TS.** `failover.rs:81` counts
   unclassified errors; the frontend ladder has no equivalent counter, so nobody learns which shapes
   the TS mirror is missing.
9. **No gate on the frontend half of the contract, and the two that exist have soft spots.** See §9.

## The missing gate

The backend half is the best-gated situation reviewed so far —
`src/__tests__/structural/tauri-command-error-envelope.test.ts` is the model the rest of the repo
should copy. **The frontend half has no gate at all**, and both existing gates have a precondition
that can silently vanish. Four pieces:

### 1. `custom/no-stringly-error-extraction` — ESLint rule, `"error"`

- **Signal.** The AST shape `X instanceof Error ? X.message : String(X)` — a `ConditionalExpression`
  whose test is `BinaryExpression{operator:'instanceof', right:'Error'}` and whose alternate is
  `CallExpression{callee:'String'}` over the same identifier. **176 exact hits today**; the shape
  occurs essentially nowhere except error handling, so precision is near-perfect. Extend to the
  bare-`String(err)`-in-a-catch-binding form once the first wave lands (216 hits).
- **Mechanism.** New rule in `eslint-rules/`, registered in `eslint.config.js` alongside the 21
  existing custom rules. Message names the fix: `errMsg(err, fallback)` from `@/stores/storeTypes` or
  `extractMessage(err)` from `@/lib/silentCatch`.
- **Allowlist.** No path allowlist. Per-site `// eslint-disable-next-line` **with a reason** for
  values that genuinely are always `Error` — `App.tsx:87` (React error boundary), `twin.ts:188`
  (`JSON.parse` failure). Expect fewer than 10.
- **Ships as `"warn"` for one milestone** (176 sites is a migration, not a fix), then flips to
  `"error"` once the count reaches zero. The flip date goes in the rule's JSDoc.

### 2. `scripts/check-error-contract.mjs` — the mirror gate

Wired into `npm run check` and `ci.yml` next to `check:error-registry`. Four assertions, **each with
its own precondition self-check that fails the script when the parser stops finding anything** —
because the failure mode this repo actually suffers is a gate that runs green while checking nothing.

- **(a) Kind-set parity.** Parse the `pub enum AppError` variants and the `kind` match arms from
  `src-tauri/core/src/error.rs`; parse `TauriErrorKind` from `src/lib/types/tauriError.ts`; parse
  `KIND_TO_CATEGORY` keys from `src/lib/errorTaxonomy.ts`. Assert all three sets are equal.
  *Catches `device_group_conflict` today.*
  **Self-check:** each parse must yield ≥ 18 entries (21 exist) or exit 1 with "parser found N,
  expected ≥18 — the source shape changed; fix the parser, do not lower the floor".
- **(b) Category-map parity.** Parse `AppError::category()`'s arms → `variant → ErrorCategory`;
  compare against `KIND_TO_CATEGORY`'s values. Named exception: `internal` / `external` /
  `retry_exhausted` resolve to `unknown` on the TS side by design.
  **Self-check:** arm count must equal the variant count from (a).
- **(c) Fixture parity, actually compared.** Read `PARITY_FIXTURES` from **both**
  `src-tauri/core/src/error_taxonomy.rs` and `src/lib/errors/__tests__/errorTaxonomy.parity.test.ts`
  and assert the two ordered `(input, category)` lists are identical after `PascalCase`→`snake_case`
  normalisation. This converts today's duplicated-data test into a real mirror check.
  **Self-check:** both lists must parse ≥ 40 pairs (43 exist).
- **(d) Ladder-shape parity.** Extract every `lower.contains("…")` literal from Rust `classify_error`
  and every `lower.includes('…')` from TS `classifyError`, grouped by the category its arm returns;
  assert the per-category literal sets match. This catches what fixtures cannot: an arm added on one
  side with no fixture at all.
  **Self-check:** ≥ 60 literals on each side (~70 exist).

### 3. `no-restricted-imports` on the untranslated doors — and delete the fork

`resolveError`, `friendlySeverity` and `categoryLabel` are the pre-i18n originals; nothing outside
the i18n layer should import them. Add them to the existing `no-restricted-imports` block in
`eslint.config.js` — the same mechanism that already enforces `invokeWithTimeout` over raw `invoke`
— with an **allowlist of exactly** `src/i18n/useTranslatedError.ts`, `src/lib/errors/errorPipeline.ts`
(post-fix, calling through `getActiveTranslations()`), and the two test files.

`no-restricted-imports` no-ops silently if its path pattern stops matching, so pair it with assertion
**(e)** in `check-error-contract.mjs`: the set of files importing `resolveError` must equal the
allowlist exactly — **and must not be empty.** Zero importers means the funnel was rewired and the
rule is now guarding a corpse; that fails just as loudly as an unauthorised importer.

### 4. Repair the two existing gates' self-checks

- `tauri-command-error-envelope.test.ts:132` asserts `allCommands.length >= 400` against a real count
  of **1,673**. A refactor that hid 75% of the IPC surface would pass. Raise the floor to `>= 1400`
  and add a comment binding it to the measured count, so the tripwire sits just under reality rather
  than 4× below it.
- Fix the three stale source paths (`errorTaxonomy.ts:5`, `errorTaxonomy.parity.test.ts:5`,
  `tauri-command-error-envelope.test.ts:5`) and add assertion **(f)**: every `src-tauri/...` path
  mentioned in those three files must exist on disk. A "keep this in sync with `<file>`" comment
  pointing at a deleted file is the cheapest possible way for a mirrored pair to quietly stop being
  mirrored.

**What cannot be gated.** No machine can decide whether `AppError::Validation` was the *right*
variant for a given failure — that is judgment, and it is where 78.6% of the construction sites sit.
The nearest mechanical proxy is a budget: assert that `Internal` + `Validation` do not exceed their
current share of `AppError::X(` sites, so the ratio can only improve. That is a ratchet, not a gate,
and it should be labelled as one.
