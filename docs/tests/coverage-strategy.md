# Test coverage strategy — 0 → max

How to build out automated test coverage for a feature area from "nothing" to "shipped with confidence", layered so each step adds real regression protection without infra overhead it does not yet need.

This is the canonical playbook. **Every feature should follow it in order.** Skipping a layer is fine when a layer is genuinely not applicable (e.g. a pure-helper module needs no Playwright), but inverting the order ("write E2E first, helpers later") burns time on the slow layer before the fast layers have caught the easy bugs.

---

## Three layers, three isolation profiles

| Tier | What it tests | Runtime | Parallel-safe? | Where it lives |
| --- | --- | --- | --- | --- |
| **1. Vitest jsdom** — pure helpers, hook state machines with mocked IPC, component interactions via Testing Library | Node + jsdom, no app shell | **Yes** — each git worktree runs `npm test` in its own Node process. Zero shared state. | `src/**/__tests__/*.test.{ts,tsx}` |
| **2. Playwright vs Vite-only** — DOM smoke on the real frontend bundle with mocked Tauri IPC | Vite dev server on a port (default 1420); no Tauri shell | Possible via port-sharded env (`VITE_PORT=...`); not built today. | (Not yet adopted.) |
| **3. Playwright vs full Tauri** — real shell, real SQLite, real IPC, real keyring | A Tauri app process you start manually (`npm run tauri:dev:test`) | **Serial today** — Vite :1420 + test-automation :17320 + app data dir + keyring service are all process singletons. Multi-instance scaffold exists (`PERSONAS_TEST_PORT` env var) but needs more infra. See `parallel-cli-workflow.md`. | `tests/playwright/*.spec.ts` + per-feature `<feature>-bridge.ts` |

**Default to Tier 1.** It covers 80%+ of regression value for most features (state machines, rendering, hook contracts, key handlers, edge cases in pure functions) and is fully parallel-safe via the existing worktree isolation. **The other two tiers are additive, not primary.**

---

## The 0 → max progression

Most features go through the same shape as they grow into coverage. Use this as a checklist.

### Cycle A — pure helpers

**What**: Standalone functions in the feature folder that don't touch React, IPC, the store, or the DOM. Date math, string parsing, validation, format helpers, state-machine reducers.

**Why first**: Cheapest to test (no rendering, no mocking), catches the highest density of edge-case bugs (off-by-ones, NaN handling, locale-specific edges), and acts as a forcing function to factor the messy bits of a feature out of components and into testable units. If you find yourself needing component rendering to test a piece of logic, that logic probably wants extraction.

**Tooling**:

```ts
// src/features/<area>/<sub>/__tests__/<helper>.test.ts
import { describe, expect, it } from 'vitest';
import { myPureFunction } from '../myPureFunction';

describe('myPureFunction', () => {
  it('handles the happy path', () => {
    expect(myPureFunction(input)).toEqual(expected);
  });
  it('clamps unexpected inputs', () => { /* ... */ });
});
```

Run with `npm test` or `npx vitest run src/features/<area>`.

**Example**: Artist Cycle A covered `groupAssetsByDay` (date bucketing), `sessionOutputToMarkdown` (line-shape folding), `mergeTagAcross` (case-insensitive dedup), `format.ts` (6 time/size helpers), `normalizeProgress` (unit drift between Rust and React). 49 cases across 5 files in ~1 hour.

### Cycle B — hook state machines

**What**: Custom React hooks that own state transitions, side-effects, and IPC orchestration. The CRUD hooks (`use*Assets`), the lifecycle hooks (`use*Export`, `use*Persistence`), the selection hooks (`use*Selection`).

**Why second**: A hook is the smallest unit of behavior that crosses the React boundary. Testing it with `renderHook` catches contract drift between the React surface and the underlying IPC calls without needing the DOM — much faster to write than a component test and easier to debug when it fails.

**Tooling**:

