# Backlog Memory Loop — unify ideas, memory, goals, and execution

**Status:** planned (no phase started)
**Author session:** 2026-07-24 (Mastermind cross-module analysis)
**Executes across:** `sub_scanner` / `sub_triage` / `sub_mastermind` (frontend), `idea_scanner.rs` / `memory_reflection.rs` / `task_executor.rs` / `db` (Rust)
**Companion doc:** `docs/features/plugins/dev tools/mastermind.md` (§10 actionable layer)

## 1. Problem

Three loops run disconnected today:

1. **Idea scans generate an isolated backlog.** The LLM scanner path (`run_idea_scan` → `repo::create_idea`, `src-tauri/src/commands/infrastructure/idea_scanner.rs:333-905`, INSERT at `src-tauri/src/db/repos/dev_tools.rs:~2874`) writes `dev_ideas` with **no `dedup_key`** and no check against live pending/accepted ideas. Its only protections are soft (rejected titles fed back into the prompt at `idea_scanner.rs:447-456`; `IDEA_BACKLOG_CAP = 15` at `engine/dispatch.rs:200`). Re-scans re-surface near-identical live ideas. The reflection→ideas bridge (`memory_reflection.rs:556-640 write_product_findings`) and Strategist `propose_backlog` share the gap (soft title dedup only).
2. **The machinery to fix it already exists — for the other path.** The sensor findings spine mints stable `dedup_key`s per emitter (`sub_triage/findings/emitters.ts`), `repo::create_finding` (`db/repos/dev_tools.rs:~2892`) is **idempotent across all statuses including rejected**, `list_finding_dedup_keys` backs bulk pre-filtering, `idx_dev_ideas_dedup(project_id, dedup_key)` exists (migration `incremental.rs:~4469`), and findings carry verify states. Two writers, one table, opposite disciplines — **split-brain**.
3. **Execution is memory-blind.** `task_executor.rs gather_task_context` (`:56-132`) hydrates prompts from the linked idea + goal + contexts only. Accept/reject decisions ARE recorded as team memories (`record_idea_decision`) and injected into *scan* prompts (`idea_scanner.rs:462-472`) — but never into *execution* prompts, and execution outcomes never become memories (only `dev_goal_signals`, `task_executor.rs:326-367`). A constraint learned at triage is forgotten at execution.

Additional gaps: idea statuses are `pending|accepted|rejected` only (`sub_triage/IdeaTriagePage.tsx:46`) — **no `archived`, no aging**; memories are persona/team-scoped only (`memory.rs:258-332` — anchors `persona_id`/`use_case_id`/`home_team_id`, no `project_id`) so **teamless projects have no memory at all**; ideas link to goals only transitively through tasks (`DevTask.source_idea_id` + `goal_id`, `dev_tools.rs:687-688` — no `goal_id` on `dev_ideas`).

## 2. Doctrine (adopted from the references)

- **From Brainiac** (github.com/xkazm04/brainiac) — principles, not infrastructure: ONE write gate for every memory/backlog producer; review/promotion lifecycle; per-fact provenance; disputes adjudicated, not overwritten; **derived surfaces are projections over canonical records, never a second source of truth**. We implement these on the existing SQLite tables — no new service.
- **From `/vibeman`** (`C:\Users\kazda\kiro\vibeman\.claude\skills\vibeman\SKILL.md`) — the Pipeline-C decision loop: *user picks ONE scope → skill auto-selects 1–3 best-fit scanners → hard-capped backlog (≤5/scanner) → per-idea accept/reject handshake → implement ONLY the approved scope*; wave discipline for follow-ups; learning write-backs after every run (its `harness-learnings.md` / `goal-judgments.md` become DB memories here). Also its already-existed check: auto-generated ideas are likelier than hand-written goals to propose what already exists.
- **Sequencing law:** memory before volume. Parametrized/autonomous scanning (Phase 4) multiplies idea production; it lands only after dedup + lifecycle (Phase 1) exist, or we industrialize duplication.

## 3. Phases

Each phase is independently shippable and gate-verified (`cargo check --features desktop` + relevant `cargo test`, `tsc`, vitest, i18n strict where UI strings are added). Rust migration cautions: new ALTERs go **inside `run_incremental` after their table's CREATE** (the tail of `incremental.rs` belongs to `ensure_composite_fires_table` — appending there breaks fresh DBs), and any step must survive the test binary's dropped-tables quirk (`has_table` guard).

---

### Phase 1 — Backlog memory spine (dedup + lifecycle unification)

**Goal:** every `dev_ideas` writer goes through one idempotent gate; ideas age instead of rotting.

