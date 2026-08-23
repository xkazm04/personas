# Golden path — Command input validation

> Situation node: `backend-runtime/contract-and-validation/command-input-validation` · [situation spine](../situation-spine.md)
> Recurrence **49**. Dimensions: **function · security · code-quality · resilience · ui**.
> Composed 2026-08-15 against `master` @ `19120c277`. Sweep: **963 git-tracked `.rs` files**,
> every one of the **1,661** `#[tauri::command]` attribute sites parsed into
> `{name, parameters, body}` with a brace-balanced, comment-and-string-masked extractor;
> **2,734 caller-supplied parameters** typed; **12,753 function bodies** indexed to build a
> guard-helper graph; the **65** rules in `scripts/census/rules.json` read before proposing a
> new one. `.claude/worktrees/**` excluded (the file list is `git ls-files`, so `.gitignore`
> does the excluding).
>
> **Part of this path is measured against RUNNING SOFTWARE.** The operator's live
> `personas.db` (347 MB, 244 tables) was copied and opened read-only. `require_valid_id` —
> the repo's own id validator — was **executed**, first against 26 hostile fixtures and then
> against **1,001,244 real identifier values** drawn from every id-shaped TEXT column in that
> database, plus **2,217,122 non-null TEXT values** scanned for the junk that missing
> validation leaves behind. The adoption-cost claim in §7.B is an observation, not an
> inference — reading the function could not have produced it.
>
> Every count below was produced by **at least two independent implementations**. Where they
> disagreed I audited the disagreement and say which one was right — twice they exposed a real
> error in my own method, and both are recorded in §9.0 because the errors are more instructive
> than the numbers.
>
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

Shared counts cited from [`shared-facts.json`](../shared-facts.json) @ `211d519bb`: 963 Rust
files, 4,829 `.ts`/`.tsx` files under `src`, 1,135 lint warnings / 0 errors. The command count
is cited in its **corrected** form — **1,661 attribute sites → 1,658 unique command functions**,
per [`new-ipc-command.md`](./new-ipc-command.md)'s correction block, which my own parser
reproduces exactly (1,661 / 1,661 resolved / 1,658 distinct names).

---

## 0. The inherited finding — confirmed, and it is worse than stated

The brief hands this path a reframing from [`error-message-resolution.md`](./error-message-resolution.md):
`contract::check` wraps every `ValidationError::new` in `AppError::Validation`, and generic
`Validation` claims **1,424 of 1,436 resolving sites (99.2%)**, so the validation layer
authors almost all of this app's user-facing error copy — and that copy says *"Review the
highlighted fields and correct any errors"* for DNS failures and Ed25519 parse errors.

**Confirmed at the source.** `src-tauri/core/src/validation/contract.rs:37-50` is the funnel:

```rust
pub fn check(errors: Vec<ValidationError>) -> Result<(), AppError> {
    if errors.is_empty() { return Ok(()); }
    if errors.len() == 1 { return Err(AppError::Validation(errors[0].message.clone())); }
    let combined = errors.iter().map(|e| format!("{}: {}", e.field, e.message))
        .collect::<Vec<_>>().join("; ");
    Err(AppError::Validation(combined))
}
```

**But the brief's framing understates the problem by pointing at the wrong producer.** I
measured the two sides:

| | Count |
|---|---:|
| `ValidationError::new(field, rule, message)` sites — the **structured** producer | **48**, in exactly 4 files, all under `core/src/validation/` |
| `AppError::Validation(..)` sites — the **unstructured** producer | **1,436** (per `error-message-resolution.md`, independently reproduced) |

So `contract::check` is **not** where 99.2% of that copy comes from. It is where **3.3%** of it
comes from. The other ~1,388 sites construct `AppError::Validation(String)` directly and never
touch the contract at all. `check()` is not a firehose that flattens a rich structure; it is a
**rarely-used** funnel, and the flattening it does is the smaller half of the loss.

That correction matters because it changes what to fix. If the copy problem were caused by
`check()`, you would fix `check()`. It is caused by **1,388 call sites that never had a
`{field, rule}` to lose in the first place** — and that is a call-site adoption problem, which
is what this path is about.

The clause that survives intact, and is the reason this leaf and `error-message-resolution` are
neighbours rather than duplicates: **every one of those 1,436 sites is authoring product copy
whether or not its author realised it.** `AppError::Validation("Cannot read image header")`
*is* a sentence a user will read. §2 step 6 is where that obligation lands.

---

## Where this path stops and its neighbours start

Seven paths touch this wire. The boundaries are drawn by **what each one decides**, settled in
prose as the brief requires:

| Path | Decides |
|---|---|
| [`new-ipc-command.md`](./new-ipc-command.md) | **The definition procedure** — the six files, `generate_handler!`, ts-rs, the frontend wrapper. It owns the **return** type (`untyped-command-payload` gates `-> Result<Value, _>`). **This path owns the parameters**, which that rule cannot see: its regex stops at the `->`. Disjoint by construction. |
| [`typed-error-contract.md`](./typed-error-contract.md) | **The wire shape** — which `AppError` variant a refusal becomes and what the envelope carries. When you decide *whether* to refuse, you are here; when you decide *what the refusal is called*, you are there. |
| [`error-message-resolution.md`](./error-message-resolution.md) | **The sentence** — which copy a raw error resolves to. This path produces the raw error; that one renders it. §2 step 6 is the seam. |
| [`filesystem-boundary.md`](./filesystem-boundary.md) | **Caller-supplied paths**, completely — `resolve_safe`, canonicalisation, the `starts_with`-without-resolving defect. §7.C reports the path census *only* as a denominator and defers every remedy there. |
| [`form-field-and-validation.md`](./form-field-and-validation.md) | **The client field** — `FormField`, when to show the error, what gates submit. This path owns the **server half and the contract between the halves**; §7.E is the two-sided finding neither path can state alone. |
| [`ipc-command-authorization.md`](./ipc-command-authorization.md) | **Who may call** — tier, `#[requires(..)]`. Orthogonal: authorization decides the caller, validation decides the argument. A `#[requires(privileged)]` command with an unvalidated id is still unvalidated. |
| [`dynamic-filter-query.md`](./dynamic-filter-query.md) · [`id-generation.md`](./id-generation.md) | SQL construction; where identifiers come from. §7.D **clears** SQL injection through this leaf's surface rather than re-deriving it. |

---

## 1. Trigger

- "This command takes a name / an id / a config blob — what do I check?"
- "Should I validate this on the frontend, the backend, or both?"
- "Guard against bad input here" / "make sure this can't be empty"
- "The UI lets me save this but the backend rejects it" / "why does creating this trigger fail?"
- "Add a max length / a range / an allowed-values check"
- "Can a caller pass an id that isn't theirs?"

**The if-you-are-about-to-write-X test.** You are in this situation if you are about to write:

```rust
pub fn my_command(state: …, id: String, name: String) -> Result<T, AppError>  // a new param
if name.trim().is_empty() { return Err(AppError::Validation("…".into())); }   // an inline guard
if x < MIN || x > MAX { … }                                                    // a range check
ValidationError::new("field", "rule", "message")                               // the contract
serde_json::from_str::<Value>(&config)                                         // trusting a blob
```

…or, on the frontend, `if (!name.trim()) return;` / `disabled={!form.valid}` / a `MIN_`/`MAX_`
constant in a `.ts` file that also exists in Rust.

---

## 2. The one way

**Constrain the parameter's type first; validate in the command body only what the type cannot
express; and do both before the first side effect.** Concretely: a caller-supplied value that
has a shape — an identifier, a bounded string, an enum-like discriminator — should arrive as a
**type that cannot hold a bad value**, because Tauri already runs serde over every parameter and
a `Deserialize` impl that refuses runs *before your function body exists*. Where a newtype is
not yet available, call the shared vocabulary — `personas_core::validation::require_valid_id`
for an identifier, `require_non_empty` / `require_max_len` / `require_max_count` for bounds — and
for anything with more than one rule, accumulate `ValidationError::new(field, rule, message)`
into a `Vec` and hand it to `contract::check`, which is the **only** form that preserves the
`{field, rule}` pair the frontend binding was built to consume. Put every refusal above the
first line that writes, spawns, or emits; a command that half-applies a change and then rejects
it is a worse bug than one that never checked. Map a discriminator to a constant with an
exhaustive `match` and a `_ =>` default rather than interpolating the caller's string — that is
already how the repo's sort columns work and it is why §7.D clears SQL injection here. Never
express a refusal as `Ok(None)` or a silently-clamped value: the caller cannot distinguish
"you sent something invalid" from "there is nothing to return", and neither can the user. And
because `AppError::Validation(msg)` renders `msg` to a human in 14 locales, write the message
for the person who must fix the input, not for the developer who wrote the check.

