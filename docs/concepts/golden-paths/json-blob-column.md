# Golden path — JSON blob column

> Situation node: `data-persistence/data-modeling/json-blob-column` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a ground-truth sweep of the Rust tree (`src-tauri/{src,db,core,engine,data,macros}` —
> 954 `.rs` files), the four migration files (253 tables / 2,959 columns parsed), `src/**` (318 `JSON.parse`
> sites / 231 files), and `src/lib/bindings/`, against `master` @ `d5a7ead13`. `target/` and
> `.claude/worktrees/**` excluded from every count. Production and `#[cfg(test)]` call sites were counted
> **separately** — a distinction that overturns one of this path's founding claims. SQLite `json_valid`
> semantics were verified by running them (sqlite3 3.50.6).
> Dimensions: **function · resilience · code-quality**. Two-sided: Rust column handling · TS decode · the contract between them.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

## Trigger

- "Store this config / tags / metadata / settings as JSON in a column"
- "Add a `*_json` column" / "just stash the blob in TEXT for now"
- "Parse the config out of the row" / "why is this field a string on the frontend?"
- "The persona's model profile got wiped" / "my trigger config came back empty"
- "This row vanished from the list and there's no error"
- "Should this be a column or its own table?"

If you are about to type `pub something_json: String`, `TEXT NOT NULL DEFAULT '[]'`, `serde_json::from_str(&row_value)`, `serde_json::to_string(&x).unwrap_or_default()`, `JSON.parse(persona.model_profile)`, or `json_extract(config, '$.foo')` inside a `WHERE` clause — you are in this situation.

## The one way

**Decide first whether it is a blob at all** (§ *Is this actually a blob?* below) — a JSON column is correct only when the value is read and written whole, never filtered on, and never joined. If it survives that test, give the column **three agreeing declarations and one owner**: in DDL, `TEXT` with `CHECK (col IS NULL OR json_valid(col))`; in Rust, `Json<T>` from `personas_core::models` with a real `T` — never `String`; in TypeScript, whatever ts-rs emits from that `T` — never a hand-written `JSON.parse`. `Json<T>` serializes through `ToSql`/`FromSql` and delegates ts-rs transparently, so the frontend receives a typed object and the decode disappears entirely. That is the whole point: **the correct number of `JSON.parse` calls on the client for a well-modelled column is zero.** Where you genuinely cannot type `T` (a heterogeneous or user-extensible payload), keep the column as `String` but decode it through exactly one named function per column that returns `[data, error]` — `safeJsonParse` on the client, an explicit `match` on the server — and apply the repo's one non-negotiable rule for both sides: **a decode failure must never trigger a write.** Corrupt bytes are recoverable; bytes overwritten by a default are not. Then stop: no `unwrap_or_default()` on a serialize, no `.ok()` that silently discards a column, no per-component `try { JSON.parse } catch { return '' }`.

The repo today holds two coherent-but-opposite strategies with no rule for choosing between them, which is why neither works: `Json<T>` validates but escalates any single-field corruption into a **whole-row disappearance**, and raw `String` never escalates but pushes the failure to 639 unsupervised call sites. This path picks `Json<T>` plus a DDL constraint, because the constraint moves the failure to *write* time where the bad bytes are still in memory and can be rejected — the only point in the lifecycle where the error is actionable.

## Is this actually a blob? — the prior question

A JSON column is the right choice when **all** of these hold:

1. **Read and written whole.** The application always loads the entire value and always replaces the entire value.
2. **Never a filter or join key.** No `WHERE`, `ORDER BY`, `GROUP BY`, or `JOIN` ever reaches inside it.
3. **No cardinality.** You never need "how many", "the third one", or "every row that contains X".
4. **Schema is genuinely open** — user-extensible, provider-specific, or versioned faster than migrations can follow.

Fail any one and it is a table. The signal that a column has outgrown its blob is **`json_extract` in a `WHERE` clause**: it is a full scan plus a JSON parse per row, and SQLite cannot index it unless you build an explicit expression index. This repo has **68 `json_extract`/`json_each` call sites** and **zero expression indexes over them** across **516** `CREATE INDEX` statements — every structural query over a blob here is a full table scan. `db/src/repos/resources/triggers.rs` alone holds **25** of them, filtering `persona_triggers.config` on `$.event_type`, `$.listen_event_type`, `$._handler_key` and `$._auto_for_trigger` (`:1188-1190`, `:1312`, `:1321`, `:1330`, `:1447-1450`). Those four paths are relational keys wearing a blob's clothes.

The repo has already done this migration correctly **once**, and it is the template: `lab_tool_calls` (`db/src/migrations/incremental.rs:5580-5607`), commented *"1:N replaces JSON-array columns"*. It has typed `CHECK(...IN (...))` constraints on both enum columns, a `UNIQUE(result_id, variant, sequence)` that makes ordering a schema guarantee rather than an array-index convention, two indexes, a backfill (`:5606`) and a drop of the legacy columns (`:5607`). During the transition `db/src/repos/lab/mod.rs:68-105` dual-writes with the honest log line *"Failed to dual-write lab_tool_calls; JSON column remains canonical"* — the old column stays authoritative until cutover, so a partial child-table write cannot corrupt user data. **Copy this sequence** (add table → dual-write with the blob canonical → backfill → cut over → drop) whenever a blob fails the four-point test.

