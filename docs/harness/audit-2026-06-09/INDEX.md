# Layered Audit — personas-desktop, 2026-06-09

> Bug Hunter (🐛 reliability/failure analysis) + UI Perfectionist (🎨 visual/component/a11y) run across **all 30 contexts**, **full-stack** (`src/` TS/React + `src-tauri/` Rust).
> 60 parallel subagent runs, batched in waves of 8. Findings target: focused (3–6/context).
> Counts verified two ways (sum of `> Total:` headers = count of `- **Severity**:` bullets = **354**).

---

## Totals

| Scanner | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| 🐛 Bug Hunter (30 ctx) | 41 | 88 | 45 | 1 | **175** |
| 🎨 UI Perfectionist (30 ctx) | 19 | 81 | 61 | 18 | **179** |
| **Combined** | **60** | **169** | **106** | **19** | **354** |
| Share | 17% | 48% | 30% | 5% | 100% |

TypeScript baseline at scan time: **0 errors** (clean).

---

## Per-context breakdown — 🐛 Bug Hunter (sorted by criticals desc, then total)

| Context | Group | C | H | M | L | Total | Report |
|---|---|---:|---:|---:|---:|---:|---|
| persona-use-cases-parameters | Persona Studio | 2 | 3 | 1 | 0 | 6 | `bug__persona-use-cases-parameters.md` |
| persona-authoring-editor | Persona Studio | 2 | 3 | 1 | 0 | 6 | `bug__persona-authoring-editor.md` |
| execution-engine-runs | Execution & Orch. | 2 | 3 | 1 | 0 | 6 | `bug__execution-engine-runs.md` |
| evolution-genome-self-healing | Agent Lab & Quality | 2 | 3 | 1 | 0 | 6 | `bug__evolution-genome-self-healing.md` |
| test-suites-assertions | Agent Lab & Quality | 2 | 3 | 1 | 0 | 6 | `bug__test-suites-assertions.md` |
| lab-experiments-arena | Agent Lab & Quality | 2 | 3 | 1 | 0 | 6 | `bug__lab-experiments-arena.md` |
| agent-memories-knowledge | Observability | 2 | 3 | 1 | 0 | 6 | `bug__agent-memories-knowledge.md` |
| events-messages-notifications | Observability | 2 | 3 | 1 | 0 | 6 | `bug__events-messages-notifications.md` |
| composition-workflows-pipeline | Teams & Collab. | 2 | 3 | 1 | 0 | 6 | `bug__composition-workflows-pipeline.md` |
| teams-and-assignments | Teams & Collab. | 2 | 3 | 1 | 0 | 6 | `bug__teams-and-assignments.md` |
| research-lab | Companion & Plugins | 2 | 3 | 1 | 0 | 6 | `bug__research-lab.md` |
| dev-ideas-scanner-context-map | Dev Console & Fleet | 2 | 3 | 1 | 0 | 6 | `bug__dev-ideas-scanner-context-map.md` |
| fleet-terminal-orchestration | Dev Console & Fleet | 2 | 3 | 1 | 0 | 6 | `bug__fleet-terminal-orchestration.md` |
| deployment-and-signing | Platform & Settings | 2 | 2 | 1 | 0 | 5 | `bug__deployment-and-signing.md` |
| templates-and-build-sessions | Persona Studio | 1 | 3 | 2 | 0 | 6 | `bug__templates-and-build-sessions.md` |
| persona-chat-conversations | Persona Studio | 1 | 3 | 2 | 0 | 6 | `bug__persona-chat-conversations.md` |
| recipes-automation-library | Execution & Orch. | 1 | 3 | 2 | 0 | 6 | `bug__recipes-automation-library.md` |
| triggers-and-event-automations | Execution & Orch. | 1 | 3 | 2 | 0 | 6 | `bug__triggers-and-event-automations.md` |
| mcp-tools-gateways-knowledge-base | Connections & Cred. | 1 | 3 | 2 | 0 | 6 | `bug__mcp-tools-gateways-knowledge-base.md` |
| credential-vault-connectors | Connections & Cred. | 1 | 2 | 2 | 0 | 5 | `bug__credential-vault-connectors.md` |
| reviews-incidents-audit | Observability | 1 | 3 | 2 | 0 | 6 | `bug__reviews-incidents-audit.md` |
| cloud-sync | Network & Sync | 1 | 3 | 2 | 0 | 6 | `bug__cloud-sync.md` |
| p2p-network-device-sync | Network & Sync | 1 | 4 | 1 | 0 | 6 | `bug__p2p-network-device-sync.md` |
| creative-productivity-plugins | Companion & Plugins | 1 | 3 | 0 | 1 | 5 | `bug__creative-productivity-plugins.md` |
| personal-twin | Companion & Plugins | 1 | 3 | 2 | 0 | 6 | `bug__personal-twin.md` |
| companion-athena | Companion & Plugins | 1 | 3 | 2 | 0 | 6 | `bug__companion-athena.md` |
| onboarding-home-welcome | Platform & Settings | 1 | 3 | 2 | 0 | 6 | `bug__onboarding-home-welcome.md` |
| overview-dashboard-metrics | Observability | 0 | 4 | 2 | 0 | 6 | `bug__overview-dashboard-metrics.md` |
| credential-recipes-oauth-rotation | Connections & Cred. | 0 | 2 | 3 | 0 | 5 | `bug__credential-recipes-oauth-rotation.md` |
| settings-api-keys-byom | Platform & Settings | 0 | 2 | 3 | 0 | 5 | `bug__settings-api-keys-byom.md` |

