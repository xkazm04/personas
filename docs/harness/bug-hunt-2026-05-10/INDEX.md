# Bug-Hunter Scan — personas, 2026-05-10

> Elite-systems-failure-analyst scan over the full personas codebase (frontend `src/` + Rust `src-tauri/`).
> 25 parallel subagent runs, batched in waves of ≤8.
> Scope: full-stack across all 25 Vibeman contexts. Findings target: 8–15 per context.

---

## Totals

|                          | Critical | High | Medium |  Low | **Total** |
|--------------------------|---------:|-----:|-------:|-----:|----------:|
| Across 25 contexts       |       48 |  121 |    122 |   40 |   **331** |
| Share                    |     14.5%| 36.6%|  36.9%	| 12.1%|     100%  |

**Authoritative source: per-finding `**Severity**:` bullets** (counted across all 25 reports).
Per-context summary headers had ±6 drift on critical buckets in 13/25 reports — the **headers under-reported criticals by ~6 and over-reported mediums by ~10** across the run. Per-context totals (Σ) match in every file. The drift is a subagent self-tally bug in the report header line, not data corruption: each individual finding is correctly severity-tagged in its own block.

---

## Per-context breakdown

(Sorted by criticals desc, then by total. Counts are bullet-truth.)

| #  | Context                                              | Group                               |  C |  H |  M |  L | Total | Report |
|----|------------------------------------------------------|-------------------------------------|---:|---:|---:|---:|------:|--------|
|  1 | Execution Engine, Schedules & Deployment             | Pipelines, Recipes & Execution      |  4 |  7 |  3 |  1 |    15 | [→](./execution-engine-schedules-deployment.md) |
|  2 | External Integrations                                | Plugins                             |  4 |  5 |  4 |  1 |    14 | [→](./external-integrations.md) |
|  3 | Artist Plugin                                        | Plugins                             |  3 |  6 |  4 |  2 |    15 | [→](./artist-plugin.md) |
|  4 | Webhooks, Smee Relay & Dead Letter                   | Triggers & Events                   |  3 |  6 |  4 |  2 |    15 | [→](./webhooks-smee-relay-dead-letter.md) |
|  5 | Metrics, Alerts & Activity                           | Overview & Observability            |  3 |  5 |  4 |  2 |    14 | [→](./metrics-alerts-activity.md) |
|  6 | Dashboard & Analytics                                | Overview & Observability            |  2 |  4 |  5 |  3 |    14 | [→](./dashboard-analytics.md) |
|  7 | Persona Chat & Lab                                   | Personas Workspace                  |  2 |  5 |  5 |  2 |    14 | [→](./persona-chat-lab.md) |
|  8 | Settings & Account                                   | Settings, Sharing & Foundation      |  2 |  5 |  5 |  2 |    14 | [→](./settings-account.md) |
|  9 | Twin, Research-Lab & Dev-Tools                       | Plugins                             |  2 |  5 |  6 |  1 |    14 | [→](./twin-research-lab-dev-tools.md) |
| 10 | Connector Catalog                                    | Vault & Credentials                 |  2 |  4 |  5 |  2 |    13 | [→](./connector-catalog.md) |
| 11 | Credentials Management                               | Vault & Credentials                 |  2 |  4 |  6 |  1 |    13 | [→](./credentials-management.md) |
| 12 | Inbox & Messages                                     | Overview & Observability            |  2 |  6 |  4 |  1 |    13 | [→](./inbox-messages.md) |
| 13 | Onboarding Flow                                      | Templates, Onboarding & Home        |  2 |  4 |  4 |  3 |    13 | [→](./onboarding-flow.md) |
| 14 | Recipes & Composition                                | Pipelines, Recipes & Execution      |  2 |  4 |  6 |  1 |    13 | [→](./recipes-composition.md) |
| 15 | Persona Editor & Use Cases                           | Personas Workspace                  |  2 |  4 |  5 |  1 |    12 | [→](./persona-editor-use-cases.md) |
| 16 | Persona Health, Activity & Executions                | Personas Workspace                  |  2 |  5 |  4 |  1 |    12 | [→](./persona-health-activity-executions.md) |
| 17 | Pipeline Canvas                                      | Pipelines, Recipes & Execution      |  2 |  5 |  4 |  1 |    12 | [→](./pipeline-canvas.md) |
| 18 | Templates Catalog & Builder                          | Templates, Onboarding & Home        |  2 |  5 |  4 |  0 |    11 | [→](./templates-catalog-builder.md) |
| 19 | Persona Connectors, Tools & Model Config             | Personas Workspace                  |  1 |  4 |  5 |  4 |    14 | [→](./persona-connectors-tools-model-config.md) |
| 20 | Trigger Studio & Builder                             | Triggers & Events                   |  1 |  5 |  6 |  1 |    13 | [→](./trigger-studio-builder.md) |
| 21 | Companion Plugin                                     | Plugins                             |  1 |  4 |  5 |  2 |    12 | [→](./companion-plugin.md) |
| 22 | Home & Simple Mode                                   | Templates, Onboarding & Home        |  1 |  4 |  6 |  1 |    12 | [→](./home-simple-mode.md) |
| 23 | Sharing & Trusted Peers                              | Settings, Sharing & Foundation      |  1 |  6 |  4 |  1 |    12 | [→](./sharing-trusted-peers.md) |
| 24 | Databases & Dependencies                             | Vault & Credentials                 |  0 |  4 |  7 |  3 |    14 | [→](./databases-dependencies.md) |
| 25 | Shared UI Primitives & i18n                          | Settings, Sharing & Foundation      |  0 |  5 |  7 |  1 |    13 | [→](./shared-ui-primitives-i18n.md) |

