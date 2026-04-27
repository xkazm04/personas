# Health, Validation & Network — Dev Experience Scan

> Total: 11 · Critical: 0 · High: 4 · Medium: 5 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Two `HealthTab.tsx` files in the same module — barrel exports the wrong one silently

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/agents/sub_health/HealthTab.tsx` (orphan) and `src/features/agents/sub_health/components/HealthTab.tsx` (live)
- **Scenario**: Developer searching for "HealthTab" by Cmd-T or "Go to file" gets two hits. Only `components/HealthTab.tsx` is re-exported by `sub_health/index.ts`; the top-level file is dead code that still does its own auto-refresh-on-stale logic. Editing the wrong file produces no runtime change but passes type-check, builds, and lints — burning 10–30 min on the first encounter. Identical pattern (top-level + `components/` shadow) does not exist for any other `sub_*` module under `src/features/agents`.
- **Root cause**: A file move was started (top-level → `components/`) and the source file was never deleted. Index points to the new location; the old one was orphaned.
- **Impact**: New contributors will reliably edit the wrong file once. Loss of 15–30 min per first encounter. Auto-refresh-on-stale logic only present in the orphan file is silently absent from the live one.
- **Fix sketch**: Delete `src/features/agents/sub_health/HealthTab.tsx` after porting the auto-refresh-on-stale `useEffect` into the live file (or decide it isn't wanted and document why). Add an ESLint rule (or simple repo grep in CI) that flags duplicate filenames within a feature directory.

---

## 2. `mapOverallStatus`, `inferSeverity`, `issueSeq` duplicated across health-check modules

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/agents/health/useHealthCheck.ts:127-132`, `src/features/agents/health/healthHelpers.ts:7-20`, `src/stores/slices/agents/healthCheckSlice.ts:39-49`
- **Scenario**: A backend feasibility-status string changes ("ready" → "complete") or a new severity heuristic is added. The fix has to be made in three places. `healthHelpers.ts` already exports `mapOverallStatus` and `nextIssueSeq` for exactly this purpose, but neither `useHealthCheck.ts` nor `healthCheckSlice.ts` imports from it — they each define their own private copies. The two `issueSeq` counters are independent module-locals, so digest-issue IDs (`digest_${ts}_${seq}`) and panel-issue IDs (`hc_${uuid}`) can never collide today, but the duplication invites future drift.
- **Root cause**: `healthHelpers.ts` was added to consolidate helpers but the existing call sites were never migrated. No lint rule prevents re-declaration of the same name across the module.
- **Impact**: Three-place fix on every health-check semantic change. Tests for either copy don't cover the other. Increases drift risk on every PR.
- **Fix sketch**: Delete the inline definitions from `useHealthCheck.ts` and `healthCheckSlice.ts`; import from `healthHelpers.ts`. Re-export `validateSeverity` from helpers as well (it exists only inline in `useHealthCheck.ts`).

---

## 3. `mapOverallStatus` regex matches "block" inside the literal "blocked-by-cred" — fragile string heuristics

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/agents/health/healthHelpers.ts:14-20` (and its two duplicates per finding #2)
- **Scenario**: Backend feasibility result `overall: "ready (with one blocked-by-credential warning)"` flips status to `'blocked'` because `o.includes('block')` matches first. Same risk for `"pass"` matching inside `"passable"` or `"surpasses limits"`. There's no test asserting the mapping for adversarial substrings — `searchInTests` returns 0 hits for `mapOverallStatus`.
- **Root cause**: Substring-match on free-form prose where the IPC contract should be a tagged enum. The TS type says `string` instead of a literal union; the Rust side controls the format but the boundary isn't typed.
- **Impact**: One backend prose tweak silently flips every persona to "blocked" in the digest. Hard to debug — feasibility looks fine in isolation.
- **Fix sketch**: Define the contract as `"ready" | "partial" | "blocked"` at the IPC boundary (ts-rs binding), drop the substring match. Until that's possible, switch to whole-word boundary regex (`/\bblocked?\b/i`) and add a unit test table with adversarial inputs.

---

## 4. `src/api/validation.ts` is dead code — exported but never imported

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/api/validation.ts` (entire file, 14 lines)
- **Scenario**: `getValidationRules()` and `validatePersonaContracts(personaId)` are exported, but a repo-wide grep finds zero callers. The file pulls in `ContractReport` and `ValidationRule` ts-rs bindings that exist only to support these unused functions. Developers searching for "where do I validate a persona" find this file first and assume it's the supported path — only to realize it's never wired up.
- **Root cause**: API surface added speculatively or for a feature that was deprioritized; removal pass missed it.
- **Impact**: Misleading discoverability; unused ts-rs bindings still ship; future schema changes require updating dead code.
- **Fix sketch**: Either wire `validatePersonaContracts` into the health-check flow (it likely belongs alongside `get_persona_config_warnings` in `useHealthCheck.ts:309`) or delete the file and the unreferenced bindings. Add a dead-code check (`ts-prune` or `knip`) to CI.