## Per-context breakdown — 🎨 UI Perfectionist (sorted by criticals desc, then total)

| Context | C | H | M | L | Total | Report |
|---|---:|---:|---:|---:|---:|---|
| persona-authoring-editor | 1 | 2 | 2 | 1 | 6 | `ui__persona-authoring-editor.md` |
| execution-engine-runs | 1 | 2 | 2 | 1 | 6 | `ui__execution-engine-runs.md` |
| mcp-tools-gateways-knowledge-base | 1 | 3 | 2 | 0 | 6 | `ui__mcp-tools-gateways-knowledge-base.md` |
| credential-vault-connectors | 1 | 3 | 2 | 0 | 6 | `ui__credential-vault-connectors.md` |
| agent-memories-knowledge | 1 | 3 | 1 | 1 | 6 | `ui__agent-memories-knowledge.md` |
| reviews-incidents-audit | 1 | 3 | 2 | 0 | 6 | `ui__reviews-incidents-audit.md` |
| overview-dashboard-metrics | 1 | 2 | 2 | 1 | 6 | `ui__overview-dashboard-metrics.md` |
| composition-workflows-pipeline | 1 | 2 | 2 | 1 | 6 | `ui__composition-workflows-pipeline.md` |
| teams-and-assignments | 1 | 3 | 2 | 0 | 6 | `ui__teams-and-assignments.md` |
| cloud-sync | 1 | 2 | 2 | 1 | 6 | `ui__cloud-sync.md` |
| creative-productivity-plugins | 1 | 2 | 2 | 1 | 6 | `ui__creative-productivity-plugins.md` |
| research-lab | 1 | 3 | 2 | 0 | 6 | `ui__research-lab.md` |
| personal-twin | 1 | 3 | 2 | 0 | 6 | `ui__personal-twin.md` |
| companion-athena | 1 | 3 | 1 | 1 | 6 | `ui__companion-athena.md` |
| dev-ideas-scanner-context-map | 1 | 3 | 2 | 0 | 6 | `ui__dev-ideas-scanner-context-map.md` |
| deployment-and-signing | 1 | 3 | 2 | 0 | 6 | `ui__deployment-and-signing.md` |
| onboarding-home-welcome | 1 | 2 | 2 | 1 | 6 | `ui__onboarding-home-welcome.md` |
| settings-api-keys-byom | 1 | 3 | 2 | 0 | 6 | `ui__settings-api-keys-byom.md` |
| templates-and-build-sessions | 1 | 3 | 2 | 0 | 6 | `ui__templates-and-build-sessions.md` |
| persona-use-cases-parameters | 0 | 3 | 2 | 1 | 6 | `ui__persona-use-cases-parameters.md` |
| persona-chat-conversations | 0 | 3 | 2 | 1 | 6 | `ui__persona-chat-conversations.md` |
| recipes-automation-library | 0 | 3 | 3 | 0 | 6 | `ui__recipes-automation-library.md` |
| triggers-and-event-automations | 0 | 3 | 2 | 1 | 6 | `ui__triggers-and-event-automations.md` |
| test-suites-assertions | 0 | 3 | 2 | 1 | 6 | `ui__test-suites-assertions.md` |
| lab-experiments-arena | 0 | 3 | 2 | 1 | 6 | `ui__lab-experiments-arena.md` |
| credential-recipes-oauth-rotation | 0 | 2 | 3 | 1 | 6 | `ui__credential-recipes-oauth-rotation.md` |
| events-messages-notifications | 0 | 3 | 2 | 1 | 6 | `ui__events-messages-notifications.md` |
| fleet-terminal-orchestration | 0 | 3 | 2 | 1 | 6 | `ui__fleet-terminal-orchestration.md` |
| p2p-network-device-sync | 0 | 3 | 3 | 0 | 6 | `ui__p2p-network-device-sync.md` |
| evolution-genome-self-healing | 0 | 2 | 2 | 1 | 5 | `ui__evolution-genome-self-healing.md` |

