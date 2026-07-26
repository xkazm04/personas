---
name: ship-loop
description: Milestone-driven ship-readiness loop for the personas app. Maintains a 9-dimension scorecard + append-only backlog, batches items into user-gated milestones (CP checkpoints), executes with atomic commits, and certifies each milestone with the full verification gate (suites first, tours last). Resumable across sessions — all state lives in state/ next to this file. Invoke with `/ship-loop` (resumes) or `/ship-loop boot` (fresh loop after archiving prior state).
---

# Ship Loop — milestone-driven ship readiness

A permanent loop that moves the app toward a user-defined **ship bar** (e.g. "distributable beta: a colleague can install + auto-update") through scored audits, user-gated milestone picks, and hard verification gates. Any session can resume it: the state files are the single source of truth, and this file is the procedure.

> Origin note: the loop ran Boot→M7 during 2026-07 with no skill definition — the procedure was reconstructed from seed artifacts and the kp-repo precedent. This SKILL.md codifies what actually worked, including the harness learnings recorded in `state/state.md`.

## State files (in `state/`, relative to this skill)

| File | Contract |
|---|---|
| `state.md` | Current truth: ship bar, scorecard, milestone status, harness notes. Rewrite freely; keep it one screen of load-bearing facts. |
| `backlog.md` | Item table `# / status / dimension / size / description`. **Numbering append-only — never renumber.** Statuses: ☐ todo · ◐ in progress · ☑ done · ✕ cut. |
| `journal.md` | Append-only, one line per event (item done w/ commit SHA, CP resolution, gate result, root-caused saga). Never edit past lines. |
| `decisions.md` | CP answers from the user + auto-decisions taken while AFK (each marked "pending user review at CPn"). |
| `value-case.md` | Dimension-9 (value & market) synthesis. Written once by the value lens, corrected only with code-verified evidence. |
| `archive-*/` | Frozen state of previous loops (different app or restarted loop). Read-only. |

## The 9 scorecard dimensions

1-Build · 2-Func(tionality) · 3-Tests · 4-UAT · 5-Tiering & packaging · 6-Sec(urity) · 7-UX · 8-Ops (release/CI/signing/updater) · 9-Value & market. Each is 🔴/🟡/🟢 on the scorecard in `state.md`. Dimensions 4 and 9 are run as **lenses** (audit passes that emit backlog items), not fixed at boot.

## Phases

### Boot (`/ship-loop boot` — only for a fresh loop)
1. Archive any existing `state/` contents to `state/archive-<slug>/`.
2. Run the audit lenses (build health, functionality honesty vs docs, test coverage of load-bearing paths, security posture, ops/release path) → seed `backlog.md` + initial scorecard in `state.md`.
3. **CP0**: present scorecard + backlog to the user; ask for the ship bar, cadence, and first milestone scope. If AFK, record provisional picks in `decisions.md` and proceed on the least-destructive batch.

### Resume (default)
1. Read `state/state.md`, then `backlog.md` and the tail of `journal.md`. Do NOT re-audit what the scorecard already scores.
2. Register in `.claude/active-runs.md` (per CLAUDE.md parallel-safety rules).
3. Continue: an in-flight milestone → keep executing; a completed one → run/finish its gate; gate green → next checkpoint.

### Checkpoint (CPn — before each milestone)
- Present: scorecard delta, recommended next milestone (a coherent batch of backlog items, usually 4-8 by theme: test-pin batch, ops unbrick, product decisions…), and any product decisions the work needs. One question at a time, single-keystroke answerable.
- **AFK protocol**: ask twice ~60s apart; if silent, record a provisional pick in `decisions.md` (least-destructive option, marked for re-ask), avoid boot-path/product-call edits while AFK, and never commit destructive changes on a provisional.

### Execute (milestone)
- One backlog item = one atomic commit, referenced by SHA in `journal.md`. Fan out parallel subagents only for disjoint paths.
- Respect foreign in-flight work (ledger + `git status` scan; stage only your paths, one `git reset -q && git add <paths>` invocation).
- Defer any item whose files are another session's hot area — mark it in `backlog.md` with the reason, don't fight over files.
- Premise-check before executing: audits overstate (see item 12 factoryMock, item 4 "permanently disabled") — verify the claim against current code first; correct the backlog item if the premise moved.

### Gate (after every milestone — certifies it)
1. `npx tsc --noEmit` · `npm run lint` (0 errors) · `npm run test -- --run` · `npx vite build`.
2. Rust touched → `cargo check` + clippy + the touched modules' filtered test suites (full suite failures are triaged: pre-existing vs regression — only regressions block).
3. UI touched → tours (`npm run test:tours:fresh`), **serialized after the suites — never concurrently** (CPU contention alone blows the 360s bridge window; bitten twice). Pre-warm the e2e target (`CARGO_TARGET_DIR=.personas-e2e-target`, features `desktop,test-automation`) AFTER committing, and retry once on a settled machine before deeper diagnosis. Test-only diffs may justified-skip tours — record the justification.
4. Record the gate line in `journal.md`; flip milestone ☑ in `state.md`; update the scorecard.

### Wrap (session end)
Update `state.md` + ledger entry (commit SHAs), leave no uncommitted work. The next session resumes from files alone.

## Invariants

- **User owns product calls.** Ship bar, scope narrowing, feature hide/delete, security trade-offs (e.g. the 120s redeem-grace deviation) are CP questions — never auto-decided, only provisionally deferred.
- **Honesty over green.** A gate that passes while the claim is unverified is not done — distinguish "code-verified" from "subagent-claimed" in every journal line (the M6 cold-start corrections exist because this was violated once).
- **Lenses emit items, items get numbers, numbers never change.**
