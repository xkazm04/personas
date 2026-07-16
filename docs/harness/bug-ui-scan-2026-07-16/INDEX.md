# Bug-Hunter + UI-Perfectionist Scan — personas, 2026-07-16

> Combined reliability + UI audit of all 52 contexts, 5 findings each.
> 52 parallel subagent runs, batched in waves of ≤8, ~5,300 files read.
> Baseline preserved for the fix phase: tsc **0 errors**, vitest **2358/2358** (238 files).

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 52 contexts | 4 | 71 | 146 | 39 | **260** |
| Share | 1.5% | 27.3% | 56.2% | 15.0% | 100% |

Counts verified two ways: 260 `## N.` finding headings, 260 `**Severity**` bullets — match.

---

## Per-group rollup (sorted by C, then H)

| Group | C | H | M | L | Total |
|---|---:|---:|---:|---:|---:|
| Data & Persistence (3 ctx) | 1 | 4 | 8 | 2 | 15 |
| First-Party Plugins (6 ctx) | 1 | 7 | 18 | 4 | 30 |
| Observability & Analytics (5 ctx) | 1 | 4 | 15 | 5 | 25 |
| Teams & Fleet Orchestration (4 ctx) | 1 | 8 | 9 | 2 | 20 |
| Execution Engine (5 ctx) | 0 | 11 | 11 | 3 | 25 |
| Credential Vault & Connectors (5 ctx) | 0 | 7 | 12 | 6 | 25 |
| Onboarding, Home & Settings (4 ctx) | 0 | 7 | 11 | 2 | 20 |
| Persona & Agent Studio (4 ctx) | 0 | 6 | 13 | 1 | 20 |
| Platform Foundation (5 ctx) | 0 | 5 | 15 | 5 | 25 |
| Triggers & Events (3 ctx) | 0 | 4 | 9 | 2 | 15 |
| Athena Companion (4 ctx) | 0 | 4 | 14 | 2 | 20 |
| Templates & Recipes (4 ctx) | 0 | 4 | 11 | 5 | 20 |

---

## Per-context breakdown (sorted by criticals desc, then highs)

| # | Context | C | H | M | L | Report |
|---|---|---:|---:|---:|---:|---|
| 1 | Pipeline & Agent Chains | 1 | 2 | 2 | 0 | pipeline-agent-chains.md |
| 2 | Obsidian Brain | 1 | 2 | 1 | 1 | obsidian-brain.md |
| 3 | Crypto & Secure Storage | 1 | 1 | 3 | 0 | crypto-secure-storage.md |
| 4 | Knowledge Base & Memories | 1 | 1 | 3 | 0 | knowledge-base-memories.md |
| 5 | Director & Leadership | 0 | 3 | 2 | 0 | director-leadership.md |
| 6 | Onboarding Tour | 0 | 3 | 2 | 0 | onboarding-tour.md |
| 7 | Execution Runner & Inspector | 0 | 3 | 1 | 1 | execution-runner-inspector.md |
| 8 | Team Builder & Workspace | 0 | 3 | 1 | 1 | team-builder-workspace.md |
| 9 | Agent Lab & Versions | 0 | 2 | 3 | 0 | agent-lab-versions.md |
| 10 | Capabilities, Use Cases & Model Config | 0 | 2 | 3 | 0 | capabilities-use-cases-model-config.md |
| 11 | Cloud Sync & Deployment | 0 | 2 | 3 | 0 | cloud-sync-deployment.md |
| 12 | Genome & Evolution | 0 | 2 | 3 | 0 | genome-evolution.md |
| 13 | Team Assignment & Handoff | 0 | 2 | 3 | 0 | team-assignment-handoff.md |
| 14 | Webhooks & Channel Pollers | 0 | 2 | 3 | 0 | webhooks-channel-pollers.md |
| 15 | Build Sessions & PersonaMatrix | 0 | 2 | 2 | 1 | build-sessions-personamatrix.md |
| 16 | Credential Vault CRUD | 0 | 2 | 2 | 1 | credential-vault-crud.md |
| 17 | Database Schema & Migrations | 0 | 2 | 2 | 1 | database-schema-migrations.md |
| 18 | MCP Gateways & Tools | 0 | 2 | 2 | 1 | mcp-gateways-tools.md |
| 19 | Self-Healing & Auto-Rollback | 0 | 2 | 2 | 1 | self-healing-auto-rollback.md |
| 20 | Settings & BYOM | 0 | 2 | 2 | 1 | settings-byom.md |
| 21 | Approvals & Decisions | 0 | 1 | 4 | 0 | approvals-decisions.md |
| 22 | Artist Studio | 0 | 1 | 4 | 0 | artist-studio.md |
| 23 | Cockpit, Voice & Sensory | 0 | 1 | 4 | 0 | cockpit-voice-sensory.md |
| 24 | Google Drive | 0 | 1 | 4 | 0 | google-drive.md |
| 25 | Persona Editor & CRUD | 0 | 1 | 4 | 0 | persona-editor-crud.md |
| 26 | Tauri IPC Bridge & API | 0 | 1 | 4 | 0 | tauri-ipc-bridge-api.md |
| 27 | Agent Chat | 0 | 1 | 3 | 1 | agent-chat.md |
| 28 | Companion Brain & Proactivity | 0 | 1 | 3 | 1 | companion-brain-proactivity.md |
| 29 | Companion Runtime & Chat | 0 | 1 | 3 | 1 | companion-runtime-chat.md |
| 30 | Connector Catalog | 0 | 1 | 3 | 1 | connector-catalog.md |
| 31 | Dashboard & Mission Control | 0 | 1 | 3 | 1 | dashboard-mission-control.md |
| 32 | Design Reviews & Diagrams | 0 | 1 | 3 | 1 | design-reviews-diagrams.md |
| 33 | Dev Tools & Context Map | 0 | 1 | 3 | 1 | dev-tools-context-map.md |
| 34 | Error Handling, Hooks & Utilities | 0 | 1 | 3 | 1 | error-handling-hooks-utilities.md |
| 35 | Fleet Control | 0 | 1 | 3 | 1 | fleet-control.md |
| 36 | Incidents & Manual Review | 0 | 1 | 3 | 1 | incidents-manual-review.md |
| 37 | Internationalization (i18n) | 0 | 1 | 3 | 1 | internationalization-i18n.md |
| 38 | Messages & Notifications | 0 | 1 | 3 | 1 | messages-notifications.md |
| 39 | OAuth, API Proxy & Foraging | 0 | 1 | 3 | 1 | oauth-api-proxy-foraging.md |
| 40 | Observability & Alerts | 0 | 1 | 3 | 1 | observability-alerts.md |
| 41 | Persona Templates | 0 | 1 | 3 | 1 | persona-templates.md |
| 42 | Personas Twin | 0 | 1 | 3 | 1 | personas-twin.md |
| 43 | Repositories & Models | 0 | 1 | 3 | 1 | repositories-models.md |
| 44 | Research Lab | 0 | 1 | 3 | 1 | research-lab.md |
| 45 | Scheduler & Cron Agents | 0 | 1 | 3 | 1 | scheduler-cron-agents.md |
| 46 | State Management (Zustand) | 0 | 1 | 3 | 1 | state-management-zustand.md |
| 47 | Triggers & Event Registry | 0 | 1 | 3 | 1 | triggers-event-registry.md |
| 48 | Credential Design & Negotiation | 0 | 1 | 2 | 2 | credential-design-negotiation.md |
| 49 | Shared UI Component Library | 0 | 1 | 2 | 2 | shared-ui-component-library.md |
| 50 | Home & Roadmap | 0 | 0 | 4 | 1 | home-roadmap.md |
| 51 | Analytics, SLA & Usage | 0 | 0 | 3 | 2 | analytics-sla-usage.md |
| 52 | Recipes & Use-Case Blueprints | 0 | 0 | 3 | 2 | recipes-use-case-blueprints.md |