1.1 **Dedup keys for LLM-scanner ideas.** Extend `repo::create_idea` (or introduce `create_idea_deduped` and migrate callers) to accept and enforce `dedup_key` with the same all-statuses idempotency guard as `create_finding`. Key derivation for scanner ideas (no natural sensor id): `scan:<agent_key>:<context_scope>:<normalized_title>` where normalized = lowercase, alphanumerics collapsed, stopwords dropped. This catches exact-ish re-surfacing; semantic near-dupes are handled by 1.2. Apply the same gate to `write_product_findings` (reflection bridge) and `propose_backlog`.
   - *Design decision (recommended: B).* (A) exact normalized-title keys only; (B) A **plus** feeding the scan prompt the live pending/accepted titles for this project/scope (mirror of the existing `rejected_titles` injection at `idea_scanner.rs:447`) with an explicit "do not re-propose these" instruction. B costs prompt tokens but catches paraphrases the key cannot; the existing injection plumbing makes it a ~20-line change.
1.2 **Duplicate adjudication in triage.** The Strategist backlog triage (`run_backlog_triage`, `idea_scanner.rs:1072-1216`) already rejects duplicates it notices; make that formal: give it the dedup-key clusters + instruct it to mark `rejected` with `rejection_reason: "duplicate of <id>"` — provenance-preserving (Brainiac's contradiction-adjudication analogue).
1.3 **`archived` status + aging.** Add `archived` to the idea status vocabulary (frontend type `IdeaTriagePage.tsx:46`, Rust validation, triage filters default to excluding it). Add a reversible aging pass mirroring `run_decay_forgetting` (`memory_recall.rs:434`): pending ideas older than N days (default 30, configurable) with no linked task → `archived`. Archived ideas **keep their dedup_key active** (the idempotency guard already scans all statuses) so archival never reopens the duplication door. Surface: an "Archived" filter chip in triage; count in the scanner page history area.
1.4 **Frontend surfaces.** Triage deck + Mastermind `IdeaScanPopover`: show "n suppressed as duplicates" after a scan completes (the scan result already returns counts — extend with `deduped` count) so suppression is visible, not silent.

**Acceptance:** running the same agent scan twice in a row on an unchanged repo produces 0 new pending ideas the second time (all suppressed or adjudicated); an idea untouched for N days appears under Archived and can be restored; `cargo test` covers the gate (parametrized: same key × each existing status → no insert).
**Scope estimate:** ~2 Rust files (repo + idea_scanner + small migration none/status-check only), ~4 frontend files. No schema change needed (columns exist) beyond status validation.

---

### Phase 2 — Memory in the loop (project anchor + execution-path memory)

**Goal:** decisions and outcomes are remembered per **project**, and the executor reads them.

2.1 **Project-scope memory anchor.** *Design decision (recommended: A).* (A) Add nullable `project_id` to `persona_memories` (+ index), written by `record_idea_decision` and the new outcome writer; recall gains an optional project filter. (B) Auto-provision a hidden home team per teamless project and reuse `home_team_id`. A is honest and cheap (one ALTER inside `run_incremental` with `has_table` guard + repo/binding regen); B contorts the team concept and leaks placeholder teams into team UIs.
2.2 **Decision memories become project-anchored.** `record_idea_decision` (accept → decision memory, reject → constraint memory) stamps `project_id` resolved from the idea. Existing team scoping stays when a team exists — dual-anchored.
2.3 **Executor reads memory.** `gather_task_context` (`task_executor.rs:56-132`) injects a budgeted selection (reuse `pack_by_budget_relevance`, `memory_recall.rs:290`) of project + team memories — constraints first — into `build_task_prompt`. Cap small (~1.5k chars) so task prompts stay lean.
2.4 **Executor writes outcome memory.** On terminal task status (where goal signals are written, `task_executor.rs:326-367`): one compact outcome memory (`learned` category) — task title, source idea, result, 1-line takeaway if the run produced one. This is vibeman's `harness-learnings.md` write-back, landing in the DB. Provenance via `derived_from` = task id.
2.5 **Scan prompts read outcomes.** The scan-prompt injection block (`idea_scanner.rs:462-472`) adds recent project outcome memories alongside the team ledger — closing the arc: outcomes inform the next scan.

**Acceptance:** reject an idea with a reason → dispatch a related task → the task prompt (inspect via the runner's stored prompt) contains the constraint; complete a task → a `learned` memory exists with `project_id` + `derived_from`; unit tests for the recall filter and the outcome writer; fresh-schema + incremental migration tests green.
**Scope estimate:** 1 migration step, ~4 Rust files (memories model/repo, task_executor, idea_scanner, memory_recall), bindings regen, minor Memories-UI filter (optional this phase).

---

### Phase 3 — Idea ↔ Goal bridge

**Goal:** the scanner backlog and the teams' goal backlog become one system.

3.1 **`goal_id` on `dev_ideas`** (nullable, migration + binding). Set when an idea is spawned in service of a goal, or linked during triage.
3.2 **Promote-to-goal triage action.** In the triage deck (and the Strategist's vocabulary): select 1+ accepted ideas → create a `dev_goals` row (title synthesized, `context_id` from the ideas, ideas stamped with the new `goal_id`). The assignment orchestrator (`team_assignment_orchestrator.rs`) then decomposes it exactly like any hand-written goal — no orchestrator changes.
3.3 **Strategist goal-awareness both ways.** `run_backlog_triage` already relates ideas to open goals (`apply_goal_relation`, `idea_scanner.rs:956-985`); extend its output contract with an optional `promote: [idea_ids…]` suggestion the UI offers as a one-click action (never auto-fires).
3.4 **Mastermind surface.** The Goals dimension popover (`GoalListPopover`) gains per-goal "n linked ideas"; the Ideas popover shows "linked to goal <title>" on relevant rows. Read-only this phase — the click-through action layer stays deferred as documented.

**Acceptance:** promoting 2 ideas creates a goal visible in Goals hub + Mastermind Goals cell count; the tasks created from those ideas carry both `source_idea_id` and the goal's id; goal completion rolls up progress exactly as hand-written goals do.
**Scope estimate:** 1 migration, ~3 Rust files, ~4 frontend files.

---

### Phase 4 — Parametrized scan flow (the Pipeline-C shape), scanner module + Mastermind

**Goal:** "point at a scope, decide, run, handshake, dispatch" as a first-class flow — replacing today's manual agent-picking as the *primary* path (manual stays available).

Inventory first: `run_scan` already supports `contextId`/`contextIds`/`targetCount` (`devTools.ts:765`) and the ScanConfigModal exposes scope + granularity; auto-scan already matches agents per context (`matchAgentsToContext`). What's missing is the decision layer and the loop:

4.1 **Scanner auto-selection.** Port Pipeline C's C2: given a scope (context group / context set), pick 1–3 best-fit agents from `SCAN_AGENTS` using the existing `SCAN_MATCH_RULES` (`ideaScannerHelpers.ts:12`) + category heuristics; display the choice with one-line rationale + cheap override (not a blocking prompt). Hard caps: ≤3 agents, `targetCount` ≤5/agent (vibeman's reviewable-backlog rule).
4.2 **The handshake flow.** New "Scan & decide" mode in `IdeaScannerPage`: scope pick → auto-selection → run (existing pipeline, Phase-1 dedup now protecting volume) → **review pane filtered to this run's scan ids** (vibeman C4's stale-backlog lesson) → accept/reject each (writes decision memories per Phase 2) → accepted set offered for dispatch (existing `dispatch.ts` fleet/runner arms; tasks memory-informed per Phase 2).
4.3 **Followup waves.** After dispatch, group accepted ideas by theme (category + context) into waves of ≤7 (vibeman B6 discipline) rather than one-per-task free-for-all; surface wave progress via the existing `DevPipeline` stages.
4.4 **Mastermind surface.** `IdeaScanPopover` graduates: top section = "Scan & decide" (one click runs auto-selection scoped to that project; a compact handshake list renders in the popover or routes to the scanner page pre-filtered); the current all-agents grid remains below as the manual path. Freshness cell, busy pulse, and DevScan recording all keep working unchanged (dispatch stays on the canonical recorded pipeline).
4.5 **Run learning write-back.** After each scan-and-decide run: one `learned` project memory summarizing the funnel (`N generated → A accepted → R rejected(+reasons distilled) → D dispatched`) — vibeman's `goal-judgments.md` loop, feeding both future auto-selection (downrank agents whose ideas this project keeps rejecting — the Agent Scoreboard's accept-rate data already exists to seed this) and future scans (via 2.5).

