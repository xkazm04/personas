# Idea-triage funnel — gate → skill → orchestrate

> Status: v1 design, 2026-08-10. Decided with the operator (select round: hybrid funnel,
> full-split review on run #1, result.json ingest door). First corpus: the 58 pending
> `dev_ideas` as of this date.

## Problem

The app accumulates `dev_ideas` faster than a human can swipe them (58 pending across 8
projects at design time). Manual triage via the TriageCard deck is high-quality but does
not scale, and Athena's chat op set cannot decide idea cards directly
(`backlog_apply_triage` is deliberately button-produced only — `dispatcher.rs`
"a deliberate later step"). Meanwhile a per-item "just dispatch a fleet to implement it"
approach wastes sessions: profiling the live corpus showed ~1/3 of pending items are not
implementable tickets at all (KPI-sim observations, practice-adoption proposals that
belong to the knowledge door).

## The funnel

```
            all pending ideas (N)
                    │
   ┌────────────────▼─────────────────┐
   │ STAGE 1 — GATE (Athena, cheap)   │  batch classify + score, grep-level
   │ classify → policy → verdict      │  spot-checks only; no implementation
   └───┬──────────────┬───────────┬───┘
       │ accept       │ decline   │ reroute / close
       ▼              ▼           ▼
  verdicts result.json      one decline report      practice door /
       │              to operator (manual        observation close
       ▼              re-evaluation)
  INGEST DOOR (one gated approval,
  backlog_apply_triage — one click = batch)
       │ on approve: verdicts land with CAS semantics
       ▼
   ┌───────────────────────────────────┐
   │ STAGE 2 — EXECUTE (idea-run skill)│  per accepted item, in its repo
   │ re-validate (may analysis-decline)│
   │ → implement → test → commit      │
   │ → result artifact                │
   └───────────────┬───────────────────┘
                   ▼
   ┌───────────────────────────────────┐
   │ STAGE 3 — ORCHESTRATE (Athena)    │  waves, write-set collision checks,
   │ dispatch → watch → close → rollup │  kill finished fleets, one report
   └───────────────────────────────────┘
```

## Stage 1 — the gate (Athena)

Input: all `status='pending'` rows of `dev_ideas` (read-only SQL). Output: a verdicts
artifact + a human-readable split.

**Classification first, policy second.** Every item gets a class before any verdict:

| class | meaning | route |
| --- | --- | --- |
| `implementable` | concrete code change with a testable outcome | policy gate below |
| `observation` | scan/sim finding with nothing to build (STRENGTH rows, metrics) | close with note |
| `practice-door` | practice-adoption proposal mislabeled as an idea | reroute to knowledge triage |
| `invalid-stale` | contradicted by current code (spot-check) or duplicate | decline, cite evidence |

**Policy gate** (only for `implementable`):

- **accept** — concrete + code-grounded, and (risk ≤ 3, any impact) or (risk 4 AND impact ≥ 7).
- **decline** — risk ≥ 4 with impact ≤ 5 ("questionable impact, high risk" — the operator's
  named pattern), or vague with no testable outcome, or stale/duplicate.
- **needs-info** — cannot be judged without the operator; goes in the decline report with
  a question, not a verdict.

Spot-checks are grep-level ONLY (does the referenced file/gap still exist). Stage 1 never
reads deeply and never implements — depth is Stage 2's job, on accepted items only.

**Run #1 is full-split review**: the operator sees accepts + declines + reroutes before
any dispatch. Later runs go declines-only, then (calibration proven) autonomous.

## The verdict door — result.json ingest

Stage 1 writes `triage/runs/<run-id>/result.json` (repo root of the *personas* checkout):

```json
{
  "run_id": "triage-2026-08-10-a",
  "source": "athena-cli",
  "created_at": "<ISO8601>",
  "items": [
    { "ideaId": "<uuid>", "title": "<verbatim>", "verdict": "accept" | "reject",
      "reason": "<one line>", "seenStatus": "pending" }
  ]
}
```

A dedicated command (`dev_tools_triage_verdicts_ingest`) validates the artifact and
persists ONE pending `backlog_apply_triage` approval — the exact approval shape the
Backlog's "Send to Athena" button already produces, so the approval card, the per-item
verdict flips, and the apply executor are all reused unchanged. One click applies the
batch; every write keeps compare-and-swap `seenStatus` semantics so a row someone decided
meanwhile loses loudly.

Rationale for this door over alternatives: durable across restarts, proposal-gated (no
unattended writes), zero new executor surface, and it works whether verdicts come from
this CLI channel, a future in-app `triage_decide` op, or a scheduled run.
`needs-info` and `reroute` items never enter the artifact — only accept/reject verdicts
do; reroutes and observations are listed in the run's report for their own doors.

## Stage 2 — the idea-run skill

One skill (`.claude/skills/idea-run/`), one item per session, dispatched into the item's
own repo. Contract (details in the skill file):

1. **Re-validate before touching anything** — read the actual code the ticket names. If
   reality contradicts the ticket (already fixed, feature removed, premise wrong), write
   an `analysis-declined` result with evidence and STOP. An approved ticket is a
   hypothesis, not an order.
2. **Implement smallest-correct** — atomic commits, repo's own conventions
   (CLAUDE.md / conventions.json where present).
3. **Verify with the repo's own gates** — the project's tests/lint/typecheck, scoped runs.
4. **Report** — `idea-run/result.json` in the run dir: outcome
   (`implemented | analysis-declined | blocked`), commits, gates run, evidence.

The double gate is the safety property: Athena's cheap policy check (stage 1) AND the
skill's grounded re-check (stage 2) must both pass before code changes. That is what
makes later full autonomy a calibration question rather than a leap of faith.

## Stage 3 — orchestration rules (Athena)

- **Waves, not floods.** Default concurrency 3 sessions; at most 1 heavy-Rust build per
  wave (shared CARGO_TARGET_DIR serves stale artifacts under parallel builds — ledger,
  2026-08-07).
- **Write-set collision check** before every wave: two items whose write-areas overlap
  (same repo directory) never run concurrently — same-repo items serialize unless their
  areas are disjoint.
- **Watch honestly**: DONE/BLOCKED/HUNG classified from transcript tails, never from the
  Stale badge. Finished sessions are closed; one intervention max per stuck session,
  then escalate.
- **Rollup**: one report per run — implemented / analysis-declined / blocked, with the
  declined-by-analysis items appended to the operator's decline report.

## Decline report

One artifact per run (`triage/runs/<run-id>/declined.md`): every decline with its reason
and evidence, every needs-info with its question, every analysis-decline from stage 2.
This is the operator's manual re-evaluation surface — nothing silently disappears.

## Cost shape

Stage 1 ≈ a few reasoning passes over the whole backlog (constant-ish). Stage 2 cost
scales with ACCEPTED items only. On the design-time corpus: 58 pending → ~20 non-tickets
gated out for free, so the fleet spend covers only the ~2/3 that are real — and of those
only the accepts.

## Later steps (explicitly out of v1)

- `triage_decide` op family in the companion dispatcher so in-app Athena can emit
  verdict batches from chat (same artifact shape, same approval door).
- Extending the gate to the other deck kinds (practice, policy, evolution, goal
  sign-off) — the deck's `TriagePorts` enumerates the doors; each needs its own policy.
- Autonomous cadence (cron triage run when pending count crosses a threshold).
