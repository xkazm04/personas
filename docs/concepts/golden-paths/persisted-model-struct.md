# Golden path — Persisted model struct

> Situation node: `data-persistence/data-modeling/persisted-model-struct` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 from a ground-truth sweep of the whole Rust tree against `master`.
> Sweep size: **963 `.rs` files** (exactly `rust.files` in [`shared-facts.json`](../shared-facts.json)) ·
> **2,217 struct declarations** and **264 enums** parsed with their attribute blocks ·
> **308 tables / 3,105 columns** parsed from every `CREATE TABLE` and `ALTER TABLE … ADD COLUMN`
> in the tree · **1,033 generated binding files** under `src/lib/bindings/`. **358 structs were
> matched to a table** by field-name overlap (≥80% of the struct's fields present as columns AND
> ≥50% of the table's columns covered), giving **3,105 field↔column pairs**, each of which was
> compared for nullability. Every number was counted by a script run against the tree and, where a
> second implementation was available, cross-checked — the DDL parser and the census matcher
> independently agree on the 26/27 `DEFAULT`-without-`NOT NULL` columns, and the struct parser and
> a standalone regex independently agree on the 198 models lacking `rename_all`.
> Dimensions: **function · code-quality · ui**. **Two-sided:** the Rust struct, the generated
> TypeScript binding, and the contract between them are all in scope.
> A **convergence sweep** was run against three sibling repos (`brainiac` — Rust/sqlx/Postgres with a
> generated TypeScript console; `personas-cloud` — TS/better-sqlite3; `personas-web` — TS/Supabase) to
> separate physics from local taste. It **contradicted two clauses** this document would otherwise
> have asserted and **reframed one Gap from "add a check" to "the emission shape is the bug"**.
> Findings are tagged in §2 and detailed in §6.
>
> **Sibling boundaries, settled in prose.**
> [**Row to struct mapping**](./row-to-struct-mapping.md) owns the *read path* — the `row_to_*`
> function, the column read, and what a call site does when one row fails. This path owns the
> *shape being read into*: which fields exist, what their types are, and whether those types can be
> true. Where that path says "a mapper never decides anything", this path explains why 181 mappers
> decide anyway — **they are compensating for a column the schema left nullable**, and the fix is in
> the DDL, not the mapper.
> [**Schema change**](./schema-change.md) owns the migration mechanics: where DDL goes, the
> `already_applied` probe, the registry joins, and the `REFERENCES nonexistent(id)` class of bug.
> This path owns the *declaration* the migration lands — `NOT NULL`, `DEFAULT`, `CHECK IN (…)` — and
> what those choices cost the struct three layers up.
> [**JSON blob column**](./json-blob-column.md) owns what goes *inside* a column and its decode
> policy. When a field's type is `Json<T>` or `String`-holding-JSON, that path governs; this one
> governs every other field type.
> [**Timestamp storage**](./timestamp-storage.md) owns the *representation* of a moment. **This path
> does not re-litigate it** — it measured the field-type half and confirms the answer: all **505**
> timestamp fields on persisted read models are `String`, **zero** are `chrono::DateTime`, so the
> struct layer is uniform and the whole problem lives in the string's shape, which is that path's.
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "Add a table for X and the struct to read it back"
- "Add a field to `Persona` / `DevTask` / `PersonaExecution`" — the struct is the first edit, the mapper the second
- "Should this field be `Option<String>` or `String`?"
- "The column has a `DEFAULT`, so the field can be non-`Option`, right?"
- "Why is this field `snake_case` on the frontend when everything else is camelCase?"
- "TypeScript says this is a `bigint` but it's obviously a number"
- "I deleted the Rust struct but the app still compiles" / "what is `src/lib/bindings/VaultStatus.ts`?"

If you are about to type `#[derive(… TS)]`, `#[ts(export)]`, `#[serde(rename_all = …)]`,
`#[serde(default)]`, `pub struct <Something>` in `core/src/models/`, or `pub <field>: Option<…>` next
to a column you just added — you are in this situation.

## 2 The one way

**Declare the struct once, in `core/src/models/<domain>.rs`, and make every field type a true
statement about its column.** Derive `Debug, Clone, Serialize, Deserialize, TS`; carry
`#[ts(export)]` and `#[serde(rename_all = "camelCase")]` on the container. Then, field by field:
**`Option<T>` if and only if the column omits `NOT NULL`** — a `DEFAULT` binds the writer and
promises the reader nothing, so `TEXT DEFAULT ''` is a nullable column and `String` is a lie about
it. If you want the non-`Option` type, **go back and write `NOT NULL DEFAULT ''` in the DDL**; that
is a one-word edit that makes the wrong struct unrepresentable, and it is always cheaper than the
`unwrap_or` the mapper will otherwise carry forever. Where the DDL declares a closed vocabulary with
`CHECK (col IN (…))`, the field is a Rust `enum` with `FromSql` + `ToSql` + `rename_all` chosen so
**the stored token, the serde token and the TypeScript union member are the same string** — never
`String`. Numbers that cross IPC are `i32` / `f64`; **`i64` and `u64` make ts-rs emit `bigint`, which
no Tauri payload can ever carry**, so either narrow the Rust type or pin it with
`#[ts(type = "number")]` at the moment you write the field. Timestamps are `String` in the canonical
shape [timestamp-storage](./timestamp-storage.md) prescribes. Then regenerate — `cargo test
--workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings`, **both flags
load-bearing: without them zero bindings regenerate** — commit `src/lib/bindings/`, and stop. No
hand-written TypeScript interface for a type the generator already emits, no `#[serde(default)]` on a
field the database always supplies, and **when you delete a struct, delete its binding file in the
same commit** — ts-rs never will, and nothing in CI can tell you.

### The frontend half, and the contract between them

The generated file in `src/lib/bindings/<Name>.ts` **is** the contract. The frontend imports it as a
type and never re-declares it. Three properties make that contract honest, and each is decided on the
Rust side:

| Property | Decided by | What breaks when it's wrong |
|---|---|---|
| **Field presence** | `Option<T>` vs `T` | `T` over a nullable column: the row read fails with `InvalidColumnType`, and the whole list fails or the row silently vanishes ([row-to-struct-mapping](./row-to-struct-mapping.md) §5) |
| **Field naming** | `#[serde(rename_all)]` | 292 exported structs have none, so **one persisted entity's wire shape is snake_case and its neighbour's is camelCase**, and 5 tables disagree with themselves |
| **Field type fidelity** | the Rust scalar | `i64` → `bigint`, which is never what arrives; the call site must coerce or lie |

**Absence has exactly one spelling: `T \| null`.** Do not put `#[serde(skip_serializing_if =
"Option::is_none")]` on a persisted model — ts-rs turns it into `field?: T`, so the surface now
carries two different "this may be absent" idioms and the consumer must know which type uses which.

### Which clauses are physics, which are this house

Per the [contract](../golden-path-contract.md) and the
[portability test](../research/portability-test.md), a prescription only travels if something else
reinvented it. A read-only sweep of `brainiac` (Rust · sqlx · Postgres · `utoipa` → `openapi-typescript`
console — the strong oracle, same problem shape), `personas-cloud` (TS · better-sqlite3) and
`personas-web` (TS · Supabase) was run 2026-08-14 to sort them. **It contradicted two clauses this
document would otherwise have asserted and upgraded one finding from "add a check" to "the emission
shape is the bug"**; details in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **`NOT NULL DEFAULT` written together, never `DEFAULT` alone** | **physics** | `brainiac` **90 `NOT NULL DEFAULT` / 0 genuine holes** — its 9 bare `DEFAULT`s are all `PRIMARY KEY DEFAULT gen_random_uuid()` — and the discipline holds across all 38 of its `ALTER TABLE ADD COLUMN` statements. `personas-web` **89 / 0**. The strongest agreement in the sweep |
| The closed vocabulary belongs in the **schema**, not only the struct | **physics** | `brainiac` has 2 native `CREATE TYPE … AS ENUM` (`migrations/0001_init.sql:65-66`) plus 27 `CHECK (col IN (…))`; `personas-web` constrains `synced_executions.status` the same way. The point they reached that this repo has not: the DB constraint makes the mapper's fallback **unreachable**, not merely untriggered |
| An unknown stored token **degrades and logs** | **physics** | `personas-web` `src/lib/supabaseApi.ts:73-90` — degrade to the non-terminal `"running"` plus a `console.warn`, with the reason written down; `brainiac` degrades without logging at 16 sites. Owned by [row-to-struct-mapping](./row-to-struct-mapping.md) §5; named here only because the *field type* is what makes it expressible |
| **Wire casing is decided once, for the whole surface** | **physics** | `brainiac` is **0 camelCase / 23 snake_case** in Rust and **291 snake_case / 0 camelCase** in its generated TS — the opposite choice, perfectly applied. `personas-cloud` makes it structural: one `snakeToCamel()` (`db.ts:430-432`) called from the single `mapRow` (`:450`). `personas-web` writes the rule into its schema file header |
| …but **camelCase specifically** | **house convention** | the direction is arbitrary — `brainiac` picked snake_case end-to-end and is no worse for it. What travels is "one casing, chosen, everywhere" |
| **The generated type is the only contract** | **physics** | `brainiac` generates one `console/src/lib/api-schema.d.ts` from `openapi.json` and states the doctrine at `console/src/lib/types.ts:1-11`. The counter-evidence is louder: the two TS siblings hand-copy 8 of *this repo's* generated bindings and have visibly rotted — `Persona` is **37 fields generated, 20 in the copy, 18 in the copy-of-the-copy**, and both copies declare a `groupId` the generated type does not have |
| **Absence has one spelling** | **mechanically reinvented; the spelling is ours** | `brainiac`'s generated surface is **188 `field?: T \| null` / 9 `field?: T` / 1 `field: T \| null`** — 95% one spelling, and that spelling carries *both* markers so no consumer needs to know the convention. Both TS siblings mix freely (65/39 and 40/16). The *singularity* travels; `\| null` rather than `?: T \| null` is this repo's pick |
| **A field type generated FROM the schema**, so nullability cannot disagree | **unvalidated — no oracle** | **Nobody does this.** `brainiac` enables sqlx's `macros` feature (`Cargo.toml:32`) and uses `query_as!` / `query!` **zero** times, running 332 runtime `sqlx::query(` calls through 9 hand-written `row_to_*` mappers with 43 `get::<Option<…>>` and 44 `unwrap_or` sites. `personas-web` calls `createClient` with **no `<Database>` generic** and has no generated `database.types.ts` at all. Treat "just generate the type from the schema" as unproven, not obvious |
| **A newtype for an id** | **unvalidated — no oracle** | `brainiac` has **0** `struct …Id(` declarations; both TS siblings use bare `string`. This repo's 704 `String` id fields are the ecosystem norm. Do not "fix" them |
| **Timestamps as a real date type** | **contradicted** | both TS siblings are 100% `string`; `brainiac` splits (24 `DateTime<Utc>` in the domain layer, 15 `String` on the wire) and files the split as a known inconsistency at `console.rs:3971-3973`. This repo's uniform `String` is normal — the shape question, which is the one that matters, belongs to [timestamp-storage](./timestamp-storage.md) |

## 3 Mandated primitives

**Exist today — use them:**

- **`#[derive(Debug, Clone, Serialize, Deserialize, TS)]` + `#[ts(export)]` + `#[serde(rename_all = "camelCase")]`** — the container triple. **992 `#[ts(export)]` attributes across 265 files** today; 557 exported structs carry camelCase.
- **`src-tauri/build.rs:20`** (and `core/build.rs:20`, `db/build.rs:12`, `engine/build.rs:6`) — `cargo:rustc-env=TS_RS_EXPORT_DIR=…/src/lib/bindings`. **The single source of truth for where bindings land.** Four crates, four `build.rs`, one destination. You do not configure this; you inherit it.
- **`#[ts(type = "number")]`** — the escape from `bigint`. **314 field-level pins exist**, `core/src/models/execution.rs:36,38,43,46,55` being the densest cluster. Use it when the Rust type must stay `i64`; prefer narrowing the Rust type when it need not.
- **`impl rusqlite::types::FromSql` + `impl ToSql` on the enum** — `core/src/models/automation.rs:64,72` / `:119,127` / `:180,188`, `chat.rs:47`, `n8n_session.rs:45,63`. **6 `FromSql` and 5 `ToSql` impls.** The only place a stored token is interpreted, and the only construction that makes the enum bindable in `params![]` without a `.as_str()` at every call site.
- **`CHECK (col IN ('a','b',…))` in the DDL** — **76 distinct `table.column` constraints**. The database's own declaration of a closed vocabulary. It is the input to the enum decision, not an alternative to it.
- **`personas_core::models::Json<T>`** (`core/src/models/json_column.rs:27`) — for a JSON-bearing field. Owned by [json-blob-column](./json-blob-column.md); named here only so you do not reach for `pub x_json: String`.
- **`src/lib/bindings/index.ts`** — the barrel. Note before relying on it: it re-exports **946 of 1,032** binding files, so **86 types are importable only by direct path**, and it is regenerated by a shell one-liner pasted in its own header comment (`:2`).
- **`scripts/check-unused-bindings.sh`** — CI guard that a binding is *referenced*. Know what it does **not** do: see Gap 1.

**Do not exist — this path defines them:**

- **A `#[derive(PersistedModel)]` (or a `persisted_model!` macro) that emits the container triple.** Today the three attributes are typed by hand 854 times and one of them is missing 292 times. A derive that emits `Serialize, Deserialize, TS, ts(export), serde(rename_all="camelCase")` makes the omission unrepresentable rather than counted (§9, and see "Prefer a type over a gate" below).
- **A binding-orphan check.** `git diff src/lib/bindings/` cannot see a stale file because ts-rs never deletes one; `check-unused-bindings.sh` cannot see one because it asks a different question. **31 orphans exist and 28 are still imported.** The check is ~15 lines: for each `src/lib/bindings/*.ts`, assert a Rust `struct|enum|type` of that name (or a `#[ts(rename)]` to it) exists somewhere in `src-tauri/`.

## 4 Steps

1. **Write the DDL first, and make it total.** Per [schema-change](./schema-change.md), a new `run_step` at `incremental.rs:4789`. For every column, ask "can this be absent?" If no, write `NOT NULL`. If it also has a sensible zero, write **`NOT NULL DEFAULT 0`** — never `DEFAULT 0` alone. Declare a closed vocabulary as `CHECK (col IN (…))`.
2. **Ask the type-over-gate question here, before anything else is written.** The DDL is where a whole defect class becomes unrepresentable:

   | Instead of | Write | What it removes permanently |
   |---|---|---|
   | `timeout_ms INTEGER DEFAULT 30000` | `timeout_ms INTEGER NOT NULL DEFAULT 30000` | the reader's `Option`, the mapper's `unwrap_or`, and the question of whether `i64` was a lie |
   | `status TEXT` | `status TEXT NOT NULL CHECK (status IN (…))` | a `String` field that can hold anything, and the frontend's untyped `string` |
   | `credential_id TEXT` read as `String` | `credential_id TEXT NOT NULL` — or accept `Option<String>` | a query predicate (`WHERE credential_id IS NOT NULL`) holding an invariant the type claims |

   **This is the highest-leverage step in the document.** 27 columns in this tree carry a `DEFAULT` without `NOT NULL`; they are the direct cause of **43** struct fields whose non-`Option` type the schema does not support and of the defensive `unwrap_or` idiom in 181 mappers. The DDL edit is one word. Everything else in §9 is a ratchet holding a line this step would not have needed.
3. **Declare the struct in `core/src/models/<domain>.rs`.** That is where 179 of the 292 persisted read models live and where `schema-change` says to put them; the 77 that live under `src-tauri/src/` are the population with the worst attribute hygiene.
4. **Container attributes, all three, every time.** `#[derive(Debug, Clone, Serialize, Deserialize, TS)]`, `#[ts(export)]`, `#[serde(rename_all = "camelCase")]`. If a type is deliberately backend-only, derive `TS` and *withhold* `#[ts(export)]` **with the reason in a comment** — `core/src/models/dev_tools.rs:1163-1168` is the one instance and it is exemplary.
5. **Per field, in this order:**
   - **Nullability** — `Option<T>` iff the column omits `NOT NULL`. Do not reason from `DEFAULT`.
   - **Vocabulary** — a `CHECK IN (…)` column gets a Rust `enum` with `FromSql`/`ToSql`, not `String`.
   - **Width** — `i32` / `f64` for anything crossing IPC. `i64` / `u64` only with `#[ts(type = "number")]`, and only when the value provably stays under 2^53. A genuinely larger value must be a `String`, because JSON has no other honest carrier.
   - **JSON** — `Json<T>`, per [json-blob-column](./json-blob-column.md).
   - **Time** — `String`, per [timestamp-storage](./timestamp-storage.md).
   - **No `#[serde(default)]`** on a field the database always supplies. On `Option<T>` it is a no-op (serde already yields `None` for a missing field — **519 of the 867 uses are this**); on a non-`Option` field it converts "the producer omitted this" into a silent zero value, which is the same failure family as a swallowed error.
6. **Regenerate and commit the binding.** `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings`. **Both flags are load-bearing:** `--manifest-path` alone selects only `personas-desktop` and the crate split moved most `#[ts(export)]` types into `personas-core`; without `--features desktop` the tauri build script aborts and **zero** bindings regenerate. The reasoning is written out at `.github/workflows/ci.yml:375-387`. Open the emitted file and read it — that is the contract, and it is the only place `bigint`, `?:` and snake_case become visible.
7. **Then stop.** Do not write a TypeScript `interface` mirroring the struct. Do not add a mapper-side `unwrap_or` to paper over step 2. `src/api/companion.ts:705-747` is what skipping this step looks like: a hand-authored interface shadowing a generated one, plus a runtime coercion, plus a comment explaining the coercion.
8. **When you delete or rename the struct, delete the binding file and its `index.ts` line in the same commit.** Nothing else will. See Gap 1.

## 5 Anti-patterns

- **Reading `DEFAULT` as a nullability guarantee — 27 columns, and the root cause of most of this document.** `persona_executions.input_tokens INTEGER DEFAULT 0` (`db/src/migrations/schema.rs:115`) is nullable: `INSERT … (input_tokens) VALUES (NULL)` and `UPDATE … SET input_tokens = NULL` both succeed. `PersonaExecution.input_tokens: i64` (`core/src/models/execution.rs:36`) says otherwise, and `row_to_execution` (`db/src/repos/execution/executions.rs:91-93`) pays for the gap with three consecutive `row.get::<_, Option<i64>>(…)?.unwrap_or(0)` calls. `persona_automations` (`schema.rs:1054-1067`) does it six times in fourteen lines.
- **A defensive `unwrap_or` over a column that is already `NOT NULL` — 23 of 181 sites.** In the same mapper, `cache_read_tokens` (`incremental.rs:6249`, `NOT NULL DEFAULT 0`) and `retry_count` (`incremental.rs:375`, nullable) are read identically at `executions.rs:94,101`. The mapper cannot see the schema, so it treats every column as suspect — and once it does, **the schema's nullability decisions become unobservable**, which is why nobody noticed the 43 that are wrong.
- **A mapper that invents the value the schema refused to guarantee.** `db/src/repos/dev_tools.rs:5103-5111` — every column of `dev_auto_runs` is nullable (`incremental.rs:4500-4511`, no `NOT NULL` anywhere but the PK), so `row_to_auto_run` defines a local `num` closure that turns any NULL into `0` and maps a NULL `status` to **`"running"`**. A row whose status could not be read is reported as in-flight. The struct's totality is manufactured at read time, once, in one function, for a table that will be read from somewhere else tomorrow.
- **`String` over a `CHECK (col IN (…))` column — 92 sites, versus 11 that use an enum.** The database has already written down the legal values; the struct throws them away, and the binding emits `status: string`, so the frontend re-derives the vocabulary as string literals. `dev_kpis` alone does this six times (`incremental.rs:5940-5955`): `category`, `measure_kind`, `direction`, `cadence`, `status`, `created_by` — six closed vocabularies, six `String` fields.
- **`i64` / `u64` on a field that crosses IPC — 288 field declarations across 142 binding files.** ts-rs v10 maps them to `bigint`. **Tauri's IPC is JSON, and `JSON.parse` cannot produce a `bigint`**, so the type is wrong for every one of them. The evidence is in the workaround: `src/api/companion.ts:744-747` guards with `typeof raw.totalSignalsCaptured === 'bigint'`, a branch that can never be taken, and its own comment (`:722-726`) says the coercion exists because "the ts-rs binding uses bigint". Downstream, `CloudExecutionRow.tsx:31` writes `Number(exec.durationMs)` and `AutomationsSection.tsx:46` interpolates it into a template literal — two more spellings of "the type is not what arrives".
- **Omitting `#[serde(rename_all = "camelCase")]` — 292 of 854 exported structs, 198 of them in `core/src/models/`.** The result is a split wire contract: `PersonaExecution.ts` is `persona_id, input_tokens, created_at`; `MemoryReviewProposal.ts` is `personaId, reviewedCount, createdAt`. Five tables disagree with *themselves*: `dev_workspaces` is read by `DevWorkspace` (snake) and `GitLabAgent` (camel); `n8n_transform_sessions_new` by three snake types and one camel; likewise `audit_incidents`, `persona_memories_new`, `persona_triggers_new`.
- **`#[serde(skip_serializing_if = "Option::is_none")]` on a persisted model — 23 fields.** ts-rs emits `personaId?: string` instead of `personaId: string | null` (`src/lib/bindings/MemoryReviewProposal.ts:9`), so the binding surface now carries two absence idioms and a consumer must know which one a given type uses. It also means the field is genuinely missing from the payload, which a `Object.keys()` walk or a diff will see differently from `null`.
- **`#[serde(default)]` on a non-`Option` field of a persisted model — 21 sites.** `PersonaExecution.business_outcome` (`core/src/models/execution.rs:73`) defaults a missing field to `"unknown"`; `Persona.gateway_exposure` (`persona.rs:603`) defaults an absent security posture. These structs are `Deserialize`d from import bundles (`src/commands/core/data_portability.rs`) and cloud sync, so a producer that omits the field gets a plausible value instead of an error. The other 519 uses sit on `Option<T>`, where serde already yields `None` — they are noise that trains the eye to skip the attribute.
- **A hand-authored TypeScript interface shadowing a generated binding.** `src/api/companion.ts:705-714` re-declares nine fields that ts-rs already emits, because one of them was a `bigint`. The workaround for a leaky generated type is a second, unversioned contract — the exact failure [new-ipc-command](./new-ipc-command.md) documents for `serde_json::Value` commands, arriving here through a different door.
- **Deleting the struct and leaving the binding.** `src/lib/bindings/VaultStatus.ts` describes a struct that no longer exists in `src-tauri/`. Its consumer, `src/api/vault/credentials.ts:11,85`, still writes `invoke<VaultStatus>("vault_status")`. The command (`src/commands/credentials/crud.rs:427-443`) now returns `serde_json::Value` assembled by a `json!` literal. **The frozen binding and the `json!` keys agree today by luck, and nothing anywhere compares them.** 31 orphans, 28 still imported.
- **A test fixture that builds its own version of a production table.** 40 production tables are also declared by `CREATE TABLE` in 32 non-migration files. `src/engine/kb_scan.rs:180-195` gives `knowledge_bases` three columns; the real one has more, four of them `NOT NULL` with no default. Every one of the **30** INSERT statements in the tree that omits a `NOT NULL`-no-default column is inside such a fixture — so the discipline in production code is real, and **the tests that would have proved it are running against a different schema**.

## 6 Evidence

**Adoption:** 992 `#[ts(export)]` attributes / 265 files · 854 exported structs + 89 exported enums ·
1,032 generated binding files · 358 structs matched to a table (293 read models, 65 input DTOs) ·
3,051 of 3,105 field↔column pairs have agreeing nullability (**98.3%**) · 874 columns declared
`NOT NULL DEFAULT` (against 27 that are `DEFAULT`-only) · 314 `#[ts(type = …)]` pins · 76 `CHECK IN`
vocabularies · 6 `FromSql` + 5 `ToSql` enum impls.

- **`src-tauri/core/src/models/automation.rs:30-230` — copy this one.** Three enums, each with `as_str()`, `FromStr`, `impl FromSql`, `impl ToSql` and `#[serde(rename_all = "snake_case")]` chosen so the stored token, the serde token and the TypeScript union member are **the same string**; then `PersonaAutomation` (`:199-224`) with the full container triple and typed enum fields (`platform: AutomationPlatform`, `fallback_mode: AutomationFallbackMode`, `deployment_status: AutomationDeployStatus`). It is the only place in the tree where the DDL's vocabulary survives all the way to the binding. **Copy the shape and fix its six columns** — `persona_automations` is also the single densest cluster of `DEFAULT`-without-`NOT NULL` (§7).
- **The enum token discipline is real and should not be "fixed".** 29 enums carry both a `rename_all` and a hand-written `as_str()`, which are two independent sources for the same string. All 58+ arms were extracted and compared against what serde's casing rule produces: **0 mismatches.** This is a hand-maintained invariant that has never drifted, and it is worth stating so the next reader does not "fix" it with a macro that changes the tokens.
- **`src-tauri/db/src/repos/dev_env_connectors.rs:24-51` — the honest way to be narrower than your column.** `dev_project_env_connectors.credential_id` is nullable (`incremental.rs:8074`) and `DevProjectEnvConnector.credential_id` is `String`. That would be a defect except that the module note (`:15-17`) states the rule — *"Clearing a binding DELETES the row rather than storing a NULL"* — the read predicate enforces it (`:45`, `AND credential_id IS NOT NULL`), and the doc comment above the function repeats it. Three statements of one invariant. It is correct, and it is **held by a `WHERE` clause in one function**: a second read added without that predicate breaks it silently, which is exactly why step 2 prefers `NOT NULL` in the DDL.
- **`src-tauri/core/src/models/dev_tools.rs:1163-1178` — the right way to NOT export.** `DevMemory` derives `TS` and deliberately withholds `#[ts(export)]`, with five lines explaining that a binding no frontend imports "would only add drift surface to the binding-drift CI job", and naming the condition under which to add it. One instance in 943; it is the model for every backend-only type.
- **`.github/workflows/ci.yml:368-407` — the binding gate, and the story of it being wrong.** Two comment blocks explain that `--workspace` is required because the crate split moved ~200 types to `personas-core`, that `--features desktop` is required because the tauri build script otherwise aborts before exporting anything, and that `git diff` alone exits 0 for a brand-new untracked binding. Three ways the same gate ran green while checking nothing, each fixed and each documented in place. **Read this before writing any gate.**
- **`src-tauri/build.rs:20` + three sibling `build.rs`** — the export directory emitted as `cargo:rustc-env` from each crate rather than configured in `.cargo/config.toml`, because the `[env]` table did not reliably reach proc-macro expansion and the tree carried two drifting binding directories as a result (`.claude/CLAUDE.md`, "ts-rs bindings"). The fix is that the mechanism is the same in all four crates.
- **`src/api/vault/credentials.ts:11-14, 85-95` — the counter-example to copy nothing from.** Three orphan bindings imported and re-exported as if they were the public contract of a module whose backend returns `serde_json::Value`.

### Convergence — what three sibling repos did without reading this

Run 2026-08-14, read-only, against `brainiac` (Rust · sqlx · Postgres · `utoipa` → `openapi-typescript`
— the strong oracle), `personas-cloud` (TS · better-sqlite3) and `personas-web` (TS · Supabase). The
clause-by-clause ruling is the table in §2; what follows is what changed this document.

- **The orphan-binding problem is an artifact of per-type file emission, and a sibling removed it structurally.** `brainiac` generates its entire frontend contract into **one** file — `console/package.json`'s `gen:api` runs `openapi-typescript ../openapi.json -o src/lib/api-schema.d.ts`, 6,624 lines, 187 schemas — and `openapi-typescript` **rewrites** that file rather than emitting one file per type. Deleting a Rust struct therefore deletes its TypeScript type on the next regeneration. **0 orphans, and the class cannot occur.** There is no `bindings/` directory anywhere in that repo. This is the most valuable finding of the sweep and it **revises Gap 1 below**: the ~15-line orphan check is the cheap incremental fix, but the *structural* fix is to stop emitting 1,032 files. Worth knowing before anyone invests in tooling around the current shape.
- **`brainiac` also gates its generated artifact with a unit test rather than a CI diff.** `crates/brainiac-server/src/openapi.rs:424-439`, `committed_document_is_current`, fails `cargo test` with the exact regeneration command in the message, and runs in `.github/workflows/ci.yml:38`. **Its honest gap is instructive:** that test covers Rust ↔ `openapi.json` only; `npm run gen:api` is manual and its output is *not* diffed in CI, so `api-schema.d.ts` can silently lag. This repo's `binding-drift` job covers the equivalent second hop and additionally checks untracked files (`ci.yml:389-407`) — **on this one axis Personas is ahead of the oracle**, which is worth saying because it is rare.
- **`personas-cloud` reinvented this repo's `DEFAULT`-without-`NOT NULL` hole on the same four columns, and reinvented the wrong mitigation too.** `packages/orchestrator/src/db.ts:360-366` declares `input_tokens INTEGER DEFAULT 0`, `output_tokens`, `cost_usd`, `retry_count` — nullable, exactly as `db/src/migrations/schema.rs:115-117` does — types all four as non-optional `number` (`packages/shared/src/types.ts:178-184`), and then patches the gap with a declarative override table at `db.ts:469-473`: `{ inputTokens: 0, outputTokens: 0, costUsd: 0, retryCount: 0 }`. **That is `row.get::<_, Option<i64>>("x")?.unwrap_or(0)` promoted to data.** Two independent codebases fell into the same trap on the same columns and both patched the reader; the two repos that fixed the *writer* (`brainiac` 90/0, `personas-web` 89/0) have no patch table at all. §4 step 2 is the correct end of the rope, and this is the measurement that proves it.
- **The hand-copy chain is the argument for "the generated type is the only contract", written by the siblings themselves.** `personas-cloud/packages/shared/src/types.ts:2` says it mirrors the desktop Tauri models; `personas-web/src/lib/types.ts:2` says it mirrors *personas-cloud*. Eight of this repo's generated bindings have hand copies. `Persona` is 37 fields generated, 20 in the first copy, 18 in the second; both copies carry a `groupId` field the generated type does not have and are missing `sensitive`, `headless`, `starred`, `lifecycle`, `setup_status`, `gateway_exposure`, `trust_level` and nine more; and the two copies have diverged from *each other* (`PersonaExecution.status` is `string` in one and a union in the other). **Every hand-authored mirror of a generated type in this tree — `src/api/companion.ts:705-714` is the one — is the first link of that chain.**
- **`personas-web` invented the best answer to the unknown-token question and wrote down why.** `src/lib/supabaseApi.ts:73-90` maps an unrecognised execution status to the neutral, non-terminal `"running"` and `console.warn`s, with a comment explaining that a blind cast would poison success-rate math and `eq("status", …)` filters. That is the rule [row-to-struct-mapping](./row-to-struct-mapping.md) §5 already converged on, reached from the field-type side.
- **Where the siblings are worse, plainly.** `personas-cloud`'s `mapRow<T>(row): T` ends in `return result as T` (`db.ts:447-463`) fed by 26 `SELECT *` queries — a weaker guarantee than any hand-written Rust mapper, because a missing column becomes `undefined` on a field typed `number` and nothing anywhere notices. It also declares `health_status TEXT NOT NULL DEFAULT 'healthy'` with **no** `CHECK` (`db.ts:334`) while narrowing the TS type to `'healthy' | 'degraded'`. And it ships a live instance of the defect class this path is about: `LATEST_MIGRATION_VERSION = 9` (`db.ts:37`) while the migrations array holds a version-10 entry (`db.ts:112-120`) that `runMigrations` returns before reaching (`db.ts:202`), so on any existing database the budget columns are never added — while `CloudDeployment` declares `currentMonthCostUsd: number` (`packages/shared/src/types.ts:445-449`). **A struct field typed non-optional over a column that does not exist**, undetectable by anything in that repo. `personas-web` declares 12 of its 23 row shapes inline at the call site and generates no types at all.

## 7 Deviations found

### The distribution — how a struct's fields relate to their columns

| | Pairs | % |
|---|---:|---:|
| **Agree** — `Option<T>` over a nullable column, or `T` over `NOT NULL` | **3,051** | 98.3% |
| **`T` over a nullable column** — the row read fails on a NULL | **43** | 1.4% |
| **`Option<T>` over a `NOT NULL` column** — a variant that can never occur | **11** | 0.4% |

**The base rate is good, and saying so matters** — this is not a systemically broken layer, it is a
tight, closable backlog. The 43 concentrate: 6 in `persona_automations`, 6 in `dev_auto_runs`, 4 in
`persona_executions`, 12 across `research_*` tables.

### P0 — shipped, and one of them is a live contract with no owner

| Path | Defect |
|---|---|
| `src/lib/bindings/` (31 files) · `src/api/**` (27 of 30 import sites) | **31 orphan bindings**: a generated `.ts` whose Rust `struct`/`enum`/`type` no longer exists anywhere in `src-tauri/`. **28 are still imported.** `VaultStatus.ts` and `MigrationResult.ts` are asserted at `src/api/vault/credentials.ts:85,89` over commands that now return `serde_json::Value` built by a `json!` literal (`src/commands/credentials/crud.rs:435-442, 452-455`). The frozen type and the literal agree by coincidence. Neither CI gate can see this — Gap 1. |
| `src-tauri/db/src/repos/dev_tools.rs:5103-5111` + `incremental.rs:4500-4511` | `dev_auto_runs` declares **no `NOT NULL` on any column but the PK**; `DevAutoRun` types six of them non-`Option`; the mapper manufactures the difference, turning a NULL `status` into `"running"`. A durable run record whose status column is unreadable is reported to the Run Desk as in flight. |
| `db/src/migrations/incremental.rs:4500-4511` → `src/commands/infrastructure/task_executor.rs:1655-1665` | `AutoRunStatus` is a **second, independent struct over the same table** with the same six non-`Option` fields. Two structs, one nullable table, no shared mapper. |
| `db/src/migrations/schema.rs:1054-1067` | `persona_automations` declares `description`, `webhook_method`, `timeout_ms`, `retry_count`, `fallback_mode`, `deployment_status` with `DEFAULT` and **no `NOT NULL`** — six columns in fourteen lines. `PersonaAutomation` (`core/src/models/automation.rs:208-221`) types all six non-`Option`, two of them as enums whose `FromSql` will reject a NULL outright. This is in the file that is otherwise the reference implementation. |
| `src/api/companion.ts:705-747` | A hand-authored nine-field interface shadowing a generated binding, plus a `typeof … === 'bigint'` branch that can never execute at runtime, because the field's real defect is that ts-rs typed a `u64` as something JSON cannot carry. |

### The nullability backlog

| Class | Count | Where |
|---|---:|---|
| Columns with `DEFAULT` and no `NOT NULL` | **27** | `schema.rs` 20 · `fk_hygiene.rs` 4 · `initial.rs` 1 · `incremental.rs` 1 (`persona_executions.retry_count`, `:375`) |
| Persisted read-model fields typed `T` over a nullable column | **43** (23 exported to TS) | `persona_automations` 6 · `dev_auto_runs` 6 (+6 in the duplicate struct) · `research_*` 12 · `persona_executions` 4 · `persona_memories` 2 · … |
| Persisted read-model fields typed `Option<T>` over a `NOT NULL` column | **11** | incl. `SubscriptionWithProject.created_at/updated_at` (`src/engine/project_tracking/subscription.rs:188-189`) and `GitLabAgent.created_at` (`src/gitlab/types.rs:82`) |
| Mapper sites compensating with `row.get(…).unwrap_or*` | **181** | 85 over a genuinely nullable column · **23 over a column that is `NOT NULL` everywhere it is declared** · 73 whose column name is ambiguous across tables |
| Columns declared `NOT NULL DEFAULT` (the correct form) | **874** | — |
| Columns nullable with no default (legitimately optional) | 1,104 | — |

### The wire-contract backlog

| Class | Count | Where |
|---|---:|---|
| Exported structs with **no** `#[serde(rename_all)]` | **292** of 854 | 198 of them in `core/src/models/` (of 410 exported structs there); 290 have at least one snake_case field, so the binding is snake_case |
| Exported structs with `rename_all = "snake_case"` **explicitly** | 5 | `ToolPerformanceSummary`, `ToolUsageSummary`, `ToolUsageOverTime`, `PersonaUsageSummary`, `FleetHookEvent` |
| Tables whose exported structs **disagree with each other** on casing | **5** | `dev_workspaces` · `n8n_transform_sessions_new` · `audit_incidents` · `persona_memories_new` · `persona_triggers_new` |
| Binding fields typed `bigint` | **288** fields / **142** files (294 textual matches) | 24 of those files are persisted read models — `NightRun` 8, `RevitalizeRunRecord` 9, `WorkspaceHarvestCoverage` 6, `DevScan` 3, `OAuthTokenMetric` 3 |
| `#[ts(type = "…")]` pins working around it | **314** | `core/src/models/execution.rs` alone has 9 |
| `skip_serializing_if` on a persisted read model → `field?:` | **23** | `MemoryReviewProposal` 6 · `BackgroundJob` 11 (across two files) · `PersonaPromptVersion` 5 · `PersonaCurationSchedule` 1 |
| `#[serde(default)]` on a **non-`Option`** persisted field | **21** | `Persona` 5 · `PersonaExecution` 3 · `PersonaTrigger` 3 · `DevUseCase` 2 · … |
| `#[serde(default)]` on an `Option<T>` field (a no-op) | **519** of 867 | tree-wide |
| Binding files not re-exported by `index.ts` | **86** of 1,032 | 0 barrel entries point at a missing file |
| `CHECK IN (…)` columns typed `String` rather than a Rust enum | **92** (vs **11** typed as an enum) | `dev_kpis` 6 · `team_assignments` 3 · `WorkspaceKnowledge` 3 · `DevUseCase` 3 · … |

### Corrections to the brief and to prior findings

- **"19 orphan bindings … imported at 26 sites" understates it.** Measured tree-wide: **31** orphans (a binding filename with no `struct`, `enum`, `type` or `#[ts(rename)]` of that name anywhere under `src-tauri/`), **28 still imported at 30 sites**, 27 of them inside `src/api/**` (the other three are `src/features/plugins/gitlab/hooks/usePipelineNotifications.ts` and both `src/stores/slices/overview/{alertSlice,overviewSlice}.ts`). The 19 in [new-ipc-command](./new-ipc-command.md) is the subset reachable from that path's 55 `serde_json::Value` call sites; this is the superset. Two files were excluded from the count and should not be mistaken for orphans: `index.ts` (the barrel) and `serde_json/JsonValue.ts` (ts-rs's own emission for `serde_json::Value`).
- **"104 commands return `serde_json::Value`" is confirmed** — the `untyped-command-payload` census rule reproduces at 40 files / 104 matches. **What kinds of struct avoid it:** every one of the 358 table-matched structs is reached through a command with a concrete return type; the `Value` population is not row reads at all but *computed* payloads — `json!` literals assembled in the command body (`crud.rs:435`, `:452`), aggregate counts, and status snapshots. **The property that avoids the untyped escape hatch is "this payload is a row, or a list of rows".** A struct that mirrors a table gets a binding; a struct that never existed because the payload was assembled inline does not.
- **`mcp_gateway_members` is the ONLY table in the tree with a foreign key to a table that does not exist.** Every `REFERENCES` target across all 308 parsed tables was resolved: 2 broken references, both from `mcp_gateway_members` (`gateway_credential_id` and `member_credential_id` → `credentials`, which is spelled `persona_credentials`), both at `db/src/migrations/incremental.rs`. **The brief's hypothesis that there are others is wrong.** The generalised class — "a struct whose table cannot accept it" — was searched from the other side too: **30 INSERT statements omit a `NOT NULL`-no-default column, and all 30 are inside `#[cfg(test)]` modules** writing to hand-rolled fixture tables. Production INSERTs are clean. The defect this leaves is different and is listed above: the fixtures are not testing the real schema.
- **Timestamps are not this path's problem, and the measurement says so.** All **505** timestamp-suffixed fields on persisted read models are `String`; **0** are `chrono::DateTime` or an integer. The field-type decision is uniform and already made. [timestamp-storage](./timestamp-storage.md) owns everything that follows from it. This path adds one datum to that document: its P0 "same column, different DDL per install path" claim of **14 columns** does not reproduce — a table-scoped re-parse of every declaration finds **4** columns declared more than once with divergent nullability/default, of which `credential_audit_log.created_at` (`incremental.rs:1046` vs `schema.rs:678`) is the one that matters and is already named there. Re-measure before citing the 14.
- **`CLAUDE.md`'s binding-regen command is wrong and `ci.yml` is right.** `.claude/CLAUDE.md` prescribes `cargo test --manifest-path src-tauri/Cargo.toml export_bindings`. Without `--workspace --features desktop`, **zero** bindings regenerate: `--manifest-path` alone selects only `personas-desktop` (and most `#[ts(export)]` types live in `personas-core`), and without the feature the tauri build script aborts before any export runs. `ci.yml:387` has the correct invocation with the reasoning at `:375-386`.
- **`schema-change.md`'s "219 camelCase vs 41 snake_case across `core/src/models/`" does not reproduce.** Measured over the attribute blocks of the 410 exported structs in that directory: **212 carry a `rename_all`, 198 carry none at all.** Tree-wide the split is 557 camelCase / 5 explicit snake_case / 292 absent. The "41 snake_case" figure appears to have counted only explicit `rename_all = "snake_case"` and missed the much larger population that declares nothing — which produces the same snake_case wire shape by default.

