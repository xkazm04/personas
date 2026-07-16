# stores (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 1 medium / 1 low)
> Context group: Core Libraries & State | Files read: 4 | Missing: 0

## 1. Store-layer selectors depend on a feature UI component file for core parsing infra
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/stores/selectors/personaSelectors.ts:18
- **Scenario**: `personaSelectors.ts` (store layer) imports `parseDesignContext` from `@/features/agents/sub_lab/use-cases/UseCasesList` — a `.tsx` component file that also imports `AnimatedList`, `lucide-react`, and i18n. Every module that touches the persona selectors (8+ hooks/components across templates, connectors, activity, arena) transitively pulls the Lab component and its UI deps into its module graph.
- **Root cause**: The parser plus its 32-entry LRU cache grew inside the component file where it was first needed; the file even carries a "re-exports for backward compatibility" block acknowledging types already moved to `frontendTypes.ts`, but the parser itself never moved.
- **Impact**: Inverted dependency (state layer → feature component) is a maintenance hazard — refactoring or lazy-loading the Lab feature can break unrelated store selectors — and it defeats any code-splitting of UseCasesList since core selectors keep it eagerly loaded.
- **Fix sketch**: Move `parseDesignContext`, `EMPTY_DESIGN_CONTEXT`, and the `_parseCache` LRU to a pure module, e.g. `src/lib/parseDesignContext.ts` (no React/UI imports). Re-export from `UseCasesList.tsx` for backward compatibility (matching the pattern already used for the types), and point `personaSelectors.ts` and the other direct importers (`useConnectorStatuses`, etc.) at the lib path. Pure code move, no behavior change.

## 2. Write-dedup cache retains the full serialized payload of every persisted store indefinitely
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: memory-retention
- **File**: src/stores/util/dedupedStorage.ts:12
- **Scenario**: `lastWritten` keeps the complete last-written JSON string per persist key for the app's lifetime. For stores with large partialized payloads (agentStore persists persona data), the serialized state is held in memory twice — once in zustand, once as this string — even long after writes stop.
- **Root cause**: Dedup compares the full previous value string instead of a digest, and the module-scoped Map has no way to release entries except `removeItem`.
- **Impact**: Bounded (one entry per persist key, currently 3 stores) but proportional to payload size; a large persisted store means a permanently retained duplicate JSON string of that size. No user-visible effect today — this is polish against future payload growth.
- **Fix sketch**: Store a cheap digest instead of the raw string, e.g. `${value.length}:${hash(value)}` with a small FNV-1a/djb2 string hash, and compare digests in `setItem`. Keeps the one-write-per-change guarantee (hash collision risk is negligible when combined with length) while capping retained memory to a few bytes per key. Update the unit tests in `dedupedStorage.test.ts` only if they inspect the cache directly.
