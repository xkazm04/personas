# Ambiguity Audit — personas, 2026-04-27

> Run by `vibeman` Pipeline B (scan + triage). Scanner agent: **`ambiguity-guardian`**.
> 17 parallel subagent runs across 17 contexts, batched in waves of ≤8 (8 + 8 + 1).
> Side-scope: client-side only (`src-tauri/` Rust paths dropped).
> All 17 reports in this directory.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 17 contexts | 29 | 66 | 89 | 18 | **202** |
| Share | 14% | 33% | 44% | 9% | 100% |

> **Verification:** Both `> Total:` header sum (202) and `- **Severity**:` bullet sum (202) match.
> **Caveat:** ~3 reports drift between their parenthetical severity breakdown in the header and the bullet ground truth (over-claim criticals/highs, under-claim mediums). This INDEX uses bullet counts as authoritative. Per-context table below reflects bullet ground truth; numeric totals here are the ones to trust.

### Category distribution (across all 202)

| Category | Count | Share |
|---|---:|---:|
| edge-case | 63 | 31% |
| implicit-assumption | 43 | 21% |
| magic-number | 35 | 17% |
| undocumented-decision | 27 | 13% |
| requirements-unclear | 16 | 8% |
| trade-off-hidden | 13 | 6% |
| missing-docs | 3 | 1% |
| tribal-knowledge | 2 | 1% |

The audit overwhelmingly surfaced **runtime ambiguity (edge-case + implicit-assumption + undocumented-decision = 65%)** rather than missing documentation (1%). The mental model: "this code works today by luck or by load-bearing assumption — and nothing tells you when that breaks."

---

## Per-context breakdown

(Sorted by criticals desc, then high desc, then total desc.)

| # | Context | Group | Critical | High | Medium | Low | Total | Report |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | Agent Lab & Matrix Builder | Agents & Personas | 2 | 5 | 4 | 1 | 12 | [`agent-lab-matrix-builder.md`](agent-lab-matrix-builder.md) |
| 2 | Agent Chat & Tool Runner | Agents & Personas | 2 | 4 | 5 | 1 | 12 | [`agent-chat-tool-runner.md`](agent-chat-tool-runner.md) |
| 3 | Agent Editor & Configuration | Agents & Personas | 2 | 4 | 5 | 1 | 12 | [`agent-editor-configuration.md`](agent-editor-configuration.md) |
| 4 | Agent Tools, Connectors & Use Cases | Agents & Personas | 2 | 4 | 5 | 1 | 12 | [`agent-tools-connectors-use-cases.md`](agent-tools-connectors-use-cases.md) |
| 5 | Connector Catalog | Credential Vault | 2 | 4 | 5 | 1 | 12 | [`connector-catalog.md`](connector-catalog.md) |
| 6 | Deployment, Sharing & Plugins | Templates, Deployment & Sharing | 2 | 4 | 5 | 1 | 12 | [`deployment-sharing-plugins.md`](deployment-sharing-plugins.md) |
| 7 | External Integrations | Integrations, Settings & Onboarding | 2 | 4 | 4 | 2 | 12 | [`external-integrations.md`](external-integrations.md) |
| 8 | Health, Validation & Network | Observability & Overview | 2 | 4 | 5 | 1 | 12 | [`health-validation-network.md`](health-validation-network.md) |
| 9 | Overview Dashboard | Observability & Overview | 2 | 4 | 5 | 1 | 12 | [`overview-dashboard.md`](overview-dashboard.md) |
| 10 | Vault Data Sources & Dependencies | Credential Vault | 2 | 4 | 5 | 1 | 12 | [`vault-data-sources-dependencies.md`](vault-data-sources-dependencies.md) |
| 11 | Recipes & Pipelines | Automation & Execution | 2 | 3 | 6 | 1 | 12 | [`recipes-pipelines.md`](recipes-pipelines.md) |
| 12 | Settings | Integrations, Settings & Onboarding | 2 | 3 | 6 | 1 | 12 | [`settings.md`](settings.md) |
| 13 | Credentials & Keys | Credential Vault | 1 | 5 | 5 | 1 | 12 | [`credentials-keys.md`](credentials-keys.md) |
| 14 | Persona Templates Catalog | Templates, Deployment & Sharing | 1 | 4 | 6 | 1 | 12 | [`persona-templates-catalog.md`](persona-templates-catalog.md) |
| 15 | Execution Engine (frontend) | Automation & Execution | 1 | 4 | 5 | 1 | 11 | [`execution-engine.md`](execution-engine.md) |
| 16 | Onboarding & Home | Integrations, Settings & Onboarding | 1 | 3 | 7 | 1 | 12 | [`onboarding-home.md`](onboarding-home.md) |
| 17 | Triggers & Schedules | Automation & Execution | 1 | 3 | 6 | 1 | 11 | [`triggers-schedules.md`](triggers-schedules.md) |