## 8 Gaps in the primitive

1. **ts-rs never deletes, and both gates ask a different question — but the deeper cause is one file per type.** `binding-drift` (`ci.yml:389-407`) runs `git diff src/lib/bindings/` after regeneration; a file whose Rust source is gone is simply not rewritten, so there is no diff. `check-unused-bindings.sh` asks whether a binding is *referenced*, and an orphan that is still imported is referenced. **Neither can detect a stale generated file, by construction**, and 31 exist. Two fixes, and the convergence sweep says the second is the real one:
   - **Cheap:** the inverse check — for each `src/lib/bindings/*.ts`, assert a Rust `struct`/`enum`/`type` of that name exists under `src-tauri/`. ~15 lines, belongs in the existing `binding-drift` job.
   - **Structural, and the one that ends the class:** emit the whole contract into **one** file. `brainiac` does exactly this (`utoipa` → `openapi.json` → `openapi-typescript` → a single 6,624-line `console/src/lib/api-schema.d.ts`, 187 schemas) and has **0 orphans because a rewritten file cannot contain a stale entry**. Personas' 1,032-file emission is what makes deletion invisible; ts-rs's per-type files are the mechanism of the bug, not merely its medium. This is a real migration, not a weekend, but nothing built on the current shape will ever close the class.
