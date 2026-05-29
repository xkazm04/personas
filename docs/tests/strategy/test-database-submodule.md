# Database Submodule — Test Coverage

Test suite for the database submodule: schema CRUD, REST query executors, response parsers, Zustand store, and UI components.

## Quick Reference

```bash
# Run all Rust unit tests (no dependencies needed)
cd src-tauri && cargo test --lib -- "db_query::tests" "db_schema::tests"

# Run all frontend tests
npx vitest run src/stores/__tests__/databaseSlice.test.ts \
  src/features/vault/sub_databases/__tests__/

# Run Upstash integration tests (requires Docker)
docker compose -f docker-compose.test.yml up -d
cd src-tauri && UPSTASH_TEST_URL=http://localhost:8079 UPSTASH_TEST_TOKEN=test_token_123 \
  cargo test -- --ignored
docker compose -f docker-compose.test.yml down
```

## Test Inventory

| Layer | File | Tests | Type |
|-------|------|------:|------|
| Response parsers | `src-tauri/src/engine/db_query.rs` | 33 | Rust unit |
| Repo CRUD | `src-tauri/src/db/repos/resources/db_schema.rs` | 29 | Rust unit (in-memory SQLite) |
| Upstash live | `src-tauri/src/engine/db_query.rs` | 4 | Rust integration (`#[ignore]`) |
| Zustand store | `src/stores/__tests__/databaseSlice.test.ts` | 11 | Vitest + Tauri mock |
| SqlEditor | `src/features/vault/sub_databases/__tests__/SqlEditor.test.tsx` | 11 | Vitest + RTL |
| QueryResultTable | `src/features/vault/sub_databases/__tests__/QueryResultTable.test.tsx` | 9 | Vitest + RTL |
| DatabaseCard | `src/features/vault/sub_databases/__tests__/DatabaseCard.test.tsx` | 7 | Vitest + RTL |
| SchemaManagerModal | `src/features/vault/sub_databases/__tests__/SchemaManagerModal.test.tsx` | 6 | Vitest + RTL |
| DatabaseListView | `src/features/vault/sub_databases/__tests__/DatabaseListView.test.tsx` | 8 | Vitest + RTL |
| **Total** | | **118** | |

RTL = React Testing Library.

---

## Rust Tests

### Preconditions

- Rust toolchain (`cargo`)
- No external services needed for unit tests

### 1. Response Parser Tests (`db_query.rs`)

Pure-function tests against the four connector response parsers. No network or database access.

| Parser | Tests | What's Covered |
|--------|------:|----------------|
| `parse_postgres_json_response` | 9 | Array of objects, `rows`/`result` wrappers, empty arrays, single-value responses, 500-row truncation, invalid JSON, null values, boundary at MAX_ROWS |
| `parse_neon_response` | 5 | Standard `{fields, rows}` format, empty response, missing fields key, truncation, mixed value types |
| `parse_upstash_response` | 7 | String result, array result, null result, integer result, hash (flat key-value array), truncation, empty array |
| `parse_planetscale_response` | 5 | Object rows, array rows, empty result, truncation, response without `result` wrapper |

### 2. Utility Tests (`db_query.rs`)

| Function | Tests | What's Covered |
|----------|------:|----------------|
| `extract_pg_host` | 6 | Standard connection string, port stripping, query params, missing `@`, minimal input, combined port + params |

### 3. Validation Tests (`db_query.rs`)

| Test | What's Covered |
|------|----------------|
| `test_upstash_empty_command` | Empty string to `execute_upstash` returns `Err(Validation)` |

### 4. Repo CRUD Tests (`db_schema.rs`)

Uses a real in-memory SQLite database. Each test gets an isolated database instance via shared-cache URI (`file:testdb_{N}?mode=memory&cache=shared`) with the full app schema applied. Two seed credentials (`cred-1`, `cred-2`) are inserted for foreign key satisfaction.

**Schema Tables (14 tests):**