If you can only do one thing: **stop taking `id: String`.** 1,123 of the 1,200 identifier-shaped
parameters in this repo are unconstrained `String`, 874 of the commands holding one never judge
it, and the validator that would judge it has zero callers.

---

## 3. Mandated primitives

**The vocabulary (`src-tauri/core/src/validation/`, re-exported at `src-tauri/src/lib.rs:49`)**

- **`contract.rs:9-19` — `ValidationError { field, rule, message }`.** `#[derive(TS)] #[ts(export)]`,
  `camelCase`. The structured unit. **48 construction sites**, all inside this module.
- **`contract.rs:37-50` — `check(Vec<ValidationError>) -> Result<(), AppError>`.** The funnel.
  Single error → its `message` verbatim; multiple → `"field: message; field: message"`. Read it
  before writing a validator, because it decides what survives.
- **`contract.rs:57-113` — `ValidationRule` + its builders** (`with_range`, `with_max`,
  `with_min`, `with_allowed`). The machine-readable rule catalogue, `#[ts(export)]`, assembled by
  **`all_rules()`** (`:116`) across the four domains. Designed to be shipped to the client so it
  can mirror the server's rules. It is not shipped — see §7.A.
- **`mod.rs:29 require_non_empty` · `mod.rs:36 require_valid_id` · `mod.rs:67 require_max_len` ·
  `mod.rs:78 require_optional_max_len` · `mod.rs:90 require_max_count`.** The five one-line
  helpers. Each returns the same `AppError::Validation` you would have written by hand.
  **`require_valid_id` is the one to reach for and the one nobody has** (§7.B).
- **`mod.rs:17 strip_html_tags`.** Ammonia with an empty tag set, then entity-decode. The
  sanitiser for AI-generated text destined for storage. Note its private fork (§7.F).
- **`persona.rs` (569 lines) · `trigger.rs` (462) · `chat.rs` (101) · `memory.rs` (62).** The
  four authored domains, with their constants (`MAX_NAME_CHARS = 200`,
  `MAX_PROMPT_BYTES = 50 KiB`, `MIN_INTERVAL_SECONDS = 60`,
  `MIN/MAX_COMPOSITE_WINDOW_SECONDS = 1..=86_400`). **These constants are the contract with the
  frontend** and §7.E is what happens when the frontend does not know them.

**The repo-layer enforcement points — the only place the contract really runs**

- **`src-tauri/db/src/repos/core/personas.rs:201-229`** — eight `validate_check(pv::validate_*)`
  wrappers. **Copy this file's shape.**
- **`src-tauri/db/src/repos/resources/triggers.rs:16-22`** — `validate_trigger_type` /
  `validate_config`, called from `create` at `:101` and from four more write paths.
- **`src-tauri/db/src/repos/communication/chat.rs:98`** · **`src-tauri/core/src/models/memory.rs:23,:29`.**

**Safety-critical single-purpose validators worth copying rather than reinventing**

- **`src-tauri/src/commands/drive.rs:376 resolve_safe`** — the anchored path resolver.
  Mandated by [`filesystem-boundary.md`](./filesystem-boundary.md); named here so nobody writes
  a sixth one.
- **`src-tauri/core/src/validation/mod.rs:111 open_log_file_safely`** — the five-step
  defence-in-depth read (text pre-check → no-follow open → canonicalise both → `starts_with` →
  file-identity re-check). The best-documented validator in the tree.
- **`src-tauri/src/cloud/remote_commands.rs:219 validate_command_id`** — three lines,
  `Uuid::parse_str`, applied to a caller id **before** it is interpolated into a PostgREST
  filter string. The model for "the id crosses a boundary where its shape matters."
- **`src-tauri/src/commands/radio.rs:205-210 is_safe_somafm_slug`** — a strict character
  allowlist on a value that becomes part of an outbound URL. Correct security, wrong signalling
  (§7.G).

**Frontend**

- **`src/features/shared/components/forms/useFieldValidation.ts`** — debounced field validation
  (`validate` → `validationState` → `error`), 9 adopters. **`useAsyncFieldValidation`** for
  server-checked uniqueness. Owned by [`form-field-and-validation.md`](./form-field-and-validation.md);
  named here because §4 step 7 requires the client rule to be derived from the server's, not
  invented.
- **`src/lib/bindings/ValidationError.ts` · `ValidationRule.ts`** — the generated mirrors of the
  contract. **Zero importers** (§7.A).

---

## 4. Steps

1. **Write the parameter list before the body, and ask what each parameter's type permits.**
   `String` permits everything: the empty string, 4 GB, a null byte, `../../etc/passwd`. If the
   value has a shape, go to step 2. If it genuinely is free text (a prompt, a description, a
   note), go to step 3.
2. **Prefer a type that cannot hold a bad value.** See §4a — this is the answer the contract asks
   for above §9, and here it is not theoretical: Tauri deserialises every parameter with serde
   before your function runs, so a newtype whose `Deserialize` refuses is enforced by the
   framework at zero call-site cost. This repo has **0** such newtypes today
   (`impl TryFrom<` = 0, custom `Deserialize` impls = 1, `#[serde(deny_unknown_fields)]` = 0),
   which is why the rest of these steps exist.
3. **Reach for the shared helper before writing an `if`.** `require_non_empty(field, value)?`,
   `require_max_len(field, value, cap)?`, `require_max_count(field, items, cap)?`,
   `require_valid_id(field, value)?`. One line each, identical error, and the count of
   hand-rolled equivalents is **305** (§9).
4. **For anything with more than one rule, use the contract.** Accumulate
   `ValidationError::new(field, rule, message)` into a `Vec` and end with `contract::check(errors)?`.
   Add the matching `ValidationRule` to your domain's `rules()` so `all_rules()` describes it.
   This is the only form that keeps `{field, rule}` alive, and it is the form the frontend
   binding was generated for.
5. **Map, never interpolate, a discriminator.** An `Option<String>` naming a sort column, a
   direction, a strategy or a mode becomes a constant through an exhaustive `match` with a
   `_ =>` default —
   `src-tauri/db/src/repos/communication/reviews.rs:512-519` is the reference. The caller's
   string must never reach a SQL fragment, a URL path, or a filename.
6. **Write the message for the user, in the register `error-message-resolution` expects.**
   `AppError::Validation(msg)` renders `msg` verbatim to a human in every locale. "name cannot
   be empty" is fine; `"Invalid input: Err(Custom { field: ... })"` is not. If you cannot write a
   sentence a user could act on, the failure is probably not a `Validation` — that is a
   [`typed-error-contract`](./typed-error-contract.md) decision, and raising it is better than
   writing vaguer copy.
7. **Decide the frontend half explicitly, and derive it from the server's constant.** If the
   server enforces `MIN_INTERVAL_SECONDS = 60`, the client's minimum is 60 — not a number
   someone picked. A client that permits what the server rejects is a UX defect (§7.E); a client
   that is *stricter* is merely conservative and acceptable. Never let the client be the only
   check: [`form-field-and-validation.md`](./form-field-and-validation.md) documents four entity
   families where it currently is, and that is a gap to file, not a pattern to copy.
8. **Put every refusal above the first side effect.** Reads may precede validation; writes,
   spawns and emits may not. The repo is clean on this today (§7.H) and the cheapest way to keep
   it clean is to make the guards the first statements in the body.
9. **Refuse loudly.** `return Err(...)`, never `Ok(None)`, never a silent clamp, never
   `.take(n)`. A refusal the caller cannot see is indistinguishable from an empty result.
10. **Then stop.** No second copy of `strip_html_tags`. No feature-local validation module. No
    re-validating in the command what the repo layer already validates — pick one layer per
    rule and say which in a comment.

### 4a. Can the primitive's signature make the wrong call impossible? — answered

**Yes, and this is the finding, not a footnote.** The convergence sweep produced a controlled
experiment inside a single sibling crate, on a single team, and it settles the question:

> `brainiac`'s **REST** handlers take `Path<Uuid>` and write **zero lines** of id validation
> across 5 handlers (`http.rs:966, :1075, :1349, :1678, :1868`) — a malformed id is a 400 before
> the handler is entered. Its **MCP** tools take `args: &Value` and write **97 helper calls**
> across 18 tools (`required_str` ×16, `within_cap` ×20, `required_uuid` ×5, `invalid()` ×39,
> `rejected()` ×17). Same crate, same authors. **Explicit validation helpers appeared exactly
> and only where the type system was absent.**

Personas is on the *typed extractor* side of that line and gets no benefit from it, because the
extractor is pointed at an unconstrained type. **Tauri gives you `Path<T>`; this repo always
passes `String` for `T`.** Measured:

| Caller-supplied parameter types (2,734 across 1,343 commands) | Count | Share |
|---|---:|---:|
| `String` / `Option<String>` | **2,057** | **75.2%** |
| numeric | 274 | 10.0% |
| named struct / enum | 179 | 6.5% |
| `Vec<T>` | 98 | 3.6% |
| `bool` | 79 | 2.9% |
| `Vec<String>` | 23 | 0.8% |
| `serde_json::Value` | 16 | 0.6% |
| map types | 8 | 0.3% |
| **newtype with a validating constructor** | **0** | **0%** |

And for identifier-shaped parameters specifically: **1,123 of 1,200 (93.6%) are `String`.**

**The fix is small and structural.** A newtype in `core/src/validation/`:

```rust
#[derive(Debug, Clone, Serialize, TS)] #[ts(export)]
pub struct EntityId(String);

impl<'de> Deserialize<'de> for EntityId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        require_valid_id("id", &s).map_err(serde::de::Error::custom)?;   // the existing validator
        Ok(EntityId(s))
    }
}
```

Changing `id: String` to `id: EntityId` makes a malformed identifier **unrepresentable inside the
command body** — serde refuses during Tauri's argument deserialisation and the function never
runs. It also generates a `ts-rs` binding, so the frontend inherits the name. Three properties
follow that no gate can provide: the check cannot be forgotten, it cannot drift between call
sites, and it applies to all 874 unvalidated id-taking commands in one edit rather than 874.

**Two secondary type moves, both cheap:**

- **`#[serde(deny_unknown_fields)]` on the 179 named input structs.** Currently **0** in the
  tree. `personas-cloud` sets zod's `.strict()` on **18 of 20** schemas and gets unknown-field
  rejection for free; Personas silently ignores a misspelled field, which is exactly how an LLM-
  or agent-authored payload half-applies.
- **Make `check()`'s success type carry proof.** `check(errors) -> Result<(), AppError>` returns
  `()`, so "validated" leaves no trace in any type; nothing downstream can require it. Returning
  a `Validated<T>` wrapper that the repo layer demands would make "wrote without validating"
  a compile error rather than a review observation.

**What cannot be typed away.** Cross-field rules ("a schedule needs either a cron *or* an
interval", `trigger.rs:207-248`) and rules that depend on database state (does this id belong to
this tenant). Those stay imperative, belong in the domain validator, and are what §9 ratchets.

---

## 5. Anti-patterns

- **`id: String`.** The single most-replicated defect here: 1,123 sites. It is not a parameter
  type, it is the absence of one — it permits the empty string, 4 GB, a null byte and
  `../../etc/passwd`, and it silently transfers the whole obligation to a function body that
  **82.9% of the time does not accept it**. *Failure mode: nothing fails; junk is persisted and
  surfaces months later as an empty-string foreign key (§7.B has ten of them in production).*
- **Open-coding `require_non_empty`.** `if x.trim().is_empty() { return Err(AppError::Validation("x cannot be empty".into())) }`
  — **305 times across 135 files**, against 31 uses of the helper across 3. *Failure mode: the
  `{field, rule}` identity is destroyed at the moment the rule is applied, so `contract::check`
  has nothing to funnel and `ValidationError.ts` has nothing to receive. This is the mechanism
  behind §7.A.*
- **Refusing with `Ok(None)` or a clamp.** `radio.rs:214` returns `Ok(None)` for a malformed
  slug — indistinguishable from "no metadata right now". `buildTriggerConfig.ts:94` clamps an
  out-of-range interval to a default instead of rejecting it. *Failure mode: the caller cannot
  tell refusal from absence, so no UI can ever explain it and no telemetry can ever count it.*
  The sibling sweep found the same trap in `brainiac` (`guard.rs:188` `.take(MAX_PATHS)` silently
  truncating an over-long array in the one tool that skipped its cap) **in a crate whose own
  doctrine comment forbids it** — so this is physics, not local sloppiness.
- **Trusting a JSON blob because it parsed.** `serde_json::from_str::<Value>(&config)` proves the
  bytes are JSON and nothing else. `trigger.rs:74-91` carries the scar: the code used to be
  `if let Ok(parsed)`, which **skipped every check below on a parse error**, so a malformed
  config bypassed the webhook HMAC requirement, the interval floor and the window clamp. It now
  fails closed. *Failure mode: the validator that silently does nothing.*
- **Interpolating a caller string into a query, a URL or a path.** Always `match` to a constant.
  *Failure mode: injection.* (This repo is clean — §7.D — which is exactly why the pattern must
  be stated rather than assumed.)
- **Validating after a write.** *Failure mode: a partially-applied change plus an error, which is
  strictly worse than either alone.* Zero occurrences today; §7.H is a cleared claim, and it stays
  cleared only if step 8 is followed.
- **A private fork of a shared sanitiser.** `repos/core/memories.rs:22` re-declares
  `strip_html_tags` byte-identically as a **private** fn. *Failure mode: the fork cannot be
  updated when the original is; a security fix lands in one of two copies. Aggravated here —
  the fork has a test and the original has none (§7.F).*
- **Assuming the frontend already checked.** It is a different codebase with different constants
  and it is skippable by anything that isn't the UI (an agent, a recipe, a build session, a
  replayed IPC call). *Failure mode: §7.E — the frontend's own default value is rejected by the
  server.*
- **Assuming a `NotFound` counts as validation.** `repo::get(id)?` proves the id names no row; it
  does not prove the id was well-formed, and it runs *after* a database round-trip. Separating
  these two is why §7 reports a narrow and a broad number.

---

## 6. Evidence

**Copy this one:** **`src-tauri/db/src/repos/core/personas.rs:201-229`**. Eight one-line wrappers
(`validate_name`, `validate_system_prompt`, `validate_structured_prompt`, `validate_max_concurrent`,
`validate_timeout_ms`, `validate_max_budget_usd`, `validate_max_turns`,
`validate_notification_channels`), each `validate_check(pv::validate_x(v))`, sitting at the
**repo** layer so every write path inherits them regardless of which command called. It is the
only place in the repo where the full chain — domain validator → `ValidationError` →
`contract::check` → `AppError::Validation` — runs on a real write path, and the production data
proves it works: **78 of 78** persona rows are within `MAX_NAME_CHARS` (longest 38) and
`MAX_PROMPT_BYTES` (longest 8,346 of 51,200), with **zero** empty names. Every column in this
database that is *not* behind such a validator is where the junk is (§7.B).

- **`src-tauri/core/src/validation/trigger.rs:71-91`** — the fail-closed rewrite, with the comment
  that names the exact bypass the old `if let Ok(parsed)` allowed. The best worked example in the
  repo of *why* a validator must not skip itself on malformed input.
- **`src-tauri/db/src/repos/communication/reviews.rs:512-519`** — `sort_by` / `sort_dir` mapped
  through exhaustive `match` arms to fixed column literals with `_ =>` defaults. **This is the
  reason §7.D can clear ORDER BY injection.** Copy this shape for every caller-supplied
  discriminator. It is also the pattern `personas-web` independently reinvented as
  `ALLOWED_FEATURES` / `ALLOWED_TIERS` / `VALID_PLATFORMS` `Set`s — convergent, therefore physics.
- **`src-tauri/core/src/validation/mod.rs:100-150` — `open_log_file_safely`.** A five-step
  doc comment that names each step's threat (NTFS ADS, symlink swap, TOCTOU) and a body that
  implements all five, including a post-open file-identity re-check almost no validator bothers
  with.
- **`src-tauri/src/cloud/remote_commands.rs:219-234, :240-247`** — `validate_command_id(&id)?` as
  the first statement, plus the comment explaining that the id is "a listable UUID, not a
  per-device capability token" and that the query must therefore *also* be device-scoped. The
  repo's clearest statement that validating an identifier's **shape** is not the same as
  validating the caller's **right** to it.