## Mandated primitives

**Exist today — use them:**

- **`src-tauri/core/src/models/json_column.rs:27` — `Json<T>`.** The newtype. `ToSql` serializes (`:83-89`), `FromSql` deserializes *and validates* (`:91-98`), `Serialize`/`Deserialize` are transparent (`:69-79`), and the `ts_rs::TS` impl (`:102-133`) delegates every method to `T` so the binding shows the real type. `Deref`/`DerefMut`/`From<T>` make it invisible at use sites. **Currently 22 field declarations across 7 files.**
- **`src/lib/utils/parseJson.ts:26` — `safeJsonParse<T>(json, guard?) → [data, error]`.** The only decode in the repo that lets a caller distinguish *absent* from *corrupt*, with an optional runtime type guard. **This is the correct client primitive and none of the 149 column-decode sites use it.**
- **`src/lib/utils/parseJson.ts:2` — `parseJsonOrDefault<T>(json, fallback)`.** Acceptable **only** for a value that is never written back. 31 call sites / 23 files.
- **`db/src/repos/utils.rs:33` — `collect_rows(rows, context)`.** Keeps a list endpoint alive when one row fails to map. Correct as written — but understand what it does to `Json<T>` before you rely on it (see Gaps 1).
- **`src-tauri/core/src/crypto.rs:1687` — `encrypt_trigger_config` / `:1731` `decrypt_trigger_config`.** Field-level encryption that deliberately leaves non-sensitive keys in plaintext *"so that SQL `json_extract()` continues to work for querying trigger properties"* (`:1683-1684`). The right way to encrypt inside a blob.
- **`CHECK (col IS NULL OR json_valid(col))`** — SQLite's built-in. Verified 2026-08-13 against sqlite3 3.50.6: `json_valid('')` → `0`, `json_valid('not json')` → `0`, `json_valid('null')` → `1`, `json_valid(NULL)` → `NULL` (hence the `col IS NULL OR` guard), and an `INSERT` of `''` fails with `CHECK constraint failed`. **Used as a constraint on 0 of 145 JSON columns** — though the repo already knows the function (see next entry), which is the whole tragedy.
- **`json_set(col, '$.path', ?)` — mutate a blob in place.** `src/commands/core/use_cases.rs:547` renames an event type across every trigger with a single `UPDATE ... SET config = json_set(config, '$.event_type', ?1)`. This is the direct answer to the read-parse-rebuild-write anti-pattern: there is no decode step, so there is no decode failure to mishandle, and one malformed row cannot destroy another. Reach for it before writing a Rust round-trip.
- **`json_each(col)` for element matching.** `db/src/repos/resources/audit_log.rs:288-291` matches a tool name as an **exact array element** rather than a substring, having been burned by the `LIKE '%' || name || '%'` form reporting a tool named `git` as a dependent of `github`/`gitlab` and *"inflating the revocation blast radius"* (`:276-279`).

**Do not exist — this path defines them; create them before writing new code:**

- **`personas_core::models::json_column::try_from_sql_lossy<T>`** — a `FromSql` variant that yields `Option<T>` instead of failing the row, for columns where a field-level loss must not delete the record. Closes Gaps 1 without abandoning the newtype.
- **`decodeColumn<T>(raw, guard, opts)`** in `src/lib/utils/parseJson.ts` — wraps `safeJsonParse`, and on error returns a value *tagged corrupt* so the calling surface can do what `PersonaDraft` does (warn + block writes) without each site reinventing it. It is the generalization of `checkModelProfileIntegrity`.

## Steps

1. **Run the four-point test above.** If it fails, build the table — follow the `lab_tool_calls` sequence. Stop here.
2. **Declare the column** `TEXT` with `CHECK (col IS NULL OR json_valid(col))`, plus `NOT NULL DEFAULT '{}'` or `'[]'` when the value is mandatory. On a new table, put it in the `CREATE TABLE`. On an existing table, `ALTER TABLE t ADD COLUMN c TEXT CHECK (c IS NULL OR json_valid(c))` — **verified to work and to be enforced**. You cannot add a constraint to an *existing* column: `ALTER TABLE ... ADD CONSTRAINT` is a syntax error in SQLite (verified), so that case needs the 12-step table rebuild or the scan in §9.
3. **Define `T`** as a real Rust struct or enum with `#[derive(Serialize, Deserialize, TS)] #[ts(export)]`. If you are reaching for `serde_json::Value`, re-read step 1 — an untypeable payload is usually an unmodelled one.
4. **Declare the field** `Option<Json<T>>` (or `Json<T>` when `NOT NULL`). Never `String`. Never `#[ts(type = "unknown")]` unless you hit Gaps 2, and then link the gap.
5. **Bind it directly.** `params![input.field]` and `row.get("field")` — the `ToSql`/`FromSql` impls fire through type inference; no turbofish, no `serde_json::to_string`, no `from_str`. If you find yourself writing `.map(|j| serde_json::to_string(&j.0)...)` you have unwrapped the newtype and thrown away its guarantee.
6. **Regenerate bindings** — `cargo test --manifest-path src-tauri/Cargo.toml export_bindings`, commit `src/lib/bindings/`. Confirm the field's TS type is the real shape, not `string`.
7. **Consume it as an object on the client.** No `JSON.parse`. **And then stop** — the primitive has taken over; there is nothing left to write.
8. **Only if `T` is genuinely untypeable:** keep `String`, and write exactly one decode function per column, named for the column, returning `[data, error]` via `safeJsonParse`. Every caller of it must treat `error` as *"render a warning and disable the write path"* — never as *"substitute a default"*.