---

## 5. Three SVG score rings (`ScoreRing`, `CompactScoreRing`, `MiniScoreRing`) duplicate the same logic at three sizes

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/agents/health/HealthScoreDisplay.tsx:32-55`, `src/features/agents/health/HealthDigestPanel.tsx:24-47`, `src/features/agents/sub_chat/panels/OpsHealthPanel.tsx:9-35`
- **Scenario**: Designer asks "make the unhealthy color slightly darker" or "add hover tooltip with the numeric score". The grade-color triple `{ healthy: '#10B981', degraded: '#F59E0B', unhealthy: '#EF4444' }` is hardcoded in all three components. `OpsHealthPanel`'s ring is the only one that animates `strokeDashoffset` based on score — and is the only one that renders without `aria-hidden`, so a screen reader sees the inner SVG element.
- **Root cause**: Each ring was lifted ad-hoc from one component to another by copy-paste; no shared `<HealthScoreRing size="sm|md|lg">` primitive.
- **Impact**: Triple-touch on every visual change; one component is silently inaccessible; progress animation drift is invisible until someone notices the digest panel doesn't animate while the chat panel does.
- **Fix sketch**: Extract a single `HealthScoreRing` component with `size`, `animated`, and `showLabel` props. Move the grade-color map to `designTokens.ts` (it's already the canonical home for `SEVERITY_STYLES`).

---

## 6. No tests for `useHealthCheck`, `computeHealthScore`, or `classifyIssueCategory` — the entire client health pipeline

- **Severity**: High
- **Category**: testing
- **File**: `src/features/agents/health/useHealthCheck.ts` (385 lines, 0 tests), `src/features/agents/health/icons/index.ts:44-56` (0 tests)
- **Scenario**: A PR tweaks penalty weights in `HEALTH_SCORING` (line 47) or moves a keyword between `POLICY_PATTERNS` and `RUNTIME_PATTERNS`. There is no test that asserts "4 errors → score 0" or "issue containing 'review' classifies as policy". Regression is caught only by manual QA. `searchInTests` for `computeHealthScore`, `classifyIssueCategory`, `inferIssueSeverity` returns 0 matches.
- **Root cause**: Tests were added for the network slice but not for the health-check logic. There's no co-located `__tests__/` folder under `health/` or `sub_health/`.
- **Impact**: Every change to scoring or classification is high-risk. The single most user-visible health metric has no regression coverage.
- **Fix sketch**: Add `useHealthCheck.test.ts` with table-driven tests covering: scoring math at boundary values (49, 50, 79, 80), severity inference for representative strings, status mapping including adversarial substrings (#3), and proposal generation per keyword bucket. Add `classifyIssueCategory.test.ts` with the 11 keyword patterns.

---

## 7. `parseLastRunMs` reinvented inline instead of using shared `parseIsoToMs` helper

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/features/agents/health/useHealthDigestScheduler.ts:16-20`
- **Scenario**: The codebase has `formatTimestamp` (used by both health panels) but no symmetric `parseIsoMs`/`parseTimestamp`. The scheduler had to invent `parseLastRunMs` to handle "missing | empty | NaN | valid" because every other timestamp parse just calls `new Date(x).getTime()` and inherits the NaN bug. `isTimestampStale` (in `healthCheckSlice.ts:19`) does NOT have the same NaN guard — it returns `false` (i.e., not stale) for an unparseable string, which is the wrong default.
- **Root cause**: Each consumer rolls its own ISO-parse semantics; no shared utility encodes the "treat NaN as never-run" invariant.
- **Impact**: `isTimestampStale` will tell the digest UI that a corrupted timestamp is fresh, suppressing the auto-refresh banner forever. Easy to miss because the path requires a corrupted setting.
- **Fix sketch**: Move `parseLastRunMs` into `lib/utils/formatters.ts` as `parseIsoToMs(raw): number | null`. Update `isTimestampStale` to use it (`if (ms === null) return true`). Add a unit test for the corrupted-timestamp path in both consumers.

---

