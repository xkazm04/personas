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

**But the run surfaced two follow-on gaps (QA self-diagnosed the first):**
- **G3a — QA gate is advisory, not blocking (sequencing).** Dev Clone *enables GitHub
  auto-merge*, which merges the PR as soon as its **own** local gates pass + GitHub's
  mergeable conditions are met — PR #3 merged at 12:47:18, **~1 min before QA even
  started**. So QA tests an already-merged PR; its approval can't gate anything.
  QA's own recommendation: **add a required status check** so the merge blocks until
  QA's check is green. Alternatively, Dev Clone should NOT enable auto-merge when a QA
  member exists downstream — open the PR and hand off, let QA own the merge.
  (Also: a red GitHub check `undefined:FAILURE` did not block the merge — same root: no
  required check enforced.)
- **G3b — shared-PAT blocks a formal GitHub APPROVE.** Dev Clone + QA both authenticate
  as the same `xkazm04` PAT, so QA cannot formally *approve* a PR authored by the same
  account (GitHub forbids self-approval) — it fell back to a PASS **PR comment** +
  `qa.pr.approved`. A real GitHub approval needs a **distinct QA identity** (separate
  bot account / reviewer PAT).

### G4 — Named domain events are dead (no subscribers)  ·  **P1**
`code_review.completed`, `security.scan.completed`, etc. are emitted and logged
as **"no subscriber matches — marking delivered (no consumers)"**. The real
handoff is `team_handoff.<uuid>` chains; the named events are vestigial. This is
duplicated/inconsistent wiring — wasteful and confusing, and it means anything
that *should* subscribe to a named domain event silently never fires.
**Direction:** either retire the named-event emissions or wire real subscribers;
pick one handoff mechanism (team_handoff chains) and make it authoritative.

### G5 — Release gate blocked by PRE-EXISTING repo debt, not the deliverable  ·  **P1**
Every release attempt HOLDs on red lint from stray/pre-existing files
(`lighttrack.ts`, "10 pre-existing lint errors"). The gate doesn't distinguish
the team's increment from the repo's baseline debt, so the team loops on a
blocker it isn't tasked to fix, and **nothing ships**.
**Direction:** scope the quality gate to the increment (diff-only lint/test), or
add a one-time "clean the baseline" task per repo before the soak, or let the
standards policy treat pre-existing debt as a warn not a hard block.

### G6 — High-severity reviews strand value behind a human  ·  **P1**
18 high reviews accumulate (release-push approvals, security findings). The new
auto-triage correctly leaves these for a human (low/medium only), but unattended
they pile up faster than they clear and the work behind them never lands.
**Direction:** a policy-bounded auto-approval for *defined-safe* classes (e.g.
"approve origin push when gate is green + no open HIGH security finding"), and a
digest so the human triages a batch, not 18 singletons.

### G7 — One-shot goals → the loop idles after one pass  ·  **P2**
Goals are "ship X" — each advances once, completes, marks done; when all 7 are
done the loop has nothing eligible. There's no bridge from the teams' own backlog
(`dev-clone.backlog.candidate`, idea-scanner) back into `dev_goals`, so cycles
don't self-sustain.
**Direction:** feed accepted backlog ideas / open sub-goals into the
goal-advance candidate pool so a team with capacity always has a next step.

### G8 — Duplicate team sets; the re-composed pipeline isn't what ran  ·  **P2**
The linked teams are the **`SDLC2 — X`** set (6 members: no QA Guardian, no
artist) plus 2 older `SDLC — X` (5 members). The **8-member re-composed
`SDLC — ai-bookkeeper`** (Dev Clone + QA Guardian, this session's work) is **not**
project-linked, so the soak never exercised it. Two parallel SDLC team sets is a
real data-quality issue.
**Direction:** decide the canonical set, re-point project→team links to it (or
re-sync the SDLC set to 8 members), and de-dup the other.

---

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
