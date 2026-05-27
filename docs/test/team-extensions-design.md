# Team Extensions — Design (parallel engineer · learning loop · Artist · roll)

Design for the four extensions requested 2026-05-27, grounded in a code analysis
(file:line anchors inline). Status tags: **[design]** not built · **[partial]**
some code · **[done]**.

---

## 1. Artist role (UI/brand visual) — **[design → build]**

The deleted Artist isn't recoverable from git history (no `artist*.json` deletion
found). The closest live template is **`visual-brand-asset-factory`** (connectors:
`codebase`, `image_generation`, `vision`; a structured `design.md` DNA brief).

**Plan:** author `scripts/templates/content/artist.json` (or `development/`) as a
focused product-facing visual role modeled on visual-brand-asset-factory:
- Capabilities: `uc_ui_mockup` (generate UI mockups/wireframes for a feature from
  the product/architecture context) + `uc_brand_asset` (on-brand illustrations).
- Consumes a product/architecture handoff (e.g. `architecture.analysis.completed`
  or a product-backlog event) and emits `design.assets.ready` with asset paths.
- Connectors: `codebase` (read the design system) + `image_generation`.
- In the SDLC team it sits on the **product/front** side (parallel to architect),
  not in the build critical-path — it produces visual artifacts for the feature.

Position in the team graph: a front-of-line product/visual member feeding the
architect, OR a side branch. Decision: add as a **non-blocking side member** wired
off the architect (`architect → artist`, feedback-style) so it never stalls the
build cascade. Revisit once a true product-backlog role exists.

---

## 2. Parallel Dev Clone + environment merge/clean — **[design]**

**Goal:** the architect emits a breakdown of N tasks; Dev Clone implements them in
parallel (multiple concurrent executions of ONE persona), then the team merges the
parallel work into one coherent change and cleans the environment.

### What the engine already gives us
- **One persona, many concurrent executions:** `max_concurrent` (default 4,
  `db/models/persona.rs:481`) is enforced per-persona by `ConcurrencyTracker`
  (`engine/queue.rs:147` `has_capacity`, `:186` `admit`). Extra executions queue by
  priority. So N parallel Dev Clone executions is natively supported (raise
  `max_concurrent` to ≥ expected fan-out).
- **1→N fan-out:** `evaluate_chain_triggers` (`engine/chain.rs:84`) loads ALL chain
  triggers for a source and publishes a separate event per match — 1→N is native.
- **Codebase pin:** `engine/runner/mod.rs:837` resolves `CODEBASE_ROOT_PATH` from
  `design_context.devProjectId` → the real repo.

### The two gaps that block safe parallelism
1. **No per-execution isolation.** The workspace is a STABLE per-persona dir
   (`engine/runner/mod.rs:726` `personas-workspace/<persona_id>`), shared across
   that persona's concurrent executions, and there is **no git worktree/branch per
   execution** — concurrent writes to the same repo collide. (`workspace_sync/` is
   cross-DEVICE persona sync, not execution isolation.)
2. **No join / merge / cleanup.** Chains are 1→1 or 1→N fan-out; there is **no N→1
   join** (wait-for-all) and no mechanism to merge parallel branches or remove
   per-execution worktrees. (`workspace_sync/merge.rs:107` is a 3-way *data* merge
   for sync, reusable as a conflict-resolution reference only.)

### Proposed design (phased)

**Phase A — per-task git-worktree isolation (prompt-level, no engine change).**
Mirror the repo's own parallel-CLI discipline (CLAUDE.md "Use git worktree for ALL
multi-file work"). Dev Clone, in TEAM MODE, when handed a task, works in its OWN
worktree keyed by execution/task id:
```
git worktree add .parallel/task-<taskId> -b devclone/task-<taskId> <baseRef>
# implement + test inside that worktree; commit to the branch
```
Each concurrent execution gets a unique branch/worktree → no collision. This needs
only a TEAM-MODE prompt addition (Dev Clone already has git via shell/file_write).

**Phase B — fan-out the breakdown to N executions.**
Two options:
- **B1 (no engine change):** the architect emits one `architecture.analysis.completed`
  carrying `tasks[]`; the team graph keeps architect→engineer as one edge, and Dev
  Clone's first execution acts as a **dispatcher** that re-emits one
  `devclone.task.assigned` event per task (fan-out 1→N to itself via a self-chain),
  each spawning an isolated implementation execution (Phase A). Uses existing chain
  fan-out + max_concurrent.
- **B2 (engine support):** a first-class "fan-out" trigger that splits an array
  payload into N events. Cleaner but a Rust change. Defer unless B1 proves flaky.

**Phase C — join + merge + clean.**
The missing N→1 join. Pragmatic approach without new engine primitives:
- A **`uc_integrate` capability on Dev Clone** (or the Release Manager) fires when
  the task branches are ready. It can't rely on a native join, so it polls/uses
  memory: each task execution, on completion, records its branch in shared team
  memory (or a `build_queue.json`-style state file); the integrator waits until all
  expected branches are present (bounded), then:
  1. `git merge` each `devclone/task-*` branch into an integration branch (or main),
     resolving trivial conflicts; on real conflict, emit a manual_review.
  2. run the full test suite on the integrated result (must be green).
  3. **clean:** `git worktree remove .parallel/task-*` + `git branch -d
     devclone/task-*` for merged branches (mirrors `npm run clean:worktrees`).
  4. emit `implementation.completed` for the reviewer with the integrated diff.
