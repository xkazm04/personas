# Billing-account auth

> Situation node: `ai-agents` / `cost-governance` / `billing-account-auth` ·
> [situation spine](../situation-spine.json)
> `sides: "server"` · `convergence: "mixed"` · `twoSided: false` · `risk: high` ·
> `recurrence: 4` · dimensions: cost · security · function
> Spine's own framing: *"Every spawned model process authenticating against the
> intended account."*
>
> Composed 2026-08-17 against `master` @ `2a874e692`. Sweep: all 963
> `src-tauri/**/*.rs` walked by two independent matchers (one region-scoped
> brace-matcher written for this leaf, one delegated full read); every
> `Command::new` → `.spawn()` region that drives the Claude CLI opened by hand;
> `engine/src/cli_process.rs`, `engine/src/prompt/cli_args.rs`,
> `engine/src/parser.rs`, `src/engine/runner/credentials.rs`,
> `db/src/builtin_connectors.rs` read in full. Spend measured against the
> **2026-08-17 purge backup** (2,188 executions), never the live file.
>
> **Deferred-fixes #24 is overturned by measurement. See §0.3 and §12.1.**

---

## 0. The headline, before anything else

The one control that decides who pays for every model call this application makes
is a **three-element string array**:

```rust
// engine/src/cli_process.rs:36-40
pub const CLI_SUBSCRIPTION_RESERVED_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
];
```

It is stripped from a spawned child's environment so the Claude CLI falls through
to the operator's subscription OAuth instead of billing a pay-per-token API
account. The doc comment above it is unusually clear about the stakes — *"Leaving
any of them set silently bills the API account and surfaces as 'Credit balance is
too low'. (User directive 2026-06-11.)"*

The credential-resolution order those three names participate in is longer than
three. First match wins:

1. `ANTHROPIC_API_KEY` — **stripped**
2. `ANTHROPIC_AUTH_TOKEN` — **stripped**
3. `ANTHROPIC_PROFILE` — selects a named OAuth profile, i.e. **a different org and
   workspace**; outranks everything below it, and a *missing* named profile is an
   error rather than a fall-through
4. Workload Identity Federation: `ANTHROPIC_FEDERATION_RULE_ID`,
   `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`,
   `ANTHROPIC_IDENTITY_TOKEN_FILE` / `ANTHROPIC_IDENTITY_TOKEN` (+ optional
   `ANTHROPIC_WORKSPACE_ID`)
5. the default profile on disk — whose **location** is chosen by
   `ANTHROPIC_CONFIG_DIR`