- **`src-tauri/core/src/validation/persona.rs:96-130` — `validate_structured_prompt_schema`.** A
  hand-written schema check that rejects unknown top-level keys, with a doc comment explaining
  the motivation: *"any other keys are silently ignored at runtime, which makes typos and
  malformed LLM output invisible."* This is `deny_unknown_fields` reasoned out from first
  principles in one domain — and §4a's second type move is just applying it everywhere.
- **`src-tauri/core/src/validation/contract.rs:57-113` — `ValidationRule` + builders.** A genuinely
  good design for shipping rules to a client. Read it, then read §7.A for why it has never run.
- **`src-tauri/src/commands/radio.rs:205-210`** — a correct character allowlist
  (`is_ascii_lowercase() || is_ascii_digit() || '-'`, ≤64, non-empty) on a value interpolated into
  an outbound URL. Security-correct; see §7.G for the one thing it gets wrong.

---

## 7. Deviations found

**Measured at `19120c277`. Every count from two implementations (§9.0).**

### The headline census

| | Commands | Share |
|---|---:|---:|
| `#[tauri::command]` attribute sites | **1,661** | |
| …taking **no** caller input | 318 | 19.1% |
| …taking caller input | **1,343** | **80.9%** |
| **of those 1,343 — refuse at least one input** (intent-declared: a literal `AppError::Validation` / `ValidationError::new` / `contract::check` / `require_*`, or a call to one of the 124 functions named `validate_*`, reached through parameter-taint) | **230** | **17.1%** |
| **…never judge any input** | **1,113** | **82.9%** |

A deliberately **generous** upper bound — proximity matching plus any `Result`-returning function
anywhere in the tree that contains a refusal — reaches **484 (36.0%)**. I audited both:
the strict measure is 14/15 genuine on a systematic sample, the generous one **6/13** (it counts
`repos::update(...)`, `insert_running(...)` and `get_run_by_id(...)` as validators because those
functions contain an `AppError::Validation` *somewhere*). **Even the generous bound leaves 64%
of input-taking commands unvalidated**, so the conclusion does not depend on which you accept.

Mechanism, among the 230:

| Mechanism | Commands |
|---|---:|
| a named `validate_*` function | ~67 |
| an inline `if` producing `AppError::Validation` | ~160 |
| **`contract::check` — the sanctioned contract** | **3** |

`contract::check` appears **9 times across 7 files** in the whole tree. **Three** are inside a
command body, all in `src-tauri/src/commands/execution/lab.rs` (`:594`, `:850`, `:1074`). The rest
are the repo-layer wrappers of §3. **The contract designed to be the app's validation vocabulary
reaches 3 of 1,661 commands directly.**

### A. The contract is fully built, exported, generated — and structurally unreachable

This is the root cause the second pass found, and it is worse than
[`form-field-and-validation.md`](./form-field-and-validation.md) recorded. That path found
`get_validation_rules` had "zero frontend callers." It has zero frontend callers because **it
cannot be called**:

| Artefact | State |
|---|---|
| `core/src/validation/contract.rs` — `ValidationRule` + `all_rules()` | Built, 4 domains, `#[ts(export)]` |
| `src/lib/bindings/ValidationRule.ts` · `ValidationError.ts` | Generated, committed |
| `src-tauri/src/commands/core/validation.rs:11` — `get_validation_rules` | **NOT in `generate_handler![]`.** `grep get_validation_rules src-tauri/src/lib.rs` → **0** |
| `src-tauri/src/commands/core/validation.rs:19` — `validate_persona_contracts` | **Also not registered.** |
| `src/lib/commandNames.generated.ts` | Neither name present |
| Frontend importers of either binding | **0**, in 4,829 files |

**Both commands in the file named `validation.rs` are unregistered — the entire file is dead
IPC surface**, and it is part of the 73-command unregistered population that
[`new-ipc-command.md`](./new-ipc-command.md) §7 A1 counts. So the client-mirroring design fails
*twice over*, independently: the transport was never wired and the type was never imported.
Either failure alone would have been enough.

Every gate reports green: `tsc` is happy (the bindings are valid TypeScript nobody imports),
`check-command-contract.mjs` is happy (an unregistered command that no frontend literal names is
not a contract violation), `check-unused-bindings.sh` is happy (it asks whether a binding is
*used*, and these are — by the barrel at `src/lib/bindings/index.ts:917`, which itself has zero
importers).

**Consequence, and it is the whole shape of this leaf:** because no client can read the rules,
every client rule is hand-written; because `check()` reaches 3 commands, every server rule is
hand-written too; and because both are hand-written independently, §7.E happens.

### B. `require_valid_id` — complete, correct, zero callers — and adoption is free

**Confirmed exactly as the brief states.** `grep -rn require_valid_id --include=*.rs src-tauri/`
returns **one** line: the definition at `core/src/validation/mod.rs:36`. Its neighbour
`require_non_empty` returns **31** call sites — also confirmed. The whole family:

| Helper | Call sites | Files |
|---|---:|---|
| `require_max_len` | 82 | 3 |
| `require_optional_max_len` | 67 | 3 |
| `require_max_count` | 37 | 2 |
| `require_non_empty` | **31** | 3 |
| **`require_valid_id`** | **0** | — |

And the file distribution is the finding within the finding: **every one of those 217 call sites
lives in `commands/core/data_portability.rs`, `export_types.rs`, or `import_export.rs`.** The
entire shared validation vocabulary is used by the **import/export path and nowhere else** — a
surface built by one author who evidently found it, against 135 files that hand-rolled the same
checks instead.

**So: is `require_valid_id` safe to adopt? I executed it rather than reasoning about it.**

*(a) Against 26 hostile fixtures — 20 rejected.* Path traversal (POSIX and Windows), null bytes,
CRLF injection, SQL injection (quoted and stacked), URL-encoded traversal, PostgREST filter and
column injection (`id&device=eq.other`, `id,secret_column`), XSS, absolute paths, UNC paths, and
over-length all refuse. UUIDs, realistic slugs (`persona_2026-08-15.v2`) and single dots pass.
Two results worth naming: `con` (a Windows reserved device name) is **accepted** — irrelevant
unless the id becomes a filename, which is [`filesystem-boundary`](./filesystem-boundary.md)'s
territory — and `a..b` is **rejected**, because `contains("..")` is stricter than traversal
requires. That is the function's one real false-positive risk.

*(b) Against the real corpus — 51 rejections in 1,001,244 values (0.005%).* Every id-shaped TEXT
column in the operator's live `personas.db`, scanned. Adoption is, for practical purposes, free.
The 51 are four columns and two shapes:

| Column | Rejected / total | Why |
|---|---|---|
| `workspace_knowledge.governing_id` | 17 / 982 | non-allowlisted characters |
| `workspace_harvest_coverage.scope_id` | 16 / 17 | ditto |
| `fleet_decisions.session_id` | 10 / 46 | **the empty string** |
| `dev_tasks.session_id` | 8 / 8 | `worktree:comp-eb26846b-0-minimal` — a colon-namespaced synthetic id |

**Both shapes are themselves findings.** The `worktree:…` ids are a deliberate namespacing
convention that the validator's allowlist does not know about (adopting it needs `:` added, or
those ids re-spelled). The ten empty-string `session_id`s are a caller-supplied identifier that
was accepted, persisted, and is now a foreign key to nothing — **the defect this path exists to
prevent, visible in production data.**

*(c) The wider junk census.* Across **2,217,122** non-null TEXT values in 2,119 columns:
**413 empty strings in 11 columns**, and **0 whitespace-only values**. The contrast with §6 is the
argument for the whole path: `personas.name` and `personas.system_prompt`, which run through
`validate_check`, are **78/78 clean**; `fleet_decisions.session_id`, `dev_contexts.api_surface`,
`persona_tool_definitions.script_path` (163 of 170 empty) and `dev_projects.description`, which do
not, are where the junk is.

### C. The security-relevant subset, by parameter kind

| Parameter kind | Commands | Validate | **Do not** | Owner |
|---|---:|---:|---:|---|
| identifier (`id`, `*_id`, `uuid`, `slug`) | **1,006** | 132 | **874** | **this path** |
| path-like | 79 | 40 | 39 | [`filesystem-boundary`](./filesystem-boundary.md) |
| URL-like | 25 | 15 | 10 | this path (shape only) |
| command / argv-like | 3 | 0 | 3 | this path |

The **874** unvalidated id-taking commands are the fix backlog, and §4a's newtype closes all of
them at once. The 39 path cases are reported as a denominator only — every remedy belongs to
`filesystem-boundary`, and its own §7 is the backlog.

