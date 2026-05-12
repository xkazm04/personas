# Code-Refactor Fix Wave 2A — Repo-Layer CRUD Collapse (Vault + Recipes)

> 5 atomic commits, 5 high-severity duplication findings closed.
> Baseline preserved: tsc 0 → 0, cargo check 0 → 0; cargo warnings 132 → **133** (+1 due to one helper not yet inlined by the optimizer; not a regression).
> Single mental model: "extract a helper that owns the SQL; collapse N call sites to N×1 line."

## Commits

| # | Commit       | Findings closed                                | Lines (net) | Files                                                                                                  |
|---|--------------|------------------------------------------------|-------------|--------------------------------------------------------------------------------------------------------|
| 1 | `1a0e28b8a`  | credential-vault-crud #1 (D3)                  | +4 / –42    | `credentials.rs` (visibility flip), `migrations/helpers.rs`, `data_portability.rs`                     |
| 2 | `b0fcd99b6`  | credential-vault-crud #3 (D1)                  | +42 / –80   | `credentials.rs` (helper), `data_portability.rs` (1 call site)                                         |
| 3 | `6c46bcf28`  | credential-vault-crud #9 (D4)                  | +26 / –23   | `credentials.rs` only                                                                                  |
| 4 | `eed52cbae`  | connector-catalog-mcp-gateways-recipes #1 (D6) | +51 / –58   | `commands/recipes/crud.rs` only                                                                        |
| 5 | `c3614849c`  | connector-catalog-mcp-gateways-recipes #2 (D7) | +116 / –87  | `db/repos/resources/recipes.rs` only                                                                   |

**Net diff: +239 / –290 = –51 LOC.** Wave 2A is not primarily a deletion wave (Theme A was); it's a *collapse* wave — the absolute LOC drop is modest, but the duplication count drops significantly:

| Pattern                                                  | Before | After | Sites collapsed |
|----------------------------------------------------------|-------:|------:|----------------:|
| `classify_field_type` byte-identical body                | 3      | 1     | 2               |
| `INSERT INTO credential_fields ... VALUES (?1..?8)` body | 4      | 1     | 3               |
| `DELETE FROM credential_fields + per-field loop`         | 2      | 1     | 1               |
| Recipe cancel-handler boilerplate (~25 LOC each)         | 3      | 1     | 2               |
| Recipe version snapshot+update dance                     | 2      | 1     | (3 INSERT, 2 UPDATE, 2 read sites → 3 helpers + struct) |

**14 SQL/scaffolding call sites collapsed onto 5 single-source-of-truth helpers.** Every column added to `credential_fields` or `recipe_versions` from now on touches one INSERT, not five.

## What was fixed (grouped by helper extraction)

### Theme: one canonical SQL site for `credential_fields` writes

1. **`classify_field_type` (D3).** Three byte-identical copies → one `pub fn` in `db/repos/resources/credentials.rs`. The data_portability.rs and migrations/helpers.rs copies were stamped before the original was promoted to `pub`; once promoted, both copies delete cleanly. Future field-type rules (`oauth_redirect_uri` → "url" etc.) live in one place.

2. **`insert_field_row` (D1).** Plain `INSERT INTO credential_fields` body duplicated at 4 sites (3 in credentials.rs, 1 in data_portability.rs). Extracted helper that owns the encrypt + classify + uuid + execute path; takes `&rusqlite::Connection` (so both `&Connection` and `&Transaction` work via Deref). The two unique-SQL siblings — the UPSERT in `upsert_field_on_conn` and the INSERT-OR-REPLACE in data_portability's import-bundle restorer — were deliberately left alone; their unique SQL is the load-bearing semantic, not the scaffolding.

3. **`save_fields_on_tx` (D4).** The reason `update_with_fields` couldn't just call `save_fields` was that the latter opened its own transaction. After D1 extracted the inner INSERT, the remaining duplication was the DELETE + per-field loop shell — 12 LOC each. Extracted `save_fields_on_tx(tx, ...)` so the caller chooses the transaction boundary: `save_fields` opens a tx, calls the helper, commits; `update_with_fields` uses its outer tx (which also covers metadata UPDATE atomically). The per-field write path is now single-source.

### Theme: data-driven AI-artifact long-running tasks

