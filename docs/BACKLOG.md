# Documentation Backlog

A single source for everything the docs tree should grow into: shipped concepts pending move, undocumented feature areas, structural improvements, and recommended-practice docs that don't yet exist. Items are grouped by intent and tagged with a rough size hint.

> **Created:** 2026-05-09 from a deep audit of all 145 live docs against the current codebase. The audit verdicts (per-file OK / minor-drift / major-drift / move) are not duplicated here — they were applied in-place during the same pass. This file lists only the *forward* work.

## 2026-05-10 progress sweep

Two `/explorer` doc-coverage runs landed across the day:

**Morning sweep — features/ coverage** (`exp-df8m`, 10 commits `b6b5b27b9 → 9816c3413`):
- ✅ `features/langfuse.md` (P1 plugin gap)
- ✅ `features/gitlab.md` (P1 plugin gap)
- ✅ `features/deployment/README.md` (P1 — undocumented `src/features/deployment/`)
- ✅ `features/sharing/README.md` (P1 — undocumented `src/features/sharing/` + backend `commands/network/`)
- ✅ `features/pipeline/README.md` (P1 — undocumented `src/features/pipeline/`)
- ✅ `features/schedules.md` (P1 — undocumented `src/features/schedules/`)
- ✅ `features/automation-tools.md` (`commands/tools/` 7-file module)
- ✅ `features/onboarding.md` + `home.md` thin-doc augmentation
- ✅ `features/README.md` index updated with 8 new rows
- ✅ `feature-doc-map.json` 7 new entries (closes P0 plugin-map-gap)

**Afternoon sweep — concepts/ audit** (`exp-dc7n`, 10 commits `5433edd64 → ea0996e08`):
- ✅ `CLAUDE.md` broken `BUILD.md` / `ANDROID-BUILD.md` links fixed (P0)
- ✅ `concepts/README.md` indexed 3 missing athena-desktop-aware docs
- ✅ `concepts/langfuse-observability.md` banner-reframed → cross-links `features/langfuse.md`
- ✅ `concepts/invisible-apps-p2p.md` banner-reframed → cross-links `features/sharing/`
- ✅ MOVE `concepts/agent-operations-hub.md` → `features/agents/operations-hub.md` (P0)
- ✅ MOVE `concepts/cli-coordination-active-runs.md` → `architecture/cli-coordination.md` (P0; CLAUDE.md inbound link updated)
- ✅ MOVE `concepts/in-app-http-service.md` → `architecture/in-app-http-service.md` (P0)
- ✅ MOVE `harness/simple-mode-roadmap.md` → `features/interface-modes/simple-mode.md` (P0)
- ✅ `concepts/README.md` close-out (Active table trimmed, Moved out expanded)

**Status of P0 list after 2026-05-10:**
- ✅ All 5 concept-and-harness moves done
- ✅ Plugin map-entry gap closed (gitlab + langfuse)
- ✅ CLAUDE.md broken doc links fixed
- ⏳ `langfuse-observability.md` and `invisible-apps-p2p.md` are banner-reframed (cross-link to shipped feature doc) but not full-moved — defer until Path A+ exploration concludes / Phase 3 internet P2P scopes
- ⏳ `refactor/` resolution still pending (Are these still active? archive vs `architecture/refactoring/`)

**Status of P1 list after 2026-05-10:**
- ✅ All 4 undocumented `src/features/` areas covered (deployment, pipeline, schedules, sharing)
- ✅ Both plugin docs landed (gitlab, langfuse)
- ⏳ Architecture-level coverage gaps unchanged (CI workflow doc, codegen orchestration expansion, MCP user/troubleshooting docs)

P2 (recommended-practice docs) and P3 (polish) untouched this sweep.

Tag legend: **[S]** ≤ 30 min, **[M]** half a day, **[L]** full day or more.

---

## P0 — Structural integrity (do these first)

These are the items that, if left undone, make the rest of the tree quietly lie. Every other improvement assumes these are clean.

### Move shipped concepts out of `concepts/`

