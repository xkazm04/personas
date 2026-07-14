# Dev Findings Loop — fusing Factory · Observability · Context Map into one actionable pipeline

> **Status:** design approved for Phases 1–2 (executor: Opus). Phase 3 is a sketch —
> it will be designed in a follow-up session (Fable) together with **Fleet**
> (`docs/features/fleet.md`) and **Studio** (`src/features/studio`) involvement.
>
> **Authored:** 2026-07-14 (Fable). Grounded against the code as of `master@936fb399f`.

---

## 1. Motivation

The app has grown three LLM-scan surfaces that each answer a different question
about a dev project, from three different locations:

| Surface | Location | Question | Sensor | Actuators today |
|---|---|---|---|---|
| **Factory / Passport Wall** (`src/features/teams/sub_factory/passport/`) | Projects → Factory | *Can agents develop this? Can I ship it?* | `dev_tools_generate_cross_project_metadata` → `AppPassport` (2 axes, ~17 dimensions) | Rich but private: `ImproveCell` ladders, `StandardsScan` → `findingFix.ts` "Fix with Claude", `improvePlan.ts` (impact-per-effort ranking, batch queue) |
| **Observability** (`src/features/plugins/dev-tools/sub_llm_overview/`) | Plugins → Dev Tools | *What does it actually do / cost / break at runtime?* | LLM pinpoints (LightTrack / Langfuse / LangSmith / Helicone; use-case rollups) + Sentry stats | **None** — read-only |
| **Context Ledger** (`src/features/plugins/dev-tools/sub_context/`) | Plugins → Dev Tools | *What is this codebase made of, business-wise?* | Claude CLI scan → contexts × use cases + coverage (files · goals · ideas · KPIs) | Per-context idea scan; use-case proposal accept/reject |

Meanwhile the app owns a full **detect → decide → act → ship** actuator chain that
only ONE sensor (the Idea Scanner) feeds today: `dev_ideas` → Tinder triage +
`TriageRule` auto-triage → `dev_tasks` → Task Runner → PR Bridge → Agent
Scoreboard, plus bound persona teams (`dev_projects.team_id`) and the (default-OFF)
goal-advancement tick.

**The design:** don't build a fourth dashboard. Build the *fusion layer*:

1. **Phase 1 — join the reads.** The three surfaces read each other's data through
   the join keys that already exist.
2. **Phase 2 — one findings spine.** Every sensor emits normalized *findings* into
   `dev_ideas` with provenance + evidence + dedup, so the existing triage/task/PR
   machinery becomes multi-sensor.
3. **Phase 3 (deferred) — close the loop.** Post-merge verification probes
   ("did the signal move?"), scoreboard credit for *reality moving*, and scheduled
   dispatch to bound teams / Fleet sessions / Studio chains.

### The join keys (all pre-existing — this is why the fusion is cheap)

- **`DevUseCase.slug`** — documented in the binding as "the join point between the
  codebase map and observed telemetry". Ledger columns ARE use cases; LLM pinpoints
  already join by `slugifyUseCase(name)` (see `matchUseCase` in
  `LlmOverviewPage.tsx`); KPIs are scoped to use cases.
- **`ContextItem.filePaths`** ↔ Sentry issue `culprit` — errors-per-context is a
  string-match away; nobody does it yet.
- **`DevUseCase.context_ids`** — use case ↔ context N:M, the bridge that carries
  runtime cost onto the code map.
- **Passport dimensions** `llmtracking` / `errors|logs|metrics|tracing` measure
  *whether the other two sensors are wired* — Factory is already the meta-layer.

### Design principles

- **No new module, no relocation.** Data flows; tabs stay. (One optional exception
  noted in §6.)
- **A finding IS an idea.** Reuse `dev_ideas` + triage + rules + tasks + scoreboard.
  Additive schema only, orphan-tolerant like `team_id`.
- **Deterministic emitters.** Phase-2 emitters are pure TS over data already
  fetched — no new LLM calls. LLM-powered anomaly detection can come later.
- **Noise budget.** Dedup keys, per-sweep caps, threshold config in one module,
  and a rejected finding never re-emits (human "no" is durable).

---

## 2. Phase 1 — Join the reads (no schema changes)

### 1A. Context Ledger gains runtime chips (LLM cost + Sentry errors per context)

**Files:** `sub_context/ContextLedger.tsx`, `sub_context/contextLedgerShared.tsx`
(`ContextCoverage`), `sub_context/ContextMapPage.tsx` (data plumbing), new
`sub_context/useContextRuntime.ts`.

**Data flow:**