## Anti-patterns

- **`serde_json::to_string(&x).unwrap_or_default()`** — **70 sites** (54 plain, 16 `to_string_pretty` mostly in log arguments). On failure this writes **the empty string** into the column. `''` is not valid JSON (verified: `json_valid('') = 0`), so a *write* fault is converted into a *read* fault at every downstream consumer, arbitrarily later, with the original value gone. The correct fallback already exists in this repo — `db/src/repos/core/personas.rs:132,150` uses `unwrap_or_else(|_| json.to_string())`, falling back to *the original bytes*. Same operation, same column family, right answer 27 lines away from where the wrong one is used.
- **Hashing an `unwrap_or_default()` serialization.** `engine/src/prepared_run_cache.rs:55` folds `to_string(tools).unwrap_or_default()` into a cache key, so every input that fails to serialize hashes identically and collides — returning another run's cached result. `engine/src/workspace_sync/snapshot.rs:65` does the same in `canonical_content_hash`, which drives cross-device last-writer-wins sync: two entities that both fail to serialize get the identical `sha256:e3b0c442…` and the merge treats them as the same content. Worse than an empty column — this is silent cross-entity data loss. Note `prepared_run_cache.rs:58-61` uses `.and_then(|v| to_string(v).ok()).unwrap_or_default()` for the very next field: two spellings of the same bug, four lines apart.
- **`serde_json::from_str(...).ok()` on a column read** — **136 production sites**. Discards the distinction between "this row has no config" and "this row's config is corrupt". `engine/src/prompt/capabilities.rs:52-58` (`parse_model_profile`) does this for `personas.model_profile`: a corrupt profile means the persona silently runs on default model, provider, and budget.
- **Parse-fail → rebuild → **write back**.** `db/src/repos/resources/triggers.rs:593-602` warns, synthesizes a minimal object from `system_prompt`, and then at `:630-638` **`UPDATE personas SET structured_prompt = ?1`**. One transient parse failure permanently replaces the persona's entire structured prompt with a two-field stub. Everything not named `identity` is gone. This is the single most destructive pattern in the situation, and it is the *only* one of the three policies in that file that writes.
- **Different corruption policies for the same column in the same file.** `triggers.rs` handles `personas.structured_prompt` corruption at `:593` (warn → rebuild → **write**) and at `:667-673` (warn → `return Ok(())`, **preserve bytes**) — 70 lines apart, opposite outcomes. A third at `:801-805` substitutes `Value::Null` for a corrupt `persona_triggers.config`, which makes the `_handler_key` lookup at `:806-810` return `None`, so the handler entry is never removed and the persona keeps an orphaned event handler forever.
- **`pub something_json: String`** — **96 declarations across 37 files**. Names the encoding in the field, then makes every consumer re-derive the schema. Already flagged for one model in `docs/harness/refactor-perf-2026-07-16/tauri-db-models-2-4.md:28` (*"`Json<T>` wrapper exists but is unused here"*) — that finding is correct and still unfixed.
- **`json_extract` in a `WHERE` clause with no expression index** — 68 sites, 0 indexes. See § *Is this actually a blob?*
- **`LIKE '%…%'` over a JSON blob** to find a key — flagged at `docs/harness/bug-hunt-2026-06-16/repositories-models.md:47`; substring matching over JSON is both unindexable and semantically wrong (it matches values, keys, and fragments alike). Already fixed once, with the scar tissue recorded: `db/src/repos/resources/audit_log.rs:276-291` replaced it with `json_each` after it over-reported credential revocation dependents.
- **Read → parse → mutate → serialize → write, in Rust, for a single field.** Five failure points where SQLite offers zero: `json_set` (`use_cases.rs:547`) does it in one statement. `triggers.rs:593-638` is the read-modify-write form of exactly this operation and is the most destructive site in the sweep.
- **Bare `JSON.parse` in a component render body** — `src/features/fleet/monitor/channels/DeliberationRail.tsx:42,45`. Two unguarded parses of `detail.pendingAction` and `detail.resolution` directly in the render path: malformed bytes throw during render and take out the subtree.
- **`catch { return '' }` on a column the same surface writes back.** `src/features/agents/components/QuickEditPanel.tsx:14-22` — silently returns `''` for a corrupt `persona.model_profile`, and `:37-43` then diffs against that `''` and calls `onSave`. Exactly the clobber that `checkModelProfileIntegrity` was written to prevent, on exactly the same column.
- **Decode → mutate → re-encode with a `catch { [] }`.** `src/features/agents/sub_editor/components/DeepFanoutToggle.tsx:25-31` falls back to an empty array on a malformed `persona.parameters`, edits it, and writes it back — silently deleting every other parameter.
- **Re-implementing the shared decode helper.** Six local variants exist alongside `parseJson.ts`: `lib/types/types.ts:348` (a private `safeJsonParse` that *shadows the exported name with different semantics*), `vault/.../EventConfigSubPanels.tsx:8`, `templates/sub_recipes/libs/recipeAdapter.ts:93`, `teams/sub_mastermind/lib/layoutStore.ts:155`, `templates/sub_diagrams/NodePopover.tsx:11`, `plugins/dev-tools/sub_context/contextMapTypes.ts:25` (the only one that delegates).
- **Typing the same column two ways in two bindings.** `src/lib/bindings/N8nTransformSession.ts:4` declares `parser_result: string | null, draft_json: string | null, questions_json: string | null`; `src/lib/bindings/N8nSessionResponse.ts:12` declares the identical columns as `JsonValue | null`. The contract is ambiguous at the type level, so the client both hand-encodes (`transformReducer.ts:134,161`) and receives pre-decoded objects for one column.