- The "merge/clean the environment in the team" the user asked for == Phase C.

**Open decision:** the join is the hard part. Cleanest long-term is a small engine
primitive — a **barrier/join trigger** ("fire target once all N sibling chain
events for run R have completed"). Phase C above is the no-engine-change interim;
the engine barrier is the durable fix (tracked, needs a Rust ADR).

**Eval hook:** add a `parallelism` fact to the scorecard (tasks fanned out, branches
merged cleanly, conflicts, orphaned worktrees) — an unmerged branch or orphaned
worktree is a "works-for-weeks" environment-hygiene failure.

---

## 3. Roll extended composition to all teams — **[design → build]**

Apply the proven **6-role + TEAM MODE** composition (+ Artist side-member) to all 7
SDLC teams. Mechanism: re-adopt the updated `sdlc-lifecycle` preset per repo via
`adopt_team_preset(id, parameterOverrides={role:{questionId: projectId}})` (pin q
ids: architect/reviewer/security/release/docs=`aq_target_codebase`,
dev-clone=`aq_codebase` but it maps to a connector credential → pin Dev Clone's
`design_context.devProjectId` manually post-adopt). Then disable the old 5-role
teams (or leave for A/B). Verify each: 6 members, all pinned, handoff wired
(STRUCTURALLY-SOUND), Dev Clone TEAM MODE present. Roll parallel (Phase A/B/C) in a
second pass once built.

---

## 4. Learning loop over multi-turn — **[partial: a real gap to fix + eval to add]**

The user's emphasis: long-running teams must *improve* via lab + memory + human
reviews, and we don't measure it. Analysis findings:

### What works
- **Memory compounds:** `get_for_injection_v2` (`memories.rs:866`) injects tiered
  memory; `access_count` grows on injection (`:983`), lifecycle promotes
  working→active (`:1014`). Memories persist + surface by reuse across runs.
- **Lab prompt improvement is programmatic:** `lab_accept_matrix_draft`
  (`commands/execution/lab.rs:494`) updates `structured_prompt` + versions it
  (`persona_prompt_versions`). Callable from a script.

### The bug (review→learned loop is disconnected)
- `get_recent_resolved(persona_id, days, limit)`
  (`db/repos/communication/manual_reviews.rs:135`) is documented as "inject prior
  review decisions into the next execution so the agent learns from human feedback"
  — but **has ZERO call sites**. Reviews never feed back into runs.
- Resolved reviews do **not** auto-create importance-5 `learned` memories.
- **Fix (product):** in the runner's prompt assembly, call `get_recent_resolved`
  and inject a "## Prior human feedback" block; AND on review resolution (approve/
  reject) synthesize a `learned` memory (category=learned, importance=5,
  source_execution_id). This closes the loop the rubric §2.2 already assumes exists.

### Eval extension (longitudinal, multi-turn)
The rubric §3 trajectory/decay is WITHIN a run; nothing measures improvement ACROSS
runs. Add a longitudinal protocol + dimensions:
- **Learning velocity:** Δ(learned-memory count) and Δ(prompt version) per run.
- **Memory reuse / compounding:** growth in aggregate `access_count` across runs
  (are past learnings actually being used, not just stored?).
- **Review-loop effectiveness:** of reviews raised in run N, how many produced a
  `learned` memory that demonstrably changed behavior in run N+1 (e.g. the same
  defect class not repeated, the same reviewer note not re-raised).
- **Multi-turn:** drive a persona across resumed turns (`--resume`,
  `prompt/resume_prompt.rs`) within a run and score whether turn N+1 uses turn N's
  memory/feedback.
- **Protocol:** run the SAME seed on the SAME team 3–5× in sequence (the
  certification cadence), and score the *delta*, not just each run — a team that
  doesn't improve (or regresses) across repeats fails the "works for weeks" bar even
  if each single run is PRODUCTION.

New harness piece: `scripts/test/longitudinal.mjs` — run N sequential iterations,
snapshot memory/version/review state between them, emit a trajectory scorecard.

---

## Sequencing

1. **Artist template** (§1) — contained. **← next**
2. **Learning-loop fix** (§4 bug) — wire `get_recent_resolved` + review→learned
   memory; the highest-leverage product fix for long-running improvement.
3. **Longitudinal eval** (§4) — `longitudinal.mjs` + dimensions; run a 3× repeat to
   measure improvement.
4. **Parallel Dev Clone** (§2) — Phase A (worktree isolation) + B1 (fan-out) + C
   (join/merge/clean) incrementally; engine barrier as a later ADR.
5. **Roll** (§3) — apply 6-role + TEAM MODE + Artist (+ parallel once built) to all
   7 teams; re-run the corpus + the longitudinal repeats toward certification.