**Acceptance:** from Mastermind, one click on a project's Ideas cell → auto-selected capped scan → handshake → dispatch, with zero duplicate pending ideas created and decision + funnel memories written; the Idea Scanner page offers the same flow standalone; i18n strict clean for all new strings (this flow is user-facing — no COPY-const shortcut on the scanner page; Mastermind-internal popover copy may stay per module convention).
**Scope estimate:** largest phase — ~6 frontend files (scanner), ~3 (mastermind), Rust only if the funnel memory writer needs a command (prefer reusing existing memory-write commands).

## 4. Cross-cutting

- **Order:** 1 → 2 → 3 → 4 strictly (1 unblocks 4's volume; 2 feeds 4's memories; 3 is independent of 4 but its promote action wants 2's decision memories for provenance).
- **Docs:** each phase updates `mastermind.md` §10/§12 and `dev-tools.md` scanner/triage sections in the same change (Stop-hook enforced for sub_mastermind; do it manually for scanner).
- **Tests:** every Rust behavior change lands with unit tests next to the existing suites (`__tests__/` for frontend derive logic); the dedup gate and aging pass are the critical ones.
- **Non-goals:** no new memory service (Brainiac stays doctrine), no embedding-based semantic dedup in Phase 1 (revisit only if normalized-key + prompt-injection measurably under-catches), no auto-promotion of ideas to goals without a human/Strategist-suggested + user-confirmed step, no fleet-lane scan execution (unchanged deferral — recording first).
- **Metrics of success:** duplicate rate of a repeat scan (target ~0), pending-backlog age distribution (no unbounded rot), % of dispatched tasks whose prompt contained ≥1 memory, scan→accept rate trend per agent per project.