`docs/README.md` rule: "When a concept ships, move or rewrite it under `docs/features` or `docs/architecture`." `concepts/README.md` already flags these as **SHIPPED — pending MOVE** (status column updated 2026-05-09). The move requires creating the destination, copying content, rewriting status from "proposal" to "shipping spec," and updating any inbound links.

| Source | Destination | Notes | Size |
|---|---|---|---|
| `concepts/agent-operations-hub.md` | `features/agents/operations-hub.md` | Phase 1 chat ops dispatch + sidebar panels live in `src/features/agents/sub_chat/`. Phase 2 (sidebar consolidation) becomes "Future work" subsection. | [M] |
| `concepts/cli-coordination-active-runs.md` | `architecture/cli-coordination.md` | v1 + v2 priority-five adoption (5 skills) shipped. Move and add a "Long-tail adoption pending" follow-up. Update CLAUDE.md's existing link in the Concurrent CLI sessions section. | [M] |
| `concepts/in-app-http-service.md` | `architecture/in-app-http-service.md` | Generic in-app HTTP router + Langfuse auto-login route shipped. Reframe as a reusable infrastructure pattern doc (OAuth, webhook callbacks). Code lives at `src-tauri/src/local_http/`. | [M] |
| `concepts/invisible-apps-p2p.md` | `features/p2p-sharing/README.md` (new dir) | Phase 1 (identity + manifest signing) and Phase 2 (LAN peer discovery) shipped. Phase 3 (internet P2P) stays as future work. Cross-link to `devops/review-security-invisible-apps.md`. | [L] |
| `concepts/langfuse-observability.md` | `features/observability/README.md` (new dir) | Path A closed — managed self-host stack, OTLP exporter, auto-login HTTP service, lifecycle. Path A+ stays in concepts/ as a follow-up. Cross-link `concepts/langfuse-lab-score-push.md`. | [L] |
| `harness/simple-mode-roadmap.md` | `features/interface-modes/simple-mode.md` (new dir) | All 4 phases marked complete. UI mode toggle in `AppearanceSettings.tsx`; sidebar L1 gating via `SIMPLE_SECTIONS`. | [M] |

For each move, also update:
- `concepts/README.md` "Moved out" section
- Any inbound `[…](../concepts/…)` references in other docs (grep first)
- `feature-doc-map.json` if a new `docs/features/<area>/README.md` is created

### Resolve `docs/refactor/`

The user's working tree had these flagged for deletion but the audit recommended preserving:

- `refactor/god-file-refactor-plan.md` — tracks incremental Rust module splits (`runner/` done, `build_session/` in progress, `prompt/` planned)
- `refactor/runner-execution-context-design.md` — design for an `ExecutionContext` struct splitting `run_execution` into 4 stages

Decide, in order:
1. Are these still active? Check `git log --since="2026-04-01" -- src-tauri/src/engine/runner/ src-tauri/src/engine/build_session/` for movement.
2. If complete → archive snapshot to `_archive/concepts/` with a date stamp.
3. If active → **move to** `architecture/refactoring/` (or `development/refactoring/`). They document module structure, which belongs in architecture/.
4. If stale-but-still-relevant → keep where they are but add a status banner noting last-verified date. **[M]**

### Add `feature-doc-map.json` entries for missing plugins

`src/features/plugins/gitlab/` and `src/features/plugins/langfuse/` exist as plugin directories but have **no entry** in `scripts/docs/feature-doc-map.json`. The Stop hook can't catch drift in these areas. Either:

- Add entries pointing to new docs (`features/gitlab.md`, `features/langfuse.md`), OR
- Confirm these plugins are inactive scaffolding and remove the directories.

Note: `architecture/gitlab-integration.md` exists and covers the GitLab Duo Agents integration from the *deployment* angle, but the in-app `plugins/gitlab/` UI surface has no doc. **[S–M]**

### Fix CLAUDE.md doc links (out of `docs/` scope but blocks discoverability)

`.claude/CLAUDE.md` lines 21 and 23 link to `docs/BUILD.md` and `docs/ANDROID-BUILD.md`, which do not exist. Actual paths are `docs/development/build.md` and `docs/development/android-build.md`. This is a CLAUDE.md fix, not a docs/ fix, but it directly affects how readers reach the build documentation. **[S]**