```ts
// src/features/<area>/hooks/__tests__/<hook>.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { mockInvokeMap, resetInvokeMocks } from '@/test/tauriMock';
import {
  emitTauriEvent,
  installTauriEventEmitter,
  teardownTauriEventEmitter,
} from '@/test/helpers/tauriEventEmitter';

// Bypass the 2s IPC-token wait in tauriInvoke.ts.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

beforeEach(() => {
  resetInvokeMocks();
  installTauriEventEmitter();   // only if your hook listens to Tauri events
});
afterEach(() => teardownTauriEventEmitter());

it('does the thing', async () => {
  mockInvokeMap({ my_command: { ok: true } });
  const { result } = renderHook(() => useMyHook());
  await act(async () => { await result.current.doSomething(); });
  expect(result.current.state).toBe(...);
});
```

**Mocking primitives** (all in `src/test/`):
- `tauriMock.ts` — `mockInvoke`, `mockInvokeOnce`, `mockInvokeMap`, `mockInvokeError`, `resetInvokeMocks` for Tauri command stubbing.
- `helpers/tauriEventEmitter.ts` — `installTauriEventEmitter`, `emitTauriEvent`, `listenerCount` for driving `@tauri-apps/api/event` listeners.
- For Zustand stores: mock the module surface and provide a selector-compatible shim.

  ```ts
  vi.mock('@/stores/systemStore', () => ({
    useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ /* test state */ }),
  }));
  ```

**Critical**: every test file that calls IPC must plant `globalThis.__IPC_TOKEN = 'test-token'` at file scope. Without it, `_invokeCore` in `src/lib/tauriInvoke.ts` waits up to 2s per call for the token to appear, blowing past `waitFor`'s default 1s timeout. The pattern lives in `src/features/schedules/libs/__tests__/useCronPreview.test.ts` as well.

**Example**: Artist Cycle B covered `useGallerySelection` (toggle, shift-range, prune on items change), `useMediaExport` (progress event normalization, ETA derivation, error/cancel/dismiss), `useArtistAssets` (CRUD round-trips with mocked IPC), `useMediaStudioPersistence` (save/load + recents recording + autosave restore). 40 cases across 4 files in ~1.5 hours.

### Cycle C — component interactions

**What**: React components with non-trivial state machines: rename inputs, confirm-delete two-step buttons, modal forms, list components with keyboard nav, popovers, anything where rendering output depends on user interaction.

**Why third**: Component tests are slower to write than hook tests (more wiring of mocks, more DOM queries), but they exercise the visible surface end-to-end (input + state + DOM output) so a failing test maps directly to a broken user interaction. By this layer, the underlying hooks and helpers are already covered, so a component test that fails almost always points to a wiring/composition bug rather than a logic bug.

**Tooling**: Testing Library's `render`, `screen`, `fireEvent`, `act`, plus the same Tauri mocking primitives as Cycle B.

```tsx
// src/features/<area>/<sub>/__tests__/<Component>.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../hooks/useLocalImage', () => ({ useLocalImage: () => 'data:...' }));
// ... mock other store/translation deps the component reads ...

it('fires onAction when the button is clicked', () => {
  const onAction = vi.fn();
  render(<MyComponent onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /do thing/i }));
  expect(onAction).toHaveBeenCalledOnce();
});
```

**Translation gotcha**: components that use `useTranslation()` rely on `src/i18n/generated/enSectionStrings.ts`, which is regenerated by `scripts/i18n/split-locales.mjs`. If a session adds new i18n keys but only runs `gen-types.mjs` (which writes `types.ts` only), the committed `enSectionStrings.ts` goes stale and `t.section.new_key` resolves to `undefined` in tests, crashing the interpolation helper. Run `npm run codegen` or `node scripts/i18n/split-locales.mjs` after any `en.json` edit if you'll add component tests in the same branch.

**Example**: Artist Cycle C covered `AssetCard` (selection mode routing, rename input flow, send-to-media-studio), `GallerySelectionBar` (two-step confirm with 3s auto-cancel via fake timers), `BulkAddTagModal` (submit/cancel/Enter/Escape keyboard), `BeatSidebar` (active-beat highlight via test-supplied engine subscribe stub). 33 cases across 4 files in ~1.5 hours.