2. **ts-rs is telling the truth about Rust and lying about the transport.** `i64`/`u64` → `bigint` is correct for the Rust type and wrong for every Tauri payload, because `serde_json` emits a JSON number and `JSON.parse` returns a `number`. `#[ts(type = "number")]` fixes the type and silently accepts the 2^53 precision loss that motivated `bigint` in the first place. **There is no attribute that says "serialize as a string, type as a string, and let the caller parse"** — the only honest carrier for a genuinely large integer — so a correct answer requires changing the Rust field type to `String`, which changes the database read too. 288 fields are stuck between the two.
3. **Nothing ties the struct's nullability to the column's.** The DDL and the struct are in different crates, in different languages, connected only by a mapper that addresses columns as strings. `rusqlite` will happily compile `row.get::<_, String>("nullable_col")` and fail at runtime on the first NULL row. A compile-time-checked query macro (sqlx's `query_as!`) is the category of fix; `rusqlite` offers nothing in it. This is why §9's second rule targets the DDL: it is the only end of the rope a machine can hold.
4. **`#[serde(default)]` cannot distinguish "the producer omitted this" from "the producer meant the default".** 348 non-`Option` fields carry it, and on a persisted model deserialized from an import bundle that is a silent substitution — the same failure family as an empty `catch`. Serde has no `#[serde(default_but_warn)]`, and there is no place to log from. The only real fix is to remove the attribute and let deserialization fail, which changes the import path's error surface.
5. **The container triple is three separate attributes and nothing requires the third.** A struct compiles, exports, and ships with `#[derive(TS)] #[ts(export)]` and no `rename_all`; the failure is invisible until someone reads the emitted `.ts`. This is the single most-repeated omission in the corpus (292 structs) and it is a pure ergonomics defect: the wrong thing is shorter to type than the right thing. See "Prefer a type over a gate" below.
6. **`CHECK (col IN (…))` and a Rust `enum` are two unlinked declarations of one vocabulary.** Adding a value to the DDL's list does not add a variant; adding a variant does not widen the constraint. 76 constraints, 11 enums, no tie. `lab_tool_calls` (`incremental.rs:5746,5750`) shows the good version of the DDL half and still pairs it with `String` fields.
7. **The barrel is regenerated by a shell one-liner in a comment.** `src/lib/bindings/index.ts:2` carries the command; nothing runs it. 86 of 1,032 bindings are missing from it, so `import { X } from '@/lib/bindings'` works for some types and not others with no rule a reader can infer.
8. **Test fixtures declare their own tables and nothing compares them to production.** 40 production tables have a shadow `CREATE TABLE` in 32 non-migration files. `db/src/lib.rs:1882` `init_test_db()` builds the real chain and is called 369 times in `db/src` — the primitive exists and is good. The fixtures that hand-roll DDL are the ones testing the newest surfaces, which is exactly where a struct/table disagreement would first appear.
9. **No test in the tree inserts a struct and reads it back asserting equality.** The entire nullability contract above — 3,105 pairs, 54 of them wrong — is unverified behaviour. A `#[test]` that writes a fully-populated struct through the repo's own insert function, reads it through the repo's own read function, and asserts field-for-field equality would catch every one of the 43 (the NULL case needs a second row with the optional columns omitted). None exists for any of the 293 read models.
10. **No enforcement reaches `src-tauri/` for any of this.** `npm run check` is TypeScript + ESLint over `src/`; lefthook is eslint + secrets + i18n; `cargo clippy -D warnings` has no opinion about serde attributes or SQL string literals. Every deviation above shipped green.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), this must be answered explicitly before §9 is
written. **For this leaf the answer is yes, twice, and both type-level fixes are cheaper than the
gates that would police them.**

