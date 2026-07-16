# vault/dependencies — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 5 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 11 | Missing: 0

## 1. NodeChip.tsx is a dead file (NodeChip + HealthDot have zero importers)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_dependencies/NodeChip.tsx:12
- **Scenario**: Grep across `src/` finds no import of `NodeChip` or of this file's `HealthDot` anywhere (the `HealthDot` used by triggers/byom are unrelated local components). The list-chip UI it served was replaced by the SVG `GraphCanvas` node rendering.
- **Root cause**: The dependency view migrated from a chip-list layout to the canvas graph, and the old presentational components were left behind.
- **Impact**: 55 lines of dead UI that still binds i18n keys (`dep_count_one/other`, `healthy`, `not_tested`) — future refactors of `GraphNode.meta` or the translation tree pay a false maintenance tax; readers assume it is live.
- **Fix sketch**: Delete `NodeChip.tsx`. Before deleting, run one repo-wide grep including tests/stories to confirm no dynamic usage (none found in `src/`). Also drop the now-orphaned static `KIND_LABELS` export in `graphConstants.ts:12` (only `getKindLabels(t)` is consumed; the `KIND_LABELS` in `DependencyGraphPanel.tsx` is a separate local const).

## 2. GraphCanvas declares and receives filteredNodes/filteredEdges/credentials props it never uses; parent burns two useMemos feeding them
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_dependencies/GraphCanvas.tsx:35
- **Scenario**: `GraphCanvasProps` declares `filteredNodes`, `filteredEdges`, and `credentials`, and `CredentialRelationshipGraph.tsx:65-73,160` computes/passes all three — but the destructure at `GraphCanvas.tsx:35` drops them; filtering is actually implemented via `filterKind` dimming (`nodeDimmed`, edge `filterDim`).
- **Root cause**: The canvas originally rendered only the filtered subset; it was changed to render everything and dim non-matching kinds, but the old prop plumbing was never removed.
- **Impact**: Two wasted `useMemo` passes (Set build + two array filters) on every graph/filter change, plus a misleading contract — a reader tuning the filter behavior will edit `filteredNodes` and see no effect.
- **Fix sketch**: Remove `filteredNodes`, `filteredEdges`, `credentials` from `GraphCanvasProps` and the call site, and delete the two `useMemo`s in `CredentialRelationshipGraph.tsx:65-73`. If subset-rendering is ever wanted back, derive it inside `GraphCanvas` from `nodes` + `filterKind`.

## 3. analyzeBlastRadius and simulateRevocation duplicate the edge-scan/dedupe logic for affected agents and events
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:184
- **Scenario**: Both functions independently build `allEdges` from two `edges.filter` passes, then run near-identical loops deduping agent neighbors (`credentialGraph.ts:189-198` vs `288-309`) and event neighbors (`203-212` vs `314-320`). A past bug in exactly this area (events not counted toward severity) had to be fixed in both places.
- **Root cause**: `simulateRevocation` was written by copying `analyzeBlastRadius` and enriching with health data instead of extracting a shared neighbor-collection step.
- **Impact**: Any future change to neighbor semantics (new edge directions, new node kinds, new dedupe rules) must be applied twice; divergence directly mis-reports blast radius vs simulation severity for the same credential.
- **Fix sketch**: Extract `collectCredentialNeighbors(credentialId, graph): { agents: {id, label, via}[], eventIds: Set<string> }` that does the single edge scan with a prebuilt node map; have `analyzeBlastRadius` map it directly and `simulateRevocation` enrich agents with `healthMap`. Both then call `severityForBlastRadius(agents.length, eventIds.size)`.

## 4. N+1 IPC/SQLite calls: getCredentialDependents invoked once per credential on every graph mount
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:44
- **Scenario**: The mount effect fires `getCredentialDependents(cred.id)` for every credential — N separate Tauri IPC round-trips, each running its own rusqlite query. The effect keys on the `credentials` array identity, so any vault-store refresh that recreates the array re-runs the full N-call sweep (and re-flashes the loading spinner).
- **Root cause**: The backend command is per-credential; the frontend fans out with `Promise.all` instead of a batched query.
- **Impact**: With a few dozen credentials this is dozens of IPC hops + dozens of SQLite statements where one `WHERE credential_id IN (...)`/`GROUP BY credential_id` query would do; scales linearly with vault size on a view users open repeatedly.
- **Fix sketch**: Add a Rust command `get_all_credential_dependents()` (single query grouped by `credential_id`, returning `HashMap<String, Vec<CredentialDependent>>`) and call it once. Short of a backend change, at least gate re-fetch on a stable key (e.g. joined sorted credential ids) so store-identity churn doesn't re-trigger the sweep.

## 5. Hover on any graph node re-renders the entire SVG scene (unmemoized nodes/edges, framer-motion elements)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_dependencies/GraphCanvas.tsx:42
- **Scenario**: `setHovered` fires on every `onMouseEnter` of every node (and `onMouseLeave` of the container), re-rendering `GraphCanvas` wholesale: all edge `motion.line`s are rebuilt inline and every `GraphNodeCircle` re-renders because it is not memoized and receives fresh `onClick` closures (`GraphCanvas.tsx:145`). Sweeping the cursor across a cluster triggers this once per node crossed.
- **Root cause**: Hover state lives at the canvas root and no child is wrapped in `React.memo`; per-node `onClick={() => onNodeClick(node.id)}` defeats memoization anyway.
- **Impact**: O(nodes + edges) React reconciliation with framer-motion components on the hottest interaction path; with ~100+ nodes/edges hover tracking becomes visibly janky on the desktop app.
- **Fix sketch**: Wrap `GraphNodeCircle` in `React.memo` and pass stable props: `onClick={onNodeClick}` with the id passed inside the child (`() => onNodeClick(node.id)` moved into the memoized child, or `onClick(node.id)`), and compute `highlighted`/`dimmed` as primitives (already booleans — fine). Optionally split the edge layer into a memoized `<EdgeLayer edges hoveredId filterKind/>` so only opacity-affected props change.

## 6. Repeated linear graph.nodes.find inside edge loops — O(E×N) neighbor lookups
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: quadratic-scan
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:193
- **Scenario**: `analyzeBlastRadius` (lines 193, 207) and `simulateRevocation` (lines 292, 317) call `graph.nodes.find` for every edge touching the credential; `NodeDetailPanel.tsx:22` does `allNodes.find` per edge; `buildCredentialGraph` runs `credentialEvents.filter` per credential (line 382) and `personas.find` per dependent (line 423).
- **Root cause**: No id-indexed map is built before the loops, even though `GraphCanvas` already demonstrates the pattern with its `nodeMap` memo.
- **Impact**: O(E×N) / O(C×E) work on every selection click and every graph rebuild. Bounded on a personal vault (tens of nodes), so cost is real but small today; it grows quadratically with vault size.
- **Fix sketch**: Build `const nodeById = new Map(graph.nodes.map(n => [n.id, n]))` at the top of `analyzeBlastRadius`/`simulateRevocation` (or store it on `CredentialGraph` at build time) and use `nodeById.get(otherId)`. In `buildCredentialGraph`, pre-group `credentialEvents` by `credential_id` and personas by id in single passes.