plus `ANTHROPIC_BASE_URL` (**stripped**, redirects the host entirely) and the
Bedrock/Vertex switches (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`,
`AWS_BEARER_TOKEN_BEDROCK`) which move billing to a different cloud vendor
altogether.

**Measured across the entire repository — every `.rs`, `.ts`, `.tsx`, `.mjs`,
`.json`, `.toml`, and `.md` file — the number of occurrences of any of the
following is zero:**

`ANTHROPIC_PROFILE` · `ANTHROPIC_CONFIG_DIR` · `CLAUDE_CONFIG_DIR` ·
`CLAUDE_CODE_OAUTH_TOKEN` · `CLAUDE_CODE_USE_BEDROCK` · `CLAUDE_CODE_USE_VERTEX` ·
`AWS_BEARER_TOKEN_BEDROCK` · `ANTHROPIC_FEDERATION_RULE_ID` ·
`ANTHROPIC_SERVICE_ACCOUNT_ID` · `ANTHROPIC_IDENTITY_TOKEN` ·
`ANTHROPIC_WORKSPACE_ID` · `ANTHROPIC_ORGANIZATION_ID` · `ANTHROPIC_CUSTOM_HEADERS` ·
`apiKeyHelper`

**0 files. 14 names.** Every one of them, if present in the environment the app
inherited at launch, is passed to every spawned `claude` child untouched.

This is the doctrine's own rule about vocabulary-based signals, promoted from a
measurement instrument to a production security control:

> A vocabulary-based signal's recall is bounded by its author's word list, and
> the misses cluster on the unusual cases.

The three names on the list are the three that produce a *visible* symptom —
"Credit balance is too low". The eleven that silently bill a different, valid
account produce no symptom at all, which is exactly why nobody wrote them down.

### 0.1 The list is incomplete; its application is also incomplete

Six spawn sites drive the Claude CLI without ever calling
`force_subscription_auth` or looping `CLI_SUBSCRIPTION_RESERVED_ENV`. Hand-verified,
each one opened:

| site | how it spawns |
|---|---|
| `src/commands/artist/mod.rs:676` | `Command::new(&cli_args.command)` |
| `src/commands/infrastructure/standards_scan.rs:225` | `Command::new(&cli_args.command)` |
| `src/commands/obsidian_brain/revitalize.rs:249` | `Command::new(&cli_args.command)` |
| `src/engine/project_tracking/consolidator.rs:354` | `Command::new(&cmd_program)` from `base_cli_invocation()` |
| `src/commands/ocr/mod.rs:579` | `Command::new("cmd") /c <binary or "claude">` |
| `src/commands/ocr/mod.rs:596` | `Command::new(&binary)`, args `-p - --output-format text` |

**Three of them run a loop that looks exactly like the guard and is not.**
`artist/mod.rs:690`, `standards_scan.rs:240`, and `revitalize.rs:264` each execute

```rust
for key in &cli_args.env_removals { cmd.env_remove(key); }
```

and `build_cli_args` populates `env_removals` with five names —
`CLAUDECODE`, `CLAUDE_CODE`, `DISABLE_PROMPT_CACHING`, `DISABLE_PROMPT_CACHING_1H`,
`DISABLE_PROMPT_CACHING_5M` (`cli_args.rs:184-199`) — **none of which is an auth
variable.** A reviewer scanning for "does this strip the environment?" sees a
strip loop and moves on.

Meanwhile `cli_process.rs:305-310` states that folding the strip into
`spawn_headless_claude` *"closes that gap for every caller, with no opt-out."*
Six callers do not go through `spawn_headless_claude`.

### 0.2 And the ordering contract is documented in prose and violated once

`cli_process.rs:44` — *"Call AFTER applying any env overrides so nothing can
re-introduce them."*

`src/companion/athena_reaction.rs` calls `force_subscription_auth` at `:567` and
then applies `env_overrides` at `:579-580`. Two independent implementations found
this site and only this site.

**It is latent, not live**: `build_cli_args` never emits an `ANTHROPIC_*` override
today, so nothing is currently re-introduced. It is in this document because the
contract exists only as a sentence in a doc comment, nothing enforces it, and the
*next* override added to `build_cli_args` makes it live silently.

### 0.3 Nothing records which account paid — so none of the above is detectable

Grepped the schema and every migration for a column whose name contains
`account`, `payer`, `billing`, or `org`: **zero matches.** `persona_executions`
records `model_used`, `input_tokens`, `output_tokens`, `cost_usd`,
`cache_read_tokens`, `cache_creation_tokens` — and no identity for who was
charged. `dev_llm_spend` attributes to a *code path* (`source`, `trigger_kind`),
`provider_audit_log` to an *engine kind*. Neither is an account.

So a run that billed the wrong account is byte-identical, in every table, to one
that billed the right one. **The invariant this leaf names is enforced only at
spawn time and never written down**, which means the six unprotected sites in
§0.1 could have been billing an API account for months and the database would
look exactly as it does.

And the one reconciliation path that would catch it does not run — see §7.E.

---

## 1. Trigger

- *"spawn the Claude CLI to do X"* — you are here, every time, no exceptions
- *"why did this show 'Credit balance is too low'?"*
- *"make sure this runs on the subscription, not on credits"*
- *"add an env var for the child process"* — you are here, because you may be
  re-introducing one
- *"reconcile what we spent against the bill"*
- **The `if you are about to write X` test:** if you are about to write
  `Command::new(<anything that resolves to claude>)`, you are in this situation
  before you write the next line.

---

## 2. The one way

**Do not subtract from an inherited environment — construct the one the child
should have, and make constructing it the only way to spawn.** A denylist over a
namespace you do not own is unbounded by construction: the vendor may add a
credential source in any release, and your list is a snapshot of the ones you
knew about. Concretely, in order: (a) route every model-invoking child through
**one** constructor that owns the environment, and give it no parameter through
which a caller can hand it a `Command` it did not build — `spawn_headless_claude`
is 80% of the way there and six callers bypass it; (b) inside that constructor
call `.env_clear()` and add back the variables the child genuinely needs
(`sanitized_env` at `auth_detect.rs:503-536` already does this correctly for
non-Claude CLIs — copy it); (c) if you must keep a denylist, derive it from the
vendor's documented resolution order rather than from the symptoms you have seen,
and put a dated comment naming the source; (d) apply the strip **last**, after
every override, and make that unforgeable by having the constructor apply it
rather than the caller; and (e) **write the resolved payer onto the row the call
produces**, because a control you cannot audit after the fact is a control you
cannot know is working. When both a denylist and a constructed environment are
available, reach for the constructed environment first — the denylist is what you
keep only until the last bypassing caller is migrated.

---

## 3. Mandated primitives

| primitive | what it gives you |
|---|---|
| `engine/cli_process.rs::spawn_headless_claude(prompt, model, extra_args, exec_dir, capture_stderr)` | the intended front door. Applies the strip at `:352-359`, after overrides |
| `engine/cli_process.rs::force_subscription_auth(&mut Command)` | the strip. **Call last** (`:44`) |
| `engine/cli_process.rs::CLI_SUBSCRIPTION_RESERVED_ENV` | the list. Consulted by the spawn path *and* the injection path — a genuinely good piece of design (§6) |
| `engine/cli_process.rs::claude_cli_invocation() -> (String, Vec<String>)` | resolves the real `claude.exe` rather than trusting PATH/PATHEXT. Read `:51-67` for the two failure modes it exists to prevent |
| `commands/credentials/auth_detect.rs::sanitized_env()` | **the correct shape**: `env_clear()` + a five-name allowlist. Used for third-party CLIs, not for `claude` |
| `engine/runner/credentials.rs:898-913` | the injection-side guard: refuses to bind a vault credential to a reserved name |
| `core/types.rs::CliArgs { env_overrides, env_removals, … }` | the argument object. `env_removals` is **not** an auth control — see §0.1 |

---

## 4. Steps

1. **Decide who pays before you decide what to run.** Subscription and API
   account are different products with different failure modes; the choice is not
   a detail of the spawn.
2. **Reach for `spawn_headless_claude`.** If it cannot express what you need, fix
   it rather than hand-rolling a `Command` — six hand-rolls are why §0.1 exists.
3. **If you must build the `Command` yourself:** `.env_clear()` first, then add
   what the child needs. Do not start from the parent's environment.
4. **Apply every override.** All of them, before step 5.
5. **Strip last.** `force_subscription_auth(&mut cmd)` immediately before
   `.spawn()`, with nothing between.
6. **Record the payer on the resulting row** — a `billing_account` or
   `auth_source` column with the resolved value, not a boolean.
7. **And then stop.** Do not add a fallback that re-enables API-key auth "just in
   case". A silent fallback to a paying account is the exact outcome the control
   exists to prevent.

### Can the type make the wrong call impossible? — asked before §9

Yes. See §9.1.

---

## 5. Anti-patterns

**Denylisting a vendor's credential namespace.** Failure mode: the vendor adds a
source, your list does not, and the failure is silent because the new source
works. §0's 14 names.

**Mistaking `env_removals` for the auth guard.** Failure mode: a reviewer sees a
strip loop and stops looking. Three live sites.

**Stripping before overriding.** Failure mode: an override re-introduces a name
you just removed. One live site, currently inert.

**Spawning the CLI outside the front door.** Failure mode: every future guard
added to the front door misses you. Six live sites.

**Recording spend without recording the payer.** Failure mode: the control is
unfalsifiable. Whole schema.

**Reading a token count from a position the vendor does not use.** Failure mode:
zeros that look like "no usage" rather than "not parsed". §7.D — 2,188 of 2,188
rows.

---

## 6. Evidence

**Copy this one:** `src-tauri/src/engine/runner/credentials.rs:898-913`. It is the
only place in the repo where the reserved list is used *defensively rather than
correctively* — before injecting a vault credential under a caller-chosen env
name, it checks the name against `CLI_SUBSCRIPTION_RESERVED_ENV` and refuses with
a `tracing::warn!` that names both the variable and the credential. The comment
above it explains the whole billing model in five lines. **This is the right
instinct in the wrong shape** (it is still a denylist — §7.B), but as a piece of
defensive plumbing it is the exemplar.

Also exemplary:

- `engine/src/cli_process.rs:26-49` — the constant and the applier, with a doc
  comment that states the money consequence, the symptom string, and the date of
  the user directive that produced it. Most constants in this repo are not
  documented this well.
- `engine/src/cli_process.rs:762-831` — three regression tests that poison all
  three variables and assert removal, including
  `force_subscription_auth_wins_over_prior_env_overrides`, which pins the
  ordering contract §0.2 describes. The tests exist; the *enforcement* of the
  ordering at every call site does not.
- `commands/credentials/auth_detect.rs:503-536` — `sanitized_env`: `env_clear()`
  plus `PATH`, and per-platform `USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/`SYSTEMROOT`
  or `HOME`. **The repo already contains the correct answer to this leaf.** It is
  applied to `gh` and friends and not to the CLI that spends money.
- `engine/src/prompt/cli_args.rs:186-190` — *"Keep enumerated — env_remove is
  exact-match, not prefix."* A comment that anticipates precisely the mistake a
  future reader would make.

---

## 7. Deviations found

### 7.A The reserved list covers 3 of at least 17 billing-account selectors

Measured: 0 files, repo-wide, for the 14 names in §0. `ANTHROPIC_PROFILE` and
`ANTHROPIC_CONFIG_DIR` are the sharpest — both select a *different valid account*
rather than failing, so neither produces the "Credit balance is too low" symptom
the list was built from.

**Not applied.** Extending a security control's denylist changes what the app
does with the operator's own environment and could break a deliberate local
setup. Filed as a deferred fix.

### 7.B The guard is a denylist over a namespace the caller populates

`credentials.rs:904` checks the composed env **name** against the list. A vault
credential field is free-form: the operator names it. So a credential whose field
key composes to `ANTHROPIC_PROFILE` (or `CLAUDE_CONFIG_DIR`, or any WIF name)
injects with no warning. The repo's **own test asserts this**, at
`credentials.rs:1187-1188`:

```rust
// A sibling non-reserved field still injects — the guard is selective.
assert_eq!(env_get(&env, "ANTHROPIC_ORG_ID"), Some("org-123"));
```

The test is right about the behaviour and is pinning the incompleteness as a
feature. (`ANTHROPIC_ORG_ID` is itself inert — it is not in the resolution chain —
but the shape it demonstrates is not.)

The same test block is otherwise a model of its kind: `:1178-1186` asserts the
three reserved *values* do not leak under any other name either. **That
value-level check exists only in the test.** The production code checks names.

### 7.C Six spawn sites, no strip

Enumerated in §0.1. Reconciles with the existing census rule
`unpinned-billing-account-spawn` (baseline 5 files / 5 matches), whose own
description concedes partial recall and names `ocr/mod.rs:579` as invisible to a
resolved-binary anchor. It misses **two** OCR sites, not one — `:596` is a
resolved-binary spawn and should match the anchor; it does not, because the rule
additionally requires the string `claude` within 400 characters *after* `.spawn()`
and that site's error path does not mention it.

### 7.D 2,188 of 2,188 executions record zero input and output tokens

Measured against the 2026-08-17 backup:

| column | rows > 0 | of |
|---|---:|---:|
| `cost_usd` | **1,970** | 2,188 |
| `cache_read_tokens` | **585** | 2,188 |
| `input_tokens` | **0** | 2,188 |
| `output_tokens` | **0** | 2,188 |

`SUM(cost_usd)` = **$2,036.2571**.

The cause is visible in six lines of one function, `parser.rs:337-370`:

```rust
:339  let total_cost_usd       = value.get("total_cost_usd")…      // top-level  → POPULATED
:340  let total_input_tokens   = value.get("total_input_tokens")…  // top-level  → 0/2188
:341  let total_output_tokens  = value.get("total_output_tokens")… // top-level  → 0/2188
:346  let usage = value.get("usage");
:347  cache_read_input_tokens = usage.get("cache_read_input_tokens")
:349                           .or_else(|| value.get("cache_read_input_tokens"))  // → 585
```

**Within one struct literal, the fields that consult `usage` are populated and
the fields that do not are zero.** The `usage`-first fallback was added later
(the comment at `:342-345` dates it to CLI 2.1.152) for the cache fields only;
the two token fields six lines above never got it.

**And a second consumer of the same event proves it.**
`db/src/repos/llm_spend.rs:100-101` reads `usage.input_tokens` / `usage.output_tokens`
with no top-level fallback, and its table is populated: `dev_llm_spend` has 89
rows, **85 with `input_tokens > 0`**. One stream event, two parsers, opposite key
paths, 0/2188 versus 85/89.

### 7.E The app holds a billing-API credential and never calls it

`db/src/builtin_connectors.rs:50-63` defines `builtin-anthropic-admin`:

- host `https://api.anthropic.com/v1/organizations/usage_report/messages`
- header `x-api-key: {{admin_api_key}}`, `anthropic-version: 2023-06-01`
- field `admin_api_key`, `type: password`, `sensitive: true` → stored in
  `credential_fields`, AES-256-GCM, same vault as every other connector
- description: *"Anthropic organization admin API — usage and cost reporting per
  API key (LLM spend KPIs)"*
- `template_enabled: false`

**Consumers: zero.** `usage_report` and `anthropic-admin` appear nowhere outside
that definition. Its only execution path is the generic healthcheck engine
resolving the placeholder.

So the two halves this leaf's brief hypothesised — *spend accounting* and
*authenticating to a billing API to reconcile it* — both exist in this repo and
**are not connected**. And they could not be: reconciliation needs token counts
(§7.D: zero) and an account identity (§0.3: no column).

### 7.F The app harvests the very variable it refuses to inject

`commands/credentials/foraging.rs:80` — `("ANTHROPIC_API_KEY", "anthropic", "api_key")`
in `ENV_PATTERNS`. The app scans the operator's shell and `.env` files for an
Anthropic API key and stores it in the vault. `credentials.rs:904` then refuses to
inject it into a CLI child.

Both behaviours are individually defensible — harvesting populates the vault for
*direct HTTP* model calls, which genuinely need a key. Together they mean the key
is present in the app's own process environment at the moment of harvest, which
is the environment every unprotected child in §0.1 inherits.

### 7.G Under half of executions name a model

`model_used` is non-empty in **1,004 of 2,188** rows. Adjacent to
`model-and-effort-selection`, noted here only because a payer audit would want to
join on it.

### 7.H What this path CLEARED

- **Bedrock/Vertex routing is absent by construction, not by accident.**
  `apply_provider_env` (`cli_args.rs:19-28`) is a literal no-op — a `match` whose
  only arm is `_ => { let _ = (cli_args, profile); }`. No code path sets a
  cloud-provider switch. The risk in §7.A is *inheritance* from the operator's
  shell, not emission by the app.
- **The main execution engine is protected, in the right order.**
  `cli_process.rs:606` and `:355` both strip after overrides; 11 spawn regions
  were verified compliant.
- **The three regression tests are real** and do fail-inject
  (`cli_process.rs:779-781` poisons all three variables before asserting).
- **Model-API keys and connector credentials share one store, correctly.** Both
  live in `credential_fields` under per-field AES-256-GCM
  (`credentials.rs:1437`). `external_api_keys` is the *opposite direction* —
  inbound capability tokens the app mints, stored as `key_hash` + `key_prefix`,
  never encrypted and never recoverable. The brief's question *"is the same key
  used for reading usage and making calls?"* answers **no, and not because
  anybody separated them** — the read-only admin key has no reader at all (§7.E).

---

## 8. Gaps in the primitives

### 8.1 `force_subscription_auth` takes a `Command`, so it can be called at the wrong time

Its correctness depends entirely on *when* the caller invokes it, and its type
cannot express that. The contract lives in a doc comment (`:44`).

### 8.2 There is no constructed-environment door for the Claude CLI

`sanitized_env` exists and is applied to other CLIs. The one that spends money
inherits wholesale and subtracts.

### 8.3 `CliArgs` conflates two kinds of removal

`env_removals` holds hygiene names (`CLAUDECODE`, `DISABLE_PROMPT_CACHING*`) and
is applied by every hand-rolled spawn site; the auth names live in a separate
constant applied by a separate function. One of these lists is load-bearing for
money and the other is not, and they look identical at the call site.

### 8.4 No execution row can name its payer

No column, no enum, no type. §0.3.

### 8.5 The reserved list has no provenance marker

Nothing in the code says *which* vendor document the three names came from or
when it was read, so nothing tells a future reader that the list needs
re-deriving when the vendor's resolution order changes. Compare
`cli_args.rs:186` and `:344`, which *do* date their reasoning to specific CLI
versions.

---

## 9. The missing gate — a reasoned decline, with the numbers, and the instruments that do fit

**Declined.** No census rule is proposed for this leaf, and the existing
`unpinned-billing-account-spawn` already ratchets the adjacent condition. §9.2
gives the two validation runs that refused my candidate (50% precision, then a
structural zero); §9.3 specifies the three instruments that do fit.
(`merge-published-rules.mjs` will report *"no ```json block in this path"* for
this document — that is the intended state, the same one
[`secret-leak-scanning`](./secret-leak-scanning.md) is in.)

### 9.1 Prefer the type — and it subsumes three deviations at once

Against the seven qualifications:

- **Q5 (withholding beats requiring)** — do not hand callers a `Command`. Make the
  only constructor `spawn_headless_claude`-shaped: it takes the prompt, model,
  args, and cwd, and it owns `env_clear()` + allowlist + strip-last internally.
  Then §0.1 (missing strip) and §0.2 (wrong order) both become **unspellable**,
  because there is no point at which a caller holds a `Command` to mutate.
- **Q3 (count the construction sites)** — six bypass today. All six pass argv and
  a cwd and nothing exotic; four already build their `CliArgs` through
  `build_cli_args`. This is a migration, not a redesign.
- **Q6 (withhold the dangerous freedom, not the answer)** — the freedom to remove
  is *assembling the child's environment*, not *choosing the model or the
  arguments*. Callers keep everything they actually use.
- **Q7 (relaxing a type is inert where the caller supplies the bad value
  voluntarily)** — this is why §7.B cannot be typed away: the vault field name is
  operator data crossing a serialization boundary. The type fix reaches the
  *spawn*, not the *injection*; §7.B needs the allowlist, not a newtype.
- **Q1, Q2, Q4** — no bearing.

Where types cannot reach, per doctrine: **"in an ambient environment variable"** —
this leaf is the canonical instance, and the escape is not a better type on the
value but a constructor that never consults the ambient environment at all.

### 9.2 The census rule — DECLINED, with the numbers

I built the one signal the existing registry cannot see and it failed validation
twice. Both runs are reported.

The existing rule `unpinned-billing-account-spawn` (`headless-model-call.md`,
baseline 5 files / 5 matches) detects the **absence** of the strip token. It is
order-blind by construction: any region containing `force_subscription_auth`
anywhere between `Command::new` and `.spawn()` reads as compliant. So §0.2 is
invisible to it, and a rule targeting order would have **zero site overlap** —
the two populations are disjoint by definition.

**Attempt 1 — strip-before-override, loose middle.** Anchored on
`force_subscription_auth(&mut X);` followed, within 1,500 characters and before
any `spawn`/`Command::new`, by an `env_overrides` loop or a variable-key `.env(`.

- violating: **2 files / 2 matches**
- positive control (same anchors, order inverted): **3 files / 4 matches**
- the anchor partitions 5 files / 6 matches

**Precision 1/2 (50%).** Hand-verified both: `src/companion/athena_reaction.rs:567`
is the true positive; `engine/src/cli_process.rs:782` is a **`#[cfg(test)]`
fixture**, and the match only exists because the 1,500-character window ran past
the end of one test function into the next one's `.env(` call. Two failures at
once — the engine cannot exclude test modules (a limitation the doctrine already
records, at 5-of-9 on a prior refusal), and *my matcher did not compose*.

**Attempt 2 — same, with a function-boundary guard** added to the negative middle
(`\n\s{0,4}\}\n`):

- violating: **0 matches**
- positive control: **1 match** (down from 4)

The guard removed the false positive and the true positive together, and gutted
the control, because closing braces at ≤4 indentation occur inside the very loops
the pattern must cross. **A rule with zero matches fails structurally**, so this
is not a shippable state either.

There is no setting between the two that isolates the single real site. **Refused
at 50% precision**, alongside the corpus's recorded refusals at 22%, 44%, and 71%.

Excluding `engine/src/cli_process.rs` would restore precision to 1/1 — and would
be wrong: that file *defines* `force_subscription_auth` and holds 2 of the 4
compliant regions, so the exclusion would blind the rule to the primary engine to
hide a fixture. A stale-exemption trap wearing a precision improvement.

### 9.3 What to build instead — three instruments, each for a condition the census cannot hold

1. **Ordering → a Rust test.** A test can call the real function and observe the
   resulting environment, which is the thing that matters:

   ```rust
   #[test]
   fn every_claude_spawn_helper_strips_after_its_last_override() {
       // Build via each public spawn helper with an env_override that sets
       // ANTHROPIC_API_KEY, then assert the composed Command's env does not
       // contain it. Fails today for athena_reaction's ordering.
   }
   ```

   This stays meaningful at zero violations forever, which a ratchet cannot.

2. **List completeness → an inventory check, not a count.** The doctrine's fourth
   "where types cannot reach" case is *a thing that was never declared*, and the
   only instrument that finds it is an inventory of what **should** exist compared
   against the registry. Concretely: a `scripts/check-billing-env-coverage.mjs`
   holding the vendor's documented resolution order as data, asserting every entry
   appears in `CLI_SUBSCRIPTION_RESERVED_ENV` **or** in an explicitly-reasoned
   exemption list — and **exiting 2 if it parses fewer than N names out of the
   Rust constant**, so a refactor that renames the constant fails loudly instead
   of passing vacuously. This is the `check-csp-hosts.mjs` shape, for the same
   reason: an allowlist-covers-a-set condition cannot live in the census.

3. **Payer attribution → a column, then a gate.** Until an execution row can name
   its billing account, no instrument can verify the outcome — only the
   mechanism. The column is the prerequisite; the gate is downstream of it.

---

## 10. Composing with the neighbours

- **`credential-injection-into-child`** prescribes `.env_clear()` + `sanitized_env()`
  and warns that *"a denylist over what you add cannot remove what the child
  inherits."* This leaf is the strongest confirmation of that clause in the repo,
  and the two documents agree completely. **Following its prescription fixes
  §0.1, §0.2, and §7.A at once** — worth stating because that path's own baseline
  (`wholesale-inherited-child-env`, 10 files / 13 matches) does not include the
  billing framing.
- **`headless-model-call`** prescribes *"give the call an owner, a ceiling, a
  payer, a named model and a meter — as arguments, not as ambient facts."* §0.3
  measures the "payer" half of that clause and finds it absent from storage as
  well as from arguments. No conflict; this document supplies the number.
- **`llm-spend-accounting`** prescribes taking the number from the vendor and
  keeping it nullable. §7.D is a **correction owed to it** — see §12.1.
- **`spend-ceilings`** prescribes comparing a limit against exactly the rows the
  operator is shown. Composes with a warning: a ceiling that compares against
  `SUM(cost_usd)` is sound (that column works), but any ceiling denominated in
  **tokens** would compare against zero on every row and never fire.

---

## 11. Deferred fixes filed

All of §7.A, §7.B and §7.C touch a security control whose current setting may be
deliberate, and changing what the app strips from the operator's own environment
could break a working local setup. **Written down, not applied** — see
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) entries
**#79** (extend the reserved list to the full documented resolution order;
allowlist the vault-injection guard) and **#80** (route the six bypassing spawn
sites through the front door; fix the `athena_reaction` ordering).

