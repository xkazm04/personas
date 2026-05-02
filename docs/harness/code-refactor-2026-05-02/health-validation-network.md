# Code Refactor Scan — Health, Validation & Network

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~25

## Summary

The Health module is structurally clean inside `src/features/agents/health/` — small, well-doc'd, and deterministic IDs landed since the last scan. But three issues from the **2026-04-27 dev-experience scan are still here unchanged**: the orphan `sub_health/HealthTab.tsx`, the dead `src/api/validation.ts`, and the duplicated parsing helpers between `useHealthCheck.ts` and `healthCheckSlice.ts` (the consolidating `healthHelpers.ts` was actually deleted, leaving the duplication intact). The dominant pattern in this slice is **API-surface bloat**: nearly half of the functions exported from `src/api/network/*.ts` are never called by any frontend code (no store, no component, no test). Many of the unused functions accept hand-rolled types that exist *only* to support those dead exports — so deleting them removes whole interface definitions too. Network-side code is otherwise solid (the per-endpoint failure-counter rewrite is a textbook example of careful refactor). Health vs. digest paths still diverge in issue-ID generation (deterministic FNV vs. `digest_${ts}_${seq}`) and proposal coverage, which the slice quietly drops.

## 1. Entire `src/api/validation.ts` is dead — unchanged after two prior flags

