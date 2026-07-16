# UAT L2 Report — 2026-07-16 (empirical, live app via :17320)

**Mode:** targeted L2 against the live app + real Claude Code CLI engine calls, driven by the L1 handoff list (`uat/runs/2026-07-16-l1/`). Serial, single instance. Real model calls: 2 persona executions + 1 companion turn (all via the CLI engine, subscription auth).

**Session note:** the app instance was accidentally closed mid-run by a fuzzy selector (`[aria-label*="lose"]` matched `titlebar-close`) and restarted via `npm run tauri:dev:test`. Ironically, the companion later correctly reported the executions killed by earlier restarts — see Grounding below.

## L1 verdicts — confirmed / refuted / new

### CONFIRMED live (empirical evidence)

| L1 finding | L2 evidence | Verdict |
|---|---|---|
| **F-BLOCK-2** Tool Runner renders `[object Object]` | Drove Intel Analyst Prime → Design tab → `open-tool-runner` → expanded `airtable_create_record` → Run. DOM query returned `pre.typo-code` with text **exactly `[object Object]`**, visible. | **confirmed** |
| **F-BLOCK-1/2 root cause** raw AppError rejection | Bridge `invokeCommand invoke_tool_direct` on `notion_query_database` (no impl guide): command **rejected with plain-object AppError JSON** (`{"error":"Execution error: Tool ... has no execution strategy...","kind":"execution"}`), not a typed `ToolInvocationResult`. | **confirmed** |
| **F-MAJOR-15** no goal↔KPI link UI | Opened the live Goal editor: fields are exactly **Title, Description, Status** (+ priority chips). No KPI affordance anywhere in the dialog. | **confirmed** |
| **F-MAJOR-11** webhook triggers ungated | DB: both `webhook` triggers carry `unattended_mode='auto'`; no UI renders the gate for them (code: `GATED_TYPES` excludes webhook/event_listener). UI walk skipped — code+DB conclusive. | **confirmed** |
| **F-MAJOR-12** Monitor labels Console/Briefing vs Timeline/Grid | i18n keys are definitive (`channels_layout_timeline: "Timeline"`, `channels_layout_grid: "Grid"` in en.json). Live walk blocked by zero-team fixture (Channels mode correctly shows "No teams with a channel yet"). | **confirmed (code)**, live walk fixture-gapped |

### NEW L2-only findings (L1 surface-model gaps)

1. **[blocker-class] Builtin tools are unrunnable in the Tool Runner — and mislabeled "misconfigured".**
   `invoke_tool_direct builtin-gmail-read` returned a *typed* failure: `error_kind: "misconfigured"`, message "script_path must be a script file (ts, tsx, …) — got: builtin://gmail_read". The Tool Runner treats `builtin://` script_paths as script tools and rejects them. Template-adopted personas' tools are predominantly builtins (gmail_read, gmail_search, file_read, file_write) — a user hand-testing their persona's tools concludes the persona is broken when the real execution path runs those tools fine. Trust-destroying **false negative**, worse than an opaque error.
   Evidence: bridge result captured; `persona_tool_definitions` rows `builtin-*`; `tool_runner.rs` script-extension validator.
   Nuance vs L1: script-path validation IS inside the typed path — the raw-throw class is specifically {rate-limiter, credential-resolution, no-execution-strategy}.

2. **[major] "Evaluate due" KPI evaluation swallows per-KPI errors entirely.**
   Accepted the "Execution Failure Rate" proposal (proposed→active worked cleanly), clicked Evaluate due → **nothing**: no measurement, no error, no toast content (two *empty* toasts appeared). Direct command invocation revealed the real result the UI discarded: `{"Execution Failure Rate": "error: Validation error: Derived KPIs need the project linked to a team"}`. `KPIsPage.handleEvaluateDue` explicitly ignores the results map (`const n = Object.keys(results).length; void n;` — `KPIsPage.tsx:57-62`). The user cannot learn why their KPI never measures.
   Also upstream: the acceptance flow never surfaced the "project must be linked to a team" precondition — a derived KPI can be accepted into a state where it can never measure.