§7.D (the token-position bug) is a one-line-per-field change with no destructive
first run, but it alters what a live surface displays, so it is filed rather than
applied, as **#81**.

---

## 12. Corrections

### 12.1 Deferred-fixes #24 is wrong on its headline, and right about a narrower thing

#24 records that **"every run records $0"**, that `parser.rs:340-341` reads token
fields from the wrong position, *"present in 0 of 314 rows, against $2,036.26 of
actual spend."*

Measured against the 2026-08-17 backup (2,188 executions):

- `cost_usd` is populated in **1,970 of 2,188 rows** and sums to **$2,036.2571**.
  So the $2,036.26 figure #24 cites as *actual spend the ledger failed to capture*
  **is the sum of the ledger column itself.** The cost half works.
- The broken half is **tokens**: `input_tokens > 0` in **0 of 2,188**,
  `output_tokens > 0` in **0 of 2,188** — while `cache_read_tokens > 0` in **585**,
  because those reads have a `usage`-first fallback and the token reads do not.

So the defect is real, the cited line numbers are right, and the *symptom* is
misstated in a way that matters: an operator reading #24 would look at a
dollar-denominated dashboard, see numbers, and conclude the fix had landed.

The sharper statement is the one the data supports: **within a single struct
literal, the fields that consult `usage` are populated and the fields that do not
are zero — and a second parser of the same event, `llm_spend.rs:100-101`, which
reads `usage.input_tokens`, populates 85 of its 89 rows.** That is a controlled
experiment sitting in production data, and it is much stronger evidence than the
original claim.

