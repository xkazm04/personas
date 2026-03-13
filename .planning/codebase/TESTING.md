# Testing Patterns

**Analysis Date:** 2026-03-13

## Test Framework

**Runner:**
- Vitest v4.0.18
- Config file: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in expect() (compatible with Jest)
- `@testing-library/react` v16.3.2 for React component testing
- `@testing-library/jest-dom` v6.9.1 for DOM matchers
- `@testing-library/user-event` v14.6.1 for user interaction simulation

**Run Commands:**
```bash
npm run test              # Run all tests once
npm run test:watch       # Run tests in watch mode with re-run on change
npm run test:e2e:cli     # Run CLI E2E tests (vitest.e2e.config.ts)
npm run test:integration:cli  # Run CLI integration tests (vitest.integration.config.ts)
```

## Test File Organization

**Location:**
- Unit/component tests are co-located in feature directories
- Test files placed in `__tests__/` subdirectories adjacent to source
- E2E tests in `src/test/e2e/` directory
- Integration tests in `src/test/integration/` directory
- Shared test utilities in `src/test/` directory

**Naming:**
- Unit tests: `[ComponentOrModule].test.tsx` or `[ComponentOrModule].test.ts`
- Examples:
  - `src/stores/__tests__/databaseSlice.test.ts`
  - `src/features/vault/sub_databases/__tests__/DatabaseCard.test.tsx`
  - `src/hooks/design/__tests__/useDesignReviews.test.ts`

**Structure:**
```
src/
├── features/
│   └── [feature]/
│       ├── __tests__/
│       │   ├── Component.test.tsx
│       │   └── Component2.test.tsx
│       ├── Component.tsx
│       └── index.ts
├── stores/
│   ├── __tests__/
│   │   ├── databaseSlice.test.ts
│   │   └── personaStore.test.ts
│   └── slices/
├── hooks/
│   ├── design/
│   │   ├── __tests__/
│   │   │   └── useDesignReviews.test.ts
│   │   └── useDesignReviews.ts
└── test/
    ├── setup.ts
    ├── tauriMock.ts
    ├── helpers/
    │   ├── tauriEventEmitter.ts
    │   └── cliFixtures.ts
    ├── e2e/
    │   ├── cli-healing-stream.e2e.test.ts
    │   └── cli-e2e-reporter.ts
    └── integration/
        ├── rounds/
        │   ├── round1-foundation.integration.test.ts
        │   └── round2-tool-use.integration.test.ts
        └── helpers/
            ├── cliRunner.ts
            ├── workspaceManager.ts
            └── resultValidator.ts
```

## Test Structure