1. **`NOT NULL` in the DDL is the type fix.** A column declared `NOT NULL DEFAULT 0` makes
   `Option<i64>` obviously wrong, makes `row.get::<_, Option<i64>>(…)?.unwrap_or(0)` obviously
   redundant, and makes the 43-field defect class unrepresentable for every future column. 27 columns
   need the one-word edit. The census rule below is the ratchet that stops the 28th; it is not the
   fix. **This is the best-warranted clause in the document** — two sibling repos reached it
   independently at 90/0 and 89/0, and the one sibling that did not (`personas-cloud`) reproduced
   this repo's exact hole on the exact same four columns and then patched the *reader* with a
   declarative override table (§6). Fixing the writer is what the repos without the problem did.
2. **A `#[derive(PersistedModel)]` is the type fix for the container triple.** 292 structs are missing
   `rename_all` because it is a separate line that nothing requires. A derive macro that expands to
   `Serialize, Deserialize, TS`, `#[ts(export)]` and `#[serde(rename_all = "camelCase")]` makes the
   omission impossible to express — the same shape as `FacetedDecisionTable`'s required `emptyTitle`
   and `createLazySection`'s owned fallback. It is ~30 lines in `personas-core`. Landing it converts
   rule 3 below from a permanent gate into a migration counter that ratchets to zero and is deleted.