- **Severity**: high
- **Category**: dead-code
- **File**: `src/api/validation.ts:1-13` (whole file, 13 lines)
- **Scenario**: Both exports — `getValidationRules()` and `validatePersonaContracts(personaId)` — have zero callers project-wide. The file pulls in `ContractReport` and `ValidationRule` ts-rs bindings that exist solely to support these unused functions. The dev-experience-2026-04-27 scan flagged this (finding #4); the bug-hunt-2026-04-27 scan did not, but a developer searching "where do I validate a persona" still lands here first and assumes it's the supported path.
- **Root cause**: API surface added speculatively; removal pass missed it. The earlier scan suggested either wiring `validatePersonaContracts` into `useHealthCheck.ts` alongside `get_persona_config_warnings` or deleting it. Neither was done.
- **Impact**: Misleading discoverability — first hit on "validate persona". Two ts-rs bindings (`ContractReport`, `ValidationRule`) ship in the bundle but back nothing. Every Rust schema change to those structs forces a regen for dead consumers.
- **Fix sketch**:
  - Confirm one more time: `git grep -n "@/api/validation\|api/validation"` returns zero non-doc hits (verified during this scan).
  - `git rm src/api/validation.ts` and the unreferenced `lib/bindings/ContractReport.ts`, `lib/bindings/ValidationRule.ts` (verify they're not exported from `lib/bindings/index.ts` for other consumers).
  - If the Rust `validate_persona_contracts` command is still useful, file an idea to wire it into the health-check flow before deleting.

## 2. `sub_health/HealthTab.tsx` orphan still here — flagged 3 times in prior scans

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/agents/sub_health/HealthTab.tsx:1-25` (orphan) vs. `src/features/agents/sub_health/components/HealthTab.tsx:1-46` (live)
- **Scenario**: `sub_health/index.ts` re-exports the `components/` version. A "Go to file" search on `HealthTab` returns both with equal probability. The two have drifted: the live file has a stale-data auto-refresh `useEffect`, the orphan does not. Already documented in dev-experience-2026-04-27 #1, bug-hunt-2026-04-27 #1, agent-tools-connectors-2026-05-02 #2.
- **Root cause**: April refactor lifted auto-refresh into `components/HealthTab.tsx` and the old top-level file was never deleted.
- **Impact**: Recurring onboarding tax — every developer who opens "Health Tab" via fuzzy-find spends 10–30 min figuring out which one is live. Three flagged scans imply the audit signal isn't being acted on, which devalues the audit pipeline itself.
- **Fix sketch**:
  - `git rm src/features/agents/sub_health/HealthTab.tsx`.
  - Verify `lib/harness/scenario-parser.ts` references `sub_health/` as a directory marker, not a file (already confirmed in agent-tools scan).

## 3. Nine network/identity/exposure API exports never called anywhere

- **Severity**: high
- **Category**: dead-code
- **File**: `src/api/network/discovery.ts:121,154,167,174` and `src/api/network/exposure.ts:75,81,91,98,101` and `src/api/network/identity.ts:59` and `src/api/network/bundle.ts:108,142`
- **Scenario**: Project-wide grep for each export against bare-word boundaries returns hits *only* in the file that defines the function (and the corresponding ts-rs binding test, if any):
  - `getConnectionStatus` (discovery.ts:121) — `ConnectionState` is read elsewhere, but the function itself isn't called.
  - `setNetworkConfig` / `NetworkConfig` (discovery.ts:174) — zero callers.
  - `sendAgentMessage` (discovery.ts:154) — zero callers; `AgentEnvelope` interface only used by `getReceivedMessages`.
  - `getReceivedMessages` (discovery.ts:167) — zero callers.
  - `getExposedResource` (exposure.ts:75), `updateExposedResource` (exposure.ts:81), `getExposureManifest` (exposure.ts:91), `listProvenance` is called via slice but `getResourceProvenance` (exposure.ts:101) is not.
  - `updateTrustedPeer` (identity.ts:59) — only `import`, `revoke`, `delete` are used by `IdentitySettings.tsx`.
  - `verifyBundle` (bundle.ts:108) — zero callers (verification happens through `previewBundleImport`).
  - `resolveShareDeepLink` (bundle.ts:142) — zero callers (deep-link resolution happens elsewhere or was descoped).
  - The networkSlice action `updateExposedResource` (slice line 252) wraps the dead API export and has zero callers either.
- **Root cause**: The P2P / sharing surface was implemented end-to-end on the Rust side and a thin TS wrapper exposed every command. The UI only ever consumed a subset, but the wrappers were never trimmed back. `ExposureManager.tsx` only calls `fetchExposedResources`, `createExposedResource`, `deleteExposedResource` — never `update`.
- **Impact**: ~70 LOC of dead API code plus three hand-rolled interfaces (`NetworkConfig`, `AgentEnvelope`, `UpdateExposedResourceInput`) and `UpdateTrustedPeerInput` — interface definitions worth keeping only if at least one caller exists. New developers reading the API barrel see a fully-fleshed-out CRUD surface and assume "update" is wired. Bundle ships dead `invokeWithTimeout` calls. `connectionStates` map in the slice is also incomplete-by-design — `getConnectionStatus` would be the natural "read current state" entrypoint and was never wired.
- **Fix sketch**:
  - Run `npx ts-prune --project tsconfig.json` to confirm none have hidden dynamic-key callers (none expected — these are all bare exports).
  - Delete the 11 listed exports plus the orphan slice action `updateExposedResource`.
  - Drop interfaces that become orphan after deletion: `NetworkConfig`, `AgentEnvelope`, `UpdateExposedResourceInput`, `UpdateTrustedPeerInput`.
  - Commit-message convention: cite this finding so the next audit can confirm follow-through.

## 4. `mapOverallStatus` and feasibility-parsing duplicated between hook and slice — drift already happened

- **Severity**: high
- **Category**: duplication
- **File**: `src/features/agents/health/useHealthCheck.ts:140-145` and `:265-301` vs. `src/stores/slices/agents/healthCheckSlice.ts:45-50` and `:52-115`
- **Scenario**: Both call `testDesignFeasibility(json)` and convert the result to a `DryRunResult`. They share one identical helper (`mapOverallStatus`, copied verbatim) but the rest has already drifted in three meaningful ways:
  1. **Issue IDs**: hook uses deterministic `makeIssueId()` (FNV-64 hex), slice uses non-deterministic `digest_${Date.now()}_${issueSeq++}`. So the same issue gets a different ID depending on which path generated it — `markIssueResolved` from one screen won't match identity from the other.
  2. **Proposals**: hook runs `generateHealthProposal()` against the credential/trigger/use-case keyword cascade, slice always sets `proposal: null` ("Digest view shows summary only").
  3. **Issue-text coercion**: hook has `coerceIssueText()` that handles non-string IPC entries safely, slice does plain `.map((text) => ...)` and would crash or render `[object Object]` if the backend returned a richer shape.
- **Root cause**: April scan flagged the duplication and proposed consolidating into `healthHelpers.ts`. That helper file was *deleted* (no `healthHelpers.ts` exists today) but the inline copies were never unified. The slice version lagged behind hook improvements.
- **Impact**: Every backend feasibility-status change requires touching two places. The non-deterministic digest IDs already break re-resolution semantics — re-running a digest mints fresh IDs even for unchanged issues. The `[object Object]` risk in the slice is a real defect waiting on a backend tweak.
- **Fix sketch**:
  - Export from `useHealthCheck.ts`: `mapOverallStatus`, `coerceIssueText`, `parseFeasibilityToHealthResult`, plus a digest-flavored `parseFeasibilityForDigest(persona)` that wraps the hook's parser but skips proposal generation if needed.
  - Have `healthCheckSlice.ts:checkSinglePersona` call the shared parser. Drop the non-deterministic `issueSeq` counter.
  - Add a unit test asserting both paths produce the same issue IDs for the same `(persona, feasibility)` input.

## 5. Three `ScoreRing` variants still hardcode the grade-color triple — flagged 04-27, untouched

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/agents/health/HealthScoreDisplay.tsx:36-58` (`ScoreRing` lg/sm), `src/features/agents/sub_chat/panels/OpsHealthPanel.tsx:9-35` (`MiniScoreRing`)
- **Scenario**: Three ring components in three files, each rendering a circular SVG progress indicator with the same `{ healthy: '#10B981', degraded: '#F59E0B', unhealthy: '#EF4444' }` palette. `HealthScoreDisplay` already has a sized variant (`lg`/`sm`) — adding the chat panel's "mini" size to that component is the obvious move, and `gradeColors.ts` already centralizes the `strokeHex` palette but `MiniScoreRing` doesn't import it. `OpsHealthPanel` is the only one that animates `strokeDashoffset` and the only one that omits `aria-hidden` on the SVG (a screen-reader inconsistency).
- **Root cause**: `MiniScoreRing` was lifted into chat by copy-paste before `gradeColors.ts` existed. After centralization, no one came back to migrate it.
- **Impact**: A designer's "darken unhealthy" change touches three call sites. Animation and a11y inconsistencies leak between health surfaces. `gradeColors.ts` exists but isn't consistently used — a partial-centralization smell.
- **Fix sketch**:
  - Extend `ScoreRing` with `size: 'lg' | 'md' | 'sm'` (md = OpsHealthPanel's 64×64) and `animated?: boolean` props.
  - Replace `MiniScoreRing` with `<ScoreRing score={score} size="md" animated />`.
  - Delete the inline `strokeColor` map; use `GRADE_COLORS[score.grade].strokeHex` from `gradeColors.ts`.

## 6. `HealthWatchToggle` bypasses the store and silently swallows GET errors

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/agents/health/HealthWatchToggle.tsx:14-29`
- **Scenario**: The component is the only file in the health module that hits the management HTTP API directly via `managementFetch`, bypassing `useAgentStore` and any `api/` module. The mount-time GET uses `silentCatch('HealthWatchToggle:load')` which sends a Sentry breadcrumb but no UI feedback — the toggle silently shows `enabled = false` after a transient backend error, contradicting the actual server state. The POST does have a toast on failure (`toastCatch`), so the read/write paths are inconsistent. Documented as finding #9 in the 04-27 dev-experience scan and not addressed.
- **Root cause**: One-off feature added straight into a presentation component without an `api/agents/healthWatch.ts` module. The pattern violates the in-module convention (every other panel in the health module routes through the store and an `api/` wrapper).
- **Impact**: Toggle state can disagree with backend after a flaky cold-start. Cannot be unit-tested without mocking `managementFetch` directly. New devs copying this pattern will replicate the silent-fail.
- **Fix sketch**:
  - Extract `getHealthWatchSetting(personaId)` / `setHealthWatchSetting(personaId, opts)` into `src/api/agents/healthWatch.ts`.
  - On read failure, surface `error` state and display a small "Could not load — retry" inline cue rather than silently rendering `false`.
  - Optional: hoist into `agentStore` as `healthWatchByPersonaId: Record<string, boolean>` so multiple components can subscribe.

## 7. `connectionStates` map grows forever — no eviction on disconnect-from-peer-list

- **Severity**: medium
- **Category**: cleanup
- **File**: `src/stores/slices/network/networkSlice.ts:75,442,446,451,462`
- **Scenario**: `connectToPeer` / `disconnectPeer` write to `connectionStates: Record<string, ConnectionState>`. There's no eviction path: a peer that disappears from `discoveredPeers` (because they went offline and the backend prunes them) leaves a stale `"Connected"` or `"Failed"` entry sitting in the map forever. `PeerList.tsx:30` reads `connectionStates[peer.peer_id]` as the source of truth for the connection-pill, so until the user manually clicks Disconnect, the pill renders an obsolete state.
- **Root cause**: Action-driven map (only updated on user action), but the underlying state is event-driven (peers come and go independently of user clicks).
- **Impact**: Stale UI rows show "Connected" for peers the backend has long since dropped. Memory grows linearly with unique peer count over a long-running session. Subtle bug: reconnecting to a peer that previously failed will briefly show "Failed" until `connectToPeer` runs.
- **Fix sketch**:
  - On `fetchDiscoveredPeers` success, intersect `connectionStates` keys with the new `peer_id` set; drop entries for peers no longer discovered.
  - Or: delete the action-driven map entirely and read `is_connected` straight off `DiscoveredPeer` (the backend already provides it).
  - Add a test that a stale entry is purged after a `fetchDiscoveredPeers` that no longer includes the peer.

## 8. Network types hand-written in `discovery.ts` despite ts-rs being the project convention

- **Severity**: medium
- **Category**: structure
- **File**: `src/api/network/discovery.ts:7-102`, `src/api/network/bundle.ts:7-130`, `src/api/network/exposure.ts:14-66`
- **Scenario**: `discovery.ts` defines `NetworkSnapshot`, `ConnectionHealth`, `MessagingMetrics`, `ConnectionMetricsSnapshot`, `ManifestSyncMetrics` as hand-written TS interfaces. Within a single struct the field convention is mixed: `is_running` (snake) sits next to `avgLatencyMs` (camel) in `NetworkStatusInfo` / `ConnectionHealth`. Same in `bundle.ts` and `exposure.ts`. Meanwhile `enclave.ts` imports `EnclavePolicy`, `EnclaveSealResult`, `EnclaveVerifyResult` from `@/lib/bindings/...` (ts-rs generated) — proving the convention is partially adopted. Flagged in 04-27 dev-experience finding #11.
- **Root cause**: Generated bindings adopted incrementally; network types predate the convention. No lint rule catches new hand-written interfaces in `api/`.
- **Impact**: A Rust struct field rename silently breaks runtime — the TS side coerces the JSON shape with no type-system check. The case-style inconsistency within a single struct is jarring during code review and produces real bugs (e.g. a Rust dev returns `connectedCount` while TS expects `connected_count`).
- **Fix sketch**:
  - Add ts-rs derives on the Rust structs (`NetworkSnapshot`, `ConnectionHealth`, etc.) under `src-tauri/`.
  - Re-export from the API modules so existing imports continue to work.
  - Standardize the wire format with `serde(rename_all = "camelCase")` on the Rust side, since the existing TS already uses camel case for half the fields.

## 9. `inferSeverity` aliasing in slice is pointless — just import directly

- **Severity**: low
- **Category**: cleanup
- **File**: `src/stores/slices/agents/healthCheckSlice.ts:42-43`
- **Scenario**: The slice has `const inferSeverity = inferIssueSeverity;` with a `@see` comment. The alias is used exactly once (line 64) and adds no clarity — the only reason to alias is to bridge a name change, but `inferIssueSeverity` is the same import name across both files (`useHealthCheck.ts` uses it directly without alias).
- **Root cause**: Refactor leftover. The original local helper got replaced with an import and the variable name was preserved with an alias instead of being renamed at the single call site.
- **Impact**: Tiny, but reads as "this is doing something special" when it isn't. Inconsistent with `useHealthCheck.ts` which calls `inferIssueSeverity(text, raw.overall)` directly.
- **Fix sketch**:
  - Delete the alias line and the stale `@see` JSDoc.
  - Inline `inferIssueSeverity(text, raw.overall)` at line 64.

> Total: 9 findings (4 high, 4 medium, 1 low)