**Suite Organization:**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("ComponentName", () => {
  // ========== Setup/Teardown ==========
  beforeEach(() => {
    // Reset state before each test
  });

  // ========== Main test suite ==========
  describe("specific behavior", () => {
    it("describes the expected behavior", () => {
      // Test implementation
    });
  });

  describe("another aspect", () => {
    it("handles edge case", () => {
      // Test implementation
    });
  });
});
```

**Patterns:**

1. **Setup/Teardown:**
   - `beforeEach()` for test isolation (reset state between tests)
   - `beforeAll()` for expensive setup (database initialization)
   - `afterEach()` for cleanup (destroy workspace, close connections)
   - `afterAll()` for final cleanup
   - Example from `src/stores/__tests__/databaseSlice.test.ts`:
   ```typescript
   beforeEach(() => {
     useVaultStore.setState({
       dbSchemaTables: [],
       dbSavedQueries: [],
     });
     resetInvokeMocks();
   });
   ```

2. **Test Naming Convention:**
   - Name pattern: "describes behavior" not "tests function X"
   - Use present tense: "creates X" not "created X"
   - Example good names:
     - `it("populates store on fetch", ...)`
     - `it("appends to store on create", ...)`
     - `it("throws on error", ...)`
     - `it("fires onClick when clicked", ...)`

3. **Fixture/Factory Pattern:**
   - Create factory functions that return test objects with defaults
   - Use `overrides` parameter for test-specific customization
   - Factories start with `make` prefix
   - Example from `src/stores/__tests__/databaseSlice.test.ts`:
   ```typescript
   function makeTable(overrides: Partial<DbSchemaTable> = {}): DbSchemaTable {
     return {
       id: "tbl-1",
       credential_id: "cred-1",
       table_name: "users",
       display_label: null,
       column_hints: null,
       is_favorite: false,
       sort_order: 0,
       created_at: "2025-01-01T00:00:00Z",
       updated_at: "2025-01-01T00:00:00Z",
       ...overrides,
     };
   }
   ```

4. **Assertion Style:**
   - Use `expect()` with chainable matchers (Vitest)
   - Example assertions:
   ```typescript
   expect(result).toBeDefined();
   expect(result).toBe(true);
   expect(result).toEqual([]);
   expect(result).toHaveLength(2);
   expect(result).toHaveBeenCalledTimes(1);
   expect(result).toThrow("Error message");
   expect(screen.getByText("text")).toBeInTheDocument();
   ```

## Mocking

**Framework:** Vitest `vi` (drop-in Jest compatible)

**Tauri IPC Mocking:**
- All Tauri `invoke()` calls are mocked at module load time
- Mock setup in `src/test/setup.ts` (loaded by vitest.config.ts)
- Helpers provided in `src/test/tauriMock.ts`

Setup file (`src/test/setup.ts`):
```typescript
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock @tauri-apps/api/core -- all invoke() calls return undefined by default
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tauri-apps/api/event -- listen() returns a no-op unlisten function
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));
```

**Mocking Patterns:**

1. **Mock a single command:**
   ```typescript
   mockInvoke("list_personas", [{ id: "1", name: "Test" }]);
   ```

2. **Mock multiple commands at once:**
   ```typescript
   mockInvokeMap({
     list_personas: [{ id: "1" }],
     get_persona: { id: "1", name: "Test" },
     create_persona: { id: "2", name: "New" },
   });
   ```

3. **Mock command to throw error:**
   ```typescript
   mockInvokeError("execute_db_query", "Query syntax error");

   await expect(
     useVaultStore.getState().executeDbQuery("cred-1", "INVALID SQL"),
   ).rejects.toThrow("Query syntax error");
   ```

4. **Reset all mocks:**
   ```typescript
   resetInvokeMocks();  // Returns undefined for all commands
   ```

5. **Mock component callback functions:**
   ```typescript
   const handleClick = vi.fn();
   render(<Component onClick={handleClick} />);

   fireEvent.click(screen.getByRole("button"));
   expect(handleClick).toHaveBeenCalledTimes(1);
   ```

**Tauri Mock Helpers (src/test/tauriMock.ts):**
```typescript
export function mockInvoke(command: string, returnValue: unknown): void
export function mockInvokeOnce(command: string, returnValue: unknown): void
export function mockInvokeMap(commands: Record<string, unknown>): void
export function mockInvokeError(command: string, error: string): void
export function resetInvokeMocks(): void
```

**What to Mock:**
- Tauri `invoke()` calls (IPC to Rust backend)
- External API calls
- Event listeners
- Router navigation (if needed)
- Callbacks passed as props to components

**What NOT to Mock:**
- React components from the codebase (unless testing in isolation)
- Standard library functions
- Zustand store getters/setters (use actual store with `setState()`)
- DOM APIs (let testing-library handle)

## Fixtures and Factories

**Test Data:**

Location: `src/test/helpers/` for shared fixtures, local `__tests__/` for component-specific

Pattern: Factory functions with `make*` prefix returning objects with sensible defaults

Example fixture from `src/stores/__tests__/databaseSlice.test.ts`:
```typescript
const emptyQueryResult: QueryResult = {
  columns: ["id", "name"],
  rows: [[1, "alice"]],
  row_count: 1,
  duration_ms: 42,
  truncated: false,
};