---

## All 48 critical findings — one-line summary

Sorted into themes for triage. Each item links to its full entry in the per-context report.

### A. Privileged-IPC missing auth/authenticity gates (7 criticals)

This is the highest-leverage cluster: every finding here lets an unauthenticated/un-trusted caller (renderer iframe, prompt-injected persona tool, smee channel viewer, untrusted file on disk) drive a privileged backend action. **Most should be fixed first — they undermine every layer of authorization that the rest of the codebase relies on.**

1. **Credentials Mgmt — healthcheck_credential & _preview skip IPC auth** — every other credential command calls `require_privileged*`; these two don't, giving any pre-auth IPC caller the ability to decrypt secrets and trigger outbound HTTP. Plus a yes/no oracle via `_preview`. → [credentials-management.md#1](./credentials-management.md)
2. **Settings — `register_claude_desktop_mcp` ungated** — any renderer/IPC origin can rewrite Claude Desktop's global `mcpServers.personas` config to launch attacker code on every Claude Desktop start. → [settings-account.md#1](./settings-account.md)
3. **Settings — Frontend crash-log surface ungated** — `get_crash_logs`/`get_frontend_crashes` etc. expose React error-boundary stacks (which often contain BYOM API keys, passphrases) to any IPC caller, plus tampering via `clear_*`. → [settings-account.md#2](./settings-account.md)
4. **Artist — ffmpeg-spawning commands skip `require_auth`** — only `artist_export_composition` and `artist_cancel_export` are gated; `artist_extract_audio`, `artist_save_thumbnail`, `artist_trim_file`, `artist_measure_loudness`, etc. accept calls from anyone with IPC access. → [artist-plugin.md#2](./artist-plugin.md)
5. **Webhooks/Smee — zero authenticity check on inbound payloads** — anyone with the smee channel URL (plaintext in DB, copied to UI/clipboard) can `POST` arbitrary JSON and inject fully-trusted `github_*` events into the local persona event bus. → [webhooks-smee-relay-dead-letter.md#1](./webhooks-smee-relay-dead-letter.md)
6. **External — `langfuse_test_connection` SSRF + Basic-auth credential exfiltration** — accepts attacker-controlled `host`, sends victim's `public_key`/`secret_key` as Basic auth to it. No scheme/IP validation, no auth gate. → [external-integrations.md#2](./external-integrations.md)
7. **Sharing — `verify_document` re-reads file after computing hash** — TOCTOU lets a swapped file pass `file_hash_match && signature_valid` as `valid`. → [sharing-trusted-peers.md#1](./sharing-trusted-peers.md)

### B. Subprocess argv-injection / RCE primitives (4 criticals)

User-controlled strings reaching `Command::args` without sanitization. Each gives a code-execution primitive on the dev/user machine.

8. **Artist — ffmpeg arg-injection via untrusted output/input path strings** — paths beginning with `-` are parsed as flags; no `--` separator before user paths. → [artist-plugin.md#1](./artist-plugin.md)
9. **Artist — composition source paths injected raw into ffmpeg arg list** — `args.push(path.clone())` for every `SourceEntry::File`/`Proxy`. A `.mstudio.json` with `{"path": "-filter_complex", ...}` injects filter strings → `movie=`/`http:` exfil. → [artist-plugin.md#3](./artist-plugin.md)
10. **Twin/Dev-Tools — Static-scan command injection via user-controlled argv** — `StaticScanConfig.command: Vec<String>` is read verbatim from the project row (or frontend override) and passed as the executable + argv. An imported malicious project blob → arbitrary code execution. → [twin-research-lab-dev-tools.md#1](./twin-research-lab-dev-tools.md)
11. **Connector Catalog — CLI allowlist `path_matches_dir` has no path-boundary check** — `starts_with` matching allows `C:\Program Files Foobar\gh.exe` to be considered "inside `C:\Program Files`", defeating the documented PATH-hijacking mitigation. → [connector-catalog.md#1](./connector-catalog.md)

### C. Path-traversal / sandbox-escape / write-outside-vault (3 criticals)

12. **External — Drive pull writes attacker-controlled filename outside vault** — Google Drive `df.name` is unvalidated and joined into `local_path`. Shared file named `..\..\..\Users\<u>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\evil.lnk` → RCE on next login. → [external-integrations.md#1](./external-integrations.md)
13. **External — `obsidian_brain_read_vault_note` accepts absolute path bypassing sandbox** — sandbox check `!target.starts_with(vault_base) && !target.is_relative()` is OR not AND; absolute path satisfies the second arm and reads any file. → [external-integrations.md#3](./external-integrations.md)
14. **External — Obsidian push-sync writes are non-atomic; sync-state advances on partial corruption** — `std::fs::write` truncates first, then writes; OS reboot mid-write leaves zero-byte memory file but `last_sync_at` is bumped. → [external-integrations.md#4](./external-integrations.md)

### D. Execution-engine cancel/retry/tick reliability (4 criticals)

The runner/scheduler/healing core. Each finding causes either runaway resource use or "stuck forever" after cancel.

15. **Streaming `select!` has no cancellation arm** — kill flag only reaches the runner via stdout EOF, leaving cancels stuck behind 5+s OS pipe-close races. → [execution-engine-schedules-deployment.md#1](./execution-engine-schedules-deployment.md)
16. **Healing-retry sleep is uncancellable** — `spawn_delayed_retry` with 240s sleep stores no JoinHandle, no flag, no `tasks` map entry. Persona deletion can't reach it; it executes after the row is gone. → [execution-engine-schedules-deployment.md#2](./execution-engine-schedules-deployment.md)
17. **Subscription tick uses default `MissedTickBehavior::Burst` — overrun stampede** — one slow tick triggers a tick stampede that DoS's the DB. → [execution-engine-schedules-deployment.md#3](./execution-engine-schedules-deployment.md)
18. **`read_line_limited` 5-min watchdog returns `Ok(None)` indistinguishable from real EOF — runner waits forever** — 660s outer timeout is bypassed because driver.wait() never errors. → [execution-engine-schedules-deployment.md#4](./execution-engine-schedules-deployment.md)

### E. Idempotency / duplicate-create on CRUD & import flows (5 criticals)

Every one of these creates a *duplicate* domain entity (persona/recipe/template/node) on a double-click, network retry, or reload window.

19. **Templates — `confirm_n8n_persona_draft` idempotency guard is racy** — non-atomic read/write on `n8n_sessions.persona_id` lets parallel confirms create duplicate personas with full tools+triggers. → [templates-catalog-builder.md#1](./templates-catalog-builder.md)
20. **Templates — `instant_adopt_template` has no idempotency at all** — double-click → unbounded duplicate personas. → [templates-catalog-builder.md#2](./templates-catalog-builder.md)
21. **Trigger Studio — Studio import doesn't regenerate node IDs / remap edge endpoints** — duplicate IDs corrupt React Flow state on import; ghost edges. → [trigger-studio-builder.md#1](./trigger-studio-builder.md)
22. **Persona Editor — `delete_persona` race** — `force_cancel_all_for_persona` runs after the timeout but before `repo::delete`; in-flight executions can write rows orphaned by CASCADE delete or fail with FK violations after a 15s wait. → [persona-editor-use-cases.md#9](./persona-editor-use-cases.md)
23. **Recipes/Composition — composition workflow `nodes_json`/`edges_json` blobs with zero cycle/orphan validation on save** — frontend can post a cycle or dangling-edge graph; engine traverses it as truth. → [recipes-composition.md#13](./recipes-composition.md)

### F. Save-race / stale state in editing surfaces (5 criticals)

User clicks Back/team-switch/Enter while a debounced save / async send is pending. Each results in either lost work or wrong-target persistence.

24. **Pipeline Canvas — auto-layout debounced save loses team-id capture** — saveRef fires after team switch; persists team A's positions onto team B. → [pipeline-canvas.md#1](./pipeline-canvas.md)
25. **Pipeline Canvas — `handleBack` fires save without awaiting pending debounce** — last-write-wins inversion: stale value persists. → [pipeline-canvas.md#2](./pipeline-canvas.md)
26. **Persona Editor — `simulate_use_case` reads `design_context` twice** — capability toggle between the reads creates inconsistent simulation. → [persona-editor-use-cases.md#12](./persona-editor-use-cases.md)
27. **Chat & Lab — three lab modes share one lifecycle FSM** — concurrent matrix/ab/eval runs corrupt each other's `currentState` and 30-min watchdog. → [persona-chat-lab.md#1](./persona-chat-lab.md)
28. **Chat & Lab — stale persona guard missing for message-send path** — persona-switch mid-await on existing session appends old persona's user message into new persona's `chatMessages` array. → [persona-chat-lab.md#2](./persona-chat-lab.md)

### G. Async/concurrency in IPC & chat send (4 criticals)

29. **Companion — `companion_send_message` no per-session mutex** — double-Enter sends two turns concurrently into the same Claude CLI session, corrupting conversation state. → [companion-plugin.md#9](./companion-plugin.md)
30. **Persona Health — `clearExecutionOutput` fires-and-forgets `cancelExecution` then resets state in the same tick** — engine cancel races local cleanup; cancel-finally reads already-nulled IDs, breaking Resume and producing cancel calls with empty `executionPersonaId`. → [persona-health-activity-executions.md#1](./persona-health-activity-executions.md)
31. **Twin/Dev-Tools — Auto-scan loop trusts `scanPhase` polling** — drops finalization on missed events; warmup race makes "completed" event arrive before polling starts. → [twin-research-lab-dev-tools.md#2](./twin-research-lab-dev-tools.md)
32. **Metrics — Alert evaluator runs on every metrics fetch** — bypasses cooldown via toast/persist storm on rapid refresh. → [metrics-alerts-activity.md#1](./metrics-alerts-activity.md)

### H. Silent failure / success theater on observability/UX (10 criticals)

The system tells the user "all good" while masking real state.

33. **Dashboard — CronAgentsPage bigint division NaN** — Tauri serializes i64 as bigint; every healthy 1-execution agent renders red "failed". → [dashboard-analytics.md#1](./dashboard-analytics.md)
34. **Dashboard — PersonaHealth `recentExecs` collapses to 0 for free local-provider runs** — mis-classifies BYOM/Ollama personas as healthy/unknown. → [dashboard-analytics.md#2](./dashboard-analytics.md)
35. **Inbox — `snoozeStore.getSnapshot` returns stale cached reference whenever any other API path mutates storage** — snooze ghosts, cross-tab drift. → [inbox-messages.md#1](./inbox-messages.md)
36. **Inbox — Snoozed items never auto-leave the Snoozed lane** — `now` is captured at `partitionSwimlanes` call time; nothing rerenders when the deadline elapses. → [inbox-messages.md#2](./inbox-messages.md)
37. **Metrics — `clearAlertHistory` doesn't clear cooldowns** — UI shows "no alerts" while system silently suppresses real ones for up to 1h. → [metrics-alerts-activity.md#2](./metrics-alerts-activity.md)
38. **Metrics — Optimistic fired-alert insert + unbounded `pendingSyncAlertIds` retry loop** — backend down → thousands of concurrent IPC calls + memory leak. → [metrics-alerts-activity.md#3](./metrics-alerts-activity.md)
39. **Webhooks — webhook secret rendered into clipboard from React state with no scope check** — `handleCopy` writes deployment secret to OS clipboard with no confirm/auto-clear. → [webhooks-smee-relay-dead-letter.md#3](./webhooks-smee-relay-dead-letter.md)
40. **Webhooks — DLQ manual retry bypasses event-source rate limiter** — retry-storm DoS via the retry button. → [webhooks-smee-relay-dead-letter.md#2](./webhooks-smee-relay-dead-letter.md)
41. **Recipes — `derive_recipes_from_template` cascades stale `prompt_template` over user edits without confirmation** — silent overwrite; no version snapshot; no recovery. → [recipes-composition.md#9](./recipes-composition.md)
42. **Connectors/Tools — `fetchToolUsage` `.slice(0, 10)` on UTC ISO** — silently produces wrong cutoff in non-UTC TZ near midnight; drops or duplicates a full day for users east of UTC. → [persona-connectors-tools-model-config.md#14](./persona-connectors-tools-model-config.md)

### I. Persistence/recovery/cache gaps (4 criticals)

43. **Onboarding — Mid-flow dismiss state never persists** — closing app forgets where you were; "skip is reversible" promise broken. → [onboarding-flow.md#1](./onboarding-flow.md)
44. **Onboarding — `startOnboarding` aborts forever once user has any persona** — adoption mid-flow → never re-enter onboarding. → [onboarding-flow.md#2](./onboarding-flow.md)
45. **Persona Health — Recovered-execution verification on store creation isn't bounded** — hung backend pins `executionVerificationFailed = false` until network timeout (could be minutes). → [persona-health-activity-executions.md#2](./persona-health-activity-executions.md)
46. **Connector Catalog — `seed_builtin_connectors` uses `INSERT OR IGNORE`** — connector definitions never refresh after first install; v1.1's added `webhook_secret` field never reaches existing users. → [connector-catalog.md#2](./connector-catalog.md)

### J. Crypto / key downgrade & UI mode-stale (2 criticals)

47. **Credentials — Silent attacker-controlled-key downgrade via 32-byte short-circuit in `platform_unprotect` (Unix)** — attacker who can write to `master.key` (sync conflict, shared host) gets a permanent encryption-bypass primitive. → [credentials-management.md#2](./credentials-management.md)
48. **Home/Simple Mode — `simpleModeSlice.activeSimpleTab` accepts only specific strings but persistence delivers any old value after a build that adds/removes a tab** — `variantFor` switch has no `default` arm → renders `undefined`; Cockpit blank. → [home-simple-mode.md#10](./home-simple-mode.md)

---

## Triage themes (clustered by mental model)

| Theme | Approx count (C+H closest-related) | Why this is a wave, not just individual fixes |
|---|---:|---|
| A. Privileged-IPC auth gates | 7C + ~10H | All require the same pattern — grep `#[tauri::command]` and ensure `require_*` is called. One mental model, one PR template, fast. |
| B. Subprocess argv-injection / RCE | 4C + ~5H | All fix-shape: introduce strict allowlist + `--`-separator + arg sanitizer at command-spawn site. Reuse helpers across Artist + Twin + Connector. |
| C. Path-traversal / sandbox-escape | 3C + ~6H | All path-canonicalization + `starts_with(canonical)` check at FS-touch sites. Cross-cutting through External + Obsidian + Drive. |
| D. Execution-engine cancel/retry | 4C + ~10H | Tokio cancellation token + `MissedTickBehavior::Delay` + watchdog distinguishability. Single owner: `engine/runner.rs` + `scheduler.rs`. |
| E. Idempotency / duplicate-create | 5C + ~10H | Pattern: lift idempotency to a unique-key DB constraint OR an in-memory mutex per session_id/draft_id. Same shape across Templates + Recipes + Persona. |
| F. Save-race / stale state in editor | 5C + ~12H | Pattern: capture identity at debounce-arm time, await pending save in unmount/back, single-flight save promise. Pipeline Canvas + Persona Editor + Chat. |
| G. Async/concurrency in IPC + chat send | 4C + ~8H | Pattern: per-session mutex on IPC entry + canonical "current session id" snapshot. Companion + Persona Health + Twin. |
| H. Silent-failure observability | 10C + ~25H | Pattern: convert silent fall-throughs into explicit error-with-toast OR explicit "we don't know" state. Big surface but each is small. |
| I. Persistence/recovery gaps | 4C + ~8H | Pattern: persist via Zustand `persist` middleware OR add reset-on-start-fresh side effects. Onboarding + Connector Catalog + Persona Health. |
| J. Crypto / mode-stale | 2C + ~3H | Both small but high-leverage. Crypto fix is critical; mode-stale is one `default` arm. |
| K. Hygiene / cleanup-gaps (tracked in non-critical waves) | ~28 cleanup-gap M+L | Mostly listener/effect teardown, child-process kill_on_drop, RAII for locks. Bundle-able into a single hygiene wave once the critical work is done. |

---

## Suggested next-phase split (wave plan for fix sessions)

7 themed waves of criticals + adjacent highs. Each wave is **5–7 fixes**, single mental model — sized for one focused session per the skill's anti-pattern rules. Run waves in this order:

| Wave | Theme | Criticals | Sessions |
|------|-------|----------:|----------|
| **1** | **Privileged-IPC auth gates** (Theme A) — `require_*` + IPC sender-origin checks | 7 | Highest priority. Every other security finding stacks on this layer. |
| **2** | **Subprocess argv-injection + path-traversal** (B + C) | 4 + 3 = 7 | Second priority — RCE and write-outside-sandbox primitives. |
| **3** | **Execution-engine cancel/retry/tick** (D) | 4 + 2 adjacent (cleanup-gap H) = 6 | Reliability foundation. Once stable, the rest of the system can be debugged honestly. |
| **4** | **Idempotency on CRUD & import** (E) | 5 + 2 H = 7 | High-bug-density across Templates/Recipes/Persona; user-visible "duplicate everything" issues. |
| **5** | **Save-race / stale state in editing surfaces** (F) | 5 + 2 H = 7 | Visible to users every day; fixes compound across editors. |
| **6** | **Async/concurrency in IPC & chat + onboarding persistence** (G + I) | 4 + 2 from I = 6 | Mixes adjacent themes; both about "state survives the in-flight call". |
| **7** | **Silent-failure observability** (H) | Split across two sessions: 7a (alerts/snooze/dashboards) + 7b (timezone/recipes/clipboard) | 10 total, paced 5 per session |

After criticals: optional follow-up wave **W** for hygiene (cleanup-gap mediums + lows — RAII guards, kill_on_drop, listener teardown). Bundle-friendly; single PR.

Note: highs in each theme are listed in the per-context reports; pull them into the same wave as their theme leader for compounding fixes.

---

## Caveats — context-list drift

**13 of 25 contexts had stale file paths** in the Vibeman context definitions. The literal filenames listed in the contexts didn't exist anymore (renames since the contexts were last regenerated). Each affected subagent adapted to the closest-matching analogue and called this out in the report header. The findings remain valid — only the *file location* references in the original context were stale.

Affected contexts (from subagent reports): persona-health-activity-executions, persona-editor-use-cases, persona-chat-lab, databases-dependencies, dashboard-analytics, metrics-alerts-activity, inbox-messages, pipeline-canvas, onboarding-flow, home-simple-mode, sharing-trusted-peers, companion-plugin, templates-catalog-builder.

**Recommendation:** Before running a future scan, re-run the Vibeman context-regeneration pipeline so contexts point at current file names. This will not change the bug-density of findings but will reduce subagent overhead chasing renamed files.

---

## How this scan was run

| Field | Value |
|---|---|
| Scanner prompt | `bug-hunter` (`src/lib/prompts/registry/agents/bug-hunter.ts`) |
| Date | 2026-05-10 |
| Project | personas (`C:\Users\kazda\kiro\personas`) |
| Project ID (Vibeman) | `8e680c8c-5664-4c8e-a2e1-be08046d73b9` |
| Scope | All 25 contexts × full-stack (src/ + src-tauri/) |
| Parallelism | Max 8 subagents per dispatch wave |
| Dispatch waves | 4 (8 / 8 / 8 / 1) |
| Findings target per context | 8–15 |
| Per-context output | one Markdown file per context, written by isolated `general-purpose` subagent |
| Subagent files read | ~520 across the run (sum of per-subagent estimates) |
| Subagent retries | 1 (persona-health-activity-executions, watchdog stall on first run; succeeded on tighter retry) |
| TS baseline | 0 errors (clean) |
| Verification | Per-finding `**Severity**:` bullet count vs. per-report header `Total: ...` line. Per-context totals match in every file; severity-bucket drift in 13/25 reports (subagent header-summary tally bug, not data corruption). Bullet counts authoritative. |

Provenance artifacts in this directory:
- `_dispatch.json` — context list with file paths, used to seed each subagent
- `_contexts-raw.json` — raw `/api/contexts` response from Vibeman
- `_findings.json` — parsed individual findings (used to build this INDEX)