---

## The 4 Critical findings

1. **Crypto — enclave verify trusts an unbound public key.** `enclave.rs:219-234` checks the signature against the *archive-embedded* public key and separately trusts the claimed `signer_peer_id`, never binding the two — so a forged enclave signed by any untrusted key verifies as both `signature_valid: true` AND `creator_trusted: true`. Sibling `bundle.rs` proves the correct DB-key pattern. `crypto-secure-storage.md #1`
2. **Knowledge — LLM memory review can hard-delete pinned `core` memories.** `memories.rs:801-820` delete path has no tier guard (unlike delete_all/merge/archive), so review/curation-apply can irreversibly destroy user-pinned core memories the LLM never even sees the tier for. Violates the MEMORY CONTRACT. `knowledge-base-memories.md #1`
3. **Obsidian — `resolve_conflict` path traversal → arbitrary file overwrite.** `obsidian_brain/mod.rs:1266` joins a frontend-supplied `file_path` to the vault verbatim, bypassing `resolve_vault_subpath`; a `..` or Windows-absolute path overwrites any file outside the vault (plus a TOCTOU clobber — `vault_hash` is never re-checked). `obsidian-brain.md #1`
4. **Pipeline — crash leaves `pipeline_runs` 'running' forever, bricking the team.** `teams.rs` / pipeline repo: no startup recovery sweep, and `cancel_pipeline` is an in-memory no-op after restart, so a crash mid-run permanently blocks new runs and team deletion. `pipeline-agent-chains.md #1`

---

## Triage themes (the 75 Critical+High findings cluster into these)

Fixing by theme lets one mental model close 4–8 findings per session.