### Cycle D — Playwright vs full Tauri

**What**: End-to-end smoke flows that drive the real running app — real SQLite, real keyring, real IPC, real WebView2. Verifies the chain that mocked tests can't: IPC payload shape against the real Rust, store persistence across reloads, real Tauri events, real file dialogs.

**Why last**: Slow to author (every test needs `data-testid` hooks planted in source + a TS wrapper around the HTTP bridge), slow to run (singleton app, hundreds of ms per query, real LLM/network calls if the feature uses them), and brittle (real timing, real DOM lifecycle). One good Playwright smoke per feature catches what mocked tests can't; a hundred Playwright tests for one feature is a maintenance trap.

**Architecture**: Playwright is used here purely as a TS test runner — `expect()`, retry, HTML reporter. The actual UI is driven via an HTTP server the app exposes on `localhost:17320` when started with `npm run tauri:dev:test`. Bridge architecture details: [`docs/development/test-automation.md`](../development/test-automation.md).

**Pre-req**: the app must be running. Either:

```bash
npm run tauri:dev:test
# → Vite at :1420, Tauri WebView, axum HTTP bridge at 127.0.0.1:17320
```

Or for a production build pointed at a custom port:

```powershell
$env:PERSONAS_TEST_PORT = "17321"
& "C:\Users\<you>\AppData\Local\Personas\personas-desktop.exe"
$env:COMPANION_TEST_PORT = "17321"
npm run test:playwright:<feature>
```

**Author a new feature bridge**:

1. Plant `data-testid` attributes on the UI surfaces the bridge needs to drive. Use kebab-case, prefix with the feature name: `data-testid="artist-tab-gallery"`, `data-testid="asset-card-checkbox"`. Add only what the spec touches — testids accumulate as more flows get tested.
2. Author `tests/playwright/<feature>-bridge.ts` — wrap the HTTP-bridge primitives (`/click-testid`, `/find-text`, `/query`, `/bridge-exec`) into feature-aware verbs (`openGallery()`, `scanFolder()`, `selectAssets([ids])`). The companion bridge at `tests/playwright/companion-bridge.ts` is the canonical template.
3. Author `tests/playwright/<feature>-*.spec.ts` — use the bridge to express scenarios declaratively. Aim for one spec per top-level user flow (gallery flow, export flow, multi-select flow, …) rather than one spec per test case.
4. Add an npm script: `"test:playwright:<feature>": "playwright test --config=playwright.config.ts <feature>-"`.
5. Document the spec set in `tests/playwright/README.md`.

**Endpoint quirks** (learned the hard way; see `companion-bridge.ts:14-21` for the canonical reference):
- `/query` and `/find-text` return **bare arrays**, not `{nodes: [...]}`.
- `/eval` is **fire-and-forget**. For result-bearing JS, use `/bridge-exec` which dispatches to a named method on `window.__TEST__` and awaits via `__test_respond`.
- `/click-testid` and `/fill-field` use snake_case `test_id`.

**Workers must stay at 1** in `playwright.config.ts` if your feature has any shared backend state — single companion session, single database row, single selection bar at a time. For Artist, multi-asset operations are local-state, but `workers: 1` is the safe default until you've identified a specific source of parallel-safety.

**State-dependent assertions belong behind `test.skip()`, not `expect()`.** The running app holds real persisted state — autosaved compositions, scanned gallery assets, saved credentials, prior sessions. An assertion like "the empty-state row is visible" only holds on a fresh install; on a dev machine where autosave restored a real composition with clips, the empty-state branch is suppressed by design. Don't fight reality — gate the assertion on a precondition query and `test.skip()` with a reason when the precondition fails:

```ts
const empty = await bridge.query('[data-testid="media-studio-empty-state"]');
if (empty.length === 0) {
  test.skip(true, 'no empty state on this app instance (composition has items)');
  return;
}
// ...rest of the assertion...
```