## Evidence

Adoption is partial and the correct answers are scattered, so copy per half:

- **`src-tauri/core/src/models/json_column.rs:83-98` — copy this one.** The whole doctrine in 16 lines: `ToSql` propagates a serialize failure as `ToSqlConversionFailure` instead of substituting a default; `FromSql` propagates a parse failure as `FromSqlError::Other` instead of dropping the field. Neither ever invents a value. Every deviation above is a site that chose to invent one.
- **`src-tauri/db/src/repos/core/personas.rs:101-152` — the reference for handling untrusted blob bytes.** Three correct decisions in one function: parse failure returns the input **unchanged** (`:104`) rather than a default; a non-object returns it unchanged (`:109`); and both re-serialize paths fall back to `unwrap_or_else(|_| json.to_string())` (`:132`, `:150`) — the original bytes, never `''`. Even the decrypt-failure path preserves the envelope and *adds* an `auth_token_error` marker (`:146-149`) so the UI can explain itself. **This is the model for every `to_string` in the repo.**
- **`src-tauri/core/src/crypto.rs:1677-1684`** — the one place that reasons explicitly about the blob-vs-query tension: only `["webhook_secret", "headers"]` are encrypted, *"so that SQL `json_extract()` continues to work for querying trigger properties."* Field-level, not blob-level, and the reason is written down.
- **`src-tauri/db/src/migrations/incremental.rs:5580-5607` + `db/src/repos/lab/mod.rs:68-105`** — the blob→table migration done right, including the dual-write window with the JSON column canonical.
- **`src/features/agents/sub_editor/libs/PersonaDraft.ts:88-110, 146-160`** — the client half's exemplar, and the only fully-realised instance of the correct policy in `src/`. `checkModelProfileIntegrity` returns `{ok:false, rawLength, message}`; `hooks/useEditorDraft.ts:34-43` turns that into `suppressModelSave`; `libs/useEditorSave.ts:220` gates the 800 ms debounced autosave on it; `useEditorDraft.ts:102-104` tells the user *"Auto-save is paused for model fields. Pick a model to repair, or restore from a backup."* **Warn, explain, and refuse to write** — the three things every other decode site skips.
- **`src/api/credentials/scopedResources.ts:32-38`** — re-throws on a malformed payload with the comment *"Do NOT silently collapse to `{}`"*. The right instinct, stated.
- **`src/lib/channel/teamBridgeSpec.ts:62`** — *"malformed — never guess, never overwrite."* The rule of this path in five words.
- **`src/commands/infrastructure/context_map_export.rs:296-301`** with its test `parse_json_array_tolerates_garbage` (`:413-420`) — a per-column decode helper that is *tested against garbage*. Four assertions, including `object → empty`. Copy the shape whenever step 8 applies.
- **`src/commands/core/use_cases.rs:538-566` and `db/src/repos/resources/audit_log.rs:274-291` — the repo arguing this path's case against itself.** Both bulk-operate on a JSON column and both guard with `AND json_valid(col)`, each explaining why: *"json_valid guards malformed configs so one bad row can't abort the whole rename"* and *"json_valid guards legacy rows with malformed `services` (SQLite short-circuits the AND so json_each is never run on invalid JSON)."* The reasoning is exactly right — and it is the argument for §9. **These are the only three `json_valid` uses in the tree, all of them defensive read-time workarounds for data that a one-line DDL constraint would have made impossible.** The repo reached for the correct tool at the wrong end of the pipeline.

## Deviations found

