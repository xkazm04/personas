# Backlog  (☐ todo · ◐ in progress · ☑ done · ✕ cut)  — numbering append-only, never renumber

| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 1 | ☑ | 3-Test | M | BUG: 8 failing vitest tests / 6 files — ALL test drift behind committed product changes, zero product bugs; suite 2003/2003 (524d11e91) |
| 2 | ☑ | 1-Build | S | Triaged: 186 cargo warnings = lite-feature-slice dead-code artifacts (ml-gated callers), not pty.rs drift; CI clippy bar (default features) unaffected — recorded, no code change |
| 3 | ☐ | 8-Ops | S | CLAUDE.md stale facts: lint-baseline note says ~10,086 warnings, actual 493 (migrations landed); refresh Pre-existing-Issues section |
| 4 | ☑ | 2-Func | L | Commit path WIRED end-to-end (874628340): signal sources via configure-&-commit modal hosting the real TriggerAddForm (lockedTriggerType); output_match via inline JSONPath+expected → backend jsonpath condition; 7 unit tests; tours 6/6 |
| 5 | ☐ | 2-Func | M | Worktree isolation: backend fully shipped + docs promise "opt in from settings", but NO settings UI exists (docs/features/execution/README.md:358 vs settings_keys.rs:475) — add the toggle |
| 6 | ☑ | 2-Func | S | Lab tour rewritten for the versions-table Lab; anchor lab-versions-panel added; step id/completeOn preserved (8782788c2) |
| 7 | ☑ | 2-Func | S | setTemplateTab branch added to GuidedTour ladder; setter + TemplateTab values verified end-to-end (8782788c2) |
| 8 | ☐ | 2-Func | M | Fleet in-session /resume still kills the session ("--session-id … --fork-session" error; fork-session fix tried + reverted 145f7c840; Wake fixed cd13ecc75) — real fix or hard-block the command with guidance (docs/features/fleet.md:242) |
| 9 | ☑ | 2-Func | M | All four consolidated with evidence: Patchbay/Transcript/Correspondence win; PresetStudio was already code-consolidated (fa5797ac7, 3214f31a5, 12d177a0f, 62a52def6) |
| 10 | ☑ | 2-Func | S | Folded into master via read-path derivation; _high stays separate; docs ×3 updated (99d93c445) |
| 11 | ☑ | 2-Func | S | Dev-flagged: mounts only when import.meta.env.DEV (6c176cf61) |
| 12 | ☑ | 2-Func | S | MOCK_PROJECTS deleted; load-bearing types moved to factoryModel.ts, 14 imports rewired (91ef56297) |
| 13 | ☑ | 3-Test | M | Migrations pinned: chain replays 3x clean (integrity+FK+CHECK-rebuild guard), newest artifacts asserted; .ok()-idempotency pattern now caught by tests (4deffa811) |
| 14 | ☑ | 3-Test | M | Credential injection pinned: 3 resolution tiers, reserved-name guard (drops name not credential), no-panic empty, decrypt-failure surfacing — 6 tests via real encryption path (5344cefc7) |
| 15 | ☑ | 3-Test | S | force_subscription_auth pinned: 3 tests incl. end-to-end poisoned-CliArgs spawn (30b695427) |
| 16 | ☐ | 3-Test | M | Execution IPC commands (15/16 files zero tests, executions.rs 968 LOC): status-transition guards + arg validation as pure-fn tests |
| 17 | ☑ | 3-Test | S | Field secrets-at-rest pinned; surfaced+pinned the REAL selective-encryption contract (secret-named force-encrypted, non-secret schema-less plaintext) (56c171ee2). SessionKeyPair transit decrypt already pinned in crypto.rs |
| 18 | ☐ | 3-Test | M | Zustand slices 44/53 untested: executionSlice (758 LOC) start→stream→terminal + buffer trim; then chat/persona/alert slices |
| 19 | ☑ | 3-Test | S | errorRegistry table-tested: 17 tests incl. rule ordering + breadcrumb dedupe (3e97655fb) |
| 20 | ☐ | 3-Test | S | fleet/pty.rs resume/wake pure-fn tests — DEFERRED: file is another session's hot area (3/4 recent fleet commits; foreign WT edit discarded mid-day); revisit when fleet work settles |
| 21 | ☑ | 3-Test | M | db/mod.rs boot path pinned: real init_db second-launch reopen preserves data + seeds (4deffa811). cdc.rs still untested (fold into future item if it matters) |
| 22 | ☑ | 6-Sec | M | Scoped to $APPDATA/$APPLOCALDATA/$DOCUMENT·Media-Studio/$PICTURE/$VIDEO/$AUDIO/$DOWNLOAD (d24cb45e1). Follow-up: spot-check icon+gallery render after next app restart |
| 23 | ☑ | 6-Sec | M | Bridge release exposure closed: PERSONAS_TEST_PORT gated to debug_assertions without the compile feature; release refuses + warns; harness flows unaffected; docs updated (88fb31d60, e6a0a42c9) |
| 24 | ☑ | 6-Sec | M | Server-side binding shipped (3aa9953de): status = metadata+ref only, backend redeems into vault, preview redeems non-consuming. REVIEW: 120s redeem-grace deviation (Workspace N-creds-per-consent) |
| 25 | ☑ | 6-Sec | S | freezePrototype enabled (desktop+android) + live-smoked: 6/6 tours drive the real UI with it on (516806c64) |
| 26 | ☐ | 6-Sec | S | [Low] Remove legacy plain-RSA IPC decrypt fallback on schedule (crypto.rs:129-49; rejected-by-default, counter-tracked, post-Q3) |
| 27 | ☑ | 7-UX | M | Global overlays wrapped in a group SilentErrorBoundary (f6c2478eb) — a crash degrades to "overlays gone" instead of unmounting the whole app. Follow-up: per-overlay isolation |
| 28 | ☐ | 7-UX | M | toastCatch path shows raw backend strings behind hardcoded-English "Failed to load data." prefix (silentCatch.ts:109; 263 sites vs 20 resolveErrorTranslated uses) — route through errorRegistry + i18n |
| 29 | ☐ | 7-UX | M | 46 files hand-roll fixed inset-0 modal backdrops; sampled 4/5 lack Esc/focus-trap — migrate worst offenders to BaseModal (EventRenameModal, MemoryDetailModal, BackfillModal, CreateApiKeyDialog first) |
| 30 | ☐ | 7-UX | S | Non-JSX English strings evade i18n lint: startup-failure banner (PersonasPage.tsx:145) + toastCatch prefix → i18n keys |
| 31 | ☐ | 7-UX | S | Lazy-section Suspense fallback = null → blank content pane on cold-cache nav to heavy sections; add skeleton (PersonasPage.tsx:55) |
| 32 | ☐ | 7-UX | S | All-Agents card layout renders every persona unvirtualized (data.map, no cap; table view paginates at 25) — virtualize or paginate (PersonaOverviewCardList.tsx:79) |
| 33 | ☐ | 7-UX | S | DesktopFooter icon-only buttons: 8/14 aria-labels — label the rest |
| 34 | ☑ | 8-Ops | M | Release unbricked: versions aligned to tag history (0.4.0), tag-collision guard fails fast, workflow_dispatch primary trigger (13e39bb98). VERIFY: first dispatched release run |
| 35 | ☑ | 8-Ops | M | Updater chain: createUpdaterArtifacts on, manifest hard-fails on missing bundle/sig, client surfaces check failures (13e39bb98). latest.json 404 self-resolves with the first release |
| 36 | ☐ | 8-Ops | L | DECISION: code-signing story — Win certificateThumbprint null (SmartScreen) + mac signingIdentity null (Gatekeeper) + updater-key custody, decide before/with the ADO migration |
| 37 | ☑ | 8-Ops | S | CI push:master trigger added (54f52d5d4) — ladder runs on the real flow. VERIFY: first push CI run goes green |
| 38 | ☑ | 8-Ops | M | Pre-migration snapshot + keep-3 rotation, non-fatal, restorability-tested (b3c79725b) |
| 39 | ☑ | 8-Ops | S | Changelog reconciled + [Unreleased]+Security entries; docs/development/release.md checklist written (50afb63bb) |
| 40 | ☑ | 8-Ops | S | ORT download SHA256-pinned, mismatch hard-fails (1e8cd1378). pnpm-lock NOT deleted — regenerated 2026-06-16, pnpm may be in local use; dual-lockfile question open (CP3) |
| 41 | ☑ | 4-UAT | S | Tours baseline: 6/6 exploration tours green (1.5m, fresh DB) after fixing completion-screen spec drift in tours-explore + getting-started (3688aa44a); e2e-target pre-warm pattern established (.personas-e2e-target) |
| 42 | ☐ | 4-UAT | M | UAT journeys via uat/ overlay: L1 sweep + top-3 L2 (execution run, vault credential binding, template adoption) |
| 43 | ☑ | 9-Value | M | value-case.md written: competitor map (thin 4-way intersection; existential=Anthropic first-party; OpenClaw+n8n; "cron my subscription" demand real), per-feature value×readiness (3 loud: exec/Fleet+Athena/Builder+vault; 3 hide-or-flag: Teams=demo/Twin/patchbay-TODOs), subscription economics 3-10× moat, 8-item reality checklist. Verdict: ship narrower beta. Dim 9 🔴→🟡. CP6 = 4 decisions |
| 44 | ☑ | 9-Value | M | Cold-start mapped: ~10-15min/7 decisions/2 CLI runs IF CLI installed+logged-in. 4 friction fixes sized: startup CLI/auth probe [S, highest-ROI], seed-templates-at-boot [S], zero-credential first-win [M], cost-number surfacing [M] — these ARE the last mile to Dim 9 🟢 (candidate M7) |
| 46 | ☑ | 9-Value | S | M7 Fix#1: foreground zero-credential quick-wins in the onboarding picker (pool of 12, stable-partition connectors_used==[] first, trim to 3) so a new user's first suggestion needs no vault setup (dd6c24ebd) |
| 47 | ☑ | 9-Value | M | M7 Fix#2: seed template catalog at app-init (shared idempotent seedCatalogTemplatesOnce() from App.tsx idle bootstrap + Templates hook) so the picker is non-empty on fresh boot without visiting Templates first (82e7a1451) |
| 48 | ☑ | 9-Value | M | M7 Fix#3: CliReadinessBanner + useCliReadiness — probe probe_cli_capabilities deferred off cold-start; surface a top-of-app gate when the Claude CLI is missing/signed-out BEFORE a run fails opaquely (40c222018). 3 chrome keys ×14 |
| 49 | ☑ | 9-Value | S | M7 Fix#4: make the subscription moat legible — CostBreakdownBar reframes the API-rate total as "included on your Claude subscription" for claude-* models only (isSubscriptionModel); reframe not 2nd computation → no double-count (35fa6be38). 1 agents key ×14 |
| 45 | ☐ | 3-Test | M | PRE-EXISTING: 18 Rust tests fail under --features desktop full-suite run (first such run in weeks; none of the files touched since Jul 1). Categories: settings_audit_log ×5 "no such table" (test-env: table missing from test DB init), prompt cli_args machine-dependent (expects cmd fallback, fails wherever real claude.exe exists), skills_sidecar $PERSONAS_PROXY_URL drift, connector_readiness, drive sandbox, sla ×3, dev_tools gates ×3, metrics, db_query, pipeline_executor. Triage each: env-shaped vs genuine drift. Full list in /tmp/m4-cargo-full.log |