function makeQuery(overrides: Partial<DbSavedQuery> = {}): DbSavedQuery {
  return {
    id: "q-1",
    credential_id: "cred-1",
    title: "List users",
    query_text: "SELECT * FROM users",
    language: "sql",
    last_run_at: null,
    last_run_ok: null,
    last_run_ms: null,
    is_favorite: false,
    sort_order: 0,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}
```

**Shared CLI Fixtures:**
- Location: `src/test/helpers/cliFixtures.ts`
- Used across E2E and integration tests
- Provides workspace setups, test data, and common assertions

## Coverage

**Requirements:** No coverage target enforced

**View Coverage:**
```bash
npm run test -- --coverage
```

## Test Types

**Unit Tests:**
- Scope: Single function, hook, or store slice
- Approach: Direct function call or store state mutation
- Isolation: Heavy use of mocks for external dependencies
- Example: `src/stores/__tests__/databaseSlice.test.ts`
- Location: `__tests__/` subdirectories within feature or store directories

**Integration Tests:**
- Scope: Multiple components or layers working together
- Approach: Full workflow from user action through state update
- Isolation: Minimal mocking; test real interactions
- Examples:
  - `src/test/integration/rounds/round1-foundation.integration.test.ts`
  - `src/test/integration/rounds/round2-tool-use.integration.test.ts`
- Setup: Custom helpers for workspace creation, CLI execution, database setup
- Pattern: For-loop across provider types with test-specific variants
- Example:
  ```typescript
  const providers = getAvailableProviders();
  for (const provider of providers) {
    describe(`${provider.displayName}`, () => {
      it('auth smoke test', async () => {
        // Test using real provider
      });
    });
  }
  ```

**E2E Tests:**
- Framework: Vitest (not Playwright or Cypress)
- Scope: CLI workflows and real user scenarios
- Location: `src/test/e2e/` directory
- Pattern: Terminal command execution, output validation, timing assertions
- Examples:
  - `src/test/e2e/cli-healing-stream.e2e.test.ts`
  - `src/test/e2e/cli-stream-core.e2e.test.ts`
  - `src/test/e2e/cli-terminal-rendering.e2e.test.tsx`
- Helpers: `cliRunner.ts`, `resultValidator.ts`, `cli-e2e-reporter.ts`
- Config: `vitest.e2e.config.ts` (separate from main config)

## Common Patterns

**Async Testing:**

Pattern: Use `async/await` with top-level `await` in test function

```typescript
it("fetchDbSchemaTables populates store", async () => {
  const tables = [makeTable(), makeTable({ id: "tbl-2", table_name: "orders" })];
  mockInvokeMap({ list_db_schema_tables: tables });

  await useVaultStore.getState().fetchDbSchemaTables("cred-1");

  expect(useVaultStore.getState().dbSchemaTables).toHaveLength(2);
});
```

**Error Testing:**

Pattern: Use `expect().rejects.toThrow()` for promises that reject

```typescript
it("executeDbQuery throws on error", async () => {
  mockInvokeError("execute_db_query", "Query syntax error");

  await expect(
    useVaultStore.getState().executeDbQuery("cred-1", "INVALID SQL"),
  ).rejects.toThrow("Query syntax error");
});
```

**State Testing (Zustand):**

Pattern: Direct store access via `getState()` and `setState()`

```typescript
beforeEach(() => {
  useVaultStore.setState({
    dbSchemaTables: [],
    dbSavedQueries: [],
  });
});

it("creates table", async () => {
  const newTable = makeTable({ id: "tbl-new" });
  mockInvokeMap({ create_db_schema_table: newTable });

  await useVaultStore.getState().createDbSchemaTable("cred-1", "products");

  expect(useVaultStore.getState().dbSchemaTables).toHaveLength(1);
});
```

**Component Testing (React):**

Pattern: Use `render()` from `@testing-library/react`, query by role/text

```typescript
it("renders credential name", () => {
  render(
    <DatabaseCard
      credential={makeCredential()}
      connector={makeConnector()}
      tableCount={0}
      queryCount={0}
      onClick={() => {}}
    />,
  );
  expect(screen.getByText("My Supabase DB")).toBeInTheDocument();
});

it("fires onClick when clicked", () => {
  const handleClick = vi.fn();
  render(
    <DatabaseCard
      credential={makeCredential()}
      connector={makeConnector()}
      tableCount={0}
      queryCount={0}
      onClick={handleClick}
    />,
  );

  fireEvent.click(screen.getByRole("button"));
  expect(handleClick).toHaveBeenCalledTimes(1);
});
```

**Testing Library Query Priority:**
1. Query by role (most accessible): `screen.getByRole("button")`
2. Query by label text: `screen.getByLabelText("Email")`
3. Query by text content: `screen.getByText("Submit")`
4. Query by test ID (last resort): `screen.getByTestId("submit-btn")`

**Testing Zustand Slices:**

Pattern: Initialize slice in test, mock API calls, verify state mutations

```typescript
describe("databaseSlice", () => {
  beforeEach(() => {
    useVaultStore.setState({
      dbSchemaTables: [],
      dbSavedQueries: [],
    });
    resetInvokeMocks();
  });

  it("populates store on fetch", async () => {
    const tables = [makeTable()];
    mockInvokeMap({ list_db_schema_tables: tables });

    await useVaultStore.getState().fetchDbSchemaTables("cred-1");

    expect(useVaultStore.getState().dbSchemaTables).toEqual(tables);
  });
});
```

**Integration Test Pattern:**

Pattern: Multiple providers, multiple test scenarios, recorded results

```typescript
const providers = getAvailableProviders();
let db: TestDbContext;
let workspace: WorkspaceContext;

beforeAll(() => {
  db = createTestDb();
});

afterEach(() => {
  workspace?.destroy();
});

for (const provider of providers) {
  describe(`${provider.displayName}`, () => {
    it('auth smoke test', async () => {
      workspace = createWorkspace('empty');

      const result = await runCli({
        provider: provider.name,
        prompt: '...',
        cwd: workspace.rootDir,
        model: provider.model,
        timeoutMs: 30_000,
      });

      const validation = validateResult(result, {
        expectSuccess: true,
        outputContains: ['ready'],
        maxDurationMs: 30_000,
      });

      db.recordExecution({
        id: `round1-auth-smoke-${provider.name}`,
        status: validation.passed ? 'pass' : 'fail',
        // ... more fields
      });

      expect(validation.passed).toBe(true);
    });
  });
}
```

**CLI Test Helpers:**

- `runCli()`: Execute CLI with provider, prompt, model, timeout
- `validateResult()`: Check output contains expected strings, within duration
- `createWorkspace()`: Set up isolated test workspace
- `recordExecution()`: Log test result to database
- `createTestDb()`: Initialize test database for recording results

---

*Testing analysis: 2026-03-13*