| Category | Count | Where |
|---|---:|---|
| **P0** JSON columns with no `CHECK(json_valid)` | **145 of 145** | 84 unambiguous (52 `*_json` suffix ∪ 42 `DEFAULT '[]'/'{}'`, 10 overlap) + 61 un-suffixed, across 253 tables |
| — `json_valid` used as a DDL constraint | **0** | …while **3** read-time guards work around its absence (`use_cases.rs:549,565` · `audit_log.rs:288`) |
| **P0** `to_string(..).unwrap_or_default()` → writes `''` | **70** (54 plain · 16 pretty) | 45 `src/` · 15 `engine/` · 10 `db/` |
| **P0** Empty-string serialization folded into a **hash** | **2** | `engine/src/prepared_run_cache.rs:55` · `engine/src/workspace_sync/snapshot.rs:65` |
| **P0** Parse-fail → rebuild → **write back** | **1** | `db/src/repos/resources/triggers.rs:593-602` + `:630-638` |
| **P0** Bare `JSON.parse` in a render body | **2** | `fleet/monitor/channels/DeliberationRail.tsx:42,45` |
| Raw `pub *_json: String` fields | **96 / 37 files** | 54 `core` · 37 `src` · 4 `db` · 1 `engine` |
| Un-suffixed JSON-TEXT columns typed `String` | **61 / 51 tables** | `summary` 16 · `metadata` 11 · `tags` 9 · `config` 6 · `payload` 5 · `structured_prompt` 4 · `input_data` 4 · `model_profile` 2 · `output_data` 2 · `execution_flows` 1 · `tool_steps` 1 |
| `Json<T>` adoption | **22 fields / 7 files** | `lab.rs` 8 · `execution.rs` 4 · `memory.rs` 3 · `test_run.rs` 3 · `types.rs` 2 · `export_types.rs` 1 · `test_runner.rs` 1 |
| Production Rust `from_str` sites | **639** | + 199 test-only |
| Production Rust `to_string` sites | **340** | + 92 test-only |
| — inside `db/src/repos` proper | **49 reads / 43 writes**, 28 files | the DB boundary, where the newtype should have made these zero |
| Distinct **read** failure policies (production) | **8** | hard-fail 188 · silent `.ok()` 136 · `if let Ok` skip 89 · `match` arms 82 · `unwrap_or_default` 37 · `unwrap_or(lit)` 27 · `unwrap_or_else` 27 · panic 1 |
| Distinct **write** failure policies (production) | **6** | hard-fail 133 · **`unwrap_or_default` 68** · `unwrap_or_else` 65 · `.ok()` 34 · panic 5 · `unwrap_or(lit)` 4 |
| `json_extract`/`json_each` sites | **68** | `triggers.rs` 25 · `use_cases.rs` 5 · `audit_log.rs` 5 · `crypto.rs` 5 · … |
| Expression indexes over `json_extract` | **0** of 564+ `CREATE INDEX` | every structural blob query is a full scan |
| Frontend `JSON.parse` sites | **318 / 231 files** | 149 decode a backend column · 49 storage · 34 LLM/HTTP · 86 other |
| — using `safeJsonParse`/`parseJsonOrDefault` | **0 of 149** | helper has 31 users, a disjoint set |
| Distinct frontend failure policies | **7** | `→ {}`/`[]` 37 · `→ null` 28 · `silentCatch` 26 · rethrow 6 · **warn+suppress 3** · `→ ''` 1 · **bare 2** (+ ~46 shape-guard variants) |
| Competing local decode helpers in `src/` | **6** | incl. `lib/types/types.ts:348` shadowing the exported `safeJsonParse` name |
| Bindings with `*_json: string` | **22 fields / 16 files** | vs 7-8 fields typed structurally via `Json<T>` |
| Same column typed two ways across bindings | **4 columns** | `N8nTransformSession.ts:4` (`string`) vs `N8nSessionResponse.ts:12` (`JsonValue`) |
| `tags` typed inconsistently | **2** | `ExecutionAnnotation.ts:12` `Array<string>` vs `MemorySnapshot.ts:11` `string \| null` |

### `personas.model_profile` — the whole situation in one column

Eight independent corruption policies on the same bytes, spanning both sides of the IPC boundary. It is the most-handled JSON column in the repo and no two handlers agree:

| Site | Policy |
|---|---|
| `db/src/repos/core/personas.rs:52-54` (`encrypt_model_profile`) | **hard reject** — `AppError::Validation("Invalid model_profile JSON")` |
| `db/src/repos/core/personas.rs:104` (`decrypt_model_profile`) | **pass through unchanged** — preserves the bytes (correct) |
| `engine/src/prompt/capabilities.rs:52-58` (`parse_model_profile`) | **silent `.ok()`** — persona runs on defaults, no signal |
| `src/engine/runner/mod.rs:133-138` | **`.ok()` → `unwrap_or_default()`** — corrupt profile becomes an empty map… |
| `src/engine/runner/mod.rs:159,172` | …**then `to_string(..).unwrap_or_default()`** re-assigns it, so all non-cascade fields are dropped |
| `src/features/agents/sub_editor/libs/PersonaDraft.ts:89,151` | **warn + suppress autosave** (correct) |
| `src/features/agents/components/QuickEditPanel.tsx:14-22` | **silent `return ''`**, then `:37-43` diffs against it and calls `onSave` |
| `teams/.../useTeamStudioData.ts:64` · `agents/sub_use_cases/libs/useCaseDetailHelpers.ts:108` · `templates/draft-editor/DraftSettingsTab.tsx:17` | three further hand-rolled decodes |