---

## P1 — Coverage gaps (existing features without docs)

Each entry is a feature that exists in code but has no canonical `docs/features/<area>/` doc, OR has a doc that's silent about a major subsurface.

### Undocumented `src/features/` areas

| Module | Why it needs a doc | Size |
|---|---|---|
| `src/features/deployment/` | Surfaces a deployment tab/page; unclear scope. Either document, fold into `features/connections/`, or delete the module. | [M] |
| `src/features/pipeline/` | Possibly internal. Verify whether it's user-visible; if yes, write a feature doc. | [M] |
| `src/features/schedules/` | `features/events/README.md` mentions schedules but doesn't own them. A dedicated `features/schedules.md` (cron triggers, calendar UI, schedule lifecycle) would close the gap. | [M] |
| `src/features/sharing/` | Referenced from `settings/README.md` (ExposureManager.tsx) but has no standalone doc. Cross-cut with the P2P move (above). | [M] |

### Plugin docs that are missing or thin

| Plugin | Current state | Needed |
|---|---|---|
| `plugins/gitlab/` | No doc at `features/gitlab.md` | Doc covering the in-app GitLab plugin UI (distinct from the `architecture/gitlab-integration.md` deployment angle). [M] |
| `plugins/langfuse/` | No doc at `features/langfuse.md` | UI surface doc for the Langfuse plugin (distinct from the observability infrastructure doc that lives in `concepts/langfuse-observability.md` until moved). [M] |

### Architecture-level coverage gaps

| Topic | Why missing | Suggested home | Size |
|---|---|---|---|
| CI workflow | `.github/workflows/ci.yml` defines the gate pipeline (commit-lint, frontend-checks, rust-tests, binding-drift, command-name-drift, i18n drift) but no user-facing doc explains which checks block merges or how to fix common failures. | `devops/ci-workflow.md` (new) | [M] |
| Codegen orchestration | `development/build.md` lists tasks but not the per-task 60s timeout (`CODEGEN_TIMEOUT_MS`), parallel execution model, or task list (`commands`, `i18n`, `connectors`, `checksums`, `host-check`). | Expand existing `development/build.md` Codegen section | [S] |
| MCP setup & troubleshooting | `architecture/mcp-desktop-integration.md` is comprehensive but there's no separate `docs/mcp/setup.md` for end users (Claude Desktop, Claude Code CLI) or `docs/mcp/troubleshooting.md` for connection errors / port conflicts. | `mcp/` (new top-level dir) or `devops/mcp-setup.md` | [M] |

---

## P2 — Recommended-practice docs that don't exist

These are docs that don't track a feature but encode "how we work." They prevent the next agent / contributor from re-deriving the same conventions.

| Topic | Rationale | Size |
|---|---|---|
| Doc-writing style guide | Status banners, line-citation policy (vs section refs), where status terminology lives ("shipped" vs "partial" vs "proposal"). The audit found drifting line citations in `features/events/event-routing.md` because nothing said "don't cite specific line ranges in long-lived docs." | `development/doc-style.md` [M] |
| Design tokens reference | `harness/typography-mapping.md` is a high-value semantic-typography map that's misfiled in `harness/` (which is supposed to be evidence, not reference). Move to `development/design-tokens.md` and expand to cover radius, elevation, and spacing tokens (cross-link `.claude/Design.md`). | [M] |
| Test taxonomy | `tests/regression-test-plan.md` is a test ID inventory; `development/test-automation.md` documents the bridge tooling. There's no top-level explanation of *which* test type to use *when* (Vitest unit vs Playwright e2e via the bridge vs Rust integration tests vs MCP smoke tests). | `tests/taxonomy.md` [M] |
| Error handling pattern | CLAUDE.md mentions `toastCatch` / `silentCatch` / `resolveError` / the registry, but the only canonical reference for the registry's pattern is in CLAUDE.md prose. A dedicated doc with examples (when to add a new error-registry pattern, the `_message` / `_suggestion` key shape, the i18n bridge) would help. | `development/error-handling.md` [M] |
| Tauri IPC contract walk-through | Adding a Tauri command requires: write Rust handler, run `generate-command-names.mjs`, call via `invokeWithTimeout`, optionally regenerate ts-rs bindings. CLAUDE.md sketches each step but there's no end-to-end "add a new command" recipe. | `development/tauri-ipc-recipe.md` [M] |
| Skill authoring | `.claude/skills/*` host the in-CLI tooling. There's no doc on writing a new skill, the Phase 0/13 active-runs ritual for skills that materially edit files, or where templates live. (Architect skill has its own `skill.md` but it's the contract, not a tutorial.) | `development/skills.md` [L] |
| Status snapshot for security | The 2026-03-12 P2P security review (`devops/review-security-invisible-apps.md`) ages without a clear refresh cadence. A meta-doc describing how often security reviews run, where new findings go, and the close-out process would help. | `devops/security-review-process.md` [M] |