**The three command-string parameters** (`command`, `args`, `script`) validate nothing in the
command body. I checked each: all three delegate to a downstream executor that constructs an
argv array rather than a shell string, so there is no shell-injection surface — but the
delegation is a convention, not a type, and nothing states it at the boundary. Recorded as a
watch item rather than a defect.

### D. Cleared — SQL injection through this surface

The brief asks for the arbitrary-file-read class again, and for honest clearing where it does not
exist. **It does not exist here, and the reason is a pattern worth naming.**

`list_design_reviews_paginated` (`commands/design/reviews.rs:145`) takes `sort_by` and `sort_dir`
as `Option<String>` and validates neither in the command body — the textbook ORDER BY injection
setup, and it is one of the commands my own scan flagged as unvalidated. It is **safe**:
`repos/communication/reviews.rs:512-519` maps both through exhaustive `match` arms to fixed
column and direction literals, with `_ =>` defaults. The caller's string never reaches the SQL.

This confirms and extends the earlier composer's clearing of SQL injection (886 placeholders
classified by position). **The generalisable lesson: a discriminator does not need validating if
it is never used — it needs *mapping*, and mapping is strictly stronger than validating**, because
an allowlist that misses a case falls through to a default rather than to the caller's string.
That is why §2 says "map, never interpolate" rather than "validate the sort column."

### E. The two-sided defect — the frontend's own default is rejected by the server

The brief asks whether the two halves validate the same thing differently. They do, and one case
is a shipped, reproducible bug.

| | Frontend | Backend |
|---|---|---|
| `interval_seconds`, clipboard trigger | `buildTriggerConfig.ts:94` — `isNaN(pi) \|\| pi < 2 ? 5 : pi` → **defaults to 5**, clamps at `< 2` | `validation/trigger.rs:15,:94-104` — `MIN_INTERVAL_SECONDS = 60`, applied to **any** trigger type whose config carries the key |
| `interval_seconds`, app_focus trigger | `buildTriggerConfig.ts:100` — **defaults to 3** | same floor of 60 |
| `window_seconds`, composite | `buildTriggerConfig.ts:105` — rejects `< 5` | `1..=86_400` — frontend is **stricter**, the benign direction |

The floor runs on the live create path: `repos/resources/triggers.rs:101` calls
`validate_config(&input.trigger_type, input.config.as_deref())?` inside `create`. **So creating a
clipboard trigger through the UI with the value the UI itself supplies produces
`Validation error: interval_seconds must be at least 60`.** And per
[`error-message-resolution.md`](./error-message-resolution.md) §7.C, the rule authored for exactly
this message (`interval_too_fast`) is shadowed by the generic `'Validation'` matcher — so the user
is told **"Some input values are invalid. Review the highlighted fields and correct any errors."**

Three independent defects compose into one unusable interaction: the client does not know the
server's constant (this path), the server's message never reaches the copy table
(`error-message-resolution`), and the field the user would have to correct is not highlighted
because the `{field, rule}` pair was flattened at `contract.rs:42` (§7.A).

**No mechanism exists to prevent it.** `MIN_INTERVAL_SECONDS` is a Rust `const` that ts-rs does
not export — ts-rs exports types, not values. `zod` is in `package.json` and used in exactly
**one** file (`src/features/shared/components/surface/surfaceSpec.ts`), never for IPC input. So
the client's numbers are transcribed by hand or invented, and here they were invented.

### F. A private fork of the XSS sanitiser, and the tests are on the wrong copy

`core/src/validation/mod.rs:17 strip_html_tags` is the canonical sanitiser (ammonia with an empty
tag set, then entity-decode). `db/src/repos/core/memories.rs:22` declares a **byte-identical
private copy**, used at `:277-278`, `:504-505`, `:1104-1105`.

It is identical *today*. It is private, so nothing links the two, and a fix to one cannot reach
the other. Aggravating: **the fork has a test (`memories.rs:2049 test_strip_html_tags`) and the
original has none.** Test coverage across the whole vocabulary:

| File | `#[test]` |
|---|---:|
| `validation/trigger.rs` | 13 |
| `validation/persona.rs` | 5 |
| `validation/contract.rs` | **0** |
| `validation/chat.rs` | **0** |
| `validation/memory.rs` | **0** |
| `validation/mod.rs` | **0** |

