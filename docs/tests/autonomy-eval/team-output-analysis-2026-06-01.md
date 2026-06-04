# Team Output Analysis — 2026-06-01 (goal-advance soak + self-heal recovery)

Analysis of the autonomous multi-team soak run on `master` from the unattended
Goal-Advancement loop (7 project-linked teams, ~2h cadence) plus the self-heal
recovery that followed. Window: **2026-05-31 19:30 UTC → 2026-06-01 07:40 UTC**.
Read-only observation of `persona_executions`, `persona_events`,
`team_assignments`, `persona_manual_reviews`, `team_memories`/`persona_memories`,
and a qualitative read of execution `output_data`.

> **Headline:** the teams produce genuinely **high-quality, grounded work** — the
> mechanism (scheduler → cascade → queue → learning loop) is sound. The gaps are
> **not** "the agents can't do the work"; they're **plumbing, gating, and
> composition** issues that throttle throughput, strand value behind humans, and
> leave the re-composed (Dev Clone + QA) pipeline unexercised.

---

## 1. Quantitative snapshot

| Metric | Value | Note |
|---|---|---|
| Executions | **104** | 69 completed / 35 failed (66% success) |
| Failure cause | **33/35 = session/usage limit** | 94% of failures are quota, not bugs (now self-healed) |
| Business outcome | 66 `value_delivered`, 1 `precondition_failed`, 2 `no_input` | the completed work self-assessed as value-delivering |
| Cost | **$66.32** | ~$0.64/exec |
| Avg duration | **213 s** (~3.5 min) | per completed execution |
| Learning loop | **145 persona memories + 9 team `decision` memories** | active — personas write durable memory each run |
| Reviews | 10 approved (8 auto-triaged), **22 pending** (18 high) | high-severity correctly left for a human |
| Goals | **5–6 of 7 completed** (after self-heal) | one-shot "ship X" goals; loop idles when all done |

### Per-persona activity (completed / failed)

| Role | Completed | Failed | Read |
|---|---|---|---|
| Solution Architect | **24** | 14 | Dominates — entry/scoper, runs first every cascade + re-scopes |
| Code Reviewer | 15 | 2 | Healthy |
| Security Sentinel | 10 | 8 | High failure (quota) |
| Release Manager | 8 | 4 | Gates hard (see §3) |
| Docs Steward | 7 | 4 | — |
| **Dev Clone (engineer)** | **5** | 3 | **Under-utilized** — the implementer barely ran (see Gap G2) |
| **QA Guardian** | **0** | 0 | **Absent** — not on the linked teams (see Gap G8) |
| Artist | 0 | 0 | Absent — same |

---

## 2. What's working well (don't lose these)

1. **Output quality is high and grounded.** The architect runs in "TEAM HANDOFF
   MODE", reads ADRs and the shared Obsidian knowledge graph, and scopes *one*
   focused task ("Citation extraction toward the citation-validation MVP",
   building on ADR-0004 "not to contradict it"). Dev Clone makes **real code
   changes** (`add the kind field to types.ts`, `rewire verify.ts to import from
   extract.ts`, `create the test file`). This is not eloquent-but-empty output.
2. **Cross-run continuity works.** Personas cite prior decisions, ADRs, and
   memory ("No conflicting prior decisions on citation extraction"), and write
   145 new memories. The knowledge compounds instead of resetting each run.
3. **Release-manager quality discipline is real.** It runs the repo's own lint/
   test gate and correctly **HOLDs** ("do not merge or tag") on a red gate
   rather than shipping a broken trunk — exactly the self-veto the rubric rewards.
4. **The self-heal works** (validated this session): 6/7 quota-deadlocked
   assignments auto-recovered and completed; routine reviews auto-triaged.

---

## 3. How the teams actually work (observed dynamics)

- **Cascade shape:** `architect (scope) → engineer (implement) → reviewer →
  security → release → docs`, driven by **`team_handoff.<persona_id>` chain
  triggers** (40+ distinct handoff events fired + delivered).
- **The architect is the hub:** 21 `architecture.analysis.completed` emitted —
  it scopes far more often than anything downstream completes.