---

## P3 — Polish & cleanup

### `concepts/README.md` follow-up

Once the SHIPPED-pending-MOVE entries (P0) are migrated:

1. Remove the moved rows from the "Active concept docs" table.
2. Add them to the "Moved out" section with destination paths.
3. The "Doc-rule reminder" banner can be re-checked but should stay — concepts/ tends to drift back into shipped territory if not gardened.

### `architecture/codebase-map.md`

Audit found minor granularity issues — execution backend listed as `src-tauri/src/engine` generically, but is split across `runner.rs`, `scheduler.rs`, `bus.rs`, `chain.rs`, `healing_orchestrator.rs`. Expand the table for navigation help. **[S]**

### `concepts/adoption-creation-unification.md`

Audit could not confirm whether `matrixEditSlice` shipped or remains in-flight. Verify and update the status line in `concepts/README.md`. **[S]**

### `harness/`

After the wave-report subdir cleanup applied in this pass, the remaining root files are:
- `harness-guide.md` (framework doc — keep)
- `harness-scenario.md` (scenario template — keep)
- `goal-judgments.md` (run-decision history — keep)
- `harness-learnings.md` (accumulated findings, dated entries — keep)
- `followups-2026-04-28.md` (deferred technical work from a wave — KpiTile extraction plan, sub_executions migration). **Reclassify**: this is engineering backlog, not harness evidence. Either fold into `BACKLOG.md` or move to `_archive/` with a date. **[S]**
- `typography-mapping.md` — move to `development/design-tokens.md` (see P2).
- `simple-mode-roadmap.md` — move to `features/interface-modes/simple-mode.md` (see P0).

### `tests/`

All test plans and use-case fixtures verified OK in audit. No changes pending. The `tests/uc-large-set/` reference set is allowed to grow; consider a per-file fixture index if it exceeds ~10 files. **[—]**

### Archive-grade snapshots from completed harness runs

The 4 harness wave subdirs (`ambiguity-2026-04-27/`, `bug-hunt-2026-04-27/`, `code-refactor-2026-05-02/`, `dev-experience-2026-04-27/`) were deleted in this pass (88 files). If their findings turn out to have lasting value beyond what was already folded into feature docs, compress one INDEX.md per run into `_archive/harness-runs/<date>.md` summaries. Low priority. **[S]**

---

## Tracking notes

- **Audit baseline:** 2026-05-09. The next pass should re-verify line citations in proposal-style docs (event-routing.md was caught with stale line numbers; persona-matrix-build.md model version was correct; gitlab-integration.md model version was an *example*, now annotated).
- **Recurring drift sources:** absolute line-number citations (drift on every refactor), feature-folder names ("vault" vs "Connections" terminology), model identifiers (`claude-sonnet-4-20250514` vs `claude-sonnet-4-5-20250929`).
- **Stop hook coverage:** `scripts/docs/check-doc-sync.mjs` catches missing doc updates only when `feature-doc-map.json` has the relevant entry. The plugin gap (P0) means changes under `plugins/gitlab/` and `plugins/langfuse/` ship undocumented.
- **Feedback loop:** when this BACKLOG.md grows past ~300 lines, split into per-area files under `BACKLOG/` and keep this file as the index.