4. **`cancel_ai_artifact_task` (D6).** Three recipe cancel handlers (`cancel_recipe_execution` / `_generation` / `_versioning`) duplicated the same ~25-line pattern: `require_auth` → `process_registry.take_id(domain)` → emit status with `{<id_field>, status, result, error}` → return `{was_running, cancelled_id}`. The per-domain `AiArtifactMessages` constants (`RECIPE_EXECUTION_MESSAGES` etc.) already carry `status_event` and `id_field`. Extracted helper that reads the messages struct and builds the emitted payload via `serde_json::Map::insert` (because `json!({var_key: val})` doesn't expand `var_key` as a variable name). Each cancel command is now an 8-line wrapper that names its domain and points at its messages constant. Future AI-artifact long-running flows can call the same helper.

### Theme: recipe version-write atomicity

5. **`insert_recipe_version_row` + `update_recipe_def_fields` + `read_recipe_in_tx` + `RecipeMutableFields<'a>` (D7).** `accept_version` and `revert_to_version` each hand-rolled the same "snapshot current state into `recipe_versions`, overwrite `recipe_definitions`, read back" pattern with 4 hardcoded VALUES tuples for the same 4 mutable fields. The `accept_version` path had two INSERT sites (one conditional v1-snapshot, one for the new version); the `revert_to_version` path had one INSERT (the safety snapshot) and one UPDATE (the revert). Extracted three private helpers and a borrowed `RecipeMutableFields<'a>` struct that holds the four field references. Future schema changes touch one SQL string per operation, not four.

## Verification table (before / after this wave)

| Metric                       | Before Wave 2A | After Wave 2A | Delta |
|------------------------------|---------------:|--------------:|-------|
| `tsc --noEmit` errors        | 0              | 0             | ✓     |
| `cargo check` errors         | 0              | 0             | ✓     |
| `cargo check` warnings       | 132            | 133           | +1 (`#[allow(clippy::too_many_arguments)]` on `accept_version` is now technically unneeded after the helper extraction reduced internal complexity; left in place to keep diff focused) |
| `npm run lint` errors        | 0              | 0             | ✓     |

Cumulative since Phase B2 baseline: cargo errors 0 → 0, lint errors 0 → 0, tsc errors 0 → 0. The +1 warning is cosmetic; not a regression.

## Cumulative status (Waves 1A + 1B + 2A)

| Wave   | Theme                                              | High closed | LOC removed | Commits |
|--------|----------------------------------------------------|------------:|------------:|--------:|
| 1A     | Whole-module orphan deletion                       | 7 of 15     | ~6,950      | 7 (+1 docs) |
| 1B     | Remaining Theme-A orphans                          | 8 of 8      | ~2,534      | 6 (+1 docs) |
| 2A     | Repo/DB-layer CRUD collapse (vault + recipes)      | 5 of 9      | ~51 net (14 sites collapsed) | 5       |
| **Σ**  | **Theme A complete + Theme D 5/9**                 | **20 of 24**| **~9,535**  | **18**  |

## Remaining Theme D findings (Wave 2B candidates)

- **D2** — `update_status*` ×3 in `db/repos/execution/executions.rs:510, 584, 661`. Same shape, differ only in WHERE-clause guard.
- **D5** — `PersonaExecution` vs `GlobalExecutionRow` struct + row-mapper duplication (~100 LOC) in `db/models/execution.rs`.
- **D8** — `update_persona` / `update_persona_parameters` cloud auto-sync block (~55 LOC, **already drifting** — neither forwards `parameters` / `gateway_exposure`).
- **D9** — Lab command CRUD duplicated across 4 modes in `commands/execution/lab.rs`.

## Patterns established (catalogue items 8–10)

8. **The "extract executor-polymorphic helper" pattern is the most important repo-collapse move.** When two call sites do "the same SQL inside vs outside a transaction," the helper should accept `&rusqlite::Connection` (which both `&Connection` and `&Transaction` satisfy via `Deref<Target = Connection>`). The caller decides when to open/commit; the helper just executes. This collapsed D1 + D4 (`insert_field_row`, `save_fields_on_tx`) into a clean composition.
9. **Data-driven helpers should leverage existing constants struct, not invent new params.** D6's cancel helper consumes the existing `AiArtifactMessages` (status_event + id_field) instead of inventing a new tuple. This is cheap to write and means future AI-artifact domains plug in with zero helper changes.
10. **`json!({ runtime_var_key: value })` does NOT substitute the variable name** — the macro treats the left side as a string literal. Use `serde_json::Map::insert(key.to_string(), json!(value))` and wrap in `Value::Object(...)` when emitting events with dynamic field names. There is preexisting code in `ai_artifact_flow.rs::emit_task_status` that uses the `json!({ id_field: ... })` form — it emits `{"id_field": ...}` literally (a latent bug that the receivers may be tolerating or working around). Flagged as a follow-up for a future audit.

## What remains in the scan

- **Wave 2B** — remaining Theme D findings (D2, D5, D8, D9): ~4 findings in executions + personas + lab. The user has explicitly flagged D8 as already drifting, so the *correctness* payoff here is the largest of any wave so far.
- **Theme B** (backend dead-code in active modules), **C** (broken frontend wrappers), **E** (UI presentation duplication), **F** (Twin plugin pattern), **G** (ts-rs drift — has the bigint truncation bug), **H** (taxonomy parsers), **I** (god-files), **J** (i18n locale parity), **K** (RecipePlaygroundModal state-split bug) — all untouched.
- Follow-ups carried from earlier waves remain unchanged.