---

## All 60 critical findings — themed for triage

### 🐛 Reliability criticals (41)

**T1 — Lost-update writes: concurrent/background writes silently clobber newer data (8)**
1. **persona-use-cases #1** — backend `design_context` cascade bypasses the frontend `writeQueue`; a concurrent edit silently reverts capability toggles ("paused" capability keeps running). `commands/core/use_cases.rs:36,140`
2. **recipes #1** — versioning "Accept" applies a stale LLM draft with an unconditional UPDATE (no CAS on `updated_at`); edits during the 30–300s gen window are destroyed silently. `db/repos/resources/recipes.rs:474`
3. **templates #1** — dry-run `simulate_build_draft` allows phase `Promoted` and overwrites a live persona's real `design_context` with the simulation snapshot. `commands/design/build_simulate.rs:181`
4. **evolution #2** — concurrent evolution cycles have no per-persona lock; bare lost-update `promote_variant` clobbers cycles and live user edits. `engine/evolution.rs:129`
5. **agent-memories #2** — knowledge `upsert` read-modify-write of `recentResults` races concurrent runs → lost outcomes + wrong running averages. `db/repos/execution/knowledge.rs:49`
6. **creative #1** — Obsidian push-sync overwrites the user's directly-edited vault notes with no three-way conflict check (pull has one, push doesn't). `commands/obsidian_brain/mod.rs:513`
7. **persona-use-cases #2** — event-rename does substring `REPLACE` on serialized trigger config JSON → corrupts unrelated fields / partial names. `commands/core/use_cases.rs:518`
8. **persona-authoring #1** — Ctrl+Z reverts the in-memory draft but never re-persists; DB keeps the post-save value while UI says "All saved". `sub_editor/libs/useEditorSave.ts:60`

**T2 — Unguarded status transitions & locks: double-apply, lost transition, slot leak (7)**
9. **reviews #1** — manual-review resolve is read-validate-write with no `AND status=expected` guard → double-approval re-resumes steps & re-dispatches runs. `db/repos/communication/manual_reviews.rs:267`
10. **execution #1** — cancel is silently clobbered back to `completed` by the finalizer (`WHERE status IN ('running','cancelled')`). `engine/mod.rs:1041`
11. **teams #1** — no single-live-task guard → double-start/resume spawns concurrent tick loops that duplicate-execute the same step. `commands/teams/assignments.rs:135`
12. **companion #1** — `send_turn` has no turn-level lock; a user turn and a proactive turn both `--resume` and overwrite the shared session id + brain. `companion/session.rs:318`
13. **composition #6** — approval-gate poll shares a cancel-registry key with the pipeline and hard-fails a human review after exactly 1h. `engine/pipeline_executor.rs:637`
14. **evolution #1** — AI-healing slot acquired twice; the re-acquire early-returns before cleanup → slot leaked permanently, healing bricked until restart. `commands/execution/healing.rs:127` → `engine/mod.rs:2897`
15. **events #2** — crash/leadership handoff between POST and `set_watermark` re-delivers the whole batch (no idempotency). `engine/webhook_notifier.rs:472`

