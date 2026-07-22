# lib/credentials — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 2 medium / 4 low)
> Context group: Core Libraries & State | Files read: 9 | Missing: 0

## 1. Audience filter re-parses every connector's metadata JSON on each filter pass
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: missing-caching
- **File**: src/lib/credentials/connectorAudiences.ts:153
- **Scenario**: The catalog picker (`usePickerFilters.ts:97`) calls `connectorMatchesAudience(c.name, c.metadata, activeRole)` per connector while filtering. `audiencesFromMetadata` does `JSON.parse(metadata)` on each call, so every filter re-evaluation (role toggle, search keystroke that recomputes the memo, catalog refresh) re-parses ~100 metadata JSON blobs from scratch.
- **Root cause**: `getAudiencesForConnector` is stateless and accepts the raw serialized metadata string; there is no per-credential parse cache, and the call site is inside an array `.filter` in a React memo that recomputes on several dependencies.
- **Impact**: Bounded but repeated waste on an interactive path — O(connectors × metadata size) JSON parsing per filter evaluation. With large metadata blobs (connector defs carry fields/services/events) this is the dominant cost of the picker filter.
- **Fix sketch**: Add a `WeakMap`/`Map<string, Audience[]>` memo keyed on the metadata string (strings are stable per credential row), or have the caller parse metadata once per connector (it already has `ConnectorMetadata` parsing helpers elsewhere) and pass the parsed object. A 5-line `const parseCache = new Map<string, Audience[]>()` inside `audiencesFromMetadata` fixes it without changing the API.

## 2. Seven exported functions/constants have no callers anywhere in src/
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/credentials/connectorRoles.ts:275
- **Scenario**: Repo-wide grep finds no importers for: `hasAlternatives`, `getArchitectureComponent`, `getPurposeGroupForConnector`, `resolveRoleLabel` (connectorRoles.ts:145/256/275/291), `ALL_AUDIENCES` (connectorAudiences.ts:20), and `clearRecipeCache`, `recipeToConnectorContext` (credentialRecipeRegistry.ts:25/153). Only their definitions and doc-comments mention them.
- **Root cause**: The audience refactor (replacing `ROLE_PRESETS`) and the AutoCred/recipe evolution left behind exports whose consumers were rewritten or removed; `ArchitectureComponent` and its builder appear to be leftovers from an earlier adoption-wizard design.
- **Impact**: ~80 lines of unmaintained API surface that future readers must assume is live; `clearRecipeCache` in particular implies a logout/reset hook that does not actually exist, which is misleading (the recipe memory cache is never cleared).
- **Fix sketch**: Delete `hasAlternatives`, `getArchitectureComponent` + the `ArchitectureComponent` interface, `getPurposeGroupForConnector`, `resolveRoleLabel`, `ALL_AUDIENCES`, and `recipeToConnectorContext`. For `clearRecipeCache`, either wire it into the data-reset path or delete it too. Verification note: grep covered all of src/ including tests; none of these names are plausible dynamic-dispatch targets.

## 3. Entire 1,626-line endpoint catalog is eagerly bundled for one playground tab
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: payload-bundle
- **File**: src/lib/credentials/catalogApiEndpoints.ts:1551
- **Scenario**: `CATALOG_API_ENDPOINTS` (~70 connectors × 5-10 endpoint descriptors, ~60KB of object literals) has exactly one consumer: `PlaygroundTabContent.tsx`, a tab inside the vault credential detail view. It is statically imported, so the whole catalog is parsed and materialized at app startup even for users who never open the API Explorer.
- **Root cause**: Static import of a large pure-data module from a leaf UI component; no code-splitting boundary.
- **Impact**: Startup parse/heap cost only (desktop app, no network), so bounded — but it is the largest single data module in this context and grows with every connector added.
- **Fix sketch**: Convert the consumer to `const { CATALOG_API_ENDPOINTS } = await import('@/lib/credentials/catalogApiEndpoints')` inside an effect (or `React.lazy` the playground tab itself). Alternatively move each connector's endpoint list into its existing `scripts/connectors/builtin/<name>.json` and load per-connector on demand.

## 4. `getAlternatives` does a linear role-table scan per rendered connector row
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: missing-memoization
- **File**: src/lib/credentials/connectorRoles.ts:263
- **Scenario**: `ConnectorsTabSections.tsx:123` calls `getAlternatives(status.name)` for every connector row on every render; each call scans all ~40 `CONNECTOR_ROLES` entries with `members.includes(name)`.
- **Root cause**: The file already demonstrates the right pattern — `_connectorPurposeMap` is precomputed at module load (line 236) — but `getRoleForConnector` was left as a `.find` scan.
- **Impact**: O(rows × roles × members) per render; small in absolute terms today, but it runs inside list-render on a screen that re-renders on status polling, and the fix is one map.
- **Fix sketch**: Build a `Map<string, ConnectorRole>` from member name to role next to `_connectorPurposeMap` at module init and have `getRoleForConnector` do a single `Map.get`. `getAlternatives`/`getPurposeGroupForConnector` inherit the win.

## 5. License-tier entries filed under the wrong comment sections
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/lib/credentials/connectorLicensing.ts:102
- **Scenario**: `asana: 'enterprise'` (line 102) sits in the middle of the `-- Personal (free) --` block, and `cal_com: 'personal'` (line 150) plus `granola: 'paid'` (line 143, in the personal block) sit under/around headers that contradict their values. Anyone bulk-editing a section by its header will mis-classify these.
- **Root cause**: Values were changed in place over time without moving the entries to the matching comment section.
- **Impact**: No runtime effect, but the section comments are the primary navigation aid in a ~100-entry table and currently lie in three places.
- **Fix sketch**: Move `asana` to the Enterprise block, `cal_com` to the Personal block, and `granola` to the Paid block so each header is truthful. Optionally add a tiny test asserting section membership is cosmetic-only (values are already tested elsewhere).

## 6. Stranded "-- Export --" section banner mid-file
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/lib/credentials/catalogApiEndpoints.ts:1100
- **Scenario**: The `// -- Export ---` banner sits at line 1100, but ~20 connector definitions (Canva through Granola, lines 1102-1549) were appended after it; the actual export is at line 1551.
- **Root cause**: New connector sections were added at the old end-of-file marker instead of above it.
- **Impact**: Cosmetic only, but it misleads readers/tools scanning for the export boundary and invites the next connector to be added in the wrong spot again.
- **Fix sketch**: Delete the banner at line 1100 (or move it to directly above `CATALOG_API_ENDPOINTS` at line 1551).