This is also the doctrine's own warning firing: *"a wrong number that agrees with
you is invisible until someone measures the same thing for a different reason."*
#24 was measuring cost, found zeros in the token columns, and generalised.

**Correction owed to `llm-spend-accounting.md`**, whose §0 headline and
`unknown-money-as-zero` rule are framed around money-as-zero: the money is not
zero here; the *tokens* are, and the discriminator is the JSON key path, not a
`unwrap_or(0)`.

### 12.2 `sides: "server"` — UPHELD, and the mechanism is worth naming

Every artifact is server-side Rust: the constant, the applier, all six
unprotected sites, the ordering violation, the injection guard, the parser, the
schema gap. The frontend contributes nothing — and *cannot*, because a child
process's environment is not a thing a renderer can observe or influence.

That is the same structural reason the doctrine records for the two upheld
`sides: "client"` leaves, running the other way: **the client never sees the
process table.** This is the second recorded upholding of `sides: "server"`, and
naming the mechanism is what distinguishes a correct label from a lucky one.

### 12.3 `convergence: "mixed"` — HOLDS, but splits by clause and the label cannot carry it

Cohort established for this leaf at measurement time: of the five siblings,
**two drive the Claude CLI** (`ascent`, `vibeman`); the other three do not spawn
it at all.