| Test | What's Covered |
|------|----------------|
| `test_create_table` | Creates table, verifies all returned fields |
| `test_create_table_empty_name` | Rejects empty table name with `Validation` error |
| `test_create_table_whitespace_name` | Rejects whitespace-only table name |
| `test_create_table_duplicate` | `UNIQUE(credential_id, table_name)` constraint violation |
| `test_create_table_same_name_different_credential` | Same table name under different credentials succeeds |
| `test_list_tables_empty` | Returns empty vec for credential with no tables |
| `test_list_tables_ordered` | Alphabetical ordering when sort_order is equal |
| `test_list_tables_sort_order_takes_priority` | Explicit sort_order overrides alphabetical |
| `test_list_tables_only_for_credential` | Tables from other credentials are excluded |
| `test_update_table_name` | Renames table, verifies `updated_at` changes |
| `test_update_table_favorite` | Toggle `is_favorite` true/false |
| `test_update_table_column_hints` | Set JSON column hints string |
| `test_delete_table` | Deletes and verifies list is empty |
| `test_delete_table_not_found` | Returns `false` for nonexistent ID |

**Saved Queries (14 tests):**

| Test | What's Covered |
|------|----------------|
| `test_create_query` | Creates with default language `sql` |
| `test_create_query_custom_language` | Language `redis` persists |
| `test_create_query_empty_title` | Rejects empty title |
| `test_list_queries_empty` | Empty vec |
| `test_list_queries_ordered` | Alphabetical by title |
| `test_update_query_title` | Title update |
| `test_update_query_text` | Query text update |
| `test_update_query_language` | Language update |
| `test_update_query_favorite` | Favorite toggle |
| `test_update_query_run_success` | `last_run_at`, `last_run_ok=true`, `last_run_ms` populated |
| `test_update_query_run_failure` | `last_run_ok=false` recorded |
| `test_delete_query` | Deletion works |
| `test_delete_query_not_found` | Returns `false` |
| `test_get_table_by_id_not_found` | Returns `NotFound` error |

**Cascade (1 test):**

| Test | What's Covered |
|------|----------------|
| `test_cascade_delete_credential` | Deleting parent `persona_credentials` row cascades to both `db_schema_tables` and `db_saved_queries` |

---

## Integration Tests (Docker)

### Preconditions

- Docker Desktop running
- Ports 6379, 8079, 5433 available

### Docker Compose Setup

`docker-compose.test.yml` provides:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `redis` | `redis:latest` | 6379 | Backing store for Upstash emulator |
| `upstash-emulator` | `hiett/serverless-redis-http:latest` | 8079 | Upstash REST API emulation |
| `neon-postgres` | `postgres:17` | 5433 | Plain Postgres for SQL tests |

### Upstash Integration Tests (4 tests, `#[ignore]`)

Gated behind environment variables `UPSTASH_TEST_URL` and `UPSTASH_TEST_TOKEN`. Skipped by default; run with `cargo test -- --ignored`.

| Test | What's Covered |
|------|----------------|
| `test_upstash_live_set_get` | SET key, GET key, verify round-trip |
| `test_upstash_live_hset_hgetall` | HSET hash fields, HGETALL returns all |
| `test_upstash_live_nonexistent_key` | GET missing key returns null |
| `test_upstash_live_del` | DEL returns integer count |

Each test cleans up after itself (DEL keys).

### Running Integration Tests

```bash
# Start services
docker compose -f docker-compose.test.yml up -d

# Wait for health checks
docker compose -f docker-compose.test.yml ps

# Run ignored tests with env vars
cd src-tauri
UPSTASH_TEST_URL=http://localhost:8079 \
UPSTASH_TEST_TOKEN=test_token_123 \
  cargo test -- --ignored

# Tear down
docker compose -f docker-compose.test.yml down
```

---

## Frontend Tests

### Preconditions

- Node.js + npm
- `npm install` completed (vitest, @testing-library/react, jsdom)

### Test Framework

- **Vitest 4.x** — test runner (config: `vitest.config.ts`)
- **jsdom** — browser environment simulation
- **@testing-library/react** — component rendering + queries
- **@testing-library/jest-dom** — DOM assertion matchers
- **Tauri IPC mocks** — `src/test/setup.ts` mocks `@tauri-apps/api/core` invoke globally; `src/test/tauriMock.ts` provides `mockInvokeMap`, `mockInvokeError`, `resetInvokeMocks`