The one place a type cannot help is the orphan binding: the defect is a *file that still exists*,
which no signature can prevent. That is genuinely a check, and Gap 1 names it.

## 9 The missing gate

### The semantic conditions, stated first

Three, each stack-free:

> **(A)** A generated wire type declares a value the transport cannot carry.
> **(B)** A column's declaration promises the writer something and the reader nothing, so the
> reader's type is a guess.
> **(C)** A type that crosses a serialization boundary leaves its field naming to a default nobody
> chose.

What follows are **one repo's proxies** for these. Per the
[portability test](../research/portability-test.md) a proxy does not travel: an adopting repo
inherits the three sentences and re-derives its own signals against its own generator, its own DDL
dialect and its own casing convention. Each rule below states the precondition its proxy depends on.

### The proxies, and what they key on

**(A) `bigint-binding-field`** keys on the string `bigint` in `src/lib/bindings/**`. Precision is
**100% by construction** — every match was written by ts-rs, and the reasoning that makes it a defect
(`serde_json` emits a JSON number; `JSON.parse` cannot return a `bigint`) applies to all of them
identically. Measured: **142 files / 294 matches** (288 field declarations; the surplus is
`Array<[string, bigint]>` tuple positions, which are the same defect). The 4 comment-only matches the
runner filters are prose. **Precondition:** this repo generates its frontend types with ts-rs v10,
whose default `i64`/`u64` mapping is `bigint`. A repo whose generator emits `number`, or `string`, or
which hand-authors types, has condition (A) wearing entirely different markup and scores zero here.