**T3 — Success theater / silent failure: claims success while it failed (7)**
16. **test-suites #1** — every non-erroring scenario recorded `passed` regardless of score (defeats the promotion gate). `engine/test_runner.rs:318`
17. **test-suites #2** — heuristic fallback fabricates ~80 composite scores when LLM eval times out. `engine/eval.rs:679`
18. **lab #1** — panicked/failed/dropped variant tasks silently swallowed; run unconditionally marked `Completed`. `engine/test_runner.rs:1643`
19. **teams #2** — abort/pause never cancel in-flight executions → success/failure theater + orphaned agent work. `commands/teams/assignments.rs:146`
20. **events #1** — outbound webhook watermark advances even when every delivery fails → notifications dropped forever. `engine/webhook_notifier.rs:481`
21. **research #1** — experiment run result persisted only after a 120s client poll → app close/timeout loses the completed run. `sub_experiments/ExperimentsPanel.tsx:63`
22. **research #2** — timeout / non-terminal execution recorded as a genuine `failed` run. `shared/runPersona.ts:47`

**T4 — Orphaned processes / zombie state / destructive-before-confirm recovery gaps (5)**
23. **fleet #1** — kill/close/hibernate only drops PTY handles, never `child.kill()` → interactive `claude` survives as a zombie burning tokens. `commands/fleet/commands.rs:118`
24. **fleet #2** — hibernate clears `child_pid` before confirmed death → orphan invisible to the scanner. `commands/fleet/registry.rs:530`
25. **execution #2** — fire-and-forget `update_status(Running)` on a detached session-id write resurrects terminal rows → zombies. `engine/runner/mod.rs:1890`
26. **dev-ideas #2** — timed-out task never kills its child and blocks on `wait()` forever. `commands/infrastructure/task_executor.rs:862`
27. **dev-ideas #1** — context-map rescan commits the destructive `clear_project_context_map` DELETE before the LLM produces anything → spawn-fail/cancel destroys the hand-curated map. `commands/infrastructure/context_generation.rs:668`

**T5 — Security: trust / authz / injection / secret-leak / DoS (7)**
28. **mcp #1** — SQLite ATTACH/DETACH/VACUUM deny-list uses `starts_with("ATTACH ")` → `ATTACH/**/DATABASE` or tab bypasses it → cross-DB exfil + arbitrary file write. `engine/db_query.rs:2176`
29. **p2p #1** — peer identity is self-declared in Hello/HelloAck and never proven (QUIC accepts any cert) → any LAN attacker becomes a "trusted" peer. `engine/p2p/connection.rs:471`
30. **cloud-sync #1** — `remote_command_approve` fetches by id only, no `target_device_id` scope → a command for one device runs on another on the same account. `cloud/remote_commands.rs:226`
31. **deployment #1** — backend `sign_document` enforces no sensitive-path allowlist (only the bypassable TS wrapper does) → any IPC caller can sign SSH keys / wallets. `commands/signing/mod.rs:35`
32. **deployment #2** — GitLab provisioning pushes secrets with `masked:true` even when unmaskable → secret leak + stranded secrets on partial deploy. `gitlab/converter.rs:97`
33. **credential-vault #1** — clearing all fields (`data:{}`) skips the DELETE ("no change") → silently retains old encrypted secrets while reporting success. `db/repos/resources/credentials.rs:389`
34. **triggers #1** — inbound smee/webhook events call `event_repo::publish` directly, bypassing the rate limiter that only guards IPC → leaked channel URL = unbounded execution storm. `engine/smee_relay.rs:448`

