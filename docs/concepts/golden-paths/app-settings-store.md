# Golden path — App settings store

> Situation node: `data-persistence/data-modeling/app-settings-store` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `2a874e692`.
> Sweep size: the whole Rust tree (**963 `.rs` files** — exactly `rust.files` in
> [`shared-facts.json`](../shared-facts.json), and exactly what the census walker reports) ·
> `src/**` (**4,829 `.ts`/`.tsx`**, `frontend.tsFiles`) · the 1,569-line key registry parsed
> attribute-by-attribute · **147 settings call sites across 52 files**, resolved by reading each
> file's `use` statements rather than by grepping an alias (a naive `repo::` grep returns 211 and
> most of the surplus is `messages::delete`, `personas::delete` and a `HashMap::get`) · and a
> **read-only copy of the operator's live 347 MB `personas.db`**, whose `app_settings` table holds
> **32 rows**. No `cargo` was run.
> Dimensions: **security · function · resilience · code-quality**. **Two-sided:** the Rust registry,
> the TypeScript read/write surface, and the contract between them.
> A **convergence sweep** was run against `brainiac` (Rust · sqlx · Postgres), `personas-cloud`
> (TS · better-sqlite3) and `personas-web` (TS · Supabase). It returned a **null result on the
> central mechanic** and that null changes what this document is allowed to claim; §6 has the ruling.
>
> **Sibling boundaries, settled in prose.**
> [**Client state persistence**](./client-state-persistence.md) owns the prior question — *who is the
> authority*, localStorage vs the backend, the mirror and backend-authority patterns. This path starts
> where that one ends: you have decided the backend owns the value. It owns the key, the encoding, the
> default, the type recovery on read, and what happens when the value's shape changes. Where that path
> says "register every backend key in `settings_keys.rs`", this path measures what the repo does when
> nobody does.
> [**Persisted model struct**](./persisted-model-struct.md) owns the shape a row is read into. **This
> table has no struct** — it is `(String, String, String)` — so that path's entire nullability
> discipline is inapplicable here *by construction*, and that is itself the finding: a key/value table
> opts out of the type system that path defends, and every guarantee it wins with `Option<T>` and
> `CHECK (col IN (…))` has to be re-won here in a hand-written validator. `SettingsAuditEntry`
> (`core/src/models/settings_audit_log.rs`) is the one struct in this territory and it obeys that path.
> [**JSON blob column**](./json-blob-column.md) owns what goes *inside* a JSON-bearing value and its
> decode policy. **8 of the 32 live rows hold JSON**, so it governs those decodes. This path adds one
> datum that path did not have, and it is a correction in the repo's favour — see §6.
> [**Timestamp storage**](./timestamp-storage.md) owns `updated_at`'s representation. This path
> measured it and hands over one fact: **all 32 live rows are RFC 3339, while the column's DDL default
> is `datetime('now')`**, which is a different format. The default never fires because
> `repos/core/settings.rs:112` always supplies the value — so the schema carries a second, dormant
> timestamp format that would appear the first time anyone writes a row without it.
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "Add a setting for X" / "make this configurable" / "add a toggle in Settings"
- "Where do I put the user's API key / base URL / model name?"
- "Why didn't my toggle stick?" / "the setting saves but nothing happens"
- "Read the concurrency cap / retention window / autonomy flag from the backend"
- "This setting's shape changed — how do I migrate the stored value?"
- "What does it mean if the row is missing?"

If you are about to type `pub const SOMETHING_KEY: &str = "…"`, `settings::get(pool, …)`,
`setAppSetting('…', …)`, `.parse::<u32>()` on a settings value, or `== Some("true")` — you are in
this situation.

## 2 The one way

**Declare the key once, in `src-tauri/db/src/settings_keys.rs`, and declare it completely — the
constant, the `ALLOWED_KEYS` entry, a paired `<KEY>_DEFAULT`, a `validate_value` arm, and an
`audit_category` arm — in a single change, then never spell the literal again anywhere else.**
A key not in `ALLOWED_KEYS` is *rejected* by `repos::core::settings::set` (`:96`), so a key you read
but forget to register is not a warning, it is a **feature that can never be turned on**; that has
already happened three times in this repo and twice it is still live (§7 P0). Write through
`repos::core::settings` (never raw SQL) so validation, the audit trail and the deprecation
breadcrumb all fire for internal Rust callers too, and through the `set_app_setting` command from the
frontend so the 64 KB ceiling and the `settings-changed` broadcast fire as well. **Encode the value
as the narrowest string the key can carry** — `"true"`/`"false"` for a bool, a bare decimal integer
for a number, a closed lowercase token for an enum, JSON only when the value is genuinely a document
— and **validate that encoding on write**, in `validate_value`, against the *consumer's own type*
where you can import it (`validate_json_as::<T>`), because a write is the last moment the bad bytes
are still in memory and the caller is still on the stack. Read it back through the narrowest
accessor that exists — `autonomy::global_enabled` for an autonomy flag — and where none exists, put
the decode and the `<KEY>_DEFAULT` fallback in **one function next to the key**, not at each call
site: the tree currently holds **six different spellings of "is this bool true"**. When a setting's
shape changes, **keep the key and version the document** (`mastermind.layout.v1` has held a
`version` field that moved 1 → 2 while the key stayed put), and tolerate-and-drop unknown sub-shapes
rather than throwing. And the one absolute: **a credential is not a setting.** An API key, token,
password or pairing secret goes to the OS keyring or the AES-256-GCM vault — `app_settings.value` is
plain `TEXT` with no encryption anywhere on its path, and this repo already ships the correct split
in the same file as its worst violation (§6).

## 3 Mandated primitives

**Exist today — use them:**

- **`src-tauri/db/src/settings_keys.rs`** — the registry. **87 exact keys + 7 prefix families**,
  `validate_key` (`:843`), `validate_value` (`:874`), `deprecated_replacement` (`:1067`),
  `audit_category` (`:1154`). Its module doc (`:1-21`) is the contract; §7 measures how far the file
  has drifted from it.
- **`src-tauri/db/src/repos/core/settings.rs`** — `get` / `set` / `get_batch` / `get_by_prefix` /
  `delete`. **Validation is enforced here, not at the command layer** (`:96-97`), deliberately, so an
  engine tick cannot bypass it. `audit_setting_change` (`:25-62`) writes the history row and redacts
  the `api_keys` category **structurally**, because the shared pattern-based sanitizer "cannot
  recognize a BARE token value" (`:39-44`).
- **`src-tauri/src/commands/infrastructure/settings.rs`** — `get_app_setting` /
  `get_app_settings_bulk` / `set_app_setting` / `delete_app_setting`. Auth-checked,
  `MAX_SETTING_VALUE_SIZE = 64 KB` (`:14`, `:129`), and `emit_settings_changed` (`:40`) broadcasting
  a **key-only** payload — the value is omitted because "settings can hold secrets … and the event
  bus is broadcast to every window" (`:22-25`). That comment is the repo diagnosing its own §7 P0.
- **`src/api/system/settings.ts`** — the four IPC wrappers, all through `invokeWithTimeout`.
- **`src/hooks/utility/data/useSettings.ts`** — `useSettings(keys)` + `getAppSettingCoalesced(key)`.
  A microtask coalescer (`:80-93`) collapses every read in one tick into one bulk invoke, and the
  hook re-fetches on `settings-changed` (`:182-190`). **Use this, never a fan-out of `getAppSetting`.**
- **`src/hooks/utility/data/useAppSetting.ts`** — single key, load + save + `validate?` predicate.
  Note its semantics: a value that fails `validate` is **discarded in favour of the default and
  logged** (`:50-52`) — the right policy, and the only place on the frontend that has one.