Both spawners independently reached the same principle **and the same weakness**:

- `ascent/src/lib/llm/claude-cli.ts:99-100` —
  `const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; // force subscription auth (not pay-per-token)`
  A file-header comment (`:2-11`) explains the subscription-vs-credits model in
  the same terms Personas' constant does.
- `vibeman/src-tauri/src/commands/claude_cmds.rs:324` and `:726` —
  `cmd.env_remove("ANTHROPIC_API_KEY"); // Remove API key to force web subscription auth`,
  in both cases **after** the `for (key, value) in &env { cmd.env(key, value); }`
  loop — i.e. vibeman gets the ordering right at both sites.

So, clause by clause:

| clause | verdict |
|---|---|
| strip an auth env var to force subscription billing | **converged** — 3 repos, 2 languages |
| completeness of the list | **converged on the disease** — vibeman 1 name, ascent 1 name, Personas 3, against ≥17 selectors |
| construct rather than subtract | **0 of 3** — nobody does; ascent's `{...process.env}` is the same inheritance |
| strip applied last | vibeman 2/2, ascent n/a (single delete), Personas 11/12 — **Personas is the only one that documented the rule and the only one that broke it** |
| record the payer | **0 of 3** |

`mixed` is therefore the right *word* and an unusable *verdict* — the same failure
the doctrine records for `cross-device-pairing`: **a single enum field cannot
carry a result that splits five ways.** Reported as upheld-on-a-technicality.