1. New hook `useContextRuntime(projectId)`:
   - Reads the active project's `llm_tracking_credential_id`; if wired, fetches
     30d pinpoints via the existing `fetchLlmPinpoints` from
     `sub_llm_overview/llmTracingAdapters.ts` (import across sibling — both are
     dev-tools; if the import feels wrong, lift the adapter into
     `sub_llm_overview/index.ts` re-exports).
   - Builds `costByUseCaseSlug: Map<string, {calls: number; costUsd: number}>`
     from the pinpoint rollup (`slugifyUseCase(useCaseName)`).
   - Projects onto contexts through `DevUseCase.context_ids`:
     `runtimeByContext: Map<contextId, {calls, costUsd, useCaseCount}>`.
     **Attribution rule:** a use case's full cost is attributed to *each* context
     it slices (no splitting). The chip tooltip must say "cost of use cases
     slicing this context" — it is a *touch* metric, not an allocation, and
     columns will intentionally sum to more than the project total.
   - Sentry: if `monitoring_credential_id` + slug are set, fetch unresolved
     issues **with culprits** (see 1A-ii) and match `culprit` against each
     context's `filePaths` (normalize separators; match when a filePath is a
     suffix of the culprit or vice-versa; unmatched issues count to no context).
     → `errorsByContext: Map<contextId, number>`.
   - All fetches are lazy, errors → `silentCatch` + empty maps (the ledger must
     never break because telemetry is down).

2. **1A-ii — extend the Sentry adapter** (`sub_overview/adapters.ts`): new
   `fetchSentryUnresolvedIssues(credentialId, orgSlug, projectSlug, limit=25)`
   returning `{ id, shortId, title, culprit, count, lastSeen }[]` from
   `GET /api/0/projects/{org}/{proj}/issues/?query=is:unresolved&limit=25`.
   Keep `fetchSentryStats` untouched.

3. `ContextCoverage` (in `contextLedgerShared.tsx`) gains two optional chips:
   `costUsd` (render `~$X` via `Numeric`, hidden when undefined) and `errorCount`
   (red-tinted, hidden when 0/undefined). Follow the existing chip pattern
   (goals/ideas/KPIs); the error chip is a button → deep-links to the Overview
   tab's Sentry row (`setDevToolsTab('overview')` — same slice used elsewhere).

**Acceptance:** with a LightTrack-wired project, ledger rows show cost chips whose
per-use-case sums match the Observability Layer-2 table; unwired projects render
identically to today (zero new requests).

### 1B. Observability discovers structure (unmapped pinpoint → use-case proposal)

**Files:** `sub_llm_overview/LlmOverviewPage.tsx`, `src/api/devTools/useCases.ts`.

Rows where `useCaseName != null` but `matchUseCase(...) === null` currently render
plain text. Add a quiet `+` affordance (Tooltip: "Propose as use case") that calls
`createUseCase({ project_id, name: row.useCaseName, kind: 'capability',
context_ids: [], status: 'proposed' })`.

- Check `CreateUseCaseInput` — if it doesn't accept `status`, extend the input +
  Rust command to allow `'proposed'` (additive, default stays `'active'`).
- **Dedup:** disable the affordance when `slugifyUseCase(name)` already exists in
  ANY status for the project (the hook already loads active; also load proposed —
  `listUseCases(projectId)` unfiltered or a second call).
- On success: toast + the proposal appears in the Ledger's existing
  `ProposalStrip` where accept/reject already works. Runtime telemetry now
  *authors* the business map.

**Acceptance:** an unmapped pinpoint proposed here shows up in the Context Map
proposal strip; accepting it makes the pinpoint row's `Layers` link light up on
next reload.

### 1C. Passport reads live wiring + cost (small, display-only)

**Files:** `sub_factory/passport/passportRows.ts` (or the cell for
`llmtracking`), `usePassportData.ts`.

The `llmtracking` row currently reflects scan metadata. Enrich the cell sub-label
with live state: bound connector name (from `dev_projects.llm_tracking_credential_id`
joined to credentials — the raw project row is already in `ImproveRaw`) and, when
wired, a lazily-fetched `≈$X/30d` (module-level cache `Map<projectId, number>`;
fetch at most once per session per project; failures render nothing).
Do **not** block the wall render on telemetry — fill in when resolved.

**Acceptance:** wall renders instantly as today; wired projects' `llmtracking`
cells gain the connector + cost sub-label within a few seconds.

---

## 3. Phase 2 — The findings spine

### 2A. Schema (additive migration on `dev_ideas`)