**(B) `nullable-default-column`** keys on a DDL column definition that carries `DEFAULT` without
`NOT NULL`, in both spellings the repo uses: a line inside a `CREATE TABLE` body, and an
`ALTER TABLE … ADD COLUMN` clause. **Covering the `ADD COLUMN` form is load-bearing, not thorough** —
per [schema-change](./schema-change.md) every future column arrives that way, so a rule that saw only
`CREATE TABLE` bodies would be blind to every new violation while reporting a stable count. Measured:
**4 files / 27 matches. All 27 were opened and read: 27/27 true positives, 0 false positives.** An
independent DDL parser walking all 308 tables agrees on the same 26 `CREATE TABLE` columns, and the
single `ADD COLUMN` case is `persona_executions.retry_count` at `incremental.rs:375`. **Precondition:**
this repo writes DDL as SQL string literals inside Rust, one column per line, with the type keyword
adjacent to the column name. A repo using an ORM schema DSL, a `.sql` migration directory, or a
schema-builder API has the same condition in a different syntax.

**(C) `model-struct-without-rename-all`** keys on a `#[derive(… TS …)]` + `#[ts(export)]` attribute
run reaching `pub struct` with no `serde(rename_all)` anywhere in it, scoped to
`src-tauri/core/src/models/`. Measured: **40 files / 198 matches**, and a separate attribute-block
parser over the same directory independently reports **198**. It is deliberately **struct-level, not
field-level**: adding a field to one of the 198 legacy structs does not move the count, so the gate
only fires when a *new* non-conforming model is authored — the moment when the fix is free.
**Precondition:** this repo homes its persisted models in one directory and expresses wire casing
with a serde container attribute.