- **`engine/src/autonomy.rs:157-162` — `global_enabled(pool, Action)`.** The one typed accessor in the
  tree; its own doc comment says it exists to replace "the repeated `settings::get(..).as_deref() ==
  Some("true")` boilerplate at every subscription tick". It covers the 21 `Action` keys. Everything
  else still hand-rolls (§7).
- **`src-tauri/src/commands/infrastructure/qwen_engine.rs:32-57`** — **the credential split, done
  right.** The API key goes to `keyring::Entry` via `engine/http_engine/secrets.rs:28-33`; only the
  non-secret `base_url` goes to `app_settings`; and `get_qwen_status` carries the comment "**Never
  returns the API key itself**". Copy this whenever a "setting" turns out to be a secret.
- **`src/features/teams/sub_mastermind/lib/layoutStore.ts`** — the shape-migration reference:
  `LAYOUT_KEY = 'mastermind.layout.v1'` stable (`:39`) while `LAYOUT_DOC_VERSION` moves (`:41`),
  `migrateAuthored` as the in-band v1→v2 (`:174`), `parsePanels` (`:184`) dropping panels on a
  `specVersion` this build does not know rather than retaining "a poison value a renderer would have
  to defend against".

**Do not exist — this path defines them:**

- **A `Setting<T>` descriptor** replacing the five-part hand-assembled key declaration. See
  "Prefer a type over a gate" below; this is the fix for four of the five deviation classes.
- **`settings::get_bool` / `get_u32` / `get_json::<T>` taking that descriptor.** The absence is why
  94 read sites hold 5 recovery families and 6 boolean spellings.
- **A generated TypeScript key module.** Today `getAppSetting(key: string)` accepts any string and a
  key name reaches the frontend only as a hand-typed literal.

## 4 Steps

1. **Ask first whether it is a secret.** If the value is an API key, token, password or pairing
   secret, **stop** — this path does not apply. Route it to `keyring::Entry`
   (`qwen_engine.rs:32-49`) or `create_credential`, and keep only the non-secret half (base URL,
   model name, "is configured") in `app_settings`. `value` is plain `TEXT`; there is **no**
   encryption hook anywhere on the settings write path.
2. **Ask the type-over-gate question here** (see the dedicated section below). Today the answer costs
   you five separate edits in one file; write all five, in one commit, before you write any consumer.
3. **Declare the key constant** in `settings_keys.rs`, snake_case, with the unit in the name
   (`_DAYS`, `_MS`, `_HOUR`, `_USD`), and a doc comment saying **what unset means**.
4. **Add it to `ALLOWED_KEYS`.** This is the step whose omission is silent-until-shipped: `set`
   rejects an unregistered key, so the toggle appears in the UI and does nothing.
5. **Add a paired `<KEY>_DEFAULT` constant** of the real Rust type (`bool`, `u32`, `f64`, `&str`).
   The module doc requires this; **56 of 94 key families do not have one** and their readers inline a
   literal instead.
6. **Add a `validate_value` arm.** A bool → the literal `"true"`/`"false"` (24 keys do this today);
   a number → `parse::<u32>()` with the range; an enum → an exhaustive `match` on the tokens; a JSON
   document → `validate_json_as::<TheConsumersOwnType>` when you can import the type,
   `validate_json_wellformed` when you cannot. **A key with no arm accepts any string**, and 34 do.
7. **Add an `audit_category` arm**, or add the key to `AUDIT_EXCLUDED_KEYS` if it is engine
   bookkeeping (a cursor, a `*_last` stamp). Falling through to `_ => "config"` is legal and 6 keys
   do it, but it is a decision, not a default.
8. **Read it through the narrowest accessor.** `autonomy::global_enabled` if it is an `Action` flag.
   Otherwise write **one** `fn <key>_enabled(pool) -> bool` next to the consumer, using the
   `<KEY>_DEFAULT` constant, and have every caller use that. Never inline `== Some("true")` twice.
9. **On the frontend, read through `useSettings` / `getAppSettingCoalesced`**, never a fan-out.
   Coerce field-by-field with a per-field fallback; never `JSON.parse` straight into state.
10. **If the value is a JSON document, put a `version` integer inside it and keep the key stable.**
    Migrate in-band on parse (`layoutStore.ts:174`), and drop sub-objects whose version this build
    does not understand.
11. **Then stop.** No second constant holding the same literal. No `.parse::<T>()` at a call site
    that the accessor could own. No `settings::set(key, "")` as a "cleared" sentinel — `delete`
    exists and is idempotent (`settings.rs:209-239`).

## 5 Anti-patterns

- **Putting a credential in `app_settings` — 3 registered keys, and 1 of them is live in the
  operator's database right now.** `OLLAMA_API_KEY` (`settings_keys.rs:28`), `LITELLM_MASTER_KEY`
  (`:34`), `BROWSER_BRIDGE_PAIRING_TOKEN` (`:70`). The value column is `TEXT NOT NULL`
  (`schema.rs:595-599`) and the settings module has **zero** references to `crypto`, `encrypt` or
  `decrypt` — measured across `repos/core/settings.rs`, `settings_keys.rs` and
  `commands/infrastructure/settings.rs`. See §7 P0-1 for the full shape.
- **Declaring the key literal a second time — 10 sites across 8 files.** `redact.rs:34`,
  `context_fidelity.rs:18`, `byom.rs:22`, `model_routing.rs:22`, `skills_sidecar/mod.rs:33`,
  `skill_scratchpad.rs:51`, `obsidian_brain/mod.rs:44,45,46`, `fleet/pairing.rs:38`. The tell is
  `pairing.rs:36-37`, whose doc comment reads *"Registered in
  `db::settings_keys::FLEET_COMPANION_DEVICES`"* — the author knew, and wrote a prose cross-reference
  where an `use` would have made the drift impossible. Two of the ten are **not** registered, and
  those two features are inert (§7 P0-2).
- **Reading a key you never registered.** `set` rejects it (`settings.rs:96`), `get` only
  `tracing::warn!`s (`:70-72`), so the feature ships, the toggle does nothing, and the only evidence
  is a log line at boot. The repo has recorded this bug twice in its own source — `AUTONOMOUS_DELIBERATION`
  at `settings_keys.rs:793-795` and `MODEL_ROUTING_RULES` at `:1409-1414` — and fixed each with a
  one-off test pinned to that single constant.
- **Recovering a bool by string comparison at the call site — 18 matches across 15 files, in six
  spellings.** `.as_deref() == Some("true")` (3) · `matches!(…, Ok(Some(v)) if v == "true")` (5) ·
  `.map(|v| v == "true")` (3) · `.map(|s| s.trim() != "false")` (2, inverted, for the two keys that
  default ON) · `match { Ok(Some(v)) => v == "true", Ok(None) => false, Err(e) => … }` (1) ·
  `.map(|v| v == "true" || v == "1")` (1). They are not equivalent: only `daemon/runtime.rs:360-370`
  distinguishes a **DB error** from "off"; the other 17 collapse `Err` into `false` with `.ok()`. And
  `runner/mod.rs:1468` accepts `"1"`, a token `validate_value` would have **rejected on write** — so
  the reader is more permissive than the writer, for a value only the writer can create.
- **A boolean-shaped key with no boolean validator.** `HEALTH_DIGEST_ENABLED` and
  `DIRECTOR_BRAIN_ENABLED` are read with `== "true"` (`director.rs:118`, `director_brain.rs:61`) but
  are absent from the 24-key `"true" | "false"` arm, so `set(…, "1")` succeeds and silently means
  *off*.
- **Inlining the default instead of naming it — 18 inline literals against 11 named `*_DEFAULT`
  uses.** `health.rs:75` and `:168` both write `unwrap_or_else(|| "claude_code".to_string())` for
  `CLI_ENGINE`, a key with no `_DEFAULT` constant; `runner/mod.rs:1232` inlines
  `"http://localhost:11434"`. Two copies of one default in one file is how the third copy gets a
  different value.
- **Mirroring a Rust default in TypeScript with a comment instead of a mechanism.**
  `processActivitySlice.ts:135-140` (`DEFAULT_MAX_PARALLEL_EXECUTIONS = 10`) and
  `LimitsSettings.tsx:17-23` (`CONCURRENCY_MIN/MAX/DEFAULT = 1/20/10`) both say *"Mirrors the Rust …
  keep in sync"* and **both name `src-tauri/src/db/settings_keys.rs`, a path that does not exist** —
  the crate split moved the file to `src-tauri/db/src/settings_keys.rs`. The values agree today; the
  only thing tying them is a pointer into empty space.
- **Writing an empty string as a "cleared" sentinel.** `execution_review.rs:612` `clear_retry` does
  `settings::set(RETRY_KEY, "")`, and `retry_attempts_for` (`:593-605`) reads it back with
  `serde_json::from_str`, which fails on `""` and falls through to `0`. It works **by accident** —
  the corrupt-value path and the cleared path happen to coincide. The live database holds that row at
  length 0 right now. `json_valid('') = 0` (verified on the shipped engine, SQLite 3.50.4), so the
  moment anyone adds this key to `validate_value`'s JSON arm — which is the documented pattern for
  every other JSON key — `clear_retry` starts failing. `delete` is the correct verb.
- **Exceeding a ceiling only one of the three writers enforces.** `MAX_SETTING_VALUE_SIZE` (64 KB)
  lives *only* in `commands/infrastructure/settings.rs:129`. `repos::core::settings::set` — the layer
  chosen for validation precisely "so that internal Rust callers cannot bypass" it (`:91-94`) — does
  **not** check size. `portfolio.rs:477` writes `dev_tools_cross_project_metadata` through the repo,
  and that row is **46,105 bytes in the live database, 70% of a ceiling it is not subject to**, and it
  grows with the project count. When it crosses 64 KB, nothing breaks — until the frontend tries to
  save it.
- **A fan-out of `getAppSetting` on mount.** `useSettings` / `getAppSettingCoalesced` exist to make
  that one invoke. `ConfigurationPopup.tsx:67` was already fixed this way; copy it.
- **`get_by_prefix` without `validate_key`.** `get`, `set` and `delete` all validate (or at minimum
  warn); `get_by_prefix` (`:195-207`) does neither, so a caller can sweep any prefix, including one
  that matches nothing because it was misspelled, and get a silent empty vector.

## 6 Evidence

**Adoption:** 87 exact keys + 7 prefix families · 38 paired `_DEFAULT` constants · 60 key families
with a `validate_value` arm (24 bool-token, 18 JSON-validating, the rest numeric/enum) · 15
audit-excluded keys + 2 excluded prefix families · 147 Rust call sites / 52 files · 57 TypeScript
references / 15 files · 32 live rows.

- **`src-tauri/src/commands/infrastructure/qwen_engine.rs:32-57` — copy this one.** The whole
  credential decision, correct, in 25 lines: secret → keyring, non-secret → `app_settings`, status
  command returns `configured: bool` and never the key. It is the answer to §7 P0-1, and it is
  rendered by `QwenKeyRow` **inside `ByomApiKeyManager.tsx`** — the correct implementation and the
  violation are the same file and the same screen.
- **`engine/src/config_merge.rs:227-244` — copy this read.** A corrupt `GLOBAL_MODEL_PROFILE` gets a
  `tracing::error!` carrying the key, the parse error **and the user-facing remediation** ("Re-save
  the global model profile in Settings to fix this"), then falls back to `None`. It never writes
  back, never swallows, and never invents a value. Every other JSON read in the tree should look like
  this.
- **`settings_keys.rs:988-1014` — write-time validation against the consumer's own type.** Eight keys
  are validated with `validate_json_as::<T>` where `T` is the struct the consumer will parse, with
  the reasoning written down: *"a malformed blob is rejected at WRITE time instead of corrupting the
  store … The consumer parses the SAME type, so any value we reject here would also fail to load — no
  valid write is newly blocked."* **This is a correction in the repo's favour, and it belongs to
  [json-blob-column](./json-blob-column.md).** That path reports "`json_valid` used as a DDL
  constraint: **0** … the repo reached for the correct tool at the wrong end of the pipeline." For
  `app_settings` that is not true: 18 key families are validated at write time, 8 of them against the
  real type — stronger than `json_valid`, which only proves well-formedness. The KV table is the one
  place the repo already does what that path prescribes.
- **`repos/core/settings.rs:39-49` + its test at `:461-489`** — the `api_keys` category is redacted
  **structurally**, not by pattern, because the shared sanitizer "cannot recognize a BARE token
  value"; the test proves a raw `ghp_…` never reaches the audit table. The reasoning is exactly
  right — and it is applied to the *copy* while the row itself stays in clear.
- **`settings_keys.rs:1409-1421`** — the one test in the tree that ties a shadow constant back to the
  registry (`assert_eq!(MODEL_ROUTING_RULES, crate::model_routing::MODEL_ROUTING_RULES_KEY)`), with
  the incident it encodes written above it. It is the right idea at the wrong scale: one test per
  constant, added after each incident, three incidents in.
- **`settings_keys.rs:1130-1136`** — the best-reasoned exclusion in the file: `MASTERMIND_LAYOUT` is
  audit-excluded because it is "written debounced on every island drag … UI-view state, not an
  auditable config change". Naming *why* a key is not audited is what makes the History tab
  trustworthy.
- **`layoutStore.ts:38-41, 174-203`** — key stable, doc version moving, in-band migration,
  tolerate-and-drop for unknown sub-versions. **One caveat worth stating:** the key literal is
  `mastermind.layout.v1` while `LAYOUT_DOC_VERSION` is `2`. The comment at `:38-39` states the right
  rule ("The key is stable across doc versions; the `version` FIELD is what moves") — so the `.v1` in
  the name is now actively misleading, and it and `mastermind.scene.v1` are the **only 2 of 94 key
  families** not in plain snake_case.

### Convergence — what three sibling repos did without reading this

Run 2026-08-14, read-only. **The headline is a null result, and it is load-bearing.**

**No sibling has a key/value settings table, and no sibling has a key registry.** Not one. So the
central prescription of this document — *one central allow-list of legal key names, with per-key
value validation* — was **reinvented nowhere**, and by the [contract](../golden-path-contract.md)'s
own rule that makes it a **house convention rather than doctrine**. It must be marked as such, and it
is. But mark it with the lesson attached: **convergence measures discoverability, not whether a
requirement is real.** A key registry is what you get from reading the threat model of an IPC command
that accepts an arbitrary string key; it is not what you get from noticing breakage, because the
breakage it prevents is invisible. The evidence for the registry is not that siblings found it — it
is `personas-web`, which did not, and now holds **16 storage keys declared in 16 different files**,
**11 distinct type-recovery idioms**, and **three mutually incompatible boolean tokens** (`"true"` at
`stores/reviewVoiceStore.ts:33`, `"1"` at `components/tour/TourLauncher.tsx:67`, `"all"` at
`lib/analytics.ts:13`) for the same semantic question. That is the negative control, and Personas is
plainly ahead of it.

| Clause | Warrant | Evidence |
|---|---|---|
| **A credential never goes in the general config store** | **physics — 3/3, the strongest agreement in the sweep** | `brainiac` states it in the migration header itself: `migrations/0020_kb_publishing.sql:13-15`, where `secret_ref text` holds **the name of an env var**, never the token, resolved at `crates/brainiac-publish/src/lib.rs:133-139`; managed tokens are `token_hash bytea -- sha256(full secret)` (`migrations/0003_api_tokens.sql:15`) with the header "Secrets are never stored". `personas-cloud` keeps ciphertext in a physically separate table (`packages/orchestrator/src/db.ts:280-284`, AES-256-GCM at `packages/shared/src/crypto.ts:40`) and 17 process secrets in env. `personas-web` writes **zero** secrets to its client store. **This is the one clause Personas violates, and it is the one every sibling independently got right.** |
| A settings **value size cap** | **physics, and Personas is behind** | `personas-cloud/packages/orchestrator/src/schemas.ts:8-11, 61-68` — a four-tier ladder (`MAX_SHORT_STRING` 200 / `MAX_MEDIUM_STRING` 2000 / `MAX_PROMPT_BYTES` 50 KB / `MAX_LONG_STRING` 100 KB) bound to one `safeString(max)` factory that **also rejects control characters**. `brainiac` caps at the HTTP layer (`crates/brainiac-server/src/http.rs:126-145`, six named limits). Personas has one 64 KB number, at one of three writer surfaces (§5). |
| **Type recovery fragments without a typed accessor** | **physics — 3/3** | `brainiac` 5 idioms (two independent `env_parse` helpers, `resilience.rs:54` and `pipeline/src/worker.rs:65-70`); `personas-web` 11; Personas 5 families and 6 boolean spellings. Nobody who stores config as strings escapes this without an accessor. |
| **Defaults duplicate across the language boundary, and a comment does not hold them** | **physics — reinvented, including the failed mitigation** | `brainiac` has **seven** independent copies of the environment-tag default `"local"` (`brainiac-server/src/main.rs:251,:284,:303`, `brainiac-gateway/src/lighttrack.rs:93-96`, `console/instrumentation-client.ts:11`, `console/sentry.server.config.ts:13`, `console/sentry.edge.config.ts:11`) and two of the Plausible host — and its only cross-boundary mechanism is a prose comment at `crates/brainiac-server/src/http.rs:129-131`: *"Kept in sync by cross-reference; if the MCP consts move, move these too."* Personas wrote the same comment twice (`processActivitySlice.ts:137`, `LimitsSettings.tsx:18`) and **pointed both at a path that no longer exists**. Two codebases reached for a comment where a compiler could have held the line; one of the two comments has already rotted. |
| **`value TEXT` for every setting** | **contradicted** | `brainiac`'s one operator-config table, `sweep_schedules` (`migrations/0018_sweep_schedules.sql:15-25`), is keyed `kind text PRIMARY KEY` and then uses **typed columns** — `enabled boolean NOT NULL DEFAULT false`, `cadence_secs bigint NOT NULL` — getting type safety from Postgres and sqlx rather than from a registry-side validator, and its key allow-list from a compiler-checked `match` (`crates/brainiac-server/src/sweeps.rs:269-332`, 5 arms + an error arm) that provably matches the 5 seeded rows. **The TEXT-everything choice is Personas'; it is not the ecosystem norm, and everything in §7's type-recovery backlog is downstream of it.** |
| A **registry ↔ consumer gate** | **local calibration — nobody has one** | `brainiac` has **82 config env keys as loose string literals with no central list** and nothing in CI relating them to `.env.example`. `personas-cloud` has no `test` script and one test file. `personas-web` has no storage gate — **but it has the exact mechanism**, retargeted to a different registry: `.github/workflows/ci.yml:29` runs `scripts/check-i18n-coverage.mjs`, which loads each locale in a `vm` sandbox with `require` stubbed to throw and diffs key sets against `en`. That is the architecture §9 needs, already proven in a sibling. |
| **Config-value versioning / shape migration** | **Personas is ahead — 0/3** | Searched `schemaVersion|config_version|"version"` across all three: no sibling versions a stored config value, and `personas-web` writes zustand's `version: 0` into localStorage in a hand-written SSR script (`src/app/layout.tsx:103`) and then never reads it. Only Personas has a real in-doc version with an in-band migration (`layoutStore.ts:41,:174`). |
| **Env > DB > default precedence** | **not applicable here, and worth knowing** | `brainiac`'s DB is not in its config chain at all (CLI > env > inline default, documented only in rustdoc at `crates/brainiac-server/src/main.rs:192-197`). Personas layers env over DB in exactly two places (`skills_sidecar`, `skill_scratchpad`), both documented in place. Neither repo has a general answer. |

**A correction to a sibling, offered upstream:** `personas-cloud/packages/orchestrator/src/db.ts:37`
sets `LATEST_MIGRATION_VERSION = 9` while the migrations array holds a `version: 10` entry
(`:113-120`); both the early return at `:202` and the legacy bootstrap at `:135-138` strand it, so the
`cloud_deployments` budget columns never exist on any DB that reached v9 — while
`DeploymentCreateSchema` already accepts `maxMonthlyBudgetUsd` (`schemas.ts:278`). Deriving the
constant as `Math.max(...migrations.map(m => m.version))` would have made it unrepresentable. The same
shape of bug — a hand-maintained list that must agree with another hand-maintained list — is exactly
what §7 P0-2 is.

## 7 Deviations found

### P0-1 — a credential in a plaintext settings row, with the encrypted store one directory away

| Path | Defect |
|---|---|
| `settings_keys.rs:28`, `:34`, `:70` | **`OLLAMA_API_KEY`, `LITELLM_MASTER_KEY`, `BROWSER_BRIDGE_PAIRING_TOKEN` are registered settings keys holding raw secrets.** `app_settings.value` is `TEXT NOT NULL` (`schema.rs:597`). Grepped for `crypto`/`encrypt`/`decrypt` across `repos/core/settings.rs`, `settings_keys.rs` and `commands/infrastructure/settings.rs`: **0 hits in all three**, while `core/src/crypto.rs::encrypt_field` (AES-256-GCM, OS-keychain-bound master key) is used by `repos/resources/credentials.rs` and `repos/core/personas.rs`. |
| the operator's live database | **Confirmed present, not hypothetical.** `browser_bridge_pairing_token` exists, 32 characters, token-shaped, stored in clear, written 2026-06-12. (Shape only — the value was never read into this document, printed, or logged.) The two BYOM keys are absent only because this operator has not configured those providers. |
| `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:46-66`, `:116`, `:165`, `:199` | The BYOM panel declares `ollama_api_key` and `litellm_master_key` as provider entries, bulk-**reads** them into component state on mount, `setAppSetting`s them on save, and `getAppSetting`s one back in `handleTest`. **The plaintext secret crosses IPC into the renderer on every mount**, is rendered at `:505` when revealed, and is copied to the clipboard at `:531`. |
| `src/features/overview/components/health/popupFieldConfigs.tsx:6`, `:29` → `ConfigurationPopup.tsx:67`, `:89` | A **second** writer for the same two keys, from the health-check popup, declaring them `type: 'password'` and saving them with `setAppSetting`. |
| `engine/src/config_merge.rs:75-86` | `GlobalConfigContext::load` reads both BYOM keys from `app_settings` **on every persona config resolution** — so the blast radius is not only at rest. |
| — | **Contrast, and the fix, in the same file:** `ByomApiKeyManager.tsx:257-370` renders `QwenKeyRow`, which stores its API key through `set_qwen_credentials` → `keyring::Entry` (`qwen_engine.rs:41`, `http_engine/secrets.rs:28-33`) and whose status command is annotated "**Never returns the API key itself**". Three provider keys go to a plaintext TEXT column; the fourth, on the same screen, goes to the OS keyring. |

**What the repo already knows.** `commands/infrastructure/settings.rs:22-25` omits the value from the
`settings-changed` broadcast *because "settings can hold secrets"*; `repos/core/settings.rs:39-49`
redacts the `api_keys` category structurally *because the value **is** the secret*. Both defences
protect a **copy**. Neither protects the row. And the sibling sweep found **3 of 3** repos treating
"a secret never goes in the config store" as non-negotiable, `brainiac` writing the rule into the
migration file itself. This is the clause with the strongest external warrant in the document and the
one this repo breaks.

*Scope note, honestly:* this is at-rest plaintext in a local-first app whose database sits in the
user's own profile, next to `master.key`. It is not a remote-disclosure bug. It is a defence-in-depth
failure with a live, cheap, in-repo fix — and per the brief's context, the sibling finding that this
app wrote plaintext credentials to unpruned log files for 130 days is the reason "the encrypted store
exists and this path does not use it" is treated as a P0 here rather than a nit.

### P0-2 — two settings keys that are read but can never be written, so two features are inert

| Path | Defect |
|---|---|
| `core/src/redact.rs:34` + `src/lib.rs:1282-1288` | `REDACT_TRACES_ENABLED_KEY = "redact_traces_enabled"` is **not in `ALLOWED_KEYS`**. Grepped across `.rs`/`.ts`/`.tsx`: **3 references total — the declaration, one boot-time read, and one prose comment. Zero writers.** So the trace-redaction preference is permanently pinned to the compiled-in `AtomicBool::new(true)`. It fails *safe* (redaction stays on), which is why nobody noticed, but the documented user preference does not exist. |
| `engine/src/context_fidelity.rs:18`, `:79-84` | `PIPELINE_CONTEXT_FIDELITY_KEY = "pipeline_context_fidelity"` is **not in `ALLOWED_KEYS`**. **2 references total — declaration and one read. Zero writers.** The six-level graded pipeline-context feature (`Full` / `SummaryHigh` / `SummaryMedium` / `SummaryLow` / `Compact` / `Truncate`, each with its own line budget at `:59-67`) runs permanently on `Compact`. Five of the six levels are unreachable. |
| `settings_keys.rs:793-795` · `:1409-1414` | **The same class, twice before, both recorded in this file's own source.** `AUTONOMOUS_DELIBERATION`: *"Read by engine/deliberation.rs but was missing here, so `set` rejected the write and the autonomous-deliberation toggle could never be enabled."* `MODEL_ROUTING_RULES`: *"the engine read/wrote `model_routing_rules` but the allowlist never registered it … `set_model_routing_rules` was REJECTED by `validate_key`, so BYOM routing rules could never be saved."* Each was fixed with a one-off `assert_eq!` pinned to that one constant. **Four occurrences, two live, and the countermeasure has been "write another test about this specific key" every time.** |

### The registry's own contract, measured against itself

`settings_keys.rs:5-12` states: *"Every key defined here is paired with a `<KEY>_DEFAULT` constant …
Consumers MUST reference the `_DEFAULT` constant rather than hard-coding a literal, so that 'what does
unset mean for this key?' has exactly one answer."*

| Class | Count | Notes |
|---|---:|---|
| Registered key families (87 exact + 7 prefix) | **94** | |
| …with a paired `<KEY>_DEFAULT` | **38** | The stated invariant holds for **40%** of the surface |
| …**without** one | **56** | incl. `CLI_ENGINE`, `APP_LANGUAGE`, `APPEARANCE_PREFERENCES`, `QUALITY_GATE_CONFIG`, `HEALTH_DIGEST_ENABLED`, all 7 prefix families |
| …with a `validate_value` arm | **60** | 24 bool-token · 18 JSON-validating (8 against the consumer's real type) · rest numeric/enum |
| …**without** one — any string accepted | **34** | incl. all 3 secret-bearing keys, `CLI_ENGINE`, `APP_LANGUAGE`, `HEALTH_DIGEST_ENABLED`, `DIRECTOR_BRAIN_ENABLED` |
| Read sites using a named `*_DEFAULT` | **11** | |
| Read sites inlining a literal default | **18** | `health.rs:75` and `:168` inline `"claude_code"` for `CLI_ENGINE` **twice in one file** |
| Read sites ending in `unwrap_or_default()` | **8** | |
| Keys falling through `audit_category` to `"config"` | **6** | `DRAFT_RETENTION_DAYS`, `APPEARANCE_PREFERENCES`, `APP_LANGUAGE`, `CHAIN_MAX_COST_USD`, `CHAIN_MAX_LINKS`, `FLEET_COMPANION_DEVICES` — legal, but undecided |

### Type recovery — how 94 read sites turn TEXT back into a value

| Idiom | Sites | Notes |
|---|---:|---|
| String kept as-is | **42** | the honest majority — model names, URLs, cursors, device ids |
| `serde_json::from_str` | **21** | 8 of these keys are validated against the same type on write; 13 are not |
| **Bool by string comparison** | **16** (census: **18 matches / 15 files**) | **6 distinct spellings**; only 1 distinguishes a DB error from `false` |
| `.parse::<T>()` | **14** | `u32` ×4, `f64` ×3, `u64` ×2, `i64` ×2, `usize` ×1, `EngineKind` ×2 |
| `FromStr::from_str` | **1** | `context_fidelity.rs:80` — the one that is unreachable (P0-2) |

The census rule counts 18 where the hand classification counts 16; the two disagree because the
census resolves `db::repos::core::settings::get` at `lib.rs:1262,1282`, which the alias-resolver
missed. **The census number is the correct one**, and both are floors — a decode split across a `;`
is invisible to either.

### Naming, encoding and the live table

| Property | Measurement |
|---|---|
| Key naming | **85 snake_case**, **2 dotted** (`mastermind.layout.v1`, `mastermind.scene.v1`), **7 colon-terminated prefix families**. Conventional, with exactly two exceptions — and both exceptions carry a `.v1` the doc version has already outgrown. |
| Live rows | **32**, of which **32 are registered exact keys**, 0 prefix keys, **0 unregistered**. The allow-list is holding. |
| Registered keys with **no** row | **55 of 87 (63%)** — **the default is the dominant read path**, which is why the 56 missing `_DEFAULT` constants matter more than they look. |
| Value shapes on disk | 13 bool-literal · 8 valid JSON · 4 ISO-8601 · 4 opaque string · 2 integer · **1 empty string** (`companion_exec_review_retry`, §5) |
| Largest value | `dev_tools_cross_project_metadata` — **46,105 bytes, 70% of a 64 KB ceiling the writer is not subject to** |
| `updated_at` | **32/32 RFC 3339**, though the DDL default is `datetime('now')` — a second, dormant format. Handed to [timestamp-storage](./timestamp-storage.md). |
| `settings_audit_log` | 15 rows. **1 row in the `api_keys` category whose `setting_key` is not an `app_settings` key at all** — `external_api_keys.rs:42-55` and `broker.rs:71` write into the same table with a key *name* in that column. The structural `[redacted]` guarantee lives in `repos/core/settings.rs:45-49`, **not** in `settings_audit_log::insert`, so those rows get only the pattern-based sanitizer. The doc comment at `settings.rs:21` says the sanitization "is handled inside `settings_audit_log::insert`", which is where the *weaker* half lives. |

### Two-sided: what the frontend cannot see

- `getAppSetting(key: string): Promise<string | null>` (`src/api/system/settings.ts:10`). **There is no
  generated key list and no per-key value type.** The 60 `validate_value` arms, the 38 `_DEFAULT`
  constants and the 24-key `"true"`/`"false"` contract are all invisible across IPC; the frontend
  learns about them by a developer reading the Rust.
- Key literals are therefore hand-typed on both sides. `max_parallel_executions` is spelled in
  `settings_keys.rs`, `LimitsSettings.tsx:19` and `FleetActivityStrip.tsx:34`; its default is spelled
  in `settings_keys.rs:580` and `processActivitySlice.ts:140`; its range in `settings_keys.rs:583,588`
  and `LimitsSettings.tsx:21-22`. **Six declarations of one setting, tied by two comments that both
  point at a dead path.**
- The one frontend policy worth keeping: `useAppSetting.ts:50-52` discards a stored value that fails
  the caller's `validate` predicate, falls back to the default, and logs. That is the correct read
  policy and it exists in exactly one hook.

### Corrections to prior findings

- **[`client-state-persistence.md`](./client-state-persistence.md) reports "89 allow-listed keys".
  The measured count is 87 exact keys + 7 prefix families.** Parsed from the `ALLOWED_KEYS`
  (`:719-809`) and `ALLOWED_PREFIXES` (`:821-829`) blocks by matching entry lines, with the block's 2
  comment lines excluded — a raw line count of the `ALLOWED_KEYS` body returns 89. Its line
  references — `ByomApiKeyManager.tsx:165,:199`, `settings_keys.rs:28,:34,:70`,
  `schema.rs:595`, `settings.rs:45-49` — all reproduce exactly.
- **`get_by_prefix`'s `LIKE … ESCAPE` is a full table scan — but the escaping is not why, and the
  correctness argument for it stands.** Measured on a synthetic 40,000-row `app_settings` (identical
  DDL, `ANALYZE` run): `LIKE 'auto_rollback:%'` scans **with or without** the `ESCAPE` clause, because
  SQLite's LIKE optimisation needs `case_sensitive_like=ON` which this build does not set. `GLOB
  'auto_rollback:*'` and `key >= 'auto_rollback:' AND key < 'auto_rollback;'` both **SEARCH using the
  primary-key index**. So the range form is *both* faster and immune to the `_`-as-wildcard problem
  that motivated the escaping (`settings.rs:187-194`) — the trade was not necessary. At the live
  cardinality of 32 rows this is worth nothing; it becomes worth something the first time a
  per-persona prefix family grows, which is the whole point of having prefix families.
- **[`json-blob-column.md`](./json-blob-column.md)'s "the repo reached for the correct tool at the
  wrong end of the pipeline" does not hold for this table.** 18 `app_settings` key families are
  validated at *write* time, 8 against the consumer's real struct — stronger than the
  `CHECK(json_valid)` that path prescribes. See §6.

## 8 Gaps in the primitive

1. **One key requires five independent declarations and nothing requires any of them.** The constant,
   the `ALLOWED_KEYS` entry, the `_DEFAULT`, the `validate_value` arm, the `audit_category` arm — five
   edits in one file, in five different places, with no compiler relationship between them. Every
   number in §7 is downstream of this: 56 missing defaults, 34 missing validators, 4 keys read
   without registration. **This is the root cause the second pass surfaced, and it is upstream of
   nearly every other gap here.**
2. **`get(key: &str) -> Option<String>` cannot carry a type.** There is no `get_bool` / `get_u32` /
   `get_json::<T>`, so the decode is re-derived at every read. `autonomy::global_enabled` proves the
   idea works and covers 21 of 94 key families; the other 73 have nothing.
3. **The write path and the read path can disagree about the vocabulary, and do.**
   `validate_value` rejects `"1"` for a bool; `runner/mod.rs:1468` accepts it. Nothing relates the
   validator to the readers, so the reader can be strictly more permissive than the only thing that
   can produce the value.
4. **The 64 KB ceiling is enforced at the wrong layer.** Validation was deliberately put in the repo
   so internal callers cannot bypass it (`settings.rs:91-94`); the size limit was left in the command
   (`:129`). The one invariant the frontend depends on is the one the backend does not enforce.
5. **`settings-changed` fires only from the command layer.** Documented at `settings.rs:35-39`:
   internal engine writes have no `AppHandle`. Of 50 `set` call sites, most are internal, so most
   writes are invisible to every mounted reader until remount.
6. **`get_by_prefix` neither validates nor warns**, unlike its three siblings, and cannot use the
   primary-key index in its current form (§7).
7. **A "cleared" value has no canonical spelling.** `delete` exists and is idempotent, but
   `set(key, "")` also "works" — and because `""` fails every parser, the corrupt path and the
   cleared path are indistinguishable. `json_valid('') = 0`, verified on the shipped engine.
8. **The frontend has no typed contract at all.** Every guarantee the registry provides stops at the
   IPC boundary; `string | null` is what arrives.
9. **The registry has no test that relates it to its consumers.** It has 16 unit tests, all of which
   assert `validate_key` / `validate_value` / `audit_category` *about keys the test itself names* —
   plus one, `model_routing_rules_key_registered_and_matches_engine_constant`, added after an
   incident, covering exactly one constant. **A key that is read but not registered is invisible to
   all 17.**
10. **No test writes a value and reads it back through a consumer.** The 24-key bool contract, the 18
    JSON validators and the 38 defaults are shape assertions; nothing observes that a stored `"true"`
    actually turns a feature on. Per the model-effort guide's warning: a gate that asserts data is not
    a gate on behaviour.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), this must be answered before §9 is written.
**For this leaf the answer is an emphatic yes, and the type fix is strictly better than every gate
below — it makes four of the five deviation classes unrepresentable rather than counted.**

Today a key is a `&str` constant plus four optional, unrelated declarations. Replace it with one
declaration that owns all of them:

```rust
pub static CLI_ENGINE: Setting<EngineKind> =
    Setting::enumerated("cli_engine", EngineKind::ClaudeCode, Category::Engine);