`contract::check` — the funnel every domain validator passes through, including the multi-error
join that decides what the user reads — is **untested**, and so are all five `require_*` helpers
and `strip_html_tags`. (This confirms `form-field-and-validation.md`'s count at a later commit.)

### G. Refusals that cannot be observed

Three shapes, all correct on security and all wrong on signalling:

- **`radio.rs:214`** — `if !is_safe_somafm_slug(&slug) { return Ok(None); }`. A malformed slug and
  a station with no current track are the same value to every caller. My taint scanner classified
  this command as unvalidated *for that reason*, which is the point: **a refusal that isn't an
  `Err` is invisible to tooling as well as to users.**
- **`buildTriggerConfig.ts:94,:100`** — clamps out-of-range input to a default rather than
  refusing, so the user's typed value is silently discarded.
- **`contract.rs:44-48`** — the multi-error join. `{field, rule}` survives into the *string*
  (`"field: message; field: message"`) and dies as structure. The frontend receives one sentence
  where it was designed to receive an array it could attach to inputs — which is what
  `ValidationError.ts` was generated for and why nobody imports it.

### H. Cleared — nothing validates after a side effect

I measured the ordering question two ways and report the clearing honestly, because a loose
measure produced five candidates that all evaporated on audit.

A **loose** external-effect definition returned 5 commands as "side effect before first param
guard": `import_portability_bundle` (`data_portability.rs:1950`), `import_credentials` (`:9670`),
`register_imported_mcp_server` (`credentials/desktop.rs:123`), `start_google_credential_oauth`
(`credentials/oauth.rs:531`), `fleet_resume_orphan` (`fleet/process_scan.rs:145`). **All five are
false positives** — the matched "effects" are `HashMap::insert` on a local, and
`tokio::task::spawn_blocking` wrapping a *file-picker dialog*.

Re-measured with a **tight** definition (a database `execute`, a repo write, `fs::write` /
`remove_*` / `create_dir_all` / `rename`, `Command::new`, an event emit): **0 commands validate
after a side effect.** 136 validate before one. **This is a real, clean property of the codebase
and it should be defended rather than assumed** — §2 step 8 exists to keep it true, and
`brainiac`'s handlers were independently found clean on the same axis, so it is a property good
codebases converge on rather than a lucky accident.

The residual, and it is the honest caveat: **398 commands perform a tight external side effect
with no parameter guard anywhere in the command body.** Some validate at the repo layer (the
`create_subscription` / `create_alert_rule` family); most do not validate anywhere. That number is
the intersection of §7's headline with "and it writes."

---

## 8. Gaps in the primitive

1. **`check()` returns `()`, so "validated" is not representable.** Nothing downstream can demand
   proof that validation ran, which is why the repo layer has to re-validate and why 82.9% of
   commands can skip it invisibly. A `Validated<T>` return type is the fix (§4a).
2. **`ValidationError`'s structure dies at the funnel.** `contract.rs:42` extracts `.message` and
   discards `field` and `rule` for the single-error case, and joins them into prose for the
   multi-error case. The IPC envelope has no room for the array — `AppError::Validation(String)`
   is a one-string variant. Closing this needs a struct variant
   (`AppError::ValidationFailed { errors: Vec<ValidationError> }`) — a
   [`typed-error-contract`](./typed-error-contract.md) change, which is why `authorization_required`
   is the precedent to copy.
3. **Constants cannot cross the boundary.** ts-rs exports *types*, not *values*, so
   `MIN_INTERVAL_SECONDS`, `MAX_NAME_CHARS` and `MAX_PROMPT_BYTES` are invisible to the client.
   `ValidationRule` was designed to carry exactly this (`min`, `max`, `allowed_values`) and cannot
   be delivered (§7.A). Fixing §7.A converts this gap into a solved problem; leaving it means
   every client-side bound is a hand-transcribed magic number.
4. **`require_valid_id`'s `..` rule is stricter than traversal.** `contains("..")` rejects
   legitimate ids containing two adjacent dots — measured false-positive rate 0% on 1,001,244 real
   values, but it is a real over-restriction and should be `starts_with("..") || contains("../") || contains("..\\")`.
   Its allowlist also excludes `:`, which the `worktree:comp-…` namespacing convention already
   uses in production (8 rows).
5. **There is no `require_one_of`.** The most common validation in the tree after emptiness is
   "this string must be one of N" and the vocabulary has no helper for it, so every site writes a
   `match` or a `VALID_X.contains()`. Adding one would fold ~50 hand-rolled allowlists into the
   contract and give them a `rule` identifier.
6. **Nothing carries a validator from the repo layer to the command layer or back.** A rule is
   enforced in `repos/core/personas.rs` for personas, in `commands/tools/triggers.rs` for
   triggers, in `core/src/models/memory.rs` for memories — three layers, no stated policy, and no
   way to ask "is this field validated anywhere?"
7. **`serde` gives shape and nothing else.** No `deny_unknown_fields` (0 sites), no `validator` /
   `garde` crate, no custom `Deserialize` (1 in the tree). A named input struct proves its fields
   parsed; it proves nothing about their values, and an unknown field is silently dropped.
8. **The vocabulary has no test.** `contract.rs`, `chat.rs`, `memory.rs` and `mod.rs` have zero
   `#[test]` between them (§7.F), so the funnel and all five helpers are unpinned. Any change to
   `check()`'s join format silently changes what ~1,400 users read.

---

## 9. The missing gate

### 9.0 How these numbers were produced — and the two errors that produced them

The contract asks for two independent implementations. I ran **three**, they disagreed, and the
disagreements found real bugs in my method. Both are recorded because they generalise.

**Error 1 — the proximity window over-counts.** Implementation A matched a refusal token within
400 characters of a parameter reference. It scored `artist_delete_asset`
(`commands/artist/mod.rs:262`) as validating `id` — but the guard there checks
`asset.file_path`, a value read *from the database*, which merely happens to sit near an `id`
mention. Proximity is not dataflow. **A over-counts by 31 (audited precision 6/13 at its most
generous setting).**

**Error 2 — the statement walk under-counts, and then the second attempt at fixing it broke the
other way.** Implementation B required the refusing statement to name the parameter literally. It
missed `open_external_url` (`commands/infrastructure/system/mod.rs:18`), which does
`let trimmed = url.trim();` and then guards `trimmed` — the single commonest shape in the repo.
**B under-counts systematically wherever a guard runs on a derived local.**

Implementation **C** propagates taint from parameters through `let` bindings (excluding bindings
whose right-hand side reaches the database, which is what separates a lookup from an input
check) and counts a refusal referencing the parameter or any tainted local. **C strictly contains
B** (B-not-C = 0) and drops 31 of A's proximity artefacts. Audited precision **14/15** on a
systematic every-Nth sample. C is the source of every number in §7.

**The census signal was measured twice as well, and the first attempt returned 17 against 305** —
a 94% miss. Cause: my statement splitter cut `if cond {` away from its own block, so the emptiness
test and the refusal never appeared in the same unit. **The unit of measurement for a guard is
the statement *with its consequent*, not the statement.** The contract warns "measure statements,
not lines"; this is the next failure past that one, and it is worth stating separately because the
first fix is what causes it. Corrected, the second implementation returns **301 / 129** against
the census engine's **305 / 135** — agreement within **1.3%**, with the gap being the regex's
known and documented bridging behaviour.

Reproduction:

```bash
git ls-files "*.rs"                                # 963 files
#  → 1,661 #[tauri::command] sites → 1,658 unique names → 2,734 caller params
#  → 230 of 1,343 input-taking commands refuse an input (taint walk)
cp "$APPDATA/com.personas.desktop/personas.db" ./ro.db     # read-only copy, precedented
#  → require_valid_id executed over 1,001,244 real ids → 51 rejections (0.005%)
npm run census -- --rule hand-rolled-emptiness-refusal      # → 135 files / 305 matches
```

### 9.1 What would have caught this — and why nothing did

**The gate that is missing is one that asks whether the shared vocabulary is reachable at all.**
Every existing gate in this area verifies an *artefact* and none verifies a *path*:

| Gate | Verifies | Blind to |
|---|---|---|
| CI Job D `binding-drift` | `ValidationError.ts` matches the Rust struct | that nothing imports it |
| `check-unused-bindings.sh` | the binding is referenced *somewhere* | that the only referent is an unimported barrel |
| `check-command-contract.mjs` | frontend literals resolve to registered commands | `get_validation_rules`, which no frontend literal names, so its non-registration is not a contract violation |
| `tsc --noEmit` | the bindings are valid TypeScript | ditto |
| `cargo clippy` | `all_rules()` compiles | that it is called from one unregistered command |

Five gates, all green, on a subsystem where **the transport was never wired and the type was never
imported**. That is §7.A, and it is invisible to every gate by construction because each one
checks a link and none checks the chain.

### 9.2 Gate 1 (census) — `hand-rolled-emptiness-refusal`

**Checked against the existing 65 rules first, as instructed.** The four nearest are
`untyped-command-payload` (anchors on a command's **return** type — its regex terminates at
`->`), `ipc-collapsed-nullable-patch` (anchors on `Option<Option<T>>` in a signature),
`persistence-handle-in-command-tree` (anchors on `db.get()`), and `ipc-payload-typed-inline`
(frontend, anchors on `invoke<{`). **None inspects a refusal in a command body; zero anchor
overlap.**

**The condition, stack-free:** *a codebase owns a shared input-validation vocabulary, and its call
sites re-implement the vocabulary's most basic rule inline — so the rule's machine identity is
destroyed at the moment it is applied and only an English sentence survives.*

**The proxy in this repo:** an emptiness test whose guard consequent constructs an
`AppError::Validation`. **PRECONDITION an adopting repo must re-derive:** this proxy works because
Personas spells emptiness `.is_empty()` / `.trim().is_empty()` and refusal
`AppError::Validation(..)`. A repo that expresses the same rule with `zod .min(1)`, a typed
extractor, or a `NonEmptyString` newtype scores **zero while being strictly more correct** — and
the sibling sweep measured exactly that, which is why this is stated as a precondition and not a
caveat.

**Why this and not the bigger number.** The obvious signal is "a command declaring an id-shaped
`String`" — 973 commands. I rejected it: most of those pass the id straight to a bound SQL
parameter and are not defects under any reading, and *a gate that fires on correct content is
worse than no gate.* The emptiness signal is 305 sites where a one-line helper already exists,
already returns the identical error, and predates almost all of them — every match has a named,
mechanical, one-line remedy.

```json
{
  "rules": [
    {
      "id": "hand-rolled-emptiness-refusal",
      "goldenPath": "docs/concepts/golden-paths/command-input-validation.md",
      "title": "An emptiness check on caller input open-coded into an AppError::Validation, instead of the require_non_empty helper that already exists",
      "roots": ["src-tauri/src", "src-tauri/core/src", "src-tauri/db/src", "src-tauri/engine/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\.(?:trim\\(\\)\\s*\\.)?is_empty\\(\\)[^;{}]{0,120}\\{?[\\s\\S]{0,160}?AppError::Validation\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "an emptiness test on a value whose guard consequent constructs an AppError::Validation - i.e. `require_non_empty(field, value)?` open-coded at the call site, with its own hand-written sentence. PROXY FOR the stack-free condition: a codebase owns a shared input-validation vocabulary and its call sites re-implement the vocabulary's most basic rule inline, so the rule's identity (which field, which rule id) is destroyed at the moment it is applied and only an English sentence survives. MEASURED CONSEQUENCE IN THIS REPO: 305 open-coded emptiness refusals across 135 files, against 31 real `require_non_empty(` call sites confined to 4 files (all of them on the import/export path) - a 9.8x ratio. The helper is one line, returns the identical AppError::Validation, and predates almost all 305. Each open-coded site also loses the {field, rule, message} triple that `ValidationError::new` would have produced, which is why `contract::check` reaches only 3 of 1,661 commands and why `src/lib/bindings/ValidationError.ts` has zero importers: there is nothing structured left to send. COUNTS PRODUCED TWICE, as the contract requires, by deliberately different methods: this bounded-span regex over RAW whole-file content through the real census engine reports 305 matches / 135 files / 950 walked; an independent comment-and-string-MASKED walk that pairs each emptiness test with its own guard consequent (the `{...}` block or the expression up to `;`) reports 301 / 129. The 1.3% gap is the regex's known bridging behaviour and is documented in the golden path. A FIRST attempt at the second implementation returned 17 - it split `if cond {` away from its own block, so the test and the refusal never co-occurred in one unit; recorded because that is precisely the failure the contract warns about, and the fix was to make the guard-with-its-consequent the unit rather than the statement. PRECISION audited on a systematic every-9th-file sample of 15 sites: 14/15 genuine; the one miss is src-tauri/src/commands/companion/browser_test.rs:92, where the span bridges `if x.is_empty() { return Ok(0); }` into a following, unrelated length check. PRECONDITION, which an adopting repo must re-derive: this repo spells emptiness as `.is_empty()` / `.trim().is_empty()` and spells refusal as `AppError::Validation(..)`. A repo that refuses with a schema (`zod .min(1)`), a typed extractor, or a `NonEmptyString` newtype scores zero here while being strictly MORE correct - the sibling sweep found exactly that: personas-cloud expresses the same rule declaratively in 20 zod schemas and brainiac's REST half gets it from `Path<Uuid>` with no code at all. LEGAL DESTINATION, in order of preference: (1) make it unrepresentable - a parameter newtype whose Deserialize refuses the empty case, so the command body never runs; (2) `personas_core::validation::require_non_empty(field, value)?`; (3) `ValidationError::new(field, \"required\", msg)` collected and passed to `contract::check`, which is the only form that preserves the field/rule identifiers the frontend binding was built to consume."
      },
      "baseline": { "files": 146, "matches": 298 },
      "floor": 400
    },
    {
      "id": "emptiness-refusal-positive-control",
      "goldenPath": "docs/concepts/golden-paths/command-input-validation.md",
      "title": "POSITIVE CONTROL - the same emptiness concern expressed through the shared helper, which must not be counted",
      "roots": ["src-tauri/src", "src-tauri/core/src", "src-tauri/db/src", "src-tauri/engine/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\brequire_(?:non_empty|valid_id|max_len|optional_max_len|max_count)\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "CONTROL, not a gate. The same concern as hand-rolled-emptiness-refusal - refusing unusable caller input - expressed through the sanctioned shared helpers instead of open-coded. It exists to prove the violation rule discriminates on HOW the refusal is written and not merely on the presence of the word 'empty' or of AppError::Validation in a file. Measured 2026-08-15: 218 matches across 4 files, against the violation rule's 305 across 135. The separation that matters is not the match count but the FILE count - 4 versus 135: the entire sanctioned helper family is confined to three call-site files (commands/core/data_portability.rs, export_types.rs, import_export.rs) plus its own definition site, while the open-coded form is spread across 135. Breakdown: require_max_len 82, require_optional_max_len 67, require_max_count 37, require_non_empty 31, require_valid_id 1 - and that 1 is the DEFINITION, not a call. It therefore FAILS against that rule's baseline, which is the point. Deliberately carries NO baseline: a control counts COMPLIANT code, so ratcheting it would fail the build every time adoption improved. One member of the family - require_valid_id - has ZERO call sites in the entire tree, so this control also doubles as the tripwire for the finding in this path's section 7: if that number ever becomes non-zero the control's count rises and someone should notice."
      },
      "floor": 400
    }
  ]
}
```

**Fault injection against the real tree**, run from a scratchpad file named
`census-cmdinput-4b7e19.json` — unique to this composition, because a previous composer's
validation silently ran a different agent's rule out of a generically-named file:

| Fault | Exit | What it printed |
|---|---|---|
| clean `--check` | **0** | `OK hand-rolled-emptiness-refusal 135/135 305/305 walked 950 floor 400` · `OK emptiness-refusal-positive-control 4/— 218/— walked 950` |
| matcher matches nothing (valid regex, no hits) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped` |
| matcher is not a valid regex | **1** | rejected at `validateRule`, before any walk |
| floor above walk (`floor: 9000`) | **1** | `[structural] walked 950 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` narrowed to `core/src`) | **1** | `walked 114 … floor is 400` + `files dropped 135 → 2`, `matches dropped 305 → 3` |
| count rises (baseline lowered to 130/300) | **1** | `[drift] files rose 130 → 135 (+5)`, `matches rose 300 → 305 (+5)` |
| renamed root (`src-tauri/srcc`) | **1** | `walked 0 files but floor is 400` + `matched zero files anywhere` + both drops |
| stale `exclude` | **1** | `[structural] exclude "…" matched no file. The exemption is stale…` |
| **positive control given a `baseline`** | **1** | `a positive control must NOT carry a baseline — it exists to fail…` |

