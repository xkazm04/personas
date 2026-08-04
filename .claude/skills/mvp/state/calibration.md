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

## 2026-08-04 — systedo-case / Adamant (run 2)

Outcome: no-go (single blocker: Vercel Git integration disconnected since mid-June — prod serves a stale case-study build, /app 404s); 24 commits pushed; CI fully green for the FIRST time in repo history, both jobs, protection now requires both.

Friction and fixes for the skill:

1. **Pathspec commits doctrine validated.** Zero swept commits across 6 builders + orchestrator (run 1 had 3 incidents). Two builders self-detected foreign pre-staged files and restore-staged them. Keep as mandatory brief language.
2. **A long-red pipeline hides STACKED causes — budget for a loop, not a fix.** Five sequential root causes, each masked by the previous: (a) repo's own credential preflight at module scope killing build, (b) Node minor/ICU skew vs format goldens, (c) goldens timezone-baked (CI UTC vs Europe/Prague), (d) local-mode leak: one store consulted Firestore under LOCAL_DB, (e) cold-start spec race (isVisible() vs loading skeleton). Checklist addition: treat "CI red > 2 weeks" as *unknown-depth*, expect 3-5 iterations, and run fix→watch cycles in background.
3. **Certification e2e runs AFTER all builders land.** Concurrent commits during the in-run e2e caused dev-server recompiles that wiped client state mid-test (2 environmental failures that passed in isolation). Mirror of ship-loop's "tours serialized after suites".
4. **Cold-state repro discipline:** back up displaced state with `mv` to `*.bak` — NEVER `rm` (this run rm'd the local dev sqlite; the backup survived by luck). Delete stale `-wal`/`-shm` sidecars before restoring a SQLite file. Restore and integrity-check before ending the turn.
5. **New Phase-A probes that earned their place:** (a) dirty-tree triage question (operator said "mine, finished — commit first"; clean handoff to builders); (b) prod-staleness probe — compare prod cache `Age` header / rendered title against HEAD (caught a 47-day-stale deploy the repo's own docs didn't know about); (c) the P0 intent question (repo framing contradicted the launch goal and re-scoped five items).
6. **Assessor premise error rate holds at ~1 per brief** (firebase-admin blamed for the repo's own preflight; "hard-fail without key" was already a demo fallback; item counts off). Builder premise-verification remains the safety net — keep mandatory.
7. **no-go is a legitimate verdict** and lands well when it names ONE blocker with its exact unblock path. The skill's honesty framing (verdict yours to state) survived contact with a real stale-prod situation.