**T6 — Data-corruption loops, cross-context state survival, stream/graph integrity (7)**
35. **personal-twin (bug) #1** — approving a twin reply defaults `createMemory=true`, feeding the twin's own output into its memory inbox → compounding corruption loop. `twin/sub_channels/ReplyOutbox.tsx:115`
36. **agent-memories #1** — `apply_persona_memory_review_proposal` mutates one-by-one with no transaction and flips status last → crash/double-click wedges it `pending_review` and re-applies. `commands/core/memories.rs:807`
37. **persona-authoring #2** — delete-confirm state survives a persona switch → confirming deletes the wrong persona. `sub_editor/hooks/useEditorDraft.ts:67`
38. **onboarding #6** — onboarding flow state is in-memory only → mid-flow reload re-prompts first-run or strands a dismissed user. `onboardingSlice.ts:89`
39. **lab #2** — `version_number` used as the variant↔result join key despite non-atomic, non-unique allocation → results mis-attributed to the wrong version. `engine/test_runner.rs:2162`
40. **persona-chat #1** — stream listeners attach after `executePersona` resolves → fast/`--resume`/error executions emit their terminal status into the gap → chat hangs forever, reply unsaved. `chatSlice.ts:213`
41. **composition #1** — cyclic team graphs are detected but executed anyway → fake-success runs poison team memory. `commands/teams/teams.rs:270`

### 🎨 UI criticals (19)

**G — Error-blind surfaces (error renders as "empty"/blank; no loading state) (7)**
42. **executions ui #1** — fetch failure renders the "Agent ready / Try it now" empty state, no retry. `sub_executions/components/list/ExecutionList.tsx:383`
43. **research-lab ui #1** — every pipeline stage swallows errors → a failed fetch looks like "empty" across 6 panels. `sub_literature/LiteratureSearchPanel.tsx:114` (+5)
44. **dev-scanner ui #1** — failed scan sets `scanPhase:'error'` but renders the generic "no results yet" placeholder. `sub_scanner/IdeaScannerPage.tsx:593`
45. **onboarding ui #1** — cockpit fetch *error* renders the same "your cockpit is empty" CTA, no retry — error-blind first impression. `sub_cockpit/CockpitPanel.tsx:64`
46. **agent-memories ui #1** — memories list has no loading flag → "No memories yet" empty state flashes on every fetch/filter. `sub_memories/components/MemoriesPage.tsx:375`
47. **reviews ui #3** — DesignReviewsPage drops the hook's `isLoading` → blank body + flashing "0". `templates/components/DesignReviewsPage.tsx:24`
48. **persona-authoring ui #1** — persona name field has no required/validation/error affordance; empty name autosaves while status reads "All saved". `sub_settings/components/PersonaSettingsTab.tsx:94`

**H — Critical accessibility gaps on core interactions (6)**
49. **mcp ui #1** — SQL result grid cells/columns copy on click but are bare `<td>` with `onClick` only — no keyboard, role, or aria. `sub_databases/QueryResultTable.tsx:62`
50. **composition ui #1** — zero a11y across the node canvas; nodes are unlabeled non-focusable divs, status color-only. `teams/sub_canvas/components/nodes/PersonaNode.tsx:59`
51. **companion ui #1** — chat panel has no `aria-live`; assistant replies, "Thinking…", and listening state are painted silently. `companion/CompanionPanel.tsx:1752`
52. **credential-vault ui #1** — the secret show/hide reveal toggle is an unlabeled icon button (no `aria-label`/`aria-pressed`). `sub_credentials/components/forms/FieldCaptureHelpers.tsx:120`
53. **overview ui #1** — chart annotation `<title>` interpolates a React element → renders `[object Object]` as the only text alternative. `sub_observability/components/MetricsCharts.tsx:86`
54. **deployment ui #2** — deployment card status badge is color-only (emerald vs red, no icon). `sub_deployment/components/cloud/cloudDeploymentHelpers.ts:25`