The frontend's careful `suppressModelSave` gate protects the column from the editor — and `QuickEditPanel`, a different component on the same screen family, writes to it with no gate at all.

### Corrections to the prior findings

The claims in `docs/concepts/discovery/discovery-server-data.json:530` were measured against the tree. Most understate the problem; two are wrong.

- **"used ~19 times, ZERO of them inside `db/src/repos`"** → **22 field declarations**, and the "zero in repos" claim is **false in both directions**. `db/src/repos/lab/mod.rs:72-73` takes `Option<&Json<Vec<String>>>` in production code — but uses only `Deref` to iterate, never `ToSql`. Meanwhile `Json<T>`'s `ToSql`/`FromSql` **do** fire inside repos, via type inference rather than turbofish: `db/src/repos/execution/executions.rs:88,100` (`row.get("execution_flows")`, `row.get("tool_steps")`) and `:814,821` (`params![input.execution_flows, input.tool_steps]`). The newtype is fully wired for `persona_executions`. The real defect is subtler and worse: `db/src/repos/core/memories.rs:350,569,1144` accept a `Json<Vec<String>>` and immediately **unwrap it** — `.map(|j| serde_json::to_string(&j.0).unwrap_or_default())` — discarding the validated `ToSql` in favour of the empty-string-on-failure path. The guarantee reaches the repo boundary and is deliberately dismantled there.
- **"65+ raw `*_json: String` fields"** → **96** `pub *_json: String|Option<String>` declarations across 37 files, plus **61** un-suffixed JSON columns also typed `String`.
- **"~80 hand-rolled parse/serialize sites"** → **979 production sites** (639 `from_str` + 340 `to_string`) tree-wide; **92** inside `db/src/repos`. The ~80 figure appears to have counted only the repos layer, and undercounts it.
- **"five different failure policies"** → **8 for reads and 6 for writes** on the server, **7** on the client.
- **"`triggers.rs:593` and `:801` picking two of them ~200 lines apart"** → correct that they differ, but both `warn!` — they differ in *recovery value* (rebuild-from-`system_prompt` vs `Value::Null`), and the file holds a **third** at `:667-673`. The material distinction the claim misses is that `:593` is the only one that **writes**, which is what makes it destructive.
- **"~35 parse sites across 27 files" on the client** → **149 column-decode sites**, within 318 `JSON.parse` calls across 231 files. A ~4× undercount.
- **"four failure policies" on the client** → **7**, including two **bare** parses with no `try` at all.
- **"only `PersonaDraft.ts:146` gets it right"** → correct and confirmed (the function spans `:146-160`, and the suppression is wired through three files), but it is not alone: `hooks/utility/data/useEngineCapabilities.ts:60-64` sets a `loadCorruptedRef` guard, and six sites re-throw rather than substitute. Three sites total implement warn+suppress.
- **NEW — the claim nobody made:** a shared client helper **already exists**. `src/lib/utils/parseJson.ts:26` `safeJsonParse` returns `[data, error]` — precisely the primitive this situation needs — and **0 of the 149** column decodes use it.
- **CORRECTION IN THE REPO'S FAVOUR:** `.unwrap()`/`.expect()` on `from_str` looks alarming at **121 sites**, but a production/test split shows **all 121 are inside `#[cfg(test)]` modules — zero production panics on a JSON parse.** Any count that reports 121 panic sites (including a naive grep of this same pattern) is wrong. The discipline here is real and should not be "fixed".

## Gaps