- **Releases mostly DON'T ship:** `release.published`=3 vs `release.blocked`=4 +
  `release.hold`=1. The recurring blocker, across many reviews, is **red lint
  from PRE-EXISTING repo debt** ("merge blocked by red lint", "fix 10
  pre-existing lint errors", "17 errors in untracked `src/lib/lighttrack.ts`").
- **Value strands behind humans:** the 18 *high*-severity pending reviews are
  release-push approvals, security findings (HIGH PII), and "release HELD" gates
  — legitimately human decisions the team can't self-approve.

---

## 4. Gaps to address (prioritized)

### G1 — Quota burst has no pacing/backpressure  ·  **P0**
94% of all failures were session/usage-limit. The scheduler fires more
concurrent agent work than the Claude account budget allows (`MAX_PER_TICK=3`
staggers *team advancement*, but each cascade fans out to many executions).
The self-heal now **recovers** from this, but recovery ≠ prevention — the burst
still wastes a quota window and the first cascade of every wave fails.
**Direction:** quota-aware admission control in the execution queue (pause/space
new executions when the provider signals limit), or a token-budget-per-window
governor feeding the concurrency cap.

### G2 — Architect→implementer funnel is lossy (21 scopes → 4 implementations)  ·  **P0**
The architect scoped 21 times but only 4 reached `implementation.completed`, and
Dev Clone ran just 8× total. Most of the loss is the quota failures (engineer
runs died on session-limit) — the self-heal should materially improve this — but
the architect also **dominates** (38 execs), suggesting re-scoping churn.
**Direction:** re-measure the funnel *after* the self-heal soak; if the architect
still churns, add a "one scope per goal-step, then delegate and stop" guard.

### G3 — Dev Clone commits directly; the PR→QA handshake never fires  ·  ~~P1~~ **PROVEN 2026-06-02**
**RESOLVED — the handshake fires end-to-end on the real repo.** Proof run
(`seed g3/pr-qa-handshake`, pilot team `SDLC — ai-bookkeeper`, 8 members) opened
**real PR #3** on `xkazm04/xprize-ai-bookkeeper` (commit `924637349`, +147/4 files:
ADR-0009 + `src/lib/money/{round-to-cents.ts,round-to-cents.test.ts,index.ts}`):
- Architect `architecture.analysis.completed` (12:43:26) → Dev Clone implemented in
  an **isolated worktree** (8/8 + 206/206 + tsc + lint green), pushed, opened PR #3,
  **emitted `dev-clone.pr.created`** (12:48:17) — the PR path fired (it perceived the
  GitHub connector available despite the `needs_credentials` advisory; the runtime
  resolves a PAT by service-type).
- `dev-clone.pr.created → QA Guardian uc_pr_review` (dispatched 12:48:21) → QA tested
  the PR head in its **own isolated worktree** (194/194, tsc, eslint clean) → **emitted
  `qa.pr.approved`** (12:52:29). Both personas cleaned up their worktrees. The
  worktree-isolation model (the design we discussed) works in practice.