**I — Destructive / high-stakes action with no confirmation or wrong weight (3)**
55. **personal-twin ui #1** — "Approve & log" sends a message AS the user with zero confirmation, while lower-stakes deletes are gated. `twin/sub_channels/ReplyOutbox.tsx:239`
56. **creative ui #3** — per-image delete fires on a single hover-click, no confirm, off-palette `red-500` (Drive always confirms). `artist/sub_gallery/AssetCard.tsx:161`
57. **cloud-sync ui #1** — remote-approval prompt can't show which device requested the run (payload has no origin) → users approve remote execution blind. `cloud/RemoteApprovalPrompt.tsx:83`

**J — Visual-consistency criticals (broken/duplicated core UI) (3)**
58. **teams ui #1** — two divergent step-status visual vocabularies for the same 7 statuses (Flight Deck vs Orchestration Console). `teams/sub_teamWorkspace/teamStudio/teamStudioShared.tsx:234`
59. **templates ui #1** — preset card accent strip uses a non-existent class (`absolute-top-strip`) on a non-positioned parent → signature color bar silently broken catalog-wide. `templates/sub_presets/PresetLibraryPage.tsx:107`
60. **settings ui #1** — BYOM secret fields reinvent the masked-input primitive (plain `type=text`, no copy, no a11y) while `PasswordToggleField` exists next door. `settings/sub_byom/components/ByomApiKeyManager.tsx:82`

---

## Triage themes (all 354 findings, by recurring pattern)

| Theme | Scope | Approx count | Why it's a wave, not just isolated fixes |
|---|---|---:|---|
| Lost-update / no compare-and-swap | bug | ~14 | Same RMW-without-CAS shape across use_cases, recipes, evolution, knowledge, memories, twin. One transaction/CAS pattern fixes the class. |
| Unguarded status transitions & lock leaks | bug | ~12 | `WHERE id` without `AND status=expected`; missing per-entity locks. A guarded-claim helper + lock convention closes them together. |
| Success theater / silent failure | bug | ~20 | `let _ =`, exit-code-as-success, partial-as-complete. Shared "verdict reflects reality" discipline. |
| Orphaned processes / zombie rows / recovery gaps | bug | ~10 | Spawn sites that don't kill children or reap on crash (fleet, execution, dev-tools, task_executor). |
| Security: trust / injection / secret-leak / DoS | bug | ~9 | Backend trusts the TS wrapper's checks; rate-limit/auth applied at IPC but not at the real publish/sign/approve site. |
| Error-blind UI (error == empty) | ui | ~22 | Slices track only `*Loading`, no error field; catch blocks swallow. Add error state + retry to the shared list/empty primitives. |
| Color-only / unlabeled status & a11y | ui | ~30 | Status pills/dots encode by color only; icon-only buttons use `title` not `aria-label`. One `StatusBadge` (icon+text) + aria sweep. |
| Duplicated/divergent component markup | ui | ~25 | Badge/card/row/empty-state markup copy-pasted 3-4× and already drifting. Extract shared primitives (StatusBadge, EmptyState, WidgetShell). |
| Destructive action without confirm/weight | ui+bug | ~8 | Highest-stakes actions (send-as-user, image delete, bulk reject) least guarded. ConfirmDialog convention. |
| Hardcoded strings bypassing i18n | ui | ~10 | English literals amid a fully i18n'd surface (templates, use-cases, fleet, p2p, vault). |
| Token/scale drift vs design system | ui | ~15 | Raw `red/emerald/text-[10px]` vs `status-*`/`typo-*` tokens; `placeholder:text-foreground` (20+ files). |

---

## Suggested fix-wave split

Sessionable waves (~5–7 fixes each, one mental model per wave). **Tier 1 = reliability criticals first**; UI a11y/error-blind next; highs after. Mediums/lows (`token drift`, `i18n`, polish) are deferred batches.