pub static SKILLS_SIDECAR_ENABLED: Setting<bool> =
    Setting::boolean("skills_sidecar_enabled", true, Category::Engine);
pub static EVENT_RETENTION_DAYS: Setting<u32> =
    Setting::number("event_retention_days", 30, 0..=u32::MAX, Category::Retention);
```

Four things become impossible, not merely counted:

1. **A key with no default.** The default is a **required constructor argument**. 56 missing
   `_DEFAULT` constants stop being possible to express. (Same shape as `FacetedDecisionTable`'s
   required `emptyTitle` → 3/3 real copy where its optional-prop siblings get 5-of-20 fallthrough.)
2. **A key with no validator.** `T` *is* the validator: `Setting<bool>` can only round-trip
   `"true"`/`"false"`; `Setting<u32>` can only round-trip a decimal. The 34 unvalidated families
   disappear, and — the part no gate can achieve — **the reader and the writer become the same code**,
   so `runner/mod.rs`'s `"1"` cannot diverge from `validate_value`'s rejection of it.
3. **A key read but never registered.** `settings::get(&CLI_ENGINE)` takes a `&Setting<T>`, not a
   `&str`. `ALLOWED_KEYS` is derived from the declared statics rather than hand-maintained beside
   them, so **registration stops being a separate act**. `redact_traces_enabled` and
   `pipeline_context_fidelity` become compile errors; the four-occurrence class ends. A gate can only
   count it — and note that counting is what the repo has already tried, three times, one test per
   incident.
4. **A decode at the call site.** `get(&SKILLS_SIDECAR_ENABLED) -> bool` returns the value.
   18 boolean string-compares in 6 spellings and 14 `parse::<T>()` sites collapse into the accessor,
   and the error/absent/malformed distinction is made **once**, correctly, the way
   `daemon/runtime.rs:360-370` already does it alone.

**And a fifth, which is the P0:** make `Setting<T>` require `T: SettingValue`, and deliberately do
**not** implement `SettingValue` for a secret type. `Setting::text("ollama_api_key", …)` for a
credential then fails to compile, and the developer is pushed to the constructor that exists —
`keyring::Entry`, per `qwen_engine.rs:41`. A gate that counts secret-shaped key names (rule A below)
is a ratchet on a line the type would simply hold.

**What a type cannot fix here, and therefore what the gates are for:** the TypeScript half. A key
crosses IPC as a string; the honest type fix there is *generation* — emit the key list and a per-key
value type from the same `Setting<T>` declarations, so `getAppSetting('max_parallel_executions')`
becomes `getSetting(Settings.maxParallelExecutions)` and the six hand-typed declarations of that one
setting collapse to one. That is real work, and it is the only thing that removes the two "keep in
sync" comments that already point at a path which does not exist.

**Sequencing:** land `Setting<T>` and the three census rules below become migration counters that
ratchet to zero and get deleted. Land the gates alone and you have measured a problem you could have
made impossible.

## 9 The missing gate

### The semantic conditions, stated first

Three, each stack-free:

> **(A)** A credential is stored in the general-purpose configuration store instead of the system's
> secret store.
> **(B)** A stored value's type is recovered by an ad-hoc idiom at each read site rather than once,
> at the key's declaration.
> **(C)** A configuration key's name is declared in more than one place, so a consumer and the
> registry can disagree without anything noticing.

What follows are **one repo's proxies** for these. Per the
[portability test](../research/portability-test.md) a proxy does not travel: an adopting repo
inherits the three sentences and re-derives its own signals against its own key-declaration idiom.
Each rule states the precondition its proxy depends on.

### Mechanism — census rules, not scripts

Per the [contract](../golden-path-contract.md) §"Don't write a script", the ratcheting-baseline
mechanism already exists at [`scripts/census/`](../../../scripts/census/) and **`npm run census:check`
is already inside `npm run check`**, so this lane is live with no new wiring. **Checked first that
none of the 51 existing rules covers this condition** — `raw-web-storage` is the nearest and it
belongs to [client-state-persistence](./client-state-persistence.md); nothing keys on the settings
registry, on a settings read, or on a key literal.

This path publishes **three** entries for `scripts/census/rules.json` (merged by the orchestrator —
never edited here directly, per the contract's concurrent-writer warning) plus **one positive
control**, published **without a `baseline` and with a `positive-control` id suffix so the merger
skips it**. It is a measurement instrument, not a ratchet: it asserts the walker reached the
migrations tree at all, which is the precondition every other assertion here silently depends on.

```json
{"rules":[
  {
    "id": "settings-key-holding-secret",
    "goldenPath": "docs/concepts/golden-paths/app-settings-store.md",
    "title": "A settings key whose own name says it holds a credential, in a store whose value column is plain TEXT",
    "roots": ["src-tauri/db/src"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "pub const [A-Z][A-Z0-9_]*(?:API_KEY|_TOKEN|_SECRET|_PASSWORD|MASTER_KEY|_CREDENTIAL): &str = \"",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a key constant in the app_settings registry whose NAME declares that its value is a credential. PROXY FOR the stack-free condition \"a credential is stored in the general-purpose configuration store instead of the system's secret store\". app_settings.value is `TEXT NOT NULL` (src-tauri/db/src/migrations/schema.rs:595-599) with no encryption hook anywhere on the write path: a grep for crypto/encrypt/decrypt over repos/core/settings.rs, settings_keys.rs and commands/infrastructure/settings.rs returns 0 in all three, while src-tauri/core/src/crypto.rs::encrypt_field (AES-256-GCM under an OS-keychain-bound master key) is used by repos/resources/credentials.rs and repos/core/personas.rs. Matches today: OLLAMA_API_KEY (settings_keys.rs:28), LITELLM_MASTER_KEY (:34), BROWSER_BRIDGE_PAIRING_TOKEN (:70). Precision is 100% and independently confirmed: settings_keys.rs::audit_category maps EXACTLY these three constants, and no others, to the \"api_keys\" category (:1181), and repos/core/settings.rs:45-49 redacts that category structurally because - in its own words - the pattern-based sanitizer \"cannot recognize a BARE token value\". The repo therefore already knows these three rows are secrets; it protects the AUDIT COPY and leaves the row itself in clear. Confirmed in the operator's live database 2026-08-14: browser_bridge_pairing_token is present, 32 characters, token-shaped, plaintext. The blast radius is not only at-rest: engine/src/config_merge.rs:75-86 reads the two BYOM keys on every persona config resolution, and src/api/system/settings.ts::getAppSetting returns the raw value to the renderer, which src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:199 calls and :505/:531 renders and copies to the clipboard. LEGAL FIX, and the repo already contains it: route the secret to the OS keyring or the credential vault and keep only the non-secret half in app_settings. src-tauri/src/commands/infrastructure/qwen_engine.rs:32-49 does exactly this for the same shape of value - api_key to keyring::Entry (engine/http_engine/secrets.rs:28-33), base_url to app_settings - and its status command at :51-52 carries the comment \"Never returns the API key itself\". PRECONDITION (must be re-derived per repo): this repo declares its settings keys as `pub const NAME: &str` in one Rust module under src-tauri/db/src, and names credential-bearing keys with API_KEY/TOKEN/SECRET/MASTER_KEY. A repo whose keys are strings in a database table, a TS union, or an env-var list has this condition wearing different markup and scores zero here. If all three are migrated this rule matches zero and the runner fails structurally - that is correct: DELETE the rule at that point rather than baselining it at 0."
    },
    "baseline": { "files": 1, "matches": 3 },
    "floor": 100
  },
  {
    "id": "settings-bool-by-string-compare",
    "goldenPath": "docs/concepts/golden-paths/app-settings-store.md",
    "title": "A stored setting is turned back into a bool by comparing the raw TEXT at the call site",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "settings(?:_repo)?::(?:get|get_by_prefix)\\([^;]{0,240}?(?:==\\s*(?:Some\\()?\"true\"|!=\\s*\"false\")",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a read from the app_settings repo whose result is compared against the literal \"true\"/\"false\" within the same statement. PROXY FOR the stack-free condition \"a stored value's type is recovered by an ad-hoc idiom at each read site rather than once, at the key's declaration\". app_settings.value is TEXT, so every typed setting is decoded somewhere; settings_keys.rs::validate_value already fixes ONE canonical token pair on write - 24 keys are constrained to the literal strings \"true\"/\"false\" (:930-960) - but nothing fixes how they are read back, and the tree holds SIX distinct spellings of that one decode: `.as_deref() == Some(\"true\")` (3), `matches!(.., Ok(Some(v)) if v == \"true\")` (5), `.map(|v| v == \"true\")` (3), `.map(|s| s.trim() != \"false\")` (2 - inverted, for the two keys that default ON), `match { Ok(Some(v)) => v == \"true\", Ok(None) => false, Err(e) => .. }` (1 - the ONLY spelling that distinguishes a DB error from `off`), and `.map(|v| v == \"true\" || v == \"1\")` (1 - accepts a token validate_value would REJECT on write, so the reader is more permissive than the only thing that can create the value). The forward-anchored `[^;]{0,240}?` bound is deliberate: it keeps the match inside one statement, it cannot backtrack across the file, and it avoids a variable-length lookbehind (a lookbehind variant of this shape is what makes a rule take 73 seconds). It therefore UNDERCOUNTS - a decode split across a `;` is invisible - so treat the baseline as a floor on the condition, not a census of it. The 1 comment-only match the runner filters is engine/src/autonomy.rs:155, a doc comment quoting the very idiom it replaced; without ignoreCommentLines the prose about the fix would be counted as the defect. LEGAL FIX: a typed accessor at the registry, so the decode happens once where the key is declared. engine/src/autonomy.rs:157-162 `global_enabled(pool, Action)` is the existing partial version - it covers the 21 Action-keyed autonomy toggles and nothing else, which is why 18 sites still hand-roll it. PRECONDITION (must be re-derived per repo): this repo stores booleans as the TEXT tokens \"true\"/\"false\" and reads them through a Rust module path ending `settings::get`. A repo with a typed column, a JSON value, or an ORM accessor has this condition in a form this pattern cannot see."
    },
    "baseline": { "files": 15, "matches": 18 },
    "floor": 900
  },
  {
    "id": "settings-key-declared-outside-registry",
    "goldenPath": "docs/concepts/golden-paths/app-settings-store.md",
    "title": "A settings key name spelled a second time outside the registry that is supposed to own it",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "^[^\\S\\n]*(?:pub(?:\\([^)]*\\))?[^\\S\\n]+)?const [A-Z][A-Z0-9_]*_KEYS?: &(?:'static )?str = \"[a-z][a-z0-9_]*\";",
      "flags": "gm",
      "ignoreCommentLines": true,
      "description": "a `const <NAME>_KEY: &str = \"<lowercase_snake>\"` declared anywhere in the Rust tree except the settings registry. PROXY FOR the stack-free condition \"a configuration key's name is declared in more than one place, so a consumer and the registry can disagree without anything noticing\". settings_keys.rs opens with the rule this violates - \"Use these instead of raw string literals to prevent typo-based key mismatches\" (:3) - and repos/core/settings.rs::set REJECTS any key not in ALLOWED_KEYS (:96), so a second declaration is not merely untidy: if its literal is absent from the allow-list the key becomes READ-ONLY FOREVER and its feature is inert. That is not hypothetical. settings_keys.rs:793-795 carries a comment recording exactly this bug for AUTONOMOUS_DELIBERATION (\"Read by engine/deliberation.rs but was missing here, so `set` rejected the write and the autonomous-deliberation toggle could never be enabled\"), and :1409-1414 records it again for MODEL_ROUTING_RULES. The class then recurred twice more and nothing caught it: core/src/redact.rs:34 REDACT_TRACES_ENABLED_KEY and engine/src/context_fidelity.rs:18 PIPELINE_CONTEXT_FIDELITY_KEY are both unregistered, both have exactly one reader and ZERO writers tree-wide (verified by grep across .rs/.ts/.tsx), so the trace-redaction preference and the whole graded pipeline-context-fidelity feature are permanently pinned to their compiled-in defaults - five of that feature's six levels are unreachable. Measured precision 10/10 by opening every match: the eight registered ones are duplicate aliases (obsidian_brain/mod.rs:44,45,46, byom.rs:22, model_routing.rs:22, skills_sidecar/mod.rs:33, skill_scratchpad.rs:51, fleet/pairing.rs:38) and two are the live shadow keys above. fleet/pairing.rs:36-38 is the tell: its doc comment says \"Registered in db::settings_keys::FLEET_COMPANION_DEVICES\" - the author knew, and wrote a prose cross-reference where an import would have made the drift impossible. The sibling sweep found brainiac doing the identical thing at crates/brainiac-server/src/http.rs:129-131 (\"Kept in sync by cross-reference\"), so the failed mitigation is convergent too. Note the requirement that the literal START with [a-z]: that alone excludes the keyring probe `__personas_health_probe__` (commands/infrastructure/system/health.rs:256) without needing an allowlist entry. PRECONDITION (must be re-derived per repo): this repo names settings-key constants `*_KEY`/`*_KEYS` and spells the key as a lowercase-snake string literal. LEGAL FIX: delete the local constant and `use personas_db::settings_keys::<NAME>` - or, if the key is genuinely new, ADD it to ALLOWED_KEYS in the same change, because a key that is read but not registered can never be written."
    },
    "exclude": [
      {
        "path": "src-tauri/db/src/settings_keys.rs",
        "reason": "the registry itself — every key literal is SUPPOSED to be spelled here, exactly once. Excluding the file rather than pattern-matching around it keeps the rule readable, at the stated cost that a duplicate declaration INSIDE the registry would be invisible."
      },
      {
        "path": "src-tauri/engine/src/fix_loop.rs",
        "reason": "its three *_KEY constants (_fix_attempt, _fix_instruction, _fix_failures) address keys inside an execution's input_data JSON object, not rows in app_settings — the same naming shape in a different namespace. Cost of the exemption: a real shadow settings key added to this one file would not be seen."
      }
    ],
    "baseline": { "files": 8, "matches": 10 },
    "floor": 900
  },
  {
    "id": "app-settings-ddl-positive-control",
    "goldenPath": "docs/concepts/golden-paths/app-settings-store.md",
    "title": "POSITIVE CONTROL — not a rule; asserts the app_settings DDL is still findable at its declared root",
    "roots": ["src-tauri/db/src/migrations"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "CREATE TABLE IF NOT EXISTS app_settings",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "POSITIVE CONTROL — the merger must SKIP this entry (no baseline, `positive-control` id suffix). It matches the one thing this leaf cannot be wrong about: the app_settings CREATE TABLE at src-tauri/db/src/migrations/schema.rs:595. Exactly 1 file / 1 match over a 6-file root. It gates nothing about code quality; it exists so the validation run for this golden path can prove the walker reached the migrations tree at all, which is the precondition every other assertion here silently depends on. Validated locally WITH a temporary baseline of {files:1,matches:1} (the runner's validateRule requires one); renaming its root to a non-existent directory exits 1, and claiming 2 matches exits 1."
    },
    "floor": 4
  }
]}
```

### Validation — run standalone, then re-extracted from this document and re-run

Validated with `node scripts/census/run-census.mjs --rules <scratch>/census-app-settings-9f2a.json
--check` (scratchpad filename unique to this composer, per the shared-scratchpad collision incident):

```
  OK   settings-key-holding-secret              1/1   files    3/3   matches   143 walked  floor 100
  OK   settings-bool-by-string-compare         15/15  files   18/18  matches   963 walked  floor 900
  OK   settings-key-declared-outside-registry   8/8   files   10/10  matches   963 walked  floor 900
  OK   app-settings-ddl-positive-control        1/1   files    1/1   matches     6 walked  floor   4
  census OK — 4 rule(s), 2075 file-visits, 32 surviving violation(s) across 25 file(s).