### Mechanism — census rules, not scripts

Per the [contract](../golden-path-contract.md) §"Don't write a script", the ratcheting-baseline
mechanism already exists at [`scripts/census/`](../../../scripts/census/). This path publishes three
entries for `scripts/census/rules.json` (merged by the orchestrator via
`scripts/census/merge-published-rules.mjs`, never edited here directly):

```json
{"rules":[
  {
    "id": "bigint-binding-field",
    "goldenPath": "docs/concepts/golden-paths/persisted-model-struct.md",
    "title": "Generated binding field typed bigint, which the IPC transport can never deliver",
    "roots": ["src/lib/bindings"],
    "extensions": [".ts"],
    "signal": {
      "pattern": "\\bbigint\\b",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a ts-rs-generated field typed `bigint`. PROXY FOR the stack-free condition \"a generated wire type declares a value the transport cannot carry\". ts-rs v10 maps i64/u64/CORRECTED 2026-08-14 (this sentence previously claimed usize/isize also map to bigint, which is FALSE and would rewrite correct fields): ts-rs maps i64 and u64 to bigint, but usize maps to number (verified: LedgerAnomalyScore.sample_count is `number`) and isize does not appear in any exported type.parse (which cannot produce a bigint). Verified from the workaround rather than assumed - src/api/companion.ts:744 guards with `typeof raw.totalSignalsCaptured === 'bigint'`, a branch that can never be taken at runtime, and its comment at :722-726 states the coercion exists because the binding uses bigint; src/features/agents/sub_deployment/components/cloud/CloudExecutionRow.tsx:31 writes Number(exec.durationMs) for the same reason. Precision is 100% by construction: every match was emitted by the generator and the argument applies to all of them identically. 288 are field declarations; the balance are tuple positions such as Array<[string, bigint]>, which are the same defect. PRECONDITION (must be re-derived per repo): this repo generates frontend types with ts-rs v10. A repo whose generator emits number or string for 64-bit integers, or which hand-authors its types, has this condition wearing different markup and scores zero here. LEGAL FIX, in order: (1) narrow the Rust field to i32/f64 where the value provably fits, which is the honest fix; (2) `#[ts(type = \"number\")]` where the Rust type must stay 64-bit and the value stays under 2^53 - 314 such pins already exist, core/src/models/execution.rs:36,38,43,46,55 being the densest; (3) for a value that genuinely exceeds 2^53, change the Rust field to String, because JSON has no other honest carrier. Never hand-author a shadowing TypeScript interface - src/api/companion.ts:705-714 is what that costs."
    },
    "baseline": { "files": 142, "matches": 294 },
    "floor": 900
  },
  {
    "id": "nullable-default-column",
    "goldenPath": "docs/concepts/golden-paths/persisted-model-struct.md",
    "title": "Column given a DEFAULT without NOT NULL, so the default binds the writer and promises the reader nothing",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "^[^\\S\\n]*[a-z_][a-z0-9_]*[^\\S\\n]+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|BOOLEAN)(?![^\\n]*NOT[^\\S\\n]+NULL)[^\\n]*\\bDEFAULT\\b|ADD[^\\S\\n]+COLUMN[^\\S\\n]+(?:IF[^\\S\\n]+NOT[^\\S\\n]+EXISTS[^\\S\\n]+)?[\"'`]?[a-z_][a-z0-9_]*[\"'`]?[^\\S\\n]+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|BOOLEAN)(?![^\\n;]*NOT[^\\S\\n]+NULL)[^\\n;]*\\bDEFAULT\\b",
      "flags": "gm",
      "ignoreCommentLines": true,
      "description": "a DDL column definition carrying DEFAULT with no NOT NULL, in both spellings this repo uses: a column line inside a CREATE TABLE body, and an ALTER TABLE ... ADD COLUMN clause. PROXY FOR the stack-free condition \"a column's declaration promises the writer something and the reader nothing, so the reader's type is a guess\". A DEFAULT fires only when the column is omitted from an INSERT; both `INSERT ... (col) VALUES (NULL)` and `UPDATE ... SET col = NULL` still write NULL, so the column is nullable and any non-Option Rust field over it is false. Measured consequence in this repo: 43 persisted read-model fields typed T over a nullable column, and 181 row-mapper sites carrying a defensive row.get(...).unwrap_or(...) - 23 of which sit over columns that are NOT NULL everywhere they are declared, because once the mapper compensates by habit the schema's decisions stop being observable. The ADD COLUMN half of the alternation is load-bearing, not thoroughness: per docs/concepts/golden-paths/schema-change.md every future column arrives through ALTER TABLE ... ADD COLUMN at incremental.rs, so a CREATE-TABLE-only rule would be blind to every new violation while reporting a stable count. Precision measured by reading all 27 matches: 27/27 true positives, 0 false positives; an independent DDL parser over all 308 tables agrees on the same set. For scale, this repo already declares 874 columns as NOT NULL DEFAULT - the correct form is the overwhelming majority and this is a closable backlog, not a systemic failure. PRECONDITION (must be re-derived per repo): this repo writes DDL as SQL string literals inside Rust, one column per line, with the type keyword adjacent to the column name. A repo using an ORM schema DSL, a .sql migration directory, or a schema-builder API has the same condition in a syntax this pattern cannot see. LEGAL FIX: write NOT NULL DEFAULT together. That is the type-level fix - it makes the wrong struct field unrepresentable rather than counted - and it is one word."
    },
    "baseline": { "files": 4, "matches": 27 },
    "floor": 900
  },
  {
    "id": "model-struct-without-rename-all",
    "goldenPath": "docs/concepts/golden-paths/persisted-model-struct.md",
    "title": "Exported model struct that declares no serde casing, so its wire shape is chosen by a default nobody picked",
    "roots": ["src-tauri/core/src/models"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "#\\[derive\\([^)]*\\bTS\\b[^)]*\\)\\]\\s*(?:#\\[(?!serde\\s*\\([^\\]]*rename_all)[^\\]]*\\]\\s*)*#\\[ts\\([^\\]]*export[^\\]]*\\]\\s*(?:#\\[(?!serde\\s*\\([^\\]]*rename_all)[^\\]]*\\]\\s*)*pub struct",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "an attribute run that derives TS and carries #[ts(export)] but no #[serde(rename_all = ...)], reaching `pub struct`. PROXY FOR the stack-free condition \"a type that crosses a serialization boundary leaves its field naming to a default nobody chose\". The negative lookahead inside the attribute-run repetition is what makes this work: the run cannot consume a rename_all attribute, so a conforming struct fails to reach `pub struct` and does not match. Consequence measured tree-wide: 292 of 854 exported structs declare no casing, 290 of which have at least one snake_case field, so the generated binding surface is split - src/lib/bindings/PersonaExecution.ts is persona_id/input_tokens/created_at while src/lib/bindings/MemoryReviewProposal.ts is personaId/reviewedCount/createdAt - and 5 tables (dev_workspaces, n8n_transform_sessions_new, audit_incidents, persona_memories_new, persona_triggers_new) are read by exported structs that disagree with EACH OTHER on casing. Deliberately STRUCT-LEVEL, not field-level: adding a field to one of the 198 legacy structs does not move the count, so this fires only when a NEW non-conforming model is authored, which is the moment the fix is free. A field-level variant over the generated output was measured (303 files / 1482 matches) and REJECTED - see the golden path section 9. Two independent implementations agree on 198. PRECONDITION (must be re-derived per repo): this repo homes its persisted models in one directory and expresses wire casing with a serde container attribute. LEGAL FIX: add #[serde(rename_all = \"camelCase\")]. The durable fix is a #[derive(PersistedModel)] that emits the whole container triple, after which this rule ratchets to zero and is deleted."
    },
    "baseline": { "files": 40, "matches": 198 },
    "floor": 50
  }
]}
```

**Validated standalone before publishing.** `node scripts/census/run-census.mjs --rules
<scratch>.json --check` reports:

```
  OK   bigint-binding-field             142/142 files   294/294 matches   1034 walked  floor 900
  OK   nullable-default-column            4/4   files    27/27  matches    963 walked  floor 900
  OK   model-struct-without-rename-all   40/40  files   198/198 matches     77 walked  floor  50
  census OK — 3 rule(s), 2074 file-visits, 519 surviving violation(s) across 186 file(s).