**Tier 1 — reliability criticals (do first, highest blast radius):**
- **Wave 1 — Lost-update writes (CAS/transaction)** — bug T1 (use_cases ×2, recipes, evolution, knowledge, templates, creative, authoring-undo). 8 fixes.
- **Wave 2 — Status-transition guards & lock leaks** — bug T2 (reviews, execution-cancel, teams double-start, companion turn lock, composition gate, healing slot, events idempotency). 7 fixes.
- **Wave 3 — Success theater / silent failure** — bug T3 (test false-green ×2, lab partial, teams abort, webhook watermark, research persist ×2). 7 fixes.
- **Wave 4 — Orphaned processes & recovery gaps** — bug T4 (fleet ×2, execution zombie, dev-tools task ×2). 5 fixes.
- **Wave 5 — Security** — bug T5 (SQL escape, P2P trust, cross-device approve, sign_document, GitLab masking, vault empty-clear, webhook rate-limit). 7 fixes. *Touches auth/crypto/secret surfaces — review carefully.*
- **Wave 6 — Corruption loops & stream/graph integrity** — bug T6 (twin loop, memory txn, delete-wrong-persona, onboarding persist, lab version key, chat stream race, cycle-runs-anyway). 7 fixes.

**Tier 2 — UI criticals:**
- **Wave 7 — Error-blind surfaces** — UI theme G (executions, research, dev-scanner, onboarding cockpit, memories, reviews, authoring-name). 7 fixes.
- **Wave 8 — Critical accessibility** — UI theme H (SQL grid, node canvas, companion aria-live, secret toggle, chart `[object Object]`, deployment badge). 6 fixes.
- **Wave 9 — Destructive-confirm + broken/divergent UI** — UI themes I+J (twin send, image delete, approval-prompt origin, teams status vocab, preset strip, BYOM secret field). 6 fixes.

**Tier 3 — highs (169), grouped by theme:** plan ~10–14 waves once Tier 1–2 land (e.g. one wave per group: Execution & Orchestration highs, Observability highs, Connections & Credentials highs, Persona Studio highs, Plugins highs, then the UI high themes — color-only status, duplicated markup, missing states).

**Deferred batches:** medium/low token-drift, i18n string extraction, and polish — fold into the relevant theme wave or run as dedicated cleanup sessions.

---

## How this scan was run (provenance)

- **Scanners**: `bug-hunter` (`src/lib/prompts/registry/agents/bug-hunter.ts`) + `ui-perfectionist` (`ui-perfectionist.ts`), from the Vibeman prompt registry. Adapted per-context with targeted focus hints.
- **Date**: 2026-06-09. **Method**: 60 isolated `general-purpose` subagents (1 per context per scanner), waves of 8, each writing one report and replying with terse stats only (orchestrator never read full reports during scanning).
- **Scope**: all 30 contexts from `GET /api/contexts?projectId=8e680c8c…`, full-stack (`src/` + `src-tauri/`). Findings target: focused 3–6/context.
- **Files read by scan subagents**: ~750 across all 60 runs (≈12/run avg).
- **Verification**: `> Total:` header sum (354) == `- **Severity**:` bullet count (354). ✅
- **Stale context-map paths discovered during scanning** (worth fixing in the context map itself):
  - composition canvas: documented `pipeline/components/TeamCanvas` is a **stub**; live canvas at `src/features/teams/sub_canvas` (orphaned — only `CanvasDragProvider` is imported; no host mounts `<ReactFlow>`).
  - chat: real surface is `sub_editor/.../ChatThread.tsx` + `ChatMessageContent.tsx`, not `components/chat`.
  - triggers cron builder lives in `sub_triggers/`, not `sub_builder/`.
  - evolution/genome UI was removed (moved to headless Athena); only self-healing UI remains.
  - dev-tools UI: `sub_runner`/`sub_scanner`/`sub_triage`, not `DevToolsPage`/`sub_goals`.
  - teams: `sub_teamMemory` + `sub_teamWorkspace/teamStudio`; `sub_assignments` is hooks-only.
  - test-suites: `testSlice` actions have **no UI consumer**; the rendered test surface is the Lab tab.
  - deployment: "document signing" has no UI (only a `signed` token placeholder).