```

Run twice; **identical both times, exit 0**. `963 walked` is exactly `rust.files` in
[`shared-facts.json`](../shared-facts.json) — two independently derived counts agreeing, which is the
only reason to trust either. `floor: 900` matches the other four `src-tauri`-rooted rules
deliberately: five rules over one root must not hold five opinions about what "the Rust tree is
intact" means. Whole run: **1.9 s** — no lookbehind anywhere, every quantifier forward-anchored and
bounded.

**Both populations, and their overlap.** Rule B (18 matches / 15 files) and rule C (10 matches / 8
files) intersect in **2 files** — `engine/src/skills_sidecar/mod.rs` and
`engine/src/skill_scratchpad.rs` — which each declare a duplicate key constant (C, at `:33` / `:51`)
*and* decode its value with an inverted string compare (B, at `:60` / `:92`). They are the two keys
that default **ON**, and they are also the two best-behaved sites in either population: both alias
`personas_db::settings_keys::<KEY>_DEFAULT` rather than inlining the default, with the comment
"Single source of truth with the allowlist so the two can't drift." **A file can be in both
populations and still be the thing to copy** — which is the argument for `Setting<T>` and against
treating either count as a defect roster. Rule A's single file (`settings_keys.rs`) is excluded from
rule C and out of rule B's root scope, so it overlaps neither.

**Fault injection against the real tree** — a gate that cannot fail is not a gate. Each row is a
single-field mutation, run with `--check`:

| Induced fault | Exit |
|---|---|
| baseline, unmutated | **0** |
| rule A matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES`) | **1** |
| rule B matcher matches nothing | **1** |
| floor above the walk (`floor: 5000` on a 963-file root) | **1** |
| renamed Rust root (`src-tauri` → `src-tauri-x`) | **1** |
| renamed registry root (`src-tauri/db/src` → `…/db/srcx`) | **1** |
| count rises (rule C baseline claims 3 where 10 exist) | **1** |
| silent drop (rule C baseline claims 40 where 10 exist) | **1** |
| stale `exclude` (a path matching no file) | **1** |
| unexplained `exclude` (4-character reason) | **1** |
| missing grounding (no `goldenPath`, no `principle`) | **1** |
| invalid regex in `signal.pattern` | **1** |
| **positive control** root renamed (`migrations` → `migrationz`) | **1** |
| **positive control** DDL count claimed as 2 | **1** |