3. **[minor, testability] The companion orb cannot be opened by test `click()`** — it listens to pointer events only; synthetic PointerEvent/keydown dispatch also failed. The bridge's `openCompanion` method is the only deterministic path (works). Tool Runner components have **zero data-testids** (cards, run button, result display) — driven by fragile CSS class selectors this run.

4. **[minor, harness] `/execute-persona` silently ignores unknown body fields** — sending `input` instead of `input_data` yielded a run with null input and no warning (persona fell back to its standing mandate). Cost one full 179s model call to discover.

### STRENGTHS confirmed live

- **Execution engine (the L1-pass journey) holds at L2.** Grounded run on Intel Analyst Prime: terminal `completed` in 55s, `model_used: claude-sonnet-4-6` (served id — failover fix live), output directly addresses the supplied topic (Tauri 2: versions, dates, 3 real source URLs, under word budget). Second (ungrounded) run also reached terminal `completed` (179s). **No stuck-Running observed across 2 runs + the restart-killed runs from earlier sessions were all properly terminal.**
- **Companion grounding is exceptional.** Spanish question "¿Cuáles de mis agentes fallaron recientemente?" → full natural-Spanish reply (quick-replies too) naming **5 real failed executions** with dates, correctly attributing the cause ("la app se reinició durante la ejecución" — true), 24h stats (16 completed/0 failed — matches DB), and 2 real open healing incidents on "Email Morning Digest". Honest triage a senior SRE would accept. Partially refutes F-MAJOR-9's practical severity for direct chat: model inference handles locale fine in the direct-conversation case. The structural gap (no locale directive; risk after English tool-results; hardcoded "Michal" visible in recall titles) stands.
- **Vault trust surfaces render live**: collapsed green "Vault is secure" (testid `vault-trust-badge`) → expanded "AES-256-GCM encryption" + "Credentials never leave this device". Health taxonomy: **7 "Unverifiable" + 2 "Failing" badges** with explicit text labels (not just colored dots). Note: 0 "Verified" credentials in this profile — the green path remains live-unverified.
- **KPI proposal→accept flow works cleanly** (status flip + dashboard render immediate).
- **Honest empty states everywhere encountered** ("No teams with a channel yet", "No active KPIs yet", "No goals here").

### Untestable this run (fixture/environment gaps)

- Timeline/Grid live navigation walk + Teams Monitor audit credibility (zero teams; creating one = AI synthesis call, deferred).
- Onboarding footer Resume/Replay icon (bridge getState doesn't expose onboarding slice; profile has 100+ personas so cold-start surfaces don't render — needs a fresh profile).
- **F-BLOCK-3 (Network/Admin dev-flag gate)**: *structurally invisible to this L2* — `tauri:dev:test` runs with `import.meta.env.DEV = true`, so the tabs render here. Only a production build verifies this. Flagged as needing a prod-build check, exactly as L1 predicted.
- F-BLOCK-4 (pricing absent): trivially true in dev too; no in-app pricing surface found in Settings → Account during probes.
- Rate-limit blocker (F-BLOCK-1): not triggered live (would need ≥N rapid runs; root cause already proven via the shared raw-throw path).

## Scorecard update

| Journey | L1 | L2 outcome |
|---|---|---|
| run-and-review-execution | L1-pass | **L2-pass** (terminal status, served model, grounded quality — all live) |
| test-a-tool | L1-conditional | **L2-fail** (blockers confirmed + new builtin-tools blocker) |
| track-goal-kpi | L1-conditional | **L2-conditional** (accept flow works; evaluate-due silent-swallow major; no-link-UI confirmed) |
| wire-credential-connector | L1-conditional | **L2-pass** (trust surfaces + taxonomy live; Verified-green path still unexercised) |
| companion-do-a-job | L1-conditional | **L2-pass with caveats** (grounding outstanding; locale works in direct chat; structural locale gap + error-string i18n untested) |
| set-trigger-automate | L1-conditional | webhook-gate absence **confirmed** (code+DB) |
| synthesize-team | L1-conditional | fixture-gapped (labels confirmed at code level) |
| monitor-fleet, first-run-onboarding, adopt-template, build-persona-from-intent, trust-and-governance | L1-conditional | not exercised this run (queued for a future L2 pass / prod-build check) |