1. **`Json<T>`'s blast radius is the whole row, and that is why nobody adopts it.** `FromSql` returns `FromSqlError::Other` (`json_column.rs:96`), which becomes a `rusqlite::Error`, which the `?` in the row mapper propagates, which `collect_rows` (`db/src/repos/utils.rs:41-49`) catches — logging a `warn` and **dropping the row**. So one corrupt `tool_steps` blob does not degrade one field; it makes the entire execution **vanish from the list with a successful response**. This was independently found at `docs/harness/bug-hunt-2026-06-16/repositories-models.md:37`. Raw `String` has the opposite profile: the row always loads and the corruption surfaces at 639 unsupervised call sites. There is no middle option today, and the absence of one — not laziness — is what froze adoption at 22 fields. `try_from_sql_lossy` is the missing rung.
2. **ts-rs cannot resolve `serde_json::Value` nested inside `Json<T>`.** Documented at `core/src/models/execution.rs:23-29`: *"ts-rs doesn't resolve the `serde_json/JsonValue` subdir import when the type is wrapped in `Json<T>`… Pin the TS type to `unknown | null` for now."* So `PersonaExecution.execution_flows` and `GlobalExecutionRow.execution_flows` arrive as `unknown` — validated on the server, untyped on the client. The transparent-ts-rs promise holds for `Json<Vec<String>>` and `Json<Vec<ToolCallStep>>` but breaks for the one shape people reach for when they cannot model `T`.
3. **A `CHECK` cannot be added to an existing column.** `ALTER TABLE ... ADD CONSTRAINT` is a syntax error in SQLite (verified). New columns can carry the constraint via `ADD COLUMN ... CHECK (...)` (verified, and enforced), but the 145 existing columns need either a 12-step table rebuild each or an out-of-band scan. This makes the gate below necessarily two-part: enforce on new, scan for old.
4. **`json_valid` accepts any JSON, not the right JSON.** It would have caught every one of the 70 empty-string writes and every truncation, but not a well-formed object with the wrong shape. Schema-level validation still lives entirely in `T`, which is exactly why step 3's "define a real `T`" is not optional.
5. **Nothing ties the three declarations together.** A JSON column is declared three times — DDL, Rust field, TS binding — and no tool checks that they agree. `Json<T>` ties Rust↔TS and does so *transparently*, which is precisely why it can never tie the DDL: the schema never learns the type. This is the root cause the second pass surfaced, and it is upstream of nearly every deviation above. The `N8nTransformSession` / `N8nSessionResponse` split (same four columns, `string` in one binding and `JsonValue` in the other) is what "no tie" looks like when it reaches the client.
6. **`unwrap_or_default()` is shorter than the correct fallback.** `unwrap_or_else(|_| json.to_string())` is 30 characters against 20, and only works where the original bytes are in scope — which is true for updates and false for inserts. For an insert there is no correct default at all; the only right answer is to propagate the error, which means changing the function signature. That asymmetry is why 68 write sites chose wrong, and it means the fix is a lint plus a signature change, not a naming convention.
7. **The frontend cannot tell a JSON column from any other string.** Every raw column arrives as `string` through the bindings, indistinguishable from a name or a URL, so nothing stops `JSON.parse(persona.model_profile)`. A branded `JsonText<T>` emitted by ts-rs for un-newtyped columns would fix it structurally; that is a larger change than this path.
8. **No test in either tree feeds a corrupt blob to a column reader.** The Rust side tests the *parsers* (`context_map_export.rs:413`) but never a repo read over a corrupted row; the client side has 30 `JSON.parse` sites in tests, all over valid fixtures. So the entire policy taxonomy above — 8 read policies, 6 write policies, 7 client policies — is unverified behaviour. Nothing would fail if `collect_rows` silently dropped every row.
9. **No enforcement reaches `src-tauri/` at all.** `npm run check` runs `eslint src/` only; lefthook pre-commit is eslint-on-staged + secret-scan + i18n; pre-push is `tsc` + i18n + evals + `.ai/doctor`. Clippy runs in CI but cannot see inside SQL string literals or reason about `unwrap_or_default`'s semantics. The server half of this path therefore needs a script, not a lint.

## The missing gate

Every deviation above shipped under a green `npm run check`, a green `cargo clippy -D warnings`, and a green `npm run test`. Four gates, wired where they will actually run.

### 1. `scripts/check-json-columns.mjs` — the primary gate (DDL + Rust)

**Signal.** Four machine-decidable patterns, each with a clean false-positive story:
- A `CREATE TABLE` / `ALTER TABLE ADD COLUMN` declaring `TEXT` where the column name ends `_json` **or** the definition carries `DEFAULT '[]'` / `DEFAULT '{}'` — 84 columns today, extracted deterministically. Absence of `json_valid` in that definition is the violation.
- `serde_json::to_string(...)` whose call chain ends in `.unwrap_or_default()` — 70 sites, zero ambiguity about intent.
- `pub <ident>_json: String` / `Option<String>` in any struct deriving `Serialize` — 96 sites.
- `json_extract(` inside a string literal that also contains `WHERE` — the blob-should-be-a-table signal, 68 sites.