Two doctrine notes apply and pull in opposite directions. Agreement is the
weakest signal the oracle produces — one author reached for the same answer three
times. But **vibeman is this repo's ancestor** (dated twice, on two prior leaves),
and its 1-name list predates Personas' 3-name list, so Personas did not converge
with vibeman — **it inherited vibeman's shape and widened it by two names without
re-deriving it.** An ancestor's choice is a constraint, not a corroboration.

### 12.4 Corrections to my own brief

- **"Deferred-fixes #24 is the strongest lead in the register and it is yours to
  verify."** — Verified and **overturned** (§12.1). It was a strong lead; its
  headline was wrong.
- **"If a cost surface authenticates to a billing API to reconcile that, the two
  halves of this leaf meet."** — The billing-API credential exists
  (`builtin-anthropic-admin`, §7.E) and has **zero consumers**, so the halves do
  not meet. The finding is the disconnection, not the connection.
- **"Whether the same key is used for both reading usage and making calls."** —
  **No**, and not by design: the admin key is never read by anything, and the CLI
  path deliberately uses no key at all. The keys that *do* spend
  (Gemini via `ocr/mod.rs`) are a separate connector credential. One of those
  paths takes `api_key: String` **straight across the IPC boundary from the
  frontend** (`ocr/mod.rs:145-148`) rather than resolving it from the vault —
  adjacent to `secret-display-and-transfer` and reported here for that path's
  benefit, not gated in this one.
