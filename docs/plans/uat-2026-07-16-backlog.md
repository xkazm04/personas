# UAT Backlog — composed from L1 (2026-07-16) + L2 (2026-07-16) runs

Sources: `uat/runs/2026-07-16-l1/{report.md,SUMMARY.md,findings.json}` + `uat/runs/2026-07-16-l2/{report.md,findings.json}`.
Legend: **[L2✓]** = empirically confirmed live · **[L1]** = code-confirmed, not yet live-exercised.

## A — Fixes (code defects; clear repro, clear fix shape)

### A1. Tool Runner error contract — the blocker cluster [L2✓] (test-a-tool)
One coherent work item, four parts:
- **Backend**: convert the three raw-throw sites in `invoke_tool_direct` (`src-tauri/src/engine/tool_runner.rs`) into typed `ToolInvocationResult` returns — rate-limit → `error_kind: rate_limited` (+`retryable: true`), credential failures → `error_kind: auth`, no-execution-strategy → `error_kind: misconfigured`. Side benefit: these failures then reach the `tool_execution_audit_log` insert they currently skip.
- **Backend**: `builtin://` tools — dispatch through the real builtin executor so they're actually hand-testable (preferred), or at minimum return an honest typed "builtin tools run inside executions only" instead of the false "misconfigured". Live evidence: gmail_read reported *misconfigured* on a persona whose real runs execute it fine.
- **Frontend**: `useToolRunner.ts:113-114` catch — route through the existing error taxonomy (`resolveError` / `isTauriError`) instead of `String(err)`; kills the literal `[object Object]` (captured live in DOM).
- **Testability**: add `data-testid`s to ToolRunnerPanel / ToolInvocationCard (card, run button, result box).

### A2. KPI "Evaluate due" silent error swallow [L2✓] (track-goal-kpi)
`KPIsPage.tsx:57-62` discards the per-KPI results map (`void n`). Live: accepted KPI + Evaluate due → nothing; the real error ("Derived KPIs need the project linked to a team") is invisible. Fix: surface a summary toast ("N measured, M failed: reason") and/or inline error chip on the KPI card. Bonus: surface the project→team precondition at proposal-accept time for derived KPIs.

### A3. Companion locale + error i18n + "Michal" hardcode [L1, partially probed live]
- Pass app locale into `build_system_prompt` (reply-language directive). Live probe showed Spanish works by model inference in direct chat — the directive protects the post-tool-result / edge cases.
- Route `CompanionPanel.tsx:1615-1621` sendError through `resolveErrorTranslated` instead of raw English `AppError` strings.
- Replace hardcoded "Michal" in `prompt.rs:614` goals header with the profile/user name or neutral phrasing (visible in live recall titles).

### A4. Unattended-mode gate for webhook/event_listener triggers [L2✓ via code+DB] (set-trigger-automate)
`GATED_TYPES` (`UnattendedModeSection.tsx:11`) excludes exactly the trigger types an alert/ticket JTBD uses; backend hold keys on scheduler-only `source_type`. Both live webhook triggers sit at `unattended_mode='auto'` with no UI to change it. Extend the gate UI + backend hold to webhook/event_listener fires.

### A5. Fleet live-slot cap eviction signal [L1] (monitor-fleet)
Eviction is safe (never kills Running/AwaitingInput; resumable) but silent — tile vanishes from the live grid with no toast (`stale.rs:594-618`, `FleetGridPage.tsx:386`). Emit a toast/banner naming the hibernated session + reason.

### A6. Quick a11y + polish batch [L1]
- `GuidedTour.tsx:461,464,284`: add `aria-label` to minimize/end-tour/completion-dismiss buttons (title-only today).
- `VaultTrustBadge.tsx:28-34`: refresh on interval/event instead of mount-only (stale amber risk while tab stays open).
- KPIsPage empty-toast artifact (two blank toasts on evaluate-due) — likely fixed by A2.

## B — Design gaps (need a UX/product decision before code)

### B1. `use_connector` auto-fires with no approval [L1] (companion-do-a-job)
The one op class touching real external accounts bypasses the approval-card system (`dispatcher.rs:185-188`). Decide: approval-gate by default with per-connector trust opt-out? Blanket approval hurts Athena's flow; silent writes hurt trust. **Decision needed.**

### B2. Goal ↔ KPI manual linking [L2✓] (track-goal-kpi)
Goal editor is Title/Description/Status only (live-confirmed); only the autonomous derivation engine writes `kpi_id`. Add a KPI picker to the goal editor + a "link to goal" action on KPI detail.

### B3. Monitor vocabulary + hint mismatch [L2✓ code-level] (synthesize-team)
Shipped labels are "Timeline"/"Grid"; docs + two Character files say "Console"/"Briefing"; the "Grid" hint ("Separate channels side by side") doesn't describe what renders (single-project messenger). Cheap fix: correct the hint text + sync uat overlay docs. Optional: rename "Grid" → something self-describing ("Conversations").

### B4. Manual-KPI visual honesty [L1] (track-goal-kpi)
"Manual entry" source badge is honest but easy to miss next to grounded measurements. Make manual-sourced KPIs visually distinct on dashboard cards (finance-analyst's sign-my-name bar).

### B5. Non-technical adoption handoff [L1] (adopt-template)
Companion suggestion widget drops a smallbiz first-timer into the readiness-%/connectors/triggers gallery. Bigger IA question — defer unless prioritized.

### B6. Adoption seeds triggers enabled-by-default [L1, uncertain] (adopt-template)
Verify live, then decide: seed schedules as `dry_run`/disabled for first run so nothing fires before the user reviews output?

## C — Feature opportunities (product-level)

- **C1. Persistent brand-voice profile** — per-user saved voice/style context injected into build + adoption prompts (today: per-session textarea only, nothing captures voice at adoption). Directly serves content-marketer/sales-rep/smallbiz segments. High value.
- **C2. In-product pricing/tier surface** [blocker for buyer segment] — Settings → Account pricing/plan section + gate-hit upsell CTA. Needs pricing-model input.
- **C3. Production-reachable governance** [blocker for admin segment] — Network/Admin tabs are `devOnly` (build-flag), invisible to paying tiers in prod. Decide which panels become tier-gated instead. Must verify on a prod build (dev harness masks it).
- **C4. Citation-tracking for companion research** — structured citation op + verification, beyond the prose "cite inline" instruction.
- **C5. Teams Monitor audit export** — CSV/JSON export + human-vs-agent actor typing (enterprise-admin's reviewer artifact).
- **C6. Fleet reachability framing** — Fleet ships default-enabled/untier-gated while docs call it dev-only/experimental; reconcile (gate it, or drop the "experimental" framing and cover it in onboarding).

## Recommended resolution order (this session)

1. **A1** Tool Runner cluster — 2 blockers + false-negative builtin, well-scoped, biggest trust win.
2. **A2** KPI evaluate-due feedback — small, sharp.
3. **A3** Companion locale/i18n/Michal — small-medium.
4. **A6 + A5** quick-wins batch (a11y labels, badge refresh, fleet toast).
5. **A4** webhook gate — medium.
6. **B2 / B3** if session budget remains.
B1, B5, B6, C* need user/product decisions — queue for discussion, not silent implementation.