**Mechanism.** A node script, not a lint — ESLint cannot see Rust and clippy cannot see inside string literals. The precedent is `scripts/check-event-registry.mjs`, which already regex-parses Rust and exits 1. Wire it into `npm run check` (so it runs in `ci.yml`'s `frontend-checks` job and in pre-push) and into lefthook `pre-commit` scoped to `src-tauri/**`. Four assertions:
- **A — every NEW JSON column carries `CHECK (col IS NULL OR json_valid(col))`.** Ratchet against `scripts/data/json-column-baseline.json` holding today's 145 unconstrained columns keyed by `table.column`. The list may shrink, never grow. This is cheap to satisfy going forward precisely because `ADD COLUMN ... CHECK` works.
- **B — no new `to_string(..).unwrap_or_default()`.** Baselined at 70; ratchet-only. The failure message names `unwrap_or_else(|_| original.to_string())` for updates and "propagate the error" for inserts.
- **C — no new `pub *_json: String`.** Baselined at 96; message points at `Json<T>` and `json_column.rs:27`.
- **D — no new `json_extract` in a `WHERE`** without a matching `CREATE INDEX ... ON t(json_extract(...))`. Baselined at 68. This one is advisory-with-a-ratchet rather than a hard ban, because §*Is this actually a blob?* is a design judgement — but the count must not rise silently.

**Allowlist** (named in the script, each with a reason):
- `core/src/models/json_column.rs` — defines the primitive; its `to_string`/`from_str` are the implementation.
- `db/src/repos/core/personas.rs:132,150` — `unwrap_or_else(|_| json.to_string())` is the *correct* form and must not be flagged by a naive `unwrap_or` pattern.
- `src/commands/infrastructure/context_map_export.rs:296` and the five other tested per-column decoders — allowed under step 8, each listed by name, each required to have a garbage test.
- `*_json` fields on **wire** DTOs that are never persisted (e.g. HTTP request bodies) — allowed, named individually; the suffix on a non-column is a naming bug, not a schema bug.

**How it fails loudly if its own precondition is absent** — the part `ci.yml` keeps getting wrong:
- Assert all four migration files exist and are non-empty; exit 1 naming the missing path. A rename must break the build, not silently drop check A.
- **Assert the parse found ≥ 240 tables and ≥ 2,800 columns.** Today's census is 253/2,959. A DDL formatting change that breaks the regex would otherwise report zero violations and pass green. A floor turns "I parsed nothing" into a failure.
- Assert the baseline file parses and is non-empty; an empty or missing baseline is a hard error, never "no violations".
- Assert the Rust roots are non-empty directories, so a moved crate fails rather than scans nothing.
- **Print the surviving counts on success** — `0 new of 145 unconstrained / 70 empty-writes / 96 raw fields`. A gate that reports its baseline is auditable; one that prints nothing is indistinguishable from one that never ran.

### 2. `custom/no-raw-json-parse` — the client half

**Signal.** Any `JSON.parse(` outside `src/lib/utils/parseJson.ts`. Modelled on the existing `eslint-rules/prefer-numeric.cjs`, which bans raw `.toFixed()` in favour of `display/Numeric` — same shape of problem, same shape of answer.
**Allowlist:** `src/lib/utils/parseJson.ts` (the one parse), `src/test/**` and `__tests__/**`, and the 34 LLM/HTTP-response decodes, which are a genuinely different situation (untrusted external payload, not a column) and should be listed explicitly rather than pattern-matched.
**Severity:** `error` for new code, landed baselined-then-ratcheted. The repo's warning baseline is already ~10,086, so a new warn-level rule would be invisible — this is the lesson of the design-token migration and it applies verbatim here.
**Message:** points at `safeJsonParse` for step-8 columns and at "this column should be `Json<T>` — the decode should not exist" for the rest.

### 3. The behavioural gate — corrupt-blob tests in both trees

The two gates above check shapes; only a test checks behaviour, and this is exactly where the model-effort guide's warning bites: **a gate that asserts data is not a gate on behaviour.** Three tests, none of which exist today:

- **Rust, `db/src/repos/execution/executions.rs`:** open an in-memory DB, run the migration chain, `INSERT` a `persona_executions` row with `tool_steps = '{"broken'`, call `get_all`, and assert the row is **present** with `tool_steps: None` — not absent. Today it is absent, so this test fails until Gaps 1 is closed, which is the point: it encodes the decision rather than the current behaviour.
- **Rust, `db/src/migrations/`:** run the full chain, then for every table `PRAGMA table_info` and assert each JSON column's definition contains `json_valid`. Same floor assertion (**≥ 240 tables seen**) so a broken migration chain fails instead of asserting over nothing. Runs in `ci.yml`'s existing `rust-tests` job with no new infrastructure.
- **TS, `src/lib/utils/__tests__/parseJson.test.ts`:** assert `safeJsonParse('')` returns an `error` (not `[null, null]`), and — the load-bearing one — render `QuickEditPanel` and `PersonaDraft` against a corrupt `model_profile` and assert **neither issues a write**. The precondition trap here is that a test asserting "returns `''`" would pass today and enshrine the bug; assert on *the absence of a save call*, not on the parsed value.

### 4. The one-off census — for the 145 columns the ratchet cannot reach

Gaps 3 means existing columns cannot be constrained without a rebuild, so the baseline would otherwise never shrink. Run this once per JSON column, from the same census the gate script already produces, and file the results as the fix backlog:

```sql
SELECT COUNT(*) FROM <table> WHERE <col> IS NOT NULL AND NOT json_valid(<col>);
```

Verified to detect the exact failure this path is about: a row written by `to_string(..).unwrap_or_default()` holds `''`, and `json_valid('') = 0`. Any non-zero result is a column that has *already* been corrupted in the field — repair it (from the original bytes where an audit trail exists, or `NULL` where it does not) before adding the constraint, because a table rebuild with a `CHECK` will otherwise fail on the existing data and take the migration with it.

> **Corrections pass — 2026-08-13 · gate lane.** This document specifies a
> gate living in `personas-db` (or another extracted crate) and describes it as
> "already CI-gated" via `npm run test:rust`. That was **false when written**:
> `scripts/build/run-rust-tests.mjs` passes `--lib` against the ROOT manifest,
> so only `personas-desktop`'s lib target compiles, and `test:rust` appeared in
> no workflow and no lefthook job. A test placed there would have been written,
> merged, marked done, and never executed.
>
> `ad91bd538` added `--workspace` to `cargo test` and `cargo clippy` in
> `ci.yml`, so crate tests now run **in CI**. `npm run test:rust` still does
> not run them locally — use `cargo test -p <crate>` or
> `npm run test:rust:crates`. Any gate here must state which lane it runs in
> and must not claim `test:rust` covers it.