```sql
ALTER TABLE dev_ideas ADD COLUMN origin TEXT;        -- NULL = classic scanner idea
ALTER TABLE dev_ideas ADD COLUMN use_case_id TEXT;   -- nullable, orphan-tolerant (no FK)
ALTER TABLE dev_ideas ADD COLUMN evidence TEXT;      -- JSON blob, sensor-specific
ALTER TABLE dev_ideas ADD COLUMN dedup_key TEXT;     -- idempotent emission key
CREATE INDEX idx_dev_ideas_dedup ON dev_ideas(project_id, dedup_key);
```

`origin` enum (validate in Rust, store as TEXT):
`standards_finding · passport_gap · llm_cost · sentry_spike · kpi_offtrack`.

Rust: extend the `DevIdea` model + `create_idea`/list commands (new fields
optional so existing call sites compile untouched). Regenerate ts-rs bindings
(`cargo test export_bindings`, commit `src/lib/bindings/`). **This is a
schema-touching, security-adjacent change — flag the PR for human review per
CLAUDE.md.**

### 2B. Emitters (pure TS, new module `sub_triage/findings/`)

Shared contract:

```ts
interface FindingDraft {
  origin: FindingOrigin;
  title: string;                 // imperative, ≤80 chars
  description: string;           // includes the "what to do" — this seeds the task prompt
  category: string;              // reuse existing idea categories where sensible
  contextId?: string;
  useCaseId?: string;
  evidence: Record<string, unknown>; // numbers/ids that justified emission
  dedupKey: string;              // stable per underlying signal
  effort?: number; impact?: number; risk?: number; // 1–5 seeds for triage
}
```

| Emitter | Source (already computed) | Emits when | `dedupKey` |
|---|---|---|---|
| `emitStandardsFindings` | `DevStandard` rows, `openFindings()` + `findingPrompt()` from `passport/improve/findingFix.ts` | status ≠ present | `standards:<rule_key>` |
| `emitPassportGaps` | `buildImprovePlan()` PlanItems (`passport/improve/improvePlan.ts`) | tier ≤ 2 (config/scan/connector — the LLM-actionable band) | `passport:<dimKey>` |
| `emitLlmCostFindings` | 7d + 30d pinpoints (already fetchable) | (a) use-case 7d cost > `LLM_COST_THRESHOLD_USD`; (b) unnamed-call share > 30% of calls → "instrument call sites with use-case names" | `llm:cost:<slug>` / `llm:unnamed` |
| `emitSentryFindings` | `fetchSentryUnresolvedIssues` (from 1A-ii) + context match | issue `count` > `SENTRY_COUNT_THRESHOLD`, top 3 per sweep | `sentry:<shortId>` |
| `emitKpiFindings` | the `attentionByProject` WarningItem computation (`sub_factory/ProjectsLayer.tsx:105` — **extract to a shared helper** so Factory and the sweep share it) | KPI off-track | `kpi:<kpiId>` |

All thresholds live in one module: `sub_triage/findings/findingConfig.ts`.

### 2C. Sweep orchestrator

`runFindingSweep(projectId)` in `sub_triage/findings/sweep.ts`:

1. Gather inputs (reuse existing fetchers; tolerate any sensor being absent).
2. Run all emitters → drafts.
3. Load existing ideas for the project; **drop drafts whose `dedupKey` matches any
   non-deleted idea** — including `rejected` ones (a human "no" is durable; only a
   deleted idea frees the key).
4. Cap: max `SWEEP_CAP` (default 10) new findings per sweep, highest
   `impact/effort` first; log dropped count to the toast ("12 findings, 10 queued").
5. `create_idea` per surviving draft with `status:'pending'` (or whatever the
   scanner uses for untriaged), then optionally invoke the existing
   `runTriageRules` so auto-triage applies immediately.

**Trigger surface (keep manual first):** a "Sweep findings" button on Idea Triage's
header + one on the Factory toolbar (fleet loop over projects). Auto-scheduling is
Phase 3.

### 2D. Triage UI upgrades

**Files:** `sub_triage/` (card + list), `TriageRulesPanel.tsx`.

- Origin badge on each idea card (colored per origin; `null` origin renders as
  today — zero visual change for classic ideas).
- Evidence popover: pretty-print the `evidence` JSON (a small definition list, not
  raw JSON) + deep-link per origin (standards → passport cell, llm_cost →
  Observability, sentry → Overview, kpi → KPI console).
- Filter/group by origin.
- `TriageRule`: add `origin` to the condition field enum (Rust + UI), enabling
  e.g. "auto-accept `passport_gap` where tier ≤ 1" or "auto-reject `llm_cost`
  under $5".

### 2E. i18n + docs (same-change requirements)

