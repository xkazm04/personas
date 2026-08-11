# Pattern Campaign — personas (pilot for every workspace repo)

**Goal.** Drive the `personas` repo from "432 adopted patterns, zero measured
adherence" to "measured, violations fixed in waves, re-measured" — and in doing
so certify the loop that every simpler workspace repo will then reuse.

**State lives in the DB, not in this file.** The coverage ledger
(`workspace_harvest_coverage`), the adoption matrix
(`workspace_practice_adoption`) and the pattern×context cells
(`workspace_practice_context_state`) are the campaign memory; any session —
Athena or CLI — resumes by reading them (`describe_knowledge` is the digest).
This file pins only the *protocol*.

## Baseline (2026-08-11)

| Surface | State |
|---|---|
| Library | 432 adopted · review queue empty · 8 playbooks all `draft` |
| Harvest | 12 territories × exactly 1 pass (2026-07-27), depth never measured → Phase 0 re-reads all of it |
| Adherence | 19,441 `unverified` cells (432 × 49 contexts), 0 verified |
| Verify-eligible | 164 practices (156 `proposed` + 7 `to_process` + 1 `adopted`) |
| Apply | never run |

## The doctrine (why this shape)

1. **Measure before touching code.** Applies are planned from *measured
   violations* (verify-lane cells with file evidence), never from the library
   size. `kind` ≠ "this repo violates it"; a verdict earns the work.
2. **Read-parallel, write-partitioned.** Harvest and verify sessions are
   read-only → parallel-safe. Apply sessions WRITE a shared checkout →
   **max 4 concurrent per repo, each on a disjoint context group** (operator's
   call, 2026-08-11 — enforced by the `apply_pattern` guard, which refuses
   same-group overlap and a second whole-repo session). Apply briefs forbid
   `git add -A` and put lockfiles/generated files off limits.
3. **A session's own claim never flips a cell.** Adherence moves only through
   the verify lane's evidence door (`apply_verified_context_evidence`);
   "surface, never auto-un-adopt" stays intact. A green gate is not behavior —
   re-measure after every apply wave.
4. **Athena drives; the operator owns adoption.** Under autonomous mode every
   op auto-fires, so the campaign self-advances; every knowledge-status
   decision (adopt/reject/activate a playbook) remains a human click.

## The loop

```
Phase 1  VERIFY ladder      evaluate_pattern × N (serial, ~25 practices/pass)
         (autonomous)       each pass completion wakes Athena with the honest
                            remainder → she proposes the next pass; at zero she
                            stops and plans Phase 3. Night-shift friendly.
Phase 2  TRIAGE             describe_knowledge now carries the campaign lens:
         (human + Athena)   per-project verdict progress + top violation
                            hotspots (pattern × violating-context counts).
                            Rank two ways: systemic patterns (violated in many
                            contexts) vs rotten corners (contexts violating
                            many patterns). Cut waves of ≤8 patterns.
Phase 3  APPLY waves        apply_pattern {target_project, pattern_ids|playbook,
         (write, gated)     context_group, objective} — briefs carry the
                            measured violations + territory paths. ≤4 live,
                            disjoint groups, atomic commits, repo gates.
                            Operator reviews each wave's commits before the
                            next (the reconciler wraps each Operation).
Phase 4  RE-VERIFY          evaluate_pattern on the touched project again;
                            cells flip violating→adopted only from evidence.
                            The graph rings are the progress bar. Loop 3↔4.
```

### Phase 0 — DEEP RE-SCAN (operator's call, 2026-08-11)

The 432 adopted patterns rest on ONE shallow pass per territory (2026-07-27,
depth never measured; the one measured harvest of that era read ~11% of its
ground). For a repo of this size that is an under-extraction, so the campaign
opens with a **depth-tracked harvest ladder** that runs BEFORE the verify
ladder:

- `run_pattern_harvest` waves chain like verify passes: each ingested wave
  wakes Athena with the yield + the territories still owing (never harvested,
  depth unknown, or below **70%** — `HARVEST_DEPTH_TARGET_PCT`), and she
  proposes the next wave until nothing owes. Selection is depth-first:
  never-harvested (biggest first) → depth-unknown (oldest) → shallowest.
  When every territory reads ≥70%, the auto-selector refuses and the ladder
  stops itself.
- New finds land `observed` and **merge with the existing canon** (operator's
  call: keep the 432, don't wipe): refinements link to their parents via
  `extends`; duplicates are blocked by the existing-titles + rejected-keys
  lists in every snapshot.
- **Adjudication gate between Phase 0 and Phase 1**: the review queue will
  hold hundreds of observed items. Adopt/reject them in review waves (bulk
  decide in the Patterns UI, or a sanctioned agent-adjudication pass like the
  F3 corpus run — the operator picks). The verify ladder measures ONLY
  adopted canon, so nothing proceeds until the queue is drained.

## Operating notes

- **Start it** by telling Athena (chat or voice): *"start the pattern campaign
  on personas — run the verification ladder."* She proposes the first
  `evaluate_pattern`; autonomous mode fires it; the watcher chains the rest.
- **Concurrent CLI work**: apply sessions commit atomically with explicit-path
  staging; the parallel-safety primitives in `.claude/CLAUDE.md` apply
  unchanged. Avoid running your own heavy edits in a group that has a live
  apply session (the fleet grid shows `apply:<project>:<group>` names).
- **Failure posture**: a failed verify pass stops the chain (the wake directive
  says so explicitly — no blind retries). A refused apply (guard, non-adopted
  pattern, unknown group) parks as a card naming the reason.
- **Roll-out to other repos**: the loop is repo-agnostic. For each sibling
  (brainiac, politicas, …): one harvest wave if never harvested → verify ladder
  → apply waves. Their context maps are smaller, so a whole campaign fits in an
  evening.

## Prerequisites checklist (operator)

- [ ] Activate the playbooks worth activating (Overview → Patterns → rail) —
      all 8 are still `draft`, and only ACTIVE playbooks are consultable or
      applicable.
- [ ] Autonomous mode ON (the chain and the waves ride it).
- [ ] App running (fleet PTY + verify jobs live in the app process).
- [ ] Optional: re-run a context scan first so territories/file-counts are
      fresh (the 2026-07 scopes predate file counting).
