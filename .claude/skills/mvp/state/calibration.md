# /mvp calibration log

Append one section per run. Read at run start; apply before repeating a mistake.

## 2026-08-04 — ascent (run 1)

Outcome: go-with-risks; 16 commits pushed; scorecard P0/P3/P4/P6 green, P1/P2/P5 partial (all partials blocked on operator env values or the Personas app being up, not on code).

Friction and fixes for the skill:

1. **Pathspec commits are mandatory.** Three separate index-race incidents: builders' staged files swept into a concurrent builder's commit between `git diff --cached --stat` and `git commit` (attribution noise, no content loss). Fix applied to doctrine: builder briefs must use `git commit -- <paths>` (with `git add <paths>` first for untracked files — bare pathspec commit errors on untracked). `git apply --cached` per-hunk worked well for co-mingled files (.env.example).
2. **Assessor premises fail at a real rate; builder premise-verification catches them.** This run: "lint warnings all tooling" (24 of 37 were in src/), "~34 checklist items" (26), "~13 commits since CHANGELOG" (44), "hero heading matches spec" (spec had rotted). Keep premise-verify mandatory in every brief; expect ~1 wrong premise per brief.
3. **launch-gate probe gap:** add "does CI actually RUN the e2e suite?" to the probes. Ascent's specs existed but never ran in CI, so they rotted silently against the shipping product. Existence of a harness is not evidence of a working gate.
4. **Bridge-dependent delegations need a reachability probe in Phase A.** project-populate hard-requires the Personas app loopback bridge; the app was down, so the accepted "full re-run" degraded to file-level reconciliation mid-execution. Assessors should probe app/bridge reachability up front so the decision round can present "requires the app running" honestly.
5. **Round shape validated:** 4 rounds of ≤4 questions, pipelined (P0/P5 presented while other assessors still ran) — zero dead wait, no operator overload. Two operator overrides (full project-populate; keep onboarding walls) — the select mechanism captured them cleanly.
6. **Framework-upgrade byproduct:** Next rewrites its `nextjs-agent-rules` block in AGENTS.md during build; classify that diff as own-run work and commit it, not foreign drift.
7. **Push-then-protect ordering worked**: enable branch protection only after the run's own push, with `enforce_admins: false` for solo-owner repos.