| Theme | Approx C+H | Why it's a wave |
|---|---:|---|
| **A. Crash-orphaned `running` rows / no startup recovery sweep** | ~8 | Same shape everywhere: a row is set `running`, the process dies, no sweep resets it → feature permanently blocked. Contexts: pipeline (CRIT), approvals, agent-lab, dev-tools automations, repositories zombie-sweep, self-healing slot leak. |
| **B. OAuth refresh-token rotation discarded → credential bricked** | ~4 | `.map(\|r\| r.token)` throws away the provider-rotated refresh_token; the atomic persist path exists but is bypassed. oauth-api-proxy, connector-catalog, + credential metadata reset & recipe clobber. |
| **C. Timeout that never cancels the live child → duplicate/zombie work** | ~6 | A timeout marks failed/aborts UI but the CLI/execution keeps running; retries then double-execute. artist, team-assignment, director, design-reviews cancel-no-op, companion reset-mid-turn. |
| **D. Silent success-theater / errors swallowed, never surfaced** | ~9 | Failed destructive/mutating actions look successful or hang forever. persona-editor delete, ConfirmDialog, messages relay `connected:true`, error-registry "Try again", vault spinner, dashboard/cockpit spinners, pipeline empty stdout. |
| **E. Fail-open / missing guard on a privileged or destructive path** | ~10 | Security-adjacent. enclave (CRIT), core-memory delete (CRIT), obsidian traversal (CRIT), budget fail-open, pipeline nodes bypass gates, byom origin/CORS + TOCTOU, fleet one-click kill, mcp plaintext keys, incidents clobber human review. |
| **F. Partial-update NULLs omitted fields / rewrites with defaults** | ~5 | Write-all-columns with no tri-state silently wipes user data. twin contact, research-lab clear-field no-op, recipe upsert, alert-rule edit, fk-hygiene column drop. |
| **G. Store cross-contamination / wrong-target writes** | ~4 | Zustand actions target the *active* entity instead of the intended one, or evict open editors. agent-chat threads, build-sessions test lifecycle, zustand fetchDetail deselect, triggers impure setEvents. |
| **H. Check-then-act with no atomic claim (concurrency)** | ~5 | Concurrent boot/promote/retry double-inserts. director seeding, build-sessions promote, team-builder retry, cloud-sync passes, byom key TOCTOU. |
| **I. Multi-byte UTF-8 byte-slice panic** | ~2 | `output[..3000]` / `String::truncate` on a non-char-boundary panics the task. eval.rs, knowledge normalize_error_pattern. |
| **J. Scheduling / time-window logic** | ~4 | Wrong anchor/granularity skips or duplicates work. scheduler backfill dedup, self-healing calendar-day, cloud-sync tombstone cursor, genome perpetual auto-evolution. |
| **K. Feature dead / mis-wired** | ~3 | Renders innocent but never works. tauri Zapier unregistered commands, pipeline approval gates no UI, mcp stdio framing. |

---

## Suggested fix-wave plan (7 waves, criticals first)

- **Wave 1 — The 4 Criticals** (security + data-loss + brick): enclave trust-binding, core-memory tier guard, obsidian path-containment, pipeline run recovery. Each is isolated; highest risk-reduction per commit.
- **Wave 2 — Theme A: crash-orphaned `running` rows.** One startup-sweep pattern applied to pipeline_runs, companion_approval, lab runs, automations, + the repository `started_at`/zombie-sweep fix and healing slot leak.
- **Wave 3 — Theme B + C: credential bricking + uncancelled timeouts.** OAuth rotation persist, credential metadata/recipe clobber, timeout-kills-child across artist/team-assignment/director/design-reviews.
- **Wave 4 — Theme E: fail-open guards** (the non-critical security cluster): budget fail-open, pipeline gate bypass, byom origin/TOCTOU, fleet kill confirm, mcp plaintext keys, incidents human-review clobber.
- **Wave 5 — Theme D: surface swallowed failures.** ConfirmDialog + destructive call sites, relay health honesty, error-registry timeout guidance, spinner dead-ends (vault/dashboard/cockpit), pipeline stdout capture.
- **Wave 6 — Theme F + G + H: data integrity (partial-update, store, concurrency).** tri-state updates, store target fixes, atomic claims on promote/retry/seed.
- **Wave 7 — Theme I + J + K + tail.** UTF-8 panics, scheduling windows, dead features, then the highest-value Mediums.

Mediums (146) and Lows (39) are held for post-High tail waves.

---

## How this scan was run

- **Scanners**: bug-hunter + ui-perfectionist (dual-hat) from `vibeman/src/lib/prompts/registry/agents/`.
- **Scope**: all 52 contexts, full-stack (frontend `src/` + Rust `src-tauri/`), 5 findings/context.
- **Method**: one general-purpose subagent per context (read-only), each writing one report file; orchestrator read only terse replies. Waves of ≤8 parallel.
- **Verification**: 260 headings == 260 severity bullets; per-context counts reconciled.
- **Context-map drift noted by subagents** (files in the map that no longer exist / moved): `AiHealingCounters.tsx`, `RedRoomPane.tsx`, `CatalogCard.tsx`, `sub_builder/EventCanvas.tsx`, `DetailPanel.tsx`, `charts/ChartTooltip.tsx` (now under `components/`), `PiperVoicePanel.tsx` (Piper descoped), `ChatSearch.tsx` (worktree-only), `personaStore.ts`/slice `index.ts` (store re-architected into 5 domain stores), `GroupList.tsx`, and `pipeline/index.ts`. Worth a `refresh_context` pass before the next scan.