All new strings through `t.plugins.dev_tools.*` (or `t.project_overview.*` where
that section owns the surface) + full 13-locale translation via the
extract→subagents→merge pipeline (`check:i18n:strict` must stay green).
Update `docs/features/plugins/dev tools/dev-tools.md` (Context Map, Observability,
Idea Triage sections) and `docs/features/teams/…` for the Factory cell change in
the same PRs; onboarding tour Dev Tools step mentions findings once 2C lands.

---

## 4. Phase 3 — Close the loop (SKETCH ONLY — do not build yet)

Deferred to a dedicated design session (Fable) that must weigh **Fleet**
(`docs/features/fleet.md` — Claude Code session aggregation; the natural executor
for dispatched findings) and **Studio** (`src/features/studio` — chains; a
finding-verification chain op is plausible). Directional shape, recorded so
Phases 1–2 don't paint us into a corner:

- `dev_ideas.verify_state` (`pending / cleared / moved / unchanged`) + probe that
  re-runs the *emitting* sensor scoped by `dedupKey` after the linked task's PR
  merges. The `dedupKey` design in 2B is what makes this scoping possible — keep
  keys stable and self-describing.
- Scoreboard credit shifts from "idea shipped" to "signal moved".
- The goal-advancement tick (shipped, default-OFF) doubles as the sweep scheduler
  + dispatcher: top finding per project → bound team / Fleet session, under
  budget caps and the existing human-review resume loop.
- Open questions parked for that session: who executes (dev_tasks vs persona team
  vs Fleet CLI session)? does verification block scoreboard credit? Studio chain
  op vs Rust-side probe?

**Phase 1–2 pre-commitments to keep Phase 3 viable:** stable dedup keys; evidence
JSON always includes the raw numbers used for the threshold decision (so a probe
can re-measure comparably); emitters exported individually (probe re-runs one).

---

## 5. Execution plan for Opus (PR-sized, in order)

| # | Step | Files (primary) | Gate |
|---|---|---|---|
| 1 | Sentry issues adapter + `useContextRuntime` + ledger chips (1A) | `adapters.ts`, `useContextRuntime.ts`, `contextLedgerShared.tsx`, `ContextLedger.tsx`, `ContextMapPage.tsx` | tsc/eslint/vitest; live-verify chips vs Layer-2 table via :17320 |
| 2 | Unmapped-pinpoint proposal CTA (1B) | `LlmOverviewPage.tsx`, `useCases.ts` (+ Rust if `status` param missing) | live-verify proposal appears in ProposalStrip |
| 3 | Passport llmtracking live sub-label (1C) | `passportRows.ts` / cell, small cache module | wall render-time unchanged |
| 4 | `dev_ideas` migration + model + bindings (2A) | Rust migration, `models`, commands; `src/lib/bindings/` regen | `cargo test` + `export_bindings`; **flag for human review** |
| 5 | Emitters + config + sweep (2B, 2C) | `sub_triage/findings/*` (new), extract KPI-attention helper | vitest per emitter (pure functions — fixture-test thresholds + dedup) |
| 6 | Triage UI: origin badge, evidence popover, filter, rule condition (2D) | `sub_triage/*`, `TriageRulesPanel.tsx`, Rust `TriageRule` | live-verify sweep → badge → auto-rule fires |
| 7 | i18n sweep + doc sync (2E) | locales, docs | `check:i18n:strict` green |

Standing rules: worktree for multi-file steps, stage-only-your-files, atomic
commit per step, `npm run check` + tests before each commit, live verification
through the test-automation harness (`tauri:dev:test`, :17320) before claiming
anything works. Steps 1–3 are independent of 4–7 and can land while the migration
is in review.

## 6. Risks & open questions

- **Triage flooding** — mitigated by dedup + rejected-is-durable + sweep cap; if
  still noisy, add per-origin caps in `findingConfig.ts`.
- **Cost attribution confusion** (1A) — full attribution per sliced context
  double-counts by design; tooltip copy must carry the caveat. Revisit only if
  users misread it.
- **Culprit matching quality** — Sentry `culprit` is not always a file path;
  unmatched issues simply don't land on a context (they still emit project-level
  findings in 2B). Acceptable.
- **Fleet-wide cost fetches** (1C) — N projects × 1 request, lazy + cached; if
  vaults hold many wired projects, consider a batch command later.
- **Optional relocation** (explicitly deferred, needs product call): the
  Observability Layer-1 assignment matrix is fleet-wide *configuration* and would
  sit naturally in Factory next to the connector improve-actions; Layer 2 stays
  in Dev Tools. Not required by anything above.