- **"Establish which billing/usage APIs the app authenticates to."** — Exactly
  one (`api.anthropic.com/v1/organizations/usage_report/messages`), plus PostHog
  and LangSmith/Langfuse/Helicone connectors which are the operator's own
  product-analytics and tracing services, not this app's billing.
- **"Spend history is exactly the kind of evidence the purge destroyed… if you
  find zero rows in the live file, you are looking at the wrong file."** —
  Confirmed and heeded: all row counts here are from the backup, dated
  2026-08-17, and are **unreproducible against the live database**.

### 12.5 A measurement of mine that disagreed with a second one, and how it resolved

My region-scoped matcher reported **25** unprotected spawn sites. A second,
independent full read reported **4**. Neither was right.

Hand-verifying all 25 found **19 false positives** — `git`, `npx tsc`,
`powershell`, and `--version` probes — because my "is this the Claude CLI?" test
matched the substring `claude` anywhere in a 1,200-character context window, and
in a file named `competitions.rs` (13 of the false positives) that word is
everywhere in prose and identifiers. The second read missed both `ocr/mod.rs`
sites because it followed the strip-token trail rather than enumerating spawns.

**Hand-verified answer: 6.** Recorded because the disagreement was the finding, and
because my word list came from imagination rather than from the tree — the exact
error the doctrine warns produces distortion at *both* ends of a measurement.