Fourteen mutations, thirteen failures, one clean baseline.

### What this does NOT gate, and why — three refusals

1. **"A key is read but not in `ALLOWED_KEYS`" — not expressible, and this is the important one.**
   That is a *relational* property across two files: does this literal appear in a list somewhere
   else? A census rule counts occurrences within one file and cannot join. Rule C is the closest
   available proxy — it catches the *second declaration*, which is where every instance of the bug
   has started — but it cannot tell a registered duplicate from an unregistered shadow. The real
   check is ~20 lines and already has a proven shape two ways: `settings_keys.rs:1415-1418`'s
   `assert_eq!` generalised from one constant to all of them, or `personas-web`'s
   `scripts/check-i18n-coverage.mjs` (`.github/workflows/ci.yml:29`) retargeted from locale keys to
   settings keys. **Refusing to force this into a census rule is the correct call**, and naming both
   proven mechanisms is more useful than a proxy that would report green while a toggle stays dead.
2. **"A missing row fails open when it should fail closed" — needs behaviour, not shape.** The
   `.ok().flatten()` idiom at 17 of 18 boolean read sites collapses a *database error* into
   `false`, which is right for the 21 autonomy toggles (default off) and wrong in principle for the
   two that default ON — `skills_sidecar` and `scratchpad` both do `.ok().flatten().map(…).unwrap_or(true)`,
   so an unreadable database silently *enables* a feature. Whether that is a defect depends on what
   the feature does, which no regex can decide. The right host is a test: seed a poisoned pool, call
   the accessor, assert the direction. **Note the census engine cannot express "must be zero"
   anyway** — a rule pinned at 0 fails structurally by design, with the runner's own message saying
   so — so any "this must never happen" assertion needs a test, not a rule, by construction.
3. **The TypeScript half — deliberately ungated until the type lands.** A rule keying on a
   hand-typed key literal at a `getAppSetting` call site would fire on ~12 sites and route them to a
   generated key module **that does not exist**. That is precisely the contract's "gate that points
   at a broken destination": `custom/prefer-numeric` reported 5 warnings while ~96% of a 14-locale
   app rendered en-US separators, because reaching the primitive is not the same as the primitive
   being right. Generate the keys first; gate second.

**Severity note.** Nothing here is proposed as an ESLint rule, so the warn-vs-error question does not
arise — and it should not be argued from volume in either direction: `npm run check` runs
`eslint src/` with no `--max-warnings` and the pre-commit hook passes `--quiet --max-warnings 99999`,
so a warn-level rule enforces nothing at either gate at any count. The census is a different
mechanism: `census:check` exits 1 on drift and is already inside `npm run check`.