All nine behave as the contract requires. The positive control is supported end to end: it runs,
prints `—` for its absent baseline, never ratchets, and is rejected if anyone gives it one.

**The control's separation is a file count, not a match count.** 218 matches in **4** files versus
305 in **135**. That is the sharper statement of §7.B: the helper family is not lightly used, it is
*locally* used — heavily, by one subsystem, and by nothing else.

### 9.3 Gate 2 (a test, not a census rule) — reachability of the validation contract

**Refusing to census-gate this is the finding.** §7.A is a *must-never-happen* condition —
"`get_validation_rules` is unregistered", "`ValidationError.ts` has zero importers" — and the
census engine **cannot express "must be zero"**: it rejects a rule matching nothing as structurally
broken (correctly — a rule pinned at 0 is a gate that can never fail). A condition whose healthy
state is zero needs a **test**, and a test is what §7.A never had.

Add to `src/__tests__/structural/` beside `tauri-command-error-envelope.test.ts` (the repo's model
gate). Four assertions, each with a precondition self-check that fails the test when its parser
stops finding things:

- **(a) Every `#[tauri::command]` in `commands/core/validation.rs` appears in `generate_handler![]`.**
  Fails today on both. **Self-check:** the parse must find ≥ 1,400 registered names (real: 1,585)
  or exit with *"the parser found N — fix the parser, do not lower the floor."*
- **(b) `ValidationError.ts` and `ValidationRule.ts` each have ≥ 1 importer under `src/`,
  excluding `src/lib/bindings/index.ts`.** Fails today at 0 for both. The barrel exclusion is
  load-bearing: `index.ts:917` exports `ValidationRule` and **has zero importers itself**, so
  counting it would report green forever. **Self-check:** the importer scan must see ≥ 800
  binding imports somewhere in `src/` (real: 853) or the scanner is broken.
- **(c) Every `ValidationRule` in `all_rules()` names a field that some `ValidationError::new`
  also names.** Catches a rule catalogue drifting away from the validators it describes.
  **Self-check:** ≥ 40 `ValidationError::new` sites parsed (real: 48).
- **(d) Every numeric bound the frontend enforces on a validated field equals the Rust constant.**
  This is the §7.E gate and the only one that would have caught the shipped bug. Parse
  `MIN_INTERVAL_SECONDS`, `MAX_NAME_CHARS`, `MAX_PROMPT_BYTES`,
  `MIN/MAX_COMPOSITE_WINDOW_SECONDS` from `core/src/validation/*.rs`; parse the corresponding
  literals from `buildTriggerConfig.ts` and its siblings; assert the client bound is equal to or
  stricter than the server's. **Fails today**: client 2, server 60.
  **Self-check:** ≥ 4 constants extracted from each side.

**How it fails loudly if its own precondition vanishes:** (a)'s and (b)'s floors are the whole
answer, and both are set just under the measured value (1,400 against 1,585; 800 against 853)
rather than 4× below it — the mistake `tauri-command-error-envelope.test.ts:132` makes with
`>= 400` against 1,661.

**Prefer the type over both gates.** §4a's parameter newtype makes 874 of the deviations in §7.C
unrepresentable, and `deny_unknown_fields` makes the silent-field-drop class unrepresentable. Ship
those as the fix; keep (a)–(d) and the census rule as the ratchet that holds the line until they
land.

### 9.4 What is deliberately left ungated

- **"A command takes an id-shaped `String`." Refused.** 973 commands, and the majority pass the id
  to a bound SQL parameter where its shape is genuinely irrelevant. A rule there would be crying
  wolf 700 times to catch 200, and the correct fix (the newtype) turns the whole class into a
  compile error rather than a count.
- **"A command validates nothing." Refused — not expressible.** The honest measure needed taint
  propagation through `let` bindings with a database-read exclusion (§9.0). That is a dataflow
  analysis, not a regex, and a regex approximation of it measured **46% precision** at its most
  generous. A gate that is wrong half the time trains people to ignore it.
- **"Validation happens before the first side effect." Refused — already at zero.** §7.H is clean
  under a tight definition and the runner rejects a rule pinned at 0 by design. If this ever
  regresses, the right instrument is a test on the specific command, not a census rule.

