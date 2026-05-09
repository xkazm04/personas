# Store tests — patterns and conventions

This directory holds tests for Zustand stores and slices. **Use the
**harness-per-test** pattern by default**; only reach for the
singleton style when you have a concrete reason listed below.

The two patterns coexist for historical reasons. New tests should
follow harness-per-test unless they are explicitly testing
cross-store integration or persist-middleware behavior.

## Canonical pattern: harness-per-test

Each test gets a fresh, isolated slice instance. No persist middleware,
no global singleton, no leakage between tests.

**Canonical examples** (any of these is a fine starting template):

- `src/stores/slices/network/networkSlice.test.ts:20-31` — minimal
  harness, single slice
- `src/stores/slices/overview/eventSlice.test.ts:34-52` — harness with
  fixture helpers
- `src/stores/slices/system/tourSlice.test.ts:38-53` — harness +
  `vi.mock` for cross-cutting dependencies

**Shape:**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createMySlice } from './mySlice';
import type { MyStore } from '../../storeTypes';

function makeHarness() {
  let state = {} as MyStore;
  const set = (
    partial: Partial<MyStore> | ((s: MyStore) => Partial<MyStore>),
  ) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: MyStore) => Partial<MyStore>)(state)
      : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createMySlice(set as never, get as never, {} as never);
  state = { ...state, ...slice };
  return { get: () => state, slice: () => state as unknown as MySlice };
}

describe('mySlice', () => {
  it('does the thing', () => {
    const h = makeHarness();
    h.slice().doTheThing();
    expect(h.get().resultField).toBe(/* ... */);
  });
});
```

**Why this is canonical:**

- A fresh `state` object per `makeHarness()` call means tests cannot
  pollute each other through shared module state.
- No `persist` middleware fires — tests never accidentally read or
  write to localStorage, so they don't depend on test ordering and
  don't need cleanup hooks for `localStorage.clear()`.
- The slice's actions run against a real (if minimal) Zustand-shape
  state container, so the test exercises the same code path as
  production.
- Multi-window / HMR / fast-refresh recreate stores at runtime; the
  harness simulates that lifecycle, which has caught bugs that the
  singleton-style pattern would have hidden (see the `eventSlice`
  pendingEventCount across-recreation test).

## Deviation: singleton-with-setState-reset

Use the project's real store singleton (`useAgentStore`,
`useSystemStore`, etc.) and reset state between tests. Pattern:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';

describe('feature', () => {
  beforeEach(() => {
    useAgentStore.getState().resetBuildSession();
    // or: useAgentStore.setState({ ...initialFields });
  });
  ...
});
```

**Existing examples:**

- `src/stores/__tests__/matrixBuildSlice.test.ts` — uses the singleton
  to test the buildSession lifecycle across slice boundaries
- `src/stores/__tests__/personaStore.test.ts` — integration tests that
  span agentStore + systemStore + toastStore mocks
- `src/stores/__tests__/databaseSlice.test.ts` — uses `useVaultStore`
  because the test exercises the real action wiring through the
  vault-store-typed selectors

**Use this pattern only when one of the following is true:**

1. **Cross-store integration:** the test asserts behavior that spans
   multiple slices in the same store (matrixBuildSlice's interaction
   with personaSlice in the agentStore example).
2. **Persist-middleware behavior:** the test must observe what the
   real persist middleware writes / migrates. (For migration paths
   specifically, see `agentStore.merge.test.ts`,
   `systemStore.rehydrate.test.ts`, `themeStore.rehydrate.test.ts`.)
3. **Existing test maintenance:** when you're already editing a
   singleton-style test and a partial migration would be more churn
   than value, leave it alone. New test files should still default
   to the harness pattern.

**Trade-offs to be aware of:**

- Persist middleware fires across tests unless you explicitly clear
  `localStorage` and reset relevant globals (`globalThis.*` flags
  used by some slices like tour).
- The reset is per-test but state leakage between tests is silent —
  test ordering can hide real bugs.
- Fast-refresh / HMR semantics aren't exercised; the singleton lives
  forever.

## Variant: direct enum / pure-function tests

When a slice exports pure helpers (no `set` / `get` access required),
test those helpers directly without any harness:

- `src/stores/slices/processActivitySlice.test.ts` — tests the enum
  validators only

This is fine; don't promote those to harness style if the helper is
genuinely pure.

## Migration tests (`merge` and `onRehydrateStorage`)

Persist migration code is the worst kind to leave untested — only
users with old persisted state hit it, and they never see an error
when it silently breaks. **Every store that uses `merge` or
`onRehydrateStorage` should have a co-located migration test.**

These tests are a deliberate exception to the harness-per-test rule
because the goal is to exercise the real persist middleware. The
pattern:

1. Seed `localStorage` with a stale persisted shape (the version a
   pre-migration build would have written).
2. Call `useStore.persist.rehydrate()` to re-trigger Zustand's
   hydration pipeline. This invokes both `merge` and
   `onRehydrateStorage` against the seeded data.
3. Read the live store with `getState()` and assert the migration
   produced the new shape.

**Examples** (the canonical templates for new migration tests):

- `src/stores/__tests__/agentStore.merge.test.ts` — `merge` for the
  `chatMode: 'ops' → 'advisory'` rename
- `src/stores/__tests__/systemStore.rehydrate.test.ts` —
  `onRehydrateStorage` for unknown-onboarding-step sanitization +
  legacy `editorTab` migration
- `src/stores/__tests__/themeStore.rehydrate.test.ts` —
  `onRehydrateStorage` for `textScale` migration + custom-theme
  re-injection (mocks `@/lib/theme/deriveCustomTheme` so the DOM
  helper call is observable)

**Required setup** for every migration test file:

```ts
import { _resetDedupCacheForTests } from '../util/dedupedStorage';

beforeEach(() => {
  localStorage.clear();
  _resetDedupCacheForTests();
  useStore.setState({ /* fields under test, restored to defaults */ });
});
```

The `_resetDedupCacheForTests` call clears the module-scoped write-dedup
cache; without it a previous test's write to localStorage may not
re-fire on the next `setItem` and you'll get spurious failures.

When a migration triggers a DOM side-effect (themeStore's
`applyThemeToDOM`, etc.), use `vi.mock` to spy on the helper module
rather than asserting against jsdom's `document.documentElement` —
mocking gives you a clean call assertion without coupling to DOM
implementation details.

## When in doubt

Default to harness-per-test for unit tests. Use the migration-test
pattern above for `merge` / `onRehydrateStorage`. The deviation list
in "Singleton-with-setState-reset" above is exhaustive — if your
reason isn't on it, you don't have a deviation, you have a
default-pattern test.