**Two follow-on gaps surfaced (QA self-diagnosed the first) — both now CLOSED + VERIFIED 2026-06-02:**
- **G3a — QA gate was advisory, not blocking (sequencing) → FIXED.** Dev Clone *enabled GitHub
  auto-merge*, which merged the PR as soon as its **own** local gates passed — PR #3 merged at
  12:47:18, **~1 min before QA even started**. Root cause was the policy block's ambiguous
  `Automerge: ENABLED — use GitHub native auto-merge` line, which Dev Clone read as *self*-merge.
  **Fix** (`src-tauri/src/engine/runner/team_context.rs::resolve_standards_policy`): the injected
  STANDARDS & BRANCHING POLICY block now assigns **merge authority exclusively to the QA Guardian**
  — the implementer MUST NOT merge or enable auto-merge (it opens the PR + hands off); QA merges
  only after its tests pass (directly via `gh pr merge` if the repo has no required checks). This
  is the only enforceable gate here because the repo is private/free → **branch protection is
  unavailable** (a GitHub-required-check can't be configured). **Verified** (`seed
  g3/pr-qa-handshake-2`, parseMoney): PR #5 created 14:20:10, stayed **OPEN** when Dev Clone
  finished (no self-merge), QA `uc_pr_review` started 14:20:12 → tested → **merged at 14:22:09**
  (after its gate) → `qa.pr.approved` 14:23:10.
- **G3b — QA had no pinned GitHub connector → FIXED.** Both personas resolved a github PAT by
  service-type (shared, ambiguous). **Fix**: pinned QA Guardian's `design_context.credentialLinks.github`
  to a known-working PAT (`aab5e74b…`) via `update_persona`, so QA reliably has its own connector
  for the merge. (Same `xkazm04` account → no *formal* `--approve` review, but that's moot: the
  repo can't require reviews anyway, so QA *merging* after testing IS the gate. A distinct
  bot-account identity remains a future option if branch protection is ever enabled.)

**Full-cascade side-results (same proof run, first complete 8-member cycle):** all
**8/8 personas completed, 0 failures**, 23 events all delivered, 15 team-memories
written, $8.64, clean quiescence. architect → Dev Clone (PR #3, merged) → QA
(approved) → Code Reviewer → Security Sentinel → Release Manager → Docs Steward all
ran. Two notable positives: (1) **G5 did NOT reproduce** — Release Manager shipped a
real **release PR #4** (`v0.11.0`, version bump + CHANGELOG + notes), holding only the
annotated tag for human approval per policy (a deliberate gate, not a debt-loop). It
did NOT loop on pre-existing lint — though this was a clean increment that touched no
debt files, so G5 may still bite on larger/debt-adjacent tasks (not disproven, just
not exercised). (2) The single human review created was legitimate and correctly
scoped: *"Approve release v0.11.0 + confirm v0.10.0/v0.11.0 merge order."* The
run bundle is at `docs/test/runs/run-2026-06-02T12-39-36-g3_pr_qa_handshake` (scorable
by the cert harness — this run also serves as the plan's "one instrumented validation
run" on the re-composed 8-member team).

### G4 — Named domain events are dead (no subscribers)  ·  ~~P1~~ **ADDRESSED 2026-06-02**
`code_review.completed`, `security.scan.completed`, etc. were emitted and logged
as **"no subscriber matches — marking delivered (no consumers)"**. Investigation
confirmed the cascade runs **100% on `team_handoff.<uuid>` chains** (every cascaded
execution carries `_chain_*` payload); the named events are advisory telemetry with
no real subscribers (self-loops, killed by the bus self-scoping rule).
**Done:** (1) **team_handoff chains documented as the AUTHORITATIVE handoff mechanism**
(`docs/features/execution/README.md` chain.rs entry); named domain events are advisory
telemetry, not triggers. (2) **Retired the 3 cleanest terminal-leaf dead emits** from
their templates — `code_review.completed` (code-reviewer), `security.scan.completed`
(security-sentinel), `docs.sync.completed` (docs-steward) — affects future adoptions.
**Deliberately KEPT** (not purely dead / entangled with load-bearing wiring):
`dev-clone.pr.created` + `qa.pr.approved` (the verified G3 handshake), `implementation.completed`
+ `architecture.analysis.completed` (referenced by the team_context policy block + Dev
Clone's trigger description), and `release.version.bumped` (paired with `release.published`,
which has cross-persona subscribers). Live teams unchanged (template edits are future-only);
existing dead self-loop subscriptions are harmless.

### G5 — Release gate blocked by PRE-EXISTING repo debt, not the deliverable  ·  **P1**
Every release attempt HOLDs on red lint from stray/pre-existing files
(`lighttrack.ts`, "10 pre-existing lint errors"). The gate doesn't distinguish
the team's increment from the repo's baseline debt, so the team loops on a
blocker it isn't tasked to fix, and **nothing ships**.
**Direction:** scope the quality gate to the increment (diff-only lint/test), or
add a one-time "clean the baseline" task per repo before the soak, or let the
standards policy treat pre-existing debt as a warn not a hard block.

### G6 — High-severity reviews strand value behind a human  ·  ~~P1~~ **IMPLEMENTED 2026-06-02**
High/critical reviews accumulated (27 stranded in the live DB): ~12 were technical-status
noise (red build, lint, REQUEST_CHANGES) that policy says should NOT be human-review items;
~15 were genuine PHI/HIPAA/production/origin-push decisions. The old auto-triage skipped ALL
high/critical by severity alone.
**Done** (`subscription.rs` + `settings_keys.rs`): added an opt-in high tier
(`autonomous_review_triage_high`, default-OFF, requires `autonomous_review_triage` too) that
auto-approves a high/critical review ONLY when a deterministic classifier says it's safe:
`high_severity_auto_approvable()` = matches a **safe technical-status allowlist** (lint, red
build, request-changes, missing dependency/migration, mis-sequenced handoff, findings-to-triage)
AND matches **NO business/policy denylist** marker (PHI/HIPAA/PII, production, pricing/payment,
origin-push/force, irreversible/destructive, secrets/credentials, egress). The **denylist wins
on any overlap**, and anything unrecognised stays pending for a human (conservative). Unit-tested
against the real stranded examples (`test_high_severity_auto_approvable_classifier`). Each
high-tier approval records an explicit reviewer-note audit trail.
**Net on live data:** the ~12 technical-status items become auto-approvable; the ~15 genuine
business/policy decisions stay human-gated. (A future enhancement could swap the deterministic
classifier for the existing LLM judge in `auto_triage.rs` for novel-item nuance.)
**LIVE-VERIFIED 2026-06-02:** a read-only dry-run over the 24 pending high/critical reviews
classified 6 → approve / 18 → keep (zero business items approved). Then enabled
`autonomous_review_triage_high`; the first tick auto-approved **4 safe high-severity reviews**
(Bill-Diff E2E ×2, Citation gate REQUEST_CHANGES, Eligibility findings-to-triage) and held all
**20** remaining high/critical (PHI/production/origin-push) pending for a human — matching the
dry-run. (10/tick oldest-first, so the other safe items land on subsequent ticks.)

### G7 — One-shot goals → the loop idles after one pass  ·  **P2**
Goals are "ship X" — each advances once, completes, marks done; when all 7 are
done the loop has nothing eligible. There's no bridge from the teams' own backlog
(`dev-clone.backlog.candidate`, idea-scanner) back into `dev_goals`, so cycles
don't self-sustain.
**Direction:** feed accepted backlog ideas / open sub-goals into the
goal-advance candidate pool so a team with capacity always has a next step.

### G8 — Duplicate team sets; the re-composed pipeline isn't what ran  ·  ~~P2~~ **CLOSED 2026-06-02**
There were **16 teams** — 7 canonical (linked via `dev_projects.team_id`, a mix of 4
`SDLC2 — X` + 3 `SDLC — X`) + 9 orphans (8 SDLC duplicates + 1 unrelated workspace team).
The canonical `SDLC — ai-bookkeeper` (f8a981a8, this session's 8-member G3 work) was
team-disabled while an orphan duplicate `SDLC2 — ai-bookkeeper` (b0414f59, enabled, a
stale awaiting_review assignment) shadowed it.
**Done (full purge, live DB via bridge):** (1) enabled the canonical `SDLC — ai-bookkeeper`
(f8a981a8) so the autonomous loop uses the team carrying all G3 work; (2) deleted the **8
orphan SDLC teams** (`delete_team`, cascading members/connections/memories/assignments) incl.
the shadow b0414f59; (3) purged the **43 orphaned duplicate personas** (`delete_persona`,
which cancels running execs + cleans subscriptions). Verified: **7 canonical teams remain
(all enabled), 112→69 personas, ZERO dangling executions/subscriptions/memberships.** Zero
persona overlap with canonical confirmed before deletion. The unrelated "Product & Engineering"
team was left (out of scope).
**Hardened (commit pending):** `dev_projects.team_id` has no FK to `persona_teams`, so deleting a
canonical team would leave a dangling project→team pointer. Rather than the riskier FK migration
(recreating the core `dev_projects` table), `delete_team` now **refuses to delete a team that is a
project's canonical team** (repo helper `is_linked_to_dev_project` + command guard in
`commands/teams/teams.rs`) — re-point or unlink the project first. Orphan-team deletion (the dedup
path) is unaffected since orphans aren't `dev_projects.team_id`-linked.

---

## 4b. Intermediate-check findings (2026-06-03 full-fleet run) — FIXED

A second full-fleet run (all 7 canonical teams, seeded via backlog scans) surfaced three
NEW gaps beyond G1–G8, all now fixed:

- **GAP-A — broken goal decomposition (the keystone).** Every goal decomposed into
  `scope → review → security → docs` with **no implementation step**, and `goal_advance.rs`
  passed `depends_on_indices: None` for every step → the orchestrator launched all steps at
  once, out of order → reviewers/security/docs ran against work that didn't exist
  (`precondition_failed` / `blocked_dependency`); budget burned reviewing nothing.
  **Fixed in a 4-part stack** — and the live verification revealed each layer:
  1. `1d339f383` — steps chain LINEARLY (`depends_on` the previous) in both the to-dos and
     decompose paths, and the `decompose_goal` prompt MANDATES an implementation step before
     any review/security/docs.
  2. `8bb903e7b` — pin the implement step to the engineer (Dev Clone), because the decompose
     LLM still sometimes suggested the architect and the orchestrator honors a pre-assigned
     persona verbatim.
  3. `4425a9fdb` — **the root**: the eligibility filter hard-required `setup_status == "ready"`,
     which EXCLUDED the implementer (Dev Clone), QA, and Release from the candidate pool — they
     sit at `needs_credentials`, an *advisory* badge (runtime resolves creds by service-type;
     G3 proved Dev Clone opens real PRs despite it). With no implementer among the candidates,
     decompose *had* to build implementer-less pipelines. Now `ready` + `needs_credentials` are
     both usable.
  **VERIFIED LIVE** (manual `advance_team_goal` on ai-bookkeeper after the full stack): the goal
  decomposed into `Dev Clone: write tests → Code Reviewer: review → QA Guardian: test+merge`,
  chained `depends_on`, implement step on Dev Clone (not the architect), QA now in the pipeline.
  Resolves the release-before-increment symptom too.
- **GAP-B — QA Guardian timeout backwards.** QA's `uc_pr_review` does the heaviest op (fresh
  `npm install` + full suite in an isolated worktree) but adoption gave it the LOWEST
  `timeout_ms` (300000/600000) while Dev Clone had 1200000; QA execs timed out at 300s.
  **Fixed** (`938be21e1`): template + all 7 live QAs raised to the 1200000 (20-min) ceiling.
- **GAP-C — wrong repo URL (the "404 PAT").** 5 of 7 canonical projects had `github_url = NULL`,
  so the repo URL was guessed as `xpri**c**e-*` while the real repos are `xpri**z**e-*` → 404,
  misreported as a PAT-permission failure. **Fixed** (live DB): set all 7 projects' `github_url`
  from their verified local `origin` remotes. Not a credential problem.

(Open: GAP-D — the Visual Brand artist sits on every SDLC team but has no image connector, so
it no-ops each cascade. Off the dev critical path; optional cleanup = drop it from the
`sdlc-lifecycle` preset + re-sync.)

---

## 4c. Output-quality gap analysis (2026-06-03 post-fix run, ~12:35–20:30 UTC)

Full-output sweep (executions, step outputs, real GitHub PRs, goal movement, event flow,
memories) of the run that carried the complete GAP-A stack. **Headline: the fleet genuinely
ships** — 22 `dev-clone.pr.created`, 11 `qa.pr.approved`, real merged PRs on all 7 repos,
4 goals driven to 100% with merged code, and the roles are individually disciplined (Release
refuses false bumps and emits `release.hold`; Docs verifies before editing; QA tests in a
worktree and bounces bad PRs with `changes_requested`). The gaps below are the next layer.

### T1 — Dual-driver redundancy (architecture; the big one) — FIXED (405e50435)
The **event-chain subscriptions** (team_handoff connections) and the **assignment DAG**
(goal-advance steps) drive the *same work in parallel with no mutual awareness*. Proof: at
19:04 two Dev Clone executions started simultaneously for the same ADR-0009 increment — one
`_chain_depth:1` (handoff) and one `assignment_id:183ee7db` (step) — producing the
near-identical competing PRs ai-paralegal **#6 and #7**; ai-bookkeeper **#15 (open) duplicates
already-merged #13**. Volume: **181 chain-driven vs 71 assignment-driven** executions — the
chain dominates, and it carries both the duplicate implementations and most verification
churn. *Direction:* one driver per work item — when a step execution emits events, suppress
team-handoff routing for it (the engine knows the execution is step-driven via `input_data
.assignment_id`), or retire chain connections on goal-advance-managed teams (chain becomes
the fallback for non-goal work).
  **Fixed** (`405e50435`): `evaluate_chain_triggers` suppresses `team_handoff.*` triggers when
  the source execution is an assignment step (detected via `assignment_id`+`step_id` in its
  input); named-event subscriptions still route. New `handoffs_suppressed` metric + tests.

### T2 — No context flow between chained steps (teamwork) — FIXED (4c559526c)
`build_step_input` passes only `step_title` + `step_description`; a predecessor's
`output_summary` is stored but **never forwarded**. `depends_on` gives *ordering*, not
*context* — the reviewer/QA must rediscover what the implementer did from repo state, and
with several open PRs they can pick the wrong one. *Direction:* include the depends_on
predecessors' `output_summary` (and extracted PR URL/branch) in the next step's input.
  **Fixed** (`4c559526c`): `run_step` collects direct predecessors' `output_summary` (capped
  1500 chars each) and embeds them as `predecessor_outputs` in the step input, which the prompt
  pipeline renders into the persona's "## Input Data" section.

### T3 — Over-triggered verification roles (persona design / cost) — FIXED
Release Manager ran **51×/$36.81** and Docs Steward **51×/$30.53** — more than any builder —
with most runs correctly concluding "no action needed" (`no_input_available`). They are
woken by *every* cascade event rather than by release/docs-worthy conditions. Compounding:
**20 `release.version.bumped` + 13 `release.published` in ~8h** (v0.13.1→v0.13.2 hours
apart) — there is no release-cadence policy, so every merge cascades into a bump+publish.
**Fixed (3 prongs):** (1) team-handoff chains are now SINGLE-HOP — a chain execution
(depth ≥ 1) no longer fires further handoffs, killing the release→docs→release depth-2..4
verification spirals (multi-step flow belongs to the DAG); (2) the redundant
`dev-clone.pr.created → uc_pr_review` listeners on the 7 canonical teams were disabled
(enabled=0, reversible) — the mandated QA STEP + bounce loop is the one QA path, ending
double-QA per PR; (3) the policy block gained a release-cadence rule (patch-bump per shipped
increment OK; tag/publish ≤ 1/day, batch the day's increments; NOTHING if nothing merged)
and decompose gained an optional post-merge RELEASE step (mechanical lane) — without it the
single-driver stack would never have released at all.

### T4 — Goal progress is binary; Board checklists empty (goal fulfillment) — FIXED
Progress only moves 0→100 when the assignment completes — in-flight goals sit at 0% with
half their steps done (poor visibility; Portfolio under-reports). Decomposed goals carry **no
`dev_goal_items`**, so Board cards show no checklist. **Fixed:** goal_advance now mirrors decomposed
steps into `dev_goal_items` (the Board card gets a live checklist; the next advance of the
goal takes the open-items path verbatim), and the orchestrator's per-step done path checks
the matching to-do off + calls `apply_resolved_goal_progress` — progress moves live as steps
complete (never regresses; manual overrides still win; done only at a composed 100).

### T5 — Open-PR backlog hygiene (goal fulfillment)
~9 PRs sit OPEN across the repos — duplicates (#15 vs merged #13), superseded attempts, and
unmerged `chore(release)` PRs — while their goals are already marked done. Nothing owns
driving open PRs to merge/close. *Direction:* give QA or Release an open-PR sweep
responsibility (close superseded, merge approved), and/or gate goal-done on no open PRs from
its branches.

### T6 — Learning loop dormant (teamwork) — RE-DIAGNOSED + CLOSED
Original diagnosis ("1 team memory all run; auto-triage bypasses the memory pattern") was
**partly wrong** — the snapshot predated the writes. Re-measured: auto-triage DOES route
through `manual_reviews::update_status`, whose learning block wrote **12 decision memories
overnight** (14 approvals, ~2 dedup-suppressed); personas wrote 391 L1 memories; and the
read side works — `get_for_injection` puts the top-15 ledger entries into every team
member's prompt ("Team Shared Knowledge"). The one genuinely missing write: **QA bounces**.
**Closed:** `trigger_qa_rework` now writes each bounce to the team ledger as a `constraint`
(round-numbered title, verdict content, importance 7) — every bounce becomes a durable
lesson the whole team reads on its next run.

### T7 — Design hygiene (small)
Artist no-op ×19 (GAP-D); Dev Clone `template_category='devops'` (mis-set — the engineer pin
works via name fallback; fix the data); branch naming drifts (`dev-clone/*` vs `devclone/*`
vs `qa/*`) — `standards_config` naming rule exists but isn't enforced in-prompt consistently.

---

## 4d. PR + goal-state review (2026-06-04 morning, app stopped — stable snapshot)

Full review of all open PRs (29 across 7 repos) and the goal ledger (50 goals) after the
overnight run, gathering the larger issue sample before the next campaign. **T1/T2 confirmed
at scale overnight**: 158 handoff-suppression breadcrumbs, zero new duplicate PRs (all
remaining dups predate the fix), 72 executions carried `predecessor_outputs`; the night
shipped 30 goals / 26 PRs / 22 QA-merges / 193-vs-1 completed-vs-failed for $210.

**Campaign delivery funnel: 51 `dev-clone.pr.created` → 35 `qa.pr.approved` (69%) →
13 `qa.pr.changes_requested` → 0 re-works.** Grant-writing + local-seo lanes are fully clean
(0 open PRs); merged work is substantial (+323/+404-line real increments). The leaks:

### V1 — QA bounce is a dead end (CRITICAL; the feedback loop never existed) — FIXED
All **13** `qa.pr.changes_requested` events across the whole campaign produced **zero**
Dev Clone follow-ups — there are **0 subscriptions** for the event, and `wire_team_handoff`
explicitly wires only non-feedback edges, so the preset's qa→engineer feedback connection was
never materialised. Not a T1 regression — it never worked. Every bounced PR strands open.
**Fixed (orchestrator QA fix loop):** when a QA step's execution emits
`qa.pr.changes_requested`, the step is NOT marked done — the orchestrator resets the
implementer (QA verdict forwarded as `rework_feedback` + fix-the-SAME-PR-branch instruction)
and the QA step to pending; the DAG re-runs implement→QA. `MAX_QA_FIX_ROUNDS=2` (counted on
the QA step's `retry_count`) then fails the step → assignment parks at `awaiting_review` for
a human. Decompose now also MANDATES the QA test+merge step, so all goal work flows through
the loop. Step `output_summary` switched head→tail so the forwarded verdict is the actual
conclusion, not the narrative opening. (Note: subscription-path QA bounces — non-step,
chain-era — remain dead-ends by scope; goal work no longer uses that path.)

### V2 — "Done" ≠ delivered (CRITICAL; goal integrity) — FIXED (same mechanism)
**48/50 goals are `done` while ~16 of the campaign's 51 PRs never merged** — 11
implementation PRs sit open (incl. the bounced ones). The QA step "completes" by bouncing
(it did its job), the assignment completes, the close-loop marks the goal done — so a goal
counts delivered while its code never reached main (e.g. Medical Bill's editor-extraction
goal: done 06-03 17:47, its PR #3 still open). **Fixed via the V1 loop:** an assignment can only
complete on a clean QA pass (a bounce re-queues; the cap escalates to a human instead of
silently completing) — so goal-done now implies merged-on-main for decomposed work.

### V3 — Release-PR lane unowned + self-superseding — FIXED (mechanical lanes)
**10 open `chore(release)` PRs** (8 on ai-bookkeeper alone: v0.10.0→v0.14.0, oldest from
06-01). QA's merge gate triggers only on `dev-clone.pr.created`, so release PRs have no merge
owner; each new bump obsoletes the previous PR (same package.json/CHANGELOG lines — only the
newest, #22, is even MERGEABLE). **Fixed:** root cause was the policy block itself ("never commit to base" + "QA sole merge
authority on ANY PR" left Release/Docs no legal path). The policy now scopes QA's authority
to CODE PRs and adds MECHANICAL LANES — Release (bump/CHANGELOG/tags) and Docs (README/docs
syncs) commit directly to the base branch, never via PRs; own-lane stale PRs may be
self-merged/closed. Backlog disposed: 10 release PRs closed, 3 docs PRs merged + 5 closed
(conflicted the moment the first sync landed — the self-superseding pattern observed live).
Open PRs 29 → 7, all legitimate in-flight code increments.

### V4 — Docs-PR lane unowned (same shape) — FIXED (same mechanism)
**8 open docs PRs** (apprenticeship ×4, paralegal ×3, medical ×1) — distinct, small, useful
syncs that nobody merges. Same ownership fix as V3.

### V5 — Stacked-PR foundations rot
ai-paralegal: FeatureStore foundation **#3 open since 06-03 09:18**, with #4 (migration) and
#9 (GCS adapter, overnight) stacking on top — matching the day-old "foundation UNTRACKED
blocks CI/merge" incident. Teams keep building on unmerged bases; the stack deepens daily.
*Direction:* the V1/V2 fix largely resolves this (bounced/stuck PRs get re-worked instead of
bypassed); plus an architect-prompt rule: don't scope increments atop an unmerged PR.

### V6 — Shared PAT degrades the QA verdict (G3b resurfaced with data)
QA's formal `REQUEST_CHANGES` review is **rejected by GitHub** ("review API rejects
REQUEST_CHANGES from the authoring PAT") because QA and Dev Clone share one PAT — the verdict
lands as a plain comment, invisible to merge tooling. *Direction:* a second PAT (bot account)
for QA, or accept comment-verdicts as the gate signal (the in-app event already is).

### V7 — One-time cleanup backlog (pre-fix leftovers)
Bookkeeper #10/#12 (duplicate test PRs, pre-T1) + #15 (dup of merged #13); immigration #16
(re-do of closed #15); medical #1/#2 (06-01-era, predate the QA gate). Manual sweep: keep the
better twin, close the rest.

### V8 — App-stop orphans (minor)
2 assignments were `running` when the app stopped (LogEvent sink; LLM guardrails decorator) —
one with a half-skipped step list. Verify auto-resume picks them up cleanly on next start.

> Positives worth keeping: goal-title near-duplicates = **0** (backlog promotion doesn't
> repeat itself); merged increments are real, tested code; QA self-detected and closed one
> duplicate-of-shipped-code PR; two of seven repos have perfectly clean PR lanes.

## 5. Recommended next steps (in order)

1. **P0 — Re-run the soak with the self-heal ON for one full window**, then
   re-measure G1/G2 (does recovery lift the funnel + success rate?). Cheap, high
   signal; partly already in flight.
2. **P0 — Quota-aware admission control** (G1) — the root throughput limiter.
3. **P1 — Prove the PR→QA handshake** (G3 + G8): re-point one project to the
   8-member team, nudge Dev Clone to open PRs, watch QA react end-to-end.
4. **P1 — Fix the release gate** (G5, diff-scoped) and **retire dead events**
   (G4) — both unblock real shipping and reduce noise.
5. **P1/P2 — Policy auto-approval for safe review classes** (G6) and **backlog→
   goal feedback** (G7) so the loop self-sustains without a human babysitting it.

> Net: the agents are good; the **pipeline around them** (quota pacing, the PR/QA
> handshake, the release gate, event wiring, review auto-approval, goal
> regeneration) is where the next round of work pays off.