```

`963 walked` for the `src-tauri` root is exactly `rust.files` in
[`shared-facts.json`](../shared-facts.json) — two independently derived counts agreeing, which is the
only reason to trust either. `floor: 900` matches the other three `src-tauri`-rooted rules
deliberately: two rules over one root must not hold two opinions about what "the Rust tree is intact"
means. For `src/lib/bindings` the walk sees 1,034 files and the floor is 900; that directory only ever
grows in practice, because ts-rs never deletes (Gap 1). For `core/src/models` the walk sees 77 files
and the floor is 50.

**Fault injection against the real tree**, because a gate that cannot fail is not a gate. Each row is
a single-field mutation of the validated rule set, run with `--check`:

| Induced fault | Exit |
|---|---|
| baseline, unmutated | **0** |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES`) | **1** |
| floor above the walk (`floor: 5000` on a 1,034-file root) | **1** |
| silent drop (baseline claims 400 where 294 exist) | **1** |
| count rises (baseline claims 100 where 294 exist) | **1** |
| renamed root (`src/lib/bindings` → `src/lib/bindingz`) | **1** |
| renamed Rust root (`src-tauri` → `src-tauri-x`) | **1** |
| stale `exclude` entry (a path matching no file) | **1** |

**No `exclude` entries on any of the three.** Rules A and C have no legitimate exception — the
primitive itself is a Rust attribute, not a file. Rule B's only candidate exemptions would be whole
migration files, and a stale exemption is how an allowlist becomes the bug.

### What this does NOT gate, and why — three refusals

1. **Field-level casing (rejected).** A variant of rule C keyed on snake_case field names in the
   generated output measures **303 files / 1,482 matches** at ~100% precision on a 24-file sample.
   It is still the wrong gate: because it counts *fields*, adding one field to any of 303 legacy
   bindings trips it, and the only conforming fix is renaming a public type's entire wire shape —
   a breaking frontend change. The predictable outcome is habitual `npm run census -- --update`,
   which trains exactly the reflex the census exists to prevent. The struct-level rule catches the
   same condition at authoring time for a 198-item baseline that only moves on a new type. **Refusing
   a high-precision signal because its ratchet would be routinely overridden is a real outcome, not
   a compromise.**
2. **Orphan bindings (not countable — and gating is the second-best answer anyway).** "This generated
   file has no Rust source" is a *relational* property across two trees; a census rule counts
   occurrences within one file. It needs the ~15-line check named in Gap 1, in the existing
   `binding-drift` CI job, next to the two gates that already cannot see it. That job is live and
   correctly configured, so the check has a home. **But note what the convergence sweep found before
   investing in it:** the sibling with the same problem shape has zero orphans not because it checks
   for them but because its generator rewrites one file instead of emitting 1,032. A gate here counts
   a class that a different emission shape would not have.
3. **Struct/column nullability agreement (needs behaviour, not shape).** The 43+11 mismatches were
   found by joining a DDL parse to an attribute parse across 3,105 field↔column pairs. That is not a
   regex, and it should not be a static analysis at all — the right host is the **round-trip test**
   in Gap 9: write a fully-populated struct through the repo's own insert, read it back through the
   repo's own read, assert field-for-field equality; then write a second row omitting every optional
   column and assert the read still succeeds. That inverts "parse two languages and compare" into
   "observe the behaviour", and satisfies the model-effort guide's warning that *a gate that asserts
   data is not a gate on behaviour*. **It must run under `cargo test --workspace`**: `npm run
   test:rust` passes `--lib` against the root manifest, so a test placed in `personas-db` would be
   written, merged, and never executed locally. `ci.yml:275` is `cargo test --workspace
   --manifest-path src-tauri/Cargo.toml --features desktop`, so the lane is live in CI; locally use
   `cargo test -p personas-db` or `npm run test:rust:crates`.