This keeps the spec passing on both fresh-install and dirty-state machines, and records the reason for the skip so reviewers see it's intentional. The alternative — adding a "reset to fresh state" bridge method — is occasionally worth it for high-value flows but adds bridge surface area and risks erasing real user data on a dev box.

**When iterating on `bridge.ts`, expect a full app restart per edit.** The test bridge is loaded once at WebView init, exposed on `window.__TEST__`, and is NOT hot-reloadable — Vite emits an HMR update but the existing bridge instance keeps its old methods. Design the bridge method set up front and ship it in one commit; iterate freely on the TS bridge wrapper, the spec itself, and the testid attributes (all HMR cleanly). See [`parallel-cli-workflow.md`](parallel-cli-workflow.md#authoring-a-playwright-spec-against-a-running-app--operational-gotchas) for the full list of operational gotchas.

**Example**: see `tests/playwright/companion-bridge.ts` (~280 LOC) + `tests/playwright/athena-conversation.spec.ts` for the companion pattern. Artist's `artist-bridge.ts` + first spec follow the same shape.

---

## How to decide what to test

Not every line of code needs a test. The cycle structure already biases toward high-ROI: pure logic gets covered first, behavior gets covered before integration, integration gets covered before E2E.

Past that, the criteria for "does this deserve a test":

1. **Did it have a bug before?** Tests for fixed bugs are gold — they document the failure mode and prevent regression. A test labelled "regression for issue #X" is worth more than a generic case.
2. **Is the logic surprising?** A function that looks simple but has non-obvious edge cases (a unit-fix normalizer, a basename-with-Windows-slashes parser, a debounced effect) catches future contributors who didn't know about the quirk.
3. **Does it gate something irreversible?** Confirmation flows, file rename/delete, schema migrations, anything that touches keyring or real files. A test there is cheap insurance.
4. **Is it the public surface of a hook/component?** Anything other code calls into deserves at least one test confirming the contract holds.
5. **Is the cost of breakage high relative to the cost of the test?** A 200-line bridge file plus a flaky 30s spec is too expensive for testing "the page renders without crashing." A 20-line hook test is cheap enough to cover "the page renders without crashing" via a render assertion.

When in doubt: write the test if (a) you can imagine a future bug fix that this test would catch, AND (b) it's <50 lines of test code. Otherwise skip it.

---

## Anti-patterns

- **Testing implementation, not behavior.** "The hook calls `setState` 3 times" is not a useful test. "Calling `toggle()` flips `isSelected('a')` to true" is.
- **Mocking too much.** If a test needs 6 different module mocks to run, the unit under test is too coupled. Refactor toward a pure-function core that the test can hit directly.
- **One big test, fifty assertions.** A failing test should point at one broken contract. Split tests by scenario, name each scenario with `describe`/`it` that reads as the failure message you'd want on a regression: `"BulkAddTagModal — Enter does not submit while the input is empty"`.
- **Playwright everything.** The full-app E2E layer is the last and most expensive line of defense. A bug should ideally surface in Tier 1 or 2 long before Tier 3.
- **Skipping Cycle A.** "I'll just test the component" misses the case where the underlying helper has the bug. Always factor pure logic out first.

---

## Running the test suite

| Command | What it does |
| --- | --- |
| `npm test` | Run every Vitest test once (`vitest run`, default config). |
| `npx vitest run src/features/<area>` | Run just one feature's tests. Use this in tight loops while authoring. |
| `npm run test:watch` | Re-run on file change. |
| `npm run test:integration:cli` | Integration suite — serial, 180s timeouts, node env. |
| `npm run test:e2e:cli` | The "CLI-flavored E2E" jsdom suite. |
| `npm run test:playwright` | Full Playwright suite. **Requires app running.** |
| `npm run test:playwright:companion` | Just the companion specs. |
| `npm run test:playwright:<feature>` | Just one feature's specs (when authored). |

Vitest tests are 100% parallel-safe across worktrees — see [`parallel-cli-workflow.md`](parallel-cli-workflow.md) for the procedure.