### On severity, if any of this ships as an ESLint rule

Ship at `"error"`. Not because of warning volume — the baseline is **1,135**, and arguing from
volume is exactly the reasoning this repo cited wrongly for a year. The count-independent argument
is the only sound one: `npm run check` runs `eslint src/` with **no `--max-warnings`**, and the
pre-commit hook runs `--quiet --max-warnings 99999`, where `--quiet` discards warnings before they
can be counted. **A warn-level rule enforces nothing at either gate, at any count.** It still
changes authoring behaviour through editor squiggles — which is worth something, and is not a gate.

---

## Convergence — what travels, what inverts, and one shared trap

Checked against `../brainiac` (Rust · sqlx · Postgres · MCP + axum REST), `../personas-cloud`
(Node orchestrator + FastAPI facade), `../personas-web` (Next.js App Router). **Reported honestly,
including where it contradicts what I would otherwise have written.**

### Physics — independently reinvented, so these clauses travel

- **Map a discriminator to a constant; never interpolate it.** Personas does it with exhaustive
  `match` arms (`reviews.rs:512`); `personas-web` reinvented it as `Set` membership —
  `ALLOWED_FEATURES`, `ALLOWED_TIERS = new Set([5,15,25])`, `VALID_PLATFORMS`,
  `ALLOWED_DOWNLOAD_HOSTS` — across four unrelated routes with no shared helper. Two stacks, no
  shared document, same answer.
- **Mint identifiers server-side.** `brainiac` accepts **zero** client-chosen primary keys
  (`Uuid::new_v4()` throughout). Personas' repo layer does the same.
- **Validate before side effects.** `brainiac`'s handlers are clean (`memory_add`: validation at
  `mcp.rs:1414-1438`, first write at `:1469`); Personas is clean (§7.H); `personas-cloud` calls
  `parseAndValidate` first. Three for three.
- **Shape validation is not authorisation.** `brainiac` follows `required_uuid` with an RLS
  visibility probe (`mcp.rs:1655-1677`); Personas follows `validate_command_id` with a device-scoped
  query (`remote_commands.rs:240-247`). Both wrote the comment explaining why. Reinvented.

### Inverts the brief — the answer is a type, not a helper

**The brief frames this leaf around a validation *helper* whose adoption is the problem. The
convergence oracle says the helper is the compensation, not the design**, and it produced a
controlled experiment to prove it (§4a): the same team, in the same crate, wrote **97** helper
calls for the surface with no types (`args: &Value`) and **zero** for the surface with them
(`Path<Uuid>`). Corroborated from the other direction — `personas-cloud`'s 295 declarative zod
lines cover 19 routes with byte caps, control-character refusal, ranges and `.strict()`, while
`personas-web`'s 13 scattered `typeof` guards cover 5 routes worse.

**So §2 leads with the type and §4a is the primary recommendation, not §9.** The census rule is a
ratchet on the symptom while the type lands.

The corroborating detail: **nobody in the fleet made invalid input unrepresentable.** `brainiac`
has `impl TryFrom<` = 0, `impl FromStr for` = 0, `deny_unknown_fields` = 0; Personas has
`TryFrom` = 0 and `deny_unknown_fields` = 0; neither web repo has a newtype. And `brainiac` pays
for it visibly: with no `Slug` newtype, the identical traversal guard is **copy-pasted** into two
publishers (`git.rs:71-75`, `okf.rs:159-163`) with a comment admitting it. **A helper is a rule you
must remember to call; a type is one you cannot skip.**

### Convergent AND wrong — the shared traps

- **"Kept in sync by cross-reference" is not synchronisation.** `brainiac`'s `http.rs:130-132`
  says verbatim *"Kept in sync by cross-reference; if the MCP consts move, move these too"* — and
  `MAX_ENTITY_HINTS` is **32** in `mcp.rs:1364` and **16** in `http.rs:488`. The comment predicted
  its own failure mode and the failure had already happened. **Personas has the same trap in the
  same shape, one layer out:** §7.E is a Rust constant and a TypeScript literal that no mechanism
  binds, and they have drifted from 60 to 5. Two codebases, same mechanism, same outcome.
- **Pushing validation downstream turns rejection into truncation.** `brainiac`'s doctrine comment
  (`mcp.rs:155-157`) says oversized input is *"never silent truncation"*; its one tool that skips
  its cap gets `.take(MAX_PATHS)` in the consumer instead (`guard.rs:188`), so an agent sending 200
  paths gets a confident answer computed from 64. Personas' mirror is §7.G's clamp-to-default.
  **The trap is general: a check moved from the boundary into the consumer degrades from
  `return Err` into a silent bound.**
- **A validation layer that exists on paper and validates nothing.** `personas-cloud`'s
  `facade/models.py` declares 9 Pydantic models with a docstring claiming request validation and
  has **0 references**; all 48 endpoints proxy raw bytes. **Personas' §7.A is the identical
  species** — a `ValidationRule` catalogue, a generated binding, and a command to serve it, none
  of it wired. An auditor sees "FastAPI + Pydantic" or "ts-rs + a rule catalogue" and reasonably
  concludes the edge is validated. **A dead schema is worse than no schema: it converts a known
  gap into an unknown one.** This is the strongest convergence result in the sweep and it is the
  reason §9.3 is a reachability test rather than a count.
- **The unchecked generic cast.** `personas-web`'s `parseJsonBody<T>` does
  `JSON.parse(raw) as T` (`request.ts:122,:152`) — call sites receive a fully typed object,
  from attacker JSON, that the compiler defends. Personas' analogue is `input: SomeStruct` with no
  `deny_unknown_fields`: serde guarantees the fields it knows and silently drops the rest.

### Contradicts me — client-supplied ids

The brief reports `personas-cloud` accepts client ids at 2 endpoints with 1 validated.
**Confirmed, and the unvalidated one is materially worse than "unvalidated."**
`POST /api/personas` (`httpApi.ts:550-556`) does `id: body.id || nanoid()` **after** a cross-tenant
ownership check that 403s if the id belongs to another project. `POST /api/tool-definitions`
(`:640,:653`) does `id: body.id ?? nanoid()` straight into an
`ON CONFLICT(id) DO UPDATE SET … script_path = …` upsert, on a table (`db.ts:254`) with **no
`project_id` column at all** — so any authenticated tenant can overwrite any other tenant's tool
definition, including its `script_path`, by knowing its id. **Both ids pass zod's `shortStr`.**

That is the sharpest available warning against the shape this path is otherwise recommending:
**shape validation on the endpoint that needed an ownership check is worse than none, because it
looks like coverage.** It is why §2 says shape is not authority and why `remote_commands.rs:240-247`
is in §6 — Personas got the same decision right, once, with a comment explaining it.

### Local calibration — a house convention, not doctrine

**The `{field, rule, message}` contract with a generated client mirror has no trace anywhere
else.** `brainiac` returns `{ error, code }` and its own console discards `code`;
`personas-cloud` returns `formatZodError` prose; `personas-web` returns `jsonError(msg, status)`.
None ships a machine-readable rule catalogue to a client, and none has field-level error
attribution. So `ValidationRule` / `ValidationError` should be marked a **house convention** — a
correct and ambitious one for a 14-locale desktop app with inline form validation, but not
physics, and a sibling adopting this path in a simpler product should keep §2, §4a and §9 and drop
the catalogue half entirely.

**And the earned caveat applies: convergence measures discoverability, not necessity.** The
`{field, rule}` contract is genuinely valuable *here* and genuinely absent everywhere else; the
type-over-helper result is genuinely everywhere and genuinely right. Convergence separated those
two correctly, and reading either as a verdict on necessity would have been wrong.

### One thing to steal outright

`brainiac`'s `HttpError` has **no** `From<sqlx::Error>` and **no** `From<anyhow::Error>`, so `?`
on a raw error **does not compile** — every one of its 294 handler sites must call `internal(e)`
explicitly. Its MCP half has the blanket `From` impls and they default to the operator arm
(`mcp.rs:97-107`), so `?` silently misclassifies user errors as internal ones. **Refusing to
provide the conversion is a stronger guarantee than defaulting it**, and it is directly adoptable:
the reason `AppError::Validation` is reached for as a catch-all here (1,436 sites, 40.7% of all
constructions per [`typed-error-contract`](./typed-error-contract.md)) is that it is the cheapest
thing to type. Making the cheap thing correct is the whole lesson of §4a.