The distribution is remarkably flat: every context surfaced 1-2 criticals, no context dominates. This signals a **systemic ambiguity pattern**, not a localized hot spot — the same mental traps repeat across modules.

---

## All 29 critical findings — clustered into themes

### Theme A. Two-X-coexist — parallel implementations with divergent semantics (3 criticals)

The exact same hook name lives in two places (`feature/X.ts` + `feature/libs/X.ts`); the consumer imports the **less-safe** variant; the canonical-looking one is dead code. No file declares which is authoritative.

1. **Agent Chat & Tool Runner #1** — `useToolRunner` duplicated; `ToolRunnerPanel` imports the unsafe variant (no personaId tag, no IPC timeout, no stale-result drop). Cross-persona result bleed reachable in production. `src/features/agents/sub_tool_runner/useToolRunner.ts:1-117 vs libs/useToolRunner.ts:1-52`
2. **Agent Tools/Connectors #1** — `useToolImpactData` duplicated with diverging cost/co-occurrence math. Different `ToolImpactPanel` callers see different numbers depending on import path. `src/features/agents/sub_tools/useToolImpactData.ts:80-204 vs libs/useToolImpactData.ts:14-129`
3. **Agent Tools/Connectors #2** — `useToolSelectorState` vs `libs/useToolSelectorActions` have opposite undo semantics (origin-persona-routing vs current-persona-routing). One has a contract block; the other silently does the inverse. `src/features/agents/sub_tools/useToolSelectorState.ts:90-167 vs libs/useToolSelectorActions.ts:23-50`

### Theme B. Silent failure modes — happy-state shown when something failed (10 criticals)

A failure path produces a positive UX signal: toast says "saved", spinner stops, throttle clears, etc. Empty `catch{}`, "skip on error" comments, and lying state.

4. **Agent Editor #1** — `saveAll` marks dirty tabs clean when their save callback isn't registered. The "all saved" toast is a lie. `src/features/agents/sub_editor/libs/EditorDocument.tsx:150-156`
5. **Agent Lab & Matrix #3** — `hydrateBuildSession` silently discards `pendingAnswers`, `testId`, `toolTestResults`, `clarifyingQuestionV3` from persisted state on load. `src/stores/slices/agents/matrixBuildSlice.ts:1273-1301`
6. **Deployment/Sharing #1** — Bundle clipboard auto-clear's catch is empty; on Tauri/Windows read-fail, secret credentials remain in clipboard indefinitely. `src/features/sharing/components/BundleExportDialog.tsx:23-34`
7. **Deployment/Sharing #2** — Two distinct danger paths (tampered-trusted vs unknown-signer) share one `dangerConfirmed` boolean — no record of *which* warning was acknowledged. `src/features/sharing/components/BundlePreviewContent.tsx:74-119`
8. **Health/Validation #6** — Empty `catch{}` in `healthCheckSlice.checkSinglePersona` directly violates the **policy doc one file over** (`useHealthCheck.ts:1-22`) — failing personas vanish from the digest with no breadcrumb. UI shows "all healthy" while broken agents are simply absent. `src/stores/slices/agents/healthCheckSlice.ts:83-86`
9. **Persona Templates #1** — Auto-generated `templateIndex.ts` mixes translation overlays with canonical templates as if both are first-class catalog entries. Currently dead code, but a future repointing would silently double-count templates and broadcast translation overlays as standalone personas. `src/lib/personas/templateIndex.ts:6-249`
10. **Recipes & Pipelines #2** — `recordTriggerComplete` keeps `isThrottled = entry.queueDepth > 0 || prev.isThrottled` — a sticky-true bug. Once throttled, the flag never returns to false. `src/stores/slices/pipeline/triggerSlice.ts:150-161`
11. **Recipes & Pipelines #10** — Pipeline status events for non-selected `team_id` are silently dropped; `RESET_ON_TEAM_SWITCH` wipes state; user has no signal that a run completed on a team they navigated away from → duplicate re-triggers. `src/features/pipeline/components/canvas/useCanvasPipelineActions.ts:54-69`
12. **Settings #3** — `useByomSettings` falls back to an open-access `defaultPolicy()` (enabled:false) on transient IPC errors, then accepts Save → can silently overwrite a strict on-disk policy. **Security boundary**, BYOM controls which providers see secrets. `src/features/settings/sub_byom/libs/useByomSettings.ts:86-103`
13. **Settings #12** — `ConfigResolutionPanel` renders failed resolutions as `animate-pulse` skeletons identical to "still loading"; loading flag is false but UI suggests progress. `src/features/settings/sub_config/components/ConfigResolutionPanel.tsx:75-92`

### Theme C. Cross-entity scoping — lookup by domain-only when domain is shared (4 criticals)