## 8. Network slice's "shared failure counter" contract is documented but not enforced — easy to silently break

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/stores/slices/network/networkSlice.ts:23-54` (doc), `:419-524` (the three pollers)
- **Scenario**: Developer adds a fourth poller (`fetchPeerCapabilities`, say) and follows the existing pattern by copy-pasting `fetchNetworkSnapshot`. They forget to update `networkConsecutiveFailures` (the doc says "MUST increment ... otherwise it will silently bypass the staleness warning" but nothing checks this). The new poller fails forever and the staleness banner never fires. The existing tests would still pass because they only exercise the original three pollers.
- **Root cause**: Convention encoded in a doc-comment, not in a type or wrapper. Each of the three existing pollers duplicates 5 lines of failure-counter bookkeeping.
- **Impact**: Each new poller risks silently breaking the staleness UX. Boilerplate copy-paste makes the slice 100+ lines longer than it needs to be.
- **Fix sketch**: Extract a `withFailureCounter(label, fn)` helper in the slice that wraps the try/catch + counter mutation. Then `fetchNetworkSnapshot = withFailureCounter('snapshot', async () => { ... })`. Now adding a poller is one helper call; the contract is enforced by construction.

---

## 9. `HealthWatchToggle` reads/writes settings via raw `managementFetch` — bypasses store and has no error UI

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/features/agents/health/HealthCheckPanel.tsx:254-309`
- **Scenario**: Component is the only thing in the health module that hits the management HTTP API directly instead of going through `useAgentStore` or an `api/` module. On mount it does `managementFetch(\`/api/settings/health-watch/${persona.id}\`).then(r => r.ok ? r.json() : null).then(d => { ... }).catch(() => {})` — a silent catch with no Sentry breadcrumb, no toast, and no retry. Read errors and write errors are not distinguished. The toggle's `enabled` state can disagree with the backend if the GET silently fails.
- **Root cause**: One-off feature added straight into a presentation component without an `api/agents/healthWatch.ts` module or store action. Doesn't follow the documented "best-effort sub-checks" policy that the rest of `useHealthCheck.ts` follows (silentCatch + Sentry breadcrumb).
- **Impact**: Sentry never sees health-watch settings failures. Toggle silently shows the wrong state on transient backend errors. Feature can't be unit-tested without mocking `managementFetch` directly.
- **Fix sketch**: Extract `getHealthWatchSetting(personaId)` / `setHealthWatchSetting(personaId, opts)` into `src/api/agents/healthWatch.ts`. Wrap the failure path in `silentCatch('HealthWatchToggle:read')`. Add an error toast on write failure consistent with the existing `addToast(t.agents.settings_status.failed_health_watch, 'error')`.

---

## 10. Issue keyword-classification patterns scattered across two files with no doc/test linkage

- **Severity**: Low
- **Category**: documentation
- **File**: `src/features/agents/health/icons/index.ts:11-42` (POLICY_PATTERNS, RUNTIME_PATTERNS) and `src/features/agents/health/useHealthCheck.ts:134-202` (`generateHealthProposal` keyword switch)
- **Scenario**: Adding a new issue type "rate-limit" requires understanding that: (a) the icon comes from `classifyIssueCategory` matching `RUNTIME_PATTERNS`, (b) the auto-fix proposal comes from the unrelated keyword cascade in `generateHealthProposal`, (c) the severity comes from `inferIssueSeverity` in `lib/errorTaxonomy.ts`. None of these reference each other; nothing documents that they should stay aligned (e.g., everything classified `policy` should plausibly produce a review-policy fix proposal).
- **Root cause**: Three independent string-matching layers added at different times; no taxonomy doc.
- **Impact**: A new issue category requires touching three files and there's no checklist. Misalignment (e.g., a policy issue with a runtime icon) ships unnoticed.
- **Fix sketch**: Add a 30-line `health/CATEGORIES.md` (or JSDoc on `IssueCategory` type) that maps category → expected icon, severity bias, proposal kind. Long-term: move keyword patterns into a single `issueTaxonomy.ts` table consumed by all three consumers.

---

## 11. Network types hand-written in `discovery.ts` despite ts-rs being the project convention

- **Severity**: Low
- **Category**: convention-drift
- **File**: `src/api/network/discovery.ts:7-102` and `src/api/network/bundle.ts:7-130`
- **Scenario**: `discovery.ts` defines `NetworkSnapshot`, `ConnectionHealth`, `MessagingMetrics`, etc. as hand-written TS interfaces with `snake_case` fields mixed with `camelCase` fields (`is_running` next to `avgLatencyMs` in the same file — both come from the Rust side). `enclave.ts` and `validation.ts` import from `@/lib/bindings/...` (ts-rs generated). When a Rust struct field changes, the developer has to remember which API module is generated and which is hand-written.
- **Root cause**: Generated bindings adopted incrementally; network types predate the convention.
- **Impact**: Field-name drift silently breaks network calls (Rust returns `connectedCount`, TS expects `connected_count`). No compile error because the Rust call returns `unknown`-shaped JSON that TS coerces to the hand-written interface. The case-style inconsistency within a single struct is jarring during code review.
- **Fix sketch**: Promote `NetworkStatusInfo`, `NetworkSnapshot`, `ConnectionHealth`, etc. to ts-rs derived bindings under `lib/bindings/`. Re-export from `discovery.ts` for compatibility. Once converted, normalize to either snake_case (matching the wire) or camelCase via a `serde(rename_all)` attribute on the Rust side.

---