### Store Tests (`databaseSlice.test.ts`)

Tests the Zustand `DatabaseSlice` in isolation by mocking Tauri IPC commands.

| Test | Mocked Command | What's Covered |
|------|---------------|----------------|
| `initial state` | — | `dbSchemaTables=[]`, `dbSavedQueries=[]` |
| `fetchDbSchemaTables` | `list_db_schema_tables` | Populates store array |
| `createDbSchemaTable` | `create_db_schema_table` | Appends to store, returns created item |
| `updateDbSchemaTable` | `update_db_schema_table` | Replaces matching item in store |
| `deleteDbSchemaTable` | `delete_db_schema_table` | Removes from store by ID |
| `fetchDbSavedQueries` | `list_db_saved_queries` | Populates store |
| `createDbSavedQuery` | `create_db_saved_query` | Appends |
| `updateDbSavedQuery` | `update_db_saved_query` | Replaces |
| `deleteDbSavedQuery` | `delete_db_saved_query` | Removes |
| `executeDbQuery` | `execute_db_query` | Returns `QueryResult` |
| `executeDbQuery error` | `execute_db_query` (reject) | Throws error |

### Component Tests

**SqlEditor (11 tests):** Placeholder rendering, value display, onChange callback, Ctrl+Enter and Meta+Enter execution, plain Enter passthrough, SQL keyword/string/comment tokenization, Redis command tokenization, minHeight style.

**QueryResultTable (9 tests):** Column headers, row rendering, null cells as "NULL", object cells as JSON, truncation warning banner, status bar (row count + duration), singular "row" text, empty state message, no truncation warning when not truncated.

**DatabaseCard (7 tests):** Credential name display, connector label display, service_type fallback without connector, table count badge (conditional), query count badge (conditional), hidden badges at zero, onClick handler.

**SchemaManagerModal (6 tests):** Credential name in header, connector label in subtitle, all three tabs visible by default, close button callback, tab switching (Tables → Console), service_type fallback. Uses a framer-motion mock to avoid animation issues in jsdom.

**DatabaseListView (8 tests):** Empty state when no database credentials, renders database cards, filters out non-database credentials, tab bar with multiple connector types, hidden tab bar with single type, search filtering by name, "No matching databases" empty search result, search input presence. Uses framer-motion mock and Zustand store seeding with credentials + connector definitions.

---

## Connector Coverage Matrix

| Connector | Parser Tests | CRUD Tests | Live Integration | Mechanism |
|-----------|:-----------:|:----------:|:----------------:|-----------|
| **Supabase** | 9 | via `cred-1` seed | — | PostgREST JSON format |
| **Neon** | 5 | — | — | `{fields, rows}` format |
| **Upstash** | 7 | — | 4 (Docker SRH) | Redis REST `{result}` format |
| **PlanetScale** | 5 | — | — | Vitess `{result: {fields, rows}}` |
| **Unsupported** | — | — | — | `execute_query` returns error string |

### Why No Live Tests for Some Connectors

- **Supabase**: The `/pg/query` SQL endpoint is not guaranteed on the local Docker stack. Parser tests cover response format correctness.
- **Neon**: The serverless HTTP proxy (`https://{host}/sql`) is Neon-proprietary. A cloud free tier account can be used for live tests gated behind `NEON_TEST_CONNECTION_STRING`.
- **PlanetScale**: No free tier ($5/mo minimum) and no local HTTP API emulator. Parser tests cover the response format.

---

## Adding New Tests

### Rust parser test

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/engine/db_query.rs`. Parser functions are `pub(crate)` and can be called directly with fixture JSON strings.

### Rust CRUD test

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/db/repos/resources/db_schema.rs`. Call `test_pool()` to get a fresh isolated in-memory database.

### Frontend component test

Create a `.test.tsx` file in the component's `__tests__/` directory. Use `mockInvokeMap` from `@/test/tauriMock` to mock Tauri commands. Use `usePersonaStore.setState(...)` to seed store state.

### New connector integration test

1. Add a Docker service to `docker-compose.test.yml`
2. Add the executor function test in `db_query.rs` gated with `#[ignore]` and env var check
3. Document the env vars in this file