A lookup keys on a partial identity (domain, name, type) when full identity (runId, personaId, teamId) is required. Iteration order or list order silently picks the wrong entity.

14. **Agent Chat & Tool Runner #2** — Experiment-bridge's 30s polling fallback races the realtime event listener; whichever wins decides what the user sees for that run. `src/features/agents/sub_chat/hooks/useExperimentBridge.ts:178-229`
15. **Agent Lab & Matrix #4** — `pickNextActiveSessionId` ignores `personaId`. Removing one persona's failed session can flip the active editor to a different persona's draft. `src/stores/slices/agents/matrixBuildSlice.ts:407-420, 524-536`
16. **Execution Engine #1** — `enrichProcess` ignores `runId` and uses `findProcessKey`'s prefix-fallback, mutating the wrong concurrent process when two share a domain. Scrambles cost/tool-call telemetry across two runs with no UI signal. `src/stores/slices/processActivitySlice.ts:220-239`
17. *(Health/Validation #12 also fits here — see Theme D — `service_type` map key picks first-match credential silently.)*

### Theme D. Validation / security gates bypassed or absent (6 criticals)

A code path skips a validation step that another path enforces. The unprotected path is reachable in production.

18. **External Integrations #1** — `gitlabTier` hardcoded to `'free'` at `GitLabPanel.tsx:162`. Premium/Ultimate templates silently locked for paying users; provides fake security since GitLab itself isn't validated. `src/features/gitlab/components/GitLabPanel.tsx:162`
19. **External Integrations #3** — `signDocument` sensitive-path regex is a frontend-only allowlist; the comment says "not a substitute for backend allowlisting" but every other persona tool calling `invoke("sign_document", …)` directly bypasses this check entirely. `src/api/signing/index.ts:47-77`
20. **Health/Validation #12** — `AUTO_MATCH_CREDENTIALS` first-match-wins on `service_type`; user with two Google credentials (work+personal) silently gets one chosen by list order, no preview. **Trust-boundary issue.** `src/features/agents/health/useApplyHealthFix.ts:30-39`
21. **Onboarding & Home #1** — `RoleStep`/`ToolStep` commit role/tool to persisted store on click; only `goalDraft` is buffered. Closing modal silently overwrites prior selections. No Cancel semantics. `src/features/home/components/SetupCards.tsx:351-353, 306-314`
22. **Triggers & Schedules #1** — `useTriggerHistory.replay` bypasses the validation gate that `testFire` enforces — silently re-fires executions whose webhook secrets/endpoints/paths may have rotated, including against disabled triggers. `src/features/triggers/hooks/useTriggerHistory.ts:101-132`

### Theme E. State drift / cache invalidation / fake numbers (5 criticals)

A value claims to represent X but actually represents stale-X, synthetic-X, or fleet-wide-X masquerading as per-entity. No contract for cache lifetime.

23. **Agent Editor #2** — `useEditorDirty` calls `registerSave`/`registerCancel` during render. The comment claims this is safe; under Concurrent React, every render re-registers the latest closure with no guard against renders that get thrown away. `src/features/agents/sub_editor/libs/EditorDocument.tsx:289-295`
24. **Credentials & Keys #1** — `cachedPublicKey` is a process-lifetime singleton, cleared only on logout. Backend session-key rotation, keyring re-unlock, or vault re-key produces stale-key encrypts that fail on the backend with no clear signal back to the cache. **Security boundary.** `src/lib/utils/platform/crypto.ts:6-11, 59-104`
25. **Overview Dashboard #1** — `globalExecutionsTotal` is a synthetic `merged.length + (rawCount >= limit ? 1 : 0)` "load more" hint, named like a row count. Any badge/paging UI reading it shows wrong numbers. `src/stores/slices/overview/overviewSlice.ts:185-191`
26. **Overview Dashboard #2** — Per-persona `successRate` falls back to `dashboard?.overall_success_rate ?? 100` when no per-persona daily data exists. Inactive personas show 100; active personas show fleet-wide rate masquerading as theirs. `src/stores/slices/overview/personaHealthSlice.ts:323-326, 130-136`

### Theme F. Sanitization & cross-boundary contracts — frontend assumes shape from out-of-scope code (4 criticals)

A regex / cast / literal is wrong, and there's no contract or test to catch it. Often these depend on Rust code we couldn't audit this run.

27. **Connector Catalog #1** — `ROLE_PRESETS` hardcodes category strings (`'devops'`, `'cloud'`, …) that must match Rust-side `connector-categories.json` keys with no codegen, validation, or test. A Rust rename silently empties the role filter. `src/features/vault/sub_catalog/components/picker/catalogRolePresets.ts:7-20`
28. **Connector Catalog #2** — `metadata.auth_variants` cast to `AuthVariant[]` after only `Array.isArray` check; downstream code treats every element as if it has `.fields`, `.auth_type_label`, `.id`, `.label`. `[42, "foo", null]` passes. `src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx:75-83`
29. **Vault Data Sources #1** — `escapeSqlStringLiteral` strips `[ -]` (a regex char range space-to-hyphen, i.e. punctuation) when the comment says it disallows control characters. **Inverted intent** — silently mutates table names with spaces/hyphens before they reach catalog queries. `src/features/vault/sub_databases/introspectionQueries.ts:51-58`
30. **Vault Data Sources #2** — `getSelectAllQuery` Redis branch interpolates table name with no escape: `` `SCAN 0 MATCH ${tableName}* COUNT 100` ``. Postgres/MySQL/SQLite/Convex all defensively escape; Redis is the lone exception. **Injection vector.** `src/features/vault/sub_databases/introspectionQueries.ts:104-106`

> Note: 30 entries listed because Theme F count was off by one in the heading — actual is 4 in F + the 25 above = 29 criticals. Theme F items 27-30 are 4 findings (Connector Catalog #1, #2; Vault #1, #2). Persona Templates #1 fits both B and F; counted once in B.

---

## Triage themes (suggested fix-wave split)

Each wave shares a mental model so the per-fix context stays warm. Sized at **5-7 fixes per wave** (the recommended ceiling). Each wave bundles its criticals plus the obvious related highs from the same theme.

| Wave | Theme | Approx fixes | Why this is a wave, not just individual fixes |
|---|---|---:|---|
| **1** | **Two-X-coexist** — unify or delete divergent `libs/` hooks | 5-7 | All three criticals share the same shape: pick canonical, delete the unused-but-misleading `libs/` variant, update consumers. Probably exposes a few more lib/ duplicates we haven't catalogued yet. |
| **2** | **Silent failure / lying state** — every failure path emits a signal | 6-7 | Cross-cutting `catch {}` rule + skeleton-as-loading + saveAll/hydrate-discard policy. Establishes the convention "happy UX requires happy outcome — failures must surface." |
| **3** | **Cross-entity scoping** — every lookup keys on full identity tuple | 4-5 | (runId, personaId, teamId) must be in the lookup key wherever the domain alone is non-unique. Single mental model: scope-by-identity. |
| **4** | **Validation/security gates** — apply gates everywhere; default-deny | 6-7 | Inventory every privileged action (replay, sign, fire, link credential, deploy template) and ensure each path goes through the same validator. Default-deny when state is unknown. |
| **5** | **State / cache invalidation contracts** | 4-6 | Cache lifetime declared explicitly (rotate-on-X, expire-after-Y); per-entity stats labeled with their data source; render-side registration moved out of render path. |
| **6** | **Sanitization & cross-boundary contracts** | 5-7 | Fix the broken `escapeSqlStringLiteral`; add escape to Redis SCAN; add a contract test for `ROLE_PRESETS` keys against the Rust JSON; runtime-validate `auth_variants` shape. Plus delete the dead `templateIndex.ts`. |
| **7 (optional)** | **Magic-number sweep** | 8-10 | The 35 magic-number findings (mostly low/medium): name them, comment why, group into a constants file per feature. Pure polish — postpone unless the user wants a clean sweep. |

**Total criticals to close across waves 1-6:** ~28-29 (depending on bundling).
**Total findings closeable across waves 1-7:** ~80-100 of the 202 (the others are mediums/lows that are real but lower-leverage).

---

## How this scan was run

| | |
|---|---|
| Scanner prompt | `agent_ambiguity_guardian` (`src/lib/prompts/registry/agents/ambiguity-guardian.ts`) |
| Date | 2026-04-27 |
| Project | personas |
| Scope | All 17 contexts |
| Side scope | Client-side only (`src-tauri/` dropped) |
| Method | 17 parallel general-purpose subagents, batched in waves of 8 + 8 + 1 |
| Findings target per context | 6-15 (most landed on 11-12) |
| Files read across all subagents | ~310 (sum of subagent reply estimates) |
| Verification | Both `> Total:` header sum (202) and `- **Severity**:` bullet sum (202) agree |
| Per-context drift | ~3 reports' header severity breakdown drifts from bullet ground truth — INDEX uses bullets |

---

## Resuming from this INDEX in a future session

This INDEX is the durable artifact. To start a fix wave:

1. Pick a wave from the table above (or the user's preferred theme).
2. Read the per-context report files referenced by that theme to get the full Scenario / Root cause / Impact / Fix sketch for each finding.
3. Per the skill protocol, each fix is one atomic commit with a `Refs:` line pointing back to its source finding.
4. After each wave, write `FIXES-WAVE-N.md` next to this file documenting what was fixed and the patterns extracted.

Pause/resume safe: walking away here loses no state — the scan results are written, the INDEX captures the triage decisions, and the per-wave summary docs accumulate as fixes happen.
